# OpenUI + Claude (Python)

A minimal [Thesys OpenUI](https://openui.com) generative-UI chat. Claude answers in
**OpenUI Lang**, and the browser renders it as live components (cards, tables, charts, forms).

- `main.py`: FastAPI server that streams Claude's reply (`claude-opus-5-5`).
- `ollama_chat.py`: streams replies from a local Ollama model.
- `db.py`: SQLite storage (`data/app.db`) for saved views and the example task list.
- `static/components.js`: custom components added to OpenUI's library: `Stats`, `Meter`, `Timeline`,
  `Facts` and a Kanban `Board`.
- `examples/views.json`: seven built-in example views, written by Claude, that use every component
  and tool, including two with interactive filters. They appear under **Saved views**.
- `examples/gallery.json`: a live sample for every component, written by Claude with
  `scripts/generate_gallery.py`, shown in the **Gallery** tab.
- `static/index.html`: the page, using the OpenUI CDN bundle (`@openuidev/browser-bundle`). No Node or
  build step. Its code is in `static/js/`: `core.js` (shared), `chat.js`, `playground.js`,
  `gallery.js`, `compare.js` and `main.js` (tabs, theme, model picker).

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # or: uv sync
cp .env.example .env                          # then put your key in .env
.venv/bin/uvicorn main:app --reload           # or: uv run uvicorn main:app --reload
```

**Choose who answers** with the dropdown in the header:

- **Claude**: needs `ANTHROPIC_API_KEY` in `.env`.
- **Ollama**: any model installed in a local [Ollama](https://ollama.com). Start it with
  `ollama serve` and install a model, for example `ollama pull qwen2.5-coder:7b`. The installed
  models appear in the dropdown. Set `OLLAMA_URL` if Ollama isn't on `http://localhost:11434`.
  Small local models follow the OpenUI format less reliably than Claude.
- **Manual (copy and paste)**: no key or local model needed. Each message shows the full request:
  copy it into any CLI or chat (for example `claude -p`, `codex exec`, `gemini -p` or claude.ai),
  then paste the reply back and click "Render reply".

Without a Claude key, the page starts with the first Ollama model, or with manual mode.

Open http://localhost:8000 and try:

- "Show a pricing table for 3 plans"
- "Make a signup form for a newsletter"
- "Bar chart of monthly sales for 2025 with made-up numbers"

- "Show my open tasks and let me add one" (uses the example tools in `tools.py`)

Clicking generated buttons or submitting generated forms sends a follow-up message. Generated UI
can also read and change data through **tools** (`tools.py`) without asking Claude again, and use
**custom components** (`static/components.js`) next to OpenUI's built-in ones.

Click **Show code** under a reply to see its OpenUI Lang, or **Save view** to store it. **Saved views** in the header lists them, and opening
one renders it again with live data, without asking Claude. Views and tasks are kept in SQLite at
`data/app.db` (set `APP_DB` to use another file).

## Showcase tabs

- **Chat**: ask for a UI and watch it stream in. Each reply has a **usage meter** (tokens, time to
  first text, tokens per second) and **Compare with JSON**, which counts the same UI as JSON with
  Claude's tokenizer. Turn on **Live code** to see the code arrive next to the UI as it builds.
- **Playground**: edit OpenUI Lang and see it render as you type, with parse errors listed.
  **Replay** streams the code back in slow motion. Open any reply or saved view here with
  **Open in playground** or **Replay**.
- **Gallery**: every component the model can use (91), with its signature, description and a live
  sample, straight from the component library.
- **Compare**: send one prompt to two models (Claude and Ollama models) and see both UIs side by
  side, with their meters and which was faster.

## How it works

For the full walkthrough, with a sequence diagram, see [docs/openui-flow.md](docs/openui-flow.md).
For one real request and response, end to end, see [docs/prompt-example.md](docs/prompt-example.md).

1. The page builds the system prompt in the browser with `openuiChatLibrary.prompt(...)`.
   This prompt teaches Claude the OpenUI Lang syntax and the built-in components.
2. Each message POSTs `{system, messages}` to `/api/chat`, which streams Claude's text back.
3. The page re-renders `<Renderer response=... isStreaming />` as chunks arrive.

**Note:** Sending the system prompt from the browser keeps this demo free of Node.
In a real app, generate it once (`npx @openuidev/cli generate ...`) and keep it on the
server, so clients can't change it.

## Design system: Pearl

The page uses the **Pearl** design system (light **Pearl** / dark **Glass** themes, Outfit type,
one sage-teal accent, engraved cards). The files are in `static/pearl/`:

- `tokens.json` and `bundle.css` are copied from the Pearl design system.
- `tokens.css` is generated from `tokens.json`. Regenerate it after refreshing the tokens:
  `python scripts/build_pearl_tokens.py`.
- `openui-pearl.css` points OpenUI's theme variables at Pearl tokens, so Claude's generated
  components follow both themes.
