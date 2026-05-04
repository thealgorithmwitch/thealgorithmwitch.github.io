const { ensureArray, stableHash, stringifySafe, todayIso } = require("./job-normalizer");
const { normalizeProvider } = require("./source-utils");

function ensureDefault(values) {
  return Array.isArray(values) && values.length ? values[0] : "";
}

function normalizeAtsSlug(value, { stripTrailingBackslashes = false } = {}) {
  let normalized = String(value || "").trim();
  if (stripTrailingBackslashes) {
    normalized = normalized.replace(/\\+$/g, "");
  }
  normalized = normalized.replace(/^\/+|\/+$/g, "");
  return normalized.trim();
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
    salary: salaryMetadata?.value || job.compensation || job.salary || "",
    sector: source.sector,
    function: teamMetadata?.value || ensureDefault(source.function_defaults),
    experience: levelMetadata?.value || "",
    source: "Greenhouse",
    source_url: job.absolute_url || "",
    apply_url: job.absolute_url || "",
    date_posted: job.updated_at || job.first_published || todayIso(),
    raw_description: job.content || "",
    description: job.content || job.internal_job_id || "",
    tags: [source.sector, "greenhouse", ...ensureArray(source.function_defaults)].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Greenhouse board token ${source.board_token}.`,
    raw_payload: job
  };
}

async function fetchGreenhouseJobsForSource(source) {
  const boardToken = normalizeAtsSlug(source.board_token);
  if (!boardToken) {
    throw new Error("Missing Greenhouse board slug.");
  }
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
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

function extractGreenhouseBoardToken(value) {
  const text = String(value || "");
  const match =
    text.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([^/?#"'&<>\s]+)(?:\/jobs)?/i) ||
    text.match(/greenhouse\.io\/([^/?#"'&<>\s]+)(?:\/jobs)?/i);
  return match ? match[1] : "";
}

function leverJobToSchema(source, job) {
  const categories = job.categories || {};
  const location = stringifySafe(categories.location) || stringifySafe(job.location) || "Location listed on application";
  const salaryCandidate = job.salary || job.salaryDescriptionPlain || job.salaryDescription || job.salaryRange || job.compensation || "";
  const descriptionCandidate = job.descriptionPlain || job.descriptionBodyPlain || job.description || job.descriptionBody || "";

  return {
    id: `${source.organization}-${job.id || job.text}`,
    external_id: job.id
      ? `lever_${source.id}_${job.id}`
      : `lever_${stableHash(`${source.id}:${job.text || ""}:${job.hostedUrl || job.applyUrl || ""}`)}`,
    title: stringifySafe(job.text) || stringifySafe(job.title),
    organization: source.organization,
    location,
    job_type: stringifySafe(categories.commitment) || "Full-time",
    sector: source.sector,
    function: stringifySafe(categories.team) || stringifySafe(categories.department) || ensureDefault(source.function_defaults),
    workplace_type: stringifySafe(categories.workplace),
    experience: stringifySafe(categories.level),
    salary: salaryCandidate,
    source: "Lever",
    source_url: stringifySafe(job.hostedUrl || job.applyUrl || job.apply_url),
    apply_url: stringifySafe(job.hostedUrl || job.applyUrl || job.apply_url),
    date_posted: job.createdAt ? new Date(job.createdAt).toISOString() : todayIso(),
    raw_description: job.description || job.descriptionBody || job.descriptionPlain || "",
    description: descriptionCandidate,
    tags: [source.sector, categories.team, categories.department, "lever"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Lever company slug ${source.company_slug}.`,
    raw_payload: job
  };
}

async function fetchLeverJobsForSource(source) {
  const originalSlug = String(source.company_slug || "");
  const companySlug = normalizeAtsSlug(originalSlug, { stripTrailingBackslashes: true });
  if (originalSlug && companySlug !== originalSlug.trim()) {
    console.warn(`[sync-lever] Normalized Lever slug for ${source.organization}: ${originalSlug} -> ${companySlug}`);
  }
  if (!companySlug) {
    throw new Error("Missing Lever company slug.");
  }
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(companySlug)}?mode=json`;
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

function extractLeverCompanySlug(value) {
  const text = String(value || "");
  const match = text.match(/jobs\.lever\.co\/([^/?#"'&<>\s]+)/i) || text.match(/api\.lever\.co\/v0\/postings\/([^/?#"'&<>\s]+)/i);
  return match ? match[1] : "";
}

function ashbyJobToSchema(source, job) {
  const location = stringifySafe(job.locationName) || stringifySafe(job.location) || stringifySafe(job.primaryLocation) || "Location listed on application";
  const compensation =
    job.compensation?.summary ||
    job.salaryTierSummary ||
    job.salary ||
    job.compensation ||
    "";

  return {
    id: `${source.organization}-${job.id || job.jobPostingId || job.title}`,
    external_id: job.id || job.jobPostingId
      ? `ashby_${source.id}_${job.id || job.jobPostingId}`
      : `ashby_${stableHash(`${source.id}:${job.title || ""}:${job.applyUrl || ""}`)}`,
    title: stringifySafe(job.title),
    organization: source.organization,
    location,
    job_type: stringifySafe(job.employmentType) || stringifySafe(job.commitment) || "Full-time",
    sector: source.sector,
    function: stringifySafe(job.team?.name) || stringifySafe(job.department?.name) || ensureDefault(source.function_defaults),
    workplace_type: stringifySafe(job.workplaceType),
    experience: stringifySafe(job.seniority),
    salary: compensation,
    source: "Ashby",
    source_url: stringifySafe(job.applyUrl || source.source_url),
    apply_url: stringifySafe(job.applyUrl || source.source_url),
    date_posted: job.publishedDate || todayIso(),
    raw_description: job.descriptionHtml || job.description || "",
    description: job.description || job.descriptionHtml || "",
    tags: [source.sector, job.team?.name, job.department?.name, "ashby"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Ashby organization slug ${source.organization_slug}.`,
    raw_payload: job
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

function extractAshbyOrganizationSlug(value) {
  const text = String(value || "");
  const match = text.match(/jobs\.ashbyhq\.com\/([^/?#"'&<>\s]+)/i);
  return match ? match[1] : "";
}

function bambooHrJobToSchema(source, job) {
  return {
    id: `${source.organization}-${job.id || job.jobOpeningId || job.jobTitle}`,
    external_id: job.id || job.jobOpeningId
      ? `bamboohr_${source.id}_${job.id || job.jobOpeningId}`
      : `bamboohr_${stableHash(`${source.id}:${job.jobTitle || job.title || ""}:${job.jobLink || source.source_url || ""}`)}`,
    title: stringifySafe(job.jobTitle) || stringifySafe(job.title),
    organization: source.organization,
    location: stringifySafe(job.location) || "Location listed on application",
    job_type: stringifySafe(job.employmentType) || "Full-time",
    sector: source.sector,
    function: stringifySafe(job.department) || ensureDefault(source.function_defaults),
    workplace_type: stringifySafe(job.workplaceType),
    salary: job.salary || job.compensation || job.pay || "",
    source: "BambooHR",
    source_url: stringifySafe(job.jobLink || source.source_url),
    apply_url: stringifySafe(job.jobLink || source.source_url),
    date_posted: job.postedDate || todayIso(),
    raw_description: job.description || "",
    description: job.description || "",
    tags: [source.sector, job.department, "bamboohr"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from BambooHR company slug ${source.company_slug || ""}.`,
    raw_payload: job
  };
}

async function fetchBambooHrJobsForSource(source) {
  const companySlug =
    source.company_slug ||
    String(source.source_url || "").replace(/^https?:\/\//i, "").split(".")[0];
  const url = source.api_url || (companySlug ? `https://${companySlug}.bamboohr.com/careers/list` : "");

  if (!url) {
    throw new Error("Needs endpoint discovery or explicit BambooHR API URL.");
  }

  console.log(`[sync-bamboohr] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload) ? payload : Array.isArray(payload.jobs) ? payload.jobs : [];
  console.log(`[sync-bamboohr] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => bambooHrJobToSchema(source, job));
}

function recruiteeJobToSchema(source, job) {
  const descriptionCandidate =
    stringifySafe(job.translations?.en?.description) ||
    stringifySafe(job.description) ||
    stringifySafe(job.description_html) ||
    "";
  const salaryCandidate =
    job.salary ||
    job.compensation ||
    job.pay ||
    job.translations?.en?.salary ||
    job.translations?.en?.compensation ||
    job.raw_compensation ||
    "";

  return {
    id: `${source.organization}-${job.id || job.slug || job.title}`,
    external_id: job.id
      ? `recruitee_${source.id}_${job.id}`
      : `recruitee_${stableHash(`${source.id}:${job.title || ""}:${job.careers_url || job.url || ""}`)}`,
    title: stringifySafe(job.title),
    organization: source.organization,
    location: stringifySafe(job.location) || "Location listed on application",
    job_type: stringifySafe(job.employment_type) || "Full-time",
    sector: source.sector,
    function: stringifySafe(job.department) || stringifySafe(job.team) || ensureDefault(source.function_defaults),
    workplace_type: job.remote ? "Remote" : stringifySafe(job.workplace_type),
    salary: salaryCandidate,
    source: "Recruitee",
    source_url: stringifySafe(job.careers_url || job.url || source.source_url),
    apply_url: stringifySafe(job.careers_url || job.url || source.source_url),
    date_posted: job.created_at || todayIso(),
    raw_description: job.description_html || descriptionCandidate || "",
    description: descriptionCandidate || job.description_html || "",
    tags: [source.sector, job.department, job.team, "recruitee"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Recruitee company slug ${source.company_slug}.`,
    raw_payload: job
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

function extractRecruiteeCompanySlug(value) {
  const text = String(value || "");
  const match = text.match(/^https?:\/\/([^./]+)\.recruitee\.com/i);
  return match ? match[1] : "";
}

function smartRecruitersJobToSchema(source, job) {
  return {
    id: `${source.organization}-${job.id || job.ref || job.name}`,
    external_id: job.id
      ? `smartrecruiters_${source.id}_${job.id}`
      : `smartrecruiters_${stableHash(`${source.id}:${job.name || ""}:${job.applyUrl || job.ref || ""}`)}`,
    title: stringifySafe(job.name || job.title),
    organization: source.organization,
    location: stringifySafe(job.location?.city || job.location?.region || job.location?.country || job.location) || "Location listed on application",
    job_type: stringifySafe(job.typeOfEmployment?.label || job.jobAd?.employmentType || job.typeOfEmployment),
    sector: source.sector,
    function: stringifySafe(job.department?.label || job.department),
    workplace_type: job.location?.remote || job.remote ? "Remote" : stringifySafe(job.workplaceType),
    salary: stringifySafe(job.compensation?.description || job.salary),
    source: "SmartRecruiters",
    source_url: stringifySafe(job.ref || job.applyUrl || source.source_url),
    apply_url: stringifySafe(job.ref || job.applyUrl || source.source_url),
    date_posted: job.releasedDate || todayIso(),
    raw_description: stringifySafe(job.jobAd?.sections?.jobDescription?.text || job.jobAd?.sections?.qualifications?.text || ""),
    description: stringifySafe(job.jobAd?.sections?.jobDescription?.text || job.jobAd?.sections?.qualifications?.text || ""),
    tags: [source.sector, stringifySafe(job.department?.label || job.department), "smartrecruiters"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from SmartRecruiters company ${source.company_slug}.`,
    raw_payload: job
  };
}

async function fetchSmartRecruitersJobsForSource(source) {
  const companySlug =
    source.company_slug ||
    String(source.source_url || "").match(/smartrecruiters\.com\/([^/?#"'&<>\s]+)/i)?.[1] ||
    "";

  if (!companySlug) {
    throw new Error("Missing SmartRecruiters company slug.");
  }

  const url = source.api_url || `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companySlug)}/postings?limit=100`;
  console.log(`[sync-smartrecruiters] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload.content) ? payload.content : Array.isArray(payload.data) ? payload.data : [];
  console.log(`[sync-smartrecruiters] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => smartRecruitersJobToSchema(source, job));
}

function workableJobToSchema(source, job) {
  const locationParts = [
    stringifySafe(job.location?.city),
    stringifySafe(job.location?.region),
    stringifySafe(job.location?.country)
  ].filter(Boolean);

  return {
    id: `${source.organization}-${job.id || job.shortcode || job.title}`,
    external_id: job.id
      ? `workable_${source.id}_${job.id}`
      : `workable_${stableHash(`${source.id}:${job.title || ""}:${job.url || ""}`)}`,
    title: stringifySafe(job.title),
    organization: source.organization,
    location: locationParts.join(", ") || stringifySafe(job.location) || "Location listed on application",
    job_type: stringifySafe(job.employment_type || job.type),
    sector: source.sector,
    function: stringifySafe(job.department || job.team),
    workplace_type: job.workplace || job.remote ? "Remote" : "",
    salary: stringifySafe(job.salary || job.compensation),
    source: "Workable",
    source_url: stringifySafe(job.url || source.source_url),
    apply_url: stringifySafe(job.url || source.source_url),
    date_posted: job.created_at || todayIso(),
    raw_description: stringifySafe(job.description || ""),
    description: stringifySafe(job.description || ""),
    tags: [source.sector, stringifySafe(job.department || job.team), "workable"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Workable account ${source.company_slug}.`,
    raw_payload: job
  };
}

async function fetchWorkableJobsForSource(source) {
  const companySlug =
    source.company_slug ||
    String(source.source_url || "").match(/apply\.workable\.com\/([^/?#"'&<>\s]+)/i)?.[1] ||
    "";

  if (!companySlug) {
    throw new Error("Missing Workable company slug.");
  }

  const url = source.api_url || `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(companySlug)}/jobs`;
  console.log(`[sync-workable] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const payload = await response.json();
  const jobs = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.jobs) ? payload.jobs : [];
  console.log(`[sync-workable] ${source.organization}: received ${jobs.length} jobs.`);
  return jobs.map((job) => workableJobToSchema(source, job));
}

function deriveProviderSource(source, provider, context = {}) {
  const contextText = [source.source_url, source.api_url, context.pageUrl, context.html]
    .filter(Boolean)
    .join("\n");
  const normalizedProvider = normalizeProvider(provider);

  if (normalizedProvider === "greenhouse") {
    const boardToken = normalizeAtsSlug(source.board_token || extractGreenhouseBoardToken(contextText));
    return { ...source, provider: normalizedProvider, type: "ats", board_token: boardToken };
  }
  if (normalizedProvider === "lever") {
    const companySlug = normalizeAtsSlug(source.company_slug || extractLeverCompanySlug(contextText), {
      stripTrailingBackslashes: true
    });
    return { ...source, provider: normalizedProvider, type: "ats", company_slug: companySlug };
  }
  if (normalizedProvider === "ashby") {
    const organizationSlug = source.organization_slug || extractAshbyOrganizationSlug(contextText);
    return { ...source, provider: normalizedProvider, type: "ats", organization_slug: organizationSlug };
  }
  if (normalizedProvider === "bamboohr") {
    const companySlug =
      source.company_slug ||
      String(source.source_url || context.pageUrl || "").replace(/^https?:\/\//i, "").split(".")[0];
    return { ...source, provider: normalizedProvider, type: "ats", company_slug: companySlug };
  }
  if (normalizedProvider === "recruitee") {
    const companySlug = source.company_slug || extractRecruiteeCompanySlug(contextText);
    return { ...source, provider: normalizedProvider, type: "ats", company_slug: companySlug };
  }
  if (normalizedProvider === "smartrecruiters") {
    const companySlug =
      source.company_slug ||
      String(contextText).match(/smartrecruiters\.com\/([^/?#"'&<>\s]+)/i)?.[1] ||
      "";
    return { ...source, provider: normalizedProvider, type: "ats", company_slug: companySlug };
  }
  if (normalizedProvider === "workable") {
    const companySlug =
      source.company_slug ||
      String(contextText).match(/apply\.workable\.com\/([^/?#"'&<>\s]+)/i)?.[1] ||
      "";
    return { ...source, provider: normalizedProvider, type: "ats", company_slug: companySlug };
  }
  return { ...source, provider: normalizedProvider };
}

async function fetchAtsJobsByProvider(provider, source, context = {}) {
  const derivedSource = deriveProviderSource(source, provider, context);
  const normalizedProvider = normalizeProvider(provider || derivedSource.provider || source.provider || source.type);

  if (normalizedProvider === "greenhouse") return fetchGreenhouseJobsForSource(derivedSource);
  if (normalizedProvider === "lever") return fetchLeverJobsForSource(derivedSource);
  if (normalizedProvider === "ashby") return fetchAshbyJobsForSource(derivedSource);
  if (normalizedProvider === "bamboohr") return fetchBambooHrJobsForSource(derivedSource);
  if (normalizedProvider === "recruitee") return fetchRecruiteeJobsForSource(derivedSource);
  if (normalizedProvider === "smartrecruiters") return fetchSmartRecruitersJobsForSource(derivedSource);
  if (normalizedProvider === "workable") return fetchWorkableJobsForSource(derivedSource);
  throw new Error(`Unsupported ATS provider: ${provider}`);
}

module.exports = {
  deriveProviderSource,
  fetchAtsJobsByProvider,
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  fetchAshbyJobsForSource,
  fetchBambooHrJobsForSource,
  fetchSmartRecruitersJobsForSource,
  fetchWorkableJobsForSource,
  fetchRecruiteeJobsForSource,
  greenhouseJobToSchema,
  leverJobToSchema,
  ashbyJobToSchema,
  bambooHrJobToSchema,
  smartRecruitersJobToSchema,
  workableJobToSchema,
  recruiteeJobToSchema
};
