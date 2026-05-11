const path = require("path");
const { normalizeJob, stringifySafe } = require("./job-normalizer");

const BROAD_SOURCE_CONFIG = require(path.resolve(__dirname, "..", "broad-source-config.json"));

const POSITIVE_TERMS = Array.isArray(BROAD_SOURCE_CONFIG.positive_terms) ? BROAD_SOURCE_CONFIG.positive_terms : [];
const NEGATIVE_TERMS = Array.isArray(BROAD_SOURCE_CONFIG.negative_terms) ? BROAD_SOURCE_CONFIG.negative_terms : [];
const DEFAULTS = BROAD_SOURCE_CONFIG.defaults || {};
const SOURCE_OVERRIDES = BROAD_SOURCE_CONFIG.sources || {};

const NEGATIVE_PATTERNS = [
  /\b(?:field technician|field operations|field ops|meter installer|service technician)\b/i,
  /\b(?:customer support|customer service|support specialist|support representative|call center)\b/i,
  /\b(?:sales representative|account executive|sdr|bdr|business development representative)\b/i,
  /\bwarehouse\b|\blogistics\b/i,
  /\bretail\b/i,
  /\b(?:accountant|accounting manager|controller|finance manager|finance analyst|payroll specialist)\b/i,
  /\bconstruction\b/i
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(lowered)) return true;
    if (["false", "0", "no"].includes(lowered)) return false;
  }
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function daysBetween(older, newer) {
  const olderTs = Date.parse(older || "");
  const newerTs = Date.parse(newer || "");
  if (Number.isNaN(olderTs) || Number.isNaN(newerTs)) return 0;
  return Math.max(0, Math.floor((newerTs - olderTs) / 86400000));
}

function getSourceOverride(source = {}) {
  return SOURCE_OVERRIDES[String(source.id || "").trim()] || {};
}

function getSourceControlConfig(source = {}, options = {}) {
  const override = getSourceOverride(source);
  const jobCount = toNumber(options.jobCount, 0);
  const volumeThreshold = toNumber(
    source.volume_threshold ?? override.volume_threshold ?? DEFAULTS.volume_threshold,
    25
  );
  const maxPendingPerSync = toNumber(
    source.max_pending_per_sync ?? override.max_pending_per_sync ?? DEFAULTS.max_pending_per_sync,
    0
  );
  const broadSourceControls = parseBoolean(
    source.broad_source_controls ?? override.broad_source_controls,
    false
  ) || (jobCount >= volumeThreshold && maxPendingPerSync > 0);

  return {
    broadSourceControls,
    targetPositionMatching: broadSourceControls || parseBoolean(
      source.target_position_matching ?? override.target_position_matching,
      false
    ),
    maxPendingPerSync: maxPendingPerSync > 0 ? maxPendingPerSync : 0,
    minRelevanceScore: toNumber(
      source.min_relevance_score ?? override.min_relevance_score ?? DEFAULTS.min_relevance_score,
      2
    ),
    recentSurfaceCooldownDays: toNumber(
      source.recent_surface_cooldown_days ?? override.recent_surface_cooldown_days ?? DEFAULTS.recent_surface_cooldown_days,
      7
    ),
    staleBacklogDays: toNumber(
      source.stale_backlog_days ?? override.stale_backlog_days ?? DEFAULTS.stale_backlog_days,
      120
    ),
    qualityMode: normalizeText(source.quality_mode || override.quality_mode || "pending"),
    autoPublish: parseBoolean(source.auto_publish ?? override.auto_publish, false),
    trusted: parseBoolean(source.trusted, false),
    volumeThreshold
  };
}

function buildRelevanceHaystack(job = {}) {
  return normalizeLoose([
    job.title,
    job.organization,
    job.function,
    job.sector,
    job.job_type,
    job.workplace_type,
    job.description,
    job.raw_description,
    toArray(job.tags).join(" ")
  ].filter(Boolean).join(" "));
}

function scoreJobForPendingSource(job = {}) {
  const haystack = buildRelevanceHaystack(job);
  let score = 0;
  const reasons = [];

  POSITIVE_TERMS.forEach((term) => {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!pattern.test(haystack)) return;
    const points = /^(climate|sustainability|energy|clean energy|renewable|environmental|policy|advocacy)$/i.test(term) ? 3 : 2;
    score += points;
    reasons.push(`positive:${term}`);
  });

  NEGATIVE_PATTERNS.forEach((pattern, index) => {
    if (!pattern.test(haystack)) return;
    score -= 4;
    reasons.push(`negative:${NEGATIVE_TERMS[index] || "generic_low_relevance"}`);
  });

  if (/\b(?:community|partnerships|program manager|program director|operations manager|data scientist|software engineer|product manager|designer|communications manager|policy analyst|strategy lead|marketing manager)\b/i.test(haystack)) {
    score += 2;
    reasons.push("positive:role_signal");
  }

  return {
    score,
    reasons: Array.from(new Set(reasons))
  };
}

function buildSourceControlKey(job = {}) {
  const externalId = normalizeText(job.external_id || job.id);
  const applyUrl = normalizeText(job.apply_url || job.original_url || job.source_url);
  if (externalId) return `external:${externalId.toLowerCase()}`;
  if (applyUrl) return `apply:${applyUrl.toLowerCase()}`;
  return `title:${normalizeLoose(job.title)}::org:${normalizeLoose(job.organization)}::loc:${normalizeLoose(job.location)}`;
}

function cleanupSourceControlFlags(job = {}) {
  const next = { ...job };
  delete next.backlog_rank;
  delete next.skip_reason;
  delete next.source_capped;
  delete next.stale_backlog_archived;
  next.hidden_from_review_default = false;
  next.broad_source_backlog = false;
  return next;
}

function buildRotationScore(entry, config, currentIso) {
  const surfacedCount = toNumber(entry.job.surfaced_count, 0);
  const daysSinceFirstSeen = daysBetween(entry.job.first_seen_at || currentIso, currentIso);
  const daysSinceLastSeen = daysBetween(entry.job.last_seen_at || currentIso, currentIso);
  const daysSinceLastReview = entry.job.last_review_cycle_at
    ? daysBetween(entry.job.last_review_cycle_at, currentIso)
    : config.recentSurfaceCooldownDays + 1;
  const freshnessBoost = Math.max(0, 21 - daysSinceLastSeen) * 3;
  const neverSurfacedBoost = surfacedCount === 0 ? 12 + Math.min(daysSinceFirstSeen, 21) : 0;
  const recentSurfacePenalty = daysSinceLastReview < config.recentSurfaceCooldownDays
    ? (config.recentSurfaceCooldownDays - daysSinceLastReview + 1) * 8
    : 0;
  const surfacedPenalty = surfacedCount * 5;
  const stalePenalty = Math.max(0, daysSinceLastSeen - config.staleBacklogDays) * 4;
  const ageDecay = Math.max(0, daysSinceFirstSeen - 45);
  return (entry.score * 100)
    + freshnessBoost
    + neverSurfacedBoost
    - recentSurfacePenalty
    - surfacedPenalty
    - stalePenalty
    - ageDecay;
}

function mergeCurrentJob(existingJob, incomingJob, source, currentIso) {
  const base = existingJob ? { ...existingJob } : {};
  const merged = incomingJob ? { ...base, ...incomingJob } : base;
  const relevance = scoreJobForPendingSource(merged);
  return {
    ...merged,
    source_id: normalizeText(merged.source_id || source.id),
    trusted: false,
    auto_publish: false,
    quality_mode: normalizeText(merged.quality_mode || source.quality_mode || "pending"),
    broad_source_controls: true,
    relevance_score: relevance.score,
    relevance_reasons: relevance.reasons,
    first_seen_at: normalizeText(base.first_seen_at || merged.first_seen_at || currentIso),
    last_seen_at: incomingJob ? currentIso : normalizeText(base.last_seen_at || currentIso),
    surfaced_count: toNumber(base.surfaced_count ?? merged.surfaced_count, 0),
    last_review_cycle_at: normalizeText(base.last_review_cycle_at || merged.last_review_cycle_at || "")
  };
}

function applySourcePendingControls(source, jobsOrOptions = [], maybeOptions = {}) {
  const options = Array.isArray(jobsOrOptions)
    ? { incomingJobs: jobsOrOptions, ...maybeOptions }
    : { ...(jobsOrOptions || {}) };
  const currentIso = normalizeText(options.nowIso || nowIso());
  const incomingJobs = toArray(options.incomingJobs);
  const existingPendingJobs = toArray(options.existingPendingJobs);
  const assumeAllCurrent = parseBoolean(options.assumeAllCurrent, false);
  const normalizedIncoming = incomingJobs
    .map((job) => normalizeJob(job))
    .filter(Boolean);
  const config = getSourceControlConfig(source, { jobCount: normalizedIncoming.length || existingPendingJobs.length });

  if (!config.broadSourceControls && !config.targetPositionMatching && !config.maxPendingPerSync) {
    return {
      config,
      activeReviewJobs: normalizedIncoming,
      backlogJobs: [],
      archivedJobs: [],
      allJobs: normalizedIncoming,
      matchedCount: normalizedIncoming.length,
      activeReviewAdded: normalizedIncoming.length,
      backlogAdded: 0,
      backlogPreserved: 0,
      resurfacedFromBacklog: 0,
      staleBacklogArchived: 0,
      repeatSurfacePreventedCount: 0,
      cappedExisting: 0,
      cappedCount: 0,
      skippedLowRelevanceCount: 0
    };
  }

  const existingByKey = new Map(existingPendingJobs.map((job) => [buildSourceControlKey(job), job]));
  const incomingByKey = new Map();
  normalizedIncoming.forEach((job) => {
    incomingByKey.set(buildSourceControlKey(job), job);
  });

  const currentKeys = assumeAllCurrent
    ? new Set(existingPendingJobs.map((job) => buildSourceControlKey(job)))
    : new Set(incomingByKey.keys());
  const activeEntries = [];
  const archivedJobs = [];
  let staleBacklogArchived = 0;

  for (const key of currentKeys) {
    const existingJob = existingByKey.get(key);
    const incomingJob = incomingByKey.get(key) || (assumeAllCurrent ? existingJob : null);
    if (!incomingJob && !existingJob) continue;
    const merged = mergeCurrentJob(existingJob, incomingJob, source, currentIso);
    activeEntries.push({
      key,
      job: merged,
      score: toNumber(merged.relevance_score, 0),
      previouslyBacklog: parseBoolean(existingJob?.hidden_from_review_default, false) || parseBoolean(existingJob?.broad_source_backlog, false),
      existedBefore: Boolean(existingJob)
    });
  }

  if (!assumeAllCurrent) {
    for (const [key, existingJob] of existingByKey.entries()) {
      if (currentKeys.has(key)) continue;
      staleBacklogArchived += 1;
      archivedJobs.push({
        ...existingJob,
        hidden_from_review_default: true,
        broad_source_backlog: true,
        stale_backlog_archived: true,
        status: "archived",
        skip_reason: "not_active_at_source",
        last_seen_at: normalizeText(existingJob.last_seen_at || currentIso),
        archived_at: currentIso
      });
    }
  }

  const relevantEntries = [];
  const lowRelevanceEntries = [];

  activeEntries.forEach((entry) => {
    const belowThreshold = config.targetPositionMatching && entry.score < config.minRelevanceScore;
    if (belowThreshold) {
      lowRelevanceEntries.push(entry);
      return;
    }
    entry.rotationScore = buildRotationScore(entry, config, currentIso);
    relevantEntries.push(entry);
  });

  relevantEntries.sort((left, right) =>
    (right.rotationScore - left.rotationScore)
    || (right.score - left.score)
    || (toNumber(left.job.surfaced_count, 0) - toNumber(right.job.surfaced_count, 0))
    || (daysBetween(left.job.first_seen_at || currentIso, currentIso) - daysBetween(right.job.first_seen_at || currentIso, currentIso))
    || normalizeText(left.job.title).localeCompare(normalizeText(right.job.title))
  );

  let activeReviewAdded = 0;
  let backlogAdded = 0;
  let backlogPreserved = 0;
  let resurfacedFromBacklog = 0;
  let repeatSurfacePreventedCount = 0;
  let cappedExisting = 0;

  const activeReviewJobs = [];
  const backlogJobs = [];

  relevantEntries.forEach((entry, index) => {
    const activeSlot = config.maxPendingPerSync > 0 ? index < config.maxPendingPerSync : true;
    const cleanedJob = cleanupSourceControlFlags(entry.job);
    if (activeSlot) {
      const surfacedCount = toNumber(cleanedJob.surfaced_count, 0) + 1;
      activeReviewJobs.push({
        ...cleanedJob,
        hidden_from_review_default: false,
        broad_source_backlog: false,
        source_capped: false,
        surfaced_count: surfacedCount,
        last_review_cycle_at: currentIso
      });
      if (!entry.existedBefore || entry.previouslyBacklog) activeReviewAdded += 1;
      if (entry.previouslyBacklog) resurfacedFromBacklog += 1;
      return;
    }

    if (entry.job.last_review_cycle_at && daysBetween(entry.job.last_review_cycle_at, currentIso) < config.recentSurfaceCooldownDays) {
      repeatSurfacePreventedCount += 1;
    }
    if (entry.existedBefore) {
      cappedExisting += 1;
      backlogPreserved += 1;
    } else {
      backlogAdded += 1;
    }
    backlogJobs.push({
      ...entry.job,
      hidden_from_review_default: true,
      broad_source_backlog: true,
      source_capped: true,
      skip_reason: "source_cap_exceeded"
    });
  });

  let backlogRank = 1;
  const rankedBacklogJobs = backlogJobs.map((job) => ({
    ...job,
    backlog_rank: backlogRank++
  }));

  const lowRelevanceBacklog = lowRelevanceEntries
    .sort((left, right) => right.score - left.score || normalizeText(left.job.title).localeCompare(normalizeText(right.job.title)))
    .map((entry) => {
      if (entry.existedBefore) {
        backlogPreserved += 1;
      } else {
        backlogAdded += 1;
      }
      return {
        ...entry.job,
        hidden_from_review_default: true,
        broad_source_backlog: true,
        source_capped: false,
        skip_reason: "broad_source_low_relevance",
        backlog_rank: backlogRank++
      };
    });

  const allJobs = [...activeReviewJobs, ...rankedBacklogJobs, ...lowRelevanceBacklog, ...archivedJobs];

  return {
    config,
    activeReviewJobs,
    backlogJobs: [...rankedBacklogJobs, ...lowRelevanceBacklog],
    archivedJobs,
    allJobs,
    matchedCount: relevantEntries.length,
    activeReviewAdded,
    backlogAdded,
    backlogPreserved,
    resurfacedFromBacklog,
    staleBacklogArchived,
    repeatSurfacePreventedCount,
    cappedExisting,
    cappedCount: rankedBacklogJobs.length,
    skippedLowRelevanceCount: lowRelevanceBacklog.length
  };
}

module.exports = {
  BROAD_SOURCE_CONFIG,
  NEGATIVE_TERMS,
  POSITIVE_TERMS,
  applySourcePendingControls,
  buildSourceControlKey,
  getSourceControlConfig,
  scoreJobForPendingSource
};
