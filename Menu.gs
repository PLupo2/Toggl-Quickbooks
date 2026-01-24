/**
 * Menu.gs - Custom menu and UI triggers
 * Creates the Toggl-QBO Sync menu and handles user interactions
 *
 * NEW WORKFLOW: Tag-based sync
 * 1. In Toggl, tag entries with "Approved" when ready to sync
 * 2. Run "Sync Approved Entries" from menu
 * 3. Script syncs to QBO and adds "Synced" tag back to Toggl
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
        .addItem('Check QBO Projects Availability', 'showProjectsInfo')
    )

    // Refresh submenu
    .addSubMenu(
      ui.createMenu('Refresh Data')
        .addItem('Refresh Toggl Mappings', 'refreshTogglMappings')
        .addItem('Refresh QBO Master Lists', 'refreshQBOMasterLists')
        .addSeparator()
        .addItem('Refresh All', 'refreshAll')
        .addSeparator()
        .addItem('Wire Dropdowns', 'wireAllDropdowns')
    )

    // Settings submenu
    .addSubMenu(
      ui.createMenu('Settings')
        .addItem('Configure Date Range', 'configureDateRange')
        .addItem('Configure Tag Names', 'configureTagNames')
        .addSeparator()
        .addItem('Show Current Settings', 'showCurrentSettings')
    )

    // Maintenance submenu
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Cleanup Orphaned Mappings', 'cleanupOrphanedMappings')
        .addItem('View Sync Log', 'viewSyncLog')
        .addItem('Clear Sync Log', 'clearSyncLog')
        .addSeparator()
        .addItem('Ensure Tags Exist in Toggl', 'ensureWorkflowTagsExist')
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

    showAlert(
      'All sheets have been created successfully!\n\n' +
      'Next steps:\n' +
      '1. Set your credentials in Script Properties (TOGGL_API_TOKEN, INTUIT_CLIENT_ID, etc.)\n' +
      '2. Connect to QuickBooks (Setup > Connect to QuickBooks)\n' +
      '3. Refresh data (Refresh Data > Refresh All)\n' +
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
 * Shows current sync status and statistics
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

  showAlert(
    `Sync Status\n\n` +
    `Date Range: ${dateRange.startDate} to ${dateRange.endDate}\n` +
    `Last Sync: ${lastSync}\n` +
    `Sync Log Entries: ${syncLogCount}\n\n` +
    `Tag Configuration:\n` +
    `- Approved Tag: "${approvedTag}"\n` +
    `- Synced Tag: "${syncedTag}"\n\n` +
    `Workflow:\n` +
    `1. In Toggl, tag entries with "${approvedTag}"\n` +
    `2. Run "Sync Approved Entries"\n` +
    `3. Script syncs to QBO and adds "${syncedTag}" tag`,
    'Sync Status'
  );
}

// ============================================================================
// REFRESH FUNCTIONS
// ============================================================================

/**
 * Refreshes all data (Toggl and QBO)
 */
function refreshAll() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Refresh All Data',
    'This will:\n' +
    '1. Refresh QBO master lists (Customers, Employees, Items, Projects)\n' +
    '2. Refresh Toggl mappings (Users, Clients, Projects, Tasks)\n' +
    '3. Wire dropdowns\n\n' +
    'This may take a moment. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  try {
    showToast('Refreshing QBO master lists...');
    refreshQBOMasterLists();

    showToast('Refreshing Toggl mappings...');
    refreshTogglMappings();

    showToast('Wiring dropdowns...');
    wireAllDropdowns();

    showAlert('All data refreshed successfully!', 'Refresh Complete');
  } catch (error) {
    showAlert(`Refresh failed: ${error.message}`, 'Refresh Error');
  }
}

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

/**
 * Configures the date range for sync
 */
function configureDateRange() {
  const currentStart = getConfigValue('START_DATE', '');
  const currentEnd = getConfigValue('END_DATE', '');
  const currentDays = getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS);

  const ui = SpreadsheetApp.getUi();

  // Ask for start date
  const startResponse = ui.prompt(
    'Configure Date Range - Start Date',
    `Current Start Date: ${currentStart || `(calculated: last ${currentDays} days)`}\n\n` +
    `Enter start date (YYYY-MM-DD) or leave blank to use IMPORT_DAYS:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (startResponse.getSelectedButton() !== ui.Button.OK) return;

  const newStart = startResponse.getResponseText().trim();
  if (newStart && !isValidDate(newStart)) {
    showAlert('Invalid date format. Please use YYYY-MM-DD.', 'Invalid Input');
    return;
  }
  setConfigValue('START_DATE', newStart);

  // Ask for end date
  const endResponse = ui.prompt(
    'Configure Date Range - End Date',
    `Current End Date: ${currentEnd || '(today)'}\n\n` +
    `Enter end date (YYYY-MM-DD) or leave blank for today:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (endResponse.getSelectedButton() !== ui.Button.OK) return;

  const newEnd = endResponse.getResponseText().trim();
  if (newEnd && !isValidDate(newEnd)) {
    showAlert('Invalid date format. Please use YYYY-MM-DD.', 'Invalid Input');
    return;
  }
  setConfigValue('END_DATE', newEnd);

  // If start date is blank, ask for IMPORT_DAYS
  if (!newStart) {
    const daysResponse = ui.prompt(
      'Configure Import Days',
      `When START_DATE is blank, entries from the last N days are used.\n\n` +
      `Current: ${currentDays} days\n\n` +
      `Enter number of days (1-365):`,
      ui.ButtonSet.OK_CANCEL
    );

    if (daysResponse.getSelectedButton() === ui.Button.OK) {
      const newDays = parseInt(daysResponse.getResponseText().trim(), 10);
      if (!isNaN(newDays) && newDays > 0 && newDays <= 365) {
        setConfigValue('IMPORT_DAYS', newDays);
      }
    }
  }

  const dateRange = getImportDateRange();
  showAlert(
    `Date range configured!\n\n` +
    `Effective Range: ${dateRange.startDate} to ${dateRange.endDate}`,
    'Settings Updated'
  );
}

/**
 * Configures the tag names used for workflow
 */
function configureTagNames() {
  const currentApproved = getApprovedTagName();
  const currentSynced = getSyncedTagName();

  const ui = SpreadsheetApp.getUi();

  // Ask for approved tag
  const approvedResponse = ui.prompt(
    'Configure Tag Names - Approved Tag',
    `This is the tag you add in Toggl to mark entries as ready for sync.\n\n` +
    `Current: "${currentApproved}"\n\n` +
    `Enter tag name (or leave blank to keep current):`,
    ui.ButtonSet.OK_CANCEL
  );

  if (approvedResponse.getSelectedButton() !== ui.Button.OK) return;

  const newApproved = approvedResponse.getResponseText().trim();
  if (newApproved) {
    setConfigValue('APPROVED_TAG', newApproved);
  }

  // Ask for synced tag
  const syncedResponse = ui.prompt(
    'Configure Tag Names - Synced Tag',
    `This tag is automatically added to entries after successful sync.\n\n` +
    `Current: "${currentSynced}"\n\n` +
    `Enter tag name (or leave blank to keep current):`,
    ui.ButtonSet.OK_CANCEL
  );

  if (syncedResponse.getSelectedButton() !== ui.Button.OK) return;

  const newSynced = syncedResponse.getResponseText().trim();
  if (newSynced) {
    setConfigValue('SYNCED_TAG', newSynced);
  }

  showAlert(
    `Tag names configured!\n\n` +
    `Approved Tag: "${getApprovedTagName()}"\n` +
    `Synced Tag: "${getSyncedTagName()}"`,
    'Settings Updated'
  );
}

/**
 * Shows current settings
 */
function showCurrentSettings() {
  const dateRange = getImportDateRange();
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();
  const importDays = getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS);
  const billableOnly = getConfigValue('SYNC_BILLABLE_ONLY', 'FALSE');
  const lastSync = getConfigValue('LAST_SYNC_DATE', 'Never');

  showAlert(
    `Current Settings\n\n` +
    `Date Range:\n` +
    `  Start: ${getConfigValue('START_DATE', '') || `(last ${importDays} days)`}\n` +
    `  End: ${getConfigValue('END_DATE', '') || '(today)'}\n` +
    `  Effective: ${dateRange.startDate} to ${dateRange.endDate}\n\n` +
    `Tags:\n` +
    `  Approved: "${approvedTag}"\n` +
    `  Synced: "${syncedTag}"\n\n` +
    `Other:\n` +
    `  Sync Billable Only: ${billableOnly}\n` +
    `  Last Sync: ${lastSync}`,
    'Current Settings'
  );
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
 * Ensures the workflow tags exist in Toggl
 */
function ensureWorkflowTagsExist() {
  const approvedTag = getApprovedTagName();
  const syncedTag = getSyncedTagName();

  showToast('Checking/creating workflow tags in Toggl...');

  try {
    ensureTagExists(approvedTag);
    ensureTagExists(syncedTag);

    showAlert(
      `Workflow tags verified!\n\n` +
      `The following tags now exist in your Toggl workspace:\n` +
      `- "${approvedTag}" (add to entries ready to sync)\n` +
      `- "${syncedTag}" (added automatically after sync)`,
      'Tags Created'
    );
  } catch (error) {
    showAlert(`Failed to create tags: ${error.message}`, 'Error');
  }
}

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
          <strong>Step 4:</strong> Refresh data (Refresh Data > Refresh All)
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
          <strong>Step 6:</strong> Create workflow tags (Maintenance > Ensure Tags Exist in Toggl)
        </div>
      </div>

      <div class="section">
        <h2>Required Mappings</h2>
        <ul>
          <li><strong>Users:</strong> Toggl Users -> QBO Employees (required)</li>
          <li><strong>Projects/Clients:</strong> -> QBO Customers (required)</li>
          <li><strong>Tasks:</strong> -> QBO Service Items (required)</li>
          <li><strong>QBO Projects:</strong> Optional (requires QBO Plus/Advanced)</li>
        </ul>
      </div>

      <div class="section">
        <h2>Settings</h2>
        <ul>
          <li><strong>Date Range:</strong> Set specific dates or use "last N days" (Settings > Configure Date Range)</li>
          <li><strong>Tag Names:</strong> Customize the Approved/Synced tag names (Settings > Configure Tag Names)</li>
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
