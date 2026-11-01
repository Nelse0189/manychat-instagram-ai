import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { extractNames } from "./names.js";

const tessdata = fileURLToPath(new URL("../tessdata", import.meta.url));
const cachePath = path.join(os.tmpdir(), "overwatch-aftermatch", "tesscache");

let workerPromise: Promise<Tesseract.Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      await mkdir(cachePath, { recursive: true });
      return Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
        langPath: tessdata,
        cachePath,
        gzip: true,
      });
    })();
  }
  try {
    return await workerPromise;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

function withWorker<T>(fn: (worker: Tesseract.Worker) => Promise<T>): Promise<T> {
  const run = queue.then(async () => fn(await getWorker()));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function recognize(image: Buffer, mode: Tesseract.PSM): Promise<string> {
  return withWorker(async (worker) => {
    await worker.setParameters({
      tessedit_pageseg_mode: mode,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(image);
    return result.data.text;
  });
}

async function preprocess(image: Buffer): Promise<Buffer> {
  const meta = await sharp(image, { failOn: "none" }).metadata();
  const width = meta.width ?? 1280;
  return sharp(image, { failOn: "none" })
    .resize({ width: Math.min(Math.max(width * 2, 1400), 2400), withoutEnlargement: false })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
}

function settled(names: string[]): boolean {
  const tags = names.filter((name) => name.includes("#")).length;
  return tags >= 8 || names.length >= 10;
}

/** Read player names from a scoreboard image. */
export async function readNames(image: Buffer): Promise<string[]> {
  if (image.length === 0) return [];
  let text = await recognize(image, Tesseract.PSM.SINGLE_BLOCK);
  if (settled(extractNames(text))) return extractNames(text);
  try {
    const processed = await preprocess(image);
    text += `\n${await recognize(processed, Tesseract.PSM.SINGLE_BLOCK)}`;
    if (settled(extractNames(text))) return extractNames(text);
    text += `\n${await recognize(processed, Tesseract.PSM.SPARSE_TEXT)}`;
  } catch {
    text += `\n${await recognize(image, Tesseract.PSM.SPARSE_TEXT)}`;
  }
  return extractNames(text);
}

export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // The worker never started.
  }
}
