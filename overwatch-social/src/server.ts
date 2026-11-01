import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import multer from "multer";
import { acceptTypedName, extractNames } from "./names.js";
import { readNames } from "./ocr.js";
import { lookupPlayers, type PlayerReport } from "./social.js";
import { createMatch, type Match } from "./state.js";
import { isOverwatchRunning } from "./watch.js";

const require = createRequire(import.meta.url);
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const samplePath = fileURLToPath(new URL("../fixtures/scoreboard.png", import.meta.url));

type Shot = (options?: { format: "png" }) => Promise<Buffer | Uint8Array>;

export interface AppDeps {
  readNames: (image: Buffer) => Promise<string[]>;
  lookupPlayers: (names: string[]) => Promise<PlayerReport[]>;
  isOverwatchRunning: () => Promise<boolean>;
  takeScreenshot: () => Promise<Buffer>;
  readSample: () => Promise<Buffer>;
}

async function defaultScreenshot(): Promise<Buffer> {
  const shot = require("screenshot-desktop") as Shot;
  return Buffer.from(await shot({ format: "png" }));
}

export function defaultDeps(): AppDeps {
  return {
    readNames,
    lookupPlayers,
    isOverwatchRunning,
    takeScreenshot: defaultScreenshot,
    readSample: () => readFile(samplePath),
  };
}

function message(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return "Something went wrong.";
}

export function createApp(deps: AppDeps = defaultDeps()) {
  const match = createMatch();
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  async function runCheck(): Promise<void> {
    const ticket = match.beginCheck();
    if (!ticket.ok) return;
    try {
      const report = await deps.lookupPlayers(ticket.names);
      match.finishCheck(ticket.generation, report, null);
    } catch (error) {
      match.finishCheck(ticket.generation, null, message(error));
    }
  }

  function watchGame() {
    const timer = setInterval(() => {
      void deps
        .isOverwatchRunning()
        .then((running) => {
          const { ended } = match.noteOverwatch(running);
          if (ended) void runCheck();
        })
        .catch(() => undefined);
    }, 2000);
    timer.unref();
    return () => clearInterval(timer);
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/status", (_req, res) => {
    res.json(match.snapshot());
  });

  app.post("/api/capture", async (_req, res) => {
    try {
      const image = await deps.takeScreenshot();
      const names = await deps.readNames(image);
      respondWithNames(match, names, res);
    } catch (error) {
      match.setError(
        `Couldn't capture the screen. Upload a picture of the scoreboard instead. ${message(error)}`,
      );
      res.status(500).json(match.snapshot());
    }
  });

  app.post("/api/upload", (req, res) => {
    upload.single("image")(req, res, (error: unknown) => {
      void (async () => {
        if (error) {
          const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
          match.setError(
            code === "LIMIT_FILE_SIZE"
              ? "That image is too large. Use one under 8 MB."
              : "Couldn't read that upload.",
          );
          res.status(400).json(match.snapshot());
          return;
        }
        const file = (req as express.Request & { file?: { buffer: Buffer; mimetype: string } }).file;
        if (!file) {
          match.setError("Choose an image of the scoreboard.");
          res.status(400).json(match.snapshot());
          return;
        }
        if (file.mimetype && !/^image\/(png|jpeg|jpg|webp|bmp|gif)$/i.test(file.mimetype)) {
          match.setError("Use a PNG, JPG, or WebP screenshot.");
          res.status(415).json(match.snapshot());
          return;
        }
        try {
          const names = await deps.readNames(file.buffer);
          respondWithNames(match, names, res);
        } catch (readError) {
          match.setError(`Couldn't read names from that image. ${message(readError)}`);
          res.status(422).json(match.snapshot());
        }
      })();
    });
  });

  app.post("/api/sample", async (_req, res) => {
    try {
      const names = await deps.readNames(await deps.readSample());
      respondWithNames(match, names, res);
    } catch (error) {
      match.setError(`Couldn't read the sample scoreboard. ${message(error)}`);
      res.status(500).json(match.snapshot());
    }
  });

  app.post("/api/names", (req, res) => {
    const raw = req.body && typeof req.body === "object" && "name" in req.body ? req.body.name : "";
    const name = typeof raw === "string" ? acceptTypedName(raw) : null;
    if (!name) {
      match.setError("Type one player name, like NiteOwl#2241.");
      res.status(400).json(match.snapshot());
      return;
    }
    match.addPlayers([name], "typed");
    res.json(match.snapshot());
  });

  app.post("/api/names/remove", (req, res) => {
    const raw = req.body && typeof req.body === "object" && "name" in req.body ? req.body.name : "";
    if (typeof raw !== "string" || !raw.trim()) {
      res.status(400).json(match.snapshot());
      return;
    }
    match.removePlayer(raw);
    res.json(match.snapshot());
  });

  app.post("/api/match/end", async (_req, res) => {
    const before = match.snapshot();
    if (before.checking) {
      res.status(409).json(before);
      return;
    }
    if (before.players.length === 0) {
      match.setError("Capture at least one name first.");
      res.status(409).json(match.snapshot());
      return;
    }
    await runCheck();
    const after = match.snapshot();
    res.status(after.error ? 502 : 200).json(after);
  });

  app.post("/api/match/reset", (_req, res) => {
    match.reset();
    res.json(match.snapshot());
  });

  app.use(express.static(publicDir));

  return { app, match, runCheck, watchGame };
}

function respondWithNames(match: Match, names: string[], res: express.Response) {
  if (names.length === 0) {
    match.setError("No player names found. Show the scoreboard, or type a name.");
    res.status(422).json(match.snapshot());
    return;
  }
  match.addPlayers(names, "capture");
  res.json(match.snapshot());
}

export function start(port = Number(process.env.PORT ?? 8791)) {
  const { app, watchGame } = createApp();
  const stopWatching = watchGame();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Aftermatch is running at http://127.0.0.1:${port}`);
  });
  server.on("close", stopWatching);
  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  start();
}
