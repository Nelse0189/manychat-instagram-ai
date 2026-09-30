import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { setReplyGenerator } from "./openrouter.js";
import { mountTryPage } from "./tryChat.js";
import { tryPageHtml } from "./tryPage.js";

const sessionId = "trychat01";

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function app() {
  const server = express();
  server.use(express.json());
  mountTryPage(
    server,
    (header) => header === "Bearer test-secret",
    tryPageHtml,
  );
  return server;
}

test("the try page names the model and answers without waiting", async (t) => {
  const seen: string[] = [];
  setReplyGenerator(async (_ctx, history, userText) => {
    seen.push(`${history.length}:${userText}`);
    return JSON.stringify({
      reply: `model saw: ${userText}`,
      intent: "other",
      packId: null,
      needsHuman: false,
    });
  });
  t.after(() => setReplyGenerator(null));

  const running = await listen(app());
  t.after(() => running.close());

  const page = await fetch(`${running.url}/try`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /x-ai\/grok-4\.20/);
  assert.match(html, /this chat · no tokens yet/);
  assert.doesNotMatch(html, /scripted/);

  const denied = await fetch(`${running.url}/try/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text: "hey" }),
  });
  assert.equal(denied.status, 401);

  const catalog = await fetch(`${running.url}/try/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ sessionId: "catalog01", text: "catalog" }),
  });
  assert.equal(catalog.status, 200);
  const catalogBody = (await catalog.json()) as { reply: string; model: string; usage: null };
  assert.equal(catalogBody.reply, "model saw: catalog");
  assert.equal(catalogBody.model, "x-ai/grok-4.20");
  assert.equal(catalogBody.usage, null);

  const first = await fetch(`${running.url}/try/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ sessionId, text: "hey" }),
  });
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { reply: string };
  assert.equal(firstBody.reply, "model saw: hey");

  const second = await fetch(`${running.url}/try/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ sessionId, text: "you up?" }),
  });
  assert.equal(second.status, 200);
  assert.deepEqual(seen, ["0:catalog", "0:hey", "2:you up?"]);
});

test("a model failure is shown instead of a stock support line", async (t) => {
  setReplyGenerator(async () => {
    throw new Error("OpenRouter 401: missing key");
  });
  t.after(() => setReplyGenerator(null));

  const running = await listen(app());
  t.after(() => running.close());
  const response = await fetch(`${running.url}/try/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ sessionId: "trychat02", text: "hey" }),
  });
  assert.equal(response.status, 502);
  const body = (await response.json()) as { error: string; detail: string };
  assert.equal(body.error, "The model did not answer.");
  assert.match(body.detail, /missing key/);
  assert.doesNotMatch(body.detail, /passwords or card numbers/);
});
