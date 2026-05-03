const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  readSources,
  safeWritePublicJobs,
  writeJson
} = require("./job-utils");
const { dedupeJobs, routeSyncedJob } = require("./job-normalizer");
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

const SUPPORTED_TYPES = new Set(["greenhouse", "lever", "ashby", "bamboohr", "recruitee", "smartrecruiters", "workable"]);

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

  const existingPendingIds = new Set((existingPending || []).map((job) => String(job.id || "")));
  
  // Append-only scrape mode:
  // - active/public jobs are controlled by admin publish/apply
  // - existing pending jobs are preserved even if a source returns zero
  // - newly scraped jobs can be added to pending after triage
  const preservedPublicJobs = existingJobs;
  const preservedPendingJobs = existingPending;
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};
  const scrapeReports = [];

  for (const source of enabledSources) {
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
        if (routed.status === "active") {
          publicJobs.push(routed);
          counts[source.id].active += 1;
        } else {
          pendingJobs.push(routed);
          counts[source.id].pending += 1;
        }
      }
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
    }
  }

  const mergedPublicJobs = preservedPublicJobs;
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await syncJobRecordStore(publicWriteResult.jobs, { logger: console });
  const scrapeReportPayload = await upsertScrapeReports(scrapeReports);
  const triaged = await triagePendingJobs(
  mergedPendingJobs,
  publicWriteResult.jobs,
  scrapeReportPayload,
  {
    preserveExistingPending: true,
    existingPendingIds
  }
);
  await writeJson(PENDING_SYNCED_FILE, triaged.adminPendingJobs);
  await upsertScrapeReports(triaged.report.sources);

  Object.entries(counts).forEach(([sourceId, count]) => {
    console.log(
      `[jobs:sync-sources] ${sourceId}: fetched=${count.fetched} active=${count.active} pending=${count.pending}${count.route ? ` route=${count.route}` : ""}${count.reason ? ` reason=${count.reason}` : ""}${count.error ? ` error=${count.error}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-sources] Wrote ${publicWriteResult.jobs.length} public jobs to ${JOBS_FILE}, ${triaged.adminPendingJobs.length} admin-pending jobs to ${PENDING_SYNCED_FILE}, and rejected ${triaged.summary.rejected_noise} as noise.`
  );

  return {
    publicJobs: publicWriteResult.jobs,
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
