import assert from "node:assert/strict";
import test from "node:test";
import { isOverwatchRunning, processListHasOverwatch } from "./watch.js";

test("recognizes the game process and ignores this app", () => {
  assert.equal(processListHasOverwatch(""), false);
  assert.equal(
    processListHasOverwatch("node /workspace/overwatch-social/src/server.ts"),
    false,
  );
  assert.equal(processListHasOverwatch("C:\\Program Files\\Overwatch\\Overwatch.exe"), true);
  assert.equal(processListHasOverwatch("/games/Overwatch/Overwatch.exe\n"), true);
  assert.equal(processListHasOverwatch("/usr/bin/chrome"), false);
});

test("process check returns a boolean on this machine", async () => {
  assert.equal(typeof (await isOverwatchRunning()), "boolean");
});
