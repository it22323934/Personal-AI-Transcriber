// Context limits per model family, and token estimates.
//
// Limits are what a request may send (context window minus the room the model
// keeps for its reply). Unknown models get a cautious 128k window. Token counts
// before sending are estimated from characters; once OpenAI reports real usage
// for a conversation, that ratio is used instead (it differs by language).

interface ModelLimits {
  /** Total context window in tokens. */
  window: number;
  /** Largest reply the model can write; reserved out of the window. */
  maxOutput: number;
  known: boolean;
}

const FAMILIES: [RegExp, Omit<ModelLimits, 'known'>][] = [
  [/^gpt-5/, { window: 400_000, maxOutput: 128_000 }],
  [/^gpt-4\.1/, { window: 1_047_576, maxOutput: 32_768 }],
  [/^gpt-4o/, { window: 128_000, maxOutput: 16_384 }],
  [/^o[134](-|$)/, { window: 200_000, maxOutput: 100_000 }],
  [/^gpt-4-turbo/, { window: 128_000, maxOutput: 4_096 }],
  [/^gpt-3\.5/, { window: 16_385, maxOutput: 4_096 }],
];

const UNKNOWN: ModelLimits = { window: 128_000, maxOutput: 16_384, known: false };

export function modelLimits(model: string): ModelLimits {
  const name = model.trim().toLowerCase();
  for (const [re, limits] of FAMILIES) if (re.test(name)) return { ...limits, known: true };
  return UNKNOWN;
}

/** Tokens a request to this model may contain. */
export function inputLimit(model: string): number {
  const { window, maxOutput } = modelLimits(model);
  return window - maxOutput;
}

/** Tokens per character before any real usage is known (between English ~0.25 and German ~0.3). */
export const DEFAULT_TOKENS_PER_CHAR = 0.28;

export function estimateTokens(chars: number, tokensPerChar = DEFAULT_TOKENS_PER_CHAR): number {
  return Math.ceil(chars * tokensPerChar);
}

/** 950 → "950", 4_230 → "4.2k", 42_000 → "42k", 1_200_000 → "1.2M" */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
