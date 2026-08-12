# TimeSync Smoke Test

> **Phase 3 backend migration in progress (started 2026-08-12, not live yet).** This checklist targets the Google Apps Script system, still the live one — run it after any `clasp deploy`. The Phase 3 FastAPI/Docker build has its own verification discipline (real-data checks + a real browser render pass per phase) documented in the build's commits and `~/Projects/stage-manager/state/timesync-handoff.json`; a proper smoke checklist for that system will land around cutover.

A short post-deploy checklist for the current architecture (tag-based sync,
`Sync_Log` dedup authority, mappings fetched from Back Office, Cloudflare
Access + Worker in front of the dashboard). Run the relevant rows after any
`clasp deploy` to Production or a change to the sync path. There are no
automated tests; this is the manual safety net.

> Replaces the old comprehensive suite, which had drifted across three
> architecture migrations (Inbox/Queue → tag-based, Phase 2 Access, D2 Back
> Office mappings). A stale test script is worse than a short accurate one.

## Preconditions
- QBO connected (Sandbox for a dry test, Production for the real one)
- Toggl API token valid
- `BACK_OFFICE_*` Script Properties set; Back Office reachable with mappings maintained
- Know which deployment is live: `clasp deployments` (the Production id is the one the Worker's `APPS_SCRIPT_URL` points at)

## 1. Connections
- [ ] **Setup > Show QBO Connection Status** → Connected, correct realm
- [ ] **Setup > Show Toggl Status** → Connected
- [ ] Dashboard loads at `timesync.pltheatrical.com` behind the Access OTP (no secret in the browser)

## 2. Mapping fetch (Back Office)
- [ ] Run **Sync Operations > Preview Approved Entries**; execution log shows `Mapping lookups fetched from Back Office: N users, N clients, N projects, N tasks` with plausible counts
- [ ] Mapped entities resolve with no spurious "missing mapping" errors

## 3. Fail-safe on mapping fetch failure
- [ ] Temporarily break one `BACK_OFFICE_*` Script Property, run **Sync Approved Entries**
- [ ] Run aborts **before any QBO write**; email arrives at philip@pltheatrical.com; Approved entries keep their tag (no "Synced" added); no new `Sync_Log` success rows, no new TimeActivity records
- [ ] Restore the property

## 4. Real sync — the money path (do this for the first Production sync after cutover)
- [ ] Tag one or two genuine entries "Approved" in Toggl
- [ ] Preview shows them (and reports any already-synced count correctly)
- [ ] **Sync Approved Entries** → success; entries get the "Synced" tag; `Sync_Log` rows written
- [ ] **Spot-check in QBO:** each new TimeActivity lands on the correct employee / customer (sub-customer if the project maps to one) / service item, matching Back Office's mapping for that Toggl user/client/project/task
- [ ] Note: the `Sync_Log` "Toggl Task" column is blank by design post-D2 (display only); QBO service item still resolves by task ID

## 5. Idempotency
- [ ] Re-run **Sync Approved Entries** immediately → the just-synced entries are skipped (Sync_Log is the dedup authority), no duplicate TimeActivity records

## 6. Dashboard parity
- [ ] Trigger a sync from the dashboard Sync page; it starts a job and polls to completion (async job path)
- [ ] **Settings** page: change a field and **Save** → success toast, value persists on reload (verifies the write allow-list, incl. `BATCH_SIZE` and the `QBO_ENV` → Script Property routing)

## Rollback
- Production Apps Script: `clasp deploy -i <deployment-id> --versionNumber <n>` (last known-good is a prior version number from `clasp versions`)
- Frontend: `git revert <commit>` and push (GitHub Pages redeploys)
