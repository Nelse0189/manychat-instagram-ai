/** Longest wait before the first shop reply. Inclusive of both ends. */
export const FIRST_REPLY_DELAY_MAX_MS = 10 * 60 * 1000;

/** Longest wait before a later shop reply. Inclusive of both ends. */
export const LATER_REPLY_DELAY_MAX_MS = 3 * 60 * 1000;

function delayMs(maxMs: number, random: () => number): number {
  const sample = Math.min(Math.max(random(), 0), 0.999999999);
  return Math.floor(sample * (maxMs + 1));
}

/**
 * Random wait for the first reply in a conversation, from 0 through 10 minutes.
 * This value is a Cloud Tasks schedule time. It must not be slept inside the webhook.
 */
export function firstReplyDelayMs(random: () => number = Math.random): number {
  return delayMs(FIRST_REPLY_DELAY_MAX_MS, random);
}

/**
 * Random wait after a bot reply has already been sent, from 0 through 3 minutes.
 * This is also a Cloud Tasks schedule time, not a sleep in the webhook.
 */
export function laterReplyDelayMs(random: () => number = Math.random): number {
  return delayMs(LATER_REPLY_DELAY_MAX_MS, random);
}
