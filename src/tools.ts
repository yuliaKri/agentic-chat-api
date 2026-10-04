export interface ToolEnvironment {
  PUSHOVER_USER?: string;
  PUSHOVER_TOKEN?: string;
}

export interface ToolCall {
  id: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';
const MAX_NOTIFICATION_LENGTH = 1_000;

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'answer_portfolio_question',
      description:
        "Use when the visitor's message can be answered from Yulia's supplied professional context, or is ordinary conversation that does not require recording contact details or an unknown question.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_user_details',
      description:
        'Notify Yulia when a visitor provides contact information or asks her to follow up.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: "The visitor's email address, when provided.",
          },
          phone: {
            type: 'string',
            description: "The visitor's phone number, when provided.",
          },
          name: {
            type: 'string',
            description: "The visitor's name, when provided.",
          },
          company: {
            type: 'string',
            description: "The visitor's company, when provided.",
          },
          role: {
            type: 'string',
            description: "The visitor's role or title, when provided.",
          },
          reason: {
            type: 'string',
            description: 'Why the visitor is contacting Yulia, when known.',
          },
          question_or_opportunity: {
            type: 'string',
            description: 'The question, job, project, or opportunity they want to discuss.',
          },
          context: {
            type: 'string',
            description: 'Brief useful context from the conversation.',
          },
        },
        anyOf: [{ required: ['email'] }, { required: ['phone'] }],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_unknown_question',
      description:
        "Notify Yulia about a visitor question that cannot be answered from Yulia's supplied portfolio context.",
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: "The visitor's unanswered question.",
          },
          context: {
            type: 'string',
            description: 'Brief relevant context that helps Yulia understand the question.',
          },
          visitor_email: {
            type: 'string',
            format: 'email',
            description: "The visitor's email address if it was already provided.",
          },
          visitor_phone: {
            type: 'string',
            description: "The visitor's phone number if it was already provided.",
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  },
] as const;

type ToolArguments = Record<string, unknown>;

function optionalString(args: ToolArguments, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(args: ToolArguments, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new Error(`Missing required field: ${key}`);
  return value;
}

function formatNotification(title: string, fields: Array<[string, string | undefined]>): string {
  const details = fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([label, value]) => `${label}: ${value}`);

  return [title, ...details].join('\n').slice(0, MAX_NOTIFICATION_LENGTH);
}

async function pushNotification(message: string, env: ToolEnvironment): Promise<void> {
  if (!env.PUSHOVER_USER || !env.PUSHOVER_TOKEN) {
    throw new Error('Notification service is not configured.');
  }

  const response = await fetch(PUSHOVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: env.PUSHOVER_TOKEN,
      user: env.PUSHOVER_USER,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Notification provider returned status ${response.status}.`);
  }
}

async function recordUserDetails(args: ToolArguments, env: ToolEnvironment): Promise<void> {
  const email = optionalString(args, 'email');
  const phone = optionalString(args, 'phone');
  if (!email && !phone) throw new Error('An email address or phone number is required.');
  if (email && !email.includes('@')) throw new Error('The provided email address is invalid.');
  if (phone && phone.replace(/\D/g, '').length < 7) {
    throw new Error('The provided phone number is invalid.');
  }

  await pushNotification(
    formatNotification('Portfolio visitor follow-up', [
      ['Email', email],
      ['Phone', phone],
      ['Name', optionalString(args, 'name')],
      ['Company', optionalString(args, 'company')],
      ['Role', optionalString(args, 'role')],
      ['Reason', optionalString(args, 'reason')],
      ['Question/opportunity', optionalString(args, 'question_or_opportunity')],
      ['Context', optionalString(args, 'context')],
    ]),
    env
  );
}

async function recordUnknownQuestion(args: ToolArguments, env: ToolEnvironment): Promise<void> {
  await pushNotification(
    formatNotification('Unknown portfolio question', [
      ['Question', requiredString(args, 'question')],
      ['Context', optionalString(args, 'context')],
      ['Visitor email', optionalString(args, 'visitor_email')],
      ['Visitor phone', optionalString(args, 'visitor_phone')],
    ]),
    env
  );
}

function parseArguments(value: string): ToolArguments {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  return parsed as ToolArguments;
}

async function dispatchToolCall(call: ToolCall, env: ToolEnvironment): Promise<ToolResultMessage> {
  try {
    const args = parseArguments(call.function.arguments);

    switch (call.function.name) {
      case 'answer_portfolio_question':
        break;
      case 'record_user_details':
        await recordUserDetails(args, env);
        break;
      case 'record_unknown_question':
        await recordUnknownQuestion(args, env);
        break;
      default:
        throw new Error(`Unknown tool: ${call.function.name}`);
    }

    console.log(`Tool completed: ${call.function.name}`);

    return {
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify({ recorded: true }),
    };
  } catch (error) {
    console.error(`Tool ${call.function.name} failed:`, error);
    return {
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify({
        recorded: false,
        error: error instanceof Error ? error.message : 'Tool execution failed.',
      }),
    };
  }
}

export async function dispatchToolCalls(
  calls: ToolCall[],
  env: ToolEnvironment
): Promise<ToolResultMessage[]> {
  return Promise.all(calls.map((call) => dispatchToolCall(call, env)));
}
