const { JOBS_FILE, readJobs, serializeForWrite, writeJson } = require("./job-utils");
const { buildJobPagePathMap } = require("./job-page-paths");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");

function buildPublicJobsFromRecords(records) {
  const publicJobs = (Array.isArray(records) ? records : [])
    .filter((record) => record && record.record_type === "job" && shouldShowPublicRecord(record))
    .map(resolveDisplayJobFromRecord);
  const { map: pagePathMap } = buildJobPagePathMap(publicJobs);
  return publicJobs.map((job) => ({
    ...job,
    page_url: pagePathMap.get(String(job.id || "")) || `./pages/${String(job.id || "job")}.html`
  }));
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
    jobsCount: finalJobsJsonCount,
    publishedCount: computedPublicJobsCount,
    wrote
  };
}

module.exports = {
  buildPublicJobsFromRecords,
  countPublishedJobRecords,
  syncPublicJobsFromRecords
};
