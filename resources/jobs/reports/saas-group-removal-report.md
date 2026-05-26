# SaaS.group Removal Report

**Generated:** 2026-05-26T00:34:24.985Z

## Summary

| Source | Action |
|---|---|
| sources.json | Already disabled (enabled:false, trusted:false) |
| source-prospects.json | REMOVED |
| pending-synced-jobs.json | 0 remaining (all rejected_noise) |
| jobs.json | 0 public records affected |
| build-source-quality-plan.js | REMOVED from filtered org list |
| apply-source-quality-plan.js | REMOVED from prospect array |
| fix-pending-source-state.js | KEPT in LOW_RELEVANCE_SOURCE_IDS |
| blocked-source-utils.js | ADDED blocked source rule |

## Pending Records Rejected (0)

| ID | Title | Bucket | Reason |
|---|---|---|---|

## Files Modified

- `resources/jobs/source-prospects.json`: Deleted SaaS.group entry
- `resources/jobs/pending-synced-jobs.json`: 2 SaaS.group records set to rejected_noise
- `resources/jobs/scripts/build-source-quality-plan.js`: Removed SaaS.group from list
- `resources/jobs/scripts/apply-source-quality-plan.js`: Removed SaaS.group from array
- `resources/jobs/scripts/blocked-source-utils.js`: Added saas-group blocked rule
- `resources/jobs/scripts/fix-pending-source-state.js`: Kept in LOW_RELEVANCE_SOURCE_IDS (no change needed)
