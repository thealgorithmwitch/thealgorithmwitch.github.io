# Octopus Validation Fix Report

**Generated**: 2026-05-25T23:15:00Z

## Root Cause

The Octopus Energy source scrape URL targets **US locations only**:

```
https://octopus.energy/careers/join-us/#/?location=Austin%2C%20TX&location=Houston%2C%20TX&location=United%20States%2C%20Remote
```

Four published Octopus jobs are **UK-based** with Lever ATS URLs (`jobs.lever.co/octoenergy/XXXXX`). They are intentionally curated priority roles (scores 5–12, not excluded) but never appear in the US-scoped scrape snapshot.

The source is authoritative (source_status: live, freshness_score: 100, zero errors) — the scrape just cannot reach these UK roles.

## Affected Jobs

| Title | Location | Lever URL ID | Priority Score | Category |
|-------|----------|-------------|---------------|----------|
| Partnerships Manager - European Speaking | London (GB) | `9692a7c6-...` | 5 | partnerships_contracts_policy |
| Partnerships Manager | London (GB) | `9d3dbeed-...` | 5 | partnerships_contracts_policy |
| Digital Marketing Manager | London (GB) | `cc10b161-...` | 12 | marketing_lead + comms_creative |
| Performance Marketing Lead | London (GB) | `b5557512-...` | 12 | marketing_lead + comms_creative |

## Exemption Criteria

The function `isOctopusUkLeverPriorityRole(item)` exempts a job only when **all** conditions are true:

1. **Organization**: `item.id` starts with `"Octopus Energy-"`
2. **Priority**: `item.priority` exists, `score > 0`, `excluded !== true`
3. **Lever ATS URL**: `item.identity.canonical_url` includes `jobs.lever.co/octoenergy`
4. **UK Location**: The location component of `title_company_location` matches `\b(london|gb|united kingdom|uk)\b`

## Why Generic Octopus Jobs Still Fail

A non-UK Lever job (e.g. "Manager" in Paris (FR)) or a non-Lever Octopus job (e.g. an engineering role) missing from the snapshot is **not exempted** and still triggers a hard validation failure. Only the 4 curated UK priority roles escape the missing-from-source check.

## Files Changed

| File | Line(s) | Change |
|------|---------|--------|
| `scripts/octopus-source-reconciliation.js` | 316+ | Added `isOctopusUkLeverPriorityRole()` helper (narrow 6-condition check) and exported it |
| `scripts/validate-public-data.js` | 9-14, 1107-1114 | Imported and used narrow helper instead of broad priority check |
| `scripts/octopus-source-reconciliation.js` | 256, 282-288 | Used narrow helper in archive/retain decisions and missing-from-source reporting |

## Safety Guarantees Still In Effect

- ✅ **Octopus public cap (5)** — still enforced regardless of priority
- ✅ **Excluded priority violations** — low-priority/excluded Octopus jobs on public board still flagged
- ✅ **Non-UK, non-Lever Octopus jobs missing from snapshot** — still hard validation failures
- ✅ **Generic (non-priority) Octopus jobs missing from snapshot** — still hard validation failures
- ✅ **Stale Octopus records** — still flagged
- ✅ **Duplicate Octopus URLs/IDs** — still flagged
- ✅ **Missing-from-source lifecycle** (grace period, confirmations, archive) — still applies to non-exempted jobs

## Verification Results

| Metric | Before | After |
|--------|--------|-------|
| `octopus_validation_violation_count` | 1 | **0** |
| `hard_validation_failure_count` | 1 | **0** |
| `errors` length | 2 | **0** |

**Commands passed**:
- `npm run jobs:validate-public-data` — passed (0 errors, 0 hard failures)
- `npm run jobs:validate-source-expansion` — passed (0 errors, 0 warnings)
- `npm run jobs:build-pages` — passed (56 pages, 0 stale, 0 redirects)
