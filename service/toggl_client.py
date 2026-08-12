"""Toggl Track API client -- ported from Toggl.gs (togglApiV9, togglReportsV3,
tag ops, fetch helpers). Faithful port of the LIVE sync-path functions only;
the dead Inbox/Queue import chain and the orphaned mapping-sheet helpers
(getUsersForMapping etc., 0 callers confirmed against the current Apps
Script source) are deliberately NOT ported -- see Phase 3 plan §1.

Budget semantics preserved exactly: Apps Script's API_COUNTER was a
per-execution global (Apps Script has no persistent process between
invocations), so "don't exceed TOGGL_API_BUDGET" really meant "within this
one sync/preview run." A TogglClient instance here is the equivalent unit --
instantiate one per sync run or per read call, not a server-lifetime
singleton, to preserve that semantic rather than accidentally turning it
into a true rolling-hour tracker it never was.
"""
import time

import httpx

import core_client
from db import get_setting

TOGGL_API_V9_BASE = "https://api.track.toggl.com/api/v9"
TOGGL_REPORTS_V3_BASE = "https://api.track.toggl.com/reports/api/v3"
DEFAULT_API_BUDGET = 180


def extract_duration_seconds(entry):
    """Handles Track API v9 ('duration', seconds, negative for running
    timers), Reports API v3 ('seconds'), and legacy v2 ('dur', ms)."""
    if not entry:
        return 0
    seconds = entry.get("seconds")
    if isinstance(seconds, (int, float)) and seconds >= 0:
        return seconds
    duration = entry.get("duration")
    if isinstance(duration, (int, float)):
        if duration < 0 and entry.get("start"):
            from datetime import datetime, timezone
            start = datetime.fromisoformat(entry["start"].replace("Z", "+00:00"))
            return int((datetime.now(timezone.utc) - start).total_seconds())
        return duration
    dur_ms = entry.get("dur")
    if isinstance(dur_ms, (int, float)) and dur_ms > 0:
        return int(dur_ms / 1000)
    if entry.get("start") and entry.get("stop"):
        from datetime import datetime
        start = datetime.fromisoformat(entry["start"].replace("Z", "+00:00"))
        stop = datetime.fromisoformat(entry["stop"].replace("Z", "+00:00"))
        diff = (stop - start).total_seconds()
        if diff > 0:
            return int(diff)
    return 0


def resolve_entry_tags(entry, tag_lookup):
    """Reports API uses tag_ids (numeric); v9 API uses tags (names)."""
    raw = entry.get("tag_ids") or entry.get("tags") or []
    out = []
    for t in raw:
        if isinstance(t, str):
            out.append(t)
        else:
            out.append(tag_lookup.get(t, str(t)))
    return out


class TogglClient:
    def __init__(self):
        self.workspace_calls = 0
        self.profile_calls = 0
        self.start_time = time.time()
        self._workspace_id = None
        self._tags_cache = None
        self._users_cache = None
        self._clients_cache = None
        self._projects_cache = None

    # ---- budget ----

    def get_budget(self):
        return int(get_setting("TOGGL_API_BUDGET", DEFAULT_API_BUDGET))

    def is_approaching_limit(self, calls_needed=1):
        return (self.workspace_calls + calls_needed) > self.get_budget()

    def get_usage_stats(self):
        budget = self.get_budget()
        return {
            "workspaceCalls": self.workspace_calls,
            "profileCalls": self.profile_calls,
            "budget": budget,
            "remaining": budget - self.workspace_calls,
            "elapsedSeconds": round(time.time() - self.start_time),
        }

    # ---- low-level requests ----

    def _v9(self, endpoint, method="get", payload=None, skip_budget_check=False, _retried=False):
        if not skip_budget_check and self.is_approaching_limit():
            stats = self.get_usage_stats()
            raise RuntimeError(
                f"API budget exhausted ({stats['workspaceCalls']}/{stats['budget']} calls). "
                f"Wait for rate limit reset or increase TOGGL_API_BUDGET in Config."
            )
        is_profile = endpoint.startswith("/me")
        if is_profile:
            self.profile_calls += 1
        else:
            self.workspace_calls += 1

        resp = httpx.request(
            method.upper(), f"{TOGGL_API_V9_BASE}{endpoint}",
            headers={"Authorization": core_client.toggl_auth_header(), "Content-Type": "application/json"},
            content=payload, timeout=30,
        )
        if resp.status_code == 401 and not _retried:
            core_client.get_toggl_token(force=True)
            return self._v9(endpoint, method, payload, skip_budget_check, _retried=True)
        if resp.status_code == 429:
            raise RuntimeError("Toggl API rate limited (429). Wait for limit reset.")
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Toggl API Error: {resp.status_code}")
        return resp.json()

    def _reports_v3(self, endpoint, payload, skip_budget_check=False, _retried=False):
        if not skip_budget_check and self.is_approaching_limit():
            stats = self.get_usage_stats()
            raise RuntimeError(
                f"API budget exhausted ({stats['workspaceCalls']}/{stats['budget']} calls). "
                f"Wait for rate limit reset or increase TOGGL_API_BUDGET in Config."
            )
        workspace_id = self.get_or_fetch_workspace_id()
        self.workspace_calls += 1

        resp = httpx.post(
            f"{TOGGL_REPORTS_V3_BASE}/workspace/{workspace_id}{endpoint}",
            headers={"Authorization": core_client.toggl_auth_header(), "Content-Type": "application/json"},
            json=payload, timeout=30,
        )
        if resp.status_code == 401 and not _retried:
            core_client.get_toggl_token(force=True)
            return self._reports_v3(endpoint, payload, skip_budget_check, _retried=True)
        if resp.status_code == 429:
            raise RuntimeError("Toggl Reports API rate limited (429). Wait for limit reset.")
        if resp.status_code != 200:
            detail = resp.text
            try:
                j = resp.json()
                detail = j.get("message") or j.get("error") or detail
            except Exception:
                pass
            raise RuntimeError(f"Toggl Reports API Error: {resp.status_code} - {detail}")
        return resp.json()

    # ---- workspace ----

    def get_or_fetch_workspace_id(self):
        if self._workspace_id:
            return self._workspace_id
        workspace_id = get_setting("TOGGL_WORKSPACE_ID")
        if not workspace_id:
            me = self._v9("/me", skip_budget_check=True)
            workspace_id = str(me["default_workspace_id"])
        self._workspace_id = workspace_id
        return workspace_id

    # ---- tags ----

    def fetch_tags(self, force_refresh=False):
        if not force_refresh and self._tags_cache is not None:
            return self._tags_cache
        workspace_id = self.get_or_fetch_workspace_id()
        try:
            tags = self._v9(f"/workspaces/{workspace_id}/tags")
            self._tags_cache = tags
            return tags
        except RuntimeError:
            return self._tags_cache or []

    def ensure_tag_exists(self, tag_name):
        workspace_id = self.get_or_fetch_workspace_id()
        existing = self.fetch_tags()
        match = next((t for t in existing if t["name"].lower() == tag_name.lower()), None)
        if match:
            return match
        import json as _json
        tag = self._v9(f"/workspaces/{workspace_id}/tags", method="post", payload=_json.dumps({"name": tag_name}))
        if self._tags_cache is not None:
            self._tags_cache.append(tag)
        return tag

    def add_tag_to_time_entry(self, entry_id, tag_name):
        import json as _json
        workspace_id = self.get_or_fetch_workspace_id()
        return self._v9(
            f"/workspaces/{workspace_id}/time_entries/{entry_id}", method="put",
            payload=_json.dumps({"tags": [tag_name], "tag_action": "add"}),
        )

    def add_tag_to_multiple_entries(self, entry_ids, tag_name):
        """Bulk PATCH, up to 100 ids/call. The bulk endpoint requires a
        JSON-Patch array body -- confirmed live 2026-08-05, the plain
        {tags,tag_action} object 400s here even though it works on the
        single-entry PUT above. Do not "simplify" these back to matching
        forms; they're different endpoints with different contracts."""
        import json as _json
        workspace_id = self.get_or_fetch_workspace_id()
        results = {"success": 0, "failed": 0, "errors": [], "apiCalls": 0}
        if not entry_ids:
            return results

        self.ensure_tag_exists(tag_name)
        BATCH_SIZE = 100

        for i in range(0, len(entry_ids), BATCH_SIZE):
            batch = entry_ids[i:i + BATCH_SIZE]
            ids_string = ",".join(str(x) for x in batch)
            try:
                self._v9(
                    f"/workspaces/{workspace_id}/time_entries/{ids_string}", method="patch",
                    payload=_json.dumps([{"op": "add", "path": "/tags", "value": [tag_name]}]),
                )
                results["success"] += len(batch)
                results["apiCalls"] += 1
            except RuntimeError:
                for entry_id in batch:
                    try:
                        self.add_tag_to_time_entry(entry_id, tag_name)
                        results["success"] += 1
                        results["apiCalls"] += 1
                    except RuntimeError as inner:
                        results["failed"] += 1
                        results["errors"].append({"entryId": entry_id, "error": str(inner)})
        return results

    # ---- fetch: users / clients / projects / time entries ----

    def fetch_users(self, active_only=True, force_refresh=False):
        if not force_refresh and self._users_cache is not None:
            users = self._users_cache
        else:
            workspace_id = self.get_or_fetch_workspace_id()
            users = self._v9(f"/workspaces/{workspace_id}/users")
            self._users_cache = users
        return [u for u in users if not u.get("inactive") and u.get("active") is not False] if active_only else users

    def fetch_clients(self, force_refresh=False):
        if not force_refresh and self._clients_cache is not None:
            return self._clients_cache
        workspace_id = self.get_or_fetch_workspace_id()
        clients = self._v9(f"/workspaces/{workspace_id}/clients")
        self._clients_cache = clients
        return clients

    def fetch_projects(self, active_only=True, force_refresh=False):
        workspace_id = self.get_or_fetch_workspace_id()
        if not force_refresh and self._projects_cache is not None:
            active, all_projects = self._projects_cache
            return active if active_only else all_projects
        active = self._v9(f"/workspaces/{workspace_id}/projects?active=true")
        if active_only:
            self._projects_cache = (active, None)
            return active
        try:
            archived = self._v9(f"/workspaces/{workspace_id}/projects?active=false")
        except RuntimeError:
            archived = []
        all_projects = active + archived
        self._projects_cache = (active, all_projects)
        return all_projects

    def fetch_time_entries_all_users(self, start_date, end_date):
        """Reports API v3, paginated + flattened. Each row may contain a
        nested time_entries[] array (grouped format); flatten to one dict
        per individual entry, carrying the row-level fields down."""
        all_rows = []
        first_row_number = 1
        page_size = 50
        while True:
            payload = {"start_date": start_date, "end_date": end_date,
                       "first_row_number": first_row_number, "page_size": page_size}
            response = self._reports_v3("/search/time_entries", payload)
            if not isinstance(response, list) or not response:
                break
            all_rows.extend(response)
            if len(response) < page_size:
                break
            first_row_number += len(response)

        flattened = []
        for row in all_rows:
            if row.get("time_entries"):
                for te in row["time_entries"]:
                    flattened.append({
                        "id": te.get("id"), "start": te.get("start"), "stop": te.get("stop"),
                        "seconds": extract_duration_seconds(te), "at": te.get("at"),
                        "user_id": row.get("user_id"), "project_id": row.get("project_id"),
                        "task_id": row.get("task_id"), "tag_ids": row.get("tag_ids") or [],
                        "description": row.get("description") or "", "billable": row.get("billable") or False,
                    })
            else:
                if not row.get("seconds") and (row.get("duration") or row.get("dur")):
                    row["seconds"] = extract_duration_seconds(row)
                flattened.append(row)
        return flattened

    # ---- lookups ----

    def build_toggl_lookups(self):
        """Simplified from the Apps Script version: task NAMES are no
        longer sourced here at all (post-D2, the sheet-backed
        useSheetForTasks path was already vestigial -- its output was
        always overwritten by Back Office's togglTaskName immediately
        after in every live caller). Callers merge task names in from
        Back Office's mapping fetch directly."""
        users = self.fetch_users()
        clients = self.fetch_clients()
        projects = self.fetch_projects(active_only=False)
        tags = self.fetch_tags()

        lookups = {"users": {}, "clients": {}, "projects": {}, "tasks": {}, "tags": {}}
        for u in users:
            lookups["users"][u["id"]] = u.get("fullname") or u.get("name") or u.get("email")
        for c in clients:
            lookups["clients"][c["id"]] = c["name"]
        for p in projects:
            lookups["projects"][p["id"]] = {
                "name": p["name"], "clientId": p.get("client_id"),
                "clientName": lookups["clients"].get(p.get("client_id"), "") if p.get("client_id") else "",
            }
        for t in tags:
            lookups["tags"][t["id"]] = t["name"]
            lookups["tags"][t["name"]] = t["name"]
        return lookups
