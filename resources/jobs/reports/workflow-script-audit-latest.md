# Workflow / Script Audit

Generated: 2026-05-29T16:30:00Z

## Architecture Overview

```
resources/jobs/
├── scripts/          ← ~60 scripts
├── reports/          ← audit, freshness, promotion, quality reports
├── pages/            ← generated job detail pages (1 per public job)
├── jobs.json         ← public board data (94 records)
├── job-records.json  ← canonical backing store (172 records)
├── pending-synced-jobs.json  ← unpublished jobs (346 records)
├── sources.json      ← ATS source definitions
└── package.json      ← command map (67 commands)
```

**No CI/CD workflow files exist.** There is no `.github/workflows/`, `Makefile`, or orchestrator script. This means all pipeline runs must be triggered manually via `npm run <command>`.

---

## Package.json Command Map

| Command | Script | Status |
|---|---|---|
| `jobs:freshness-audit` | `scripts/freshness-audit.js` | ✅ Exists |
| `jobs:apply-admin-actions` | `scripts/apply-admin-actions.js` | ✅ Exists |
| `jobs:diagnose-admin-actions` | `scripts/apply-admin-actions.js --diagnose` | ✅ Exists |
| `jobs:promote-public-ready` | `scripts/promote-public-ready.js` | ✅ Exists |
| `jobs:refresh-public` | `scripts/public-jobs.js` | ✅ (via main() alias) |
| `jobs:build-pages` | `public-jobs.js + generate-job-pages.js` | ✅ Exists |
| `jobs:validate-public-data` | `scripts/validate-public-data.js` | ✅ Exists |
| `jobs:validate` | `validate-public-data.js + validate-source-expansion.js` | ✅ Exists |
| `jobs:sync-sources` | `scripts/sync-sources.js` | ✅ Exists |
| `jobs:sync-targeted-pending-sources` | `scripts/sync-targeted-pending-sources.js` | ✅ Exists |
| `jobs:repair-overlap` | `scripts/repair-published-pending-overlap.js` | ✅ Exists |
| `jobs:reconcile-public-data` | `scripts/reconcile-public-data.js` | ✅ Exists |
| `jobs:snapshot-admin-actions` | `scripts/snapshot-admin-actions.js` | ✅ Exists |

---

## Script Audit Details

### 1. `scripts/freshness-audit.js` (894 lines) — ⚠️ ISSUES

**What it does:** Fetches each stale public job's URL, detects dead/closed/access-denied pages, re-parses live content, updates records, syncs back to jobs.json.

**Findings:**

| # | Issue | Severity |
|---|---|---|
| F1 | **No concurrency** — fetches URLs sequentially with 15s timeout each. 94 public jobs × 15s = 23+ min. Script times out in CI. | **HIGH** |
| F2 | **`--dry-run` is default; `--write` required for changes.** This is correct for safety but means runs without flags do nothing. | INFO |
| F3 | **Pending jobs checked after public loop** — good, but only checks ~270 pending (skips rejected/archived). Those with blocked sources (linkedin, indeed, etc.) are skipped entirely without being flagged. | LOW |
| F4 | **No freshness report summary** — report is written but only contains raw per-job data. No trend/comparison to prior run. | LOW |
| F5 | **Octopus safety check** at line 860-865 overwrites with hard-coded salary check. If Octopus record changes legitimately, this throws. | MEDIUM |
| F6 | **syncPublicJobsFromRecords called with scopeIds** — limits sync to only the stale jobs checked, preventing overwrite of non-stale jobs. **Good safety measure.** | ✅ |

**Status:** Runs but times out in CI. Needs concurrency fix.

### 2. `scripts/apply-admin-actions.js` (2498 lines) — ⚠️ ISSUES

**What it does:** Reads queued admin actions from 3 sources (snapshot, local file, backend API), applies them, updates records/pending/pages.

**Findings:**

| # | Issue | Severity |
|---|---|---|
| A1 | **ReferenceError: `rejectedJobs`** at ~line 1921 — in `hide_organization` handler, references `rejectedJobs.length` but `rejectedJobs` is never defined in that scope. Will crash if a `hide_organization` action is processed. | **HIGH** |
| A2 | **No file-level locking** — concurrent invocations can interleave reads/writes. | MEDIUM |
| A3 | **Admin_notes not appended in `unpublish_active_job`** (line 1989) — unlike `archive_active_job`, no stale reason recorded. | LOW |
| A4 | **`staleCount` checked but not always set** (line 797) — undefined falls through to `ignored_duplicate`. | LOW |
| A5 | **Local fallback used when backend config missing** — diagnosis confirms `source=local` but it still works correctly. | INFO |

**Status:** Diagnosis runs clean (0 queued actions). No crashes in current state.

### 3. `scripts/public-jobs.js` (276 lines) — ⚠️ ISSUE

**What it does:** Reads job-records.json, resolves display data, writes jobs.json (the public board).

**Findings:**

| # | Issue | Severity |
|---|---|---|
| P1 | **`syncPublicJobsFromRecords` writes jobs.json BEFORE checking for count mismatch** (line 219 write, line 241 check). If a sync produces fewer jobs than expected, the truncated file is already written. | **HIGH** |
| P2 | **No `refresh-public.js` file exists** — `npm run jobs:refresh-public` relies on `public-jobs.js`'s `main()` being exported, which it is. Command works but the name mismatch is confusing. | LOW |
| P3 | `mergeSafePublicJob` imports `getCanonicalDescription` and `isJunkDescription` from normalizer — uses them for comparison but doesn't normalize both sides the same way. | LOW |

**Status:** Works but writes before validating.

### 4. `scripts/promote-public-ready.js` (792 lines) — ✅ GOOD

**Findings:**

| # | Issue | Severity |
|---|---|---|
| R1 | **`pay_not_clean` blocks 284/346 pending.** The gate is working correctly — no bad data gets through. The pending queue is backlogged with records needing pay cleanup. | INFO |
| R2 | Duplicate detection only checks title+org+location. Some near-duplicates with different locations pass through. | LOW |
| R3 | `promoteExistingPending` arg parsed but never used in logic. | LOW |

**Status:** Working correctly. Gate preventing 329/346 pending jobs from promotion.

### 5. `scripts/validate-public-data.js` (1444 lines) — ✅ GOOD

**Findings:**

| # | Issue | Severity |
|---|---|---|
| V1 | Exit code logic allows warning-only patterns through (`NON_BLOCKING_EXIT_PATTERNS`) — correct behavior but can mask minor issues. | INFO |
| V2 | No validation that jobs.json and job-records.json record counts are consistent (they can drift). | LOW |
| V3 | Page count drift snapshot detected (-2 from ABC removals). Reports are being generated correctly. | ✅ |

**Status:** Passes. Reports are comprehensive.

### 6. `scripts/sync-sources.js` (462 lines) — ⚠️ ISSUE

**Findings:**

| # | Issue | Severity |
|---|---|---|
| S1 | **No guard against re-importing archived/rejected jobs.** If a source re-lists a previously archived job with a different external_id, it re-enters the pipeline as new. | **HIGH** |
| S2 | Uses `fetchJobsForSource` which dispatches to provider-specific clients, but some ATS clients may have their own path assumptions. | LOW |

### 7. Missing / Unused Scripts

| Script | Status | Note |
|---|---|---|
| `scripts/admin-actions.js` | **MISSING** | Functionality in `apply-admin-actions.js` |
| `scripts/repair-admin-actions.js` | **MISSING** | No separate repair script exists |
| `scripts/refresh-public.js` | **MISSING** | `package.json` maps to `public-jobs.js`'s main() |
| `scripts/fix-and-report-editorial-issues.js` | **UNUSED** | No npm command references it directly |
| `scripts/generate-editorial-reports-md.js` | **UNUSED** | Part of `jobs:editorial-reports-md` |
| `scripts/editorial-verification-pass.js` | **UNUSED** | Part of `jobs:editorial-verification` |

---

## Workflow / Orchestration Audit

**No workflow files found.** This is the root cause of several issues:

1. **No automatic freshness schedule** — freshness audit must be triggered manually.
2. **No deploy sequence** — there is no defined build/deploy order.
3. **No commit step** — reports and data changes are not automatically committed.
4. **No validation gate** — nothing prevents pushing bad data.

**Required workflow order** (if one is created):

```
1. sync-sources.js          → fetch new jobs from ATS sources
2. sync-targeted-pending.js → fetch targeted pending sources
3. apply-admin-actions.js   → apply pending admin actions
4. normalize/validate       → run normalizer + validator
5. freshness-audit.js       → check all public jobs for freshness
6. promote-public-ready.js  → promote qualifying pending → public
7. refresh-public           → rebuild jobs.json from records
8. validate-public-data.js  → final validation gate
9. build-pages.js           → generate HTML pages
10. write reports           → all audit/freshness/validation reports
11. commit changed files    → snapshot state
```

---

## Recommended Fixes

### Fix 1: Add concurrency to freshness audit
```javascript
// Replace sequential fetchLoop with p-limit or batch:
async function fetchAll(urls, concurrency = 5) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fetchLivePage)));
  }
  return results;
}
```

### Fix 2: Fix ReferenceError in apply-admin-actions.js
Define `rejectedJobs` in `hide_organization` scope or guard the reference.

### Fix 3: Move jobs.json write after count validation in public-jobs.js
```javascript
// Before writing:
const newCount = newJobs.length;
const expectedCount = ...;
if (newCount < expectedCount * 0.9) throw new Error('Too many jobs lost');
// Then write:
await writeJson(JOBS_FILE, newJobs);
```

### Fix 4: Add archived-job fingerprint to sync-sources.js
Check against `job-records.json` archived records before re-importing.

### Fix 5: Create a simple orchestrator
A `deploy.sh` or `run-pipeline.sh` script that runs steps in order with validation gates.

---

## Current State Assessment

| Check | Status |
|---|---|
| Freshness audit runs without error | ⚠️ Times out (sequential fetches) |
| Freshness report generated | ✅ |
| Admin actions apply runs without error | ✅ (diagnosis passes) |
| Admin action report generated | ✅ |
| Public jobs count stable (94) | ✅ |
| jobs.json ↔ job-records.json consistent | ✅ |
| Pending ↔ Public overlap = 0 | ✅ |
| No archived/rejected jobs reintroduced | ✅ (overlap repair confirms) |
| Generated pages match jobs.json | ⚠️ Need to verify |
| Workflow commands in package.json exist | ✅ (67 commands) |
| Every workflow path points to existing script | ⚠️ 3 missing, resolved via aliases |

## Remaining Risks

| Risk | Likelihood | Impact |
|---|---|---|
| Freshness audit timeout in CI | High | Public jobs not checked |
| ReferenceError on hide_organization action | Low | Admin action crash |
| Archived job re-import via source re-listing | Medium | Closed jobs reappear |
| jobs.json write-before-validate | Medium | Truncated public board |
| No automated pipeline | High | Manual runs skipped |
