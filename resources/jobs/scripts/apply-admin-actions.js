const path = require("path");
const {
  JOBS_FILE,
  PENDING_SYNCED_FILE,
  readJson,
  readJobs,
  readPendingSyncedJobs,
  writeJson
} = require("./job-utils");
const {
  buildJobRecord,
  readJobRecords,
  JOB_RECORDS_FILE
} = require("./public-records");
const {
  applyPublishLifecycle,
  resolveDisplayJobFromRecord,
  shouldShowPublicRecord
} = require("./lifecycle-utils");
const { normalizeJob, stringifySafe } = require("./job-normalizer");
const {
  loadBackendConfig,
  readAdminActionSnapshot,
  readLocalAdminActions,
  readOrganizationRules,
  readPendingOverrides,
  writeLocalAdminActions,
  writeOrganizationRules,
  writePendingOverrides
} = require("./admin-actions-store");
const { buildPagesFromRecords } = require("./generate-job-pages");

function buildPublishedDisplay(job) {
  return {
    title: stringifySafe(job.title),
    organization: stringifySafe(job.organization),
    location: stringifySafe(job.location),
    location_type: stringifySafe(job.workplace_type),
    pay_display: stringifySafe(job.salary),
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    role_type: stringifySafe(job.job_type),
    experience_level: stringifySafe(job.experience),
    sector: stringifySafe(job.sector),
    function: stringifySafe(job.function),
    tags: Array.isArray(job.tags) ? job.tags : [],
    description: stringifySafe(job.description),
    source_name: stringifySafe(job.source),
    source_url: stringifySafe(job.source_url),
    original_url: stringifySafe(job.original_url),
    date_collected: stringifySafe(job.date_posted),
    application_url: stringifySafe(job.apply_url),
    published: true,
    featured: Boolean(job.featured)
  };
}

function upsertJobRecord(records, pendingJob, status, options = {}) {
  const normalized = normalizeJob(pendingJob);
  const existingIndex = records.findIndex((record) => String(record.id) === String(normalized.id));
  const existing = existingIndex >= 0 ? records[existingIndex] : {};
  let next = buildJobRecord({ ...normalized, status }, existing);
  next.display = {
    ...(next.display || {}),
    ...buildPublishedDisplay(normalized),
    featured: options.featured === true || Boolean(normalized.featured)
  };
  next.featured = options.featured === true || Boolean(normalized.featured);
  next.admin_notes = stringifySafe(options.admin_notes || existing.admin_notes || "");
  if (status === "published") {
    next.status = "published";
    next.published = true;
    next.public_visibility = true;
    next = applyPublishLifecycle(next);
  } else {
    next.status = status;
    next.published = false;
    next.public_visibility = false;
    next.verification_status = status === "rejected" ? "removed" : "needs_review";
    next.stale_reason = options.stale_reason || "";
  }
  if (existingIndex >= 0) {
    records[existingIndex] = next;
  } else {
    records.push(next);
  }
}

function removePendingByIds(pendingJobs, ids) {
  const idSet = new Set(ids.map(String));
  return pendingJobs.filter((job) => !idSet.has(String(job.id)));
}

function applyPendingJobMutations(pendingJobs, ids, mutator) {
  const idSet = new Set(ids.map(String));
  return pendingJobs.map((job) => (idSet.has(String(job.id)) ? mutator(job) : job));
}

async function fetchAndSnapshotActions() {
  const config = await loadBackendConfig(path.join(__dirname, "jobs-backend-config.js"));
  const backendUrl = process.env.JOBS_BACKEND_URL || config.backendUrl;
  const adminToken = process.env.JOBS_ADMIN_TOKEN || config.adminToken;

  if (!backendUrl || !adminToken) {
    return {
      actions: await readLocalAdminActions(),
      backendUrl: "",
      adminToken: "",
      source: "local"
    };
  }

  const response = await fetch(backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "getLocalJobActions",
      token: adminToken,
      adminToken
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return {
    actions: Array.isArray(payload.items) ? payload.items : [],
    backendUrl,
    adminToken,
    source: "backend"
  };
}

async function resolveActions(backendUrl, adminToken, ids) {
  if (!backendUrl || !adminToken || !ids.length) return;
  await fetch(backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "resolveLocalJobActions",
      token: adminToken,
      adminToken,
      ids
    })
  });
}

async function resolveLocalActions(ids, actions) {
  if (!ids.length) return;
  const idSet = new Set(ids.map(String));
  const now = new Date().toISOString();
  const nextActions = actions.map((action) => {
    if (!idSet.has(String(action.id || ""))) return action;
    return {
      ...action,
      status: "applied",
      updated_at: now
    };
  });
  await writeLocalAdminActions(nextActions);
}

async function main() {
  const [pendingJobs, jobRecords, existingPublicJobs, orgRules, overrides] = await Promise.all([
    readPendingSyncedJobs(),
    readJobRecords(),
    readJobs(),
    readOrganizationRules(),
    readPendingOverrides()
  ]);
  const fetched = await fetchAndSnapshotActions();
  if (fetched.source === "backend") {
    console.log("[jobs:apply-admin-actions] using backend queue");
  } else {
    console.log("[jobs:apply-admin-actions] using local action file");
  }
  const actions = fetched.actions
    .filter((item) => String(item.status || "").toLowerCase() === "queued")
    .map((item) => ({
      id: String(item.id || ""),
      operation: String(item.operation || ""),
      payload: (() => {
        try {
          return JSON.parse(item.payload_json || "{}");
        } catch (_error) {
          return {};
        }
      })()
    }));

  if (!actions.length) {
    console.log("[jobs:apply-admin-actions] no actions found");
    return;
  }

  let nextPending = [...pendingJobs];
  const nextRecords = [...jobRecords];
  const nextOverrides = { ...(overrides || { jobs: {} }), jobs: { ...((overrides && overrides.jobs) || {}) } };
  const nextOrgRules = {
    hidden_organizations: [...orgRules.hidden_organizations],
    rejected_organizations: [...orgRules.rejected_organizations]
  };

  const report = {
    recordsPublished: 0,
    recordsArchivedOrRejected: 0,
    recordsLeftPending: 0,
    jobPagesRegenerated: 0
  };

  const appliedIds = [];

  for (const action of actions) {
    const ids = Array.isArray(action.payload.ids) ? action.payload.ids.map(String) : [];
    const selectedJobs = Array.isArray(action.payload.jobs) ? action.payload.jobs : [];
    if (action.operation === "publish_selected") {
      const pendingSelection = nextPending.filter((job) => ids.includes(String(job.id)));
      for (const job of pendingSelection) {
        upsertJobRecord(nextRecords, { ...job, featured: Boolean(job.featured) }, "published", { featured: Boolean(job.featured) });
        delete nextOverrides.jobs[String(job.id)];
        report.recordsPublished += 1;
      }
      nextPending = removePendingByIds(nextPending, ids);
    } else if (action.operation === "archive_selected") {
      const pendingSelection = nextPending.filter((job) => ids.includes(String(job.id)));
      for (const job of pendingSelection) {
        upsertJobRecord(nextRecords, job, "archived", { stale_reason: "archived by admin" });
        nextOverrides.jobs[String(job.id)] = {
          ...(nextOverrides.jobs[String(job.id)] || {}),
          exclude_from_pending: true,
          exclude_reason: "archived by admin"
        };
        report.recordsArchivedOrRejected += 1;
      }
      nextPending = removePendingByIds(nextPending, ids);
    } else if (action.operation === "mark_needs_cleanup") {
      nextPending = applyPendingJobMutations(nextPending, ids, (job) => ({
        ...job,
        triage_bucket: "needs_cleanup",
        triage_reason: "marked needs cleanup by admin"
      }));
      ids.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          triage_bucket: "needs_cleanup",
          triage_reason: "marked needs cleanup by admin"
        };
      });
    } else if (action.operation === "mark_reviewed") {
      nextPending = applyPendingJobMutations(nextPending, ids, (job) => ({
        ...job,
        admin_review_state: "reviewed"
      }));
      ids.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          admin_review_state: "reviewed"
        };
      });
    } else if (action.operation === "feature_selected") {
      nextPending = applyPendingJobMutations(nextPending, ids, (job) => ({
        ...job,
        featured: true
      }));
      ids.forEach((id) => {
        nextOverrides.jobs[String(id)] = {
          ...(nextOverrides.jobs[String(id)] || {}),
          featured: true
        };
      });
    } else if (action.operation === "hide_organization") {
      const organization = String(action.payload.organization || selectedJobs[0]?.organization || "").trim();
      if (organization && !nextOrgRules.hidden_organizations.includes(organization)) {
        nextOrgRules.hidden_organizations.push(organization);
      }
      nextPending = nextPending.filter((job) => String(job.organization || "").trim() !== organization);
    } else if (action.operation === "reject_all_from_organization") {
      const organization = String(action.payload.organization || selectedJobs[0]?.organization || "").trim();
      if (organization && !nextOrgRules.rejected_organizations.includes(organization)) {
        nextOrgRules.rejected_organizations.push(organization);
      }
      const rejectedJobs = nextPending.filter((job) => String(job.organization || "").trim() === organization);
      for (const job of rejectedJobs) {
        upsertJobRecord(nextRecords, job, "rejected", { stale_reason: "rejected by admin" });
        nextOverrides.jobs[String(job.id)] = {
          ...(nextOverrides.jobs[String(job.id)] || {}),
          exclude_from_pending: true,
          exclude_reason: "rejected by admin"
        };
        report.recordsArchivedOrRejected += 1;
      }
      nextPending = nextPending.filter((job) => String(job.organization || "").trim() !== organization);
    }
    appliedIds.push(action.id);
  }

  await writePendingOverrides(nextOverrides);
  await writeOrganizationRules(nextOrgRules);
  await writeJson(PENDING_SYNCED_FILE, nextPending);
  await writeJson(JOB_RECORDS_FILE, nextRecords);

  const publicJobs = nextRecords
    .filter((record) => record.record_type === "job" && shouldShowPublicRecord(record))
    .map(resolveDisplayJobFromRecord);
  await writeJson(JOBS_FILE, publicJobs.length ? publicJobs : existingPublicJobs);
  report.recordsLeftPending = nextPending.length;
  report.jobPagesRegenerated = await buildPagesFromRecords(nextRecords);

  await resolveActions(fetched.backendUrl, fetched.adminToken, appliedIds);
  if (fetched.source === "local") {
    await resolveLocalActions(appliedIds, fetched.actions);
  }

  console.log(
    `[jobs:apply-admin-actions] records published=${report.recordsPublished} records archived/rejected=${report.recordsArchivedOrRejected} records left pending=${report.recordsLeftPending} job pages regenerated=${report.jobPagesRegenerated}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:apply-admin-actions] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
