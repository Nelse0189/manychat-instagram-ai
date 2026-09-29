import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOpenRouterChatRequest, cacheSessionId } from "./openrouter.js";
import { systemPrompt, turnInstruction, type SalesContext } from "./sales.js";
import type { ChatMessage } from "./types.js";

const ctx: SalesContext = {
  shopHandle: "arial_luxe",
  paymentsEnabled: true,
  venmoHandle: "bluejays0137",
  cashAppTag: "Arialluxe",
  optedOut: false,
  openOrder: null,
  language: "en",
};

test("the code default model is the listed Grok 4.7 id", () => {
  const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(source, /OPENROUTER_MODEL \?\? "x-ai\/grok-4\.7"/);
  assert.match(example, /^OPENROUTER_MODEL=x-ai\/grok-4\.7$/m);
  assert.doesNotMatch(source, /anthropic\/|openai\/gpt/i);
  assert.doesNotMatch(example, /anthropic\/|openai\/gpt/i);
});

test("the outgoing request caches only the stable system prompt", () => {
  const history: ChatMessage[] = [
    { role: "user", text: "heyy", createdAt: "" },
    { role: "assistant", text: "heyy, photos or videos?", createdAt: "" },
  ];
  const userText = "how much is one photo";
  const request = buildOpenRouterChatRequest(ctx, history, userText);
  const sessionId = cacheSessionId(ctx.shopHandle);

  assert.equal(request.body.model, process.env.OPENROUTER_MODEL ?? "x-ai/grok-4.7");
  assert.equal(request.body.max_tokens, 400);
  assert.equal(request.body.temperature, 0.8);
  assert.equal(request.body.session_id, sessionId);
  assert.equal(request.headers["x-session-id"], sessionId);
  assert.equal(request.headers["x-grok-conv-id"], sessionId);
  assert.equal(request.headers.Authorization, undefined);

  const [cached, language, ...rest] = request.body.messages;
  assert.equal(cached?.role, "system");
  assert.ok(Array.isArray(cached?.content));
  const block = cached.content[0];
  assert.equal(block?.type, "text");
  assert.equal(block?.text, systemPrompt(ctx));
  assert.deepEqual(block?.cache_control, { type: "ephemeral" });
  assert.doesNotMatch(block?.text ?? "", /This turn is English|This turn is Spanish/);
  assert.doesNotMatch(block?.text ?? "", /how much is one photo/);

  assert.equal(language?.role, "system");
  assert.equal(language?.content, turnInstruction(ctx));
  assert.equal(typeof language?.content, "string");

  const last = rest.at(-1);
  assert.equal(last?.role, "user");
  assert.equal(last?.content, userText);
  assert.equal(JSON.stringify(rest).includes("cache_control"), false);
  assert.equal(JSON.stringify(language).includes("cache_control"), false);

  const situation = "They brought up One photo at $15. Mention the price only if this message calls for it.";
  const withSituation = buildOpenRouterChatRequest(ctx, history, userText, situation);
  const cachedNote = withSituation.body.messages[0];
  assert.ok(Array.isArray(cachedNote?.content));
  assert.equal(cachedNote.content[0]?.text, systemPrompt(ctx));
  assert.doesNotMatch(cachedNote.content[0]?.text ?? "", /One photo at \$15/);
  assert.equal(withSituation.body.messages.at(-1)?.content, userText);
  assert.equal(JSON.stringify(withSituation.body.messages.at(-1)).includes("cache_control"), false);
  const situationMessage = withSituation.body.messages.find((message) => message.content === situation);
  assert.ok(situationMessage);
  assert.equal(JSON.stringify(situationMessage).includes("cache_control"), false);

  const spanish = buildOpenRouterChatRequest({ ...ctx, language: "es" }, history, "quiero una foto");
  const spanishCached = spanish.body.messages[0];
  assert.ok(Array.isArray(spanishCached?.content));
  assert.equal(spanishCached.content[0]?.text, systemPrompt(ctx));
  assert.equal(spanish.body.messages[1]?.content, turnInstruction({ ...ctx, language: "es" }));
  assert.equal(spanish.body.messages.at(-1)?.content, "quiero una foto");
});
