# Workflow Automation Audit

- **Audit date:** 2026-05-25
- **Project root:** `jobs/`
- **Audit scope:** Workflow files in `jobs/backend/dotgithub/workflows/`

## Finding: 7 Workflow Files Found

The job board pipeline has **7 GitHub Actions workflows** located at `jobs/backend/dotgithub/workflows/` (not at root `.github/workflows/`).

| Workflow | Trigger | Purpose |
|---|---|---|
| `jobs-sync.yml` | Every 15 min + push to admin-actions-local.json | Apply queued admin actions, sync talent/employers, commit changes |
| `jobs-sync-pending-sources.yml` | Weekly Wed 15:00 UTC | Sync pending-only ATS sources, update source health |
| `jobs-migrate-existing.yml` | Manual dispatch | Run manual parser migration (dry-run or write) |
| `jobs-auto-expand.yml` | Tue/Fri 13:45 UTC + manual | Orchestrated auto-expand lifecycle (discover, search, sync, promote) |
| `jobs-discover-sources.yml` | Manual dispatch | Discover new mission-aligned ATS sources |
| `jobs-discovery-and-search-ingest.yml` | Weekly Wed 13:15 UTC + manual | Combined discovery + search ingest pipeline |
| `jobs-freshness-audit.yml` | Daily 12:30 UTC | Audit job freshness, remove stale entries |

## Audit Findings

### All 7 Workflows — No Stale Script Paths

Every script referenced in workflow `node --check` and `npm run` commands was verified to exist on disk. Zero stale paths.

### Validate Exit Code Fix Applied

`scripts/validate-public-data.js` previously exited code 1 when pipeline health warnings existed (e.g. `missing_high_priority_org`). Fixed by separating `warnings` from `errors` — only hard failures cause non-zero exit. See `reports/validate-warning-exit-code-report.md`.

### Style Issues Fixed

- `jobs-freshness-audit.yml`: Changed hardcoded `resources/jobs` to `$JOBS_DIR` (lines 55, 58).

### All Scripts Verified

19 unique scripts referenced across all 7 workflows — all present and accounted for.

## Recommendations

1. Add `.github/workflows/` symlink or move workflows to root for discoverability
2. Add a validate-on-PR workflow for pull requests touching `jobs/`
3. Add workflow dispatch audit job to periodically check that workflow paths remain valid
