const {
  JOBS_FILE,
  PENDING_FILE,
  dedupeJobs,
  normalizeJob,
  readJobs,
  readPendingJobs,
  writeJson
} = require("./job-utils");

async function main() {
  const [jobs, pendingJobs] = await Promise.all([readJobs(), readPendingJobs()]);
  const approvedJobs = pendingJobs
    .filter((job) => String(job.status || "").toLowerCase() === "approved")
    .map((job) =>
      normalizeJob({
        ...job,
        status: "active",
        date_posted: job.date_posted || job.date_submitted
      })
    );

  if (!approvedJobs.length) {
    console.log("[merge-approved-jobs] No approved jobs found in pending-jobs.json.");
    return;
  }

  const mergedJobs = dedupeJobs([...jobs, ...approvedJobs]);
  const remainingPendingJobs = pendingJobs.map((job) => {
    if (String(job.status || "").toLowerCase() === "approved") {
      return { ...job, status: "merged" };
    }
    return job;
  });

  await Promise.all([writeJson(JOBS_FILE, mergedJobs), writeJson(PENDING_FILE, remainingPendingJobs)]);
  console.log(`[merge-approved-jobs] Merged ${approvedJobs.length} approved jobs into jobs.json.`);
}

main().catch((error) => {
  console.error("[merge-approved-jobs] Failed:", error);
  process.exitCode = 1;
});
