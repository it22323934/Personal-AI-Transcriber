// Spots an AI answer that has started pasting the source text (the lecture
// transcript) back verbatim, so the request can be stopped and the copy cut.
// Comparison ignores case, timestamps like [1:23], Markdown marks, quotes and
// line breaks, because a pasted transcript usually comes back reformatted.

/** ~30 words copied in a row is a paste, not a quote. */
const DEFAULT_WINDOW = 200;
/** A short label before the copy on the same line ("Transcript (from the lecture):") goes too. */
const LEAD_IN_MAX = 60;

const TIMESTAMP = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;
/** "- ", "* ", "• ", "1. " at the start of a line: a paste re-formatted as a list. */
const LIST_MARKER = /^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm;
const IGNORED = new Set(['*', '_', '`', '#', '>', '"', '“', '”', '‘', '’', "'"]);

/** Normalised text plus, for each of its characters, the index it came from. */
function normalise(input: string): { text: string; map: number[] } {
  const blank = (m: string) => ' '.repeat(m.length); // same length, so indices stay aligned
  const src = input.replace(TIMESTAMP, blank).replace(LIST_MARKER, blank);
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (IGNORED.has(ch)) continue;
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      if (!lastWasSpace) {
        chars.push(' ');
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    chars.push(ch.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  return { text: chars.join(''), map }; // join → one flat string, even for long transcripts
}

export class CopyGuard {
  private readonly source: string;

  constructor(
    source: string,
    private readonly window = DEFAULT_WINDOW,
  ) {
    this.source = normalise(source).text;
  }

  /**
   * Where in `answer` a verbatim copy of the source begins, or -1 if the
   * answer doesn't end in one. Cheap when there's no copy (one substring search).
   */
  check(answer: string): number {
    if (this.source.length < this.window) return -1;
    const { text, map } = normalise(answer);
    if (text.length < this.window) return -1;
    if (!this.source.includes(text.slice(-this.window))) return -1;

    // Earliest copied window, then step back to the exact first copied character.
    let start = text.length - this.window;
    for (let i = 0; i + this.window <= text.length; i += 10) {
      if (this.source.includes(text.slice(i, i + this.window))) {
        start = i;
        break;
      }
    }
    while (start > 0 && this.source.includes(text.slice(start - 1, start + this.window))) start--;

    let cut = map[start];
    const lineStart = answer.lastIndexOf('\n', cut - 1) + 1;
    if (cut - lineStart <= LEAD_IN_MAX) cut = lineStart;
    return cut;
  }
}
