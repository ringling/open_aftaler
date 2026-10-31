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
        "created_at": {"type": "string", "description": "ISO 8601 date and time"},
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


def _task_id(id) -> int:
    if isinstance(id, bool) or not isinstance(id, (int, float, str)) or not str(id).isdigit():
        raise ValueError("id must be a task id")
    return int(id)


def get_task(id: int | None = None) -> dict:
    # Queries run as soon as a view renders, often before anything is picked: no id means no task.
    if id in (None, "", 0, "0"):
        return {"task": {}}
    task = db.get_task(_task_id(id))
    if task is None:
        raise ValueError(f"no task with id {id}")
    return {"task": task}


def update_task(id: int, title: str | None = None, priority: str | None = None, status: str | None = None) -> dict:
    fields = {}
    if title is not None:
        if not isinstance(title, str) or not title.strip():
            raise ValueError("title can't be empty")
        fields["title"] = title.strip()
    if priority is not None:
        if priority not in PRIORITIES:
            raise ValueError(f"priority must be one of {PRIORITIES}")
        fields["priority"] = priority
    if status is not None:
        if status not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        fields["status"] = status
    if not fields:
        raise ValueError("give at least one of title, priority or status")
    task = db.update_task(_task_id(id), fields)
    if task is None:
        raise ValueError(f"no task with id {id}")
    return {"task": task}


def delete_task(id: int) -> dict:
    if not db.delete_task(_task_id(id)):
        raise ValueError(f"no task with id {id}")
    return {"deleted": True}


def task_summary() -> dict:
    tasks = db.list_tasks()
    done = sum(t["status"] == "done" for t in tasks)
    open_tasks = [t for t in tasks if t["status"] == "open"]
    return {
        "total": len(tasks),
        "open": len(open_tasks),
        "done": done,
        "percent_done": round(100 * done / len(tasks)) if tasks else 0,
        "open_by_priority": {p: sum(t["priority"] == p for t in open_tasks) for p in PRIORITIES},
    }


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
    "get_task": {
        "fn": get_task,
        "description": "Get one task by id, with all its details.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]},
        "outputSchema": {"type": "object", "properties": {"task": TASK_SCHEMA}},
    },
    "update_task": {
        "fn": update_task,
        "description": "Change a task's title, priority or status. Set status to \"done\" to complete it, or \"open\" to reopen it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": PRIORITIES},
                "status": {"type": "string", "enum": STATUSES},
            },
            "required": ["id"],
        },
        "outputSchema": {"type": "object", "properties": {"task": TASK_SCHEMA}},
    },
    "delete_task": {
        "fn": delete_task,
        "description": "Delete a task permanently.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]},
        "outputSchema": {"type": "object", "properties": {"deleted": {"type": "boolean"}}},
    },
    "task_summary": {
        "fn": task_summary,
        "description": "Counts for the task list: total, open, done, percent done, and open tasks per priority.",
        "inputSchema": {"type": "object", "properties": {}},
        "outputSchema": {
            "type": "object",
            "properties": {
                "total": {"type": "integer"},
                "open": {"type": "integer"},
                "done": {"type": "integer"},
                "percent_done": {"type": "integer"},
                "open_by_priority": {
                    "type": "object",
                    "properties": {p: {"type": "integer"} for p in PRIORITIES},
                },
            },
        },
    },
}


def specs() -> list[dict]:
    """Tool descriptions in the shape OpenUI's prompt() expects."""
    return [{"name": name, **{k: v for k, v in t.items() if k != "fn"}} for name, t in TOOLS.items()]
