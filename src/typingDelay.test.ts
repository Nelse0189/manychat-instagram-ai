import assert from "node:assert/strict";
import test from "node:test";
import {
  MANYCHAT_DYNAMIC_TIMEOUT_MS,
  TYPING_DELAY_MAX_MS,
  TYPING_RESPONSE_MARGIN_MS,
  typingDelayMs,
} from "./typingDelay.js";

const halfway = () => 0.5;

test("a longer reply waits longer than a short one", () => {
  const short = typingDelayMs({ replyText: "hey", elapsedMs: 400, random: halfway });
  const long = typingDelayMs({
    replyText: "hey ".repeat(80),
    elapsedMs: 400,
    random: halfway,
  });
  assert.ok(long > short);
  assert.ok(short > 0);
  assert.ok(long <= TYPING_DELAY_MAX_MS);
});

test("the same reply does not always wait the same amount", () => {
  const first = typingDelayMs({ replyText: "one photo?", elapsedMs: 500, random: () => 0.1 });
  const second = typingDelayMs({ replyText: "one photo?", elapsedMs: 500, random: () => 0.9 });
  assert.notEqual(first, second);
  assert.ok(second > first);
});

test("a slow model call leaves only a short delay inside the ManyChat timeout", () => {
  const almostOut = typingDelayMs({
    replyText: "x".repeat(400),
    elapsedMs: 8_700,
    random: halfway,
  });
  const budget = MANYCHAT_DYNAMIC_TIMEOUT_MS - TYPING_RESPONSE_MARGIN_MS - 8_700;
  assert.ok(almostOut > 0);
  assert.ok(almostOut <= budget);
  assert.ok(almostOut < 1_000);

  assert.equal(
    typingDelayMs({ replyText: "x".repeat(400), elapsedMs: 9_500, random: halfway }),
    0,
  );
});

test("the delay never uses a single fixed sleep and stays under a few seconds", () => {
  const samples = [0.05, 0.2, 0.4, 0.6, 0.85, 0.97].map((value) =>
    typingDelayMs({ replyText: "send me those", elapsedMs: 1_200, random: () => value }),
  );
  assert.equal(new Set(samples).size, samples.length);
  for (const sample of samples) {
    assert.ok(sample > 0);
    assert.ok(sample <= TYPING_DELAY_MAX_MS);
    assert.ok(sample < 5_000);
    assert.ok(sample <= MANYCHAT_DYNAMIC_TIMEOUT_MS - TYPING_RESPONSE_MARGIN_MS - 1_200);
  }
});
