const fs = require("fs/promises");
const path = require("path");
const { hasUsableDescription } = require("./job-normalizer");
const { readJobs, readJson, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { getBlockedSourceRuleForEntry, isBlockedSourceEntry, stringify } = require("./blocked-source-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const DISCOVERY_REPORT_FILE = path.join(REPORTS_DIR, "source-discovery-report.json");
const SEARCH_REPORT_FILE = path.join(REPORTS_DIR, "search-ingest-report.json");
const AUTO_EXPAND_REPORT_FILE = path.join(REPORTS_DIR, "auto-expand-lifecycle-latest.json");
const OUTPUT_REPORT_FILE = path.join(REPORTS_DIR, "source-expansion-validation-latest.json");

function parseArgs(argv) {
  const args = {
    beforeSourceCount: null,
    phase: "standalone",
    autoExpandReport: AUTO_EXPAND_REPORT_FILE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--before-source-count" && argv[index + 1]) {
      args.beforeSourceCount = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--phase" && argv[index + 1]) {
      args.phase = String(argv[index + 1] || "standalone");
      index += 1;
      continue;
    }
    if (token === "--auto-expand-report" && argv[index + 1]) {
      args.autoExpandReport = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function countBlocked(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => isBlockedSourceEntry(entry)).length;
}

function hasPendingEvidence(entry = {}) {
  return Boolean(
    stringify(entry.detected_job_url)
    || stringify(entry.organization)
    || stringify(entry.skip_reason)
    || stringify(entry.recommended_sync_path)
  );
}

function hasRawSourceContext(job = {}) {
  return Boolean(
    stringify(job.raw_description)
    || stringify(job.raw_payload)
    || stringify(job.original_url)
    || stringify(job.source_url)
    || stringify(job.apply_url)
  );
}

function isHighConfidencePublicJob(job = {}) {
  const confidence = String(job.specialization_confidence || job.confidence || "").trim().toLowerCase();
  const applyUrl = stringify(job.apply_url);
  const location = stringify(job.location);
  const salary = stringify(job.salary);
  const salaryLooksUsable = !salary || /\d/.test(salary);
  return Boolean(
    applyUrl.startsWith("http")
    && hasUsableDescription(job.description, { title: job.title })
    && salaryLooksUsable
    && (!location || location.length >= 2)
    && ["high", "very_high", "very-high"].includes(confidence)
  );
}

async function buildReport(options = {}) {
  const [sources, jobs, pendingJobs, records, discoveryReport, searchReport, autoExpandReport] = await Promise.all([
    readSources(),
    readJobs(),
    readPendingSyncedJobs(),
    readJobRecords(),
    loadJson(DISCOVERY_REPORT_FILE, null),
    loadJson(SEARCH_REPORT_FILE, null),
    loadJson(options.autoExpandReport || AUTO_EXPAND_REPORT_FILE, null)
  ]);

  const acceptedSources = Array.isArray(discoveryReport?.accepted_sources) ? discoveryReport.accepted_sources : [];
  const rejectedSources = Array.isArray(discoveryReport?.rejected_sources) ? discoveryReport.rejected_sources : [];
  const duplicateSources = Array.isArray(discoveryReport?.duplicate_sources) ? discoveryReport.duplicate_sources : [];
  const pendingReviewSources = Array.isArray(discoveryReport?.pending_review_sources) ? discoveryReport.pending_review_sources : [];
  const allDiscoveryResults = Array.isArray(discoveryReport?.results) ? discoveryReport.results : [];
  const searchResults = Array.isArray(searchReport?.results) ? searchReport.results : [];

  const errors = [];
  const warnings = [];

  const beforeSourceCount = Number.isFinite(options.beforeSourceCount) ? Number(options.beforeSourceCount) : null;
  const currentSourceCount = sources.length;
  if (beforeSourceCount !== null && currentSourceCount < beforeSourceCount) {
    errors.push(`source_count_shrank:${beforeSourceCount}->${currentSourceCount}`);
  }

  acceptedSources.forEach((entry) => {
    if (!stringify(entry.detected_provider) || !stringify(entry.detected_job_url)) {
      errors.push(`accepted_source_missing_classification:${stringify(entry.organization) || "(unknown)"}`);
    }
  });

  rejectedSources.forEach((entry) => {
    if (!stringify(entry.skip_reason)) {
      errors.push(`rejected_source_missing_reason:${stringify(entry.organization) || "(unknown)"}`);
    }
  });

  pendingReviewSources.forEach((entry) => {
    if (!hasPendingEvidence(entry)) {
      errors.push(`pending_review_missing_evidence:${stringify(entry.organization) || "(unknown)"}`);
    }
  });

  allDiscoveryResults.forEach((entry) => {
    if (entry.onboarding_status === "appended_to_sources" && getBlockedSourceRuleForEntry(entry)) {
      errors.push(`blocked_source_appended:${stringify(entry.organization) || "(unknown)"}`);
    }
  });

  const parserFailurePending = pendingJobs.filter((job) =>
    /parser_failed_capture_pending|live_parsing_failed|search_capture_pending_review/i.test(
      [job.review_reason, job.triage_reason, job.notes].map((value) => stringify(value)).join(" ")
    )
  );
  parserFailurePending.forEach((job) => {
    if (!hasRawSourceContext(job)) {
      errors.push(`parser_failure_pending_missing_raw_context:${stringify(job.id) || stringify(job.title) || "(unknown)"}`);
    }
  });

  const publicJobsWithoutConfidence = jobs.filter((job) => !isHighConfidencePublicJob(job));
  if (autoExpandReport && Array.isArray(autoExpandReport.job_routing?.public)) {
    autoExpandReport.job_routing.public.forEach((job) => {
      if (!isHighConfidencePublicJob(job)) {
        errors.push(`public_routed_job_not_high_confidence:${stringify(job.id) || stringify(job.title) || "(unknown)"}`);
      }
    });
  } else if (publicJobsWithoutConfidence.length) {
    warnings.push(`current_public_jobs_without_explicit_high_confidence=${publicJobsWithoutConfidence.length}`);
  }

  const blockedActiveCounts = {
    sources: countBlocked(sources),
    jobs: countBlocked(jobs),
    pending: countBlocked(pendingJobs),
    records: countBlocked(records)
  };
  Object.entries(blockedActiveCounts).forEach(([key, value]) => {
    if (value > 0) {
      errors.push(`blocked_source_present_in_${key}:${value}`);
    }
  });

  const missingRejectedReasons = rejectedSources.filter((entry) => !stringify(entry.skip_reason));
  const missingPendingEvidence = pendingReviewSources.filter((entry) => !hasPendingEvidence(entry));
  const blockedDiscoveryMentions = allDiscoveryResults.filter((entry) => entry.skip_reason === "blocked_source_removed").length;
  const blockedSearchMentions = searchResults.reduce((sum, entry) => sum + Number(entry?.dedupe_reasons?.blocked_source_removed || 0), 0);

  return {
    generated_at: new Date().toISOString(),
    phase: options.phase || "standalone",
    source_counts: {
      before: beforeSourceCount,
      current: currentSourceCount
    },
    discovery_summary: {
      accepted_sources: acceptedSources.length,
      rejected_sources: rejectedSources.length,
      duplicate_sources: duplicateSources.length,
      pending_review_sources: pendingReviewSources.length,
      blocked_source_results: blockedDiscoveryMentions
    },
    search_summary: {
      leads_captured: Number(searchReport?.summary?.jobs_added_to_pending || 0),
      source_candidates_added: Number(searchReport?.summary?.source_candidates_added || 0),
      blocked_source_skips: blockedSearchMentions
    },
    parser_failure_pending_count: parserFailurePending.length,
    missing_rejected_reason_count: missingRejectedReasons.length,
    missing_pending_evidence_count: missingPendingEvidence.length,
    blocked_active_counts: blockedActiveCounts,
    errors,
    warnings
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  await fs.writeFile(OUTPUT_REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:validate-source-expansion] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReport
};
