// Shared by every screen: the component library, tools and system prompt, reply parsing,
// rendering, streaming from /api/chat, and the buttons under a reply.
import { library } from "/static/components.js";
import { jsonEquivalent } from "./json-equivalent.js";

export { library };
export const { React, createRoot, Renderer } = window.__OpenUI;

// Tools are defined in tools.py. The server publishes their specs; the system prompt tells the
// model about them, and toolProvider runs Query()/Mutation() calls against the server directly,
// without asking the model again.
export const toolProvider = {};
export const ready = fetch("/api/tools")
  .then((res) => res.json())
  .then((tools) => {
    for (const { name } of tools) {
      toolProvider[name] = async (args) => {
        const res = await fetch(`/api/tools/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args ?? {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? `Tool ${name} failed`);
        return data;
      };
    }
    // The system prompt teaches the model OpenUI Lang, the built-in components and the tools.
    return library.prompt({
      preamble:
        "You are a helpful assistant. Answer every message with a rich, interactive UI. " +
        "Reply with OpenUI Lang only: start directly with the root line, with no text before or after it and no code fences. " +
        "Use sentence case, and at most one primary (accent) button per view; make other buttons secondary.",
      tools,
    });
  });

// Who answers in the chat: "claude", "ollama:<model>" or "manual". Set by the dropdown (main.js).
export const state = { provider: "manual" };

export const modelLabel = (provider) => (provider.startsWith("ollama:") ? provider.slice(7) : "Claude");

// The server appends "[error] ..." and "[meta] {json}" lines after the OpenUI Lang. Code-fence
// lines are dropped too: local models often wrap their answer in ``` even when told not to.
export function splitReply(text) {
  const lines = text.split("\n");
  const errors = lines.filter((l) => l.startsWith("[error]"));
  let meta = null;
  for (const l of lines) if (l.startsWith("[meta] ")) try { meta = JSON.parse(l.slice(7)); } catch {}
  let code = lines.filter((l) => !l.startsWith("[error]") && !l.startsWith("[meta] ") && !/^\s*```/.test(l));
  // A sentence of explanation before the code makes the whole reply unparseable, so start at "root =".
  const start = code.findIndex((l) => /^\s*root\s*=/.test(l));
  if (start > 0) code = code.slice(start);
  return { lang: code.join("\n"), errors: errors.map((e) => e.replace(/^\[error\]\s*/, "")), meta };
}

// Renders OpenUI Lang into a React root. Extra Renderer props (onParseResult, onError) pass through.
export function renderLang(root, lang, { isStreaming = false, onAction = () => {}, ...props } = {}) {
  root.render(React.createElement(Renderer, { response: lang, library, isStreaming, onAction, toolProvider, ...props }));
}

// Streams one reply from /api/chat. Calls onText(textSoFar) for every chunk and resolves with the
// parsed reply plus timings: { lang, errors, meta, firstTextMs, totalMs }.
export async function streamReply({ provider, messages, onText = () => {} }) {
  const started = performance.now();
  let firstTextMs = null;
  let text = "";
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system: await ready,
      messages,
      ...(provider.startsWith("ollama:") ? { provider: "ollama", model: provider.slice(7) } : { provider: "claude" }),
    }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (firstTextMs === null && splitReply(text).lang.trim()) firstTextMs = performance.now() - started;
    onText(text);
  }
  return { ...splitReply(text), text, firstTextMs, totalMs: performance.now() - started };
}

// A spinner with the model's name and elapsed seconds, shown while a reply is being generated:
// "Waiting for <model>…" until the first text arrives, then "<model> is writing…".
export function showProgress(container, before, model) {
  const row = document.createElement("div");
  row.className = "progress";
  row.setAttribute("role", "status");
  row.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="progress-text"></span>';
  container.insertBefore(row, before);
  const label = row.querySelector(".progress-text");
  const started = Date.now();
  let status = `Waiting for ${model}…`;
  const tick = () => { label.textContent = `${status} ${Math.floor((Date.now() - started) / 1000)}s`; };
  tick();
  const timer = setInterval(tick, 1000);
  return {
    writing() { status = `${model} is writing…`; tick(); },
    stop() { clearInterval(timer); row.remove(); },
  };
}

export function button(label, className = "pearl-btn") {
  const btn = document.createElement("button");
  btn.className = className;
  btn.type = "button";
  btn.textContent = label;
  return btn;
}

// Copies text; if the browser blocks the clipboard, selects `fallbackNode` and calls onBlocked.
export async function copyText(text, fallbackNode, onBlocked) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackNode) getSelection().selectAllChildren(fallbackNode);
    onBlocked?.();
    return false;
  }
}

// Title for a saved view: the first CardHeader title in the view, else the prompt that produced it.
export function viewTitle(lang, prompt) {
  const m = lang.match(/CardHeader\(\s*"((?:[^"\\]|\\.)*)"/);
  if (m) try { return JSON.parse(`"${m[1]}"`); } catch {}
  return prompt.split("\n")[0].slice(0, 80) || "Untitled view";
}

// The row of buttons under a reply (one per reply, shared by Save view, Show code and the rest).
export function addReplyActions(bubble, notice) {
  let row = bubble.querySelector(":scope > .reply-actions");
  if (!row) {
    row = document.createElement("div");
    row.className = "reply-actions";
    bubble.insertBefore(row, notice);
  }
  return row;
}

// "Show code" reveals the view's OpenUI Lang under the reply, with a Copy button.
export function addCodeButton(bubble, notice, lang) {
  const btn = button("Show code");
  btn.setAttribute("aria-expanded", "false");
  addReplyActions(bubble, notice).appendChild(btn);
  let panel = null;
  btn.addEventListener("click", () => {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "code-panel";
      panel.innerHTML = `
        <div class="code-panel__head"><span class="manual-title">OpenUI Lang</span>
          <button class="pearl-btn code-copy" type="button">Copy</button></div>
        <pre class="pearl-well code-panel__code"><code></code></pre>`;
      panel.querySelector("code").textContent = lang;
      const copy = panel.querySelector(".code-copy");
      copy.addEventListener("click", async () => {
        const ok = await copyText(lang, panel.querySelector("code"), () => {
          notice.textContent = "Copying isn't allowed here. The code is selected: press Ctrl+C.";
        });
        if (ok) copy.textContent = "Copied";
      });
      bubble.insertBefore(panel, notice);
    }
    const open = btn.getAttribute("aria-expanded") !== "true";
    panel.hidden = !open;
    btn.textContent = open ? "Hide code" : "Show code";
    btn.setAttribute("aria-expanded", String(open));
  });
}

// "Save view" stores the reply's OpenUI Lang in SQLite (see db.py). Dispatches "views-changed".
export function addSaveButton(bubble, notice, prompt, lang) {
  const btn = button("Save view");
  addReplyActions(bubble, notice).appendChild(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await saveView(viewTitle(lang, prompt), prompt, lang);
      btn.textContent = "Saved";
    } catch (err) {
      btn.disabled = false;
      notice.textContent = `Couldn't save the view: ${err.message}`;
    }
  });
}

export async function saveView(title, prompt, lang) {
  const res = await fetch("/api/views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, prompt, lang }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? res.status);
  document.dispatchEvent(new Event("views-changed"));
  return res.json();
}

// "Open in playground" and "Replay": hand the code to the playground tab.
export function openInPlayground(lang, { replay = false } = {}) {
  try { sessionStorage.setItem("playground-code", lang); } catch {}
  location.hash = replay ? "#/playground?replay" : "#/playground";
}

// Usage and speed under a reply, e.g. "412 output tokens · first text 1.7 s · 58 tok/s · 10.9k input
// (9.8k cached)", plus "Compare with JSON". `result` is what streamReply returned (or {lang} for
// a saved or pasted reply); getParse() returns the Renderer's latest parse result.
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());

export function describeUsage(result) {
  const m = result.meta;
  const parts = [];
  if (m?.output_tokens != null) parts.push(`${fmt(m.output_tokens)} output tokens`);
  if (result.firstTextMs != null) parts.push(`first text ${(result.firstTextMs / 1000).toFixed(1)} s`);
  // Tokens per second: Ollama measures generation itself; for Claude, time from first to last text.
  const seconds = m?.output_seconds || (result.firstTextMs != null ? (result.totalMs - result.firstTextMs) / 1000 : 0);
  if (m?.output_tokens && seconds > 0.05) parts.push(`${Math.round(m.output_tokens / seconds)} tok/s`);
  if (m?.input_tokens) parts.push(`${fmt(m.input_tokens)} input${m.cache_read_tokens ? ` (${fmt(m.cache_read_tokens)} cached)` : ""}`);
  return parts;
}

export function addMeter(bubble, notice, result, getParse) {
  const line = document.createElement("div");
  line.className = "meter-line";
  const usage = describeUsage(result);
  if (usage.length) line.append(usage.join(" · "), " · ");
  const link = line.appendChild(button("Compare with JSON", "link-btn"));
  bubble.insertBefore(line, notice);

  link.addEventListener("click", async () => {
    const json = jsonEquivalent(getParse());
    if (!json) { link.textContent = "Nothing to compare yet"; return; }
    link.disabled = true;
    link.textContent = "Counting…";
    try {
      const res = await fetch("/api/count-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texts: [result.lang, json] }),
      });
      const { counts: [lang, js], approximate } = await res.json();
      const about = approximate ? "≈" : "";
      const ratio = lang ? js / lang : 0;
      const verdict = ratio >= 1.05 ? `${ratio.toFixed(1)}× more` : ratio <= 0.95 ? `${(1 / ratio).toFixed(1)}× fewer` : "about the same";
      const summary = document.createElement("span");
      summary.className = "meter-compare";
      summary.textContent = `OpenUI Lang ${about}${fmt(lang)} tokens · same UI as JSON ${about}${fmt(js)} tokens (${verdict})`;
      const show = button("Show JSON", "link-btn");
      let pre = null;
      show.addEventListener("click", () => {
        if (!pre) {
          pre = document.createElement("pre");
          pre.className = "pearl-well code-panel__code json-panel";
          pre.textContent = JSON.stringify(JSON.parse(json), null, 2);
          line.after(pre);
        } else pre.hidden = !pre.hidden;
        show.textContent = pre.hidden ? "Show JSON" : "Hide JSON";
      });
      link.replaceWith(summary, " · ", show);
    } catch (err) {
      link.disabled = false;
      link.textContent = "Couldn't count tokens, try again";
    }
  });
  return line;
}

// "Open in playground" and "Replay" under a reply: both hand the code to the Playground tab.
export function addPlaygroundButtons(bubble, notice, lang) {
  const row = addReplyActions(bubble, notice);
  const open = row.appendChild(button("Open in playground"));
  open.addEventListener("click", () => openInPlayground(lang));
  const replay = row.appendChild(button("Replay"));
  replay.addEventListener("click", () => openInPlayground(lang, { replay: true }));
}
