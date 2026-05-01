const { ensureArray, stableHash, stripHtml, todayIso } = require("./job-normalizer");

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
    external_id: job.id
      ? `greenhouse_${source.id}_${job.id}`
      : `greenhouse_${stableHash(`${source.id}:${job.title || ""}:${job.absolute_url || ""}`)}`,
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
    external_id: job.id
      ? `lever_${source.id}_${job.id}`
      : `lever_${stableHash(`${source.id}:${job.text || ""}:${job.hostedUrl || job.applyUrl || ""}`)}`,
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

function ashbyJobToSchema(source, job) {
  const location = job.locationName || job.location || job.primaryLocation || "Location listed on application";
  const compensation =
    job.compensation?.summary ||
    job.salaryTierSummary ||
    job.salary ||
    "";

  return {
    id: `${source.organization}-${job.id || job.jobPostingId || job.title}`,
    external_id: job.id || job.jobPostingId
      ? `ashby_${source.id}_${job.id || job.jobPostingId}`
      : `ashby_${stableHash(`${source.id}:${job.title || ""}:${job.applyUrl || ""}`)}`,
    title: job.title,
    organization: source.organization,
    location,
    job_type: job.employmentType || job.commitment || "Full-time",
    sector: source.sector,
    function: job.team?.name || job.department?.name || ensureDefault(source.function_defaults),
    workplace_type: job.workplaceType || "",
    experience: job.seniority || "",
    salary: String(compensation || "").trim(),
    source: "Ashby",
    source_url: job.applyUrl || source.source_url || "",
    apply_url: job.applyUrl || source.source_url || "",
    date_posted: job.publishedDate || todayIso(),
    description: stripHtml(job.description || job.descriptionHtml || ""),
    tags: [source.sector, job.team?.name, job.department?.name, "ashby"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Ashby organization slug ${source.organization_slug}.`
  };
}

async function fetchAshbyJobsForSource(source) {
  const organizationSlug =
    source.organization_slug ||
    String(source.source_url || "").replace(/^https?:\/\/jobs\.ashbyhq\.com\//i, "").split(/[/?#]/)[0];

  if (!organizationSlug) {
    throw new Error("Missing Ashby organization slug.");
  }

  const url = source.api_url || "https://jobs.ashbyhq.com/api/non-user-graphql?op=apiJobBoardWithTeams";
  console.log(`[sync-ashby] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operationName: "apiJobBoardWithTeams",
      variables: {
        organizationHostedJobsPageName: organizationSlug
      },
      query:
        "query apiJobBoardWithTeams($organizationHostedJobsPageName: String!) { jobBoard: apiJobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) { jobPostings { id jobPostingId title employmentType locationName workplaceType publishedDate applyUrl description descriptionHtml team { name } department { name } compensation { summary } } } }"
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs =
    payload?.data?.jobBoard?.jobPostings ||
    payload?.data?.apiJobBoardWithTeams?.jobPostings ||
    [];
  console.log(`[sync-ashby] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => ashbyJobToSchema(source, job));
}

function bambooHrJobToSchema(source, job) {
  return {
    id: `${source.organization}-${job.id || job.jobOpeningId || job.jobTitle}`,
    external_id: job.id || job.jobOpeningId
      ? `bamboohr_${source.id}_${job.id || job.jobOpeningId}`
      : `bamboohr_${stableHash(`${source.id}:${job.jobTitle || job.title || ""}:${job.jobLink || source.source_url || ""}`)}`,
    title: job.jobTitle || job.title,
    organization: source.organization,
    location: job.location || "Location listed on application",
    job_type: job.employmentType || "Full-time",
    sector: source.sector,
    function: job.department || ensureDefault(source.function_defaults),
    workplace_type: job.workplaceType || "",
    salary: String(job.salary || "").trim(),
    source: "BambooHR",
    source_url: job.jobLink || source.source_url || "",
    apply_url: job.jobLink || source.source_url || "",
    date_posted: job.postedDate || todayIso(),
    description: stripHtml(job.description || ""),
    tags: [source.sector, job.department, "bamboohr"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from BambooHR company slug ${source.company_slug || ""}.`
  };
}

async function fetchBambooHrJobsForSource(source) {
  if (!source.api_url) {
    throw new Error("Needs endpoint discovery or explicit BambooHR API URL.");
  }

  console.log(`[sync-bamboohr] Fetching ${source.organization} from ${source.api_url}`);
  const response = await fetch(source.api_url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload) ? payload : Array.isArray(payload.jobs) ? payload.jobs : [];
  console.log(`[sync-bamboohr] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => bambooHrJobToSchema(source, job));
}

function recruiteeJobToSchema(source, job) {
  return {
    id: `${source.organization}-${job.id || job.slug || job.title}`,
    external_id: job.id
      ? `recruitee_${source.id}_${job.id}`
      : `recruitee_${stableHash(`${source.id}:${job.title || ""}:${job.careers_url || job.url || ""}`)}`,
    title: job.title,
    organization: source.organization,
    location: job.location || "Location listed on application",
    job_type: job.employment_type || "Full-time",
    sector: source.sector,
    function: job.department || job.team || ensureDefault(source.function_defaults),
    workplace_type: job.remote ? "Remote" : "",
    salary: String(job.salary || "").trim(),
    source: "Recruitee",
    source_url: job.careers_url || job.url || source.source_url || "",
    apply_url: job.careers_url || job.url || source.source_url || "",
    date_posted: job.created_at || todayIso(),
    description: stripHtml(job.description || job.description_html || ""),
    tags: [source.sector, job.department, job.team, "recruitee"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Recruitee company slug ${source.company_slug}.`
  };
}

async function fetchRecruiteeJobsForSource(source) {
  const companySlug =
    source.company_slug ||
    String(source.source_url || "").replace(/^https?:\/\//i, "").split(".")[0];

  if (!companySlug) {
    throw new Error("Missing Recruitee company slug.");
  }

  const url = source.api_url || `https://${companySlug}.recruitee.com/api/offers/`;
  console.log(`[sync-recruitee] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload.offers) ? payload.offers : Array.isArray(payload) ? payload : [];
  console.log(`[sync-recruitee] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => recruiteeJobToSchema(source, job));
}

module.exports = {
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  fetchAshbyJobsForSource,
  fetchBambooHrJobsForSource,
  fetchRecruiteeJobsForSource,
  greenhouseJobToSchema,
  leverJobToSchema,
  ashbyJobToSchema,
  bambooHrJobToSchema,
  recruiteeJobToSchema
};
