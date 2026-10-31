// The Saved views panel: list, open (into the chat) and delete views stored in SQLite.
import { button } from "./core.js";
import { showSavedView } from "./chat.js";

const panel = document.getElementById("views");
const list = panel.querySelector(".views-list");
const toggle = document.getElementById("views-toggle");

function setOpen(open) {
  panel.hidden = !open;
  toggle.setAttribute("aria-pressed", String(open));
  if (open) loadViews();
}

toggle.addEventListener("click", () => {
  if (!location.hash.startsWith("#/chat") && location.hash) location.hash = "#/chat";
  setOpen(panel.hidden);
});
document.addEventListener("views-changed", () => { if (!panel.hidden) loadViews(); });

async function loadViews() {
  const views = await (await fetch("/api/views")).json();
  list.replaceChildren();
  if (!views.length) {
    const empty = document.createElement("li");
    empty.className = "manual-hint";
    empty.textContent = "No saved views yet. Use \"Save view\" under a reply.";
    list.appendChild(empty);
  }
  for (const v of views) {
    const li = document.createElement("li");
    const text = li.appendChild(document.createElement("div"));
    text.className = "view-text";
    const title = text.appendChild(document.createElement("div"));
    title.className = "view-title";
    title.textContent = v.title;
    const meta = text.appendChild(document.createElement("div"));
    meta.className = "manual-hint";
    meta.textContent = `${new Date(v.created_at).toLocaleString()}${v.prompt ? ` · ${v.prompt.split("\n")[0]}` : ""}`;
    const open = li.appendChild(button("Open"));
    open.addEventListener("click", async () => {
      const view = await (await fetch(`/api/views/${v.id}`)).json();
      if (showSavedView(view)) setOpen(false);
    });
    const del = li.appendChild(button("Delete"));
    del.addEventListener("click", async () => {
      await fetch(`/api/views/${v.id}`, { method: "DELETE" });
      loadViews();
    });
    list.appendChild(li);
  }
}
