const path = require("path");
const { readJobs, readPendingSyncedJobs, writeJsonIfChanged } = require("./job-utils");
const { buildJobRecord, JOB_RECORDS_FILE, readJobRecords } = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const {
  assessPublicJobReadiness,
  hasUsableDescription,
  normalizeJob,
  normalizePayDisplay,
  stringifySafe
} = require("./job-normalizer");
const {
  extendVerification,
  markNeedsReview,
  markRemoved,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
} = require("./lifecycle-utils");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "freshness-audit-latest.json");
const PENDING_SYNCED_FILE = path.join(ROOT, "pending-synced-jobs.json");
const STALE_DAYS = 7;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = "AlgorithmWitchJobsFreshnessAudit/1.0 (+https://github.com/actions)";
const DEAD_STATUS_CODES = new Set([404, 410, 451]);
const DEAD_TEXT_PATTERNS = [
  /\bjob is no longer available\b/i,
  /\bno longer accepting applications\b/i,
  /\bposition has been filled\b/i,
  /\bposting has expired\b/i,
  /\bthis job has closed\b/i,
  /\b404\b/i
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

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--write"),
    write: argv.includes("--write")
  };
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return stringifySafe(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function daysOld(value, now = new Date()) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - parsed) / 86400000);
}

function isStalePublicJob(job, record, now = new Date()) {
  const referenceDate =
    record?.last_verified_at ||
    record?.updated_at ||
    job?.date_updated ||
    job?.date_posted ||
    "";
  return daysOld(referenceDate, now) >= STALE_DAYS;
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

function detectPageMode(response, body) {
  const contentType = cleanText(response.headers.get("content-type") || "").toLowerCase();
  const text = cleanText(body).slice(0, 4000);
  if (DEAD_STATUS_CODES.has(response.status)) return { mode: "dead", reason: `http_${response.status}` };
  if (/application\/json|text\/json/i.test(contentType)) return { mode: "code_feed", reason: "json_only_page" };
  if (/xml|rss|atom/i.test(contentType)) return { mode: "code_feed", reason: "feed_only_page" };
  if (FEED_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return { mode: "code_feed", reason: "code_feed_page" };
  if (DEAD_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return { mode: "dead", reason: "expired_or_removed_text_detected" };
  return { mode: "live", reason: "" };
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
  const now = new Date();
  const recordsById = new Map(existingRecords.map((record) => [cleanText(record.id), record]));
  const stalePublicJobs = publicJobs.filter((job) => {
    const record = recordsById.get(cleanText(job.id));
    return shouldShowPublicRecord(record) && isStalePublicJob(job, record, now);
  });

  let nextRecords = existingRecords.slice();
  let nextPending = pendingJobs.slice();
  const changedJobs = [];
  const keptJobs = [];
  const flaggedJobs = [];

  for (const publicJob of stalePublicJobs) {
    const record = recordsById.get(cleanText(publicJob.id));
    const sourceUrl = cleanText(publicJob.apply_url || publicJob.original_url || publicJob.source_url);
    const reportEntry = {
      id: publicJob.id,
      title: publicJob.title,
      organization: publicJob.organization,
      source_url: sourceUrl,
      previous_status: "published",
      action: "unchanged",
      reasons: [],
      checked_at: generatedAt
    };

    if (!record || !sourceUrl) {
      reportEntry.action = "flag_review";
      reportEntry.reasons.push("missing_record_or_source_url");
      flaggedJobs.push(reportEntry);
      continue;
    }

    const page = await fetchLivePage(sourceUrl);
    if (page.error) {
      reportEntry.action = "flag_review";
      reportEntry.reasons.push("uncertain_network_failure");
      reportEntry.network_error = page.error.message;
      flaggedJobs.push(reportEntry);
      continue;
    }

    const pageMode = detectPageMode(page, page.body);
    if (pageMode.mode === "dead") {
      const updatedRecord = markRemoved(record, pageMode.reason, { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      reportEntry.action = "archived";
      reportEntry.reasons.push(pageMode.reason);
      changedJobs.push(reportEntry);
      continue;
    }

    const reparsed = buildReparsedJob(publicJob, record, page);
    if (!reparsed) {
      const updatedRecord = markNeedsReview(record, "live_parsing_failed", "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, ["live_parsing_failed"]));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push("live_parsing_failed");
      changedJobs.push(reportEntry);
      continue;
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

    const mergedRecord = buildJobRecord(
      {
        ...reparsed,
        status: reasons.length ? "pending" : "published",
        review_reason: reasons.join(";"),
        triage_reason: reasons.join(";")
      },
      record,
      { context: "source_sync", now: generatedAt }
    );

    if (reasons.length) {
      const updatedRecord = markNeedsReview(mergedRecord, reasons.join(";"), "freshness_audit", { now });
      nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
      nextPending = upsertPending(nextPending, buildPendingJobFromRecord(updatedRecord, publicJob, reasons));
      reportEntry.action = "demoted_to_pending";
      reportEntry.reasons.push(...reasons);
      changedJobs.push(reportEntry);
      continue;
    }

    const updatedRecord = extendVerification(mergedRecord, "freshness_audit", { now });
    nextRecords = nextRecords.map((item) => cleanText(item.id) === cleanText(record.id) ? updatedRecord : item);
    reportEntry.action = "kept_public";
    reportEntry.reasons.push("live_high_confidence_valid_apply_link");
    keptJobs.push(reportEntry);
  }

  const report = {
    generated_at: generatedAt,
    mode: args.write ? "write" : "dry_run",
    stale_threshold_days: STALE_DAYS,
    public_jobs_scanned: stalePublicJobs.length,
    changed_jobs_count: changedJobs.length,
    kept_public_count: keptJobs.length,
    flagged_review_count: flaggedJobs.length,
    changed_jobs: changedJobs,
    kept_public_jobs: keptJobs,
    flagged_review_jobs: flaggedJobs
  };

  await writeJsonIfChanged(REPORT_FILE, report);

  if (args.write) {
    await writeJsonIfChanged(JOB_RECORDS_FILE, nextRecords);
    await writeJsonIfChanged(PENDING_SYNCED_FILE, nextPending);
    await syncPublicJobsFromRecords(nextRecords, {
      label: "jobs:freshness-audit",
      allowWorseOverwrite: false,
      scopeIds: stalePublicJobs.map((job) => job.id)
    });
  }

  console.log(
    `[jobs:freshness-audit] mode=${report.mode} scanned=${report.public_jobs_scanned} changed=${report.changed_jobs_count} kept_public=${report.kept_public_count} flagged_review=${report.flagged_review_count}`
  );
  console.log(`[jobs:freshness-audit] report=${REPORT_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:freshness-audit] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
