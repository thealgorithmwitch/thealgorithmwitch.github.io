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

function decodeHtmlEntities(value) {
  const entityMap = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    const lower = String(entity || "").toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    }
    return Object.prototype.hasOwnProperty.call(entityMap, lower) ? entityMap[lower] : _;
  });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractEmbeddedJsonAssignment(html, variableName) {
  const escapedVariableName = String(variableName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(`${escapedVariableName}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`, "i"));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function extractEmbeddedJsonLd(html) {
  const match = String(html || "").match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function resolvePaylocityUrl(value) {
  const text = stringifySafe(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `https://recruiting.paylocity.com${text}`;
  return `https://recruiting.paylocity.com/${text.replace(/^\/+/, "")}`;
}

async function fetchHtml(url) {
  const response = await fetch(url);
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return {
    html,
    finalUrl: response.url || url
  };
}

function extractPaylocityBoardLink(html) {
  const directMatch = String(html || "").match(/https?:\/\/recruiting\.paylocity\.com\/recruiting\/jobs\/all\/[^"'\\\s<]+/i);
  if (directMatch) return directMatch[0];
  const relativeMatch = String(html || "").match(/\/Recruiting\/Jobs\/All\/[^"'\\\s<]+/i);
  return relativeMatch ? resolvePaylocityUrl(relativeMatch[0]) : "";
}

function paylocityJobToSchema(source, boardData, job, detail = {}) {
  const detailPayload = detail.jsonLd || {};
  const salaryValue = detailPayload?.baseSalary?.value || {};
  const salary = salaryValue.minValue || salaryValue.maxValue
    ? [salaryValue.minValue, salaryValue.maxValue]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map((value) => Number(value).toLocaleString("en-US"))
      .join(" - ")
    : "";
  const salaryUnit = stringifySafe(salaryValue.unitText);
  const applyUrl = resolvePaylocityUrl(detail.applyPath || `/Recruiting/Jobs/Apply/${job.JobId}`);
  const sourceUrl = resolvePaylocityUrl(detail.detailUrl || `/Recruiting/Jobs/Details/${job.JobId}`);
  const location = [
    stringifySafe(job.JobLocation?.City || job.JobLocation?.Name || job.LocationName),
    stringifySafe(job.JobLocation?.State)
  ]
    .filter(Boolean)
    .join(", ")
    || stringifySafe(job.LocationName)
    || "Location listed on application";
  const descriptionHtml = stringifySafe(detailPayload.description);
  const descriptionText = stripHtml(descriptionHtml);

  return {
    id: `${source.organization}-${job.JobId || job.JobTitle}`,
    external_id: job.JobId
      ? `paylocity_${source.id}_${job.JobId}`
      : `paylocity_${stableHash(`${source.id}:${job.JobTitle || ""}:${sourceUrl}`)}`,
    title: stringifySafe(job.JobTitle),
    organization: stringifySafe(source.organization || boardData.ModuleTitle || boardData.moduleName),
    location,
    job_type: stringifySafe(detail.jobType),
    sector: source.sector,
    function: stringifySafe(job.HiringDepartment) || ensureDefault(source.function_defaults),
    workplace_type: job.IsRemote ? "Remote" : "",
    salary: salary && salaryUnit ? `${salary} (${salaryUnit})` : salary,
    source: "Paylocity",
    source_url: sourceUrl,
    apply_url: applyUrl,
    date_posted: detailPayload.datePosted || job.PublishedDate || todayIso(),
    raw_description: descriptionHtml,
    description: descriptionText,
    tags: [source.sector, stringifySafe(job.HiringDepartment), "paylocity"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Paylocity employer careers board ${resolvePaylocityUrl(boardData?.boardUrl || source.source_url)}.`,
    raw_payload: {
      job_id: job.JobId || null,
      title: stringifySafe(job.JobTitle),
      location_name: stringifySafe(job.LocationName),
      hiring_department: stringifySafe(job.HiringDepartment),
      published_date: stringifySafe(job.PublishedDate),
      apply_url: applyUrl,
      source_url: sourceUrl,
      job_type: stringifySafe(detail.jobType)
    }
  };
}

async function fetchPaylocityJobsForSource(source) {
  const initialBoardUrl = resolvePaylocityUrl(source.api_url || source.source_url || source.url);
  if (!initialBoardUrl) {
    throw new Error("Missing Paylocity board URL.");
  }

  console.log(`[sync-paylocity] Fetching ${source.organization} from ${initialBoardUrl}`);
  let { html: boardHtml, finalUrl: boardUrl } = await fetchHtml(initialBoardUrl);
  let boardData = extractEmbeddedJsonAssignment(boardHtml, "window.pageData");

  if (!Array.isArray(boardData?.Jobs) || boardData.Jobs.length === 0) {
    const discoveredBoardUrl = extractPaylocityBoardLink(boardHtml);
    if (discoveredBoardUrl && discoveredBoardUrl !== initialBoardUrl) {
      console.log(`[sync-paylocity] ${source.organization}: following discovered board URL ${discoveredBoardUrl}`);
      const discovered = await fetchHtml(discoveredBoardUrl);
      boardHtml = discovered.html;
      boardUrl = discovered.finalUrl;
      boardData = extractEmbeddedJsonAssignment(boardHtml, "window.pageData");
    }
  }

  const jobs = Array.isArray(boardData?.Jobs) ? boardData.Jobs : [];
  if (!jobs.length) {
    throw new Error(`No Paylocity jobs found for ${source.organization}`);
  }

  const normalizedJobs = [];
  for (const job of jobs) {
    const detailUrl = resolvePaylocityUrl(`/Recruiting/Jobs/Details/${job.JobId}`);
    let detail = { detailUrl, applyPath: `/Recruiting/Jobs/Apply/${job.JobId}`, jobType: "", jsonLd: null };
    try {
      const { html: detailHtml } = await fetchHtml(detailUrl);
      const jsonLd = extractEmbeddedJsonLd(detailHtml);
      const applyMatch = detailHtml.match(/class="apply-link-marker[^"]*"[^>]+href="([^"]+)"/i);
      const jobTypeMatch = detailHtml.match(/<div class="job-listing-header">\s*Job Type\s*<\/div>\s*<div>\s*([^<]+?)\s*<\/div>/i);
      detail = {
        detailUrl,
        applyPath: applyMatch ? applyMatch[1] : `/Recruiting/Jobs/Apply/${job.JobId}`,
        jobType: jobTypeMatch ? decodeHtmlEntities(jobTypeMatch[1]).trim() : "",
        jsonLd
      };
    } catch (error) {
      console.warn(`[sync-paylocity] ${source.organization}: detail fetch failed for job_id=${job.JobId} error=${error.message}`);
    }
    normalizedJobs.push(paylocityJobToSchema(source, { ...boardData, boardUrl }, job, detail));
  }

  console.log(`[sync-paylocity] ${source.organization}: received ${normalizedJobs.length} jobs.`);
  return normalizedJobs;
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
  const humanApplyUrl = stringifySafe(job.human_apply_url || job.url || "").replace(/\.md(?:[?#].*)?$/i, "");
  const hasHumanApplyUrl = /^https?:\/\/(?:apply|jobs)\.workable\.com\/.+/i.test(humanApplyUrl) && !/\/jobs\.md(?:[?#].*)?$/i.test(humanApplyUrl);

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
    source_url: hasHumanApplyUrl ? humanApplyUrl : stringifySafe(source.source_url),
    apply_url: hasHumanApplyUrl ? humanApplyUrl : "",
    date_posted: job.created_at || todayIso(),
    raw_description: stringifySafe(job.description || ""),
    description: stringifySafe(job.description || ""),
    tags: [source.sector, stringifySafe(job.department || job.team), "workable"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from Workable account ${source.company_slug}.${hasHumanApplyUrl ? "" : " Review required: no human-usable apply page found."}`,
    review_reason: hasHumanApplyUrl ? "" : "workable_no_human_apply_page",
    raw_payload: job
  };
}

function normalizeWorkableMarkdownCell(value) {
  return stringifySafe(value)
    .replace(/\\\|/g, "|")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function parseWorkableMarkdownJobs(markdown, source) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (const line of lines) {
    if (!/^\|/.test(line)) continue;
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((cell) => normalizeWorkableMarkdownCell(cell));
    if (columns.length < 7 || /^title$/i.test(columns[0])) continue;
    const detailsMatch = columns[6].match(/\[View\]\((https?:\/\/apply\.workable\.com\/[^)\s]+)\)/i);
    rows.push({
      title: columns[0],
      department: columns[1],
      location: columns[2],
      employment_type: columns[3],
      salary: columns[4] === "—" ? "" : columns[4],
      created_at: columns[5],
      url: detailsMatch ? detailsMatch[1].replace(/\.md$/i, "") : "",
      detail_markdown_url: detailsMatch ? detailsMatch[1] : "",
      workplace: /\bremote\b/i.test(columns[2]) ? "remote" : ""
    });
  }

  return rows.map((job) => ({
    ...job,
    id:
      job.detail_markdown_url.match(/\/view\/([^./?#]+)\.md$/i)?.[1] ||
      stableHash(`${source.id}:${job.title}:${job.url}`)
  }));
}

function parseWorkableDetailMarkdown(markdown) {
  const text = String(markdown || "");
  const salaryMatch = text.match(/\*\*Salary:\*\*\s*([^\n]+)/i);
  const workplaceMatch = text.match(/\*\*Workplace:\*\*\s*([^\n]+)/i);
  const departmentMatch = text.match(/\*\*Department:\*\*\s*([^\n]+)/i);
  const descriptionMatch = text.match(/## Description\s+([\s\S]*?)(?:\n## |\n---|\s*$)/i);
  return {
    salary: salaryMatch ? stringifySafe(salaryMatch[1]) : "",
    workplace: workplaceMatch ? stringifySafe(workplaceMatch[1]) : "",
    department: departmentMatch ? stringifySafe(departmentMatch[1]) : "",
    description: descriptionMatch ? stringifySafe(descriptionMatch[1]).trim() : ""
  };
}

function decodeXmlEntities(value) {
  return stringifySafe(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function buildRipplingError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.ripplingCode = code;
  return error;
}

function extractRipplingNextData(html) {
  const match = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function extractRipplingJobsFromNextData(payload) {
  const queries = Array.isArray(payload?.props?.pageProps?.dehydratedState?.queries)
    ? payload.props.pageProps.dehydratedState.queries
    : [];
  for (const query of queries) {
    const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
    if (queryKey.includes("job-posts")) {
      const items = Array.isArray(query?.state?.data?.items) ? query.state.data.items : [];
      return items;
    }
  }
  return [];
}

function extractTagValue(block, tagName) {
  const match = String(block || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : "";
}

function extractCdataValue(block, tagName) {
  const match = String(block || "").match(new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, "i"));
  return match ? String(match[1]).trim() : "";
}

function parseRipplingRssJobs(xml) {
  const items = [];
  const matches = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of matches) {
    items.push({
      title: extractTagValue(block, "title"),
      link: extractTagValue(block, "link"),
      snippet: extractTagValue(block, "description"),
      location: extractTagValue(block, "location"),
      descriptionHtml: extractCdataValue(block, "media:description")
    });
  }
  return items;
}

function deriveRipplingJobType(text) {
  const match = String(text || "").match(/job type:\s*<\/?strong>\s*([^<\n]+)/i) || String(text || "").match(/job type:\s*([^\n]+)/i);
  return match ? stripHtml(match[1]) : "";
}

function ripplingJobToSchema(source, job) {
  const descriptionHtml = stringifySafe(job.descriptionHtml || job.description || "");
  const descriptionText = stripHtml(descriptionHtml || job.snippet || "");
  const location = stringifySafe(job.location || job.locationName || "");
  const workplaceType = /\bremote\b/i.test(`${location} ${job.title || ""} ${descriptionText}`) ? "Remote" : stringifySafe(job.workplaceType || "");
  const salaryMatch = descriptionText.match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?/);
  const functionMatch = descriptionText.match(/department:\s*([^\n]+)/i);
  return {
    id: `${source.organization}-${job.id || job.jobId || job.link || job.title}`,
    external_id: job.id || job.jobId
      ? `rippling_${source.id}_${job.id || job.jobId}`
      : `rippling_${stableHash(`${source.id}:${job.title || ""}:${job.link || job.applyUrl || ""}`)}`,
    title: stringifySafe(job.title),
    organization: source.organization,
    location: location || "Location listed on application",
    job_type: stringifySafe(job.employmentType || deriveRipplingJobType(descriptionHtml || descriptionText) || "Full-time"),
    sector: source.sector,
    function: stringifySafe(job.department || (functionMatch ? functionMatch[1] : "") || ensureDefault(source.function_defaults)),
    workplace_type: workplaceType,
    salary: stringifySafe(job.salary || (salaryMatch ? salaryMatch[0] : "")),
    source: "Rippling",
    source_url: stringifySafe(job.link || job.applyUrl || source.source_url),
    apply_url: stringifySafe(job.link || job.applyUrl || source.source_url),
    date_posted: stringifySafe(job.postedAt || job.createdAt || todayIso()),
    raw_description: descriptionHtml || stringifySafe(job.snippet || ""),
    description: descriptionText,
    tags: [source.sector, stringifySafe(job.department), "rippling"].filter(Boolean),
    shared_by: "ATS Sync",
    notes: `Synced from public Rippling board ${source.source_url}.`,
    raw_payload: {
      id: job.id || job.jobId || null,
      title: stringifySafe(job.title),
      location: location,
      apply_url: stringifySafe(job.link || job.applyUrl || source.source_url),
      workplace_type: workplaceType,
      job_type: stringifySafe(job.employmentType || deriveRipplingJobType(descriptionHtml || descriptionText))
    }
  };
}

async function fetchRipplingJobsForSource(source) {
  const boardUrl = stringifySafe(source.api_url || source.source_url || source.url);
  if (!boardUrl) {
    throw buildRipplingError("rippling_fetch_failed", "Missing Rippling board URL.");
  }

  console.log(`[sync-rippling] Fetching ${source.organization} from ${boardUrl}`);
  const { html } = await fetchHtml(boardUrl);

  const nextData = extractRipplingNextData(html);
  if (nextData) {
    const jobs = extractRipplingJobsFromNextData(nextData);
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw buildRipplingError("rippling_no_jobs_found", `No Rippling jobs found for ${source.organization}`);
    }
    const normalized = jobs.map((job) => ripplingJobToSchema(source, job));
    console.log(`[sync-rippling] ${source.organization}: received ${normalized.length} jobs.`);
    return normalized;
  }

  const rssUrl = new URL("/api/rss.xml", boardUrl).toString();
  try {
    const response = await fetch(rssUrl);
    if (response.ok) {
      const xml = await response.text();
      const jobs = parseRipplingRssJobs(xml);
      if (!jobs.length) {
        throw buildRipplingError("rippling_no_jobs_found", `No Rippling RSS jobs found for ${source.organization}`);
      }
      const normalized = jobs.map((job) => ripplingJobToSchema(source, job));
      console.log(`[sync-rippling] ${source.organization}: received ${normalized.length} jobs from rss.`);
      return normalized;
    }
    if (response.status === 403) {
      throw buildRipplingError("rippling_blocked", `HTTP 403 for ${source.organization}`);
    }
  } catch (error) {
    if (error.ripplingCode) throw error;
    throw buildRipplingError("rippling_fetch_failed", error.message);
  }

  throw buildRipplingError("rippling_parse_failed", `No public Rippling board data could be parsed for ${source.organization}`);
}

async function fetchWorkableJobsForSource(source) {
  const companySlug =
    source.company_slug ||
    String(source.source_url || "").match(/apply\.workable\.com\/([^/?#"'&<>\s]+)/i)?.[1] ||
    "";

  if (!companySlug) {
    throw new Error("Missing Workable company slug.");
  }

  const url = source.api_url || `https://apply.workable.com/${encodeURIComponent(companySlug)}/jobs.md`;
  console.log(`[sync-workable] Fetching ${source.organization} from ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const markdown = await response.text();
  const jobs = parseWorkableMarkdownJobs(markdown, source);
  const normalizedJobs = [];

  for (const job of jobs) {
    let detail = {};
    if (job.detail_markdown_url) {
      try {
        const detailResponse = await fetch(job.detail_markdown_url);
        if (detailResponse.ok) {
          detail = parseWorkableDetailMarkdown(await detailResponse.text());
        }
      } catch (error) {
        console.warn(`[sync-workable] ${source.organization}: detail fetch failed for job_id=${job.id} error=${error.message}`);
      }
    }

    normalizedJobs.push(
      workableJobToSchema(source, {
        ...job,
        human_apply_url: job.url || (job.detail_markdown_url ? job.detail_markdown_url.replace(/\.md$/i, "") : ""),
        salary: detail.salary || job.salary,
        workplace: detail.workplace || job.workplace,
        department: detail.department || job.department,
        description: detail.description || ""
      })
    );
  }

  console.log(`[sync-workable] ${source.organization}: received ${normalizedJobs.length} jobs.`);
  return normalizedJobs;
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
  if (normalizedProvider === "paylocity") {
    return { ...source, provider: normalizedProvider, type: "ats" };
  }
  if (normalizedProvider === "rippling") {
    return { ...source, provider: normalizedProvider, type: "ats" };
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
  if (normalizedProvider === "paylocity") return fetchPaylocityJobsForSource(derivedSource);
  if (normalizedProvider === "rippling") return fetchRipplingJobsForSource(derivedSource);
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
  fetchPaylocityJobsForSource,
  fetchRipplingJobsForSource,
  greenhouseJobToSchema,
  leverJobToSchema,
  ashbyJobToSchema,
  bambooHrJobToSchema,
  smartRecruitersJobToSchema,
  workableJobToSchema,
  recruiteeJobToSchema,
  paylocityJobToSchema,
  ripplingJobToSchema
};
