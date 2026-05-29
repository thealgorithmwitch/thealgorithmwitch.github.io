# Source Onboarding Report

**Generated:** 2026-05-29T02:57:36.456262Z

## Summary

- **New sources added:** 3
- **Total jobs found:** 5
- **Total jobs accepted:** 5
- **Total jobs rejected:** 0
- **All jobs routed to:** pending (manual review required)

---

## Source 1: Energy & Policy Institute

| Field | Value |
|---|---|
| Source ID | `energy-policy-institute` |
| Type | Custom HTML parser |
| URL | https://energyandpolicy.org/jobs/ |
| Expected jobs | 3 |
| Jobs found | 3 |
| Route | pending |
| Pay visible | No |

### Jobs

- **Data Engineer**
  - Location: Washington, DC
  - Type: Full-time


- **Research Manager**
  - Location: Washington, DC
  - Type: Full-time


- **Research Fellow**
  - Location: Washington, DC
  - Type: Full-time

### Parser
Custom parser `energy-policy-institute` extracts job titles from known list matched against page HTML.

### Infrastructure
- Created `scripts/scrapers/parsers/energy-policy-institute.js`
- Registered in `scripts/scrapers/index.js`
- Source config: `type: "generic"`, `parser: "energy-policy-institute"`

---

## Source 2: Permit Power

| Field | Value |
|---|---|
| Source ID | `permit-power` |
| Type | CareerPuck ATS |
| URL | https://app.careerpuck.com/job-board/permit-power |
| Expected jobs | 1 |
| Jobs found | 1 |
| Route | pending |
| Pay visible | No (mentioned in description) |

### Job

- **Advocacy Director**
  - Location: Remote
  - Type: Full-time

### API
CareerPuck public API: `https://api.careerpuck.com/v1/public/job-boards/{company_slug}`
- Requires `Origin: https://app.careerpuck.com` and `Referer: https://app.careerpuck.com/`
- Returns full job data including HTML descriptions
- Uses `atsSourcePlatform: "puck"`

### Infrastructure (new ATS provider: `careerpuck`)
- Created `fetchCareerPuckJobsForSource()` + `careerPuckJobToSchema()` in `ats-clients.js`
- Registered in `fetchAtsJobsByProvider()`
- Added to `ATS_PROVIDERS`, `DIRECT_PROVIDER_TYPES`, `SUPPORTED_TYPES`, `ELIGIBLE_PROVIDERS`
- Added detection patterns to `discovery.js` and `source-discovery-helpers.js`

---

## Source 3: Climate Action Campaign

| Field | Value |
|---|---|
| Source ID | `climate-action-campaign` |
| Type | Trakstar Hire ATS |
| URL | https://climateactioncampaign.hire.trakstar.com/ |
| Expected jobs | 1 |
| Jobs found | 1 |
| Route | pending |
| Pay visible | No (mentioned in description) |

### Job

- **DigiComms Fellowship**
  - Location: Washington, District of Columbia, United States
  - Type: Part-time

### API
Trakstar Hire RSS feed: `https://{company_slug}.hire.trakstar.com/jobfeeds/{rss_company_name}`
- **Case-sensitive** company name (e.g., `ClimateActionCampaign` not `climateactioncampaign`)
- No public JSON API available
- Feed includes location, team, position type, and full HTML description
- Company slug stored in source config as `rss_company_name`

### Infrastructure (new ATS provider: `trakstar`)
- Created `fetchTrakstarJobsForSource()` + `trakstarJobToSchema()` in `ats-clients.js`
- RSS XML parser uses regex extraction (no external XML dep needed)
- Registered in `fetchAtsJobsByProvider()`
- Added to `ATS_PROVIDERS`, `DIRECT_PROVIDER_TYPES`, `SUPPORTED_TYPES`, `ELIGIBLE_PROVIDERS`
- Added detection patterns to `discovery.js` and `source-discovery-helpers.js`

---

## Infrastructure Changes Summary

- **14 files modified:** ats-clients.js, source-utils.js, sync-sources.js, sync-targeted-pending-sources.js, sync-custom.js, discovery.js, source-discovery-helpers.js, scrapers/index.js
- **1 file created:** scrapers/parsers/energy-policy-institute.js
- **1 file updated:** sources.json (+3 entries, 184 -> 187)

## Validation Results

- **Duplicate check:** PASS
- **Public/pending overlap:** PASS
- **Blocked employer check:** PASS
- **Title parsing:** Verified clean for all 5 jobs
- **Pay:** Hidden for all (not extracted as structured data; $ amounts present in descriptions only)
