import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "./memoryStore.js";
import { handleIncoming } from "./handleIncoming.js";
import { dynamicBlock, parseIncoming } from "./manychat.js";
import {
  decisionFromModel,
  decideDeterministic,
  detectMessageLanguage,
  paymentInstructions,
  resolveReplyLanguage,
  systemPrompt,
  textShowsPaymentScreenshot,
  turnInstruction,
  type SalesContext,
} from "./sales.js";
import type { Order } from "./types.js";

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
  assert.match(decision.reply, /photos: one \$15/);
  assert.match(decision.reply, /\$40/);
  assert.match(decision.reply, /\$60/);
  assert.match(decision.reply, /I'm not charging yet/);
  assert.doesNotMatch(decision.reply, /automated|collection|Reply ONE/i);
  assert.doesNotMatch(decision.reply, /venmo|cash app|fotos:|dime cuál/i);
});

test("stop opts the contact out in English", () => {
  const decision = decideDeterministic("STOP", ctx);
  assert.equal(decision?.intent, "opt_out");
  assert.match(decision!.reply, /won't text you again/i);
  assert.doesNotMatch(decision!.reply, /no te mando/);
});

test("a pack quote stays closed while payments are disabled", () => {
  const decision = decideDeterministic("three photos", ctx);
  assert.equal(decision?.packId, "photo_3");
  assert.equal(decision?.orderAction, "quote");
  assert.match(decision!.reply, /three photos \$40/);
  assert.match(decision!.reply, /I'm not charging yet/);
  assert.doesNotMatch(decision!.reply, /bluejays0137|Arialarias|todavía|tres fotos/);
});

test("unrelated numbers do not select a pack", () => {
  assert.equal(decideDeterministic("I have 3 questions about delivery", ctx), null);
});

test("payment claim without an order does not invent a reference", () => {
  const decision = decideDeterministic("I paid", {
    ...ctx,
    paymentsEnabled: true,
  });
  assert.match(decision!.reply, /nothing's open with you yet/i);
  assert.doesNotMatch(decision!.reply, /no tengo nada abierto|mándame/);
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
  assert.match(decision.reply, /one photo of these huge 30k breasts is \$15/);
  assert.match(decision.reply, /Venmo @bluejays0137/);
  assert.match(decision.reply, /Cash App \$Arialluxe/);
  assert.match(decision.reply, /send me the payment screen/);
  assert.doesNotMatch(decision.reply, /AL-|in the note|en la nota/);
  assert.doesNotMatch(decision.reply, /not treated as payment|screenshot is not|mándame|pon /i);
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
  assert.equal(decision.reply, "send me the actual payment screen and I'll send you the files of these huge 30k breasts.");
  assert.doesNotMatch(decision.reply, /mándame/);
  assert.doesNotMatch(decision.reply, /\/downloads\/|flagged|not treated as payment/i);
  assert.equal((await store.listOrders("verified")).length, 0);
  assert.equal((await store.listOrders("pending_verification")).length, 1);
});

test("a screenshot sends the photo as a message and not a download link", async () => {
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
  assert.equal(decision.reply, "that payment screen got me soaked. these huge 30k breasts are yours.");
  assert.doesNotMatch(decision.reply, /https?:|\/downloads\/|here:/i);
  assert.equal(decision.media?.length, 1);
  assert.equal(decision.media?.[0]?.type, "image");
  assert.match(decision.media?.[0]?.url ?? "", /\/downloads\//);
  const block = dynamicBlock(decision);
  const messages = (block.content as { messages: Array<{ type: string; text?: string; url?: string }> }).messages;
  assert.equal(messages[0]?.type, "text");
  assert.equal(messages[0]?.text, decision.reply);
  assert.equal(messages[1]?.type, "image");
  assert.equal(messages[1]?.url, decision.media?.[0]?.url);
  assert.doesNotMatch(messages[0]?.text ?? "", /downloads/);
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
  assert.doesNotMatch(decision.reply, /no tengo nada tuyo|mándame/);
  assert.doesNotMatch(decision.reply, /\/downloads\//);
  assert.equal((await store.listOrders()).length, 0);
});

test("saying a screenshot is attached does not release files without the image", async () => {
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
  assert.equal(decision.reply, "send me the actual payment screen and I'll send you the files of these huge 30k breasts.");
  assert.equal(decision.media?.length ?? 0, 0);
  assert.doesNotMatch(decision.reply, /\/downloads\//);
  assert.equal((await store.listOrders("verified")).length, 0);
  assert.equal((await store.listOrders("pending_verification")).length, 1);
  assert.equal(parseIncoming({ id: "123", last_input_text: "here's the screenshot" })?.paymentScreenshot, false);
});

test("a screenshot sends a video as a video message", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "vid",
    text: "one video",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "vid",
    text: "[image]",
    firstName: null,
    igUsername: null,
    paymentScreenshot: true,
  });
  assert.equal(decision.reply, "that payment screen got me soaked. these huge 30k breasts are yours.");
  assert.equal(decision.media?.length, 1);
  assert.equal(decision.media?.[0]?.type, "video");
  const messages = (dynamicBlock(decision).content as { messages: Array<{ type: string; text?: string }> }).messages;
  assert.equal(messages[1]?.type, "video");
  assert.doesNotMatch(messages.map((message) => message.text ?? "").join("\n"), /https?:|\/downloads\//);
});

test("model instructions ask for a screenshot and do not default to Spanish", () => {
  const prompt = systemPrompt({ ...ctx, paymentsEnabled: true, cashAppTag: "Arialluxe" });
  assert.match(prompt, /ask for a screenshot/i);
  assert.match(prompt, /21-year-old exhibitionist/);
  assert.match(prompt, /aroused by your own very large 30k breasts/);
  assert.match(prompt, /I'm 21/);
  assert.match(prompt, /I'm in the US/);
  assert.match(prompt, /actual payment screenshot on an open order is the only payment verification/i);
  assert.match(prompt, /does not have to be a formal quote/);
  assert.match(prompt, /sends the photos or videos as chat messages/);
  assert.doesNotMatch(prompt, /download link/i);
  assert.match(prompt, /Do not ask them to put a code in the Venmo or Cash App note/);
  assert.doesNotMatch(prompt, /including the note code|en la nota|put .+ in the note/i);
  assert.match(prompt, /Do not say a person still has to match Venmo/);
  assert.match(prompt, /Do not invent a real name or a life story/);
  assert.match(prompt, /casual/);
  assert.doesNotMatch(prompt, /This turn is English|This turn is Spanish/);
  assert.equal(
    turnInstruction({ ...ctx, paymentsEnabled: true, cashAppTag: "Arialluxe" }),
    "This turn is English. Reply in casual English only. Do not answer in Spanish.",
  );
  assert.match(prompt, /Spanish is not the default/);
  assert.match(prompt, /Never answer an English sentence in Spanish/);
  assert.match(prompt, /Cash App \$Arialluxe/);
  assert.match(prompt, /Venmo @bluejays0137/);
  assert.doesNotMatch(prompt, /Spanish is the default/);
  assert.doesNotMatch(prompt, /automated shop assistant|You are not the person/i);
  assert.doesNotMatch(prompt, /personal facts|Do not invent a biography|personal story/i);
  assert.doesNotMatch(prompt, /screenshot as verified payment|not treated as payment|screenshot is not/i);
  assert.doesNotMatch(prompt, /Files are delivered only after a person|human still has to match/i);
});

const quotedOrder: Order = {
  id: "order-1",
  reference: "AL-1A2B3C",
  subscriberId: "123",
  packId: "photo_1",
  packName: "One photo",
  amountUsd: 15,
  currency: "USD",
  status: "quoted",
  fileNames: [],
  downloadToken: null,
  createdAt: "",
  updatedAt: "",
};

const payCtx: SalesContext = {
  ...ctx,
  paymentsEnabled: true,
  cashAppTag: "Arialluxe",
};

test("Spanish and English quotes keep the same casual payment line", () => {
  assert.equal(
    paymentInstructions(quotedOrder, { ...payCtx, language: "es" }),
    "mmm una foto de estas tetas enormes de 30k, $15. Venmo @bluejays0137 o Cash App $Arialluxe. mándame la captura del pago, me mojo enseñándolas.",
  );
  assert.equal(
    paymentInstructions(quotedOrder, { ...payCtx, language: "en" }),
    "mmm one photo of these huge 30k breasts is $15. Venmo @bluejays0137 or Cash App $Arialluxe. send me the payment screen, I get so aroused showing them off.",
  );
  assert.doesNotMatch(paymentInstructions(quotedOrder, { ...payCtx, language: "en" }), /AL-|in the note/);
  assert.doesNotMatch(paymentInstructions(quotedOrder, { ...payCtx, language: "es" }), /AL-|en la nota/);
});

test("an English sentence is quoted in English", async () => {
  const store = createMemoryStore();
  const decision = await handleIncoming(store, {
    subscriberId: "en-quote",
    text: "how much is one photo",
    firstName: null,
    igUsername: null,
  });
  assert.match(decision.reply, /one photo of these huge 30k breasts is \$15/);
  assert.match(decision.reply, /Venmo @bluejays0137 or Cash App \$Arialluxe/);
  assert.match(decision.reply, /send me the payment screen/);
  assert.doesNotMatch(decision.reply, /mándame|pon |una foto|aquí/);
});

test("a Spanish pack request is quoted in Spanish", async () => {
  const store = createMemoryStore();
  const decision = await handleIncoming(store, {
    subscriberId: "es-quote",
    text: "quiero una foto",
    firstName: null,
    igUsername: null,
  });
  assert.match(
    decision.reply,
    /mmm una foto de estas tetas enormes de 30k, \$15\. Venmo @bluejays0137 o Cash App \$Arialluxe\. mándame la captura del pago, me mojo enseñándolas\./,
  );
  assert.doesNotMatch(decision.reply, /send me the screenshot|put /);
});

test("ya pagué asks for the screenshot in Spanish and does not release files", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "es-paid",
    text: "una foto",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "es-paid",
    text: "ya pagué",
    firstName: null,
    igUsername: null,
  });
  assert.equal(decision.reply, "mándame la captura del pago de verdad y te mando los archivos de estas tetas enormes de 30k.");
  assert.doesNotMatch(decision.reply, /\/downloads\//);
  assert.equal((await store.listOrders("verified")).length, 0);
  assert.equal((await store.listOrders("pending_verification")).length, 1);
});

test("a screenshot after a Spanish order sends the links in Spanish", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "es-shot",
    text: "una foto",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "es-shot",
    text: "[image]",
    firstName: null,
    igUsername: null,
    paymentScreenshot: true,
  });
  assert.equal(decision.reply, "esa captura me mojó. estas tetas enormes de 30k ya son tuyas.");
  assert.doesNotMatch(decision.reply, /\/downloads\/|https?:/);
  assert.equal(decision.media?.length, 1);
  assert.equal(decision.media?.[0]?.type, "image");
  assert.doesNotMatch(decision.reply, /I checked the screenshot|payment's good/);
  assert.equal((await store.listOrders("verified")).length, 1);
});

test("a Spanish screenshot claim does not release files and an English follow-up stays English", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "mix",
    text: "tres fotos",
    firstName: null,
    igUsername: null,
  });
  const spanishShot = await handleIncoming(store, {
    subscriberId: "mix",
    text: "aquí va la captura",
    firstName: null,
    igUsername: null,
  });
  assert.equal(
    spanishShot.reply,
    "mándame la captura del pago de verdad y te mando los archivos de estas tetas enormes de 30k.",
  );
  assert.equal(spanishShot.media?.length ?? 0, 0);
  assert.doesNotMatch(spanishShot.reply, /\/downloads\//);
  assert.equal((await store.listOrders("verified")).length, 0);

  const storeEn = createMemoryStore();
  await handleIncoming(storeEn, {
    subscriberId: "mix-en",
    text: "una foto",
    firstName: null,
    igUsername: null,
  });
  const englishPaid = await handleIncoming(storeEn, {
    subscriberId: "mix-en",
    text: "I paid",
    firstName: null,
    igUsername: null,
  });
  assert.match(englishPaid.reply, /send me the actual payment screen/);
  assert.doesNotMatch(englishPaid.reply, /mándame/);
  assert.equal((await storeEn.listOrders("verified")).length, 0);
});

test("short or mixed messages follow the recent conversation, otherwise English", () => {
  assert.equal(detectMessageLanguage("hi"), null);
  assert.equal(detectMessageLanguage("[image]"), null);
  assert.equal(detectMessageLanguage("hola thanks"), null);
  assert.equal(detectMessageLanguage("how much is one photo"), "en");
  assert.equal(detectMessageLanguage("quiero una foto"), "es");
  assert.equal(resolveReplyLanguage("hi", []), "en");
  assert.equal(resolveReplyLanguage("[image]", []), "en");
  assert.equal(resolveReplyLanguage("hi", [{ role: "user", text: "una foto" }]), "es");
  assert.equal(
    resolveReplyLanguage("hola thanks", [{ role: "user", text: "one photo please" }]),
    "en",
  );
  assert.equal(resolveReplyLanguage("", [{ role: "assistant", text: "hola. fotos o videos?" }]), "es");
  assert.equal(textShowsPaymentScreenshot("ya pagué"), false);
  assert.equal(textShowsPaymentScreenshot("mándame la captura del pago"), false);
  assert.equal(textShowsPaymentScreenshot("aquí va la captura"), false);
  assert.equal(textShowsPaymentScreenshot("here's the screenshot"), false);
  assert.equal(textShowsPaymentScreenshot("[image]"), true);
});

test("a digit after a Spanish DM is quoted in Spanish", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "digit",
    text: "fotos",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "digit",
    text: "1",
    firstName: null,
    igUsername: null,
  });
  assert.match(decision.reply, /una foto de estas tetas enormes de 30k, \$15/);
  assert.match(decision.reply, /mándame la captura/);
  assert.doesNotMatch(decision.reply, /send me the screenshot/);
});

test("model scripted lines use the conversation language", () => {
  const spanish = decisionFromModel(
    '{"reply":"ok","intent":"opt_out","packId":null,"needsHuman":false}',
    { ...payCtx, language: "es" },
  );
  assert.match(spanish.reply, /ya no te escribo/);

  const english = decisionFromModel(
    '{"reply":"ya pagué","intent":"payment_claim","packId":null,"needsHuman":false}',
    { ...payCtx, language: "en", openOrder: quotedOrder },
  );
  assert.equal(english.reply, "send me the actual payment screen and I'll send you the files of these huge 30k breasts.");
  assert.equal(english.orderAction, "claim_payment");

  const spanishPaid = decisionFromModel(
    '{"reply":"I paid","intent":"payment_claim","packId":null,"needsHuman":false}',
    { ...payCtx, language: "es", openOrder: quotedOrder },
  );
  assert.equal(spanishPaid.reply, "mándame la captura del pago de verdad y te mando los archivos de estas tetas enormes de 30k.");

  const spanishPrompt = systemPrompt({ ...payCtx, language: "es" });
  assert.doesNotMatch(spanishPrompt, /This turn is Spanish/);
  assert.equal(turnInstruction({ ...payCtx, language: "es" }), "This turn is Spanish. Reply in casual Spanish only.");
  assert.match(spanishPrompt, /casual/);
  assert.match(spanishPrompt, /tengo 21/);
  assert.match(spanishPrompt, /30k/);
  assert.match(spanishPrompt, /estoy en US/);
});

test("age and location stay plain and do not invent a biography", () => {
  assert.equal(decideDeterministic("how old are you", payCtx)?.reply, "I'm 21.");
  assert.equal(decideDeterministic("what's your age?", payCtx)?.reply, "I'm 21.");
  assert.equal(decideDeterministic("cuántos años tienes", payCtx)?.reply, "tengo 21.");
  assert.equal(decideDeterministic("qué edad tienes?", payCtx)?.reply, "tengo 21.");
  assert.equal(decideDeterministic("where are you", payCtx)?.reply, "I'm in the US.");
  assert.equal(decideDeterministic("where do you live?", payCtx)?.reply, "I'm in the US.");
  assert.equal(decideDeterministic("what city are you in", payCtx)?.reply, "I'm in the US.");
  assert.equal(decideDeterministic("dónde estás", payCtx)?.reply, "estoy en US.");
  assert.equal(decideDeterministic("de dónde eres?", payCtx)?.reply, "estoy en US.");
  assert.equal(decideDeterministic("where do I pay", payCtx), null);
  assert.doesNotMatch(String(decideDeterministic("where are you from?", payCtx)?.reply), /california|new york|school|boyfriend/i);
});

test("an English age question stays English after a Spanish order", async () => {
  const store = createMemoryStore();
  await handleIncoming(store, {
    subscriberId: "age",
    text: "una foto",
    firstName: null,
    igUsername: null,
  });
  const decision = await handleIncoming(store, {
    subscriberId: "age",
    text: "how old are you",
    firstName: null,
    igUsername: null,
  });
  assert.equal(decision.reply, "I'm 21.");
  assert.equal((await store.listOrders("verified")).length, 0);
});

test("a Spanish location question is answered in Spanish", async () => {
  const store = createMemoryStore();
  const decision = await handleIncoming(store, {
    subscriberId: "loc",
    text: "dónde estás",
    firstName: null,
    igUsername: null,
  });
  assert.equal(decision.reply, "estoy en US.");
});
