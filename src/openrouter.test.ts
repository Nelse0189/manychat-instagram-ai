import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { config, openRouterModelChain } from "./config.js";
import {
  REPLY_MAX_TOKENS,
  REPLY_MAX_TOKENS_LOW_CREDIT,
  buildOpenRouterChatRequest,
  cacheSessionId,
  completeReply,
  contentFromCompletion,
} from "./openrouter.js";
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

test("the model chain is GPT-5, then Grok 4.7, then one more, with no duplicates", () => {
  const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(source, /OPENROUTER_MODEL \?\? "openai\/gpt-5"/);
  assert.match(example, /^OPENROUTER_MODEL=openai\/gpt-5$/m);
  assert.match(example, /^OPENROUTER_FALLBACK_MODELS=x-ai\/grok-4\.7,/m);
  const chain = openRouterModelChain();
  assert.equal(chain[0], config.openRouterModel);
  assert.equal(new Set(chain).size, chain.length);
  assert.ok(chain.length >= 2 && chain.length <= 3);
});

test("the outgoing request caches only the stable system prompt and appends turn info after it", () => {
  const history: ChatMessage[] = [
    { role: "user", text: "heyy", createdAt: "2026-10-01T10:00:00.000Z" },
    { role: "assistant", text: "heyy, whats up", createdAt: "2026-10-01T10:01:00.000Z" },
    { role: "user", text: "not much u?", createdAt: "2026-10-01T15:01:00.000Z" },
  ];
  const userText = "how much is one photo";
  const request = buildOpenRouterChatRequest(ctx, history, userText);
  const sessionId = cacheSessionId(ctx.shopHandle);

  assert.deepEqual(request.body.models, openRouterModelChain());
  assert.equal("model" in request.body, false);
  assert.equal(request.body.max_tokens, REPLY_MAX_TOKENS);
  assert.ok(REPLY_MAX_TOKENS >= 300);
  assert.deepEqual(request.body.reasoning, { effort: "minimal" });
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
  assert.doesNotMatch(block?.text ?? "", /This turn:/);
  assert.doesNotMatch(block?.text ?? "", /how much is one photo/);

  assert.equal(language?.role, "system");
  assert.equal(language?.content, turnInstruction(ctx));

  const last = rest.at(-1);
  assert.equal(last?.role, "user");
  assert.equal(last?.content, userText);
  assert.equal(JSON.stringify(rest).includes("cache_control"), false);

  const transcript = rest.slice(0, -1);
  assert.equal(transcript[0]?.content, "heyy");
  assert.equal(transcript[1]?.content, "heyy, whats up");
  assert.equal(transcript[2]?.content, "[5 hours later] not much u?");

  const situation = "They picked One photo at $15.";
  const withSituation = buildOpenRouterChatRequest(ctx, history, userText, situation);
  const cachedAgain = withSituation.body.messages[0];
  assert.ok(Array.isArray(cachedAgain?.content));
  assert.equal(cachedAgain.content[0]?.text, systemPrompt(ctx));
  assert.equal(withSituation.body.messages[2]?.content, situation);
  assert.equal(JSON.stringify(withSituation.body.messages[2]).includes("cache_control"), false);
  assert.equal(withSituation.body.messages.at(-1)?.content, userText);

  const spanish = buildOpenRouterChatRequest({ ...ctx, language: "es" }, history, "quiero una foto");
  const spanishCached = spanish.body.messages[0];
  assert.ok(Array.isArray(spanishCached?.content));
  assert.equal(spanishCached.content[0]?.text, systemPrompt(ctx));
  assert.equal(spanish.body.messages[1]?.content, turnInstruction({ ...ctx, language: "es" }));
});

test("the request carries the last 20 turns", () => {
  const history: ChatMessage[] = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `m${index}`,
    createdAt: "",
  }));
  const request = buildOpenRouterChatRequest(ctx, history, "latest");
  const contents = request.body.messages.slice(2).map((message) => message.content);
  assert.equal(contents.length, 21);
  assert.equal(contents[0], "m10");
  assert.equal(contents.at(-2), "m29");
});

test("completions with a refusal, a filter stop, or a null body have no text", () => {
  assert.equal(contentFromCompletion({ choices: [{ message: { content: null } }] }), null);
  assert.equal(contentFromCompletion({ choices: [{ message: { content: "  " } }] }), null);
  assert.equal(contentFromCompletion({ choices: [] }), null);
  assert.equal(
    contentFromCompletion({ choices: [{ message: { content: "hi", refusal: "I can't help with that." } }] }),
    null,
  );
  assert.equal(
    contentFromCompletion({ choices: [{ finish_reason: "content_filter", message: { content: "hi" } }] }),
    null,
  );
  assert.equal(contentFromCompletion({ choices: [{ message: { content: "heyy" } }] }), "heyy");
  assert.equal(
    contentFromCompletion({ choices: [{ message: { content: [{ type: "text", text: "hey" }, { type: "text", text: "y" }] } }] }),
    "heyy",
  );
  assert.throws(() => contentFromCompletion({ error: { message: "boom" } }), /boom/);
});

type FetchCall = { models: string[]; maxTokens: number };

async function withFetch(
  responses: Array<{ status?: number; body: unknown }>,
  run: (calls: FetchCall[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const previousKey = config.openRouterApiKey;
  const calls: FetchCall[] = [];
  config.openRouterApiKey = "test-key";
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { models: string[]; max_tokens: number };
    calls.push({ models: body.models, maxTokens: body.max_tokens });
    const next = responses[calls.length - 1] ?? responses.at(-1)!;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    config.openRouterApiKey = previousKey;
  }
}

const ok = (content: unknown, extra: Record<string, unknown> = {}) => ({
  body: { choices: [{ message: { content, ...extra } }] },
});

test("a refused or empty first model moves on to the next model in the chain", async () => {
  const chain = openRouterModelChain();
  await withFetch(
    [ok(null), ok("I'm sorry, but I can't help with that."), ok("lol hey you")],
    async (calls) => {
      const reply = await completeReply(ctx, [], "hey", "");
      assert.equal(reply, "lol hey you");
      assert.equal(calls.length, 3);
      assert.deepEqual(calls[0]?.models, chain);
      assert.deepEqual(calls[1]?.models, chain.slice(1));
    },
  );
});

test("when every model fails the call throws so the caller can use a casual fallback", async () => {
  await withFetch([ok(null)], async (calls) => {
    await assert.rejects(() => completeReply(ctx, [], "hey", ""), /empty, refused, or unusable/);
    assert.equal(calls.length, openRouterModelChain().length);
  });
});

test("a 402 on the larger cap retries once with a smaller one", async () => {
  await withFetch([{ status: 402, body: { error: { message: "credits" } } }, ok("hey")], async (calls) => {
    assert.equal(await completeReply(ctx, [], "hey", ""), "hey");
    assert.equal(calls[0]?.maxTokens, REPLY_MAX_TOKENS);
    assert.equal(calls[1]?.maxTokens, REPLY_MAX_TOKENS_LOW_CREDIT);
  });
});
