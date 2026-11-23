import { useEffect, useState } from 'react';
import { subscribe } from '../lib/events';
import * as store from '../lib/store';
import { IconX } from './icons';

interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'info';
}

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function toast(message: string, tone: 'error' | 'info' = 'info'): void {
  const id = nextId++;
  toasts = [...toasts.filter((t) => t.message !== message), { id, message, tone }].slice(-3);
  notify();
  setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 3500);
}

export function Toaster() {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    const unsubscribe = subscribe((e) => {
      if (e.type !== 'toast') return;
      toast(e.message, e.tone);
      store.takeFlash().catch(() => {}); // shown now; don't repeat it on next open
    });
    return () => {
      listeners.delete(rerender);
      unsubscribe();
    };
  }, []);

  if (!toasts.length) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>
          <div className="grow">{t.message}</div>
          <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
