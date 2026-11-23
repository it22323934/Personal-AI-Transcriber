// Typed data access for the whole app. Every write emits a change event so
// open views in other extension contexts refresh themselves.
import * as db from './db';
import { emit } from './events';
import { DEFAULT_SUMMARY_PROMPT } from './prompts';
import type { Note, PendingChunk, Project, RecordingState, Segment, Settings } from './types';

export const INBOX_ID = 'inbox';

export const PROJECT_COLORS = ['#c9dc4c', '#7cc4e8', '#f0a07c', '#b9a3f0', '#e8c46a', '#7fd6b4', '#ee93b8'];

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  transcribeModel: 'gpt-4o-mini-transcribe',
  summaryModel: 'gpt-5-mini',
  language: '',
  autoSummarize: true,
  autoSplit: true,
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
};

interface MetaRow<T> {
  key: string;
  value: T;
}

export function uid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  const row = await db.get<MetaRow<Partial<Settings>>>('meta', 'settings');
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const row = await db.mutate<MetaRow<Partial<Settings>>>('meta', 'settings', (cur) => ({
    key: 'settings',
    value: { ...(cur?.value ?? {}), ...patch },
  }));
  emit({ type: 'settings' });
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

// --------------------------------------------------------------- recording

export async function getRecording(): Promise<RecordingState | null> {
  const row = await db.get<MetaRow<RecordingState>>('meta', 'recording');
  return row?.value ?? null;
}

export async function setRecording(state: RecordingState | null): Promise<void> {
  if (state) await db.put<MetaRow<RecordingState>>('meta', { key: 'recording', value: state });
  else await db.del('meta', 'recording');
  emit({ type: 'recording' });
}

// ------------------------------------------------------------------- flash

/**
 * A one-off message for the side panel, for errors that happen while it may
 * not be open yet (e.g. the keyboard shortcut failed).
 */
export async function setFlash(message: string): Promise<void> {
  await db.put<MetaRow<{ message: string; at: number }>>('meta', { key: 'flash', value: { message, at: Date.now() } });
  emit({ type: 'toast', tone: 'error', message });
}

export async function takeFlash(): Promise<string | null> {
  const row = await db.get<MetaRow<{ message: string; at: number }>>('meta', 'flash');
  if (!row) return null;
  await db.del('meta', 'flash');
  return Date.now() - row.value.at < 20_000 ? row.value.message : null;
}

// ---------------------------------------------------------------- projects

function sortProjects(projects: Project[]): Project[] {
  return projects.sort((a, b) => {
    if (a.id === INBOX_ID) return -1;
    if (b.id === INBOX_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export async function listProjects(): Promise<Project[]> {
  return sortProjects(await db.getAll<Project>('projects'));
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.get<Project>('projects', id);
}

export async function ensureInbox(): Promise<Project> {
  const existing = await getProject(INBOX_ID);
  if (existing) return existing;
  const now = Date.now();
  const inbox: Project = {
    id: INBOX_ID,
    name: 'Inbox',
    description: 'Recordings that aren’t filed in a project yet.',
    vocabulary: '',
    language: '',
    summaryPrompt: '',
    color: '#a3a194',
    createdAt: now,
    updatedAt: now,
  };
  await db.put('projects', inbox);
  emit({ type: 'projects' });
  return inbox;
}

export async function createProject(input: Partial<Project> & { name: string }): Promise<Project> {
  const now = Date.now();
  const count = (await db.getAll<Project>('projects')).length;
  const project: Project = {
    description: '',
    vocabulary: '',
    language: '',
    summaryPrompt: '',
    color: PROJECT_COLORS[count % PROJECT_COLORS.length],
    ...input,
    id: uid(),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('projects', project);
  emit({ type: 'projects' });
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.mutate<Project>('projects', id, (cur) => (cur ? { ...cur, ...patch, id, updatedAt: Date.now() } : undefined));
  emit({ type: 'projects' });
}

/** Deletes a project; its notes move to the Inbox. */
export async function deleteProject(id: string): Promise<void> {
  if (id === INBOX_ID) throw new Error('The Inbox can’t be deleted.');
  await ensureInbox();
  const notes = await db.getAllByIndex<Note>('notes', 'projectId', id);
  await db.putMany(
    'notes',
    notes.map((n) => ({ ...n, projectId: INBOX_ID, updatedAt: Date.now() })),
  );
  await db.del('projects', id);
  emit({ type: 'projects' });
  emit({ type: 'notes' });
}

// ------------------------------------------------------------------- notes

const byNewest = (a: Note, b: Note) => b.createdAt - a.createdAt;

export async function listNotes(projectId?: string): Promise<Note[]> {
  const notes = projectId
    ? await db.getAllByIndex<Note>('notes', 'projectId', projectId)
    : await db.getAll<Note>('notes');
  return notes.sort(byNewest);
}

export async function getNote(id: string): Promise<Note | undefined> {
  return db.get<Note>('notes', id);
}

export async function createNote(input: Pick<Note, 'projectId' | 'title' | 'sourceUrl' | 'status'>): Promise<Note> {
  const now = Date.now();
  const note: Note = { ...input, id: uid(), createdAt: now, updatedAt: now, durationMs: 0, myNotes: '' };
  await db.put('notes', note);
  emit({ type: 'notes', noteId: note.id });
  return note;
}

/**
 * Applies a patch atomically. A function patch receives the current note and
 * may return undefined to skip the write.
 */
export async function updateNote(
  id: string,
  patch: Partial<Note> | ((note: Note) => Partial<Note> | undefined),
): Promise<Note | undefined> {
  const updated = await db.mutate<Note>('notes', id, (cur) => {
    if (!cur) return undefined;
    const p = typeof patch === 'function' ? patch(cur) : patch;
    if (!p) return undefined;
    return { ...cur, ...p, id, updatedAt: Date.now() };
  });
  if (updated) emit({ type: 'notes', noteId: id });
  return updated;
}

export async function deleteNote(id: string): Promise<void> {
  await db.deleteByIndex('segments', 'noteId', id);
  await db.deleteByIndex('chunks', 'noteId', id);
  await db.del('notes', id);
  emit({ type: 'notes', noteId: id });
}

// ---------------------------------------------------------------- segments

export async function getSegments(noteId: string): Promise<Segment[]> {
  const segs = await db.getAllByIndex<Segment>('segments', 'noteId', noteId);
  return segs.sort((a, b) => a.index - b.index);
}

export async function getAllSegments(): Promise<Segment[]> {
  return db.getAll<Segment>('segments');
}

export async function putSegment(segment: Segment): Promise<void> {
  await db.put('segments', segment);
  emit({ type: 'segments', noteId: segment.noteId });
}

// ------------------------------------------------------------------ chunks

export async function addChunk(chunk: PendingChunk): Promise<void> {
  await db.put('chunks', chunk);
  emit({ type: 'chunks', noteId: chunk.noteId });
}

export async function getChunks(noteId: string): Promise<PendingChunk[]> {
  const chunks = await db.getAllByIndex<PendingChunk>('chunks', 'noteId', noteId);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function countChunks(noteId: string): Promise<number> {
  return db.countByIndex('chunks', 'noteId', noteId);
}

export async function updateChunk(noteId: string, index: number, patch: Partial<PendingChunk>): Promise<void> {
  await db.mutate<PendingChunk>('chunks', [noteId, index], (cur) => (cur ? { ...cur, ...patch } : undefined));
}

export async function deleteChunk(noteId: string, index: number): Promise<void> {
  await db.del('chunks', [noteId, index]);
  emit({ type: 'chunks', noteId });
}

// ------------------------------------------------------------------ backup

export interface Backup {
  app: 'toru';
  version: 1;
  exportedAt: number;
  settings: Partial<Settings>;
  projects: Project[];
  notes: Note[];
  segments: Segment[];
}

export async function exportBackup(): Promise<Backup> {
  const { apiKey: _omit, ...settings } = await getSettings();
  return {
    app: 'toru',
    version: 1,
    exportedAt: Date.now(),
    settings,
    projects: await db.getAll<Project>('projects'),
    notes: await db.getAll<Note>('notes'),
    segments: await db.getAll<Segment>('segments'),
  };
}

/** Merges a backup into the current data. Records with the same id are replaced. */
export async function importBackup(data: unknown): Promise<{ projects: number; notes: number }> {
  const b = data as Partial<Backup>;
  if (!b || b.app !== 'toru' || !Array.isArray(b.projects) || !Array.isArray(b.notes)) {
    throw new Error('That file isn’t a TORU backup.');
  }
  // Recordings that were in flight when the backup was made can't resume.
  const notes = b.notes.map((n) =>
    n.status === 'done' || n.status === 'error' ? n : { ...n, status: 'interrupted' as const },
  );
  await db.putMany('projects', b.projects);
  await db.putMany('notes', notes);
  await db.putMany('segments', Array.isArray(b.segments) ? b.segments : []);
  if (b.settings) {
    const { apiKey: _omit, ...rest } = b.settings;
    await saveSettings(rest);
  }
  emit({ type: 'projects' });
  emit({ type: 'notes' });
  return { projects: b.projects.length, notes: notes.length };
}
