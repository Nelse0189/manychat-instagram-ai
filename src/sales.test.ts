import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "./memoryStore.js";
import { handleIncoming } from "./handleIncoming.js";
import { parseIncoming } from "./manychat.js";
import { decideDeterministic, systemPrompt, type SalesContext } from "./sales.js";

const ctx: SalesContext = {
  shopHandle: "arial_luxe",
  paymentsEnabled: false,
  venmoHandle: "bluejays0137",
  cashAppTag: "Arialarias",
  optedOut: false,
  openOrder: null,
};

test("catalog reply uses the draft prices and does not mention payment handles", () => {
  const decision = decideDeterministic("CATALOG", ctx);
  assert.ok(decision);
  assert.match(decision.reply, /\$15 USD/);
  assert.match(decision.reply, /\$40 USD/);
  assert.match(decision.reply, /\$60 USD/);
  assert.doesNotMatch(decision.reply, /venmo|cash app/i);
});

test("stop opts the contact out", () => {
  const decision = decideDeterministic("STOP", ctx);
  assert.equal(decision?.intent, "opt_out");
});

test("a pack quote stays closed while payments are disabled", () => {
  const decision = decideDeterministic("three photos", ctx);
  assert.equal(decision?.packId, "photo_3");
  assert.equal(decision?.orderAction, "quote");
  assert.match(decision!.reply, /Checkout is not open yet/);
  assert.doesNotMatch(decision!.reply, /bluejays0137|Arialarias/);
});

test("unrelated numbers do not select a pack", () => {
  assert.equal(decideDeterministic("I have 3 questions about delivery", ctx), null);
});

test("payment claim without an order does not invent a reference", () => {
  const decision = decideDeterministic("I paid", {
    ...ctx,
    paymentsEnabled: true,
  });
  assert.match(decision!.reply, /don't have an open order/i);
  assert.equal(decision?.orderAction, null);
});

test("choosing a photo pack quotes that pack when payments are open", () => {
  const decision = decideDeterministic("ONE PHOTO", {
    ...ctx,
    paymentsEnabled: true,
    cashAppTag: "Arialluxe",
  });
  assert.equal(decision?.orderAction, "quote");
  assert.equal(decision?.reply, "");
});

test("handleIncoming tells the client where to send the money", async () => {
  const store = createMemoryStore();
  const decision = await handleIncoming(store, {
    subscriberId: "123",
    text: "ONE PHOTO",
    firstName: "Sam",
    igUsername: "sam",
  });
  assert.match(decision.reply, /15 USD/);
  assert.match(decision.reply, /Venmo @bluejays0137/);
  assert.match(decision.reply, /Cash App \$Arialluxe/);
  assert.match(decision.reply, /send me a screenshot/i);
  assert.doesNotMatch(decision.reply, /not treated as payment|screenshot is not/i);
  const orders = await store.listOrders("quoted");
  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.amountUsd, 15);
  const messages = await store.recentMessages("123", 10);
  assert.equal(messages.length, 2);
});

test("saying they paid asks for a screenshot and does not release files", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "123",
    text: "ONE PHOTO",
    firstName: "Sam",
    igUsername: "sam",
  });
  const decision = await handleIncoming(store, {
    subscriberId: "123",
    text: "I paid",
    firstName: "Sam",
    igUsername: "sam",
  });
  assert.match(decision.reply, /send me a screenshot/i);
  assert.doesNotMatch(decision.reply, /\/downloads\/|flagged|not treated as payment/i);
  assert.equal((await store.listOrders("verified")).length, 0);
  assert.equal((await store.listOrders("pending_verification")).length, 1);
});

test("a screenshot placeholder fulfills an open order with download links", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "123",
    text: "ONE PHOTO",
    firstName: "Sam",
    igUsername: "sam",
  });
  const incoming = parseIncoming({ id: "123", last_input_text: "[image]" });
  assert.equal(incoming?.paymentScreenshot, true);
  const decision = await handleIncoming(store, incoming!);
  assert.match(decision.reply, /Got the screenshot/);
  assert.match(decision.reply, /\/downloads\//);
  const orders = await store.listOrders("verified");
  assert.equal(orders.length, 1);
  assert.ok(orders[0]?.downloadToken);
});

test("a ManyChat image url, attachment, or message type counts as a screenshot", () => {
  assert.equal(
    parseIncoming({
      id: "1",
      last_input_text: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=99",
    })?.paymentScreenshot,
    true,
  );
  assert.equal(
    parseIncoming({
      id: "1",
      last_input_text: "",
      attachments: [
        {
          type: "image",
          payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2" },
        },
      ],
    })?.paymentScreenshot,
    true,
  );
  assert.equal(
    parseIncoming({ id: "1", last_input_text: "", message_type: "image" })?.paymentScreenshot,
    true,
  );
  assert.equal(
    parseIncoming({
      id: "1",
      last_input_text: "",
      media_url: "https://example.com/receipt.png",
    })?.paymentScreenshot,
    true,
  );
  assert.equal(parseIncoming({ id: "1", last_input_text: "[audio]" })?.paymentScreenshot, false);
  assert.equal(
    parseIncoming({
      id: "1",
      last_input_text: "hello",
      profile_pic: "https://cdninstagram.com/subscribers/big.jpg",
    })?.paymentScreenshot,
    false,
  );
});

test("an image with no open order does not release files", async () => {
  const store = createMemoryStore();
  const incoming = parseIncoming({
    id: "999",
    last_input_text: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=5",
  });
  const decision = await handleIncoming(store, incoming!);
  assert.match(decision.reply, /don't have an order open/i);
  assert.doesNotMatch(decision.reply, /\/downloads\//);
  assert.equal((await store.listOrders()).length, 0);
});

test("saying the screenshot is attached fulfills the open order", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "123",
    text: "THREE PHOTOS",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "123",
    text: "here's the screenshot",
    firstName: null,
    igUsername: null,
  });
  assert.match(decision.reply, /Got the screenshot/);
  assert.match(decision.reply, /\/downloads\//);
  assert.equal((await store.listOrders("verified")).length, 1);
});

test("model instructions ask for a screenshot", () => {
  const prompt = systemPrompt({ ...ctx, paymentsEnabled: true, cashAppTag: "Arialluxe" });
  assert.match(prompt, /ask for a screenshot/i);
  assert.match(prompt, /Cash App \$Arialluxe/);
  assert.doesNotMatch(prompt, /screenshot as verified payment|not treated as payment|screenshot is not/i);
});
