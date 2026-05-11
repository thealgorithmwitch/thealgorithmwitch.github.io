const fs = require("fs/promises");
const path = require("path");
const {
  SOURCES_FILE,
  readJson,
  writeJson
} = require("./job-utils");
const { fetchQueryResults, getMissingEnvForProvider, shouldRouteResultToSourceDiscovery } = require("./search-ingest");
const {
  PROVIDER_DETECTORS,
  STRUCTURED_ADAPTER_GAP_PROVIDERS,
  buildSourceRecord,
  detectProviderFromUrls,
  extractSourceCandidateFromSearchResult,
  findExistingSource,
  mergeCandidates,
  normalizeUrl,
  readCandidatePayload,
  stringify,
  toArray
} = require("./source-discovery-helpers");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CANDIDATES_FILE = path.join(ROOT, "source-discovery-candidates.json");
const DEFAULT_QUERIES_FILE = path.join(ROOT, "search-sources.json");
const REPORT_FILE = path.join(ROOT, "reports", "source-discovery-report.json");

function parseArgs(argv) {
  const args = {
    write: false,
    candidatesFile: DEFAULT_CANDIDATES_FILE,
    queriesFile: DEFAULT_QUERIES_FILE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--candidates-file" && argv[index + 1]) {
      args.candidatesFile = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--queries-file" && argv[index + 1]) {
      args.queriesFile = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

async function loadCandidates(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".txt") {
    const raw = await fs.readFile(filePath, "utf8");
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((organization) => ({
        organization,
        source_name: organization,
        candidate_urls: [],
        mission_tags: [],
        pending_only: true,
        enabled: true,
        notes: "Manual candidate seed."
      }));
  }
  const payload = await readJson(filePath, { candidates: [] });
  return readCandidatePayload(payload);
}

async function loadSearchQueries(filePath) {
  const payload = await readJson(filePath, { queries: [] });
  return Array.isArray(payload.queries) ? payload.queries : [];
}

function isSourceDiscoveryQuery(query = {}) {
  return query
    && query.enabled !== false
    && stringify(query.route || query.discovery_route || "source_discovery") === "source_discovery";
}

async function discoverCandidatesFromSearch(queries) {
  const queryReports = [];
  const discoveredCandidates = [];

  for (const queryConfig of toArray(queries).filter(isSourceDiscoveryQuery)) {
    const provider = stringify(queryConfig.provider);
    const queryReport = {
      query_id: stringify(queryConfig.id),
      provider,
      query: stringify(queryConfig.query),
      status: "pending",
      search_results_found: 0,
      source_candidates_found: 0,
      source_candidates_skipped: 0,
      aggregators_skipped: 0,
      climate_change_jobs_skipped: 0,
      missing_env_vars: [],
      provider_error: ""
    };

    const missingEnvVars = getMissingEnvForProvider(provider);
    if (missingEnvVars.length) {
      queryReport.status = "missing_env_vars";
      queryReport.missing_env_vars = missingEnvVars;
      queryReport.provider_error = `Missing env vars: ${missingEnvVars.join(", ")}`;
      queryReports.push(queryReport);
      continue;
    }

    try {
      const { results } = await fetchQueryResults(queryConfig);
      const limitedResults = toArray(results).slice(0, Math.max(Number(queryConfig.max_results || 10) || 10, 1));
      queryReport.search_results_found = limitedResults.length;

      for (const result of limitedResults) {
        const extraction = shouldRouteResultToSourceDiscovery(queryConfig, result)
          || extractSourceCandidateFromSearchResult(queryConfig, provider, result);
        if (!extraction.candidate) {
          queryReport.source_candidates_skipped += 1;
          queryReport.aggregators_skipped += Number(extraction.aggregators_skipped || 0);
          queryReport.climate_change_jobs_skipped += Number(extraction.climate_change_jobs_skipped || 0);
          continue;
        }
        discoveredCandidates.push(extraction.candidate);
        queryReport.source_candidates_found += 1;
      }

      queryReport.status = "discovered";
    } catch (error) {
      queryReport.status = "fetch_failed";
      queryReport.provider_error = error.providerDiagnostics?.message || error.message;
      queryReport.provider_error_details = error.providerDiagnostics || null;
    }

    queryReports.push(queryReport);
  }

  return {
    queryReports,
    discoveredCandidates
  };
}

function summarizeDiscovery(results) {
  const workableResults = results.filter((entry) => entry.discovery_provider === "workable_global_search");
  return {
    candidates_total: results.length,
    appended_to_sources: results.filter((entry) => entry.onboarding_status === "appended_to_sources").length,
    already_configured: results.filter((entry) => entry.onboarding_status === "already_configured").length,
    eligible_dry_run: results.filter((entry) => entry.onboarding_status === "eligible_dry_run").length,
    skipped: results.filter((entry) => entry.onboarding_status === "skipped").length,
    workable_sources_added: workableResults.filter((entry) => entry.onboarding_status === "appended_to_sources").length,
    workable_employers_discovered: workableResults.length
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [sourcesPayload, seededCandidates, searchQueries] = await Promise.all([
    readJson(SOURCES_FILE, { sources: [] }),
    loadCandidates(args.candidatesFile),
    loadSearchQueries(args.queriesFile)
  ]);

  const { queryReports, discoveredCandidates } = await discoverCandidatesFromSearch(searchQueries);
  const combinedCandidates = mergeCandidates(seededCandidates, discoveredCandidates);
  const existingSources = Array.isArray(sourcesPayload.sources) ? sourcesPayload.sources : [];
  const nextSources = [...existingSources];
  const results = [];

  for (const candidate of combinedCandidates) {
    const organization = stringify(candidate.organization || candidate.source_name);
    const urls = toArray(candidate.candidate_urls)
      .concat(candidate.known_careers_url ? [candidate.known_careers_url] : [])
      .concat(candidate.url ? [candidate.url] : [])
      .map((url) => normalizeUrl(url))
      .filter(Boolean);
    const existing = findExistingSource(existingSources, candidate);

    if (existing) {
      const provider = stringify(existing.provider || existing.type);
      const providerConfig = PROVIDER_DETECTORS.find((item) => item.provider === provider);
      results.push({
        organization,
        discovery_provider: stringify(candidate.discovery_provider),
        detected_provider: provider || "",
        detected_job_url: normalizeUrl(existing.source_url || existing.url || urls[0] || ""),
        confidence_score: provider ? 99 : 75,
        provider_supported: providerConfig ? providerConfig.automationSupported !== false : true,
        onboarding_status: "already_configured",
        skip_reason: STRUCTURED_ADAPTER_GAP_PROVIDERS.has(provider) ? "provider_adapter_missing" : "",
        recommended_sync_path: provider ? (providerConfig?.syncPath || "manual_review_only") : "manual_review_only"
      });
      continue;
    }

    if (!urls.length) {
      results.push({
        organization,
        discovery_provider: stringify(candidate.discovery_provider),
        detected_provider: stringify(candidate.provider),
        detected_job_url: "",
        confidence_score: 0,
        provider_supported: false,
        onboarding_status: "skipped",
        skip_reason: "candidate_url_missing",
        recommended_sync_path: "manual_research"
      });
      continue;
    }

    const discovery = detectProviderFromUrls(urls);
    if (!discovery || discovery.skip_reason) {
      results.push({
        organization,
        discovery_provider: stringify(candidate.discovery_provider),
        detected_provider: stringify(candidate.provider),
        detected_job_url: urls[0] || "",
        confidence_score: Number(discovery?.confidence_score || 25),
        provider_supported: false,
        onboarding_status: "skipped",
        skip_reason: stringify(discovery?.skip_reason || "unstable_custom_html_or_unknown_provider"),
        recommended_sync_path: stringify(discovery?.recommended_sync_path || "manual_review_only")
      });
      continue;
    }

    const sourceRecord = buildSourceRecord(candidate, discovery);
    if (args.write) {
      nextSources.push(sourceRecord);
    }
    results.push({
      organization,
      discovery_provider: stringify(candidate.discovery_provider),
      detected_provider: discovery.detected_provider,
      detected_job_url: discovery.detected_job_url,
      confidence_score: discovery.confidence_score,
      provider_supported: true,
      onboarding_status: args.write ? "appended_to_sources" : "eligible_dry_run",
      skip_reason: "",
      recommended_sync_path: discovery.recommended_sync_path
    });
  }

  if (args.write) {
    await Promise.all([
      writeJson(SOURCES_FILE, { ...sourcesPayload, sources: nextSources }),
      writeJson(args.candidatesFile, {
        generated_at: new Date().toISOString(),
        candidates: combinedCandidates
      })
    ]);
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: args.write ? "write" : "dry_run",
    candidates_file: args.candidatesFile,
    queries_file: args.queriesFile,
    summary: {
      manual_candidates_seeded: seededCandidates.length,
      search_queries_enabled: toArray(searchQueries).filter(isSourceDiscoveryQuery).length,
      search_candidates_found: discoveredCandidates.length,
      workable_search_results: queryReports
        .filter((entry) => entry.provider === "workable_global_search")
        .reduce((sum, entry) => sum + Number(entry.search_results_found || 0), 0),
      combined_candidates_total: combinedCandidates.length,
      ...summarizeDiscovery(results)
    },
    search_queries: queryReports,
    results
  };

  await writeJson(REPORT_FILE, report);

  console.log(`[jobs:discover-sources] mode=${args.write ? "write" : "dry_run"} manual_candidates_seeded=${seededCandidates.length} search_candidates_found=${discoveredCandidates.length} combined_candidates_total=${combinedCandidates.length} appended_to_sources=${report.summary.appended_to_sources} already_configured=${report.summary.already_configured} eligible_dry_run=${report.summary.eligible_dry_run} skipped=${report.summary.skipped}`);
  results.forEach((entry) => {
    console.log(
      `[jobs:discover-sources] organization=${entry.organization} provider=${entry.detected_provider || ""} supported=${entry.provider_supported} status=${entry.onboarding_status} sync_path=${entry.recommended_sync_path}${entry.skip_reason ? ` skip_reason=${entry.skip_reason}` : ""}`
    );
  });
  console.log(`[jobs:discover-sources] report=${REPORT_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:discover-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  discoverCandidatesFromSearch,
  main,
  parseArgs
};
