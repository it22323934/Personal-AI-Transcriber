// Service worker: starts captures (tabCapture needs the extension's
// permission for the tab, which Chrome grants on the toolbar icon, the
// keyboard shortcut or the context menu), manages the offscreen recorder's
// lifetime, splits notes when the recorded tab changes page, shows the REC
// badge, and injects the on-page mini player.
import { subscribe } from '../lib/events';
import { cleanTitle, errorMessage, pageKey } from '../lib/format';
import type { BackgroundRequest, OffscreenRequest, Reply } from '../lib/messages';
import { callOffscreen } from '../lib/messages';
import { openLibrary } from '../lib/nav';
import * as store from '../lib/store';
import type { RecordingState, RecordingView } from '../lib/types';

const OFFSCREEN_PATH = 'offscreen.html';
const MINI_SCRIPT = 'widget.js';
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

// ------------------------------------------------------------ mini player

/**
 * The preferred recording view, mirrored in memory because the keyboard
 * shortcut must decide synchronously (inside the gesture) whether to open the
 * side panel. Undefined until loaded after a cold start; then we assume panel.
 */
let cachedView: RecordingView | undefined;
const refreshView = () =>
  store.getSettings().then(
    (s) => (cachedView = s.recordingView),
    () => {},
  );
void refreshView();
subscribe((e) => {
  if (e.type === 'settings') void refreshView();
});

async function setView(view: RecordingView): Promise<void> {
  cachedView = view;
  await store.saveSettings({ recordingView: view });
}

/** Injects (or re-shows) the mini player on the recorded tab. Idempotent. */
async function showMini(tabId?: number): Promise<void> {
  const id = tabId ?? (await store.getRecording())?.tabId;
  if (id === undefined) throw new Error('Nothing is being recorded.');
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: [MINI_SCRIPT] });
  } catch {
    throw new Error('The mini player can’t be shown on this page. Click the TORU icon on the tab once, then try again.');
  }
}

function closePanel(windowId: number | undefined): void {
  if (windowId === undefined) return;
  // sidePanel.close exists from Chrome 141; older versions just keep the panel open.
  chrome.sidePanel.close?.({ windowId })?.catch(() => {});
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

  // Follow along in the view the user used last.
  let mini = false;
  if (settings.recordingView === 'mini') {
    mini = await showMini(tabId).then(
      () => true,
      () => false, // fall back to the side panel
    );
  }
  return { ...reply, mini };
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
  if (!status?.busy) {
    // Nothing is recording or processing: drop audio/lines whose note is gone.
    await store.sweepOrphans().catch(console.error);
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
    const started = await startRecording(tab.id, settings.lastProjectId);
    if (started.mini) closePanel(tab.windowId); // in case it opened before the view was known
  } catch (e) {
    await store.setFlash(errorMessage(e));
  }
}

function openPanelForGesture(tab: chrome.tabs.Tab | undefined): void {
  // Must run synchronously inside the user gesture. Mini-player users get no panel.
  if (cachedView !== 'mini' && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-recording') return;
  openPanelForGesture(tab);
  void toggleFromGesture(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  openPanelForGesture(tab);
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

  const settings = await store.getSettings();
  if (pageKey(tab.url) !== rec.pageKey) {
    if (settings.autoSplit) {
      await callOffscreen({ type: 'ROLLOVER', title: tab.title ?? '', url: tab.url } satisfies OffscreenRequest);
    }
  } else {
    // Same page: adopt a title that arrived late (single-page apps update it after navigating).
    const title = cleanTitle(tab.title);
    await store.updateNote(rec.noteId, (n) =>
      !n.titleEdited && n.status === 'recording' && tab.title && n.title !== title ? { title } : undefined,
    );
  }
  // A new page load wipes the mini player, so put it back.
  if (settings.recordingView === 'mini' && tab.status === 'complete') {
    await showMini(tabId).catch(() => {});
  }
}

// --------------------------------------------------------------- messages

async function handle(msg: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<object> {
  switch (msg.type) {
    case 'OPEN_PANEL': {
      // sidePanel.open must be called before any await to keep the click's user gesture.
      const windowId = sender.tab?.windowId;
      const opening = windowId !== undefined ? chrome.sidePanel.open({ windowId }) : Promise.reject();
      try {
        await opening;
      } catch {
        throw new Error('Click the TORU icon in the toolbar to open the side panel.');
      }
      await setView('panel');
      return {};
    }
    case 'SHOW_MINI':
      await showMini();
      await setView('mini');
      return {};
    case 'OPEN_LIBRARY':
      await openLibrary(msg.route);
      return {};
    case 'NOTE_STATUS': {
      const note = await store.getNote(msg.noteId);
      const project = note ? await store.getProject(note.projectId) : undefined;
      return {
        note: note
          ? { status: note.status, hasSummary: !!note.summary, projectName: project?.name ?? '', error: note.error }
          : null,
      };
    }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse: (r: Reply) => void) => {
  if (msg?.target !== 'background') return false;
  handle(msg as BackgroundRequest, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (e) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});
