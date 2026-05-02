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
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

async function main() {
  const config = await loadBackendConfig(path.join(__dirname, "jobs-backend-config.js"));
  const backendUrl = process.env.JOBS_BACKEND_URL || config.backendUrl;
  const adminToken = process.env.JOBS_ADMIN_TOKEN || config.adminToken;
  let actions = [];

  if (backendUrl && adminToken) {
    console.log("[jobs:snapshot-admin-actions] using backend queue");
    actions = await fetchActions(backendUrl, adminToken);
  } else {
    console.log("[jobs:snapshot-admin-actions] using local action file");
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
