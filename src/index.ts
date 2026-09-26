import { SYSTEM_PROMPT } from './systemPrompt';

export interface Env {
  DEEPSEEK_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface ChatRequest {
  history?: HistoryMessage[];
  message?: string;
}

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_HISTORY_MESSAGES = 12;

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin || !env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN === '*') return true;
  return env.ALLOWED_ORIGIN.split(',')
    .map((allowedOrigin) => allowedOrigin.trim())
    .includes(origin);
}

function json(
  body: Record<string, unknown>,
  status: number,
  headers: HeadersInit
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function validHistory(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is HistoryMessage =>
        typeof item === 'object' &&
        item !== null &&
        ('role' in item) &&
        (item.role === 'user' || item.role === 'assistant') &&
        ('text' in item) &&
        typeof item.text === 'string'
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => ({
      role: item.role,
      text: item.text.slice(0, MAX_MESSAGE_LENGTH),
    }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, env);

    if (!isOriginAllowed(origin, env)) {
      return json({ error: 'Origin not allowed.' }, 403, headers);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, headers);
    }

    if (!env.DEEPSEEK_API_KEY) {
      console.error('DEEPSEEK_API_KEY is not configured.');
      return json({ error: 'Chat service is not configured.' }, 503, headers);
    }

    let payload: ChatRequest;
    try {
      payload = (await request.json()) as ChatRequest;
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400, headers);
    }

    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return json({ error: 'Message must be between 1 and 1000 characters.' }, 400, headers);
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...validHistory(payload.history).map((item) => ({
        role: item.role,
        content: item.text,
      })),
      { role: 'user', content: message },
    ];

    let deepseekResponse: Response;
    try {
      deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: 0.5,
          max_tokens: 300,
        }),
      });
    } catch (error) {
      console.error('DeepSeek API request failed:', error);
      return json({ error: 'AI provider is unavailable.' }, 502, headers);
    }

    if (!deepseekResponse.ok) {
      console.error('DeepSeek API error:', deepseekResponse.status, await deepseekResponse.text());
      return json({ error: 'AI provider request failed.' }, 502, headers);
    }

    const result = (await deepseekResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = result.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return json({ error: 'AI provider returned an empty response.' }, 502, headers);
    }

    return json({ message: answer }, 200, headers);
  },
};
