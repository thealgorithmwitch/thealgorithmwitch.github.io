const path = require("path");
const {
  loadBackendConfig,
  readLocalAdminActions,
  writeAdminActionSnapshot
} = require("./admin-actions-store");

async function fetchActions(backendUrl, adminToken) {
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
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    payload = {};
  }
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.responsePreview = responseText.slice(0, 300);
    throw error;
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

async function main() {
  const config = await loadBackendConfig(path.join(__dirname, "jobs-backend-config.js"));
  const backendUrl = process.env.JOBS_BACKEND_URL || config.backendUrl;
  const adminToken = process.env.JOBS_ADMIN_TOKEN || config.adminToken;
  let actions = [];

  if (backendUrl && adminToken) {
    console.log("Using backend queue.");
    try {
      actions = await fetchActions(backendUrl, adminToken);
    } catch (error) {
      console.error(`[jobs:snapshot-admin-actions] HTTP status: ${error.httpStatus || "unknown"}`);
      console.error(`[jobs:snapshot-admin-actions] Response text preview: ${error.responsePreview || error.message}`);
      console.error("[jobs:snapshot-admin-actions] Fallback to local action file: yes");
      actions = await readLocalAdminActions();
    }
  } else {
    console.log("Backend config missing; falling back to local action file.");
    actions = await readLocalAdminActions();
  }

  await writeAdminActionSnapshot(actions);
  if (!actions.length) {
    console.log("[jobs:snapshot-admin-actions] no actions found");
    return;
  }
  console.log(`[jobs:snapshot-admin-actions] Wrote ${actions.length} actions to local snapshot.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:snapshot-admin-actions] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
