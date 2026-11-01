import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, type AppDeps } from "./server.js";
import type { PlayerReport } from "./social.js";

function reportFor(names: string[]): PlayerReport[] {
  return names.map((name) => ({
    name,
    handle: name.split("#")[0] ?? name,
    summary: "Public profile on Twitch.",
    hasProfile: true,
    profiles: [
      {
        platform: "Twitch",
        status: "found" as const,
        url: "https://www.twitch.tv/example",
        detail: "Example",
      },
    ],
  }));
}

function deps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    readNames: async () => ["NiteOwl#2241", "xqc"],
    lookupPlayers: async (names) => reportFor(names),
    isOverwatchRunning: async () => false,
    takeScreenshot: async () => Buffer.from("screen"),
    readSample: async () => Buffer.from("sample"),
    ...overrides,
  };
}

async function withApp(overrides: Partial<AppDeps>, run: (base: string) => Promise<void>) {
  const { app } = createApp(deps(overrides));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("serves the app and turns a scoreboard into a post-game report", async () => {
  await withApp({}, async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Aftermatch/);

    const health = await fetch(`${base}/health`);
    assert.equal((await health.json()).ok, true);

    const sample = await fetch(`${base}/api/sample`, { method: "POST" });
    assert.equal(sample.status, 200);
    const roster = await sample.json();
    assert.deepEqual(roster.players, ["NiteOwl#2241", "xqc"]);
    assert.equal(roster.phase, "in_game");

    const ended = await fetch(`${base}/api/match/end`, { method: "POST" });
    assert.equal(ended.status, 200);
    const report = await ended.json();
    assert.equal(report.phase, "postgame");
    assert.equal(report.report.length, 2);
    assert.equal(report.report[0].hasProfile, true);
    assert.match(report.notice, /2 have a public profile/);
  });
});

test("typed hero names are kept, junk is rejected, and an empty match cannot be checked", async () => {
  await withApp({}, async (base) => {
    const empty = await fetch(`${base}/api/match/end`, { method: "POST" });
    assert.equal(empty.status, 409);

    const hero = await fetch(`${base}/api/names`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ana" }),
    });
    assert.equal(hero.status, 200);
    assert.deepEqual((await hero.json()).players, ["Ana"]);

    const junk = await fetch(`${base}/api/names`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "!!!" }),
    });
    assert.equal(junk.status, 400);
  });
});

test("upload and screen capture both add names, and a failed capture explains what to do", async () => {
  await withApp(
    {
      takeScreenshot: async () => {
        throw new Error("no display");
      },
    },
    async (base) => {
      const body = new FormData();
      body.set("image", new Blob([Buffer.from("not-really")], { type: "image/png" }), "board.png");
      const uploaded = await fetch(`${base}/api/upload`, { method: "POST", body });
      assert.equal(uploaded.status, 200);
      assert.deepEqual((await uploaded.json()).players, ["NiteOwl#2241", "xqc"]);

      const captured = await fetch(`${base}/api/capture`, { method: "POST" });
      assert.equal(captured.status, 500);
      assert.match((await captured.json()).error, /Upload a picture/);
    },
  );
});

test("a lookup failure is reported instead of left hanging", async () => {
  await withApp(
    {
      lookupPlayers: async () => {
        throw new Error("lookup down");
      },
    },
    async (base) => {
      await fetch(`${base}/api/names`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "NiteOwl#2241" }),
      });
      const ended = await fetch(`${base}/api/match/end`, { method: "POST" });
      assert.equal(ended.status, 502);
      const body = await ended.json();
      assert.equal(body.phase, "postgame");
      assert.match(body.error, /lookup down/);
    },
  );
});
