// Which OpenAI transcription model to call, and how each one takes its hints.
// No imports, so it can be unit-tested directly with Node.

/** OpenAI's recommended transcription model (since 2026). */
export const RECOMMENDED_TRANSCRIBE_MODEL = 'gpt-transcribe';

/** Older transcription models: OpenAI shuts them down on 26 February 2027. */
export const DEPRECATED_TRANSCRIBE_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-4o-transcribe-diarize', 'whisper-1'];
export const TRANSCRIBE_SHUTDOWN = Date.UTC(2027, 1, 26);

export function isDeprecatedTranscribeModel(model: string): boolean {
  return DEPRECATED_TRANSCRIBE_MODELS.includes(model.trim());
}

/** The model to actually call: a deprecated one is replaced once it has been shut down. */
export function effectiveTranscribeModel(model: string, now = Date.now()): string {
  return isDeprecatedTranscribeModel(model) && now >= TRANSCRIBE_SHUTDOWN ? RECOMMENDED_TRANSCRIBE_MODEL : model;
}

/** gpt-transcribe (and its successors) take a `languages` list and `keywords`; older models one `language` and a prompt. */
export function takesLanguageList(model: string): boolean {
  return /^gpt-(live-)?transcribe/.test(model.trim());
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
