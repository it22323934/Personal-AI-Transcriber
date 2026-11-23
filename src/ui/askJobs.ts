// Answers (and compactions) in progress, kept outside React so switching tabs
// or notes in the page doesn't cancel them: the Ask panel re-attaches when it
// remounts. Jobs are replaced (not mutated) on every change so React sees it.
import { useSyncExternalStore } from 'react';
import { answer, compactConversation, dropTrailingAnswer, type AskStatus } from '../lib/chat';
import { errorMessage } from '../lib/format';

export interface AskJob {
  noteId: string;
  status: AskStatus;
  text: string;
}

const jobs = new Map<string, AskJob>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;

function notify() {
  // Stream deltas arrive many times a second; repaint ~30x a second at most.
  // (A timer rather than requestAnimationFrame, which stops in background tabs.)
  if (pending !== undefined) return;
  pending = setTimeout(() => {
    pending = undefined;
    for (const l of listeners) l();
  }, 33);
}

function update(noteId: string, patch: Partial<AskJob>) {
  const job = jobs.get(noteId);
  if (!job) return;
  jobs.set(noteId, { ...job, ...patch });
  notify();
}

function run(noteId: string, status: AskStatus, work: (signal: AbortSignal) => Promise<void>, onError?: (e: unknown) => void) {
  if (jobs.has(noteId)) return;
  const controller = new AbortController();
  jobs.set(noteId, { noteId, status, text: '' });
  controllers.set(noteId, controller);
  notify();
  work(controller.signal)
    .catch((e) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (onError) onError(e);
      else console.error('[toru] ask failed', e);
    })
    .finally(() => {
      jobs.delete(noteId);
      controllers.delete(noteId);
      notify();
    });
}

export function startAsk(noteId: string, question?: string): void {
  run(noteId, 'answering', async (signal) => {
    if (!question) await dropTrailingAnswer(noteId);
    await answer({
      noteId,
      question,
      signal,
      onText: (text) => update(noteId, { text }),
      onStatus: (status) => update(noteId, { status }),
    });
  });
}

export function startCompact(noteId: string, onError: (message: string) => void): void {
  run(noteId, 'compacting', (signal) => compactConversation(noteId, signal), (e) => onError(errorMessage(e)));
}

export function stopAsk(noteId: string): void {
  controllers.get(noteId)?.abort();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The answer or compaction in progress for this note, if any. */
export function useAskJob(noteId: string): AskJob | undefined {
  return useSyncExternalStore(subscribe, () => jobs.get(noteId));
}
