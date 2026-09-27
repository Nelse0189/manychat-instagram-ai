import { packById } from "./catalog.js";
import { config } from "./config.js";
import { releaseOrderFiles } from "./fulfill.js";
import { orderReference } from "./memoryStore.js";
import type { Store } from "./store.js";
import { emptySubscriber } from "./store.js";
import type { Decision, IncomingMessage } from "./types.js";
import {
  decideDeterministic,
  decisionFromModel,
  filesReadyText,
  filesUnavailableText,
  paymentInstructions,
  resolveReplyLanguage,
  textShowsPaymentScreenshot,
  type ReplyLanguage,
  type SalesContext,
} from "./sales.js";
import { completeReply } from "./openrouter.js";

function salesContext(
  openOrder: Awaited<ReturnType<Store["latestOpenOrder"]>>,
  optedOut: boolean,
  language: ReplyLanguage,
): SalesContext {
  return {
    shopHandle: config.shopHandle,
    paymentsEnabled: config.paymentsEnabled,
    venmoHandle: config.venmoHandle,
    cashAppTag: config.cashAppTag,
    optedOut,
    openOrder,
    language,
  };
}

export async function handleIncoming(store: Store, incoming: IncomingMessage): Promise<Decision> {
  const existing = await store.getSubscriber(incoming.subscriberId);
  const subscriber = existing ?? emptySubscriber(incoming);
  subscriber.firstName = incoming.firstName ?? subscriber.firstName;
  subscriber.igUsername = incoming.igUsername ?? subscriber.igUsername;

  const openOrder = await store.latestOpenOrder(incoming.subscriberId);
  const history = await store.recentMessages(incoming.subscriberId, 12);
  const language = resolveReplyLanguage(incoming.text, history);
  const ctx = salesContext(openOrder, subscriber.optedOut, language);
  const paymentScreenshot =
    incoming.paymentScreenshot === true || textShowsPaymentScreenshot(incoming.text);
  let decision = decideDeterministic(incoming.text, ctx, { paymentScreenshot });

  if (!decision) {
    const raw = await completeReply(ctx, history, incoming.text);
    decision = decisionFromModel(raw, ctx);
  }

  if (decision.orderAction === "quote" && decision.packId) {
    const pack = packById(decision.packId);
    if (pack) {
      const order = await store.createOrder({
        reference: orderReference(),
        subscriberId: incoming.subscriberId,
        packId: pack.id,
        packName: pack.name,
        amountUsd: pack.priceUsd,
        currency: "USD",
        status: "quoted",
        fileNames: [],
        downloadToken: null,
      });
      if (config.paymentsEnabled) {
        decision = { ...decision, reply: paymentInstructions(order, ctx) };
      }
    }
  }

  if (decision.orderAction === "fulfill" && openOrder) {
    const released = await releaseOrderFiles(store, openOrder);
    if ("media" in released && released.media.length > 0) {
      decision = {
        ...decision,
        reply: filesReadyText(language),
        media: released.media,
        needsHuman: false,
      };
    } else {
      decision = {
        ...decision,
        reply: filesUnavailableText(language),
        needsHuman: true,
        orderAction: null,
      };
    }
  }

  if (decision.orderAction === "claim_payment" && openOrder) {
    await store.updateOrderStatus(openOrder.id, "pending_verification");
  }

  if (decision.intent === "opt_out") subscriber.optedOut = true;
  if (decision.intent === "browse" || decision.intent === "purchase") subscriber.optedOut = false;
  if (decision.needsHuman) subscriber.needsHuman = true;

  const now = new Date().toISOString();
  await store.saveSubscriber(subscriber);
  if (incoming.text) {
    await store.addMessage(incoming.subscriberId, {
      role: "user",
      text: incoming.text,
      createdAt: now,
    });
  }
  await store.addMessage(incoming.subscriberId, {
    role: "assistant",
    text: decision.reply,
    createdAt: now,
  });

  return decision;
}
