const { runSyncForTypes } = require("./sync-sources");

async function main() {
  await runSyncForTypes(["recruitee"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sync-recruitee] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
