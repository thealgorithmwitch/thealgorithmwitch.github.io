const assert = require("assert");
const {
  assertApprovedTalentWritten,
  ensureRenderableTalentShape,
  normalizeApprovedTalentProfile
} = require("./fetch-approved-talent");
const { mergePreservingClean } = require("./approved-export-utils");

function main() {
  const current = {
    id: "cassandre-arkema",
    name: "Cassandre Arkema",
    short_bio: "Climate jobs builder and editor",
    public_contact: "hello@example.com",
    public_visibility: true,
    featured: true,
    published: true,
    status: "published"
  };

  const approvedRecord = normalizeApprovedTalentProfile({
    name: "Cassandre Arkema",
    email: "cassandre.arkema@gmail.com",
    current_role: "Founder",
    location: "Chicago, IL",
    status: "active",
    public_visibility: "",
    featured: "",
    raw_json: JSON.stringify({
      short_bio: "",
      public_contact: "",
      approved_by: "Admin Review"
    })
  });

  assert.strictEqual(approvedRecord.name, "Cassandre Arkema");
  assert.strictEqual(approvedRecord.id, "cassandre.arkema@gmail.com");
  assert.strictEqual(approvedRecord.public_visibility, true);
  assert.strictEqual(approvedRecord.featured, true);
  assert.strictEqual(approvedRecord.status, "active");

  const merged = mergePreservingClean(current, ensureRenderableTalentShape(approvedRecord));

  assert.strictEqual(merged.short_bio, "Climate jobs builder and editor", "clean existing bio should be preserved");
  assert.strictEqual(merged.public_contact, "hello@example.com", "existing contact should be preserved");
  assert.strictEqual(merged.public_visibility, true, "profile should remain visible");
  assert.strictEqual(merged.featured, true, "featured should default to true");
  assert.strictEqual(merged.status, "active", "approved profiles should export as active");
  assert.strictEqual(merged.published, true, "profile should remain renderable");

  assert.doesNotThrow(() => {
    assertApprovedTalentWritten([approvedRecord], [merged]);
  });

  console.log(JSON.stringify({ ok: true, merged }, null, 2));
}

main();
