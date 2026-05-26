# Workflow Safe `git add` Report

**Generated**: 2026-05-25T23:58:00Z

## Summary

All 7 workflows under `backend/dotgithub/workflows/` were patched to replace plain `git add file1 file2 ...` blocks with a safe exists-check loop. If a path does not exist, it prints `Skipping missing path: ...` and continues — instead of aborting with `fatal: pathspec '...' did not match any files`.

## What Changed

Every `git add` block listing multiple files was replaced with:

```bash
for path in \
  "path1" \
  "path2" \
  ...; do
  if [ -e "$path" ]; then
    git add "$path"
  else
    echo "Skipping missing path: $path"
  fi
done
```

## Workflows Patched (7 total)

| Workflow | File | Paths | Known Optional Paths |
|----------|------|-------|---------------------|
| Admin Action Sync | `jobs-sync.yml` | 17 | `admin-action-overrides.json`, `admin-pending-overrides.json`, `admin-organization-rules.json` |
| Freshness Audit | `jobs-freshness-audit.yml` | 7 | `validation-snapshots/latest.json`, `reports` |
| Auto Expand | `jobs-auto-expand.yml` | 15 | `reports/*.json`, `validation-snapshots/latest.json` |
| Manual Parser Migration | `jobs-migrate-existing.yml` | 5 | `validation-snapshots/latest.json` |
| Sync Pending Sources | `jobs-sync-pending-sources.yml` | 5 | `reports/pending-source-state-audit.json`, `validation-snapshots/latest.json` |
| Discover Sources | `jobs-discover-sources.yml` | 4 | `reports/source-discovery-report.json`, `validation-snapshots/latest.json` |
| Discovery & Search Ingest | `jobs-discovery-and-search-ingest.yml` | 4 (conditional) | `source-health-latest.json`, reports, `validation-snapshots/latest.json` |

## Detect Changes Sections — Already Safe

All `git status --porcelain --` blocks already have `|| true` error handling, so missing paths in the status check are tolerated. No changes needed there.

## Verification

| Command | Result | Key Metrics |
|---------|--------|-------------|
| `npm run jobs:validate` | Passed | 0 errors, 0 hard failures |
| `npm run jobs:build-pages` | Passed | 56 pages, 0 stale, 0 redirects |

## Post-Cleanup `git add` Integrity

- No remaining multi-line `git add \` blocks
- All 7 workflows use the exists-check pattern for multi-path adds
- Conditional single-path adds (`jobs-discovery-and-search-ingest.yml`) are preserved — they already guard on `steps.changes.outputs.*`
- Required canonical files (job-records.json, jobs.json, talent-profiles.json, etc.) are still staged when they exist
