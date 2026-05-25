# Anchored Audit Summary — 2026-05-25

## Workflow Automation Audit

**Finding:** 7 workflow files found at `jobs/backend/dotgithub/workflows/` (NOT root `.github/workflows/`).

| Workflow | Trigger | Status |
|---|---|---|
| jobs-sync.yml | Every 15 min + push | Clean |
| jobs-sync-pending-sources.yml | Weekly Wed 15:00 | Clean |
| jobs-migrate-existing.yml | Manual dispatch | Clean |
| jobs-auto-expand.yml | Tue/Fri 13:45 + manual | Clean (scripts self-validate) |
| jobs-discover-sources.yml | Manual dispatch | Clean |
| jobs-discovery-and-search-ingest.yml | Weekly Wed 13:15 + manual | Clean |
| jobs-freshness-audit.yml | Daily 12:30 | Fixed style inconsistency |

**All 19 referenced scripts verified present.** No stale paths.

## Pending Admin Visibility Audit

**Root cause: 3 sequential pipeline gates dropped manual-source jobs from admin review.**

| Gate | File | Fix |
|---|---|---|
| `routeSyncedJob` | job-normalizer.js:3275 | Propagated `manual_review_required` from source to job |
| `applySourcePendingControls` | source-sync-quality.js:283 | Added `source.manual_review_required === true` bypass |
| `classifyPendingJob` | pending-triage.js:929 | Added manual review source bypass before relevance checks |

**AEU verification:** fetched=5, pending=5, active_review_added=5, retained=5, rejected_noise=0 — **100% success**.

## Rippling Adapter Fix

`ripplingJobToSchema` in ats-clients.js: Changed field names (`title`→`name`, `link`→`url`, `location`→`locations[0].name`, `department`→`department.name`, `workplaceType`→`locations[0].workplaceType`). All 5 AEU jobs now have real titles/URLs.

## Validate Exit Code Fix

`validate-public-data.js`: Separated `pipelineHealthWarnings` into new `warnings` array. Only hard errors cause `exitCode = 1`. See `reports/validate-warning-exit-code-report.md`.

## Source Deduplication

Removed duplicate `asian-pacific-environmental-network` entry, merged metadata into `apen4ej` in `sources.json`.

## Diagnostics

- Created `scripts/diagnose-manual-sources.js` — checks all 83 manual sources against pipeline gates.
- 312 admin-pending jobs total after latest sync; 434 after removing stale entries.
- 83 manual sources: 15 disabled, ~20 with custom_sync_enabled=false, ~48 active+syncing.
