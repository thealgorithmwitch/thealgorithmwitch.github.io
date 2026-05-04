const { normalizeJob, stringifySafe } = require("./job-normalizer");

const CLOSED_PATTERNS = [
  /no longer accepting applications/i,
  /position has been filled/i,
  /job is no longer available/i,
  /posting has expired/i,
  /this job has closed/i,
  /application deadline has passed/i
];

const DEADLINE_PATTERNS = [
  /\b(?:application deadline|apply by|deadline to apply|closing date|closes on|applications close)\b[:\s-]*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i,
  /\b(?:application deadline|apply by|deadline to apply|closing date|closes on|applications close)\b[:\s-]*(\d{4}-\d{2}-\d{2})/i
];

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function detectApplicationDeadline(job) {
  const text = [
    stringifySafe(job.display?.description),
    stringifySafe(job.raw_source_data?.description),
    stringifySafe(job.raw_source_data?.raw_description),
    stringifySafe(job.raw_source_data?.notes),
    stringifySafe(job.raw_source_data?.raw_payload)
  ].join(" ");

  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (!match || !match[1]) continue;
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function applyPublishLifecycle(record, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const deadline = detectApplicationDeadline(record);
  const firstPublishedAt = record.first_published_at || now.toISOString();
  const expiresAt = deadline ? deadline.toISOString() : addDays(now, 7).toISOString();
  const isExpiredByDeadline = deadline && deadline.getTime() < now.getTime();

  return {
    ...record,
    first_published_at: firstPublishedAt,
    last_verified_at: now.toISOString(),
    expires_at: expiresAt,
    stale_reason: isExpiredByDeadline ? "application deadline has passed" : "",
    verification_status: isExpiredByDeadline ? "expired" : "verified",
    verification_method: deadline ? "deadline_detected" : "manual"
  };
}

function isClosedPosting(content) {
  return CLOSED_PATTERNS.some((pattern) => pattern.test(String(content || "")));
}

function shouldShowPublicRecord(record) {
  return Boolean(
    record &&
    record.published &&
    record.public_visibility &&
    String(record.status || "").toLowerCase() === "published" &&
    !["expired", "removed"].includes(String(record.verification_status || "").toLowerCase())
  );
}

function isStale(record, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const expiresAt = new Date(record.expires_at || 0);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    return true;
  }
  const firstPublishedAt = new Date(record.first_published_at || record.updated_at || 0);
  if (Number.isNaN(firstPublishedAt.getTime())) return false;
  return addDays(firstPublishedAt, 7).getTime() <= now.getTime();
}

function markNeedsReview(record, reason, method = "manual", options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return {
    ...record,
    status: "pending",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "needs_review",
    verification_method: method,
    updated_at: now.toISOString()
  };
}

function markRemoved(record, reason, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return {
    ...record,
    status: "archived",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "removed",
    verification_method: "source_recheck",
    updated_at: now.toISOString()
  };
}

function markExpired(record, reason, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return {
    ...record,
    status: "archived",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "expired",
    verification_method: "deadline_detected",
    updated_at: now.toISOString()
  };
}

function extendVerification(record, method = "source_recheck", options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const deadline = detectApplicationDeadline(record);
  const expiresAt = deadline ? deadline : addDays(now, 7);
  return {
    ...record,
    first_published_at: record.first_published_at || now.toISOString(),
    status: "published",
    published: true,
    public_visibility: true,
    last_verified_at: now.toISOString(),
    expires_at: toIso(expiresAt),
    stale_reason: "",
    verification_status: deadline && expiresAt.getTime() < now.getTime() ? "expired" : "verified",
    verification_method: deadline ? "deadline_detected" : method,
    updated_at: now.toISOString()
  };
}

function resolveDisplayJobFromRecord(record) {
  const raw = record.raw_source_data || {};
  const display = record.display || {};
  return normalizeJob({
    ...raw,
    title: stringifySafe(display.title) || raw.title,
    organization: stringifySafe(display.organization) || raw.organization,
    location: stringifySafe(display.location) || raw.location,
    workplace_type: stringifySafe(display.location_type) || raw.workplace_type,
    salary: stringifySafe(display.pay_display) || raw.salary,
    salary_min: display.salary_min ?? raw.salary_min,
    salary_max: display.salary_max ?? raw.salary_max,
    job_type: stringifySafe(display.role_type) || raw.job_type,
    experience: stringifySafe(display.experience_level) || raw.experience,
    sector: stringifySafe(display.sector) || raw.sector,
    function: stringifySafe(display.function) || raw.function,
    specialization: stringifySafe(display.specialization) || raw.specialization,
    tags: Array.isArray(display.tags) && display.tags.length ? display.tags : raw.tags,
    description: stringifySafe(display.description) || raw.description,
    source: stringifySafe(display.source_name) || raw.source,
    source_url: stringifySafe(display.source_url) || raw.source_url,
    original_url: stringifySafe(display.original_url) || raw.original_url || raw.source_url,
    apply_url: stringifySafe(display.application_url) || raw.apply_url,
    date_posted: stringifySafe(display.date_collected) || raw.date_posted,
    featured: typeof record.featured === "boolean" ? record.featured : raw.featured,
    status: shouldShowPublicRecord(record) ? "published" : String(record.status || raw.status || "")
  });
}

module.exports = {
  CLOSED_PATTERNS,
  addDays,
  applyPublishLifecycle,
  detectApplicationDeadline,
  extendVerification,
  isClosedPosting,
  isStale,
  markExpired,
  markNeedsReview,
  markRemoved,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
};
