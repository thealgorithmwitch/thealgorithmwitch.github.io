const fs = require("fs/promises");
const path = require("path");
const {
  readJobs,
  writeJson,
  JOBS_FILE
} = require("./job-utils");
const {
  readJobRecords,
  JOB_RECORDS_FILE
} = require("./public-records");
const {
  buildDescriptionSnippet,
  hasUsableDescription,
  normalizePayDisplay,
  normalizeWorkplaceType,
  parseSalaryRange,
  stringifySafe
} = require("./job-normalizer");
const { buildValidationReport } = require("./validate-public-data");
const { buildPagesForSelectedJobs } = require("./generate-job-pages");

const ROOT = path.resolve(__dirname, "..");
const OLD_JOBS_FILE = path.join(ROOT, "oldjobs.json");
const REPORT_JSON = path.join(ROOT, "reports", "targeted-public-repair-dry-run.json");
const REPORT_MD = path.join(ROOT, "reports", "targeted-public-repair-dry-run.md");
const DESCRIPTION_PLACEHOLDER = "Open the original listing for the full role details.";
const EDP_INTERCONNECTION_PLACEHOLDER =
  "This role supports renewable energy interconnection analysis and project coordination for EDP’s power development pipeline.";
const SOLAR_DESCRIPTION_PLACEHOLDER =
  "Leads national policy and advocacy campaigning to expand equitable solar access and support Solar United Neighbors’ mission.";
const RESOURCE_DESCRIPTION_PLACEHOLDER =
  "Builds and ships cloud-based SaaS software for energy-sector clients as part of Resource Innovations’ growing product engineering team.";
const FERVO_DESCRIPTION =
  "The Director, Internal Audit will be the builder responsible for designing the internal audit function from first principles, guiding the establishment of the SOX compliance program, defining the risk universe, and delivering independent assurance across financial reporting, IT, operational technology, cybersecurity, and regulatory compliance.";
const SOLAR_ID = "solar-united-neighbors-5dd5c717f705";
const RESOURCE_ID = "elemental-impact-446c301b54b2";
const FERVO_ID = "elemental-impact-c6c7ccd02120";
const TARGET_WRITE_IDS = new Set([
  SOLAR_ID,
  "edp-e87960ee8c52",
  "edp-0164b558d6e6",
  RESOURCE_ID,
  FERVO_ID,
  "nextera-energy-50fe226b28a5"
]);
const FIELDS = [
  "title",
  "organization",
  "description",
  "description_snippet",
  "summary",
  "salary",
  "location",
  "workplace_type",
  "specialization",
  "page_url"
];

function readJsonSync(filePath) {
  return require(filePath);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function isBlank(value) {
  return !normalizeText(value);
}

function isValidPageUrl(value) {
  return /^\.\/pages\/[a-z0-9][a-z0-9-]*\.html$/i.test(normalizeText(value));
}

function looksLikeCompanyOnlyDescription(value, context = {}) {
  const text = normalizeComparable(value);
  if (!text) return false;
  const org = normalizeComparable(context.organization);
  const title = normalizeComparable(context.title);
  if (text === org || text === title) return true;
  return text.split(" ").length <= 12 && !!org && text.startsWith(org) && !/\b(?:is|are|will|can|supports|manages|develops|leads|coordinates|works)\b/.test(text);
}

function looksLikeRepeatedDateDescription(value) {
  const text = normalizeText(value);
  const matches = text.match(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/gi) || [];
  return matches.length >= 3;
}

function looksLikeHeaderLocationJunk(value) {
  const text = normalizeText(value);
  return /\b(?:title business(?: platform location date)?|point\s*\(|locality|career_page|viewbox|0\/svg)\b/i.test(text);
}

function isCleanDescription(value, context = {}) {
  const text = normalizeText(value);
  if (!text) return false;
  if (looksLikeCompanyOnlyDescription(text, context)) return false;
  if (looksLikeRepeatedDateDescription(text)) return false;
  if (looksLikeHeaderLocationJunk(text)) return false;
  return hasUsableDescription(text, context);
}

function isCleanSnippet(value, context = {}) {
  const text = normalizeText(value);
  if (!text) return false;
  if (looksLikeCompanyOnlyDescription(text, context)) return false;
  if (looksLikeRepeatedDateDescription(text)) return false;
  if (looksLikeHeaderLocationJunk(text)) return false;
  return text.length >= 20;
}

function cleanRepeatedDescriptionTail(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]?/g) || [];
  const seen = new Set();
  const kept = [];
  for (const sentence of sentences) {
    const trimmed = normalizeText(sentence);
    if (!trimmed) continue;
    const key = normalizeComparable(trimmed.replace(/[.!?]+$/, ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed.replace(/[.!?]+$/, ""));
    if (kept.length === 3) break;
  }
  return kept.join(". ").trim() + (kept.length ? "." : "");
}

function isCleanPay(value, context = {}) {
  const text = normalizeText(value);
  if (!text) return false;
  if (context.id === SOLAR_ID && /\$?\s*50\s*\/?\s*(?:mo|month)\b/i.test(text)) return false;
  const parsed = parseSalaryRange(text, "");
  return Boolean(parsed.salary || /\d/.test(text));
}

function isCleanSimpleText(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return !looksLikeHeaderLocationJunk(text);
}

function selectField(field, currentJob, oldJob, record, report) {
  const context = {
    id: currentJob.id,
    title: oldJob.title || currentJob.title || record.display?.title || record.raw_source_data?.title,
    organization: oldJob.organization || currentJob.organization || record.display?.organization || record.raw_source_data?.organization
  };
  const recordDisplayMap = {
    title: "title",
    organization: "organization",
    description: "description",
    description_snippet: null,
    summary: null,
    salary: "pay_display",
    location: "location",
    workplace_type: "location_type",
    specialization: "specialization",
    page_url: "page_url_override"
  };
  const recordRawMap = {
    title: "title",
    organization: "organization",
    description: "description",
    description_snippet: null,
    summary: null,
    salary: "salary",
    location: "location",
    workplace_type: "workplace_type",
    specialization: "specialization",
    page_url: "page_url_override"
  };

  const candidates = [
    { source: "oldjobs.json", value: oldJob[field] },
    { source: "jobs.json", value: currentJob[field] },
    { source: "job-records.display", value: recordDisplayMap[field] ? record.display?.[recordDisplayMap[field]] : "" },
    { source: "job-records.raw", value: recordRawMap[field] ? record.raw_source_data?.[recordRawMap[field]] : "" }
  ];

  const cleanFn =
    field === "description" ? isCleanDescription
      : field === "description_snippet" || field === "summary" ? isCleanSnippet
        : field === "salary" ? isCleanPay
          : field === "page_url" ? isValidPageUrl
            : isCleanSimpleText;

  const oldCandidate = candidates[0];
  const currentCandidate = candidates[1];
  const recordCandidates = candidates.slice(2);
  const rejected = [];
  const accept = (candidate, kind) => {
    report[kind].push({
      id: currentJob.id,
      title: currentJob.title,
      organization: currentJob.organization,
      field,
      value: normalizeText(candidate.value)
    });
    return normalizeText(candidate.value);
  };
  const reject = (candidate, reason) => {
    if (!normalizeText(candidate.value)) return;
    rejected.push({ source: candidate.source, reason, value: normalizeText(candidate.value) });
    if (candidate.source === "oldjobs.json") {
      report.oldjobs_rejected_as_junk.push({
        id: currentJob.id,
        title: currentJob.title,
        organization: currentJob.organization,
        field,
        reason,
        value: normalizeText(candidate.value)
      });
    }
  };

  if (cleanFn(oldCandidate.value, context)) {
    return { value: accept(oldCandidate, "selected_from_oldjobs"), rejected };
  }
  reject(oldCandidate, isBlank(oldCandidate.value) ? "blank" : "junk");

  if (cleanFn(currentCandidate.value, context)) {
    return { value: accept(currentCandidate, "kept_from_jobs"), rejected };
  }
  reject(currentCandidate, isBlank(currentCandidate.value) ? "blank" : "junk");

  for (const candidate of recordCandidates) {
    if (cleanFn(candidate.value, context)) {
      return { value: accept(candidate, "used_from_job_records"), rejected };
    }
    reject(candidate, isBlank(candidate.value) ? "blank" : "junk");
  }

  if (field === "description") {
    report.placeholders_created.push({
      id: currentJob.id,
      title: currentJob.title,
      organization: currentJob.organization,
      field,
      value: currentJob.id === "edp-e87960ee8c52" ? EDP_INTERCONNECTION_PLACEHOLDER : DESCRIPTION_PLACEHOLDER
    });
    return {
      value: currentJob.id === "edp-e87960ee8c52" ? EDP_INTERCONNECTION_PLACEHOLDER : DESCRIPTION_PLACEHOLDER,
      rejected
    };
  }

  if (field === "description_snippet" || field === "summary") {
    const baseDescription = field === "summary" ? currentJob.description : currentJob.description;
    const fallback = buildDescriptionSnippet(
      currentJob.id === "edp-e87960ee8c52" ? EDP_INTERCONNECTION_PLACEHOLDER : baseDescription || DESCRIPTION_PLACEHOLDER,
      220,
      { title: context.title }
    ) || (currentJob.id === "edp-e87960ee8c52" ? EDP_INTERCONNECTION_PLACEHOLDER : DESCRIPTION_PLACEHOLDER);
    report.placeholders_created.push({
      id: currentJob.id,
      title: currentJob.title,
      organization: currentJob.organization,
      field,
      value: fallback
    });
    return { value: fallback, rejected };
  }

  report.manual_review_items.push({
    id: currentJob.id,
    title: currentJob.title,
    organization: currentJob.organization,
    field,
    reason: "no_clean_source"
  });
  return { value: normalizeText(currentCandidate.value || oldCandidate.value), rejected };
}

function buildCanonicalPay(job, chosenPay) {
  if (job.id === SOLAR_ID) {
    const canonical = "$80,000.00 - $95,880.00 annual salary";
    const parsed = parseSalaryRange(canonical, job.location || "");
    return {
      salary: canonical,
      salary_min: parsed.salary_min,
      salary_max: parsed.salary_max,
      salary_currency: parsed.salary_currency,
      salary_period: parsed.salary_period
    };
  }
  const canonicalDisplay = normalizePayDisplay({
    payDisplay: chosenPay,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    currency: job.salary_currency,
    period: job.salary_period
  }) || normalizeText(chosenPay);
  const parsed = parseSalaryRange(canonicalDisplay, job.location || "");
  return {
    salary: canonicalDisplay,
    salary_min: parsed.salary_min,
    salary_max: parsed.salary_max,
    salary_currency: parsed.salary_currency,
    salary_period: parsed.salary_period
  };
}

function buildCanonicalPage(job) {
  if (job.id === RESOURCE_ID) return "./pages/senior-software-engineer-resource-innovations.html";
  if (job.id === FERVO_ID) return "./pages/director-internal-audit-fervo-energy.html";
  return normalizeText(job.page_url);
}

function buildReportMarkdown(report) {
  const lines = [];
  lines.push("# Targeted Public Repair Dry Run");
  lines.push("");
  lines.push(`- Records compared: ${report.records_compared}`);
  lines.push(`- Fields selected from oldjobs.json: ${report.selected_from_oldjobs.length}`);
  lines.push(`- Rejected oldjobs.json junk fields: ${report.oldjobs_rejected_as_junk.length}`);
  lines.push(`- Current jobs.json fields kept: ${report.kept_from_jobs.length}`);
  lines.push(`- job-records fields used: ${report.used_from_job_records.length}`);
  lines.push(`- Placeholders created: ${report.placeholders_created.length}`);
  lines.push("");
  lines.push("## Critical Before/After");
  for (const item of report.critical_before_after) {
    lines.push(`### ${item.label}`);
    lines.push("```json");
    lines.push(JSON.stringify(item, null, 2));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Manual Review");
  if (!report.manual_review_items.length) {
    lines.push("- none");
  } else {
    report.manual_review_items.forEach((item) => {
      lines.push(`- ${item.id} | ${item.title} | ${item.field} | ${item.reason}`);
    });
  }
  return lines.join("\n") + "\n";
}

function buildCriticalDiff(label, before, after) {
  return { label, before, after };
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const jobs = await readJobs();
  const records = await readJobRecords();
  const oldJobs = readJsonSync(OLD_JOBS_FILE);
  const jobsById = new Map(jobs.map((job) => [String(job.id || ""), job]));
  const oldById = new Map(oldJobs.map((job) => [String(job.id || ""), job]));
  const recordsById = new Map(records.map((record) => [String(record.id || ""), record]));
  const sharedIds = jobs
    .map((job) => String(job.id || ""))
    .filter((id) => id && oldById.has(id) && recordsById.has(id));

  const report = {
    mode: shouldWrite ? "write" : "dry-run",
    generated_at: new Date().toISOString(),
    records_compared: sharedIds.length,
    changed_id_count: 0,
    changed_ids: [],
    selected_from_oldjobs: [],
    oldjobs_rejected_as_junk: [],
    kept_from_jobs: [],
    used_from_job_records: [],
    placeholders_created: [],
    critical_before_after: [],
    manual_review_items: []
  };

  const nextJobs = jobs.map((job) => ({ ...job }));
  const nextRecords = records.map((record) => ({ ...record }));
  const changedIds = new Set();

  for (const id of sharedIds) {
    const currentJob = jobsById.get(id);
    const oldJob = oldById.get(id);
    const record = recordsById.get(id);
    const chosen = {};
    for (const field of FIELDS) {
      chosen[field] = selectField(field, currentJob, oldJob, record, report).value;
    }

    if (id === RESOURCE_ID) {
      chosen.organization = "Resource Innovations";
      chosen.page_url = "./pages/senior-software-engineer-resource-innovations.html";
      const cleanedResourceDescription = cleanRepeatedDescriptionTail(chosen.description);
      chosen.description = isCleanDescription(cleanedResourceDescription, chosen)
        ? cleanedResourceDescription
        : RESOURCE_DESCRIPTION_PLACEHOLDER;
      chosen.description_snippet = buildDescriptionSnippet(chosen.description, 220, { title: chosen.title }) || chosen.description;
      chosen.summary = chosen.description_snippet;
    }
    if (id === FERVO_ID) {
      chosen.title = "Director, Internal Audit";
      chosen.organization = "Fervo Energy";
      chosen.page_url = "./pages/director-internal-audit-fervo-energy.html";
      chosen.description = FERVO_DESCRIPTION;
      chosen.description_snippet = buildDescriptionSnippet(chosen.description, 220, { title: chosen.title }) || chosen.description;
      chosen.summary = chosen.description_snippet;
    }
    if (id === "edp-e87960ee8c52") {
      chosen.description = EDP_INTERCONNECTION_PLACEHOLDER;
      chosen.description_snippet = buildDescriptionSnippet(EDP_INTERCONNECTION_PLACEHOLDER, 220, { title: chosen.title }) || EDP_INTERCONNECTION_PLACEHOLDER;
      chosen.summary = chosen.description_snippet;
    }
    if (id === SOLAR_ID) {
      chosen.description = SOLAR_DESCRIPTION_PLACEHOLDER;
      chosen.description_snippet = buildDescriptionSnippet(SOLAR_DESCRIPTION_PLACEHOLDER, 220, { title: chosen.title }) || SOLAR_DESCRIPTION_PLACEHOLDER;
      chosen.summary = chosen.description_snippet;
    }
    if (id === "edp-0164b558d6e6" && !isCleanDescription(chosen.description, chosen)) {
      chosen.description = normalizeText(record.display?.description || record.raw_source_data?.description || currentJob.description || oldJob.description);
      chosen.description_snippet = buildDescriptionSnippet(chosen.description, 220, { title: chosen.title });
      chosen.summary = chosen.description_snippet;
    }
    if (id === "nextera-energy-50fe226b28a5") {
      const nexteraDescription = normalizeText(record.display?.description || record.raw_source_data?.description || currentJob.description);
      chosen.description = nexteraDescription;
      chosen.description_snippet = isCleanSnippet(oldJob.description_snippet, chosen)
        ? normalizeText(oldJob.description_snippet)
        : buildDescriptionSnippet(nexteraDescription, 220, { title: chosen.title });
      chosen.summary = chosen.description_snippet;
    }

    if (TARGET_WRITE_IDS.has(id)) {
      const pay = buildCanonicalPay(currentJob, chosen.salary);
      const canonicalPageUrl = buildCanonicalPage({ ...currentJob, ...chosen });
      const redirectPaths = new Set(Array.isArray(currentJob.redirect_paths) ? currentJob.redirect_paths : []);
      if (currentJob.page_url && currentJob.page_url !== canonicalPageUrl) redirectPaths.add(currentJob.page_url);
      if (id === RESOURCE_ID) redirectPaths.add("./pages/senior-software-engineer-shifted-energy.html");
      redirectPaths.delete(canonicalPageUrl);

      const nextJob = nextJobs.find((job) => String(job.id || "") === id);
      Object.assign(nextJob, {
        title: chosen.title,
        organization: chosen.organization,
        description: chosen.description,
        raw_description: chosen.description,
        description_snippet: chosen.description_snippet,
        summary: chosen.summary,
        salary: pay.salary,
        salary_min: pay.salary_min,
        salary_max: pay.salary_max,
        salary_currency: pay.salary_currency,
        salary_period: pay.salary_period,
        location: normalizeText(chosen.location),
        workplace_type: normalizeWorkplaceType(chosen.workplace_type, normalizeText(chosen.workplace_type)),
        specialization: normalizeText(chosen.specialization),
        page_url: canonicalPageUrl
      });
      if (redirectPaths.size) {
        nextJob.redirect_paths = Array.from(redirectPaths);
      } else {
        delete nextJob.redirect_paths;
      }

      const nextRecord = nextRecords.find((entry) => String(entry.id || "") === id);
      nextRecord.display = {
        ...nextRecord.display,
        title: chosen.title,
        organization: chosen.organization,
        description: chosen.description,
        pay_display: pay.salary,
        salary_min: pay.salary_min,
        salary_max: pay.salary_max,
        location: normalizeText(chosen.location),
        location_type: normalizeWorkplaceType(chosen.workplace_type, normalizeText(chosen.workplace_type)),
        specialization: normalizeText(chosen.specialization),
        original_url: stringifySafe(nextRecord.display?.original_url || nextRecord.raw_source_data?.original_url),
        source_url: stringifySafe(nextRecord.display?.source_url || nextRecord.raw_source_data?.source_url),
        application_url: stringifySafe(nextRecord.display?.application_url || nextRecord.raw_source_data?.apply_url),
        page_url_override: canonicalPageUrl
      };
      nextRecord.raw_source_data = {
        ...nextRecord.raw_source_data,
        title: chosen.title,
        organization: chosen.organization,
        description: chosen.description,
        raw_description: chosen.description,
        salary: pay.salary,
        salary_min: pay.salary_min,
        salary_max: pay.salary_max,
        salary_currency: pay.salary_currency,
        salary_period: pay.salary_period,
        location: normalizeText(chosen.location),
        workplace_type: normalizeWorkplaceType(chosen.workplace_type, normalizeText(chosen.workplace_type)),
        specialization: normalizeText(chosen.specialization),
        page_url_override: canonicalPageUrl
      };

      if (JSON.stringify(currentJob) !== JSON.stringify(nextJob)) changedIds.add(id);
    }
  }

  const previewJobsById = new Map(nextJobs.map((job) => [String(job.id || ""), job]));
  report.changed_id_count = changedIds.size;
  report.changed_ids = Array.from(changedIds).sort();
  report.critical_before_after.push(
    buildCriticalDiff(
      "Solar United Neighbors pay",
      jobsById.get(SOLAR_ID),
      previewJobsById.get(SOLAR_ID)
    ),
    buildCriticalDiff(
      "EDP Interconnection Analyst description",
      jobsById.get("edp-e87960ee8c52"),
      previewJobsById.get("edp-e87960ee8c52")
    ),
    buildCriticalDiff(
      "Resource Innovations company/url",
      jobsById.get(RESOURCE_ID),
      previewJobsById.get(RESOURCE_ID)
    ),
    buildCriticalDiff(
      "Fervo title/company/url",
      jobsById.get(FERVO_ID),
      previewJobsById.get(FERVO_ID)
    ),
    buildCriticalDiff(
      "NextEra description",
      jobsById.get("nextera-energy-50fe226b28a5"),
      previewJobsById.get("nextera-energy-50fe226b28a5")
    )
  );

  const solarAfter = previewJobsById.get(SOLAR_ID);
  if (/\$?\s*50\s*\/?\s*(?:mo|month)\b/i.test(JSON.stringify(solarAfter))) {
    throw new Error("Dry run failed: Solar United Neighbors still contains $50/month corruption.");
  }
  const resourceAfter = previewJobsById.get(RESOURCE_ID);
  if (/shifted energy/i.test(JSON.stringify({
    title: resourceAfter.title,
    organization: resourceAfter.organization,
    page_url: resourceAfter.page_url,
    description_snippet: resourceAfter.description_snippet,
    summary: resourceAfter.summary
  }))) {
    throw new Error("Dry run failed: Resource Innovations still contains Shifted Energy in public-facing fields.");
  }

  await writeJson(REPORT_JSON, report);
  await fs.writeFile(REPORT_MD, buildReportMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!shouldWrite) return;

  await writeJson(JOBS_FILE, nextJobs);
  await writeJson(JOB_RECORDS_FILE, nextRecords);
  await buildPagesForSelectedJobs(nextJobs, { selectedIds: Array.from(changedIds) });
  const validation = await buildValidationReport({ requirePages: true });
  console.log(JSON.stringify({
    changed_ids: Array.from(changedIds),
    validation
  }, null, 2));
  if (validation.errors.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:targeted-public-repair] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
