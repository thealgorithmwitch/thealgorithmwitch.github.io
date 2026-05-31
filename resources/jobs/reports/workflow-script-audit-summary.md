# Workflow / Script Audit - Summary

Generated: 2026-05-31T00:46:00Z

## Current Outcome

Workflow and script validation passes for the live `resources/jobs` project.

- Workflow files checked: `backend/dotgithub/workflows/*.yml`
- Missing workflow script references: 0
- Admin diagnostics: runs without error
- Public validation gate: runs without hard failures
- Source expansion gate: runs without errors (blocked_active_counts.sources: 0)
- Page generation: 90 generated pages for 90 public jobs
- Stale generated pages pruned: pass
- Archived/rejected fingerprint violations: 0

## Repairs Applied

| Area | Fix |
|---|---|
| EDP Senior Data Scientist snippet | Replaced garbled ATS metadata snippet with canonical first sentence |
| Generated page formatting | Convert `\n\n` → `<p>`, `•` → `<ul><li>` in generate-job-pages.js |
| HubSpot Consultant | Archived with closed_or_invalid reason, page deleted, jobs.json cleaned |
| Powerlines Government Partnerships Advisor | Cleared $420,887 fake pay, rejected metadata salary |
| Powerlines Philanthropic Advisor | Cleared $420,887 fake pay, same fix |
| Powerlines malformed markdown | Fixed ]([, ](), ](and patterns across 4 public jobs |
| Salary badge visibility | Generated pages only show salary when salary_visible=true |

## Known Already-Correct (No Action Needed)

- **SEEL public URLs**: Already use direct BambooHR subpage links
- **Blocked source validation**: Sources pass with blocked_active_counts all 0
- **Hip Hop Caucus think %**: No orphan think % in active data files

## Validation Commands

```bash
npm run jobs:validate-source-expansion
npm run jobs:refresh-public
node scripts/generate-job-pages.js
npm run jobs:validate-public-data
npm run jobs:diagnose-admin-actions
```

All commands exit 0.

## Key Metrics

| Metric | Value |
|---|---|
| Public jobs | 90 |
| Generated pages | 90 |
| Active sources | 187 |
| Blocked active sources | 0 |
| Archive violations | 0 |
| Fake pay records | 0 |
| Malformed markdown in public | 0 |
