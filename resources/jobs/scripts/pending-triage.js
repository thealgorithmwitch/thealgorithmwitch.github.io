const { PENDING_TRIAGE_SUMMARY_FILE, writeJson } = require("./job-utils");
const { normalizeJob } = require("./job-normalizer");
const { readOrganizationRules, readPendingOverrides } = require("./admin-actions-store");

const MAX_BROAD_SOURCE_NEW_PENDING = 50;
const MAX_NEW_PENDING_PER_SOURCE = 50;
const MAX_HIGH_VOLUME_SOURCE_PENDING = 25;
const MAX_TOTAL_PENDING = 750;
const MAX_PENDING_BYTES = 25 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 900;
const MAX_RAW_DESCRIPTION_LENGTH = 1500;
const BROAD_SOURCE_PATTERNS = [
  /climatechangejobs/i,
  /greenjobsearch/i,
  /idealist/i,
  /goodcitizen/i,
  /elemental\s*impact/i
];
const HIGH_VOLUME_SOURCE_PATTERNS = [
  /octopus-energy/i,
  /climatechangejobs/i,
  /greenjobsearch/i,
  /\brwe\b/i,
  /sunrun/i,
  /nextera-energy/i,
  /quince/i,
  /spring-health/i,
  /woolpert/i,
  /dataiku/i,
  /cribl/i
];
const VERY_HIGH_RELEVANCE_SCORE = 12;
const AUTO_PUBLISH_PUBLIC_THRESHOLD = 15;

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
  "comms",
  "media",
  "press",
  "public affairs",
  "digital",
  "social media",
  "editorial",
  "web",
  "website",
  "design",
  "designer",
  "strategy",
  "strategist",
  "strategic",
  "research",
  "researcher",
  "data",
  "analytics",
  "analyst",
  "product",
  "product manager",
  "marketing",
  "operations",
  "operator",
  "policy",
  "campaign",
  "content",
  "creative",
  "brand",
  "storytelling",
  "pr",
  "art",
  "developer",
  "engineer",
  "software"
];

const PRIORITY_FUNCTION_BOOST_TERMS = [
  "communications",
  "communication",
  "comms",
  "media",
  "press",
  "social media",
  "digital",
  "content",
  "brand",
  "creative",
  "design",
  "designer",
  "web",
  "website",
  "developer",
  "software",
  "product",
  "product manager",
  "data",
  "research",
  "campaign",
  "strategy",
  "strategist"
];

const AUTO_PUBLISH_FUNCTION_TERMS = [
  "marketing",
  "communications",
  "communication",
  "comms",
  "content",
  "creative",
  "policy",
  "strategy",
  "strategist",
  "partnership",
  "partnerships",
  "product",
  "ux",
  "research",
  "data",
  "analytics",
  "analyst",
  "digital",
  "press",
  "pr",
  "brand",
  "social media"
];

const AUTO_PUBLISH_BLOCKED_TITLE_TERMS = [
  "field sales",
  "warehouse",
  "customer support",
  "customer operations",
  "operations specialist",
  "generic operations",
  "retail",
  "installer",
  "installation",
  "technician",
  "call center",
  "backend",
  "back-end",
  "smart meter",
  "energy specialist",
  "support agent",
  "support specialist"
];

const MISSION_ALIGNED_TERMS = [
  "climate",
  "clean energy",
  "renewable",
  "sustainability",
  "environmental justice",
  "environmental",
  "advocacy",
  "nonprofit",
  "non-profit",
  "civic tech",
  "public interest",
  "conservation",
  "decarbon",
  "electrification",
  "carbon",
  "emissions",
  "policy",
  "justice"
];

const MISSION_OPS_ADMIN_TERMS = [
  "executive assistant",
  "administrative assistant",
  "administrative coordinator",
  "chief of staff",
  "operations manager",
  "operations coordinator",
  "program operations",
  "people operations",
  "business operations",
  "development operations",
  "grants operations",
  "finance & operations",
  "finance and operations",
  "director of operations",
  "operations director"
];

const CLIMATE_CONTEXT_EXTRA_TERMS = [
  "geothermal",
  "justice",
  "resilience",
  "advocacy",
  "renewable",
  "environmental"
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

function bytesToMegabytes(bytes) {
  return Number(bytes || 0) / (1024 * 1024);
}

function sanitizePendingText(value, maxLength) {
  return String(value || "")
    .replace(/\b(?:share to|share on)\s+(?:twitter|facebook|linkedin)\b/gi, " ")
    .replace(/\b(?:share this job|email this job|copy link|tweet|webpage|readaction)\b/gi, " ")
    .replace(/\b(?:privacy policy|terms of use|cookie policy|applicant privacy|applicant login)\b/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\b([A-Za-z][A-Za-z&,'/-]{2,})\b(?:\s+\1\b){1,}/gi, "$1")
    .trim()
    .slice(0, maxLength);
}

function cleanPendingJobForWrite(job) {
  const cleaned = {
    ...job,
    description: sanitizePendingText(job.description, MAX_DESCRIPTION_LENGTH),
    raw_description: sanitizePendingText(job.raw_description, MAX_RAW_DESCRIPTION_LENGTH)
  };
  delete cleaned.__pending_preserved;
  delete cleaned.__pending_new;
  delete cleaned.__cap_drop_reason;
  return cleaned;
}

function descriptionQualityValue(job) {
  const text = sanitizePendingText(job.description || job.raw_description || "", MAX_RAW_DESCRIPTION_LENGTH);
  if (!text) return 0;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const usefulSentences = sentences.filter((sentence) => /\b(?:will|supports|manages|develops|partners|builds|leads|seeks|coordinates|works|researches|analyzes|creates|designs)\b/i.test(sentence));
  return usefulSentences.length * 3 + Math.min(text.length, 600) / 100;
}

function sortPendingJobs(jobs) {
  return [...jobs].sort((a, b) => {
    const scoreDelta = Number(b.relevance_score || 0) - Number(a.relevance_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    const salaryDelta = Number(Boolean(b.salary || b.raw_salary || b.salary_min || b.salary_max)) - Number(Boolean(a.salary || a.raw_salary || a.salary_min || a.salary_max));
    if (salaryDelta !== 0) return salaryDelta;
    const descriptionDelta = descriptionQualityValue(b) - descriptionQualityValue(a);
    if (descriptionDelta !== 0) return descriptionDelta;
    const dateB = new Date(b.date_added || b.date_posted || 0).getTime();
    const dateA = new Date(a.date_added || a.date_posted || 0).getTime();
    return dateB - dateA;
  });
}

function getSourceKey(job) {
  return String(job.source_id || job.source || "unknown").trim() || "unknown";
}

function getSourceDescriptor(job) {
  return [
    job.source_id,
    job.source,
    job.source_url,
    job.organization
  ].filter(Boolean).join(" ");
}

function isBroadSourceJob(job) {
  const descriptor = getSourceDescriptor(job);
  return BROAD_SOURCE_PATTERNS.some((pattern) => pattern.test(descriptor));
}

function isHighVolumeSourceJob(job) {
  const descriptor = getSourceDescriptor(job);
  return HIGH_VOLUME_SOURCE_PATTERNS.some((pattern) => pattern.test(descriptor));
}

function hasPrioritySpecializationMatch(job) {
  const text = [
    job.specialization,
    job.title,
    job.function,
    job.description,
    job.raw_description,
    Array.isArray(job.tags) ? job.tags.join(" ") : job.tags,
    job.notes
  ].filter(Boolean).join(" ").toLowerCase();
  return Boolean(
    /\b(?:digital|pr|public relations|press|communications|communication|comms|social media|content|art|creative|design|designer|strategy|strategist|web|website|developer|software|product|product manager|data|analytics|analyst|research|campaign)\b/.test(text)
  );
}

function hasMissionAlignedOpsAdminMatch(job) {
  const contextText = [
    job.organization,
    job.source,
    job.source_url,
    job.sector,
    job.notes,
    job.description,
    job.raw_description
  ].filter(Boolean).join(" ").toLowerCase();
  const roleText = [
    job.title,
    job.function,
    job.specialization,
    Array.isArray(job.tags) ? job.tags.join(" ") : job.tags
  ].filter(Boolean).join(" ").toLowerCase();
  return MISSION_ALIGNED_TERMS.some((term) => contextText.includes(term)) &&
    MISSION_OPS_ADMIN_TERMS.some((term) => roleText.includes(term));
}

function hasDirectEmployerApplyUrl(job) {
  const applyUrl = normalizeUrl(job.apply_url || job.original_url);
  const sourceUrl = normalizeUrl(job.source_url);
  if (!applyUrl) return false;
  if (!sourceUrl) return !isBroadSourceJob(job);
  try {
    return new URL(applyUrl).hostname.replace(/^www\./, "") === new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch (_error) {
    return false;
  }
}

function buildTopExamples(jobs, limit = 3) {
  return sortPendingJobs(jobs)
    .slice(0, limit)
    .map((job) => ({
      title: String(job.title || "").trim(),
      organization: String(job.organization || "").trim(),
      relevance_score: Number(job.relevance_score || 0)
    }));
}

function hasAllowedAutoPublishFunction(job) {
  const text = [
    job.specialization,
    job.function,
    job.title,
    job.description,
    job.raw_description,
    Array.isArray(job.tags) ? job.tags.join(" ") : job.tags
  ].filter(Boolean).join(" ").toLowerCase();
  return AUTO_PUBLISH_FUNCTION_TERMS.some((term) => text.includes(term));
}

function hasBlockedAutoPublishTitle(job) {
  const text = [
    job.title,
    job.function,
    job.specialization
  ].filter(Boolean).join(" ").toLowerCase();
  return AUTO_PUBLISH_BLOCKED_TITLE_TERMS.some((term) => text.includes(term));
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
  return Boolean(job.trusted) || hasAny(text, CLIMATE_TERMS) || hasAny(text, CLIMATE_CONTEXT_EXTRA_TERMS) || /(clean energy|climate tech|sustainability|conservation|policy\/advocacy|climate communications)/i.test(String(job.sector || ""));
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
  const priorityBoostCount = scoreTextHits(text, PRIORITY_FUNCTION_BOOST_TERMS);
  const trustedContext = isTrustedSustainabilityContext(job);
  const payCaptured = Boolean(job.salary || job.raw_salary || job.salary_min || job.salary_max);
  const locationCaptured = Boolean(job.location || job.workplace_type);
  const directEmployerApplyUrl = hasDirectEmployerApplyUrl(job);
  const climateContext = climateHitCount > 0 || trustedContext;
  const specializationMatch = hasPrioritySpecializationMatch(job);
  const missionOpsAdminMatch = hasMissionAlignedOpsAdminMatch(job);
  const effectiveSpecializationMatch = specializationMatch || missionOpsAdminMatch;
  const unrelatedEngineering = hasAny(text, UNRELATED_ENGINEERING_TERMS);
  const salesRole = hasAny(text, SALES_TERMS);
  const broadSource = isBroadSourceJob(job);
  const highVolumeSource = isHighVolumeSourceJob(job);
  const weakEmployer = !String(job.organization || "").trim() || /unknown|multiple employers|various/i.test(String(job.organization || ""));

  let score = 0;
  const reasons = [];

  if (climateHitCount > 0) {
    score += 4;
    reasons.push("climate_context");
  }
  if (functionHitCount > 0) {
    score += 3;
    reasons.push("functional_relevance");
  }
  if (effectiveSpecializationMatch) {
    score += 4;
    reasons.push(missionOpsAdminMatch ? "mission_aligned_ops_admin_match" : "priority_specialization_match");
  }
  if (priorityBoostCount > 0) {
    score += Math.min(priorityBoostCount, 4);
    reasons.push("priority_function_terms");
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
  if (directEmployerApplyUrl) {
    score += 2;
    reasons.push("direct_employer_apply_url");
  }
  if (String(job.organization || job.source || job.source_url || "").match(/climate|energy|sustainab|renewable|environment|conservation|policy|advocacy/i)) {
    score += 2;
    reasons.push("climate_org_or_source");
  }
  if ((unrelatedEngineering || salesRole) && !climateContext) {
    score -= 5;
    reasons.push(unrelatedEngineering ? "unrelated_engineering" : "unrelated_sales");
  }
  if (salesRole && (!climateContext || functionHitCount === 0)) {
    score -= 4;
    reasons.push("generic_sales_role");
  }
  if (unrelatedEngineering && !climateContext) {
    score -= 4;
    reasons.push("pure_engineering_without_sustainability");
  }
  if ((broadSource || highVolumeSource) && (!climateContext || !effectiveSpecializationMatch)) {
    score -= 6;
    reasons.push("high_volume_weak_match");
  }
  if (broadSource && weakEmployer) {
    score -= 3;
    reasons.push("broad_board_unclear_employer");
  }
  if (/(medical|beauty|retail|cosmetic|insurance|hospital|pharma)/i.test(text) && !climateContext) {
    score -= 6;
    reasons.push("unrelated_industry");
  }

  return {
    score,
    reasons,
    climateContext,
    functionHitCount,
    priorityBoostCount,
    specializationMatch: effectiveSpecializationMatch,
    missionOpsAdminMatch,
    trustedContext,
    payCaptured,
    locationCaptured,
    directEmployerApplyUrl,
    unrelatedEngineering,
    salesRole,
    broadSource,
    highVolumeSource,
    weakEmployer
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
  const broadSourceStrictFail = (scoreMeta.broadSource || scoreMeta.highVolumeSource) && (!scoreMeta.climateContext || !scoreMeta.specializationMatch);
  const uncertainEmployerOrApply = (scoreMeta.broadSource || scoreMeta.highVolumeSource) && (
    String(job.parse_warning || "").toLowerCase().includes("organization uncertain") ||
    scoreMeta.weakEmployer ||
    !scoreMeta.directEmployerApplyUrl
  );
  const hasManualProtection = Boolean(
    context.manualProtection ||
    String(job.admin_review_state || "").trim() ||
    String(job.review_reason || "").trim() ||
    String(job.approved_by || "").trim() ||
    typeof job.featured === "boolean"
  );
  const roleRelevant =
    scoreMeta.climateContext &&
    scoreMeta.specializationMatch &&
    scoreMeta.score >= 7;
  const minimumPreserveRelevant =
    scoreMeta.climateContext &&
    scoreMeta.specializationMatch &&
    scoreMeta.score >= 5;
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
    !((scoreMeta.unrelatedEngineering || scoreMeta.salesRole) && !scoreMeta.climateContext) &&
    !broadSourceStrictFail &&
    !uncertainEmployerOrApply;

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
  if (context.isPreservedPending && !minimumPreserveRelevant && !hasManualProtection) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "preserved pending no longer meets minimum relevance" },
      reason: "preserved pending no longer meets minimum relevance"
    };
  }
  if (broadSourceStrictFail) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "high-volume source missing climate context or priority specialization" },
      reason: "high-volume source missing climate context or priority specialization"
    };
  }
  if (!roleRelevant) {
    return {
      bucket: "rejected_noise",
      job: { ...nextJob, triage_bucket: "rejected_noise", triage_reason: "low sustainability or priority specialization relevance" },
      reason: "low sustainability or priority specialization relevance"
    };
  }
  if (uncertainEmployerOrApply) {
    if (context.seenUrls) context.seenUrls.add(originalUrl);
    return {
      bucket: "needs_cleanup",
      job: {
        ...nextJob,
        triage_bucket: "needs_cleanup",
        triage_reason: "broad source employer or apply url uncertain"
      },
      reason: "broad source employer or apply url uncertain"
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

function shouldAutoPublishRetainedJob(job) {
  return (
    Boolean(job.trusted) &&
    String(job.triage_bucket || "") === "review_ready" &&
    Number(job.relevance_score || 0) >= AUTO_PUBLISH_PUBLIC_THRESHOLD &&
    !Boolean(job.rejected_noise) &&
    hasAllowedAutoPublishFunction(job) &&
    !hasBlockedAutoPublishTitle(job) &&
    !isBroadSourceJob(job) &&
    hasDirectEmployerApplyUrl(job)
  );
}

function applyPendingCaps(jobs) {
  const keptBySource = new Map();
  const droppedByCapBySource = new Map();
  const preservedJobs = sortPendingJobs(jobs.filter((job) => job.__pending_preserved));
  const newJobs = sortPendingJobs(jobs.filter((job) => !job.__pending_preserved));
  const cappedNewJobs = [];

  for (const job of newJobs) {
    const sourceKey = getSourceKey(job);
    const sourceStats = keptBySource.get(sourceKey) || { total: 0, highVolumeNew: 0 };
    const isHighVolume = isHighVolumeSourceJob(job) || isBroadSourceJob(job);
    const isVeryHighRelevance = Number(job.relevance_score || 0) >= VERY_HIGH_RELEVANCE_SCORE;
    if (sourceStats.total >= MAX_NEW_PENDING_PER_SOURCE) {
      droppedByCapBySource.set(sourceKey, (droppedByCapBySource.get(sourceKey) || 0) + 1);
      continue;
    }
    if (isHighVolume && !isVeryHighRelevance && sourceStats.highVolumeNew >= MAX_HIGH_VOLUME_SOURCE_PENDING) {
      droppedByCapBySource.set(sourceKey, (droppedByCapBySource.get(sourceKey) || 0) + 1);
      continue;
    }
    if (isBroadSourceJob(job) && !isVeryHighRelevance && sourceStats.highVolumeNew >= MAX_BROAD_SOURCE_NEW_PENDING) {
      droppedByCapBySource.set(sourceKey, (droppedByCapBySource.get(sourceKey) || 0) + 1);
      continue;
    }
    sourceStats.total += 1;
    if (isHighVolume && !isVeryHighRelevance) sourceStats.highVolumeNew += 1;
    keptBySource.set(sourceKey, sourceStats);
    cappedNewJobs.push(job);
  }

  const finalJobs = [];
  for (const job of [...preservedJobs, ...cappedNewJobs]) {
    if (finalJobs.length >= MAX_TOTAL_PENDING) {
      const sourceKey = getSourceKey(job);
      droppedByCapBySource.set(sourceKey, (droppedByCapBySource.get(sourceKey) || 0) + 1);
      continue;
    }
    finalJobs.push(job);
  }

  return {
    kept: finalJobs,
    droppedByCapBySource: Object.fromEntries(
      Array.from(droppedByCapBySource.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    )
  };
}

function collectPendingSizeBySource(jobs) {
  const stats = new Map();
  for (const job of jobs) {
    const sourceKey = getSourceKey(job);
    const serialized = JSON.stringify(job);
    const entry = stats.get(sourceKey) || { source_id: sourceKey, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += Buffer.byteLength(serialized, "utf8");
    stats.set(sourceKey, entry);
  }
  return Array.from(stats.values()).sort((a, b) => b.bytes - a.bytes || b.count - a.count || a.source_id.localeCompare(b.source_id));
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
    const manualProtection = Boolean(
      override.admin_review_state ||
      override.triage_bucket ||
      override.triage_reason ||
      typeof override.featured === "boolean" ||
      String(job.admin_review_state || "").trim() ||
      String(job.review_reason || "").trim()
    );
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
      result = classifyPendingJob(job, {
        seenUrls,
        isPreservedPending: Boolean(job.__pending_preserved),
        manualProtection
      });
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
      rejected_by_relevance: 0,
      kept: 0,
      dropped_by_cap: 0,
      rejected_reasons: {}
    };
    sourceStats[result.bucket] += 1;
    if (result.bucket === "rejected_noise") {
      sourceStats.rejected_reasons[result.reason] = (sourceStats.rejected_reasons[result.reason] || 0) + 1;
      if (/relevance|specialization|high-volume source missing|minimum relevance/i.test(String(result.reason || ""))) {
        sourceStats.rejected_by_relevance += 1;
      }
    }
    rejectedBySource.set(sourceId, sourceStats);
  }

  const capped = applyPendingCaps([...buckets.review_ready, ...buckets.needs_cleanup]);
  const sortedRetainedJobs = sortPendingJobs(capped.kept);
  const autoPublishedJobs = [];
  const pendingRetainedJobs = [];
  for (const job of sortedRetainedJobs) {
    if (shouldAutoPublishRetainedJob(job)) {
      autoPublishedJobs.push(normalizeJob({ ...job, status: "active" }));
      continue;
    }
    pendingRetainedJobs.push(job);
  }
  const adminPendingJobs = pendingRetainedJobs.map(cleanPendingJobForWrite);
  Object.entries(capped.droppedByCapBySource).forEach(([sourceId, count]) => {
    const sourceStats = rejectedBySource.get(sourceId) || {
      review_ready: 0,
      needs_cleanup: 0,
      rejected_noise: 0,
      rejected_by_relevance: 0,
      kept: 0,
      dropped_by_cap: 0,
      rejected_reasons: {}
    };
    sourceStats.dropped_by_cap += count;
    rejectedBySource.set(sourceId, sourceStats);
  });
  adminPendingJobs.forEach((job) => {
    const sourceId = getSourceKey(job);
    const sourceStats = rejectedBySource.get(sourceId) || {
      review_ready: 0,
      needs_cleanup: 0,
      rejected_noise: 0,
      rejected_by_relevance: 0,
      kept: 0,
      dropped_by_cap: 0,
      rejected_reasons: {}
    };
    sourceStats.kept += 1;
    rejectedBySource.set(sourceId, sourceStats);
  });
  autoPublishedJobs.forEach((job) => {
    const sourceId = getSourceKey(job);
    const sourceStats = rejectedBySource.get(sourceId) || {
      review_ready: 0,
      needs_cleanup: 0,
      rejected_noise: 0,
      rejected_by_relevance: 0,
      kept: 0,
      dropped_by_cap: 0,
      rejected_reasons: {}
    };
    sourceStats.auto_published = (sourceStats.auto_published || 0) + 1;
    rejectedBySource.set(sourceId, sourceStats);
  });

  const serializedPending = JSON.stringify(adminPendingJobs, null, 2) + "\n";
  const pendingBytes = Buffer.byteLength(serializedPending, "utf8");
  const pendingSizeBySource = collectPendingSizeBySource(adminPendingJobs);
  if (pendingBytes > MAX_PENDING_BYTES) {
    const topSources = pendingSizeBySource
      .slice(0, 5)
      .map((entry) => `${entry.source_id}: count=${entry.count} size_mb=${bytesToMegabytes(entry.bytes).toFixed(2)}`)
      .join("; ");
    throw new Error(
      `pending-synced-jobs.json would exceed 25MB (${bytesToMegabytes(pendingBytes).toFixed(2)} MB). Top sources by size/count: ${topSources}`
    );
  }

  const summary = {
    generated_at: new Date().toISOString(),
    public_jobs: Array.isArray(publicJobs) ? publicJobs.length : 0,
    pending_review_ready: buckets.review_ready.length,
    pending_needs_cleanup: buckets.needs_cleanup.length,
    rejected_noise: buckets.rejected_noise.length,
    pending_kept_after_caps: adminPendingJobs.length,
    auto_published: autoPublishedJobs.length,
    dropped_by_cap_total: Object.values(capped.droppedByCapBySource).reduce((sum, count) => sum + count, 0),
    duplicate_count_removed: duplicateCountRemoved,
    jobs_with_pay: countJobsWithPay(adminPendingJobs),
    jobs_without_pay: adminPendingJobs.length - countJobsWithPay(adminPendingJobs),
    top_organizations: topOrganizations(adminPendingJobs, 20),
    final_pending_file_size_mb: Number(bytesToMegabytes(pendingBytes).toFixed(2)),
    dropped_by_cap_by_source: capped.droppedByCapBySource,
    retained_examples_by_source: Object.fromEntries(
      Array.from(new Set(adminPendingJobs.map((job) => getSourceKey(job))))
        .map((sourceId) => [sourceId, buildTopExamples(adminPendingJobs.filter((job) => getSourceKey(job) === sourceId))])
    ),
    size_by_source: pendingSizeBySource.slice(0, 20).map((entry) => ({
      source_id: entry.source_id,
      count: entry.count,
      size_mb: Number(bytesToMegabytes(entry.bytes).toFixed(2))
    }))
  };

  if (scrapeReport && Array.isArray(scrapeReport.sources)) {
    scrapeReport.sources = scrapeReport.sources.map((source) => {
      const triage = rejectedBySource.get(String(source.source_id || "")) || {
        review_ready: 0,
        needs_cleanup: 0,
        rejected_noise: 0,
        rejected_by_relevance: 0,
        kept: 0,
        dropped_by_cap: 0,
        auto_published: 0,
        rejected_reasons: {}
      };
      return {
        ...source,
        fetched_count: source.jobs_parsed || 0,
        kept: triage.kept,
        retained: triage.kept,
        review_ready: triage.review_ready,
        needs_cleanup: triage.needs_cleanup,
        rejected_noise: triage.rejected_noise,
        rejected_by_relevance: triage.rejected_by_relevance,
        dropped_by_cap: triage.dropped_by_cap,
        dropped_by_source_cap: triage.dropped_by_cap,
        auto_published: triage.auto_published || 0,
        top_retained_examples: buildTopExamples(adminPendingJobs.filter((job) => getSourceKey(job) === String(source.source_id || ""))),
        rejected_reasons: triage.rejected_reasons
      };
    });
  }

  await writeJson(PENDING_TRIAGE_SUMMARY_FILE, summary);

  return {
    adminPendingJobs,
    autoPublishedJobs,
    rejectedNoiseJobs: buckets.rejected_noise,
    summary,
    report: scrapeReport
  };
}

module.exports = {
  triagePendingJobs
};
