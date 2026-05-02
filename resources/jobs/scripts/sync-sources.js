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
  fetchBambooHrJobsForSource,
  fetchGreenhouseJobsForSource,
  fetchLeverJobsForSource,
  fetchRecruiteeJobsForSource
} = require("./ats-clients");

const SUPPORTED_TYPES = new Set(["greenhouse", "lever", "ashby", "bamboohr", "recruitee"]);

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
  if (source.type === "ashby") {
    return fetchAshbyJobsForSource(source);
  }
  if (source.type === "bamboohr") {
    return fetchBambooHrJobsForSource(source);
  }
  if (source.type === "recruitee") {
    return fetchRecruiteeJobsForSource(source);
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
    return source.enabled && (!requestedTypes || requestedTypes.has(source.type));
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
  const preservedPendingJobs = existingPending.filter((job) => !isManagedAtsJob(job, activeSourceIds));
  const publicJobs = [];
  const pendingJobs = [];
  const counts = {};

  for (const source of enabledSources) {
    if (!SUPPORTED_TYPES.has(source.type)) {
      counts[source.id] = {
        fetched: 0,
        active: 0,
        pending: 0,
        skipped: true,
        reason: "unsupported source type pending custom integration"
      };
      console.log(`[jobs:sync-sources] ${source.id}: Skipped: unsupported source type pending custom integration.`);
      continue;
    }

    try {
      const rawJobs = await fetchJobsForSource(source);
      counts[source.id] = {
        fetched: rawJobs.length,
        active: 0,
        pending: 0,
        route: describeRouting(source)
      };

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
        source.type === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board_token || "")}/jobs?content=true`
          : source.type === "lever"
            ? `https://api.lever.co/v0/postings/${encodeURIComponent(source.company_slug || "")}?mode=json`
            : source.type === "ashby"
              ? String(source.api_url || "https://jobs.ashbyhq.com/api/non-user-graphql?op=apiJobBoardWithTeams")
              : source.type === "bamboohr"
                ? String(source.api_url || source.source_url || "")
                : source.type === "recruitee"
                  ? String(source.api_url || `https://${source.company_slug || ""}.recruitee.com/api/offers/`)
            : String(source.api_url || source.source_url || "");
      console.error(
        `[jobs:sync-sources] source_id=${source.id} source_type=${source.type} url=${attemptedUrl} failure=${error.message}`
      );
    }
  }

  const mergedPublicJobs = dedupeJobs([...preservedPublicJobs, ...publicJobs]);
  const mergedPendingJobs = dedupeJobs([...preservedPendingJobs, ...pendingJobs]);

  const publicWriteResult = await safeWritePublicJobs(mergedPublicJobs, {
    logger: console,
    label: "jobs:sync-sources"
  });
  await writeJson(PENDING_SYNCED_FILE, mergedPendingJobs);

  Object.entries(counts).forEach(([sourceId, count]) => {
    console.log(
      `[jobs:sync-sources] ${sourceId}: fetched=${count.fetched} active=${count.active} pending=${count.pending}${count.route ? ` route=${count.route}` : ""}${count.reason ? ` reason=${count.reason}` : ""}${count.error ? ` error=${count.error}` : ""}`
    );
  });
  console.log(
    `[jobs:sync-sources] Wrote ${publicWriteResult.jobs.length} public jobs to ${JOBS_FILE} and ${mergedPendingJobs.length} pending jobs to ${PENDING_SYNCED_FILE}.`
  );

  return {
    publicJobs: publicWriteResult.jobs,
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
