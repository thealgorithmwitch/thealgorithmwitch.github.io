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

  console.log(JSON.stringify({
    source_checked: "climatechangejobs",
    jobs_found: 1,
    jobs_normalized: 1,
    jobs_skipped: 0,
    jobs_written_to_pending: triaged.adminPendingJobs.length,
    routed_status: routed.status,
    specialization: routed.specialization,
    triage_bucket: triaged.adminPendingJobs[0]?.triage_bucket || "",
    triage_reason: triaged.adminPendingJobs[0]?.triage_reason || ""
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:test-climatechangejobs-routing] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
