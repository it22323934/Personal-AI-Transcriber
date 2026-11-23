// Answers being written, kept outside React so switching tabs (or notes) in
// the page doesn't cancel them: the Ask panel re-attaches when it remounts.
import { useSyncExternalStore } from 'react';
import { answer, dropTrailingAnswer } from '../lib/chat';

export interface AskJob {
  noteId: string;
  text: string;
  controller: AbortController;
}

const jobs = new Map<string, AskJob>();
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

export function startAsk(noteId: string, question?: string): void {
  if (jobs.has(noteId)) return;
  const job: AskJob = { noteId, text: '', controller: new AbortController() };
  jobs.set(noteId, job);
  notify();
  const run = async () => {
    if (!question) await dropTrailingAnswer(noteId);
    await answer({
      noteId,
      question,
      signal: job.controller.signal,
      onText: (t) => {
        job.text = t;
        notify();
      },
    });
  };
  run()
    .catch((e) => console.error('[toru] ask failed', e))
    .finally(() => {
      jobs.delete(noteId);
      notify();
    });
}

export function stopAsk(noteId: string): void {
  jobs.get(noteId)?.controller.abort();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The answer currently being written for this note, if any. */
export function useAskJob(noteId: string): { text: string } | undefined {
  // Snapshot is the job's text so React re-renders as it grows.
  const text = useSyncExternalStore(subscribe, () => jobs.get(noteId)?.text ?? null);
  return text === null ? undefined : { text };
}
