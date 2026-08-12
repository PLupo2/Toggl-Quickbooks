# Deployment Guide

> **Phase 3 backend migration in progress (started 2026-08-12, not live yet).** This guide covers the Google Apps Script system, still the live one. See `CLAUDE.md`'s PHASE 3 section for the FastAPI/Docker replacement's status; a deployment guide for that system will replace this one at cutover.

This guide walks through deploying the Toggl-QBO Sync system step by step.

## Prerequisites

Before starting, ensure you have:
- A Google account
- Access to Google Sheets and Apps Script
- A Toggl Track account with API access
- An Intuit Developer account

## Step 1: Create Intuit Developer App

1. Go to https://developer.intuit.com
2. Sign in or create an account
3. Click **Dashboard** > **Create an app**
4. Select **QuickBooks Online and Payments**
5. Give your app a name (e.g., "Toggl Time Sync")
6. Click **Create app**

### Configure OAuth Settings

1. In your app dashboard, go to **Keys & credentials**
2. Note your **Client ID** and **Client Secret** (you'll need these later)
3. Under **Redirect URIs**, add your callback URL:
   - For development: `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`
   - You'll update this after deploying the web app

### Select Scopes

1. Go to **Scopes** in your app settings
2. Ensure these scopes are enabled:
   - `com.intuit.quickbooks.accounting` (required)
   - `openid` (for user identity)
   - `email` (optional)
   - `profile` (optional)

## Step 2: Get Toggl API Token

1. Log in to Toggl Track at https://track.toggl.com
2. Click your profile picture > **Profile settings**
3. Scroll down to **API Token**
4. Copy your API token

## Step 3: Create Google Apps Script Project

### Option A: From Google Sheets (Recommended)

1. Create a new Google Sheet
2. Go to **Extensions > Apps Script**
3. This creates a container-bound script

### Option B: Standalone Script

1. Go to https://script.google.com
2. Click **New project**
3. Note: You'll need to specify the spreadsheet ID for standalone scripts

## Step 4: Add Script Files

1. Delete the default `Code.gs` file
2. Create these script files (File > New > Script) and copy the contents from each source file:
   - `Config.gs`
   - `Auth.gs`
   - `QuickBooks.gs`
   - `Toggl.gs`
   - `Mappings.gs`
   - `Menu.gs`
   - `WebAPI.gs`

   (`appsscript.json` is the manifest. In practice the project is deployed with `clasp push`, not hand-created.)

## Step 5: Configure Script Properties

1. In Apps Script, click the **gear icon** (Project Settings)
2. Scroll down to **Script Properties**
3. Click **Add script property** for each:

| Property | Value |
|----------|-------|
| `TOGGL_API_TOKEN` | Your Toggl API token |
| `INTUIT_CLIENT_ID` | From Intuit Developer dashboard |
| `INTUIT_CLIENT_SECRET` | From Intuit Developer dashboard |
| `OAUTH_REDIRECT_URI` | Will set after deploying |
| `QBO_ENV` | `sandbox` (for testing) or `production` — authoritative environment switch |
| `WORKER_SECRET` | Shared secret with the Cloudflare Worker (Phase 2 dashboard auth) |
| `WEB_API_KEY` | Secondary API key (Phase 2 dashboard auth) |
| `BACK_OFFICE_CF_ACCESS_CLIENT_ID` | Cloudflare Access service token (client id) for Back Office `/api/mappings/all` |
| `BACK_OFFICE_CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token (client secret) |
| `BACK_OFFICE_API_KEY` | Back Office API key, scoped to TimeSync |

(`BACK_OFFICE_MAPPINGS_URL` is optional and defaults to the production endpoint. The `BACK_OFFICE_*` and Phase 2 auth properties are required for the mapping fetch and the web dashboard respectively — see `CLAUDE.md`.)

## Step 6: Deploy as Web App

1. Click **Deploy > New deployment**
2. Click the gear icon next to **Select type** > **Web app**
3. Configure:
   - **Description**: OAuth callback handler
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. **Copy the Web app URL**
6. Authorize when prompted

### Update Redirect URI

1. Go back to Script Properties
2. Set `OAUTH_REDIRECT_URI` to the Web app URL
3. Go to Intuit Developer dashboard
4. Add the same URL to **Redirect URIs**

## Step 7: Initial Setup

1. Go back to your Google Sheet
2. Reload the page (you should see the custom menu)
3. Go to **Toggl-QBO Sync > Setup > Build All Sheets**
4. Authorize the script when prompted

## Step 8: Connect to QuickBooks

1. Go to **Toggl-QBO Sync > Setup > Connect to QuickBooks**
2. Click the authorization link in the dialog
3. Log in to Intuit and authorize the app
4. You'll be redirected to your Web app URL
5. The page should show "Successfully Connected!"

### If Automatic Callback Fails

1. Copy the `code` parameter from the redirect URL
2. Go to **Setup > Complete OAuth**
3. Paste the code

## Step 9: Verify Connections

1. **Setup > Show QBO Connection Status** - Should show "Connected"
2. **Setup > Show Toggl Status** - Should show "Connected"

## Step 10: Maintain mappings in Back Office

Toggl↔QBO mappings are owned by **Back Office** (`backoffice.pltheatrical.com/#/mappings`), not in-sheet. TimeSync fetches them at sync time via `buildMappingLookups()` (one bulk GET per run). Ensure the `BACK_OFFICE_*` Script Properties are set (Step 5) and that the users/clients/projects/tasks you sync are mapped in Back Office. There are no mapping sheets to build or refresh in this project.

> Historical note: earlier versions maintained `Mappings_*` and `QBO_*_Master` sheets via a "Refresh Data" menu. That tooling was retired in the 2026-08 D2 cutover.

## Production Deployment

When ready to switch from Sandbox to Production:

1. Update `QBO_ENV` to `production` in Script Properties (or via the dashboard Settings page — it writes the same Script Property)
2. Clear existing tokens: **Setup > Disconnect QuickBooks**
3. Re-authorize: **Setup > Connect to QuickBooks**
4. Confirm the `BACK_OFFICE_*` properties point at the production Back Office and that mappings are complete there
5. Promote the deployment: `clasp deploy -i <deployment-id>` (a plain `clasp push` updates HEAD only, not the pinned Production deployment the dashboard uses)

## Troubleshooting Deployment

### "Authorization required" repeatedly

- Make sure you're logged into the correct Google account
- Clear browser cache and try again
- Check that all script files have no syntax errors

### Web app shows error

- Check **View > Executions** for error details
- Verify all Script Properties are set correctly
- Ensure OAuth credentials match between Intuit and Script Properties

### Menu doesn't appear

- Make sure `onOpen()` function exists in `Menu.gs`
- Reload the spreadsheet
- Check for errors in the script

### OAuth callback fails

- Verify redirect URI matches exactly (including trailing slashes)
- Check that the Web app is deployed with "Anyone" access
- Review the Web app deployment URL

## Security Considerations

### Script Properties

- Script Properties are stored server-side and not visible to users
- Never share your Client Secret
- Rotate Toggl API tokens periodically

### Access Control

- The spreadsheet owner controls who can access the data
- Consider restricting edit access to the spreadsheet
- Use a dedicated Google account for production

### Token Storage

- OAuth tokens are stored in Script Properties
- Refresh tokens can be revoked from Intuit Developer dashboard
- Tokens expire after 100 days of non-use
