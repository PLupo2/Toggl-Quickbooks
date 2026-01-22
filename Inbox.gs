/**
 * Inbox.gs - Inbox sheet builder and management
 * Handles Inbox sheet setup, validation display, and approval workflow
 */

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

  // Format headers
  const headerRange = inboxSheet.getRange(1, 1, 1, CONFIG.COLUMNS.INBOX.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setWrap(true);

  // Freeze header row
  inboxSheet.setFrozenRows(1);

  // Set column widths
  const columnWidths = {
    1: 120,   // Toggl Entry ID
    2: 150,   // Toggl User
    3: 150,   // QBO Employee
    4: 150,   // Toggl Client
    5: 180,   // Toggl Project
    6: 150,   // QBO Customer
    7: 150,   // QBO Project
    8: 180,   // Toggl Task
    9: 150,   // QBO Service Item
    10: 250,  // Description
    11: 100,  // Date
    12: 100,  // Duration (hrs)
    13: 80,   // Billable
    14: 150,  // Start Time
    15: 150,  // Stop Time
    16: 150,  // Tags
    17: 120,  // Status
    18: 200,  // Validation Errors
    19: 80,   // Approved
    20: 150,  // Imported At
    21: 200   // Notes
  };

  Object.entries(columnWidths).forEach(([col, width]) => {
    inboxSheet.setColumnWidth(parseInt(col, 10), width);
  });

  logMessage('Inbox sheet setup complete', 'INFO');
}

/**
 * Adds data validation dropdowns to Inbox sheet for QBO mappings
 */
function wireInboxDropdowns() {
  const ss = getSpreadsheet();
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);

  if (!inboxSheet || inboxSheet.getLastRow() <= 1) {
    showToast('No entries in Inbox to wire.');
    return;
  }

  const dataRows = inboxSheet.getLastRow() - 1;

  // Employee dropdown (column 3)
  wireInboxColumnDropdown(inboxSheet, 3, CONFIG.SHEETS.QBO_EMPLOYEES, dataRows);

  // Customer dropdown (column 6)
  wireInboxColumnDropdown(inboxSheet, 6, CONFIG.SHEETS.QBO_CUSTOMERS, dataRows);

  // Project dropdown (column 7)
  wireInboxColumnDropdown(inboxSheet, 7, CONFIG.SHEETS.QBO_PROJECTS, dataRows);

  // Service Item dropdown (column 9)
  wireInboxColumnDropdown(inboxSheet, 9, CONFIG.SHEETS.QBO_ITEMS, dataRows);

  // Approved checkbox (column 19) - boolean
  const approvedRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .build();
  inboxSheet.getRange(2, 19, dataRows, 1).setDataValidation(approvedRule);

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
      inboxSheet.getRange(rowNum, 17).setValue('Ready');
      inboxSheet.getRange(rowNum, 18).setValue('');
      validCount++;
    } else {
      inboxSheet.getRange(rowNum, 17).setValue('Needs Review');
      inboxSheet.getRange(rowNum, 18).setValue(errors.join('; '));
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
 * @param {Array} row - Inbox row data
 * @param {Object} mappings - Mapping lookups
 * @returns {string[]} Array of error messages
 */
function validateInboxRow(row, mappings) {
  const errors = [];

  const togglUser = row[1];
  const qboEmployee = row[2];
  const togglClient = row[3];
  const togglProject = row[4];
  const qboCustomer = row[5];
  const togglTask = row[7];
  const qboServiceItem = row[8];
  const date = row[10];
  const duration = row[11];

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

  if (!duration || duration <= 0) {
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

  const rules = [];

  // Status column formatting
  const statusRange = inboxSheet.getRange(2, 17, lastRow - 1, 1);

  // Ready = green background
  const readyRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Ready')
    .setBackground('#b7e1cd')
    .setRanges([statusRange])
    .build();
  rules.push(readyRule);

  // Needs Review = yellow background
  const reviewRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Needs Review')
    .setBackground('#fce8b2')
    .setRanges([statusRange])
    .build();
  rules.push(reviewRule);

  // Validation Errors column - red if not empty
  const errorsRange = inboxSheet.getRange(2, 18, lastRow - 1, 1);
  const errorsRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains(';')
    .setBackground('#f4c7c3')
    .setRanges([errorsRange])
    .build();
  rules.push(errorsRule);

  // Approved column - highlight approved rows
  const approvedRange = inboxSheet.getRange(2, 19, lastRow - 1, 1);
  const approvedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('TRUE')
    .setBackground('#c9daf8')
    .setRanges([approvedRange])
    .build();
  rules.push(approvedRule);

  inboxSheet.setConditionalFormatRules(rules);
}

// ============================================================================
// AUTO-POPULATE FROM MAPPINGS
// ============================================================================

/**
 * Auto-populates QBO columns in Inbox based on existing mappings
 * Useful for entries that have mappings but weren't populated on import
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
    if (!row[2] && row[1]) { // No QBO Employee but has Toggl User
      const userMapping = findUserMappingByName(row[1], mappings);
      if (userMapping && userMapping.qboEmployeeName) {
        inboxSheet.getRange(rowNum, 3).setValue(userMapping.qboEmployeeName);
        updated = true;
      }
    }

    // Auto-populate Customer from Project mapping
    if (!row[5] && row[4]) { // No QBO Customer but has Toggl Project
      const projectMapping = findProjectMappingByName(row[4], mappings);
      if (projectMapping && projectMapping.qboCustomerName) {
        inboxSheet.getRange(rowNum, 6).setValue(projectMapping.qboCustomerName);
        if (projectMapping.qboProjectName) {
          inboxSheet.getRange(rowNum, 7).setValue(projectMapping.qboProjectName);
        }
        updated = true;
      }
    }

    // Auto-populate Customer from Client mapping
    if (!row[5] && !row[4] && row[3]) { // No QBO Customer, no Toggl Project, has Toggl Client
      const clientMapping = findClientMappingByName(row[3], mappings);
      if (clientMapping && clientMapping.qboCustomerName) {
        inboxSheet.getRange(rowNum, 6).setValue(clientMapping.qboCustomerName);
        updated = true;
      }
    }

    // Auto-populate Service Item from Task mapping
    if (!row[8] && row[7]) { // No QBO Service Item but has Toggl Task
      const taskMapping = findTaskMappingByName(row[7], row[4], mappings);
      if (taskMapping && taskMapping.qboServiceItemName) {
        inboxSheet.getRange(rowNum, 9).setValue(taskMapping.qboServiceItemName);
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
    totalHours: 0,
    billableHours: 0,
    uniqueUsers: new Set(),
    uniqueProjects: new Set(),
    dateRange: { min: null, max: null }
  };

  data.forEach(row => {
    // Status
    if (row[16] === 'Ready') stats.ready++;
    if (row[16] === 'Needs Review') stats.needsReview++;

    // Approved
    if (row[18]) stats.approved++;

    // Hours
    const hours = parseFloat(row[11]) || 0;
    stats.totalHours += hours;
    if (row[12]) stats.billableHours += hours;

    // Unique users/projects
    if (row[1]) stats.uniqueUsers.add(row[1]);
    if (row[4]) stats.uniqueProjects.add(row[4]);

    // Date range
    const date = row[10];
    if (date) {
      if (!stats.dateRange.min || date < stats.dateRange.min) stats.dateRange.min = date;
      if (!stats.dateRange.max || date > stats.dateRange.max) stats.dateRange.max = date;
    }
  });

  const message = `Inbox Statistics

Total Entries: ${stats.total}
Ready to Sync: ${stats.ready}
Needs Review: ${stats.needsReview}
Approved: ${stats.approved}

Total Hours: ${stats.totalHours.toFixed(2)}
Billable Hours: ${stats.billableHours.toFixed(2)}

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

  // Filter Status column (17) for "Needs Review"
  const criteria = SpreadsheetApp.newFilterCriteria()
    .whenTextEqualTo('Needs Review')
    .build();
  filter.setColumnFilterCriteria(17, criteria);

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
