// The Compare tab: send one prompt to two models at once and show both UIs side by side, each with
// its usage meter, plus a summary of which was faster and whether each reply parsed cleanly.
import {
  createRoot, renderLang, streamReply, showProgress, modelLabel, splitReply,
  addCodeButton, addMeter, addPlaygroundButtons,
} from "./core.js";

const section = document.getElementById("tab-compare");
section.innerHTML = `
  <form class="cmp-form pearl-glass">
    <input class="pearl-well cmp-prompt" placeholder="Try: show my open tasks as a Kanban board with a progress meter" aria-label="Prompt" />
    <select class="provider-select pearl-well cmp-model" data-side="0" aria-label="Left model"></select>
    <select class="provider-select pearl-well cmp-model" data-side="1" aria-label="Right model"></select>
    <button class="pearl-btn pearl-btn--accent cmp-run" type="submit">Run both</button>
  </form>
  <div class="cmp-summary manual-hint" role="status"></div>
  <div class="cmp-panes"><div class="cmp-pane"></div><div class="cmp-pane"></div></div>`;

const $ = (s) => section.querySelector(s);
const selects = [...section.querySelectorAll(".cmp-model")];
const panes = [...section.querySelectorAll(".cmp-pane")];
const runBtn = $(".cmp-run");
const summary = $(".cmp-summary");

async function loadModels() {
  let config = { api: false, ollama: { models: [] } };
  try { config = await (await fetch("/api/config")).json(); } catch {}
  const options = [
    ...(config.api ? [["claude", `Claude · ${config.claude_model}`]] : []),
    ...config.ollama.models.map((m) => [`ollama:${m}`, `Ollama · ${m}`]),
  ];
  const ollamaDefault = config.default?.startsWith("ollama:") && options.some(([v]) => v === config.default)
    ? config.default : options.find(([v]) => v.startsWith("ollama:"))?.[0];
  const defaults = [options[0]?.[0], ollamaDefault ?? options[1]?.[0] ?? options[0]?.[0]];
  selects.forEach((select, i) => {
    const current = select.value;
    select.replaceChildren(...options.map(([v, label]) => new Option(label, v)));
    select.value = options.some(([v]) => v === current) ? current : defaults[i] ?? "";
  });
  runBtn.disabled = !options.length;
  if (!options.length) summary.textContent = "No model is available: add a Claude API key or install an Ollama model.";
}

// One side: stream the reply, render it, then add the meter and code buttons.
async function runSide(pane, provider, prompt) {
  pane.replaceChildren();
  const card = pane.appendChild(document.createElement("div"));
  card.className = "pearl-card cmp-card";
  const title = card.appendChild(document.createElement("div"));
  title.className = "manual-title cmp-title";
  title.textContent = modelLabel(provider);
  const mount = card.appendChild(document.createElement("div"));
  const notice = card.appendChild(document.createElement("div"));
  notice.className = "notice";
  const root = createRoot(mount);
  const progress = showProgress(card, notice, modelLabel(provider));
  let parse = null, errors = [];
  const draw = (lang, isStreaming) => renderLang(root, lang, {
    isStreaming,
    onParseResult: (r) => { parse = r; },
    onError: (list) => { errors = [].concat(list || []); },
  });
  try {
    const result = await streamReply({
      provider,
      messages: [{ role: "user", content: prompt }],
      onText: (soFar) => {
        const { lang } = splitReply(soFar);
        if (lang.trim()) progress.writing();
        draw(lang, true);
      },
    });
    progress.stop();
    draw(result.lang, false);
    notice.textContent = result.errors.join(" ");
    await new Promise((r) => setTimeout(r, 400)); // let the final render report its errors
    if (result.lang.trim()) {
      addMeter(card, notice, result, () => parse);
      addCodeButton(card, notice, result.lang);
      addPlaygroundButtons(card, notice, result.lang);
    }
    if (!result.lang.trim()) return { provider, failed: true, reason: result.errors[0] ?? "empty reply" };
    return { provider, ok: !result.errors.length && !errors.length, errorCount: errors.length + result.errors.length, ...result };
  } catch (err) {
    progress.stop();
    notice.textContent = `Request failed: ${err}`;
    return { provider, failed: true, reason: String(err) };
  }
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
function summarize([a, b]) {
  const parts = [];
  if (!a.failed && !b.failed) {
    const [fast, slow] = a.totalMs <= b.totalMs ? [a, b] : [b, a];
    parts.push(`${modelLabel(fast.provider)} finished first (${secs(fast.totalMs)} vs ${secs(slow.totalMs)})`);
  }
  if (a.meta?.output_tokens && b.meta?.output_tokens) parts.push(`output tokens ${a.meta.output_tokens} vs ${b.meta.output_tokens}`);
  parts.push(...[a, b].map((r) => `${modelLabel(r.provider)}: ${r.failed ? "no reply (see its error)" : r.ok ? "parsed cleanly" : `${r.errorCount} render error${r.errorCount === 1 ? "" : "s"}`}`));
  return parts.join(" · ");
}

$(".cmp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $(".cmp-prompt").value.trim();
  if (!prompt || runBtn.disabled) return;
  runBtn.disabled = true;
  summary.textContent = "Running both…";
  const results = await Promise.all(panes.map((pane, i) => runSide(pane, selects[i].value, prompt)));
  summary.textContent = summarize(results);
  runBtn.disabled = false;
});

document.addEventListener("config-changed", loadModels);
const loaded = loadModels();
export async function show() { await loaded; }
