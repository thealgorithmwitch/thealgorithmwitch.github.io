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
const { filterBlockedSourceEntries, getBlockedSourceRuleForEntry } = require("./blocked-source-utils");
const { guardIncoming, loadArchiveRecords } = require("./archive-fingerprint-guard");
const { normalizeProvider, normalizeSource } = require("./source-utils");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");
const { applySourcePendingControls, buildSourceControlKey } = require("./source-sync-quality");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "targeted-pending-source-sync.json");
const ELIGIBLE_PROVIDERS = new Set(["greenhouse", "smartrecruiters", "paylocity", "lever", "ashby", "bamboohr", "workable", "recruitee", "rippling", "careerpuck", "trakstar", "taleo"]);
const STRUCTURED_ADAPTER_GAP_PROVIDERS = new Set(["workday", "teamtailor", "pinpoint"]);
const REMOVED_PENDING_SOURCE_PATTERN = /articulate|empowerly|remofirst|recidiviz|cribl|found|canonicaljobs|canonical|cohere|chilipiper|beehiiv|posthog|automattic|superside|samsara|gusto/i;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringify(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function isDeprecatedPendingSourceJob(job = {}) {
  const descriptor = [
    stringify(job.source_id),
    stringify(job.source_name),
    stringify(job.source),
    stringify(job.provider),
    stringify(job.source_url),
    stringify(job.apply_url)
  ]
    .filter(Boolean)
    .join(" ");
  return REMOVED_PENDING_SOURCE_PATTERN.test(descriptor);
}

function isDeprecatedSourceHealthEntry(entry = {}) {
  return REMOVED_PENDING_SOURCE_PATTERN.test(
    [
      stringify(entry.source_id),
      stringify(entry.provider),
      stringify(entry.organization),
      stringify(entry.source_name)
    ]
      .filter(Boolean)
      .join(" ")
  );
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

function isStructuredSyncDisabled(source = {}) {
  const provider = normalizeProvider(source.provider || source.type || "");
  if (source.enabled === false) return true;
  if (source.custom_sync_enabled !== false) return false;
  return provider === "rippling" || STRUCTURED_ADAPTER_GAP_PROVIDERS.has(provider);
}

function selectTargetSources(sources, sourceHealth) {
  return toArray(sources)
    .map((source) => normalizeSource(source))
    .filter((source) => {
      const provider = normalizeProvider(source.provider || source.type || "");
      if (source.enabled === false || !ELIGIBLE_PROVIDERS.has(provider)) return false;
      if (isStructuredSyncDisabled(source)) return false;
      if (getBlockedSourceRuleForEntry(source)) return false;
      return true;
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
      return source.enabled !== false
        && !isStructuredSyncDisabled(source)
        && STRUCTURED_ADAPTER_GAP_PROVIDERS.has(provider)
        && !getBlockedSourceRuleForEntry(source);
    })
    .sort((a, b) => stringify(a.id).localeCompare(stringify(b.id)));
}

function selectSyncDisabledSources(sources) {
  return toArray(sources)
    .map((source) => normalizeSource(source))
    .filter((source) => isStructuredSyncDisabled(source) && !getBlockedSourceRuleForEntry(source))
    .sort((a, b) => stringify(a.id).localeCompare(stringify(b.id)));
}

function buildSyncDisabledEntry(source) {
  return {
    source_id: stringify(source.id),
    source_checked: false,
    status: "sync_disabled",
    provider: normalizeProvider(source.provider || source.type || ""),
    jobs_found: 0,
    jobs_normalized: 0,
    jobs_added_to_pending: 0,
    duplicates_skipped: 0,
    pending_count_delta: 0,
    public_count_delta: 0,
    skip_reasons: ["custom_sync_disabled"],
    last_successful_sync: "",
    sync_duration_ms: 0,
    failure_error_count: 0,
    active_failure: false
  };
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

  const cleanedExistingPending = existingPending.filter((job) => !isDeprecatedPendingSourceJob(job));
  const removedDeprecatedPendingCount = existingPending.length - cleanedExistingPending.length;
  const pendingKeySet = buildExistingKeySet(cleanedExistingPending);
  const publicKeySet = buildExistingKeySet(existingJobs);
  const targetSources = selectTargetSources(sources, previousHealth);
  const adapterMissingSources = selectAdapterMissingSources(sources);
  const syncDisabledSources = selectSyncDisabledSources(sources);
  const sourceHealthEntries = [];
  const reportEntries = [];
  const nextPendingBySource = new Map();
  const archiveGuardRecords = loadArchiveRecords();
  let archiveBlockedTotal = 0;

  for (const source of syncDisabledSources) {
    const entry = buildSyncDisabledEntry(source);
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
    console.log(`[jobs:sync-targeted-pending-sources] source_id=${source.id} status=sync_disabled provider=${entry.provider}`);
  }

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
      const existingSourcePending = cleanedExistingPending.filter((job) => stringify(job.source_id) === stringify(source.id));
      const otherPendingKeys = buildExistingKeySet(
        cleanedExistingPending.filter((job) => stringify(job.source_id) !== stringify(source.id))
      );

      const normalizedPendingJobs = [];
      for (const rawJob of toArray(rawJobs)) {
        const pendingJob = markPendingOnly(rawJob, source);
        if (!pendingJob) continue;
        if (getBlockedSourceRuleForEntry(pendingJob)) {
          duplicatesSkipped += 1;
          continue;
        }
        const guarded = guardIncoming([pendingJob], archiveGuardRecords);
        if (guarded.blocked.length) {
          const b = guarded.blocked[0];
          console.log(`[jobs:sync-targeted-pending-sources] ${source.id}: Skipping archived/rejected job "${pendingJob.title}" (matched ${b.matched_archive_id}: ${b.matched_archive_status})`);
          archiveBlockedTotal++;
          continue;
        }
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
        failure_error_count: 0,
        active_failure: false
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
        failure_error_count: 1,
        active_failure: true
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
    ...cleanedExistingPending.filter((job) => !nextPendingBySource.has(stringify(job.source_id))),
    ...Array.from(nextPendingBySource.values()).flat()
  ];
  await writeJson(PENDING_SYNCED_FILE, filterBlockedSourceEntries(nextPending));

  const previousHealthById = new Map(
    toArray(previousHealth.sources)
      .filter((entry) => !isDeprecatedSourceHealthEntry(entry))
      .map((entry) => [stringify(entry.source_id), entry])
  );
  const nextHealthById = new Map(previousHealthById);
  for (const entry of sourceHealthEntries) {
    const previous = previousHealthById.get(stringify(entry.source_id)) || {};
    nextHealthById.set(stringify(entry.source_id), {
      ...previous,
      ...entry,
      failure_error_count: entry.status === "sync_disabled"
        ? 0
        : Number(previous.failure_error_count || 0) + Number(entry.failure_error_count || 0)
    });
  }
  await writeSourceHealthSnapshot({
    generated_at: nowIso(),
    sync_type: "targeted-pending-sources",
    sources: Array.from(nextHealthById.values()).sort((a, b) => stringify(a.source_id).localeCompare(stringify(b.source_id)))
  });

  const summary = reportEntries.reduce((acc, entry) => {
    acc.sources_attempted += entry.status === "provider_adapter_missing" || entry.status === "sync_disabled" ? 0 : 1;
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
    deprecated_pending_entries_removed: removedDeprecatedPendingCount,
    skipped_reasons: {}
  });

  const report = {
    generated_at: nowIso(),
    sync_type: "targeted-pending-sources",
    duration_ms: Date.now() - startedAt,
    pending_file: PENDING_SYNCED_FILE,
    source_health_written: true,
    deprecated_pending_entries_removed: removedDeprecatedPendingCount,
    target_source_ids: targetSources.map((source) => stringify(source.id)),
    adapter_gap_source_ids: adapterMissingSources.map((source) => stringify(source.id)),
    summary,
    results: reportEntries
  };
  await writeJson(REPORT_FILE, report);

  console.log(`[jobs:sync-targeted-pending-sources] sources_attempted=${summary.sources_attempted} jobs_found=${summary.jobs_found} jobs_normalized=${summary.jobs_normalized} relevance_matched_count=${summary.relevance_matched_count} active_review_added=${summary.active_review_added} backlog_added=${summary.backlog_added} backlog_preserved=${summary.backlog_preserved} resurfaced_from_backlog=${summary.resurfaced_from_backlog} stale_backlog_archived=${summary.stale_backlog_archived} repeat_surface_prevented_count=${summary.repeat_surface_prevented_count} capped_existing=${summary.capped_existing} jobs_added_to_pending=${summary.jobs_added_to_pending} capped_count=${summary.capped_count} skipped_low_relevance_count=${summary.skipped_low_relevance_count} duplicates_skipped=${summary.duplicates_skipped} archive_blocked=${archiveBlockedTotal} deprecated_pending_entries_removed=${removedDeprecatedPendingCount} duration_ms=${Date.now() - startedAt}`);
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
