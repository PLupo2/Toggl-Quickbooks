/**
 * Inbox.gs - Inbox sheet builder and management
 * Handles Inbox sheet setup, validation display, and approval workflow
 *
 * Column Order (1-indexed):
 * 1: Date, 2: Start Time, 3: End Time, 4: Duration
 * 5: Toggl User, 6: QBO Employee
 * 7: Toggl Client, 8: Toggl Project, 9: QBO Customer, 10: QBO Project
 * 11: Toggl Task, 12: QBO Service Item
 * 13: Description, 14: Billable, 15: Tags, 16: Status, 17: Approved
 * 18: Toggl Entry ID, 19: Validation Errors, 20: Imported At, 21: Notes
 */

// Column index constants for the new order (1-based)
const INBOX_COL = {
  DATE: 1,
  START_TIME: 2,
  END_TIME: 3,
  DURATION: 4,
  TOGGL_USER: 5,
  QBO_EMPLOYEE: 6,
  TOGGL_CLIENT: 7,
  TOGGL_PROJECT: 8,
  QBO_CUSTOMER: 9,
  QBO_PROJECT: 10,
  TOGGL_TASK: 11,
  QBO_SERVICE_ITEM: 12,
  DESCRIPTION: 13,
  BILLABLE: 14,
  TAGS: 15,
  STATUS: 16,
  APPROVED: 17,
  TOGGL_ENTRY_ID: 18,
  VALIDATION_ERRORS: 19,
  IMPORTED_AT: 20,
  NOTES: 21
};

// Visual grouping colors
const GROUP_COLORS = {
  TIME_INFO: '#e8f4f8',      // Light blue for Date/Time/Duration
  USER_MAPPING: '#fff2cc',    // Light yellow for Toggl User / QBO Employee
  PROJECT_MAPPING: '#d9ead3', // Light green for Client/Project mapping
  TASK_MAPPING: '#fce5cd',    // Light orange for Task / Service Item
  NEUTRAL: '#ffffff'          // White for other columns
};

// Approval status options
const APPROVAL_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ON_HOLD: 'On Hold'
};

// ============================================================================
// INBOX SHEET SETUP
// ============================================================================

/**
 * Creates or rebuilds the Inbox sheet with proper structure
 */
function setupInboxSheet() {
  const ss = getSpreadsheet();
  let inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (inboxSheet) {
    // Sheet exists - just ensure headers are correct
    inboxSheet.getRange(1, 1, 1, CONFIG.COLUMNS.INBOX.length).setValues([CONFIG.COLUMNS.INBOX]);
  } else {
    // Create new sheet
    inboxSheet = ss.insertSheet(CONFIG.SHEETS.INBOX);
    inboxSheet.getRange(1, 1, 1, CONFIG.COLUMNS.INBOX.length).setValues([CONFIG.COLUMNS.INBOX]);
  }

  // Apply header formatting with visual grouping
  formatInboxHeaders(inboxSheet);

  // Freeze header row
  inboxSheet.setFrozenRows(1);

  // Set column widths
  setInboxColumnWidths(inboxSheet);

  logMessage('Inbox sheet setup complete', 'INFO');
}

/**
 * Formats Inbox headers with visual grouping colors
 * @param {Sheet} inboxSheet - The Inbox sheet
 */
function formatInboxHeaders(inboxSheet) {
  const headerRange = inboxSheet.getRange(1, 1, 1, CONFIG.COLUMNS.INBOX.length);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#000000');
  headerRange.setWrap(true);
  headerRange.setVerticalAlignment('middle');

  // Apply group colors to header
  // Time info (Date, Start, End, Duration)
  inboxSheet.getRange(1, INBOX_COL.DATE, 1, 4).setBackground('#b4d7e8');

  // User mapping (Toggl User, QBO Employee)
  inboxSheet.getRange(1, INBOX_COL.TOGGL_USER, 1, 2).setBackground('#ffe599');

  // Project mapping (Toggl Client, Toggl Project, QBO Customer, QBO Project)
  inboxSheet.getRange(1, INBOX_COL.TOGGL_CLIENT, 1, 4).setBackground('#b6d7a8');

  // Task mapping (Toggl Task, QBO Service Item)
  inboxSheet.getRange(1, INBOX_COL.TOGGL_TASK, 1, 2).setBackground('#f9cb9c');

  // Other columns - neutral
  inboxSheet.getRange(1, INBOX_COL.DESCRIPTION, 1, 1).setBackground('#d9d9d9');
  inboxSheet.getRange(1, INBOX_COL.BILLABLE, 1, 4).setBackground('#d9d9d9');
  inboxSheet.getRange(1, INBOX_COL.TOGGL_ENTRY_ID, 1, 4).setBackground('#d9d9d9');

  // Add borders to separate groups
  addGroupBorders(inboxSheet);
}

/**
 * Adds borders to visually separate column groups
 * @param {Sheet} inboxSheet - The Inbox sheet
 */
function addGroupBorders(inboxSheet) {
  const lastRow = Math.max(inboxSheet.getLastRow(), 1);

  // Add right borders after each group
  const borderColumns = [
    INBOX_COL.DURATION,      // After time info
    INBOX_COL.QBO_EMPLOYEE,  // After user mapping
    INBOX_COL.QBO_PROJECT,   // After project mapping
    INBOX_COL.QBO_SERVICE_ITEM, // After task mapping
    INBOX_COL.APPROVED       // After status/approval
  ];

  borderColumns.forEach(col => {
    inboxSheet.getRange(1, col, lastRow, 1).setBorder(
      null, null, null, true, null, null,
      '#666666', SpreadsheetApp.BorderStyle.SOLID_MEDIUM
    );
  });
}

/**
 * Sets column widths for the Inbox sheet
 * @param {Sheet} inboxSheet - The Inbox sheet
 */
function setInboxColumnWidths(inboxSheet) {
  const columnWidths = {
    [INBOX_COL.DATE]: 100,
    [INBOX_COL.START_TIME]: 85,
    [INBOX_COL.END_TIME]: 85,
    [INBOX_COL.DURATION]: 75,
    [INBOX_COL.TOGGL_USER]: 130,
    [INBOX_COL.QBO_EMPLOYEE]: 130,
    [INBOX_COL.TOGGL_CLIENT]: 130,
    [INBOX_COL.TOGGL_PROJECT]: 150,
    [INBOX_COL.QBO_CUSTOMER]: 130,
    [INBOX_COL.QBO_PROJECT]: 130,
    [INBOX_COL.TOGGL_TASK]: 150,
    [INBOX_COL.QBO_SERVICE_ITEM]: 130,
    [INBOX_COL.DESCRIPTION]: 200,
    [INBOX_COL.BILLABLE]: 70,
    [INBOX_COL.TAGS]: 120,
    [INBOX_COL.STATUS]: 100,
    [INBOX_COL.APPROVED]: 100,
    [INBOX_COL.TOGGL_ENTRY_ID]: 120,
    [INBOX_COL.VALIDATION_ERRORS]: 180,
    [INBOX_COL.IMPORTED_AT]: 140,
    [INBOX_COL.NOTES]: 150
  };

  Object.entries(columnWidths).forEach(([col, width]) => {
    inboxSheet.setColumnWidth(parseInt(col, 10), width);
  });
}

/**
 * Applies visual grouping colors to data rows
 * @param {Sheet} inboxSheet - The Inbox sheet
 */
function applyRowGroupColors(inboxSheet) {
  const lastRow = inboxSheet.getLastRow();
  if (lastRow <= 1) return;

  const dataRows = lastRow - 1;

  // Time info columns
  inboxSheet.getRange(2, INBOX_COL.DATE, dataRows, 4).setBackground(GROUP_COLORS.TIME_INFO);

  // User mapping columns
  inboxSheet.getRange(2, INBOX_COL.TOGGL_USER, dataRows, 2).setBackground(GROUP_COLORS.USER_MAPPING);

  // Project mapping columns
  inboxSheet.getRange(2, INBOX_COL.TOGGL_CLIENT, dataRows, 4).setBackground(GROUP_COLORS.PROJECT_MAPPING);

  // Task mapping columns
  inboxSheet.getRange(2, INBOX_COL.TOGGL_TASK, dataRows, 2).setBackground(GROUP_COLORS.TASK_MAPPING);

  // Re-apply borders
  addGroupBorders(inboxSheet);
}

/**
 * Adds data validation dropdowns and checkboxes to Inbox sheet
 */
function wireInboxDropdowns() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox to wire.');
    return;
  }

  const dataRows = inboxSheet.getLastRow() - 1;

  // QBO Employee dropdown (column 6)
  wireInboxColumnDropdown(inboxSheet, INBOX_COL.QBO_EMPLOYEE, CONFIG.SHEETS.QBO_EMPLOYEES, dataRows);

  // QBO Customer dropdown (column 9)
  wireInboxColumnDropdown(inboxSheet, INBOX_COL.QBO_CUSTOMER, CONFIG.SHEETS.QBO_CUSTOMERS, dataRows);

  // QBO Project dropdown (column 10)
  wireInboxColumnDropdown(inboxSheet, INBOX_COL.QBO_PROJECT, CONFIG.SHEETS.QBO_PROJECTS, dataRows);

  // QBO Service Item dropdown (column 12)
  wireInboxColumnDropdown(inboxSheet, INBOX_COL.QBO_SERVICE_ITEM, CONFIG.SHEETS.QBO_ITEMS, dataRows);

  // Billable checkbox (column 14)
  const billableRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .build();
  inboxSheet.getRange(2, INBOX_COL.BILLABLE, dataRows, 1).setDataValidation(billableRule);

  // Approved dropdown with options (column 17)
  const approvalRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      APPROVAL_STATUS.PENDING,
      APPROVAL_STATUS.APPROVED,
      APPROVAL_STATUS.REJECTED,
      APPROVAL_STATUS.ON_HOLD
    ], true)
    .setAllowInvalid(false)
    .build();
  inboxSheet.getRange(2, INBOX_COL.APPROVED, dataRows, 1).setDataValidation(approvalRule);

  // Apply visual grouping and conditional formatting
  applyRowGroupColors(inboxSheet);
  applyInboxConditionalFormatting(inboxSheet);

  showToast('Inbox dropdowns wired successfully!');
}

/**
 * Wires a dropdown for a specific Inbox column
 * @param {Sheet} inboxSheet - Inbox sheet
 * @param {number} column - Column number (1-based)
 * @param {string} masterSheetName - Master sheet to pull values from
 * @param {number} dataRows - Number of data rows
 */
function wireInboxColumnDropdown(inboxSheet, column, masterSheetName, dataRows) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(masterSheetName);

  if (!masterSheet || masterSheet.getLastRow() <= 1) {
    return;
  }

  const masterRows = masterSheet.getLastRow() - 1;
  const range = masterSheet.getRange(2, 2, masterRows, 1); // Names are in column B

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();

  inboxSheet.getRange(2, column, dataRows, 1).setDataValidation(rule);
}

// ============================================================================
// VALIDATION DISPLAY
// ============================================================================

/**
 * Validates all Inbox entries and updates their status
 */
function validateInboxEntries() {
  showToast('Validating Inbox entries...');

  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox to validate.');
    return;
  }

  const mappings = buildMappingLookups();
  const lastRow = inboxSheet.getLastRow();
  const data = inboxSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMNS.INBOX.length).getValues();

  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    const errors = validateInboxRow(row, mappings);

    if (errors.length === 0) {
      inboxSheet.getRange(rowNum, INBOX_COL.STATUS).setValue('Ready');
      inboxSheet.getRange(rowNum, INBOX_COL.VALIDATION_ERRORS).setValue('');
      validCount++;
    } else {
      inboxSheet.getRange(rowNum, INBOX_COL.STATUS).setValue('Needs Review');
      inboxSheet.getRange(rowNum, INBOX_COL.VALIDATION_ERRORS).setValue(errors.join('; '));
      invalidCount++;
    }
  }

  // Apply conditional formatting
  applyInboxConditionalFormatting(inboxSheet);

  const message = `Validation complete: ${validCount} ready, ${invalidCount} need review`;
  showToast(message);
  logMessage(message, 'INFO');
}

/**
 * Validates a single Inbox row
 * @param {Array} row - Inbox row data (0-indexed)
 * @param {Object} mappings - Mapping lookups
 * @returns {string[]} Array of error messages
 */
function validateInboxRow(row, mappings) {
  const errors = [];

  // Get values using 0-indexed positions (subtract 1 from INBOX_COL constants)
  const togglUser = row[INBOX_COL.TOGGL_USER - 1];
  const qboEmployee = row[INBOX_COL.QBO_EMPLOYEE - 1];
  const togglClient = row[INBOX_COL.TOGGL_CLIENT - 1];
  const togglProject = row[INBOX_COL.TOGGL_PROJECT - 1];
  const qboCustomer = row[INBOX_COL.QBO_CUSTOMER - 1];
  const togglTask = row[INBOX_COL.TOGGL_TASK - 1];
  const qboServiceItem = row[INBOX_COL.QBO_SERVICE_ITEM - 1];
  const date = row[INBOX_COL.DATE - 1];
  const duration = row[INBOX_COL.DURATION - 1];

  // Check Employee mapping
  let hasEmployee = !!qboEmployee;
  if (!hasEmployee && togglUser) {
    const userMapping = findUserMappingByName(togglUser, mappings);
    hasEmployee = !!(userMapping && userMapping.qboEmployeeId);
  }
  if (!hasEmployee) {
    errors.push('No Employee mapping');
  }

  // Check Customer mapping
  let hasCustomer = !!qboCustomer;
  if (!hasCustomer && togglProject) {
    const projectMapping = findProjectMappingByName(togglProject, mappings);
    hasCustomer = !!(projectMapping && projectMapping.qboCustomerId);
  }
  if (!hasCustomer && togglClient) {
    const clientMapping = findClientMappingByName(togglClient, mappings);
    hasCustomer = !!(clientMapping && clientMapping.qboCustomerId);
  }
  if (!hasCustomer) {
    errors.push('No Customer mapping');
  }

  // Check Service Item mapping
  let hasServiceItem = !!qboServiceItem;
  if (!hasServiceItem && togglTask) {
    const taskMapping = findTaskMappingByName(togglTask, togglProject, mappings);
    hasServiceItem = !!(taskMapping && taskMapping.qboServiceItemId);
  }
  if (!hasServiceItem) {
    errors.push('No Service Item mapping');
  }

  // Check required fields
  if (!date) {
    errors.push('Missing date');
  }

  if (!duration) {
    errors.push('Invalid duration');
  }

  return errors;
}

/**
 * Applies conditional formatting to the Inbox sheet
 * @param {Sheet} inboxSheet - Inbox sheet
 */
function applyInboxConditionalFormatting(inboxSheet) {
  // Clear existing conditional formatting
  inboxSheet.clearConditionalFormatRules();

  const lastRow = inboxSheet.getLastRow();
  if (lastRow <= 1) return;

  const dataRows = lastRow - 1;
  const rules = [];

  // Status column formatting (column 16)
  const statusRange = inboxSheet.getRange(2, INBOX_COL.STATUS, dataRows, 1);

  // Ready = green background
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Ready')
    .setBackground('#b7e1cd')
    .setRanges([statusRange])
    .build());

  // Needs Review = yellow background
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Needs Review')
    .setBackground('#fce8b2')
    .setRanges([statusRange])
    .build());

  // Approved column formatting (column 17)
  const approvedRange = inboxSheet.getRange(2, INBOX_COL.APPROVED, dataRows, 1);

  // Approved = green
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(APPROVAL_STATUS.APPROVED)
    .setBackground('#b7e1cd')
    .setFontColor('#0d652d')
    .setRanges([approvedRange])
    .build());

  // Pending = light gray
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(APPROVAL_STATUS.PENDING)
    .setBackground('#f3f3f3')
    .setFontColor('#666666')
    .setRanges([approvedRange])
    .build());

  // Rejected = red
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(APPROVAL_STATUS.REJECTED)
    .setBackground('#f4c7c3')
    .setFontColor('#a94442')
    .setRanges([approvedRange])
    .build());

  // On Hold = orange
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(APPROVAL_STATUS.ON_HOLD)
    .setBackground('#fce8b2')
    .setFontColor('#8a6d3b')
    .setRanges([approvedRange])
    .build());

  // Validation Errors column - red if not empty (column 19)
  const errorsRange = inboxSheet.getRange(2, INBOX_COL.VALIDATION_ERRORS, dataRows, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('mapping')
    .setBackground('#f4c7c3')
    .setRanges([errorsRange])
    .build());

  inboxSheet.setConditionalFormatRules(rules);
}

// ============================================================================
// AUTO-POPULATE FROM MAPPINGS
// ============================================================================

/**
 * Auto-populates QBO columns in Inbox based on existing mappings
 */
function autoPopulateInboxMappings() {
  showToast('Auto-populating Inbox mappings...');

  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox.');
    return;
  }

  const mappings = buildMappingLookups();
  const lastRow = inboxSheet.getLastRow();
  const data = inboxSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMNS.INBOX.length).getValues();

  let updatedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    let updated = false;

    // Auto-populate Employee
    const togglUser = row[INBOX_COL.TOGGL_USER - 1];
    const qboEmployee = row[INBOX_COL.QBO_EMPLOYEE - 1];
    if (!qboEmployee && togglUser) {
      const userMapping = findUserMappingByName(togglUser, mappings);
      if (userMapping && userMapping.qboEmployeeName) {
        inboxSheet.getRange(rowNum, INBOX_COL.QBO_EMPLOYEE).setValue(userMapping.qboEmployeeName);
        updated = true;
      }
    }

    // Auto-populate Customer from Project mapping
    const togglProject = row[INBOX_COL.TOGGL_PROJECT - 1];
    const qboCustomer = row[INBOX_COL.QBO_CUSTOMER - 1];
    if (!qboCustomer && togglProject) {
      const projectMapping = findProjectMappingByName(togglProject, mappings);
      if (projectMapping && projectMapping.qboCustomerName) {
        inboxSheet.getRange(rowNum, INBOX_COL.QBO_CUSTOMER).setValue(projectMapping.qboCustomerName);
        if (projectMapping.qboProjectName) {
          inboxSheet.getRange(rowNum, INBOX_COL.QBO_PROJECT).setValue(projectMapping.qboProjectName);
        }
        updated = true;
      }
    }

    // Auto-populate Customer from Client mapping
    const togglClient = row[INBOX_COL.TOGGL_CLIENT - 1];
    if (!qboCustomer && !togglProject && togglClient) {
      const clientMapping = findClientMappingByName(togglClient, mappings);
      if (clientMapping && clientMapping.qboCustomerName) {
        inboxSheet.getRange(rowNum, INBOX_COL.QBO_CUSTOMER).setValue(clientMapping.qboCustomerName);
        updated = true;
      }
    }

    // Auto-populate Service Item from Task mapping
    const togglTask = row[INBOX_COL.TOGGL_TASK - 1];
    const qboServiceItem = row[INBOX_COL.QBO_SERVICE_ITEM - 1];
    if (!qboServiceItem && togglTask) {
      const taskMapping = findTaskMappingByName(togglTask, togglProject, mappings);
      if (taskMapping && taskMapping.qboServiceItemName) {
        inboxSheet.getRange(rowNum, INBOX_COL.QBO_SERVICE_ITEM).setValue(taskMapping.qboServiceItemName);
        updated = true;
      }
    }

    if (updated) {
      updatedCount++;
    }
  }

  // Re-validate after auto-population
  validateInboxEntries();

  showToast(`Auto-populated ${updatedCount} entries.`);
}

// ============================================================================
// INBOX STATISTICS
// ============================================================================

/**
 * Shows statistics about the current Inbox
 */
function showInboxStats() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showAlert('Inbox is empty.', 'Inbox Statistics');
    return;
  }

  const lastRow = inboxSheet.getLastRow();
  const data = inboxSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMNS.INBOX.length).getValues();

  const stats = {
    total: data.length,
    ready: 0,
    needsReview: 0,
    approved: 0,
    rejected: 0,
    onHold: 0,
    totalMinutes: 0,
    billableMinutes: 0,
    uniqueUsers: new Set(),
    uniqueProjects: new Set(),
    dateRange: { min: null, max: null }
  };

  data.forEach(row => {
    // Status
    const status = row[INBOX_COL.STATUS - 1];
    if (status === 'Ready') stats.ready++;
    if (status === 'Needs Review') stats.needsReview++;

    // Approval status
    const approval = row[INBOX_COL.APPROVED - 1];
    if (approval === APPROVAL_STATUS.APPROVED) stats.approved++;
    if (approval === APPROVAL_STATUS.REJECTED) stats.rejected++;
    if (approval === APPROVAL_STATUS.ON_HOLD) stats.onHold++;

    // Duration (h:mm format)
    const duration = row[INBOX_COL.DURATION - 1];
    if (duration) {
      const seconds = parseDuration(duration);
      stats.totalMinutes += seconds / 60;
      if (row[INBOX_COL.BILLABLE - 1]) {
        stats.billableMinutes += seconds / 60;
      }
    }

    // Unique users/projects
    if (row[INBOX_COL.TOGGL_USER - 1]) stats.uniqueUsers.add(row[INBOX_COL.TOGGL_USER - 1]);
    if (row[INBOX_COL.TOGGL_PROJECT - 1]) stats.uniqueProjects.add(row[INBOX_COL.TOGGL_PROJECT - 1]);

    // Date range
    const date = row[INBOX_COL.DATE - 1];
    if (date) {
      if (!stats.dateRange.min || date < stats.dateRange.min) stats.dateRange.min = date;
      if (!stats.dateRange.max || date > stats.dateRange.max) stats.dateRange.max = date;
    }
  });

  const totalHours = Math.floor(stats.totalMinutes / 60);
  const totalMins = Math.round(stats.totalMinutes % 60);
  const billableHours = Math.floor(stats.billableMinutes / 60);
  const billableMins = Math.round(stats.billableMinutes % 60);

  const message = `Inbox Statistics

Total Entries: ${stats.total}
Ready to Sync: ${stats.ready}
Needs Review: ${stats.needsReview}

Approval Status:
  Approved: ${stats.approved}
  Rejected: ${stats.rejected}
  On Hold: ${stats.onHold}
  Pending: ${stats.total - stats.approved - stats.rejected - stats.onHold}

Total Time: ${totalHours}:${totalMins.toString().padStart(2, '0')}
Billable Time: ${billableHours}:${billableMins.toString().padStart(2, '0')}

Unique Users: ${stats.uniqueUsers.size}
Unique Projects: ${stats.uniqueProjects.size}

Date Range: ${formatDate(stats.dateRange.min)} to ${formatDate(stats.dateRange.max)}`;

  showAlert(message, 'Inbox Statistics');
}

// ============================================================================
// INBOX FILTERING
// ============================================================================

/**
 * Creates a filter view for the Inbox sheet
 */
function createInboxFilter() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox.');
    return;
  }

  // Remove existing filter
  const existingFilter = inboxSheet.getFilter();
  if (existingFilter) {
    existingFilter.remove();
  }

  // Create new filter
  const range = inboxSheet.getDataRange();
  range.createFilter();

  showToast('Filter created. Use column headers to filter data.');
}

/**
 * Shows only entries that need review
 */
function filterNeedsReview() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet) return;

  let filter = inboxSheet.getFilter();
  if (!filter) {
    const range = inboxSheet.getDataRange();
    filter = range.createFilter();
  }

  // Filter Status column for "Needs Review"
  const criteria = SpreadsheetApp.newFilterCriteria()
    .whenTextEqualTo('Needs Review')
    .build();
  filter.setColumnFilterCriteria(INBOX_COL.STATUS, criteria);

  showToast('Showing entries that need review.');
}

/**
 * Clears all filters on the Inbox sheet
 */
function clearInboxFilters() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet) return;

  const filter = inboxSheet.getFilter();
  if (filter) {
    filter.remove();
  }

  showToast('Filters cleared.');
}

/**
 * Refreshes the Inbox formatting (visual groups, borders, conditional formatting)
 */
function refreshInboxFormatting() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet) {
    showToast('Inbox sheet not found.');
    return;
  }

  formatInboxHeaders(inboxSheet);
  setInboxColumnWidths(inboxSheet);

  if (inboxSheet.getLastRow() > 1) {
    applyRowGroupColors(inboxSheet);
    applyInboxConditionalFormatting(inboxSheet);
  }

  showToast('Inbox formatting refreshed.');
}
