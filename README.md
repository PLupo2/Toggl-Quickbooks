# Toggl Track → QuickBooks Online Time Sync

A Google Apps Script system that syncs time entries from Toggl Track to QuickBooks Online as TimeActivity records, with mapping management and approval workflow.

## Features

- **OAuth 2.0 Authentication**: Secure connection to QuickBooks Online with automatic token refresh
- **Dual Import Support**: Import time entries for all workspace users (Reports API) or just the current user (v9 API)
- **Smart Mapping System**: Map Toggl entities (users, clients, projects, tasks) to QBO entities (employees, customers, projects, service items)
- **Approval Workflow**: Review and approve entries in Inbox before syncing
- **Validation**: Automatically flag entries missing required mappings
- **Deduplication**: Prevent duplicate imports and syncs
- **Name Resolution**: Display human-readable names everywhere (no raw IDs)
- **Environment Support**: Works with both QBO Sandbox and Production

## Data Flow

```
Toggl Track → Inbox (review/approve) → Queue → QuickBooks Online → Archive
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
4. Create 8 new script files and copy the contents:
   - `Config.gs`
   - `Auth.gs`
   - `QuickBooks.gs`
   - `Toggl.gs`
   - `Mappings.gs`
   - `Queue.gs`
   - `Inbox.gs`
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
- Pull QBO master lists (Customers, Employees, Service Items, Projects)
- Pull Toggl mappings (Users, Clients, Projects, Tasks)
- Wire dropdown menus

### 7. Configure Mappings

Edit the mapping sheets to link Toggl entities to QBO:

| Mapping Sheet | Purpose |
|--------------|---------|
| `Mappings_Users` | Toggl Users → QBO Employees |
| `Mappings_Clients` | Toggl Clients → QBO Customers |
| `Mappings_Projects` | Toggl Projects → QBO Customers/Projects |
| `Mappings_Tasks_Services` | Toggl Tasks → QBO Service Items |

### 8. Import and Sync

1. **Import from Toggl > Import All Users**
2. Review entries in `Inbox_Approvals`
3. Check the `Approved` column for entries to sync
4. **Sync to QuickBooks > Run Full Sync**

## Sheet Structure

### Working Sheets

| Sheet | Purpose |
|-------|---------|
| `Config` | Key-value configuration storage |
| `Inbox_Approvals` | Review imported entries (21 columns) |
| `Queue` | Pending sync queue (16 columns) |
| `Synced_Archive` | Successfully synced entries (13 columns) |

### Mapping Sheets

| Sheet | Columns |
|-------|---------|
| `Mappings_Clients` | Toggl Client ID/Name, QBO Customer ID/Name, Auto Matched, Last Updated |
| `Mappings_Projects` | Toggl Project ID/Name, Client Name, QBO Customer/Project IDs and Names |
| `Mappings_Users` | Toggl User ID/Name/Email, QBO Employee ID/Name, Auto Matched |
| `Mappings_Tasks_Services` | Toggl Task ID/Name, Project/Client Names, QBO Service Item ID/Name |

### QBO Master Lists

| Sheet | Purpose |
|-------|---------|
| `QBO_Customers_Master` | Reference list of QBO Customers |
| `QBO_Employees_Master` | Reference list of QBO Employees |
| `QBO_Items_Service_Master` | Reference list of QBO Service Items |
| `QBO_Projects_Master` | Reference list of QBO Projects |

## Menu Reference

### Setup
- **Build All Sheets**: Create all required sheets
- **Connect to QuickBooks**: Start OAuth flow
- **Complete OAuth**: Finish OAuth with authorization code
- **Disconnect QuickBooks**: Clear OAuth tokens
- **Show Connection Status**: Display QBO connection info
- **Show Toggl Status**: Display Toggl connection info

### Refresh Data
- **Refresh Toggl Mappings**: Pull users, clients, projects, tasks
- **Refresh QBO Master Lists**: Pull customers, employees, items, projects
- **Refresh All**: Refresh everything and wire dropdowns
- **Wire Dropdowns**: Add data validation to mapping sheets

### Import from Toggl
- **Import All Users**: Import entries for all workspace users
- **Import Current User Only**: Import entries for authenticated user
- **Show Import Settings**: View/change import date range

### Inbox
- **Validate Entries**: Check all entries for required mappings
- **Auto-Populate Mappings**: Fill QBO columns from existing mappings
- **Approve All Entries**: Check all approval boxes
- **Show Inbox Stats**: Display summary statistics
- **Filter: Needs Review**: Show only entries with validation errors
- **Clear Filters**: Remove all filters

### Sync to QuickBooks
- **Process Inbox → Queue**: Move approved entries to Queue
- **Sync Queue → QBO**: Create TimeActivities in QBO
- **Run Full Sync**: Process Inbox and Sync in one step
- **Reset Failed Queue Entries**: Allow retry of failed entries

### Maintenance
- **Cleanup Orphaned Mappings**: Remove mappings for deleted Toggl entities
- **View Sync Log**: Show sync status summary
- **Clear Sync Log**: Reset last import/sync dates

## Configuration Options

Edit the `Config` sheet to adjust:

| Key | Default | Description |
|-----|---------|-------------|
| `IMPORT_DAYS` | 30 | Number of days to import |
| `BATCH_SIZE` | 50 | Entries per batch |
| `AUTO_APPROVE` | FALSE | Auto-approve valid entries |
| `SYNC_BILLABLE_ONLY` | FALSE | Only sync billable time |

## Validation Rules

Entries must have:
1. **Employee mapping** (required) - Toggl user must map to QBO employee
2. **Customer mapping** (required) - Project or client must map to QBO customer
3. **Service Item mapping** (required) - Task must map to QBO service item
4. **Valid duration** - Must be greater than 0
5. **Valid date** - Must have a date

QBO Projects are optional - entries can sync with just a Customer.

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

### Import Issues

**"No entries imported"**
- Check the import date range in **Import Settings**
- Verify Toggl API token is correct
- Ensure there are time entries in Toggl for the date range

**"TOGGL_WORKSPACE_ID not found"**
- The script will auto-detect it on first run
- Or set it manually in Script Properties

### Sync Issues

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

### Projects Unavailable

If QBO Projects aren't syncing:
- Standard Intuit apps don't get the `project-management.project` scope
- The script uses GraphQL as a fallback
- If GraphQL fails, projects are optional - sync will work with just Customers

## Automated Triggers

You can set up automated import/sync:

```javascript
// In Menu.gs, use setupAutomatedTriggers() to create:
// - Daily import at 6 AM
// - Daily sync at 7 AM
```

## API Reference

### Toggl Track
- API v9: https://api.track.toggl.com/api/v9
- Reports API v3: https://api.track.toggl.com/reports/api/v3

### QuickBooks Online
- Sandbox: https://sandbox-quickbooks.api.intuit.com
- Production: https://quickbooks.api.intuit.com
- GraphQL: https://public.api.intuit.com/2020-04/graphql

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues:
1. Check the execution logs (**View > Executions** in Apps Script)
2. Review the troubleshooting section above
3. Verify all credentials and configurations
