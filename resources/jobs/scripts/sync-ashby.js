const { runSyncForTypes } = require("./sync-sources");

async function main() {
  await runSyncForTypes(["ashby"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-ashby] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
