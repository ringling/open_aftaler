"""Example UI-side tools for OpenUI: a small task list, stored in SQLite (db.py).

Generated UI calls these directly from the browser with Query() (read) and
Mutation() (write), without another round trip to Claude. Each tool's specs are
published to the page, which puts them in the system prompt and wires them into
the Renderer's toolProvider.
"""

import db

PRIORITIES = ["low", "medium", "high"]
STATUSES = ["open", "done"]

TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
        "title": {"type": "string"},
        "priority": {"type": "string", "enum": PRIORITIES},
        "status": {"type": "string", "enum": STATUSES},
    },
}


def list_tasks(status: str | None = None) -> dict:
    if status not in (None, "", *STATUSES):
        raise ValueError(f"status must be one of {STATUSES}")
    return {"rows": db.list_tasks(status or None)}


def add_task(title: str, priority: str = "medium") -> dict:
    if not isinstance(title, str) or not title.strip():
        raise ValueError("title is required")
    if priority not in PRIORITIES:
        raise ValueError(f"priority must be one of {PRIORITIES}")
    return {"task": db.add_task(title.strip(), priority)}


TOOLS = {
    "list_tasks": {
        "fn": list_tasks,
        "description": "List tasks in the team's task list, optionally filtered by status.",
        "inputSchema": {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": STATUSES}},
        },
        "outputSchema": {
            "type": "object",
            "properties": {"rows": {"type": "array", "items": TASK_SCHEMA}},
        },
    },
    "add_task": {
        "fn": add_task,
        "description": "Add an open task to the task list.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": PRIORITIES},
            },
            "required": ["title"],
        },
        "outputSchema": {"type": "object", "properties": {"task": TASK_SCHEMA}},
    },
}


def specs() -> list[dict]:
    """Tool descriptions in the shape OpenUI's prompt() expects."""
    return [{"name": name, **{k: v for k, v in t.items() if k != "fn"}} for name, t in TOOLS.items()]
