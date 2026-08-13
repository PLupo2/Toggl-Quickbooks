"""Sync engine -- ported from Toggl.gs's tag-based sync workflow + idempotency
guard (D1-D4) + async job wrapper (D5). Kept fully synchronous (like the
original Apps Script code, sequential top-to-bottom) so it reads as a direct,
auditable port; the async job orchestration at the bottom runs it in a
background thread (asyncio.to_thread) rather than making the whole engine
async, so a slow/paused sync never blocks the FastAPI event loop.

R4 SIMPLIFICATION (deliberate, not an oversight): Apps Script's pause/resume
apparatus (saveSyncState/loadSyncState/scheduleResume/resumePendingSync/
cancelPendingSync, SYNC_PENDING_STATE) existed only because Apps Script has a
~6-minute execution ceiling -- a budget-exhausted run had to save state to a
Script Property and get relaunched by a scheduled trigger ~65 minutes later.
A native background thread has no such ceiling, so budget exhaustion here is
just an in-process time.sleep(65 min) followed by a counter reset and the
SAME loop continuing over the same entries list -- no state to save, no
relaunch, no separate "pending" bookkeeping. R4: "the 1s-trigger launch
workaround and resumePendingSync continuation machinery cease to exist."
"""
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import back_office_client
import qbo_client
from db import get_db, get_setting, set_setting
from toggl_client import TogglClient, resolve_entry_tags

BUDGET_WAIT_SECONDS = 65 * 60  # matches the original's scheduleResume(65)
QBO_WRITE_DELAY_S = 0.25       # matches Utilities.sleep(250) between QBO calls


# ============================================================================
# DATE RANGE (ported from getImportDateRange, Config.gs)
# ============================================================================

def get_import_date_range():
    start = get_setting("START_DATE", "")
    end = get_setting("END_DATE", "")
    if not start:
        days = int(get_setting("IMPORT_DAYS", "30"))
        start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    if not end:
        end = datetime.now().strftime("%Y-%m-%d")
    return {"startDate": start, "endDate": end}


def get_approved_tag_name():
    return get_setting("APPROVED_TAG", "Approved")


def get_synced_tag_name():
    return get_setting("SYNCED_TAG", "Synced")


# ============================================================================
# IDEMPOTENCY GUARD (D1-D4)
# ============================================================================

def build_already_synced_map():
    """D1: Sync_Log is the sole authority for 'already synced.' Iterates
    Success rows in insertion order so a later row for the same entry
    (an intentional override re-sync) wins -- same overwrite-in-order
    semantic as the original's sheet scan."""
    conn = get_db()
    rows = conn.execute(
        "SELECT toggl_entry_id, qbo_timeactivity_id FROM sync_log WHERE status='Success' ORDER BY id ASC"
    ).fetchall()
    conn.close()
    m = {}
    for r in rows:
        if r["toggl_entry_id"]:
            m[str(r["toggl_entry_id"])] = {"qboId": r["qbo_timeactivity_id"]}
    return m


def parse_force_entry_ids(raw):
    """D4: per-entry override, no global bypass."""
    if not raw:
        return set()
    items = raw if isinstance(raw, list) else str(raw).split(",")
    return {str(x).strip() for x in items if str(x).strip()}


def log_sync_result(entry, qbo_id, status, error):
    conn = get_db()
    conn.execute(
        """INSERT INTO sync_log
           (synced_at, toggl_entry_id, qbo_timeactivity_id, date, duration,
            toggl_user, qbo_employee, toggl_client, toggl_project,
            qbo_customer, qbo_project, toggl_task, qbo_service_item,
            description, billable, status, error)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            datetime.now(timezone.utc).isoformat(), str(entry["togglEntryId"]), str(qbo_id or ""),
            entry["date"], entry["durationFormatted"], entry["togglUser"], "",
            entry["togglClient"], entry["togglProject"], "", "",
            entry["togglTask"], "", entry["description"],
            1 if entry.get("billable") else 0, status, error or "",
        ),
    )
    conn.commit()
    conn.close()


def record_tag_flush(results, flush_result):
    if not flush_result or not flush_result.get("failed"):
        return
    results["taggingFailed"] += flush_result["failed"]
    results["taggingErrors"].extend(flush_result["errors"])


def maybe_flush_synced_tags(toggl, untagged_ids, synced_tag, force):
    """D1(a): flush the tag queue via the bulk endpoint once it hits 100, or
    unconditionally when force=True. Mutates untagged_ids in place (drains
    what it sends)."""
    if not untagged_ids:
        return None
    if not force and len(untagged_ids) < 100:
        return None
    batch = untagged_ids[:]
    untagged_ids.clear()
    return toggl.add_tag_to_multiple_entries(batch, synced_tag)


# ============================================================================
# TAG/LOG DISAGREEMENT (D1(b))
# ============================================================================

def compute_disagreement_from_entries(all_entries, tag_lookup, already_synced_map, synced_tag):
    missing_tag = 0  # Sync_Log Success, Toggl entry not tagged Synced
    missing_log = 0  # Toggl tagged Synced, Sync_Log has no Success row
    for entry in all_entries:
        entry_id = str(entry.get("id") or entry.get("time_entry_id"))
        entry_tags = resolve_entry_tags(entry, tag_lookup)
        has_synced_tag = any(t.lower() == synced_tag.lower() for t in entry_tags)
        has_log_success = entry_id in already_synced_map
        if has_log_success and not has_synced_tag:
            missing_tag += 1
        if has_synced_tag and not has_log_success:
            missing_log += 1
    return {
        "count": missing_tag + missing_log, "missingTag": missing_tag, "missingLog": missing_log,
        "checked": len(all_entries), "skipped": False, "reason": None,
    }


def save_disagreement_snapshot(snapshot):
    conn = get_db()
    computed_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO disagreement_snapshot (id, count, missing_tag, missing_log, checked, computed_at)
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET count=excluded.count, missing_tag=excluded.missing_tag,
             missing_log=excluded.missing_log, checked=excluded.checked, computed_at=excluded.computed_at""",
        (snapshot["count"], snapshot["missingTag"], snapshot["missingLog"], snapshot["checked"], computed_at),
    )
    conn.commit()
    conn.close()
    return {**snapshot, "computedAt": computed_at}


def load_disagreement_snapshot():
    conn = get_db()
    row = conn.execute("SELECT * FROM disagreement_snapshot WHERE id=1").fetchone()
    conn.close()
    if not row:
        return None
    return {
        "count": row["count"], "missingTag": row["missing_tag"], "missingLog": row["missing_log"],
        "checked": row["checked"], "computedAt": row["computed_at"],
    }


def get_tag_log_disagreement_count(toggl):
    if toggl.is_approaching_limit(5):
        return {"count": 0, "missingTag": 0, "missingLog": 0, "checked": 0, "skipped": True,
                "reason": "API budget too low to check this execution"}
    try:
        synced_tag = get_synced_tag_name()
        date_range = get_import_date_range()
        tags = toggl.fetch_tags()
        tag_lookup = {t["id"]: t["name"] for t in tags}
        all_entries = toggl.fetch_time_entries_all_users(date_range["startDate"], date_range["endDate"])
        already_synced_map = build_already_synced_map()
        return compute_disagreement_from_entries(all_entries, tag_lookup, already_synced_map, synced_tag)
    except Exception as e:
        return {"count": 0, "missingTag": 0, "missingLog": 0, "checked": 0, "skipped": True, "reason": str(e)}


# ============================================================================
# PER-ENTRY RESOLUTION
# ============================================================================

def process_time_entry(entry, lookups):
    """Port of processTimeEntry -- raw Toggl entry -> normalized fields used
    throughout the rest of the pipeline."""
    entry_id = entry.get("id") or entry.get("time_entry_id")
    user_id = entry.get("user_id") or entry.get("uid")
    project_id = entry.get("project_id") or entry.get("pid")
    task_id = entry.get("task_id") or entry.get("tid")

    from toggl_client import extract_duration_seconds
    duration_seconds = extract_duration_seconds(entry)
    project_info = lookups["projects"].get(project_id) if project_id else None

    raw_tags = entry.get("tags") or entry.get("tag_ids") or []
    resolved_tags = [t if isinstance(t, str) else lookups["tags"].get(t, str(t)) for t in raw_tags]

    start = entry.get("start")
    date_str = start[:10] if start else ""

    hours, minutes = divmod(duration_seconds // 60, 60)

    return {
        "togglEntryId": entry_id,
        "togglUser": lookups["users"].get(user_id, str(user_id)),
        "togglUserId": user_id,
        "togglClient": (project_info or {}).get("clientName", ""),
        "togglClientId": (project_info or {}).get("clientId", ""),
        "togglProject": (project_info or {}).get("name", ""),
        "togglProjectId": project_id or "",
        "togglTask": lookups["tasks"].get(task_id, "") if task_id else "",
        "togglTaskId": task_id or "",
        "description": entry.get("description") or "",
        "date": date_str,
        "durationSeconds": duration_seconds,
        "durationFormatted": f"{hours}:{minutes:02d}",
        "billable": entry.get("billable") or False,
        "tags": ", ".join(resolved_tags),
    }


def resolve_sync_mappings(entry, mappings):
    """Port of resolveSyncMappings -- the actual per-entry resolution logic
    used by production sync."""
    qbo_employee = mappings["users"].get(str(entry["togglUserId"]))
    qbo_project = mappings["projects"].get(str(entry["togglProjectId"]))
    qbo_client_map = mappings["clients"].get(str(entry["togglClientId"]))
    qbo_task = mappings["tasks"].get(str(entry["togglTaskId"]))

    if not qbo_employee:
        return {"success": False, "error": f"No QBO employee mapping for Toggl user: {entry['togglUser']}"}

    customer_id = (qbo_client_map or {}).get("qboCustomerId")
    if not customer_id:
        return {"success": False, "error": f"No QBO customer mapping for client: {entry['togglClient'] or '(no client)'}"}

    project_id = (qbo_project or {}).get("qboProjectId", "")

    service_item_id = (qbo_task or {}).get("qboServiceItemId")
    if not service_item_id:
        default_id = get_setting("DEFAULT_SERVICE_ITEM_ID", "")
        if default_id:
            service_item_id = default_id
        else:
            return {"success": False, "error": (
                f"No QBO service item mapping for task: {entry['togglTask'] or '(no task)'}. "
                f"Set DEFAULT_SERVICE_ITEM_ID in Settings to use a default."
            )}

    return {"success": True, "timeData": {
        "togglEntryId": entry["togglEntryId"],
        "employeeId": qbo_employee["qboEmployeeId"],
        "customerId": customer_id,
        "projectId": project_id,
        "serviceItemId": service_item_id,
        "date": entry["date"],
        "hours": entry["durationSeconds"] / 3600,
        "description": f"{entry['togglUser']}: {entry['description']}".strip(),
        "billable": entry["billable"],
    }}


def sync_single_entry(entry, mappings):
    resolved = resolve_sync_mappings(entry, mappings)
    if not resolved["success"]:
        return resolved
    try:
        activity = qbo_client.create_time_activity(resolved["timeData"])
        return {"success": True, "qboId": activity["Id"]}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# MAIN SYNC (synchronous -- run in a background thread by the job wrapper)
# ============================================================================

def sync_approved_entries(force_entry_ids=None, on_progress=None, on_start=None):
    """Fetches Approved-tagged entries, syncs unsynced (or force-overridden)
    ones to QBO, incrementally tags Synced. Runs to full completion in this
    call -- budget exhaustion is handled by an in-process wait + counter
    reset (see module docstring), not by returning early.

    Scoping (2026-08-14): the walk is pre-filtered against Sync_Log's
    already_synced_map before any mapping/lookup fetch happens, instead of
    re-walking every Approved entry each click and skipping the already-
    synced ones one at a time inside the loop. Sync_Log remains the sole
    idempotency authority either way -- this only changes when it's
    consulted (up front vs. per-entry), not what it guards. force_entry_ids
    entries are still included even if already synced (D4 override)."""
    approved_tag = get_approved_tag_name()
    synced_tag = get_synced_tag_name()
    date_range = get_import_date_range()

    toggl = TogglClient()
    tags = toggl.fetch_tags()
    tag_lookup = {t["id"]: t["name"] for t in tags}

    all_entries = toggl.fetch_time_entries_all_users(date_range["startDate"], date_range["endDate"])

    approved_entries = [
        e for e in all_entries
        if any(t.lower() == approved_tag.lower() for t in resolve_entry_tags(e, tag_lookup))
    ]

    already_synced_map = build_already_synced_map()
    force_ids = parse_force_entry_ids(force_entry_ids)

    def _entry_id(e):
        return str(e.get("id") or e.get("time_entry_id"))

    entries_to_sync = [
        e for e in approved_entries
        if _entry_id(e) not in already_synced_map or _entry_id(e) in force_ids
    ]
    already_synced_count = len(approved_entries) - len(entries_to_sync)

    if on_start:
        try:
            on_start(len(entries_to_sync))
        except Exception:
            pass

    if not entries_to_sync:
        return {"synced": 0, "failed": 0, "alreadySynced": already_synced_count, "taggingFailed": 0,
                "taggingErrors": [], "errors": []}

    toggl_lookups = toggl.build_toggl_lookups()
    mappings = back_office_client.build_mapping_lookups()  # aborts (raises) on failure, by design

    # Merge Back Office task names for display (Sync_Log's "Toggl Task"
    # column). Back Office's JSON keys are always strings; Toggl's Reports
    # API returns task_id as an integer -- store both key forms so the
    # process_time_entry lookup hits regardless of which type it's keyed by.
    for tid, t in mappings["tasks"].items():
        name = t.get("togglTaskName")
        if name:
            toggl_lookups["tasks"][tid] = name
            if tid.isdigit():
                toggl_lookups["tasks"][int(tid)] = name

    results = {"synced": 0, "failed": 0, "alreadySynced": already_synced_count, "taggingFailed": 0,
               "taggingErrors": [], "errors": [], "syncedEntryIds": []}
    untagged_synced_ids = []

    for entry in entries_to_sync:
        entry_id = entry.get("id") or entry.get("time_entry_id")
        try:
            processed = process_time_entry(entry, toggl_lookups)
            is_override = str(processed["togglEntryId"]) in force_ids

            # Budget wait: in-process, not a save-state-and-relaunch. Toggl's
            # real limit resets on a rolling basis; a flat 65-minute wait
            # matches the original's conservative fixed buffer.
            if toggl.is_approaching_limit(5):
                maybe_flush_synced_tags(toggl, untagged_synced_ids, synced_tag, True)
                time.sleep(BUDGET_WAIT_SECONDS)
                toggl.workspace_calls = 0
                toggl.profile_calls = 0
                toggl.start_time = time.time()

            sync_result = sync_single_entry(processed, mappings)

            if sync_result["success"]:
                results["synced"] += 1
                results["syncedEntryIds"].append(processed["togglEntryId"])
                untagged_synced_ids.append(processed["togglEntryId"])
                already_synced_map[str(processed["togglEntryId"])] = {"qboId": sync_result["qboId"]}
                log_sync_result(processed, sync_result["qboId"], "Success",
                                 "Override: forced re-sync" if is_override else "")
                record_tag_flush(results, maybe_flush_synced_tags(toggl, untagged_synced_ids, synced_tag, False))
            else:
                results["failed"] += 1
                results["errors"].append({"entryId": processed["togglEntryId"], "error": sync_result["error"]})
                log_sync_result(processed, "", "Failed", sync_result["error"])
        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"entryId": entry_id, "error": str(e)})

        _progress(on_progress, results)
        time.sleep(QBO_WRITE_DELAY_S)

    record_tag_flush(results, maybe_flush_synced_tags(toggl, untagged_synced_ids, synced_tag, True))

    set_setting("LAST_SYNC_API_CALLS", toggl.workspace_calls)
    set_setting("LAST_SYNC_DATE", datetime.now(timezone.utc).isoformat())

    try:
        save_disagreement_snapshot(compute_disagreement_from_entries(all_entries, tag_lookup, already_synced_map, synced_tag))
    except Exception:
        pass  # non-fatal, matches the original's defensive wrap

    return results


def _progress(on_progress, results):
    # alreadySynced is now a fixed precomputed count (entries_to_sync already
    # excludes them), not incremented per-entry -- the throttle only needs to
    # track the two counters that actually move during the loop.
    if on_progress and (results["synced"] + results["failed"]) % 5 == 0:
        try:
            on_progress(results["synced"], results["failed"], results["alreadySynced"])
        except Exception:
            pass


# ============================================================================
# ASYNC JOB WRAPPER (D5) -- single-flight, native background thread
# ============================================================================

_job_start_lock = threading.Lock()


def get_sync_job_meta(job_id=None):
    conn = get_db()
    if job_id:
        row = conn.execute("SELECT * FROM sync_job WHERE job_id=?", (job_id,)).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM sync_job WHERE status IN ('running','paused') ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
    conn.close()
    return dict(row) if row else None


def _save_sync_job_meta(job_id, **fields):
    conn = get_db()
    sets = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE sync_job SET {sets} WHERE job_id=?", (*fields.values(), job_id))
    conn.commit()
    conn.close()


def start_async_sync_job(force_entry_ids=None):
    """D5 entry point. A retry that lands while a job is already running/
    paused is handed the same jobId rather than starting a duplicate --
    harmless by construction since Sync_Log is the guard regardless."""
    with _job_start_lock:
        existing = get_sync_job_meta()
        if existing:
            return {"jobId": existing["job_id"], "status": existing["status"], "alreadyRunning": True}

        job_id = str(uuid.uuid4())
        conn = get_db()
        conn.execute(
            "INSERT INTO sync_job (job_id, status, started_at, force_entry_ids) VALUES (?, 'running', ?, ?)",
            (job_id, datetime.now(timezone.utc).isoformat(), json.dumps(list(parse_force_entry_ids(force_entry_ids)))),
        )
        conn.commit()
        conn.close()

    threading.Thread(target=_run_sync_job, args=(job_id, force_entry_ids), daemon=True).start()
    return {"jobId": job_id, "status": "running", "alreadyRunning": False}


def _run_sync_job(job_id, force_entry_ids):
    def on_progress(synced, failed, already_synced):
        _save_sync_job_meta(job_id, total_synced=synced, total_failed=failed, total_already_synced=already_synced)

    def on_start(total):
        _save_sync_job_meta(job_id, total_entries=total)

    try:
        result = sync_approved_entries(force_entry_ids=force_entry_ids, on_progress=on_progress, on_start=on_start)
        _save_sync_job_meta(
            job_id, status="completed", completed_at=datetime.now(timezone.utc).isoformat(),
            total_synced=result["synced"], total_failed=result["failed"],
            total_already_synced=result["alreadySynced"], total_tagging_failed=result.get("taggingFailed", 0),
        )
    except Exception as e:
        _save_sync_job_meta(job_id, status="failed", completed_at=datetime.now(timezone.utc).isoformat(), error=str(e))


def mark_orphaned_jobs_failed():
    """Called at app startup: a job left 'running' means the previous
    container instance died mid-sync. There's no Apps Script equivalent of
    this failure mode (Script Properties survive a fresh execution; a
    container restart doesn't), so this is a deliberate addition, not a
    port -- without it, a crashed run would permanently wedge the
    single-flight guard."""
    conn = get_db()
    conn.execute(
        "UPDATE sync_job SET status='failed', completed_at=?, error='Interrupted by service restart' WHERE status IN ('running','paused')",
        (datetime.now(timezone.utc).isoformat(),),
    )
    conn.commit()
    conn.close()
