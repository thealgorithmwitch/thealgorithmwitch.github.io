const assert = require("assert");
const {
  mergeTalentProfile,
  normalizeApprovedTalentProfile
} = require("./fetch-approved-talent");

function main() {
  const current = {
    id: "cassandre-arkema",
    name: "Cassandre Arkema",
    short_bio: "Climate jobs builder and editor",
    public_contact: "hello@example.com",
    public_visibility: true,
    featured: true,
    published: true
  };

  const approvedRecord = normalizeApprovedTalentProfile({
    id: "cassandre-arkema",
    name: "Cassandre Arkema",
    status: "approved",
    raw_json: JSON.stringify({
      id: "cassandre-arkema",
      name: "Cassandre Arkema",
      short_bio: "",
      public_contact: "",
      approved_by: "Admin Review"
    })
  });

  const merged = mergeTalentProfile(current, approvedRecord);

  assert.strictEqual(merged.short_bio, "Climate jobs builder and editor", "clean existing bio should be preserved");
  assert.strictEqual(merged.public_contact, "hello@example.com", "existing contact should be preserved");
  assert.strictEqual(merged.public_visibility, true, "existing public visibility should be preserved");
  assert.strictEqual(merged.featured, true, "existing featured flag should be preserved");
  assert.strictEqual(merged.approved_by, "Admin Review", "approved metadata should be merged");
  assert.strictEqual(merged.status, "published", "approved profiles must export as published");
  assert.strictEqual(merged.public_visibility, true, "approved profiles must remain public");
  assert.strictEqual(merged.published, true, "profile should remain published");

  console.log(JSON.stringify({
    ok: true,
    merged
  }, null, 2));
}

main();
