import type { PackId } from "./catalog.js";

export type { PackId };

export type Intent =
  | "browse"
  | "purchase"
  | "payment_claim"
  | "support"
  | "opt_out"
  | "videos"
  | "other";

export type OrderStatus = "quoted" | "pending_verification" | "verified" | "cancelled";

export type Order = {
  id: string;
  reference: string;
  subscriberId: string;
  packId: PackId;
  packName: string;
  amountUsd: number;
  currency: "USD";
  status: OrderStatus;
  fileNames: string[];
  downloadToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type SubscriberMemory = {
  name: string | null;
  language: "en" | "es" | null;
  interests: string[];
  objections: string[];
  lastPackShown: PackId | null;
  pitchCount: number;
  lastPitchAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  userTurns: number;
};

export type Subscriber = {
  subscriberId: string;
  firstName: string | null;
  igUsername: string | null;
  optedOut: boolean;
  needsHuman: boolean;
  memory?: SubscriberMemory;
};

export type IncomingMessage = {
  subscriberId: string;
  text: string;
  firstName: string | null;
  igUsername: string | null;
  paymentScreenshot?: boolean;
};

export type OutboundMedia = {
  type: "image" | "video";
  url: string;
};

export type Decision = {
  reply: string;
  intent: Intent;
  needsHuman: boolean;
  useModel: boolean;
  packId: PackId | null;
  orderAction: "quote" | "claim_payment" | "fulfill" | null;
  media?: OutboundMedia[];
};

export type PendingReply = {
  subscriberId: string;
  dueAt: string;
  taskName: string | null;
  media: OutboundMedia[];
  filesReady: boolean;
  filesFailed: boolean;
  sawPaymentScreenshot: boolean;
  quoted: boolean;
  claimed: boolean;
  releasedPackId: PackId | null;
  releasedPackName: string | null;
  createdAt: string;
  updatedAt: string;
};
