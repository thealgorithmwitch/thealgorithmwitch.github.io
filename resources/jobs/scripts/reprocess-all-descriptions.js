const { readFileSync, writeFileSync } = require("fs");
const { normalizeDescription } = require("./job-normalizer");

const JOBS_FILE = __dirname + "/../jobs.json";
const JOB_RECORDS_FILE = __dirname + "/../job-records.json";
const PENDING_FILE = __dirname + "/../pending-synced-jobs.json";

function readJobs() {
  const raw = readFileSync(JOBS_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeJobs(jobs) {
  writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

function readJobRecords() {
  const raw = readFileSync(JOB_RECORDS_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeJobRecords(records) {
  writeFileSync(JOB_RECORDS_FILE, JSON.stringify(records, null, 2), "utf-8");
}

function readPending() {
  const raw = readFileSync(PENDING_FILE, "utf-8");
  return JSON.parse(raw);
}

function writePending(jobs) {
  writeFileSync(PENDING_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

function reprocessJobDescriptions(jobs, name) {
  let updated = 0;
  let headingAdded = 0;
  
  jobs.forEach(job => {
    // Get the raw description from wherever it's stored
    const rawDescription = job.raw_description || job.description || "";
    
    if (!rawDescription) return;
    
    // Re-process using the full normalization pipeline
    const result = normalizeDescription(rawDescription, {
      title: job.title || "",
      organization: job.organization || ""
    });
    
    // Update the job with the reprocessed description
    const oldDescription = job.description;
    job.description = result.description;
    job.description_heading_used = result.diagnostics?.description_heading_used || "";
    
    // Also update raw_description if it was empty
    if (!job.raw_description) {
      job.raw_description = result.raw_description;
    }
    
    if (job.description !== oldDescription) {
      updated++;
    }
    
    if (job.description_heading_used && job.description_heading_used !== "") {
      headingAdded++;
    }
  });
  
  console.log(`${name}: Updated ${updated} job descriptions, added heading info to ${headingAdded}`);
  return { updated, headingAdded };
}

function main() {
  console.log("Reprocessing all job descriptions...");
  
  // Process jobs.json
  const jobs = readJobs();
  const jobsResult = reprocessJobDescriptions(jobs, "jobs.json");
  writeJobs(jobs);
  
  // Process job-records.json
  const records = readJobRecords();
  let recordsUpdated = 0;
  let recordsHeadingAdded = 0;
  
  records.forEach(record => {
    // Process the display object
    if (record.display) {
      const rawDescription = record.display.raw_description || record.display.description || "";
      
      if (rawDescription) {
        const result = normalizeDescription(rawDescription, {
          title: record.display.title || "",
          organization: record.display.organization || ""
        });
        
        const oldDescription = record.display.description;
        record.display.description = result.description;
        record.display.description_heading_used = result.diagnostics?.description_heading_used || "";
        
        if (!record.display.raw_description) {
          record.display.raw_description = result.raw_description;
        }
        
        if (record.display.description !== oldDescription) {
          recordsUpdated++;
        }
        
        if (record.display.description_heading_used && record.display.description_heading_used !== "") {
          recordsHeadingAdded++;
        }
      }
    }
  });
  
  console.log(`job-records.json: Updated ${recordsUpdated} job descriptions, added heading info to ${recordsHeadingAdded}`);
  writeJobRecords(records);
  
  // Process pending-synced-jobs.json
  const pending = readPending();
  const pendingResult = reprocessJobDescriptions(pending, "pending-synced-jobs.json");
  writePending(pending);
  
  console.log("\\nReprocessing complete!");
}

if (require.main === module) {
  main().catch(error => {
    console.error("Reprocessing failed:", error);
    process.exit(1);
  });
}

module.exports = { reprocessJobDescriptions };
