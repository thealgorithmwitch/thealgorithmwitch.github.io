const { JOBS_FILE, PENDING_SYNCED_FILE, readJson, writeJsonIfChanged } = require("./job-utils");
const { JOB_RECORDS_FILE } = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { normalizeJob, normalizeEmploymentType, normalizeWorkplaceType, stringifySafe } = require("./job-normalizer");

const WRITE = process.argv.includes("--write");
const EXAMPLE_LIMIT = 12;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLower(value) {
  return cleanText(value).toLowerCase();
}

function isClimateChangeJobsJob(job = {}) {
  const haystack = [
    job.source_id,
    job.source,
    job.notes,
    job.source_url,
    job.apply_url,
    job.original_url
  ].map(normalizeLower).join(" ");
  return haystack.includes("climatechangejobs");
}

function isClimateChangeJobsUrl(value) {
  return /https?:\/\/[^/\s]*climatechangejobs\.com/i.test(String(value || ""));
}

function isClearlyWrongOrganization(value) {
  const normalized = normalizeLower(value);
  if (!normalized) return true;
  return (
    normalized === "unknown organization" ||
    normalized === "climatechangejobs" ||
    normalized === "climate change jobs" ||
    normalized === "greenjobsearch" ||
    normalized === "green jobs network"
  );
}

function looksBoilerplateDescription(value) {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /^jobs search\b/i.test(text) ||
    /\b(?:apply now|view opening|search jobs|join talent community|privacy policy|equal opportunity employer)\b/i.test(text) ||
    /\bno\s*wrap\b|\bnowrap\b/i.test(text) ||
    /(?:previous|next)\s+post/i.test(text)
  );
}

function looksArticleLikeDescription(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^jobs search\b/i.test(text)) return true;
  if (/\b(?:\d+[mhdy]\s+ago|green jobs network)\b/i.test(text) && !/\b(?:will|supports|manages|develops|partners|builds|leads|seeks)\b/i.test(text)) {
    return true;
  }
  return false;
}

function descriptionQualityScore(value) {
  const text = cleanText(value);
  if (!text) return 0;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const usefulSentences = sentences.filter((sentence) => /\b(?:will|supports|manages|develops|partners|builds|leads|seeks|coordinates|works)\b/i.test(sentence));
  return usefulSentences.length * 3 + Math.min(text.length, 240) / 80;
}

function shouldReplaceDescription(currentValue, nextValue) {
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate) return false;
  if (!current) return true;
  if (looksBoilerplateDescription(current) || looksArticleLikeDescription(current)) return true;
  return descriptionQualityScore(candidate) >= descriptionQualityScore(current) + 2;
}

function shouldReplaceApplyUrl(currentValue, nextValue) {
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate) return false;
  if (!current) return true;
  if (isClimateChangeJobsUrl(current) && !isClimateChangeJobsUrl(candidate)) return true;
  return false;
}

function maybeReplaceField(container, key, nextValue, stats, statKey, context, options = {}) {
  const currentValue = container[key];
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate || current === candidate) return false;

  const shouldReplace = options.shouldReplace ? options.shouldReplace(current, candidate, context) : true;
  if (!shouldReplace) {
    if (options.countSkip) stats.skipped_manual_looking_fields += 1;
    return false;
  }

  container[key] = nextValue;
  stats[statKey] += 1;
  if (stats.examples.length < EXAMPLE_LIMIT) {
    stats.examples.push({
      id: context.id,
      field: key,
      before: current,
      after: candidate
    });
  }
  return true;
}

function migratePendingJob(job, stats) {
  const next = { ...job };
  const candidate = normalizeJob(job);

  maybeReplaceField(next, "workplace_type", candidate.workplace_type, stats, "workplace_fixes", { id: job.id });
  maybeReplaceField(next, "job_type", candidate.job_type, stats, "employment_type_fixes", { id: job.id });

  if (isClimateChangeJobsJob(job)) {
    maybeReplaceField(next, "apply_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id: job.id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(next, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id: job.id }, {
      shouldReplace: shouldReplaceApplyUrl
    });

    if (!isClearlyWrongOrganization(candidate.organization)) {
      maybeReplaceField(next, "organization", candidate.organization, stats, "organization_fixes", { id: job.id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
    }

    if (candidate.parse_warning) {
      next.parse_warning = candidate.parse_warning;
      next.triage_bucket = "needs_cleanup";
      next.triage_reason = candidate.triage_reason || "ClimateChangeJobs organization uncertain";
    }
  }

  maybeReplaceField(next, "description", candidate.description, stats, "description_fixes", { id: job.id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });

  return next;
}

function migrateJobRecord(record, stats) {
  const raw = record.raw_source_data && typeof record.raw_source_data === "object" ? { ...record.raw_source_data } : {};
  const display = record.display && typeof record.display === "object" ? { ...record.display } : {};
  const candidate = normalizeJob(raw);
  const id = record.id || raw.id || "";

  maybeReplaceField(raw, "workplace_type", candidate.workplace_type, stats, "workplace_fixes", { id });
  maybeReplaceField(display, "location_type", candidate.workplace_type, stats, "workplace_fixes", { id });

  maybeReplaceField(raw, "job_type", candidate.job_type, stats, "employment_type_fixes", { id });
  maybeReplaceField(display, "role_type", candidate.job_type, stats, "employment_type_fixes", { id });

  if (isClimateChangeJobsJob(raw)) {
    maybeReplaceField(raw, "apply_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(raw, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(display, "application_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(display, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });

    if (!isClearlyWrongOrganization(candidate.organization)) {
      maybeReplaceField(raw, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
      maybeReplaceField(display, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => !cleanText(current) || isClearlyWrongOrganization(current),
        countSkip: true
      });
    }

    if (candidate.parse_warning) {
      raw.parse_warning = candidate.parse_warning;
      raw.triage_bucket = "needs_cleanup";
      raw.triage_reason = candidate.triage_reason || "ClimateChangeJobs organization uncertain";
    }
  }

  maybeReplaceField(raw, "description", candidate.description, stats, "description_fixes", { id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });
  maybeReplaceField(display, "description", candidate.description, stats, "description_fixes", { id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });

  return {
    ...record,
    raw_source_data: raw,
    display
  };
}

async function main() {
  const stats = {
    records_scanned: 0,
    pending_scanned: 0,
    workplace_fixes: 0,
    employment_type_fixes: 0,
    climate_apply_url_fixes: 0,
    organization_fixes: 0,
    description_fixes: 0,
    skipped_manual_looking_fields: 0,
    examples: []
  };

  const records = await readJson(JOB_RECORDS_FILE, []);
  const pending = await readJson(PENDING_SYNCED_FILE, []);

  const nextRecords = (Array.isArray(records) ? records : []).map((record) => {
    stats.records_scanned += 1;
    return migrateJobRecord(record, stats);
  });

  const nextPending = (Array.isArray(pending) ? pending : []).map((job) => {
    stats.pending_scanned += 1;
    return migratePendingJob(job, stats);
  });

  if (WRITE) {
    await writeJsonIfChanged(JOB_RECORDS_FILE, nextRecords);
    await writeJsonIfChanged(PENDING_SYNCED_FILE, nextPending);
    await syncPublicJobsFromRecords(nextRecords, { label: "jobs:migrate-existing" });
  }

  console.log(`mode: ${WRITE ? "write" : "dry-run"}`);
  console.log(`records scanned: ${stats.records_scanned}`);
  console.log(`pending scanned: ${stats.pending_scanned}`);
  console.log(`workplace fixes: ${stats.workplace_fixes}`);
  console.log(`employment type fixes: ${stats.employment_type_fixes}`);
  console.log(`ClimateChangeJobs apply URL fixes: ${stats.climate_apply_url_fixes}`);
  console.log(`organization fixes: ${stats.organization_fixes}`);
  console.log(`description fixes: ${stats.description_fixes}`);
  console.log(`skipped manual-looking fields: ${stats.skipped_manual_looking_fields}`);
  console.log("examples before/after:");
  if (!stats.examples.length) {
    console.log("- none");
  } else {
    stats.examples.forEach((example) => {
      console.log(`- ${example.id} ${example.field}: "${example.before}" -> "${example.after}"`);
    });
  }
  if (WRITE) {
    console.log(`wrote: ${JOB_RECORDS_FILE}`);
    console.log(`wrote: ${PENDING_SYNCED_FILE}`);
    console.log(`regenerated: ${JOBS_FILE}`);
  }
}

main().catch((error) => {
  console.error(`[jobs:migrate-existing] Failed: ${error.message}`);
  process.exitCode = 1;
});
