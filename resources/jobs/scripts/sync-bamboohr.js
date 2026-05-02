const { runSyncForTypes } = require("./sync-sources");

async function main() {
  await runSyncForTypes(["bamboohr"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-bamboohr] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
