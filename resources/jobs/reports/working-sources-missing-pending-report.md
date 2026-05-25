# Working Sources Missing From Pending — Report

Generated: 2026-05-25T01:27:39.108Z

## Summary

| metric | value |
| --- | --- |
| Total Sources Checked | 168 |
| In sources.json | 167 |
| In source-prospects.json | 90 |
| With Pending Jobs | 30 |
| With Jobs But No Pending | 0 |
| With Fetch Failures (5+) | 44 |
| Requiring Attention | 68 |

## Fix Applied

source-utils.js normalizeSource() no longer disables sync for manual_review_required sources — they will now sync normally

## Common Blockers

| blocker | count | status |
| --- | --- | --- |
| sync_enabled = false (manual_review_required) | 40 | FIXED: source-utils.js normalizeSource() no longer disables sync for manual_review_required |
| Persistent fetch failures (5+) | 44 | Requires board URL/token verification per source |
| Parser disabled (parser_enabled=false) | 94 | Requires enabling parser or manual-review fallback |
| Jobs found but 0 added to pending | 0 | Check relevance thresholds, dedup logic, and backlog routing |
| No source_url or careers_url | 1 | Add career page URLs |

## Sources Requiring Attention

| source | org | url | fetch_status | jobs_detected | jobs_in_pending | jobs_in_backlog | failures | issues | fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 350-org | 350.org | https://350.bamboohr.com/careers | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| alltrails | AllTrails | https://jobs.lever.co/alltrails | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| asian-pacific-environmental-network | Asian Pacific Environmental Network | https://apen4ej.org/about/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| boldr | Boldr | https://apply.workable.com/boldr-1 | sync_error | 0 | 0 | 0 | 6 | sync_enabled is false; 6 consecutive fetch failures; health | source-utils.js no longer disables sync |
| brightline-defense | Brightline Defense | https://www.brightlinedefense.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| california-environmental-justice-alliance | California Environmental Justice Alliance | https://caleja.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| calstart | CALSTART | https://jobs.lever.co/calstart | sync_error | 0 | 8 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| carbon-direct | Carbon Direct | https://job-boards.greenhouse.io/carbondirect | sync_error | 0 | 1 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| ceezer | CEEZER | https://jobs.ashbyhq.com/ceezer | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| chargerhelp | ChargerHelp! | https://chargerhelp.recruitee.com/ | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| clean-energy-trust | Clean Energy Trust | https://cet.bamboohr.com/careers | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| climate-cabinet | Climate Cabinet | https://job-boards.greenhouse.io/climatecabinet | sync_error | 0 | 0 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| climate-justice-alliance | Climate Justice Alliance | https://climatejusticealliance.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| climateworks-foundation | ClimateWorks Foundation | https://www.climateworks.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| conservation-law-foundation | Conservation Law Foundation | https://www.clf.org/about-us/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| creator-accountability-network | Creator Accountability Network | https://creatoraccountabilitynetwork.bamboohr.com/ | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| deep-south-center-for-environmental-justice | Deep South Center for Environmental Justice | https://dscej.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| earthforce | Earth Force | https://jobs.ashbyhq.com/earthforce | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| earthworks | Earthworks | https://earthworks.org/about/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| education-first-consulting | Education First Consulting | https://apply.workable.com/education-first-consult | sync_error | 0 | 1 | 0 | 6 | sync_enabled is false; 6 consecutive fetch failures; health | source-utils.js no longer disables sync |
| elevate-energy | Elevate Energy | https://www.elevatenp.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| elevenlabs | ElevenLabs | https://jobs.ashbyhq.com/elevenlabs | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| endurance-energy | Endurance Energy | https://jobs.ashbyhq.com/endurance-energy | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| fresh-energy | Fresh Energy | https://fresh-energy.org/about/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| gblhr | GBL HR | https://gblhr.bamboohr.com/careers | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| get-vocal-pbc | Get Vocal PBC | https://jobs.lever.co/get-vocal-pbc | sync_error | 0 | 5 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| gravity-climate | Gravity Climate | https://jobs.ashbyhq.com/GravityClimate | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| greenpeace-us | Greenpeace | https://job-boards.greenhouse.io/greenpeace | sync_error | 0 | 2 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| groundswell | Groundswell | https://groundswell.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| grove-collaborative | Grove Collaborative | https://job-boards.greenhouse.io/grovecollaborativ | sync_error | 0 | 4 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| hip-hop-caucus | Hip Hop Caucus | https://hiphopcaucus.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| indigenous-environmental-network | Indigenous Environmental Network | https://www.ienearth.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| jobs-to-move-america | Jobs to Move America | https://jobstomoveamerica.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| lightfield | Lightfield | https://jobs.ashbyhq.com/lightfield | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| little-village-environmental-justice-organization | Little Village Environmental Justice Organization | https://www.lvejo.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| louisiana-bucket-brigade | Louisiana Bucket Brigade | https://labucketbrigade.org/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| miri | MIRI | https://jobs.ashbyhq.com/miri | sync_error | 0 | 0 | 0 | 5 | sync_enabled is false; 5 consecutive fetch failures; health | source-utils.js no longer disables sync |
| movement-generation | Movement Generation | https://movementgeneration.org/about/jobs | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| oceana | Oceana | https://oceana.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| oxfam-america | Oxfam America | https://careers.smartrecruiters.com/OxfamAmerica2 | sync_error | 0 | 0 | 0 | 7 | sync_enabled is false; 7 consecutive fetch failures; health | source-utils.js no longer disables sync |
| paired-recruiting | Paired Recruiting | https://apply.workable.com/pairedrecruiting | sync_error | 0 | 0 | 0 | 6 | sync_enabled is false; 6 consecutive fetch failures; health | source-utils.js no longer disables sync |
| partnership-for-southern-equity | Partnership for Southern Equity | https://psequity.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| patch | Patch | https://jobs.ashbyhq.com/patch.io | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| peoples-action | People's Action | https://peoplesaction.bamboohr.com/careers | sync_error | 0 | 0 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| plos | PLOS | https://job-boards.eu.greenhouse.io/plos | sync_error | 0 | 0 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| powerlines | Powerlines | https://apply.workable.com/powerlines | sync_error | 0 | 3 | 0 | 6 | 6 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| prime-coalition | Prime Coalition | https://primecoalition.org/careers | unknown | ? | 0 | 0 | 0 | sync_enabled is false; custom_sync_enabled is false; parser_ | source-utils.js no longer disables sync |
| protect-democracy | Protect Democracy | https://protectdemocracy.recruitee.com/ | sync_error | 0 | 2 | 0 | 5 | 5 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| quince | Quince | https://job-boards.greenhouse.io/quince | sync_error | 0 | 38 | 0 | 7 | 7 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
| renew-home | Renew Home | https://apply.workable.com/renewhome/ | sync_error | 0 | 9 | 0 | 6 | 6 consecutive fetch failures; health status: sync_error | verify board token/slug/URL correctness |
