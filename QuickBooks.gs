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

  const response = UrlFetchApp.fetch(url, requestOptions);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode === 401) {
    // Token might have expired, try refreshing
    logMessage('Got 401, attempting token refresh...', 'INFO');
    const newToken = refreshAccessToken();
    requestOptions.headers['Authorization'] = `Bearer ${newToken}`;

    const retryResponse = UrlFetchApp.fetch(url, requestOptions);
    if (retryResponse.getResponseCode() !== 200 && retryResponse.getResponseCode() !== 201) {
      throw new Error(`QBO API Error after refresh: ${retryResponse.getResponseCode()} - ${retryResponse.getContentText()}`);
    }
    return JSON.parse(retryResponse.getContentText());
  }

  if (responseCode !== 200 && responseCode !== 201) {
    logMessage(`QBO API Error: ${responseCode} - ${responseBody}`, 'ERROR');
    throw new Error(`QBO API Error: ${responseCode} - ${responseBody}`);
  }

  return JSON.parse(responseBody);
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
// PROJECT OPERATIONS (GraphQL)
// ============================================================================

/**
 * Fetches projects using GraphQL API
 * Note: QBO Projects require QuickBooks Online Plus or Advanced subscription
 * and the project.readonly scope.
 * If projects return empty, it may be because:
 * 1. The QBO subscription doesn't include Projects
 * 2. No projects have been created in QBO
 * 3. The app doesn't have the required scope (need to re-authorize)
 * @returns {Object[]} Array of project objects with customer info
 */
function fetchQBOProjects() {
  logMessage('Fetching QBO projects via GraphQL...', 'INFO');
  logMessage('Note: Projects require QBO Plus/Advanced subscription', 'INFO');

  try {
    const accessToken = getValidAccessToken();
    const realmId = getQBORealm();

    // GraphQL query - fetching ALL projects regardless of status first
    const graphqlQuery = `
      query projects {
        company {
          projects {
            edges {
              node {
                id
                name
                status
                description
                customer {
                  id
                  displayName
                }
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
            }
          }
        }
      }
    `;

    logMessage('Making GraphQL request to fetch projects...', 'INFO');
    logMessage(`Using realmId: ${realmId}`, 'INFO');

    const response = UrlFetchApp.fetch('https://public.api.intuit.com/2020-04/graphql', {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify({ query: graphqlQuery }),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    logMessage(`GraphQL response code: ${responseCode}`, 'INFO');
    logMessage(`GraphQL full response: ${responseBody}`, 'INFO');

    if (responseCode !== 200) {
      logMessage(`GraphQL projects fetch failed: ${responseCode} - ${responseBody}`, 'WARN');
      logMessage('Projects may not be available. Did you re-authorize after adding project.readonly scope?', 'WARN');
      return [];
    }

    const result = JSON.parse(responseBody);

    if (result.errors) {
      const errorMessages = result.errors.map(e => `${e.message} (${e.extensions?.code || 'no code'})`).join('; ');
      logMessage(`GraphQL errors: ${errorMessages}`, 'WARN');
      logMessage('Full error details: ' + JSON.stringify(result.errors), 'WARN');
      return [];
    }

    // Log the full data structure for debugging
    logMessage(`GraphQL data structure: ${JSON.stringify(result.data)}`, 'INFO');

    const projectsEdges = result.data?.company?.projects?.edges || [];
    logMessage(`Raw projects edges count: ${projectsEdges.length}`, 'INFO');

    // Map ALL projects first, then log statuses
    const allProjects = projectsEdges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      status: edge.node.status,
      customerId: edge.node.customer?.id || '',
      customerName: edge.node.customer?.displayName || ''
    }));

    // Log all statuses found
    const statuses = [...new Set(allProjects.map(p => p.status))];
    logMessage(`Project statuses found: ${statuses.join(', ') || 'none'}`, 'INFO');

    // Return all projects (don't filter by status for now)
    logMessage(`Returning ${allProjects.length} projects`, 'INFO');

    return allProjects;
  } catch (error) {
    logMessage(`Error fetching projects: ${error.message}`, 'ERROR');
    logMessage('Stack: ' + error.stack, 'ERROR');
    return [];
  }
}

/**
 * Shows detailed diagnostic information about QBO Projects availability
 */
function showProjectsInfo() {
  showToast('Checking QBO Projects availability...');

  const projects = fetchQBOProjects();

  let message;
  if (projects.length > 0) {
    message = `Found ${projects.length} QBO Projects:\n\n`;
    projects.slice(0, 10).forEach(p => {
      message += `• ${p.name} (Status: ${p.status}, Customer: ${p.customerName || 'None'})\n`;
    });
    if (projects.length > 10) {
      message += `\n... and ${projects.length - 10} more`;
    }
    message += '\n\nProjects are working correctly!';
  } else {
    message = `No QBO Projects found.\n\n` +
      `Troubleshooting steps:\n\n` +
      `1. Check subscription: QBO Projects require Plus or Advanced plan\n\n` +
      `2. Re-authorize: After we added the project.readonly scope, you need to:\n` +
      `   • Run "Setup > Disconnect QuickBooks"\n` +
      `   • Run "Setup > Connect to QuickBooks"\n` +
      `   • Complete the OAuth flow again\n\n` +
      `3. Create projects: Make sure you have at least one project created in QBO\n\n` +
      `4. Check Apps Script Logs: View > Executions for detailed API responses\n\n` +
      `5. Run "Raw Projects Debug" from Maintenance menu for full API response\n\n` +
      `Note: QBO Projects are optional. You can sync time entries using Customers only.`;
  }

  showAlert(message, 'QBO Projects Status');
}

/**
 * Raw debug function to see exactly what the GraphQL API returns
 */
function debugRawProjectsResponse() {
  showToast('Fetching raw GraphQL response...');

  try {
    const accessToken = getValidAccessToken();
    const realmId = getQBORealm();

    const graphqlQuery = `
      query projects {
        company {
          projects {
            edges {
              node {
                id
                name
                status
                description
                customer {
                  id
                  displayName
                }
              }
            }
          }
        }
      }
    `;

    const response = UrlFetchApp.fetch('https://public.api.intuit.com/2020-04/graphql', {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ query: graphqlQuery }),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    // Write to a debug sheet for full visibility
    const ss = getSpreadsheet();
    let debugSheet = ss.getSheetByName('_Debug_Projects');
    if (!debugSheet) {
      debugSheet = ss.insertSheet('_Debug_Projects');
    }
    debugSheet.clear();

    debugSheet.getRange(1, 1).setValue('GraphQL Projects Debug');
    debugSheet.getRange(2, 1).setValue('Timestamp:');
    debugSheet.getRange(2, 2).setValue(new Date().toISOString());
    debugSheet.getRange(3, 1).setValue('Realm ID:');
    debugSheet.getRange(3, 2).setValue(realmId || 'NOT SET');
    debugSheet.getRange(4, 1).setValue('Response Code:');
    debugSheet.getRange(4, 2).setValue(responseCode);
    debugSheet.getRange(5, 1).setValue('Response Body:');
    debugSheet.getRange(6, 1).setValue(responseBody);

    // Make the response body cell wrap
    debugSheet.getRange(6, 1).setWrap(true);
    debugSheet.setColumnWidth(1, 800);

    debugSheet.activate();

    showAlert(
      `Debug info written to "_Debug_Projects" sheet.\n\n` +
      `Response Code: ${responseCode}\n\n` +
      `Check the sheet for the full API response.`,
      'Projects Debug'
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
 * @param {Object} timeData - Time entry data
 * @returns {Object} Created TimeActivity
 */
function createTimeActivity(timeData) {
  logMessage(`Creating TimeActivity for date ${timeData.date}`, 'INFO');

  // Convert hours to hours and minutes for QBO
  const totalMinutes = hoursToMinutes(timeData.hours);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const payload = {
    NameOf: 'Employee',
    EmployeeRef: {
      value: String(timeData.employeeId)
    },
    CustomerRef: {
      value: String(timeData.customerId)
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

  // Add project if specified
  if (timeData.projectId) {
    // Projects in QBO are handled via ProjectRef
    payload.ProjectRef = {
      value: String(timeData.projectId)
    };
  }

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

    // Small delay to avoid rate limiting
    Utilities.sleep(100);
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
