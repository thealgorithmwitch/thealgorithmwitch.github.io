# Public Data Surgical Repair Report

Generated: 2026-05-31T00:47:00Z

## HubSpot Consultant — Removed

- **ID**: `Renew Home-8F00486888`
- **Action**: Removed from `jobs.json`, archived in `job-records.json`
- **Archive reason**: `closed_or_invalid_hubspot_consultant`
- **Generated page**: `pages/hubspot-consultant-renew-home.html` deleted
- **Archived fingerprint**: `archived:2026-05-31:closed_or_invalid_hubspot_consultant:Renew Home-8F00486888`

## Powerlines Fake Pay — Cleared

**Two jobs affected** — the job ID `1395197333` was misinterpreted as salary `$420,887 / year`:

| Job | ID | Original Pay | Status |
|---|---|---|---|
| Government Partnerships Advisor (Part-Time) | `Powerlines-E734A9CDE4` | `$420,887 / year` | Cleared, rejected |
| Philanthropic Advisor (Part-Time) | `Powerlines-55200B599B` | `$420,887 / year` | Cleared, rejected |

**Fields cleared**: `salary`, `raw_salary`, `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_visible=false`, `pay_confidence=rejected`, `pay_rejected_reason=metadata_or_false_positive_no_visible_pay`, `raw_pay_candidate=$420,887 / year`.

## Powerlines Malformed Markdown — Cleaned

**Four jobs affected** — broken markdown link syntax in descriptions from ATS scraping:

| Job | Pattern Fixed | Readable Text |
|---|---|---|
| Government Partnerships Advisor | `]([National...` nested brackets | National Governors Association, National Conference of State Legislatures ( |
| Director of State Policy | `]([National...` + `]()` empty URLs | National Governors Association, National Conference of State Legislatures ( |
| Philanthropic Advisor | `](and` protocol error + `]()` empty | National Governors Association, and Western Governors Association |
| Director of Development | `](and` protocol error + `]()` empty | National Governors Association, and Western Governors Association |

## Parser Rules

- `generate-job-pages.js` now respects `salary_visible` flag for salary badge display
- Malformed markdown cleaner added for `]([`, `]()`, `](and`, `](to` patterns
