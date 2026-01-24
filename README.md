# Toggl Track → QuickBooks Online Time Sync

A Google Apps Script system that syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, using a tag-based approval workflow.

## Features

- **OAuth 2.0 Authentication**: Secure connection to QuickBooks Online with automatic token refresh
- **Tag-Based Workflow**: Tag entries with "Approved" in Toggl, sync to QBO, automatically get "Synced" tag
- **Smart Mapping System**: Map Toggl entities (users, clients, projects, tasks) to QBO entities (employees, customers, sub-customers, service items)
- **Sub-Customers as Projects**: Uses QBO sub-customers to represent projects (no paid developer tier required)
- **Validation**: Automatically flag entries missing required mappings
- **Deduplication**: Entries with "Synced" tag are skipped to prevent duplicates
- **Name Resolution**: Display human-readable names everywhere (no raw IDs)
- **Environment Support**: Works with both QBO Sandbox and Production

## Data Flow

```
Toggl Track (tag "Approved") → Google Sheets (sync) → QuickBooks Online
                              ↓
              Toggl Track (auto-adds "Synced" tag)
```

## Requirements

### QuickBooks Online
- Intuit Developer account
- OAuth 2.0 app with `com.intuit.quickbooks.accounting` scope
- QBO company (Sandbox for testing, Production for live use)

### Toggl Track
- Toggl Track account with API access
- API token from Profile settings
- Workspace ID (auto-detected if not provided)

## Quick Start

### 1. Create the Google Apps Script Project

1. Create a new Google Sheet
2. Go to **Extensions > Apps Script**
3. Delete the default `Code.gs` file
4. Create 6 new script files and copy the contents:
   - `Config.gs`
   - `Auth.gs`
   - `QuickBooks.gs`
   - `Toggl.gs`
   - `Mappings.gs`
   - `Menu.gs`

### 2. Configure Script Properties

Go to **Project Settings > Script Properties** and add:

| Property | Description | Example |
|----------|-------------|---------|
| `TOGGL_API_TOKEN` | Your Toggl API token | `abc123...` |
| `TOGGL_WORKSPACE_ID` | Workspace ID (optional) | `1234567` |
| `INTUIT_CLIENT_ID` | OAuth Client ID | `AB12cd...` |
| `INTUIT_CLIENT_SECRET` | OAuth Client Secret | `xyz789...` |
| `OAUTH_REDIRECT_URI` | Web App deployment URL | `https://script.google.com/...` |
| `QBO_REALM_ID` | Company ID (set after OAuth) | `1234567890` |
| `QBO_ENV` | Environment | `sandbox` or `production` |

### 3. Deploy as Web App

1. Click **Deploy > New deployment**
2. Select **Web app**
3. Set **Execute as**: Me
4. Set **Who has access**: Anyone (for OAuth callback)
5. Copy the Web app URL to `OAUTH_REDIRECT_URI`

### 4. Set Up Sheets

1. Reload your Google Sheet
2. You should see the **Toggl-QBO Sync** menu
3. Go to **Setup > Build All Sheets**

### 5. Connect to QuickBooks

1. Go to **Setup > Connect to QuickBooks**
2. Click the authorization link
3. Log in to Intuit and authorize the app
4. If using the callback URL, authorization completes automatically
5. Otherwise, copy the code and use **Setup > Complete OAuth**

### 6. Refresh Data

Go to **Refresh Data > Refresh All** to:
- Pull QBO master lists (Customers, Employees, Service Items, Sub-Customers)
- Pull Toggl mappings (Users, Clients, Projects, Tasks)
- Wire dropdown menus

### 7. Configure Mappings

Edit the mapping sheets to link Toggl entities to QBO:

| Mapping Sheet | Purpose |
|--------------|---------|
| `Mappings_Users` | Toggl Users → QBO Employees |
| `Mappings_Clients` | Toggl Clients → QBO Customers (top-level) |
| `Mappings_Projects` | Toggl Projects → QBO Customers + Sub-Customers (projects) |
| `Mappings_Tasks_Services` | Toggl Tasks → QBO Service Items |

### 8. Create Tags and Sync

1. **Maintenance > Ensure Tags Exist in Toggl** (creates Approved/Synced tags)
2. In Toggl Track, add the "Approved" tag to entries you want to sync
3. **Sync Operations > Preview Approved Entries** (see what will sync)
4. **Sync Operations > Sync Approved Entries** (sync to QBO)

## Tag-Based Workflow

This system uses Toggl tags to manage the sync workflow:

1. **Track Time**: Enter time in Toggl Track as usual
2. **Approve**: When entries are ready to sync, add the "Approved" tag in Toggl
3. **Sync**: Run "Sync Approved Entries" from the Google Sheet menu
4. **Done**: The script syncs to QBO and adds "Synced" tag back to Toggl

Entries with the "Synced" tag are automatically skipped, preventing duplicates.

## Sub-Customers as Projects

Since the QBO Projects API requires a paid developer tier ($300/mo), this system uses a creative workaround:

- **Top-level Customers** = Clients (used in `Mappings_Clients`)
- **Sub-customers** = Projects (used in `Mappings_Projects`)

To create a "project" in QBO:
1. Go to QBO > Customers
2. Create a new customer
3. Check "Is sub-customer" and select the parent customer

The `QBO_Projects_Master` sheet will list all sub-customers for mapping.

## Sheet Structure

### Working Sheets

| Sheet | Purpose |
|-------|---------|
| `Config` | Key-value configuration storage |
| `Sync_Log` | History of synced entries |

### Mapping Sheets

| Sheet | Columns |
|-------|---------|
| `Mappings_Clients` | Toggl Client ID/Name, QBO Customer ID/Name |
| `Mappings_Projects` | Toggl Project ID/Name, Client Name, QBO Customer/Project (sub-customer) |
| `Mappings_Users` | Toggl User ID/Name/Email, QBO Employee ID/Name |
| `Mappings_Tasks_Services` | Toggl Task ID/Name, Project/Client Names, QBO Service Item ID/Name |

### QBO Master Lists

| Sheet | Purpose |
|-------|---------|
| `QBO_Customers_Master` | Top-level QBO Customers (clients) |
| `QBO_Employees_Master` | QBO Employees |
| `QBO_Items_Service_Master` | QBO Service Items |
| `QBO_Projects_Master` | QBO Sub-customers (projects) |

## Menu Reference

### Sync Operations
- **Preview Approved Entries**: Show entries that will be synced
- **Sync Approved Entries**: Sync tagged entries to QBO
- **Show Sync Status**: Display sync statistics

### Setup
- **Build All Sheets**: Create all required sheets
- **Connect to QuickBooks**: Start OAuth flow
- **Complete OAuth**: Finish OAuth with authorization code
- **Disconnect QuickBooks**: Clear OAuth tokens
- **Show Connection Status**: Display QBO connection info
- **Show Toggl Status**: Display Toggl connection info
- **Check QBO Projects Availability**: Show sub-customer (project) count

### Refresh Data
- **Refresh Toggl Mappings**: Pull users, clients, projects, tasks
- **Refresh QBO Master Lists**: Pull customers, employees, items, sub-customers
- **Refresh All**: Refresh everything and wire dropdowns
- **Wire Dropdowns**: Add data validation to mapping sheets

### Settings
- **Configure Date Range**: Set start/end dates or "last N days"
- **Configure Tag Names**: Customize Approved/Synced tag names
- **Show Current Settings**: View all current settings

### Maintenance
- **Cleanup Orphaned Mappings**: Remove mappings for deleted Toggl entities
- **View Sync Log**: Show sync history
- **Clear Sync Log**: Reset sync log
- **Ensure Tags Exist in Toggl**: Create workflow tags
- **Debug: Customer Hierarchy**: Show all customers and sub-customers

## Configuration Options

Edit the `Config` sheet to adjust:

| Key | Default | Description |
|-----|---------|-------------|
| `IMPORT_DAYS` | 30 | Number of days to import (when no date range set) |
| `START_DATE` | (empty) | Specific start date (YYYY-MM-DD) |
| `END_DATE` | (empty) | Specific end date (YYYY-MM-DD) |
| `APPROVED_TAG` | Approved | Tag name for entries ready to sync |
| `SYNCED_TAG` | Synced | Tag name added after successful sync |
| `SYNC_BILLABLE_ONLY` | FALSE | Only sync billable time |

## Validation Rules

Entries must have:
1. **Employee mapping** (required) - Toggl user must map to QBO employee
2. **Customer mapping** (required) - Project or client must map to QBO customer
3. **Service Item mapping** (required) - Task must map to QBO service item
4. **Valid duration** - Must be greater than 0
5. **Valid date** - Must have a date
6. **Approved tag** - Must have the "Approved" tag in Toggl
7. **No Synced tag** - Must NOT have the "Synced" tag (prevents duplicates)

## Troubleshooting

### OAuth Issues

**"Invalid client_id"**
- Verify `INTUIT_CLIENT_ID` in Script Properties
- Check that your Intuit app is configured correctly

**"Redirect URI mismatch"**
- Ensure `OAUTH_REDIRECT_URI` matches exactly what's configured in your Intuit app
- Include the full URL with `https://`

**"Token refresh failed"**
- Re-authorize: **Setup > Connect to QuickBooks**
- Tokens expire after 100 days if not used

### Sync Issues

**"No entries found with Approved tag"**
- Ensure entries have the "Approved" tag in Toggl
- Check the date range in Settings
- Run **Maintenance > Ensure Tags Exist in Toggl**

**"Missing Employee mapping"**
- Edit `Mappings_Users` to link the Toggl user to a QBO employee
- Use the dropdown to select the employee

**"Missing Customer mapping"**
- Edit `Mappings_Projects` or `Mappings_Clients`
- Link the Toggl project/client to a QBO customer

**"Missing Service Item mapping"**
- Edit `Mappings_Tasks_Services`
- Link the Toggl task to a QBO service item

**"QBO API Error: 400"**
- Check that the employee/customer/item exist in QBO
- Refresh master lists and try again

### Projects (Sub-Customers)

**QBO_Projects_Master is empty**
- Create sub-customers in QBO (Customer > Is sub-customer)
- Run **Refresh Data > Refresh All**
- Run **Maintenance > Debug: Customer Hierarchy** to verify

## Automated Triggers

You can set up automated syncing:

1. In Apps Script, go to **Triggers**
2. Create a time-driven trigger for `syncApprovedEntries`
3. Set to run daily at your preferred time

## API Reference

### Toggl Track
- API v9: https://api.track.toggl.com/api/v9
- Reports API v3: https://api.track.toggl.com/reports/api/v3

### QuickBooks Online
- Sandbox: https://sandbox-quickbooks.api.intuit.com
- Production: https://quickbooks.api.intuit.com

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues:
1. Check the execution logs (**View > Executions** in Apps Script)
2. Review the troubleshooting section above
3. Verify all credentials and configurations
