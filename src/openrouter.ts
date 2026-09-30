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

export type OpenRouterChatRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    temperature: number;
    max_tokens: number;
    session_id: string;
    reasoning: { effort: "minimal" };
    messages: ChatRequestMessage[];
  };
};

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
      // GPT-5 spends this budget on reasoning unless effort is minimal, and a
      // larger cap is rejected when the key cannot pre-authorize it.
      max_tokens: 100,
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
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty reply.");
  return content;
}
