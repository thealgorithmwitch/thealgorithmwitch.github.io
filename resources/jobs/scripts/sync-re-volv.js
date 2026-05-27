const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const JOBS_FILE = path.join(ROOT, "jobs.json");

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
  return String(h || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<footer[\s\S]*?<\/footer>/gi, " ").replace(/<header[\s\S]*?<\/header>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "'").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchREVolvJobs() {
  const url = "https://re-volv.org/about-us/jobs/";
  const html = await fetchHtml(url);
  const text = stripHtml(html);

  const jobs = [];
  const titleMatch = text.match(/Lending and Finance Analyst/i);

  if (titleMatch) {
    const fullTitle = "Lending and Finance Analyst";
    const descMatch = text.match(new RegExp(`The Role[\\s\\S]*?(?=About RE-volv|Position Details|Key Responsibilities|Equal Opportunity|How to Apply)`));
    const detailsMatch = text.match(/Position Details[\\s\\S]*?(?=Key Responsibilities|Equal Opportunity|How to Apply)/);
    const respMatch = text.match(/Key Responsibilities[\\s\\S]*?(?=Skills and Qualifications|Equal Opportunity|How to Apply)/);
    const qualMatch = text.match(/Skills and Qualifications[\\s\\S]*?(?=Equal Opportunity|How to Apply)/);
    const applyMatch = text.match(/How to Apply[\\s\\S]*?(?=$|Benefits|Job Openings|Careers|Work that makes)/);

    const descriptionParts = [
      descMatch ? descMatch[0].trim() : "",
      detailsMatch ? detailsMatch[0].trim() : "",
      respMatch ? respMatch[0].trim() : "",
      qualMatch ? qualMatch[0].trim() : "",
      applyMatch ? applyMatch[0].trim() : ""
    ].filter(Boolean);

    const description = descriptionParts.join("\n\n") || text.slice(0, 2000);

    jobs.push({
      id: "re-volv-lending-and-finance-analyst",
      source_id: "re-volv",
      source: "RE-volv Careers",
      organization: "RE-volv",
      title: fullTitle,
      location: "Remote, USA",
      workplace_type: "Remote",
      job_type: "Full-time",
      apply_url: "https://re-volv.org/about-us/jobs/",
      source_url: "https://re-volv.org/about-us/jobs/",
      description: description,
      raw_description: description,
      description_snippet: "RE-volv is hiring an experienced lending and finance analyst to support our end to end clean energy lending operations from origination through servicing.",
      date_synced: new Date().toISOString().split("T")[0],
      manual_review_required: true,
      published: false,
      public_visibility: false,
      verification_status: "pending",
      triage_bucket: "review_ready",
      triage_reason: "manual_review_source",
      parser_confidence: "high",
      sector: "Clean Energy"
    });
  }

  return jobs;
}

async function main() {
  console.log("[sync-re-volv] Fetching RE-volv jobs...");
  const jobs = await fetchREVolvJobs();
  console.log(`[sync-re-volv] Found ${jobs.length} jobs`);

  const pending = readJson(PENDING_FILE);
  const existingIds = new Set(pending.map(j => j.id));
  let added = 0;
  for (const job of jobs) {
    if (!existingIds.has(job.id)) {
      pending.push(job);
      added++;
    }
  }
  writeJson(PENDING_FILE, pending);
  console.log(`[sync-re-volv] Added ${added} new pending records`);
  console.log("[sync-re-volv] Done");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-re-volv] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { fetchREVolvJobs };
