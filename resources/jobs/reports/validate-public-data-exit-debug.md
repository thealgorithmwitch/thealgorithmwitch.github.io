# Validate Public Data Exit Code Debug

## Root Cause

`validate-public-data.js` exited 1 because of **2 hard validation failures** caused by a single record:

| Hard Failure | Reason | Record |
|---|---|---|
| `octopus-energy-missing-from-source` | `octopus_public_missing_from_latest_source_snapshot` | Octopus Energy Analytics Engineer |
| `octopus-energy-priority` | `octopus_priority_policy_violation` | Octopus Energy Analytics Engineer (exclude_engineering, score=-10) |

Both map to the same job: **Analytics Engineer** (`Octopus Energy-9f808a26-417d-40e8-be92-3b32a8625194`).

## Why counts matched but exit was 1

The exit code is set by this logic at `validate-public-data.js:1406-1408`:

```javascript
if (report.errors.length) {
    process.exitCode = 1;
}
```

The `errors` array is populated by **37 conditions** (lines 1197-1232). Count-matching conditions (line 1197: `publicRecordsCount !== jobsJsonCount`) were passing (63===63), but **other conditions** further down were triggered:

- Line 1230: `octopusValidationViolations.length` → `2` → pushed `"octopus validation violation count 2"`
- Line 1231: `hardValidationFailures.length` → `2` → pushed `"hard validation failure count 2"`

**Not** caused by:
- Page count drift (not in `errors` array, only in snapshot regressions)
- Broad source dominance (only pushes to `warnings`, not `errors`)
- Pipeline health warnings (only pushes to `warnings`, not `errors`)

## Fix Applied

Unpublished the stale Octopus Analytics Engineer record:

1. Removed from `jobs.json` (62 jobs remaining)
2. Updated `job-records.json`: status=`pending`, published=`false`, public_visibility=`false`, verification_status=`removed`
3. Rebuilt pages (1 written, 2 stale deleted)

## Final State

| Metric | Before | After |
|---|---|---|
| public_records_count | 63 | 62 |
| jobs_json_count | 63 | 62 |
| generated_page_count | 63 | 62 |
| broken_link_count | 0 | 0 |
| hard_validation_failure_count | 2 | 0 |
| octopus_validation_violation_count | 2 | 0 |
| errors (array) | `["octopus validation violation count 2","hard validation failure count 2"]` | `[]` |
| warnings | 4 pipeline health | 4 pipeline health |
| validation_snapshot_regressions | `[]` | `[]` (clean) |
| **exit code** | **1** | **0** |

## All Conditions That Set Exit Code 1

Listed in `validate-public-data.js:1197-1232` — 37 conditions checked, 0 triggered after fix.
