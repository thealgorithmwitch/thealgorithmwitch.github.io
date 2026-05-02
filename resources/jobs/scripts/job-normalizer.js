const crypto = require("crypto");

const VALID_CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP", "Unknown"]);
const VALID_PERIODS = new Set(["hourly", "daily", "monthly", "yearly", "Unknown"]);
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

function coerceText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => coerceText(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const key of ["summary", "display", "text", "label", "name", "salary", "compensation", "description", "html"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key];
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
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
  return decodeHtmlEntities(String(value || ""))
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/h[1-6]>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function detectSalaryCurrency(salary, location) {
  const salaryText = coerceText(salary).trim();
  const locationText = String(location || "").trim().toLowerCase();

  if (!salaryText) {
    return "Unknown";
  }

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
  const text = coerceText(salary).toLowerCase();
  if (!text.trim()) return "Unknown";
  if (/(per hour|\/\s*hour|\/\s*hr|\bhr\b|\bhourly\b)/i.test(text)) return "hourly";
  if (/(per day|\/\s*day|\bdaily\b)/i.test(text)) return "daily";
  if (/(per month|\/\s*month|\/\s*mo\b|\bmonthly\b|\bmo\b)/i.test(text)) return "monthly";
  if (/(per year|\/\s*year|\/\s*yr|\bannual\b|\byearly\b|\ba year\b|annually|per annum)/i.test(text)) return "yearly";
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

function parseSalaryRange(salary, location) {
  const rawSalary = coerceText(salary);
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

  if (!salaryText) {
    return empty;
  }

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
    salary_period: salaryPeriod,
    salary_visible: true
  };
}

function splitIntoSentences(value) {
  return String(value || "")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function normalizeDescription(description) {
  const rawDescription = coerceText(description);
  const cleaned = stripHtml(rawDescription)
    .replace(/\b(?:about us|about the company|about the role|job summary|role overview|what you’ll do|what you will do|responsibilities|requirements|qualifications|preferred qualifications|benefits)\s*:?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return {
      raw_description: rawDescription,
      description: ""
    };
  }

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
    /gender identity/i
  ];

  const sentences = splitIntoSentences(cleaned)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 25)
    .filter((sentence) => !boilerplatePatterns.some((pattern) => pattern.test(sentence)));

  const summarySentences = [];
  for (const sentence of sentences) {
    if (summarySentences.includes(sentence)) continue;
    summarySentences.push(sentence);
    if (summarySentences.length === 5) break;
  }

  const selected = summarySentences.length > 3 ? summarySentences.slice(0, 4) : summarySentences;
  return {
    raw_description: rawDescription,
    description: selected.join(" ").trim() || cleaned
  };
}

function normalizeJob(input = {}) {
  const title = String(input.title || "").trim();
  const organization = String(input.organization || "").trim();
  const applyUrl = String(input.apply_url || input.applyUrl || "").trim();
  const location = String(input.location || "Remote").trim();
  const salaryInput = input.raw_salary !== undefined && input.raw_salary !== null ? input.raw_salary : input.salary;
  const salaryShape = parseSalaryRange(salaryInput, location);
  const salary = coerceText(input.salary || salaryShape.salary || "").trim();
  const datePosted = String(input.date_posted || input.datePosted || "").trim();
  const dateAdded = String(input.date_added || input.dateAdded || datePosted || todayIso()).trim();
  const dateUpdated = String(input.date_updated || input.dateUpdated || datePosted || todayIso()).trim();
  const explicitCurrency = String(input.salary_currency || input.salaryCurrency || "").trim();
  const explicitPeriod = String(input.salary_period || input.salaryPeriod || "").trim().toLowerCase();
  const descriptionShape = normalizeDescription(
    input.raw_description !== undefined && input.raw_description !== null ? input.raw_description : input.description
  );
  const resolvedSalaryVisible =
    typeof input.salary_visible === "boolean" ? input.salary_visible : salaryShape.salary_visible;
  const id =
    String(input.id || "").trim() ||
    [organization, title, datePosted || todayIso()].map(slugify).filter(Boolean).join("-");

  const tags = ensureArray(input.tags).map((tag) => String(tag).trim().toLowerCase());

  return {
    id,
    ref: String(input.ref || "").trim(),
    external_id: String(input.external_id || input.externalId || "").trim(),
    source_id: String(input.source_id || input.sourceId || "").trim(),
    source_type: String(input.source_type || input.sourceType || "").trim(),
    title,
    organization,
    location,
    workplace_type: String(input.workplace_type || input.workplaceType || "").trim(),
    job_type: String(input.job_type || input.jobType || "Full-time").trim(),
    salary: resolvedSalaryVisible ? salary || salaryShape.salary : "",
    raw_salary: input.raw_salary !== undefined && input.raw_salary !== null ? coerceText(input.raw_salary) : salaryShape.raw_salary,
    salary_min: Number.isFinite(Number(input.salary_min)) ? Number(input.salary_min) : salaryShape.salary_min,
    salary_max: Number.isFinite(Number(input.salary_max)) ? Number(input.salary_max) : salaryShape.salary_max,
    salary_currency: VALID_CURRENCIES.has(explicitCurrency) ? explicitCurrency : salaryShape.salary_currency,
    salary_period: VALID_PERIODS.has(explicitPeriod) ? explicitPeriod : salaryShape.salary_period,
    salary_visible: resolvedSalaryVisible,
    featured: Boolean(input.featured),
    sector: String(input.sector || "general").trim(),
    function: String(input.function || input.role_function || "").trim(),
    experience: String(input.experience || "").trim(),
    source: String(input.source || "Manual").trim(),
    source_url: String(input.source_url || input.sourceUrl || "").trim(),
    apply_url: applyUrl,
    date_posted: isValidDate(datePosted) ? new Date(datePosted).toISOString().slice(0, 10) : todayIso(),
    date_added: isValidDate(dateAdded) ? new Date(dateAdded).toISOString().slice(0, 10) : todayIso(),
    date_updated: isValidDate(dateUpdated) ? new Date(dateUpdated).toISOString().slice(0, 10) : todayIso(),
    status: String(input.status || "active").trim().toLowerCase(),
    approved_by: String(input.approved_by || input.approvedBy || "").trim(),
    raw_description: input.raw_description !== undefined && input.raw_description !== null
      ? coerceText(input.raw_description)
      : descriptionShape.raw_description,
    description: descriptionShape.description,
    tags,
    shared_by: String(input.shared_by || input.sharedBy || "").trim(),
    notes: String(input.notes || "").trim(),
    review_reason: String(input.review_reason || input.reviewReason || "").trim(),
    confidence: String(input.confidence || "").trim().toLowerCase(),
    trusted: typeof input.trusted === "boolean" ? input.trusted : undefined,
    auto_publish: typeof input.auto_publish === "boolean" ? input.auto_publish : undefined,
    sync_origin: String(input.sync_origin || "").trim()
  };
}

function normalizeSector(value) {
  const text = String(value || "").trim();
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

  return Array.from(seen.values()).sort((a, b) => {
    return Date.parse(b.date_posted) - Date.parse(a.date_posted);
  });
}

function routeSyncedJob(job, source) {
  const routed = normalizeJob({
    ...job,
    source_id: source.id,
    source_type: source.type,
    trusted: Boolean(source.trusted),
    auto_publish: Boolean(source.auto_publish),
    sync_origin: "ats"
  });

  if (source.trusted === true && source.auto_publish === true) {
    return normalizeJob({ ...routed, status: "active" });
  }

  return normalizeJob({ ...routed, status: "pending" });
}

module.exports = {
  dedupeJobs,
  decodeHtmlEntities,
  detectSalaryCurrency,
  detectSalaryPeriod,
  ensureArray,
  isValidDate,
  normalizeDescription,
  normalizeJob,
  normalizeSector,
  parseSalaryRange,
  routeSyncedJob,
  slugify,
  stableHash,
  stripHtml,
  todayIso
};
