/**
 * Menu.gs - Custom menu and UI triggers
 * Creates the Toggl-QBO Sync menu and handles user interactions
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
        .addItem('Wire Dropdowns', 'wireAllDropdownsWithInbox')
    )

    // Import submenu
    .addSubMenu(
      ui.createMenu('Import from Toggl')
        .addItem('Import All Users (Recommended)', 'importAllUsersEntries')
        .addItem('Import Current User Only', 'importCurrentUserEntries')
        .addSeparator()
        .addItem('Show Import Settings', 'showImportSettings')
    )

    // Inbox submenu
    .addSubMenu(
      ui.createMenu('Inbox')
        .addItem('Validate Entries', 'validateInboxEntries')
        .addItem('Auto-Populate Mappings', 'autoPopulateInboxMappings')
        .addSeparator()
        .addItem('Approve All Entries', 'approveAllInboxEntries')
        .addItem('Show Inbox Stats', 'showInboxStats')
        .addSeparator()
        .addItem('Refresh Inbox Formatting', 'refreshInboxFormatting')
        .addItem('Filter: Needs Review', 'filterNeedsReview')
        .addItem('Clear Filters', 'clearInboxFilters')
        .addSeparator()
        .addItem('Clear Inbox', 'clearInbox')
    )

    // Sync submenu
    .addSubMenu(
      ui.createMenu('Sync to QuickBooks')
        .addItem('Process Inbox → Queue', 'processInboxToQueue')
        .addItem('Sync Queue → QBO', 'syncQueueToQBO')
        .addSeparator()
        .addItem('Run Full Sync', 'runFullSync')
        .addSeparator()
        .addItem('Reset Failed Queue Entries', 'resetFailedQueueEntries')
    )

    // Maintenance submenu
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Cleanup Orphaned Mappings', 'cleanupOrphanedMappings')
        .addSeparator()
        .addItem('View Sync Log', 'viewSyncLog')
        .addItem('Clear Sync Log', 'clearSyncLog')
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

    // Inbox sheet
    setupInboxSheet();

    // Queue sheet
    getOrCreateSheet(CONFIG.SHEETS.QUEUE, CONFIG.COLUMNS.QUEUE);

    // Archive sheet
    getOrCreateSheet(CONFIG.SHEETS.ARCHIVE, CONFIG.COLUMNS.ARCHIVE);

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
      'All sheets have been created successfully!\n\nNext steps:\n' +
      '1. Set your credentials in Script Properties\n' +
      '2. Connect to QuickBooks (Setup > Connect to QuickBooks)\n' +
      '3. Refresh data (Refresh Data > Refresh All)\n' +
      '4. Configure your mappings',
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

  // Format each mapping sheet
  const sheetConfigs = [
    { name: CONFIG.SHEETS.MAPPINGS_CLIENTS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_PROJECTS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_USERS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.MAPPINGS_TASKS, headerColor: '#6aa84f' },
    { name: CONFIG.SHEETS.QBO_CUSTOMERS, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_EMPLOYEES, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_ITEMS, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QBO_PROJECTS, headerColor: '#3d85c6' },
    { name: CONFIG.SHEETS.QUEUE, headerColor: '#e69138' },
    { name: CONFIG.SHEETS.ARCHIVE, headerColor: '#999999' }
  ];

  sheetConfigs.forEach(config => {
    const sheet = ss.getSheetByName(config.name);
    if (sheet) {
      const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
      headerRange.setFontWeight('bold');
      headerRange.setBackground(config.headerColor);
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });
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
    'This will:\n1. Refresh QBO master lists (Customers, Employees, Items, Projects)\n2. Refresh Toggl mappings (Users, Clients, Projects, Tasks)\n3. Wire dropdowns\n\nThis may take a moment. Continue?',
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
    wireAllDropdownsWithInbox();

    showAlert('All data refreshed successfully!', 'Refresh Complete');
  } catch (error) {
    showAlert(`Refresh failed: ${error.message}`, 'Refresh Error');
  }
}

/**
 * Wires dropdowns on all sheets including Inbox
 */
function wireAllDropdownsWithInbox() {
  wireAllDropdowns();
  wireInboxDropdowns();
}

// ============================================================================
// IMPORT SETTINGS
// ============================================================================

/**
 * Shows current import settings and allows adjustment
 */
function showImportSettings() {
  const currentDays = getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS);
  const lastImport = getConfigValue('LAST_IMPORT_DATE', 'Never');
  const billableOnly = getConfigValue('SYNC_BILLABLE_ONLY', 'FALSE');

  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Import Settings',
    `Current Settings:
- Import last N days: ${currentDays}
- Last import: ${lastImport}
- Billable only: ${billableOnly}

Enter new value for "Import last N days" (or cancel to keep current):`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const newDays = parseInt(response.getResponseText().trim(), 10);
    if (!isNaN(newDays) && newDays > 0 && newDays <= 365) {
      setConfigValue('IMPORT_DAYS', newDays);
      showToast(`Import range set to ${newDays} days.`);
    } else {
      showAlert('Invalid value. Please enter a number between 1 and 365.', 'Invalid Input');
    }
  }
}

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Views the sync log (from Logger or custom log)
 */
function viewSyncLog() {
  const ui = SpreadsheetApp.getUi();

  // For now, show last sync info
  const lastImport = getConfigValue('LAST_IMPORT_DATE', 'Never');
  const lastSync = getConfigValue('LAST_SYNC_DATE', 'Never');

  const ss = getSpreadsheet();
  const queueSheet = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  const archiveSheet = ss.getSheetByName(CONFIG.SHEETS.ARCHIVE);
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  const queueCount = queueSheet ? Math.max(0, queueSheet.getLastRow() - 1) : 0;
  const archiveCount = archiveSheet ? Math.max(0, archiveSheet.getLastRow() - 1) : 0;
  const inboxCount = inboxSheet ? Math.max(0, inboxSheet.getLastRow() - 1) : 0;

  showAlert(
    `Sync Status Summary

Last Import: ${lastImport}
Last Sync: ${lastSync}

Current Counts:
- Inbox: ${inboxCount} entries
- Queue: ${queueCount} entries
- Archive: ${archiveCount} entries (synced)

Note: Detailed logs are available in Apps Script Execution Log.`,
    'Sync Log'
  );
}

/**
 * Clears sync-related config values
 */
function clearSyncLog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Clear Sync Log',
    'This will reset the last import/sync dates. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    setConfigValue('LAST_IMPORT_DATE', '');
    setConfigValue('LAST_SYNC_DATE', '');
    showToast('Sync log cleared.');
  }
}

// ============================================================================
// HELP
// ============================================================================

/**
 * Shows help documentation
 */
function showHelp() {
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
      </style>
    </head>
    <body>
      <h1>Toggl → QuickBooks Time Sync</h1>

      <div class="section">
        <h2>Quick Start</h2>
        <div class="step">
          <strong>Step 1:</strong> Set up credentials in Script Properties<br>
          (File > Project Properties > Script Properties)
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
          <strong>Step 5:</strong> Configure mappings in the Mappings_ sheets
        </div>
        <div class="step">
          <strong>Step 6:</strong> Import time entries (Import from Toggl > Import All Users)
        </div>
        <div class="step">
          <strong>Step 7:</strong> Review, approve, and sync (Sync to QuickBooks > Run Full Sync)
        </div>
      </div>

      <div class="section">
        <h2>Data Flow</h2>
        <p>Toggl Track → <strong>Inbox</strong> (review/approve) → <strong>Queue</strong> → QuickBooks → <strong>Archive</strong></p>
      </div>

      <div class="section">
        <h2>Required Mappings</h2>
        <ul>
          <li><strong>Users:</strong> Toggl Users → QBO Employees (required)</li>
          <li><strong>Projects/Clients:</strong> → QBO Customers (required)</li>
          <li><strong>Tasks:</strong> → QBO Service Items (required)</li>
          <li><strong>QBO Projects:</strong> Optional - can sync without</li>
        </ul>
      </div>

      <div class="section">
        <h2>Troubleshooting</h2>
        <ul>
          <li><strong>OAuth fails:</strong> Check Client ID/Secret and redirect URI</li>
          <li><strong>No entries imported:</strong> Check date range in Import Settings</li>
          <li><strong>Validation errors:</strong> Configure missing mappings</li>
          <li><strong>Sync fails:</strong> Check Queue sheet for error details</li>
        </ul>
      </div>

      <div class="section">
        <h2>Support</h2>
        <p>Check the execution logs (View > Executions) for detailed error messages.</p>
      </div>
    </body>
    </html>
  `)
    .setWidth(600)
    .setHeight(700);

  SpreadsheetApp.getUi().showModalDialog(html, 'Help - Toggl-QBO Sync');
}

// ============================================================================
// UTILITY MENU FUNCTIONS
// ============================================================================

/**
 * Quick action: Import and prepare for review
 */
function quickImportAndValidate() {
  try {
    importAllUsersEntries();
    validateInboxEntries();
    wireInboxDropdowns();
    showToast('Import complete. Review entries in Inbox.');
  } catch (error) {
    showAlert(`Quick import failed: ${error.message}`, 'Error');
  }
}

/**
 * Quick action: Validate, approve all, and sync
 */
function quickSyncAll() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Quick Sync All',
    'This will validate all Inbox entries, approve those that are ready, and sync to QuickBooks.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  try {
    // Validate
    validateInboxEntries();

    // Get inbox and approve only valid entries
    const ss = getSpreadsheet();
    const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

    if (inboxSheet && inboxSheet.getLastRow() > 1) {
      const lastRow = inboxSheet.getLastRow();
      const statuses = inboxSheet.getRange(2, 17, lastRow - 1, 1).getValues();

      for (let i = 0; i < statuses.length; i++) {
        if (statuses[i][0] === 'Ready') {
          inboxSheet.getRange(i + 2, 19).setValue(true);
        }
      }
    }

    // Run full sync
    runFullSync();
  } catch (error) {
    showAlert(`Quick sync failed: ${error.message}`, 'Error');
  }
}

// ============================================================================
// INSTALLED TRIGGERS
// ============================================================================

/**
 * Creates time-based triggers for automated syncing
 */
function setupAutomatedTriggers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Setup Automated Triggers',
    'This will create the following automated triggers:\n\n' +
    '• Daily import at 6 AM\n' +
    '• Daily sync at 7 AM\n\n' +
    'Existing triggers will be replaced. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'automatedImport' ||
        trigger.getHandlerFunction() === 'automatedSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create daily import trigger at 6 AM
  ScriptApp.newTrigger('automatedImport')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  // Create daily sync trigger at 7 AM
  ScriptApp.newTrigger('automatedSync')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();

  showAlert('Automated triggers created successfully!', 'Triggers Setup');
}

/**
 * Removes all automated triggers
 */
function removeAutomatedTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'automatedImport' ||
        trigger.getHandlerFunction() === 'automatedSync') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  showAlert(`Removed ${removed} automated triggers.`, 'Triggers Removed');
}

/**
 * Handler for automated import trigger
 */
function automatedImport() {
  try {
    logMessage('Starting automated import...', 'INFO');
    importAllUsersEntries();
    validateInboxEntries();
    logMessage('Automated import completed.', 'INFO');
  } catch (error) {
    logMessage(`Automated import failed: ${error.message}`, 'ERROR');
  }
}

/**
 * Handler for automated sync trigger
 */
function automatedSync() {
  try {
    logMessage('Starting automated sync...', 'INFO');

    // Auto-approve ready entries
    const ss = getSpreadsheet();
    const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

    if (inboxSheet && inboxSheet.getLastRow() > 1) {
      const lastRow = inboxSheet.getLastRow();
      const statuses = inboxSheet.getRange(2, 17, lastRow - 1, 1).getValues();

      for (let i = 0; i < statuses.length; i++) {
        if (statuses[i][0] === 'Ready') {
          inboxSheet.getRange(i + 2, 19).setValue(true);
        }
      }
    }

    // Process and sync
    processInboxToQueue();
    syncQueueToQBO();

    logMessage('Automated sync completed.', 'INFO');
  } catch (error) {
    logMessage(`Automated sync failed: ${error.message}`, 'ERROR');
  }
}
