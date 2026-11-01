import assert from "node:assert/strict";
import test from "node:test";
import { lookupPlayer, type FetchLike } from "./social.js";

function respond(status: number, body = ""): Response {
  return new Response(body, { status });
}

test("checks the name before the battle tag number and reports real hits", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.includes("api.ivr.fi") && url.includes("login=niteowl")) {
      return respond(
        200,
        JSON.stringify([{ login: "niteowl", displayName: "NiteOwl", followers: 1200 }]),
      );
    }
    if (url.startsWith("https://www.youtube.com/@NiteOwl")) return respond(404);
    if (url.includes("tiktok.com/oembed")) return respond(400, JSON.stringify({ message: "missing" }));
    if (url.includes("kick.com/api")) return respond(404, JSON.stringify({ message: "Channel not found." }));
    if (url === "https://x.com/NiteOwl") return respond(200);
    return respond(599, "unexpected");
  };

  const report = await lookupPlayer("NiteOwl#2241", fetchImpl);
  assert.equal(report.handle, "NiteOwl");
  assert.equal(report.hasProfile, true);
  assert.equal(report.summary, "Public profiles on Twitch and X.");
  assert.equal(report.profiles.find((item) => item.platform === "Twitch")?.detail, "NiteOwl · 1,200 followers");
  assert.equal(report.profiles.find((item) => item.platform === "YouTube")?.status, "not_found");
  assert.equal(report.profiles.find((item) => item.platform === "Instagram")?.status, "lookup");
  assert.equal(calls.some((call) => call.includes("2241")), false);
  assert.equal(calls.some((call) => call.startsWith("HEAD https://x.com/NiteOwl")), true);
});

test("does not follow a profile link off the site that answered", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.includes("tiktok.com/oembed")) {
      return respond(
        200,
        JSON.stringify({
          author_name: "Nite Owl",
          author_url: "https://evil.example/steal",
        }),
      );
    }
    if (url.includes("api.ivr.fi")) return respond(200, "[]");
    if (url.startsWith("https://www.youtube.com/")) return respond(404);
    if (url.includes("kick.com/api")) return respond(404);
    if (url.startsWith("https://x.com/")) return respond(404);
    return respond(599);
  };
  const report = await lookupPlayer("NiteOwl", fetchImpl);
  const tiktok = report.profiles.find((item) => item.platform === "TikTok");
  assert.equal(tiktok?.status, "found");
  assert.equal(tiktok?.url, "https://www.tiktok.com/@NiteOwl");
});

test("a site that stays quiet does not hide the sites that answered", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.startsWith("https://x.com/")) throw new Error("quiet");
    if (url.includes("api.ivr.fi")) return respond(200, "[]");
    if (url.includes("tiktok.com/oembed")) return respond(400, "{}");
    return respond(404);
  };
  const report = await lookupPlayer("ZzqPlum441", fetchImpl);
  assert.equal(report.hasProfile, false);
  assert.match(report.summary, /No public profile on the sites that answered/);
  assert.match(report.summary, /X didn't answer/);
});

test("says the check is incomplete when sites do not answer", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("offline");
  };
  const report = await lookupPlayer("NiteOwl", fetchImpl);
  assert.equal(report.hasProfile, false);
  assert.match(report.summary, /didn't answer/);
  assert.equal(report.profiles.filter((item) => item.status === "unavailable").length, 4);
});
