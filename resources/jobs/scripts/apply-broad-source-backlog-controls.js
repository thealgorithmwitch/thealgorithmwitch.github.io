const path = require("path");
const {
  PENDING_SYNCED_FILE,
  readPendingSyncedJobs,
  readSources,
  writeJson
} = require("./job-utils");
const { applySourcePendingControls, getSourceControlConfig } = require("./source-sync-quality");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "broad-source-backlog-maintenance.json");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringify(value) {
  return String(value || "").trim();
}

async function main() {
  const [pendingJobs, sources] = await Promise.all([
    readPendingSyncedJobs(),
    readSources()
  ]);

  const nextBySource = new Map();
  const results = [];

  for (const source of toArray(sources)) {
    const sourcePending = pendingJobs.filter((job) => stringify(job.source_id) === stringify(source.id));
    const config = getSourceControlConfig(source, { jobCount: sourcePending.length });
    if (!config.broadSourceControls || source.enabled === false) continue;
    const controlled = applySourcePendingControls(source, {
      incomingJobs: sourcePending,
      existingPendingJobs: sourcePending,
      assumeAllCurrent: true,
      nowIso: new Date().toISOString()
    });
    nextBySource.set(stringify(source.id), controlled.allJobs);
    results.push({
      source_id: stringify(source.id),
      organization: stringify(source.organization || source.name),
      pending_before: sourcePending.length,
      active_review_after: controlled.activeReviewJobs.length,
      backlog_after: controlled.backlogJobs.length,
      archived_after: controlled.archivedJobs.length,
      active_review_added: controlled.activeReviewAdded,
      backlog_added: controlled.backlogAdded,
      backlog_preserved: controlled.backlogPreserved,
      resurfaced_from_backlog: controlled.resurfacedFromBacklog,
      capped_existing: controlled.cappedExisting,
      capped_count: controlled.cappedCount,
      skipped_low_relevance_count: controlled.skippedLowRelevanceCount,
      examples_active: controlled.activeReviewJobs.slice(0, 3).map((job) => stringify(job.title)),
      examples_backlog: controlled.backlogJobs.slice(0, 3).map((job) => `${stringify(job.title)} [${stringify(job.skip_reason)}]`)
    });
  }

  const nextPending = [
    ...pendingJobs.filter((job) => !nextBySource.has(stringify(job.source_id))),
    ...Array.from(nextBySource.values()).flat()
  ];

  await writeJson(PENDING_SYNCED_FILE, nextPending);
  await writeJson(REPORT_FILE, {
    generated_at: new Date().toISOString(),
    pending_file: PENDING_SYNCED_FILE,
    results
  });

  console.log(JSON.stringify({
    updated_sources: results.map((item) => item.source_id),
    report: REPORT_FILE
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:apply-broad-source-backlog-controls] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
