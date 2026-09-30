import { packById, type PackId } from "./catalog.js";
import { config } from "./config.js";
import { releaseOrderFiles } from "./fulfill.js";
import { orderReference } from "./memoryStore.js";
import type { Store } from "./store.js";
import { emptySubscriber } from "./store.js";
import type { ChatMessage, Decision, IncomingMessage, Order, OutboundMedia } from "./types.js";
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

function salesContext(
  openOrder: Order | null,
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

export type RecordedTurn = {
  ctx: SalesContext;
  history: ChatMessage[];
  language: ReplyLanguage;
  paymentScreenshot: boolean;
  decision: Decision | null;
  media: OutboundMedia[];
  filesReady: boolean;
  filesFailed: boolean;
  quoted: boolean;
  claimed: boolean;
  releasedPackId: PackId | null;
  releasedPackName: string | null;
};

function applySubscriberFlags(subscriber: { optedOut: boolean; needsHuman: boolean }, decision: Decision): void {
  if (decision.intent === "opt_out") subscriber.optedOut = true;
  if (decision.intent === "browse" || decision.intent === "purchase") subscriber.optedOut = false;
  if (decision.needsHuman) subscriber.needsHuman = true;
}

export async function recordIncoming(store: Store, incoming: IncomingMessage): Promise<RecordedTurn> {
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

  let quoted = false;
  if (decision?.orderAction === "quote" && decision.packId) {
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
      quoted = true;
    }
  }

  let claimed = false;
  if (decision?.orderAction === "claim_payment" && openOrder) {
    await store.updateOrderStatus(openOrder.id, "pending_verification");
    claimed = true;
  }

  if (decision) applySubscriberFlags(subscriber, decision);
  await store.saveSubscriber(subscriber);
  if (incoming.text) {
    await store.addMessage(incoming.subscriberId, {
      role: "user",
      text: incoming.text,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ctx,
    history,
    language,
    paymentScreenshot,
    decision,
    media,
    filesReady: media.length > 0,
    filesFailed,
    quoted,
    claimed,
    releasedPackId: media.length > 0 ? openOrder?.packId ?? null : null,
    releasedPackName: media.length > 0 ? openOrder?.packName ?? null : null,
  };
}

export async function composeCustomerReply(input: {
  store: Store;
  subscriberId: string;
  userText: string;
  history: ChatMessage[];
  ctx: SalesContext;
  language: ReplyLanguage;
  decision: Decision | null;
  media: OutboundMedia[];
  filesReady: boolean;
  filesFailed: boolean;
  paymentScreenshot: boolean;
  quoted: boolean;
  claimed: boolean;
}): Promise<Decision> {
  let decision = input.decision;
  const situation = modelSituation(input.userText, input.ctx, {
    paymentScreenshot: input.paymentScreenshot && !input.filesReady,
    filesReady: input.filesReady && Boolean(input.ctx.openOrder),
    filesFailed: input.filesFailed,
  });
  const situationText =
    input.filesReady && !input.ctx.openOrder
      ? `${situation} A payment-screen image arrived and the files go out as chat media after your text. Do not paste a link or an order code.`
      : situation;

  if (!decision || decision.useModel) {
    try {
      const raw = await completeReply(input.ctx, input.history, input.userText, situationText);
      const reply = customerReplyText(raw);
      if (!decision) {
        decision = decisionFromModel(raw, input.ctx);
        decision = { ...decision, reply: reply || decision.reply };
      } else if (reply) {
        decision = { ...decision, reply };
      }
    } catch {
      if (!decision) {
        decision = {
          reply: supportText(input.language),
          intent: "support",
          needsHuman: true,
          useModel: false,
          packId: null,
          orderAction: null,
          media: [],
        };
      } else if (!decision.reply) {
        decision = { ...decision, reply: supportText(input.language) };
      }
    }
  }

  if (!decision) {
    decision = {
      reply: supportText(input.language),
      intent: "support",
      needsHuman: true,
      useModel: false,
      packId: null,
      orderAction: null,
      media: [],
    };
  }
  if (!decision.reply) decision = { ...decision, reply: supportText(input.language) };

  if (decision.orderAction === "quote" && decision.packId && !input.quoted) {
    const pack = packById(decision.packId);
    if (pack) {
      await input.store.createOrder({
        reference: orderReference(),
        subscriberId: input.subscriberId,
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

  const media = input.media;
  if (media.length > 0) {
    decision = { ...decision, media, needsHuman: false };
  }

  if (decision.orderAction === "claim_payment" && input.ctx.openOrder && !input.claimed) {
    await input.store.updateOrderStatus(input.ctx.openOrder.id, "pending_verification");
  }

  const subscriber = await input.store.getSubscriber(input.subscriberId);
  if (subscriber) {
    applySubscriberFlags(subscriber, decision);
    await input.store.saveSubscriber(subscriber);
  }

  return decision;
}

export async function handleIncoming(store: Store, incoming: IncomingMessage): Promise<Decision> {
  const recorded = await recordIncoming(store, incoming);
  const decision = await composeCustomerReply({
    store,
    subscriberId: incoming.subscriberId,
    userText: incoming.text,
    history: recorded.history,
    ctx: recorded.ctx,
    language: recorded.language,
    decision: recorded.decision,
    media: recorded.media,
    filesReady: recorded.filesReady,
    filesFailed: recorded.filesFailed,
    paymentScreenshot: recorded.paymentScreenshot,
    quoted: recorded.quoted,
    claimed: recorded.claimed,
  });
  await store.addMessage(incoming.subscriberId, {
    role: "assistant",
    text: decision.reply,
    createdAt: new Date().toISOString(),
  });
  return decision;
}

export async function composeDeferredReply(store: Store, subscriberId: string): Promise<Decision> {
  const pending = await store.getPendingReply(subscriberId);
  const all = await store.recentMessages(subscriberId, 12);
  let lastUser = -1;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index]?.role === "user") {
      lastUser = index;
      break;
    }
  }
  const userText = lastUser >= 0 ? all[lastUser]?.text ?? "" : "";
  const history = lastUser >= 0 ? all.slice(0, lastUser) : all;
  const subscriber = await store.getSubscriber(subscriberId);
  const openOrder = await store.latestOpenOrder(subscriberId);
  const language = resolveReplyLanguage(userText, all);
  const filesReady = pending?.filesReady === true;
  const filesFailed = pending?.filesFailed === true && !filesReady;
  let burstStart = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "assistant") {
      burstStart = index + 1;
      break;
    }
  }
  const burst = history.slice(burstStart).some((message) => message.role === "user");
  const promptOrder =
    openOrder ??
    (filesReady && pending?.releasedPackName
      ? {
          id: "released",
          reference: "",
          subscriberId,
          packId: pending.releasedPackId ?? "photo_1",
          packName: pending.releasedPackName,
          amountUsd: 0,
          currency: "USD" as const,
          status: "quoted" as const,
          fileNames: [],
          downloadToken: null,
          createdAt: pending.createdAt,
          updatedAt: pending.updatedAt,
        }
      : null);
  const ctx = salesContext(promptOrder, subscriber?.optedOut ?? false, language);

  let decision: Decision | null = null;
  if (filesReady) {
    decision = {
      reply: "",
      useModel: true,
      intent: "payment_claim",
      needsHuman: false,
      packId: pending?.releasedPackId ?? null,
      orderAction: null,
      media: pending?.media ?? [],
    };
  } else {
    decision = decideDeterministic(userText, ctx, {
      paymentScreenshot: pending?.sawPaymentScreenshot === true,
    });
    if (burst && decision?.intent !== "opt_out") {
      decision = decision ? { ...decision, useModel: true, reply: "" } : null;
    }
  }

  return composeCustomerReply({
    store,
    subscriberId,
    userText,
    history,
    ctx,
    language,
    decision,
    media: pending?.media ?? [],
    filesReady,
    filesFailed,
    paymentScreenshot: pending?.sawPaymentScreenshot === true,
    quoted: pending?.quoted === true || filesReady,
    claimed: pending?.claimed === true,
  });
}
