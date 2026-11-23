// "Ask" conversations about one lecture. Each request sends the instructions
// and the lecture (study notes, the user's notes, timestamped transcript) first,
// then the conversation so far. Keeping that prefix identical across follow-up
// questions lets OpenAI's automatic prompt caching bill it at a discount.
import { errorMessage, formatClock } from './format';
import { chatStream, type ChatTurn } from './openai';
import * as store from './store';
import type { ChatMessage, Note, Project, Segment } from './types';

/** ~30k tokens. Longer lectures keep their beginning and end. */
const MAX_TRANSCRIPT_CHARS = 120_000;
/** Earlier turns beyond this are left out of the request (they stay saved). */
const MAX_HISTORY_MESSAGES = 24;

const INSTRUCTIONS = `You are TORU, a study assistant. The user recorded a lecture and is asking about it.

- Answer from the lecture first: its transcript, the study notes and the user's own notes below.
- When you point to a part of the lecture, cite its time like [12:34].
- If the lecture doesn't cover something, say so in one short sentence, then answer from general knowledge in a paragraph that starts with "Beyond the lecture:".
- Be concise and clear. Use Markdown: short paragraphs, bullet lists, **bold** key terms. No preamble.
- If asked to quiz the user, ask one question at a time, wait for their answer, then give brief feedback and the next question.
- Reply in the language the user writes in.`;

export const SUGGESTED_QUESTIONS = [
  'Explain the main idea simply',
  'What should I remember for the exam?',
  'Quiz me, one question at a time',
  'Give me a real-world example',
];

function lectureContext(note: Note, project: Project | undefined, segments: Segment[]): string {
  const lines = [`# Lecture: ${note.title}`];
  if (project && project.id !== store.INBOX_ID) {
    lines.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
  }
  if (note.summary?.trim()) lines.push('', '## Study notes', note.summary.trim());
  if (note.myNotes.trim()) lines.push('', '## The user’s own notes', note.myNotes.trim());
  let transcript = segments.map((s) => `[${formatClock(s.startMs)}] ${s.text}`).join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    const half = MAX_TRANSCRIPT_CHARS / 2;
    transcript = `${transcript.slice(0, half)}\n[… the middle of the transcript is left out for length …]\n${transcript.slice(-half)}`;
  }
  lines.push('', '## Transcript', transcript || '(nothing transcribed yet)');
  return lines.join('\n');
}

/**
 * Answers the latest question in a note's conversation. Pass `question` to add
 * a new one; omit it to answer the last unanswered question again.
 */
export async function answer(opts: {
  noteId: string;
  question?: string;
  signal: AbortSignal;
  onText: (textSoFar: string) => void;
}): Promise<void> {
  const { noteId } = opts;
  const [note, segments, settings] = await Promise.all([
    store.getNote(noteId),
    store.getSegments(noteId),
    store.getSettings(),
  ]);
  if (!note) throw new Error('This note no longer exists.');
  const project = await store.getProject(note.projectId);

  let history = await store.getMessages(noteId);
  if (opts.question) {
    const question: ChatMessage = {
      noteId,
      index: (history.at(-1)?.index ?? -1) + 1,
      role: 'user',
      content: opts.question,
      createdAt: Date.now(),
    };
    await store.putMessage(question);
    history = [...history, question];
  }
  const nextIndex = (history.at(-1)?.index ?? -1) + 1;

  const turns: ChatTurn[] = history
    .filter((m) => !m.error && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  const messages: ChatTurn[] = [{ role: 'system', content: `${INSTRUCTIONS}\n\n${lectureContext(note, project, segments)}` }, ...turns];

  let text = '';
  try {
    text = await chatStream({
      apiKey: settings.apiKey,
      model: settings.summaryModel,
      messages,
      signal: opts.signal,
      onText: (t) => {
        text = t;
        opts.onText(t);
      },
    });
    await store.putMessage({ noteId, index: nextIndex, role: 'assistant', content: text, createdAt: Date.now(), model: settings.summaryModel });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    if (aborted && !text) return; // stopped before anything arrived: the question stays unanswered
    await store.putMessage({
      noteId,
      index: nextIndex,
      role: 'assistant',
      content: aborted ? text : '',
      createdAt: Date.now(),
      model: settings.summaryModel,
      ...(aborted ? { stopped: true } : { error: errorMessage(e) }),
    });
  }
}

/** Removes a failed or stopped answer at the end so the last question can be asked again. */
export async function dropTrailingAnswer(noteId: string): Promise<void> {
  const messages = await store.getMessages(noteId);
  const last = messages.at(-1);
  if (last?.role === 'assistant' && (last.error || last.stopped)) await store.deleteMessages(noteId, last.index);
}
