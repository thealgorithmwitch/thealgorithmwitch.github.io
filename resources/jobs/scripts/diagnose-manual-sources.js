const path = require("path");
const { readSources, readPendingSyncedJobs, readJobs } = require("./job-utils");
const { shouldUseDiscoverySync, inferSourceClassification, SOURCE_CLASSIFICATIONS } = require("./source-utils");
const { getSourceControlConfig } = require("./source-sync-quality");
const ATS_CLIENTS = require("./ats-clients");
const DIRECT_PROVIDER_TYPES = require("./ats-clients").DIRECT_PROVIDER_TYPES || new Set();

const ATS_PROVIDERS = require("./scrapers/discovery").ATS_PROVIDERS || [];
const DISCOVERY_MANUAL_SOURCES_FILE = path.resolve(__dirname, "..", "discovery-manual-sources.json");

function getStatusIcon(passed) {
  return passed ? "PASS" : "FAIL";
}

function formatPipelineGate(name, passed, detail = "") {
  return `  ${getStatusIcon(passed)} ${name}${detail ? ` — ${detail}` : ""}`;
}

async function diagnose() {
  const report = {
    generated_at: new Date().toISOString(),
    summary: { total_sources: 0, passed: 0, failed: 0, disabled: 0 },
    sources: []
  };

  const [sources, pendingJobs, publicJobs] = await Promise.all([
    readSources(),
    readPendingSyncedJobs().catch(() => []),
    readJobs().catch(() => [])
  ]);

  const manualSources = sources.filter((s) => s.manual_review_required === true);
  report.summary.total_sources = manualSources.length;

  for (const source of manualSources) {
    const entry = {
      source_id: source.id,
      organization: source.organization || source.name || "",
      type: source.type || "",
      provider: source.provider || "",
      enabled: source.enabled !== false,
      custom_sync_enabled: source.custom_sync_enabled !== false,
      url: source.url || source.source_url || "",
      pipeline_gates: [],
      checks: [],
      pending_jobs_count: 0,
      status: "unknown"
    };

    // GATE 1: Source must be enabled
    const isEnabled = source.enabled !== false;
    entry.checks.push({
      gate: "enabled",
      passed: isEnabled,
      detail: isEnabled ? "source is active" : "source is DISABLED — will not sync"
    });

    if (!isEnabled) {
      entry.status = "disabled";
      entry.pipeline_gates.push(formatPipelineGate("enabled", false, "DISABLED — will not sync"));
      entry.pipeline_gates.push(formatPipelineGate("sync-custom inclusion", false, "SKIPPED — source disabled"));
      report.summary.disabled += 1;
      report.sources.push(entry);
      continue;
    }

    const classification = inferSourceClassification(source);
    const shouldSync = shouldUseDiscoverySync(source);

    // GATE 2: source must pass shouldUseDiscoverySync
    entry.checks.push({
      gate: "shouldUseDiscoverySync",
      passed: shouldSync,
      detail: shouldSync
        ? `will be processed by sync-custom (classification: ${classification})`
        : `EXCLUDED from sync-custom (classification: ${classification})`
    });

    // GATE 3: ATS adapter availability
    const provider = source.provider || "";
    const isAts = source.type === "ats" || !!provider;
    let atsAdapterAvailable = false;
    let atsAdapterDetail = "";

    if (isAts && provider) {
      const normalProvider = String(provider).toLowerCase().trim();
      atsAdapterAvailable = typeof ATS_CLIENTS[`fetch${normalProvider.charAt(0).toUpperCase() + normalProvider.slice(1)}Jobs`] === "function";
      atsAdapterDetail = atsAdapterAvailable
        ? `ATS adapter "${normalProvider}" available`
        : `NO ATS adapter for "${normalProvider}" — may use generic discovery`;
    } else if (!isAts) {
      atsAdapterDetail = "non-ATS source — uses generic discovery scraper";
    } else {
      atsAdapterDetail = "no provider specified — uses generic discovery scraper";
    }

    entry.checks.push({
      gate: "ats_adapter",
      passed: !isAts || atsAdapterAvailable,
      detail: atsAdapterDetail
    });

    // GATE 4: should skip source-sync-quality relevance filter (now fixed)
    const controlConfig = getSourceControlConfig(source, { jobCount: 0 });
    const hadMaxPendingCap = (controlConfig.maxPendingPerSync || 0) > 0;

    entry.checks.push({
      gate: "source_sync_quality_gate",
      passed: true,
      detail: hadMaxPendingCap
        ? `WARN: max_pending_per_sync=${controlConfig.maxPendingPerSync} may cap jobs — manual_review_required bypass now applied`
        : "no quality cap — all jobs pass through to triage"
    });

    // GATE 5: Manual review bypass in pending-triage (classification check)
    const isTrackedManual = classification === SOURCE_CLASSIFICATIONS.TRACKED_MANUAL_ORG;
    const isCommunity = classification === SOURCE_CLASSIFICATIONS.COMMUNITY_SUBMISSION_SOURCE;

    entry.checks.push({
      gate: "pending_triage_bypass",
      passed: isTrackedManual || isCommunity,
      detail: isTrackedManual || isCommunity
        ? `classification "${classification}" will bypass relevance filter in classifyPendingJob`
        : `classification "${classification}" will NOT bypass — may be rejected by relevance filter`
    });

    // Check pending jobs count
    const sourcePending = pendingJobs.filter((j) => String(j.source_id || "") === String(source.id));
    entry.pending_jobs_count = sourcePending.length;

    // Determine overall status
    const allGatesPassed = entry.checks.every((c) => c.passed);
    entry.status = allGatesPassed ? "operational" : "blocked";

    if (allGatesPassed) {
      report.summary.passed += 1;
    } else {
      report.summary.failed += 1;
    }

    // Build pipeline gate display lines
    entry.pipeline_gates = entry.checks.map((c) => formatPipelineGate(c.gate, c.passed, c.detail));

    report.sources.push(entry);
  }

  // Sort: failed first, then disabled, then operational
  report.sources.sort((a, b) => {
    const statusOrder = { blocked: 0, disabled: 1, operational: 2 };
    return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3)
      || a.source_id.localeCompare(b.source_id);
  });

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  diagnose().catch((error) => {
    console.error(`[diagnose-manual-sources] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { diagnose };
