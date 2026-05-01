const { JOBS_FILE, dedupeJobs, normalizeJob, readJobs, readSources, writeJson } = require("./job-utils");

function leverJobToSchema(source, job) {
  const categories = job.categories || {};
  const location = categories.location || categories.commitment || "Location listed on application";

  return normalizeJob({
    id: `${source.organization}-${job.id || job.text}`,
    title: job.text,
    organization: source.organization,
    location,
    job_type: categories.commitment || "Full-time",
    sector: source.sector,
    source: "Lever",
    source_url: job.hostedUrl || "",
    apply_url: job.applyUrl || job.hostedUrl || "",
    date_posted: job.createdAt ? new Date(job.createdAt).toISOString() : new Date().toISOString(),
    status: "active",
    description: String(job.descriptionPlain || job.description || "").replace(/\s+/g, " ").trim(),
    tags: [source.sector, categories.team, categories.department, "lever"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Lever company slug ${source.company_slug}.`
  });
}

async function syncSource(source) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.company_slug)}?mode=json`;
  console.log(`[sync-lever] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload) ? payload : [];
  console.log(`[sync-lever] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => leverJobToSchema(source, job));
}

async function main() {
  const [existingJobs, sources] = await Promise.all([readJobs(), readSources()]);
  const leverSources = sources.filter((source) => source.enabled && source.type === "lever");

  if (!leverSources.length) {
    console.log("[sync-lever] No enabled Lever sources.");
    return;
  }

  const preservedJobs = existingJobs.filter((job) => job.source !== "Lever");
  const syncedJobs = [];

  for (const source of leverSources) {
    try {
      const jobs = await syncSource(source);
      syncedJobs.push(...jobs);
    } catch (error) {
      console.error(`[sync-lever] Skipping ${source.organization}: ${error.message}`);
    }
  }

  const mergedJobs = dedupeJobs([...preservedJobs, ...syncedJobs]);
  await writeJson(JOBS_FILE, mergedJobs);
  console.log(`[sync-lever] Wrote ${mergedJobs.length} total jobs.`);
}

main().catch((error) => {
  console.error("[sync-lever] Failed:", error);
  process.exitCode = 1;
});
