const assert = require("assert");
const fs = require("fs/promises");
const path = require("path");

function quietLogger() {
  return {
    log() {},
    error() {},
    warn() {}
  };
}

async function writeFixtureState(rootDir) {
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(path.join(rootDir, "jobs.json"), "[]\n", "utf8");
  await fs.writeFile(path.join(rootDir, "pending-synced-jobs.json"), JSON.stringify([
    {
      id: "climatechangejobs-preserved-001",
      source_id: "climatechangejobs",
      source: "ClimateChangeJobs",
      sync_origin: "custom",
      status: "pending",
      title: "Grid Policy Analyst",
      organization: "Climate Board Example",
      location: "Remote",
      workplace_type: "Remote",
      apply_url: "https://climatechangejobs.com/jobs/fixture-grid-policy-analyst",
      original_url: "https://climatechangejobs.com/jobs/fixture-grid-policy-analyst",
      source_url: "https://climatechangejobs.com/jobs/",
      description: "Preserved pending record for failure fallback validation.",
      raw_description: "Preserved pending record for failure fallback validation.",
      date_posted: "2026-05-06"
    }
  ], null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(rootDir, "scrape-report.json"), JSON.stringify({ generated_at: "", sources: [] }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(rootDir, "source-health-latest.json"), JSON.stringify({ generated_at: "", sync_type: "", sources: [] }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(rootDir, "job-records.json"), "[]\n", "utf8");
  await fs.writeFile(path.join(rootDir, "sources.json"), JSON.stringify({
    sources: [
      {
        id: "climatechangejobs",
        name: "ClimateChangeJobs",
        organization: "ClimateChangeJobs",
        type: "recruiter_or_job_aggregator",
        custom_sync_enabled: true,
        parser_enabled: true,
        enabled: true,
        trusted: false,
        auto_publish: false,
        source_url: "https://climatechangejobs.com/jobs",
        api_url: "",
        sector: "Climate Tech",
        function_defaults: [],
        notes: "External board listing. Keep pending-only and extract real employer before review."
      }
    ]
  }, null, 2) + "\n", "utf8");
}

async function main() {
  const fixtureRoot = await fs.mkdtemp(path.join(process.cwd(), ".tmp-climatechangejobs-fetch-failure-"));
  process.env.JOBS_DATA_DIR = fixtureRoot;
  const { runCustomSync } = require("./sync-custom");
  try {
    await writeFixtureState(fixtureRoot);
    await runCustomSync({
      logger: quietLogger(),
      syncJobRecords: false,
      scrapeImpl: async (source) => ({
        jobs: [],
        report: {
          source_id: source.id,
          source_name: source.organization,
          source_url: source.source_url,
          detected_ats_provider: "",
          parser_used: "generic:discovery",
          pages_checked: [
            {
              url: "https://climatechangejobs.com/jobs/",
              depth: 0,
              status: "fetch-failed",
              status_text: "timeout after 20000ms",
              final_url: "https://climatechangejobs.com/jobs/",
              redirected: false,
              error: "timeout after 20000ms"
            }
          ],
          links_discovered: ["https://climatechangejobs.com/jobs/"],
          job_links_found: [],
          parser_selectors_used: ["job links <a href>"],
          jobs_parsed: 0,
          reason_for_zero_results: "All discovered pages failed to fetch.",
          browser_fallback_recommended: false,
          generated_at: new Date().toISOString(),
          errors: ["https://climatechangejobs.com/jobs/: timeout after 20000ms"]
        }
      })
    });

    const pending = JSON.parse(await fs.readFile(path.join(fixtureRoot, "pending-synced-jobs.json"), "utf8"));
    const preserved = pending.find((job) => job.id === "climatechangejobs-preserved-001");
    assert(preserved, "Existing ClimateChangeJobs pending record was removed after fetch failure");

    const health = JSON.parse(await fs.readFile(path.join(fixtureRoot, "source-health-latest.json"), "utf8"));
    const entry = (health.sources || []).find((item) => item.source_id === "climatechangejobs");
    assert(entry, "Missing ClimateChangeJobs source health entry after fetch failure");
    assert.strictEqual(entry.source_temporarily_unavailable, true, "ClimateChangeJobs failure should mark source as temporarily unavailable");
    assert.strictEqual(entry.fallback_used, true, "ClimateChangeJobs failure should report pending-preservation fallback");
    assert.strictEqual(entry.pending_count_delta, 1, "ClimateChangeJobs failure should preserve existing pending count");

    const scrapeReport = JSON.parse(await fs.readFile(path.join(fixtureRoot, "scrape-report.json"), "utf8"));
    const report = (scrapeReport.sources || []).find((item) => item.source_id === "climatechangejobs");
    assert(report, "Missing ClimateChangeJobs scrape report after fetch failure");
    assert.strictEqual(report.source_temporarily_unavailable, true, "Scrape report should mark ClimateChangeJobs temporarily unavailable");
    assert.strictEqual(report.fallback_used, true, "Scrape report should note preserved pending fallback");
    assert.strictEqual(report.reason_for_zero_results, "All discovered pages failed to fetch.");

    console.log(JSON.stringify({
      source_checked: "climatechangejobs",
      jobs_found: 0,
      jobs_written_to_pending: pending.length,
      fallback_used: true,
      preserved_pending_id: preserved.id,
      failed_page_status: report.pages_checked[0]?.status || "",
      failed_page_error: report.pages_checked[0]?.error || ""
    }, null, 2));
  } finally {
    delete process.env.JOBS_DATA_DIR;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:test-climatechangejobs-fetch-failure] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
