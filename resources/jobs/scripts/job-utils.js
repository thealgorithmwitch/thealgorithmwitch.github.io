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
  slugify,
  todayIso,
  writeJson
};
