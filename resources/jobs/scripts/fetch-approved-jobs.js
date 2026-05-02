const {
  dedupeJobs,
  normalizeJob,
  readJobs,
  safeWritePublicJobs,
  JOBS_FILE
} = require("./job-utils");
const { syncJobRecordStore } = require("./public-records");

const EMBEDDED_FALLBACK_URL =
  "https://script.google.com/macros/s/AKfycbzOziSxt4U5KDHS1uRTzhY9zuP1lxZofCbrRYBzK6PET1DjCjvxBQ3Gc7W-SRYgKcI2/exec";

const APPS_SCRIPT_URL =
  process.env.JOBS_APPROVED_EXPORT_URL ||
  process.env.JOBS_BACKEND_URL ||
  EMBEDDED_FALLBACK_URL;

function ensureExportShape(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Apps Script response was not a JSON object.");
  }
  if (!payload.ok) {
    if (String(payload.error || "").trim() === "Invalid action.") {
      throw new Error("Apps Script returned Invalid action. Update and redeploy the Web App with the new exportApprovedJobs action first.");
    }
    throw new Error(payload.error || "Apps Script exportApprovedJobs returned an error.");
  }
  if (!Array.isArray(payload.jobs)) {
    throw new Error("Apps Script exportApprovedJobs did not return a jobs array.");
  }
  return payload.jobs;
}

function validateNormalizedJob(job) {
  if (!job.id) throw new Error("Approved job is missing id.");
  if (!job.title) throw new Error(`Approved job ${job.id} is missing title.`);
  if (!job.organization) throw new Error(`Approved job ${job.id} is missing organization.`);
  if (!job.apply_url) throw new Error(`Approved job ${job.id} is missing apply_url.`);
}

async function fetchApprovedJobs() {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Missing Apps Script URL. Set JOBS_APPROVED_EXPORT_URL or JOBS_BACKEND_URL before running this script.");
  }
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "exportApprovedJobs"
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Apps Script request failed with HTTP ${response.status}.`);
  }

  return ensureExportShape(payload);
}

async function main() {
  console.log(`[jobs:fetch-approved] Fetching approved jobs from ${APPS_SCRIPT_URL}`);
  const rawJobs = await fetchApprovedJobs();
  const existingJobs = await readJobs();

  if (!rawJobs.length) {
    console.log("[jobs:fetch-approved] No approved jobs returned; preserving existing public jobs.");
    return;
  }

  const normalized = rawJobs.map((job) => {
    const next = normalizeJob(job);
    validateNormalizedJob(next);
    return next;
  });
  const deduped = dedupeJobs([...existingJobs, ...normalized]);
  const result = await safeWritePublicJobs(deduped, {
    logger: console,
    label: "jobs:fetch-approved"
  });
  await syncJobRecordStore(result.jobs, { logger: console });

  if (!result.changed) {
    console.log(`[jobs:fetch-approved] No changes to ${JOBS_FILE}.`);
    return;
  }

  console.log(`[jobs:fetch-approved] Wrote ${result.jobs.length} jobs to ${JOBS_FILE}`);
}

main().catch((error) => {
  console.error(`[jobs:fetch-approved] ${error.message}`);
  process.exit(1);
});
