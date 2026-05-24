const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { canonicalizeJobShape } = require("./canonical-job-shape");
const { selectedPublishSanitizerHelpers } = require("./apply-admin-actions");
const { buildJobRecord } = require("./public-records");

function excerpt(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function main() {
  const dirtyInput = {
    id: "test-dirty-1",
    source_id: "quince",
    source_type: "ats",
    title: "Communications Manager - Remote",
    organization: "Climate Org",
    location: "Chicago, IL Remote",
    workplace_type: "",
    job_type: "full time",
    description: "the will help lead communications strategy. Previous post navigation. Share to twitter.",
    raw_description: "the will help lead communications strategy. Previous post navigation. Share to twitter.",
    source: "Greenhouse",
    source_url: "https://job-boards.greenhouse.io/climateorg",
    apply_url: "https://job-boards.greenhouse.io/climateorg/jobs/1",
    original_url: "https://job-boards.greenhouse.io/climateorg/jobs/1",
    salary: "$120,000 - $150,000 per year",
    function: "Communications",
    sector: "Climate",
    tags: ["communications", "climate"]
  };

  const syncShape = canonicalizeJobShape(dirtyInput);
  assert(syncShape, "sync canonicalization failed");

  const adminShape = selectedPublishSanitizerHelpers.sanitizePublishSelectedJob(dirtyInput).job;
  assert(adminShape, "admin publish sanitization failed");

  const migrateShape = canonicalizeJobShape({
    ...dirtyInput,
    description: dirtyInput.description,
    raw_description: dirtyInput.raw_description
  });
  assert(migrateShape, "migration canonicalization failed");

  [
    ["title", syncShape.title, adminShape.title, migrateShape.title],
    ["workplace_type", syncShape.workplace_type, adminShape.workplace_type, migrateShape.workplace_type],
    ["salary", syncShape.salary, adminShape.salary, migrateShape.salary]
  ].forEach(([field, syncValue, adminValue, migrateValue]) => {
    assert.strictEqual(
      excerpt(syncValue),
      excerpt(adminValue),
      `${field} diverged between sync and admin publish`
    );
    assert.strictEqual(
      excerpt(syncValue),
      excerpt(migrateValue),
      `${field} diverged between sync and migration`
    );
  });

  [syncShape.description_snippet, adminShape.description_snippet, migrateShape.description_snippet].forEach((snippet, index) => {
    assert.ok(excerpt(snippet), `description_snippet ${index} should not be empty`);
    assert.ok(
      /Chicago, IL|remote role/i.test(excerpt(snippet)),
      `description_snippet ${index} should preserve the location/role context`
    );
  });

  const manualRecord = buildJobRecord(
    dirtyInput,
    {
      id: "record-1",
      display: {
        title: "Manual Override Title",
        organization: "Climate Org",
        description: "Manual description"
      },
      manual_overrides: ["display.title", "display.description"],
      admin_notes: "Manual edits retained."
    },
    { context: "source_sync" }
  );
  assert.strictEqual(manualRecord.display.title, "Manual Override Title", "manual title override was overwritten");
  assert.strictEqual(manualRecord.display.description, "Manual description", "manual description override was overwritten");

  const repoRoot = path.resolve(__dirname, "..");
  const scriptsNeedingCanonicalHelper = [
    "scripts/public-jobs.js",
    "scripts/public-records.js",
    "scripts/generate-job-pages.js",
    "scripts/apply-admin-actions.js",
    "scripts/migrate-existing-job-fields.js",
    "scripts/backfill-normalized-jobs.js",
    "scripts/rebuild-records-from-pending.js"
  ];
  scriptsNeedingCanonicalHelper.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert(
      /canonical-job-shape/.test(content),
      `${relativePath} is missing canonical-job-shape usage`
    );
  });

  const scriptsThatMustNotOwnCleanup = [
    "scripts/apply-admin-actions.js",
    "scripts/migrate-existing-job-fields.js",
    "scripts/backfill-normalized-jobs.js",
    "scripts/rebuild-records-from-pending.js",
    "scripts/public-jobs.js",
    "scripts/generate-job-pages.js"
  ];
  const disallowedPatterns = [
    /normalizeDescription\(/,
    /buildFallbackDescription\(/,
    /hasMalformedDescriptionTemplate\(/
  ];
  scriptsThatMustNotOwnCleanup.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    disallowedPatterns.forEach((pattern) => {
      assert(
        !pattern.test(content),
        `${relativePath} still contains stale local cleanup logic: ${pattern}`
      );
    });
  });

  console.log(JSON.stringify({
    ok: true,
    checked_scripts: scriptsNeedingCanonicalHelper,
    sync_title: syncShape.title,
    snippet: syncShape.description_snippet
  }, null, 2));
}

main();
