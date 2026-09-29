/** ManyChat waits 10 seconds for a Dynamic block HTTP response, then drops it. */
export const MANYCHAT_DYNAMIC_TIMEOUT_MS = 10_000;

/** Leave room for the response to reach ManyChat before that cutoff. */
export const TYPING_RESPONSE_MARGIN_MS = 800;

/** Longest pause. A few seconds, not a 30 second wait. */
export const TYPING_DELAY_MAX_MS = 4_000;

export function typingDelayMs(options: {
  replyText: string;
  elapsedMs: number;
  random?: () => number;
}): number {
  const random = options.random ?? Math.random;
  const budget = MANYCHAT_DYNAMIC_TIMEOUT_MS - TYPING_RESPONSE_MARGIN_MS - Math.max(0, options.elapsedMs);
  if (budget <= 0) return 0;

  const characters = Array.from(options.replyText).length;
  const base = 450 + random() * 1_050;
  const perCharacter = 22 + random() * 28;
  const wobble = random() * 350;
  const wanted = base + characters * perCharacter + wobble;
  return Math.round(Math.min(wanted, TYPING_DELAY_MAX_MS, budget));
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
