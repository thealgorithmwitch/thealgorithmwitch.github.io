const path = require("path");
const { readJson, writeJson } = require("./job-utils");

const ROOT = process.env.JOBS_DATA_DIR
  ? path.resolve(process.env.JOBS_DATA_DIR)
  : path.resolve(__dirname, "..");
const SOURCE_HEALTH_FILE = path.join(ROOT, "source-health-latest.json");

async function readSourceHealthSnapshot() {
  const payload = await readJson(SOURCE_HEALTH_FILE, { generated_at: "", sources: [] });
  return {
    generated_at: String(payload.generated_at || ""),
    sources: Array.isArray(payload.sources) ? payload.sources : []
  };
}

async function writeSourceHealthSnapshot(payload = {}) {
  await writeJson(SOURCE_HEALTH_FILE, {
    generated_at: String(payload.generated_at || new Date().toISOString()),
    sync_type: String(payload.sync_type || ""),
    sources: Array.isArray(payload.sources) ? payload.sources : []
  });
}

function mergeSourceHealthSnapshots(previous = {}, nextEntries = [], options = {}) {
  const previousEntries = Array.isArray(previous.sources) ? previous.sources : [];
  const previousBySource = new Map(previousEntries.map((item) => [String(item.source_id || ""), item]));
  const touchedSourceIds = new Set();
  const mergedEntries = [];

  for (const entry of Array.isArray(nextEntries) ? nextEntries : []) {
    const sourceId = String(entry.source_id || "");
    touchedSourceIds.add(sourceId);
    const prior = previousBySource.get(sourceId) || {};
    const currentFailures = Number(entry.failed_sync_count ?? entry.failure_error_count ?? 0) || 0;
    const hadFailure = currentFailures > 0;
    const nextFailedSyncCount = hadFailure
      ? Math.max(1, Number(prior.failed_sync_count || prior.failure_error_count || 0) + currentFailures)
      : 0;
    const lastSuccessfulSync = hadFailure
      ? String(prior.last_successful_sync || entry.last_successful_sync || "")
      : String(entry.last_successful_sync || prior.last_successful_sync || "");
    mergedEntries.push({
      ...prior,
      ...entry,
      failed_sync_count: nextFailedSyncCount,
      failure_error_count: nextFailedSyncCount,
      last_checked_at: String(entry.last_checked_at || new Date().toISOString()),
      last_successful_sync: lastSuccessfulSync,
      last_seen_at: String(entry.last_seen_at || (hadFailure ? prior.last_seen_at : entry.last_seen_at) || "")
    });
  }

  for (const prior of previousEntries) {
    const sourceId = String(prior.source_id || "");
    if (!sourceId || touchedSourceIds.has(sourceId)) continue;
    mergedEntries.push(prior);
  }

  return {
    generated_at: String(options.generated_at || new Date().toISOString()),
    sync_type: String(options.sync_type || ""),
    sources: mergedEntries
  };
}

module.exports = {
  SOURCE_HEALTH_FILE,
  mergeSourceHealthSnapshots,
  readSourceHealthSnapshot,
  writeSourceHealthSnapshot
};
