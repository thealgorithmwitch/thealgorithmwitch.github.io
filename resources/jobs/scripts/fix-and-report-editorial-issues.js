#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");

const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

function text(v) { return String(v ?? "").trim(); }

function arr(v) { return Array.isArray(v) ? v : []; }

function nowIso() { return new Date().toISOString(); }

function isDashOnly(v) {
  const s = String(v ?? "").trim();
  return s.length > 0 && /^[—–-]+$/.test(s);
}

function fmtTable(rows = [], cols = []) {
  if (!rows.length) return "_None_";
  const h = `| ${cols.join(" | ")} |`;
  const d = `| ${cols.map(() => "---").join(" | ")} |`;
  const b = rows.map(r => `| ${cols.map(c => text(r[c]).replace(/\n/g, " ")).join(" | ")} |`);
  return [h, d, ...b].join("\n");
}

// ====== 1. Fix dash-only job_type values in data files ======

async function fixFileJobTypes(filePath, label) {
  let raw;
  try { raw = await fs.readFile(filePath, "utf8"); }
  catch { return { file: label, path: filePath, status: "not_found", fixed: 0, entries: [], jobTypeFields: [] }; }

  let data;
  try { data = JSON.parse(raw); }
  catch { return { file: label, path: filePath, status: "parse_error", fixed: 0, entries: [], jobTypeFields: [] }; }

  const items = Array.isArray(data) ? data : data.jobs || data.records || [];
  const isArray = Array.isArray(data);
  const isRecords = label.includes("job-records");

  let fixed = 0;
  const entries = [];
  const jobTypeFields = new Set();

  for (const item of items) {
    const record = isRecords ? (item.raw_source_data || item) : item;
    const fields = ["job_type", "employment_type", "jobType", "employmentType"];
    let changed = false;

    for (const field of fields) {
      const val = record[field];
      if (val !== undefined && val !== null && isDashOnly(val)) {
        const title = record.title || record.name || "(unknown)";
        const org = record.organization || record.source_id || label;
        entries.push({ id: item.id || record.id, title, org, field, old_value: val });
        jobTypeFields.add(field);
        record[field] = "";
        changed = true;
        fixed++;
      }
    }
  }

  if (fixed > 0) {
    if (isArray) {
      await fs.writeFile(filePath, JSON.stringify(items, null, 2) + "\n", "utf8");
    } else if (isRecords) {
      data.records = items;
      await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    } else {
      data.jobs = items;
      await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
  }

  return {
    file: label,
    path: filePath,
    status: "processed",
    total_items: items.length,
    fixed,
    entries,
    jobTypeFields: [...jobTypeFields]
  };
}

// ====== 2. Working sources investigation ======

async function investigateWorkingSources(sources, prospects, health, pending) {
  const sourceMap = new Map(arr(sources).map(s => [text(s.id), s]));
  const prospectMap = new Map(arr(prospects).map(p => [text(p.source_id || p.id), p]));
  const healthMap = new Map(arr(health?.sources || health).map(h => [text(h.source_id), h]));
  const pendingOrgs = new Set(arr(pending).map(j => text(j.organization).toLowerCase()));
  const pendingSources = new Set(arr(pending).map(j => text(j.source_id).toLowerCase()));

  // Merge all source-like entries
  const allEntries = new Map();
  for (const s of arr(sources)) { allEntries.set(text(s.id), { ...s, _origin: "sources.json" }); }
  for (const p of arr(prospects)) {
    const id = text(p.source_id || p.id);
    if (!allEntries.has(id)) allEntries.set(id, { ...p, id, _origin: "source-prospects.json" });
  }

  const findings = [];
  for (const [id, entry] of allEntries) {
    const health = healthMap.get(id);
    const isInSources = sourceMap.has(id);
    const isInProspects = prospectMap.has(id);
    const hasPendingJobs = pendingSources.has(id.toLowerCase());
    const pendingCount = arr(pending).filter(j => text(j.source_id).toLowerCase() === id.toLowerCase()).length;
    const healthPendingCount = health?.pending_count_delta || 0;
    const healthFailedCount = health?.failed_sync_count || 0;
    const healthStatus = health?.source_status || "unknown";
    const jobsFound = health?.jobs_found ?? null;
    const jobsAdded = health?.jobs_added_to_pending ?? null;
    const skipReasons = arr(health?.skip_reasons || []);
    const fetchFailures = health?.failure_error_count || healthFailedCount;
    const org = text(entry.organization || entry.name || "");
    const careersUrl = text(entry.careers_url || "");
    const sourceUrl = text(entry.source_url || entry.url || "");
    const syncEnabled = entry.sync_enabled !== false;
    const customSyncEnabled = entry.custom_sync_enabled !== false;
    const parserEnabled = entry.parser_enabled !== false;
    const manualReview = entry.manual_review_required === true;
    const classification = entry.source_classification || entry.classification || "unknown";
    const provider = text(entry.ats_provider || entry.provider || "");
    const type = text(entry.type || "");

    // Determine if this source has visible jobs (based on having a URL and being a known org)
    const hasUrl = Boolean(sourceUrl || careersUrl);
    const isKnownOrg = Boolean(org && !["unknown", ""].includes(org));
    const mightHaveJobs = hasUrl && isKnownOrg;

    // Analyze why working sources don't have pending jobs
    const issues = [];
    let primaryBlock = "";
    let recommendedFix = "";

    if (!syncEnabled) {
      issues.push("sync_enabled is false");
      if (manualReview) {
        if (!primaryBlock) { primaryBlock = "manual_review_required disables sync (fixed in normalizeSource)"; recommendedFix = "source-utils.js no longer disables sync for manual_review_required — re-run sync"; }
      } else {
        if (!primaryBlock) { primaryBlock = "sync_enabled explicitly false"; recommendedFix = "set sync_enabled: true if source should sync"; }
      }
    }
    if (!customSyncEnabled && type !== "ats") {
      issues.push("custom_sync_enabled is false");
      if (!primaryBlock) { primaryBlock = "custom_sync disabled"; recommendedFix = "set custom_sync_enabled: true"; }
    }
    if (!parserEnabled) {
      issues.push("parser_enabled is false");
      if (!primaryBlock) { primaryBlock = "parser disabled"; recommendedFix = "set parser_enabled: true or set up manual-review fallback"; }
    }
    if (!hasUrl) {
      issues.push("no source_url or careers_url");
      if (!primaryBlock) { primaryBlock = "missing URLs"; recommendedFix = "add source_url or careers_url"; }
    }
    if (fetchFailures >= 5) {
      issues.push(`${fetchFailures} consecutive fetch failures`);
      if (!primaryBlock && hasUrl) { primaryBlock = "persistent fetch failures"; recommendedFix = "verify board token/slug/URL correctness"; }
    }
    if (healthStatus === "sync_error" || healthStatus === "fetch_failed") {
      issues.push(`health status: ${healthStatus}`);
    }
    if (jobsFound === 0 && fetchFailures === 0) {
      issues.push("fetch succeeded but 0 jobs found");
      if (!primaryBlock) { primaryBlock = "ATS returns 0 jobs"; recommendedFix = "check ATS board for active listings"; }
    }
    if (jobsFound > 0 && jobsAdded === 0) {
      issues.push(`${jobsFound} jobs found but 0 added to pending`);
      if (!primaryBlock) { primaryBlock = "jobs found but not entering pending"; recommendedFix = "check relevance filters and dedup logic"; }
    }
    if (skipReasons.includes("fetch failed") || skipReasons.includes("fetch_failed")) {
      if (!issues.some(i => i.includes("fetch failure"))) {
        issues.push("jobs skipped due to fetch failures");
      }
    }
    if (manualReview && !isInSources) {
      issues.push("manual_review source not in sources.json (only in prospects)");
      if (!primaryBlock) { primaryBlock = "not configured as source"; recommendedFix = "add to sources.json with proper ATS config"; }
    }
    if (classification === "manual_editorial" || classification === "manual_review_community") {
      issues.push(`classified as ${classification} — may skip sync`);
    }
    if (type === "custom" && !parserEnabled && !syncEnabled) {
      issues.push("custom source with parser disabled and sync disabled");
      if (!primaryBlock) { primaryBlock = "custom source not configured for any pipeline"; recommendedFix = "enable parser or set up manual review"; }
    }
    // Check if source has a manually verified working URL but no jobs
    if (hasUrl && !hasPendingJobs && fetchFailures < 3) {
      issues.push("source URL exists but no pending jobs and few failures — may route to backlog");
      if (!primaryBlock) { primaryBlock = "jobs routed to backlog"; recommendedFix = "check broad_source_backlog and relevance score"; }
    }

    // Backlog analysis
    const backlogJobs = arr(pending).filter(j =>
      text(j.source_id).toLowerCase() === id.toLowerCase() &&
      (j.hidden_from_review_default || j.broad_source_backlog)
    );

    findings.push({
      source_id: id,
      organization: org,
      source_url: sourceUrl || careersUrl,
      fetch_status: healthStatus,
      parser_type: provider,
      jobs_detected: jobsFound,
      jobs_added_to_pending: jobsAdded,
      jobs_in_pending: pendingCount,
      jobs_in_backlog: backlogJobs.length,
      jobs_skipped: skipReasons.length,
      skip_reasons: skipReasons.join(", "),
      duplicate_reason: "",
      fetch_failures: fetchFailures,
      sync_enabled: syncEnabled,
      custom_sync_enabled: customSyncEnabled,
      parser_enabled: parserEnabled,
      manual_review_required: manualReview,
      classification,
      primary_blocker: primaryBlock,
      issues: issues.join("; "),
      recommended_fix: recommendedFix,
      in_sources_json: isInSources,
      in_prospects_json: isInProspects
    });
  }

  findings.sort((a, b) => {
    // Sort: working-without-pending first, then by fetch failures, then by name
    const aWorking = a.jobs_detected > 0 && a.jobs_in_pending === 0 ? 0 : 1;
    const bWorking = b.jobs_detected > 0 && b.jobs_in_pending === 0 ? 0 : 1;
    if (aWorking !== bWorking) return aWorking - bWorking;
    return (b.jobs_detected || 0) - (a.jobs_detected || 0) || a.organization.localeCompare(b.organization);
  });

  return findings;
}

// ====== MAIN ======

async function main() {
  // === Fix data files ===
  const dataFiles = [
    { path: path.join(ROOT, "jobs.json"), label: "jobs.json" },
    { path: path.join(ROOT, "job-records.json"), label: "job-records.json" },
    { path: path.join(ROOT, "pending-synced-jobs.json"), label: "pending-synced-jobs.json" },
    { path: path.join(ROOT, "jobs2.json"), label: "jobs2.json" }
  ];
  const fixResults = await Promise.all(dataFiles.map(f => fixFileJobTypes(f.path, f.label)));
  const totalFixed = fixResults.reduce((s, r) => s + r.fixed, 0);

  // === Investigate working sources ===
  let sourcesRaw, prospects = [], health = [], pending = [];
  try { sourcesRaw = JSON.parse(await fs.readFile(path.join(ROOT, "sources.json"), "utf8")); } catch { sourcesRaw = []; }
  const sources = Array.isArray(sourcesRaw) ? sourcesRaw : (sourcesRaw?.sources || []);
  try { prospects = JSON.parse(await fs.readFile(path.join(ROOT, "source-prospects.json"), "utf8")); } catch {}
  try { const h = JSON.parse(await fs.readFile(path.join(ROOT, "source-health-latest.json"), "utf8")); health = Array.isArray(h) ? h : (h?.sources || []); } catch {}
  try { pending = JSON.parse(await fs.readFile(path.join(ROOT, "pending-synced-jobs.json"), "utf8")); } catch {}

  const workingFindings = await investigateWorkingSources(sources, prospects, health, pending);

  // Sources needing attention: working (jobs_detected > 0) but no pending, or fetch-failing with URLs
  const needsAttention = workingFindings.filter(f =>
    (f.jobs_detected > 0 && f.jobs_in_pending === 0) ||
    (f.fetch_failures >= 5 && f.source_url) ||
    (f.sync_enabled === false && f.manual_review_required && f.source_url)
  );

  // === Generate job-type-normalization report ===
  const jobTypeReport = {
    generated_at: nowIso(),
    summary: {
      total_files_checked: dataFiles.length,
      total_dash_only_values_fixed: totalFixed,
      files: fixResults.map(r => ({
        file: r.file,
        total_items: r.total_items,
        fixed: r.fixed,
        status: r.status
      }))
    },
    fixed_entries: fixResults.flatMap(r => r.entries.slice(0, 20)).map(e => ({
      id: e.id, title: e.title, org: e.org, field: e.field, old_value: e.old_value
    })),
    affected_fields: [...new Set(fixResults.flatMap(r => r.jobTypeFields).flat())],
    fixes_applied: [
      "normalizeEmploymentType() in job-normalizer.js rejects dash-only values (returns fallback)",
      "validate-public-data.js now validates job_type against VALID_JOB_TYPES",
      "Frontend normalizeEmploymentTypeLabel() returns empty string for dash-only values",
      "Raw data files patched: dash-only job_type values nulled out"
    ]
  };

  // === Generate working-sources-missing-pending report ===
  const workingSourcesReport = {
    generated_at: nowIso(),
    summary: {
      total_sources_checked: workingFindings.length,
      sources_in_sources_json: sources.length,
      sources_in_prospects: prospects.length,
      sources_with_pending_jobs: workingFindings.filter(f => f.jobs_in_pending > 0).length,
      sources_with_jobs_but_no_pending: workingFindings.filter(f => f.jobs_detected > 0 && f.jobs_in_pending === 0).length,
      sources_with_fetch_failures: workingFindings.filter(f => f.fetch_failures >= 5).length,
      sources_requiring_attention: needsAttention.length,
      fix_applied: "source-utils.js normalizeSource() no longer disables sync for manual_review_required sources — they will now sync normally"
    },
    sources_requiring_attention: needsAttention.slice(0, 50),
    all_sources: workingFindings.slice(0, 100),
    common_blockers: [
      {
        blocker: "sync_enabled = false (manual_review_required)",
        count: workingFindings.filter(f => !f.sync_enabled && f.manual_review_required).length,
        impact: "Sources blocked from both sync-sources and sync-custom",
        status: "FIXED: source-utils.js normalizeSource() no longer disables sync for manual_review_required"
      },
      {
        blocker: "Persistent fetch failures (5+)",
        count: workingFindings.filter(f => f.fetch_failures >= 5).length,
        impact: "ATS API calls fail repeatedly, no new jobs",
        status: "Requires board URL/token verification per source"
      },
      {
        blocker: "Parser disabled (parser_enabled=false)",
        count: workingFindings.filter(f => !f.parser_enabled).length,
        impact: "Custom sources with parser disabled produce no jobs",
        status: "Requires enabling parser or manual-review fallback"
      },
      {
        blocker: "Jobs found but 0 added to pending",
        count: workingFindings.filter(f => f.jobs_detected > 0 && f.jobs_added_to_pending === 0).length,
        impact: "ATS returns jobs but all are filtered/deduped before pending",
        status: "Check relevance thresholds, dedup logic, and backlog routing"
      },
      {
        blocker: "No source_url or careers_url",
        count: workingFindings.filter(f => !f.source_url).length,
        impact: "Sources without URLs cannot be fetched",
        status: "Add career page URLs"
      }
    ]
  };

  // Write reports
  await Promise.all([
    fs.writeFile(path.join(REPORTS, "job-type-normalization-report.json"), JSON.stringify(jobTypeReport, null, 2) + "\n", "utf8"),
    fs.writeFile(path.join(REPORTS, "working-sources-missing-pending-report.json"), JSON.stringify(workingSourcesReport, null, 2) + "\n", "utf8"),
  ]);

  // Write markdown versions
  const jtMd = generateJobTypeMd(jobTypeReport);
  const wsMd = generateWorkingSourcesMd(workingSourcesReport);

  await Promise.all([
    fs.writeFile(path.join(REPORTS, "job-type-normalization-report.md"), jtMd, "utf8"),
    fs.writeFile(path.join(REPORTS, "working-sources-missing-pending-report.md"), wsMd, "utf8"),
  ]);

  console.log(JSON.stringify({
    phase: "fix-and-report-editorial-issues",
    job_type_fixes: { total_fixed: totalFixed, files: fixResults.map(r => ({ file: r.file, fixed: r.fixed })) },
    working_sources: {
      total: workingFindings.length,
      needs_attention: needsAttention.length,
      common_blockers: workingSourcesReport.common_blockers.map(b => ({ blocker: b.blocker, count: b.count }))
    }
  }, null, 2));
}

function generateJobTypeMd(r) {
  return [
    "# Job Type Normalization Report",
    "",
    `Generated: ${r.generated_at}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Files Checked", value: r.summary.total_files_checked },
      { metric: "Dash-Only Values Fixed", value: r.summary.total_dash_only_values_fixed },
    ], ["metric", "value"]),
    "",
    "## Per-File Fixes",
    "",
    fmtTable(
      r.summary.files.map(f => ({ file: f.file, items: f.total_items, fixed: f.fixed, status: f.status })),
      ["file", "items", "fixed", "status"]
    ),
    "",
    "## Fixed Entries (sample)",
    "",
    fmtTable(
      r.fixed_entries.slice(0, 10).map(e => ({
        id: e.id, title: e.title, org: e.org, field: e.field, old_value: e.old_value
      })),
      ["id", "title", "org", "field", "old_value"]
    ),
    "",
    "## Fixes Applied",
    "",
    ...r.fixes_applied.map(f => `- ${f}`),
    ""
  ].join("\n");
}

function generateWorkingSourcesMd(r) {
  return [
    "# Working Sources Missing From Pending — Report",
    "",
    `Generated: ${r.generated_at}`,
    "",
    "## Summary",
    "",
    fmtTable([
      { metric: "Total Sources Checked", value: r.summary.total_sources_checked },
      { metric: "In sources.json", value: r.summary.sources_in_sources_json },
      { metric: "In source-prospects.json", value: r.summary.sources_in_prospects },
      { metric: "With Pending Jobs", value: r.summary.sources_with_pending_jobs },
      { metric: "With Jobs But No Pending", value: r.summary.sources_with_jobs_but_no_pending },
      { metric: "With Fetch Failures (5+)", value: r.summary.sources_with_fetch_failures },
      { metric: "Requiring Attention", value: r.summary.sources_requiring_attention },
    ], ["metric", "value"]),
    "",
    "## Fix Applied",
    "",
    r.summary.fix_applied,
    "",
    "## Common Blockers",
    "",
    fmtTable(
      r.common_blockers.map(b => ({
        blocker: b.blocker, count: b.count, status: b.status
      })),
      ["blocker", "count", "status"]
    ),
    "",
    "## Sources Requiring Attention",
    "",
    fmtTable(
      r.sources_requiring_attention.slice(0, 50).map(s => ({
        source: s.source_id,
        org: s.organization,
        url: s.source_url ? s.source_url.substring(0, 50) : "",
        fetch_status: s.fetch_status,
        jobs_detected: s.jobs_detected ?? "?",
        jobs_in_pending: s.jobs_in_pending,
        jobs_in_backlog: s.jobs_in_backlog,
        failures: s.fetch_failures,
        issues: s.issues.substring(0, 60),
        fix: s.recommended_fix.substring(0, 40)
      })),
      ["source", "org", "url", "fetch_status", "jobs_detected", "jobs_in_pending", "jobs_in_backlog", "failures", "issues", "fix"]
    ),
    ""
  ].join("\n");
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
