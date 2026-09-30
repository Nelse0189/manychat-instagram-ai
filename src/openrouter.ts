import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";
import { systemPrompt, turnInstruction, type SalesContext } from "./sales.js";
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

export type OpenRouterReasoning = { effort: "low" } | { enabled: false };

export type OpenRouterChatRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    temperature: number;
    max_tokens: number;
    session_id: string;
    reasoning: OpenRouterReasoning;
    messages: ChatRequestMessage[];
  };
};

const GROK_420 = "x-ai/grok-4.20";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

type UsageSlot = { usage: TokenUsage | null };
const usageSlots = new AsyncLocalStorage<UsageSlot>();

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function tokenUsageFromPayload(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const row = usage as Record<string, unknown>;
  const promptTokens = finiteNumber(row.prompt_tokens);
  const completionTokens = finiteNumber(row.completion_tokens);
  if (promptTokens == null || completionTokens == null) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens: finiteNumber(row.total_tokens) ?? promptTokens + completionTokens,
    costUsd: finiteNumber(row.cost),
  };
}

export async function captureTokenUsage<T>(
  run: () => Promise<T>,
): Promise<{ result: T; usage: TokenUsage | null }> {
  const slot: UsageSlot = { usage: null };
  const result = await usageSlots.run(slot, run);
  return { result, usage: slot.usage };
}

function rememberUsage(payload: unknown): void {
  const slot = usageSlots.getStore();
  if (slot) slot.usage = tokenUsageFromPayload(payload);
}

export function reasoningFor(model: string): OpenRouterReasoning {
  // Grok 4.20 treats reasoning as optional and off by default. Leaving it
  // off keeps a short shop text inside max_tokens. GPT models reject "none".
  if (model === GROK_420) return { enabled: false };
  return { effort: "low" };
}

export function maxTokensFor(model: string): number {
  return model === GROK_420 ? 160 : 60;
}

const PROMPT_CHAR_BUDGET = 1450;

function messageText(message: ChatRequestMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.text).join("");
}

export function fitChatMessages(messages: ChatRequestMessage[]): ChatRequestMessage[] {
  const fitted = messages.slice();
  const size = () => fitted.reduce((sum, message) => sum + messageText(message).length, 0);
  while (size() > PROMPT_CHAR_BUDGET) {
    const drop = fitted.findIndex(
      (message, index) => index < fitted.length - 1 && (message.role === "user" || message.role === "assistant"),
    );
    if (drop === -1) break;
    fitted.splice(drop, 1);
  }
  return fitted;
}

export function cacheSessionId(shopHandle: string): string {
  const handle = shopHandle.replace(/[^\w.-]/g, "").slice(0, 80) || "shop";
  return `arial-luxe-${handle}`.slice(0, 256);
}

export function buildOpenRouterChatRequest(
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
  situation = "",
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
    ...history.slice(-12).map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content: userText },
  );
  const fitted = fitChatMessages(messages);

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
      model: config.openRouterModel,
      temperature: 0.8,
      max_tokens: maxTokensFor(config.openRouterModel),
      reasoning: reasoningFor(config.openRouterModel),
      session_id: sessionId,
      messages: fitted,
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

  const request = buildOpenRouterChatRequest(ctx, history, userText, situation);
  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      ...request.headers,
      Authorization: `Bearer ${config.openRouterApiKey}`,
    },
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  rememberUsage(payload);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty reply.");
  return content;
}
