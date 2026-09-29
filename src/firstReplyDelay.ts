/** Longest wait before the first shop reply. Inclusive of both ends. */
export const FIRST_REPLY_DELAY_MAX_MS = 10 * 60 * 1000;

/**
 * Random wait for the first reply in a conversation, from 0 through 10 minutes.
 * This value is a Cloud Tasks schedule time. It must not be slept inside the webhook.
 */
export function firstReplyDelayMs(random: () => number = Math.random): number {
  const sample = Math.min(Math.max(random(), 0), 0.999999999);
  return Math.floor(sample * (FIRST_REPLY_DELAY_MAX_MS + 1));
}
