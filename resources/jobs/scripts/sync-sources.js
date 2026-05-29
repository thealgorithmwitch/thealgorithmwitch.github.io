const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  readSources,
  safeWritePublicJobs,
  writeJson
} = require("./job-utils");
const { dedupeJobs, getParserCleanupStats, resetParserCleanupStats, routeSyncedJob } = require("./job-normalizer");
const { isBlockedSourceEntry } = require("./blocked-source-utils");
const { guardIncoming, loadArchiveRecords } = require("./archive-fingerprint-guard");
const { attachPublicJobPageUrls } = require("./public-jobs");
const {
  fetchAshbyJobsForSource,
  fetchAtsJobsByProvider,
  fetchBambooHrJobsForSource,
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  fetchRecruiteeJobsForSource,
  fetchCareerPuckJobsForSource,
  fetchTrakstarJobsForSource
} = require("./ats-clients");
const { syncJobRecordStore } = require("./public-records");
const { upsertScrapeReports } = require("./scrape-report");
const { isDirectAtsSource, normalizeSource } = require("./source-utils");
const { triagePendingJobs } = require("./pending-triage");
const { mergeSourceHealthSnapshots, readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");
const { applySourcePendingControls } = require("./source-sync-quality");

const SUPPORTED_TYPES = new Set(["greenhouse", "lever", "ashby", "bamboohr", "recruitee", "smartrecruiters", "workable", "careerpuck", "trakstar", "taleo"]);

function computeSourceStatus(entry = {}) {
  if (Number(entry.failed_sync_count || entry.failure_error_count || 0) > 0) return "sync_error";
  if (Number(entry.jobs_found || 0) > 0 || Number(entry.jobs_normalized || 0) > 0) return "live";
  if (Number(entry.jobs_skipped || 0) > 0) return "needs_review";
  return "stale";
}

function computeSourceFreshnessScore(entry = {}) {
  let score = 100;
  score -= Math.min(45, Number(entry.failed_sync_count || entry.failure_error_count || 0) * 20);
  if (Number(entry.jobs_found || 0) === 0) score -= 20;
  if (Array.isArray(entry.skip_reasons) && entry.skip_reasons.length) score -= Math.min(20, entry.skip_reasons.length * 4);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isManagedAtsJob(job, activeSourceIds) {
  return job.sync_origin === "ats" && activeSourceIds.has(String(job.source_id || ""));
}

function countManagedPendingBySource(existingPending = []) {
  const counts = new Map();
  for (const job of Array.isArray(existingPending) ? existingPending : []) {
    if (job.sync_origin !== "ats") continue;
    const sourceId = String(job.source_id || "");
    if (!sourceId) continue;
    counts.set(sourceId, Number(counts.get(sourceId) || 0) + 1);
  }
  return counts;
}

async function fetchJobsForSource(source) {
  if (source.provider === "greenhouse" || source.type === "greenhouse") {
    return fetchGreenhouseJobsForSource(source);
  }
  if (source.provider === "lever" || source.type === "lever") {
    return fetchLeverJobsForSource(source);
  }
  if (source.provider === "ashby" || source.type === "ashby") {
    return fetchAshbyJobsForSource(source);
  }
  if (source.provider === "bamboohr" || source.type === "bamboohr") {
    return fetchBambooHrJobsForSource(source);
  }
  if (source.provider === "recruitee" || source.type === "recruitee") {
    return fetchRecruiteeJobsForSource(source);
  }
  if (source.provider) {
    return fetchAtsJobsByProvider(source.provider, source);
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

function describeRouting(source) {
  if (source.trusted === true && source.auto_publish === true) {
    return "public";
  }
  return "pending";
}

async function runSyncForTypes(types = []) {
  const syncStartedAt = Date.now();
  resetParserCleanupStats();
  const requestedTypes = types.length ? new Set(types) : null;
  const [existingJobs, existingPending, sources] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources()
  ]);

  const enabledSources = sources.filter((source) => {
    const normalized = normalizeSource(source);
    return normalized.enabled && isDirectAtsSource(normalized) && (!requestedTypes || requestedTypes.has(normalized.provider || normalized.type));
  });

  if (!enabledSources.length) {
    console.log(
      `[jobs:sync-sources] No enabled sources for ${requestedTypes ? Array.from(requestedTypes).join(", ") : "configured source types"}.`
    );
    return {
      publicJobs: existingJobs,
      pendingJobs: existingPending,
      counts: {}
    };
  }

  const activeSourceIds = new Set(enabledSources.map((source) => source.id));
  const preservedPublicJobs = existingJobs.filter((job) => !isManagedAtsJob(job, activeSourceIds));
  const managedExistingPendingJobs = existingPending.filter((job) => isManagedAtsJob(job, activeSourceIds));
  const preservedPendingJobs = existingPending
    .filter((job) => !isManagedAtsJob(job, activeSourceIds))
    .map((job) => ({ ...job, __pending_preserved: true }));
  const managedPendingCounts = countManagedPendingBySource(existingPending);
  const unavailableSourceIds = new Set();
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};
  const scrapeReports = [];
  const sourceHealthEntries = [];
  const archiveGuardRecords = loadArchiveRecords();
  let archiveBlockedCount = 0;

  for (const source of enabledSources) {
    const normalizedSource = normalizeSource(source);
    const sourceStartedAt = Date.now();
    const provider = normalizedSource.provider || normalizedSource.type;
    if (!SUPPORTED_TYPES.has(provider)) {
      counts[source.id] = {
        fetched: 0,
        active: 0,
        pending: 0,
        skipped: true,
        reason: "unsupported direct ATS provider"
      };
      scrapeReports.push({
        source_id: source.id,
        source_name: source.organization,
        source_url: source.source_url,
        detected_ats_provider: provider,
        parser_used: "",
        pages_checked: [{ url: source.source_url, depth: 0, status: "skipped" }],
        links_discovered: [],
        job_links_found: [],
        jobs_parsed: 0,
        reason_for_zero_results: "Unsupported direct ATS provider",
        browser_fallback_recommended: false
      });
      console.log(`[jobs:sync-sources] ${source.id}: Skipped: unsupported direct ATS provider.`);
      sourceHealthEntries.push({
        source_id: source.id,
        source_name: normalizedSource.organization,
        source_url: normalizedSource.source_url,
        ats_provider: normalizedSource.ats_provider,
        parser_type: normalizedSource.parser_type,
        source_classification: normalizedSource.source_classification,
        source_confidence: normalizedSource.source_confidence_tier,
        source_checked: true,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_skipped: 0,
        skip_reasons: ["unsupported direct ATS provider"],
        pending_count_delta: 0,
        public_count_delta: 0,
        last_checked_at: new Date().toISOString(),
        last_seen_at: "",
        last_successful_sync: "",
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 0,
        failed_sync_count: 0
      });
      continue;
    }

    try {
      const rawJobs = await fetchJobsForSource(source);
      const preservedPendingCount = Number(managedPendingCounts.get(String(source.id || "")) || 0);
      counts[source.id] = {
        fetched: rawJobs.length,
        active: 0,
        pending: 0,
        route: describeRouting(source),
        provider
      };
      scrapeReports.push({
        source_id: source.id,
        source_name: source.organization,
        source_url: source.source_url,
        detected_ats_provider: provider,
        parser_used: `ats:${provider}`,
        pages_checked: [{ url: source.api_url || source.source_url, depth: 0, status: "200" }],
        links_discovered: [],
        job_links_found: rawJobs.map((job) => job.apply_url).filter(Boolean).slice(0, 100),
        jobs_parsed: rawJobs.length,
        reason_for_zero_results: rawJobs.length ? "" : "ATS provider returned zero jobs.",
        browser_fallback_recommended: false
      });

      for (const rawJob of rawJobs) {
        if (isBlockedSourceEntry(rawJob)) {
          console.log(`[jobs:sync-sources] ${source.id}: Skipping blocked source job`);
          continue;
        }
        const guarded = guardIncoming([rawJob], archiveGuardRecords);
        if (guarded.blocked.length) {
          const b = guarded.blocked[0];
          console.log(`[jobs:sync-sources] ${source.id}: Skipping archived/rejected job "${rawJob.title}" (matched ${b.matched_archive_id}: ${b.matched_archive_status})`);
          archiveBlockedCount++;
          continue;
        }
        const routed = routeSyncedJob(rawJob, source);
        if (!routed) continue;
        if (routed.status === "active") {
          publicJobs.push(routed);
          counts[source.id].active += 1;
        } else {
          pendingJobs.push({ ...routed, __pending_new: true });
        }
      }
      const sourcePendingJobs = pendingJobs.filter((job) => String(job.source_id || "") === String(source.id));
      const preservedPendingJobsForOtherSources = pendingJobs.filter((job) => String(job.source_id || "") !== String(source.id));
      const existingSourcePending = managedExistingPendingJobs.filter((job) => String(job.source_id || "") === String(source.id));
      const controlledPending = applySourcePendingControls(source, {
        incomingJobs: sourcePendingJobs,
        existingPendingJobs: existingSourcePending,
        nowIso: new Date().toISOString()
      });
      pendingJobs.length = 0;
      preservedPendingJobsForOtherSources.forEach((job) => pendingJobs.push(job));
      controlledPending.allJobs.forEach((job) => pendingJobs.push(job));
      counts[source.id].pending = controlledPending.activeReviewJobs.length;
      counts[source.id].relevance_matched = controlledPending.matchedCount;
      counts[source.id].active_review_added = controlledPending.activeReviewAdded;
      counts[source.id].backlog_added = controlledPending.backlogAdded;
      counts[source.id].backlog_preserved = controlledPending.backlogPreserved;
      counts[source.id].resurfaced_from_backlog = controlledPending.resurfacedFromBacklog;
      counts[source.id].stale_backlog_archived = controlledPending.staleBacklogArchived;
      counts[source.id].repeat_surface_prevented_count = controlledPending.repeatSurfacePreventedCount;
      counts[source.id].capped_existing = controlledPending.cappedExisting;
      counts[source.id].capped = controlledPending.cappedCount;
      counts[source.id].skipped_low_relevance = controlledPending.skippedLowRelevanceCount;
      sourceHealthEntries.push({
        source_id: source.id,
        source_name: normalizedSource.organization,
        source_url: normalizedSource.source_url,
        ats_provider: normalizedSource.ats_provider,
        parser_type: normalizedSource.parser_type,
        source_classification: normalizedSource.source_classification,
        source_confidence: normalizedSource.source_confidence_tier,
        source_checked: true,
        jobs_found: rawJobs.length,
        jobs_normalized: counts[source.id].active + sourcePendingJobs.length,
        relevance_matched_count: counts[source.id].relevance_matched || counts[source.id].pending,
        active_review_added: controlledPending.activeReviewAdded,
        backlog_added: controlledPending.backlogAdded,
        backlog_preserved: controlledPending.backlogPreserved,
        resurfaced_from_backlog: controlledPending.resurfacedFromBacklog,
        stale_backlog_archived: controlledPending.staleBacklogArchived,
        repeat_surface_prevented_count: controlledPending.repeatSurfacePreventedCount,
        capped_existing: controlledPending.cappedExisting,
        jobs_skipped: Math.max(0, rawJobs.length - (counts[source.id].active + counts[source.id].pending)),
        skip_reasons: [],
        pending_count_delta: controlledPending.activeReviewAdded + controlledPending.backlogAdded,
        public_count_delta: counts[source.id].active,
        capped_count: counts[source.id].capped || 0,
        skipped_low_relevance_count: counts[source.id].skipped_low_relevance || 0,
        last_checked_at: new Date().toISOString(),
        last_seen_at: rawJobs.length ? new Date().toISOString() : "",
        last_successful_sync: new Date().toISOString(),
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 0,
        failed_sync_count: 0,
        source_temporarily_unavailable: false,
        fallback_used: false,
        fallback_reason: "",
        preserved_pending_count: preservedPendingCount
      });
    } catch (error) {
      const preservedPendingCount = Number(managedPendingCounts.get(String(source.id || "")) || 0);
      unavailableSourceIds.add(String(source.id || ""));
      counts[source.id] = { fetched: 0, active: 0, pending: 0, error: error.message };
      const attemptedUrl =
        provider === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board_token || "")}/jobs?content=true`
          : provider === "lever"
            ? `https://api.lever.co/v0/postings/${encodeURIComponent(source.company_slug || "")}?mode=json`
            : provider === "ashby"
              ? String(source.api_url || "https://jobs.ashbyhq.com/api/non-user-graphql?op=apiJobBoardWithTeams")
              : provider === "bamboohr"
                ? String(source.api_url || source.source_url || "")
                : provider === "recruitee"
                  ? String(source.api_url || `https://${source.company_slug || ""}.recruitee.com/api/offers/`)
                  : String(source.api_url || source.source_url || "");
      scrapeReports.push({
        source_id: source.id,
        source_name: source.organization,
        source_url: source.source_url,
        detected_ats_provider: provider,
        parser_used: `ats:${provider}`,
        pages_checked: [{ url: attemptedUrl, depth: 0, status: "error", error: error.message }],
        links_discovered: [],
        job_links_found: [],
        jobs_parsed: 0,
        reason_for_zero_results: error.message,
        browser_fallback_recommended: false,
        source_temporarily_unavailable: true,
        fallback_used: preservedPendingCount > 0,
        fallback_reason: preservedPendingCount > 0
          ? `Preserved ${preservedPendingCount} existing pending jobs because the source failed during fetch.`
          : "",
        errors: [error.message]
      });
      console.error(
        `[jobs:sync-sources] source_id=${source.id} source_type=${provider} url=${attemptedUrl} failure=${error.message}`
      );
      sourceHealthEntries.push({
        source_id: source.id,
        source_name: normalizedSource.organization,
        source_url: normalizedSource.source_url,
        ats_provider: normalizedSource.ats_provider,
        parser_type: normalizedSource.parser_type,
        source_classification: normalizedSource.source_classification,
        source_confidence: normalizedSource.source_confidence_tier,
        source_checked: true,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_skipped: 0,
        skip_reasons: [error.message],
        pending_count_delta: preservedPendingCount,
        public_count_delta: 0,
        last_checked_at: new Date().toISOString(),
        last_seen_at: "",
        last_successful_sync: "",
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 1,
        failed_sync_count: 1,
        source_temporarily_unavailable: true,
        fallback_used: preservedPendingCount > 0,
        fallback_reason: preservedPendingCount > 0
          ? `Preserved ${preservedPendingCount} existing pending jobs because the source failed during fetch.`
          : "",
        preserved_pending_count: preservedPendingCount
      });
    }
  }

  for (const job of managedExistingPendingJobs) {
    if (unavailableSourceIds.has(String(job.source_id || ""))) {
      pendingJobs.push({ ...job, __pending_preserved: true });
    }
  }

  const mergedPublicJobs = attachPublicJobPageUrls(dedupeJobs([...preservedPublicJobs, ...publicJobs]));
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await syncJobRecordStore(publicWriteResult.jobs, {
    logger: console,
    label: "jobs:sync-sources",
    context: "source_sync",
    preserveMissingPublishedRecords: true
  });
  const scrapeReportPayload = await upsertScrapeReports(scrapeReports);
  const triaged = await triagePendingJobs(mergedPendingJobs, publicWriteResult.jobs, scrapeReportPayload);
  const finalPublicJobs = attachPublicJobPageUrls(dedupeJobs([...publicWriteResult.jobs, ...(triaged.autoPublishedJobs || [])]));
  const finalPublicWriteResult = await safeWritePublicJobs(finalPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await syncJobRecordStore(finalPublicWriteResult.jobs, {
    logger: console,
    label: "jobs:sync-sources",
    context: "source_sync",
    preserveMissingPublishedRecords: true
  });
  await writeJson(PENDING_SYNCED_FILE, triaged.adminPendingJobs);
  await upsertScrapeReports(triaged.report.sources);

  const triageBySource = new Map(
    ((triaged.report && Array.isArray(triaged.report.sources)) ? triaged.report.sources : []).map((source) => [String(source.source_id || ""), source])
  );

  Object.entries(counts).forEach(([sourceId, count]) => {
    const triageSource = triageBySource.get(String(sourceId)) || {};
    const healthEntry = sourceHealthEntries.find((entry) => String(entry.source_id) === String(sourceId));
    if (healthEntry) {
      const skipReasons = Array.isArray(triageSource.rejected_examples)
        ? Array.from(new Set(triageSource.rejected_examples.map((item) => String(item.reason || "").trim()).filter(Boolean)))
        : [];
      healthEntry.jobs_skipped += Number(triageSource.rejected_by_relevance || 0) + Number(triageSource.rejected_noise || 0) + Number(triageSource.dropped_by_source_cap || triageSource.dropped_by_cap || 0);
      healthEntry.skip_reasons = Array.from(new Set([...(healthEntry.skip_reasons || []), ...skipReasons])).slice(0, 12);
      healthEntry.pending_count_delta = Number(triageSource.retained || triageSource.kept || healthEntry.pending_count_delta || 0);
      healthEntry.public_count_delta = Number(count.active || 0) + Number(triageSource.auto_published || 0);
      healthEntry.duplicates = Number(triageSource.duplicates || 0);
      healthEntry.low_confidence_routed_to_pending = Number(triageSource.low_confidence_routed_to_pending || 0);
      healthEntry.skip_reason_counts = triageSource.rejected_reasons || {};
      if (Number(count.skipped_low_relevance || 0) > 0) {
        healthEntry.skip_reasons = Array.from(new Set([...(healthEntry.skip_reasons || []), "broad_source_low_relevance"]));
      }
      if (Number(count.capped || 0) > 0) {
        healthEntry.skip_reasons = Array.from(new Set([...(healthEntry.skip_reasons || []), "broad_source_capped"]));
      }
    }
    console.log(
      `[jobs:sync-sources] source_id=${sourceId} fetched=${count.fetched} active=${count.active} pending=${count.pending} relevance_matched=${count.relevance_matched || count.pending || 0} active_review_added=${count.active_review_added || 0} backlog_added=${count.backlog_added || 0} backlog_preserved=${count.backlog_preserved || 0} resurfaced_from_backlog=${count.resurfaced_from_backlog || 0} stale_backlog_archived=${count.stale_backlog_archived || 0} repeat_surface_prevented_count=${count.repeat_surface_prevented_count || 0} capped_existing=${count.capped_existing || 0} capped=${count.capped || 0} skipped_low_relevance=${count.skipped_low_relevance || 0} retained=${triageSource.retained || triageSource.kept || 0} rejected_by_relevance=${triageSource.rejected_by_relevance || 0} rejected_noise=${triageSource.rejected_noise || 0} dropped_by_source_cap=${triageSource.dropped_by_source_cap || triageSource.dropped_by_cap || 0}${count.route ? ` route=${count.route}` : ""}${count.reason ? ` reason=${count.reason}` : ""}${count.error ? ` error=${count.error}` : ""}${triageSource.top_retained_examples?.length ? ` top_retained=${triageSource.top_retained_examples.map((item) => `${item.title} @ ${item.organization} (${item.relevance_score})`).join(" | ")}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-sources] Wrote ${finalPublicWriteResult.jobs.length} public jobs to ${JOBS_FILE}, ${triaged.adminPendingJobs.length} admin-pending jobs to ${PENDING_SYNCED_FILE}, auto_published=${triaged.summary.auto_published || 0}, rejected ${triaged.summary.rejected_noise} as noise, dropped_by_cap=${triaged.summary.dropped_by_cap_total}, final_pending_size_mb=${triaged.summary.final_pending_file_size_mb}, archive_blocked=${archiveBlockedCount}.`
  );
  const parserStats = getParserCleanupStats();
  console.log(
    `[jobs:sync-sources] parser_cleaned_title_count=${parserStats.parser_cleaned_title_count} parser_cleaned_org_count=${parserStats.parser_cleaned_org_count} parser_cleaned_description_count=${parserStats.parser_cleaned_description_count} parser_location_defaulted_remote_count=${parserStats.parser_location_defaulted_remote_count} parser_location_cleaned_count=${parserStats.parser_location_cleaned_count} parser_hybrid_location_repaired_count=${parserStats.parser_hybrid_location_repaired_count} parser_elemental_metadata_stripped_count=${parserStats.parser_elemental_metadata_stripped_count} parser_custom_table_header_stripped_count=${parserStats.parser_custom_table_header_stripped_count} parser_html_fragment_stripped_count=${parserStats.parser_html_fragment_stripped_count} salary_invalid_removed_count=${parserStats.salary_invalid_removed_count} salary_display_built_from_range_count=${parserStats.salary_display_built_from_range_count} salary_parse_warning_count=${parserStats.salary_parse_warning_count} workplace_type_cleaned_count=${parserStats.workplace_type_cleaned_count} workplace_type_invalid_removed_count=${parserStats.workplace_type_invalid_removed_count} workplace_type_field_misplacement_repaired_count=${parserStats.workplace_type_field_misplacement_repaired_count} elemental_impact_routed_pending_count=${parserStats.elemental_impact_routed_pending_count} low_confidence_title_count=${parserStats.low_confidence_title_count}`
  );
  const previousHealth = await readSourceHealthSnapshot();
  const mergedHealth = mergeSourceHealthSnapshots(previousHealth, sourceHealthEntries, {
    generated_at: new Date().toISOString(),
    sync_type: "sync-sources"
  });
  const nextHealthEntries = mergedHealth.sources.map((entry) => {
    const enriched = {
      ...entry,
      source_status: computeSourceStatus(entry)
    };
    return {
      ...enriched,
      stale_score: 100 - computeSourceFreshnessScore(enriched),
      source_freshness_score: computeSourceFreshnessScore(enriched)
    };
  });
  await writeSourceHealthSnapshot({
    generated_at: mergedHealth.generated_at,
    sync_type: mergedHealth.sync_type,
    sources: nextHealthEntries
  });
  console.log(`[jobs:sync-sources] source_health_written=true sources=${nextHealthEntries.length} sync_duration_ms=${Date.now() - syncStartedAt}`);

  return {
    publicJobs: finalPublicWriteResult.jobs,
    pendingJobs: triaged.adminPendingJobs,
    counts,
    triageSummary: triaged.summary
  };
}

async function main() {
  await runSyncForTypes();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:sync-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runSyncForTypes
};
