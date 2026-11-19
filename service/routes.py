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
import remedy
import sync_engine
from db import get_db, get_setting, set_setting
from toggl_client import TogglClient, extract_duration_seconds, resolve_entry_tags

router = APIRouter()  # CF Access verification is applied once in app.py, ahead of this router

CONNECTION_STATUS_TTL_SECONDS = 3600  # auto-refresh-on-read if the cache is older than this

# The latest-row-per-entry set the Needs Attention surface reads: a toggl_entry_id
# whose most recent sync_log row is Failed or Held (not Success, and not the
# informational 'Already synced' status). An entry drops off automatically once
# a later Success row exists -- no re-resolution, purely sync_log-derived.
_LATEST_NEEDS_ATTENTION_SQL = """
    SELECT {cols} FROM sync_log s
    JOIN (SELECT toggl_entry_id, MAX(id) mid FROM sync_log GROUP BY toggl_entry_id) t
      ON s.id = t.mid
    WHERE s.status IN ('Failed', 'Held')
"""


def _resp(data, status_code=200):
    return JSONResponse(content={"status": status_code, **data}, status_code=status_code)


def _error(message, status_code=500):
    return _resp({"error": message}, status_code)


def _duration_to_hours(duration):
    """sync_log.duration is stored as 'H:MM' (durationFormatted) -- turn it into
    decimal hours for display. Any unexpected shape degrades to 0."""
    try:
        h, m = str(duration or "0:00").split(":")
        return round(int(h) + int(m) / 60, 2)
    except Exception:
        return 0


def _cached_workspace_id():
    """The Toggl workspace id, read from connection_status_cache -- NO Toggl
    call. Lets remedy build Toggl deep links from a stored row. '' if the cache
    is empty (remedy then falls back to the Toggl projects list link)."""
    conn = get_db()
    row = conn.execute("SELECT toggl_workspace_id FROM connection_status_cache WHERE id=1").fetchone()
    conn.close()
    return (row["toggl_workspace_id"] if row else "") or ""


def _needs_attention_mappings():
    """ONE read-only Back Office mapping fetch shared across a request's row
    enrichments (remedy link building). Degrades to None on failure -- remedy
    then builds its registry/list fallback links, never a broken one."""
    return back_office_client.build_mapping_lookups(abort_on_failure=False)


# ============================================================================
# ACTION HANDLERS (pure functions: params in, data dict out or raises)
# ============================================================================

def _get_needs_attention(params):
    """Entries that didn't sync and still need a human fix: one object per
    latest-not-Success (Failed/Held) toggl_entry_id, each carrying a plain fix
    instruction + deep link from the shared remedy helper. Purely sync_log-
    derived -- NO Toggl call, no re-resolution -- so an entry drops off the
    instant a later Success row exists. `reason` is included so the frontend
    can group rows by remedy."""
    conn = get_db()
    rows = conn.execute(
        _LATEST_NEEDS_ATTENTION_SQL.format(cols="s.*") + " ORDER BY s.id DESC"
    ).fetchall()
    conn.close()

    mappings = _needs_attention_mappings()
    workspace_id = _cached_workspace_id()

    entries = []
    for row in rows:
        r = dict(row)
        rem = remedy.remedy_for(r["status"], r["error"], r, mappings, workspace_id)
        entries.append({
            "entry_id": r["toggl_entry_id"],
            "project": r["toggl_project"],
            "person": r["toggl_user"],
            "date": r["date"],
            "hours": _duration_to_hours(r["duration"]),
            "reason": rem["reason"],
            "instruction": rem["instruction"],
            "link": rem["link"],
            "link_label": rem["link_label"],
        })
    return {"count": len(entries), "entries": entries}


def _get_dashboard(params):
    conn = get_db()
    log_entries = conn.execute("SELECT COUNT(*) c FROM sync_log").fetchone()["c"]
    needs_attention_count = conn.execute(
        _LATEST_NEEDS_ATTENTION_SQL.format(cols="COUNT(*) c")
    ).fetchone()["c"]
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
        "needs_attention_count": needs_attention_count,
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
    # jobId, when passed, looks up that exact job regardless of terminal
    # state -- the no-id path only matches status IN ('running','paused'),
    # so a poller tracking a specific job must pass it back or it loses the
    # job the instant it completes (status flips out from under the no-id
    # query, response becomes {status: idle, jobId: null}, and the caller's
    # "a different job took over" guard silently stops polling before ever
    # seeing the completion).
    meta = sync_engine.get_sync_job_meta(job_id=params.get("jobId"))
    if not meta:
        return {"status": "idle", "jobId": None}
    return {
        "jobId": meta["job_id"], "status": meta["status"],
        "startedAt": meta["started_at"], "completedAt": meta["completed_at"],
        "synced": meta["total_synced"] or 0, "failed": meta["total_failed"] or 0,
        "alreadySynced": meta["total_already_synced"] or 0, "taggingFailed": meta["total_tagging_failed"] or 0,
        "held": meta["total_held"] or 0,
        "totalEntries": meta["total_entries"] or 0,
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

    # Optional filters -- all narrow the same result set the grouped Sync Log
    # page renders, so `total` below reflects the filtered count, not the
    # grand total, once any filter is active.
    where, args = [], []
    if params.get("startDate"):
        where.append("date >= ?")
        args.append(params["startDate"])
    if params.get("endDate"):
        where.append("date <= ?")
        args.append(params["endDate"])
    if params.get("status"):
        where.append("status = ?")
        args.append(params["status"])
    if params.get("user"):
        where.append("toggl_user LIKE ?")
        args.append(f"%{params['user']}%")
    if params.get("client"):
        where.append("toggl_client LIKE ?")
        args.append(f"%{params['client']}%")
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""

    # id + the Toggl-side ids are selected alongside the header columns so each
    # Failed/Held row can be enriched (remedy links, resolved_later) without a
    # second per-row query; they are not added to the header-keyed payload.
    extra_cols = ["id", "toggl_project_id", "toggl_task_id", "toggl_user_id"]
    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) c FROM sync_log {where_clause}", args).fetchone()["c"]
    rows = conn.execute(
        f"SELECT {','.join(SYNC_LOG_COLS + extra_cols)} FROM sync_log {where_clause} ORDER BY id DESC LIMIT ?",
        (*args, limit),
    ).fetchall()

    # resolved_later: a Failed/Held row whose toggl_entry_id has a LATER Success
    # row (id greater) was fixed and re-synced since. One grouped query over just
    # the entry ids on this page, not a per-row lookup.
    flagged = [r for r in rows if r["status"] in ("Failed", "Held")]
    success_max = {}
    entry_ids = {r["toggl_entry_id"] for r in flagged}
    if entry_ids:
        placeholders = ",".join("?" * len(entry_ids))
        for sr in conn.execute(
            f"SELECT toggl_entry_id, MAX(id) mid FROM sync_log "
            f"WHERE status='Success' AND toggl_entry_id IN ({placeholders}) GROUP BY toggl_entry_id",
            tuple(entry_ids),
        ):
            success_max[sr["toggl_entry_id"]] = sr["mid"]
    conn.close()

    mappings = _needs_attention_mappings() if flagged else None
    workspace_id = _cached_workspace_id() if flagged else ""

    entries = []
    for row in rows:
        obj = {}
        for header, col in zip(SYNC_LOG_HEADERS, SYNC_LOG_COLS):
            val = row[col]
            obj[header] = bool(val) if col == "billable" else val
        if row["status"] in ("Failed", "Held"):
            rem = remedy.remedy_for(row["status"], row["error"], dict(row), mappings, workspace_id)
            obj["remedy"] = {
                "instruction": rem["instruction"], "link": rem["link"],
                "link_label": rem["link_label"], "reason": rem["reason"],
            }
            later = success_max.get(row["toggl_entry_id"])
            obj["resolved_later"] = bool(later and later > row["id"])
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


def _post_preflight_check(params):
    """Warn before Sync Approved pushes. Everything is computed LIVE from the
    raw Toggl entries + ONE Back Office mapping fetch -- no call to Back Office's
    get_preflight (its stored counts can trail reality):

    - held_count: billable entries whose bill rate is unresolved AND whose
      mappings resolve (an unmapped entry is Failed by the run, not Held), via
      the shared bill_rate_hold / would_hold the real sync uses.
    - total_flagged / by_reason: the live correction counts an operator must
      fix for these entries to sync at all -- unknown_user / unknown_project /
      no_task, checked against the SAME one mapping fetch.

    Fail open -- any failure (Toggl fetch, mapping fetch, anything) returns
    total_flagged=0 / held_count=0 so the caller (runSync's non-blocking
    preflight) proceeds with the sync exactly as if nothing were flagged."""
    default_url = "https://backoffice.pltheatrical.com/#/corrections?source=time-entry"
    zeros = {"entry_count": 0, "total_flagged": 0, "by_reason": {}, "held_count": 0, "corrections_url": default_url}
    try:
        date_range = sync_engine.get_import_date_range()
        approved_tag = sync_engine.get_approved_tag_name()
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

        if not to_sync:
            return zeros  # nothing pending -> no Toggl/Back Office spend at all

        # Held CANDIDATES first, cheaply: a billable entry whose bill rate is
        # unresolved per bill_rate_hold, off ONE get_bill_rates call (Back
        # Office, not Toggl -- no Toggl quota spent here). Same payload shape
        # and hold rule the run uses.
        payload = sync_engine.build_bill_rate_payload(to_sync)
        bill_rates, hold_reasons = back_office_client.get_bill_rates(payload)
        candidates = [
            e for e in to_sync
            if sync_engine.bill_rate_hold(
                {"billable": e.get("billable"), "togglEntryId": e.get("id")}, bill_rates, hold_reasons
            ) is not None
        ]

        if not candidates:
            # Nothing can be held -> held_count 0, and the Toggl-quota-expensive
            # build_toggl_lookups is skipped (zero-candidate short-circuit). The
            # correction counts still need mappings, so fetch them ONCE here
            # (Back Office, not Toggl); a failure short-circuits to zeros.
            held_count = 0
            mappings = back_office_client.build_mapping_lookups(abort_on_failure=False)
            if not mappings:
                return zeros
        else:
            # A candidate exists: run the shared bulk prep ONCE
            # (build_toggl_lookups + build_mapping_lookups), reuse its mappings
            # for the correction counts below (no second mapping fetch). A
            # candidate whose mappings FAIL is dropped via would_hold -- the run
            # would mark it Failed, not Held. A mapping-fetch failure here raises
            # and is caught by the fail-open except, matching the real run.
            processed_entries, mappings, prep_bill_rates, prep_hold_reasons = \
                sync_engine.prepare_approved_entries(to_sync, toggl)
            candidate_ids = {str(e.get("id")) for e in candidates}
            held_count = sum(
                1 for p in processed_entries
                if str(p["togglEntryId"]) in candidate_ids
                and sync_engine.would_hold(p, mappings, prep_bill_rates, prep_hold_reasons)
            )

        # Live correction counts off the raw Toggl ids + the one mappings dict
        # (never build_toggl_lookups, never a per-entry Toggl call). Mirrors
        # resolve_sync_mappings' own failure reasons so the number matches what
        # the operator must fix for these entries to sync.
        users_map = mappings.get("users") or {}
        projects_map = mappings.get("projects") or {}
        tasks_map = mappings.get("tasks") or {}
        unknown_user = sum(1 for e in to_sync if str(e.get("user_id")) not in users_map)
        unknown_project = sum(1 for e in to_sync if str(e.get("project_id")) not in projects_map)
        no_task = sum(1 for e in to_sync if not e.get("task_id") or str(e.get("task_id")) not in tasks_map)
    except Exception:
        return zeros

    by_reason = {}
    if unknown_user:
        by_reason["unknown_user"] = unknown_user
    if unknown_project:
        by_reason["unknown_project"] = unknown_project
    if no_task:
        by_reason["no_task"] = no_task
    return {
        "entry_count": len(to_sync),
        "total_flagged": unknown_user + unknown_project + no_task,
        "by_reason": by_reason,
        "held_count": held_count,
        "corrections_url": default_url,
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
    # active_only=False -- an entry on an archived project otherwise shows
    # Project "—" here and resolves to no client/customer at push time.
    projects = toggl.fetch_projects(active_only=False)
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
    "getNeedsAttention": _get_needs_attention,
}
POST_ONLY_ACTIONS = {
    "syncApproved": _post_sync_approved,
    "recomputeDisagreement": _post_recompute_disagreement,
    "setConfig": _post_set_config,
    "preflightCheck": _post_preflight_check,
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
