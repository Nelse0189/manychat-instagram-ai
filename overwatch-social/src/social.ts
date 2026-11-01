/** Check whether a player name has a public profile. Same name does not mean same person. */

export type ProfileStatus = "found" | "not_found" | "unavailable" | "lookup";

export interface Profile {
  platform: string;
  status: ProfileStatus;
  url: string;
  detail: string;
}

export interface PlayerReport {
  name: string;
  handle: string;
  summary: string;
  hasProfile: boolean;
  profiles: Profile[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const ORDER = ["Twitch", "YouTube", "TikTok", "Kick", "X", "Instagram", "Reddit", "Web"];

export function handleFromName(name: string): string {
  return name.split(/[#＃]/)[0]?.trim() ?? "";
}

function profile(platform: string, status: ProfileStatus, url: string, detail: string): Profile {
  return { platform, status, url, detail };
}

function summarize(profiles: Profile[]): string {
  const found = profiles.filter((item) => item.status === "found").map((item) => item.platform);
  if (found.length === 1) return `Public profile on ${found[0]}.`;
  if (found.length > 1) {
    return `Public profiles on ${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}.`;
  }
  const silent = profiles.filter((item) => item.status === "unavailable").map((item) => item.platform);
  const answered = profiles.some((item) => item.status === "not_found" || item.status === "found");
  if (silent.length && answered) {
    return `No public profile on the sites that answered. ${silent.join(" and ")} didn't answer.`;
  }
  if (silent.length) return "Those sites didn't answer. Use the links to check.";
  return "No public profile found for this exact name.";
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function request(
  fetchImpl: FetchLike,
  url: string,
  method: "GET" | "HEAD",
): Promise<{ status: number; body: string }> {
  const once = async (): Promise<{ status: number; body: string }> => {
    try {
      const response = await fetchImpl(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: {
          "user-agent": BROWSER_UA,
          accept: method === "HEAD" ? "*/*" : "application/json,text/plain;q=0.9,*/*;q=0.5",
        },
      });
      if (method === "HEAD") {
        await response.body?.cancel();
        return { status: response.status, body: "" };
      }
      return { status: response.status, body: await readLimited(response, 200_000) };
    } catch {
      return { status: 0, body: "" };
    }
  };
  const first = await once();
  if (first.status !== 0 && first.status !== 403 && first.status !== 429 && first.status !== 503) return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return once();
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function google(handle: string, extra: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${handle}" ${extra}`)}`;
}

function safeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function sameSite(url: string, host: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const name = parsed.hostname.toLowerCase();
    if (name !== host && !name.endsWith(`.${host}`)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function count(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return `${new Intl.NumberFormat("en-US").format(value)} followers`;
}

async function checkTwitch(handle: string, fetchImpl: FetchLike): Promise<Profile> {
  const search = `https://www.twitch.tv/search?term=${encodeURIComponent(handle)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_]{0,24}$/.test(handle)) {
    return profile("Twitch", "unavailable", search, "This name isn't a valid username there.");
  }
  const login = handle.toLowerCase();
  const { status, body } = await request(
    fetchImpl,
    `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`,
    "GET",
  );
  const data = parseJson(body);
  if (status === 200 && Array.isArray(data) && data.length === 0) {
    return profile("Twitch", "not_found", search, "No profile for this exact name.");
  }
  const user = Array.isArray(data) ? data[0] : null;
  if (status === 200 && user && typeof user === "object" && "login" in user && typeof user.login === "string") {
    const login = /^[A-Za-z0-9][A-Za-z0-9_]{0,24}$/.test(user.login) ? user.login : handle.toLowerCase();
    const display =
      "displayName" in user && typeof user.displayName === "string" ? safeLabel(user.displayName) : login;
    const followers = "followers" in user ? count(user.followers) : null;
    const detail = followers && display ? `${display} · ${followers}` : display || login;
    return profile("Twitch", "found", `https://www.twitch.tv/${login}`, detail);
  }
  return profile("Twitch", "unavailable", search, "This site didn't answer.");
}

async function checkYouTube(handle: string, fetchImpl: FetchLike): Promise<Profile> {
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(handle)}`;
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(handle)) {
    return profile("YouTube", "unavailable", search, "This name isn't a valid username there.");
  }
  const url = `https://www.youtube.com/@${handle}`;
  const { status } = await request(fetchImpl, url, "HEAD");
  if (status === 200) return profile("YouTube", "found", url, "A channel exists for this name.");
  if (status === 404) return profile("YouTube", "not_found", search, "No profile for this exact name.");
  return profile("YouTube", "unavailable", search, "This site didn't answer.");
}

async function checkTikTok(handle: string, fetchImpl: FetchLike): Promise<Profile> {
  const search = `https://www.tiktok.com/search/user?q=${encodeURIComponent(handle)}`;
  if (!/^[A-Za-z0-9._]{2,24}$/.test(handle)) {
    return profile("TikTok", "unavailable", search, "This name isn't a valid username there.");
  }
  const page = `https://www.tiktok.com/@${handle}`;
  const { status, body } = await request(
    fetchImpl,
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}`,
    "GET",
  );
  const data = parseJson(body);
  if (
    status === 200 &&
    data &&
    typeof data === "object" &&
    "author_name" in data &&
    typeof data.author_name === "string"
  ) {
    const authorUrl =
      "author_url" in data && typeof data.author_url === "string" ? sameSite(data.author_url, "tiktok.com") : null;
    return profile("TikTok", "found", authorUrl ?? page, safeLabel(data.author_name));
  }
  if (status === 400 || status === 404) {
    return profile("TikTok", "not_found", search, "No profile for this exact name.");
  }
  return profile("TikTok", "unavailable", search, "This site didn't answer.");
}

async function checkX(handle: string, fetchImpl: FetchLike): Promise<Profile> {
  const search = `https://x.com/search?q=${encodeURIComponent(handle)}&f=user`;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return profile("X", "unavailable", search, "This name isn't a valid username there.");
  }
  const url = `https://x.com/${handle}`;
  const { status } = await request(fetchImpl, url, "HEAD");
  if (status === 200) return profile("X", "found", url, "A profile exists for this name.");
  if (status === 404) return profile("X", "not_found", search, "No profile for this exact name.");
  return profile("X", "unavailable", search, "This site didn't answer.");
}

function manualLookups(handle: string): Profile[] {
  const instagramOk = /^[A-Za-z0-9._]{1,30}$/.test(handle);
  const instagram = instagramOk
    ? `https://www.instagram.com/${handle}/`
    : google(handle, "site:instagram.com");
  const kickOk = /^[A-Za-z0-9_]{2,25}$/.test(handle);
  const kick = kickOk ? `https://kick.com/${handle}` : google(handle, "site:kick.com");
  return [
    profile("Kick", "lookup", kick, "Not checked automatically."),
    profile("Instagram", "lookup", instagram, "Not checked automatically."),
    profile(
      "Reddit",
      "lookup",
      `https://www.reddit.com/search/?q=${encodeURIComponent(handle)}&type=user`,
      "Not checked automatically.",
    ),
    profile(
      "Web",
      "lookup",
      google(handle, "twitch OR tiktok OR youtube OR instagram"),
      "Search the name across the web.",
    ),
  ];
}

export async function lookupPlayer(name: string, fetchImpl: FetchLike = fetch): Promise<PlayerReport> {
  const handle = handleFromName(name);
  if (!handle) {
    return {
      name,
      handle,
      summary: "No name to search.",
      hasProfile: false,
      profiles: [],
    };
  }
  const checked = await Promise.all([
    checkTwitch(handle, fetchImpl),
    checkYouTube(handle, fetchImpl),
    checkTikTok(handle, fetchImpl),
    checkX(handle, fetchImpl),
  ]);
  const profiles = [...checked, ...manualLookups(handle)].sort(
    (a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform),
  );
  return {
    name,
    handle,
    summary: summarize(profiles),
    hasProfile: profiles.some((item) => item.status === "found"),
    profiles,
  };
}

export async function lookupPlayers(names: string[], fetchImpl: FetchLike = fetch): Promise<PlayerReport[]> {
  const results = new Array<PlayerReport>(names.length);
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const index = cursor;
      cursor += 1;
      const name = names[index];
      if (name === undefined) continue;
      results[index] = await lookupPlayer(name, fetchImpl);
    }
  }
  const workers = Math.min(3, names.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
