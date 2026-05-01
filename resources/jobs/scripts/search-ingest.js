const fs = require("fs/promises");
const path = require("path");
const { JOBS_FILE, PENDING_SYNCED_FILE, writeJson } = require("./job-utils");
const { dedupeJobs, normalizeJob, stableHash, stripHtml, todayIso } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const SEARCH_SOURCES_FILE = path.join(ROOT, "search-sources.json");

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function requiredEnvForProvider(provider) {
  if (provider === "google_custom_search") {
    return ["GOOGLE_CUSTOM_SEARCH_API_KEY", "GOOGLE_CUSTOM_SEARCH_ENGINE_ID"];
  }
  if (provider === "serpapi_google_jobs") {
    return ["SERPAPI_API_KEY"];
  }
  return [];
}

function validateProviderEnv(provider) {
  const missing = requiredEnvForProvider(provider).filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing env vars for ${provider}: ${missing.join(", ")}`);
  }
}

function buildSearchUrl(queryConfig) {
  if (queryConfig.provider === "google_custom_search") {
    validateProviderEnv(queryConfig.provider);
    const params = new URLSearchParams({
      key: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,
      cx: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
      q: queryConfig.query
    });
    return `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  }

  if (queryConfig.provider === "serpapi_google_jobs") {
    validateProviderEnv(queryConfig.provider);
    const params = new URLSearchParams({
      engine: "google_jobs",
      q: queryConfig.query,
      api_key: process.env.SERPAPI_API_KEY
    });
    return `https://serpapi.com/search.json?${params.toString()}`;
  }

  throw new Error(`Unsupported provider: ${queryConfig.provider}`);
}

function extractResults(provider, payload) {
  if (provider === "google_custom_search") {
    return Array.isArray(payload.items) ? payload.items : [];
  }
  if (provider === "serpapi_google_jobs") {
    return Array.isArray(payload.jobs_results) ? payload.jobs_results : [];
  }
  return [];
}

function normalizeLead(queryConfig, lead) {
  const applyUrl =
    lead.apply_link ||
    lead.link ||
    lead.job_link ||
    lead.related_links?.[0]?.link ||
    "";
  const title = lead.title || lead.job_title || lead.position || queryConfig.query;
  const organization = lead.displayed_link || lead.company_name || lead.source || "Unknown organization";
  const description = stripHtml(
    lead.snippet ||
    lead.description ||
    lead.detected_extensions?.schedule_type ||
    ""
  );

  return normalizeJob({
    id: `wide-search-${queryConfig.id}-${stableHash(`${title}:${organization}:${applyUrl}`)}`,
    external_id: `wide-search_${queryConfig.id}_${stableHash(`${title}:${organization}:${applyUrl}`)}`,
    title,
    organization,
    location: lead.location || lead.detected_extensions?.location || "",
    workplace_type: queryConfig.workplace_type || "",
    job_type: lead.detected_extensions?.schedule_type || "",
    sector: queryConfig.sector || "General",
    function: queryConfig.function || "",
    source: "Wide Search",
    source_url: applyUrl,
    apply_url: applyUrl,
    date_posted: todayIso(),
    date_added: todayIso(),
    date_updated: todayIso(),
    description,
    tags: [queryConfig.sector, queryConfig.function, queryConfig.provider].filter(Boolean),
    status: "pending",
    shared_by: queryConfig.provider,
    notes: `Lead collected from ${queryConfig.provider} query "${queryConfig.query}".`,
    sync_origin: "wide-search"
  });
}

async function fetchQueryResults(queryConfig) {
  const url = buildSearchUrl(queryConfig);
  console.log(`[jobs:search-ingest] Fetching ${queryConfig.id} via ${queryConfig.provider}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${queryConfig.id}`);
  }
  const payload = await response.json();
  const results = extractResults(queryConfig.provider, payload);
  return results.map((result) => normalizeLead(queryConfig, result));
}

async function main() {
  const [searchConfig, publicJobs, pendingJobs] = await Promise.all([
    readJson(SEARCH_SOURCES_FILE, { queries: [] }),
    readJson(JOBS_FILE, []),
    readJson(PENDING_SYNCED_FILE, [])
  ]);

  const queries = Array.isArray(searchConfig.queries) ? searchConfig.queries.filter((query) => query.enabled) : [];
  if (!queries.length) {
    console.log("[jobs:search-ingest] No enabled search queries.");
    return;
  }

  const newPendingLeads = [];

  for (const queryConfig of queries) {
    try {
      const leads = await fetchQueryResults(queryConfig);
      newPendingLeads.push(...leads);
      console.log(`[jobs:search-ingest] ${queryConfig.id}: collected ${leads.length} pending leads.`);
    } catch (error) {
      console.error(`[jobs:search-ingest] ${queryConfig.id} failed: ${error.message}`);
    }
  }

  const mergedPending = dedupeJobs([...pendingJobs, ...publicJobs, ...newPendingLeads])
    .filter((job) => String(job.status || "").toLowerCase() === "pending");

  await writeJson(PENDING_SYNCED_FILE, mergedPending);
  console.log(`[jobs:search-ingest] Wrote ${mergedPending.length} pending leads to ${PENDING_SYNCED_FILE}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:search-ingest] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
