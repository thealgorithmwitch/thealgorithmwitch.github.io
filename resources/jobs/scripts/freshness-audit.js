const fs = require("fs/promises");
const path = require("path");
const { readJobs, readPendingSyncedJobs, writeJsonIfChanged } = require("./job-utils");
const { buildJobRecord, JOB_RECORDS_FILE, readJobRecords } = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const { filterBlockedSourceEntries, getBlockedSourceRuleForEntry } = require("./blocked-source-utils");
const {
  assessPublicJobReadiness,
  hasUsableDescription,
  normalizeWorkableUrl,
  normalizeJob,
  normalizePayDisplay,
  stringifySafe
} = require("./job-normalizer");
const {
  applyFreshnessMetadata,
  computeStaleScore,
  extendVerification,
  markNeedsReview,
  markRemoved,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
} = require("./lifecycle-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "freshness-audit-latest.json");
const RISKY_REPORT_JSON_FILE = path.join(ROOT, "reports", "freshness-audit-risky-changes.json");
const RISKY_REPORT_MD_FILE = path.join(ROOT, "reports", "freshness-audit-risky-changes.md");
const PENDING_SYNCED_FILE = path.join(ROOT, "pending-synced-jobs.json");
const STALE_DAYS = 3;
const STALE_ARCHIVE_DAYS = 21;
const REQUEST_TIMEOUT_MS = 15000;
const FETCH_CONCURRENCY = 5;
const USER_AGENT = "AlgorithmWitchJobsFreshnessAudit/1.0 (+https://github.com/actions)";
const DEAD_STATUS_CODES = new Set([404, 410, 451]);
const ACCESS_DENIED_STATUS_CODES = new Set([401, 403]);
const DEAD_TEXT_PATTERNS = [
  /\bjob is no longer available\b/i,
  /\bno longer accepting applications\b/i,
  /\bposition has been filled\b/i,
  /\bposting has expired\b/i,
  /\bthis job has closed\b/i,
  /\bposition is closed\b/i,
  /\brole is closed\b/i,
  /\brole has been closed\b/i,
  /\bapplications? closed\b/i,
  /\bnew applications are no longer being accepted\b/i,
  /\b404\b/i,
  /\bpage not found\b/i,
  /\bthe page you are looking for does not exist\b/i,
  /\bpage may have moved\b/i,
  /\bnot found\b(?:\s|$)/i,
  /\bthere\s+are\s+no\s+current\s+openings?\b/i,
  /\bthere\s+are\s+currently\s+no\s+open\s+positions?\b/i,
  /\bposition\s+is\s+no\s+longer\s+available\b/i
];
const REDIRECT_TO_BOARD_EXPIRED_PATTERNS = [
  /\bcreate\s+a\s+job\s+alert\b/i,
  /\bno\s+current\s+openings?\b/i,
  /\bno\s+open\s+positions?\b/i,
  /\bthis\s+job\s+is\s+no\s+longer\s+available\b/i,
  /\bjob\s+not\s+found\b/i
];
const ACCESS_DENIED_TEXT_PATTERNS = [
  /\baccess denied\b/i,
  /\baccess forbidden\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\blogin required\b/i,
  /\bcandidate login\b/i,
  /\byou do not have permission\b/i,
  /\bnot authorized\b/i
];
const FEED_TEXT_PATTERNS = [
  /^\s*[\[{]/,
  /<\?xml\b/i,
  /<rss\b/i,
  /<feed\b/i,
  /<svg\b/i,
  /\bviewBox\b/i,
  /\b0\/svg\b/i
];
const APPLY_TEXT_PATTERN = /\b(?:apply|apply now|submit application|start application|continue application)\b/i;
const LOCATION_LABEL_PATTERN = /\b(?:location|job location)\b[:\s-]+([^\n|]{2,120})/i;
const UNCERTAIN_PAGE_TITLE_PATTERNS = [
  /^login\s*$/i, /^login\s+page\s*$/i, /^sign\s+in\s*$/i, /^candidate\s+login\s*$/i,
  /^search\s*$/i, /^new\s+search\s*$/i,
  /^benefits?\s*$/i, /^view\s+our\s+benefits?\s*$/i,
  /^procurement\s*$/i, /^procurement\s+opportunities?\s*$/i,
  /^contact\s+us\s*$/i, /^proposal\s+request\s*$/i,
  /^browse\s+job\s+listings?\s*$/i,
  /navigation/i, /footer/i, /header/i
];
const UNCERTAIN_PAGE_URL_PATTERNS = [
  /candidatelogin/i, /benefits/i, /procurement/i,
  /contact-us/i, /proposal-request/i,
  /(?:\/|\?)search(?:$|[?#])/i,
  /careers\/(?:faq|why-work|life-at|join-our-team)(?:\/|$)/i
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--write"),
    write: argv.includes("--write")
  };
}

function nowIso() {
  return new Date().toISOString();
}

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function cleanText(value) {
  return stringifySafe(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsJunk(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  const junkMarkers = [
    "previous",
    "next post",
    "see current openings",
    "viewbox",
    "0/svg",
    "<svg",
    "</svg",
    "<span",
    "point(",
    "locality",
    "title business platform location date",
    "e\" \" \"",
    "raw_json",
    "greenhouse_board",
    "lever",
    "ashby",
    "workable"
  ];
  return junkMarkers.some((marker) => text.includes(marker));
}

function isValidPageUrl(value) {
  const text = normalizeText(value);
  if (!text || containsJunk(text)) return false;
  return /^(\.\/)?pages\/[^\\\s]+\.html(?:[?#].*)?$/i.test(text) || /^https?:\/\//i.test(text) || text.startsWith("./");
}

function isRiskyReplacement(field, currentValue, proposedValue) {
  const current = normalizeText(currentValue);
  const proposed = normalizeText(proposedValue);
  if (!current && proposed && !containsJunk(proposed)) return false;
  if (current && !proposed) return true;
  if (proposed && containsJunk(proposed)) return true;
  if (field === "salary" || field === "pay" || field === "display_pay" || field === "pay_display") {
    if (current && !proposed) return true;
    if (proposed === "$0" || proposed === "-" || proposed === "$ , - $ , usd") return true;
  }
  if (field === "salary_currency" || field === "salary_period") {
    if (current && (!proposed || proposed.toLowerCase() === "unknown")) return true;
  }
  if (field === "salary_visible") {
    if (current && (!proposed || proposed.toLowerCase() === "false")) return true;
  }
  if ((field === "description" || field === "snippet" || field === "description_snippet" || field === "summary") && current) {
    if (!proposed) return true;
    if (containsJunk(proposed)) return true;
    if (proposed.length < 80 && current.length > proposed.length * 2) return true;
  }
  if ((field === "location" || field === "workplace_type" || field === "specialization" || field === "sector") && current && !proposed) {
    return true;
  }
  if (field === "page_url" || field === "page_url_override") {
    if (current && (!proposed || !isValidPageUrl(proposed))) return true;
  }
  return false;
}

function getCurrentSafeValue(currentJob, field) {
  if (field === "description_snippet") {
    return currentJob.description_snippet || currentJob.summary || "";
  }
  if (field === "summary") {
    return currentJob.summary || currentJob.description_snippet || "";
  }
  if (field === "salary") {
    return currentJob.salary || currentJob.pay_display || "";
  }
  if (field === "salary_visible") {
    return currentJob.salary || currentJob.pay_display ? true : currentJob.salary_visible;
  }
  if (field === "apply_url" || field === "application_url") {
    return currentJob.apply_url || currentJob.application_url || "";
  }
  if (field === "source_url") {
    return currentJob.source_url || "";
  }
  if (field === "original_url") {
    return currentJob.original_url || "";
  }
  if (field === "page_url_override") {
    return currentJob.page_url_override || "";
  }
  return currentJob[field];
}

function maybeAssignSafe(currentJob, targetJob, field, proposedValue, context = {}, riskyChanges = []) {
  const currentValue = getCurrentSafeValue(currentJob, field);
  if (isRiskyReplacement(field, currentValue, proposedValue)) {
    targetJob[field] = currentValue;
    riskyChanges.push({
      id: context.id || currentJob.id || currentJob.slug || null,
      title: context.title || currentJob.title || "",
      organization: context.organization || currentJob.organization || currentJob.company || "",
      field,
      current: currentValue || "",
      proposed: proposedValue || "",
      reason: "risky_or_destructive_replacement",
      ...context
    });
    return false;
  }
  const current = normalizeText(currentValue);
  const proposed = normalizeText(proposedValue);
  if (current === proposed) return false;
  if (!proposed) return false;
  targetJob[field] = proposedValue;
  return true;
}

function mergeSafePublicJob(currentJob = {}, proposedJob = {}, context = {}) {
  const safeJob = { ...proposedJob };
  const riskyChanges = [];
  const fieldPairs = [
    ["description", proposedJob.description],
    ["raw_description", proposedJob.raw_description || proposedJob.description],
    ["description_snippet", proposedJob.description_snippet || proposedJob.summary],
    ["summary", proposedJob.summary || proposedJob.description_snippet],
    ["salary", proposedJob.salary],
    ["salary_min", proposedJob.salary_min],
    ["salary_max", proposedJob.salary_max],
    ["salary_currency", proposedJob.salary_currency],
    ["salary_period", proposedJob.salary_period],
    ["salary_visible", proposedJob.salary_visible],
    ["location", proposedJob.location],
    ["workplace_type", proposedJob.workplace_type],
    ["specialization", proposedJob.specialization],
    ["sector", proposedJob.sector],
    ["apply_url", proposedJob.apply_url],
    ["source_url", proposedJob.source_url],
    ["original_url", proposedJob.original_url],
    ["page_url_override", proposedJob.page_url_override]
  ];

  for (const [field, proposedValue] of fieldPairs) {
    maybeAssignSafe(currentJob, safeJob, field, proposedValue, context, riskyChanges);
  }

  if (safeJob.description && !safeJob.raw_description) {
    safeJob.raw_description = safeJob.description;
  }
  if (safeJob.summary && !safeJob.description_snippet) {
    safeJob.description_snippet = safeJob.summary;
  }
  if (safeJob.description_snippet && !safeJob.summary) {
    safeJob.summary = safeJob.description_snippet;
  }

  return { job: safeJob, riskyChanges };
}

async function writeRiskyChangesReport(riskyChanges, summary = {}) {
  const payload = {
    generated_at: nowIso(),
    summary,
    risky_changes: Array.isArray(riskyChanges) ? riskyChanges : []
  };
  await fs.mkdir(path.dirname(RISKY_REPORT_JSON_FILE), { recursive: true });
  await fs.writeFile(RISKY_REPORT_JSON_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines = [
    "# Freshness Audit Risky Changes",
    "",
    `Generated: ${payload.generated_at}`,
    "",
    `Skipped risky changes: ${payload.risky_changes.length}`,
    "",
    "| Job | Organization | Field | Reason | Current | Proposed |",
    "| --- | --- | --- | --- | --- | --- |",
    ...payload.risky_changes.map((change) => {
      const job = String(change.title || change.id || "").replace(/\|/g, "\\|");
      const org = String(change.organization || "").replace(/\|/g, "\\|");
      const field = String(change.field || "").replace(/\|/g, "\\|");
      const reason = String(change.reason || "").replace(/\|/g, "\\|");
      const current = String(change.current || "").replace(/\|/g, "\\|");
      const proposed = String(change.proposed || "").replace(/\|/g, "\\|");
      return `| ${job} | ${org} | ${field} | ${reason} | ${current} | ${proposed} |`;
    })
  ];
  await fs.writeFile(RISKY_REPORT_MD_FILE, `${lines.join("\n")}\n`, "utf8");
  return payload;
}

function daysOld(value, now = new Date()) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - parsed) / 86400000);
}

function isStalePublicJob(job, record, now = new Date()) {
  const referenceDate =
    record?.last_checked_at ||
    record?.last_seen_at ||
    record?.last_verified_at ||
    record?.updated_at ||
    job?.date_updated ||
    job?.date_posted ||
    "";
  const age = daysOld(referenceDate, now);
  const staleScore = computeStaleScore(record || job || {}, { now });
  return age >= STALE_DAYS || staleScore >= 60;
}

function compareText(left, right) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function materialDescriptionChange(currentValue, nextValue, title) {
  if (!hasUsableDescription(nextValue, { title })) return false;
  const current = cleanText(currentValue);
  const next = cleanText(nextValue);
  if (!current || !next) return false;
  if (compareText(current, next)) return false;
  const ratio = Math.abs(current.length - next.length) / Math.max(current.length, next.length, 1);
  return ratio > 0.2;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function stripHtml(value) {
  return stringifySafe(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/section>|<\/article>|<\/tr>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match && match[1]) return cleanText(match[1]);
  }
  return "";
}

function extractTitle(html) {
  return (
    extractMetaContent(html, "og:title") ||
    cleanText(String(html || "").match(/<title>([^<]+)<\/title>/i)?.[1] || "") ||
    cleanText(String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
  );
}

function extractDescription(html) {
  const metaDescription = extractMetaContent(html, "description");
  if (metaDescription) return metaDescription;
  const paragraphs = Array.from(String(html || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length >= 60);
  return paragraphs.slice(0, 4).join(" ");
}

function extractLocation(html, jsonLd) {
  const jsonLocation =
    cleanText(jsonLd?.jobLocation?.address?.addressLocality) ||
    cleanText(jsonLd?.jobLocation?.name) ||
    cleanText(jsonLd?.jobLocation?.address?.addressRegion);
  if (jsonLocation) return jsonLocation;
  const match = String(html || "").match(LOCATION_LABEL_PATTERN);
  return match ? cleanText(match[1]) : "";
}

function extractJsonLdJobPosting(html) {
  const matches = Array.from(String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const match of matches) {
    const payload = safeJsonParse(match[1]);
    const queue = [];
    if (Array.isArray(payload)) queue.push(...payload);
    else if (payload) queue.push(payload);
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      const type = current["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
        return current;
      }
      if (Array.isArray(current["@graph"])) queue.push(...current["@graph"]);
    }
  }
  return null;
}

function extractApplyUrl(html, baseUrl, jsonLd) {
  const directJsonUrl = cleanText(jsonLd?.hiringOrganization?.sameAs || jsonLd?.url || "");
  if (APPLY_TEXT_PATTERN.test(directJsonUrl)) {
    return directJsonUrl;
  }

  const links = Array.from(String(html || "").matchAll(/<(a|form|button)[^>]+(?:href|action)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:a|form|button)>/gi))
    .map((match) => ({
      url: cleanText(match[2]),
      text: stripHtml(match[3])
    }));

  for (const link of links) {
    if (!APPLY_TEXT_PATTERN.test(link.text)) continue;
    try {
      return new URL(link.url, baseUrl).toString();
    } catch (_) {
      continue;
    }
  }

  return "";
}

function classifyPageTypeFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (/candidatelogin/.test(u)) return "login_page";
  if (/benefits/.test(u)) return "benefits_page";
  if (/procurement/.test(u)) return "procurement_page";
  if (/search|jobSearch|jobsearch/.test(u)) return "search_page";
  if (/careers?\/?$|jobs?\/?$/.test(u)) return "careers_landing_page";
  if (/contact-us/.test(u)) return "navigation_page";
  if (/[?&]error=true(?:\b|$)/.test(u)) return "careers_landing_page";
  return null;
}

function isJobSpecificUrl(url) {
  const u = String(url || "").toLowerCase();
  // Job-specific URLs contain a job id segment like /jobs/12345 or /job/12345 or /requisition/12345
  return /\/\b(?:jobs?|requisitions?|postings?|positions?|opening)\/\d+/i.test(u);
}

function detectRedirectToBoard(requestedUrl, finalUrl, body) {
  const req = String(requestedUrl || "");
  const final = String(finalUrl || "");
  if (req === final) return null;
  if (!isJobSpecificUrl(req)) return null;
  // Check if final URL is a board-level page (not job-specific)
  const text = cleanText(body).slice(0, 4000);
  if (final.includes("?error=true")) {
    return { mode: "dead", reason: "greenhouse_expired_redirect_to_board", pageType: "dead" };
  }
  // Check if final URL looks like a careers landing / search / login page
  const finalPageType = classifyPageTypeFromUrl(final);
  if (finalPageType && finalPageType !== "live") {
    return { mode: "dead", reason: `redirected_to_board_${finalPageType}`, pageType: "dead" };
  }
  // If final URL has no job-specific path and text shows expired signals
  if (!isJobSpecificUrl(final)) {
    if (REDIRECT_TO_BOARD_EXPIRED_PATTERNS.some((p) => p.test(text))) {
      return { mode: "dead", reason: "redirected_to_board_expired_text", pageType: "dead" };
    }
    // Final URL is board-level but text is ambiguous — flag for review
    return { mode: "uncertain", reason: "redirected_to_board_needs_review", pageType: "careers_landing_page" };
  }
  return null;
}

function classifyPageTypeFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (/login|sign\s+in/.test(t)) return "login_page";
  if (/benefits/.test(t)) return "benefits_page";
  if (/procurement/.test(t)) return "procurement_page";
  if (/search/.test(t)) return "search_page";
  if (/careers?\s*$|conservation.*jobs/.test(t)) return "careers_landing_page";
  if (/contact|proposal/.test(t)) return "navigation_page";
  return null;
}

function detectAccessDenied(response, text) {
  if (ACCESS_DENIED_STATUS_CODES.has(response.status)) return `http_${response.status}`;
  const matched = ACCESS_DENIED_TEXT_PATTERNS.find((p) => p.test(text));
  if (matched) return "access_denied_text";
  return null;
}

function detectPageMode(response, body, sourceUrl) {
  const contentType = cleanText(response.headers.get("content-type") || "").toLowerCase();
  const text = cleanText(body).slice(0, 4000);
  const title = extractTitle(body);

  if (DEAD_STATUS_CODES.has(response.status)) return { mode: "dead", reason: `http_${response.status}`, pageType: "dead" };
  const accessDenied = detectAccessDenied(response, text);
  if (accessDenied) return { mode: "dead", reason: accessDenied, pageType: "access_denied" };
  if (/application\/json|text\/json/i.test(contentType)) return { mode: "code_feed", reason: "json_only_page", pageType: "code_feed" };
  if (/xml|rss|atom/i.test(contentType)) return { mode: "code_feed", reason: "feed_only_page", pageType: "code_feed" };
  if (FEED_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return { mode: "code_feed", reason: "code_feed_page", pageType: "code_feed" };
  if (DEAD_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return { mode: "dead", reason: "expired_or_removed_text_detected", pageType: "dead" };

  const pageTypeFromUrl = classifyPageTypeFromUrl(sourceUrl || response.finalUrl || "");
  const pageTypeFromTitle = classifyPageTypeFromTitle(title);
  const pageType = pageTypeFromTitle || pageTypeFromUrl || "live";

  if (pageType !== "live") {
    return { mode: "uncertain", reason: `non_job_page:${pageType}`, pageType };
  }

  return { mode: "live", reason: "", pageType: "live" };
}

async function fetchLivePage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      body,
      headers: response.headers
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildReparsedJob(currentJob, record, page) {
  const jsonLd = extractJsonLdJobPosting(page.body);
  const extractedApplyUrl = extractApplyUrl(page.body, page.finalUrl, jsonLd);
  const extractedTitle = cleanText(jsonLd?.title || extractTitle(page.body));
  const extractedDescription = cleanText(jsonLd?.description ? stripHtml(jsonLd.description) : extractDescription(page.body));
  const extractedLocation = extractLocation(page.body, jsonLd);
  const extractedSalary = normalizePayDisplay({
    payDisplay: cleanText(jsonLd?.baseSalary?.value?.value || jsonLd?.baseSalary?.value?.minValue || jsonLd?.baseSalary?.value?.maxValue || "")
  });

  return normalizeJob({
    ...(record?.raw_source_data || {}),
    ...currentJob,
    title: extractedTitle || currentJob.title,
    description: extractedDescription || currentJob.description,
    raw_description: extractedDescription || currentJob.raw_description,
    location: extractedLocation || currentJob.location,
    apply_url: extractedApplyUrl || currentJob.apply_url,
    original_url: page.finalUrl || currentJob.original_url,
    source_url: page.finalUrl || currentJob.source_url,
    salary: extractedSalary || currentJob.salary,
    date_updated: nowIso().slice(0, 10)
  });
}

function detectCompensationSignal(text) {
  return /\b(?:salary|compensation|pay range|hourly|annual|per year|per hour|base salary)\b/i.test(String(text || ""));
}

function buildPendingJobFromRecord(record, currentJob, reasons) {
  const displayJob = resolveDisplayJobFromRecord(record) || currentJob;
  return normalizeJob({
    ...(record.raw_source_data || {}),
    ...displayJob,
    status: "pending",
    review_reason: reasons.join(";"),
    triage_reason: reasons.join(";"),
    trusted: false,
    auto_publish: false,
    date_updated: nowIso().slice(0, 10)
  });
}

function upsertPending(pendingJobs, nextJob) {
  const list = Array.isArray(pendingJobs) ? pendingJobs.slice() : [];
  const key = cleanText(nextJob.external_id || nextJob.id || nextJob.apply_url || nextJob.source_url);
  const index = list.findIndex((job) => cleanText(job.external_id || job.id || job.apply_url || job.source_url) === key);
  if (index >= 0) {
    list[index] = { ...list[index], ...nextJob };
  } else {
    list.push(nextJob);
  }
  return list;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = nowIso();
  const [publicJobs, existingRecords, pendingJobs] = await Promise.all([
    readJobs(),
    readJobRecords(),
    readPendingSyncedJobs()
  ]);
  const filteredPublicJobs = filterBlockedSourceEntries(publicJobs);
  const filteredExistingRecords = filterBlockedSourceEntries(existingRecords);
  const filteredPendingJobs = filterBlockedSourceEntries(pendingJobs);
  const now = new Date();
  const recordsById = new Map(filteredExistingRecords.map((record) => [cleanText(record.id), record]));
  const stalePublicJobs = filteredPublicJobs.filter((job) => {
    const record = recordsById.get(cleanText(job.id));
    return shouldShowPublicRecord(record) && isStalePublicJob(job, record, now);
  });

  let nextRecords = filteredExistingRecords.slice();
  let nextPending = filteredPendingJobs.slice();
  const changedJobs = [];
  const keptJobs = [];
  const flaggedJobs = [];
  const riskyChanges = [];

  async function processStaleJob(publicJob) {
    const record = recordsById.get(cleanText(publicJob.id));
    const workableDiagnostic = normalizeWorkableUrl(publicJob.apply_url || publicJob.original_url || publicJob.source_url);
    const sourceUrl = cleanText(workableDiagnostic.url || publicJob.apply_url || publicJob.original_url || publicJob.source_url);
    const reportEntry = {
      id: publicJob.id,
      title: publicJob.title,
      organization: publicJob.organization,
      source_url: sourceUrl,
      workable_url_normalized: workableDiagnostic.normalized,
      original_workable_url: workableDiagnostic.original_url,
      canonical_workable_url: workableDiagnostic.canonical_url,
      previous_status: "published",
      action: "unchanged",
      reasons: [],
      checked_at: generatedAt,
      pageType: null
    };

    if (!record || !sourceUrl) {
      reportEntry.action = "flag_review";
      reportEntry.reasons.push("missing_record_or_source_url");
      reportEntry.pageType = "no_record";
      flaggedJobs.push(reportEntry);
      return;
    }

    const page = await fetchLivePage(sourceUrl);
    if (page.error) {
      const refreshedRecord = applyFreshnessMetadata(record, {
        now,
        sourceStatus: "sync_error",
        lastSeen: false,
        failedSyncCount: Number(record.failed_sync_count || 0) + 1
      });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? refreshedRecord : item);
      reportEntry.action = "flag_review";
      reportEntry.reasons.push("uncertain_network_failure");
      reportEntry.pageType = "network_error";
      reportEntry.network_error = page.error.message;
      flaggedJobs.push(reportEntry);
      return;
    }

    const redirectToBoard = detectRedirectToBoard(sourceUrl, page.finalUrl, page.body);
    if (redirectToBoard) {
      if (redirectToBoard.mode === "dead") {
        const updatedRecord = markRemoved(record, redirectToBoard.reason, { now });
        nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
        reportEntry.action = "archived";
        reportEntry.reasons.push(redirectToBoard.reason);
        reportEntry.pageType = redirectToBoard.pageType;
        changedJobs.push(reportEntry);
        return;
      }
      const updatedRecord = markNeedsReview(record, redirectToBoard.reason, "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, [redirectToBoard.reason]));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push(redirectToBoard.reason);
      reportEntry.pageType = redirectToBoard.pageType;
      changedJobs.push(reportEntry);
      return;
    }

    const pageMode = detectPageMode(page, page.body, sourceUrl);
    if (pageMode.mode === "dead") {
      const updatedRecord = markRemoved(record, pageMode.reason, { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      reportEntry.action = "archived";
      reportEntry.reasons.push(pageMode.reason);
      reportEntry.pageType = pageMode.pageType;
      changedJobs.push(reportEntry);
      return;
    }

    if (pageMode.mode === "uncertain") {
      const updatedRecord = markNeedsReview(record, pageMode.reason, "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, [pageMode.reason]));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push(pageMode.reason);
      reportEntry.pageType = pageMode.pageType;
      changedJobs.push(reportEntry);
      return;
    }

    if (pageMode.mode === "code_feed") {
      const updatedRecord = markNeedsReview(record, pageMode.reason, "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, [pageMode.reason]));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push(pageMode.reason);
      reportEntry.pageType = "code_feed";
      changedJobs.push(reportEntry);
      return;
    }

    const reparsed = buildReparsedJob(publicJob, record, page);
    if (!reparsed) {
      const updatedRecord = markNeedsReview(record, "live_parsing_failed", "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, ["live_parsing_failed"]));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push("live_parsing_failed");
      changedJobs.push(reportEntry);
      return;
    }

    const readiness = assessPublicJobReadiness(reparsed, {
      source: { provider: reparsed.source_type, source_url: reparsed.source_url }
    });
    const reasons = [];
    if (pageMode.mode === "code_feed") reasons.push(pageMode.reason);
    if (!readiness.apply_url_valid) reasons.push("missing_or_invalid_apply_link");
    if (detectCompensationSignal(page.body) && (!cleanText(reparsed.salary) || cleanText(reparsed.pay_parse_warning))) {
      reasons.push("live_pay_available_parse_uncertain");
    }
    if (!compareText(publicJob.title, reparsed.title)) reasons.push("title_changed_materially");
    if (!compareText(publicJob.location, reparsed.location)) reasons.push("location_changed_materially");
    if (materialDescriptionChange(publicJob.description, reparsed.description, reparsed.title)) reasons.push("description_changed_materially");
    if (cleanText(publicJob.apply_url) && cleanText(reparsed.apply_url) && !compareText(publicJob.apply_url, reparsed.apply_url)) {
      reasons.push("apply_url_changed_materially");
    }
    if (!readiness.ready) reasons.push(...readiness.reasons);

    const safeReparsed = mergeSafePublicJob(publicJob, reparsed, {
      id: publicJob.id,
      title: publicJob.title,
      organization: publicJob.organization
    });
    riskyChanges.push(
      ...safeReparsed.riskyChanges.map((change) => ({
        ...change,
        checked_at: generatedAt
      }))
    );

    const mergedRecord = buildJobRecord(
      {
        ...safeReparsed.job,
        status: "published",
        last_checked_at: generatedAt,
        last_seen_at: generatedAt,
        source_status: reasons.length ? "needs_review" : "live",
        parser_confidence: readiness.parser_confidence,
        parser_confidence_score: readiness.parser_confidence_score,
        content_quality_score: readiness.content_quality_score,
        stale_score: reasons.length ? 25 : 0,
        failed_sync_count: 0,
        review_reason: reasons.join(";"),
        triage_reason: reasons.join(";")
      },
      record,
      { context: "source_sync", now: generatedAt }
    );

    const updatedRecord = extendVerification(mergedRecord, "freshness_audit", { now });
    nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
    reportEntry.action = reasons.length ? "kept_public_with_warnings" : "kept_public";
    if (reasons.length) {
      reportEntry.reasons.push(...reasons);
    }
    reportEntry.reasons.push("live_high_confidence_valid_apply_link");
    reportEntry.pageType = "live";
    keptJobs.push(reportEntry);
  }

  for (let i = 0; i < stalePublicJobs.length; i += FETCH_CONCURRENCY) {
    const batch = stalePublicJobs.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(batch.map(processStaleJob));
  }

  // --- Pending job freshness check ---
  const pendingChanges = [];
  for (const pendingJob of filteredPendingJobs) {
    if (pendingJob.status === "archived" || pendingJob.status === "rejected") continue;
    const sourceUrl = cleanText(pendingJob.apply_url || pendingJob.source_url || "");
    if (!sourceUrl || /^https?:\/\/(?:www\.)?(?:linkedin|google|facebook|twitter|glassdoor|indeed)\./i.test(sourceUrl)) continue;
    const pendingReportEntry = {
      id: pendingJob.id,
      title: pendingJob.title,
      organization: pendingJob.organization,
      source_url: sourceUrl,
      previous_status: pendingJob.status || "pending",
      action: "unchanged",
      reasons: [],
      checked_at: generatedAt
    };
    const page = await fetchLivePage(sourceUrl);
    if (page.error) {
      pendingReportEntry.reasons.push("fetch_failed");
      pendingChanges.push(pendingReportEntry);
      continue;
    }
    const pageMode = detectPageMode(page, page.body, sourceUrl);
    if (pageMode.mode === "dead") {
      const isReviewReady = pendingJob.triage_bucket === "review_ready";
      const updatedPending = {
        ...pendingJob,
        triage_bucket: "closed_posting",
        triage_reason: "freshness_unavailable",
        status: "rejected",
        published: false,
        public_visibility: false,
        auto_publish: false,
        stale_score: 100,
        last_checked_at: generatedAt,
        date_updated: nowIso().slice(0, 10)
      };
      const idx = nextPending.findIndex((j) => cleanText(j.id) === cleanText(pendingJob.id));
      if (idx >= 0) nextPending[idx] = updatedPending;
      pendingReportEntry.action = "rejected";
      pendingReportEntry.reasons.push(`dead_page:${pageMode.reason}`);
      pendingReportEntry.pageType = pageMode.pageType;
      if (isReviewReady) pendingReportEntry.reasons.push("was_review_ready");
      pendingChanges.push(pendingReportEntry);
    } else if (pageMode.mode === "uncertain" || pageMode.mode === "code_feed") {
      pendingReportEntry.reasons.push(`${pageMode.mode}_page:${pageMode.reason}`);
      pendingReportEntry.pageType = pageMode.pageType;
      pendingChanges.push(pendingReportEntry);
    } else {
      pendingReportEntry.reasons.push("live");
      pendingReportEntry.pageType = "live";
      pendingChanges.push(pendingReportEntry);
    }
  }

  const riskyReport = await writeRiskyChangesReport(riskyChanges, {
    generated_at: generatedAt,
    mode: args.write ? "write" : "dry_run",
    skipped_risky_changes_count: riskyChanges.length,
    stale_threshold_days: STALE_DAYS
  });

  const pageTypeBreakdown = {};
  for (const entry of [...changedJobs, ...keptJobs, ...flaggedJobs, ...pendingChanges]) {
    const pt = entry.pageType || "unknown";
    pageTypeBreakdown[pt] = (pageTypeBreakdown[pt] || 0) + 1;
  }

  const report = {
    generated_at: generatedAt,
    mode: args.write ? "write" : "dry_run",
    stale_threshold_days: STALE_DAYS,
    stale_archive_days: STALE_ARCHIVE_DAYS,
    public_jobs_scanned: stalePublicJobs.length,
    pending_jobs_scanned: pendingChanges.length,
    changed_jobs_count: changedJobs.length,
    kept_public_count: keptJobs.length,
    flagged_review_count: flaggedJobs.length,
    pending_rejected_count: pendingChanges.filter((e) => e.action === "rejected").length,
    pending_uncertain_count: pendingChanges.filter((e) => e.reasons.some((r) => r.startsWith("uncertain_page:"))).length,
    skipped_risky_changes_count: riskyReport.risky_changes.length,
    page_type_breakdown: pageTypeBreakdown,
    changed_jobs: changedJobs,
    kept_public_jobs: keptJobs,
    flagged_review_jobs: flaggedJobs,
    pending_changes: pendingChanges,
    risky_changes_report: path.relative(ROOT, RISKY_REPORT_JSON_FILE)
  };

  await writeJsonIfChanged(REPORT_FILE, report);

  if (args.write) {
    await writeJsonIfChanged(JOB_RECORDS_FILE, filterBlockedSourceEntries(nextRecords));
    await writeJsonIfChanged(PENDING_SYNCED_FILE, filterBlockedSourceEntries(nextPending));
    try {
      await syncPublicJobsFromRecords(nextRecords, {
        label: "jobs:freshness-audit",
        allowWorseOverwrite: false,
        scopeIds: stalePublicJobs.map((job) => job.id)
      });
    } catch (error) {
      if (/Refusing to overwrite jobs\.json/i.test(String(error.message || ""))) {
        console.warn(`[jobs:freshness-audit] jobs_json_sync_skipped=${error.message}`);
      } else {
        throw error;
      }
    }
    const refreshedJobs = await readJobs();
    const octopus = Array.isArray(refreshedJobs)
      ? refreshedJobs.find((job) => job && job.id === "Octopus Energy-f6d11145-9327-4f9c-8f68-a5a079a39bb9")
      : null;
    if (octopus && octopus.salary !== "$57,000 / year") {
      throw new Error("Freshness audit safety failed: Octopus salary was overwritten");
    }
  }

  console.log(
    `[jobs:freshness-audit] mode=${report.mode} scanned=${report.public_jobs_scanned} changed=${report.changed_jobs_count} kept_public=${report.kept_public_count} flagged_review=${report.flagged_review_count} pending_rejected=${report.pending_rejected_count} pending_uncertain=${report.pending_uncertain_count} skipped_risky_changes=${report.skipped_risky_changes_count}`
  );
  console.log(`[jobs:freshness-audit] report=${REPORT_FILE}`);
  console.log(`[jobs:freshness-audit] risky_changes_report=${RISKY_REPORT_JSON_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:freshness-audit] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  containsJunk,
  isBlank,
  isRiskyReplacement,
  buildReparsedJob,
  maybeAssignSafe,
  mergeSafePublicJob,
  writeRiskyChangesReport,
  classifyPageTypeFromUrl,
  classifyPageTypeFromTitle,
  detectPageMode,
  main
};
