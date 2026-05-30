# Full Overhaul Verification

Generated: 2026-05-30T23:08:43.178Z

Validation status: PASS

## Validations
- PASS seel_project_specialist_url: https://seelllc.bamboohr.com/careers/412
- PASS bullard_pay_parses: $80,870–$103,109 / year
- PASS bullard_description_present: The GIS/Research Director, Bullard Center for Environmental and Climate Justice is responsible for providing technical e
- PASS tnc_montana_exact_url: https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development
- PASS tnc_montana_not_public_closed: archived
- PASS tnc_no_public_workday_apply_urls
- PASS no_think_orphan_percent
- PASS think_100_preserved
- PASS mpu_campus_pay: $25/hr
- PASS renew_home_no_duplicate_remote
- PASS emerald_removed_blocked
- PASS rmi_no_public_jobs
- PASS advanced_energy_starting_pay: $120,000+ / year
- PASS greentown_pay_range: $60,000–$68,000 / year
- PASS edf_source_url: https://www.edf.org/jobs
- PASS oxfam_public_urls
- PASS climate_action_trakstar_page_url: https://climateactioncampaign.hire.trakstar.com/jobs/fk0z2nn/ https://climateactioncampaign.hire.trakstar.com/jobs/fk0z2nn/
- PASS carbon_direct_staff_engineer_pay: $184,000–$225,000 / year
- PASS hasi_expected_salary_pay: $80,000–$100,000 / year
- PASS no_public_fake_salary
- PASS no_duplicate_public_jobs
- PASS no_public_pending_overlap
- PASS no_archived_fingerprint_violations
- PASS generated_pages_match_jobs_json: missing=0 mismatched=0 stale=0
- PASS workflows_reference_existing_scripts
- PASS freshness_every_three_days
- PASS build_deploy_blocks_on_validation

## Known Issues

### SEEL BambooHR subpage links
- Found: yes (19)
- Files: job-records.json, jobs.json, pending-synced-jobs.json
- Fix applied: Canonicalized SEEL apply/source/original URLs to individual BambooHR /careers/{id} pages.
- Parser/source rule added: BambooHR adapter builds individual URLs from job.id/jobOpeningId.
- Validation added: Verification requires SEEL-412 exact subpage URL.
- Remaining unresolved: none

### Bullard Center pay and description
- Found: yes (2)
- Files: job-records.json, jobs.json
- Fix applied: Set Bullard description from TWC summary and hiring range $80,870.19-$103,109.49.
- Parser/source rule added: High-priority description headings include Job Description Summary and TWC Summary; pay parser supports Hiring Range.
- Validation added: Verification requires Bullard pay and opening description.
- Remaining unresolved: none

### Nature Conservancy public URLs
- Found: yes (9)
- Files: job-records.json, jobs.json, pending-synced-jobs.json
- Fix applied: Converted TNC Workday URLs to careers.tnc.org /us/en/job/{JR}/{slug} URLs and archived Montana Director because the live TNC page says the job is no longer posted.
- Parser/source rule added: Normalizer canonicalizes Nature Conservancy Workday URLs to public careers.tnc.org URLs.
- Validation added: Verification rejects public Nature Conservancy Workday apply URLs, checks the archived Montana exact URL, and requires Montana not be public.
- Remaining unresolved: none

### Hip Hop Caucus percent preservation
- Found: no (0)
- Files: none
- Fix applied: Replaced orphan think%/think % text with Think 100% in all canonical fields.
- Parser/source rule added: Description cleaning keeps percent signs and validation searches public/generated text.
- Validation added: Verification rejects think % and requires Think 100% remains.
- Remaining unresolved: none

### More Perfect Union hourly pay
- Found: yes (2)
- Files: job-records.json, jobs.json
- Fix applied: Set base pay to $25/hr and moved reimbursement to compensation_note/salary_note.
- Parser/source rule added: Rippling adapter now uses salary extractor instead of first dollar amount; pay formatter preserves hourly /hr.
- Validation added: Verification requires Campus Video Editor Fellow salary $25/hr.
- Remaining unresolved: none

### Renew Home redundant remote formatting
- Found: yes (23)
- Files: job-records.json, jobs.json, pending-synced-jobs.json
- Fix applied: Normalized Renew Home remote locations to Remote with a single Remote workplace label.
- Parser/source rule added: Frontend/detail formatters collapse duplicate remote tokens.
- Validation added: Verification rejects Remote / Remote and duplicate remote role text.
- Remaining unresolved: none

### GoodPower audit
- Found: yes (6)
- Files: job-records.json, jobs.json, pending-synced-jobs.json
- Fix applied: Confirmed live GoodPower Lifecycle Marketing Manager; set Remote - US and $78,000-$83,000 / year.
- Parser/source rule added: Existing pay parser supports Annual salary range from JazzHR/ApplyToJob pages.
- Validation added: Report records URL/pay/location audit result.
- Remaining unresolved: none

### Emerald Cities Collaborative removal
- Found: no (0)
- Files: sources.json
- Fix applied: Removed pending Emerald Cities entries and disabled/blocked source.
- Parser/source rule added: Blocked-source rules now include Emerald Cities Collaborative.
- Validation added: Verification requires no Emerald Cities public or pending records.
- Remaining unresolved: none

### RMI zero openings
- Found: no (0)
- Files: sources.json
- Fix applied: Removed RMI pending false positives and marked RMI sources zero_openings.
- Parser/source rule added: Source config disabled with source_status=zero_openings.
- Validation added: Verification requires no RMI public jobs.
- Remaining unresolved: none

### Advanced Energy United starting pay
- Found: yes (1)
- Files: pending-synced-jobs.json
- Fix applied: Set Director - Expanding Wholesale Markets pay to $120,000+ / year.
- Parser/source rule added: Pay parser/formatter supports Salary: Starting at $120,000.
- Validation added: Verification requires starting-at display.
- Remaining unresolved: none

### Greentown Labs no-dollar USD ranges
- Found: yes (3)
- Files: pending-synced-jobs.json
- Fix applied: Set Greentown Coordinator pay ranges to $60,000-$68,000 / year.
- Parser/source rule added: Pay parser supports ranges without dollar signs followed by USD per year.
- Validation added: Verification requires Program Coordinator range.
- Remaining unresolved: none

### EDF source
- Found: yes (1)
- Files: jobs.json, pending-synced-jobs.json, sources.json
- Fix applied: Archived stale EDF public record, set source to edf.org/jobs, and seeded current EDF jobs to pending from EDF page.
- Parser/source rule added: Source config points at https://www.edf.org/jobs.
- Validation added: Verification requires EDF source config exact URL and no stale EDF public Workday/API records.
- Remaining unresolved: none

### Oxfam SmartRecruiters public URLs
- Found: yes (7)
- Files: pending-synced-jobs.json
- Fix applied: Converted all Oxfam SmartRecruiters API URLs to public jobs.smartrecruiters.com URLs.
- Parser/source rule added: SmartRecruiters adapter now builds public jobs.smartrecruiters.com links.
- Validation added: Verification rejects api.smartrecruiters.com for Oxfam public/pending URLs.
- Remaining unresolved: none

### Climate Action Campaign Trakstar URLs
- Found: yes (1)
- Files: pending-synced-jobs.json
- Fix applied: Canonicalized Climate Action Campaign to https://climateactioncampaign.hire.trakstar.com/jobs/fk0z2nn/.
- Parser/source rule added: Trakstar adapter now emits job page URLs without ?apply=true.
- Validation added: Verification requires Trakstar job page URL.
- Remaining unresolved: none

### Carbon Direct Salary Range
- Found: yes (1)
- Files: pending-synced-jobs.json
- Fix applied: Set Carbon Direct Staff Engineer pay to $184,000-$225,000 / year.
- Parser/source rule added: Pay parser supports Salary Range headings followed by line-break ranges.
- Validation added: Verification requires Carbon Direct Staff Engineer display range.
- Remaining unresolved: none

### HASI expected salary range
- Found: yes (4)
- Files: job-records.json, jobs.json, pending-synced-jobs.json
- Fix applied: Set HASI Senior Associate base salary to $80,000-$100,000 / year and kept bonus/equity out of base salary.
- Parser/source rule added: Pay parser supports Expected salary range of ...
- Validation added: Verification requires HASI Senior Associate display range.
- Remaining unresolved: none

### Workflow scripts
- Found: yes (1)
- Files: backend/dotgithub/workflows
- Fix applied: Workflow audit script/report checks script existence, validation gating, admin actions, reports, pruning, and 3-day freshness cadence.
- Parser/source rule added: N/A.
- Validation added: Verification includes workflow path/cadence checks.
- Remaining unresolved: none

## Workflow Audit
- Files checked: jobs-auto-expand.yml, jobs-discover-sources.yml, jobs-discovery-and-search-ingest.yml, jobs-freshness-audit.yml, jobs-migrate-existing.yml, jobs-sync-pending-sources.yml, jobs-sync.yml
- Missing script references: none
- Freshness every 3 days: yes
- Build/deploy validates: yes
