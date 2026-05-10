const fs = require("fs/promises");
const path = require("path");
const { buildPublicJobsFromRecords } = require("./public-jobs");
const { CANONICAL_SPECIALIZATIONS, hasUsableDescription } = require("./job-normalizer");
const { buildJobPagePathMap, cleanVisibleText } = require("./job-page-paths");
const { readJobs, readJson, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords, TALENT_PROFILES_FILE, EMPLOYERS_FILE } = require("./public-records");
const { readSourceHealthSnapshot } = require("./source-health-store");
const { hasMalformedDescriptionTemplateSafe } = require("./malformed-description-helper");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");
const VALIDATION_SNAPSHOTS_DIR = path.join(ROOT, "validation-snapshots");
const VALIDATION_LATEST_FILE = path.join(VALIDATION_SNAPSHOTS_DIR, "latest.json");
const CANONICAL_RENDER_TARGETS = [
  path.join(ROOT, "index.html"),
  path.join(ROOT, "scripts", "generate-job-pages.js")
];
const VALID_WORKPLACE_TYPES = new Set(["Remote", "Hybrid", "On-site", ""]);
const BLANK_SNIPPET_THRESHOLD = 0;
const BAD_SNIPPET_PATTERNS = [
  /\bprevious\b/i,
  /\bnext post\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i,
  /<span\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bcareer_page\b/i,
  /\bBusiness\/Productivity Software\b/i
];
const BAD_LOCATION_PATTERNS = [
  /\bTitle Business(?: Platform Location Date)?\b/i,
  /\bPOINT\s*\(/i,
  /\blocality\b/i,
  /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i,
  /\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/i
];
const BAD_PAY_PATTERNS = [
  /^(?:-|—|–|\$-|\$0|0|n\/a|na|not listed|not disclosed|undisclosed)$/i,
  /\$\s*,|\bpay range\s*\$[\s,.-]*\$\s*[,.-]*/i,
  /\$\d{1,3},\s*\.\d{1,2}\s*(?:to|-|–|—)\s*\$\s*[,.\s\d]*/i,
  /\bup to\s*\$[\s,.-]*$/i,
  /\b41\s+147\b/i
];
const BAD_SOLAR_PAY_PATTERN = /\$?\s*50\s*\/?\s*(?:mo|month)\b/i;
const VIDEO_SIGNAL_PATTERN = /\b(?:video|videographer|video editor|video producer|multimedia producer|motion designer|motion graphics|youtube|documentary|short-form video|short form video|digital video|social video|film producer)\b/i;
const RAW_FIELD_USAGE_PATTERNS = [
  /\braw_source_data\b/,
  /\braw_description\b/,
  /\braw_salary\b/
];
const PUBLIC_SOURCE_FILTER_PATTERNS = [
  /<span class="mini-filter-label">\s*Source\s*<\/span>/i,
  /id="filter-source"/i
];
const UNKNOWN_SECTOR_FILTER_PATTERNS = [
  /activeJobs\.map\(\(job\)\s*=>\s*job\.sector\)/,
  /state\.filters\.sector\.has\(job\.sector\)/,
  /buildFilterOption\(groupKey,\s*["']Unknown["']\)/i
];
const COMMUNICATIONS_FILTER_SIGNAL_PATTERNS = [
  /getSpecializationFilterValues/,
  /values\.add\("Communications"\)/,
  /social media/i,
  /digital communications/i,
  /media relations/i,
  /public relations/i,
  /content creator/i
];

function findCassandreTalentRecord(records = []) {
  return records.find((record) => {
    const id = String(record?.id || "").trim().toLowerCase();
    const name = String(record?.name || "").trim().toLowerCase();
    const email = String(record?.email || "").trim().toLowerCase();
    return (
      id === "cassandre-arkema" ||
      name === "cassandre arkema" ||
      email === "cassandre.arkema@gmail.com"
    );
  }) || null;
}

function collectStructuredLocalEditViolations(records = []) {
  const violations = [];
  for (const record of Array.isArray(records) ? records : []) {
    const fieldMeta = record?.field_meta && typeof record.field_meta === "object" ? record.field_meta : {};
    Object.entries(fieldMeta).forEach(([key, meta]) => {
      if (!meta || typeof meta !== "object") return;
      const lastValue = String(meta.last_value || "").trim();
      if (!lastValue) return;
      const currentValue = record?.[key];
      if (isBlankStructuredValue(currentValue)) {
        violations.push({
          id: String(record?.id || ""),
          key,
          last_value: lastValue,
          last_manual_edit_at: String(meta.last_manual_edit_at || "")
        });
      }
    });
  }
  return violations;
}

function isBlankStructuredValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function hasInvalidPublicTitle(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/\b(?:Remote|Hybrid|On-site|Onsite)\b$/.test(text)) return true;
  if (/[!?]/.test(text) || /[A-Za-z]{3,}\.\s+[A-Z]/.test(text) || /\.\.\./.test(text)) return true;
  if (/\b(?:pivoting|click here|read my interview|linkedin|share their stories|want a .* career)\b/i.test(text)) return true;
  if (/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\b/i.test(text)) return true;
  if (/<div|href=|class=|aria-label=|https?:\/\//i.test(text)) return true;
  if (text.split(/\s+/).filter(Boolean).length > 12) return true;
  if ((text.match(/\b(?:Remote|Hybrid|On-site|Onsite)\b/g) || []).length > 1) return true;
  return false;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function extractUrlCompanyHint(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const workableMatch = text.match(/apply\.workable\.com\/([^/]+)\//i);
  if (workableMatch) {
    return workableMatch[1]
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  const greenhouseMatch = text.match(/boards\.greenhouse\.io\/([^/]+)\//i);
  if (greenhouseMatch) {
    return greenhouseMatch[1]
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return "";
}

function normalizeOrganizationIdentity(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (["via", "via science", "via-science"].includes(text)) return "VIA";
  if (text === "resource innovations") return "Resource Innovations";
  if (text === "shifted energy") return "Shifted Energy";
  if (text === "remix") return "Remix";
  return String(value || "").trim();
}

function normalizeIdentityToken(value) {
  return normalizeOrganizationIdentity(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function startsWithLowercaseSentenceFragment(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (!/^[a-z]/.test(text)) return false;
  if (/^(e\.g\.|i\.e\.)/i.test(text)) return false;
  return /^[a-z][^!?]{12,}/.test(text);
}

function descriptionIdentityConflict(organization, description) {
  const normalizedOrganization = normalizeOrganizationIdentity(organization);
  const text = String(description || "");
  if (!normalizedOrganization || !text) return false;
  if (normalizedOrganization === "VIA" && /\bremix\b/i.test(text)) return true;
  if (normalizedOrganization === "Remix" && /\bvia\b/i.test(text)) return true;
  if (normalizedOrganization === "Resource Innovations" && /\bshifted energy\b/i.test(text)) return true;
  if (normalizedOrganization === "Shifted Energy" && /\bresource innovations\b/i.test(text)) return true;
  return false;
}

function isViaRecord(job) {
  return normalizeOrganizationIdentity(job.organization) === "VIA" || /\bvia(?:-science)?\b/i.test([job.apply_url, job.original_url, job.page_url].filter(Boolean).join(" "));
}

function isViaContextConflict(job, pageContents) {
  if (!isViaRecord(job)) return false;
  const normalizedOrganization = normalizeOrganizationIdentity(job.organization);
  if (normalizedOrganization !== "VIA") return true;
  const publicText = [job.organization, job.page_url, job.apply_url, job.original_url, job.description, job.description_snippet, job.summary, pageContents].filter(Boolean).join(" ");
  return /\bremix\b/i.test(publicText);
}

function extractDisplayedCompanyFromPage(contents) {
  const text = String(contents || "");
  if (!text) return "";
  const heroMatch = text.match(/<div style="font-size:1\.05rem; color:var\(--ink-secondary\);">([^<]+)<\/div>/i);
  if (heroMatch && heroMatch[1]) return cleanVisibleText(heroMatch[1]);
  const jsonLdMatch = text.match(/"hiringOrganization":\s*\{\s*"@type":\s*"Organization",\s*"name":\s*"([^"]+)"/i);
  if (jsonLdMatch && jsonLdMatch[1]) return cleanVisibleText(jsonLdMatch[1]);
  const titleMatch = text.match(/<title>[^<]+ at ([^<|]+) \| Fresh Roles<\/title>/i);
  if (titleMatch && titleMatch[1]) return cleanVisibleText(titleMatch[1]);
  return "";
}

function normalizePath(value) {
  return String(value || "").trim();
}

function isValidPayDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (!/\d/.test(text)) return false;
  return !BAD_PAY_PATTERNS.some((pattern) => pattern.test(text));
}

function extractPayFacts(value) {
  const text = String(value || "").trim();
  const amounts = Array.from(text.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    .map((match) => Number(String(match[0]).replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const period =
    /\b(?:per month|\/\s*month|\/\s*mo\b|monthly|month)\b/i.test(text) ? "month"
      : /\b(?:per year|\/\s*year|\/\s*yr\b|annual|annually|year)\b/i.test(text) ? "year"
        : /\b(?:per hour|\/\s*hour|\/\s*hr\b|hourly|hour)\b/i.test(text) ? "hour"
          : /\b(?:per day|\/\s*day|daily|day)\b/i.test(text) ? "day"
            : "unknown";
  const minAmount = amounts.length ? Math.min(...amounts) : null;
  const maxAmount = amounts.length ? Math.max(...amounts) : null;
  const isRange = amounts.length >= 2 && /(?:-|–|—|\bto\b)/i.test(text);
  return {
    text,
    period,
    minAmount,
    maxAmount,
    isRange,
    tinyMonthly: period === "month" && maxAmount !== null && maxAmount < 1000,
    annualLike: period === "year" || (period === "unknown" && maxAmount !== null && maxAmount >= 10000)
  };
}

function isProfessionalFullTimeJob(job = {}) {
  const title = String(job.title || "").trim();
  const roleType = String(job.job_type || job.role_type || "").trim();
  if (!/full[-\s]?time/i.test(roleType)) return false;
  return !/\b(?:intern|internship|fellow|volunteer|part[-\s]?time|contractor|hourly)\b/i.test(title);
}

function isSuspiciousPayDowngrade(currentValue, candidateValue) {
  const current = extractPayFacts(currentValue);
  const candidate = extractPayFacts(candidateValue);
  if (!current.text || !candidate.text) return false;
  return Boolean((current.annualLike || current.isRange) && candidate.tinyMonthly);
}

function hasBadSnippet(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return BAD_SNIPPET_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBadLocation(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return BAD_LOCATION_PATTERNS.some((pattern) => pattern.test(text));
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

async function buildValidationReport(options = {}) {
  const [
    records,
    jobs,
    pending,
    sources,
    pageFiles,
    sourceHealth,
    canonicalRenderFiles,
    talentProfiles,
    employers
  ] = await Promise.all([
    options.records !== undefined ? options.records : readJobRecords(),
    options.jobs !== undefined ? options.jobs : readJobs(),
    options.pending !== undefined ? options.pending : readPendingSyncedJobs(),
    options.sources !== undefined ? options.sources : readSources(),
    options.pageFiles !== undefined ? options.pageFiles : fs.readdir(PAGES_DIR).catch(() => []),
    options.sourceHealth !== undefined ? options.sourceHealth : readSourceHealthSnapshot(),
    options.canonicalRenderFiles !== undefined
      ? options.canonicalRenderFiles
      : Promise.all(
        CANONICAL_RENDER_TARGETS.map(async (filePath) => ({
          filePath,
          contents: await fs.readFile(filePath, "utf8").catch(() => "")
        }))
      ),
    options.talentProfiles !== undefined ? options.talentProfiles : readJson(TALENT_PROFILES_FILE, []),
    options.employers !== undefined ? options.employers : readJson(EMPLOYERS_FILE, [])
  ]);
  const publicJobs = buildPublicJobsFromRecords(records);
  const derivedJobs = jobs.map((job) => ({ ...job }));
  const { map, collisions } = buildJobPagePathMap(derivedJobs);
  const htmlPageFiles = pageFiles.filter((file) => file.endsWith(".html"));
  const pageFileSet = new Set(htmlPageFiles.map((file) => `./pages/${file}`));
  const pageContentsByPath = options.pageContentsByPath instanceof Map
    ? options.pageContentsByPath
    : new Map(
      await Promise.all(
        htmlPageFiles.map(async (file) => {
          const pagePath = `./pages/${file}`;
          const contents = await fs.readFile(path.join(PAGES_DIR, file), "utf8").catch(() => "");
          return [pagePath, contents];
        })
      )
    );
  const expectedById = new Map(publicJobs.map((job) => [String(job.id || ""), job]));
  const jobsById = new Map(jobs.map((job) => [String(job.id || ""), job]));

  const missingPageUrl = [];
  const stalePageUrl = [];
  const brokenLinks = [];
  const invalidPay = [];
  const invalidWorkplace = [];
  const invalidLocation = [];
  const invalidSnippet = [];
  const invalidTitle = [];
  const suspiciousSpecialization = [];
  const videoSpecializationMisses = [];
  const lowConfidenceSpecializations = [];
  const suspiciousGenericSpecializations = [];
  const duplicatePageUrls = [];
  const pageUrlCounts = new Map();
  const duplicateIds = [];
  const missingCanonicalDescription = [];
  const redirectLoops = [];
  const redirectChains = [];
  const orphanedRedirects = [];
  const duplicateRedirects = [];
  const redirectTargets = new Map();
  const jobIdCounts = new Map();
  const canonicalPageSet = new Set();
  const overwriteConflicts = [];
  const canonicalFieldViolations = [];
  const organizationPageUrlConflicts = [];
  const publicRecordOrganizationConflicts = [];
  const suspiciousPayDowngrades = [];
  const suspiciousTinyMonthlyPay = [];
  const malformedDescriptionTemplates = [];
  const lowercaseSentenceDescriptions = [];
  const viaIdentityConflicts = [];
  const publicSourceFilterViolations = [];
  const unknownSectorFilterViolations = [];
  const communicationsFilterViolations = [];
  const talentContactProtectionViolations = [];
  const employerLocalEditViolations = [];
  const talentIconRenderViolations = [];
  const hardValidationFailures = [];

  for (const job of jobs) {
    canonicalPageSet.add(normalizePath(job.page_url));
    const id = String(job.id || "");
    jobIdCounts.set(id, (jobIdCounts.get(id) || 0) + 1);
  }

  for (const record of records) {
    if (!Array.isArray(record.field_conflicts)) continue;
    record.field_conflicts.forEach((conflict) => {
      overwriteConflicts.push({
        id: record.id,
        title: record.display?.title || record.raw_source_data?.title || "",
        organization: record.display?.organization || record.raw_source_data?.organization || "",
        field: String(conflict?.field || ""),
        detected_at: String(conflict?.detected_at || ""),
        reason: String(conflict?.reason || "")
      });
    });
  }

  for (const record of records) {
    if (!record || record.record_type !== "job") continue;
    const publicJob = jobsById.get(String(record.id || ""));
    if (!publicJob) continue;
    const recordOrganization = String(record.display?.organization || record.raw_source_data?.organization || "").trim();
    const recordTitle = String(record.display?.title || record.raw_source_data?.title || "").trim();
    const publicOrganization = String(publicJob.organization || "").trim();
    const publicTitle = String(publicJob.title || "").trim();
    const publicPageSlug = normalizePath(publicJob.page_url).replace(/^\.\/pages\//, "").replace(/\.html$/, "");
    const publicOrgSlug = slugify(publicOrganization);
    const applyUrlHint = extractUrlCompanyHint(publicJob.apply_url || publicJob.original_url || publicJob.source_url);
    const publicPay = String(publicJob.salary || "").trim();
    const recordPay = String(record.display?.pay_display || record.raw_source_data?.salary || "").trim();
    if (
      recordOrganization &&
      publicOrganization &&
      recordOrganization !== publicOrganization &&
      ((applyUrlHint && normalizeIdentityToken(applyUrlHint) === normalizeIdentityToken(publicOrganization)) || (publicOrgSlug && publicPageSlug.includes(publicOrgSlug)))
    ) {
      publicRecordOrganizationConflicts.push({
        id: record.id,
        public_title: publicTitle,
        public_organization: publicOrganization,
        record_title: recordTitle,
        record_organization: recordOrganization,
        page_url: publicJob.page_url,
        apply_url: publicJob.apply_url || publicJob.original_url || publicJob.source_url
      });
    }
    if (isSuspiciousPayDowngrade(publicPay, recordPay)) {
      suspiciousPayDowngrades.push({
        id: record.id,
        title: publicTitle,
        organization: publicOrganization,
        public_pay: publicPay,
        record_pay: recordPay
      });
    }
  }

  canonicalRenderFiles.forEach(({ filePath, contents }) => {
    if (!contents) return;
    RAW_FIELD_USAGE_PATTERNS.forEach((pattern) => {
      if (pattern.test(contents)) {
        canonicalFieldViolations.push({
          file: path.relative(ROOT, filePath),
          pattern: String(pattern)
        });
      }
    });
    if (path.basename(filePath) === "index.html") {
      PUBLIC_SOURCE_FILTER_PATTERNS.forEach((pattern) => {
        if (pattern.test(contents)) {
          publicSourceFilterViolations.push({
            file: path.relative(ROOT, filePath),
            pattern: String(pattern)
          });
        }
      });
      UNKNOWN_SECTOR_FILTER_PATTERNS.forEach((pattern) => {
        if (pattern.test(contents)) {
          unknownSectorFilterViolations.push({
            file: path.relative(ROOT, filePath),
            pattern: String(pattern)
          });
        }
      });
      COMMUNICATIONS_FILTER_SIGNAL_PATTERNS.forEach((pattern) => {
        if (!pattern.test(contents)) {
          communicationsFilterViolations.push({
            file: path.relative(ROOT, filePath),
            pattern: String(pattern)
          });
        }
      });
      if (
        !/iconClass:\s*"briefcase"/.test(contents) ||
        !/iconSvg\("linkedin"\)/.test(contents) ||
        !/iconClass:\s*"email"/.test(contents) ||
        !/links\.publicContact\s*&&\s*links\.email/.test(contents) ||
        !/clickType:\s*"email"/.test(contents)
      ) {
        talentIconRenderViolations.push({
          file: path.relative(ROOT, filePath),
          reason: "talent_contact_icons_missing"
        });
      }
    }
  });

  const cassandreTalent = findCassandreTalentRecord(talentProfiles);
  if (!cassandreTalent) {
    talentContactProtectionViolations.push({
      id: "cassandre-arkema",
      reason: "talent_record_missing"
    });
    hardValidationFailures.push({
      id: "cassandre-arkema",
      title: "Cassandre Arkema",
      organization: "",
      reason: "talent_record_missing"
    });
  } else {
    const expectedContacts = {
      portfolio_url: "https://thealgorithmwitch.com/grimoire",
      linkedin_url: "https://linkedin.com/in/cassandrearkema",
      email: "cassandre.arkema@gmail.com"
    };
    Object.entries(expectedContacts).forEach(([key, expectedValue]) => {
      if (String(cassandreTalent[key] || "").trim() !== expectedValue) {
        talentContactProtectionViolations.push({
          id: String(cassandreTalent.id || "cassandre-arkema"),
          key,
          expected: expectedValue,
          actual: String(cassandreTalent[key] || "")
        });
        hardValidationFailures.push({
          id: String(cassandreTalent.id || "cassandre-arkema"),
          title: String(cassandreTalent.name || "Cassandre Arkema"),
          organization: "",
          reason: `talent_contact_${key}_missing`
        });
      }
    });
    if (!cassandreTalent.public_contact) {
      talentContactProtectionViolations.push({
        id: String(cassandreTalent.id || "cassandre-arkema"),
        key: "public_contact",
        expected: true,
        actual: Boolean(cassandreTalent.public_contact)
      });
      hardValidationFailures.push({
        id: String(cassandreTalent.id || "cassandre-arkema"),
        title: String(cassandreTalent.name || "Cassandre Arkema"),
        organization: "",
        reason: "talent_public_contact_disabled"
      });
    }
  }

  talentContactProtectionViolations.push(
    ...collectStructuredLocalEditViolations(talentProfiles).map((item) => ({
      ...item,
      type: "talent"
    }))
  );
  employerLocalEditViolations.push(
    ...collectStructuredLocalEditViolations(employers).map((item) => ({
      ...item,
      type: "employer"
    }))
  );
  if (talentContactProtectionViolations.some((item) => item.type === "talent")) {
    hardValidationFailures.push({
      id: "talent-local-edits",
      title: "Talent local edits",
      organization: "",
      reason: "talent_local_edit_blank_detected"
    });
  }
  if (employerLocalEditViolations.length) {
    hardValidationFailures.push({
      id: "employer-local-edits",
      title: "Employer local edits",
      organization: "",
      reason: "employer_local_edit_blank_detected"
    });
  }

  for (const job of jobs) {
    const id = String(job.id || "");
    const expectedPath = map.get(id) || "";
    const pageUrl = normalizePath(job.page_url);
    const snippet = String(job.description_snippet || job.summary || "").trim();
    const payDisplay = String(job.salary || "").trim();
    const workplaceType = String(job.workplace_type || "").trim();
    const specialization = String(job.specialization || "").trim();
    const specializationConfidence = String(job.specialization_confidence || "low").trim().toLowerCase();
    const location = String(job.location || "").trim();
    const textForVideo = [job.title, job.description, job.description_snippet, job.function, specialization].filter(Boolean).join(" ");
    const canonicalDescription = String(job.description || "").trim();
    const redirectPaths = Array.isArray(job.redirect_paths) ? job.redirect_paths.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const organizationSlug = slugify(job.organization);
    const pageUrlSlug = normalizePath(pageUrl).replace(/^\.\/pages\//, "").replace(/\.html$/, "");
    const applyUrlHint = extractUrlCompanyHint(job.apply_url || job.original_url || job.source_url);
    const pageContents = pageContentsByPath.get(pageUrl) || "";
    const pageCompany = extractDisplayedCompanyFromPage(pageContents);
    const elementalPublicText = JSON.stringify({
      title: job.title,
      organization: job.organization,
      page_url: job.page_url,
      apply_url: job.apply_url,
      original_url: job.original_url,
      description: job.description,
      description_snippet: job.description_snippet,
      summary: job.summary
    });
    const malformedDescription =
      hasMalformedDescriptionTemplateSafe(canonicalDescription) ||
      hasMalformedDescriptionTemplateSafe(snippet) ||
      hasMalformedDescriptionTemplateSafe(String(job.summary || ""));
    const malformedPageDescription = pageContents && hasMalformedDescriptionTemplateSafe(pageContents);
    const lowercaseSentenceDescription =
      startsWithLowercaseSentenceFragment(canonicalDescription) ||
      startsWithLowercaseSentenceFragment(snippet) ||
      startsWithLowercaseSentenceFragment(String(job.summary || ""));

    if (!pageUrl) {
      missingPageUrl.push({ id, title: job.title, organization: job.organization });
    } else {
      pageUrlCounts.set(pageUrl, (pageUrlCounts.get(pageUrl) || 0) + 1);
      if (expectedPath && pageUrl !== expectedPath) {
        stalePageUrl.push({ id, title: job.title, organization: job.organization, page_url: pageUrl, expected_page_url: expectedPath });
      }
      if (options.requirePages !== false && !pageFileSet.has(pageUrl)) {
        brokenLinks.push({ id, title: job.title, organization: job.organization, page_url: pageUrl });
      }
      if (organizationSlug && pageUrlSlug && !pageUrlSlug.includes(organizationSlug)) {
        organizationPageUrlConflicts.push({
          id,
          title: job.title,
          organization: job.organization,
          page_url: pageUrl,
          expected_org_slug: organizationSlug
        });
      }
    }

    if (applyUrlHint && normalizeIdentityToken(applyUrlHint) !== normalizeIdentityToken(job.organization || "")) {
      organizationPageUrlConflicts.push({
        id,
        title: job.title,
        organization: job.organization,
        apply_url: job.apply_url || job.original_url || job.source_url,
        expected_company_from_url: applyUrlHint
      });
    }

    if (!isValidPayDisplay(payDisplay)) {
      invalidPay.push({ id, title: job.title, organization: job.organization, salary: payDisplay });
      if (/\b41\s+147\b|\b\d{1,3}\s+\d{3}\b/.test(payDisplay)) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "malformed_public_pay"
        });
      }
    }
    if (hasInvalidPublicTitle(job.title) || String(job.title_confidence || "").trim().toLowerCase() === "low") {
      invalidTitle.push({ id, title: job.title, organization: job.organization, title_confidence: job.title_confidence || "" });
      hardValidationFailures.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "invalid_public_title"
      });
    }
    if (isProfessionalFullTimeJob(job) && extractPayFacts(payDisplay).tinyMonthly) {
      suspiciousTinyMonthlyPay.push({ id, title: job.title, organization: job.organization, salary: payDisplay });
    }
    if (id === "solar-united-neighbors-5dd5c717f705") {
      const solarPublicText = JSON.stringify({
        salary: job.salary,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        salary_period: job.salary_period,
        description_snippet: job.description_snippet,
        summary: job.summary
      });
      if (BAD_SOLAR_PAY_PATTERN.test(solarPublicText) || /50\/month/i.test(solarPublicText)) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "solar_pay_corruption"
        });
      }
    }
    if (id === "elemental-impact-446c301b54b2") {
      if (String(job.organization || "").trim() !== "Resource Innovations" || String(job.page_url || "").trim() !== "./pages/senior-software-engineer-resource-innovations.html") {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "resource_innovations_identity_corruption"
        });
      }
    }
    if (String(job.source_id || "").trim() === "elemental-impact") {
      const hasResourceInnovations = /resource innovations/i.test(elementalPublicText);
      const hasShiftedEnergy = /shifted energy/i.test(elementalPublicText);
      if (hasResourceInnovations && hasShiftedEnergy) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "elemental_company_cross_contamination"
        });
      }
      if (String(job.organization || "").trim() === "Resource Innovations" && hasShiftedEnergy) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "resource_innovations_contains_shifted_energy"
        });
      }
      if (String(job.organization || "").trim() === "Shifted Energy" && hasResourceInnovations) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "shifted_energy_contains_resource_innovations"
        });
      }
      if (organizationSlug && pageUrlSlug && !pageUrlSlug.includes(organizationSlug)) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "elemental_page_url_company_slug_conflict"
        });
      }
      if (
        applyUrlHint &&
        normalizeIdentityToken(applyUrlHint) !== normalizeIdentityToken(job.organization || "") &&
        /^(Resource Innovations|Shifted Energy)$/i.test(String(job.organization || "").trim())
      ) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "elemental_apply_context_company_conflict"
        });
      }
      if (pageCompany && pageCompany !== String(job.organization || "").trim()) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "elemental_detail_page_company_mismatch"
        });
      }
      if (pageContents && /resource innovations/i.test(pageContents) && /shifted energy/i.test(pageContents)) {
        hardValidationFailures.push({
          id,
          title: job.title,
          organization: job.organization,
          reason: "elemental_detail_page_cross_contamination"
        });
      }
    }
    if (lowercaseSentenceDescription) {
      lowercaseSentenceDescriptions.push({
        id,
        title: job.title,
        organization: job.organization,
        page_url: pageUrl,
        description: canonicalDescription,
        description_snippet: snippet
      });
      hardValidationFailures.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "lowercase_sentence_description"
      });
    }
    if (descriptionIdentityConflict(job.organization, canonicalDescription) || descriptionIdentityConflict(job.organization, snippet)) {
      viaIdentityConflicts.push({
        id,
        title: job.title,
        organization: job.organization,
        page_url: pageUrl,
        apply_url: job.apply_url || job.original_url || job.source_url
      });
      hardValidationFailures.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "description_identity_conflict"
      });
    }
    if (isViaContextConflict(job, pageContents)) {
      viaIdentityConflicts.push({
        id,
        title: job.title,
        organization: job.organization,
        page_url: pageUrl,
        apply_url: job.apply_url || job.original_url || job.source_url
      });
      hardValidationFailures.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "via_public_identity_conflict"
      });
    }
    if (!VALID_WORKPLACE_TYPES.has(workplaceType)) {
      invalidWorkplace.push({ id, title: job.title, organization: job.organization, workplace_type: workplaceType });
    }
    if (hasBadLocation(location)) {
      invalidLocation.push({ id, title: job.title, organization: job.organization, location });
    }
    if (((!snippet && hasUsableDescription(job.description || "", { title: job.title })) || hasBadSnippet(snippet))) {
      invalidSnippet.push({ id, title: job.title, organization: job.organization, description_snippet: snippet });
    }
    if (malformedDescription || malformedPageDescription) {
      malformedDescriptionTemplates.push({
        id,
        title: job.title,
        organization: job.organization,
        page_url: pageUrl,
        description: canonicalDescription,
        description_snippet: snippet
      });
      hardValidationFailures.push({
        id,
        title: job.title,
        organization: job.organization,
        reason: "malformed_description_template"
      });
    }
    if (!hasUsableDescription(canonicalDescription, { title: job.title })) {
      missingCanonicalDescription.push({ id, title: job.title, organization: job.organization });
    }
    if (!specialization || !CANONICAL_SPECIALIZATIONS.includes(specialization)) {
      suspiciousSpecialization.push({ id, title: job.title, organization: job.organization, specialization });
    }
    if (specialization && specializationConfidence === "low") {
      lowConfidenceSpecializations.push({ id, title: job.title, organization: job.organization, specialization, specialization_confidence: specializationConfidence });
    }
    if (["strategy", "sales", "operations", "programs", "admin"].includes(specialization.toLowerCase()) && specializationConfidence !== "high") {
      suspiciousGenericSpecializations.push({ id, title: job.title, organization: job.organization, specialization, specialization_confidence: specializationConfidence });
    }
    if (VIDEO_SIGNAL_PATTERN.test(textForVideo) && specialization !== "Video") {
      videoSpecializationMisses.push({ id, title: job.title, organization: job.organization, specialization });
    }
    if (!expectedById.has(id)) {
      suspiciousSpecialization.push({ id, title: job.title, organization: job.organization, specialization, note: "job_missing_from_published_records" });
    }
    redirectPaths.forEach((redirectPath) => {
      const normalizedRedirectPath = normalizePath(redirectPath);
      if (!normalizedRedirectPath) return;
      redirectTargets.set(normalizedRedirectPath, normalizePath(pageUrl));
      if (normalizedRedirectPath === pageUrl) {
        redirectLoops.push({ id, title: job.title, redirect_path: normalizedRedirectPath, page_url: pageUrl });
      }
      if (!pageFileSet.has(normalizedRedirectPath) && options.requirePages !== false) {
        orphanedRedirects.push({ id, title: job.title, redirect_path: normalizedRedirectPath, page_url: pageUrl });
      }
    });
  }

  for (const [pageUrl, count] of pageUrlCounts.entries()) {
    if (count > 1) duplicatePageUrls.push({ page_url: pageUrl, count });
  }
  for (const [id, count] of jobIdCounts.entries()) {
    if (count > 1) duplicateIds.push({ id, count });
  }
  for (const [redirectPath, targetPath] of redirectTargets.entries()) {
    if (redirectTargets.has(targetPath)) {
      redirectChains.push({ redirect_path: redirectPath, target_path: targetPath, next_target: redirectTargets.get(targetPath) });
    }
    const collisionsForRedirect = jobs.filter((job) => Array.isArray(job.redirect_paths) && job.redirect_paths.includes(redirectPath));
    if (collisionsForRedirect.length > 1) {
      duplicateRedirects.push({
        redirect_path: redirectPath,
        targets: collisionsForRedirect.map((job) => job.page_url)
      });
    }
  }

  const publicRecordsCount = publicJobs.length;
  const jobsJsonCount = jobs.length;
  const redirectPageCount = redirectTargets.size;
  const generatedPageCount = Array.from(canonicalPageSet).filter((pageUrl) => pageUrl && pageFileSet.has(pageUrl)).length;
  const indexCardCount = jobs.length;
  const pendingPublicOverlapCount = pending.filter((job) => expectedById.has(String(job.id || ""))).length;
  const climateChangeJobsSource = sources.find((source) => String(source.id || "") === "climatechangejobs") || null;
  const climateChangeJobsPending = pending.filter((job) => /climatechangejobs/i.test([job.source_id, job.source, job.source_url].filter(Boolean).join(" ")));
  const specializationCounts = countBy(
    jobs.map((job) => String(job.specialization || "").trim() || "(blank)"),
    (value) => value
  );

  const errors = [];
  if (publicRecordsCount !== jobsJsonCount) errors.push(`jobs.json count ${jobsJsonCount} does not match published record count ${publicRecordsCount}`);
  if (missingPageUrl.length) errors.push(`missing page_url count ${missingPageUrl.length}`);
  if (stalePageUrl.length) errors.push(`stale page_url count ${stalePageUrl.length}`);
  if (duplicatePageUrls.length) errors.push(`duplicate page_url count ${duplicatePageUrls.length}`);
  if (duplicateIds.length) errors.push(`duplicate canonical id count ${duplicateIds.length}`);
  if (options.requirePages !== false && generatedPageCount < jobsJsonCount) errors.push(`generated page count ${generatedPageCount} is less than jobs.json count ${jobsJsonCount}`);
  if (brokenLinks.length) errors.push(`broken link count ${brokenLinks.length}`);
  if (invalidPay.length) errors.push(`invalid pay count ${invalidPay.length}`);
  if (invalidTitle.length) errors.push(`invalid title count ${invalidTitle.length}`);
  if (malformedDescriptionTemplates.length) errors.push(`malformed description template count ${malformedDescriptionTemplates.length}`);
  if (lowercaseSentenceDescriptions.length) errors.push(`lowercase sentence description count ${lowercaseSentenceDescriptions.length}`);
  if (invalidWorkplace.length) errors.push(`invalid workplace_type count ${invalidWorkplace.length}`);
  if (invalidLocation.length) errors.push(`invalid location count ${invalidLocation.length}`);
  if (invalidSnippet.length > BLANK_SNIPPET_THRESHOLD) errors.push(`invalid snippet count ${invalidSnippet.length}`);
  if (missingCanonicalDescription.length) errors.push(`missing canonical description count ${missingCanonicalDescription.length}`);
  if (redirectLoops.length) errors.push(`redirect loop count ${redirectLoops.length}`);
  if (canonicalFieldViolations.length) errors.push(`canonical field architecture violation count ${canonicalFieldViolations.length}`);
  if (publicSourceFilterViolations.length) errors.push(`public source filter violation count ${publicSourceFilterViolations.length}`);
  if (unknownSectorFilterViolations.length) errors.push(`unknown sector filter violation count ${unknownSectorFilterViolations.length}`);
  if (communicationsFilterViolations.length) errors.push(`communications filter signal violation count ${communicationsFilterViolations.length}`);
  if (organizationPageUrlConflicts.length) errors.push(`organization/page_url mismatch count ${organizationPageUrlConflicts.length}`);
  if (publicRecordOrganizationConflicts.length) errors.push(`public-vs-record organization mismatch count ${publicRecordOrganizationConflicts.length}`);
  if (viaIdentityConflicts.length) errors.push(`via identity conflict count ${viaIdentityConflicts.length}`);
  if (suspiciousPayDowngrades.length) errors.push(`suspicious pay downgrade count ${suspiciousPayDowngrades.length}`);
  if (suspiciousTinyMonthlyPay.length) errors.push(`suspicious tiny monthly pay count ${suspiciousTinyMonthlyPay.length}`);
  if (talentContactProtectionViolations.length) errors.push(`talent contact protection violation count ${talentContactProtectionViolations.length}`);
  if (employerLocalEditViolations.length) errors.push(`employer local edit violation count ${employerLocalEditViolations.length}`);
  if (talentIconRenderViolations.length) errors.push(`talent icon render violation count ${talentIconRenderViolations.length}`);
  if (hardValidationFailures.length) errors.push(`hard validation failure count ${hardValidationFailures.length}`);

  return {
    public_records_count: publicRecordsCount,
    jobs_json_count: jobsJsonCount,
    generated_page_count: generatedPageCount,
    redirect_page_count: redirectPageCount,
    index_card_count: indexCardCount,
    missing_page_url_count: missingPageUrl.length,
    stale_page_url_count: stalePageUrl.length,
    duplicate_slug_count: collisions.length + duplicatePageUrls.length,
    duplicate_page_url_count: duplicatePageUrls.length,
    duplicate_canonical_id_count: duplicateIds.length,
    broken_link_count: brokenLinks.length,
    invalid_title_count: invalidTitle.length,
    malformed_description_template_count: malformedDescriptionTemplates.length,
    lowercase_sentence_description_count: lowercaseSentenceDescriptions.length,
    pending_public_overlap_count: pendingPublicOverlapCount,
    invalid_snippet_count: invalidSnippet.length,
    missing_canonical_description_count: missingCanonicalDescription.length,
    redirect_chain_count: redirectChains.length,
    duplicate_redirect_count: duplicateRedirects.length,
    orphaned_redirect_count: orphanedRedirects.length,
    redirect_loop_count: redirectLoops.length,
    specialization_distribution: specializationCounts,
    suspicious_unmapped_specialization_count: suspiciousSpecialization.length,
    low_confidence_specialization_count: lowConfidenceSpecializations.length,
    suspicious_generic_specialization_count: suspiciousGenericSpecializations.length,
    video_specialization_detection_miss_count: videoSpecializationMisses.length,
    overwrite_conflict_count: overwriteConflicts.length,
    canonical_field_violation_count: canonicalFieldViolations.length,
    public_source_filter_violation_count: publicSourceFilterViolations.length,
    unknown_sector_filter_violation_count: unknownSectorFilterViolations.length,
    communications_filter_violation_count: communicationsFilterViolations.length,
    organization_page_url_conflict_count: organizationPageUrlConflicts.length,
    public_record_organization_conflict_count: publicRecordOrganizationConflicts.length,
    via_identity_conflict_count: viaIdentityConflicts.length,
    suspicious_pay_downgrade_count: suspiciousPayDowngrades.length,
    suspicious_tiny_monthly_pay_count: suspiciousTinyMonthlyPay.length,
    talent_contact_protection_violation_count: talentContactProtectionViolations.length,
    employer_local_edit_violation_count: employerLocalEditViolations.length,
    talent_icon_render_violation_count: talentIconRenderViolations.length,
    hard_validation_failure_count: hardValidationFailures.length,
    climatechangejobs_source_enabled: Boolean(climateChangeJobsSource && climateChangeJobsSource.enabled !== false),
    climatechangejobs_source_custom_sync_enabled: Boolean(climateChangeJobsSource && climateChangeJobsSource.custom_sync_enabled !== false),
    climatechangejobs_pending_count: climateChangeJobsPending.length,
    source_health: sourceHealth,
    errors,
    samples: {
      missing_page_url: missingPageUrl.slice(0, 10),
      stale_page_url: stalePageUrl.slice(0, 10),
      duplicate_page_url: duplicatePageUrls.slice(0, 10),
      broken_link: brokenLinks.slice(0, 10),
      invalid_pay: invalidPay.slice(0, 10),
      invalid_title: invalidTitle.slice(0, 20),
      malformed_description_templates: malformedDescriptionTemplates.slice(0, 20),
      lowercase_sentence_descriptions: lowercaseSentenceDescriptions.slice(0, 20),
      invalid_workplace_type: invalidWorkplace.slice(0, 10),
      invalid_location: invalidLocation.slice(0, 10),
      invalid_snippet: invalidSnippet.slice(0, 10),
      missing_canonical_description: missingCanonicalDescription.slice(0, 10),
      duplicate_canonical_id: duplicateIds.slice(0, 10),
      redirect_chains: redirectChains.slice(0, 10),
      duplicate_redirects: duplicateRedirects.slice(0, 10),
      orphaned_redirects: orphanedRedirects.slice(0, 10),
      redirect_loops: redirectLoops.slice(0, 10),
      overwrite_conflicts: overwriteConflicts.slice(0, 20),
      canonical_field_violations: canonicalFieldViolations.slice(0, 20),
      public_source_filter_violations: publicSourceFilterViolations.slice(0, 20),
      unknown_sector_filter_violations: unknownSectorFilterViolations.slice(0, 20),
      communications_filter_violations: communicationsFilterViolations.slice(0, 20),
      organization_page_url_conflicts: organizationPageUrlConflicts.slice(0, 20),
      public_record_organization_conflicts: publicRecordOrganizationConflicts.slice(0, 20),
      via_identity_conflicts: viaIdentityConflicts.slice(0, 20),
      suspicious_pay_downgrades: suspiciousPayDowngrades.slice(0, 20),
      suspicious_tiny_monthly_pay: suspiciousTinyMonthlyPay.slice(0, 20),
      talent_contact_protection_violations: talentContactProtectionViolations.slice(0, 20),
      employer_local_edit_violations: employerLocalEditViolations.slice(0, 20),
      talent_icon_render_violations: talentIconRenderViolations.slice(0, 20),
      hard_validation_failures: hardValidationFailures.slice(0, 20),
      suspicious_specialization: suspiciousSpecialization.slice(0, 20),
      low_confidence_specialization: lowConfidenceSpecializations.slice(0, 20),
      suspicious_generic_specialization: suspiciousGenericSpecializations.slice(0, 20),
      video_specialization_miss: videoSpecializationMisses.slice(0, 20),
      climatechangejobs_pending: climateChangeJobsPending.slice(0, 10).map((job) => ({
        id: job.id,
        title: job.title,
        organization: job.organization,
        source_id: job.source_id,
        triage_bucket: job.triage_bucket,
        triage_reason: job.triage_reason
      }))
    }
  };
}

async function persistValidationSnapshot(report) {
  await fs.mkdir(VALIDATION_SNAPSHOTS_DIR, { recursive: true });
  let previous = null;
  try {
    previous = JSON.parse(await fs.readFile(VALIDATION_LATEST_FILE, "utf8"));
  } catch (_error) {
    previous = null;
  }
  const regressions = [];
  const regressionChecks = [
    ["broken_link_count", "broken links increased"],
    ["suspicious_unmapped_specialization_count", "specialization blanks increased"],
    ["pending_public_overlap_count", "pending/public overlap increased"],
    ["invalid_snippet_count", "malformed snippets increased"]
  ];
  const current = {
    generated_at: new Date().toISOString(),
    public_records_count: report.public_records_count,
    jobs_json_count: report.jobs_json_count,
    generated_page_count: report.generated_page_count,
    broken_link_count: report.broken_link_count,
    suspicious_unmapped_specialization_count: report.suspicious_unmapped_specialization_count,
    pending_public_overlap_count: report.pending_public_overlap_count,
    invalid_snippet_count: report.invalid_snippet_count,
    overwrite_conflict_count: report.overwrite_conflict_count,
    canonical_field_violation_count: report.canonical_field_violation_count,
    report
  };
  if (previous) {
    regressionChecks.forEach(([key, label]) => {
      if (Number(current[key] || 0) > Number(previous[key] || 0)) {
        regressions.push(label);
      }
    });
    if (current.generated_page_count !== current.jobs_json_count) {
      regressions.push("page count drift detected");
    }
    if (
      Number(current.generated_page_count || 0) !== Number(previous.generated_page_count || 0) ||
      Number(current.jobs_json_count || 0) !== Number(previous.jobs_json_count || 0)
    ) {
      regressions.push("page count drift changed from previous snapshot");
    }
  }
  current.regressions = regressions;
  const timestampedFile = path.join(VALIDATION_SNAPSHOTS_DIR, `${current.generated_at.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(VALIDATION_LATEST_FILE, JSON.stringify(current, null, 2) + "\n", "utf8");
  await fs.writeFile(timestampedFile, JSON.stringify(current, null, 2) + "\n", "utf8");
  return current;
}

async function main() {
  const requirePages = !process.argv.includes("--pre-pages");
  const report = await buildValidationReport({ requirePages });
  const snapshot = await persistValidationSnapshot(report);
  console.log(JSON.stringify({
    ...report,
    validation_snapshot_regressions: snapshot.regressions
  }, null, 2));
  if (report.errors.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:validate-public-data] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildValidationReport,
  hasInvalidPublicTitle,
  isValidPayDisplay,
  persistValidationSnapshot
};
