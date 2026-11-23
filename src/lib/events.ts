// Change notifications between extension contexts. Every write in store.ts
// emits an event; UI hooks re-read whatever they display when one arrives.

export type AppEvent =
  | { type: 'projects' }
  | { type: 'notes'; noteId?: string }
  | { type: 'segments'; noteId: string }
  | { type: 'chunks'; noteId: string }
  | { type: 'recording' }
  | { type: 'settings' }
  | { type: 'level'; level: number }
  /** A page showing a level meter says so every couple of seconds; levels only flow while someone watches. */
  | { type: 'level-watch' }
  | { type: 'toast'; message: string; tone?: 'error' | 'info' };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel('toru-events');
    channel.onmessage = (e: MessageEvent<AppEvent>) => {
      for (const l of listeners) l(e.data);
    };
  }
  return channel;
}

export function emit(event: AppEvent): void {
  getChannel().postMessage(event);
  // BroadcastChannel doesn't echo to the sending context, so notify locally too.
  queueMicrotask(() => {
    for (const l of listeners) l(event);
  });
}

export function subscribe(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
