"""fetch_projects pagination (2026-10-30).

Real incident: the unpaginated ?active=false call silently truncated the
archived project list below the workspace's real total (263 archived
projects vs. a ~151-item default page), so 4 archived projects -- including
WDCI2526, PGN, THRT25, THP -- never appeared in the lookup. Every time entry
on one of those projects resolved to no project/client at all, and 20 of
them failed to push with "No QBO customer mapping for client: (no client)"
(2026-10-30 run, QB Bookkeeper finding F2026-032). Network calls are mocked;
nothing here talks to the real Toggl API.
"""
import toggl_client


def _client(monkeypatch, pages_by_active):
    """pages_by_active: {"true": [[...page1], [...page2]], "false": [...]}"""
    calls = []

    def _fake_v9(self, endpoint, method="get", payload=None, skip_budget_check=False, _retried=False):
        calls.append(endpoint)
        active_param = "true" if "active=true" in endpoint else "false"
        page = int(endpoint.split("&page=")[1])
        pages = pages_by_active.get(active_param, [])
        return pages[page - 1] if page <= len(pages) else []

    monkeypatch.setattr(toggl_client.TogglClient, "_v9", _fake_v9)
    monkeypatch.setattr(toggl_client.TogglClient, "get_or_fetch_workspace_id", lambda self: "4056428")
    client = toggl_client.TogglClient()
    return client, calls


def _project(pid, name):
    return {"id": pid, "name": name, "client_id": 1}


def test_archived_list_spans_multiple_pages(monkeypatch):
    page_size = toggl_client.TogglClient.PROJECTS_PAGE_SIZE
    full_page = [_project(i, f"Archived{i}") for i in range(page_size)]
    second_page = [_project(300, "WDCI2526")]

    client, calls = _client(monkeypatch, {
        "true": [[_project(1, "Active1")]],
        "false": [full_page, second_page],
    })

    all_projects = client.fetch_projects(active_only=False)

    ids = {p["id"] for p in all_projects}
    assert 300 in ids, "archived project past the first (truncated) page must still resolve"
    assert len(all_projects) == 1 + page_size + 1
    assert any("page=2" in c for c in calls if "active=false" in c)


def test_project_list_cached_per_run(monkeypatch):
    client, calls = _client(monkeypatch, {
        "true": [[_project(1, "Active1")]],
        "false": [[_project(2, "Archived1")]],
    })

    client.fetch_projects(active_only=False)
    calls_after_first = len(calls)
    client.fetch_projects(active_only=True)
    client.fetch_projects(active_only=False)

    assert len(calls) == calls_after_first, "a second/third call on the same instance must not re-hit Toggl"


def test_active_only_still_includes_projects_fetched_for_full_set(monkeypatch):
    client, _ = _client(monkeypatch, {
        "true": [[_project(1, "Active1")]],
        "false": [[_project(2, "Archived1")]],
    })

    active = client.fetch_projects(active_only=True)
    assert [p["id"] for p in active] == [1]
