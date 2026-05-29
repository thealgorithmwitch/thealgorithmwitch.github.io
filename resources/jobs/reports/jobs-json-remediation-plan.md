# Jobs JSON Remediation Plan

## Overview

Generated: 2026-05-29
Audit date: 2026-05-29T15:44:27Z
Total issues: 447 across 3 files (jobs.json: 96 records, job-records.json: 174 records, pending-synced-jobs.json: 346 records)

## Severity Ranking

### P0 — Public Board Quality Issues (must fix now)

*Affects live job board. Visible to users. Highest priority.*

| Category | Total | Public | Pending | Auto-fixable | Manual Review |
|---|---|---|---|---|---|
| **Wrong / Bad URL** | 9 | 9 | 0 | 9 (EDF Workday) | 0 |
| **Closed / Dead Job** | 10 | 8 | 2 | 0 | 10 |
| **Fake / Invalid Pay** | 58 | 5 | 53 | 5 (public) | 53 (pending) |
| **Broken Description** | 0 | 0 | 0 | 0 | 0 |
| **Duplicate Record** | 1 | 0 | 1 | 1 (pending) | 0 |
| **Location/Workplace Contradiction** | 1 | 1 | 0 | 1 | 0 |
| **Workplace Redundancy** | 149 | 66 | 83 | 66 (public - frontend fix already applied, data-level fix optional) | 0 |

**P0 Auto-fixable count: 16** (5 fake pay + 1 contradiction + 1 duplicate + 9 bad URLs)
**P0 Manual review count: 63** (8 closed jobs + 53 pending fake pay + 2 pending closed)

### P1 — Pending Jobs Likely Promotable After Parser Repair

*Unpublished jobs that can be auto-fixed and promoted.*

| Category | Total | Public | Pending | Auto-fixable | Manual Review |
|---|---|---|---|---|---|
| **Structure Loss** | 219 | 135 | 84 | 135 (public - re-fetch from source) | 84 (pending) |
| **Generic URL** | 0 | 0 | 0 | 0 | 0 |
| **Missing Pay** | 17 | 0 | 17 | 17 (set salary_visible: false) | 0 |
| **Missing Description** | 0 | 0 | 0 | 0 | 0 |

**P1 Auto-fixable count: 152** (135 structure-loss re-fetches + 17 missing pay)
**P1 Manual review count: 84** (pending structure loss)

### P2 — Pending Jobs Requiring Manual Review

*Requires human judgment to resolve.*

| Category | Total | Public | Pending | Auto-fixable | Manual Review |
|---|---|---|---|---|---|
| **Uncertain Location** | 17 | 17 | 0 | 0 | 17 |
| **Uncertain Pay** | 53 | 0 | 53 | 0 | 53 |
| **Uncertain Language** | 1 | 0 | 1 | 0 | 1 |
| **Parser Ambiguity** | 0 | 0 | 0 | 0 | 0 |

**P2 Auto-fixable count: 0**
**P2 Manual review count: 71** (17 location + 53 pay + 1 language)

## Detailed Findings

### P0-1: Wrong / Bad URL (9 total — 1 jobs.json, 8 records)

**jobs.json:**
| ID | Title | URL Issue |
|---|---|---|
| edf-68fa50f7fc84 | Analyst, Total Rewards | Workday /apply/autofillWithResume URL |

**job-records.json:**
| ID | Title | URL Issue |
|---|---|---|
| edf-68fa50f7fc84 | Analyst, Total Rewards | Workday /apply/autofillWithResume URL |
| edf-2097bb83af97 | Senior Manager, CA State Affairs | Workday /apply/autofillWithResume URL |
| SEEL-412 through SEEL-426 | 6 SEEL records | Top-level source_url empty (raw_source_data has correct individual URLs) |

**Fix:** Replace EDF Workday URLs with proper career site URLs. For SEEL, populate top-level source_url from raw_source_data.

### P0-2: Closed / Dead Job (10 total — 4 jobs, 4 records, 2 pending)

All American Bird Conservancy Paylocity URLs returning 404:

**jobs.json + job-records.json:**
- Production Specialist (4045149) — 2 findings (duplicated check)
- Writer/Editor (4042466) — 2 findings (duplicated check)

**pending-synced-jobs.json:**
- Digital Engagement Specialist (4042147) — 2 findings

**Fix:** Remove from public board. Requires careful handling — these may be expired listings that simply haven't been taken down. Set `active: false` or remove from jobs.json.

### P0-3: Fake / Invalid Pay — Public (5 total)

| File | ID | Title | Fake Salary |
|---|---|---|---|
| jobs.json | edp-eaf930fcd047 | Senior Data Scientist | $1,395,197,333/year |
| job-records.json | edp-eaf930fcd047 | Senior Data Scientist | $1,395,197,333/year |
| job-records.json | nextera-energy-50fe226b28a5 | Senior Automation Engineer | $12,000,000/year |
| job-records.json | edp-f365739f6c21 | Ops & Maintenance Sr Operator | €28,000,000/year |

**Fix:** Set `salary_visible: false`, clear `raw_salary` values. Already applied for Octopus Energy (FIX 9).

### P0-4: Duplicate Record (1 pending)

| File | ID | Details |
|---|---|---|
| pending-synced-jobs.json | Quince-5126410008 | QC Manager duplicate of Quince-5126439008 |

**Fix:** Remove duplicate from pending.

### P0-5: Location/Workplace Contradiction (1 public)

| File | ID | Issue |
|---|---|---|
| jobs.json + job-records.json | sunrun-XXX | Sales Experience Program Manager: wt="On-site" / loc="Remote" |

**Fix:** Update location to actual office location or change workplace_type to "Remote".

### P0-6: Workplace Redundancy (149 total — 27 jobs, 39 records, 83 pending)

Both workplace_type and location are identically "Remote". Frontend fix already applied (formatWorkplaceLocation returns empty when identical). Data-level fix optional — set location to empty string when redundant with workplace_type.

### P1-1: Structure Loss (219 total — 45 jobs, 90 records, 84 pending)

Descriptions stored as single paragraphs despite length > 500 chars, indicating newlines/formatting stripped during parsing.

**Fix:** Re-fetch from `apply_url` to recover structured description text. This requires:
1. HTTP GET to each apply_url
2. Parse HTML to extract structured text
3. Update description field with recovered formatting

**Likely fixable via re-fetch:** ~60-70% of public records (site-dependent)
**Likely requires manual:** Amazon Workday URLs, sites that block scraping

### P1-2: Missing Pay — Pending (17 total)

pending-synced-jobs.json records where raw_salary contains prose instead of pay data (e.g., "Salary commensurate with experience", "In addition to the above salary...").

**Affected orgs:** Get Vocal PBC (10 records), GoodLeap (7 records)

**Fix:** Set `salary_visible: false` on these records to prevent bogus pay display.

### P2-1: Uncertain Location (17 soft contradictions)

workplace_type="Remote" but location is a specific city/state (not "Remote"):
- Washington, DC (3)
- Michigan (2)
- South Africa (2)
- CA (2)
- Wyoming, Nadu-India, various others (8)

**Fix:** May be intentional (remote role with geographic restriction). Requires manual review.

### P2-2: Uncertain Pay — Pending (53 total)

Fake/inflated salaries in pending-synced-jobs.json:
- Quince: 7 records (~$500M-$5M/year) — likely parser error with Job number as salary
- NextEra Energy: 2 records ($76B, $4B) — tax ID / job code parsed as salary
- GoodLeap: 7 records ($1.6M each) — same inflated pattern
- Elemental Impact / Jobvite: 1 record ($1.7B)
- American Bird Conservancy: 1 record ($4.1M — is job ID)
- Get Vocal PBC: 10 records — prose "Salary commensurate with experience"

**Fix:** Auto-set `salary_visible: false` for pending, flag for manual review.

### P2-3: Uncertain Language (1 pending)

Octopus Energy German-language job title has unclosed parenthesis:
`Team Lead Elektrotechnik / Meister Elektrotechnik Wärmepumpen m/w/d) - Großraum Köln / Bonn / Koblenz / Dortmund`

**Fix:** Remove trailing `)` that has no matching `(`.

## Remediation Targets

| Target | Current | Goal | Δ |
|---|---|---|---|
| Structure loss findings | 219 | < 25 | -194 |
| Fake pay findings (public) | 5 | 0 | -5 |
| Closed job findings (public) | 8 | 0 | -8 |
| Duplicate findings (public) | 0 | 0 | 0 |
| Workplace/location contradictions (public) | 1 | 0 | -1 |

## Execution Plan

### Phase 1: Auto-fix deterministic P0 (immediate)
1. Set `salary_visible: false` on 5 public fake-pay records
2. Remove/flag 8 public closed-job records (ABC)
3. Fix Sunrun location/workplace contradiction
4. Remove pending duplicate (Quince QC Manager)
5. Fix Octopus title (unclosed parenthesis)
6. Replace EDF Workday URLs
7. Populate SEEL top-level source_url in records

### Phase 2: Structure-loss re-fetch (auto)
1. Write re-fetch script for public records
2. Run against jobs.json + job-records.json
3. Update descriptions with recovered formatting

### Phase 3: Pending mitigations (auto)
1. Set `salary_visible: false` on pending fake-pay/prose-salary records
2. Flag ABC closed jobs for removal

### Phase 4: Manual review queue (human)
1. Verify ABC closed jobs — remove from public board
2. Review 17 uncertain locations (remote + specific geography)
3. Review 53 pending inflated salaries
4. Review 84 pending structure-loss records
5. Fix Octopus German-language title

## Auto-Fix Script Design

The `manual-parser-repair.js` script will be extended with:

**FIX 11:** EDP $1.4B fake salary — set salary_visible: false, clear raw_salary
**FIX 12:** NextEra $12M fake salary — set salary_visible: false, clear raw_salary  
**FIX 13:** EDP €28M fake salary — set salary_visible: false, clear raw_salary
**FIX 14:** EDF Workday URLs — replace with proper career site URLs
**FIX 15:** Sunrun contradiction — set location to office address
**FIX 16:** ABC closed jobs — remove from public board or set inactive
**FIX 17:** SEEL records — populate top-level source_url
**FIX 18:** Quince pending duplicate — remove
**FIX 19:** Octopus title — fix unclosed parenthesis
**FIX 20:** Pending prose salaries — set salary_visible: false
**FIX 21:** Structure-loss re-fetch — HTTP re-fetch descriptions
