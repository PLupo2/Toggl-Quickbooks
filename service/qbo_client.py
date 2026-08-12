"""QuickBooks Online client -- ported from QuickBooks.gs. Only the LIVE
surface: qboRequest (auth/retry wrapper) and createTimeActivity. Everything
else in the original file (fetchQBOCustomers/Employees/ServiceItems/Projects,
the getXForMasterList wrappers, buildQBOLookupMaps, lookupQBOEntityName,
createTimeActivitiesBatch, fetchTimeActivities, validateQBOSetup,
getQBOCompanyInfo, debugCustomerHierarchy) was confirmed to have ZERO
reachability against the current Apps Script source -- not even menu-bound --
orphaned by earlier cleanups and never deleted. Deliberately not ported; see
Phase 3 plan §1.
"""
import time

import httpx

import core_client


def hours_to_minutes(hours):
    return round(hours * 60)


def qbo_request(endpoint, method="get", payload=None):
    """Auth via Core-vended token (replaces local OAuth's
    getValidAccessToken/getQBORealm). Retry/backoff logic preserved exactly:
    up to 4 retries with 2/4/8/16s backoff on 429/503/bandwidth-quota/
    throttled; a 401 forces one Core token refresh + one immediate retry,
    matching qb-bookkeeper's own 401-handling pattern for this exact vendor
    relationship."""
    tok = core_client.get_qbo_token()
    url = f"{tok['api_base_url']}/v3/company/{tok['realm_id']}/{endpoint}"
    headers = {"Authorization": f"Bearer {tok['access_token']}", "Accept": "application/json", "Content-Type": "application/json"}

    MAX_RETRIES = 4
    last_error = None

    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(2 ** attempt)  # 2s, 4s, 8s, 16s

        resp = httpx.request(method.upper(), url, headers=headers, content=payload, timeout=60)

        if resp.status_code == 401 and attempt == 0:
            tok = core_client.get_qbo_token(force=True)
            headers["Authorization"] = f"Bearer {tok['access_token']}"
            retry_resp = httpx.request(method.upper(), url, headers=headers, content=payload, timeout=60)
            if retry_resp.status_code not in (200, 201):
                raise RuntimeError(f"QBO API Error after refresh: {retry_resp.status_code} - {retry_resp.text}")
            return retry_resp.json()

        if resp.status_code in (200, 201):
            return resp.json()

        is_retryable = (
            resp.status_code in (429, 503)
            or "Bandwidth quota exceeded" in resp.text
            or "throttled" in resp.text
        )
        if is_retryable and attempt < MAX_RETRIES:
            last_error = f"QBO API Error: {resp.status_code} - {resp.text}"
            continue

        raise RuntimeError(f"QBO API Error: {resp.status_code} - {resp.text}")

    raise RuntimeError(last_error or "QBO request failed after retries")


def create_time_activity(time_data):
    """Creates a TimeActivity record. Customer/Project handling unchanged
    from the original: sub-customers stand in for "projects" (no paid QBO
    Projects tier), so CustomerRef gets the sub-customer id if one is
    mapped, else the top-level customer id."""
    import json

    total_minutes = hours_to_minutes(time_data["hours"])
    hours, minutes = divmod(total_minutes, 60)
    customer_id_to_use = time_data.get("projectId") or time_data["customerId"]

    payload = {
        "NameOf": "Employee",
        "EmployeeRef": {"value": str(time_data["employeeId"])},
        "CustomerRef": {"value": str(customer_id_to_use)},
        "ItemRef": {"value": str(time_data["serviceItemId"])},
        "TxnDate": time_data["date"],
        "Hours": hours,
        "Minutes": minutes,
        "Description": time_data.get("description") or "",
        "BillableStatus": "Billable" if time_data.get("billable") else "NotBillable",
    }

    response = qbo_request("timeactivity", method="post", payload=json.dumps(payload))
    if response.get("TimeActivity"):
        return response["TimeActivity"]
    raise RuntimeError("Failed to create TimeActivity - no response")
