// Entry point: theme toggle, model dropdown and the tab router (#/chat, #/playground, ...).
import { state } from "./core.js";
import "./chat.js";
import "./views.js";

// Theme: Pearl (light) or Glass (dark). applyTheme is defined in index.html, before first paint.
const themeBtn = document.getElementById("theme");
function showTheme() {
  themeBtn.textContent = document.documentElement.dataset.theme === "glass" ? "Light theme" : "Dark theme";
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "glass" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("theme", next); } catch {}
  showTheme();
});
showTheme();

// Who answers in the chat: "claude", "ollama:<model>" (a local Ollama model) or "manual" (copy the
// request into any CLI or chat and paste the reply back). The server says which are available.
const providerSelect = document.getElementById("provider");
export function setProvider(value, save) {
  state.provider = value;
  providerSelect.value = value;
  if (save) try { localStorage.setItem("provider", value); } catch {}
}
providerSelect.addEventListener("change", () => setProvider(providerSelect.value, true));

function addOption(value, label, disabled = false) {
  const opt = providerSelect.appendChild(document.createElement("option"));
  opt.value = value;
  opt.textContent = label;
  opt.disabled = disabled;
}

// Rebuilds the dropdown from /api/config. Runs on load and again whenever you come back to the
// tab, so models pulled or removed in Ollama show up without a reload.
let lastConfig = "";
async function loadProviders(refresh = false) {
  let config = { api: false, claude_model: "Claude", ollama: { running: false, models: [] } };
  try { config = await (await fetch("/api/config")).json(); } catch {}
  if (refresh && JSON.stringify(config) === lastConfig) return; // nothing changed
  lastConfig = JSON.stringify(config);
  document.dispatchEvent(new CustomEvent("config-changed", { detail: config }));

  providerSelect.replaceChildren();
  addOption("claude", config.api ? `Claude · ${config.claude_model}` : "Claude (no API key)", !config.api);
  if (!config.ollama.running) addOption("ollama", "Ollama (not running)", true);
  else if (!config.ollama.models.length) addOption("ollama", "Ollama (no models installed)", true);
  for (const m of config.ollama.models) addOption(`ollama:${m}`, `Ollama · ${m}`);
  addOption("manual", "Manual (copy and paste)");
  const usable = [...providerSelect.options].filter((o) => !o.disabled).map((o) => o.value);

  // Which to select, in order:
  // 1. A new server default (DEFAULT_MODEL) wins once, as soon as it's actually available.
  // 2. The choice saved in this browser (every pick in the dropdown is saved).
  // 3. A fallback: Claude, else the first Ollama model, else manual. A fallback isn't saved, so
  //    the real choice comes back once it's available again.
  let saved = null, seenDefault = null;
  try {
    saved = localStorage.getItem("provider") ?? (localStorage.getItem("mode") === "manual" ? "manual" : null);
    seenDefault = localStorage.getItem("providerDefault");
  } catch {}
  if (usable.includes(config.default) && seenDefault !== config.default) {
    try { localStorage.setItem("providerDefault", config.default); } catch {}
    return setProvider(config.default, true);
  }
  if (usable.includes(saved)) return setProvider(saved, false);
  setProvider(config.api ? "claude" : config.ollama.models.length ? `ollama:${config.ollama.models[0]}` : "manual", false);
}
loadProviders();
window.addEventListener("focus", () => loadProviders(true));
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadProviders(true); });

// Tabs. Each tab is a <section id="tab-NAME">; the other screens load the first time they're shown.
const screens = {
  playground: () => import("./playground.js"),
  gallery: () => import("./gallery.js"),
  compare: () => import("./compare.js"),
};
const loaded = {};
async function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || "chat";
  const tab = document.getElementById(`tab-${name}`) ? name : "chat";
  document.body.dataset.tab = tab;
  for (const section of document.querySelectorAll(".tab")) section.hidden = section.id !== `tab-${tab}`;
  for (const link of document.querySelectorAll(".tabs a")) {
    link.setAttribute("aria-current", link.dataset.tab === tab ? "page" : "false");
  }
  if (screens[tab]) {
    loaded[tab] ??= screens[tab]();
    (await loaded[tab]).show?.(location.hash);
  }
}
window.addEventListener("hashchange", route);
route();
