import { useCallback, useState, type ReactNode } from 'react';
import { formatDate, formatDuration } from '../../lib/format';
import type { Note, Project } from '../../lib/types';
import { useDismiss, useLevels } from '../hooks';
import { IconMore } from '../icons';
import { summaryPreview } from '../Markdown';

export function StatusChip({ note, live, paused }: { note: Note; live?: boolean; paused?: boolean }) {
  if (live) {
    return (
      <span className={`chip ${paused ? '' : 'chip-red'}`}>
        <span className={`rec-dot ${paused ? 'paused' : ''}`} /> {paused ? 'Paused' : 'Recording'}
      </span>
    );
  }
  switch (note.status) {
    case 'recording':
    case 'processing':
      return (
        <span className="chip chip-busy">
          <span className="spinner" /> Transcribing
        </span>
      );
    case 'summarizing':
      return (
        <span className="chip chip-busy">
          <span className="spinner" /> Writing notes
        </span>
      );
    case 'interrupted':
      return <span className="chip chip-amber">Interrupted</span>;
    case 'error':
      return <span className="chip chip-red">Needs attention</span>;
    default:
      return null;
  }
}

export function LevelBars({ count = 18, height = 22 }: { count?: number; height?: number }) {
  const levels = useLevels(count);
  return (
    <div className="level" style={{ height }} aria-hidden="true">
      {levels.map((l, i) => (
        <span key={i} style={{ height: Math.max(3, Math.min(1, Math.pow(l * 9, 0.7)) * height) }} />
      ))}
    </div>
  );
}

export function ProjectDot({ project, size = 8 }: { project?: Project; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, background: project?.color ?? 'var(--text-3)' }} />;
}

export function NoteRow(props: {
  note: Note;
  project?: Project;
  showProject?: boolean;
  liveNoteId?: string;
  onOpen: () => void;
}) {
  const { note } = props;
  const preview = summaryPreview(note.summary);
  const live = props.liveNoteId === note.id;
  return (
    <button className="note-row" onClick={props.onOpen}>
      <div className="note-row-title">
        <span className="truncate">{note.title}</span>
      </div>
      <div className="note-row-meta">
        {props.showProject && props.project && (
          <span className="row" style={{ gap: 6 }}>
            <ProjectDot project={props.project} size={6} />
            {props.project.name}
          </span>
        )}
        <span>{formatDate(note.createdAt)}</span>
        {note.durationMs > 0 && <span>· {formatDuration(note.durationMs)}</span>}
        <StatusChip note={note} live={live} />
      </div>
      {preview && <div className="note-row-preview clamp-2">{preview}</div>}
    </button>
  );
}

export function Menu({
  label,
  children,
  icon,
}: {
  label: string;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon ?? <IconMore />}
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}
