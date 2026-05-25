# Workflow Automation Audit

- **Audit date:** 2026-05-24
- **Project root:** `jobs/`
- **Audit scope:** `.github/workflows/` for CI/CD automation affecting `jobs/`

## Finding: No GitHub Actions Workflows

The directory `.github/workflows/` **does not exist** anywhere in the repository. No GitHub Actions CI/CD workflows are configured for the job board pipeline.

This means all sync operations (`sync-custom`, `sync-sources`, validation, deployment) must be triggered **manually** or via **cron outside of GitHub Actions** (e.g., local cron, hosted scheduler, or direct CLI invocation).

## Impact

| Concern | Severity | Detail |
|---|---|---|
| No CI/CD automation | Medium | All sync/validation must be manually triggered |
| No PR checks | Low | No automated lint/typecheck/validation on PRs |
| No deployment pipeline | Low | No automated deploy of job pages |
| No scheduled syncs | Medium | No guarantee of periodic source refreshes |

## Recommendations

1. Add `.github/workflows/sync-custom.yml` — scheduled `sync-custom` runs
2. Add `.github/workflows/validate.yml` — runs on PRs to `jobs/`
3. Add `.github/workflows/deploy-jobs.yml` — deploys job pages after sync
