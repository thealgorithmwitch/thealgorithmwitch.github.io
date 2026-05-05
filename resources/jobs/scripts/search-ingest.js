const fs = require("fs/promises");
const path = require("path");
const { JOBS_FILE, PENDING_SYNCED_FILE, writeJson } = require("./job-utils");
const {
  dedupeJobs,
  getParserCleanupStats,
  normalizeJob,
  resetParserCleanupStats,
  stableHash,
  todayIso
} = require("./job-normalizer");

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
  if (provider === "apify_greenhouse_jobs" || provider === "apify_lever_jobs") {
    return ["APIFY_TOKEN"];
  }
  if (provider === "generic_job_data_api") {
    return ["GENERIC_JOB_DATA_API_KEY"];
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

  if (queryConfig.provider === "apify_greenhouse_jobs") {
    validateProviderEnv(queryConfig.provider);
    const params = new URLSearchParams({
      token: process.env.APIFY_TOKEN,
      q: queryConfig.query
    });
    return `https://api.apify.com/v2/acts/apify~greenhouse-jobs-scraper/run-sync-get-dataset-items?${params.toString()}`;
  }

  if (queryConfig.provider === "apify_lever_jobs") {
    validateProviderEnv(queryConfig.provider);
    const params = new URLSearchParams({
      token: process.env.APIFY_TOKEN,
      q: queryConfig.query
    });
    return `https://api.apify.com/v2/acts/apify~lever-jobs-scraper/run-sync-get-dataset-items?${params.toString()}`;
  }

  if (queryConfig.provider === "generic_job_data_api") {
    validateProviderEnv(queryConfig.provider);
    const params = new URLSearchParams({
      q: queryConfig.query,
      api_key: process.env.GENERIC_JOB_DATA_API_KEY
    });
    return `https://api.example-job-data.com/v1/jobs/search?${params.toString()}`;
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
  if (provider === "apify_greenhouse_jobs" || provider === "apify_lever_jobs") {
    return Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
  }
  if (provider === "generic_job_data_api") {
    return Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(payload.results) ? payload.results : [];
  }
  return [];
}

function getConfidence(lead) {
  return lead.title && lead.organization && lead.apply_url ? "medium" : "low";
}

function normalizeProviderLead(queryConfig, provider, lead) {
  if (provider === "google_custom_search") {
    return {
      title: lead.title || queryConfig.query,
      organization: lead.displayed_link || lead.source || "Unknown organization",
      location: lead.location || lead.detected_extensions?.location || "",
      workplace_type: queryConfig.workplace_type || "",
      job_type: lead.detected_extensions?.schedule_type || "",
      salary: "",
      raw_description: lead.snippet || lead.description || "",
      description: lead.snippet || lead.description || "",
      source_url: lead.link || "",
      apply_url: lead.link || "",
      external_id: lead.cacheId ? `google_custom_search_${queryConfig.id}_${lead.cacheId}` : "",
      source_type: provider
    };
  }

  if (provider === "serpapi_google_jobs") {
    return {
      title: lead.title || lead.job_title || queryConfig.query,
      organization: lead.company_name || lead.source || "Unknown organization",
      location: lead.location || "",
      workplace_type: queryConfig.workplace_type || "",
      job_type: lead.detected_extensions?.schedule_type || lead.schedule_type || "",
      salary: lead.detected_extensions?.salary || lead.salary || "",
      raw_description: lead.description || lead.snippet || "",
      description: lead.description || lead.snippet || "",
      source_url: lead.apply_link || lead.job_link || lead.related_links?.[0]?.link || "",
      apply_url: lead.apply_link || lead.job_link || lead.related_links?.[0]?.link || "",
      external_id: lead.job_id ? `serpapi_google_jobs_${queryConfig.id}_${lead.job_id}` : "",
      source_type: provider
    };
  }

  if (provider === "apify_greenhouse_jobs") {
    return {
      title: lead.title || queryConfig.query,
      organization: lead.companyName || lead.organization || "Unknown organization",
      location: lead.location || lead.locationName || "",
      workplace_type: lead.workplaceType || queryConfig.workplace_type || "",
      job_type: lead.employmentType || "",
      salary: lead.salary || lead.compensation || "",
      raw_description: lead.description || lead.content || "",
      description: lead.description || lead.content || "",
      source_url: lead.url || lead.absolute_url || "",
      apply_url: lead.applyUrl || lead.url || lead.absolute_url || "",
      external_id: lead.id ? `apify_greenhouse_jobs_${queryConfig.id}_${lead.id}` : "",
      source_type: provider
    };
  }

  if (provider === "apify_lever_jobs") {
    return {
      title: lead.title || lead.text || queryConfig.query,
      organization: lead.companyName || lead.organization || "Unknown organization",
      location: lead.location || lead.categories?.location || "",
      workplace_type: lead.workplaceType || lead.categories?.workplace || queryConfig.workplace_type || "",
      job_type: lead.commitment || lead.categories?.commitment || "",
      salary: lead.salary || "",
      raw_description: lead.description || lead.descriptionPlain || "",
      description: lead.description || lead.descriptionPlain || "",
      source_url: lead.hostedUrl || lead.url || "",
      apply_url: lead.applyUrl || lead.hostedUrl || lead.url || "",
      external_id: lead.id ? `apify_lever_jobs_${queryConfig.id}_${lead.id}` : "",
      source_type: provider
    };
  }

  if (provider === "generic_job_data_api") {
    return {
      title: lead.title || lead.position || queryConfig.query,
      organization: lead.organization || lead.company || "Unknown organization",
      location: lead.location || "",
      workplace_type: lead.workplace_type || queryConfig.workplace_type || "",
      job_type: lead.job_type || lead.commitment || "",
      salary: lead.salary || lead.compensation || "",
      raw_description: lead.description || lead.summary || "",
      description: lead.description || lead.summary || "",
      source_url: lead.source_url || lead.url || "",
      apply_url: lead.apply_url || lead.applyUrl || lead.url || "",
      external_id: lead.id ? `generic_job_data_api_${queryConfig.id}_${lead.id}` : "",
      source_type: provider
    };
  }

  return {
    title: queryConfig.query,
    organization: "Unknown organization",
    location: "",
    workplace_type: queryConfig.workplace_type || "",
    job_type: "",
    salary: "",
    description: "",
    source_url: "",
    apply_url: "",
    external_id: "",
    source_type: provider
  };
}

function normalizeLead(queryConfig, lead) {
  const normalizedLead = normalizeProviderLead(queryConfig, queryConfig.provider, lead);
  const applyUrl =
    normalizedLead.apply_url ||
    normalizedLead.source_url ||
    "";
  const title = normalizedLead.title || queryConfig.query;
  const organization = normalizedLead.organization || "Unknown organization";
  const description = normalizedLead.description || "";
  const externalId =
    normalizedLead.external_id ||
    `wide-search_${queryConfig.id}_${stableHash(`${title}:${organization}:${applyUrl}`)}`;

  return normalizeJob({
    id: `wide-search-${queryConfig.id}-${stableHash(`${title}:${organization}:${applyUrl}`)}`,
    external_id: externalId,
    title,
    organization,
    location: normalizedLead.location || "",
    workplace_type: normalizedLead.workplace_type || queryConfig.workplace_type || "",
    job_type: normalizedLead.job_type || "",
    salary: normalizedLead.salary || "",
    sector: queryConfig.sector || "General",
    function: queryConfig.function || "",
    source: "Wide Search",
    source_type: queryConfig.provider,
    source_url: normalizedLead.source_url || applyUrl,
    apply_url: applyUrl,
    date_posted: todayIso(),
    date_added: todayIso(),
    date_updated: todayIso(),
    description,
    tags: [queryConfig.sector, queryConfig.function, queryConfig.provider].filter(Boolean),
    status: "pending",
    trusted: false,
    auto_publish: false,
    review_reason: "Broad discovery source. Review before publishing.",
    confidence: getConfidence({
      title,
      organization,
      apply_url: applyUrl
    }),
    shared_by: queryConfig.provider,
    notes: `Lead collected from ${queryConfig.provider} query "${queryConfig.query}".`,
    sync_origin: "wide-search"
  });
}

async function submitPendingLead(job) {
  const backendUrl = String(process.env.JOBS_BACKEND_URL || "").trim();
  if (!backendUrl) return { skipped: true };

  const response = await fetch(backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "submitJob",
      payload: job
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Backend submit failed with HTTP ${response.status}.`);
  }
  return payload;
}

function buildLeadKey(job) {
  if (job.external_id) return `external::${String(job.external_id).toLowerCase()}`;
  if (job.apply_url) return `apply::${String(job.apply_url).toLowerCase()}`;
  return `identity::${String(job.title).toLowerCase()}::${String(job.organization).toLowerCase()}::${String(job.location).toLowerCase()}`;
}

function likelyBroadDuplicate(existing, candidate) {
  const titleMatch = String(existing.title || "").toLowerCase() === String(candidate.title || "").toLowerCase();
  const orgMatch = String(existing.organization || "").toLowerCase() === String(candidate.organization || "").toLowerCase();
  if (!titleMatch || !orgMatch) return false;
  const existingDate = Date.parse(existing.date_added || existing.date_updated || existing.date_posted) || 0;
  const candidateDate = Date.parse(candidate.date_added || candidate.date_updated || candidate.date_posted) || 0;
  const days = Math.abs(candidateDate - existingDate) / (1000 * 60 * 60 * 24);
  return days <= 7;
}

function mergeBroadPending(publicJobs, pendingJobs, newPendingLeads) {
  const seen = new Map();
  const add = (job) => {
    const normalized = normalizeJob(job);
    if (!normalized) return;
    const key = buildLeadKey(normalized);
    const existing = seen.get(key);

    if (!existing) {
      for (const prior of seen.values()) {
        if (likelyBroadDuplicate(prior, normalized)) {
          return;
        }
      }
      seen.set(key, normalized);
      return;
    }

    const existingTime = Date.parse(existing.date_updated || existing.date_added || existing.date_posted) || 0;
    const nextTime = Date.parse(normalized.date_updated || normalized.date_added || normalized.date_posted) || 0;
    const merged = {
      ...existing,
      ...normalized,
      tags: Array.from(new Set([...(existing.tags || []), ...(normalized.tags || [])])).filter(Boolean)
    };
    seen.set(key, nextTime >= existingTime ? merged : { ...normalized, ...existing, tags: merged.tags });
  };

  [...publicJobs, ...pendingJobs, ...newPendingLeads].forEach(add);
  return Array.from(seen.values()).filter((job) => String(job.status || "").toLowerCase() === "pending");
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
  return results
    .map((result) => normalizeLead(queryConfig, result))
    .filter(Boolean);
}

async function main() {
  resetParserCleanupStats();
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
  let submittedCount = 0;

  for (const queryConfig of queries) {
    try {
      const leads = await fetchQueryResults(queryConfig);
      newPendingLeads.push(...leads);
      if (process.env.JOBS_BACKEND_URL) {
        for (const lead of leads) {
          await submitPendingLead(lead);
          submittedCount += 1;
        }
      }
      console.log(`[jobs:search-ingest] ${queryConfig.id}: collected ${leads.length} pending leads.`);
    } catch (error) {
      console.error(`[jobs:search-ingest] ${queryConfig.id} failed: ${error.message}`);
    }
  }

  const mergedPending = mergeBroadPending(publicJobs, pendingJobs, newPendingLeads);

  await writeJson(PENDING_SYNCED_FILE, mergedPending);
  console.log(`[jobs:search-ingest] Wrote ${mergedPending.length} pending leads to ${PENDING_SYNCED_FILE}.`);
  const parserStats = getParserCleanupStats();
  console.log(
    `[jobs:search-ingest] parser_cleaned_title_count=${parserStats.parser_cleaned_title_count} parser_cleaned_org_count=${parserStats.parser_cleaned_org_count} parser_cleaned_description_count=${parserStats.parser_cleaned_description_count} parser_location_defaulted_remote_count=${parserStats.parser_location_defaulted_remote_count} parser_location_cleaned_count=${parserStats.parser_location_cleaned_count} parser_hybrid_location_repaired_count=${parserStats.parser_hybrid_location_repaired_count} parser_elemental_metadata_stripped_count=${parserStats.parser_elemental_metadata_stripped_count} parser_custom_table_header_stripped_count=${parserStats.parser_custom_table_header_stripped_count} parser_html_fragment_stripped_count=${parserStats.parser_html_fragment_stripped_count}`
  );
  if (process.env.JOBS_BACKEND_URL) {
    console.log(`[jobs:search-ingest] Submitted ${submittedCount} pending leads to submitJob via JOBS_BACKEND_URL.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:search-ingest] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
