#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const REPORTS_DIR = path.join(ROOT, "reports");

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}
function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n");
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html"
      },
      timeout: 15000
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")); });
  });
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyText(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return "";
  return stripHtml(bodyMatch[1]);
}

function parseSalaryFromText(text) {
  const salaryMatch = text.match(/[Ss]alary\s*\$(\d[\d,]*)\s*(?:-|–|—|to)\s*\$?(\d[\d,]*)/);
  if (!salaryMatch) return null;
  const min = Number(salaryMatch[1].replace(/[,\s]/g, ""));
  const max = Number(salaryMatch[2].replace(/[,\s]/g, ""));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {
    salary: `\$${min.toLocaleString()}–\$${max.toLocaleString()} / year`,
    salary_min: min,
    salary_max: max,
    salary_currency: "USD",
    salary_period: "yearly",
    salary_visible: true,
    raw_salary: `\$${min.toLocaleString()}–\$${max.toLocaleString()}`
  };
}

// ========== 1. Greenlight America enrichment ==========
async function enrichGreenlight(jobs, report) {
  const targets = jobs.filter(j =>
    String(j.source_id || "").toLowerCase() === "greenlight-america" &&
    String(j.organization || "").toLowerCase().includes("greenlight") &&
    (!j.salary_visible || !j.salary_min)
  );
  report.greenlight = { found: targets.length, enriched: 0, details: [] };
  for (const job of targets) {
    const url = job.apply_url || job.source_url || "";
    if (!url) continue;
    try {
      const html = await fetchHtml(url);
      const text = extractBodyText(html);
      if (text.length > (job.description || "").length) {
        job.raw_description = text;
        job.description = text;
        job.description_source_url = url;
        const salaryData = parseSalaryFromText(text);
        if (salaryData) {
          Object.assign(job, salaryData);
          job.pay_parse_source = "enriched_description";
        }
        report.greenlight.enriched++;
        report.greenlight.details.push({ id: job.id, title: job.title, oldLen: (job.description || "").length, newLen: text.length, salaryFound: !!salaryData });
      }
    } catch (e) {
      report.greenlight.details.push({ id: job.id, title: job.title, error: e.message });
    }
  }
}

// ========== 2. BlueGreen Alliance false positives ==========
function rejectBlueGreenAlliance(jobs, report) {
  const stateNames = ["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming"];
  const reportUrlPath = "/site/jobs-from-climate-action-the-inflation-reduction-acts-impact-on-state-job-creation/";
  let rejected = 0;
  report.bluegreen = { total: 0, rejected: 0, details: [] };
  for (const job of jobs) {
    const org = String(job.organization || "").toLowerCase();
    const sid = String(job.source_id || "").toLowerCase();
    if (!org.includes("bluegreen") && !sid.includes("bluegreen")) continue;
    report.bluegreen.total++;
    const url = String(job.apply_url || job.source_url || job.original_url || "");
    const title = String(job.title || "").trim().toLowerCase();

    // Reject report page URLs
    if (url.includes(reportUrlPath)) {
      job.triage_bucket = "rejected_noise";
      job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "report_page_bluegreen_alliance";
      job.rejected_noise = true;
      job.notes = (job.notes || "") + " [rejected: BlueGreen Alliance state impact report page, not a job posting]";
      report.bluegreen.rejected++;
      report.bluegreen.details.push({ id: job.id, title: job.title, reason: "report_page_url" });
      rejected++;
      continue;
    }

    // Reject state-only titles
    if (stateNames.includes(title)) {
      job.triage_bucket = "rejected_noise";
      job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "state_name_only_title_bluegreen";
      job.rejected_noise = true;
      job.notes = (job.notes || "") + " [rejected: title is only a state name, not a job posting]";
      report.bluegreen.rejected++;
      report.bluegreen.details.push({ id: job.id, title: job.title, reason: "state_name_title" });
      rejected++;
      continue;
    }

    // Reject titles that are just "x job" or single word that is a location
    if (title.split(/\s+/).length <= 3 && stateNames.includes(title.split(/\s+/)[0])) {
      job.triage_bucket = "rejected_noise";
      job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "likely_state_page_bluegreen";
      job.rejected_noise = true;
      job.notes = (job.notes || "") + " [rejected: likely a state page, not a job posting]";
      report.bluegreen.rejected++;
      report.bluegreen.details.push({ id: job.id, title: job.title, reason: "state_likely_page" });
      rejected++;
    }
  }
  report.bluegreen.remaining = report.bluegreen.total - report.bluegreen.rejected;
}

// ========== 3. Unknown org recovery ==========
const ATS_ORG_MAP = [
  { pattern: /jobs\.ashbyhq\.com\/([^\/]+)/i, extract: (m) => { const name = m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()); return name; } },
  { pattern: /recruiting2?\.ultipro\.com\/([A-Za-z0-9]+)/i, extract: (m) => { const code = m[1]; const map = { "PRO1047PROTI": "Proterra" }; return map[code] || code; } },
  { pattern: /recruiting\.paylocity\.com\/recruiting\/jobs\/All\/([^\/]+)/i, extract: (m) => { const code = m[1]; const map = { "87c39316-4dac-4f7b-b84b-1714eaf203cf": "American Bird Conservancy" }; return map[code] || null; } }
];

function recoverUnknownOrgs(jobs, report) {
  let recovered = 0;
  report.unknownOrg = { total: 0, recovered: 0, details: [] };
  for (const job of jobs) {
    const org = String(job.organization || "").toLowerCase();
    if (org !== "unknown" && org !== "unknown organization" && !org.includes("unknown")) continue;
    report.unknownOrg.total++;
    const url = String(job.apply_url || job.original_url || job.source_url || "");
    for (const rule of ATS_ORG_MAP) {
      const match = url.match(rule.pattern);
      if (match) {
        const recoveredOrg = rule.extract(match);
        if (recoveredOrg && recoveredOrg.toLowerCase() !== "unknown") {
          job.organization = recoveredOrg;
          if (job.triage_bucket === "needs_cleanup" && job.triage_reason && job.triage_reason.includes("unknown")) {
            job.triage_bucket = "review_ready";
            job.triage_reason = "org_recovered_from_url";
          }
          report.unknownOrg.recovered++;
          report.unknownOrg.details.push({ id: job.id, title: job.title, oldOrg: org, newOrg: recoveredOrg, recoveredFrom: match[0].slice(0, 60) });
          recovered++;
        }
        break;
      }
    }
    if (!recovered) {
      report.unknownOrg.details.push({ id: job.id, title: job.title, oldOrg: org, newOrg: null, recoveredFrom: null });
    }
  }
}

// ========== 4. EDF bad page rejection ==========
function rejectEDFArticles(jobs, report) {
  let rejected = 0;
  let updatedSource = false;
  report.edf = { total: 0, rejected: 0, source_updated: false, details: [] };

  // Update EDF source URL
  const sources = readJson(SOURCES_FILE);
  const edfSource = sources.find(s => String(s.id || "").toLowerCase() === "edf");
  if (edfSource) {
    const correctUrl = "https://www.edf.org/jobs";
    if (String(edfSource.source_url || edfSource.url) !== correctUrl) {
      edfSource.source_url = correctUrl;
      edfSource.url = correctUrl;
      const idx = sources.indexOf(edfSource);
      const afterEdf = sources.slice(idx + 1);
      const beforeEdf = sources.slice(0, idx);
      writeJson(SOURCES_FILE, [...beforeEdf, edfSource, ...afterEdf]);
      report.edf.source_updated = true;
      updatedSource = true;
    }
  }

  for (const job of jobs) {
    const org = String(job.organization || "").toLowerCase();
    const sid = String(job.source_id || "").toLowerCase();
    if (!org.includes("environmental defense fund") && !sid.includes("edf")) continue;
    report.edf.total++;
    const url = String(job.apply_url || job.original_url || job.source_url || "");

    const isArticle = url.includes("/pivoting-") || url.includes("/blog/") || url.includes("/article/") || url.includes("/news/") || url.includes("/press-release/") || url.match(/\/[a-z-]+\/[a-z-]{30,}/);
    if (isArticle && !url.includes("/jobs/") && !url.includes("/careers/")) {
      job.triage_bucket = "rejected_noise";
      job.triage_reason = "rejected_non_job_link";
      job.skip_reason = "edf_article_not_job";
      job.rejected_noise = true;
      job.notes = (job.notes || "") + " [rejected: EDF article page, not a job posting]";
      report.edf.rejected++;
      report.edf.details.push({ id: job.id, title: job.title, url: url.slice(0, 80), reason: "article_page" });
      rejected++;
    }
  }
}

// ========== MAIN ==========
async function main() {
  const report = { generated_at: new Date().toISOString() };
  const jobs = readJson(PENDING_FILE);

  console.log("=== Comprehensive Pending Cleanup ===");
  console.log("Total pending records:", jobs.length);

  // 1. Greenlight enrichment
  console.log("\n--- Greenlight America Enrichment ---");
  await enrichGreenlight(jobs, report);

  // 2. BlueGreen Alliance
  console.log("\n--- BlueGreen Alliance Rejection ---");
  rejectBlueGreenAlliance(jobs, report);

  // 3. Unknown org recovery
  console.log("\n--- Unknown Org Recovery ---");
  recoverUnknownOrgs(jobs, report);

  // 4. EDF article/bad page rejection
  console.log("\n--- EDF Bad Page Rejection ---");
  rejectEDFArticles(jobs, report);

  // Write updated pending
  writeJson(PENDING_FILE, jobs);
  console.log("\nWrote updated pending-synced-jobs.json");

  // Write reports
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeJson(path.join(REPORTS_DIR, "manual-pending-retriage-cleanup.json"), report);

  // Generate MD report
  let md = "# Comprehensive Pending Cleanup Report\n\n";
  md += "**Generated:** " + report.generated_at + "\n\n";

  md += "## 1. Greenlight America Enrichment\n\n";
  md += "- Found: " + report.greenlight.found + "\n";
  md += "- Enriched: " + report.greenlight.enriched + "\n";
  md += "- Details:\n";
  for (const d of report.greenlight.details) {
    if (d.error) md += "  - ERROR " + d.id + ": " + d.error + "\n";
    else md += "  - " + d.id + " | " + d.title + " | " + d.oldLen + "→" + d.newLen + " chars | salary=" + d.salaryFound + "\n";
  }

  md += "\n## 2. BlueGreen Alliance\n\n";
  md += "- Total: " + report.bluegreen.total + "\n";
  md += "- Rejected: " + report.bluegreen.rejected + "\n";
  md += "- Remaining: " + report.bluegreen.remaining + "\n";
  md += "- Details:\n";
  for (const d of report.bluegreen.details) {
    md += "  - " + d.id + " | " + d.title + " | reason=" + d.reason + "\n";
  }

  md += "\n## 3. Unknown Org Recovery\n\n";
  md += "- Total unknown: " + report.unknownOrg.total + "\n";
  md += "- Recovered: " + report.unknownOrg.recovered + "\n";
  md += "- Details:\n";
  for (const d of report.unknownOrg.details) {
    if (d.newOrg) md += "  - " + d.id + " | " + d.title + " | " + d.oldOrg + " → " + d.newOrg + " | from=" + d.recoveredFrom + "\n";
    else md += "  - UNRECOVERED: " + d.id + " | " + d.title + " | " + d.oldOrg + "\n";
  }

  md += "\n## 4. EDF\n\n";
  md += "- Total: " + report.edf.total + "\n";
  md += "- Rejected: " + report.edf.rejected + "\n";
  md += "- Source URL updated: " + report.edf.source_updated + "\n";
  md += "- Details:\n";
  for (const d of report.edf.details) {
    md += "  - " + d.id + " | " + d.title + " | " + d.url + " | reason=" + d.reason + "\n";
  }

  writeJson(path.join(REPORTS_DIR, "manual-pending-retriage-cleanup.md"), { content: md });
  console.log("Reports generated");

  console.log("\n=== Summary ===");
  console.log("Greenlight enriched:", report.greenlight.enriched);
  console.log("BlueGreen rejected:", report.bluegreen.rejected);
  console.log("Unknown orgs recovered:", report.unknownOrg.recovered);
  console.log("EDF articles rejected:", report.edf.rejected);
  console.log("EDF source updated:", report.edf.source_updated);

  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Cleanup failed:", err.message);
    process.exit(1);
  });
}
