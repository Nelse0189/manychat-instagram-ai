import { catalogSummary, packById, PACKS, type PackId } from "./catalog.js";
import type { ChatMessage, Decision, Order } from "./types.js";

export type ReplyLanguage = "en" | "es";

export type SalesContext = {
  shopHandle: string;
  paymentsEnabled: boolean;
  venmoHandle: string;
  cashAppTag: string;
  optedOut: boolean;
  openOrder: Order | null;
  language?: ReplyLanguage;
};

const OPT_OUT = /^(stop|unsubscribe|opt[\s-]?out)$/i;
const CATALOG = /^(catalog|menu|prices?|precio|precios|catalogo)$/i;
const PHOTOS = /^(photos?|fotos?)$/i;
const VIDEOS = /^(videos?)$/i;
const SUPPORT = /^(support|human|agent)$/i;
const PAID =
  /\b(i paid|i've paid|ive paid|payment sent|sent the (money|payment)|just paid|paid you|ya pague|te pague|ya te pague|ya lo pague|pague|ya mande el pago|ya envie el pago|pago enviado|hice el pago)\b/i;

const IMAGE_PLACEHOLDER =
  /^[\[(<{]\s*(?:image|img|photo|picture|pic|screenshot|screen[\s-]?shot|attachment|media|file)\s*[\]>)}][.!]?\s*$/i;
const BARE_IMAGE_PLACEHOLDER = /^(?:image|img)[.!]?\s*$/i;
const ATTACHMENT_CLAIM =
  /\b(?:here(?:'|’)?s|here is|this is|attached|attaching|sent|sending|just sent|included)\b[\s\S]{0,60}\b(?:screenshot|screen[\s-]?shot|receipt|proof of payment)\b|\b(?:screenshot|screen[\s-]?shot|receipt)\b[\s\S]{0,40}\b(?:attached|sent|included|above|here)\b|\bproof of payment\b/i;
const SPANISH_SCREENSHOT =
  /\b(?:aqui|aca|ahi) (?:esta |va |te va )?(?:la )?(?:captura|comprobante)\b|\b(?:te mando|mira|adjunto|adjunta) (?:la )?(?:captura|comprobante)\b|\b(?:captura|comprobante) (?:adjunta|adjunto|enviada|enviado)\b/i;

const AMBIGUOUS_SINGLE = new Set([
  "hi",
  "hey",
  "ok",
  "okay",
  "k",
  "kk",
  "yo",
  "sup",
  "y",
  "n",
  "yes",
  "no",
  "ya",
  "si",
  "i",
  "the",
  "1",
  "3",
  "5",
  "video",
  "videos",
]);

const SPANISH_WORDS = new Set([
  "hola",
  "buenas",
  "buenos",
  "gracias",
  "quiero",
  "quieres",
  "dime",
  "manda",
  "mandame",
  "pague",
  "pagado",
  "pagaste",
  "captura",
  "porfa",
  "porfavor",
  "precio",
  "precios",
  "foto",
  "fotos",
  "una",
  "uno",
  "tres",
  "cinco",
  "archivo",
  "archivos",
  "todavia",
  "cual",
  "tambien",
  "aqui",
  "donde",
  "enviame",
  "cobrando",
  "contigo",
  "abierto",
  "primero",
  "tuyo",
  "catalogo",
  "dame",
  "pasame",
  "mande",
  "envie",
  "dinero",
  "cuanto",
  "comprobante",
  "cuantos",
  "anos",
  "tienes",
  "edad",
  "eres",
  "vives",
  "estas",
]);

const ENGLISH_WORDS = new Set([
  "hello",
  "photo",
  "photos",
  "paid",
  "payment",
  "screenshot",
  "want",
  "please",
  "thanks",
  "thank",
  "catalog",
  "price",
  "prices",
  "send",
  "file",
  "files",
  "one",
  "three",
  "five",
  "heres",
  "here's",
  "attached",
  "receipt",
  "just",
  "im",
  "i'm",
  "ive",
  "i've",
  "stop",
  "unsubscribe",
  "support",
  "human",
  "agent",
  "menu",
  "note",
  "where",
  "what",
  "how",
  "much",
  "buy",
  "order",
  "pack",
  "there",
  "old",
  "age",
  "live",
  "from",
  "city",
  "state",
  "located",
]);

function decision(
  partial: Omit<Decision, "packId" | "orderAction" | "useModel" | "needsHuman" | "media"> &
    Partial<Pick<Decision, "packId" | "orderAction" | "useModel" | "needsHuman" | "media">>,
): Decision {
  return {
    packId: null,
    orderAction: null,
    useModel: false,
    needsHuman: false,
    media: [],
    ...partial,
  };
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function detectMessageLanguage(text: string): ReplyLanguage | null {
  const trimmed = text.trim();
  if (!trimmed || (trimmed.includes("{{") && trimmed.includes("}}"))) return null;
  if (IMAGE_PLACEHOLDER.test(trimmed) || BARE_IMAGE_PLACEHOLDER.test(trimmed)) return null;

  const withoutUrls = trimmed.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  if (
    !withoutUrls ||
    IMAGE_PLACEHOLDER.test(withoutUrls) ||
    BARE_IMAGE_PLACEHOLDER.test(withoutUrls) ||
    !/\p{L}/u.test(withoutUrls)
  ) {
    return null;
  }

  const folded = fold(withoutUrls);
  const tokens = folded.split(/[^a-z0-9']+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && AMBIGUOUS_SINGLE.has(tokens[0] ?? "")) return null;

  let spanish = 0;
  let english = 0;
  let spanishHits = 0;
  let englishHits = 0;
  if (/[áéíóúüñ¿¡]/i.test(withoutUrls)) {
    spanish += 3;
    spanishHits += 1;
  }

  for (const token of tokens) {
    if (SPANISH_WORDS.has(token)) {
      spanish += 2;
      spanishHits += 1;
    }
    if (ENGLISH_WORDS.has(token)) {
      english += 2;
      englishHits += 1;
    }
    if ((token === "hi" || token === "hey") && tokens.length > 1) {
      english += 2;
      englishHits += 1;
    }
    if (token === "i" || token === "the") english += 1;
  }

  if (/\b(ya pague|te pague|una foto|tres fotos|cinco fotos|un video|tres videos|cinco videos|mandame|la captura)\b/i.test(folded)) {
    spanish += 3;
    spanishHits += 1;
  }
  if (/\b(i paid|one photo|three photos|five photos|one video|three videos|five videos|send me|the screenshot)\b/i.test(folded)) {
    english += 3;
    englishHits += 1;
  }

  if (spanishHits === 0 && englishHits === 0) return null;
  if (spanish > 0 && english > 0 && Math.max(spanish, english) < 2 * Math.min(spanish, english)) {
    return null;
  }
  return spanish > english ? "es" : "en";
}

export function languageFromHistory(
  messages: Array<Pick<ChatMessage, "text"> & { role?: ChatMessage["role"] }>,
): ReplyLanguage | null {
  const ordered = [...messages].reverse();
  const userMessages = ordered.filter((message) => message.role !== "assistant");
  for (const message of userMessages) {
    const language = detectMessageLanguage(message.text);
    if (language) return language;
  }
  for (const message of ordered) {
    const language = detectMessageLanguage(message.text);
    if (language) return language;
  }
  return null;
}

export function resolveReplyLanguage(
  text: string,
  history: Array<Pick<ChatMessage, "text"> & { role?: ChatMessage["role"] }> = [],
): ReplyLanguage {
  return detectMessageLanguage(text) ?? languageFromHistory(history) ?? "en";
}

function replyLanguage(ctx: SalesContext, text = ""): ReplyLanguage {
  if (ctx.language === "es" || ctx.language === "en") return ctx.language;
  return detectMessageLanguage(text) ?? "en";
}


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
  return (trimmed.match(/https?:\/\/[^\s<>"']+/gi) ?? []).some(isPaymentImageUrl);
}

export function claimsPaymentScreenshot(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || textShowsPaymentScreenshot(trimmed)) return false;
  return ATTACHMENT_CLAIM.test(trimmed) || SPANISH_SCREENSHOT.test(fold(trimmed));
}

export function customerReplyText(raw: string): string {
  const parsed = parseModelJson(raw);
  const reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : raw.trim();
  return reply
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\/downloads\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function askKey(text: string): string {
  return fold(text)
    .replace(/[?!.]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:hey|hi|hello|hola)\s+/, "");
}

const AGE_ASKS = new Set([
  "how old are you",
  "how old r u",
  "how old are u",
  "how old ru",
  "whats your age",
  "what's your age",
  "what is your age",
  "what age are you",
  "your age",
  "are you 18",
  "cuantos anos tienes",
  "que edad tienes",
  "cual es tu edad",
  "tu edad",
  "cuantos anos",
  "edad",
]);

const LOCATION_ASKS = new Set([
  "where are you",
  "where r u",
  "where are u",
  "where you at",
  "where you from",
  "where are you from",
  "where do you live",
  "where you live",
  "where are you located",
  "where you located",
  "what city are you in",
  "what state are you in",
  "whats your location",
  "what's your location",
  "donde estas",
  "donde estas tu",
  "de donde eres",
  "donde vives",
  "en donde estas",
  "de que ciudad eres",
  "de que estado eres",
]);

function packFromText(text: string): PackId | null {
  const value = fold(text).replace(/\s+/g, " ").trim();
  if (
    value === "five videos" ||
    value === "cinco videos" ||
    /\b(five videos|5 videos|five video|cinco videos|cinco video)\b/.test(value)
  ) {
    return "video_5";
  }
  if (
    value === "three videos" ||
    value === "tres videos" ||
    /\b(three videos|3 videos|three video|tres videos|tres video)\b/.test(value)
  ) {
    return "video_3";
  }
  if (
    value === "one video" ||
    value === "un video" ||
    value === "uno video" ||
    /\b(one video|1 video|single video|un video|uno video)\b/.test(value)
  ) {
    return "video_1";
  }
  if (
    value === "5" ||
    value === "five" ||
    value === "cinco" ||
    /\b(five photos|5 photos|five photo|photo pack of five|cinco fotos|5 fotos|cinco foto)\b/.test(value)
  ) {
    return "photo_5";
  }
  if (
    value === "3" ||
    value === "three" ||
    value === "tres" ||
    /\b(three photos|3 photos|three photo|photo pack of three|tres fotos|3 fotos|tres foto)\b/.test(value)
  ) {
    return "photo_3";
  }
  if (
    value === "1" ||
    value === "one" ||
    value === "una" ||
    value === "uno" ||
    /\b(one photo|1 photo|single photo|una foto|1 foto|un foto|uno foto)\b/.test(value)
  ) {
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
  const folded = fold(trimmed);
  const paymentScreenshot =
    input.paymentScreenshot === true || textShowsPaymentScreenshot(trimmed);

  if (OPT_OUT.test(folded)) {
    return decision({ reply: "", useModel: true, intent: "opt_out" });
  }

  if (SUPPORT.test(folded)) {
    return decision({ reply: "", useModel: true, intent: "support", needsHuman: true });
  }

  if (paymentScreenshot) {
    if (!ctx.paymentsEnabled) {
      return decision({ reply: "", useModel: true, intent: "payment_claim" });
    }
    if (!ctx.openOrder) {
      return decision({
        reply: "",
        useModel: true,
        intent: "payment_claim",
      });
    }
    return decision({
      reply: "",
      useModel: true,
      intent: "payment_claim",
      packId: ctx.openOrder.packId,
      orderAction: "fulfill",
    });
  }

  if (!trimmed) {
    return decision({
      reply: "",
      useModel: true,
      intent: "browse",
    });
  }

  if (PAID.test(folded) || claimsPaymentScreenshot(trimmed)) {
    if (!ctx.paymentsEnabled) {
      return decision({ reply: "", useModel: true, intent: "payment_claim", needsHuman: true });
    }
    if (!ctx.openOrder) {
      return decision({
        reply: "",
        useModel: true,
        intent: "payment_claim",
      });
    }
    return decision({
      reply: "",
      useModel: true,
      intent: "payment_claim",
      packId: ctx.openOrder.packId,
      orderAction: "claim_payment",
    });
  }

  const asked = askKey(trimmed);
  if (AGE_ASKS.has(asked)) {
    return decision({ reply: "", useModel: true, intent: "other" });
  }
  if (LOCATION_ASKS.has(asked)) {
    return decision({ reply: "", useModel: true, intent: "other" });
  }

  if (ctx.optedOut && !CATALOG.test(folded) && !PHOTOS.test(folded)) {
    return decision({ reply: "", useModel: true, intent: "opt_out" });
  }

  if (CATALOG.test(folded) || PHOTOS.test(folded)) {
    return decision({ reply: "", useModel: true, intent: "browse" });
  }

  if (VIDEOS.test(folded)) {
    return decision({ reply: "", useModel: true, intent: "videos" });
  }

  const packId = packFromText(trimmed);
  if (packId) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: "",
        useModel: true,
        intent: "purchase",
        packId,
        orderAction: "quote",
      });
    }
    return decision({
      reply: "",
      useModel: true,
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

export function turnInstruction(ctx: SalesContext): string {
  const language = replyLanguage(ctx);
  if (language === "es") {
    return "This turn is Spanish. Reply in casual Spanish only, like a real person texting. Vary it with what they just said. Do not reuse a stock line.";
  }
  return "This turn is English. Reply in casual English only. Do not answer in Spanish. Sound like a real person texting, and vary it with their latest message instead of a template.";
}

export function modelSituation(
  text: string,
  ctx: SalesContext,
  flags: { paymentScreenshot: boolean; filesReady: boolean; filesFailed: boolean },
): string {
  const trimmed = text.trim();
  const folded = fold(trimmed);
  const notes = ["Answer their latest message in your own words."];
  if (!trimmed) {
    notes.push("They just opened the chat. Greet them from that, not from a saved welcome.");
  }
  if (ctx.optedOut) {
    notes.push("They already said stop. Do not sell. Keep it to a short goodbye.");
  }
  if (CATALOG.test(folded) || PHOTOS.test(folded) || VIDEOS.test(folded)) {
    notes.push("They asked what you sell. Answer in your own words. Do not paste a price menu.");
  }
  const asked = askKey(trimmed);
  if (AGE_ASKS.has(asked)) {
    notes.push("They asked your age. You are 21. Say so in their language in words that fit this message.");
  }
  if (LOCATION_ASKS.has(asked)) {
    notes.push("They asked where you are. You are in the US. Do not invent a city, state, school, job, or boyfriend.");
  }
  if (flags.filesReady && ctx.openOrder) {
    notes.push(
      `A payment-screen image arrived for their open ${ctx.openOrder.packName} order. The files go out as chat media after your text. Do not paste a link or an order code.`,
    );
  } else if (flags.filesFailed) {
    notes.push("The payment screen was real, but the files cannot be sent right now. Say that in your own words. Do not paste a link.");
  } else if (flags.paymentScreenshot && !ctx.openOrder) {
    notes.push("They sent an image and there is no open order. Do not say any files are on the way.");
  } else if (PAID.test(folded) || claimsPaymentScreenshot(trimmed)) {
    notes.push("They said they paid or mentioned a screenshot, and no payment-screen image arrived. Do not say the files were sent.");
  }
  const packId = packFromText(trimmed);
  if (packId && ctx.paymentsEnabled) {
    const pack = packById(packId);
    if (pack) {
      notes.push(
        `They brought up ${pack.name} at $${pack.priceUsd}. Mention the price, Venmo, or Cash App only if this message calls for it.`,
      );
    }
  }
  return notes.join(" ");
}

export function systemPrompt(ctx: SalesContext): string {
  const venmo = ctx.venmoHandle.replace(/^@/, "");
  const cash = ctx.cashAppTag.replace(/^\$/, "");
  const checkout = ctx.paymentsEnabled
    ? `Non-nude selfies $15, $40, $60. TikTok-style videos $25, $60, $90. Venmo @${venmo}. Cash App $${cash}. It does not have to be a formal quote. Do not paste them into every reply.`
    : "Checkout is closed. Do not mention Venmo, Cash App, or payment handles.";
  return [
    `Sound like a real person texting: short, casual, first person. The goal is to get them to pay. You are semi-interested, not eager and not a salesperson. Do not reuse a template.`,
    "What you sell is non-nude selfies and TikTok-style videos. Never call them packs.",
    "Do not obsess over breast size. Do not bring up 30k or your chest unless they asked.",
    "If they ask your age, say I'm 21 or tengo 21. If they ask where you are, say I'm in the US or estoy en US. Do not invent a real name or a life story.",
    "Spanish is not the default. Never answer an English sentence in Spanish.",
    checkout,
    "If they say they paid but there is no image, ask for a screenshot. An actual payment screenshot on an open order is the only payment verification. The server sends the photos or videos as chat messages. Do not ask them to put a code in the Venmo or Cash App note. Do not say a person still has to match Venmo.",
    'Return only JSON: {"reply":string,"intent":"browse"|"purchase"|"payment_claim"|"support"|"opt_out"|"videos"|"other","packId":"photo_1"|"photo_3"|"photo_5"|"video_1"|"video_3"|"video_5"|null,"needsHuman":boolean}. The reply must not say pack.',
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
    return decision({ reply, intent: "opt_out" });
  }

  if (intent === "payment_claim") {
    const control = decideDeterministic("I paid", ctx);
    if (!control) {
      return decision({ reply, intent: "payment_claim", needsHuman: true });
    }
    return { ...control, reply };
  }

  if (intent === "videos") {
    return decision({ reply, intent: "videos" });
  }

  if (pack && (intent === "purchase" || intent === "browse")) {
    return decision({
      reply,
      useModel: true,
      intent: "purchase",
      packId: pack.id,
      orderAction: "quote",
    });
  }

  let safeReply = reply;
  if (!ctx.paymentsEnabled) {
    safeReply = safeReply
      .replace(/venmo[^\n.]*/gi, "")
      .replace(/cash\s*app[^\n.]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return decision({
    reply: safeReply,
    intent: needsHuman ? "support" : intent,
    needsHuman,
  });
}

export function quotedPacks(): typeof PACKS {
  return PACKS;
}
