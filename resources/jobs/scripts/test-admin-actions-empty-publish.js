const assert = require("assert");
const {
  runAdminActionDiagnostics,
  isEmptyPublishSelectedAction
} = require("./apply-admin-actions");

async function main() {
  const emptyAction = {
    id: "empty-publish-action",
    status: "queued",
    created_at: "2026-05-24T00:00:00.000Z",
    updated_at: "2026-05-24T00:00:00.000Z",
    operation: "publish_selected",
    payload_json: JSON.stringify({
      operation: "publish_selected",
      ids: [],
      jobs: []
    })
  };
  const emptyReport = await runAdminActionDiagnostics({
    pendingJobs: [],
    jobRecords: [],
    fetched: {
      source: "snapshot",
      actions: [emptyAction]
    }
  });
  assert.strictEqual(isEmptyPublishSelectedAction({
    operation: "publish_selected",
    payload: { ids: [], jobs: [] }
  }), true);
  assert.strictEqual(emptyReport.safeToApply, true);
  assert.strictEqual(emptyReport.emptyPublishSelectedIgnoredCount, 1);
  assert.deepStrictEqual(emptyReport.ignoredActionIds, ["empty-publish-action"]);
  assert.strictEqual(emptyReport.publishSummary.publishable_count, 0);
  assert.strictEqual(emptyReport.selectedJobsCount, 0);

  const validPendingJob = {
    id: "valid-job-1",
    title: "Communications Manager",
    organization: "Climate Works",
    location: "Remote",
    workplace_type: "Remote",
    salary: "$90,000 / year",
    salary_min: 90000,
    salary_max: 90000,
    salary_currency: "USD",
    salary_period: "year",
    salary_visible: true,
    description: "This role leads communications strategy, media planning, and cross-functional campaign execution for a climate policy team.",
    raw_description: "This role leads communications strategy, media planning, and cross-functional campaign execution for a climate policy team.",
    source: "Manual",
    source_url: "https://example.org/jobs/communications-manager",
    apply_url: "https://example.org/jobs/communications-manager/apply",
    original_url: "https://example.org/jobs/communications-manager",
    date_posted: "2026-05-24",
    date_added: "2026-05-24",
    date_updated: "2026-05-24",
    status: "pending",
    source_type: "custom"
  };
  const validAction = {
    id: "valid-publish-action",
    status: "queued",
    created_at: "2026-05-24T00:00:00.000Z",
    updated_at: "2026-05-24T00:00:00.000Z",
    operation: "publish_selected",
    payload_json: JSON.stringify({
      operation: "publish_selected",
      ids: ["valid-job-1"]
    })
  };
  const validReport = await runAdminActionDiagnostics({
    pendingJobs: [validPendingJob],
    jobRecords: [],
    fetched: {
      source: "snapshot",
      actions: [validAction]
    }
  });
  assert.strictEqual(validReport.safeToApply, true);
  assert.strictEqual(validReport.publishSummary.publishable_count, 1);
  assert.strictEqual(validReport.emptyPublishSelectedIgnoredCount, 0);

  const malformedAction = {
    id: "malformed-publish-action",
    status: "queued",
    created_at: "2026-05-24T00:00:00.000Z",
    updated_at: "2026-05-24T00:00:00.000Z",
    operation: "publish_selected",
    payload_json: JSON.stringify({
      operation: "publish_selected",
      ids: ["missing-job-1", "missing-job-2"]
    })
  };
  const malformedReport = await runAdminActionDiagnostics({
    pendingJobs: [],
    jobRecords: [],
    fetched: {
      source: "snapshot",
      actions: [malformedAction]
    }
  });
  assert.strictEqual(malformedReport.safeToApply, false);
  assert.strictEqual(malformedReport.malformedPublishActions.length, 1);
  assert.strictEqual(malformedReport.malformedPublishActions[0].reason, "publish_selected_unresolvable_targets");

  console.log("test-admin-actions-empty-publish: all checks passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
