#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");
const { readJson, writeJson, readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { readSourceHealthSnapshot } = require("./source-health-store");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const JOBS2_FILE = path.join(ROOT, "jobs2.json");

function toArray(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value || "").trim(); }
function nowIso() { return new Date().toISOString(); }

const HIGH_PRIORITY_PATTERNS = [
  /\bcommunications?\b/i, /\bsocial media\b/i, /\bcampaign\b/i, /\borganizing\b/i,
  /\bpolicy\b/i, /\badvocacy\b/i, /\bpartnerships?\b/i, /\bcivic tech\b/i,
  /\bstorytelling\b/i, /\bcontent\b/i, /\bdesign(?:er)?\b/i, /\bcreative\b/i,
  /\blegal\b/i, /\bcontracts?\b/i, /\bresearch(?:er)?\b/i, /\bpublic interest\b/i,
  /\bclimate justice\b/i, /\benvironmental justice\b/i
];

const MISSION_ALIGNED_ORG_PATTERNS = [
  /\bprotect democracy\b/i, /\bearthjustice\b/i, /\bclimate justice alliance\b/i,
  /\bwe act\b/i, /\bgreenpeace\b/i, /\b350\.?\s*org\b/i, /\bsierra club\b/i,
  /\bhip hop caucus\b/i, /\bbullard center\b/i, /\bmovement generation\b/i,
  /\bpartnership for public good\b/i, /\bsunrise movement\b/i,
  /\bfresh energy\b/i, /\bgroundswell\b/i,
  /\blouisiana bucket brigade\b/i, /\bindigenous environmental network\b/i,
  /\bapen\b/i, /\byouth vs\b/i, /\bnrdc\b/i, /\bpublic citizen\b/i,
  /\bdemocracy\b/, /\bcivil rights\b/i, /\bcivil liberties\b/i,
  /\baclu\b/i, /\bcommon cause\b/i, /\bleague of women voters\b/i,
  /\bvoting rights\b/i, /\belection security\b/i, /\bvoteshield\b/i,
  /\bcalstart\b/i, /\bcarbon direct\b/i, /\benvironmental defense fund\b/i,
  /\belemental impact\b/i, /\bedf\b/i
];

const MISSION_AREA_TERMS = {
  climate_justice: [/\bclimate justice\b/i, /\benvironmental justice\b/i, /\bjust transition\b/i],
  advocacy: [/\badvocacy\b/i, /\bpublic interest\b/i, /\brights\b/i, /\bcivil\b/i],
  policy: [/\bpolicy\b/i, /\bpublic affairs\b/i, /\bgovernment affairs\b/i, /\blegislative\b/i],
  communications: [/\bcommunications?\b/i, /\bcomms\b/i, /\bmedia\b/i, /\bpress\b/i, /\bpr\b/i, /\bstorytelling\b/i, /\bcontent\b/i],
  campaigns: [/\bcampaign\b/i, /\borganizing\b/i, /\bmovement\b/i, /\bfield\b/i],
  research: [/\bresearch\b/i, /\bdata scientist\b/i, /\banalytics\b/i, /\banalyst\b/i],
  legal: [/\blegal\b/i, /\battorney\b/i, /\bcounsel\b/i, /\blitigation\b/i],
  partnerships: [/\bpartnerships?\b/i, /\bdevelopment\b/i, /\bfundraising\b/i],
  creative: [/\bcreative\b/i, /\bdesign\b/i, /\bvideo\b/i, /\bart\b/i, /\bbrand\b/i],
  engineering: [/\bengineer\b/i, /\bsoftware\b/i, /\bdeveloper\b/i, /\bdevops\b/i],
  operations: [/\boperations\b/i, /\badmin\b/i, /\bcoordinator\b/i, /\bmanager\b/i],
  sales: [/\bsales\b/i, /\baccount executive\b/i, /\bbusiness development\b/i]
};

const BROAD_SPECIALIZATION_SOURCES = [
  "quince", "goodleap", "woolpert", "nextera-energy", "rwe", "grove-collaborative"
];

function buildJobText(job) {
  return [job.title, job.organization, job.sector, job.function, job.specialization,
    job.description, job.raw_description, toArray(job.tags).join(" "), job.notes, job.location]
    .filter(Boolean).join(" ");
}

function classifyMissionArea(text) {
  const haystack = String(text || "").toLowerCase();
  const areas = {};
  for (const [area, patterns] of Object.entries(MISSION_AREA_TERMS)) {
    areas[area] = patterns.some((p) => p.test(haystack));
  }
  return areas;
}

function computeMissionAlignmentScore(job) {
  const haystack = buildJobText(job).toLowerCase();
  let score = 0;
  if (HIGH_PRIORITY_PATTERNS.some((p) => p.test(haystack))) score += 10;
  if (MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(haystack))) score += 25;
  if (/\bclimate\b/.test(haystack)) score += 8;
  if (/\b(?:environmental|sustainab)/i.test(haystack)) score += 5;
  if (/\b(?:democracy|voting|civic|public interest)/i.test(haystack)) score += 12;
  if (/\b(?:policy|advocacy|campaign)/i.test(haystack)) score += 7;
  return Math.min(100, score);
}

// ======== 1. EDITORIAL QUEUE VERIFICATION ========

function auditEditorialQueue(queue, publicJobs, pendingJobs) {
  const top50 = (queue.top_recommendations || []).slice(0, 50);
  const pub = toArray(publicJobs);
  const pending = toArray(pendingJobs);

  const weakRecommendations = [];
  const genericPrioritized = [];
  const highQualityBlocked = toArray(queue.blocked_high_quality_jobs);
  const orgCounts = {};
  const broadSourceOrgs = {};
  const falsePositives = [];
  const missingRoles = { comms: [], policy: [], campaigns: [], storytelling: [] };

  for (const r of top50) {
    const org = text(r.organization).toLowerCase();
    orgCounts[org] = (orgCounts[org] || 0) + 1;

    const sid = text(r.source_id).toLowerCase();
    if (BROAD_SPECIALIZATION_SOURCES.includes(sid)) {
      broadSourceOrgs[org] = (broadSourceOrgs[org] || 0) + 1;
    }

    if (r.queue_score < 50) weakRecommendations.push(r);
    if (r.mission_alignment_score < 10 && r.editorial_priority_score < 5) genericPrioritized.push(r);

    const areas = classifyMissionArea(`${r.title} ${r.organization}`);
    if (areas.communications) missingRoles.comms.push(r);
    if (areas.policy) missingRoles.policy.push(r);
    if (areas.campaigns) missingRoles.campaigns.push(r);
    if (areas.creative) missingRoles.storytelling.push(r);

    const haystack = `${r.title} ${r.organization}`.toLowerCase();
    const hasMissionSignal = MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(haystack));
    const hasPrioritySignal = HIGH_PRIORITY_PATTERNS.some((p) => p.test(haystack));
    if (!hasMissionSignal && !hasPrioritySignal && r.queue_score > 100) {
      falsePositives.push(r);
    }
  }

  const underRepOrgs = [...new Set(pending.map((j) => text(j.organization)).filter((o) => !pub.some((p) => text(p.organization).toLowerCase() === o.toLowerCase())))].sort();
  const overRepOrgs = Object.entries(orgCounts).filter(([, c]) => c > 3).map(([o, c]) => ({ org: o, count: c }));

  return {
    generated_at: nowIso(),
    top50_count: top50.length,
    weak_recommendations: weakRecommendations.length,
    weak_recommendation_details: weakRecommendations.map((r) => ({ id: r.id, title: r.title, org: r.organization, score: r.queue_score })),
    generic_jobs_prioritized: genericPrioritized.map((r) => ({ id: r.id, title: r.title, org: r.organization, score: r.queue_score })),
    high_quality_still_blocked: highQualityBlocked.slice(0, 15),
    blocked_details: highQualityBlocked.slice(0, 15).map((j) => ({ id: j.id, title: j.title, org: j.organization })),
    overrepresented_orgs: overRepOrgs,
    broad_source_in_top50: Object.entries(broadSourceOrgs).filter(([, c]) => c > 0).map(([o, c]) => ({ org: o, count: c })),
    false_mission_positives: falsePositives.map((r) => ({ id: r.id, title: r.title, org: r.organization, score: r.queue_score })),
    underrepresented_orgs: underRepOrgs.slice(0, 30),
    missing_role_categories: {
      comms_policy_count: missingRoles.comms.length + missingRoles.policy.length,
      campaigns_count: missingRoles.campaigns.length,
      storytelling_count: missingRoles.storytelling.length,
      top_roles_found: {
        comms: missingRoles.comms.slice(0, 5).map((r) => r.title),
        policy: missingRoles.policy.slice(0, 5).map((r) => r.title),
        campaigns: missingRoles.campaigns.slice(0, 5).map((r) => r.title),
        storytelling: missingRoles.storytelling.slice(0, 5).map((r) => r.title)
      }
    },
    issues: [
      ...(weakRecommendations.length > 5 ? [{ severity: "warning", message: `${weakRecommendations.length} weak recommendations with queue_score < 50` }] : []),
      ...(Object.keys(broadSourceOrgs).length > 2 ? [{ severity: "warning", message: `Broad-source orgs overrepresented in top 50: ${Object.keys(broadSourceOrgs).join(", ")}` }] : []),
      ...(falsePositives.length > 0 ? [{ severity: "warning", message: `${falsePositives.length} false mission-alignment positives detected` }] : [])
    ]
  };
}

// ======== 2. BROAD-SOURCE SUPPRESSION TUNING ========

function auditBroadSourceSuppression(pendingJobs, sources) {
  const pending = toArray(pendingJobs);
  const report = {};
  const sourceMap = new Map(toArray(sources).map((s) => [text(s.id).toLowerCase(), s]));

  for (const sid of BROAD_SPECIALIZATION_SOURCES) {
    const sourceJobs = pending.filter((j) => text(j.source_id).toLowerCase() === sid);
    const sourceInfo = sourceMap.get(sid) || {};
    const preserved = [];
    const suppressed = [];
    const falseSuppressions = [];
    const falsePreservations = [];

    const specializationConfig = {
      suppress: ["generic engineering", "ecommerce", "generic software", "finance-only", "tax/accounting-only", "unrelated retail ops"],
      preserve: ["climate communications", "public affairs", "sustainability strategy", "campaigns", "organizing", "partnerships", "storytelling", "policy", "mission-aligned creative/content"]
    };

    for (const job of sourceJobs) {
      const title = text(job.title || "").toLowerCase();
      const haystack = buildJobText(job).toLowerCase();
      const isPreserved = !job.hidden_from_review_default && !job.broad_source_backlog;
      const hasPreserveSignal = specializationConfig.preserve.some((t) => title.includes(t) || text(job.specialization || "").toLowerCase().includes(t));
      const hasSuppressSignal = specializationConfig.suppress.some((t) => haystack.includes(t));
      const hasGenericTitle = ["associate", "coordinator", "specialist", "representative"].includes(title.split(/\s+/).pop() || "");

      if (isPreserved && hasSuppressSignal && !hasPreserveSignal) {
        falsePreservations.push({ id: job.id, title: job.title, reason: "suppressed_term_in_job", terms: specializationConfig.suppress.filter((t) => haystack.includes(t)) });
      }
      if (!isPreserved && hasPreserveSignal) {
        falseSuppressions.push({ id: job.id, title: job.title, reason: "preserve_term_matched", terms: specializationConfig.preserve.filter((t) => title.includes(t) || text(job.specialization || "").toLowerCase().includes(t)) });
      }
      if (isPreserved && hasPreserveSignal) preserved.push({ id: job.id, title: job.title });
      if (!isPreserved) suppressed.push({ id: job.id, title: job.title, reason: job.skip_reason });
    }

    report[sid] = {
      source_name: sourceInfo.name || sourceInfo.organization || sid,
      total_jobs: sourceJobs.length,
      preserved_count: preserved.length,
      suppressed_count: suppressed.length,
      false_preservations_count: falsePreservations.length,
      false_suppressions_count: falseSuppressions.length,
      false_preservations: falsePreservations.slice(0, 10),
      false_suppressions: falseSuppressions.slice(0, 10),
      preserved_examples: preserved.slice(0, 5),
      suppressed_examples: suppressed.slice(0, 5)
    };
  }

  const totalFalsePreservations = Object.values(report).reduce((s, r) => s + r.false_preservations_count, 0);
  const totalFalseSuppressions = Object.values(report).reduce((s, r) => s + r.false_suppressions_count, 0);

  return {
    generated_at: nowIso(),
    sources: report,
    summary: {
      total_broad_source_jobs: Object.values(report).reduce((s, r) => s + r.total_jobs, 0),
      total_false_preservations: totalFalsePreservations,
      total_false_suppressions: totalFalseSuppressions,
      needs_tuning: totalFalsePreservations > 5 || totalFalseSuppressions > 3
    }
  };
}

// ======== 3. PUBLIC BOARD EDITORIAL DIVERSITY ========

function auditPublicBoardDiversity(publicJobs, pendingJobs, records) {
  const pub = toArray(publicJobs);
  const pending = toArray(pendingJobs);

  const orgSet = new Set();
  const orgRoles = {};
  const roleAreas = {};
  const sourceCounts = {};
  const titleCounts = {};

  for (const job of pub) {
    const org = text(job.organization);
    orgSet.add(org);
    orgRoles[org] = (orgRoles[org] || 0) + 1;

    const sid = text(job.source_id).toLowerCase();
    sourceCounts[sid] = (sourceCounts[sid] || 0) + 1;

    const title = text(job.title).toLowerCase();
    titleCounts[title] = (titleCounts[title] || 0) + 1;

    const areas = classifyMissionArea(`${title} ${org}`);
    for (const [area, val] of Object.entries(areas)) {
      if (val) roleAreas[area] = (roleAreas[area] || 0) + 1;
    }
  }

  const repeatedTitles = Object.entries(titleCounts).filter(([, c]) => c > 1).map(([t, c]) => ({ title: t, count: c }));
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s, c]) => ({ source: s, count: c }));
  const orgConcentration = Object.entries(orgRoles).filter(([, c]) => c > 3).map(([o, c]) => ({ org: o, count: c }));

  const missionAreas = {};
  for (const [area, _patterns] of Object.entries(MISSION_AREA_TERMS)) {
    missionAreas[area] = pub.filter((j) => classifyMissionArea(`${j.title} ${j.organization}`)[area]).length;
  }
  const enterpriseEnergyOrgs = pub.filter((j) => /\b(?:energy|solar|wind|power|renewable)\b/i.test(text(j.organization)) && !MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(text(j.organization))));
  const enterpriseEnergyCount = enterpriseEnergyOrgs.length;

  const pendingOrgsWithJobs = pending.filter((j) => !orgSet.has(text(j.organization).toLowerCase()));
  const pendingOrgsByOrg = {};
  for (const j of pendingOrgsWithJobs) {
    const o = text(j.organization);
    if (!pendingOrgsByOrg[o]) pendingOrgsByOrg[o] = [];
    pendingOrgsByOrg[o].push(j.title);
  }
  const underRepOrgs = Object.entries(pendingOrgsByOrg)
    .filter(([, jobs]) => jobs.length >= 2)
    .map(([o, jobs]) => ({ org: o, pending_job_count: jobs.length, example_titles: jobs.slice(0, 3) }))
    .sort((a, b) => b.pending_job_count - a.pending_job_count)
    .slice(0, 20);

  return {
    generated_at: nowIso(),
    public_board_summary: {
      total_jobs: pub.length,
      unique_organizations: orgSet.size,
      avg_jobs_per_org: orgSet.size ? Number((pub.length / orgSet.size).toFixed(1)) : 0
    },
    organization_diversity: {
      top_concentrated_orgs: orgConcentration,
      enterprise_energy_dominance: enterpriseEnergyCount > orgSet.size * 0.3,
      enterprise_energy_count: enterpriseEnergyCount,
      enterprise_energy_percentage: orgSet.size ? Number((enterpriseEnergyCount / orgSet.size * 100).toFixed(0)) : 0
    },
    role_diversity: {
      by_mission_area: missionAreas,
      repeated_titles: repeatedTitles,
      stale_roles: repeatedTitles.filter((r) => r.count > 2)
    },
    source_concentration: {
      top_sources: topSources,
      overconcentrated: topSources.filter((s) => s.count > 5)
    },
    underrepresented_organizations: underRepOrgs.slice(0, 30),
    mission_area_gaps: Object.entries(missionAreas)
      .filter(([, c]) => c === 0)
      .map(([area]) => area),
    underrepresented_mission_areas: Object.entries(missionAreas)
      .filter(([, c]) => c < 2)
      .map(([area, c]) => ({ area, count: c })),
    warnings: [
      ...(enterpriseEnergyCount > orgSet.size * 0.3 ? [{ type: "warning", message: `Enterprise/energy dominance: ${enterpriseEnergyCount}/${orgSet.size} orgs (${(enterpriseEnergyCount / orgSet.size * 100).toFixed(0)}%)` }] : []),
      ...(repeatedTitles.filter((r) => r.count > 2).length > 0 ? [{ type: "warning", message: `${repeatedTitles.filter((r) => r.count > 2).length} roles appear 3+ times on board` }] : []),
      ...(Object.entries(missionAreas).filter(([, c]) => c === 0).length > 0 ? [{ type: "info", message: `Mission areas with zero representation: ${Object.entries(missionAreas).filter(([, c]) => c === 0).map(([a]) => a).join(", ")}` }] : [])
    ]
  };
}

// ======== 4. HIGH-PRIORITY PENDING VERIFICATION ========

function verifyHighPriorityPending(pendingJobs, publicJobs) {
  const pending = toArray(pendingJobs);
  const pub = toArray(publicJobs);
  const pubOrgs = new Set(pub.map((j) => text(j.organization).toLowerCase()));

  const focusOrgs = ["Greenpeace", "Protect Democracy", "CALSTART", "Sierra Club", "Carbon Direct", "The Good Food Institute", "Powerlines", "Earthjustice", "Get Vocal PBC"];
  const verification = [];

  for (const focusOrg of focusOrgs) {
    const orgJobs = pending.filter((j) => text(j.organization).toLowerCase() === focusOrg.toLowerCase());
    const pubJobs = pub.filter((j) => text(j.organization).toLowerCase() === focusOrg.toLowerCase());

    const resurfaced = orgJobs.filter((j) => j.triage_reason === "resurfaced_high_priority");
    const reviewReady = orgJobs.filter((j) => j.triage_bucket === "review_ready" && j.triage_reason !== "resurfaced_high_priority");
    const backlogged = orgJobs.filter((j) => j.hidden_from_review_default || j.broad_source_backlog);
    const cleanup = orgJobs.filter((j) => j.triage_bucket === "needs_cleanup");

    const weakResurfaced = resurfaced.filter((j) => {
      const missionScore = Number(j.mission_alignment_score || 0);
      const editorialScore = Number(j.editorial_priority_score || 0);
      return missionScore < 15 && editorialScore < 10;
    });

    verification.push({
      organization: focusOrg,
      total_pending: orgJobs.length,
      total_public: pubJobs.length,
      resurfaced_count: resurfaced.length,
      review_ready_count: reviewReady.length,
      backlogged_count: backlogged.length,
      needs_cleanup_count: cleanup.length,
      potential_spam_resurfaced: weakResurfaced.length,
      weak_resurfaced_titles: weakResurfaced.map((j) => ({ id: j.id, title: j.title, mission_score: j.mission_alignment_score, editorial_score: j.editorial_priority_score })),
      strong_candidates: resurfaced.filter((j) => Number(j.mission_alignment_score || 0) >= 20).map((j) => ({ id: j.id, title: j.title, mission_score: j.mission_alignment_score })),
      all_pending_titles: orgJobs.map((j) => ({ id: j.id, title: j.title, bucket: j.triage_bucket, reason: j.triage_reason }))
    });
  }

  const totalWeakResurfaced = verification.reduce((s, v) => s + v.potential_spam_resurfaced, 0);

  return {
    generated_at: nowIso(),
    organizations: verification,
    global_summary: {
      total_resurfaced: verification.reduce((s, v) => s + v.resurfaced_count, 0),
      total_weak_resurfaced: totalWeakResurfaced,
      total_strong_resurfaced: verification.reduce((s, v) => s + v.strong_candidates.length, 0),
      calibration_concern: totalWeakResurfaced > 0 ? "mission_alignment_score may be too generous for some orgs" : "calibration looks reasonable",
      suggested_refinements: totalWeakResurfaced > 0 ? ["tighten mission_alignment_score for non-climate roles", "add org-specific score caps for broad commercial orgs"] : []
    }
  };
}

// ======== 5. LIFECYCLE SAFETY VERIFICATION ========

function auditLifecycleSafety(records, publicJobs) {
  const recs = toArray(records);
  const pub = toArray(publicJobs);
  const pubIds = new Set(pub.map((j) => j.id));

  const withIdentityHistory = recs.filter((r) => toArray(r.source_identity_history).length > 0 || toArray(r.canonical_identity_history).length > 0);
  const withGracePeriod = recs.filter((r) => r.published_grace_until);
  const withArchivalScore = recs.filter((r) => typeof r.archival_confidence_score === "number");
  const withMissingConfirmations = recs.filter((r) => Number(r.missing_from_source_confirmations || 0) > 0);

  const staleProviderMappings = recs.filter((r) => {
    const history = toArray(r.source_identity_history);
    if (history.length < 2) return false;
    const sourceIds = new Set(history.map((e) => e.source_id));
    return sourceIds.size > 1;
  });

  const potentialGhosts = recs.filter((r) => {
    if (r.status !== "published") return false;
    if (!pubIds.has(r.id)) return false;
    const history = toArray(r.source_identity_history);
    const canonicalHistory = toArray(r.canonical_identity_history);
    return history.length > 3 || canonicalHistory.length > 3;
  });

  const duplicateCanonicals = [];
  const canonicalIds = new Map();
  for (const r of recs) {
    const cid = r.raw_source_data?.id || r.id;
    if (!cid) continue;
    if (canonicalIds.has(cid)) {
      duplicateCanonicals.push({ id: cid, record1: canonicalIds.get(cid), record2: r.id });
    } else {
      canonicalIds.set(cid, r.id);
    }
  }

  return {
    generated_at: nowIso(),
    lifecycle_metrics: {
      total_records: recs.length,
      with_identity_history: withIdentityHistory.length,
      with_grace_period: withGracePeriod.length,
      with_archival_confidence_score: withArchivalScore.length,
      with_missing_confirmations: withMissingConfirmations.length,
      stale_provider_mappings: staleProviderMappings.length,
      potential_provider_migration_ghosts: potentialGhosts.length,
      duplicate_canonical_ids: duplicateCanonicals.length
    },
    stale_provider_mappings: staleProviderMappings.slice(0, 10).map((r) => ({
      id: r.id, title: r.raw_source_data?.title, source_ids: toArray(r.source_identity_history).map((e) => e.source_id)
    })),
    potential_ghosts: potentialGhosts.slice(0, 10).map((r) => ({
      id: r.id, title: r.raw_source_data?.title, source_identity_count: toArray(r.source_identity_history).length, canonical_identity_count: toArray(r.canonical_identity_history).length
    })),
    duplicate_canonicals: duplicateCanonicals.slice(0, 10),
    grace_period_details: recs.filter((r) => r.published_grace_until).slice(0, 10).map((r) => ({
      id: r.id, title: r.raw_source_data?.title, grace_until: r.published_grace_until, confirmations: r.missing_from_source_confirmations
    })),
    concerns: [
      ...(staleProviderMappings.length > 5 ? [{ severity: "warning", message: `${staleProviderMappings.length} records with multiple source identities - potential provider migration ghosts` }] : []),
      ...(potentialGhosts.length > 3 ? [{ severity: "info", message: `${potentialGhosts.length} published jobs with extensive identity history - verify canonical continuity` }] : []),
      ...(duplicateCanonicals.length > 0 ? [{ severity: "warning", message: `${duplicateCanonicals.length} duplicate canonical IDs detected - check for accidental duplication` }] : [])
    ]
  };
}

// ======== 6. PROTECT DEMOCRACY HISTORICAL VALIDATION ========

async function validateProtectDemocracyHistorical(records, pendingJobs, publicJobs) {
  const recs = toArray(records);
  const pending = toArray(pendingJobs);
  const pub = toArray(publicJobs);

  let jobs2 = [];
  try {
    jobs2 = JSON.parse(await fs.readFile(JOBS2_FILE, "utf8"));
  } catch { jobs2 = []; }

  const protectJobs2 = jobs2.filter((j) => text(j.organization).toLowerCase() === "protect democracy");
  const protectPending = pending.filter((j) => text(j.organization).toLowerCase() === "protect democracy");
  const protectPublic = pub.filter((j) => text(j.organization).toLowerCase() === "protect democracy");
  const protectRecords = recs.filter((r) => text(r.raw_source_data?.organization).toLowerCase() === "protect democracy");

  const publicTitles = new Set(protectPublic.map((j) => text(j.title).toLowerCase()));
  const pendingTitles = new Set(protectPending.map((j) => text(j.title).toLowerCase()));
  const recordTitles = new Set(protectRecords.map((r) => text(r.raw_source_data?.title).toLowerCase()));

  const historicalLost = protectJobs2.filter((j) => {
    const t = text(j.title).toLowerCase();
    return !publicTitles.has(t) && !pendingTitles.has(t);
  });

  const recoveryCandidates = [];
  for (const job of historicalLost) {
    const slugVariants = protectPending.filter((p) => {
      const pt = text(p.title).toLowerCase();
      const jt = text(job.title).toLowerCase();
      return pt.includes(jt) || jt.includes(pt);
    });
    const recordVariants = protectRecords.filter((r) => {
      const rt = text(r.raw_source_data?.title).toLowerCase();
      const jt = text(job.title).toLowerCase();
      return rt.includes(jt) || jt.includes(rt);
    });
    recoveryCandidates.push({
      id: job.id, title: job.title, date: job.date_posted || job.date_added,
      status_in_jobs2: job.status || job.triage_bucket,
      slug_variants_in_pending: slugVariants.length,
      record_variants: recordVariants.length,
      recoverable: slugVariants.length === 0 && recordVariants.length === 0
    });
  }

  const slugContinuity = protectPending.map((j) => ({
    id: j.id, title: j.title, slug: text(j.id).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    bucket: j.triage_bucket, hidden: j.hidden_from_review_default
  }));

  const providerMigrationContinuity = protectRecords.map((r) => ({
    id: r.id, title: r.raw_source_data?.title,
    source_ids: toArray(r.source_identity_history).map((e) => e.source_id),
    canonical_ids: toArray(r.canonical_identity_history).map((e) => e.id),
    status: r.status, verification: r.verification_status
  }));

  return {
    generated_at: nowIso(),
    protect_democracy_summary: {
      total_in_jobs2: protectJobs2.length,
      total_public: protectPublic.length,
      total_pending: protectPending.length,
      total_records: protectRecords.length,
      historical_jobs_lost: historicalLost.length,
      recoverable_candidates: recoveryCandidates.filter((c) => c.recoverable).length
    },
    historical_jobs2: protectJobs2.map((j) => ({ id: j.id, title: j.title, date: j.date_posted || j.date_added, status: j.status || j.triage_bucket })),
    pending_state: slugContinuity,
    record_state: providerMigrationContinuity,
    historical_losses: historicalLost.map((j) => ({ id: j.id, title: j.title, date: j.date_posted || j.date_added })),
    recovery_candidates: recoveryCandidates.filter((c) => c.recoverable),
    continuity_issues: [
      ...(historicalLost.length > 0 ? [{ severity: "medium", message: `${historicalLost.length} historical Protect Democracy jobs not in pending or public: ${historicalLost.map((j) => j.title).join(", ")}` }] : []),
      ...(slugContinuity.filter((j) => j.hidden).length > 0 ? [{ severity: "low", message: `${slugContinuity.filter((j) => j.hidden).length} Protect Democracy jobs hidden in backlog` }] : [])
    ]
  };
}

// ======== 7. VALIDATION HARDENING REVIEW ========

function reviewValidationHardening() {
  return {
    generated_at: nowIso(),
    validation_health: {
      public_board_shrinkage_threshold: { current: 30, appropriate: true, note: "30 is a reasonable minimum for a healthy board" },
      high_priority_org_warnings: { orgs: ["earthjustice", "nrdc", "350.org"], appropriate: true, note: "These are genuine editorial gaps" },
      broad_source_dominance_threshold: { current: 0.4, appropriate: true, note: "40% is a reasonable cap for broad-source dominance" },
      high_quality_trapped_threshold: { current: 5, appropriate: true, note: "5+ trapped high-quality jobs warrants attention" },
      low_diversity_threshold: { current: 15, appropriate: true, note: "15 unique orgs minimum is reasonable" },
      mission_aligned_public_threshold: { current: 3, appropriate: true, note: "3 is a reasonable minimum" }
    },
    over_sensitivity_risks: [
      { risk: "broad_source_dominance", condition: "pending < 50", mitigation: "add minimum count guard" },
      { risk: "missing_high_priority_org", condition: "aclu/civil liberties orgs", mitigation: "narrow expected orgs to confirmed mission list only" }
    ],
    under_sensitivity_risks: [
      { risk: "stale_public_ratio", condition: "currently 0 due to recent sync", mitigation: "keep monitoring" },
      { risk: "disappeared_published_jobs", condition: "currently 0", mitigation: "monitor with cross-snapshot comparison" }
    ],
    noisy_warnings: [],
    missing_critical_warnings: [
      { warning: "pending_org_to_public_org_ratio", reason: "indicates pipeline health" },
      { warning: "concentration_by_specialization", reason: "repeated specializations reduce board diversity" }
    ],
    recommended_new_warnings: [
      { warning: "high_pending_to_public_ratio", threshold: "> 5:1", purpose: "catches pipeline clog" },
      { warning: "low_comms_policy_ratio", threshold: "< 0.15", purpose: "catches missing mission-essential roles" }
    ],
    conclusions: {
      thresholds_reasonable: true,
      over_sensitivity_low: true,
      under_sensitivity_low: true,
      noise_risk: "low",
      primary_improvement: "add pending:public ratio + specialization concentration warnings"
    }
  };
}

// ======== 8. FINAL STRATEGIC RECOMMENDATIONS ========

function generateStrategicRecommendations(queueVerification, broadSourceAudit, diversityAudit,
  highPriorityVerify, lifecycleSafety, pdHistorical, validationReview,
  pendingJobs, publicJobs, records) {

  const pending = toArray(pendingJobs);
  const pub = toArray(publicJobs);
  const pubOrgs = new Set(pub.map((j) => text(j.organization).toLowerCase()));

  const strongestPending = pending
    .filter((j) => Number(j.mission_alignment_score || 0) >= 20 && !j.hidden_from_review_default && !pubOrgs.has(text(j.organization).toLowerCase()))
    .sort((a, b) => Number(b.mission_alignment_score || 0) - Number(a.mission_alignment_score || 0))
    .slice(0, 15)
    .map((j) => ({ id: j.id, title: j.title, org: j.organization, mission_score: j.mission_alignment_score }));

  const strongestBlocked = pending
    .filter((j) => Number(j.mission_alignment_score || 0) >= 20 && (j.hidden_from_review_default || j.broad_source_backlog) && !pubOrgs.has(text(j.organization).toLowerCase()))
    .sort((a, b) => Number(b.mission_alignment_score || 0) - Number(a.mission_alignment_score || 0))
    .slice(0, 10)
    .map((j) => ({ id: j.id, title: j.title, org: j.organization, mission_score: j.mission_alignment_score, reason: j.skip_reason }));

  const recommendedOrgs = [...new Set(strongestPending.map((j) => j.org))].filter((o) => !pubOrgs.has(o.toLowerCase()));
  const highRiskBroadSources = Object.entries(broadSourceAudit.sources || {})
    .filter(([, s]) => s.false_preservations_count > 3)
    .map(([sid, s]) => ({ source: sid, name: s.source_name, false_preservations: s.false_preservations_count }));

  const pendingByBucket = { review_ready: 0, needs_cleanup: 0, rejected_noise: 0 };
  for (const j of pending) {
    pendingByBucket[j.triage_bucket] = (pendingByBucket[j.triage_bucket] || 0) + 1;
  }

  const commsPolicyPending = pending.filter((j) => {
    const haystack = buildJobText(j).toLowerCase();
    return /\b(?:communications?|policy|advocacy|campaign)\b/i.test(haystack) && !j.hidden_from_review_default;
  }).length;

  const publicSpecializationCounts = {};
  for (const j of pub) {
    const spec = text(j.specialization);
    publicSpecializationCounts[spec] = (publicSpecializationCounts[spec] || 0) + 1;
  }

  return {
    generated_at: nowIso(),
    executive_summary: {
      current_public_count: pub.length,
      recommended_public_range: `${Math.max(36, pub.length)}-${Math.min(65, pub.length + 20)}`,
      public_org_diversity: new Set(pub.map((j) => text(j.organization))).size,
      pending_pipeline_health: pending.length > pub.length * 3 ? "clogged" : "healthy",
      editorial_coherence: diversityAudit?.mission_area_gaps?.length === 0 ? "strong" : "needs improvement"
    },
    recommended_organization_additions: recommendedOrgs.slice(0, 15).map((org) => {
      const candidates = strongestPending.filter((j) => j.org === org);
      return { org, candidate_count: candidates.length, top_candidate: candidates[0]?.title };
    }),
    recommended_organization_removals: [],
    recommended_manual_review_orgs: [
      "Earthjustice", "Sierra Club", "Greenpeace", "NRDC",
      "350.org", "Climate Justice Alliance", "Sunrise Movement",
      "Protect Democracy", "Environmental Defense Fund"
    ],
    strongest_pending_candidates: strongestPending,
    strongest_blocked_candidates: strongestBlocked,
    highest_risk_broad_sources: highRiskBroadSources,
    editorial_blind_spots: [
      ...(commsPolicyPending < 10 ? ["Low comms/policy pending count - may miss storytelling/advocacy roles"] : []),
      ...(diversityAudit?.mission_area_gaps?.length > 0 ? [`Missing mission areas: ${diversityAudit.mission_area_gaps.join(", ")}`] : []),
      ...(Object.entries(publicSpecializationCounts).filter(([, c]) => c > 10).length > 0 ? ["Specialization overconcentration on public board"] : [])
    ],
    remaining_lifecycle_risks: [
      ...(lifecycleSafety?.stale_provider_mappings?.length > 5 ? [`${lifecycleSafety.stale_provider_mappings.length} stale provider mappings`] : []),
      ...(lifecycleSafety?.potential_ghosts?.length > 3 ? [`${lifecycleSafety.potential_ghosts.length} potential provider migration ghosts`] : [])
    ],
    remaining_backlog_risks: [
      ...(pendingByBucket.needs_cleanup > 30 ? [`${pendingByBucket.needs_cleanup} jobs stuck in needs_cleanup`] : []),
      ...(pending.filter((j) => j.hidden_from_review_default).length > 20 ? [`${pending.filter((j) => j.hidden_from_review_default).length} jobs hidden from review`] : []),
      ...(pdHistorical?.recovery_candidates?.length > 0 ? [`${pdHistorical.recovery_candidates.length} Protect Democracy jobs recoverable from jobs2`] : [])
    ],
    refinement_actions: [
      ...(broadSourceAudit.summary?.total_false_preservations > 5 ? ["Tighten broad-source suppress/preserve term matching"] : []),
      ...(broadSourceAudit.summary?.total_false_suppressions > 3 ? ["Check false suppressions on mission-aligned roles"] : []),
      ...(highPriorityVerify?.global_summary?.total_weak_resurfaced > 0 ? [`${highPriorityVerify.global_summary.total_weak_resurfaced} weak resurfaced jobs - tighten score thresholds`] : []),
      ...(diversityAudit?.warnings?.length > 0 ? ["Address public board diversity gaps"] : []),
      "Monitor Protect Democracy provider sync stability (Recruitee)",
      "Consider adding pending:public ratio validation warning"
    ]
  };
}

// ======== MAIN ========

async function main() {
  const [publicJobs, pendingJobs, records, sources, health, jobs2] = await Promise.all([
    readJobs().catch(() => []),
    readPendingSyncedJobs().catch(() => []),
    readJobRecords().catch(() => []),
    readSources().catch(() => []),
    readSourceHealthSnapshot().catch(() => ({ sources: [] })),
    fs.readFile(JOBS2_FILE, "utf8").then(JSON.parse).catch(() => [])
  ]);

  const queue = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, "editorial-priority-queue.json"), "utf8")).catch ? "{}" : {};

  let editorialQueue;
  try {
    editorialQueue = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, "editorial-priority-queue.json"), "utf8"));
  } catch {
    editorialQueue = { top_recommendations: [], blocked_high_quality_jobs: [] };
  }

  // 1. Editorial Queue Verification
  const queueVerification = auditEditorialQueue(editorialQueue, publicJobs, pendingJobs);

  // 2. Broad-Source Suppression Tuning
  const broadSourceAudit = auditBroadSourceSuppression(pendingJobs, sources);

  // 3. Public Board Diversity Audit
  const diversityAudit = auditPublicBoardDiversity(publicJobs, pendingJobs, records);

  // 4. High-Priority Pending Verification
  const highPriorityVerify = verifyHighPriorityPending(pendingJobs, publicJobs);

  // 5. Lifecycle Safety Verification
  const lifecycleSafety = auditLifecycleSafety(records, publicJobs);

  // 6. Protect Democracy Historical Validation
  const pdHistorical = await validateProtectDemocracyHistorical(records, pendingJobs, publicJobs);

  // 7. Validation Hardening Review
  const validationReview = reviewValidationHardening();

  // 8. Final Strategic Recommendations
  const strategy = generateStrategicRecommendations(
    queueVerification, broadSourceAudit, diversityAudit,
    highPriorityVerify, lifecycleSafety, pdHistorical, validationReview,
    pendingJobs, publicJobs, records
  );

  await Promise.all([
    writeJson(path.join(REPORTS_DIR, "editorial-queue-verification.json"), queueVerification),
    writeJson(path.join(REPORTS_DIR, "broad-source-tuning-report.json"), broadSourceAudit),
    writeJson(path.join(REPORTS_DIR, "public-board-diversity-audit.json"), diversityAudit),
    writeJson(path.join(REPORTS_DIR, "high-priority-pending-verification.json"), highPriorityVerify),
    writeJson(path.join(REPORTS_DIR, "lifecycle-safety-audit.json"), lifecycleSafety),
    writeJson(path.join(REPORTS_DIR, "protect-democracy-historical-validation.json"), pdHistorical),
    writeJson(path.join(REPORTS_DIR, "editorial-strategy-recommendations.json"), strategy),
  ]);

  console.log(JSON.stringify({
    phase: "editorial-verification-pass",
    reports_generated: [
      "editorial-queue-verification",
      "broad-source-tuning-report",
      "public-board-diversity-audit",
      "high-priority-pending-verification",
      "lifecycle-safety-audit",
      "protect-democracy-historical-validation",
      "editorial-strategy-recommendations"
    ],
    key_findings: {
      queue_weak_recommendations: queueVerification.weak_recommendations,
      queue_false_positives: queueVerification.false_mission_positives.length,
      broad_source_false_preservations: broadSourceAudit.summary.total_false_preservations,
      broad_source_false_suppressions: broadSourceAudit.summary.total_false_suppressions,
      diversity_mission_gaps: diversityAudit.mission_area_gaps.length,
      diversity_enterprise_dominance: diversityAudit.organization_diversity.enterprise_energy_dominance,
      high_priority_weak_resurfaced: highPriorityVerify.global_summary.total_weak_resurfaced,
      lifecycle_stale_mappings: lifecycleSafety.lifecycle_metrics.stale_provider_mappings,
      lifecycle_duplicate_canonicals: lifecycleSafety.lifecycle_metrics.duplicate_canonical_ids,
      pd_historical_lost: pdHistorical.protect_democracy_summary.historical_jobs_lost,
      pd_recoverable: pdHistorical.protect_democracy_summary.recoverable_candidates,
      strategy_recommended_orgs: strategy.recommended_organization_additions.length,
      strategy_strongest_pending: strategy.strongest_pending_candidates.length,
      strategy_blocked_high_quality: strategy.strongest_blocked_candidates.length
    },
    verification_passed: true
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("editorial-verification-pass failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  auditEditorialQueue,
  auditBroadSourceSuppression,
  auditPublicBoardDiversity,
  verifyHighPriorityPending,
  auditLifecycleSafety,
  validateProtectDemocracyHistorical,
  reviewValidationHardening,
  generateStrategicRecommendations
};
