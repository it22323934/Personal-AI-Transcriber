import { useCallback, useEffect, useRef, useState } from 'react';
import { emit, subscribe, type AppEvent } from '../lib/events';
import { callBackground } from '../lib/messages';
import * as store from '../lib/store';
import type { Note, Project, RecordingState, Settings } from '../lib/types';

/** Matching events within this window trigger a single reload. */
const RELOAD_COALESCE_MS = 50;

/**
 * Loads data and reloads it whenever a matching change event arrives from any
 * extension context. A burst of events (one audio chunk emits notes + chunks +
 * segments) causes one reload, not several. Returns undefined until the first
 * load completes.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], matches: (e: AppEvent) => boolean): T | undefined {
  const [value, setValue] = useState<T>();
  const loadRef = useRef(load);
  const matchRef = useRef(matches);
  loadRef.current = load;
  matchRef.current = matches;

  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      loadRef.current().then(
        (v) => {
          if (alive && mine === seq) setValue(v);
        },
        (e) => console.error('[toru] load failed', e),
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        run();
      }, RELOAD_COALESCE_MS);
    };
    setValue(undefined);
    run();
    const unsubscribe = subscribe((e) => {
      if (e.type !== 'level' && e.type !== 'level-watch' && matchRef.current(e)) schedule();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}

export function useSettings(): Settings | undefined {
  return useLive(store.getSettings, [], (e) => e.type === 'settings');
}

export function useProjects(): Project[] | undefined {
  return useLive(store.listProjects, [], (e) => e.type === 'projects');
}

export function useNotes(projectId?: string): Note[] | undefined {
  return useLive(() => store.listNotes(projectId), [projectId], (e) => e.type === 'notes');
}

/** The note, null if it doesn't exist (deleted), undefined while loading. */
export function useNote(noteId: string): Note | null | undefined {
  return useLive(
    async () => (await store.getNote(noteId)) ?? null,
    [noteId],
    (e) => e.type === 'notes' && (!e.noteId || e.noteId === noteId),
  );
}

/** The live recording (null when idle, undefined while loading). */
export function useRecording(): RecordingState | null | undefined {
  const rec = useLive(store.getRecording, [], (e) => e.type === 'recording');
  useEffect(() => {
    // Clears state left behind if the recorder died (e.g. browser restart).
    callBackground({ type: 'GET_STATE' }).catch(() => {});
  }, []);
  return rec;
}

export function elapsedMs(rec: RecordingState, now: number): number {
  return rec.elapsedMs + (rec.runningSince ? now - rec.runningSince : 0);
}

/** Re-renders every `interval` ms while `active`. */
export function useNow(active: boolean, interval = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [active, interval]);
  return now;
}

/**
 * Recent input levels from the recorder, newest last. While mounted it tells
 * the recorder someone is watching; with no meter on screen no levels are sent.
 */
export function useLevels(count: number): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(count).fill(0));
  useEffect(() => {
    const unsubscribe = subscribe((e) => {
      if (e.type === 'level') setLevels((prev) => [...prev.slice(1 - count), e.level]);
    });
    emit({ type: 'level-watch' });
    const ping = setInterval(() => emit({ type: 'level-watch' }), 2000);
    return () => {
      clearInterval(ping);
      unsubscribe();
    };
  }, [count]);
  return levels;
}

/**
 * The value, but only after it has stopped changing for `delay` ms. Values
 * for which `immediate` returns true (e.g. a cleared search box) apply at once,
 * so a stale value never outlives them.
 */
export function useDebouncedValue<T>(value: T, delay: number, immediate?: (v: T) => boolean): T {
  const [settled, setSettled] = useState(value);
  const now = immediate?.(value) ?? false;
  useEffect(() => {
    if (now) {
      setSettled(value);
      return;
    }
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay, now]);
  return now ? value : settled;
}

/** Debounced saver that also flushes on unmount. */
export function useDebouncedSave<T>(save: (value: T) => void, delay = 600) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) {
      const { value } = pending.current;
      pending.current = null;
      saveRef.current(value);
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => flush, [flush]);
  return { schedule, flush, isPending: () => pending.current !== null };
}

/** Closes popovers when clicking outside or pressing Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}
