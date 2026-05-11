const assert = require("assert");
const { applySourcePendingControls, getSourceControlConfig } = require("./source-sync-quality");

function makeJob(index, title, extras = {}) {
  return {
    id: `job-${index}`,
    external_id: `ext-${index}`,
    source_id: "octopus-energy",
    organization: "Octopus Energy",
    title,
    location: "Remote",
    workplace_type: "Remote",
    description: `${title} role supporting energy and operations work.`,
    raw_description: `${title} role supporting energy and operations work.`,
    apply_url: `https://example.com/jobs/${index}`,
    status: "pending",
    ...extras
  };
}

function main() {
  const source = {
    id: "octopus-energy",
    organization: "Octopus Energy",
    broad_source_controls: true,
    max_pending_per_sync: 5,
    target_position_matching: true,
    quality_mode: "pending",
    auto_publish: false
  };

  const config = getSourceControlConfig(source, { jobCount: 8 });
  assert.strictEqual(config.broadSourceControls, true);
  assert.strictEqual(config.maxPendingPerSync, 5);

  const incomingJobs = [
    makeJob(1, "Climate Partnerships Manager"),
    makeJob(2, "Renewable Energy Strategy Lead"),
    makeJob(3, "Software Engineer, Energy Platform"),
    makeJob(4, "Community Operations Manager"),
    makeJob(5, "Product Manager, Sustainability"),
    makeJob(6, "Warehouse Associate"),
    makeJob(7, "Sales Development Representative"),
    makeJob(8, "Customer Support Specialist")
  ];

  const controlled = applySourcePendingControls(source, {
    incomingJobs,
    existingPendingJobs: [],
    nowIso: "2026-05-10T12:00:00.000Z"
  });

  assert(controlled.activeReviewJobs.length <= 5, "active review cap was not enforced");
  assert(controlled.backlogJobs.length >= 3, "backlog jobs were not preserved");
  assert(controlled.backlogJobs.every((job) => job.hidden_from_review_default === true), "backlog jobs must be hidden");
  assert(
    controlled.backlogJobs.some((job) => job.skip_reason === "broad_source_low_relevance" || job.skip_reason === "source_cap_exceeded"),
    "backlog jobs must be marked with a cap or low-relevance reason"
  );
  assert(
    controlled.activeReviewJobs.every((job) => job.hidden_from_review_default === false),
    "active review jobs must remain visible"
  );

  const resurfacing = applySourcePendingControls(source, {
    incomingJobs: [
      makeJob(1, "Climate Partnerships Manager", { first_seen_at: "2026-04-01T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" }),
      makeJob(2, "Renewable Energy Strategy Lead", { first_seen_at: "2026-04-05T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" }),
      makeJob(3, "Software Engineer, Energy Platform", { first_seen_at: "2026-04-10T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" }),
      makeJob(4, "Community Operations Manager", { first_seen_at: "2026-04-11T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" }),
      makeJob(5, "Product Manager, Sustainability", { first_seen_at: "2026-04-12T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" }),
      makeJob(6, "Policy Analyst, Climate", { first_seen_at: "2026-03-01T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z", surfaced_count: 0 }),
      makeJob(7, "Energy Operations Specialist", { first_seen_at: "2026-03-10T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z", surfaced_count: 0 })
    ],
    existingPendingJobs: [
      makeJob(1, "Climate Partnerships Manager", { last_review_cycle_at: "2026-05-09T12:00:00.000Z", surfaced_count: 3, hidden_from_review_default: false }),
      makeJob(2, "Renewable Energy Strategy Lead", { last_review_cycle_at: "2026-05-09T12:00:00.000Z", surfaced_count: 2, hidden_from_review_default: false }),
      makeJob(6, "Policy Analyst, Climate", { hidden_from_review_default: true, broad_source_backlog: true, surfaced_count: 0, first_seen_at: "2026-03-01T12:00:00.000Z", last_seen_at: "2026-05-10T12:00:00.000Z" })
    ],
    nowIso: "2026-05-10T12:00:00.000Z"
  });

  assert(
    resurfacing.activeReviewJobs.some((job) => job.title === "Policy Analyst, Climate"),
    "older backlog jobs should eventually resurface into active review"
  );
  assert(
    resurfacing.resurfacedFromBacklog >= 1,
    "resurfaced backlog count should be recorded"
  );

  const staleArchive = applySourcePendingControls(source, {
    incomingJobs: [
      makeJob(1, "Climate Partnerships Manager")
    ],
    existingPendingJobs: [
      makeJob(1, "Climate Partnerships Manager"),
      makeJob(9, "Old Backlog Role", {
        hidden_from_review_default: true,
        broad_source_backlog: true,
        first_seen_at: "2025-12-01T12:00:00.000Z",
        last_seen_at: "2026-03-01T12:00:00.000Z"
      })
    ],
    nowIso: "2026-05-10T12:00:00.000Z"
  });

  assert(
    staleArchive.archivedJobs.some((job) => job.title === "Old Backlog Role" && job.status === "archived"),
    "jobs missing from upstream should archive from backlog"
  );
  assert(
    staleArchive.staleBacklogArchived >= 1,
    "stale backlog archive count should be recorded"
  );

  console.log(JSON.stringify({
    ok: true,
    active_review_count: controlled.activeReviewJobs.length,
    backlog_count: controlled.backlogJobs.length,
    capped_count: controlled.cappedCount,
    skipped_low_relevance_count: controlled.skippedLowRelevanceCount,
    resurfaced_from_backlog: resurfacing.resurfacedFromBacklog,
    stale_backlog_archived: staleArchive.staleBacklogArchived
  }, null, 2));
}

main();
