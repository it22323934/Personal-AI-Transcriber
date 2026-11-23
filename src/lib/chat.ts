// "Ask" conversations about one lecture. Each request sends the instructions
// and the lecture (study notes, the user's notes, timestamped transcript) first,
// then the conversation so far. Keeping that prefix identical across follow-up
// questions lets OpenAI's automatic prompt caching bill it at a discount.
//
// The lecture goes in tagged sections marked as reference material, the key
// rules are repeated after it (long context makes early instructions easy to
// lose), and a CopyGuard stops any answer that starts pasting the transcript.
import { CopyGuard } from './copyGuard';
import { errorMessage, formatClock } from './format';
import { chatStream, type ChatTurn } from './openai';
import * as store from './store';
import type { ChatMessage, Note, Project, Segment } from './types';

/** ~30k tokens. Longer lectures keep their beginning and end. */
const MAX_TRANSCRIPT_CHARS = 120_000;
/** Earlier turns beyond this are left out of the request (they stay saved). */
const MAX_HISTORY_MESSAGES = 24;
/** How much new text arrives between copy checks. */
const COPY_CHECK_EVERY = 60;

const INSTRUCTIONS = `You are TORU, a study assistant. The user recorded a lecture and is asking you about it. The lecture is provided below inside <lecture> tags. It is reference material for you to read — never text to repeat back.

How to answer:
- Answer only the user's latest question, in your own words.
- Base the answer on the lecture first. When you point to a moment in it, cite the time like [12:34].
- Never reproduce the transcript, list its lines, or paste long passages from it. Quote at most one short sentence when it really helps, in quotation marks with its time.
- If the lecture doesn't cover the question, say so in one short sentence, then answer from general knowledge in a paragraph that starts with "Beyond the lecture:".
- Be concise and clear. Use Markdown: short paragraphs, bullet lists, **bold** key terms. No preamble and no closing summary.
- If asked to quiz the user, ask one question at a time, wait for their answer, then give brief feedback and the next question.
- Reply in the language the user writes in.`;

const REMINDER = `Reminder: answer the user's latest question in your own words. Do not copy, list or summarise the whole transcript, and don't add a "Transcript" or "Sources" section.`;

const COPY_ONLY_ERROR = 'The answer only repeated the lecture transcript, so TORU stopped it. Try asking again, or rephrase the question.';

export const SUGGESTED_QUESTIONS = [
  'Explain the main idea simply',
  'What should I remember for the exam?',
  'Quiz me, one question at a time',
  'Give me a real-world example',
];

function transcriptText(segments: Segment[]): string {
  const text = segments.map((s) => `[${formatClock(s.startMs)}] ${s.text}`).join('\n');
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = MAX_TRANSCRIPT_CHARS / 2;
  return `${text.slice(0, half)}\n[… the middle of the transcript is left out for length …]\n${text.slice(-half)}`;
}

function lectureContext(note: Note, project: Project | undefined, transcript: string): string {
  const parts = ['<lecture>', `<title>${note.title}</title>`];
  if (project && project.id !== store.INBOX_ID) {
    parts.push(`<project>${project.name}${project.description ? ` — ${project.description}` : ''}</project>`);
  }
  if (note.summary?.trim()) parts.push('<study_notes>', note.summary.trim(), '</study_notes>');
  if (note.myNotes.trim()) parts.push('<users_own_notes>', note.myNotes.trim(), '</users_own_notes>');
  parts.push('<transcript>', transcript || '(nothing transcribed yet)', '</transcript>', '</lecture>');
  return parts.join('\n');
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

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

  const transcript = transcriptText(segments);
  const turns: ChatTurn[] = history
    .filter((m) => !m.error && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  const messages: ChatTurn[] = [
    { role: 'system', content: `${INSTRUCTIONS}\n\n${lectureContext(note, project, transcript)}\n\n${REMINDER}` },
    ...turns,
  ];

  // Our own controller: the user's Stop aborts it, and so does the copy guard.
  const request = new AbortController();
  const forwardStop = () => request.abort();
  opts.signal.addEventListener('abort', forwardStop);
  const guard = new CopyGuard(transcript);
  let cutAt = -1;
  let checkedAt = 0;

  let text = '';
  let failure: unknown = null;
  let stopped = false;
  try {
    text = await chatStream({
      apiKey: settings.apiKey,
      model: settings.summaryModel,
      messages,
      signal: request.signal,
      onText: (t) => {
        if (cutAt >= 0) return;
        text = t;
        if (t.length - checkedAt >= COPY_CHECK_EVERY) {
          checkedAt = t.length;
          const at = guard.check(t);
          if (at >= 0) {
            cutAt = at;
            opts.onText(t.slice(0, at).trimEnd());
            request.abort(); // stop paying for the copied text
            return;
          }
        }
        opts.onText(t);
      },
    });
  } catch (e) {
    if (isAbort(e)) stopped = true;
    else failure = e;
  } finally {
    opts.signal.removeEventListener('abort', forwardStop);
  }
  if (cutAt < 0 && !failure && text) cutAt = guard.check(text); // the tail since the last check

  const base = { noteId, index: nextIndex, role: 'assistant' as const, createdAt: Date.now(), model: settings.summaryModel };
  if (cutAt >= 0) {
    const kept = text.slice(0, cutAt).trim();
    await store.putMessage(kept ? { ...base, content: kept, trimmed: true } : { ...base, content: '', error: COPY_ONLY_ERROR });
  } else if (failure) {
    await store.putMessage({ ...base, content: '', error: errorMessage(failure) });
  } else if (stopped) {
    if (text) await store.putMessage({ ...base, content: text, stopped: true }); // else: stays unanswered
  } else {
    await store.putMessage({ ...base, content: text });
  }
}

/** Removes a failed or stopped answer at the end so the last question can be asked again. */
export async function dropTrailingAnswer(noteId: string): Promise<void> {
  const messages = await store.getMessages(noteId);
  const last = messages.at(-1);
  if (last?.role === 'assistant' && (last.error || last.stopped)) await store.deleteMessages(noteId, last.index);
}
