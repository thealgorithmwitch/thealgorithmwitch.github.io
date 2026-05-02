const fs = require("fs/promises");
const path = require("path");
const { dedupeJobs, normalizeJob, slugify, todayIso } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const PENDING_FILE = path.join(ROOT, "pending-jobs.json");
const PENDING_SYNCED_FILE = path.join(ROOT, "pending-synced-jobs.json");

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  const next = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, next, "utf8");
}

function serializeJson(data) {
  return JSON.stringify(data, null, 2) + "\n";
}

async function writeJsonIfChanged(filePath, data) {
  const next = serializeJson(data);
  let current = null;
  try {
    current = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current === next) {
    return false;
  }
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

async function safeWritePublicJobs(nextJobs, options = {}) {
  const {
    logger = console,
    label = "jobs",
    forceEmptyEnv = "FORCE_EMPTY_JOBS"
  } = options;
  const existingJobs = await readJobs();
  const forceEmpty = String(process.env[forceEmptyEnv] || "").toLowerCase() === "true";
  const existingCount = existingJobs.length;
  const nextCount = Array.isArray(nextJobs) ? nextJobs.length : 0;

  if (!forceEmpty && nextCount === 0 && existingCount > 0) {
    logger.log(`[${label}] Public jobs output is empty; preserving existing ${existingCount} jobs. Set ${forceEmptyEnv}=true to allow overwrite.`);
    return {
      jobs: existingJobs,
      wrote: false,
      preservedExisting: true,
      changed: false
    };
  }

  const wrote = await writeJsonIfChanged(JOBS_FILE, nextJobs);
  return {
    jobs: nextJobs,
    wrote,
    preservedExisting: false,
    changed: wrote
  };
}

async function readJobs() {
  const jobs = await readJson(JOBS_FILE, []);
  return Array.isArray(jobs) ? jobs : [];
}

async function readSources() {
  const payload = await readJson(SOURCES_FILE, { sources: [] });
  return Array.isArray(payload.sources) ? payload.sources : [];
}

async function readPendingJobs() {
  const jobs = await readJson(PENDING_FILE, []);
  return Array.isArray(jobs) ? jobs : [];
}

async function readPendingSyncedJobs() {
  const jobs = await readJson(PENDING_SYNCED_FILE, []);
  return Array.isArray(jobs) ? jobs : [];
}

module.exports = {
  JOBS_FILE,
  PENDING_FILE,
  PENDING_SYNCED_FILE,
  SOURCES_FILE,
  dedupeJobs,
  normalizeJob,
  readJobs,
  readPendingJobs,
  readPendingSyncedJobs,
  readSources,
  safeWritePublicJobs,
  slugify,
  todayIso,
  writeJson,
  writeJsonIfChanged
};
