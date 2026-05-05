const crypto = require("crypto");
const {
  evaluateSourceTitleRules,
  resolveBoardSourceAttribution
} = require("./source-rules");

const VALID_CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP", "Unknown"]);
const VALID_PERIODS = new Set(["hour", "day", "month", "year", "Unknown"]);
const COMMON_ENTITY_MAP = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  "#39": "'",
  lt: "<",
  gt: ">",
  ndash: "-",
  mdash: "-",
  hellip: "..."
};

const CANADA_PATTERN =
  /canada|toronto|vancouver|montreal|ottawa|calgary|edmonton|quebec|ontario|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|labrador|prince edward island/i;
const UK_PATTERN =
  /uk|united kingdom|england|scotland|wales|northern ireland|london|manchester|birmingham|glasgow|edinburgh/i;
const EU_PATTERN =
  /austria|belgium|bulgaria|croatia|cyprus|czech republic|czechia|denmark|estonia|finland|france|germany|greece|hungary|ireland|italy|latvia|lithuania|luxembourg|malta|netherlands|poland|portugal|romania|slovakia|slovenia|spain|sweden|european union|\beu\b|berlin|paris|amsterdam|madrid|barcelona|lisbon|dublin|brussels|vienna|stockholm|helsinki|rome|milan/i;

const SPECIALIZATION_RULES = [
  { label: "PR / Press", pattern: /\b(?:pr|public relations|press|press secretary|media relations|press officer|press manager|press lead)\b/i },
  { label: "Social Media", pattern: /\b(?:social media|social strategy|community manager|community lead|tiktok|instagram|linkedin content)\b/i },
  { label: "Communications", pattern: /\b(?:communications|communication|comms|internal communications|external communications)\b/i },
  { label: "Content", pattern: /\b(?:content|editorial|copywriter|copywriting|storytelling|writer|newsletter|content design)\b/i },
  { label: "Art / Creative", pattern: /\b(?:creative|art director|artistic|illustration|visual storytelling|brand studio)\b/i },
  { label: "Design", pattern: /\b(?:design|designer|graphic design|visual design|product design|ux|ui)\b/i },
  { label: "Strategy", pattern: /\b(?:strategy|strategist|strategic|planning|planning director)\b/i },
  { label: "Web", pattern: /\b(?:web|website|frontend|front-end|back-end|backend|full stack|full-stack|developer|engineer|software)\b/i },
  { label: "Digital", pattern: /\b(?:digital|digital marketing|digital campaigns|growth marketing|crm|email marketing|seo|sem)\b/i },
  { label: "Data", pattern: /\b(?:data|analytics|analyst|business intelligence|bi analyst|insights)\b/i },
  { label: "Research", pattern: /\b(?:research|researcher|research associate|user research|market research)\b/i },
  { label: "Campaigns", pattern: /\b(?:campaign|campaigns|campaigner|field organizing|organizing)\b/i }
];

const PRIORITY_OBJECT_KEYS = [
  "name",
  "title",
  "value",
  "label",
  "text",
  "summary",
  "location",
  "department",
  "team",
  "description",
  "descriptionPlain",
  "content",
  "html",
  "url"
];
const ORGANIZATION_NOISE_TOKENS = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "co",
  "company",
  "group",
  "holdings",
  "partners",
  "capital",
  "energy",
  "renewables",
  "solar"
]);
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
  "planner",
  "producer",
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
  "remote",
  "usa",
  "united states"
]);
const BAD_SEMANTIC_TITLE_PATTERNS = [
  /^(previous|next|home|search|faq)\b/i,
  /\b(?:our impact|life at|about(?:\s+it)?|job explorer)\b/i,
  /\b(?:the power of all voices|eeo policy statement|know your rights)\b/i,
  /\b(?:privacy|cookie(?:s)?|policy statement|search jobs|careers?)\b/i,
  /^want a .* career\??$/i
];
const ROLE_SIGNAL_PATTERN =
  /\b(?:accountant|administrator|advisor|advocate|analyst|architect|assistant|associate|attorney|buyer|campaigner|consultant|content strategist|coordinator|counsel|designer|developer|director|economist|editor|engineer|executive|fellow|intern|lead|manager|officer|operator|planner|president|press secretary|producer|product manager|program(?:me)?r?|project manager|recruiter|representative|research(?:er| assistant| associate)?|scientist|secretary|specialist|strategist|supervisor|technician|writer)\b/i;
const TITLE_NOISE_PATTERNS = [
  /^previous$/i,
  /^next$/i,
  /\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:/gi,
  /\bpost navigation\b/gi,
  /\b(?:privacy|cookie(?:s)?|terms of (?:use|service)|applicant privacy|applicant login|employment scams|sample employment test|equal opportunity employer|join talent community|search jobs|search results|job openings|we(?:'|’)re hiring|careers website|explore companies|life at|job explorer|our impact|graduate programmes?|the power of all voices)\b/gi
];
const DESCRIPTION_NOISE_PATTERNS = [
  /\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:[^.]{0,200}/gi,
  /\bpost navigation\b[^.]{0,200}/gi,
  /\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
  /\bno\s*wrap\b|\bnowrap\b/gi,
  /https?:\/\/\S+/gi,
  /\s*[>›»]+\s*/g
];
const SOCIAL_SHARE_TEXT_PATTERNS = [
  /\bshare to twitter\b/gi,
  /\bshare on twitter\b/gi,
  /\bshare to facebook\b/gi,
  /\bshare on facebook\b/gi,
  /\bshare to linkedin\b/gi,
  /\bshare on linkedin\b/gi,
  /\bemail this job\b/gi,
  /\bshare this job\b/gi,
  /\bcopy link\b/gi,
  /\btweet\b/gi
];
const SOCIAL_SHARE_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?twitter\.com\/intent[^\s"'<>]*/gi,
  /https?:\/\/(?:www\.)?x\.com\/intent[^\s"'<>]*/gi,
  /https?:\/\/(?:www\.)?facebook\.com\/sharer[^\s"'<>]*/gi,
  /https?:\/\/(?:www\.)?linkedin\.com\/shareArticle[^\s"'<>]*/gi,
  /mailto:\?subject=[^\s"'<>]*/gi
];
const SCHEMA_METADATA_PATTERNS = [
  /\bWebPage\b/gi,
  /\bReadAction\b/gi,
  /\b[A-Za-z]{2,3}-[A-Za-z]{2}\b/g,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
  /\|\s*[A-Z][A-Za-z0-9&.' -]+\s+WebPage\b/gi
];
const CLOSED_JOB_PATTERNS = [
  /\bapplication closed\b/i,
  /\bapplications closed\b/i,
  /\bno longer accepting applications\b/i,
  /\bposition has been filled\b/i,
  /\bjob is no longer available\b/i,
  /\bthis role has been filled\b/i,
  /\bclosed for applications\b/i
];
const BLOCKED_ORGANIZATIONS = [
  "superside",
  "cribl"
];
const PARSER_CLEANUP_STATS = {
  title: 0,
  organization: 0,
  description: 0,
  location_defaulted_remote: 0,
  location_cleaned: 0,
  hybrid_location_repaired: 0,
  elemental_metadata_stripped: 0,
  custom_table_header_stripped: 0,
  html_fragment_stripped: 0
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resetParserCleanupStats() {
  PARSER_CLEANUP_STATS.title = 0;
  PARSER_CLEANUP_STATS.organization = 0;
  PARSER_CLEANUP_STATS.description = 0;
  PARSER_CLEANUP_STATS.location_defaulted_remote = 0;
  PARSER_CLEANUP_STATS.location_cleaned = 0;
  PARSER_CLEANUP_STATS.hybrid_location_repaired = 0;
  PARSER_CLEANUP_STATS.elemental_metadata_stripped = 0;
  PARSER_CLEANUP_STATS.custom_table_header_stripped = 0;
  PARSER_CLEANUP_STATS.html_fragment_stripped = 0;
}

function getParserCleanupStats() {
  return {
    parser_cleaned_title_count: PARSER_CLEANUP_STATS.title,
    parser_cleaned_org_count: PARSER_CLEANUP_STATS.organization,
    parser_cleaned_description_count: PARSER_CLEANUP_STATS.description,
    parser_location_defaulted_remote_count: PARSER_CLEANUP_STATS.location_defaulted_remote,
    parser_location_cleaned_count: PARSER_CLEANUP_STATS.location_cleaned,
    parser_hybrid_location_repaired_count: PARSER_CLEANUP_STATS.hybrid_location_repaired,
    parser_elemental_metadata_stripped_count: PARSER_CLEANUP_STATS.elemental_metadata_stripped,
    parser_custom_table_header_stripped_count: PARSER_CLEANUP_STATS.custom_table_header_stripped,
    parser_html_fragment_stripped_count: PARSER_CLEANUP_STATS.html_fragment_stripped
  };
}

function incrementParserCleanupStat(field) {
  if (field === "title") PARSER_CLEANUP_STATS.title += 1;
  if (field === "organization") PARSER_CLEANUP_STATS.organization += 1;
  if (field === "description") PARSER_CLEANUP_STATS.description += 1;
  if (field === "location_defaulted_remote") PARSER_CLEANUP_STATS.location_defaulted_remote += 1;
  if (field === "location_cleaned") PARSER_CLEANUP_STATS.location_cleaned += 1;
  if (field === "hybrid_location_repaired") PARSER_CLEANUP_STATS.hybrid_location_repaired += 1;
  if (field === "elemental_metadata_stripped") PARSER_CLEANUP_STATS.elemental_metadata_stripped += 1;
  if (field === "custom_table_header_stripped") PARSER_CLEANUP_STATS.custom_table_header_stripped += 1;
  if (field === "html_fragment_stripped") PARSER_CLEANUP_STATS.html_fragment_stripped += 1;
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value) {
  return !Number.isNaN(Date.parse(value));
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSocialShareJunk(value) {
  let next = String(value || "");
  for (const pattern of SOCIAL_SHARE_URL_PATTERNS) {
    next = next.replace(pattern, " ");
  }
  for (const pattern of SOCIAL_SHARE_TEXT_PATTERNS) {
    next = next.replace(pattern, " ");
  }
  next = next
    .replace(/\bfacebook\b(?=\s*(?:share|sharer)?\b)/gi, " ")
    .replace(/\blinkedin\b(?=\s*(?:share|sharearticle)?\b)/gi, " ");
  return normalizeWhitespace(next);
}

function isSocialShareUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return SOCIAL_SHARE_URL_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeRoleUrl(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text || isSocialShareUrl(text)) return "";
  return text;
}

function normalizeLooseToken(value) {
  return normalizeWhitespace(String(value || ""))
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function normalizeWorkplaceType(value, fallback = "") {
  const text = normalizeWhitespace(stringifySafe(value));
  const normalized = normalizeLooseToken(text);
  if (!normalized) return fallback;
  if (/\bhybrid\b/.test(normalized)) return "Hybrid";
  if (/\bonsite\b|\bon site\b/.test(normalized)) return "On-site";
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(normalized)) return "Remote";
  return text;
}

function normalizeEmploymentType(value, fallback = "") {
  const text = normalizeWhitespace(stringifySafe(value));
  const normalized = normalizeLooseToken(text);
  if (!normalized) return fallback;
  if (/\bcontract(?:or)?\b/.test(normalized)) return "Contract";
  if (/\btemporary\b|\btemp\b/.test(normalized)) return "Temporary";
  if (/\bintern(?:ship)?\b/.test(normalized)) return "Internship";
  if (/\bpart time\b/.test(normalized)) return "Part-time";
  if (/\bfull time\b/.test(normalized)) return "Full-time";
  return text;
}

function buildWorkplaceSignalText(job = {}) {
  return normalizeWhitespace([
    job.workplace_type,
    job.workplaceType,
    job.location,
    job.title,
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary,
    job.notes,
    cleanFlattenedText(job.raw_payload)
  ].filter(Boolean).join(" "));
}

function hasExplicitRemoteSignal(text) {
  return /\b(?:fully remote|100%\s*remote|remote(?:\s+role|\s+position|\s+work)?|work from home|distributed team|remote-first)\b/i.test(String(text || ""));
}

function hasExplicitHybridSignal(text) {
  return /\b(?:hybrid|hybrid schedule|\d+\s+days?\s+in\s+office|in-?office days?|partially remote)\b/i.test(String(text || ""));
}

function hasExplicitOnsiteSignal(text) {
  return /\b(?:on[\s-]?site|in[\s-]?office|office[\s-]?based)\b/i.test(String(text || ""));
}

function looksLikePhysicalLocation(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  if (/\b(?:previous post|next post|related posts?|title business platform location date|hdrdate|viewbox=|POINT\s*\(|locality\b)\b/i.test(text)) {
    return false;
  }
  if (/^(?:remote|hybrid|united states|us|usa|nationwide|global|multiple locations)$/i.test(text)) {
    return false;
  }
  if (/\b(?:remote|hybrid|work from home|distributed team|remote-first|anywhere|global|multiple locations|various locations|location listed on application|worldwide)\b/i.test(text)) {
    return false;
  }
  if (/^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(text)) return true;
  if (/^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?$/.test(text)) return true;
  return true;
}

function resolveWorkplaceType(job = {}) {
  const explicit = normalizeWorkplaceType(job.workplace_type || job.workplaceType);
  if (explicit) return explicit;

  const signalText = buildWorkplaceSignalText(job);
  if (hasExplicitHybridSignal(signalText)) return "Hybrid";
  if (hasExplicitRemoteSignal(signalText)) return "Remote";
  if (hasExplicitOnsiteSignal(signalText)) return "On-site";
  if (looksLikePhysicalLocation(job.location)) return "On-site";
  return "";
}

function resolveEmploymentType(job = {}) {
  return normalizeEmploymentType(job.job_type || job.jobType, "Full-time");
}

function normalizeCompanyCore(value) {
  return normalizeWhitespace(stripHtml(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !ORGANIZATION_NOISE_TOKENS.has(token))
    .join(" ");
}

function removeTitleOrganizationSuffix(title, organization) {
  const separators = [" | ", " - ", " — ", " – ", " @ ", ", "];
  const orgCore = normalizeCompanyCore(organization);
  if (!orgCore) return title;

  for (const separator of separators) {
    if (!title.includes(separator)) continue;
    const parts = title.split(separator).map((part) => normalizeWhitespace(part)).filter(Boolean);
    if (parts.length < 2) continue;
    const suffix = parts[parts.length - 1];
    const suffixCore = normalizeCompanyCore(suffix);
    if (!suffixCore) continue;
    if (suffixCore === orgCore || orgCore.includes(suffixCore) || suffixCore.includes(orgCore)) {
      return parts.slice(0, -1).join(separator).trim();
    }
  }

  return title;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildParserSourceOptions(job = {}) {
  return {
    source: normalizeWhitespace(stringifySafe(job.source)),
    sourceType: normalizeWhitespace(stringifySafe(job.source_type || job.sourceType)),
    sourceUrl: normalizeWhitespace(stringifySafe(job.source_url || job.sourceUrl || job.original_url || job.originalUrl)),
    organization: normalizeWhitespace(stringifySafe(job.organization))
  };
}

function isElementalImpactSource(options = {}) {
  return /elemental impact/i.test([options.source, options.sourceType, options.sourceUrl].filter(Boolean).join(" "));
}

function isCustomCareerPageSource(options = {}) {
  return /custom careers? page/i.test([options.source, options.sourceType, options.sourceUrl].filter(Boolean).join(" "));
}

function stripHtmlFragmentNoise(value) {
  const original = normalizeWhitespace(String(value || ""));
  const next = normalizeWhitespace(
    stripHtml(
      original
        .replace(/\b\d*\/svg"\s*viewBox="[^"]*"[^<]*/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<path[\s\S]*?\/?>/gi, " ")
        .replace(/\bviewBox="[^"]*"/gi, " ")
        .replace(/\bxmlns="[^"]*"/gi, " ")
    )
  );
  if (original && next !== original) incrementParserCleanupStat("html_fragment_stripped");
  return next;
}

function cleanElementalImpactText(value, field = "text") {
  const original = normalizeWhitespace(String(value || ""));
  let next = original
    .replace(/\bPOINT\s*\([^)]*\)/gi, " ")
    .replace(/\blocality\s+POINT\s*\([^)]*\)/gi, " ")
    .replace(/\b(?:latitude|longitude|geocode|geocoded?|continent|county|administrative area level \d+)\b[^.]{0,160}/gi, " ")
    .replace(/\b\d{7,10}\s*-\s*(?=senior|staff|principal|lead|junior|manager|director)\b/gi, " ")
    .replace(/\b(?:Business\/Productivity Software|Cleantech|Oil\s*&\s*Gas|Renewable Energy|funding|revenue|valuation|headquarters|employee count|employee size)\b[^.]{0,240}/gi, " ");

  if (field === "description") {
    next = splitIntoSentences(next)
      .filter((sentence) => !/\b(?:POINT\s*\(|locality\b|funding\b|revenue\b|valuation\b|headquarters\b|Business\/Productivity Software|Cleantech|Oil\s*&\s*Gas|Renewable Energy)\b/i.test(sentence))
      .join(" ");
  }

  next = normalizeWhitespace(next);
  if (original && next !== original) incrementParserCleanupStat("elemental_metadata_stripped");
  return next;
}

function cleanCustomCareerPageText(value, field = "text", options = {}) {
  const original = normalizeWhitespace(String(value || ""));
  let next = original
    .replace(/\bTitle\s+Business Platform\s+Location\s+Date\b/gi, " ")
    .replace(/\be"\s*"\s*"[^A-Za-z0-9]{0,20}/gi, " ");

  if (field === "location") {
    next = next
      .replace(/^.*?\bLocation(?:\s+Date)?\b\s*/i, "")
      .replace(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b.*$/i, " ");
    if (options.organization) {
      next = next.replace(new RegExp(`(?:,?\\s+)?${escapeRegExp(options.organization)}.*$`, "i"), " ");
    }
  } else {
    next = next
      .replace(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/gi, " ");
  }

  next = normalizeWhitespace(next);
  if (original && next !== original) incrementParserCleanupStat("custom_table_header_stripped");
  return next;
}

function stripParserTemplateJunk(value, field = "text", options = {}) {
  let text = normalizeWhitespace(stripSocialShareJunk(stripHtml(decodeHtmlEntities(value))));
  if (!text) return "";

  text = stripHtmlFragmentNoise(text);
  text = text
    .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/\b(?:hdrDate|hdrTitle|hdr[A-Za-z]+)\b/gi, " ")
    .replace(/\be\s*(?:(?:"|&quot;)\s*)?nowrap\b/gi, " ")
    .replace(/\b(?:previous|next)\s*post\b[:\s-]*/gi, " ")
    .replace(/\brelated posts?\b[:\s-]*/gi, " ")
    .replace(/\bpost navigation\b[:\s-]*/gi, " ")
    .replace(/\bposted by\b[:\s-]*[^|•·]{0,80}/gi, " ")
    .replace(/\b(?:share this(?: job)?|share on|share to|email this job|copy link|tweet)\b[^.]{0,120}/gi, " ")
    .replace(/\b(?:header|footer)\b(?=\s+(?:navigation|links|menu|content|text))/gi, " ")
    .replace(/\b(?:article|articles|news)\b(?=\s*[|:>\-])/gi, " ")
    .replace(/\|\s*\|+/g, " | ")
    .replace(/\s*[|•·]+\s*/g, " | ")
    .replace(/^[|/>,.;:\-)\](\s]+|[|/>,.;:\-(\[\s]+$/g, " ")
    .replace(/\)\s*,\s*e\b/gi, ") ")
    .replace(/\s{2,}/g, " ");

  if (field === "title" || field === "organization" || field === "source") {
    text = text
      .replace(/^(?:[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+)+/g, " ")
      .replace(/\b(?:previous|next|related posts?|share this|posted by)\b.*$/i, " ")
      .replace(/^(\|\s*)+|(\s*\|)+$/g, " ")
      .replace(/\s*\|\s*/g, " ")
      .replace(/\s{2,}/g, " ");
  }

  if (isElementalImpactSource(options)) {
    text = cleanElementalImpactText(text, field);
  }
  if (isCustomCareerPageSource(options)) {
    text = cleanCustomCareerPageText(text, field, options);
  }

  return normalizeWhitespace(text);
}

function isSingleFirstNameOnlyTitle(title) {
  const normalized = String(title || "").trim();
  if (!/^[A-Z][a-z]{2,20}$/.test(normalized)) return false;
  return !COMMON_SINGLE_WORD_ROLE_TITLES.has(normalized.toLowerCase());
}

function isOrganizationOnlyTitle(title, organization) {
  const normalizedTitle = String(title || "").trim();
  const normalizedOrg = String(organization || "").trim();
  if (!normalizedTitle || !normalizedOrg) return false;
  const titleCore = normalizeCompanyCore(normalizedTitle);
  const orgCore = normalizeCompanyCore(normalizedOrg);
  return Boolean(titleCore && orgCore && titleCore === orgCore);
}

function isLocationOnlyTitle(title, location) {
  const normalizedTitle = normalizeWhitespace(String(title || "")).toLowerCase();
  const normalizedLocation = normalizeWhitespace(String(location || "")).toLowerCase();
  if (!normalizedTitle) return false;
  if (LOCATION_ONLY_TITLES.has(normalizedTitle)) return true;
  return Boolean(normalizedLocation && normalizedTitle === normalizedLocation);
}

function hasRoleSignal(title) {
  return ROLE_SIGNAL_PATTERN.test(String(title || ""));
}

function isClearlyNotJobTitle(title = "", job = {}) {
  const normalizedTitle = normalizeWhitespace(String(title || ""));
  const lowered = normalizedTitle.toLowerCase();
  if (!lowered) return true;
  if (isSingleFirstNameOnlyTitle(normalizedTitle)) return true;
  if (isOrganizationOnlyTitle(normalizedTitle, job.organization)) return true;
  if (isLocationOnlyTitle(normalizedTitle, job.location)) return true;
  if (BAD_SEMANTIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) return true;

  const words = lowered.split(/\s+/).filter(Boolean);
  if (words.length === 1 && !hasRoleSignal(normalizedTitle)) return true;
  if (!hasRoleSignal(normalizedTitle)) return true;

  return false;
}

function normalizeTitle(value, organization = "", options = {}) {
  const original = normalizeWhitespace(stripHtml(decodeHtmlEntities(value)));
  let text = stripParserTemplateJunk(value, "title", options);
  if (!text) return "";

  text = text
    .replace(/[>›»]+/g, " ")
    .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:/gi, " ")
    .replace(/\bpost navigation\b/gi, " ")
    .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
    .replace(/\s+(?:remote|hybrid|on-?site)\s+[—-]\s+(?:full[- ]?time|part[- ]?time|contract|temporary|internship)\b.*$/i, "")
    .replace(/\s+[—-]\s+(?:full[- ]?time|part[- ]?time|contract|temporary|internship)\b.*$/i, "")
    .replace(/^[\/|>:\-.\s]+|[\/|>:\-.\s]+$/g, " ");

  text = removeTitleOrganizationSuffix(normalizeWhitespace(text), organization);
  const normalized = normalizeWhitespace(text);
  if (original && normalized && normalized !== original) {
    incrementParserCleanupStat("title");
  }
  return normalized;
}

function normalizeOrganization(value) {
  const original = normalizeWhitespace(stripHtml(decodeHtmlEntities(value)));
  const cleaned = stripParserTemplateJunk(value, "organization")
    .replace(/\b(?:posted by|share this|related posts?)\b.*$/i, " ")
    .replace(/\s{2,}/g, " ");
  const normalized = normalizeWhitespace(cleaned);
  if (original && normalized && normalized !== original) {
    incrementParserCleanupStat("organization");
  }
  return normalized;
}

function normalizeSourceName(value) {
  return normalizeWhitespace(
    stripParserTemplateJunk(value, "source")
      .replace(/^(\|\s*)+|(\s*\|)+$/g, " ")
      .replace(/\s{2,}/g, " ")
  );
}

function normalizeOrganizationWithOptions(value, options = {}) {
  const original = normalizeWhitespace(stripHtml(decodeHtmlEntities(value)));
  const cleaned = stripParserTemplateJunk(value, "organization", options)
    .replace(/\b(?:posted by|share this|related posts?)\b.*$/i, " ")
    .replace(/\s{2,}/g, " ");
  const normalized = normalizeWhitespace(cleaned);
  if (original && normalized && normalized !== original) {
    incrementParserCleanupStat("organization");
  }
  return normalized;
}

function normalizeSourceNameWithOptions(value, options = {}) {
  return normalizeWhitespace(
    stripParserTemplateJunk(value, "source", options)
      .replace(/^(\|\s*)+|(\s*\|)+$/g, " ")
      .replace(/\s{2,}/g, " ")
  );
}

function cleanLocationText(value, options = {}) {
  const trackStats = options.trackStats !== false;
  const original = normalizeWhitespace(stringifySafe(value));
  let text = stripParserTemplateJunk(value, "location", options)
    .replace(/\b(?:null|undefined|n\/a|not specified|location listed on application)\b/gi, " ")
    .replace(/\bPOINT\s*\([^)]*\)/gi, " ")
    .replace(/\blocality\b/gi, " ")
    .replace(/\b(?:county|continent|administrative area level \d+)\b[^,;|]{0,80}/gi, " ")
    .replace(/\b(?:Title|Business Platform|Location|Date)\b/gi, " ")
    .replace(/^(?:hybrid|remote|on[\s-]?site)\s*[,/-]\s*/i, "")
    .replace(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b.*$/i, " ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  if (options.organization) {
    text = text.replace(new RegExp(`(?:,?\\s+)?${escapeRegExp(options.organization)}$`, "i"), "").trim();
  }

  const locationMatch = text.match(/([A-Z][A-Za-z.' -]+,\s*(?:[A-Z]{2}|[A-Za-z.' -]+)(?:,\s*(?:USA|United States|Canada|UK|United Kingdom))?(?:\s*(?:or|\/|, or|,)\s*(?:Remote|[A-Z][A-Za-z.' -]+,\s*(?:[A-Z]{2}|[A-Za-z.' -]+)(?:,\s*(?:USA|United States|Canada|UK|United Kingdom))?))*)/);
  if (locationMatch && locationMatch[1]) {
    text = normalizeWhitespace(locationMatch[1]);
  }

  text = text
    .replace(/^(?:hybrid[,/\s-]*)$/i, "")
    .replace(/^(?:previous post|next post|related posts?)$/i, "")
    .replace(/^[,;:|/>\-.\s]+|[,;:|/<\-.\s]+$/g, "")
    .trim();

  const workplaceType = normalizeWorkplaceType(options.workplaceType || options.workplace_type || "");
  if (!text) {
    if (workplaceType === "Hybrid") {
      if (trackStats) incrementParserCleanupStat("hybrid_location_repaired");
      return "Hybrid / Anywhere";
    }
    if (trackStats) incrementParserCleanupStat("location_defaulted_remote");
    return "Remote";
  }

  if (/^hybrid$/i.test(text)) {
    if (trackStats) incrementParserCleanupStat("hybrid_location_repaired");
    return "Hybrid / Anywhere";
  }
  if (/^remote$/i.test(text)) {
    if (trackStats && original && text !== original) incrementParserCleanupStat("location_cleaned");
    return "Remote";
  }

  if (trackStats && original && text !== original) {
    incrementParserCleanupStat("location_cleaned");
  }
  return text;
}

function normalizeLocationDisplay(job = {}, workplaceType = "") {
  const options = {
    ...buildParserSourceOptions(job),
    workplaceType
  };
  const locationCandidates = [
    job.location,
    job.display?.location,
    job.location_name,
    job.locationName,
    job.formatted_location,
    job.formattedLocation,
    job.city && job.state ? `${job.city}, ${job.state}` : "",
    job.city && job.region ? `${job.city}, ${job.region}` : "",
    job.city && job.country ? `${job.city}, ${job.country}` : "",
    job.raw_payload?.location,
    job.raw_payload?.locationName,
    job.raw_payload?.formattedLocation,
    job.raw_payload?.categories?.location,
    job.metadata?.location
  ].filter(Boolean);

  for (const candidate of locationCandidates) {
    const cleaned = cleanLocationText(candidate, { ...options, trackStats: false });
    if (!cleaned) continue;
    if (workplaceType === "Hybrid" && cleaned === "Hybrid / Anywhere") continue;
    if (cleaned === "Remote" && locationCandidates.length > 1) continue;
    if (looksLikePhysicalLocation(cleaned) || /\bremote\b/i.test(cleaned)) {
      const original = normalizeWhitespace(stringifySafe(candidate));
      if (cleaned === "Hybrid / Anywhere") incrementParserCleanupStat("hybrid_location_repaired");
      else if (original && cleaned !== original) incrementParserCleanupStat("location_cleaned");
      return cleaned;
    }
  }

  const fallbackLocation = cleanLocationText("", { ...options, trackStats: false });
  if (fallbackLocation === "Hybrid / Anywhere") incrementParserCleanupStat("hybrid_location_repaired");
  else if (fallbackLocation === "Remote") incrementParserCleanupStat("location_defaulted_remote");
  return fallbackLocation;
}

function isGenericRoleTitle(title = "") {
  return ["manager", "analyst", "associate", "director", "engineer"].includes(normalizeWhitespace(String(title || "")).toLowerCase());
}

function stringifySafe(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.includes("[object Object]") ? "" : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifySafe(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    for (const key of PRIORITY_OBJECT_KEYS) {
      const next = stringifySafe(value[key]);
      if (next) return next;
    }
    return "";
  }
  return "";
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = String(entity).toLowerCase();
    if (COMMON_ENTITY_MAP[lower]) return COMMON_ENTITY_MAP[lower];
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function stripHtml(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(String(value || ""))
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/h[1-6]>|<\/tr>/gi, ". ")
      .replace(/<li[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+([.,!?;:])/g, "$1")
  );
}

function flattenTextValues(value, seen = new Set()) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number") return Number.isFinite(value) ? [String(value)] : [];
  if (typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenTextValues(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return [];
    seen.add(value);
    const prioritized = PRIORITY_OBJECT_KEYS.flatMap((key) => flattenTextValues(value[key], seen));
    const rest = Object.entries(value)
      .filter(([key]) => !PRIORITY_OBJECT_KEYS.includes(key))
      .flatMap(([, next]) => flattenTextValues(next, seen));
    return [...prioritized, ...rest];
  }
  return [];
}

function cleanFlattenedText(value) {
  return normalizeWhitespace(stripHtml(flattenTextValues(value).join(" ")));
}

function detectSalaryCurrency(salary, location) {
  const salaryText = normalizeWhitespace(stringifySafe(salary) || cleanFlattenedText(salary));
  const locationText = normalizeWhitespace(stringifySafe(location)).toLowerCase();

  if (!salaryText) return "Unknown";
  if (/\b(?:CAD|CA\$)\b/i.test(salaryText) || /CA\$/i.test(salaryText)) return "CAD";
  if (/\b(?:USD|US\$)\b/i.test(salaryText) || /US\$/i.test(salaryText)) return "USD";
  if (/\bEUR\b/i.test(salaryText) || /€/i.test(salaryText)) return "EUR";
  if (/\bGBP\b/i.test(salaryText) || /£/i.test(salaryText)) return "GBP";
  if (/\$/i.test(salaryText)) {
    if (CANADA_PATTERN.test(locationText)) return "CAD";
    return "USD";
  }
  if (CANADA_PATTERN.test(locationText)) return "CAD";
  if (UK_PATTERN.test(locationText)) return "GBP";
  if (EU_PATTERN.test(locationText)) return "EUR";
  return "Unknown";
}

function detectSalaryPeriod(salary) {
  const text = normalizeWhitespace(stringifySafe(salary) || cleanFlattenedText(salary)).toLowerCase();
  if (!text) return "Unknown";
  if (/(per hour|\/\s*hour|\/\s*hr|\bhr\b|\bhourly\b)/i.test(text)) return "hour";
  if (/(per day|\/\s*day|\bdaily\b)/i.test(text)) return "day";
  if (/(per month|\/\s*month|\/\s*mo\b|\bmonthly\b|\bmo\b)/i.test(text)) return "month";
  if (/(per year|\/\s*year|\/\s*yr|\bannual\b|\byearly\b|\ba year\b|annually|per annum)/i.test(text)) return "year";
  return "Unknown";
}

function normalizeSalaryValue(rawNumber, multiplierToken) {
  const base = Number(String(rawNumber || "").replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = String(multiplierToken || "").toLowerCase();
  if (suffix === "k") return Math.round(base * 1000);
  if (suffix === "m") return Math.round(base * 1000000);
  return Math.round(base);
}

function normalizeSalaryPeriodToken(value) {
  const text = normalizeWhitespace(stringifySafe(value)).toLowerCase();
  if (!text) return "";
  if (/(hour|hourly|hr)/i.test(text)) return "per hour";
  if (/(day|daily)/i.test(text)) return "per day";
  if (/(month|monthly|mo)/i.test(text)) return "per month";
  if (/(year|yearly|annual|annually|yr)/i.test(text)) return "per year";
  return "";
}

function salaryCandidateToText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const direct = [
    value.summary,
    value.description,
    value.text,
    value.value,
    value.amount,
    value.range,
    value.salary
  ]
    .map((item) => normalizeWhitespace(stringifySafe(item)))
    .find(Boolean);
  if (direct) return direct;

  const min = value.minAmount ?? value.minimum ?? value.min ?? value.from;
  const max = value.maxAmount ?? value.maximum ?? value.max ?? value.to;
  const currency = normalizeWhitespace(stringifySafe(value.currency || value.currencyCode));
  const period = normalizeSalaryPeriodToken(value.period || value.interval || value.unit);
  const minValue = Number.isFinite(Number(min)) ? Number(min) : null;
  const maxValue = Number.isFinite(Number(max)) ? Number(max) : null;

  if (minValue === null && maxValue === null) return "";

  const format = (amount) => {
    if (!Number.isFinite(amount)) return "";
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  };

  if (minValue !== null && maxValue !== null) {
    return normalizeWhitespace(`${currency} ${format(minValue)} - ${format(maxValue)} ${period}`.trim());
  }
  if (minValue !== null) {
    return normalizeWhitespace(`${currency} starting at ${format(minValue)} ${period}`.trim());
  }
  return normalizeWhitespace(`${currency} up to ${format(maxValue)} ${period}`.trim());
}

function findBestSalaryMatch(text) {
  const cleaned = normalizeWhitespace(stripHtml(text));
  if (!cleaned) return "";

  const matchers = [
    /(?:annual salary range is|salary range(?: for this position)? is|salary for this position is|compensation range:?|pay range:?|salary:?|compensation:?|pay:?|wage:?|rate:?)[^.]{0,160}(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?(?:\s*(?:hourly|daily|monthly|annual|annually|per hour|per day|per month|per year|\/hr|\/hour|\/day|\/month|\/mo|\/year|\/yr))?/i,
    /(?:starting at|up to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|monthly|annual|annually|per hour|per day|per month|per year|\/hr|\/hour|\/day|\/month|\/mo|\/year|\/yr))?/i,
    /(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|monthly|annual|annually|per hour|per day|per month|per year|\/hr|\/hour|\/day|\/month|\/mo|\/year|\/yr))?/i,
    /(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|monthly|annual|annually|per hour|per day|per month|per year|\/hr|\/hour|\/day|\/month|\/mo|\/year|\/yr))/i,
    /\b(?:competitive salary|competitive compensation|salary not listed|compensation not listed|pay not listed|salary unavailable|compensation unavailable|not disclosed|undisclosed)\b/i
  ];

  for (const matcher of matchers) {
    const match = cleaned.match(matcher);
    if (match && match[0]) {
      return normalizeWhitespace(match[0].replace(/\s+([.,!?;:])/g, "$1"));
    }
  }
  return "";
}

function extractSalaryText(job = {}) {
  const explicitCandidates = [
    job.salary,
    job.compensation,
    job.pay,
    job.pay_range,
    job.wage,
    job.rate,
    job.salaryRange,
    job.salaryDescription,
    job.salaryDescriptionPlain,
    job.raw_payload?.salary,
    job.raw_payload?.compensation,
    job.raw_payload?.pay,
    job.raw_payload?.pay_range,
    job.raw_payload?.wage,
    job.raw_payload?.rate,
    job.raw_payload?.salaryRange,
    job.raw_payload?.salaryDescription,
    job.raw_payload?.salaryDescriptionPlain
  ];

  for (const candidate of explicitCandidates) {
    const text = normalizeWhitespace(salaryCandidateToText(candidate) || stringifySafe(candidate) || cleanFlattenedText(candidate));
    if (!text) continue;
    return findBestSalaryMatch(text) || text;
  }

  const secondaryCandidates = [
    job.metadata,
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.lists,
    job.requirements,
    job.responsibilities,
    job.raw_payload,
    job
  ];

  for (const candidate of secondaryCandidates) {
    const matched = findBestSalaryMatch(candidate);
    if (matched) return matched;
  }

  return "";
}

function parseSalaryRange(salary, location) {
  const rawSalary = normalizeWhitespace(stringifySafe(salary) || cleanFlattenedText(salary));
  const salaryText = rawSalary.trim();
  const salaryCurrency = salaryText ? detectSalaryCurrency(salaryText, location) : "Unknown";
  const salaryPeriod = salaryText ? detectSalaryPeriod(salaryText) : "Unknown";
  const empty = {
    raw_salary: rawSalary,
    salary: "",
    salary_min: null,
    salary_max: null,
    salary_currency: salaryCurrency,
    salary_period: salaryPeriod,
    salary_visible: false
  };

  if (!salaryText) return empty;

  if (/\b(?:salary not listed|compensation not listed|pay not listed|salary unavailable|compensation unavailable|not disclosed|undisclosed)\b/i.test(salaryText)) {
    return empty;
  }

  const isMaxOnly = /\b(?:up to|maximum|max\.?)\b/i.test(salaryText);
  const isMinOnly = /\b(?:starting at|starts at|from|minimum|min\.?)\b/i.test(salaryText) || /\+$/.test(salaryText);

  const text = salaryText
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/(?<=\d)\+(?=\D|$)/g, "")
    .replace(/\s+/g, " ");

  const matches = [...text.matchAll(/(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£]|C\$)?\s*(\d[\d,]*\.?\d*)\s*([kKmM]?)/g)];
  const amounts = matches
    .map((match) => normalizeSalaryValue(match[1], match[2]))
    .filter((value) => Number.isFinite(value));

  if (!amounts.length) {
    return {
      ...empty,
      salary: salaryText,
      salary_visible: true
    };
  }

  let salaryMin = null;
  let salaryMax = null;
  if (amounts.length > 1) {
    salaryMin = Math.min(amounts[0], amounts[1]);
    salaryMax = Math.max(amounts[0], amounts[1]);
  } else if (isMaxOnly) {
    salaryMax = amounts[0];
  } else if (isMinOnly) {
    salaryMin = amounts[0];
  } else {
    salaryMin = amounts[0];
    salaryMax = amounts[0];
  }

  return {
    raw_salary: rawSalary,
    salary: salaryText,
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    salary_period:
      salaryPeriod !== "Unknown"
        ? salaryPeriod
        : amounts.some((amount) => amount >= 1000 || /[kKmM]/.test(text))
          ? "year"
          : "Unknown",
    salary_visible: true
  };
}

function splitIntoSentences(value) {
  return normalizeWhitespace(value).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function normalizeComparableText(value) {
  return normalizeWhitespace(stripHtml(decodeHtmlEntities(value)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractParagraphs(value) {
  const raw = decodeHtmlEntities(stripSocialShareJunk(String(value || "")))
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/h[1-6]>\s*(?=<p|<div|<section|<article|<li|<ul|<ol)/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/h[1-6]>|<\/tr>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return raw
    .split(/\n{2,}|\r{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);
}

function stripSchemaMetadata(value) {
  let next = stripSocialShareJunk(String(value || ""));
  for (const pattern of SCHEMA_METADATA_PATTERNS) {
    next = next.replace(pattern, " ");
  }
  next = next
    .replace(/\|\s*\|+/g, "| ")
    .replace(/\b(?:@context|@type)\b\s*:?\s*/gi, " ")
    .replace(/\b(?:json-ld|schema\.org)\b/gi, " ");
  return normalizeWhitespace(next);
}

function looksLikeSchemaMetadata(text) {
  const normalized = normalizeWhitespace(String(text || ""));
  if (!normalized) return false;
  const metadataHits = [
    /\bWebPage\b/i,
    /\bReadAction\b/i,
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    /\ben-US\b/i
  ].filter((pattern) => pattern.test(normalized)).length;
  return metadataHits >= 2;
}

function cleanDescriptionParagraph(paragraph, title = "") {
  const titlePattern = title ? new RegExp(`\\b${slugify(title).replace(/-/g, "[\\s\\W]*")}\\b`, "ig") : null;
  return normalizeWhitespace(
    stripSchemaMetadata(String(paragraph || ""))
      .replace(/[>›»]+/g, " ")
      .replace(/\s*=\s*/g, " ")
      .replace(/&(amp|nbsp|quot|apos|#39|lt|gt);/gi, " ")
      .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
      .replace(/\b(?:next|previous)\b(?:\s*post)?[:\s-]*/gi, " ")
      .replace(/\b(?:apply online|apply now|apply today|submit application|learn more|read more|view job|view opening|back to jobs|search jobs|job openings|applicant login|join talent community)\b/gi, " ")
      .replace(/\b(?:jobs search|green jobs network|climate change jobs|article|articles|news|posted by|logo text)\b/gi, " ")
      .replace(/\b(?:share to|share on)\s+(?:twitter|facebook|linkedin)\b/gi, " ")
      .replace(/\b(?:share this job|email this job|copy link|tweet)\b/gi, " ")
      .replace(/\bnew\b(?=\s+[A-Z][a-z])/g, " ")
      .replace(/\b(?:job title|department|location|reports to|supervises|duration)\s*:\s*/gi, " ")
      .replace(/\b(?:posted|job id|requisition id|req id|employment type|workplace type)\s*:\s*[^.]{0,120}/gi, " ")
      .replace(/\b(?:equal opportunity employer|privacy policy|terms of use|cookie policy|reasonable accommodation|all qualified applicants|veteran status|gender identity)\b[^.]{0,220}/gi, " ")
      .replace(titlePattern || /$^/g, " ")
      .replace(/\.\s*\./g, ". ")
  );
}

function paragraphLooksUseful(paragraph, title = "") {
  const cleaned = cleanDescriptionParagraph(paragraph, title);
  if (cleaned.length < 60) return false;
  if (!/[a-z]{3,}/i.test(cleaned)) return false;
  if (looksLikeSchemaMetadata(cleaned)) return false;
  if (/^(apply|job title|department|location|reports to|supervises|duration)\b/i.test(cleaned)) return false;
  if (/^(previous|next|search jobs|job openings|applicant login|join talent community)\b/i.test(cleaned)) return false;
  if (/^(jobs search|green jobs network|climate change jobs|logo text|article|articles|news)\b/i.test(cleaned)) return false;
  if (!/[.?!]/.test(cleaned) && cleaned.length < 110) return false;
  return true;
}

function isArticleLikeDescription(text) {
  const normalized = normalizeWhitespace(String(text || ""));
  if (!normalized) return false;
  if (/^jobs search\b/i.test(normalized)) return true;
  if (looksLikeSchemaMetadata(normalized)) return true;
  if (/(?:\b\d+[mhdy]\s+ago\b|•\s*remote\s*•)/i.test(normalized) && !/[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners)/i.test(normalized)) {
    return true;
  }
  return false;
}

function findTitleMatchingDescriptionParagraph(job = {}) {
  const title = normalizeWhitespace(job.title || "");
  const comparableTitle = normalizeComparableText(title);
  if (!comparableTitle) return "";

  const titleTokens = comparableTitle
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ORGANIZATION_NOISE_TOKENS.has(token));
  if (!titleTokens.length) return "";

  const sources = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary,
    job.requirements,
    job.responsibilities,
    job.raw_payload
  ];

  let best = { score: 0, paragraph: "" };
  for (const source of sources) {
    const paragraphs = extractParagraphs(source);
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index];
      const cleaned = cleanDescriptionParagraph(paragraph, "");
      if (!paragraphLooksUseful(cleaned, title)) continue;
      const comparableParagraph = normalizeComparableText(cleaned);
      if (!comparableParagraph) continue;
      let score = 0;
      if (comparableParagraph.includes(comparableTitle)) score += 6;
      const tokenMatches = titleTokens.filter((token) => comparableParagraph.includes(token)).length;
      score += tokenMatches;
      if (tokenMatches >= Math.min(3, titleTokens.length)) score += 2;
      const nextParagraph = paragraphs[index + 1] ? cleanDescriptionParagraph(paragraphs[index + 1], title) : "";
      const titleOnlyHeading =
        comparableParagraph === comparableTitle ||
        comparableParagraph.replace(/\bnew\b/g, "").trim() === comparableTitle ||
        comparableParagraph.startsWith(comparableTitle) && comparableParagraph.length <= comparableTitle.length + 50;
      if (titleOnlyHeading && paragraphLooksUseful(nextParagraph, title)) {
        score += 4;
        if (score > best.score) {
          best = { score, paragraph: nextParagraph };
        }
        continue;
      }
      const titleThenBody = cleaned.match(new RegExp(`^${slugify(title).replace(/-/g, "[\\s\\W]*")}(?:\\s+|:|[-–—])+(.+)$`, "i"));
      if (titleThenBody && paragraphLooksUseful(titleThenBody[1], title)) {
        score += 3;
        if (score > best.score) {
          best = { score, paragraph: cleanDescriptionParagraph(titleThenBody[1], title) };
        }
        continue;
      }
      if (score > best.score) {
        best = { score, paragraph: cleaned };
      }
    }
  }

  return best.score >= 4 ? best.paragraph : "";
}

function removeBoilerplateSentences(sentences) {
  const boilerplatePatterns = [
    /equal opportunity/i,
    /all qualified applicants/i,
    /reasonable accommodation/i,
    /e-verify/i,
    /background check/i,
    /drug test/i,
    /unsolicited resumes/i,
    /privacy policy/i,
    /terms of use/i,
    /candidate data/i,
    /employment is contingent/i,
    /veteran status/i,
    /gender identity/i,
    /race, color, religion/i,
    /without regard to/i,
    /apply now/i,
    /click here to apply/i,
    /next post/i,
    /previous post/i,
    /search jobs/i,
    /search results/i,
    /job openings/i,
    /applicant privacy/i,
    /applicant login/i,
    /join talent community/i,
    /employment scams/i,
    /sample employment test/i,
    /our destinies are tied/i,
    /network of \d+ local chapters/i
  ];

  return sentences.filter((sentence) => !boilerplatePatterns.some((pattern) => pattern.test(sentence)));
}

function normalizeSentenceForDedup(sentence) {
  return normalizeComparableText(
    String(sentence || "")
      .replace(/\b(?:the|a|an)\b/gi, " ")
      .replace(/\b(?:job title|department|location|reports to|supervises|duration)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function dedupeDescriptionSentences(sentences) {
  const seen = new Set();
  const deduped = [];
  for (const sentence of sentences) {
    const normalized = normalizeSentenceForDedup(sentence);
    if (!normalized || normalized.length < 20) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(sentence);
  }
  return deduped;
}

function collapseRepeatedPhrases(value) {
  return normalizeWhitespace(String(value || ""))
    .replace(/\b(WebPage|ReadAction)\b(?:[\s,:;-]+\1\b)+/gi, "$1")
    .replace(/\b([A-Za-z][A-Za-z&,'/-]{2,})\b(?:\s+\1\b){1,}/gi, "$1");
}

function normalizeDescription(description, options = {}) {
  const title = normalizeWhitespace(options.title || "");
  const titlePattern = title ? new RegExp(`\\b${slugify(title).replace(/-/g, "[\\s\\W]*")}\\b`, "ig") : null;
  const descriptionInput = normalizeWhitespace(stringifySafe(description) || cleanFlattenedText(description));
  const rawDescription = stripParserTemplateJunk(descriptionInput, "description");
  const cleaned = collapseRepeatedPhrases(normalizeWhitespace(
    stripSchemaMetadata(stripHtml(rawDescription))
      .replace(/[>›»]+/g, " ")
      .replace(/\s*=\s*/g, " ")
      .replace(/&(amp|nbsp|quot|apos|#39|lt|gt);/gi, " ")
      .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
      .replace(/\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:[^.]{0,200}/gi, " ")
      .replace(/\bpost navigation\b[^.]{0,200}/gi, " ")
      .replace(/\b(?:jobs search|green jobs network|climate change jobs|logo text)\b/gi, " ")
      .replace(/\b(?:apply online|apply now|apply today|submit application|learn more|read more|view job|view opening|back to jobs)\b/gi, " ")
      .replace(/\b(?:share to|share on)\s+(?:twitter|facebook|linkedin)\b/gi, " ")
      .replace(/\b(?:share this job|email this job|copy link|tweet)\b/gi, " ")
      .replace(
        /\b(?:job title|department|location|reports to|supervises)\s*:\s*[\s\S]*?(?=(?:job title|department|location|reports to|supervises|duration|context|scope|role overview|about us|what you(?:'|’)ll do)\s*:|$)/gi,
        " "
      )
      .replace(/\b(?:about us|about the company|about the role|job summary|role overview|what you’ll do|what you will do|responsibilities|requirements|qualifications|preferred qualifications|benefits|details|context|scope|what you bring)\s*:?/gi, " ")
      .replace(/\b(?:job title|department|reports to|supervises|duration|location)\s*:/gi, " ")
      .replace(titlePattern || /$^/g, " ")
      .replace(/\.\s*\./g, ". ")
  ));

  if (!cleaned) {
    return {
      raw_description: rawDescription,
      description: ""
    };
  }

  let sentences = splitIntoSentences(cleaned)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length >= 35);

  sentences = dedupeDescriptionSentences(removeBoilerplateSentences(sentences)
    .filter((sentence) => !/^(job title|department|reports to|location|duration)\b/i.test(sentence))
    .filter((sentence) => !/^(apply now|apply today|submit application|learn more|read more|view job|view opening)\b/i.test(sentence))
    .filter((sentence) => !/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(sentence))
    .filter((sentence) => !title || normalizeComparableText(sentence) !== normalizeComparableText(title))
    .filter((sentence) => !/\b(?:webpage|readaction|privacy policy|terms of use|cookie policy|share this job|equal opportunity employer)\b/i.test(sentence))
    .filter((sentence) => !/\b(?:the\s*,\s*market|the,\s*market)\b/i.test(sentence))
    .filter((sentence) => /[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners)/i.test(sentence)));

  const prioritySentences = sentences.filter((sentence) => {
    return /(role|position|responsible|support|manage|lead|coordinate|develop|partner|build|work with|candidate|team|mission|focus|scope)/i.test(sentence);
  });

  const selected = [];
  for (const sentence of [...prioritySentences, ...sentences]) {
    if (selected.includes(sentence)) continue;
    if (selected.some((existing) => normalizeSentenceForDedup(existing) === normalizeSentenceForDedup(sentence))) continue;
    selected.push(sentence);
    if (selected.length === 5) break;
  }

  const finalDescription = collapseRepeatedPhrases(selected.join(" ").trim() || cleaned);

  const dominatedByNoise =
    selected.length === 0 &&
    DESCRIPTION_NOISE_PATTERNS.some((pattern) => pattern.test(rawDescription)) &&
    !/[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners)/i.test(
      cleaned
    );
  const dominatedBySchemaMetadata = looksLikeSchemaMetadata(rawDescription) && !selected.length;

  return {
    raw_description: rawDescription,
    description: dominatedByNoise || dominatedBySchemaMetadata || isArticleLikeDescription(finalDescription) ? "" : finalDescription
  };
}

function extractDescriptionText(job = {}) {
  const parserOptions = buildParserSourceOptions(job);
  const directCandidates = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary
  ];
  const seededParagraph = findTitleMatchingDescriptionParagraph(job);
  let fallbackText = "";

  for (const candidate of directCandidates) {
    const text = stripSchemaMetadata(
      stripParserTemplateJunk(
        stripSocialShareJunk(normalizeWhitespace(stringifySafe(candidate) || cleanFlattenedText(candidate))),
        "description",
        parserOptions
      )
    );
    if (text.length >= 80) {
      fallbackText = text;
      break;
    }
  }

  if (!fallbackText) {
    fallbackText = stripSchemaMetadata(stripParserTemplateJunk(stripSocialShareJunk(cleanFlattenedText({
      description: job.description,
      raw_description: job.raw_description,
      descriptionPlain: job.descriptionPlain,
      content: job.content,
      requirements: job.requirements,
      responsibilities: job.responsibilities,
      lists: job.lists,
      team: job.team,
      department: job.department,
      raw_payload: job.raw_payload
    })), "description", parserOptions));
  }

  if (!seededParagraph) return fallbackText;
  if (!fallbackText) return seededParagraph;

  const comparableSeed = normalizeComparableText(seededParagraph);
  const comparableFallback = normalizeComparableText(fallbackText);
  if (comparableSeed && comparableFallback.includes(comparableSeed)) {
    return fallbackText;
  }

  return `${seededParagraph} ${fallbackText}`.trim();
}

function safeStringField(value, fallback = "") {
  const text = normalizeWhitespace(stringifySafe(value));
  return text || fallback;
}

function truncateTextForStorage(value, maxLength = 16000) {
  const text = stringifySafe(value);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function getJobExclusionReason(input = {}) {
  const organization = safeStringField(input.organization);
  const text = [
    input.title,
    input.description,
    input.raw_description,
    input.descriptionPlain,
    input.content,
    input.summary,
    input.notes,
    input.apply_url,
    input.applyUrl,
    input.source_url,
    input.sourceUrl
  ].filter(Boolean).join(" ").toLowerCase();

  if (CLOSED_JOB_PATTERNS.some((pattern) => pattern.test(text))) {
    return "closed_application";
  }

  const normalizedOrganization = organization.toLowerCase();
  if (BLOCKED_ORGANIZATIONS.some((name) => normalizedOrganization.includes(name))) {
    return "blocked_organization";
  }

  return "";
}

function logExcludedJob(input = {}, reason) {
  const organization = safeStringField(input.organization, "Unknown organization");
  const title = safeStringField(input.title, "Untitled role");
  console.log(`[jobs:normalize] Excluded ${title} @ ${organization} reason=${reason}`);
}

function resolveNumericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeJob(input = {}) {
  const exclusionReason = getJobExclusionReason(input);
  if (exclusionReason) {
    logExcludedJob(input, exclusionReason);
    return null;
  }
  const sourceAttribution = resolveBoardSourceAttribution(input) || null;
  const parserOptions = buildParserSourceOptions({ ...input, ...sourceAttribution });
  const organization = normalizeOrganizationWithOptions(sourceAttribution?.organization || input.organization, parserOptions);
  const attributedTitle = safeStringField(sourceAttribution?.title);
  const title = normalizeTitle(attributedTitle || input.title, organization, { ...parserOptions, organization });
  const applyUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.applyUrl || input.apply_url || input.applyUrl));
  const originalUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.originalUrl || input.original_url || input.originalUrl || applyUrl || input.source_url || input.sourceUrl));
  const sourceUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.sourceUrl || input.source_url || input.sourceUrl));
  const inferredWorkplaceType = normalizeWorkplaceType(input.workplace_type || input.workplaceType) || resolveWorkplaceType(input);
  const location = normalizeLocationDisplay({ ...input, organization }, inferredWorkplaceType);
  const salaryText = extractSalaryText(input);
  const salaryShape = parseSalaryRange(salaryText, location);
  const explicitCurrency = safeStringField(input.salary_currency || input.salaryCurrency);
  const explicitPeriod = safeStringField(input.salary_period || input.salaryPeriod);
  const descriptionCandidate = extractDescriptionText(input);
  const descriptionShape = normalizeDescription(descriptionCandidate, { title });
  if (descriptionCandidate && (
    descriptionShape.raw_description !== normalizeWhitespace(stringifySafe(descriptionCandidate) || cleanFlattenedText(descriptionCandidate)) ||
    (descriptionShape.description && descriptionShape.description !== descriptionShape.raw_description)
  )) {
    incrementParserCleanupStat("description");
  }
  const resolvedSalaryVisible = salaryText
    ? (typeof input.salary_visible === "boolean" ? input.salary_visible : salaryShape.salary_visible)
    : false;
  const datePosted = safeStringField(input.date_posted || input.datePosted);
  const dateAdded = safeStringField(input.date_added || input.dateAdded || datePosted || todayIso());
  const dateUpdated = safeStringField(input.date_updated || input.dateUpdated || datePosted || todayIso());
  const id =
    safeStringField(input.id) ||
    [organization, title, datePosted || todayIso()].map(slugify).filter(Boolean).join("-");

  const tags = ensureArray(input.tags)
    .map((tag) => normalizeWhitespace(stringifySafe(tag)))
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
  const sourceRuleMatch = evaluateSourceTitleRules({
    ...input,
    title,
    organization,
    location
  });
  const invalidTitle = title ? isClearlyNotJobTitle(title, { ...input, organization, location }) : true;
  const rejectRule = sourceRuleMatch?.reason || (invalidTitle ? "semantic_title_rule:invalid_job_title_pattern" : "");
  const rejectReason = rejectRule ? "invalid_job_title_pattern" : "";
  const inheritedTriageBucket = safeStringField(input.triage_bucket || input.triageBucket);
  const inheritedTriageReason = safeStringField(input.triage_reason || input.triageReason);
  const parseWarning = safeStringField(sourceAttribution?.parseWarning || input.parse_warning || input.parseWarning);
  const triageBucket = safeStringField(sourceAttribution?.triageBucket || inheritedTriageBucket);
  const triageReason = safeStringField(sourceAttribution?.triageReason || inheritedTriageReason);

  return {
    id,
    ref: safeStringField(input.ref),
    external_id: safeStringField(input.external_id || input.externalId),
    source_id: safeStringField(input.source_id || input.sourceId),
    source_type: safeStringField(input.source_type || input.sourceType),
    title,
    organization,
    location,
    workplace_type: inferredWorkplaceType || resolveWorkplaceType({ ...input, location }),
    job_type: resolveEmploymentType(input),
    salary: resolvedSalaryVisible ? salaryShape.salary : "",
    raw_salary: salaryShape.raw_salary,
    salary_min: resolveNumericField(input.salary_min) ?? salaryShape.salary_min,
    salary_max: resolveNumericField(input.salary_max) ?? salaryShape.salary_max,
    salary_currency: VALID_CURRENCIES.has(explicitCurrency) ? explicitCurrency : salaryShape.salary_currency,
    salary_period: VALID_PERIODS.has(explicitPeriod) ? explicitPeriod : salaryShape.salary_period,
    salary_visible: resolvedSalaryVisible,
    featured: Boolean(input.featured),
    sector: normalizeSector(input.sector || "general"),
    function: safeStringField(input.function || input.role_function),
    specialization: normalizeSpecialization(input.specialization || input.display?.specialization, input),
    experience: safeStringField(input.experience),
    source: normalizeSourceNameWithOptions(sourceAttribution?.sourceName || input.source, parserOptions) || "Manual",
    source_url: sourceUrl,
    apply_url: applyUrl,
    original_url: originalUrl,
    date_posted: isValidDate(datePosted) ? new Date(datePosted).toISOString().slice(0, 10) : todayIso(),
    date_added: isValidDate(dateAdded) ? new Date(dateAdded).toISOString().slice(0, 10) : todayIso(),
    date_updated: isValidDate(dateUpdated) ? new Date(dateUpdated).toISOString().slice(0, 10) : todayIso(),
    status: safeStringField(input.status, "active").toLowerCase(),
    approved_by: safeStringField(input.approved_by || input.approvedBy),
    raw_description: descriptionShape.raw_description,
    description: descriptionShape.description,
    tags,
    shared_by: safeStringField(input.shared_by || input.sharedBy),
    notes: safeStringField(input.notes),
    review_reason: safeStringField(input.review_reason || input.reviewReason),
    triage_bucket: triageBucket,
    triage_reason: triageReason,
    parse_warning: parseWarning,
    _reject_reason: rejectReason,
    _quality: rejectReason
      ? {
          validTitle: false,
          reason: "invalid_job_title_pattern",
          rule: rejectRule
        }
      : {
          validTitle: Boolean(title)
        },
    confidence: safeStringField(input.confidence).toLowerCase(),
    relevance_score: resolveNumericField(input.relevance_score ?? input.relevanceScore),
    relevance_reasons: ensureArray(input.relevance_reasons || input.relevanceReasons)
      .map((reason) => normalizeWhitespace(stringifySafe(reason)))
      .filter(Boolean),
    trusted: typeof input.trusted === "boolean" ? input.trusted : undefined,
    auto_publish: typeof input.auto_publish === "boolean" ? input.auto_publish : undefined,
    sync_origin: safeStringField(input.sync_origin)
  };
}

function normalizeSector(value) {
  const text = normalizeWhitespace(stringifySafe(value));
  const lower = text.toLowerCase();
  if (!lower) return "";
  if (/clean energy|electrification|renewable/i.test(lower)) return "Clean Energy";
  if (/climate tech|climate software|carbon software/i.test(lower)) return "Climate Tech";
  if (/policy|advocacy|campaign/i.test(lower)) return "Policy/Advocacy";
  if (/conservation|nature|oceans|biodiversity/i.test(lower)) return "Conservation";
  if (/sustainability/i.test(lower)) return "Sustainability";
  if (/communications|storytelling|brand/i.test(lower)) return "Climate Communications";
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSpecialization(value, job = {}) {
  const explicit = normalizeWhitespace(stringifySafe(value));
  if (explicit) {
    const matchedExplicit = SPECIALIZATION_RULES.find((rule) => rule.pattern.test(explicit));
    if (matchedExplicit) return matchedExplicit.label;
    return explicit;
  }

  const text = normalizeWhitespace([
    job.title,
    job.function,
    job.description,
    job.raw_description,
    Array.isArray(job.tags) ? job.tags.join(" ") : job.tags,
    job.notes
  ].filter(Boolean).join(" "));
  if (!text) return "";

  const matchedRule = SPECIALIZATION_RULES.find((rule) => rule.pattern.test(text));
  return matchedRule ? matchedRule.label : "";
}

function buildDedupeKey(job) {
  const normalized = normalizeJob(job);
  if (!normalized) return "";
  if (normalized.external_id) {
    return `external::${normalized.external_id.toLowerCase()}`;
  }
  if (normalized.apply_url) {
    return `apply::${normalized.apply_url.toLowerCase()}`;
  }
  return `identity::${normalized.source.toLowerCase()}::${normalized.title.toLowerCase()}::${normalized.organization.toLowerCase()}`;
}

function likelyNearDuplicate(existing, candidate) {
  const sameTitle = existing.title.toLowerCase() === candidate.title.toLowerCase();
  const sameOrg = existing.organization.toLowerCase() === candidate.organization.toLowerCase();
  if (!sameTitle || !sameOrg) return false;

  const existingDate = Date.parse(existing.date_posted || existing.date_updated || existing.date_added) || 0;
  const candidateDate = Date.parse(candidate.date_posted || candidate.date_updated || candidate.date_added) || 0;
  const dayDelta = Math.abs(candidateDate - existingDate) / (1000 * 60 * 60 * 24);
  return dayDelta <= 3;
}

function dedupeJobs(jobs) {
  const seen = new Map();
  const identitySeen = new Map();

  for (const rawJob of jobs) {
    const job = normalizeJob(rawJob);
    if (!job) continue;
    const key = buildDedupeKey(job);
    if (!key) continue;
    const existing = seen.get(key);
    const identityKey = `${job.title.toLowerCase()}::${job.organization.toLowerCase()}`;
    const identityExistingKey = identitySeen.get(identityKey);
    const nearDuplicate = identityExistingKey ? seen.get(identityExistingKey) : null;

    if (!existing) {
      if (nearDuplicate && likelyNearDuplicate(nearDuplicate, job)) {
        const existingTime = Date.parse(nearDuplicate.date_updated || nearDuplicate.date_posted) || 0;
        const jobTime = Date.parse(job.date_updated || job.date_posted) || 0;
        const merged = {
          ...nearDuplicate,
          ...job,
          tags: Array.from(new Set([...(nearDuplicate.tags || []), ...(job.tags || [])])).filter(Boolean)
        };
        seen.set(identityExistingKey, jobTime >= existingTime ? merged : { ...job, ...nearDuplicate, tags: merged.tags });
        continue;
      }
      seen.set(key, job);
      identitySeen.set(identityKey, key);
      continue;
    }

    const existingTime = Date.parse(existing.date_updated || existing.date_posted) || 0;
    const jobTime = Date.parse(job.date_updated || job.date_posted) || 0;
    const merged = {
      ...existing,
      ...job,
      tags: Array.from(new Set([...(existing.tags || []), ...(job.tags || [])])).filter(Boolean)
    };

    seen.set(key, jobTime >= existingTime ? merged : { ...job, ...existing, tags: merged.tags });
    identitySeen.set(identityKey, key);
  }

  return Array.from(seen.values()).sort((a, b) => Date.parse(b.date_posted) - Date.parse(a.date_posted));
}

function routeSyncedJob(job, source) {
  const routed = normalizeJob({
    ...job,
    source_id: source.id,
    source_type: source.type,
    trusted: Boolean(source.trusted),
    auto_publish: Boolean(source.auto_publish),
    sync_origin: job.sync_origin || "ats"
  });
  if (!routed) return null;

  if (source.trusted === true && source.auto_publish === true) {
    return normalizeJob({ ...routed, status: "active" });
  }

  return normalizeJob({ ...routed, status: "pending" });
}

module.exports = {
  cleanCustomCareerPageText,
  cleanFlattenedText,
  cleanElementalImpactText,
  cleanLocationText,
  decodeHtmlEntities,
  dedupeJobs,
  detectSalaryCurrency,
  detectSalaryPeriod,
  ensureArray,
  extractDescriptionText,
  extractSalaryText,
  flattenTextValues,
  hasExplicitHybridSignal,
  hasExplicitRemoteSignal,
  isSocialShareUrl,
  isGenericRoleTitle,
  isValidDate,
  getJobExclusionReason,
  getParserCleanupStats,
  hasRoleSignal,
  isClearlyNotJobTitle,
  isLocationOnlyTitle,
  isOrganizationOnlyTitle,
  isSingleFirstNameOnlyTitle,
  looksLikePhysicalLocation,
  normalizeDescription,
  normalizeEmploymentType,
  normalizeJob,
  normalizeLocationDisplay,
  normalizeSpecialization,
  normalizeWorkplaceType,
  resolveEmploymentType,
  resolveWorkplaceType,
  normalizeSector,
  normalizeOrganization,
  parseSalaryRange,
  resetParserCleanupStats,
  routeSyncedJob,
  slugify,
  stableHash,
  stringifySafe,
  truncateTextForStorage,
  stripHtml,
  stripSocialShareJunk,
  todayIso
};
