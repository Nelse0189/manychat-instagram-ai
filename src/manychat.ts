import { config } from "./config.js";
import { isPaymentImageUrl, textShowsPaymentScreenshot } from "./sales.js";
import type { Decision, IncomingMessage } from "./types.js";

const IMAGE_TYPES = new Set(["image", "photo", "picture", "ig_image"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unresolvedTemplate(value: string): boolean {
  return value.includes("{{") && value.includes("}}");
}

function messageText(record: Record<string, unknown>): string {
  for (const value of [record.last_input_text, record.text, record.message, record.last_input]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const key of ["message", "last_input"]) {
    const nested = asRecord(record[key]);
    if (!nested) continue;
    for (const field of ["text", "body", "caption", "last_input_text"]) {
      const value = nested[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

function valueHasImage(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || unresolvedTemplate(trimmed)) return false;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return valueHasImage(JSON.parse(trimmed) as unknown, depth + 1);
      } catch {
        return textShowsPaymentScreenshot(trimmed);
      }
    }
    return textShowsPaymentScreenshot(trimmed);
  }
  if (Array.isArray(value)) return value.some((item) => valueHasImage(item, depth + 1));
  const record = asRecord(value);
  if (!record) return false;
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (IMAGE_TYPES.has(type)) return true;
  if (type === "audio" || type === "video" || type === "sticker" || type === "story_mention") {
    return false;
  }
  for (const key of ["url", "media_url", "image_url", "imageUrl", "mediaUrl", "attachment_url", "file_url"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && !unresolvedTemplate(candidate) && isPaymentImageUrl(candidate)) {
      return true;
    }
  }
  return (
    valueHasImage(record.payload, depth + 1) ||
    valueHasImage(record.attachments, depth + 1) ||
    valueHasImage(record.attachment, depth + 1)
  );
}

function messageHasImage(record: Record<string, unknown>, text: string): boolean {
  if (textShowsPaymentScreenshot(text)) return true;
  for (const key of ["message_type", "last_input_type", "input_type"]) {
    const value = record[key];
    if (typeof value === "string" && IMAGE_TYPES.has(value.trim().toLowerCase())) return true;
  }
  for (const key of [
    "attachments",
    "attachment",
    "media",
    "media_url",
    "image_url",
    "imageUrl",
    "mediaUrl",
    "attachment_url",
    "file_url",
    "message",
    "last_input",
  ]) {
    if (key in record && valueHasImage(record[key])) return true;
  }
  return false;
}

export function parseIncoming(body: unknown): IncomingMessage | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const rawId = record.id ?? record.subscriber_id ?? record.user_id;
  if (rawId == null || rawId === "") return null;
  const text = messageText(record);
  return {
    subscriberId: String(rawId),
    text,
    firstName: typeof record.first_name === "string" ? record.first_name : null,
    igUsername:
      typeof record.ig_username === "string"
        ? record.ig_username
        : typeof record.username === "string"
          ? record.username
          : null,
    paymentScreenshot: messageHasImage(record, text),
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
