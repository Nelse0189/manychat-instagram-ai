import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { config, firebaseConfigured } from "./config.js";
import { orderReference } from "./memoryStore.js";
import { mergePendingReply } from "./pendingReply.js";
import type { NewOrder, Store } from "./store.js";
import type {
  ChatMessage,
  Order,
  OrderStatus,
  OutboundMedia,
  PackId,
  PendingReply,
  Subscriber,
  SubscriberMemory,
} from "./types.js";

let db: Firestore | null = null;

export function firestoreDb(): Firestore {
  if (!firebaseConfigured()) {
    throw new Error("Firebase credentials are not configured.");
  }
  if (!db) {
    const app: App =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: config.firebaseProjectId,
          clientEmail: config.firebaseClientEmail,
          privateKey: config.firebasePrivateKey,
        }),
      });
    db = getFirestore(app, config.firebaseDatabaseId);
  }
  return db;
}

function memoryFromDoc(data: unknown): SubscriberMemory | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raw = data as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  const pack = typeof raw.lastPackShown === "string" ? (raw.lastPackShown as PackId) : null;
  return {
    name: text(raw.name),
    language: raw.language === "es" ? "es" : raw.language === "en" ? "en" : null,
    interests: strings(raw.interests),
    objections: strings(raw.objections),
    lastPackShown: pack,
    pitchCount: typeof raw.pitchCount === "number" ? raw.pitchCount : 0,
    lastPitchAt: text(raw.lastPitchAt),
    firstSeenAt: text(raw.firstSeenAt),
    lastSeenAt: text(raw.lastSeenAt),
    userTurns: typeof raw.userTurns === "number" ? raw.userTurns : 0,
  };
}

function subscriberFromDoc(id: string, data: DocumentData): Subscriber {
  return {
    subscriberId: id,
    firstName: typeof data.firstName === "string" ? data.firstName : null,
    igUsername: typeof data.igUsername === "string" ? data.igUsername : null,
    optedOut: data.optedOut === true,
    needsHuman: data.needsHuman === true,
    memory: memoryFromDoc(data.memory),
  };
}

function orderFromDoc(id: string, data: DocumentData): Order {
  return {
    id,
    reference: String(data.reference),
    subscriberId: String(data.subscriberId),
    packId: data.packId as Order["packId"],
    packName: String(data.packName),
    amountUsd: Number(data.amountUsd),
    currency: "USD",
    status: data.status,
    fileNames: Array.isArray(data.fileNames) ? data.fileNames.map(String) : [],
    downloadToken: typeof data.downloadToken === "string" ? data.downloadToken : null,
    createdAt: String(data.createdAt),
    updatedAt: String(data.updatedAt),
  };
}

function pendingFromDoc(id: string, data: DocumentData): PendingReply {
  const media: OutboundMedia[] = Array.isArray(data.media)
    ? data.media.flatMap((item: unknown) => {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (!record) return [];
        const type = record.type === "video" ? "video" : record.type === "image" ? "image" : null;
        if (!type || typeof record.url !== "string" || !record.url) return [];
        return [{ type, url: record.url }];
      })
    : [];
  const packId = typeof data.releasedPackId === "string" ? (data.releasedPackId as PackId) : null;
  return {
    subscriberId: id,
    dueAt: String(data.dueAt ?? ""),
    taskName: typeof data.taskName === "string" ? data.taskName : null,
    media,
    filesReady: data.filesReady === true,
    filesFailed: data.filesFailed === true,
    sawPaymentScreenshot: data.sawPaymentScreenshot === true,
    quoted: data.quoted === true,
    claimed: data.claimed === true,
    releasedPackId: packId,
    releasedPackName: typeof data.releasedPackName === "string" ? data.releasedPackName : null,
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
  };
}

export function createFirestoreStore(): Store {
  const firestore = firestoreDb();
  return {
    async getSubscriber(subscriberId) {
      const snap = await firestore.collection("subscribers").doc(subscriberId).get();
      if (!snap.exists) return null;
      return subscriberFromDoc(snap.id, snap.data() ?? {});
    },
    async saveSubscriber(subscriber) {
      const now = new Date().toISOString();
      const { memory, ...rest } = subscriber;
      await firestore
        .collection("subscribers")
        .doc(subscriber.subscriberId)
        .set(
          {
            ...rest,
            ...(memory ? { memory } : {}),
            updatedAt: now,
            createdAt: now,
          },
          { merge: true },
        );
    },
    async recentMessages(subscriberId, limit) {
      const snap = await firestore
        .collection("subscribers")
        .doc(subscriberId)
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      const messages: ChatMessage[] = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          role: data.role === "assistant" ? "assistant" : "user",
          text: String(data.text ?? ""),
          createdAt: String(data.createdAt ?? ""),
        };
      });
      return messages.reverse();
    },
    async addMessage(subscriberId, message) {
      await firestore
        .collection("subscribers")
        .doc(subscriberId)
        .collection("messages")
        .add(message);
    },
    async latestOpenOrder(subscriberId) {
      const snap = await firestore
        .collection("orders")
        .where("subscriberId", "==", subscriberId)
        .where("status", "in", ["quoted", "pending_verification"])
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (!doc) return null;
      return orderFromDoc(doc.id, doc.data());
    },
    async createOrder(input: NewOrder) {
      const now = new Date().toISOString();
      const ref = firestore.collection("orders").doc();
      const order: Order = {
        ...input,
        reference: input.reference || orderReference(),
        id: ref.id,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(order);
      return order;
    },
    async getOrder(orderId) {
      const snap = await firestore.collection("orders").doc(orderId).get();
      if (!snap.exists) return null;
      return orderFromDoc(snap.id, snap.data() ?? {});
    },
    async updateOrderStatus(orderId, status: OrderStatus) {
      const ref = firestore.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const updatedAt = new Date().toISOString();
      await ref.update({ status, updatedAt });
      return orderFromDoc(orderId, { ...snap.data(), status, updatedAt });
    },
    async fulfillOrder(orderId, fileNames, downloadToken) {
      const ref = firestore.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const updatedAt = new Date().toISOString();
      await ref.update({ status: "verified", fileNames, downloadToken, updatedAt });
      return orderFromDoc(orderId, {
        ...snap.data(),
        status: "verified",
        fileNames,
        downloadToken,
        updatedAt,
      });
    },
    async orderByToken(downloadToken) {
      const snap = await firestore
        .collection("orders")
        .where("downloadToken", "==", downloadToken)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (!doc) return null;
      return orderFromDoc(doc.id, doc.data());
    },
    async listOrders(status) {
      const query = status
        ? firestore.collection("orders").where("status", "==", status).orderBy("createdAt", "desc")
        : firestore.collection("orders").orderBy("createdAt", "desc");
      const snap = await query.limit(50).get();
      return snap.docs.map((doc) => orderFromDoc(doc.id, doc.data()));
    },
    async hasAssistantReply(subscriberId) {
      const snap = await firestore
        .collection("subscribers")
        .doc(subscriberId)
        .collection("messages")
        .where("role", "==", "assistant")
        .limit(1)
        .get();
      return !snap.empty;
    },
    async getPendingReply(subscriberId) {
      const snap = await firestore.collection("pendingReplies").doc(subscriberId).get();
      if (!snap.exists) return null;
      return pendingFromDoc(snap.id, snap.data() ?? {});
    },
    async mergePendingReply(patch) {
      const ref = firestore.collection("pendingReplies").doc(patch.subscriberId);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? pendingFromDoc(snap.id, snap.data() ?? {}) : null;
        const pending = mergePendingReply(current, patch);
        tx.set(ref, pending);
        return { pending, created: current == null };
      });
    },
    async attachPendingTask(subscriberId, taskName) {
      const ref = firestore.collection("pendingReplies").doc(subscriberId);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const current = pendingFromDoc(snap.id, snap.data() ?? {});
        if (current.taskName) return;
        tx.update(ref, { taskName });
      });
    },
    async deletePendingReply(subscriberId) {
      await firestore.collection("pendingReplies").doc(subscriberId).delete();
    },
  };
}
