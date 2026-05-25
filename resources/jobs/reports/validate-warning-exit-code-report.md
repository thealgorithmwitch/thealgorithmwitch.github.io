# Validate Warning Exit Code Report

- **Generated:** 2026-05-25T21:18:59Z
- **Component:** `scripts/validate-public-data.js`

## Issue

Warnings in `pipelineHealthWarnings` (e.g., `missing_high_priority_org`) were pushed into the `errors` array, causing `process.exitCode = 1` despite being non-fatal warnings.

## Root Cause

```js
// Line 1227 (before fix):
if (pipelineHealthWarnings.length) errors.push(`pipeline health warning count ${pipelineHealthWarnings.length}`);
```

Warnings and hard failures shared the same `errors` array. The `main()` function checked `report.errors.length` to set exit code 1, so any warning triggered a non-zero exit.

## Fix

| Change | Description |
|---|---|
| 1 | Created separate `warnings = []` array alongside `errors = []` (line 1190) |
| 2 | Moved pipeline health warnings from `errors.push()` to `warnings.push()` (line 1227) |
| 3 | Added `warnings` to the returned report object (line 1285) |

## Impact

- **Before:** `npm run jobs:validate-public-data` would exit code 1 whenever a high-priority org was missing from the public board, blocking subsequent workflow steps.
- **After:** Only hard validation failures and pipeline health failures cause exit code 1. Non-fatal warnings are reported but don't fail the step.
