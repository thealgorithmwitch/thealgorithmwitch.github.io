# Job Type Normalization Report

Generated: 2026-05-25T01:27:39.107Z

## Summary

| metric | value |
| --- | --- |
| Files Checked | 4 |
| Dash-Only Values Fixed | 0 |

## Per-File Fixes

| file | items | fixed | status |
| --- | --- | --- | --- |
| jobs.json | 56 | 0 | processed |
| job-records.json | 134 | 0 | processed |
| pending-synced-jobs.json | 164 | 0 | processed |
| jobs2.json | 77 | 0 | processed |

## Fixed Entries (sample)

_None_

## Fixes Applied

- normalizeEmploymentType() in job-normalizer.js rejects dash-only values (returns fallback)
- validate-public-data.js now validates job_type against VALID_JOB_TYPES
- Frontend normalizeEmploymentTypeLabel() returns empty string for dash-only values
- Raw data files patched: dash-only job_type values nulled out
