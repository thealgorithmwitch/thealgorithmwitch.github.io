# Reconcile Audit

- mode: write
- jobs_json_count: 101
- published_job_records_before: 83
- proposed_published_job_records_after: 101
- missing_jobs_to_backfill_count: 18
- pending_public_overlap_before: 0
- pending_public_overlap_after_proposed: 0
- pending_after_dedupe_count: 251
- write_allowed: true

## Write Blockers


## Missing Jobs To Backfill

- Chapter Director | Sierra Club | Sierra Club-2d14a974-35b0-4fe1-82d5-96018da5d4cd | ./pages/chapter-director-sierra-club.html | pending_match=false
- Sr. Manager, Paid Social (DPA) | Quince | Quince-5185243008 | ./pages/sr-manager-paid-social-dpa-quince.html | pending_match=true
- Interior Designer - Mission Critical / Data Center Specialized | Woolpert | Woolpert-4095664009 | ./pages/interior-designer-mission-critical-data-center-specialized-woolpert.html | pending_match=true
- Engineer in Training, Site Civil Energy Practice | Woolpert | Woolpert-4087686009 | ./pages/engineer-in-training-site-civil-energy-practice-woolpert.html | pending_match=true
- Senior Frontend Engineer (m/w/d) | Octopus Energy | Octopus Energy-a7f97ce1-f3ab-42c9-bddc-44fe69df6470 | ./pages/senior-frontend-engineer-m-w-d-octopus-energy.html | pending_match=false
- Staff Engineer | Carbon Direct | Carbon Direct-5122832007 | ./pages/staff-engineer-carbon-direct.html | pending_match=true
- Chapter Coordinator | Sierra Club | Sierra Club-9ff5dfdf-d26f-49ea-98ac-7fc2ac9511bd | ./pages/chapter-coordinator-sierra-club.html | pending_match=false
- Policy Data Analyst | Recidiviz | Recidiviz-4667882006 | ./pages/policy-data-analyst-recidiviz.html | pending_match=true
- Engineering Manager (Elections & AI for Democracy Action Lab) | Protect Democracy | Protect Democracy-2507327 | ./pages/engineering-manager-elections-ai-for-democracy-action-lab-protect-democracy.html | pending_match=true
- State Impact Specialist (Wisconsin) | Protect Democracy | Protect Democracy-2489478 | ./pages/state-impact-specialist-wisconsin-protect-democracy.html | pending_match=true
- Freelance Designer (Contract) | Protect Democracy | Protect Democracy-2177552 | ./pages/freelance-designer-contract-protect-democracy.html | pending_match=true
- Onboarding Executive | Octopus Energy | Octopus Energy-dbb6a101-d838-46e0-a21f-62377bfb537e | ./pages/onboarding-executive-octopus-energy.html | pending_match=false
- Solar Field Technician – Rosamond, CA Remote | Arevon Energy | arevon-11436f7a51ee | ./pages/solar-field-technician-rosamond-ca-remote-arevon-energy.html | pending_match=true
- Counsel | Arevon Energy | arevon-f6088b0691ea | ./pages/counsel-arevon-energy.html | pending_match=true
- Analyst, Total Rewards | Environmental Defense Fund | edf-68fa50f7fc84 | ./pages/analyst-total-rewards-environmental-defense-fund.html | pending_match=true
- Manager, Design Quality | Sunrun | sunrun-a1de679536bf | ./pages/manager-design-quality-sunrun.html | pending_match=false
- Vice President, Accounting | Environmental Defense Fund | edf-eeaca261fe2b | ./pages/vice-president-accounting-environmental-defense-fund.html | pending_match=true
- Digital Advertising Associate | Good Power | good-power-e9b42eb0d7ce | ./pages/digital-advertising-associate-good-power.html | pending_match=true

## Pending/Public Overlap

- Solar Field Technician – Rosamond, CA Remote | Arevon Energy | match=id+title_org+url | action=remove_from_pending | public=./pages/solar-field-technician-rosamond-ca-remote-arevon-energy.html
- Counsel Remote | Arevon Energy | match=id+url | action=remove_from_pending | public=./pages/counsel-arevon-energy.html
- Staff Engineer | Carbon Direct | match=id+title_org+url | action=remove_from_pending | public=./pages/staff-engineer-carbon-direct.html
- Analyst, Total Rewards | Environmental Defense Fund | match=id+title_org+url | action=remove_from_pending | public=./pages/analyst-total-rewards-environmental-defense-fund.html
- Policy Data Analyst | Recidiviz | match=id+title_org+url | action=remove_from_pending | public=./pages/policy-data-analyst-recidiviz.html
- Engineering Manager (Elections & AI for Democracy Action Lab) | Protect Democracy | match=id+title_org+url | action=remove_from_pending | public=./pages/engineering-manager-elections-ai-for-democracy-action-lab-protect-democracy.html
- Analyst | Environmental Defense Fund | match=id+url | action=remove_from_pending | public=./pages/vice-president-accounting-environmental-defense-fund.html
- Interior Designer - Mission Critical / Data Center Specialized | Woolpert | match=id+title_org+url | action=remove_from_pending | public=./pages/interior-designer-mission-critical-data-center-specialized-woolpert.html
- Principal Consultant | Jobvite | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- " Senior Analyst, Risk & Insurance Scottsdale, AZ O&M BESS Field Technician Remote Solar Field Technician – Ro | Arevon Energy | match=url | action=mark_already_published | public=./pages/solar-field-technician-rosamond-ca-remote-arevon-energy.html
- Freelance Designer (Contract) | Protect Democracy | match=id+title_org+url | action=remove_from_pending | public=./pages/freelance-designer-contract-protect-democracy.html
- Financial Analyst II | NextEra Energy | match=url | action=mark_already_published | public=./pages/senior-automation-engineer-nextera-energy.html
- Claims Analyst | NextEra Energy | match=url | action=mark_already_published | public=./pages/senior-automation-engineer-nextera-energy.html
- Tax Analyst | NextEra Energy | match=url | action=mark_already_published | public=./pages/senior-automation-engineer-nextera-energy.html
- Engineer in Training, Site Civil Energy Practice | Woolpert | match=id+title_org+url | action=remove_from_pending | public=./pages/engineer-in-training-site-civil-energy-practice-woolpert.html
- State Impact Specialist (Wisconsin) | Protect Democracy | match=id+title_org+url | action=remove_from_pending | public=./pages/state-impact-specialist-wisconsin-protect-democracy.html
- Freelance Video Producer Sports Coverage | More Perfect Union Action | match=url | action=mark_already_published | public=./pages/video-production-fellow-more-perfect-union-action.html
- Director of Development | More Perfect Union Action | match=url | action=mark_already_published | public=./pages/video-production-fellow-more-perfect-union-action.html
- Vertical Video Producer | More Perfect Union Action | match=url | action=mark_already_published | public=./pages/video-production-fellow-more-perfect-union-action.html
- Digital Advertising Associate | Good Power | match=id+title_org+url | action=remove_from_pending | public=./pages/digital-advertising-associate-good-power.html
- Director of Client Services | Good Power | match=url | action=mark_already_published | public=./pages/digital-advertising-associate-good-power.html
- Lifecycle Marketing Manager | Good Power | match=url | action=mark_already_published | public=./pages/digital-advertising-associate-good-power.html
- Managing Director | Good Power | match=url | action=mark_already_published | public=./pages/digital-advertising-associate-good-power.html
- Senior Data Scientist | EDP | match=url | action=mark_already_published | public=./pages/operations-and-maintenance-senior-operator-edp.html
- Digital Delivery Senior Specialist | EDP | match=url | action=mark_already_published | public=./pages/operations-and-maintenance-senior-operator-edp.html
- Senior Algorithms Developer | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- Field Operations Manager | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- People Operations Regional Manager | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- Sr. Manager, Paid Social (DPA) | Quince | match=id+title_org+url | action=remove_from_pending | public=./pages/sr-manager-paid-social-dpa-quince.html
- Driver Operations Specialist (Part-Time) | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- Account Director | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- Partner Success Manager | Remix | match=url | action=mark_already_published | public=./pages/manager-market-asset-operations-fervo-energy.html
- Manager, Financial Planning and Analysis | NextEra Energy | match=url | action=mark_already_published | public=./pages/senior-automation-engineer-nextera-energy.html
- Sr. Tax Planning Manager | NextEra Energy | match=url | action=mark_already_published | public=./pages/senior-automation-engineer-nextera-energy.html
- Associate Director of Development | The Nature Conservancy | match=url | action=mark_already_published | public=./pages/preserve-manager-palmyra-atoll-the-nature-conservancy.html

## Description Resolution Review

- Odoo Administrator | Octopus Energy | ./pages/odoo-administrator-octopus-energy.html | reasons=taxonomy blobs | action=use_job_records_cleaner
- Portfolio Manager - Energy Transition | Octopus Energy | ./pages/portfolio-manager-energy-transition-octopus-energy.html | reasons= | action=use_job_records_cleaner
- Policy Data Analyst | Recidiviz | ./pages/policy-data-analyst-recidiviz.html | reasons= | action=keep_jobs_json
- Digital Advertising Associate | Good Power | ./pages/digital-advertising-associate-good-power.html | reasons=taxonomy blobs | action=use_placeholder
- Manager, Membership Mobilization | Good Power | ./pages/manager-membership-mobilization-good-power.html | reasons=taxonomy blobs | action=use_placeholder
- Chief Revenue Officer | Dylan Green | ./pages/chief-revenue-officer-dylan-green.html | reasons= | action=use_placeholder
- Operations and Maintenance Senior Operator | EDP | ./pages/operations-and-maintenance-senior-operator-edp.html | reasons=taxonomy blobs | action=use_job_records_cleaner
- Project Development Analyst | EDP | ./pages/project-development-analyst-edp.html | reasons=taxonomy blobs | action=use_job_records_cleaner
- Interconnection Analyst | EDP | ./pages/interconnection-analyst-edp.html | reasons=taxonomy blobs, repeated date/header fragments | action=use_placeholder
- Software Engineer Lead | Shifted Energy | ./pages/software-engineer-lead-shifted-energy.html | reasons=POINT(...), locality, raw ATS metadata, taxonomy blobs, giant numeric metadata strings | action=use_job_records_cleaner
- Scada Operations Supervisor | Arevon Energy | ./pages/scada-operations-supervisor-arevon-energy.html | reasons=taxonomy blobs | action=keep_jobs_json
- Associate, Real Estate | Arevon Energy | ./pages/associate-real-estate-arevon-energy.html | reasons=taxonomy blobs | action=use_job_records_cleaner
- Portfolio ESG Analyst | Octopus Energy | ./pages/portfolio-esg-analyst-octopus-energy.html | reasons=taxonomy blobs | action=use_placeholder

## Company Mismatches

- Director | jobs.json=Internal Audit | job-records=Fervo Energy | id=elemental-impact-c6c7ccd02120 | ./pages/director-internal-audit.html | action=use_job_records_company
- Senior Software Engineer | jobs.json=Resource Innovations | job-records=Shifted Energy | id=elemental-impact-446c301b54b2 | ./pages/senior-software-engineer-resource-innovations.html | action=use_jobs_json_company
- General Manager | jobs.json=VIA | job-records=Remix | id=elemental-impact-26644a0dbc01 | ./pages/general-manager-via.html | action=use_jobs_json_company

