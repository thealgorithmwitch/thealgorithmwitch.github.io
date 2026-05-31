const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const REPORT_FILE = path.join(ROOT, "reports", "freshness-redirect-repair-latest.json");
const REPORT_MD_FILE = path.join(ROOT, "reports", "freshness-redirect-repair-latest.md");
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = "AlgorithmWitchJobsRedirectAudit/1.0 (+https://github.com/actions)";
const FETCH_CONCURRENCY = 3;

const BOARD_TEXT_EXPIRED_PATTERNS = [
  /\bcreate\s+a\s+job\s+alert\b/i,
  /\bthere\s+are\s+no\s+current\s+openings?\b/i,
  /\bthere\s+are\s+currently\s+no\s+open\s+positions?\b/i,
  /\bno\s+current\s+openings?\b/i,
  /\bno\s+open\s+positions?\b/i,
  /\bposition\s+is\s+no\s+longer\s+available\b/i,
  /\bthis\s+job\s+is\s+no\s+longer\s+available\b/i,
  /\bjob\s+not\s+found\b/i,
  /\bthe\s+page\s+you\s+are\s+looking\s+for\s+does\s+not\s+exist\b/i
];

function isJobSpecificUrl(url) {
  return /\/\b(?:jobs?|requisitions?|postings?|positions?|opening)\/\d+/i.test(String(url || ""));
}

function detectRedirectToBoard(requestedUrl, finalUrl, text) {
  const req = String(requestedUrl || "");
  const final = String(finalUrl || "");
  if (req === final) return null;
  if (!isJobSpecificUrl(req)) return null;
  if (!isJobSpecificUrl(final)) {
    if (BOARD_TEXT_EXPIRED_PATTERNS.some((p) => p.test(text))) {
      return "greenhouse_expired_redirect_to_board";
    }
    return "redirected_to_board_needs_review";
  }
  if (req !== final && final.includes("/jobs/")) {
    return "redirected_job_url_changed";
  }
  return null;
}

async function fetchUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" }
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, finalUrl: response.url || url, body, error: null };
  } catch (error) {
    return { ok: false, status: 0, finalUrl: url, body: "", error };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  const records = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
  const recordsById = new Map(records.map((r) => [String(r.id), r]));

  const greenhouseJobs = jobs.filter((j) => {
    const src = String(j.source || j.source_type || "").toLowerCase();
    return src === "greenhouse" && j.status === "published";
  });

  console.log(`Scanning ${greenhouseJobs.length} public Greenhouse jobs for redirects...`);

  const results = [];
  let archived = 0;
  let needsReview = 0;
  let unchanged = 0;

  for (let i = 0; i < greenhouseJobs.length; i += FETCH_CONCURRENCY) {
    const batch = greenhouseJobs.slice(i, i + FETCH_CONCURRENCY);
    const fetches = batch.map(async (job) => {
      const sourceUrl = String(job.apply_url || job.original_url || job.source_url || "");
      if (!sourceUrl.startsWith("http")) {
        unchanged++;
        return { job, action: "skipped", reason: "no_url" };
      }
      let redirectDiagnostic = null;

      try {
        const page = await fetchUrl(sourceUrl);
        if (page.error) {
          return { job, action: "fetch_failed", reason: String(page.error.message) };
        }
        redirectDiagnostic = detectRedirectToBoard(sourceUrl, page.finalUrl, page.body);

        if (redirectDiagnostic === "greenhouse_expired_redirect_to_board" || redirectDiagnostic === "redirected_to_board_needs_review") {
          const isDefinite = redirectDiagnostic === "greenhouse_expired_redirect_to_board";
          const reason = redirectDiagnostic;
          const record = recordsById.get(String(job.id));
          return { job, action: isDefinite ? "archive" : "flag_review", reason, redirectDiagnostic, record, finalUrl: page.finalUrl };
        }

        unchanged++;
        return { job, action: "live_no_redirect", reason: "", finalUrl: page.finalUrl };
      } catch (err) {
        return { job, action: "error", reason: String(err.message) };
      }
    });

    const batchResults = await Promise.all(fetches);
    results.push(...batchResults);
  }

  // Process results
  const nextJobs = [];
  const nextRecords = records.slice();
  let jobsRemoved = 0;
  let recordsUpdated = 0;

  for (const r of results) {
    if (r.action === "archive") {
      // Remove from jobs.json
      nextJobs.push(null); // placeholder
      jobsRemoved++;

      // Update record in job-records.json
      if (r.record) {
        const idx = nextRecords.findIndex((rec) => String(rec.id) === String(r.job.id));
        if (idx >= 0) {
          nextRecords[idx] = {
            ...nextRecords[idx],
            status: "removed",
            public_visibility: false,
            published: false,
            stale_reason: r.reason,
            last_checked_at: new Date().toISOString(),
            expires_at: "",
            verification_status: "expired",
            verification_method: "freshness_audit",
            source_status: "expired",
            field_meta: {
              ...(nextRecords[idx].field_meta || {}),
              source_url: {
                ...(nextRecords[idx].field_meta?.source_url || {}),
                last_value: r.job.source_url
              },
              original_url: {
                ...(nextRecords[idx].field_meta?.original_url || {}),
                last_value: r.job.original_url
              }
            }
          };
          recordsUpdated++;
        }
      }
      archived++;
    } else if (r.action === "flag_review") {
      // Record needs review — store diagnostic
      const record = r.record;
      if (record) {
        const idx = nextRecords.findIndex((rec) => String(rec.id) === String(r.job.id));
        if (idx >= 0) {
          nextRecords[idx] = {
            ...nextRecords[idx],
            stale_reason: r.reason,
            last_checked_at: new Date().toISOString(),
            verification_status: "needs_review",
            verification_method: "freshness_audit"
          };
          recordsUpdated++;
        }
      }
      needsReview++;
    }
  }

  // Write back jobs.json (excluding archived)
  const keptJobs = [];
  let jobIdx = 0;
  for (const job of jobs) {
    if (results[jobIdx] && results[jobIdx].action === "archive") {
      jobIdx++;
      continue;
    }
    keptJobs.push(job);
    jobIdx++;
  }

  // Actually jobs and results don't align 1:1 because we filtered.
  // Rebuild properly:
  const archivedIds = new Set(results.filter(r => r.action === "archive").map(r => String(r.job.id)));
  const filteredJobs = jobs.filter(j => !archivedIds.has(String(j.id)));

  const report = {
    generated_at: new Date().toISOString(),
    public_greenhouse_jobs_scanned: greenhouseJobs.length,
    total_public_jobs: jobs.length,
    archived_expired: archived,
    flagged_for_review: needsReview,
    unchanged: unchanged,
    fetch_failed: results.filter(r => r.action === "fetch_failed").length,
    results: results.map(r => ({
      id: String(r.job.id),
      title: r.job.title,
      organization: r.job.organization,
      action: r.action,
      reason: r.reason || "",
      url: r.job.source_url || r.job.apply_url || "",
      finalUrl: r.finalUrl || ""
    })).filter(r => r.action !== "live_no_redirect" && r.action !== "skipped" && r.action !== "unchanged")
  };

  fs.writeFileSync(JOBS_FILE, JSON.stringify(filteredJobs, null, 2), "utf8");
  fs.writeFileSync(RECORDS_FILE, JSON.stringify(nextRecords, null, 2), "utf8");
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

  const mdLines = [
    "# Freshness Redirect Repair Report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    `## Summary`,
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Public Greenhouse jobs scanned | ${report.public_greenhouse_jobs_scanned} |`,
    `| Archived (expired redirect to board) | ${report.archived_expired} |`,
    `| Flagged for review (uncertain redirect) | ${report.flagged_for_review} |`,
    `| Unchanged (live) | ${report.unchanged} |`,
    `| Fetch failed | ${report.fetch_failed} |`,
    "",
    `## Archived Jobs`,
    "",
    ...report.results.filter(r => r.action === "archive").map(r =>
      `- **${r.organization}** — ${r.title} (${r.reason})`
    ),
    "",
    `## Flagged for Review`,
    "",
    ...report.results.filter(r => r.action === "flag_review").map(r =>
      `- **${r.organization}** — ${r.title} (${r.reason})`
    ),
    "",
    `## Fetch Failed`,
    "",
    ...report.results.filter(r => r.action === "fetch_failed").map(r =>
      `- **${r.organization}** — ${r.title}: ${r.reason}`
    ),
    ""
  ];
  fs.writeFileSync(REPORT_MD_FILE, mdLines.join("\n"), "utf8");

  console.log(`\nDone. Archived: ${archived}, Flagged: ${needsReview}, Unchanged: ${unchanged}, Fetch failed: ${report.fetch_failed}`);
  console.log(`Report: ${REPORT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exitCode = 1;
});
