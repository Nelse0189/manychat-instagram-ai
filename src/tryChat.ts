import type { Express, Request, Response } from "express";
import { config } from "./config.js";
import { handleIncoming } from "./handleIncoming.js";
import { createMemoryStore } from "./memoryStore.js";
import type { Store } from "./store.js";

const SESSION_ID = /^[a-zA-Z0-9_-]{8,80}$/;
const MAX_SESSIONS = 200;

export class TryChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createTryChat(): {
  reply(sessionId: string, text: string): Promise<{ reply: string; model: string }>;
} {
  const sessions = new Map<string, Store>();

  return {
    async reply(sessionId: string, text: string) {
      if (!SESSION_ID.test(sessionId)) {
        throw new TryChatError("Start a new chat and try again.", 400);
      }
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 1000) {
        throw new TryChatError("Send a message under 1000 characters.", 400);
      }

      let store = sessions.get(sessionId);
      if (!store) {
        if (sessions.size >= MAX_SESSIONS) {
          const oldest = sessions.keys().next().value;
          if (oldest) sessions.delete(oldest);
        }
        store = createMemoryStore();
        sessions.set(sessionId, store);
      }

      try {
        const decision = await handleIncoming(
          store,
          {
            subscriberId: `try:${sessionId}`,
            text: trimmed,
            firstName: null,
            igUsername: null,
          },
          { surfaceModelErrors: true },
        );
        return { reply: decision.reply, model: config.openRouterModel };
      } catch (error) {
        if (error instanceof TryChatError) throw error;
        const message = error instanceof Error ? error.message : "The model did not answer.";
        throw new TryChatError(message, 502);
      }
    },
  };
}

export function mountTryPage(
  app: Express,
  allowed: (header: string | undefined) => boolean,
  pageHtml: (model: string) => string,
): void {
  const chat = createTryChat();

  app.get("/try", (_req, res) => {
    res.set("cache-control", "no-store");
    res.type("html").send(pageHtml(config.openRouterModel));
  });

  app.post("/try/message", async (req: Request, res: Response) => {
    if (!allowed(req.header("authorization") ?? req.header("x-admin-secret"))) {
      res.status(401).json({ error: "Unauthorized.", authRequired: true });
      return;
    }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    try {
      res.json(await chat.reply(sessionId, text));
    } catch (error) {
      const status = error instanceof TryChatError ? error.status : 502;
      const message = error instanceof Error ? error.message : "The model did not answer.";
      const detail = message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
      const credits = /402|credits|max_tokens|prompt tokens/i.test(message);
      res.status(status).json({
        error: status === 400 ? message : credits ? "OpenRouter needs more credits before this chat can answer." : "The model did not answer.",
        detail: status === 400 ? undefined : detail,
      });
    }
  });
}
