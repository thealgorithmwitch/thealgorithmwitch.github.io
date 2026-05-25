# Manual Source False Positive Cleanup Report

**Generated**: 2026-05-25T22:30:00Z

## Summary

- **102** manual-source candidates evaluated across 6 sources
- **32** retained as review_ready (real job postings)
- **69** rejected (non-job titles/URLs)
- **1** needs_cleanup (Bullard Center - empty title, real job URL, needs title extraction fix)
- **70** removed from review_ready

## Changes Applied

### `scripts/pending-triage.js`

Replaced the unconditional manual-source bypass (lines 929-944) — which routed ALL jobs from `manual_review_community`, `tracked_manual_org`, `community_submission_source` to `review_ready` with zero validation — with `validateManualSourceCandidate()`:

- **Title validation**: Rejects empty/untitled, generic non-job titles (View All Jobs, Powered by, Find jobs in X, Join #TeamRWE, Explore opportunities, etc.)
- **URL validation**: Rejects non-job URLs (CAP reports, energycommunities.gov funding pages, career stories, privacy/legal/locale pages, RWE ?ci=/?cn= search pages, JazzHR listing pages, etc.)
- **Title recovery**: `attemptTitleRecovery()` extracts titles from `raw_description` when the parser left the title empty (GIS Manager, Donor Engagement Manager, and general role-title patterns)
- **Empty title handling**: Empty titles with real-looking job URLs (e.g., `jobs.tsu.edu/postings/9798`) route to `needs_cleanup` instead of `rejected_noise`

### `sources.json`

| Source | Change |
|--------|--------|
| `nextera-energy` | Added `source_classification: tracked_manual_org`; updated notes |
| `rwe` | Added `source_classification: tracked_manual_org` |
| `louisiana-bucket-brigade` | Updated `source_url` to `https://louisianabucketbrigade.applytojob.com/apply/` |

## Results by Source

| Source | Retained | Rejected | Needs Cleanup | Org |
|--------|----------|----------|---------------|-----|
| climate-justice-alliance | 0 | 3 | 0 | Climate Justice Alliance |
| bullard-center | 0 | 0 | 1 | Bullard Center for Environmental and Climate Justice |
| louisiana-bucket-brigade | 2 | 0 | 0 | Louisiana Bucket Brigade |
| emerald-cities-collaborative | 2 | 2 | 0 | Emerald Cities Collaborative |
| rwe | 0 | 50 | 0 | RWE |
| nextera-energy | 28 | 14 | 0 | NextEra Energy |

## Details

### Climate Justice Alliance (3 rejected)
- "View All Jobs" — generic non-job title
- "Powered by" — generic non-job title
- "Click here for current job openings..." — listing page URL (applytojob.com/apply/)

### Bullard Center (1 needs_cleanup)
- Empty title; URL is a real TSU job posting (`jobs.tsu.edu/postings/9798`) but title "GIS Manager" could not be recovered from raw_description
- Needs improved title extraction at scrape time

### Louisiana Bucket Brigade (2 retained)
- "Donor Engagement Manager" — accepted (real title, real job URL)
- "Volunteer Coordinator" — accepted (real title, real applytojob URL)

### Emerald Cities Collaborative (2 retained, 2 rejected)
- **Rejected**:
  - "CAP's Report..." — CAP report URL (americanprogress.org/article/)
  - "Interagency Working Group..." — energycommunities.gov funding page
- **Retained**:
  - "GPC" — emeraldcities.org program page
  - "Green Path Careers (GPC)" — emeraldcities.org program page

### RWE (50 rejected)
- All RWE candidates rejected: city search pages (`?ci=`), country search pages (`?cn=`), employee stories (`/teamrwe/`), career landing pages, FAQ pages, press releases, and generic navigation content
- No real job detail pages found in the current pending data

### NextEra Energy (28 retained, 14 rejected)
- **Rejected**: CA Privacy, English (Canada) locale, Equal Opportunity Employer, Join Our Team, Life at NextEra, View Jobs, Find Open Positions, category pages (Engineering Jobs, Accounting Financing), See Nuclear Careers, See Power Delivery, Emerging Leaders
- **Retained**: Real job detail pages on `jobs.nexteraenergy.com/job/` — Product Manager, Director, Analyst, Attorney, Engineer, etc.

## Test Results

```
Passed: 30/30
```

Key regression checks added:
- Bullard GIS Manager title recovery
- Emerald Cities CAP report rejected
- Energy Communities funding page rejected
- RWE city/country pages rejected (Find jobs in, Discover jobs in, Explore opportunities in, Join #TeamRWE)
- RWE real job detail page accepted
- NextEra privacy policy rejected
- NextEra search page / locale page / category page rejected
- NextEra individual job detail accepted
- CJA "View All Jobs" / "Powered by" rejected
- LBB Donor Engagement Manager accepted
- `looksLikeRealJobUrl()` helper validated
