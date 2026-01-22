# Test Cases

Test cases for validating the Toggl-QBO Sync system functionality.

## Prerequisites

Before running tests:
1. System is deployed and configured
2. Connected to QBO Sandbox
3. Toggl API token is valid
4. All sheets are created

## Test Categories

1. [Authentication Tests](#authentication-tests)
2. [Import Tests](#import-tests)
3. [Mapping Tests](#mapping-tests)
4. [Validation Tests](#validation-tests)
5. [Sync Tests](#sync-tests)
6. [Deduplication Tests](#deduplication-tests)
7. [Error Handling Tests](#error-handling-tests)

---

## Authentication Tests

### TC-AUTH-001: QuickBooks Connection

**Objective**: Verify OAuth connection to QBO

**Steps**:
1. Go to **Setup > Connect to QuickBooks**
2. Click authorization link
3. Complete Intuit login
4. Verify redirect callback

**Expected**:
- Dialog shows authorization URL
- Successful redirect shows "Successfully Connected!"
- Connection status shows connected

**Verification**:
```javascript
function testQBOConnection() {
  const connected = isConnectedToQBO();
  Logger.log('QBO Connected: ' + connected);
  return connected;
}
```

### TC-AUTH-002: Token Refresh

**Objective**: Verify automatic token refresh

**Steps**:
1. Wait for access token to expire (or simulate expiry)
2. Make an API call

**Expected**:
- Token refreshes automatically
- API call succeeds

### TC-AUTH-003: Toggl Validation

**Objective**: Verify Toggl API connection

**Steps**:
1. Go to **Setup > Show Toggl Status**

**Expected**:
- Shows "Connected to Toggl Track"
- Displays workspace ID

**Verification**:
```javascript
function testTogglConnection() {
  const valid = validateTogglConnection();
  Logger.log('Toggl Valid: ' + valid);
  return valid;
}
```

---

## Import Tests

### TC-IMP-001: Import All Users

**Objective**: Verify import of time entries for all workspace users

**Preconditions**:
- Time entries exist in Toggl for the date range
- Multiple users have time entries

**Steps**:
1. Go to **Import from Toggl > Import All Users**
2. Wait for completion

**Expected**:
- Toast shows number of entries imported
- Entries appear in Inbox_Approvals sheet
- Multiple users' entries are included
- Entry details match Toggl data

**Verification**:
```javascript
function testImportAllUsers() {
  const result = importTimeEntries(true);
  Logger.log('Imported: ' + result.imported);
  Logger.log('Skipped: ' + result.skipped);
  return result.imported > 0;
}
```

### TC-IMP-002: Import Current User Only

**Objective**: Verify import of time entries for current user only

**Steps**:
1. Go to **Import from Toggl > Import Current User Only**

**Expected**:
- Only current user's entries imported
- Other users' entries not included

### TC-IMP-003: Import Date Range

**Objective**: Verify configurable date range

**Steps**:
1. Set IMPORT_DAYS to 7 in Config sheet
2. Import entries
3. Verify only last 7 days included

**Expected**:
- Only entries within date range imported

### TC-IMP-004: Import With Missing Fields

**Objective**: Verify handling of entries with missing optional fields

**Steps**:
1. Create Toggl entry with no description
2. Create entry with no tags
3. Import entries

**Expected**:
- Entries imported successfully
- Empty fields handled gracefully

---

## Mapping Tests

### TC-MAP-001: Refresh Toggl Mappings

**Objective**: Verify Toggl entity refresh

**Steps**:
1. Go to **Refresh Data > Refresh Toggl Mappings**

**Expected**:
- Users appear in Mappings_Users
- Clients appear in Mappings_Clients
- Projects appear in Mappings_Projects
- Tasks appear in Mappings_Tasks_Services

### TC-MAP-002: Refresh QBO Master Lists

**Objective**: Verify QBO entity refresh

**Steps**:
1. Go to **Refresh Data > Refresh QBO Master Lists**

**Expected**:
- Customers appear in QBO_Customers_Master
- Employees appear in QBO_Employees_Master
- Service items appear in QBO_Items_Service_Master
- Projects appear in QBO_Projects_Master (if available)

### TC-MAP-003: Smart Refresh (No Duplicates)

**Objective**: Verify refresh doesn't create duplicates

**Steps**:
1. Run **Refresh Toggl Mappings** twice
2. Check mapping sheets

**Expected**:
- No duplicate entries
- Existing mappings preserved

### TC-MAP-004: Auto-Match Users

**Objective**: Verify automatic user-to-employee matching

**Steps**:
1. Create QBO employee with same name as Toggl user
2. Refresh mappings

**Expected**:
- Auto-match column shows "Yes"
- QBO Employee populated automatically

### TC-MAP-005: Dropdown Wiring

**Objective**: Verify dropdown data validation

**Steps**:
1. Go to **Refresh Data > Wire Dropdowns**
2. Check mapping sheet cells

**Expected**:
- Dropdowns show QBO entity names
- Selecting name auto-fills ID (via formula)

---

## Validation Tests

### TC-VAL-001: Validate Complete Entry

**Objective**: Verify validation passes for complete entry

**Preconditions**:
- Entry has all mappings configured

**Steps**:
1. Import entry with all mappings
2. Go to **Inbox > Validate Entries**

**Expected**:
- Status shows "Ready"
- No validation errors

### TC-VAL-002: Missing Employee Mapping

**Objective**: Verify validation catches missing employee

**Steps**:
1. Import entry with unmapped user
2. Validate entries

**Expected**:
- Status shows "Needs Review"
- Error shows "No Employee mapping"

### TC-VAL-003: Missing Customer Mapping

**Objective**: Verify validation catches missing customer

**Steps**:
1. Import entry with unmapped project/client
2. Validate entries

**Expected**:
- Status shows "Needs Review"
- Error shows "No Customer mapping"

### TC-VAL-004: Missing Service Item Mapping

**Objective**: Verify validation catches missing service item

**Steps**:
1. Import entry with unmapped task
2. Validate entries

**Expected**:
- Status shows "Needs Review"
- Error shows "No Service Item mapping"

### TC-VAL-005: Auto-Populate Mappings

**Objective**: Verify auto-population from existing mappings

**Steps**:
1. Configure mappings for a project
2. Import entry for that project
3. Go to **Inbox > Auto-Populate Mappings**

**Expected**:
- QBO columns filled automatically
- Validation passes

---

## Sync Tests

### TC-SYN-001: Process Inbox to Queue

**Objective**: Verify approved entries move to Queue

**Steps**:
1. Approve an entry in Inbox
2. Go to **Sync > Process Inbox → Queue**

**Expected**:
- Entry removed from Inbox
- Entry appears in Queue
- All QBO IDs populated

### TC-SYN-002: Sync Queue to QBO

**Objective**: Verify TimeActivity creation in QBO

**Steps**:
1. Entry exists in Queue with valid data
2. Go to **Sync > Sync Queue → QBO**

**Expected**:
- Entry synced successfully
- QBO TimeActivity ID returned
- Entry moved to Archive

### TC-SYN-003: Full Sync Workflow

**Objective**: Verify complete workflow

**Steps**:
1. Approve entries in Inbox
2. Go to **Sync > Run Full Sync**

**Expected**:
- Entries processed through Queue
- TimeActivities created in QBO
- Entries archived

### TC-SYN-004: Billable Flag

**Objective**: Verify billable status passes through

**Steps**:
1. Import billable and non-billable entries
2. Sync to QBO

**Expected**:
- TimeActivity.BillableStatus matches Toggl billable flag

### TC-SYN-005: Duration Accuracy

**Objective**: Verify duration conversion

**Steps**:
1. Import entry with specific duration (e.g., 1.5 hours)
2. Sync to QBO
3. Verify in QBO

**Expected**:
- Duration matches (Hours: 1, Minutes: 30)

---

## Deduplication Tests

### TC-DUP-001: Skip Existing Inbox Entries

**Objective**: Verify no duplicate imports

**Steps**:
1. Import entries
2. Import again

**Expected**:
- Toast shows entries skipped
- No duplicates in Inbox

### TC-DUP-002: Skip Queued Entries

**Objective**: Verify entries in Queue aren't re-imported

**Steps**:
1. Import entry, move to Queue
2. Import again

**Expected**:
- Entry not re-imported

### TC-DUP-003: Skip Archived Entries

**Objective**: Verify synced entries aren't re-imported

**Steps**:
1. Sync entry to QBO (moves to Archive)
2. Import again

**Expected**:
- Entry not re-imported

---

## Error Handling Tests

### TC-ERR-001: Invalid QBO Employee

**Objective**: Verify handling of invalid employee ID

**Steps**:
1. Manually enter invalid employee ID in Queue
2. Attempt sync

**Expected**:
- Sync fails for that entry
- Error logged in Queue
- Other entries still process

### TC-ERR-002: QBO API Rate Limit

**Objective**: Verify handling of rate limits

**Steps**:
1. Configure many entries
2. Attempt bulk sync

**Expected**:
- Script handles rate limits gracefully
- Retries or reports error

### TC-ERR-003: Network Failure

**Objective**: Verify handling of network errors

**Steps**:
1. Simulate network failure (if possible)
2. Attempt operation

**Expected**:
- Error displayed to user
- No data corruption

### TC-ERR-004: Retry Failed Entries

**Objective**: Verify retry mechanism

**Steps**:
1. Entry fails sync
2. Fix the issue
3. Go to **Sync > Reset Failed Queue Entries**
4. Sync again

**Expected**:
- Sync attempts reset
- Entry syncs successfully

---

## Test Execution Checklist

### Pre-Test Setup

- [ ] QBO Sandbox connected
- [ ] Toggl API valid
- [ ] All sheets created
- [ ] Sample Toggl time entries exist
- [ ] QBO has employees, customers, service items

### Authentication Tests

- [ ] TC-AUTH-001: QuickBooks Connection
- [ ] TC-AUTH-002: Token Refresh
- [ ] TC-AUTH-003: Toggl Validation

### Import Tests

- [ ] TC-IMP-001: Import All Users
- [ ] TC-IMP-002: Import Current User Only
- [ ] TC-IMP-003: Import Date Range
- [ ] TC-IMP-004: Import With Missing Fields

### Mapping Tests

- [ ] TC-MAP-001: Refresh Toggl Mappings
- [ ] TC-MAP-002: Refresh QBO Master Lists
- [ ] TC-MAP-003: Smart Refresh (No Duplicates)
- [ ] TC-MAP-004: Auto-Match Users
- [ ] TC-MAP-005: Dropdown Wiring

### Validation Tests

- [ ] TC-VAL-001: Validate Complete Entry
- [ ] TC-VAL-002: Missing Employee Mapping
- [ ] TC-VAL-003: Missing Customer Mapping
- [ ] TC-VAL-004: Missing Service Item Mapping
- [ ] TC-VAL-005: Auto-Populate Mappings

### Sync Tests

- [ ] TC-SYN-001: Process Inbox to Queue
- [ ] TC-SYN-002: Sync Queue to QBO
- [ ] TC-SYN-003: Full Sync Workflow
- [ ] TC-SYN-004: Billable Flag
- [ ] TC-SYN-005: Duration Accuracy

### Deduplication Tests

- [ ] TC-DUP-001: Skip Existing Inbox Entries
- [ ] TC-DUP-002: Skip Queued Entries
- [ ] TC-DUP-003: Skip Archived Entries

### Error Handling Tests

- [ ] TC-ERR-001: Invalid QBO Employee
- [ ] TC-ERR-002: QBO API Rate Limit
- [ ] TC-ERR-003: Network Failure
- [ ] TC-ERR-004: Retry Failed Entries

---

## Automated Test Runner

```javascript
/**
 * Run all automated tests
 */
function runAllTests() {
  const results = {
    passed: [],
    failed: []
  };

  // Auth tests
  runTest('QBO Connection', testQBOConnection, results);
  runTest('Toggl Connection', testTogglConnection, results);

  // Log results
  Logger.log('=== TEST RESULTS ===');
  Logger.log('Passed: ' + results.passed.length);
  Logger.log('Failed: ' + results.failed.length);

  results.failed.forEach(f => {
    Logger.log('FAILED: ' + f.name + ' - ' + f.error);
  });

  return results;
}

function runTest(name, testFn, results) {
  try {
    const passed = testFn();
    if (passed) {
      results.passed.push({ name });
    } else {
      results.failed.push({ name, error: 'Returned false' });
    }
  } catch (error) {
    results.failed.push({ name, error: error.message });
  }
}

function testQBOConnection() {
  return isConnectedToQBO();
}

function testTogglConnection() {
  return validateTogglConnection();
}
```
