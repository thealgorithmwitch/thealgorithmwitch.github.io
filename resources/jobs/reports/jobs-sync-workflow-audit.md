# jobs-sync.yml Workflow Audit

- **Audit date:** 2026-05-25
- **File:** `jobs/backend/dotgithub/workflows/jobs-sync.yml`
- **Trigger:** Every 15 min (`*/15 * * * *`) + push to `admin-actions-local.json`

## Previous Failure

`jobs:validate` (validate-public-data) ran BEFORE sync, detecting stale `source-health` entries with `fetch_failed` state. The stale pre-sync data caused a false hard failure, blocking the entire workflow.

## Fix: Reordered to Safe Sequence

| Step | Action | Why |
|---|---|---|
| 1 | Checkout | |
| 2 | Setup Node.js | |
| 3 | Install dependencies | |
| 4 | Validate sync scripts (syntax only) | Light pre-flight; no data access |
| 5 | `jobs:sync-sources` | Fetch fresh ATS data first |
| 6 | `jobs:sync-custom` | Fetch custom/manual sources |
| 7 | Enrich pending descriptions | Quality pass on fresh pending data |
| 8 | Editorial pipeline stabilization | Triage/promote pending jobs |
| 9-11 | Admin action pipeline (snapshot/diagnose/apply) | Apply admin edits on fresh data |
| 12-13 | Fetch talent/employer profiles | |
| 14 | Guard blocked sources | |
| 15-17 | **Validate after sync** (3 steps) | validate-public-data → validate-source-expansion → validate |
| 18 | Build job pages | Generate HTML from validated data |
| 19 | Audit source coverage | |
| 20-22 | Detect → Commit → Upload | |

## Key Changes from Previous Version

| Change | Detail |
|---|---|
| ❌ Removed | "Validate public data before sync" — was at step 5, caused stale-data failures |
| ✅ Added | Enrich pending descriptions (`enrich-pending-descriptions.js`) |
| ✅ Added | Editorial pipeline stabilization (`jobs:editorial-stabilization`) |
| ✅ Split | Validation into 3 explicit steps after all data operations |
| ✅ Preserved | Admin action pipeline, talent/employer fetch, blocked source guard |
| ✅ Preserved | Full commit paths including source-health-latest.json, reports/, pages/ |

## Commit Paths Verified

All user-required files committed:
- `resources/jobs/jobs.json` ✅
- `resources/jobs/job-records.json` ✅
- `resources/jobs/pending-synced-jobs.json` ✅
- `resources/jobs/source-health-latest.json` ✅
- `resources/jobs/pages/**` ✅
- `resources/jobs/reports/**` ✅

## Failure Mode Design

- **Sync fetch fails (network error):** `sync-sources` / `sync-custom` write `source_health: sync_error` but do not fail the workflow. Fresh sync output (even with errors) replaces the stale snapshot. Post-sync validation sees current state, not stale data.
- **Warning-only validation:** `validate-public-data.js` separated `warnings` from `errors` (prior fix). Warnings are reported but don't cause `exitCode = 1`.
- **True hard failures after sync:** `validate` steps still exit 1 on hard failures (missing pages, broken links, hard validation failures). These are legitimate post-sync issues.
