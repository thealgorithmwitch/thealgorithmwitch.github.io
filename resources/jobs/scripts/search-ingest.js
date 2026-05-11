const fs = require("fs/promises");
const path = require("path");
const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJson,
  writeJson,
  writeJsonIfChanged
} = require("./job-utils");
const {
  getParserCleanupStats,
  normalizeJob,
  resetParserCleanupStats,
  stableHash,
  todayIso
} = require("./job-normalizer");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");

const ROOT = path.resolve(__dirname, "..");
const SEARCH_SOURCES_FILE = path.join(ROOT, "search-sources.json");
const REPORT_FILE = path.join(ROOT, "reports", "search-ingest-report.json");

function parseArgs(argv) {
  const args = {
    write: false,
    queriesFile: SEARCH_SOURCES_FILE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--queries-file" && argv[index + 1]) {
      args.queriesFile = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadSearchQueries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.queries)) return payload.queries;
  if (payload && Array.isArray(payload.sources)) return payload.sources;
  if (payload && Array.isArray(payload.entries)) return payload.entries;
  return [];
}

function stringify(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
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

function getMissingEnvForProvider(provider) {
  return requiredEnvForProvider(provider).filter((key) => !process.env[key]);
}

function buildSearchUrl(queryConfig) {
  if (queryConfig.provider === "google_custom_search") {
    const params = new URLSearchParams({
      key: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,
      cx: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
      q: queryConfig.query
    });
    return `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  }

  if (queryConfig.provider === "serpapi_google_jobs") {
    const params = new URLSearchParams({
      engine: "google_jobs",
      q: queryConfig.query,
      api_key: process.env.SERPAPI_API_KEY
    });
    return `https://serpapi.com/search.json?${params.toString()}`;
  }

  if (queryConfig.provider === "apify_greenhouse_jobs") {
    const params = new URLSearchParams({
      token: process.env.APIFY_TOKEN,
      q: queryConfig.query
    });
    return `https://api.apify.com/v2/acts/apify~greenhouse-jobs-scraper/run-sync-get-dataset-items?${params.toString()}`;
  }

  if (queryConfig.provider === "apify_lever_jobs") {
    const params = new URLSearchParams({
      token: process.env.APIFY_TOKEN,
      q: queryConfig.query
    });
    return `https://api.apify.com/v2/acts/apify~lever-jobs-scraper/run-sync-get-dataset-items?${params.toString()}`;
  }

  if (queryConfig.provider === "generic_job_data_api") {
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
  const applyUrl = normalizedLead.apply_url || normalizedLead.source_url || "";
  const title = normalizedLead.title || queryConfig.query;
  const organization = normalizedLead.organization || "Unknown organization";
  const description = normalizedLead.description || "";
  const externalId = normalizedLead.external_id
    || `wide-search_${queryConfig.id}_${stableHash(`${title}:${organization}:${applyUrl}`)}`;

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
    source: stringify(queryConfig.source_name || queryConfig.organization || "Wide Search"),
    source_id: `search:${queryConfig.id}`,
    source_type: queryConfig.provider,
    source_url: normalizedLead.source_url || applyUrl,
    apply_url: applyUrl,
    date_posted: todayIso(),
    date_added: todayIso(),
    date_updated: todayIso(),
    description,
    tags: [
      queryConfig.sector,
      queryConfig.function,
      queryConfig.provider,
      ...toArray(queryConfig.mission_tags)
    ].filter(Boolean),
    status: "pending",
    trusted: false,
    auto_publish: false,
    pending_only: queryConfig.pending_only !== false,
    pending_only_sync: true,
    review_reason: "Search discovery source. Review before publishing.",
    confidence: getConfidence({
      title,
      organization,
      apply_url: applyUrl
    }),
    shared_by: queryConfig.provider,
    notes: stringify(queryConfig.notes || `Lead collected from ${queryConfig.provider} query "${queryConfig.query}".`),
    sync_origin: "wide-search",
    search_query_id: stringify(queryConfig.id),
    mission_tags: toArray(queryConfig.mission_tags)
  });
}

function buildDedupeKeys(job = {}) {
  const normalized = normalizeJob(job);
  if (!normalized) return [];
  const title = stringify(normalized.title).toLowerCase();
  const organization = stringify(normalized.organization).toLowerCase();
  const applyUrl = stringify(normalized.apply_url || normalized.source_url || normalized.original_url).toLowerCase();
  const externalId = stringify(normalized.external_id).toLowerCase();
  const location = stringify(normalized.location).toLowerCase();
  return [
    externalId ? `external:${externalId}` : "",
    applyUrl ? `apply:${applyUrl}` : "",
    title && organization && applyUrl ? `title_org_apply:${title}::${organization}::${applyUrl}` : "",
    title && organization && location ? `title_org_location:${title}::${organization}::${location}` : "",
    title && organization ? `title_org:${title}::${organization}` : ""
  ].filter(Boolean);
}

function buildExistingKeySet(jobs) {
  const keys = new Set();
  for (const job of toArray(jobs)) {
    for (const key of buildDedupeKeys(job)) {
      keys.add(key);
    }
  }
  return keys;
}

async function fetchQueryResults(queryConfig) {
  const url = buildSearchUrl(queryConfig);
  console.log(`[jobs:search-ingest] query_id=${queryConfig.id} provider=${queryConfig.provider} mode=fetch`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${queryConfig.id}`);
  }
  const payload = await response.json();
  return extractResults(queryConfig.provider, payload);
}

function mergeSourceHealthEntries(existingEntries, nextEntries) {
  const keep = toArray(existingEntries).filter((entry) => !String(entry.source_id || "").startsWith("search:"));
  return [...keep, ...nextEntries];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  resetParserCleanupStats();

  const [searchConfig, publicJobs, pendingJobs, previousHealth] = await Promise.all([
    readJson(args.queriesFile, { queries: [] }),
    readJson(JOBS_FILE, []),
    readJson(PENDING_SYNCED_FILE, []),
    readSourceHealthSnapshot()
  ]);

  const allQueries = loadSearchQueries(searchConfig);
  const queries = allQueries.filter((query) => query && query.enabled !== false);

  const reportEntries = [];
  const sourceHealthEntries = [];
  const newPendingLeads = [];
  const existingKeySet = buildExistingKeySet([...toArray(publicJobs), ...toArray(pendingJobs)]);
  const seenThisRun = new Set();
  let jobsFoundTotal = 0;
  let jobsNormalizedTotal = 0;
  let jobsAddedToPendingTotal = 0;
  let duplicatesSkippedTotal = 0;

  for (const queryConfig of queries) {
    const queryStartedAt = Date.now();
    const queryId = stringify(queryConfig.id);
    const provider = stringify(queryConfig.provider);
    const missingEnvVars = getMissingEnvForProvider(provider);
    const maxResults = Math.max(Number(queryConfig.max_results || 25) || 25, 1);
    const reportEntry = {
      query_id: queryId,
      source_id: `search:${queryId}`,
      organization: stringify(queryConfig.organization),
      source_name: stringify(queryConfig.source_name || queryConfig.organization || queryId),
      provider,
      query: stringify(queryConfig.query),
      mission_tags: toArray(queryConfig.mission_tags),
      pending_only: queryConfig.pending_only !== false,
      max_results: maxResults,
      status: "pending",
      jobs_found: 0,
      jobs_normalized: 0,
      jobs_added_to_pending: 0,
      duplicates_skipped: 0,
      skipped_jobs: 0,
      dedupe_reasons: {},
      missing_env_vars: missingEnvVars,
      provider_error: "",
      detected_urls: [],
      notes: stringify(queryConfig.notes)
    };

    if (missingEnvVars.length) {
      reportEntry.status = "missing_env_vars";
      reportEntry.provider_error = `Missing env vars: ${missingEnvVars.join(", ")}`;
      reportEntries.push(reportEntry);
      sourceHealthEntries.push({
        source_id: `search:${queryId}`,
        source_checked: false,
        status: "missing_env_vars",
        provider,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_added_to_pending: 0,
        duplicates_skipped: 0,
        pending_count_delta: 0,
        public_count_delta: 0,
        skip_reasons: ["missing_env_vars"],
        missing_env_vars: missingEnvVars,
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 1
      });
      console.log(`[jobs:search-ingest] query_id=${queryId} provider=${provider} status=missing_env_vars missing=${missingEnvVars.join(",")}`);
      continue;
    }

    try {
      const rawResults = await fetchQueryResults(queryConfig);
      const limitedResults = toArray(rawResults).slice(0, maxResults);
      reportEntry.detected_urls = limitedResults
        .map((item) => stringify(item.apply_link || item.job_link || item.link || item.url || item.absolute_url || item.hostedUrl))
        .filter(Boolean)
        .slice(0, 20);
      reportEntry.jobs_found = limitedResults.length;
      jobsFoundTotal += limitedResults.length;

      for (const lead of limitedResults) {
        const normalized = normalizeLead(queryConfig, lead);
        if (!normalized) {
          reportEntry.skipped_jobs += 1;
          continue;
        }
        reportEntry.jobs_normalized += 1;
        jobsNormalizedTotal += 1;
        const dedupeKeys = buildDedupeKeys(normalized);
        const duplicate = dedupeKeys.some((key) => existingKeySet.has(key) || seenThisRun.has(key));
        if (duplicate) {
          reportEntry.duplicates_skipped += 1;
          duplicatesSkippedTotal += 1;
          reportEntry.dedupe_reasons.already_pending_or_public = Number(reportEntry.dedupe_reasons.already_pending_or_public || 0) + 1;
          continue;
        }
        newPendingLeads.push(normalized);
        jobsAddedToPendingTotal += 1;
        reportEntry.jobs_added_to_pending += 1;
        dedupeKeys.forEach((key) => seenThisRun.add(key));
      }

      reportEntry.status = reportEntry.jobs_added_to_pending > 0
        ? "pending_updated"
        : reportEntry.jobs_found > 0
          ? "no_pending_changes"
          : "provider_returned_zero_jobs";

      sourceHealthEntries.push({
        source_id: `search:${queryId}`,
        source_checked: true,
        status: reportEntry.status,
        provider,
        jobs_found: reportEntry.jobs_found,
        jobs_normalized: reportEntry.jobs_normalized,
        jobs_added_to_pending: reportEntry.jobs_added_to_pending,
        duplicates_skipped: reportEntry.duplicates_skipped,
        pending_count_delta: reportEntry.jobs_added_to_pending,
        public_count_delta: 0,
        skip_reasons: Object.keys(reportEntry.dedupe_reasons),
        missing_env_vars: [],
        last_successful_sync: nowIso(),
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 0
      });
      reportEntries.push(reportEntry);
      console.log(`[jobs:search-ingest] query_id=${queryId} provider=${provider} jobs_found=${reportEntry.jobs_found} jobs_normalized=${reportEntry.jobs_normalized} jobs_added_to_pending=${reportEntry.jobs_added_to_pending} duplicates_skipped=${reportEntry.duplicates_skipped}`);
    } catch (error) {
      reportEntry.status = "fetch_failed";
      reportEntry.provider_error = error.message;
      reportEntries.push(reportEntry);
      sourceHealthEntries.push({
        source_id: `search:${queryId}`,
        source_checked: true,
        status: "fetch_failed",
        provider,
        jobs_found: reportEntry.jobs_found,
        jobs_normalized: reportEntry.jobs_normalized,
        jobs_added_to_pending: 0,
        duplicates_skipped: reportEntry.duplicates_skipped,
        pending_count_delta: 0,
        public_count_delta: 0,
        skip_reasons: ["fetch_failed"],
        missing_env_vars: [],
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 1,
        error: error.message
      });
      console.error(`[jobs:search-ingest] query_id=${queryId} provider=${provider} status=fetch_failed error=${error.message}`);
    }
  }

  const mergedPending = newPendingLeads.length
    ? [...toArray(pendingJobs), ...newPendingLeads]
    : toArray(pendingJobs);
  const pendingChanged = args.write
    ? await writeJsonIfChanged(PENDING_SYNCED_FILE, mergedPending)
    : false;

  const parserStats = getParserCleanupStats();
  const meaningfulErrorCount = reportEntries.filter((entry) => entry.status === "fetch_failed" || entry.status === "missing_env_vars").length;
  const shouldPersistArtifacts = Boolean(args.write && (pendingChanged || meaningfulErrorCount > 0));
  const report = {
    generated_at: nowIso(),
    mode: args.write ? "write" : "dry_run",
    queries_file: args.queriesFile,
    pending_only: true,
    pending_file: PENDING_SYNCED_FILE,
    source_health_file: args.write ? "resources/jobs/source-health-latest.json" : "",
    summary: {
      queries_total: allQueries.length,
      queries_enabled: queries.length,
      sources_attempted: reportEntries.filter((entry) => entry.status !== "missing_env_vars").length,
      jobs_found: jobsFoundTotal,
      jobs_normalized: jobsNormalizedTotal,
      jobs_added_to_pending: jobsAddedToPendingTotal,
      duplicates_skipped: duplicatesSkippedTotal,
      fetch_failed: reportEntries.filter((entry) => entry.status === "fetch_failed").length,
      missing_env_var_queries: reportEntries.filter((entry) => entry.status === "missing_env_vars").length,
      meaningful_error_count: meaningfulErrorCount,
      pending_changed: pendingChanged,
      should_persist_artifacts: shouldPersistArtifacts
    },
    parser_stats: parserStats,
    results: reportEntries
  };

  if (!args.write || shouldPersistArtifacts) {
    await writeJson(REPORT_FILE, report);
  }
  if (args.write && shouldPersistArtifacts) {
    const nextHealthEntries = mergeSourceHealthEntries(previousHealth.sources, sourceHealthEntries);
    await writeSourceHealthSnapshot({
      generated_at: nowIso(),
      sync_type: "search-ingest",
      sources: nextHealthEntries
    });
  }

  console.log(
    `[jobs:search-ingest] mode=${args.write ? "write" : "dry_run"} queries_enabled=${report.summary.queries_enabled} jobs_found=${jobsFoundTotal} jobs_normalized=${jobsNormalizedTotal} jobs_added_to_pending=${jobsAddedToPendingTotal} duplicates_skipped=${duplicatesSkippedTotal} fetch_failed=${report.summary.fetch_failed} missing_env_var_queries=${report.summary.missing_env_var_queries} meaningful_error_count=${meaningfulErrorCount} duration_ms=${Date.now() - startedAt}`
  );
  console.log(`[jobs:search-ingest] report=${REPORT_FILE}`);
  if (args.write) {
    console.log(`[jobs:search-ingest] pending_written=${PENDING_SYNCED_FILE} changed=${pendingChanged}`);
    console.log(`[jobs:search-ingest] artifacts_persisted=${shouldPersistArtifacts}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:search-ingest] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs
};
