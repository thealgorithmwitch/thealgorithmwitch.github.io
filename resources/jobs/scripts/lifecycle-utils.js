const { buildDescriptionSnippet, buildFallbackDescription, hasUsableDescription, normalizeJob, normalizePayDisplay, normalizeWorkplaceType, stringifySafe } = require("./job-normalizer");

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

const DEFAULT_PUBLISHED_GRACE_DAYS = 14;
const DEFAULT_MISSING_CONFIRMATIONS_REQUIRED = 2;

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

function computeStaleScore(record = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const lastSeenValue = record.last_seen_at || record.last_verified_at || record.updated_at || record.created_at;
  const lastSeen = new Date(lastSeenValue || 0);
  const ageDays = Number.isNaN(lastSeen.getTime()) ? 30 : Math.max(0, Math.floor((now.getTime() - lastSeen.getTime()) / 86400000));
  const verificationStatus = String(record.verification_status || record.source_status || "").toLowerCase();
  let score = Math.min(80, ageDays * 8);
  if (verificationStatus === "needs_review") score += 18;
  if (verificationStatus === "expired") score += 28;
  if (verificationStatus === "removed") score = 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function applyFreshnessMetadata(record = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const checkedAt = toIso(now);
  const sourceStatus = String(options.sourceStatus || record.source_status || "").trim() || "live";
  const next = {
    ...record,
    last_checked_at: checkedAt,
    source_status: sourceStatus,
    failed_sync_count: Math.max(0, Number(options.failedSyncCount ?? record.failed_sync_count ?? 0) || 0)
  };
  if (options.lastSeen !== false) {
    next.last_seen_at = checkedAt;
  } else {
    next.last_seen_at = stringifySafe(record.last_seen_at);
  }
  next.stale_score = computeStaleScore(next, { now });
  return next;
}

function isSourceOwnedRecord(record = {}) {
  const sourceType = String(record.source_type || record.raw_source_data?.sync_origin || "").toLowerCase();
  if (sourceType === "manual") return false;
  return Boolean(
    String(record.raw_source_data?.source_id || record.source_id || "").trim()
    || String(record.raw_source_data?.source_url || record.source_url || record.display?.source_url || "").trim()
  );
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

  return applyFreshnessMetadata({
    ...record,
    first_published_at: firstPublishedAt,
    last_verified_at: now.toISOString(),
    expires_at: expiresAt,
    stale_reason: isExpiredByDeadline ? "application deadline has passed" : "",
    verification_status: isExpiredByDeadline ? "expired" : "verified",
    verification_method: deadline ? "deadline_detected" : "manual"
  }, {
    now,
    sourceStatus: isExpiredByDeadline ? "removed" : "live",
    lastSeen: !isExpiredByDeadline
  });
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
  return applyFreshnessMetadata({
    ...record,
    status: "pending",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "needs_review",
    verification_method: method,
    updated_at: now.toISOString()
  }, {
    now,
    sourceStatus: "needs_review",
    lastSeen: false,
    failedSyncCount: Number(record.failed_sync_count || 0) + 1
  });
}

function markRemoved(record, reason, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return applyFreshnessMetadata({
    ...record,
    status: "archived",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "removed",
    verification_method: "source_recheck",
    updated_at: now.toISOString()
  }, {
    now,
    sourceStatus: "removed",
    lastSeen: false
  });
}

function markMissingFromSource(record, reason, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const confirmationsRequired = Math.max(
    1,
    Number(options.confirmationsRequired ?? record.required_missing_confirmations ?? DEFAULT_MISSING_CONFIRMATIONS_REQUIRED) || DEFAULT_MISSING_CONFIRMATIONS_REQUIRED
  );
  const nextConfirmations = Math.max(0, Number(record.missing_from_source_confirmations || 0) || 0) + 1;
  const graceDays = Math.max(1, Number(options.graceDays ?? DEFAULT_PUBLISHED_GRACE_DAYS) || DEFAULT_PUBLISHED_GRACE_DAYS);
  const authoritativeSnapshotConfirmed = options.authoritativeSnapshotConfirmed === true;
  const publishedGraceUntil = toIso(options.publishedGraceUntil || record.published_grace_until || addDays(now, graceDays));
  const graceExpired = Boolean(publishedGraceUntil && Date.parse(publishedGraceUntil) <= now.getTime());
  const canArchive = authoritativeSnapshotConfirmed && nextConfirmations >= confirmationsRequired && graceExpired;

  if (canArchive) {
    return markRemoved({
      ...record,
      missing_from_source_confirmations: nextConfirmations,
      published_grace_until: publishedGraceUntil
    }, reason, { now });
  }

  const nextRecord = applyFreshnessMetadata({
    ...record,
    status: "published",
    published: true,
    public_visibility: true,
    stale_reason: reason,
    verification_status: "verified",
    verification_method: "source_grace_period",
    updated_at: now.toISOString(),
    published_grace_until: publishedGraceUntil,
    missing_from_source_confirmations: nextConfirmations,
    required_missing_confirmations: confirmationsRequired
  }, {
    now,
    sourceStatus: authoritativeSnapshotConfirmed ? "grace_missing" : "sync_unverified",
    lastSeen: false,
    failedSyncCount: Number(record.failed_sync_count || 0)
  });
  nextRecord.first_published_at = stringifySafe(record.first_published_at || now.toISOString());
  nextRecord.last_verified_at = stringifySafe(record.last_verified_at || now.toISOString());
  return nextRecord;
}

function markExpired(record, reason, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return applyFreshnessMetadata({
    ...record,
    status: "archived",
    published: false,
    public_visibility: false,
    stale_reason: reason,
    verification_status: "expired",
    verification_method: "deadline_detected",
    updated_at: now.toISOString()
  }, {
    now,
    sourceStatus: "removed",
    lastSeen: false
  });
}

function extendVerification(record, method = "source_recheck", options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const deadline = detectApplicationDeadline(record);
  const expiresAt = deadline ? deadline : addDays(now, 7);
  const next = applyFreshnessMetadata({
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
  }, {
    now,
    sourceStatus: deadline && expiresAt.getTime() < now.getTime() ? "removed" : "live",
    lastSeen: !(deadline && expiresAt.getTime() < now.getTime()),
    failedSyncCount: 0
  });
  next.missing_from_source_confirmations = 0;
  next.published_grace_until = "";
  next.required_missing_confirmations = Math.max(
    1,
    Number(record.required_missing_confirmations || DEFAULT_MISSING_CONFIRMATIONS_REQUIRED) || DEFAULT_MISSING_CONFIRMATIONS_REQUIRED
  );
  return next;
}

function resolveDisplayJobFromRecord(record) {
  const raw = record.raw_source_data || {};
  const display = record.display || {};
  const canonicalPayDisplay = normalizePayDisplay({
    payDisplay: stringifySafe(display.pay_display || raw.salary),
    salaryMin: display.salary_min ?? raw.salary_min,
    salaryMax: display.salary_max ?? raw.salary_max,
    currency: raw.salary_currency,
    period: raw.salary_period
  });
  const canonicalWorkplaceType = normalizeWorkplaceType(stringifySafe(display.location_type || raw.workplace_type), "");
  const canonicalLocation = stringifySafe(display.location || raw.location);
  const canonicalDescription = stringifySafe(display.description || raw.description || raw.raw_description);
  const normalized = normalizeJob({
    ...raw,
    title: stringifySafe(display.title) || raw.title,
    organization: stringifySafe(display.organization) || raw.organization,
    location: canonicalLocation,
    workplace_type: canonicalWorkplaceType || raw.workplace_type,
    salary: canonicalPayDisplay || raw.salary,
    salary_min: display.salary_min ?? raw.salary_min,
    salary_max: display.salary_max ?? raw.salary_max,
    job_type: stringifySafe(display.role_type) || raw.job_type,
    experience: stringifySafe(display.experience_level) || raw.experience,
    sector: stringifySafe(display.sector) || raw.sector,
    function: stringifySafe(display.function) || raw.function,
    specialization: stringifySafe(display.specialization) || raw.specialization,
    specialization_confidence: stringifySafe(display.specialization_confidence) || raw.specialization_confidence || "low",
    tags: Array.isArray(display.tags) && display.tags.length ? display.tags : raw.tags,
    description: canonicalDescription,
    source: stringifySafe(display.source_name) || raw.source,
    source_url: stringifySafe(display.source_url) || raw.source_url,
    original_url: stringifySafe(display.original_url) || raw.original_url || raw.source_url,
    apply_url: stringifySafe(display.application_url) || raw.apply_url,
    date_posted: stringifySafe(display.date_collected) || raw.date_posted,
    featured: typeof record.featured === "boolean" ? record.featured : raw.featured,
    status: shouldShowPublicRecord(record) ? "published" : String(record.status || raw.status || ""),
    parser_confidence: stringifySafe(raw.parser_confidence),
    parser_confidence_score: raw.parser_confidence_score,
    content_quality_score: raw.content_quality_score,
    source_status: stringifySafe(record.source_status || raw.source_status),
    source_confidence: stringifySafe(raw.source_confidence),
    source_classification: stringifySafe(raw.source_classification),
    stale_score: raw.stale_score,
    last_checked_at: stringifySafe(record.last_checked_at || raw.last_checked_at),
    last_seen_at: stringifySafe(record.last_seen_at || raw.last_seen_at),
    failed_sync_count: raw.failed_sync_count
  });
  if (!normalized) return null;
  const fullDescription = hasUsableDescription(canonicalDescription || stringifySafe(normalized.description || normalized.raw_description), { title: normalized.title })
    ? (canonicalDescription || stringifySafe(normalized.description || normalized.raw_description))
    : buildFallbackDescription(normalized);
  const descriptionSnippet = buildDescriptionSnippet(fullDescription, 220, { title: normalized.title });
  return {
    ...normalized,
    location: canonicalLocation || normalized.location,
    workplace_type: canonicalWorkplaceType || normalized.workplace_type,
    salary: canonicalPayDisplay,
    salary_min: display.salary_min ?? raw.salary_min ?? normalized.salary_min ?? null,
    salary_max: display.salary_max ?? raw.salary_max ?? normalized.salary_max ?? null,
    description: fullDescription,
    description_snippet: descriptionSnippet,
    summary: descriptionSnippet
  };
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
  markMissingFromSource,
  markNeedsReview,
  markRemoved,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord,
  applyFreshnessMetadata,
  computeStaleScore,
  isSourceOwnedRecord
};
