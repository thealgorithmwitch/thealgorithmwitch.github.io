#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");
const { readJson, writeJson, readJobs, readPendingSyncedJobs, safeWritePublicJobs, JOBS_FILE, PENDING_SYNCED_FILE } = require("./job-utils");
const { readJobRecords, syncJobRecordStore, JOB_RECORDS_FILE } = require("./public-records");
const { normalizeJob, stringifySafe } = require("./job-normalizer");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

const APPROVED_PAY_GATED_ORGS = new Set([
  "Powerlines", "American Bird Conservancy", "HA Sustainable Infrastructure Capital",
  "Get Vocal", "The Good Food Institute", "Greenpeace", "Renew Home",
  "Woolpert", "Octopus Energy", "Clean Capital", "Dylan Green",
  "The Nature Conservancy", "World Resources Institute", "GoodPower",
  "League of Conservation Voters", "Arevon", "Louisiana Bucket Brigade", "Earthjustice"
]);

const MAX_AUTOPUBLISH_PER_RUN = 5;

const CURRENCY_SYMBOLS = ["$", "£", "€", "¥", "CAD", "USD", "GBP", "EUR"];

const GENERIC_TITLE_PATTERNS = [
  /\b(?:assistant|coordinator|specialist|associate)\s*(?:i|ii|iii|iv|jr|sr)?\s*$/i,
  /\bgeneral\s+application\b/i,
  /\bintern\b/i,
  /\bfellow\b/i,
  /\bclerk\b/i,
  /\btrainee\b/i,
  /\bsummer\s+(?:intern|associate|analyst)\b/i
];

const BLOCKED_TITLE_PATTERNS = [
  /\bsoftware\s+engineer\b/i,
  /\bfrontend\b/i,
  /\bbacke?nd\b/i,
  /\bfull\s*stack\b/i,
  /\bdevops\b/i,
  /\bdata\s+engineer\b/i,
  /\bmachine\s+learning\b/i,
  /\bqa\s+engineer\b/i
];

function hasPay(job) {
  const hasSalaryFields = Boolean(
    job.salary_min || job.salary_max || job.raw_salary || job.salary
  );
  if (!hasSalaryFields) return false;
  const salaryText = String(job.salary || job.raw_salary || "").trim();
  const hasCurrency = CURRENCY_SYMBOLS.some((sym) => salaryText.includes(sym));
  if (!hasCurrency && !job.salary_min && !job.salary_max) return false;
  const salaryVisible =
    typeof job.salary_visible === "boolean"
      ? job.salary_visible
      : (salaryText.length > 0);
  return salaryVisible === true;
}

function getPayQuality(job) {
  const min = Number(job.salary_min) || 0;
  const max = Number(job.salary_max) || 0;
  if (min > 0 && max > 0) return "excellent";
  if (min > 0 || max > 0) return "good";
  if (job.salary || job.raw_salary) return "present";
  return "none";
}

function hasGoodParserConfidence(job) {
  const conf = String(job.parser_confidence || job.confidence || "").toLowerCase();
  return conf === "high" || conf === "acceptable";
}

function hasStrongContentQuality(job) {
  const score = Number(job.content_quality_score || job.contentQualityScore || 0);
  return score >= 70;
}

function hasValidApplyUrl(job) {
  const url = String(job.apply_url || job.applyUrl || job.url || "").trim();
  return url.startsWith("http") && !url.includes("mailto:") && url.length > 10;
}

function hasSpecificTitle(job) {
  const title = String(job.title || "").trim();
  if (title.length < 5) return false;
  if (GENERIC_TITLE_PATTERNS.some((p) => p.test(title))) return false;
  return true;
}

function hasBlockedTitle(job) {
  const title = String(job.title || "").trim();
  return BLOCKED_TITLE_PATTERNS.some((p) => p.test(title));
}

function isApprovedOrg(job) {
  const org = String(job.organization || "").trim().toLowerCase();
  for (const approved of APPROVED_PAY_GATED_ORGS) {
    if (org.includes(approved.toLowerCase())) return true;
  }
  return false;
}

function isAlreadyPublic(job, publicJobsMap) {
  const id = String(job.id || "").trim();
  if (id && publicJobsMap.has(id)) return true;
  const sourceFp = job.source_fingerprint || job.fingerprint || "";
  if (sourceFp && publicJobsMap.has(sourceFp)) return true;
  const title = String(job.title || "").trim().toLowerCase();
  const org = String(job.organization || "").trim().toLowerCase();
  if (title && org && publicJobsMap.has(title + "||" + org)) return true;
  return false;
}

function isPendingViable(job) {
  const bucket = String(job.triage_bucket || "").toLowerCase();
  if (bucket === "rejected_noise" || bucket === "needs_cleanup") return false;
  if (job.rejected_noise || job.skip_reason === "blocked_source") return false;
  return true;
}

function prioritySortKey(job) {
  const eps = Number(job.editorial_priority_score || 0);
  const mas = Number(job.mission_alignment_score || 0);
  const pq = getPayQuality(job) === "excellent" ? 2 : getPayQuality(job) === "good" ? 1 : 0;
  const fresh = String(job.date_posted || job.date_added || "").slice(0, 10);
  return [ -eps, -mas, -pq, fresh ];
}

function scoreJob(job) {
  let score = 0;
  const eps = Number(job.editorial_priority_score || 0);
  const mas = Number(job.mission_alignment_score || 0);
  if (eps >= 40) score += 50;
  else if (eps >= 30) score += 35;
  else if (eps >= 20) score += 20;
  else score += 5;
  if (mas >= 30) score += 30;
  else if (mas >= 15) score += 15;
  const title = String(job.title || "").toLowerCase();
  const primaryTerms = ["communications", "social media", "campaigns", "policy", "advocacy", "partnerships", "content", "climate", "sustainability", "legal", "research", "organizing", "public interest"];
  const secondaryTerms = ["manager", "director", "lead", "coordinator", "analyst", "specialist", "officer", "counsel", "associate", "consultant"];
  for (const t of primaryTerms) {
    if (title.includes(t)) score += 10;
  }
  for (const t of secondaryTerms) {
    if (title.includes(t)) score += 3;
  }
  score += Math.max(0, 30 - Math.abs(Date.now() - new Date(job.date_posted || Date.now()).getTime()) / (1000 * 86400));
  return score;
}

function checkOrgSpecificRules(job) {
  const title = String(job.title || "").toLowerCase();
  const org = String(job.organization || "").toLowerCase();

  if (org.includes("get vocal")) {
    const climateTerms = ["climate", "environment", "environmental", "content", "social media", "influencer", "creative"];
    const hasClimate = climateTerms.some((t) => title.includes(t));
    if (!hasClimate) {
      return { allowed: false, reason: "Get Vocal: non-climate role" };
    }
  }

  if (org.includes("woolpert")) {
    const missionTerms = ["climate", "energy", "sustainability", "environmental", "renewable", "clean", "geospatial", "gis"];
    const hasMission = missionTerms.some((t) => title.includes(t));
    if (!hasMission) {
      return { allowed: false, reason: "Woolpert: non-mission role" };
    }
  }

  if (org.includes("octopus")) {
    const preferredTerms = ["market", "partner", "comms", "communic", "content", "campaign", "policy", "legal", "contract", "operations", "digital", "analytics", "finance", "analyst", "manager", "lead"];
    const isPreferred = preferredTerms.some((t) => title.includes(t));
    if (!isPreferred) {
      return { allowed: false, reason: "Octopus: non-preferred role" };
    }
  }

  return { allowed: true, reason: "" };
}

function buildPublicJobShape(pendingJob) {
  const now = new Date().toISOString();
  const title = stringifySafe(pendingJob.title);
  const org = stringifySafe(pendingJob.organization);
  const location = stringifySafe(pendingJob.location || pendingJob.location_text || "");
  return {
    id: stringifySafe(pendingJob.id) || [org, title, now.slice(0, 10)].filter(Boolean).join("-").replace(/\s+/g, "-").toLowerCase(),
    ref: stringifySafe(pendingJob.ref || pendingJob.external_id),
    external_id: stringifySafe(pendingJob.external_id),
    source_id: stringifySafe(pendingJob.source_id),
    title,
    organization: org,
    location,
    workplace_type: stringifySafe(pendingJob.workplace_type || pendingJob.workplaceType || ""),
    salary: stringifySafe(pendingJob.salary || pendingJob.raw_salary || ""),
    salary_min: pendingJob.salary_min != null ? Number(pendingJob.salary_min) : null,
    salary_max: pendingJob.salary_max != null ? Number(pendingJob.salary_max) : null,
    salary_currency: stringifySafe(pendingJob.salary_currency || pendingJob.salaryCurrency || "USD"),
    salary_period: stringifySafe(pendingJob.salary_period || pendingJob.salaryPeriod || "yearly"),
    salary_visible: true,
    apply_url: stringifySafe(pendingJob.apply_url || pendingJob.applyUrl || ""),
    source_url: stringifySafe(pendingJob.source_url || pendingJob.sourceUrl || ""),
    original_url: stringifySafe(pendingJob.original_url || pendingJob.originalUrl || ""),
    description: stringifySafe(pendingJob.description || pendingJob.description_text || ""),
    date_posted: stringifySafe(pendingJob.date_posted || pendingJob.datePosted || now.slice(0, 10)),
    date_added: stringifySafe(pendingJob.date_added || pendingJob.dateAdded || now.slice(0, 10)),
    date_updated: now.slice(0, 10),
    tags: Array.isArray(pendingJob.tags) ? pendingJob.tags : [],
    status: "active",
    published: true,
    public_visibility: true,
    featured: false,
    parser_confidence: stringifySafe(pendingJob.parser_confidence || "medium"),
    parser_confidence_score: Number(pendingJob.parser_confidence_score || 0),
    content_quality_score: Number(pendingJob.content_quality_score || 70),
    editorial_priority_score: Number(pendingJob.editorial_priority_score || 0),
    mission_alignment_score: Number(pendingJob.mission_alignment_score || 0),
    relevance_score: Number(pendingJob.relevance_score || pendingJob.relevanceScore || 0),
    source_fingerprint: stringifySafe(pendingJob.source_fingerprint || ""),
    specialization: stringifySafe(pendingJob.specialization || pendingJob.display?.specialization || ""),
    last_checked_at: now,
    last_seen_at: now,
    source_status: "live",
    trusted: true,
    auto_publish: false,
    triage_bucket: "review_ready",
    notes: stringifySafe(pendingJob.notes || "")
  };
}

async function main() {
  const logger = console;
  logger.log("=== Pay-Gated Auto-Publish ===");
  logger.log("MAX_AUTOPUBLISH_PER_RUN:", MAX_AUTOPUBLISH_PER_RUN);
  logger.log("APPROVED_ORGS:", Array.from(APPROVED_PAY_GATED_ORGS).join(", "));

  const [pendingJobs, publicJobs, records] = await Promise.all([
    readPendingSyncedJobs(),
    readJobs().catch(() => []),
    readJobRecords().catch(() => [])
  ]);

  const publicJobsMap = new Map();
  for (const j of publicJobs) {
    const id = stringifySafe(j.id);
    if (id) publicJobsMap.set(id, true);
    const fp = stringifySafe(j.source_fingerprint || j.fingerprint);
    if (fp) publicJobsMap.set(fp, true);
    const title = stringifySafe(j.title || "").trim().toLowerCase();
    const org = stringifySafe(j.organization || "").trim().toLowerCase();
    if (title && org) publicJobsMap.set(title + "||" + org, true);
  }
  for (const r of records) {
    if (r.status === "published" && r.public_visibility) {
      const id = stringifySafe(r.id);
      if (id) publicJobsMap.set(id, true);
      const fp = stringifySafe(r.source_fingerprint);
      if (fp) publicJobsMap.set(fp, true);
    }
  }

  const candidates = [];

  for (const job of pendingJobs) {
    if (!isApprovedOrg(job)) continue;
    if (!isPendingViable(job)) continue;
    if (isAlreadyPublic(job, publicJobsMap)) continue;

    const payOk = hasPay(job);
    const confOk = hasGoodParserConfidence(job);
    const qualityOk = hasStrongContentQuality(job);
    const urlOk = hasValidApplyUrl(job);
    const titleOk = hasSpecificTitle(job);
    const titleBlocked = hasBlockedTitle(job);

    const orgSpecific = checkOrgSpecificRules(job);

    const egs = {
      id: stringifySafe(job.id),
      title: stringifySafe(job.title),
      organization: stringifySafe(job.organization),
      editorial_priority_score: Number(job.editorial_priority_score || 0),
      mission_alignment_score: Number(job.mission_alignment_score || 0),
      pay: payOk,
      pay_quality: getPayQuality(job),
      parser_confidence: confOk,
      content_quality: qualityOk,
      apply_url_valid: urlOk,
      title_specific: titleOk,
      title_not_blocked: !titleBlocked,
      org_approved: orgSpecific.allowed,
      org_reason: orgSpecific.reason,
      passes_all: payOk && confOk && qualityOk && urlOk && titleOk && !titleBlocked && orgSpecific.allowed
    };

    if (egs.passes_all) {
      candidates.push({
        job,
        score: scoreJob(job),
        sortKey: prioritySortKey(job),
        checks: egs
      });
    }
  }

  candidates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.sortKey.length, b.sortKey.length); i++) {
      const av = a.sortKey[i] || 0;
      const bv = b.sortKey[i] || 0;
      if (typeof av === "number" && typeof bv === "number") {
        if (av !== bv) return av - bv;
      } else {
        const cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return cmp;
      }
    }
    return b.score - a.score;
  });

  const selected = candidates.slice(0, MAX_AUTOPUBLISH_PER_RUN);

  logger.log(`Candidates found: ${candidates.length}`);
  logger.log(`Selected for publish: ${selected.length}`);

  const publishedJobs = [];
  const publishedIds = new Set();

  for (const entry of selected) {
    const job = entry.job;
    const publicJob = buildPublicJobShape(job);
    publishedJobs.push(publicJob);
    publishedIds.add(stringifySafe(job.id));
    logger.log(`  PUBLISH: ${publicJob.organization} - ${publicJob.title} (eps=${entry.checks.editorial_priority_score}, pay=${entry.checks.pay})`);
  }

  if (publishedJobs.length === 0) {
    logger.log("No jobs to auto-publish. Generating report only.");
    const report = {
      generated_at: new Date().toISOString(),
      total_pending_reviewed: pendingJobs.length,
      total_public_existing: publicJobs.length,
      approved_org_count: APPROVED_PAY_GATED_ORGS.size,
      candidates_found: candidates.length,
      selected_for_publish: 0,
      candidate_details: candidates.slice(0, 20).map((c) => ({
        id: c.checks.id,
        title: c.checks.title,
        organization: c.checks.organization,
        editorial_priority_score: c.checks.editorial_priority_score,
        mission_alignment_score: c.checks.mission_alignment_score,
        checks: { pay: c.checks.pay, parser_confidence: c.checks.parser_confidence, content_quality: c.checks.content_quality, apply_url_valid: c.checks.apply_url_valid, title_specific: c.checks.title_specific, org_approved: c.checks.org_approved, org_reason: c.checks.org_reason }
      })),
      summary: { pay_gated_autopublish: 0, max_per_run: MAX_AUTOPUBLISH_PER_RUN, future_candidates: candidates.length }
    };
    await writeJson(path.join(REPORTS_DIR, "pay-gated-autopublish-report.json"), report);
    return report;
  }

  const mergedPublicJobs = [...publicJobs];
  for (const pub of publishedJobs) {
    const existingIdx = mergedPublicJobs.findIndex((j) => stringifySafe(j.id) === pub.id);
    if (existingIdx >= 0) {
      mergedPublicJobs[existingIdx] = pub;
    } else {
      mergedPublicJobs.push(pub);
    }
  }

  const writeResult = await safeWritePublicJobs(mergedPublicJobs, { logger, label: "pay-gated-autopublish" });
  logger.log(`jobs.json wrote=${writeResult.wrote} changed=${writeResult.changed} total=${writeResult.jobs.length}`);

  await syncJobRecordStore(writeResult.jobs, { logger, label: "pay-gated-autopublish", context: "pay_gated_autopublish" });

  // Post-sync fix: buildJobRecord preserves existing record's published/public_visibility/status
  // when the record already exists (lines 422-425 of public-records.js). We must fix these flags.
  const postSyncRecords = await readJson(JOB_RECORDS_FILE, []);
  let recordFixCount = 0;
  const fixedRecords = postSyncRecords.map((rec) => {
    const id = stringifySafe(rec.id);
    if (publishedIds.has(id) && rec.record_type === "job") {
      let changed = false;
      if (rec.published !== true) { rec.published = true; changed = true; }
      if (rec.public_visibility !== true) { rec.public_visibility = true; changed = true; }
      if (String(rec.status || "") !== "published") { rec.status = "published"; changed = true; }
      if (["expired", "removed", "needs_review"].includes(String(rec.verification_status || "").toLowerCase())) { rec.verification_status = "verified"; changed = true; }
      if (changed) recordFixCount++;
    }
    return rec;
  });
  if (recordFixCount > 0) {
    await fs.writeFile(JOB_RECORDS_FILE, JSON.stringify(fixedRecords, null, 2) + "\n", "utf8");
    logger.log(`Fixed ${recordFixCount} record(s) with wrong published flags`);
  }
  logger.log("job-records.json synced");

  const remainingPending = pendingJobs.filter((j) => !publishedIds.has(stringifySafe(j.id)));
  await writeJson(PENDING_SYNCED_FILE, remainingPending);
  logger.log(`pending-synced-jobs.json updated: ${pendingJobs.length} -> ${remainingPending.length}`);

  const report = {
    generated_at: new Date().toISOString(),
    total_pending_reviewed: pendingJobs.length,
    total_public_existing: publicJobs.length,
    approved_org_count: APPROVED_PAY_GATED_ORGS.size,
    candidates_found: candidates.length,
    selected_for_publish: selected.length,
    published_jobs: publishedJobs.map((j) => ({
      id: j.id,
      title: j.title,
      organization: j.organization,
      salary: j.salary || `${j.salary_min || "?"}-${j.salary_max || "?"}`,
      editorial_priority_score: j.editorial_priority_score,
      mission_alignment_score: j.mission_alignment_score
    })),
    candidate_details: candidates.slice(0, 20).map((c) => ({
      id: c.checks.id,
      title: c.checks.title,
      organization: c.checks.organization,
      editorial_priority_score: c.checks.editorial_priority_score,
      mission_alignment_score: c.checks.mission_alignment_score,
      checks: { pay: c.checks.pay, parser_confidence: c.checks.parser_confidence, content_quality: c.checks.content_quality, apply_url_valid: c.checks.apply_url_valid, title_specific: c.checks.title_specific, org_approved: c.checks.org_approved, org_reason: c.checks.org_reason }
    })),
    summary: { pay_gated_autopublish: publishedJobs.length, max_per_run: MAX_AUTOPUBLISH_PER_RUN, remaining_candidates: candidates.length - selected.length, future_candidates: candidates.length }
  };

  await writeJson(path.join(REPORTS_DIR, "pay-gated-autopublish-report.json"), report);
  logger.log("Report generated: reports/pay-gated-autopublish-report.json");

  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("pay-gated-autopublish failed:", err.message);
    process.exit(1);
  });
}

module.exports = { main, APPROVED_PAY_GATED_ORGS, MAX_AUTOPUBLISH_PER_RUN, hasPay, getPayQuality, hasGoodParserConfidence, hasStrongContentQuality, hasValidApplyUrl, hasSpecificTitle, isApprovedOrg, isAlreadyPublic, prioritySortKey, buildPublicJobShape, checkOrgSpecificRules };
