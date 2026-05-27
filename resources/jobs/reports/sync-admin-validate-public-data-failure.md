# Sync Admin Validate Public Data - Failure Resolution Report

## Summary

validate-public-data previously exited 1 due to:
- missing currency symbol count 1
- octopus validation violation count 3
- hard validation failure count 4

## Root Cause

The pay-gated autopublish published 7 Octopus Energy jobs that:
1. Exceeded the Octopus public cap of 5 (11 total)
2. Were missing from the latest Octopus source snapshot (disappeared from ATS)
3. Violated Octopus priority policy (finance, engineering, business dev roles excluded)
4. Had corrupted pay data extracted by the parser (salary 2-3)

## Action Taken

Unpublished the following 7 Octopus Energy jobs from both job-records.json and jobs.json:

- Octopus Energy-a646b920-0069-4b9f-8353-35033d8a9835 (Business Development Manager)
- Octopus Energy-9fbc5d48-83f8-4319-b957-e988e050f848 (Strategic Finance Analyst)
- Octopus Energy-cef678aa-0552-4636-bddb-c748bad10fa1 (Portfolio Manager)
- Octopus Energy-ddbb9842-625c-4900-a3f8-3f468e444190 (Engineering Lead, salary corrupted to 2-3)
- Octopus Energy-55f4bc10-4270-414d-9fc2-759bf34f6482 (Manager commercial B2C)
- Octopus Energy-d7a37ffe-2f20-49d9-9adf-260590461421 (Team-Lead commercial B2C)
- Octopus Energy-a3c961cd-039e-449a-a851-edc66f5128f4 (Junior Operations Manager)

## Resolution

Current state:
- public_records_count: 64
- jobs_json_count: 64
- generated_page_count: 64
- hard_validation_failure_count: 0
- errors: []
- exit_code_reason: 

All validation checks pass with exit code 0.

## Remaining Warnings

- pipeline health warning count 5
