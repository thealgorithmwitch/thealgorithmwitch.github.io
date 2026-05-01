const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const PENDING_FILE = path.join(ROOT, "pending-jobs.json");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value) {
  return !Number.isNaN(Date.parse(value));
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function detectSalaryCurrency(salary, location) {
  const salaryText = String(salary || "").trim();
  const locationText = String(location || "").trim().toLowerCase();

  if (!salaryText) {
    return "Unknown";
  }

  if (/\b(?:CAD|CA\$)\b/i.test(salaryText) || /CA\$/i.test(salaryText)) {
    return "CAD";
  }
  if (/\b(?:USD|US\$)\b/i.test(salaryText) || /US\$/i.test(salaryText)) {
    return "USD";
  }
  if (/\bEUR\b/i.test(salaryText) || /€/i.test(salaryText)) {
    return "EUR";
  }
  if (/\bGBP\b/i.test(salaryText) || /£/i.test(salaryText)) {
    return "GBP";
  }
  if (/\$/i.test(salaryText)) {
    if (/canada|toronto|vancouver|montreal|ottawa|calgary|edmonton|quebec|ontario|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|labrador|prince edward island/i.test(locationText)) {
      return "CAD";
    }
    return "USD";
  }

  if (/canada|toronto|vancouver|montreal|ottawa|calgary|edmonton|quebec|ontario|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|labrador|prince edward island/i.test(locationText)) {
    return "CAD";
  }
  if (/uk|united kingdom|england|scotland|wales|northern ireland|london|manchester|birmingham|glasgow|edinburgh/i.test(locationText)) {
    return "GBP";
  }
  if (/austria|belgium|bulgaria|croatia|cyprus|czech republic|czechia|denmark|estonia|finland|france|germany|greece|hungary|ireland|italy|latvia|lithuania|luxembourg|malta|netherlands|poland|portugal|romania|slovakia|slovenia|spain|sweden|european union|eu\b|berlin|paris|amsterdam|madrid|barcelona|lisbon|dublin|brussels|vienna|stockholm|helsinki|rome|milan/i.test(locationText)) {
    return "EUR";
  }

  return "USD";
}

function normalizeJob(input = {}) {
  const title = String(input.title || "").trim();
  const organization = String(input.organization || "").trim();
  const applyUrl = String(input.apply_url || input.applyUrl || "").trim();
  const location = String(input.location || "Remote").trim();
  const salary = String(input.salary || "").trim();
  const datePosted = String(input.date_posted || input.datePosted || "").trim();
  const id =
    String(input.id || "").trim() ||
    [organization, title, datePosted || todayIso()].map(slugify).filter(Boolean).join("-");

  const tags = ensureArray(input.tags).map((tag) => String(tag).trim().toLowerCase());
  const salaryCurrency = String(input.salary_currency || input.salaryCurrency || "").trim() || detectSalaryCurrency(salary, location);

  return {
    id,
    ref: String(input.ref || "").trim(),
    title,
    organization,
    location,
    workplace_type: String(input.workplace_type || input.workplaceType || "").trim(),
    job_type: String(input.job_type || input.jobType || "Full-time").trim(),
    salary,
    salary_currency: ["USD", "CAD", "EUR", "GBP", "Unknown"].includes(salaryCurrency) ? salaryCurrency : "Unknown",
    featured: Boolean(input.featured),
    sector: String(input.sector || "general").trim().toLowerCase(),
    function: String(input.function || input.role_function || "").trim().toLowerCase(),
    experience: String(input.experience || "").trim().toLowerCase(),
    source: String(input.source || "Manual").trim(),
    source_url: String(input.source_url || input.sourceUrl || "").trim(),
    apply_url: applyUrl,
    date_posted: isValidDate(datePosted) ? new Date(datePosted).toISOString().slice(0, 10) : todayIso(),
    date_added: String(input.date_added || input.dateAdded || datePosted || todayIso()).trim(),
    date_updated: String(input.date_updated || input.dateUpdated || datePosted || todayIso()).trim(),
    status: String(input.status || "active").trim().toLowerCase(),
    approved_by: String(input.approved_by || input.approvedBy || "").trim(),
    description: String(input.description || "").trim(),
    tags,
    shared_by: String(input.shared_by || input.sharedBy || "").trim(),
    notes: String(input.notes || "").trim()
  };
}

function dedupeJobs(jobs) {
  const seen = new Map();

  for (const rawJob of jobs) {
    const job = normalizeJob(rawJob);
    const key = [
      job.organization.toLowerCase(),
      job.title.toLowerCase(),
      job.apply_url.toLowerCase()
    ].join("::");
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, job);
      continue;
    }

    const existingTime = Date.parse(existing.date_posted) || 0;
    const jobTime = Date.parse(job.date_posted) || 0;

    if (jobTime >= existingTime) {
      seen.set(key, { ...existing, ...job, tags: Array.from(new Set([...existing.tags, ...job.tags])) });
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    return Date.parse(b.date_posted) - Date.parse(a.date_posted);
  });
}

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

module.exports = {
  JOBS_FILE,
  PENDING_FILE,
  SOURCES_FILE,
  dedupeJobs,
  normalizeJob,
  readJobs,
  readPendingJobs,
  readSources,
  slugify,
  todayIso,
  writeJson
};
