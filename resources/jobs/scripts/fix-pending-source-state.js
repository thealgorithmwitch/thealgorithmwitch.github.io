const fs = require("fs/promises");
const path = require("path");
const {
  SOURCES_FILE,
  PENDING_SYNCED_FILE,
  readPendingSyncedJobs,
  readSources,
  writeJson
} = require("./job-utils");
const { normalizeProvider, normalizeSource, shouldUseDiscoverySync, isDirectAtsSource } = require("./source-utils");
const { readSourceHealthSnapshot, SOURCE_HEALTH_FILE } = require("./source-health-store");

const ROOT = path.resolve(__dirname, "..");
const REPORT_FILE = path.join(ROOT, "reports", "pending-source-state-audit.json");
const CLIMATE_SOURCE_ID = "climatechangejobs";
const LOW_RELEVANCE_SOURCE_IDS = ["saas-group"];
const BROAD_CONTROLLED_SOURCE_IDS = ["quince", "woolpert"];
const AUDIT_PROVIDERS = new Set(["paylocity", "workday", "smartrecruiters", "greenhouse"]);
const ADAPTER_PROVIDERS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "bamboohr",
  "recruitee",
  "smartrecruiters",
  "workable"
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toFlagSet(job = {}) {
  const reviewFlags = Array.isArray(job.review_flags)
    ? job.review_flags
    : typeof job.review_flags === "string"
      ? String(job.review_flags).split(",")
      : [];
  return new Set(
    reviewFlags
      .map((flag) => String(flag || "").trim())
      .filter(Boolean)
  );
}

function mergeNote(...values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(" | ");
}

function isClimateChangeJobsPending(job = {}) {
  const sourceId = String(job.source_id || "").trim().toLowerCase();
  const source = String(job.source || "").trim().toLowerCase();
  const sourceUrl = String(job.source_url || job.original_url || job.apply_url || "").trim().toLowerCase();
  return sourceId === CLIMATE_SOURCE_ID
    || source === CLIMATE_SOURCE_ID
    || sourceUrl.includes("climatechangejobs.com");
}

function archiveDisabledClimatePendingJob(job) {
  const flags = toFlagSet(job);
  flags.add("source_disabled");
  flags.add("archived_source");
  flags.add("hidden_from_review");

  const note = "Source disabled: Climate Change Jobs records are archived from the default pending review queue and preserved for audit history.";

  return {
    ...job,
    source_disabled: true,
    archived_source: true,
    hidden_from_review: true,
    review_flags: Array.from(flags),
    parser_warning: mergeNote(job.parser_warning, "source_disabled_archived"),
    admin_note: mergeNote(job.admin_note, note),
    archived_source_reason: "disabled source retained for audit history",
    archived_source_at: String(job.archived_source_at || new Date().toISOString())
  };
}

function isLowRelevancePending(job = {}) {
  return LOW_RELEVANCE_SOURCE_IDS.includes(String(job.source_id || "").trim().toLowerCase());
}

function isBroadControlledPending(job = {}) {
  return BROAD_CONTROLLED_SOURCE_IDS.includes(String(job.source_id || "").trim().toLowerCase());
}

function hideLowRelevancePendingJob(job) {
  const flags = toFlagSet(job);
  flags.add("source_low_confidence");
  flags.add("broad_non_mission_source");
  flags.add("hidden_from_review_default");

  return {
    ...job,
    hidden_from_review: true,
    hidden_from_review_default: true,
    review_flags: Array.from(flags),
    parser_warning: mergeNote(job.parser_warning, "broad_non_mission_source_hidden"),
    admin_note: mergeNote(
      job.admin_note,
      "Low-relevance broad commercial source hidden from default pending review; retained for audit and manual override only."
    )
  };
}

function disableLowRelevanceSource(source) {
  const notes = String(source.notes || "").trim();
  const disableNote = "Disabled from automated pending sync because the source is a low-relevance broad commercial board.";
  return {
    ...source,
    enabled: false,
    custom_sync_enabled: false,
    high_confidence_immediate_upload: false,
    notes: notes.includes(disableNote) ? notes : `${notes} ${disableNote}`.trim()
  };
}

function restoreBroadControlledPendingJob(job) {
  const flags = Array.from(toFlagSet(job)).filter((flag) => ![
    "source_low_confidence",
    "broad_non_mission_source",
    "hidden_from_review_default"
  ].includes(flag));

  return {
    ...job,
    hidden_from_review: false,
    hidden_from_review_default: false,
    review_flags: flags,
    parser_warning: mergeNote(
      ...String(job.parser_warning || "")
        .split("|")
        .map((item) => String(item || "").trim())
        .filter((item) => item && item !== "broad_non_mission_source_hidden")
    ),
    admin_note: mergeNote(
      ...String(job.admin_note || "")
        .split("|")
        .map((item) => String(item || "").trim())
        .filter((item) => item && !/Low-relevance broad commercial source hidden from default pending review/i.test(item))
    )
  };
}

function restoreBroadControlledSource(source) {
  const notes = String(source.notes || "")
    .replace(/\s*Disabled from automated pending sync because the source is a low-relevance broad commercial board\./i, "")
    .trim();
  return {
    ...source,
    enabled: true,
    custom_sync_enabled: true,
    high_confidence_immediate_upload: false,
    quality_mode: "pending",
    auto_publish: false,
    max_pending_per_sync: 5,
    target_position_matching: true,
    notes
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildSourceRouteAudit(source, healthEntry, pendingCounts) {
  const normalized = normalizeSource(source);
  const provider = normalizeProvider(normalized.provider || normalized.type || "");
  const directSyncEligible = isDirectAtsSource(normalized);
  const discoverySyncEligible = shouldUseDiscoverySync(normalized);
  const adapterExists = ADAPTER_PROVIDERS.has(provider);
  const attempted = Boolean(healthEntry);
  const pendingCount = Number(pendingCounts.get(String(normalized.id || "")) || 0);

  let route = "skip";
  let skipReason = "";

  if (!normalized.enabled) {
    skipReason = "disabled";
  } else if (directSyncEligible) {
    route = "jobs:sync-sources";
    if (!attempted) {
      skipReason = "eligible_for_jobs:sync-sources_but_not_attempted_in_latest_source_health";
    }
  } else if (discoverySyncEligible) {
    route = "jobs:sync-custom";
    if (!adapterExists && (provider === "paylocity" || provider === "workday")) {
      skipReason = "no_direct_or_custom_provider_adapter_for_source_type";
    } else if (!attempted) {
      skipReason = "eligible_for_jobs:sync-custom_but_not_attempted_in_latest_source_health";
    }
  } else if (!normalized.custom_sync_enabled && !directSyncEligible) {
    skipReason = "custom_sync_disabled_and_not_direct_supported";
  } else if (!adapterExists && provider) {
    skipReason = "provider_adapter_missing";
  } else {
    skipReason = "not_selected_by_current_sync_routes";
  }

  const health = healthEntry
    ? {
        attempted: true,
        jobs_found: Number(healthEntry.jobs_found || 0),
        jobs_normalized: Number(healthEntry.jobs_normalized || 0),
        jobs_written_to_pending: Number(healthEntry.pending_count_delta || 0),
        jobs_written_to_public: Number(healthEntry.public_count_delta || 0),
        failure_error_count: Number(healthEntry.failure_error_count || 0),
        skip_reasons: toArray(healthEntry.skip_reasons),
        last_successful_sync: String(healthEntry.last_successful_sync || "")
      }
    : {
        attempted: false,
        jobs_found: 0,
        jobs_normalized: 0,
        jobs_written_to_pending: 0,
        jobs_written_to_public: 0,
        failure_error_count: 0,
        skip_reasons: [],
        last_successful_sync: ""
      };

  return {
    source_id: String(normalized.id || ""),
    organization: String(normalized.organization || normalized.name || ""),
    type: String(normalized.type || ""),
    provider,
    enabled: normalized.enabled !== false,
    custom_sync_enabled: normalized.custom_sync_enabled !== false,
    high_confidence_immediate_upload: Boolean(normalized.high_confidence_immediate_upload),
    direct_sync_eligible: directSyncEligible,
    discovery_sync_eligible: discoverySyncEligible,
    adapter_exists: adapterExists,
    route,
    pending_count: pendingCount,
    source_url: String(normalized.source_url || ""),
    skip_reason: skipReason,
    source_health: health
  };
}

async function readFileMtime(filePath) {
  const stat = await fs.stat(filePath);
  return stat.mtime.toISOString();
}

async function main() {
  const write = process.argv.includes("--write");
  const [pendingJobs, sources, sourceHealth] = await Promise.all([
    readPendingSyncedJobs(),
    readSources(),
    readSourceHealthSnapshot()
  ]);

  const pendingCounts = new Map();
  for (const job of pendingJobs) {
    const sourceId = String(job.source_id || "").trim();
    if (!sourceId) continue;
    pendingCounts.set(sourceId, Number(pendingCounts.get(sourceId) || 0) + 1);
  }

  let archivedUpdatedCount = 0;
  let archivedTotalCount = 0;
  let lowRelevanceUpdatedCount = 0;
  let lowRelevanceTotalCount = 0;
  let broadControlledRestoredCount = 0;
  let broadControlledTotalCount = 0;
  const nextPendingJobs = pendingJobs.map((job) => {
    if (isClimateChangeJobsPending(job)) {
      archivedTotalCount += 1;
      const next = archiveDisabledClimatePendingJob(job);
      if (!sameJson(job, next)) archivedUpdatedCount += 1;
      return next;
    }
    if (isLowRelevancePending(job)) {
      lowRelevanceTotalCount += 1;
      const next = hideLowRelevancePendingJob(job);
      if (!sameJson(job, next)) lowRelevanceUpdatedCount += 1;
      return next;
    }
    if (isBroadControlledPending(job)) {
      broadControlledTotalCount += 1;
      const next = restoreBroadControlledPendingJob(job);
      if (!sameJson(job, next)) broadControlledRestoredCount += 1;
      return next;
    }
    return job;
  });

  let lowRelevanceSourcesUpdatedCount = 0;
  let broadControlledSourcesUpdatedCount = 0;
  const nextSources = sources.map((source) => {
    const sourceId = String(source.id || "").trim().toLowerCase();
    if (LOW_RELEVANCE_SOURCE_IDS.includes(sourceId)) {
      const next = disableLowRelevanceSource(source);
      if (!sameJson(source, next)) lowRelevanceSourcesUpdatedCount += 1;
      return next;
    }
    if (BROAD_CONTROLLED_SOURCE_IDS.includes(sourceId)) {
      const next = restoreBroadControlledSource(source);
      if (!sameJson(source, next)) broadControlledSourcesUpdatedCount += 1;
      return next;
    }
    return source;
  });

  const healthBySourceId = new Map(
    toArray(sourceHealth.sources).map((entry) => [String(entry.source_id || ""), entry])
  );

  const providerAudit = sources
    .filter((source) => {
      const normalized = normalizeSource(source);
      const provider = normalizeProvider(normalized.provider || normalized.type || "");
      return AUDIT_PROVIDERS.has(provider);
    })
    .map((source) => buildSourceRouteAudit(source, healthBySourceId.get(String(source.id || "")), pendingCounts))
    .sort((a, b) => a.source_id.localeCompare(b.source_id));

  const sourcesMtime = await readFileMtime(path.join(ROOT, "sources.json"));
  const pendingMtime = await readFileMtime(PENDING_SYNCED_FILE);
  const healthMtime = await readFileMtime(SOURCE_HEALTH_FILE);
  const healthGeneratedAt = String(sourceHealth.generated_at || "");
  const syncRanAfterSourceChanges = Boolean(healthGeneratedAt) && new Date(healthGeneratedAt).getTime() >= new Date(sourcesMtime).getTime();

  const summary = providerAudit.reduce((acc, entry) => {
    if (entry.source_health.attempted) acc.new_sources_attempted += 1;
    acc.jobs_found += entry.source_health.jobs_found;
    acc.jobs_normalized += entry.source_health.jobs_normalized;
    acc.jobs_written_to_pending += entry.source_health.jobs_written_to_pending;
    acc.jobs_written_to_public += entry.source_health.jobs_written_to_public;
    if (entry.skip_reason) {
      acc.skip_reasons[entry.skip_reason] = Number(acc.skip_reasons[entry.skip_reason] || 0) + 1;
    }
    return acc;
  }, {
    new_sources_attempted: 0,
    jobs_found: 0,
    jobs_normalized: 0,
    jobs_written_to_pending: 0,
    jobs_written_to_public: 0,
    skip_reasons: {}
  });

  const report = {
    generated_at: new Date().toISOString(),
    mode: write ? "write" : "dry_run",
    sync_ran_after_sources_changed: syncRanAfterSourceChanges,
    files: {
      sources_mtime: sourcesMtime,
      pending_mtime: pendingMtime,
      source_health_mtime: healthMtime,
      source_health_generated_at: healthGeneratedAt
    },
    climate_change_jobs: {
      source_enabled: Boolean(sources.find((source) => String(source.id || "") === CLIMATE_SOURCE_ID)?.enabled),
      pending_archived_count: archivedTotalCount,
      pending_updated_count: archivedUpdatedCount
    },
    low_relevance_sources: {
      source_ids: LOW_RELEVANCE_SOURCE_IDS,
      pending_hidden_count: lowRelevanceTotalCount,
      pending_updated_count: lowRelevanceUpdatedCount,
      sources_updated_count: lowRelevanceSourcesUpdatedCount
    },
    broad_controlled_sources: {
      source_ids: BROAD_CONTROLLED_SOURCE_IDS,
      pending_restored_count: broadControlledTotalCount,
      pending_updated_count: broadControlledRestoredCount,
      sources_updated_count: broadControlledSourcesUpdatedCount
    },
    source_audit_summary: summary,
    source_health_results: providerAudit
  };

  if (write) {
    if (archivedUpdatedCount > 0 || lowRelevanceUpdatedCount > 0 || broadControlledRestoredCount > 0) {
      await writeJson(PENDING_SYNCED_FILE, nextPendingJobs);
    }
    if (lowRelevanceSourcesUpdatedCount > 0 || broadControlledSourcesUpdatedCount > 0) {
      await writeJson(SOURCES_FILE, { sources: nextSources });
    }
  }
  await writeJson(REPORT_FILE, report);

  console.log(`[jobs:fix-pending-source-state] mode=${write ? "write" : "dry_run"} sync_ran_after_sources_changed=${syncRanAfterSourceChanges}`);
  console.log(`[jobs:fix-pending-source-state] climate_archived_count=${archivedTotalCount} climate_updated_count=${archivedUpdatedCount}`);
  console.log(`[jobs:fix-pending-source-state] low_relevance_pending_hidden_count=${lowRelevanceTotalCount} low_relevance_pending_updated_count=${lowRelevanceUpdatedCount} low_relevance_sources_updated_count=${lowRelevanceSourcesUpdatedCount}`);
  console.log(`[jobs:fix-pending-source-state] broad_controlled_pending_restored_count=${broadControlledTotalCount} broad_controlled_pending_updated_count=${broadControlledRestoredCount} broad_controlled_sources_updated_count=${broadControlledSourcesUpdatedCount}`);
  console.log(`[jobs:fix-pending-source-state] new_sources_attempted=${summary.new_sources_attempted} jobs_found=${summary.jobs_found} jobs_normalized=${summary.jobs_normalized} jobs_written_to_pending=${summary.jobs_written_to_pending}`);
  Object.entries(summary.skip_reasons).forEach(([reason, count]) => {
    console.log(`[jobs:fix-pending-source-state] skip_reason reason=${reason} count=${count}`);
  });
  providerAudit.forEach((entry) => {
    console.log(
      `[jobs:fix-pending-source-state] source_id=${entry.source_id} route=${entry.route} provider=${entry.provider} enabled=${entry.enabled} custom_sync_enabled=${entry.custom_sync_enabled} adapter_exists=${entry.adapter_exists} attempted=${entry.source_health.attempted} jobs_found=${entry.source_health.jobs_found} jobs_normalized=${entry.source_health.jobs_normalized} jobs_written_to_pending=${entry.source_health.jobs_written_to_pending} pending_count=${entry.pending_count} skip_reason=${entry.skip_reason || ""}`
    );
  });
  console.log(`[jobs:fix-pending-source-state] report=${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(`[jobs:fix-pending-source-state] ${error.message}`);
  process.exitCode = 1;
});
