# TimeSync (Toggl-Quickbooks)

Syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, using a tag-based approval workflow. Web UI at timesync.pltheatrical.com.

**One system exists in this repo now.** The FastAPI service (`service/`) is what serves production traffic. The Google Apps Script system that preceded it (described in Phase 3 history below) was demolished 2026-09-03 — see "LEGACY SYSTEM — DEMOLISHED" below for exactly what was removed and what wasn't.

## LEGACY SYSTEM — DEMOLISHED 2026-09-03

The original Google Apps Script system (bound to a Google Sheet, Toggl Track API v9 + QBO REST via OAuth, web UI on GitHub Pages, Cloudflare Worker proxying `/api/*`) was retired from live traffic 2026-08-13 (Phase 3.5 cutover) and demolished after the Phase 3.6/3.7 burn-in + dormancy window. Removed from this repo and from Cloudflare/GitHub:
- All root-level Apps Script source: `Auth.gs`, `Config.gs`, `Mappings.gs`, `Menu.gs`, `QuickBooks.gs`, `Toggl.gs`, `WebAPI.gs`, `appsscript.json`
- clasp project files: `.clasp.json` (scriptId `1Ttcjyi8ddzMK8mQUpzPooeaT3zt6JowdrNGzQEuFwuy9g9ItHcDtWyiy`, not deleted from Google Drive/Apps Script itself — only the local clasp mirror), `.claspignore`
- `worker/` directory (Cloudflare Worker source, `timesync-api-proxy`) and the deployed Worker script itself (deleted from Cloudflare via API)
- `.github/workflows/deploy-pages.yml` (GitHub Actions Pages deployment), and GitHub Pages was disabled on the repo (`PLupo2/Toggl-Quickbooks`)
- A final in-flight change (Back Office preflight-corrections check, `Toggl.gs`/`WebAPI.gs`) was committed to git history before deletion so the work isn't lost even though the files are gone.

**Explicitly NOT removed, because both are live production for the current FastAPI system, not legacy:**
- `web/` — the static UI directory. It was originally built for GitHub Pages, but Phase 3 repointed the FastAPI service to serve it directly (`service/app.py` mounts `web/` as static files) rather than porting it. It is the live UI today.
- The Cloudflare Access app named "TimeSync" (`8eddb196-3382-425c-85e3-15dc49f4bfc2`, hostname-scoped to `timesync.pltheatrical.com`) — this is the same Access app that gated the old system and now gates the live FastAPI service; there was never a separate legacy-only policy.

`docs/` (`DEPLOYMENT.md`, `OAUTH_SETUP.md`, `TEST_CASES.md`) documents the old system and was left in place as historical reference, not deleted.

## PHASE 3 — FastAPI on the Mac Mini (LIVE — serving timesync.pltheatrical.com since 2026-08-13)

**Motivation:** a 2026-08-12 root-cause diagnosis (spec doc) measured Apps Script's `/exec → googleusercontent.com` serving layer at ~29% first-attempt failure / ~10% hard-fail on dashboard reads, with multi-minute dead windows. Four prior mitigation rounds narrowed but could not fix it. Philip approved a full migration off Apps Script rather than a fifth mitigation (2026-08-12, rulings R1–R5, spec doc).

**Target:** one FastAPI service in Docker (container `timesync`, port 5175) serving both the web UI and API at `timesync.pltheatrical.com`, behind the same (already-existing, hostname-scoped) Cloudflare Access app. `timesync.db` (SQLite) replaces the Google Sheet for `Sync_Log` + `Config`. QBO/Toggl tokens vend from PLT Core. Sandbox toggle retired (Core vends production only). Full rulings/scope/acceptance: Phase 3 entry in the spec doc.

**Status: Phases 3.1–3.5 of 7 complete and verified. Phase 3.5 (all 6 steps) EXECUTED 2026-08-13** — DNS points at the tunnel, the FastAPI service on the Mac Mini is what's actually serving `timesync.pltheatrical.com`, and the Apps Script/Worker/Pages system is no longer live traffic. Step 6 (Philip's real Cloudflare Access click-through sign-off): the 03:21–03:29 UTC browser session that filtered to 2026-08-10 and ran job `028aba9e-ad2c-45a1-bac5-b157cbb60f32` (11 synced, 0 failed, 11 already-synced) was **confirmed by Philip in-channel 2026-08-12 23:36 EDT** to be him. Step 6 is DONE — the 3.6 burn-in window is now active. **Burn-in watchlist:** the transient `401` on a `getSyncJobStatus` poll at 03:28:02 UTC (self-recovered 47s later) — `auth.py`'s first real exercise against a genuine Cloudflare-issued JWT — flag it if it recurs during burn-in.

**2026-08-13 post-cutover fixes (commit c44914a) + frozen-counter closure:** (1) Cache middleware — Cache-Control: no-cache on all static/index responses; no deploy can serve stale UI again and no cache purge is ever needed for this app. (2) Sync scoping — sync_approved_entries filters to Approved + not-already-synced before the walk (idempotency guard unchanged, consulted earlier). (3) Progress text is "X of Y processed"; sync_job gained total_entries (in-place ALTER TABLE on the live DB). (4) The one stale edge object (cached ~04:32 UTC under the old max-age=14400) was manually purged by Philip ~05:10 UTC; X-of-Y verified live by Philip. **Diagnostic fingerprints for future front-end confusion:** status polls arriving WITHOUT a jobId param = browser running pre-102b6d5 JS; a Cloudflare purge cannot reach browser caches; Chrome's normal reload does NOT revalidate JS subresources (hard refresh does); hash-compare live-served vs container vs repo before trusting any "verified live" claim about front-end code. Portfolio-wide cache lesson + Back Office exposure recorded in the Infrastructure Reference doc.

- ✅ **3.1 Prerequisites**: PLT Core service key issued (`timesync`, scopes `token:qbo`+`token:toggl`, id 40) → `~/secrets/plt_core_timesync_api_key.txt`. CF Access AUD written → `~/secrets/cf_access_timesync_aud.txt`. Both verified live.
- ✅ **3.2 Build**: Full service built at `service/` (11 Python files) + `Dockerfile` + `docker-compose.yml`. Real port-scope audit found most of QuickBooks.gs and large parts of Toggl.gs are dead code with zero reachability — not ported. All 3,200 `Sync_Log` rows imported into `timesync.db` (a real Sheets date/duration serialization bug was caught and correctly reverse-engineered before trusting the import — verified against known QBO ground truth). Every module verified against real live data during the build, not fakes. **Found and fixed mid-build**: routes were initially built as per-resource REST paths before realizing the actual frontend always calls one `/api` endpoint with an `action` field — rewritten to match. Real Docker image built and run; healthy, all 11 actions HTTP-verified.
- ✅ **3.3 Local verification**: real Playwright browser render check (not just curl/TestClient) across all 5 pages. Caught a real bug TestClient testing missed: an exception-handler class mismatch (`fastapi.exceptions.HTTPException` vs `starlette.exceptions.HTTPException` — different classes in the installed version) meant auth failures returned an unnormalized body and crashed the dashboard instead of showing a clean error. Fixed and re-verified.
- ✅ **3.4 Internal parity gate**: (a) `service/parity_check.py` diffed all comparable read actions old-vs-new. Found and fixed two real gaps the 3.2 import missed — Phase 3.2 imported `Sync_Log` history but never the live Config sheet's actual *values*: `TOGGL_API_BUDGET` (live=220, was defaulted 180) and `DEFAULT_SERVICE_ITEM_ID`/`NAME` (live=`1`/`Services`, was blank — functionally significant, the fallback for untasked entries). A third diff (explicit `START_DATE`/`END_DATE` on the live sheet) was confirmed by Philip to be a stale leftover, correctly left unimported. (b) Ran a real `syncApproved` against the new service for the first time — 13 entries (everything approved-and-unsynced in the last 2 weeks). Pre-verified resolution for all 13 before writing. Completed in 28s: 13 synced, 0 failed, 496 already-synced. Independently verified in QBO **by canonical ID** (not name-fuzzy-matching, which gave a false alarm on differently-worded-but-correct item names on the first attempt — caught and redone properly): all 13 exact matches. Confirmed the Toggl-side `Synced` tag landed on all 13 source entries too.
- ✅ **3.5 Cutover steps 1-5 EXECUTED 2026-08-13.** Tunnel ingress rule added to `~/.cloudflared/config.yml` (`timesync.pltheatrical.com` → `http://localhost:5175`), daemon reloaded and confirmed serving (public request to `https://timesync.pltheatrical.com/` returns a genuine Cloudflare Access login redirect, not the old GitHub Pages response). Worker route `ea86f3edffce491cbbdc02a67c6576a1` deleted (confirmed gone via API — code 10007). DNS record `64e9d96d1dd953231de8cb5bfddc9692` repointed to `ca143e70-40b0-48b9-883e-32872f4363a5.cfargotunnel.com` (modified_on 2026-08-13T03:13:57Z). Step 4 (Sync_Log delta check) verified *retroactively* in a follow-up session (the execution session hit a context-fill error right after completing the flip, before it could confirm/report) — since the old system's HTTP path was already gone (route deleted, no workers.dev fallback enabled), verification used the Toggl API directly instead: all 33 entries tagged "Synced" in the last 3 days cross-checked present in the new system's `sync_log` (3,709 rows = 3,200 original import + 509 from the 3.4 test batch). No gap, no duplicate-QBO-write risk. **Step 6 (Philip's real click-through sign-off through actual Cloudflare Access) is DONE** — confirmed by Philip in-channel 2026-08-12 23:36 EDT that the 03:21 UTC session was him. Rollback (step 7 below) remains ready and untested-because-unneeded.

  <details><summary>Original step-by-step plan (for reference / rollback)</summary>

  **Pre-flight facts (as of 2026-08-13 planning pass):** DNS record id `64e9d96d1dd953231de8cb5bfddc9692` (CNAME → `plupo2.github.io`, proxied). Worker route id `ea86f3edffce491cbbdc02a67c6576a1` (`timesync.pltheatrical.com/api*` → script `timesync-api-proxy`). Tunnel id `ca143e70-40b0-48b9-883e-32872f4363a5`, config at `~/.cloudflared/config.yml`, credentials at `~/.cloudflared/ca143e70-40b0-48b9-883e-32872f4363a5.json`. TimeSync's Cloudflare Access app is hostname-scoped to exactly `timesync.pltheatrical.com` (no path restriction) — confirmed it needs zero changes for the origin swap. Delta-import gap was 0 at planning time (old system's Sync_Log still exactly 3,200 rows, unchanged since the original Phase 3.2 export) — re-check, don't assume, at execution time.

  1. **Add tunnel ingress rule** — edit `~/.cloudflared/config.yml`, insert before the `service: http_status:404` catch-all (must stay last):
     ```yaml
     - hostname: timesync.pltheatrical.com
       service: http://localhost:5175
     ```
  2. **Reload the tunnel daemon**: `sudo launchctl kickstart -k system/com.cloudflare.cloudflared` — this is `com.cloudflare.cloudflared`, NOT Stage Manager (`com.plt.stage-manager`), so it's outside that protection clause and safe to restart independently.
  3. **Verify the tunnel is actually serving the new origin before touching DNS** — confirm ingress live so a DNS flip doesn't point traffic at something broken.
  4. **Final Sync_Log delta check + import** — re-pull the old system's `getSyncLog` total (via the Worker + TimeSync's existing reusable CF Access service token, `~/secrets/timesync_cf_client_id.txt`/`_secret.txt` — same method used throughout Phase 3 testing, no new secret needed). If it's grown past 3,200, import just the new rows, deduped by `toggl_entry_id` — `service/import_sync_log.py` is initial-import-only (aborts on a non-empty table), so this needs a small delta-aware variant, not a reuse as-is. If still 3,200, this step is a confirmed no-op.
  5. **DNS repoint + Worker route deletion, same change, route first:**
     ```bash
     # a) delete the Worker route (stops /api* interception before DNS even moves)
     curl -X DELETE "https://api.cloudflare.com/client/v4/zones/f8560ea50c7d4be88bc51ebfd022c1ea/workers/routes/ea86f3edffce491cbbdc02a67c6576a1" \
       -H "Authorization: Bearer $(cat ~/secrets/cloudflare_wrangler_token.txt)"
     # b) repoint DNS to the tunnel
     curl -X PATCH "https://api.cloudflare.com/client/v4/zones/f8560ea50c7d4be88bc51ebfd022c1ea/dns_records/64e9d96d1dd953231de8cb5bfddc9692" \
       -H "Authorization: Bearer $(cat ~/secrets/cloudflare_api_token.txt)" -H "Content-Type: application/json" \
       -d '{"type":"CNAME","name":"timesync.pltheatrical.com","content":"ca143e70-40b0-48b9-883e-32872f4363a5.cfargotunnel.com","proxied":true}'
     ```
     Route deletion needs `cloudflare_wrangler_token.txt` (Workers+routes scope); DNS PATCH needs `cloudflare_api_token.txt` (DNS-only scope) — see Credentials Model in global CLAUDE.md.
  6. **Philip click-through sign-off** immediately post-flip, on the real `https://timesync.pltheatrical.com`, through actual Cloudflare Access — **not** the service-token bypass used for all Phase 3 testing so far. This is the first time the real container's real `auth.py` JWT-verification path is exercised against a genuine Cloudflare-issued token; everything through Phase 3.4 went through FastAPI's TestClient or the service-token bypass, never this exact path. Watch closely, don't assume proven.
  7. **Rollback** (ready in advance, not drafted only if needed): PATCH DNS record `64e9d96d1dd953231de8cb5bfddc9692` back to `{"content":"plupo2.github.io"}`, and recreate the Worker route (same pattern `timesync.pltheatrical.com/api*`, script `timesync-api-proxy`) if truly reverting. A few minutes end to end.

  </details>

- ✅ **3.6 burn-in COMPLETE** (window started 2026-08-13 ~23:36 EDT). No recurrence of the transient `getSyncJobStatus` 401 during burn-in.
- ✅ **3.7 demolition COMPLETE (2026-09-03).** Apps Script source, clasp files, `worker/`, the deployed Cloudflare Worker script, and the GitHub Pages workflow/site were all removed — see "LEGACY SYSTEM — DEMOLISHED" near the top of this file for the full list. Phase 3 (all 7 steps) is now fully closed out.

**Note on handoff files:** `~/Projects/stage-manager/state/timesync-handoff.json` has been observed getting cleared/consumed automatically (twice now, not always tied to an explicit restart mention) — treat it as a single-use aid for an imminent restart, NOT a durable record. This CLAUDE.md file, committed to git, is the durable source of truth for Phase 3 continuity.

**Full narrative handoff** (what was done, exact commands/commits, what remains, blockers): `~/Projects/stage-manager/state/timesync-handoff.json` — written 2026-08-12 specifically so a Stage Manager daemon restart can't lose continuity on this build. Read it before resuming Phase 3 work in a new session.

**Service architecture reference** (`service/`):
```
app.py              — FastAPI entrypoint; mounts web/ static, registers routes, /health unauthenticated
auth.py             — Cloudflare Access JWT verification (ported from Back Office's pattern)
core_client.py      — QBO + Toggl token vending from PLT Core
db.py               — SQLite schema: settings, sync_log, sync_job, disagreement_snapshot, connection_status_cache
back_office_client.py — mapping fetch (ported from Mappings.gs)
toggl_client.py     — Toggl API v9 + Reports v3 client (ported from Toggl.gs)
qbo_client.py       — qboRequest + createTimeActivity only (ported from QuickBooks.gs — the rest was dead)
sync_engine.py      — sync logic + D1-D4 idempotency guard + D5 async job. R4 simplification: the Apps
                      Script trigger-relaunch pause/resume machinery is replaced by an in-process wait in
                      a background thread (a native process has no execution-time ceiling to work around)
routes.py           — all 11 actions behind a SINGLE /api endpoint (action as GET param / POST body field),
                      mirroring handleApiRequest's dispatch, NOT per-resource REST paths
scheduler.py        — built, deliberately NOT wired into app.py — inert until Phase 3's scheduler is enabled
import_sync_log.py  — one-time Sheet-export → timesync.db import (already run for the initial 3,200 rows)
```
Container: `docker-compose up -d --build` from the repo root. `./data/timesync.db` and `~/secrets/*` are mounted, both gitignored (real business data / credentials, never committed). Live and publicly routable at `timesync.pltheatrical.com` since the 2026-08-13 cutover (port 5175 is the local/tunnel-internal address, not directly exposed).

## SPEC DOC
- Doc ID: `1AKjumu4V-Kqqp3z4CBjyFiKiwm5iFGV_HJVBCxvjEuM` ("Toggl-QuickBooks Sync — Spec & Changelog"). Phase 2 (2026-07-13), D2 cutover + cleanup (2026-08-11), root-cause diagnosis + Phase 3 approval (2026-08-12) all recorded there.

## CONVENTIONS
- Service code lives under `service/`; `web/` is the static UI, served directly by `service/app.py` (no separate frontend deploy pipeline)
- THE MAC MINI IS THE PRIMARY AND ONLY DEVELOPMENT PATH for this repo. MacBook is last resort only (physically-impossible-elsewhere tasks).
- TimeSync is actively used in production (real payroll-adjacent QBO writes) — changes are deliberate and verified before deploy. Verify modules against real live data, do a real browser check before trusting API-level tests alone.

## MODEL ROUTING
- L1 for config changes, CSS tweaks
- L2 for mapping logic, sync workflow, API client changes
- L3 for auth flow changes or web UI architecture changes
- Opus for changes touching both the sync engine and web UI simultaneously, or infrastructure/cutover-scale changes
