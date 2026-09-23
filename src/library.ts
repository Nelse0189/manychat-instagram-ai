import { readdir } from "node:fs/promises";
import path from "node:path";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

export function mediaRoot(): string {
  return path.resolve(process.cwd(), "media");
}

export async function listCollectionFiles(kind: "photo" | "video"): Promise<string[]> {
  const folder = path.join(mediaRoot(), "hernandez_sari_");
  const names = await readdir(folder);
  const allowed = kind === "photo" ? PHOTO_EXTENSIONS : VIDEO_EXTENSIONS;
  return names
    .filter((name) => allowed.has(path.extname(name).toLowerCase()))
    .map((name) => path.join("hernandez_sari_", name))
    .sort();
}

export function pickFiles(files: string[], count: number): string[] {
  const pool = [...files];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = pool[index];
    pool[index] = pool[swap] ?? current;
    pool[swap] = current;
  }
  return pool.slice(0, count);
}

export function resolveMediaFile(relativePath: string): string | null {
  const root = mediaRoot();
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}
