# Pay Extraction Hardening Report

Generated: 2026-05-25T02:08:07.532Z

## Summary

Organizations fixed: 3 (American Bird Conservancy, GoodPower, Earthjustice)

### Patterns Added
- Annual salary range: (without 'is')
- Annual salary: (without 'range')
- Estimated at qualifier after salary keyword
- Compact range where second number lacks $ sign
- Asterisk after salary amount
- Multi-location salary ranges combining lowest min / highest max
- Location text containing periods (e.g., D.C.)
- Explicit range check bypasses commensurate/competitive exit

### Parser Fixes
- parseSalaryRange: strip asterisks from salary text before number extraction
- parseSalaryRange: skip competitive/commensurate exit when explicit $ range present
- findBestSalaryMatchFromWindows: added annual salary(?: range)? to alternatives
- findBestSalaryMatch: added annual salary(?: range)? to alternatives
- New extractMultiLocationSalaryRanges function
- extractSalaryData: added multi-location salary phase before full document scan
- normalizeJob: added salary_note output field

## Regression Tests

| Case | Expected Min | Expected Max | Status |
|------|-------------|-------------|--------|
| ABC: Salary: Estimated at $75,780 – $84,200, Based on experience | 75780 | 84200 | pass |
| GoodPower: Annual salary range: $190,000-205,000, commensurate with experience | 190000 | 205000 | pass |
| Compact range: $190,000-205,000 | 190000 | 205000 | pass |
| Asterisk suffix: $75,780 – $84,200* | 75780 | 84200 | pass |
| Multi-location combined: SF/NYC $205,300-$228,100 + DC $195,000-$216,700 | 195000 | 228100 (note: Multiple location-based ranges)| pass |
| Single location: Chicago $100,000-$120,000 | 100000 | 120000 | pass |
| Earthjustice full description multi-location | 195000 | 228100 | pass |
| Benefits text not salary | null | null | pass |
| Single non-location range not multi-location | null | null | pass |
| GoodPower normalizeJob extraction | 190000 | 205000 | pass |
| ABC normalizeJob extraction | 75780 | 84200 | pass |

## Data Issues

### American Bird Conservancy
- Status: pending_descriptions_truncated
- 3 jobs in pending-synced-jobs.json have truncated descriptions without Salary: line. Paylocity detail page JSON-LD description may not include full job details. Parser is hardened for when salary text IS present.
- Records in pending: 3

### GoodPower
- Status: salary_already_captured
- 3 records in job-records.json already have salary_min/salary_max ($70K-$83K range). Parser hardened for $190K-$205K range pattern.

### Earthjustice
- Status: pending_descriptions_are_listing_pages
- 7 jobs in pending-synced-jobs.json have listing-page descriptions (multiple jobs concatenated). Actual detail pages with Salary & Benefits sections are not being fetched. Multi-location parser hardened for when detail descriptions are available.
- Needs source scraper fix to fetch individual job detail pages from earthjustice.org/jobs

## Recommendations
- Fix Paylocity scraping to capture full description HTML for ABC jobs
- Fix Earthjustice custom sync to fetch individual job detail pages instead of listing page
- Run sync-custom after source fixes to re-triage ABC and Earthjustice jobs with new parser
- Monitor GoodPower for $190K-$205K range jobs when they appear in pending
