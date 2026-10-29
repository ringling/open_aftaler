"""SQLite storage for saved views and the example task list.

One file, data/app.db by default (override with APP_DB). The tables are created on
first use, and the task list is seeded with three example tasks when it's empty.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("APP_DB", Path(__file__).parent / "data" / "app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    prompt     TEXT NOT NULL DEFAULT '',  -- the user message that produced the view
    lang       TEXT NOT NULL,             -- the OpenUI Lang to render
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS tasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title    TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    status   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done'))
);
"""

SEED_TASKS = [
    ("Write the launch post", "high", "open"),
    ("Review pricing page", "medium", "open"),
    ("Set up error alerts", "low", "done"),
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
        if conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0:
            conn.executemany("INSERT INTO tasks (title, priority, status) VALUES (?, ?, ?)", SEED_TASKS)


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


def add_task(title: str, priority: str) -> dict:
    with connect() as conn:
        cur = conn.execute("INSERT INTO tasks (title, priority) VALUES (?, ?)", (title, priority))
        return dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone())
