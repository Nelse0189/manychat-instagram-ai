import { packById } from "./catalog.js";
import { config } from "./config.js";
import { releaseOrderFiles } from "./fulfill.js";
import { orderReference } from "./memoryStore.js";
import type { Store } from "./store.js";
import { emptySubscriber } from "./store.js";
import type { Decision, IncomingMessage } from "./types.js";
import {
  customerReplyText,
  decideDeterministic,
  decisionFromModel,
  modelSituation,
  resolveReplyLanguage,
  supportText,
  textShowsPaymentScreenshot,
  type ReplyLanguage,
  type SalesContext,
} from "./sales.js";
import { completeReply } from "./openrouter.js";
import type { OutboundMedia } from "./types.js";

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

  let media: OutboundMedia[] = [];
  let filesFailed = false;
  if (decision?.orderAction === "fulfill" && openOrder) {
    const released = await releaseOrderFiles(store, openOrder);
    if ("media" in released && released.media.length > 0) {
      media = released.media;
    } else {
      filesFailed = true;
      decision = { ...decision, needsHuman: true, orderAction: null };
    }
  }

  if (!decision || decision.useModel) {
    const situation = modelSituation(incoming.text, ctx, {
      paymentScreenshot,
      filesReady: media.length > 0,
      filesFailed,
    });
    try {
      const raw = await completeReply(ctx, history, incoming.text, situation);
      const reply = customerReplyText(raw);
      if (!decision) {
        decision = decisionFromModel(raw, ctx);
        decision = { ...decision, reply: reply || decision.reply };
      } else if (reply) {
        decision = { ...decision, reply };
      }
    } catch {
      if (!decision) {
        decision = {
          reply: supportText(language),
          intent: "support",
          needsHuman: true,
          useModel: false,
          packId: null,
          orderAction: null,
          media: [],
        };
      } else if (!decision.reply) {
        decision = { ...decision, reply: supportText(language) };
      }
    }
  }

  if (!decision) {
    decision = {
      reply: supportText(language),
      intent: "support",
      needsHuman: true,
      useModel: false,
      packId: null,
      orderAction: null,
      media: [],
    };
  }
  if (!decision.reply) decision = { ...decision, reply: supportText(language) };

  if (decision.orderAction === "quote" && decision.packId) {
    const pack = packById(decision.packId);
    if (pack) {
      await store.createOrder({
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
    }
  }

  if (media.length > 0) {
    decision = { ...decision, media, needsHuman: false };
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
