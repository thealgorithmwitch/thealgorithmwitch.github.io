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
const { CANONICAL_SPECIALIZATIONS, hasUsableDescription, normalizeJob, normalizePayDisplay, stringifySafe } = require("./job-normalizer");
const { buildValidationReport } = require("./validate-public-data");

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

function existingManualOverrideFields(record, publicJob) {
  const fields = new Set(
    []
      .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
      .concat(Array.isArray(record.protected_fields) ? record.protected_fields : [])
  );

  const display = record.display || {};
  const raw = record.raw_source_data || {};
  const protectedPairs = [
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

  for (const [publicKey, displayKey, rawKey] of protectedPairs) {
    const publicValue = stringifySafe(publicJob?.[publicKey]);
    const displayValue = stringifySafe(display[displayKey.split(".").pop()] || raw[rawKey.split(".").pop()]);
    if (!publicValue || publicValue === displayValue) continue;

    if (publicKey === "description" && !hasUsableDescription(publicValue, { title: publicJob?.title || display.title || raw.title })) {
      continue;
    }
    if (publicKey === "salary" && !normalizePayDisplay({ payDisplay: publicValue })) {
      continue;
    }
    if (publicKey === "specialization" && !CANONICAL_SPECIALIZATIONS.includes(publicValue)) {
      continue;
    }
    if (publicKey === "location" && /\b(?:Title Business|POINT\s*\(|locality\b|\d+\s+hours?\))/i.test(publicValue)) {
      continue;
    }

    if (publicValue && publicValue !== displayValue) {
      fields.add(displayKey);
      fields.add(rawKey);
    }
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

function deriveSalaryInput(publicJob, display, raw) {
  const normalized = normalizeJob({
    salary: stringifySafe(publicJob?.salary || display.pay_display || raw.salary)
  });
  return {
    salary: stringifySafe(normalized.salary || publicJob?.salary || display.pay_display || raw.salary),
    salary_min: normalized.salary_min ?? null,
    salary_max: normalized.salary_max ?? null,
    salary_currency: normalized.salary_currency || stringifySafe(raw.salary_currency || publicJob?.salary_currency || "Unknown"),
    salary_period: normalized.salary_period || stringifySafe(raw.salary_period || publicJob?.salary_period || "Unknown")
  };
}

async function main() {
  const [records, jobs, pendingBefore] = await Promise.all([
    readJobRecords(),
    readJobs(),
    readPendingSyncedJobs()
  ]);
  const jobsById = buildJobsById(jobs);
  const repairedRecords = [];
  const changedExamples = [];

  for (const record of Array.isArray(records) ? records : []) {
    if (record.record_type !== "job") {
      repairedRecords.push(record);
      continue;
    }

    const publicJob = jobsById.get(String(record.id || ""));
    const manualOverrideFields = existingManualOverrideFields(record, publicJob);
    const specializationProtected = manualOverrideFields.includes("display.specialization") || manualOverrideFields.includes("raw_source_data.specialization");
    const raw = record.raw_source_data || {};
    const display = record.display || {};
    const salaryInput = deriveSalaryInput(publicJob, display, raw);
    const nextInput = {
      ...raw,
      title: stringifySafe(publicJob?.title || display.title || raw.title),
      organization: stringifySafe(publicJob?.organization || display.organization || raw.organization),
      location: stringifySafe(publicJob?.location || display.location || raw.location),
      workplace_type: stringifySafe(publicJob?.workplace_type || display.location_type || raw.workplace_type),
      ...salaryInput,
      specialization: specializationProtected ? stringifySafe(publicJob?.specialization || display.specialization || raw.specialization) : "",
      description: stringifySafe(publicJob?.description || display.description || raw.description || raw.raw_description),
      source: stringifySafe(publicJob?.source || display.source_name || raw.source),
      source_url: stringifySafe(publicJob?.source_url || display.source_url || raw.source_url),
      original_url: stringifySafe(publicJob?.original_url || display.original_url || raw.original_url || raw.source_url),
      apply_url: stringifySafe(publicJob?.apply_url || display.application_url || raw.apply_url),
      page_url_override: stringifySafe(publicJob?.page_url_override || display.page_url_override || raw.page_url_override),
      status: stringifySafe(raw.status || record.status)
    };

    const repaired = buildJobRecord(nextInput, {
      ...record,
      manual_overrides: manualOverrideFields
    });
    const changedFields = summarizeDifferences(record, repaired);
    if (changedFields.length) {
      changedExamples.push({
        id: repaired.id,
        title: repaired.display?.title || repaired.raw_source_data?.title,
        changed_fields: changedFields
      });
    }
    repairedRecords.push(repaired);
  }

  const previewPublicSync = await syncPublicJobsFromRecords(repairedRecords, {
    label: "jobs:repair-public-data",
    dryRun: true,
    allowWorseOverwrite: false
  });

  console.log(
    `[jobs:repair-public-data] preview jobs_changed=${previewPublicSync.overwriteAudit.field_counts.jobs_changed} descriptions_replaced=${previewPublicSync.overwriteAudit.field_counts.descriptions_replaced} snippets_replaced=${previewPublicSync.overwriteAudit.field_counts.snippets_replaced} pay_fields_replaced=${previewPublicSync.overwriteAudit.field_counts.pay_fields_replaced} locations_replaced=${previewPublicSync.overwriteAudit.field_counts.locations_replaced} specializations_replaced=${previewPublicSync.overwriteAudit.field_counts.specializations_replaced} page_urls_changed=${previewPublicSync.overwriteAudit.field_counts.page_urls_changed}`
  );

  await writeJson(JOB_RECORDS_FILE, repairedRecords);
  const publicSync = await syncPublicJobsFromRecords(repairedRecords, { label: "jobs:repair-public-data" });
  const publicIndex = buildPublicDuplicateIndex(publicSync.publicJobs);
  const nextPending = pendingBefore.filter((job) => !isDuplicateOfPublicJob(job, publicIndex));
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  const validation = await buildValidationReport({ requirePages: false });

  console.log(`[jobs:repair-public-data] job_records_before=${records.length} job_records_after=${repairedRecords.length}`);
  console.log(`[jobs:repair-public-data] jobs_json_before=${jobs.length} jobs_json_after=${publicSync.jobsCountAfter}`);
  console.log(`[jobs:repair-public-data] pending_before=${pendingBefore.length} pending_after=${nextPending.length}`);
  console.log(`[jobs:repair-public-data] changed_records=${changedExamples.length}`);
  changedExamples.slice(0, 20).forEach((example) => {
    console.log(`[jobs:repair-public-data] example id=${example.id} title=${example.title} changed_fields=${example.changed_fields.join(",")}`);
  });
  console.log(
    `[jobs:repair-public-data] public_records_count=${validation.public_records_count} jobs_json_count=${validation.jobs_json_count} missing_page_url_count=${validation.missing_page_url_count} stale_page_url_count=${validation.stale_page_url_count} duplicate_slug_count=${validation.duplicate_slug_count} pending_public_overlap_count=${validation.pending_public_overlap_count}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:repair-public-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
