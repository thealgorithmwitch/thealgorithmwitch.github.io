const assert = require("assert");
const {
  assertApprovedEmployersWritten,
  ensureRenderableEmployerShape,
  normalizeApprovedEmployer
} = require("./fetch-approved-employers");
const { mergePreservingClean } = require("./approved-export-utils");

function main() {
  const current = {
    id: "fresh-roles",
    organization_name: "Fresh Roles",
    description: "Curated climate jobs board.",
    featured: true,
    public_visibility: true,
    status: "published",
    published: true
  };

  const approvedRecord = normalizeApprovedEmployer({
    organization_name: "Fresh Roles",
    website: "https://thealgorithmwitch.com/jobs",
    status: "active",
    public_visibility: "",
    featured: "",
    raw_json: JSON.stringify({
      description: "",
      approved_by: "Admin Review"
    })
  });

  assert.strictEqual(approvedRecord.organization_name, "Fresh Roles");
  assert.strictEqual(approvedRecord.public_visibility, true);
  assert.strictEqual(approvedRecord.featured, true);
  assert.strictEqual(approvedRecord.status, "active");

  const merged = mergePreservingClean(current, ensureRenderableEmployerShape(approvedRecord));

  assert.strictEqual(merged.description, "Curated climate jobs board.", "existing clean description should be preserved");
  assert.strictEqual(merged.public_visibility, true);
  assert.strictEqual(merged.featured, true);
  assert.strictEqual(merged.status, "active");
  assert.strictEqual(merged.published, true);

  assert.doesNotThrow(() => {
    assertApprovedEmployersWritten([approvedRecord], [merged]);
  });

  console.log(JSON.stringify({ ok: true, merged }, null, 2));
}

main();
