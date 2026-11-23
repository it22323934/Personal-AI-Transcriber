// "Ask" conversations about one lecture.
//
// Every request is planned by planAsk(), which the UI also uses for its
// context meter, so the meter shows exactly what will be sent:
//   1. instructions + the lecture (tagged, marked as reference material) +
//      a reminder — identical across follow-ups, so OpenAI's prompt caching
//      bills it at a discount;
//   2. the latest compaction summary, if the conversation was compacted;
//   3. as many recent messages as fit the history budget.
// Older messages that no longer fit are counted, so the UI can say so and
// offer to compact them, instead of silently forgetting them.
import { CopyGuard } from './copyGuard';
import { errorMessage, formatClock } from './format';
import { DEFAULT_TOKENS_PER_CHAR, estimateTokens, inputLimit, modelLimits } from './models';
import { chatComplete, chatStream, type ChatTurn } from './openai';
import * as store from './store';
import type { ChatMessage, Note, Project, Segment } from './types';

/** The transcript may use up to this share of the model's input limit… */
const TRANSCRIPT_SHARE = 0.5;
/** …but never more than this, to keep each question affordable (~6 hours of lecture). */
const TRANSCRIPT_MAX_TOKENS = 100_000;
/** Conversation history sent per question, for cost (older turns are summarised by compaction). */
const HISTORY_MAX_TOKENS = 24_000;
/** Never plan a request above this share of the input limit. */
const TOTAL_SHARE = 0.85;
/** Compaction keeps this many of the newest messages word for word. */
export const KEEP_RECENT = 4;
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

const NOTES_ONLY_NOTE = `The full transcript is not included in this conversation to save tokens. Answer from the study notes and the user's notes; you can't cite times.`;

const COPY_ONLY_ERROR = 'The answer only repeated the lecture transcript, so TORU stopped it. Try asking again, or rephrase the question.';

const COMPACT_INSTRUCTIONS = `You compress a study conversation between a user and TORU (a study assistant) about one lecture, so the summary can replace the original messages in future requests.

Keep:
- each question the user asked, and the key points of each answer;
- facts, definitions and explanations that were established;
- the user's misunderstandings and how they were corrected;
- quiz progress: which questions were asked, the user's answers, right or wrong, and the score so far;
- any preferences the user stated (level of detail, language, format).

Write at most 250 words as Markdown bullets, oldest first. No preamble.`;

export const SUGGESTED_QUESTIONS = [
  'Explain the main idea simply',
  'What should I remember for the exam?',
  'Quiz me, one question at a time',
  'Give me a real-world example',
];

// ----------------------------------------------------------------- lecture

export interface LecturePart {
  system: string;
  /** The transcript text included (for the copy guard); '' in notes-only mode. */
  transcript: string;
  /** The transcript was too long and its middle was left out. */
  trimmed: boolean;
  notesOnly: boolean;
}

/** Tokens per character for this conversation, learned from OpenAI's reported usage. */
export function tokensPerChar(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.usage?.prompt && m.promptChars) return Math.min(0.6, Math.max(0.15, m.usage.prompt / m.promptChars));
  }
  return DEFAULT_TOKENS_PER_CHAR;
}

export function buildLecture(
  note: Note,
  project: Project | undefined,
  segments: Segment[],
  model: string,
  ratio = DEFAULT_TOKENS_PER_CHAR,
): LecturePart {
  const notesOnly = note.askContext === 'notes' && !!note.summary?.trim();
  let transcript = '';
  let trimmed = false;
  if (!notesOnly) {
    transcript = segments.map((s) => `[${formatClock(s.startMs)}] ${s.text}`).join('\n');
    const maxTokens = Math.min(TRANSCRIPT_MAX_TOKENS, inputLimit(model) * TRANSCRIPT_SHARE);
    const maxChars = Math.floor(maxTokens / ratio);
    if (transcript.length > maxChars) {
      const half = Math.floor(maxChars / 2);
      transcript = `${transcript.slice(0, half)}\n[… the middle of the transcript is left out for length …]\n${transcript.slice(-half)}`;
      trimmed = true;
    }
  }
  const parts = ['<lecture>', `<title>${note.title}</title>`];
  if (project && project.id !== store.INBOX_ID) {
    parts.push(`<project>${project.name}${project.description ? ` — ${project.description}` : ''}</project>`);
  }
  if (note.summary?.trim()) parts.push('<study_notes>', note.summary.trim(), '</study_notes>');
  if (note.myNotes.trim()) parts.push('<users_own_notes>', note.myNotes.trim(), '</users_own_notes>');
  if (notesOnly) parts.push(`<transcript_not_included>${NOTES_ONLY_NOTE}</transcript_not_included>`);
  else parts.push('<transcript>', transcript || '(nothing transcribed yet)', '</transcript>');
  parts.push('</lecture>');
  return { system: `${INSTRUCTIONS}\n\n${parts.join('\n')}\n\n${REMINDER}`, transcript, trimmed, notesOnly };
}

// ---------------------------------------------------------------- planning

export interface AskPlan {
  turns: ChatTurn[];
  promptChars: number;
  /** Estimated prompt tokens for the next question. */
  estimatedTokens: number;
  lectureTokens: number;
  historyTokens: number;
  /** What a request to this model may contain. */
  limit: number;
  limitKnown: boolean;
  /** Share of the limit the next question would use (0–1). */
  share: number;
  /** Messages after the last compaction that no longer fit and won't be sent. */
  droppedMessages: number;
  /** Messages a compaction would fold in now (it keeps the newest KEEP_RECENT). */
  compactable: number;
  transcriptTrimmed: boolean;
  notesOnly: boolean;
}

const usable = (m: ChatMessage) => !m.error && m.content.trim() !== '' && m.kind !== 'compaction';

function lastCompaction(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].kind === 'compaction') return i;
  return -1;
}

/** Messages a compaction would summarise: everything usable since the last one, except the newest few. */
function compactionCandidates(messages: ChatMessage[]): ChatMessage[] {
  const after = messages.slice(lastCompaction(messages) + 1).filter(usable);
  return after.slice(0, Math.max(0, after.length - KEEP_RECENT));
}

export function planAsk(input: {
  note: Note;
  project: Project | undefined;
  segments: Segment[];
  messages: ChatMessage[];
  model: string;
  /** A question not yet saved (the UI's draft), counted in the estimate. */
  draft?: string;
  /** Pass a memoised buildLecture() result to avoid rebuilding the lecture text. */
  lecture?: LecturePart;
}): AskPlan {
  const { messages, model } = input;
  const ratio = tokensPerChar(messages);
  const lecture = input.lecture ?? buildLecture(input.note, input.project, input.segments, model, ratio);
  const limit = inputLimit(model);

  const ci = lastCompaction(messages);
  const summary = ci >= 0 ? messages[ci] : undefined;
  const history = messages.slice(ci + 1).filter(usable);
  const draft = input.draft?.trim();

  const head: ChatTurn[] = [{ role: 'system', content: lecture.system }];
  if (summary) {
    head.push({ role: 'system', content: `Summary of the earlier conversation (older messages were compacted):\n${summary.content}` });
  }
  const headChars = head.reduce((n, t) => n + t.content.length, 0);
  const draftChars = draft ? draft.length : 0;

  // Newest first, until the budget is used; the newest message (the question) always goes.
  const budgetChars = Math.max(0, Math.min(HISTORY_MAX_TOKENS, limit * TOTAL_SHARE - (headChars + draftChars) * ratio) / ratio);
  const picked: ChatMessage[] = [];
  let historyChars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const isQuestion = !draft && i === history.length - 1;
    if (!isQuestion && historyChars + m.content.length > budgetChars) break;
    picked.unshift(m);
    historyChars += m.content.length;
  }

  const turns: ChatTurn[] = [...head, ...picked.map((m) => ({ role: m.role, content: m.content }))];
  if (draft) turns.push({ role: 'user', content: draft });
  const promptChars = headChars + historyChars + draftChars;
  const estimatedTokens = estimateTokens(promptChars, ratio);
  const lectureTokens = estimateTokens(lecture.system.length, ratio);
  return {
    turns,
    promptChars,
    estimatedTokens,
    lectureTokens,
    historyTokens: estimatedTokens - lectureTokens,
    limit,
    limitKnown: modelLimits(model).known,
    share: estimatedTokens / limit,
    droppedMessages: history.length - picked.length,
    compactable: compactionCandidates(messages).length,
    transcriptTrimmed: lecture.trimmed,
    notesOnly: lecture.notesOnly,
  };
}

// --------------------------------------------------------------- answering

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const nextIndexAfter = (messages: ChatMessage[]) => Math.floor(messages.at(-1)?.index ?? -1) + 1;

export type AskStatus = 'compacting' | 'answering';

/**
 * Answers the latest question in a note's conversation. Pass `question` to add
 * a new one; omit it to answer the last unanswered question again.
 */
export async function answer(opts: {
  noteId: string;
  question?: string;
  signal: AbortSignal;
  onText: (textSoFar: string) => void;
  onStatus?: (status: AskStatus) => void;
}): Promise<void> {
  const { noteId } = opts;
  const [note, segments, settings] = await Promise.all([
    store.getNote(noteId),
    store.getSegments(noteId),
    store.getSettings(),
  ]);
  if (!note) throw new Error('This note no longer exists.');
  const project = await store.getProject(note.projectId);

  let messages = await store.getMessages(noteId);
  if (opts.question) {
    const question: ChatMessage = {
      noteId,
      index: nextIndexAfter(messages),
      role: 'user',
      content: opts.question,
      createdAt: Date.now(),
    };
    await store.putMessage(question);
    messages = [...messages, question];
  }

  const plan = () => planAsk({ note, project, segments, messages, model: settings.summaryModel });
  let current = plan();
  if (settings.autoCompact && current.droppedMessages > 0 && current.compactable >= 2) {
    opts.onStatus?.('compacting');
    try {
      await compactConversation(noteId, opts.signal);
      messages = await store.getMessages(noteId);
      current = plan();
    } catch (e) {
      if (isAbort(e)) return;
      console.warn('[toru] automatic compaction failed; answering without it', e);
    }
  }
  opts.onStatus?.('answering');

  // Our own controller: the user's Stop aborts it, and so does the copy guard.
  const request = new AbortController();
  const forwardStop = () => request.abort();
  opts.signal.addEventListener('abort', forwardStop);
  const lecture = buildLecture(note, project, segments, settings.summaryModel, tokensPerChar(messages));
  const guard = new CopyGuard(lecture.transcript);
  let cutAt = -1;
  let checkedAt = 0;

  let text = '';
  let usage: ChatMessage['usage'];
  let failure: unknown = null;
  let stopped = false;
  try {
    const result = await chatStream({
      apiKey: settings.apiKey,
      model: settings.summaryModel,
      messages: current.turns,
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
    text = result.text;
    usage = result.usage;
  } catch (e) {
    if (isAbort(e)) stopped = true;
    else failure = e;
  } finally {
    opts.signal.removeEventListener('abort', forwardStop);
  }
  if (cutAt < 0 && !failure && text) cutAt = guard.check(text); // the tail since the last check

  const base = {
    noteId,
    index: nextIndexAfter(messages),
    role: 'assistant' as const,
    createdAt: Date.now(),
    model: settings.summaryModel,
    ...(usage ? { usage, promptChars: current.promptChars } : {}),
  };
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

// -------------------------------------------------------------- compaction

/**
 * Summarises older messages (keeping the newest KEEP_RECENT) into a compaction
 * that replaces them in future requests. The originals stay saved. The lecture
 * isn't sent, so this is a small request.
 */
export async function compactConversation(noteId: string, signal?: AbortSignal): Promise<void> {
  const [note, messages, settings] = await Promise.all([store.getNote(noteId), store.getMessages(noteId), store.getSettings()]);
  if (!note) throw new Error('This note no longer exists.');
  const candidates = compactionCandidates(messages);
  if (candidates.length < 2) throw new Error('There’s not enough conversation to compact yet.');
  const ci = lastCompaction(messages);
  const previous = ci >= 0 ? messages[ci] : undefined;

  const transcript = candidates.map((m) => `${m.role === 'user' ? 'User' : 'TORU'}: ${m.content.trim()}`).join('\n\n');
  const user = [
    `Lecture: ${note.title}`,
    previous ? `\nSummary of the conversation before these messages:\n${previous.content}` : '',
    `\nMessages to summarise:\n${transcript}`,
  ].join('\n');

  const { text } = await chatComplete({
    apiKey: settings.apiKey,
    model: settings.summaryModel,
    messages: [
      { role: 'system', content: COMPACT_INSTRUCTIONS },
      { role: 'user', content: user },
    ],
    signal,
  });
  const last = candidates[candidates.length - 1];
  await store.putMessage({
    noteId,
    index: Math.floor(last.index) + 0.5, // right after the last message it covers
    role: 'assistant',
    kind: 'compaction',
    content: text,
    createdAt: Date.now(),
    model: settings.summaryModel,
    covers: candidates.length + (previous?.covers ?? 0),
  });
}
