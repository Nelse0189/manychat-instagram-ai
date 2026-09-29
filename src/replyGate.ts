import { firstReplyDelayMs } from "./firstReplyDelay.js";
import type { ReplyScheduler } from "./cloudTasks.js";
import { composeDeferredReply, handleIncoming, recordIncoming } from "./handleIncoming.js";
import { dynamicBlock, silentDynamicBlock } from "./manychat.js";
import { resolveReplyLanguage, supportText } from "./sales.js";
import type { Store } from "./store.js";
import { sleep, typingDelayMs } from "./typingDelay.js";
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
  const pause = input.pause ?? sleep;
  const alreadyReplied = await input.store.hasAssistantReply(input.incoming.subscriberId);

  if (alreadyReplied) {
    const started = now;
    try {
      const decision = await handleIncoming(input.store, input.incoming);
      const delay = typingDelayMs({
        replyText: decision.reply,
        elapsedMs: Date.now() - started,
      });
      await pause(delay);
      return { status: 200, body: dynamicBlock(decision) };
    } catch (error) {
      console.error(error);
      const reply = supportText(resolveReplyLanguage(input.incoming.text));
      await pause(typingDelayMs({ replyText: reply, elapsedMs: Date.now() - started }));
      return {
        status: 200,
        body: dynamicBlock({
          reply,
          intent: "support",
          needsHuman: true,
          useModel: false,
          packId: null,
          orderAction: null,
        }),
      };
    }
  }

  const recorded = await recordIncoming(input.store, input.incoming);
  const existing = await input.store.getPendingReply(input.incoming.subscriberId);
  const dueAt =
    existing?.dueAt ?? new Date(now + firstReplyDelayMs(input.random)).toISOString();
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
  if (await input.store.hasAssistantReply(input.subscriberId)) {
    await input.store.deletePendingReply(input.subscriberId);
    return "skipped";
  }
  const pending = await input.store.getPendingReply(input.subscriberId);
  if (!pending && (await input.store.recentMessages(input.subscriberId, 1)).length === 0) {
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
