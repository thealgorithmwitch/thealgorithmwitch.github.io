const path = require("path");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { normalizeJob, stableHash, stringifySafe, todayIso } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const JOB_RECORDS_FILE = path.join(ROOT, "job-records.json");
const TALENT_PROFILES_FILE = path.join(ROOT, "talent-profiles.json");
const EMPLOYERS_FILE = path.join(ROOT, "employers.json");

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
  const raw = record.raw_source_data || {};
  const display = record.display || {};
  const resolved = normalizeJob({
    ...raw,
    title: stringifySafe(display.title) || raw.title,
    organization: stringifySafe(display.organization) || raw.organization,
    location: stringifySafe(display.location) || raw.location,
    workplace_type: stringifySafe(display.location_type) || raw.workplace_type,
    salary: stringifySafe(display.pay_display) || raw.salary,
    salary_min: display.salary_min ?? raw.salary_min,
    salary_max: display.salary_max ?? raw.salary_max,
    job_type: stringifySafe(display.role_type) || raw.job_type,
    experience: stringifySafe(display.experience_level) || raw.experience,
    sector: stringifySafe(display.sector) || raw.sector,
    function: stringifySafe(display.function) || raw.function,
    tags: Array.isArray(display.tags) && display.tags.length ? display.tags : raw.tags,
    description: stringifySafe(display.description) || raw.description,
    source: stringifySafe(display.source_name) || raw.source,
    source_url: stringifySafe(display.source_url) || raw.source_url,
    apply_url: stringifySafe(display.application_url) || raw.apply_url,
    date_posted: stringifySafe(display.date_collected) || raw.date_posted,
    featured: typeof record.featured === "boolean" ? record.featured : raw.featured,
    status: record.published && record.public_visibility && record.status === "published" ? "published" : raw.status
  });
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

  return {
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
    display: {
      title: stringifySafe(existing.display?.title),
      organization: stringifySafe(existing.display?.organization),
      location: stringifySafe(existing.display?.location),
      location_type: stringifySafe(existing.display?.location_type),
      pay_display: stringifySafe(existing.display?.pay_display),
      salary_min: existing.display?.salary_min ?? null,
      salary_max: existing.display?.salary_max ?? null,
      role_type: stringifySafe(existing.display?.role_type),
      experience_level: stringifySafe(existing.display?.experience_level),
      sector: stringifySafe(existing.display?.sector),
      function: stringifySafe(existing.display?.function),
      tags: Array.isArray(existing.display?.tags) ? existing.display.tags : [],
      description: stringifySafe(existing.display?.description),
      source_name: stringifySafe(existing.display?.source_name),
      source_url: stringifySafe(existing.display?.source_url),
      original_url: stringifySafe(existing.display?.original_url) || normalized.source_url,
      date_collected: stringifySafe(existing.display?.date_collected) || normalized.date_posted || todayIso(),
      application_url: stringifySafe(existing.display?.application_url),
      published,
      featured: typeof existing.display?.featured === "boolean" ? existing.display.featured : Boolean(normalized.featured)
    }
  };
}

async function readJobRecords() {
  const records = await readJson(JOB_RECORDS_FILE, []);
  return Array.isArray(records) ? records : [];
}

async function syncJobRecordStore(publicJobs, options = {}) {
  const logger = options.logger || console;
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

  const changed = await writeJsonIfChanged(JOB_RECORDS_FILE, nextRecords);
  logger.log(`[jobs:record-store] ${changed ? "Updated" : "No changes to"} ${JOB_RECORDS_FILE}.`);
  return nextRecords;
}

module.exports = {
  EMPLOYERS_FILE,
  JOB_RECORDS_FILE,
  TALENT_PROFILES_FILE,
  buildJobRecord,
  buildJobFingerprint,
  readJobRecords,
  syncJobRecordStore,
  toDisplayJob
};
