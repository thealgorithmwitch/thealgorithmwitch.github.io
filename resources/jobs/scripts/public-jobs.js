const { stringifySafe } = require("./job-normalizer");
const { JOBS_FILE, readJobs, serializeForWrite, writeJson } = require("./job-utils");
const { canonicalizeJobShape } = require("./canonical-job-shape");
const { readJobRecords } = require("./public-records");
const { buildJobPagePathMap, cleanVisibleText } = require("./job-page-paths");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");
const { compareJobsOutputs } = require("./public-data-guard");

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
  const computedPublicJobs = buildPublicJobsFromRecords(records).map((job) => {
    const existing = existingById.get(String(job.id || "")) || {};
    const existingPageUrl = String(existing.page_url || "").trim();
    const redirectPaths = new Set(Array.isArray(existing.redirect_paths) ? existing.redirect_paths.map((item) => String(item || "").trim()).filter(Boolean) : []);
    if (existingPageUrl && existingPageUrl !== job.page_url) {
      redirectPaths.add(existingPageUrl);
    }
    redirectPaths.delete(job.page_url);
    return {
      ...job,
      redirect_paths: Array.from(redirectPaths)
    };
  });
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
  const existingJobsJsonCount = Array.isArray(existingJobs) ? existingJobs.length : 0;
  const computedPublicJobsCount = publicJobs.length;
  const overwriteAudit = compareJobsOutputs(existingJobs, publicJobs, {
    scopeIds: scoped ? Array.from(scopeIds) : []
  });
  const existingSerialized = serializeForWrite(JOBS_FILE, existingJobs);
  const nextSerialized = serializeForWrite(JOBS_FILE, publicJobs);
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
    throw new Error(`Refusing to overwrite jobs.json: ${overwriteAudit.worse_reasons.join("; ")}`);
  }

  if (shouldWrite && !dryRun) {
    await writeJson(JOBS_FILE, publicJobs);
    wrote = true;
  }

  const finalJobs = dryRun ? existingJobs : await readJobs();
  const finalJobsJsonCount = dryRun ? existingJobsJsonCount : (Array.isArray(finalJobs) ? finalJobs.length : 0);
  const syncMismatch = dryRun ? false : finalJobsJsonCount !== computedPublicJobsCount;
  const descriptionSnippetGeneratedCount = publicJobs.filter((job) => String(job.description_snippet || "").trim()).length;
  const descriptionCleanedCount = publicJobs.filter((job) => {
    const description = String(job.description || "").trim();
    const rawDescription = String(job.raw_description || "").trim();
    return Boolean(description) && description !== rawDescription;
  }).length;

  logger.log(
    `[${label}] existing_jobs_json_count=${existingJobsJsonCount} computed_public_jobs_count=${computedPublicJobsCount} final_jobs_json_count=${finalJobsJsonCount} wrote_jobs_json=${wrote} dry_run=${dryRun} write_path=${JOBS_FILE} sync_mismatch=${syncMismatch}`
  );
  logger.log(
    `[${label}] description_snippet_generated_count=${descriptionSnippetGeneratedCount} description_cleaned_count=${descriptionCleanedCount}`
  );

  if (syncMismatch) {
    throw new Error(`jobs.json sync mismatch: expected ${computedPublicJobsCount} public jobs, found ${finalJobsJsonCount}`);
  }

  return {
    publicJobs,
    jobsCountBefore: existingJobsJsonCount,
    jobsCount: dryRun ? computedPublicJobsCount : finalJobsJsonCount,
    jobsCountAfter: dryRun ? computedPublicJobsCount : finalJobsJsonCount,
    publishedCount: computedPublicJobsCount,
    wrote,
    overwriteAudit
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
  syncPublicJobsFromRecords
};
