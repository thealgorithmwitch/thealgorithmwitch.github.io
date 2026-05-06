const fs = require("fs/promises");
const path = require("path");
const { readJobs, writeJson, JOBS_FILE } = require("./job-utils");
const { readJobRecords, JOB_RECORDS_FILE } = require("./public-records");
const { buildPagesForSelectedJobs } = require("./generate-job-pages");
const { buildValidationReport } = require("./validate-public-data");
const { buildDescriptionSnippet, normalizeWorkplaceType, stringifySafe } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const OLD_JOBS_FILE = path.join(ROOT, "oldjobs.json");
const PENDING_SYNCED_FILE = path.join(ROOT, "pending-synced-jobs.json");
const RESOLUTIONS_FILE = path.join(__dirname, "reconcile-public-data-resolutions.json");
const REPORT_JSON = path.join(ROOT, "reports", "elemental-impact-targeted-audit.json");
const REPORT_MD = path.join(ROOT, "reports", "elemental-impact-targeted-audit.md");

const RESOURCE_ENGINEER = "elemental-impact-446c301b54b2";
const RESOURCE_LEAD = "elemental-impact-95090d1a6bc6";

const PROTECTED_IDENTITIES = {
  [RESOURCE_ENGINEER]: {
    title: "Senior Software Engineer",
    organization: "Resource Innovations",
    location: "US - Multiple Locations",
    workplace_type: "Remote",
    page_url: "./pages/senior-software-engineer-resource-innovations.html",
    redirect_paths: ["./pages/senior-software-engineer-shifted-energy.html"],
    description:
      "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship."
  },
  [RESOURCE_LEAD]: {
    title: "Software Engineer Lead",
    organization: "Resource Innovations",
    location: "US - Multiple locations",
    workplace_type: "Remote",
    page_url: "./pages/software-engineer-lead-resource-innovations.html",
    redirect_paths: ["./pages/software-engineer-lead-shifted-energy.html"],
    description:
      "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives."
  }
};

function normalizeText(value) {
  return String(value || "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonSync(filePath, fallback) {
  try {
    return require(filePath);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return fallback;
    throw error;
  }
}

function identifyContaminatedRecords(jobs, oldJobs) {
  const results = [];
  const oldById = new Map(oldJobs.map((job) => [String(job.id || ""), job]));
  for (const job of jobs) {
    if (String(job.source_id || "") !== "elemental-impact") continue;
    const id = String(job.id || "");
    const oldJob = oldById.get(id) || {};
    const publicText = JSON.stringify({
      title: job.title,
      organization: job.organization,
      page_url: job.page_url,
      apply_url: job.apply_url,
      original_url: job.original_url,
      description: job.description,
      summary: job.summary,
      old_organization: oldJob.organization,
      old_page_url: oldJob.page_url
    });
    const applyIsResource = /apply\.workable\.com\/resource-innovations\//i.test(publicText);
    const saysShifted = /shifted energy|shifted-energy/i.test(publicText);
    const saysResource = /resource innovations|resource-innovations/i.test(publicText);
    const mismatchedResourceSlug =
      normalizeText(job.organization) === "Resource Innovations" &&
      /shifted-energy/.test(normalizeText(job.page_url));
    const mismatchedShiftedContext =
      normalizeText(job.organization) === "Shifted Energy" &&
      (applyIsResource || saysResource);
    if (mismatchedResourceSlug || mismatchedShiftedContext || (applyIsResource && saysShifted)) {
      results.push({
        id,
        title: normalizeText(job.title),
        organization: normalizeText(job.organization),
        page_url: normalizeText(job.page_url),
        apply_url: normalizeText(job.apply_url || job.original_url),
        old_organization: normalizeText(oldJob.organization),
        old_page_url: normalizeText(oldJob.page_url)
      });
    }
  }
  return results;
}

function summarizeRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    title: record.title,
    organization: record.organization,
    location: record.location,
    workplace_type: record.workplace_type,
    salary: record.salary,
    page_url: record.page_url,
    redirect_paths: record.redirect_paths,
    description: record.description,
    description_snippet: record.description_snippet,
    summary: record.summary,
    apply_url: record.apply_url,
    original_url: record.original_url,
    triage_bucket: record.triage_bucket,
    triage_reason: record.triage_reason,
    status: record.status
  };
}

function summarizeJobRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    display: {
      title: record.display?.title,
      organization: record.display?.organization,
      location: record.display?.location,
      location_type: record.display?.location_type,
      pay_display: record.display?.pay_display,
      description: record.display?.description,
      page_url_override: record.display?.page_url_override,
      application_url: record.display?.application_url,
      original_url: record.display?.original_url
    },
    raw_source_data: {
      title: record.raw_source_data?.title,
      organization: record.raw_source_data?.organization,
      location: record.raw_source_data?.location,
      workplace_type: record.raw_source_data?.workplace_type,
      salary: record.raw_source_data?.salary,
      description: record.raw_source_data?.description,
      page_url_override: record.raw_source_data?.page_url_override,
      apply_url: record.raw_source_data?.apply_url,
      original_url: record.raw_source_data?.original_url
    }
  };
}

function applyProtectedIdentity(job, spec) {
  const description = spec.description;
  const snippet = buildDescriptionSnippet(description, 220, { title: spec.title }) || description;
  const redirects = new Set(Array.isArray(job.redirect_paths) ? job.redirect_paths : []);
  if (job.page_url && job.page_url !== spec.page_url) redirects.add(job.page_url);
  for (const redirectPath of spec.redirect_paths || []) redirects.add(redirectPath);
  redirects.delete(spec.page_url);
  return Object.assign(job, {
    title: spec.title,
    organization: spec.organization,
    location: spec.location,
    workplace_type: normalizeWorkplaceType(spec.workplace_type, spec.workplace_type),
    page_url: spec.page_url,
    description,
    raw_description: description,
    description_snippet: snippet,
    summary: snippet,
    redirect_paths: Array.from(redirects)
  });
}

function applyProtectedRecord(record, job, spec) {
  record.display = {
    ...record.display,
    title: spec.title,
    organization: spec.organization,
    location: spec.location,
    location_type: normalizeWorkplaceType(spec.workplace_type, spec.workplace_type),
    description: spec.description,
    page_url_override: spec.page_url,
    application_url: stringifySafe(record.display?.application_url || job.apply_url || job.original_url),
    original_url: stringifySafe(record.display?.original_url || job.original_url || job.apply_url)
  };
  record.raw_source_data = {
    ...record.raw_source_data,
    title: spec.title,
    organization: spec.organization,
    location: spec.location,
    workplace_type: normalizeWorkplaceType(spec.workplace_type, spec.workplace_type),
    description: spec.description,
    raw_description: spec.description,
    page_url_override: spec.page_url,
    apply_url: stringifySafe(record.raw_source_data?.apply_url || job.apply_url || job.original_url),
    original_url: stringifySafe(record.raw_source_data?.original_url || job.original_url || job.apply_url)
  };
}

function applyProtectedOldJob(oldJob, currentJob, spec) {
  const snippet = buildDescriptionSnippet(spec.description, 220, { title: spec.title }) || spec.description;
  return Object.assign(oldJob, {
    title: spec.title,
    organization: spec.organization,
    location: spec.location,
    workplace_type: normalizeWorkplaceType(spec.workplace_type, spec.workplace_type),
    page_url: spec.page_url,
    description: spec.description,
    raw_description: spec.description,
    description_snippet: snippet,
    summary: snippet,
    apply_url: currentJob.apply_url,
    original_url: currentJob.original_url || currentJob.apply_url
  });
}

function updateResolutions(resolutions) {
  const next = clone(resolutions || {});
  next.description_resolutions = next.description_resolutions || {};
  next.company_resolutions = next.company_resolutions || {};
  next.location_resolutions = next.location_resolutions || {};

  next.description_resolutions[RESOURCE_ENGINEER] = {
    action: "use_protected_public_identity",
    description: PROTECTED_IDENTITIES[RESOURCE_ENGINEER].description,
    snippet: buildDescriptionSnippet(PROTECTED_IDENTITIES[RESOURCE_ENGINEER].description, 220, { title: PROTECTED_IDENTITIES[RESOURCE_ENGINEER].title }) || PROTECTED_IDENTITIES[RESOURCE_ENGINEER].description
  };
  next.description_resolutions[RESOURCE_LEAD] = {
    action: "use_protected_public_identity",
    description: PROTECTED_IDENTITIES[RESOURCE_LEAD].description,
    snippet: buildDescriptionSnippet(PROTECTED_IDENTITIES[RESOURCE_LEAD].description, 220, { title: PROTECTED_IDENTITIES[RESOURCE_LEAD].title }) || PROTECTED_IDENTITIES[RESOURCE_LEAD].description
  };
  next.company_resolutions[RESOURCE_ENGINEER] = {
    action: "use_protected_public_identity",
    company: "Resource Innovations",
    page_url_action: "regenerate_with_redirect"
  };
  next.company_resolutions[RESOURCE_LEAD] = {
    action: "use_protected_public_identity",
    company: "Resource Innovations",
    page_url_action: "regenerate_with_redirect"
  };
  next.location_resolutions[RESOURCE_ENGINEER] = {
    action: "use_fixed_location",
    location: PROTECTED_IDENTITIES[RESOURCE_ENGINEER].location
  };
  next.location_resolutions[RESOURCE_LEAD] = {
    action: "use_fixed_location",
    location: PROTECTED_IDENTITIES[RESOURCE_LEAD].location
  };
  return next;
}

function buildReportMarkdown(report) {
  const lines = [];
  lines.push("# Elemental Impact Targeted Audit");
  lines.push("");
  lines.push("## Affected Records");
  if (!report.affected_records.length) {
    lines.push("- none");
  } else {
    for (const item of report.affected_records) {
      lines.push(`- ${item.id} | ${item.title} | ${item.organization} | ${item.page_url} | ${item.apply_url}`);
    }
  }
  lines.push("");
  lines.push("## Parser Failure");
  lines.push("- Elemental Impact attribution was allowing noisy body text and taxonomy blobs to influence organization identity.");
  lines.push("- Workable apply URL context and clean board-card organization were not protected strongly enough, so Shifted Energy body text leaked into Resource Innovations publishing.");
  lines.push("");
  lines.push("## Temporary Fallback");
  lines.push("- For Elemental Impact, clean board-default title and organization now win.");
  lines.push("- Description/body metadata is no longer used to infer company.");
  lines.push("- Ambiguous Elemental Impact organization cases route to pending/manual review instead of auto-publishing corrupted identity.");
  lines.push("");
  lines.push("## Before After");
  for (const diff of report.before_after) {
    lines.push(`### ${diff.id}`);
    lines.push("```json");
    lines.push(JSON.stringify(diff, null, 2));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Files Changed");
  for (const file of report.files_changed) lines.push(`- ${file}`);
  lines.push("");
  lines.push("## Validation");
  lines.push("```json");
  lines.push(JSON.stringify(report.validation_summary, null, 2));
  lines.push("```");
  return lines.join("\n") + "\n";
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const [jobs, records] = await Promise.all([readJobs(), readJobRecords()]);
  const oldJobs = readJsonSync(OLD_JOBS_FILE, []);
  const pendingSynced = readJsonSync(PENDING_SYNCED_FILE, []);
  const resolutions = readJsonSync(RESOLUTIONS_FILE, {});

  const affected = identifyContaminatedRecords(jobs, oldJobs);
  const report = {
    mode: shouldWrite ? "write" : "dry-run",
    affected_records: affected,
    before_after: [],
    files_changed: [
      "scripts/source-rules.js",
      "scripts/validate-public-data.js",
      "scripts/test-normalizer.js",
      "scripts/targeted-elemental-impact-audit.js",
      "scripts/reconcile-public-data-resolutions.json",
      "jobs.json",
      "job-records.json",
      "oldjobs.json"
    ],
    validation_summary: {}
  };

  const nextJobs = clone(jobs);
  const nextRecords = clone(records);
  const nextOldJobs = clone(oldJobs);
  const nextPendingSynced = clone(pendingSynced);
  const nextResolutions = updateResolutions(resolutions);
  const changedIds = new Set();

  for (const id of Object.keys(PROTECTED_IDENTITIES)) {
    const spec = PROTECTED_IDENTITIES[id];
    const job = nextJobs.find((item) => String(item.id || "") === id);
    const record = nextRecords.find((item) => String(item.id || "") === id);
    const oldJob = nextOldJobs.find((item) => String(item.id || "") === id);
    const pendingJob = nextPendingSynced.find((item) => String(item.id || "") === id);
    if (!job || !record) continue;

    const before = {
      jobs: summarizeRecord(jobs.find((item) => String(item.id || "") === id)),
      job_record: summarizeJobRecord(records.find((item) => String(item.id || "") === id)),
      oldjobs: summarizeRecord(oldJobs.find((item) => String(item.id || "") === id))
    };

    applyProtectedIdentity(job, spec);
    applyProtectedRecord(record, job, spec);
    if (oldJob) applyProtectedOldJob(oldJob, job, spec);
    if (pendingJob) {
      pendingJob.organization = spec.organization;
      pendingJob.title = spec.title;
      pendingJob.location = spec.location;
      pendingJob.workplace_type = normalizeWorkplaceType(spec.workplace_type, spec.workplace_type);
      pendingJob.page_url = spec.page_url;
    }

    report.before_after.push({
      id,
      before,
      after: {
        jobs: summarizeRecord(job),
        job_record: summarizeJobRecord(record),
        oldjobs: summarizeRecord(oldJob)
      }
    });
    changedIds.add(id);
  }

  await writeJson(REPORT_JSON, report);
  await fs.writeFile(REPORT_MD, buildReportMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!shouldWrite) return;

  await writeJson(JOBS_FILE, nextJobs);
  await writeJson(JOB_RECORDS_FILE, nextRecords);
  await writeJson(OLD_JOBS_FILE, nextOldJobs);
  await writeJson(PENDING_SYNCED_FILE, nextPendingSynced);
  await writeJson(RESOLUTIONS_FILE, nextResolutions);
  await buildPagesForSelectedJobs(nextJobs, { selectedIds: Array.from(changedIds) });

  const validation = await buildValidationReport({ requirePages: true });
  report.validation_summary = {
    hard_validation_failure_count: validation.hard_validation_failure_count,
    organization_page_url_conflict_count: validation.organization_page_url_conflict_count,
    public_record_organization_conflict_count: validation.public_record_organization_conflict_count,
    errors: validation.errors,
    hard_validation_failures: validation.samples?.hard_validation_failures || []
  };
  await writeJson(REPORT_JSON, report);
  await fs.writeFile(REPORT_MD, buildReportMarkdown(report), "utf8");
  console.log(JSON.stringify({ changed_ids: Array.from(changedIds), validation: report.validation_summary }, null, 2));
  if (validation.hard_validation_failure_count > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:targeted-elemental-impact-audit] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
