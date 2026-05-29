const path = require("path");
const fs = require("fs");
const {
  assessPublicJobReadiness,
  computeParserConfidenceScore,
  isBadPublicContent,
  isValidPublicLocation,
  normalizeJob,
  normalizeWorkplaceType,
  hasUsableDescription,
  stringifySafe
} = require("./job-normalizer");
const { hasInvalidPublicTitle } = require("./validate-public-data");
const { isBlockedSourceEntry } = require("./blocked-source-utils");
const { guardIncoming, loadArchiveRecords } = require("./archive-fingerprint-guard");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

const WEIGHTS = {
  description_quality: 0.25,
  url_quality: 0.15,
  pay_confidence: 0.20,
  freshness: 0.10,
  location: 0.10,
  duplicate: 0.10,
  source_trust: 0.10
};

const AUTO_PUBLISH_MIN_SCORE = 85;

const HIGH_RISK_SOURCES = new Set([
  "edp",
  "arevon",
  "conservation-international"
]);

const HIGH_RISK_PROVIDERS = new Set([
  "taleo"
]);

function getSourceConfig(sources, sourceId) {
  if (!Array.isArray(sources)) return null;
  return sources.find(s => String(s.id) === String(sourceId)) || null;
}

function computeDescriptionQuality(job) {
  let score = 0;
  const desc = String(job.description || job.raw_description || "");
  const snippet = String(job.description_snippet || "");
  const heading = String(job.description_heading_used || "");

  if (desc.length > 100) score += 30;
  else if (desc.length > 30) score += 15;

  if (!isBadPublicContent(desc) && !isBadPublicContent(job.raw_description)) score += 20;

  const junkPatterns = [
    /apply\s*(now|today|here)/i,
    /equal opportunity/i,
    /we are an/i,
    /qualified[-\s]?applicants/i,
    /e[- ]?verify/i,
    /drug[- ]?free/i
  ];
  const hasBoilerplate = junkPatterns.some(p => p.test(desc));
  if (!hasBoilerplate) score += 15;

  if (heading) score += 15;

  if (snippet && snippet.length > 50 && !junkPatterns.some(p => p.test(snippet))) score += 10;

  const hasUsefulContent = /responsibilities|qualifications|requirements|about\s+(the\s+)?(role|position)|what\s+you('ll| will)/i.test(desc);
  if (hasUsefulContent) score += 10;

  return Math.min(100, Math.max(0, score));
}

function computeUrlQuality(job) {
  let score = 0;
  const applyUrl = String(job.apply_url || job.original_url || "");
  const sourceUrl = String(job.source_url || "");
  const readiness = assessPublicJobReadiness(job);

  if (!applyUrl || !sourceUrl) {
    if (applyUrl) score += 10;
    return score;
  }

  if (readiness.apply_url_valid) score += 25;
  if (readiness.source_url_valid) score += 15;

  const genericBoardPatterns = [
    /linkedin\.com\/jobs/i,
    /indeed\.com/i,
    /glassdoor\.com/i,
    /monster\.com/i,
    /simplyhired/i,
    /ziprecruiter/i,
    /google\.com\/search/i
  ];
  const isGeneric = genericBoardPatterns.some(p => p.test(applyUrl));
  if (!isGeneric) score += 20;

  const loginSearchPatterns = [
    /login/i,
    /sign[-\s]?in/i,
    /auth/i,
    /search/i,
    /apply\s*$/i
  ];
  const isLoginSearch = loginSearchPatterns.some(p => p.test(applyUrl));
  if (!isLoginSearch) score += 15;

  const hasJobSpecificPath = /\/jobs\//i.test(applyUrl) ||
    /\/careers\//i.test(applyUrl) ||
    /\/job\//i.test(applyUrl) ||
    /\/position/i.test(applyUrl) ||
    /\/opportunity/i.test(applyUrl) ||
    /\/posting/i.test(applyUrl) ||
    /\?gh_jid=/i.test(applyUrl) ||
    /\/apply\//i.test(applyUrl);
  if (hasJobSpecificPath) score += 15;

  const applyUrlHostname = (applyUrl.match(/https?:\/\/([^\/]+)/) || [])[1] || "";
  const sourceUrlHostname = (sourceUrl.match(/https?:\/\/([^\/]+)/) || [])[1] || "";
  if (applyUrlHostname && applyUrlHostname === sourceUrlHostname) score += 10;

  return Math.min(100, Math.max(0, score));
}

function computePayConfidence(job) {
  let score = 0;
  const confidence = String(job.pay_confidence || "").toLowerCase();
  const salary = String(job.salary || "");
  const rawSalary = String(job.raw_salary || "");
  const rejectionReason = String(job.pay_rejection_reason || "");
  const candidateSnippets = Array.isArray(job.pay_candidate_snippets) ? job.pay_candidate_snippets : [];
  const failedSnippet = String(job.pay_parse_failed_snippet || "");

  if (confidence === "high") {
    score += 40;
  } else if (confidence === "medium") {
    score += 25;
  } else if (confidence === "low") {
    score += 10;
  } else {
    score += 0;
  }

  const hasParsedSalary = /[\d,]+/.test(salary) || (job.salary_min != null || job.salary_max != null);
  if (hasParsedSalary) score += 25;

  if (rawSalary && /[\d]/.test(rawSalary)) {
    const isRejected = rejectionReason === "missing_pay_context";
    if (!isRejected) score += 15;
    else score += 5;
  }

  if (rejectionReason) {
    if (rejectionReason === "missing_pay_context") {
      score += 5;
    } else if (rejectionReason === "exceeds_max_threshold_500k") {
      score += 0;
    } else if (rejectionReason === "looks_like_coordinate") {
      score += 0;
    }
  } else {
    score += 10;
  }

  if (candidateSnippets.length > 0 && candidateSnippets.some(s => /[\d,]+/.test(s))) {
    const hasCurrencies = candidateSnippets.some(s => /[$£€¥]/.test(s));
    if (hasCurrencies) score += 10;
  }

  if (failedSnippet && /[$£€¥]/.test(failedSnippet)) {
    score -= 10;
  }

  const hasReasonableRange = job.salary_min != null && job.salary_max != null &&
    job.salary_max > 0 && job.salary_max <= 500000 &&
    job.salary_max >= job.salary_min;
  if (hasReasonableRange) score += 10;
  else if (job.salary_min != null && job.salary_min <= 500000 && job.salary_min > 0) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function computeFreshnessScore(job) {
  let score = 50;
  const datePosted = String(job.date_posted || "");
  const dateAdded = String(job.date_added || "");
  const dateUpdated = String(job.date_updated || "");
  const lastChecked = String(job.last_checked_at || "");
  const sourceStatus = String(job.source_status || "").toLowerCase();
  const staleScore = job.stale_score != null ? Number(job.stale_score) : null;

  const closureSignals = [
    /position\s+(filled|closed)/i,
    /role\s+(filled|closed)/i,
    /this\s+(position|role)\s+(has been|is)\s+(filled|closed)/i,
    /no\s+(longer|more)\s+(accepting|available)/i,
    /application\s+(deadline|period)\s+(has|ended|passed)/i,
    /we\s+are\s+no\s+longer/i,
    /404/i.test(String(job.apply_url || "")),
    /page\s+not\s+found/i.test(String(job.description || ""))
  ];
  const hasClosure = closureSignals.some(s => typeof s === "boolean" ? s : s.test(String(job.description || "")));
  if (hasClosure) return 0;

  if (staleScore != null && staleScore > 50) {
    score -= 30;
  } else if (staleScore != null && staleScore > 20) {
    score -= 10;
  } else if (staleScore != null && staleScore === 0) {
    score += 10;
  }

  if (sourceStatus === "live") score += 10;
  else if (sourceStatus === "needs_review") score -= 10;

  if (lastChecked) {
    const checked = new Date(lastChecked);
    const now = new Date();
    const daysSinceCheck = (now - checked) / (1000 * 60 * 60 * 24);
    if (daysSinceCheck < 3) score += 15;
    else if (daysSinceCheck < 7) score += 5;
    else if (daysSinceCheck > 30) score -= 10;
  }

  if (datePosted) {
    const posted = new Date(datePosted);
    const now = new Date();
    const daysSincePosted = (now - posted) / (1000 * 60 * 60 * 24);
    if (daysSincePosted < 14) score += 15;
    else if (daysSincePosted > 90) score -= 10;
  }

  return Math.min(100, Math.max(0, score));
}

function computeLocationScore(job) {
  let score = 40;
  const location = String(job.location || "").trim();
  const workplaceType = String(job.workplace_type || "").trim();
  const normalizedWorkplace = workplaceType ? normalizeWorkplaceType(workplaceType, "") : "";

  if (!location) return 0;

  if (isValidPublicLocation(location)) score += 25;
  else score -= 15;

  const hasCityState = /^[A-Za-z\s.]+,\s*[A-Z]{2}/.test(location) ||
    /^[A-Za-z\s.]+,\s*[A-Za-z\s.]+,/.test(location);
  if (hasCityState) score += 15;

  const hasCountry = /USA|United States|Canada|UK|Germany|Remote/i.test(location);
  if (hasCountry) score += 10;

  if (normalizedWorkplace) {
    if (normalizedWorkplace === "Remote") {
      score += 10;
    } else if (normalizedWorkplace === "Hybrid") {
      score += 5;
    } else if (normalizedWorkplace === "On-site") {
      score += 10;
    }
  }

  if (normalizedWorkplace && location.toLowerCase().includes(normalizedWorkplace.toLowerCase())) {
    score -= 5;
  }

  return Math.min(100, Math.max(0, score));
}

function computeDuplicateScore(job, publicIndex, pendingIndex) {
  let score = 100;
  const duplicateKeys = buildDuplicateKeysSimple(job);

  duplicateKeys.forEach(key => {
    const publicMatches = (publicIndex?.get(key) || []).filter(id => id !== String(job.id));
    const pendingMatches = (pendingIndex?.get(key) || []).filter(id => id !== String(job.id));
    if (publicMatches.length) score -= 60;
    if (pendingMatches.length) score -= 30;
  });

  return Math.max(0, score);
}

function buildDuplicateKeysSimple(job) {
  const keys = new Set();
  const id = String(job.id || "").toLowerCase();
  const externalId = String(job.external_id || "").toLowerCase();
  const applyUrl = String(job.apply_url || job.original_url || "").toLowerCase();
  const org = String(job.organization || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const title = String(job.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const location = String(job.location || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (externalId) keys.add(`eid:${externalId}`);
  if (applyUrl) keys.add(`url:${applyUrl}`);
  if (org && title) keys.add(`ot:${org}:${title}`);
  if (org && title && location) keys.add(`otl:${org}:${title}:${location}`);

  return keys;
}

function computeSourceTrustScore(source) {
  if (!source) return 30;
  let score = 50;

  if (source.trusted) score += 20;
  if (source.auto_publish) score += 10;

  const scoring = source.source_scoring;
  if (scoring) {
    if (scoring.parser_stability === "high") score += 10;
    if (scoring.fetch_reliability === "high") score += 10;
    if (scoring.structured_ats_confidence === "high") score += 10;
    if (scoring.manual_cleanup_frequency === "low") score += 5;
    else if (scoring.manual_cleanup_frequency === "high") score -= 10;
    if (scoring.malformed_pay_rate === "low-target") score += 5;
    else if (scoring.malformed_pay_rate === "high") score -= 10;
    if (scoring.malformed_title_rate === "low-target") score += 5;
    else if (scoring.malformed_title_rate === "high") score -= 10;
    if (scoring.duplicate_rate === "low") score += 5;
  }

  const classification = String(source.source_classification || "");
  if (classification.includes("trusted") || classification.includes("high_confidence")) score += 10;
  else if (classification.includes("low_confidence") || classification.includes("experimental")) score -= 15;

  if (source.manual_review_required) score -= 10;

  const provider = String(source.provider || "").toLowerCase();
  if (["greenhouse", "lever", "ashby", "bamboohr"].includes(provider)) score += 5;
  if (provider === "workable") score += 5;
  if (provider === "taleo") score -= 15;

  return Math.min(100, Math.max(0, score));
}

function isHighRiskSource(source) {
  if (!source) return false;
  const org = String(source.organization || "").toLowerCase();
  const id = String(source.id || "").toLowerCase();
  const provider = String(source.provider || "").toLowerCase();

  if (HIGH_RISK_SOURCES.has(id) || HIGH_RISK_SOURCES.has(org)) return true;
  if (HIGH_RISK_PROVIDERS.has(provider)) return true;

  const scoring = source.source_scoring;
  if (scoring && provider === "bamboohr" && scoring.parser_stability === "low") return true;
  if (scoring && provider === "bamboohr" && scoring.malformed_pay_rate === "high") return true;
  if (scoring && provider === "bamboohr" && scoring.manual_cleanup_frequency === "high") return true;

  return false;
}

function calculateQualityScore(job, source, publicIndex, pendingIndex) {
  const descriptionQuality = computeDescriptionQuality(job);
  const urlQuality = computeUrlQuality(job);
  const payConfidence = computePayConfidence(job);
  const freshness = computeFreshnessScore(job);
  const location = computeLocationScore(job);
  const duplicate = computeDuplicateScore(job, publicIndex, pendingIndex);
  const sourceTrust = computeSourceTrustScore(source);

  const overall = Math.round(
    descriptionQuality * WEIGHTS.description_quality +
    urlQuality * WEIGHTS.url_quality +
    payConfidence * WEIGHTS.pay_confidence +
    freshness * WEIGHTS.freshness +
    location * WEIGHTS.location +
    duplicate * WEIGHTS.duplicate +
    sourceTrust * WEIGHTS.source_trust
  );

  return {
    overall: Math.min(100, Math.max(0, overall)),
    components: {
      description_quality: Math.min(100, Math.max(0, descriptionQuality)),
      url_quality: Math.min(100, Math.max(0, urlQuality)),
      pay_confidence: Math.min(100, Math.max(0, payConfidence)),
      freshness: Math.min(100, Math.max(0, freshness)),
      location: Math.min(100, Math.max(0, location)),
      duplicate: Math.min(100, Math.max(0, duplicate)),
      source_trust: Math.min(100, Math.max(0, sourceTrust))
    },
    weights: { ...WEIGHTS }
  };
}

function evaluateAutoPublish(job, source, qualityScore, publicIndex, pendingIndex) {
  const readiness = assessPublicJobReadiness(job, { source });
  const normalized = normalizeJob(job);
  const payState = evaluatePayStateSimple(job, normalized);
  const duplicateKeys = buildDuplicateKeysSimple(job);
  const archiveRecords = loadArchiveRecords();
  const guarded = guardIncoming([job], archiveRecords);

  const freshnessPassed = computeFreshnessScore(job) >= 30;
  const payValidationPassed = payState.status !== "uncertain_blocked";
  const descriptionValidationPassed = readiness.description_usable && !isBadPublicContent(job.description);
  const duplicateValidationPassed = !Array.from(duplicateKeys).some(key => {
    const pm = (publicIndex?.get(key) || []).filter(id => id !== String(job.id));
    return pm.length > 0;
  });
  const urlValidationPassed = readiness.apply_url_valid && readiness.source_url_valid;
  const archivePassed = guarded.blocked.length === 0;
  const highRiskManual = isHighRiskSource(source);

  const scorePassed = qualityScore.overall >= AUTO_PUBLISH_MIN_SCORE;
  const allGatesPassed = freshnessPassed && payValidationPassed && descriptionValidationPassed &&
    duplicateValidationPassed && urlValidationPassed && archivePassed;

  return {
    auto_publish: scorePassed && allGatesPassed && !highRiskManual,
    manual_approval_required: highRiskManual || !scorePassed || !allGatesPassed,
    auto_publish_score: qualityScore.overall,
    auto_publish_min_score: AUTO_PUBLISH_MIN_SCORE,
    gates: {
      quality_score_passed: scorePassed,
      freshness_passed: freshnessPassed,
      pay_validation_passed: payValidationPassed,
      description_validation_passed: descriptionValidationPassed,
      duplicate_validation_passed: duplicateValidationPassed,
      url_validation_passed: urlValidationPassed,
      archive_fingerprint_passed: archivePassed,
      high_risk_source_bypassed: !highRiskManual
    },
    high_risk_source: highRiskManual,
    high_risk_reason: highRiskManual ? determineHighRiskReason(source) : ""
  };
}

function determineHighRiskReason(source) {
  if (!source) return "unknown_source";
  const org = String(source.organization || "").toLowerCase();
  const id = String(source.id || "").toLowerCase();
  const provider = String(source.provider || "").toLowerCase();

  if (id === "edp" || org.includes("edp")) return "edp_source";
  if (id === "arevon" || org.includes("arevon")) return "arevon_source";
  if (id === "conservation-international" || org.includes("conservation")) return "conservation_international_source";
  if (provider === "taleo") return "taleo_provider";
  if (provider === "bamboohr") return "bamboohr_parser_failures";
  return "other_high_risk";
}

function evaluatePayStateSimple(job, normalized) {
  const n = normalized || job;
  const payWarning = String(n.pay_parse_warning || n.parse_warning || "");
  const payLike = Boolean(n.pay_like_detected);
  const salary = String(n.salary || "");

  if (salary && /[\d]+/.test(salary)) return { status: "clean", source: n.pay_parse_source || "parsed", confidence: n.pay_parse_confidence || "medium" };
  if (payWarning && payLike && !salary) return { status: "uncertain_blocked", source: n.pay_parse_source || "uncertain", confidence: n.pay_parse_confidence || "low" };
  if (n.pay_rejection_reason === "missing_pay_context") return { status: "uncertain_blocked", source: "parser", confidence: "low" };
  if (!salary && !payLike) return { status: "absent_allowed", source: "none", confidence: "low" };
  return { status: "uncertain_blocked", source: n.pay_parse_source || "unknown", confidence: n.pay_parse_confidence || "low" };
}

function accumulateDuplicateKeys(jobs) {
  const index = new Map();
  (jobs || []).forEach(job => {
    const keys = buildDuplicateKeysSimple(job);
    const id = String(job.id);
    keys.forEach(key => {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(id);
    });
  });
  return index;
}

async function runGovernance(options = {}) {
  const startedAt = new Date().toISOString();
  const { readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
  const { loadArchiveRecords } = require("./archive-fingerprint-guard");
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });

  const [publicJobs, pendingJobs, sources] = await Promise.all([
    readJobs(),
    readPendingSyncedJobs(),
    readSources()
  ]);

  const sourceMap = new Map();
  (sources || []).forEach(s => {
    const id = String(s.id || "").toLowerCase();
    sourceMap.set(id, s);
    if (s.organization) sourceMap.set(String(s.organization).toLowerCase(), s);
  });

  const publicIndex = accumulateDuplicateKeys(publicJobs);
  const pendingIndex = accumulateDuplicateKeys(pendingJobs);
  const archiveRecords = loadArchiveRecords();

  const decisions = [];
  let autoApproved = 0;
  let manualReview = 0;
  let archiveBlockedCount = 0;
  const scoreBuckets = { "0-20": 0, "21-40": 0, "41-60": 0, "61-84": 0, "85-100": 0 };
  const failureReasons = {};
  const sourceManualReview = {};
  const sourceJobCounts = {};

  for (const job of pendingJobs) {
    if (String(job.status || "").toLowerCase() === "archived") continue;

    const sourceId = String(job.source_id || "").toLowerCase();
    const source = sourceMap.get(sourceId) || sourceMap.get(String(job.organization || "").toLowerCase()) || null;

    const guarded = guardIncoming([job], archiveRecords);
    if (guarded.blocked.length) {
      archiveBlockedCount++;
      continue;
    }

    const quality = calculateQualityScore(job, source, publicIndex, pendingIndex);
    const governance = evaluateAutoPublish(job, source, quality, publicIndex, pendingIndex);

    const bucket = quality.overall <= 20 ? "0-20" :
      quality.overall <= 40 ? "21-40" :
      quality.overall <= 60 ? "41-60" :
      quality.overall <= 84 ? "61-84" : "85-100";
    scoreBuckets[bucket] = (scoreBuckets[bucket] || 0) + 1;

    if (governance.auto_publish) autoApproved++;
    else {
      manualReview++;
      const failReasons = [];
      for (const [gate, passed] of Object.entries(governance.gates)) {
        if (!passed) failReasons.push(gate);
      }
      failReasons.forEach(r => {
        failureReasons[r] = (failureReasons[r] || 0) + 1;
      });
    }

    const sourceKey = sourceId || String(job.source || job.organization || "unknown");
    if (governance.high_risk_source) {
      sourceManualReview[sourceKey] = (sourceManualReview[sourceKey] || 0) + 1;
    }
    sourceJobCounts[sourceKey] = (sourceJobCounts[sourceKey] || 0) + 1;

    decisions.push({
      id: String(job.id),
      title: String(job.title || ""),
      organization: String(job.organization || ""),
      source_id: sourceKey,
      source: String(job.source || ""),
      source_provider: source?.provider || "",
      quality_score: quality.overall,
      quality_components: quality.components,
      auto_publish: governance.auto_publish,
      manual_approval_required: governance.manual_approval_required,
      high_risk_source: governance.high_risk_source,
      high_risk_reason: governance.high_risk_reason,
      gates: governance.gates
    });
  }

  const highRiskSources = (sources || []).filter(s => isHighRiskSource(s)).map(s => ({
    id: s.id,
    name: s.name || s.organization,
    provider: s.provider,
    reason: determineHighRiskReason(s),
    manual_review_required: s.manual_review_required,
    pending_jobs: sourceJobCounts[String(s.id).toLowerCase()] || 0
  }));

  const report = {
    report_type: "publication-governance",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_pending_evaluated: decisions.length,
    auto_approved: autoApproved,
    manual_approval_required: manualReview,
    archive_fingerprint_blocked: archiveBlockedCount,
    auto_publish_threshold: AUTO_PUBLISH_MIN_SCORE,
    quality_score_distribution: scoreBuckets,
    top_failure_reasons: Object.entries(failureReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    high_risk_sources: highRiskSources.sort((a, b) => b.pending_jobs - a.pending_jobs),
    sources_triggering_manual_review: Object.entries(sourceManualReview)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    decisions: decisions.slice(0, 500),
    summary: {
      auto_publish_rate: decisions.length ? Math.round((autoApproved / decisions.length) * 100) : 0,
      manual_review_rate: decisions.length ? Math.round((manualReview / decisions.length) * 100) : 0,
      avg_quality_score: decisions.length ? Math.round(decisions.reduce((s, d) => s + d.quality_score, 0) / decisions.length) : 0
    }
  };

  const jsonPath = path.join(REPORTS_DIR, "publication-governance-latest.json");
  await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const mdPath = path.join(REPORTS_DIR, "publication-governance-latest.md");
  const md = generateGovernanceMarkdown(report);
  await fs.promises.writeFile(mdPath, md, "utf8");

  console.log(`[publication-governance] evaluated=${decisions.length} auto_approved=${autoApproved} manual_review=${manualReview} archive_blocked=${archiveBlockedCount}`);
  return report;
}

function generateGovernanceMarkdown(report) {
  let md = `# Publication Governance Report\n\n`;
  md += `Generated: ${report.finished_at}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total pending evaluated:** ${report.total_pending_evaluated}\n`;
  md += `- **Auto-approved:** ${report.auto_approved}\n`;
  md += `- **Manual approval required:** ${report.manual_approval_required}\n`;
  md += `- **Archive fingerprint blocked:** ${report.archive_fingerprint_blocked}\n`;
  md += `- **Auto-publish threshold:** ${report.auto_publish_threshold}\n`;
  md += `- **Auto-publish rate:** ${report.summary.auto_publish_rate}%\n`;
  md += `- **Average quality score:** ${report.summary.avg_quality_score}\n\n`;

  md += `## Quality Score Distribution\n\n`;
  md += `| Score Range | Count |\n`;
  md += `|---|---|\n`;
  for (const [bucket, count] of Object.entries(report.quality_score_distribution)) {
    md += `| ${bucket} | ${count} |\n`;
  }
  md += `\n`;

  md += `## Top Failure Reasons\n\n`;
  md += `| Reason | Count |\n`;
  md += `|---|---|\n`;
  for (const { reason, count } of report.top_failure_reasons) {
    md += `| ${reason} | ${count} |\n`;
  }
  md += `\n`;

  md += `## High-Risk Sources\n\n`;
  if (report.high_risk_sources.length === 0) {
    md += `None identified.\n\n`;
  } else {
    md += `| Source | Provider | Reason | Pending Jobs |\n`;
    md += `|---|---|---|---|\n`;
    for (const s of report.high_risk_sources) {
      md += `| ${s.name} | ${s.provider || "-"} | ${s.reason} | ${s.pending_jobs} |\n`;
    }
    md += `\n`;
  }

  md += `## Sources Triggering Manual Review\n\n`;
  if (report.sources_triggering_manual_review.length === 0) {
    md += `None.\n\n`;
  } else {
    md += `| Source | Pending Jobs Requiring Manual Review |\n`;
    md += `|---|---|\n`;
    for (const { source, count } of report.sources_triggering_manual_review) {
      md += `| ${source} | ${count} |\n`;
    }
    md += `\n`;
  }

  md += `## Auto-Approved Jobs\n\n`;
  const approved = report.decisions.filter(d => d.auto_publish);
  if (approved.length === 0) {
    md += `No jobs currently meet auto-publish threshold.\n\n`;
  } else {
    md += `| Job | Organization | Score |\n`;
    md += `|---|---|---|\n`;
    for (const d of approved) {
      md += `| ${d.title} (@ ${d.organization}) | ${d.organization} | ${d.quality_score} |\n`;
    }
    md += `\n`;
  }

  return md;
}

module.exports = {
  WEIGHTS,
  AUTO_PUBLISH_MIN_SCORE,
  HIGH_RISK_SOURCES,
  HIGH_RISK_PROVIDERS,
  calculateQualityScore,
  computeDescriptionQuality,
  computeUrlQuality,
  computePayConfidence,
  computeFreshnessScore,
  computeLocationScore,
  computeDuplicateScore,
  computeSourceTrustScore,
  isHighRiskSource,
  evaluateAutoPublish,
  runGovernance
};

if (require.main === module) {
  runGovernance({}).catch(err => {
    console.error(`[publication-governance] Failed: ${err.message}`);
    process.exitCode = 1;
  });
}
