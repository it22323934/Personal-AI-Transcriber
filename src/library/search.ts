// Library search. While the search view is open, each lecture's transcript is
// kept as one string so a query runs over ~300 strings in memory instead of
// re-reading thousands of transcript segments from IndexedDB. A lecture's copy
// is dropped when its transcript (or the note) changes, and the whole cache is
// released when the search view closes.
//
// Strings are built with Array.join on purpose: V8 stores a join result as one
// flat string, whereas a global regex replace (e.g. collapsing whitespace)
// leaves a tree of word-sized pieces that costs ~3x the memory of the text.
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
/** Summary + own notes as plain text; reused while the note is unchanged. */
const noteText = new Map<string, { updatedAt: number; text: string }>();

subscribe((e) => {
  if (e.type === 'segments' || (e.type === 'notes' && e.noteId)) {
    transcripts.delete(e.noteId!);
  } else if (e.type === 'notes') {
    transcripts.clear(); // bulk change (import, project deleted)
  }
});

/** Frees the cached text; called when the search view closes. */
export function releaseSearchCache(): void {
  transcripts.clear();
  noteText.clear();
}

/** Markdown → plain text on one line, ending in a join so it's stored flat. */
function plain(markdown: string): string {
  return markdown
    .replace(/^\s*([-*+•]|\d+[.)])\s+/gm, '') // list markers
    .replace(/[#*_`>]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

const joinSegments = (segments: Segment[]) =>
  segments
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .join(' ');

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

/** The searchable parts of a note, in snippet-preference order. Nothing is concatenated per query. */
function partsOf(note: Note): string[] {
  let cached = noteText.get(note.id);
  if (!cached || cached.updatedAt !== note.updatedAt) {
    const text = [plain(note.summary ?? ''), plain(note.myNotes)].filter(Boolean).join(' ');
    cached = { updatedAt: note.updatedAt, text };
    noteText.set(note.id, cached);
  }
  return [cached.text, transcripts.get(note.id) ?? ''];
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
    const parts = partsOf(note);
    if (!patterns.every((p) => p.test(note.title) || parts.some((part) => p.test(part)))) continue;
    // Snippet: around the earliest match in the first part that has one (summary/notes, then transcript).
    let snippet = '';
    for (const part of parts) {
      let at = Infinity;
      for (const p of patterns) {
        const m = p.exec(part);
        if (m && m.index < at) at = m.index;
      }
      if (Number.isFinite(at)) {
        snippet = `${at > 70 ? '…' : ''}${part.slice(Math.max(0, at - 70), at + 170).trim()}…`;
        break;
      }
    }
    if (!snippet) snippet = parts[0].slice(0, 200);
    results.push({ note, snippet, titleHit: patterns.some((p) => p.test(note.title)) });
  }
  return results
    .sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || b.note.createdAt - a.note.createdAt)
    .slice(0, MAX_RESULTS);
}
