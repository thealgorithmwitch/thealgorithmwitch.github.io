const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

async function generateSystemHealthDashboard(options = {}) {
  const startedAt = new Date().toISOString();
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });

  // Read core data
  const [publicJobs, pendingJobs, jobRecords, sources] = await Promise.all([
    readJson("jobs.json"),
    readJson("pending-synced-jobs.json"), 
    readJson("job-records.json"),
    readJson("sources.json")
  ]);

  const sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);

  // Read latest reports if available
  let govReport = {}, scorecardReport = {}, payReport = {};
  try {
    govReport = JSON.parse(await fs.promises.readFile(path.join(REPORTS_DIR, "publication-governance-latest.json"), "utf8"));
  } catch(e) {}
  try {
    scorecardReport = JSON.parse(await fs.promises.readFile(path.join(REPORTS_DIR, "source-quality-scorecard.json"), "utf8"));
  } catch(e) {}
  try {
    payReport = JSON.parse(await fs.promises.readFile(path.join(REPORTS_DIR, "pending-pay-analysis.json"), "utf8"));
  } catch(e) {}

  // PUBLIC SECTION METRICS
  const publicWithPay = publicJobs.filter(j => {
    const sal = String(j.salary || "");
    const hasMinMax = j.salary_min != null && j.salary_min > 0;
    const hasCurr = /\$|USD|EUR|GBP|CA\$|£|€/.test(sal) || /\d[\d,]*/.test(sal);
    return hasMinMax || hasCurr;
  }).length;
  
  const publicWithoutPay = publicJobs.length - publicWithPay;
  
  // Duplicate detection in public jobs
  const publicIds = new Set();
  let publicDuplicates = 0;
  publicJobs.forEach(j => {
    const idStr = String(j.id);
    if (publicIds.has(idStr)) publicDuplicates++;
    publicIds.add(idStr);
  });
  
  // Closed jobs in public (should be 0 with proper guards)
  const closedStatuses = new Set(["archived", "closed", "rejected", "not_found", "access_denied"]);
  const publicClosed = publicJobs.filter(j => closedStatuses.has(String(j.status || "").toLowerCase())).length;
  
  // Archive violations (public jobs that match archived fingerprints)
  const { loadArchiveRecords, guardIncoming } = require("./archive-fingerprint-guard");
  const archiveRecords = loadArchiveRecords();
  const { blocked: archiveBlocked } = guardIncoming(publicJobs, archiveRecords);
  const archiveViolations = archiveBlocked.length;

  // Quality score distribution from governance report
  const qualityDist = govReport.quality_score_distribution || {};
  
  // PENDING SECTION METRICS
  const pendingTotal = pendingJobs.length;
  
  // Pending with missing description (very short or placeholder)
  const pendingMissingDesc = pendingJobs.filter(j => {
    const desc = String(j.description || j.raw_description || "");
    return desc.length < 30 || 
           desc.toLowerCase().includes("description not available") ||
           desc.toLowerCase().includes("see website for details");
  }).length;
  
  // Pending with pay issues (from pay analysis)
  const pendingWithPayIssues = payReport.total_pay_blocked || 0;
  
  // Pending requiring manual review (from governance)
  const pendingManualReview = govReport.manual_approval_required || 0;
  
  // SOURCES SECTION METRICS
  const highestQuality = scorecardReport.top_10_highest_quality || [];
  const lowestQuality = scorecardReport.top_10_lowest_quality || [];

  // Build dashboard
  const dashboard = {
    report_type: "system-health-dashboard",
    generated_at: startedAt,
    data_as_of: {
      public_jobs: publicJobs.length,
      pending_jobs: pendingJobs.length,
      total_records: jobRecords.length,
      sources_configured: sourcesList.length
    },
    public: {
      total_jobs: publicJobs.length,
      jobs_with_pay: publicWithPay,
      jobs_without_pay: publicWithoutPay,
      duplicate_count: publicDuplicates,
      closed_job_count: publicClosed,
      archive_violation_count: archiveViolations,
      quality_score_distribution: qualityDist
    },
    pending: {
      total_jobs: pendingTotal,
      missing_description_count: pendingMissingDesc,
      pay_issues_count: pendingWithPayIssues,
      manual_review_required_count: pendingManualReview
    },
    sources: {
      highest_quality: highestQuality,
      lowest_quality: lowestQuality,
      summary: scorecardReport.tier_summary || {},
      recommendations: scorecardReport.by_recommendation || {}
    },
    alerts: []
  };

  // Generate alerts based on thresholds
  if (publicWithoutPay > publicJobs.length * 0.1) { // >10% missing pay
    dashboard.alerts.push({
      level: "warning",
      message: `${publicWithoutPay} public jobs (${Math.round(publicWithoutPay/publicJobs.length*100)}%) lack compensation data`,
      section: "public"
    });
  }
  
  if (publicClosed > 0) {
    dashboard.alerts.push({
      level: "error",
      message: `${publicClosed} closed/archived jobs found in public board`,
      section: "public"
    });
  }
  
  if (archiveViolations > 0) {
    dashboard.alerts.push({
      level: "error",
      message: `${archiveViolations} public jobs violate archive fingerprint guard`,
      section: "public"
    });
  }
  
  if (pendingMissingDesc > pendingTotal * 0.2) { // >20% missing description
    dashboard.alerts.push({
      level: "warning",
      message: `${pendingMissingDesc} pending jobs (${Math.round(pendingMissingDesc/pendingTotal*100)}%) have missing or placeholder descriptions`,
      section: "pending"
    });
  }
  
  if (pendingWithPayIssues > pendingTotal * 0.5) { // >50% pay issues
    dashboard.alerts.push({
      level: "warning",
      message: `${pendingWithPayIssues} pending jobs (${Math.round(pendingWithPayIssues/pendingTotal*100)}%) have pay extraction issues`,
      section: "pending"
    });
  }

  const jsonPath = path.join(REPORTS_DIR, "system-health-dashboard.json");
  await fs.promises.writeFile(jsonPath, JSON.stringify(dashboard, null, 2) + "\n", "utf8");

  const mdPath = path.join(REPORTS_DIR, "system-health-dashboard.md");
  await fs.promises.writeFile(mdPath, generateDashboardMarkdown(dashboard), "utf8");

  console.log(`[system-health-dashboard] generated: public=${publicJobs.length} pending=${pendingJobs.length} sources=${sourcesList.length}`);
  return dashboard;
}

function generateDashboardMarkdown(dashboard) {
  let md = `# System Health Dashboard\n\n`;
  md += `Generated: ${dashboard.generated_at}\n\n`;
  md += `## Data Freshness\n\n`;
  md += `- **Public jobs:** ${dashboard.data_as_of.public_jobs}\n`;
  md += `- **Pending jobs:** ${dashboard.data_as_of.pending_jobs}\n`;
  md += `- **Total records:** ${dashboard.data_as_of.total_records}\n`;
  md += `- **Sources configured:** ${dashboard.data_as_of.sources_configured}\n\n`;

  md += `## PUBLIC BOARD HEALTH\n\n`;
  md += `| Metric | Count | Percentage |\n`;
  md += `|---|---|---|\n`;
  md += `| Total jobs | ${dashboard.public.total_jobs} | 100% |\n`;
  md += `| Jobs with pay | ${dashboard.public.jobs_with_pay} | ${Math.round(dashboard.public.jobs_with_pay / dashboard.public.total_jobs * 100)}% |\n`;
  md += `| Jobs without pay | ${dashboard.public.jobs_without_pay} | ${Math.round(dashboard.public.jobs_without_pay / dashboard.public.total_jobs * 100)}% |\n`;
  md += `| Duplicate jobs | ${dashboard.public.duplicate_count} | ${Math.round(dashboard.public.duplicate_count / dashboard.public.total_jobs * 100)}% |\n`;
  md += `| Closed/archived jobs | ${dashboard.public.closed_job_count} | ${Math.round(dashboard.public.closed_job_count / dashboard.public.total_jobs * 100)}% |\n`;
  md += `| Archive violations | ${dashboard.public.archive_violation_count} | ${Math.round(dashboard.public.archive_violation_count / dashboard.public.total_jobs * 100)}% |\n`;
  md += `\n`;

  md += `### Quality Score Distribution\n\n`;
  md += `| Score Range | Count | Percentage |\n`;
  md += `|---|---|---|---|\n`;
  const totalScored = Object.values(dashboard.public.quality_score_distribution).reduce((a,b)=>a+b,0) || 1;
  for (const [range, count] of Object.entries(dashboard.public.quality_score_distribution)) {
    const pct = Math.round(count / totalScored * 100);
    md += `| ${range} | ${count} | ${pct}% |\n`;
  }
  md += `\n`;

  md += `## PENDING BOARD HEALTH\n\n`;
  md += `| Metric | Count | Percentage |\n`;
  md += `|---|---|---|---|\n`;
  md += `| Total pending jobs | ${dashboard.pending.total_jobs} | 100% |\n`;
  md += `| Missing/poor descriptions | ${dashboard.pending.missing_description_count} | ${Math.round(dashboard.pending.missing_description_count / dashboard.pending.total_jobs * 100)}% |\n`;
  md += `| Pay extraction issues | ${dashboard.pending.pay_issues_count} | ${Math.round(dashboard.pending.pay_issues_count / dashboard.pending.total_jobs * 100)}% |\n`;
  md += `| Requiring manual review | ${dashboard.pending.manual_review_required_count} | ${Math.round(dashboard.pending.manual_review_required_count / dashboard.pending.total_jobs * 100)}% |\n`;
  md += `\n`;

  md += `## SOURCES HEALTH\n\n`;
  md += `### Tier Distribution\n\n`;
  md += `| Tier | Count |\n`;
  md += `|---|---|\n`;
  for (const [tier, count] of Object.entries(dashboard.sources.summary)) {
    const label = tier.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    md += `| ${label} | ${count} |\n`;
  }
  md += `\n`;

  md += `### Action Recommendations\n\n`;
  md += `| Recommendation | Count |\n`;
  md += `|---|---|\n`;
  for (const [rec, count] of Object.entries(dashboard.sources.recommendations)) {
    const label = rec.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    md += `| ${label} | ${count} |\n`;
  }
  md += `\n`;

  md += `## TOP 10 HIGHEST QUALITY SOURCES\n\n`;
  md += `| Source | Provider | Score | Tier | Active Jobs | Pending Jobs |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const src of dashboard.sources.highest_quality) {
    md += `| ${src.source_name || src.source_id} | ${src.provider || "-"} | ${src.overall_score} | ${src.tier} | ${src.active_jobs} | ${src.pending_jobs} |\n`;
  }
  if (dashboard.sources.highest_quality.length === 0) {
    md += `| No sources with sufficient data | | | | | |\n`;
  }
  md += `\n`;

  md += `## TOP 10 LOWEST QUALITY SOURCES\n\n`;
  md += `| Source | Provider | Score | Tier | Recommendation | Active Jobs | Pending Jobs |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const src of dashboard.sources.lowest_quality) {
    md += `| ${src.source_name || src.source_id} | ${src.provider || "-"} | ${src.overall_score} | ${src.tier} | ${src.recommendation} | ${src.active_jobs} | ${src.pending_jobs} |\n`;
  }
  if (dashboard.sources.lowest_quality.length === 0) {
    md += `| No sources with sufficient data | | | | | | |\n`;
  }
  md += `\n`;

  if (dashboard.alerts.length > 0) {
    md += `## SYSTEM ALERTS\n\n`;
    for (const alert of dashboard.alerts) {
      const icon = alert.level === "error" ? "🚨" : alert.level === "warning" ? "⚠️" : "ℹ️";
      md += `${icon} **${alert.level.toUpperCase()}**: ${alert.message} (${alert.section})\n\n`;
    }
  }

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

module.exports = { generateSystemHealthDashboard };

if (require.main === module) {
  generateSystemHealthDashboard({}).catch(err => {
    console.error(`[system-health-dashboard] Failed: ${err.message}`);
    process.exitCode = 1;
  });
}
