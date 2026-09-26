import { randomBytes } from "node:crypto";
import { packById } from "./catalog.js";
import { config } from "./config.js";
import { listCollectionFiles, pickFiles } from "./library.js";
import type { Store } from "./store.js";
import type { Order } from "./types.js";

export function downloadLinks(order: Order): string[] {
  if (!order.downloadToken) return [];
  const origin = config.publicBaseUrl || `http://localhost:${config.port}`;
  return order.fileNames.map(
    (_file, index) => `${origin}/downloads/${order.downloadToken}/${index}`,
  );
}

export async function releaseOrderFiles(
  store: Store,
  order: Order,
): Promise<{ order: Order; downloads: string[] } | { error: string; status: number }> {
  if (order.status === "verified" && order.downloadToken) {
    return { order, downloads: downloadLinks(order) };
  }
  const pack = packById(order.packId);
  if (!pack) return { error: "Order pack is not in the catalog.", status: 400 };
  const available = await listCollectionFiles(pack.kind);
  if (available.length < pack.count) {
    return { error: `Only ${available.length} ${pack.kind} files are available.`, status: 409 };
  }
  const fulfilled = await store.fulfillOrder(
    order.id,
    pickFiles(available, pack.count),
    randomBytes(24).toString("hex"),
  );
  if (!fulfilled) return { error: "Order not found.", status: 404 };
  return { order: fulfilled, downloads: downloadLinks(fulfilled) };
}
