// Transcription and summary steps shared by the offscreen recorder (live) and
// the UI (retry / regenerate buttons).
import { errorMessage, sleep } from './format';
import { chat, OpenAIError, transcribe } from './openai';
import * as store from './store';
import type { Note, PendingChunk, Project } from './types';

const PROMPT_CONTEXT_CHARS = 500;

function transcriptionPrompt(project: Project | undefined, previousText: string): string {
  const parts: string[] = [];
  const vocab = project?.vocabulary.trim();
  if (vocab) parts.push(`Glossary: ${vocab}.`);
  const prev = previousText.trim();
  // Passing the tail of the previous chunk keeps wording and spelling consistent.
  if (prev) parts.push(prev.slice(-PROMPT_CONTEXT_CHARS));
  return parts.join('\n');
}

/** Transcribes one chunk, stores its segment and removes the audio. */
async function transcribeChunk(chunk: PendingChunk, previousText: string): Promise<string> {
  const settings = await store.getSettings();
  const note = await store.getNote(chunk.noteId);
  if (!note) {
    await store.deleteChunk(chunk.noteId, chunk.index); // note was deleted meanwhile
    return '';
  }
  const project = await store.getProject(note.projectId);
  const text = await transcribe({
    apiKey: settings.apiKey,
    model: settings.transcribeModel,
    audio: chunk.audio,
    language: project?.language || settings.language || undefined,
    prompt: transcriptionPrompt(project, previousText),
  });
  if (text) {
    await store.putSegment({
      noteId: chunk.noteId,
      index: chunk.index,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      text,
    });
  }
  await store.deleteChunk(chunk.noteId, chunk.index);
  return text;
}

export type ChunkResult = { ok: true; text: string } | { ok: false; error: string; fatal: boolean };

export async function transcribeWithRetry(
  chunk: PendingChunk,
  previousText: string,
  maxAttempts = 3,
): Promise<ChunkResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, text: await transcribeChunk(chunk, previousText) };
    } catch (e) {
      const error = errorMessage(e);
      const retryable = e instanceof OpenAIError && e.retryable;
      await store.updateChunk(chunk.noteId, chunk.index, { attempts: chunk.attempts + attempt, lastError: error });
      if (!retryable || attempt >= maxAttempts) return { ok: false, error, fatal: !retryable };
      await sleep(attempt * 4000);
    }
  }
}

async function transcriptText(noteId: string, beforeIndex = Infinity): Promise<string> {
  const segments = await store.getSegments(noteId);
  return segments
    .filter((s) => s.index < beforeIndex)
    .map((s) => s.text)
    .join(' ');
}

/** Retries audio that failed to transcribe earlier, then finalises the note. */
export async function retryPendingChunks(noteId: string): Promise<void> {
  const chunks = await store.getChunks(noteId);
  if (!chunks.length) return finalizeNote(noteId);
  await store.updateNote(noteId, { status: 'processing', error: undefined });
  for (const chunk of chunks) {
    const result = await transcribeWithRetry(chunk, await transcriptText(noteId, chunk.index), 2);
    if (!result.ok) {
      await store.updateNote(noteId, { status: 'error', error: result.error });
      if (result.fatal) return;
    }
  }
  await finalizeNote(noteId);
}

/**
 * Called once a note's audio is fully captured and its queue has drained.
 * Writes the summary (if enabled) and settles the note's status.
 */
export async function finalizeNote(
  noteId: string,
  opts: { autoSummarize?: boolean; deleteIfEmpty?: boolean } = {},
): Promise<void> {
  const note = await store.getNote(noteId);
  if (!note) return;
  const pending = await store.countChunks(noteId);
  if (pending > 0) {
    await store.updateNote(noteId, {
      status: 'error',
      error: note.error ?? `${pending} part${pending === 1 ? '' : 's'} of the audio couldn’t be transcribed.`,
    });
    return;
  }
  const text = await transcriptText(noteId);
  if (!text.trim()) {
    if (opts.deleteIfEmpty && !note.myNotes.trim()) {
      await store.deleteNote(noteId); // nothing was said: don't leave an empty note behind
      return;
    }
    await store.updateNote(noteId, { status: 'done', error: undefined });
    return;
  }
  const settings = await store.getSettings();
  if (opts.autoSummarize ?? settings.autoSummarize) {
    try {
      await generateSummary(noteId);
    } catch {
      // generateSummary already recorded the error on the note.
    }
  } else {
    await store.updateNote(noteId, { status: 'done', error: undefined });
  }
}

function userMessage(note: Note, project: Project | undefined, transcript: string): string {
  const lines = [`Lecture title: ${note.title}`];
  if (project && project.id !== store.INBOX_ID) {
    lines.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
  }
  if (note.sourceUrl) lines.push(`Source: ${note.sourceUrl}`);
  if (note.myNotes.trim()) {
    lines.push('', 'My own notes, written while watching (make sure these points are covered):', note.myNotes.trim());
  }
  lines.push('', 'Transcript:', '"""', transcript, '"""');
  return lines.join('\n');
}

export async function generateSummary(noteId: string): Promise<void> {
  const note = await store.getNote(noteId);
  if (!note) throw new Error('Note not found.');
  const transcript = (await store.getSegments(noteId)).map((s) => s.text).join('\n\n');
  if (!transcript.trim()) throw new Error('There’s no transcript to summarise yet.');
  const project = await store.getProject(note.projectId);
  const settings = await store.getSettings();

  await store.updateNote(noteId, { status: 'summarizing', error: undefined });
  try {
    const summary = await chat({
      apiKey: settings.apiKey,
      model: settings.summaryModel,
      system: project?.summaryPrompt.trim() || settings.summaryPrompt.trim() || store.DEFAULT_SETTINGS.summaryPrompt,
      user: userMessage(note, project, transcript),
    });
    await store.updateNote(noteId, {
      status: 'done',
      error: undefined,
      summary,
      summaryModel: settings.summaryModel,
      summaryAt: Date.now(),
    });
  } catch (e) {
    await store.updateNote(noteId, { status: 'error', error: `Summary failed: ${errorMessage(e)}` });
    throw e;
  }
}
