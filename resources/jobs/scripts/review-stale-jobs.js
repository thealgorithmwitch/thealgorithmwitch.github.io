const path = require("path");
const {
  readJobRecords,
  JOB_RECORDS_FILE
} = require("./public-records");
const { writeJson } = require("./job-utils");
const {
  applyPublishLifecycle,
  detectApplicationDeadline,
  extendVerification,
  isClosedPosting,
  isStale,
  markExpired,
  markNeedsReview,
  markRemoved
} = require("./lifecycle-utils");

async function recheckOriginalUrl(url) {
  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text
  };
}

async function main() {
  const records = await readJobRecords();
  const now = new Date();
  const report = {
    checked: 0,
    keptPublished: 0,
    movedToPendingReview: 0,
    markedExpired: 0,
    markedRemoved: 0,
    detectedDeadlines: 0
  };

  const nextRecords = [];

  for (const record of records) {
    if (record.record_type !== "job") {
      nextRecords.push(record);
      continue;
    }

    let nextRecord = { ...record };
    if (
      nextRecord.published &&
      nextRecord.public_visibility &&
      String(nextRecord.status || "").toLowerCase() === "published" &&
      !nextRecord.first_published_at
    ) {
      nextRecord = applyPublishLifecycle(nextRecord, { now });
    }
    const deadline = detectApplicationDeadline(record);
    if (deadline) report.detectedDeadlines += 1;

    const expiredByDeadline = deadline && deadline.getTime() < now.getTime();
    if (expiredByDeadline) {
      nextRecord = markExpired(nextRecord, "application deadline has passed", { now });
      report.markedExpired += 1;
      report.checked += 1;
      nextRecords.push(nextRecord);
      continue;
    }

    if (!isStale(nextRecord, { now })) {
      nextRecords.push(nextRecord);
      continue;
    }

    report.checked += 1;
    const originalUrl = String(nextRecord.display?.original_url || nextRecord.raw_source_data?.original_url || nextRecord.raw_source_data?.apply_url || "").trim();

    if (!originalUrl) {
      nextRecord = markNeedsReview(nextRecord, "1 week old - needs recheck", "manual", { now });
      report.movedToPendingReview += 1;
      nextRecords.push(nextRecord);
      continue;
    }

    try {
      const recheck = await recheckOriginalUrl(originalUrl);
      if (!recheck.ok || recheck.status === 404 || isClosedPosting(recheck.text)) {
        nextRecord = markRemoved(nextRecord, "posting appears closed or unavailable", { now });
        report.markedRemoved += 1;
      } else {
        nextRecord = extendVerification(nextRecord, "source_recheck", { now });
        report.keptPublished += 1;
      }
    } catch (_error) {
      nextRecord = markNeedsReview(nextRecord, "1 week old - needs recheck", "source_recheck", { now });
      report.movedToPendingReview += 1;
    }

    nextRecords.push(nextRecord);
  }

  await writeJson(path.join(path.resolve(__dirname, ".."), "job-records.json"), nextRecords);
  console.log(`[jobs:review-stale] jobs checked=${report.checked} kept published=${report.keptPublished} moved to pending review=${report.movedToPendingReview} marked expired=${report.markedExpired} marked removed=${report.markedRemoved} detected deadlines=${report.detectedDeadlines}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:review-stale] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
