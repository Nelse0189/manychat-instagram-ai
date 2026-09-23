import type { PackId } from "./catalog.js";

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

export type Subscriber = {
  subscriberId: string;
  firstName: string | null;
  igUsername: string | null;
  optedOut: boolean;
  needsHuman: boolean;
};

export type IncomingMessage = {
  subscriberId: string;
  text: string;
  firstName: string | null;
  igUsername: string | null;
};

export type Decision = {
  reply: string;
  intent: Intent;
  needsHuman: boolean;
  useModel: boolean;
  packId: PackId | null;
  orderAction: "quote" | "claim_payment" | null;
};
