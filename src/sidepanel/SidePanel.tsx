import { useEffect, useRef, useState } from 'react';
import { errorMessage, formatClock, hostname } from '../lib/format';
import { callBackground, callOffscreen } from '../lib/messages';
import * as store from '../lib/store';
import type { Note, Project, RecordingState } from '../lib/types';
import { NoteRow, LevelBars } from '../ui/components/bits';
import { Empty, NoteView } from '../ui/components/NoteView';
import { ProjectModal } from '../ui/components/ProjectModal';
import { SettingsModal } from '../ui/components/SettingsModal';
import { elapsedMs, useNote, useNotes, useNow, useProjects, useRecording, useSettings } from '../ui/hooks';
import {
  IconArrowLeft,
  IconBook,
  IconFile,
  IconPause,
  IconPlay,
  IconPlus,
  IconRecord,
  IconSettings,
  IconStop,
  Logo,
} from '../ui/icons';
import { openLibrary } from '../ui/nav';
import { toast, Toaster } from '../ui/toast';

const RECORDABLE = /^(https?|file):/;

function useActiveTab(): chrome.tabs.Tab | undefined {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  useEffect(() => {
    const refresh = () => {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([t]) => setTab(t))
        .catch(() => {});
    };
    const onUpdated = (_id: number, _info: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => {
      if (t.active) refresh();
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}

export function SidePanel() {
  const settings = useSettings();
  const projects = useProjects();
  const recording = useRecording();
  const liveNote = useNote(recording?.noteId ?? '');
  const tab = useActiveTab();
  const [projectId, setProjectId] = useState<string>();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'settings' | 'project'>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // A start error belongs to the tab it happened on.
  useEffect(() => setStartError(null), [tab?.id, tab?.url]);

  useEffect(() => {
    store.ensureInbox().catch(console.error);
    store.takeFlash().then((m) => m && toast(m, 'error'), console.error);
  }, []);

  // Start with the project used last time.
  useEffect(() => {
    if (!settings || !projects) return;
    if (projectId && projects.some((p) => p.id === projectId)) return;
    const last = projects.find((p) => p.id === settings.lastProjectId);
    setProjectId(last?.id ?? store.INBOX_ID);
  }, [settings, projects, projectId]);

  // Open the live note when a recording starts or rolls over to a new page.
  const lastLive = useRef<string | null>(null);
  useEffect(() => {
    const id = recording?.noteId ?? null;
    if (id && id !== lastLive.current) setOpenNoteId(id);
    lastLive.current = id;
  }, [recording?.noteId]);

  const listProjectId = recording && liveNote ? liveNote.projectId : projectId;
  const listProject = projects?.find((p) => p.id === listProjectId);
  const canRecord = !!tab?.url && RECORDABLE.test(tab.url);

  function chooseProject(id: string) {
    if (recording && liveNote) {
      void store.updateNote(liveNote.id, { projectId: id }); // move the live note
    } else {
      setProjectId(id);
      void store.saveSettings({ lastProjectId: id });
    }
  }

  async function start() {
    if (!settings?.apiKey) {
      setModal('settings');
      toast('Add your OpenAI API key to start recording.');
      return;
    }
    if (tab?.id === undefined) return;
    setStarting(true);
    setStartError(null);
    try {
      await callBackground({ type: 'START', tabId: tab.id, projectId: projectId ?? store.INBOX_ID });
    } catch (e) {
      setStartError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    try {
      await callOffscreen({ type: 'STOP' });
    } catch (e) {
      await callBackground({ type: 'GET_STATE' }).catch(() => {});
      toast(errorMessage(e), 'error');
    }
  }

  async function togglePause() {
    if (!recording) return;
    try {
      await callOffscreen({ type: recording.paused ? 'RESUME' : 'PAUSE' });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="sp">
      <div className={`sp-top ${recording ? 'is-recording' : ''}`}>
        <div className="sp-header">
          <Logo size={22} />
          <div className="row" style={{ gap: 2 }}>
            <button
              className="icon-btn"
              title="Open library"
              aria-label="Open library"
              onClick={() => openLibrary(listProjectId ? `/project/${listProjectId}` : '')}
            >
              <IconBook />
            </button>
            <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setModal('settings')}>
              <IconSettings />
            </button>
          </div>
        </div>
        {recording && (
          <RecordingBar
            recording={recording}
            liveNote={liveNote ?? undefined}
            projects={projects ?? []}
            onlyThisTab={tab?.id === recording.tabId}
            onProject={chooseProject}
            onPause={togglePause}
            onStop={stop}
          />
        )}
      </div>

      <main className="sp-body">
        {settings && !settings.apiKey && (
          <div className="callout callout-lime">
            <div className="callout-body">
              <span>
                <strong>Add your OpenAI API key</strong> to start transcribing. It’s stored only in this browser.
              </span>
              <div className="callout-actions">
                <button className="btn btn-sm btn-primary" onClick={() => setModal('settings')}>
                  Open settings
                </button>
              </div>
            </div>
          </div>
        )}

        {recording === null && openNoteId && (
          // Compact recorder while a note is open, so the note gets the room.
          <section className="card recorder recorder-compact">
            <div className="row">
              <ProjectSelect projects={projects ?? []} value={projectId} onChange={chooseProject} />
              <button
                className="btn btn-primary"
                disabled={!canRecord || starting}
                onClick={start}
                title={canRecord ? `Record “${tab?.title ?? 'this tab'}”` : 'This page can’t be recorded'}
              >
                <IconRecord size={12} /> {starting ? 'Starting…' : 'Record tab'}
              </button>
            </div>
            {startError && <StartError message={startError} />}
          </section>
        )}

        {recording === null && !openNoteId && (
          <section className="card recorder">
            <div className="field">
              <span className="eyebrow">Save to</span>
              <div className="row">
                <ProjectSelect projects={projects ?? []} value={projectId} onChange={chooseProject} />
                <button
                  className="icon-btn"
                  title="New project"
                  aria-label="New project"
                  onClick={() => setModal('project')}
                >
                  <IconPlus />
                </button>
              </div>
            </div>

            <div className="source">
              <div className="favicon">
                {tab?.favIconUrl && canRecord ? (
                  <img src={tab.favIconUrl} alt="" width={16} height={16} />
                ) : (
                  <IconFile />
                )}
              </div>
              <div className="grow">
                <div className="source-title clamp-2">{tab?.title || 'No tab selected'}</div>
                {canRecord && <div className="source-host faint truncate">{hostname(tab!.url!)}</div>}
              </div>
            </div>

            <button className="btn btn-primary btn-lg btn-block" disabled={!canRecord || starting} onClick={start}>
              <IconRecord size={14} /> {starting ? 'Starting…' : 'Start recording'}
            </button>
            {startError ? (
              <StartError message={startError} />
            ) : (
              <p className="hint">
                {canRecord
                  ? 'Records this tab’s audio only · Alt+Shift+R'
                  : 'Chrome’s own pages can’t be recorded. Switch to the tab with your video.'}
              </p>
            )}
          </section>
        )}

        {openNoteId ? (
          <section>
            <NoteView
              key={openNoteId}
              noteId={openNoteId}
              recording={recording}
              compact
              back={
                <button className="btn btn-ghost btn-sm back" onClick={() => setOpenNoteId(null)}>
                  <IconArrowLeft size={14} /> {listProject?.name ?? 'Notes'}
                </button>
              }
              onDeleted={() => setOpenNoteId(null)}
              onOpenFull={() => openLibrary(`/note/${openNoteId}`)}
            />
          </section>
        ) : (
          listProjectId && (
            <ProjectNotes
              project={listProject}
              projectId={listProjectId}
              liveNoteId={recording?.noteId}
              onOpen={setOpenNoteId}
            />
          )
        )}
      </main>

      {modal === 'settings' && settings && <SettingsModal initial={settings} onClose={() => setModal(null)} />}
      {modal === 'project' && (
        <ProjectModal onClose={() => setModal(null)} onSaved={(p) => chooseProject(p.id)} />
      )}
      <Toaster />
    </div>
  );
}

function StartError({ message }: { message: string }) {
  return (
    <div className="callout callout-warn" role="alert">
      <div className="callout-body">{message}</div>
    </div>
  );
}

function ProjectSelect(props: { projects: Project[]; value?: string; onChange: (id: string) => void }) {
  return (
    <select
      className="select-pill grow"
      aria-label="Project"
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function RecordingBar(props: {
  recording: RecordingState;
  liveNote?: Note;
  projects: Project[];
  onlyThisTab: boolean;
  onProject: (id: string) => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const { recording } = props;
  const now = useNow(!recording.paused);
  return (
    <div className="rec-bar">
      <div className="row">
        <span className={`rec-dot ${recording.paused ? 'paused' : ''}`} />
        <span className="rec-label">{recording.paused ? 'Paused' : 'Recording'}</span>
        <span className="mono rec-time">{formatClock(elapsedMs(recording, now))}</span>
        <span className="grow" />
        {!recording.paused && <LevelBars count={16} height={18} />}
      </div>
      <div className="row">
        <ProjectSelect projects={props.projects} value={props.liveNote?.projectId} onChange={props.onProject} />
        <button
          className="btn btn-sm"
          onClick={props.onPause}
          aria-label={recording.paused ? 'Resume' : 'Pause'}
          title={recording.paused ? 'Resume' : 'Pause'}
        >
          {recording.paused ? <IconPlay size={13} /> : <IconPause size={13} />}
          {recording.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn btn-sm btn-light" onClick={props.onStop}>
          <IconStop size={13} /> Stop
        </button>
      </div>
      {!props.onlyThisTab && (
        <button className="link-btn" onClick={() => chrome.tabs.update(recording.tabId, { active: true })}>
          Recording another tab · go to it
        </button>
      )}
    </div>
  );
}

function ProjectNotes(props: {
  project?: Project;
  projectId: string;
  liveNoteId?: string;
  onOpen: (id: string) => void;
}) {
  const notes = useNotes(props.projectId);
  const shown = notes?.slice(0, 40) ?? [];
  return (
    <section>
      <div className="list-head">
        <h2 className="list-title serif">{props.project?.name ?? 'Notes'}</h2>
        {notes && notes.length > 0 && (
          <span className="faint" style={{ fontSize: 12 }}>
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        )}
      </div>
      {notes && notes.length === 0 && (
        <Empty
          title="Nothing recorded yet"
          text="Play a lecture in this tab and press Start recording. The transcript appears as it plays, and your study notes are written when you stop."
        />
      )}
      <div className="note-list">
        {shown.map((n) => (
          <NoteRow key={n.id} note={n} liveNoteId={props.liveNoteId} onOpen={() => props.onOpen(n.id)} />
        ))}
      </div>
      {notes && notes.length > shown.length && (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => openLibrary(`/project/${props.projectId}`)}>
          See all {notes.length} in the library
        </button>
      )}
    </section>
  );
}
