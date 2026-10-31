// The Playground tab: edit OpenUI Lang on the left and see it render live on the right.
// "Replay" streams the code into the preview chunk by chunk, the way a model's reply arrives.
import { createRoot, renderLang, button, copyText, saveView, viewTitle } from "./core.js";

const section = document.getElementById("tab-playground");
section.innerHTML = `
  <div class="pg-toolbar">
    <select class="pg-examples provider-select pearl-well" aria-label="Load a saved view"></select>
    <span class="pg-spacer"></span>
    <select class="pg-speed provider-select pearl-well" aria-label="Replay speed">
      <option value="fast">Fast</option><option value="normal" selected>Normal</option><option value="slow">Slow motion</option>
    </select>
    <button class="pearl-btn pearl-btn--accent pg-replay" type="button">Replay</button>
    <button class="pearl-btn pg-copy" type="button">Copy</button>
    <button class="pearl-btn pg-save" type="button">Save view</button>
  </div>
  <div class="pg-panes">
    <div class="pg-editor-wrap">
      <textarea class="pearl-well pg-editor" spellcheck="false" aria-label="OpenUI Lang"></textarea>
      <pre class="pearl-well pg-replay-code" hidden aria-hidden="true"></pre>
    </div>
    <div class="pg-preview-wrap">
      <div class="pearl-card pg-preview"></div>
      <ul class="pg-errors" aria-live="polite"></ul>
      <div class="pg-status" role="status"></div>
    </div>
  </div>`;

const $ = (s) => section.querySelector(s);
const editor = $(".pg-editor");
const replayCode = $(".pg-replay-code");
const errorsList = $(".pg-errors");
const examples = $(".pg-examples");
const root = createRoot($(".pg-preview"));
// Status messages (saved, copy blocked, ...) get their own line; the error list is redrawn on every render.
const notice = (text) => { $(".pg-status").textContent = text; };

const STARTER = `root = Card([header, stats, meter, board])
header = CardHeader("Playground", "Edit the code on the left and watch this update")
stats = Stats([Stat("3", "Open tasks"), Stat("67%", "Done this week")])
meter = Meter("Sprint progress", 7, 10, "Three tasks to go")
board = Board([Column("Open", ["Write the launch post", "Review pricing page"], ["high", "medium"]), Column("Done", ["Set up error alerts"], ["low"])])
`;

// Render the code; collect parse and runtime errors under the preview. While replaying, errors are
// expected (the code is incomplete), so they're only shown for the finished code.
let errors = [];
function renderCode(code, isStreaming = false) {
  errors = [];
  renderLang(root, code, {
    isStreaming,
    onAction: (e) => { if (e.type === "open_url") window.open(e.params.url, "_blank", "noopener"); else notice("Buttons that send a message only work in the Chat tab."); },
    onError: (list) => { errors = [].concat(list || []); showErrors(); },
  });
  if (!isStreaming) setTimeout(showErrors, 300);
}
function showErrors() {
  if (replaying) return;
  errorsList.replaceChildren(...errors.map((e) => {
    const li = document.createElement("li");
    li.textContent = `${e.message ?? e.code ?? "Error"}${e.hint ? ` (${e.hint})` : ""}`;
    return li;
  }));
}

let timer = null;
editor.addEventListener("input", () => {
  try { sessionStorage.setItem("playground-draft", editor.value); } catch {}
  clearTimeout(timer);
  timer = setTimeout(() => renderCode(editor.value), 150);
});

// Replay: show the code being "typed" with a caret, and render each partial version with
// isStreaming on, exactly like a streamed reply. Chunk sizes roughly match model tokens.
const SPEEDS = { fast: [40, 30], normal: [12, 30], slow: [3, 45] }; // [characters per step, ms per step]
let replaying = false;
async function replay() {
  if (replaying) { replaying = false; return; } // a second click stops it
  const code = editor.value;
  const [step, delay] = SPEEDS[$(".pg-speed").value];
  replaying = true;
  $(".pg-replay").textContent = "Stop";
  editor.hidden = true;
  replayCode.hidden = false;
  errorsList.replaceChildren();
  for (let pos = 0; pos <= code.length && replaying; pos += step) {
    const soFar = code.slice(0, pos);
    replayCode.innerHTML = "";
    replayCode.append(soFar, Object.assign(document.createElement("span"), { className: "pg-caret" }));
    replayCode.scrollTop = replayCode.scrollHeight;
    renderCode(soFar, true);
    await new Promise((r) => setTimeout(r, delay));
  }
  replaying = false;
  $(".pg-replay").textContent = "Replay";
  replayCode.hidden = true;
  editor.hidden = false;
  renderCode(code);
}
$(".pg-replay").addEventListener("click", replay);

$(".pg-copy").addEventListener("click", async (e) => {
  if (await copyText(editor.value, null, () => { editor.select(); notice("Copying isn't allowed here. The code is selected: press Ctrl+C."); })) {
    e.target.textContent = "Copied";
    setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
  }
});

$(".pg-save").addEventListener("click", async (e) => {
  try {
    const view = await saveView(viewTitle(editor.value, "Playground"), "Made in the playground", editor.value);
    e.target.textContent = "Saved";
    notice(`Saved as "${view.title}". It's in Saved views on the Chat tab.`);
    setTimeout(() => { e.target.textContent = "Save view"; }, 1500);
    loadExamples();
  } catch (err) {
    notice(`Couldn't save the view: ${err.message}`);
  }
});

// The dropdown lists saved views (including the built-in examples).
async function loadExamples() {
  const views = await (await fetch("/api/views")).json();
  examples.replaceChildren(new Option("Load a saved view…", ""), new Option("Starter example", "starter"),
    ...views.map((v) => new Option(v.title, v.id)));
}
examples.addEventListener("change", async () => {
  const id = examples.value;
  examples.value = "";
  if (!id) return;
  load(id === "starter" ? STARTER : (await (await fetch(`/api/views/${id}`)).json()).lang);
});

function load(code) {
  editor.value = code;
  try { sessionStorage.setItem("playground-draft", code); } catch {}
  renderCode(code);
}

// Called by the router each time the tab is shown. Code handed over by "Open in playground" or
// "Replay" (see core.js) takes priority over the draft from last time.
export function show(hash) {
  let incoming = null, draft = null;
  try {
    incoming = sessionStorage.getItem("playground-code");
    sessionStorage.removeItem("playground-code");
    draft = sessionStorage.getItem("playground-draft");
  } catch {}
  if (incoming != null) load(incoming);
  else if (!editor.value) load(draft || STARTER);
  if (hash.includes("?replay") && incoming != null) replay();
}

loadExamples();
