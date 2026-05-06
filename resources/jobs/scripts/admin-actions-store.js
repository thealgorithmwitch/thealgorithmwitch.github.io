const fs = require("fs/promises");
const {
  ADMIN_JOB_ACTIONS_SNAPSHOT_FILE,
  ADMIN_LOCAL_ACTIONS_FILE,
  ADMIN_ORG_RULES_FILE,
  ADMIN_PENDING_OVERRIDES_FILE,
  readJson,
  writeJson
} = require("./job-utils");

async function readPendingOverrides() {
  const payload = await readJson(ADMIN_PENDING_OVERRIDES_FILE, { jobs: {} });
  return payload && typeof payload.jobs === "object" ? payload : { jobs: {} };
}

async function writePendingOverrides(payload) {
  await writeJson(ADMIN_PENDING_OVERRIDES_FILE, payload);
}

async function readOrganizationRules() {
  const payload = await readJson(ADMIN_ORG_RULES_FILE, { hidden_organizations: [], rejected_organizations: [] });
  return {
    hidden_organizations: Array.isArray(payload.hidden_organizations) ? payload.hidden_organizations : [],
    rejected_organizations: Array.isArray(payload.rejected_organizations) ? payload.rejected_organizations : []
  };
}

async function writeOrganizationRules(payload) {
  await writeJson(ADMIN_ORG_RULES_FILE, payload);
}

async function readAdminActionSnapshot() {
  const payload = await readJson(ADMIN_JOB_ACTIONS_SNAPSHOT_FILE, { actions: [] });
  return Array.isArray(payload.actions) ? payload.actions : [];
}

async function writeAdminActionSnapshot(actions) {
  await writeJson(ADMIN_JOB_ACTIONS_SNAPSHOT_FILE, {
    generated_at: new Date().toISOString(),
    actions
  });
}

async function readLocalAdminActions() {
  const payload = await readJson(ADMIN_LOCAL_ACTIONS_FILE, { actions: [] });
  return Array.isArray(payload.actions) ? payload.actions : [];
}

async function writeLocalAdminActions(actions) {
  await writeJson(ADMIN_LOCAL_ACTIONS_FILE, {
    generated_at: new Date().toISOString(),
    actions
  });
}

async function loadBackendConfig(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  const readString = (key) => {
    const match = raw.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`, "i"));
    return match ? match[1] : "";
  };
  return {
    backendUrl: readString("backendUrl"),
    adminToken: readString("adminToken")
  };
}

module.exports = {
  loadBackendConfig,
  readAdminActionSnapshot,
  readLocalAdminActions,
  readOrganizationRules,
  readPendingOverrides,
  writeAdminActionSnapshot,
  writeLocalAdminActions,
  writeOrganizationRules,
  writePendingOverrides
};