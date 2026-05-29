#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const REPORTS_DIR = path.join(ROOT, "reports");

function readJson(fp) { return JSON.parse(fs.readFileSync(fp, "utf8")); }
function writeJson(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2) + "\n"); }

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "Accept": "text/html" },
      timeout: 15000
    }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
    }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")); });
  });
}
function stripHtml(h) {
  return String(h||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<nav[\s\S]*?<\/nav>/gi," ").replace(/<footer[\s\S]*?<\/footer>/gi," ").replace(/<header[\s\S]*?<\/header>/gi," ").replace(/<[^>]+>/g," ").replace(/&rsquo;/g,"'").replace(/&[a-z]+;/g," ").replace(/\s+/g," ").trim();
}
function bodyText(html) { const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i); return m ? stripHtml(m[1]) : ""; }

// ========== 1. EDF reject non-job URLs ==========
function rejectEDFNonJobs(jobs, report) {
  report.edf = { total: 0, rejected: 0, kept: 0, details: [] };
  for (const job of jobs) {
    const org = String(job.organization||"").toLowerCase();
    const sid = String(job.source_id||"").toLowerCase();
    if (!org.includes("environmental defense") && sid !== "edf") continue;
    report.edf.total++;
    const url = String(job.apply_url||job.original_url||job.source_url||"");
    // Reject article/blog URLs or very long slugs that are clearly not job detail pages
    const isBad = !url.includes("/jobs/") && (
      url.includes("/pivoting-") || url.includes("/blog/") || url.includes("/article/") ||
      url.includes("/news/") || url.includes("/press-release/") ||
      url.match(/\/[a-z-]{30,}\/?$/)  // very long slug = article
    );
    if (isBad) {
      job.triage_bucket = "rejected_noise"; job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "edf_non_job_url"; job.rejected_noise = true;
      report.edf.rejected++;
      report.edf.details.push({ id: job.id, title: job.title, reason: "non_job_url" });
    } else {
      report.edf.kept++;
    }
  }
}

// ========== 2. Earthjustice pay from description ==========
function fixEarthjusticePay(jobs, report) {
  report.earthjustice = { total: 0, payFound: 0, payFixed: 0, details: [] };
  for (const job of jobs) {
    const sid = String(job.source_id||"").toLowerCase();
    const org = String(job.organization||"").toLowerCase();
    if (sid !== "earthjustice" && !org.includes("earthjustice")) continue;
    report.earthjustice.total++;
    const desc = String(job.description||job.raw_description||"");
    const salaryLine = desc.match(/[Ss]alary[^.]{0,300}\$[\d,]+/i);
    const compLine = desc.match(/[Cc]ompensation[^.]{0,300}\$[\d,]+/i);
    const rangeMatch = desc.match(/\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/);
    if (!salaryLine && !rangeMatch) {
      report.earthjustice.details.push({ id: job.id, title: job.title, payFound: false });
      continue;
    }
    report.earthjustice.payFound++;
    // Try multi-location: collect all ranges, pick lowest min/highest max
    const allRanges = [];
    const rangeRe = /\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/gi;
    let m;
    while ((m = rangeRe.exec(desc)) !== null) {
      const mn = Number(m[1].replace(/[,\s]/g,"")); const mx = Number(m[2].replace(/[,\s]/g,""));
      if (Number.isFinite(mn) && Number.isFinite(mx) && mx >= mn) allRanges.push({min: mn, max: mx});
    }
    if (allRanges.length >= 1) {
      const overallMin = Math.min(...allRanges.map(r => r.min));
      const overallMax = Math.max(...allRanges.map(r => r.max));
      if (Number.isFinite(overallMin) && overallMin > 0) {
        job.salary_min = overallMin; job.salary_max = overallMax;
        job.salary_currency = "USD"; job.salary_period = "yearly";
        job.salary_visible = true;
        job.salary = `\$${overallMin.toLocaleString()}–\$${overallMax.toLocaleString()} / year`;
        job.raw_salary = `\$${overallMin.toLocaleString()}–\$${overallMax.toLocaleString()}`;
        job.pay_parse_source = "enriched_multi_location";
        if (!job.triage_bucket || job.triage_bucket === "needs_cleanup") {
          job.triage_bucket = "review_ready";
        }
        report.earthjustice.payFixed++;
        report.earthjustice.details.push({ id: job.id, title: job.title, min: overallMin, max: overallMax, ranges: allRanges.length });
      }
    }
  }
}

// ========== 3. GoodPower pay fetch + parse ==========
async function fixGoodPowerPay(jobs, report) {
  report.goodpower = { total: 0, fetched: 0, payFixed: 0, details: [] };
  for (const job of jobs) {
    const sid = String(job.source_id||"").toLowerCase();
    const org = String(job.organization||"").toLowerCase();
    if (sid !== "good-power" && !org.includes("goodpower")) continue;
    report.goodpower.total++;
    const url = String(job.apply_url||job.source_url||"");
    if (!url) { report.goodpower.details.push({ id: job.id, title: job.title, error: "no_url" }); continue; }
    try {
      const html = await fetchHtml(url);
      const text = bodyText(html);
      if (text.length > (job.description||"").length) {
        job.raw_description = text; job.description = text;
        report.goodpower.fetched++;
      }
      // Parse "Annual salary range: $78,000-$83,000" or "Compensation ... $78,000-$83,000"
      const compMatch = text.match(/[Cc]ompensation[^.]{0,300}\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/i);
      const salaryRangeMatch = text.match(/[Aa]nnual\s+salary\s+range:?\s*\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/i);
      const anyRange = text.match(/\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/);
      const paySource = salaryRangeMatch || compMatch || anyRange;
      if (paySource) {
        const mn = Number(paySource[1].replace(/[,\s]/g,"")); const mx = Number(paySource[2].replace(/[,\s]/g,""));
        if (Number.isFinite(mn) && Number.isFinite(mx) && mn > 0) {
          job.salary_min = mn; job.salary_max = mx;
          job.salary_currency = "USD"; job.salary_period = "yearly";
          job.salary_visible = true;
          job.salary = `\$${mn.toLocaleString()}–\$${mx.toLocaleString()} / year`;
          job.raw_salary = `\$${mn.toLocaleString()}–\$${mx.toLocaleString()}`;
          job.pay_parse_source = "enriched_description";
          if (job.triage_bucket === "needs_cleanup") job.triage_bucket = "review_ready";
          report.goodpower.payFixed++;
          report.goodpower.details.push({ id: job.id, title: job.title, min: mn, max: mx, source: paySource[0].slice(0,80) });
        }
      } else {
        report.goodpower.details.push({ id: job.id, title: job.title, payFound: false });
      }
    } catch (e) { report.goodpower.details.push({ id: job.id, title: job.title, error: e.message }); }
  }
}

// ========== 4. LCV / Conservation PA cleanup ==========
function fixLCVConservationPA(jobs, report) {
  report.lcv = { total: 0, kept: 0, rejected: 0, added: 0, details: [] };
  // Only target Conservation Voters / LCV state affiliates, NOT Conservation International
  for (const job of jobs) {
    const org = String(job.organization||"").toLowerCase();
    const sid = String(job.source_id||"").toLowerCase();
    if (sid === "conservation-international") continue;
    if (!org.includes("conservation") && !org.includes("lcv") && !org.includes("penn future")) continue;
    report.lcv.total++;
    const url = String(job.apply_url||job.source_url||job.original_url||"").toLowerCase();
    // Only keep if it links to the current live job page
    const isDirectorCivic = url.includes("director-civic-engagement");
    const isStaleJob = url.includes("civic-engagement-coordinator") || url.includes("federal-campaign-coordinator");
    if (isDirectorCivic) {
      // Keep this as the current live job
      report.lcv.kept++;
      report.lcv.details.push({ id: job.id, title: job.title, reason: "kept_live_current" });
    } else if (isStaleJob) {
      // These jobs are no longer listed on conservationpa.org/jobs/ — reject
      job.triage_bucket = "rejected_noise"; job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "lcv_stale_non_job"; job.rejected_noise = true;
      report.lcv.rejected++;
      report.lcv.details.push({ id: job.id, title: job.title, reason: "job_no_longer_on_site", url: url.slice(0,80) });
    } else {
      // Other LCV/Conservation URLs that are not job pages
      job.triage_bucket = "rejected_noise"; job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "lcv_stale_non_job"; job.rejected_noise = true;
      report.lcv.rejected++;
      report.lcv.details.push({ id: job.id, title: job.title, reason: "not_current_live_job", url: url.slice(0,80) });
    }
  }
  // Add Director of Civic Engagement if not already present
  const hasDirector = jobs.some(j =>
    String(j.title||"").toLowerCase().includes("director") &&
    String(j.title||"").toLowerCase().includes("civic engagement")
  );
  if (!hasDirector) {
    jobs.push({
      id: "conservation-voters-pa-director-civic-engagement",
      source_id: "league-of-conservation-voters",
      source: "conservationpa-org-job-board",
      organization: "Conservation Voters of Pennsylvania",
      title: "Director of Civic Engagement",
      apply_url: "https://www.conservationpa.org/jobs/director-civic-engagement",
      source_url: "https://www.conservationpa.org/jobs/",
      description: "CVPA's Director of Civic Engagement will manage and lead the team of joint Civic Engagement Coordinators and Mobilizers in each region so that collectively, we can accomplish environmental, legislative, and political wins across Pennsylvania.",
      date_synced: new Date().toISOString().split("T")[0],
      triage_bucket: "review_ready",
      triage_reason: "manual_review_source",
      parser_confidence: "high",
      internal_notes: "Single live job on conservationpa.org/jobs/ as of May 2026"
    });
    report.lcv.added = 1;
    report.lcv.details.push({ reason: "added_director_civic_engagement", url: "https://www.conservationpa.org/jobs/director-civic-engagement" });
  }
}

// ========== 5. Source public cap ==========
function applySourcePublicCap(report) {
  const jobs = readJson(JOBS_FILE);
  const records = readJson(RECORDS_FILE);
  const SOURCE_CAP = 5;
  const capSources = ["more-perfect-union-action", "renew-home", "octopus-energy", "woolpert", "rwe", "nextera-energy", "quince", "goodleap"];
  report.sourceCap = { before: {}, after: {}, capped: [], movedBack: [] };
  for (const sourceId of capSources) {
    const sourceJobs = jobs.filter(j => j.source_id === sourceId);
    if (sourceJobs.length <= SOURCE_CAP) continue;
    report.sourceCap.before[sourceId] = sourceJobs.length;
    // Rank: paid first, then by editorial_priority_score, mission_alignment, comms/policy focus, newness, parsing
    const ranked = sourceJobs.sort((a, b) => {
      const aPay = (a.salary_min||a.salary_max||a.salary) ? 1 : 0;
      const bPay = (b.salary_min||b.salary_max||b.salary) ? 1 : 0;
      if (bPay !== aPay) return bPay - aPay;
      const eps = (b.editorial_priority_score||0) - (a.editorial_priority_score||0);
      if (eps !== 0) return eps;
      const mas = (b.mission_alignment_score||0) - (a.mission_alignment_score||0);
      if (mas !== 0) return mas;
      const aComms = /\b(comms|policy|advocacy|campaign|partner|legal|research|climate|ej)\b/i.test(a.title||"") ? 1 : 0;
      const bComms = /\b(comms|policy|advocacy|campaign|partner|legal|research|climate|ej)\b/i.test(b.title||"") ? 1 : 0;
      if (bComms !== aComms) return bComms - aComms;
      return String(b.date_posted||"").localeCompare(String(a.date_posted||""));
    });
    const keep = ranked.slice(0, SOURCE_CAP);
    const move = ranked.slice(SOURCE_CAP);
    report.sourceCap.capped.push({ sourceId, kept: keep.length, moved: move.length });
    for (const job of move) {
      // Remove from jobs.json
      const idx = jobs.indexOf(job);
      if (idx >= 0) jobs.splice(idx, 1);
      // Update record to pending
      const rec = records.find(r => String(r.id) === job.id && r.record_type === "job");
      if (rec) {
        rec.status = "pending"; rec.published = false; rec.public_visibility = false;
      }
      report.sourceCap.movedBack.push({ id: job.id, title: job.title, source: sourceId, eps: job.editorial_priority_score });
    }
  }
  writeJson(JOBS_FILE, jobs);
  writeJson(RECORDS_FILE, records);
}

function generateReports(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeJson(path.join(REPORTS_DIR, "source-specific-fixes-report.json"), report);
  writeJson(path.join(REPORTS_DIR, "source-public-cap-report.json"), report.sourceCap || {});
  writeJson(path.join(REPORTS_DIR, "lcv-conservationpa-cleanup-report.json"), report.lcv || {});
  writeJson(path.join(REPORTS_DIR, "pay-extraction-hardening-report.json"), {
    generated_at: new Date().toISOString(),
    earthjustice: report.earthjustice || {},
    goodpower: report.goodpower || {},
    edf: report.edf || {}
  });

  // MD summary
  let md = "# Source-Specific Fixes Report\n\n**Generated:** " + report.generated_at + "\n\n";
  md += "## 1. EDF Non-Job Rejection\n- Total: " + (report.edf?.total||0) + " | Rejected: " + (report.edf?.rejected||0) + " | Kept: " + (report.edf?.kept||0) + "\n\n";
  md += "## 2. Earthjustice Pay Fix\n- Total: " + (report.earthjustice?.total||0) + " | Pay found: " + (report.earthjustice?.payFound||0) + " | Pay fixed: " + (report.earthjustice?.payFixed||0) + "\n\n";
  md += "## 3. GoodPower Pay Fix\n- Total: " + (report.goodpower?.total||0) + " | Fetched: " + (report.goodpower?.fetched||0) + " | Pay fixed: " + (report.goodpower?.payFixed||0) + "\n\n";
  md += "## 4. LCV / Conservation PA\n- Total: " + (report.lcv?.total||0) + " | Kept: " + (report.lcv?.kept||0) + " | Rejected: " + (report.lcv?.rejected||0) + " | Added: " + (report.lcv?.added||0) + "\n\n";
  md += "## 5. Louisiana Bucket Brigade\n- Total: " + (report.louisianaBucketBrigade?.total||0) + " | Kept: " + (report.louisianaBucketBrigade?.kept||0) + " | Rejected: " + (report.louisianaBucketBrigade?.rejected||0) + "\n\n";
  md += "## 6. Source Public Cap\n";
  for (const c of (report.sourceCap?.capped||[])) {
    md += "- " + c.sourceId + ": kept=" + c.kept + " moved=" + c.moved + "\n";
  }
  writeJson(path.join(REPORTS_DIR, "source-specific-fixes-report.md"), { content: md });
}

async function main() {
  const report = { generated_at: new Date().toISOString() };
  console.log("=== Source-Specific Fixes ===");

  // Load data
  const jobs = readJson(PENDING_FILE);

  // 1. EDF
  console.log("\n--- EDF ---");
  rejectEDFNonJobs(jobs, report);
  console.log("  Rejected:", report.edf.rejected, "Kept:", report.edf.kept);

  // 2. Earthjustice pay
  console.log("\n--- Earthjustice ---");
  fixEarthjusticePay(jobs, report);
  console.log("  Pay found:", report.earthjustice.payFound, "Fixed:", report.earthjustice.payFixed);

  // 3. GoodPower pay
  console.log("\n--- GoodPower ---");
  await fixGoodPowerPay(jobs, report);
  console.log("  Fetched:", report.goodpower.fetched, "Pay fixed:", report.goodpower.payFixed);

  // 4. LCV / Conservation PA
  console.log("\n--- LCV ---");
  fixLCVConservationPA(jobs, report);
  console.log("  Kept:", report.lcv.kept, "Rejected:", report.lcv.rejected);

  // 6. Louisiana Bucket Brigade
  console.log("\n--- Louisiana Bucket Brigade ---");
  fixLouisianaBucketBrigade(jobs, report);
  console.log("  Kept:", report.louisianaBucketBrigade.kept, "Rejected:", report.louisianaBucketBrigade.rejected);

  // Write pending
  writeJson(PENDING_FILE, jobs);
  console.log("\nWrote pending-synced-jobs.json");

  // 5. Source public cap
  console.log("\n--- Source Public Cap ---");
  applySourcePublicCap(report);
  for (const c of report.sourceCap.capped) {
    console.log("  " + c.sourceId + ": kept=" + c.kept + " moved=" + c.moved);
  }

  // Generate reports
  generateReports(report);
  console.log("\nReports generated");
}

// ========== 6. Louisiana Bucket Brigade specific fixes ==========
// ApplyToJob: extract individual current jobs only, not stale roles
// Salary: parse "$65,000 annually" format
// Hybrid: classify "one day per week can be remote" as hybrid
function fixLouisianaBucketBrigade(jobs, report) {
  report.louisianaBucketBrigade = { total: 0, kept: 0, rejected: 0, details: [] };
  for (const job of jobs) {
    const org = String(job.organization||"").toLowerCase();
    const sid = String(job.source_id||"").toLowerCase();
    if (!org.includes("louisiana bucket") && sid !== "louisiana-bucket-brigade") continue;
    report.louisianaBucketBrigade.total++;
    const url = String(job.apply_url||job.source_url||job.original_url||"").toLowerCase();
    const title = String(job.title||"");
    // Keep only ApplyToJob individual job URLs, reject stale/aggregate ones
    if (url.includes("applytojob.com") && url.match(/\/jobs\/\d+/)) {
      report.louisianaBucketBrigade.kept++;
      report.louisianaBucketBrigade.details.push({ id: job.id, title: job.title, reason: "valid_applytojob_role" });
    } else {
      job.triage_bucket = "rejected_noise"; job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "labucketbrigade_stale_aggregate"; job.rejected_noise = true;
      report.louisianaBucketBrigade.rejected++;
      report.louisianaBucketBrigade.details.push({ id: job.id, title: job.title, reason: "not_individual_applytojob_url", url: url.slice(0,80) });
    }
    // Parse "$65,000 annually" salary format
    const desc = String(job.description||job.raw_description||"");
    const salaryMatch = desc.match(/\$(\d[\d,]*)\s+(?:annually|per year|year|annual)/i);
    if (salaryMatch) {
      const val = Number(salaryMatch[1].replace(/[,\s]/g,""));
      if (Number.isFinite(val) && val > 0) {
        job.salary_min = val; job.salary_max = val;
        job.salary_currency = "USD"; job.salary_period = "yearly";
        job.salary_visible = true;
        job.salary = `\$${val.toLocaleString()} / year`;
        job.raw_salary = `\$${val.toLocaleString()}`;
        job.pay_parse_source = "source_fix";
      }
    }
    // Classify "one day per week can be remote" as hybrid
    if (desc.match(/one day per week can be remote/i)) {
      job.remote_status = "hybrid";
    }
  }
}

// ========== 6. Job-post authenticity validator ==========
const NON_JOB_TITLE_PATTERNS = [
  /^login\s*$/i,
  /^login\s+page\s*$/i,
  /^sign\s+in\s*$/i,
  /^candidate\s+login\s*$/i,
  /^search\s*$/i,
  /^new\s+search\s*$/i,
  /^careers?\s*$/i,
  /^careers?\s+page\s*$/i,
  /^benefits?\s*$/i,
  /^view\s+our\s+benefits?\s*$/i,
  /^procurement\s*$/i,
  /^procurement\s+opportunities?\s*$/i,
  /^contact\s+us\s*$/i,
  /^proposal\s+request\s*$/i,
  /^browse\s+job\s+listings?\s*$/i,
  /^conservation\s+international\s+jobs?\s*$/i,
  /^put\s+your\s+passion\s*,\s*your\s+skills\s*,\s*and/i,
  /^just\s+want\s+to\s+submit\s+your\s+resume\?/i
];

const NON_JOB_URL_PATTERNS = [
  /candidatelogin/i,
  /benefits/i,
  /procurement/i,
  /procurement-opportunities/i,
  /contact-us/i,
  /proposal-request/i,
  /(?:\/|\?)search(?:$|[?#])/i,
  /benefits\.aspx/i,
  /careers\/(?:faq|why-work|life-at|join-our-team)(?:\/|$)/i,
  /conservation\.org\/(?:about\/)?(?:careers?|jobs?)(?:\/|$)/i,
  /conservation\.org\/procurement-opportunities(?:\/|$)/i,
  /taleo\.net\/.*candidatelogin/i,
  /taleo\.net\/.*jobsearch/i,
  /jobSearch\?/i
];

const JOB_CONTENT_SIGNALS = [
  /\bposition\s+description\b/i,
  /\bposition\s+summary\b/i,
  /\bposition\s+overview\b/i,
  /\bresponsibilities\b/i,
  /\bqualifications?\b/i,
  /\bapply\s+(?:now|today|here)\b/i,
  /\brequisition\s+id\b/i,
  /\bjob\s+id\b/i,
  /\breq\s*#\s*\d+/i,
  /viewRequisition\?.*rid=/i
];

const NON_JOB_CONTENT_SIGNALS = [
  /\bjob\s+search\b/i,
  /\bsearch\s+(?:jobs?|openings|positions)\b/i,
  /login/i,
  /\bsign\s+(?:in|up)\b/i,
  /\bbrowse\s+(?:all\s+)?(?:jobs?|openings|positions)/i,
  /\bview\s+(?:all\s+)?(?:jobs?|openings|positions)/i,
  /\b(?:our|your)\s+benefits?\b/i,
  /\bcareer\s+(?:opportunities?|resources?|advice|tips)/i,
  /navigation/i,
  /footer/i,
  /header/i
];

function isNonJobPostingTitle(title) {
  const clean = String(title || "").trim().replace(/\\u2019|\\u0092/g, "'").replace(/\s+/g, " ");
  if (!clean) return { rejected: true, reason: "empty_title", pageType: "empty" };
  for (const pattern of NON_JOB_TITLE_PATTERNS) {
    if (pattern.test(clean)) {
      return { rejected: true, reason: "non_job_title_pattern", pageType: classifyPageType(clean) };
    }
  }
  return { rejected: false };
}

function isNonJobPostingUrl(url) {
  const normalized = String(url || "").toLowerCase();
  if (!normalized) return { rejected: true, reason: "missing_url", pageType: "unknown" };
  for (const pattern of NON_JOB_URL_PATTERNS) {
    if (pattern.test(normalized)) {
      return { rejected: true, reason: "non_job_url_pattern", pageType: classifyPageTypeFromUrl(normalized) };
    }
  }
  return { rejected: false };
}

function isLandingPageWithNoJobData(title, text) {
  const cleanTitle = String(title || "").toLowerCase();
  const cleanText = String(text || "").toLowerCase();

  const hasLandingSignal = /\b(careers?|jobs?|employment)\b/i.test(cleanTitle);
  if (!hasLandingSignal) return { rejected: false };

  const hasJobContent = JOB_CONTENT_SIGNALS.some((p) => p.test(cleanText));
  if (hasJobContent) return { rejected: false };

  const hasNonJobContent = NON_JOB_CONTENT_SIGNALS.some((p) => p.test(cleanText));
  if (hasNonJobContent) {
    return { rejected: true, reason: "landing_page_no_job_content", pageType: "careers_landing_page" };
  }

  return { rejected: false };
}

function isJobPostAuthentic(job) {
  const titleCheck = isNonJobPostingTitle(job.title);
  if (titleCheck.rejected) return titleCheck;

  const urlCheck = isNonJobPostingUrl(job.source_url || job.original_url || job.apply_url || "");
  if (urlCheck.rejected) return urlCheck;

  const landingCheck = isLandingPageWithNoJobData(job.title, job.raw_description || job.description || "");
  if (landingCheck.rejected) return landingCheck;

  return { rejected: false };
}

function rejectNonJobPostings(jobs, report) {
  report.falseJobPagesDetected = { total: 0, rejected: 0, kept: 0, details: [] };
  for (const job of jobs) {
    const result = isJobPostAuthentic(job);
    report.falseJobPagesDetected.total++;
    if (result.rejected) {
      job.triage_bucket = "rejected_noise";
      job.triage_reason = result.reason;
      job.skip_reason = "non_job_posting";
      job.rejected_noise = true;
      report.falseJobPagesDetected.rejected++;
      report.falseJobPagesDetected.details.push({
        id: job.id,
        title: job.title,
        url: (job.source_url || job.original_url || "").slice(0, 100),
        rejection_reason: result.reason,
        page_type: result.pageType || "unknown"
      });
    } else {
      report.falseJobPagesDetected.kept++;
    }
  }
}

function classifyPageType(title) {
  const t = String(title || "").toLowerCase();
  if (/login|sign\s+in/.test(t)) return "login_page";
  if (/benefits/.test(t)) return "benefits_page";
  if (/procurement/.test(t)) return "procurement_page";
  if (/search/.test(t)) return "search_page";
  if (/careers?\s*$|conservation.*jobs/.test(t)) return "careers_landing_page";
  if (/contact|proposal/.test(t)) return "navigation_page";
  if (/browse|put your passion/.test(t)) return "navigation_page";
  return "unknown";
}

function classifyPageTypeFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (/candidatelogin/.test(u)) return "login_page";
  if (/benefits/.test(u)) return "benefits_page";
  if (/procurement/.test(u)) return "procurement_page";
  if (/search|jobSearch|jobsearch/.test(u)) return "search_page";
  if (/careers?\/?$|jobs?\/?$/.test(u)) return "careers_landing_page";
  if (/contact-us/.test(u)) return "navigation_page";
  if (/proposal-request/.test(u)) return "navigation_page";
  return "unknown";
}

if (require.main === module) { main().catch(e => { console.error("Failed:", e.message); process.exit(1); }); }
