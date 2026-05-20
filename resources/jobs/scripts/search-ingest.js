const fs = require("fs/promises");
const path = require("path");
const vm = require("vm");
const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJson,
  writeJson,
  writeJsonIfChanged
} = require("./job-utils");
const {
  assessPublicJobReadiness,
  computeParserConfidenceScore,
  getParserCleanupStats,
  normalizeJob,
  resetParserCleanupStats,
  stableHash,
  todayIso
} = require("./job-normalizer");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");
const {
  buildSourceCandidate,
  extractSourceCandidateFromSearchResult,
  isBlockedAggregatorUrl,
  isBlockedSourceUrl,
  mergeCandidates,
  readCandidatePayload
} = require("./source-discovery-helpers");
const { filterBlockedSourceEntries, getBlockedSourceRuleForEntry } = require("./blocked-source-utils");

const ROOT = path.resolve(__dirname, "..");
const SEARCH_SOURCES_FILE = path.join(ROOT, "search-sources.json");
const SOURCE_DISCOVERY_CANDIDATES_FILE = path.join(ROOT, "source-discovery-candidates.json");
const REPORT_FILE = path.join(ROOT, "reports", "search-ingest-report.json");
const CWD = process.cwd();

function detectRepoRoot(jobsRoot) {
  const normalizedJobsRoot = path.resolve(jobsRoot);
  const parentDir = path.dirname(normalizedJobsRoot);
  if (path.basename(normalizedJobsRoot) === "jobs" && path.basename(parentDir) === "resources") {
    return path.resolve(normalizedJobsRoot, "..", "..");
  }
  return path.resolve(normalizedJobsRoot, "..");
}

function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function resolveQueriesFilePath(providedQueriesFile, jobsRoot = ROOT, cwd = CWD) {
  const repoRoot = detectRepoRoot(jobsRoot);
  if (!providedQueriesFile) {
    return {
      provided_queries_file: "",
      resolved_queries_file: SEARCH_SOURCES_FILE,
      jobs_root: jobsRoot,
      repo_root: repoRoot,
      cwd
    };
  }

  const candidates = [];
  if (path.isAbsolute(providedQueriesFile)) {
    candidates.push(path.resolve(providedQueriesFile));
  } else {
    candidates.push(path.resolve(cwd, providedQueriesFile));
    candidates.push(path.resolve(jobsRoot, providedQueriesFile));
    if (path.basename(path.resolve(jobsRoot)) === "jobs" && path.basename(path.dirname(path.resolve(jobsRoot))) === "resources") {
      candidates.push(path.resolve(repoRoot, providedQueriesFile));
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return {
        provided_queries_file: providedQueriesFile,
        resolved_queries_file: candidate,
        jobs_root: jobsRoot,
        repo_root: repoRoot,
        cwd
      };
    }
  }

  throw new Error(
    `queries-file not found: provided="${providedQueriesFile}" cwd="${cwd}" jobsRoot="${jobsRoot}" repoRoot="${repoRoot}" candidates="${candidates.join('", "')}"` 
  );
}

function parseArgs(argv) {
  const args = {
    write: false,
    queriesFile: SEARCH_SOURCES_FILE,
    queriesFileProvided: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--queries-file" && argv[index + 1]) {
      args.queriesFile = argv[index + 1];
      args.queriesFileProvided = true;
      index += 1;
    }
  }
  return args;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readSourceDiscoveryCandidates() {
  const payload = await readJson(SOURCE_DISCOVERY_CANDIDATES_FILE, { candidates: [] });
  return readCandidatePayload(payload);
}

function loadSearchQueries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.queries)) return payload.queries;
  if (payload && Array.isArray(payload.sources)) return payload.sources;
  if (payload && Array.isArray(payload.entries)) return payload.entries;
  return [];
}

async function loadSearchConfigFromFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`unable to read queries-file "${filePath}": ${error.message}`);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in queries-file "${filePath}": ${error.message}`);
  }

  if (!payload || !Array.isArray(payload.queries)) {
    throw new Error(`queries-file "${filePath}" must contain a top-level "queries" array`);
  }

  return payload;
}

function buildProviderCounts(queries) {
  const counts = {};
  for (const query of toArray(queries)) {
    const provider = stringify(query?.provider) || "unknown";
    counts[provider] = Number(counts[provider] || 0) + 1;
  }
  return counts;
}

function stringify(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function buildMissingEnvDiagnostics(provider, missingEnvVars) {
  return {
    provider,
    classification: "missing_env_vars",
    http_status: 0,
    reason: "missing_env_vars",
    message: `Missing env vars: ${missingEnvVars.join(", ")}`,
    missing_env_vars: missingEnvVars
  };
}

function classifyGoogleCustomSearchError({ httpStatus, payload, rawText }) {
  const googleError = payload?.error || {};
  const reasons = toArray(googleError.errors).map((entry) => stringify(entry?.reason)).filter(Boolean);
  const message = stringify(googleError.message || rawText || `HTTP ${httpStatus}`);
  const reasonText = reasons.join(", ");
  const descriptor = `${reasonText} ${message}`.toLowerCase();

  let classification = httpStatus === 403 ? "forbidden_403_unknown" : "http_error";
  if (/api key not valid|keyinvalid|invalid api key|badrequest/i.test(descriptor)) {
    classification = "invalid_api_key";
  } else if (/accessnotconfigured|service_disabled|api .*not (enabled|used)|customsearch api has not been used/i.test(descriptor)) {
    classification = "api_not_enabled";
  } else if (/dailylimitexceeded|quotaexceeded|ratelimitexceeded|billing|bill|usage limits/i.test(descriptor)) {
    classification = "billing_or_quota_issue";
  } else if (/cse|cx|custom search engine id|search engine id|invalid value.*cx|not found.*cx/i.test(descriptor)) {
    classification = "invalid_custom_search_engine_id";
  } else if (/iprefererblocked|referer|referrer|ip address|request had insufficient authentication scopes|requests from referer/i.test(descriptor)) {
    classification = "key_restriction_or_referrer_ip_issue";
  }

  return {
    provider: "google_custom_search",
    classification,
    http_status: Number(httpStatus || 0),
    reason: reasonText || (httpStatus === 403 ? "forbidden" : "http_error"),
    message,
    google_error_status: stringify(googleError.status),
    google_error_reasons: reasons
  };
}

function buildProviderErrorDiagnostics(provider, { httpStatus = 0, payload = null, rawText = "" } = {}) {
  if (provider === "google_custom_search") {
    return classifyGoogleCustomSearchError({ httpStatus, payload, rawText });
  }

  const message = stringify(payload?.error?.message || payload?.message || rawText || `HTTP ${httpStatus}`);
  return {
    provider,
    classification: httpStatus ? "http_error" : "fetch_error",
    http_status: Number(httpStatus || 0),
    reason: httpStatus ? `http_${httpStatus}` : "fetch_error",
    message
  };
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

const WORKABLE_CLIMATE_TERMS = [
  "climate",
  "sustainability",
  "clean energy",
  "renewable energy",
  "decarbonization",
  "energy transition",
  "environmental",
  "conservation",
  "climate policy",
  "carbon",
  "nature",
  "biodiversity",
  "virtual power plant"
];

const WORKABLE_COMMUNICATIONS_TERMS = [
  "communications",
  "content",
  "campaigns",
  "advocacy",
  "digital",
  "strategy",
  "partnerships",
  "organizing",
  "policy",
  "community",
  "storytelling",
  "mobilization",
  "engagement",
  "marketing",
  "public affairs"
];

const WORKABLE_DEPRIORITIZE_TERMS = [
  "saas",
  "enterprise software",
  "crm",
  "fintech",
  "crypto",
  "blockchain",
  "trading",
  "casino",
  "betting",
  "retail operations",
  "fashion retail",
  "salesforce",
  "customer support bpo"
];

const WORKABLE_TARGET_FUNCTION_TERMS = [
  "communications",
  "content",
  "campaign",
  "campaigns",
  "advocacy",
  "digital",
  "strategy",
  "partnerships",
  "organizing",
  "policy",
  "community",
  "storytelling",
  "engagement",
  "public affairs"
];

const WORKABLE_UNPAID_TERMS = [
  "unpaid",
  "volunteer",
  "unpaid volunteer",
  "no compensation",
  "stipend only",
  "commission only",
  "equity only",
  "donate your time",
  "pro bono"
];

const WORKABLE_COMPENSATION_POSITIVE_TERMS = [
  "salary",
  "hourly",
  "per hour",
  "compensation",
  "pay range",
  "base pay",
  "annual salary",
  "benefits",
  "full-time employee",
  "paid internship",
  "$",
  "usd ",
  "eur ",
  "gbp "
];

function countKeywordHits(text, terms) {
  const haystack = stringify(text).toLowerCase();
  if (!haystack) return 0;
  return terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
}

function scoreKeywordHits(text, terms, maxScore = 100, perHit = 18) {
  return Math.min(maxScore, countKeywordHits(text, terms) * perHit);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function stripHtmlTags(value) {
  return stringify(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveWorkableLocation(location) {
  if (!location || typeof location !== "object") return "";
  return [
    stringify(location.city),
    stringify(location.subregion || location.region),
    stringify(location.countryName || location.country)
  ]
    .filter(Boolean)
    .join(", ");
}

function parseWorkableGlobalSearchPayload(rawHtml) {
  const match = String(rawHtml || "").match(/window\.jobBoard\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/i);
  if (!match) {
    throw new Error("Unable to locate embedded Workable global search payload.");
  }

  let payload;
  try {
    payload = vm.runInNewContext(`(${match[1]})`);
  } catch (error) {
    throw new Error(`Unable to parse embedded Workable global search payload: ${error.message}`);
  }

  return payload;
}

function extractWorkableGlobalSearchResults(payload) {
  return toArray(payload?.initialState?.["api/v1/jobs"]?.data?.jobs);
}

function scoreWorkableSearchLead(queryConfig, lead) {
  const company = lead?.company || {};
  const descriptor = [
    stringify(lead?.title),
    stringify(lead?.department),
    stringify(lead?.employmentType),
    stringify(lead?.workplace),
    stripHtmlTags(lead?.description),
    stripHtmlTags(company?.description),
    stringify(company?.title),
    stringify(queryConfig?.query)
  ]
    .filter(Boolean)
    .join(" ");

  const climateRelevance = clampScore(
    scoreKeywordHits(descriptor, WORKABLE_CLIMATE_TERMS, 100, 22) +
    scoreKeywordHits(stringify(queryConfig?.sector), WORKABLE_CLIMATE_TERMS, 20, 10)
  );
  const communicationsRelevance = clampScore(scoreKeywordHits(descriptor, WORKABLE_COMMUNICATIONS_TERMS, 100, 20));
  const structuredAtsConfidence = 96;
  const employerLegitimacy = clampScore(
    45 +
    (company?.website ? 25 : 0) +
    (company?.title ? 15 : 0) +
    (company?.url ? 10 : 0)
  );
  const duplicateRisk = clampScore(
    20 +
    (company?.website ? 0 : 25) +
    (company?.title ? 0 : 20) +
    (/recruit|staffing|outsourc|bpo/i.test(descriptor) ? 20 : 0)
  );
  const deprioritizeHits = countKeywordHits(descriptor, WORKABLE_DEPRIORITIZE_TERMS);
  const targetFunctionMatch = WORKABLE_TARGET_FUNCTION_TERMS.some((term) => descriptor.toLowerCase().includes(term));
  const shouldSkipEmployer = climateRelevance < 35 && communicationsRelevance < 35 && deprioritizeHits > 0;
  const shouldDirectPendingIngest = !shouldSkipEmployer && (climateRelevance >= 45 || communicationsRelevance >= 55) && targetFunctionMatch;

  return {
    climate_relevance: climateRelevance,
    communications_relevance: communicationsRelevance,
    structured_ats_confidence: structuredAtsConfidence,
    employer_legitimacy: employerLegitimacy,
    duplicate_risk: duplicateRisk,
    target_function_match: targetFunctionMatch,
    should_skip_employer: shouldSkipEmployer,
    should_direct_pending_ingest: shouldDirectPendingIngest,
    deprioritize_hits: deprioritizeHits
  };
}

function evaluateWorkableCompensationQuality(lead) {
  const descriptor = [
    stringify(lead?.title),
    stringify(lead?.department),
    stringify(lead?.employmentType),
    stringify(lead?.workplace),
    stripHtmlTags(lead?.description),
    stripHtmlTags(lead?.company?.description)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasUnpaidTerm = WORKABLE_UNPAID_TERMS.some((term) => descriptor.includes(term));
  const hasVolunteerTerm = /\bvolunteer\b/.test(descriptor);
  const isInternship = /\bintern(ship)?\b/.test(descriptor);
  const hasPositiveCompensationSignal = WORKABLE_COMPENSATION_POSITIVE_TERMS.some((term) => descriptor.includes(term));
  const appearsPaidInternship = isInternship && hasPositiveCompensationSignal && !hasUnpaidTerm;

  if (hasVolunteerTerm) {
    return { allow: false, reason: "volunteer_roles_filtered", is_internship: isInternship, paid_internship_allowed: false };
  }
  if (hasUnpaidTerm && isInternship) {
    return { allow: false, reason: "unpaid_internships_filtered", is_internship: true, paid_internship_allowed: false };
  }
  if (hasUnpaidTerm) {
    return { allow: false, reason: "unpaid_roles_filtered", is_internship: isInternship, paid_internship_allowed: false };
  }
  if (isInternship && !hasPositiveCompensationSignal) {
    return { allow: false, reason: "unpaid_internships_filtered", is_internship: true, paid_internship_allowed: false };
  }
  if (appearsPaidInternship) {
    return { allow: true, reason: "", is_internship: true, paid_internship_allowed: true };
  }
  return { allow: true, reason: "", is_internship: isInternship, paid_internship_allowed: false };
}

function buildWorkableGlobalSourceCandidate(queryConfig, lead, scores) {
  const company = lead?.company || {};
  const organization = stringify(company.title) || "Unknown organization";
  return buildSourceCandidate({
    organization,
    sourceName: organization,
    url: stringify(company.website || ""),
    homepage: stringify(company.website || ""),
    knownCareersUrl: "",
    candidateUrls: [
      stringify(company.website || ""),
      stringify(company.url || ""),
      stringify(lead?.url || "")
    ],
    provider: "workable_global_search",
    discoveryProvider: "workable_global_search",
    missionTags: toArray(queryConfig.mission_tags),
    discoveryQuery: stringify(queryConfig.query),
    notes: `Employer discovered from Workable global search query "${queryConfig.query}". Verify the canonical employer career board before adding as a source; do not treat jobs.workable.com as the canonical source.`,
    category: stringify(queryConfig.sector || "Mission-aligned"),
    title: stringify(lead?.title),
    sourceScores: scores
  });
}

function getMissingEnvForProvider(provider) {
  return requiredEnvForProvider(provider).filter((key) => !process.env[key]);
}

function buildSearchUrl(queryConfig) {
  if (queryConfig.provider === "workable_global_search") {
    const params = new URLSearchParams({
      query: queryConfig.query
    });
    return `https://jobs.workable.com/search?${params.toString()}`;
  }

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
  if (provider === "workable_global_search") {
    return extractWorkableGlobalSearchResults(payload);
  }
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
  const score = computeParserConfidenceScore(lead);
  return score >= 85 ? "high" : score >= 65 ? "medium" : "low";
}

function buildParserFailurePendingLead(queryConfig, normalizedLead, reason, providerLead) {
  const applyUrl = stringify(normalizedLead.apply_url || normalizedLead.source_url || "");
  const title = stringify(normalizedLead.title || queryConfig.query || "Untitled role");
  const organization = stringify(normalizedLead.organization || "Unknown organization");
  const confidence = getConfidence({
    ...normalizedLead,
    title,
    organization,
    apply_url: applyUrl
  });
  return {
    id: `wide-search-${queryConfig.id}-${stableHash(`${title}:${organization}:${applyUrl}:${reason}`)}`,
    external_id: normalizedLead.external_id || `wide-search_parse_failed_${queryConfig.id}_${stableHash(`${title}:${organization}:${applyUrl}`)}`,
    title,
    organization,
    location: stringify(normalizedLead.location || ""),
    workplace_type: stringify(normalizedLead.workplace_type || queryConfig.workplace_type || ""),
    job_type: stringify(normalizedLead.job_type || ""),
    salary: stringify(normalizedLead.salary || ""),
    sector: stringify(queryConfig.sector || "General"),
    function: stringify(normalizedLead.function_hint || queryConfig.function || ""),
    source: stringify(queryConfig.source_name || queryConfig.organization || "Wide Search"),
    source_id: `search:${queryConfig.id}`,
    source_type: stringify(queryConfig.provider),
    source_url: stringify(normalizedLead.source_url || applyUrl),
    apply_url: applyUrl,
    original_url: applyUrl || stringify(normalizedLead.source_url || ""),
    date_posted: todayIso(),
    date_added: todayIso(),
    date_updated: todayIso(),
    status: "pending",
    trusted: false,
    auto_publish: false,
    pending_only: true,
    pending_only_sync: true,
    confidence,
    review_reason: `parser_failed_capture_pending:${reason}`,
    triage_reason: `parser_failed_capture_pending:${reason}`,
    shared_by: stringify(queryConfig.provider),
    notes: stringify(queryConfig.notes || `Lead collected from ${queryConfig.provider} query "${queryConfig.query}".`),
    sync_origin: "wide-search",
    raw_description: stringify(normalizedLead.raw_description || normalizedLead.description || ""),
    description: stringify(normalizedLead.description || normalizedLead.raw_description || ""),
    tags: [
      queryConfig.sector,
      queryConfig.function,
      queryConfig.provider,
      "parser_failed_capture_pending",
      ...toArray(normalizedLead.tags),
      ...toArray(queryConfig.mission_tags)
    ].filter(Boolean),
    raw_payload: providerLead && typeof providerLead === "object" ? providerLead : undefined
  };
}

function normalizeProviderLead(queryConfig, provider, lead) {
  if (provider === "workable_global_search") {
    const company = lead.company || {};
    const scores = lead._workable_search_scores || scoreWorkableSearchLead(queryConfig, lead);
    const location = deriveWorkableLocation(lead.location);
    return {
      title: lead.title || queryConfig.query,
      organization: company.title || "Unknown organization",
      location,
      workplace_type: stringify(lead.workplace),
      job_type: stringify(lead.employmentType),
      salary: "",
      raw_description: stringify(lead.description || ""),
      description: [stripHtmlTags(lead.description), stripHtmlTags(company.description)].filter(Boolean).join("\n\n"),
      source_url: stringify(lead.url || company.url || company.website),
      apply_url: stringify(lead.url || company.url || company.website),
      external_id: lead.id ? `workable_global_search_${queryConfig.id}_${lead.id}` : "",
      source_type: provider,
      function_hint: stringify(lead.department),
      tags: [
        scores.climate_relevance >= 45 ? "mission_relevant" : "",
        scores.communications_relevance >= 55 ? "communications_relevant" : "",
        "workable_global_search"
      ].filter(Boolean)
    };
  }

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

  const normalized = normalizeJob({
    id: `wide-search-${queryConfig.id}-${stableHash(`${title}:${organization}:${applyUrl}`)}`,
    external_id: externalId,
    title,
    organization,
    location: normalizedLead.location || "",
    workplace_type: normalizedLead.workplace_type || queryConfig.workplace_type || "",
    job_type: normalizedLead.job_type || "",
    salary: normalizedLead.salary || "",
    sector: queryConfig.sector || "General",
    function: normalizedLead.function_hint || queryConfig.function || "",
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
      ...toArray(normalizedLead.tags),
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
  if (!normalized) {
    return buildParserFailurePendingLead(queryConfig, normalizedLead, "normalize_job_returned_null", lead);
  }

  const readiness = assessPublicJobReadiness(normalized, {
    source: { provider: queryConfig.provider, source_url: normalized.source_url }
  });
  return {
    ...normalized,
    confidence: readiness.parser_confidence,
    review_reason: readiness.ready
      ? "search_capture_pending_review"
      : `search_capture_pending_review:${readiness.reasons.join(";")}`,
    triage_reason: readiness.ready
      ? "search_capture_pending_review"
      : readiness.reasons.join(";")
  };
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
  const rawText = await response.text();
  const payload = queryConfig.provider === "workable_global_search"
    ? parseWorkableGlobalSearchPayload(rawText)
    : safeJsonParse(rawText);
  if (!response.ok) {
    const diagnostics = buildProviderErrorDiagnostics(queryConfig.provider, {
      httpStatus: response.status,
      payload,
      rawText
    });
    const error = new Error(`${diagnostics.message} (HTTP ${response.status})`);
    error.httpStatus = response.status;
    error.providerDiagnostics = diagnostics;
    throw error;
  }
  return {
    payload,
    results: extractResults(queryConfig.provider, payload)
  };
}

function shouldRouteResultToSourceDiscovery(queryConfig, lead) {
  if (stringify(queryConfig.provider) === "workable_global_search") {
    const scores = scoreWorkableSearchLead(queryConfig, lead);
    lead._workable_search_scores = scores;
    const company = lead?.company || {};
    const canonicalEmployerUrl = stringify(company.website || "");
    if (canonicalEmployerUrl && isBlockedAggregatorUrl(canonicalEmployerUrl)) {
      return { candidate: null, skip_reason: "aggregator_skipped", aggregators_skipped: 1 };
    }
    if (
      isBlockedSourceUrl(canonicalEmployerUrl) ||
      isBlockedSourceUrl(stringify(company.url || "")) ||
      isBlockedSourceUrl(stringify(lead?.url || ""))
    ) {
      return { candidate: null, skip_reason: "blocked_source_removed" };
    }
    if (scores.should_skip_employer) {
      return { candidate: null, skip_reason: "workable_low_relevance_employer_skipped" };
    }
    if (scores.should_direct_pending_ingest) {
      return null;
    }
    return {
      candidate: buildWorkableGlobalSourceCandidate(queryConfig, lead, scores),
      skip_reason: ""
    };
  }

  const extraction = extractSourceCandidateFromSearchResult(queryConfig, stringify(queryConfig.provider), lead);
  if (extraction.candidate) {
    return extraction;
  }
  return extraction.skip_reason === "aggregator_skipped" || extraction.skip_reason === "climate_change_jobs_skipped"
    ? extraction
    : null;
}

function mergeSourceHealthEntries(existingEntries, nextEntries) {
  const keep = toArray(existingEntries).filter((entry) => !String(entry.source_id || "").startsWith("search:"));
  return [...keep, ...nextEntries];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  resetParserCleanupStats();

  const resolution = await resolveQueriesFilePath(args.queriesFile, ROOT, process.cwd());

  const [searchConfig, publicJobs, pendingJobs, previousHealth] = await Promise.all([
    loadSearchConfigFromFile(resolution.resolved_queries_file),
    readJson(JOBS_FILE, []),
    readJson(PENDING_SYNCED_FILE, []),
    readSourceHealthSnapshot()
  ]);

  const allQueries = loadSearchQueries(searchConfig);
  if (!Array.isArray(allQueries)) {
    throw new Error(`queries-file "${resolution.resolved_queries_file}" did not produce a queries array`);
  }
  const queries = allQueries.filter((query) => query && query.enabled !== false);
  const providerCountsAll = buildProviderCounts(allQueries);
  const providerCountsEnabled = buildProviderCounts(queries);
  const enabledQueryIds = queries
    .map((query) => stringify(query.id))
    .filter(Boolean);

  console.log(
    `[jobs:search-ingest] cwd=${resolution.cwd} jobsRoot=${resolution.jobs_root} provided_queries_file=${resolution.provided_queries_file || "(default)"} resolved_queries_file=${resolution.resolved_queries_file}`
  );
  console.log(
    `[jobs:search-ingest] queries_total=${allQueries.length} queries_enabled=${queries.length} provider_counts_total=${JSON.stringify(providerCountsAll)} provider_counts_enabled=${JSON.stringify(providerCountsEnabled)} enabled_query_ids=${enabledQueryIds.join(",")}`
  );

  const reportEntries = [];
  const sourceHealthEntries = [];
  const newPendingLeads = [];
  const newSourceCandidates = [];
  const existingKeySet = buildExistingKeySet([...toArray(publicJobs), ...toArray(pendingJobs)]);
  const seenThisRun = new Set();
  let jobsFoundTotal = 0;
  let jobsNormalizedTotal = 0;
  let jobsAddedToPendingTotal = 0;
  let duplicatesSkippedTotal = 0;
  let sourceCandidatesFoundTotal = 0;
  let sourceCandidatesAddedTotal = 0;
  let aggregatorsSkippedTotal = 0;
  let climateChangeJobsSkippedTotal = 0;
  let workableSearchResultsTotal = 0;
  let workableEmployersDiscoveredTotal = 0;
  let workableJobsAddedToPendingTotal = 0;
  let unpaidRolesFilteredTotal = 0;
  let volunteerRolesFilteredTotal = 0;
  let unpaidInternshipsFilteredTotal = 0;
  let paidInternshipsAllowedTotal = 0;
  const exampleWorkableEmployers = [];
  const exampleWorkablePendingJobs = [];
  const exampleWorkableSkippedEmployers = [];
  const exampleWorkableExcludedRoles = [];
  const exampleWorkablePaidInternships = [];

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
      search_results_found: 0,
      jobs_found: 0,
      jobs_normalized: 0,
      jobs_added_to_pending: 0,
      source_candidates_found: 0,
      source_candidates_added: 0,
      aggregators_skipped: 0,
      climate_change_jobs_skipped: 0,
      workable_search_results: 0,
      workable_employers_discovered: 0,
      workable_jobs_added_to_pending: 0,
      workable_sources_added: 0,
      unpaid_roles_filtered: 0,
      volunteer_roles_filtered: 0,
      unpaid_internships_filtered: 0,
      paid_internships_allowed: 0,
      duplicates_skipped: 0,
      skipped_jobs: 0,
      dedupe_reasons: {},
      missing_env_vars: missingEnvVars,
      provider_error: "",
      provider_error_details: null,
      http_status: 0,
      detected_urls: [],
      notes: stringify(queryConfig.notes)
    };

    if (missingEnvVars.length) {
      const diagnostics = buildMissingEnvDiagnostics(provider, missingEnvVars);
      reportEntry.status = "missing_env_vars";
      reportEntry.provider_error = diagnostics.message;
      reportEntry.provider_error_details = diagnostics;
      reportEntry.http_status = diagnostics.http_status;
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
        http_status: diagnostics.http_status,
        provider_error_details: diagnostics,
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 1
      });
      console.log(`[jobs:search-ingest] query_id=${queryId} provider=${provider} status=missing_env_vars missing=${missingEnvVars.join(",")}`);
      continue;
    }

    try {
      const { results: rawResults } = await fetchQueryResults(queryConfig);
      const limitedResults = toArray(rawResults).slice(0, maxResults);
      reportEntry.search_results_found = limitedResults.length;
      if (provider === "workable_global_search") {
        reportEntry.workable_search_results = limitedResults.length;
        workableSearchResultsTotal += limitedResults.length;
      }
      reportEntry.detected_urls = limitedResults
        .map((item) => stringify(item.apply_link || item.job_link || item.link || item.url || item.absolute_url || item.hostedUrl))
        .filter(Boolean)
        .slice(0, 20);

      for (const lead of limitedResults) {
        const sourceRouting = shouldRouteResultToSourceDiscovery(queryConfig, lead);
        if (sourceRouting?.candidate) {
          reportEntry.source_candidates_found += 1;
          reportEntry.source_candidates_added += 1;
          if (provider === "workable_global_search") {
            reportEntry.workable_employers_discovered += 1;
            workableEmployersDiscoveredTotal += 1;
            if (exampleWorkableEmployers.length < 5) {
              exampleWorkableEmployers.push({
                organization: sourceRouting.candidate.organization,
                homepage: sourceRouting.candidate.homepage || sourceRouting.candidate.url || "",
                source_scores: sourceRouting.candidate.source_scores || {}
              });
            }
          }
          sourceCandidatesFoundTotal += 1;
          sourceCandidatesAddedTotal += 1;
          const blockedCandidateRule = getBlockedSourceRuleForEntry(sourceRouting.candidate);
          if (blockedCandidateRule) {
            reportEntry.source_candidates_skipped += 1;
            reportEntry.dedupe_reasons.blocked_source_removed = Number(reportEntry.dedupe_reasons.blocked_source_removed || 0) + 1;
            continue;
          }
          newSourceCandidates.push(sourceRouting.candidate);
          continue;
        }
        if (sourceRouting?.skip_reason === "workable_low_relevance_employer_skipped") {
          if (exampleWorkableSkippedEmployers.length < 5) {
            exampleWorkableSkippedEmployers.push({
              organization: stringify(lead?.company?.title),
              website: stringify(lead?.company?.website),
              title: stringify(lead?.title)
            });
          }
          continue;
        }
        if (sourceRouting?.skip_reason === "aggregator_skipped") {
          reportEntry.aggregators_skipped += 1;
          aggregatorsSkippedTotal += 1;
          continue;
        }
        if (sourceRouting?.skip_reason === "climate_change_jobs_skipped") {
          reportEntry.climate_change_jobs_skipped += 1;
          climateChangeJobsSkippedTotal += 1;
          continue;
        }

        reportEntry.jobs_found += 1;
        jobsFoundTotal += 1;
        if (provider === "workable_global_search") {
          const quality = evaluateWorkableCompensationQuality(lead);
          if (!quality.allow) {
            reportEntry[quality.reason] = Number(reportEntry[quality.reason] || 0) + 1;
            if (quality.reason === "unpaid_roles_filtered") unpaidRolesFilteredTotal += 1;
            if (quality.reason === "volunteer_roles_filtered") volunteerRolesFilteredTotal += 1;
            if (quality.reason === "unpaid_internships_filtered") unpaidInternshipsFilteredTotal += 1;
            if (exampleWorkableExcludedRoles.length < 5) {
              exampleWorkableExcludedRoles.push({
                title: stringify(lead?.title),
                organization: stringify(lead?.company?.title),
                reason: quality.reason
              });
            }
            continue;
          }
          if (quality.paid_internship_allowed) {
            reportEntry.paid_internships_allowed += 1;
            paidInternshipsAllowedTotal += 1;
            if (exampleWorkablePaidInternships.length < 5) {
              exampleWorkablePaidInternships.push({
                title: stringify(lead?.title),
                organization: stringify(lead?.company?.title),
                apply_url: stringify(lead?.url)
              });
            }
          }
        }
        const normalized = normalizeLead(queryConfig, lead);
        if (!normalized) {
          reportEntry.skipped_jobs += 1;
          continue;
        }
        const blockedLeadRule = getBlockedSourceRuleForEntry(normalized);
        if (blockedLeadRule) {
          reportEntry.skipped_jobs += 1;
          reportEntry.dedupe_reasons.blocked_source_removed = Number(reportEntry.dedupe_reasons.blocked_source_removed || 0) + 1;
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
        if (provider === "workable_global_search") {
          reportEntry.workable_jobs_added_to_pending += 1;
          workableJobsAddedToPendingTotal += 1;
          if (exampleWorkablePendingJobs.length < 5) {
            exampleWorkablePendingJobs.push({
              title: normalized.title,
              organization: normalized.organization,
              apply_url: normalized.apply_url,
              function: normalized.function
            });
          }
        }
        dedupeKeys.forEach((key) => seenThisRun.add(key));
      }

      reportEntry.status = reportEntry.jobs_added_to_pending > 0
        ? "pending_updated"
        : reportEntry.source_candidates_found > 0
          ? "source_candidates_discovered"
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
        source_candidates_found: reportEntry.source_candidates_found,
        source_candidates_added: reportEntry.source_candidates_added,
        aggregators_skipped: reportEntry.aggregators_skipped,
        climate_change_jobs_skipped: reportEntry.climate_change_jobs_skipped,
        duplicates_skipped: reportEntry.duplicates_skipped,
        pending_count_delta: reportEntry.jobs_added_to_pending,
        public_count_delta: 0,
        skip_reasons: Object.keys(reportEntry.dedupe_reasons),
        missing_env_vars: [],
        http_status: 200,
        last_successful_sync: nowIso(),
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 0
      });
      reportEntries.push(reportEntry);
      console.log(`[jobs:search-ingest] query_id=${queryId} provider=${provider} jobs_found=${reportEntry.jobs_found} jobs_normalized=${reportEntry.jobs_normalized} jobs_added_to_pending=${reportEntry.jobs_added_to_pending} duplicates_skipped=${reportEntry.duplicates_skipped}`);
    } catch (error) {
      const diagnostics = error.providerDiagnostics || {
        provider,
        classification: "fetch_error",
        http_status: Number(error.httpStatus || 0),
        reason: "fetch_error",
        message: error.message
      };
      reportEntry.status = "fetch_failed";
      reportEntry.provider_error = error.message;
      reportEntry.provider_error_details = diagnostics;
      reportEntry.http_status = Number(diagnostics.http_status || error.httpStatus || 0);
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
        http_status: Number(diagnostics.http_status || error.httpStatus || 0),
        provider_error_details: diagnostics,
        sync_duration_ms: Date.now() - queryStartedAt,
        failure_error_count: 1,
        error: error.message
      });
      console.error(`[jobs:search-ingest] query_id=${queryId} provider=${provider} status=fetch_failed http_status=${Number(diagnostics.http_status || error.httpStatus || 0)} classification=${diagnostics.classification || "fetch_error"} error=${error.message}`);
    }
  }

  const mergedPending = filterBlockedSourceEntries(
    newPendingLeads.length
      ? [...toArray(pendingJobs), ...newPendingLeads]
      : toArray(pendingJobs)
  );
  const existingSourceCandidates = await readSourceDiscoveryCandidates();
  const mergedSourceCandidates = filterBlockedSourceEntries(
    mergeCandidates(existingSourceCandidates, newSourceCandidates)
  );
  const pendingChanged = args.write
    ? await writeJsonIfChanged(PENDING_SYNCED_FILE, mergedPending)
    : false;
  const sourceCandidatesChanged = args.write
    ? await writeJsonIfChanged(SOURCE_DISCOVERY_CANDIDATES_FILE, {
      generated_at: nowIso(),
      candidates: mergedSourceCandidates
    })
    : false;

  const parserStats = getParserCleanupStats();
  const meaningfulErrorCount = reportEntries.filter((entry) => entry.status === "fetch_failed" || entry.status === "missing_env_vars").length;
  const shouldPersistArtifacts = Boolean(args.write && (pendingChanged || sourceCandidatesChanged || meaningfulErrorCount > 0));
  const report = {
    generated_at: nowIso(),
    mode: args.write ? "write" : "dry_run",
    cwd: resolution.cwd,
    jobs_root: resolution.jobs_root,
    provided_queries_file: resolution.provided_queries_file,
    queries_file: resolution.resolved_queries_file,
    pending_only: true,
    pending_file: PENDING_SYNCED_FILE,
    source_discovery_candidates_file: SOURCE_DISCOVERY_CANDIDATES_FILE,
      source_health_file: shouldPersistArtifacts || meaningfulErrorCount > 0 ? "resources/jobs/source-health-latest.json" : "",
    summary: {
      queries_total: allQueries.length,
      queries_enabled: queries.length,
      provider_counts_total: providerCountsAll,
      provider_counts_enabled: providerCountsEnabled,
      enabled_query_ids: enabledQueryIds,
      sources_attempted: reportEntries.filter((entry) => entry.status !== "missing_env_vars").length,
      jobs_found: jobsFoundTotal,
      jobs_normalized: jobsNormalizedTotal,
      jobs_added_to_pending: jobsAddedToPendingTotal,
      source_candidates_found: sourceCandidatesFoundTotal,
      source_candidates_added: sourceCandidatesAddedTotal,
      workable_search_results: workableSearchResultsTotal,
      workable_employers_discovered: workableEmployersDiscoveredTotal,
      workable_jobs_added_to_pending: workableJobsAddedToPendingTotal,
      workable_sources_added: 0,
      unpaid_roles_filtered: unpaidRolesFilteredTotal,
      volunteer_roles_filtered: volunteerRolesFilteredTotal,
      unpaid_internships_filtered: unpaidInternshipsFilteredTotal,
      paid_internships_allowed: paidInternshipsAllowedTotal,
      aggregators_skipped: aggregatorsSkippedTotal,
      climate_change_jobs_skipped: climateChangeJobsSkippedTotal,
      duplicates_skipped: duplicatesSkippedTotal,
      fetch_failed: reportEntries.filter((entry) => entry.status === "fetch_failed").length,
      missing_env_var_queries: reportEntries.filter((entry) => entry.status === "missing_env_vars").length,
      meaningful_error_count: meaningfulErrorCount,
      pending_changed: pendingChanged,
      source_candidates_changed: sourceCandidatesChanged,
      should_persist_artifacts: shouldPersistArtifacts
    },
    parser_stats: parserStats,
    examples: {
      workable_discovered_employers: exampleWorkableEmployers,
      workable_pending_jobs: exampleWorkablePendingJobs,
      workable_skipped_employers: exampleWorkableSkippedEmployers,
      workable_excluded_roles: exampleWorkableExcludedRoles,
      workable_paid_internships: exampleWorkablePaidInternships
    },
    results: reportEntries
  };

  if (!args.write || shouldPersistArtifacts) {
    await writeJson(REPORT_FILE, report);
  }
  if (shouldPersistArtifacts || meaningfulErrorCount > 0) {
    const nextHealthEntries = mergeSourceHealthEntries(previousHealth.sources, sourceHealthEntries);
    await writeSourceHealthSnapshot({
      generated_at: nowIso(),
      sync_type: "search-ingest",
      sources: nextHealthEntries
    });
  }

  console.log(
    `[jobs:search-ingest] mode=${args.write ? "write" : "dry_run"} queries_enabled=${report.summary.queries_enabled} jobs_found=${jobsFoundTotal} jobs_normalized=${jobsNormalizedTotal} jobs_added_to_pending=${jobsAddedToPendingTotal} source_candidates_found=${sourceCandidatesFoundTotal} source_candidates_added=${sourceCandidatesAddedTotal} aggregators_skipped=${aggregatorsSkippedTotal} climate_change_jobs_skipped=${climateChangeJobsSkippedTotal} duplicates_skipped=${duplicatesSkippedTotal} fetch_failed=${report.summary.fetch_failed} missing_env_var_queries=${report.summary.missing_env_var_queries} meaningful_error_count=${meaningfulErrorCount} duration_ms=${Date.now() - startedAt}`
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
  fetchQueryResults,
  getMissingEnvForProvider,
  loadSearchConfigFromFile,
  main,
  parseArgs,
  shouldRouteResultToSourceDiscovery
};
