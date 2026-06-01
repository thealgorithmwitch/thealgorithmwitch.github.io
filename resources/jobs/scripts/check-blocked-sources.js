const path = require("path");
const fs = require("fs/promises");
const { readJson } = require("./job-utils");
const { BLOCKED_SOURCE_RULES } = require("./blocked-source-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

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

async function collectHistoricalReportWarnings() {
  let entries = [];
  try {
    entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".json", ".md", ".txt"].includes(ext)) continue;
    const filePath = path.join(REPORTS_DIR, entry.name);
    let contents = "";
    try {
      contents = await fs.readFile(filePath, "utf8");
    } catch (_error) {
      continue;
    }
    for (const rule of BLOCKED_SOURCE_RULES) {
      const matches = contents.match(new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`));
      if (!matches || !matches.length) continue;
      warnings.push({
        file: path.relative(ROOT, filePath),
        blocked_source: rule.id,
        mention_count: matches.length
      });
    }
  }
  return warnings;
}

async function checkBlockedSources() {
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

  const historicalWarnings = await collectHistoricalReportWarnings();
  return {
    violations,
    historicalWarnings
  };
}

async function main() {
  const writeMode = process.argv.includes("--write") || process.argv.includes("-w");
  const { violations, historicalWarnings } = await checkBlockedSources();

  if (writeMode) {
    const { readJson, writeJson, SOURCES_FILE } = require("./job-utils");
    const { isBlockedSourceEntry, getBlockedSourceRuleForEntry, stringify: bsStringify } = require("./blocked-source-utils");
    const rawData = await readJson(SOURCES_FILE, { sources: [] });
    const sources = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.sources) ? rawData.sources : []);
    if (!sources.length && rawData && (Array.isArray(rawData) || Array.isArray(rawData?.sources))) {
      console.log("[jobs:check-blocked-sources] sources.json is empty. Nothing to repair.");
      return;
    }
    const activeBlocked = sources.filter((entry) => {
      const enabled = entry.enabled !== false || entry.custom_sync_enabled === true;
      return enabled && isBlockedSourceEntry(entry);
    });
    if (activeBlocked.length) {
      console.error(`[jobs:check-blocked-sources] Disabling ${activeBlocked.length} active blocked source(s):`);
      for (const entry of activeBlocked) {
        const rule = getBlockedSourceRuleForEntry(entry);
        console.error(`  - ID: ${bsStringify(entry.id || entry.source_id || '(no-id)')}`);
        console.error(`    Name: ${bsStringify(entry.organization || entry.name || '(no-name)')}`);
        console.error(`    URL: ${bsStringify(entry.source_url || entry.url || '(no-url)')}`);
        console.error(`    Reason: ${rule ? (rule.name || rule.description || '(unknown)') : '(no rule match)'}`);
        entry.enabled = false;
      }
      const payload = Array.isArray(rawData) ? sources : { ...rawData, sources };
      await writeJson(SOURCES_FILE, payload);
      console.error(`[jobs:check-blocked-sources] Disabled ${activeBlocked.length} blocked source(s).`);
    } else {
      console.log("[jobs:check-blocked-sources] No active blocked sources to disable.");
    }
    const remaining = sources.filter((entry) => {
      const enabled = entry.enabled !== false || entry.custom_sync_enabled === true;
      return enabled && isBlockedSourceEntry(entry);
    });
    if (remaining.length) {
      console.error(`[jobs:check-blocked-sources] ERROR: ${remaining.length} active blocked source(s) remain after repair.`);
      process.exitCode = 1;
      return;
    }
  } else if (violations.length) {
    console.error("[jobs:check-blocked-sources] Blocked source references found:");
    for (const violation of violations) {
      console.error(
        `- file=${violation.file} blocked_source=${violation.blocked_source} path=${violation.path} value=${violation.value}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("[jobs:check-blocked-sources] No blocked source references found in active config or data files.");
  if (historicalWarnings.length) {
    const totalMentions = historicalWarnings.reduce((sum, item) => sum + Number(item.mention_count || 0), 0);
    console.warn(
      `[jobs:check-blocked-sources] historical_blocked_mentions_warned=${totalMentions} historical_files=${historicalWarnings.length} (warning-only)`
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:check-blocked-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  FILES_TO_CHECK,
  checkBlockedSources,
  collectHistoricalReportWarnings
};
