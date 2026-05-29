const { buildDescriptionSnippet, hasUsableDescription, normalizePayDisplay, normalizeWorkplaceType, stringifySafe } = require("./job-normalizer");
const { cleanLocationText } = require("./job-normalizer");
const { hasMalformedDescriptionTemplateSafe } = require("./malformed-description-helper");

const JUNK_DESCRIPTION_PATTERNS = [
  /\bprevious\b/i,
  /\bnext post\b/i,
  /\bsee current openings\b/i,
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i,
  /<span\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bcareer_page\b/i,
  /\bBusiness\/Productivity Software\b/i,
  /\bCleantech\b/i,
  /\bOil\s*&\s*Gas\b/i,
  /\bRenewable Energy\b/i,
  /\bheaders?\b\s*(?:"\s*)+/i,
  /\b(?:taxonomy|valuation|headquarters|employee size|funding|revenue)\b/i,
  /\b\d{7,10}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\bBusiness and Industrial\b/i,
  /\bCleantech & Environment\b/i,
  /\bElectrical Distribution\b/i,
  /\bIndustrial Automation\b/i,
  /\bPower Generation\b/i,
  /\bRenewable Energy & Environment\b/i
];

function cleanText(value) {
  return stringifySafe(value).trim();
}

function extractPayFacts(value) {
  const text = cleanText(value);
  const amounts = Array.from(text.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    .map((match) => Number(String(match[0]).replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const period =
    /\b(?:per month|\/\s*month|\/\s*mo\b|monthly|month)\b/i.test(text) ? "month"
      : /\b(?:per year|\/\s*year|\/\s*yr\b|annual|annually|year)\b/i.test(text) ? "year"
        : /\b(?:per hour|\/\s*hour|\/\s*hr\b|hourly|hour)\b/i.test(text) ? "hour"
          : /\b(?:per day|\/\s*day|daily|day)\b/i.test(text) ? "day"
            : "unknown";
  const maxAmount = amounts.length ? Math.max(...amounts) : null;
  const isRange = amounts.length >= 2 && /(?:-|–|—|\bto\b)/i.test(text);
  return {
    text,
    period,
    isRange,
    tinyMonthly: period === "month" && maxAmount !== null && maxAmount < 1000,
    annualLike: period === "year" || (period === "unknown" && maxAmount !== null && maxAmount >= 10000)
  };
}

function isSuspiciousPayDowngrade(currentValue, proposedValue) {
  const current = extractPayFacts(currentValue);
  const proposed = extractPayFacts(proposedValue);
  if (!current.text || !proposed.text) return false;
  return Boolean((current.annualLike || current.isRange) && proposed.tinyMonthly);
}

function isJunkDescription(value) {
  const text = cleanText(value);
  if (!text) return false;
  return hasMalformedDescriptionTemplateSafe(text) || JUNK_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

function getCanonicalDescription(job = {}) {
  return cleanText(job.description);
}

function getCanonicalSnippet(job = {}) {
  const existing = cleanText(job.description_snippet || job.summary);
  if (existing) return existing;
  return buildDescriptionSnippet(getCanonicalDescription(job), 220, { title: cleanText(job.title) });
}

function getCanonicalPay(job = {}) {
  return normalizePayDisplay({
    payDisplay: job.display?.pay_display || job.pay_display || job.salary,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    currency: job.salary_currency,
    period: job.salary_period
  });
}

function getCanonicalLocation(job = {}) {
  return cleanLocationText(job.location, {
    title: job.title,
    organization: job.organization,
    workplaceType: job.workplace_type,
    source: job.source,
    source_type: job.source_type,
    trackStats: false
  });
}

function getCanonicalWorkplaceType(job = {}) {
  return normalizeWorkplaceType(job.workplace_type, "");
}

function evaluateJobsQuality(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : [];
  let invalidSnippetCount = 0;
  let junkDescriptionCount = 0;
  let missingDescriptionCount = 0;
  const ids = new Set();
  let duplicateIdCount = 0;

  for (const job of list) {
    const id = cleanText(job.id);
    if (id) {
      if (ids.has(id)) duplicateIdCount += 1;
      ids.add(id);
    }
    const description = getCanonicalDescription(job);
    const snippet = getCanonicalSnippet(job);
    if (!hasUsableDescription(description, { title: cleanText(job.title) })) {
      missingDescriptionCount += 1;
    }
    if (isJunkDescription(description)) {
      junkDescriptionCount += 1;
    }
    if (!snippet || isJunkDescription(snippet) || hasMalformedDescriptionTemplateSafe(snippet)) {
      invalidSnippetCount += 1;
    }
  }

  return {
    count: list.length,
    invalid_snippet_count: invalidSnippetCount,
    junk_description_count: junkDescriptionCount,
    missing_description_count: missingDescriptionCount,
    duplicate_canonical_id_count: duplicateIdCount
  };
}

function buildJobsById(jobs = []) {
  return new Map((Array.isArray(jobs) ? jobs : []).map((job) => [cleanText(job.id), job]));
}

function filterJobsByScope(jobs = [], scopeIds = []) {
  const scopedIds = new Set((scopeIds || []).map((id) => cleanText(id)).filter(Boolean));
  if (!scopedIds.size) return Array.isArray(jobs) ? jobs : [];
  return (Array.isArray(jobs) ? jobs : []).filter((job) => scopedIds.has(cleanText(job.id)));
}

function compareJobsOutputs(currentJobs = [], proposedJobs = [], options = {}) {
  const scopeIds = new Set((options.scopeIds || []).map((id) => cleanText(id)).filter(Boolean));
  const scoped = scopeIds.size > 0;
  const currentQuality = evaluateJobsQuality(currentJobs);
  const proposedQuality = evaluateJobsQuality(proposedJobs);
  const currentScopedQuality = scoped
    ? evaluateJobsQuality(filterJobsByScope(currentJobs, Array.from(scopeIds)))
    : currentQuality;
  const proposedScopedQuality = scoped
    ? evaluateJobsQuality(filterJobsByScope(proposedJobs, Array.from(scopeIds)))
    : proposedQuality;
  const currentById = buildJobsById(currentJobs);
  const proposedById = buildJobsById(proposedJobs);

  const fieldCounts = {
    jobs_changed: 0,
    unrelated_jobs_changed: 0,
    descriptions_replaced: 0,
    snippets_replaced: 0,
    pay_fields_replaced: 0,
    locations_replaced: 0,
    specializations_replaced: 0,
    page_urls_changed: 0
  };
  const riskyExamples = [];

  for (const [id, current] of currentById.entries()) {
    const inScope = !scoped || scopeIds.has(id);
    const proposed = proposedById.get(id);
    if (!proposed) continue;
    let changed = false;

    const currentDescription = getCanonicalDescription(current);
    const proposedDescription = getCanonicalDescription(proposed);
    if (inScope && currentDescription !== proposedDescription) {
      fieldCounts.descriptions_replaced += 1;
      changed = true;
    }
    const currentSnippet = getCanonicalSnippet(current);
    const proposedSnippet = getCanonicalSnippet(proposed);
    if (inScope && currentSnippet !== proposedSnippet) {
      fieldCounts.snippets_replaced += 1;
      changed = true;
    }
    if (inScope && getCanonicalPay(current) !== getCanonicalPay(proposed)) {
      fieldCounts.pay_fields_replaced += 1;
      changed = true;
    }
    if (inScope && getCanonicalLocation(current) !== getCanonicalLocation(proposed)) {
      fieldCounts.locations_replaced += 1;
      changed = true;
    }
    if (inScope && cleanText(current.specialization) !== cleanText(proposed.specialization)) {
      fieldCounts.specializations_replaced += 1;
      changed = true;
    }
    if (inScope && cleanText(current.page_url) !== cleanText(proposed.page_url)) {
      fieldCounts.page_urls_changed += 1;
      changed = true;
    }

    const currentWorkplace = getCanonicalWorkplaceType(current);
    const proposedWorkplace = getCanonicalWorkplaceType(proposed);
    const currentLooksClean = currentDescription && !isJunkDescription(currentDescription);
    const proposedLooksWorse =
      (!proposedDescription && currentDescription) ||
      (isJunkDescription(proposedDescription) && !isJunkDescription(currentDescription)) ||
      (!proposedSnippet && currentSnippet) ||
      (isJunkDescription(proposedSnippet) && !isJunkDescription(currentSnippet)) ||
      (!getCanonicalPay(proposed) && getCanonicalPay(current)) ||
      (isSuspiciousPayDowngrade(getCanonicalPay(current), getCanonicalPay(proposed))) ||
      (!getCanonicalLocation(proposed) && getCanonicalLocation(current)) ||
      (!proposedWorkplace && currentWorkplace);

    if (inScope && proposedLooksWorse && riskyExamples.length < 20) {
      riskyExamples.push({
        id,
        title: cleanText(current.title || proposed.title),
        organization: cleanText(current.organization || proposed.organization),
        current_description: currentDescription,
        proposed_description: proposedDescription,
        current_snippet: currentSnippet,
        proposed_snippet: proposedSnippet,
        current_pay: getCanonicalPay(current),
        proposed_pay: getCanonicalPay(proposed),
        current_location: getCanonicalLocation(current),
        proposed_location: getCanonicalLocation(proposed)
      });
    }

    if (changed) {
      if (inScope) {
        fieldCounts.jobs_changed += 1;
      } else {
        fieldCounts.unrelated_jobs_changed += 1;
      }
    }
  }

  if (scoped) {
    for (const id of scopeIds) {
      const current = currentById.get(id);
      const proposed = proposedById.get(id);
      if (!current && proposed) {
        fieldCounts.jobs_changed += 1;
      } else if (current && !proposed) {
        fieldCounts.jobs_changed += 1;
      }
    }
  }

  const worseReasons = [];
  const baselineQuality = scoped ? currentScopedQuality : currentQuality;
  const targetQuality = scoped ? proposedScopedQuality : proposedQuality;
  if (!scoped) {
    if (targetQuality.invalid_snippet_count > baselineQuality.invalid_snippet_count) worseReasons.push("invalid_snippet_count would increase");
    if (targetQuality.junk_description_count > baselineQuality.junk_description_count) worseReasons.push("junk_description_count would increase");
    if (targetQuality.missing_description_count > baselineQuality.missing_description_count) worseReasons.push("missing_description_count would increase");
    if (targetQuality.duplicate_canonical_id_count > baselineQuality.duplicate_canonical_id_count) worseReasons.push("duplicate_canonical_id_count would increase");
    if (targetQuality.count < baselineQuality.count) worseReasons.push("jobs_json_count would drop unexpectedly");
  } else {
    if (targetQuality.invalid_snippet_count > baselineQuality.invalid_snippet_count) worseReasons.push("scoped invalid_snippet_count would increase");
    if (targetQuality.junk_description_count > baselineQuality.junk_description_count) worseReasons.push("scoped junk_description_count would increase");
    if (targetQuality.missing_description_count > baselineQuality.missing_description_count) worseReasons.push("scoped missing_description_count would increase");
  }
  if (riskyExamples.length) worseReasons.push("manual/frontend-cleaned fields would be replaced by worse values");

  return {
    current_quality: currentQuality,
    proposed_quality: proposedQuality,
    current_scoped_quality: currentScopedQuality,
    proposed_scoped_quality: proposedScopedQuality,
    field_counts: fieldCounts,
    risky_examples: riskyExamples,
    worse_reasons: worseReasons
  };
}

module.exports = {
  compareJobsOutputs,
  evaluateJobsQuality,
  getCanonicalDescription,
  getCanonicalLocation,
  getCanonicalPay,
  getCanonicalSnippet,
  getCanonicalWorkplaceType,
  isJunkDescription,
  isSuspiciousPayDowngrade
};
