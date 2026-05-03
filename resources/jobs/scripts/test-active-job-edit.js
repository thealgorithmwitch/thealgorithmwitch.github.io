const { execFileSync } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { readLocalAdminActions, writeLocalAdminActions } = require("./admin-actions-store");
const { JOB_RECORDS_FILE } = require("./public-records");
const { JOBS_FILE } = require("./job-utils");
const { buildPublicJobsFromRecords } = require("./public-jobs");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findPublishedTestRecord(records) {
  return records.find((record) => (
    record &&
    record.record_type === "job" &&
    record.published === true &&
    record.public_visibility === true &&
    String(record.status || "").toLowerCase() === "published" &&
    !["expired", "removed"].includes(String(record.verification_status || "").toLowerCase())
  ));
}

function makeAction(recordId, editedRecord) {
  const now = new Date().toISOString();
  return {
    id: `local-update-active-${randomUUID()}`,
    status: "queued",
    created_at: now,
    updated_at: now,
    actor: "Local Active Job Edit Test",
    operation: "update_active_job",
    payload_json: JSON.stringify({
      operation: "update_active_job",
      actor: "Local Active Job Edit Test",
      ids: [recordId],
      id: recordId,
      recordId,
      changed_fields: ["display.title"],
      editedRecord
    })
  };
}

function runApply() {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "apply-admin-actions.js")], {
    cwd: ROOT,
    stdio: "inherit"
  });
}

function assertTitleState(recordId, expectedTitle) {
  const records = readJson(JOB_RECORDS_FILE);
  const jobs = readJson(JOBS_FILE);
  const targetRecord = records.find((record) => String(record.id) === String(recordId));
  const targetJob = jobs.find((job) => String(job.id) === String(recordId));
  const pageFiles = fs.readdirSync(PAGES_DIR).filter((name) => name.endsWith(".html"));
  const matchingPage = pageFiles.find((fileName) => {
    const content = fs.readFileSync(path.join(PAGES_DIR, fileName), "utf8");
    return content.includes(expectedTitle);
  });

  if (!targetRecord || String(targetRecord.display?.title || "") !== String(expectedTitle)) {
    throw new Error(`job-records.json title mismatch for ${recordId}. Expected "${expectedTitle}".`);
  }
  if (!targetJob || String(targetJob.title || "") !== String(expectedTitle)) {
    throw new Error(`jobs.json title mismatch for ${recordId}. Expected "${expectedTitle}".`);
  }
  if (!matchingPage) {
    throw new Error(`Generated pages do not contain expected title "${expectedTitle}".`);
  }

  return {
    jobRecordsCount: records.length,
    jobsJsonCount: jobs.length,
    publishedJobsCount: buildPublicJobsFromRecords(records).length,
    pagesGenerated: pageFiles.length,
    matchingPage
  };
}

async function main() {
  const records = readJson(JOB_RECORDS_FILE);
  const targetRecord = findPublishedTestRecord(records);
  if (!targetRecord) {
    throw new Error("No published job record available for active edit test.");
  }

  const recordId = String(targetRecord.id || "");
  const originalTitle = String(targetRecord.display?.title || "");
  const testTitle = originalTitle.endsWith(" TEST") ? `${originalTitle} TEST` : `${originalTitle} TEST`;
  const existingActions = await readLocalAdminActions();

  await writeLocalAdminActions([
    ...existingActions,
    makeAction(recordId, { display: { title: testTitle } })
  ]);
  console.log(`[jobs:test-active-edit] queued test update_active_job record_id=${recordId} title="${testTitle}"`);
  runApply();
  const appliedState = assertTitleState(recordId, testTitle);
  console.log(
    `[jobs:test-active-edit] applied record_id=${recordId} job-records count=${appliedState.jobRecordsCount} jobs.json count=${appliedState.jobsJsonCount} pages generated=${appliedState.pagesGenerated} page=${appliedState.matchingPage}`
  );

  const actionsAfterFirstApply = await readLocalAdminActions();
  await writeLocalAdminActions([
    ...actionsAfterFirstApply,
    makeAction(recordId, { display: { title: originalTitle } })
  ]);
  console.log(`[jobs:test-active-edit] queued revert update_active_job record_id=${recordId} title="${originalTitle}"`);
  runApply();
  const revertedState = assertTitleState(recordId, originalTitle);
  console.log(
    `[jobs:test-active-edit] reverted record_id=${recordId} job-records count=${revertedState.jobRecordsCount} jobs.json count=${revertedState.jobsJsonCount} pages generated=${revertedState.pagesGenerated} page=${revertedState.matchingPage}`
  );
}

main().catch((error) => {
  console.error(`[jobs:test-active-edit] Failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
