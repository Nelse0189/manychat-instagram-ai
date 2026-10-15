import type { PackId } from "./catalog.js";
import type { ChatMessage, SubscriberMemory } from "./types.js";

export const HISTORY_TURNS = 20;

const NAME_STOPWORDS = new Set([
  "a", "an", "the", "not", "just", "from", "here", "there", "new", "good", "fine", "ok", "okay",
  "interested", "looking", "back", "sorry", "sure", "real", "bored", "tired", "down", "ready",
  "de", "el", "la", "un", "una", "tu", "muy", "nuevo", "nueva", "aqui", "bien", "mexicano",
  "colombiano", "venezolano", "argentino", "peruano", "chileno", "dominicano", "cubano",
]);

const MAX_INTERESTS = 6;
const MAX_OBJECTIONS = 4;

export function emptyMemory(): SubscriberMemory {
  return {
    name: null,
    language: null,
    interests: [],
    objections: [],
    lastPackShown: null,
    pitchCount: 0,
    lastPitchAt: null,
    firstSeenAt: null,
    lastSeenAt: null,
    userTurns: 0,
  };
}

function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const name = raw.replace(/[^\p{L}'-]/gu, "");
  if (name.length < 2 || name.length > 20) return null;
  if (NAME_STOPWORDS.has(name.toLowerCase())) return null;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

export function extractStatedName(text: string): string | null {
  const explicit = text.match(
    /\b(?:my name(?:'s| is)|name's|call me|i go by|me llamo|mi nombre es|llamame|llámame)\s+([\p{L}'-]{2,20})/iu,
  );
  if (explicit) return cleanName(explicit[1]);
  const capitalized = text.match(/\b(?:[Ii]'?m|[Ii]m|[Tt]his is|[Ss]oy|[Ii]t'?s)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]{1,19})\b/u);
  if (capitalized) return cleanName(capitalized[1]);
  return null;
}

const INTEREST_RULES: Array<[string, RegExp]> = [
  ["photos", /\b(photos?|pics?|pictures?|fotos?)\b/i],
  ["videos", /\b(videos?|vids?|clips?)\b/i],
  ["price", /\b(how much|prices?|cost|precios?|cuanto|cuánto)\b/i],
  ["age", /\b(how old|your age|cuantos anos|cuántos años|que edad|qué edad)\b/i],
  ["location", /\b(where are you|where you from|where do you live|donde vives|dónde vives|de donde eres|de dónde eres)\b/i],
  ["payment methods", /\b(venmo|cash ?app|paypal|zelle)\b/i],
];

const OBJECTION_RULES: Array<[string, RegExp]> = [
  ["said it's too expensive", /\b(too much|expensive|too pricey|cheaper|discount|caro|muy caro|descuento|lower)\b/i],
  ["worried it's a scam", /\b(scam|legit|fake|trust|estafa|fraude|confio|confío)\b/i],
  ["wanted to see something first", /\b(see (a|one) (first|sample|preview)|sample|preview|free one|prueba|muestra)\b/i],
];

function pushUnique(list: string[], value: string, max: number): string[] {
  if (list.includes(value)) return list;
  return [...list, value].slice(-max);
}

export function updateMemoryFromUser(
  previous: SubscriberMemory | undefined,
  input: {
    text: string;
    language: "en" | "es" | null;
    packId: PackId | null;
    now: string;
  },
): SubscriberMemory {
  const memory: SubscriberMemory = { ...emptyMemory(), ...previous };
  memory.interests = [...(previous?.interests ?? [])];
  memory.objections = [...(previous?.objections ?? [])];
  const text = input.text.trim();
  if (text) {
    memory.userTurns += 1;
    memory.name = extractStatedName(text) ?? memory.name;
    for (const [label, pattern] of INTEREST_RULES) {
      if (pattern.test(text)) memory.interests = pushUnique(memory.interests, label, MAX_INTERESTS);
    }
    for (const [label, pattern] of OBJECTION_RULES) {
      if (pattern.test(text)) memory.objections = pushUnique(memory.objections, label, MAX_OBJECTIONS);
    }
  }
  if (input.language) memory.language = input.language;
  if (input.packId) memory.lastPackShown = input.packId;
  memory.firstSeenAt = memory.firstSeenAt ?? input.now;
  memory.lastSeenAt = input.now;
  return memory;
}

const PITCH = /\$\s?\d|venmo|cash\s?app/i;

export function replyPitched(reply: string): boolean {
  return PITCH.test(reply);
}

export function updateMemoryFromReply(
  previous: SubscriberMemory | undefined,
  input: { reply: string; packId: PackId | null; now: string },
): SubscriberMemory {
  const memory: SubscriberMemory = { ...emptyMemory(), ...previous };
  memory.interests = [...(previous?.interests ?? [])];
  memory.objections = [...(previous?.objections ?? [])];
  if (replyPitched(input.reply)) {
    memory.pitchCount += 1;
    memory.lastPitchAt = input.now;
  }
  if (input.packId) memory.lastPackShown = input.packId;
  return memory;
}

export function formatGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function timeOf(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const GAP_MARK_MS = 30 * 60_000;

export function historyForModel(
  history: ChatMessage[],
  turns = HISTORY_TURNS,
): Array<{ role: "user" | "assistant"; content: string }> {
  const recent = history.slice(-turns);
  const earlier = history.length > recent.length ? history[history.length - recent.length - 1] : undefined;
  let previousAt = timeOf(earlier?.createdAt);
  return recent.map((message) => {
    const at = timeOf(message.createdAt);
    let content = message.text;
    if (message.role === "user" && previousAt != null && at != null && at - previousAt >= GAP_MARK_MS) {
      content = `[${formatGap(at - previousAt)} later] ${content}`;
    }
    if (at != null) previousAt = at;
    return { role: message.role, content };
  });
}

export function timelineNote(input: {
  history: ChatMessage[];
  userAt: string;
  now: string;
}): string {
  const { history } = input;
  if (history.length === 0) {
    return "This is the very first message between you two. You have not talked before.";
  }
  const parts: string[] = [];
  const userAt = timeOf(input.userAt) ?? timeOf(input.now);
  const first = timeOf(history[0]?.createdAt);
  const last = timeOf(history[history.length - 1]?.createdAt);
  if (userAt != null && last != null && userAt - last >= GAP_MARK_MS) {
    parts.push(
      `They wrote back ${formatGap(userAt - last)} after the last message in the chat. If it fits, acknowledge the gap lightly, like a person would. Do not make a big deal of it.`,
    );
  }
  if (userAt != null && first != null && userAt - first >= 24 * 3_600_000) {
    parts.push(`You have been chatting on and off for about ${formatGap(userAt - first)}.`);
  }
  return parts.join(" ");
}

export function memoryNote(
  memory: SubscriberMemory | undefined,
  igName: string | null,
): string {
  const lines: string[] = [];
  if (memory?.name) lines.push(`They told you their name is ${memory.name}.`);
  else if (igName) lines.push(`Their Instagram profile name is ${igName}. It may not be their real name, so do not lean on it.`);
  if (memory?.interests.length) lines.push(`Things they've asked about or shown interest in: ${memory.interests.join(", ")}.`);
  if (memory?.objections.length) lines.push(`Things they've pushed back on or worried about: ${memory.objections.join("; ")}.`);
  if (memory?.lastPackShown) lines.push(`The last pack that came up with them was ${memory.lastPackShown.replace("_", " ")}.`);
  if (memory && memory.pitchCount > 0) {
    lines.push(
      `You have already sent prices or payment info ${memory.pitchCount} time${memory.pitchCount === 1 ? "" : "s"}. Do not pitch again unless they ask or are clearly ready to buy.`,
    );
  } else if (memory && memory.userTurns >= 4) {
    lines.push("You have chatted a bit and have not brought up the packs yet. If it fits naturally, you can mention them once, lightly.");
  } else {
    lines.push("You have not brought up the packs or any prices yet.");
  }
  return lines.length ? `What you remember about this person: ${lines.join(" ")}` : "";
}
