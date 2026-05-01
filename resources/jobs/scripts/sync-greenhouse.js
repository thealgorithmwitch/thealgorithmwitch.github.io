const { JOBS_FILE, dedupeJobs, normalizeJob, readJobs, readSources, writeJson } = require("./job-utils");

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveLocation(job) {
  if (Array.isArray(job.location?.name)) {
    return job.location.name.join(" / ");
  }
  if (typeof job.location?.name === "string" && job.location.name.trim()) {
    return job.location.name.trim();
  }
  if (Array.isArray(job.offices) && job.offices.length) {
    return job.offices.map((office) => office.name).filter(Boolean).join(" / ");
  }
  return "Location listed on application";
}

function greenhouseJobToSchema(source, job) {
  const metadata = Array.isArray(job.metadata) ? job.metadata : [];
  const employmentType = metadata.find((item) => /employment|type/i.test(item.name || ""));

  return normalizeJob({
    id: `${source.organization}-${job.id}`,
    title: job.title,
    organization: source.organization,
    location: deriveLocation(job),
    job_type: employmentType?.value || "Full-time",
    sector: source.sector,
    source: "Greenhouse",
    source_url: job.absolute_url || "",
    apply_url: job.absolute_url || "",
    date_posted: job.updated_at || job.first_published || new Date().toISOString(),
    status: "active",
    description: stripHtml(job.content || job.internal_job_id || ""),
    tags: [source.sector, "greenhouse"],
    shared_by: "ATS Sync",
    notes: `Synced from Greenhouse board token ${source.board_token}.`
  });
}

async function syncSource(source) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board_token)}/jobs?content=true`;
  console.log(`[sync-greenhouse] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  console.log(`[sync-greenhouse] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => greenhouseJobToSchema(source, job));
}

async function main() {
  const [existingJobs, sources] = await Promise.all([readJobs(), readSources()]);
  const greenhouseSources = sources.filter((source) => source.enabled && source.type === "greenhouse");

  if (!greenhouseSources.length) {
    console.log("[sync-greenhouse] No enabled Greenhouse sources.");
    return;
  }

  const preservedJobs = existingJobs.filter((job) => job.source !== "Greenhouse");
  const syncedJobs = [];

  for (const source of greenhouseSources) {
    try {
      const jobs = await syncSource(source);
      syncedJobs.push(...jobs);
    } catch (error) {
      console.error(`[sync-greenhouse] Skipping ${source.organization}: ${error.message}`);
    }
  }

  const mergedJobs = dedupeJobs([...preservedJobs, ...syncedJobs]);
  await writeJson(JOBS_FILE, mergedJobs);
  console.log(`[sync-greenhouse] Wrote ${mergedJobs.length} total jobs.`);
}

main().catch((error) => {
  console.error("[sync-greenhouse] Failed:", error);
  process.exitCode = 1;
});
