# Workflow / Script Audit - Summary

Generated: 2026-05-30T23:07:17Z

## Current Outcome

Workflow and script validation passes for the live `resources/jobs` project.

- Workflow files checked: `backend/dotgithub/workflows/*.yml`
- Missing workflow script references: 0
- Freshness cadence: every 3 days
- Admin diagnostics: runs without error
- Public validation gate: runs without hard failures
- Source expansion gate: runs without errors
- Page generation: 91 generated pages for 91 public jobs
- Stale generated pages pruned: pass
- Archived/rejected fingerprint violations: 0

## Repairs Applied

| Area | Fix |
|---|---|
| Public refresh | Fixed `finalJobsJsonCount` runtime error and prevented invalid current pay from overriding clean canonical pay. |
| Source expansion validation | Disabled blocked source configs are allowed as governance records; enabled blocked sources, public jobs, pending jobs, and records still fail validation. |
| Auto-expand workflow | Added page build, public validation, and blocked-source validation after lifecycle processing. |
| Freshness workflow | Confirmed the scheduled freshness workflow runs on a 3-day cadence. |
| Admin actions | Confirmed `npm run jobs:diagnose-admin-actions` works and stale queued actions are not applied. |
| Page generation | Confirmed generated page count, missing page URL count, stale page URL count, and duplicate slug count are all clean. |
| System health report | Fixed malformed markdown table separators in `scripts/system-health-dashboard.js`. |

## Validation Commands

```bash
npm run jobs:refresh-public
node scripts/generate-job-pages.js
node scripts/full-overhaul-verify.js
npm run jobs:validate-public-data
npm run jobs:validate-source-expansion
npm run jobs:diagnose-admin-actions
npm run jobs:freshness-audit -- --dry-run
npm run jobs:system-health-dashboard
```

## Latest Results

| Check | Result |
|---|---|
| `jobs:refresh-public` | Pass, 91 public jobs written |
| `generate-job-pages` | Pass, 91 expected pages, 1 stale closed TNC page pruned |
| `full-overhaul-verify` | Pass, 27/27 validations |
| `jobs:validate-public-data` | Pass, 0 hard failures |
| `jobs:validate-source-expansion` | Pass, 0 errors |
| `jobs:diagnose-admin-actions` | Pass, 0 queued actions |
| `jobs:freshness-audit -- --dry-run` | Pass, no script errors |
| `jobs:system-health-dashboard` | Pass, dashboard refreshed |

## Residual Warnings

- `jobs:validate-public-data` reports warning-only pipeline health items: NRDC, 350.org, and ACLU are missing from the public board, and broad-source pending dominance is about 52%.
- `jobs:validate-public-data` reports a snapshot page-count drift warning because the closed Nature Conservancy Montana page was removed from public output.
- `jobs:freshness-audit -- --dry-run` completed but the sandboxed run classified live checks as uncertain network failures, so it made no data changes.
- Workflow templates live in `backend/dotgithub/workflows`; the project does not currently have committed workflow files under `.github/workflows`.
