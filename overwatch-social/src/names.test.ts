import assert from "node:assert/strict";
import test from "node:test";
import { acceptTypedName, extractNames } from "./names.js";

test("reads battle tags and plain names, and drops scoreboard words", () => {
  const text = `
    SCOREBOARD
    VICTORY
    xqc 12 4 3
    NiteOwl #2241 9 8 5
    ANA
    MercyMain#1002
    ELIMINATIONS
    Reinhardt
    Junker Queen
  `;
  assert.deepEqual(extractNames(text), ["NiteOwl#2241", "MercyMain#1002", "xqc"]);
});

test("keeps a battle tag even when the name is also a hero", () => {
  assert.deepEqual(extractNames("Ana#1234\nAna\nMercy"), ["Ana#1234"]);
});

test("dedupes names that differ only by case", () => {
  assert.deepEqual(extractNames("xqc\nXQC\nNiteOwl#2241"), ["NiteOwl#2241", "xqc"]);
});

test("keeps battle tags when the screen has more than a match worth of words", () => {
  const plains = Array.from({ length: 15 }, (_, index) => `PlainName${index}`);
  const tags = ["ZedTag#1001", "YewTag#1002", "XenTag#1003"];
  const names = extractNames([...plains, ...tags].join("\n"));
  assert.equal(names.length, 12);
  assert.deepEqual(names.slice(0, 3), tags);
});

test("typed names can be heroes, and junk is rejected", () => {
  assert.equal(acceptTypedName("  Ana  "), "Ana");
  assert.equal(acceptTypedName("NiteOwl#2241"), "NiteOwl#2241");
  assert.equal(acceptTypedName("!!!"), null);
  assert.equal(acceptTypedName("ab"), null);
});
