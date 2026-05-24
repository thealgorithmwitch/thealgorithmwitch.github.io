const fs = require("fs/promises");
const path = require("path");
const { readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords, JOB_RECORDS_FILE } = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { readSourceHealthSnapshot } = require("./source-health-store");
const {
  REPORT_FILE,
  auditOctopusState,
  reconcileOctopusRecords
} = require("./octopus-source-reconciliation");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");

async function main() {
  const [records, jobs, pending, sourceHealth, sources, pageFiles] = await Promise.all([
    readJobRecords(),
    readJobs(),
    readPendingSyncedJobs(),
    readSourceHealthSnapshot(),
    readSources(),
    fs.readdir(PAGES_DIR).catch(() => [])
  ]);

  const beforeAudit = auditOctopusState({ records, jobs, pending, sourceHealth, pageFiles });
  const reconciliation = reconcileOctopusRecords(records, beforeAudit, { now: new Date() });

  if (reconciliation.archivedIds.length) {
    await fs.mkdir(path.dirname(JOB_RECORDS_FILE), { recursive: true });
    await fs.writeFile(JOB_RECORDS_FILE, `${JSON.stringify(reconciliation.records, null, 2)}\n`, "utf8");
  }

  const publicSync = await syncPublicJobsFromRecords(reconciliation.records, {
    label: "jobs:cleanup-octopus"
  });
  const refreshedJobs = publicSync.publicJobs;
  const afterAudit = auditOctopusState({
    records: reconciliation.records,
    jobs: refreshedJobs,
    pending,
    sourceHealth,
    pageFiles
  });

  const report = {
    generated_at: new Date().toISOString(),
    source_id: "octopus-energy",
    source_snapshot_authoritative: beforeAudit.snapshot.authoritative,
    source_snapshot_job_count: beforeAudit.snapshot.jobs.length,
    source_health_entry: beforeAudit.snapshot.health_entry,
    before_public_count: beforeAudit.octopusPublicJobs.length,
    after_public_count: afterAudit.octopusPublicJobs.length,
    published_record_count_before: beforeAudit.octopusPublishedRecords.length,
    pending_record_count: beforeAudit.octopusPending.length,
    generated_page_count_before: beforeAudit.stalePageCandidates.length,
    retained_ids: reconciliation.retainedIds,
    archived_ids: reconciliation.archivedIds,
    duplicate_groups: reconciliation.duplicateGroups,
    records_missing_last_seen_at: beforeAudit.publicAuditItems.filter((item) => item.missing_last_seen_at).map((item) => item.id),
    records_missing_source_id_or_source_key: beforeAudit.publicAuditItems.filter((item) => item.missing_source_ref).map((item) => item.id),
    records_not_present_in_latest_source_result: reconciliation.missingFromSourceIds,
    generated_page_cleanup_results: {
      stale_pages_marked_for_removal: beforeAudit.stalePageCandidates,
      stale_pages_marked_count: beforeAudit.stalePageCandidates.length
    },
    active_sources_checked: sources
      .filter((source) => String(source.id || "") === "octopus-energy")
      .map((source) => ({
        id: source.id,
        type: source.type,
        provider: source.provider,
        parser_enabled: source.parser_enabled,
        custom_sync_enabled: source.custom_sync_enabled,
        source_url: source.source_url
      }))
  };

  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[jobs:cleanup-octopus] before_public_count=${report.before_public_count} after_public_count=${report.after_public_count} archived=${report.archived_ids.length} retained=${report.retained_ids.length}`);
  console.log(`[jobs:cleanup-octopus] report=${REPORT_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:cleanup-octopus] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
