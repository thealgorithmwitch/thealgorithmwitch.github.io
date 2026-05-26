# Job Count Audit Report

**Generated:** 2026-05-26T00:52:46.691Z

## Summary

After the pay-gated auto-publish, `jobs.json` had **61** jobs but job-records reported only **60** published. Root cause identified and fixed.

| Metric | Before | After |
|---|---|---|
| jobs.json | 61 | 61 |
| Published records | 60 | 61 |
| Match | NO | **YES** |

## Root Cause

In `buildJobRecord()` (`public-records.js:422-425`):

```javascript
const published = existing.id
    ? Boolean(existing.published)  // preserves existing false
    : ["active", "approved", "published"].includes(status);
```

When a job already has a record in job-records.json (from pending triage), the `published`, `public_visibility`, and `status` flags are **preserved from the existing record**, ignoring the incoming job's values.

The auto-publish script called `syncJobRecordStore(publicJobs)` which called `buildJobRecord(job, existingRecord)` for each job. Since `existingRecord.id` was truthy, the existing `published: false`, `public_visibility: false`, `status: "pending"` were kept, even though the incoming job had `published: true`.

## Affected Job

| Field | Incoming Job | Existing Record | Result |
|---|---|---|---|
| id | arevon-a3d114f378de | arevon-a3d114f378de | ✓ match |
| published | true | false | **false** (WRONG) |
| public_visibility | true | false | **false** (WRONG) |
| status | active | pending | **pending** (WRONG) |

## Fix

1. **Immediate fix**: Patched `arevon-a3d114f378de` record in job-records.json to set `published=true`, `public_visibility=true`, `status="published"`.
2. **Script fix**: Updated `scripts/pay-gated-autopublish.js` with a post-sync fixup loop that reads job-records.json after `syncJobRecordStore` and corrects published flags for all auto-published jobs.

## Verification

| Check | Result |
|---|---|
| jobs.json count | 61 |
| Published records count | 61 |
| In jobs.json but not published | 0 |
| In published but not jobs.json | 0 |

Counts now match.