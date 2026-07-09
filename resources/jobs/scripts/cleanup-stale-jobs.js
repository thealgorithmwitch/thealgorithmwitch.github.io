const fs = require("fs/promises");
const path = require("path");
const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  writeJsonIfChanged
} = require("./job-utils");
const { JOB_RECORDS_FILE, readJobRecords } = require("./public-records");
const { buildValidationReport } = require("./validate-public-data");
const { buildJobPagePathMap } = require("./job-page-paths");
const { buildPublicJobsFromRecords, syncPublicJobsFromRecords } = require("./public-jobs");
const { detectPageMode, detectRedirectToBoard, fetchLivePage } = require("./freshness-audit");
const { markRemoved } = require("./lifecycle-utils");
const { normalizeJob, stringifySafe } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");
const REPORT_JSON = path.join(ROOT, "reports", "cleanup-stale-jobs-latest.json");
const REPORT_MD = path.join(ROOT, "reports", "cleanup-stale-jobs-latest.md");
const FETCH_CONCURRENCY = 6;

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    write: !argv.includes("--dry-run")
  };
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return cleanText(value).toLowerCase();
}

function buildDuplicateKey(job = {}) {
  const title = normalizeToken(job.title);
  const organization = normalizeToken(job.organization);
  const applyUrl = normalizeToken(job.apply_url || job.original_url || job.source_url);
  if (!title || !organization || !applyUrl) return "";
  return `${title}::${organization}::${applyUrl}`;
}

function hasCorePublicFields(job = {}) {
  return Boolean(cleanText(job.title) && cleanText(job.organization) && cleanText(job.apply_url));
}

function countManualSignals(record = {}) {
  return (Array.isArray(record.manual_overrides) ? record.manual_overrides.length : 0)
    + (Array.isArray(record.protected_fields) ? record.protected_fields.length : 0)
    + (cleanText(record.admin_notes) ? 1 : 0);
}

function scoreKeeper(record = {}, job = {}) {
  const descriptionLength = cleanText(job.description || record.display?.description || record.raw_source_data?.description).length;
  const payVisible = cleanText(job.salary || record.display?.pay_display) ? 1 : 0;
  const locationVisible = cleanText(job.location || record.display?.location) ? 1 : 0;
  const manualSignals = countManualSignals(record);
  const updatedAt = Date.parse(record.updated_at || record.last_checked_at || 0) || 0;
  return (manualSignals * 1000000) + (descriptionLength * 10) + (payVisible * 1000) + (locationVisible * 500) + updatedAt;
}

function annotateArchivedRecord(record, reason, cleanupRunAt) {
  const archived = markRemoved(record, reason, { now: new Date(cleanupRunAt) });
  return {
    ...archived,
    cleanup_archived: true,
    cleanup_reason: reason,
    cleanup_run_at: cleanupRunAt,
    cleanup_report: path.relative(ROOT, REPORT_JSON)
  };
}

async function deleteStalePages(expectedPageUrls, options = {}) {
  const deleted = [];
  const files = await fs.readdir(PAGES_DIR).catch(() => []);
  for (const file of files.filter((name) => name.endsWith(".html"))) {
    const pageUrl = `./pages/${file}`;
    if (expectedPageUrls.has(pageUrl)) continue;
    const fullPath = path.join(PAGES_DIR, file);
    if (options.write) {
      await fs.unlink(fullPath).catch(() => {});
    }
    deleted.push(pageUrl);
  }
  return deleted;
}

async function processInBatches(items, worker, concurrency) {
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    await Promise.all(batch.map(worker));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cleanupRunAt = nowIso();
  const [jobs, records, pending] = await Promise.all([
    readJobs(),
    readJobRecords(),
    readPendingSyncedJobs()
  ]);

  const recordsById = new Map((Array.isArray(records) ? records : []).map((record) => [cleanText(record.id), record]));
  const publicJobs = Array.isArray(jobs) ? jobs : [];
  const publishedRecords = records.filter((record) => record && record.record_type === "job" && cleanText(record.status).toLowerCase() === "published" && record.published && record.public_visibility);
  const archivedRecords = records.filter((record) => record && record.record_type === "job" && cleanText(record.status).toLowerCase() === "archived");
  const pendingDuplicates = [];
  const riskyChanges = [];
  const archiveActions = new Map();
  const duplicateGroups = new Map();
  const deadLinkIds = new Set();
  const duplicateIds = new Set();
  const missingCoreIds = new Set();
  const inactiveIds = new Set();
  const brokenPageIds = new Set();
  const checkedJobs = [];

  for (const job of publicJobs) {
    const duplicateKey = buildDuplicateKey(job);
    if (!duplicateKey) continue;
    const group = duplicateGroups.get(duplicateKey) || [];
    group.push(job);
    duplicateGroups.set(duplicateKey, group);
  }

  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const ranked = group
      .map((job) => ({ job, record: recordsById.get(cleanText(job.id)), score: scoreKeeper(recordsById.get(cleanText(job.id)) || {}, job) }))
      .sort((left, right) => right.score - left.score);
    const keeper = ranked[0];
    for (const duplicate of ranked.slice(1)) {
      if (!duplicate.record) {
        riskyChanges.push({
          id: duplicate.job.id,
          reason: "duplicate_public_job_missing_record",
          action: "skipped"
        });
        continue;
      }
      archiveActions.set(cleanText(duplicate.record.id), {
        reason: "duplicate_public_job",
        record: duplicate.record
      });
      duplicateIds.add(cleanText(duplicate.record.id));
    }
    checkedJobs.push({
      id: keeper.job.id,
      reason: "duplicate_group_keeper",
      action: "kept"
    });
  }

  const pageFiles = await fs.readdir(PAGES_DIR).catch(() => []);
  const pageFileSet = new Set(pageFiles.filter((file) => file.endsWith(".html")).map((file) => `./pages/${file}`));

  await processInBatches(publicJobs, async (job) => {
    const id = cleanText(job.id);
    const record = recordsById.get(id);
    if (!record) {
      riskyChanges.push({ id, reason: "missing_public_record", action: "skipped" });
      return;
    }
    if (archiveActions.has(id)) return;

    const status = cleanText(record.status).toLowerCase();
    const verificationStatus = cleanText(record.verification_status).toLowerCase();
    if (["archived", "closed", "removed"].includes(status) || ["removed", "expired"].includes(verificationStatus)) {
      archiveActions.set(id, { reason: "inactive_record_present_in_public", record });
      inactiveIds.add(id);
      return;
    }

    if (!hasCorePublicFields(job)) {
      archiveActions.set(id, { reason: "missing_core_public_fields", record });
      missingCoreIds.add(id);
      return;
    }

    const pageUrl = cleanText(job.page_url);
    if (!pageUrl || !pageFileSet.has(pageUrl)) {
      brokenPageIds.add(id);
    }

    const sourceUrl = cleanText(job.apply_url || job.original_url || job.source_url);
    if (!sourceUrl) {
      archiveActions.set(id, { reason: "missing_core_public_fields", record });
      missingCoreIds.add(id);
      return;
    }

    const page = await fetchLivePage(sourceUrl);
    if (page.error) {
      riskyChanges.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "network_error",
        detail: page.error.message,
        action: "skipped"
      });
      return;
    }

    const redirectToBoard = detectRedirectToBoard(sourceUrl, page.finalUrl, page.body);
    if (redirectToBoard && redirectToBoard.mode === "dead") {
      archiveActions.set(id, { reason: redirectToBoard.reason, record });
      deadLinkIds.add(id);
      return;
    }
    if (redirectToBoard && redirectToBoard.mode === "uncertain") {
      riskyChanges.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: redirectToBoard.reason,
        action: "skipped"
      });
      return;
    }

    const pageMode = detectPageMode(page, page.body, sourceUrl);
    if (pageMode.mode === "dead") {
      archiveActions.set(id, { reason: pageMode.reason, record });
      deadLinkIds.add(id);
      return;
    }
    if (pageMode.mode !== "live") {
      riskyChanges.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: pageMode.reason,
        action: "skipped"
      });
      return;
    }

    checkedJobs.push({
      id,
      title: job.title,
      organization: job.organization,
      reason: "verified_live",
      action: "kept"
    });
  }, FETCH_CONCURRENCY);

  const nextRecords = records.map((record) => {
    const action = archiveActions.get(cleanText(record.id));
    if (!action) return record;
    return annotateArchivedRecord(action.record, action.reason, cleanupRunAt);
  });

  const nextPublicJobs = buildPublicJobsFromRecords(nextRecords);
  const nextPublicIds = new Set(nextPublicJobs.map((job) => cleanText(job.id)));
  for (const pendingJob of pending) {
    const normalizedPending = normalizeJob(pendingJob);
    const pendingKey = buildDuplicateKey(normalizedPending);
    const overlapsPublic = pendingKey && publicJobs.some((job) => buildDuplicateKey(job) === pendingKey);
    if (overlapsPublic) {
      pendingDuplicates.push(cleanText(normalizedPending.id));
    }
  }

  const { map: expectedPageMap } = buildJobPagePathMap(nextPublicJobs);
  const expectedPageUrls = new Set(nextPublicJobs.map((job) => expectedPageMap.get(String(job.id || "")) || cleanText(job.page_url)));
  const cleanedPages = await deleteStalePages(expectedPageUrls, args);

  if (args.write) {
    await writeJsonIfChanged(JOB_RECORDS_FILE, nextRecords);
    await syncPublicJobsFromRecords(nextRecords, {
      label: "jobs:cleanup-stale",
      explainedRemovedIds: Array.from(archiveActions.keys())
    });
  }

  const validation = await buildValidationReport({
    records: nextRecords,
    jobs: args.write ? await readJobs() : nextPublicJobs,
    pending
  });

  const report = {
    generated_at: cleanupRunAt,
    mode: args.write ? "write" : "dry_run",
    before_public_count: publicJobs.length,
    after_cleanup_public_count: nextPublicJobs.length,
    published_record_count: publishedRecords.length,
    archived_record_count: archivedRecords.length,
    pending_count: pending.length,
    explained_removed_public_job_ids: Array.from(archiveActions.keys()),
    removed_public_job_ids: Array.from(archiveActions.keys()),
    counts: {
      checked: publicJobs.length,
      archived: archiveActions.size,
      skipped: riskyChanges.length,
      duplicates_removed: duplicateIds.size,
      dead_links_found: deadLinkIds.size,
      pages_cleaned: cleanedPages.length,
      risky_changes_skipped: riskyChanges.length,
      missing_core_archived: missingCoreIds.size,
      inactive_archived: inactiveIds.size,
      broken_page_url_found: brokenPageIds.size,
      pending_duplicates_detected: pendingDuplicates.length
    },
    diagnostics: {
      jobs_json_count: publicJobs.length,
      projected_public_count: nextPublicJobs.length,
      job_records_total: records.length,
      job_records_published: publishedRecords.length,
      job_records_archived: archivedRecords.length,
      pending_records: pending.length,
      pages_existing: pageFiles.filter((file) => file.endsWith(".html")).length,
      validation_missing_page_url_count: validation.missing_page_url_count,
      validation_stale_page_url_count: validation.stale_page_url_count,
      validation_duplicate_slug_count: validation.duplicate_slug_count,
      validation_pending_public_overlap_count: validation.pending_public_overlap_count
    },
    archived_jobs: Array.from(archiveActions.entries()).map(([id, action]) => ({
      id,
      title: action.record.display?.title || action.record.raw_source_data?.title || "",
      organization: action.record.display?.organization || action.record.raw_source_data?.organization || "",
      reason: action.reason
    })),
    risky_changes: riskyChanges,
    stale_pages_cleaned: cleanedPages,
    pending_duplicates: pendingDuplicates
  };

  const lines = [
    "# Cleanup Stale Jobs",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    "",
    `Previous public jobs count: ${report.before_public_count}`,
    `Projected public jobs count after cleanup: ${report.after_cleanup_public_count}`,
    `Archived stale/dead/duplicate jobs: ${report.counts.archived}`,
    `Dead links found: ${report.counts.dead_links_found}`,
    `Duplicate public jobs archived: ${report.counts.duplicates_removed}`,
    `Pages cleaned: ${report.counts.pages_cleaned}`,
    `Skipped risky changes: ${report.counts.risky_changes_skipped}`,
    "",
    "## Archived Jobs",
    ...report.archived_jobs.map((job) => `- ${job.id}: ${job.organization} | ${job.title} | ${job.reason}`),
    "",
    "## Risky Changes Skipped",
    ...report.risky_changes.map((change) => `- ${change.id}: ${change.reason}${change.detail ? ` (${change.detail})` : ""}`)
  ];

  await fs.mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_MD, `${lines.join("\n")}\n`, "utf8");

  console.log(`[jobs:cleanup-stale] checked=${report.counts.checked} archived=${report.counts.archived} skipped=${report.counts.skipped} duplicates_removed=${report.counts.duplicates_removed} dead_links_found=${report.counts.dead_links_found} pages_cleaned=${report.counts.pages_cleaned} risky_changes_skipped=${report.counts.risky_changes_skipped}`);
  console.log(`[jobs:cleanup-stale] before_public_count=${report.before_public_count} after_cleanup_public_count=${report.after_cleanup_public_count}`);
  console.log(`[jobs:cleanup-stale] report=${REPORT_JSON}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:cleanup-stale] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
