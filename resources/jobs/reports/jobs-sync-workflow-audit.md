# jobs-sync.yml Workflow Audit

- **Audit date:** 2026-05-25
- **File:** `jobs/backend/dotgithub/workflows/jobs-sync.yml`
- **Trigger:** Every 15 min (`*/15 * * * *`) + push to `admin-actions-local.json`

## Methodology

Compared against:
1. The 6 sibling workflows in `backend/dotgithub/workflows/`
2. The reference order specified for "safe admin action with source sync"
3. The actual files on disk and what scripts write to them

## Audit Findings

### 1. JOBS_DIR Path (✅ Correct)

Uses `steps.workspace.outputs.dir` = `resources/jobs`. All paths resolve correctly to `resources/jobs/...`.

### 2. Current Sync Command (❌ Missing `sync-sources` / `sync-custom`)

The workflow runs admin actions but **never syncs fresh job data from sources**. The other sync workflows are:
- `jobs-sync-pending-sources.yml` — runs weekly (Wed 15:00), only pending sources
- `jobs-auto-expand.yml` — runs Tue/Fri 13:45, full lifecycle

The admin action workflow runs every 15 min and could apply stale admin actions against stale data. Both `sync-sources` and `sync-custom` scripts exist and write to `jobs.json`, `pending-synced-jobs.json`, and `source-health-latest.json`.

**Fix:** Add `sync-sources` and `sync-custom` steps before admin action application.

### 3. validate / build-pages After Sync (❌ Missing `build-pages`)

The workflow validates after admin actions (line 87-88) but **never runs `jobs:build-pages`**. After `apply-admin-actions` modifies `jobs.json`, the static HTML pages go stale until some other workflow rebuilds them.

Other workflows:
- `jobs-sync-pending-sources.yml`: validates but doesn't build pages (pending sync doesn't change public jobs)
- `jobs-freshness-audit.yml`: validates but doesn't build pages (freshness audit can remove stale entries)
- `jobs-auto-expand.yml`: validates but doesn't build pages (the lifecycle script handles it internally)

Since admin actions directly mutate `jobs.json`, pages should be rebuilt immediately after.

**Fix:** Add `jobs:build-pages` after validation post-sync.

### 4. Commit Paths (❌ Incomplete)

The change detection and commit steps track only a subset of files. Missing:

| File on disk | In commit path? | Notes |
|---|---|---|
| `source-health-latest.json` | ❌ | Written by sync-sources/sync-custom |
| `sources.json` | ❌ | Could be modified by sync/actions |
| `source-prospects.json` | ❌ | Exists on disk, modified by discovery |
| `broad-source-config.json` | ❌ | Exists on disk, relevant to source health |
| `reports/**` (all reports) | ❌ | Only 2 specific reports committed |
| `admin-job-actions.json` | ❌ | Written by snapshot step |
| `talent-profiles.json` | ✅ | |
| `employers.json` | ✅ | |
| `pending-talent.json` / `pending-talent-profiles.json` | ✅ | (files may not exist on disk) |

**Fix:** Add all generated files to change detection and commit paths.

### 5. stale admin-actions-snapshot.json Paths (✅ No)

The snapshot path is `admin-job-actions.json` (from `ADMIN_JOB_ACTIONS_SNAPSHOT_FILE`). The workflow never references `admin-actions-snapshot.json`. The snapshot is NOT committed (intentional — it's a transient artifact fetched from backend).

### 6. Warning-Only Validate Exit Code (✅ Fixed)

The `validate-public-data.js` exit code fix (separating `warnings` from `errors`) ensures warnings don't fail this workflow step.

### 7. Manual Source Candidates (✅ Handled by earlier fixes)

The three pipeline gates (`pending-triage.js`, `source-sync-quality.js`, `job-normalizer.js`) were fixed in a prior session. Manual review source jobs now route to admin review.

### 8. Inconsistent JOBS_DIR in npm Commands (⚠️ Style)

Lines 66-88 use hardcoded `resources/jobs` instead of `$JOBS_DIR` or `${{ steps.workspace.outputs.dir }}`. Matches pattern seen in other workflows (e.g., `jobs-freshness-audit.yml` before fix).

**Fix:** Use `${{ steps.workspace.outputs.dir }}` for consistency.

## Required Changes Summary

| # | Change | Priority |
|---|---|---|
| 1 | Add `jobs:sync-sources` step before admin actions | High |
| 2 | Add `jobs:sync-custom` step after sync-sources | High |
| 3 | Add `jobs:build-pages` after admin actions + validation | High |
| 4 | Add `jobs:audit-source-coverage` after build-pages | Medium |
| 5 | Expand change detection to include all generated files | High |
| 6 | Expand commit paths to include all generated files | High |
| 7 | Use `$JOBS_DIR` consistently instead of hardcoded path | Low |

## New Order (Patched)

1. Install dependencies
2. Validate scripts + data before sync
3. `jobs:sync-sources` — fetch fresh ATS data
4. `jobs:sync-custom` — fetch custom/manual source data
5. Validate data after sync
6. `jobs:snapshot-admin-actions` — fetch admin action queue
7. `jobs:diagnose-admin-actions` — preview actions
8. `jobs:apply-admin-actions` — apply mutations
9. `jobs:fetch-approved-talent` — sync talent profiles
10. `jobs:fetch-approved-employers` — sync employer profiles
11. `jobs:check-blocked-sources` — enforce blocklist
12. Validate data after admin actions
13. `jobs:build-pages` — regenerate HTML pages
14. `jobs:audit-source-coverage` — verify coverage
15. Detect changes → Commit → Upload
