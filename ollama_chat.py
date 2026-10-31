"""Streaming chat with a local Ollama model, as an alternative to Claude.

Talks to Ollama's HTTP API (OLLAMA_URL, default http://localhost:11434). The OpenUI
system prompt alone is about 10k tokens, more than Ollama's default context window,
so every request sets num_ctx (OLLAMA_NUM_CTX, default 32768). Without it the
prompt would be cut off silently.
"""

import json
import os

import httpx2 as httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "32768"))


class OllamaError(Exception):
    pass


async def list_models() -> list[str] | None:
    """Names of the locally installed models, or None if Ollama isn't running."""
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            res = await client.get(f"{OLLAMA_URL}/api/tags")
            res.raise_for_status()
            return sorted(m["name"] for m in res.json().get("models", []))
    except (httpx.HTTPError, ValueError):
        return None


async def stream_chat(model: str, system: str, messages: list[dict], metrics: dict | None = None):
    """Yield the reply's text as it streams. Raises OllamaError with a readable message.

    If `metrics` is given, it's filled from Ollama's last chunk: prompt and output token counts
    and their durations (prompt_eval_count, eval_count, ... in nanoseconds).
    """
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        "stream": True,
        "options": {"num_ctx": NUM_CTX},
    }
    # No read timeout: a local model can take a while to load before the first token.
    timeout = httpx.Timeout(10, read=None)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=body) as res:
                if res.status_code != 200:
                    detail = (await res.aread()).decode(errors="replace")
                    try:
                        detail = json.loads(detail).get("error", detail)
                    except ValueError:
                        pass
                    raise OllamaError(f"Ollama error {res.status_code}: {detail}")
                # One JSON object per line: {"message": {"content": "..."}, "done": false}
                async for line in res.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if "error" in chunk:
                        raise OllamaError(f"Ollama error: {chunk['error']}")
                    if text := chunk.get("message", {}).get("content"):
                        yield text
                    if chunk.get("done") and metrics is not None:
                        metrics.update({k: v for k, v in chunk.items() if k.endswith(("_count", "_duration"))})
    except httpx.ConnectError:
        raise OllamaError(f"Could not reach Ollama at {OLLAMA_URL}. Is `ollama serve` running?")
