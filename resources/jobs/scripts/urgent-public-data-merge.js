#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const JOBS2_FILE = path.join(ROOT, "jobs2.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const PAGES_DIR = path.join(ROOT, "pages");
const REPORTS_DIR = path.join(ROOT, "reports");

function readJson(fp, def) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return def; }
}

function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function txt(v) { return String(v || "").trim(); }
function lc(v) { return txt(v).toLowerCase(); }

// ── Known invalid ID patterns to remove from public/pending ──
const INVALID_ORG_PATTERNS = [
  /saas\.group/i, /mission\s*44/i,
];
const INVALID_TITLE_PATTERNS = [
  /view all jobs/i, /powered by/i, /open positions/i, /apply now/i,
  /our website/i, /privacy\s*(policy|notice)/i, /legal\s*(notice|policy)/i,
  /terms?\s+of\s+(use|service)/i, /city\s+of\b/i, /country\s+of\b/i,
  /search\s+(result|page)/i, /report/i, /resource/i, /funding/i,
  /interagency working group/i, /^CAP.?s Report/i,
  /article\s+page/i, /^[A-Z]{2,}\s+-\s+/,
];
const DESCRIBED_AS_REMOTE = [
  "this position is listed in", "this position is listed as",
  "and a remote role", "and a on-site role",
];

const BOILERPLATE_PATTERNS = [
  /how we support our staff/i, /current openings/i,
  /competitive salaries and wages/i,
  /equal opportunity employer/i, /reasonable accommodation/i,
  /we appreciate your interest/i, /signup for job notifications/i,
  /employee benefits/i, /working at earthjustice/i,
  /get hired: the application process/i,
  /commitment to justice/i, /partnerships at earthjustice/i,
  /senior attorney careers/i, /associate attorney program/i,
  /law clerk program/i, /student opportunities/i,
  /for additional career opportunities/i,
  /at this time, new applications are no longer being accepted/i,
  /all applicants will hear from our team/i,
  /if you need reasonable accommodation/i,
  /the application period closed/i,
];

function isInvalidJob(job) {
  const org = lc(job.organization || "");
  const title = lc(job.title || "");
  for (const p of INVALID_ORG_PATTERNS) if (p.test(org)) return true;
  for (const p of INVALID_TITLE_PATTERNS) if (p.test(title)) return true;
  return false;
}

function isRemoteBoilerplate(text) {
  const t = lc(text);
  return DESCRIBED_AS_REMOTE.some(p => t.includes(p));
}

function isBoilerplateBlock(text) {
  const t = lc(text);
  return BOILERPLATE_PATTERNS.some(p => p.test(t));
}

function hasRipplingUuidBlob(text) {
  return /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(text);
}

function cleanRipplingDescription(raw) {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/\s+[a-f0-9-]{36}\s*/gi, " ");
  text = text.replace(/Policy Associate - DMEE.*?(?=\.|$)/gi, "Policy Associate - DMEE");
  text = text.replace(/\bRemote\s*\(United States\)\s*Remote\b/gi, "Remote (United States)");
  return txt(text);
}

function cleanBoilerplateDescriptions(job) {
  let raw = txt(job.raw_description || job.description || "");
  let desc = txt(job.description || "");

  if (isRemoteBoilerplate(desc)) {
    const cleaned = desc.split(/\.\s*/).filter(s => !isRemoteBoilerplate(s)).join(". ");
    desc = cleaned || "";
    raw = desc;
  }

  const sentences = desc.split(/\.\s+/).filter(s => !isBoilerplateBlock(s));
  desc = sentences.join(". ");

  if (hasRipplingUuidBlob(desc)) {
    raw = cleanRipplingDescription(raw);
    desc = cleanRipplingDescription(desc);
  }

  const eipMatch = desc.match(/(Position Description\s+EIP is seeking.*)/i);
  if (eipMatch) {
    desc = eipMatch[1];
    raw = desc;
  }

  desc = desc.replace(/Explore open positions.*?(?=\.|$)/gi, "").trim();
  desc = desc.replace(/Work with us.*?(?=\.|$)/gi, "").trim();

  const uniq = [];
  for (const s of desc.split(/(?<=\.)\s*/)) {
    const norm = lc(s);
    if (!uniq.some(u => lc(u) === norm)) uniq.push(s);
  }
  desc = uniq.join(" ").trim();

  if (desc.length < 40 && raw.length > 40) {
    desc = raw.replace(/^(ABOUT\s+EIP\s+.*?\.\s*)/i, "").trim();
  }

  return { raw_description: raw, description: desc };
}

function fixPay(job) {
  const org = lc(job.organization || "");
  const title = lc(job.title || "");

  const rawSalary = txt(job.raw_salary || "");
  if (/^\d+[–-]\d+$/.test(rawSalary) && rawSalary.length < 8) {
    job.salary = ""; job.raw_salary = ""; job.salary_min = null; job.salary_max = null;
    job.salary_currency = "Unknown"; job.salary_period = "Unknown"; job.salary_visible = false;
    job.pay_parse_warning = "corrupted_pay_rejected";
    return job;
  }
  if (/^\d+,?$/.test(rawSalary) && rawSalary.length < 5) {
    job.salary = ""; job.raw_salary = ""; job.salary_min = null; job.salary_max = null;
    job.salary_currency = "Unknown"; job.salary_period = "Unknown"; job.salary_visible = false;
    job.pay_parse_warning = "corrupted_pay_rejected";
    return job;
  }

  if (org.includes("goodpower") || org.includes("good power")) {
    const desc = txt(job.raw_description || job.description || "");
    const m = desc.match(/\$(\d{3},?\d{3})\s*[–-]\s*\$?(\d{3},?\d{3})/i);
    if (m) {
      job.salary_min = parseInt(m[1].replace(/,/g, ""));
      job.salary_max = parseInt(m[2].replace(/,/g, ""));
      job.salary_currency = "USD";
      job.salary_period = "year";
      job.salary_visible = true;
      job.salary = `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}`;
      job.raw_salary = job.salary;
    }
  }

  if (org.includes("greenlight")) {
    const desc = txt(job.raw_description || job.description || "");
    const m = desc.match(/\$(\d{3},?\d{3})\s*[–-]\s*\$?(\d{3},?\d{3})/i);
    if (m) {
      job.salary_min = parseInt(m[1].replace(/,/g, ""));
      job.salary_max = parseInt(m[2].replace(/,/g, ""));
      job.salary_currency = "USD"; job.salary_period = "year"; job.salary_visible = true;
      job.salary = `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}`;
      job.raw_salary = job.salary;
    }
  }

  if (org.includes("weavegrid") && title.includes("director") && title.includes("regulatory")) {
    const desc = txt(job.raw_description || job.description || "");
    const m = desc.match(/\$(\d{3},?\d{3})\s*[–-]\s*\$?(\d{3},?\d{3})/i);
    if (m) {
      job.salary_min = parseInt(m[1].replace(/,/g, ""));
      job.salary_max = parseInt(m[2].replace(/,/g, ""));
      job.salary_currency = "USD"; job.salary_period = "year"; job.salary_visible = true;
      job.salary = `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}`;
      job.raw_salary = job.salary;
    }
  }

  if (org.includes("louisiana bucket")) {
    const desc = txt(job.raw_description || job.description || "");
    const m = desc.match(/\$(\d{2,3},?\d{3})\s*(per\s+year|annually|annual|yearly)?/i);
    if (m) {
      const val = parseInt(m[1].replace(/,/g, ""));
      if (val >= 30000 && val <= 200000) {
        job.salary_min = val; job.salary_max = val;
        job.salary_currency = "USD"; job.salary_period = "year"; job.salary_visible = true;
        job.salary = `$${val.toLocaleString()} / year`;
        job.raw_salary = job.salary;
      }
    }
  }

  return job;
}

function fixWorkplace(job) {
  const org = lc(job.organization || "");
  const title = lc(job.title || "");
  const desc = lc(job.raw_description || job.description || "");
  const loc = lc(job.location || "");

  if (org.includes("earthjustice")) {
    if (!loc.includes("remote")) {
      job.workplace_type = "Hybrid";
    }
  }

  if (org.includes("dylan green")) {
    if (desc.includes("hybrid") || desc.includes("in-office") || desc.includes("in office")) {
      job.workplace_type = "Hybrid";
    }
  }

  if (org.includes("clean capital")) {
    if (desc.includes("in-office") || desc.includes("in office") || desc.includes("minimum 2") || desc.includes("days in office")) {
      job.workplace_type = "Hybrid";
    }
  }

  if (org.includes("louisiana bucket")) {
    if (title.includes("donor engagement")) {
      job.workplace_type = "Hybrid";
    }
  }

  if (job.workplace_type === "Remote" && !loc.includes("remote")) {
    const flexPhrases = ["flexible", "benefits", "remote-friendly", "remote option", "work from home option"];
    const hasFlex = flexPhrases.some(p => desc.includes(p)) && desc.includes("remote");
    const hasRealRemote = desc.includes("this is a fully remote") || desc.includes("this is a remote position") || desc.includes("remote role");
    if (hasFlex && !hasRealRemote && !loc.includes("remote")) {
      job.workplace_type = "";
    }
  }

  return job;
}

function buildPageUrl(job) {
  const slug = `${job.title}-${job.organization}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `./pages/${slug}.html`;
}

// ── Create a job-records record from a flat job object ──
function createRecordFromJob(job, ts = new Date().toISOString()) {
  return {
    id: job.id || "",
    record_type: "job",
    status: "published",
    public_visibility: true,
    featured: false,
    created_at: ts,
    updated_at: ts,
    source_type: "curated",
    admin_notes: "",
    display_order: 0,
    published: true,
    source_fingerprint: "",
    last_normalized_at: ts,
    last_source_sync_at: ts,
    last_manual_edit_at: ts,
    raw_source_data: {
      id: job.id,
      title: job.title,
      organization: job.organization,
      location: job.location,
      workplace_type: job.workplace_type,
      salary: job.salary,
      raw_salary: job.raw_salary,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      salary_period: job.salary_period,
      salary_visible: job.salary_visible,
      description: job.description,
      raw_description: job.raw_description || job.description,
      apply_url: job.apply_url,
      source: job.source,
      job_type: job.job_type,
      source_url: job.source_url,
      original_url: job.original_url || job.source_url,
      date_posted: job.date_posted,
      tags: job.tags || [],
      sector: job.sector || "",
      function: job.function || "",
      specialization: job.specialization || "",
      parser_confidence: "high",
      parser_confidence_score: 1,
      content_quality_score: 1,
      stale_score: 0,
      last_checked_at: ts,
      last_seen_at: ts,
      source_status: "live",
      source_confidence: "high",
      source_classification: "curated"
    },
    display: {
      title: job.title,
      organization: job.organization,
      location: job.location,
      location_type: job.workplace_type || "",
      pay_display: job.salary || "",
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      salary_period: job.salary_period,
      salary_visible: job.salary_visible,
      role_type: job.job_type || "",
      description: job.description || "",
      application_url: job.apply_url || "",
      source_name: job.source || "",
      source_url: job.source_url || "",
      original_url: job.original_url || job.source_url || "",
      date_collected: job.date_posted || "",
      tags: job.tags || [],
      sector: job.sector || "",
      function: job.function || "",
      specialization: job.specialization || "",
      specialization_confidence: "high"
    },
    field_meta: {},
    field_conflicts: [],
    manual_overrides: [],
    first_published_at: ts,
    last_verified_at: ts,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    stale_reason: "",
    verification_status: "verified",
    verification_method: "manual",
    last_checked_at: ts,
    source_status: "live",
    failed_sync_count: 0,
    last_seen_at: ts,
    stale_score: 0,
    source_confidence: "high",
    source_classification: "curated",
    published_grace_until: "",
    missing_from_source_confirmations: 0,
    required_missing_confirmations: 2,
    resurfacing_priority_score: null
  };
}

// ── Update display fields on an existing record ──
function updateRecordDisplay(record, job) {
  if (!record.display) record.display = {};
  const d = record.display;
  if (job.title) d.title = job.title;
  if (job.organization) d.organization = job.organization;
  if (job.location) d.location = job.location;
  if (job.workplace_type !== undefined) d.location_type = job.workplace_type || "";
  if (job.salary) d.pay_display = job.salary;
  if (job.salary_min !== undefined) d.salary_min = job.salary_min;
  if (job.salary_max !== undefined) d.salary_max = job.salary_max;
  if (job.salary_currency) d.salary_currency = job.salary_currency;
  if (job.salary_period) d.salary_period = job.salary_period;
  if (job.salary_visible !== undefined) d.salary_visible = job.salary_visible;
  if (job.job_type) d.role_type = job.job_type;
  if (job.description) d.description = job.description;
  if (job.apply_url) d.application_url = job.apply_url;
  if (job.description_snippet) {
    record.description_snippet = job.description_snippet;
    record.summary = job.summary || job.description_snippet;
  }
  if (job.source) d.source_name = job.source;
  if (job.page_url) record.page_url = job.page_url;
  return record;
}

async function main() {
  const logger = console;
  logger.log("=== URGENT PUBLIC DATA MERGE ===");

  const publicJobs = readJson(JOBS_FILE, []);
  const jobs2 = readJson(JOBS2_FILE, []);
  let records = readJson(RECORDS_FILE, []);
  const pending = readJson(PENDING_FILE, []);

  const report = {
    generated_at: new Date().toISOString(),
    jobs2_entries: jobs2.length,
    existing_public_jobs: publicJobs.length,
    existing_records: records.length,
    jobs_added_from_jobs2: [],
    jobs_skipped_duplicate: [],
    descriptions_cleaned: [],
    pay_fixes: [],
    workplace_fixes: [],
    revov_publish: null,
    pending_records_removed: [],
    invalid_items_removed_from_public: [],
    invalid_items_removed_from_pending: [],
    records_added: [],
    records_removed: [],
    page_count_before: 0,
    page_count_after: 0,
  };

  const now = new Date().toISOString();
  const recordIds = new Set(records.map(r => r.id));
  const recordIdsWithDisplay = new Set(records.filter(r => r.title || (r.display && r.display.title)).map(r => r.id));

  // ── 1. Merge jobs2 into publicJobs AND create records ──
  const existingIds = new Set(publicJobs.map(j => j.id));
  const existingTitleOrg = new Set(publicJobs.map(j => `${lc(j.title)}||${lc(j.organization)}`));
  const existingApplyUrls = new Set(publicJobs.map(j => lc(j.apply_url || "")));

  for (let j2 of jobs2) {
    const id = j2.id;
    const key = `${lc(j2.title)}||${lc(j2.organization)}`;
    const aurl = lc(j2.apply_url || "");

    if (existingIds.has(id) || existingTitleOrg.has(key) || (aurl && existingApplyUrls.has(aurl))) {
      report.jobs_skipped_duplicate.push({ id, title: j2.title, org: j2.organization, reason: "already_in_public" });
      continue;
    }

    const cleaned = cleanBoilerplateDescriptions(j2);
    j2.raw_description = cleaned.raw_description;
    j2.description = cleaned.description;
    j2 = fixPay(j2);
    j2 = fixWorkplace(j2);

    j2.page_url = buildPageUrl(j2);
    j2.status = "published";
    j2.published = true;
    j2.public_visibility = true;

    // Build snippet
    if (j2.description && j2.description.length > 10) {
      const snippet = j2.description.split(/\./).filter(Boolean)[0] || j2.description;
      j2.description_snippet = snippet.length > 200 ? snippet.slice(0, 197) + "..." : snippet;
      j2.summary = j2.description_snippet;
    }

    publicJobs.push(j2);
    existingIds.add(id);
    existingTitleOrg.add(key);

    // Add to job-records if not exists
    if (!recordIds.has(id)) {
      const rec = createRecordFromJob(j2, now);
      records.push(rec);
      recordIds.add(id);
      report.records_added.push({ id, title: j2.title, org: j2.organization });
    }

    report.jobs_added_from_jobs2.push({ id, title: j2.title, org: j2.organization });
  }

  // ── 2. Clean descriptions, fix pay, fix workplace on ALL public jobs AND records ──
  for (let i = 0; i < publicJobs.length; i++) {
    let j = publicJobs[i];
    const beforeDesc = j.description;

    const payBefore = JSON.stringify({ min: j.salary_min, max: j.salary_max, vis: j.salary_visible });
    j = fixPay(j);
    const payAfter = JSON.stringify({ min: j.salary_min, max: j.salary_max, vis: j.salary_visible });
    if (payBefore !== payAfter) {
      report.pay_fixes.push({ id: j.id, title: j.title, change: `${payBefore} → ${payAfter}` });
    }

    const wpBefore = j.workplace_type;
    j = fixWorkplace(j);
    if (wpBefore !== j.workplace_type) {
      report.workplace_fixes.push({ id: j.id, title: j.title, change: `${wpBefore} → ${j.workplace_type}` });
    }

    const cleaned = cleanBoilerplateDescriptions(j);
    if (cleaned.description !== beforeDesc) {
      report.descriptions_cleaned.push({ id: j.id, title: j.title });
    }
    j.raw_description = cleaned.raw_description;
    j.description = cleaned.description;

    if (j.description && j.description.length > 10) {
      const snippet = j.description.split(/\./).filter(Boolean)[0] || j.description;
      j.description_snippet = snippet.length > 200 ? snippet.slice(0, 197) + "..." : snippet;
      j.summary = j.description_snippet;
    }

    publicJobs[i] = j;

    // Also update the corresponding record's display fields
    const recIdx = records.findIndex(r => r.id === j.id);
    if (recIdx >= 0) {
      records[recIdx] = updateRecordDisplay(records[recIdx], j);
    }
  }

  // ── 3. Remove known invalid items from public AND records ──
  const cleanedPublic = publicJobs.filter(j => {
    if (isInvalidJob(j)) {
      report.invalid_items_removed_from_public.push({ id: j.id, title: j.title, org: j.organization });
      return false;
    }
    return true;
  });
  while (cleanedPublic.length < publicJobs.length) publicJobs.pop();
  for (let i = 0; i < cleanedPublic.length; i++) publicJobs[i] = cleanedPublic[i];
  if (cleanedPublic.length < publicJobs.length) publicJobs.length = cleanedPublic.length;

  // Remove invalid items from records too
  const cleanedRecords = records.filter(r => {
    const job = r.display || r.raw_source_data || {};
    const title = job.title || "";
    const org = job.organization || "";
    if (isInvalidJob({ title, organization: org })) {
      report.records_removed.push({ id: r.id, title, org });
      return false;
    }
    return true;
  });
  records = cleanedRecords;

  // ── 4. Publish RE-volv ──
  function makeRevovJob() {
    return {
      id: "re-volv-lending-and-finance-analyst",
      source_id: "re-volv",
      source: "RE-volv Careers",
      organization: "RE-volv",
      title: "Lending and Finance Analyst",
      location: "Remote, USA",
      workplace_type: "Remote",
      job_type: "Full-time",
      apply_url: "https://re-volv.org/about-us/jobs/",
      source_url: "https://re-volv.org/about-us/jobs/",
      description: "RE-volv is hiring an experienced lending and finance analyst to support our end to end clean energy lending operations from origination through servicing.",
      raw_description: "RE-volv is hiring an experienced lending and finance analyst to support our end to end clean energy lending operations from origination through servicing.",
      description_snippet: "RE-volv is hiring an experienced lending and finance analyst",
      summary: "RE-volv is hiring an experienced lending and finance analyst",
      status: "published",
      published: true,
      public_visibility: true,
      salary_visible: false,
      salary: "",
      raw_salary: "",
      salary_min: null,
      salary_max: null,
      salary_currency: "Unknown",
      salary_period: "Unknown",
      auto_publish: false,
      sector: "Clean Energy",
      parser_confidence: "high"
    };
  }

  let revov = makeRevovJob();
  const revovExists = publicJobs.some(j => j.id === revov.id);
  if (!revovExists) {
    revov.page_url = buildPageUrl(revov);
    publicJobs.push(revov);
    if (!recordIds.has(revov.id)) {
      const rec = createRecordFromJob(revov, now);
      records.push(rec);
      report.records_added.push({ id: revov.id, title: revov.title, org: revov.organization });
    }
    report.revov_publish = { id: revov.id, title: revov.title, status: "published_without_pay" };
  } else {
    report.revov_publish = { id: revov.id, title: revov.title, status: "already_in_public" };
  }

  // ── 5. Remove duplicates from pending ──
  const publicIds = new Set(publicJobs.map(j => j.id));
  const publicTitleOrg = new Set(publicJobs.map(j => `${lc(j.title)}||${lc(j.organization)}`));
  const cleanedPending = [];
  let pendingRemoved = 0;

  for (const j of pending) {
    const key = `${lc(j.title)}||${lc(j.organization)}`;
    const isDup = publicIds.has(j.id) || publicTitleOrg.has(key);
    if (isDup) {
      report.pending_records_removed.push({ id: j.id, title: j.title, org: j.organization });
      pendingRemoved++;
    } else {
      cleanedPending.push(j);
    }
  }

  // ── 6. Remove invalid items from pending ──
  const specificInvalid = [
    { org: /mission\s*44/i, title: /unavailable/i },
    { org: /saas\.group/i },
    { org: /bluegreen alliance/i, title: /(state|report)/i },
    { org: /emerald cities/i, title: /(report|resource)/i },
    { org: /edf/i, title: /article/i },
    { org: /cjeu|CJA/i, title: /jazzhr/i },
    { org: /rwe/i, title: /(city|country|search)/i },
    { org: /nextera/i, title: /(privacy|legal)/i },
    { org: /next era/i, title: /(privacy|legal)/i },
    { org: /conservation pa/i, title: /(stale|campaign)/i },
    { org: /lcv/i, title: /(stale|former)/i },
  ];

  for (let i = cleanedPending.length - 1; i >= 0; i--) {
    const j = cleanedPending[i];
    const org = lc(j.organization || "");
    const title = lc(j.title || "");
    for (const rule of specificInvalid) {
      const orgMatch = !rule.org || rule.org.test(org);
      const titleMatch = !rule.title || rule.title.test(title);
      if (orgMatch && titleMatch) {
        j.triage_bucket = "rejected_noise";
        j.triage_reason = "invalid_non_job_specific";
        report.invalid_items_removed_from_pending.push({ id: j.id, title: j.title, org: j.organization });
        cleanedPending.splice(i, 1);
        break;
      }
    }
  }

  // ── 7. Clean Advanced Energy United ──
  for (const jobList of [publicJobs, cleanedPending]) {
    for (let i = 0; i < jobList.length; i++) {
      const j = jobList[i];
      if (lc(j.organization || "").includes("advanced energy united")) {
        let title = j.title || "";
        title = title.replace(/\s+[a-f0-9-]{36}\s*/gi, " ").trim();
        if (/^Policy Associate/i.test(title) && /DMEE/i.test(title)) {
          title = "Policy Associate - DMEE";
        }
        j.title = title;

        const cleaned = cleanBoilerplateDescriptions(j);
        j.raw_description = cleaned.raw_description;
        j.description = cleaned.description;

        let loc = txt(j.location || "");
        loc = loc.replace(/\s+Remote\s+(United States\s+)?Remote/gi, " Remote (United States)").trim();
        loc = loc.replace(/\s+Remote\s+Remote/gi, " Remote").trim();
        j.location = loc;

        if (j.description && j.description.length > 10) {
          const snippet = j.description.split(/\./).filter(Boolean)[0] || j.description;
          j.description_snippet = snippet.length > 200 ? snippet.slice(0, 197) + "..." : snippet;
          j.summary = j.description_snippet;
        }

        if (!j.workplace_type && loc.includes("remote")) {
          j.workplace_type = "Remote";
        }

        report.descriptions_cleaned.push({ id: j.id, title: j.title, note: "Advanced Energy United cleanup" });

        // Also update the record display
        const recIdx = records.findIndex(r => r.id === j.id);
        if (recIdx >= 0) {
          records[recIdx] = updateRecordDisplay(records[recIdx], j);
        }
      }
    }
  }

  // ── 8. Save all files ──
  writeJson(JOBS_FILE, publicJobs);
  writeJson(RECORDS_FILE, records);
  writeJson(PENDING_FILE, cleanedPending);

  // ── 9. Delete stale Mission 44 page ──
  report.page_count_before = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith(".html")).length;
  const stalePages = fs.readdirSync(PAGES_DIR).filter(f =>
    f.endsWith(".html") && (f.includes("mission-44") || f.includes("mission44"))
  );
  for (const sp of stalePages) {
    fs.unlinkSync(path.join(PAGES_DIR, sp));
    logger.log(`Deleted stale page: ${sp}`);
  }

  report.page_count_after = publicJobs.length;

  // ── 10. Generate reports ──
  const mergeReport = {
    generated_at: report.generated_at,
    jobs2_entries: report.jobs2_entries,
    existing_public_before: report.existing_public_jobs,
    public_jobs_after: publicJobs.length,
    records_count: records.length,
    records_added: report.records_added.length,
    jobs_added: report.jobs_added_from_jobs2.length,
    jobs_added_details: report.jobs_added_from_jobs2,
    jobs_skipped_details: report.jobs_skipped_duplicate,
    descriptions_cleaned: report.descriptions_cleaned.length,
    descriptions_cleaned_details: report.descriptions_cleaned.slice(0, 30),
    pay_fixes: report.pay_fixes.length,
    pay_fixes_details: report.pay_fixes,
    workplace_fixes: report.workplace_fixes.length,
    workplace_fixes_details: report.workplace_fixes,
    revov_publish: report.revov_publish,
    invalid_public_removed: report.invalid_items_removed_from_public,
    invalid_records_removed: report.records_removed,
    pending_cleaned: report.pending_records_removed.length,
    pending_removed_invalid: report.invalid_items_removed_from_pending.length,
    pages_before: report.page_count_before,
    pages_after: report.page_count_after,
  };
  writeJson(path.join(REPORTS_DIR, "jobs2-urgent-public-merge-report.json"), mergeReport);
  writeJson(path.join(REPORTS_DIR, "urgent-public-data-cleanup-report.json"), report);

  const pendingCleanup = {
    generated_at: report.generated_at,
    pending_before: pending.length,
    pending_after: cleanedPending.length,
    removed_as_duplicate: report.pending_records_removed.length,
    duplicate_details: report.pending_records_removed,
    removed_as_invalid: report.invalid_items_removed_from_pending.length,
    invalid_details: report.invalid_items_removed_from_pending,
  };
  writeJson(path.join(REPORTS_DIR, "pending-duplicate-cleanup-report.json"), pendingCleanup);

  logger.log("=== REPORTS ===");
  logger.log(`Jobs added from jobs2.json: ${report.jobs_added_from_jobs2.length}`);
  logger.log(`Jobs skipped as duplicate: ${report.jobs_skipped_duplicate.length}`);
  logger.log(`Records added: ${report.records_added.length}`);
  logger.log(`Records removed (invalid): ${report.records_removed.length}`);
  logger.log(`Descriptions cleaned: ${report.descriptions_cleaned.length}`);
  logger.log(`Pay fixes: ${report.pay_fixes.length}`);
  logger.log(`Workplace fixes: ${report.workplace_fixes.length}`);
  logger.log(`RE-volv publish: ${JSON.stringify(report.revov_publish)}`);
  logger.log(`Pending duplicates removed: ${report.pending_records_removed.length}`);
  logger.log(`Invalid items removed from pending: ${report.invalid_items_removed_from_pending.length}`);
  logger.log(`Public jobs total: ${publicJobs.length}`);
  logger.log(`Records total: ${records.length}`);
  logger.log(`Pending jobs total: ${cleanedPending.length}`);
  logger.log("=== REPORTS WRITTEN ===");
  logger.log("Next step: run 'npm run jobs:build-pages' to regenerate pages.");
}

main().catch(err => {
  console.error("URGENT MERGE FAILED:", err.message);
  process.exit(1);
});
