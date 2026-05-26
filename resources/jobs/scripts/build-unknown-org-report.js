const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const pending = require(path.join(ROOT, "pending-synced-jobs.json"));

const ei = pending.filter(r => r.source_id === "elemental-impact");
const recovered = ei.filter(r => r.organization !== "Unknown organization" && r.organization !== "Unknown");

const report = {
  generated_at: new Date().toISOString(),
  total_elemental_impact_records: ei.length,
  records_with_recovered_org: recovered.length,
  recovered_orgs: [...new Set(recovered.map(r => r.organization))],
  details: recovered.map(r => ({ id: r.id, title: r.title, organization: r.organization, bucket: r.triage_bucket, url: (r.apply_url || r.source_url || "").slice(0, 80) })),
  ats_rules_applied: [
    { pattern: "jobs.ashbyhq.com/(org-name)", example: "jobs.ashbyhq.com/weave-grid -> WeaveGrid", recovered: recovered.filter(r => r.organization === "Weave Grid").length },
    { pattern: "recruiting.ultipro.com/TENANTCODE/...", example: "recruiting2.ultipro.com/PRO1047PROTI -> Proterra", recovered: recovered.filter(r => r.organization === "Proterra").length }
  ]
};

let md = "# Unknown Organization Recovery Report\n\n";
md += "**Generated:** " + report.generated_at + "\n\n";
md += "## Summary\n\n";
md += "| Metric | Value |\n|---|---|\n";
md += "| Elemental Impact pending records | " + report.total_elemental_impact_records + " |\n";
md += "| Records with recovered org | " + report.records_with_recovered_org + " |\n";
md += "| Unique orgs recovered | " + report.recovered_orgs.length + " |\n\n";

md += "## ATS URL to Org Rules Applied\n\n";
md += "| Pattern | Example | Records |\n|---|---|---|\n";
for (const rule of report.ats_rules_applied) {
  md += "| " + rule.pattern + " | " + rule.example + " | " + rule.recovered + " |\n";
}

md += "\n## Recovered Records\n\n";
md += "| ID | Title | Organization | Bucket |\n|---|---|---|---|\n";
for (const d of report.details) {
  md += "| " + d.id + " | " + d.title + " | " + d.organization + " | " + d.bucket + " |\n";
}

const reportsDir = path.join(ROOT, "reports");
fs.writeFileSync(path.join(reportsDir, "unknown-organization-recovery-report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(reportsDir, "unknown-organization-recovery-report.md"), md);
console.log("Wrote unknown-organization-recovery-report (JSON+MD)");
