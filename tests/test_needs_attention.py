"""routes._get_needs_attention / _get_sync_log enrichment / _get_dashboard
needs_attention_count. All three are sync_log-derived (no Toggl call); remedy
links come from one mocked Back Office mapping fetch + the cached workspace id.
Driven against a temp SQLite DB built from db.init_db (real schema, incl. the
new Toggl-id columns)."""
import pytest

import back_office_client
import db
import routes

MAPPINGS = {
    "users": {}, "clients": {}, "tasks": {},
    "projects": {"199999595": {"qboProjectId": "459", "qboProjectName": "Nos"}},
}


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    monkeypatch.setattr(db, "DB_PATH", str(path))
    db.init_db()
    # Mock the shared Back Office mapping fetch + cache the workspace id.
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", lambda abort_on_failure=True: MAPPINGS)
    conn = db.get_db()
    conn.execute(
        "INSERT INTO connection_status_cache (id, toggl_workspace_id, computed_at) VALUES (1, '4056428', '')"
    )
    conn.commit()
    conn.close()
    return str(path)


def _insert(**f):
    cols = ["synced_at", "toggl_entry_id", "qbo_timeactivity_id", "date", "duration",
            "toggl_user", "qbo_employee", "toggl_client", "toggl_project", "qbo_customer",
            "qbo_project", "toggl_task", "qbo_service_item", "description", "billable",
            "status", "error", "toggl_project_id", "toggl_task_id", "toggl_user_id"]
    defaults = {c: "" for c in cols}
    defaults["billable"] = 0
    defaults.update(f)
    conn = db.get_db()
    conn.execute(
        f"INSERT INTO sync_log ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        [defaults[c] for c in cols],
    )
    conn.commit()
    conn.close()


# ---- getNeedsAttention ----

def test_needs_attention_lists_failed_and_held(temp_db):
    _insert(toggl_entry_id="A", status="Failed", toggl_project="HTS", toggl_user="Jane",
            date="2026-11-10", duration="1:30",
            error="No QBO customer mapping for client: (no client)",
            toggl_project_id="199999595")
    _insert(toggl_entry_id="B", status="Held", toggl_project="SN26", toggl_user="Phil",
            date="2026-11-11", duration="0:45",
            error="Waiting on bill rate: no bill rate set in Back Office for this role on this project.")
    out = routes._get_needs_attention({})
    assert out["count"] == 2
    by_id = {e["entry_id"]: e for e in out["entries"]}
    a = by_id["A"]
    assert a["reason"] == "no_client"
    assert a["person"] == "Jane" and a["project"] == "HTS"
    assert a["hours"] == 1.5
    assert a["link"] == "https://track.toggl.com/4056428/projects/199999595"
    assert a["instruction"] and a["link_label"]
    assert by_id["B"]["reason"] == "no_rate"


def test_needs_attention_drops_entry_with_later_success(temp_db):
    _insert(toggl_entry_id="C", status="Failed", error="No QBO customer mapping for client: (no client)")
    _insert(toggl_entry_id="C", status="Success")  # later row -> resolved, drops off
    out = routes._get_needs_attention({})
    assert out["count"] == 0


def test_needs_attention_excludes_already_synced_status(temp_db):
    _insert(toggl_entry_id="D", status="Already synced")
    out = routes._get_needs_attention({})
    assert out["count"] == 0


def test_needs_attention_uses_latest_row_only(temp_db):
    _insert(toggl_entry_id="E", status="Failed", error="old")
    _insert(toggl_entry_id="E", status="Held",
            error="Waiting on bill rate: Toggl user not mapped in Back Office.")
    out = routes._get_needs_attention({})
    assert out["count"] == 1
    assert out["entries"][0]["reason"] == "unknown_user"


# ---- getSyncLog enrichment ----

def test_sync_log_enriches_failed_held_rows(temp_db):
    _insert(toggl_entry_id="F", status="Failed", toggl_project="HTS",
            error="No QBO service item mapping for task: (no task). Set DEFAULT...",
            toggl_project_id="199999595")
    out = routes._get_sync_log({})
    row = out["entries"][0]
    assert "remedy" in row
    assert row["remedy"]["reason"] == "no_task"
    assert row["remedy"]["link"] == "https://track.toggl.com/4056428/projects/199999595"
    assert row["resolved_later"] is False


def test_sync_log_resolved_later_tag(temp_db):
    _insert(toggl_entry_id="G", status="Held",
            error="Waiting on bill rate: no bill rate set in Back Office for this role on this project.")
    _insert(toggl_entry_id="G", status="Success")  # later Success
    out = routes._get_sync_log({})
    # The Held row carries resolved_later True; the Success row has no remedy.
    held = next(e for e in out["entries"] if e["Status"] == "Held")
    success = next(e for e in out["entries"] if e["Status"] == "Success")
    assert held["resolved_later"] is True
    assert "remedy" not in success


def test_sync_log_success_rows_unenriched(temp_db):
    _insert(toggl_entry_id="H", status="Success")
    out = routes._get_sync_log({})
    assert "remedy" not in out["entries"][0]
    assert "resolved_later" not in out["entries"][0]


# ---- dashboard count ----

def test_dashboard_needs_attention_count(temp_db):
    _insert(toggl_entry_id="I", status="Failed", error="x")
    _insert(toggl_entry_id="J", status="Held",
            error="Waiting on bill rate: no bill rate set in Back Office for this role on this project.")
    _insert(toggl_entry_id="K", status="Success")
    _insert(toggl_entry_id="L", status="Already synced")
    out = routes._get_dashboard({})
    assert out["needs_attention_count"] == 2
