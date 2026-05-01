const { runSyncForTypes } = require("./sync-sources");
const { fetchGreenhouseJobsForSource, greenhouseJobToSchema } = require("./ats-clients");

async function main() {
  await runSyncForTypes(["greenhouse"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-greenhouse] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchGreenhouseJobsForSource,
  greenhouseJobToSchema
};
