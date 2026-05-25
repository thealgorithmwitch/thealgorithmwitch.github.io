#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");
const { readJson, writeJson, readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { readSourceHealthSnapshot } = require("./source-health-store");
const { normalizeJob, stringifySafe } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const JOBS2_FILE = path.join(ROOT, "jobs2.json");

const HIGH_PRIORITY_CATEGORIES = [
  "communications", "social media", "campaigns", "organizing",
  "policy", "advocacy", "partnerships", "civic tech",
  "storytelling", "content", "design", "creative",
  "legal/contracts", "research", "public interest data",
  "climate justice", "EJ"
];

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

const MANUAL_COMMUNITY_ORGS = [
  "Sunrise Movement", "Climate Justice Alliance", "Hip Hop Caucus",
  "Movement Generation", "Partnership for Public Good", "APEN",
  "WE ACT", "Bullard Center", "Indigenous Environmental Network",
  "Louisiana Bucket Brigade", "Youth Vs. Apocalypse"
];

const BROAD_SPECIALIZATION_SOURCES = {
  "quince": { suppress: ["ecommerce", "software", "engineering", "finance", "tax", "accounting", "retail"], preserve: ["climate", "communications", "public affairs", "partnerships", "sustainability", "policy", "campaigns", "organizing", "storytelling", "design", "content"] },
  "goodleap": { suppress: ["software", "engineering", "finance", "tax", "accounting", "sales"], preserve: ["climate", "sustainability", "policy", "partnerships", "communications"] },
  "woolpert": { suppress: ["engineering", "field", "construction", "finance", "tax", "accounting"], preserve: ["climate", "sustainability", "policy", "communications", "public affairs"] },
  "nextera-energy": { suppress: ["engineering", "field", "finance", "tax", "accounting", "retail"], preserve: ["climate", "sustainability", "policy", "communications", "public affairs", "campaigns", "partnerships"] },
  "rwe": { suppress: ["engineering", "field", "finance", "tax", "accounting", "retail"], preserve: ["climate", "sustainability", "policy", "communications", "public affairs", "campaigns", "partnerships", "storytelling"] },
  "grove-collaborative": { suppress: ["ecommerce", "retail", "finance", "tax", "accounting", "software", "engineering", "marketing"], preserve: ["climate", "sustainability", "policy", "communications", "partnerships", "content", "design", "storytelling"] }
};

const UNRELATED_TERMS = [
  /\becommerce\b/i, /\bretail\b/i, /\bmerchandis/i, /\blogistics\b/i,
  /\bwarehouse\b/i, /\bconstruction\b/i, /\bfield technician\b/i,
  /\bfield service\b/i, /\bcall center\b/i, /\bcustomer support\b/i,
  /\bquota[- ]?carrying\b/i, /\benterprise sales\b/i, /\binside sales\b/i,
  /\baccountant\b/i, /\bcontroller\b/i, /\bpayroll\b/i, /\btax manager\b/i,
  /\btax analyst\b/i, /\btechnical accounting\b/i
];

const PRESERVED_TERMS = [
  /\bclimate communications?\b/i, /\bpublic affairs\b/i,
  /\bsustainability\s*(?:strategy|manager|director|lead)?\b/i,
  /\bpolicy\s*(?:analyst|counsel|director|manager|advisor|lead)?\b/i,
  /\bcampaigns?\s*(?:manager|director|lead)?\b/i,
  /\borganizing\s*(?:director|manager|lead)?\b/i,
  /\bstorytelling\b/i, /\bpartnerships?\s*(?:manager|director|lead)?\b/i,
  /\bmission[- ]aligned\b/i, /\bclimate[- ]?tech\b/i
];

const NEGATIVE_SOURCE_SPECIALIZATIONS = {
  "quince": ["Software Engineer", "Frontend", "Backend", "Full Stack", "DevOps", "QA", "Data Engineer", "Machine Learning Engineer", "Sales", "Account Executive", "Ecommerce", "Merchant", "Retail", "Warehouse"],
  "goodleap": ["Software Engineer", "Frontend", "Backend", "Full Stack", "DevOps", "QA", "Data Engineer", "Sales", "Account Executive", "Finance", "Accountant", "Tax"],
  "woolpert": ["Software Engineer", "Civil Engineer", "Field Technician", "Field Service", "Construction", "Project Engineer", "Survey", "Finance", "Accountant"],
  "nextera-energy": ["Field Technician", "Field Service", "Construction", "Engineer", "Finance", "Accountant", "Tax"],
  "rwe": ["Field Technician", "Field Service", "Engineer", "Finance", "Accountant", "Tax", "Retail"],
  "grove-collaborative": ["Software Engineer", "Ecommerce", "Retail", "Merchant", "Marketing", "Finance", "Accountant", "Data Engineer"]
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function normalizeLoose(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function daysBetween(older, newer) {
  const olderTs = Date.parse(older || "");
  const newerTs = Date.parse(newer || "");
  if (Number.isNaN(olderTs) || Number.isNaN(newerTs)) return 0;
  return Math.max(0, Math.floor((newerTs - olderTs) / 86400000));
}

function scoreTextHits(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length;
}

function hasAny(text, patterns) {
  const haystack = String(text || "");
  return patterns.some((pattern) => pattern.test(haystack));
}

function buildJobText(job) {
  return [
    job.title, job.organization, job.sector, job.function,
    job.specialization, job.description, job.raw_description,
    toArray(job.tags).join(" "), job.notes, job.location
  ].filter(Boolean).join(" ");
}

function hasMissionAlignment(job) {
  const haystack = buildJobText(job).toLowerCase();
  const orgMatch = MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(haystack));
  const categoryMatch = HIGH_PRIORITY_PATTERNS.some((p) => p.test(haystack));
  const highPriorityCategory = HIGH_PRIORITY_CATEGORIES.some((c) => haystack.includes(c));
  return { matched: orgMatch || categoryMatch, orgMatch, categoryMatch, score: (orgMatch ? 10 : 0) + (categoryMatch ? 5 : 0) + (highPriorityCategory ? 3 : 0) };
}

function hasHighPriorityMatch(job) {
  const haystack = buildJobText(job).toLowerCase();
  return HIGH_PRIORITY_PATTERNS.some((p) => p.test(haystack));
}

function computeEditorialPriorityScore(job) {
  const haystack = buildJobText(job);
  const alignment = hasMissionAlignment(job);
  let score = 0;
  const reasons = [];
  if (alignment.matched) { score += alignment.score; reasons.push("mission_aligned"); }
  if (hasHighPriorityMatch(job)) { score += 5; reasons.push("high_priority_category"); }
  if (/\b(?:director|vice president|vp|head of|chief)\b/i.test(haystack)) { score += 3; reasons.push("senior_role"); }
  if (/\b(?:salary|compensation|pay|usd|gbp|eur)\b/i.test(haystack)) { score += 2; reasons.push("has_pay"); }
  if (/\b(?:remote|hybrid)\b/i.test(haystack)) { score += 1; reasons.push("flexible_work"); }
  if (hasAny(haystack, MISSION_ALIGNED_ORG_PATTERNS)) { score += 8; reasons.push("mission_org"); }
  if (job.relevance_score) score += Number(job.relevance_score) * 1.5;
  return { score: Math.round(score * 10) / 10, reasons, missionAlignmentScore: alignment.score, editorialPriorityScore: score };
}

function computeMissionAlignmentScore(job) {
  const haystack = buildJobText(job).toLowerCase();
  let score = 0;
  if (HIGH_PRIORITY_CATEGORIES.some((c) => haystack.includes(c))) score += 15;
  if (HIGH_PRIORITY_PATTERNS.some((p) => p.test(haystack))) score += 10;
  if (MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(haystack))) score += 25;
  if (/\bclimate\b/.test(haystack)) score += 8;
  if (/\b(?:environmental|sustainab)/i.test(haystack)) score += 5;
  if (/\b(?:democracy|voting|civic|public interest)/i.test(haystack)) score += 12;
  if (/\b(?:policy|advocacy|campaign)/i.test(haystack)) score += 7;
  return Math.min(100, score);
}

function isManualCommunityOrg(job) {
  const org = text(job.organization);
  return MANUAL_COMMUNITY_ORGS.some((name) => org.toLowerCase() === name.toLowerCase() || org.toLowerCase().includes(name.toLowerCase()));
}

function isTrackedManualOrg(org) {
  const normalized = normalizeLoose(org);
  return MANUAL_COMMUNITY_ORGS.some((name) => normalized === normalizeLoose(name) || normalized.includes(normalizeLoose(name)));
}

function isBroadSpecializationSource(sourceId) {
  return BROAD_SPECIALIZATION_SOURCES[text(sourceId).toLowerCase()] != null;
}

function hasSuppressedSpecialization(job, sourceId) {
  const sid = text(sourceId).toLowerCase();
  const config = BROAD_SPECIALIZATION_SOURCES[sid];
  if (!config) return { suppressed: false };
  const haystack = buildJobText(job).toLowerCase();
  const titleOnly = text(job.title || "").toLowerCase();
  const specializationOnly = text(job.specialization || "").toLowerCase();
  const suppressMatch = config.suppress.some((term) => haystack.includes(term));
  const preserveMatch = config.preserve.some((term) => titleOnly.includes(term) || specializationOnly.includes(term));
  if (preserveMatch) return { suppressed: false, preserveMatch: true };
  if (suppressMatch) return { suppressed: true, reason: "suppressed_specialization" };
  return { suppressed: false };
}

async function loadJobs2() {
  try {
    return JSON.parse(await fs.readFile(JOBS2_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function loadPendingSynced() {
  try {
    return await readPendingSyncedJobs();
  } catch {
    return [];
  }
}

async function loadRecords() {
  try {
    return await readJobRecords();
  } catch {
    return [];
  }
}

async function loadHealth() {
  try {
    return await readSourceHealthSnapshot();
  } catch {
    return { sources: [] };
  }
}

// ========== 1. HIGH-VALUE PENDING RESURFACING ==========

function identifyResurfacingCandidates(pendingJobs, records, healthSources) {
  const candidates = [];
  const now = nowIso();
  const healthBySource = new Map((healthSources || []).map((s) => [text(s.source_id), s]));

  for (const job of toArray(pendingJobs)) {
    const alignment = hasMissionAlignment(job);
    const priorityMatch = hasHighPriorityMatch(job);
    if (!alignment.matched && !priorityMatch) continue;
    const editorialScore = computeEditorialPriorityScore(job);
    const missionScore = computeMissionAlignmentScore(job);
    const sourceHealth = healthBySource.get(text(job.source_id));
    const fetchFailed = sourceHealth && (sourceHealth.failed_sync_count > 0 || sourceHealth.source_status === "sync_error");
    const isBacklogged = job.hidden_from_review_default === true || job.broad_source_backlog === true;
    const daysSinceFirstSeen = daysBetween(job.first_seen_at || job.date_added || now, now);
    const surfacedCount = Number(job.surfaced_count || 0);
    const candidate = {
      id: job.id,
      title: job.title,
      organization: job.organization,
      source_id: job.source_id,
      relevance_score: job.relevance_score,
      missionAlignmentScore: missionScore,
      editorialPriorityScore: editorialScore.score,
      resurfacingPriorityScore: Math.round((editorialScore.score + missionScore) * (1 + (isBacklogged ? 2 : 0) + (fetchFailed ? 1 : 0) - (surfacedCount * 0.1))),
      triage_bucket: job.triage_bucket,
      isBacklogged,
      fetchFailed,
      surfacedCount,
      daysSinceFirstSeen,
      hidden_from_review_default: job.hidden_from_review_default,
      broad_source_backlog: job.broad_source_backlog,
      alignment
    };
    candidates.push(candidate);
  }

  candidates.sort((a, b) => (b.resurfacingPriorityScore - a.resurfacingPriorityScore) || (b.editorialPriorityScore - a.editorialPriorityScore));
  return candidates;
}

function generateResurfacingPlan(candidates, pendingJobs) {
  const plan = { resurfaced: [], bypassed: [], summary: {} };
  let resurfacedCount = 0;
  let bypassedStale = 0;
  let bypassedSuppressed = 0;
  const updatedPending = [...toArray(pendingJobs)];

  for (const candidate of candidates) {
    if (resurfacedCount >= 15) break;
    if (!candidate.isBacklogged && !candidate.fetchFailed) continue;
    if (candidate.surfacedCount > 5) continue;

    const idx = updatedPending.findIndex((j) => j.id === candidate.id);
    if (idx === -1) continue;

    const job = updatedPending[idx];

    const sid = text(job.source_id).toLowerCase();
    const specConfig = BROAD_SPECIALIZATION_SOURCES[sid];
    if (specConfig) {
      const haystack = buildJobText(job).toLowerCase();
      const titleOnly = text(job.title || "").toLowerCase();
      const suppressMatch = specConfig.suppress.some((term) => haystack.includes(term));
      const preserveMatch = specConfig.preserve.some((term) => titleOnly.includes(term) || (text(job.specialization || "").toLowerCase().includes(term)));
      if (suppressMatch && !preserveMatch) {
        plan.bypassed.push({ id: candidate.id, title: candidate.title, organization: candidate.organization, reason: "suppressed_specialization", source_id: sid });
        bypassedSuppressed++;
        continue;
      }
    }

    const editorialScore = computeEditorialPriorityScore(job);
    const missionScore = computeMissionAlignmentScore(job);

    job.resurfacing_priority_score = editorialScore.score + missionScore;
    job.mission_alignment_score = missionScore;
    job.editorial_priority_score = editorialScore.score;
    job.hidden_from_review_default = false;
    job.broad_source_backlog = false;
    job.source_capped = false;
    job.skip_reason = "";
    job.surfaced_count = Number(job.surfaced_count || 0) + 1;
    job.last_review_cycle_at = nowIso();
    job.triage_bucket = "review_ready";
    job.triage_reason = "resurfaced_high_priority";
    updatedPending[idx] = job;
    plan.resurfaced.push({ id: candidate.id, title: candidate.title, organization: candidate.organization, score: job.resurfacing_priority_score });
    resurfacedCount++;
  }

  plan.summary = { totalCandidates: candidates.length, resurfaced: plan.resurfaced.length, bypassedStale, bypassedSuppressed };
  return { plan, updatedPending };
}

// ========== 2. PROTECT DEMOCRACY CONTINUITY AUDIT ==========

async function auditProtectDemocracyContinuity() {
  const jobs2 = await loadJobs2();
  const pendingJobs = await loadPendingSynced();
  const records = await loadRecords();
  const publicJobs = await readJobs().catch(() => []);

  const searchTerms = ["data scientist", "data", "democracy", "civic", "research", "policy", "voting", "protect democracy", "voteshield"];
  const findings = { searchedJobs2: [], pendingState: [], recordsState: [], publicState: [], recoveryCandidates: [], issues: [] };
  const foundInJobs2 = [];

  for (const job of jobs2) {
    const haystack = buildJobText(job).toLowerCase();
    const match = searchTerms.some((t) => haystack.includes(t));
    if (!match && text(job.organization).toLowerCase() !== "protect democracy") continue;
    const entry = { id: job.id, title: job.title, organization: job.organization, date: job.date_posted || job.date_added, status: job.status || job.triage_bucket };
    foundInJobs2.push(entry);
    if (text(job.organization).toLowerCase() === "protect democracy") {
      findings.searchedJobs2.push(entry);
    }
  }

  for (const job of toArray(pendingJobs)) {
    if (text(job.organization).toLowerCase() !== "protect democracy") continue;
    findings.pendingState.push({ id: job.id, title: job.title, status: job.triage_bucket, triage_reason: job.triage_reason, hidden: job.hidden_from_review_default, backlog: job.broad_source_backlog });
  }

  for (const rec of toArray(records)) {
    if (text(rec.raw_source_data?.organization).toLowerCase() !== "protect democracy") continue;
    findings.recordsState.push({ id: rec.id, title: rec.raw_source_data?.title, status: rec.status, verification_status: rec.verification_status, published: rec.published, updated_at: rec.updated_at });
  }

  for (const job of toArray(publicJobs)) {
    if (text(job.organization).toLowerCase() !== "protect democracy") continue;
    findings.publicState.push({ id: job.id, title: job.title, status: job.status });
  }

  const protectJobs2 = foundInJobs2.filter((j) => text(j.organization).toLowerCase() === "protect democracy");

  for (const job of protectJobs2) {
    const inPending = findings.pendingState.some((p) => p.title === job.title);
    const inPublic = findings.publicState.some((p) => p.title === job.title);
    const inRecords = findings.recordsState.some((p) => (p.title || "").toLowerCase() === text(job.title).toLowerCase());
    if (!inPending && !inPublic && !inRecords) {
      findings.issues.push({ severity: "high", message: `Historical job lost: ${job.title} (${job.id}) - not in pending, public, or records` });
    }
    if (job.status === "archived" || job.status === "rejected_noise") {
      findings.issues.push({ severity: "medium", message: `Historical job archived: ${job.title} (${job.id}) - status: ${job.status}` });
    }
  }

  const pendingProtectJobs = findings.pendingState.filter((j) => j.hidden || j.backlog);
  for (const job of pendingProtectJobs) {
    findings.issues.push({ severity: "medium", message: `Protect Democracy job trapped in backlog: ${job.title} (${job.id}) - hidden: ${job.hidden}, backlog: ${job.backlog}` });
    const matchedJobs2 = protectJobs2.find((j) => j.title === job.title);
    if (matchedJobs2) {
      findings.recoveryCandidates.push({ id: job.id, title: job.title, action: "resurface_from_backlog", reason: "Trapped in backlog but present in jobs2 history" });
    }
  }

  const existingPublicTitles = new Set(findings.publicState.map((j) => text(j.title).toLowerCase()));
  for (const job of protectJobs2) {
    if (existingPublicTitles.has(text(job.title).toLowerCase())) continue;
    if (findings.pendingState.some((p) => text(p.title).toLowerCase() === text(job.title).toLowerCase())) continue;
    findings.recoveryCandidates.push({ id: job.id, title: job.title, action: "restore_to_pending", reason: "Historical job exists in jobs2 but not in pending or public" });
  }

  const dataScientist = protectJobs2.find((j) => /data scientist/i.test(j.title));
  if (dataScientist) {
    findings.searchedJobs2.push({ note: "Data Scientist role found in jobs2", ...dataScientist });
    if (!findings.pendingState.some((p) => /data scientist/i.test(p.title)) && !findings.publicState.some((p) => /data scientist/i.test(p.title))) {
      findings.issues.push({ severity: "high", message: "Data Scientist role for Protect Democracy exists in jobs2 but is not in pending or public - likely lost during Recruitee normalization" });
      findings.recoveryCandidates.push({ id: dataScientist.id, title: dataScientist.title, action: "restore_to_pending", reason: "Data Scientist role lost during provider normalization" });
    }
  }

  const techPolicyStrategist = protectJobs2.find((j) => /tech policy strategist/i.test(j.title));
  if (techPolicyStrategist) {
    findings.issues.push({ severity: "medium", message: `Tech Policy Strategist (${techPolicyStrategist.id}) historical record exists - check if re-keyed` });
  }

  return findings;
}

async function recoverProtectDemocracyJobs(findings, pendingJobs) {
  const updatedPending = [...toArray(pendingJobs)];
  const recovered = [];

  for (const candidate of findings.recoveryCandidates) {
    if (candidate.action === "resurface_from_backlog") {
      const idx = updatedPending.findIndex((j) => j.id === candidate.id);
      if (idx !== -1) {
        updatedPending[idx].hidden_from_review_default = false;
        updatedPending[idx].broad_source_backlog = false;
        updatedPending[idx].source_capped = false;
        updatedPending[idx].skip_reason = "";
        updatedPending[idx].triage_bucket = "review_ready";
        updatedPending[idx].triage_reason = "recovered_protect_democracy_historical";
        updatedPending[idx].surfaced_count = Number(updatedPending[idx].surfaced_count || 0) + 1;
        updatedPending[idx].last_review_cycle_at = nowIso();
        const editorialScore = computeEditorialPriorityScore(updatedPending[idx]);
        updatedPending[idx].resurfacing_priority_score = editorialScore.score + computeMissionAlignmentScore(updatedPending[idx]);
        updatedPending[idx].mission_alignment_score = computeMissionAlignmentScore(updatedPending[idx]);
        updatedPending[idx].editorial_priority_score = editorialScore.score;
        recovered.push({ id: candidate.id, title: candidate.title, action: "resurfaced_from_backlog" });
      }
    }
  }

  return { updatedPending, recovered };
}

// ========== 3. MANUAL / COMMUNITY-REVIEW PIPELINE ==========

function classifyManualCommunitySources(sources) {
  const classified = toArray(sources).map((source) => {
    const org = text(source.organization || source.name || "");
    const isManual = isTrackedManualOrg(org) || source.manual_review_required === true;
    if (!isManual) return source;
    return {
      ...source,
      manual_editorial_source: true,
      tracked_manual_org: true,
      community_submission_source: source.community_submission === true || false,
      ats_provider: source.ats_provider || "",
      parser_type: "manual_editorial",
      source_classification: "manual_review_community",
      source_confidence_tier: "medium",
      lowered_fetch_failure_penalty: true,
      manual_freshness_tracking: true,
      editorial_reminder_path: "manual_editorial",
      sync_enabled: false,
      custom_sync_enabled: false,
      manually_updated_at: source.manually_updated_at || ""
    };
  });
  return classified;
}

function applyManualCommunityBehavior(job, source, options = {}) {
  if (!isManualCommunityOrg(job)) return job;
  return {
    ...job,
    manual_editorial_source: true,
    tracked_manual_org: true,
    lowered_fetch_failure_penalty: true,
    fail_sync_penalty_multiplier: 0.3,
    triage_bucket: options.skipAutoFail !== false ? "needs_cleanup" : job.triage_bucket,
    triage_reason: options.skipAutoFail !== false ? "manual_editorial_review_required" : job.triage_reason
  };
}

function generateManualCommunityReport(sources, pendingJobs) {
  const manualOrgs = MANUAL_COMMUNITY_ORGS.map((orgName) => {
    const sourceInfo = toArray(sources).find((s) => isTrackedManualOrg(text(s.organization || s.name)));
    const pendingCount = toArray(pendingJobs).filter((j) => isManualCommunityOrg(j)).length;
    return { organization: orgName, sourceFound: !!sourceInfo, sourceId: sourceInfo ? sourceInfo.id : null, pendingJobs: pendingCount, classification: "manual_editorial_source" };
  });
  return { organizations: manualOrgs, totalManualOrgs: MANUAL_COMMUNITY_ORGS.length, covered: manualOrgs.filter((o) => o.sourceFound).length, flagged: manualOrgs.filter((o) => !o.sourceFound).map((o) => o.organization) };
}

// ========== 4. QUALITY DENSITY METRICS ==========

function computeQualityMetrics(pendingJobs, publicJobs, records, sources) {
  const pending = toArray(pendingJobs);
  const pub = toArray(publicJobs);
  const recs = toArray(records);

  const publicWithAlignment = pub.filter((j) => hasMissionAlignment(j).matched);
  const highPriorityPending = pending.filter((j) => hasMissionAlignment(j).matched || hasHighPriorityMatch(j));
  const resurfacedHigh = pending.filter((j) => j.triage_reason === "resurfaced_high_priority");

  const genericRoles = pending.filter((j) => {
    const t = text(j.title || "").toLowerCase();
    return ["assistant", "coordinator", "specialist", "associate"].includes(t) && !hasMissionAlignment(j).matched;
  });

  const broadSourceCount = pending.filter((j) => {
    const sid = text(j.source_id);
    return ["quince", "goodleap", "woolpert", "nextera-energy", "rwe", "grove-collaborative"].includes(sid.toLowerCase());
  }).length;

  const orgDiversity = new Set(pub.map((j) => text(j.organization).toLowerCase())).size;
  const commsPolicyCount = pending.filter((j) => {
    const haystack = buildJobText(j).toLowerCase();
    return /\b(?:communications?|policy|advocacy|campaign)\b/i.test(haystack);
  }).length;

  const lowRelevanceBacklog = pending.filter((j) => j.skip_reason === "broad_source_low_relevance" || j.skip_reason === "source_cap_exceeded").length;
  const stalePublic = recs.filter((r) => {
    if (r.status !== "published") return false;
    const days = daysBetween(r.last_verified_at || r.updated_at || r.created_at || nowIso(), nowIso());
    return days > 14;
  }).length;

  const totalMissionAlignmentScore = pending.reduce((sum, j) => sum + computeMissionAlignmentScore(j), 0);
  const avgMissionAlignment = pending.length ? totalMissionAlignmentScore / pending.length : 0;
  const missionAlignedCount = pending.filter((j) => computeMissionAlignmentScore(j) >= 20).length;

  return {
    mission_alignment_ratio: pending.length ? Number((missionAlignedCount / pending.length).toFixed(3)) : 0,
    public_job_quality_score: pub.length ? Number((publicWithAlignment.length / pub.length * 100).toFixed(1)) : 0,
    generic_role_ratio: pending.length ? Number((genericRoles.length / pending.length).toFixed(3)) : 0,
    broad_source_dominance_ratio: pending.length ? Number((broadSourceCount / pending.length).toFixed(3)) : 0,
    public_org_diversity_score: orgDiversity,
    comms_policy_ratio: pending.length ? Number((commsPolicyCount / pending.length).toFixed(3)) : 0,
    low_relevance_backlog_ratio: pending.length ? Number((lowRelevanceBacklog / pending.length).toFixed(3)) : 0,
    stale_public_ratio: recs.length ? Number((stalePublic / recs.length).toFixed(3)) : 0,
    high_priority_pending_count: highPriorityPending.length,
    resurfaced_high_priority_count: resurfacedHigh.length,
    total_public: pub.length,
    total_pending: pending.length,
    total_records: recs.length,
    avg_mission_alignment_score: Number(avgMissionAlignment.toFixed(1)),
    mission_aligned_pending_count: missionAlignedCount,
    avg_editorial_priority: pending.length ? Number((pending.reduce((s, j) => s + Number(j.editorial_priority_score || 0), 0) / pending.length).toFixed(1)) : 0,
    broad_sources_with_active_pending: [...new Set(pending.filter((j) => isBroadSpecializationSource(j.source_id)).map((j) => text(j.source_id).toLowerCase()))],
    public_organizations: [...new Set(pub.map((j) => text(j.organization)).filter(Boolean))].sort(),
    pending_organizations: [...new Set(pending.map((j) => text(j.organization)).filter(Boolean))].sort()
  };
}

// ========== 5. BROAD-SOURCE SPECIALIZATION-AWARE SUPPRESSION ==========

function applySpecializationAwareSuppression(job, sourceId) {
  const result = hasSuppressedSpecialization(job, sourceId);
  if (!result.suppressed) return { suppressed: false, job: { ...job } };
  const updated = { ...job, skip_reason: result.reason, hidden_from_review_default: true, broad_source_backlog: true, specialization_suppressed: true };
  return { suppressed: true, job: updated, reason: result.reason };
}

function applyBroadSourceSpecializationControls(pendingJobs) {
  const updated = [];
  const applied = [];

  for (const job of toArray(pendingJobs)) {
    const sid = text(job.source_id).toLowerCase();
    if (!isBroadSpecializationSource(sid)) {
      updated.push(job);
      continue;
    }
    const result = applySpecializationAwareSuppression(job, sid);
    if (result.suppressed) {
      applied.push({ id: job.id, title: job.title, source_id: sid, reason: result.reason });
    }
    updated.push(result.job);
  }

  return { updatedPending: updated, suppressedEntries: applied };
}

// ========== 6. PUBLISHED JOB PRESERVATION HARDENING ==========

function applyPublishedJobPreservation(records) {
  const now = nowIso();
  const updatedRecords = toArray(records).map((record) => {
    if (record.status !== "published") return record;
    const existingGrace = record.published_grace_until;
    const existingConfirmations = Number(record.missing_from_source_confirmations || 0);
    const existingRequiredConfirmations = Math.max(1, Number(record.required_missing_confirmations || 2));

    const sourceIdentityHistory = toArray(record.source_identity_history || []);
    const canonicalIdentityHistory = toArray(record.canonical_identity_history || []);

    const canonicalId = record.id || record.raw_source_data?.id || "";
    if (canonicalId) {
      const existingEntry = canonicalIdentityHistory.find((e) => e.id === canonicalId);
      if (!existingEntry) {
        canonicalIdentityHistory.push({ id: canonicalId, title: record.raw_source_data?.title, organization: record.raw_source_data?.organization, recorded_at: now });
      }
    }

    const sourceId = record.raw_source_data?.source_id || record.source_id || "";
    if (sourceId) {
      const existingEntry = sourceIdentityHistory.find((e) => e.source_id === sourceId);
      if (!existingEntry) {
        sourceIdentityHistory.push({ source_id: sourceId, title: record.raw_source_data?.title, recorded_at: now });
      }
    }

    const archivalConfidenceScore = record.archival_confidence_score || 0;
    const hasGracePeriod = Boolean(existingGrace);

    return {
      ...record,
      published_grace_until: existingGrace || (hasGracePeriod ? existingGrace : ""),
      source_identity_history: sourceIdentityHistory,
      canonical_identity_history: canonicalIdentityHistory,
      archival_confidence_score: archivalConfidenceScore || (existingConfirmations > 0 ? Math.max(0, 100 - (existingConfirmations * 25)) : 0),
      has_active_grace_period: hasGracePeriod || existingRequiredConfirmations > 1
    };
  });

  return updatedRecords;
}

// ========== 7. EDITORIAL RECOMMENDATION QUEUE ==========

function buildEditorialPriorityQueue(pendingJobs, publicJobs, sources) {
  const pub = toArray(publicJobs);
  const pending = toArray(pendingJobs);
  const existingPublicOrgs = new Set(pub.map((j) => text(j.organization).toLowerCase()));
  const existingPublicTitles = new Set(pub.map((j) => text(j.title).toLowerCase() + "::" + text(j.organization).toLowerCase()));
  const sourceMap = new Map(toArray(sources).map((s) => [text(s.id), s]));

  const scored = pending.map((job) => {
    const missionScore = computeMissionAlignmentScore(job);
    const editorialScore = computeEditorialPriorityScore(job);
    const org = text(job.organization);
    const alreadyInPublic = existingPublicOrgs.has(org.toLowerCase());
    const titleOrgKey = text(job.title).toLowerCase() + "::" + org.toLowerCase();
    const isDuplicateTitle = existingPublicTitles.has(titleOrgKey);
    const hasPay = Boolean(job.salary || job.raw_salary || job.salary_min || job.salary_max);
    const hasLocation = Boolean(job.location);
    const isBacklogged = job.hidden_from_review_default === true || job.broad_source_backlog === true;
    const sourceInfo = sourceMap.get(text(job.source_id));
    const sourceTrusted = sourceInfo?.trusted === true;
    const manualOrg = isManualCommunityOrg(job);

    let queueScore = missionScore * 2 + editorialScore.score * 1.5;
    if (hasPay) queueScore += 5;
    if (hasLocation) queueScore += 3;
    if (!alreadyInPublic) queueScore += 10;
    if (isBacklogged) queueScore += 5;
    if (sourceTrusted) queueScore += 8;
    if (manualOrg) queueScore += 12;

    return {
      id: job.id,
      title: job.title,
      organization: org,
      source_id: job.source_id,
      mission_alignment_score: missionScore,
      editorial_priority_score: editorialScore.score,
      resurfacing_priority_score: job.resurfacing_priority_score || editorialScore.score + missionScore,
      queue_score: Math.round(queueScore),
      triage_bucket: job.triage_bucket,
      has_pay: hasPay,
      has_location: hasLocation,
      is_backlogged: isBacklogged,
      already_in_public_org: alreadyInPublic,
      is_duplicate_title: isDuplicateTitle,
      source_trusted: sourceTrusted,
      manual_editorial_source: manualOrg,
      skip_reason: job.skip_reason,
      reason: job.triage_reason
    };
  });

  scored.sort((a, b) => b.queue_score - a.queue_score || b.mission_alignment_score - a.mission_alignment_score || b.editorial_priority_score - a.editorial_priority_score);

  const topRecommendations = scored.filter((j) => j.queue_score >= 20 && !j.is_duplicate_title).slice(0, 30);
  const blockedHighQuality = scored.filter((j) => j.queue_score >= 25 && (j.is_backlogged || j.skip_reason)).slice(0, 20);
  const underrepresentedOrgs = [...new Set(pending.filter((j) => !existingPublicOrgs.has(text(j.organization).toLowerCase())).map((j) => text(j.organization)).filter(Boolean))].sort();

  return {
    generated_at: nowIso(),
    total_scored: scored.length,
    top_recommendations: topRecommendations,
    blocked_high_quality_jobs: blockedHighQuality,
    underrepresented_organizations: underrepresentedOrgs,
    summary: {
      public_org_count: existingPublicOrgs.size,
      pending_org_count: new Set(pending.map((j) => text(j.organization).toLowerCase())).size,
      high_priority_candidates: topRecommendations.length,
      blocked_count: blockedHighQuality.length,
      pending_orgs_not_in_public: underrepresentedOrgs.length
    }
  };
}

// ========== 8. VALIDATION ADDITIONS ==========

function validatePipelineHealth(pendingJobs, publicJobs, records, candidates) {
  const now = nowIso();
  const pub = toArray(publicJobs);
  const pending = toArray(pendingJobs);
  const recs = toArray(records);
  const warnings = [];
  const failures = [];

  // Sudden public board shrinkage
  if (pub.length < 30) warnings.push({ type: "warning", message: `Public board count (${pub.length}) is below 30 - possible unexpected shrinkage` });
  if (pub.length < 20) failures.push({ type: "failure", message: `Public board count (${pub.length}) critically low` });

  // Disappearance of high-priority orgs
  const publicOrgs = new Set(pub.map((j) => text(j.organization).toLowerCase()));
  const expectedOrgs = ["protect democracy", "earthjustice", "sierra club", "nrdc", "greenpeace", "350.org", "calstart", "carbon direct", "environmental defense fund"];
  for (const expected of expectedOrgs) {
    if (!publicOrgs.has(expected)) warnings.push({ type: "warning", message: `High-priority org "${expected}" not found in public jobs` });
  }

  // Disappearance of previously published jobs
  const recordIds = new Set(recs.filter((r) => r.status === "published").map((r) => r.id));
  const publicIds = new Set(pub.map((j) => j.id));
  const disappearedRecords = recs.filter((r) => r.status === "published" && !publicIds.has(r.id));
  if (disappearedRecords.length > 0) failures.push({ type: "failure", message: `${disappearedRecords.length} previously published jobs are missing from public output`, examples: disappearedRecords.slice(0, 5).map((r) => ({ id: r.id, title: r.raw_source_data?.title })) });

  // Excessive broad-source dominance
  const broadSourcePending = pending.filter((j) => isBroadSpecializationSource(j.source_id)).length;
  if (pending.length > 0 && (broadSourcePending / pending.length) > 0.4) warnings.push({ type: "warning", message: `Broad source dominance too high: ${(broadSourcePending / pending.length * 100).toFixed(0)}% of pending` });

  // High-quality pending jobs trapped too long
  const trapped = toArray(candidates).filter((c) => c.daysSinceFirstSeen > 30 && c.queue_score >= 25);
  if (trapped.length > 0) warnings.push({ type: "warning", message: `${trapped.length} high-quality pending jobs trapped >30 days`, examples: trapped.slice(0, 5).map((c) => ({ id: c.id, title: c.title, org: c.organization, days: c.daysSinceFirstSeen })) });

  // Missing currency symbols
  for (const job of pub) {
    if (job.salary && !/[\$£€]/i.test(job.salary)) warnings.push({ type: "warning", message: `Missing currency symbol in salary for ${job.title} at ${job.organization}: "${job.salary}"` });
  }

  // Malformed Workable intros
  for (const job of pub) {
    if (job.description && /^\)\s*[A-Z]/.test(job.description)) failures.push({ type: "failure", message: `Malformed Workable intro in ${job.title} at ${job.organization}` });
  }

  // Low public diversity score
  const publicOrgsCount = new Set(pub.map((j) => text(j.organization).toLowerCase())).size;
  if (publicOrgsCount < 15) warnings.push({ type: "warning", message: `Low public org diversity: only ${publicOrgsCount} unique organizations` });
  const missionOrgs = pub.filter((j) => MISSION_ALIGNED_ORG_PATTERNS.some((p) => p.test(text(j.organization))));
  if (missionOrgs.length < 3) warnings.push({ type: "warning", message: `Only ${missionOrgs.length} mission-aligned orgs on public board` });

  return { warnings, failures, total_warnings: warnings.length, total_failures: failures.length };
}

// ========== 9. PUBLIC BOARD TARGET STABILIZATION ==========

function analyzePublicBoardTarget(publicJobs, pendingJobs) {
  const pub = toArray(publicJobs);
  const pending = toArray(pendingJobs);

  const scoredPending = pending.map((j) => ({
    ...j,
    _missionScore: computeMissionAlignmentScore(j),
    _editorialScore: computeEditorialPriorityScore(j)
  }));

  const highQualityBlocked = scoredPending
    .filter((j) => j._missionScore >= 20 && j._editorialScore.score >= 10 && (j.hidden_from_review_default || j.broad_source_backlog))
    .sort((a, b) => b._missionScore - a._missionScore);

  const candidatesForPublic = scoredPending
    .filter((j) => {
      if (j._missionScore < 15) return false;
      if (!text(j.title) || !text(j.organization)) return false;
      if (pub.some((p) => text(p.title).toLowerCase() === text(j.title).toLowerCase() && text(p.organization).toLowerCase() === text(j.organization).toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => (b._missionScore + b._editorialScore.score) - (a._missionScore + a._editorialScore.score));

  const underrepresented = [...new Set(pending.map((j) => text(j.organization)).filter((org) => !pub.some((p) => text(p.organization).toLowerCase() === org.toLowerCase())).filter(Boolean))].sort();

  return {
    generated_at: nowIso(),
    current_public_count: pub.length,
    recommended_public_count_range: `${Math.max(36, pub.length)}-${Math.min(60, pub.length + 25)}`,
    target_summary: {
      current_public_count: pub.length,
      pending_count: pending.length,
      high_quality_pending_candidates: candidatesForPublic.length,
      blocked_high_quality: highQualityBlocked.length,
      underrepresented_orgs: underrepresented.length,
      editorial_thresholds_overly_conservative: pub.length <= 36 && highQualityBlocked.length > 5
    },
    blocked_high_quality_jobs: highQualityBlocked.slice(0, 15).map((j) => ({
      id: j.id, title: j.title, organization: j.organization,
      mission_score: j._missionScore, editorial_score: j._editorialScore.score,
      triage_bucket: j.triage_bucket, skip_reason: j.skip_reason
    })),
    recommended_pending_to_public_candidates: candidatesForPublic.slice(0, 20).map((j) => ({
      id: j.id, title: j.title, organization: j.organization,
      mission_score: j._missionScore, editorial_score: j._editorialScore.score,
      triage_bucket: j.triage_bucket
    })),
    underrepresented_organizations: underrepresented.slice(0, 30)
  };
}

// ========== MAIN ==========

async function main() {
  const [pendingJobs, publicJobs, records, sources, health, jobs2] = await Promise.all([
    loadPendingSynced(),
    readJobs().catch(() => []),
    loadRecords(),
    readSources().catch(() => []),
    loadHealth(),
    loadJobs2()
  ]);

  const healthSources = health.sources || [];

  // 1. High-value pending resurfacing
  const resurfacingCandidates = identifyResurfacingCandidates(pendingJobs, records, healthSources);
  const { plan: resurfacingPlan, updatedPending: afterResurfacing } = generateResurfacingPlan(resurfacingCandidates, pendingJobs);

  // 2. Protect Democracy continuity
  const pdFindings = await auditProtectDemocracyContinuity();
  const { updatedPending: afterPdRecovery, recovered: pdRecovered } = await recoverProtectDemocracyJobs(pdFindings, afterResurfacing);

  // 3. Manual/community pipeline classification
  const classifiedSources = classifyManualCommunitySources(sources);
  const manualReport = generateManualCommunityReport(classifiedSources, afterPdRecovery);

  // 4. Quality density metrics (on original pending for baseline)
  const qualityMetrics = computeQualityMetrics(pendingJobs, publicJobs, records, sources);

  // 5. Broad-source specialization controls
  const { updatedPending: afterSpecControl, suppressedEntries } = applyBroadSourceSpecializationControls(afterPdRecovery);

  // Apply manual community behavior
  const finalPending = afterSpecControl.map((job) => {
    if (isManualCommunityOrg(job)) {
      return { ...job, manual_editorial_source: true, tracked_manual_org: true, lowered_fetch_failure_penalty: true, fail_sync_penalty_multiplier: 0.3 };
    }
    return job;
  });

  // 6. Published job preservation
  const hardenedRecords = applyPublishedJobPreservation(records);

  // 7. Editorial recommendation queue
  const editorialQueue = buildEditorialPriorityQueue(finalPending, publicJobs, classifiedSources);

  // 8. Validation warnings
  const validation = validatePipelineHealth(finalPending, publicJobs, hardenedRecords, editorialQueue.top_recommendations);

  // 9. Public board target analysis
  const boardTarget = analyzePublicBoardTarget(publicJobs, finalPending);

  // Generate reports
  const pdAudit = { generated_at: nowIso(), findings: pdFindings, recovered: pdRecovered, summary: { totalHistoricalJobs: pdFindings.searchedJobs2.length, issuesFound: pdFindings.issues.length, recoveryCandidates: pdFindings.recoveryCandidates.length, recovered: pdRecovered.length } };
  const qualityReport = { generated_at: nowIso(), metrics: qualityMetrics, warnings: validation.warnings, failures: validation.failures };
  const priorityQueue = { generated_at: nowIso(), ...editorialQueue };

  await Promise.all([
    writeJson(path.join(REPORTS_DIR, "protect-democracy-continuity-audit.json"), pdAudit),
    writeJson(path.join(REPORTS_DIR, "board-quality-report.json"), qualityReport),
    writeJson(path.join(REPORTS_DIR, "editorial-priority-queue.json"), priorityQueue),
  ]);

  console.log(JSON.stringify({
    phase: "editorial-pipeline-stabilization",
    summary: {
      resurfacingCandidates: resurfacingCandidates.length,
      resurfaced: resurfacingPlan.resurfaced.length,
      protectDemocracyIssues: pdFindings.issues.length,
      protectDemocracyRecovered: pdRecovered.length,
      manualCommunityOrgs: manualReport.totalManualOrgs,
      suppressedBroadSource: suppressedEntries.length,
      qualityMetrics: {
        publicCount: qualityMetrics.total_public,
        pendingCount: qualityMetrics.total_pending,
        missionAlignmentRatio: qualityMetrics.mission_alignment_ratio,
        publicQualityScore: qualityMetrics.public_job_quality_score,
        highPriorityPending: qualityMetrics.high_priority_pending_count
      },
      validationWarnings: validation.warnings.length,
      validationFailures: validation.failures.length,
      editorialQueueTotal: editorialQueue.total_scored,
      topRecommendations: editorialQueue.top_recommendations.length,
      blockedHighQuality: editorialQueue.blocked_high_quality_jobs.length,
      recommendedPublicRange: boardTarget.recommended_public_count_range,
      editorialThresholdsOverlyConservative: boardTarget.target_summary.editorial_thresholds_overly_conservative
    },
    resurfacingPlan,
    pdRecovered,
    suppressedEntries,
    validation,
    boardTarget: {
      currentPublicCount: boardTarget.current_public_count,
      recommendedRange: boardTarget.recommended_public_count_range,
      blockedHighQualityCount: boardTarget.blocked_high_quality_jobs.length,
      pendingToPublicCandidates: boardTarget.recommended_pending_to_public_candidates.length
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("editorial-pipeline-stabilization failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  identifyResurfacingCandidates,
  generateResurfacingPlan,
  auditProtectDemocracyContinuity,
  recoverProtectDemocracyJobs,
  classifyManualCommunitySources,
  applyManualCommunityBehavior,
  generateManualCommunityReport,
  computeQualityMetrics,
  applySpecializationAwareSuppression,
  applyBroadSourceSpecializationControls,
  applyPublishedJobPreservation,
  buildEditorialPriorityQueue,
  validatePipelineHealth,
  analyzePublicBoardTarget,
  HIGH_PRIORITY_CATEGORIES,
  HIGH_PRIORITY_PATTERNS,
  MISSION_ALIGNED_ORG_PATTERNS,
  MANUAL_COMMUNITY_ORGS,
  BROAD_SPECIALIZATION_SOURCES,
  computeMissionAlignmentScore,
  computeEditorialPriorityScore,
  hasMissionAlignment,
  hasHighPriorityMatch,
  isManualCommunityOrg
};
