import type { ChatMessage, Order, OrderStatus, Subscriber } from "./types.js";

export type NewOrder = Omit<Order, "id" | "createdAt" | "updatedAt">;

export interface Store {
  getSubscriber(subscriberId: string): Promise<Subscriber | null>;
  saveSubscriber(subscriber: Subscriber): Promise<void>;
  recentMessages(subscriberId: string, limit: number): Promise<ChatMessage[]>;
  addMessage(subscriberId: string, message: ChatMessage): Promise<void>;
  latestOpenOrder(subscriberId: string): Promise<Order | null>;
  createOrder(order: NewOrder): Promise<Order>;
  getOrder(orderId: string): Promise<Order | null>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order | null>;
  fulfillOrder(orderId: string, fileNames: string[], downloadToken: string): Promise<Order | null>;
  orderByToken(downloadToken: string): Promise<Order | null>;
  listOrders(status?: OrderStatus): Promise<Order[]>;
}

export function emptySubscriber(input: {
  subscriberId: string;
  firstName: string | null;
  igUsername: string | null;
}): Subscriber {
  return {
    subscriberId: input.subscriberId,
    firstName: input.firstName,
    igUsername: input.igUsername,
    optedOut: false,
    needsHuman: false,
  };
}
