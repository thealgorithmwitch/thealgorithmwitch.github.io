const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { checkBlockedSources } = require("./check-blocked-sources");
const { readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const REPORT_FILE = path.join(REPORTS_DIR, "auto-expand-lifecycle-latest.json");
const DISCOVERY_REPORT_FILE = path.join(REPORTS_DIR, "source-discovery-report.json");
const SEARCH_REPORT_FILE = path.join(REPORTS_DIR, "search-ingest-report.json");
const TARGETED_PENDING_REPORT_FILE = path.join(REPORTS_DIR, "targeted-pending-source-sync.json");
const SOURCE_EXPANSION_VALIDATION_REPORT_FILE = path.join(REPORTS_DIR, "source-expansion-validation-latest.json");
const PUBLIC_PROMOTION_REPORT_FILE = path.join(REPORTS_DIR, "public-promotion-latest.json");

const MANAGED_FILES = [
  "sources.json",
  "search-sources.json",
  "source-discovery-candidates.json",
  "pending-synced-jobs.json",
  "jobs.json",
  "job-records.json",
  "source-health-latest.json",
  "reports/source-discovery-report.json",
  "reports/search-ingest-report.json",
  "reports/targeted-pending-source-sync.json",
  "reports/source-expansion-validation-latest.json",
  "reports/public-promotion-latest.json",
  "reports/auto-expand-lifecycle-latest.json",
  "validation-snapshots/latest.json"
];

function parseArgs(argv) {
  const parsed = {
    dryRun: argv.includes("--dry-run") || !argv.includes("--write"),
    write: argv.includes("--write"),
    autoPublish: argv.includes("--auto-publish"),
    maxAutoPublishPerRun: 10
  };

  argv.forEach((arg, index) => {
    if (arg === "--max-auto-publish-per-run" && argv[index + 1]) {
      parsed.maxAutoPublishPerRun = Number(argv[index + 1]) || 10;
      return;
    }
    if (arg.startsWith("--max-auto-publish-per-run=")) {
      parsed.maxAutoPublishPerRun = Number(arg.split("=").slice(1).join("=")) || 10;
    }
  });

  parsed.maxAutoPublishPerRun = Math.max(0, Math.floor(parsed.maxAutoPublishPerRun || 10));
  return parsed;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

async function snapshotManagedFiles() {
  const snapshot = new Map();
  for (const relativePath of MANAGED_FILES) {
    const filePath = path.join(ROOT, relativePath);
    try {
      const contents = await fs.readFile(filePath);
      snapshot.set(relativePath, crypto.createHash("sha256").update(contents).digest("hex"));
    } catch (_error) {
      snapshot.set(relativePath, "");
    }
  }
  return snapshot;
}

function changedFiles(beforeSnapshot, afterSnapshot) {
  const changed = [];
  for (const relativePath of MANAGED_FILES) {
    if ((beforeSnapshot.get(relativePath) || "") !== (afterSnapshot.get(relativePath) || "")) {
      changed.push(`resources/jobs/${relativePath}`);
    }
  }
  return changed;
}

function runNodeScript(scriptName, args = []) {
  const scriptPath = path.join(ROOT, "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${scriptName} exited with status ${result.status}`);
  }
}

function runNpmScript(scriptName, args = []) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExecutable, ["run", scriptName, "--", ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`npm script ${scriptName} exited with status ${result.status}`);
  }
}

function summarizeSourceEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    organization: entry.organization || "",
    provider: entry.detected_provider || entry.provider || "",
    url: entry.detected_job_url || entry.url || "",
    reason: entry.skip_reason || "",
    status: entry.onboarding_status || ""
  }));
}

function countBlockedEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const descriptor = JSON.stringify(entry || "");
    return /\b(?:articulate|empowerly|remofirst|recidiviz|cribl|found|canonicaljobs|canonical|cohere|chilipiper|beehiiv|posthog|automattic|superside|samsara|gusto|climatechangejobs|climate change jobs)\b/i.test(descriptor);
  }).length;
}

function collectCandidateIds(pendingBefore, pendingAfter, dryRun) {
  if (dryRun) {
    return pendingAfter.map((job) => String(job && job.id || "")).filter(Boolean);
  }

  const beforeHash = new Map(
    pendingBefore.map((job) => [String(job && job.id || ""), hashValue(job)])
  );

  return pendingAfter
    .filter((job) => {
      const id = String(job && job.id || "");
      if (!id) return false;
      return beforeHash.get(id) !== hashValue(job);
    })
    .map((job) => String(job && job.id || ""))
    .filter(Boolean);
}

async function verifyPromotedPages(promotedIds, publicJobs = []) {
  const publicById = new Map((Array.isArray(publicJobs) ? publicJobs : []).map((job) => [String(job && job.id || ""), job]));
  const checks = [];

  for (const id of promotedIds) {
    const publicJob = publicById.get(String(id || ""));
    const pageUrl = String(publicJob?.page_url || "").trim();
    const pagePath = pageUrl ? path.join(ROOT, pageUrl.replace(/^\.\//, "")) : "";
    let pageExists = false;
    if (pagePath) {
      try {
        await fs.access(pagePath);
        pageExists = true;
      } catch (_error) {
        pageExists = false;
      }
    }
    checks.push({
      id: String(id || ""),
      page_url: pageUrl,
      page_exists: pageExists
    });
  }

  return checks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  const beforeSnapshot = await snapshotManagedFiles();
  const [sourcesBefore, jobsBefore, pendingBefore] = await Promise.all([
    readSources(),
    readJobs(),
    readPendingSyncedJobs()
  ]);

  const lifecycle = {
    started_at: startedAt,
    finished_at: "",
    mode: args.write ? "write" : "dry_run",
    auto_publish_enabled: args.write && args.autoPublish && !args.dryRun,
    promotion_cap: args.maxAutoPublishPerRun,
    source_counts: {
      before: sourcesBefore.length,
      after: sourcesBefore.length
    },
    public_job_counts: {
      before: jobsBefore.length,
      after: jobsBefore.length
    },
    pending_counts: {
      before: pendingBefore.length,
      after: pendingBefore.length
    },
    accepted_sources: [],
    rejected_sources: [],
    blocked_sources: [],
    duplicate_sources: [],
    pending_review_sources: [],
    search_leads_captured: 0,
    jobs_routed_public: 0,
    jobs_routed_pending: 0,
    jobs_rejected: 0,
    jobs_considered_for_public: 0,
    jobs_auto_published: 0,
    jobs_left_pending: 0,
    jobs_rejected_from_public: 0,
    public_rejection_reasons: {},
    pay_absent_allowed_count: 0,
    pay_uncertain_blocked_count: 0,
    blocked_by_company_cap_count: 0,
    workable_considered: 0,
    workable_auto_published: 0,
    promotion_cap_hit: false,
    promoted_job_ids: [],
    promoted_job_titles: [],
    promoted_job_sources: [],
    blocked_source_removals: 0,
    validation_status: {
      blocked_source_preflight: "pending",
      source_expansion_validation: "pending",
      public_data_validation: "pending",
      blocked_source_postflight: "pending"
    },
    historical_blocked_mentions_warned: 0,
    files_changed: [],
    expected_managed_files: MANAGED_FILES.map((item) => `resources/jobs/${item}`),
    expected_page_outputs: [],
    warnings: [],
    failures: [],
    steps: []
  };

  try {
    const preflight = await checkBlockedSources();
    lifecycle.validation_status.blocked_source_preflight = preflight.violations.length ? "failed" : "passed";
    lifecycle.historical_blocked_mentions_warned = preflight.historicalWarnings.reduce(
      (sum, entry) => sum + Number(entry.mention_count || 0),
      0
    );
    if (preflight.historicalWarnings.length) {
      lifecycle.warnings.push(`historical_blocked_mentions_warned=${lifecycle.historical_blocked_mentions_warned}`);
    }
    if (preflight.violations.length) {
      lifecycle.failures.push(`blocked_source_preflight_failed:${preflight.violations.length}`);
      throw new Error("Blocked source preflight failed");
    }
    lifecycle.steps.push({ step: "blocked-source-guard", status: "passed", mode: "preflight" });

    if (args.dryRun) {
      runNodeScript("validate-source-expansion.js", ["--phase", "dry_run_preflight", "--before-source-count", String(sourcesBefore.length)]);
      lifecycle.validation_status.source_expansion_validation = "passed";
    } else {
      runNodeScript("discover-sources.js", ["--write"]);
      lifecycle.steps.push({ step: "discover-sources", status: "passed", mode: "write" });

      runNodeScript("validate-source-expansion.js", ["--phase", "post_discovery", "--before-source-count", String(sourcesBefore.length)]);
      lifecycle.validation_status.source_expansion_validation = "passed";
      lifecycle.steps.push({ step: "validate-classify-sources", status: "passed", mode: "write" });

      runNodeScript("search-ingest.js", ["--write"]);
      lifecycle.steps.push({ step: "search-ingest", status: "passed", mode: "write" });

      runNodeScript("sync-targeted-pending-sources.js");
      lifecycle.steps.push({ step: "route-jobs", status: "passed", mode: "write" });

      runNodeScript("validate-source-expansion.js", ["--phase", "post_routing", "--before-source-count", String(sourcesBefore.length)]);
      lifecycle.validation_status.source_expansion_validation = "passed";
    }

    const pendingAfterRouting = await readPendingSyncedJobs();
    const candidateIds = collectCandidateIds(pendingBefore, pendingAfterRouting, args.dryRun);
    const promotionArgs = [
      args.dryRun ? "--dry-run" : "--write",
      `--max-auto-publish-per-run=${args.maxAutoPublishPerRun}`,
      ...(args.autoPublish ? ["--auto-publish"] : [])
    ].concat(candidateIds.map((id) => `--candidate-id=${id}`));
    runNodeScript("promote-public-ready.js", promotionArgs);
    lifecycle.steps.push({
      step: "promote_public_ready",
      status: "passed",
      mode: args.write ? (args.autoPublish ? "write_auto_publish" : "write_evaluate_only") : "dry_run"
    });

    const promotionReport = await readJson(PUBLIC_PROMOTION_REPORT_FILE, {});
    lifecycle.jobs_considered_for_public = Number(promotionReport.jobs_considered_for_public || 0);
    lifecycle.jobs_auto_published = Number(promotionReport.jobs_auto_published || 0);
    lifecycle.jobs_left_pending = Number(promotionReport.jobs_left_pending || 0);
    lifecycle.jobs_rejected_from_public = Number(promotionReport.jobs_rejected_from_public || 0);
    lifecycle.public_rejection_reasons = promotionReport.public_rejection_reasons || {};
    lifecycle.pay_absent_allowed_count = Number(promotionReport.pay_absent_allowed_count || 0);
    lifecycle.pay_uncertain_blocked_count = Number(promotionReport.pay_uncertain_blocked_count || 0);
    lifecycle.blocked_by_company_cap_count = Number(promotionReport.blocked_by_company_cap || 0);
    lifecycle.workable_considered = Number(promotionReport.workable_considered || 0);
    lifecycle.workable_auto_published = Number(promotionReport.workable_auto_published || 0);
    lifecycle.promotion_cap_hit = Boolean(promotionReport.promotion_cap_hit);
    lifecycle.promoted_job_ids = Array.isArray(promotionReport.promoted_job_ids) ? promotionReport.promoted_job_ids : [];
    lifecycle.promoted_job_titles = Array.isArray(promotionReport.promoted_job_titles) ? promotionReport.promoted_job_titles : [];
    lifecycle.promoted_job_sources = Array.isArray(promotionReport.promoted_job_sources) ? promotionReport.promoted_job_sources : [];
    lifecycle.expected_page_outputs = Array.isArray(promotionReport.page_checks)
      ? promotionReport.page_checks.map((entry) => entry.page_url).filter(Boolean)
      : [];
    if (Array.isArray(promotionReport.warnings) && promotionReport.warnings.length) {
      lifecycle.warnings.push(...promotionReport.warnings);
    }

    if (!args.dryRun && lifecycle.jobs_auto_published > 0) {
      runNpmScript("jobs:build-pages");
      lifecycle.steps.push({ step: "build-public-pages", status: "passed", mode: "write" });
    }

    runNpmScript("jobs:validate");
    lifecycle.validation_status.public_data_validation = "passed";
    lifecycle.steps.push({ step: "validate-public-data", status: "passed", mode: args.write ? "write" : "dry_run" });

    runNpmScript("jobs:check-blocked-sources");

    const postflight = await checkBlockedSources();
    lifecycle.validation_status.blocked_source_postflight = postflight.violations.length ? "failed" : "passed";
    lifecycle.historical_blocked_mentions_warned = postflight.historicalWarnings.reduce(
      (sum, entry) => sum + Number(entry.mention_count || 0),
      0
    );
    if (postflight.violations.length) {
      lifecycle.failures.push(`blocked_source_postflight_failed:${postflight.violations.length}`);
      throw new Error("Blocked source postflight failed");
    }
    lifecycle.steps.push({ step: "blocked-source-guard", status: "passed", mode: "postflight" });

    const [sourcesAfter, jobsAfter, pendingAfter, discoveryReport, searchReport, pendingReport, expansionValidationReport, promotionReportAfter] = await Promise.all([
      readSources(),
      readJobs(),
      readPendingSyncedJobs(),
      readJson(DISCOVERY_REPORT_FILE, {}),
      readJson(SEARCH_REPORT_FILE, {}),
      readJson(TARGETED_PENDING_REPORT_FILE, {}),
      readJson(SOURCE_EXPANSION_VALIDATION_REPORT_FILE, {}),
      readJson(PUBLIC_PROMOTION_REPORT_FILE, {})
    ]);

    lifecycle.source_counts.after = sourcesAfter.length;
    lifecycle.public_job_counts.after = jobsAfter.length;
    lifecycle.pending_counts.after = pendingAfter.length;

    if (sourcesAfter.length < sourcesBefore.length) {
      lifecycle.failures.push(`source_count_shrank:${sourcesBefore.length}->${sourcesAfter.length}`);
      throw new Error("Source count shrank unexpectedly");
    }
    if (jobsAfter.length < jobsBefore.length) {
      lifecycle.failures.push(`public_job_count_shrank:${jobsBefore.length}->${jobsAfter.length}`);
      throw new Error("Public job count shrank unexpectedly");
    }

    lifecycle.accepted_sources = summarizeSourceEntries(discoveryReport.accepted_sources);
    lifecycle.rejected_sources = summarizeSourceEntries(discoveryReport.rejected_sources);
    lifecycle.duplicate_sources = summarizeSourceEntries(discoveryReport.duplicate_sources);
    lifecycle.pending_review_sources = summarizeSourceEntries(discoveryReport.pending_review_sources);
    lifecycle.blocked_sources = summarizeSourceEntries(
      (discoveryReport.results || []).filter((entry) => entry.skip_reason === "blocked_source_removed")
    );
    lifecycle.search_leads_captured = Number(searchReport.summary?.jobs_added_to_pending || 0);
    lifecycle.jobs_routed_public = Number(promotionReportAfter.jobs_auto_published || lifecycle.jobs_auto_published || 0);
    lifecycle.jobs_routed_pending =
      Number(searchReport.summary?.jobs_added_to_pending || 0) +
      Number(pendingReport.summary?.jobs_added_to_pending || 0);
    lifecycle.jobs_rejected =
      lifecycle.rejected_sources.length +
      Number(searchReport.summary?.aggregators_skipped || 0) +
      Number(searchReport.summary?.duplicates_skipped || 0) +
      lifecycle.blocked_sources.length;
    lifecycle.jobs_considered_for_public = Number(promotionReportAfter.jobs_considered_for_public || lifecycle.jobs_considered_for_public || 0);
    lifecycle.jobs_auto_published = Number(promotionReportAfter.jobs_auto_published || lifecycle.jobs_auto_published || 0);
    lifecycle.jobs_left_pending = Number(promotionReportAfter.jobs_left_pending || lifecycle.jobs_left_pending || 0);
    lifecycle.jobs_rejected_from_public = Number(promotionReportAfter.jobs_rejected_from_public || lifecycle.jobs_rejected_from_public || 0);
    lifecycle.public_rejection_reasons = promotionReportAfter.public_rejection_reasons || lifecycle.public_rejection_reasons;
    lifecycle.pay_absent_allowed_count = Number(promotionReportAfter.pay_absent_allowed_count || lifecycle.pay_absent_allowed_count || 0);
    lifecycle.pay_uncertain_blocked_count = Number(promotionReportAfter.pay_uncertain_blocked_count || lifecycle.pay_uncertain_blocked_count || 0);
    lifecycle.blocked_by_company_cap_count = Number(promotionReportAfter.blocked_by_company_cap || lifecycle.blocked_by_company_cap_count || 0);
    lifecycle.workable_considered = Number(promotionReportAfter.workable_considered || lifecycle.workable_considered || 0);
    lifecycle.workable_auto_published = Number(promotionReportAfter.workable_auto_published || lifecycle.workable_auto_published || 0);
    lifecycle.promotion_cap_hit = Boolean(promotionReportAfter.promotion_cap_hit || lifecycle.promotion_cap_hit);
    lifecycle.promoted_job_ids = Array.isArray(promotionReportAfter.promoted_job_ids) ? promotionReportAfter.promoted_job_ids : lifecycle.promoted_job_ids;
    lifecycle.promoted_job_titles = Array.isArray(promotionReportAfter.promoted_job_titles) ? promotionReportAfter.promoted_job_titles : lifecycle.promoted_job_titles;
    lifecycle.promoted_job_sources = Array.isArray(promotionReportAfter.promoted_job_sources) ? promotionReportAfter.promoted_job_sources : lifecycle.promoted_job_sources;
    const actualPageChecks = !args.dryRun && lifecycle.promoted_job_ids.length
      ? await verifyPromotedPages(lifecycle.promoted_job_ids, jobsAfter)
      : (Array.isArray(promotionReportAfter.page_checks) ? promotionReportAfter.page_checks : []);
    lifecycle.expected_page_outputs = actualPageChecks.map((entry) => entry.page_url).filter(Boolean);
    lifecycle.blocked_source_removals =
      Math.max(0, countBlockedEntries(sourcesBefore) - countBlockedEntries(sourcesAfter)) +
      Math.max(0, countBlockedEntries(jobsBefore) - countBlockedEntries(jobsAfter)) +
      Math.max(0, countBlockedEntries(pendingBefore) - countBlockedEntries(pendingAfter));

    if (Array.isArray(expansionValidationReport.errors) && expansionValidationReport.errors.length) {
      lifecycle.failures.push(...expansionValidationReport.errors);
      throw new Error("Source expansion validation failed");
    }
    if (Array.isArray(expansionValidationReport.warnings) && expansionValidationReport.warnings.length) {
      lifecycle.warnings.push(...expansionValidationReport.warnings);
    }

    if (!args.dryRun && lifecycle.jobs_auto_published > 0) {
      const missingPages = actualPageChecks.filter((entry) => !entry.page_exists);
      if (missingPages.length) {
        lifecycle.failures.push(`promoted_jobs_missing_pages:${missingPages.length}`);
        throw new Error("Promoted jobs missing generated pages");
      }
    }
  } catch (error) {
    lifecycle.failures.push(error.message);
  } finally {
    const afterSnapshot = await snapshotManagedFiles();
    lifecycle.files_changed = changedFiles(beforeSnapshot, afterSnapshot);
    lifecycle.finished_at = new Date().toISOString();
    await fs.writeFile(REPORT_FILE, JSON.stringify(lifecycle, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(lifecycle, null, 2));
  }

  if (lifecycle.failures.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:auto-expand] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
