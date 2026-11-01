import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerReport } from "./social.js";
import { createMatch } from "./state.js";

function report(name: string, hasProfile: boolean): PlayerReport {
  return {
    name,
    handle: name,
    summary: hasProfile ? "Public profile on Twitch." : "No public profile found for this exact name.",
    hasProfile,
    profiles: [],
  };
}

test("closing Overwatch with names ends the match, and opening it again keeps the report", () => {
  const match = createMatch();
  assert.equal(match.noteOverwatch(true).ended, false);
  assert.equal(match.snapshot().phase, "in_game");
  match.addPlayers(["NiteOwl#2241"], "capture");
  assert.equal(match.noteOverwatch(false).ended, true);
  assert.equal(match.snapshot().phase, "in_game");

  const ticket = match.beginCheck();
  assert.equal(ticket.ok, true);
  if (!ticket.ok) return;
  match.finishCheck(ticket.generation, [report("NiteOwl#2241", true)], null);
  assert.equal(match.snapshot().phase, "postgame");
  assert.match(match.snapshot().notice ?? "", /1 has a public profile/);

  match.noteOverwatch(true);
  assert.equal(match.snapshot().phase, "postgame");
  assert.deepEqual(match.snapshot().players, ["NiteOwl#2241"]);
});

test("a new capture after the report starts a fresh roster", () => {
  const match = createMatch();
  match.addPlayers(["OldName#1000"], "capture");
  const ticket = match.beginCheck();
  assert.equal(ticket.ok, true);
  if (!ticket.ok) return;
  match.finishCheck(ticket.generation, [report("OldName#1000", false)], null);
  match.addPlayers(["NewName#2000"], "capture");
  assert.deepEqual(match.snapshot().players, ["NewName#2000"]);
  assert.equal(match.snapshot().report, null);
  assert.equal(match.snapshot().phase, "in_game");
});

test("typing a name keeps the rest of the roster", () => {
  const match = createMatch();
  match.addPlayers(["NiteOwl#2241"], "capture");
  match.addPlayers(["xqc"], "typed");
  assert.deepEqual(match.snapshot().players, ["NiteOwl#2241", "xqc"]);
});

test("a reset during a check ignores the late result", () => {
  const match = createMatch();
  match.addPlayers(["NiteOwl#2241"], "capture");
  const ticket = match.beginCheck();
  assert.equal(ticket.ok, true);
  if (!ticket.ok) return;
  match.reset();
  match.finishCheck(ticket.generation, [report("NiteOwl#2241", true)], null);
  assert.equal(match.snapshot().phase, "idle");
  assert.equal(match.snapshot().report, null);
});

test("an empty roster cannot be checked", () => {
  const match = createMatch();
  const ticket = match.beginCheck();
  assert.deepEqual(ticket, { ok: false, reason: "empty" });
  assert.match(match.snapshot().error ?? "", /at least one name/);
});
