import { config, openRouterModelChain } from "./config.js";
import { HISTORY_TURNS, historyForModel } from "./memory.js";
import { replyIsUsable, systemPrompt, turnInstruction, type SalesContext } from "./sales.js";
import type { ChatMessage } from "./types.js";

type TextPart = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type ChatRequestMessage = {
  role: string;
  content: string | TextPart[];
};

export type OpenRouterChatRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    models: string[];
    temperature: number;
    max_tokens: number;
    session_id: string;
    reasoning: { effort: "minimal" };
    messages: ChatRequestMessage[];
  };
};

/** Plain texts are short. This leaves room for a little reasoning without JSON truncation. */
export const REPLY_MAX_TOKENS = 400;
/** Used once if OpenRouter says the key cannot pre-authorize the larger cap. */
export const REPLY_MAX_TOKENS_LOW_CREDIT = 160;
const ATTEMPT_TIMEOUT_MS = 40_000;

export function cacheSessionId(shopHandle: string): string {
  const handle = shopHandle.replace(/[^\w.-]/g, "").slice(0, 80) || "shop";
  return `arial-luxe-${handle}`.slice(0, 256);
}

export function buildOpenRouterChatRequest(
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
  situation = "",
  options: { models?: string[]; maxTokens?: number } = {},
): OpenRouterChatRequest {
  const sessionId = cacheSessionId(ctx.shopHandle);
  const messages: ChatRequestMessage[] = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: systemPrompt(ctx),
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    { role: "system", content: turnInstruction(ctx) },
  ];
  if (situation.trim()) {
    messages.push({ role: "system", content: situation.trim() });
  }
  messages.push(
    ...historyForModel(history, HISTORY_TURNS),
    { role: "user", content: userText },
  );

  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicBaseUrl || "http://localhost",
      "X-Title": "Arial Luxe shop assistant",
      "x-session-id": sessionId,
      "x-grok-conv-id": sessionId,
    },
    body: {
      models: options.models?.length ? options.models : openRouterModelChain(),
      temperature: 0.9,
      max_tokens: options.maxTokens ?? REPLY_MAX_TOKENS,
      reasoning: { effort: "minimal" },
      session_id: sessionId,
      messages,
    },
  };
}

type ReplyGenerator = (
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
  situation: string,
) => Promise<string>;

let replyGenerator: ReplyGenerator | null = null;

export function setReplyGenerator(generator: ReplyGenerator | null): void {
  replyGenerator = generator;
}

type Completion = {
  error?: { message?: string; code?: number | string };
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: unknown; refusal?: string | null };
  }>;
};

/** Text of the first choice, or null for a refusal, a filter stop, or a null/empty body. */
export function contentFromCompletion(payload: Completion): string | null {
  if (payload.error) throw new Error(`OpenRouter error: ${payload.error.message ?? payload.error.code ?? "unknown"}`);
  const choice = payload.choices?.[0];
  if (!choice) return null;
  if (choice.finish_reason === "content_filter") return null;
  const message = choice.message;
  if (!message || (typeof message.refusal === "string" && message.refusal.trim())) return null;
  const content = message.content;
  const text = Array.isArray(content)
    ? content
        .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
        .join("")
    : typeof content === "string"
      ? content
      : "";
  return text.trim() ? text : null;
}

async function requestOnce(
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
  situation: string,
  models: string[],
): Promise<string | null> {
  let maxTokens = REPLY_MAX_TOKENS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = buildOpenRouterChatRequest(ctx, history, userText, situation, { models, maxTokens });
    const response = await fetch(request.url, {
      method: "POST",
      headers: {
        ...request.headers,
        Authorization: `Bearer ${config.openRouterApiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    if (response.status === 402 && maxTokens > REPLY_MAX_TOKENS_LOW_CREDIT) {
      maxTokens = REPLY_MAX_TOKENS_LOW_CREDIT;
      continue;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
    }
    return contentFromCompletion((await response.json()) as Completion);
  }
  return null;
}

/**
 * Tries the model chain in order. OpenRouter fails over on provider errors inside one request,
 * and this loop moves to the next model when a model refuses or returns nothing usable.
 */
export async function completeReply(
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
  situation = "",
): Promise<string> {
  if (replyGenerator) return replyGenerator(ctx, history, userText, situation);
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const chain = openRouterModelChain();
  let failure: Error = new Error("OpenRouter returned no usable reply.");
  for (let index = 0; index < chain.length; index += 1) {
    try {
      const content = await requestOnce(ctx, history, userText, situation, chain.slice(index));
      if (replyIsUsable(content)) return content as string;
      failure = new Error(`OpenRouter reply from ${chain[index]} was empty, refused, or unusable.`);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw failure;
}
