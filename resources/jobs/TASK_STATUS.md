# Task Status - Jobs Board Opencode Targeted Repair

Updated: 2026-05-31T01:10:00Z

## Current Status

Repairs complete. All validations pass.

- Public jobs in `jobs.json`: 89 (GFI VP role archived)
- Pending jobs in `pending-synced-jobs.json`: 332
- Canonical records in `job-records.json`: 175 (GFI archived as expired)
- Generated detail pages: 89 (GFI page deleted)
- Sources configured: 187
- Public/pending overlap: 0
- Duplicate public jobs: 0
- Blocked active sources: 0
- Fake pay records: 0
- Malformed markdown in public descriptions: 0
- Greenhouse expired redirects to board: 0 remaining (GFI archived)

## Completed Repairs

| Area | Fix |
|---|---|
| validate-source-expansion | Already clean — no blocked sources. Script passes. |
| Greenhouse expired listing detection | Added redirect-to-board detection in `freshness-audit.js`: new `DEAD_TEXT_PATTERNS`, `REDIRECT_TO_BOARD_EXPIRED_PATTERNS`, `detectRedirectToBoard()`, `isJobSpecificUrl()`, `?error=true` URL classification |
| General redirect-to-board rule | `detectRedirectToBoard` checks final URL != requested URL, board-level destination, and expired text signals. Archives definite expired, flags uncertain for review. |
| Good Food Institute VP role | Removed from `jobs.json`, archived in `job-records.json` as `removed`/`expired` with `greenhouse_expired_redirect_to_board`, page deleted, fingerprint preserved |
| GFI VP role redirect verification | `https://job-boards.greenhouse.io/thegoodfoodinstitute80/jobs/8516386002` → `https://job-boards.greenhouse.io/thegoodfoodinstitute80?error=true` (no current openings) |
| Greenhouse audit script | Created `scripts/audit-greenhouse-redirects.js` for standalone scanning of all public Greenhouse jobs |

## Required Validation Results

All commands exit 0:

| Command | Result |
|---|---|
| `jobs:validate-source-expansion` | Pass (0 errors) |
| `jobs:validate-public-data` | Pass (warnings only) |
| `jobs:validate` | Pass |
| `jobs:check-blocked-sources` | Pass (0 blocked) |
| `jobs:diagnose-admin-actions` | Pass |
| `jobs:build-pages` | Pass (89 pages) |
| `jobs:refresh-public` | Pass (89 jobs) |

## Reports

- `reports/freshness-redirect-repair-latest.json` — Audit results (1 archived, 0 flagged)
- `reports/freshness-redirect-repair-latest.md` — Human-readable audit summary
- `reports/workflow-script-audit-summary.md` — Full workflow/script changes documentation

## Commands Run

```bash
node scripts/audit-greenhouse-redirects.js
npm run jobs:build-pages
npm run jobs:validate-source-expansion
npm run jobs:validate-public-data
npm run jobs:validate
npm run jobs:check-blocked-sources
npm run jobs:diagnose-admin-actions
```
