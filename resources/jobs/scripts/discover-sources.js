const path = require("path");
const {
  SOURCES_FILE,
  readJson,
  writeJson,
  slugify
} = require("./job-utils");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CANDIDATES_FILE = path.join(ROOT, "source-discovery-candidates.json");
const REPORT_FILE = path.join(ROOT, "reports", "source-discovery-report.json");

const PROVIDER_DETECTORS = [
  { provider: "greenhouse", pattern: /boards?-api\.greenhouse\.io|job-boards?(?:\.eu)?\.greenhouse\.io|greenhouse\.io/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 98, type: "ats", automationSupported: true },
  { provider: "lever", pattern: /jobs\.lever\.co|api\.lever\.co\/v0\/postings/i, syncPath: "jobs:sync-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com/i, syncPath: "jobs:sync-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "smartrecruiters", pattern: /smartrecruiters\.com/i, syncPath: "jobs:sync-targeted-pending-sources", confidence: 97, type: "ats", automationSupported: true },
  { provider: "teamtailor", pattern: /jobs\.teamtailor\.com|teamtailor\.com\/jobs/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false },
  { provider: "pinpoint", pattern: /pinpointhq\.com|app\.beapplied\.com/i, syncPath: "adapter-required", confidence: 94, type: "ats", automationSupported: false },
  { provider: "workable", pattern: /apply\.workable\.com/i, syncPath: "jobs:sync-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "bamboohr", pattern: /\.bamboohr\.com\/careers/i, syncPath: "jobs:sync-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "recruitee", pattern: /\.recruitee\.com/i, syncPath: "jobs:sync-sources", confidence: 96, type: "ats", automationSupported: true },
  { provider: "paylocity", pattern: /recruiting\.paylocity\.com/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false },
  { provider: "workday", pattern: /\.myworkdayjobs\.com/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false },
  { provider: "rippling", pattern: /ats\.rippling\.com|rippling-ats\.com/i, syncPath: "adapter-required", confidence: 95, type: "ats", automationSupported: false }
];

const UNSUPPORTED_PROVIDER_PATTERNS = [
  { provider: "icims", pattern: /icims\.com/i },
  { provider: "jobvite", pattern: /jobs\.jobvite\.com/i }
];

const STRUCTURED_ADAPTER_GAP_PROVIDERS = new Set(["paylocity", "workday", "rippling", "teamtailor", "pinpoint"]);

function parseArgs(argv) {
  const args = { write: false, candidatesFile: DEFAULT_CANDIDATES_FILE };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--candidates-file" && argv[index + 1]) {
      args.candidatesFile = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUrl(value) {
  return String(value || "").trim();
}

function readCandidatePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.candidates)) return payload.candidates;
  return [];
}

function parseTxtCandidates(rawText) {
  return String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((organization) => ({ organization, category: "manual_candidate", candidate_urls: [] }));
}

async function loadCandidates(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".txt") {
    const fs = require("fs/promises");
    const raw = await fs.readFile(filePath, "utf8");
    return parseTxtCandidates(raw);
  }
  const payload = await readJson(filePath, []);
  return readCandidatePayload(payload);
}

function detectProviderFromUrls(urls) {
  for (const rawUrl of toArray(urls)) {
    const url = normalizeUrl(rawUrl);
    if (!url) continue;
    for (const detector of PROVIDER_DETECTORS) {
      if (detector.pattern.test(url)) {
        return {
          detected_provider: detector.provider,
          detected_job_url: url,
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
  }
  return null;
}

function findExistingSource(existingSources, candidate) {
  const organization = String(candidate.organization || "").trim().toLowerCase();
  const candidateUrls = new Set(
    toArray(candidate.candidate_urls)
      .concat(candidate.known_careers_url ? [candidate.known_careers_url] : [])
      .concat(candidate.homepage ? [candidate.homepage] : [])
      .map((url) => normalizeUrl(url))
      .filter(Boolean)
  );
  return existingSources.find((source) => {
    const sourceOrg = String(source.organization || source.name || "").trim().toLowerCase();
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
    const match = value.match(/smartrecruiters\.com\/([^/?#"'&<>\s]+)/i);
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

function buildSourceRecord(candidate, discovery) {
  const organization = String(candidate.organization || "").trim();
  const provider = String(discovery.detected_provider || "").trim();
  const sourceUrl = normalizeUrl(discovery.detected_job_url);
  const syncReadyProvider = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "recruitee"]);
  const highConfidence = Number(discovery.confidence_score || 0) >= 95;
  const adapterGap = discovery.recommended_sync_path === "adapter-required";

  return {
    id: slugify(organization),
    name: organization,
    organization,
    type: "ats",
    provider,
    enabled: true,
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
    sector: String(candidate.category || "Mission-aligned"),
    function_defaults: [],
    notes: adapterGap
      ? "Structured ATS source discovered by automation. Pending-first only; onboarding retained but sync stays disabled until the provider adapter is implemented."
      : syncReadyProvider.has(provider)
        ? "Structured ATS source discovered by automation. Pending-first only; explicit sync step required later."
        : "Structured ATS source discovered by automation. Pending-first only.",
    ...deriveProviderMetadata(provider, sourceUrl)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [sourcesPayload, candidates] = await Promise.all([
    readJson(SOURCES_FILE, { sources: [] }),
    loadCandidates(args.candidatesFile)
  ]);

  const existingSources = Array.isArray(sourcesPayload.sources) ? sourcesPayload.sources : [];
  const nextSources = [...existingSources];
  const results = [];

  for (const candidate of candidates) {
    const organization = String(candidate.organization || "").trim();
    const urls = toArray(candidate.candidate_urls)
      .concat(candidate.known_careers_url ? [candidate.known_careers_url] : [])
      .concat(candidate.homepage ? [candidate.homepage] : [])
      .map((url) => normalizeUrl(url))
      .filter(Boolean);
    const existing = findExistingSource(existingSources, candidate);

    if (existing) {
      const provider = String(existing.provider || existing.type || "").trim();
      const providerConfig = PROVIDER_DETECTORS.find((item) => item.provider === provider);
      const supported = providerConfig ? providerConfig.automationSupported !== false : false;
      const adapterMissing = STRUCTURED_ADAPTER_GAP_PROVIDERS.has(provider);
      results.push({
        organization,
        detected_provider: provider || "",
        detected_job_url: normalizeUrl(existing.source_url || existing.url || urls[0] || ""),
        confidence_score: provider ? 99 : 0,
        provider_supported: supported,
        onboarding_status: "already_configured",
        skip_reason: adapterMissing ? "provider_adapter_missing" : "",
        recommended_sync_path: provider ? (providerConfig?.syncPath || "manual_review_only") : "manual_review_only"
      });
      continue;
    }

    if (!urls.length) {
      results.push({
        organization,
        detected_provider: "",
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
    if (!discovery) {
      results.push({
        organization,
        detected_provider: "",
        detected_job_url: urls[0] || "",
        confidence_score: 25,
        provider_supported: false,
        onboarding_status: "skipped",
        skip_reason: "unstable_custom_html_or_unknown_provider",
        recommended_sync_path: "manual_review_only"
      });
      continue;
    }

    if (!discovery.provider_supported) {
      results.push({
        organization,
        detected_provider: discovery.detected_provider,
        detected_job_url: discovery.detected_job_url,
        confidence_score: discovery.confidence_score,
        provider_supported: false,
        onboarding_status: "skipped",
        skip_reason: STRUCTURED_ADAPTER_GAP_PROVIDERS.has(discovery.detected_provider)
          ? "provider_adapter_missing"
          : "provider_not_in_approved_automation_set",
        recommended_sync_path: discovery.recommended_sync_path
      });
      continue;
    }

    const sourceRecord = buildSourceRecord(candidate, discovery);
    const writeEligible = args.write === true;
    if (writeEligible) {
      nextSources.push(sourceRecord);
    }
    results.push({
      organization,
      detected_provider: discovery.detected_provider,
      detected_job_url: discovery.detected_job_url,
      confidence_score: discovery.confidence_score,
      provider_supported: true,
      onboarding_status: writeEligible ? "appended_to_sources" : "eligible_dry_run",
      skip_reason: "",
      recommended_sync_path: discovery.recommended_sync_path
    });
  }

  if (args.write) {
    await writeJson(SOURCES_FILE, { ...sourcesPayload, sources: nextSources });
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: args.write ? "write" : "dry_run",
    candidates_file: args.candidatesFile,
    summary: {
      candidates_total: results.length,
      appended_to_sources: results.filter((entry) => entry.onboarding_status === "appended_to_sources").length,
      already_configured: results.filter((entry) => entry.onboarding_status === "already_configured").length,
      eligible_dry_run: results.filter((entry) => entry.onboarding_status === "eligible_dry_run").length,
      skipped: results.filter((entry) => entry.onboarding_status === "skipped").length
    },
    results
  };

  await writeJson(REPORT_FILE, report);

  console.log(`[jobs:discover-sources] mode=${args.write ? "write" : "dry_run"} candidates_total=${report.summary.candidates_total} appended_to_sources=${report.summary.appended_to_sources} already_configured=${report.summary.already_configured} eligible_dry_run=${report.summary.eligible_dry_run} skipped=${report.summary.skipped}`);
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
  main
};
