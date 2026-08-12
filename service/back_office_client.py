"""Mapping fetch from Back Office -- ported from Mappings.gs's
buildMappingLookups + abortRunForMappingFetchFailure. Behavior unchanged:
one bulk GET per call, held in memory by the caller for that run/request.
On failure, the production sync path aborts (raises) and best-effort pings
Pushover; read-only callers (the preview route) pass abort_on_failure=False
to degrade gracefully instead.
"""
import json
import os
import urllib.request

SECRETS_DIR = os.environ.get("SECRETS_DIR", "/run/secrets")


def _read_secret(filename, default=""):
    try:
        with open(os.path.join(SECRETS_DIR, filename)) as f:
            return f.read().strip()
    except OSError:
        return default


def _send_pushover(title, message):
    """Best-effort alert -- replaces Apps Script's MailApp.sendEmail to
    Philip. Matches Back Office's own _send_pushover pattern exactly
    (env-var credentials, silent no-op if unconfigured)."""
    try:
        token = os.environ.get("PUSHOVER_TOKEN", "")
        user = os.environ.get("PUSHOVER_USER", "")
        if not token or not user:
            return
        data = json.dumps({"token": token, "user": user, "title": title, "message": message}).encode()
        req = urllib.request.Request("https://api.pushover.net/1/messages.json", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def _abort(reason, abort_on_failure):
    if not abort_on_failure:
        return None
    _send_pushover(
        "TimeSync: sync aborted",
        f"Back Office mapping fetch failed — {reason}. No mappings were cached or reused. "
        f"Approved entries keep their tag and will sync next run once fixed.",
    )
    raise RuntimeError(f"Sync aborted: {reason}")


def build_mapping_lookups(abort_on_failure=True):
    """Returns {users, clients, projects, tasks} or None (only possible when
    abort_on_failure=False and the fetch failed)."""
    import httpx

    url = os.environ.get("BACK_OFFICE_MAPPINGS_URL", "https://backoffice.pltheatrical.com/api/mappings/all")
    cf_client_id = _read_secret("timesync_cf_client_id.txt")
    cf_client_secret = _read_secret("timesync_cf_client_secret.txt")
    api_key = _read_secret("back_office_timesync_api_key.txt")

    if not cf_client_id or not cf_client_secret or not api_key:
        return _abort("Back Office credentials not configured", abort_on_failure)

    try:
        resp = httpx.get(
            url,
            headers={
                "CF-Access-Client-Id": cf_client_id,
                "CF-Access-Client-Secret": cf_client_secret,
                "X-Api-Key": api_key,
            },
            timeout=30,
        )
    except httpx.HTTPError as e:
        return _abort(f"Back Office mapping fetch threw: {e}", abort_on_failure)

    if resp.status_code != 200:
        return _abort(f"Back Office mapping fetch returned {resp.status_code}: {resp.text[:300]}", abort_on_failure)

    try:
        mappings = resp.json()
    except ValueError as e:
        return _abort(f"Back Office mapping response was not valid JSON: {e}", abort_on_failure)

    if not mappings or not all(k in mappings for k in ("users", "clients", "projects", "tasks")):
        return _abort("Back Office mapping response missing an expected key (users/clients/projects/tasks)", abort_on_failure)

    return mappings
