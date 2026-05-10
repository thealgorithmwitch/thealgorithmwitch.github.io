const path = require("path");
const {
  ADMIN_JOB_ACTIONS_SNAPSHOT_FILE,
  PENDING_SYNCED_FILE,
  readJson,
  readJobs,
  readPendingSyncedJobs,
  writeJson
} = require("./job-utils");
const {
  buildJobRecord,
  readJobRecords,
  JOB_RECORDS_FILE,
  TALENT_PROFILES_FILE,
  EMPLOYERS_FILE
} = require("./public-records");
const {
  applyPublishLifecycle
} = require("./lifecycle-utils");
const {
  buildDescriptionSnippet,
  buildFallbackDescription,
  getParserCleanupStats,
  hasMalformedDescriptionTemplate,
  hasUsableDescription,
  normalizeJob,
  normalizeDescription,
  resetParserCleanupStats,
  stringifySafe
} = require("./job-normalizer");
const {
  loadBackendConfig,
  readAdminActionSnapshot,
  readLocalAdminActions,
  readOrganizationRules,
  readPendingOverrides,
  writeAdminActionSnapshot,
  writeLocalAdminActions,
  writeOrganizationRules,
  writePendingOverrides
} = require("./admin-actions-store");
const { buildPagesForSelectedJobs, buildPagesFromJobs } = require("./generate-job-pages");
const { buildPublicJobsFromRecords, syncPublicJobsFromRecords } = require("./public-jobs");
const { getCanonicalSnippet, isJunkDescription } = require("./public-data-guard");
const { buildValidationReport } = require("./validate-public-data");

function buildPublishedDisplay(job) {
  return {
    title: stringifySafe(job.title),
    organization: stringifySafe(job.organization),
    location: stringifySafe(job.location),
    location_type: stringifySafe(job.workplace_type),
    pay_display: stringifySafe(job.salary),
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    role_type: stringifySafe(job.job_type),
    experience_level: stringifySafe(job.experience),
    sector: stringifySafe(job.sector),
    function: stringifySafe(job.function),
    specialization: stringifySafe(job.specialization),
    specialization_confidence: stringifySafe(job.specialization_confidence || "low"),
    tags: Array.isArray(job.tags) ? job.tags : [],
    description: stringifySafe(job.description),
    source_name: stringifySafe(job.source),
    source_url: stringifySafe(job.source_url),
    original_url: stringifySafe(job.original_url),
    date_collected: stringifySafe(job.date_posted),
    application_url: stringifySafe(job.apply_url),
    page_url_override: stringifySafe(job.page_url_override),
    published: true,
    featured: Boolean(job.featured)
  };
}

function buildDescriptionCandidate(job = {}) {
  return [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary
  ].filter(Boolean).join(" ");
}

function excerptForLog(value, maxLength = 180) {
  const text = stringifySafe(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function getSelectedJobJunkReasons(description, snippet, context = {}) {
  const reasons = [];
  const descriptionText = stringifySafe(description);
  const snippetText = stringifySafe(snippet);
  const title = stringifySafe(context.title);
  const organization = stringifySafe(context.organization);

  const patternReasons = [
    { pattern: /\bprevious\b/i, reason: "contains_previous_navigation" },
    { pattern: /\bnext post\b/i, reason: "contains_next_post_navigation" },
    { pattern: /\bviewBox\b/i, reason: "contains_svg_fragment" },
    { pattern: /\b0\/svg\b/i, reason: "contains_svg_path_fragment" },
    { pattern: /\bPOINT\s*\(/i, reason: "contains_point_metadata" },
    { pattern: /\blocality\b/i, reason: "contains_locality_metadata" },
    { pattern: /\b(?:taxonomy|valuation|headquarters|employee size|funding|revenue)\b/i, reason: "contains_metadata_blob" },
    { pattern: /\bTitle Business(?: Platform Location Date)?\b/i, reason: "contains_table_header_junk" }
  ];

  if (!descriptionText) reasons.push("missing_description");
  if (!snippetText) reasons.push("missing_snippet");
  if (hasMalformedDescriptionTemplate(descriptionText)) reasons.push("malformed_template_text");
  if (isJunkDescription(descriptionText)) reasons.push("junk_description_pattern");
  if (!hasUsableDescription(descriptionText, { title, organization })) reasons.push("unusable_description");
  if (isJunkDescription(snippetText)) reasons.push("junk_snippet_pattern");

  patternReasons.forEach(({ pattern, reason }) => {
    if (pattern.test(descriptionText) || pattern.test(snippetText)) reasons.push(reason);
  });

  return Array.from(new Set(reasons));
}

function sanitizePublishSelectedJob(job = {}) {
  const title = stringifySafe(job.title);
  const organization = stringifySafe(job.organization);
  const beforeDescription = stringifySafe(job.description || job.raw_description);
  const beforeSnippet = stringifySafe(job.description_snippet || job.summary);
  const normalizedDescription = normalizeDescription(buildDescriptionCandidate(job), {
    title,
    organization
  }).description;
  let cleanDescription = normalizedDescription;
  if (!cleanDescription || hasMalformedDescriptionTemplate(cleanDescription) || !hasUsableDescription(cleanDescription, { title, organization })) {
    cleanDescription = buildFallbackDescription({
      ...job,
      title,
      organization
    });
  }
  if (!cleanDescription || isJunkDescription(cleanDescription) || hasMalformedDescriptionTemplate(cleanDescription) || !hasUsableDescription(cleanDescription, { title, organization })) {
    cleanDescription = buildFallbackDescription({
      ...job,
      title,
      organization,
      function: stringifySafe(job.function || job.sector || "its work")
    }) || `This role supports ${organization ? `${organization}${organization.endsWith("s") ? "'" : "'s"}` : "the organization's"} work across ${stringifySafe(job.function || job.sector || "its focus areas")}.`;
  }
  let cleanSnippet = buildDescriptionSnippet(cleanDescription, 220, { title });
  if (!cleanSnippet || isJunkDescription(cleanSnippet) || hasMalformedDescriptionTemplate(cleanSnippet)) {
    cleanSnippet = cleanDescription;
  }
  const dirtyReasons = [];
  const dirtyDescription =
    !beforeDescription ||
    !hasUsableDescription(beforeDescription, { title, organization }) ||
    isJunkDescription(beforeDescription) ||
    hasMalformedDescriptionTemplate(beforeDescription);
  if (dirtyDescription) {
    dirtyReasons.push("junk_description");
  }
  if (
    !beforeSnippet ||
    isJunkDescription(beforeSnippet) ||
    hasMalformedDescriptionTemplate(beforeSnippet) ||
    !getCanonicalSnippet({ title, description: beforeDescription, description_snippet: beforeSnippet, summary: beforeSnippet }) ||
    (dirtyDescription && beforeSnippet !== cleanSnippet)
  ) {
    dirtyReasons.push("invalid_snippet");
  }
  const remainingJunkReasons = getSelectedJobJunkReasons(cleanDescription, cleanSnippet, { title, organization });
  return {
    job: {
      ...job,
      description: cleanDescription,
      raw_description: cleanDescription,
      description_snippet: cleanSnippet,
      summary: cleanSnippet
    },
    dirtyReasons,
    remainingJunkReasons,
    before: {
      description: beforeDescription,
      snippet: beforeSnippet
    },
    after: {
      description: cleanDescription,
      snippet: cleanSnippet
    }
  };
}

function upsertJobRecord(records, pendingJob, status, options = {}) {
  const normalized = normalizeJob(pendingJob);
  const existingIndex = records.findIndex((record) => String(record.id) === String(normalized.id));
  const existing = existingIndex >= 0 ? records[existingIndex] : {};
  const manualFields = new Set([
    "title",
    "organization",
    "location",
    "location_type",
    "pay_display",
    "salary_min",
    "salary_max",
    "specialization",
    "description",
    "source_url",
    "original_url",
    "application_url",
    "page_url_override"
  ]);
  let next = buildJobRecord({ ...normalized, status }, existing, { context: "admin_publish", manualFields });
  next.display = {
    ...(next.display || {}),
    ...buildPublishedDisplay(normalized),
    featured: options.featured === true || Boolean(normalized.featured)
  };
  next.featured = options.featured === true || Boolean(normalized.featured);
  next.admin_notes = stringifySafe(options.admin_notes || existing.admin_notes || "");
  if (status === "published") {
    next.status = "published";
    next.published = true;
    next.public_visibility = true;
    next = applyPublishLifecycle(next);
  } else {
    next.status = status;
    next.published = false;
    next.public_visibility = false;
    next.verification_status = status === "rejected" ? "removed" : "needs_review";
    next.stale_reason = options.stale_reason || "";
  }
  if (existingIndex >= 0) {
    records[existingIndex] = next;
  } else {
    records.push(next);
  }
}

function removePendingByIds(pendingJobs, ids) {
  const idSet = new Set(ids.map(String));
  return pendingJobs.filter((job) => !idSet.has(String(job.id)));
}

function applyPendingJobMutations(pendingJobs, ids, mutator) {
  const idSet = new Set(ids.map(String));
  return pendingJobs.map((job) => (idSet.has(String(job.id)) ? mutator(job) : job));
}

function parseQueuedActions(actions) {
  return actions
    .filter((item) => String(item.status || "").toLowerCase() === "queued")
    .map((item) => ({
      id: String(item.id || ""),
      operation: String(item.operation || ""),
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || ""),
      source: String(item.source || ""),
      payload: (() => {
        try {
          return JSON.parse(item.payload_json || "{}");
        } catch (_error) {
          return {};
        }
      })()
    }));
}

function parseActionTimestamp(action) {
  const updatedAt = Date.parse(String(action?.updated_at || ""));
  if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;
  const createdAt = Date.parse(String(action?.created_at || ""));
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
  const payloadTimestamp = Date.parse(String(action?.payload?.timestamp || ""));
  if (Number.isFinite(payloadTimestamp) && payloadTimestamp > 0) return payloadTimestamp;
  return 0;
}

function actionPrecedence(operation) {
  if (operation === "archive_selected" || operation === "archive_active_job") return 4;
  if (operation === "reject_all_from_organization") return 4;
  if (operation === "unpublish_active_job") return 3;
  if (operation === "publish_selected") return 2;
  return 1;
}

function getActionTargetIds(action) {
  const ids = Array.isArray(action?.payload?.ids) ? action.payload.ids.map(String).filter(Boolean) : [];
  if (ids.length) return ids;
  const singleId = String(action?.payload?.id || action?.payload?.recordId || "").trim();
  if (singleId) return [singleId];
  const payloadJobIds = Array.isArray(action?.payload?.jobs)
    ? action.payload.jobs.map((job) => String(job?.id || "")).filter(Boolean)
    : [];
  return payloadJobIds;
}

function latestQueuedTimestamp(actions) {
  return actions.reduce((max, action) => Math.max(max, parseActionTimestamp(action)), 0);
}

function updateActionStatuses(actions, resultsById) {
  if (!Array.isArray(actions)) return [];
  const ids = new Set(Object.keys(resultsById || {}).map(String));
  const now = new Date().toISOString();
  return actions.map((action) => {
    const actionId = String(action.id || "");
    if (!ids.has(actionId)) return action;
    const result = resultsById[actionId] || {};
    return {
      ...action,
      status: String(result.status || "applied"),
      updated_at: now
    };
  });
}

async function resolveSnapshotActions(resultsById, actions) {
  try {
    await writeAdminActionSnapshot(updateActionStatuses(actions, resultsById));
    console.log(`[jobs:apply-admin-actions] resolve snapshot ids=${Object.keys(resultsById || {}).join(",")}`);
  } catch (error) {
    console.warn(`[jobs:apply-admin-actions] snapshot cleanup warning: ${error.message}`);
  }
}

function logActionOutcome(action, source, outcome, detail) {
  console.log(
    `[jobs:apply-admin-actions] action_id=${String(action.id || "")} operation=${String(action.operation || "")} created_at=${String(action.created_at || "")} source=${source} outcome=${outcome}${detail ? ` detail=${detail}` : ""}`
  );
}

function isPublishedRecord(record) {
  return Boolean(
    record &&
    record.record_type === "job" &&
    String(record.status || "").toLowerCase() === "published" &&
    record.published === true
  );
}

function isPublishedStructuredRecord(record) {
  return Boolean(
    record &&
    String(record.status || "").toLowerCase() === "published" &&
    record.published === true &&
    record.public_visibility === true
  );
}

function findRecordById(records, id) {
  return records.find((record) => String(record.id) === String(id));
}

function updateJobDisplayFromEditedRecord(record, editedRecord = {}) {
  const next = { ...record };
  const display = {
    ...(record.display || {}),
    ...((editedRecord.display && typeof editedRecord.display === "object") ? editedRecord.display : {})
  };
  const now = new Date().toISOString();

  next.display = display;
  if (typeof editedRecord.featured === "boolean") {
    next.featured = editedRecord.featured;
    next.display.featured = editedRecord.featured;
  }
  if (typeof editedRecord.public_visibility === "boolean") {
    next.public_visibility = editedRecord.public_visibility;
  }
  if (typeof editedRecord.published === "boolean") {
    next.published = editedRecord.published;
    next.display.published = editedRecord.published;
  }
  if (editedRecord.status) next.status = String(editedRecord.status);
  if (editedRecord.admin_notes !== undefined) next.admin_notes = stringifySafe(editedRecord.admin_notes);
  if (editedRecord.display_order !== undefined) {
    const displayOrder = Number(editedRecord.display_order || 0);
    next.display_order = Number.isFinite(displayOrder) ? displayOrder : 0;
  }
  const manualOverrides = new Set(
    []
      .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
      .concat(Array.isArray(record.protected_fields) ? record.protected_fields : [])
  );
  if (editedRecord.display && typeof editedRecord.display === "object") {
    Object.keys(editedRecord.display).forEach((key) => {
      manualOverrides.add(`display.${key}`);
      if (["title", "organization", "location", "workplace_type", "salary", "description"].includes(key)) {
        const rawKey = key === "workplace_type" ? "workplace_type" : key === "salary" ? "salary" : key;
        manualOverrides.add(`raw_source_data.${rawKey}`);
      }
      if (key === "location_type") manualOverrides.add("raw_source_data.workplace_type");
      if (key === "pay_display") manualOverrides.add("raw_source_data.salary");
    });
  }
  next.manual_overrides = Array.from(manualOverrides);
  next.updated_at = now;
  next.last_manual_edit_at = now;
  next.field_meta = {
    ...(record.field_meta && typeof record.field_meta === "object" ? record.field_meta : {})
  };
  if (editedRecord.display && typeof editedRecord.display === "object") {
    Object.keys(editedRecord.display).forEach((key) => {
      next.field_meta[key] = {
        ...(next.field_meta[key] || {}),
        last_manual_edit_at: now,
        last_value: stringifySafe(editedRecord.display[key]),
        conflict: false
      };
    });
  }

  if (String(next.status || "").toLowerCase() === "published" && next.published && next.public_visibility) {
    return applyPublishLifecycle(next);
  }

  return {
    ...next,
    verification_status: String(next.verification_status || "needs_review"),
    verification_method: String(next.verification_method || "manual")
  };
}

function updateStructuredRecord(record, editedRecord = {}) {
  const next = {
    ...record,
    ...editedRecord,
    updated_at: new Date().toISOString()
  };
  if (editedRecord.display_order !== undefined) {
    const displayOrder = Number(editedRecord.display_order || 0);
    next.display_order = Number.isFinite(displayOrder) ? displayOrder : 0;
  }
  if (typeof editedRecord.featured === "boolean") next.featured = editedRecord.featured;
  if (typeof editedRecord.public_visibility === "boolean") next.public_visibility = editedRecord.public_visibility;
  if (typeof editedRecord.published === "boolean") next.published = editedRecord.published;
  if (editedRecord.admin_notes !== undefined) next.admin_notes = stringifySafe(editedRecord.admin_notes);
  return next;
}

function parseTimestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneStructuredValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneStructuredValue(item));
  if (value && typeof value === "object") return JSON.parse(JSON.stringify(value));
  return value;
}

function isStructuredBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !String(value).trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function structuredValuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function serializeStructuredFieldValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  return stringifySafe(value);
}

function mergeStructuredRecord(record, editedRecord = {}, options = {}) {
  const now = new Date().toISOString();
  const actionTimestamp = parseTimestampMs(options.actionTimestamp || "");
  const next = {
    ...record,
    updated_at: now
  };
  const fieldMeta = {
    ...(record.field_meta && typeof record.field_meta === "object" ? record.field_meta : {})
  };
  const manualOverrides = new Set(
    []
      .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
      .concat(Array.isArray(record.protected_fields) ? record.protected_fields : [])
  );

  if (editedRecord.display_order !== undefined) {
    const displayOrder = Number(editedRecord.display_order || 0);
    next.display_order = Number.isFinite(displayOrder) ? displayOrder : 0;
  }
  if (typeof editedRecord.featured === "boolean") next.featured = editedRecord.featured;
  if (typeof editedRecord.public_visibility === "boolean") next.public_visibility = editedRecord.public_visibility;
  if (typeof editedRecord.published === "boolean") next.published = editedRecord.published;
  if (editedRecord.status !== undefined && stringifySafe(editedRecord.status)) next.status = String(editedRecord.status);
  if (editedRecord.admin_notes !== undefined) next.admin_notes = stringifySafe(editedRecord.admin_notes);

  Object.entries(editedRecord || {}).forEach(([key, incomingValue]) => {
    if (["display_order", "featured", "public_visibility", "published", "status", "admin_notes"].includes(key)) return;
    const existingValue = record ? record[key] : undefined;
    const existingMeta = fieldMeta[key] && typeof fieldMeta[key] === "object" ? fieldMeta[key] : {};
    const existingManualAt = parseTimestampMs(existingMeta.last_manual_edit_at || record?.last_manual_edit_at);
    const incomingBlank = isStructuredBlank(incomingValue);
    const differs = !structuredValuesEqual(existingValue, incomingValue);

    if (incomingBlank && !isStructuredBlank(existingValue)) return;
    if (actionTimestamp > 0 && existingManualAt > actionTimestamp && differs) return;

    next[key] = cloneStructuredValue(incomingValue);
    manualOverrides.add(key);
    fieldMeta[key] = {
      ...existingMeta,
      last_manual_edit_at: now,
      last_value: serializeStructuredFieldValue(incomingValue),
      conflict: false
    };
  });

  next.manual_overrides = Array.from(manualOverrides);
  next.field_meta = fieldMeta;
  next.last_manual_edit_at = now;
  return next;
}

function updateRecordListById(records, id, updater) {
  const index = records.findIndex((record) => String(record.id) === String(id));
  if (index < 0) return false;
  records[index] = updater(records[index]);
  return true;
}

function buildActionResult(status, detail) {
  return {
    status,
    detail: detail || ""
  };
}

function logScopedPublishFailures(diagnostics = []) {
  diagnostics.forEach((item) => {
    console.error(
      `[jobs:apply-admin-actions] scoped_publish_dirty_job id=${String(item.id || "")} title=${JSON.stringify(stringifySafe(item.title))} company=${JSON.stringify(stringifySafe(item.organization))} junk_description_reason=${JSON.stringify((item.remaining_dirty_reasons || item.dirty_reasons || []).join(","))} before_description_excerpt=${JSON.stringify(excerptForLog(item.before?.description || ""))} before_snippet_excerpt=${JSON.stringify(excerptForLog(item.before?.snippet || ""))}`
    );
  });
}

function buildJobsById(jobs) {
  const map = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    const id = String(job?.id || "").trim();
    if (id) map.set(id, job);
  });
  return map;
}

function flattenActionFields(payload, prefix = "") {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenActionFields(value, nextKey);
    }
    return [nextKey];
  }).sort();
}

function summarizeChangedFields(previousRecord, nextRecord, options = {}) {
  const editedRecord = options.editedRecord && typeof options.editedRecord === "object" ? options.editedRecord : null;
  if (editedRecord) {
    return flattenActionFields(editedRecord);
  }

  const fields = [];
  const previousDisplay = previousRecord && previousRecord.display && typeof previousRecord.display === "object" ? previousRecord.display : {};
  const nextDisplay = nextRecord && nextRecord.display && typeof nextRecord.display === "object" ? nextRecord.display : {};

  ["status", "public_visibility", "featured", "published", "admin_notes", "display_order"].forEach((key) => {
    if (JSON.stringify(previousRecord?.[key]) !== JSON.stringify(nextRecord?.[key])) fields.push(key);
  });
  Object.keys({ ...previousDisplay, ...nextDisplay }).forEach((key) => {
    if (JSON.stringify(previousDisplay[key]) !== JSON.stringify(nextDisplay[key])) fields.push(`display.${key}`);
  });
  return fields.sort();
}

function countPublishedJobs(records) {
  return records.filter(isPublishedRecord).length;
}

async function fetchAndSnapshotActions() {
  const config = await loadBackendConfig(path.join(__dirname, "jobs-backend-config.js"));
  const backendUrl = process.env.JOBS_BACKEND_URL || config.backendUrl;
  const adminToken = process.env.JOBS_ADMIN_TOKEN || config.adminToken;
  const snapshotActions = await readAdminActionSnapshot();
  const localActions = await readLocalAdminActions();
  const snapshotQueued = parseQueuedActions(snapshotActions).map((action) => ({ ...action, source: "snapshot" }));
  const localQueued = parseQueuedActions(localActions).map((action) => ({ ...action, source: "local" }));
  const snapshotLatest = latestQueuedTimestamp(snapshotQueued);
  const localLatest = latestQueuedTimestamp(localQueued);

  if (snapshotQueued.length || localQueued.length) {
    if (snapshotQueued.length && (!localQueued.length || snapshotLatest >= localLatest)) {
      console.log(`[jobs:apply-admin-actions] Source used: snapshot (${snapshotQueued.length} queued actions, newest=${snapshotLatest || 0}).`);
      return {
        actions: snapshotActions,
        backendUrl,
        adminToken,
        source: "snapshot"
      };
    }
    console.log(`[jobs:apply-admin-actions] Source used: local fallback (${localQueued.length} queued actions, newest=${localLatest || 0}; snapshot older or empty).`);
    return {
      actions: localActions,
      backendUrl: "",
      adminToken: "",
      source: "local"
    };
  }

  if (!backendUrl || !adminToken) {
    console.log("[jobs:apply-admin-actions] Source used: local fallback (backend config missing, snapshot empty).");
    return {
      actions: localActions,
      backendUrl: "",
      adminToken: "",
      source: "local"
    };
  }

  console.log("[jobs:apply-admin-actions] Source used: backend queue.");

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "getLocalJobActions",
        token: adminToken,
        adminToken
      })
    });
    const responseText = await response.text();
    let payload = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (_error) {
      payload = {};
    }
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.httpStatus = response.status;
      error.responsePreview = responseText.slice(0, 300);
      throw error;
    }
    return {
      actions: Array.isArray(payload.items) ? payload.items : [],
      backendUrl,
      adminToken,
      source: "backend"
    };
  } catch (error) {
    console.error(`[jobs:apply-admin-actions] HTTP status: ${error.httpStatus || "unknown"}`);
    console.error(`[jobs:apply-admin-actions] Response text preview: ${error.responsePreview || error.message}`);
    console.error("[jobs:apply-admin-actions] Source used: local fallback (backend fetch failed, snapshot empty).");
    return {
      actions: await readLocalAdminActions(),
      backendUrl: "",
      adminToken: "",
      source: "local"
    };
  }
}

async function resolveActions(backendUrl, adminToken, resultsById) {
  const ids = Object.keys(resultsById || {});
  if (!backendUrl || !adminToken || !ids.length) return;
  const statusById = Object.fromEntries(ids.map((id) => [id, String(resultsById[id].status || "applied")]));
  console.log(`[jobs:apply-admin-actions] resolve backend ids=${ids.join(",")} statuses=${JSON.stringify(statusById)}`);
  const response = await fetch(backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "resolveLocalJobActions",
      token: adminToken,
      adminToken,
      ids,
      status_by_id: statusById
    })
  });
  const payload = await response.json().catch(() => ({}));
  console.log(`[jobs:apply-admin-actions] resolve backend status=${response.status} ok=${Boolean(payload.ok)} resolved=${payload.resolved ?? "unknown"}`);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `resolveLocalJobActions failed: HTTP ${response.status}`);
  }
}

async function resolveLocalActions(resultsById, actions) {
  const ids = Object.keys(resultsById || {});
  if (!ids.length) return;
  const idSet = new Set(ids.map(String));
  const now = new Date().toISOString();
  const nextActions = actions.map((action) => {
    const actionId = String(action.id || "");
    if (!idSet.has(actionId)) return action;
    const result = resultsById[actionId] || {};
    return {
      ...action,
      status: String(result.status || "applied"),
      updated_at: now
    };
  });
  await writeLocalAdminActions(nextActions);
  console.log(`[jobs:apply-admin-actions] resolve local ids=${ids.join(",")} statuses=${JSON.stringify(Object.fromEntries(ids.map((id) => [id, resultsById[id]?.status || "applied"])))}`);
}

async function main() {
  resetParserCleanupStats();
  const [pendingJobs, jobRecords, orgRules, overrides, talentProfiles, employers] = await Promise.all([
    readPendingSyncedJobs(),
    readJobRecords(),
    readOrganizationRules(),
    readPendingOverrides(),
    readJson(TALENT_PROFILES_FILE, []),
    readJson(EMPLOYERS_FILE, [])
  ]);
  const fetched = await fetchAndSnapshotActions();
  if (fetched.source === "backend") {
    console.log("[jobs:apply-admin-actions] action source=backend queue");
  } else if (fetched.source === "snapshot") {
    console.log("[jobs:apply-admin-actions] action source=snapshot file");
  } else {
    console.log("[jobs:apply-admin-actions] action source=local action file");
  }
  const actions = parseQueuedActions(fetched.actions);

  if (!actions.length) {
    console.log("[jobs:apply-admin-actions] no actions found");
    return;
  }

  let nextPending = [...pendingJobs];
  const nextRecords = [...jobRecords];
  const nextTalentProfiles = Array.isArray(talentProfiles) ? [...talentProfiles] : [];
  const nextEmployers = Array.isArray(employers) ? [...employers] : [];
  const nextOverrides = { ...(overrides || { jobs: {} }), jobs: { ...((overrides && overrides.jobs) || {}) } };
  const nextOrgRules = {
    hidden_organizations: [...orgRules.hidden_organizations],
    rejected_organizations: [...orgRules.rejected_organizations]
  };

  const report = {
    actionsFound: actions.length,
    recordsPublished: 0,
    recordsArchivedOrRejected: 0,
    recordsLeftPending: 0,
    duplicatesSkipped: 0,
    alreadyPublishedSkipped: 0,
    staleSkipped: 0,
    talentProfilesUpdated: 0,
    jobPagesRegenerated: 0,
    redirectPagesRegenerated: 0,
    jobRecordsCount: 0,
    jobsJsonCount: 0,
    publishSelectedDiagnostics: [],
    scopedPublishQualityReport: null,
    staleSkippedResolvedActions: []
  };

  const actionResults = {};
  const seenActionIds = new Set();
  const initiallyPublishedJobIds = new Set(
    nextRecords
      .filter(isPublishedRecord)
      .map((record) => String(record.id))
  );
  const processedPublishJobIds = new Set();
  const publicScopeIds = new Set();
  let shouldRunPublicSync = false;
  const latestDecisionByJobId = new Map();

  actions.forEach((action) => {
    const timestamp = parseActionTimestamp(action);
    const precedence = actionPrecedence(action.operation);
    getActionTargetIds(action).forEach((id) => {
      const existing = latestDecisionByJobId.get(String(id));
      if (!existing || timestamp > existing.timestamp || (timestamp === existing.timestamp && precedence >= existing.precedence)) {
        latestDecisionByJobId.set(String(id), {
          actionId: String(action.id || ""),
          timestamp,
          precedence,
          operation: String(action.operation || "")
        });
      }
    });
  });

  console.log(`[jobs:apply-admin-actions] actions found=${report.actionsFound}`);

  for (const action of actions) {
    const actionSource = fetched.source;
    const actionTimestamp = parseActionTimestamp(action);
    if (!action.id) {
      console.log("[jobs:apply-admin-actions] skipped action with missing id");
      continue;
    }
    if (seenActionIds.has(action.id)) {
      report.duplicatesSkipped += 1;
      actionResults[action.id] = buildActionResult("ignored_duplicate", "duplicate action id");
      console.log(`[jobs:apply-admin-actions] duplicate action id skipped id=${action.id}`);
      logActionOutcome(action, actionSource, "skipped_stale", "duplicate action id");
      continue;
    }
    seenActionIds.add(action.id);

    const ids = Array.isArray(action.payload.ids) ? action.payload.ids.map(String) : [];
    const targetIds = getActionTargetIds(action);
    const selectedJobs = Array.isArray(action.payload.jobs) ? action.payload.jobs : [];
    if (action.operation === "publish_selected" && !targetIds.length && !selectedJobs.length) {
      actionResults[action.id] = buildActionResult("empty_payload", "publish_selected missing ids and jobs");
      logActionOutcome(action, actionSource, "empty_payload", "publish_selected missing ids and jobs");
      console.warn(
        `[jobs:apply-admin-actions] operation=publish_selected action_id=${action.id} ids_count=${ids.length} jobs_count=${selectedJobs.length} outcome=empty_payload`
      );
      continue;
    }
    const freshIds = targetIds.filter((id) => {
      const latest = latestDecisionByJobId.get(String(id));
      if (!latest) return true;
      return latest.actionId === String(action.id);
    });
    if (targetIds.length && !freshIds.length) {
      actionResults[action.id] = buildActionResult("skipped_stale", "newer decision exists for all targeted job ids");
      logActionOutcome(action, actionSource, "skipped_stale", "newer decision exists");
      continue;
    }
    if (action.operation === "publish_selected") {
      const pendingBefore = nextPending.length;
      const activeBefore = countPublishedJobs(nextRecords);
      const payloadJobsById = buildJobsById(action.payload.jobs);
      const matchingPendingIds = freshIds.filter((id) => nextPending.some((pendingJob) => String(pendingJob.id) === id));
      const missingPendingIds = freshIds.filter((id) => !matchingPendingIds.includes(id));
      console.log(
        `[jobs:apply-admin-actions] operation=publish_selected action_id=${action.id} ids_count=${targetIds.length} jobs_count=${selectedJobs.length} queued_ids_count=${freshIds.length} matching_pending_ids_count=${matchingPendingIds.length} missing_pending_ids_count=${missingPendingIds.length} pending_before=${pendingBefore} active_before=${activeBefore}`
      );
      const uniqueIds = [];
      const idsSeenInAction = new Set();
      let publishedCount = 0;
      let duplicateCount = 0;
      let alreadyPublishedCount = 0;
      let staleCount = 0;
      const publishedIds = [];
      const editedJobsById = new Map(
        (Array.isArray(action.payload.edited_jobs) ? action.payload.edited_jobs : [])
          .filter((item) => item && item.id)
          .map((item) => [String(item.id), item.editedRecord || {}])
      );

      for (const id of freshIds) {
        if (idsSeenInAction.has(id)) {
          duplicateCount += 1;
          continue;
        }
        idsSeenInAction.add(id);
        uniqueIds.push(id);
      }

      for (const id of uniqueIds) {
        const existingRecord = findRecordById(nextRecords, id);
        const recordTimestamp = Date.parse(String(existingRecord?.updated_at || existingRecord?.created_at || "")) || 0;
        if (
          existingRecord &&
          /^(archived|rejected)$/i.test(String(existingRecord.status || "")) &&
          recordTimestamp > actionTimestamp
        ) {
          staleCount += 1;
          continue;
        }
        if ((initiallyPublishedJobIds.has(id) || isPublishedRecord(existingRecord)) && !processedPublishJobIds.has(id)) {
          alreadyPublishedCount += 1;
          processedPublishJobIds.add(String(id));
          publishedIds.push(String(id));
          continue;
        }
        if (processedPublishJobIds.has(id)) {
          duplicateCount += 1;
          publishedIds.push(String(id));
          continue;
        }
        const job = nextPending.find((pendingJob) => String(pendingJob.id) === id) || payloadJobsById.get(String(id));
        if (!job) {
          if (existingRecord && (initiallyPublishedJobIds.has(id) || isPublishedRecord(existingRecord))) {
            alreadyPublishedCount += 1;
            processedPublishJobIds.add(String(id));
            publishedIds.push(String(id));
          } else {
            duplicateCount += 1;
          }
          continue;
        }

        const sanitized = sanitizePublishSelectedJob(job);
        const editedRecord = editedJobsById.get(String(job.id)) || {};
        report.publishSelectedDiagnostics.push({
          id: String(job.id),
          title: stringifySafe(job.title),
          organization: stringifySafe(job.organization),
          dirty_reasons: sanitized.dirtyReasons,
          remaining_dirty_reasons: sanitized.remainingJunkReasons,
          before: sanitized.before,
          after: sanitized.after
        });
        upsertJobRecord(
          nextRecords,
          { ...sanitized.job, featured: Boolean(job.featured) },
          "published",
          {
            featured: typeof editedRecord.featured === "boolean" ? editedRecord.featured : Boolean(job.featured)
          }
        );
        if (Object.keys(editedRecord).length) {
          updateRecordListById(nextRecords, String(job.id), (record) => updateJobDisplayFromEditedRecord(record, editedRecord));
        }
        delete nextOverrides.jobs[String(job.id)];
        processedPublishJobIds.add(String(job.id));
        publicScopeIds.add(String(job.id));
        shouldRunPublicSync = true;
        publishedIds.push(String(job.id));
        report.recordsPublished += 1;
        publishedCount += 1;
      }
      nextPending = removePendingByIds(nextPending, publishedIds);
      report.duplicatesSkipped += duplicateCount;
      report.alreadyPublishedSkipped += alreadyPublishedCount;
      report.staleSkipped += staleCount;
      const pendingAfter = nextPending.length;
      const activeAfter = countPublishedJobs(nextRecords);

      if (publishedCount > 0) {
        actionResults[action.id] = buildActionResult("applied", `published=${publishedCount}`);
        logActionOutcome(action, actionSource, "applied", `published=${publishedCount}`);
      } else if (staleCount > 0) {
        actionResults[action.id] = buildActionResult("skipped_stale", `stale=${staleCount}`);
        logActionOutcome(action, actionSource, "skipped_stale", `newer archived decision exists stale=${staleCount}`);
      } else if (alreadyPublishedCount > 0) {
        actionResults[action.id] = buildActionResult("already_published", `already_published=${alreadyPublishedCount}`);
        logActionOutcome(action, actionSource, "skipped_newer_decision", `already_published=${alreadyPublishedCount}`);
      } else if (duplicateCount > 0) {
        actionResults[action.id] = buildActionResult("ignored_duplicate", `duplicates=${duplicateCount}`);
        logActionOutcome(action, actionSource, "skipped_stale", `duplicates=${duplicateCount}`);
      } else {
        actionResults[action.id] = buildActionResult("ignored_duplicate", "no publishable jobs found");
        logActionOutcome(action, actionSource, "skipped_stale", "no publishable jobs found");
      }

      console.log(
        `[jobs:apply-admin-actions] operation=publish_selected action_id=${action.id} ids_count=${targetIds.length} jobs_count=${selectedJobs.length} queued_ids_count=${uniqueIds.length} matching_pending_ids_count=${matchingPendingIds.length} missing_pending_ids_count=${missingPendingIds.length} pending_after=${pendingAfter} active_after=${activeAfter} published_count=${publishedCount} skipped_stale_count=${staleCount} already_published_count=${alreadyPublishedCount} duplicates_skipped_count=${duplicateCount} removed_from_pending=${publishedIds.length}`
      );
    } else if (action.operation === "archive_selected") {
      const pendingSelection = nextPending.filter((job) => freshIds.includes(String(job.id)));
      for (const job of pendingSelection) {
        upsertJobRecord(nextRecords, job, "archived", { stale_reason: "archived by admin" });
        nextOverrides.jobs[String(job.id)] = {
          ...(nextOverrides.jobs[String(job.id)] || {}),
          exclude_from_pending: true,
          exclude_reason: "archived by admin"
        };
        report.recordsArchivedOrRejected += 1;
      }
      nextPending = removePendingByIds(nextPending, freshIds);
      actionResults[action.id] = buildActionResult("applied", `archived=${pendingSelection.length}`);
      logActionOutcome(action, actionSource, "applied", `archived=${pendingSelection.length}`);
      console.log(
        `[jobs:apply-admin-actions] archive_selected action=${action.id} archived=${pendingSelection.length} remaining_pending=${nextPending.length}`
      );
    } else if (action.operation === "mark_needs_cleanup") {
      nextPending = applyPendingJobMutations(nextPending, freshIds, (job) => ({
        ...job,
        triage_bucket: "needs_cleanup",
        triage_reason: "marked needs cleanup by admin"
      }));
      freshIds.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          triage_bucket: "needs_cleanup",
          triage_reason: "marked needs cleanup by admin"
        };
      });
      actionResults[action.id] = buildActionResult("applied", `marked_needs_cleanup=${freshIds.length}`);
      logActionOutcome(action, actionSource, "applied", `marked_needs_cleanup=${freshIds.length}`);
      console.log(`[jobs:apply-admin-actions] mark_needs_cleanup action=${action.id} count=${freshIds.length}`);
    } else if (action.operation === "mark_reviewed") {
      nextPending = applyPendingJobMutations(nextPending, freshIds, (job) => ({
        ...job,
        admin_review_state: "reviewed"
      }));
      freshIds.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          admin_review_state: "reviewed"
        };
      });
      actionResults[action.id] = buildActionResult("applied", `marked_reviewed=${freshIds.length}`);
      logActionOutcome(action, actionSource, "applied", `marked_reviewed=${freshIds.length}`);
      console.log(`[jobs:apply-admin-actions] mark_reviewed action=${action.id} count=${freshIds.length}`);
    } else if (action.operation === "feature_selected") {
      nextPending = applyPendingJobMutations(nextPending, freshIds, (job) => ({
        ...job,
        featured: true
      }));
      freshIds.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          featured: true
        };
      });
      actionResults[action.id] = buildActionResult("applied", `featured=${freshIds.length}`);
      logActionOutcome(action, actionSource, "applied", `featured=${freshIds.length}`);
      console.log(`[jobs:apply-admin-actions] feature_selected action=${action.id} count=${freshIds.length}`);
    } else if (action.operation === "hide_organization") {
      const organization = String(action.payload.organization || selectedJobs[0]?.organization || "").trim();
      if (organization && !nextOrgRules.hidden_organizations.includes(organization)) {
        nextOrgRules.hidden_organizations.push(organization);
      }
      nextPending = nextPending.filter((job) => String(job.organization || "").trim() !== organization);
      if (rejectedJobs.length) shouldRunPublicSync = true;
      actionResults[action.id] = buildActionResult("applied", `hidden_organization=${organization}`);
      logActionOutcome(action, actionSource, "applied", `hidden_organization=${organization}`);
      console.log(`[jobs:apply-admin-actions] hide_organization action=${action.id} organization=${organization}`);
    } else if (action.operation === "reject_all_from_organization") {
      const organization = String(action.payload.organization || selectedJobs[0]?.organization || "").trim();
      if (organization && !nextOrgRules.rejected_organizations.includes(organization)) {
        nextOrgRules.rejected_organizations.push(organization);
      }
      const rejectedJobs = nextPending.filter((job) => String(job.organization || "").trim() === organization);
      for (const job of rejectedJobs) {
        upsertJobRecord(nextRecords, job, "rejected", { stale_reason: "rejected by admin" });
        nextOverrides.jobs[String(job.id)] = {
          ...(nextOverrides.jobs[String(job.id)] || {}),
          exclude_from_pending: true,
          exclude_reason: "rejected by admin"
        };
        report.recordsArchivedOrRejected += 1;
      }
      nextPending = nextPending.filter((job) => String(job.organization || "").trim() !== organization);
      actionResults[action.id] = buildActionResult("applied", `rejected_organization=${organization}`);
      logActionOutcome(action, actionSource, "applied", `rejected_organization=${organization}`);
      console.log(
        `[jobs:apply-admin-actions] reject_all_from_organization action=${action.id} organization=${organization} rejected=${rejectedJobs.length} remaining_pending=${nextPending.length}`
      );
    } else if (action.operation === "update_active_job") {
      const id = String(action.payload.id || action.payload.recordId || freshIds[0] || "");
      let changedFields = [];
      const applied = updateRecordListById(nextRecords, id, (record) => {
        const nextRecord = updateJobDisplayFromEditedRecord(record, action.payload.editedRecord || {});
        changedFields = summarizeChangedFields(record, nextRecord, { editedRecord: action.payload.editedRecord || {} });
        return nextRecord;
      });
      if (applied && id) publicScopeIds.add(id);
      if (applied) shouldRunPublicSync = true;
      actionResults[action.id] = buildActionResult(applied ? "applied" : "ignored_duplicate", applied ? `updated_active_job=${id}` : `job_not_found=${id}`);
      logActionOutcome(action, actionSource, applied ? "applied" : "skipped_stale", applied ? `updated_active_job=${id}` : `job_not_found=${id}`);
      console.log(
        `[jobs:apply-admin-actions] update_active_job action_id=${action.id} record_id=${id} applied=${applied} fields_changed=${changedFields.join(",") || "none"}`
      );
    } else if (action.operation === "archive_active_job") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextRecords, id, (record) => ({
          ...record,
          status: "archived",
          published: false,
          public_visibility: false,
          stale_reason: "archived by admin",
          verification_status: "removed",
          verification_method: "manual",
          updated_at: new Date().toISOString()
        }))) {
          count += 1;
          publicScopeIds.add(String(id));
          shouldRunPublicSync = true;
        }
      });
      report.recordsArchivedOrRejected += count;
      actionResults[action.id] = buildActionResult("applied", `archived_active_jobs=${count}`);
      logActionOutcome(action, actionSource, "applied", `archived_active_jobs=${count}`);
      console.log(`[jobs:apply-admin-actions] archive_active_job action=${action.id} count=${count}`);
    } else if (action.operation === "unpublish_active_job") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextRecords, id, (record) => ({
          ...record,
          status: "pending",
          published: false,
          public_visibility: false,
          verification_status: "needs_review",
          verification_method: "manual",
          updated_at: new Date().toISOString()
        }))) {
          count += 1;
          publicScopeIds.add(String(id));
          shouldRunPublicSync = true;
        }
      });
      actionResults[action.id] = buildActionResult("applied", `unpublished_active_jobs=${count}`);
      logActionOutcome(action, actionSource, "applied", `unpublished_active_jobs=${count}`);
      console.log(`[jobs:apply-admin-actions] unpublish_active_job action=${action.id} count=${count}`);
    } else if (action.operation === "feature_active_job") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      const featured = typeof action.payload.featured === "boolean" ? action.payload.featured : true;
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextRecords, id, (record) => updateJobDisplayFromEditedRecord(record, { featured }))) {
          count += 1;
          publicScopeIds.add(String(id));
          shouldRunPublicSync = true;
        }
      });
      actionResults[action.id] = buildActionResult("applied", `feature_active_jobs=${count}`);
      logActionOutcome(action, actionSource, "applied", `feature_active_jobs=${count}`);
      console.log(`[jobs:apply-admin-actions] feature_active_job action=${action.id} count=${count} featured=${featured}`);
    } else if (action.operation === "update_active_talent") {
      const id = String(action.payload.id || action.payload.recordId || freshIds[0] || "");
      if (!id) {
        actionResults[action.id] = buildActionResult("applied", "empty_talent_id_skipped");
        report.staleSkippedResolvedActions.push({
          action_id: action.id,
          operation: action.operation,
          detail: "empty_talent_id_skipped"
        });
        logActionOutcome(action, actionSource, "applied", "empty_talent_id_skipped");
        console.log(`[jobs:apply-admin-actions] update_active_talent action_id=${action.id} skipped_empty_talent_id=true`);
        continue;
      }
      let changedFields = [];
      const applied = updateRecordListById(nextTalentProfiles, id, (record) => {
        const nextRecord = mergeStructuredRecord(record, action.payload.editedRecord || {}, { actionTimestamp });
        changedFields = summarizeChangedFields(record, nextRecord, { editedRecord: action.payload.editedRecord || {} });
        return nextRecord;
      });
      if (applied) report.talentProfilesUpdated += 1;
      actionResults[action.id] = buildActionResult(applied ? "applied" : "ignored_duplicate", applied ? `updated_active_talent=${id}` : `talent_not_found=${id}`);
      logActionOutcome(action, actionSource, applied ? "applied" : "skipped_stale", applied ? `updated_active_talent=${id}` : `talent_not_found=${id}`);
      console.log(
        `[jobs:apply-admin-actions] action_id=${action.id} operation=update_active_talent talent_id=${id} fields_changed=${changedFields.join(",") || "none"} talent_profiles_updated_count=${report.talentProfilesUpdated} applied=${applied}`
      );
    } else if (action.operation === "archive_active_talent") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextTalentProfiles, id, (record) => updateStructuredRecord(record, { status: "archived", published: false, public_visibility: false }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `archived_active_talent=${count}`);
      logActionOutcome(action, actionSource, "applied", `archived_active_talent=${count}`);
    } else if (action.operation === "unpublish_active_talent") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextTalentProfiles, id, (record) => updateStructuredRecord(record, { status: "pending", published: false, public_visibility: false }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `unpublished_active_talent=${count}`);
      logActionOutcome(action, actionSource, "applied", `unpublished_active_talent=${count}`);
    } else if (action.operation === "feature_active_talent") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      const featured = typeof action.payload.featured === "boolean" ? action.payload.featured : true;
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextTalentProfiles, id, (record) => updateStructuredRecord(record, { featured }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `feature_active_talent=${count}`);
      logActionOutcome(action, actionSource, "applied", `feature_active_talent=${count}`);
    } else if (action.operation === "update_active_employer") {
      const id = String(action.payload.id || action.payload.recordId || freshIds[0] || "");
      if (!id) {
        actionResults[action.id] = buildActionResult("applied", "empty_employer_id_skipped");
        report.staleSkippedResolvedActions.push({
          action_id: action.id,
          operation: action.operation,
          detail: "empty_employer_id_skipped"
        });
        logActionOutcome(action, actionSource, "applied", "empty_employer_id_skipped");
        console.log(`[jobs:apply-admin-actions] update_active_employer action_id=${action.id} skipped_empty_employer_id=true`);
        continue;
      }
      let changedFields = [];
      const applied = updateRecordListById(nextEmployers, id, (record) => {
        const nextRecord = mergeStructuredRecord(record, action.payload.editedRecord || {}, { actionTimestamp });
        changedFields = summarizeChangedFields(record, nextRecord, { editedRecord: action.payload.editedRecord || {} });
        return nextRecord;
      });
      actionResults[action.id] = buildActionResult(applied ? "applied" : "ignored_duplicate", applied ? `updated_active_employer=${id}` : `employer_not_found=${id}`);
      logActionOutcome(action, actionSource, applied ? "applied" : "skipped_stale", applied ? `updated_active_employer=${id}` : `employer_not_found=${id}`);
      console.log(`[jobs:apply-admin-actions] update_active_employer action=${action.id} id=${id} applied=${applied} fields_changed=${changedFields.join(",") || "none"}`);
    } else if (action.operation === "archive_active_employer") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextEmployers, id, (record) => updateStructuredRecord(record, { status: "archived", published: false, public_visibility: false }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `archived_active_employer=${count}`);
      logActionOutcome(action, actionSource, "applied", `archived_active_employer=${count}`);
    } else if (action.operation === "unpublish_active_employer") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextEmployers, id, (record) => updateStructuredRecord(record, { status: "pending", published: false, public_visibility: false }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `unpublished_active_employer=${count}`);
      logActionOutcome(action, actionSource, "applied", `unpublished_active_employer=${count}`);
    } else if (action.operation === "feature_active_employer") {
      const targetIds = freshIds.length ? freshIds : [String(action.payload.id || action.payload.recordId || "")].filter(Boolean);
      const featured = typeof action.payload.featured === "boolean" ? action.payload.featured : true;
      let count = 0;
      targetIds.forEach((id) => {
        if (updateRecordListById(nextEmployers, id, (record) => updateStructuredRecord(record, { featured }))) count += 1;
      });
      actionResults[action.id] = buildActionResult("applied", `feature_active_employer=${count}`);
      logActionOutcome(action, actionSource, "applied", `feature_active_employer=${count}`);
    } else {
      actionResults[action.id] = buildActionResult("ignored_duplicate", `unsupported operation=${action.operation}`);
      logActionOutcome(action, actionSource, "skipped_stale", `unsupported operation=${action.operation}`);
      console.log(`[jobs:apply-admin-actions] unsupported action skipped id=${action.id} operation=${action.operation}`);
    }
  }

  const expectedPublicJobsCount = buildPublicJobsFromRecords(nextRecords).length;
  const scopedIds = publicScopeIds.size ? Array.from(publicScopeIds) : [];
  let preflightPublicSync = {
    publicJobs: await readJobs(),
    jobsCountAfter: Array.isArray(await readJobs()) ? (await readJobs()).length : 0,
    publishedCount: expectedPublicJobsCount,
    wrote: false,
    overwriteAudit: {
      field_counts: {
        jobs_changed: 0,
        unrelated_jobs_changed: 0,
        descriptions_replaced: 0,
        snippets_replaced: 0,
        pay_fields_replaced: 0,
        locations_replaced: 0,
        specializations_replaced: 0,
        page_urls_changed: 0
      },
      current_scoped_quality: {
        junk_description_count: 0,
        invalid_snippet_count: 0,
        missing_description_count: 0
      },
      proposed_scoped_quality: {
        junk_description_count: 0,
        invalid_snippet_count: 0,
        missing_description_count: 0
      }
    }
  };
  if (shouldRunPublicSync) {
    try {
      preflightPublicSync = await syncPublicJobsFromRecords(nextRecords, {
        label: "jobs:apply-admin-actions-preflight",
        scopeIds: scopedIds,
        dryRun: true
      });
    } catch (error) {
      if (report.publishSelectedDiagnostics.length) {
        logScopedPublishFailures(report.publishSelectedDiagnostics.filter((item) => Array.isArray(item.dirty_reasons) && item.dirty_reasons.length));
      }
      throw error;
    }
  }

  if (scopedIds.length) {
    const dirtySelected = report.publishSelectedDiagnostics.filter((item) => Array.isArray(item.dirty_reasons) && item.dirty_reasons.length > 0);
    const remainingDirtySelected = report.publishSelectedDiagnostics.filter((item) => Array.isArray(item.remaining_dirty_reasons) && item.remaining_dirty_reasons.length > 0);
    const fixedSelectedCount = Math.max(0, dirtySelected.length - remainingDirtySelected.length);
    report.scopedPublishQualityReport = {
      selected_ids_count: scopedIds.length,
      dirty_selected_count: dirtySelected.length,
      fixed_selected_count: fixedSelectedCount,
      remaining_dirty_selected_count: remainingDirtySelected.length,
      current_scoped_quality: preflightPublicSync.overwriteAudit.current_scoped_quality || null,
      proposed_scoped_quality: preflightPublicSync.overwriteAudit.proposed_scoped_quality || null,
      jobs: report.publishSelectedDiagnostics.map((item) => ({
        id: item.id,
        title: item.title,
        organization: item.organization,
        dirty_reasons: item.dirty_reasons || [],
        remaining_dirty_reasons: item.remaining_dirty_reasons || [],
        before_description: excerptForLog(item.before?.description || ""),
        before_snippet: excerptForLog(item.before?.snippet || ""),
        after_description: excerptForLog(item.after?.description || ""),
        after_snippet: excerptForLog(item.after?.snippet || "")
      }))
    };
    console.log(`[jobs:apply-admin-actions] scoped_publish_quality ${JSON.stringify(report.scopedPublishQualityReport)}`);
    if (remainingDirtySelected.length) {
      logScopedPublishFailures(remainingDirtySelected);
      throw new Error(`publish_selected selected jobs remain dirty after sanitization: ${remainingDirtySelected.map((item) => item.id).join(",")}`);
    }
  }

  await writePendingOverrides(nextOverrides);
  await writeOrganizationRules(nextOrgRules);
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  await writeJson(JOB_RECORDS_FILE, nextRecords);
  await writeJson(TALENT_PROFILES_FILE, nextTalentProfiles);
  await writeJson(EMPLOYERS_FILE, nextEmployers);

  let publicSync = {
    publicJobs: await readJobs(),
    jobsCountAfter: Array.isArray(await readJobs()) ? (await readJobs()).length : 0,
    publishedCount: expectedPublicJobsCount,
    wrote: false,
    overwriteAudit: {
      field_counts: {
        jobs_changed: 0,
        unrelated_jobs_changed: 0,
        descriptions_replaced: 0,
        snippets_replaced: 0,
        pay_fields_replaced: 0,
        locations_replaced: 0,
        specializations_replaced: 0,
        page_urls_changed: 0
      }
    }
  };
  let finalJobsJsonCount = Array.isArray(publicSync.publicJobs) ? publicSync.publicJobs.length : 0;
  if (shouldRunPublicSync) {
    publicSync = await syncPublicJobsFromRecords(nextRecords, {
      label: "jobs:apply-admin-actions",
      scopeIds: scopedIds
    });
    const syncedJobs = await readJobs();
    finalJobsJsonCount = Array.isArray(syncedJobs) ? syncedJobs.length : 0;
    const syncMismatch = finalJobsJsonCount !== expectedPublicJobsCount;
    console.log(
      `[jobs:apply-admin-actions] expected_public_jobs_count=${expectedPublicJobsCount} final_jobs_json_count=${finalJobsJsonCount} wrote_jobs_json=${publicSync.wrote} sync_mismatch=${syncMismatch}`
    );
    if (syncMismatch) {
      throw new Error(`jobs.json sync mismatch: expected ${expectedPublicJobsCount} public jobs, found ${finalJobsJsonCount}`);
    }
  } else {
    console.log("[jobs:apply-admin-actions] no public job mutations detected; skipped jobs.json sync");
  }
  report.recordsLeftPending = nextPending.length;
  report.jobRecordsCount = nextRecords.length;
  report.jobsJsonCount = finalJobsJsonCount;
  console.log(
    `[jobs:apply-admin-actions] selected_ids_count=${scopedIds.length} public_jobs_changed=${publicSync.overwriteAudit.field_counts.jobs_changed} unrelated_jobs_changed=${publicSync.overwriteAudit.field_counts.unrelated_jobs_changed}`
  );
  const pageBuildResult = shouldRunPublicSync
    ? (scopedIds.length
      ? await buildPagesForSelectedJobs(publicSync.publicJobs, { selectedIds: scopedIds })
      : await buildPagesFromJobs(publicSync.publicJobs))
    : { pagesWrittenCount: 0, redirectPagesWrittenCount: 0 };
  report.jobPagesRegenerated = pageBuildResult.pagesWrittenCount;
  report.redirectPagesRegenerated = pageBuildResult.redirectPagesWrittenCount || 0;
  const validation = shouldRunPublicSync
    ? await buildValidationReport({ requirePages: true })
    : await buildValidationReport({ requirePages: false });
  report.validation = {
    public_records_count: validation.public_records_count,
    jobs_json_count: validation.jobs_json_count,
    invalid_title_count: validation.invalid_title_count,
    pending_public_overlap_count: validation.pending_public_overlap_count,
    hard_validation_failure_count: validation.hard_validation_failure_count
  };
  console.log(
    `[jobs:apply-admin-actions] validation public_records_count=${validation.public_records_count} jobs_json_count=${validation.jobs_json_count} invalid_title_count=${validation.invalid_title_count} pending_public_overlap_count=${validation.pending_public_overlap_count} hard_validation_failure_count=${validation.hard_validation_failure_count}`
  );
  if (validation.hard_validation_failure_count > 0) {
    throw new Error(`hard public validation failures detected: ${validation.hard_validation_failure_count}`);
  }
  const parserStats = getParserCleanupStats();
  console.log(
    `[jobs:apply-admin-actions] parser_cleaned_title_count=${parserStats.parser_cleaned_title_count} parser_cleaned_org_count=${parserStats.parser_cleaned_org_count} parser_cleaned_description_count=${parserStats.parser_cleaned_description_count} parser_location_defaulted_remote_count=${parserStats.parser_location_defaulted_remote_count} parser_location_cleaned_count=${parserStats.parser_location_cleaned_count} parser_hybrid_location_repaired_count=${parserStats.parser_hybrid_location_repaired_count} parser_elemental_metadata_stripped_count=${parserStats.parser_elemental_metadata_stripped_count} parser_custom_table_header_stripped_count=${parserStats.parser_custom_table_header_stripped_count} parser_html_fragment_stripped_count=${parserStats.parser_html_fragment_stripped_count} salary_invalid_removed_count=${parserStats.salary_invalid_removed_count} salary_display_built_from_range_count=${parserStats.salary_display_built_from_range_count} workplace_type_cleaned_count=${parserStats.workplace_type_cleaned_count} workplace_type_invalid_removed_count=${parserStats.workplace_type_invalid_removed_count} workplace_type_field_misplacement_repaired_count=${parserStats.workplace_type_field_misplacement_repaired_count} elemental_impact_routed_pending_count=${parserStats.elemental_impact_routed_pending_count}`
  );

  try {
    await resolveActions(fetched.backendUrl, fetched.adminToken, actionResults);
  } catch (error) {
    console.error(`[jobs:apply-admin-actions] backend resolve failed: ${error.message}`);
  }
  if (fetched.source === "local") {
    await resolveLocalActions(actionResults, fetched.actions);
  }
  if (fetched.source === "snapshot") {
    await resolveSnapshotActions(actionResults, fetched.actions);
  }

  console.log(
    `[jobs:apply-admin-actions] published_count=${report.recordsPublished} records_archived_or_rejected=${report.recordsArchivedOrRejected} talent_profiles_updated_count=${report.talentProfilesUpdated} skipped_stale_count=${report.staleSkipped} already_published_skipped=${report.alreadyPublishedSkipped} duplicates_skipped=${report.duplicatesSkipped} records_left_pending=${report.recordsLeftPending} final_job_records_count=${report.jobRecordsCount} final_job_records_published_count=${publicSync.publishedCount} final_jobs_json_count=${report.jobsJsonCount} generated_page_count=${report.jobPagesRegenerated}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:apply-admin-actions] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
