var SHEETS = {
  pendingJobs: "Pending Jobs",
  approvedJobs: "Approved Jobs",
  pendingTalent: "Pending Talent",
  approvedTalent: "Approved Talent",
  adminApplications: "Admin Applications",
  approvedAdmins: "Approved Admins",
  featuredEmployerApplications: "Featured Employer Applications",
  featuredEmployers: "Featured Employers",
  rejected: "Rejected",
  eventLog: "Event Log",
  localJobActions: "Local Job Actions"
};

var BASE_HEADERS = [
  "id",
  "status",
  "public_visibility",
  "featured",
  "created_at",
  "updated_at",
  "source_type",
  "admin_notes",
  "display_order",
  "source",
  "raw_json"
];

var JOB_HEADERS = BASE_HEADERS.concat([
  "title",
  "organization",
  "apply_url",
  "shared_by",
  "submitter_email",
  "approved_by"
]);

var TALENT_HEADERS = BASE_HEADERS.concat([
  "name",
  "email",
  "current_role",
  "location",
  "approved_by"
]);

var ADMIN_HEADERS = BASE_HEADERS.concat([
  "name",
  "email",
  "profile_url",
  "approved_by"
]);

var FEATURED_EMPLOYER_HEADERS = BASE_HEADERS.concat([
  "organization_name",
  "website",
  "contact_name",
  "work_email",
  "approved_by"
]);

var REJECTED_HEADERS = BASE_HEADERS.concat([
  "rejected_at",
  "rejected_from",
  "rejected_by",
  "reason"
]);

var EVENT_HEADERS = [
  "timestamp",
  "type",
  "job_id",
  "title",
  "organization",
  "source",
  "interaction",
  "target",
  "value",
  "payload_json"
];

var LOCAL_JOB_ACTION_HEADERS = [
  "id",
  "status",
  "created_at",
  "updated_at",
  "actor",
  "operation",
  "payload_json"
];

function doGet(e) {
  return handleRequest_(e, "GET");
}

function doPost(e) {
  return handleRequest_(e, "POST");
}

function handleRequest_(e, method) {
  try {
    var payload = getRequestPayload_(e, method);
    var action = String((payload && payload.action) || "").trim();

    switch (action) {
      case "submitJob":
        return jsonResponse_(submitJob_(payload.payload || payload));
      case "submitTalent":
        return jsonResponse_(submitTalent_(payload.payload || payload));
      case "submitAdminApplication":
        return jsonResponse_(submitAdminApplication_(payload.payload || payload));
      case "submitFeaturedEmployer":
        return jsonResponse_(submitFeaturedEmployer_(payload.payload || payload));
      case "track_event":
        return jsonResponse_(trackEvent_(payload));
      case "queueLocalJobAction":
        requireAdminToken_(payload);
        return jsonResponse_(queueLocalJobAction_(payload));
      case "getLocalJobActions":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("localJobActions", SHEETS.localJobActions, LOCAL_JOB_ACTION_HEADERS));
      case "resolveLocalJobActions":
        requireAdminToken_(payload);
        return jsonResponse_(resolveLocalJobActions_(payload));
      case "exportApprovedJobs":
        return jsonResponse_(exportApprovedJobs_());
      case "getPendingJobs":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("pendingJobs", SHEETS.pendingJobs, JOB_HEADERS));
      case "getPendingTalent":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("pendingTalent", SHEETS.pendingTalent, TALENT_HEADERS));
      case "getPendingFeaturedEmployers":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("pendingFeaturedEmployers", SHEETS.featuredEmployerApplications, FEATURED_EMPLOYER_HEADERS));
      case "getPendingAdminApplications":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("pendingAdminApplications", SHEETS.adminApplications, ADMIN_HEADERS));
      case "getRejected":
        requireAdminToken_(payload);
        return jsonResponse_(buildListResponse_("rejected", SHEETS.rejected, REJECTED_HEADERS));
      case "approveJob":
        requireAdminToken_(payload);
        return jsonResponse_(approveRecord_(SHEETS.pendingJobs, JOB_HEADERS, SHEETS.approvedJobs, JOB_HEADERS, payload.id, "approveJob", payload.approvedBy || "", payload.record || payload.editedRecord || null));
      case "rejectJob":
        requireAdminToken_(payload);
        return jsonResponse_(rejectRecord_(SHEETS.pendingJobs, JOB_HEADERS, payload.id, "rejectJob", payload.reason || "", payload.rejectedBy || ""));
      case "approveTalent":
        requireAdminToken_(payload);
        return jsonResponse_(approveRecord_(SHEETS.pendingTalent, TALENT_HEADERS, SHEETS.approvedTalent, TALENT_HEADERS, payload.id, "approveTalent", payload.approvedBy || "", payload.record || payload.editedRecord || null));
      case "rejectTalent":
        requireAdminToken_(payload);
        return jsonResponse_(rejectRecord_(SHEETS.pendingTalent, TALENT_HEADERS, payload.id, "rejectTalent", payload.reason || "", payload.rejectedBy || ""));
      case "approveFeaturedEmployer":
        requireAdminToken_(payload);
        return jsonResponse_(approveRecord_(SHEETS.featuredEmployerApplications, FEATURED_EMPLOYER_HEADERS, SHEETS.featuredEmployers, FEATURED_EMPLOYER_HEADERS, payload.id, "approveFeaturedEmployer", payload.approvedBy || "", payload.record || payload.editedRecord || null));
      case "rejectFeaturedEmployer":
        requireAdminToken_(payload);
        return jsonResponse_(rejectRecord_(SHEETS.featuredEmployerApplications, FEATURED_EMPLOYER_HEADERS, payload.id, "rejectFeaturedEmployer", payload.reason || "", payload.rejectedBy || ""));
      case "approveAdminApplication":
        requireAdminToken_(payload);
        return jsonResponse_(approveRecord_(SHEETS.adminApplications, ADMIN_HEADERS, SHEETS.approvedAdmins, ADMIN_HEADERS, payload.id, "approveAdminApplication", payload.approvedBy || "", payload.record || payload.editedRecord || null));
      case "rejectAdminApplication":
        requireAdminToken_(payload);
        return jsonResponse_(rejectRecord_(SHEETS.adminApplications, ADMIN_HEADERS, payload.id, "rejectAdminApplication", payload.reason || "", payload.rejectedBy || ""));
      default:
        return jsonResponse_(errorResponse_("Invalid action."));
    }
  } catch (error) {
    return jsonResponse_(errorResponse_(error && error.message ? error.message : "Unknown error."));
  }
}

function submitJob_(payload) {
  var normalized = normalizeSubmission_(payload, {
    source: "job_submission",
    status: "pending"
  });
  appendRecord_(SHEETS.pendingJobs, JOB_HEADERS, toJobRow_(normalized));
  return successResponse_("submitJob", normalized.id);
}

function submitTalent_(payload) {
  var normalized = normalizeSubmission_(payload, {
    source: "talent_submission",
    status: "pending"
  });
  appendRecord_(SHEETS.pendingTalent, TALENT_HEADERS, toTalentRow_(normalized));
  return successResponse_("submitTalent", normalized.id);
}

function submitAdminApplication_(payload) {
  var normalized = normalizeSubmission_(payload, {
    source: "admin_application",
    status: "pending"
  });
  appendRecord_(SHEETS.adminApplications, ADMIN_HEADERS, toAdminRow_(normalized));
  return successResponse_("submitAdminApplication", normalized.id);
}

function submitFeaturedEmployer_(payload) {
  var normalized = normalizeSubmission_(payload, {
    source: "featured_employer_application",
    status: "pending"
  });
  appendRecord_(SHEETS.featuredEmployerApplications, FEATURED_EMPLOYER_HEADERS, toFeaturedEmployerRow_(normalized));
  return successResponse_("submitFeaturedEmployer", normalized.id);
}

function trackEvent_(payload) {
  var eventPayload = payload || {};
  appendRecord_(SHEETS.eventLog, EVENT_HEADERS, [
    String(eventPayload.timestamp || new Date().toISOString()),
    String(eventPayload.type || ""),
    String(eventPayload.job_id || ""),
    String(eventPayload.title || ""),
    String(eventPayload.organization || ""),
    String(eventPayload.source || ""),
    String(eventPayload.interaction || ""),
    String(eventPayload.target || ""),
    String(eventPayload.value || ""),
    JSON.stringify(eventPayload)
  ]);
  return {
    ok: true,
    type: "track_event"
  };
}

function queueLocalJobAction_(payload) {
  var now = new Date().toISOString();
  var id = Utilities.getUuid();
  appendRecord_(SHEETS.localJobActions, LOCAL_JOB_ACTION_HEADERS, [
    id,
    "queued",
    now,
    now,
    String(payload.actor || payload.approvedBy || "Admin Review Console"),
    String(payload.operation || ""),
    JSON.stringify(payload)
  ]);
  return {
    ok: true,
    type: "queueLocalJobAction",
    id: id
  };
}

function resolveLocalJobActions_(payload) {
  var ids = payload && payload.ids;
  var statusById = payload && payload.status_by_id;
  if (Object.prototype.toString.call(ids) !== "[object Array]" || !ids.length) {
    throw new Error("Missing ids.");
  }
  var sheet = ensureSheet_(SHEETS.localJobActions, LOCAL_JOB_ACTION_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, type: "resolveLocalJobActions", resolved: 0 };
  var resolved = 0;
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var row = values[rowIndex];
    var actionId = String(row[0] || "");
    if (ids.indexOf(actionId) === -1) continue;
    var nextStatus = statusById && typeof statusById === "object" ? String(statusById[actionId] || "applied") : "applied";
    sheet.getRange(rowIndex + 1, 2).setValue(nextStatus);
    sheet.getRange(rowIndex + 1, 4).setValue(new Date().toISOString());
    resolved += 1;
  }
  return {
    ok: true,
    type: "resolveLocalJobActions",
    resolved: resolved
  };
}

function exportApprovedJobs_() {
  var items = getSheetRecords_(SHEETS.approvedJobs, JOB_HEADERS);
  var jobs = items.map(function(record) {
    var raw = parseRawJson_(record.raw_json);
    var display = raw.display || {};
    var createdAt = String(record.created_at || raw.created_at || raw.date_added || new Date().toISOString());
    var updatedAt = String(record.updated_at || raw.updated_at || raw.date_updated || createdAt);

    return {
      id: String(raw.id || record.id || ""),
      ref: String(raw.ref || ""),
      external_id: String(raw.external_id || raw.externalId || ""),
      source_id: String(raw.source_id || raw.sourceId || ""),
      source_type: String(raw.source_type || raw.sourceType || ""),
      title: String(display.title || raw.title || record.title || ""),
      organization: String(display.organization || raw.organization || record.organization || ""),
      location: String(display.location || raw.location || "Remote"),
      workplace_type: String(display.location_type || raw.workplace_type || raw.workplaceType || ""),
      job_type: String(display.role_type || raw.job_type || raw.jobType || "Full-time"),
      salary: String(display.pay_display || raw.salary || ""),
      raw_salary: String(raw.raw_salary || raw.salary || display.pay_display || ""),
      salary_min: display.salary_min || raw.salary_min || null,
      salary_max: display.salary_max || raw.salary_max || null,
      salary_currency: String(raw.salary_currency || "Unknown"),
      salary_period: String(raw.salary_period || "Unknown"),
      salary_visible: typeof raw.salary_visible === "boolean" ? raw.salary_visible : Boolean(display.pay_display || raw.salary),
      sector: String(display.sector || raw.sector || "general"),
      function: String(display["function"] || raw["function"] || raw.role_function || ""),
      experience: String(display.experience_level || raw.experience || ""),
      source: String(display.source_name || raw.source || record.source || "Manual"),
      source_url: String(display.source_url || raw.source_url || raw.sourceUrl || ""),
      apply_url: String(display.application_url || raw.apply_url || record.apply_url || ""),
      shared_by: String(raw.shared_by || record.shared_by || ""),
      description: String(display.description || raw.description || ""),
      tags: normalizeTags_(display.tags || raw.tags),
      featured: raw.featured === true || String(record.featured).toLowerCase() === "true",
      status: "published",
      date_posted: String(display.date_collected || raw.date_posted || raw.datePosted || createdAt).slice(0, 10),
      date_added: String(raw.date_added || raw.dateAdded || createdAt),
      date_updated: updatedAt,
      approved_by: String(record.approved_by || raw.approved_by || raw.approvedBy || ""),
      notes: String(raw.notes || ""),
      public_visibility: String(record.public_visibility).toLowerCase() === "true" || raw.public_visibility === true,
      display_order: Number(record.display_order || raw.display_order || 0)
    };
  });

  return {
    ok: true,
    type: "exportApprovedJobs",
    jobs: jobs
  };
}

function approveRecord_(fromSheetName, fromHeaders, toSheetName, toHeaders, id, actionType, approvedBy, editedRecord) {
  if (!id) throw new Error("Missing id.");
  var removed = removeRowById_(fromSheetName, fromHeaders, id);
  if (!removed) throw new Error("Record not found: " + id);

  var record = rowToObject_(removed.headers, removed.values);
  var raw = parseRawJson_(record.raw_json);
  if (editedRecord) {
    raw = mergeObjects_(raw, editedRecord);
    record.raw_json = JSON.stringify(raw);
  }
  record.status = String((editedRecord && editedRecord.status) || raw.status || "published");
  record.public_visibility = (editedRecord && typeof editedRecord.public_visibility === "boolean")
    ? editedRecord.public_visibility
    : true;
  record.featured = (editedRecord && typeof editedRecord.featured === "boolean")
    ? editedRecord.featured
    : false;
  record.display_order = String((editedRecord && editedRecord.display_order) || raw.display_order || "0");
  record.admin_notes = String((editedRecord && editedRecord.admin_notes) || raw.admin_notes || "");
  record.updated_at = new Date().toISOString();
  record.approved_by = String(approvedBy || "");

  appendRecord_(toSheetName, toHeaders, objectToRow_(record, toHeaders));
  return successResponse_(actionType, id);
}

function rejectRecord_(fromSheetName, fromHeaders, id, actionType, reason, rejectedBy) {
  if (!id) throw new Error("Missing id.");
  var removed = removeRowById_(fromSheetName, fromHeaders, id);
  if (!removed) throw new Error("Record not found: " + id);

  var record = rowToObject_(removed.headers, removed.values);
  record.status = "rejected";
  record.updated_at = new Date().toISOString();

  appendRecord_(SHEETS.rejected, REJECTED_HEADERS, [
    record.id || "",
    record.status,
    record.created_at || "",
    record.updated_at || "",
    record.source || "",
    record.raw_json || JSON.stringify(record),
    record.updated_at,
    fromSheetName,
    String(rejectedBy || ""),
    String(reason || "")
  ]);

  return successResponse_(actionType, id);
}

function buildListResponse_(type, sheetName, headers) {
  return {
    ok: true,
    type: type,
    items: getSheetRecords_(sheetName, headers)
  };
}

function getSheetRecords_(sheetName, headers) {
  var sheet = ensureSheet_(sheetName, headers);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var sheetHeaders = values[0];

  return values.slice(1).filter(function(row) {
    return String(row[0] || "").trim() !== "";
  }).map(function(row) {
    return rowToObject_(sheetHeaders, row);
  });
}

function normalizeSubmission_(payload, options) {
  var now = new Date().toISOString();
  var rawPayload = payload || {};
  var id = String(rawPayload.id || "").trim() || Utilities.getUuid();

  return {
    id: id,
    status: String(options.status || rawPayload.status || "pending"),
    public_visibility: rawPayload.public_visibility === true,
    featured: rawPayload.featured === true,
    created_at: String(rawPayload.created_at || rawPayload.createdAt || rawPayload.date_added || rawPayload.submitted_at || now),
    updated_at: now,
    source_type: String(rawPayload.source_type || options.sourceType || "manual"),
    admin_notes: String(rawPayload.admin_notes || ""),
    display_order: String(rawPayload.display_order || "0"),
    source: String(options.source || rawPayload.source || "manual"),
    raw_json: JSON.stringify(rawPayload),
    payload: rawPayload
  };
}

function toJobRow_(record) {
  var payload = record.payload || parseRawJson_(record.raw_json);
  return [
    record.id,
    record.status,
    record.public_visibility,
    record.featured,
    record.created_at,
    record.updated_at,
    record.source_type,
    record.admin_notes,
    record.display_order,
    record.source,
    record.raw_json,
    String(payload.title || ""),
    String(payload.organization || ""),
    String(payload.apply_url || ""),
    String(payload.shared_by || ""),
    String(payload.submitter_email || ""),
    String(payload.approved_by || "")
  ];
}

function toTalentRow_(record) {
  var payload = record.payload || parseRawJson_(record.raw_json);
  return [
    record.id,
    record.status,
    record.public_visibility,
    record.featured,
    record.created_at,
    record.updated_at,
    record.source_type,
    record.admin_notes,
    record.display_order,
    record.source,
    record.raw_json,
    String(payload.name || ""),
    String(payload.email || ""),
    String(payload.current_role || ""),
    String(payload.location || ""),
    String(payload.approved_by || "")
  ];
}

function toAdminRow_(record) {
  var payload = record.payload || parseRawJson_(record.raw_json);
  return [
    record.id,
    record.status,
    record.public_visibility,
    record.featured,
    record.created_at,
    record.updated_at,
    record.source_type,
    record.admin_notes,
    record.display_order,
    record.source,
    record.raw_json,
    String(payload.name || ""),
    String(payload.email || ""),
    String(payload.profile_url || ""),
    String(payload.approved_by || "")
  ];
}

function toFeaturedEmployerRow_(record) {
  var payload = record.payload || parseRawJson_(record.raw_json);
  return [
    record.id,
    record.status,
    record.public_visibility,
    record.featured,
    record.created_at,
    record.updated_at,
    record.source_type,
    record.admin_notes,
    record.display_order,
    record.source,
    record.raw_json,
    String(payload.organization_name || ""),
    String(payload.website || ""),
    String(payload.contact_name || ""),
    String(payload.work_email || ""),
    String(payload.approved_by || "")
  ];
}

function appendRecord_(sheetName, headers, row) {
  var sheet = ensureSheet_(sheetName, headers);
  sheet.appendRow(row);
}

function ensureSheet_(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    var mismatch = headers.some(function(header, index) {
      return String(existingHeaders[index] || "") !== header;
    });
    if (mismatch) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function removeRowById_(sheetName, headers, id) {
  var sheet = ensureSheet_(sheetName, headers);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var sheetHeaders = values[0];

  for (var index = 1; index < values.length; index += 1) {
    var row = values[index];
    if (String(row[0] || "").trim() === id) {
      sheet.deleteRow(index + 1);
      return {
        headers: sheetHeaders,
        values: row
      };
    }
  }
  return null;
}

function rowToObject_(headers, row) {
  var obj = {};
  headers.forEach(function(header, index) {
    obj[header] = row[index];
  });
  return obj;
}

function objectToRow_(obj, headers) {
  return headers.map(function(header) {
    return obj[header] || "";
  });
}

function parseRawJson_(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function mergeObjects_(base, override) {
  var next = {};
  var source = base || {};
  Object.keys(source).forEach(function(key) {
    next[key] = source[key];
  });
  Object.keys(override || {}).forEach(function(key) {
    var value = override[key];
    if (value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]") {
      next[key] = mergeObjects_(next[key] || {}, value);
    } else {
      next[key] = value;
    }
  });
  return next;
}

function normalizeTags_(value) {
  if (Object.prototype.toString.call(value) === "[object Array]") {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(function(item) {
      return String(item || "").trim();
    }).filter(Boolean);
  }
  return [];
}

function requireAdminToken_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN");
  if (!expected) {
    throw new Error("Missing ADMIN_TOKEN script property.");
  }
  var received = String((payload && (payload.token || payload.adminToken || payload.admin_token)) || "").trim();
  if (!received || received !== expected) {
    throw new Error("Unauthorized.");
  }
}

function getRequestPayload_(e, method) {
  if (method === "POST") {
    var params = (e && e.parameter) || {};
    if (!e || !e.postData || !e.postData.contents) {
      if (params && Object.keys(params).length) return params;
      throw new Error("Missing request body.");
    }

    var raw = String(e.postData.contents || "");
    if (!raw.trim()) {
      if (params && Object.keys(params).length) return params;
      throw new Error("Missing request body.");
    }

    try {
      return JSON.parse(raw);
    } catch (_error) {
      if (params && Object.keys(params).length) return params;
      return {
        action: "",
        payload: raw
      };
    }
  }
  return (e && e.parameter) || {};
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function successResponse_(type, id) {
  return {
    ok: true,
    type: type,
    id: id
  };
}

function errorResponse_(message) {
  return {
    ok: false,
    error: String(message || "Unknown error.")
  };
}
