"""Minimal OpenUI (Thesys) generative-UI chat backed by Claude or a local Ollama model.

The browser renders the model's OpenUI Lang output with the OpenUI CDN bundle;
this server only forwards the conversation to the model and streams the text back.
"""

import os
import re
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import ollama_chat
import tools

MODEL = "claude-opus-5-5"
STATIC = Path(__file__).parent / "static"

load_dotenv(Path(__file__).parent / ".env")  # provides ANTHROPIC_API_KEY

db.init()

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def revalidate_static(request, call_next):
    """Make browsers check for changed CSS/JS on every load (an unchanged file is a cheap 304)."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


client = anthropic.AsyncAnthropic()


class NewView(BaseModel):
    title: str
    prompt: str = ""
    lang: str


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    # The OpenUI system prompt is generated in the browser from the component
    # library (see static/index.html). Fine for a local demo; a real app should
    # generate it once and keep it server-side.
    system: str
    messages: list[Message]
    provider: str = "claude"  # "claude" or "ollama"
    model: str | None = None  # the Ollama model name


@app.get("/")
async def index():
    """The page, with a version on each /static/ link so browsers never reuse an outdated file."""
    def versioned(m):
        path = STATIC / m.group(1)
        return f"/static/{m.group(1)}?v={int(path.stat().st_mtime)}" if path.is_file() else m.group(0)

    html = (STATIC / "index.html").read_text()
    return HTMLResponse(re.sub(r"/static/([\w./-]+\.(?:css|js))", versioned, html))


@app.get("/api/config")
async def config():
    """Which models the page can offer: Claude (if there's a key) and installed Ollama models."""
    models = await ollama_chat.list_models()
    return {
        "api": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "claude_model": MODEL,
        "ollama": {"running": models is not None, "models": models or [], "url": ollama_chat.OLLAMA_URL},
        # What the page starts with: "claude", "ollama:<model>" or "manual" (DEFAULT_MODEL in .env).
        "default": os.environ.get("DEFAULT_MODEL", ""),
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if req.provider == "ollama":
        return StreamingResponse(chat_ollama(req), media_type="text/plain; charset=utf-8")
    if req.provider != "claude":
        raise HTTPException(400, f"Unknown provider: {req.provider}")

    async def generate():
        try:
            async with client.beta.messages.stream(
                model=MODEL,
                max_tokens=64000,
                system=req.system,
                messages=[m.model_dump() for m in req.messages],
                output_config={"effort": "low"},  # UI replies should be quick
                # Retry on a substitute model if a safety classifier declines.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
                if final.stop_reason == "refusal":
                    yield "\n[error] Claude declined this request."
        except anthropic.RateLimitError:
            yield "\n[error] Rate limited, please retry shortly."
        except anthropic.APIStatusError as e:
            yield f"\n[error] Claude API error {e.status_code}: {e.message}"
        except anthropic.APIConnectionError:
            yield "\n[error] Could not reach the Claude API."

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")


async def chat_ollama(req: ChatRequest):
    if not req.model:
        yield "\n[error] Choose an Ollama model."
        return
    try:
        async for text in ollama_chat.stream_chat(req.model, req.system, [m.model_dump() for m in req.messages]):
            yield text
    except ollama_chat.OllamaError as e:
        yield f"\n[error] {e}"


@app.get("/api/tools")
async def list_tools():
    """Tool specs for the page: they go in the system prompt and the toolProvider."""
    return tools.specs()


@app.post("/api/tools/{name}")
async def call_tool(name: str, args: dict = Body(default={})):
    """Run one tool for a Query() or Mutation() in the generated UI."""
    tool = tools.TOOLS.get(name)
    if tool is None:
        raise HTTPException(404, f"Unknown tool: {name}")
    try:
        return tool["fn"](**args)
    except (TypeError, ValueError) as e:  # wrong or invalid arguments
        raise HTTPException(400, str(e))


@app.get("/api/views")
async def list_views():
    """Saved views, newest first (without their OpenUI Lang)."""
    return db.list_views()


@app.get("/api/views/{view_id}")
async def get_view(view_id: int):
    view = db.get_view(view_id)
    if view is None:
        raise HTTPException(404, "View not found")
    return view


@app.post("/api/views", status_code=201)
async def save_view(view: NewView):
    """Save a generated UI so it can be re-rendered later without asking Claude."""
    if not view.lang.strip():
        raise HTTPException(400, "lang is required")
    title = view.title.strip()[:200] or "Untitled view"
    return db.add_view(title, view.prompt, view.lang)


@app.delete("/api/views/{view_id}", status_code=204)
async def delete_view(view_id: int):
    if not db.delete_view(view_id):
        raise HTTPException(404, "View not found")
