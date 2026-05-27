#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const REPORTS_DIR = path.join(ROOT, "reports");
const NORMALIZER = path.join(ROOT, "scripts", "job-normalizer.js");

function readJson(fp) { return JSON.parse(fs.readFileSync(fp, "utf8")); }
function writeJson(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2) + "\n"); }

// UUID pattern to strip from descriptions
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UUID_FRAGMENT_PATTERN = /(?:^|\s|\()-?[0-9a-f]{3,8}-?\s*-?\s*[0-9a-f]{0,8}-?\s*-?\s*[0-9a-f]{0,8}-?\s*-?\s*[0-9a-f]{0,8}-?\s*-?\s*[0-9a-f]{0,12}\b/gi;
const UUID_BLOB_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[-\s]*[0-9a-f]{4,8}[-\s]*[0-9a-f]{4,8}[-\s]*[0-9a-f]{4,8}[-\s]*[0-9a-f]{4,12}/gi;

// The bad generic sentence pattern
const GENERIC_REMOTE_SENTENCE = /this position is listed\s+(?:in\s+.+?\s+)?and\s+a\s+(?:remote|hybrid|on-site)\s+role\.?/i;

function stripUuidBlobs(text) {
  if (!text) return text;
  let result = String(text);
  // Remove full UUIDs
  result = result.replace(UUID_PATTERN, "");
  // Remove UUID fragments with surrounding whitespace artifacts
  result = result.replace(UUID_FRAGMENT_PATTERN, "");
  // Remove the specific blob pattern seen in Advanced Energy United records
  result = result.replace(UUID_BLOB_PATTERN, "");
  // Clean up resulting whitespace
  result = result.replace(/\s{2,}/g, " ").replace(/\s+([.,;!?])/g, "$1").trim();
  return result;
}

function isGenericRemoteSentence(text) {
  return GENERIC_REMOTE_SENTENCE.test(String(text || "").trim());
}

function isTitleLocationIdBlob(text, title) {
  const t = String(text || "").trim();
  if (!t) return false;
  let cleaned = stripUuidBlobs(t);
  // Normalize parenthetical locations
  cleaned = cleaned.replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  const titleNorm = String(title || "").toLowerCase().trim();

  const metadataTokens = new Set([
    "remote", "hybrid", "on-site", "onsite", "usa", "united", "states", "austin",
    "tx", "us", "the", "and", "a", "an", "of", "in", "for", "with", "at", "is",
    "as", "this", "role", "position", "listed", "expression", "interest",
    "future", "employment", "opportunities"
  ]);

  // Remove title occurrences
  if (titleNorm) {
    const escaped = titleNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "gi"), "").trim();
  }

  // Split into words and count non-metadata
  const words = cleaned.split(/[\s-]+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
  const nonMetadata = words.filter(w => !metadataTokens.has(w.toLowerCase()));
  return nonMetadata.length <= 1;
}

function cleanDescription(desc, title) {
  if (!desc) return "";
  let result = stripUuidBlobs(desc);
  // Remove the generic remote sentence
  result = result.replace(GENERIC_REMOTE_SENTENCE, "").trim();
  // If after cleaning it's a title/location blob, return empty
  if (isTitleLocationIdBlob(result, title)) return "";
  // If after cleaning it's just whitespace or very short, return empty
  if (!result || result.length < 20) return "";
  return result;
}

function main() {
  const report = {
    generated_at: new Date().toISOString(),
    advanced_energy_united_fixed: 0,
    other_rippling_records_cleaned: 0,
    generic_remote_sentences_removed: 0,
    details: []
  };

  // 1. Clean pending-synced-jobs.json
  const pending = readJson(PENDING_FILE);
  let pendingChanged = false;

  for (const job of pending) {
    const sid = String(job.source_id || "").toLowerCase();
    const title = String(job.title || "");
    let changed = false;

    // Fix description
    const oldDesc = String(job.description || "");
    const newDesc = cleanDescription(oldDesc, title);
    if (newDesc !== oldDesc) {
      job.description = newDesc;
      changed = true;
    }

    // Fix raw_description
    const oldRaw = String(job.raw_description || "");
    const newRaw = cleanDescription(oldRaw, title);
    if (newRaw !== oldRaw) {
      job.raw_description = newRaw;
      changed = true;
    }

    // Fix snippet
    const oldSnippet = String(job.description_snippet || job.summary || "");
    const newSnippet = cleanDescription(oldSnippet, title);
    if (newSnippet !== oldSnippet) {
      job.description_snippet = newSnippet;
      job.summary = newSnippet;
      changed = true;
    }

    if (changed) {
      pendingChanged = true;
      if (sid === "advanced-energy-united") {
        report.advanced_energy_united_fixed++;
        report.details.push({ id: job.id, title: job.title, type: "advanced-energy-united" });
      } else {
        report.other_rippling_records_cleaned++;
        report.details.push({ id: job.id, title: job.title, type: "other" });
      }
    }

    // Count generic remote sentences found
    if (isGenericRemoteSentence(oldDesc) || isGenericRemoteSentence(oldSnippet)) {
      report.generic_remote_sentences_removed++;
    }
  }

  if (pendingChanged) {
    writeJson(PENDING_FILE, pending);
    console.log(`Updated pending-synced-jobs.json`);
  }

  // 2. Also clean jobs.json if any published records have the same issues
  const jobs = readJson(JOBS_FILE);
  let jobsChanged = false;
  for (const job of jobs) {
    const oldDesc = String(job.description || "");
    const newDesc = cleanDescription(oldDesc, String(job.title || ""));
    if (newDesc !== oldDesc) {
      job.description = newDesc;
      jobsChanged = true;
    }
    const oldSnippet = String(job.description_snippet || job.summary || "");
    const newSnippet = cleanDescription(oldSnippet, String(job.title || ""));
    if (newSnippet !== oldSnippet) {
      job.description_snippet = newSnippet;
      job.summary = newSnippet;
      jobsChanged = true;
    }
  }
  if (jobsChanged) {
    writeJson(JOBS_FILE, jobs);
    console.log(`Updated jobs.json`);
  }

  // 3. Write report
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeJson(path.join(REPORTS_DIR, "rippling-summary-cleanup-report.json"), report);

  console.log(`\n=== Rippling Summary Cleanup Report ===`);
  console.log(`Advanced Energy United records fixed: ${report.advanced_energy_united_fixed}`);
  console.log(`Other Rippling records cleaned: ${report.other_rippling_records_cleaned}`);
  console.log(`Generic remote sentences removed: ${report.generic_remote_sentences_removed}`);
  console.log(`Total records affected: ${report.details.length}`);

  return report;
}

if (require.main === module) {
  main();
}

module.exports = { cleanDescription, isGenericRemoteSentence, stripUuidBlobs, isTitleLocationIdBlob };
