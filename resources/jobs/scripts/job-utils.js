const fs = require("fs/promises");
const path = require("path");
const { dedupeJobs, normalizeJob, slugify, stringifySafe, todayIso } = require("./job-normalizer");

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
  const next = JSON.stringify(sanitizeForWrite(filePath, data), null, 2) + "\n";
  await fs.writeFile(filePath, next, "utf8");
}

function serializeJson(data) {
  return JSON.stringify(data, null, 2) + "\n";
}

const PUBLIC_STRING_FIELDS = new Set([
  "id",
  "ref",
  "external_id",
  "source_id",
  "source_type",
  "title",
  "organization",
  "location",
  "workplace_type",
  "job_type",
  "salary",
  "raw_salary",
  "salary_currency",
  "salary_period",
  "sector",
  "function",
  "experience",
  "source",
  "source_url",
  "apply_url",
  "status",
  "approved_by",
  "raw_description",
  "description",
  "shared_by",
  "notes",
  "review_reason",
  "confidence",
  "sync_origin"
]);

function sanitizePublicJob(job) {
  if (!job || typeof job !== "object") return job;
  const normalized = normalizeJob(job);
  return normalized;
}

function sanitizeRecursive(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.includes("[object Object]") ? "" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecursive(item));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, next] of Object.entries(value)) {
      if (PUBLIC_STRING_FIELDS.has(key)) {
        out[key] = stringifySafe(next);
        continue;
      }
      out[key] = sanitizeRecursive(next);
    }
    return out;
  }
  return value;
}

function sanitizeForWrite(filePath, data) {
  const basename = path.basename(filePath);
  if (basename === "jobs.json" || basename === "pending-synced-jobs.json") {
    if (Array.isArray(data)) {
      return data.map((job) => sanitizeRecursive(sanitizePublicJob(job)));
    }
  }
  return sanitizeRecursive(data);
}

async function writeJsonIfChanged(filePath, data) {
  const next = serializeJson(sanitizeForWrite(filePath, data));
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
  readJson,
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
