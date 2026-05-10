const assert = require("assert");
const applyAdminActions = require("./apply-admin-actions");

assert.strictEqual(typeof applyAdminActions.main, "function");
assert.strictEqual(typeof applyAdminActions.assertSelectedPublishSanitizerHelpers, "function");

applyAdminActions.assertSelectedPublishSanitizerHelpers();

const helpers = applyAdminActions.selectedPublishSanitizerHelpers || {};
[
  "buildDescriptionSnippet",
  "buildFallbackDescription",
  "hasMalformedDescriptionTemplate",
  "hasUsableDescription",
  "normalizeDescription",
  "sanitizePublishSelectedJob",
  "stringifySafe"
].forEach((name) => {
  assert.strictEqual(
    typeof helpers[name],
    "function",
    `${name} should be exported as a function from apply-admin-actions`
  );
});

console.log("[test-apply-admin-actions-load] selected publish sanitizer helpers verified");
