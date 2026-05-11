const path = require("path");
const {
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  readSources,
  writeJson
} = require("./job-utils");
const { fetchAtsJobsByProvider, fetchGreenhouseJobsForSource } = require("./ats-clients");
const { normalizeJob } = require("./job-normalizer");
const { normalizeProvider, normalizeSource } = require("./source-utils");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");
const { applySourcePendingControls, buildSourceControlKey } = require("./source-sync-quality");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "targeted-pending-source-sync.json");
const ELIGIBLE_PROVIDERS = new Set(["greenhouse", "smartrecruiters"]);
const STRUCTURED_ADAPTER_GAP_PROVIDERS = new Set(["paylocity", "workday", "rippling", "teamtailor", "pinpoint"]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringify(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function buildDedupeCandidates(job = {}) {
  const title = stringify(job.title).toLowerCase();
  const organization = stringify(job.organization).toLowerCase();
  const applyUrl = stringify(job.apply_url || job.original_url || job.source_url).toLowerCase();
  const externalId = stringify(job.external_id).toLowerCase();
  const id = stringify(job.id).toLowerCase();
  const location = stringify(job.location).toLowerCase();
  const candidates = [
    id ? `id:${id}` : "",
    externalId ? `external:${externalId}` : "",
    title && organization && applyUrl ? `title_org_apply:${title}::${organization}::${applyUrl}` : "",
    title && organization && location ? `title_org_location:${title}::${organization}::${location}` : "",
    title && organization ? `title_org:${title}::${organization}` : ""
  ];
  return candidates.filter(Boolean);
}

function buildExistingKeySet(jobs) {
  const keys = new Set();
  for (const job of toArray(jobs)) {
    const normalized = normalizeJob(job);
    if (!normalized) continue;
    for (const key of buildDedupeCandidates(normalized)) {
      keys.add(key);
    }
  }
  return keys;
}

function markPendingOnly(job, source) {
  return normalizeJob({
    ...job,
    source_id: stringify(source.id),
    source_type: stringify(source.type),
    trusted: false,
    auto_publish: false,
    status: "pending",
    sync_origin: "ats_pending_only",
    pending_only_sync: true
  });
}

function selectTargetSources(sources, sourceHealth) {
  const previousById = new Map(
    toArray(sourceHealth.sources).map((entry) => [stringify(entry.source_id), stringify(entry.status)])
  );
  return toArray(sources)
    .map((source) => normalizeSource(source))
    .filter((source) => {
      const provider = normalizeProvider(source.provider || source.type || "");
      const previousStatus = previousById.get(stringify(source.id));
      const alreadyCompleted = previousStatus === "pending_updated" || previousStatus === "no_pending_changes";
      return source.enabled !== false
        && ELIGIBLE_PROVIDERS.has(provider)
        && !alreadyCompleted;
    })
    .sort((a, b) => stringify(a.id).localeCompare(stringify(b.id)));
}

function buildAdapterMissingEntry(source) {
  return {
    source_id: stringify(source.id),
    source_checked: false,
    status: "provider_adapter_missing",
    provider: normalizeProvider(source.provider || source.type || ""),
    jobs_found: 0,
    jobs_normalized: 0,
    jobs_added_to_pending: 0,
    duplicates_skipped: 0,
    pending_count_delta: 0,
    public_count_delta: 0,
    skip_reasons: ["provider_adapter_missing"],
    last_successful_sync: "",
    sync_duration_ms: 0,
    failure_error_count: 0
  };
}

function selectAdapterMissingSources(sources) {
  return toArray(sources)
    .map((source) => normalizeSource(source))
    .filter((source) => {
      const provider = normalizeProvider(source.provider || source.type || "");
      return source.enabled !== false && STRUCTURED_ADAPTER_GAP_PROVIDERS.has(provider);
    })
    .sort((a, b) => stringify(a.id).localeCompare(stringify(b.id)));
}

async function fetchForSource(source) {
  const provider = normalizeProvider(source.provider || source.type || "");
  if (provider === "greenhouse" && !source.provider) {
    return fetchGreenhouseJobsForSource(source);
  }
  return fetchAtsJobsByProvider(provider, source);
}

async function main() {
  const startedAt = Date.now();
  const [existingJobs, existingPending, sources, previousHealth] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources(),
    readSourceHealthSnapshot()
  ]);

  const pendingKeySet = buildExistingKeySet(existingPending);
  const publicKeySet = buildExistingKeySet(existingJobs);
  const targetSources = selectTargetSources(sources, previousHealth);
  const adapterMissingSources = selectAdapterMissingSources(sources);
  const sourceHealthEntries = [];
  const reportEntries = [];
  const nextPendingBySource = new Map();

  for (const source of adapterMissingSources) {
    const entry = buildAdapterMissingEntry(source);
    sourceHealthEntries.push(entry);
    reportEntries.push({
      source_id: stringify(source.id),
      organization: stringify(source.organization || source.name),
      provider: entry.provider,
      status: entry.status,
      jobs_found: 0,
      jobs_normalized: 0,
      jobs_added_to_pending: 0,
      duplicates_skipped: 0,
      skip_reasons: entry.skip_reasons
    });
    console.log(`[jobs:sync-targeted-pending-sources] source_id=${source.id} status=provider_adapter_missing provider=${entry.provider}`);
  }

  for (const source of targetSources) {
    const sourceStartedAt = Date.now();
    const provider = normalizeProvider(source.provider || source.type || "");
    let jobsFound = 0;
    let jobsNormalized = 0;
    let relevanceMatchedCount = 0;
    let activeReviewAdded = 0;
    let backlogAdded = 0;
    let backlogPreserved = 0;
    let resurfacedFromBacklog = 0;
    let staleBacklogArchived = 0;
    let repeatSurfacePreventedCount = 0;
    let cappedExisting = 0;
    let duplicatesSkipped = 0;
    let cappedCount = 0;
    let skippedLowRelevanceCount = 0;
    const skipReasons = [];

    try {
      const rawJobs = await fetchForSource(source);
      jobsFound = toArray(rawJobs).length;
      const existingSourcePending = existingPending.filter((job) => stringify(job.source_id) === stringify(source.id));
      const otherPendingKeys = buildExistingKeySet(
        existingPending.filter((job) => stringify(job.source_id) !== stringify(source.id))
      );

      const normalizedPendingJobs = [];
      for (const rawJob of toArray(rawJobs)) {
        const pendingJob = markPendingOnly(rawJob, source);
        if (!pendingJob) continue;
        const dedupeKeys = buildDedupeCandidates(pendingJob);
        const duplicateElsewhere = dedupeKeys.some((key) => otherPendingKeys.has(key) || publicKeySet.has(key));
        if (duplicateElsewhere) {
          duplicatesSkipped += 1;
          continue;
        }
        normalizedPendingJobs.push(pendingJob);
      }
      jobsNormalized = normalizedPendingJobs.length;
      const controlled = applySourcePendingControls(source, {
        incomingJobs: normalizedPendingJobs,
        existingPendingJobs: existingSourcePending,
        nowIso: nowIso()
      });
      relevanceMatchedCount = controlled.matchedCount;
      cappedCount = controlled.cappedCount;
      skippedLowRelevanceCount = controlled.skippedLowRelevanceCount;
      activeReviewAdded = controlled.activeReviewAdded;
      backlogAdded = controlled.backlogAdded;
      backlogPreserved = controlled.backlogPreserved;
      resurfacedFromBacklog = controlled.resurfacedFromBacklog;
      staleBacklogArchived = controlled.staleBacklogArchived;
      repeatSurfacePreventedCount = controlled.repeatSurfacePreventedCount;
      cappedExisting = controlled.cappedExisting;
      nextPendingBySource.set(stringify(source.id), controlled.allJobs);

      if (jobsFound === 0) {
        skipReasons.push("provider_returned_zero_jobs");
      }
      if (jobsNormalized === 0 && jobsFound > 0) {
        skipReasons.push("normalization_filtered_all_jobs");
      }
      if (skippedLowRelevanceCount > 0) {
        skipReasons.push("broad_source_low_relevance");
      }
      if (cappedCount > 0) {
        skipReasons.push("broad_source_capped");
      }
      if (duplicatesSkipped > 0 && activeReviewAdded === 0 && backlogAdded === 0 && jobsNormalized > 0) {
        skipReasons.push("all_jobs_already_present");
      }

      sourceHealthEntries.push({
        source_id: stringify(source.id),
        source_checked: true,
        status: activeReviewAdded > 0 || backlogAdded > 0 || resurfacedFromBacklog > 0 || staleBacklogArchived > 0
          ? "pending_updated"
          : "no_pending_changes",
        provider,
        jobs_found: jobsFound,
        jobs_normalized: jobsNormalized,
        relevance_matched_count: relevanceMatchedCount,
        active_review_added: activeReviewAdded,
        backlog_added: backlogAdded,
        backlog_preserved: backlogPreserved,
        resurfaced_from_backlog: resurfacedFromBacklog,
        stale_backlog_archived: staleBacklogArchived,
        repeat_surface_prevented_count: repeatSurfacePreventedCount,
        capped_existing: cappedExisting,
        jobs_added_to_pending: activeReviewAdded + backlogAdded,
        capped_count: cappedCount,
        skipped_low_relevance_count: skippedLowRelevanceCount,
        duplicates_skipped: duplicatesSkipped,
        pending_count_delta: activeReviewAdded + backlogAdded,
        public_count_delta: 0,
        skip_reasons: skipReasons,
        last_successful_sync: nowIso(),
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 0
      });
      reportEntries.push({
        source_id: stringify(source.id),
        organization: stringify(source.organization || source.name),
        provider,
        status: activeReviewAdded > 0 || backlogAdded > 0 || resurfacedFromBacklog > 0 || staleBacklogArchived > 0
          ? "pending_updated"
          : "no_pending_changes",
        jobs_found: jobsFound,
        jobs_normalized: jobsNormalized,
        relevance_matched_count: relevanceMatchedCount,
        active_review_added: activeReviewAdded,
        backlog_added: backlogAdded,
        backlog_preserved: backlogPreserved,
        resurfaced_from_backlog: resurfacedFromBacklog,
        stale_backlog_archived: staleBacklogArchived,
        repeat_surface_prevented_count: repeatSurfacePreventedCount,
        capped_existing: cappedExisting,
        jobs_added_to_pending: activeReviewAdded + backlogAdded,
        capped_count: cappedCount,
        skipped_low_relevance_count: skippedLowRelevanceCount,
        duplicates_skipped: duplicatesSkipped,
        skip_reasons: skipReasons
      });
      console.log(`[jobs:sync-targeted-pending-sources] source_id=${source.id} provider=${provider} jobs_found=${jobsFound} jobs_normalized=${jobsNormalized} relevance_matched_count=${relevanceMatchedCount} active_review_added=${activeReviewAdded} backlog_added=${backlogAdded} backlog_preserved=${backlogPreserved} resurfaced_from_backlog=${resurfacedFromBacklog} stale_backlog_archived=${staleBacklogArchived} repeat_surface_prevented_count=${repeatSurfacePreventedCount} capped_existing=${cappedExisting} capped_count=${cappedCount} skipped_low_relevance_count=${skippedLowRelevanceCount} duplicates_skipped=${duplicatesSkipped}${skipReasons.length ? ` skip_reasons=${skipReasons.join(",")}` : ""}`);
    } catch (error) {
      sourceHealthEntries.push({
        source_id: stringify(source.id),
        source_checked: true,
        status: "fetch_failed",
        provider,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_added_to_pending: 0,
        duplicates_skipped: 0,
        pending_count_delta: 0,
        public_count_delta: 0,
        skip_reasons: [stringify(error.message)],
        last_successful_sync: "",
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 1
      });
      reportEntries.push({
        source_id: stringify(source.id),
        organization: stringify(source.organization || source.name),
        provider,
        status: "fetch_failed",
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_added_to_pending: 0,
        duplicates_skipped: 0,
        skip_reasons: [stringify(error.message)]
      });
      console.error(`[jobs:sync-targeted-pending-sources] source_id=${source.id} provider=${provider} status=fetch_failed error=${error.message}`);
    }
  }

  const nextPending = [
    ...existingPending.filter((job) => !nextPendingBySource.has(stringify(job.source_id))),
    ...Array.from(nextPendingBySource.values()).flat()
  ];
  await writeJson(PENDING_SYNCED_FILE, nextPending);

  const previousHealthById = new Map(toArray(previousHealth.sources).map((entry) => [stringify(entry.source_id), entry]));
  const nextHealthById = new Map(previousHealthById);
  for (const entry of sourceHealthEntries) {
    const previous = previousHealthById.get(stringify(entry.source_id)) || {};
    nextHealthById.set(stringify(entry.source_id), {
      ...previous,
      ...entry,
      failure_error_count: Number(previous.failure_error_count || 0) + Number(entry.failure_error_count || 0)
    });
  }
  await writeSourceHealthSnapshot({
    generated_at: nowIso(),
    sync_type: "targeted-pending-sources",
    sources: Array.from(nextHealthById.values()).sort((a, b) => stringify(a.source_id).localeCompare(stringify(b.source_id)))
  });

  const summary = reportEntries.reduce((acc, entry) => {
    acc.sources_attempted += entry.status === "provider_adapter_missing" ? 0 : 1;
    acc.jobs_found += Number(entry.jobs_found || 0);
    acc.jobs_normalized += Number(entry.jobs_normalized || 0);
    acc.relevance_matched_count += Number(entry.relevance_matched_count || 0);
    acc.active_review_added += Number(entry.active_review_added || 0);
    acc.backlog_added += Number(entry.backlog_added || 0);
    acc.backlog_preserved += Number(entry.backlog_preserved || 0);
    acc.resurfaced_from_backlog += Number(entry.resurfaced_from_backlog || 0);
    acc.stale_backlog_archived += Number(entry.stale_backlog_archived || 0);
    acc.repeat_surface_prevented_count += Number(entry.repeat_surface_prevented_count || 0);
    acc.capped_existing += Number(entry.capped_existing || 0);
    acc.jobs_added_to_pending += Number(entry.jobs_added_to_pending || 0);
    acc.capped_count += Number(entry.capped_count || 0);
    acc.skipped_low_relevance_count += Number(entry.skipped_low_relevance_count || 0);
    acc.duplicates_skipped += Number(entry.duplicates_skipped || 0);
    toArray(entry.skip_reasons).forEach((reason) => {
      if (!reason) return;
      acc.skipped_reasons[reason] = Number(acc.skipped_reasons[reason] || 0) + 1;
    });
    return acc;
  }, {
    sources_attempted: 0,
    jobs_found: 0,
    jobs_normalized: 0,
    relevance_matched_count: 0,
    active_review_added: 0,
    backlog_added: 0,
    backlog_preserved: 0,
    resurfaced_from_backlog: 0,
    stale_backlog_archived: 0,
    repeat_surface_prevented_count: 0,
    capped_existing: 0,
    jobs_added_to_pending: 0,
    capped_count: 0,
    skipped_low_relevance_count: 0,
    duplicates_skipped: 0,
    skipped_reasons: {}
  });

  const report = {
    generated_at: nowIso(),
    sync_type: "targeted-pending-sources",
    duration_ms: Date.now() - startedAt,
    pending_file: PENDING_SYNCED_FILE,
    source_health_written: true,
    target_source_ids: targetSources.map((source) => stringify(source.id)),
    adapter_gap_source_ids: adapterMissingSources.map((source) => stringify(source.id)),
    summary,
    results: reportEntries
  };
  await writeJson(REPORT_FILE, report);

  console.log(`[jobs:sync-targeted-pending-sources] sources_attempted=${summary.sources_attempted} jobs_found=${summary.jobs_found} jobs_normalized=${summary.jobs_normalized} relevance_matched_count=${summary.relevance_matched_count} active_review_added=${summary.active_review_added} backlog_added=${summary.backlog_added} backlog_preserved=${summary.backlog_preserved} resurfaced_from_backlog=${summary.resurfaced_from_backlog} stale_backlog_archived=${summary.stale_backlog_archived} repeat_surface_prevented_count=${summary.repeat_surface_prevented_count} capped_existing=${summary.capped_existing} jobs_added_to_pending=${summary.jobs_added_to_pending} capped_count=${summary.capped_count} skipped_low_relevance_count=${summary.skipped_low_relevance_count} duplicates_skipped=${summary.duplicates_skipped} duration_ms=${Date.now() - startedAt}`);
  Object.entries(summary.skipped_reasons).forEach(([reason, count]) => {
    console.log(`[jobs:sync-targeted-pending-sources] skipped_reason reason=${reason} count=${count}`);
  });
  console.log(`[jobs:sync-targeted-pending-sources] pending_written=${PENDING_SYNCED_FILE}`);
  console.log(`[jobs:sync-targeted-pending-sources] report=${REPORT_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:sync-targeted-pending-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
