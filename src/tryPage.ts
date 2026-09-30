export function tryPageHtml(model: string): string {
  const boot = JSON.stringify({ model }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Try the voice</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: #111;
      color: #f4f4f5;
      font: 16px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    main {
      max-width: 440px;
      height: 100dvh;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      background: #18181b;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      padding: 16px;
      border-bottom: 1px solid #2a2a2e;
    }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p { margin: 0; color: #a1a1aa; font-size: 13px; }
    #totals { margin-top: 4px; font-size: 12px; }
    button, textarea { font: inherit; }
    button {
      border: 0;
      border-radius: 999px;
      background: #f4f4f5;
      color: #111;
      padding: 8px 14px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: wait; }
    #secret-row { padding: 12px 16px 0; }
    #secret-row label { display: grid; gap: 6px; font-size: 13px; color: #a1a1aa; }
    input, textarea {
      width: 100%;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      background: #09090b;
      color: inherit;
      padding: 10px 12px;
    }
    #log {
      list-style: none;
      margin: 0;
      padding: 16px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #log li {
      max-width: 85%;
      padding: 10px 12px;
      border-radius: 16px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    #log .user { align-self: flex-end; background: #3b82f6; }
    #log .assistant { align-self: flex-start; background: #27272a; }
    #log .error { align-self: stretch; background: #3f1d1d; color: #fecaca; font-size: 14px; }
    #log .usage { margin-top: 6px; color: #a1a1aa; font-size: 11px; }
    #empty { color: #71717a; font-size: 14px; }
    form {
      display: flex;
      gap: 8px;
      padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
      border-top: 1px solid #2a2a2e;
      align-items: flex-end;
    }
    textarea { resize: none; min-height: 44px; }
    #status { min-height: 1.2em; padding: 0 16px 8px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Shop chat</h1>
        <p id="model-line"></p>
        <p id="totals">this chat · no tokens yet</p>
      </div>
      <button type="button" id="reset">New chat</button>
    </header>
    <div id="secret-row" hidden>
      <label>Admin secret
        <input id="secret" type="password" autocomplete="current-password">
      </label>
    </div>
    <ol id="log"><li id="empty">Message the same shop agent Instagram uses. Replies stay in this chat.</li></ol>
    <p id="status"></p>
    <form id="composer">
      <textarea id="text" rows="2" maxlength="1000" placeholder="Say hey"></textarea>
      <button type="submit" id="send">Send</button>
    </form>
  </main>
  <script id="boot" type="application/json">${boot}</script>
  <script>
    const boot = JSON.parse(document.getElementById("boot").textContent);
    const log = document.getElementById("log");
    const text = document.getElementById("text");
    const send = document.getElementById("send");
    const status = document.getElementById("status");
    const secretRow = document.getElementById("secret-row");
    const secret = document.getElementById("secret");
    const totals = document.getElementById("totals");
    let promptSum = 0;
    let completionSum = 0;
    let costSum = 0;
    let sawCost = false;
    document.getElementById("model-line").textContent =
      "Same agent as ManyChat. Replies here, not on Instagram.";
    secret.value = sessionStorage.getItem("try-admin-secret") || "";

    function sessionId() {
      let id = sessionStorage.getItem("try-session");
      if (!id) {
        id = crypto.randomUUID().replace(/-/g, "");
        sessionStorage.setItem("try-session", id);
      }
      return id;
    }

    function money(amount) {
      if (amount == null || !Number.isFinite(amount)) return "";
      return " · $" + (amount < 0.01 ? amount.toFixed(6) : amount.toFixed(4));
    }

    function usageNote(usage) {
      if (!usage) return "scripted · 0 tokens";
      promptSum += usage.promptTokens || 0;
      completionSum += usage.completionTokens || 0;
      if (usage.costUsd != null) {
        costSum += usage.costUsd;
        sawCost = true;
      }
      totals.textContent =
        "this chat · " + promptSum + " in · " + completionSum + " out" + (sawCost ? money(costSum) : "");
      const total = usage.totalTokens == null ? (usage.promptTokens || 0) + (usage.completionTokens || 0) : usage.totalTokens;
      return usage.promptTokens + " in · " + usage.completionTokens + " out · " + total + " total" + money(usage.costUsd);
    }

    function bubble(className, message, note) {
      const empty = document.getElementById("empty");
      if (empty) empty.remove();
      const item = document.createElement("li");
      item.className = className;
      item.textContent = message;
      if (note) {
        const line = document.createElement("div");
        line.className = "usage";
        line.textContent = note;
        item.append(line);
      }
      log.append(item);
      item.scrollIntoView({ block: "nearest" });
    }

    document.getElementById("reset").addEventListener("click", () => {
      sessionStorage.removeItem("try-session");
      sessionId();
      log.replaceChildren();
      const empty = document.createElement("li");
      empty.id = "empty";
      empty.textContent = "Message the same shop agent Instagram uses. Replies stay in this chat.";
      log.append(empty);
      promptSum = 0;
      completionSum = 0;
      costSum = 0;
      sawCost = false;
      totals.textContent = "this chat · no tokens yet";
      status.textContent = "";
      text.focus();
    });

    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = text.value.trim();
      if (!message || send.disabled) return;
      text.value = "";
      bubble("user", message);
      send.disabled = true;
      status.textContent = "Writing…";
      const headers = { "content-type": "application/json" };
      if (secret.value.trim()) headers.authorization = "Bearer " + secret.value.trim();
      try {
        const response = await fetch("/try/message", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId: sessionId(), text: message }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          secretRow.hidden = false;
          secret.focus();
          bubble("error", "This server wants the admin secret. Paste it above, then send again.");
          status.textContent = "";
          return;
        }
        if (!response.ok) {
          const creditError = /credits/i.test(payload.error || "");
          bubble("error", creditError ? payload.error : payload.detail || payload.error || "The model did not answer.");
          status.textContent = "";
          return;
        }
        sessionStorage.setItem("try-admin-secret", secret.value.trim());
        bubble("assistant", payload.reply || "", usageNote(payload.usage));
        status.textContent = "";
      } catch (error) {
        bubble("error", "The page could not reach the server.");
        status.textContent = "";
      } finally {
        send.disabled = false;
        text.focus();
      }
    });

    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("composer").requestSubmit();
      }
    });
    text.focus();
  </script>
</body>
</html>`;
}
