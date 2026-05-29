# Pay Block Root Cause Analysis

Generated: 2026-05-29T18:28:28.279Z

## Executive Summary

- **Total pay-blocked jobs:** 263
- **Primary root cause:** Context validation requires 'salary', 'pay', or 'compensation' keywords in job description text
- **Jobs fixable without code changes:** 259 (98%)

## Classification Breakdown

| Classification | Count | Percentage |
|---|---|---|---|
| A Context Check Failed | 259 | 98% |
| B False Positive Flagged | 0 | 0% |
| C Threshold Exceeded | 0 | 0% |
| D No Compensation Data | 4 | 2% |
| E Governance Threshold | 0 | 0% |
| F Hourly Format Issues | 0 | 0% |
| G Currency Issues | 0 | 0% |

## Root Cause

### Problem

Jobs have valid salary_min/max values but are rejected because the full job text (description + raw_description + rawText) doesn't contain context keywords that indicate legitimate compensation data

### Highest-Leverage Fix

**Option 1: Remove context check requirement when salary_min/max are already populated. Option 2: Add 'compensation' keyword detection to context list. Option 3: Skip pay validation when valid structured salary exists.**

## Top Organizations by Blocked Count

| Organization | Blocked | Context Failed | No Data | Other |
|---|---|---|---|---|
| Quince | 119 | 119 | 0 | 0 |
| NextEra Energy | 26 | 26 | 0 | 0 |
| Octopus Energy | 16 | 16 | 0 | 0 |
| GoodLeap | 12 | 9 | 3 | 0 |
| CALSTART | 7 | 7 | 0 | 0 |
| Oxfam America | 7 | 7 | 0 | 0 |
| GBL HR | 6 | 6 | 0 | 0 |
| SEEL | 6 | 6 | 0 | 0 |
| Get Vocal PBC | 6 | 6 | 0 | 0 |
| Greentown Labs | 5 | 5 | 0 | 0 |
| Protect Democracy | 5 | 5 | 0 | 0 |
| Carbon Direct | 5 | 5 | 0 | 0 |
| Advanced Energy United | 4 | 4 | 0 | 0 |
| Grove Collaborative | 4 | 4 | 0 | 0 |
| Renew Home | 4 | 4 | 0 | 0 |

