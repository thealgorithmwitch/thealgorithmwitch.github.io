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

function normalizeSource(source = {}) {
  const provider = normalizeProvider(source.provider || inferProviderFromType(source.type));
  const url = String(source.url || source.source_url || "").trim();

  return {
    ...source,
    name: String(source.name || source.organization || source.id || "").trim(),
    organization: String(source.organization || source.name || source.id || "").trim(),
    url,
    source_url: url,
    type: normalizeSourceType(source.type),
    provider,
    enabled: source.enabled !== false,
    requires_browser: Boolean(source.requires_browser),
    crawl_depth: Number.isInteger(Number(source.crawl_depth))
      ? Math.max(0, Number(source.crawl_depth))
      : DEFAULT_CRAWL_DEPTH,
    quality_mode: String(source.quality_mode || DEFAULT_QUALITY_MODE).trim().toLowerCase() || DEFAULT_QUALITY_MODE
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
  if (normalized.type === "ats" && isDirectAtsProvider(normalized.provider)) return false;
  return true;
}

module.exports = {
  ATS_PROVIDERS,
  DEFAULT_CRAWL_DEPTH,
  DEFAULT_QUALITY_MODE,
  inferProviderFromType,
  isDirectAtsProvider,
  isDirectAtsSource,
  normalizeProvider,
  normalizeSource,
  shouldUseDiscoverySync
};
