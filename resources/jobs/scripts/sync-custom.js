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
const { scrapeCustomSource } = require("./scrapers");
const { syncJobRecordStore } = require("./public-records");

function isManagedCustomJob(job, managedSourceIds) {
  return job.sync_origin === "custom" && managedSourceIds.has(String(job.source_id || ""));
}

async function runCustomSync() {
  const [existingJobs, existingPending, sources] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources()
  ]);

  const customSources = sources.filter((source) => {
    return source.type === "custom_careers_page" && source.enabled && source.parser_enabled === true;
  });
  const managedCustomSourceIds = new Set(
    sources
      .filter((source) => source.type === "custom_careers_page")
      .map((source) => source.id)
  );

  if (!customSources.length) {
    console.log("[jobs:sync-custom] No parser-enabled custom career page sources.");
    return {
      publicJobs: existingJobs,
      pendingJobs: existingPending,
      counts: {}
    };
  }

  const preservedPublicJobs = existingJobs.filter((job) => !isManagedCustomJob(job, managedCustomSourceIds));
  const preservedPendingJobs = existingPending.filter((job) => !isManagedCustomJob(job, managedCustomSourceIds));
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};

  for (const source of customSources) {
    try {
      const rawJobs = await scrapeCustomSource(source);
      counts[source.id] = { fetched: rawJobs.length, active: 0, pending: 0 };
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
      console.error(`[jobs:sync-custom] source_id=${source.id} url=${source.source_url} failure=${error.message}`);
    }
  }

  const mergedPublicJobs = dedupeJobs([...preservedPublicJobs, ...publicJobs]);
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-custom"
  });
  await syncJobRecordStore(publicWriteResult.jobs, { logger: console });
  await writeJson(PENDING_SYNCED_FILE, mergedPendingJobs);

  Object.entries(counts).forEach(([sourceId, count]) => {
    console.log(
      `[jobs:sync-custom] ${sourceId}: fetched=${count.fetched} active=${count.active} pending=${count.pending}${count.error ? ` error=${count.error}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-custom] Wrote ${publicWriteResult.jobs.length} public jobs to ${JOBS_FILE} and ${mergedPendingJobs.length} pending jobs to ${PENDING_SYNCED_FILE}.`
  );

  return {
    publicJobs: publicWriteResult.jobs,
    pendingJobs: mergedPendingJobs,
    counts
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
