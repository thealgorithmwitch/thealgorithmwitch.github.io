const fs = require("fs/promises");
const path = require("path");
const { buildPublicJobsFromRecords } = require("./public-jobs");
const { CANONICAL_SPECIALIZATIONS, hasUsableDescription } = require("./job-normalizer");
const { buildJobPagePathMap, cleanVisibleText } = require("./job-page-paths");
const { readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { readSourceHealthSnapshot } = require("./source-health-store");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");
const VALIDATION_SNAPSHOTS_DIR = path.join(ROOT, "validation-snapshots");
const VALIDATION_LATEST_FILE = path.join(VALIDATION_SNAPSHOTS_DIR, "latest.json");
const CANONICAL_RENDER_TARGETS = [
  path.join(ROOT, "index.html"),
  path.join(ROOT, "scripts", "generate-job-pages.js")
];
const VALID_WORKPLACE_TYPES = new Set(["Remote", "Hybrid", "On-site", ""]);
const BLANK_SNIPPET_THRESHOLD = 0;
const BAD_SNIPPET_PATTERNS = [
  /\bprevious\b/i,
  /\bnext post\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i,
  /<span\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bcareer_page\b/i,
  /\bBusiness\/Productivity Software\b/i
];
const BAD_LOCATION_PATTERNS = [
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i,
  /\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/i
];
const BAD_PAY_PATTERNS = [
  /^(?:-|—|–|\$-|\$0|0|n\/a|na|not listed|not disclosed|undisclosed)$/i,
  /\$\s*,|\bpay range\s*\$[\s,.-]*\$\s*[,.-]*/i,
  /\$\d{1,3},\s*\.\d{1,2}\s*(?:to|-|–|—)\s*\$\s*[,.\s\d]*/i,
  /\bup to\s*\$[\s,.-]*$/i
];
const VIDEO_SIGNAL_PATTERN = /\b(?:video|videographer|video editor|video producer|multimedia producer|motion designer|motion graphics|youtube|documentary|short-form video|short form video|digital video|social video|film producer)\b/i;
const RAW_FIELD_USAGE_PATTERNS = [
  /\braw_source_data\b/,
  /\braw_description\b/,
  /\braw_salary\b/
];

function normalizePath(value) {
  return String(value || "").trim();
}

function isValidPayDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (!/\d/.test(text)) return false;
  return !BAD_PAY_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBadSnippet(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return BAD_SNIPPET_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBadLocation(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return BAD_LOCATION_PATTERNS.some((pattern) => pattern.test(text));
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

async function buildValidationReport(options = {}) {
  const [records, jobs, pending, sources, pageFiles, sourceHealth, canonicalRenderFiles] = await Promise.all([
    readJobRecords(),
    readJobs(),
    readPendingSyncedJobs(),
    readSources(),
    fs.readdir(PAGES_DIR).catch(() => []),
    readSourceHealthSnapshot(),
    Promise.all(
      CANONICAL_RENDER_TARGETS.map(async (filePath) => ({
        filePath,
        contents: await fs.readFile(filePath, "utf8").catch(() => "")
      }))
    )
  ]);
  const publicJobs = buildPublicJobsFromRecords(records);
  const derivedJobs = jobs.map((job) => ({ ...job }));
  const { map, collisions } = buildJobPagePathMap(derivedJobs);
  const pageFileSet = new Set(pageFiles.filter((file) => file.endsWith(".html")).map((file) => `./pages/${file}`));
  const expectedById = new Map(publicJobs.map((job) => [String(job.id || ""), job]));

  const missingPageUrl = [];
  const stalePageUrl = [];
  const brokenLinks = [];
  const invalidPay = [];
  const invalidWorkplace = [];
  const invalidLocation = [];
  const invalidSnippet = [];
  const suspiciousSpecialization = [];
  const videoSpecializationMisses = [];
  const lowConfidenceSpecializations = [];
  const suspiciousGenericSpecializations = [];
  const duplicatePageUrls = [];
  const pageUrlCounts = new Map();
  const duplicateIds = [];
  const missingCanonicalDescription = [];
  const redirectLoops = [];
  const redirectChains = [];
  const orphanedRedirects = [];
  const duplicateRedirects = [];
  const redirectTargets = new Map();
  const jobIdCounts = new Map();
  const canonicalPageSet = new Set();
  const overwriteConflicts = [];
  const canonicalFieldViolations = [];

  for (const job of jobs) {
    canonicalPageSet.add(normalizePath(job.page_url));
    const id = String(job.id || "");
    jobIdCounts.set(id, (jobIdCounts.get(id) || 0) + 1);
  }

  for (const record of records) {
    if (!Array.isArray(record.field_conflicts)) continue;
    record.field_conflicts.forEach((conflict) => {
      overwriteConflicts.push({
        id: record.id,
        title: record.display?.title || record.raw_source_data?.title || "",
        organization: record.display?.organization || record.raw_source_data?.organization || "",
        field: String(conflict?.field || ""),
        detected_at: String(conflict?.detected_at || ""),
        reason: String(conflict?.reason || "")
      });
    });
  }

  canonicalRenderFiles.forEach(({ filePath, contents }) => {
    if (!contents) return;
    RAW_FIELD_USAGE_PATTERNS.forEach((pattern) => {
      if (pattern.test(contents)) {
        canonicalFieldViolations.push({
          file: path.relative(ROOT, filePath),
          pattern: String(pattern)
        });
      }
    });
  });

  for (const job of jobs) {
    const id = String(job.id || "");
    const expectedPath = map.get(id) || "";
    const pageUrl = normalizePath(job.page_url);
    const snippet = String(job.description_snippet || job.summary || "").trim();
    const payDisplay = String(job.salary || "").trim();
    const workplaceType = String(job.workplace_type || "").trim();
    const specialization = String(job.specialization || "").trim();
    const specializationConfidence = String(job.specialization_confidence || "low").trim().toLowerCase();
    const location = String(job.location || "").trim();
    const textForVideo = [job.title, job.description, job.description_snippet, job.function, specialization].filter(Boolean).join(" ");
    const canonicalDescription = String(job.description || "").trim();
    const redirectPaths = Array.isArray(job.redirect_paths) ? job.redirect_paths.map((item) => String(item || "").trim()).filter(Boolean) : [];

    if (!pageUrl) {
      missingPageUrl.push({ id, title: job.title, organization: job.organization });
    } else {
      pageUrlCounts.set(pageUrl, (pageUrlCounts.get(pageUrl) || 0) + 1);
      if (expectedPath && pageUrl !== expectedPath) {
        stalePageUrl.push({ id, title: job.title, organization: job.organization, page_url: pageUrl, expected_page_url: expectedPath });
      }
      if (options.requirePages !== false && !pageFileSet.has(pageUrl)) {
        brokenLinks.push({ id, title: job.title, organization: job.organization, page_url: pageUrl });
      }
    }

    if (!isValidPayDisplay(payDisplay)) {
      invalidPay.push({ id, title: job.title, organization: job.organization, salary: payDisplay });
    }
    if (!VALID_WORKPLACE_TYPES.has(workplaceType)) {
      invalidWorkplace.push({ id, title: job.title, organization: job.organization, workplace_type: workplaceType });
    }
    if (hasBadLocation(location)) {
      invalidLocation.push({ id, title: job.title, organization: job.organization, location });
    }
    if (((!snippet && hasUsableDescription(job.description || "", { title: job.title })) || hasBadSnippet(snippet))) {
      invalidSnippet.push({ id, title: job.title, organization: job.organization, description_snippet: snippet });
    }
    if (!hasUsableDescription(canonicalDescription, { title: job.title })) {
      missingCanonicalDescription.push({ id, title: job.title, organization: job.organization });
    }
    if (!specialization || !CANONICAL_SPECIALIZATIONS.includes(specialization)) {
      suspiciousSpecialization.push({ id, title: job.title, organization: job.organization, specialization });
    }
    if (specialization && specializationConfidence === "low") {
      lowConfidenceSpecializations.push({ id, title: job.title, organization: job.organization, specialization, specialization_confidence: specializationConfidence });
    }
    if (["strategy", "sales", "operations", "programs", "admin"].includes(specialization.toLowerCase()) && specializationConfidence !== "high") {
      suspiciousGenericSpecializations.push({ id, title: job.title, organization: job.organization, specialization, specialization_confidence: specializationConfidence });
    }
    if (VIDEO_SIGNAL_PATTERN.test(textForVideo) && specialization !== "Video") {
      videoSpecializationMisses.push({ id, title: job.title, organization: job.organization, specialization });
    }
    if (!expectedById.has(id)) {
      suspiciousSpecialization.push({ id, title: job.title, organization: job.organization, specialization, note: "job_missing_from_published_records" });
    }
    redirectPaths.forEach((redirectPath) => {
      const normalizedRedirectPath = normalizePath(redirectPath);
      if (!normalizedRedirectPath) return;
      redirectTargets.set(normalizedRedirectPath, normalizePath(pageUrl));
      if (normalizedRedirectPath === pageUrl) {
        redirectLoops.push({ id, title: job.title, redirect_path: normalizedRedirectPath, page_url: pageUrl });
      }
      if (!pageFileSet.has(normalizedRedirectPath) && options.requirePages !== false) {
        orphanedRedirects.push({ id, title: job.title, redirect_path: normalizedRedirectPath, page_url: pageUrl });
      }
    });
  }

  for (const [pageUrl, count] of pageUrlCounts.entries()) {
    if (count > 1) duplicatePageUrls.push({ page_url: pageUrl, count });
  }
  for (const [id, count] of jobIdCounts.entries()) {
    if (count > 1) duplicateIds.push({ id, count });
  }
  for (const [redirectPath, targetPath] of redirectTargets.entries()) {
    if (redirectTargets.has(targetPath)) {
      redirectChains.push({ redirect_path: redirectPath, target_path: targetPath, next_target: redirectTargets.get(targetPath) });
    }
    const collisionsForRedirect = jobs.filter((job) => Array.isArray(job.redirect_paths) && job.redirect_paths.includes(redirectPath));
    if (collisionsForRedirect.length > 1) {
      duplicateRedirects.push({
        redirect_path: redirectPath,
        targets: collisionsForRedirect.map((job) => job.page_url)
      });
    }
  }

  const publicRecordsCount = publicJobs.length;
  const jobsJsonCount = jobs.length;
  const redirectPageCount = redirectTargets.size;
  const generatedPageCount = Array.from(canonicalPageSet).filter((pageUrl) => pageUrl && pageFileSet.has(pageUrl)).length;
  const indexCardCount = jobs.length;
  const pendingPublicOverlapCount = pending.filter((job) => expectedById.has(String(job.id || ""))).length;
  const climateChangeJobsSource = sources.find((source) => String(source.id || "") === "climatechangejobs") || null;
  const climateChangeJobsPending = pending.filter((job) => /climatechangejobs/i.test([job.source_id, job.source, job.source_url].filter(Boolean).join(" ")));
  const specializationCounts = countBy(
    jobs.map((job) => String(job.specialization || "").trim() || "(blank)"),
    (value) => value
  );

  const errors = [];
  if (publicRecordsCount !== jobsJsonCount) errors.push(`jobs.json count ${jobsJsonCount} does not match published record count ${publicRecordsCount}`);
  if (missingPageUrl.length) errors.push(`missing page_url count ${missingPageUrl.length}`);
  if (stalePageUrl.length) errors.push(`stale page_url count ${stalePageUrl.length}`);
  if (duplicatePageUrls.length) errors.push(`duplicate page_url count ${duplicatePageUrls.length}`);
  if (duplicateIds.length) errors.push(`duplicate canonical id count ${duplicateIds.length}`);
  if (options.requirePages !== false && generatedPageCount < jobsJsonCount) errors.push(`generated page count ${generatedPageCount} is less than jobs.json count ${jobsJsonCount}`);
  if (brokenLinks.length) errors.push(`broken link count ${brokenLinks.length}`);
  if (invalidPay.length) errors.push(`invalid pay count ${invalidPay.length}`);
  if (invalidWorkplace.length) errors.push(`invalid workplace_type count ${invalidWorkplace.length}`);
  if (invalidLocation.length) errors.push(`invalid location count ${invalidLocation.length}`);
  if (invalidSnippet.length > BLANK_SNIPPET_THRESHOLD) errors.push(`invalid snippet count ${invalidSnippet.length}`);
  if (missingCanonicalDescription.length) errors.push(`missing canonical description count ${missingCanonicalDescription.length}`);
  if (redirectLoops.length) errors.push(`redirect loop count ${redirectLoops.length}`);
  if (canonicalFieldViolations.length) errors.push(`canonical field architecture violation count ${canonicalFieldViolations.length}`);

  return {
    public_records_count: publicRecordsCount,
    jobs_json_count: jobsJsonCount,
    generated_page_count: generatedPageCount,
    redirect_page_count: redirectPageCount,
    index_card_count: indexCardCount,
    missing_page_url_count: missingPageUrl.length,
    stale_page_url_count: stalePageUrl.length,
    duplicate_slug_count: collisions.length + duplicatePageUrls.length,
    duplicate_page_url_count: duplicatePageUrls.length,
    duplicate_canonical_id_count: duplicateIds.length,
    broken_link_count: brokenLinks.length,
    pending_public_overlap_count: pendingPublicOverlapCount,
    invalid_snippet_count: invalidSnippet.length,
    missing_canonical_description_count: missingCanonicalDescription.length,
    redirect_chain_count: redirectChains.length,
    duplicate_redirect_count: duplicateRedirects.length,
    orphaned_redirect_count: orphanedRedirects.length,
    redirect_loop_count: redirectLoops.length,
    specialization_distribution: specializationCounts,
    suspicious_unmapped_specialization_count: suspiciousSpecialization.length,
    low_confidence_specialization_count: lowConfidenceSpecializations.length,
    suspicious_generic_specialization_count: suspiciousGenericSpecializations.length,
    video_specialization_detection_miss_count: videoSpecializationMisses.length,
    overwrite_conflict_count: overwriteConflicts.length,
    canonical_field_violation_count: canonicalFieldViolations.length,
    climatechangejobs_source_enabled: Boolean(climateChangeJobsSource && climateChangeJobsSource.enabled !== false),
    climatechangejobs_source_custom_sync_enabled: Boolean(climateChangeJobsSource && climateChangeJobsSource.custom_sync_enabled !== false),
    climatechangejobs_pending_count: climateChangeJobsPending.length,
    source_health: sourceHealth,
    errors,
    samples: {
      missing_page_url: missingPageUrl.slice(0, 10),
      stale_page_url: stalePageUrl.slice(0, 10),
      duplicate_page_url: duplicatePageUrls.slice(0, 10),
      broken_link: brokenLinks.slice(0, 10),
      invalid_pay: invalidPay.slice(0, 10),
      invalid_workplace_type: invalidWorkplace.slice(0, 10),
      invalid_location: invalidLocation.slice(0, 10),
      invalid_snippet: invalidSnippet.slice(0, 10),
      missing_canonical_description: missingCanonicalDescription.slice(0, 10),
      duplicate_canonical_id: duplicateIds.slice(0, 10),
      redirect_chains: redirectChains.slice(0, 10),
      duplicate_redirects: duplicateRedirects.slice(0, 10),
      orphaned_redirects: orphanedRedirects.slice(0, 10),
      redirect_loops: redirectLoops.slice(0, 10),
      overwrite_conflicts: overwriteConflicts.slice(0, 20),
      canonical_field_violations: canonicalFieldViolations.slice(0, 20),
      suspicious_specialization: suspiciousSpecialization.slice(0, 20),
      low_confidence_specialization: lowConfidenceSpecializations.slice(0, 20),
      suspicious_generic_specialization: suspiciousGenericSpecializations.slice(0, 20),
      video_specialization_miss: videoSpecializationMisses.slice(0, 20),
      climatechangejobs_pending: climateChangeJobsPending.slice(0, 10).map((job) => ({
        id: job.id,
        title: job.title,
        organization: job.organization,
        source_id: job.source_id,
        triage_bucket: job.triage_bucket,
        triage_reason: job.triage_reason
      }))
    }
  };
}

async function persistValidationSnapshot(report) {
  await fs.mkdir(VALIDATION_SNAPSHOTS_DIR, { recursive: true });
  let previous = null;
  try {
    previous = JSON.parse(await fs.readFile(VALIDATION_LATEST_FILE, "utf8"));
  } catch (_error) {
    previous = null;
  }
  const regressions = [];
  const regressionChecks = [
    ["broken_link_count", "broken links increased"],
    ["suspicious_unmapped_specialization_count", "specialization blanks increased"],
    ["pending_public_overlap_count", "pending/public overlap increased"],
    ["invalid_snippet_count", "malformed snippets increased"]
  ];
  const current = {
    generated_at: new Date().toISOString(),
    public_records_count: report.public_records_count,
    jobs_json_count: report.jobs_json_count,
    generated_page_count: report.generated_page_count,
    broken_link_count: report.broken_link_count,
    suspicious_unmapped_specialization_count: report.suspicious_unmapped_specialization_count,
    pending_public_overlap_count: report.pending_public_overlap_count,
    invalid_snippet_count: report.invalid_snippet_count,
    overwrite_conflict_count: report.overwrite_conflict_count,
    canonical_field_violation_count: report.canonical_field_violation_count,
    report
  };
  if (previous) {
    regressionChecks.forEach(([key, label]) => {
      if (Number(current[key] || 0) > Number(previous[key] || 0)) {
        regressions.push(label);
      }
    });
    if (current.generated_page_count !== current.jobs_json_count) {
      regressions.push("page count drift detected");
    }
    if (
      Number(current.generated_page_count || 0) !== Number(previous.generated_page_count || 0) ||
      Number(current.jobs_json_count || 0) !== Number(previous.jobs_json_count || 0)
    ) {
      regressions.push("page count drift changed from previous snapshot");
    }
  }
  current.regressions = regressions;
  const timestampedFile = path.join(VALIDATION_SNAPSHOTS_DIR, `${current.generated_at.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(VALIDATION_LATEST_FILE, JSON.stringify(current, null, 2) + "\n", "utf8");
  await fs.writeFile(timestampedFile, JSON.stringify(current, null, 2) + "\n", "utf8");
  return current;
}

async function main() {
  const requirePages = !process.argv.includes("--pre-pages");
  const report = await buildValidationReport({ requirePages });
  const snapshot = await persistValidationSnapshot(report);
  console.log(JSON.stringify({
    ...report,
    validation_snapshot_regressions: snapshot.regressions
  }, null, 2));
  if (report.errors.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:validate-public-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildValidationReport,
  persistValidationSnapshot
};
