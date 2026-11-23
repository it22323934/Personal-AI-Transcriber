export type NoteStatus =
  | 'recording' // audio is being captured into this note
  | 'processing' // capture finished, remaining audio is being transcribed
  | 'summarizing' // the AI summary is being written
  | 'done'
  | 'interrupted' // the recorder went away mid-recording (browser closed, extension reloaded)
  | 'error';

export interface Project {
  id: string;
  name: string;
  description: string;
  /** Comma-separated terms the transcriber should spell correctly. */
  vocabulary: string;
  /** ISO-639-1 code, or '' to use the default from Settings. */
  language: string;
  /** Overrides the default summary prompt when non-empty. */
  summaryPrompt: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  projectId: string;
  title: string;
  /** True once the user renamed the note, so automatic renames stop. */
  titleEdited?: boolean;
  sourceUrl: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  status: NoteStatus;
  error?: string;
  summary?: string;
  summaryModel?: string;
  summaryAt?: number;
  myNotes: string;
}

/** One transcribed slice of audio (roughly 15–30 seconds). */
export interface Segment {
  noteId: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** Audio waiting to be transcribed. Deleted once its segment is stored. */
export interface PendingChunk {
  noteId: string;
  index: number;
  startMs: number;
  endMs: number;
  audio: Blob;
  attempts: number;
  lastError?: string;
}

export interface Settings {
  apiKey: string;
  transcribeModel: string;
  summaryModel: string;
  /** ISO-639-1 code, or '' for auto-detect. */
  language: string;
  autoSummarize: boolean;
  /** Start a new note when the recorded tab navigates to a different page. */
  autoSplit: boolean;
  summaryPrompt: string;
  lastProjectId?: string;
}

export interface RecordingState {
  noteId: string;
  projectId: string;
  tabId: number;
  pageKey: string;
  paused: boolean;
  /** Recorded time before the current uninterrupted stretch. */
  elapsedMs: number;
  /** Epoch ms when the current stretch started, or null while paused. */
  runningSince: number | null;
}
