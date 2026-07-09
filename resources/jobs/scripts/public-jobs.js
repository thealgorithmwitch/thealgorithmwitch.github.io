const path = require("path");
const { stringifySafe } = require("./job-normalizer");
const { JOBS_FILE, readJobs, readJson, serializeForWrite, writeJson } = require("./job-utils");
const { canonicalizeJobShape } = require("./canonical-job-shape");
const { readJobRecords } = require("./public-records");
const { buildJobPagePathMap, cleanVisibleText } = require("./job-page-paths");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");
const {
  compareJobsOutputs,
  getCanonicalDescription,
  getCanonicalLocation,
  getCanonicalPay,
  getCanonicalSnippet,
  getCanonicalWorkplaceType,
  isJunkDescription,
  isSuspiciousPayDowngrade
} = require("./public-data-guard");

const ROOT = path.resolve(__dirname, "..");
const CLEANUP_REPORT_FILE = path.join(ROOT, "reports", "cleanup-stale-jobs-latest.json");

const PAY_FIELDS = [
  "salary",
  "raw_salary",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "salary_visible",
  "pay_display"
];

function isBlankText(value) {
  return !String(value ?? "").trim();
}

function hasHardInvalidPay(job = {}) {
  const values = [job.salary_min, job.salary_max, job.display?.salary_min, job.display?.salary_max]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return values.some((value) => value === 0 || value === 6 || value > 500000);
}

function mergeSafePublicJob(current = {}, proposed = {}) {
  const next = { ...proposed };
  const currentDescription = getCanonicalDescription(current);
  const proposedDescription = getCanonicalDescription(proposed);
  if (currentDescription && (!proposedDescription || isJunkDescription(proposedDescription))) {
    next.description = current.description;
  }
  if (currentDescription && proposedDescription && !isJunkDescription(currentDescription) && !isJunkDescription(proposedDescription)) {
    if (currentDescription.length >= proposedDescription.length * 2 && currentDescription.length >= 200) {
      next.description = current.description;
    }
  }

  const currentSnippet = getCanonicalSnippet(current);
  const proposedSnippet = getCanonicalSnippet(proposed);
  if (currentSnippet && (!proposedSnippet || isJunkDescription(proposedSnippet))) {
    if (!isBlankText(current.description_snippet)) next.description_snippet = current.description_snippet;
    if (!isBlankText(current.summary)) next.summary = current.summary;
  }

  const currentPay = getCanonicalPay(current);
  const proposedPay = getCanonicalPay(proposed);
  if (currentPay && !hasHardInvalidPay(current) && (!proposedPay || isSuspiciousPayDowngrade(currentPay, proposedPay))) {
    for (const field of PAY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(current, field) && !isBlankText(current[field])) {
        next[field] = current[field];
      }
    }
    if (current.display && typeof current.display === "object") {
      const nextDisplay = next.display && typeof next.display === "object" ? { ...next.display } : {};
      for (const field of ["pay_display", "salary_min", "salary_max", "salary_currency", "salary_period", "salary_visible"]) {
        if (Object.prototype.hasOwnProperty.call(current.display, field) && !isBlankText(current.display[field])) {
          nextDisplay[field] = current.display[field];
        }
      }
      next.display = nextDisplay;
    }
  }

  const currentLocation = getCanonicalLocation(current);
  const proposedLocation = getCanonicalLocation(proposed);
  if (currentLocation && !proposedLocation) {
    next.location = current.location;
  }

  const currentWorkplaceType = getCanonicalWorkplaceType(current);
  const proposedWorkplaceType = getCanonicalWorkplaceType(proposed);
  if (currentWorkplaceType && !proposedWorkplaceType) {
    next.workplace_type = current.workplace_type;
  }

  if (!isBlankText(current.specialization) && isBlankText(proposed.specialization)) {
    next.specialization = current.specialization;
  }

  if (!isBlankText(current.page_url) && isBlankText(proposed.page_url)) {
    next.page_url = current.page_url;
  }

  return next;
}

function mergeSafePublicJobs(existingJobs = [], proposedJobs = []) {
  const currentById = new Map((Array.isArray(existingJobs) ? existingJobs : []).map((job) => [String(job && job.id || ""), job]));
  return (Array.isArray(proposedJobs) ? proposedJobs : []).map((job) => {
    const current = currentById.get(String(job && job.id || ""));
    if (!current) return job;
    return mergeSafePublicJob(current, job);
  });
}

function attachRedirectPaths(existingJobs = [], proposedJobs = []) {
  const existingById = new Map((Array.isArray(existingJobs) ? existingJobs : []).map((job) => [String(job && job.id || ""), job]));
  return (Array.isArray(proposedJobs) ? proposedJobs : []).map((job) => {
    const current = existingById.get(String(job && job.id || "")) || {};
    const existingPageUrl = String(current.page_url || "").trim();
    const redirectPaths = new Set(
      Array.isArray(job.redirect_paths)
        ? job.redirect_paths.map((item) => String(item || "").trim()).filter(Boolean)
        : []
    );
    if (existingPageUrl && existingPageUrl !== job.page_url) {
      redirectPaths.add(existingPageUrl);
    }
    redirectPaths.delete(job.page_url);
    return {
      ...job,
      redirect_paths: Array.from(redirectPaths)
    };
  });
}

function enrichPublicJob(job) {
  const canonical = canonicalizeJobShape(job, { alreadyNormalized: true }) || canonicalizeJobShape(job) || job;
  const title = cleanVisibleText(stringifySafe(canonical?.title));
  const organization = cleanVisibleText(stringifySafe(canonical?.organization));
  const source = cleanVisibleText(stringifySafe(canonical?.source));
  return {
    ...canonical,
    title: title || stringifySafe(canonical?.title),
    organization: organization || stringifySafe(canonical?.organization),
    source: source || stringifySafe(canonical?.source)
  };
}

function normalizeIdSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

async function resolveExplainedDropAllowance(existingJobs = [], nextJobs = [], options = {}) {
  const existingIds = normalizeIdSet((Array.isArray(existingJobs) ? existingJobs : []).map((job) => job && job.id));
  const nextIds = normalizeIdSet((Array.isArray(nextJobs) ? nextJobs : []).map((job) => job && job.id));
  const removedIds = Array.from(existingIds).filter((id) => !nextIds.has(id));
  const explicitExplainedIds = normalizeIdSet(options.explainedRemovedIds || []);

  let reportExplainedIds = new Set();
  let cleanupReport = null;
  try {
    cleanupReport = await readJson(CLEANUP_REPORT_FILE, null);
  } catch (_error) {
    cleanupReport = null;
  }

  if (
    cleanupReport &&
    cleanupReport.mode === "write" &&
    Number(cleanupReport.before_public_count || 0) === (Array.isArray(existingJobs) ? existingJobs.length : 0)
  ) {
    reportExplainedIds = normalizeIdSet(
      cleanupReport.explained_removed_public_job_ids
      || cleanupReport.removed_public_job_ids
      || []
    );
  }

  const explainedIds = new Set([...explicitExplainedIds, ...reportExplainedIds]);
  const unexplainedRemovedIds = removedIds.filter((id) => !explainedIds.has(id));

  return {
    allowed: removedIds.length > 0 && unexplainedRemovedIds.length === 0,
    removedIds,
    explainedIds: Array.from(explainedIds),
    unexplainedRemovedIds,
    cleanupReport
  };
}

function attachPublicJobPageUrls(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const { map: pagePathMap } = buildJobPagePathMap(list);
  return list.map((job) => ({
    ...job,
    page_url: pagePathMap.get(String(job.id || "")) || `./pages/${String(job.id || "job")}.html`
  }));
}

function buildPublicJobsFromRecords(records) {
  const publicJobs = (Array.isArray(records) ? records : [])
    .filter((record) => record && record.record_type === "job" && shouldShowPublicRecord(record))
    .map(resolveDisplayJobFromRecord);
  return attachPublicJobPageUrls(publicJobs.map(enrichPublicJob));
}

function countPublishedJobRecords(records) {
  return buildPublicJobsFromRecords(records).length;
}

async function syncPublicJobsFromRecords(records, options = {}) {
  const label = options.label || "jobs:public-records";
  const logger = options.logger || console;
  const allowWorseOverwrite = options.allowWorseOverwrite === true;
  const dryRun = options.dryRun === true;
  const scopeIds = new Set((options.scopeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const scoped = scopeIds.size > 0;
  const existingJobs = await readJobs();
  const existingById = new Map((Array.isArray(existingJobs) ? existingJobs : []).map((job) => [String(job.id || ""), job]));
  const computedPublicJobs = buildPublicJobsFromRecords(records);
  const publicJobs = scoped
    ? (() => {
        const scopedComputedById = new Map(computedPublicJobs
          .filter((job) => scopeIds.has(String(job.id || "")))
          .map((job) => [String(job.id || ""), job]));
        const merged = [];
        const appendedScopeIds = new Set();
        for (const existingJob of Array.isArray(existingJobs) ? existingJobs : []) {
          const id = String(existingJob.id || "");
          if (!scopeIds.has(id)) {
            merged.push(existingJob);
            continue;
          }
          const scopedJob = scopedComputedById.get(id);
          if (scopedJob) {
            merged.push(scopedJob);
            appendedScopeIds.add(id);
          }
        }
        for (const [id, scopedJob] of scopedComputedById.entries()) {
          if (appendedScopeIds.has(id)) continue;
          merged.push(scopedJob);
        }
        return merged;
      })()
    : computedPublicJobs;
  const safePublicJobs = mergeSafePublicJobs(existingJobs, publicJobs);
  const existingJobsJsonCount = Array.isArray(existingJobs) ? existingJobs.length : 0;
  const computedPublicJobsCount = safePublicJobs.length;
  const overwriteAudit = compareJobsOutputs(existingJobs, publicJobs, {
    scopeIds: scoped ? Array.from(scopeIds) : []
  });
  const safeOverwriteAudit = compareJobsOutputs(existingJobs, safePublicJobs, {
    scopeIds: scoped ? Array.from(scopeIds) : []
  });
  const existingSerialized = serializeForWrite(JOBS_FILE, existingJobs);
  const nextSerialized = serializeForWrite(JOBS_FILE, attachRedirectPaths(existingJobs, safePublicJobs));
  const shouldWrite = existingJobsJsonCount !== computedPublicJobsCount || existingSerialized !== nextSerialized;
  let wrote = false;

  logger.log(
    `[${label}] scoped=${scoped} selected_ids_count=${scopeIds.size} public_jobs_changed=${overwriteAudit.field_counts.jobs_changed} unrelated_jobs_changed=${overwriteAudit.field_counts.unrelated_jobs_changed} descriptions_replaced=${overwriteAudit.field_counts.descriptions_replaced} snippets_replaced=${overwriteAudit.field_counts.snippets_replaced} pay_fields_replaced=${overwriteAudit.field_counts.pay_fields_replaced} locations_replaced=${overwriteAudit.field_counts.locations_replaced} specializations_replaced=${overwriteAudit.field_counts.specializations_replaced} page_urls_changed=${overwriteAudit.field_counts.page_urls_changed}`
  );
  overwriteAudit.risky_examples.slice(0, 10).forEach((example) => {
    logger.log(
      `[${label}] risky_change id=${example.id} title=${example.title} organization=${example.organization} current_pay=${example.current_pay} proposed_pay=${example.proposed_pay} current_location=${example.current_location} proposed_location=${example.proposed_location}`
    );
  });

  if (overwriteAudit.worse_reasons.length && !allowWorseOverwrite) {
    logger.warn(
      `[${label}] jobs_json_sync_skipped_risky_changes=${overwriteAudit.risky_examples.length}`
    );
  }

  if (shouldWrite && !dryRun) {
    const expectedCount = computedPublicJobsCount;
    if (expectedCount < Math.max(existingJobsJsonCount * 0.8, 1)) {
      const explainedDrop = await resolveExplainedDropAllowance(existingJobs, safePublicJobs, options);
      if (!explainedDrop.allowed) {
        throw new Error(
          `Refusing to overwrite jobs.json: expected ${expectedCount} jobs vs ${existingJobsJsonCount} existing (drop >20%)`
        );
      }
      logger.log(
        `[${label}] jobs_json_sync_allowed_explained_drop=true removed_count=${explainedDrop.removedIds.length} unexplained_removed_count=${explainedDrop.unexplainedRemovedIds.length}`
      );
    }
    await writeJson(JOBS_FILE, attachRedirectPaths(existingJobs, safePublicJobs));
    const writtenJobs = await readJobs();
    const writtenCount = Array.isArray(writtenJobs) ? writtenJobs.length : 0;
    if (writtenCount !== expectedCount) {
      throw new Error(`jobs.json sync mismatch: expected ${expectedCount} public jobs, found ${writtenCount}`);
    }
    wrote = true;
  }
  let finalJobsJson;
  try {
    finalJobsJson = await readJobs();
  } catch (readError) {
    finalJobsJson = null;
  }
  const finalJobsJsonCount = Array.isArray(finalJobsJson) ? finalJobsJson.length : computedPublicJobsCount;

  const descriptionSnippetGeneratedCount = safePublicJobs.filter((job) => String(job.description_snippet || "").trim()).length;
  const descriptionCleanedCount = safePublicJobs.filter((job) => {
    const description = String(job.description || "").trim();
    const rawDescription = String(job.raw_description || "").trim();
    return Boolean(description) && description !== rawDescription;
  }).length;

  logger.log(
    `[${label}] existing_jobs_json_count=${existingJobsJsonCount} computed_public_jobs_count=${computedPublicJobsCount} wrote_jobs_json=${wrote} dry_run=${dryRun} write_path=${JOBS_FILE}`
  );
  logger.log(
    `[${label}] description_snippet_generated_count=${descriptionSnippetGeneratedCount} description_cleaned_count=${descriptionCleanedCount}`
  );

  return {
    publicJobs,
    jobsCountBefore: existingJobsJsonCount,
    jobsCount: finalJobsJsonCount,
    jobsCountAfter: finalJobsJsonCount,
    publishedCount: computedPublicJobsCount,
    wrote,
    overwriteAudit: safeOverwriteAudit
  };
}

async function main() {
  const records = await readJobRecords();
  const result = await syncPublicJobsFromRecords(records, { label: "jobs:refresh-public" });
  console.log(`[jobs:refresh-public] job_records_public_count=${result.publishedCount}`);
  console.log(`[jobs:refresh-public] jobs_json_count_before=${result.jobsCountBefore}`);
  console.log(`[jobs:refresh-public] jobs_json_count_after=${result.jobsCountAfter}`);
  console.log(`[jobs:refresh-public] page_build_safe=${result.jobsCountAfter >= result.publishedCount}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:refresh-public] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  attachPublicJobPageUrls,
  buildPublicJobsFromRecords,
  countPublishedJobRecords,
  resolveExplainedDropAllowance,
  syncPublicJobsFromRecords
};
