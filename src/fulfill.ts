import { randomBytes } from "node:crypto";
import path from "node:path";
import { packById } from "./catalog.js";
import { config } from "./config.js";
import { listCollectionFiles, pickFiles } from "./library.js";
import type { Store } from "./store.js";
import type { Order, OutboundMedia } from "./types.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

function mediaOrigin(): string {
  return config.publicBaseUrl || `http://localhost:${config.port}`;
}

export function downloadLinks(order: Order): string[] {
  if (!order.downloadToken) return [];
  const origin = mediaOrigin();
  return order.fileNames.map(
    (_file, index) => `${origin}/downloads/${order.downloadToken}/${index}`,
  );
}

export function outboundMedia(order: Order): OutboundMedia[] {
  if (!order.downloadToken) return [];
  const origin = mediaOrigin();
  return order.fileNames.map((file, index) => ({
    type: VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()) ? "video" : "image",
    url: `${origin}/downloads/${order.downloadToken}/${index}`,
  }));
}

export async function releaseOrderFiles(
  store: Store,
  order: Order,
): Promise<
  { order: Order; downloads: string[]; media: OutboundMedia[] } | { error: string; status: number }
> {
  if (order.status === "verified" && order.downloadToken) {
    return { order, downloads: downloadLinks(order), media: outboundMedia(order) };
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
  return { order: fulfilled, downloads: downloadLinks(fulfilled), media: outboundMedia(fulfilled) };
}
