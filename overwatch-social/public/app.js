const phaseLabels = {
  idle: "Waiting for a match",
  in_game: "In a match",
  checking: "Checking socials",
  postgame: "Post-game report",
};

const phasePill = document.querySelector("#phase-pill");
const gamePill = document.querySelector("#game-pill");
const notice = document.querySelector("#notice");
const errorBox = document.querySelector("#error");
const roster = document.querySelector("#roster");
const rosterCount = document.querySelector("#roster-count");
const report = document.querySelector("#report");
const reportCount = document.querySelector("#report-count");
const overlay = document.querySelector("#overlay");
const overlayText = document.querySelector("#overlay-text");
const buttons = {
  capture: document.querySelector("#capture"),
  upload: document.querySelector("#upload-button"),
  sample: document.querySelector("#sample"),
  end: document.querySelector("#end"),
  reset: document.querySelector("#reset"),
};
const uploadInput = document.querySelector("#upload");
const addForm = document.querySelector("#add-form");
const nameInput = document.querySelector("#name");

let snapshot = null;
let lastKey = "";
let busy = false;
let busyNote = "";
let cancelCapture = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    const allowed = ["twitch.tv", "youtube.com", "tiktok.com", "kick.com", "x.com", "instagram.com", "reddit.com", "google.com"];
    const ok = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
    return ok ? parsed.href : null;
  } catch {
    return null;
  }
}

function setBusy(value, note) {
  busy = value;
  busyNote = value ? note ?? busyNote : "";
  const locked = busy || snapshot?.checking;
  for (const button of Object.values(buttons)) button.disabled = locked;
  addForm.querySelector("button").disabled = locked;
  nameInput.disabled = locked;
  if (snapshot) notice.textContent = busy && busyNote ? busyNote : snapshot.notice ?? "";
}

async function post(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  apply(body);
  if (!response.ok && !body.error) {
    errorBox.hidden = false;
    errorBox.textContent = "That didn't work. Try again.";
  }
  return body;
}

function apply(next) {
  snapshot = next;
  const key = JSON.stringify(next);
  if (key === lastKey) {
    setBusy(busy);
    return;
  }
  lastKey = key;
  phasePill.textContent = phaseLabels[next.phase] ?? "Aftermatch";
  phasePill.classList.toggle("live", next.phase === "in_game" || next.phase === "checking");
  gamePill.textContent = next.overwatchRunning ? "Overwatch is running" : "Overwatch isn't running";
  gamePill.classList.toggle("live", next.overwatchRunning);
  notice.textContent = busy && busyNote ? busyNote : next.notice ?? "";
  errorBox.hidden = !next.error;
  errorBox.textContent = next.error ?? "";
  renderRoster(next);
  renderReport(next);
  setBusy(busy);
}

function renderRoster(next) {
  roster.replaceChildren();
  const count = next.players.length;
  rosterCount.textContent = count === 1 ? "1 name" : `${count} names`;
  if (count === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Names show up here after you capture the scoreboard.";
    roster.append(empty);
    return;
  }
  for (const name of next.players) {
    const item = document.createElement("li");
    item.className = "player";
    const label = document.createElement("strong");
    label.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      void post("/api/names/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    });
    item.append(label, remove);
    roster.append(item);
  }
}

function renderReport(next) {
  report.replaceChildren();
  if (next.checking && !next.report) {
    reportCount.textContent = "Checking";
    const pending = document.createElement("p");
    pending.className = "empty";
    pending.textContent = "Checking public profiles…";
    report.append(pending);
    return;
  }
  if (!next.report) {
    reportCount.textContent = "After the match";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Twitch, YouTube, TikTok, and X are checked when you end the match. Kick, Instagram, and Reddit stay as links you can open.";
    report.append(empty);
    return;
  }
  const hits = next.report.filter((player) => player.hasProfile).length;
  reportCount.textContent = hits === 0 ? "No confirmed profiles" : `${hits} of ${next.report.length} have a profile`;
  for (const player of next.report) {
    const card = document.createElement("article");
    card.className = player.hasProfile ? "player-card hit" : "player-card";
    const heading = document.createElement("h3");
    heading.textContent = player.name;
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = player.summary;
    const list = document.createElement("ul");
    list.className = "profiles";
    for (const item of player.profiles) {
      const row = document.createElement("li");
      row.className = item.status;
      const platform = document.createElement("span");
      platform.className = "platform";
      platform.textContent = item.platform;
      row.append(platform);
      const href = safeUrl(item.url);
      if (href && item.status !== "not_found") {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = item.status === "found" ? "Open profile" : "Look up";
        row.append(link);
      }
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = item.detail;
      row.append(detail);
      list.append(row);
    }
    card.append(heading, summary, list);
    report.append(card);
  }
}

async function capture() {
  cancelCapture = false;
  setBusy(true, "Switch to Overwatch and hold Tab.");
  overlay.hidden = false;
  const ends = Date.now() + 4000;
  while (Date.now() < ends) {
    if (cancelCapture) {
      overlay.hidden = true;
      setBusy(false);
      return;
    }
    const left = Math.max(1, Math.ceil((ends - Date.now()) / 1000));
    overlayText.textContent = `Switch to Overwatch and hold Tab. Capturing in ${left}. Press Esc to cancel.`;
    await sleep(200);
  }
  overlayText.textContent = "Capturing…";
  try {
    await post("/api/capture", { method: "POST" });
  } catch {
    errorBox.hidden = false;
    errorBox.textContent = "Couldn't reach Aftermatch.";
  } finally {
    overlay.hidden = true;
    setBusy(false);
  }
}

buttons.capture.addEventListener("click", () => {
  void capture();
});

function showOverlay(text) {
  overlay.hidden = false;
  overlayText.textContent = text;
}

function hideOverlay() {
  overlay.hidden = true;
}

buttons.upload.addEventListener("click", () => uploadInput.click());

uploadInput.addEventListener("change", () => {
  const file = uploadInput.files?.[0];
  uploadInput.value = "";
  if (!file) return;
  const body = new FormData();
  body.set("image", file);
  setBusy(true, "Reading that picture…");
  showOverlay("Reading that picture…");
  void post("/api/upload", { method: "POST", body }).finally(() => {
    hideOverlay();
    setBusy(false);
  });
});

buttons.sample.addEventListener("click", () => {
  setBusy(true, "Reading the sample scoreboard…");
  showOverlay("Reading the sample scoreboard…");
  void post("/api/sample", { method: "POST" }).finally(() => {
    hideOverlay();
    setBusy(false);
  });
});

buttons.end.addEventListener("click", () => {
  setBusy(true, "Checking public profiles…");
  showOverlay("Checking public profiles…");
  void post("/api/match/end", { method: "POST" }).finally(() => {
    hideOverlay();
    setBusy(false);
  });
});

buttons.reset.addEventListener("click", () => {
  void post("/api/match/reset", { method: "POST" });
});

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  void post("/api/names", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(() => {
    if (!snapshot?.error) nameInput.value = "";
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancelCapture = true;
});

async function poll() {
  try {
    const response = await fetch("/api/status");
    apply(await response.json());
  } catch {
    // The next poll will try again. A failed action already shows its own error.
  }
}

void poll();
setInterval(() => void poll(), 2000);
