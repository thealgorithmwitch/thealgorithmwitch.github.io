const fs = require("fs/promises");
const path = require("path");
const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  readJson,
  writeJson
} = require("./job-utils");
const { normalizeJob } = require("./job-normalizer");
const { attachPublicJobPageUrls } = require("./public-jobs");
const { triagePendingJobs } = require("./pending-triage");
const { buildPagesForSelectedJobs } = require("./generate-job-pages");
const { buildValidationReport } = require("./validate-public-data");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");
const { readOrganizationRules, writeOrganizationRules } = require("./admin-actions-store");

const ROOT = path.resolve(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const SEARCH_SOURCES_FILE = path.join(ROOT, "search-sources.json");
const SCRAPE_REPORT_FILE = path.join(ROOT, "scrape-report.json");
const REPORT_JSON = path.join(ROOT, "reports", "targeted-source-cleanup.json");
const REPORT_MD = path.join(ROOT, "reports", "targeted-source-cleanup.md");

const BLOCKED_COMPANIES = [
  "StackBlitz",
  "Teramind",
  "Marcus & Millichap",
  "Dataiku",
  "Spring Health"
];

const BLOCKED_SOURCE_IDS = [
  "stackblitz",
  "teramind",
  "marcus-millichap",
  "dataiku",
  "spring-health",
  "plos"
];

const SOURCE_DISCOVERY_ADDITIONS = [
  {
    id: "aceee",
    name: "ACEEE",
    organization: "ACEEE",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.aceee.org/jobs",
    api_url: "",
    sector: "Clean Energy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "carbon180",
    name: "Carbon180",
    organization: "Carbon180",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://carbon180.org/careers/",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "clean-air-task-force",
    name: "Clean Air Task Force",
    organization: "Clean Air Task Force",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.catf.us/careers/",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "climate-central",
    name: "Climate Central",
    organization: "Climate Central",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.climatecentral.org/what-we-do/jobs",
    api_url: "",
    sector: "Climate Communications",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "global-energy-monitor",
    name: "Global Energy Monitor",
    organization: "Global Energy Monitor",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://globalenergymonitor.org/about/jobs/",
    api_url: "",
    sector: "Research",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "greenpeace-us",
    name: "Greenpeace US",
    organization: "Greenpeace",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.greenpeace.org/usa/jobs/",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "grid-alternatives",
    name: "GRID Alternatives",
    organization: "GRID Alternatives",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://gridalternatives.org/get-involved/careers",
    api_url: "",
    sector: "Clean Energy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "league-of-conservation-voters",
    name: "League of Conservation Voters",
    organization: "League of Conservation Voters",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.lcv.org/careers/",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "environmental-voter-project",
    name: "Environmental Voter Project",
    organization: "Environmental Voter Project",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.environmentalvoter.org/jobs",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "rmi",
    name: "RMI",
    organization: "RMI",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://rmi.org/about/careers/",
    api_url: "",
    sector: "Clean Energy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "union-of-concerned-scientists",
    name: "Union of Concerned Scientists",
    organization: "Union of Concerned Scientists",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.ucs.org/about/jobs",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "we-act-for-environmental-justice",
    name: "WE ACT for Environmental Justice",
    organization: "WE ACT for Environmental Justice",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://weact.org/about/careers/",
    api_url: "",
    sector: "Policy/Advocacy",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "world-resources-institute",
    name: "World Resources Institute",
    organization: "World Resources Institute",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.wri.org/careers?lang=en",
    api_url: "",
    sector: "Research",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  },
  {
    id: "world-wildlife-fund",
    name: "World Wildlife Fund",
    organization: "World Wildlife Fund",
    type: "custom_careers_page",
    custom_sync_enabled: true,
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    quality_mode: "pending",
    source_url: "https://www.worldwildlife.org/about/careers",
    api_url: "",
    sector: "Conservation",
    function_defaults: [],
    notes: "Official careers page added from targeted source discovery. Pending review only."
  }
];

const SOURCE_DISCOVERY_SKIPPED = [
  { organization: "350.org", reason: "already configured in sources.json" },
  { organization: "Ceres", reason: "already configured in sources.json" },
  { organization: "ClimateWorks Foundation", reason: "already configured in sources.json" },
  { organization: "Environmental Defense Fund", reason: "already configured in sources.json" },
  { organization: "Solar United Neighbors", reason: "already configured in sources.json" },
  { organization: "The Nature Conservancy", reason: "already configured in sources.json" },
  { organization: "Appalachian Voices", reason: "official jobs/careers page not resolved to a stable dedicated URL in this pass" },
  { organization: "Citizens' Climate Lobby", reason: "official jobs page link surfaced indirectly but stable standalone jobs URL was not resolved in this pass" },
  { organization: "GreenLatinos", reason: "official careers page appears to contain broken third-party listing content in current results" },
  { organization: "Oceana", reason: "official careers page not resolved confidently in this pass" },
  { organization: "Waterkeeper Alliance", reason: "careers call-to-action appears on get-involved page but standalone official jobs URL was not resolved in this pass" }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlockedCompany(value) {
  const normalized = normalizeText(value).replace(/[’']/g, "'");
  return BLOCKED_COMPANIES.some((company) => normalizeText(company).replace(/[’']/g, "'") === normalized);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined)
  );
}

function toSourcesArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.sources)) return payload.sources;
  return [];
}

function fromSourcesArray(originalPayload, sources) {
  if (Array.isArray(originalPayload)) return sources;
  return {
    ...(originalPayload || {}),
    sources
  };
}

function changedFields(before, after, fields) {
  return fields.filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
}

function mergeWarnings(...warningValues) {
  return Array.from(new Set(
    warningValues
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function isLikelyBadPublicTitle(title) {
  const text = String(title || "").trim();
  if (!text) return false;
  if (/\b(?:Remote|Hybrid|On-site|Onsite)\b$/.test(text)) return true;
  if (/\b(?:pivoting|click here|linkedin|interview)\b/i.test(text)) return true;
  if (/<div|href=|class=|https?:\/\//i.test(text)) return true;
  if (text.split(/\s+/).filter(Boolean).length > 12) return true;
  return false;
}

function hasMalformedPayFragment(job = {}) {
  const text = JSON.stringify({
    salary: job.salary || "",
    raw_salary: job.raw_salary || "",
    pay_parse_warning: job.pay_parse_warning || ""
  });
  return /\b41\s+147\b|salary 000-\$64 000-\$75 000-\$85|\b\d{1,3}\s+\d{3}\b/.test(text);
}

function collectClimateStatsFromReport(report) {
  const source = ensureArray(report?.sources).find((entry) => String(entry.source_id || "") === "climatechangejobs") || null;
  if (!source) {
    return {
      fetched: 0,
      normalized: 0,
      skipped: 0,
      written_to_pending: 0,
      duplicates: 0,
      low_confidence_routed_to_pending: 0,
      skip_reason_counts: {},
      rejected_examples: []
    };
  }
  return {
    fetched: Number(source.jobs_parsed || source.fetched_count || 0),
    normalized: Number(source.review_ready || 0) + Number(source.needs_cleanup || 0) + Number(source.rejected_noise || 0),
    skipped: Number(source.rejected_noise || 0) + Number(source.dropped_by_cap || 0),
    written_to_pending: Number(source.kept || source.retained || 0),
    duplicates: Number(source.duplicates || 0),
    low_confidence_routed_to_pending: Number(source.low_confidence_routed_to_pending || 0),
    skip_reason_counts: source.rejected_reasons || {},
    rejected_examples: source.rejected_examples || []
  };
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Targeted Source Cleanup");
  lines.push("");
  lines.push("## Blocked Companies");
  for (const company of BLOCKED_COMPANIES) {
    lines.push(`- ${company}`);
  }
  lines.push("");
  lines.push("## Removed Or Blocked");
  for (const entry of report.removed_or_blocked_records) {
    lines.push(`- ${entry.scope} | ${entry.organization} | ${entry.title} | ${entry.id}`);
  }
  lines.push("");
  lines.push("## Climate Change Jobs");
  lines.push(`- enabled: ${report.climatechangejobs.enabled}`);
  lines.push(`- custom_sync_enabled: ${report.climatechangejobs.custom_sync_enabled}`);
  lines.push(`- sync_path: ${report.climatechangejobs.sync_path}`);
  lines.push(`- current_scrape_report_reason: ${report.climatechangejobs.current_scrape_report_reason}`);
  lines.push(`- fetched: ${report.climatechangejobs.fetched}`);
  lines.push(`- normalized: ${report.climatechangejobs.normalized}`);
  lines.push(`- skipped: ${report.climatechangejobs.skipped}`);
  lines.push(`- written_to_pending: ${report.climatechangejobs.written_to_pending}`);
  lines.push(`- duplicates: ${report.climatechangejobs.duplicates}`);
  lines.push(`- low_confidence_routed_to_pending: ${report.climatechangejobs.low_confidence_routed_to_pending}`);
  lines.push("");
  lines.push("### Climate Skip Reasons");
  Object.entries(report.climatechangejobs.skip_reason_counts || {}).forEach(([reason, count]) => {
    lines.push(`- ${reason}: ${count}`);
  });
  lines.push("");
  lines.push("### Climate Rejected Examples");
  (report.climatechangejobs.rejected_examples || []).forEach((example) => {
    lines.push(`- ${example.id} | ${example.title} | ${example.organization} | ${example.reason}`);
  });
  lines.push("");
  lines.push("## Pending Title Fixes");
  (report.pending_title_fixes || []).forEach((entry) => {
    lines.push(`- ${entry.id} | ${entry.source_id} | before=${entry.before.title} | after=${entry.after.title} | confidence=${entry.after.title_confidence}`);
  });
  lines.push("");
  lines.push("## Public Title Fixes");
  (report.public_title_fixes || []).forEach((entry) => {
    lines.push(`- ${entry.id} | before=${entry.before.title} | after=${entry.after.title} | page=${entry.after.page_url}`);
  });
  lines.push("");
  lines.push("## Malformed Pay Fixes");
  (report.malformed_pay_fixes || []).forEach((entry) => {
    lines.push(`- ${entry.id} | ${entry.scope} | before=${entry.before.raw_salary || entry.before.salary} | after=${entry.after.raw_salary || entry.after.salary} | warning=${entry.after.pay_parse_warning || ""}`);
  });
  lines.push("");
  lines.push("## Source Candidates");
  lines.push(`- added: ${report.source_candidates.added.length}`);
  lines.push(`- skipped: ${report.source_candidates.skipped.length}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const write = process.argv.includes("--write");
  const [jobs, pending, sourcesPayload, searchSources, scrapeReportPayload, currentSourceHealth, orgRules] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readJson(SOURCES_FILE, { sources: [] }),
    readJson(SEARCH_SOURCES_FILE, { queries: [] }),
    readJson(SCRAPE_REPORT_FILE, []),
    readSourceHealthSnapshot(),
    readOrganizationRules()
  ]);

  const nextJobsRaw = clone(jobs);
  const nextPendingRaw = clone(pending);
  const nextSources = clone(toSourcesArray(sourcesPayload));
  const removedOrBlockedRecords = [];
  const pendingTitleFixes = [];
  const publicTitleFixes = [];
  const malformedPayFixes = [];
  const publicIdsNeedingPages = new Set();

  const filteredPending = [];
  for (const job of nextPendingRaw) {
    if (isBlockedCompany(job.organization) || BLOCKED_SOURCE_IDS.includes(String(job.source_id || ""))) {
      removedOrBlockedRecords.push({
        scope: "pending",
        id: job.id,
        title: job.title,
        organization: job.organization
      });
      continue;
    }
    const normalized = normalizeJob(job);
    if (!normalized) continue;
    const merged = { ...job };
    const isClimateChangeJobs = String(job.source_id || "") === "climatechangejobs";
    const titleTargeted =
      normalized.title !== job.title ||
      normalized.location !== job.location ||
      normalized.workplace_type !== job.workplace_type ||
      String(normalized.title_confidence || "").toLowerCase() === "low" ||
      /title_/i.test(String(normalized.parse_warning || ""));
    const payTargeted = hasMalformedPayFragment(job) || Boolean(normalized.pay_parse_warning);
    if (isClimateChangeJobs || titleTargeted) {
      merged.title = normalized.title || job.title;
      merged.organization = normalized.organization || job.organization;
      merged.location = normalized.location || job.location;
      merged.workplace_type = normalized.workplace_type || job.workplace_type;
      merged.apply_url = normalized.apply_url || job.apply_url;
      merged.original_url = normalized.original_url || job.original_url || merged.apply_url;
      merged.parse_warning = isClimateChangeJobs
        ? String(normalized.parse_warning || job.parse_warning || "").trim()
        : mergeWarnings(job.parse_warning, normalized.parse_warning).join("; ");
      merged.title_confidence = normalized.title_confidence || job.title_confidence || "";
    }
    if (payTargeted) {
      merged.salary = normalized.salary || "";
      merged.pay_parse_warning = normalized.pay_parse_warning || job.pay_parse_warning || "malformed_salary_fragment";
      merged.raw_salary = job.raw_salary || normalized.raw_salary || "";
    }
    const changed = changedFields(job, merged, [
      "title",
      "organization",
      "location",
      "workplace_type",
      "apply_url",
      "original_url",
      "parse_warning",
      "title_confidence",
      "salary",
      "raw_salary",
      "pay_parse_warning"
    ]);
    if (changed.length) {
      if (changed.includes("title") || changed.includes("title_confidence") || changed.includes("parse_warning")) {
        pendingTitleFixes.push({
          id: job.id,
          source_id: job.source_id,
          before: { title: job.title, title_confidence: job.title_confidence || "", parse_warning: job.parse_warning || "" },
          after: { title: merged.title, title_confidence: merged.title_confidence || "", parse_warning: merged.parse_warning || "" }
        });
      }
      if (changed.includes("salary") || changed.includes("raw_salary") || changed.includes("pay_parse_warning")) {
        malformedPayFixes.push({
          id: job.id,
          scope: "pending",
          before: { salary: job.salary || "", raw_salary: job.raw_salary || "" },
          after: { salary: merged.salary || "", raw_salary: merged.raw_salary || "", pay_parse_warning: merged.pay_parse_warning || "" }
        });
      }
    }
    filteredPending.push(merged);
  }

  const filteredPublic = [];
  for (const job of nextJobsRaw) {
    if (isBlockedCompany(job.organization) || BLOCKED_SOURCE_IDS.includes(String(job.source_id || ""))) {
      removedOrBlockedRecords.push({
        scope: "public",
        id: job.id,
        title: job.title,
        organization: job.organization
      });
      continue;
    }
    const normalized = normalizeJob(job);
    if (!normalized) {
      filteredPublic.push(job);
      continue;
    }
    let nextJob = { ...job };
    const oldPageUrl = String(job.page_url || "").trim();
    const shouldFixTitle = normalized.title && normalized.title !== job.title;
    const shouldFixPay = hasMalformedPayFragment(job) || Boolean(normalized.pay_parse_warning) || Boolean(job.pay_parse_warning);
    if (shouldFixTitle || isLikelyBadPublicTitle(job.title)) {
      nextJob.title = normalized.title || job.title;
      nextJob.location = normalized.location || job.location;
      nextJob.workplace_type = normalized.workplace_type || job.workplace_type;
      nextJob.title_confidence = normalized.title_confidence || nextJob.title_confidence || "";
      nextJob.parse_warning = mergeWarnings(job.parse_warning, normalized.parse_warning).join("; ");
    }
    if (shouldFixPay) {
      nextJob.salary = normalized.salary || "";
      nextJob.raw_salary = job.raw_salary || normalized.raw_salary || "";
      nextJob.salary_min = normalized.salary_min;
      nextJob.salary_max = normalized.salary_max;
      nextJob.salary_currency = normalized.salary_currency || job.salary_currency || "";
      nextJob.salary_period = normalized.salary_period || job.salary_period || "";
      nextJob.salary_visible = normalized.salary_visible === true;
      nextJob.pay_parse_warning = normalized.pay_parse_warning || job.pay_parse_warning || "malformed_salary_fragment";
      malformedPayFixes.push({
        id: job.id,
        scope: "public",
        before: { salary: job.salary || "", raw_salary: job.raw_salary || "" },
        after: { salary: nextJob.salary || "", raw_salary: nextJob.raw_salary || "", pay_parse_warning: nextJob.pay_parse_warning || "" }
      });
    }
    filteredPublic.push(nextJob);
    if (shouldFixTitle) {
      publicTitleFixes.push({
        id: job.id,
        before: { title: job.title, page_url: oldPageUrl },
        after: { title: nextJob.title }
      });
    }
  }

  const publicWithPageUrls = attachPublicJobPageUrls(filteredPublic).map((job) => {
    const previous = filteredPublic.find((item) => String(item.id || "") === String(job.id || "")) || {};
    const previousPageUrl = String(previous.page_url || "").trim();
    const nextPageUrl = String(job.page_url || "").trim();
    const redirectPaths = new Set(ensureArray(previous.redirect_paths).map((item) => String(item || "").trim()).filter(Boolean));
    if (previousPageUrl && nextPageUrl && previousPageUrl !== nextPageUrl) {
      redirectPaths.add(previousPageUrl);
      publicIdsNeedingPages.add(String(job.id || ""));
      const publicFix = publicTitleFixes.find((entry) => String(entry.id || "") === String(job.id || ""));
      if (publicFix) publicFix.after.page_url = nextPageUrl;
    }
    return {
      ...job,
      redirect_paths: Array.from(redirectPaths).filter((item) => item && item !== nextPageUrl)
    };
  });

  const scrapeReport = Array.isArray(scrapeReportPayload)
    ? { sources: clone(scrapeReportPayload) }
    : { sources: clone(scrapeReportPayload.sources || []) };
  const triaged = await triagePendingJobs(filteredPending, publicWithPageUrls, scrapeReport);
  const nextPending = triaged.adminPendingJobs;

  const climateSource = nextSources.find((source) => String(source.id || "") === "climatechangejobs") || {};
  const climateStats = collectClimateStatsFromReport(triaged.report);
  const scrapeReportClimate = ensureArray(scrapeReport.sources).find((entry) => String(entry.source_id || "") === "climatechangejobs") || {};
  const sourceHealthEntry = {
    source_id: "climatechangejobs",
    source_checked: true,
    jobs_found: climateStats.fetched,
    jobs_normalized: climateStats.normalized,
    jobs_skipped: climateStats.skipped,
    skip_reasons: Object.keys(climateStats.skip_reason_counts || {}),
    pending_count_delta: climateStats.written_to_pending,
    public_count_delta: 0,
    duplicates: climateStats.duplicates,
    low_confidence_routed_to_pending: climateStats.low_confidence_routed_to_pending,
    skip_reason_counts: climateStats.skip_reason_counts || {},
    last_successful_sync: String(scrapeReportClimate.generated_at || ""),
    sync_duration_ms: 0,
    failure_error_count: /fetch failed/i.test(String(scrapeReportClimate.reason_for_zero_results || "")) ? 1 : 0
  };

  const nextSourceHealth = {
    generated_at: new Date().toISOString(),
    sync_type: "targeted-source-cleanup",
    sources: [
      ...ensureArray(currentSourceHealth.sources).filter((entry) => String(entry.source_id || "") !== "climatechangejobs"),
      sourceHealthEntry
    ]
  };

  const nextOrgRules = {
    hidden_organizations: ensureArray(orgRules.hidden_organizations),
    rejected_organizations: Array.from(new Set([...ensureArray(orgRules.rejected_organizations), ...BLOCKED_COMPANIES])).sort()
  };

  for (const source of nextSources) {
    if (!BLOCKED_SOURCE_IDS.includes(String(source.id || ""))) continue;
    source.enabled = false;
    source.custom_sync_enabled = false;
    source.notes = `${String(source.notes || "").trim()} Blocked from targeted ingestion cleanup.`.trim();
  }

  const existingSourceIds = new Set(nextSources.map((source) => String(source.id || "")));
  const addedCandidates = [];
  for (const candidate of SOURCE_DISCOVERY_ADDITIONS) {
    if (existingSourceIds.has(candidate.id)) continue;
    nextSources.push(candidate);
    addedCandidates.push(candidate);
  }

  const validation = await buildValidationReport({ requirePages: false });
  const report = {
    mode: write ? "write" : "dry-run",
    removed_or_blocked_records: removedOrBlockedRecords,
    blocked_companies: BLOCKED_COMPANIES,
    blocked_source_ids: BLOCKED_SOURCE_IDS,
    pending_title_fixes: pendingTitleFixes,
    public_title_fixes: publicTitleFixes,
    malformed_pay_fixes: malformedPayFixes,
    climatechangejobs: {
      enabled: climateSource.enabled !== false,
      custom_sync_enabled: climateSource.custom_sync_enabled !== false,
      sync_path: "sync-custom -> discovery scraper -> normalizeJob -> triagePendingJobs",
      current_scrape_report_reason: String(scrapeReportClimate.reason_for_zero_results || ""),
      fetched: climateStats.fetched,
      normalized: climateStats.normalized,
      skipped: climateStats.skipped,
      written_to_pending: climateStats.written_to_pending,
      duplicates: climateStats.duplicates,
      low_confidence_routed_to_pending: climateStats.low_confidence_routed_to_pending,
      skip_reason_counts: climateStats.skip_reason_counts,
      rejected_examples: climateStats.rejected_examples
    },
    source_candidates: {
      added: addedCandidates.map((candidate) => ({ id: candidate.id, organization: candidate.organization, source_url: candidate.source_url })),
      skipped: []
    },
    validation_before_write: {
      invalid_title_count: validation.invalid_title_count,
      hard_validation_failure_count: validation.hard_validation_failure_count
    }
  };

  await fs.mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(REPORT_MD, buildMarkdownReport(report), "utf8");

  if (!write) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  await writeJson(JOBS_FILE, publicWithPageUrls);
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  await writeJson(SOURCES_FILE, fromSourcesArray(sourcesPayload, nextSources));
  await writeOrganizationRules(nextOrgRules);
  await writeSourceHealthSnapshot(nextSourceHealth);

  if (publicIdsNeedingPages.size) {
    await buildPagesForSelectedJobs(publicWithPageUrls, { selectedIds: Array.from(publicIdsNeedingPages) });
  }

  const validationAfterWrite = await buildValidationReport({ requirePages: true });
  report.validation_after_write = {
    invalid_title_count: validationAfterWrite.invalid_title_count,
    hard_validation_failure_count: validationAfterWrite.hard_validation_failure_count,
    errors: validationAfterWrite.errors
  };
  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(REPORT_MD, buildMarkdownReport(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:targeted-source-cleanup] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
