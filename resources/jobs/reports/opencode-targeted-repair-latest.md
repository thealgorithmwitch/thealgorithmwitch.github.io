# Opencode Targeted Repair Report

Generated: 2026-05-31T00:46:00Z

## Items Already Fixed (No Action Needed)

### SEEL URLs
All 6 SEEL public records in `jobs.json` already use direct individual BambooHR subpage URLs (`https://seelllc.bamboohr.com/careers/{id}`). No generic URLs found. The 7 pending records also use correct direct BambooHR links. No removal or archival needed.

### validate-source-expansion Blocked Source
`jobs:validate-source-expansion` passes cleanly:
- `blocked_active_counts.sources: 0`
- `blocked_active_counts.jobs: 0`
- No blocked source is active in sources.json, jobs.json, pending, or records.
- Emerald Cities Collaborative is already `enabled: false` with `source_status: "blocked"` in `sources.json`.

### Hip Hop Caucus think %
`jobs.json` title is already `"Think 100% Campaigns Manager"`. No orphan `think %` found anywhere in active public files (`jobs.json`, `pages/`, `index.html`). Generated page at `pages/think-100-campaigns-manager-hip-hop-caucus.html` is correct. No action needed.

## Items Fixed

### EDP Senior Data Scientist Snippet
- **Before**: `"Ist/ / Senior Data Scientist Lisbon, PT ist/ / Senior Data Scientist Lisbon, PT..."` (garbled ATS metadata repetition)
- **After**: `"The Senior Data Scientist will lead advanced analytics initiatives to support EDP's renewable energy operations and strategic decision-making..."` (first sentence of canonical description, 302 chars)
- File: `jobs.json` lines 2189-2190

### EDP Generated Page Formatting
- `generate-job-pages.js` updated to convert `\n\n` paragraph breaks to `<p>` tags and bullet lines (`•`) to `<ul><li>` elements
- EDP page summary now renders "What You Will Do" section as proper HTML list
- CSS `white-space: pre-wrap` retained for safety

### HubSpot Consultant Removal
- Removed from `jobs.json` (was `Renew Home-8F00486888`)
- Archived in `job-records.json` with reason `closed_or_invalid_hubspot_consultant`
- Generated page `pages/hubspot-consultant-renew-home.html` deleted

### Powerlines Fake Pay Removal
Two jobs had fake `$420,887 / year` salary parsed from ATS metadata (the job ID 1395197333 was misinterpreted as salary):

**Government Partnerships Advisor (Part-Time)**: All pay fields cleared
**Philanthropic Advisor (Part-Time)**: All pay fields cleared

Fix applied in both `jobs.json` and `job-records.json` (top-level, `raw_source_data`, `display`, and `field_meta`). `pay_rejected_reason` set to `metadata_or_false_positive_no_visible_pay`.

### Powerlines Malformed Markdown Cleanup
Four public Powerlines jobs had malformed markdown in descriptions:

1. Government Partnerships Advisor — `]([National...` nested brackets
2. Director of State Policy — `]([National...` nested brackets + `]()` empty URLs
3. Philanthropic Advisor — `](and` protocol errors + `]()` empty URLs
4. Director of Development — `](and` protocol errors + `]()` empty URLs

All fixed in `jobs.json` and `job-records.json`. Readable text preserved.

### Salary Visibility in Generated Pages
- Salary badge only shown when `salary_visible=true` AND `salary_min > 0`
- JSON-LD `baseSalary` only included when `salary_visible=true`
- Previously badges appeared for all jobs with non-empty `salary` field regardless of visibility flag

## Validation Results

| Command | Result |
|---|---|
| `jobs:validate-source-expansion` | PASS (blocked_active_counts.sources: 0) |
| `jobs:refresh-public` | PASS (90 jobs, wrote_jobs_json=false) |
| `jobs:build-pages` | PASS (90 pages, 0 stale, 0 errors) |
| `jobs:validate-public-data` | PASS (0 errors, 0 regressions) |
| `jobs:diagnose-admin-actions` | PASS (apply_safe=true) |
| CI-style validate-source-expansion | PASS |
| CI-style build-pages | PASS |

## Post-Repair Counts

- jobs.json: 90 records (was 91, HubSpot removed)
- Pages: 90 (hubspot-consultant-renew-home.html deleted)
- Remaining think % in public data: 0
- Remaining $420,887 fake pay in public data: 0
- Remaining malformed markdown in public data: 0
