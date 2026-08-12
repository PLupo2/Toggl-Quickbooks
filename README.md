# Toggl Track → QuickBooks Online Time Sync

A Google Apps Script system that syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, using a tag-based approval workflow. Includes a standalone web dashboard at `timesync.pltheatrical.com`.

## Features

- **OAuth 2.0 Authentication**: Secure connection to QuickBooks Online with automatic token refresh
- **Tag-Based Workflow**: Tag entries with "Approved" in Toggl, sync to QBO, automatically get "Synced" tag
- **Centralized mappings (Back Office)**: Toggl↔QBO entity mappings (users→employees, clients→customers, projects→sub-customers, tasks→service items) live in **Back Office** (`backoffice.pltheatrical.com`), the single source of truth. TimeSync fetches them at sync time — see "Mappings" below.
- **Sub-Customers as Projects**: Uses QBO sub-customers to represent projects (no paid developer tier required)
- **Idempotency**: `Sync_Log` is the authority for "already synced"; the "Synced" tag is a review surface, not the dedup key
- **Deduplication**: Entries already recorded in `Sync_Log` are skipped to prevent duplicates
- **Environment Support**: Works with both QBO Sandbox and Production

## Data Flow

```
Toggl Track (tag "Approved")
      │
      ▼
Apps Script sync  ──fetch mappings──►  Back Office /api/mappings/all
      │
      ▼
QuickBooks Online (TimeActivity)
      │
      ▼
Toggl Track (auto-adds "Synced" tag)  +  Sync_Log row (dedup authority)
```

## Architecture

- **Runtime**: Google Apps Script bound to a Google Sheet (holds `Config` + `Sync_Log`)
- **Mappings**: Back Office (FastAPI + SQLite), fetched by `buildMappingLookups()` in one bulk GET per run
- **Web dashboard**: static site in `web/` (GitHub Pages), gated by Cloudflare Access, proxied through a Cloudflare Worker that injects the API secrets — see the "WEB API KEY / AUTH" section of `CLAUDE.md`
- **APIs**: Toggl Track API v9 + Reports API v3; QuickBooks Online REST via OAuth 2.0

## Requirements

### QuickBooks Online
- Intuit Developer account
- OAuth 2.0 app with `com.intuit.quickbooks.accounting` scope
- QBO company (Sandbox for testing, Production for live use)

### Toggl Track
- Toggl Track account with API access, API token from Profile settings
- Workspace ID (auto-detected if not provided)

### Back Office
- Reachable at `backoffice.pltheatrical.com` with the Toggl↔QBO mappings maintained there
- A scoped Cloudflare Access service token + Back Office API key for TimeSync (see Script Properties)

## Setup

### 1. Apps Script project + Script Properties

The `.gs` files at the repo root are the Apps Script project (deployed via `clasp`). Set these under **Project Settings > Script Properties**:

| Property | Description |
|----------|-------------|
| `TOGGL_API_TOKEN` | Toggl API token |
| `TOGGL_WORKSPACE_ID` | Workspace ID (optional; auto-detected) |
| `INTUIT_CLIENT_ID` / `INTUIT_CLIENT_SECRET` | QBO OAuth app credentials |
| `OAUTH_REDIRECT_URI` | Web App deployment URL |
| `QBO_REALM_ID` | Company ID (set after OAuth) |
| `QBO_ENV` | `sandbox` or `production` (this is the authoritative environment switch; the dashboard Settings page reads/writes it here) |
| `WORKER_SECRET` | Shared secret with the Cloudflare Worker (Phase 2 auth) |
| `WEB_API_KEY` | Secondary API key (Phase 2 auth) |
| `BACK_OFFICE_CF_ACCESS_CLIENT_ID` | Cloudflare Access service token (client id) for `/api/mappings/all` |
| `BACK_OFFICE_CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token (client secret) |
| `BACK_OFFICE_API_KEY` | Back Office API key (scoped to TimeSync) |
| `BACK_OFFICE_MAPPINGS_URL` | Optional; defaults to `https://backoffice.pltheatrical.com/api/mappings/all` |

### 2. Deploy as Web App

Deploy as a Web app (**Execute as: Me**, **Who has access: Anyone**) — required for the OAuth callback and the dashboard API. Copy the Web App URL to `OAUTH_REDIRECT_URI`. Note: `clasp push` updates HEAD only; promote to the live web path with `clasp deploy -i <deployment-id>`.

### 3. Build sheets

**Setup > Build All Sheets** creates `Config` and `Sync_Log` (the only sheets TimeSync owns; mappings are not in sheets).

### 4. Connect to QuickBooks

**Setup > Connect to QuickBooks**, authorize with Intuit, then **Setup > Complete OAuth** if the callback doesn't complete automatically.

### 5. Maintain mappings in Back Office

Open the dashboard's **Mappings** tab (or `backoffice.pltheatrical.com/#/mappings`) and map Toggl users/clients/projects/tasks to their QBO counterparts there. TimeSync reads these at sync time — there are no mapping sheets to edit.

### 6. Sync

1. In Toggl Track, add the "Approved" tag to entries you want to sync
2. **Sync Operations > Preview Approved Entries** (see what will sync)
3. **Sync Operations > Sync Approved Entries** (sync to QBO) — or use the dashboard's Sync page

## Tag-Based Workflow

1. **Track Time**: Enter time in Toggl Track as usual
2. **Approve**: When entries are ready, add the "Approved" tag in Toggl
3. **Sync**: Run "Sync Approved Entries" (Sheet menu or dashboard)
4. **Done**: The script syncs to QBO, records a `Sync_Log` row, and adds the "Synced" tag back to Toggl

`Sync_Log` is the dedup authority — an entry already recorded there is skipped, preventing duplicates. The "Synced" tag is kept as a Toggl-side review surface.

## Mappings (Back Office)

Toggl↔QBO mappings are owned by Back Office and fetched by `buildMappingLookups()` (Mappings.gs) in a single bulk GET per run:

| Toggl entity | QBO entity |
|--------------|------------|
| User | Employee |
| Client | Customer (top-level) |
| Project | Sub-customer (project) |
| Task | Service Item |

On any fetch failure the run **aborts** (no partial run, no stale cache) and emails `philip@pltheatrical.com` — proceeding on stale mappings could post TimeActivity records against the wrong customer. Entries keep their "Approved" tag and sync on the next run once fixed.

> Historical note: mappings used to live in in-sheet `Mappings_*` tabs edited from the Sheet/dashboard. That tooling was retired in the 2026-08 D2 cutover; the old tabs were renamed `ZZ_OLD_*` and are read by nothing.

## Sub-Customers as Projects

Since the QBO Projects API requires a paid developer tier, projects are represented as **sub-customers**: top-level Customers = Clients, sub-customers = Projects. To create a project in QBO, create a customer and check "Is sub-customer" with the parent client selected.

## Sheet Structure

| Sheet | Purpose |
|-------|---------|
| `Config` | Key-value configuration storage |
| `Sync_Log` | History of synced entries; the dedup authority |

(`ZZ_OLD_Mappings_*` and `QBO_*_Master` tabs, if present, are retired artifacts — nothing reads them.)

## Menu Reference

### Sync Operations
- **Preview Approved Entries** / **Sync Approved Entries**
- **Resume Pending Sync** / **Cancel Pending Sync**
- **Show Sync Status**

### Setup
- **Build All Sheets** (Config + Sync_Log)
- **Connect to QuickBooks** / **Complete OAuth** / **Disconnect QuickBooks**
- **Show QBO Connection Status** / **Show Toggl Status**

### Settings
- **Configure Date Range**

### Maintenance
- **View Sync Log** / **Clear Sync Log**
- **Check QBO Projects Availability**
- **Sync Missing Config Keys**

(The dashboard's **Settings** page covers sync behavior, tag names, default service item, API budget, and QBO environment.)

## Configuration Options

Edit the `Config` sheet (or the dashboard Settings page):

| Key | Default | Description |
|-----|---------|-------------|
| `IMPORT_DAYS` | 30 | Days to import when no explicit range is set |
| `START_DATE` / `END_DATE` | (empty) | Explicit date range (YYYY-MM-DD) |
| `APPROVED_TAG` | Approved | Tag marking entries ready to sync |
| `SYNCED_TAG` | Synced | Tag added after successful sync |
| `TOGGL_API_BUDGET` | 180 | Max Toggl API calls per run (limit is 240/hr) |
| `DEFAULT_SERVICE_ITEM_ID` | (empty) | Fallback QBO service item for entries whose task has no mapping |

(`QBO_ENV` is a Script Property, not a Config-sheet value — set it in Script Properties or via the dashboard Settings page.)

## Validation Rules

An entry syncs only if it has: an employee mapping (Toggl user → QBO employee), a customer mapping (client → QBO customer), a service-item mapping (task → QBO service item, or the configured default), a valid duration (> 0), a valid date, the "Approved" tag, and no existing `Sync_Log` success row.

## Troubleshooting

### OAuth
- **Invalid client_id / Redirect URI mismatch**: verify `INTUIT_CLIENT_ID`/`INTUIT_CLIENT_SECRET` and that `OAUTH_REDIRECT_URI` matches the Intuit app exactly (full `https://` URL).
- **Token refresh failed**: re-authorize via **Setup > Connect to QuickBooks**.

### Sync
- **No entries found with Approved tag**: ensure entries carry the "Approved" tag and the date range covers them.
- **Sync aborted — Back Office mapping fetch failed** (email): TimeSync couldn't reach `/api/mappings/all` or the credentials are missing/invalid. Check the `BACK_OFFICE_*` Script Properties and that Back Office is up; re-run after fixing (Approved entries are untouched).
- **Missing employee/customer/service-item mapping**: add the mapping in Back Office (`backoffice.pltheatrical.com/#/mappings`), then re-run.
- **QBO API Error 400**: confirm the employee/customer/item exist in QBO.

## Automated Triggers

Create a time-driven Apps Script trigger for `syncApprovedEntries` (e.g., daily). See `automatedSync` in Menu.gs.

## API Reference

- Toggl Track: API v9 `https://api.track.toggl.com/api/v9`, Reports v3 `https://api.track.toggl.com/reports/api/v3`
- QuickBooks Online: Sandbox `https://sandbox-quickbooks.api.intuit.com`, Production `https://quickbooks.api.intuit.com`

## License

MIT License.
