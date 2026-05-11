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

module.exports = {
  SOURCE_HEALTH_FILE,
  readSourceHealthSnapshot,
  writeSourceHealthSnapshot
};
