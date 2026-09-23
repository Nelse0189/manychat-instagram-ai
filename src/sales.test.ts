import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "./memoryStore.js";
import { handleIncoming } from "./handleIncoming.js";
import { decideDeterministic, type SalesContext } from "./sales.js";

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
  const orders = await store.listOrders("quoted");
  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.amountUsd, 15);
  const messages = await store.recentMessages("123", 10);
  assert.equal(messages.length, 2);
});
