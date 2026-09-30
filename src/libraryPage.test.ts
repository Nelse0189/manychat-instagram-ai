import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { isLfsPointer, listLibraryFiles, resolveLibraryFile } from "./library.js";
import { mountLibraryPage } from "./libraryPage.js";

const POINTER = `version https://git-lfs.github.com/spec/v1
oid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
size 1200
`;

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

test("the library page lists real photos and videos and downloads one file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "library-"));
  const folder = path.join(root, "hernandez_sari_");
  await mkdir(folder);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11, 0x22]);
  await writeFile(path.join(folder, "selfie one.jpg"), jpeg);
  await writeFile(path.join(folder, "clip.mp4"), Buffer.from("not-a-pointer-video"));
  await writeFile(path.join(folder, "missing.mp4"), POINTER);
  await writeFile(path.join(folder, "voice.mp3"), Buffer.from("audio-bytes-here"));

  const listed = await listLibraryFiles(root);
  assert.deepEqual(
    listed.map((file) => file.name),
    ["clip.mp4", "selfie one.jpg"],
  );
  assert.equal(await isLfsPointer(path.join(folder, "missing.mp4")), true);
  assert.equal(resolveLibraryFile("../secret.jpg", root), null);
  assert.equal(resolveLibraryFile("voice.mp3", root), null);
  assert.equal(resolveLibraryFile("selfie one.jpg", root), path.join(folder, "selfie one.jpg"));

  const app = express();
  mountLibraryPage(app, () => true, root);
  const running = await listen(app);
  try {
    const page = await fetch(`${running.url}/library`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /selfie one\.jpg/);
    assert.match(html, /clip\.mp4/);
    assert.doesNotMatch(html, /missing\.mp4/);
    assert.doesNotMatch(html, /voice\.mp3/);
    assert.match(html, /1 photo, 1 video/);

    const file = await fetch(`${running.url}/library/file?name=${encodeURIComponent("selfie one.jpg")}`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition") ?? "", /selfie one\.jpg/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), jpeg);

    const pointer = await fetch(`${running.url}/library/file?name=missing.mp4`);
    assert.equal(pointer.status, 404);
    const escaped = await fetch(`${running.url}/library/file?name=${encodeURIComponent("../secret.jpg")}`);
    assert.equal(escaped.status, 404);
    const audio = await fetch(`${running.url}/library/file?name=voice.mp3`);
    assert.equal(audio.status, 404);
  } finally {
    await running.close();
  }
});

test("the library page stays closed unless it is public", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "library-closed-"));
  await mkdir(path.join(root, "hernandez_sari_"));
  const app = express();
  mountLibraryPage(app, (header) => header === "Bearer secret", root);
  const running = await listen(app);
  try {
    const denied = await fetch(`${running.url}/library`);
    assert.equal(denied.status, 401);
    const opened = await fetch(`${running.url}/library`, { headers: { authorization: "Bearer secret" } });
    assert.equal(opened.status, 200);
    assert.match(await opened.text(), /No photo or video files/);
  } finally {
    await running.close();
  }
});
