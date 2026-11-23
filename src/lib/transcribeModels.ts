// TORU transcribes with gpt-transcribe, OpenAI's current transcription model.
// The older ones (gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1) aren't
// used: a setting that still names one moves to gpt-transcribe straight away.
// No imports, so it can be unit-tested directly with Node.

export const TRANSCRIBE_MODEL = 'gpt-transcribe';

/** OpenAI's earlier transcription models, deprecated in 2026 and shut down on 26 February 2027. */
const RETIRED = /^(whisper-1|gpt-4o(-mini)?-transcribe(-diarize)?)$/i;

/** The model to use for a saved setting: gpt-transcribe, or a newer model id someone typed in. */
export function transcribeModelFor(saved: string | undefined): string {
  const model = (saved ?? '').trim();
  return !model || RETIRED.test(model) ? TRANSCRIBE_MODEL : model;
}

/** Keywords as the API accepts them: one term each, no angle brackets or line breaks (or the whole request is rejected). */
export function cleanKeywords(terms: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms ?? []) {
    const term = raw.replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (term && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      out.push(term);
    }
  }
  return out.slice(0, 60);
}
