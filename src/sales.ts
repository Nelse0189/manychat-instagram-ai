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

export function welcomeText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "hola, fotos o videos?";
  return "hey, photos or videos?";
}

function payWith(ctx: SalesContext, language: ReplyLanguage): string {
  const venmo = ctx.venmoHandle ? `Venmo @${ctx.venmoHandle.replace(/^@/, "")}` : "";
  const cash = ctx.cashAppTag ? `Cash App $${ctx.cashAppTag.replace(/^\$/, "")}` : "";
  return [venmo, cash].filter(Boolean).join(language === "es" ? " o " : " or ");
}

function spokenPack(name: string, language: ReplyLanguage): string {
  const spanish: Record<string, string> = {
    "One photo": "una foto",
    "Three photos": "tres fotos",
    "Five photos": "cinco fotos",
    "One video": "un video",
    "Three videos": "tres videos",
    "Five videos": "cinco videos",
  };
  const english: Record<string, string> = {
    "One photo": "one photo",
    "Three photos": "three photos",
    "Five photos": "five photos",
    "One video": "one video",
    "Three videos": "three videos",
    "Five videos": "five videos",
  };
  const table = language === "es" ? spanish : english;
  return table[name] ?? name;
}

export function catalogText(ctx: SalesContext, language: ReplyLanguage = replyLanguage(ctx)): string {
  if (language === "es") {
    const payment = ctx.paymentsEnabled
      ? ` se paga por ${payWith(ctx, language)}.`
      : " todavía no estoy cobrando.";
    return `fotos: una $15, tres $40, cinco $60. videos: uno $25, tres $60, cinco $90.${payment} dime cuál quieres.`;
  }
  const payment = ctx.paymentsEnabled
    ? ` pay with ${payWith(ctx, language)}.`
    : " I'm not charging yet.";
  return `photos: one $15, three $40, five $60. videos: one $25, three $60, five $90.${payment} tell me which you want.`;
}

export function videosText(ctx: SalesContext, language: ReplyLanguage = replyLanguage(ctx)): string {
  if (language === "es") {
    const payment = ctx.paymentsEnabled ? ` se paga por ${payWith(ctx, language)}.` : "";
    return `videos: uno $25, tres $60, cinco $90.${payment} dime uno, tres o cinco.`;
  }
  const payment = ctx.paymentsEnabled ? ` pay with ${payWith(ctx, language)}.` : "";
  return `videos: one $25, three $60, five $90.${payment} tell me one, three, or five.`;
}

export function supportText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "ay cuéntame qué pasó. no me mandes claves ni números de tarjeta.";
  return "tell me what happened. don't send me passwords or card numbers.";
}

export function optOutText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "ok ya no te escribo. dime catalog si luego quieres ver.";
  return "ok I won't text you again. say catalog if you wanna look later.";
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
  if (ATTACHMENT_CLAIM.test(trimmed) || SPANISH_SCREENSHOT.test(fold(trimmed))) return true;
  return (trimmed.match(/https?:\/\/[^\s<>"']+/gi) ?? []).some(isPaymentImageUrl);
}

export function paymentInstructions(order: Order, ctx: SalesContext): string {
  const language = replyLanguage(ctx);
  const pack = spokenPack(order.packName, language);
  const how = payWith(ctx, language);
  if (language === "es") {
    return `${pack} $${order.amountUsd}. ${how}. mándame la captura cuando pagues.`;
  }
  return `${pack} is $${order.amountUsd}. ${how}. send me the screenshot when you pay.`;
}

export function paidClaimText(_reference: string, language: ReplyLanguage = "en"): string {
  if (language === "es") return "mándame la captura y te mando los archivos.";
  return "send me the screenshot and I'll send you the files.";
}

export function filesReadyText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "ya vi la captura, el pago está bien.";
  return "I checked the screenshot, payment's good.";
}

export function filesUnavailableText(language: ReplyLanguage = "en"): string {
  if (language === "es") {
    return "ya vi la captura y el pago está bien, pero ahorita no te puedo pasar los archivos.";
  }
  return "I checked the screenshot and the payment's good, but I can't send the files right now.";
}

export function checkoutClosedText(
  packName: string,
  amountUsd: number,
  language: ReplyLanguage = "en",
): string {
  const pack = spokenPack(packName, language);
  if (language === "es") {
    return `${pack} $${amountUsd}. todavía no estoy cobrando, no te puedo mandar nada.`;
  }
  return `${pack} $${amountUsd}. I'm not charging yet, so I can't send you anything.`;
}

function noOpenOrderImageText(language: ReplyLanguage): string {
  if (language === "es") {
    return "no tengo un pedido abierto. dime una foto o un video y te digo dónde pagar.";
  }
  return "I don't have an order open. tell me a photo or a video and I'll tell you where to pay.";
}

function paidWithoutOrderText(language: ReplyLanguage): string {
  if (language === "es") {
    return "todavía no tengo nada abierto. dime una foto, tres fotos o cinco fotos.";
  }
  return "nothing's open with you yet. tell me one photo, three photos, or five photos.";
}

function paymentsClosedScreenshotText(language: ReplyLanguage): string {
  if (language === "es") return "todavía no estoy cobrando, así que no te puedo mandar nada por esa captura.";
  return "I'm not charging yet, so I can't send you anything for that screenshot.";
}

export function ageText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "tengo 18.";
  return "I'm 18.";
}

export function locationText(language: ReplyLanguage = "en"): string {
  if (language === "es") return "estoy en US.";
  return "I'm in the US.";
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

function paymentsClosedPaidText(language: ReplyLanguage): string {
  if (language === "es") {
    return "todavía no estoy cobrando, así que no hay pago. dime catalog si quieres ver las fotos.";
  }
  return "I'm not charging yet, so there's no payment. say catalog if you want to see the photos.";
}

function paymentMismatchText(language: ReplyLanguage): string {
  if (language === "es") return "ese pago no me cuadra todavía.";
  return "that payment doesn't line up yet.";
}

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
  const language = replyLanguage(ctx, trimmed);
  const paymentScreenshot =
    input.paymentScreenshot === true || textShowsPaymentScreenshot(trimmed);

  if (OPT_OUT.test(folded)) {
    return decision({ reply: optOutText(language), intent: "opt_out" });
  }

  if (SUPPORT.test(folded)) {
    return decision({ reply: supportText(language), intent: "support", needsHuman: true });
  }

  if (paymentScreenshot) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: paymentsClosedScreenshotText(language),
        intent: "payment_claim",
      });
    }
    if (!ctx.openOrder) {
      return decision({
        reply: noOpenOrderImageText(language),
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
      reply: welcomeText(language),
      intent: "browse",
    });
  }

  if (PAID.test(folded)) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: paymentsClosedPaidText(language),
        intent: "payment_claim",
        needsHuman: true,
      });
    }
    if (!ctx.openOrder) {
      return decision({
        reply: paidWithoutOrderText(language),
        intent: "payment_claim",
      });
    }
    return decision({
      reply: paidClaimText(ctx.openOrder.reference, language),
      intent: "payment_claim",
      packId: ctx.openOrder.packId,
      orderAction: "claim_payment",
    });
  }

  const asked = askKey(trimmed);
  if (AGE_ASKS.has(asked)) {
    return decision({ reply: ageText(language), intent: "other" });
  }
  if (LOCATION_ASKS.has(asked)) {
    return decision({ reply: locationText(language), intent: "other" });
  }

  if (ctx.optedOut && !CATALOG.test(folded) && !PHOTOS.test(folded)) {
    return decision({ reply: optOutText(language), intent: "opt_out" });
  }

  if (CATALOG.test(folded) || PHOTOS.test(folded)) {
    return decision({ reply: catalogText(ctx, language), intent: "browse" });
  }

  if (VIDEOS.test(folded)) {
    return decision({ reply: videosText(ctx, language), intent: "videos" });
  }

  const packId = packFromText(trimmed);
  if (packId) {
    const pack = packById(packId)!;
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: checkoutClosedText(pack.name, pack.priceUsd, language),
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
  const language = replyLanguage(ctx);
  const languageLine =
    language === "es"
      ? "This turn is Spanish. Reply in casual Spanish only."
      : "This turn is English. Reply in casual English only. Do not answer in Spanish.";
  return [
    `You write the Instagram DMs for @${ctx.shopHandle} in the account's own texting voice.`,
    "You text like an 18-year-old girl. Short, casual, first person. This is a normal DM. Do not sound like a shop bot, a receipt, or a policy. Do not add sexual content.",
    "You are 18. If they ask your age, say I'm 18. in English or tengo 18. in Spanish, and nothing else.",
    "If they ask where you are, say I'm in the US. in English or estoy en US. in Spanish. Do not invent a city, state, school, job, boyfriend, or any other biography.",
    "Do not invent a real name or a life story. Do not say you are a bot, an assistant, automated, or a team.",
    languageLine,
    "Spanish is not the default. Never answer an English sentence in Spanish. Use Spanish only when the customer wrote in Spanish.",
    "Sell only photo or video files from this collection. Do not invent prices, discounts, exclusivity, or whether a file was already sent.",
    catalogSummary(),
    `The only places to pay are Venmo @${ctx.venmoHandle.replace(/^@/, "")} and Cash App $${ctx.cashAppTag.replace(/^\$/, "")}.`,
    "Never ask for card numbers or passwords.",
    "If they only say they paid, ask for a screenshot of the payment and do not send files.",
    "A screenshot or image with no open order does not release files. Ask which pack they want.",
    "A screenshot on an open order is the payment verification. Sound like you checked the screenshot and the payment is good. The server sends the photos or videos as chat messages after your text. Do not put a link, a URL, or an order code in the reply. Do not ask them to put a code in the Venmo or Cash App note. Do not say a person still has to match Venmo or Cash App.",
    `Payments enabled: ${ctx.paymentsEnabled ? "yes" : "no"}.`,
    ctx.paymentsEnabled
      ? "If they choose a pack, set intent to purchase and packId. The server sends the price and where to pay. Do not mention an order code or a payment note."
      : "Checkout is closed. Do not mention Venmo, Cash App, or payment handles. Say you are not charging yet, in her voice, in the customer's language.",
    "If the catalog does not answer, set needsHuman true and say you'll have someone look, in her voice.",
    "If they want messages to stop, set intent to opt_out.",
    'Match this length. Spanish: "hola, fotos o videos?", "mándame la captura y te mando los archivos.", "ya vi la captura, el pago está bien.", "tengo 18.", "estoy en US.". English: "hey, photos or videos?", "send me the screenshot and I\'ll send you the files.", "I checked the screenshot, payment\'s good.", "I\'m 18.", "I\'m in the US.".',
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
  const language = replyLanguage(ctx);

  if (intent === "opt_out") {
    return decision({ reply: optOutText(language), intent: "opt_out" });
  }

  if (intent === "payment_claim") {
    return (
      decideDeterministic("I paid", ctx) ??
      decision({
        reply: paymentMismatchText(language),
        intent: "payment_claim",
        needsHuman: true,
      })
    );
  }

  if (intent === "videos") {
    return decision({ reply: videosText(ctx, language), intent: "videos" });
  }

  if (pack && (intent === "purchase" || intent === "browse")) {
    if (!ctx.paymentsEnabled) {
      return decision({
        reply: checkoutClosedText(pack.name, pack.priceUsd, language),
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

  let safeReply = reply || supportText(language);
  if (!ctx.paymentsEnabled) {
    safeReply = safeReply
      .replace(/venmo[^\n.]*/gi, "")
      .replace(/cash\s*app[^\n.]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (!safeReply) safeReply = supportText(language);

  return decision({
    reply: safeReply,
    intent: needsHuman ? "support" : intent,
    needsHuman,
  });
}

export function quotedPacks(): typeof PACKS {
  return PACKS;
}
