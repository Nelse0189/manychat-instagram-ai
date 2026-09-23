import { config } from "./config.js";
import { systemPrompt, type SalesContext } from "./sales.js";
import type { ChatMessage } from "./types.js";

export async function completeReply(
  ctx: SalesContext,
  history: ChatMessage[],
  userText: string,
): Promise<string> {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const messages = [
    { role: "system", content: systemPrompt(ctx) },
    ...history.slice(-12).map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content: userText },
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicBaseUrl || "http://localhost",
      "X-Title": "Arial Luxe shop assistant",
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      temperature: 0.2,
      messages,
    }),
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
