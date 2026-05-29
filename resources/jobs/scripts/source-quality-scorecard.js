const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

async function buildSourceScorecard(options = {}) {
  const startedAt = new Date().toISOString();
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });

  const [publicJobs, pendingJobs, sources] = await Promise.all([
    readJson("jobs.json"),
    readJson("pending-synced-jobs.json"),
    readJson("sources.json")
  ]);

  const sourcesList = Array.isArray(sources) ? sources : (sources.sources || []);

  const pendingBySource = groupBy(pendingJobs, j => String(j.source_id || j.source || j.organization || "unknown").toLowerCase());
  const publicBySource = groupBy(publicJobs, j => String(j.source_id || j.source || j.organization || "unknown").toLowerCase());

  const scorecard = sourcesList.map(source => {
    const sourceKey = String(source.id || source.organization || "unknown").toLowerCase();
    const sourcePending = pendingBySource.get(sourceKey) || [];
    const sourcePublic = publicBySource.get(sourceKey) || [];
    const sourcePendingFiltered = sourcePending.filter(j => String(j.status || "").toLowerCase() !== "archived");

    const totalJobs = sourcePendingFiltered.length + sourcePublic.length;
    const activeJobs = sourcePublic.length;
    const pendingJobsCount = sourcePendingFiltered.length;

    const parserStability = source.source_scoring?.parser_stability || "unknown";
    const fetchReliability = source.source_scoring?.fetch_reliability || "unknown";
    const structuredAtsConfidence = source.source_scoring?.structured_ats_confidence || "unknown";

    const parseSuccessCount = sourcePendingFiltered.filter(j => j.parser_confidence_score != null && j.parser_confidence_score > 0).length;
    const parseSuccessRate = sourcePendingFiltered.length > 0 ? Math.round((parseSuccessCount / sourcePendingFiltered.length) * 100) : 100;

    const descOkCount = sourcePendingFiltered.filter(j => {
      const d = String(j.description || j.raw_description || "");
      return d.length > 50;
    }).length;
    const descriptionSuccessRate = sourcePendingFiltered.length > 0 ? Math.round((descOkCount / sourcePendingFiltered.length) * 100) : 100;

    const payFoundCount = sourcePendingFiltered.filter(j => {
      return j.pay_confidence === "high" || j.pay_confidence === "medium" || (j.salary && /[\d]/.test(j.salary)) || j.salary_min != null;
    }).length;
    const payExtractionRate = sourcePendingFiltered.length > 0 ? Math.round((payFoundCount / sourcePendingFiltered.length) * 100) : 100;

    const urlOkCount = sourcePendingFiltered.filter(j => {
      const au = String(j.apply_url || "");
      const su = String(j.source_url || "");
      return au.startsWith("http") && su.startsWith("http") && au.length > 20;
    }).length;
    const urlSuccessRate = sourcePendingFiltered.length > 0 ? Math.round((urlOkCount / sourcePendingFiltered.length) * 100) : 100;

    const freshnessFailCount = sourcePendingFiltered.filter(j => {
      const ss = String(j.source_status || "").toLowerCase();
      return ss === "needs_review" || ss === "error" || ss === "not_found";
    }).length;

    const allPendingIds = new Set(sourcePendingFiltered.map(j => String(j.id)));
    const duplicateCount = countDuplicates(sourcePendingFiltered);

    const archiveBlockedCount = sourcePendingFiltered.filter(j => {
      const fr = String(j._reject_reason || j.pay_rejected_reason || "");
      return fr.includes("archived") || fr.includes("fingerprint");
    }).length;

    const manualReviewCount = sourcePendingFiltered.filter(j => {
      const rr = String(j.review_reason || j.triage_reason || "");
      return rr.length > 0 && !rr.includes("meets review-ready threshold");
    }).length;

    const avgQualityScore = sourcePendingFiltered.length > 0
      ? Math.round(sourcePendingFiltered.reduce((s, j) => {
          let score = computeSimpleQuality(j);
          return s + score;
        }, 0) / sourcePendingFiltered.length)
      : 0;

    const providerType = source.provider || "custom";

    const scoreValue = computeSourceScore(
      parseSuccessRate, descriptionSuccessRate, payExtractionRate, urlSuccessRate,
      freshnessFailCount, duplicateCount, archiveBlockedCount, manualReviewCount,
      parserStability, fetchReliability
    );

    let tier, recommendation;
    if (scoreValue >= 80 && totalJobs >= 3) {
      tier = "highest_quality";
      recommendation = "KEEP";
    } else if (scoreValue >= 60) {
      tier = "medium_quality";
      recommendation = totalJobs > 0 ? "HARDEN" : "KEEP";
    } else if (scoreValue >= 30) {
      tier = "high_maintenance";
      recommendation = totalJobs >= 5 ? "MANUAL_REVIEW_ONLY" : "HARDEN";
    } else {
      tier = "candidate_for_removal";
      recommendation = totalJobs > 0 ? "HARDEN" : "REMOVE";
    }

    return {
      source_id: source.id,
      source_name: source.name || source.organization || source.id,
      organization: source.organization || source.name || source.id,
      provider: providerType,
      type: source.type || "unknown",
      enabled: source.enabled !== false,
      active_jobs: activeJobs,
      pending_jobs: pendingJobsCount,
      total_jobs: totalJobs,
      parse_success_rate: parseSuccessRate,
      description_success_rate: descriptionSuccessRate,
      pay_extraction_rate: payExtractionRate,
      url_success_rate: urlSuccessRate,
      freshness_failures: freshnessFailCount,
      duplicate_frequency: duplicateCount,
      archive_fingerprint_blocks: archiveBlockedCount,
      manual_review_frequency: manualReviewCount,
      average_quality_score: avgQualityScore,
      overall_score: scoreValue,
      tier,
      recommendation,
      parser_stability: parserStability,
      fetch_reliability: fetchReliability,
      structured_ats_confidence: structuredAtsConfidence
    };
  });

  const byScore = [...scorecard].sort((a, b) => b.overall_score - a.overall_score);
  const highestQuality = byScore.filter(s => s.total_jobs >= 1).slice(0, 10);
  const lowestQuality = [...byScore].filter(s => s.total_jobs >= 1).sort((a, b) => a.overall_score - b.overall_score).slice(0, 10);

  const tierSummary = {};
  scorecard.forEach(s => {
    tierSummary[s.tier] = (tierSummary[s.tier] || 0) + 1;
  });

  const report = {
    report_type: "source-quality-scorecard",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_sources: scorecard.length,
    sources_with_jobs: scorecard.filter(s => s.total_jobs > 0).length,
    tier_summary: tierSummary,
    top_10_highest_quality: highestQuality,
    top_10_lowest_quality: lowestQuality,
    by_recommendation: {
      keep: scorecard.filter(s => s.recommendation === "KEEP").length,
      manual_review_only: scorecard.filter(s => s.recommendation === "MANUAL_REVIEW_ONLY").length,
      harden: scorecard.filter(s => s.recommendation === "HARDEN").length,
      remove: scorecard.filter(s => s.recommendation === "REMOVE").length
    },
    sources: byScore.map(s => ({
      source_id: s.source_id,
      source_name: s.source_name,
      provider: s.provider,
      active_jobs: s.active_jobs,
      pending_jobs: s.pending_jobs,
      overall_score: s.overall_score,
      tier: s.tier,
      recommendation: s.recommendation,
      parse_success_rate: s.parse_success_rate,
      pay_extraction_rate: s.pay_extraction_rate,
      description_success_rate: s.description_success_rate,
      url_success_rate: s.url_success_rate,
      freshness_failures: s.freshness_failures,
      duplicate_frequency: s.duplicate_frequency,
      average_quality_score: s.average_quality_score
    }))
  };

  const jsonPath = path.join(REPORTS_DIR, "source-quality-scorecard.json");
  await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const mdPath = path.join(REPORTS_DIR, "source-quality-scorecard.md");
  await fs.promises.writeFile(mdPath, generateScorecardMarkdown(report), "utf8");

  console.log(`[source-quality-scorecard] sources=${scorecard.length} with_jobs=${report.sources_with_jobs} top_score=${highestQuality[0]?.overall_score || 0} bottom_score=${lowestQuality[0]?.overall_score || 0}`);
  return report;
}

function computeSimpleQuality(job) {
  let score = 50;
  if (job.parser_confidence_score != null && job.parser_confidence_score >= 80) score += 15;
  else if (job.parser_confidence_score != null && job.parser_confidence_score >= 50) score += 5;
  if (String(job.description || "").length > 100 || String(job.raw_description || "").length > 100) score += 10;
  if (job.pay_confidence === "high" || job.salary_min != null) score += 10;
  if (String(job.apply_url || "").startsWith("http")) score += 5;
  if (String(job.source_status || "") === "live") score += 10;
  return Math.min(100, Math.max(0, score));
}

function computeSourceScore(parseRate, descRate, payRate, urlRate, freshFails, dups, archiveBlocks, manualReview, parserStability, fetchReliability) {
  let score = 0;

  score += parseRate * 0.20;
  score += descRate * 0.15;
  score += payRate * 0.20;
  score += urlRate * 0.10;

  score -= freshFails * 3;
  score -= dups * 5;
  score -= archiveBlocks * 10;
  score -= manualReview * 2;

  if (parserStability === "high") score += 10;
  else if (parserStability === "medium") score += 5;
  else if (parserStability === "low") score -= 10;

  if (fetchReliability === "high") score += 5;
  else if (fetchReliability === "low") score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function groupBy(arr, keyFn) {
  const map = new Map();
  (arr || []).forEach(item => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function countDuplicates(jobs) {
  const seen = new Set();
  let dups = 0;
  (jobs || []).forEach(j => {
    const key = String(j.title || "") + "::" + String(j.organization || "");
    if (seen.has(key)) dups++;
    seen.add(key);
  });
  return dups;
}

async function readJson(filename) {
  try {
    const raw = await fs.promises.readFile(path.join(ROOT, filename), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function generateScorecardMarkdown(report) {
  let md = `# Source Quality Scorecard\n\n`;
  md += `Generated: ${report.finished_at}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total sources:** ${report.total_sources}\n`;
  md += `- **Sources with jobs:** ${report.sources_with_jobs}\n\n`;

  md += `## Tier Summary\n\n`;
  md += `| Tier | Count |\n`;
  md += `|---|---|\n`;
  for (const [tier, count] of Object.entries(report.tier_summary)) {
    const label = tier.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    md += `| ${label} | ${count} |\n`;
  }
  md += `\n`;

  md += `## Recommendations\n\n`;
  md += `| Recommendation | Count |\n`;
  md += `|---|---|\n`;
  for (const [rec, count] of Object.entries(report.by_recommendation)) {
    const label = rec.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    md += `| ${label} | ${count} |\n`;
  }
  md += `\n`;

  md += `## Top 10 Highest Quality Sources\n\n`;
  md += `| Source | Provider | Score | Tier | Jobs |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const s of report.top_10_highest_quality) {
    md += `| ${s.source_name} | ${s.provider || "-"} | ${s.overall_score} | ${s.tier} | ${s.total_jobs} |\n`;
  }
  md += `\n`;

  md += `## Top 10 Lowest Quality Sources\n\n`;
  md += `| Source | Provider | Score | Tier | Recommendation | Jobs |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const s of report.top_10_lowest_quality) {
    md += `| ${s.source_name} | ${s.provider || "-"} | ${s.overall_score} | ${s.tier} | ${s.recommendation} | ${s.total_jobs} |\n`;
  }
  md += `\n`;

  return md;
}

module.exports = { buildSourceScorecard };

if (require.main === module) {
  buildSourceScorecard({}).catch(err => {
    console.error(`[source-quality-scorecard] Failed: ${err.message}`);
    process.exitCode = 1;
  });
}
