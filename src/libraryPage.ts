import type { Express, Request, Response } from "express";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  isLfsPointer,
  listLibraryFiles,
  mediaRoot,
  resolveLibraryFile,
  type LibraryFile,
} from "./library.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function libraryPageHtml(files: LibraryFile[]): string {
  const photos = files.filter((file) => file.kind === "photo").length;
  const videos = files.filter((file) => file.kind === "video").length;
  const rows =
    files.length === 0
      ? `<li class="empty">No photo or video files are on this server.</li>`
      : files
          .map((file) => {
            const name = escapeHtml(file.name);
            const query = encodeURIComponent(file.name);
            return `<li data-kind="${file.kind}" data-name="${escapeHtml(file.name.toLowerCase())}">
            <span class="kind">${file.kind === "photo" ? "Photo" : "Video"}</span>
            <span class="name">${name}</span>
            <span class="size">${formatBytes(file.bytes)}</span>
            <a href="/library/file?name=${query}" download>Download</a>
          </li>`;
          })
          .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Photos and videos</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #111;
      color: #f4f4f5;
      font: 16px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p { margin: 0; color: #a1a1aa; }
    .tools { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 12px; }
    input, button, a { font: inherit; }
    input {
      flex: 1 1 220px;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      background: #09090b;
      color: inherit;
      padding: 10px 12px;
    }
    button, a {
      border: 0;
      border-radius: 999px;
      background: #27272a;
      color: inherit;
      padding: 8px 14px;
      text-decoration: none;
      cursor: pointer;
    }
    button[aria-pressed="true"] { background: #f4f4f5; color: #111; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      background: #18181b;
      border-radius: 12px;
    }
    li[hidden] { display: none !important; }
    li.empty { display: block; color: #a1a1aa; }
    .kind { color: #a1a1aa; font-size: 12px; text-transform: uppercase; }
    .name { overflow-wrap: anywhere; }
    .size { color: #a1a1aa; font-size: 13px; white-space: nowrap; }
    #shown { margin-top: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Photos and videos</h1>
    <p>21+. Each file downloads on its own. ${photos} ${photos === 1 ? "photo" : "photos"}, ${videos} ${videos === 1 ? "video" : "videos"}.</p>
    <div class="tools">
      <input id="q" type="search" placeholder="Search file names" autocomplete="off">
      <button type="button" data-kind="all" aria-pressed="true">All</button>
      <button type="button" data-kind="photo" aria-pressed="false">Photos</button>
      <button type="button" data-kind="video" aria-pressed="false">Videos</button>
    </div>
    <ul id="files">${rows}</ul>
    <p id="shown">${files.length} shown</p>
  </main>
  <script>
    const query = document.querySelector("#q");
    const rows = [...document.querySelectorAll("#files li[data-kind]")];
    const shown = document.querySelector("#shown");
    let kind = "all";
    function apply() {
      const needle = query.value.trim().toLowerCase();
      let count = 0;
      for (const row of rows) {
        const visible = (kind === "all" || row.dataset.kind === kind) && (!needle || row.dataset.name.includes(needle));
        row.hidden = !visible;
        if (visible) count += 1;
      }
      shown.textContent = count + " shown";
    }
    query.addEventListener("input", apply);
    for (const button of document.querySelectorAll(".tools button")) {
      button.addEventListener("click", () => {
        kind = button.dataset.kind;
        for (const other of document.querySelectorAll(".tools button")) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        }
        apply();
      });
    }
  </script>
</body>
</html>`;
}

async function availableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    if (info.size < 1000 && (await isLfsPointer(filePath))) return false;
    return true;
  } catch {
    return false;
  }
}

export function mountLibraryPage(
  app: Express,
  allowed: (header: string | undefined) => boolean,
  root = mediaRoot(),
): void {
  app.get("/library", async (req: Request, res: Response) => {
    if (!allowed(req.header("authorization") ?? req.header("x-admin-secret"))) {
      res.status(401).type("text").send("Unauthorized.");
      return;
    }
    const files = await listLibraryFiles(root);
    res.set("cache-control", "no-store");
    res.type("html").send(libraryPageHtml(files));
  });

  app.get("/library/file", async (req: Request, res: Response) => {
    if (!allowed(req.header("authorization") ?? req.header("x-admin-secret"))) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const filePath = resolveLibraryFile(name, root);
    if (!filePath || !(await availableFile(filePath))) {
      res.status(404).json({ error: "File is not available." });
      return;
    }
    res.download(filePath, path.basename(filePath), (error) => {
      if (!error || res.headersSent) return;
      res.status(500).json({ error: "Download failed." });
    });
  });
}
