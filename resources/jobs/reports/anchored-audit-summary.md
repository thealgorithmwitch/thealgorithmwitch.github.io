# Anchored Audit Summary — 2026-05-24

## Workflow Automation Audit

**Finding:** No `.github/workflows/` directory — zero CI/CD workflows configured.

The job board pipeline has **no GitHub Actions automation**. All sync and validation must be triggered manually.

**Recommendations:**
- Add scheduled sync-custom workflow
- Add PR validation workflow
- Add deployment workflow

## Pending Admin Visibility Audit

**Root cause identified and fixed.**

Manual sources with `manual_review_required: true` were dropped by two pipeline gates:

| Gate | File | Fix |
|---|---|---|
| applySourcePendingControls | source-sync-quality.js | Added `source.manual_review_required === true` bypass |
| classifyPendingJob | pending-triage.js | Added `job.manual_review_required` + classification bypass |

**Changes made:**
1. `pending-triage.js:1061` — Bypass relevance filter for manual review sources
2. `source-sync-quality.js:283` — Bypass quality caps for manual review sources
3. `job-normalizer.js:3275` — Propagate `manual_review_required` from source to job
4. Removed duplicate APEN source (`asian-pacific-environmental-network`), merged metadata into `apen4ej`

**Remaining gaps:**
- 20 manual sources have `custom_sync_enabled: false` — excluded from sync-custom
- No ATS adapter for bamboohr, ashby, workable, smartrecruiters, recruitee, rippling
- 15 disabled sources
