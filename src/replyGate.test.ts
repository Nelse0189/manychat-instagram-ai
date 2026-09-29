import assert from "node:assert/strict";
import test from "node:test";
import type { ReplyScheduler } from "./cloudTasks.js";
import { contentMessages } from "./manychat.js";
import { createMemoryStore } from "./memoryStore.js";
import { setReplyGenerator } from "./openrouter.js";
import { acceptShopMessage, deliverScheduledReply, responseHasCustomerText } from "./replyGate.js";
import type { Decision, IncomingMessage } from "./types.js";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");

function schedulerSpy(): ReplyScheduler & { calls: Array<{ subscriberId: string; dueAt: string }> } {
  const calls: Array<{ subscriberId: string; dueAt: string }> = [];
  return {
    calls,
    async schedule(input) {
      calls.push(input);
      return `projects/arial-luxe-shop/locations/us-central1/queues/shop-assistant-replies/tasks/first-${input.subscriberId}`;
    },
  };
}

function incoming(text: string, extra: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    subscriberId: "sub-1",
    text,
    firstName: "Sam",
    igUsername: "sam",
    ...extra,
  };
}

test("the first webhook returns without a customer reply and schedules one Cloud Task", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  let grokCalls = 0;
  const pauses: number[] = [];
  setReplyGenerator(async () => {
    grokCalls += 1;
    return JSON.stringify({ reply: "should wait", intent: "other" });
  });

  const started = Date.now();
  const result = await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("hey"),
    now: NOW,
    random: () => 0.5,
    pause: async (ms) => {
      pauses.push(ms);
    },
  });

  assert.ok(Date.now() - started < 1000);
  assert.equal(pauses.length, 0);
  assert.equal(grokCalls, 0);
  assert.equal(responseHasCustomerText(result.body), false);
  assert.deepEqual((result.body.content as { messages: unknown[] }).messages, []);
  assert.equal(scheduler.calls.length, 1);
  assert.equal(scheduler.calls[0]?.dueAt, new Date(NOW + 5 * 60 * 1000).toISOString());
  assert.equal(await store.hasAssistantReply("sub-1"), false);
  const pending = await store.getPendingReply("sub-1");
  assert.equal(pending?.dueAt, scheduler.calls[0]?.dueAt);
  assert.ok(pending?.taskName);
});

test("messages before the first reply fold into the same task", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  let grokCalls = 0;
  setReplyGenerator(async (_ctx, history, userText) => {
    grokCalls += 1;
    return JSON.stringify({
      reply: `folded ${history.map((message) => message.text).join("|")} :: ${userText}`,
      intent: "other",
    });
  });

  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("hey"),
    now: NOW,
    random: () => 0.25,
    pause: async () => {
      throw new Error("deferred webhook must not pause");
    },
  });
  const dueAt = (await store.getPendingReply("sub-1"))?.dueAt;
  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("you around?"),
    now: NOW + 60_000,
    random: () => {
      throw new Error("a later message must not roll a new delay");
    },
    pause: async () => {
      throw new Error("deferred webhook must not pause");
    },
  });

  assert.equal(scheduler.calls.length, 1);
  assert.equal((await store.getPendingReply("sub-1"))?.dueAt, dueAt);
  assert.equal(grokCalls, 0);
  const history = await store.recentMessages("sub-1", 10);
  assert.deepEqual(
    history.map((message) => message.text),
    ["hey", "you around?"],
  );

  const sent: Decision[] = [];
  const outcome = await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async (_id, decision) => {
      sent.push(decision);
    },
  });
  assert.equal(outcome, "sent");
  assert.equal(grokCalls, 1);
  assert.equal(sent[0]?.reply, "folded hey :: you around?");
  assert.equal(await store.getPendingReply("sub-1"), null);
  assert.equal(await store.hasAssistantReply("sub-1"), true);
});

test("a follow-up after the first reply returns immediately", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  setReplyGenerator(async (_ctx, _history, userText) => {
    return JSON.stringify({ reply: `model saw: ${userText}`, intent: "other" });
  });
  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("hey"),
    now: NOW,
    random: () => 0,
    pause: async () => undefined,
  });
  await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async () => undefined,
  });

  const pauses: number[] = [];
  const started = Date.now();
  const followUp = await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("what are you doing"),
    now: NOW + 11 * 60 * 1000,
    random: () => {
      throw new Error("an answered conversation must not roll a 0-10 minute delay");
    },
    pause: async (ms) => {
      pauses.push(ms);
    },
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal(scheduler.calls.length, 1);
  assert.equal(pauses.length, 1);
  assert.ok((pauses[0] ?? 0) <= 4_000);
  assert.equal(responseHasCustomerText(followUp.body), true);
  const messages = (followUp.body.content as { messages: Array<{ text?: string }> }).messages;
  assert.equal(messages[0]?.text, "model saw: what are you doing");
});

test("saying they paid does not attach files, and a payment screen does", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  setReplyGenerator(async () => JSON.stringify({ reply: "model reply", intent: "other" }));

  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("ONE PHOTO"),
    now: NOW,
    random: () => 0.1,
    pause: async () => undefined,
  });
  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("I paid"),
    now: NOW + 1_000,
    pause: async () => undefined,
  });
  const claimed = await store.getPendingReply("sub-1");
  assert.equal(claimed?.media.length, 0);
  assert.equal(claimed?.sawPaymentScreenshot, false);
  assert.equal(claimed?.filesReady, false);
  const pendingOrder = (await store.listOrders())[0];
  assert.equal(pendingOrder?.status, "pending_verification");

  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("[image]", { paymentScreenshot: true }),
    now: NOW + 2_000,
    pause: async () => undefined,
  });
  const ready = await store.getPendingReply("sub-1");
  assert.equal(ready?.filesReady, true);
  assert.ok((ready?.media.length ?? 0) > 0);
  assert.equal((await store.listOrders("verified")).length, 1);
  assert.equal(scheduler.calls.length, 1);
  assert.equal(ready?.dueAt, claimed?.dueAt);

  const sent: Decision[] = [];
  await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async (_id, decision) => {
      sent.push(decision);
    },
  });
  const messages = contentMessages(sent[0]!);
  assert.equal(messages[0]?.type, "text");
  assert.ok(messages.some((message) => message.type === "image" || message.type === "video"));
  assert.equal(messages.filter((message) => message.type !== "text").length, ready?.media.length);
});
