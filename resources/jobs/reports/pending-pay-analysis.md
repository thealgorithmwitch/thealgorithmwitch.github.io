# Pending Pay Analysis

Generated: 2026-05-29T17:39:28.948Z

## Summary

- **Total pending jobs:** 346
- **Pay-blocked jobs:** 263
- **Pay-blocked rate:** 76%

## Category Breakdown

| Category | Count | % | Description |
|---|---|---|---|
| A: no compensation | 2 | 1% | No compensation mentioned anywhere in job data |
| B: parser missed existing | 260 | 99% | Compensation exists in raw data but pay validation failed (likely missing formatted salary field) |
| C: hourly compensation | 0 | 0% | Hourly compensation detected |
| D: stipend reimbursement | 0 | 0% | Stipend, reimbursement, fellowship compensation only |
| E: invalid extraction | 1 | 0% | Parser extracted non-pay data (coordinates, internal IDs, etc) |
| F: source failure | 0 | 0% | Source fetch/parse failure prevented any data extraction |

## Top Failing Organizations

| Organization | Blocked | Parser Missed | No Pay |
|---|---|---|---|---|
| Quince | 119 | 119 | 0 |
| NextEra Energy | 26 | 26 | 0 |
| Octopus Energy | 16 | 16 | 0 |
| GoodLeap | 12 | 11 | 1 |
| CALSTART | 7 | 7 | 0 |
| Oxfam America | 7 | 7 | 0 |
| GBL HR | 6 | 6 | 0 |
| SEEL | 6 | 6 | 0 |
| Get Vocal PBC | 6 | 6 | 0 |
| Greentown Labs | 5 | 5 | 0 |
| Protect Democracy | 5 | 5 | 0 |
| Carbon Direct | 5 | 5 | 0 |
| Advanced Energy United | 4 | 4 | 0 |
| Grove Collaborative | 4 | 4 | 0 |
| Renew Home | 4 | 4 | 0 |
| The Nature Conservancy | 3 | 3 | 0 |
| HA Sustainable Infrastructure Capital | 3 | 3 | 0 |
| More Perfect Union Action | 2 | 2 | 0 |
| Good Power | 2 | 2 | 0 |
| Earthjustice | 2 | 2 | 0 |

## By ATS Provider

| Provider | Blocked | Orgs | Parser Missed |
|---|---|---|---|---|
| ats | 190 | 22 | 189 |
| custom | 44 | 14 | 42 |
| unknown | 29 | 2 | 29 |

## Compensation Patterns Found in Blocked Jobs

| Pattern (anonymized) | Count |
|---|---|
| `[$£€¥]$# / year` | 95 |
| `#` | 74 |
| `[$£€¥]$#–$# / year` | 28 |
| `[$£€¥]$#` | 10 |
| `[$£€¥]CA$# / year` | 8 |
| `[$£€¥]£#–£# / year` | 6 |
| `[$£€¥]$# / hour` | 5 |
| `[$£€¥]£# / year` | 5 |
| `[$£€¥]€# / year` | 3 |
| `[$£€¥]$# / month` | 3 |
| `[$£€¥]€#` | 2 |
| `#–#` | 2 |
| `[$£€¥]£#` | 2 |
| `rate within Quince’s rapid replenishment# M#` | 2 |
| `[$£€¥]$#–$# / hour` | 2 |

## Parser Improvement Recommendations

### HIGH: Context validation requires keyword matching

- **Occurrences:** 259 jobs (98% of all pay-blocked)
- **Suggested action:** Remove or relax context check requirement when salary_min/max are already populated
- **Rationale:** The pay parser extracts valid salary_min/max values but the validation gate rejects them because the job description text doesn't contain "salary", "pay", or "compensation" keywords. This is a **validation problem, not a parser problem**.

### HIGH: Yearly compensation formats ($#, $#-#)

- **Occurrences:** 147
- **Suggested action:** Populate salary field from salary_min/max when missing but valid
- **Rationale:** These are valid yearly salaries already parsed into salary_min/max. The issue is likely that the formatted 'salary' display string is not being populated from these values.

### HIGH: Hourly compensation formats

- **Occurrences:** 7
- **Suggested action:** Add hourly pay validation and annual conversion
- **Rationale:** Detect '$X / hour' or '$X-$Y / hour' patterns and compute annual equivalent for validation. Consider accepting hourly as valid pay.

### MEDIUM: Simple numeric compensation (just a number)

- **Occurrences:** 74
- **Suggested action:** Add context detection for naked numbers in compensation
- **Rationale:** These likely represent yearly salaries missing unit/context. Add heuristic: if number is reasonable salary range (20000-500000) and no other pay info, treat as yearly salary.

### MEDIUM: Salary ranges without explicit unit ($#-#)

- **Occurrences:** 1
- **Suggested action:** Default range units to yearly when ambiguous
- **Rationale:** Assume yearly unit for ranges without explicit time period when values are in reasonable salary range.

## ROOT CAUSE ANALYSIS (Priority Investigation)

### Problem Classification

**This is primarily a VALIDATION problem, NOT a parser problem.**

- **259/263 pay-blocked jobs (98%)** have valid `salary_min`/`salary_max` values
- **All 259 jobs** are rejected due to missing pay context keywords in the description
- **The parser successfully extracted the compensation data** - the validation gate is blocking it

### Top 5 Sources Account for 83% of Failures

| Source | Blocked | Context Check Failed | % |
|---|---|---|---|
| Quince | 119 | 119 | 45% |
| NextEra Energy | 26 | 26 | 10% |
| Octopus Energy | 16 | 16 | 6% |
| GoodLeap | 12 | 9 | 3% |
| CALSTART | 7 | 7 | 3% |

**Total from top 5 sources: 180 jobs (68%)**

### Auto-Repair Potential

- **259 jobs (98%)** eligible for automatic repair
- **Fix:** Skip pay context validation when `salary_min`/`salary_max` contain valid values
- **Expected outcome:** These jobs would pass the pay validation gate and become eligible for promotion

### Highest-Leverage Fix

**Option 1 (RECOMMENDED):** Modify pay validation to skip context check when `salary_min`/`salary_max` are already valid (20000-500000 range). The parser has successfully extracted the data; the gate is unnecessarily restrictive.

**Option 2:** Add broader context keywords ("compensation" is already added, check if working) or relax context requirements for structured ATS data.

**Option 3:** Populate the `salary` display field from `salary_min`/`salary_max` during normalization to satisfy both context and display requirements.

