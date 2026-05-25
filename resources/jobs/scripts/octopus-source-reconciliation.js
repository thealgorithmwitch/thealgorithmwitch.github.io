const path = require("path");
const { buildJobPagePathMap } = require("./job-page-paths");
const { markMissingFromSource, markRemoved, shouldShowPublicRecord } = require("./lifecycle-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "octopus-cleanup-report.json");
const OCTOPUS_SOURCE_ID = "octopus-energy";
const OCTOPUS_ORGANIZATION = "Octopus Energy";
const OCTOPUS_PUBLIC_CAP = 5;
const OCTOPUS_PRIORITY_PATTERNS = [
  { pattern: /\b(?:performance marketing|digital marketing)\b/i, points: 7, reason: "priority_marketing_lead" },
  { pattern: /\b(?:marketing|brand|creative|content|writer|editor|social media|campaign|communications?)\b/i, points: 5, reason: "priority_comms_creative" },
  { pattern: /\b(?:partnerships?|commercial contracts?|contracts?|legal|policy)\b/i, points: 5, reason: "priority_partnerships_contracts_policy" },
  { pattern: /\b(?:commercial|commercial operations|risk|optimisation|optimization)\b/i, points: 2, reason: "priority_commercial_adjacent" }
];
const OCTOPUS_EXCLUSION_PATTERNS = [
  { pattern: /\b(?:engineer|engineering|developer|software|backend|frontend|fullstack|full stack|devops|architect|techops)\b/i, points: -10, reason: "exclude_engineering" },
  { pattern: /\b(?:field application|field technician|smart meter|technician)\b/i, points: -10, reason: "exclude_field_technician" },
  { pattern: /\b(?:finance|treasury|accounting|reporting)\b/i, points: -8, reason: "exclude_finance_only" },
  { pattern: /\b(?:operations specialist|warehouse|logistics|customer operations)\b/i, points: -7, reason: "exclude_operations_only" },
  { pattern: /\b(?:sales executive|business development)\b/i, points: -6, reason: "exclude_generic_business_development" },
  { pattern: /\b(?:end of lease|onboarding|customer success|energy specialist|executive assistant|warehouse)\b/i, points: -8, reason: "exclude_low_priority_support_role" }
];

function text(value) {
  return String(value || "").trim();
}

function normalizeLoose(value) {
  return text(value).toLowerCase();
}

function normalizeCanonicalUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch (_error) {
    return raw.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function extractSourceJobId(entity = {}) {
  const direct = text(entity.source_job_id || entity.external_id || entity.source_key);
  if (!direct) return "";
  const leverMatch = direct.match(/(?:^|_)octopus-energy_([a-f0-9-]{8,})$/i);
  if (leverMatch && leverMatch[1]) return leverMatch[1].toLowerCase();
  return direct.toLowerCase();
}

function buildTitleCompanyLocationKey(entity = {}) {
  const title = normalizeLoose(entity.display?.title || entity.raw_source_data?.title || entity.title);
  const organization = normalizeLoose(entity.display?.organization || entity.raw_source_data?.organization || entity.organization);
  const location = normalizeLoose(entity.display?.location || entity.raw_source_data?.location || entity.location);
  if (!title || !organization) return "";
  return `${title}::${organization}::${location}`;
}

function buildCanonicalIdentity(entity = {}) {
  return {
    canonical_url: normalizeCanonicalUrl(
      entity.display?.source_url ||
      entity.raw_source_data?.source_url ||
      entity.source_url ||
      entity.apply_url ||
      entity.original_url
    ),
    source_job_id: extractSourceJobId(entity),
    title_company_location: buildTitleCompanyLocationKey(entity)
  };
}

function isOctopusEntity(entity = {}) {
  const organization = normalizeLoose(entity.display?.organization || entity.raw_source_data?.organization || entity.organization);
  const sourceId = normalizeLoose(entity.raw_source_data?.source_id || entity.source_id);
  return organization === normalizeLoose(OCTOPUS_ORGANIZATION) || sourceId === OCTOPUS_SOURCE_ID;
}

function isExplicitPublicKeepOverride(record = {}) {
  return Boolean(
    record &&
    (
      record.featured === true ||
      record.manual_override === true ||
      normalizeLoose(record.source_type) === "manual" ||
      normalizeLoose(record.raw_source_data?.sync_origin) === "manual"
    )
  );
}

function scoreOctopusPriority(entity = {}) {
  const title = text(entity.display?.title || entity.raw_source_data?.title || entity.title);
  const specialization = text(entity.display?.specialization || entity.raw_source_data?.specialization || entity.specialization);
  const haystack = `${title} ${specialization}`.trim();
  let score = 0;
  const reasons = [];
  OCTOPUS_PRIORITY_PATTERNS.forEach(({ pattern, points, reason }) => {
    if (!pattern.test(haystack)) return;
    score += points;
    reasons.push(reason);
  });
  OCTOPUS_EXCLUSION_PATTERNS.forEach(({ pattern, points, reason }) => {
    if (!pattern.test(haystack)) return;
    score += points;
    reasons.push(reason);
  });
  return {
    score,
    reasons,
    excluded: score <= 0 || reasons.some((reason) => reason.startsWith("exclude_"))
  };
}

function buildDuplicateGroups(items = [], keyName) {
  const groups = new Map();
  for (const item of items) {
    const key = text(item.identity?.[keyName]);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key_name: keyName,
      key,
      ids: list.map((item) => text(item.id))
    }));
}

function buildLatestSnapshot(pending = [], sourceHealth = {}) {
  const octopusPending = (Array.isArray(pending) ? pending : []).filter(isOctopusEntity);
  const healthEntry = (Array.isArray(sourceHealth?.sources) ? sourceHealth.sources : [])
    .find((item) => normalizeLoose(item.source_id) === OCTOPUS_SOURCE_ID);
  const hasAuthoritativeHealth = Boolean(
    healthEntry &&
    healthEntry.source_checked === true &&
    Number(healthEntry.failed_sync_count || healthEntry.failure_error_count || 0) === 0 &&
    text(healthEntry.last_successful_sync) &&
    normalizeLoose(healthEntry.source_status) !== "sync_error" &&
    normalizeLoose(healthEntry.source_status) !== "stale"
  );
  const keys = {
    canonical_url: new Set(),
    source_job_id: new Set(),
    title_company_location: new Set()
  };

  octopusPending.forEach((job) => {
    const identity = buildCanonicalIdentity(job);
    if (identity.canonical_url) keys.canonical_url.add(identity.canonical_url);
    if (identity.source_job_id) keys.source_job_id.add(identity.source_job_id);
    if (identity.title_company_location) keys.title_company_location.add(identity.title_company_location);
  });

  return {
    jobs: octopusPending,
    job_ids: new Set(octopusPending.map((job) => text(job.id)).filter(Boolean)),
    keys,
    authoritative: hasAuthoritativeHealth,
    health_entry: healthEntry || null
  };
}

function matchesSnapshot(identity = {}, snapshot) {
  if (!snapshot || !snapshot.authoritative) return false;
  if (identity.canonical_url && snapshot.keys.canonical_url.has(identity.canonical_url)) return true;
  if (identity.source_job_id && snapshot.keys.source_job_id.has(identity.source_job_id)) return true;
  if (identity.title_company_location && snapshot.keys.title_company_location.has(identity.title_company_location)) return true;
  return false;
}

function sortByFreshness(left = {}, right = {}) {
  const leftTs = Date.parse(String(left.last_seen_at || left.last_checked_at || left.updated_at || left.created_at || "")) || 0;
  const rightTs = Date.parse(String(right.last_seen_at || right.last_checked_at || right.updated_at || right.created_at || "")) || 0;
  return rightTs - leftTs;
}

function auditOctopusState({ records = [], jobs = [], pending = [], sourceHealth = {}, pageFiles = [] } = {}) {
  const octopusPublicJobs = (Array.isArray(jobs) ? jobs : []).filter(isOctopusEntity);
  const octopusRecords = (Array.isArray(records) ? records : []).filter(isOctopusEntity);
  const octopusPublishedRecords = octopusRecords.filter((record) => shouldShowPublicRecord(record));
  const octopusPending = (Array.isArray(pending) ? pending : []).filter(isOctopusEntity);
  const snapshot = buildLatestSnapshot(octopusPending, sourceHealth);
  const publicAuditItems = octopusPublishedRecords.map((record) => ({
    id: text(record.id),
    title: text(record.display?.title || record.raw_source_data?.title || record.title),
    identity: buildCanonicalIdentity(record),
    last_seen_at: text(record.last_seen_at || record.raw_source_data?.last_seen_at),
    source_status: text(record.source_status || record.raw_source_data?.source_status),
    stale_score: Number(record.stale_score ?? record.raw_source_data?.stale_score ?? 0) || 0,
    featured: record.featured === true,
    explicit_keep_override: isExplicitPublicKeepOverride(record),
    present_in_latest_snapshot: matchesSnapshot(buildCanonicalIdentity(record), snapshot),
    missing_last_seen_at: !text(record.last_seen_at || record.raw_source_data?.last_seen_at),
    missing_source_ref: !text(record.raw_source_data?.source_id || record.source_id) || !(
      text(record.raw_source_data?.source_url || record.display?.source_url || record.source_url) ||
      text(record.raw_source_data?.external_id || record.external_id)
    ),
    priority: scoreOctopusPriority(record)
  }));
  const { map: pagePathMap } = buildJobPagePathMap(octopusPublicJobs);
  const stalePageCandidates = publicAuditItems
    .map((item) => pagePathMap.get(item.id))
    .filter((pagePath) => text(pagePath) && (Array.isArray(pageFiles) ? pageFiles : []).includes(path.basename(pagePath)));

  return {
    snapshot,
    octopusPublicJobs,
    octopusPublishedRecords,
    octopusPending,
    publicAuditItems,
    duplicateGroups: []
      .concat(buildDuplicateGroups(publicAuditItems, "canonical_url"))
      .concat(buildDuplicateGroups(publicAuditItems, "source_job_id"))
      .concat(buildDuplicateGroups(publicAuditItems, "title_company_location")),
    stalePageCandidates
  };
}

function reconcileOctopusRecords(records = [], audit = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  if (!audit || !audit.snapshot || !audit.snapshot.authoritative) {
    return {
      records: Array.isArray(records) ? records : [],
      archivedIds: [],
      retainedIds: audit?.publicAuditItems?.map((item) => item.id) || [],
      missingFromSourceIds: [],
      duplicateGroups: audit?.duplicateGroups || []
    };
  }

  const duplicateIds = new Set((audit.duplicateGroups || []).flatMap((group) => group.ids.slice(1)));
  const candidates = (audit.publicAuditItems || []).slice().sort((left, right) => {
    if (left.explicit_keep_override !== right.explicit_keep_override) {
      return left.explicit_keep_override ? -1 : 1;
    }
    if (left.present_in_latest_snapshot !== right.present_in_latest_snapshot) {
      return left.present_in_latest_snapshot ? -1 : 1;
    }
    if (Number(left.priority?.score || 0) !== Number(right.priority?.score || 0)) {
      return Number(right.priority?.score || 0) - Number(left.priority?.score || 0);
    }
    return sortByFreshness(left, right);
  });

  const archiveReasonsById = new Map();
  const retainedIds = [];
  let retainedCount = 0;

  for (const item of candidates) {
    if (item.explicit_keep_override || isOctopusUkLeverPriorityRole(item)) {
      retainedIds.push(item.id);
      retainedCount += 1;
      continue;
    }
    if (!item.present_in_latest_snapshot) {
      archiveReasonsById.set(item.id, "missing_from_latest_octopus_source_snapshot");
      continue;
    }
    if (item.priority?.excluded) {
      archiveReasonsById.set(item.id, item.priority.reasons[0] || "octopus_low_priority_role");
      continue;
    }
    if (duplicateIds.has(item.id)) {
      archiveReasonsById.set(item.id, "duplicate_octopus_public_record");
      continue;
    }
    if (retainedCount >= OCTOPUS_PUBLIC_CAP) {
      archiveReasonsById.set(item.id, "octopus_public_cap_exceeded");
      continue;
    }
    retainedIds.push(item.id);
    retainedCount += 1;
  }

  const archivedIds = Array.from(archiveReasonsById.keys());
  const missingFromSourceIds = candidates
    .filter((item) =>
      !item.present_in_latest_snapshot &&
      !item.explicit_keep_override &&
      !isOctopusUkLeverPriorityRole(item)
    )
    .map((item) => item.id);

  const nextRecords = (Array.isArray(records) ? records : []).map((record) => {
    if (!isOctopusEntity(record)) return record;
    const recordId = text(record.id);
    const reason = archiveReasonsById.get(recordId);
    if (!reason) return record;
    if (
      reason === "missing_from_latest_octopus_source_snapshot"
      && record.published === true
      && record.public_visibility === true
      && String(record.status || "").toLowerCase() === "published"
    ) {
      return markMissingFromSource(record, reason, {
        now,
        authoritativeSnapshotConfirmed: true,
        confirmationsRequired: 2,
        graceDays: 10
      });
    }
    return markRemoved(record, reason, { now });
  });

  return {
    records: nextRecords,
    archivedIds,
    retainedIds,
    missingFromSourceIds,
    duplicateGroups: audit.duplicateGroups || []
  };
}

function isOctopusUkLeverPriorityRole(item = {}) {
  if (!item || !item.priority) return false;
  if (item.priority.score <= 0 || item.priority.excluded) return false;

  if (!String(item.id || "").startsWith("Octopus Energy-")) return false;

  const canonicalUrl = String(item.identity?.canonical_url || "").toLowerCase();
  if (!canonicalUrl.includes("jobs.lever.co/octoenergy")) return false;

  const key = String(item.identity?.title_company_location || "").toLowerCase();
  const lastSep = key.lastIndexOf("::");
  if (lastSep < 0) return false;
  const locationPart = key.slice(lastSep + 2);
  if (!locationPart) return false;

  return /\b(london|gb|united kingdom|uk)\b/.test(locationPart);
}

module.exports = {
  REPORT_FILE,
  OCTOPUS_ORGANIZATION,
  OCTOPUS_PUBLIC_CAP,
  OCTOPUS_SOURCE_ID,
  auditOctopusState,
  buildCanonicalIdentity,
  buildLatestSnapshot,
  isExplicitPublicKeepOverride,
  isOctopusEntity,
  isOctopusUkLeverPriorityRole,
  matchesSnapshot,
  normalizeCanonicalUrl,
  scoreOctopusPriority,
  reconcileOctopusRecords
};
