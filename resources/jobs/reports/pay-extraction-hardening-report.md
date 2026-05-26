# Pay Extraction Hardening Report

**Generated:** 2026-05-26T00:58:39.249Z

## Summary

| Metric | Value |
|---|---|
| Records enriched | 2 |
| Salaries newly found | 2 |
| Parser handles "Salary $X - $Y" (no colon) | true |
| Approved orgs with pay | 25 |

## Changes

### Greenlight America salary enrichment

**Before:** Two Greenlight America pending records had truncated descriptions (142, 174 chars) and no salary data despite live pages showing Salary $75,000 - $100,000.

**After:** Descriptions enriched to full page text (5615, 6286 chars). Salary parsed: $75k-$100k yearly USD, salary_visible=true.

**Fix:** Extended enrichment to custom career pages. Generic format "Salary $75,000 - $100,000" without colon already handled by existing regex (salary:? pattern at job-normalizer.js:1716). Parser confidence: high.

**Test:** Greenlight "Salary $75,000 - $100,000" → salary_min=75000, salary_max=100000, currency=USD, period=yearly, visible=true

