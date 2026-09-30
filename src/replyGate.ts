import type { ReplyScheduler } from "./cloudTasks.js";
import { firstReplyDelayMs, laterReplyDelayMs } from "./firstReplyDelay.js";
import { composeDeferredReply, recordIncoming } from "./handleIncoming.js";
import { silentDynamicBlock } from "./manychat.js";
import type { Store } from "./store.js";
import type { Decision, IncomingMessage } from "./types.js";

export type OutboundSender = (subscriberId: string, decision: Decision) => Promise<void>;

function blockMessages(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const content = body.content;
  if (!content || typeof content !== "object") return [];
  const messages = (content as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as Array<Record<string, unknown>>) : [];
}

export async function acceptShopMessage(input: {
  store: Store;
  scheduler: ReplyScheduler;
  incoming: IncomingMessage;
  now?: number;
  random?: () => number;
  pause?: (ms: number) => Promise<void>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = input.now ?? Date.now();
  const alreadyReplied = await input.store.hasAssistantReply(input.incoming.subscriberId);
  const recorded = await recordIncoming(input.store, input.incoming);
  const existing = await input.store.getPendingReply(input.incoming.subscriberId);
  const dueAt =
    existing?.dueAt ??
    new Date(
      now + (alreadyReplied ? laterReplyDelayMs(input.random) : firstReplyDelayMs(input.random)),
    ).toISOString();
  const { pending, created } = await input.store.mergePendingReply({
    subscriberId: input.incoming.subscriberId,
    dueAt,
    now: new Date(now).toISOString(),
    media: recorded.media,
    filesReady: recorded.filesReady,
    filesFailed: recorded.filesFailed,
    sawPaymentScreenshot: recorded.paymentScreenshot,
    quoted: recorded.quoted,
    claimed: recorded.claimed,
    releasedPackId: recorded.releasedPackId,
    releasedPackName: recorded.releasedPackName,
  });
  if (created || !pending.taskName) {
    const taskName = await input.scheduler.schedule({
      subscriberId: input.incoming.subscriberId,
      dueAt: pending.dueAt,
    });
    await input.store.attachPendingTask(input.incoming.subscriberId, taskName);
  }
  return { status: 200, body: silentDynamicBlock() };
}

export async function deliverScheduledReply(input: {
  store: Store;
  subscriberId: string;
  send: OutboundSender;
}): Promise<"sent" | "skipped"> {
  const pending = await input.store.getPendingReply(input.subscriberId);
  if (!pending) return "skipped";
  const recent = await input.store.recentMessages(input.subscriberId, 40);
  const alreadySent = recent.some(
    (message) => message.role === "assistant" && message.createdAt > pending.createdAt,
  );
  if (alreadySent) {
    await input.store.deletePendingReply(input.subscriberId);
    return "skipped";
  }
  let decision = await composeDeferredReply(input.store, input.subscriberId);
  const after = await input.store.getPendingReply(input.subscriberId);
  if (pending && after && after.updatedAt !== pending.updatedAt) {
    decision = await composeDeferredReply(input.store, input.subscriberId);
  }
  await input.send(input.subscriberId, decision);
  await input.store.addMessage(input.subscriberId, {
    role: "assistant",
    text: decision.reply,
    createdAt: new Date().toISOString(),
  });
  await input.store.deletePendingReply(input.subscriberId);
  return "sent";
}

export function responseHasCustomerText(body: Record<string, unknown>): boolean {
  return blockMessages(body).some((message) => message.type === "text" && typeof message.text === "string" && message.text.trim());
}
