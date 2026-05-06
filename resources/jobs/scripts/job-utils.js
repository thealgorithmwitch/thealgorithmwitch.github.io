const fs = require("fs/promises");
const path = require("path");
const { buildDescriptionSnippet, dedupeJobs, normalizeJob, normalizePayDisplay, normalizeWorkplaceType, slugify, stringifySafe, todayIso } = require("./job-normalizer");
const { buildJobPagePathMap } = require("./job-page-paths");
const { normalizeSource } = require("./source-utils");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const PENDING_FILE = path.join(ROOT, "pending-jobs.json");
const PENDING_SYNCED_FILE = path.join(ROOT, "pending-synced-jobs.json");
const SCRAPE_REPORT_FILE = path.join(ROOT, "scrape-report.json");
const PENDING_TRIAGE_SUMMARY_FILE = path.join(ROOT, "pending-triage-summary.json");
const ADMIN_PENDING_OVERRIDES_FILE = path.join(ROOT, "admin-pending-overrides.json");
const ADMIN_ORG_RULES_FILE = path.join(ROOT, "admin-organization-rules.json");
const ADMIN_JOB_ACTIONS_SNAPSHOT_FILE = path.join(ROOT, "admin-job-actions.json");
const ADMIN_LOCAL_ACTIONS_FILE = path.join(ROOT, "admin-actions-local.json");

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
  const next = serializeForWrite(filePath, data);
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
  "specialization_confidence",
  "experience",
  "source",
  "source_url",
  "apply_url",
  "original_url",
  "status",
  "approved_by",
  "raw_description",
  "description",
  "shared_by",
  "notes",
  "review_reason",
  "triage_bucket",
  "triage_reason",
  "confidence",
  "sync_origin"
]);

function sanitizePublicJob(job) {
  if (!job || typeof job !== "object") return job;
  const canonicalTitle = stringifySafe(job.title);
  const canonicalSalary = normalizePayDisplay({
    payDisplay: job.salary,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    currency: job.salary_currency,
    period: job.salary_period
  });
  const canonicalDescription = stringifySafe(job.description || job.raw_description);
  const canonicalSnippet = buildDescriptionSnippet(canonicalDescription, 220, { title: canonicalTitle });
  return {
    ...sanitizeRecursive(job),
    salary: canonicalSalary,
    workplace_type: normalizeWorkplaceType(job.workplace_type, ""),
    description: canonicalDescription,
    description_snippet: canonicalSnippet,
    summary: canonicalSnippet,
    page_url: stringifySafe(job.page_url),
    redirect_paths: Array.isArray(job.redirect_paths) ? job.redirect_paths.map((item) => stringifySafe(item)).filter(Boolean) : []
  };
}

function attachDerivedPageUrls(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const { map } = buildJobPagePathMap(list);
  return list.map((job) => ({
    ...job,
    page_url: map.get(String(job && job.id || "")) || stringifySafe(job && job.page_url)
  }));
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
  if (basename === "jobs.json") {
    if (Array.isArray(data)) {
      return attachDerivedPageUrls(data).map((job) => sanitizeRecursive(sanitizePublicJob(job)));
    }
  }
  if (basename === "pending-synced-jobs.json") {
    if (Array.isArray(data)) {
      return data.map((job) => sanitizeRecursive(sanitizePublicJob(job)));
    }
  }
  return sanitizeRecursive(data);
}

function serializeForWrite(filePath, data) {
  return serializeJson(sanitizeForWrite(filePath, data));
}

async function writeJsonIfChanged(filePath, data) {
  const next = serializeForWrite(filePath, data);
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
  return Array.isArray(payload.sources) ? payload.sources.map((source) => normalizeSource(source)) : [];
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
  ADMIN_JOB_ACTIONS_SNAPSHOT_FILE,
  ADMIN_LOCAL_ACTIONS_FILE,
  ADMIN_ORG_RULES_FILE,
  ADMIN_PENDING_OVERRIDES_FILE,
  PENDING_FILE,
  PENDING_SYNCED_FILE,
  PENDING_TRIAGE_SUMMARY_FILE,
  SCRAPE_REPORT_FILE,
  SOURCES_FILE,
  dedupeJobs,
  normalizeJob,
  readJson,
  readJobs,
  readPendingJobs,
  readPendingSyncedJobs,
  readSources,
  safeWritePublicJobs,
  serializeForWrite,
  slugify,
  todayIso,
  writeJson,
  writeJsonIfChanged
};
