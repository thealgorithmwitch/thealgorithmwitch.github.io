const { PENDING_SYNCED_FILE, readJson, writeJson } = require("./job-utils");
const { JOB_RECORDS_FILE } = require("./public-records");

function isPublishedJobRecord(record) {
  return Boolean(
    record &&
    record.record_type === "job" &&
    String(record.status || "").toLowerCase() === "published" &&
    record.published === true &&
    record.public_visibility === true
  );
}

async function main() {
  const pending = await readJson(PENDING_SYNCED_FILE, []);
  const records = await readJson(JOB_RECORDS_FILE, []);

  const pendingItems = Array.isArray(pending) ? pending : [];
  const recordItems = Array.isArray(records) ? records : [];

  const pendingBefore = pendingItems.length;
  const activeBefore = recordItems.filter(isPublishedJobRecord).length;
  const publishedIds = new Set(recordItems.filter(isPublishedJobRecord).map((record) => String(record.id || "")));
  const overlaps = pendingItems.filter((job) => publishedIds.has(String(job.id || "")));
  const nextPending = pendingItems.filter((job) => !publishedIds.has(String(job.id || "")));

  await writeJson(PENDING_SYNCED_FILE, nextPending);

  console.log(JSON.stringify({
    overlap_count_found: overlaps.length,
    pending_before: pendingBefore,
    pending_after: nextPending.length,
    active_published_before: activeBefore,
    active_published_after: activeBefore,
    overlaps_removed: overlaps.slice(0, 20).map((job) => ({
      id: job.id,
      title: job.title,
      organization: job.organization
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(`[jobs:repair-overlap] Failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
