# Overstrip Repair Report

**Generated:** 2026-05-28T13:48:29.083489Z

## Summary

- **jobs.json**: 84 -> 95 (restored 11)
- **Pending**: 362 -> 214

## Sources Restored

- **Renew Home**: not_found -> active
  - Career page confirmed active with multiple job openings
- **Rainforest Action Network**: no_provider -> active (bamboohr configured)
  - BambooHR provider configured - career page returned 0 jobs (may genuinely have no openings)

## Jobs Restored

- Chapter Director @Sierra Club -> restored
- Reliability Coordinator @ChargerHelp! -> restored
- Staff Sales Engineer, Omnichannel @Renew Home -> published
- Senior Data Scientist, Product Analytics @Renew Home -> published
- Staff Engineer, Full Stack @Renew Home -> published
- Senior Technical Implementation Manager, VPP @Renew Home -> published
- Engineering Manager, Infrastructure @Renew Home -> published
- Senior Engineer, Core Infrastructure @Renew Home -> published
- Product Designer (6 Month Contract) @Renew Home -> published
- Director, Business Development @Renew Home -> published
- Engineering Manager, Consumer @Renew Home -> published

## Jobs Removed

- Engineer in Training, Site Civil Energy Practice: Blocked employer (woolpert) -> removed
- BlueGreen Alliance fake jobs (10), RMI non-jobs (11): Fake/non-job content -> archived
- Reformation (50) + REMIX (6) + Woolpert (8): Blocked employers -> archived
- Data Analyst: Duplicate -> archived

## Safety Rules Applied

- Renew Home: not_found -> active
- RAN: provider-less -> bamboohr configured
- BlueGreen Alliance: confirmed zero_openings

## Rainforest Action Network Verification

**API Response:** [`/careers/list` returned `totalCount: 1`]

**Result:** 1 active job found

**Job:** Institutional Giving Specialist @ Rainforest Action Network (Brooklyn, NY - On-site)

**Previous Bug:** The BambooHR parser checked `payload` or `payload.jobs`, but the API returns jobs at `payload.result`. Also, field names differed (`jobOpeningName` not `jobTitle`, `atsLocation` object not `location` string).

**Fix Applied:** `ats-clients.js` line 481 (`payload.result` fallback) + `bambooHrJobToSchema` updated for actual API shape.

**Side Effects:** This fix also unblocked 350.org, Creator Accountability Network, GBL HR, and SEEL — all were returning 0 jobs due to the same bug.

**Verdict:** RAN has 1 active position. Previously reported as 0 due to parser field-name mismatch, not an actual zero-job source. Not marked as zero_openings.
