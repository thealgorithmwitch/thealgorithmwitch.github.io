const assert = require("assert");
const { resolveExplainedDropAllowance } = require("./public-jobs");

async function main() {
  const existingJobs = [
    { id: "job-1" },
    { id: "job-2" },
    { id: "job-3" }
  ];
  const nextJobs = [
    { id: "job-1" }
  ];

  const allowed = await resolveExplainedDropAllowance(existingJobs, nextJobs, {
    explainedRemovedIds: ["job-2", "job-3"]
  });
  assert.strictEqual(allowed.allowed, true, "explained removals should allow the shrink");
  assert.deepStrictEqual(allowed.unexplainedRemovedIds, [], "all removals should be explained");

  const denied = await resolveExplainedDropAllowance(existingJobs, nextJobs, {
    explainedRemovedIds: ["job-2"]
  });
  assert.strictEqual(denied.allowed, false, "missing explanations should keep the guard active");
  assert.deepStrictEqual(denied.unexplainedRemovedIds, ["job-3"], "unexplained removals should be surfaced");

  console.log(JSON.stringify({
    ok: true,
    allowed_removed_ids: allowed.removedIds,
    denied_unexplained_removed_ids: denied.unexplainedRemovedIds
  }, null, 2));
}

main().catch((error) => {
  console.error(`[jobs:test-public-jobs-explained-drop] Failed: ${error.message}`);
  process.exitCode = 1;
});
