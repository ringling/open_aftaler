// The Gallery tab: every component the model can use, straight from the library's own spec
// (signature, description, group notes), with a live sample from examples/gallery.json.
import { library, createRoot, renderLang, button, openInPlayground } from "./core.js";

const section = document.getElementById("tab-gallery");
section.innerHTML = `
  <div class="gl-toolbar">
    <input class="pearl-well gl-search" type="search" placeholder="Search components" aria-label="Search components" />
    <span class="gl-count manual-hint"></span>
  </div>
  <div class="gl-groups"></div>`;
const groupsEl = section.querySelector(".gl-groups");
const search = section.querySelector(".gl-search");
const count = section.querySelector(".gl-count");

// Samples render only when scrolled into view: there are about 90 of them.
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); e.target.renderSample?.(); }
}, { rootMargin: "300px" });

function card(name, info, sample) {
  const el = document.createElement("article");
  el.className = "pearl-card gl-card";
  el.dataset.search = `${name} ${info.description ?? ""}`.toLowerCase();
  el.innerHTML = `
    <div class="gl-head"><h3 class="gl-name"></h3></div>
    <code class="gl-signature"></code>
    <p class="gl-description manual-hint"></p>
    <div class="gl-sample"></div>
    <div class="gl-actions"></div>
    <pre class="pearl-well code-panel__code gl-code" hidden></pre>`;
  el.querySelector(".gl-name").textContent = name;
  el.querySelector(".gl-signature").textContent = info.signature;
  el.querySelector(".gl-description").textContent = info.description ?? "";
  if (!sample) {
    el.querySelector(".gl-sample").remove();
    el.classList.add("gl-card--no-sample");
    return el;
  }
  const actions = el.querySelector(".gl-actions");
  const code = el.querySelector(".gl-code");
  code.textContent = sample;
  const show = actions.appendChild(button("Show code"));
  show.addEventListener("click", () => {
    code.hidden = !code.hidden;
    show.textContent = code.hidden ? "Show code" : "Hide code";
  });
  actions.appendChild(button("Open in playground")).addEventListener("click", () => openInPlayground(sample));

  // Render the sample; if it has errors, drop it and keep just the signature.
  el.renderSample = () => {
    const mount = el.querySelector(".gl-sample");
    let failed = false;
    renderLang(createRoot(mount), sample, {
      onError: (errors) => {
        if (failed || !errors?.length) return;
        failed = true;
        mount.remove();
        actions.remove();
        code.remove();
        el.classList.add("gl-card--no-sample");
      },
    });
  };
  observer.observe(el);
  return el;
}

async function build() {
  const spec = library.toSpec();
  let samples = {};
  try { samples = await (await fetch("/api/gallery")).json(); } catch {}
  const grouped = new Set(spec.componentGroups.flatMap((g) => g.components));
  const groups = [
    ...spec.componentGroups,
    { name: "Custom", components: Object.keys(spec.components).filter((n) => !grouped.has(n) && n !== spec.root),
      notes: ["Added by this app in static/components.js, styled with the Pearl design system."] },
    { name: "Layout root", components: [spec.root], notes: ["Every view starts with root = Card([...])."] },
  ];
  for (const group of groups) {
    const g = groupsEl.appendChild(document.createElement("section"));
    g.className = "gl-group";
    const h = g.appendChild(document.createElement("h2"));
    h.className = "gl-group-title";
    h.textContent = group.name;
    for (const note of group.notes ?? []) {
      const p = g.appendChild(document.createElement("p"));
      p.className = "manual-hint gl-note";
      p.textContent = note.replace(/^-\s*/, "");
    }
    const grid = g.appendChild(document.createElement("div"));
    grid.className = "gl-grid";
    for (const name of group.components) {
      if (spec.components[name]) grid.appendChild(card(name, spec.components[name], samples[name]));
    }
  }
  const total = Object.keys(spec.components).length;
  count.textContent = `${total} components · ${Object.keys(samples).filter((n) => spec.components[n]).length} with live samples`;
}

search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  for (const c of section.querySelectorAll(".gl-card")) c.hidden = q && !c.dataset.search.includes(q);
  for (const g of section.querySelectorAll(".gl-group")) g.hidden = ![...g.querySelectorAll(".gl-card")].some((c) => !c.hidden);
});

const built = build();
export async function show() { await built; }
