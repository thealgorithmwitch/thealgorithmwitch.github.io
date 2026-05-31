# Homepage/Index Propagation + Generated Page Formatting Repair

Generated: 2026-05-31T00:47:00Z

## Homepage Data Path

`index.html` renders job cards dynamically via client-side JavaScript (line 1434+). Cards are populated from `jobs.json` at runtime. No static/embedded card data, no cached snippet files. Page URLs come directly from the `page_url` field in `jobs.json`.

**Fix path**: Updating `jobs.json` → refresh-public → build-pages propagates to both homepage cards and generated detail pages.

## Hip Hop Caucus (think 100%)

**No action needed** — `jobs.json` already has `title: "Think 100% Campaigns Manager"`. No orphan `think %` found in any active public file (`jobs.json`, `pages/`, `index.html`). Generated page is correct.

## EDP Senior Data Scientist

**Snippet fixed** in `jobs.json`:
- **Before**: `"Ist/ / Senior Data Scientist Lisbon, PT ist/ / Senior Data Scientist Lisbon, PT..."` (garbled ATS metadata)
- **After**: `"The Senior Data Scientist will lead advanced analytics initiatives to support EDP's renewable energy operations and strategic decision-making..."` (first sentence of canonical description, 302 chars)

**Generated page**: Now renders with proper `<p>` tags for paragraphs and `<ul><li>` for bullet points. No fake pay badge. 2 meta badges (contract type + source).

## Generated Page Formatting

`scripts/generate-job-pages.js` updated:

- Added `formatDescription()` that converts `\n\n` paragraph breaks to `<p>` tags and bullet lines (`•`) to `<ul><li>` elements
- Salary badge only shown when `salary_visible=true` AND `salary_min > 0`
- JSON-LD `baseSalary` only included when `salary_visible=true`

## Validation Results

| Check | Result |
|---|---|
| No think % in public data | PASS (0 occurrences) |
| EDP snippet correct | PASS (302 chars, canonical first sentence) |
| EDP page has <p>/<ul> | PASS |
| Powerlines pages no fake pay | PASS |
| All pages have <p> tags | PASS |

## Files Changed

- `scripts/generate-job-pages.js` — added `formatDescription()`, salary visibility guard
