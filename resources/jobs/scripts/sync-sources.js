const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJobs,
  readPendingSyncedJobs,
  readSources,
  writeJson
} = require("./job-utils");
const { dedupeJobs, routeSyncedJob } = require("./job-normalizer");
const { fetchGreenhouseJobsForSource, fetchLeverJobsForSource } = require("./ats-clients");

const SUPPORTED_TYPES = new Set(["greenhouse", "lever"]);

function isManagedAtsJob(job, activeSourceIds) {
  return job.sync_origin === "ats" && activeSourceIds.has(String(job.source_id || ""));
}

async function fetchJobsForSource(source) {
  if (source.type === "greenhouse") {
    return fetchGreenhouseJobsForSource(source);
  }
  if (source.type === "lever") {
    return fetchLeverJobsForSource(source);
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

async function runSyncForTypes(types = []) {
  const requestedTypes = types.length ? new Set(types) : SUPPORTED_TYPES;
  const [existingJobs, existingPending, sources] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources()
  ]);

  const enabledSources = sources.filter((source) => {
    return source.enabled && requestedTypes.has(source.type) && SUPPORTED_TYPES.has(source.type);
  });

  if (!enabledSources.length) {
    console.log(`[jobs:sync-sources] No enabled sources for ${Array.from(requestedTypes).join(", ")}.`);
    return {
      publicJobs: existingJobs,
      pendingJobs: existingPending,
      counts: {}
    };
  }

  const activeSourceIds = new Set(enabledSources.map((source) => source.id));
  const preservedPublicJobs = existingJobs.filter((job) => !isManagedAtsJob(job, activeSourceIds));
  const preservedPendingJobs = existingPending.filter((job) => !isManagedAtsJob(job, activeSourceIds));
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};

  for (const source of enabledSources) {
    try {
      const rawJobs = await fetchJobsForSource(source);
      counts[source.id] = { fetched: rawJobs.length, active: 0, pending: 0 };

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
      console.error(`[jobs:sync-sources] ${source.organization} failed: ${error.message}`);
    }
  }

  const mergedPublicJobs = dedupeJobs([...preservedPublicJobs, ...publicJobs]);
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  await Promise.all([
    writeJson(JOBS_FILE, mergedPublicJobs),
    writeJson(PENDING_SYNCED_FILE, mergedPendingJobs)
  ]);

  Object.entries(counts).forEach(([sourceId, count]) => {
    console.log(
      `[jobs:sync-sources] ${sourceId}: fetched=${count.fetched} active=${count.active} pending=${count.pending}${count.error ? ` error=${count.error}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-sources] Wrote ${mergedPublicJobs.length} public jobs to ${JOBS_FILE} and ${mergedPendingJobs.length} pending jobs to ${PENDING_SYNCED_FILE}.`
  );

  return {
    publicJobs: mergedPublicJobs,
    pendingJobs: mergedPendingJobs,
    counts
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
