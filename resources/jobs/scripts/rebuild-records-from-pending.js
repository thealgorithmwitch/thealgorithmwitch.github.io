const {
  PENDING_SYNCED_FILE,
  readJson,
  writeJson
} = require("./job-utils");
const { hasRoleSignal, normalizeJob } = require("./job-normalizer");
const { buildCanonicalPublishedDisplay } = require("./canonical-job-shape");
const { buildJobRecord, JOB_RECORDS_FILE } = require("./public-records");
const {
  applyPublishLifecycle,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
} = require("./lifecycle-utils");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { buildPagesFromJobs } = require("./generate-job-pages");
const { buildValidationReport } = require("./validate-public-data");

const BAD_PUBLIC_TITLE_PATTERN = /\b(?:previous|next|life at|our impact|faq|portugal|power of all voices)\b/i;
const ALLOWED_SINGLE_WORD_ROLE_TITLES = new Set([
  "accountant",
  "analyst",
  "architect",
  "associate",
  "consultant",
  "coordinator",
  "counsel",
  "designer",
  "developer",
  "director",
  "engineer",
  "intern",
  "lead",
  "manager",
  "operator",
  "planner",
  "producer",
  "recruiter",
  "researcher",
  "specialist",
  "strategist",
  "supervisor",
  "technician",
  "writer"
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isValidPublicUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/i.test(url.protocol)) return false;
    const full = `${url.hostname}${decodeURIComponent(url.pathname || "")}${url.search || ""}`.toLowerCase();
    if (
      /\b(?:privacy|cookie|terms|policy|search|careers?|job-openings|job-openings|featured-jobs|recently-viewed|saved-jobs|talentcommunity|login|sign[_-]in|candidate-privacy|employment-scams)\b/i.test(full)
    ) {
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function titleLooksPublicSafe(title) {
  const text = String(title || "").trim();
  if (!text) return false;
  if (BAD_PUBLIC_TITLE_PATTERN.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return ALLOWED_SINGLE_WORD_ROLE_TITLES.has(text.toLowerCase()) || hasRoleSignal(text);
}

function buildPublishedDisplay(job) {
  return buildCanonicalPublishedDisplay({ ...job, status: "published" }) || {};
}

function buildPublishedRecord(job) {
  let record = buildJobRecord({ ...job, status: "published" }, {});
  record.display = {
    ...(record.display || {}),
    ...buildPublishedDisplay(job)
  };
  record.status = "published";
  record.published = true;
  record.public_visibility = true;
  record = applyPublishLifecycle(record);
  return record;
}

async function main() {
  const pendingInput = toArray(await readJson(PENDING_SYNCED_FILE, []));
  const reviewReadyJobs = pendingInput.filter((job) => String(job.triage_bucket || "") === "review_ready");
  const skipped = [];
  const records = [];

  for (const rawJob of reviewReadyJobs) {
    const normalized = normalizeJob(rawJob);
    const resolvedUrl = normalized.original_url || normalized.apply_url || normalized.source_url;

    if (!normalized.title || !titleLooksPublicSafe(normalized.title)) {
      skipped.push({
        id: normalized.id,
        title: normalized.title,
        organization: normalized.organization,
        reason: "failed public title validation"
      });
      continue;
    }

    if (!normalized.organization) {
      skipped.push({
        id: normalized.id,
        title: normalized.title,
        organization: normalized.organization,
        reason: "missing organization after normalization"
      });
      continue;
    }

    if (!isValidPublicUrl(resolvedUrl)) {
      skipped.push({
        id: normalized.id,
        title: normalized.title,
        organization: normalized.organization,
        reason: "invalid original_url after normalization"
      });
      continue;
    }

    records.push(buildPublishedRecord({
      ...normalized,
      original_url: resolvedUrl,
      status: "published"
    }));
  }

  const publicJobs = records
    .filter((record) => record.record_type === "job" && shouldShowPublicRecord(record))
    .map((record) => resolveDisplayJobFromRecord(record));

  await writeJson(JOB_RECORDS_FILE, records);
  const publicSync = await syncPublicJobsFromRecords(records, { label: "jobs:rebuild-records" });
  const generatedPages = await buildPagesFromJobs(publicSync.publicJobs);
  const validation = await buildValidationReport({ requirePages: true });
  if (validation.hard_validation_failure_count > 0) {
    throw new Error(`hard public validation failures detected: ${validation.hard_validation_failure_count}`);
  }

  console.log(JSON.stringify({
    pending_input: pendingInput.length,
    review_ready_used: reviewReadyJobs.length,
    published_records_created: records.length,
    skipped_during_rebuild: skipped.length,
    skipped_reasons: skipped.slice(0, 20),
    public_jobs_written: publicSync.jobsCountAfter,
    generated_pages: generatedPages,
    validation: {
      public_records_count: validation.public_records_count,
      jobs_json_count: validation.jobs_json_count,
      invalid_title_count: validation.invalid_title_count,
      pending_public_overlap_count: validation.pending_public_overlap_count,
      hard_validation_failure_count: validation.hard_validation_failure_count
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(`[jobs:rebuild-records] Failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
