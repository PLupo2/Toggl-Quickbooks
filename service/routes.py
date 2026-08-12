"""The 11 WebAPI actions, ported from WebAPI.gs with response shapes AND
routing contract preserved exactly -- the existing unmodified frontend
(web/js/api.js) always calls a SINGLE endpoint (`/api`), passing the action
name as a GET query param or a POST JSON body field, never a per-action
path. This is a direct mirror of handleApiRequest's switch statement, not
idiomatic per-resource REST routing -- that shape is a hard requirement of
the frontend contract, not a style choice.

Two more load-bearing compatibility details:

1. api.js's _parse() checks `data.status >= 400` in the JSON BODY to detect
   an error (a holdover from Apps Script's ContentService, which can't set
   a real HTTP status). Every response here embeds that same `status` field
   -- in addition to (not instead of) setting the real HTTP status code,
   which costs nothing and is more correct.
2. getSyncLog's entries are keyed by the ORIGINAL SHEET HEADER STRINGS
   ('Synced At', 'Toggl Entry ID', ...), not camelCase -- the dashboard
   renders these directly. Changing the keys would silently break that page
   without changing this file at all.

Explicit deviation from "near-unchanged" (approved, Phase 3 plan §3):
QBO_ENV / qboEnv is dropped entirely -- the sandbox toggle is retired (R3,
Core vends production only). getConfig no longer returns it; setConfig no
longer special-cases it.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import back_office_client
import core_client
import qbo_client
import sync_engine
from db import get_db, get_setting, set_setting
from toggl_client import TogglClient, extract_duration_seconds, resolve_entry_tags

router = APIRouter()  # CF Access verification is applied once in app.py, ahead of this router

CONNECTION_STATUS_TTL_SECONDS = 3600  # auto-refresh-on-read if the cache is older than this


def _resp(data, status_code=200):
    return JSONResponse(content={"status": status_code, **data}, status_code=status_code)


def _error(message, status_code=500):
    return _resp({"error": message}, status_code)


# ============================================================================
# ACTION HANDLERS (pure functions: params in, data dict out or raises)
# ============================================================================

def _get_dashboard(params):
    conn = get_db()
    log_entries = conn.execute("SELECT COUNT(*) c FROM sync_log").fetchone()["c"]
    conn.close()

    date_range = sync_engine.get_import_date_range()
    snapshot = sync_engine.load_disagreement_snapshot()
    if snapshot:
        disagreement = {**snapshot, "skipped": False, "reason": None}
    else:
        disagreement = {"count": 0, "missingTag": 0, "missingLog": 0, "checked": 0,
                         "skipped": True, "reason": "Not yet computed — run a sync, or use the Recompute action",
                         "computedAt": None}

    synced_tag = sync_engine.get_synced_tag_name()
    warning = (
        f"{disagreement['count']} entries disagree between Sync_Log and the Toggl \"{synced_tag}\" tag — see missingTag/missingLog."
        if not disagreement["skipped"] and disagreement["count"] > 0 else None
    )

    # hasPendingSync / syncStatus: the Apps Script "paused, waiting on rate
    # limit, needs a manual/triggered resume" state no longer exists as an
    # externally-visible distinct state (Phase 3 R4) -- budget waits now
    # happen invisibly inside a still-"running" job. Always reported as
    # not-pending; a genuinely in-flight job is what getSyncJobStatus is for.
    return {
        "sync": {
            "lastSync": get_setting("LAST_SYNC_DATE", "Never"),
            "logEntries": log_entries,
            "dateRange": {"start": date_range["startDate"], "end": date_range["endDate"]},
            "hasPendingSync": False,
            "syncStatus": "",
        },
        "api": {
            "lastSyncCalls": get_setting("LAST_SYNC_API_CALLS", ""),
            "budget": get_setting("TOGGL_API_BUDGET", "180"),
        },
        "tags": {
            "approved": sync_engine.get_approved_tag_name(),
            "synced": synced_tag,
            "disagreement": {**disagreement, "warning": warning},
        },
    }


def _get_sync_status(params):
    budget = int(get_setting("TOGGL_API_BUDGET", "180"))
    return {
        "lastSync": get_setting("LAST_SYNC_DATE", "Never"),
        "dateRange": sync_engine.get_import_date_range(),
        "tags": {"approved": sync_engine.get_approved_tag_name(), "synced": sync_engine.get_synced_tag_name()},
        "api": {"workspaceCalls": 0, "budget": budget, "remaining": budget,
                "lastSyncCalls": get_setting("LAST_SYNC_API_CALLS", "")},
        "pendingSync": None,  # see _get_dashboard's note — this state no longer exists
    }


def _get_sync_job_status(params):
    meta = sync_engine.get_sync_job_meta()
    if not meta:
        return {"status": "idle", "jobId": None}
    return {
        "jobId": meta["job_id"], "status": meta["status"],
        "startedAt": meta["started_at"], "completedAt": meta["completed_at"],
        "synced": meta["total_synced"] or 0, "failed": meta["total_failed"] or 0,
        "alreadySynced": meta["total_already_synced"] or 0, "taggingFailed": meta["total_tagging_failed"] or 0,
        "error": meta["error"], "pending": None,
    }


SYNC_LOG_HEADERS = [
    "Synced At", "Toggl Entry ID", "QBO TimeActivity ID", "Date", "Duration",
    "Toggl User", "QBO Employee", "Toggl Client", "Toggl Project", "QBO Customer",
    "QBO Project", "Toggl Task", "QBO Service Item", "Description", "Billable", "Status", "Error",
]
SYNC_LOG_COLS = [
    "synced_at", "toggl_entry_id", "qbo_timeactivity_id", "date", "duration",
    "toggl_user", "qbo_employee", "toggl_client", "toggl_project", "qbo_customer",
    "qbo_project", "toggl_task", "qbo_service_item", "description", "billable", "status", "error",
]


def _get_sync_log(params):
    limit = int(params.get("limit") or 50)
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) c FROM sync_log").fetchone()["c"]
    rows = conn.execute(
        f"SELECT {','.join(SYNC_LOG_COLS)} FROM sync_log ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    entries = []
    for row in rows:
        obj = {}
        for header, col in zip(SYNC_LOG_HEADERS, SYNC_LOG_COLS):
            val = row[col]
            obj[header] = bool(val) if col == "billable" else val
        entries.append(obj)
    return {"entries": entries, "total": total}


def _get_config(params):
    return {
        "startDate": get_setting("START_DATE", ""),
        "endDate": get_setting("END_DATE", ""),
        "importDays": get_setting("IMPORT_DAYS", "30"),
        "approvedTag": sync_engine.get_approved_tag_name(),
        "syncedTag": sync_engine.get_synced_tag_name(),
        "apiBudget": get_setting("TOGGL_API_BUDGET", "180"),
        "syncBillableOnly": get_setting("SYNC_BILLABLE_ONLY", "FALSE"),
        "batchSize": get_setting("BATCH_SIZE", "50"),
        "defaultServiceItemId": get_setting("DEFAULT_SERVICE_ITEM_ID", ""),
        "defaultServiceItemName": get_setting("DEFAULT_SERVICE_ITEM_NAME", ""),
    }


def _recompute_connection_status():
    qbo_connected, qbo_realm = False, None
    try:
        tok = core_client.get_qbo_token()
        qbo_client.qbo_request(f"companyinfo/{tok['realm_id']}")
        qbo_connected, qbo_realm = True, tok["realm_id"]
    except Exception:
        pass

    toggl_connected, toggl_workspace = False, None
    try:
        t = TogglClient()
        toggl_workspace = t.get_or_fetch_workspace_id()
        toggl_connected = True
    except Exception:
        pass

    conn = get_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO connection_status_cache (id, qbo_connected, qbo_realm_id, toggl_connected, toggl_workspace_id, computed_at)
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET qbo_connected=excluded.qbo_connected, qbo_realm_id=excluded.qbo_realm_id,
             toggl_connected=excluded.toggl_connected, toggl_workspace_id=excluded.toggl_workspace_id, computed_at=excluded.computed_at""",
        (int(qbo_connected), qbo_realm, int(toggl_connected), toggl_workspace, now),
    )
    conn.commit()
    conn.close()
    return {"qbo": {"connected": qbo_connected, "realmId": qbo_realm},
            "toggl": {"connected": toggl_connected, "workspaceId": toggl_workspace}}


def _get_connection_status(params):
    """R1: cached snapshot, not a live Toggl /me + QBO round trip on every
    dashboard load. Auto-refreshes on read if the cache is missing or older
    than CONNECTION_STATUS_TTL_SECONDS -- bounds staleness to at most ~1hr
    without needing every page load to pay for two live API calls. The
    (disabled-by-default) scheduler can additionally refresh this
    proactively once enabled; this path works correctly either way."""
    conn = get_db()
    row = conn.execute("SELECT * FROM connection_status_cache WHERE id=1").fetchone()
    conn.close()
    if row:
        computed_at = datetime.fromisoformat(row["computed_at"])
        age = (datetime.now(timezone.utc) - computed_at).total_seconds()
        if age < CONNECTION_STATUS_TTL_SECONDS:
            return {"qbo": {"connected": bool(row["qbo_connected"]), "realmId": row["qbo_realm_id"]},
                    "toggl": {"connected": bool(row["toggl_connected"]), "workspaceId": row["toggl_workspace_id"]}}
    return _recompute_connection_status()


def _get_project_pending_entries(params):
    project_id = params.get("projectId")
    if not project_id:
        return {"error": "Missing projectId parameter", "count": 0, "entries": []}

    date_range = sync_engine.get_import_date_range()
    approved_tag = sync_engine.get_approved_tag_name()
    toggl = TogglClient()

    all_entries = toggl.fetch_time_entries_all_users(date_range["startDate"], date_range["endDate"])
    tags = toggl.fetch_tags()
    tag_lookup = {t["id"]: t["name"] for t in tags}
    already_synced_map = sync_engine.build_already_synced_map()

    pending = [
        e for e in all_entries
        if str(e.get("project_id")) == str(project_id)
        and any(t.lower() == approved_tag.lower() for t in resolve_entry_tags(e, tag_lookup))
        and str(e.get("id")) not in already_synced_map
    ]

    users = toggl.fetch_users()
    user_map = {u["id"]: u.get("fullname") or u.get("name") or u.get("email") for u in users}

    entries = [{
        "id": e.get("id"), "description": e.get("description") or "",
        "user": user_map.get(e.get("user_id"), e.get("user_id")),
        "duration": extract_duration_seconds(e),
        "date": (e.get("start") or "")[:10],
    } for e in pending]

    return {
        "projectId": project_id, "count": len(entries), "entries": entries,
        "message": (f"This project has {len(entries)} pending entries that haven't been synced yet."
                    if entries else "No pending entries for this project."),
    }


def _post_sync_approved(params):
    job = sync_engine.start_async_sync_job(force_entry_ids=params.get("forceEntryIds"))
    return {
        "message": "A sync is already in progress — polling the existing job." if job["alreadyRunning"] else "Sync started",
        "jobId": job["jobId"], "status": job["status"], "alreadyRunning": job["alreadyRunning"],
    }


def _preview_approved(params):
    if params.get("startDate") and params.get("endDate"):
        date_range = {"startDate": params["startDate"], "endDate": params["endDate"]}
    else:
        date_range = sync_engine.get_import_date_range()
    approved_tag = sync_engine.get_approved_tag_name()
    synced_tag = sync_engine.get_synced_tag_name()

    toggl = TogglClient()
    all_entries = toggl.fetch_time_entries_all_users(date_range["startDate"], date_range["endDate"])
    tags = toggl.fetch_tags()
    tag_map = {t["id"]: t["name"] for t in tags}

    approved_entries = [
        e for e in all_entries
        if any(t.lower() == approved_tag.lower() for t in resolve_entry_tags(e, tag_map))
    ]

    already_synced_map = sync_engine.build_already_synced_map()
    to_sync = [e for e in approved_entries if str(e.get("id")) not in already_synced_map]
    already_synced_count = len(approved_entries) - len(to_sync)

    users = toggl.fetch_users()
    user_map = {u["id"]: u.get("fullname") or u.get("name") or u.get("email") for u in users}
    projects = toggl.fetch_projects()
    project_map = {p["id"]: p["name"] for p in projects}

    task_map = {}
    bo = back_office_client.build_mapping_lookups(abort_on_failure=False)
    if bo and bo.get("tasks"):
        for tid, t in bo["tasks"].items():
            if t.get("togglTaskName"):
                task_map[tid] = t["togglTaskName"]

    entries = [{
        "id": e.get("id"), "description": e.get("description") or "",
        "user": user_map.get(e.get("user_id"), e.get("user_id")),
        "project": project_map.get(e.get("project_id"), ""),
        "task": task_map.get(str(e.get("task_id")), "") if e.get("task_id") else "",
        "duration": extract_duration_seconds(e),
        "date": (e.get("start") or "")[:10],
        "tags": [tag_map.get(tid, tid) for tid in (e.get("tag_ids") or [])],
    } for e in to_sync]

    return {
        "count": len(entries), "approvedCount": len(approved_entries), "alreadySyncedCount": already_synced_count,
        "dateRange": date_range, "approvedTag": approved_tag, "syncedTag": synced_tag, "entries": entries,
    }


def _post_recompute_disagreement(params):
    toggl = TogglClient()
    result = sync_engine.get_tag_log_disagreement_count(toggl)
    if result["skipped"]:
        return {**result, "computedAt": None}
    return sync_engine.save_disagreement_snapshot(result)


SET_CONFIG_ALLOWED_KEYS = {
    "START_DATE", "END_DATE", "IMPORT_DAYS", "APPROVED_TAG", "SYNCED_TAG",
    "TOGGL_API_BUDGET", "SYNC_BILLABLE_ONLY", "BATCH_SIZE",
    "DEFAULT_SERVICE_ITEM_ID", "DEFAULT_SERVICE_ITEM_NAME",
}


def _post_set_config(params):
    key, value = params.get("key"), params.get("value")
    if key not in SET_CONFIG_ALLOWED_KEYS:
        raise RuntimeError(f"Config key not allowed: {key}")
    set_setting(key, value)
    return {"message": f"Config {key} updated", "key": key, "value": value}


# ============================================================================
# DISPATCH (mirrors handleApiRequest's switch exactly, including the
# per-action POST-only gating)
# ============================================================================

READ_ACTIONS = {
    "getDashboard": _get_dashboard,
    "getSyncStatus": _get_sync_status,
    "getSyncJobStatus": _get_sync_job_status,
    "getSyncLog": _get_sync_log,
    "getConfig": _get_config,
    "getConnectionStatus": _get_connection_status,
    "getProjectPendingEntries": _get_project_pending_entries,
    "previewApproved": _preview_approved,  # reachable via GET, matching the frontend's actual usage
}
POST_ONLY_ACTIONS = {
    "syncApproved": _post_sync_approved,
    "recomputeDisagreement": _post_recompute_disagreement,
    "setConfig": _post_set_config,
}
ALL_ACTIONS = {**READ_ACTIONS, **POST_ONLY_ACTIONS}


def _dispatch(action, params, is_post):
    if action not in ALL_ACTIONS:
        return _error(f"Unknown action: {action}", 404)
    if action in POST_ONLY_ACTIONS and not is_post:
        return _error("Use POST for this action", 405)
    try:
        return _resp(ALL_ACTIONS[action](params))
    except Exception as e:
        return _error(str(e), 500)


@router.get("/api")
def api_get(request: Request):
    params = dict(request.query_params)
    action = params.get("action")
    if not action:
        return _error("Missing action parameter", 400)
    return _dispatch(action, params, is_post=False)


@router.post("/api")
async def api_post(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    params = {**dict(request.query_params), **body}
    action = params.get("action")
    if not action:
        return _error("Missing action parameter", 400)
    return _dispatch(action, params, is_post=True)
