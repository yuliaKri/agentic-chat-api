import { SYSTEM_PROMPT } from './systemPrompt';
import {
  CHAT_TOOLS,
  dispatchToolCalls,
  type ToolCall,
  type ToolEnvironment,
  type ToolResultMessage,
} from './tools';

export interface Env extends ToolEnvironment {
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
const MAX_COMPLETION_STEPS = 2;

type ChatCompletionMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | ToolResultMessage;

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}

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

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...validHistory(payload.history).map((item) => ({
        role: item.role,
        content: item.text,
      })),
      { role: 'user', content: message },
    ];
    let shouldInviteForContact = false;

    for (let step = 0; step < MAX_COMPLETION_STEPS; step += 1) {
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
            tools: CHAT_TOOLS,
            // The first response must classify the message by selecting a tool.
            // After tool execution, the second response produces visitor-facing text.
            tool_choice: step === 0 ? 'required' : 'none',
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

      const result = (await deepseekResponse.json()) as DeepSeekResponse;
      const assistantMessage = result.choices?.[0]?.message;
      if (!assistantMessage) {
        return json({ error: 'AI provider returned an empty response.' }, 502, headers);
      }

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length > 0) {
        if (step > 0) {
          return json({ error: 'AI provider requested an unexpected additional tool call.' }, 502, headers);
        }
        const toolNames = toolCalls.map((call) => call.function.name);
        shouldInviteForContact =
          toolNames.includes('record_unknown_question') &&
          !toolNames.includes('record_user_details');
        messages.push({
          role: 'assistant',
          content: assistantMessage.content ?? null,
          tool_calls: toolCalls,
        });
        messages.push(...(await dispatchToolCalls(toolCalls, env)));
        continue;
      }

      const answer = assistantMessage.content?.trim();
      if (!answer) {
        return json({ error: 'AI provider returned an empty response.' }, 502, headers);
      }

      const finalAnswer =
        shouldInviteForContact &&
        (!/\bemail\b/i.test(answer) || !/\b(phone|telephone)\b/i.test(answer))
          ? `${answer}\n\nIf you'd like Yulia to follow up personally, please leave your email address or phone number.`
          : answer;

      return json({ message: finalAnswer }, 200, headers);
    }

    return json({ error: 'AI provider did not complete the tool workflow.' }, 502, headers);
  },
};
