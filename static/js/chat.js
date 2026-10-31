// The Chat tab: ask a model for a UI, stream and render the reply, follow-ups, manual mode.
import {
  createRoot, ready, state, modelLabel, splitReply, renderLang, streamReply, showProgress,
  addReplyActions, addCodeButton, addSaveButton, addMeter, addPlaygroundButtons,
} from "./core.js";

const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const send = document.getElementById("send");
export const history = [];

// "Live code": while a reply streams in, show its code next to the UI being built.
const liveToggle = document.getElementById("live-toggle");
let liveCode = false;
function setLiveCode(on, save) {
  liveCode = on;
  liveToggle.setAttribute("aria-pressed", String(on));
  document.body.toggleAttribute("data-live-code", on);
  if (save) try { localStorage.setItem("live-code", on ? "on" : "off"); } catch {}
}
liveToggle.addEventListener("click", () => setLiveCode(!liveCode, true));
try { setLiveCode(localStorage.getItem("live-code") === "on", false); } catch {}

function startLiveCode(reply) {
  reply.bubble.classList.add("reply--live");
  const pre = document.createElement("pre");
  pre.className = "pearl-well live-code";
  pre.setAttribute("aria-label", "Code as it arrives");
  reply.bubble.insertBefore(pre, reply.mount);
  return {
    update(lang) {
      pre.replaceChildren(lang, Object.assign(document.createElement("span"), { className: "pg-caret" }));
      pre.scrollTop = pre.scrollHeight;
    },
    stop() { pre.remove(); reply.bubble.classList.remove("reply--live"); },
  };
}

function addBubble(cls) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  chat.appendChild(el);
  return el;
}

// An assistant bubble: the rendered UI, then (later) action buttons, then a notice line.
function newReply() {
  const bubble = addBubble("assistant pearl-card");
  const mount = bubble.appendChild(document.createElement("div"));
  const notice = bubble.appendChild(document.createElement("div"));
  notice.className = "notice";
  return { bubble, mount, notice, root: createRoot(mount) };
}

function render(reply, text, isStreaming) {
  const { lang, errors } = splitReply(text);
  renderLang(reply.root, lang, { isStreaming, onAction, onParseResult: (r) => { reply.parse = r; } });
  reply.notice.textContent = errors.join(" ");
}

// The buttons and the usage meter under a finished reply.
function finishReply(reply, prompt, result) {
  addSaveButton(reply.bubble, reply.notice, prompt, result.lang);
  addCodeButton(reply.bubble, reply.notice, result.lang);
  addPlaygroundButtons(reply.bubble, reply.notice, result.lang);
  addMeter(reply.bubble, reply.notice, result, () => reply.parse);
}

// Clicks on generated buttons/forms send a follow-up message.
function onAction(event) {
  if (event.type === "open_url") return window.open(event.params.url, "_blank", "noopener");
  if (send.disabled) return;
  let text = event.humanFriendlyMessage || event.type;
  if (event.params?.context !== undefined) {
    text += `\n\nContext: ${JSON.stringify(event.params.context)}`;
  }
  if (event.formState && Object.keys(event.formState).length) {
    text += `\n\nForm values: ${JSON.stringify(event.formState)}`;
  }
  ask(text);
}

export async function ask(text) {
  history.push({ role: "user", content: text });
  addBubble("user pearl-engrave").textContent = text;
  const reply = newReply();

  send.disabled = true;
  if (state.provider === "manual") return askManually(reply, text);
  const progress = showProgress(reply.bubble, reply.notice, modelLabel(state.provider));
  const live = liveCode ? startLiveCode(reply) : null;
  try {
    const result = await streamReply({
      provider: state.provider,
      messages: history,
      onText: (soFar) => {
        const { lang } = splitReply(soFar);
        if (lang.trim()) progress.writing();
        live?.update(lang);
        render(reply, soFar, true);
      },
    });
    progress.stop();
    live?.stop();
    render(reply, result.text, false);
    history.push({ role: "assistant", content: result.lang || "(no answer)" });
    if (result.lang.trim()) finishReply(reply, text, result);
  } catch (err) {
    reply.notice.textContent = `Request failed: ${err}`;
    history.pop();
  } finally {
    progress.stop();
    live?.stop();
    send.disabled = false;
    window.scrollTo(0, document.body.scrollHeight);
  }
}

// One paste-ready text: CLIs and chat UIs don't all accept a separate system prompt.
function buildRequest(systemPrompt) {
  const conversation = history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${m.content}`)
    .join("\n\n");
  return `<instructions>\n${systemPrompt}\n</instructions>\n\n<conversation>\n${conversation}\n</conversation>\n\n` +
    "Reply to the last user message. Output only OpenUI Lang: no prose, no code fences.";
}

// CLIs often wrap code in a fenced block; use its contents if there is one.
function cleanReply(text) {
  const fenced = text.match(/```[^\n]*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

async function askManually(reply, prompt) {
  const { bubble, notice } = reply;
  const panel = document.createElement("div");
  panel.className = "manual";
  panel.innerHTML = `
    <div class="manual-title">Manual mode</div>
    <div class="manual-hint">Copy the request into any CLI or chat (for example <code>claude -p</code>), then paste its reply below.</div>
    <textarea class="pearl-well manual-request" readonly aria-label="Request"></textarea>
    <div class="manual-actions"><button class="pearl-btn manual-copy" type="button">Copy request</button></div>
    <textarea class="pearl-well manual-reply" placeholder="Paste the reply here" aria-label="Reply"></textarea>
    <div class="manual-actions"><button class="pearl-btn pearl-btn--accent manual-render" type="button">Render reply</button></div>`;
  bubble.insertBefore(panel, notice);
  const requestBox = panel.querySelector(".manual-request");
  const replyBox = panel.querySelector(".manual-reply");
  const copyBtn = panel.querySelector(".manual-copy");
  requestBox.value = buildRequest(await ready);
  window.scrollTo(0, document.body.scrollHeight);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(requestBox.value);
      copyBtn.textContent = "Copied";
    } catch {
      requestBox.select();
      notice.textContent = "Copying isn't allowed here. The request is selected: press Ctrl+C.";
    }
  });

  panel.querySelector(".manual-render").addEventListener("click", () => {
    const text = cleanReply(replyBox.value);
    if (!text) {
      notice.textContent = "Paste a reply first.";
      return;
    }
    panel.remove();
    notice.textContent = "";
    render(reply, text, false);
    history.push({ role: "assistant", content: text });
    finishReply(reply, prompt, { lang: text });
    send.disabled = false;
  });
}

// Shows a saved view as a reply and adds it to the conversation, so follow-ups can refer to it.
export function showSavedView(view) {
  if (send.disabled) return false; // a reply is still in progress
  const text = `Show the saved view "${view.title}"`;
  history.push({ role: "user", content: text }, { role: "assistant", content: view.lang });
  addBubble("user pearl-engrave").textContent = text;
  const reply = newReply();
  render(reply, view.lang, false);
  addCodeButton(reply.bubble, reply.notice, view.lang);
  addPlaygroundButtons(reply.bubble, reply.notice, view.lang);
  addMeter(reply.bubble, reply.notice, { lang: view.lang }, () => reply.parse);
  const caption = addReplyActions(reply.bubble, reply.notice).appendChild(document.createElement("div"));
  caption.className = "reply-caption";
  caption.textContent = `Saved view · ${new Date(view.created_at).toLocaleString()}`;
  reply.bubble.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.value = "";
  ask(text);
});
