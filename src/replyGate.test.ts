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

test("a follow-up after the first reply waits 0 to 3 minutes and does not sleep", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  let modelCalls = 0;
  setReplyGenerator(async (_ctx, history, userText) => {
    modelCalls += 1;
    return JSON.stringify({
      reply: `folded ${history.filter((message) => message.role === "user").map((message) => message.text).join("|")} :: ${userText}`,
      intent: "other",
    });
  });
  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("hey"),
    now: NOW,
    random: () => 0,
    pause: async () => {
      throw new Error("webhook must not pause");
    },
  });
  await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async () => undefined,
  });
  assert.equal(await store.hasAssistantReply("sub-1"), true);

  const followUpAt = Date.now() + 1_000;
  const started = Date.now();
  const followUp = await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("what are you doing"),
    now: followUpAt,
    random: () => 0.5,
    pause: async () => {
      throw new Error("webhook must not pause");
    },
  });
  const dueAt = new Date(followUpAt + 90 * 1000).toISOString();
  assert.ok(Date.now() - started < 1000);
  assert.equal(responseHasCustomerText(followUp.body), false);
  assert.equal(scheduler.calls.length, 2);
  assert.equal(scheduler.calls[1]?.dueAt, dueAt);
  assert.equal((await store.getPendingReply("sub-1"))?.dueAt, dueAt);
  assert.equal(modelCalls, 1);

  await acceptShopMessage({
    store,
    scheduler,
    incoming: incoming("you around?"),
    now: followUpAt + 5_000,
    random: () => {
      throw new Error("a later message must not roll a new delay");
    },
    pause: async () => {
      throw new Error("webhook must not pause");
    },
  });
  assert.equal(scheduler.calls.length, 2);
  assert.equal((await store.getPendingReply("sub-1"))?.dueAt, dueAt);

  const sent: Decision[] = [];
  const outcome = await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async (_id, decision) => {
      sent.push(decision);
    },
  });
  assert.equal(outcome, "sent");
  assert.equal(sent[0]?.reply, "folded hey|what are you doing :: you around?");
  assert.equal(await store.getPendingReply("sub-1"), null);
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

test("a reply with several bubbles goes out one at a time with typing pauses", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  setReplyGenerator(async () => "lol hey you\nwhat are you up to tonight");
  await acceptShopMessage({ store, scheduler, incoming: incoming("hey"), now: NOW, random: () => 0.5 });

  const sent: Decision[] = [];
  const pauses: number[] = [];
  await deliverScheduledReply({
    store,
    subscriberId: "sub-1",
    send: async (_id, decision) => {
      sent.push(decision);
    },
    pause: async (ms) => {
      pauses.push(ms);
    },
    random: () => 0.5,
  });

  assert.deepEqual(sent.map((decision) => decision.reply), ["lol hey you", "what are you up to tonight"]);
  assert.ok(sent.every((decision) => (decision.media?.length ?? 0) === 0));
  assert.equal(pauses.length, 1);
  assert.ok(pauses[0]! > 0 && pauses[0]! <= 4_000);
  const messages = await store.recentMessages("sub-1", 10);
  assert.equal(messages.at(-1)?.role, "assistant");
  assert.equal(messages.at(-1)?.text, "lol hey you\nwhat are you up to tonight");
});

test("a failure after the first bubble keeps what was sent and does not resend it", async () => {
  const store = createMemoryStore();
  const scheduler = schedulerSpy();
  setReplyGenerator(async () => "one\ntwo\nthree");
  await acceptShopMessage({ store, scheduler, incoming: incoming("hey"), now: NOW, random: () => 0.5 });
  let calls = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    await deliverScheduledReply({
      store,
      subscriberId: "sub-1",
      send: async () => {
        calls += 1;
        if (calls === 2) throw new Error("ManyChat down");
      },
      pause: async () => {},
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(calls, 2);
  assert.equal((await store.recentMessages("sub-1", 10)).at(-1)?.text, "one");
  assert.equal(await store.getPendingReply("sub-1"), null);
});

test("manychat content splits a reply into one text message per bubble", () => {
  const decision: Decision = {
    reply: "lol ok\nsend it over",
    intent: "other",
    needsHuman: false,
    useModel: false,
    packId: null,
    orderAction: null,
    media: [{ type: "image", url: "https://x.test/1" }],
  };
  assert.deepEqual(contentMessages(decision), [
    { type: "text", text: "lol ok" },
    { type: "text", text: "send it over" },
    { type: "image", url: "https://x.test/1" },
  ]);
});
