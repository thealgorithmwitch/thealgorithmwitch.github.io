const ATS_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "bamboohr",
  "smartrecruiters",
  "jazzhr",
  "breezyhr",
  "paylocity",
  "ukg",
  "icims",
  "jobvite",
  "rippling",
  "recruitee",
  "teamtailor",
  "pinpoint",
  "workday",
  "adp",
  "comeet"
];

const DIRECT_PROVIDER_TYPES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "bamboohr",
  "recruitee",
  "smartrecruiters",
  "workable"
]);

const DEFAULT_CRAWL_DEPTH = 1;
const DEFAULT_QUALITY_MODE = "pending";
const SOURCE_CLASSIFICATIONS = {
  TRUSTED_ATS_AUTO_SYNC: "trusted_ats_auto_sync",
  TRUSTED_NONPROFIT_PENDING_REVIEW: "trusted_nonprofit_pending_review",
  MANUAL_REVIEW_COMMUNITY: "manual_review_community",
  MANUAL_EDITORIAL_SOURCE: "manual_editorial_source",
  TRACKED_MANUAL_ORG: "tracked_manual_org",
  COMMUNITY_SUBMISSION_SOURCE: "community_submission_source",
  LOW_CONFIDENCE_EXPERIMENTAL: "low_confidence_experimental"
};

const MANUAL_COMMUNITY_ORGANIZATIONS = [
  "Sunrise Movement", "Climate Justice Alliance", "Hip Hop Caucus",
  "Movement Generation", "Partnership for Public Good", "APEN",
  "WE ACT", "Bullard Center", "Indigenous Environmental Network",
  "Louisiana Bucket Brigade", "Youth Vs. Apocalypse"
];

function normalizeProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  return ATS_PROVIDERS.includes(normalized) ? normalized : normalized;
}

function inferProviderFromType(type) {
  const normalized = normalizeProvider(type);
  return ATS_PROVIDERS.includes(normalized) ? normalized : "";
}

function normalizeSourceType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "custom_careers_page") return "custom";
  if (DIRECT_PROVIDER_TYPES.has(normalized)) return "ats";
  if (normalized === "ats" || normalized === "custom" || normalized === "generic") return normalized;
  return normalized || "generic";
}

function detectAtsProvider(source = {}) {
  const explicit = normalizeProvider(source.provider || inferProviderFromType(source.type));
  if (explicit) return explicit;
  const url = String(source.url || source.source_url || "").toLowerCase();
  for (const provider of ATS_PROVIDERS) {
    if (url.includes(provider)) return provider;
  }
  return "";
}

function detectParserType(source = {}) {
  const explicit = String(source.parser || "").trim().toLowerCase();
  if (explicit) return explicit;
  const type = normalizeSourceType(source.type);
  const provider = detectAtsProvider(source);
  if (type === "ats" && provider) return `ats:${provider}`;
  if (provider && DIRECT_PROVIDER_TYPES.has(provider)) return `ats:${provider}`;
  if (type === "custom") return "custom-careers-page";
  if (type === "generic") return "generic-careers-page";
  return type || "unknown";
}

function isManualCommunityOrg(orgName) {
  if (!orgName) return false;
  const normalized = String(orgName || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return MANUAL_COMMUNITY_ORGANIZATIONS.some((name) => normalized === name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || normalized.includes(name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
}

function inferSourceClassification(source = {}) {
  const explicit = String(source.source_classification || source.sourceClassification || "").trim();
  if (explicit) return explicit;
  const type = normalizeSourceType(source.type);
  const provider = detectAtsProvider(source);
  const trusted = source.trusted === true;
  const autoPublish = source.auto_publish === true;
  const parserEnabled = source.parser_enabled !== false;
  const enabled = source.enabled !== false;
  const org = String(source.organization || source.name || source.id || "").trim();
  const isCommunitySubmission = source.community_submission === true;
  const isManualOrg = isManualCommunityOrg(org) || source.manual_review_required === true;

  if (isManualOrg || isCommunitySubmission) {
    return isCommunitySubmission
      ? SOURCE_CLASSIFICATIONS.COMMUNITY_SUBMISSION_SOURCE
      : SOURCE_CLASSIFICATIONS.TRACKED_MANUAL_ORG;
  }

  if (enabled && trusted && autoPublish && type === "ats" && isDirectAtsProvider(provider)) {
    return SOURCE_CLASSIFICATIONS.TRUSTED_ATS_AUTO_SYNC;
  }
  if (enabled && parserEnabled && (trusted || type === "ats" || type === "custom")) {
    return SOURCE_CLASSIFICATIONS.TRUSTED_NONPROFIT_PENDING_REVIEW;
  }
  if (enabled && parserEnabled && (type === "custom" || type === "generic")) {
    return SOURCE_CLASSIFICATIONS.MANUAL_REVIEW_COMMUNITY;
  }
  return SOURCE_CLASSIFICATIONS.LOW_CONFIDENCE_EXPERIMENTAL;
}

function inferSourceConfidenceTier(source = {}) {
  const explicit = String(source.source_confidence_tier || source.sourceConfidenceTier || source.source_confidence || "").trim().toLowerCase();
  if (explicit) return explicit;
  const classification = inferSourceClassification(source);
  if (classification === SOURCE_CLASSIFICATIONS.TRUSTED_ATS_AUTO_SYNC) return "high";
  if (classification === SOURCE_CLASSIFICATIONS.TRUSTED_NONPROFIT_PENDING_REVIEW) return "medium";
  if (classification === SOURCE_CLASSIFICATIONS.MANUAL_REVIEW_COMMUNITY) return "medium";
  return "low";
}

function normalizeSource(source = {}) {
  const provider = detectAtsProvider(source);
  const url = String(source.url || source.source_url || "").trim();
  const type = normalizeSourceType(source.type);
  const org = String(source.organization || source.name || source.id || "").trim();
  const isManualCommunity = isManualCommunityOrg(org);
  const isCommunity = source.community_submission === true;
  const isManualReview = source.manual_review_required === true;
  const isSyncDisabled = isManualCommunity || isCommunity;
  const isManualType = isManualCommunity || isManualReview;
  const normalized = {
    ...source,
    name: org,
    organization: org,
    url,
    source_url: url,
    type,
    provider,
    enabled: source.enabled !== false,
    sync_enabled: isSyncDisabled ? false : source.sync_enabled !== false,
    custom_sync_enabled: source.custom_sync_enabled !== false,
    manual_review_required: isManualReview || isManualCommunity,
    temporarily_disabled: source.temporarily_disabled === true,
    requires_browser: Boolean(source.requires_browser),
    manual_editorial_source: isManualType,
    tracked_manual_org: isManualType,
    community_submission_source: isCommunity,
    lowered_fetch_failure_penalty: isManualType || isCommunity,
    manual_freshness_tracking: isManualType || isCommunity,
    editorial_reminder_path: isManualType || isCommunity ? "manual_editorial" : "",
    crawl_depth: Number.isInteger(Number(source.crawl_depth))
      ? Math.max(0, Number(source.crawl_depth))
      : DEFAULT_CRAWL_DEPTH,
    quality_mode: String(source.quality_mode || DEFAULT_QUALITY_MODE).trim().toLowerCase() || DEFAULT_QUALITY_MODE
  };

  return {
    ...normalized,
    ats_provider: provider,
    parser_type: isManualCommunity || isCommunity ? "manual_editorial" : detectParserType(normalized),
    source_classification: inferSourceClassification(normalized),
    source_confidence_tier: inferSourceConfidenceTier(normalized)
  };
}

function isDirectAtsProvider(provider) {
  return DIRECT_PROVIDER_TYPES.has(normalizeProvider(provider));
}

function isDirectAtsSource(source) {
  const normalized = normalizeSource(source);
  if (normalized.sync_enabled === false) return false;
  return normalized.type === "ats" && isDirectAtsProvider(normalized.provider);
}

function shouldUseDiscoverySync(source) {
  const normalized = normalizeSource(source);
  if (!normalized.enabled) return false;
  if (normalized.custom_sync_enabled === false) return false;
  if (normalized.type === "ats" && isDirectAtsProvider(normalized.provider)) return false;
  return true;
}

module.exports = {
  ATS_PROVIDERS,
  DEFAULT_CRAWL_DEPTH,
  DEFAULT_QUALITY_MODE,
  SOURCE_CLASSIFICATIONS,
  MANUAL_COMMUNITY_ORGANIZATIONS,
  detectAtsProvider,
  detectParserType,
  inferProviderFromType,
  inferSourceClassification,
  inferSourceConfidenceTier,
  isDirectAtsProvider,
  isDirectAtsSource,
  isManualCommunityOrg,
  normalizeProvider,
  normalizeSource,
  shouldUseDiscoverySync
};
