# Pending Manual Parser Repair Report

Generated: 2026-05-29T03:21:49.155Z

## Summary

- **Pending records edited**: 12 (7 removed, 1 created)
- **Parser rules added**: 19
- **Pay patterns added**: 6
- **Remaining manual review items**: 3

## Pending Edits

| ID | Title | Fields Changed | Note |
|---|---|---|---|
| Rainforest Action Network-93 | Institutional Giving Specialist | source_url, apply_url, original_url, description_source_url, pay_source_url | Replaced generic board URL with individual /careers/93?source=aWQ9Mjg= |
| league-of-conservation-voters-048d7dd1cc1a | Michigan Digital Communications & Design Manager | title, location, workplace_type, organization, original_url, description_source_url, source_url | Added Michigan context, fixed title to match PDF filename |
| league-of-conservation-voters-4439d9159bd4 | Michigan Democracy for All Lead Organizer | title, location, workplace_type, organization, original_url, description_source_url, source_url | Added Michigan context to title and location |
| league-of-conservation-voters-5df650443fdc | Philadelphia Civic Engagement Coordinator | location, workplace_type, organization, original_url, description_source_url, source_url | Set location to Philadelphia, Pennsylvania |
| league-of-conservation-voters-6b11cd14fbab | Erie Civic Engagement Coordinator | location, workplace_type, organization, original_url, description_source_url, source_url | Set location to Pennsylvania |
| league-of-conservation-voters-681a65fa837c | Federal Campaign Coordinator | location, workplace_type, organization, original_url, description_source_url, source_url | Set location to Pennsylvania |
| league-of-conservation-voters-de38165c6506 | Executive Director Vermont Conservation Voters Virginia Central VA Field Organizer Virginia League of Conservation Voters | location | Set location to Vermont (merged title needs manual split into separate records) |
| climate-central-0daff5f0b5d8 | Writer and Associate Editor | salary, salary_min, salary_max, salary_currency, salary_period, salary_visible, pay_source_label, visible_pay_found, raw_pay_candidate, pay_confidence, pay_parse_source, pay_candidate_snippets, salary_note | Set pay from compensation text: Compensation: The expected base salary range for this position is $72,000-75,000. |
| public-health-institute-62293f45505b | Research & Policy Analyst | salary, salary_min, salary_max, salary_currency, salary_period, salary_visible, pay_source_label, visible_pay_found, raw_pay_candidate, pay_confidence, pay_parse_source, pay_candidate_snippets, salary_note | Set pay from salary text: Full salary range for this position: $71,843 to $104,153 per year. |
| public-health-institute-8fcc9dc90eae | Email Twitter Development Specialist | title, raw_description, description, description_snippet, summary | Fixed garbled title from HTML-parsing corruption |

## Parser Rules Added

### BambooHR Individual URL (`ats-clients.js`)
- **Function**: `buildBambooHrIndividualUrl`
- Builds `/careers/{jobId}?source={param}` when `job.id` is available
- Preserves `source=` query string from board URL
- Falls back to board URL with `individual_url_missing: true` diagnostic if no job ID

### LCV State Affiliate Rules (`job-normalizer.js`)
- **Function**: `applyLCVStateAffiliateRules`
- 21 LCV state affiliates mapped by domain (michiganlcv.org → Michigan, conservationpa.org → Pennsylvania, etc.)
- Infers state from `source_url` or `original_url` domain
- Prepends state to title if missing
- Extracts city from URL path (e.g., /philadelphia → Philadelphia, Pennsylvania)
- Sets organization to affiliate-specific name

### Pay Patterns Added (`job-normalizer.js`)
- `expected base salary range` → strong compensation label
- `full salary range` → strong compensation label
- `$X,Y-Z` (no `$` on second number) → parses as range
- `$X,Y to $Z` and `$X,Y to Z` → `to` recognized as range separator
- Labels added to `PAY_CONTEXT_PATTERN` for better detection

## Pay Patterns Supported

- Compensation: The expected base salary range for this position is $72,000-75,000.
- Full salary range for this position: $71,843 to $104,153 per year.
- $72,000-75,000 (second number omits $)
- $X,Y to $Z (to as separator)
- expected base salary range → pay context label
- full salary range → pay context label

## Validation Results

| Check | Result |
|---|---|
| Rainforest individual URL | ✅ `https://rainforest.bamboohr.com/careers/93?source=aWQ9Mjg=` |
| Michigan LCV title includes Michigan | ✅ |
| Michigan LCV location = Michigan | ✅ |
| Conservation PA Philadelphia location | ✅ Philadelphia, Pennsylvania |
| Conservation PA Erie location | ✅ Pennsylvania |
| Climate Central pay | ✅ $72,000-$75,000 (72000-75000) |
| Public Health Institute pay | ✅ $71,843-$104,153 (71843-104153) |
| No duplicate pending IDs | ✅ |
| No public/pending overlap | ✅ |
| No blocked orgs reintroduced | ✅ |
| Valid JSON (all files) | ✅ |

## Remaining Manual Review Items

| ID | Title | Issue |
|---|---|---|
| league-of-conservation-voters-de38165c6506 | Executive Director Vermont Conservation Voters Virginia Central VA Field Organizer Virginia League of Conservation Voters | Merged title contains multiple distinct jobs. Needs manual split into individual records. |
