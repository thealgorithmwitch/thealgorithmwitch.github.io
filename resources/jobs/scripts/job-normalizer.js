const crypto = require("crypto");
const { evaluateSourceTitleRules } = require("./source-rules");

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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function normalizeCompanyCore(value) {
  return normalizeWhitespace(stripHtml(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !ORGANIZATION_NOISE_TOKENS.has(token))
    .join(" ");
}

function removeTitleOrganizationSuffix(title, organization) {
  const separators = [" | ", " - ", " — ", " – ", " @ "];
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

function normalizeTitle(value, organization = "") {
  let text = normalizeWhitespace(stripHtml(decodeHtmlEntities(value)));
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
  return normalizeWhitespace(text);
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

function normalizeDescription(description) {
  const rawDescription = normalizeWhitespace(stringifySafe(description) || cleanFlattenedText(description));
  const cleaned = normalizeWhitespace(
    stripHtml(rawDescription)
      .replace(/[>›»]+/g, " ")
      .replace(/&(amp|nbsp|quot|apos|#39|lt|gt);/gi, " ")
      .replace(/\b(?:href|class|aria-label|target|data-[\w-]+|rel|style|headers)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bno\s*wrap\b|\bnowrap\b/gi, " ")
      .replace(/\b(?:next|previous)\s*:\s*(?:next|previous)\s+post\s*:[^.]{0,200}/gi, " ")
      .replace(/\bpost navigation\b[^.]{0,200}/gi, " ")
      .replace(
        /\b(?:job title|department|location|reports to|supervises)\s*:\s*[\s\S]*?(?=(?:job title|department|location|reports to|supervises|duration|context|scope|role overview|about us|what you(?:'|’)ll do)\s*:|$)/gi,
        " "
      )
      .replace(/\b(?:about us|about the company|about the role|job summary|role overview|what you’ll do|what you will do|responsibilities|requirements|qualifications|preferred qualifications|benefits|details|context|scope|what you bring)\s*:?/gi, " ")
      .replace(/\b(?:job title|department|reports to|supervises|duration|location)\s*:/gi, " ")
      .replace(/\.\s*\./g, ". ")
  );

  if (!cleaned) {
    return {
      raw_description: rawDescription,
      description: ""
    };
  }

  let sentences = splitIntoSentences(cleaned)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length >= 35);

  sentences = removeBoilerplateSentences(sentences)
    .filter((sentence) => !/^(job title|department|reports to|location|duration)\b/i.test(sentence))
    .filter((sentence) => !/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(sentence))
    .filter((sentence) => /[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners)/i.test(sentence));

  const prioritySentences = sentences.filter((sentence) => {
    return /(role|position|responsible|support|manage|lead|coordinate|develop|partner|build|work with|candidate|team|mission|focus|scope)/i.test(sentence);
  });

  const selected = [];
  for (const sentence of [...prioritySentences, ...sentences]) {
    if (selected.includes(sentence)) continue;
    selected.push(sentence);
    if (selected.length === 5) break;
  }

  const dominatedByNoise =
    selected.length === 0 &&
    DESCRIPTION_NOISE_PATTERNS.some((pattern) => pattern.test(rawDescription)) &&
    !/[a-z]{3,}\s+(?:is|are|will|can|should|must|plans|coordinates|executes|supports|manages|builds|seeks|works|develops|leads|drives|partners)/i.test(
      cleaned
    );

  return {
    raw_description: rawDescription,
    description: dominatedByNoise ? "" : selected.join(" ").trim() || cleaned
  };
}

function extractDescriptionText(job = {}) {
  const directCandidates = [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary
  ];

  for (const candidate of directCandidates) {
    const text = normalizeWhitespace(stringifySafe(candidate) || cleanFlattenedText(candidate));
    if (text.length >= 80) return text;
  }

  const built = cleanFlattenedText({
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
  });
  return built;
}

function safeStringField(value, fallback = "") {
  const text = normalizeWhitespace(stringifySafe(value));
  return text || fallback;
}

function resolveNumericField(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeJob(input = {}) {
  const organization = safeStringField(input.organization);
  const title = normalizeTitle(input.title, organization);
  const applyUrl = safeStringField(input.apply_url || input.applyUrl);
  const originalUrl = safeStringField(input.original_url || input.originalUrl || applyUrl || input.source_url || input.sourceUrl);
  const location = safeStringField(input.location, "Remote");
  const salaryText = extractSalaryText(input);
  const salaryShape = parseSalaryRange(salaryText, location);
  const explicitCurrency = safeStringField(input.salary_currency || input.salaryCurrency);
  const explicitPeriod = safeStringField(input.salary_period || input.salaryPeriod);
  const descriptionCandidate = extractDescriptionText(input);
  const descriptionShape = normalizeDescription(descriptionCandidate);
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

  return {
    id,
    ref: safeStringField(input.ref),
    external_id: safeStringField(input.external_id || input.externalId),
    source_id: safeStringField(input.source_id || input.sourceId),
    source_type: safeStringField(input.source_type || input.sourceType),
    title,
    organization,
    location,
    workplace_type: safeStringField(input.workplace_type || input.workplaceType),
    job_type: safeStringField(input.job_type || input.jobType, "Full-time"),
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
    experience: safeStringField(input.experience),
    source: safeStringField(input.source, "Manual"),
    source_url: safeStringField(input.source_url || input.sourceUrl),
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
    triage_bucket: safeStringField(input.triage_bucket || input.triageBucket),
    triage_reason: safeStringField(input.triage_reason || input.triageReason),
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

function buildDedupeKey(job) {
  const normalized = normalizeJob(job);
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
    const key = buildDedupeKey(job);
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

  if (source.trusted === true && source.auto_publish === true) {
    return normalizeJob({ ...routed, status: "active" });
  }

  return normalizeJob({ ...routed, status: "pending" });
}

module.exports = {
  cleanFlattenedText,
  decodeHtmlEntities,
  dedupeJobs,
  detectSalaryCurrency,
  detectSalaryPeriod,
  ensureArray,
  extractDescriptionText,
  extractSalaryText,
  flattenTextValues,
  isValidDate,
  hasRoleSignal,
  isClearlyNotJobTitle,
  isLocationOnlyTitle,
  isOrganizationOnlyTitle,
  isSingleFirstNameOnlyTitle,
  normalizeDescription,
  normalizeJob,
  normalizeSector,
  parseSalaryRange,
  routeSyncedJob,
  slugify,
  stableHash,
  stringifySafe,
  stripHtml,
  todayIso
};
