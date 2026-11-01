/** Pull Overwatch player names out of scoreboard text. */

const MAX_PLAYERS = 12;

const HEROES = [
  "D.Mon",
  "Ana",
  "Anran",
  "Ashe",
  "Baptiste",
  "Bastion",
  "Brigitte",
  "Cassidy",
  "D.Va",
  "Domina",
  "Doomfist",
  "Doctrine",
  "Echo",
  "Emre",
  "Freja",
  "Genji",
  "Hanzo",
  "Hazard",
  "Illari",
  "Jetpack Cat",
  "Junker Queen",
  "Junkrat",
  "Juno",
  "Kiriko",
  "Lifeweaver",
  "Lúcio",
  "Lucio",
  "Mauga",
  "Mei",
  "Mercy",
  "Mizuki",
  "Moira",
  "Orisa",
  "Pharah",
  "Ramattra",
  "Reaper",
  "Reinhardt",
  "Roadhog",
  "Shion",
  "Sierra",
  "Sigma",
  "Sojourn",
  "Soldier: 76",
  "Soldier 76",
  "Sombra",
  "Symmetra",
  "Torbjörn",
  "Torbjorn",
  "Tracer",
  "Vendetta",
  "Venture",
  "Widowmaker",
  "Winston",
  "Wrecking Ball",
  "Wuyang",
  "Zarya",
  "Zenyatta",
];

const UI_WORDS = [
  "eliminations",
  "elimination",
  "elims",
  "deaths",
  "assists",
  "assist",
  "damage",
  "healing",
  "mitigation",
  "objective",
  "hero",
  "heroes",
  "role",
  "victory",
  "defeat",
  "draw",
  "potg",
  "endorse",
  "endorsement",
  "avoid",
  "prefer",
  "player",
  "social",
  "group",
  "stay",
  "team",
  "leave",
  "spectate",
  "career",
  "profile",
  "competitive",
  "quick",
  "open",
  "queue",
  "loading",
  "assembling",
  "round",
  "attack",
  "defend",
  "payload",
  "control",
  "hybrid",
  "push",
  "flashpoint",
  "escort",
  "challenge",
  "battle",
  "pass",
  "overwatch",
  "blizzard",
  "scoreboard",
  "ally",
  "enemy",
  "final",
  "blow",
  "card",
  "cards",
  "match",
  "complete",
  "statistics",
  "stats",
  "next",
  "back",
  "done",
  "close",
  "continue",
  "cancel",
  "accept",
  "decline",
  "invite",
  "friend",
  "report",
  "mute",
  "block",
  "commend",
  "shotcaller",
  "teammate",
  "sportsmanship",
  "chat",
  "voice",
  "text",
  "blue",
  "red",
  "squad",
  "party",
  "solo",
  "duo",
  "stack",
  "rank",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
  "champion",
  "ping",
  "ultimate",
  "cooldown",
  "ability",
  "weapon",
  "primary",
  "secondary",
  "melee",
  "reload",
  "crouch",
  "jump",
  "interact",
  "acknowledge",
  "hello",
  "thanks",
  "grouped",
  "attacking",
  "defending",
  "press",
  "hold",
  "shift",
  "enter",
  "space",
  "escape",
  "menu",
  "options",
  "settings",
  "audio",
  "video",
  "controls",
  "keyboard",
  "mouse",
  "sensitivity",
  "graphics",
  "render",
  "display",
  "windowed",
  "fullscreen",
  "borderless",
  "apply",
  "reset",
  "default",
  "exit",
  "quit",
  "okay",
  "start",
  "stop",
  "pause",
  "resume",
  "replay",
  "highlight",
  "save",
  "share",
  "clip",
  "export",
  "import",
  "workshop",
  "custom",
  "arcade",
  "training",
  "practice",
  "gallery",
  "loot",
  "credits",
  "coins",
  "legendary",
  "epic",
  "rare",
  "common",
  "skin",
  "spray",
  "emote",
  "intro",
  "pose",
  "charm",
  "banner",
  "season",
  "battlepass",
  "premium",
  "tier",
  "reward",
  "daily",
  "weekly",
  "progress",
  "level",
  "prestige",
  "support",
  "tank",
  "flanker",
  "recon",
  "sharpshooter",
  "specialist",
  "medic",
  "survivor",
  "tactician",
  "bruiser",
  "initiator",
  "stalwart",
  "stadium",
  "play",
  "game",
];

const PHRASES = [...HEROES, ...UI_WORDS].sort((a, b) => b.length - a.length);

const STOP = new Set<string>();
for (const phrase of PHRASES) {
  const folded = fold(phrase);
  if (folded.length >= 3) STOP.add(folded);
}

const TAG = /^([\p{L}][\p{L}\p{N}]{2,15})\s*[#＃]\s*(\d{3,8})$/u;
const PLAIN = /^[\p{L}][\p{L}\p{N}_]{2,15}$/u;

function battleTagPattern(): RegExp {
  return /[\p{L}][\p{L}\p{N}]{2,15}\s*[#＃]\s*\d{3,8}/gu;
}

export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function stripPhrases(text: string): string {
  let out = text;
  for (const phrase of PHRASES) {
    const body = phrase
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}#＃])`, "giu"), " ");
  }
  return out;
}

function cleanCandidate(raw: string, ignoreStoplist: boolean): string | null {
  const trimmed = raw.trim().replace(/^[^#\p{L}\p{N}]+|[^#\p{L}\p{N}]+$/gu, "");
  const tag = TAG.exec(trimmed);
  if (tag) {
    // A discriminator means this is a BattleTag, not a hero label on the scoreboard.
    return `${tag[1]}#${tag[2]}`;
  }
  if (!PLAIN.test(trimmed)) return null;
  if (!ignoreStoplist && STOP.has(fold(trimmed))) return null;
  if (new Set(fold(trimmed)).size === 1) return null;
  return trimmed;
}

function remember(found: string[], seen: Set<string>, name: string | null) {
  if (!name) return;
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  found.push(name);
}

/** Names from OCR or a pasted scoreboard. Hero labels and column headers are dropped. */
export function extractNames(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const source = stripPhrases(text);

  for (const match of source.matchAll(battleTagPattern())) {
    remember(found, seen, cleanCandidate(match[0], false));
  }

  const leftover = source.replace(battleTagPattern(), " ");
  for (const token of leftover.split(/[^\p{L}\p{N}_#＃]+/u)) {
    remember(found, seen, cleanCandidate(token, false));
  }

  const tags = found.filter((name) => name.includes("#"));
  const plain = found.filter((name) => !name.includes("#"));
  return [...tags, ...plain].slice(0, MAX_PLAYERS);
}

/** A name the user typed. Hero names are allowed here because they asked for that name. */
export function acceptTypedName(input: string): string | null {
  return cleanCandidate(input.trim().slice(0, 32), true);
}
