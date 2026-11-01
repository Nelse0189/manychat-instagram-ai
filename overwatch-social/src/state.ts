import type { PlayerReport } from "./social.js";

export type Phase = "idle" | "in_game" | "checking" | "postgame";

export interface Snapshot {
  phase: Phase;
  overwatchRunning: boolean;
  players: string[];
  report: PlayerReport[] | null;
  checking: boolean;
  error: string | null;
  notice: string | null;
}

const MAX_PLAYERS = 12;

interface Internal extends Snapshot {
  generation: number;
}

export interface CheckTicket {
  ok: true;
  generation: number;
  names: string[];
}

export interface CheckRefusal {
  ok: false;
  reason: "empty" | "busy";
}

export function createMatch() {
  const state: Internal = {
    phase: "idle",
    overwatchRunning: false,
    players: [],
    report: null,
    checking: false,
    error: null,
    notice: "Start Overwatch, then capture the scoreboard. Or load a screenshot.",
    generation: 0,
  };

  function snapshot(): Snapshot {
    return {
      phase: state.phase,
      overwatchRunning: state.overwatchRunning,
      players: [...state.players],
      report: state.report,
      checking: state.checking,
      error: state.error,
      notice: state.notice,
    };
  }

  function noteOverwatch(running: boolean): { ended: boolean } {
    const was = state.overwatchRunning;
    state.overwatchRunning = running;
    if (running && !was && !state.checking && state.phase === "idle") {
      state.players = [];
      state.report = null;
      state.error = null;
      state.phase = "in_game";
      state.notice = "Overwatch is running. Hold Tab to open the scoreboard, then capture it.";
      return { ended: false };
    }
    if (!running && was && state.phase === "in_game" && !state.checking) {
      if (state.players.length > 0) {
        state.notice = "Overwatch closed. Checking public profiles…";
        return { ended: true };
      }
      state.phase = "idle";
      state.notice = "Overwatch closed before any names were captured.";
    }
    return { ended: false };
  }

  function addPlayers(names: string[], source: "capture" | "typed"): string[] {
    if (state.checking) return [...state.players];
    const freshCapture = source === "capture" && (state.phase === "idle" || state.phase === "postgame");
    if (freshCapture) {
      state.players = [];
      state.report = null;
    } else if (state.report) {
      state.report = null;
    }
    for (const name of names) {
      const cleaned = name.trim();
      if (!cleaned) continue;
      if (state.players.some((player) => player.toLowerCase() === cleaned.toLowerCase())) continue;
      if (state.players.length >= MAX_PLAYERS) break;
      state.players.push(cleaned);
    }
    state.phase = "in_game";
    state.error = null;
    state.notice =
      state.players.length === 0
        ? "No names were added."
        : `${state.players.length} ${state.players.length === 1 ? "name" : "names"} ready. Check socials when the match ends.`;
    return [...state.players];
  }

  function removePlayer(name: string) {
    if (state.checking) return;
    const next = state.players.filter((player) => player.toLowerCase() !== name.trim().toLowerCase());
    if (next.length === state.players.length) return;
    state.players = next;
    state.report = null;
    state.error = null;
    state.phase = next.length > 0 || state.overwatchRunning ? "in_game" : "idle";
    state.notice = next.length
      ? `${next.length} ${next.length === 1 ? "name" : "names"} ready. Check socials when the match ends.`
      : "Roster cleared.";
  }

  function beginCheck(): CheckTicket | CheckRefusal {
    if (state.checking) return { ok: false, reason: "busy" };
    if (state.players.length === 0) {
      state.error = "Capture at least one name first.";
      return { ok: false, reason: "empty" };
    }
    state.generation += 1;
    state.checking = true;
    state.phase = "checking";
    state.error = null;
    state.notice = "Checking public profiles…";
    return { ok: true, generation: state.generation, names: [...state.players] };
  }

  function finishCheck(generation: number, report: PlayerReport[] | null, error: string | null) {
    if (generation !== state.generation) return;
    state.checking = false;
    state.report = report;
    state.error = error;
    state.phase = "postgame";
    if (error) {
      state.notice = "The social check failed. You can try again.";
      return;
    }
    const found = (report ?? []).filter((player) => player.hasProfile).length;
    const total = report?.length ?? 0;
    state.notice =
      found === 0
        ? `Checked ${total} ${total === 1 ? "player" : "players"}. No confirmed public profiles.`
        : `Checked ${total} ${total === 1 ? "player" : "players"}. ${found} ${found === 1 ? "has" : "have"} a public profile under that name.`;
  }

  function reset() {
    state.generation += 1;
    state.checking = false;
    state.players = [];
    state.report = null;
    state.error = null;
    state.phase = state.overwatchRunning ? "in_game" : "idle";
    state.notice = state.overwatchRunning
      ? "New match. Capture the scoreboard before it ends."
      : "Ready for the next match. Capture a scoreboard or start Overwatch.";
  }

  function setError(message: string) {
    state.error = message;
  }

  return {
    snapshot,
    noteOverwatch,
    addPlayers,
    removePlayer,
    beginCheck,
    finishCheck,
    reset,
    setError,
  };
}

export type Match = ReturnType<typeof createMatch>;
