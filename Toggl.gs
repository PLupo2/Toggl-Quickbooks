/**
 * Toggl.gs - Toggl Track API calls and import logic
 * Supports both API v9 (current user) and Reports API v3 (all workspace users)
 */

// ============================================================================
// API CONFIGURATION
// ============================================================================

const TOGGL_API_V9_BASE = 'https://api.track.toggl.com/api/v9';
const TOGGL_REPORTS_V3_BASE = 'https://api.track.toggl.com/reports/api/v3';

// ============================================================================
// API REQUEST HELPERS
// ============================================================================

/**
 * Makes an authenticated request to Toggl API v9
 * @param {string} endpoint - API endpoint
 * @param {Object} [options] - Request options
 * @returns {Object} Parsed JSON response
 */
function togglApiV9(endpoint, options = {}) {
  const authHeader = getTogglAuthHeader();
  const url = `${TOGGL_API_V9_BASE}${endpoint}`;

  const defaultOptions = {
    method: 'get',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  const requestOptions = { ...defaultOptions, ...options };
  if (options.headers) {
    requestOptions.headers = { ...defaultOptions.headers, ...options.headers };
  }

  logMessage(`Toggl API v9: ${requestOptions.method.toUpperCase()} ${endpoint}`, 'INFO');

  const response = UrlFetchApp.fetch(url, requestOptions);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Toggl API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`Toggl API Error: ${responseCode}`);
  }

  return JSON.parse(responseBody);
}

/**
 * Makes an authenticated request to Toggl Reports API v3
 * @param {string} endpoint - API endpoint
 * @param {Object} payload - Request payload
 * @returns {Object} Parsed JSON response
 */
function togglReportsV3(endpoint, payload) {
  const authHeader = getTogglAuthHeader();
  const workspaceId = getOrFetchWorkspaceId();
  const url = `${TOGGL_REPORTS_V3_BASE}/workspace/${workspaceId}${endpoint}`;

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  logMessage(`Toggl Reports API: POST ${endpoint}`, 'INFO');

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    logMessage(`Toggl Reports API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`Toggl Reports API Error: ${responseCode}`);
  }

  return JSON.parse(responseBody);
}

// ============================================================================
// WORKSPACE OPERATIONS
// ============================================================================

/**
 * Gets or fetches the workspace ID
 * @returns {string} Workspace ID
 */
function getOrFetchWorkspaceId() {
  let workspaceId = getTogglWorkspaceId();

  if (!workspaceId) {
    const me = togglApiV9('/me');
    if (me.default_workspace_id) {
      workspaceId = String(me.default_workspace_id);
      setScriptProperty('TOGGL_WORKSPACE_ID', workspaceId);
      logMessage(`Auto-detected workspace ID: ${workspaceId}`, 'INFO');
    } else {
      throw new Error('Could not determine Toggl workspace ID');
    }
  }

  return workspaceId;
}

/**
 * Fetches all workspaces for the authenticated user
 * @returns {Object[]} Array of workspace objects
 */
function fetchWorkspaces() {
  return togglApiV9('/workspaces');
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Fetches all users in the workspace
 * @returns {Object[]} Array of user objects
 */
function fetchTogglUsers() {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl workspace users...', 'INFO');

  const users = togglApiV9(`/workspaces/${workspaceId}/users`);
  logMessage(`Fetched ${users.length} users`, 'INFO');

  return users;
}

/**
 * Gets users for mapping sheet
 * @returns {Array[]} Array of [id, name, email] rows
 */
function getUsersForMapping() {
  const users = fetchTogglUsers();
  return users.map(u => [
    u.id,
    u.fullname || u.name || u.email,
    u.email
  ]).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
}

// ============================================================================
// CLIENT OPERATIONS
// ============================================================================

/**
 * Fetches all clients in the workspace
 * @returns {Object[]} Array of client objects
 */
function fetchTogglClients() {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl clients...', 'INFO');

  const clients = togglApiV9(`/workspaces/${workspaceId}/clients`);
  logMessage(`Fetched ${clients.length} clients`, 'INFO');

  return clients;
}

/**
 * Gets clients for mapping sheet
 * @returns {Array[]} Array of [id, name] rows
 */
function getClientsForMapping() {
  const clients = fetchTogglClients();
  return clients
    .filter(c => !c.archived)
    .map(c => [c.id, c.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

/**
 * Fetches all projects in the workspace
 * @param {boolean} [activeOnly=true] - Only fetch active projects
 * @returns {Object[]} Array of project objects
 */
function fetchTogglProjects(activeOnly = true) {
  const workspaceId = getOrFetchWorkspaceId();
  logMessage('Fetching Toggl projects...', 'INFO');

  let endpoint = `/workspaces/${workspaceId}/projects`;
  if (activeOnly) {
    endpoint += '?active=true';
  }

  const projects = togglApiV9(endpoint);
  logMessage(`Fetched ${projects.length} projects`, 'INFO');

  return projects;
}

/**
 * Gets projects for mapping sheet with client info
 * @returns {Array[]} Array of [id, name, clientName] rows
 */
function getProjectsForMapping() {
  const projects = fetchTogglProjects(true);
  const clients = fetchTogglClients();

  // Build client lookup
  const clientMap = {};
  clients.forEach(c => {
    clientMap[c.id] = c.name;
  });

  return projects.map(p => [
    p.id,
    p.name,
    p.client_id ? clientMap[p.client_id] || '' : ''
  ]).sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

/**
 * Fetches all tasks for a project
 * @param {number} projectId - Project ID
 * @returns {Object[]} Array of task objects
 */
function fetchTogglTasksForProject(projectId) {
  const workspaceId = getOrFetchWorkspaceId();
  return togglApiV9(`/workspaces/${workspaceId}/projects/${projectId}/tasks`);
}

/**
 * Fetches all tasks across all active projects
 * @returns {Object[]} Array of task objects with project context
 */
function fetchAllTogglTasks() {
  logMessage('Fetching all Toggl tasks...', 'INFO');

  const projects = fetchTogglProjects(true); // Only active projects
  const clients = fetchTogglClients();

  // Build lookups
  const clientMap = {};
  clients.forEach(c => {
    clientMap[c.id] = c.name;
  });

  const projectMap = {};
  projects.forEach(p => {
    projectMap[p.id] = {
      name: p.name,
      clientName: p.client_id ? clientMap[p.client_id] || '' : ''
    };
  });

  const allTasks = [];

  for (const project of projects) {
    try {
      const tasks = fetchTogglTasksForProject(project.id);
      tasks.forEach(task => {
        if (task.active !== false) {
          allTasks.push({
            id: task.id,
            name: task.name,
            projectId: project.id,
            projectName: project.name,
            clientName: projectMap[project.id]?.clientName || ''
          });
        }
      });
    } catch (error) {
      logMessage(`Error fetching tasks for project ${project.id}: ${error.message}`, 'WARN');
    }

    // Small delay to avoid rate limiting
    Utilities.sleep(50);
  }

  logMessage(`Fetched ${allTasks.length} tasks across ${projects.length} projects`, 'INFO');
  return allTasks;
}

/**
 * Gets tasks for mapping sheet with project context
 * @returns {Array[]} Array of [taskId, taskName, projectName, clientName] rows
 */
function getTasksForMapping() {
  const tasks = fetchAllTogglTasks();
  return tasks.map(t => [
    t.id,
    t.name,
    t.projectName,
    t.clientName
  ]).sort((a, b) => {
    // Sort by client, then project, then task
    const clientCompare = (a[3] || '').localeCompare(b[3] || '');
    if (clientCompare !== 0) return clientCompare;
    const projectCompare = a[2].localeCompare(b[2]);
    if (projectCompare !== 0) return projectCompare;
    return a[1].localeCompare(b[1]);
  });
}

// ============================================================================
// TIME ENTRY OPERATIONS - API v9 (Current User)
// ============================================================================

/**
 * Fetches time entries for the current user (API v9)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of time entry objects
 */
function fetchTimeEntriesCurrentUser(startDate, endDate) {
  logMessage(`Fetching time entries for current user: ${startDate} to ${endDate}`, 'INFO');

  // API v9 expects ISO timestamps
  const startISO = new Date(startDate + 'T00:00:00Z').toISOString();
  const endISO = new Date(endDate + 'T23:59:59Z').toISOString();

  const entries = togglApiV9(`/me/time_entries?start_date=${encodeURIComponent(startISO)}&end_date=${encodeURIComponent(endISO)}`);

  logMessage(`Fetched ${entries.length} time entries for current user`, 'INFO');
  return entries;
}

// ============================================================================
// TIME ENTRY OPERATIONS - Reports API v3 (All Users)
// ============================================================================

/**
 * Fetches detailed time entries for all workspace users (Reports API v3)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of time entry objects
 */
function fetchTimeEntriesAllUsers(startDate, endDate) {
  logMessage(`Fetching time entries for all users: ${startDate} to ${endDate}`, 'INFO');

  const allEntries = [];
  let hasMore = true;
  let firstRowNumber = 1;
  const pageSize = 50;

  while (hasMore) {
    const payload = {
      start_date: startDate,
      end_date: endDate,
      // IMPORTANT: Use null for all users, not empty array
      user_ids: null,
      first_row_number: firstRowNumber,
      page_size: pageSize
    };

    const response = togglReportsV3('/search/time_entries', payload);

    if (response && Array.isArray(response)) {
      allEntries.push(...response);
      hasMore = response.length === pageSize;
      firstRowNumber += response.length;
    } else {
      hasMore = false;
    }

    // Rate limiting protection
    Utilities.sleep(100);
  }

  logMessage(`Fetched ${allEntries.length} time entries for all users`, 'INFO');
  return allEntries;
}

// ============================================================================
// IMPORT LOGIC
// ============================================================================

/**
 * Imports time entries from Toggl to the Inbox sheet
 * @param {boolean} [allUsers=true] - Import for all users (Reports API) or just current user
 * @returns {Object} Import results
 */
function importTimeEntries(allUsers = true) {
  logMessage('Starting Toggl time entry import...', 'INFO');

  const ss = getSpreadsheet();

  // Calculate date range
  const importDays = parseInt(getConfigValue('IMPORT_DAYS', CONFIG.DEFAULTS.IMPORT_DAYS), 10);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - importDays);

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  showToast(`Importing entries from ${startDateStr} to ${endDateStr}...`);

  // Fetch time entries
  let entries;
  if (allUsers) {
    entries = fetchTimeEntriesAllUsers(startDateStr, endDateStr);
  } else {
    entries = fetchTimeEntriesCurrentUser(startDateStr, endDateStr);
  }

  if (entries.length === 0) {
    showToast('No time entries found for the date range.');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Get existing entry IDs to avoid duplicates
  const existingIds = getExistingEntryIds();

  // Build lookup data
  const lookups = buildTogglLookups();

  // Process entries
  const results = processEntriesForImport(entries, existingIds, lookups);

  // Write to Inbox
  if (results.toImport.length > 0) {
    writeToInbox(results.toImport);
  }

  // Update last import date
  setConfigValue('LAST_IMPORT_DATE', formatDateTime(new Date()));

  const message = `Import complete: ${results.toImport.length} imported, ${results.skipped} skipped (duplicates)`;
  logMessage(message, 'INFO');
  showToast(message);

  return {
    imported: results.toImport.length,
    skipped: results.skipped,
    errors: results.errors
  };
}

/**
 * Gets existing entry IDs from Inbox, Queue, and Archive
 * @returns {Set} Set of existing Toggl entry IDs
 */
function getExistingEntryIds() {
  const ss = getSpreadsheet();
  const existingIds = new Set();

  // Check Inbox
  const inboxSheet = ss.getSheetByName(CONFIG.SHEETS.INBOX);
  if (inboxSheet && inboxSheet.getLastRow() > 1) {
    const inboxIds = inboxSheet.getRange(2, 1, inboxSheet.getLastRow() - 1, 1).getValues();
    inboxIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  // Check Queue
  const queueSheet = ss.getSheetByName(CONFIG.SHEETS.QUEUE);
  if (queueSheet && queueSheet.getLastRow() > 1) {
    const queueIds = queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 1).getValues();
    queueIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  // Check Archive
  const archiveSheet = ss.getSheetByName(CONFIG.SHEETS.ARCHIVE);
  if (archiveSheet && archiveSheet.getLastRow() > 1) {
    const archiveIds = archiveSheet.getRange(2, 1, archiveSheet.getLastRow() - 1, 1).getValues();
    archiveIds.forEach(row => {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  return existingIds;
}

/**
 * Builds lookup maps for Toggl entities
 * @returns {Object} Lookup maps for users, clients, projects, tasks
 */
function buildTogglLookups() {
  const users = fetchTogglUsers();
  const clients = fetchTogglClients();
  const projects = fetchTogglProjects(false); // Include inactive for historical data

  const lookups = {
    users: {},
    clients: {},
    projects: {},
    tasks: {}
  };

  users.forEach(u => {
    lookups.users[u.id] = u.fullname || u.name || u.email;
  });

  clients.forEach(c => {
    lookups.clients[c.id] = c.name;
  });

  projects.forEach(p => {
    lookups.projects[p.id] = {
      name: p.name,
      clientId: p.client_id,
      clientName: p.client_id ? lookups.clients[p.client_id] : ''
    };
  });

  // Fetch tasks for each project
  projects.forEach(p => {
    try {
      const tasks = fetchTogglTasksForProject(p.id);
      tasks.forEach(t => {
        lookups.tasks[t.id] = t.name;
      });
    } catch (e) {
      // Ignore errors for individual projects
    }
    Utilities.sleep(25);
  });

  return lookups;
}

/**
 * Processes entries for import, resolving names and checking duplicates
 * @param {Object[]} entries - Raw time entries
 * @param {Set} existingIds - Existing entry IDs
 * @param {Object} lookups - Lookup maps
 * @returns {Object} Processing results
 */
function processEntriesForImport(entries, existingIds, lookups) {
  const toImport = [];
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    // Handle different API response formats
    const entryId = entry.id || entry.time_entry_id;

    // Skip duplicates
    if (existingIds.has(String(entryId))) {
      skipped++;
      continue;
    }

    try {
      const processed = processTimeEntry(entry, lookups);
      toImport.push(processed);
    } catch (error) {
      logMessage(`Error processing entry ${entryId}: ${error.message}`, 'WARN');
      errors++;
    }
  }

  return { toImport, skipped, errors };
}

/**
 * Processes a single time entry into Inbox format
 * @param {Object} entry - Raw time entry
 * @param {Object} lookups - Lookup maps
 * @returns {Object} Processed entry
 */
function processTimeEntry(entry, lookups) {
  // Handle different API formats (v9 vs Reports)
  const entryId = entry.id || entry.time_entry_id;
  const userId = entry.user_id || entry.uid;
  const projectId = entry.project_id || entry.pid;
  const taskId = entry.task_id || entry.tid;

  // Duration handling
  let durationSeconds = entry.duration || entry.seconds || 0;
  if (durationSeconds < 0) {
    // Running timer - calculate from start
    const start = new Date(entry.start);
    durationSeconds = Math.floor((new Date() - start) / 1000);
  }

  // Get project and client info
  const projectInfo = projectId ? lookups.projects[projectId] : null;

  return {
    togglEntryId: entryId,
    togglUser: lookups.users[userId] || String(userId),
    togglUserId: userId,
    togglClient: projectInfo?.clientName || '',
    togglClientId: projectInfo?.clientId || '',
    togglProject: projectInfo?.name || '',
    togglProjectId: projectId || '',
    togglTask: taskId ? (lookups.tasks[taskId] || '') : '',
    togglTaskId: taskId || '',
    description: entry.description || '',
    date: formatDate(entry.start),
    durationHours: secondsToHours(durationSeconds),
    billable: entry.billable || false,
    startTime: entry.start || '',
    stopTime: entry.stop || '',
    tags: (entry.tags || entry.tag_ids || []).join(', '),
    importedAt: formatDateTime(new Date())
  };
}

/**
 * Writes processed entries to the Inbox sheet
 * @param {Object[]} entries - Processed entries
 */
function writeToInbox(entries) {
  const ss = getSpreadsheet();
  const inboxSheet = getOrCreateSheet(CONFIG.SHEETS.INBOX, CONFIG.COLUMNS.INBOX);

  const rows = entries.map(e => [
    e.togglEntryId,
    e.togglUser,
    '', // QBO Employee - to be mapped
    e.togglClient,
    e.togglProject,
    '', // QBO Customer - to be mapped
    '', // QBO Project - to be mapped
    e.togglTask,
    '', // QBO Service Item - to be mapped
    e.description,
    e.date,
    e.durationHours,
    e.billable,
    e.startTime,
    e.stopTime,
    e.tags,
    'Pending Review', // Status
    '', // Validation Errors
    false, // Approved
    e.importedAt,
    '' // Notes
  ]);

  if (rows.length > 0) {
    const lastRow = inboxSheet.getLastRow();
    inboxSheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// ============================================================================
// IMPORT MENU FUNCTIONS
// ============================================================================

/**
 * Imports time entries for all workspace users
 */
function importAllUsersEntries() {
  try {
    importTimeEntries(true);
  } catch (error) {
    showAlert(`Import failed: ${error.message}`, 'Error');
    logMessage(`Import error: ${error.message}`, 'ERROR');
  }
}

/**
 * Imports time entries for current user only
 */
function importCurrentUserEntries() {
  try {
    importTimeEntries(false);
  } catch (error) {
    showAlert(`Import failed: ${error.message}`, 'Error');
    logMessage(`Import error: ${error.message}`, 'ERROR');
  }
}
