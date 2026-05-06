function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const GENERIC_BOARD_TITLES = new Set(["manager", "analyst", "associate", "director", "engineer"]);
const BOARD_ORGANIZATION_BLOCKLIST = new Set([
  "climatechangejobs",
  "climate change jobs",
  "greenjobsearch",
  "green jobs search",
  "elemental impact"
]);
const ELEMENTAL_ORGANIZATION_HINTS = [
  { pattern: /\bfervo(?:'s)?\b/i, organization: "Fervo Energy", confidence: "high", reason: "elemental_text_fervo" },
  { pattern: /\bconnectder\b/i, organization: "ConnectDER", confidence: "high", reason: "elemental_text_connectder" },
  { pattern: /\bshifted energy\b/i, organization: "Shifted Energy", confidence: "high", reason: "elemental_text_shifted_energy" },
  { pattern: /\bremix\b/i, organization: "Remix", confidence: "high", reason: "elemental_text_remix" },
  { pattern: /\bproterra\b/i, organization: "Proterra", confidence: "high", reason: "elemental_text_proterra" },
  { pattern: /\bvia\b/i, organization: "VIA", confidence: "medium", reason: "elemental_text_via" },
  { pattern: /\bhived\b/i, organization: "HIVED", confidence: "high", reason: "elemental_text_hived" },
  { pattern: /\bqcells\b/i, organization: "Qcells", confidence: "high", reason: "elemental_text_qcells" }
];
const FERVO_ELEMENTAL_PAYLOCITY_PATH = /recruiting\.paylocity\.com\/Recruiting\/Jobs\/Details\/4130814/i;

function matchRule(title, patterns) {
  return patterns.find((pattern) => pattern.test(title)) || null;
}

function safeUrl(input) {
  try {
    return new URL(String(input || "").trim());
  } catch (_error) {
    return null;
  }
}

function isImageAssetUrl(urlValue) {
  return /\.(?:png|jpe?g|gif|svg|webp|avif)(?:[?#].*)?$/i.test(String(urlValue || ""));
}

function extractUrlsFromText(value) {
  return Array.from(new Set(
    String(value || "")
      .match(/https?:\/\/[^\s"'<>]+/gi) || []
  ));
}

function titleCaseSlug(value) {
  return cleanText(value)
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function looksLikeOrganization(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (BOARD_ORGANIZATION_BLOCKLIST.has(normalizeText(text))) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/\b(?:job|jobs|career|careers|apply|application|details?|opportunity|opening|position|role|remote|hybrid|full[- ]?time|part[- ]?time|engineer|manager|director|analyst|coordinator|developer|designer|specialist|officer|associate|lead)\b/i.test(text)) {
    return false;
  }
  return /^[A-Za-z0-9&+.'()\/ -]{2,80}$/.test(text);
}

function flattenObjects(value, results = [], seen = new Set()) {
  if (!value || typeof value !== "object") return results;
  if (seen.has(value)) return results;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => flattenObjects(item, results, seen));
    return results;
  }
  results.push(value);
  Object.values(value).forEach((next) => flattenObjects(next, results, seen));
  return results;
}

function extractOrganizationFromTitle(title) {
  const text = cleanText(title);
  for (const separator of [" — ", " – ", " - ", " | ", " @ ", ", "]) {
    if (!text.includes(separator)) continue;
    const parts = text.split(separator).map((part) => cleanText(part)).filter(Boolean);
    if (parts.length < 2) continue;
    const suffix = parts[parts.length - 1];
    if (looksLikeOrganization(suffix)) {
      return { organization: suffix, confidence: "high", reason: "title_suffix" };
    }
  }
  return null;
}

function extractOrganizationFromEmbeddedFields(job) {
  const payloads = [
    job.raw_payload,
    job.raw_source_data,
    job.metadata
  ];
  const objects = payloads.flatMap((payload) => flattenObjects(payload));
  const preferredKeys = [
    "company",
    "company_name",
    "companyName",
    "organization_name",
    "organizationName",
    "org_name",
    "orgName",
    "employer",
    "employer_name",
    "hiring_organization",
    "hiringOrganization",
    "team_name",
    "brand"
  ];

  for (const object of objects) {
    for (const key of preferredKeys) {
      const candidate = cleanText(object && object[key]);
      if (looksLikeOrganization(candidate)) {
        return { organization: candidate, confidence: "high", reason: `embedded_field:${key}` };
      }
    }
  }

  return null;
}

function extractOrganizationFromDescriptionMetadata(job) {
  let text = cleanText(job.raw_description || job.description || "");
  if (!text) return null;

  const patterns = [
    /(?:https?:\/\/\S+\s+)?\b\d{4,12}\b\s+([A-Z][A-Za-z0-9&+.'()/-]*(?:\s+[A-Z][A-Za-z0-9&+.'()/-]*){0,4})\s+(?:series_[a-z_]+|series [a-z_]+|seed|pre[_ -]?seed|ipo|public|private|nonprofit|other)\b/i,
    /(?:https?:\/\/\S+\s+)?\b\d{4,12}\b\s+([A-Z][A-Za-z0-9&+.'()/-]*(?:\s+[A-Z][A-Za-z0-9&+.'()/-]*){0,4})\s+https?:\/\//i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = cleanText(match[1]);
    if (!looksLikeOrganization(candidate)) continue;
    return { organization: candidate, confidence: "high", reason: "description_metadata" };
  }

  return null;
}

function extractOrganizationFromOriginalUrl(urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (/^[a-z0-9-]+\.teamtailor\.com$/i.test(hostname)) {
    return { organization: titleCaseSlug(hostname.split(".")[0]), confidence: "high", reason: "teamtailor_subdomain" };
  }

  if (hostname === "boards.greenhouse.io" && pathParts[0]) {
    return { organization: titleCaseSlug(pathParts[0]), confidence: "medium", reason: "greenhouse_slug" };
  }

  if (hostname === "apply.workable.com" && pathParts[0]) {
    return { organization: titleCaseSlug(pathParts[0]), confidence: "medium", reason: "workable_slug" };
  }

  if (!/(greenhouse|workable|paylocity|ultipro|smartrecruiters|ashbyhq|bamboohr|recruitee|teamtailor)\./i.test(hostname)) {
    const root = hostname.replace(/^www\./i, "").split(".");
    if (root.length >= 2) {
      return { organization: titleCaseSlug(root[root.length - 2]), confidence: "high", reason: "company_domain" };
    }
  }

  return null;
}

function extractOrganizationFromTextHints(job = {}, hintSet = []) {
  const text = cleanText([
    job.title,
    job.description,
    job.raw_description,
    job.notes,
    typeof job.raw_payload === "string" ? job.raw_payload : JSON.stringify(job.raw_payload || {})
  ].join(" "));
  if (!text) return null;
  for (const hint of hintSet) {
    if (hint.pattern.test(text)) {
      return {
        organization: hint.organization,
        confidence: hint.confidence || "high",
        reason: hint.reason || "text_hint"
      };
    }
  }
  return null;
}

function isGenericBoardTitle(title) {
  return GENERIC_BOARD_TITLES.has(normalizeText(title));
}

function normalizeInferredBoardTitle(value) {
  return cleanText(value)
    .replace(/^the\s+/i, "")
    .replace(/^the\s*,\s*/i, "")
    .replace(/\b(?:the\s*,\s*|the\s+,\s*)/gi, "")
    .replace(/^,\s*/, "")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmbeddedRolePhrases(job = {}) {
  const sources = [
    job.raw_description,
    job.description,
    typeof job.raw_payload === "string" ? job.raw_payload : JSON.stringify(job.raw_payload || {})
  ];
  return sources
    .map((value) => cleanText(value))
    .filter(Boolean)
    .flatMap((text) => text.split(/[\n\r]|(?<=[.!?])\s+/))
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function extractFullerTitleFromText(job = {}) {
  const genericTitle = cleanText(job.title);
  if (!isGenericBoardTitle(genericTitle)) return "";
  const roleText = cleanText([
    job.raw_description,
    job.description,
    typeof job.raw_payload === "string" ? job.raw_payload : JSON.stringify(job.raw_payload || {})
  ].join(" "));
  if (
    normalizeText(genericTitle) === "manager" &&
    /the manager,\s*market\s*&\s*asset operations owns fervo/i.test(roleText)
  ) {
    return "Manager, Market & Asset Operations";
  }
  const titleWord = normalizeText(genericTitle);
  const patterns = [
    new RegExp(`\\bThe\\s+(${genericTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,\\s*[A-Z][A-Za-z0-9&+/'() -]{3,80})\\b`, "i"),
    new RegExp(`\\b(${genericTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,\\s*[A-Z][A-Za-z0-9&+/'() -]{3,80})\\b`, "i"),
    new RegExp(`\\b(${genericTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+of\\s+[A-Z][A-Za-z0-9&+/'() -]{3,80})\\b`, "i")
  ];

  for (const phrase of extractEmbeddedRolePhrases(job)) {
    if (!new RegExp(`\\b${titleWord}\\b`, "i").test(phrase)) continue;
    for (const pattern of patterns) {
      const match = phrase.match(pattern);
      if (!match || !match[1]) continue;
      const inferred = normalizeInferredBoardTitle(match[1])
        .replace(/\b(?:owns|leads|supports|manages|will|is responsible for)\b[\s\S]*$/i, "")
        .trim();
      if (!inferred) continue;
      if (normalizeText(inferred) === titleWord) continue;
      if (!normalizeText(inferred).startsWith(titleWord)) continue;
      return inferred;
    }
  }

  return "";
}

function isTargetedElementalFervoJob(job = {}) {
  const sourceText = normalizeText([
    job.source_id,
    job.source,
    job.source_url,
    job.original_url,
    job.apply_url
  ].filter(Boolean).join(" "));
  const bodyText = cleanText([
    job.raw_description,
    job.description,
    typeof job.raw_payload === "string" ? job.raw_payload : JSON.stringify(job.raw_payload || {})
  ].join(" "));
  const applyText = cleanText(job.apply_url || job.original_url || "");
  const isElemental = sourceText.includes("elemental-impact") || sourceText.includes("elementalimpact") || sourceText.includes("jobs.elementalimpact.com");
  const matchesPaylocity = FERVO_ELEMENTAL_PAYLOCITY_PATH.test(applyText);
  const mentionsFervo = /\bfervo(?:'s| energy)?\b/i.test(bodyText);
  return isElemental && (matchesPaylocity || mentionsFervo);
}

function extractClimateChangeJobsOrganizationFromAltText(job = {}) {
  const text = cleanText([
    job.raw_description,
    job.description,
    job.raw_payload
  ].join(" "));
  const match = text.match(/\balt=["']([^"']{2,120})["']/i);
  if (!match) return null;
  const candidate = cleanText(match[1]);
  if (!looksLikeOrganization(candidate) || /^egen hjemmeside$/i.test(candidate)) return null;
  return { organization: candidate, confidence: "high", reason: "climatechangejobs_alt" };
}

function extractClimateChangeJobsApplyUrl(job = {}) {
  const candidates = [
    job.apply_url,
    job.applyUrl,
    job.original_url,
    job.originalUrl,
    job.source_url,
    job.sourceUrl,
    job.notes,
    job.raw_description,
    job.description,
    job.raw_payload
  ];

  const urls = candidates.flatMap((candidate) => {
    if (typeof candidate === "string") {
      return [candidate, ...extractUrlsFromText(candidate)];
    }
    return extractUrlsFromText(JSON.stringify(candidate || ""));
  });

  const uniqueUrls = Array.from(new Set(urls.map((url) => cleanText(url)).filter(Boolean)));
  for (const url of uniqueUrls) {
    const parsed = safeUrl(url);
    if (!parsed) continue;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.includes("climatechangejobs.com")) continue;
    if (hostname.includes("cloudfront.net")) continue;
    if (hostname.includes("amazonaws.com") && isImageAssetUrl(url)) continue;
    if (isImageAssetUrl(url)) continue;
    return url;
  }
  return "";
}

function extractBoardApplyUrl(job = {}, options = {}) {
  const blockedHosts = (options.blockedHosts || []).map((value) => normalizeText(value));
  const allowedLabelPattern = options.allowedLabelPattern || /\b(?:apply online|apply now|apply|view job|company job page)\b/i;
  const candidates = [
    job.apply_url,
    job.applyUrl,
    job.original_url,
    job.originalUrl,
    job.source_url,
    job.sourceUrl,
    job.notes,
    job.raw_description,
    job.description,
    job.raw_payload
  ];

  const strings = candidates.flatMap((candidate) => {
    if (typeof candidate === "string") return [candidate];
    if (!candidate) return [];
    return [JSON.stringify(candidate)];
  }).filter(Boolean);

  for (const text of strings) {
    const matches = text.matchAll(/(?:apply online|apply now|apply|view job|company job page)[^h]{0,120}(https?:\/\/[^\s"'<>]+)/gi);
    for (const match of matches) {
      const url = cleanText(match[1]);
      const parsed = safeUrl(url);
      if (!parsed) continue;
      if (blockedHosts.some((blockedHost) => parsed.hostname.toLowerCase().includes(blockedHost))) continue;
      if (isImageAssetUrl(url)) continue;
      return url;
    }
  }

  const urls = strings.flatMap((text) => extractUrlsFromText(text));
  const uniqueUrls = Array.from(new Set(urls.map((url) => cleanText(url)).filter(Boolean)));

  for (const text of strings) {
    if (!allowedLabelPattern.test(text)) continue;
    for (const url of uniqueUrls) {
      const parsed = safeUrl(url);
      if (!parsed) continue;
      if (blockedHosts.some((blockedHost) => parsed.hostname.toLowerCase().includes(blockedHost))) continue;
      if (parsed.hostname.toLowerCase().includes("cloudfront.net")) continue;
      if (parsed.hostname.toLowerCase().includes("amazonaws.com") && isImageAssetUrl(url)) continue;
      if (isImageAssetUrl(url)) continue;
      return url;
    }
  }

  return "";
}

function extractGreenJobSearchApplyUrl(job = {}) {
  return extractBoardApplyUrl(job, {
    blockedHosts: ["greenjobsearch.org", "climatechangejobs.com"]
  });
}

function extractGreenJobSearchOrganizationFromText(job = {}) {
  const text = cleanText([
    job.raw_description,
    job.description,
    job.raw_payload
  ].join(" "));
  if (!text) return null;

  const patterns = [
    /\b(?:about|join|at)\s+([A-Z][A-Za-z0-9&+.'()/-]*(?:\s+[A-Z][A-Za-z0-9&+.'()/-]*){0,4})\b/,
    /\b([A-Z][A-Za-z0-9&+.'()/-]*(?:\s+[A-Z][A-Za-z0-9&+.'()/-]*){0,4})\s+(?:is hiring|seeks|is looking for|is growing)\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = cleanText(match[1]);
    if (!looksLikeOrganization(candidate)) continue;
    return { organization: candidate, confidence: "medium", reason: "greenjobsearch_text_hint" };
  }

  return null;
}

const BOARD_SOURCE_CONFIGS = [
  {
    id: "elemental-impact",
    name: "Elemental Impact",
    urls: ["https://jobs.elementalimpact.com/jobs", "https://elementalimpact.com/jobs/"],
    matchers: ["elementalimpact.com/jobs", "jobs.elementalimpact.com/jobs"]
  },
  {
    id: "goodcitizen",
    name: "GoodCitizen",
    urls: ["https://www.goodcitizen.com/executive-search/"],
    matchers: ["goodcitizen.com/executive-search"]
  },
  {
    id: "idealist",
    name: "Idealist",
    urls: ["https://www.idealist.org/"],
    matchers: ["idealist.org"]
  },
  {
    id: "climatechangejobs",
    name: "ClimateChangeJobs",
    urls: ["https://climatechangejobs.com/jobs"],
    matchers: ["climatechangejobs.com/jobs"]
  },
  {
    id: "greenjobsearch",
    name: "GreenJobSearch",
    urls: ["https://greenjobsearch.org/"],
    matchers: ["greenjobsearch.org", "green jobs search", "greenjobsearch"]
  }
];

function findBoardSourceConfig(job = {}) {
  const sourceId = normalizeText(job.source_id || job.sourceId);
  const source = normalizeText(job.source);
  const sourceUrl = normalizeText(job.source_url || job.sourceUrl);
  const notes = normalizeText(job.notes);

  return BOARD_SOURCE_CONFIGS.find((config) => {
    const idMatch = sourceId === normalizeText(config.id);
    const sourceMatch = source === normalizeText(config.name);
    const urlMatch = config.matchers.some((match) => sourceUrl.includes(normalizeText(match)));
    const notesMatch = config.matchers.some((match) => notes.includes(normalizeText(match)));
    return idMatch || sourceMatch || urlMatch || notesMatch;
  }) || null;
}

function isElementalImpactSource(job = {}) {
  return Boolean(findBoardSourceConfig(job)?.id === "elemental-impact");
}

function resolveBoardSourceAttribution(job = {}) {
  const boardConfig = findBoardSourceConfig(job);
  if (!boardConfig) return null;

  const boardSourceUrl = cleanText(boardConfig.urls[0] || job.source_url || job.sourceUrl || "");

  if (boardConfig.id === "climatechangejobs") {
    const applyUrl = extractClimateChangeJobsApplyUrl(job);
    const boardUrl = cleanText(job.original_url || job.originalUrl || job.apply_url || job.applyUrl || job.source_url || job.sourceUrl || boardSourceUrl);
    const chosenApplyUrl = applyUrl || boardUrl;
    const candidates = [
      extractOrganizationFromTitle(job.title),
      extractClimateChangeJobsOrganizationFromAltText(job),
      extractOrganizationFromEmbeddedFields(job),
      extractOrganizationFromOriginalUrl(chosenApplyUrl),
      extractOrganizationFromDescriptionMetadata(job)
    ].filter(Boolean);

    const chosen = candidates.find((candidate) => candidate.confidence === "high") || candidates[0] || null;
    const organization = cleanText(chosen && chosen.organization);
    const isActualBoardOrg = normalizeText(organization) === "climatechangejobs";

    if (!organization || !looksLikeOrganization(organization) || isActualBoardOrg) {
      return {
        sourceName: boardConfig.name,
        sourceUrl: boardUrl || boardSourceUrl,
        organization: "Unknown organization",
        organizationConfidence: "low",
        applyUrl: chosenApplyUrl,
        originalUrl: chosenApplyUrl,
        parseWarning: "ClimateChangeJobs organization uncertain",
        triageBucket: "needs_cleanup",
        triageReason: "ClimateChangeJobs organization uncertain"
      };
    }

    return {
      sourceName: boardConfig.name,
      sourceUrl: boardUrl || boardSourceUrl,
      organization,
      organizationConfidence: chosen.confidence,
      applyUrl: chosenApplyUrl,
      originalUrl: chosenApplyUrl,
      parseWarning: applyUrl ? "" : "ClimateChangeJobs board listing URL only",
      triageBucket: "",
      triageReason: ""
    };
  }

  if (boardConfig.id === "greenjobsearch") {
    const applyUrl = extractGreenJobSearchApplyUrl(job);
    const boardUrl = cleanText(job.source_url || job.sourceUrl || boardSourceUrl);
    const chosenApplyUrl = applyUrl || boardUrl;
    const candidates = [
      extractOrganizationFromTitle(job.title),
      extractOrganizationFromEmbeddedFields(job),
      extractOrganizationFromDescriptionMetadata(job),
      extractGreenJobSearchOrganizationFromText(job),
      extractOrganizationFromOriginalUrl(chosenApplyUrl)
    ].filter(Boolean);
    const chosen = candidates.find((candidate) => candidate.confidence === "high") || candidates[0] || null;
    const organization = cleanText(chosen && chosen.organization);

    if (!organization || !looksLikeOrganization(organization)) {
      return {
        sourceName: boardConfig.name,
        sourceUrl: boardUrl || boardSourceUrl,
        organization: "Unknown organization",
        organizationConfidence: "low",
        applyUrl: chosenApplyUrl,
        originalUrl: chosenApplyUrl,
        parseWarning: applyUrl ? "GreenJobSearch organization uncertain" : "GreenJobSearch apply URL missing",
        triageBucket: "needs_cleanup",
        triageReason: applyUrl ? "GreenJobSearch organization uncertain" : "GreenJobSearch apply URL missing"
      };
    }

    return {
      sourceName: boardConfig.name,
      sourceUrl: boardUrl || boardSourceUrl,
      organization,
      organizationConfidence: chosen.confidence,
      applyUrl: chosenApplyUrl,
      originalUrl: chosenApplyUrl,
      parseWarning: applyUrl ? "" : "GreenJobSearch apply URL missing",
      triageBucket: applyUrl ? "" : "needs_cleanup",
      triageReason: applyUrl ? "" : "GreenJobSearch apply URL missing"
    };
  }

  if (boardConfig.id === "elemental-impact") {
    const applyUrl = cleanText(job.apply_url || job.applyUrl || job.original_url || job.originalUrl || "");
    const targetedFervo = isTargetedElementalFervoJob(job);
    const boardOrganization = cleanText(job.organization);
    const boardOrganizationCandidate =
      boardOrganization &&
      looksLikeOrganization(boardOrganization) &&
      normalizeText(boardOrganization) !== "elemental impact"
        ? { organization: boardOrganization, confidence: "high", reason: "elemental_board_default" }
        : null;
    const candidates = [
      boardOrganizationCandidate,
      targetedFervo ? { organization: "Fervo Energy", confidence: "high", reason: "elemental_targeted_fervo_fallback" } : null,
      extractOrganizationFromOriginalUrl(applyUrl)
    ].filter(Boolean);
    const chosen = candidates.find((candidate) => candidate.confidence === "high") || candidates[0] || null;
    const organization = cleanText(chosen && chosen.organization);
    const boardTitle = cleanText(job.title);
    const repairedTitle = targetedFervo && normalizeText(job.title) === "manager"
      ? "Manager, Market & Asset Operations"
      : (isGenericBoardTitle(boardTitle) ? extractFullerTitleFromText(job) : "");

    if (!organization || !looksLikeOrganization(organization) || normalizeText(organization) === "elemental impact") {
      return {
        sourceName: boardConfig.name,
        sourceUrl: boardSourceUrl,
        organization: "Unknown organization",
        organizationConfidence: "low",
        title: repairedTitle,
        applyUrl,
        originalUrl: applyUrl,
        parseWarning: "Elemental Impact organization uncertain",
        triageBucket: "needs_cleanup",
        triageReason: "Elemental Impact organization uncertain"
      };
    }

    return {
      sourceName: boardConfig.name,
      sourceUrl: boardSourceUrl,
      organization,
      organizationConfidence: chosen.confidence,
      title: repairedTitle || boardTitle,
      applyUrl,
      originalUrl: applyUrl,
      parseWarning: "",
      triageBucket: "",
      triageReason: ""
    };
  }

  const candidates = [
    extractOrganizationFromTitle(job.title),
    extractOrganizationFromEmbeddedFields(job),
    extractOrganizationFromDescriptionMetadata(job),
    extractOrganizationFromOriginalUrl(job.original_url || job.originalUrl || job.apply_url || job.applyUrl)
  ].filter(Boolean);

  const chosen = candidates.find((candidate) => candidate.confidence === "high") || candidates[0] || null;
  const organization = cleanText(chosen && chosen.organization);

  if (!organization || !looksLikeOrganization(organization)) {
    return {
      sourceName: boardConfig.name,
      sourceUrl: boardSourceUrl,
      organization: "Unknown organization",
      organizationConfidence: "low",
      parseWarning: "source board organization uncertain",
      triageBucket: "needs_cleanup",
      triageReason: "source board organization uncertain"
    };
  }

  return {
    sourceName: boardConfig.name,
    sourceUrl: boardSourceUrl,
    organization,
    organizationConfidence: chosen.confidence,
    parseWarning: "",
    triageBucket: "",
    triageReason: ""
  };
}

function resolveElementalImpactAttribution(job = {}) {
  const attribution = resolveBoardSourceAttribution(job);
  return attribution && attribution.sourceName === "Elemental Impact" ? attribution : null;
}

function evaluateSourceTitleRules(job = {}) {
  const title = normalizeText(job.title);
  const organization = normalizeText(job.organization);
  const source = normalizeText(job.source);
  const sourceId = normalizeText(job.source_id);

  if (!title) return null;

  if (
    (organization === "sunrun" || source.includes("sunrun") || sourceId.includes("sunrun")) &&
    matchRule(title, [/^previous$/i, /^next$/i, /^life at sunrun$/i])
  ) {
    return { reason: "source_title_rule:sunrun_navigation_or_brand_copy" };
  }

  if (
    (organization === "rwe" || source.includes("rwe") || sourceId.includes("rwe")) &&
    matchRule(title, [/^the power of all voices$/i, /^eeo policy statement$/i, /^.*know your rights.*$/i])
  ) {
    return { reason: "source_title_rule:rwe_brand_or_policy_copy" };
  }

  if (
    (organization === "edp" || source.includes("edp") || sourceId.includes("edp")) &&
    matchRule(title, [/^portugal$/i, /^portugu[eê]s\s*\(portugal\)$/i])
  ) {
    return { reason: "source_title_rule:edp_location_shell_title" };
  }

  if (
    (organization === "nextera energy" || source.includes("nextera") || sourceId.includes("nextera")) &&
    matchRule(title, [/^life at nextera energy$/i])
  ) {
    return { reason: "source_title_rule:nextera_brand_copy" };
  }

  if (
    (organization === "environmental defense fund" || organization === "edf" || source.includes("environmental defense fund") || sourceId.includes("edf")) &&
    matchRule(title, [
      /^want a .* career\??$/i,
      /^hotline\b/i,
      /^faq\b/i,
      /^our impact$/i,
      /^job explorer$/i,
      /^.*career questions.*$/i,
      /^.*share their stories.*$/i
    ])
  ) {
    return { reason: "source_title_rule:edf_blog_or_career_advice_copy" };
  }

  return null;
}

module.exports = {
  BOARD_SOURCE_CONFIGS,
  evaluateSourceTitleRules,
  isElementalImpactSource,
  resolveBoardSourceAttribution,
  resolveElementalImpactAttribution
};
