# Jobs Backend: Google Apps Script

This folder prepares the `/jobs/` public forms to submit pending records into a private Google Sheet without allowing direct public publishing.

## What this backend does

- Accepts public submissions for:
  - jobs
  - talent profiles
  - admin applications
  - featured employer applications
- Stores raw JSON payloads in Google Sheets
- Keeps pending and approved records separate
- Supports private review actions for:
  - getting pending jobs
  - getting pending talent
  - approving jobs
  - rejecting jobs
  - approving talent
  - rejecting talent

Current submission/export actions include:

- `submitJob`
- `submitTalent`
- `submitAdminApplication`
- `submitFeaturedEmployer`
- `exportApprovedJobs`

Private admin review actions include:

- `getPendingJobs`
- `getPendingTalent`
- `getPendingFeaturedEmployers`
- `getPendingAdminApplications`
- `getRejected`
- `approveJob`
- `rejectJob`
- `approveTalent`
- `rejectTalent`
- `approveFeaturedEmployer`
- `rejectFeaturedEmployer`
- `approveAdminApplication`
- `rejectAdminApplication`

Public users still do not write to `jobs/jobs.json` directly.

## Required Google Sheet tabs

Create a Google Sheet and make sure these tabs exist, or let the script create them:

- `Pending Jobs`
- `Approved Jobs`
- `Pending Talent`
- `Approved Talent`
- `Admin Applications`
- `Featured Employer Applications`
- `Featured Employers`
- `Approved Admins`
- `Rejected`

## Apps Script setup

1. Open the Google Sheet.
2. Go to `Extensions -> Apps Script`.
3. Replace the default script with [apps-script/Code.gs](./apps-script/Code.gs).
4. In Apps Script, set a script property:
   - key: `ADMIN_TOKEN`
   - value: a long private secret used only by your private admin template
5. Deploy as a Web App:
   - `Deploy -> New deployment`
   - Type: `Web app`
   - Execute as: `Me`
   - Who has access:
     - For public form submissions: `Anyone`
     - For private review actions: still token-gated by `ADMIN_TOKEN`
6. Copy the Web App URL.

## Browser config

Paste the Apps Script Web App URL into:

- [jobs-backend-config.js](../scripts/jobs-backend-config.js)
  - `window.JOBS_BACKEND_CONFIG.backendUrl`

For private/local admin use only, you can also set:

- [jobs-backend-config.js](../scripts/jobs-backend-config.js)
  - `window.JOBS_BACKEND_CONFIG.adminToken`

Keep `adminToken` blank in the public repo.
Only paste a real admin token into a private/local copy of `jobs-backend-config.js` or use another protected setup.

The browser pages that read from this shared config are:

- [submit.html](../submit.html)
- [talent-apply.html](../talent-apply.html)
- [admin-apply.html](../admin-apply.html)
- [featured-employer.html](../featured-employer.html)
- [admin-review.html](../admin-review.html)

## Local export script config

For the local approved-jobs export script, use environment variables instead of `window`:

- `JOBS_APPROVED_EXPORT_URL`
- or `JOBS_BACKEND_URL`

The local script also keeps an embedded fallback URL if you want a repo-local default:

- [fetch-approved-jobs.js](../scripts/fetch-approved-jobs.js)

Example:

```bash
cd /Users/Cassandre/jobs
JOBS_BACKEND_URL="https://script.google.com/macros/s/..." npm run jobs:fetch-approved
```

## What remains manual

- Reviewing pending jobs and talent before approval
- Protecting the private admin page in whatever environment you use locally or internally
- Exporting approved records back into:
  - `jobs/jobs.json`
  - a future `talent.json` or similar public profile data file

## How approved jobs can later feed jobs/jobs.json

One practical flow:

1. Review and approve records in Google Sheets.
2. Export `Approved Jobs` as JSON with:
   - the `exportApprovedJobs` Apps Script action
   - the local fetch script
   - or a GitHub Action pulling that JSON endpoint
3. Normalize those approved records into the existing public schema in `jobs/jobs.json`.
4. Commit the updated `jobs/jobs.json` so `/jobs/index.html` continues loading the public board from `./jobs.json`.

## Important constraints

- Never scrape LinkedIn.
- The LinkedIn helper in the public form only parses the URL string.
- Approval UI should not be linked from the public job board.
- Public users should never publish directly to the public JSON files.
