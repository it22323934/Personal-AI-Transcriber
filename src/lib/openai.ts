import type { TokenUsage } from './types';

const API = 'https://api.openai.com/v1';

export class OpenAIError extends Error {
  /** HTTP status, or 0 for network failures. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
  }

  /** Rate limits, server errors and network failures are worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

async function request(path: string, apiKey: string, init: RequestInit): Promise<Response> {
  if (!apiKey) throw new OpenAIError('Add your OpenAI API key in Settings.', 401);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e; // cancelled on purpose
    throw new OpenAIError('Could not reach OpenAI. Check your internet connection.', 0);
  }
  if (res.ok) return res;

  let detail = `${res.status} ${res.statusText}`.trim();
  try {
    const body = await res.json();
    if (body?.error?.message) detail = body.error.message;
  } catch {
    // Non-JSON error body; keep the status line.
  }
  const prefix =
    res.status === 401
      ? 'OpenAI rejected the API key. '
      : res.status === 429
        ? 'OpenAI rate limit or quota reached. '
        : '';
  throw new OpenAIError(prefix + detail, res.status);
}

export async function transcribe(opts: {
  apiKey: string;
  model: string;
  audio: Blob;
  language?: string;
  prompt?: string;
}): Promise<string> {
  const form = new FormData();
  form.append('file', opts.audio, 'audio.wav');
  form.append('model', opts.model);
  form.append('response_format', 'json');
  if (opts.language) form.append('language', opts.language);
  if (opts.prompt) form.append('prompt', opts.prompt);
  const res = await request('/audio/transcriptions', opts.apiKey, { method: 'POST', body: form });
  const body = await res.json();
  return String(body?.text ?? '').trim();
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  /** Token usage as reported by OpenAI (missing if the request was cut short). */
  usage?: TokenUsage;
}

function toUsage(u: unknown): TokenUsage | undefined {
  const v = u as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
  if (!v || typeof v.prompt_tokens !== 'number') return undefined;
  return { prompt: v.prompt_tokens, completion: v.completion_tokens ?? 0, cached: v.prompt_tokens_details?.cached_tokens ?? 0 };
}

/** One non-streaming chat request. Only model + messages are sent, so any chat model works. */
export async function chatComplete(opts: {
  apiKey: string;
  model: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const res = await request('/chat/completions', opts.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, messages: opts.messages }),
    signal: opts.signal,
  });
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') throw new OpenAIError('The model returned an empty response.', 500);
  return { text: text.trim(), usage: toUsage(body?.usage) };
}

export async function chat(opts: { apiKey: string; model: string; system: string; user: string }): Promise<string> {
  const { text } = await chatComplete({
    apiKey: opts.apiKey,
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });
  return text;
}

/**
 * Streams a chat answer, calling onText with the text so far, and asks for the
 * token usage in the final chunk. Some accounts can't stream some models
 * (OpenAI requires organisation verification for streaming certain models);
 * then this quietly falls back to one normal request.
 */
export async function chatStream(opts: {
  apiKey: string;
  model: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  onText: (textSoFar: string) => void;
}): Promise<ChatResult> {
  let res: Response;
  try {
    res = await request('/chat/completions', opts.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof OpenAIError && e.status === 400 && /stream|verif/i.test(e.message)) {
      const result = await chatComplete(opts);
      opts.onText(result.text);
      return result;
    }
    throw e;
  }
  if (!res.body) throw new OpenAIError('OpenAI sent an empty response.', 500);

  // Server-sent events: lines of "data: {json}", ending with "data: [DONE]".
  // With include_usage, the last chunk before [DONE] has no choices, only usage.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage: TokenUsage | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return { text: text.trim(), usage };
      try {
        const chunk = JSON.parse(data);
        usage = toUsage(chunk?.usage) ?? usage;
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          text += delta;
          opts.onText(text);
        }
      } catch {
        // ignore keep-alive or partial lines
      }
    }
  }
  if (!text.trim()) throw new OpenAIError('The model returned an empty response.', 500);
  return { text: text.trim(), usage };
}

export async function listModels(apiKey: string): Promise<string[]> {
  const res = await request('/models', apiKey, { method: 'GET' });
  const body = await res.json();
  return (body?.data ?? []).map((m: { id: string }) => m.id).sort();
}
