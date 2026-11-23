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
  /** Language for this project's study notes ('spoken', a language code, or '' for the default from Settings). */
  notesLanguage?: string;
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
  /**
   * Write AI study notes automatically when this recording ends. Set from the
   * default when recording starts and switchable while recording. Undefined
   * (older notes) falls back to the setting.
   */
  autoSummary?: boolean;
  /** What the Ask tab sends as the lecture: the full transcript (default) or only the study notes (cheaper). */
  askContext?: 'transcript' | 'notes';
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

/** One turn of the "Ask" conversation about a lecture. */
export interface ChatMessage {
  noteId: string;
  /** Order in the conversation. A compaction sits at x.5, right after the last message it covers. */
  index: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  model?: string;
  /** The answer was cut short with Stop. */
  stopped?: boolean;
  /** The answer started pasting the transcript; that part was cut off. */
  trimmed?: boolean;
  /** The request failed; content is empty and this explains why. */
  error?: string;
  /** Real token usage reported by OpenAI for the request that produced this answer. */
  usage?: TokenUsage;
  /** Characters sent in that request; with usage.prompt it calibrates later estimates. */
  promptChars?: number;
  /**
   * 'compaction': content is a summary that replaces every earlier message in
   * what's sent to the model (the originals stay saved and readable).
   */
  kind?: 'compaction';
  /** For a compaction: how many messages it summarises in total. */
  covers?: number;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  /** Prompt tokens served from OpenAI's cache (billed at a discount). */
  cached: number;
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
  /** Language to write study notes in: 'spoken' (the lecture's own) or a language code. */
  notesLanguage: string;
  /** Default for new recordings: write AI study notes when the recording stops. */
  autoSummarize: boolean;
  /** Start a new note when the recorded tab navigates to a different page. */
  autoSplit: boolean;
  summaryPrompt: string;
  /** Where to follow a live recording; remembers the last view used. */
  recordingView: RecordingView;
  /** Summarise older Ask messages automatically once they no longer fit what's sent. */
  autoCompact: boolean;
  /** Colour theme; 'system' follows the operating system. */
  theme: ThemePreference;
  lastProjectId?: string;
}

/** 'panel' = Chrome side panel, 'mini' = floating mini player on the recorded page. */
export type RecordingView = 'panel' | 'mini';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface RecordingState {
  noteId: string;
  /** Nothing has been heard from the tab for a while (video paused or muted?). */
  quiet?: boolean;
  projectId: string;
  tabId: number;
  pageKey: string;
  paused: boolean;
  /** Recorded time before the current uninterrupted stretch. */
  elapsedMs: number;
  /** Epoch ms when the current stretch started, or null while paused. */
  runningSince: number | null;
}
