const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  PENDING_TRIAGE_SUMMARY_FILE,
  readJson,
  writeJson
} = require("./job-utils");
const { normalizeJob, stringifySafe, todayIso } = require("./job-normalizer");
const { buildCanonicalPublishedDisplay } = require("./canonical-job-shape");
const { triagePendingJobs } = require("./pending-triage");
const { buildJobRecord, JOB_RECORDS_FILE } = require("./public-records");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { buildPagesFromJobs } = require("./generate-job-pages");
const { buildValidationReport } = require("./validate-public-data");

const FORCE_REBUILD_DISPLAY = true;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return stringifySafe(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTextEquivalent(left, right) {
  return normalizeText(left).toLowerCase() === normalizeText(right).toLowerCase();
}

function normalizedTags(value) {
  return toArray(value)
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter(Boolean)
    .sort();
}

function normalizeNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function displaysEquivalent(left = {}, right = {}) {
  return (
    normalizedTextEquivalent(left.title, right.title) &&
    normalizedTextEquivalent(left.organization, right.organization) &&
    normalizedTextEquivalent(left.location, right.location) &&
    normalizedTextEquivalent(left.location_type, right.location_type) &&
    normalizedTextEquivalent(left.pay_display, right.pay_display) &&
    normalizeNumeric(left.salary_min) === normalizeNumeric(right.salary_min) &&
    normalizeNumeric(left.salary_max) === normalizeNumeric(right.salary_max) &&
    normalizedTextEquivalent(left.role_type, right.role_type) &&
    normalizedTextEquivalent(left.experience_level, right.experience_level) &&
    normalizedTextEquivalent(left.sector, right.sector) &&
    normalizedTextEquivalent(left.function, right.function) &&
    JSON.stringify(normalizedTags(left.tags)) === JSON.stringify(normalizedTags(right.tags)) &&
    normalizedTextEquivalent(left.description, right.description) &&
    normalizedTextEquivalent(left.source_name, right.source_name) &&
    normalizedTextEquivalent(left.source_url, right.source_url) &&
    normalizedTextEquivalent(left.original_url, right.original_url) &&
    normalizedTextEquivalent(left.date_collected, right.date_collected) &&
    normalizedTextEquivalent(left.application_url, right.application_url) &&
    Boolean(left.published) === Boolean(right.published) &&
    Boolean(left.featured) === Boolean(right.featured)
  );
}

function summarizeText(value, max = 180) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function buildPublishedDisplay(normalized, existing = {}) {
  const canonical = buildCanonicalPublishedDisplay(normalized) || {};
  return {
    ...canonical,
    date_collected: stringifySafe(canonical.date_collected) || todayIso(),
    published: typeof existing.published === "boolean" ? existing.published : Boolean(existing.display?.published),
    featured: typeof existing.featured === "boolean" ? existing.featured : Boolean(existing.display?.featured)
  };
}

function countPublicRecords(records) {
  return toArray(records).filter((record) => record.record_type === "job" && shouldShowPublicRecord(record)).length;
}

function buildExample(id, beforeDisplay, afterDisplay) {
  return {
    id,
    before: {
      title: summarizeText(beforeDisplay.title),
      organization: summarizeText(beforeDisplay.organization),
      description: summarizeText(beforeDisplay.description)
    },
    after: {
      title: summarizeText(afterDisplay.title),
      organization: summarizeText(afterDisplay.organization),
      description: summarizeText(afterDisplay.description)
    }
  };
}

async function main() {
  const forceRebuildDisplay = FORCE_REBUILD_DISPLAY || process.argv.includes("--force");
  const [pendingBefore, recordsBefore, jobsBefore] = await Promise.all([
    readJson(PENDING_SYNCED_FILE, []),
    readJson(JOB_RECORDS_FILE, []),
    readJson(JOBS_FILE, [])
  ]);

  const report = {
    generated_at: new Date().toISOString(),
    force_rebuild_display: forceRebuildDisplay,
    pending_before: toArray(pendingBefore).length,
    pending_after: 0,
    public_records_before: countPublicRecords(recordsBefore),
    public_records_after: 0,
    jobs_json_before: toArray(jobsBefore).length,
    jobs_json_after: 0,
    records_updated: 0,
    rejected_noise_removed_from_pending: 0,
    examples: []
  };

  const nextRecords = toArray(recordsBefore).map((record) => {
    if (record.record_type !== "job") return record;

    const sourceInput =
      record.raw_source_data && typeof record.raw_source_data === "object" && Object.keys(record.raw_source_data).length
        ? record.raw_source_data
        : record;
    const normalized = normalizeJob(sourceInput);
    const rebuiltRecord = buildJobRecord(normalized, record);
    const previousDisplay = record.display && typeof record.display === "object" ? record.display : {};

    if (forceRebuildDisplay) {
      const nextDisplay = {
        ...buildPublishedDisplay(normalized, record),
        featured: typeof record.featured === "boolean" ? record.featured : Boolean(record.display?.featured)
      };
      rebuiltRecord.display = nextDisplay;

      if (!displaysEquivalent(previousDisplay, nextDisplay)) {
        report.records_updated += 1;
        if (report.examples.length < 12) {
          report.examples.push(buildExample(record.id, previousDisplay, nextDisplay));
        }
      }
    } else {
      rebuiltRecord.display = previousDisplay;
    }

    return rebuiltRecord;
  });

  const nextPublicJobs = nextRecords
    .filter((record) => record.record_type === "job" && shouldShowPublicRecord(record))
    .map((record) => resolveDisplayJobFromRecord(record));

  const triagedPending = await triagePendingJobs(
    toArray(pendingBefore).map((job) => normalizeJob(job)),
    nextPublicJobs,
    null
  );

  report.pending_after = triagedPending.adminPendingJobs.length;
  report.public_records_after = countPublicRecords(nextRecords);
  report.jobs_json_after = nextPublicJobs.length;
  report.rejected_noise_removed_from_pending = toArray(pendingBefore).length - triagedPending.adminPendingJobs.length;

  await Promise.all([
    writeJson(JOB_RECORDS_FILE, nextRecords),
    writeJson(PENDING_SYNCED_FILE, triagedPending.adminPendingJobs),
    writeJson(PENDING_TRIAGE_SUMMARY_FILE, triagedPending.summary)
  ]);
  const publicSync = await syncPublicJobsFromRecords(nextRecords, { label: "jobs:backfill-normalized" });
  const pagesRegenerated = await buildPagesFromJobs(publicSync.publicJobs);
  const validation = await buildValidationReport({ requirePages: true });
  if (validation.hard_validation_failure_count > 0) {
    throw new Error(`hard public validation failures detected: ${validation.hard_validation_failure_count}`);
  }

  console.log(JSON.stringify({
    ...report,
    jobs_json_after: publicSync.jobsCountAfter,
    pages_regenerated: pagesRegenerated,
    validation: {
      public_records_count: validation.public_records_count,
      jobs_json_count: validation.jobs_json_count,
      invalid_title_count: validation.invalid_title_count,
      pending_public_overlap_count: validation.pending_public_overlap_count,
      hard_validation_failure_count: validation.hard_validation_failure_count
    },
    examples: report.examples.slice(0, 12)
  }, null, 2));
}

main().catch((error) => {
  console.error(`[jobs:backfill-normalized] Failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
