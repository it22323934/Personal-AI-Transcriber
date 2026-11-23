// Library search. Each lecture's transcript is flattened to one string the
// first time it's searched and kept for later searches; a lecture's copy is
// dropped only when its transcript (or the note itself) changes. Queries then
// run over ~300 strings in memory instead of re-reading thousands of
// transcript segments from IndexedDB on every keystroke.
import { subscribe } from '../lib/events';
import * as store from '../lib/store';
import type { Note, Segment } from '../lib/types';

export interface SearchResult {
  note: Note;
  snippet: string;
}

const MAX_RESULTS = 100;
/** Above this many uncached lectures, one bulk read beats per-lecture lookups. */
const BULK_LOAD_THRESHOLD = 25;

const transcripts = new Map<string, string>();
/** Summary + own notes, flattened; reused while the note is unchanged. */
const noteText = new Map<string, { updatedAt: number; text: string }>();

subscribe((e) => {
  if (e.type === 'segments' || (e.type === 'notes' && e.noteId)) {
    transcripts.delete(e.noteId!);
  } else if (e.type === 'notes') {
    transcripts.clear(); // bulk change (import, project deleted)
  }
});

function plain(markdown: string): string {
  return markdown
    .replace(/^\s*([-*+•]|\d+[.)])\s+/gm, '') // list markers
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const joinSegments = (segments: Segment[]) =>
  segments
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ');

async function loadTranscripts(notes: Note[]): Promise<void> {
  const missing = notes.filter((n) => !transcripts.has(n.id));
  if (!missing.length) return;
  if (missing.length > BULK_LOAD_THRESHOLD) {
    const byNote = new Map<string, Segment[]>();
    for (const s of await store.getAllSegments()) {
      const list = byNote.get(s.noteId);
      if (list) list.push(s);
      else byNote.set(s.noteId, [s]);
    }
    for (const n of missing) transcripts.set(n.id, joinSegments(byNote.get(n.id) ?? []));
  } else {
    await Promise.all(missing.map(async (n) => transcripts.set(n.id, joinSegments(await store.getSegments(n.id)))));
  }
}

function bodyOf(note: Note): string {
  let cached = noteText.get(note.id);
  if (!cached || cached.updatedAt !== note.updatedAt) {
    cached = { updatedAt: note.updatedAt, text: `${plain(note.summary ?? '')} ${plain(note.myNotes)}` };
    noteText.set(note.id, cached);
  }
  return `${cached.text} ${transcripts.get(note.id) ?? ''}`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export async function searchNotes(query: string): Promise<SearchResult[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const patterns = terms.map((t) => new RegExp(escapeRegExp(t), 'i'));
  const notes = await store.listNotes();
  await loadTranscripts(notes);

  const results: (SearchResult & { titleHit: boolean })[] = [];
  for (const note of notes) {
    const body = bodyOf(note);
    if (!patterns.every((p) => p.test(note.title) || p.test(body))) continue;
    let at = Infinity;
    for (const p of patterns) {
      const m = p.exec(body);
      if (m && m.index < at) at = m.index;
    }
    const snippet = Number.isFinite(at)
      ? `${at > 70 ? '…' : ''}${body.slice(Math.max(0, at - 70), at + 170).trim()}…`
      : plain(note.summary ?? '').slice(0, 200);
    results.push({ note, snippet, titleHit: patterns.some((p) => p.test(note.title)) });
  }
  return results
    .sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || b.note.createdAt - a.note.createdAt)
    .slice(0, MAX_RESULTS);
}
