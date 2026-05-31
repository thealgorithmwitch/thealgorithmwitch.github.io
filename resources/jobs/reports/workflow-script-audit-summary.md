# Workflow Script Audit Summary

Generated: 2026-05-31T01:10:00Z

## Freshness Redirect Repair

### Changes to `scripts/freshness-audit.js`

1. **Added `DEAD_TEXT_PATTERNS` entries** — Three new text patterns catch expired Greenhouse listings:
   - `there are no current openings`
   - `there are currently no open positions`
   - `position is no longer available`

2. **Added `REDIRECT_TO_BOARD_EXPIRED_PATTERNS`** — Secondary check for pages that redirect from a job-specific URL to a board-level page showing expired signals like "Create a Job Alert" / "No current openings".

3. **Added `isJobSpecificUrl(url)`** — Detects URLs containing a job/requisition ID segment (e.g., `/jobs/12345`).

4. **Added `detectRedirectToBoard(requestedUrl, finalUrl, body)`** — Detects when a job-specific URL redirects to a board-level page. Returns `dead` if:
   - `?error=true` query parameter present (Greenhouse-specific)
   - Final URL classifies as a careers landing/search/login page via `classifyPageTypeFromUrl`
   - Final URL is board-level AND page text shows expired signals

   Returns `uncertain` if final URL is board-level but text is ambiguous.

5. **Added `?error=true` pattern to `classifyPageTypeFromUrl`** — Greenhouse boards redirect to `?error=true` when a job is expired.

6. **Added redirect check to `processStaleJob`** — Runs before `detectPageMode` to catch Greenhouse redirect-to-board scenarios.

### New script: `scripts/audit-greenhouse-redirects.js`

Standalone audit script that:
- Scans all public Greenhouse jobs in `jobs.json`
- Fetches each job URL
- Detects redirect-to-board patterns
- Removes expired jobs from `jobs.json`
- Marks records as `removed`/`expired` in `job-records.json`
- Generates `reports/freshness-redirect-repair-latest.json` and `.md`

### Good Food Institute — Vice President of Operations

**Action taken:** Archived due to expired Greenhouse redirect

- URL: `https://job-boards.greenhouse.io/thegoodfoodinstitute80/jobs/8516386002`
- Redirects to: `https://job-boards.greenhouse.io/thegoodfoodinstitute80?error=true`
- Page text: "Create a Job Alert" + "There are no current openings"
- Record status set to `removed`, `public_visibility: false`
- Fingerprint preserved in `job-records.json` to prevent re-entry
- Generated page deleted

## Validation Results

| Command | Exit Code |
|---|---|
| `jobs:validate-source-expansion` | 0 |
| `jobs:validate-public-data` | 0 |
| `jobs:validate` (both) | 0 |
| `jobs:check-blocked-sources` | 0 |
| `jobs:diagnose-admin-actions` | 0 |
| `jobs:build-pages` | 0 |
| `jobs:refresh-public` | 0 |

## Post-Repair State

- Public jobs in `jobs.json`: 89 (GFI removed, was 90)
- Pages: 89 (GFI page deleted)
- Greenhouse public jobs: 4 (all verified live with no redirects)
- Blocked active sources: 0
