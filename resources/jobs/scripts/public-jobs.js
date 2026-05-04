const { JOBS_FILE, writeJsonIfChanged } = require("./job-utils");
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
  const publicJobs = buildPublicJobsFromRecords(records);
  const wrote = await writeJsonIfChanged(JOBS_FILE, publicJobs);
  const label = options.label || "jobs:public-records";
  const logger = options.logger || console;

  logger.log(
    `[${label}] job-records published count=${publicJobs.length} jobs.json count=${publicJobs.length} wrote_jobs_json=${wrote}`
  );

  return {
    publicJobs,
    jobsCount: publicJobs.length,
    publishedCount: publicJobs.length,
    wrote
  };
}

module.exports = {
  buildPublicJobsFromRecords,
  countPublishedJobRecords,
  syncPublicJobsFromRecords
};
