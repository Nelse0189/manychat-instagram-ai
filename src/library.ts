import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const LFS_MARKER = "version https://git-lfs.github.com/spec/v1";

export function mediaRoot(): string {
  return path.resolve(process.cwd(), "media");
}

export function mediaKind(name: string): "photo" | "video" | null {
  const extension = path.extname(name).toLowerCase();
  if (PHOTO_EXTENSIONS.has(extension)) return "photo";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function isSafeLibraryName(name: string): boolean {
  if (!name || name !== name.trim()) return false;
  if (name.includes("\0") || name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return path.basename(name) === name && mediaKind(name) !== null;
}

export async function isLfsPointer(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(LFS_MARKER.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8") === LFS_MARKER;
  } finally {
    await handle.close();
  }
}

export type LibraryFile = {
  name: string;
  kind: "photo" | "video";
  bytes: number;
};

export async function listLibraryFiles(root = mediaRoot()): Promise<LibraryFile[]> {
  const folder = path.join(root, "hernandez_sari_");
  const names = await readdir(folder);
  const files: LibraryFile[] = [];
  for (const name of names) {
    if (!isSafeLibraryName(name)) continue;
    const kind = mediaKind(name);
    if (!kind) continue;
    const full = path.join(folder, name);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size < 1000 && (await isLfsPointer(full))) continue;
    files.push({ name, kind, bytes: info.size });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return files;
}

export function resolveLibraryFile(name: string, root = mediaRoot()): string | null {
  if (!isSafeLibraryName(name)) return null;
  const folder = path.resolve(root, "hernandez_sari_");
  const full = path.resolve(folder, name);
  if (!full.startsWith(`${folder}${path.sep}`)) return null;
  return full;
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
