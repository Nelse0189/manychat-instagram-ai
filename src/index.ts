import { randomBytes } from "node:crypto";
import express from "express";
import { packById } from "./catalog.js";
import { config, firebaseConfigured, missingProductionSecrets } from "./config.js";
import { createFirestoreStore } from "./firestoreStore.js";
import { handleIncoming } from "./handleIncoming.js";
import { listCollectionFiles, pickFiles, resolveMediaFile } from "./library.js";
import { dynamicBlock, parseIncoming } from "./manychat.js";
import { createMemoryStore, isOrderStatus } from "./memoryStore.js";
import { supportText } from "./sales.js";
import type { Store } from "./store.js";
import type { Order } from "./types.js";

const missing = missingProductionSecrets();
if (missing.length > 0) {
  console.error(`Missing production environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const store: Store = firebaseConfigured() ? createFirestoreStore() : createMemoryStore();
if (!firebaseConfigured()) {
  console.warn(
    "Firebase credentials are not set. Conversations and orders stay in memory and disappear when the process stops.",
  );
}

function headerSecret(header: string | undefined): string {
  if (!header) return "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

function webhookAllowed(header: string | undefined): boolean {
  if (!config.webhookSecret) return config.nodeEnv !== "production";
  return headerSecret(header) === config.webhookSecret;
}

function adminAllowed(header: string | undefined): boolean {
  if (!config.adminSecret) return config.nodeEnv !== "production";
  return headerSecret(header) === config.adminSecret;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    firebase: firebaseConfigured(),
    openrouter: Boolean(config.openRouterApiKey),
    paymentsEnabled: config.paymentsEnabled,
    publicBaseUrl: Boolean(config.publicBaseUrl),
  });
});

app.post("/manychat/dynamic", async (req, res) => {
  if (!webhookAllowed(req.header("x-webhook-secret") ?? req.header("authorization"))) {
    res.status(401).json({ error: "Unauthorized webhook." });
    return;
  }

  const incoming = parseIncoming(req.body);
  if (!incoming) {
    res.status(400).json({ error: "Missing subscriber id." });
    return;
  }

  try {
    const decision = await handleIncoming(store, incoming);
    res.json(dynamicBlock(decision));
  } catch (error) {
    console.error(error);
    res.json(
      dynamicBlock({
        reply: supportText(),
        intent: "support",
        needsHuman: true,
        useModel: false,
        packId: null,
        orderAction: null,
      }),
    );
  }
});

app.get("/admin/orders", async (req, res) => {
  if (!adminAllowed(req.header("authorization") ?? req.header("x-admin-secret"))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  if (rawStatus && !isOrderStatus(rawStatus)) {
    res.status(400).json({ error: "Unknown order status." });
    return;
  }
  const orders = await store.listOrders(
    rawStatus && isOrderStatus(rawStatus) ? rawStatus : undefined,
  );
  res.json({ orders });
});

function downloadLinks(order: Order): string[] {
  if (!order.downloadToken) return [];
  const origin = config.publicBaseUrl || `http://localhost:${config.port}`;
  return order.fileNames.map(
    (_file, index) => `${origin}/downloads/${order.downloadToken}/${index}`,
  );
}

app.post("/admin/orders/:id/verify", async (req, res) => {
  if (!adminAllowed(req.header("authorization") ?? req.header("x-admin-secret"))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const existing = await store.getOrder(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (existing.status === "verified" && existing.downloadToken) {
    res.json({ order: existing, downloads: downloadLinks(existing) });
    return;
  }
  const pack = packById(existing.packId);
  if (!pack) {
    res.status(400).json({ error: "Order pack is not in the catalog." });
    return;
  }
  const available = await listCollectionFiles(pack.kind);
  if (available.length < pack.count) {
    res.status(409).json({ error: `Only ${available.length} ${pack.kind} files are available.` });
    return;
  }
  const order = await store.fulfillOrder(
    existing.id,
    pickFiles(available, pack.count),
    randomBytes(24).toString("hex"),
  );
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  const downloads = downloadLinks(order);
  res.json({
    order,
    downloads,
    messageToCustomer: `Payment for ${order.reference} is verified. Here are your files:\n${downloads.join("\n")}`,
  });
});

app.get("/downloads/:token/:index", async (req, res) => {
  const index = Number(req.params.index);
  const order = await store.orderByToken(req.params.token);
  if (!order || order.status !== "verified" || !Number.isInteger(index) || index < 0) {
    res.status(404).json({ error: "Download not found." });
    return;
  }
  const relativePath = order.fileNames[index];
  const filePath = relativePath ? resolveMediaFile(relativePath) : null;
  if (!filePath) {
    res.status(404).json({ error: "Download not found." });
    return;
  }
  res.download(filePath);
});

app.listen(config.port, () => {
  console.log(`Shop assistant listening on ${config.port}`);
});
