const path = require("path");
const { readJson } = require("./job-utils");
const { BLOCKED_SOURCE_RULES } = require("./blocked-source-utils");

const ROOT = path.resolve(__dirname, "..");

const FILES_TO_CHECK = [
  path.join(ROOT, "sources.json"),
  path.join(ROOT, "search-sources.json"),
  path.join(ROOT, "source-discovery-candidates.json"),
  path.join(ROOT, "pending-synced-jobs.json"),
  path.join(ROOT, "jobs.json"),
  path.join(ROOT, "job-records.json")
];

const FIELD_HINTS = new Set([
  "id",
  "name",
  "organization",
  "source_name",
  "source",
  "provider",
  "url",
  "source_url",
  "apply_url",
  "known_careers_url",
  "candidate_urls",
  "query",
  "notes"
]);

function stringify(value) {
  return String(value || "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPath(parts) {
  return parts.length ? parts.join(".") : "root";
}

function collectValues(value, parts = [], output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectValues(entry, [...parts, `[${index}]`], output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      if (FIELD_HINTS.has(key)) {
        collectValues(entry, [...parts, key], output);
      }
    });
    return output;
  }
  const text = stringify(value);
  if (text) {
    output.push({
      path: buildPath(parts),
      value: text
    });
  }
  return output;
}

async function main() {
  const violations = [];

  for (const filePath of FILES_TO_CHECK) {
    const payload = await readJson(filePath, null);
    const values = collectValues(payload);

    for (const entry of values) {
      for (const rule of BLOCKED_SOURCE_RULES) {
        if (rule.pattern.test(entry.value)) {
          violations.push({
            file: path.relative(ROOT, filePath),
            blocked_source: rule.id,
            path: entry.path,
            value: entry.value
          });
        }
      }
    }
  }

  if (violations.length) {
    console.error("[jobs:check-blocked-sources] Blocked source references found:");
    for (const violation of violations) {
      console.error(
        `- file=${violation.file} blocked_source=${violation.blocked_source} path=${violation.path} value=${violation.value}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("[jobs:check-blocked-sources] No blocked source references found in active config or pending files.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:check-blocked-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
