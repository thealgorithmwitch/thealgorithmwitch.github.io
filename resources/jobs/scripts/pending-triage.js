const { PENDING_TRIAGE_SUMMARY_FILE, writeJson } = require("./job-utils");
const { readOrganizationRules, readPendingOverrides } = require("./admin-actions-store");

const CLIMATE_TERMS = [
  "climate",
  "clean energy",
  "renewable",
  "solar",
  "wind",
  "decarbon",
  "electrification",
  "energy",
  "environment",
  "sustainab",
  "conservation",
  "carbon",
  "emissions",
  "grid",
  "battery",
  "storage",
  "policy",
  "advocacy"
];

const FUNCTION_TERMS = [
  "communications",
  "communication",
  "design",
  "designer",
  "strategy",
  "strategic",
  "research",
  "researcher",
  "data",
  "analytics",
  "analyst",
  "product",
  "operations",
  "operator",
  "policy",
  "campaign",
  "content",
  "creative",
  "brand",
  "storytelling"
];

const UNRELATED_ENGINEERING_TERMS = [
  "software engineer",
  "frontend engineer",
  "backend engineer",
  "full stack",
  "devops",
  "site reliability",
  "sre",
  "qa engineer",
  "mobile engineer",
  "ios engineer",
  "android engineer",
  "security engineer"
];

const SALES_TERMS = [
  "sales",
  "account executive",
  "sdr",
  "bdr",
  "business development representative",
  "closer"
];

const BAD_TITLE_PATTERNS = [
  /^previous$/i,
  /^next$/i,
  /^previous\b/i,
  /^next\b/i,
  /^sunrun$/i,
  /^portugal$/i,
  /^portugu[eê]s\s*\(portugal\)$/i,
  /^the power of all voices$/i,
  /^careers?$/i,
  /^jobs?$/i,
  /\bjobs?$/i,
  /^openings?$/i,
  /^opportunities$/i,
  /^join us$/i,
  /^contact us$/i,
  /^home$/i,
  /^link$/i,
  /^mailto:/i,
  /@/,
  /^expression of interest$/i,
  /^click here to submit your application$/i,
  /^get a green job$/i,
  /^explore episodes$/i,
  /^fellowships? at\b/i,
  /^internships? at\b/i,
  /^want a .* career\??$/i,
  /^faq\b/i,
  /^our impact$/i,
  /^job explorer$/i,
  /^about it(?:\s+at\b.*)?$/i,
  /^graduate programmes?$/i,
  /^jasmine$/i,
  /^life at\b/i,
  /^ron and back office,\s*risk$/i,
  /^the power of .+/i
];

const SUSPICIOUS_TITLE_PATTERNS = [
  /[<>]/,
  /&#\d+;/i,
  /\bclass=/i,
  /^\W+/,
  /https?:\/\//i,
  /\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\b/i,
  /\b(?:privacy|cookie(?:s)?|terms of (?:use|service)|applicant privacy|applicant login|join talent community|employment scams|sample employment test|search jobs|search results|job openings|careers website)\b/i,
  /\b(remote|hybrid|on-site)\b.*\b(remote|hybrid|on-site)\b/i,
  /\blife at\b/i,
  /\bgraduate programmes?\b/i,
  /\bjob explorer\b/i,
  /\bour impact\b/i
];

const NON_ROLE_URL_PATTERNS = [
  /twitter\.com\/intent/i,
  /linkedin\.com\/(?:sharearticle|company)/i,
  /facebook\.com\/sharer/i,
  /x\.com\/intent/i,
  /instagram\.com/i,
  /eeoc\.gov/i,
  /comeet\.com\/en\/articles/i,
  /careerhome\.action/i,
  /userhome/i,
  /\/(?:privacy|privacy-policy|cookie|cookies|legal|security|contact|demo|newsletter|blog|events|guidance|glossary|pricing|api|developers|integrations|support|candidate-privacy|employment-scams|sample-employment-test)(?:\/|$)/i,
  /\/(?:category|job-category|job-location|companies)(?:\/|$)/i,
  /\/(?:go|content)(?:\/|$)/i,
  /\/(?:issue|degrees)(?:\/|$)/i,
  /\/environmental-careers(?:\/|$)/i,
  /\/take-action-current-opportunities(?:\/|$)/i,
  /\/(?:fellowship-openings|internship-openings)(?:\/|$)/i,
  /\/search(?:\/|$|\?)/i,
  /\/search-results(?:\/|$)/i,
  /\/talentcommunity\//i,
  /\/sign[_-]in(?:\/|$)/i
];

const COMMON_SINGLE_WORD_ROLE_TITLES = new Set([
  "analyst",
  "associate",
  "coordinator",
  "designer",
  "developer",
  "director",
  "engineer",
  "intern",
  "manager",
  "officer",
  "recruiter",
  "researcher",
  "specialist",
  "strategist",
  "writer"
]);

const LOCATION_ONLY_TITLES = new Set([
  "portugal",
  "canada",
  "spain",
  "france",
  "germany",
  "italy",
  "london",
  "berlin",
  "remote"
]);

function isNonRoleUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_error) {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname || "").toLowerCase();
  const query = parsed.search.toLowerCase();
  const full = `${host}${path}${query}`;

  if (NON_ROLE_URL_PATTERNS.some((pattern) => pattern.test(full))) return true;
  if (/[?&]f(?:%5b|\[)0(?:%5d|\])=/i.test(query)) return true;
  if ((/\/careers\/?$/i.test(path) || /\/jobs\/?$/i.test(path) || path === "/") && !query) return true;
  if (/jobs\.lever\.co$/i.test(host) && query && !/\/[0-9a-f-]{12,}(?:\/apply)?\/?$/i.test(path)) return true;
  if (host === "boards.greenhouse.io" && !/\/jobs\/\d+/i.test(path) && !/[?&]gh_jid=/i.test(query)) return true;
  if (/job-offers/i.test(path) && /(?:^|[?&])(q|fa|cn|ex)=/i.test(query)) return true;
  if (/\/go\//i.test(path) || /\/content\//i.test(path)) return true;

  return false;
}

function hasAny(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function scoreTextHits(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function isSingleFirstNameOnlyTitle(title) {
  const normalized = String(title || "").trim();
  if (!/^[A-Z][a-z]{2,20}$/.test(normalized)) return false;
  return !COMMON_SINGLE_WORD_ROLE_TITLES.has(normalized.toLowerCase());
}

function isOrganizationOnlyTitle(title, organization) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const normalizedOrg = String(organization || "").trim().toLowerCase();
  return Boolean(normalizedTitle && normalizedOrg && normalizedTitle === normalizedOrg);
}

function isLocationOnlyTitle(title, location) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const normalizedLocation = String(location || "").trim().toLowerCase();
  if (!normalizedTitle) return false;
  if (LOCATION_ONLY_TITLES.has(normalizedTitle)) return true;
  return Boolean(normalizedLocation && normalizedTitle === normalizedLocation);
}

function isTrustedSustainabilityContext(job) {
  const text = [
    job.organization,
    job.sector,
    job.source,
    job.source_url,
    job.notes
  ].join(" ").toLowerCase();
  return Boolean(job.trusted) || hasAny(text, CLIMATE_TERMS) || /(clean energy|climate tech|sustainability|conservation|policy\/advocacy|climate communications)/i.test(String(job.sector || ""));
}

function scorePendingJob(job) {
  const text = [
    job.title,
    job.organization,
    job.sector,
    job.function,
    job.location,
    job.workplace_type,
    job.description,
    job.raw_description,
    Array.isArray(job.tags) ? job.tags.join(" ") : "",
    job.notes
  ].join(" ");
  const climateHitCount = scoreTextHits(text, CLIMATE_TERMS);
  const functionHitCount = scoreTextHits(text, FUNCTION_TERMS);
  const trustedContext = isTrustedSustainabilityContext(job);
  const payCaptured = Boolean(job.salary || job.raw_salary || job.salary_min || job.salary_max);
  const locationCaptured = Boolean(job.location || job.workplace_type);
  const climateContext = climateHitCount > 0 || trustedContext;
  const unrelatedEngineering = hasAny(text, UNRELATED_ENGINEERING_TERMS);
  const salesRole = hasAny(text, SALES_TERMS);

  let score = 0;
  const reasons = [];

  if (climateHitCount > 0) {
    score += 3;
    reasons.push("climate_context");
  }
  if (functionHitCount > 0) {
    score += 2;
    reasons.push("functional_relevance");
  }
  if (trustedContext) {
    score += 2;
    reasons.push("trusted_sustainability_source");
  }
  if (payCaptured) {
    score += 1;
    reasons.push("pay_captured");
  }
  if (locationCaptured) {
    score += 1;
    reasons.push("location_captured");
  }
  if ((unrelatedEngineering || salesRole) && !climateContext) {
    score -= 3;
    reasons.push(unrelatedEngineering ? "unrelated_engineering" : "unrelated_sales");
  }

  return {
    score,
    reasons,
    climateContext,
    functionHitCount,
    trustedContext,
    payCaptured,
    locationCaptured,
    unrelatedEngineering,
    salesRole
  };
}

function classifyPendingJob(job, context = {}) {
  const title = String(job.title || "").trim();
  const organization = String(job.organization || "").trim();
  const originalUrl = normalizeUrl(job.original_url || job.apply_url || job.source_url);
  const scoreMeta = scorePendingJob(job);
  const nonRoleUrl = isNonRoleUrl(originalUrl);
  const titleLooksBad =
    BAD_TITLE_PATTERNS.some((pattern) => pattern.test(title)) ||
    isSingleFirstNameOnlyTitle(title) ||
    isOrganizationOnlyTitle(title, organization) ||
    isLocationOnlyTitle(title, job.location) ||
    title.length < 4 ||
    title.length > 160;
  const suspiciousTitle =
    SUSPICIOUS_TITLE_PATTERNS.some((pattern) => pattern.test(title)) ||
    title.split(/\s+/).filter(Boolean).length > 12;
  const internship = /\b(intern|internship|fellowship)\b/i.test(`${title} ${job.description || ""} ${job.raw_description || ""}`);
  const duplicateUrl = Boolean(originalUrl && context.seenUrls && context.seenUrls.has(originalUrl));
  const roleRelevant =
    scoreMeta.climateContext ||
    (scoreMeta.trustedContext && scoreMeta.functionHitCount > 0) ||
    scoreMeta.score >= 4;
  const reviewReady =
    title &&
    organization &&
    originalUrl &&
    roleRelevant &&
    !titleLooksBad &&
    !nonRoleUrl &&
    !(internship && !scoreMeta.payCaptured) &&
    !duplicateUrl &&
    !suspiciousTitle &&
    !((scoreMeta.unrelatedEngineering || scoreMeta.salesRole) && !scoreMeta.climateContext);

  const nextJob = {
    ...job,
    original_url: originalUrl,
    relevance_score: scoreMeta.score,
    relevance_reasons: scoreMeta.reasons
  };

  if (nextJob._reject_reason) {
    const forcedReason = nextJob._quality?.rule || nextJob._quality?.reason || nextJob._reject_reason;
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: forcedReason },
      reason: forcedReason
    };
  }

  if (!title || !organization) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "missing title or organization" },
      reason: "missing title or organization"
    };
  }
  if (!originalUrl) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "missing or broken original_url", relevance_score: scoreMeta.score - 5 },
      reason: "missing or broken original_url"
    };
  }
  if (duplicateUrl) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "duplicate role url" },
      reason: "duplicate role url"
    };
  }
  if (nonRoleUrl) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "non-role listing or policy url" },
      reason: "non-role listing or policy url"
    };
  }
  if (titleLooksBad) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "non-role title" },
      reason: "non-role title"
    };
  }
  if (internship && !scoreMeta.payCaptured) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "internship pay missing or unclear" },
      reason: "internship pay missing or unclear"
    };
  }
  if ((scoreMeta.unrelatedEngineering || scoreMeta.salesRole) && !scoreMeta.climateContext) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "unrelated engineering or sales role without sustainability context" },
      reason: "unrelated engineering or sales role without sustainability context"
    };
  }
  if (!roleRelevant) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "low sustainability or creative relevance" },
      reason: "low sustainability or creative relevance"
    };
  }

  if (String(nextJob.parse_warning || "").toLowerCase().includes("source board organization uncertain")) {
    if (context.seenUrls) context.seenUrls.add(originalUrl);
    return {
      bucket: "needs_cleanup",
      job: {
        ...nextJob,
        triage_bucket: "needs_cleanup",
        triage_reason: "source board organization uncertain"
      },
      reason: "source board organization uncertain"
    };
  }

  if (reviewReady && scoreMeta.score >= 8) {
    if (context.seenUrls) context.seenUrls.add(originalUrl);
    return {
      bucket: "review_ready",
      job: { ...nextJob, triage_bucket: "review_ready", triage_reason: "meets review-ready threshold" },
      reason: "meets review-ready threshold"
    };
  }

  if (context.seenUrls) context.seenUrls.add(originalUrl);
  return {
    bucket: "needs_cleanup",
    job: {
      ...nextJob,
      triage_bucket: "needs_cleanup",
      triage_reason: suspiciousTitle
        ? "relevant role but scraped title needs cleanup"
        : "relevant but needs cleanup before review"
    },
    reason: suspiciousTitle
      ? "relevant role but scraped title needs cleanup"
      : "relevant but needs cleanup before review"
  };
}

function topOrganizations(jobs, limit = 20) {
  const counts = new Map();
  for (const job of jobs) {
    const key = String(job.organization || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([organization, count]) => ({ organization, count }));
}

function countJobsWithPay(jobs) {
  return jobs.filter((job) => Boolean(job.salary || job.raw_salary || job.salary_min || job.salary_max)).length;
}

async function triagePendingJobs(pendingJobs, publicJobs, scrapeReport) {
  const orgRules = await readOrganizationRules();
  const overrides = await readPendingOverrides();
  const seenUrls = new Set(
    (Array.isArray(publicJobs) ? publicJobs : [])
      .map((job) => normalizeUrl(job.original_url || job.apply_url || job.source_url))
      .filter(Boolean)
  );
  const buckets = {
    review_ready: [],
    needs_cleanup: [],
    rejected_noise: []
  };
  const rejectedBySource = new Map();
  let duplicateCountRemoved = 0;

  for (const job of Array.isArray(pendingJobs) ? pendingJobs : []) {
    const organization = String(job.organization || "").trim();
    const overrideKey = String(job.id || job.original_url || job.apply_url || "");
    const override = overrides.jobs[overrideKey] || {};
    let result;

    if (orgRules.hidden_organizations.includes(organization) || orgRules.rejected_organizations.includes(organization) || override.exclude_from_pending) {
      result = {
        bucket: "rejected_noise",
        job: {
          ...job,
          triage_bucket: "rejected_noise",
          triage_reason: override.exclude_reason || (orgRules.rejected_organizations.includes(organization) ? "organization rejected by admin" : "organization hidden by admin")
        },
        reason: override.exclude_reason || "organization hidden by admin"
      };
    } else {
      result = classifyPendingJob(job, { seenUrls });
      if (override.triage_bucket === "needs_cleanup") {
        result.bucket = "needs_cleanup";
        result.job = {
          ...result.job,
          triage_bucket: "needs_cleanup",
          triage_reason: override.triage_reason || result.job.triage_reason,
          admin_review_state: override.admin_review_state || result.job.admin_review_state,
          featured: typeof override.featured === "boolean" ? override.featured : result.job.featured
        };
      } else if (override.admin_review_state || typeof override.featured === "boolean") {
        result.job = {
          ...result.job,
          admin_review_state: override.admin_review_state || result.job.admin_review_state,
          featured: typeof override.featured === "boolean" ? override.featured : result.job.featured
        };
      }
    }
    buckets[result.bucket].push(result.job);
    if (result.reason === "duplicate role url") duplicateCountRemoved += 1;

    const sourceId = String(job.source_id || "");
    if (!sourceId) continue;
    const sourceStats = rejectedBySource.get(sourceId) || {
      review_ready: 0,
      needs_cleanup: 0,
      rejected_noise: 0,
      rejected_reasons: {}
    };
    sourceStats[result.bucket] += 1;
    if (result.bucket === "rejected_noise") {
      sourceStats.rejected_reasons[result.reason] = (sourceStats.rejected_reasons[result.reason] || 0) + 1;
    }
    rejectedBySource.set(sourceId, sourceStats);
  }

  const adminPendingJobs = [...buckets.review_ready, ...buckets.needs_cleanup];
  const summary = {
    generated_at: new Date().toISOString(),
    public_jobs: Array.isArray(publicJobs) ? publicJobs.length : 0,
    pending_review_ready: buckets.review_ready.length,
    pending_needs_cleanup: buckets.needs_cleanup.length,
    rejected_noise: buckets.rejected_noise.length,
    duplicate_count_removed: duplicateCountRemoved,
    jobs_with_pay: countJobsWithPay(adminPendingJobs),
    jobs_without_pay: adminPendingJobs.length - countJobsWithPay(adminPendingJobs),
    top_organizations: topOrganizations(adminPendingJobs, 20)
  };

  if (scrapeReport && Array.isArray(scrapeReport.sources)) {
    scrapeReport.sources = scrapeReport.sources.map((source) => {
      const triage = rejectedBySource.get(String(source.source_id || "")) || {
        review_ready: 0,
        needs_cleanup: 0,
        rejected_noise: 0,
        rejected_reasons: {}
      };
      return {
        ...source,
        review_ready: triage.review_ready,
        needs_cleanup: triage.needs_cleanup,
        rejected_noise: triage.rejected_noise,
        rejected_reasons: triage.rejected_reasons
      };
    });
  }

  await writeJson(PENDING_TRIAGE_SUMMARY_FILE, summary);

  return {
    adminPendingJobs,
    rejectedNoiseJobs: buckets.rejected_noise,
    summary,
    report: scrapeReport
  };
}

module.exports = {
  triagePendingJobs
};
