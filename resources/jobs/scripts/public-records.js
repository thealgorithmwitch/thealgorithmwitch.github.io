const path = require("path");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { hasUsableDescription, normalizeJob, normalizePayDisplay, normalizeWorkplaceType, stableHash, stringifySafe, todayIso, truncateTextForStorage } = require("./job-normalizer");
const { buildCanonicalPublishedDisplay, canonicalizeJobShape } = require("./canonical-job-shape");
const { applyPublishLifecycle, computeStaleScore, resolveDisplayJobFromRecord } = require("./lifecycle-utils");

const ROOT = process.env.JOBS_DATA_DIR
  ? path.resolve(process.env.JOBS_DATA_DIR)
  : path.resolve(__dirname, "..");
const JOB_RECORDS_FILE = path.join(ROOT, "job-records.json");
const TALENT_PROFILES_FILE = path.join(ROOT, "talent-profiles.json");
const EMPLOYERS_FILE = path.join(ROOT, "employers.json");
const MAX_STORED_DESCRIPTION_LENGTH = 16000;
const MAX_STORED_NOTES_LENGTH = 4000;
const JOB_MANUAL_OVERRIDE_FIELDS = [
  "display.title",
  "display.organization",
  "display.location",
  "display.location_type",
  "display.pay_display",
  "display.salary_min",
  "display.salary_max",
  "display.specialization",
  "display.specialization_confidence",
  "display.description",
  "display.source_url",
  "display.original_url",
  "display.application_url",
  "display.page_url_override",
  "raw_source_data.title",
  "raw_source_data.organization",
  "raw_source_data.location",
  "raw_source_data.workplace_type",
  "raw_source_data.salary",
  "raw_source_data.salary_min",
  "raw_source_data.salary_max",
  "raw_source_data.description"
];

const RAW_SOURCE_DATA_FIELDS = [
  "id",
  "ref",
  "external_id",
  "source_id",
  "source_type",
  "title",
  "organization",
  "location",
  "workplace_type",
  "job_type",
  "salary",
  "raw_salary",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "salary_visible",
  "pay_parse_warning",
  "pay_parse_source",
  "pay_parse_confidence",
  "pay_candidate_snippets",
  "pay_rejected_snippets",
  "pay_rejection_reason",
  "pay_like_detected",
  "pay_parse_failed_snippet",
  "featured",
  "sector",
  "function",
  "specialization",
  "specialization_confidence",
  "experience",
  "source",
  "source_url",
  "description_source_url",
  "pay_source_url",
  "apply_url",
  "apply_url_type",
  "original_url",
  "workable_url_normalized",
  "original_workable_url",
  "canonical_workable_url",
  "workable_human_apply_confirmed",
  "workable_apply_validation_reason",
  "date_posted",
  "date_added",
  "date_updated",
  "status",
  "approved_by",
  "description",
  "raw_description",
  "tags",
  "shared_by",
  "notes",
  "review_reason",
  "triage_bucket",
  "triage_reason",
  "parse_warning",
  "description_cleaning_applied",
  "description_leading_fragment_removed",
  "description_auto_capitalized",
  "description_fallback_sentence_used",
  "snippet_fallback_used",
  "confidence",
  "parser_confidence",
  "parser_confidence_score",
  "content_quality_score",
  "last_checked_at",
  "last_seen_at",
  "source_status",
  "stale_score",
  "published_grace_until",
  "missing_from_source_confirmations",
  "required_missing_confirmations",
  "resurfacing_priority_score",
  "source_confidence",
  "source_classification",
  "failed_sync_count",
  "relevance_score",
  "relevance_reasons",
  "trusted",
  "auto_publish",
  "sync_origin"
];

const TRACKED_DISPLAY_FIELDS = [
  "title",
  "organization",
  "location",
  "location_type",
  "pay_display",
  "salary_min",
  "salary_max",
  "specialization",
  "specialization_confidence",
  "description",
  "source_url",
  "original_url",
  "application_url",
  "page_url_override"
];

function serializedByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function toMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function sanitizeStoredDescription(value, meta) {
  const next = truncateTextForStorage(value, MAX_STORED_DESCRIPTION_LENGTH);
  if (stringifySafe(value) && next !== stringifySafe(value)) {
    meta.changed = true;
    meta.truncated = true;
  }
  return next;
}

function sanitizeStoredNotes(value, meta) {
  const next = truncateTextForStorage(value, MAX_STORED_NOTES_LENGTH);
  if (stringifySafe(value) && next !== stringifySafe(value)) {
    meta.changed = true;
    meta.truncated = true;
  }
  return next;
}

function sanitizeRawSourceDataForStorage(rawSourceData = {}, meta = { changed: false, truncated: false }) {
  const next = {};

  for (const field of RAW_SOURCE_DATA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rawSourceData || {}, field)) continue;
    const value = rawSourceData[field];

    if (field === "description" || field === "raw_description") {
      next[field] = sanitizeStoredDescription(value, meta);
      continue;
    }

    if (field === "notes") {
      next[field] = sanitizeStoredNotes(value, meta);
      continue;
    }

    if (field === "tags" || field === "relevance_reasons") {
      next[field] = Array.isArray(value)
        ? value.map((item) => stringifySafe(item)).filter(Boolean)
        : [];
      continue;
    }

    next[field] = value;
  }

  return next;
}

function sanitizeDisplayForStorage(display = {}, normalized = {}, meta = { changed: false, truncated: false }) {
  const canonical = canonicalizeJobShape(normalized, { alreadyNormalized: true }) || normalized;
  const payDisplay = normalizePayDisplay({
    payDisplay: display.pay_display || canonical.salary,
    salaryMin: display.salary_min ?? canonical.salary_min,
    salaryMax: display.salary_max ?? canonical.salary_max,
    currency: canonical.salary_currency,
    period: canonical.salary_period
  });
  return {
    title: stringifySafe(display.title || canonical.title),
    organization: stringifySafe(display.organization || canonical.organization),
    location: stringifySafe(display.location || canonical.location),
    location_type: normalizeWorkplaceType(display.location_type || canonical.workplace_type, ""),
    pay_display: payDisplay,
    salary_min: display.salary_min ?? canonical.salary_min ?? null,
    salary_max: display.salary_max ?? canonical.salary_max ?? null,
    role_type: stringifySafe(display.role_type || canonical.job_type),
    experience_level: stringifySafe(display.experience_level || canonical.experience),
    sector: stringifySafe(display.sector || canonical.sector),
    function: stringifySafe(display.function || canonical.function),
    specialization: stringifySafe(display.specialization || canonical.specialization),
    specialization_confidence: stringifySafe(display.specialization_confidence || canonical.specialization_confidence || "low"),
    tags: Array.isArray(display.tags) && display.tags.length
      ? display.tags.map((tag) => stringifySafe(tag)).filter(Boolean)
      : Array.isArray(canonical.tags)
        ? canonical.tags.map((tag) => stringifySafe(tag)).filter(Boolean)
        : [],
    description: sanitizeStoredDescription(display.description || canonical.description || canonical.raw_description, meta),
    source_name: stringifySafe(display.source_name || canonical.source),
    source_url: stringifySafe(display.source_url || canonical.source_url),
    original_url: stringifySafe(display.original_url || canonical.original_url || canonical.source_url),
    date_collected: stringifySafe(display.date_collected || canonical.date_posted || todayIso()),
    application_url: stringifySafe(display.application_url || canonical.apply_url),
    page_url_override: stringifySafe(display.page_url_override || canonical.page_url_override),
    published: typeof display.published === "boolean" ? display.published : Boolean(canonical.status === "active"),
    featured: typeof display.featured === "boolean" ? display.featured : Boolean(canonical.featured)
  };
}

function normalizeFieldPath(pathValue = "") {
  return String(pathValue || "").trim();
}

function getManualOverrideSet(record = {}) {
  const values = []
    .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
    .concat(Array.isArray(record.protected_fields) ? record.protected_fields : []);
  return new Set(values.map(normalizeFieldPath).filter(Boolean));
}

function hasMeaningfulText(value) {
  return Boolean(stringifySafe(value).trim());
}

function textDiffers(left, right) {
  return stringifySafe(left).trim() !== stringifySafe(right).trim();
}

function hasLikelyManualOverride(record = {}, fieldPath, existingValue, sourceValue) {
  const overrides = getManualOverrideSet(record);
  const normalizedPath = normalizeFieldPath(fieldPath);
  const leaf = normalizedPath.split(".").pop();
  if (overrides.has(normalizedPath) || overrides.has(leaf)) return true;
  if (record.admin_notes && hasMeaningfulText(existingValue) && textDiffers(existingValue, sourceValue)) return true;
  return false;
}

function parseTimestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveNumericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getFieldMeta(record = {}, field) {
  return record.field_meta && typeof record.field_meta === "object" && record.field_meta[field]
    ? { ...record.field_meta[field] }
    : {};
}

function hasNewerManualFieldValue(record = {}, field) {
  const meta = getFieldMeta(record, field);
  const manualAt = parseTimestampMs(meta.last_manual_edit_at || record.last_manual_edit_at);
  const sourceAt = parseTimestampMs(meta.last_source_sync_at || record.last_source_sync_at);
  return manualAt > 0 && manualAt >= sourceAt;
}

function buildFieldMetaSnapshot(existing = {}, nextDisplay = {}, options = {}, conflicts = []) {
  const now = String(options.now || new Date().toISOString());
  const sourceContext = options.context === "source_sync";
  const fieldMeta = {};

  for (const field of TRACKED_DISPLAY_FIELDS) {
    const previous = getFieldMeta(existing, field);
    fieldMeta[field] = {
      ...previous
    };
    if (sourceContext) {
      fieldMeta[field].last_source_sync_at = now;
    }
    if (options.context === "manual_edit" && options.manualFields && options.manualFields.has(field)) {
      fieldMeta[field].last_manual_edit_at = now;
    }
    if (options.conflictedFields && options.conflictedFields.has(field)) {
      fieldMeta[field].last_conflict_at = now;
      fieldMeta[field].conflict = true;
      fieldMeta[field].conflict_reason = "manual_value_preserved_over_source_refresh";
      conflicts.push({
        field,
        detected_at: now,
        reason: "manual_value_preserved_over_source_refresh"
      });
    } else {
      fieldMeta[field].conflict = false;
      delete fieldMeta[field].conflict_reason;
    }
    fieldMeta[field].last_value = stringifySafe(nextDisplay[field]);
  }

  return fieldMeta;
}

function shouldPreserveProtectedDescription(existingValue, incomingValue, title = "") {
  const existingUsable = hasUsableDescription(existingValue, { title });
  if (!existingUsable) return false;
  if (!hasUsableDescription(incomingValue, { title })) return true;
  return true;
}

function isWeakLocation(value) {
  const text = stringifySafe(value).trim();
  return !text || /^remote$/i.test(text);
}

function buildCanonicalPay(normalized = {}, display = {}) {
  return normalizePayDisplay({
    payDisplay: display.pay_display || normalized.salary,
    salaryMin: display.salary_min ?? normalized.salary_min,
    salaryMax: display.salary_max ?? normalized.salary_max,
    currency: normalized.salary_currency,
    period: normalized.salary_period
  });
}

function sanitizeJobRecordForStorage(record = {}) {
  const meta = { changed: false, truncated: false };
  const normalizedRawSourceData = sanitizeRawSourceDataForStorage(record.raw_source_data || {}, meta);
  const sanitizedRecord = {
    ...record,
    admin_notes: sanitizeStoredNotes(record.admin_notes, meta),
    raw_source_data: normalizedRawSourceData,
    display: sanitizeDisplayForStorage(record.display || {}, normalizedRawSourceData, meta)
  };

  if (JSON.stringify(sanitizedRecord) !== JSON.stringify(record)) {
    meta.changed = true;
  }

  delete sanitizedRecord.__merge_stats;

  return { record: sanitizedRecord, meta };
}

function baseRecord(recordType, sourceType, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: stringifySafe(existing.id),
    record_type: recordType,
    status: stringifySafe(existing.status) || "draft",
    public_visibility: typeof existing.public_visibility === "boolean" ? existing.public_visibility : false,
    featured: typeof existing.featured === "boolean" ? existing.featured : false,
    created_at: stringifySafe(existing.created_at) || now,
    updated_at: now,
    source_type: stringifySafe(existing.source_type) || sourceType,
    admin_notes: stringifySafe(existing.admin_notes),
    display_order: Number.isFinite(Number(existing.display_order)) ? Number(existing.display_order) : 0,
    published: typeof existing.published === "boolean" ? existing.published : false
  };
}

function buildJobFingerprint(job) {
  const normalized = normalizeJob(job);
  return stringifySafe(normalized.external_id) ||
    stringifySafe(normalized.apply_url) ||
    stableHash(`${normalized.source_id}::${normalized.organization}::${normalized.title}::${normalized.date_posted}`);
}

function toDisplayJob(record) {
  const resolved = resolveDisplayJobFromRecord(record);
  resolved.display_order = record.display_order || 0;
  return resolved;
}

function buildJobRecord(job, existing = {}, options = {}) {
  const normalized = normalizeJob(job);
  const now = String(options.now || new Date().toISOString());
  const authoritativeLastCheckedAt = stringifySafe(normalized.last_checked_at || existing.last_checked_at);
  const authoritativeLastSeenAt = stringifySafe(normalized.last_seen_at || existing.last_seen_at);
  const authoritativeSourceStatus = stringifySafe(normalized.source_status || existing.source_status);
  const authoritativeSourceConfidence = stringifySafe(normalized.source_confidence || existing.source_confidence);
  const authoritativeSourceClassification = stringifySafe(normalized.source_classification || existing.source_classification);
  const authoritativeFailedSyncCount = Number(normalized.failed_sync_count ?? existing.failed_sync_count ?? 0) || 0;
  const authoritativeStaleScore = normalized.stale_score ?? existing.stale_score ?? null;
  const authoritativePublishedGraceUntil = stringifySafe(normalized.published_grace_until || existing.published_grace_until);
  const authoritativeMissingConfirmations = Math.max(
    0,
    Number(normalized.missing_from_source_confirmations ?? existing.missing_from_source_confirmations ?? 0) || 0
  );
  const authoritativeRequiredMissingConfirmations = Math.max(
    1,
    Number(normalized.required_missing_confirmations ?? existing.required_missing_confirmations ?? 2) || 2
  );
  const authoritativeResurfacingPriorityScore = resolveNumericField(
    normalized.resurfacing_priority_score ?? existing.resurfacing_priority_score
  );
  const sourceType =
    stringifySafe(existing.source_type) ||
    (normalized.sync_origin === "ats" ? "scraped" : normalized.sync_origin === "manual" ? "manual" : "scraped");
  const base = baseRecord("job", sourceType, existing);
  const published = existing.id
    ? Boolean(existing.published)
    : ["active", "approved", "published"].includes(String(normalized.status || "").toLowerCase());
  const status = stringifySafe(existing.status) || (published ? "published" : "pending");

  const incomingDisplay = sanitizeDisplayForStorage({}, normalized, { changed: false, truncated: false });
  const existingDisplay = sanitizeDisplayForStorage(existing.display || {}, existing.raw_source_data || {}, { changed: false, truncated: false });
  const mergeStats = existing.__merge_stats || {
    salary_preserved_manual_count: 0,
    salary_source_overwrite_blocked_count: 0,
    location_preserved_manual_count: 0,
    description_preserved_manual_count: 0
  };
  const conflictedFields = new Set();
  const salaryProtected = hasLikelyManualOverride(
    existing,
    "display.pay_display",
    existingDisplay.pay_display,
    existing.raw_source_data?.salary
  );
  const locationProtected = hasLikelyManualOverride(
    existing,
    "display.location",
    existingDisplay.location,
    existing.raw_source_data?.location
  );
  const descriptionProtected = hasLikelyManualOverride(
    existing,
    "display.description",
    existingDisplay.description,
    existing.raw_source_data?.description
  );
  const titleProtected = hasLikelyManualOverride(existing, "display.title", existingDisplay.title, existing.raw_source_data?.title);
  const organizationProtected = hasLikelyManualOverride(existing, "display.organization", existingDisplay.organization, existing.raw_source_data?.organization);
  const workplaceProtected = hasLikelyManualOverride(
    existing,
    "display.location_type",
    existingDisplay.location_type,
    existing.raw_source_data?.workplace_type
  );
  const specializationProtected = hasLikelyManualOverride(
    existing,
    "display.specialization",
    existingDisplay.specialization,
    existing.raw_source_data?.specialization
  );
  const specializationConfidenceProtected = hasLikelyManualOverride(
    existing,
    "display.specialization_confidence",
    existingDisplay.specialization_confidence,
    existing.raw_source_data?.specialization_confidence
  );
  const sourceUrlProtected = hasLikelyManualOverride(
    existing,
    "display.source_url",
    existingDisplay.source_url,
    existing.raw_source_data?.source_url
  );
  const originalUrlProtected = hasLikelyManualOverride(
    existing,
    "display.original_url",
    existingDisplay.original_url,
    existing.raw_source_data?.original_url
  );
  const applicationUrlProtected = hasLikelyManualOverride(
    existing,
    "display.application_url",
    existingDisplay.application_url,
    existing.raw_source_data?.apply_url
  );
  const pageUrlOverrideProtected = hasLikelyManualOverride(
    existing,
    "display.page_url_override",
    existingDisplay.page_url_override,
    existing.raw_source_data?.page_url_override
  );

  const canonicalExistingPay = buildCanonicalPay(existing.raw_source_data || {}, existingDisplay);
  const canonicalIncomingPay = buildCanonicalPay(normalized, incomingDisplay);
  const existingDescriptionUsable = hasUsableDescription(existingDisplay.description, { title: existingDisplay.title || normalized.title });
  const incomingDescriptionUsable = hasUsableDescription(incomingDisplay.description, { title: incomingDisplay.title || normalized.title });
  const manualTitleWins = hasNewerManualFieldValue(existing, "title");
  const manualOrganizationWins = hasNewerManualFieldValue(existing, "organization");
  const manualLocationWins = hasNewerManualFieldValue(existing, "location");
  const manualWorkplaceWins = hasNewerManualFieldValue(existing, "location_type");
  const manualSpecializationWins = hasNewerManualFieldValue(existing, "specialization");
  const manualDescriptionWins = hasNewerManualFieldValue(existing, "description");
  const manualPayWins = hasNewerManualFieldValue(existing, "pay_display");
  const manualSourceUrlWins = hasNewerManualFieldValue(existing, "source_url");
  const manualOriginalUrlWins = hasNewerManualFieldValue(existing, "original_url");
  const manualApplicationUrlWins = hasNewerManualFieldValue(existing, "application_url");
  const manualPageOverrideWins = hasNewerManualFieldValue(existing, "page_url_override");
  const mergedDisplay = {
    ...incomingDisplay,
    title: ((titleProtected || manualTitleWins) && hasMeaningfulText(existingDisplay.title)) ? existingDisplay.title : (incomingDisplay.title || existingDisplay.title),
    organization:
      (organizationProtected || manualOrganizationWins) && hasMeaningfulText(existingDisplay.organization)
        ? existingDisplay.organization
        : (incomingDisplay.organization || existingDisplay.organization),
    location:
      ((locationProtected || manualLocationWins) && hasMeaningfulText(existingDisplay.location)) ||
      (hasMeaningfulText(existingDisplay.location) && isWeakLocation(incomingDisplay.location) && !isWeakLocation(existingDisplay.location))
        ? existingDisplay.location
        : (incomingDisplay.location || existingDisplay.location),
    location_type:
      (workplaceProtected || manualWorkplaceWins) && hasMeaningfulText(existingDisplay.location_type)
        ? existingDisplay.location_type
        : (incomingDisplay.location_type || existingDisplay.location_type),
    specialization:
      (specializationProtected || manualSpecializationWins) && hasMeaningfulText(existingDisplay.specialization)
        ? existingDisplay.specialization
        : (incomingDisplay.specialization || existingDisplay.specialization),
    specialization_confidence:
      (specializationConfidenceProtected || manualSpecializationWins) && hasMeaningfulText(existingDisplay.specialization_confidence)
        ? existingDisplay.specialization_confidence
        : (incomingDisplay.specialization_confidence || existingDisplay.specialization_confidence || "low"),
    description:
      ((descriptionProtected || manualDescriptionWins) && shouldPreserveProtectedDescription(existingDisplay.description, incomingDisplay.description, existingDisplay.title || normalized.title)) ||
      (existingDescriptionUsable && !incomingDescriptionUsable)
        ? existingDisplay.description
        : (incomingDisplay.description || existingDisplay.description),
    pay_display:
      ((salaryProtected || manualPayWins) && canonicalExistingPay) || (!canonicalIncomingPay && canonicalExistingPay)
        ? canonicalExistingPay
        : canonicalIncomingPay,
    salary_min:
      ((salaryProtected || manualPayWins) && existingDisplay.salary_min !== null && existingDisplay.salary_min !== undefined)
        ? existingDisplay.salary_min
        : (incomingDisplay.salary_min ?? existingDisplay.salary_min ?? null),
    salary_max:
      ((salaryProtected || manualPayWins) && existingDisplay.salary_max !== null && existingDisplay.salary_max !== undefined)
        ? existingDisplay.salary_max
        : (incomingDisplay.salary_max ?? existingDisplay.salary_max ?? null),
    source_url:
      (sourceUrlProtected || manualSourceUrlWins) && hasMeaningfulText(existingDisplay.source_url)
        ? existingDisplay.source_url
        : (incomingDisplay.source_url || existingDisplay.source_url),
    original_url:
      (originalUrlProtected || manualOriginalUrlWins) && hasMeaningfulText(existingDisplay.original_url)
        ? existingDisplay.original_url
        : (incomingDisplay.original_url || existingDisplay.original_url),
    application_url:
      (applicationUrlProtected || manualApplicationUrlWins) && hasMeaningfulText(existingDisplay.application_url)
        ? existingDisplay.application_url
        : (incomingDisplay.application_url || existingDisplay.application_url),
    page_url_override:
      (pageUrlOverrideProtected || manualPageOverrideWins) && hasMeaningfulText(existingDisplay.page_url_override)
        ? existingDisplay.page_url_override
        : (incomingDisplay.page_url_override || existingDisplay.page_url_override)
  };

  if (options.context === "source_sync") {
    [
      ["title", manualTitleWins, existingDisplay.title, incomingDisplay.title],
      ["organization", manualOrganizationWins, existingDisplay.organization, incomingDisplay.organization],
      ["location", manualLocationWins, existingDisplay.location, incomingDisplay.location],
      ["location_type", manualWorkplaceWins, existingDisplay.location_type, incomingDisplay.location_type],
      ["specialization", manualSpecializationWins, existingDisplay.specialization, incomingDisplay.specialization],
      ["description", manualDescriptionWins, existingDisplay.description, incomingDisplay.description],
      ["pay_display", manualPayWins, canonicalExistingPay, canonicalIncomingPay],
      ["source_url", manualSourceUrlWins, existingDisplay.source_url, incomingDisplay.source_url],
      ["original_url", manualOriginalUrlWins, existingDisplay.original_url, incomingDisplay.original_url],
      ["application_url", manualApplicationUrlWins, existingDisplay.application_url, incomingDisplay.application_url],
      ["page_url_override", manualPageOverrideWins, existingDisplay.page_url_override, incomingDisplay.page_url_override]
    ].forEach(([field, manualWins, previousValue, incomingValue]) => {
      if (manualWins && stringifySafe(previousValue) && stringifySafe(incomingValue) && stringifySafe(previousValue) !== stringifySafe(incomingValue)) {
        conflictedFields.add(field);
      }
    });
  }

  if (salaryProtected && canonicalExistingPay) {
    mergeStats.salary_preserved_manual_count += 1;
  } else if (canonicalExistingPay && canonicalIncomingPay && canonicalExistingPay !== canonicalIncomingPay) {
    mergeStats.salary_source_overwrite_blocked_count += 1;
    mergedDisplay.pay_display = canonicalExistingPay;
    mergedDisplay.salary_min = existingDisplay.salary_min ?? mergedDisplay.salary_min;
    mergedDisplay.salary_max = existingDisplay.salary_max ?? mergedDisplay.salary_max;
  }
  if (locationProtected && hasMeaningfulText(existingDisplay.location)) {
    mergeStats.location_preserved_manual_count += 1;
  }
  if (descriptionProtected && shouldPreserveProtectedDescription(existingDisplay.description, incomingDisplay.description, existingDisplay.title || normalized.title)) {
    mergeStats.description_preserved_manual_count += 1;
  }

  let nextRecord = {
    ...base,
    id: stringifySafe(existing.id) || normalized.id,
    status,
    public_visibility:
      typeof existing.public_visibility === "boolean"
        ? existing.public_visibility
        : published,
    featured: typeof existing.featured === "boolean" ? existing.featured : Boolean(normalized.featured),
    published,
    source_fingerprint: stringifySafe(existing.source_fingerprint) || buildJobFingerprint(normalized),
    last_normalized_at: now,
    last_source_sync_at:
      options.context === "source_sync"
        ? (authoritativeLastCheckedAt || authoritativeLastSeenAt || stringifySafe(existing.last_source_sync_at))
        : stringifySafe(existing.last_source_sync_at),
    last_manual_edit_at: stringifySafe(existing.last_manual_edit_at),
    raw_source_data: {
      ...normalized,
      title: mergedDisplay.title || normalized.title,
      organization: mergedDisplay.organization || normalized.organization,
      location: mergedDisplay.location || normalized.location,
      workplace_type: mergedDisplay.location_type || normalized.workplace_type,
      salary: mergedDisplay.pay_display || normalized.salary,
      salary_min: mergedDisplay.salary_min ?? normalized.salary_min,
      salary_max: mergedDisplay.salary_max ?? normalized.salary_max,
      specialization: mergedDisplay.specialization || normalized.specialization,
      specialization_confidence: mergedDisplay.specialization_confidence || normalized.specialization_confidence,
      source_url: mergedDisplay.source_url || normalized.source_url,
      original_url: mergedDisplay.original_url || normalized.original_url,
      apply_url: mergedDisplay.application_url || normalized.apply_url,
      page_url_override: mergedDisplay.page_url_override || normalized.page_url_override,
      description: mergedDisplay.description || normalized.description,
      parser_confidence: normalized.parser_confidence,
      parser_confidence_score: normalized.parser_confidence_score,
      content_quality_score: normalized.content_quality_score,
      last_checked_at: authoritativeLastCheckedAt,
      last_seen_at: authoritativeLastSeenAt,
      source_status: authoritativeSourceStatus,
      stale_score: authoritativeStaleScore,
      published_grace_until: authoritativePublishedGraceUntil,
      missing_from_source_confirmations: authoritativeMissingConfirmations,
      required_missing_confirmations: authoritativeRequiredMissingConfirmations,
      resurfacing_priority_score: authoritativeResurfacingPriorityScore,
      source_confidence: authoritativeSourceConfidence,
      source_classification: authoritativeSourceClassification,
      failed_sync_count: authoritativeFailedSyncCount
    },
    display: mergedDisplay,
    field_meta: buildFieldMetaSnapshot(existing, mergedDisplay, {
      now,
      context: options.context,
      manualFields: options.manualFields,
      conflictedFields
    }, []),
    field_conflicts: options.context === "source_sync"
      ? Array.from(new Map(
        [
          ...(Array.isArray(existing.field_conflicts) ? existing.field_conflicts : []),
          ...Array.from(conflictedFields).map((field) => ({
            field,
            detected_at: now,
            reason: "manual_value_preserved_over_source_refresh"
          }))
        ].map((item) => [String(item.field || ""), item])
      ).values())
      : (Array.isArray(existing.field_conflicts) ? existing.field_conflicts : []),
    manual_overrides: Array.from(
      new Set(
        []
          .concat(Array.isArray(existing.manual_overrides) ? existing.manual_overrides : [])
          .concat(Array.isArray(existing.protected_fields) ? existing.protected_fields : [])
          .filter((field) => JOB_MANUAL_OVERRIDE_FIELDS.includes(String(field)))
      )
    )
  };

  if (nextRecord.published && nextRecord.public_visibility && nextRecord.status === "published") {
    nextRecord = applyPublishLifecycle(nextRecord);
    if (authoritativeLastCheckedAt) nextRecord.last_checked_at = authoritativeLastCheckedAt;
    if (authoritativeLastSeenAt) nextRecord.last_seen_at = authoritativeLastSeenAt;
    if (authoritativeSourceStatus) nextRecord.source_status = authoritativeSourceStatus;
    nextRecord.failed_sync_count = authoritativeFailedSyncCount;
    if (authoritativeSourceConfidence) nextRecord.source_confidence = authoritativeSourceConfidence;
    if (authoritativeSourceClassification) nextRecord.source_classification = authoritativeSourceClassification;
    nextRecord.stale_score = computeStaleScore({
      ...nextRecord,
      stale_score: authoritativeStaleScore
    }, { now: new Date(now) });
    nextRecord.published_grace_until = authoritativePublishedGraceUntil;
    nextRecord.missing_from_source_confirmations = authoritativeMissingConfirmations;
    nextRecord.required_missing_confirmations = authoritativeRequiredMissingConfirmations;
    nextRecord.resurfacing_priority_score = authoritativeResurfacingPriorityScore;
  } else {
    nextRecord.first_published_at = stringifySafe(existing.first_published_at);
    nextRecord.last_verified_at = stringifySafe(existing.last_verified_at);
    nextRecord.expires_at = stringifySafe(existing.expires_at);
    nextRecord.stale_reason = stringifySafe(existing.stale_reason);
    nextRecord.verification_status = stringifySafe(existing.verification_status) || "needs_review";
    nextRecord.verification_method = stringifySafe(existing.verification_method);
    nextRecord.published_grace_until = authoritativePublishedGraceUntil;
    nextRecord.missing_from_source_confirmations = authoritativeMissingConfirmations;
    nextRecord.required_missing_confirmations = authoritativeRequiredMissingConfirmations;
    nextRecord.resurfacing_priority_score = authoritativeResurfacingPriorityScore;
  }

  nextRecord.__merge_stats = mergeStats;
  return nextRecord;
}

function isPublishedPublicJobRecord(record) {
  return Boolean(
    record &&
    record.record_type === "job" &&
    String(record.status || "").toLowerCase() === "published" &&
    record.published === true &&
    record.public_visibility === true
  );
}

function shouldPreserveNonPublishedJobRecord(record) {
  if (!record || record.record_type !== "job") return false;
  if (isPublishedPublicJobRecord(record)) return false;
  const status = String(record.status || "").toLowerCase();
  if (["archived", "rejected"].includes(status)) return true;
  if (Array.isArray(record.manual_overrides) && record.manual_overrides.length) return true;
  if (Array.isArray(record.protected_fields) && record.protected_fields.length) return true;
  if (hasMeaningfulText(record.admin_notes)) return true;
  return false;
}

async function readJobRecords() {
  const records = await readJson(JOB_RECORDS_FILE, []);
  return Array.isArray(records) ? records : [];
}

async function syncJobRecordStore(publicJobs, options = {}) {
  const logger = options.logger || console;
  const label = options.label || "jobs:record-store";
  const context = stringifySafe(options.context) || "public_export_sync";
  const preserveMissingPublishedRecords = options.preserveMissingPublishedRecords !== false;
  const existingRecords = await readJobRecords();
  const byFingerprint = new Map();
  const byId = new Map();

  existingRecords.forEach((record) => {
    if (record.record_type !== "job") return;
    const fingerprint = stringifySafe(record.source_fingerprint);
    if (fingerprint) byFingerprint.set(fingerprint, record);
    if (record.id) byId.set(String(record.id), record);
  });

  const nextRecords = publicJobs.map((job) => {
    const fingerprint = buildJobFingerprint(job);
    const existing = byFingerprint.get(fingerprint) || byId.get(String(job.id || "")) || {};
    return buildJobRecord(job, existing, { context });
  });
  const existingPublishedBefore = existingRecords.filter(isPublishedPublicJobRecord);
  const existingProtectedNonPublished = existingRecords.filter(shouldPreserveNonPublishedJobRecord);
  const nextRecordIds = new Set(nextRecords.map((record) => String(record.id || "")).filter(Boolean));
  const nextFingerprints = new Set(nextRecords.map((record) => stringifySafe(record.source_fingerprint)).filter(Boolean));
  const preservedPublishedRecords = preserveMissingPublishedRecords
    ? existingPublishedBefore.filter((record) => {
      const id = String(record.id || "");
      const fingerprint = stringifySafe(record.source_fingerprint);
      return !nextRecordIds.has(id) && (!fingerprint || !nextFingerprints.has(fingerprint));
    })
    : [];
  const preservedProtectedRecords = existingProtectedNonPublished.filter((record) => {
    const id = String(record.id || "");
    const fingerprint = stringifySafe(record.source_fingerprint);
    return !nextRecordIds.has(id) && (!fingerprint || !nextFingerprints.has(fingerprint));
  });
  const mergedRecords = [...nextRecords, ...preservedPublishedRecords, ...preservedProtectedRecords];
  const existingSizeBeforeBytes = serializedByteLength(existingRecords);
  let recordsTruncatedCount = 0;
  const mergeStats = {
    salary_preserved_manual_count: 0,
    salary_source_overwrite_blocked_count: 0,
    location_preserved_manual_count: 0,
    description_preserved_manual_count: 0
  };
  const sanitizedMergedRecords = mergedRecords.map((record) => {
    const recordStats = record.__merge_stats || {};
    mergeStats.salary_preserved_manual_count += Number(recordStats.salary_preserved_manual_count || 0);
    mergeStats.salary_source_overwrite_blocked_count += Number(recordStats.salary_source_overwrite_blocked_count || 0);
    mergeStats.location_preserved_manual_count += Number(recordStats.location_preserved_manual_count || 0);
    mergeStats.description_preserved_manual_count += Number(recordStats.description_preserved_manual_count || 0);
    const sanitized = sanitizeJobRecordForStorage(record);
    if (sanitized.meta.truncated) {
      recordsTruncatedCount += 1;
    }
    return sanitized.record;
  });
  const publishedAfter = sanitizedMergedRecords.filter(isPublishedPublicJobRecord).length;
  const sizeAfterBytes = serializedByteLength(sanitizedMergedRecords);
  const largestRecordSizeKbAfter = sanitizedMergedRecords.reduce((largest, record) => {
    return Math.max(largest, serializedByteLength(record) / 1024);
  }, 0);

  const changed = await writeJsonIfChanged(JOB_RECORDS_FILE, sanitizedMergedRecords);
  logger.log(
    `[${label}] existing_published_before=${existingPublishedBefore.length} published_preserved=${preservedPublishedRecords.length} protected_non_published_preserved=${preservedProtectedRecords.length} published_after=${publishedAfter} total_records=${sanitizedMergedRecords.length} changed=${changed}`
  );
  logger.log(
    `[${label}] job_records_count=${sanitizedMergedRecords.length} job_records_size_mb_before=${toMegabytes(existingSizeBeforeBytes)} job_records_size_mb_after=${toMegabytes(sizeAfterBytes)} largest_record_size_kb_after=${largestRecordSizeKbAfter.toFixed(2)} records_truncated_count=${recordsTruncatedCount}`
  );
  logger.log(
    `[${label}] salary_preserved_manual_count=${mergeStats.salary_preserved_manual_count} salary_source_overwrite_blocked_count=${mergeStats.salary_source_overwrite_blocked_count} location_preserved_manual_count=${mergeStats.location_preserved_manual_count} description_preserved_manual_count=${mergeStats.description_preserved_manual_count}`
  );
  return sanitizedMergedRecords;
}

module.exports = {
  EMPLOYERS_FILE,
  JOB_RECORDS_FILE,
  TALENT_PROFILES_FILE,
  buildJobRecord,
  buildJobFingerprint,
  readJobRecords,
  sanitizeJobRecordForStorage,
  syncJobRecordStore,
  toDisplayJob
};
