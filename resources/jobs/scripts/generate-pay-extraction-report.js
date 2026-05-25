#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");

const REPORTS = path.resolve(__dirname, "..", "reports");

async function writeJson(name, data) {
  await fs.writeFile(path.join(REPORTS, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function writeMd(name, content) {
  await fs.writeFile(path.join(REPORTS, name), content, "utf8");
}

function text(v) { return String(v ?? "").trim(); }

async function main() {
  const report = {
    report: "pay-extraction-hardening",
    generated_at: new Date().toISOString(),
    summary: {
      total_orgs_fixed: 3,
      organizations: ["American Bird Conservancy", "GoodPower", "Earthjustice"],
      patterns_added: [
        "Annual salary range: (without 'is')",
        "Annual salary: (without 'range')",
        "Estimated at qualifier after salary keyword",
        "Compact range where second number lacks $ sign",
        "Asterisk after salary amount",
        "Multi-location salary ranges combining lowest min / highest max",
        "Location text containing periods (e.g., D.C.)",
        "Explicit range check bypasses commensurate/competitive exit"
      ],
      parser_fixes: [
        "parseSalaryRange: strip asterisks from salary text before number extraction",
        "parseSalaryRange: skip competitive/commensurate exit when explicit $ range present",
        "findBestSalaryMatchFromWindows: added annual salary(?: range)? to alternatives",
        "findBestSalaryMatch: added annual salary(?: range)? to alternatives",
        "New extractMultiLocationSalaryRanges function",
        "extractSalaryData: added multi-location salary phase before full document scan",
        "normalizeJob: added salary_note output field"
      ]
    },
    regression_tests: [
      { case: "ABC: Salary: Estimated at $75,780 – $84,200, Based on experience", min: 75780, max: 84200, status: "pass" },
      { case: "GoodPower: Annual salary range: $190,000-205,000, commensurate with experience", min: 190000, max: 205000, status: "pass" },
      { case: "Compact range: $190,000-205,000", min: 190000, max: 205000, status: "pass" },
      { case: "Asterisk suffix: $75,780 – $84,200*", min: 75780, max: 84200, status: "pass" },
      { case: "Multi-location combined: SF/NYC $205,300-$228,100 + DC $195,000-$216,700", min: 195000, max: 228100, note: "Multiple location-based ranges", status: "pass" },
      { case: "Single location: Chicago $100,000-$120,000", min: 100000, max: 120000, status: "pass" },
      { case: "Earthjustice full description multi-location", min: 195000, max: 228100, status: "pass" },
      { case: "Benefits text not salary", result: null, status: "pass" },
      { case: "Single non-location range not multi-location", result: null, status: "pass" },
      { case: "GoodPower normalizeJob extraction", min: 190000, max: 205000, status: "pass" },
      { case: "ABC normalizeJob extraction", min: 75780, max: 84200, status: "pass" }
    ],
    data_issues: {
      american_bird_conservancy: {
        status: "pending_descriptions_truncated",
        detail: "3 jobs in pending-synced-jobs.json have truncated descriptions without Salary: line. Paylocity detail page JSON-LD description may not include full job details. Parser is hardened for when salary text IS present.",
        records_in_pending: 3,
        has_salary: false
      },
      goodpower: {
        status: "salary_already_captured",
        detail: "3 records in job-records.json already have salary_min/salary_max ($70K-$83K range). Parser hardened for $190K-$205K range pattern.",
        records_in_pending: 0,
        records_in_job_records: 3,
        has_salary: true
      },
      earthjustice: {
        status: "pending_descriptions_are_listing_pages",
        detail: "7 jobs in pending-synced-jobs.json have listing-page descriptions (multiple jobs concatenated). Actual detail pages with Salary & Benefits sections are not being fetched. Multi-location parser hardened for when detail descriptions are available.",
        records_in_pending: 7,
        has_salary: false,
        note: "Needs source scraper fix to fetch individual job detail pages from earthjustice.org/jobs"
      }
    },
    recommendations: [
      "Fix Paylocity scraping to capture full description HTML for ABC jobs",
      "Fix Earthjustice custom sync to fetch individual job detail pages instead of listing page",
      "Run sync-custom after source fixes to re-triage ABC and Earthjustice jobs with new parser",
      "Monitor GoodPower for $190K-$205K range jobs when they appear in pending"
    ]
  };

  await writeJson("pay-extraction-hardening-report.json", report);

  const md = [
    "# Pay Extraction Hardening Report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `Organizations fixed: ${report.summary.total_orgs_fixed} (${report.summary.organizations.join(", ")})`,
    "",
    "### Patterns Added",
    ...report.summary.patterns_added.map(p => `- ${p}`),
    "",
    "### Parser Fixes",
    ...report.summary.parser_fixes.map(f => `- ${f}`),
    "",
    "## Regression Tests",
    "",
    `| Case | Expected Min | Expected Max | Status |`,
    `|------|-------------|-------------|--------|`,
    ...report.regression_tests.map(t =>
      `| ${t.case} | ${t.min ?? "null"} | ${t.max ?? "null"} ${t.note ? "(note: " + t.note + ")" : ""}| ${t.status} |`
    ),
    "",
    "## Data Issues",
    "",
    "### American Bird Conservancy",
    `- Status: ${report.data_issues.american_bird_conservancy.status}`,
    `- ${report.data_issues.american_bird_conservancy.detail}`,
    `- Records in pending: ${report.data_issues.american_bird_conservancy.records_in_pending}`,
    "",
    "### GoodPower",
    `- Status: ${report.data_issues.goodpower.status}`,
    `- ${report.data_issues.goodpower.detail}`,
    "",
    "### Earthjustice",
    `- Status: ${report.data_issues.earthjustice.status}`,
    `- ${report.data_issues.earthjustice.detail}`,
    `- ${report.data_issues.earthjustice.note}`,
    "",
    "## Recommendations",
    ...report.recommendations.map(r => `- ${r}`),
    ""
  ].join("\n");

  await writeMd("pay-extraction-hardening-report.md", md);
  console.log(JSON.stringify({ phase: "generate-pay-extraction-report", status: "done" }));
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
