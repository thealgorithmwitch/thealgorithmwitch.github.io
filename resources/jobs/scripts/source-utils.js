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
  LOW_CONFIDENCE_EXPERIMENTAL: "low_confidence_experimental"
};

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

function inferSourceClassification(source = {}) {
  const type = normalizeSourceType(source.type);
  const provider = detectAtsProvider(source);
  const trusted = source.trusted === true;
  const autoPublish = source.auto_publish === true;
  const parserEnabled = source.parser_enabled !== false;
  const enabled = source.enabled !== false;

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
  const normalized = {
    ...source,
    name: String(source.name || source.organization || source.id || "").trim(),
    organization: String(source.organization || source.name || source.id || "").trim(),
    url,
    source_url: url,
    type,
    provider,
    enabled: source.enabled !== false,
    custom_sync_enabled: source.custom_sync_enabled !== false,
    requires_browser: Boolean(source.requires_browser),
    crawl_depth: Number.isInteger(Number(source.crawl_depth))
      ? Math.max(0, Number(source.crawl_depth))
      : DEFAULT_CRAWL_DEPTH,
    quality_mode: String(source.quality_mode || DEFAULT_QUALITY_MODE).trim().toLowerCase() || DEFAULT_QUALITY_MODE
  };

  return {
    ...normalized,
    ats_provider: provider,
    parser_type: detectParserType(normalized),
    source_classification: inferSourceClassification(normalized),
    source_confidence_tier: inferSourceConfidenceTier(normalized)
  };
}

function isDirectAtsProvider(provider) {
  return DIRECT_PROVIDER_TYPES.has(normalizeProvider(provider));
}

function isDirectAtsSource(source) {
  const normalized = normalizeSource(source);
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
  detectAtsProvider,
  detectParserType,
  inferProviderFromType,
  inferSourceClassification,
  inferSourceConfidenceTier,
  isDirectAtsProvider,
  isDirectAtsSource,
  normalizeProvider,
  normalizeSource,
  shouldUseDiscoverySync
};
