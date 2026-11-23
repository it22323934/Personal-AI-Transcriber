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
  } catch {
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

export async function chat(opts: { apiKey: string; model: string; system: string; user: string }): Promise<string> {
  // Only model + messages are sent so any chat model (gpt-4o, gpt-4.1, gpt-5…) works.
  const res = await request('/chat/completions', opts.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') throw new OpenAIError('The model returned an empty response.', 500);
  return text.trim();
}

export async function listModels(apiKey: string): Promise<string[]> {
  const res = await request('/models', apiKey, { method: 'GET' });
  const body = await res.json();
  return (body?.data ?? []).map((m: { id: string }) => m.id).sort();
}
