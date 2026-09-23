import { config } from "./config.js";
import type { Decision, IncomingMessage } from "./types.js";

export function parseIncoming(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const rawId = record.id ?? record.subscriber_id ?? record.user_id;
  if (rawId == null || rawId === "") return null;
  const text = record.last_input_text ?? record.text ?? record.message ?? "";
  return {
    subscriberId: String(rawId),
    text: typeof text === "string" ? text.trim() : "",
    firstName: typeof record.first_name === "string" ? record.first_name : null,
    igUsername:
      typeof record.ig_username === "string"
        ? record.ig_username
        : typeof record.username === "string"
          ? record.username
          : null,
  };
}

export function dynamicBlock(decision: Decision): Record<string, unknown> {
  const actions: Array<Record<string, string>> = [];
  if (decision.intent === "opt_out") {
    actions.push({ action: "add_tag", tag_name: "opted_out" });
  }
  if (decision.needsHuman) {
    actions.push({ action: "add_tag", tag_name: "needs_human" });
  }
  if (decision.intent === "payment_claim" && decision.orderAction === "claim_payment") {
    actions.push({ action: "add_tag", tag_name: "payment_pending" });
  }

  const content: Record<string, unknown> = {
    type: "instagram",
    messages: [{ type: "text", text: decision.reply }],
    actions,
    quick_replies: [],
  };

  if (config.publicBaseUrl.startsWith("https://")) {
    const headers: Record<string, string> = {};
    if (config.webhookSecret) headers["x-webhook-secret"] = config.webhookSecret;
    content.external_message_callback = {
      url: `${config.publicBaseUrl}/manychat/dynamic`,
      method: "post",
      headers,
      payload: {
        id: "{{user_id}}",
        first_name: "{{first_name}}",
        ig_username: "{{ig_username}}",
        last_input_text: "{{last_input_text}}",
      },
      timeout: 86400,
    };
  }

  return { version: "v2", content };
}
