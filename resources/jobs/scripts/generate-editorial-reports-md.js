#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");

const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

function text(v) { return String(v ?? "").trim(); }

function safe(v, fallback = "") { return v ?? fallback; }

function arr(v) { return Array.isArray(v) ? v : []; }

function nowIso() { return new Date().toISOString(); }

function fmtTable(rows = [], cols = []) {
  if (!rows.length) return "_None_";
  const h = `| ${cols.join(" | ")} |`;
  const d = `| ${cols.map(() => "---").join(" | ")} |`;
  const b = rows.map(r => `| ${cols.map(c => text(r[c]).replace(/\n/g, " ")).join(" | ")} |`);
  return [h, d, ...b].join("\n");
}

async function readJson(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(REPORTS, name), "utf8"));
  } catch { return null; }
}

async function generateBoardQualityMd() {
  const r = await readJson("board-quality-report.json");
  if (!r) return "";
  const m = r.metrics || {};
  const w = arr(r.warnings || []);
  const f = arr(r.failures || []);

  return [
    "# Board Quality Report",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Quality Density Metrics",
    "",
    fmtTable([
      { metric: "Public Jobs", value: m.total_public, target: "40-60" },
      { metric: "Pending Jobs", value: m.total_pending, target: "-" },
      { metric: "Mission Alignment Ratio", value: m.mission_alignment_ratio, target: ">0.30" },
      { metric: "Public Job Quality Score", value: m.public_job_quality_score + "%", target: ">60%" },
      { metric: "Generic Role Ratio", value: m.generic_role_ratio, target: "<0.15" },
      { metric: "Broad Source Dominance", value: m.broad_source_dominance_ratio, target: "<0.40" },
      { metric: "Public Org Diversity", value: m.public_org_diversity_score, target: ">20" },
      { metric: "Comms/Policy Ratio", value: m.comms_policy_ratio, target: ">0.20" },
      { metric: "Low Relevance Backlog", value: m.low_relevance_backlog_ratio, target: "<0.30" },
      { metric: "Stale Public Ratio", value: m.stale_public_ratio, target: "<0.10" },
      { metric: "High Priority Pending", value: m.high_priority_pending_count, target: ">15" },
      { metric: "Avg Mission Alignment", value: m.avg_mission_alignment_score, target: "-" },
      { metric: "Mission Aligned Pending", value: m.mission_aligned_pending_count, target: "-" },
    ], ["metric", "value", "target"]),
    "",
    "## Validation Health",
    "",
    `**Warnings:** ${w.length}  \n**Failures:** ${f.length}`,
    "",
    ...(w.length ? ["### Warnings", "", ...w.map(e => `- ${e.message || JSON.stringify(e)}`), ""] : []),
    ...(f.length ? ["### Failures", "", ...f.map(e => `- ${e.message || JSON.stringify(e)}`), ""] : []),
    "",
    "## Public Organizations",
    "",
    ...(arr(m.public_organizations).length ? arr(m.public_organizations).map(o => `- ${o}`) : ["_None_"]),
    "",
    "## Pending Organizations (not in public)",
    "",
    ...(arr(m.pending_organizations).length
      ? arr(m.pending_organizations).filter(o => !arr(m.public_organizations).some(p => p.toLowerCase() === o.toLowerCase())).map(o => `- ${o}`)
      : ["_None_"]),
    ""
  ].join("\n");
}

async function generateEditorialQueueMd() {
  const r = await readJson("editorial-priority-queue.json");
  if (!r) return "";
  return [
    "# Editorial Priority Queue",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Total Scored", value: r.total_scored },
      { metric: "Top Recommendations", value: arr(r.top_recommendations).length },
      { metric: "Blocked High-Quality", value: arr(r.blocked_high_quality_jobs).length },
      { metric: "Public Org Count", value: safe(r.summary?.public_org_count) },
      { metric: "Pending Org Count", value: safe(r.summary?.pending_org_count) },
      { metric: "Underrepresented Orgs", value: safe(r.summary?.pending_orgs_not_in_public) },
    ], ["metric", "value"]),
    "",
    "## Top 30 Recommendations",
    "",
    fmtTable(
      arr(r.top_recommendations).slice(0, 30).map(j => ({
        title: j.title, org: j.organization, score: j.queue_score,
        mission: j.mission_alignment_score, editorial: j.editorial_priority_score,
        blocked: j.is_backlogged ? "yes" : "no"
      })),
      ["title", "org", "score", "mission", "editorial", "blocked"]
    ),
    "",
    "## Blocked High-Quality Jobs",
    "",
    fmtTable(
      arr(r.blocked_high_quality_jobs).slice(0, 20).map(j => ({
        title: j.title, org: j.organization, score: j.queue_score,
        reason: j.skip_reason || j.reason || ""
      })),
      ["title", "org", "score", "reason"]
    ),
    "",
    "## Underrepresented Organizations",
    "",
    ...(arr(r.underrepresented_organizations).length
      ? arr(r.underrepresented_organizations).slice(0, 40).map(o => `- ${o}`)
      : ["_None_"]),
    ""
  ].join("\n");
}

async function generateProtectDemocracyMd() {
  const r = await readJson("protect-democracy-continuity-audit.json");
  if (!r) return "";
  const s = r.summary || {};
  return [
    "# Protect Democracy Continuity Audit",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Historical Jobs in jobs2", value: s.totalHistoricalJobs },
      { metric: "Issues Found", value: s.issuesFound },
      { metric: "Recovery Candidates", value: s.recoveryCandidates },
      { metric: "Recovered", value: s.recovered },
    ], ["metric", "value"]),
    "",
    "## Issues",
    "",
    ...(arr(r.findings?.issues).length
      ? arr(r.findings?.issues).map(e => `- [${e.severity}] ${e.message}`)
      : ["_None_"]),
    "",
    "## Recovery Candidates",
    "",
    fmtTable(
      arr(r.findings?.recoveryCandidates).map(c => ({
        title: c.title, action: c.action, reason: c.reason || ""
      })),
      ["title", "action", "reason"]
    ),
    "",
    "## Public State",
    "",
    fmtTable(
      arr(r.findings?.publicState).map(j => ({
        title: j.title, status: j.status || ""
      })),
      ["title", "status"]
    ),
    "",
    "## Pending State",
    "",
    fmtTable(
      arr(r.findings?.pendingState).map(j => ({
        title: j.title, bucket: j.status || j.triage_bucket,
        hidden: j.hidden ? "yes" : "no", backlog: j.backlog ? "yes" : "no"
      })),
      ["title", "bucket", "hidden", "backlog"]
    ),
    ""
  ].join("\n");
}

async function generateEditorialQueueVerificationMd() {
  const r = await readJson("editorial-queue-verification.json");
  if (!r) return "";
  return [
    "# Editorial Queue Verification",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Top 50 Count", value: r.top50_count },
      { metric: "Weak Recommendations", value: r.weak_recommendations },
      { metric: "Generic Prioritized", value: arr(r.generic_jobs_prioritized).length },
      { metric: "False Mission Positives", value: arr(r.false_mission_positives).length },
      { metric: "Overrepresented Orgs", value: arr(r.overrepresented_orgs).length },
      { metric: "Underrepresented Orgs", value: arr(r.underrepresented_orgs).length },
    ], ["metric", "value"]),
    "",
    ...(arr(r.false_mission_positives).length ? [
      "## False Mission-Alignment Positives",
      "",
      fmtTable(
        arr(r.false_mission_positives).map(j => ({
          title: j.title, org: j.org, score: j.score
        })),
        ["title", "org", "score"]
      ),
      ""
    ] : []),
    ...(arr(r.weak_recommendation_details).length ? [
      "## Weak Recommendations (score < 50)",
      "",
      fmtTable(
        arr(r.weak_recommendation_details).map(j => ({
          title: j.title, org: j.org, score: j.score
        })),
        ["title", "org", "score"]
      ),
      ""
    ] : []),
    ...(arr(r.overrepresented_orgs).length ? [
      "## Overrepresented Orgs in Top 50",
      "",
      fmtTable(
        arr(r.overrepresented_orgs).map(o => ({
          org: o.org, count: o.count
        })),
        ["org", "count"]
      ),
      ""
    ] : []),
    ...(arr(r.issues).length ? [
      "## Issues",
      "",
      ...arr(r.issues).map(e => `- [${e.severity}] ${e.message}`),
      ""
    ] : []),
    ...(arr(r.underrepresented_orgs).length ? [
      "## Underrepresented Orgs (in pending, not in public)",
      "",
      ...arr(r.underrepresented_orgs).slice(0, 30).map(o => `- ${o}`),
      ""
    ] : []),
    ...(r.missing_role_categories ? [
      "## Missing Role Categories in Top 50",
      "",
      fmtTable([
        { category: "Comms/Policy", count: r.missing_role_categories.comms_policy_count },
        { category: "Campaigns", count: r.missing_role_categories.campaigns_count },
        { category: "Storytelling/Creative", count: r.missing_role_categories.storytelling_count },
      ], ["category", "count"]),
      ""
    ] : []),
  ].join("\n");
}

async function generateBroadSourceTuningMd() {
  const r = await readJson("broad-source-tuning-report.json");
  if (!r) return "";
  const srcs = arr(r.sources ? Object.entries(r.sources) : []);
  return [
    "# Broad-Source Suppression Tuning Report",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Total Broad-Source Jobs", value: r.summary?.total_broad_source_jobs },
      { metric: "False Preservations", value: r.summary?.total_false_preservations },
      { metric: "False Suppressions", value: r.summary?.total_false_suppressions },
      { metric: "Needs Tuning", value: r.summary?.needs_tuning ? "yes" : "no" },
    ], ["metric", "value"]),
    "",
    "## Per-Source Details",
    "",
    ...srcs.flatMap(([sid, s]) => [
      `### ${s.source_name || sid}`,
      "",
      fmtTable([
        { metric: "Total Jobs", value: s.total_jobs },
        { metric: "Preserved", value: s.preserved_count },
        { metric: "Suppressed", value: s.suppressed_count },
        { metric: "False Preservations", value: s.false_preservations_count },
        { metric: "False Suppressions", value: s.false_suppressions_count },
      ], ["metric", "value"]),
      "",
      ...(arr(s.false_preservations).length ? [
        "#### False Preservations",
        "",
        fmtTable(arr(s.false_preservations).map(j => ({ title: j.title, reason: j.reason })), ["title", "reason"]),
        ""
      ] : []),
      ...(arr(s.false_suppressions).length ? [
        "#### False Suppressions",
        "",
        fmtTable(arr(s.false_suppressions).map(j => ({ title: j.title, reason: j.reason })), ["title", "reason"]),
        ""
      ] : []),
      ...(arr(s.preserved_examples).length ? [
        "#### Preserved Examples",
        "",
        ...arr(s.preserved_examples).map(j => `- ${j.title}`),
        ""
      ] : []),
    ]),
  ].join("\n");
}

async function generatePublicBoardDiversityMd() {
  const r = await readJson("public-board-diversity-audit.json");
  if (!r) return "";
  return [
    "# Public Board Diversity Audit",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Total Jobs", value: r.public_board_summary?.total_jobs },
      { metric: "Unique Organizations", value: r.public_board_summary?.unique_organizations },
      { metric: "Avg Jobs Per Org", value: r.public_board_summary?.avg_jobs_per_org },
    ], ["metric", "value"]),
    "",
    "## Organization Diversity",
    "",
    ...(arr(r.organization_diversity?.top_concentrated_orgs).length ? [
      "### Top Concentrated Orgs",
      "",
      fmtTable(arr(r.organization_diversity.top_concentrated_orgs).map(o => ({
        org: o.org, count: o.count
      })), ["org", "count"]),
      ""
    ] : []),
    `Enterprise/Energy Dominance: ${r.organization_diversity?.enterprise_energy_dominance ? "YES" : "no"} (${r.organization_diversity?.enterprise_energy_count} orgs, ${r.organization_diversity?.enterprise_energy_percentage}%)`,
    "",
    "## Role Diversity by Mission Area",
    "",
    fmtTable(
      Object.entries(r.role_diversity?.by_mission_area || {}).map(([area, count]) => ({
        area, count
      })),
      ["area", "count"]
    ),
    "",
    ...(arr(r.mission_area_gaps).length ? [
      "### Mission Area Gaps",
      "",
      ...arr(r.mission_area_gaps).map(a => `- ${a} (zero representation)`),
      ""
    ] : []),
    "## Source Concentration",
    "",
    fmtTable(
      arr(r.source_concentration?.top_sources).slice(0, 10).map(s => ({
        source: s.source, count: s.count
      })),
      ["source", "count"]
    ),
    "",
    ...(arr(r.warnings).length ? [
      "## Warnings",
      "",
      ...arr(r.warnings).map(w => `- [${w.type}] ${w.message}`),
      ""
    ] : []),
    ...(arr(r.underrepresented_organizations).length ? [
      "## Underrepresented Orgs (in pending, not on board)",
      "",
      fmtTable(
        arr(r.underrepresented_organizations).slice(0, 20).map(o => ({
          org: o.org, pending_jobs: o.pending_job_count, titles: arr(o.example_titles).slice(0, 2).join(", ")
        })),
        ["org", "pending_jobs", "titles"]
      ),
      ""
    ] : []),
  ].join("\n");
}

async function generateHighPriorityPendingMd() {
  const r = await readJson("high-priority-pending-verification.json");
  if (!r) return "";
  return [
    "# High-Priority Pending Verification",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Global Summary",
    "",
    fmtTable([
      { metric: "Total Resurfaced", value: r.global_summary?.total_resurfaced },
      { metric: "Weak Resurfaced", value: r.global_summary?.total_weak_resurfaced },
      { metric: "Strong Resurfaced", value: r.global_summary?.total_strong_resurfaced },
      { metric: "Calibration", value: r.global_summary?.calibration_concern },
    ], ["metric", "value"]),
    "",
    "## Organization Details",
    "",
    ...arr(r.organizations).flatMap(o => [
      `### ${o.organization}`,
      "",
      fmtTable([
        { metric: "Total Pending", value: o.total_pending },
        { metric: "Total Public", value: o.total_public },
        { metric: "Resurfaced", value: o.resurfaced_count },
        { metric: "Review Ready", value: o.review_ready_count },
        { metric: "Backlogged", value: o.backlogged_count },
        { metric: "Needs Cleanup", value: o.needs_cleanup_count },
        { metric: "Potential Spam", value: o.potential_spam_resurfaced },
      ], ["metric", "value"]),
      "",
      ...(arr(o.all_pending_titles).length ? [
        "#### All Pending Titles",
        "",
        fmtTable(
          arr(o.all_pending_titles).map(j => ({
            title: j.title, bucket: j.bucket, reason: j.reason || ""
          })),
          ["title", "bucket", "reason"]
        ),
        ""
      ] : []),
    ]),
  ].join("\n");
}

async function generateLifecycleSafetyMd() {
  const r = await readJson("lifecycle-safety-audit.json");
  if (!r) return "";
  return [
    "# Lifecycle Safety Audit",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Metrics",
    "",
    fmtTable([
      { metric: "Total Records", value: r.lifecycle_metrics?.total_records },
      { metric: "With Identity History", value: r.lifecycle_metrics?.with_identity_history },
      { metric: "With Grace Period", value: r.lifecycle_metrics?.with_grace_period },
      { metric: "With Archival Score", value: r.lifecycle_metrics?.with_archival_confidence_score },
      { metric: "With Missing Confirmations", value: r.lifecycle_metrics?.with_missing_confirmations },
      { metric: "Stale Provider Mappings", value: r.lifecycle_metrics?.stale_provider_mappings },
      { metric: "Provider Migration Ghosts", value: r.lifecycle_metrics?.potential_provider_migration_ghosts },
      { metric: "Duplicate Canonical IDs", value: r.lifecycle_metrics?.duplicate_canonical_ids },
    ], ["metric", "value"]),
    "",
    ...(arr(r.stale_provider_mappings).length ? [
      "## Stale Provider Mappings",
      "",
      fmtTable(
        arr(r.stale_provider_mappings).map(e => ({
          id: e.id, title: e.title, sources: arr(e.source_ids).join(", ")
        })),
        ["id", "title", "sources"]
      ),
      ""
    ] : []),
    ...(arr(r.potential_ghosts).length ? [
      "## Potential Provider Migration Ghosts",
      "",
      fmtTable(
        arr(r.potential_ghosts).map(e => ({
          id: e.id, title: e.title, source_hist: e.source_identity_count, canonical_hist: e.canonical_identity_count
        })),
        ["id", "title", "source_hist", "canonical_hist"]
      ),
      ""
    ] : []),
    ...(arr(r.concerns).length ? [
      "## Concerns",
      "",
      ...arr(r.concerns).map(c => `- [${c.severity}] ${c.message}`),
      ""
    ] : []),
    ...(arr(r.grace_period_details).length ? [
      "## Grace Period Details",
      "",
      fmtTable(
        arr(r.grace_period_details).map(e => ({
          id: e.id, title: e.title, grace_until: e.grace_until, confirmations: e.confirmations
        })),
        ["id", "title", "grace_until", "confirmations"]
      ),
      ""
    ] : []),
  ].join("\n");
}

async function generateProtectDemocracyHistoricalMd() {
  const r = await readJson("protect-democracy-historical-validation.json");
  if (!r) return "";
  return [
    "# Protect Democracy Historical Validation",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Total in jobs2", value: r.protect_democracy_summary?.total_in_jobs2 },
      { metric: "Total Public", value: r.protect_democracy_summary?.total_public },
      { metric: "Total Pending", value: r.protect_democracy_summary?.total_pending },
      { metric: "Total Records", value: r.protect_democracy_summary?.total_records },
      { metric: "Historical Lost", value: r.protect_democracy_summary?.historical_jobs_lost },
      { metric: "Recoverable", value: r.protect_democracy_summary?.recoverable_candidates },
    ], ["metric", "value"]),
    "",
    "## Historical jobs2 State",
    "",
    fmtTable(
      arr(r.historical_jobs2).map(j => ({
        title: j.title, date: j.date || "", status: j.status || ""
      })),
      ["title", "date", "status"]
    ),
    "",
    "## Pending State",
    "",
    fmtTable(
      arr(r.pending_state).map(j => ({
        title: j.title, bucket: j.bucket, hidden: j.hidden ? "yes" : "no"
      })),
      ["title", "bucket", "hidden"]
    ),
    "",
    "## Record State",
    "",
    fmtTable(
      arr(r.record_state).map(j => ({
        title: j.title, status: j.status, verification: j.verification
      })),
      ["title", "status", "verification"]
    ),
    "",
    ...(arr(r.historical_losses).length ? [
      "## Historical Losses",
      "",
      fmtTable(
        arr(r.historical_losses).map(j => ({
          title: j.title, date: j.date || ""
        })),
        ["title", "date"]
      ),
      ""
    ] : []),
    ...(arr(r.continuity_issues).length ? [
      "## Continuity Issues",
      "",
      ...arr(r.continuity_issues).map(e => `- [${e.severity}] ${e.message}`),
      ""
    ] : []),
  ].join("\n");
}

async function generateStrategyMd() {
  const r = await readJson("editorial-strategy-recommendations.json");
  if (!r) return "";
  return [
    "# Editorial Strategy Recommendations",
    "",
    `Generated: ${r.generated_at || nowIso()}`,
    "",
    "## Executive Summary",
    "",
    fmtTable([
      { metric: "Current Public Count", value: r.executive_summary?.current_public_count },
      { metric: "Recommended Range", value: r.executive_summary?.recommended_public_range },
      { metric: "Public Org Diversity", value: r.executive_summary?.public_org_diversity },
      { metric: "Pipeline Health", value: r.executive_summary?.pending_pipeline_health },
      { metric: "Editorial Coherence", value: r.executive_summary?.editorial_coherence },
    ], ["metric", "value"]),
    "",
    ...(arr(r.recommended_organization_additions).length ? [
      "## Recommended Organization Additions",
      "",
      fmtTable(
        arr(r.recommended_organization_additions).map(o => ({
          org: o.org, candidates: o.candidate_count, top: o.top_candidate || ""
        })),
        ["org", "candidates", "top"]
      ),
      ""
    ] : ["_No recommended additions at this time_", ""]),
    ...(arr(r.recommended_manual_review_orgs).length ? [
      "## Orgs Recommended for Manual Review",
      "",
      ...arr(r.recommended_manual_review_orgs).map(o => `- ${o}`),
      ""
    ] : []),
    ...(arr(r.strongest_pending_candidates).length ? [
      "## Strongest Pending Candidates",
      "",
      fmtTable(
        arr(r.strongest_pending_candidates).map(j => ({
          title: j.title, org: j.org, mission_score: j.mission_score
        })),
        ["title", "org", "mission_score"]
      ),
      ""
    ] : ["_No strong pending candidates found_", ""]),
    ...(arr(r.editorial_blind_spots).length ? [
      "## Editorial Blind Spots",
      "",
      ...arr(r.editorial_blind_spots).map(s => `- ${s}`),
      ""
    ] : []),
    ...(arr(r.refinement_actions).length ? [
      "## Recommended Refinement Actions",
      "",
      ...arr(r.refinement_actions).map(a => `- ${a}`),
      ""
    ] : []),
  ].join("\n");
}

const GENERATORS = {
  "board-quality-report.json": generateBoardQualityMd,
  "editorial-priority-queue.json": generateEditorialQueueMd,
  "protect-democracy-continuity-audit.json": generateProtectDemocracyMd,
  "editorial-queue-verification.json": generateEditorialQueueVerificationMd,
  "broad-source-tuning-report.json": generateBroadSourceTuningMd,
  "public-board-diversity-audit.json": generatePublicBoardDiversityMd,
  "high-priority-pending-verification.json": generateHighPriorityPendingMd,
  "lifecycle-safety-audit.json": generateLifecycleSafetyMd,
  "protect-democracy-historical-validation.json": generateProtectDemocracyHistoricalMd,
  "editorial-strategy-recommendations.json": generateStrategyMd,
};

async function main() {
  const results = [];
  for (const [jsonFile, generator] of Object.entries(GENERATORS)) {
    const mdFile = jsonFile.replace(/\.json$/, ".md");
    try {
      const md = await generator();
      if (md) {
        await fs.writeFile(path.join(REPORTS, mdFile), md, "utf8");
        results.push({ file: mdFile, status: "generated", size: md.length });
      } else {
        results.push({ file: mdFile, status: "skipped (no data)" });
      }
    } catch (err) {
      results.push({ file: mdFile, status: `error: ${err.message}` });
    }
  }
  console.log(JSON.stringify({ phase: "generate-editorial-reports-md", results }, null, 2));
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
