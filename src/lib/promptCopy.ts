// The transcriber is given the end of the previous lines as context. On quiet
// or unclear audio it sometimes returns that context instead of transcribing,
// which repeats a paragraph that was already said. This removes such copies.
// No imports, so it can be unit-tested directly with Node.

/** Shorter sentences ("yes, exactly") can't be told apart from a genuine repeat. */
const MIN_WORDS = 4;
/** Share of a sentence's word pairs found in the prompt for it to count as copied. */
const COPY_SHARE = 0.6;

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      // \p{M}: vowel signs and other combining marks, which Sinhala, Tamil,
      // Hindi and many other scripts put inside words.
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:'[\p{L}\p{M}]+)?/gu) ?? []
  );
}

function pairs(w: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < w.length; i++) out.push(`${w[i - 1]} ${w[i]}`);
  return out;
}

/** Drops sentences of 4+ words that mostly match the prompt; keeps everything else as it was. */
export function stripPromptCopy(text: string, prompt: string): string {
  if (!prompt.trim() || !text.trim()) return text.trim();
  const pool = new Set(pairs(words(prompt)));
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) ?? [text];
  const kept = sentences.filter((sentence) => {
    const w = words(sentence);
    if (w.length < MIN_WORDS) return true;
    const grams = pairs(w);
    return grams.filter((g) => pool.has(g)).length / grams.length < COPY_SHARE;
  });
  return kept.join('').replace(/\s+/g, ' ').trim();
}
