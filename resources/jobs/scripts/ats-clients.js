const { ensureArray, stripHtml, todayIso } = require("./job-normalizer");

function ensureDefault(values) {
  return Array.isArray(values) && values.length ? values[0] : "";
}

function deriveGreenhouseLocation(job) {
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
  const salaryMetadata = metadata.find((item) => /salary|compensation|pay/i.test(item.name || ""));
  const teamMetadata = metadata.find((item) => /department|team|function/i.test(item.name || ""));
  const levelMetadata = metadata.find((item) => /seniority|experience|level/i.test(item.name || ""));

  return {
    id: `${source.organization}-${job.id}`,
    external_id: String(job.id || ""),
    title: job.title,
    organization: source.organization,
    location: deriveGreenhouseLocation(job),
    job_type: employmentType?.value || "Full-time",
    salary: salaryMetadata?.value || "",
    sector: source.sector,
    function: teamMetadata?.value || ensureDefault(source.function_defaults),
    experience: levelMetadata?.value || "",
    source: "Greenhouse",
    source_url: job.absolute_url || "",
    apply_url: job.absolute_url || "",
    date_posted: job.updated_at || job.first_published || todayIso(),
    description: stripHtml(job.content || job.internal_job_id || ""),
    tags: [source.sector, "greenhouse", ...ensureArray(source.function_defaults)].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Greenhouse board token ${source.board_token}.`
  };
}

async function fetchGreenhouseJobsForSource(source) {
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

function leverJobToSchema(source, job) {
  const categories = job.categories || {};
  const location = categories.location || categories.commitment || "Location listed on application";

  return {
    id: `${source.organization}-${job.id || job.text}`,
    external_id: String(job.id || job.hostedUrl || job.applyUrl || job.text || ""),
    title: job.text,
    organization: source.organization,
    location,
    job_type: categories.commitment || "Full-time",
    sector: source.sector,
    function: categories.team || categories.department || ensureDefault(source.function_defaults),
    workplace_type: categories.workplace || "",
    experience: categories.level || "",
    salary: String(job.salary || "").trim(),
    source: "Lever",
    source_url: job.hostedUrl || "",
    apply_url: job.hostedUrl || job.applyUrl || "",
    date_posted: job.createdAt ? new Date(job.createdAt).toISOString() : todayIso(),
    description: String(job.descriptionPlain || stripHtml(job.description || "")).replace(/\s+/g, " ").trim(),
    tags: [source.sector, categories.team, categories.department, "lever"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Lever company slug ${source.company_slug}.`
  };
}

async function fetchLeverJobsForSource(source) {
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

module.exports = {
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  greenhouseJobToSchema,
  leverJobToSchema
};
