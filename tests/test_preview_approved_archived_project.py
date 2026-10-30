"""_preview_approved must show the real project name for an entry on an
archived Toggl project, not "—". Before the 2026-10-30 fix, it called
toggl.fetch_projects() with the active_only=True default, so an archived
project's id was never in project_map and the preview (like the live push)
silently treated the entry as projectless.
"""
import back_office_client
import routes
from toggl_client import TogglClient


def _patch_common(monkeypatch, entries, projects):
    monkeypatch.setattr(routes.sync_engine, "get_import_date_range",
                         lambda: {"startDate": "2026-04-27", "endDate": "2026-05-03"})
    monkeypatch.setattr(routes.sync_engine, "get_approved_tag_name", lambda: "Approved")
    monkeypatch.setattr(routes.sync_engine, "get_synced_tag_name", lambda: "Synced")
    monkeypatch.setattr(routes.sync_engine, "build_already_synced_map", lambda: {})
    monkeypatch.setattr(TogglClient, "fetch_time_entries_all_users", lambda self, s, e: entries)
    monkeypatch.setattr(TogglClient, "fetch_tags", lambda self, force_refresh=False: [])
    monkeypatch.setattr(TogglClient, "fetch_users", lambda self, force_refresh=False: [
        {"id": 1, "fullname": "Diego Ford"},
    ])

    def _fake_fetch_projects(self, active_only=True, force_refresh=False):
        return projects if not active_only else [p for p in projects if p.get("active", True)]

    monkeypatch.setattr(TogglClient, "fetch_projects", _fake_fetch_projects)
    monkeypatch.setattr(back_office_client, "build_mapping_lookups", lambda abort_on_failure=False: {"tasks": {}})


def test_archived_project_resolves_to_real_name(monkeypatch):
    entries = [{
        "id": 4385293982, "user_id": 1, "project_id": 213486763,
        "tags": ["Approved"], "description": "PGN: Merge Console File to Template",
        "start": "2026-04-28T10:00:00Z", "seconds": 3600, "billable": True,
    }]
    projects = [{"id": 213486763, "name": "PGN", "active": False, "client_id": 47944630}]
    _patch_common(monkeypatch, entries, projects)

    result = routes._preview_approved({})

    assert result["count"] == 1
    assert result["entries"][0]["project"] == "PGN"


def test_active_project_unaffected(monkeypatch):
    entries = [{
        "id": 1, "user_id": 1, "project_id": 100,
        "tags": ["Approved"], "description": "whatever",
        "start": "2026-04-28T10:00:00Z", "seconds": 3600, "billable": True,
    }]
    projects = [{"id": 100, "name": "Active Project", "active": True, "client_id": 10}]
    _patch_common(monkeypatch, entries, projects)

    result = routes._preview_approved({})

    assert result["entries"][0]["project"] == "Active Project"
