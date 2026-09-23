import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { config, firebaseConfigured } from "./config.js";
import { orderReference } from "./memoryStore.js";
import type { NewOrder, Store } from "./store.js";
import type { ChatMessage, Order, OrderStatus, Subscriber } from "./types.js";

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

function subscriberFromDoc(id: string, data: DocumentData): Subscriber {
  return {
    subscriberId: id,
    firstName: typeof data.firstName === "string" ? data.firstName : null,
    igUsername: typeof data.igUsername === "string" ? data.igUsername : null,
    optedOut: data.optedOut === true,
    needsHuman: data.needsHuman === true,
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
      await firestore
        .collection("subscribers")
        .doc(subscriber.subscriberId)
        .set(
          {
            ...subscriber,
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
  };
}
