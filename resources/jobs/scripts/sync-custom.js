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
const { scrapeSourceWithDiscovery } = require("./scrapers");
const { syncJobRecordStore } = require("./public-records");
const { upsertScrapeReports } = require("./scrape-report");
const { shouldUseDiscoverySync } = require("./source-utils");
const { triagePendingJobs } = require("./pending-triage");

function isManagedCustomJob(job, managedSourceIds) {
  return job.sync_origin === "custom" && managedSourceIds.has(String(job.source_id || ""));
}

async function runCustomSync() {
  const [existingJobs, existingPending, sources] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources()
  ]);

  const customSources = sources.filter((source) => shouldUseDiscoverySync(source));
  const managedCustomSourceIds = new Set(
    sources
      .filter((source) => shouldUseDiscoverySync(source))
      .map((source) => source.id)
  );

  if (!customSources.length) {
    console.log("[jobs:sync-custom] No discovery-managed sources.");
    return {
      publicJobs: existingJobs,
      pendingJobs: existingPending,
      counts: {}
    };
  }

  const preservedPublicJobs = existingJobs;
  
  // Preserve all existing pending unless already published/excluded elsewhere.
  // Do not wipe managed ATS pending just because a source returned fewer jobs.
  const preservedPendingJobs = existingPending;
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};
  const scrapeReports = [];

  for (const source of customSources) {
    try {
      const { jobs: rawJobs, report } = await scrapeSourceWithDiscovery(source);
      counts[source.id] = {
        fetched: rawJobs.length,
        active: 0,
        pending: 0,
        route: report.parser_used,
        reason: report.reason_for_zero_results
      };
      scrapeReports.push(report);
      for (const rawJob of rawJobs) {
        const routed = routeSyncedJob({
          ...rawJob,
          sync_origin: "custom"
        }, source);
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
      scrapeReports.push({
        source_id: source.id,
        source_name: source.organization,
        source_url: source.source_url,
        detected_ats_provider: source.provider || "",
        parser_used: "",
        pages_checked: [source.source_url],
        links_discovered: [],
        job_links_found: [],
        jobs_parsed: 0,
        reason_for_zero_results: error.message,
        browser_fallback_recommended: Boolean(source.requires_browser),
        errors: [error.message]
      });
      console.error(`[jobs:sync-custom] source_id=${source.id} url=${source.source_url} failure=${error.message}`);
    }
  }

  const mergedPublicJobs = preservedPublicJobs;
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-custom"
  });
  await syncJobRecordStore(publicWriteResult.jobs, { logger: console });
  const scrapeReportPayload = await upsertScrapeReports(scrapeReports);
  const existingPendingIds = new Set(
  (existingPending || []).map((job) => String(job.id || ""))
);

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
      `[jobs:sync-custom] ${sourceId}: fetched=${count.fetched} active=${count.active} pending=${count.pending}${count.route ? ` route=${count.route}` : ""}${count.reason ? ` reason=${count.reason}` : ""}${count.error ? ` error=${count.error}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-custom] Wrote ${publicWriteResult.jobs.length} public jobs to ${JOBS_FILE}, ${triaged.adminPendingJobs.length} admin-pending jobs to ${PENDING_SYNCED_FILE}, and rejected ${triaged.summary.rejected_noise} as noise.`
  );

  return {
    publicJobs: publicWriteResult.jobs,
    pendingJobs: triaged.adminPendingJobs,
    counts,
    triageSummary: triaged.summary
  };
}

if (require.main === module) {
  runCustomSync().catch((error) => {
    console.error(`[jobs:sync-custom] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runCustomSync
};
