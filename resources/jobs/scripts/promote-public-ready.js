const fs = require("fs/promises");
const path = require("path");
const {
  assessPublicJobReadiness,
  normalizeWorkableUrl,
  computeParserConfidenceScore,
  isBadPublicContent,
  isPotentiallyHumanApplyUrl,
  isValidPublicLocation,
  isValidSourceUrl,
  normalizeJob,
  normalizeWorkplaceType,
  stringifySafe
} = require("./job-normalizer");
const { hasInvalidPublicTitle, isValidPayDisplay } = require("./validate-public-data");
const { isBlockedSourceEntry } = require("./blocked-source-utils");
const { guardIncoming, loadArchiveRecords } = require("./archive-fingerprint-guard");
const { readJobs, readPendingSyncedJobs, readSources, writeJsonIfChanged } = require("./job-utils");
const {
  JOB_RECORDS_FILE,
  buildJobFingerprint,
  buildJobRecord,
  readJobRecords,
  sanitizeJobRecordForStorage
} = require("./public-records");
const { applyPublishLifecycle } = require("./lifecycle-utils");
const { syncPublicJobsFromRecords } = require("./public-jobs");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const REPORT_FILE = path.join(REPORTS_DIR, "public-promotion-latest.json");
const APPROVED_COMPANIES_FILE = path.join(ROOT, "auto-publish-approved-companies.json");
const VERY_HIGH_CONFIDENCE_THRESHOLD = 90;
const DEFAULT_PROMOTION_CAP = 10;
const DEFAULT_COMPANY_CAP = 5;
const NON_BLOCKING_MANUAL_REVIEW_REASONS = new Set([
  "meets review-ready threshold"
]);

function parseArgs(argv) {
  const parsed = {
    dryRun: argv.includes("--dry-run") || !argv.includes("--write"),
    write: argv.includes("--write"),
    autoPublish: argv.includes("--auto-publish"),
    promoteExistingPending: argv.includes("--promote-existing-pending"),
    maxAutoPublishPerRun: DEFAULT_PROMOTION_CAP,
    candidateIds: []
  };

  argv.forEach((arg, index) => {
    if (arg === "--candidate-id" && argv[index + 1]) {
      parsed.candidateIds.push(String(argv[index + 1] || "").trim());
      return;
    }
    if (arg.startsWith("--candidate-id=")) {
      parsed.candidateIds.push(String(arg.split("=").slice(1).join("=") || "").trim());
      return;
    }
    if (arg === "--max-auto-publish-per-run" && argv[index + 1]) {
      parsed.maxAutoPublishPerRun = Number(argv[index + 1]) || DEFAULT_PROMOTION_CAP;
      return;
    }
    if (arg.startsWith("--max-auto-publish-per-run=")) {
      parsed.maxAutoPublishPerRun = Number(arg.split("=").slice(1).join("=")) || DEFAULT_PROMOTION_CAP;
    }
  });

  parsed.maxAutoPublishPerRun = Math.max(0, Math.floor(parsed.maxAutoPublishPerRun || DEFAULT_PROMOTION_CAP));
  parsed.candidateIds = Array.from(new Set(parsed.candidateIds.filter(Boolean)));
  return parsed;
}

function getWorkableApplyValidationReason(job = {}, source = {}) {
  const haystack = `${stringifySafe(source.provider)} ${stringifySafe(job.source)} ${stringifySafe(job.apply_url)} ${stringifySafe(job.source_url)}`.toLowerCase();
  if (!/workable/.test(haystack)) return "";
  const applyUrl = normalizeWorkableUrl(job.apply_url || job.original_url).url || stringifySafe(job.apply_url || job.original_url);
  if (!applyUrl) return "missing_apply_url";
  if (!isPotentiallyHumanApplyUrl(applyUrl, { source })) return "workable_apply_url_not_human_usable";
  return "human_apply_url_confirmed";
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildDuplicateKeys(job = {}) {
  const keys = new Set();
  const id = stringifySafe(job.id).toLowerCase();
  const externalId = stringifySafe(job.external_id).toLowerCase();
  const applyUrl = stringifySafe(job.apply_url || job.original_url).toLowerCase();
  const sourceUrl = stringifySafe(job.source_url || job.original_url).toLowerCase();
  const originalUrl = stringifySafe(job.original_url).toLowerCase();
  const identity = [
    normalizeToken(job.title),
    normalizeToken(job.organization),
    normalizeToken(job.location)
  ].join("::");

  if (id) keys.add(`id:${id}`);
  if (externalId) keys.add(`external:${externalId}`);
  if (applyUrl) keys.add(`apply:${applyUrl}`);
  if (sourceUrl) keys.add(`source:${sourceUrl}`);
  if (originalUrl) keys.add(`original:${originalUrl}`);
  if (identity.replace(/:/g, "")) keys.add(`identity:${identity}`);
  return Array.from(keys);
}

function accumulateDuplicateKeys(items = []) {
  const index = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item) return;
    const id = stringifySafe(item.id);
    buildDuplicateKeys(item).forEach((key) => {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(id);
    });
  });
  return index;
}

function buildSourceMap(sources = []) {
  const byId = new Map();
  const byUrl = new Map();
  const byOrg = new Map();

  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const normalized = source || {};
    const id = stringifySafe(normalized.id);
    const url = stringifySafe(normalized.source_url || normalized.url);
    const organization = normalizeToken(normalized.organization || normalized.name);
    if (id) byId.set(id, normalized);
    if (url) byUrl.set(url, normalized);
    if (organization && !byOrg.has(organization)) byOrg.set(organization, normalized);
  });

  return { byId, byUrl, byOrg };
}

function resolveSourceForJob(job, sourceMap) {
  const sourceId = stringifySafe(job.source_id);
  const sourceUrl = stringifySafe(job.source_url || job.original_url);
  const organization = normalizeToken(job.organization);
  return sourceMap.byId.get(sourceId)
    || sourceMap.byUrl.get(sourceUrl)
    || sourceMap.byOrg.get(organization)
    || null;
}

function hasHighSourceConfidence(source = {}) {
  const scoring = source && typeof source.source_scoring === "object" ? source.source_scoring : {};
  return Boolean(
    source.trusted === true
    || source.high_confidence_immediate_upload === true
    || String(scoring.structured_ats_confidence || "").trim().toLowerCase() === "high"
    || (
      String(scoring.parser_stability || "").trim().toLowerCase() === "high"
      && String(scoring.fetch_reliability || "").trim().toLowerCase() === "high"
    )
  );
}

function hasCleanOrganization(job = {}) {
  const organization = stringifySafe(job.organization);
  if (!organization) return false;
  if (organization.length > 120) return false;
  if (/https?:\/\//i.test(organization)) return false;
  if (isBadPublicContent(organization)) return false;
  return true;
}

function isPowerlinesWorkableJob(job = {}, source = {}) {
  const organization = stringifySafe(job.organization).toLowerCase();
  const haystack = `${stringifySafe(source.provider)} ${stringifySafe(job.source)} ${stringifySafe(job.apply_url)} ${stringifySafe(job.source_url)}`.toLowerCase();
  return organization.includes("powerlines") && haystack.includes("workable");
}

function hasManualReviewSignal(job = {}) {
  const reasons = [
    stringifySafe(job.review_reason),
    stringifySafe(job.triage_reason),
    stringifySafe(job.parse_warning)
  ].filter(Boolean);
  const blockingReasons = reasons.filter((reason) => !NON_BLOCKING_MANUAL_REVIEW_REASONS.has(String(reason).trim().toLowerCase()));
  return {
    blocked: blockingReasons.length > 0,
    reasons: blockingReasons,
    allReasons: reasons
  };
}

function isWorkableWithoutHumanApply(job = {}, source = {}) {
  const haystack = `${stringifySafe(source.provider)} ${stringifySafe(job.source)} ${stringifySafe(job.apply_url)} ${stringifySafe(job.source_url)}`.toLowerCase();
  if (!/workable/.test(haystack)) return false;
  return !isPotentiallyHumanApplyUrl(job.apply_url || job.original_url, { source });
}

function buildExistingRecordIndex(records = []) {
  const byId = new Map();
  const byFingerprint = new Map();

  (Array.isArray(records) ? records : []).forEach((record) => {
    if (!record || record.record_type !== "job") return;
    const id = stringifySafe(record.id);
    const fingerprint = stringifySafe(record.source_fingerprint);
    if (id) byId.set(id, record);
    if (fingerprint) byFingerprint.set(fingerprint, record);
  });

  return { byId, byFingerprint };
}

function upsertRecord(records = [], nextRecord) {
  const nextId = stringifySafe(nextRecord.id);
  const fingerprint = stringifySafe(nextRecord.source_fingerprint);
  const out = [];
  let replaced = false;

  (Array.isArray(records) ? records : []).forEach((record) => {
    const sameId = nextId && stringifySafe(record.id) === nextId;
    const sameFingerprint = fingerprint && stringifySafe(record.source_fingerprint) === fingerprint;
    if (sameId || sameFingerprint) {
      if (!replaced) {
        out.push(nextRecord);
        replaced = true;
      }
      return;
    }
    out.push(record);
  });

  if (!replaced) out.push(nextRecord);
  return out;
}

function summarizeRejectionCounts(rejections = []) {
  const counts = {};
  (Array.isArray(rejections) ? rejections : []).forEach((rejection) => {
    (Array.isArray(rejection.reasons) ? rejection.reasons : []).forEach((reason) => {
      counts[reason] = (counts[reason] || 0) + 1;
    });
  });
  return counts;
}

function collectPromotableCandidates(pendingJobs, candidateIds) {
  const list = Array.isArray(pendingJobs) ? pendingJobs : [];
  if (!candidateIds.length) return list;
  const idSet = new Set(candidateIds.map((id) => stringifySafe(id)).filter(Boolean));
  return list.filter((job) => idSet.has(stringifySafe(job.id)));
}

function buildExpectedPagePath(pageUrl) {
  const normalized = stringifySafe(pageUrl).replace(/^\.\//, "");
  return normalized ? path.join(ROOT, normalized) : "";
}

async function verifyPromotedPages(publicJobs = [], promotedIds = []) {
  const publicById = new Map((Array.isArray(publicJobs) ? publicJobs : []).map((job) => [stringifySafe(job.id), job]));
  const checks = [];

  for (const id of promotedIds) {
    const publicJob = publicById.get(stringifySafe(id));
    const pageUrl = stringifySafe(publicJob?.page_url);
    const pagePath = buildExpectedPagePath(pageUrl);
    let exists = false;
    if (pagePath) {
      try {
        await fs.access(pagePath);
        exists = true;
      } catch (_error) {
        exists = false;
      }
    }
    checks.push({
      id: stringifySafe(id),
      page_url: pageUrl,
      page_exists: exists
    });
  }

  return checks;
}

async function loadApprovedCompaniesConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(APPROVED_COMPANIES_FILE, "utf8"));
    return {
      perCompanyCap: Math.max(1, Math.floor(Number(parsed?.default_per_company_cap || parsed?.per_company_cap) || DEFAULT_COMPANY_CAP)),
      approvedCompanies: Array.isArray(parsed?.approved_companies)
        ? parsed.approved_companies.map((item) => normalizeToken(item)).filter(Boolean)
        : [],
      approvedSources: Array.isArray(parsed?.approved_sources)
        ? parsed.approved_sources.map((item) => normalizeToken(item)).filter(Boolean)
        : [],
      perCompanyCaps: parsed?.per_company_caps && typeof parsed.per_company_caps === "object"
        ? Object.fromEntries(Object.entries(parsed.per_company_caps).map(([key, value]) => [normalizeToken(key), Math.max(1, Math.floor(Number(value) || DEFAULT_COMPANY_CAP))]))
        : {},
      perSourceCaps: parsed?.per_source_caps && typeof parsed.per_source_caps === "object"
        ? Object.fromEntries(Object.entries(parsed.per_source_caps).map(([key, value]) => [normalizeToken(key), Math.max(1, Math.floor(Number(value) || DEFAULT_COMPANY_CAP))]))
        : {}
    };
  } catch (_error) {
    return {
      perCompanyCap: DEFAULT_COMPANY_CAP,
      approvedCompanies: [],
      approvedSources: [],
      perCompanyCaps: {},
      perSourceCaps: {}
    };
  }
}

function inferApplyUrlType(job = {}) {
  const applyUrl = normalizeWorkableUrl(job.apply_url || job.original_url).url || stringifySafe(job.apply_url || job.original_url);
  const sourceUrl = normalizeWorkableUrl(job.source_url || job.original_url).url || stringifySafe(job.source_url || job.original_url);
  if (/\/Recruiting\/Jobs\/Apply\//i.test(applyUrl) || /apply\.workable\.com/i.test(applyUrl)) return "ats_apply_page";
  if (applyUrl && sourceUrl && applyUrl !== sourceUrl) return "direct_application_page";
  return "job_description_page";
}

function resolveDescriptionSourceUrl(job = {}) {
  return normalizeWorkableUrl(job.description_source_url || job.raw_payload?.description_source_url || job.source_url || job.original_url).url
    || stringifySafe(job.description_source_url || job.raw_payload?.description_source_url || job.source_url || job.original_url);
}

function resolvePaySourceUrl(job = {}) {
  return normalizeWorkableUrl(job.pay_source_url || job.raw_payload?.pay_source_url || job.source_url || job.original_url).url
    || stringifySafe(job.pay_source_url || job.raw_payload?.pay_source_url || job.source_url || job.original_url);
}

function evaluatePayState(job = {}) {
  const salary = stringifySafe(job.salary);
  const rawSalary = stringifySafe(job.raw_salary);
  const warning = stringifySafe(job.pay_parse_warning);
  const parseSource = stringifySafe(job.pay_parse_source || "none") || "none";
  const payLikeDetected = Boolean(job.pay_like_detected) || Boolean(rawSalary) || Boolean(salary);

  if (warning || (payLikeDetected && !salary)) {
    return {
      status: "uncertain_blocked",
      source: parseSource === "none" ? "description_body" : parseSource,
      confidence: stringifySafe(job.pay_parse_confidence || "low") || "low",
      rejectionReason: stringifySafe(job.pay_rejection_reason || warning || "pay_like_detected_but_not_parsed"),
      candidateSnippets: Array.isArray(job.pay_candidate_snippets) ? job.pay_candidate_snippets : [],
      rejectedSnippets: Array.isArray(job.pay_rejected_snippets) ? job.pay_rejected_snippets : []
    };
  }
  if (salary) {
    return {
      status: "clean",
      source: parseSource === "none" ? "ats_field" : parseSource,
      confidence: stringifySafe(job.pay_parse_confidence || "high") || "high",
      rejectionReason: "",
      candidateSnippets: Array.isArray(job.pay_candidate_snippets) ? job.pay_candidate_snippets : [],
      rejectedSnippets: Array.isArray(job.pay_rejected_snippets) ? job.pay_rejected_snippets : []
    };
  }
  return {
    status: "absent_allowed",
    source: "none",
    confidence: "none",
    rejectionReason: "",
    candidateSnippets: Array.isArray(job.pay_candidate_snippets) ? job.pay_candidate_snippets : [],
    rejectedSnippets: Array.isArray(job.pay_rejected_snippets) ? job.pay_rejected_snippets : []
  };
}

function isApprovedSource(source = {}, normalized = {}, approvedSources = new Set()) {
  const candidates = [
    source.provider,
    source.id,
    source.organization,
    normalized.source,
    normalized.source_id
  ].map((value) => normalizeToken(value)).filter(Boolean);
  return candidates.some((candidate) => approvedSources.has(candidate));
}

function resolveCompanyCap(job = {}, source = {}, approvedConfig = {}) {
  const organizationToken = normalizeToken(job.organization);
  const providerToken = normalizeToken(source?.provider || job.source);
  return approvedConfig.perCompanyCaps?.[organizationToken]
    || approvedConfig.perSourceCaps?.[providerToken]
    || approvedConfig.perCompanyCap
    || DEFAULT_COMPANY_CAP;
}

function buildCandidateDecision(job, source, publicIndex, pendingIndex, options = {}) {
  const normalized = normalizeJob(job);
  if (!normalized) {
    return { action: "reject", reasons: ["normalize_failed"], normalized: null };
  }

  const readiness = assessPublicJobReadiness(normalized, { source });
  const parserConfidenceScore = computeParserConfidenceScore(normalized);
  const manualReview = hasManualReviewSignal(normalized);
  const reasons = [];
  const duplicateKeys = buildDuplicateKeys(normalized);
  const sourceHighConfidence = hasHighSourceConfidence(source || {});
  const sourceTrusted = Boolean(source?.trusted);
  const approvedCompanyMatch = options.approvedCompanies.has(normalizeToken(normalized.organization));
  const approvedSourceMatch = isApprovedSource(source || {}, normalized, options.approvedSources || new Set());
  const workplaceType = stringifySafe(normalized.workplace_type);
  const normalizedWorkplaceType = workplaceType ? normalizeWorkplaceType(workplaceType, "") : "";
  const payState = evaluatePayState(normalized);
  const workableHumanApplyConfirmed = !isWorkableWithoutHumanApply(normalized, source || {});
  const workableApplyValidationReason = getWorkableApplyValidationReason(normalized, source || {});
  const companyCap = resolveCompanyCap(normalized, source, options.approvedConfig || {});

  if (isBlockedSourceEntry({ ...normalized, ...source })) reasons.push("blocked_source");
  if (parserConfidenceScore < VERY_HIGH_CONFIDENCE_THRESHOLD) reasons.push("parser_confidence_not_very_high");
  if (!readiness.apply_url_valid) reasons.push("invalid_human_apply_url");
  if (!readiness.source_url_valid) reasons.push("invalid_source_url");
  if (hasInvalidPublicTitle(normalized.title) || isBadPublicContent(normalized.title)) reasons.push("invalid_public_title");
  if (!hasCleanOrganization(normalized)) reasons.push("invalid_organization");
  if (stringifySafe(normalized.location) && !isValidPublicLocation(normalized.location)) reasons.push("invalid_location");
  if (workplaceType && !normalizedWorkplaceType) reasons.push("invalid_workplace_type");
  if (!readiness.description_usable) reasons.push("description_not_usable");
  if (isBadPublicContent(normalized.description) || isBadPublicContent(normalized.raw_description)) reasons.push("junk_content_detected");
  if (payState.status === "uncertain_blocked") {
    reasons.push("pay_not_clean");
  }
  if (isPowerlinesWorkableJob(normalized, source || {}) && payState.status !== "clean") {
    reasons.push("powerlines_requires_clean_pay_signal");
  }
  if (!sourceTrusted && !sourceHighConfidence && !approvedCompanyMatch && !approvedSourceMatch) reasons.push("source_not_trusted_or_high_confidence");
  if (!workableHumanApplyConfirmed) reasons.push("workable_no_human_apply_page");
  if (manualReview.blocked) {
    manualReview.reasons.forEach((reason) => reasons.push(`manual_review_required:${reason}`));
  }
  readiness.reasons
    .filter((reason) => !["parser_confidence_below_public_threshold"].includes(reason))
    .forEach((reason) => reasons.push(reason));

  duplicateKeys.forEach((key) => {
    const publicMatches = (publicIndex.get(key) || []).filter((id) => id && id !== stringifySafe(normalized.id));
    const pendingMatches = (pendingIndex.get(key) || []).filter((id) => id && id !== stringifySafe(normalized.id));
    if (publicMatches.length) reasons.push("duplicate_public_job");
    if (pendingMatches.length) reasons.push("duplicate_pending_review");
  });

  return {
    action: reasons.length === 0 ? "promote" : "reject",
    reasons: Array.from(new Set(reasons)),
    normalized,
    parserConfidenceScore,
    sourceTrusted,
    sourceHighConfidence,
    approvedCompanyMatch,
    approvedSourceMatch,
    payStatus: payState.status,
    payParseSource: payState.source,
    payParseConfidence: payState.confidence,
    payCandidateSnippets: payState.candidateSnippets,
    payRejectedSnippets: payState.rejectedSnippets,
    payRejectionReason: payState.rejectionReason,
    workableHumanApplyConfirmed,
    workableApplyValidationReason,
    companyCap
  };
}

async function runPromotion(options = {}) {
  const args = {
    dryRun: options.dryRun === true,
    write: options.write === true,
    autoPublish: options.autoPublish === true,
    maxAutoPublishPerRun: Math.max(0, Math.floor(options.maxAutoPublishPerRun || DEFAULT_PROMOTION_CAP)),
    candidateIds: Array.isArray(options.candidateIds) ? options.candidateIds.map((id) => stringifySafe(id)).filter(Boolean) : []
  };
  const startedAt = new Date().toISOString();
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const approvedConfig = await loadApprovedCompaniesConfig();

  const [pendingJobs, publicJobsBefore, sources, existingRecords] = await Promise.all([
    readPendingSyncedJobs(),
    readJobs(),
    readSources(),
    readJobRecords()
  ]);
  const sourceMap = buildSourceMap(sources);
  const candidates = collectPromotableCandidates(pendingJobs, args.candidateIds);
  const publicIndex = accumulateDuplicateKeys(publicJobsBefore);
  const pendingIndex = accumulateDuplicateKeys(pendingJobs);
  const recordIndex = buildExistingRecordIndex(existingRecords);
  const archiveGuardRecords = loadArchiveRecords();
  let archiveBlockedCount = 0;
  const considered = [];
  const promoted = [];
  const rejected = [];
  let payAbsentAllowedCount = 0;
  let payUncertainBlockedCount = 0;
  let workableConsidered = 0;
  let workableEligible = 0;

  for (const candidate of candidates) {
    const guarded = guardIncoming([candidate], archiveGuardRecords);
    if (guarded.blocked.length) {
      const b = guarded.blocked[0];
      console.log(`[promote-public-ready] Skipping archived/rejected candidate "${candidate.title}" (${candidate.organization}) — matched ${b.matched_archive_id}: ${b.matched_archive_status}`);
      archiveBlockedCount++;
      rejected.push({ id: candidate.id, title: candidate.title, reason: `archive_fingerprint_blocked: matched ${b.matched_archive_id} (${b.matched_archive_status})` });
      continue;
    }
    const source = resolveSourceForJob(candidate, sourceMap);
    const decision = buildCandidateDecision(candidate, source, publicIndex, pendingIndex, {
      ...args,
      approvedCompanies: new Set(approvedConfig.approvedCompanies),
      approvedSources: new Set(approvedConfig.approvedSources),
      approvedConfig
    });
    const companyToken = normalizeToken(candidate.organization);
    const isWorkable = /workable/i.test(`${stringifySafe(source?.provider)} ${stringifySafe(candidate.source)} ${stringifySafe(candidate.apply_url)} ${stringifySafe(candidate.source_url)}`);
    const workableDiagnostic = normalizeWorkableUrl(decision.normalized?.apply_url || candidate.apply_url || candidate.original_url || candidate.source_url);
    if (decision.payStatus === "absent_allowed") payAbsentAllowedCount += 1;
    if (decision.payStatus === "uncertain_blocked") payUncertainBlockedCount += 1;
    if (isWorkable) workableConsidered += 1;
    considered.push({
      id: stringifySafe(candidate.id),
      title: stringifySafe(candidate.title),
      organization: stringifySafe(candidate.organization),
      source: stringifySafe(candidate.source),
      source_id: stringifySafe(candidate.source_id),
      source_url: stringifySafe(decision.normalized?.source_url || candidate.source_url),
      apply_url: stringifySafe(decision.normalized?.apply_url || candidate.apply_url || candidate.original_url),
      apply_url_type: inferApplyUrlType(decision.normalized || candidate),
      description_source_url: resolveDescriptionSourceUrl(decision.normalized || candidate),
      pay_source_url: resolvePaySourceUrl(decision.normalized || candidate),
      company_token: companyToken,
      parser_confidence_score: decision.parserConfidenceScore ?? computeParserConfidenceScore(candidate),
      pay_status: decision.payStatus,
      pay_parse_source: decision.payParseSource,
      pay_parse_confidence: decision.payParseConfidence,
      pay_candidate_snippets: decision.payCandidateSnippets,
      pay_rejected_snippets: decision.payRejectedSnippets,
      pay_rejection_reason: decision.payRejectionReason,
      final_salary: stringifySafe(decision.normalized?.salary),
      salary_min: decision.normalized?.salary_min ?? null,
      salary_max: decision.normalized?.salary_max ?? null,
      salary_currency: stringifySafe(decision.normalized?.salary_currency),
      salary_period: stringifySafe(decision.normalized?.salary_period),
      pay_like_detected: Boolean(decision.normalized?.pay_like_detected),
      pay_parse_failed_snippet: stringifySafe(decision.normalized?.pay_parse_failed_snippet),
      parse_warning: stringifySafe(decision.normalized?.parse_warning),
      review_reason: stringifySafe(decision.normalized?.review_reason),
      triage_reason: stringifySafe(decision.normalized?.triage_reason),
      company_auto_publish_count: 0,
      company_auto_publish_cap: decision.companyCap,
      blocked_by_company_cap: false,
      approved_company_match: decision.approvedCompanyMatch,
      approved_source_match: decision.approvedSourceMatch,
      workable_human_apply_confirmed: decision.workableHumanApplyConfirmed,
      workable_apply_validation_reason: decision.workableApplyValidationReason,
      workable_url_normalized: Boolean(decision.normalized?.workable_url_normalized ?? workableDiagnostic.normalized),
      original_workable_url: stringifySafe(decision.normalized?.original_workable_url || workableDiagnostic.original_url),
      canonical_workable_url: stringifySafe(decision.normalized?.canonical_workable_url || workableDiagnostic.canonical_url),
      description_cleaning_applied: Boolean(decision.normalized?.description_cleaning_applied),
      description_leading_fragment_removed: Boolean(decision.normalized?.description_leading_fragment_removed),
      description_auto_capitalized: Boolean(decision.normalized?.description_auto_capitalized),
      description_fallback_sentence_used: Boolean(decision.normalized?.description_fallback_sentence_used),
      snippet_fallback_used: Boolean(decision.normalized?.snippet_fallback_used),
      action: decision.action,
      reasons: decision.reasons,
      public_rejection_reason: decision.reasons.join("; ")
    });
    if (decision.action === "promote") {
      if (isWorkable) workableEligible += 1;
      promoted.push({
        job: decision.normalized,
        source,
        parser_confidence_score: decision.parserConfidenceScore,
        approved_company_match: decision.approvedCompanyMatch,
        approved_source_match: decision.approvedSourceMatch,
        pay_status: decision.payStatus,
        pay_parse_source: decision.payParseSource,
        pay_parse_confidence: decision.payParseConfidence,
        workable_human_apply_confirmed: decision.workableHumanApplyConfirmed,
        workable_apply_validation_reason: decision.workableApplyValidationReason,
        workable_url_normalized: Boolean(decision.normalized?.workable_url_normalized ?? workableDiagnostic.normalized),
        original_workable_url: stringifySafe(decision.normalized?.original_workable_url || workableDiagnostic.original_url),
        canonical_workable_url: stringifySafe(decision.normalized?.canonical_workable_url || workableDiagnostic.canonical_url),
        company_cap: decision.companyCap
      });
    } else {
      rejected.push({
        id: stringifySafe(candidate.id),
        title: stringifySafe(candidate.title),
        source: stringifySafe(candidate.source),
        pay_status: decision.payStatus,
        pay_parse_source: decision.payParseSource,
        pay_parse_confidence: decision.payParseConfidence,
        pay_candidate_snippets: decision.payCandidateSnippets,
        pay_rejected_snippets: decision.payRejectedSnippets,
        pay_rejection_reason: decision.payRejectionReason,
        approved_company_match: decision.approvedCompanyMatch,
        approved_source_match: decision.approvedSourceMatch,
        workable_human_apply_confirmed: decision.workableHumanApplyConfirmed,
        workable_apply_validation_reason: decision.workableApplyValidationReason,
        workable_url_normalized: Boolean(decision.normalized?.workable_url_normalized ?? workableDiagnostic.normalized),
        original_workable_url: stringifySafe(decision.normalized?.original_workable_url || workableDiagnostic.original_url),
        canonical_workable_url: stringifySafe(decision.normalized?.canonical_workable_url || workableDiagnostic.canonical_url),
        pay_parse_failed_snippet: stringifySafe(decision.normalized?.pay_parse_failed_snippet),
        reasons: decision.reasons
      });
    }
  }

  const promotionCap = args.maxAutoPublishPerRun;
  const autoPublishEnabled = args.write && args.autoPublish && !args.dryRun;
  const promotable = [];
  const blockedByCompanyCap = [];
  const companyPromotionCounts = new Map();
  promoted.forEach((entry) => {
    const organization = normalizeToken(entry.job.organization);
    const currentCount = companyPromotionCounts.get(organization) || 0;
    const nextCount = currentCount + 1;
    const consideredEntry = considered.find((item) => item.id === stringifySafe(entry.job.id));
    if (consideredEntry) {
      consideredEntry.company_auto_publish_count = nextCount;
    }
    const companyCap = entry.company_cap || approvedConfig.perCompanyCap;
    if (consideredEntry) {
      consideredEntry.company_auto_publish_cap = companyCap;
    }
    if (currentCount >= companyCap) {
      if (consideredEntry) consideredEntry.blocked_by_company_cap = true;
      blockedByCompanyCap.push(entry);
      return;
    }
    companyPromotionCounts.set(organization, nextCount);
    promotable.push(entry);
  });
  const eligiblePromotions = promotable.slice(0, promotionCap);
  const approvedPromotions = autoPublishEnabled ? eligiblePromotions : [];
  const reportedPromotions = args.autoPublish ? eligiblePromotions : approvedPromotions;
  const capDeferred = promotable.slice(promotionCap);

  if (autoPublishEnabled) {
    blockedByCompanyCap.forEach((entry) => {
      rejected.push({
        id: stringifySafe(entry.job.id),
        title: stringifySafe(entry.job.title),
        source: stringifySafe(entry.job.source),
        pay_status: entry.pay_status,
        pay_parse_source: entry.pay_parse_source,
        approved_company_match: Boolean(entry.approved_company_match),
        workable_human_apply_confirmed: Boolean(entry.workable_human_apply_confirmed),
        workable_apply_validation_reason: stringifySafe(entry.workable_apply_validation_reason),
        pay_parse_failed_snippet: stringifySafe(entry.job?.pay_parse_failed_snippet),
        reasons: ["company_auto_publish_cap_reached"]
      });
    });
    capDeferred.forEach((entry) => {
      rejected.push({
        id: stringifySafe(entry.job.id),
        title: stringifySafe(entry.job.title),
        source: stringifySafe(entry.job.source),
        pay_status: entry.pay_status,
        pay_parse_source: entry.pay_parse_source,
        approved_company_match: Boolean(entry.approved_company_match),
        workable_human_apply_confirmed: Boolean(entry.workable_human_apply_confirmed),
        workable_apply_validation_reason: stringifySafe(entry.workable_apply_validation_reason),
        pay_parse_failed_snippet: stringifySafe(entry.job?.pay_parse_failed_snippet),
        reasons: ["promotion_cap_reached"]
      });
    });
  }

  let nextPendingJobs = pendingJobs.slice();
  let nextRecords = existingRecords.slice();
  let publicSyncResult = {
    publicJobs: publicJobsBefore,
    jobsCountBefore: publicJobsBefore.length,
    jobsCountAfter: publicJobsBefore.length,
    wrote: false
  };

  if (approvedPromotions.length) {
    approvedPromotions.forEach((entry) => {
      const job = entry.job;
      const fingerprint = buildJobFingerprint(job);
      const existing = recordIndex.byId.get(stringifySafe(job.id))
        || recordIndex.byFingerprint.get(stringifySafe(fingerprint))
        || {};
      let nextRecord = buildJobRecord({ ...job, status: "published" }, existing, { context: "source_sync" });
      nextRecord = {
        ...nextRecord,
        status: "published",
        published: true,
        public_visibility: true,
        verification_method: "auto_expand_promotion"
      };
      nextRecord = applyPublishLifecycle(nextRecord);
      nextRecords = upsertRecord(nextRecords, nextRecord);
      nextPendingJobs = nextPendingJobs.filter((pendingJob) => stringifySafe(pendingJob.id) !== stringifySafe(job.id));
    });

    if (!args.dryRun && autoPublishEnabled) {
      const sanitizedRecords = nextRecords.map((record) => sanitizeJobRecordForStorage(record).record);
      await writeJsonIfChanged(JOB_RECORDS_FILE, sanitizedRecords);
      publicSyncResult = await syncPublicJobsFromRecords(sanitizedRecords, {
        label: "jobs:promote-public-ready",
        allowWorseOverwrite: false
      });
      const { PENDING_SYNCED_FILE } = require("./job-utils");
      await writeJsonIfChanged(PENDING_SYNCED_FILE, nextPendingJobs);
      nextRecords = sanitizedRecords;
    }
  }

  const publicJobsAfter = !args.dryRun && autoPublishEnabled
    ? publicSyncResult.publicJobs
    : publicJobsBefore;
  const promotedJobIds = reportedPromotions.map((entry) => stringifySafe(entry.job.id));
  const promotedJobTitles = reportedPromotions.map((entry) => stringifySafe(entry.job.title));
  const promotedJobSources = reportedPromotions.map((entry) => stringifySafe(entry.job.source));
  const eligibleJobIds = eligiblePromotions.map((entry) => stringifySafe(entry.job.id));
  const eligibleJobTitles = eligiblePromotions.map((entry) => stringifySafe(entry.job.title));
  const eligibleJobSources = eligiblePromotions.map((entry) => stringifySafe(entry.job.source));
  const pageChecks = (!args.dryRun && autoPublishEnabled && approvedPromotions.length)
    ? await verifyPromotedPages(publicJobsAfter, promotedJobIds)
    : promotedJobIds.map((id) => ({ id, page_url: "", page_exists: false }));

  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode: args.write ? (args.autoPublish ? "write_auto_publish" : "write_pending_only") : "dry_run",
    auto_publish_enabled: autoPublishEnabled,
    very_high_confidence_threshold: VERY_HIGH_CONFIDENCE_THRESHOLD,
    promotion_cap: promotionCap,
    company_auto_publish_cap: approvedConfig.perCompanyCap,
    promotion_cap_hit: promotable.length > promotionCap,
    blocked_by_company_cap: blockedByCompanyCap.length,
    pay_absent_allowed_count: payAbsentAllowedCount,
    pay_uncertain_blocked_count: payUncertainBlockedCount,
    workable_considered: workableConsidered,
    workable_url_normalized_count: considered.filter((item) => item.workable_url_normalized).length,
    workable_auto_published: reportedPromotions.filter((entry) => /workable/i.test(`${stringifySafe(entry.source?.provider)} ${stringifySafe(entry.job.source)}`)).length,
    jobs_eligible_for_public: promotable.length,
    jobs_considered_for_public: considered.length,
    jobs_auto_published: reportedPromotions.length,
    jobs_left_pending: Math.max(0, considered.length - reportedPromotions.length),
    jobs_rejected_from_public: rejected.length,
    archive_fingerprint_blocked: archiveBlockedCount,
    public_rejection_reasons: summarizeRejectionCounts(rejected),
    eligible_job_ids: eligibleJobIds,
    eligible_job_titles: eligibleJobTitles,
    eligible_job_sources: eligibleJobSources,
    promoted_job_ids: promotedJobIds,
    promoted_job_titles: promotedJobTitles,
    promoted_job_sources: promotedJobSources,
    public_job_counts: {
      before: publicJobsBefore.length,
      after: publicJobsAfter.length
    },
    pending_counts: {
      before: pendingJobs.length,
      after: !args.dryRun && autoPublishEnabled ? nextPendingJobs.length : pendingJobs.length
    },
    page_checks: pageChecks,
    considered_jobs: considered,
    company_auto_publish_counts: Object.fromEntries(companyPromotionCounts.entries()),
    warnings: [],
    failures: []
  };

  if (args.dryRun) {
    report.warnings.push("dry_run_no_public_write");
  }
  if (args.write && !args.autoPublish) {
    report.warnings.push("auto_publish_disabled_jobs_remain_pending");
  }
  if (!autoPublishEnabled && promotable.length) {
    report.warnings.push(`eligible_for_future_auto_publish=${promotable.length}`);
  }

  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runPromotion(args);
  console.log(
    `[jobs:promote-public-ready] mode=${report.mode} considered=${report.jobs_considered_for_public} auto_published=${report.jobs_auto_published} left_pending=${report.jobs_left_pending} rejected=${report.jobs_rejected_from_public} archive_blocked=${report.archive_fingerprint_blocked} promotion_cap=${report.promotion_cap} promotion_cap_hit=${report.promotion_cap_hit}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:promote-public-ready] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_PROMOTION_CAP,
  REPORT_FILE,
  VERY_HIGH_CONFIDENCE_THRESHOLD,
  runPromotion
};
