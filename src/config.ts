import "dotenv/config";

function flag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-6.1-sol",
  manychatApiToken: process.env.MANYCHAT_API_TOKEN ?? "",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID ?? "shop",
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
  firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  paymentsEnabled: flag("PAYMENTS_ENABLED", true),
  venmoHandle: process.env.VENMO_HANDLE ?? "bluejays0137",
  cashAppTag: process.env.CASHAPP_CASHTAG ?? "Arialluxe",
  shopHandle: process.env.SHOP_HANDLE ?? "arial_luxe",
  cloudTasksProject: process.env.CLOUD_TASKS_PROJECT || process.env.FIREBASE_PROJECT_ID || "",
  cloudTasksLocation: process.env.CLOUD_TASKS_LOCATION || "us-central1",
  cloudTasksQueue: process.env.CLOUD_TASKS_QUEUE || "shop-assistant-replies",
  taskTargetUrl: (process.env.TASK_TARGET_URL ?? "").replace(/\/$/, ""),
};

export function firebaseConfigured(): boolean {
  return Boolean(
    config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey,
  );
}

export function missingProductionSecrets(): string[] {
  if (config.nodeEnv !== "production") return [];
  const missing: string[] = [];
  if (!config.webhookSecret) missing.push("WEBHOOK_SECRET");
  if (!config.adminSecret) missing.push("ADMIN_SECRET");
  if (!config.openRouterApiKey) missing.push("OPENROUTER_API_KEY");
  if (!config.manychatApiToken) missing.push("MANYCHAT_API_TOKEN");
  if (!config.taskTargetUrl) missing.push("TASK_TARGET_URL");
  if (!config.cloudTasksProject) missing.push("CLOUD_TASKS_PROJECT");
  if (!firebaseConfigured()) {
    missing.push("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY");
  }
  return missing;
}
