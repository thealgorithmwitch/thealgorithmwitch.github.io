const { slugify } = require("./job-utils");

const PROVIDER_DETECTORS = [
  { provider: "greenhouse", pattern: /boards?-api\.greenhouse\.io|job-boards?(?:\.eu)?\.greenhouse\.io|greenhouse\.io/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 98, type: "ats", automationSupported: true },
  { provider: "lever", pattern: /jobs\.lever\.co|api\.lever\.co\/v0\/postings/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "smartrecruiters", pattern: /smartrecruiters\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "teamtailor", pattern: /jobs\.teamtailor\.com|teamtailor\.com\/jobs/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false },
  { provider: "pinpoint", pattern: /pinpointhq\.com|app\.beapplied\.com/i, syncPath: "adapter-required", confidence: 94, type: "ats", automationSupported: false },
  { provider: "workable", pattern: /apply\.workable\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "bamboohr", pattern: /\.bamboohr\.com\/careers/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "recruitee", pattern: /\.recruitee\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "paylocity", pattern: /recruiting\.paylocity\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 95, type: "ats", automationSupported: true },
  { provider: "workday", pattern: /\.myworkdayjobs\.com/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false },
  { provider: "rippling", pattern: /ats\.rippling\.com|rippling-ats\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 95, type: "ats", automationSupported: true }
];

const UNSUPPORTED_PROVIDER_PATTERNS = [
  { provider: "icims", pattern: /icims\.com/i },
  { provider: "jobvite", pattern: /jobs\.jobvite\.com/i }
];

const STRUCTURED_ADAPTER_GAP_PROVIDERS = new Set(["workday", "teamtailor", "pinpoint"]);

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)climatechangejobs\.com$/i,
  /(^|\.)jobs\.workable\.com$/i,
  /(^|\.)greenjobsearch\.org$/i,
  /(^|\.)indeed\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)ziprecruiter\.com$/i,
  /(^|\.)glassdoor\.com$/i,
  /(^|\.)simplyhired\.com$/i,
  /(^|\.)monster\.com$/i,
  /(^|\.)idealist\.org$/i,
  /(^|\.)goodcitizen\.com$/i
];

const BLOCKED_SOURCE_URL_PATTERNS = [
  { source_id: "articulate", pattern: /^https?:\/\/jobs\.lever\.co\/articulate(?:\/|$)/i },
  { source_id: "empowerly", pattern: /^https?:\/\/jobs\.lever\.co\/empowerly(?:\/|$)/i },
  { source_id: "remofirst", pattern: /^https?:\/\/jobs\.lever\.co\/remofirst(?:\/|$)/i },
  { source_id: "recidiviz", pattern: /^https?:\/\/job-boards\.greenhouse\.io\/recidiviz(?:\/|$)/i },
  { source_id: "cribl", pattern: /^https?:\/\/job-boards\.greenhouse\.io\/cribl(?:\/|$)/i },
  { source_id: "found", pattern: /^https?:\/\/job-boards\.greenhouse\.io\/found(?:\/|$)/i },
  { source_id: "canonical", pattern: /^https?:\/\/job-boards\.greenhouse\.io\/canonicaljobs(?:\/|$)/i },
  { source_id: "cohere", pattern: /^https?:\/\/jobs\.ashbyhq\.com\/cohere(?:\/|$)/i },
  { source_id: "chilipiper", pattern: /^https?:\/\/jobs\.ashbyhq\.com\/chilipiper(?:\/|$)/i },
  { source_id: "beehiiv", pattern: /^https?:\/\/beehiiv\.bamboohr\.com\/careers(?:\/|$)/i },
  { source_id: "posthog", pattern: /^https?:\/\/posthog\.com\/careers(?:\/|$)/i },
  { source_id: "automattic", pattern: /^https?:\/\/automattic\.com\/work-with-us\/job\/?(?:$|[?#])/i },
  { source_id: "superside", pattern: /^https?:\/\/careers\.superside\.com\/jobs(?:\/|$)/i },
  { source_id: "samsara", pattern: /^https?:\/\/www\.samsara\.com\/company\/careers(?:\/|$)/i },
  { source_id: "gusto", pattern: /^https?:\/\/jobs\.gusto\.com\/?(?:$|[?#])/i }
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringify(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
  return stringify(value);
}

function normalizeHostname(value) {
  try {
    return new URL(normalizeUrl(value)).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function readCandidatePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.candidates)) return payload.candidates;
  return [];
}

function isBlockedAggregatorUrl(value) {
  const hostname = normalizeHostname(value);
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function getBlockedSourcePattern(value) {
  const url = normalizeUrl(value);
  if (!url) return null;
  return BLOCKED_SOURCE_URL_PATTERNS.find((entry) => entry.pattern.test(url)) || null;
}

function isBlockedSourceUrl(value) {
  return Boolean(getBlockedSourcePattern(value));
}

function isClimateChangeJobsUrl(value) {
  return /(^|\.)climatechangejobs\.com$/i.test(normalizeHostname(value));
}

function canonicalizeSourceUrl(provider, value) {
  const raw = normalizeUrl(value);
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return raw;
  }

  url.hash = "";
  url.search = "";

  if (provider === "greenhouse") {
    const match = url.pathname.match(/^\/([^/]+)(?:\/jobs(?:\/[^/]+)?)?\/?$/i);
    if (match) {
      url.pathname = `/${match[1]}`;
    }
  } else if (provider === "lever") {
    const match = url.pathname.match(/^\/([^/]+)/);
    if (match) {
      url.pathname = `/${match[1]}`;
    }
  } else if (provider === "ashby") {
    const match = url.pathname.match(/^\/([^/]+)/);
    if (match) {
      url.pathname = `/${match[1]}`;
    }
  } else if (provider === "smartrecruiters") {
    const companyMatch = url.pathname.match(/^\/company\/([^/]+)/i);
    if (companyMatch) {
      url.pathname = `/company/${companyMatch[1]}`;
    } else {
      const firstPath = url.pathname.match(/^\/([^/]+)/);
      if (firstPath) {
        url.pathname = `/${firstPath[1]}`;
      }
    }
  } else if (provider === "workable") {
    const match = url.pathname.match(/^\/([^/]+)/);
    if (match) {
      url.pathname = `/${match[1]}`;
    }
  } else if (provider === "recruitee") {
    url.pathname = "/";
  } else if (provider === "paylocity") {
    if (/^\/recruiting\/jobs\/all\//i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    } else {
      return "";
    }
  } else if (provider === "bamboohr") {
    url.pathname = "/careers";
  } else if (!provider) {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }

  return url.toString().replace(/\/$/, provider ? "" : "/");
}

function detectProviderFromUrls(urls) {
  for (const rawUrl of toArray(urls)) {
    const url = normalizeUrl(rawUrl);
    if (!url || isBlockedAggregatorUrl(url) || isBlockedSourceUrl(url)) continue;

    for (const detector of PROVIDER_DETECTORS) {
      if (detector.pattern.test(url)) {
        const canonicalUrl = canonicalizeSourceUrl(detector.provider, url);
        if (!canonicalUrl) {
          return {
            detected_provider: detector.provider,
            detected_job_url: url,
            confidence_score: detector.confidence,
            provider_supported: detector.automationSupported !== false,
            recommended_sync_path: detector.syncPath,
            source_type: detector.type,
            skip_reason: "provider_detail_page_not_source_root"
          };
        }
        return {
          detected_provider: detector.provider,
          detected_job_url: canonicalUrl,
          confidence_score: detector.confidence,
          provider_supported: detector.automationSupported !== false,
          recommended_sync_path: detector.syncPath,
          source_type: detector.type
        };
      }
    }

    for (const detector of UNSUPPORTED_PROVIDER_PATTERNS) {
      if (detector.pattern.test(url)) {
        return {
          detected_provider: detector.provider,
          detected_job_url: url,
          confidence_score: 70,
          provider_supported: false,
          recommended_sync_path: "manual_review_only",
          source_type: "unsupported"
        };
      }
    }

    if (looksLikeEmployerCareerPage(url)) {
      return {
        detected_provider: "",
        detected_job_url: canonicalizeSourceUrl("", url),
        confidence_score: 75,
        provider_supported: true,
        recommended_sync_path: "jobs:discover-sources-manual-sync",
        source_type: "direct_career_page"
      };
    }
  }
  return null;
}

function looksLikeEmployerCareerPage(value) {
  const url = normalizeUrl(value);
  if (!url || isBlockedAggregatorUrl(url) || isBlockedSourceUrl(url)) return false;
  if (PROVIDER_DETECTORS.some((detector) => detector.pattern.test(url))) return false;
  const hostname = normalizeHostname(url);
  if (!hostname || hostname === "localhost") return false;
  return /\/(careers?|jobs?|employment|join-us|joinourteam|work-with-us|opportunities)(\/|$)/i.test(url);
}

function findExistingSource(existingSources, candidate) {
  const organization = stringify(candidate.organization || candidate.name).toLowerCase();
  const candidateUrls = new Set(
    toArray(candidate.candidate_urls)
      .concat(candidate.known_careers_url ? [candidate.known_careers_url] : [])
      .concat(candidate.url ? [candidate.url] : [])
      .concat(candidate.homepage ? [candidate.homepage] : [])
      .map((url) => normalizeUrl(url))
      .filter(Boolean)
  );
  return toArray(existingSources).find((source) => {
    const sourceOrg = stringify(source.organization || source.name).toLowerCase();
    const sourceUrl = normalizeUrl(source.source_url || source.url || "");
    return sourceOrg === organization || candidateUrls.has(sourceUrl);
  }) || null;
}

function deriveProviderMetadata(provider, url) {
  const value = normalizeUrl(url);
  if (provider === "greenhouse") {
    const match = value.match(/boards?(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([^/?#"'&<>\s]+)/i);
    return { board_token: match ? match[1] : "" };
  }
  if (provider === "lever") {
    const match = value.match(/(?:jobs\.lever\.co|api\.lever\.co\/v0\/postings)\/([^/?#"'&<>\s]+)/i);
    return { company_slug: match ? match[1] : "" };
  }
  if (provider === "ashby") {
    const match = value.match(/jobs\.ashbyhq\.com\/([^/?#"'&<>\s]+)/i);
    return { organization_slug: match ? match[1] : "" };
  }
  if (provider === "smartrecruiters") {
    const match = value.match(/smartrecruiters\.com\/(?:company\/)?([^/?#"'&<>\s]+)/i);
    return { company_slug: match ? match[1] : "" };
  }
  if (provider === "workable") {
    const match = value.match(/apply\.workable\.com\/([^/?#"'&<>\s]+)/i);
    return { company_slug: match ? match[1] : "" };
  }
  if (provider === "bamboohr") {
    const match = value.match(/https?:\/\/([^./]+)\.bamboohr\.com/i);
    return { company_slug: match ? match[1] : "" };
  }
  if (provider === "recruitee") {
    const match = value.match(/https?:\/\/([^./]+)\.recruitee\.com/i);
    return { company_slug: match ? match[1] : "" };
  }
  return {};
}

function inferOrganizationFromTitle(title, url) {
  const cleanedTitle = stringify(title)
    .replace(/\s*[|:-]\s*(careers?|jobs?|job opportunities|open positions).*$/i, "")
    .replace(/\b(careers?|jobs?|job opportunities|open positions)\b.*$/i, "")
    .trim();
  if (cleanedTitle) return cleanedTitle;

  const hostname = normalizeHostname(url);
  if (!hostname) return "Unknown organization";
  const firstLabel = hostname.split(".")[0];
  return firstLabel
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildSourceCandidate({
  organization,
  sourceName,
  url,
  provider,
  missionTags,
  discoveryQuery,
  notes,
  category,
  title,
  homepage,
  candidateUrls,
  knownCareersUrl,
  discoveryProvider,
  sourceScores
}) {
  const normalizedUrl = normalizeUrl(url);
  const detectedProvider = stringify(provider);
  const resolvedOrganization = stringify(organization) || inferOrganizationFromTitle(title, normalizedUrl);
  const normalizedHomepage = normalizeUrl(homepage);
  const normalizedKnownCareersUrl = normalizeUrl(knownCareersUrl);
  const normalizedCandidateUrls = toArray(candidateUrls)
    .concat(normalizedHomepage ? [normalizedHomepage] : [])
    .concat(normalizedKnownCareersUrl ? [normalizedKnownCareersUrl] : [])
    .concat(normalizedUrl ? [normalizedUrl] : [])
    .map((value) => normalizeUrl(value))
    .filter(Boolean);
  return {
    organization: resolvedOrganization,
    source_name: stringify(sourceName) || resolvedOrganization,
    url: normalizedUrl,
    homepage: normalizedHomepage,
    known_careers_url: normalizedKnownCareersUrl || normalizedUrl,
    candidate_urls: normalizedCandidateUrls,
    provider: detectedProvider,
    mission_tags: toArray(missionTags).filter(Boolean),
    pending_only: true,
    enabled: true,
    discovery_query: stringify(discoveryQuery),
    notes: stringify(notes),
    category: stringify(category || "Mission-aligned"),
    discovery_provider: stringify(discoveryProvider),
    source_scores: sourceScores && typeof sourceScores === "object" ? sourceScores : undefined
  };
}

function mergeCandidates(existingCandidates, newCandidates) {
  const existing = [];
  const seen = new Set();
  for (const candidate of toArray(existingCandidates).concat(toArray(newCandidates))) {
    const url = normalizeUrl(candidate.url || candidate.known_careers_url || toArray(candidate.candidate_urls)[0]);
    const organization = stringify(candidate.organization || candidate.source_name || candidate.name).toLowerCase();
    const key = `${organization}::${url.toLowerCase()}`;
    if (!organization && !url) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(candidate);
  }
  return existing;
}

function extractSourceCandidateFromSearchResult(queryConfig, provider, result) {
  const rawUrl = normalizeUrl(
    result.link ||
    result.url ||
    result.absolute_url ||
    result.hostedUrl ||
    result.job_link ||
    result.apply_link ||
    result.careers_url
  );
  if (!rawUrl) {
    return { candidate: null, skip_reason: "search_result_missing_url" };
  }
  if (isClimateChangeJobsUrl(rawUrl)) {
    return { candidate: null, skip_reason: "climate_change_jobs_skipped", climate_change_jobs_skipped: 1 };
  }
  if (isBlockedAggregatorUrl(rawUrl)) {
    return { candidate: null, skip_reason: "aggregator_skipped", aggregators_skipped: 1 };
  }
  if (isBlockedSourceUrl(rawUrl)) {
    return {
      candidate: null,
      skip_reason: "blocked_source_removed",
      blocked_source_id: getBlockedSourcePattern(rawUrl)?.source_id || ""
    };
  }

  const detection = detectProviderFromUrls([rawUrl]);
  if (!detection || detection.skip_reason) {
    return { candidate: null, skip_reason: detection?.skip_reason || "not_source_candidate" };
  }

  const title = stringify(result.title || result.job_title || result.text || "");
  const organization =
    stringify(result.organization || result.companyName || result.company_name) ||
    inferOrganizationFromTitle(title, detection.detected_job_url);

  const notes = detection.source_type === "direct_career_page"
    ? `Direct employer career page discovered from search query "${queryConfig.query}".`
    : `Structured ${detection.detected_provider} source discovered from search query "${queryConfig.query}".`;

  return {
    candidate: buildSourceCandidate({
      organization,
      sourceName: organization,
      url: detection.detected_job_url,
      provider: detection.detected_provider,
      missionTags: toArray(queryConfig.mission_tags),
      discoveryQuery: stringify(queryConfig.query),
      notes,
      category: stringify(queryConfig.sector || queryConfig.category || "Mission-aligned"),
      title
    }),
    skip_reason: ""
  };
}

function buildSourceRecord(candidate, discovery) {
  const organization = stringify(candidate.organization || candidate.source_name);
  const provider = stringify(discovery.detected_provider || candidate.provider);
  const sourceUrl = normalizeUrl(discovery.detected_job_url || candidate.url || candidate.known_careers_url);
  const highConfidence = Number(discovery.confidence_score || 0) >= 95;
  const adapterGap = discovery.recommended_sync_path === "adapter-required";
  const isDirectCareerPage = discovery.source_type === "direct_career_page" || (!provider && looksLikeEmployerCareerPage(sourceUrl));

  if (isDirectCareerPage) {
    return {
      id: slugify(organization),
      name: organization,
      organization,
      type: "generic",
      provider: "",
      parser_enabled: false,
      enabled: candidate.enabled !== false,
      pending_only: candidate.pending_only !== false,
      custom_sync_enabled: true,
      requires_browser: false,
      crawl_depth: 1,
      quality_mode: "pending",
      trusted: false,
      auto_publish: false,
      url: sourceUrl,
      source_url: sourceUrl,
      api_url: "",
      sector: stringify(candidate.category || "Mission-aligned"),
      function_defaults: [],
      mission_tags: toArray(candidate.mission_tags).filter(Boolean),
      notes: stringify(candidate.notes || "Direct employer career page discovered by automation. Pending-first only; parser discovery or custom sync required before automated job ingestion.")
    };
  }

  return {
    id: slugify(organization),
    name: organization,
    organization,
    type: "ats",
    provider,
    enabled: candidate.enabled !== false,
    pending_only: candidate.pending_only !== false,
    custom_sync_enabled: false,
    requires_browser: false,
    crawl_depth: 1,
    quality_mode: "pending",
    trusted: false,
    auto_publish: false,
    high_confidence_immediate_upload: highConfidence,
    url: sourceUrl,
    source_url: sourceUrl,
    api_url: "",
    sector: stringify(candidate.category || "Mission-aligned"),
    function_defaults: [],
    mission_tags: toArray(candidate.mission_tags).filter(Boolean),
    notes: adapterGap
      ? "Structured ATS source discovered by automation. Pending-first only; onboarding retained but sync stays disabled until the provider adapter is implemented."
      : stringify(candidate.notes || "Structured ATS source discovered by automation. Pending-first only; explicit sync step required later."),
    ...deriveProviderMetadata(provider, sourceUrl)
  };
}

module.exports = {
  BLOCKED_HOST_PATTERNS,
  BLOCKED_SOURCE_URL_PATTERNS,
  PROVIDER_DETECTORS,
  STRUCTURED_ADAPTER_GAP_PROVIDERS,
  UNSUPPORTED_PROVIDER_PATTERNS,
  buildSourceCandidate,
  buildSourceRecord,
  canonicalizeSourceUrl,
  detectProviderFromUrls,
  deriveProviderMetadata,
  extractSourceCandidateFromSearchResult,
  findExistingSource,
  inferOrganizationFromTitle,
  isBlockedAggregatorUrl,
  isBlockedSourceUrl,
  isClimateChangeJobsUrl,
  looksLikeEmployerCareerPage,
  mergeCandidates,
  normalizeUrl,
  readCandidatePayload,
  stringify,
  toArray
};
