import express from "express";
import { config, firebaseConfigured, missingProductionSecrets } from "./config.js";
import { createFirestoreStore } from "./firestoreStore.js";
import { releaseOrderFiles } from "./fulfill.js";
import { handleIncoming } from "./handleIncoming.js";
import { resolveMediaFile } from "./library.js";
import { dynamicBlock, parseIncoming } from "./manychat.js";
import { createMemoryStore, isOrderStatus } from "./memoryStore.js";
import { resolveReplyLanguage, supportText } from "./sales.js";
import type { Store } from "./store.js";

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
        reply: supportText(resolveReplyLanguage(incoming.text)),
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
  const released = await releaseOrderFiles(store, existing);
  if ("error" in released) {
    res.status(released.status).json({ error: released.error });
    return;
  }
  const text = "Order verified.";
  res.json({
    order: released.order,
    messages: [{ type: "text", text }, ...released.media],
    messageToCustomer: text,
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
  res.sendFile(filePath);
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Shop assistant listening on ${config.port}`);
});
