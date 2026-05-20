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
const VALIDATION_LATEST_FILE = path.join(ROOT, "validation-snapshots", "latest.json");

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
  "reports/auto-expand-lifecycle-latest.json",
  "validation-snapshots/latest.json"
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--write"),
    write: argv.includes("--write")
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
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

function summarizeSourceEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    organization: entry.organization || "",
    provider: entry.detected_provider || entry.provider || "",
    url: entry.detected_job_url || entry.url || "",
    reason: entry.skip_reason || "",
    status: entry.onboarding_status || ""
  }));
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
      lifecycle.warnings.push(
        `historical_blocked_mentions_warned=${lifecycle.historical_blocked_mentions_warned}`
      );
    }
    if (preflight.violations.length) {
      lifecycle.failures.push(`blocked_source_preflight_failed:${preflight.violations.length}`);
      throw new Error("Blocked source preflight failed");
    }
    lifecycle.steps.push({ step: "blocked-source-guard", status: "passed", mode: "preflight" });

    if (args.dryRun) {
      runNodeScript("validate-source-expansion.js", ["--phase", "dry_run_preflight", "--before-source-count", String(sourcesBefore.length)]);
      lifecycle.validation_status.source_expansion_validation = "passed";
      runNodeScript("validate-public-data.js");
      lifecycle.validation_status.public_data_validation = "passed";
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

      runNodeScript("validate-public-data.js");
      lifecycle.validation_status.public_data_validation = "passed";
      lifecycle.steps.push({ step: "validate-public-data", status: "passed", mode: "write" });
    }

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

    const [sourcesAfter, jobsAfter, pendingAfter, discoveryReport, searchReport, pendingReport, expansionValidationReport] = await Promise.all([
      readSources(),
      readJobs(),
      readPendingSyncedJobs(),
      readJson(DISCOVERY_REPORT_FILE, {}),
      readJson(SEARCH_REPORT_FILE, {}),
      readJson(TARGETED_PENDING_REPORT_FILE, {}),
      readJson(SOURCE_EXPANSION_VALIDATION_REPORT_FILE, {})
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
    lifecycle.jobs_routed_public = 0;
    lifecycle.jobs_routed_pending =
      Number(searchReport.summary?.jobs_added_to_pending || 0) +
      Number(pendingReport.summary?.jobs_added_to_pending || 0);
    lifecycle.jobs_rejected =
      lifecycle.rejected_sources.length +
      Number(searchReport.summary?.aggregators_skipped || 0) +
      Number(searchReport.summary?.duplicates_skipped || 0) +
      lifecycle.blocked_sources.length;
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

function countBlockedEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const descriptor = JSON.stringify(entry || "");
    return /\b(?:articulate|empowerly|remofirst|recidiviz|cribl|found|canonicaljobs|canonical|cohere|chilipiper|beehiiv|posthog|automattic|superside|samsara|gusto|climatechangejobs|climate change jobs)\b/i.test(descriptor);
  }).length;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:auto-expand] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
