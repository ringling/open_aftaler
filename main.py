"""Minimal OpenUI (Thesys) generative-UI chat backed by Claude.

The browser renders Claude's OpenUI Lang output with the OpenUI CDN bundle;
this server only forwards the conversation to Claude and streams the text back.
"""

from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import tools

MODEL = "claude-opus-5-5"
STATIC = Path(__file__).parent / "static"

load_dotenv(Path(__file__).parent / ".env")  # provides ANTHROPIC_API_KEY

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC), name="static")
client = anthropic.AsyncAnthropic()


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    # The OpenUI system prompt is generated in the browser from the component
    # library (see static/index.html). Fine for a local demo; a real app should
    # generate it once and keep it server-side.
    system: str
    messages: list[Message]


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/chat")
async def chat(req: ChatRequest):
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
