import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMemory,
  extractStatedName,
  formatGap,
  historyForModel,
  memoryNote,
  timelineNote,
  updateMemoryFromReply,
  updateMemoryFromUser,
} from "./memory.js";
import type { ChatMessage } from "./types.js";

const NOW = "2026-10-15T12:00:00.000Z";

test("names are only taken when they are clearly stated", () => {
  assert.equal(extractStatedName("my name is mike"), "Mike");
  assert.equal(extractStatedName("call me Jay"), "Jay");
  assert.equal(extractStatedName("me llamo carlos"), "Carlos");
  assert.equal(extractStatedName("I'm Diego btw"), "Diego");
  assert.equal(extractStatedName("im bored"), null);
  assert.equal(extractStatedName("soy de mexico"), null);
  assert.equal(extractStatedName("I'm interested in photos"), null);
});

test("memory keeps name, language, interests, objections, and the last pack", () => {
  let memory = updateMemoryFromUser(undefined, { text: "hey my name is mike", language: "en", packId: null, now: NOW });
  memory = updateMemoryFromUser(memory, { text: "how much for videos? seems expensive", language: "en", packId: null, now: NOW });
  memory = updateMemoryFromUser(memory, { text: "ok three videos", language: "en", packId: "video_3", now: NOW });
  assert.equal(memory.name, "Mike");
  assert.equal(memory.language, "en");
  assert.deepEqual(memory.interests, ["videos", "price"]);
  assert.deepEqual(memory.objections, ["said it's too expensive"]);
  assert.equal(memory.lastPackShown, "video_3");
  assert.equal(memory.userTurns, 3);
  assert.equal(memory.firstSeenAt, NOW);
  assert.equal(JSON.stringify(memory).includes("undefined"), false);
});

test("a spanish chat is remembered as spanish", () => {
  const memory = updateMemoryFromUser(undefined, { text: "hola, cuanto cuesta", language: "es", packId: null, now: NOW });
  assert.equal(memory.language, "es");
  assert.ok(memory.interests.includes("price"));
});

test("replies with prices count as a pitch", () => {
  let memory = updateMemoryFromReply(emptyMemory(), { reply: "lol hey", packId: null, now: NOW });
  assert.equal(memory.pitchCount, 0);
  memory = updateMemoryFromReply(memory, { reply: "one photo is $15, venmo or cash app", packId: "photo_1", now: NOW });
  assert.equal(memory.pitchCount, 1);
  assert.equal(memory.lastPitchAt, NOW);
  assert.equal(memory.lastPackShown, "photo_1");
});

test("the memory note says what is known and stops repeat pitches", () => {
  const fresh = memoryNote(emptyMemory(), "Sam");
  assert.match(fresh, /Instagram profile name is Sam/);
  assert.match(fresh, /not brought up the packs/);
  const known = memoryNote(
    {
      ...emptyMemory(),
      name: "Mike",
      interests: ["videos"],
      objections: ["said it's too expensive"],
      lastPackShown: "video_3",
      pitchCount: 2,
      userTurns: 6,
    },
    "Sam",
  );
  assert.match(known, /name is Mike/);
  assert.doesNotMatch(known, /Instagram profile name/);
  assert.match(known, /videos/);
  assert.match(known, /video 3/);
  assert.match(known, /already sent prices or payment info 2 times/);
  const chatted = memoryNote({ ...emptyMemory(), userTurns: 5 }, null);
  assert.match(chatted, /mention them once, lightly/);
});

test("gaps are described in plain words", () => {
  assert.equal(formatGap(20_000), "under a minute");
  assert.equal(formatGap(5 * 60_000), "5 minutes");
  assert.equal(formatGap(3 * 3_600_000), "3 hours");
  assert.equal(formatGap(3 * 86_400_000), "3 days");
});

test("history marks long gaps on their texts and keeps the last 20 turns", () => {
  const messages: ChatMessage[] = [
    { role: "user", text: "hey", createdAt: "2026-10-12T10:00:00.000Z" },
    { role: "assistant", text: "heyy", createdAt: "2026-10-12T10:01:00.000Z" },
    { role: "user", text: "back", createdAt: "2026-10-15T10:00:00.000Z" },
    { role: "assistant", text: "oh hi", createdAt: "2026-10-15T10:00:30.000Z" },
    { role: "user", text: "wyd", createdAt: "2026-10-15T10:02:00.000Z" },
  ];
  const mapped = historyForModel(messages);
  assert.deepEqual(
    mapped.map((message) => message.content),
    ["hey", "heyy", "[3 days later] back", "oh hi", "wyd"],
  );
  const many = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: `t${index}`,
    createdAt: "",
  }));
  assert.equal(historyForModel(many).length, 20);
  assert.equal(historyForModel(many)[0]?.content, "t20");
});

test("the timeline note covers a first message and a long gap", () => {
  assert.match(timelineNote({ history: [], userAt: NOW, now: NOW }), /very first message/);
  const history: ChatMessage[] = [
    { role: "user", text: "hey", createdAt: "2026-10-13T12:00:00.000Z" },
    { role: "assistant", text: "heyy", createdAt: "2026-10-13T12:01:00.000Z" },
  ];
  const note = timelineNote({ history, userAt: NOW, now: NOW });
  assert.match(note, /wrote back 2 days after/);
  assert.match(note, /chatting on and off for about 2 days/);
  const quick = timelineNote({
    history,
    userAt: "2026-10-13T12:03:00.000Z",
    now: "2026-10-13T12:03:00.000Z",
  });
  assert.equal(quick, "");
});
