"""Tests for backfill_toggl_ids.backfill: name match fills, ambiguous->NULL,
absent->NULL, no-overwrite, latest-only / Failed-Held-only. Uses an in-memory
sqlite DB and a stub mappings dict (the function is pure DB work)."""
import sqlite3

import backfill_toggl_ids


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute(
        """CREATE TABLE sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            toggl_entry_id TEXT, status TEXT,
            toggl_user TEXT, toggl_project TEXT, toggl_task TEXT,
            toggl_user_id TEXT, toggl_project_id TEXT, toggl_task_id TEXT
        )"""
    )
    return c


def _insert(c, **f):
    cols = ["toggl_entry_id", "status", "toggl_user", "toggl_project", "toggl_task",
            "toggl_user_id", "toggl_project_id", "toggl_task_id"]
    vals = [f.get(k) for k in cols]
    c.execute(f"INSERT INTO sync_log ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
    c.commit()


MAPPINGS = {
    "users": {"5499537": {"qboEmployeeName": "Philip Lupo"}},
    "projects": {"199999595": {"qboProjectName": "Nosferatu 2026"}},
    "tasks": {
        "240569251": {"togglTaskName": "APM"},
        # ambiguous: two toggl ids share the same togglTaskName
        "300000001": {"togglTaskName": "Electrics"},
        "300000002": {"togglTaskName": "Electrics"},
    },
}


def _row(c, entry_id):
    return c.execute("SELECT * FROM sync_log WHERE toggl_entry_id=? ORDER BY id DESC LIMIT 1", (entry_id,)).fetchone()


def test_name_match_fills_ids():
    c = _conn()
    _insert(c, toggl_entry_id="1", status="Failed", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM")
    filled = backfill_toggl_ids.backfill(c, MAPPINGS)
    r = _row(c, "1")
    assert r["toggl_user_id"] == "5499537"
    assert r["toggl_project_id"] == "199999595"
    assert r["toggl_task_id"] == "240569251"
    assert filled == {"user": 1, "project": 1, "task": 1}


def test_ambiguous_name_left_null():
    c = _conn()
    _insert(c, toggl_entry_id="2", status="Held", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="Electrics")
    backfill_toggl_ids.backfill(c, MAPPINGS)
    r = _row(c, "2")
    assert r["toggl_task_id"] is None  # 'Electrics' maps to 2 ids -> ambiguous
    assert r["toggl_user_id"] == "5499537"


def test_absent_name_left_null():
    c = _conn()
    _insert(c, toggl_entry_id="3", status="Failed", toggl_user="Nobody",
            toggl_project="Ghost Project", toggl_task="Nonexistent")
    backfill_toggl_ids.backfill(c, MAPPINGS)
    r = _row(c, "3")
    assert r["toggl_user_id"] is None
    assert r["toggl_project_id"] is None
    assert r["toggl_task_id"] is None


def test_blank_name_left_null():
    c = _conn()
    _insert(c, toggl_entry_id="4", status="Failed", toggl_user="Philip Lupo",
            toggl_project="", toggl_task="")
    backfill_toggl_ids.backfill(c, MAPPINGS)
    r = _row(c, "4")
    assert r["toggl_user_id"] == "5499537"
    assert r["toggl_project_id"] is None
    assert r["toggl_task_id"] is None


def test_no_overwrite_existing_id():
    c = _conn()
    _insert(c, toggl_entry_id="5", status="Failed", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM",
            toggl_user_id="OLD", toggl_project_id="OLD", toggl_task_id="OLD")
    filled = backfill_toggl_ids.backfill(c, MAPPINGS)
    r = _row(c, "5")
    assert r["toggl_user_id"] == "OLD"
    assert r["toggl_project_id"] == "OLD"
    assert r["toggl_task_id"] == "OLD"
    assert filled == {"user": 0, "project": 0, "task": 0}


def test_only_failed_held_and_latest_row():
    c = _conn()
    # entry 6: an older Failed row then a newer Success row -> latest is Success,
    # so it must NOT be backfilled.
    _insert(c, toggl_entry_id="6", status="Failed", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM")
    _insert(c, toggl_entry_id="6", status="Success", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM")
    # entry 7: latest row is 'Already synced' (not Success, but not Failed/Held)
    # -> excluded.
    _insert(c, toggl_entry_id="7", status="Already synced", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM")
    filled = backfill_toggl_ids.backfill(c, MAPPINGS)
    assert filled == {"user": 0, "project": 0, "task": 0}
    assert _row(c, "6")["toggl_user_id"] is None
    assert _row(c, "7")["toggl_user_id"] is None


def test_rerunnable():
    c = _conn()
    _insert(c, toggl_entry_id="8", status="Failed", toggl_user="Philip Lupo",
            toggl_project="Nosferatu 2026", toggl_task="APM")
    backfill_toggl_ids.backfill(c, MAPPINGS)
    second = backfill_toggl_ids.backfill(c, MAPPINGS)  # already filled -> no-op
    assert second == {"user": 0, "project": 0, "task": 0}
    assert _row(c, "8")["toggl_project_id"] == "199999595"
