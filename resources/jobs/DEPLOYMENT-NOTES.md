# Deployment Notes

## Admin Queue

Live admin persistence still depends on the Apps Script backend. After changing `jobs/backend/apps-script/Code.gs`, redeploy the Apps Script web app before using the live admin queue.

## Local Testing

For local workflow testing without an Apps Script admin token:

1. Queue actions from `jobs/admin-review.html` in local-only mode.
2. Export the local queue as `admin-actions-local.json`.
3. Place that file at `jobs/admin-actions-local.json`.
4. Run `npm run jobs:apply-admin-actions`.
5. Run `npm run jobs:build-pages` if you need to regenerate pages again after other local edits.

`npm run jobs:snapshot-admin-actions` prefers the Apps Script queue when backend config and token are available. Otherwise it reads `jobs/admin-actions-local.json`.
