# Archive Fingerprint Guard — Validation Report

**Generated:** 2026-05-29T16:28:25Z
**Module:** `scripts/archive-fingerprint-guard.js`
**Status:** ✅ PASS

---

## 1. Archive Records Loaded

| Metric | Value |
|--------|-------|
| Total archive records from `job-records.json` | 18 |
| Statuses present | closed, archived |
| Records with `archived_fingerprint` | 18/18 |
| Records backfilled | 18 |

---

## 2. Guard Diagnostics

| Check | Result |
|-------|--------|
| Public records sanity-scanned | 94 |
| Blocked by own archive | **0** (no false positives) |
| Passed sanity check | 94 |
| False positives | **0** |

---

## 3. Pipeline Entry Points

### sync-sources
- **Simulated guard:** 94 public jobs checked as incoming raw jobs
- **Blocked:** 0 | **Passed:** 94
- **Status:** ✅ PASS

### sync-targeted-pending-sources
- **Simulated guard:** 346 pending jobs checked
- **Blocked:** 6 | **Passed:** 340
- **Status:** ✅ PASS

### promote-public-ready
- **Dry-run executed:** `node scripts/promote-public-ready.js --dry-run`
- **Jobs considered:** 340 | **Archive-blocked:** 6
- **Log lines confirmed:**
  - `Fund Asset Manager` → `Octopus Energy-103c859f` (archived)
  - `Client Onboarding Lead` → `Octopus Energy-1ff311b5` (archived)
  - `Data Lead - Commercial Analytics` → `Octopus Energy-dfb64070` (archived)
  - `Product Manager` → `Octopus Energy-c344a98b` (archived)
  - `Senior Heat Pump Field Application Engineer` → `Octopus Energy-f6d3b885` (archived)
  - `Optimisation Manager` → `Octopus Energy-87dc1a69` (archived)
- **Status:** ✅ PASS

### apply-admin-actions
- **Diagnose mode:** `node scripts/apply-admin-actions.js --diagnose`
- **Actions found:** 0 | **apply_safe:** true
- **Status:** ✅ PASS

### refresh-public
- **Public jobs.json:** 94 jobs, **0** archived/rejected
- **Status:** ✅ PASS

---

## 4. Blocked Records Detail

All 6 blocked records originate from **Octopus Energy** (retained in pending after archival):

| Job Title | Archived Record ID | Archived Status | Archived Reason |
|-----------|-------------------|-----------------|-----------------|
| Fund Asset Manager | Octopus Energy-103c859f | archived | missing_from_latest_octopus_source_snapshot |
| Client Onboarding Lead | Octopus Energy-1ff311b5 | archived | missing_from_latest_octopus_source_snapshot |
| Data Lead - Commercial Analytics | Octopus Energy-dfb64070 | archived | missing_from_latest_octopus_source_snapshot |
| Product Manager | Octopus Energy-c344a98b | archived | missing_from_latest_octopus_source_snapshot |
| Senior Heat Pump Field Application Engineer | Octopus Energy-f6d3b885 | archived | missing_from_latest_octopus_source_snapshot |
| Optimisation Manager | Octopus Energy-87dc1a69 | archived | octopus_recovery_reprioritized |

---

## 5. Data Integrity

| Check | Result |
|-------|--------|
| Public jobs count | 94 |
| Pending jobs count | 346 |
| Job records count | 172 |
| Public/pending overlap | **0** ✅ |
| Archived in public | **0** ✅ |
| Archived in pending | 14 (already marked, separate records from archive guard targets) |
| Duplicate IDs in public | **0** ✅ |
| Duplicate fingerprint pairs (public vs public) | 2 (false positives: same-org `/search` source_url) |

---

## 6. False Positive Analysis

- **0 false positives** detected in guard diagnostics
- 2 same-organization generic `/search` source_url matches found when comparing public jobs against each other — **this does NOT affect the guard** (the guard only compares incoming jobs against archive records, and the org+title+apply_url triple match prevents false blocks)
- Guard correctly requires at least one URL/external-id hit or org+title+apply_url triple match

---

## 7. Reopen / Manual Override

- **Archived jobs are BLOCKED from re-import** even if their status is changed
- Re-import requires **manual override**:
  1. Remove `archived_fingerprint` array from the record in `job-records.json`
  2. Change record `status` to `published`
  3. Set `public_visibility` to `true`
  4. Run `syncPublicJobsFromRecords` to regenerate `jobs.json`
- Or, if the source page is genuinely active again: the job will be re-fetched with a new `apply_url` that won't match any existing fingerprint

---

## 8. Remaining Pending Archived Records

14 pending jobs have `status=archived` but are not caught by the guard because their fingerprints differ from archive records. These are separate records that were archived in the pending system but have no matching archive fingerprint in `job-records.json`. They are **benign** — they would not be promoted (already marked archived) and would not be re-synced.

---

## 9. Commands Run

```bash
# Guard diagnostics
node -e "const g = require('./scripts/archive-fingerprint-guard'); console.log(g.runGuardDiagnostics());"

# Admin actions pre-flight
node scripts/apply-admin-actions.js --diagnose

# Promote dry-run (shows archive_blocked=6)
node scripts/promote-public-ready.js --dry-run

# Public data validation
node scripts/validate-public-data.js

# Overlap check
node scripts/repair-published-pending-overlap.js --dry-run

# Sync-sources simulation (guard 94 public jobs)
node -e "const g=require('./scripts/archive-fingerprint-guard'); const a=g.loadArchiveRecords(); const j=require('./scripts/job-utils').readJson('jobs.json'); console.log(g.guardIncoming(j,a).blocked.length);"

# Pending simulation (guard 346 pending jobs)
node -e "const g=require('./scripts/archive-fingerprint-guard'); const a=g.loadArchiveRecords(); const p=require('./scripts/job-utils').readJson('pending-synced-jobs.json'); console.log(g.guardIncoming(p,a).blocked.length);"

# False positive check (guard published records against archives)
node -e "const g=require('./scripts/archive-fingerprint-guard'); const a=g.loadArchiveRecords(); const r=require('./scripts/job-utils').readJson('job-records.json'); console.log(g.guardIncoming(r.filter(x=>x.status==='published'),a).blocked.length);"
```

---

## 10. Validation Summary

```
✅ No archived jobs reappear in jobs.json
✅ No rejected jobs reappear in pending
✅ No closed jobs reappear after refresh-public
✅ No public/pending overlap
✅ No duplicate IDs in public
✅ Guard diagnostics: 0 false positives
✅ markRemoved stores archived_fingerprint
✅ 18 archive records backfilled with fingerprints
✅ Pipeline guard integrated in 5 scripts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VALIDATION STATUS: PASS
```
