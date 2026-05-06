const {
  readJobs,
  readPendingSyncedJobs,
  writeJson,
  PENDING_SYNCED_FILE
} = require("./job-utils");
const {
  buildJobRecord,
  JOB_RECORDS_FILE,
  readJobRecords
} = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { CANONICAL_SPECIALIZATIONS, hasUsableDescription, normalizePayDisplay, stringifySafe } = require("./job-normalizer");
const { buildValidationReport } = require("./validate-public-data");
const { compareJobsOutputs } = require("./public-data-guard");

function buildJobsById(jobs) {
  const map = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const id = String(job && job.id || "").trim();
    if (id) map.set(id, job);
  }
  return map;
}

function normalizeIdentityToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function buildPublicDuplicateIndex(publicJobs) {
  const index = {
    ids: new Set(),
    urls: new Set(),
    externalIds: new Set(),
    titleOrg: new Set()
  };
  for (const job of Array.isArray(publicJobs) ? publicJobs : []) {
    const id = String(job?.id || "").trim();
    const url = normalizeUrl(job?.original_url || job?.apply_url || job?.source_url);
    const externalId = String(job?.external_id || "").trim().toLowerCase();
    const titleOrg = `${normalizeIdentityToken(job?.title)}::${normalizeIdentityToken(job?.organization)}`;
    if (id) index.ids.add(id);
    if (url) index.urls.add(url);
    if (externalId) index.externalIds.add(externalId);
    if (titleOrg !== "::") index.titleOrg.add(titleOrg);
  }
  return index;
}

function isDuplicateOfPublicJob(job, publicIndex) {
  const id = String(job?.id || "").trim();
  const url = normalizeUrl(job?.original_url || job?.apply_url || job?.source_url);
  const externalId = String(job?.external_id || "").trim().toLowerCase();
  const titleOrg = `${normalizeIdentityToken(job?.title)}::${normalizeIdentityToken(job?.organization)}`;
  return Boolean(
    (id && publicIndex.ids.has(id)) ||
    (url && publicIndex.urls.has(url)) ||
    (externalId && publicIndex.externalIds.has(externalId)) ||
    (titleOrg !== "::" && publicIndex.titleOrg.has(titleOrg))
  );
}

function buildManualOverrideFields(record, publicJob) {
  const fields = new Set(
    []
      .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
      .concat(Array.isArray(record.protected_fields) ? record.protected_fields : [])
  );
  if (!publicJob) return Array.from(fields);

  const display = record.display || {};
  const raw = record.raw_source_data || {};
  const pairs = [
    ["title", "display.title", "raw_source_data.title"],
    ["organization", "display.organization", "raw_source_data.organization"],
    ["location", "display.location", "raw_source_data.location"],
    ["workplace_type", "display.location_type", "raw_source_data.workplace_type"],
    ["salary", "display.pay_display", "raw_source_data.salary"],
    ["description", "display.description", "raw_source_data.description"],
    ["specialization", "display.specialization", "raw_source_data.specialization"],
    ["source_url", "display.source_url", "raw_source_data.source_url"],
    ["original_url", "display.original_url", "raw_source_data.original_url"],
    ["apply_url", "display.application_url", "raw_source_data.apply_url"],
    ["page_url_override", "display.page_url_override", "raw_source_data.page_url_override"]
  ];

  for (const [publicKey, displayKey, rawKey] of pairs) {
    const publicValue = stringifySafe(publicJob?.[publicKey]);
    const currentValue = stringifySafe(display[displayKey.split(".").pop()] || raw[rawKey.split(".").pop()]);
    if (!publicValue || publicValue === currentValue) continue;
    if (publicKey === "description" && !hasUsableDescription(publicValue, { title: publicJob?.title || display.title || raw.title })) continue;
    if (publicKey === "salary" && !normalizePayDisplay({ payDisplay: publicValue })) continue;
    if (publicKey === "specialization" && publicValue && !CANONICAL_SPECIALIZATIONS.includes(publicValue)) continue;
    fields.add(displayKey);
    fields.add(rawKey);
  }
  return Array.from(fields);
}

function summarizeDifferences(before, after) {
  const changed = [];
  const beforeDisplay = before.display || {};
  const afterDisplay = after.display || {};
  [
    "title",
    "organization",
    "location",
    "location_type",
    "pay_display",
    "specialization",
    "description",
    "source_url",
    "original_url",
    "application_url",
    "page_url_override"
  ].forEach((key) => {
    if (stringifySafe(beforeDisplay[key]) !== stringifySafe(afterDisplay[key])) changed.push(`display.${key}`);
  });
  return changed;
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const preferCurrentJobsJson = process.argv.includes("--prefer-current-jobs-json");
  const [records, jobs, pendingBefore] = await Promise.all([
    readJobRecords(),
    readJobs(),
    readPendingSyncedJobs()
  ]);

  const jobsById = buildJobsById(jobs);
  const reconciledRecords = [];
  const changedExamples = [];

  for (const record of Array.isArray(records) ? records : []) {
    if (record.record_type !== "job") {
      reconciledRecords.push(record);
      continue;
    }
    const publicJob = preferCurrentJobsJson ? jobsById.get(String(record.id || "")) : null;
    const manualOverrideFields = buildManualOverrideFields(record, publicJob);
    const raw = record.raw_source_data || {};
    const display = record.display || {};
    const nextInput = {
      ...raw,
      title: stringifySafe(publicJob?.title || display.title || raw.title),
      organization: stringifySafe(publicJob?.organization || display.organization || raw.organization),
      location: stringifySafe(publicJob?.location || display.location || raw.location),
      workplace_type: stringifySafe(publicJob?.workplace_type || display.location_type || raw.workplace_type),
      salary: stringifySafe(publicJob?.salary || display.pay_display || raw.salary),
      salary_min: publicJob?.salary_min ?? display.salary_min ?? raw.salary_min ?? null,
      salary_max: publicJob?.salary_max ?? display.salary_max ?? raw.salary_max ?? null,
      specialization: stringifySafe(publicJob?.specialization || display.specialization || raw.specialization),
      description: stringifySafe(publicJob?.description || display.description || raw.description || raw.raw_description),
      source: stringifySafe(publicJob?.source || display.source_name || raw.source),
      source_url: stringifySafe(publicJob?.source_url || display.source_url || raw.source_url),
      original_url: stringifySafe(publicJob?.original_url || display.original_url || raw.original_url || raw.source_url),
      apply_url: stringifySafe(publicJob?.apply_url || display.application_url || raw.apply_url),
      page_url_override: stringifySafe(publicJob?.page_url_override || display.page_url_override || raw.page_url_override),
      status: stringifySafe(raw.status || record.status)
    };

    const reconciled = buildJobRecord(nextInput, {
      ...record,
      manual_overrides: manualOverrideFields
    });
    const changedFields = summarizeDifferences(record, reconciled);
    if (changedFields.length) {
      changedExamples.push({
        id: reconciled.id,
        title: reconciled.display?.title || reconciled.raw_source_data?.title,
        changed_fields: changedFields
      });
    }
    reconciledRecords.push(reconciled);
  }

  const previewPublicSync = await syncPublicJobsFromRecords(reconciledRecords, {
    label: "jobs:reconcile-public-data",
    allowWorseOverwrite: false,
    dryRun: true
  }).catch((error) => ({
    error: error.message
  }));

  const dryRunAudit = previewPublicSync.error
    ? { error: previewPublicSync.error }
    : compareJobsOutputs(jobs, previewPublicSync.publicJobs);

  const report = {
    mode: shouldWrite ? "write" : "dry-run",
    prefer_current_jobs_json: preferCurrentJobsJson,
    job_records_before: records.length,
    job_records_after: reconciledRecords.length,
    jobs_json_before: jobs.length,
    jobs_changed: changedExamples.length,
    overwrite_audit: dryRunAudit,
    examples: changedExamples.slice(0, 20)
  };

  console.log(JSON.stringify(report, null, 2));

  if (!shouldWrite) {
    return;
  }
  if (previewPublicSync.error) {
    throw new Error(previewPublicSync.error);
  }

  await writeJson(JOB_RECORDS_FILE, reconciledRecords);
  const publicSync = await syncPublicJobsFromRecords(reconciledRecords, {
    label: "jobs:reconcile-public-data",
    allowWorseOverwrite: false
  });
  const publicIndex = buildPublicDuplicateIndex(publicSync.publicJobs);
  const nextPending = pendingBefore.filter((job) => !isDuplicateOfPublicJob(job, publicIndex));
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  const validation = await buildValidationReport({ requirePages: false });
  console.log(JSON.stringify({
    wrote: true,
    jobs_json_after: publicSync.jobsCountAfter,
    pending_after: nextPending.length,
    validation_errors: validation.errors
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:reconcile-public-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
