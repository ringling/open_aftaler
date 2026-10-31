"""SQLite storage for saved views and the example task list.

One file, data/app.db by default (override with APP_DB). The tables are created on
first use, and the task list is seeded with three example tasks when it's empty.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("APP_DB", Path(__file__).parent / "data" / "app.db"))
EXAMPLES = Path(__file__).parent / "examples" / "views.json"  # built-in example views

SCHEMA = """
CREATE TABLE IF NOT EXISTS views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    prompt     TEXT NOT NULL DEFAULT '',  -- the user message that produced the view
    lang       TEXT NOT NULL,             -- the OpenUI Lang to render
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    priority   TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    created_at TEXT
);
-- Titles of the built-in example views already added, so a deleted example stays deleted.
CREATE TABLE IF NOT EXISTS seeded_examples (
    title TEXT PRIMARY KEY
);
"""

NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"

# (title, priority, status, created N days ago)
SEED_TASKS = [
    ("Write the launch post", "high", "open", 3),
    ("Review pricing page", "medium", "open", 7),
    ("Set up error alerts", "low", "done", 14),
]


@contextmanager
def connect():
    """A short-lived connection per operation; commits on success."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        # Databases from before tasks had created_at: add the column and date existing tasks today.
        if "created_at" not in [c["name"] for c in conn.execute("PRAGMA table_info(tasks)")]:
            conn.execute("ALTER TABLE tasks ADD COLUMN created_at TEXT")
        conn.execute(f"UPDATE tasks SET created_at = {NOW} WHERE created_at IS NULL")
        if conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0:
            conn.executemany(
                "INSERT INTO tasks (title, priority, status, created_at) "
                "VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' days'))",
                SEED_TASKS,
            )
        seed_examples(conn)


def seed_examples(conn):
    """Add each example view from examples/views.json once (newest list order shows first)."""
    if not EXAMPLES.is_file():
        return
    seeded = {r[0] for r in conn.execute("SELECT title FROM seeded_examples")}
    for view in reversed(json.loads(EXAMPLES.read_text())):
        if view["title"] in seeded:
            continue
        conn.execute("INSERT INTO views (title, prompt, lang) VALUES (?, ?, ?)", (view["title"], view["prompt"], view["lang"]))
        conn.execute("INSERT INTO seeded_examples (title) VALUES (?)", (view["title"],))


# Views

def list_views() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT id, title, prompt, created_at FROM views ORDER BY id DESC")
        return [dict(r) for r in rows]


def get_view(view_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM views WHERE id = ?", (view_id,)).fetchone()
        return dict(row) if row else None


def add_view(title: str, prompt: str, lang: str) -> dict:
    with connect() as conn:
        cur = conn.execute("INSERT INTO views (title, prompt, lang) VALUES (?, ?, ?)", (title, prompt, lang))
        view_id = cur.lastrowid
    return get_view(view_id)


def delete_view(view_id: int) -> bool:
    with connect() as conn:
        return conn.execute("DELETE FROM views WHERE id = ?", (view_id,)).rowcount > 0


# Tasks

def list_tasks(status: str | None = None) -> list[dict]:
    with connect() as conn:
        if status:
            rows = conn.execute("SELECT * FROM tasks WHERE status = ? ORDER BY id", (status,))
        else:
            rows = conn.execute("SELECT * FROM tasks ORDER BY id")
        return [dict(r) for r in rows]


def get_task(task_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(row) if row else None


def add_task(title: str, priority: str) -> dict:
    with connect() as conn:
        cur = conn.execute(f"INSERT INTO tasks (title, priority, created_at) VALUES (?, ?, {NOW})", (title, priority))
        task_id = cur.lastrowid
    return get_task(task_id)


def update_task(task_id: int, fields: dict) -> dict | None:
    """Update some of title, priority and status (the keys are checked by the caller)."""
    with connect() as conn:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE tasks SET {sets} WHERE id = ?", (*fields.values(), task_id))
    return get_task(task_id)


def delete_task(task_id: int) -> bool:
    with connect() as conn:
        return conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,)).rowcount > 0
