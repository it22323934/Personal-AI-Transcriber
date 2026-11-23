/** 83_000 → "1:23", 3_723_000 → "1:02:03" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Human duration: "45 sec", "11 min", "1 h 4 min" */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString();
  const day = sameDay ? 'Today' : yesterday ? 'Yesterday' : dateFmt.format(d);
  return `${day}, ${timeFmt.format(d)}`;
}

export function timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatDate(ts);
}

/** 1536 → "1.5 KB", 3_800_000 → "3.6 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Identifies "the same page" for auto-splitting: ignores the #hash only. */
export function pageKey(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * Tidies a tab title into a note title:
 * "(3) [SHARED] Entra ID Overview | learn.cantrill.io" → "Entra ID Overview"
 */
export function cleanTitle(title: string | undefined): string {
  let t = (title ?? '').trim();
  t = t.replace(/^\(\d+\)\s*/, ''); // unread counters, e.g. "(3) "
  t = t.replace(/^\[[A-Z0-9 _-]{2,20}\]\s*/, ''); // tags such as "[SHARED] "
  t = t.replace(/\s+[|\-–—]\s+(YouTube|[\w-]+(\.[\w-]+)+)$/i, ''); // " - YouTube", " | site.com"
  return t.trim() || 'Untitled recording';
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
