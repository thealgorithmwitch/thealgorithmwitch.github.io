const fs = require("fs/promises");
const path = require("path");
const { buildJobRecord, JOB_RECORDS_FILE, readJobRecords } = require("./public-records");
const { buildPublicJobsFromRecords, syncPublicJobsFromRecords } = require("./public-jobs");
const { readJson, writeJson, JOBS_FILE } = require("./job-utils");
const { extendVerification, markRemoved } = require("./lifecycle-utils");
const { scoreJobForPendingSource } = require("./source-sync-quality");
const { scoreOctopusPriority } = require("./octopus-source-reconciliation");

const ROOT = path.resolve(__dirname, "..");
const JOBS2_FILE = path.join(ROOT, "jobs2.json");
const OLDJOBS_FILE = path.join(ROOT, "oldjobs.json");
const REPORT_FILE = path.join(ROOT, "reports", "jobs2-recovery-report.json");

const OCTOPUS_MAX_RESTORES = 5;
const MISSION_ORGS = new Set([
  "Protect Democracy",
  "Powerlines",
  "More Perfect Union Action",
  "Earthjustice",
  "Carbon Direct",
  "American Bird Conservancy",
  "HA Sustainable Infrastructure Capital"
]);
const NON_OCTOPUS_EXCLUDE_PATTERNS = [
  /\b(?:intern|engineer|developer|backend|frontend|devops|software|tax|accounting|finance)\b/i,
  /\b(?:customer support|field technician|warehouse|logistics)\b/i
];

function text(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
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

function dedupeKey(job = {}) {
  return normalizeUrl(job.source_url || job.apply_url || job.original_url) || String(job.id || "");
}

function isOctopus(job = {}) {
  return text(job.organization).toLowerCase() === "octopus energy";
}

function scoreMissionRecovery(job = {}) {
  const haystack = `${text(job.title)} ${text(job.organization)} ${text(job.specialization)} ${text(job.description)}`.trim();
  const pendingScore = scoreJobForPendingSource(job).score;
  let score = pendingScore;
  const reasons = [];
  if (MISSION_ORGS.has(text(job.organization))) {
    score += 8;
    reasons.push("mission_org");
  }
  if (/\b(?:policy|democracy|voting|civic|research|advocacy|campaign|communications?|media|content|video|writer|editor|development|partnerships?)\b/i.test(haystack)) {
    score += 6;
    reasons.push("mission_title");
  }
  if (NON_OCTOPUS_EXCLUDE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    score -= 10;
    reasons.push("excluded_generic_role");
  }
  return { score, reasons, excluded: score < 10 || reasons.includes("excluded_generic_role") };
}

function restorePublishedRecord(job, existing = {}, now) {
  const next = buildJobRecord({
    ...job,
    status: "published",
    source_status: "live",
    last_seen_at: now.toISOString(),
    last_checked_at: now.toISOString()
  }, existing, { context: "source_sync", now: now.toISOString() });
  next.status = "published";
  next.published = true;
  next.public_visibility = true;
  next.stale_reason = "";
  return extendVerification(next, "jobs2_recovery", { now });
}

async function main() {
  const now = new Date();
  const [jobs2, oldjobs, existingRecords, existingJobs] = await Promise.all([
    readJson(JOBS2_FILE, []),
    readJson(OLDJOBS_FILE, []),
    readJobRecords(),
    readJson(JOBS_FILE, [])
  ]);

  const currentPublicIds = new Set((existingJobs || []).map((job) => text(job.id)).filter(Boolean));
  const existingById = new Map((existingRecords || []).map((record) => [text(record.id), record]));

  const jobs2Missing = (Array.isArray(jobs2) ? jobs2 : []).filter((job) => !currentPublicIds.has(text(job.id)));
  const oldjobsByKey = new Map((Array.isArray(oldjobs) ? oldjobs : []).map((job) => [dedupeKey(job), job]));

  const octopusUniverse = new Map();
  jobs2Missing.filter(isOctopus).forEach((job) => octopusUniverse.set(dedupeKey(job), job));
  oldjobs.filter(isOctopus).forEach((job) => {
    const key = dedupeKey(job);
    if (!octopusUniverse.has(key)) octopusUniverse.set(key, job);
  });
  existingRecords.filter((record) => isOctopus(record.raw_source_data || record.display || {})).forEach((record) => {
    const candidate = {
      ...(record.raw_source_data || {}),
      title: record.display?.title || record.raw_source_data?.title,
      organization: record.display?.organization || record.raw_source_data?.organization,
      location: record.display?.location || record.raw_source_data?.location,
      specialization: record.display?.specialization || record.raw_source_data?.specialization,
      source_url: record.display?.source_url || record.raw_source_data?.source_url,
      apply_url: record.display?.application_url || record.raw_source_data?.apply_url,
      id: record.id
    };
    const key = dedupeKey(candidate);
    if (!octopusUniverse.has(key)) octopusUniverse.set(key, candidate);
  });

  const octopusConsidered = Array.from(octopusUniverse.values()).map((job) => {
    const priority = scoreOctopusPriority(job);
    return {
      job,
      priority_score: Number(priority.score || 0),
      reasons: priority.reasons || [],
      excluded: priority.excluded
    };
  }).sort((left, right) => right.priority_score - left.priority_score || text(left.job.title).localeCompare(text(right.job.title)));

  const octopusRestored = octopusConsidered.filter((entry) => !entry.excluded).slice(0, OCTOPUS_MAX_RESTORES);
  const octopusExcluded = octopusConsidered
    .filter((entry) => octopusRestored.every((restored) => text(restored.job.id) !== text(entry.job.id)))
    .map((entry) => ({
      id: text(entry.job.id),
      title: text(entry.job.title),
      exclusion_reason: entry.excluded ? (entry.reasons[0] || "octopus_low_priority_role") : "octopus_restore_cap_reached",
      priority_score: entry.priority_score
    }));

  const nonOctopusCandidates = jobs2Missing
    .filter((job) => !isOctopus(job))
    .map((job) => {
      const best = oldjobsByKey.get(dedupeKey(job)) || job;
      const score = scoreMissionRecovery(best);
      return {
        job: best,
        restore_score: score.score,
        reasons: score.reasons,
        excluded: score.excluded
      };
    })
    .filter((entry) => !entry.excluded)
    .sort((left, right) => right.restore_score - left.restore_score || text(left.job.title).localeCompare(text(right.job.title)));

  const nonOctopusRestores = nonOctopusCandidates.filter((entry) => entry.restore_score >= 12).slice(0, 8);
  const restoreEntries = [...nonOctopusRestores.map((entry) => entry.job), ...octopusRestored.map((entry) => entry.job)];

  const restoredIds = new Set(restoreEntries.map((job) => text(job.id)).filter(Boolean));
  const octopusRestoredIds = new Set(octopusRestored.map((entry) => text(entry.job.id)).filter(Boolean));
  const nextRecords = existingRecords.map((record) => {
    if (isOctopus(record.raw_source_data || record.display || {}) && record.published === true && record.public_visibility === true && !octopusRestoredIds.has(text(record.id))) {
      return markRemoved(record, "octopus_recovery_reprioritized", { now });
    }
    if (!restoredIds.has(text(record.id))) return record;
    const restoreJob = restoreEntries.find((job) => text(job.id) === text(record.id));
    return restorePublishedRecord(restoreJob, record, now);
  });

  restoreEntries.forEach((job) => {
    if (existingById.has(text(job.id))) return;
    nextRecords.push(restorePublishedRecord(job, {}, now));
  });

  await writeJson(JOB_RECORDS_FILE, nextRecords);
  const syncedRecords = await readJobRecords();
  const publicSync = await syncPublicJobsFromRecords(syncedRecords, {
    label: "jobs:recover-jobs2-public",
    preserveMissingPublishedRecords: true
  });
  const publicJobs = buildPublicJobsFromRecords(syncedRecords);

  const report = {
    generated_at: now.toISOString(),
    before_public_count: Array.isArray(existingJobs) ? existingJobs.length : 0,
    after_public_count: publicJobs.length,
    restored_ids: Array.from(restoredIds),
    restored_non_octopus_titles: nonOctopusRestores.map((entry) => ({
      id: text(entry.job.id),
      organization: text(entry.job.organization),
      title: text(entry.job.title),
      restore_score: entry.restore_score
    })),
    octopus: {
      considered_count: octopusConsidered.length,
      restored_count: octopusRestored.length,
      excluded_count: octopusExcluded.length,
      restored_titles: octopusRestored.map((entry) => ({
        id: text(entry.job.id),
        title: text(entry.job.title),
        priority_score: entry.priority_score
      })),
      excluded_titles: octopusExcluded
    },
    wrote_jobs_json: Boolean(publicSync.wrote)
  };

  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`[jobs:recover-jobs2-public] restored_total=${restoreEntries.length}`);
  console.log(`[jobs:recover-jobs2-public] restored_octopus=${octopusRestored.length}`);
  console.log(`[jobs:recover-jobs2-public] restored_non_octopus=${nonOctopusRestores.length}`);
  console.log(`[jobs:recover-jobs2-public] public_count_after=${publicJobs.length}`);
}

main().catch((error) => {
  console.error(`[jobs:recover-jobs2-public] Failed: ${error.message}`);
  process.exitCode = 1;
});
