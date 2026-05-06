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
const { attachPublicJobPageUrls } = require("./public-jobs");
const {
  fetchAshbyJobsForSource,
  fetchAtsJobsByProvider,
  fetchBambooHrJobsForSource,
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  fetchRecruiteeJobsForSource
} = require("./ats-clients");
const { syncJobRecordStore } = require("./public-records");
const { upsertScrapeReports } = require("./scrape-report");
const { isDirectAtsSource, normalizeSource } = require("./source-utils");
const { triagePendingJobs } = require("./pending-triage");
const { readSourceHealthSnapshot, writeSourceHealthSnapshot } = require("./source-health-store");

const SUPPORTED_TYPES = new Set(["greenhouse", "lever", "ashby", "bamboohr", "recruitee", "smartrecruiters", "workable"]);

function isManagedAtsJob(job, activeSourceIds) {
  return job.sync_origin === "ats" && activeSourceIds.has(String(job.source_id || ""));
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
  const preservedPendingJobs = existingPending
    .filter((job) => !isManagedAtsJob(job, activeSourceIds))
    .map((job) => ({ ...job, __pending_preserved: true }));
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};
  const scrapeReports = [];
  const sourceHealthEntries = [];

  for (const source of enabledSources) {
    const sourceStartedAt = Date.now();
    const provider = source.provider || source.type;
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
        source_checked: true,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_skipped: 0,
        skip_reasons: ["unsupported direct ATS provider"],
        pending_count_delta: 0,
        public_count_delta: 0,
        last_successful_sync: "",
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 0
      });
      continue;
    }

    try {
      const rawJobs = await fetchJobsForSource(source);
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
        const routed = routeSyncedJob(rawJob, source);
        if (!routed) continue;
        if (routed.status === "active") {
          publicJobs.push(routed);
          counts[source.id].active += 1;
        } else {
          pendingJobs.push({ ...routed, __pending_new: true });
          counts[source.id].pending += 1;
        }
      }
      sourceHealthEntries.push({
        source_id: source.id,
        source_checked: true,
        jobs_found: rawJobs.length,
        jobs_normalized: counts[source.id].active + counts[source.id].pending,
        jobs_skipped: Math.max(0, rawJobs.length - (counts[source.id].active + counts[source.id].pending)),
        skip_reasons: [],
        pending_count_delta: counts[source.id].pending,
        public_count_delta: counts[source.id].active,
        last_successful_sync: new Date().toISOString(),
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 0
      });
    } catch (error) {
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
        errors: [error.message]
      });
      console.error(
        `[jobs:sync-sources] source_id=${source.id} source_type=${provider} url=${attemptedUrl} failure=${error.message}`
      );
      sourceHealthEntries.push({
        source_id: source.id,
        source_checked: true,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_skipped: 0,
        skip_reasons: [error.message],
        pending_count_delta: 0,
        public_count_delta: 0,
        last_successful_sync: "",
        sync_duration_ms: Date.now() - sourceStartedAt,
        failure_error_count: 1
      });
    }
  }

  const mergedPublicJobs = attachPublicJobPageUrls(dedupeJobs([...preservedPublicJobs, ...publicJobs]));
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await syncJobRecordStore(publicWriteResult.jobs, { logger: console, label: "jobs:sync-sources" });
  const scrapeReportPayload = await upsertScrapeReports(scrapeReports);
  const triaged = await triagePendingJobs(mergedPendingJobs, publicWriteResult.jobs, scrapeReportPayload);
  const finalPublicJobs = attachPublicJobPageUrls(dedupeJobs([...publicWriteResult.jobs, ...(triaged.autoPublishedJobs || [])]));
  const finalPublicWriteResult = await safeWritePublicJobs(finalPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await syncJobRecordStore(finalPublicWriteResult.jobs, { logger: console, label: "jobs:sync-sources" });
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
    }
    console.log(
      `[jobs:sync-sources] source_id=${sourceId} fetched=${count.fetched} active=${count.active} pending=${count.pending} retained=${triageSource.retained || triageSource.kept || 0} rejected_by_relevance=${triageSource.rejected_by_relevance || 0} rejected_noise=${triageSource.rejected_noise || 0} dropped_by_source_cap=${triageSource.dropped_by_source_cap || triageSource.dropped_by_cap || 0}${count.route ? ` route=${count.route}` : ""}${count.reason ? ` reason=${count.reason}` : ""}${count.error ? ` error=${count.error}` : ""}${triageSource.top_retained_examples?.length ? ` top_retained=${triageSource.top_retained_examples.map((item) => `${item.title} @ ${item.organization} (${item.relevance_score})`).join(" | ")}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-sources] Wrote ${finalPublicWriteResult.jobs.length} public jobs to ${JOBS_FILE}, ${triaged.adminPendingJobs.length} admin-pending jobs to ${PENDING_SYNCED_FILE}, auto_published=${triaged.summary.auto_published || 0}, rejected ${triaged.summary.rejected_noise} as noise, dropped_by_cap=${triaged.summary.dropped_by_cap_total}, final_pending_size_mb=${triaged.summary.final_pending_file_size_mb}.`
  );
  const parserStats = getParserCleanupStats();
  console.log(
    `[jobs:sync-sources] parser_cleaned_title_count=${parserStats.parser_cleaned_title_count} parser_cleaned_org_count=${parserStats.parser_cleaned_org_count} parser_cleaned_description_count=${parserStats.parser_cleaned_description_count} parser_location_defaulted_remote_count=${parserStats.parser_location_defaulted_remote_count} parser_location_cleaned_count=${parserStats.parser_location_cleaned_count} parser_hybrid_location_repaired_count=${parserStats.parser_hybrid_location_repaired_count} parser_elemental_metadata_stripped_count=${parserStats.parser_elemental_metadata_stripped_count} parser_custom_table_header_stripped_count=${parserStats.parser_custom_table_header_stripped_count} parser_html_fragment_stripped_count=${parserStats.parser_html_fragment_stripped_count} salary_invalid_removed_count=${parserStats.salary_invalid_removed_count} salary_display_built_from_range_count=${parserStats.salary_display_built_from_range_count} workplace_type_cleaned_count=${parserStats.workplace_type_cleaned_count} workplace_type_invalid_removed_count=${parserStats.workplace_type_invalid_removed_count} workplace_type_field_misplacement_repaired_count=${parserStats.workplace_type_field_misplacement_repaired_count} elemental_impact_routed_pending_count=${parserStats.elemental_impact_routed_pending_count}`
  );
  const previousHealth = await readSourceHealthSnapshot();
  const previousBySource = new Map((previousHealth.sources || []).map((item) => [String(item.source_id || ""), item]));
  const nextHealthEntries = sourceHealthEntries.map((entry) => {
    const previous = previousBySource.get(String(entry.source_id || "")) || {};
    return {
      ...entry,
      failure_error_count: Number(previous.failure_error_count || 0) + Number(entry.failure_error_count || 0)
    };
  });
  await writeSourceHealthSnapshot({
    generated_at: new Date().toISOString(),
    sync_type: "sync-sources",
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
