const {
  JOBS_FILE,
  writeJson
} = require("./job-utils");
const {
  buildJobRecord,
  JOB_RECORDS_FILE,
  readJobRecords
} = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { stringifySafe } = require("./job-normalizer");

function buildJobsById(jobs) {
  const map = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const id = String(job && job.id || "").trim();
    if (id) map.set(id, job);
  }
  return map;
}

function existingManualOverrideFields(record, publicJob) {
  const fields = new Set(
    []
      .concat(Array.isArray(record.manual_overrides) ? record.manual_overrides : [])
      .concat(Array.isArray(record.protected_fields) ? record.protected_fields : [])
  );

  const display = record.display || {};
  const raw = record.raw_source_data || {};
  if (publicJob && stringifySafe(publicJob.salary) && stringifySafe(publicJob.salary) !== stringifySafe(display.pay_display || raw.salary)) {
    fields.add("display.pay_display");
    fields.add("raw_source_data.salary");
  }
  if (publicJob && stringifySafe(publicJob.location) && stringifySafe(publicJob.location) !== stringifySafe(display.location || raw.location)) {
    fields.add("display.location");
    fields.add("raw_source_data.location");
  }
  if (publicJob && stringifySafe(publicJob.workplace_type) && stringifySafe(publicJob.workplace_type) !== stringifySafe(display.location_type || raw.workplace_type)) {
    fields.add("display.location_type");
    fields.add("raw_source_data.workplace_type");
  }
  if (publicJob && stringifySafe(publicJob.description) && stringifySafe(publicJob.description) !== stringifySafe(display.description || raw.description)) {
    fields.add("display.description");
    fields.add("raw_source_data.description");
  }
  if (publicJob && stringifySafe(publicJob.title) && stringifySafe(publicJob.title) !== stringifySafe(display.title || raw.title)) {
    fields.add("display.title");
    fields.add("raw_source_data.title");
  }
  if (publicJob && stringifySafe(publicJob.organization) && stringifySafe(publicJob.organization) !== stringifySafe(display.organization || raw.organization)) {
    fields.add("display.organization");
    fields.add("raw_source_data.organization");
  }
  return Array.from(fields);
}

function summarizeDifferences(before, after) {
  const changed = [];
  const beforeDisplay = before.display || {};
  const afterDisplay = after.display || {};
  if (stringifySafe(beforeDisplay.pay_display) !== stringifySafe(afterDisplay.pay_display)) changed.push("pay");
  if (stringifySafe(beforeDisplay.location) !== stringifySafe(afterDisplay.location)) changed.push("location");
  if (stringifySafe(beforeDisplay.location_type) !== stringifySafe(afterDisplay.location_type)) changed.push("workplace_type");
  if (stringifySafe(beforeDisplay.description) !== stringifySafe(afterDisplay.description)) changed.push("description");
  if (stringifySafe(beforeDisplay.title) !== stringifySafe(afterDisplay.title)) changed.push("title");
  if (stringifySafe(beforeDisplay.organization) !== stringifySafe(afterDisplay.organization)) changed.push("organization");
  return changed;
}

async function main() {
  const [records, jobs] = await Promise.all([
    readJobRecords(),
    require("./job-utils").readJobs()
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
      description: stringifySafe(publicJob?.description || display.description || raw.description || raw.raw_description),
      source: stringifySafe(publicJob?.source || display.source_name || raw.source),
      source_url: stringifySafe(publicJob?.source_url || display.source_url || raw.source_url),
      original_url: stringifySafe(publicJob?.original_url || display.original_url || raw.original_url || raw.source_url),
      apply_url: stringifySafe(publicJob?.apply_url || display.application_url || raw.apply_url),
      status: stringifySafe(raw.status || record.status)
    };

    const repaired = buildJobRecord(nextInput, {
      ...record,
      manual_overrides: existingManualOverrideFields(record, publicJob)
    });
    const changedFields = summarizeDifferences(record, repaired);
    if (changedFields.length) {
      changedExamples.push({
        id: repaired.id,
        title: repaired.display?.title || repaired.raw_source_data?.title,
        changed_fields: changedFields,
        before_pay: record.display?.pay_display || "",
        after_pay: repaired.display?.pay_display || "",
        before_location: record.display?.location || "",
        after_location: repaired.display?.location || ""
      });
    }
    repairedRecords.push(repaired);
  }

  await writeJson(JOB_RECORDS_FILE, repairedRecords);
  const publicSync = await syncPublicJobsFromRecords(repairedRecords, { label: "jobs:repair-pay-data" });

  console.log(`[jobs:repair-pay-data] job_records_before=${records.length} job_records_after=${repairedRecords.length}`);
  console.log(`[jobs:repair-pay-data] jobs_json_before=${jobs.length} jobs_json_after=${publicSync.jobsCountAfter}`);
  console.log(`[jobs:repair-pay-data] changed_records=${changedExamples.length}`);
  changedExamples.slice(0, 20).forEach((example) => {
    console.log(
      `[jobs:repair-pay-data] example id=${example.id} title=${example.title} changed_fields=${example.changed_fields.join(",")} before_pay=${example.before_pay || "(blank)"} after_pay=${example.after_pay || "(blank)"} before_location=${example.before_location || "(blank)"} after_location=${example.after_location || "(blank)"}`
    );
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:repair-pay-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
