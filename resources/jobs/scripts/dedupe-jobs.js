const { JOBS_FILE, dedupeJobs, readJobs, writeJson } = require("./job-utils");

async function main() {
  const jobs = await readJobs();
  const dedupedJobs = dedupeJobs(jobs);

  await writeJson(JOBS_FILE, dedupedJobs);
  console.log(`[dedupe-jobs] Reduced ${jobs.length} jobs to ${dedupedJobs.length} unique records.`);
}

main().catch((error) => {
  console.error("[dedupe-jobs] Failed:", error);
  process.exitCode = 1;
});
