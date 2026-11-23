// Transcription and summary steps shared by the offscreen recorder (live) and
// the UI (retry / regenerate buttons).
import { encodeWav } from './audio';
import { emit } from './events';
import { errorMessage, sleep } from './format';
import { notesLanguageRule, scriptHint, transcriptionLanguages } from './languages';
import { chat, OpenAIError, transcribe } from './openai';
import * as store from './store';
import type { Note, PendingChunk, Project } from './types';

/**
 * How much of the previous lines the transcriber gets as context. Enough to keep
 * names and spelling consistent; more makes it likelier to copy the context back.
 */
const PROMPT_CONTEXT_CHARS = 200;

/** Context for the transcriber: how to write the language, then the end of what was just said. */
function transcriptionPrompt(language: string | undefined, previousText: string): string {
  const parts: string[] = [];
  const hint = scriptHint(language);
  if (hint) parts.push(hint);
  const prev = previousText.trim();
  // Passing the tail of the previous chunk keeps wording and spelling consistent.
  if (prev) parts.push(prev.slice(-PROMPT_CONTEXT_CHARS));
  return parts.join('\n');
}

/** The project's vocabulary, one keyword each. */
function keywordsOf(project: Project | undefined): string[] {
  return (project?.vocabulary ?? '').split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Sends one second of silence with these settings, so Settings can say
 * straight away whether OpenAI accepts the model and language (costs a
 * fraction of a cent). Throws OpenAI's message if not.
 */
export async function testTranscription(apiKey: string, model: string, language: string): Promise<void> {
  await transcribe({
    apiKey,
    model,
    audio: encodeWav([new Int16Array(16_000)], 16_000, 16_000),
    languages: transcriptionLanguages(language),
    prompt: scriptHint(language),
  });
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
  const language = project?.language || settings.language || undefined;
  const text = await transcribe({
    apiKey: settings.apiKey,
    model: settings.transcribeModel,
    audio: chunk.audio,
    languages: transcriptionLanguages(language),
    keywords: keywordsOf(project),
    prompt: transcriptionPrompt(language, previousText),
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
 * Gives up on audio that couldn't be transcribed (for one note, or all notes
 * except the live recording). Whatever transcript already exists is kept.
 */
export async function discardAudio(noteId?: string): Promise<number> {
  const live = await store.getRecording();
  if (noteId && live?.noteId === noteId) throw new Error('Stop the recording first.');
  const affected = await store.discardChunks(noteId ? { noteId } : { keepNoteId: live?.noteId });
  for (const id of affected) {
    await store.updateNote(id, (n) =>
      n.status === 'error' || n.status === 'interrupted' ? { status: 'done', error: undefined } : undefined,
    );
  }
  return affected.length;
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
      // Nothing was said: don't leave an empty note behind, but say why it's gone.
      await store.deleteNote(noteId);
      emit({ type: 'toast', tone: 'info', message: `Nothing was heard in “${note.title}”, so no note was saved. Was the video playing, and not muted?` });
      return;
    }
    await store.updateNote(noteId, { status: 'done', error: undefined });
    return;
  }
  const settings = await store.getSettings();
  if (opts.autoSummarize ?? note.autoSummary ?? settings.autoSummarize) {
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
      system: `${project?.summaryPrompt.trim() || settings.summaryPrompt.trim() || store.DEFAULT_SETTINGS.summaryPrompt}\n\nLanguage: ${notesLanguageRule(project?.notesLanguage || settings.notesLanguage)}`,
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
