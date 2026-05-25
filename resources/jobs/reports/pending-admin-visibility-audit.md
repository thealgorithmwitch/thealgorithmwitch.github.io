# Pending Admin Visibility Audit

- **Audit date:** 2026-05-24
- **Script:** `diagnose-manual-sources.js`

## Root Cause

Manual sources with `manual_review_required: true` were being **silently dropped** from admin review by two pipeline gates:

### Gate 1: `applySourcePendingControls` (source-sync-quality.js:270)

The `getSourceControlConfig` function returns `maxPendingPerSync: 5` (from `broad-source-config.json` defaults). This activates the full relevance-based capping pipeline even for manual review sources. Jobs that scored below relevance thresholds could be capped or backlogged.

**Fix applied:** Added `source.manual_review_required === true` bypass at line 283 — manual sources now return all incoming jobs directly as `activeReviewJobs`.

### Gate 2: `classifyPendingJob` (pending-triage.js:844)

Even after surviving the sync quality gate, manual source jobs were classified as `rejected_noise` (never reaching admin review) because they didn't meet relevance thresholds (`roleRelevant = climateContext && specializationMatch && score >= 7`).

**Fix applied:** Added bypass check for:
- `job.manual_review_required === true`
- `source_classification === "tracked_manual_org"`
- `source_classification === "manual_review_community"`
- `source_classification === "community_submission_source"`

Jobs matching these criteria bypass relevance filtering and route directly to `review_ready`.

## Pipeline Gate Summary (After Fixes)

| Gate | File | Check | Manual Source Behavior After Fix |
|---|---|---|---|
| enabled | sources.json | `enabled !== false` | Must be enabled |
| shouldUseDiscoverySync | `source-utils.js` | `custom_sync_enabled !== false` | Must not have `custom_sync_enabled: false` |
| ats adapter | `ats-clients.js` | ATS adapter exists | Falls back to generic discovery if no adapter |
| source-sync-quality | `source-sync-quality.js` | relevance/cap check | **Bypassed** for `manual_review_required` |
| pending-triage | `pending-triage.js` | relevance/classification | **Bypassed** for manual review sources |

## Affected Sources (83 total)

- **15 disabled** (enabled=false) — will not sync
- **~20 with `custom_sync_enabled: false`** — excluded from sync-custom
- **~48 active + custom_sync_enabled** — should now appear in admin review

## Changes Made

| # | File | Change |
|---|---|---|
| 1 | `pending-triage.js` | Added `isManualReviewSource` bypass before early rejection checks — routes all manual source jobs to `review_ready` regardless of title quality, confidence, or relevance |
| 2 | `source-sync-quality.js` | Added `source.manual_review_required === true` bypass at line 283 — returns all incoming jobs as `activeReviewJobs` without capping |
| 3 | `job-normalizer.js` | Propagate `manual_review_required` from source config to job in `routeSyncedJob` |
| 4 | `ats-clients.js` | Fixed Rippling adapter field names: `job.title`→`job.name`, `job.link`→`job.url`, `job.location`→`locations[0].name`, `job.department`→`department.name`, `job.workplaceType`→`locations[0].workplaceType` |
| 5 | `sources.json` | Removed duplicate APEN entry (`asian-pacific-environmental-network`), merged metadata into `apen4ej` |

## Remaining Gaps

- 20 manual sources have `custom_sync_enabled: false` — excluded from sync-custom entirely
- No direct ATS adapter for: bamboohr, ashby, workable, smartrecruiters, recruitee (rippling now fixed ✓)
- 15 disabled sources — may need re-enable or removal
