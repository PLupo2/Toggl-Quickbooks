/**
 * QuickBooks.gs - QuickBooks Online API calls
 * Handles queries, TimeActivity creation, and GraphQL for Projects
 */

// ============================================================================
// API REQUEST HELPERS
// ============================================================================

/**
 * Makes an authenticated request to the QBO API
 * @param {string} endpoint - API endpoint (after /v3/company/{realmId}/)
 * @param {Object} [options] - Request options
 * @returns {Object} Parsed JSON response
 */
function qboRequest(endpoint, options = {}) {
  const accessToken = getValidAccessToken();
  const realmId = getQBORealm();

  if (!realmId) {
    throw new Error('QBO Realm ID not configured. Please set QBO_REALM_ID in Script Properties or re-authorize.');
  }

  const baseUrl = getQBOBaseURL();
  const url = `${baseUrl}/v3/company/${realmId}/${endpoint}`;

  const defaultOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  const requestOptions = { ...defaultOptions, ...options };
  if (options.headers) {
    requestOptions.headers = { ...defaultOptions.headers, ...options.headers };
  }

  logMessage(`QBO Request: ${requestOptions.method.toUpperCase()} ${url}`, 'INFO');

  const MAX_RETRIES = 4;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
      logMessage(`QBO retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff...`, 'INFO');
      Utilities.sleep(backoffMs);
    }

    const response = UrlFetchApp.fetch(url, requestOptions);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 401 && attempt === 0) {
      // Token might have expired, try refreshing (only on first attempt)
      logMessage('Got 401, attempting token refresh...', 'INFO');
      const newToken = refreshAccessToken();
      requestOptions.headers['Authorization'] = `Bearer ${newToken}`;

      const retryResponse = UrlFetchApp.fetch(url, requestOptions);
      if (retryResponse.getResponseCode() !== 200 && retryResponse.getResponseCode() !== 201) {
        throw new Error(`QBO API Error after refresh: ${retryResponse.getResponseCode()} - ${retryResponse.getContentText()}`);
      }
      return JSON.parse(retryResponse.getContentText());
    }

    // Success
    if (responseCode === 200 || responseCode === 201) {
      return JSON.parse(responseBody);
    }

    // Retryable: rate limit / bandwidth quota / server errors
    const isRetryable = responseCode === 429
      || responseCode === 503
      || responseBody.includes('Bandwidth quota exceeded')
      || responseBody.includes('throttled');

    if (isRetryable && attempt < MAX_RETRIES) {
      logMessage(`QBO retryable error (${responseCode}): ${responseBody.substring(0, 200)}`, 'WARN');
      lastError = `QBO API Error: ${responseCode} - ${responseBody}`;
      continue;
    }

    // Non-retryable or exhausted retries
    logMessage(`QBO API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`QBO API Error: ${responseCode} - ${responseBody}`);
  }

  throw new Error(lastError || 'QBO request failed after retries');
}

/**
 * Executes a QBO query
 * @param {string} query - SQL-like query string
 * @returns {Object[]} Array of results
 */
function qboQuery(query) {
  const encodedQuery = encodeURIComponent(query);
  const response = qboRequest(`query?query=${encodedQuery}`);

  return response.QueryResponse || {};
}

// ============================================================================
// CUSTOMER OPERATIONS
// ============================================================================

/**
 * Fetches all customers from QBO
 * @param {boolean} [includeSubCustomers=true] - Whether to include sub-customers
 * @returns {Object[]} Array of customer objects
 */
function fetchQBOCustomers(includeSubCustomers = true) {
  logMessage('Fetching QBO customers...', 'INFO');

  const customers = [];
  let startPosition = 1;
  const maxResults = 1000;
  let hasMore = true;

  while (hasMore) {
    // Include ParentRef to identify sub-customers
    const query = `SELECT Id, DisplayName, Active, ParentRef FROM Customer STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const response = qboQuery(query);

    if (response.Customer && response.Customer.length > 0) {
      customers.push(...response.Customer);
      startPosition += response.Customer.length;
      hasMore = response.Customer.length === maxResults;
    } else {
      hasMore = false;
    }
  }

  logMessage(`Fetched ${customers.length} total customers`, 'INFO');

  // Filter out sub-customers if requested
  if (!includeSubCustomers) {
    const topLevel = customers.filter(c => !c.ParentRef);
    logMessage(`Filtered to ${topLevel.length} top-level customers (excluding sub-customers)`, 'INFO');
    return topLevel;
  }

  return customers;
}

/**
 * Gets active top-level customers for master list (excludes sub-customers)
 * @returns {Array[]} Array of [id, name] pairs
 */
function getCustomersForMasterList() {
  // Exclude sub-customers - they should not be shown in Clients mapping dropdown
  const customers = fetchQBOCustomers(false);
  return customers
    .filter(c => c.Active !== false)
    .map(c => [c.Id, c.DisplayName])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// EMPLOYEE OPERATIONS
// ============================================================================

/**
 * Fetches all employees from QBO
 * @returns {Object[]} Array of employee objects
 */
function fetchQBOEmployees() {
  logMessage('Fetching QBO employees...', 'INFO');

  const employees = [];
  let startPosition = 1;
  const maxResults = 1000;
  let hasMore = true;

  while (hasMore) {
    const query = `SELECT Id, DisplayName, Active FROM Employee STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const response = qboQuery(query);

    if (response.Employee && response.Employee.length > 0) {
      employees.push(...response.Employee);
      startPosition += response.Employee.length;
      hasMore = response.Employee.length === maxResults;
    } else {
      hasMore = false;
    }
  }

  logMessage(`Fetched ${employees.length} employees`, 'INFO');
  return employees;
}

/**
 * Gets active employees for master list
 * @returns {Array[]} Array of [id, name] pairs
 */
function getEmployeesForMasterList() {
  const employees = fetchQBOEmployees();
  return employees
    .filter(e => e.Active !== false)
    .map(e => [e.Id, e.DisplayName])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// SERVICE ITEM OPERATIONS
// ============================================================================

/**
 * Fetches all service items from QBO
 * @returns {Object[]} Array of item objects
 */
function fetchQBOServiceItems() {
  logMessage('Fetching QBO service items...', 'INFO');

  const items = [];
  let startPosition = 1;
  const maxResults = 1000;
  let hasMore = true;

  while (hasMore) {
    // QBO doesn't support IS NOT NULL, so we fetch all and filter
    const query = `SELECT Id, Name, Type, Active FROM Item STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const response = qboQuery(query);

    if (response.Item && response.Item.length > 0) {
      // Filter for service items only
      const serviceItems = response.Item.filter(item =>
        item.Type === 'Service' && item.Active !== false
      );
      items.push(...serviceItems);
      startPosition += response.Item.length;
      hasMore = response.Item.length === maxResults;
    } else {
      hasMore = false;
    }
  }

  logMessage(`Fetched ${items.length} service items`, 'INFO');
  return items;
}

/**
 * Gets active service items for master list
 * @returns {Array[]} Array of [id, name] pairs
 */
function getServiceItemsForMasterList() {
  const items = fetchQBOServiceItems();
  return items
    .map(i => [i.Id, i.Name])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// PROJECT OPERATIONS (Sub-Customers as Projects)
// ============================================================================

/**
 * Fetches sub-customers to use as "Projects"
 *
 * Since the GraphQL Projects API requires a paid developer tier ($300/mo),
 * we use QBO sub-customers as a workaround for projects.
 *
 * Structure:
 * - Top-level Customers (no ParentRef) → Used for Client mapping
 * - Sub-customers (has ParentRef) → Used for Project mapping
 *
 * @returns {Object[]} Array of sub-customer objects with parent info
 */
function fetchQBOProjects() {
  logMessage('Fetching QBO sub-customers as projects...', 'INFO');

  try {
    // Fetch ALL customers (including sub-customers)
    const allCustomers = fetchQBOCustomers(true);

    // Build a lookup map for parent customers
    const customerMap = {};
    allCustomers.forEach(c => {
      customerMap[c.Id] = c.DisplayName;
    });

    // Filter to only sub-customers (those with ParentRef)
    const subCustomers = allCustomers.filter(c => c.ParentRef && c.Active !== false);

    logMessage(`Found ${subCustomers.length} sub-customers (projects)`, 'INFO');

    // Map to project format with parent customer info
    const projects = subCustomers.map(c => ({
      id: c.Id,
      name: c.DisplayName,
      status: c.Active !== false ? 'ACTIVE' : 'INACTIVE',
      customerId: c.ParentRef.value,
      customerName: customerMap[c.ParentRef.value] || 'Unknown Customer'
    }));

    return projects;
  } catch (error) {
    logMessage(`Error fetching sub-customers as projects: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Shows diagnostic information about sub-customers being used as Projects
 */
function showProjectsInfo() {
  showToast('Checking QBO sub-customers (projects)...');

  const projects = fetchQBOProjects();

  let message;
  if (projects.length > 0) {
    message = `Found ${projects.length} sub-customers (projects):\n\n`;
    projects.slice(0, 10).forEach(p => {
      message += `• ${p.name} (Parent: ${p.customerName})\n`;
    });
    if (projects.length > 10) {
      message += `\n... and ${projects.length - 10} more`;
    }
    message += '\n\nSub-customers are being used as Projects.';
  } else {
    message = `No sub-customers found.\n\n` +
      `This system uses QBO sub-customers as "Projects":\n\n` +
      `• Top-level Customers = Clients\n` +
      `• Sub-customers = Projects\n\n` +
      `To create projects:\n` +
      `1. Go to QBO > Customers\n` +
      `2. Create a new customer\n` +
      `3. Check "Is sub-customer" and select the parent\n\n` +
      `Projects are optional - you can sync using only Clients.`;
  }

  showAlert(message, 'QBO Projects (Sub-Customers)');
}

/**
 * Debug function to show all customers and sub-customers
 */
function debugCustomerHierarchy() {
  showToast('Fetching customer hierarchy...');

  try {
    const allCustomers = fetchQBOCustomers(true);

    // Separate top-level and sub-customers
    const topLevel = allCustomers.filter(c => !c.ParentRef);
    const subCustomers = allCustomers.filter(c => c.ParentRef);

    // Build parent lookup
    const parentMap = {};
    allCustomers.forEach(c => {
      parentMap[c.Id] = c.DisplayName;
    });

    // Write to debug sheet
    const ss = getSpreadsheet();
    let debugSheet = ss.getSheetByName('_Debug_Customers');
    if (!debugSheet) {
      debugSheet = ss.insertSheet('_Debug_Customers');
    }
    debugSheet.clear();

    // Header
    debugSheet.getRange(1, 1).setValue('Customer Hierarchy Debug');
    debugSheet.getRange(2, 1).setValue('Timestamp:');
    debugSheet.getRange(2, 2).setValue(new Date().toISOString());
    debugSheet.getRange(3, 1).setValue('Total Customers:');
    debugSheet.getRange(3, 2).setValue(allCustomers.length);
    debugSheet.getRange(4, 1).setValue('Top-Level (Clients):');
    debugSheet.getRange(4, 2).setValue(topLevel.length);
    debugSheet.getRange(5, 1).setValue('Sub-Customers (Projects):');
    debugSheet.getRange(5, 2).setValue(subCustomers.length);

    // Top-level customers section
    debugSheet.getRange(7, 1).setValue('TOP-LEVEL CUSTOMERS (Clients)');
    debugSheet.getRange(8, 1, 1, 3).setValues([['ID', 'Name', 'Active']]);
    if (topLevel.length > 0) {
      const topData = topLevel.map(c => [c.Id, c.DisplayName, c.Active !== false ? 'Yes' : 'No']);
      debugSheet.getRange(9, 1, topData.length, 3).setValues(topData);
    }

    // Sub-customers section
    const subStartRow = 9 + topLevel.length + 2;
    debugSheet.getRange(subStartRow, 1).setValue('SUB-CUSTOMERS (Projects)');
    debugSheet.getRange(subStartRow + 1, 1, 1, 4).setValues([['ID', 'Name', 'Parent Customer', 'Active']]);
    if (subCustomers.length > 0) {
      const subData = subCustomers.map(c => [
        c.Id,
        c.DisplayName,
        parentMap[c.ParentRef.value] || c.ParentRef.value,
        c.Active !== false ? 'Yes' : 'No'
      ]);
      debugSheet.getRange(subStartRow + 2, 1, subData.length, 4).setValues(subData);
    }

    debugSheet.autoResizeColumns(1, 4);
    debugSheet.activate();

    showAlert(
      `Customer hierarchy written to "_Debug_Customers" sheet.\n\n` +
      `Top-Level Customers (Clients): ${topLevel.length}\n` +
      `Sub-Customers (Projects): ${subCustomers.length}\n\n` +
      `Check the sheet for full details.`,
      'Customer Hierarchy'
    );
  } catch (error) {
    showAlert(`Debug failed: ${error.message}`, 'Error');
  }
}

/**
 * Gets active projects for master list with customer info
 * @returns {Array[]} Array of [id, name, customerId, customerName] rows
 */
function getProjectsForMasterList() {
  const projects = fetchQBOProjects();
  return projects
    .map(p => [p.id, p.name, p.customerId, p.customerName])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

// ============================================================================
// TIME ACTIVITY OPERATIONS
// ============================================================================

/**
 * Creates a TimeActivity record in QBO
 *
 * Note on Customer/Project handling:
 * Since we use sub-customers as "projects", the CustomerRef should contain:
 * - The sub-customer ID if a project is mapped (sub-customer = project)
 * - The top-level customer ID if only a client is mapped (no project)
 *
 * @param {Object} timeData - Time entry data
 * @returns {Object} Created TimeActivity
 */
function createTimeActivity(timeData) {
  logMessage(`Creating TimeActivity for date ${timeData.date}`, 'INFO');

  // Convert hours to hours and minutes for QBO
  const totalMinutes = hoursToMinutes(timeData.hours);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Determine which customer ID to use
  // If projectId is set, it's a sub-customer ID and takes precedence
  // Otherwise, use the regular customerId (top-level customer)
  const customerIdToUse = timeData.projectId || timeData.customerId;

  const payload = {
    NameOf: 'Employee',
    EmployeeRef: {
      value: String(timeData.employeeId)
    },
    CustomerRef: {
      value: String(customerIdToUse)
    },
    ItemRef: {
      value: String(timeData.serviceItemId)
    },
    TxnDate: timeData.date,
    Hours: hours,
    Minutes: minutes,
    Description: timeData.description || '',
    BillableStatus: timeData.billable ? 'Billable' : 'NotBillable'
  };

  // Note: We do NOT use ProjectRef since we're using sub-customers as projects
  // The sub-customer ID goes directly into CustomerRef

  const response = qboRequest('timeactivity', {
    method: 'post',
    payload: JSON.stringify(payload)
  });

  if (response.TimeActivity) {
    logMessage(`Created TimeActivity ID: ${response.TimeActivity.Id}`, 'INFO');
    return response.TimeActivity;
  }

  throw new Error('Failed to create TimeActivity - no response');
}

/**
 * Fetches existing TimeActivities for a date range
 * Used for deduplication checking
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object[]} Array of TimeActivity objects
 */
function fetchTimeActivities(startDate, endDate) {
  logMessage(`Fetching TimeActivities from ${startDate} to ${endDate}`, 'INFO');

  const activities = [];
  let startPosition = 1;
  const maxResults = 1000;
  let hasMore = true;

  while (hasMore) {
    const query = `SELECT * FROM TimeActivity WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const response = qboQuery(query);

    if (response.TimeActivity && response.TimeActivity.length > 0) {
      activities.push(...response.TimeActivity);
      startPosition += response.TimeActivity.length;
      hasMore = response.TimeActivity.length === maxResults;
    } else {
      hasMore = false;
    }
  }

  logMessage(`Fetched ${activities.length} TimeActivities`, 'INFO');
  return activities;
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Creates multiple TimeActivities in batch
 * QBO supports batch operations for efficiency
 * @param {Object[]} timeEntries - Array of time entry data
 * @returns {Object} Results with successes and failures
 */
function createTimeActivitiesBatch(timeEntries) {
  const results = {
    successful: [],
    failed: []
  };

  for (const entry of timeEntries) {
    try {
      const activity = createTimeActivity(entry);
      results.successful.push({
        togglEntryId: entry.togglEntryId,
        qboActivityId: activity.Id
      });
    } catch (error) {
      logMessage(`Failed to create TimeActivity for Toggl entry ${entry.togglEntryId}: ${error.message}`, 'ERROR');
      results.failed.push({
        togglEntryId: entry.togglEntryId,
        error: error.message
      });
    }

    // Delay between calls to avoid QBO bandwidth quota
    Utilities.sleep(250);
  }

  return results;
}

// ============================================================================
// LOOKUP HELPERS
// ============================================================================

/**
 * Looks up QBO entity name by ID
 * @param {string} entityType - Type (Customer, Employee, Item)
 * @param {string} id - Entity ID
 * @returns {string|null} Entity name or null
 */
function lookupQBOEntityName(entityType, id) {
  if (!id) return null;

  try {
    const query = `SELECT Id, DisplayName FROM ${entityType} WHERE Id = '${id}'`;
    const response = qboQuery(query);

    if (response[entityType] && response[entityType].length > 0) {
      return response[entityType][0].DisplayName || response[entityType][0].Name;
    }
  } catch (error) {
    logMessage(`Error looking up ${entityType} ${id}: ${error.message}`, 'WARN');
  }

  return null;
}

/**
 * Builds lookup maps from master sheets
 * @returns {Object} Maps for customers, employees, items, projects
 */
function buildQBOLookupMaps() {
  const ss = getSpreadsheet();
  const maps = {
    customers: {},
    employees: {},
    items: {},
    projects: {}
  };

  // Customers
  const customersSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_CUSTOMERS);
  if (customersSheet && customersSheet.getLastRow() > 1) {
    const data = customersSheet.getRange(2, 1, customersSheet.getLastRow() - 1, 2).getValues();
    data.forEach(row => {
      if (row[0]) maps.customers[row[0]] = row[1];
    });
  }

  // Employees
  const employeesSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_EMPLOYEES);
  if (employeesSheet && employeesSheet.getLastRow() > 1) {
    const data = employeesSheet.getRange(2, 1, employeesSheet.getLastRow() - 1, 2).getValues();
    data.forEach(row => {
      if (row[0]) maps.employees[row[0]] = row[1];
    });
  }

  // Service Items
  const itemsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_ITEMS);
  if (itemsSheet && itemsSheet.getLastRow() > 1) {
    const data = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 2).getValues();
    data.forEach(row => {
      if (row[0]) maps.items[row[0]] = row[1];
    });
  }

  // Projects
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.QBO_PROJECTS);
  if (projectsSheet && projectsSheet.getLastRow() > 1) {
    const data = projectsSheet.getRange(2, 1, projectsSheet.getLastRow() - 1, 2).getValues();
    data.forEach(row => {
      if (row[0]) maps.projects[row[0]] = row[1];
    });
  }

  return maps;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates QBO connection and required data
 * @returns {Object} Validation result with status and message
 */
function validateQBOSetup() {
  const result = {
    valid: true,
    errors: []
  };

  // Check connection
  if (!isConnectedToQBO()) {
    result.valid = false;
    result.errors.push('Not connected to QuickBooks Online');
    return result;
  }

  // Check realm ID
  if (!getQBORealm()) {
    result.valid = false;
    result.errors.push('QBO Realm ID not configured');
  }

  // Test API access
  try {
    const testQuery = 'SELECT Id FROM CompanyInfo';
    qboQuery(testQuery);
  } catch (error) {
    result.valid = false;
    result.errors.push(`API access error: ${error.message}`);
  }

  return result;
}

/**
 * Gets company info from QBO
 * @returns {Object} Company info
 */
function getQBOCompanyInfo() {
  try {
    const response = qboQuery('SELECT * FROM CompanyInfo');
    if (response.CompanyInfo && response.CompanyInfo.length > 0) {
      return response.CompanyInfo[0];
    }
  } catch (error) {
    logMessage(`Error fetching company info: ${error.message}`, 'ERROR');
  }
  return null;
}
