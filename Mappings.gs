/**
 * Mappings.gs - Mapping sheet management and smart refresh
 * Handles Toggl ↔ QBO entity mappings with deduplication and auto-matching
 */

// ============================================================================
// MASTER LIST REFRESH (QBO)
// ============================================================================

/**
 * Refreshes all QBO master lists
 */
function refreshQBOMasterLists() {
  showToast('Refreshing QuickBooks master lists...');

  try {
    refreshQBOCustomersMaster();
    refreshQBOEmployeesMaster();
    refreshQBOServiceItemsMaster();
    refreshQBOProjectsMaster();

    showToast('QuickBooks master lists refreshed successfully!');
  } catch (error) {
    showAlert(`Failed to refresh QBO master lists: ${error.message}`, 'Error');
    logMessage(`QBO master refresh error: ${error.message}`, 'ERROR');
  }
}

/**
 * Refreshes QBO Customers master list
 */
function refreshQBOCustomersMaster() {
  logMessage('Refreshing QBO Customers master...', 'INFO');

  const customers = getCustomersForMasterList();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QBO_CUSTOMERS, CONFIG.COLUMNS.QBO_CUSTOMERS);

  // Clear existing data (keep headers)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clear();
  }

  // Write new data
  if (customers.length > 0) {
    sheet.getRange(2, 1, customers.length, 2).setValues(customers);
  }

  logMessage(`Updated ${customers.length} customers in master list`, 'INFO');
}

/**
 * Refreshes QBO Employees master list
 */
function refreshQBOEmployeesMaster() {
  logMessage('Refreshing QBO Employees master...', 'INFO');

  const employees = getEmployeesForMasterList();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QBO_EMPLOYEES, CONFIG.COLUMNS.QBO_EMPLOYEES);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clear();
  }

  if (employees.length > 0) {
    sheet.getRange(2, 1, employees.length, 2).setValues(employees);
  }

  logMessage(`Updated ${employees.length} employees in master list`, 'INFO');
}

/**
 * Refreshes QBO Service Items master list
 */
function refreshQBOServiceItemsMaster() {
  logMessage('Refreshing QBO Service Items master...', 'INFO');

  const items = getServiceItemsForMasterList();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QBO_ITEMS, CONFIG.COLUMNS.QBO_ITEMS);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clear();
  }

  if (items.length > 0) {
    sheet.getRange(2, 1, items.length, 2).setValues(items);
  }

  logMessage(`Updated ${items.length} service items in master list`, 'INFO');
}

/**
 * Refreshes QBO Projects master list
 */
function refreshQBOProjectsMaster() {
  logMessage('Refreshing QBO Projects master...', 'INFO');

  const projects = getProjectsForMasterList();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QBO_PROJECTS, CONFIG.COLUMNS.QBO_PROJECTS);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clear();
  }

  if (projects.length > 0) {
    sheet.getRange(2, 1, projects.length, 2).setValues(projects);
  }

  logMessage(`Updated ${projects.length} projects in master list`, 'INFO');
}

// ============================================================================
// TOGGL MAPPINGS REFRESH
// ============================================================================

/**
 * Refreshes all Toggl mapping sheets (smart update - no duplicates, preserve existing)
 */
function refreshTogglMappings() {
  showToast('Refreshing Toggl mappings...');

  try {
    refreshUserMappings();
    refreshClientMappings();
    refreshProjectMappings();
    refreshTaskMappings();

    showToast('Toggl mappings refreshed successfully!');
  } catch (error) {
    showAlert(`Failed to refresh Toggl mappings: ${error.message}`, 'Error');
    logMessage(`Toggl mappings refresh error: ${error.message}`, 'ERROR');
  }
}

/**
 * Smart refresh of User mappings
 * Adds new users without losing existing mapping data
 */
function refreshUserMappings() {
  logMessage('Refreshing User mappings...', 'INFO');

  const users = getUsersForMapping();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_USERS, CONFIG.COLUMNS.MAPPINGS_USERS);

  // Get existing mappings
  const existing = getExistingMappings(sheet, 0); // Key on Toggl User ID (column 0)

  // Process users
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  for (const [userId, userName, email] of users) {
    if (existing.has(String(userId))) {
      continue; // Skip existing
    }

    // Try auto-match with QBO employees
    const autoMatch = tryAutoMatchEmployee(userName, email);

    newRows.push([
      userId,
      userName,
      email,
      autoMatch?.id || '',
      autoMatch?.name || '',
      autoMatch ? 'Yes' : '',
      timestamp
    ]);
  }

  // Append new rows
  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    logMessage(`Added ${newRows.length} new user mappings`, 'INFO');
  } else {
    logMessage('No new users to add', 'INFO');
  }
}

/**
 * Smart refresh of Client mappings
 */
function refreshClientMappings() {
  logMessage('Refreshing Client mappings...', 'INFO');

  const clients = getClientsForMapping();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, CONFIG.COLUMNS.MAPPINGS_CLIENTS);

  const existing = getExistingMappings(sheet, 0);
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  for (const [clientId, clientName] of clients) {
    if (existing.has(String(clientId))) {
      continue;
    }

    // Try auto-match with QBO customers
    const autoMatch = tryAutoMatchCustomer(clientName);

    newRows.push([
      clientId,
      clientName,
      autoMatch?.id || '',
      autoMatch?.name || '',
      autoMatch ? 'Yes' : '',
      timestamp
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    logMessage(`Added ${newRows.length} new client mappings`, 'INFO');
  }
}

/**
 * Smart refresh of Project mappings
 */
function refreshProjectMappings() {
  logMessage('Refreshing Project mappings...', 'INFO');

  const projects = getProjectsForMapping();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_PROJECTS, CONFIG.COLUMNS.MAPPINGS_PROJECTS);

  const existing = getExistingMappings(sheet, 0);
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  for (const [projectId, projectName, clientName] of projects) {
    if (existing.has(String(projectId))) {
      continue;
    }

    newRows.push([
      projectId,
      projectName,
      clientName,
      '', // QBO Customer ID
      '', // QBO Customer Name
      '', // QBO Project ID
      '', // QBO Project Name
      timestamp
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    logMessage(`Added ${newRows.length} new project mappings`, 'INFO');
  }
}

/**
 * Smart refresh of Task mappings
 * Only includes tasks from active projects
 */
function refreshTaskMappings() {
  logMessage('Refreshing Task mappings...', 'INFO');

  const tasks = getTasksForMapping();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_TASKS, CONFIG.COLUMNS.MAPPINGS_TASKS);

  const existing = getExistingMappings(sheet, 0);
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  for (const [taskId, taskName, projectName, clientName] of tasks) {
    if (existing.has(String(taskId))) {
      continue;
    }

    // Try auto-match with QBO service items
    const autoMatch = tryAutoMatchServiceItem(taskName);

    newRows.push([
      taskId,
      taskName,
      projectName,
      clientName,
      autoMatch?.id || '',
      autoMatch?.name || '',
      autoMatch ? 'Yes' : '',
      timestamp
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    logMessage(`Added ${newRows.length} new task mappings`, 'INFO');
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets existing mapping IDs from a sheet
 * @param {Sheet} sheet - Sheet to read
 * @param {number} keyColumn - Column index for the key (0-based)
 * @returns {Set} Set of existing keys
 */
function getExistingMappings(sheet, keyColumn) {
  const existing = new Set();

  if (sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    data.forEach(row => {
      if (row[keyColumn]) {
        existing.add(String(row[keyColumn]));
      }
    });
  }

  return existing;
}

/**
 * Tries to auto-match a Toggl user with a QBO employee
 * @param {string} userName - Toggl user name
 * @param {string} email - Toggl user email
 * @returns {Object|null} Match with id and name, or null
 */
function tryAutoMatchEmployee(userName, email) {
  const ss = getSpreadsheet();
  const employeesSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_EMPLOYEES);

  if (!employeesSheet || employeesSheet.getLastRow() <= 1) {
    return null;
  }

  const employees = employeesSheet.getRange(2, 1, employeesSheet.getLastRow() - 1, 2).getValues();

  // Normalize for comparison
  const normalizedUserName = (userName || '').toLowerCase().trim();
  const normalizedEmail = (email || '').toLowerCase().trim();

  for (const [id, name] of employees) {
    const normalizedName = (name || '').toLowerCase().trim();

    // Exact name match
    if (normalizedName === normalizedUserName) {
      return { id, name };
    }

    // Check if employee name contains user's first name
    const firstName = normalizedUserName.split(' ')[0];
    if (firstName.length > 2 && normalizedName.includes(firstName)) {
      return { id, name };
    }
  }

  return null;
}

/**
 * Tries to auto-match a Toggl client with a QBO customer
 * @param {string} clientName - Toggl client name
 * @returns {Object|null} Match with id and name, or null
 */
function tryAutoMatchCustomer(clientName) {
  const ss = getSpreadsheet();
  const customersSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);

  if (!customersSheet || customersSheet.getLastRow() <= 1) {
    return null;
  }

  const customers = customersSheet.getRange(2, 1, customersSheet.getLastRow() - 1, 2).getValues();

  const normalizedClientName = (clientName || '').toLowerCase().trim();

  for (const [id, name] of customers) {
    const normalizedName = (name || '').toLowerCase().trim();

    // Exact match or close match
    if (normalizedName === normalizedClientName ||
        normalizedName.includes(normalizedClientName) ||
        normalizedClientName.includes(normalizedName)) {
      return { id, name };
    }
  }

  return null;
}

/**
 * Tries to auto-match a Toggl task with a QBO service item
 * @param {string} taskName - Toggl task name
 * @returns {Object|null} Match with id and name, or null
 */
function tryAutoMatchServiceItem(taskName) {
  const ss = getSpreadsheet();
  const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_ITEMS);

  if (!itemsSheet || itemsSheet.getLastRow() <= 1) {
    return null;
  }

  const items = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 2).getValues();

  const normalizedTaskName = (taskName || '').toLowerCase().trim();

  for (const [id, name] of items) {
    const normalizedName = (name || '').toLowerCase().trim();

    // Exact match
    if (normalizedName === normalizedTaskName) {
      return { id, name };
    }

    // Partial match (task name contains service item name or vice versa)
    if (normalizedTaskName.includes(normalizedName) ||
        normalizedName.includes(normalizedTaskName)) {
      return { id, name };
    }
  }

  return null;
}

// ============================================================================
// DROPDOWN WIRING
// ============================================================================

/**
 * Wires dropdown data validation to all mapping sheets
 */
function wireAllDropdowns() {
  showToast('Wiring dropdowns to mapping sheets...');

  try {
    wireUserMappingDropdowns();
    wireClientMappingDropdowns();
    wireProjectMappingDropdowns();
    wireTaskMappingDropdowns();

    showToast('Dropdowns wired successfully!');
  } catch (error) {
    showAlert(`Failed to wire dropdowns: ${error.message}`, 'Error');
    logMessage(`Dropdown wiring error: ${error.message}`, 'ERROR');
  }
}

/**
 * Wires dropdowns for User mappings
 */
function wireUserMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_USERS);
  const employeesSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_EMPLOYEES);

  if (!sheet || !employeesSheet) return;

  const dataRows = sheet.getLastRow() - 1;
  if (dataRows < 1) return;

  // Create dropdown from QBO Employee names (column B of master)
  const employeeCount = employeesSheet.getLastRow() - 1;
  if (employeeCount < 1) return;

  const range = employeesSheet.getRange(2, 2, employeeCount, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();

  // Apply to QBO Employee Name column (E)
  sheet.getRange(2, 5, dataRows, 1).setDataValidation(rule);

  // Add formula to auto-fill QBO Employee ID (column D) based on name selection
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const formula = `=IF(E${row}="","",VLOOKUP(E${row},'${CONFIG.SHEETS.QBO_EMPLOYEES}'!B:A,2,FALSE))`;
    sheet.getRange(row, 4).setFormula(formula);
  }
}

/**
 * Wires dropdowns for Client mappings
 */
function wireClientMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_CLIENTS);
  const customersSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);

  if (!sheet || !customersSheet) return;

  const dataRows = sheet.getLastRow() - 1;
  if (dataRows < 1) return;

  const customerCount = customersSheet.getLastRow() - 1;
  if (customerCount < 1) return;

  const range = customersSheet.getRange(2, 2, customerCount, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();

  // Apply to QBO Customer Name column (D)
  sheet.getRange(2, 4, dataRows, 1).setDataValidation(rule);

  // Add formula for QBO Customer ID (column C)
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const formula = `=IF(D${row}="","",VLOOKUP(D${row},'${CONFIG.SHEETS.QBO_CUSTOMERS}'!B:A,2,FALSE))`;
    sheet.getRange(row, 3).setFormula(formula);
  }
}

/**
 * Wires dropdowns for Project mappings
 */
function wireProjectMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  const customersSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_PROJECTS);

  if (!sheet || !customersSheet) return;

  const dataRows = sheet.getLastRow() - 1;
  if (dataRows < 1) return;

  // Customer dropdown
  const customerCount = customersSheet.getLastRow() - 1;
  if (customerCount >= 1) {
    const customerRange = customersSheet.getRange(2, 2, customerCount, 1);
    const customerRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(customerRange, true)
      .setAllowInvalid(true)
      .build();

    // QBO Customer Name column (E)
    sheet.getRange(2, 5, dataRows, 1).setDataValidation(customerRule);

    // Formula for Customer ID (column D)
    for (let row = 2; row <= sheet.getLastRow(); row++) {
      const formula = `=IF(E${row}="","",VLOOKUP(E${row},'${CONFIG.SHEETS.QBO_CUSTOMERS}'!B:A,2,FALSE))`;
      sheet.getRange(row, 4).setFormula(formula);
    }
  }

  // Project dropdown (if projects exist)
  if (projectsSheet && projectsSheet.getLastRow() > 1) {
    const projectCount = projectsSheet.getLastRow() - 1;
    const projectRange = projectsSheet.getRange(2, 2, projectCount, 1);
    const projectRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(projectRange, true)
      .setAllowInvalid(true)
      .build();

    // QBO Project Name column (G)
    sheet.getRange(2, 7, dataRows, 1).setDataValidation(projectRule);

    // Formula for Project ID (column F)
    for (let row = 2; row <= sheet.getLastRow(); row++) {
      const formula = `=IF(G${row}="","",VLOOKUP(G${row},'${CONFIG.SHEETS.QBO_PROJECTS}'!B:A,2,FALSE))`;
      sheet.getRange(row, 6).setFormula(formula);
    }
  }
}

/**
 * Wires dropdowns for Task/Service mappings
 */
function wireTaskMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);
  const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_ITEMS);

  if (!sheet || !itemsSheet) return;

  const dataRows = sheet.getLastRow() - 1;
  if (dataRows < 1) return;

  const itemCount = itemsSheet.getLastRow() - 1;
  if (itemCount < 1) return;

  const range = itemsSheet.getRange(2, 2, itemCount, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();

  // QBO Service Item Name column (F)
  sheet.getRange(2, 6, dataRows, 1).setDataValidation(rule);

  // Formula for Service Item ID (column E)
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const formula = `=IF(F${row}="","",VLOOKUP(F${row},'${CONFIG.SHEETS.QBO_ITEMS}'!B:A,2,FALSE))`;
    sheet.getRange(row, 5).setFormula(formula);
  }
}

// ============================================================================
// MAPPING LOOKUP FUNCTIONS
// ============================================================================

/**
 * Builds complete mapping lookup tables from all mapping sheets
 * @returns {Object} Mappings object with users, clients, projects, tasks
 */
function buildMappingLookups() {
  const ss = getSpreadsheet();
  const mappings = {
    users: {},      // togglUserId -> { qboEmployeeId, qboEmployeeName }
    clients: {},    // togglClientId -> { qboCustomerId, qboCustomerName }
    projects: {},   // togglProjectId -> { qboCustomerId, qboCustomerName, qboProjectId, qboProjectName }
    tasks: {}       // togglTaskId -> { qboServiceItemId, qboServiceItemName }
  };

  // User mappings
  const usersSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_USERS);
  if (usersSheet && usersSheet.getLastRow() > 1) {
    const data = usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, 5).getValues();
    data.forEach(row => {
      if (row[0] && row[3]) { // Has Toggl ID and QBO Employee ID
        mappings.users[String(row[0])] = {
          qboEmployeeId: String(row[3]),
          qboEmployeeName: row[4] || ''
        };
      }
    });
  }

  // Client mappings
  const clientsSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_CLIENTS);
  if (clientsSheet && clientsSheet.getLastRow() > 1) {
    const data = clientsSheet.getRange(2, 1, clientsSheet.getLastRow() - 1, 4).getValues();
    data.forEach(row => {
      if (row[0] && row[2]) { // Has Toggl ID and QBO Customer ID
        mappings.clients[String(row[0])] = {
          qboCustomerId: String(row[2]),
          qboCustomerName: row[3] || ''
        };
      }
    });
  }

  // Project mappings
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  if (projectsSheet && projectsSheet.getLastRow() > 1) {
    const data = projectsSheet.getRange(2, 1, projectsSheet.getLastRow() - 1, 7).getValues();
    data.forEach(row => {
      if (row[0]) { // Has Toggl Project ID
        mappings.projects[String(row[0])] = {
          qboCustomerId: row[3] ? String(row[3]) : '',
          qboCustomerName: row[4] || '',
          qboProjectId: row[5] ? String(row[5]) : '',
          qboProjectName: row[6] || ''
        };
      }
    });
  }

  // Task mappings
  const tasksSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);
  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    const data = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, 6).getValues();
    data.forEach(row => {
      if (row[0] && row[4]) { // Has Toggl ID and QBO Service Item ID
        mappings.tasks[String(row[0])] = {
          qboServiceItemId: String(row[4]),
          qboServiceItemName: row[5] || ''
        };
      }
    });
  }

  return mappings;
}

/**
 * Resolves QBO mappings for a time entry
 * @param {Object} entry - Inbox entry row data
 * @param {Object} mappings - Mapping lookups
 * @returns {Object} Resolved mappings with validation errors
 */
function resolveMappingsForEntry(entry, mappings) {
  const result = {
    qboEmployeeId: '',
    qboEmployeeName: '',
    qboCustomerId: '',
    qboCustomerName: '',
    qboProjectId: '',
    qboProjectName: '',
    qboServiceItemId: '',
    qboServiceItemName: '',
    errors: []
  };

  // This function expects entry to have togglUserId, togglProjectId, togglTaskId
  // These need to be looked up from the Inbox or stored separately

  // For now, we use name-based lookups from the Inbox data
  // In practice, we'd need to store IDs or do reverse lookups

  return result;
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

/**
 * Removes orphaned mappings (Toggl entities that no longer exist)
 * Call manually when needed - doesn't run automatically to preserve manual mappings
 */
function cleanupOrphanedMappings() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Cleanup Orphaned Mappings',
    'This will remove mappings for Toggl entities that no longer exist (archived projects, etc.).\n\nThis cannot be undone. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  showToast('Cleaning up orphaned mappings...');

  try {
    // Get current Toggl entity IDs
    const currentUsers = new Set(getUsersForMapping().map(u => String(u[0])));
    const currentClients = new Set(getClientsForMapping().map(c => String(c[0])));
    const currentProjects = new Set(getProjectsForMapping().map(p => String(p[0])));
    const currentTasks = new Set(getTasksForMapping().map(t => String(t[0])));

    let totalRemoved = 0;

    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_USERS, currentUsers, 0);
    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, currentClients, 0);
    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_PROJECTS, currentProjects, 0);
    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_TASKS, currentTasks, 0);

    showAlert(`Cleanup complete. Removed ${totalRemoved} orphaned mappings.`, 'Cleanup Complete');
  } catch (error) {
    showAlert(`Cleanup failed: ${error.message}`, 'Error');
  }
}

/**
 * Removes rows from a sheet where the key column value is not in the valid set
 * @param {string} sheetName - Sheet name
 * @param {Set} validIds - Set of valid IDs
 * @param {number} keyColumn - Column index for the key (0-based)
 * @returns {number} Number of rows removed
 */
function cleanupSheet(sheetName, validIds, keyColumn) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() <= 1) {
    return 0;
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const rowsToDelete = [];

  for (let i = 0; i < data.length; i++) {
    const id = String(data[i][keyColumn]);
    if (id && !validIds.has(id)) {
      rowsToDelete.push(i + 2); // +2 for header and 0-indexing
    }
  }

  // Delete from bottom to top to preserve row indices
  rowsToDelete.reverse().forEach(rowNum => {
    sheet.deleteRow(rowNum);
  });

  return rowsToDelete.length;
}
