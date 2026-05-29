const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

async function runRootCauseAnalysis(options = {}) {
  const startedAt = new Date().toISOString();
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });

  const [pendingJobs, publicJobs, sources] = await Promise.all([
    readJson("pending-synced-jobs.json"),
    readJson("jobs.json"),
    readJson("sources.json")
  ]);

  const sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);

  // Get all jobs with rejected pay confidence
  const payBlockedJobs = pendingJobs.filter(j => j.pay_confidence === "rejected");

  const classificationCounts = {
    A_context_check_failed: 0, // Has valid salary data but description lacks "salary/pay/compensation" keywords
    B_false_positive_flagged: 0, // Flagged as coordinate/percentage/ATS field
    C_threshold_exceeded: 0, // Salary > 500k
    D_no_compensation_data: 0, // No salary data at all
    E_governance_threshold: 0, // Passed pay validation but quality score too low
    F_hourly_format_issues: 0, // Hourly salary not properly recognized
    G_currency_issues: 0 // Non-USD currencies
  };

  const byOrg = {};
  const bySource = {};

  payBlockedJobs.forEach(job => {
    const desc = String(job.description || job.raw_description || "").toLowerCase();
    const rawSalary = String(job.raw_salary || "");
    const salary = String(job.salary || "");
    const salaryMin = Number(job.salary_min || 0);
    const salaryMax = Number(job.salary_max || 0);
    const payRejectedReason = String(job.pay_rejection_reason || "");

    let classification = null;

    // Check for false positive flags
    if (payRejectedReason === "looks_like_coordinate" || payRejectedReason === "looks_like_percentage") {
      classification = "B_false_positive_flagged";
    }
    // Check for threshold exceeded
    else if (payRejectedReason === "exceeds_max_threshold_500k") {
      classification = "C_threshold_exceeded";
    }
    // Check if has valid salary data but no context in description
    else if ((salaryMin > 0 || salaryMax > 0 || salary || rawSalary) && !hasPayContext(desc)) {
      classification = "A_context_check_failed";
    }
    // Check if has salary data at all
    else if (!salaryMin && !salaryMax && !salary && !rawSalary) {
      classification = "D_no_compensation_data";
    }
    // Check for hourly
    else if (/hour|hr/i.test(salary)) {
      classification = "F_hourly_format_issues";
    }
    // Check for currency issues
    else if (/£|€|CA\$|CAD|C\$|A\$/i.test(salary)) {
      classification = "G_currency_issues";
    }

    if (!classification) classification = "D_no_compensation_data";

    classificationCounts[classification]++;

    const org = job.organization || "Unknown";
    if (!byOrg[org]) byOrg[org] = { blocked: 0, classifications: {} };
    byOrg[org].blocked++;
    byOrg[org].classifications[classification] = (byOrg[org].classifications[classification] || 0) + 1;

    const src = job.source_id || "Unknown";
    if (!bySource[src]) bySource[src] = { blocked: 0, classifications: {} };
    bySource[src].blocked++;
    bySource[src].classifications[classification] = (bySource[src].classifications[classification] || 0) + 1;
  });

  const totalBlocked = payBlockedJobs.length;

  // Calculate fixable counts
  const autoFixable = classificationCounts.A_context_check_failed + 
    classificationCounts.F_hourly_format_issues +
    classificationCounts.G_currency_issues;
  
  const requiresParserChanges = classificationCounts.B_false_positive_flagged + 
    classificationCounts.C_threshold_exceeded;

  // Build the report
  const report = {
    report_type: "pay-block-root-cause-analysis",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_pay_blocked: totalBlocked,
    classifications: classificationCounts,
    top_organizations_by_blocked: Object.entries(byOrg)
      .sort((a, b) => b[1].blocked - a[1].blocked)
      .slice(0, 15)
      .map(([org, data]) => ({
        organization: org,
        blocked: data.blocked,
        classifications: data.classifications
      })),
    top_sources_by_blocked: Object.entries(bySource)
      .sort((a, b) => b[1].blocked - a[1].blocked)
      .slice(0, 15)
      .map(([src, data]) => ({
        source: src,
        blocked: data.blocked,
        classifications: data.classifications
      })),
    auto_repair_potential: {
      jobs_fixable_by_context_check: classificationCounts.A_context_check_failed,
      jobs_fixable_by_hourly_format: classificationCounts.F_hourly_format_issues,
      jobs_fixable_by_currency: classificationCounts.G_currency_issues,
      total_auto_fixable: autoFixable,
      auto_fixable_pct: Math.round(autoFixable / totalBlocked * 100) + "%"
    },
    parser_changes_needed: {
      jobs_with_false_positives: classificationCounts.B_false_positive_flagged,
      jobs_over_threshold: classificationCounts.C_threshold_exceeded,
      total_parser_changes: requiresParserChanges
    },
    root_cause_determination: {
      primary_cause: "Context validation requires 'salary', 'pay', or 'compensation' keywords in job description text",
      description: "Jobs have valid salary_min/max values but are rejected because the full job text (description + raw_description + rawText) doesn't contain context keywords that indicate legitimate compensation data",
      highest_leverage_fix: "Option 1: Remove context check requirement when salary_min/max are already populated. Option 2: Add 'compensation' keyword detection to context list. Option 3: Skip pay validation when valid structured salary exists.",
      actionable: autoFixable > totalBlocked * 0.8
    }
  };

  const jsonPath = path.join(REPORTS_DIR, "pay-block-root-cause-analysis.json");
  await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const mdPath = path.join(REPORTS_DIR, "pay-block-root-cause-analysis.md");
  await fs.promises.writeFile(mdPath, generateMarkdownReport(report), "utf8");

  console.log(`[pay-block-root-cause] total=${totalBlocked} context_failed=${classificationCounts.A_context_check_failed} fixable=${autoFixable}`);
  return report;
}

function hasPayContext(text) {
  const contexts = ["salary", "pay", "compensation", "hiring range", "salary range"];
  return contexts.some(ctx => text.includes(ctx));
}

function generateMarkdownReport(report) {
  let md = `# Pay Block Root Cause Analysis\n\n`;
  md += `Generated: ${report.finished_at}\n\n`;

  md += `## Executive Summary\n\n`;
  md += `- **Total pay-blocked jobs:** ${report.total_pay_blocked}\n`;
  md += `- **Primary root cause:** ${report.root_cause_determination.primary_cause}\n`;
  md += `- **Jobs fixable without code changes:** ${report.auto_repair_potential.total_auto_fixable} (${report.auto_repair_potential.auto_fixable_pct})\n\n`;

  md += `## Classification Breakdown\n\n`;
  md += `| Classification | Count | Percentage |\n`;
  md += `|---|---|---|---|\n`;
  for (const [key, count] of Object.entries(report.classifications)) {
    const label = key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    const pct = Math.round(count / report.total_pay_blocked * 100);
    md += `| ${label} | ${count} | ${pct}% |\n`;
  }
  md += `\n`;

  md += `## Root Cause\n\n`;
  md += `### Problem\n\n`;
  md += `${report.root_cause_determination.description}\n\n`;

  md += `### Highest-Leverage Fix\n\n`;
  md += `**${report.root_cause_determination.highest_leverage_fix}**\n\n`;

  md += `## Top Organizations by Blocked Count\n\n`;
  md += `| Organization | Blocked | Context Failed | No Data | Other |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const org of report.top_organizations_by_blocked) {
    const c = org.classifications;
    const contextFail = c.A_context_check_failed || 0;
    const noData = c.D_no_compensation_data || 0;
    const other = Object.values(c).reduce((s, v) => s + v, 0) - contextFail - noData;
    md += `| ${org.organization} | ${org.blocked} | ${contextFail} | ${noData} | ${other} |\n`;
  }
  md += `\n`;

  return md;
}

async function readJson(filename) {
  try {
    const raw = await fs.promises.readFile(path.join(ROOT, filename), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

module.exports = { runRootCauseAnalysis };

if (require.main === module) {
  runRootCauseAnalysis({}).catch(err => {
    console.error(`[pay-block-root-cause-analysis] Failed: ${err.message}`);
    process.exitCode = 1;
  });
}