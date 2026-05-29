const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

async function runPayAnalysis(options = {}) {
  const startedAt = new Date().toISOString();
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });

  const pending = JSON.parse(await fs.promises.readFile(path.join(ROOT, "pending-synced-jobs.json"), "utf8"));
  const sources = JSON.parse(await fs.promises.readFile(path.join(ROOT, "sources.json"), "utf8"));
  const sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);
  const sourceMap = new Map();
  sourcesList.forEach(s => sourceMap.set(String(s.id).toLowerCase(), s));

  const totalPending = pending.length;
  const payBlocked = pending.filter(p =>
    p.pay_rejected_reason === "missing_pay_context" ||
    p.pay_rejected_reason === "exceeds_max_threshold_500k" ||
    p.pay_rejected_reason === "looks_like_coordinate"
  );

  const categoryCounts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  const bySource = {};
  const byProvider = {};
  const byOrg = {};
  const compensationPatterns = {};
  const hourlyJobs = [];
  const stipendJobs = [];
  const noPayJobs = [];
  const parserMissedJobs = [];
  const invalidExtractionJobs = [];

  payBlocked.forEach(j => {
    const desc = String(j.description || j.raw_description || "");
    const descLow = desc.toLowerCase();
    const rawSalary = String(j.raw_salary || "").trim();
    const salaryMin = Number(j.salary_min);
    const salaryMax = Number(j.salary_max);
    const warning = String(j.parse_warning || "");
    const failedSnippet = String(j.pay_parse_failed_snippet || "");

    const hasHourly = /\/\s*hour|per\s+hour|hourly/i.test(desc) || /hourly/i.test(rawSalary) || /hour/i.test(String(j.job_type || ""));
    const hasStipend = /stipend|reimbursement|home\s*office\s*allowance|fellowship\s*comp|honorarium/i.test(descLow);
    
    // Check if compensation actually exists in the data
    const compensationExists = 
      /\d/.test(rawSalary) || 
      !isNaN(salaryMin) && salaryMin > 0 ||
      !isNaN(salaryMax) && salaryMax > 0 ||
      /\$|salary|pay|compensation|stipend|hourly|\d[\d,]*\s*(k|thousand|annually|yearly|monthly)/i.test(desc);
    
    const noCompensation = !compensationExists;
    const sourceFailure = warning.includes("fetch_failed") || warning.includes("parse_failed") || failedSnippet.length > 50;
    const invalidExtraction = /coordinate|lat:?\s*-?\d+\.?\d*|lon:?\s*-?\d+\.?\d*|\d{7,}/i.test(rawSalary) || j.pay_rejected_reason === "looks_like_coordinate";
    const hasSalarySignal = /[\$£€¥]|salary|pay|compensation/i.test(desc);

    let cat;
    if (invalidExtraction) cat = "E";
    else if (sourceFailure) cat = "F";
    else if (hasHourly) cat = "C";
    else if (hasStipend) cat = "D";
    else if (noCompensation) cat = "A";
    else cat = "B"; // Compensation exists but was rejected by pay validation

    categoryCounts[cat]++;

    const srcKey = String(j.source_id || j.source || j.organization || "unknown");
    if (!bySource[srcKey]) bySource[srcKey] = { total: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, source_name: j.source || j.organization || srcKey };
    bySource[srcKey].total++;
    bySource[srcKey][cat]++;

    const provider = String(j.provider || j.source_type || "unknown");
    if (!byProvider[provider]) byProvider[provider] = { total: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, orgs: new Set() };
    byProvider[provider].total++;
    byProvider[provider][cat]++;
    byProvider[provider].orgs.add(j.organization || "");

    const org = String(j.organization || "unknown");
    if (!byOrg[org]) byOrg[org] = { total: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    byOrg[org].total++;
    byOrg[org][cat]++;

    // Track compensation patterns for parser improvements
    if (cat === "B" && (rawSalary || salaryMin > 0 || salaryMax > 0)) {
      let pattern = "";
      if (rawSalary) pattern = rawSalary.replace(/[\d,.]+/g, "#");
      else if (salaryMin > 0 && salaryMax > 0 && salaryMin === salaryMax) pattern = "#";
      else if (salaryMin > 0 && salaryMax > 0) pattern = "#-#";
      else if (salaryMin > 0) pattern = "#+";
      else if (salaryMax > 0) pattern = "+#";
      
      if (pattern) {
        // Add currency/context info
        if (/[$£€¥]/.test(rawSalary)) pattern = "[$£€¥]" + pattern;
        if (/\/year/i.test(rawSalary)) pattern += " / year";
        if (/\/month/i.test(rawSalary)) pattern += " / month";
        if (/\/hour/i.test(rawSalary)) pattern += " / hour";
        compensationPatterns[pattern] = (compensationPatterns[pattern] || 0) + 1;
      }
      
      parserMissedJobs.push({
        id: j.id, 
        org: j.organization, 
        raw: rawSalary,
        min: salaryMin,
        max: salaryMax,
        source: srcKey,
        description_snippet: String(j.description || j.raw_description || "").slice(0, 100)
      });
    }
    
    if (cat === "C") hourlyJobs.push({ id: j.id, org: j.organization, raw: rawSalary });
    if (cat === "D") stipendJobs.push({ id: j.id, org: j.organization, raw: rawSalary });
    if (cat === "A") noPayJobs.push({ id: j.id, org: j.organization });
    if (cat === "E") invalidExtractionJobs.push({ id: j.id, org: j.organization, raw: rawSalary });
  });

  const payBlockedNotArchived = payBlocked.length;
  const payBlockedTotal = pending.filter(p => {
    const status = String(p.status || "").toLowerCase();
    return (p.pay_rejected_reason || p.pay_parse_failed_snippet) && status !== "archived";
  }).length;

  const parserRecommendations = generateParserRecommendations(compensationPatterns);

  const report = {
    report_type: "pending-pay-analysis",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_pending: totalPending,
    total_pay_blocked: payBlockedNotArchived,
    total_pay_blocked_including_archived: payBlockedTotal,
    category_summary: {
      A__no_compensation: { count: categoryCounts.A, description: "No compensation mentioned anywhere in job data" },
      B__parser_missed_existing: { count: categoryCounts.B, description: "Compensation exists in raw data but pay validation failed (likely missing formatted salary field)" },
      C__hourly_compensation: { count: categoryCounts.C, description: "Hourly compensation detected" },
      D__stipend_reimbursement: { count: categoryCounts.D, description: "Stipend, reimbursement, fellowship compensation only" },
      E__invalid_extraction: { count: categoryCounts.E, description: "Parser extracted non-pay data (coordinates, internal IDs, etc)" },
      F__source_failure: { count: categoryCounts.F, description: "Source fetch/parse failure prevented any data extraction" }
    },
    category_percentages: Object.fromEntries(
      Object.entries(categoryCounts).map(([k, v]) => [k, payBlockedNotArchived ? Math.round(v / payBlockedNotArchived * 100) : 0])
    ),
    by_source: Object.entries(bySource)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 25)
      .map(([key, data]) => ({
        source: key,
        source_name: data.source_name,
        total_blocked: data.total,
        category_A: data.A,
        category_B: data.B,
        category_C: data.C,
        category_D: data.D,
        category_E: data.E,
        category_F: data.F
      })),
    by_ats_provider: Object.entries(byProvider)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([key, data]) => ({
        provider: key,
        total_blocked: data.total,
        unique_orgs: data.orgs.size,
        category_B_parser_missed: data.B,
        category_A_no_pay: data.A,
        category_C_hourly: data.C,
        category_D_stipend: data.D,
        category_E_invalid: data.E
      })),
    top_failing_organizations: Object.entries(byOrg)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([org, data]) => ({
        organization: org,
        total_blocked: data.total,
        category_B_parser_missed: data.B,
        category_A_no_pay: data.A,
        category_C_hourly: data.C
      })),
    compensation_patterns_found: Object.entries(compensationPatterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([pattern, count]) => ({ pattern, count })),
    parser_recommendations: parserRecommendations,
    hidden_salary_language_detected: payBlocked.filter(j => {
      const desc = String(j.description || j.raw_description || "");
      return /competitive|doe|doq|negotiable|commensurate|based\s+on\s+experience|market\s+rate|tbd|tbc/i.test(desc.toLowerCase());
    }).length
  };

  const jsonPath = path.join(REPORTS_DIR, "pending-pay-analysis.json");
  await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const mdPath = path.join(REPORTS_DIR, "pending-pay-analysis.md");
  await fs.promises.writeFile(mdPath, generatePayAnalysisMarkdown(report), "utf8");

  console.log(`[pending-pay-analysis] total_pending=${totalPending} pay_blocked=${payBlockedNotArchived} cat_A=${categoryCounts.A} cat_B=${categoryCounts.B} cat_C=${categoryCounts.C} cat_D=${categoryCounts.D} cat_E=${categoryCounts.E} cat_F=${categoryCounts.F}`);
  return report;
}

function generateParserRecommendations(patterns) {
  const recommendations = [];

  // Group similar patterns
  const yearlyPatterns = Object.entries(patterns)
    .filter(([p]) => p.includes("year"))
    .sort((a, b) => b[1] - a[1]);
    
  if (yearlyPatterns.length > 0) {
    const total = yearlyPatterns.reduce((s, [, c]) => s + c, 0);
    recommendations.push({
      pattern: "Yearly compensation formats ($#, $#-#)",
      count: total,
      suggestion: "These are valid yearly salaries already parsed into salary_min/max. The issue is likely that the formatted 'salary' display string is not being populated from these values.",
      priority: "high",
      action: "Populate salary field from salary_min/max when missing but valid"
    });
  }

  const hourlyPatterns = Object.entries(patterns)
    .filter(([p]) => p.includes("hour"))
    .sort((a, b) => b[1] - a[1]);
    
  if (hourlyPatterns.length > 0) {
    const total = hourlyPatterns.reduce((s, [, c]) => s + c, 0);
    recommendations.push({
      pattern: "Hourly compensation formats",
      count: total,
      suggestion: "Detect '$X / hour' or '$X-$Y / hour' patterns and compute annual equivalent for validation. Consider accepting hourly as valid pay.",
      priority: "high",
      action: "Add hourly pay validation and annual conversion"
    });
  }

  const simpleNumberPatterns = Object.entries(patterns)
    .filter(([p]) => /^[$£€¥]?#$/.test(p) && !p.includes("-") && !p.includes("/"))
    .sort((a, b) => b[1] - a[1]);
    
  if (simpleNumberPatterns.length > 0) {
    const total = simpleNumberPatterns.reduce((s, [, c]) => s + c, 0);
    recommendations.push({
      pattern: "Simple numeric compensation (just a number)",
      count: total,
      suggestion: "These likely represent yearly salaries missing unit/context. Add heuristic: if number is reasonable salary range (20000-500000) and no other pay info, treat as yearly salary.",
      priority: "medium",
      action: "Add context detection for naked numbers in compensation"
    });
  }

  const rangePatterns = Object.entries(patterns)
    .filter(([p]) => /#-#/.test(p) && !p.includes("year") && !p.includes("month") && !p.includes("hour"))
    .sort((a, b) => b[1] - a[1]);
    
  if (rangePatterns.length > 0) {
    const total = rangePatterns.reduce((s, [, c]) => s + c, 0);
    recommendations.push({
      pattern: "Salary ranges without explicit unit ($#-#)",
      count: total,
      suggestion: "Assume yearly unit for ranges without explicit time period when values are in reasonable salary range.",
      priority: "medium",
      action: "Default range units to yearly when ambiguous"
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      pattern: "No specific patterns identified for parser improvement",
      count: 0,
      suggestion: "Review individual cases to determine if these are true missing compensation or formatting/display issues.",
      priority: "low"
    });
  }

  return recommendations;
}

function generatePayAnalysisMarkdown(report) {
  let md = `# Pending Pay Analysis\n\n`;
  md += `Generated: ${report.finished_at}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total pending jobs:** ${report.total_pending}\n`;
  md += `- **Pay-blocked jobs:** ${report.total_pay_blocked}\n`;
  md += `- **Pay-blocked rate:** ${Math.round(report.total_pay_blocked / report.total_pending * 100)}%\n\n`;

  md += `## Category Breakdown\n\n`;
  md += `| Category | Count | % | Description |\n`;
  md += `|---|---|---|---|\n`;
  for (const [key, data] of Object.entries(report.category_summary)) {
    const label = key.replace(/__/, ": ").replace(/_/g, " ");
    const pct = report.category_percentages[key.charAt(0)] || 0;
    md += `| ${label} | ${data.count} | ${pct}% | ${data.description} |\n`;
  }
  md += `\n`;

  md += `## Top Failing Organizations\n\n`;
  md += `| Organization | Blocked | Parser Missed | No Pay |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const org of report.top_failing_organizations) {
    md += `| ${org.organization} | ${org.total_blocked} | ${org.category_B_parser_missed} | ${org.category_A_no_pay || 0} |\n`;
  }
  md += `\n`;

  md += `## By ATS Provider\n\n`;
  md += `| Provider | Blocked | Orgs | Parser Missed |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const prov of report.by_ats_provider) {
    md += `| ${prov.provider} | ${prov.total_blocked} | ${prov.unique_orgs} | ${prov.category_B_parser_missed} |\n`;
  }
  md += `\n`;

  md += `## Compensation Patterns Found in Blocked Jobs\n\n`;
  md += `| Pattern (anonymized) | Count |\n`;
  md += `|---|---|\n`;
  for (const p of report.compensation_patterns_found) {
    md += `| \`${p.pattern}\` | ${p.count} |\n`;
  }
  md += `\n`;

  md += `## Parser Improvement Recommendations\n\n`;
  for (const rec of report.parser_recommendations) {
    md += `### ${rec.priority.toUpperCase()}: ${rec.pattern}\n\n`;
    md += `- **Occurrences:** ${rec.count}\n`;
    md += `- **Suggested action:** ${rec.action}\n`;
    md += `- **Rationale:** ${rec.suggestion}\n\n`;
  }

  return md;
}

module.exports = { runPayAnalysis };

if (require.main === module) {
  runPayAnalysis({}).catch(err => {
    console.error(`[pending-pay-analysis] Failed: ${err.message}`);
    process.exitCode = 1;
  });
}
