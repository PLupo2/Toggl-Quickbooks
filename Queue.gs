/**
 * Queue.gs - Sync processing logic
 * Handles the Inbox → Queue → QBO → Archive workflow
 *
 * Inbox Column Order (0-indexed for array access):
 * 0: Date, 1: Start Time, 2: End Time, 3: Duration
 * 4: Toggl User, 5: QBO Employee
 * 6: Toggl Client, 7: Toggl Project, 8: QBO Customer, 9: QBO Project
 * 10: Toggl Task, 11: QBO Service Item
 * 12: Description, 13: Billable, 14: Tags, 15: Status, 16: Approved
 * 17: Toggl Entry ID, 18: Validation Errors, 19: Imported At, 20: Notes
 */

// Inbox column indexes (0-based for array access)
const QUEUE_INBOX_IDX = {
  DATE: 0,
  START_TIME: 1,
  END_TIME: 2,
  DURATION: 3,
  TOGGL_USER: 4,
  QBO_EMPLOYEE: 5,
  TOGGL_CLIENT: 6,
  TOGGL_PROJECT: 7,
  QBO_CUSTOMER: 8,
  QBO_PROJECT: 9,
  TOGGL_TASK: 10,
  QBO_SERVICE_ITEM: 11,
  DESCRIPTION: 12,
  BILLABLE: 13,
  TAGS: 14,
  STATUS: 15,
  APPROVED: 16,
  TOGGL_ENTRY_ID: 17,
  VALIDATION_ERRORS: 18,
  IMPORTED_AT: 19,
  NOTES: 20
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses duration from h:mm format to decimal hours
 * @param {string} duration - Duration in h:mm format (e.g., "1:30")
 * @returns {number} Duration in decimal hours (e.g., 1.5)
 */
function parseDurationToHours(duration) {
  if (!duration) return 0;

  const durationStr = String(duration);
  if (durationStr.includes(':')) {
    const parts = durationStr.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours + (minutes / 60);
  }

  // If it's already a number, return it
  return parseFloat(duration) || 0;
}

// ============================================================================
// INBOX PROCESSING
// ============================================================================

/**
 * Processes approved entries from Inbox to Queue
 * Validates mappings and moves entries to Queue for sync
 */
function processInboxToQueue() {
  showToast('Processing approved entries...');

  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox to process.');
    return;
  }

  // Build mapping lookups
  const mappings = buildMappingLookups();

  // Get inbox data
  const lastRow = inboxSheet.getLastRow();
  const data = inboxSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMNS.INBOX.length).getValues();

  const queueEntries = [];
  const rowsToRemove = [];
  const validationErrors = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    // Check if approved (column 17 = index 16, value should be "Approved")
    const approvalStatus = row[QUEUE_INBOX_IDX.APPROVED];
    if (approvalStatus !== 'Approved') {
      continue;
    }

    // Validate and resolve mappings
    const validation = validateAndResolveEntry(row, mappings);

    if (validation.valid) {
      queueEntries.push({
        rowData: validation.queueRow,
        inboxRowNum: rowNum
      });
      rowsToRemove.push(rowNum);
    } else {
      // Update validation errors in Inbox (column 19 = 1-indexed)
      inboxSheet.getRange(rowNum, QUEUE_INBOX_IDX.VALIDATION_ERRORS + 1).setValue(validation.errors.join('; '));
      validationErrors.push({
        togglEntryId: row[QUEUE_INBOX_IDX.TOGGL_ENTRY_ID],
        errors: validation.errors
      });
    }
  }

  // Write to Queue
  if (queueEntries.length > 0) {
    const queueSheet = getOrCreateSheet(CONFIG.SHEETS.QUEUE, CONFIG.COLUMNS.QUEUE);
    const queueRows = queueEntries.map(e => e.rowData);
    const queueLastRow = queueSheet.getLastRow();
    queueSheet.getRange(queueLastRow + 1, 1, queueRows.length, queueRows[0].length).setValues(queueRows);
  }

  // Remove processed rows from Inbox (from bottom to top)
  rowsToRemove.sort((a, b) => b - a).forEach(rowNum => {
    inboxSheet.deleteRow(rowNum);
  });

  const message = `Processed: ${queueEntries.length} moved to Queue, ${validationErrors.length} have validation errors`;
  logMessage(message, 'INFO');
  showToast(message);

  if (validationErrors.length > 0) {
    logMessage(`Validation errors: ${JSON.stringify(validationErrors)}`, 'WARN');
  }
}

/**
 * Validates an inbox entry and resolves its QBO mappings
 * @param {Array} row - Inbox row data (0-indexed)
 * @param {Object} mappings - Mapping lookups
 * @returns {Object} Validation result with queueRow and errors
 */
function validateAndResolveEntry(row, mappings) {
  const errors = [];

  // Parse inbox row using new column indexes
  const date = row[QUEUE_INBOX_IDX.DATE];
  const duration = row[QUEUE_INBOX_IDX.DURATION];
  const togglUser = row[QUEUE_INBOX_IDX.TOGGL_USER];
  const qboEmployeeFromInbox = row[QUEUE_INBOX_IDX.QBO_EMPLOYEE];
  const togglClient = row[QUEUE_INBOX_IDX.TOGGL_CLIENT];
  const togglProject = row[QUEUE_INBOX_IDX.TOGGL_PROJECT];
  const qboCustomerFromInbox = row[QUEUE_INBOX_IDX.QBO_CUSTOMER];
  const qboProjectFromInbox = row[QUEUE_INBOX_IDX.QBO_PROJECT];
  const togglTask = row[QUEUE_INBOX_IDX.TOGGL_TASK];
  const qboServiceItemFromInbox = row[QUEUE_INBOX_IDX.QBO_SERVICE_ITEM];
  const description = row[QUEUE_INBOX_IDX.DESCRIPTION];
  const billable = row[QUEUE_INBOX_IDX.BILLABLE];
  const togglEntryId = row[QUEUE_INBOX_IDX.TOGGL_ENTRY_ID];

  // Convert duration from h:mm format to hours
  const durationHours = parseDurationToHours(duration);

  // Initialize resolved values
  let qboEmployeeId = '';
  let qboEmployeeName = '';
  let qboCustomerId = '';
  let qboCustomerName = '';
  let qboProjectId = '';
  let qboProjectName = '';
  let qboServiceItemId = '';
  let qboServiceItemName = '';

  // Try to resolve Employee
  // First check if manually selected in Inbox
  if (qboEmployeeFromInbox) {
    const employeeLookup = lookupQBOEntityByName('employees', qboEmployeeFromInbox);
    if (employeeLookup) {
      qboEmployeeId = employeeLookup.id;
      qboEmployeeName = employeeLookup.name;
    }
  }

  // If not found, try mapping by user name
  if (!qboEmployeeId) {
    const userMapping = findUserMappingByName(togglUser, mappings);
    if (userMapping) {
      qboEmployeeId = userMapping.qboEmployeeId;
      qboEmployeeName = userMapping.qboEmployeeName;
    }
  }

  if (!qboEmployeeId) {
    errors.push('Missing Employee mapping');
  }

  // Try to resolve Customer
  if (qboCustomerFromInbox) {
    const customerLookup = lookupQBOEntityByName('customers', qboCustomerFromInbox);
    if (customerLookup) {
      qboCustomerId = customerLookup.id;
      qboCustomerName = customerLookup.name;
    }
  }

  // If not found, try mapping by project or client
  if (!qboCustomerId) {
    const projectMapping = findProjectMappingByName(togglProject, mappings);
    if (projectMapping && projectMapping.qboCustomerId) {
      qboCustomerId = projectMapping.qboCustomerId;
      qboCustomerName = projectMapping.qboCustomerName;
      qboProjectId = projectMapping.qboProjectId || '';
      qboProjectName = projectMapping.qboProjectName || '';
    } else {
      // Try client mapping
      const clientMapping = findClientMappingByName(togglClient, mappings);
      if (clientMapping) {
        qboCustomerId = clientMapping.qboCustomerId;
        qboCustomerName = clientMapping.qboCustomerName;
      }
    }
  }

  if (!qboCustomerId) {
    errors.push('Missing Customer mapping');
  }

  // Try to resolve QBO Project (optional)
  if (qboProjectFromInbox && !qboProjectId) {
    const projectLookup = lookupQBOEntityByName('projects', qboProjectFromInbox);
    if (projectLookup) {
      qboProjectId = projectLookup.id;
      qboProjectName = projectLookup.name;
    }
  }

  // Try to resolve Service Item
  if (qboServiceItemFromInbox) {
    const itemLookup = lookupQBOEntityByName('items', qboServiceItemFromInbox);
    if (itemLookup) {
      qboServiceItemId = itemLookup.id;
      qboServiceItemName = itemLookup.name;
    }
  }

  // If not found, try task mapping
  if (!qboServiceItemId && togglTask) {
    const taskMapping = findTaskMappingByName(togglTask, togglProject, mappings);
    if (taskMapping) {
      qboServiceItemId = taskMapping.qboServiceItemId;
      qboServiceItemName = taskMapping.qboServiceItemName;
    }
  }

  if (!qboServiceItemId) {
    errors.push('Missing Service Item mapping');
  }

  // Validate duration
  if (!durationHours || durationHours <= 0) {
    errors.push('Invalid duration');
  }

  // Validate date
  if (!date) {
    errors.push('Missing date');
  }

  // Build queue row
  const queueRow = [
    togglEntryId,
    qboEmployeeId,
    qboEmployeeName,
    qboCustomerId,
    qboCustomerName,
    qboProjectId,
    qboProjectName,
    qboServiceItemId,
    qboServiceItemName,
    description,
    formatDate(date),
    durationHours,
    billable,
    formatDateTime(new Date()),
    0, // Sync attempts
    '' // Last error
  ];

  return {
    valid: errors.length === 0,
    queueRow: queueRow,
    errors: errors
  };
}

// ============================================================================
// LOOKUP HELPERS
// ============================================================================

/**
 * Looks up a QBO entity by name from master sheets
 * @param {string} entityType - 'employees', 'customers', 'items', 'projects'
 * @param {string} name - Entity name to find
 * @returns {Object|null} Entity with id and name, or null
 */
function lookupQBOEntityByName(entityType, name) {
  if (!name) return null;

  const ss = getSpreadsheet();
  const sheetMap = {
    employees: CONFIG.SHEETS.QBO_EMPLOYEES,
    customers: CONFIG.SHEETS.QBO_CUSTOMERS,
    items: CONFIG.SHEETS.QBO_ITEMS,
    projects: CONFIG.SHEETS.QBO_PROJECTS
  };

  const sheetName = sheetMap[entityType];
  if (!sheetName) return null;

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const normalizedName = name.toLowerCase().trim();

  for (const [id, entityName] of data) {
    if ((entityName || '').toLowerCase().trim() === normalizedName) {
      return { id: String(id), name: entityName };
    }
  }

  return null;
}

/**
 * Finds user mapping by Toggl user name
 * @param {string} togglUserName - Toggl user name
 * @param {Object} mappings - Mapping lookups
 * @returns {Object|null} Mapping data or null
 */
function findUserMappingByName(togglUserName, mappings) {
  if (!togglUserName) return null;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_USERS);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const normalizedName = togglUserName.toLowerCase().trim();

  for (const row of data) {
    const mappingName = (row[1] || '').toLowerCase().trim();
    if (mappingName === normalizedName && row[3]) {
      return {
        qboEmployeeId: String(row[3]),
        qboEmployeeName: row[4] || ''
      };
    }
  }

  return null;
}

/**
 * Finds project mapping by Toggl project name
 * @param {string} togglProjectName - Toggl project name
 * @param {Object} mappings - Mapping lookups
 * @returns {Object|null} Mapping data or null
 */
function findProjectMappingByName(togglProjectName, mappings) {
  if (!togglProjectName) return null;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const normalizedName = togglProjectName.toLowerCase().trim();

  for (const row of data) {
    const mappingName = (row[1] || '').toLowerCase().trim();
    if (mappingName === normalizedName) {
      return {
        qboCustomerId: row[3] ? String(row[3]) : '',
        qboCustomerName: row[4] || '',
        qboProjectId: row[5] ? String(row[5]) : '',
        qboProjectName: row[6] || ''
      };
    }
  }

  return null;
}

/**
 * Finds client mapping by Toggl client name
 * @param {string} togglClientName - Toggl client name
 * @param {Object} mappings - Mapping lookups
 * @returns {Object|null} Mapping data or null
 */
function findClientMappingByName(togglClientName, mappings) {
  if (!togglClientName) return null;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_CLIENTS);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const normalizedName = togglClientName.toLowerCase().trim();

  for (const row of data) {
    const mappingName = (row[1] || '').toLowerCase().trim();
    if (mappingName === normalizedName && row[2]) {
      return {
        qboCustomerId: String(row[2]),
        qboCustomerName: row[3] || ''
      };
    }
  }

  return null;
}

/**
 * Finds task mapping by Toggl task and project name
 * @param {string} togglTaskName - Toggl task name
 * @param {string} togglProjectName - Toggl project name (for context)
 * @param {Object} mappings - Mapping lookups
 * @returns {Object|null} Mapping data or null
 */
function findTaskMappingByName(togglTaskName, togglProjectName, mappings) {
  if (!togglTaskName) return null;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const normalizedTask = togglTaskName.toLowerCase().trim();
  const normalizedProject = (togglProjectName || '').toLowerCase().trim();

  // First try exact match with project context
  for (const row of data) {
    const mappingTask = (row[1] || '').toLowerCase().trim();
    const mappingProject = (row[2] || '').toLowerCase().trim();

    if (mappingTask === normalizedTask && mappingProject === normalizedProject && row[4]) {
      return {
        qboServiceItemId: String(row[4]),
        qboServiceItemName: row[5] || ''
      };
    }
  }

  // Fall back to task name only match
  for (const row of data) {
    const mappingTask = (row[1] || '').toLowerCase().trim();

    if (mappingTask === normalizedTask && row[4]) {
      return {
        qboServiceItemId: String(row[4]),
        qboServiceItemName: row[5] || ''
      };
    }
  }

  return null;
}

// ============================================================================
// QUEUE TO QBO SYNC
// ============================================================================

/**
 * Syncs all entries in the Queue to QuickBooks Online
 */
function syncQueueToQBO() {
  showToast('Starting sync to QuickBooks...');

  const validation = validateQBOSetup();
  if (!validation.valid) {
    showAlert(`Cannot sync: ${validation.errors.join(', ')}`, 'Sync Error');
    return;
  }

  const ss = getSpreadsheet();
  const queueSheet = ss.getSheetByName(CONFIG.SHEETS.QUEUE);

  if (!queueSheet || queueSheet.getLastRow() <= 1) {
    showToast('No entries in Queue to sync.');
    return;
  }

  const lastRow = queueSheet.getLastRow();
  const data = queueSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMNS.QUEUE.length).getValues();

  const results = {
    synced: [],
    failed: []
  };

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    const togglEntryId = row[0];
    const syncAttempts = parseInt(row[14], 10) || 0;

    // Skip entries with too many failed attempts
    if (syncAttempts >= 3) {
      logMessage(`Skipping entry ${togglEntryId} - too many failed attempts`, 'WARN');
      continue;
    }

    try {
      const timeActivityData = {
        togglEntryId: togglEntryId,
        employeeId: row[1],
        customerId: row[3],
        projectId: row[5] || null,
        serviceItemId: row[7],
        description: row[9],
        date: formatDate(row[10]),
        hours: parseFloat(row[11]),
        billable: row[12]
      };

      const timeActivity = createTimeActivity(timeActivityData);

      results.synced.push({
        rowNum: rowNum,
        togglEntryId: togglEntryId,
        qboActivityId: timeActivity.Id,
        rowData: row
      });

    } catch (error) {
      logMessage(`Failed to sync entry ${togglEntryId}: ${error.message}`, 'ERROR');

      // Update sync attempts and error
      queueSheet.getRange(rowNum, 15).setValue(syncAttempts + 1);
      queueSheet.getRange(rowNum, 16).setValue(error.message);

      results.failed.push({
        rowNum: rowNum,
        togglEntryId: togglEntryId,
        error: error.message
      });
    }

    // Small delay between API calls
    Utilities.sleep(200);
  }

  // Move synced entries to Archive
  if (results.synced.length > 0) {
    moveToArchive(results.synced);
  }

  // Remove synced rows from Queue (from bottom to top)
  const rowsToRemove = results.synced.map(s => s.rowNum).sort((a, b) => b - a);
  rowsToRemove.forEach(rowNum => {
    queueSheet.deleteRow(rowNum);
  });

  // Update last sync date
  setConfigValue('LAST_SYNC_DATE', formatDateTime(new Date()));

  const message = `Sync complete: ${results.synced.length} synced, ${results.failed.length} failed`;
  logMessage(message, 'INFO');
  showToast(message);

  if (results.failed.length > 0) {
    showAlert(
      `${results.failed.length} entries failed to sync. Check the Queue sheet for details.`,
      'Sync Errors'
    );
  }
}

/**
 * Moves synced entries to the Archive sheet
 * @param {Object[]} syncedEntries - Array of synced entry data
 */
function moveToArchive(syncedEntries) {
  const archiveSheet = getOrCreateSheet(CONFIG.SHEETS.ARCHIVE, CONFIG.COLUMNS.ARCHIVE);

  const archiveRows = syncedEntries.map(entry => {
    const row = entry.rowData;
    return [
      entry.togglEntryId,           // Toggl Entry ID
      entry.qboActivityId,          // QBO TimeActivity ID
      row[2],                       // QBO Employee Name
      row[4],                       // QBO Customer Name
      row[6],                       // QBO Project Name
      row[8],                       // QBO Service Item Name
      row[9],                       // Description
      formatDate(row[10]),          // Date
      row[11],                      // Duration (hrs)
      row[12],                      // Billable
      formatDateTime(new Date()),   // Synced At
      row[13],                      // Original Import Date (Added to Queue At)
      ''                            // Notes
    ];
  });

  if (archiveRows.length > 0) {
    const lastRow = archiveSheet.getLastRow();
    archiveSheet.getRange(lastRow + 1, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
  }
}

// ============================================================================
// FULL WORKFLOW
// ============================================================================

/**
 * Runs the complete sync workflow:
 * 1. Process approved Inbox entries to Queue
 * 2. Sync Queue to QBO
 */
function runFullSync() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Run Full Sync',
    'This will:\n1. Process all approved entries from Inbox to Queue\n2. Sync all Queue entries to QuickBooks\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  try {
    // Step 1: Inbox to Queue
    processInboxToQueue();

    // Step 2: Queue to QBO
    syncQueueToQBO();

    showAlert('Full sync completed successfully!', 'Sync Complete');
  } catch (error) {
    showAlert(`Sync failed: ${error.message}`, 'Sync Error');
    logMessage(`Full sync error: ${error.message}`, 'ERROR');
  }
}

// ============================================================================
// MANUAL RETRY
// ============================================================================

/**
 * Resets sync attempts for all failed Queue entries
 * Allows them to be retried
 */
function resetFailedQueueEntries() {
  const ss = getSpreadsheet();
  const queueSheet = ss.getSheetByName(CONFIG.SHEETS.QUEUE);

  if (!queueSheet || queueSheet.getLastRow() <= 1) {
    showToast('No entries in Queue.');
    return;
  }

  const lastRow = queueSheet.getLastRow();

  // Reset sync attempts (column 15) and clear last error (column 16)
  for (let row = 2; row <= lastRow; row++) {
    queueSheet.getRange(row, 15).setValue(0);
    queueSheet.getRange(row, 16).setValue('');
  }

  showToast('Reset all failed entries. They will be retried on next sync.');
}

// ============================================================================
// APPROVAL HELPERS
// ============================================================================

/**
 * Approves all entries in the Inbox
 */
function approveAllInboxEntries() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox to approve.');
    return;
  }

  const lastRow = inboxSheet.getLastRow();

  // Set Approved column (column 17) to "Approved" for all rows
  const approvalRange = inboxSheet.getRange(2, 17, lastRow - 1, 1);
  const values = Array(lastRow - 1).fill(['Approved']);
  approvalRange.setValues(values);

  showToast(`Approved ${lastRow - 1} entries.`);
}

/**
 * Clears the Inbox (with confirmation)
 */
function clearInbox() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Clear Inbox',
    'This will delete ALL entries from the Inbox. This cannot be undone.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (inboxSheet && inboxSheet.getLastRow() > 1) {
    inboxSheet.deleteRows(2, inboxSheet.getLastRow() - 1);
    showToast('Inbox cleared.');
  }
}
