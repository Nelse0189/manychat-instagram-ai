import { catalogSummary, packById, PACKS, type PackId } from "./catalog.js";
import type { Decision, Order } from "./types.js";

export type SalesContext = {
  shopHandle: string;
  paymentsEnabled: boolean;
  venmoHandle: string;
  cashAppTag: string;
  optedOut: boolean;
  openOrder: Order | null;
};

const OPT_OUT = /^(stop|unsubscribe|opt[\s-]?out)$/i;
const CATALOG = /^(catalog|menu|prices?)$/i;
const PHOTOS = /^(photos?)$/i;
const VIDEOS = /^(videos?)$/i;
const SUPPORT = /^(support|human|agent)$/i;
const PAID =
  /\b(i paid|i've paid|ive paid|payment sent|sent the (money|payment)|just paid|paid you)\b/i;

function decision(
  partial: Omit<Decision, "packId" | "orderAction" | "useModel" | "needsHuman"> &
    Partial<Pick<Decision, "packId" | "orderAction" | "useModel" | "needsHuman">>,
): Decision {
  return {
    packId: null,
    orderAction: null,
    useModel: false,
    needsHuman: false,
    ...partial,
  };
}

export function welcomeText(shopHandle: string): string {
  return `Hi! I'm the automated shop assistant for @${shopHandle}. Want to browse the photo and video collections? Reply PHOTOS, VIDEOS, or SUPPORT.`;
}

function payWith(ctx: SalesContext): string {
  const venmo = ctx.venmoHandle ? `Venmo @${ctx.venmoHandle.replace(/^@/, "")}` : "";
  const cash = ctx.cashAppTag ? `Cash App $${ctx.cashAppTag.replace(/^\$/, "")}` : "";
  return [venmo, cash].filter(Boolean).join(" or ");
}

export function catalogText(ctx: SalesContext): string {
  const payment = ctx.paymentsEnabled
    ? ` Payment goes to ${payWith(ctx)}.`
    : " Checkout is not open yet.";
  return `Photos and videos from this collection are for sale. Photos: one for $15 USD, three for $40 USD, or five for $60 USD. Videos: one for $25 USD, three for $60 USD, or five for $90 USD.${payment} Reply ONE PHOTO, THREE PHOTOS, FIVE PHOTOS, ONE VIDEO, THREE VIDEOS, or FIVE VIDEOS.`;
}

export function videosText(ctx: SalesContext): string {
  const payment = ctx.paymentsEnabled ? ` Pay ${payWith(ctx)}.` : "";
  return `Videos from this collection are one for $25 USD, three for $60 USD, or five for $90 USD.${payment} Reply ONE VIDEO, THREE VIDEOS, or FIVE VIDEOS.`;
}

export function supportText(): string {
  return "I'll flag this for a team member. Please describe the issue here; don't send passwords or payment-card information.";
}

export function optOutText(): string {
  return "You're opted out of promotional messages. Message CATALOG if you want to browse, or SUPPORT if you need help with an order.";
}

const IMAGE_PLACEHOLDER =
  /^[\[(<{]\s*(?:image|img|photo|picture|pic|screenshot|screen[\s-]?shot|attachment|media|file)\s*[\]>)}][.!]?\s*$/i;
const BARE_IMAGE_PLACEHOLDER = /^(?:image|img)[.!]?\s*$/i;
const ATTACHMENT_CLAIM =
  /\b(?:here(?:'|’)?s|here is|this is|attached|attaching|sent|sending|just sent|included)\b[\s\S]{0,60}\b(?:screenshot|screen[\s-]?shot|receipt|proof of payment)\b|\b(?:screenshot|screen[\s-]?shot|receipt)\b[\s\S]{0,40}\b(?:attached|sent|included|above|here)\b|\bproof of payment\b/i;

export function isPaymentImageUrl(raw: string): boolean {
  const cleaned = raw.trim().replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (/\.(?:mp3|m4a|ogg|wav|aac|mp4|mov|m4v|webm)(?:$|\?|#)/i.test(cleaned)) return false;
  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    if (
      host === "lookaside.fbsbx.com" ||
      host.endsWith(".fbsbx.com") ||
      host.endsWith(".fbcdn.net") ||
      host === "fbcdn.net" ||
      host.endsWith(".cdninstagram.com") ||
      host === "cdninstagram.com"
    ) {
      return true;
    }
    return /\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function textShowsPaymentScreenshot(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || (trimmed.includes("{{") && trimmed.includes("}}"))) return false;
  if (IMAGE_PLACEHOLDER.test(trimmed) || BARE_IMAGE_PLACEHOLDER.test(trimmed)) return true;
  if (ATTACHMENT_CLAIM.test(trimmed)) return true;
  return (trimmed.match(/https?:\/\/[^\s<>"']+/gi) ?? []).some(isPaymentImageUrl);
}

export function paymentInstructions(order: Order, ctx: SalesContext): string {
  return `${order.packName} is ${order.amountUsd} USD. ${payWith(ctx)}. Put ${order.reference} in the note, then send me a screenshot.`;
}

export function paidClaimText(_reference: string): string {
  return "Send me a screenshot of the payment and I'll send the files.";
}

export function filesReadyText(reference: string, downloads: string[]): string {
  return `Got the screenshot. Here are your files for ${reference}:\n${downloads.join("\n")}`;
}

export function checkoutClosedText(packName: string, amountUsd: number): string {
  return `The ${packName} collection is ${amountUsd} USD and contains previously published files. Checkout is not open yet, so I can't take payment or send a download. I'll keep this price on your quote.`;
}

function packFromText(text: string): PackId | null {
  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (value === "five videos" || /\b(five videos|5 videos|five video)\b/.test(value)) return "video_5";
  if (value === "three videos" || /\b(three videos|3 videos|three video)\b/.test(value)) {
    return "video_3";
  }
  if (value === "one video" || /\b(one video|1 video|single video)\b/.test(value)) return "video_1";
  if (
    value === "5" ||
    value === "five" ||
    /\b(five photos|5 photos|five photo|photo pack of five)\b/.test(value)
  ) {
    return "photo_5";
  }
  if (
    value === "3" ||
    value === "three" ||
    /\b(three photos|3 photos|three photo|photo pack of three)\b/.test(value)
  ) {
    return "photo_3";
  }
  if (value === "1" || value === "one" || /\b(one photo|1 photo|single photo)\b/.test(value)) {
    return "photo_1";
  }
  return null;
}

export function decideDeterministic(
  text: string,
  ctx: SalesContext,
  input: { paymentScreenshot?: boolean } = {},
): Decision | null {
  const trimmed = text.trim();
  const paymentScreenshot =
    input.paymentScreenshot === true || textShowsPaymentScreenshot(trimmed);

  if (OPT_OUT.test(trimmed)) {
    return decision({ reply: optOutText(), intent: "opt_out" });
  }

  if (SUPPORT.test(trimmed)) {
    return decision({ reply: supportText(), intent: "support", needsHuman: true });
  }

  if (paymentScreenshot) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: "Checkout isn't open yet, so I can't send files for that screenshot.",
        intent: "payment_claim",
      });
    }
    if (!ctx.openOrder) {
      return decision({
        reply:
          "I don't have an order open yet. Tell me the pack you want, like ONE PHOTO or ONE VIDEO, and I'll tell you where to pay.",
        intent: "payment_claim",
      });
    }
    return decision({
      reply: "",
      intent: "payment_claim",
      packId: ctx.openOrder.packId,
      orderAction: "fulfill",
    });
  }

  if (!trimmed) {
    return decision({
      reply: welcomeText(ctx.shopHandle),
      intent: "browse",
    });
  }

  if (PAID.test(trimmed)) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply:
          "Checkout is not open yet, so there is no payment for me to match. Message CATALOG to review the photo collections.",
        intent: "payment_claim",
        needsHuman: true,
      });
    }
    if (!ctx.openOrder) {
      return decision({
        reply:
          "I don't have an open order to match that payment to. Reply ONE PHOTO, THREE PHOTOS, or FIVE PHOTOS first, then pay with the reference I give you.",
        intent: "payment_claim",
      });
    }
    return decision({
      reply: paidClaimText(ctx.openOrder.reference),
      intent: "payment_claim",
      packId: ctx.openOrder.packId,
      orderAction: "claim_payment",
    });
  }

  if (ctx.optedOut && !CATALOG.test(trimmed) && !PHOTOS.test(trimmed)) {
    return decision({ reply: optOutText(), intent: "opt_out" });
  }

  if (CATALOG.test(trimmed) || PHOTOS.test(trimmed)) {
    return decision({ reply: catalogText(ctx), intent: "browse" });
  }

  if (VIDEOS.test(trimmed)) {
    return decision({ reply: videosText(ctx), intent: "videos" });
  }

  const packId = packFromText(trimmed);
  if (packId) {
    const pack = packById(packId)!;
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: checkoutClosedText(pack.name, pack.priceUsd),
        intent: "purchase",
        packId,
        orderAction: "quote",
      });
    }
    return decision({
      reply: "",
      intent: "purchase",
      packId,
      orderAction: "quote",
    });
  }

  return null;
}

export type ModelJson = {
  reply?: unknown;
  intent?: unknown;
  packId?: unknown;
  needsHuman?: unknown;
};

const INTENTS = new Set([
  "browse",
  "purchase",
  "payment_claim",
  "support",
  "opt_out",
  "videos",
  "other",
]);

export function systemPrompt(ctx: SalesContext): string {
  return [
    `You are the automated shop assistant for Instagram @${ctx.shopHandle}.`,
    "You are not the person shown in the photos or videos. Never claim to be them or invent a personal relationship.",
    "Customers pay for photo or video files from this collection. Do not invent prices, discounts, exclusivity, or delivery status.",
    catalogSummary(),
    `The only payment destinations are Venmo @${ctx.venmoHandle.replace(/^@/, "")} and Cash App $${ctx.cashAppTag.replace(/^\$/, "")}.`,
    "Never ask for card numbers or passwords.",
    "After they pay, ask for a screenshot of the payment. If they only say they paid, ask for that screenshot.",
    "When a screenshot arrives for an open order, the server sends the download links in the reply.",
    `Payments enabled: ${ctx.paymentsEnabled ? "yes" : "no"}.`,
    ctx.paymentsEnabled
      ? "If they choose a pack, set intent to purchase and packId. The server sends the payment instructions."
      : "Checkout is closed. Do not mention Venmo, Cash App, or payment handles.",
    "If the catalog does not answer the question, set needsHuman true and say a team member will follow up.",
    "If they want promotions to stop, set intent to opt_out.",
    'Return only JSON: {"reply": string, "intent": "browse"|"purchase"|"payment_claim"|"support"|"opt_out"|"videos"|"other", "packId": "photo_1"|"photo_3"|"photo_5"|"video_1"|"video_3"|"video_5"|null, "needsHuman": boolean}',
  ].join("\n");
}

export function parseModelJson(raw: string): ModelJson {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { reply: raw.trim() };
  try {
    return JSON.parse(raw.slice(start, end + 1)) as ModelJson;
  } catch {
    return { reply: raw.trim() };
  }
}

export function decisionFromModel(raw: string, ctx: SalesContext): Decision {
  const parsed = parseModelJson(raw);
  const intent = typeof parsed.intent === "string" && INTENTS.has(parsed.intent)
    ? (parsed.intent as Decision["intent"])
    : "other";
  const pack = typeof parsed.packId === "string" ? packById(parsed.packId) : undefined;
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const needsHuman = parsed.needsHuman === true || intent === "support";

  if (intent === "opt_out") {
    return decision({ reply: optOutText(), intent: "opt_out" });
  }

  if (intent === "payment_claim") {
    return (
      decideDeterministic("I paid", ctx) ??
      decision({
        reply: "I can't match that payment yet.",
        intent: "payment_claim",
        needsHuman: true,
      })
    );
  }

  if (intent === "videos") {
    return decision({ reply: videosText(ctx), intent: "videos" });
  }

  if (pack && (intent === "purchase" || intent === "browse")) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: checkoutClosedText(pack.name, pack.priceUsd),
        intent: "purchase",
        packId: pack.id,
        orderAction: "quote",
      });
    }
    return decision({
      reply: "",
      intent: "purchase",
      packId: pack.id,
      orderAction: "quote",
    });
  }

  let safeReply = reply || supportText();
  if (!ctx.paymentsEnabled) {
    safeReply = safeReply
      .replace(/venmo[^\n.]*/gi, "")
      .replace(/cash\s*app[^\n.]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (!safeReply) safeReply = supportText();

  return decision({
    reply: safeReply,
    intent: needsHuman ? "support" : intent,
    needsHuman,
  });
}

export function quotedPacks(): typeof PACKS {
  return PACKS;
}
