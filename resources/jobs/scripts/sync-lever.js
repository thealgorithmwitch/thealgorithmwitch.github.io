const { runSyncForTypes } = require("./sync-sources");
const { fetchLeverJobsForSource, leverJobToSchema } = require("./ats-clients");

async function main() {
  await runSyncForTypes(["lever"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-lever] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchLeverJobsForSource,
  leverJobToSchema
};
