# Task Status - Jobs Board Full Overhaul

Updated: 2026-05-30T23:07:17Z

## Current Status

The full overhaul pass is complete and verified against the requested gates.

- Public jobs in `jobs.json`: 91
- Pending jobs in `pending-synced-jobs.json`: 329
- Canonical records in `job-records.json`: 175
- Generated detail pages: 91
- Sources configured: 187
- Public/pending overlap: 0
- Duplicate public jobs: 0
- Archive fingerprint violations: 0

## Completed Repairs

- Rebuilt current public data from canonical records and regenerated all job pages.
- Reprocessed `jobs.json`, `job-records.json`, and `pending-synced-jobs.json` for the named bad records.
- Added `scripts/full-overhaul-repair.js` for deterministic known-issue data repair.
- Added `scripts/full-overhaul-verify.js` for the required 26-item regression gate.
- Updated source/parser rules for BambooHR, SmartRecruiters, Trakstar, Nature Conservancy URL conversion, description heading priority, hourly pay, starting-at pay, no-dollar USD annual ranges, Salary Range headings, and Expected salary range wording.
- Hardened public refresh so invalid current pay values are not preserved over clean canonical records.
- Fixed duplicate Remote display handling in `index.html` and generated page metadata.
- Removed and blocked Emerald Cities Collaborative from active public/pending results.
- Marked RMI/Rocky Mountain Institute sources as zero-openings/disabled and removed false-positive pending records.
- Pointed EDF source configuration at `https://www.edf.org/jobs`.
- Archived the Nature Conservancy Montana Director record after live page verification showed the job is no longer posted; the canonical archived record keeps the exact corrected careers.tnc.org URL.
- Updated workflow validation gates under `backend/dotgithub/workflows`.
- Updated `reports/full-overhaul-verification-latest.json` and `.md`.
- Refreshed `reports/system-health-dashboard.json` and `.md`.

## Required Validation Results

All requested validations pass in `reports/full-overhaul-verification-latest.md` (27/27).

- SEEL Project Specialist URL: pass
- Bullard Center pay and description: pass
- Nature Conservancy Montana Director exact canonical URL: pass
- Nature Conservancy Montana Director not public because live page is closed: pass
- No public Nature Conservancy Workday URLs: pass
- No `think %` generated/public text and `Think 100%` preserved: pass
- More Perfect Union Campus Video Editor Fellow pay `$25/hr`: pass
- Renew Home duplicate Remote text removed: pass
- Emerald Cities removed/blocked: pass
- RMI has no public jobs: pass
- Advanced Energy United starting salary `$120,000+ / year`: pass
- Greentown Labs annual range `$60,000-$68,000 / year`: pass
- EDF source is `https://www.edf.org/jobs`: pass
- Oxfam public URLs use `jobs.smartrecruiters.com`: pass
- Climate Action Campaign uses Trakstar job page URL: pass
- Carbon Direct Staff Engineer pay `$184,000-$225,000 / year`: pass
- HASI pay `$80,000-$100,000 / year`: pass
- Fake public salaries 0, 6, and >$500,000: pass
- No duplicate public jobs: pass
- No public/pending overlap: pass
- No archived fingerprint violations: pass
- Generated pages match `jobs.json`: pass
- Workflows reference existing scripts and block on validation: pass

## Commands Verified

- `node scripts/full-overhaul-repair.js`
- `npm run jobs:refresh-public`
- `node scripts/generate-job-pages.js`
- `node scripts/full-overhaul-verify.js`
- `npm run jobs:validate-public-data`
- `npm run jobs:validate-source-expansion`
- `npm run jobs:diagnose-admin-actions`
- `npm run jobs:freshness-audit -- --dry-run`
- `npm run jobs:system-health-dashboard`
- `node --check` on edited parser, workflow, repair, verification, and page-generation scripts

## Remaining Non-Blocking Warnings

- Public validation reports 4 pipeline health warnings: missing high-priority public org coverage for NRDC, 350.org, and ACLU, plus broad-source pending dominance at roughly 52%.
- Freshness dry-run could not live-check network pages in the sandboxed environment and flagged public records for manual review due to network uncertainty. It completed without script errors and made no data changes.
- 34 public jobs still lack visible compensation because no validated base pay was available.
- 263 pending jobs remain pay-blocked/manual-review items; these were not auto-published.
