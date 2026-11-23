import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadFile, projectToMarkdown, safeFilename } from '../lib/export';
import { errorMessage, formatClock, formatDate, formatDuration } from '../lib/format';
import { callOffscreen } from '../lib/messages';
import * as store from '../lib/store';
import type { Note, Project, RecordingState } from '../lib/types';
import { NoteRow, ProjectDot } from '../ui/components/bits';
import { Empty, NoteView, Skeleton } from '../ui/components/NoteView';
import { ProjectModal } from '../ui/components/ProjectModal';
import { SettingsModal } from '../ui/components/SettingsModal';
import { subscribe } from '../lib/events';
import { elapsedMs, useDebouncedValue, useNote, useNotes, useNow, useProjects, useRecording, useSettings } from '../ui/hooks';
import { IconDownload, IconHome, IconPencil, IconPlus, IconSearch, IconSettings, IconStop, Logo } from '../ui/icons';
import { toast, Toaster } from '../ui/toast';
import { releaseSearchCache, searchNotes, searchTerms, type SearchResult } from './search';

type Route = { name: 'home' } | { name: 'project'; id: string } | { name: 'note'; id: string };

function parseRoute(hash: string): Route {
  const [kind, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const id = decodeURIComponent(rest.join('/'));
  if (kind === 'project' && id) return { name: 'project', id };
  if (kind === 'note' && id) return { name: 'note', id };
  return { name: 'home' };
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return useMemo(() => parseRoute(hash), [hash]);
}

const go = (path: string) => {
  location.hash = path;
};

interface Stats {
  notes: number;
  durationMs: number;
  lastAt: number;
}

type ModalState = null | { kind: 'settings' } | { kind: 'project'; project?: Project };

export function Library() {
  const route = useRoute();
  const projects = useProjects();
  const notes = useNotes();
  const recording = useRecording();
  const settings = useSettings();
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState('');
  // Search once typing pauses, not on every keystroke.
  const searchQuery = useDebouncedValue(query.trim(), 250, (q) => q === '');

  useEffect(() => {
    store.ensureInbox().catch(console.error);
  }, []);

  useEffect(() => {
    setQuery('');
  }, [route]);

  const stats = useMemo(() => {
    const map = new Map<string, Stats>();
    for (const n of notes ?? []) {
      const s = map.get(n.projectId) ?? { notes: 0, durationMs: 0, lastAt: 0 };
      s.notes++;
      s.durationMs += n.durationMs;
      s.lastAt = Math.max(s.lastAt, n.createdAt);
      map.set(n.projectId, s);
    }
    return map;
  }, [notes]);

  const activeProjectId = route.name === 'project' ? route.id : undefined;
  const projectById = (id: string) => projects?.find((p) => p.id === id);

  let content: ReactNode;
  if (query.trim()) {
    content = (
      <SearchView query={searchQuery} typed={query.trim()} projects={projects ?? []} liveNoteId={recording?.noteId} />
    );
  } else if (route.name === 'project') {
    content = (
      <ProjectView
        project={projectById(route.id)}
        loaded={!!projects}
        notes={notes?.filter((n) => n.projectId === route.id)}
        liveNoteId={recording?.noteId}
        onEdit={(project) => setModal({ kind: 'project', project })}
      />
    );
  } else if (route.name === 'note') {
    content = <NoteRoute noteId={route.id} projects={projects ?? []} recording={recording} />;
  } else {
    content = (
      <HomeView
        projects={projects}
        notes={notes}
        stats={stats}
        hasKey={!!settings?.apiKey}
        liveNoteId={recording?.noteId}
        onNewProject={() => setModal({ kind: 'project' })}
        onSettings={() => setModal({ kind: 'settings' })}
      />
    );
  }

  return (
    <div className="lib">
      <aside className="lib-side">
        <a href="#/" className="logo-link" aria-label="TORU home">
          <Logo size={24} />
        </a>

        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            type="search"
            placeholder="Search notes and transcripts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>

        <nav className="nav">
          <a className={`nav-item ${route.name === 'home' && !query ? 'active' : ''}`} href="#/">
            <IconHome size={15} /> Home
          </a>
        </nav>

        <div>
          <div className="nav-head">
            <span className="eyebrow">Projects</span>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              aria-label="New project"
              title="New project"
              onClick={() => setModal({ kind: 'project' })}
            >
              <IconPlus size={14} />
            </button>
          </div>
          <nav className="nav">
            {projects?.map((p) => (
              <a
                key={p.id}
                href={`#/project/${p.id}`}
                className={`nav-item ${activeProjectId === p.id && !query ? 'active' : ''}`}
              >
                <ProjectDot project={p} />
                <span className="truncate">{p.name}</span>
                <span className="count">{stats.get(p.id)?.notes ?? 0}</span>
              </a>
            ))}
          </nav>
        </div>

        <div className="lib-side-foot">
          {recording && <LiveCard recording={recording} />}
          <button className="nav-item" onClick={() => setModal({ kind: 'settings' })}>
            <IconSettings size={15} /> Settings
          </button>
        </div>
      </aside>

      <main className="lib-main">{content}</main>

      {modal?.kind === 'settings' && settings && <SettingsModal initial={settings} onClose={() => setModal(null)} />}
      {modal?.kind === 'project' && (
        <ProjectModal
          project={modal.project}
          onClose={() => setModal(null)}
          onSaved={(p) => !modal.project && go(`/project/${p.id}`)}
          onDeleted={() => go('/')}
        />
      )}
      <Toaster />
    </div>
  );
}

function LiveCard({ recording }: { recording: RecordingState }) {
  const note = useNote(recording.noteId);
  const now = useNow(!recording.paused);
  return (
    <div className="live-card">
      <div className="row">
        <span className={`rec-dot ${recording.paused ? 'paused' : ''}`} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{recording.paused ? 'Paused' : 'Recording'}</span>
        <span className="grow" />
        <span className="mono faint" style={{ fontSize: 12.5 }}>
          {formatClock(elapsedMs(recording, now))}
        </span>
      </div>
      <a className="live-title clamp-2" href={`#/note/${recording.noteId}`}>
        {note?.title ?? '…'}
      </a>
      <button
        className="btn btn-sm btn-light"
        onClick={() => callOffscreen({ type: 'STOP' }).catch((e) => toast(errorMessage(e), 'error'))}
      >
        <IconStop size={12} /> Stop recording
      </button>
    </div>
  );
}

function HomeView(props: {
  projects?: Project[];
  notes?: Note[];
  stats: Map<string, Stats>;
  hasKey: boolean;
  liveNoteId?: string;
  onNewProject: () => void;
  onSettings: () => void;
}) {
  const { projects, notes, stats } = props;
  if (!projects || !notes) return <Skeleton lines={6} />;
  const total = notes.reduce((sum, n) => sum + n.durationMs, 0);
  const firstRun = notes.length === 0;
  const visibleProjects = projects.filter((p) => p.id !== store.INBOX_ID || (stats.get(p.id)?.notes ?? 0) > 0);

  return (
    <div className="page">
      <div className="eyebrow">Library</div>
      <h1 className="hero">{firstRun ? 'Listen once. Keep the notes.' : 'Your lecture notes'}</h1>
      <p className="lede">
        {firstRun
          ? 'TORU records the audio of a browser tab, transcribes it as it plays, and turns each lecture into study notes, filed by project.'
          : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} across ${visibleProjects.length} ${
              visibleProjects.length === 1 ? 'project' : 'projects'
            } · ${formatDuration(total)} recorded`}
      </p>

      {firstRun && (
        <div className="steps">
          <Step n={1} title="Add your OpenAI key" done={props.hasKey}>
            Used for transcription and summaries.{' '}
            {!props.hasKey && (
              <button className="link-btn" onClick={props.onSettings}>
                Open settings
              </button>
            )}
          </Step>
          <Step n={2} title="Create a project" done={projects.length > 1}>
            One per course or topic, e.g. “Entra ID”.{' '}
            {projects.length <= 1 && (
              <button className="link-btn" onClick={props.onNewProject}>
                New project
              </button>
            )}
          </Step>
          <Step n={3} title="Record a lecture">
            Click the TORU icon on the video’s tab and press Start recording, or press Alt+Shift+R.
          </Step>
        </div>
      )}

      <h2 className="section-title">Projects</h2>
      <div className="project-grid">
        {visibleProjects.map((p) => {
          const s = stats.get(p.id);
          return (
            <a key={p.id} href={`#/project/${p.id}`} className="project-card">
              <div>
                <ProjectDot project={p} size={10} />
                <h3>{p.name}</h3>
                {p.description && <p className="clamp-2">{p.description}</p>}
              </div>
              <div className="stats">
                {s ? `${s.notes} ${s.notes === 1 ? 'note' : 'notes'} · ${formatDuration(s.durationMs)}` : 'No notes yet'}
              </div>
            </a>
          );
        })}
        <button className="project-card new" onClick={props.onNewProject}>
          <IconPlus size={18} />
          <span>New project</span>
        </button>
      </div>

      {!firstRun && (
        <>
          <h2 className="section-title">Recent</h2>
          <div className="note-list">
            {notes.slice(0, 12).map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                project={projects.find((p) => p.id === n.projectId)}
                showProject
                liveNoteId={props.liveNoteId}
                onOpen={() => go(`/note/${n.id}`)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className={`step ${done ? 'done' : ''}`}>
      <span className="step-n">{done ? '✓' : n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function ProjectView(props: {
  project?: Project;
  loaded: boolean;
  notes?: Note[];
  liveNoteId?: string;
  onEdit: (p: Project) => void;
}) {
  const { project, notes } = props;
  if (!props.loaded || !notes) return <Skeleton lines={6} />;
  if (!project) {
    return <Empty title="Project not found" text="It may have been deleted." />;
  }
  const total = notes.reduce((sum, n) => sum + n.durationMs, 0);
  const summarised = notes.filter((n) => n.summary).length;

  function exportProject() {
    if (!project || !notes) return;
    downloadFile(`${safeFilename(project.name)} — study notes.md`, projectToMarkdown(project, notes));
  }

  return (
    <div className="page">
      <div className="row eyebrow" style={{ gap: 8 }}>
        <ProjectDot project={project} /> Project
      </div>
      <h1 className="hero">{project.name}</h1>
      {project.description && <p className="lede">{project.description}</p>}
      <div className="project-bar">
        <div className="meta-row">
          <span className="chip">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
          {total > 0 && <span className="chip">{formatDuration(total)}</span>}
          {notes.length > 0 && <span className="chip">{summarised} summarised</span>}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => props.onEdit(project)}>
            <IconPencil size={13} /> Edit
          </button>
          <button className="btn btn-sm" onClick={exportProject} disabled={!notes.length}>
            <IconDownload size={13} /> Export study notes
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <Empty
          title="No lectures here yet"
          text="Open a video, click the TORU icon, choose this project and press Start recording."
        />
      ) : (
        <div className="note-list" style={{ marginTop: 18 }}>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} liveNoteId={props.liveNoteId} onOpen={() => go(`/note/${n.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRoute({
  noteId,
  projects,
  recording,
}: {
  noteId: string;
  projects: Project[];
  recording: RecordingState | null | undefined;
}) {
  const note = useNote(noteId);
  const project = note ? projects.find((p) => p.id === note.projectId) : undefined;
  return (
    <div className="page page-note">
      <NoteView
        noteId={noteId}
        recording={recording}
        back={
          project && (
            <a className="btn btn-ghost btn-sm back" href={`#/project/${project.id}`}>
              ← {project.name}
            </a>
          )
        }
        onDeleted={() => go(project ? `/project/${project.id}` : '/')}
      />
    </div>
  );
}

// ------------------------------------------------------------------ search

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/** Runs the search when the (debounced) query changes, keeping the previous results on screen meanwhile. */
function useSearch(query: string): SearchResult[] | undefined {
  const [results, setResults] = useState<SearchResult[]>();
  const latest = useRef(query);
  latest.current = query;

  useEffect(() => {
    if (!query) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () =>
      searchNotes(query).then(
        (r) => alive && latest.current === query && setResults(r),
        (e) => console.error('[toru] search failed', e),
      );
    run();
    // Refresh when notes change (e.g. a live lecture gets new lines), at most every 400 ms.
    const unsubscribe = subscribe((e) => {
      if (e.type !== 'notes' && e.type !== 'segments') return;
      timer ??= setTimeout(() => {
        timer = undefined;
        run();
      }, 400);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [query]);

  return query ? results : undefined;
}

function SearchView(props: { query: string; typed: string; projects: Project[]; liveNoteId?: string }) {
  const { query, projects, liveNoteId } = props;
  const results = useSearch(query);
  const terms = searchTerms(query);
  useEffect(() => releaseSearchCache, []); // give the memory back when search closes
  return (
    <div className="page">
      <div className="eyebrow">Search</div>
      <h1 className="hero" style={{ fontSize: 'clamp(34px, 4vw, 48px)' }}>
        “{props.typed}”
      </h1>
      {!results ? (
        <Skeleton lines={4} />
      ) : results.length === 0 ? (
        <Empty title="No matches" text="Try fewer or different words. Titles, summaries, your notes and transcripts are searched." />
      ) : (
        <>
          <p className="lede">
            {results.length} {results.length === 1 ? 'note' : 'notes'}
          </p>
          <div className="note-list">
            {results.map(({ note, snippet }) => {
              const project = projects.find((p) => p.id === note.projectId);
              return (
                <button key={note.id} className="note-row" onClick={() => go(`/note/${note.id}`)}>
                  <div className="note-row-title">
                    <span className="truncate">
                      <Highlight text={note.title} terms={terms} />
                    </span>
                  </div>
                  <div className="note-row-meta">
                    {project && (
                      <span className="row" style={{ gap: 6 }}>
                        <ProjectDot project={project} size={6} /> {project.name}
                      </span>
                    )}
                    <span>{formatDate(note.createdAt)}</span>
                    {liveNoteId === note.id && <span className="chip chip-red">Recording</span>}
                  </div>
                  {snippet && (
                    <div className="note-row-preview clamp-2">
                      <Highlight text={snippet} terms={terms} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
