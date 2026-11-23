import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { downloadFile, noteToMarkdown, safeFilename } from '../../lib/export';
import { errorMessage, formatClock, formatDate, formatDuration, hostname, timeAgo } from '../../lib/format';
import { discardAudio, generateSummary, retryPendingChunks } from '../../lib/pipeline';
import * as store from '../../lib/store';
import type { Note, Project, RecordingState, Segment } from '../../lib/types';
import { useDebouncedSave, useLive, useNote, useProjects } from '../hooks';
import { IconCopy, IconDownload, IconExpand, IconExternal, IconRefresh, IconSparkle, IconTrash } from '../icons';
import { Markdown } from '../Markdown';
import { toast } from '../toast';
import { LevelBars, Menu, StatusChip } from './bits';
import { useConfirm } from './Modal';
import { ChatPanel } from './ChatPanel';
import { Select } from './Select';

type Tab = 'summary' | 'transcript' | 'notes' | 'ask';

export function NoteView(props: {
  noteId: string;
  recording: RecordingState | null | undefined;
  compact?: boolean;
  /** Rendered at the top left, opposite the note actions (e.g. a back link). */
  back?: ReactNode;
  onDeleted?: () => void;
  onOpenFull?: () => void;
}) {
  const { noteId, recording, compact } = props;
  const note = useNote(noteId);
  const segments = useLive(
    () => store.getSegments(noteId),
    [noteId],
    (e) => e.type === 'segments' && e.noteId === noteId,
  );
  const pending =
    useLive(
      () => store.countChunks(noteId),
      [noteId],
      (e) => e.type === 'chunks' && e.noteId === noteId,
    ) ?? 0;
  const projects = useProjects();
  const live = recording?.noteId === noteId;
  const [tab, setTab] = useState<Tab>('transcript');
  const [busy, setBusy] = useState<null | 'summary' | 'retry'>(null);
  const { confirm, element: confirmEl } = useConfirm();

  // Pick a sensible tab when a note opens, and jump to the summary when it arrives.
  const seen = useRef<{ id: string; hadSummary: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const prev = seen.current;
    if (!prev || prev.id !== note.id) {
      setTab(live ? 'transcript' : note.summary ? 'summary' : 'transcript');
    } else if (!prev.hadSummary && note.summary) {
      setTab((t) => (t === 'transcript' ? 'summary' : t));
    }
    seen.current = { id: note.id, hadSummary: !!note.summary };
  }, [note, live]);

  const endRef = useFollow(segments?.length ?? 0, live && tab === 'transcript');

  if (note === undefined) return <Skeleton lines={5} />;
  if (note === null) {
    return (
      <>
        {props.back}
        <div className="empty">
          <h3>This note isn’t here any more</h3>
        </div>
      </>
    );
  }

  async function summarise() {
    setBusy('summary');
    try {
      await generateSummary(noteId);
      setTab('summary');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy('retry');
    try {
      await retryPendingChunks(noteId);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    const ok = await confirm({
      title: 'Discard the waiting audio?',
      message: `${pending} part${pending === 1 ? '' : 's'} of audio couldn’t be transcribed and ${pending === 1 ? 'is' : 'are'} taking up space. The transcript you already have is kept.`,
      confirmLabel: 'Discard audio',
      danger: true,
    });
    if (!ok) return;
    try {
      await discardAudio(noteId);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function markdown() {
    const [segs, proj, chat] = await Promise.all([
      store.getSegments(noteId),
      store.getProject(note!.projectId),
      store.getMessages(noteId),
    ]);
    return noteToMarkdown(note!, proj, segs, chat);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(await markdown());
      toast('Copied as Markdown');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this note?',
      message: `“${note!.title}” and its transcript will be permanently deleted.`,
      confirmLabel: 'Delete note',
      danger: true,
    });
    if (!ok) return;
    await store.deleteNote(noteId);
    props.onDeleted?.();
  }

  const working = busy !== null || note.status === 'processing' || note.status === 'summarizing';

  return (
    <article className={`note-view ${compact ? 'compact' : ''}`}>
      <div className="note-topbar">
        <div>{props.back}</div>
        <div className="note-actions">
          {props.onOpenFull && (
            <button className="icon-btn" onClick={props.onOpenFull} aria-label="Open in library" title="Open in library">
              <IconExpand />
            </button>
          )}
          <button className="icon-btn" onClick={copy} aria-label="Copy as Markdown" title="Copy as Markdown">
            <IconCopy />
          </button>
          <Menu label="More actions">
            {(close) => (
              <>
                <button
                  onClick={async () => {
                    close();
                    downloadFile(`${safeFilename(note.title)}.md`, await markdown());
                  }}
                >
                  <IconDownload size={15} /> Download .md
                </button>
                <button
                  disabled={working || live || !segments?.length}
                  onClick={() => {
                    close();
                    void summarise();
                  }}
                >
                  <IconSparkle size={15} /> {note.summary ? 'Regenerate study notes' : 'Write study notes'}
                </button>
                <hr />
                <button
                  className="danger"
                  disabled={live}
                  onClick={() => {
                    close();
                    void remove();
                  }}
                >
                  <IconTrash size={15} /> {live ? 'Stop recording to delete' : 'Delete note'}
                </button>
              </>
            )}
          </Menu>
        </div>
      </div>
      <header className="note-head">
        <TitleField
          value={note.title}
          size={compact ? 26 : 46}
          onCommit={(title) => store.updateNote(noteId, { title, titleEdited: true })}
        />
        <div className="meta-row">
          <ProjectPicker note={note} projects={projects ?? []} />
          <span className="chip">{formatDate(note.createdAt)}</span>
          {note.durationMs > 0 && <span className="chip">{formatDuration(note.durationMs)}</span>}
          {note.sourceUrl && (
            <a className="chip" href={note.sourceUrl} target="_blank" rel="noreferrer" title={note.sourceUrl}>
              {hostname(note.sourceUrl) || 'Source'} <IconExternal size={12} />
            </a>
          )}
          <StatusChip note={note} live={live} paused={live && recording?.paused} />
        </div>
      </header>

      {note.error && (
        <div className="callout callout-error" style={{ marginTop: 16 }}>
          <div className="callout-body">
            <span>
              {note.error}
              {live && ' The audio is being kept. Fix the problem in Settings and it will be sent automatically.'}
            </span>
            {!live && (pending > 0 || (segments?.length ?? 0) > 0) && (
              <div className="callout-actions">
                {pending > 0 ? (
                  <>
                    <button className="btn btn-sm btn-light" onClick={retry} disabled={working}>
                      <IconRefresh size={14} /> {busy === 'retry' ? 'Retrying…' : 'Retry transcription'}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={discard} disabled={working}>
                      Discard audio
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm btn-light" onClick={summarise} disabled={working}>
                    <IconSparkle size={14} /> {note.summary ? 'Try again' : 'Write study notes'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="note-toolbar" style={{ marginTop: 20 }}>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'summary'} onClick={() => setTab('summary')}>
            Summary
          </button>
          <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>
            Transcript
          </button>
          <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>
            My notes{note.myNotes.trim() ? <span className="dot" style={{ width: 5, height: 5, background: 'var(--lime)' }} /> : null}
          </button>
          <button role="tab" aria-selected={tab === 'ask'} onClick={() => setTab('ask')}>
            Ask
          </button>
        </div>
      </div>

      <div className="note-body" role="tabpanel">
        {tab === 'summary' && (
          <SummaryPanel note={note} segments={segments} live={live} busy={busy === 'summary'} onGenerate={summarise} />
        )}
        {tab === 'transcript' && (
          <TranscriptPanel
            note={note}
            segments={segments}
            live={live}
            paused={!!recording?.paused}
            pending={pending}
          />
        )}
        {tab === 'notes' && <MyNotes key={note.id} note={note} />}
        {tab === 'ask' && segments && (
          <ChatPanel note={note} project={projects?.find((p) => p.id === note.projectId)} segments={segments} />
        )}
        <div ref={endRef} />
      </div>
      {confirmEl}
    </article>
  );
}

function ProjectPicker({ note, projects }: { note: Note; projects: Project[] }) {
  return (
    <Select
      variant="chip"
      ariaLabel="Move to project"
      title="Move to another project"
      value={note.projectId}
      options={projects.map((p) => ({ value: p.id, label: p.name, dot: p.color }))}
      onChange={(projectId) => void store.updateNote(note.id, { projectId })}
    />
  );
}

function SummaryPanel(props: {
  note: Note;
  segments: Segment[] | undefined;
  live: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  const { note, live } = props;
  if (props.busy || note.status === 'summarizing') {
    return (
      <div style={{ display: 'grid', gap: 18 }}>
        <div className="row faint" style={{ fontSize: 13 }}>
          <span className="spinner" /> Writing your study notes…
        </div>
        <Skeleton lines={7} />
      </div>
    );
  }
  if (note.summary) {
    return (
      <>
        <Markdown text={note.summary} />
        <div className="summary-foot">
          <span>
            Written by {note.summaryModel ?? 'AI'}
            {note.summaryAt ? ` · ${timeAgo(note.summaryAt)}` : ''}
          </span>
          {!live && (
            <button className="btn btn-sm" onClick={props.onGenerate}>
              <IconRefresh size={13} /> Regenerate
            </button>
          )}
        </div>
      </>
    );
  }
  if (live) {
    return note.autoSummary === false ? (
      <Empty
        title="AI study notes are off"
        text="Only the transcript is being saved for this recording. Switch “AI study notes when I stop” on above, or write notes later from here."
      />
    ) : (
      <Empty
        title="Notes arrive after the lecture"
        text="Keep watching. When you stop recording, the transcript is turned into study notes here."
      />
    );
  }
  if (props.segments?.length) {
    return (
      <Empty
        title="No study notes yet"
        text="Turn the transcript into a summary, key concepts and self-test questions. Uses your OpenAI credits (usually under 1¢)."
        action={
          <button className="btn btn-primary" onClick={props.onGenerate}>
            <IconSparkle size={15} /> Write study notes
          </button>
        }
      />
    );
  }
  if (note.status === 'processing') return <Empty title="Almost there" text="The last part of the audio is still being transcribed." />;
  return <Empty title="Nothing to summarise" text="No speech was picked up in this recording." />;
}

function TranscriptPanel(props: {
  note: Note;
  segments: Segment[] | undefined;
  live: boolean;
  paused: boolean;
  pending: number;
}) {
  const { segments, live, pending } = props;
  if (!segments) return <Skeleton lines={4} />;
  const transcribing = !live && pending > 0 && (props.note.status === 'processing' || props.note.status === 'recording');
  return (
    <div className="transcript">
      {segments.map((s) => (
        <div className="seg-row" key={s.index}>
          <span className="ts">{formatClock(s.startMs)}</span>
          <div className="text">{s.text}</div>
        </div>
      ))}
      {live && (
        <div className="listening" style={segments.length ? undefined : { paddingLeft: 0 }}>
          {props.paused ? (
            <span>Paused. Resume to keep transcribing.</span>
          ) : (
            <>
              <LevelBars count={12} height={16} />
              <span>
                {segments.length
                  ? 'Listening… new lines every 15–30 seconds'
                  : 'Listening… the first lines appear after about 20 seconds'}
              </span>
            </>
          )}
        </div>
      )}
      {transcribing && (
        <div className="listening">
          <span className="spinner" /> Transcribing the last part…
        </div>
      )}
      {!live && !transcribing && !segments.length && (
        <Empty
          title="No transcript"
          text={pending ? 'Some audio is waiting to be transcribed.' : 'No speech was picked up in this recording.'}
        />
      )}
    </div>
  );
}

function MyNotes({ note }: { note: Note }) {
  const [text, setText] = useState(note.myNotes);
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { schedule, flush, isPending } = useDebouncedSave<string>((value) => {
    store.updateNote(note.id, { myNotes: value }).catch((e) => toast(errorMessage(e), 'error'));
  });

  useEffect(() => {
    if (!focused.current && !isPending()) setText(note.myNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when the stored text changes
  }, [note.myNotes]);

  useAutosize(ref, text, 220);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <textarea
        ref={ref}
        className="my-notes"
        placeholder="Jot down anything while you watch. These notes are kept with the lecture and the AI makes sure your points are covered when it writes the summary."
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
      />
    </div>
  );
}

function TitleField({ value, size, onCommit }: { value: string; size: number; onCommit: (title: string) => void }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  useAutosize(ref, `${text}|${size}`, 0);

  return (
    <textarea
      ref={ref}
      className="note-title-input"
      rows={1}
      aria-label="Note title"
      style={{ fontSize: size }}
      value={text}
      onFocus={() => {
        focused.current = true;
        cancelled.current = false;
      }}
      onBlur={() => {
        focused.current = false;
        const title = text.replace(/\s+/g, ' ').trim();
        if (!cancelled.current && title && title !== value) onCommit(title);
        else setText(value);
      }}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ''))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Grows a textarea to fit its content (and re-measures on resize). */
function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, content: string, minHeight: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '0px';
      el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref, content, minHeight]);
}

/** Keeps the newest transcript line in view while recording, unless the user scrolled up. */
function useFollow(count: number, enabled: boolean) {
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastCount = useRef(count);

  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement;
      if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (enabled && grew && nearBottom.current) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [count, enabled]);

  return endRef;
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} style={{ width: `${[92, 78, 85, 64, 88, 72, 50][i % 7]}%` }} />
      ))}
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export { Empty, Skeleton };
