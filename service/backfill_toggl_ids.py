"""Backfill sync_log.toggl_project_id / toggl_task_id / toggl_user_id on the
currently-unresolved historical rows -- the ones the Needs Attention surface
reads (latest row per toggl_entry_id with status Failed or Held) -- so remedy
deep links work for entries logged before those columns existed.

By NAME, with NO Toggl calls: fetches Back Office mappings ONCE
(build_mapping_lookups), builds reverse name->toggl-id indexes from the mapping
values, and matches each target row's stored names against them. Only ever
fills a NULL/blank id, never overwrites a non-null one, and is fully
re-runnable.

Index name fields, from the live Back Office mapping shape (confirmed
2026-11-19):
  tasks    -> togglTaskName  (the Toggl task name itself -- reliable)
  users    -> qboEmployeeName )  the mapping stores the QBO name, not the
  projects -> qboProjectName  )  Toggl name sync_log holds, so these match
only when the two names coincide; otherwise the id stays NULL and remedy uses
its registry/list fallback link -- correct and safe, never a wrong id.

A name that is absent, blank, or maps to MORE THAN ONE toggl id (ambiguous)
leaves that id NULL. Only the LATEST row per entry is touched -- that's the one
Needs Attention renders.

RUNBOOK (TimeSync CLAUDE.md -- SQLite-across-Colima + new-column rules):
  1. Back up data/timesync.db FIRST (the column migration is a schema change):
       cp data/timesync.db data/timesync.pre-attention-ids.<UTC>.db
       sqlite3 data/timesync.db 'PRAGMA integrity_check;' and record the row count.
  2. Deploy the new image (init_db ALTERs the three columns in).
  3. Run this INSIDE the running container, never host-side while it runs
     (a concurrent host write across the Colima VM boundary corrupts the DB):
       docker exec timesync python3 /app/service/backfill_toggl_ids.py
"""
from collections import defaultdict


def _reverse_index(mapping, name_field):
    """name (trimmed, lowercased) -> toggl_id, dropping any name that maps to
    more than one toggl id (ambiguous) and any blank name."""
    buckets = defaultdict(set)
    for toggl_id, val in (mapping or {}).items():
        name = ((val or {}).get(name_field) or "").strip().lower()
        if name:
            buckets[name].add(str(toggl_id))
    return {name: next(iter(ids)) for name, ids in buckets.items() if len(ids) == 1}


def backfill(conn, mappings):
    """Fill NULL/blank Toggl ids on latest-per-entry Failed/Held rows by name.
    Returns a per-column fill count. Pure DB work against the passed conn --
    the caller supplies the mappings dict and owns the connection (lets tests
    drive it with a temp DB and a stub mappings)."""
    mappings = mappings or {}
    users_idx = _reverse_index(mappings.get("users"), "qboEmployeeName")
    projects_idx = _reverse_index(mappings.get("projects"), "qboProjectName")
    tasks_idx = _reverse_index(mappings.get("tasks"), "togglTaskName")

    rows = conn.execute(
        """SELECT s.id, s.toggl_user, s.toggl_project, s.toggl_task,
                  s.toggl_user_id, s.toggl_project_id, s.toggl_task_id
           FROM sync_log s
           JOIN (SELECT toggl_entry_id, MAX(id) mid FROM sync_log GROUP BY toggl_entry_id) t
             ON s.id = t.mid
           WHERE s.status IN ('Failed', 'Held')"""
    ).fetchall()

    filled = {"user": 0, "project": 0, "task": 0}
    for r in rows:
        updates = {}
        if not r["toggl_user_id"]:
            tid = users_idx.get((r["toggl_user"] or "").strip().lower())
            if tid:
                updates["toggl_user_id"] = tid
                filled["user"] += 1
        if not r["toggl_project_id"]:
            tid = projects_idx.get((r["toggl_project"] or "").strip().lower())
            if tid:
                updates["toggl_project_id"] = tid
                filled["project"] += 1
        if not r["toggl_task_id"]:
            tid = tasks_idx.get((r["toggl_task"] or "").strip().lower())
            if tid:
                updates["toggl_task_id"] = tid
                filled["task"] += 1
        if updates:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(f"UPDATE sync_log SET {sets} WHERE id=?", (*updates.values(), r["id"]))
    conn.commit()
    return filled


def main():
    import back_office_client
    from db import get_db

    mappings = back_office_client.build_mapping_lookups(abort_on_failure=False)
    if not mappings:
        print("Back Office mapping fetch failed; nothing backfilled.")
        return
    conn = get_db()
    try:
        filled = backfill(conn, mappings)
    finally:
        conn.close()
    print(f"Backfilled toggl ids on latest Failed/Held rows: {filled}")


if __name__ == "__main__":
    main()
