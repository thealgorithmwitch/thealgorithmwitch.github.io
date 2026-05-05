const { JOBS_FILE, readJobs, serializeForWrite, writeJson } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { buildJobPagePathMap } = require("./job-page-paths");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");

function attachPublicJobPageUrls(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const { map: pagePathMap } = buildJobPagePathMap(list);
  return list.map((job) => ({
    ...job,
    page_url: pagePathMap.get(String(job.id || "")) || `./pages/${String(job.id || "job")}.html`
  }));
}

function buildPublicJobsFromRecords(records) {
  const publicJobs = (Array.isArray(records) ? records : [])
    .filter((record) => record && record.record_type === "job" && shouldShowPublicRecord(record))
    .map(resolveDisplayJobFromRecord);
  return attachPublicJobPageUrls(publicJobs);
}

function countPublishedJobRecords(records) {
  return buildPublicJobsFromRecords(records).length;
}

async function syncPublicJobsFromRecords(records, options = {}) {
  const label = options.label || "jobs:public-records";
  const logger = options.logger || console;
  const publicJobs = buildPublicJobsFromRecords(records);
  const existingJobs = await readJobs();
  const existingJobsJsonCount = Array.isArray(existingJobs) ? existingJobs.length : 0;
  const computedPublicJobsCount = publicJobs.length;
  const existingSerialized = serializeForWrite(JOBS_FILE, existingJobs);
  const nextSerialized = serializeForWrite(JOBS_FILE, publicJobs);
  const shouldWrite = existingJobsJsonCount !== computedPublicJobsCount || existingSerialized !== nextSerialized;
  let wrote = false;

  if (shouldWrite) {
    await writeJson(JOBS_FILE, publicJobs);
    wrote = true;
  }

  const finalJobs = await readJobs();
  const finalJobsJsonCount = Array.isArray(finalJobs) ? finalJobs.length : 0;
  const syncMismatch = finalJobsJsonCount !== computedPublicJobsCount;

  logger.log(
    `[${label}] existing_jobs_json_count=${existingJobsJsonCount} computed_public_jobs_count=${computedPublicJobsCount} final_jobs_json_count=${finalJobsJsonCount} wrote_jobs_json=${wrote} write_path=${JOBS_FILE} sync_mismatch=${syncMismatch}`
  );

  if (syncMismatch) {
    throw new Error(`jobs.json sync mismatch: expected ${computedPublicJobsCount} public jobs, found ${finalJobsJsonCount}`);
  }

  return {
    publicJobs,
    jobsCountBefore: existingJobsJsonCount,
    jobsCount: finalJobsJsonCount,
    jobsCountAfter: finalJobsJsonCount,
    publishedCount: computedPublicJobsCount,
    wrote
  };
}

async function main() {
  const records = await readJobRecords();
  const result = await syncPublicJobsFromRecords(records, { label: "jobs:refresh-public" });
  console.log(`[jobs:refresh-public] job_records_public_count=${result.publishedCount}`);
  console.log(`[jobs:refresh-public] jobs_json_count_before=${result.jobsCountBefore}`);
  console.log(`[jobs:refresh-public] jobs_json_count_after=${result.jobsCountAfter}`);
  console.log(`[jobs:refresh-public] page_build_safe=${result.jobsCountAfter >= result.publishedCount}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:refresh-public] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  attachPublicJobPageUrls,
  buildPublicJobsFromRecords,
  countPublishedJobRecords,
  syncPublicJobsFromRecords
};
