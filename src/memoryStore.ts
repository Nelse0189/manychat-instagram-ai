import { randomBytes, randomUUID } from "node:crypto";
import type { NewOrder, Store } from "./store.js";
import type { ChatMessage, Order, OrderStatus, Subscriber } from "./types.js";

type MemoryState = {
  subscribers: Map<string, Subscriber>;
  messages: Map<string, ChatMessage[]>;
  orders: Map<string, Order>;
};

export function createMemoryStore(state: MemoryState = {
  subscribers: new Map(),
  messages: new Map(),
  orders: new Map(),
}): Store {
  return {
    async getSubscriber(subscriberId) {
      return state.subscribers.get(subscriberId) ?? null;
    },
    async saveSubscriber(subscriber) {
      state.subscribers.set(subscriber.subscriberId, subscriber);
    },
    async recentMessages(subscriberId, limit) {
      const all = state.messages.get(subscriberId) ?? [];
      return all.slice(-limit);
    },
    async addMessage(subscriberId, message) {
      const all = state.messages.get(subscriberId) ?? [];
      all.push(message);
      state.messages.set(subscriberId, all);
    },
    async latestOpenOrder(subscriberId) {
      const open = [...state.orders.values()]
        .filter(
          (order) =>
            order.subscriberId === subscriberId &&
            (order.status === "quoted" || order.status === "pending_verification"),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return open[0] ?? null;
    },
    async createOrder(input: NewOrder) {
      const now = new Date().toISOString();
      const order: Order = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      state.orders.set(order.id, order);
      return order;
    },
    async getOrder(orderId) {
      return state.orders.get(orderId) ?? null;
    },
    async updateOrderStatus(orderId, status) {
      const order = state.orders.get(orderId);
      if (!order) return null;
      const next = { ...order, status, updatedAt: new Date().toISOString() };
      state.orders.set(orderId, next);
      return next;
    },
    async fulfillOrder(orderId, fileNames, downloadToken) {
      const order = state.orders.get(orderId);
      if (!order) return null;
      const next: Order = {
        ...order,
        status: "verified",
        fileNames,
        downloadToken,
        updatedAt: new Date().toISOString(),
      };
      state.orders.set(orderId, next);
      return next;
    },
    async orderByToken(downloadToken) {
      return (
        [...state.orders.values()].find((order) => order.downloadToken === downloadToken) ?? null
      );
    },
    async listOrders(status) {
      return [...state.orders.values()]
        .filter((order) => (status ? order.status === status : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}

export function orderReference(): string {
  return `AL-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (
    value === "quoted" ||
    value === "pending_verification" ||
    value === "verified" ||
    value === "cancelled"
  );
}
