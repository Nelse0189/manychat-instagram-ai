import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { readNames, shutdownOcr } from "./ocr.js";

const rosterPath = fileURLToPath(new URL("../fixtures/roster.json", import.meta.url));
const imagePath = fileURLToPath(new URL("../fixtures/scoreboard.png", import.meta.url));
const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as { names: string[]; noise: string[] };

function includesName(names: string[], expected: string): boolean {
  return names.some((name) => name.toLowerCase() === expected.toLowerCase());
}

test("reads the sample scoreboard and ignores the labels", { timeout: 120_000 }, async () => {
  const names = await readNames(readFileSync(imagePath));
  const missed = roster.names.filter((name) => !includesName(names, name));
  const leaked = roster.noise.filter((word) => includesName(names, word));
  assert.deepEqual(missed, [], `missed ${missed.join(", ")} from ${names.join(", ")}`);
  assert.deepEqual(leaked, [], `kept scoreboard words ${leaked.join(", ")}`);
});

after(async () => {
  await shutdownOcr();
});
