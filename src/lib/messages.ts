// Typed chrome.runtime messages. Every context receives every message, so
// each one carries a `target` and listeners ignore messages not meant for them.
import { sleep } from './format';

export type BackgroundRequest =
  | { type: 'START'; tabId: number; projectId: string }
  | { type: 'GET_STATE' }
  | { type: 'RECORDING_CHANGED' }
  | { type: 'OFFSCREEN_IDLE' }
  /** Show the mini player on the recorded tab (and remember that view). */
  | { type: 'SHOW_MINI' }
  /** From the mini player: open the side panel instead. */
  | { type: 'OPEN_PANEL' }
  | { type: 'OPEN_LIBRARY'; route: string }
  /** From the mini player once the recorder has gone: how did the note end up? */
  | { type: 'NOTE_STATUS'; noteId: string };

/** Mini player ⇄ offscreen recorder, over a runtime port named MINI_PORT. */
export const MINI_PORT = 'toru-mini';

export type MiniCommand =
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'SUMMARY'; on: boolean };

export interface MiniSnapshot {
  type: 'snapshot';
  recording: { paused: boolean; elapsedMs: number; runningSince: number | null } | null;
  note: {
    id: string;
    title: string;
    projectName: string;
    autoSummary: boolean;
    status: string;
    hasSummary: boolean;
  } | null;
  /** True: `segments` is the whole transcript. False: only lines this player hasn't seen yet. */
  reset: boolean;
  segments: { index: number; startMs: number; text: string }[];
  pending: number;
}

export type MiniMessage = MiniSnapshot | { type: 'level'; level: number };

export type OffscreenRequest =
  | { type: 'START'; streamId: string; tabId: number; projectId: string; title: string; url: string }
  | { type: 'STOP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ROLLOVER'; title: string; url: string }
  | { type: 'PING' };

export interface Reply {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function callBackground<T = Reply>(msg: BackgroundRequest): Promise<T> {
  const reply = (await chrome.runtime.sendMessage({ target: 'background', ...msg })) as Reply | undefined;
  if (!reply) throw new Error('TORU’s background service didn’t respond. Try reloading the extension.');
  if (!reply.ok) throw new Error(reply.error ?? 'Something went wrong.');
  return reply as T;
}

/** Sends to the offscreen recorder. Retries briefly while it's still loading. */
export async function callOffscreen<T = Reply>(msg: OffscreenRequest, retries = 0): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let reply: Reply | undefined;
    try {
      reply = (await chrome.runtime.sendMessage({ target: 'offscreen', ...msg })) as Reply | undefined;
    } catch {
      reply = undefined; // "Receiving end does not exist"
    }
    if (reply) {
      if (!reply.ok) throw new Error(reply.error ?? 'Something went wrong.');
      return reply as T;
    }
    if (attempt >= retries) throw new Error('The recorder isn’t running.');
    await sleep(150);
  }
}
