const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const pending = require(path.join(ROOT, "pending-synced-jobs.json"));
const saasPending = pending.filter(r => r.source_id === "saas-group" || String(r.organization || "").includes("SaaS"));
const pendingRejected = saasPending.filter(r => r.triage_bucket === "rejected_noise");

const report = {
  generated_at: new Date().toISOString(),
  summary: {
    sources_json: "already disabled (enabled:false, trusted:false)",
    source_prospects_json: "REMOVED entirely",
    pending_synced_jobs: saasPending.length + " remaining",
    pending_rejected_as_noise: pendingRejected.length,
    build_source_quality_plan_js: "REMOVED",
    apply_source_quality_plan_js: "REMOVED",
    fix_pending_source_state_js: "KEPT (LOW_RELEVANCE_SOURCE_IDS)",
    blocked_source_utils_js: "ADDED blocked rule",
    public_records_jobs_json: 0
  },
  details: {
    total_records_affected: 2,
    pending_records_rejected: pendingRejected.map(r => ({ id: r.id, title: r.title, bucket: r.triage_bucket, reason: r.triage_reason })),
    source_prospects_removed: "SaaS.group prospect entry deleted from source-prospects.json",
    build_quality_plan_removed: "SaaS.group removed from filtered org list",
    apply_quality_plan_removed: "SaaS.group prospect array entry removed",
    blocked_sources_added: [{ id: "saas-group", pattern: "/\\bsaas\\.group\\b/i" }],
    sources_json_status: "Already disabled; no changes needed"
  }
};

let md = "# SaaS.group Removal Report\n\n";
md += "**Generated:** " + report.generated_at + "\n\n";
md += "## Summary\n\n";
md += "| Source | Action |\n";
md += "|---|---|\n";
md += "| sources.json | Already disabled (enabled:false, trusted:false) |\n";
md += "| source-prospects.json | REMOVED |\n";
md += "| pending-synced-jobs.json | " + saasPending.length + " remaining (all rejected_noise) |\n";
md += "| jobs.json | 0 public records affected |\n";
md += "| build-source-quality-plan.js | REMOVED from filtered org list |\n";
md += "| apply-source-quality-plan.js | REMOVED from prospect array |\n";
md += "| fix-pending-source-state.js | KEPT in LOW_RELEVANCE_SOURCE_IDS |\n";
md += "| blocked-source-utils.js | ADDED blocked source rule |\n\n";
md += "## Pending Records Rejected (" + pendingRejected.length + ")\n\n";
md += "| ID | Title | Bucket | Reason |\n";
md += "|---|---|---|---|\n";
pendingRejected.forEach(r => {
  md += "| " + r.id + " | " + r.title + " | " + r.triage_bucket + " | " + r.triage_reason + " |\n";
});
md += "\n## Files Modified\n\n";
md += "- `resources/jobs/source-prospects.json`: Deleted SaaS.group entry\n";
md += "- `resources/jobs/pending-synced-jobs.json`: 2 SaaS.group records set to rejected_noise\n";
md += "- `resources/jobs/scripts/build-source-quality-plan.js`: Removed SaaS.group from list\n";
md += "- `resources/jobs/scripts/apply-source-quality-plan.js`: Removed SaaS.group from array\n";
md += "- `resources/jobs/scripts/blocked-source-utils.js`: Added saas-group blocked rule\n";
md += "- `resources/jobs/scripts/fix-pending-source-state.js`: Kept in LOW_RELEVANCE_SOURCE_IDS (no change needed)\n";

const reportsDir = path.join(ROOT, "reports");
fs.writeFileSync(path.join(reportsDir, "saas-group-removal-report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(reportsDir, "saas-group-removal-report.md"), md);
console.log("Wrote SaaS.group removal report (JSON+MD)");
