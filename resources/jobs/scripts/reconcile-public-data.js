const fs = require("fs/promises");
const path = require("path");
const {
  readJobs,
  readPendingSyncedJobs,
  readJson,
  writeJson,
  PENDING_SYNCED_FILE
} = require("./job-utils");
const {
  buildJobRecord,
  JOB_RECORDS_FILE,
  readJobRecords
} = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const {
  CANONICAL_SPECIALIZATIONS,
  buildDescriptionSnippet,
  hasUsableDescription,
  normalizeJob,
  normalizePayDisplay,
  slugify,
  normalizeWorkplaceType,
  stringifySafe
} = require("./job-normalizer");
const { buildValidationReport } = require("./validate-public-data");
const {
  compareJobsOutputs,
  getCanonicalDescription,
  getCanonicalLocation,
  getCanonicalPay,
  getCanonicalSnippet,
  getCanonicalWorkplaceType,
  isJunkDescription
} = require("./public-data-guard");
const { normalizeManualPagePath } = require("./job-page-paths");
const REPORTS_DIR = path.resolve(__dirname, "..", "reports");
const RECONCILE_REPORT_JSON = path.join(REPORTS_DIR, "reconcile-audit-latest.json");
const RECONCILE_REPORT_MD = path.join(REPORTS_DIR, "reconcile-audit-latest.md");
const RESOLUTIONS_FILE = path.join(__dirname, "reconcile-public-data-resolutions.json");
const OLD_JOBS_FILE = path.resolve(__dirname, "..", "oldjobs.json");

const PROTECTED_FIELD_MAP = {
  title: ["display.title", "raw_source_data.title"],
  organization: ["display.organization", "raw_source_data.organization"],
  description: ["display.description", "raw_source_data.description"],
  snippet: [],
  salary: ["display.pay_display", "raw_source_data.salary", "display.salary_min", "display.salary_max", "raw_source_data.salary_min", "raw_source_data.salary_max"],
  location: ["display.location", "raw_source_data.location"],
  workplace_type: ["display.location_type", "raw_source_data.workplace_type"],
  specialization: ["display.specialization", "raw_source_data.specialization", "display.specialization_confidence", "raw_source_data.specialization_confidence"],
  page_url: ["display.page_url_override", "raw_source_data.page_url_override"]
};

const MANUAL_COMPANY_REVIEW_IDS = new Set([
  "elemental-impact-c6c7ccd02120",
  "elemental-impact-446c301b54b2",
  "elemental-impact-26644a0dbc01"
]);

const ENGINEERING_SIGNAL = /\b(?:engineer|engineering|software|firmware|frontend|front-end|backend|back-end|fullstack|full-stack|developer|architect|platform|devops|sre|analytics platform)\b/i;
const VIDEO_SIGNAL = /\b(?:video|videographer|video editor|video producer|multimedia producer|motion designer|motion graphics|youtube|documentary|short-form video|short form video|digital video|social video|creative producer|content producer|film producer)\b/i;
const LOCATION_JUNK = /\b(?:Title Business(?: Platform Location Date)?|Date Operations and Maintenance Senior Operator|POINT\s*\(|locality\b|\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid))\b/i;
const REPEATED_DATE_JUNK = /(?:\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b.*){3,}/i;
const JUNK_REASON_PATTERNS = [
  { label: "previous", pattern: /\bprevious\b/i },
  { label: "next post", pattern: /\bnext post\b/i },
  { label: "see current openings", pattern: /\bsee current openings\b/i },
  { label: "table headers", pattern: /\bTitle Business(?: Platform Location Date)?\b/i },
  { label: "viewBox", pattern: /\bviewBox\b/i },
  { label: "0/svg", pattern: /\b0\/svg\b/i },
  { label: "<span", pattern: /<span\b/i },
  { label: "POINT(...)", pattern: /\bPOINT\s*\(/i },
  { label: "locality", pattern: /\blocality\b/i },
  { label: "raw ATS metadata", pattern: /\bcareer_page\b/i },
  { label: "taxonomy blobs", pattern: /\b(?:Business\/Productivity Software|Cleantech|Oil\s*&\s*Gas|Renewable Energy)\b/i },
  { label: "giant numeric metadata strings", pattern: /\b\d{7,10}\b/ },
  { label: "repeated date/header fragments", pattern: REPEATED_DATE_JUNK }
];
const URL_COMPANY_HINTS = [
  { pattern: /apply\.workable\.com\/resource-innovations\//i, company: "Resource Innovations" },
  { pattern: /apply\.workable\.com\/shifted-energy\//i, company: "Shifted Energy" }
];

function cleanText(value) {
  return stringifySafe(value).trim();
}

function normalizeIdentityToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  try {
    const url = new URL(cleanText(value));
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function buildTitleOrgKey(title, organization) {
  return `${normalizeIdentityToken(title)}::${normalizeIdentityToken(organization)}`;
}

function isPublishedRecord(record) {
  return Boolean(
    record &&
    record.record_type === "job" &&
    record.published &&
    record.public_visibility &&
    String(record.status || "").toLowerCase() === "published"
  );
}

function buildPublicDuplicateIndex(publicJobs) {
  const index = {
    ids: new Set(),
    urls: new Set(),
    externalIds: new Set(),
    titleOrg: new Set()
  };
  for (const job of Array.isArray(publicJobs) ? publicJobs : []) {
    const id = cleanText(job?.id);
    const url = normalizeUrl(job?.original_url || job?.apply_url || job?.source_url);
    const externalId = cleanText(job?.external_id).toLowerCase();
    const titleOrg = buildTitleOrgKey(job?.title, job?.organization);
    if (id) index.ids.add(id);
    if (url) index.urls.add(url);
    if (externalId) index.externalIds.add(externalId);
    if (titleOrg !== "::") index.titleOrg.add(titleOrg);
  }
  return index;
}

function isDuplicateOfPublicJob(job, publicIndex) {
  const id = cleanText(job?.id);
  const url = normalizeUrl(job?.original_url || job?.apply_url || job?.source_url);
  const externalId = cleanText(job?.external_id).toLowerCase();
  const titleOrg = buildTitleOrgKey(job?.title, job?.organization);
  return Boolean(
    (id && publicIndex.ids.has(id)) ||
    (url && publicIndex.urls.has(url)) ||
    (externalId && publicIndex.externalIds.has(externalId)) ||
    (titleOrg !== "::" && publicIndex.titleOrg.has(titleOrg))
  );
}

function buildRecordIndexes(records) {
  const byId = new Map();
  const byTitleOrg = new Map();
  const byUrl = new Map();

  records.forEach((record, index) => {
    if (!record || record.record_type !== "job") return;
    const display = record.display || {};
    const raw = record.raw_source_data || {};
    const id = cleanText(record.id);
    const titleOrg = buildTitleOrgKey(display.title || raw.title, display.organization || raw.organization);
    const urls = [
      raw.apply_url,
      raw.original_url,
      raw.source_url,
      display.application_url,
      display.original_url,
      display.source_url
    ].map(normalizeUrl).filter(Boolean);

    const entry = { record, index };
    if (id && !byId.has(id)) byId.set(id, entry);
    if (titleOrg !== "::" && !byTitleOrg.has(titleOrg)) byTitleOrg.set(titleOrg, entry);
    urls.forEach((url) => {
      if (!byUrl.has(url)) byUrl.set(url, entry);
    });
  });

  return { byId, byTitleOrg, byUrl };
}

function inferSupportingMatch(job, recordIndexes, pending) {
  const id = cleanText(job.id);
  const titleOrg = buildTitleOrgKey(job.title, job.organization);
  const url = normalizeUrl(job.apply_url || job.original_url || job.source_url);
  const pendingById = new Map((Array.isArray(pending) ? pending : []).map((item) => [cleanText(item.id), item]));
  const pendingByTitleOrg = new Map((Array.isArray(pending) ? pending : []).map((item) => [buildTitleOrgKey(item.title, item.organization), item]));
  const pendingByUrl = new Map();
  (Array.isArray(pending) ? pending : []).forEach((item) => {
    [item.apply_url, item.original_url, item.source_url].map(normalizeUrl).filter(Boolean).forEach((value) => pendingByUrl.set(value, item));
  });

  return {
    recordMatch: recordIndexes.byId.get(id) || recordIndexes.byTitleOrg.get(titleOrg) || (url ? recordIndexes.byUrl.get(url) : null) || null,
    pendingMatch: pendingById.get(id) || pendingByTitleOrg.get(titleOrg) || (url ? pendingByUrl.get(url) : null) || null
  };
}

function samePayMeaning(left, right) {
  const normalize = (value) => cleanText(value).replace(/\s*\/\s*(?:year|month|day|hour)$/i, "").trim();
  const leftText = normalize(left);
  const rightText = normalize(right);
  return Boolean(leftText) && leftText === rightText;
}

function isValidPay(value) {
  const normalized = normalizePayDisplay({ payDisplay: value });
  return Boolean(normalized);
}

function extractPayFacts(value) {
  const text = cleanText(value);
  const amountMatches = Array.from(text.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    .map((match) => Number(String(match[0]).replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const period =
    /\b(?:per month|\/\s*month|\/\s*mo\b|monthly|month)\b/i.test(text) ? "month"
      : /\b(?:per year|\/\s*year|\/\s*yr\b|annual|annually|year)\b/i.test(text) ? "year"
        : /\b(?:per hour|\/\s*hour|\/\s*hr\b|hourly|hour)\b/i.test(text) ? "hour"
          : /\b(?:per day|\/\s*day|daily|day)\b/i.test(text) ? "day"
            : "unknown";
  const minAmount = amountMatches.length ? Math.min(...amountMatches) : null;
  const maxAmount = amountMatches.length ? Math.max(...amountMatches) : null;
  const isRange = amountMatches.length >= 2 && /(?:-|–|—|\bto\b)/i.test(text);
  return {
    text,
    period,
    minAmount,
    maxAmount,
    isRange,
    tinyMonthly: period === "month" && maxAmount !== null && maxAmount < 1000,
    annualLike: period === "year" || (period === "unknown" && maxAmount !== null && maxAmount >= 10000),
    professionalRangeLike: isRange && maxAmount !== null && maxAmount >= 10000
  };
}

function isSuspiciousPayDowngrade(currentValue, candidateValue) {
  const current = extractPayFacts(currentValue);
  const candidate = extractPayFacts(candidateValue);
  if (!current.text || !candidate.text) return false;
  return Boolean((current.annualLike || current.professionalRangeLike) && candidate.tinyMonthly);
}

function deriveSalaryShapeFromChosenPay(chosenPay) {
  const normalized = normalizeJob({ salary: cleanText(chosenPay) });
  return {
    salary: cleanText(normalized.salary || chosenPay),
    salary_min: normalized.salary_min ?? null,
    salary_max: normalized.salary_max ?? null,
    salary_currency: normalized.salary_currency || "Unknown",
    salary_period: normalized.salary_period || "Unknown"
  };
}

function isCleanLocation(value) {
  const text = cleanText(value);
  if (!text) return false;
  return !LOCATION_JUNK.test(text);
}

function isCorruptedDescription(value) {
  const text = cleanText(value);
  if (!text) return false;
  return isJunkDescription(text) || REPEATED_DATE_JUNK.test(text);
}

function normalizeWinnerReason(reason) {
  return [
    "keep_jobs_json_cleaner",
    "use_job_records_cleaner",
    "use_placeholder",
    "restore_oldjobs",
    "jobs_json_blank",
    "jobs_json_corrupted",
    "manual_review_required"
  ].includes(reason) ? reason : "manual_review_required";
}

async function readOldJobs() {
  return readJson(OLD_JOBS_FILE, []);
}

function buildJobsIndex(jobs = []) {
  return new Map((Array.isArray(jobs) ? jobs : []).map((job) => [cleanText(job.id), job]));
}

function normalizeDescriptionForComparison(value) {
  return cleanText(value)
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .trim();
}

function countRepeatedFragments(value) {
  const text = normalizeDescriptionForComparison(value);
  if (!text) return 0;
  const fragments = text
    .split(/(?<=[.?!])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24);
  const seen = new Set();
  let repeated = 0;
  fragments.forEach((fragment) => {
    const key = fragment.toLowerCase();
    if (seen.has(key)) repeated += 1;
    seen.add(key);
  });
  return repeated;
}

function isReadableDescription(value, title = "") {
  const text = cleanText(value);
  return Boolean(text) && hasUsableDescription(text, { title }) && !isCorruptedDescription(text);
}

function isClearlyBetterThanCurrent(currentValue, candidateValue, title = "") {
  const currentText = normalizeDescriptionForComparison(currentValue);
  const candidateText = normalizeDescriptionForComparison(candidateValue);
  if (!candidateText || !isReadableDescription(candidateText, title)) return false;
  if (!currentText) return true;
  if (!isReadableDescription(currentText, title)) return true;
  if (countRepeatedFragments(currentText) > countRepeatedFragments(candidateText)) return true;
  if (candidateText.length + 80 < currentText.length && countRepeatedFragments(currentText) > 0) return true;
  if (candidateText.length > currentText.length + 100 && candidateText.includes(currentText)) return true;
  return false;
}

function decideDescription(job, recordValue, resolution = null, oldJob = null) {
  const jobsValue = getCanonicalDescription(job);
  const recordText = cleanText(recordValue);
  const oldText = getCanonicalDescription(oldJob || {});
  if (resolution?.action === "keep_jobs_json") {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner", resolution_action: "keep_jobs_json" };
  }
  if (resolution?.action === "use_job_records_cleaner" && recordText && hasUsableDescription(recordText, { title: job.title })) {
    return { chosen: recordText, reason: "use_job_records_cleaner", resolution_action: "use_job_records_cleaner" };
  }
  if (resolution?.action === "use_placeholder") {
    return { chosen: cleanText(resolution.description), reason: "use_job_records_cleaner", resolution_action: "use_placeholder", snippet: cleanText(resolution.snippet) };
  }
  if (resolution?.action === "manual_review_required") {
    return { chosen: jobsValue || recordText, reason: "manual_review_required", resolution_action: "manual_review_required" };
  }
  const jobsClean = jobsValue && hasUsableDescription(jobsValue, { title: job.title }) && !isCorruptedDescription(jobsValue);
  const recordClean = recordText && hasUsableDescription(recordText, { title: job.title }) && !isCorruptedDescription(recordText);
  const oldClean = oldText && hasUsableDescription(oldText, { title: job.title }) && !isCorruptedDescription(oldText);

  if (jobsClean && recordClean && isClearlyBetterThanCurrent(jobsValue, recordText, job.title)) {
    return { chosen: recordText, reason: "use_job_records_cleaner" };
  }
  if (oldClean && isClearlyBetterThanCurrent(jobsValue, oldText, job.title) && !isClearlyBetterThanCurrent(oldText, recordText, job.title)) {
    return { chosen: oldText, reason: "restore_oldjobs" };
  }

  if (jobsClean) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (!jobsValue && recordClean) {
    return { chosen: recordText, reason: "jobs_json_blank" };
  }
  if (!jobsValue && oldClean) {
    return { chosen: oldText, reason: "restore_oldjobs" };
  }
  if (jobsValue && !jobsClean && recordClean) {
    return { chosen: recordText, reason: "jobs_json_corrupted" };
  }
  if (jobsValue && !jobsClean && oldClean) {
    return { chosen: oldText, reason: "restore_oldjobs" };
  }
  return { chosen: jobsValue || recordText, reason: "manual_review_required" };
}

function decideSnippet(job, recordDescription, descriptionDecision = null, oldJob = null) {
  if (descriptionDecision?.resolution_action === "use_placeholder" && descriptionDecision.snippet) {
    return { chosen: cleanText(descriptionDecision.snippet), reason: "use_placeholder", resolution_action: "use_placeholder" };
  }
  const jobsValue = getCanonicalSnippet(job);
  const jobsClean = jobsValue && !isCorruptedDescription(jobsValue);
  const derivedRecord = buildDescriptionSnippet(recordDescription, 220, { title: job.title });
  const recordClean = derivedRecord && !isCorruptedDescription(derivedRecord);
  const oldSnippet = getCanonicalSnippet(oldJob || {});
  const oldClean = oldSnippet && !isCorruptedDescription(oldSnippet);
  if (descriptionDecision?.reason === "restore_oldjobs" && oldClean) {
    return { chosen: oldSnippet, reason: "restore_oldjobs" };
  }
  if (jobsClean) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (!jobsValue && recordClean) {
    return { chosen: derivedRecord, reason: "jobs_json_blank" };
  }
  if (!jobsValue && oldClean) {
    return { chosen: oldSnippet, reason: "restore_oldjobs" };
  }
  if (jobsValue && !jobsClean && recordClean) {
    return { chosen: derivedRecord, reason: "jobs_json_corrupted" };
  }
  if (jobsValue && !jobsClean && oldClean) {
    return { chosen: oldSnippet, reason: "restore_oldjobs" };
  }
  return { chosen: jobsValue || derivedRecord, reason: "manual_review_required" };
}

function decidePay(job, recordValue, resolution = null) {
  const jobsValue = getCanonicalPay(job);
  const recordPay = normalizePayDisplay({ payDisplay: recordValue });
  if (resolution?.action === "use_fixed_pay" && cleanText(resolution.salary)) {
    return { chosen: cleanText(resolution.salary), reason: "keep_jobs_json_cleaner", resolution_action: "use_fixed_pay" };
  }
  if (samePayMeaning(jobsValue, recordPay)) {
    return { chosen: jobsValue || recordPay, reason: "keep_jobs_json_cleaner", equivalent: true };
  }
  if (isSuspiciousPayDowngrade(jobsValue, recordPay)) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner", suspicious_downgrade_blocked: true };
  }
  if (cleanText(job.id) === "solar-united-neighbors-5dd5c717f705") {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (jobsValue && !isValidPay(recordPay)) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (!jobsValue && recordPay) {
    return { chosen: recordPay, reason: "jobs_json_blank" };
  }
  if (jobsValue && !recordPay) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  return { chosen: jobsValue || recordPay, reason: jobsValue ? "manual_review_required" : "use_job_records_cleaner" };
}

function decideLocation(job, recordValue, companyResolution = null, locationResolution = null) {
  const jobsValue = getCanonicalLocation(job);
  const recordText = cleanText(recordValue);
  if (locationResolution?.action === "use_fixed_location" && cleanText(locationResolution.location)) {
    return {
      chosen: cleanText(locationResolution.location),
      reason: "keep_jobs_json_cleaner",
      resolution_action: "use_fixed_location"
    };
  }
  if (locationResolution?.action === "keep_jobs_json" && jobsValue) {
    return {
      chosen: jobsValue,
      reason: "keep_jobs_json_cleaner",
      resolution_action: "keep_jobs_json_location"
    };
  }
  if (companyResolution?.action === "use_jobs_json_company" && jobsValue) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (cleanText(job.id) === "edp-f365739f6c21" && jobsValue) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (jobsValue && !isCleanLocation(recordText)) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (!jobsValue && isCleanLocation(recordText)) {
    return { chosen: recordText, reason: "jobs_json_blank" };
  }
  if (jobsValue && !isCleanLocation(jobsValue) && isCleanLocation(recordText)) {
    return { chosen: recordText, reason: "jobs_json_corrupted" };
  }
  return { chosen: jobsValue || recordText, reason: jobsValue ? "manual_review_required" : "use_job_records_cleaner" };
}

function decideWorkplaceType(job, recordValue) {
  const jobsValue = getCanonicalWorkplaceType(job);
  const recordText = normalizeWorkplaceType(recordValue, "");
  if (jobsValue) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (recordText) {
    return { chosen: recordText, reason: "jobs_json_blank" };
  }
  return { chosen: "", reason: "manual_review_required" };
}

function decideOrganization(job, recordValue, resolution = null) {
  const jobsValue = cleanText(job.organization);
  const recordText = cleanText(recordValue);
  if (resolution?.action === "use_jobs_json_company") {
    return { chosen: cleanText(resolution.company || jobsValue), reason: "keep_jobs_json_cleaner", resolution_action: "use_jobs_json_company" };
  }
  if (resolution?.action === "use_job_records_company") {
    return { chosen: cleanText(resolution.company || recordText), reason: "use_job_records_cleaner", resolution_action: "use_job_records_company" };
  }
  if (resolution?.action === "manual_review_required") {
    return { chosen: jobsValue || recordText, reason: "manual_review_required", resolution_action: "manual_review_required" };
  }
  if (MANUAL_COMPANY_REVIEW_IDS.has(cleanText(job.id)) && jobsValue !== recordText) {
    return { chosen: jobsValue || recordText, reason: "manual_review_required" };
  }
  if (jobsValue && !recordText) return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  if (!jobsValue && recordText) return { chosen: recordText, reason: "jobs_json_blank" };
  if (jobsValue === recordText) return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  return { chosen: jobsValue || recordText, reason: "manual_review_required" };
}

function decideSpecialization(job, recordValue) {
  const title = cleanText(job.title);
  const jobsValue = cleanText(job.specialization);
  const recordText = cleanText(recordValue);
  if (VIDEO_SIGNAL.test(title) || /video production fellow/i.test(title)) {
    return { chosen: "Video", reason: jobsValue === "Video" ? "keep_jobs_json_cleaner" : "use_job_records_cleaner" };
  }
  if (ENGINEERING_SIGNAL.test(title) && ["", "Strategy", "Web", "Data"].includes(jobsValue)) {
    return { chosen: "Engineering", reason: recordText === "Engineering" ? "use_job_records_cleaner" : "manual_review_required" };
  }
  if (jobsValue && CANONICAL_SPECIALIZATIONS.includes(jobsValue)) {
    return { chosen: jobsValue, reason: "keep_jobs_json_cleaner" };
  }
  if (!jobsValue && recordText && CANONICAL_SPECIALIZATIONS.includes(recordText)) {
    return { chosen: recordText, reason: "jobs_json_blank" };
  }
  if (jobsValue && !CANONICAL_SPECIALIZATIONS.includes(jobsValue) && recordText && CANONICAL_SPECIALIZATIONS.includes(recordText)) {
    return { chosen: recordText, reason: "jobs_json_corrupted" };
  }
  return { chosen: jobsValue || recordText, reason: "manual_review_required" };
}

function decidePageUrl(job, companyDecision = null, titleDecision = null) {
  if (companyDecision?.resolution_action === "use_job_records_company" && companyDecision.chosen) {
    const nextTitle = cleanText(titleDecision?.chosen || job.title);
    const next = normalizeManualPagePath(`./pages/${slugify(nextTitle)}-${slugify(cleanText(companyDecision.chosen))}.html`);
    return { chosen: next, reason: "use_job_records_cleaner", resolution_action: "regenerate_with_redirect" };
  }
  const pageUrl = normalizeManualPagePath(job.page_url);
  if (pageUrl) {
    return { chosen: pageUrl, reason: "keep_jobs_json_cleaner" };
  }
  return { chosen: "", reason: "manual_review_required" };
}

function buildFieldDecision(field, job, recordDisplay, context = {}) {
  const recordValue = recordDisplay[field] || "";
  switch (field) {
    case "description":
      return decideDescription(job, recordValue, context.descriptionResolution, context.oldJob);
    case "snippet":
      return decideSnippet(job, recordDisplay.description || "", context.descriptionDecision, context.oldJob);
    case "salary":
      return decidePay(job, recordValue, context.payResolution);
    case "location":
      return decideLocation(job, recordValue, context.companyResolution, context.locationResolution);
    case "workplace_type":
      return decideWorkplaceType(job, recordValue);
    case "organization":
      return decideOrganization(job, recordValue, context.companyResolution);
    case "specialization":
      return decideSpecialization(job, recordValue);
    case "page_url":
      return decidePageUrl(job, context.companyDecision, context.titleDecision);
    case "title":
      if (
        context.companyResolution?.action === "use_job_records_company" &&
        cleanText(recordValue) &&
        cleanText(recordValue) !== cleanText(job.title) &&
        cleanText(job.organization) &&
        cleanText(recordValue).toLowerCase().includes(cleanText(job.organization).toLowerCase())
      ) {
        return { chosen: cleanText(recordValue), reason: "use_job_records_cleaner" };
      }
      return cleanText(job.title)
        ? { chosen: cleanText(job.title), reason: "keep_jobs_json_cleaner" }
        : { chosen: cleanText(recordValue), reason: recordValue ? "jobs_json_blank" : "manual_review_required" };
    default:
      return { chosen: cleanText(job[field]) || cleanText(recordValue), reason: "manual_review_required" };
  }
}

function buildRecordDisplay(record = {}) {
  const display = record.display || {};
  const raw = record.raw_source_data || {};
  return {
    title: cleanText(display.title || raw.title),
    organization: cleanText(display.organization || raw.organization),
    description: cleanText(display.description || raw.description || raw.raw_description),
    salary: cleanText(display.pay_display || raw.salary),
    location: cleanText(display.location || raw.location),
    workplace_type: cleanText(display.location_type || raw.workplace_type),
    specialization: cleanText(display.specialization || raw.specialization),
    page_url: cleanText(display.page_url_override || raw.page_url_override),
    source: cleanText(display.source_name || raw.source),
    source_id: cleanText(raw.source_id),
    source_type: cleanText(record.source_type || raw.source_type)
  };
}

function collectManualOverrides(existing = {}, decisions = {}) {
  const fields = new Set(
    []
      .concat(Array.isArray(existing.manual_overrides) ? existing.manual_overrides : [])
      .concat(Array.isArray(existing.protected_fields) ? existing.protected_fields : [])
  );
  Object.entries(decisions).forEach(([field, decision]) => {
    if (
      decision.reason === "keep_jobs_json_cleaner" ||
      decision.reason === "jobs_json_blank" ||
      decision.reason === "jobs_json_corrupted" ||
      decision.reason === "restore_oldjobs" ||
      decision.reason === "use_placeholder"
    ) {
      (PROTECTED_FIELD_MAP[field] || []).forEach((path) => fields.add(path));
    }
  });
  return Array.from(fields);
}

function setImportedFieldMeta(record, decisions, now) {
  const next = {
    ...record,
    last_manual_edit_at: stringifySafe(record.last_manual_edit_at || now),
    field_meta: {
      ...(record.field_meta && typeof record.field_meta === "object" ? record.field_meta : {})
    }
  };
  Object.entries(decisions).forEach(([field, decision]) => {
    const metaKey = field === "salary" ? "pay_display" : field === "workplace_type" ? "location_type" : field;
    const importedFromCurrentJobsJson = ["keep_jobs_json_cleaner", "jobs_json_blank", "jobs_json_corrupted"].includes(decision.reason);
    next.field_meta[metaKey] = {
      ...(next.field_meta[metaKey] || {}),
      imported_from_current_jobs_json: importedFromCurrentJobsJson,
      last_manual_edit_at:
        importedFromCurrentJobsJson || decision.reason === "restore_oldjobs" || decision.reason === "use_placeholder"
          ? now
          : (next.field_meta[metaKey] || {}).last_manual_edit_at || "",
      last_reconcile_decision_at: now,
      last_reconcile_reason: normalizeWinnerReason(decision.reason)
    };
  });
  return next;
}

function summarizeDecisions(decisionsList) {
  const grouped = {
    "description mismatch": [],
    "snippet mismatch": [],
    "pay mismatch": [],
    "location mismatch": [],
    "specialization mismatch": [],
    "organization/company mismatch": [],
    "page_url mismatch": []
  };
  decisionsList.forEach((item) => {
    grouped[item.category].push(item);
  });
  return grouped;
}

function dedupeList(items = []) {
  return Array.from(new Map((Array.isArray(items) ? items : []).map((item) => [item.id || `${item.title}::${item.company}`, item])).values());
}

function getExcerpt(value, limit = 240) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trim()}…`;
}

function getJunkReasons(value) {
  const text = cleanText(value);
  if (!text) return [];
  return JUNK_REASON_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
}

async function readResolutions() {
  const payload = await readJson(RESOLUTIONS_FILE, {
    description_resolutions: {},
    company_resolutions: {},
    specialization_resolutions: {},
    pay_resolutions: {},
    location_resolutions: {}
  });
  return payload && typeof payload === "object" ? payload : {
    description_resolutions: {},
    company_resolutions: {},
    specialization_resolutions: {},
    pay_resolutions: {},
    location_resolutions: {}
  };
}

function getDescriptionResolution(resolutions, id) {
  return resolutions?.description_resolutions?.[id] || null;
}

function getCompanyResolution(resolutions, id) {
  return resolutions?.company_resolutions?.[id] || null;
}

function getPayResolution(resolutions, id) {
  return resolutions?.pay_resolutions?.[id] || null;
}

function getLocationResolution(resolutions, id) {
  return resolutions?.location_resolutions?.[id] || null;
}

function buildProposedPublicIndex(publicJobs = []) {
  const byId = new Map();
  const byTitleOrg = new Map();
  const byUrl = new Map();
  for (const job of Array.isArray(publicJobs) ? publicJobs : []) {
    const id = cleanText(job.id);
    const titleOrg = buildTitleOrgKey(job.title, job.organization);
    const urls = [job.apply_url, job.original_url, job.source_url, job.page_url].map((value) => cleanText(value)).filter(Boolean);
    if (id && !byId.has(id)) byId.set(id, job);
    if (titleOrg !== "::" && !byTitleOrg.has(titleOrg)) byTitleOrg.set(titleOrg, job);
    urls.forEach((url) => {
      if (!byUrl.has(url)) byUrl.set(url, job);
    });
  }
  return { byId, byTitleOrg, byUrl };
}

function resolvePendingOverlap(pendingJob, publicIndex, backfilledIds) {
  const id = cleanText(pendingJob.id);
  const titleOrg = buildTitleOrgKey(pendingJob.title, pendingJob.organization);
  const urls = [pendingJob.apply_url, pendingJob.original_url, pendingJob.source_url, pendingJob.page_url].map((value) => cleanText(value)).filter(Boolean);
  const matches = [];
  if (id && publicIndex.byId.has(id)) matches.push({ method: "id", job: publicIndex.byId.get(id) });
  if (titleOrg !== "::" && publicIndex.byTitleOrg.has(titleOrg)) matches.push({ method: "title_org", job: publicIndex.byTitleOrg.get(titleOrg) });
  urls.forEach((url) => {
    if (publicIndex.byUrl.has(url)) {
      matches.push({ method: "url", job: publicIndex.byUrl.get(url) });
    }
  });
  if (!matches.length) return null;
  const uniqueMethods = Array.from(new Set(matches.map((item) => item.method)));
  const matchedPublicJob = matches[0].job;
  const proposedAction = backfilledIds.has(id)
    ? "remove_from_pending"
    : uniqueMethods.includes("id") || uniqueMethods.includes("url") || uniqueMethods.includes("title_org")
      ? "mark_already_published"
      : "manual_review_required";
  return {
    id,
    title: cleanText(pendingJob.title),
    company: cleanText(pendingJob.organization),
    source: cleanText(pendingJob.source),
    page_url: cleanText(matchedPublicJob?.page_url),
    canonical_id: cleanText(matchedPublicJob?.id),
    match_method: uniqueMethods.join("+"),
    proposed_pending_action: proposedAction
  };
}

async function writeReportFiles(report) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.writeFile(RECONCILE_REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const md = buildMarkdownReport(report);
  await fs.writeFile(RECONCILE_REPORT_MD, md, "utf8");
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Reconcile Audit");
  lines.push("");
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- jobs_json_count: ${report.jobs_json_count}`);
  lines.push(`- published_job_records_before: ${report.published_job_records_before}`);
  lines.push(`- proposed_published_job_records_after: ${report.proposed_published_job_records_after}`);
  lines.push(`- missing_jobs_to_backfill_count: ${report.missing_jobs_to_backfill_count}`);
  lines.push(`- pending_public_overlap_before: ${report.pending_public_overlap_before}`);
  lines.push(`- pending_public_overlap_after_proposed: ${report.pending_public_overlap_after_proposed}`);
  lines.push(`- pending_after_dedupe_count: ${report.pending_after_dedupe_count}`);
  lines.push(`- write_allowed: ${report.write_allowed}`);
  lines.push("");
  lines.push("## Write Blockers");
  lines.push("");
  (report.write_blocked_reasons || []).forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## Missing Jobs To Backfill");
  lines.push("");
  (report.missing_jobs_to_backfill || []).forEach((job) => {
    lines.push(`- ${job.title} | ${job.company} | ${job.canonical_id} | ${job.page_url} | pending_match=${job.matching_pending_exists}`);
  });
  lines.push("");
  lines.push("## Pending/Public Overlap");
  lines.push("");
  (report.pending_public_overlap_jobs || []).forEach((job) => {
    lines.push(`- ${job.title} | ${job.company} | match=${job.match_method} | action=${job.proposed_pending_action} | public=${job.page_url}`);
  });
  lines.push("");
  lines.push("## Description Resolution Review");
  lines.push("");
  (report.description_resolution_review || []).forEach((item) => {
    lines.push(`- ${item.title} | ${item.company} | ${item.page_url} | reasons=${(item.junk_reasons || []).join(", ")} | action=${item.proposed_action}`);
  });
  lines.push("");
  lines.push("## Company Mismatches");
  lines.push("");
  (report.company_mismatch_review || []).forEach((item) => {
    lines.push(`- ${item.title} | jobs.json=${item.jobs_json_company} | job-records=${item.job_records_company} | id=${item.canonical_id} | ${item.page_url} | action=${item.suggested_action}`);
  });
  lines.push("");
  lines.push("## Location Resolutions");
  lines.push("");
  (report.location_resolution_review || []).forEach((item) => {
    lines.push(`- ${item.title} | jobs.json=${item.jobs_json_location} | job-records=${item.job_records_location} | proposed=${item.proposed_location} | id=${item.canonical_id} | action=${item.resolution_action}`);
  });
  lines.push("");
  lines.push("## Pay Mismatches");
  lines.push("");
  (report.pay_mismatch_review || []).forEach((item) => {
    lines.push(`- ${item.title} | jobs.json=${item.jobs_json_pay} | job-records=${item.job_records_pay} | proposed=${item.proposed_pay} | id=${item.canonical_id} | action=${item.resolution_label}`);
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildProposedPublicJob(job, decisions, recordDisplay) {
  const description = cleanText(decisions.description.chosen);
  const snippet = cleanText(decisions.snippet.chosen) || buildDescriptionSnippet(description, 220, { title: cleanText(decisions.title.chosen) });
  const salary = cleanText(decisions.salary.chosen);
  const location = cleanText(decisions.location.chosen);
  const workplaceType = cleanText(decisions.workplace_type.chosen);
  const specialization = cleanText(decisions.specialization.chosen);
  const organization = cleanText(decisions.organization.chosen);
  const title = cleanText(decisions.title.chosen);
  const pageUrl = cleanText(decisions.page_url.chosen) || cleanText(job.page_url);
  return {
    ...job,
    id: cleanText(job.id),
    title,
    organization,
    description,
    description_snippet: snippet,
    summary: snippet,
    salary,
    pay_display: salary,
    location,
    workplace_type: workplaceType,
    specialization,
    page_url: pageUrl,
    source: cleanText(job.source || recordDisplay.source),
    source_type: cleanText(job.source_type || recordDisplay.source_type)
  };
}

function buildReconcileWriteBlockers({ overwriteAudit, manualReviewList, missingBackfillCount, severeCorruption }) {
  const blockers = [];
  if (overwriteAudit?.worse_reasons?.length) {
    blockers.push(...overwriteAudit.worse_reasons);
  }
  if (Array.isArray(severeCorruption) && severeCorruption.length) {
    blockers.push(`severe_corrupted_descriptions_require_manual_review=${severeCorruption.length}`);
  }
  if (Array.isArray(manualReviewList) && manualReviewList.length) {
    blockers.push(`manual_review_required_count=${manualReviewList.length}`);
  }
  const companyMismatchReviews = (Array.isArray(manualReviewList) ? manualReviewList : []).filter((item) => item.reason === "organization/company mismatch");
  if (companyMismatchReviews.length) {
    blockers.push(`company_mismatches_require_manual_review=${companyMismatchReviews.length}`);
  }
  if (!missingBackfillCount && blockers.length === 0 && Number(overwriteAudit?.field_counts?.jobs_changed || 0) === 0) {
    blockers.push("no_reconcile_changes_detected");
  }
  return Array.from(new Set(blockers));
}

function applyResolutionAwareOverwriteAudit(overwriteAudit, resolutions) {
  const approvedIds = new Set([
    ...Object.keys(resolutions?.description_resolutions || {}),
    ...Object.keys(resolutions?.company_resolutions || {}),
    ...Object.keys(resolutions?.specialization_resolutions || {})
  ]);
  const filteredRiskyExamples = (overwriteAudit?.risky_examples || []).filter((item) => !approvedIds.has(cleanText(item.id)));
  const filteredReasons = (overwriteAudit?.worse_reasons || []).filter((reason) => {
    if (reason !== "manual/frontend-cleaned fields would be replaced by worse values") return true;
    return filteredRiskyExamples.length > 0;
  });
  return {
    ...overwriteAudit,
    risky_examples: filteredRiskyExamples,
    worse_reasons: filteredReasons
  };
}

function classifyDiffDecision({ currentJob, oldJob, proposedJob, recordDisplay, decisions }) {
  const decisionList = Object.values(decisions || {});
  if (decisionList.some((decision) => decision.resolution_action === "use_placeholder" || decision.reason === "use_placeholder")) {
    return "use_placeholder";
  }
  if (decisionList.some((decision) => decision.reason === "manual_review_required")) {
    return "manual_review_required";
  }
  if (decisionList.some((decision) => decision.reason === "restore_oldjobs")) {
    return "restore_oldjobs";
  }
  if (decisionList.some((decision) => decision.reason === "use_job_records_cleaner")) {
    return "use_job_records_cleaner";
  }
  if (proposedJob && currentJob && cleanText(proposedJob.organization) === cleanText(currentJob.organization) && cleanText(proposedJob.title) === cleanText(currentJob.title)) {
    return "keep_current";
  }
  return "manual_review_required";
}

function summarizeOldJobsDiffs({ currentJobs, oldJobsById, proposedById, recordDisplayById, decisionsById }) {
  const records = [];
  (Array.isArray(currentJobs) ? currentJobs : []).forEach((job) => {
    const id = cleanText(job.id);
    const oldJob = oldJobsById.get(id);
    if (!oldJob) return;
    const changedFields = [];
    [
      "organization",
      "title",
      "description",
      "description_snippet",
      "summary",
      "location",
      "specialization",
      "salary",
      "page_url",
      "apply_url"
    ].forEach((field) => {
      if (cleanText(oldJob[field]) !== cleanText(job[field])) {
        changedFields.push(field);
      }
    });
    if (!changedFields.length) return;
    records.push({
      id,
      title: cleanText(job.title),
      company: cleanText(job.organization),
      changed_fields: changedFields,
      resolution_label: classifyDiffDecision({
        currentJob: job,
        oldJob,
        proposedJob: proposedById.get(id) || job,
        recordDisplay: recordDisplayById.get(id) || {},
        decisions: decisionsById.get(id) || {}
      })
    });
  });
  return records.sort((left, right) => left.company.localeCompare(right.company) || left.title.localeCompare(right.title));
}

function buildTargetedIssueStatus(proposedById, jobsById) {
  const resource = proposedById.get("elemental-impact-446c301b54b2") || jobsById.get("elemental-impact-446c301b54b2") || {};
  const fervo = proposedById.get("elemental-impact-c6c7ccd02120") || jobsById.get("elemental-impact-c6c7ccd02120") || {};
  const edpInterconnection = proposedById.get("edp-e87960ee8c52") || jobsById.get("edp-e87960ee8c52") || {};
  const edpProject = proposedById.get("edp-0164b558d6e6") || jobsById.get("edp-0164b558d6e6") || {};
  const nextEra = proposedById.get("nextera-energy-50fe226b28a5") || jobsById.get("nextera-energy-50fe226b28a5") || {};
  const shifted = proposedById.get("elemental-impact-95090d1a6bc6") || jobsById.get("elemental-impact-95090d1a6bc6") || {};
  const solar = proposedById.get("solar-united-neighbors-5dd5c717f705") || jobsById.get("solar-united-neighbors-5dd5c717f705") || {};
  return {
    resource_innovations_protected: {
      resolved: cleanText(resource.organization) === "Resource Innovations" && /resource-innovations/i.test(cleanText(resource.page_url)),
      company: cleanText(resource.organization),
      page_url: cleanText(resource.page_url)
    },
    fervo_director_corrected: {
      resolved: cleanText(fervo.title) === "Director, Internal Audit" && cleanText(fervo.organization) === "Fervo Energy" && /director-internal-audit-fervo-energy/i.test(cleanText(fervo.page_url)),
      title: cleanText(fervo.title),
      company: cleanText(fervo.organization),
      page_url: cleanText(fervo.page_url)
    },
    edp_interconnection_cleaned: {
      resolved:
        Boolean(cleanText(edpInterconnection.description)) &&
        !REPEATED_DATE_JUNK.test(cleanText(edpInterconnection.description)) &&
        !/hdrDate|Interconnection Analyst Interconnection Analyst|Apr \d{1,2}, \d{4}/i.test(cleanText(edpInterconnection.description)),
      description_excerpt: getExcerpt(cleanText(edpInterconnection.description))
    },
    edp_project_cleanest_selected: {
      resolved: /^The Project Development Analyst\b/.test(cleanText(edpProject.description)) && !/Cover letters are strongly encouraged This role/i.test(cleanText(edpProject.description)),
      description_excerpt: getExcerpt(cleanText(edpProject.description))
    },
    nextera_not_over_stripped: {
      resolved: cleanText(nextEra.description).length > cleanText(jobsById.get("nextera-energy-50fe226b28a5")?.description).length,
      description_excerpt: getExcerpt(cleanText(nextEra.description))
    },
    shifted_energy_not_corrupted: {
      resolved: isReadableDescription(cleanText(shifted.description), cleanText(shifted.title)),
      description_excerpt: getExcerpt(cleanText(shifted.description))
    },
    solar_united_neighbors_pay_protected: {
      resolved: /\$80,000(?:\.00)?\s*[–-]\s*\$95,880(?:\.00)?(?:\s+annual salary| \/ year)?/i.test(cleanText(solar.salary)),
      pay: cleanText(solar.salary)
    }
  };
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const preferCurrentJobsJson = process.argv.includes("--prefer-current-jobs-json");
  const now = new Date().toISOString();
  const [records, jobs, pendingBefore, resolutions, oldJobs] = await Promise.all([
    readJobRecords(),
    readJobs(),
    readPendingSyncedJobs(),
    readResolutions(),
    readOldJobs()
  ]);
  const jobsById = buildJobsIndex(jobs);
  const oldJobsById = buildJobsIndex(oldJobs);

  const jobRecords = Array.isArray(records) ? records.filter((record) => record && record.record_type === "job") : [];
  const nonJobRecords = Array.isArray(records) ? records.filter((record) => !record || record.record_type !== "job") : [];
  const publishedById = new Map(jobRecords.filter(isPublishedRecord).map((record) => [cleanText(record.id), record]));
  const recordIndexes = buildRecordIndexes(jobRecords);
  const usedRecordIndexes = new Set();
  const reconciledJobRecords = [];
  const proposedPublicJobs = [];
  const fieldDecisions = [];
  const decisionsById = new Map();
  const recordDisplayById = new Map();
  const manualReview = [];
  const missingJobsBackfilled = [];
  const severeCorruption = [];
  const descriptionReview = [];

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const match = inferSupportingMatch(job, recordIndexes, pendingBefore);
    const baseEntry = match.recordMatch;
    const existingRecord = baseEntry ? baseEntry.record : {};
    if (baseEntry) usedRecordIndexes.add(baseEntry.index);
    const recordDisplay = buildRecordDisplay(existingRecord);
    recordDisplayById.set(cleanText(job.id), recordDisplay);
    const oldJob = oldJobsById.get(cleanText(job.id)) || null;
    const descriptionResolution = getDescriptionResolution(resolutions, cleanText(job.id));
    const companyResolution = getCompanyResolution(resolutions, cleanText(job.id));
    const locationResolution = getLocationResolution(resolutions, cleanText(job.id));
    const descriptionDecision = buildFieldDecision("description", job, recordDisplay, {
      descriptionResolution,
      oldJob
    });
    const organizationDecision = buildFieldDecision("organization", job, recordDisplay, {
      companyResolution
    });
    const decisions = {
      title: buildFieldDecision("title", job, recordDisplay, {
        companyResolution
      }),
      organization: organizationDecision,
      description: descriptionDecision,
      snippet: buildFieldDecision("snippet", job, recordDisplay, {
        descriptionDecision,
        oldJob
      }),
      salary: buildFieldDecision("salary", job, recordDisplay, {
        payResolution: getPayResolution(resolutions, cleanText(job.id))
      }),
      location: buildFieldDecision("location", job, recordDisplay, {
        companyResolution,
        locationResolution
      }),
      workplace_type: buildFieldDecision("workplace_type", job, recordDisplay),
      specialization: buildFieldDecision("specialization", job, recordDisplay),
      page_url: buildFieldDecision("page_url", job, recordDisplay, {
        companyDecision: organizationDecision,
        titleDecision: null
      })
    };
    decisions.page_url = buildFieldDecision("page_url", job, recordDisplay, {
      companyDecision: organizationDecision,
      titleDecision: decisions.title
    });
    decisionsById.set(cleanText(job.id), decisions);

    [
      ["description mismatch", "description", getCanonicalDescription(job), recordDisplay.description],
      ["snippet mismatch", "snippet", getCanonicalSnippet(job), buildDescriptionSnippet(recordDisplay.description, 220, { title: job.title })],
      ["pay mismatch", "salary", getCanonicalPay(job), recordDisplay.salary],
      ["location mismatch", "location", getCanonicalLocation(job), recordDisplay.location],
      ["specialization mismatch", "specialization", cleanText(job.specialization), recordDisplay.specialization],
      ["organization/company mismatch", "organization", cleanText(job.organization), recordDisplay.organization],
      ["page_url mismatch", "page_url", cleanText(job.page_url), recordDisplay.page_url]
    ].forEach(([category, field, jobsValue, recordsValue]) => {
      const left = cleanText(jobsValue);
      const right = cleanText(recordsValue);
      if (field === "salary" && samePayMeaning(left, right)) return;
      if (field === "page_url" && !right) return;
      if (left !== right) {
        fieldDecisions.push({
          category,
          id: cleanText(job.id),
          title: cleanText(job.title),
          company: cleanText(job.organization),
          field,
          jobs_json_value: left,
          job_records_value: right,
          chosen_value: cleanText(decisions[field].chosen),
          winner_reason: normalizeWinnerReason(decisions[field].reason),
          resolution_action: cleanText(decisions[field].resolution_action || "")
        });
        if (normalizeWinnerReason(decisions[field].reason) === "manual_review_required") {
          manualReview.push({
            id: cleanText(job.id),
            title: cleanText(job.title),
            company: cleanText(job.organization),
            reason: category
          });
        }
      }
    });

    const nextInput = {
      ...(existingRecord.raw_source_data || {}),
      ...job,
      id: cleanText(job.id),
      title: cleanText(decisions.title.chosen),
      organization: cleanText(decisions.organization.chosen),
      description: cleanText(decisions.description.chosen),
      ...deriveSalaryShapeFromChosenPay(decisions.salary.chosen),
      location: cleanText(decisions.location.chosen),
      workplace_type: cleanText(decisions.workplace_type.chosen),
      specialization: cleanText(decisions.specialization.chosen),
      source: cleanText(job.source || recordDisplay.source),
      source_id: cleanText(job.source_id || recordDisplay.source_id),
      source_type: cleanText(job.source_type || recordDisplay.source_type || existingRecord.source_type || "scraped"),
      source_url: cleanText(job.source_url || (existingRecord.display || {}).source_url || (existingRecord.raw_source_data || {}).source_url),
      original_url: cleanText(job.original_url || (existingRecord.display || {}).original_url || (existingRecord.raw_source_data || {}).original_url || job.source_url),
      apply_url: cleanText(job.apply_url || (existingRecord.display || {}).application_url || (existingRecord.raw_source_data || {}).apply_url),
      page_url_override: cleanText(decisions.page_url.chosen),
      status: "published",
      published: true,
      public_visibility: true
    };

    const manualOverrideFields = collectManualOverrides(existingRecord, decisions);
    const reconciled = setImportedFieldMeta(
      buildJobRecord(nextInput, {
        ...existingRecord,
        status: "published",
        published: true,
        public_visibility: true,
        manual_overrides: manualOverrideFields
      }, {
        context: "manual_edit",
        now,
        manualFields: new Set(["title", "organization", "description", "pay_display", "location", "location_type", "specialization", "page_url_override", "source_url", "original_url", "application_url"])
      }),
      decisions,
      now
    );
    reconciledJobRecords.push(reconciled);
    proposedPublicJobs.push(buildProposedPublicJob(job, decisions, recordDisplay));

    if (!publishedById.has(cleanText(job.id))) {
      missingJobsBackfilled.push({
        title: cleanText(job.title),
        company: cleanText(job.organization),
        canonical_id: cleanText(job.id),
        page_url: cleanText(job.page_url),
        source: cleanText(job.source || job.source_id),
        matching_raw_or_record_exists: Boolean(match.recordMatch),
        matching_pending_exists: Boolean(match.pendingMatch),
        field_meta_imported_from_current_jobs_json: true
      });
    }

    const currentDescriptionIsCorrupted = isCorruptedDescription(getCanonicalDescription(job));
    if (descriptionResolution || currentDescriptionIsCorrupted) {
      descriptionReview.push({
        id: cleanText(job.id),
        title: cleanText(job.title),
        company: cleanText(job.organization),
        page_url: cleanText(job.page_url),
        current_junk_reasons: getJunkReasons(getCanonicalDescription(job)),
        resolution_action: descriptionResolution?.action || "manual_review_required"
      });
    }

    if (currentDescriptionIsCorrupted && !descriptionResolution) {
      const recordDescription = cleanText(recordDisplay.description);
      if (!recordDescription || isCorruptedDescription(recordDescription)) {
        severeCorruption.push({
          id: cleanText(job.id),
          title: cleanText(job.title),
          company: cleanText(job.organization),
          description_status: "current_jobs_json_corrupted_no_clean_job_records_fallback"
        });
      }
    }
  }

  const untouchedJobRecords = jobRecords.filter((_, index) => !usedRecordIndexes.has(index) && !publishedById.has(cleanText(jobRecords[index].id)));
  const proposedRecords = [...nonJobRecords, ...reconciledJobRecords, ...untouchedJobRecords];

  const overwriteAudit = applyResolutionAwareOverwriteAudit(compareJobsOutputs(jobs, proposedPublicJobs), resolutions);
  const proposedById = buildJobsIndex(proposedPublicJobs);
  const targetedIssueStatus = buildTargetedIssueStatus(proposedById, jobsById);
  const proposedPublicIndex = buildProposedPublicIndex(proposedPublicJobs);
  const backfilledIds = new Set(missingJobsBackfilled.map((item) => cleanText(item.canonical_id)));
  const pendingOverlapJobs = pendingBefore
    .map((job) => resolvePendingOverlap(job, proposedPublicIndex, backfilledIds))
    .filter(Boolean);
  const unresolvedPendingOverlap = pendingOverlapJobs.filter((item) => item.proposed_pending_action === "manual_review_required");
  const pendingOverlapAfter = unresolvedPendingOverlap.length;
  const pendingAfterDedupeCount = pendingBefore.length - pendingOverlapJobs.filter((item) => item.proposed_pending_action !== "manual_review_required").length;
  let validationPreview = null;
  const writeBlockers = buildReconcileWriteBlockers({
    overwriteAudit,
    manualReviewList: manualReview,
    missingBackfillCount: missingJobsBackfilled.length,
    severeCorruption
  });
  Object.entries(targetedIssueStatus).forEach(([key, value]) => {
    if (!value.resolved) writeBlockers.push(`targeted_issue_unresolved=${key}`);
  });
  if (pendingOverlapAfter > 0) {
    writeBlockers.push(`pending_public_overlap_after_proposed=${pendingOverlapAfter}`);
  }
  const writeAllowed = writeBlockers.length === 0;

  const groupedDecisions = summarizeDecisions(fieldDecisions);
  const oldJobsDiffReview = summarizeOldJobsDiffs({
    currentJobs: jobs,
    oldJobsById,
    proposedById,
    recordDisplayById,
    decisionsById
  });
  const descriptionReviewDetails = descriptionReview.map((item) => {
    const job = (Array.isArray(jobs) ? jobs : []).find((entry) => cleanText(entry.id) === item.id) || {};
    const resolution = getDescriptionResolution(resolutions, item.id);
    const recordEntry = recordIndexes.byId.get(item.id)?.record || inferSupportingMatch(job, recordIndexes, pendingBefore).recordMatch?.record || {};
    const recordDisplay = buildRecordDisplay(recordEntry);
    const recordDescription = cleanText(recordDisplay.description);
    return {
      title: item.title,
      company: item.company,
      page_url: item.page_url,
      junk_reasons: item.current_junk_reasons,
      jobs_json_excerpt: getExcerpt(getCanonicalDescription(job)),
      job_records_excerpt: getExcerpt(recordDescription),
      proposed_action: resolution?.action || (recordDescription && !isCorruptedDescription(recordDescription) ? "use_job_records_cleaner" : "manual_review_required"),
      proposed_clean_description: resolution?.action === "use_placeholder"
        ? cleanText(resolution.description)
        : resolution?.action === "use_job_records_cleaner" && recordDescription
          ? recordDescription
          : resolution?.action === "keep_jobs_json"
            ? getCanonicalDescription(job)
            : "",
      proposed_clean_snippet: resolution?.action === "use_placeholder"
        ? cleanText(resolution.snippet)
        : resolution?.action === "use_job_records_cleaner" && recordDescription
          ? buildDescriptionSnippet(recordDescription, 220, { title: cleanText(job.title) })
          : resolution?.action === "keep_jobs_json"
            ? getCanonicalSnippet(job)
            : ""
    };
  });
  const severeCorruptionDetails = descriptionReviewDetails.filter((item) => item.proposed_action === "manual_review_required");
  const companyMismatchReview = groupedDecisions["organization/company mismatch"]
    .filter((item) => MANUAL_COMPANY_REVIEW_IDS.has(item.id) || Boolean(getCompanyResolution(resolutions, item.id)))
    .map((item) => {
      const job = (Array.isArray(jobs) ? jobs : []).find((entry) => cleanText(entry.id) === item.id) || {};
      const recordEntry = recordIndexes.byId.get(item.id)?.record || {};
      const recordDisplay = buildRecordDisplay(recordEntry);
      const resolution = getCompanyResolution(resolutions, item.id);
      return {
        title: item.title,
        jobs_json_company: item.jobs_json_value,
        job_records_company: item.job_records_value,
        canonical_id: item.id,
        page_url: cleanText(job.page_url),
        source: cleanText(job.source || recordDisplay.source),
        chosen_company: cleanText(
          resolution?.action === "use_job_records_company"
            ? (resolution.company || item.job_records_value)
            : resolution?.action === "use_jobs_json_company"
              ? (resolution.company || item.jobs_json_value)
              : ""
        ),
        page_url_needs_change: resolution?.page_url_action === "regenerate_with_redirect",
        redirect_path_should_be_added: resolution?.page_url_action === "regenerate_with_redirect",
        title_company_pairing_valid: resolution?.action ? resolution.action !== "manual_review_required" : false,
        suggested_action: resolution?.action || "manual_review_required"
      };
    });
  const payMismatchReview = groupedDecisions["pay mismatch"].map((item) => {
    const payResolution = getPayResolution(resolutions, item.id);
    return {
      canonical_id: item.id,
      title: item.title,
      company: item.company,
      jobs_json_pay: item.jobs_json_value,
      job_records_pay: item.job_records_value,
      proposed_pay: item.chosen_value,
      resolution_label: item.winner_reason,
      suspicious_downgrade_blocked: isSuspiciousPayDowngrade(item.jobs_json_value, item.job_records_value),
      fixed_resolution_applied: payResolution?.action === "use_fixed_pay"
    };
  });
  const locationResolutionReview = groupedDecisions["location mismatch"]
    .filter((item) => item.resolution_action === "use_fixed_location" || item.resolution_action === "keep_jobs_json_location")
    .map((item) => ({
      canonical_id: item.id,
      title: item.title,
      company: item.company,
      jobs_json_location: item.jobs_json_value,
      job_records_location: item.job_records_value,
      proposed_location: item.chosen_value,
      resolution_action: item.resolution_action
    }));
  const report = {
    mode: shouldWrite ? "write" : "dry-run",
    prefer_current_jobs_json: preferCurrentJobsJson,
    jobs_json_count: jobs.length,
    published_job_records_before: jobRecords.filter(isPublishedRecord).length,
    proposed_published_job_records_after: reconciledJobRecords.length,
    proposed_public_jobs_after: proposedPublicJobs.length,
    missing_jobs_to_backfill_count: missingJobsBackfilled.length,
    pending_public_overlap_before: pendingBefore.filter((job) => publishedById.has(cleanText(job.id))).length,
    pending_public_overlap_after_proposed: pendingOverlapAfter,
    pending_after_dedupe_count: pendingAfterDedupeCount,
    pending_public_overlap_jobs: pendingOverlapJobs,
    missing_jobs_to_backfill: missingJobsBackfilled,
    field_decisions_summary: Object.fromEntries(Object.entries(groupedDecisions).map(([key, values]) => [
      key,
      values.reduce((acc, item) => {
        acc[item.winner_reason] = (acc[item.winner_reason] || 0) + 1;
        return acc;
      }, {})
    ])),
    field_decisions: groupedDecisions,
    old_jobs_diff_review: oldJobsDiffReview,
    manual_review_list: dedupeList(manualReview),
    description_resolution_review: descriptionReviewDetails,
    severe_corruption_list: severeCorruptionDetails,
    company_mismatch_review: companyMismatchReview,
    location_resolution_review: locationResolutionReview,
    pay_mismatch_review: payMismatchReview,
    targeted_issue_status: targetedIssueStatus,
    overwrite_audit: overwriteAudit,
    write_allowed: writeAllowed,
    write_blocked_reasons: writeBlockers,
    notes: {
      preserve_jobs_json_public_truth: true,
      equivalent_salary_suffixes_treated_as_same: true,
      safe_location_keep_jobs_json: ["edp-f365739f6c21"],
      safe_pay_keep_jobs_json: ["solar-united-neighbors-5dd5c717f705"],
      safe_specialization_overrides: [
        "more-perfect-union-action-6a8fac86ca90 => Video"
      ]
    }
  };

  await writeReportFiles(report);

  console.log(JSON.stringify(report, null, 2));

  if (!shouldWrite) {
    return;
  }
  if (!writeAllowed) {
    throw new Error(writeBlockers.join("; "));
  }

  await writeJson(JOB_RECORDS_FILE, proposedRecords);
  const publicSync = await syncPublicJobsFromRecords(proposedRecords, {
    label: "jobs:reconcile-public-data",
    allowWorseOverwrite: false
  });
  const publicIndex = buildPublicDuplicateIndex(publicSync.publicJobs);
  const nextPending = pendingBefore.filter((job) => !isDuplicateOfPublicJob(job, publicIndex));
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  validationPreview = await buildValidationReport({ requirePages: false });
  console.log(JSON.stringify({
    wrote: true,
    jobs_json_after: publicSync.jobsCountAfter,
    pending_after: nextPending.length,
    validation_errors: validationPreview.errors
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:reconcile-public-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
