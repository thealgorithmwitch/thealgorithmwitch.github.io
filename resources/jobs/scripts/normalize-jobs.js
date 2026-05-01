const { JOBS_FILE, normalizeJob, readJobs, writeJson } = require("./job-utils");

async function main() {
  const jobs = await readJobs();
  const normalizedJobs = jobs.map(normalizeJob).sort((a, b) => {
    return Date.parse(b.date_posted) - Date.parse(a.date_posted);
  });

  await writeJson(JOBS_FILE, normalizedJobs);
  console.log(`[normalize-jobs] Normalized ${normalizedJobs.length} jobs.`);
}

main().catch((error) => {
  console.error("[normalize-jobs] Failed:", error);
  process.exitCode = 1;
});
