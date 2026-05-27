const crypto = require("crypto");
const {
  evaluateSourceTitleRules,
  resolveBoardSourceAttribution
} = require("./source-rules");
const {
  inferSourceClassification,
  inferSourceConfidenceTier
} = require("./source-utils");

const VALID_CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP", "Unknown"]);
const VALID_PERIODS = new Set(["hour", "day", "week", "month", "year", "Unknown"]);
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

const CANONICAL_SPECIALIZATIONS = [
  "Digital",
  "PR / Press",
  "Communications",
  "Policy",
  "Social Media",
  "Content",
  "Video",
  "Art / Creative",
  "Design",
  "Product",
  "Strategy",
  "Engineering",
  "Web",
  "Operations",
  "Programs",
  "Admin",
  "Sales",
  "Data",
  "Research",
  "Campaigns"
];

const SPECIALIZATION_RULES = [
  { label: "PR / Press", pattern: /\b(?:pr|public relations|press|press secretary|media relations|press officer|press manager|press lead)\b/i },
  { label: "Policy", pattern: /\b(?:policy|public affairs|government affairs|external affairs|regulatory affairs|advocacy)\b/i },
  { label: "Communications", pattern: /\b(?:communications|communication|comms|internal communications|external communications)\b/i },
  { label: "Video", pattern: /\b(?:video|videographer|video editor|video producer|multimedia producer|motion designer|motion graphics|youtube|documentary|short-form video|short form video|digital video|social video|creative producer|content producer|film producer|creator lead|creator network|vertical video|digital producer)\b/i },
  { label: "Social Media", pattern: /\b(?:social media|social strategy|community manager|community lead|tiktok|instagram|linkedin content|bluesky|rapid response clips)\b/i },
  { label: "Content", pattern: /\b(?:content|editorial|copywriter|copywriting|storytelling|writer|newsletter|content design)\b/i },
  { label: "Art / Creative", pattern: /\b(?:creative|art director|artistic|illustration|visual storytelling|brand studio)\b/i },
  { label: "Design", pattern: /\b(?:design|designer|graphic design|visual design|product design|ux|ui)\b/i },
  { label: "Product", pattern: /\b(?:product manager|product owner|product lead|product strategy)\b/i },
  { label: "Strategy", pattern: /\b(?:strategy|strategist|strategic|planning|planning director)\b/i },
  { label: "Engineering", pattern: /\b(?:firmware|platform engineer|software engineer|engineer|engineering|developer|backend|back-end|frontend|front-end|full stack|full-stack|devops|sre|site reliability|technical architect)\b/i },
  { label: "Web", pattern: /\b(?:web|website|webmaster|wordpress)\b/i },
  { label: "Operations", pattern: /\b(?:operations|operator|operations coordinator|operations specialist|supervisor|scada|field operations|customer operations|mobilization|implementation|logistics|supply chain)\b/i },
  { label: "Programs", pattern: /\b(?:program manager|programme manager|program director|program coordinator|program lead)\b/i },
  { label: "Admin", pattern: /\b(?:executive assistant|administrative assistant|admin|administrator|office manager)\b/i },
  { label: "Sales", pattern: /\b(?:sales|account executive|account manager|business development|partnerships|customer success|consultant|revenue)\b/i },
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
const DESCRIPTION_JUNK_PATTERNS = [
  /\bprevious\b/i,
  /\bnext post\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i,
  /<span\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bcareer_page\b/i,
  /\bBusiness\/Productivity Software\b/i,
  /\bCleantech\b/i,
  /\bOil\s*&\s*Gas\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
];
const BAD_PUBLIC_CONTENT_PATTERNS = [
  /^\s*[\[{].*(?:"@context"|jobs?|items?|feed|rss|xml)/i,
  /<\?xml\b/i,
  /<rss\b/i,
  /<feed\b/i,
  /<svg\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i,
  /\bprevious\b/i,
  /\bnext post\b/i,
  /\bsee current openings\b/i,
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bcareer_page\b/i,
  /\bgeo(?:code)?\b/i
];
const DESCRIPTION_REJECT_PREFIX_PATTERNS = [
  /^[)\]}>,.;:!?/\\|%+-]+\s*/,
  /^(?:[-*•]\s*|#+\s+)/,
  /^\d{1,3}%\)?\s+/,
  /^(?:check out our website|learn more|click here|read more|view job|view opening|apply now|apply today|we strongly encourage candidates)\b/i,
  /^(?:previous|next|post navigation|share this job|back to jobs|see all openings|search jobs|job title|department|location|reports to|supervises)\b/i,
  /^(?:<svg|<path|<div|<\/|https?:\/\/|job categories|career_page|taxonomy|work type|employment type)\b/i,
  /^(?:\[\]|\(\)|\[\w+\]\([^)]+\)|www\.)/i
];
const INVALID_PUBLIC_LOCATION_PATTERNS = [
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bgeo(?:code)?\b/i,
  /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i
];
const WORKABLE_HUMAN_APPLY_PATTERNS = [
  /^https?:\/\/apply\.workable\.com\/[^/]+\/j\/[A-Z0-9]+\/?(?:[?#].*)?$/i,
  /^https?:\/\/jobs\.workable\.com\/view\//i
];
const MALFORMED_DESCRIPTION_TEMPLATE_PATTERNS = [
  /\bThe\s+will\b/i,
  /\bThe\s+is\b/i,
  /\bThe\s+are\b/i,
  /\bThe\s*,/i,
  /\bThe\s*\./i,
  /\bThe&nbsp;will\b/i,
  /\bThe\s*<\//i
];
const MONTH_NAME_PATTERN =
  /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/gi;
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
  "cribl",
  "stackblitz",
  "teramind",
  "marcus millichap",
  "marcus & millichap",
  "dataiku",
  "spring health",
  "plos"
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
  html_fragment_stripped: 0,
  salary_invalid_removed: 0,
  salary_display_built_from_range: 0,
  salary_parse_warning: 0,
  workplace_type_cleaned: 0,
  workplace_type_invalid_removed: 0,
  workplace_type_field_misplacement_repaired: 0,
  elemental_impact_routed_pending: 0,
  low_confidence_title: 0
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
  PARSER_CLEANUP_STATS.salary_invalid_removed = 0;
  PARSER_CLEANUP_STATS.salary_display_built_from_range = 0;
  PARSER_CLEANUP_STATS.salary_parse_warning = 0;
  PARSER_CLEANUP_STATS.workplace_type_cleaned = 0;
  PARSER_CLEANUP_STATS.workplace_type_invalid_removed = 0;
  PARSER_CLEANUP_STATS.workplace_type_field_misplacement_repaired = 0;
  PARSER_CLEANUP_STATS.elemental_impact_routed_pending = 0;
  PARSER_CLEANUP_STATS.low_confidence_title = 0;
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
    parser_html_fragment_stripped_count: PARSER_CLEANUP_STATS.html_fragment_stripped,
    salary_invalid_removed_count: PARSER_CLEANUP_STATS.salary_invalid_removed,
    salary_display_built_from_range_count: PARSER_CLEANUP_STATS.salary_display_built_from_range,
    salary_parse_warning_count: PARSER_CLEANUP_STATS.salary_parse_warning,
    workplace_type_cleaned_count: PARSER_CLEANUP_STATS.workplace_type_cleaned,
    workplace_type_invalid_removed_count: PARSER_CLEANUP_STATS.workplace_type_invalid_removed,
    workplace_type_field_misplacement_repaired_count: PARSER_CLEANUP_STATS.workplace_type_field_misplacement_repaired,
    elemental_impact_routed_pending_count: PARSER_CLEANUP_STATS.elemental_impact_routed_pending,
    low_confidence_title_count: PARSER_CLEANUP_STATS.low_confidence_title
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
  if (field === "salary_invalid_removed") PARSER_CLEANUP_STATS.salary_invalid_removed += 1;
  if (field === "salary_display_built_from_range") PARSER_CLEANUP_STATS.salary_display_built_from_range += 1;
  if (field === "salary_parse_warning") PARSER_CLEANUP_STATS.salary_parse_warning += 1;
  if (field === "workplace_type_cleaned") PARSER_CLEANUP_STATS.workplace_type_cleaned += 1;
  if (field === "workplace_type_invalid_removed") PARSER_CLEANUP_STATS.workplace_type_invalid_removed += 1;
  if (field === "workplace_type_field_misplacement_repaired") PARSER_CLEANUP_STATS.workplace_type_field_misplacement_repaired += 1;
  if (field === "elemental_impact_routed_pending") PARSER_CLEANUP_STATS.elemental_impact_routed_pending += 1;
  if (field === "low_confidence_title") PARSER_CLEANUP_STATS.low_confidence_title += 1;
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

function normalizePaylocityUrl(value) {
  const original = normalizeWhitespace(String(value || ""));
  if (!original) {
    return {
      url: "",
      normalized: false,
      original_url: "",
      canonical_url: ""
    };
  }
  let parsed;
  try {
    parsed = new URL(original);
  } catch (_error) {
    return {
      url: original,
      normalized: false,
      original_url: "",
      canonical_url: ""
    };
  }
  const isPaylocity = /(^|\.)recruiting\.paylocity\.com$/i.test(parsed.hostname);
  const applyMatch = parsed.pathname.match(/^\/Recruiting\/Jobs\/Apply\/(\d+)(?:\/)?$/i);
  if (!isPaylocity || !applyMatch) {
    return {
      url: original,
      normalized: false,
      original_url: "",
      canonical_url: ""
    };
  }
  parsed.pathname = `/Recruiting/Jobs/Details/${applyMatch[1]}`;
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (!["lang", "locale"].includes(String(key || "").toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  const canonical = parsed.toString();
  return {
    url: canonical,
    normalized: canonical !== original,
    original_url: original,
    canonical_url: canonical
  };
}

function normalizeWorkableUrl(value) {
  const original = normalizeWhitespace(String(value || ""));
  if (!original) {
    return {
      url: "",
      normalized: false,
      original_url: "",
      canonical_url: ""
    };
  }

  const brokenMatch = original.match(
    /^https?:\/\/apply\.workable\.com\/([^/]+)\/jobs\/view\/([A-Z0-9]+)\/?(?:[?#].*)?$/i
  );
  if (!brokenMatch) {
    return {
      url: original,
      normalized: false,
      original_url: "",
      canonical_url: ""
    };
  }

  const canonical = `https://apply.workable.com/${brokenMatch[1]}/j/${brokenMatch[2]}/`;
  return {
    url: canonical,
    normalized: canonical !== original,
    original_url: original,
    canonical_url: canonical
  };
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
  if (/(?:\$|£|€|usd|cad|eur|gbp|\b\d{2,3}(?:,\d{3})*(?:\.\d+)?\b.*(?:hour|hr|year|month|salary|pay|compensation))/i.test(text)) {
    incrementParserCleanupStat("workplace_type_field_misplacement_repaired");
    return fallback;
  }
  if (
    looksLikePhysicalLocation(text) &&
    !/\b(?:remote|hybrid|onsite|on site|remote first|remote eligible|work from home|wfh|in office|office based)\b/i.test(normalized)
  ) {
    incrementParserCleanupStat("workplace_type_field_misplacement_repaired");
    return fallback;
  }

  if (/\bhybrid\b/.test(normalized)) {
    if (text !== "Hybrid") incrementParserCleanupStat("workplace_type_cleaned");
    return "Hybrid";
  }
  if (/\bonsite\b|\bon site\b|\bin office\b|\boffice based\b/.test(normalized)) {
    if (text !== "On-site") incrementParserCleanupStat("workplace_type_cleaned");
    return "On-site";
  }
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(normalized)) {
    if (text !== "Remote") incrementParserCleanupStat("workplace_type_cleaned");
    return "Remote";
  }
  incrementParserCleanupStat("workplace_type_invalid_removed");
  return fallback;
}

function normalizeEmploymentType(value, fallback = "") {
  const text = normalizeWhitespace(stringifySafe(value));
  const normalized = normalizeLooseToken(text);
  if (!normalized) return fallback;
  if (/^[—–-]+$/.test(normalized)) return fallback;
  if (/\bcontract(?:or)?\b/.test(normalized)) return "Contract";
  if (/\btemporary\b|\btemp\b/.test(normalized)) return "Temporary";
  if (/\bintern(?:ship)?\b/.test(normalized)) return "Internship";
  if (/\bfellow(?:ship)?\b/.test(normalized)) return "Fellowship";
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

function mergeWarnings(...warningSets) {
  return Array.from(
    new Set(
      warningSets
        .flat()
        .map((warning) => normalizeWhitespace(String(warning || "")))
        .filter(Boolean)
    )
  );
}

function titleCaseWorkplace(value) {
  const normalized = normalizeLooseToken(value);
  if (!normalized) return "";
  if (normalized.includes("remote")) return "Remote";
  if (normalized.includes("hybrid")) return "Hybrid";
  if (normalized.includes("on site") || normalized.includes("onsite")) return "On-site";
  return "";
}

function looksLikeLocationSuffix(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  if (/^(?:remote|hybrid|on[\s-]?site|anywhere|global|worldwide|multiple locations)$/i.test(text)) return true;
  if (/^[A-Z][A-Za-z.' -]+,\s*[A-Z]{2,3}(?:\s+(?:Remote|Hybrid|On-site))?$/i.test(text)) return true;
  if (/^[A-Z][A-Za-z.' -]+,\s*(?:United States|USA|Canada|UK|United Kingdom|Germany|France|Italy|Spain|Portugal|Netherlands|Ireland|Australia)$/i.test(text)) return true;
  if (/^(?:new york|london|berlin|paris|madrid|dublin|chicago|remote within [a-z ]+|us - multiple locations)$/i.test(text)) return true;
  return false;
}

function stripWorkplaceLocationSuffixFromTitle(value) {
  const original = normalizeWhitespace(String(value || ""));
  let text = original;
  let workplaceType = "";
  let location = "";
  const warnings = [];
  if (!text) return { title: "", workplaceType, location, warnings };

  const parenMatch = text.match(/\s*\((Remote|Hybrid|On[\s-]?site)\)\s*$/i);
  if (parenMatch) {
    workplaceType = titleCaseWorkplace(parenMatch[1]);
    text = normalizeWhitespace(text.replace(/\s*\((Remote|Hybrid|On[\s-]?site)\)\s*$/i, ""));
    warnings.push("title_workplace_suffix_stripped");
  }

  const separatorMatch = text.match(/^(.*?)(?:\s+[—–-]\s+)([^—–-]+)$/);
  if (separatorMatch) {
    const left = normalizeWhitespace(separatorMatch[1]);
    const right = normalizeWhitespace(separatorMatch[2]);
    const rightWorkplace = titleCaseWorkplace(right);
    if (rightWorkplace) {
      workplaceType = workplaceType || rightWorkplace;
      text = left;
      warnings.push("title_workplace_suffix_stripped");
    } else if (looksLikeLocationSuffix(right)) {
      text = left;
      warnings.push("title_location_suffix_stripped");
      if (!rightWorkplace) {
        const rightWorkplaceToken = right.match(/\b(Remote|Hybrid|On[\s-]?site)\b/i);
        if (rightWorkplaceToken) workplaceType = workplaceType || titleCaseWorkplace(rightWorkplaceToken[1]);
      }
      location = normalizeWhitespace(right.replace(/\b(Remote|Hybrid|On[\s-]?site)\b/gi, " "));
    }
  }

  const trailingMatch = text.match(/^(.*?)(?:\s+)(Remote|Hybrid|On[\s-]?site)$/i);
  if (trailingMatch) {
    const left = normalizeWhitespace(trailingMatch[1]);
    if (left.split(/\s+/).filter(Boolean).length >= 1) {
      workplaceType = workplaceType || titleCaseWorkplace(trailingMatch[2]);
      text = left;
      warnings.push("title_workplace_suffix_stripped");
    }
  }

  const combinedLocationMatch = text.match(/^(.*?)(?:\s+[—–-]\s+)([A-Z][^,]{1,40},\s*[A-Z]{2,3})\s+(Remote|Hybrid|On[\s-]?site)$/i);
  if (combinedLocationMatch) {
    text = normalizeWhitespace(combinedLocationMatch[1]);
    location = location || normalizeWhitespace(combinedLocationMatch[2]);
    workplaceType = workplaceType || titleCaseWorkplace(combinedLocationMatch[3]);
    warnings.push("title_location_suffix_stripped");
    warnings.push("title_workplace_suffix_stripped");
  }

  return {
    title: normalizeWhitespace(text),
    workplaceType,
    location,
    warnings
  };
}

function hasSentenceLikeVerbPattern(value) {
  return /\b(?:can|will|would|should|could|starting|read|learn|work|build|share|pivoting|explains|announces|joined|starting with|interview|impact|stands on|learn from)\b/i.test(
    String(value || "")
  );
}

function looksLikeHeadlineContamination(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  if (/[!?]/.test(text) || /[A-Za-z]{3,}\.\s+[A-Z]/.test(text) || /\.\.\./.test(text)) return true;
  if (/[“”"']/.test(text) && text.split(/\s+/).length > 8) return true;
  if (/\b(?:linkedins?|article|interview|career questions|share their stories|click here|read my interview|want a .* career)\b/i.test(text)) return true;
  if (hasSentenceLikeVerbPattern(text) && text.split(/\s+/).length > 8) return true;
  return false;
}

function looksLikeConcatenatedTitle(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  if (/<div|href=|class=|aria-label=|https?:\/\//i.test(text)) return true;
  if (/(?:Current Openings|Open Positions)/i.test(text)) return true;
  if (countRegexMatches(text, /\b(?:Remote|Hybrid|On-site|Onsite)\b/gi) >= 2) return true;
  if (countRegexMatches(text, /(?:[—–-]|,)\s*[A-Z][A-Za-z.' -]+,\s*[A-Z]{2,3}/g) >= 2) return true;
  if (text.split(/\s+/).filter(Boolean).length > 14) return true;
  return false;
}

function assessTitleQuality(value, options = {}) {
  const text = normalizeWhitespace(String(value || ""));
  const warnings = [];
  if (!text) {
    return { confidence: "low", warnings: ["missing_title"] };
  }
  if (looksLikeHeadlineContamination(text)) warnings.push("headline_like_title");
  if (looksLikeConcatenatedTitle(text)) warnings.push("concatenated_title");
  if (/\b(?:Remote|Hybrid|On-site|Onsite)\b$/.test(text)) warnings.push("workplace_suffix_in_title");
  if (/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\b/i.test(text)) {
    warnings.push("date_fragment_in_title");
  }
  if (text.split(/\s+/).filter(Boolean).length > 10) warnings.push("long_title");
  if (/^(?:current openings|open positions|jobs?)$/i.test(text)) warnings.push("navigation_title");

  if (warnings.some((warning) => ["headline_like_title", "concatenated_title", "navigation_title"].includes(warning))) {
    return { confidence: "low", warnings };
  }
  if (warnings.length) return { confidence: "medium", warnings };
  if (!hasRoleSignal(text)) return { confidence: "low", warnings: mergeWarnings(warnings, "missing_role_signal") };
  return { confidence: "high", warnings };
}

function hasDescriptionVerbSignal(value) {
  return /[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|optimizes)\b/i.test(
    String(value || "")
  );
}

function countRegexMatches(value, pattern) {
  const text = String(value || "");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return Array.from(text.matchAll(globalPattern)).length;
}

function isCompanyOnlyDescription(value, options = {}) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  const comparableText = normalizeComparableText(text);
  const comparableTitle = normalizeComparableText(options.title || "");
  const comparableOrganization = normalizeComparableText(options.organization || "");
  const shortWordCount = text.split(/\s+/).filter(Boolean).length;
  if (comparableText && (comparableText === comparableTitle || comparableText === comparableOrganization)) {
    return true;
  }
  if (
    shortWordCount <= 12 &&
    comparableOrganization &&
    comparableText.startsWith(comparableOrganization) &&
    !hasDescriptionVerbSignal(text)
  ) {
    return true;
  }
  return false;
}

function isRepeatedDateDescription(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  const matches = Array.from(text.matchAll(new RegExp(MONTH_NAME_PATTERN.source, MONTH_NAME_PATTERN.flags.includes("g") ? MONTH_NAME_PATTERN.flags : `${MONTH_NAME_PATTERN.flags}g`)))
    .map((match) => normalizeWhitespace(match[0]));
  const dateMatches = matches.length;
  if (dateMatches < 3) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const duplicateDateCounts = new Map();
  for (const match of matches) {
    duplicateDateCounts.set(match, (duplicateDateCounts.get(match) || 0) + 1);
  }
  const maxDuplicateCount = Math.max(...Array.from(duplicateDateCounts.values()), 0);
  return wordCount > 0 && (dateMatches >= 8 || (dateMatches * 4) >= wordCount || maxDuplicateCount >= 3);
}

function isMostlyMetadataDescription(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  const metadataHits = [
    /\b(?:remote|hybrid|on-site|onsite)\b/gi,
    /\b(?:united states|usa|us|canada|uk|europe)\b/gi,
    /\b(?:tailwind css|node\.?\s*js|restful api|single page application|serverless computing|business intelligence|data science)\b/gi,
    /\b(?:renewables? & environment|solar power|wind power|sustainability technology|security)\b/gi,
    /\b(?:career_page|point\s*\(|locality|title business(?: platform location date)?)\b/gi
  ].reduce((sum, pattern) => sum + countRegexMatches(text, pattern), 0);
  return metadataHits >= 4 && !hasDescriptionVerbSignal(text);
}

function dedupeTitleMentions(value, title = "") {
  const text = normalizeWhitespace(String(value || ""));
  const normalizedTitle = normalizeWhitespace(title);
  if (!text || !normalizedTitle) return text;
  const titlePattern = escapeRegExp(normalizedTitle).replace(/\s+/g, "\\s+");
  return normalizeWhitespace(
    text
      .replace(new RegExp(`^(?:${titlePattern}\\s*){2,}`, "i"), `${normalizedTitle} `)
      .replace(new RegExp(`(${titlePattern})(?:\\s*[|:–—-]?\\s*\\1)+`, "ig"), "$1")
  );
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
        .replace(/\b\d*\/svg\b/gi, " ")
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
    .replace(/\blocality\b/gi, " ")
    .replace(/\b(?:latitude|longitude|geocode|geocoded?|continent|county|administrative area level \d+)\b[^.]{0,160}/gi, " ")
    .replace(/\b\d{7,10}\s*-\s*(?=senior|staff|principal|lead|junior|manager|director)\b/gi, " ")
    .replace(/\b(?:Business\/Productivity Software|Cleantech|Oil\s*&\s*Gas|Renewable Energy|funding|revenue|valuation|headquarters|employee count|employee size|series [a-z]|venture[- ]backed|saas|productivity software)\b[^.]{0,240}/gi, " ")
    .replace(/\b\d{7,10}\b(?=\s*(?:[|,;:]|senior|staff|principal|lead|manager|director))/gi, " ");

  next = next
    .replace(/\b(?:other|ipo)\s+\d+\b/gi, " ")
    .replace(/\bcareer_page\b/gi, " ")
    .replace(/\b(?:on_site|remote_only|hybrid_only)\b/gi, " ")
    .replace(/\b(?:north america|united states)\b/gi, " ");

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
    .replace(/\be"\s*"*\s*(?:headers?)?(?:\s*"*)+/gi, " ")
    .replace(/\bheaders?\b(?=\s*(?:"\s*){1,6}(?:Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Jan|Feb|Mar))/gi, " ");

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

function extractLikelyLocationPhrase(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return "";

  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2},\s*(?:[A-Z]{2,3}|[A-Z][A-Za-z.' -]+)(?:,\s*(?:USA|United States|Canada|UK|United Kingdom))?(?:\s*(?:or|\/|, or|,)\s*(?:Remote|[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2},\s*(?:[A-Z]{2,3}|[A-Z][A-Za-z.' -]+)(?:,\s*(?:USA|United States|Canada|UK|United Kingdom))?))*)/g,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}\s*\([A-Z]{2,3}\))/g
  ];

  const matches = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = normalizeWhitespace(match[1] || match[0] || "");
      if (candidate) matches.push(candidate);
    }
  }

  return matches.length ? normalizeWhitespace(matches[matches.length - 1]) : "";
}

function stripLeadingMetadataBlob(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return "";

  const readableStarts = [
    /\b(?:we|you|your|our)\b/i,
    /\b(?:this role|this position|the role|the position|the ideal candidate|the successful candidate|in this role|as a)\b/i,
    /\b(?:is seeking|is hiring|is looking for|seeks|seeking|looking for)\b/i,
    /\b(?:will|can|should|must|supports|manages|develops|leads|coordinates|builds|partners|drives|provides|helps|ensures)\b/i
  ];
  const metadataSignals = /\b(?:career_page|other \d+|ipo \d+|point\s*\(|locality\b|north america|venture-backed|revenue|valuation|headquarters|employee size|renewables? & environment|oil\s*&\s*gas|business\/productivity software)\b/i;

  let startIndex = -1;
  for (const pattern of readableStarts) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (startIndex === -1 || match.index < startIndex) {
      startIndex = match.index;
    }
  }

  if (startIndex > 40) {
    return normalizeWhitespace(text.slice(startIndex));
  }

  if (metadataSignals.test(text)) {
    const boundary = text.search(/[.!?]\s+/);
    if (boundary > 0 && boundary < text.length - 2) {
      const remainder = normalizeWhitespace(text.slice(boundary + 1));
      if (
        remainder &&
        /[A-Za-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|provides|helps|ensures)\b/i.test(remainder)
      ) {
        return remainder;
      }
    }
  }

  return text;
}

function stripStandaloneMetadataNumbers(value) {
  return String(value || "").replace(/\b(\d{3,})\b/g, (match, digits, offset, full) => {
    const numeric = Number(digits);
    if (digits.length === 4 && numeric >= 1900 && numeric <= 2100) return match;
    const context = full.slice(Math.max(0, offset - 18), Math.min(full.length, offset + digits.length + 18));
    if (/(?:\$|£|€|USD|CAD|EUR|GBP|salary|pay|compensation|range|per hour|per day|per month|per year)/i.test(context)) return match;
    if (/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|:\d{2})/i.test(context)) return match;
    if (/(?:zip|postal|postcode|suite|apt|avenue|ave|street|st\.|road|rd\.|boulevard|blvd)/i.test(context)) return match;
    return " ";
  });
}

function collapseRepeatedPipeSegments(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text.includes("|")) return text;
  const segments = text.split("|").map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (segments.length < 2) return text;
  const deduped = [];
  const seen = new Set();
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }
  return deduped.join(" | ");
}

function stripParserTemplateJunk(value, field = "text", options = {}) {
  let text = normalizeWhitespace(stripSocialShareJunk(stripHtml(decodeHtmlEntities(value))));
  if (!text) return "";

  text = stripHtmlFragmentNoise(text);
  text = text
    .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/\b(?:hdrDate|hdrTitle|hdr[A-Za-z]+)\b/gi, " ")
    .replace(/\be\s*(?:(?:"|&quot;)\s*)?nowrap\b/gi, " ")
    .replace(/\bheaders?\b(?:\s+(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4})?/gi, " ")
    .replace(/\b(?:previous|next)\s*post\b[:\s-]*/gi, " ")
    .replace(/\b(?:previous|next)\b(?=\s*(?:post\b|$))/gi, " ")
    .replace(/\brelated posts?\b[:\s-]*/gi, " ")
    .replace(/\bpost navigation\b[:\s-]*/gi, " ")
    .replace(/\bposted by\b[:\s-]*[^|•·]{0,80}/gi, " ")
    .replace(/\bsee (?:new|current) openings\b/gi, " ")
    .replace(/\b(?:share this(?: job)?|share on|share to|email this job|copy link|tweet)\b[^.]{0,120}/gi, " ")
    .replace(/\b(?:header|footer)\b(?=\s+(?:navigation|links|menu|content|text))/gi, " ")
    .replace(/\b(?:article|articles|news)\b(?=\s*[|:>\-])/gi, " ")
    .replace(/\|\s*\|+/g, " | ")
    .replace(/\s*[|•·]+\s*/g, " | ")
    .replace(/^[|/>,.;:\-)\](\s]+|[|/>,.;:\-(\[\s]+$/g, " ")
    .replace(/\)\s*,\s*e\b/gi, ") ")
    .replace(/\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/gi, " ")
    .replace(/\s{2,}/g, " ");

  text = stripStandaloneMetadataNumbers(text);
  text = collapseRepeatedPipeSegments(text);

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
  text = stripWorkplaceLocationSuffixFromTitle(text).title;
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
  const titleText = normalizeWhitespace(stringifySafe(options.title || ""));
  let text = stripParserTemplateJunk(value, "location", options)
    .replace(/\b(?:null|undefined|n\/a|not specified|location listed on application)\b/gi, " ")
    .replace(/\bPOINT\s*\([^)]*\)/gi, " ")
    .replace(/\blocality\b/gi, " ")
    .replace(/\b(?:county|continent|administrative area level \d+)\b[^,;|]{0,80}/gi, " ")
    .replace(/\b(?:Title|Business Platform|Location|Date)\b/gi, " ")
    .replace(/^(?:hybrid|remote|on[\s-]?site)\s*[,/-]\s*/i, "")
    .replace(/\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/gi, " ")
    .replace(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b.*$/i, " ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  if (options.organization) {
    text = text.replace(new RegExp(`(?:,?\\s+)?${escapeRegExp(options.organization)}$`, "i"), "").trim();
  }

  const extractedLocation = extractLikelyLocationPhrase(text);
  if (extractedLocation) {
    text = extractedLocation;
  }

  if (titleText && text.includes(",")) {
    const titleTokens = new Set(
      titleText
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 2 && !["and", "for", "the", "with"].includes(token))
    );
    const locationParts = text.split(",");
    const firstSegmentWords = normalizeWhitespace(locationParts[0]).split(/\s+/).filter(Boolean);
    while (firstSegmentWords.length > 1 && titleTokens.has(firstSegmentWords[0].toLowerCase())) {
      firstSegmentWords.shift();
    }
    if (firstSegmentWords.length && firstSegmentWords.join(" ") !== locationParts[0]) {
      text = `${firstSegmentWords.join(" ")},${locationParts.slice(1).join(",")}`.trim();
    }
  }

  text = text
    .replace(/,\s*It$/i, ", Italy")
    .replace(/^(?:hybrid[,/\s-]*)$/i, "")
    .replace(/^(?:previous post|next post|related posts?)$/i, "")
    .replace(/^[,;:|/>\-.\s]+|[,;:|/<\-.\s]+$/g, "")
    .trim();
  const workplaceType = normalizeWorkplaceType(options.workplaceType || options.workplace_type || "");
  if (titleText && text && (
    text.toLowerCase() === titleText.toLowerCase() ||
    (text.toLowerCase().includes(titleText.toLowerCase()) && !/[A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+)/.test(text))
  )) {
    text = "";
  }
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
  if (workplaceType === "Hybrid" && /^(?:anywhere|location flexible)$/i.test(text)) {
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
    workplaceType,
    title: job.title
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
  if (/(per hour|\/\s*hour|\/\s*hr|\bhourly\b)/i.test(text)) return "hour";
  if (/(per day|\/\s*day|\bdaily\b)/i.test(text)) return "day";
  if (/(per week|\/\s*week|\bweekly\b)/i.test(text)) return "week";
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
  if (/(week|weekly)/i.test(text)) return "per week";
  if (/(month|monthly|mo)/i.test(text)) return "per month";
  if (/(year|yearly|annual|annually|yr)/i.test(text)) return "per year";
  return "";
}

const PAY_WINDOW_MARKERS = [
  "$",
  "salary",
  "salary range",
  "compensation",
  "compensation range",
  "pay range",
  "annual salary",
  "base salary",
  "hourly",
  "per hour",
  "USD",
  "CAD",
  "GBP",
  "EUR"
];

function extractPayWindows(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const windows = [];
  const lower = clean.toLowerCase();
  for (const marker of PAY_WINDOW_MARKERS) {
    let index = lower.indexOf(marker.toLowerCase());
    while (index !== -1) {
      const start = Math.max(0, index - 160);
      const end = Math.min(clean.length, index + 240);
      windows.push(clean.slice(start, end));
      index = lower.indexOf(marker.toLowerCase(), index + marker.length);
    }
  }

  return Array.from(new Set(windows));
}

function formatSalaryAmount(amount) {
  if (!Number.isFinite(Number(amount))) return "";
  const rounded = Math.round(Number(amount));
  return rounded.toLocaleString("en-US");
}

function salaryCurrencySymbol(currency) {
  if (currency === "CAD") return "CA$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "$";
}

function isInvalidPayDisplayText(value, options = {}) {
  const text = normalizeWhitespace(stringifySafe(value));
  if (!text) return true;
  if (/^(?:-|—|–|\$-|\$0|0|n\/a|na|not listed|not disclosed|undisclosed)$/i.test(text)) return true;
  if (/\b\d{1,3}\s+\d{3}\b/.test(text) && !/[€$£]|usd|cad|eur|gbp|annual|year|month|hour|day|salary|compensation|pay/i.test(text)) return true;
  if (/^\d[\d,]*(?:\.\d+)?(?:\s*\/\s*(?:hour|day|week|month|year))?$/i.test(text) && !/[€$£]|usd|cad|eur|gbp/i.test(text)) return true;
  if (/^[£€$]?\d{1,3}(?:\.\d{1,2})?$/.test(text)) {
    const amount = Number(text.replace(/[^\d.]/g, ""));
    const period = String(options.period || "").toLowerCase();
    if (!period || period === "unknown" || period === "year" || period === "month") return true;
    if ((period === "hour" || period === "day") && amount <= 0) return true;
  }
  return false;
}

function detectMalformedPayText(value) {
  const text = normalizeWhitespace(stringifySafe(value));
  if (!text) return "";
  if (/\b41\s+147\b/.test(text)) return "malformed_split_salary_fragment";
  if (/\b\d{1,3}\s+\d{3}\b/.test(text) && !/[€$£]|usd|cad|eur|gbp/.test(text) && !/(?:range|salary|compensation|pay).*(?:-|–|—|to)/i.test(text)) {
    return "malformed_split_salary_fragment";
  }
  if (/salary\s+0{2,}\s*-\s*\$\d/i.test(text) || /\$\d{1,3}\s+\d{3}\s*-\s*\$\d{1,3}\s+\d{3}/i.test(text)) {
    return "malformed_salary_range";
  }
  return "";
}

function normalizePayDisplay(options = {}) {
  const payDisplay = normalizeWhitespace(stringifySafe(options.payDisplay || options.salary || ""));
  const salaryMin = Number.isFinite(Number(options.salaryMin)) ? Number(options.salaryMin) : null;
  const salaryMax = Number.isFinite(Number(options.salaryMax)) ? Number(options.salaryMax) : null;
  const detectedCurrency = payDisplay ? detectSalaryCurrency(payDisplay, options.location || "") : "Unknown";
  const detectedPeriod = payDisplay ? detectSalaryPeriod(payDisplay) : "Unknown";
  const currency = VALID_CURRENCIES.has(String(options.currency || "")) && String(options.currency) !== "Unknown"
    ? String(options.currency)
    : detectedCurrency;
  const period = VALID_PERIODS.has(String(options.period || "")) && String(options.period) !== "Unknown"
    ? String(options.period)
    : detectedPeriod;
  const rangeAmounts = [salaryMin, salaryMax].filter((value) => Number.isFinite(value) && value > 0);
  const shouldPreferRange = rangeAmounts.length > 0 && (
    /(?:compensation|salary|pay|wage|hourly|annual|annually|per year|per hour)/i.test(payDisplay) ||
    /^(?:USD|CAD|EUR|GBP)\s*\d/i.test(payDisplay) ||
    /[kK]\b/.test(payDisplay)
  );

  if (payDisplay && /\bannual salary\b/i.test(payDisplay) && !isInvalidPayDisplayText(payDisplay, { period })) {
    return payDisplay.trim();
  }

  if (payDisplay && !shouldPreferRange && !isInvalidPayDisplayText(payDisplay, { period })) {
    return payDisplay
      .replace(/\bpay range\b[:\s-]*/i, "")
      .replace(/\bsalary range\b[:\s-]*/i, "")
      .replace(/\s*-\s*/g, "–")
      .trim();
  }

  if (payDisplay) incrementParserCleanupStat("salary_invalid_removed");

  const effectivePeriod = period !== "Unknown" ? period : (rangeAmounts.some((value) => value >= 1000) ? "year" : "Unknown");

  if (!rangeAmounts.length) return "";
  if (effectivePeriod !== "hour" && effectivePeriod !== "day" && effectivePeriod !== "week" && rangeAmounts.some((value) => value < 1000)) {
    incrementParserCleanupStat("salary_invalid_removed");
    return "";
  }

  const symbol = salaryCurrencySymbol(currency);
  let next = "";
  if (salaryMin && salaryMax && salaryMin !== salaryMax) {
    next = `${symbol}${formatSalaryAmount(salaryMin)}–${symbol}${formatSalaryAmount(salaryMax)}`;
  } else {
    const onlyAmount = salaryMin || salaryMax;
    next = `${symbol}${formatSalaryAmount(onlyAmount)}`;
  }

  if (effectivePeriod !== "Unknown") {
    next = `${next} / ${effectivePeriod}`;
  }
  incrementParserCleanupStat("salary_display_built_from_range");
  return next;
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function confidenceLabelFromScore(score) {
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  return "low";
}

function normalizeSourceStatus(value, fallback = "live") {
  const normalized = normalizeWhitespace(String(value || "")).toLowerCase();
  if (["live", "verified", "active", "published"].includes(normalized)) return "live";
  if (["pending", "pending_review", "needs_review", "review"].includes(normalized)) return "needs_review";
  if (["stale", "aging"].includes(normalized)) return "stale";
  if (["removed", "archived", "expired"].includes(normalized)) return "removed";
  if (["sync_error", "fetch_failed", "parser_failed"].includes(normalized)) return "sync_error";
  return fallback;
}

function dedupeOrganizationMentions(text, organization = "") {
  const cleaned = normalizeWhitespace(text);
  const org = normalizeWhitespace(organization);
  if (!cleaned || !org) return cleaned;
  const escaped = escapeRegExp(org);
  return normalizeWhitespace(
    cleaned
      .replace(new RegExp(`(?:${escaped})(?:\\s*[|,:;-]\\s*${escaped})+`, "gi"), org)
      .replace(new RegExp(`\\b${escaped}\\b\\s+\\b${escaped}\\b`, "gi"), org)
  );
}

function startsWithRejectedDescriptionFragment(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  return DESCRIPTION_REJECT_PREFIX_PATTERNS.some((pattern) => pattern.test(text));
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

const PAY_CONTEXT_PATTERN = /\b(?:salary|compensation|pay|pay range|salary range|comp range|base pay|base salary|annual|annually|yearly|hourly|per hour|per year|per month|base)\b/i;
const PAY_FALSE_POSITIVE_PATTERN = /\b(?:people|customers?|residents?|households?)\s+pay\b|\bpay\s+for\s+(?:utility|utilities|bills?|electricity|energy|rent)\b|\butility\s+bills?\b/i;

function hasPayContext(text) {
  const value = String(text || "");
  return PAY_CONTEXT_PATTERN.test(value) && !PAY_FALSE_POSITIVE_PATTERN.test(value);
}

function normalizeParagraphs(value) {
  return String(value || "")
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z$])/)
    .map((part) => normalizeWhitespace(stripHtml(part)))
    .filter(Boolean);
}

function buildSalaryContextCandidates(text) {
  const cleaned = normalizeWhitespace(stripHtml(text));
  if (!cleaned) return [];
  const paragraphs = normalizeParagraphs(cleaned);
  const payWindows = extractPayWindows(cleaned);
  const tailFirst = paragraphs.slice(-4).reverse();
  const body = paragraphs.filter((paragraph) => hasPayContext(paragraph));
  return Array.from(new Set([
    ...payWindows,
    ...tailFirst.filter((paragraph) => hasPayContext(paragraph) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(paragraph)),
    ...body,
    cleaned
  ]));
}

function detectPayParseConfidence(text, source, warning = "") {
  if (warning) return "low";
  const normalized = normalizeWhitespace(String(text || ""));
  if (!normalized) return "low";
  if (/(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£]).*\d.*(?:-|–|—|to).*\d/i.test(normalized)) return "high";
  if (/(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£]).*(?:per hour|hourly|per day|daily|per week|weekly|per month|monthly|per year|yearly|annual|annually|stipend)/i.test(normalized)) return "high";
  if (hasPayContext(normalized) && /\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?\b/.test(normalized)) return source === "ats_field" ? "high" : "medium";
  return "low";
}

function findBestSalaryMatch(text) {
  const contexts = buildSalaryContextCandidates(text);
  if (!contexts.length) return "";
  for (const cleaned of contexts) {
  if (!cleaned) return "";
  if (detectMalformedPayText(cleaned)) return cleaned;

  const matchers = [
    /(?:annual salary(?: range)?(?: is|:)|salary range(?: for this position)?(?: is|:)|salary for this position is|compensation for this position is|this role pays|compensation range:?|pay range:?|salary:?|compensation:?|pay:?|wage:?|rate:?|stipend:?|base salary:?)[^.]{0,180}(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?(?:\s*(?:hourly|daily|weekly|monthly|annual|annually|per hour|per day|per week|per month|per year|\/hr|\/hour|\/day|\/week|\/month|\/mo|\/year|\/yr))?/i,
    /(?:starting at|up to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|weekly|monthly|annual|annually|per hour|per day|per week|per month|per year|\/hr|\/hour|\/day|\/week|\/month|\/mo|\/year|\/yr))?/i,
    /(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|weekly|monthly|annual|annually|per hour|per day|per week|per month|per year|\/hr|\/hour|\/day|\/week|\/month|\/mo|\/year|\/yr))?/i,
    /(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:hourly|daily|weekly|monthly|annual|annually|per hour|per day|per week|per month|per year|\/hr|\/hour|\/day|\/week|\/month|\/mo|\/year|\/yr))/i,
    /\b\d{2,3}(?:,\d{3})+|\b\d{5,6}\b|\b\d{2,3}(?:\.\d+)?\s*[kK]\b.*(?:-|–|—|to).*\b\d{2,3}(?:,\d{3})+|\b\d{5,6}\b|\b\d{2,3}(?:\.\d+)?\s*[kK]\b(?:\s*(?:hourly|daily|weekly|monthly|annual|annually|per hour|per day|per week|per month|per year|\/hr|\/hour|\/day|\/week|\/month|\/mo|\/year|\/yr))?/i,
    /(?:salary|compensation|pay|base|stipend)[^.]{0,120}?(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:annual|annually|yearly|hourly|weekly|per hour|per week|per year|per month|\/hr|\/hour|\/week|\/year|\/yr|\/month|\/mo))?/i,
    /(?:salary|compensation|pay|base|stipend)[^.]{0,80}?(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:annual|annually|yearly|hourly|weekly|per hour|per week|per year|per month|\/hr|\/hour|\/week|\/year|\/yr|\/month|\/mo))?/i,
    /(?:[$€£])\s*\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*(?:[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*(?:per hour|hourly|weekly|per week|annual|annually|yearly|per year|\/hr|\/hour|\/week|\/year|\/yr)?/i,
    /(?:[$€£])\s*\d[\d,]*(?:\.\d+)?\s*(?:per hour|hourly|weekly|per week|annual|annually|yearly|per year|\/hr|\/hour|\/week|\/year|\/yr)/i,
    /\b(?:competitive salary|competitive compensation|salary not listed|compensation not listed|pay not listed|salary unavailable|compensation unavailable|not disclosed|undisclosed)\b/i
  ];

  for (const matcher of matchers) {
    const match = cleaned.match(matcher);
    if (match && match[0]) {
      return normalizeWhitespace(match[0].replace(/\s+([.,!?;:])/g, "$1"));
    }
  }

    if (hasPayContext(cleaned)) {
      const noCurrencyNumericRange = cleaned.match(/\b\d{2,3}(?:,\d{3})+|\b\d{5,6}\b|\b\d{2,3}(?:\.\d+)?\s*[kK]\b/g);
      if (noCurrencyNumericRange && noCurrencyNumericRange.length) {
        const numericSpan = cleaned.match(/\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:annual|annually|yearly|hourly|per hour|per year|per month|base))?/i);
        if (numericSpan && numericSpan[0]) {
          return normalizeWhitespace(numericSpan[0]);
        }
        const singleNumeric = cleaned.match(/\b(?:salary|compensation|pay|base)[^.]{0,80}?\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:annual|annually|yearly|hourly|per hour|per year|per month|base))?/i);
        if (singleNumeric && singleNumeric[0]) {
          return normalizeWhitespace(singleNumeric[0]);
        }
      }
    }
  }
  return "";
}

function findBestSalaryMatchFromWindows(text) {
  const contexts = buildSalaryContextCandidates(text);
  if (!contexts.length) return "";

  const matchers = [
    /(?:annual salary(?: range)?(?: is|:)|salary range(?: for this position)?(?: is|:)|salary for this position is|compensation for this position is|this role pays|compensation range:?|pay range:?|salary:?|compensation:?|pay:?|wage:?|rate:?|stipend:?|base salary:?)[^.]{0,180}(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?(?:\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?)?/i,
    /(?:starting at|starts at|from|up to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?/i,
    /(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?(?:\s*(?:-|–|—|to)\s*(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?)?/i,
    /(?:[$€£])\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?(?:\s*(?:-|–|—|to)\s*(?:[$€£])?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?)?/i,
    /\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?/i,
    /\b(?:competitive salary|competitive compensation|salary not listed|compensation not listed|pay not listed|salary unavailable|compensation unavailable|not disclosed|undisclosed)\b/i
  ];

  for (const cleaned of contexts) {
    if (!cleaned) continue;
    if (detectMalformedPayText(cleaned)) return cleaned;

    for (const matcher of matchers) {
      const match = cleaned.match(matcher);
      if (match && match[0]) {
        return normalizeWhitespace(match[0].replace(/\s+([.,!?;:])/g, "$1"));
      }
    }

    if (hasPayContext(cleaned)) {
      const numericSpan = cleaned.match(/\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?(?:\s*(?:-|–|—|to)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/\s*(?:hour|hr|day|week|month|mo|year|yr)|per\s+(?:hour|day|week|month|year)|hourly|daily|weekly|monthly|yearly|annual|annually))?)?/i);
      if (numericSpan && numericSpan[0]) return normalizeWhitespace(numericSpan[0]);
    }
  }

  return "";
}

function findPayLikeSnippet(value) {
  const text = stringifySafe(value) || cleanFlattenedText(value);
  if (!text) return "";
  const paragraphs = normalizeParagraphs(text);
  for (const paragraph of paragraphs) {
    const cleaned = normalizeWhitespace(paragraph);
    if (!cleaned) continue;
    if ((hasPayContext(cleaned) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(cleaned)) && !PAY_FALSE_POSITIVE_PATTERN.test(cleaned)) {
      return cleaned.slice(0, 280);
    }
  }
  const normalized = normalizeWhitespace(text);
  if ((hasPayContext(normalized) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(normalized)) && !PAY_FALSE_POSITIVE_PATTERN.test(normalized)) {
    return normalized.slice(0, 280);
  }
  return "";
}

const MULTI_LOCATION_SALARY_PATTERN = /the annual salary for candidates based in (.{1,200}?)(?::|is)\s*[$€£]?\s*(\d[\d,]*\.?\d*)\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*[$€£]?\s*(\d[\d,]*\.?\d*)\s*[kKmM]?)?/gi;

function extractMultiLocationSalaryRanges(text) {
  const cleaned = normalizeWhitespace(stripHtml(String(text || "")));
  if (!cleaned) return null;
  const ranges = [];
  let match;
  while ((match = MULTI_LOCATION_SALARY_PATTERN.exec(cleaned)) !== null) {
    const minVal = Number(match[2].replace(/[,\s]/g, ""));
    const maxVal = match[3] ? Number(match[3].replace(/[,\s]/g, "")) : null;
    if (Number.isFinite(minVal) && (maxVal === null || Number.isFinite(maxVal))) {
      ranges.push({ min: minVal, max: maxVal || minVal });
    }
  }
  if (!ranges.length) return null;
  const allMins = ranges.map(r => r.min);
  const allMaxs = ranges.map(r => r.max);
  const combinedMin = Math.min(...allMins);
  const combinedMax = Math.max(...allMaxs);
  return {
    salary_min: combinedMin,
    salary_max: combinedMax,
    salary_currency: "USD",
    salary_period: "year",
    salary: `\$${formatSalaryAmount(combinedMin)}–\$${formatSalaryAmount(combinedMax)}`,
    salary_visible: true,
    salary_note: ranges.length > 1 ? "Multiple location-based ranges" : "",
    pay_parse_source: "multi_location_salary"
  };
}

function extractSalaryData(job = {}) {
  const candidateSnippets = [];
  const rejectedSnippets = [];
  const explicitCandidates = [
    job.salary,
    job.raw_salary,
    job.compensation,
    job.pay,
    job.pay_range,
    job.salary_range,
    job.wage,
    job.rate,
    job.base_salary,
    job.baseSalary,
    job.stipend,
    job.salary_min && job.salary_max ? `${job.salary_min} - ${job.salary_max}` : "",
    job.salaryRange,
    job.salaryDescription,
    job.salaryDescriptionPlain,
    job.raw_payload?.salary,
    job.raw_payload?.raw_salary,
    job.raw_payload?.compensation,
    job.raw_payload?.pay,
    job.raw_payload?.pay_range,
    job.raw_payload?.salary_range,
    job.raw_payload?.wage,
    job.raw_payload?.rate,
    job.raw_payload?.base_salary,
    job.raw_payload?.baseSalary,
    job.raw_payload?.stipend,
    job.raw_payload?.salaryRange,
    job.raw_payload?.salaryDescription,
    job.raw_payload?.salaryDescriptionPlain
  ];

  for (const candidate of explicitCandidates) {
    const text = normalizeWhitespace(salaryCandidateToText(candidate) || stringifySafe(candidate) || cleanFlattenedText(candidate));
    if (!text) continue;
    candidateSnippets.push(text.slice(0, 280));
    const matched = findBestSalaryMatchFromWindows(text) || findBestSalaryMatch(text) || text;
    const confidence = detectPayParseConfidence(matched, matched ? "ats_field" : "none");
    return {
      text: matched,
      source: matched ? "ats_field" : "none",
      payLikeDetected: hasPayContext(text) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(text),
      failedSnippet: matched ? "" : findPayLikeSnippet(text),
      confidence,
      candidateSnippets,
      rejectedSnippets,
      rejectionReason: matched ? "" : (findPayLikeSnippet(text) ? "pay_like_detected_but_not_parsed" : "")
    };
  }

  const finalParagraphCandidates = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.raw_payload?.description,
    job.raw_payload?.raw_description
  ];

  for (const candidate of finalParagraphCandidates) {
    const paragraphs = normalizeParagraphs(candidate);
    const tailParagraphs = paragraphs.slice(-4).reverse();
    for (const paragraph of tailParagraphs) {
      if (paragraph) candidateSnippets.push(paragraph.slice(0, 280));
      const matched = findBestSalaryMatchFromWindows(paragraph) || findBestSalaryMatch(paragraph);
      if (matched) {
        return {
          text: matched,
          source: "description_final_paragraph",
          payLikeDetected: true,
          failedSnippet: "",
          confidence: detectPayParseConfidence(matched, "description_final_paragraph"),
          candidateSnippets,
          rejectedSnippets,
          rejectionReason: ""
        };
      }
      if ((hasPayContext(paragraph) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(paragraph)) && !PAY_FALSE_POSITIVE_PATTERN.test(paragraph)) {
        rejectedSnippets.push(paragraph.slice(0, 280));
      }
    }
  }

  const multiLocationText = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content
  ].filter(Boolean).join("\n");
  const multiLocationResult = extractMultiLocationSalaryRanges(multiLocationText);
  if (multiLocationResult) {
    return {
      text: multiLocationResult.salary,
      source: "multi_location_salary",
      payLikeDetected: true,
      failedSnippet: "",
      confidence: "high",
      candidateSnippets,
      rejectedSnippets,
      rejectionReason: "",
      multiLocationResult
    };
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
    const flattened = normalizeWhitespace(stringifySafe(candidate) || cleanFlattenedText(candidate));
    if (flattened) candidateSnippets.push(flattened.slice(0, 280));
    const matched = findBestSalaryMatchFromWindows(candidate) || findBestSalaryMatch(candidate);
    if (matched) {
      return {
        text: matched,
        source: "description_body",
        payLikeDetected: true,
        failedSnippet: "",
        confidence: detectPayParseConfidence(matched, "description_body"),
        candidateSnippets,
        rejectedSnippets,
        rejectionReason: ""
      };
    }
    const snippet = findPayLikeSnippet(candidate);
    if (snippet) rejectedSnippets.push(snippet);
  }

  const payLikeText = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    stringifySafe(job.raw_payload?.description),
    stringifySafe(job.raw_payload?.raw_description)
  ]
    .filter(Boolean)
    .join(" ");

  return {
    text: "",
    source: "none",
    payLikeDetected: hasPayContext(payLikeText) || /[$€£]|\b(?:USD|CAD|EUR|GBP)\b/i.test(payLikeText),
    failedSnippet: findPayLikeSnippet(payLikeText),
    confidence: "low",
    candidateSnippets: Array.from(new Set(candidateSnippets.filter(Boolean))),
    rejectedSnippets: Array.from(new Set(rejectedSnippets.filter(Boolean))),
    rejectionReason: findPayLikeSnippet(payLikeText) ? "pay_like_detected_but_not_parsed" : ""
  };
}

function extractSalaryText(job = {}) {
  return extractSalaryData(job).text;
}

function parseSalaryRange(salary, location) {
  const rawSalary = normalizeWhitespace(stringifySafe(salary) || cleanFlattenedText(salary));
  const salaryText = rawSalary.trim();
  const salaryCurrency = salaryText ? detectSalaryCurrency(salaryText, location) : "Unknown";
  const salaryPeriod = salaryText ? detectSalaryPeriod(salaryText) : "Unknown";
  const malformedReason = detectMalformedPayText(salaryText);
  const empty = {
    raw_salary: rawSalary,
    salary: "",
    salary_min: null,
    salary_max: null,
    salary_currency: salaryCurrency,
    salary_period: salaryPeriod,
    salary_visible: false,
    salary_note: "",
    pay_parse_warning: malformedReason
  };

  if (!salaryText) return empty;
  if (malformedReason) {
    incrementParserCleanupStat("salary_parse_warning");
    incrementParserCleanupStat("salary_invalid_removed");
    return empty;
  }

  if (/\b(?:salary not listed|compensation not listed|pay not listed|salary unavailable|compensation unavailable|not disclosed|undisclosed)\b/i.test(salaryText)) {
    return empty;
  }
  const hasExplicitRange = /(?:USD|CAD|EUR|GBP|US\$|CA\$|C\$|[$€£])\s*\d[\d,]/i.test(salaryText);
  if (/\b(?:competitive|commensurate|depending on experience|doe)\b/i.test(salaryText) && !hasExplicitRange) {
    return {
      ...empty,
      salary: salaryText,
      salary_visible: true,
      pay_parse_warning: ""
    };
  }

  const isMaxOnly = /\b(?:up to|maximum|max\.?)\b/i.test(salaryText);
  const isMinOnly = /\b(?:starting at|starts at|from|minimum|min\.?)\b/i.test(salaryText) || /\+$/.test(salaryText);

  const text = salaryText
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/(?<=\d)\+(?=\D|$)/g, "")
    .replace(/\(\*\)|\*/g, "")
    .replace(/\s+/g, " ");

  const matches = [...text.matchAll(/(?:USD|CAD|EUR|GBP|US\$|CA\$|[$€£]|C\$)?\s*(\d[\d,]*\.?\d*)\s*([kKmM]?)/g)];
  const amounts = matches
    .map((match) => normalizeSalaryValue(match[1], match[2]))
    .filter((value) => Number.isFinite(value));

  if (!amounts.length) {
    return {
      ...empty,
      salary: "",
      salary_visible: false
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

  const next = {
    raw_salary: rawSalary,
    salary: normalizePayDisplay({
      payDisplay: salaryText,
      salaryMin,
      salaryMax,
      currency: salaryCurrency,
      period:
        salaryPeriod !== "Unknown"
          ? salaryPeriod
          : amounts.some((amount) => amount >= 1000 || /[kKmM]/.test(text))
            ? "year"
            : "Unknown"
    }),
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    salary_period:
      salaryPeriod !== "Unknown"
        ? (salaryPeriod === "hour" && amounts.some((a) => a >= 5000)
          ? "year"
          : salaryPeriod)
        : amounts.some((amount) => amount >= 1000 || /[kKmM]/.test(text))
          ? "year"
          : "Unknown",
    salary_visible: true
  };

  if (!next.salary) {
    return {
      ...next,
      salary_visible: false
    };
  }

  return next;
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
  return normalizeWhitespace(
    stripSchemaMetadata(String(paragraph || ""))
      .replace(/[>›»]+/g, " ")
      .replace(/\s*=\s*/g, " ")
      .replace(/&(amp|nbsp|quot|apos|#39|lt|gt);/gi, " ")
      .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
      .replace(/\b(?:next|previous)\b(?:\s*post)?[:\s-]*/gi, " ")
      .replace(/\bPrevious:\s*[^.]{0,200}\bNext:\s*[^.]{0,200}/gi, " ")
      .replace(/\b(?:apply online|apply now|apply today|submit application|learn more|read more|view job|view opening|back to jobs|search jobs|job openings|applicant login|join talent community)\b/gi, " ")
      .replace(/\b(?:jobs search|green jobs network|climate change jobs|article|articles|news|posted by|logo text)\b/gi, " ")
      .replace(/\b(?:share to|share on)\s+(?:twitter|facebook|linkedin)\b/gi, " ")
      .replace(/\b(?:share this job|email this job|copy link|tweet)\b/gi, " ")
      .replace(/\bnew\b(?=\s+[A-Z][a-z])/g, " ")
      .replace(/\b(?:job title|department|location|reports to|supervises|duration)\s*:\s*/gi, " ")
      .replace(/\b(?:posted|job id|requisition id|req id|employment type|workplace type)\s*:\s*[^.]{0,120}/gi, " ")
      .replace(/\b(?:equal opportunity employer|privacy policy|terms of use|cookie policy|reasonable accommodation|all qualified applicants|veteran status|gender identity)\b[^.]{0,220}/gi, " ")
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
  if (/(?:\b\d+[mhdy]\s+ago\b|•\s*remote\s*•)/i.test(normalized) && !/[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|optimizes)/i.test(normalized)) {
    return true;
  }
  return false;
}

const PREFERRED_ROLE_SECTION_HEADINGS = [
  /purpose\s+of\s+(?:the\s+)?(?:role|position)/i,
  /reports?\s+to/i,
  /job\s+status/i,
  /(?:about|overview\s+of)\s+(?:the\s+)?role/i,
  /position\s+summary/i,
  /role\s+(?:overview|summary|description)/i,
  /what\s+(?:you(?:'|’)ll|you\s+will)\s+do/i,
  /key\s+responsibilities/i,
  /responsibilities/i,
  /duties\s+and\s+(?:responsibilities|expectations)/i,
  /qualifications/i,
  /requirements/i,
  /what\s+(?:we(?:'|’)?re\s+)?looking\s+for/i
];

const HIGH_PRIORITY_SECTIONS = [
  /purpose\s+of\s+(?:the\s+)?(?:role|position)/i,
  /position\s+summary/i,
  /role\s+(?:summary|overview|description)/i,
  /about\s+(?:the\s+)?role/i,
  /responsibilities/i,
  /what\s+you(?:'|'|')\u0099?(?:ll| will)\s+do/i,
  /key\s+responsibilities/i,
  /duties\s+and\s+(?:responsibilities|expectations)/i,
  /reports?\s+to/i,
  /compensation\b(?!\s+(?:and|&)\s+benefits)/i,
  /salary\b(?!\s+(?:and|&)\s+benefits)/i,
  /requirements?\b(?!\s+(?:and|&)\s+qualifications)/i,
  /qualifications?\b/i,
  /what\s+we(?:'|'|')\u0099?re\s+looking\s+for/i,
  /we\s+are\s+seeking\b/i,
  /the\s+(?:ideal|right)\s+candidate/i
];

const LOW_PRIORITY_SECTIONS = [
  /benefits?\b/i,
  /perks?\b/i,
  /DEI\b|diversity\s+(?:equity|inclusion)|equal\s+opportunity/i,
  /how\s+we\s+support\s+our\s+(?:staff|team|employees)/i,
  /office\s+(?:perks|amenities|lunch|snacks|dogs|pets)/i,
  /fun\s+(?:facts|stuff|perks|benefits)/i,
  /(?:view|see)\s+(?:all|more|our)\s+(?:jobs|openings|positions|roles)\b/i,
  /powered\s+by\b/i,
  /apply\s+(?:now|today|here)\b/i,
  /join\s+(?:our\s+)?(?:talent\s+)?(?:community|network|team)\b/i,
  /share\s+(?:this|the)\s+(?:job|posting|position)\b/i,
  /follow\s+us\b/i,
  /(?:copyright|\u00a9)\s+\d{4}/i,
  /privacy\s+(?:policy|notice|statement)/i,
  /terms\s+(?:of\s+)?(?:use|service|employment)/i,
  /unsolicited\s+(?:resumes|cv)/i,
  /recruitment\s+(?:agency|firm)/i,
  /background\s+check/i,
  /drug\s+(?:test|free|screen)/i,
  /e-?verify\b/i,
  /employment\s+is\s+contingent/i,
  /(?:network\s+of\s+\d+|hundreds\s+of)\s+(?:local\s+)?(?:chapters|offices|employees)/i,
  /our\s+(?:destinies|fates)\s+are\s+tied/i,
  /we\s+(?:are\s+)?(?:an?\s+)?equal\s+opportunity\s+(?:employer|workplace)/i,
  /work\s+(?:for|at|with)\s+us\b/i,
  /why\s+(?:work|join)\s+(?:for|at|with)\s+us\b/i,
  /life\s+at\b/i,
  /our\s+(?:mission|values|culture|story)\b/i,
  /about\s+(?:us|our\s+(?:company|organization))\b/i,
  /careers?\s+(?:page|home|list|site)\b/i,
  /current\s+openings?\b/i,
  /as\s+we\s+think\s+about\s+a\s+growing\s+staff/i,
  /competitive\s+(?:salaries|wages|pay)\b/i,
  /professional\s+development\s+(?:and|&)\s+training/i
];

function extractCanonicalRoleSection(text) {
  if (!text) return "";
  const raw = String(text);
  const hasBreaks = /\n{2,}/.test(raw);
  const hasHtml = /<[a-z]+[^>]*>/i.test(raw);
  let splitText = raw;
  if (!hasBreaks) {
    if (hasHtml) {
      splitText = raw
        .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/h[1-6]>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n");
    } else {
      splitText = raw.replace(/(?:\.|!|\?)\s+(?=[A-Z])/g, "$&\n\n");
    }
  }
  const paragraphs = splitText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  let phase = "before";
  const kept = [];
  for (const para of paragraphs) {
    if (!para) continue;

    const isLowPriority = LOW_PRIORITY_SECTIONS.some((p) => p.test(para));
    const isHighPriority = HIGH_PRIORITY_SECTIONS.some((p) => p.test(para));

    if (isHighPriority) {
      phase = "role";
      kept.push(para);
      continue;
    }

    if (phase === "before") {
      if (!isLowPriority && para.length >= 30 && /[A-Z]/.test(para)) {
        kept.push(para);
      }
      continue;
    }

    if (phase === "role") {
      if (isLowPriority) {
        continue;
      }
      kept.push(para);
    }
  }

  return kept.join("\n\n");
}

const GENERIC_CAREERS_SECTION_HEADINGS = [
  /how\s+we\s+support\s+our\s+(?:staff|team|employees)/i,
  /current\s+openings/i,
  /as\s+we\s+think\s+about\s+a\s+growing\s+staff/i,
  /competitive\s+(?:salaries|pay|compensation)/i,
  /professional\s+development\s+(?:and|&)\s+training/i,
  /benefits?\s+(?:and|&)\s+(?:perks|compensation)/i,
  /why\s+(?:work|join)\s+(?:for|at|with)\s+us/i,
  /life\s+at\b(?!\s+(?:the\s+)?role)/i,
  /our\s+(?:culture|values|mission|story)/i,
  /join\s+our\s+team/i,
  /careers?\s+(?:page|home|list)/i,
  /view\s+(?:our\s+)?(?:open|current)\s+(?:positions|roles|jobs)/i
];

function detectPreferredRoleSections(text) {
  if (!text) return null;
  const paragraphs = String(text).split(/\n{2,}/);
  const roleParagraphs = [];
  let inGenericSection = false;
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const isGenericHeading = GENERIC_CAREERS_SECTION_HEADINGS.some((p) => p.test(trimmed));
    const isPreferredHeading = PREFERRED_ROLE_SECTION_HEADINGS.some((p) => p.test(trimmed));
    if (isGenericHeading) { inGenericSection = true; continue; }
    if (isPreferredHeading) { inGenericSection = false; roleParagraphs.push(trimmed); continue; }
    if (!inGenericSection && /[A-Z][a-z]{2,}/.test(trimmed) && trimmed.length >= 30) {
      roleParagraphs.push(trimmed);
    }
  }
  return roleParagraphs.length > 0 ? roleParagraphs.join("\n\n") : null;
}

function stripGenericCareersContent(text) {
  if (!text) return text;
  const paragraphs = String(text).split(/\n{2,}/);
  const kept = [];
  let inGenericSection = false;
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const isGenericHeading = GENERIC_CAREERS_SECTION_HEADINGS.some((p) => p.test(trimmed));
    const isPreferredHeading = PREFERRED_ROLE_SECTION_HEADINGS.some((p) => p.test(trimmed));
    if (isGenericHeading) { inGenericSection = true; continue; }
    if (isPreferredHeading) { inGenericSection = false; kept.push(trimmed); continue; }
    if (!inGenericSection) kept.push(trimmed);
  }
  return kept.join("\n\n");
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
    /network of \d+ local chapters/i,
    /how we support our staff/i,
    /how we support our team/i,
    /current openings/i,
    /as we think about a growing staff/i,
    /competitive salaries and wages/i,
    /professional development and training/i,
    /browse (?:our )?(?:current )?(?:job )?openings/i,
    /all qualified candidates are encouraged/i,
    /we encourage candidates from/i,
    /we are (?:an )?equal opportunity/i,
    /we are committed to creating/i,
    /we are dedicated to building/i,
    /we offer a (?:competitive|comprehensive).+(?:salary|benefit|compensation|package)/i,
    /(?:our|the) (?:team|organization|culture) (?:is|are) (?:committed|dedicated|passionate)/i,
    /we believe (?:that )?(?:diversity|equity|inclusion|our people)/i,
    /(?:apply|submit) (?:your|an) (?:application|resume)/i,
    /join (?:our|the) (?:team|talent community)/i,
    /for (?:more|additional) information (?:about|regarding)/i,
    /\b(?:why\s+)?work\s+(?:for|at|with)\s+(?:us|our\s+company|our\s+organization)\b/i
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

function stripLeadingDescriptionFragments(value, title = "") {
  let next = String(value || "");
  const normalizedTitle = normalizeWhitespace(title || "");
  const rolePrefix = normalizedTitle ? `The ${normalizedTitle}` : "This role";
  next = next
    .replace(/^(?:[\s>*•%\-–—]+)+/g, "")
    .replace(/^(?:[A-Z][A-Z\s/&-]{2,20}:)\s*/g, "")
    .replace(/^(?:salary|compensation|pay)\s*[:\-]\s*(?:[$€£]?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*[$€£]?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?)\s*/i, "")
    .replace(/^(?:remote eligible|hybrid eligible|on-site|onsite|remote|hybrid)\b[:\-\s]*/i, (match) => `${rolePrefix} is ${normalizeWhitespace(match)} `)
    .replace(/^(?:will|would|can)\s+/i, (match) => `${rolePrefix} ${normalizeWhitespace(match)} `)
    .replace(/^(?:[a-z]{1,3}\b\s*){1,4}(?=[A-Z][a-z]{2,}\s+[a-z]{3,})/g, "");
  const lines = next
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  while (lines.length) {
    const line = lines[0];
    if (line.length < 18 && !/[.?!]$/.test(line)) {
      lines.shift();
      continue;
    }
    if (/^(?:job id|req(?:uisition)? id|department|location|reports to|supervises|duration|posted|updated|team)\b[:\-]/i.test(line)) {
      lines.shift();
      continue;
    }
    if (/^(?:[*•%\-–—]|[A-Z\s/&-]{3,20}:?$)/.test(line)) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join(" ");
}

function capitalizeDescriptionOpening(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return { text: "", changed: false };
  const match = text.match(/[a-zA-Z]/);
  if (!match) return { text, changed: false };
  const index = match.index;
  const first = text[index];
  if (first === first.toUpperCase()) return { text, changed: false };
  return {
    text: `${text.slice(0, index)}${first.toUpperCase()}${text.slice(index + 1)}`,
    changed: true
  };
}

function looksLikeWeakSnippetStart(sentence) {
  return /^(?:this role|the role will|will oversee|we grow|remote eligible|hybrid eligible)\b/i.test(sentence)
    || /^(?:we strongly encourage candidates|apply now|back to jobs|see all openings|www\.)/i.test(sentence)
    || /^[*•%\-–—)]/.test(sentence);
}

function hasMalformedOpeningParagraph(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  const firstSentence = splitIntoSentences(text).map((sentence) => normalizeWhitespace(sentence)).find(Boolean) || text;
  return startsWithRejectedDescriptionFragment(firstSentence)
    || /^(?:we strongly encourage candidates|apply now|back to jobs|see all openings|www\.)/i.test(firstSentence)
    || /^\)\s*[A-Z]/.test(firstSentence);
}

function hasMalformedDescriptionTemplate(value) {
  const text = String(value || "");
  return MALFORMED_DESCRIPTION_TEMPLATE_PATTERNS.some((pattern) => pattern.test(text));
}

function applyTitleToMalformedTemplate(text, title) {
  const normalizedText = String(text || "");
  const normalizedTitle = normalizeWhitespace(title || "");
  if (!normalizedText) return "";

  let next = normalizedText
    .replace(/The&nbsp;will/gi, "The will")
    .replace(/\bThe\s{2,}/g, "The ");

  if (!normalizedTitle) {
    return normalizeWhitespace(next);
  }

  const escapedTitle = escapeRegExp(normalizedTitle);
  next = next
    .replace(/\bThe\s+will\b/g, `The ${normalizedTitle} will`)
    .replace(/\bThe\s+is\b/g, `The ${normalizedTitle} is`)
    .replace(/\bThe\s+are\b/g, `The ${normalizedTitle} are`)
    .replace(/\bThe\s*,/g, `${normalizedTitle},`)
    .replace(/\bThe\s*\./g, normalizedTitle)
    .replace(/\bIn this position,\s+the\s+will\b/gi, `In this position, the ${normalizedTitle} will`)
    .replace(/\bAs the\s*,/gi, `As the ${normalizedTitle},`);

  next = next.replace(new RegExp(`\\bThe\\s+${escapedTitle}\\s+${escapedTitle}\\b`, "gi"), `The ${normalizedTitle}`);
  return normalizeWhitespace(next);
}

function normalizeDescription(description, options = {}) {
  const title = normalizeWhitespace(options.title || "");
  const organization = normalizeWhitespace(options.organization || "");
  const descriptionInput = stringifySafe(description) || cleanFlattenedText(description);
  const strippedGeneric = stripGenericCareersContent(descriptionInput);
  const normalizedInput = normalizeWhitespace(strippedGeneric);
  const rawDescription = stripParserTemplateJunk(normalizedInput, "description");
  const canonicalRoleText = extractCanonicalRoleSection(rawDescription);
  const pipelineInput = canonicalRoleText && canonicalRoleText.length >= 30 ? canonicalRoleText : rawDescription;
  const cleaned = applyTitleToMalformedTemplate(collapseRepeatedPhrases(normalizeWhitespace(
    stripSchemaMetadata(stripHtml(pipelineInput))
      .replace(/[>›»]+/g, " ")
      .replace(/\s*=\s*/g, " ")
      .replace(/&(amp|nbsp|quot|apos|#39|lt|gt);/gi, " ")
      .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
      .replace(/\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:[^.]{0,200}/gi, " ")
      .replace(/\bPrevious:\s*[^.]{0,200}\bNext:\s*[^.]{0,200}/gi, " ")
      .replace(/\bpost navigation\b[^.]{0,200}/gi, " ")
      .replace(/\bTitle Business(?: Platform Location Date)?\b/gi, " ")
      .replace(/\be"\s*"*\s*(?:headers?)?(?:\s*"*)+/gi, " ")
      .replace(/\bheaders?\b(?:\s+(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4})?/gi, " ")
      .replace(/\b(?:jobs search|green jobs network|climate change jobs|logo text)\b/gi, " ")
      .replace(/\bsee (?:new|current) openings\b/gi, " ")
      .replace(/\b(?:apply online|apply now|apply today|submit application|learn more|read more|view job|view opening|back to jobs)\b/gi, " ")
      .replace(/\b(?:share to|share on)\s+(?:twitter|facebook|linkedin)\b/gi, " ")
      .replace(/\b(?:share this job|email this job|copy link|tweet)\b/gi, " ")
      .replace(/\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/gi, " ")
      .replace(/\b(?:[A-Z][A-Za-z/&,\s-]{2,80})\s*\(\d{1,3}%\)\s*/g, " ")
      .replace(/\)\s*[A-Z][A-Za-z/&,\s-]{2,80}\s*\(\d{1,3}%\)\s*/g, " ")
      .replace(/\s+[oO]\s+(?=[A-Z])/g, ". ")
      .replace(/\bRemote roles?\s*:/gi, " ")
      .replace(/\b\d*\/svg\b/gi, " ")
      .replace(/\bviewBox="[^"]*"/gi, " ")
      .replace(/<span\b/gi, " ")
      .replace(/[>"<]+/g, " ")
      .replace(
        /\b(?:job title|department|location|reports to|supervises)\s*:\s*[\s\S]*?(?=(?:job title|department|location|reports to|supervises|duration|context|scope|role overview|about us|what you(?:'|’)ll do)\s*:|$)/gi,
        " "
      )
      .replace(/\b(?:about us|about the company|about the role|job summary|role overview|what you’ll do|what you will do|responsibilities|requirements|qualifications|preferred qualifications|benefits|details|context|scope|what you bring)\s*:?/gi, " ")
      .replace(/\b(?:job title|department|reports to|supervises|duration|location)\s*:/gi, " ")
      .replace(/\.\s*\./g, ". ")
  )), title);
  const strippedLeading = stripLeadingDescriptionFragments(cleaned, title);
  const numericCleaned = normalizeWhitespace(
    collapseRepeatedPipeSegments(
      stripLeadingMetadataBlob(
        stripStandaloneMetadataNumbers(strippedLeading)
      )
    )
  ).replace(/^[)\]}>,.;:!?/\\|%+-]+\s*/, "");

  if (
    !numericCleaned
    || !/[A-Za-z]{3,}/.test(numericCleaned)
    || /^[>"'<\s|/\\-]+$/.test(numericCleaned)
    || startsWithRejectedDescriptionFragment(numericCleaned)
  ) {
    return {
      raw_description: rawDescription,
      description: "",
      diagnostics: {
        description_cleaning_applied: strippedLeading !== cleaned,
        description_leading_fragment_removed: strippedLeading !== cleaned,
        description_auto_capitalized: false,
        description_fallback_sentence_used: false,
        snippet_fallback_used: false
      }
    };
  }

  let sentences = splitIntoSentences(numericCleaned)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length >= 35);

  sentences = dedupeDescriptionSentences(removeBoilerplateSentences(sentences)
    .filter((sentence) => !/^(job title|department|reports to|location|duration)\b/i.test(sentence))
    .filter((sentence) => !/^(apply now|apply today|submit application|learn more|read more|view job|view opening)\b/i.test(sentence))
    .filter((sentence) => !hasMalformedOpeningParagraph(sentence))
    .filter((sentence) => !/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(sentence))
    .filter((sentence) => !title || normalizeComparableText(sentence) !== normalizeComparableText(title))
    .filter((sentence) => !/\b(?:webpage|readaction|privacy policy|terms of use|cookie policy|share this job|equal opportunity employer)\b/i.test(sentence))
    .filter((sentence) => !/\b(?:the\s*,\s*market|the,\s*market)\b/i.test(sentence))
    .filter((sentence) => /[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|optimizes)/i.test(sentence)));

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

  const finalDescription = applyTitleToMalformedTemplate(
    dedupeTitleMentions(collapseRepeatedPhrases(selected.join(" ").trim() || numericCleaned), title),
    title
  );
  let chosenDescription = finalDescription;
  let fallbackSentenceUsed = false;
  const fallbackSentence = sentences.find((sentence) => (
    !looksLikeWeakSnippetStart(sentence)
    && !hasMalformedOpeningParagraph(sentence)
    && sentence.length >= 35
    && !DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(sentence))
    && /[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|optimizes)/i.test(sentence)
  ));
  if ((!selected.length || looksLikeWeakSnippetStart(chosenDescription)) && fallbackSentence) {
    chosenDescription = fallbackSentence;
    fallbackSentenceUsed = true;
  }
  const capitalized = capitalizeDescriptionOpening(dedupeOrganizationMentions(chosenDescription, organization));
  const metadataHeavyDescription = /\b(?:career_page|other \d+|ipo \d+|point\s*\(|locality\b|business\/productivity software|cleantech|oil\s*&\s*gas|renewable energy|revenue|valuation|headquarters|employee size)\b/i.test(finalDescription);

  const dominatedByNoise =
    selected.length === 0 &&
    DESCRIPTION_NOISE_PATTERNS.some((pattern) => pattern.test(rawDescription)) &&
    !/[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners|optimizes)/i.test(
      numericCleaned
    );
  const dominatedBySchemaMetadata = looksLikeSchemaMetadata(rawDescription) && !selected.length;

  return {
    raw_description: rawDescription,
    description: dominatedByNoise || dominatedBySchemaMetadata || isArticleLikeDescription(capitalized.text) || startsWithRejectedDescriptionFragment(capitalized.text) || (metadataHeavyDescription && selected.length === 0) ? "" : capitalized.text,
    diagnostics: {
      description_cleaning_applied: strippedLeading !== cleaned || capitalized.changed,
      description_leading_fragment_removed: strippedLeading !== cleaned,
      description_auto_capitalized: capitalized.changed,
      description_fallback_sentence_used: fallbackSentenceUsed,
      snippet_fallback_used: false
    }
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
    const preferredSections = detectPreferredRoleSections(text);
    if (preferredSections) {
      fallbackText = preferredSections;
      break;
    }
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

function buildFallbackDescription(job = {}) {
  const title = normalizeWhitespace(stringifySafe(job.title));
  const organization = normalizeWhitespace(stringifySafe(job.organization));
  const location = normalizeWhitespace(stringifySafe(job.location));
  const workplaceType = normalizeWhitespace(stringifySafe(job.workplace_type));
  const functionName = normalizeWhitespace(stringifySafe(job.function));
  const sector = normalizeWhitespace(stringifySafe(job.sector));
  if (!title && !organization && !functionName && !sector) {
    return "Role details are available on the original posting.";
  }

  const pieces = [];
  const scope = functionName || sector || "its climate and sustainability work";
  const possessiveOrganization = organization ? `${organization}${organization.endsWith("s") ? "'" : "'s"}` : "";
  pieces.push(
    possessiveOrganization
      ? `This role supports ${possessiveOrganization} work across ${scope}.`
      : `This role supports work across ${scope}.`
  );
  return normalizeWhitespace(pieces.join(" "));
}

function isLikelyCorruptedDescription(value, options = {}) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  const title = normalizeWhitespace(options.title || "");
  const organization = normalizeWhitespace(options.organization || "");
  if (DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (isCompanyOnlyDescription(text, { title, organization })) return true;
  if (isRepeatedDateDescription(text)) return true;
  if (isMostlyMetadataDescription(text)) return true;
  if (!title && hasMalformedDescriptionTemplate(text)) return true;
  if (!/[A-Za-z]{3,}/.test(text) || /^[>"'<\s|/\\-]+$/.test(text)) return true;
  const normalized = normalizeDescription(text, { title }).description;
  if (!normalized) return true;
  if (hasMalformedDescriptionTemplate(normalized)) return true;
  if (DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (isCompanyOnlyDescription(normalized, { title, organization })) return true;
  if (isRepeatedDateDescription(normalized)) return true;
  if (isMostlyMetadataDescription(normalized)) return true;
  if (!/[A-Za-z]{3,}/.test(normalized)) return true;
  return false;
}

function hasUsableDescription(value, options = {}) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  return !isLikelyCorruptedDescription(text, options);
}

function computeContentQualityScore(job = {}) {
  const description = normalizeWhitespace(job.description || "");
  const rawDescription = normalizeWhitespace(job.raw_description || "");
  const snippet = normalizeWhitespace(job.description_snippet || job.summary || "");
  const organization = normalizeWhitespace(job.organization || "");
  let score = 100;

  if (!description) score -= 45;
  if (description && description.length < 140) score -= 10;
  if (startsWithRejectedDescriptionFragment(description) || startsWithRejectedDescriptionFragment(snippet)) score -= 30;
  if (hasMalformedOpeningParagraph(description) || hasMalformedOpeningParagraph(snippet)) score -= 24;
  if (DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(description)) || DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(snippet))) score -= 30;
  if (BAD_PUBLIC_CONTENT_PATTERNS.some((pattern) => pattern.test(rawDescription))) score -= 12;
  if (organization && countRegexMatches(description, new RegExp(escapeRegExp(organization), "gi")) >= 3) score -= 10;
  if (!hasDescriptionVerbSignal(description)) score -= 10;
  if (!normalizeWhitespace(job.salary || "") && normalizeWhitespace(job.pay_parse_warning || "")) score -= 6;
  if (normalizeWhitespace(job.parse_warning || "")) score -= 8;

  return clampScore(score);
}

function buildDescriptionSnippet(value, maxLength = 220, options = {}) {
  const title = normalizeWhitespace(options.title || "");
  const organization = normalizeWhitespace(options.organization || "");
  const normalizedShape = normalizeDescription(value, { title, organization });
  const normalizedDescription = applyTitleToMalformedTemplate(normalizedShape.description, title);
  if (!normalizedDescription) return "";
  if (isLikelyCorruptedDescription(normalizedDescription, { title, organization })) return "";

  const sentences = splitIntoSentences(normalizedDescription)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean)
    .filter((sentence) => sentence.length >= 25)
    .filter((sentence) => !DESCRIPTION_JUNK_PATTERNS.some((pattern) => pattern.test(sentence)))
    .filter((sentence) => !/^(?:milan,\s*italy|southampton,\s*uk|greer,\s*sc|madison,\s*wi|date operations)/i.test(sentence));

  const preferredSentence = sentences.find((sentence) => !looksLikeWeakSnippetStart(sentence)) || sentences[0];
  const finalSnippet = preferredSentence || normalizeWhitespace(normalizedDescription);
  if (!finalSnippet || startsWithRejectedDescriptionFragment(finalSnippet) || isLikelyCorruptedDescription(finalSnippet, { title, organization })) return "";
  if (finalSnippet.length <= maxLength) return finalSnippet;
  return `${finalSnippet.slice(0, maxLength - 1).trimEnd()}…`;
}

function isBadPublicContent(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  return BAD_PUBLIC_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function isPotentiallyHumanApplyUrl(value, options = {}) {
  const url = normalizeWorkableUrl(value).url || normalizeWhitespace(String(value || ""));
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(?:json|xml|rss|atom|md)(?:[?#].*)?$/i.test(url)) return false;
  if (/[?&](?:output|format)=(?:json|xml|rss|atom)\b/i.test(url)) return false;
  if (/\/(?:api|feeds?|rss|atom)(?:\/|$)/i.test(url)) return false;
  if (/\/jobs\.md(?:[?#].*)?$/i.test(url)) return false;
  if (/jobs\.workable\.com\/search/i.test(url)) return false;
  if (/apply\.workable\.com/i.test(url)) {
    return WORKABLE_HUMAN_APPLY_PATTERNS.some((pattern) => pattern.test(url));
  }
  return true;
}

function isValidSourceUrl(value) {
  const url = normalizeWhitespace(String(value || ""));
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(?:json|xml|rss|atom|md)(?:[?#].*)?$/i.test(url)) return false;
  if (/\/(?:api|feeds?|rss|atom)(?:\/|$)/i.test(url)) return false;
  return true;
}

function isValidPublicLocation(value) {
  const text = normalizeWhitespace(String(value || ""));
  if (!text) return false;
  return !INVALID_PUBLIC_LOCATION_PATTERNS.some((pattern) => pattern.test(text));
}

function computeParserConfidenceScore(job = {}) {
  let score = 0;
  const titleConfidence = normalizeWhitespace(job.title_confidence || "").toLowerCase();
  if (titleConfidence === "high") score += 25;
  else if (titleConfidence === "medium") score += 16;
  else if (titleConfidence === "low") score += 4;

  if (hasUsableDescription(job.description, { title: job.title, organization: job.organization })) score += 20;
  if (!isBadPublicContent(job.description) && !isBadPublicContent(job.raw_description)) score += 10;
  if (isPotentiallyHumanApplyUrl(job.apply_url || job.original_url)) score += 15;
  if (isValidSourceUrl(job.source_url || job.original_url || job.apply_url)) score += 8;
  if (isValidPublicLocation(job.location || "")) score += 6;
  if (normalizeWhitespace(job.workplace_type)) score += 4;
  if (normalizeWhitespace(job.specialization)) score += 4;
  if (normalizeWhitespace(job.specialization_confidence || "").toLowerCase() === "high") score += 4;

  const payDisplay = normalizeWhitespace(job.salary || "");
  if (payDisplay) {
    if (!normalizeWhitespace(job.pay_parse_warning || "")) {
      score += 8;
    } else {
      score -= 6;
    }
  }

  if (isBadPublicContent(job.title) || isBadPublicContent(job.location)) score -= 20;
  if (!normalizeWhitespace(job.title) || !normalizeWhitespace(job.organization)) score -= 20;
  score += Math.round(computeContentQualityScore(job) * 0.12);

  return Math.max(0, Math.min(100, score));
}

function assessPublicJobReadiness(job = {}, options = {}) {
  const reasons = [];
  const sourceName = normalizeWhitespace(`${job.source || ""} ${options.source?.provider || ""} ${options.source?.type || ""}`.toLowerCase());
  const applyUrl = normalizeWhitespace(job.apply_url || job.original_url || "");
  const sourceUrl = normalizeWhitespace(job.source_url || job.original_url || "");
  const parserConfidenceScore = computeParserConfidenceScore(job);
  const payWarning = normalizeWhitespace(job.pay_parse_warning || "");
  const descriptionUsable = hasUsableDescription(job.description, {
    title: job.title,
    organization: job.organization
  });

  if (!normalizeWhitespace(job.title)) reasons.push("missing_title");
  if (!normalizeWhitespace(job.organization)) reasons.push("missing_organization");
  if (normalizeWhitespace(job.title_confidence || "").toLowerCase() === "low") reasons.push("low_title_confidence");
  if (!descriptionUsable) reasons.push("description_not_usable");
  if (isBadPublicContent(job.description) || isBadPublicContent(job.raw_description)) reasons.push("junk_content_detected");
  if (!isValidPublicLocation(job.location || "")) reasons.push("invalid_location");
  if (!isValidSourceUrl(sourceUrl)) reasons.push("invalid_source_url");
  if (!isPotentiallyHumanApplyUrl(applyUrl, { source: options.source })) {
    if (/workable/.test(sourceName) || /workable/i.test(`${applyUrl} ${sourceUrl}`)) {
      reasons.push("workable_no_human_apply_page");
    } else {
      reasons.push("invalid_apply_url");
    }
  }
  if (payWarning) reasons.push(`pay_uncertain:${payWarning}`);
  if (parserConfidenceScore < 70) reasons.push("parser_confidence_below_public_threshold");

  return {
    ready: reasons.length === 0,
    reasons,
    parser_confidence_score: parserConfidenceScore,
    parser_confidence: confidenceLabelFromScore(parserConfidenceScore),
    content_quality_score: computeContentQualityScore(job),
    apply_url_valid: isPotentiallyHumanApplyUrl(applyUrl, { source: options.source }),
    source_url_valid: isValidSourceUrl(sourceUrl),
    description_usable: descriptionUsable
  };
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
  const titleCleanup = stripWorkplaceLocationSuffixFromTitle(attributedTitle || input.title);
  const title = normalizeTitle(titleCleanup.title || attributedTitle || input.title, organization, { ...parserOptions, organization });
  const rawApplyUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.applyUrl || input.apply_url || input.applyUrl));
  const rawOriginalUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.originalUrl || input.original_url || input.originalUrl || rawApplyUrl || input.source_url || input.sourceUrl));
  const rawSourceUrl = sanitizeRoleUrl(safeStringField(sourceAttribution?.sourceUrl || input.source_url || input.sourceUrl));
  const workableApplyDiagnostic = normalizeWorkableUrl(rawApplyUrl);
  const workableSourceDiagnostic = normalizeWorkableUrl(rawSourceUrl);
  const workableOriginalDiagnostic = normalizeWorkableUrl(rawOriginalUrl);
  const paylocityApplyDiagnostic = normalizePaylocityUrl(workableApplyDiagnostic.url || rawApplyUrl);
  const paylocitySourceDiagnostic = normalizePaylocityUrl(workableSourceDiagnostic.url || rawSourceUrl);
  const paylocityOriginalDiagnostic = normalizePaylocityUrl(workableOriginalDiagnostic.url || rawOriginalUrl);
  const applyUrl = paylocityApplyDiagnostic.url || workableApplyDiagnostic.url || rawApplyUrl;
  const originalUrl = paylocityOriginalDiagnostic.url || workableOriginalDiagnostic.url || rawOriginalUrl;
  const sourceUrl = paylocitySourceDiagnostic.url || workableSourceDiagnostic.url || rawSourceUrl;
  const inferredWorkplaceType = normalizeWorkplaceType(input.workplace_type || input.workplaceType) || titleCleanup.workplaceType || resolveWorkplaceType(input);
  const location = normalizeLocationDisplay({ ...input, organization, location: titleCleanup.location || input.location }, inferredWorkplaceType);
  const salaryExtraction = extractSalaryData(input);
  const salaryText = salaryExtraction.text;
  const salaryShape = parseSalaryRange(salaryText, location);
  const explicitCurrency = safeStringField(input.salary_currency || input.salaryCurrency);
  const explicitPeriod = safeStringField(input.salary_period || input.salaryPeriod);
  const descriptionCandidate = extractDescriptionText(input);
  const descriptionShape = normalizeDescription(descriptionCandidate, { title, organization });
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
  const titleQuality = assessTitleQuality(title, { ...input, organization, location });
  const invalidTitle = title ? isClearlyNotJobTitle(title, { ...input, organization, location }) : true;
  const rejectRule = sourceRuleMatch?.reason || (invalidTitle ? "semantic_title_rule:invalid_job_title_pattern" : "");
  const rejectReason = rejectRule ? "invalid_job_title_pattern" : "";
  const inheritedTriageBucket = safeStringField(input.triage_bucket || input.triageBucket);
  const inheritedTriageReason = safeStringField(input.triage_reason || input.triageReason);
  const combinedWarnings = mergeWarnings(
    sourceAttribution?.parseWarning,
    input.parse_warning || input.parseWarning,
    salaryShape.pay_parse_warning,
    titleCleanup.warnings,
    titleQuality.warnings
  );
  const parseWarning = combinedWarnings.join("; ");
  const inheritedBucket = safeStringField(sourceAttribution?.triageBucket || inheritedTriageBucket);
  const inheritedReason = safeStringField(sourceAttribution?.triageReason || inheritedTriageReason);
  const titleNeedsCleanup = titleQuality.confidence === "low" || titleQuality.warnings.includes("workplace_suffix_in_title");
  const triageBucket = inheritedBucket || (titleNeedsCleanup ? "needs_cleanup" : "");
  const triageReason = inheritedReason || (titleQuality.confidence === "low" ? "low-confidence title parse" : "");
  const specializationShape = normalizeSpecializationDetailed(input.specialization || input.display?.specialization, input);
  if (titleQuality.confidence === "low") incrementParserCleanupStat("low_confidence_title");

  const workableNormalization = workableApplyDiagnostic.normalized || workableSourceDiagnostic.normalized || workableOriginalDiagnostic.normalized;
  const originalWorkableUrl =
    workableApplyDiagnostic.original_url ||
    workableSourceDiagnostic.original_url ||
    workableOriginalDiagnostic.original_url ||
    "";
  const canonicalWorkableUrl =
    workableApplyDiagnostic.canonical_url ||
    workableSourceDiagnostic.canonical_url ||
    workableOriginalDiagnostic.canonical_url ||
    "";
  const normalizedDescriptionSourceUrl = safeStringField(
    normalizePaylocityUrl(
      normalizeWorkableUrl(input.description_source_url || input.descriptionSourceUrl || input.raw_payload?.description_source_url || sourceUrl || originalUrl).url
    ).url
  );
  const normalizedPaySourceUrl = safeStringField(
    normalizePaylocityUrl(
      normalizeWorkableUrl(input.pay_source_url || input.paySourceUrl || input.raw_payload?.pay_source_url || sourceUrl || originalUrl).url
    ).url
  );
  const descriptionSourceUrl = safeStringField(
    normalizePaylocityUrl(normalizedDescriptionSourceUrl || sourceUrl || originalUrl).url || normalizedDescriptionSourceUrl
  );
  const canonicalPaySourceUrl = safeStringField(
    normalizePaylocityUrl(normalizedPaySourceUrl || sourceUrl || originalUrl).url || normalizedPaySourceUrl
  );
  const applyUrlType = safeStringField(input.apply_url_type || input.applyUrlType)
    || (/apply\.workable\.com/i.test(applyUrl) ? "ats_apply_page" : (applyUrl && sourceUrl && applyUrl !== sourceUrl ? "direct_application_page" : "job_description_page"));
  const workableApplyValidationReason = /workable/i.test(`${input.source || ""} ${input.source_type || ""} ${applyUrl} ${sourceUrl}`)
    ? (isPotentiallyHumanApplyUrl(applyUrl, { source: { provider: input.source_type || input.source } }) ? "human_apply_url_confirmed" : "workable_apply_url_not_human_usable")
    : "";
  const normalizedSourceMeta = {
    type: safeStringField(input.source_type || input.sourceType),
    provider: safeStringField(input.source_provider || input.provider || input.source_type || input.sourceType),
    trusted: typeof input.trusted === "boolean" ? input.trusted : false,
    auto_publish: typeof input.auto_publish === "boolean" ? input.auto_publish : false,
    enabled: input.source_enabled !== false
  };
  const parserConfidenceScore = resolveNumericField(input.parser_confidence_score ?? input.parserConfidenceScore);
  const contentQualityScore = resolveNumericField(input.content_quality_score ?? input.contentQualityScore);
  const failedSyncCount = Math.max(0, Number(input.failed_sync_count ?? input.failedSyncCount ?? 0) || 0);
  const rawStaleScore = resolveNumericField(input.stale_score ?? input.staleScore);
  const sourceConfidence = safeStringField(input.source_confidence || input.sourceConfidence || inferSourceConfidenceTier(normalizedSourceMeta));
  const sourceClassification = safeStringField(input.source_classification || input.sourceClassification || inferSourceClassification(normalizedSourceMeta));
  const lastCheckedAt = safeStringField(input.last_checked_at || input.lastCheckedAt || input.last_verified_at || input.lastVerifiedAt || new Date().toISOString());
  const lastSeenAt = safeStringField(input.last_seen_at || input.lastSeenAt || lastCheckedAt);
  const sourceStatus = normalizeSourceStatus(input.source_status || input.sourceStatus || input.verification_status || input.status, "live");

  const normalizedJob = {
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
    salary_currency: VALID_CURRENCIES.has(explicitCurrency) && explicitCurrency !== "Unknown" ? explicitCurrency : salaryShape.salary_currency,
    salary_period: VALID_PERIODS.has(explicitPeriod) && explicitPeriod !== "Unknown" ? explicitPeriod : salaryShape.salary_period,
    salary_visible: resolvedSalaryVisible,
    salary_note: safeStringField(salaryExtraction.multiLocationResult?.salary_note || salaryShape.salary_note),
    pay_parse_warning: safeStringField(input.pay_parse_warning || input.payParseWarning || salaryShape.pay_parse_warning),
    pay_parse_source: safeStringField(input.pay_parse_source || input.payParseSource || salaryExtraction.source),
    pay_parse_confidence: safeStringField(input.pay_parse_confidence || input.payParseConfidence || salaryExtraction.confidence),
    pay_candidate_snippets: Array.isArray(input.pay_candidate_snippets) ? input.pay_candidate_snippets : salaryExtraction.candidateSnippets,
    pay_rejected_snippets: Array.isArray(input.pay_rejected_snippets) ? input.pay_rejected_snippets : salaryExtraction.rejectedSnippets,
    pay_rejection_reason: safeStringField(input.pay_rejection_reason || input.payRejectionReason || salaryExtraction.rejectionReason),
    pay_like_detected: typeof input.pay_like_detected === "boolean" ? input.pay_like_detected : Boolean(salaryExtraction.payLikeDetected),
    pay_parse_failed_snippet: safeStringField(input.pay_parse_failed_snippet || input.payParseFailedSnippet || salaryExtraction.failedSnippet),
    description_cleaning_applied: Boolean(input.description_cleaning_applied ?? descriptionShape.diagnostics?.description_cleaning_applied),
    description_leading_fragment_removed: Boolean(input.description_leading_fragment_removed ?? descriptionShape.diagnostics?.description_leading_fragment_removed),
    description_auto_capitalized: Boolean(input.description_auto_capitalized ?? descriptionShape.diagnostics?.description_auto_capitalized),
    description_fallback_sentence_used: Boolean(input.description_fallback_sentence_used ?? descriptionShape.diagnostics?.description_fallback_sentence_used),
    snippet_fallback_used: Boolean(input.snippet_fallback_used ?? descriptionShape.diagnostics?.snippet_fallback_used),
    featured: Boolean(input.featured),
    sector: normalizeSector(input.sector || "general"),
    function: safeStringField(input.function || input.role_function),
    specialization: specializationShape.specialization,
    specialization_confidence: specializationShape.confidence,
    experience: safeStringField(input.experience),
    source: normalizeSourceNameWithOptions(sourceAttribution?.sourceName || input.source, parserOptions) || "Manual",
    source_url: sourceUrl,
    apply_url: applyUrl,
    original_url: originalUrl,
    apply_url_type: applyUrlType,
    description_source_url: descriptionSourceUrl,
    pay_source_url: canonicalPaySourceUrl,
    workable_url_normalized: workableNormalization,
    original_workable_url: originalWorkableUrl,
    canonical_workable_url: canonicalWorkableUrl,
    workable_human_apply_confirmed: workableApplyValidationReason === "human_apply_url_confirmed",
    workable_apply_validation_reason: workableApplyValidationReason,
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
    title_confidence: titleQuality.confidence,
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
    parser_confidence: safeStringField(input.parser_confidence || input.parserConfidence),
    parser_confidence_score: parserConfidenceScore,
    content_quality_score: contentQualityScore,
    last_checked_at: lastCheckedAt,
    last_seen_at: lastSeenAt,
    source_status: sourceStatus,
    stale_score: rawStaleScore,
    source_confidence: sourceConfidence,
    source_classification: sourceClassification,
    failed_sync_count: failedSyncCount,
    trusted: typeof input.trusted === "boolean" ? input.trusted : undefined,
    auto_publish: typeof input.auto_publish === "boolean" ? input.auto_publish : undefined,
    sync_origin: safeStringField(input.sync_origin)
  };

  const resolvedParserConfidenceScore = normalizedJob.parser_confidence_score ?? computeParserConfidenceScore(normalizedJob);
  normalizedJob.parser_confidence_score = clampScore(resolvedParserConfidenceScore);
  normalizedJob.parser_confidence = safeStringField(normalizedJob.parser_confidence || confidenceLabelFromScore(normalizedJob.parser_confidence_score));
  normalizedJob.content_quality_score = clampScore(
    normalizedJob.content_quality_score ?? computeContentQualityScore(normalizedJob)
  );
  normalizedJob.stale_score = clampScore(
    normalizedJob.stale_score ?? (normalizedJob.source_status === "stale" ? 60 : normalizedJob.source_status === "removed" ? 100 : 0)
  );
  return normalizedJob;
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
  return normalizeSpecializationDetailed(value, job).specialization;
}

function normalizeSpecializationDetailed(value, job = {}) {
  const explicit = normalizeWhitespace(stringifySafe(value));
  const roleContext = normalizeWhitespace([
    job.title,
    job.function,
    Array.isArray(job.tags) ? job.tags.join(" ") : job.tags,
    job.description,
    job.raw_description,
    job.notes
  ].filter(Boolean).join(" "));
  const videoFirstProducerSignal =
    /\b(?:creator lead|creator|producer|multimedia producer|video producer|content producer|digital producer|creative producer)\b/i.test(roleContext)
    && /\b(?:video|vertical video|short-form video|short form video|social video|youtube|tiktok|instagram reels|distribution of .*video|video editing|capcut|descript)\b/i.test(roleContext);

  if (explicit) {
    if (normalizeWhitespace(explicit).toLowerCase() === "data" && videoFirstProducerSignal) {
      return { specialization: "Video", confidence: "high" };
    }
    const matchedExplicit = SPECIALIZATION_RULES.find((rule) => rule.pattern.test(explicit));
    if (matchedExplicit) return { specialization: matchedExplicit.label, confidence: "high" };
    if (CANONICAL_SPECIALIZATIONS.includes(explicit)) return { specialization: explicit, confidence: "high" };
    return { specialization: explicit, confidence: "medium" };
  }

  if (videoFirstProducerSignal) {
    return { specialization: "Video", confidence: "high" };
  }

  const sources = [
    { confidence: "high", text: normalizeWhitespace(job.title) },
    { confidence: "medium", text: normalizeWhitespace(job.function) },
    { confidence: "medium", text: normalizeWhitespace(Array.isArray(job.tags) ? job.tags.join(" ") : job.tags) },
    { confidence: "low", text: normalizeWhitespace(job.description) },
    { confidence: "low", text: normalizeWhitespace(job.raw_description) },
    { confidence: "low", text: normalizeWhitespace(job.notes) }
  ];

  for (const source of sources) {
    if (!source.text) continue;
    const matchedRule = SPECIALIZATION_RULES.find((rule) => rule.pattern.test(source.text));
    if (matchedRule) {
      return {
        specialization: matchedRule.label,
        confidence: source.confidence
      };
    }
  }

  return {
    specialization: "",
    confidence: "low"
  };
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
    if (rawJob && rawJob.__pending_preserved) job.__pending_preserved = true;
    if (rawJob && rawJob.__pending_new) job.__pending_new = true;
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
  const sourceConfidence = inferSourceConfidenceTier(source || {});
  const sourceClassification = inferSourceClassification(source || {});
  const routed = normalizeJob({
    ...job,
    source_id: source.id,
    source_type: source.type,
    source_provider: source.provider,
    source_confidence: sourceConfidence,
    source_classification: sourceClassification,
    trusted: Boolean(source.trusted),
    auto_publish: Boolean(source.auto_publish),
    manual_review_required: source.manual_review_required === true,
    sync_origin: job.sync_origin || "ats",
    last_checked_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    source_status: "live"
  });
  if (!routed) return null;

  const elementalImpactSource = /elemental impact/i.test(String(source.organization || "")) ||
    /elementalimpact\.com/i.test(String(source.source_url || "")) ||
    /elemental impact/i.test(String(routed.source || ""));
  if (elementalImpactSource) {
    incrementParserCleanupStat("elemental_impact_routed_pending");
    return normalizeJob({ ...routed, trusted: false, auto_publish: false, status: "pending" });
  }

  if (String(routed.title_confidence || "").toLowerCase() === "low") {
    return normalizeJob({ ...routed, trusted: false, auto_publish: false, status: "pending" });
  }

  const readiness = assessPublicJobReadiness(routed, { source });
  const reviewReason = readiness.reasons.join("; ");

  if (source.trusted === true && source.auto_publish === true && readiness.ready) {
    return normalizeJob({
      ...routed,
      status: "active",
      confidence: readiness.parser_confidence,
      parser_confidence: readiness.parser_confidence,
      parser_confidence_score: readiness.parser_confidence_score,
      content_quality_score: readiness.content_quality_score,
      source_status: "live",
      stale_score: 0
    });
  }

  return normalizeJob({
    ...routed,
    trusted: false,
    auto_publish: false,
    status: "pending",
    confidence: readiness.parser_confidence,
    parser_confidence: readiness.parser_confidence,
    parser_confidence_score: readiness.parser_confidence_score,
    content_quality_score: readiness.content_quality_score,
    source_status: "needs_review",
    stale_score: 15,
    review_reason: routed.review_reason || reviewReason || "pending_review_required",
    triage_reason: routed.triage_reason || reviewReason || "pending_review_required"
  });
}

module.exports = {
  CANONICAL_SPECIALIZATIONS,
  cleanCustomCareerPageText,
  detectPreferredRoleSections,
  extractCanonicalRoleSection,
  stripGenericCareersContent,
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
  hasMalformedDescriptionTemplate,
  hasUsableDescription,
  isSocialShareUrl,
  isGenericRoleTitle,
  isValidDate,
  isLikelyCorruptedDescription,
  getJobExclusionReason,
  getParserCleanupStats,
  hasRoleSignal,
  isClearlyNotJobTitle,
  isLocationOnlyTitle,
  isOrganizationOnlyTitle,
  isSingleFirstNameOnlyTitle,
  looksLikePhysicalLocation,
  normalizeDescription,
  normalizePaylocityUrl,
  normalizeWorkableUrl,
  applyTitleToMalformedTemplate,
  normalizeEmploymentType,
  normalizeJob,
  buildDescriptionSnippet,
  buildFallbackDescription,
  computeContentQualityScore,
  computeParserConfidenceScore,
  extractMultiLocationSalaryRanges,
  extractSalaryData,
  extractPayWindows,
  normalizeLocationDisplay,
  normalizeSpecialization,
  normalizeSpecializationDetailed,
  normalizeWorkplaceType,
  resolveEmploymentType,
  resolveWorkplaceType,
  assessPublicJobReadiness,
  isBadPublicContent,
  isPotentiallyHumanApplyUrl,
  isValidPublicLocation,
  isValidSourceUrl,
  normalizeSector,
  normalizeOrganization,
  normalizePayDisplay,
  normalizeSourceStatus,
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
