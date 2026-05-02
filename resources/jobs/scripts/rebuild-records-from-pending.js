const {
  PENDING_SYNCED_FILE,
  readJson,
  safeWritePublicJobs,
  writeJson
} = require("./job-utils");
const { normalizeJob } = require("./job-normalizer");
const { triagePendingJobs } = require("./pending-triage");
const { buildJobRecord, JOB_RECORDS_FILE } = require("./public-records");
const {
  applyPublishLifecycle,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
} = require("./lifecycle-utils");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPublishedRecord(job) {
  let record = buildJobRecord({ ...job, status: "published" }, {});
  record.status = "published";
  record.published = true;
  record.public_visibility = true;
  record = applyPublishLifecycle(record);
  return record;
}

async function main() {
  const pendingInput = toArray(await readJson(PENDING_SYNCED_FILE, []));
  const normalizedPending = pendingInput.map((job) => normalizeJob(job));
  const triaged = await triagePendingJobs(normalizedPending, [], null);
  const publishableJobs = triaged.adminPendingJobs.filter((job) => String(job.triage_bucket || "") === "review_ready");
  const records = publishableJobs.map((job) => buildPublishedRecord(job));
  const publicJobs = records
    .filter((record) => record.record_type === "job" && shouldShowPublicRecord(record))
    .map((record) => resolveDisplayJobFromRecord(record));

  await writeJson(JOB_RECORDS_FILE, records);
  await safeWritePublicJobs(publicJobs, { label: "jobs:rebuild-records" });

  console.log(JSON.stringify({
    pending_input: pendingInput.length,
    published_records_created: records.length,
    rejected_during_rebuild: pendingInput.length - records.length,
    review_ready_used: publishableJobs.length,
    needs_cleanup_skipped: triaged.adminPendingJobs.filter((job) => String(job.triage_bucket || "") === "needs_cleanup").length,
    rejected_noise_filtered: triaged.rejectedNoiseJobs.length,
    public_jobs_written: publicJobs.length
  }, null, 2));
}

main().catch((error) => {
  console.error(`[jobs:rebuild-records] Failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
