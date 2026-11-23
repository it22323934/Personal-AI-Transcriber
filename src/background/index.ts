// Service worker: starts captures (tabCapture needs the extension's
// permission for the tab, which Chrome grants on the toolbar icon, the
// keyboard shortcut or the context menu), manages the offscreen recorder's
// lifetime, splits notes when the recorded tab changes page, and shows the
// REC badge.
import { cleanTitle, errorMessage, pageKey } from '../lib/format';
import type { BackgroundRequest, OffscreenRequest, Reply } from '../lib/messages';
import { callOffscreen } from '../lib/messages';
import * as store from '../lib/store';
import type { RecordingState } from '../lib/types';

const OFFSCREEN_PATH = 'offscreen.html';
const MENU_ID = 'toggle-recording';

// ------------------------------------------------------------------ setup

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'TORU: start or stop recording this tab',
      contexts: ['page', 'video', 'audio', 'link', 'selection', 'image'],
    });
  });
  void store.ensureInbox();
  void reconcile({ sweep: true });
});

chrome.runtime.onStartup.addListener(() => {
  void reconcile({ sweep: true });
});

// The toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// -------------------------------------------------------------- offscreen

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Captures the selected tab’s audio so it can be transcribed.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function offscreenStatus(): Promise<{ recording: boolean; busy: boolean } | null> {
  if (!(await hasOffscreen())) return null;
  try {
    return await callOffscreen<{ ok: boolean; recording: boolean; busy: boolean }>({ type: 'PING' });
  } catch {
    return null;
  }
}

async function closeOffscreenIfIdle(): Promise<void> {
  const status = await offscreenStatus();
  if (status && !status.busy) await chrome.offscreen.closeDocument().catch(() => {});
}

// -------------------------------------------------------------- recording

function friendlyCaptureError(e: unknown): Error {
  const message = errorMessage(e);
  if (/invoked|activeTab/i.test(message)) {
    return new Error(
      'Chrome needs your OK for this tab first. Press Alt+Shift+R on the tab, or right-click the page → “TORU: start or stop recording this tab”.',
    );
  }
  if (/active stream/i.test(message)) {
    return new Error('This tab is already being captured (by TORU or another extension).');
  }
  return e instanceof Error ? e : new Error(message);
}

async function startRecording(tabId: number, projectId: string | undefined) {
  const settings = await store.getSettings();
  if (!settings.apiKey) throw new Error('Add your OpenAI API key in Settings first.');
  if (await reconcile()) throw new Error('Already recording. Stop the current recording first.');

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^(https?|file):/.test(tab.url)) {
    throw new Error('Chrome doesn’t allow recording this page. Open the video in a normal web page.');
  }
  const project = projectId ? await store.getProject(projectId) : undefined;
  const pid = project?.id ?? (await store.ensureInbox()).id;

  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    throw friendlyCaptureError(e);
  }

  await ensureOffscreen();
  const reply = await callOffscreen(
    { type: 'START', streamId, tabId, projectId: pid, title: tab.title ?? '', url: tab.url },
    20,
  );
  await store.saveSettings({ lastProjectId: pid });
  return reply;
}

/**
 * Returns the live recording, clearing state left behind by a recorder that
 * no longer exists (browser restart, extension reload). With `sweep`, notes
 * stuck mid-processing are marked interrupted so they can be retried.
 */
async function reconcile(opts: { sweep?: boolean } = {}): Promise<RecordingState | null> {
  const rec = await store.getRecording();
  const status = await offscreenStatus();
  if (rec && status?.recording) {
    await updateBadge(rec);
    return rec;
  }
  if (rec) {
    await store.setRecording(null);
    await store.updateNote(rec.noteId, (n) =>
      n.status === 'recording'
        ? { status: 'interrupted', error: 'The recording was cut off (browser closed or extension reloaded).' }
        : undefined,
    );
  }
  if (opts.sweep && !status?.busy) {
    for (const note of await store.listNotes()) {
      if (note.status === 'recording' || note.status === 'processing' || note.status === 'summarizing') {
        await store.updateNote(note.id, {
          status: 'interrupted',
          error: 'Processing was interrupted. Use Retry to finish this note.',
        });
      }
    }
  }
  await updateBadge(null);
  return null;
}

async function updateBadge(rec: RecordingState | null): Promise<void> {
  await chrome.action.setBadgeText({ text: rec ? (rec.paused ? 'II' : 'REC') : '' });
  if (rec) await chrome.action.setBadgeBackgroundColor({ color: rec.paused ? '#6f6d63' : '#e5484d' });
  await chrome.action.setTitle({ title: rec ? 'TORU — recording' : 'Open TORU' });
}

/** Keyboard shortcut / context menu: toggle recording on that tab. */
async function toggleFromGesture(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;
  try {
    if (await reconcile()) {
      await callOffscreen({ type: 'STOP' });
      return;
    }
    const settings = await store.getSettings();
    await startRecording(tab.id, settings.lastProjectId);
  } catch (e) {
    await store.setFlash(errorMessage(e));
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-recording') return;
  // Must run synchronously inside the user gesture.
  if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  void toggleFromGesture(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  void toggleFromGesture(tab);
});

// ------------------------------------------------- page changes & titles

const pendingChecks = new Map<number, ReturnType<typeof setTimeout>>();

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url && !info.title && info.status !== 'complete') return;
  clearTimeout(pendingChecks.get(tabId));
  // Wait for the page to settle so the new title is available.
  pendingChecks.set(
    tabId,
    setTimeout(() => {
      pendingChecks.delete(tabId);
      checkRecordedTab(tabId).catch(console.error);
    }, 1200),
  );
});

async function checkRecordedTab(tabId: number): Promise<void> {
  const rec = await store.getRecording();
  if (!rec || rec.tabId !== tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;

  if (pageKey(tab.url) !== rec.pageKey) {
    const settings = await store.getSettings();
    if (settings.autoSplit) {
      await callOffscreen({ type: 'ROLLOVER', title: tab.title ?? '', url: tab.url } satisfies OffscreenRequest);
    }
    return;
  }
  // Same page: adopt a title that arrived late (single-page apps update it after navigating).
  const title = cleanTitle(tab.title);
  await store.updateNote(rec.noteId, (n) =>
    !n.titleEdited && n.status === 'recording' && tab.title && n.title !== title ? { title } : undefined,
  );
}

// --------------------------------------------------------------- messages

async function handle(msg: BackgroundRequest): Promise<object> {
  switch (msg.type) {
    case 'START':
      return startRecording(msg.tabId, msg.projectId);
    case 'GET_STATE':
      return { recording: await reconcile() };
    case 'RECORDING_CHANGED':
      await updateBadge(await store.getRecording());
      return {};
    case 'OFFSCREEN_IDLE':
      await closeOffscreenIfIdle();
      return {};
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse: (r: Reply) => void) => {
  if (msg?.target !== 'background') return false;
  handle(msg as BackgroundRequest).then(
    (result) => sendResponse({ ok: true, ...result }),
    (e) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});
