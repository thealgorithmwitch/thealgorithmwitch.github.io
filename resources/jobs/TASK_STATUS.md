# Task Status - Jobs Board Opencode Targeted Repair

Updated: 2026-05-31T00:46:00Z

## Current Status

Targeted repair pass complete. All required validations pass.

- Public jobs in `jobs.json`: 90
- Pending jobs in `pending-synced-jobs.json`: 332
- Canonical records in `job-records.json`: 175 (HubSpot archived)
- Generated detail pages: 90
- Sources configured: 187
- Public/pending overlap: 0
- Duplicate public jobs: 0
- Blocked active sources: 0
- Fake pay records: 0
- Malformed markdown in public descriptions: 0

## Completed Repairs

| Area | Fix |
|---|---|
| SEEL public URLs | Already correct — all 6 use direct BambooHR subpage links |
| validate-source-expansion blocked source | Already clean — blocked_active_counts.sources: 0 |
| Hip Hop Caucus think % | Already correct — no orphan think % in any active file |
| EDP Senior Data Scientist snippet | Fixed garbled ATS metadata snippet → canonical first sentence |
| EDP generated page formatting | Added `<p>`/`<ul><li>` rendering from `\n\n` and `•` delimiters |
| HubSpot Consultant | Removed from jobs.json, archived in job-records.json, page deleted |
| Powerlines Government Partnerships Advisor fake pay | Cleared $420,887/year, set salary_visible=false, rejected |
| Powerlines Philanthropic Advisor fake pay | Cleared $420,887/year, same fix |
| Powerlines malformed markdown | 4 jobs: fixed nested ]([, empty ](), ](and protocol errors |
| Salary badge visibility | Generated pages now respect salary_visible flag |

## Required Validation Results

All requested validations pass.

- SEEL URLs correct: pass (all direct BambooHR links)
- validate-source-expansion: pass (blocked_active_counts.sources: 0)
- No think % in public data: pass (0 occurrences)
- EDP snippet correct: pass (canonical first sentence, 302 chars)
- EDP page has `<p>` and `<ul>` formatting: pass
- HubSpot Consultant removed from jobs.json: pass
- HubSpot archived in job-records.json: pass
- HubSpot generated page deleted: pass
- Powerlines fake pay cleared (Government Partnerships): pass
- Powerlines fake pay cleared (Philanthropic Advisor): pass
- Powerlines markdown cleaned (4 jobs): pass
- Salary badge respects salary_visible: pass
- JSON-LD baseSalary respects salary_visible: pass
- Jobs count: 90 (HubSpot removed)
- Pages count: 90 (HubSpot page deleted)
- Page build safe: true

## Commands Run

```bash
npm run jobs:validate-source-expansion
npm run jobs:refresh-public
npm run jobs:build-pages
npm run jobs:validate-public-data
npm run jobs:diagnose-admin-actions
```

All commands exit 0 and produce no hard errors.
