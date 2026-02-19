/**
 * Mappings.gs - Mapping sheet management and smart refresh
 * Handles Toggl ↔ QBO entity mappings with deduplication and auto-matching
 */

// ============================================================================
// MASTER LIST REFRESH (QBO)
// ============================================================================

/**
 * Refreshes all QBO master lists
 * Also rewires dropdowns and auto-hides master sheets
 */
function refreshQBOMasterLists() {
  showToast('Refreshing QuickBooks master lists...');

  try {
    refreshQBOCustomersMaster();
    refreshQBOEmployeesMaster();
    refreshQBOServiceItemsMaster();
    refreshQBOProjectsMaster();

    // Rewire dropdowns to include new master data
    wireAllDropdowns();

    // Auto-hide the QBO master sheets
    hideQBOMasterSheets();

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
 * Note: Projects are optional and may not be available depending on QBO subscription
 * Projects now include customer association: [id, name, customerId, customerName]
 */
function refreshQBOProjectsMaster() {
  logMessage('Refreshing QBO Projects master...', 'INFO');

  const projects = getProjectsForMasterList();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QBO_PROJECTS, CONFIG.COLUMNS.QBO_PROJECTS);

  // Clear existing data (projects now have 4 columns)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clear();
  }

  if (projects.length > 0) {
    sheet.getRange(2, 1, projects.length, 4).setValues(projects);
    logMessage(`Updated ${projects.length} projects in master list`, 'INFO');
  } else {
    logMessage('No QBO Projects found - this is normal if your QBO subscription does not include Projects', 'INFO');
    logMessage('You can still sync time entries using Customers only', 'INFO');
  }
}

// ============================================================================
// TOGGL MAPPINGS REFRESH
// ============================================================================

/**
 * Refreshes all Toggl mapping sheets (smart update - no duplicates, preserve existing)
 * Also wires dropdowns and applies highlighting for unmapped rows
 */
function refreshTogglMappings() {
  showToast('Refreshing Toggl mappings...');

  try {
    // Clear Toggl cache to ensure fresh data (detects archived projects, etc.)
    clearTogglCache();

    refreshUserMappings();
    refreshClientMappings();
    refreshProjectMappings();

    // Check API budget before expensive task fetch (1 call per project)
    const projectCount = (TOGGL_CACHE.projects || []).length;
    if (isApproachingApiLimit(projectCount + 5)) {
      logMessage(`Skipping task refresh: need ~${projectCount + 5} calls but approaching budget limit (${API_COUNTER.workspaceCalls} used)`, 'WARN');
    } else {
      refreshTaskMappings();
    }

    // Cleanup uses cached data from the refresh above (no extra API calls)
    // Build ID sets from cached data instead of re-fetching
    const cachedUsers = (TOGGL_CACHE.users || []).filter(u => u.active !== false);
    const cachedClients = (TOGGL_CACHE.clients || []).filter(c => !c.archived);
    const cachedProjects = TOGGL_CACHE.projects || [];

    const currentUsers = new Set(cachedUsers.map(u => String(u.id)));
    const currentClients = new Set(cachedClients.map(c => String(c.id)));
    const currentProjects = new Set(cachedProjects.map(p => String(p.id)));

    // For tasks, read from the mapping sheet instead of re-fetching from API
    const taskSheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);
    const currentTasks = new Set();
    if (taskSheet && taskSheet.getLastRow() > 1) {
      const taskData = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, 1).getValues();
      taskData.forEach(row => { if (row[0]) currentTasks.add(String(row[0])); });
    }

    let totalRemoved = 0;
    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_USERS, currentUsers, 0);
    totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, currentClients, 0);
    totalRemoved += markArchivedProjects(currentProjects);
    // Only mark tasks archived if we actually refreshed tasks
    if (!isApproachingApiLimit(1)) {
      totalRemoved += markArchivedTasks(currentTasks);
    }

    if (totalRemoved > 0) {
      logMessage(`Removed/archived ${totalRemoved} orphaned mappings`, 'INFO');
    }

    // Wire dropdowns to include new rows
    wireAllDropdowns();

    // Apply highlighting for unmapped rows
    applyUnmappedRowHighlighting();

    showToast('Toggl mappings refreshed successfully!');
  } catch (error) {
    showAlert(`Failed to refresh Toggl mappings: ${error.message}`, 'Error');
    logMessage(`Toggl mappings refresh error: ${error.message}`, 'ERROR');
  }
}

/**
 * Cleans up mapping rows for Toggl entities that no longer exist (deleted/archived).
 * Called automatically during refresh.
 * - Users, Clients, Tasks: Deleted from mapping sheets
 * - Projects: Marked as "Archived" (preserves mapping history for completed projects)
 * @returns {number} Total rows removed or archived
 */
function cleanupDeletedMappings() {
  const currentUsers = new Set(getUsersForMapping().map(u => String(u[0])));
  const currentClients = new Set(getClientsForMapping().map(c => String(c[0])));
  const currentProjects = new Set(getProjectsForMapping().map(p => String(p[0])));
  const currentTasks = new Set(getTasksForMapping().map(t => String(t[0])));

  let totalRemoved = 0;
  totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_USERS, currentUsers, 0);
  totalRemoved += cleanupSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, currentClients, 0);
  // Projects and Tasks are marked as Archived instead of deleted (preserves mapping history)
  totalRemoved += markArchivedProjects(currentProjects);
  totalRemoved += markArchivedTasks(currentTasks);

  return totalRemoved;
}

/**
 * Marks projects as "Archived" when they no longer exist in Toggl (archived in Toggl).
 * Preserves mapping history for completed projects.
 * Also reactivates projects that were archived but are now active again.
 * @param {Set} activeProjectIds - Set of currently active Toggl project IDs
 * @returns {number} Number of projects marked as archived
 */
function markArchivedProjects(activeProjectIds) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);

  if (!sheet || sheet.getLastRow() <= 1) {
    return 0;
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const statusColIndex = 5; // 0-based: Status is column 6 (index 5)
  let archivedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const projectId = String(data[i][0]);
    const currentStatus = data[i][statusColIndex];
    const rowNum = i + 2;

    if (!projectId) continue;

    if (!activeProjectIds.has(projectId)) {
      // Project no longer active in Toggl - mark as Archived
      if (currentStatus !== 'Archived') {
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Archived');
        archivedCount++;
      }
    } else {
      // Project is active in Toggl - ensure status is Active (reactivate if needed)
      if (currentStatus === 'Archived') {
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Active');
        logMessage(`Reactivated project ${projectId}`, 'INFO');
      } else if (!currentStatus || currentStatus === '') {
        // Set status for legacy rows that don't have a status
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Active');
      }
    }
  }

  return archivedCount;
}

/**
 * Marks tasks as "Archived" when they no longer exist in Toggl (parent project archived).
 * Preserves mapping history for completed project tasks.
 * Also reactivates tasks that were archived but are now active again.
 * @param {Set} activeTaskIds - Set of currently active Toggl task IDs
 * @returns {number} Number of tasks marked as archived
 */
function markArchivedTasks(activeTaskIds) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);

  if (!sheet || sheet.getLastRow() <= 1) {
    return 0;
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const statusColIndex = 6; // 0-based: Status is column 7 (index 6)
  let archivedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const taskId = String(data[i][0]);
    const currentStatus = data[i][statusColIndex];
    const rowNum = i + 2;

    if (!taskId) continue;

    if (!activeTaskIds.has(taskId)) {
      // Task no longer active in Toggl - mark as Archived
      if (currentStatus !== 'Archived') {
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Archived');
        archivedCount++;
      }
    } else {
      // Task is active in Toggl - ensure status is Active (reactivate if needed)
      if (currentStatus === 'Archived') {
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Active');
        logMessage(`Reactivated task ${taskId}`, 'INFO');
      } else if (!currentStatus || currentStatus === '') {
        // Set status for legacy rows that don't have a status
        sheet.getRange(rowNum, statusColIndex + 1).setValue('Active');
      }
    }
  }

  return archivedCount;
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

    // Try auto-match with QBO employees (suggest only — user must approve)
    const autoMatch = tryAutoMatchEmployee(userName, email);

    newRows.push([
      userId,
      userName,
      email,
      '',                       // QBO Employee ID — left blank until user approves
      autoMatch?.name || '',    // QBO Employee Name — pre-populated as suggestion
      false,                    // Matched — user must check to confirm
      timestamp
    ]);
  }

  // Append new rows
  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

    // Insert checkboxes for Matched column (col 6)
    sheet.getRange(lastRow + 1, 6, newRows.length, 1).insertCheckboxes();

    logMessage(`Added ${newRows.length} new user mappings`, 'INFO');
  } else {
    logMessage('No new users to add', 'INFO');
  }
}

/**
 * Smart refresh of Client mappings
 * Clients are sorted by creation date (newest first) from Toggl
 */
function refreshClientMappings() {
  logMessage('Refreshing Client mappings...', 'INFO');

  const clients = getClientsForMapping(); // Now returns [id, name, createdAt] sorted newest first
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_CLIENTS, CONFIG.COLUMNS.MAPPINGS_CLIENTS);

  const existing = getExistingMappings(sheet, 0);
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  // clients now returns [id, name, createdAt]
  for (const client of clients) {
    const [clientId, clientName] = client;

    if (existing.has(String(clientId))) {
      continue;
    }

    // Try auto-match with QBO customers (suggest only — user must approve)
    const autoMatch = tryAutoMatchCustomer(clientName);

    newRows.push([
      clientId,
      clientName,
      '',                       // QBO Customer ID — left blank until user approves
      autoMatch?.name || '',    // QBO Customer Name — pre-populated as suggestion
      false,                    // Matched — user must check to confirm
      timestamp
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

    // Insert checkboxes for Matched column (col 5)
    sheet.getRange(lastRow + 1, 5, newRows.length, 1).insertCheckboxes();

    logMessage(`Added ${newRows.length} new client mappings`, 'INFO');
  }
}

/**
 * Smart refresh of Project mappings
 * Structure: Toggl Project ID, Toggl Client Name, Toggl Project Name,
 *            QBO Project Name, QBO Project ID, Matched, Last Updated
 * Customer info comes from Mappings_Clients during sync (not duplicated here)
 */
function refreshProjectMappings() {
  logMessage('Refreshing Project mappings...', 'INFO');

  const projects = getProjectsForMapping();
  const sheet = getOrCreateSheet(CONFIG.SHEETS.MAPPINGS_PROJECTS, CONFIG.COLUMNS.MAPPINGS_PROJECTS);

  const existing = getExistingMappings(sheet, 0);
  const timestamp = formatDateTime(new Date());
  const newRows = [];

  // projects returns [id, name, clientName, clientId, createdAt]
  for (const project of projects) {
    const [projectId, projectName, clientName] = project;

    if (existing.has(String(projectId))) {
      continue;
    }

    newRows.push([
      projectId,          // Toggl Project ID
      clientName,         // Toggl Client Name
      projectName,        // Toggl Project Name
      '',                 // QBO Project Name - user selects
      '',                 // QBO Project ID - auto-populated
      'Active',           // Status (Active, Archived)
      timestamp           // Last Updated
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    logMessage(`Added ${newRows.length} new project mappings`, 'INFO');
  }

  // Sort sheet by newest first (based on original fetch order which is already sorted)
  sortMappingSheetByColumn(sheet);
}

/**
 * Sorts a mapping sheet to keep data organized (header row stays fixed)
 * @param {Sheet} sheet - The sheet to sort
 */
function sortMappingSheetByColumn(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return;

  // Data is already fetched in sorted order (newest first), so no additional sorting needed
  // This function can be expanded if manual re-sorting is needed
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

    // Try auto-match with QBO service items (suggest only — user must approve)
    const autoMatch = tryAutoMatchServiceItem(taskName);

    newRows.push([
      taskId,
      taskName,
      projectName,
      clientName,
      '',                       // QBO Service Item ID — left blank until user approves
      autoMatch?.name || '',    // QBO Service Item Name — pre-populated as suggestion
      'Active',         // Status (Active, Archived)
      false,                    // Matched — user must check to confirm
      timestamp
    ]);
  }

  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

    // Insert checkboxes for Matched column (col 8)
    sheet.getRange(lastRow + 1, 8, newRows.length, 1).insertCheckboxes();

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

// Max rows to apply dropdown validation to (accommodates future growth)
const DROPDOWN_MAX_ROWS = 500;

/**
 * Wires dropdown data validation to all mapping sheets
 * Uses open-ended ranges from master sheets so new items are automatically included
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
 * Creates a data validation rule from a master sheet column
 * Uses a large range to accommodate future additions
 * @param {Sheet} masterSheet - The master data sheet
 * @param {number} column - Column number (1-based)
 * @returns {DataValidation|null} Data validation rule or null
 */
function createDropdownRule(masterSheet, column) {
  if (!masterSheet) return null;

  // Use a large range (1000 rows) to accommodate future additions
  // Empty cells in the range are ignored by the dropdown
  const range = masterSheet.getRange(2, column, 1000, 1);
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(range, true)
    .setAllowInvalid(true)
    .build();
}

/**
 * Wires dropdowns for User mappings
 * Note: ID/Name auto-population is handled by onEdit trigger when values change
 */
function wireUserMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_USERS);
  const employeesSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_EMPLOYEES);

  if (!sheet || !employeesSheet) return;

  const rule = createDropdownRule(employeesSheet, 2); // Column B = names
  if (!rule) return;

  // Apply to QBO Employee Name column (E) for many rows to accommodate future data
  sheet.getRange(2, 5, DROPDOWN_MAX_ROWS, 1).setDataValidation(rule);
  logMessage('User mapping dropdowns wired', 'INFO');
}

/**
 * Wires dropdowns for Client mappings
 * Toggl Clients map to QBO Customers (top-level only, not sub-customers)
 */
function wireClientMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_CLIENTS);
  const customersSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);

  if (!sheet || !customersSheet) return;

  const rule = createDropdownRule(customersSheet, 2); // Column B = names
  if (!rule) return;

  // Apply to QBO Customer Name column (D) for many rows
  sheet.getRange(2, 4, DROPDOWN_MAX_ROWS, 1).setDataValidation(rule);
  logMessage('Client mapping dropdowns wired', 'INFO');
}

/**
 * Wires dropdowns for Project mappings
 * Columns: 1=Toggl ID, 2=Toggl Client, 3=Toggl Project, 4=QBO Project Name, 5=QBO Project ID,
 *          6=Matched, 7=Updated
 */
function wireProjectMappingDropdowns() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_PROJECTS);

  if (!sheet) return;

  // QBO Project dropdown (from QBO_Projects_Master - sub-customers as projects)
  if (projectsSheet) {
    const projectRule = createDropdownRule(projectsSheet, 2); // Column B = project names
    if (projectRule) {
      sheet.getRange(2, 4, DROPDOWN_MAX_ROWS, 1).setDataValidation(projectRule);
      logMessage('Project mapping dropdowns wired', 'INFO');
    }
  } else {
    logMessage('No QBO_Projects_Master sheet found - project dropdowns not wired', 'WARN');
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

  const rule = createDropdownRule(itemsSheet, 2); // Column B = names
  if (!rule) return;

  // QBO Service Item Name column (F) for many rows
  sheet.getRange(2, 6, DROPDOWN_MAX_ROWS, 1).setDataValidation(rule);
  logMessage('Task mapping dropdowns wired', 'INFO');
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
    projects: {},   // togglProjectId -> { qboProjectId, qboProjectName } (sub-customer)
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

  // Project mappings (Toggl Project -> QBO Sub-Customer as Project)
  // Structure: col 1=Toggl ID, 2=Client Name, 3=Project Name, 4=QBO Proj Name, 5=QBO Proj ID, 6=Matched, 7=Updated
  // Customer info comes from Mappings_Clients during sync (not stored here)
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  if (projectsSheet && projectsSheet.getLastRow() > 1) {
    const data = projectsSheet.getRange(2, 1, projectsSheet.getLastRow() - 1, 5).getValues();
    data.forEach(row => {
      if (row[0]) { // Has Toggl Project ID
        mappings.projects[String(row[0])] = {
          qboProjectId: row[4] ? String(row[4]) : '',   // QBO Project ID (sub-customer)
          qboProjectName: row[3] || ''                   // QBO Project Name (sub-customer)
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

// ============================================================================
// AUTO-POPULATE ON EDIT
// ============================================================================

/**
 * Trigger function that runs when a cell is edited
 * Auto-populates ID/Name pairs in mapping sheets
 * @param {Object} e - Edit event object
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Only process data rows (not header)
  if (row < 2) return;

  // Handle different mapping sheets
  switch (sheetName) {
    case CONFIG.SHEETS.MAPPINGS_USERS:
      handleUserMappingEdit(sheet, row, col, e.value);
      break;
    case CONFIG.SHEETS.MAPPINGS_CLIENTS:
      handleClientMappingEdit(sheet, row, col, e.value);
      break;
    case CONFIG.SHEETS.MAPPINGS_PROJECTS:
      handleProjectMappingEdit(sheet, row, col, e.value);
      break;
    case CONFIG.SHEETS.MAPPINGS_TASKS:
      handleTaskMappingEdit(sheet, row, col, e.value);
      break;
  }
}

/**
 * Handles edits in User mappings sheet
 * Columns: 1=Toggl ID, 2=Toggl Name, 3=Email, 4=QBO ID, 5=QBO Name, 6=Auto, 7=Updated
 */
function handleUserMappingEdit(sheet, row, col, value) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_EMPLOYEES);
  if (!masterSheet || masterSheet.getLastRow() <= 1) return;

  const masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 2).getValues();

  if (col === 5 && value) {
    // QBO Name edited - find and set QBO ID
    const match = masterData.find(r => r[1] === value);
    if (match) {
      sheet.getRange(row, 4).setValue(match[0]);
    }
  } else if (col === 4 && value) {
    // QBO ID edited - find and set QBO Name
    const match = masterData.find(r => String(r[0]) === String(value));
    if (match) {
      sheet.getRange(row, 5).setValue(match[1]);
    }
  }
}

/**
 * Handles edits in Client mappings sheet
 * Columns: 1=Toggl ID, 2=Toggl Name, 3=QBO ID, 4=QBO Name, 5=Auto, 6=Updated
 * Also updates related project mappings when customer info changes
 */
function handleClientMappingEdit(sheet, row, col, value) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);
  if (!masterSheet || masterSheet.getLastRow() <= 1) return;

  const masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 2).getValues();

  let customerChanged = false;

  if (col === 4 && value) {
    // QBO Name edited - find and set QBO ID
    const match = masterData.find(r => r[1] === value);
    if (match) {
      sheet.getRange(row, 3).setValue(match[0]);
      customerChanged = true;
    }
  } else if (col === 3 && value) {
    // QBO ID edited - find and set QBO Name
    const match = masterData.find(r => String(r[0]) === String(value));
    if (match) {
      sheet.getRange(row, 4).setValue(match[1]);
      customerChanged = true;
    }
  }

}

/**
 * Handles edits in Project mappings sheet
 * Columns: 1=Toggl ID, 2=Toggl Client, 3=Toggl Project, 4=QBO Project Name, 5=QBO Project ID,
 *          6=Matched, 7=Updated
 */
function handleProjectMappingEdit(sheet, row, col, value) {
  const ss = getSpreadsheet();

  // Project lookup (sub-customer) - columns 4 (Name) and 5 (ID)
  if (col === 4 || col === 5) {
    const projectSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_PROJECTS);
    if (projectSheet && projectSheet.getLastRow() > 1) {
      const projectData = projectSheet.getRange(2, 1, projectSheet.getLastRow() - 1, 2).getValues();

      if (col === 4 && value) {
        // QBO Project Name edited - find and set QBO Project ID
        const match = projectData.find(r => r[1] === value);
        if (match) {
          sheet.getRange(row, 5).setValue(match[0]);
        }
      } else if (col === 5 && value) {
        // QBO Project ID edited - find and set QBO Project Name
        const match = projectData.find(r => String(r[0]) === String(value));
        if (match) {
          sheet.getRange(row, 4).setValue(match[1]);
        }
      }
    }
  }
}

/**
 * Handles edits in Task mappings sheet
 * Columns: 1=Toggl ID, 2=Task Name, 3=Project, 4=Client, 5=QBO ID, 6=QBO Name, 7=Auto, 8=Updated
 */
function handleTaskMappingEdit(sheet, row, col, value) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_ITEMS);
  if (!masterSheet || masterSheet.getLastRow() <= 1) return;

  const masterData = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 2).getValues();

  if (col === 6 && value) {
    // QBO Name edited - find and set QBO ID
    const match = masterData.find(r => r[1] === value);
    if (match) {
      sheet.getRange(row, 5).setValue(match[0]);
    }
  } else if (col === 5 && value) {
    // QBO ID edited - find and set QBO Name
    const match = masterData.find(r => String(r[0]) === String(value));
    if (match) {
      sheet.getRange(row, 6).setValue(match[1]);
    }
  }
}

// ============================================================================
// SHEET VISIBILITY AND ORGANIZATION
// ============================================================================

/**
 * Hides all QBO master data sheets
 * Called automatically after refreshing QBO master lists
 */
function hideQBOMasterSheets() {
  const ss = getSpreadsheet();

  // List of QBO master sheets to hide
  const sheetsToHide = [
    CONFIG.SHEETS.QBO_CUSTOMERS,
    CONFIG.SHEETS.QBO_EMPLOYEES,
    CONFIG.SHEETS.QBO_ITEMS,
    CONFIG.SHEETS.QBO_PROJECTS
  ];

  // Hide each sheet
  for (const sheetName of sheetsToHide) {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      sheet.hideSheet();
    }
  }

  logMessage('QBO master sheets hidden', 'INFO');
}

/**
 * Shows all hidden QBO master sheets (for debugging/access)
 */
function showQBOMasterSheets() {
  const ss = getSpreadsheet();

  const sheetsToShow = [
    CONFIG.SHEETS.QBO_CUSTOMERS,
    CONFIG.SHEETS.QBO_EMPLOYEES,
    CONFIG.SHEETS.QBO_ITEMS,
    CONFIG.SHEETS.QBO_PROJECTS
  ];

  for (const sheetName of sheetsToShow) {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      sheet.showSheet();
    }
  }

  showToast('QBO master sheets are now visible.');
}

// ============================================================================
// CONDITIONAL FORMATTING FOR MAPPING STATUS
// ============================================================================

/**
 * Applies conditional formatting to all mapping sheets:
 * - Grey: Matched checkbox is checked (row reviewed/approved)
 * - Red: QBO mapping is empty AND Matched is unchecked (needs attention)
 * Note: Projects sheet uses Status column instead of Matched, handled separately
 */
function applyUnmappedRowHighlighting() {
  showToast('Applying highlighting to mapping sheets...');

  const ss = getSpreadsheet();

  // Apply to each mapping sheet:
  // Args: ss, sheetName, idCol, nameCol, matchedCol
  applyMappingHighlights(ss, CONFIG.SHEETS.MAPPINGS_USERS, 4, 5, 6);      // QBO Employee ID/Name, Matched col 6
  applyMappingHighlights(ss, CONFIG.SHEETS.MAPPINGS_CLIENTS, 3, 4, 5);    // QBO Customer ID/Name, Matched col 5
  applyProjectMappingHighlights(ss);  // Projects use Status column, handled separately
  applyTaskMappingHighlights(ss);     // Tasks use Status column, handled separately

  showToast('Mapping sheet highlighting applied!');
}

/**
 * Applies conditional formatting to Projects mapping sheet
 * Uses Status column instead of Matched column
 * - Grey: Status is "Archived"
 * - Red: QBO Project ID/Name is empty AND Status is not "Archived"
 */
function applyProjectMappingHighlights(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_PROJECTS);
  if (!sheet) return;

  const grey = '#e0e0e0';       // Grey for archived
  const pastelRed = '#ffcccc';  // Red for needs attention
  const lastCol = sheet.getLastColumn() || 7;

  // Clear existing conditional formatting rules
  sheet.clearConditionalFormatRules();

  // Range for data rows (excluding header)
  const range = sheet.getRange(2, 1, DROPDOWN_MAX_ROWS, lastCol);

  // Column letters: D=QBO Project Name, E=QBO Project ID, F=Status
  // Rule 1 (higher priority): Grey when Status is "Archived"
  const greyFormula = '=AND(A2<>"", $F2="Archived")';
  const greyRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(greyFormula)
    .setBackground(grey)
    .setRanges([range])
    .build();

  // Rule 2: Red when unmapped (no QBO ID or Name) AND not Archived
  const redFormula = '=AND(A2<>"", $F2<>"Archived", $D2="", $E2="")';
  const redRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(redFormula)
    .setBackground(pastelRed)
    .setRanges([range])
    .build();

  // Grey rule first (higher priority), then red
  sheet.setConditionalFormatRules([greyRule, redRule]);

  logMessage('Applied mapping highlights to Projects', 'INFO');
}

/**
 * Applies conditional formatting to Tasks mapping sheet
 * Uses Status column for archive detection
 * - Grey: Status is "Archived"
 * - Red: QBO Service Item ID/Name is empty AND Status is not "Archived"
 */
function applyTaskMappingHighlights(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAPPINGS_TASKS);
  if (!sheet) return;

  const grey = '#e0e0e0';       // Grey for archived
  const pastelRed = '#ffcccc';  // Red for needs attention
  const lastCol = sheet.getLastColumn() || 9;

  // Clear existing conditional formatting rules
  sheet.clearConditionalFormatRules();

  // Range for data rows (excluding header)
  const range = sheet.getRange(2, 1, DROPDOWN_MAX_ROWS, lastCol);

  // Column letters: E=QBO Service Item ID, F=QBO Service Item Name, G=Status
  // Rule 1 (higher priority): Grey when Status is "Archived"
  const greyFormula = '=AND(A2<>"", $G2="Archived")';
  const greyRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(greyFormula)
    .setBackground(grey)
    .setRanges([range])
    .build();

  // Rule 2: Red when unmapped (no QBO ID or Name) AND not Archived
  const redFormula = '=AND(A2<>"", $G2<>"Archived", $E2="", $F2="")';
  const redRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(redFormula)
    .setBackground(pastelRed)
    .setRanges([range])
    .build();

  // Grey rule first (higher priority), then red
  sheet.setConditionalFormatRules([greyRule, redRule]);

  // Ensure checkbox column (H) has checkboxes for existing data rows
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).insertCheckboxes();
  }

  logMessage('Applied mapping highlights to Tasks', 'INFO');
}

/**
 * Applies two conditional formatting rules to a mapping sheet:
 * 1. Grey highlight when Matched checkbox is checked (higher priority)
 * 2. Red highlight when QBO mapping is empty and Matched is unchecked
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {string} sheetName - Name of the sheet
 * @param {number} idCol - Column number for QBO ID (1-based)
 * @param {number} nameCol - Column number for QBO Name (1-based)
 * @param {number} matchedCol - Column number for Matched checkbox (1-based)
 */
function applyMappingHighlights(ss, sheetName, idCol, nameCol, matchedCol) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;

  const grey = '#e0e0e0';       // Grey for matched/reviewed
  const pastelRed = '#ffcccc';  // Red for needs attention
  const lastCol = sheet.getLastColumn() || matchedCol;

  // Clear existing conditional formatting rules
  sheet.clearConditionalFormatRules();

  // Range for data rows (excluding header)
  const range = sheet.getRange(2, 1, DROPDOWN_MAX_ROWS, lastCol);

  const matchedColLetter = columnToLetter(matchedCol);
  const idColLetter = columnToLetter(idCol);
  const nameColLetter = columnToLetter(nameCol);

  // Rule 1 (higher priority): Grey when Matched checkbox is TRUE
  const greyFormula = `=AND(A2<>"", ${matchedColLetter}2=TRUE)`;
  const greyRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(greyFormula)
    .setBackground(grey)
    .setRanges([range])
    .build();

  // Rule 2: Red when unmapped AND not matched
  const redFormula = `=AND(A2<>"", ${matchedColLetter}2<>TRUE, ${idColLetter}2="", ${nameColLetter}2="")`;
  const redRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(redFormula)
    .setBackground(pastelRed)
    .setRanges([range])
    .build();

  // Grey rule first (higher priority), then red
  sheet.setConditionalFormatRules([greyRule, redRule]);

  // Ensure checkbox column has checkboxes for existing data rows
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, matchedCol, sheet.getLastRow() - 1, 1).insertCheckboxes();
  }

  logMessage(`Applied mapping highlights to ${sheetName}`, 'INFO');
}

/**
 * Converts a column number to a letter (1=A, 2=B, etc.)
 * @param {number} col - Column number (1-based)
 * @returns {string} Column letter
 */
function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}
