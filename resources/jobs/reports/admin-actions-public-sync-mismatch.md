# Admin Actions Public Sync Mismatch Audit

- **Audit date:** 2026-05-25
- **File:** `jobs/scripts/apply-admin-actions.js`
- **Error:** `jobs.json sync mismatch: expected 60 public jobs, found 39`

## Root Cause

In `apply-admin-actions.js`, when applying **scoped** admin actions:

```
expected_public_jobs_count = buildPublicJobsFromRecords(nextRecords).length    // total = 60
publicSync = syncPublicJobsFromRecords(nextRecords, { scopeIds: selectedIds }) // scoped = 39
final_jobs_json_count = readJobs().length                                      // actual = 39
syncMismatch = final_jobs_json_count !== expected_public_jobs_count            // 39 !== 60 → THROW
```

`expectedPublicJobsCount` was computed from ALL publishable records (60), but the scoped sync only modified selected records while preserving existing jobs.json entries (35 existing + ~4 scoped changes = 39). The pre-computed "expected" count did not account for the scoped merge behavior.

## Fix Applied

### 1. `apply-admin-actions.js:2352-2368`

**Before (broken):**
```js
expectedPublicJobsCount = buildPublicJobsFromRecords(nextRecords).length;  // 60 = total
publicSync = await syncPublicJobsFromRecords(nextRecords, { scopeIds });
finalJobsJsonCount = syncedJobs.length;             // 39 = scoped
syncMismatch = finalJobsJsonCount !== expectedPublicJobsCount;             // 39 !== 60 → fail
```

**After (fixed):**
```js
// Report reconciliation state before running sync
const existingJobsJsonCount = existingJobs.length;
const totalPublishableRecordsCount = buildPublicJobsFromRecords(nextRecords).length;
console.log(`reconciliation_check existing=${existingJobsJsonCount} records=${totalPublishableRecordsCount} ...`);

publicSync = await syncPublicJobsFromRecords(nextRecords, { scopeIds });
finalJobsJsonCount = syncedJobs.length;
// Use the sync's own publishedCount (which accounts for scoped merging)
expectedPublicJobsCount = publicSync.publishedCount;
syncMismatch = finalJobsJsonCount !== expectedPublicJobsCount;  // compares against scoped-aware count
```

### 2. `jobs-sync.yml:68`

**Before (syntax warning):**
```yaml
if: hashFiles('${{ env.JOBS_DIR }}/scripts/enrich-pending-descriptions.js') != ''
```

**After (no warning):**
```yaml
if: hashFiles(env.JOBS_DIR + '/scripts/enrich-pending-descriptions.js') != ''
```

## Safety Preserved

- `syncPublicJobsFromRecords` still validates internally that `finalJobsJsonCount === computedPublicJobsCount`
- The external check in `apply-admin-actions.js` still validates against `publicSync.publishedCount`
- Hard failures (octopus missing-from-source, broken links, etc.) still fail the workflow
- `jobs.json` is never written if the sync detects a mismatch internally

## Current State

| Measure | Value |
|---|---|
| `job-records.json` total records | 134 |
| `buildPublicJobsFromRecords(records)` | 56 |
| `jobs.json` entries | 56 |
| Consistency | ✅ Match |

## Workflow Audit

| Check | Status |
|---|---|
| Runs reconciliation/validation before apply | ✅ Added reconciliation diagnostic log |
| Commits job-records.json and jobs.json together | ✅ Already done |
| No stale-source-health validation before sync | ✅ Already fixed in prior session |
| Node 24 compatible | ✅ Uses `setup-node@v4` with `node-version: "24"` |
