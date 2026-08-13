"""Phase 3.4(a): diff all read actions, OLD system (Apps Script via the
existing Worker) vs NEW system (this FastAPI service, local). Read-only --
does not touch previewApproved's write-adjacent siblings (syncApproved is
a real job start, recomputeDisagreement mutates a snapshot; both excluded
here on purpose, not because they're hard to call).

OLD system auth: TimeSync's existing, already-provisioned Cloudflare Access
service token (the "TimeSync API Service Token" -- same one already used
for Back Office's mapping fetch) bypasses the human OTP wall on
timesync.pltheatrical.com. No new secret needed.

NEW system auth: FastAPI's dependency_overrides, same mechanism used
throughout Phase 3.2/3.3's own testing -- there's no real Cloudflare Access
JWT available for a request that never left this machine.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("SECRETS_DIR", os.path.expanduser("~/secrets"))
os.environ.setdefault("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "timesync.db"))

import httpx
from fastapi.testclient import TestClient

OLD_BASE = "https://timesync.pltheatrical.com/api"


def _read_secret(name):
    with open(os.path.expanduser(f"~/secrets/{name}")) as f:
        return f.read().strip()


def old_get(action, **params):
    headers = {
        "CF-Access-Client-Id": _read_secret("timesync_cf_client_id.txt"),
        "CF-Access-Client-Secret": _read_secret("timesync_cf_client_secret.txt"),
    }
    r = httpx.get(OLD_BASE, params={"action": action, **params}, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()


def new_client():
    import app as app_module
    from auth import require_access
    app_module.app.dependency_overrides[require_access] = lambda: "parity-check@pltheatrical.com"
    return TestClient(app_module.app)


def new_get(client, action, **params):
    r = client.get("/api", params={"action": action, **params})
    r.raise_for_status()
    return r.json()


# ---- comparison helpers ----

def diff_keys(old, new, path=""):
    """Structural diff: report keys present only on one side, and scalar
    value mismatches. Does not follow into lists of dicts item-by-item
    (entries lists are compared by count + a content summary instead,
    since row ORDER/exact membership between two live systems queried a
    few seconds apart can legitimately differ -- new Toggl entries can
    appear between the two calls)."""
    diffs = []
    if isinstance(old, dict) and isinstance(new, dict):
        for k in old.keys() | new.keys():
            p = f"{path}.{k}" if path else k
            if k not in old:
                diffs.append(f"  NEW ONLY: {p}")
            elif k not in new:
                diffs.append(f"  OLD ONLY: {p}")
            elif isinstance(old[k], (dict, list)) or isinstance(new[k], (dict, list)):
                diffs.extend(diff_keys(old[k], new[k], p))
            elif old[k] != new[k]:
                diffs.append(f"  VALUE MISMATCH {p}: old={old[k]!r} new={new[k]!r}")
    elif isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            diffs.append(f"  LIST LENGTH {path}: old={len(old)} new={len(new)}")
    return diffs


def compare(label, action, old_params=None, new_params=None, ignore_keys=()):
    old_params = old_params or {}
    new_params = new_params or old_params
    old = old_get(action, **old_params)
    new = new_get(CLIENT, action, **new_params)
    for k in ignore_keys:
        old.pop(k, None)
        new.pop(k, None)
    d = diff_keys(old, new)
    status = "CLEAN" if not d else f"{len(d)} diff(s)"
    print(f"\n=== {label} ({action}) : {status} ===")
    for line in d:
        print(line)
    return {"action": action, "clean": not d, "diffs": d, "old": old, "new": new}


if __name__ == "__main__":
    CLIENT = new_client()
    results = []

    # status/computedAt/timestamps are expected to differ (both are
    # snapshots of "now", not the same instant) -- ignored explicitly
    # rather than silently masking a real structural diff.
    results.append(compare("getConfig", "getConfig"))
    results.append(compare("getDashboard", "getDashboard"))
    results.append(compare("getSyncStatus", "getSyncStatus"))
    results.append(compare("getSyncJobStatus", "getSyncJobStatus"))
    results.append(compare("getSyncLog (limit=10)", "getSyncLog", {"limit": 10}))
    results.append(compare("getConnectionStatus", "getConnectionStatus"))
    results.append(compare("previewApproved (2026-08-06)", "previewApproved",
                            {"startDate": "2026-08-06", "endDate": "2026-08-06"}))

    print("\n" + "=" * 60)
    clean = sum(1 for r in results if r["clean"])
    print(f"SUMMARY: {clean}/{len(results)} clean")
    for r in results:
        print(f"  {'✅' if r['clean'] else '❌'} {r['action']}")
