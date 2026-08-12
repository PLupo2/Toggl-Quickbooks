"""QBO + Toggl token vending from PLT Core (Phase 3 / R3).

Contract verified live 2026-08-12 against the newly-issued 'timesync' Core
service key (scopes token:qbo, token:toggl):
  GET https://core.pltheatrical.com/api/token/qbo   -> {access_token, realm_id, api_base_url, expires_at, vendor}
  GET https://core.pltheatrical.com/api/token/toggl -> {access_token, expires_at, obtained_at, vendor}

QBO's token expires and is cached with a safety margin, refreshed on a
downstream 401 (never call Intuit's own refresh endpoint -- only re-ask
Core, matching qb-bookkeeper/back-office's pattern). Toggl vends a token
too, but its own field also carries expires_at/obtained_at in this
deployment, so it's treated as a normal (if long-lived) expiring token,
not assumed static -- more conservative than the older back-office client
this was modeled on, and correct either way.

Auth to Core is two-layer: Cloudflare Access Service Auth
(CF-Access-Client-Id/Secret -- a Zero Trust service token, gates the zone)
plus an app-layer X-Api-Key Core validates itself. A custom User-Agent is
required -- Core's WAF blocks the default urllib/httpx UA before Access is
even evaluated.
"""
import os
import time
from base64 import b64encode

import httpx

SECRETS_DIR = os.environ.get("SECRETS_DIR", "/run/secrets")
CORE_URL = os.environ.get("CORE_URL", "https://core.pltheatrical.com")
_USER_AGENT = "plt-timesync/1.0 (+PLT Core consumer)"
_EXPIRY_MARGIN_S = 120

_qbo_cache = {}    # {access_token, realm_id, api_base_url, expires_at}
_toggl_cache = {}  # {access_token, expires_at}


def _read_secret(filename):
    with open(os.path.join(SECRETS_DIR, filename)) as f:
        return f.read().strip()


def _core_headers():
    return {
        "X-Api-Key": _read_secret("plt_core_timesync_api_key.txt"),
        "CF-Access-Client-Id": _read_secret("plt_core_cf_client_id.txt"),
        "CF-Access-Client-Secret": _read_secret("plt_core_cf_client_secret.txt"),
        "Accept": "application/json",
        "User-Agent": _USER_AGENT,
    }


def _fetch_core_token(vendor):
    try:
        resp = httpx.get(f"{CORE_URL}/api/token/{vendor}", headers=_core_headers(), timeout=30)
    except httpx.HTTPError as e:
        raise RuntimeError(f"PLT Core unreachable for {vendor} token: {e}") from e
    if resp.status_code != 200:
        raise RuntimeError(f"PLT Core {vendor} token vend failed: {resp.status_code} — {resp.text}")
    return resp.json()


def _expired(expires_at):
    if not expires_at:
        return True
    try:
        # Core returns ISO-8601 with an explicit offset; fromisoformat handles it
        # on Python 3.11+, but be defensive about a trailing 'Z'.
        from datetime import datetime, timezone
        iso = expires_at.replace("Z", "+00:00")
        exp = datetime.fromisoformat(iso)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return (exp - datetime.now(timezone.utc)).total_seconds() < _EXPIRY_MARGIN_S
    except (ValueError, TypeError):
        return True


def get_qbo_token(force=False):
    """Returns the cached QBO token dict, refreshing from Core if force or expired."""
    if force or not _qbo_cache.get("access_token") or _expired(_qbo_cache.get("expires_at")):
        _qbo_cache.update(_fetch_core_token("qbo"))
    return _qbo_cache


def get_toggl_token(force=False):
    if force or not _toggl_cache.get("access_token") or _expired(_toggl_cache.get("expires_at")):
        _toggl_cache.update(_fetch_core_token("toggl"))
    return _toggl_cache["access_token"]


def toggl_auth_header():
    """Basic auth header for Toggl API calls -- token:api_token scheme,
    matching the current Apps Script getTogglAuthHeader()."""
    creds = b64encode(f"{get_toggl_token()}:api_token".encode()).decode()
    return f"Basic {creds}"
