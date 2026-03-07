/**
 * @fileoverview Custom Google Sheets menu and UI triggers for the Toggl-QBO tag-based sync workflow.
 * @author pltheatrical2
 */

// ============================================================================
// MENU CREATION
// ============================================================================

/**
 * Runs when the spreadsheet opens
 * Creates the custom menu
 */
function onOpen() {
  createMenu();
}

/**
 * Creates the custom menu structure
 */
function createMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Toggl-QBO Sync')
    // Sync Operations (main workflow)
    .addSubMenu(
      ui.createMenu('Sync Operations')
        .addItem('Preview Approved Entries', 'previewApprovedEntries')
        .addItem('Sync Approved Entries', 'syncApprovedEntries')
        .addSeparator()
        .addItem('Resume Pending Sync', 'resumePendingSync')
        .addItem('Cancel Pending Sync', 'cancelPendingSync')
        .addSeparator()
        .addItem('Show Sync Status', 'showSyncStatus')
    )

    // Setup submenu
    .addSubMenu(
      ui.createMenu('Setup')
        .addItem('Build All Sheets', 'buildAllSheets')
        .addSeparator()
        .addItem('Connect to QuickBooks', 'authorizeQuickBooks')
        .addItem('Complete OAuth', 'completeOAuthFlow')
        .addItem('Disconnect QuickBooks', 'disconnectQuickBooks')
        .addSeparator()
        .addItem('Show QBO Connection Status', 'showConnectionStatus')
        .addItem('Show Toggl Status', 'showTogglStatus')
    )

    // Refresh submenu
    .addSubMenu(
      ui.createMenu('Refresh Data')
        .addItem('Refresh Toggl Mappings', 'refreshTogglMappings')
        .addItem('Refresh QBO Master Lists', 'refreshQBOMasterLists')
        .addSeparator()
        .addItem('Wire Dropdowns', 'wireAllDropdowns')
    )

    // Settings submenu
    .addSubMenu(
      ui.createMenu('Settings')
        .addItem('Configure Date Range', 'configureDateRange')
    )

    // Maintenance submenu
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Cleanup Orphaned Mappings', 'cleanupOrphanedMappings')
        .addItem('View Sync Log', 'viewSyncLog')
        .addItem('Clear Sync Log', 'clearSyncLog')
        .addSeparator()
        .addItem('Check QBO Projects Availability', 'showProjectsInfo')
        .addSeparator()
        .addItem('Hide QBO Master Sheets', 'hideQBOMasterSheets')
        .addItem('Show QBO Master Sheets', 'showQBOMasterSheets')
        .addSeparator()
        .addItem('Apply Mapping Highlights', 'applyUnmappedRowHighlighting')
        .addItem('Sync Missing Config Keys', 'syncMissingConfigKeys')
    )

    .addSeparator()
    .addItem('Help', 'showHelp')
    .addToUi();
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Builds all required sheets
 */
function buildAllSheets() {
  showToast('Building all sheets...');

  try {
    // Config sheet
    createConfigSheet(getSpreadsheet());

    // Sync Log sheet
    getOrCreateSheet(CONFIG.SHEETS.SYNC_LOG, CONFIG.COLUMNS.SYNC_LOG);

    // Mapping sheets
    getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, CONFIG.COLUMNS.MAPPINGS_CLIENTS);
    getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_PROJECTS, CONFIG.COLUMNS.MAPPINGS_PROJECTS);
    getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_USERS, CONFIG.COLUMNS.MAPPINGS_USERS);
    getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_TASKS, CONFIG.COLUMNS.MAPPINGS_TASKS);

    // QBO Master sheets
    getOrCreateSheet(CONFIG.SHEETS.QBO_CUSTOMERS, CONFIG.COLUMNS.QBO_CUSTOMERS);
    getOrCreateSheet(CONFIG.SHEETS.QBO_EMPLOYEES, CONFIG.COLUMNS.QBO_EMPLOYEES);
    getOrCreateSheet(CONFIG.SHEETS.QBO_ITEMS, CONFIG.COLUMNS.QBO_ITEMS);
    getOrCreateSheet(CONFIG.SHEETS.QBO_PROJECTS, CONFIG.COLUMNS.QBO_PROJECTS);

    // Format all sheets
    formatAllSheets();

    // Hide the QBO master sheets (they're for data validation, not user interaction)
    hideQBOMasterSheets();

    showAlert(
      'All sheets have been created successfully!\n\n' +
      'Next steps:\n' +
      '1. Set your credentials in Script Properties (TOGGL_API_TOKEN, INTUIT_CLIENT_ID, etc.)\n' +
      '2. Connect to QuickBooks (Setup > Connect to QuickBooks)\n' +
      '3. Refresh data (Refresh Data > Refresh QBO Master Lists, then Refresh Toggl Mappings)\n' +
      '4. Configure your mappings in the Mappings_ sheets\n\n' +
      'Workflow:\n' +
      '1. In Toggl Track, add "Approved" tag to entries ready to sync\n' +
      '2. Run "Sync Operations > Sync Approved Entries"\n' +
      '3. The script will sync to QBO and add "Synced" tag back to Toggl',
      'Setup Complete'
    );
  } catch (error) {
    showAlert(`Failed to build sheets: ${error.message}`, 'Setup Error');
    logMessage(`Setup error: ${error.message}`, 'ERROR');
  }
}

/**
 * Applies consistent formatting to all sheets
 */
function formatAllSheets() {
  const ss = getSpreadsheet();

  // Format each sheet with appropriate header color
  const sheetConfigs = [
    { name: CONFIG.SHEETS.SYNC_LOG, headerColor: '#674ea7' },  // Purple for sync log
    { name: CONFIG.SHEETS.MAPPINGS_CLIENTS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_PROJECTS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_USERS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_TASKS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.QBO_CUSTOMERS, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_EMPLOYEES, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_ITEMS, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_PROJECTS, headerColor: '#3d85c6' }
  ];

  sheetConfigs.forEach(config => {
    const sheet = ss.getSheetByName(config.name);
    if (sheet) {
      const lastCol = sheet.getLastColumn() || 1;
      const headerRange = sheet.getRange(1, 1, 1, lastCol);
      headerRange.setFontWeight('bold');
      headerRange.setBackground(config.headerColor);
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });
}

// ============================================================================
// SYNC STATUS
// ============================================================================

/**
 * Shows combined sync status: sync info, pending state, and API usage
 */
function showSyncStatus() {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();
  const lastSync = getConfigValue('LAST_SYNC_DATE', 'Never');
  const dateRange = getImportDateRange();

  // Count entries in sync log
  const ss = getSpreadsheet();
  const syncLogSheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);
  const syncLogCount = syncLogSheet ? Math.max(0, syncLogSheet.getLastRow() - 1) : 0;

  // API usage
  const apiStats = getApiUsageStats();
  const lastSyncCalls = getConfigValue('LAST_SYNC_API_CALLS', '');

  // Pending sync state
  const state = loadSyncState();

  let message = `Sync Status\n\n`;
  message += `Date Range: ${dateRange.startDate} to ${dateRange.endDate}\n`;
  message += `Last Sync: ${lastSync}\n`;
  message += `Sync Log Entries: ${syncLogCount}\n`;
  message += `Tags: "${approvedTag}" → "${syncedTag}"\n\n`;

  // API section
  message += `Toggl API Usage:\n`;
  message += `  Workspace calls (this run): ${apiStats.workspaceCalls} / ${apiStats.budget}\n`;
  message += `  Remaining budget: ${apiStats.remaining}\n`;
  if (lastSyncCalls) {
    message += `  Last sync used: ${lastSyncCalls} calls\n`;
  }
  message += `  (Toggl limit: 240/hr; budget adjustable via TOGGL_API_BUDGET in Config)\n\n`;

  // Pending sync section
  if (state) {
    message += `Pending Sync:\n`;
    message += `  Entries remaining: ${state.pendingEntryIds?.length || 0}\n`;
    message += `  Already synced: ${state.syncedEntryIds?.length || 0}\n`;
    message += `  Paused at: ${state.pausedAt || 'Unknown'}\n`;
    message += `  → Run "Resume Pending Sync" to continue.\n`;
  } else {
    message += `No pending sync operations.`;
  }

  showAlert(message, 'Sync Status');
}

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

/**
 * Configures the date range for sync using an HTML dialog with date pickers
 */
function configureDateRange() {
  const currentStart = getConfigValue('START_DATE', '');
  const currentEnd = getConfigValue('END_DATE', '');
  const currentDays = getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS);
  const effectiveRange = getImportDateRange();

  const html = HtmlService.createHtmlOutput(`
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h3 { color: #1a73e8; margin-top: 0; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #333; }
        input[type="date"], input[type="number"] {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          width: 200px;
        }
        .help-text { font-size: 12px; color: #666; margin-top: 4px; }
        .current { background: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 13px; }
        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin-right: 10px;
        }
        .btn-primary { background: #1a73e8; color: white; }
        .btn-secondary { background: #f1f3f4; color: #333; }
        .btn:hover { opacity: 0.9; }
        .divider { border-top: 1px solid #eee; margin: 20px 0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <h3>Configure Date Range</h3>

      <div class="current">
        <strong>Current effective range:</strong> ${effectiveRange.startDate} to ${effectiveRange.endDate}
      </div>

      <div class="form-group">
        <label>Start Date</label>
        <input type="date" id="startDate" value="${currentStart}">
        <div class="help-text">Leave blank to use "Last N Days" instead</div>
      </div>

      <div class="form-group">
        <label>End Date</label>
        <input type="date" id="endDate" value="${currentEnd}">
        <div class="help-text">Leave blank for today's date</div>
      </div>

      <div class="divider">
        <div class="form-group">
          <label>Or use: Last N Days</label>
          <input type="number" id="importDays" value="${currentDays}" min="1" max="365">
          <div class="help-text">Used when Start Date is blank (1-365 days)</div>
        </div>
      </div>

      <div style="margin-top: 20px;">
        <button class="btn btn-primary" onclick="save()">Save</button>
        <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>
        <button class="btn btn-secondary" onclick="clearDates()">Clear Dates</button>
      </div>

      <script>
        function save() {
          const startDate = document.getElementById('startDate').value;
          const endDate = document.getElementById('endDate').value;
          const importDays = document.getElementById('importDays').value;

          google.script.run
            .withSuccessHandler(function() {
              google.script.host.close();
            })
            .withFailureHandler(function(error) {
              alert('Error: ' + error.message);
            })
            .saveDateRangeSettings(startDate, endDate, importDays);
        }

        function clearDates() {
          document.getElementById('startDate').value = '';
          document.getElementById('endDate').value = '';
        }
      </script>
    </body>
    </html>
  `)
    .setWidth(400)
    .setHeight(420);

  SpreadsheetApp.getUi().showModalDialog(html, 'Configure Date Range');
}

/**
 * Saves date range settings (called from HTML dialog)
 */
function saveDateRangeSettings(startDate, endDate, importDays) {
  setConfigValue('START_DATE', startDate || '');
  setConfigValue('END_DATE', endDate || '');

  const days = parseInt(importDays, 10);
  if (!isNaN(days) && days > 0 && days <= 365) {
    setConfigValue('IMPORT_DAYS', days);
  }

  const dateRange = getImportDateRange();
  logMessage(`Date range configured: ${dateRange.startDate} to ${dateRange.endDate}`, 'INFO');
}


/**
 * Validates a date string in YYYY-MM-DD format
 */
function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Views the sync log
 */
function viewSyncLog() {
  const ss = getSpreadsheet();
  const syncLogSheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);

  if (!syncLogSheet) {
    showAlert('Sync Log sheet not found. Run "Build All Sheets" first.', 'Error');
    return;
  }

  const lastSync = getConfigValue('LAST_SYNC_DATE', 'Never');
  const rowCount = Math.max(0, syncLogSheet.getLastRow() - 1);

  // Get recent entries summary
  let recentSummary = '';
  if (rowCount > 0) {
    const recentRows = Math.min(5, rowCount);
    const data = syncLogSheet.getRange(2, 1, recentRows, 3).getValues();
    recentSummary = '\nRecent Syncs:\n';
    data.forEach(row => {
      recentSummary += `  ${row[0]} - Entry ${row[1]} -> QBO ${row[2] || 'FAILED'}\n`;
    });
  }

  showAlert(
    `Sync Log Summary\n\n` +
    `Total Entries: ${rowCount}\n` +
    `Last Sync: ${lastSync}\n` +
    recentSummary +
    `\nView the Sync_Log sheet for full details.`,
    'Sync Log'
  );

  // Activate the sync log sheet
  syncLogSheet.activate();
}

/**
 * Clears the sync log
 */
function clearSyncLog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Clear Sync Log',
    'This will delete all entries from the Sync Log sheet. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const ss = getSpreadsheet();
  const syncLogSheet = ss.getSheetByName(CONFIG.SHEETS.SYNC_LOG);

  if (syncLogSheet && syncLogSheet.getLastRow() > 1) {
    syncLogSheet.getRange(2, 1, syncLogSheet.getLastRow() - 1, syncLogSheet.getLastColumn()).clear();
  }

  setConfigValue('LAST_SYNC_DATE', '');
  showToast('Sync log cleared.');
}

// ============================================================================
// HELP
// ============================================================================

/**
 * Shows help documentation
 */
function showHelp() {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  const html = HtmlService.createHtmlOutput(`
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
        h1 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 10px; }
        h2 { color: #5f6368; margin-top: 25px; }
        ul { margin-left: 0; padding-left: 20px; }
        li { margin-bottom: 8px; }
        .section { margin-bottom: 20px; }
        code { background: #f1f3f4; padding: 2px 6px; border-radius: 3px; }
        .step { background: #e8f0fe; padding: 10px; border-radius: 5px; margin: 10px 0; }
        .workflow { background: #e6f4ea; padding: 15px; border-radius: 5px; border-left: 4px solid #34a853; }
      </style>
    </head>
    <body>
      <h1>Toggl to QuickBooks Time Sync</h1>

      <div class="section workflow">
        <h2>Workflow (Tag-Based)</h2>
        <p><strong>In Toggl Track:</strong></p>
        <ol>
          <li>Track your time entries as usual</li>
          <li>When entries are ready to sync, add the <code>${approvedTag}</code> tag</li>
        </ol>
        <p><strong>In this Google Sheet:</strong></p>
        <ol start="3">
          <li>Run <strong>Sync Operations > Preview Approved Entries</strong> to see what will sync</li>
          <li>Run <strong>Sync Operations > Sync Approved Entries</strong> to sync to QuickBooks</li>
        </ol>
        <p><strong>Result:</strong> Synced entries automatically get the <code>${syncedTag}</code> tag in Toggl</p>
      </div>

      <div class="section">
        <h2>Initial Setup</h2>
        <div class="step">
          <strong>Step 1:</strong> Set up credentials in Script Properties<br>
          (Extensions > Apps Script > Project Settings > Script Properties)
          <ul>
            <li><code>TOGGL_API_TOKEN</code> - From Toggl Profile settings</li>
            <li><code>INTUIT_CLIENT_ID</code> - From developer.intuit.com</li>
            <li><code>INTUIT_CLIENT_SECRET</code> - From developer.intuit.com</li>
            <li><code>OAUTH_REDIRECT_URI</code> - Your Web App URL</li>
            <li><code>QBO_ENV</code> - "sandbox" or "production"</li>
          </ul>
        </div>
        <div class="step">
          <strong>Step 2:</strong> Build sheets (Setup > Build All Sheets)
        </div>
        <div class="step">
          <strong>Step 3:</strong> Connect to QuickBooks (Setup > Connect to QuickBooks)
        </div>
        <div class="step">
          <strong>Step 4:</strong> Refresh data (Refresh Data > Refresh QBO Master Lists, then Refresh Toggl Mappings)
        </div>
        <div class="step">
          <strong>Step 5:</strong> Configure mappings in the Mappings_ sheets:
          <ul>
            <li>Mappings_Users: Toggl Users -> QBO Employees</li>
            <li>Mappings_Clients: Toggl Clients -> QBO Customers</li>
            <li>Mappings_Projects: Toggl Projects -> QBO Customer + optional QBO Project</li>
            <li>Mappings_Tasks: Toggl Tasks -> QBO Service Items</li>
          </ul>
        </div>
        <div class="step">
          <strong>Step 6:</strong> Start syncing! (Sync Operations > Preview Approved Entries)
        </div>
      </div>

      <div class="section">
        <h2>Required Mappings</h2>
        <ul>
          <li><strong>Users:</strong> Toggl Users -> QBO Employees (required)</li>
          <li><strong>Clients:</strong> Toggl Clients -> QBO Customers (required)</li>
          <li><strong>Projects:</strong> Toggl Projects -> QBO Sub-Customers* (optional)</li>
          <li><strong>Tasks:</strong> Toggl Tasks -> QBO Service Items (required)</li>
        </ul>
        <p><em>*This system uses QBO Sub-Customers as "Projects". Top-level QBO Customers = Clients, Sub-Customers = Projects.</em></p>
      </div>

      <div class="section">
        <h2>Settings</h2>
        <ul>
          <li><strong>Date Range:</strong> Set specific dates or use "last N days" (Settings > Configure Date Range)</li>
          <li><strong>Tag Names:</strong> Edit APPROVED_TAG and SYNCED_TAG directly in the Config sheet</li>
        </ul>
      </div>

      <div class="section">
        <h2>Troubleshooting</h2>
        <ul>
          <li><strong>OAuth fails:</strong> Check Client ID/Secret and redirect URI match exactly</li>
          <li><strong>No entries to sync:</strong> Ensure entries have the "${approvedTag}" tag in Toggl</li>
          <li><strong>Sync errors:</strong> Check mappings are configured for Users, Projects, and Tasks</li>
          <li><strong>QBO Projects empty:</strong> Re-authorize after adding scope, or check QBO subscription level</li>
        </ul>
      </div>

      <div class="section">
        <h2>Support</h2>
        <p>Check the Sync_Log sheet for sync history and errors.</p>
        <p>View Apps Script execution logs (Extensions > Apps Script > Executions) for detailed error messages.</p>
      </div>
    </body>
    </html>
  `)
    .setWidth(650)
    .setHeight(750);

  SpreadsheetApp.getUi().showModalDialog(html, 'Help - Toggl-QBO Sync');
}

// ============================================================================
// INSTALLED TRIGGERS
// ============================================================================

/**
 * Creates time-based trigger for automated syncing
 */
function setupAutomatedTriggers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Setup Automated Triggers',
    'This will create an automated trigger that syncs approved entries daily at 6 AM.\n\n' +
    'Existing triggers will be replaced. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'automatedSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create daily sync trigger at 6 AM
  ScriptApp.newTrigger('automatedSync')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  showAlert('Automated trigger created! Sync will run daily at 6 AM.', 'Trigger Setup');
}

/**
 * Removes all automated triggers
 */
function removeAutomatedTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'automatedSync') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  showAlert(`Removed ${removed} automated triggers.`, 'Triggers Removed');
}

/**
 * Handler for automated sync trigger
 */
function automatedSync() {
  try {
    logMessage('Starting automated sync of approved entries...', 'INFO');
    syncApprovedEntries();
    logMessage('Automated sync completed.', 'INFO');
  } catch (error) {
    logMessage(`Automated sync failed: ${error.message}`, 'ERROR');
  }
}