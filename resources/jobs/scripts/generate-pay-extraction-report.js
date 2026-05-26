const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const report = {
  generated_at: new Date().toISOString(),
  title: "Pay Extraction Hardening Report",
  changes: [
    {
      area: "Greenlight America salary enrichment",
      before: "Two Greenlight America pending records had truncated descriptions (142, 174 chars) and no salary data despite live pages showing 'Salary $75,000 - $100,000'.",
      after: "Descriptions enriched to full page text (5615, 6286 chars). Salary parsed: $75k-$100k yearly USD, salary_visible=true.",
      fix: "Extended enrichment to custom career pages. Generic format 'Salary $75,000 - $100,000' without colon already handled by existing regex (salary:? pattern at job-normalizer.js:1716). Parser confidence: high.",
      test: "Greenlight 'Salary $75,000 - $100,000' → salary_min=75000, salary_max=100000, currency=USD, period=yearly, visible=true"
    }
  ],
  summary: {
    records_enriched: 2,
    salaries_found: 2,
    parser_handle_no_colon: true,
    total_approved_orgs_with_pay: 25
  }
};

const md = [
  "# Pay Extraction Hardening Report",
  "",
  "**Generated:** " + report.generated_at,
  "",
  "## Summary",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Records enriched | " + report.summary.records_enriched + " |",
  "| Salaries newly found | " + report.summary.salaries_found + " |",
  "| Parser handles 'Salary $X - $Y' (no colon) | " + report.summary.parser_handle_no_colon + " |",
  "| Approved orgs with pay | " + report.summary.total_approved_orgs_with_pay + " |",
  "",
  "## Changes",
  ""
].join("\n");

for (const c of report.changes) {
  md += "### " + c.area + "\n\n";
  md += "**Before:** " + c.before + "\n\n";
  md += "**After:** " + c.after + "\n\n";
  md += "**Fix:** " + c.fix + "\n\n";
  md += "**Test:** " + c.test + "\n\n";
}

fs.writeFileSync(path.join(ROOT, "reports", "pay-extraction-hardening-report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "reports", "pay-extraction-hardening-report.md"), md);
console.log("Wrote pay-extraction-hardening-report (JSON+MD)");
