const path = require("path");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { normalizeJob, stableHash, stringifySafe, todayIso, truncateTextForStorage } = require("./job-normalizer");
const { applyPublishLifecycle, resolveDisplayJobFromRecord } = require("./lifecycle-utils");

const ROOT = path.resolve(__dirname, "..");
const JOB_RECORDS_FILE = path.join(ROOT, "job-records.json");
const TALENT_PROFILES_FILE = path.join(ROOT, "talent-profiles.json");
const EMPLOYERS_FILE = path.join(ROOT, "employers.json");
const MAX_STORED_DESCRIPTION_LENGTH = 16000;
const MAX_STORED_NOTES_LENGTH = 4000;

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
  "featured",
  "sector",
  "function",
  "specialization",
  "experience",
  "source",
  "source_url",
  "apply_url",
  "original_url",
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
  "confidence",
  "relevance_score",
  "relevance_reasons",
  "trusted",
  "auto_publish",
  "sync_origin"
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
  return {
    title: stringifySafe(display.title || normalized.title),
    organization: stringifySafe(display.organization || normalized.organization),
    location: stringifySafe(display.location || normalized.location),
    location_type: stringifySafe(display.location_type || normalized.workplace_type),
    pay_display: stringifySafe(display.pay_display || normalized.salary),
    salary_min: display.salary_min ?? normalized.salary_min ?? null,
    salary_max: display.salary_max ?? normalized.salary_max ?? null,
    role_type: stringifySafe(display.role_type || normalized.job_type),
    experience_level: stringifySafe(display.experience_level || normalized.experience),
    sector: stringifySafe(display.sector || normalized.sector),
    function: stringifySafe(display.function || normalized.function),
    tags: Array.isArray(display.tags) && display.tags.length
      ? display.tags.map((tag) => stringifySafe(tag)).filter(Boolean)
      : Array.isArray(normalized.tags)
        ? normalized.tags.map((tag) => stringifySafe(tag)).filter(Boolean)
        : [],
    description: sanitizeStoredDescription(display.description || normalized.description || normalized.raw_description, meta),
    source_name: stringifySafe(display.source_name || normalized.source),
    source_url: stringifySafe(display.source_url || normalized.source_url),
    original_url: stringifySafe(display.original_url || normalized.original_url || normalized.source_url),
    date_collected: stringifySafe(display.date_collected || normalized.date_posted || todayIso()),
    application_url: stringifySafe(display.application_url || normalized.apply_url),
    published: typeof display.published === "boolean" ? display.published : Boolean(normalized.status === "active"),
    featured: typeof display.featured === "boolean" ? display.featured : Boolean(normalized.featured)
  };
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

function buildJobRecord(job, existing = {}) {
  const normalized = normalizeJob(job);
  const sourceType =
    stringifySafe(existing.source_type) ||
    (normalized.sync_origin === "ats" ? "scraped" : normalized.sync_origin === "manual" ? "manual" : "scraped");
  const base = baseRecord("job", sourceType, existing);
  const published = existing.id
    ? Boolean(existing.published)
    : ["active", "approved", "published"].includes(String(normalized.status || "").toLowerCase());
  const status = stringifySafe(existing.status) || (published ? "published" : "pending");

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
    raw_source_data: normalized,
    display: sanitizeDisplayForStorage(existing.display || {}, normalized, { changed: false, truncated: false })
  };

  if (nextRecord.published && nextRecord.public_visibility && nextRecord.status === "published") {
    nextRecord = applyPublishLifecycle(nextRecord);
  } else {
    nextRecord.first_published_at = stringifySafe(existing.first_published_at);
    nextRecord.last_verified_at = stringifySafe(existing.last_verified_at);
    nextRecord.expires_at = stringifySafe(existing.expires_at);
    nextRecord.stale_reason = stringifySafe(existing.stale_reason);
    nextRecord.verification_status = stringifySafe(existing.verification_status) || "needs_review";
    nextRecord.verification_method = stringifySafe(existing.verification_method);
  }

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

async function readJobRecords() {
  const records = await readJson(JOB_RECORDS_FILE, []);
  return Array.isArray(records) ? records : [];
}

async function syncJobRecordStore(publicJobs, options = {}) {
  const logger = options.logger || console;
  const label = options.label || "jobs:record-store";
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
    return buildJobRecord(job, existing);
  });
  const existingPublishedBefore = existingRecords.filter(isPublishedPublicJobRecord);
  const nextRecordIds = new Set(nextRecords.map((record) => String(record.id || "")).filter(Boolean));
  const nextFingerprints = new Set(nextRecords.map((record) => stringifySafe(record.source_fingerprint)).filter(Boolean));
  const preservedPublishedRecords = existingPublishedBefore.filter((record) => {
    const id = String(record.id || "");
    const fingerprint = stringifySafe(record.source_fingerprint);
    return !nextRecordIds.has(id) && (!fingerprint || !nextFingerprints.has(fingerprint));
  });
  const mergedRecords = [...nextRecords, ...preservedPublishedRecords];
  const existingSizeBeforeBytes = serializedByteLength(existingRecords);
  let recordsTruncatedCount = 0;
  const sanitizedMergedRecords = mergedRecords.map((record) => {
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
    `[${label}] existing_published_before=${existingPublishedBefore.length} published_preserved=${preservedPublishedRecords.length} published_after=${publishedAfter} total_records=${sanitizedMergedRecords.length} changed=${changed}`
  );
  logger.log(
    `[${label}] job_records_count=${sanitizedMergedRecords.length} job_records_size_mb_before=${toMegabytes(existingSizeBeforeBytes)} job_records_size_mb_after=${toMegabytes(sizeAfterBytes)} largest_record_size_kb_after=${largestRecordSizeKbAfter.toFixed(2)} records_truncated_count=${recordsTruncatedCount}`
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
