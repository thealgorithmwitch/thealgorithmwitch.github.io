const fs = require("fs/promises");
const path = require("path");
const { readJson, readJobs, readPendingSyncedJobs, readSources } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { readSourceHealthSnapshot } = require("./source-health-store");

const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const SOURCE_PROSPECTS_FILE = path.join(ROOT, "source-prospects.json");
const SEARCH_SOURCES_FILE = path.join(ROOT, "search-sources.json");
const JOBS2_FILE = path.join(ROOT, "jobs2.json");
const OUTPUT_JSON = path.join(REPORTS_DIR, "source-coverage-audit.json");
const OUTPUT_MD = path.join(REPORTS_DIR, "source-coverage-audit.md");

function text(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeStrings(values = [], limit = 20) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))).slice(0, limit);
}

function listTop(values = [], limit = 20) {
  return [...values].sort((left, right) => Number(right.count || 0) - Number(left.count || 0)).slice(0, limit);
}

function formatTable(rows = [], columns = []) {
  if (!rows.length) return "_None_";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\n/g, " ")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function summarizeCounts(items, key) {
  const counts = new Map();
  for (const item of items) {
    const nextKey = text(typeof key === "function" ? key(item) : item?.[key]);
    if (!nextKey) continue;
    counts.set(nextKey, Number(counts.get(nextKey) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getBacklogCount(pendingJobs = []) {
  return (Array.isArray(pendingJobs) ? pendingJobs : []).filter((job) => text(job.triage_bucket).toLowerCase() === "backlog").length;
}

function recommendedActionForEntry(entry) {
  if (entry.duplicate_source_records.length) return "merge_duplicate_source";
  if (entry.present_in_sources_json && entry.failed_sync_count >= 3) return "investigate_fetch_failures";
  if (entry.present_in_sources_json && !entry.public_job_count && !entry.pending_job_count && entry.source_status === "stale") return "investigate_no_jobs_found";
  if (!entry.present_in_sources_json && entry.present_in_source_prospects) return "add_to_sources_json";
  if (entry.present_in_sources_json && !entry.present_in_source_prospects) return "add_to_source_prospects";
  if (entry.public_job_count && !entry.present_in_sources_json) return "ready_for_manual_review";
  if (entry.pending_job_count && !entry.public_job_count) return "ready_for_manual_review";
  if (entry.present_in_sources_json && entry.source_status === "sync_error") return "fix_broken_source_url";
  if (entry.present_in_sources_json) return "keep_active_source";
  return "candidate_for_new_pull";
}

async function readProspects() {
  const payload = await readJson(SOURCE_PROSPECTS_FILE, []);
  return Array.isArray(payload) ? payload : Array.isArray(payload.sources) ? payload.sources : [];
}

async function readSearchSources() {
  const payload = await readJson(SEARCH_SOURCES_FILE, { queries: [] });
  return Array.isArray(payload.queries) ? payload.queries : [];
}

async function main() {
  const [sources, prospects, searchQueries, sourceHealth, jobs, records, pendingJobs, jobs2] = await Promise.all([
    readSources(),
    readProspects(),
    readSearchSources(),
    readSourceHealthSnapshot(),
    readJobs(),
    readJobRecords(),
    readPendingSyncedJobs(),
    readJson(JOBS2_FILE, [])
  ]);

  const pageFiles = await fs.readdir(path.join(ROOT, "pages")).catch(() => []);
  const htmlPageSet = new Set(pageFiles.filter((file) => file.endsWith(".html")));
  const sourceHealthById = new Map((sourceHealth.sources || []).map((entry) => [text(entry.source_id), entry]));
  const sourcesByNormalized = new Map();
  const prospectsByNormalized = new Map();
  const coverage = new Map();

  const registerEntry = (seed = {}) => {
    const displayName = text(seed.display_name || seed.organization || seed.name || seed.source_name);
    const normalizedName = normalizeName(displayName);
    if (!normalizedName) return null;
    const existing = coverage.get(normalizedName) || {
      display_name: displayName,
      normalized_name: normalizedName,
      source_id: "",
      homepage_url: "",
      careers_url: "",
      ats_provider: "",
      parser_type: "",
      source_classification: "",
      source_confidence: "",
      source_status: "",
      failed_sync_count: 0,
      last_checked_at: "",
      last_successful_sync: "",
      last_seen_at: "",
      public_job_count: 0,
      pending_job_count: 0,
      backlog_job_count: 0,
      generated_page_count: 0,
      active_public_titles: [],
      pending_titles: [],
      duplicate_source_records: [],
      missing_from_sources_json: true,
      missing_from_source_prospects: true,
      present_in_sources_json: false,
      present_in_source_prospects: false,
      present_in_public_jobs: false,
      present_in_pending_jobs: false,
      homepage_candidates: [],
      careers_url_candidates: [],
      source_ids: [],
      search_source_hits: 0,
      recommended_action: ""
    };
    coverage.set(normalizedName, existing);
    return existing;
  };

  for (const source of sources) {
    const entry = registerEntry({
      display_name: source.organization || source.name,
      source_id: source.id
    });
    if (!entry) continue;
    entry.display_name = entry.display_name || text(source.organization || source.name);
    entry.source_id = entry.source_id || text(source.id);
    entry.homepage_url = entry.homepage_url || text(source.url || source.homepage_url);
    entry.careers_url = entry.careers_url || text(source.source_url || source.url);
    entry.ats_provider = entry.ats_provider || text(source.provider || source.ats_provider);
    entry.parser_type = entry.parser_type || text(source.parser_type || source.type);
    entry.source_classification = entry.source_classification || text(source.source_classification);
    entry.source_confidence = entry.source_confidence || text(source.source_confidence_tier || source.source_confidence);
    entry.present_in_sources_json = true;
    entry.missing_from_sources_json = false;
    entry.homepage_candidates = dedupeStrings([...entry.homepage_candidates, text(source.url || source.homepage_url)], 5);
    entry.careers_url_candidates = dedupeStrings([...entry.careers_url_candidates, text(source.source_url || source.url)], 5);
    entry.source_ids = dedupeStrings([...entry.source_ids, text(source.id)], 10);
    const bucket = sourcesByNormalized.get(entry.normalized_name) || [];
    bucket.push(text(source.id));
    sourcesByNormalized.set(entry.normalized_name, bucket);
    const health = sourceHealthById.get(text(source.id));
    if (health) {
      entry.source_status = text(health.source_status || health.status);
      entry.failed_sync_count = Number(health.failed_sync_count || health.failure_error_count || 0);
      entry.last_checked_at = text(health.last_checked_at);
      entry.last_successful_sync = text(health.last_successful_sync);
      entry.last_seen_at = text(health.last_seen_at);
      entry.ats_provider = entry.ats_provider || text(health.ats_provider);
      entry.parser_type = entry.parser_type || text(health.parser_type);
      entry.source_classification = entry.source_classification || text(health.source_classification);
      entry.source_confidence = entry.source_confidence || text(health.source_confidence);
    }
  }

  for (const prospect of prospects) {
    const entry = registerEntry({
      display_name: prospect.organization || prospect.display_name || prospect.name,
      source_id: prospect.source_id
    });
    if (!entry) continue;
    entry.display_name = entry.display_name || text(prospect.organization || prospect.display_name || prospect.name);
    entry.homepage_url = entry.homepage_url || text(prospect.homepage || prospect.homepage_url);
    entry.careers_url = entry.careers_url || text(prospect.careers_url_estimate || prospect.source_url);
    entry.ats_provider = entry.ats_provider || text(prospect.ats_provider);
    entry.parser_type = entry.parser_type || text(prospect.parser_type);
    entry.source_classification = entry.source_classification || text(prospect.source_classification);
    entry.source_confidence = entry.source_confidence || text(prospect.source_confidence_tier);
    entry.present_in_source_prospects = true;
    entry.missing_from_source_prospects = false;
    const bucket = prospectsByNormalized.get(entry.normalized_name) || [];
    bucket.push(entry.display_name);
    prospectsByNormalized.set(entry.normalized_name, bucket);
  }

  for (const query of searchQueries) {
    const candidates = Array.isArray(query?.candidates) ? query.candidates : [];
    for (const candidate of candidates) {
      const entry = registerEntry({
        display_name: candidate.organization || candidate.name
      });
      if (!entry) continue;
      entry.search_source_hits += 1;
      entry.homepage_candidates = dedupeStrings([...entry.homepage_candidates, text(candidate.homepage_url || candidate.url)], 5);
      entry.careers_url_candidates = dedupeStrings([...entry.careers_url_candidates, text(candidate.careers_url || candidate.detected_job_url)], 5);
    }
  }

  for (const job of jobs) {
    const entry = registerEntry({
      display_name: job.organization,
      source_id: job.source_id
    });
    if (!entry) continue;
    entry.public_job_count += 1;
    entry.present_in_public_jobs = true;
    entry.active_public_titles = dedupeStrings([...entry.active_public_titles, job.title], 25);
    if (text(job.page_url).replace(/^\.\/pages\//, "") && htmlPageSet.has(text(job.page_url).replace(/^\.\/pages\//, ""))) {
      entry.generated_page_count += 1;
    }
  }

  for (const job of pendingJobs) {
    const entry = registerEntry({
      display_name: job.organization,
      source_id: job.source_id
    });
    if (!entry) continue;
    entry.pending_job_count += 1;
    entry.backlog_job_count += text(job.triage_bucket).toLowerCase() === "backlog" ? 1 : 0;
    entry.present_in_pending_jobs = true;
    entry.pending_titles = dedupeStrings([...entry.pending_titles, job.title], 25);
  }

  for (const record of records) {
    const entry = registerEntry({
      display_name: record.display?.organization || record.raw_source_data?.organization,
      source_id: record.raw_source_data?.source_id || record.source_id
    });
    if (!entry) continue;
    entry.source_id = entry.source_id || text(record.raw_source_data?.source_id || record.source_id);
  }

  const entries = Array.from(coverage.values()).map((entry) => {
    entry.duplicate_source_records = dedupeStrings([
      ...(sourcesByNormalized.get(entry.normalized_name) || []),
      ...((prospectsByNormalized.get(entry.normalized_name) || []).length > 1 ? prospectsByNormalized.get(entry.normalized_name) : [])
    ], 20).slice(1);
    entry.recommended_action = recommendedActionForEntry(entry);
    return entry;
  }).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const activeSourcesByProvider = summarizeCounts(entries.filter((entry) => entry.present_in_sources_json), "ats_provider");
  const activeSourcesByClassification = summarizeCounts(entries.filter((entry) => entry.present_in_sources_json), "source_classification");
  const publicJobsByOrganization = listTop(entries.filter((entry) => entry.public_job_count > 0).map((entry) => ({ organization: entry.display_name, count: entry.public_job_count })));
  const pendingJobsByOrganization = listTop(entries.filter((entry) => entry.pending_job_count > 0).map((entry) => ({ organization: entry.display_name, count: entry.pending_job_count })));
  const prospectsNotInSources = entries.filter((entry) => entry.present_in_source_prospects && !entry.present_in_sources_json);
  const sourcesNotInProspects = entries.filter((entry) => entry.present_in_sources_json && !entry.present_in_source_prospects);
  const repeatedFailures = entries.filter((entry) => entry.failed_sync_count >= 3);
  const pendingButNoPublic = entries.filter((entry) => entry.pending_job_count > 0 && entry.public_job_count === 0);
  const publicButNoActiveSource = entries.filter((entry) => entry.public_job_count > 0 && !entry.present_in_sources_json);
  const duplicateOrgs = entries.filter((entry) => entry.duplicate_source_records.length > 0);
  const missingPreferredOrgs = entries.filter((entry) => entry.present_in_source_prospects && !entry.present_in_sources_json);
  const recommendedNextPulls = entries.filter((entry) => ["add_to_sources_json", "candidate_for_new_pull"].includes(entry.recommended_action));
  const disappearingOrgs = entries.filter((entry) => entry.source_status === "grace_missing");
  const malformedDescriptionByOrg = summarizeCounts(
    records.filter((record) => /malformed_opening_paragraph|malformed_description_template/i.test(String(record.raw_source_data?.parse_warning || ""))).map((record) => ({
      organization: text(record.display?.organization || record.raw_source_data?.organization)
    })),
    "organization"
  );
  const lowRelevanceByOrg = summarizeCounts(
    pendingJobs.filter((job) => Number(job.relevance_score || 0) <= 2 || text(job.skip_reason) === "broad_source_low_relevance").map((job) => ({
      organization: text(job.organization)
    })),
    "organization"
  );
  const restoreCandidatesFromJobs2 = (Array.isArray(jobs2) ? jobs2 : [])
    .filter((job) => !jobs.some((current) => text(current.id) === text(job.id)))
    .map((job) => ({
      organization: text(job.organization),
      title: text(job.title),
      source_url: text(job.source_url || job.apply_url)
    }))
    .slice(0, 100);

  const report = {
    generated_at: new Date().toISOString(),
    totals: {
      sources: sources.length,
      prospects: prospects.length,
      public_organizations: entries.filter((entry) => entry.public_job_count > 0).length,
      pending_organizations: entries.filter((entry) => entry.pending_job_count > 0).length
    },
    entries,
    summaries: {
      active_sources_by_provider: activeSourcesByProvider,
      active_sources_by_classification: activeSourcesByClassification,
      public_jobs_by_organization: publicJobsByOrganization,
      pending_jobs_by_organization: pendingJobsByOrganization,
      prospects_not_in_sources_json: prospectsNotInSources.map((entry) => entry.display_name),
      sources_not_in_source_prospects: sourcesNotInProspects.map((entry) => entry.display_name),
      sources_with_repeated_fetch_failures: repeatedFailures.map((entry) => entry.display_name),
      sources_with_pending_but_zero_public: pendingButNoPublic.map((entry) => entry.display_name),
      sources_with_public_but_no_active_source: publicButNoActiveSource.map((entry) => entry.display_name),
      duplicate_or_near_duplicate_org_names: duplicateOrgs.map((entry) => ({
        display_name: entry.display_name,
        duplicate_source_records: entry.duplicate_source_records
      })),
      active_public_orgs_without_sources: publicButNoActiveSource.map((entry) => entry.display_name),
      orgs_disappearing_reappearing: disappearingOrgs.map((entry) => entry.display_name),
      top_sources_by_corruption_rate: listTop(malformedDescriptionByOrg.map((entry) => ({ organization: entry.name, count: entry.count })), 20),
      top_sources_by_low_relevance_rate: listTop(lowRelevanceByOrg.map((entry) => ({ organization: entry.name, count: entry.count })), 20),
      high_priority_missing_orgs: missingPreferredOrgs.map((entry) => entry.display_name),
      recommended_next_orgs_to_add: recommendedNextPulls.map((entry) => entry.display_name),
      restore_candidates_from_jobs2: restoreCandidatesFromJobs2
    }
  };

  const markdownSections = [
    "# Source Coverage Audit",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Total sources: ${report.totals.sources}`,
    `- Total prospects: ${report.totals.prospects}`,
    `- Total public organizations: ${report.totals.public_organizations}`,
    `- Total pending organizations: ${report.totals.pending_organizations}`,
    "",
    "## Active Source Coverage",
    "",
    formatTable(
      listTop(entries.filter((entry) => entry.present_in_sources_json).map((entry) => ({
        organization: entry.display_name,
        source_id: entry.source_id,
        provider: entry.ats_provider,
        classification: entry.source_classification,
        status: entry.source_status,
        failed_syncs: entry.failed_sync_count,
        public_jobs: entry.public_job_count,
        pending_jobs: entry.pending_job_count
      })), 50),
      ["organization", "source_id", "provider", "classification", "status", "failed_syncs", "public_jobs", "pending_jobs"]
    ),
    "",
    "## Public Job Coverage",
    "",
    formatTable(publicJobsByOrganization.map((entry) => ({
      organization: entry.organization,
      public_jobs: entry.count
    })), ["organization", "public_jobs"]),
    "",
    "## Pending Review Coverage",
    "",
    formatTable(pendingJobsByOrganization.map((entry) => ({
      organization: entry.organization,
      pending_jobs: entry.count
    })), ["organization", "pending_jobs"]),
    "",
    "## Missing Preferred Orgs",
    "",
    formatTable(missingPreferredOrgs.slice(0, 50).map((entry) => ({
      organization: entry.display_name,
      homepage_url: entry.homepage_url,
      careers_url: entry.careers_url,
      recommended_action: entry.recommended_action
    })), ["organization", "homepage_url", "careers_url", "recommended_action"]),
    "",
    "## Broken / Failing Sources",
    "",
    formatTable(repeatedFailures.slice(0, 50).map((entry) => ({
      organization: entry.display_name,
      source_id: entry.source_id,
      failed_sync_count: entry.failed_sync_count,
      source_status: entry.source_status,
      last_checked_at: entry.last_checked_at,
      recommended_action: entry.recommended_action
    })), ["organization", "source_id", "failed_sync_count", "source_status", "last_checked_at", "recommended_action"]),
    "",
    "## Public Orgs Without Sources",
    "",
    formatTable(publicButNoActiveSource.slice(0, 50).map((entry) => ({
      organization: entry.display_name,
      public_jobs: entry.public_job_count,
      recommended_action: entry.recommended_action
    })), ["organization", "public_jobs", "recommended_action"]),
    "",
    "## Restore Candidates From jobs2.json",
    "",
    formatTable(restoreCandidatesFromJobs2.slice(0, 50), ["organization", "title", "source_url"]),
    "",
    "## Duplicate Cleanup",
    "",
    formatTable(duplicateOrgs.slice(0, 50).map((entry) => ({
      organization: entry.display_name,
      duplicates: entry.duplicate_source_records.join(", "),
      recommended_action: entry.recommended_action
    })), ["organization", "duplicates", "recommended_action"]),
    "",
    "## Recommended Next Pulls",
    "",
    formatTable(recommendedNextPulls.slice(0, 50).map((entry) => ({
      organization: entry.display_name,
      careers_url: entry.careers_url,
      recommendation: entry.recommended_action
    })), ["organization", "careers_url", "recommendation"])
  ];

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(OUTPUT_MD, markdownSections.join("\n") + "\n", "utf8");

  console.log(`[jobs:audit-source-coverage] total_sources=${sources.length}`);
  console.log(`[jobs:audit-source-coverage] total_prospects=${prospects.length}`);
  console.log(`[jobs:audit-source-coverage] total_public_organizations=${report.totals.public_organizations}`);
  console.log(`[jobs:audit-source-coverage] total_pending_organizations=${report.totals.pending_organizations}`);
  console.log(`[jobs:audit-source-coverage] prospects_missing_from_sources=${prospectsNotInSources.length}`);
  console.log(`[jobs:audit-source-coverage] sources_failing_repeatedly=${repeatedFailures.length}`);
  console.log(`[jobs:audit-source-coverage] top_public_orgs=${JSON.stringify(publicJobsByOrganization.slice(0, 20))}`);
  console.log(`[jobs:audit-source-coverage] top_pending_orgs=${JSON.stringify(pendingJobsByOrganization.slice(0, 20))}`);
  console.log(`[jobs:audit-source-coverage] top_missing_preferred_orgs=${JSON.stringify(missingPreferredOrgs.slice(0, 50).map((entry) => entry.display_name))}`);
}

main().catch((error) => {
  console.error(`[jobs:audit-source-coverage] Failed: ${error.message}`);
  process.exitCode = 1;
});
