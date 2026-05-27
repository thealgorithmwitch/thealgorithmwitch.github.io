# Targeted Manual Public Cleanup Report

Generated: 2026-05-27T12:53:49.639Z

## Summary

Applied targeted fixes to 11 records across 7 organizations.

| Organization | Title | Fields Changed | Before | After |
| --- | --- | --- | --- | --- |
| Earthjustice | Research & Policy Analyst, Northeast Regional Office | workplace_type, location | {"workplace_type":"Remote","location":"Remote"} | {"workplace_type":"Hybrid","location":"New York, NY"} |
| Earthjustice | Senior Research & Policy Analyst, Right to Zero | workplace_type, location | {"workplace_type":"Remote","location":"Remote"} | {"workplace_type":"Hybrid","location":"Washington, DC"} |
| Earthjustice | Senior Attorney, Gulf Regional Office | workplace_type, location | {"workplace_type":"Remote","location":"Remote"} | {"workplace_type":"Hybrid","location":"Houston, TX"} |
| Dylan Green | Analyst/Associate, Business Development | workplace_type | {"workplace_type":"Remote"} | {"workplace_type":"Hybrid"} |
| Dylan Green | Senior Associate, Portfolio Management | workplace_type | {"workplace_type":"Remote"} | {"workplace_type":"Hybrid"} |
| Dylan Green | Associate, Acquisitions | workplace_type | {"workplace_type":"Remote"} | {"workplace_type":"Hybrid"} |
| Dylan Green | Loan Operations Portfolio Analyst | workplace_type | {"workplace_type":"Remote"} | {"workplace_type":"Hybrid"} |
| Dylan Green | Managing Director, Project Finance | workplace_type | {"workplace_type":"Remote"} | {"workplace_type":"Hybrid"} |
| CleanCapital | Director Treasury And Financial Analysis | workplace_type, location, description | {"workplace_type":"Remote","location":"Remote"} | {"workplace_type":"Hybrid","location":"New York, NY"} |
| WeaveGrid | Director, Regulatory Affairs & Market Development | created | N/A | new_pending_record |
| Louisiana Bucket Brigade | Donor Engagement Manager | created | N/A | new_pending_record |

## Parser Hardening

Added generic careers-content patterns to removeBoilerplateSentences, added stripGenericCareersContent and detectPreferredRoleSections functions, integrated into normalizeDescription and extractDescriptionText

Files changed: scripts/job-normalizer.js, scripts/test-normalizer.js

## Validation

Public jobs: 61
Pending jobs: 434
Errors: 0
Warnings: 4
