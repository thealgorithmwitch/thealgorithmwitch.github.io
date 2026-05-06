const assert = require("assert");
const { readSources } = require("./job-utils");
const { routeSyncedJob } = require("./job-normalizer");
const { triagePendingJobs } = require("./pending-triage");

async function main() {
  const sources = await readSources();
  const source = sources.find((item) => String(item.id || "") === "climatechangejobs");
  assert(source, "Missing climatechangejobs source config");
  assert(source.enabled !== false, "climatechangejobs source is disabled");
  assert(source.custom_sync_enabled !== false, "climatechangejobs custom sync is disabled");
  assert.strictEqual(Boolean(source.trusted), false, "climatechangejobs should not be trusted");
  assert.strictEqual(Boolean(source.auto_publish), false, "climatechangejobs should not auto-publish");

  const routed = routeSyncedJob({
    id: "climatechangejobs-fixture-001",
    external_id: "climatechangejobs-fixture-001",
    title: "Video Producer",
    organization: "Clean Future Media",
    location: "Remote",
    workplace_type: "Remote",
    salary: "$80,000 / year",
    description: "Clean Future Media is hiring a video producer who will create short-form climate storytelling for social and documentary channels.",
    source: "ClimateChangeJobs",
    source_id: "climatechangejobs",
    source_url: "https://climatechangejobs.com/jobs",
    apply_url: "https://cleanfuturemedia.example/apply",
    original_url: "https://cleanfuturemedia.example/apply",
    tags: ["video", "climate", "content"],
    sync_origin: "custom"
  }, source);

  assert(routed, "routeSyncedJob returned null for climatechangejobs fixture");
  assert.strictEqual(routed.status, "pending", "ClimateChangeJobs fixture should route to pending");
  const triaged = await triagePendingJobs([routed], [], {
    sources: [{
      source_id: "climatechangejobs",
      source_name: "ClimateChangeJobs",
      source_url: "https://climatechangejobs.com/jobs",
      jobs_parsed: 1
    }]
  });
  assert(triaged.adminPendingJobs.length >= 1, "ClimateChangeJobs fixture did not survive into pending review");

  const lowSignalRouted = routeSyncedJob({
    id: "climatechangejobs-fixture-002",
    external_id: "climatechangejobs-fixture-002",
    title: "Project Coordinator",
    organization: "Climate Housing Alliance",
    location: "Remote",
    workplace_type: "Remote",
    salary: "",
    description: "Support project coordination across a climate and housing portfolio.",
    source: "ClimateChangeJobs",
    source_id: "climatechangejobs",
    source_url: "https://climatechangejobs.com/jobs",
    apply_url: "https://climatechangejobs.com/jobs/fixture-project-coordinator",
    original_url: "https://climatechangejobs.com/jobs/fixture-project-coordinator",
    tags: ["climate"],
    sync_origin: "custom"
  }, source);
  assert(lowSignalRouted, "routeSyncedJob returned null for low-signal climatechangejobs fixture");
  const lowSignalTriaged = await triagePendingJobs([lowSignalRouted], [], {
    sources: [{
      source_id: "climatechangejobs",
      source_name: "ClimateChangeJobs",
      source_url: "https://climatechangejobs.com/jobs",
      jobs_parsed: 1
    }]
  });
  assert.strictEqual(lowSignalTriaged.adminPendingJobs.length, 1, "Low-signal climatechangejobs fixture should still route to pending");
  assert.strictEqual(lowSignalTriaged.adminPendingJobs[0].triage_bucket, "needs_cleanup");

  console.log(JSON.stringify({
    source_checked: "climatechangejobs",
    jobs_found: 2,
    jobs_normalized: 2,
    jobs_skipped: 0,
    jobs_written_to_pending: triaged.adminPendingJobs.length + lowSignalTriaged.adminPendingJobs.length,
    routed_status: routed.status,
    specialization: routed.specialization,
    triage_bucket: triaged.adminPendingJobs[0]?.triage_bucket || "",
    triage_reason: triaged.adminPendingJobs[0]?.triage_reason || "",
    low_signal_triage_bucket: lowSignalTriaged.adminPendingJobs[0]?.triage_bucket || "",
    low_signal_triage_reason: lowSignalTriaged.adminPendingJobs[0]?.triage_reason || ""
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:test-climatechangejobs-routing] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
