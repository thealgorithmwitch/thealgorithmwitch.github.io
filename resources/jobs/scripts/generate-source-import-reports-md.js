#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");

const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

function text(v) { return String(v ?? "").trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function fmtTable(rows = [], cols = []) {
  if (!rows.length) return "_None_";
  const h = `| ${cols.join(" | ")} |`;
  const d = `| ${cols.map(() => "---").join(" | ")} |`;
  const b = rows.map(r => `| ${cols.map(c => text(r[c]).replace(/\n/g, " ")).join(" | ")} |`);
  return [h, d, ...b].join("\n");
}

async function readJson(name) {
  try { return JSON.parse(await fs.readFile(path.join(REPORTS, name), "utf8")); }
  catch { return null; }
}

async function generateManualImportMd() {
  const r = await readJson("manual-editorial-source-import.json");
  if (!r) return "";
  return [
    "# Manual Editorial Source Import Report",
    "",
    `Generated: ${r.generated_at || "?"}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Sources Before", value: r.summary.total_sources_before },
      { metric: "Sources Added", value: r.summary.total_added },
      { metric: "URLs Updated", value: r.summary.total_updated_urls },
      { metric: "Sources After", value: r.summary.total_sources_after },
    ], ["metric", "value"]),
    "",
    "## New Sources Added",
    "",
    fmtTable(
      arr(r.additions).map(o => ({
        id: o.id, org: o.organization, url: o.source_url,
        classification: o.classification, manual_review: o.manual_review_created ? "yes" : "no"
      })),
      ["id", "org", "url", "classification", "manual_review"]
    ),
    "",
    "## URL Updates",
    "",
    fmtTable(
      arr(r.url_updates).map(u => ({
        source: u.id, new_url: u.new_url
      })),
      ["source", "new_url"]
    ),
    "",
    "## Notes",
    "",
    ...arr(r.notes).map(n => `- ${n}`),
    ""
  ].join("\n");
}

async function generateMissingVerificationMd() {
  const r = await readJson("missing-source-verification.json");
  if (!r) return "";
  return [
    "# Missing Source Verification Report",
    "",
    `Generated: ${r.generated_at || "?"}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Orgs Verified", value: r.summary.total_orgs_verified },
      { metric: "ATS Detected", value: r.summary.ats_detected },
      { metric: "Manual Editorial", value: r.summary.manual_editorial },
      { metric: "Manual Review Fallback Created", value: r.summary.manual_review_fallback },
      { metric: "Pending Candidates Created", value: r.summary.pending_candidates_created },
    ], ["metric", "value"]),
    "",
    `**Recommended Next Step:** ${r.summary.recommended_next_step}`,
    "",
    "## Organization Details",
    "",
    fmtTable(
      arr(r.organizations).slice(0, 50).map(o => ({
        org: o.organization,
        url: o.source_url,
        ats: o.ats_detected ? "yes" : "no",
        parser: o.parser,
        classification: o.classification,
        fetch_status: o.fetch_status,
        manual_review: o.manual_review_fallback_created ? "yes" : "no",
        pending: o.pending_candidates_created ? "yes" : "no",
        next_step: o.recommended_next_step
      })),
      ["org", "url", "ats", "parser", "classification", "fetch_status", "manual_review", "pending", "next_step"]
    ),
    ""
  ].join("\n");
}

async function main() {
  const [manualMd, missingMd] = await Promise.all([
    generateManualImportMd(),
    generateMissingVerificationMd()
  ]);
  await Promise.all([
    manualMd ? fs.writeFile(path.join(REPORTS, "manual-editorial-source-import.md"), manualMd, "utf8") : Promise.resolve(),
    missingMd ? fs.writeFile(path.join(REPORTS, "missing-source-verification.md"), missingMd, "utf8") : Promise.resolve(),
  ]);
  console.log(JSON.stringify({
    phase: "generate-source-import-reports-md",
    reports: ["manual-editorial-source-import.md", "missing-source-verification.md"]
  }));
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
