// Applies the colour theme. 'system' leaves html[data-theme] unset so the CSS
// follows prefers-color-scheme; 'light'/'dark' force it. The choice is mirrored
// to localStorage (read synchronously at startup, so there's no flash of the
// wrong theme) and to chrome.storage.local (read by the on-page mini player).
import { subscribe } from '../lib/events';
import * as store from '../lib/store';
import type { ThemePreference } from '../lib/types';

const LOCAL_KEY = 'toru-theme';

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    localStorage.setItem(LOCAL_KEY, pref);
  } catch {
    // storage unavailable: the theme still applies for this page
  }
  chrome.storage?.local.set({ toruTheme: pref }).catch(() => {});
}

/** Call before the first render. */
export function initTheme(): void {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(LOCAL_KEY);
  } catch {
    // ignore
  }
  if (cached === 'light' || cached === 'dark' || cached === 'system') applyTheme(cached);
  const sync = () => store.getSettings().then((s) => applyTheme(s.theme), () => {});
  void sync();
  subscribe((e) => {
    if (e.type === 'settings') void sync();
  });
}
