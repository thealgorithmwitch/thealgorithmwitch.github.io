const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { readJobs } = require("./job-utils");
const { canonicalizeJobShape } = require("./canonical-job-shape");
const { readJobRecords } = require("./public-records");
const { buildJobPagePathMap, cleanVisibleText } = require("./job-page-paths");
const { normalizeEmploymentType, normalizeWorkplaceType } = require("./job-normalizer");
const { countPublishedJobRecords } = require("./public-jobs");
const { buildValidationReport } = require("./validate-public-data");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");
const JOB_PAGE_HASH_PREFIX = "<!-- job-page-hash:";
const JOB_PAGE_REDIRECT_PREFIX = "<!-- job-page-redirect:";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value, max = 160) {
  const text = cleanVisibleText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function salaryJsonLd(job) {
  if (!job.salary_min && !job.salary_max) return "";
  const currency = job.salary_currency && job.salary_currency !== "Unknown" ? job.salary_currency : "USD";
  const unitMap = {
    hour: "HOUR",
    day: "DAY",
    month: "MONTH",
    year: "YEAR"
  };
  const unitText = unitMap[job.salary_period] || "YEAR";
  return JSON.stringify({
    "@type": "MonetaryAmount",
    currency,
    value: {
      "@type": "QuantitativeValue",
      minValue: job.salary_min || undefined,
      maxValue: job.salary_max || undefined,
      unitText
    }
  });
}

function buildJsonLd(job) {
  const normalizedJobType = normalizeEmploymentType(job.job_type || "");
  const payload = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: cleanVisibleText(job.title),
    description: cleanVisibleText(job.description || ""),
    directApply: true,
    hiringOrganization: job.organization
      ? {
          "@type": "Organization",
          name: job.organization
        }
      : undefined,
    jobLocation: job.location
      ? {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressLocality: job.location
          }
        }
      : undefined,
    employmentType: normalizedJobType || undefined,
    baseSalary: job.salary_min || job.salary_max ? JSON.parse(salaryJsonLd(job)) : undefined,
    validThrough: job.expires_at || undefined,
    datePosted: job.date_posted || undefined
  };

  return JSON.stringify(
    Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")),
    null,
    2
  );
}

function buildPageInputHash(job, slug) {
  const payload = {
    id: String(job.id || ""),
    slug,
    title: cleanVisibleText(job.title),
    organization: cleanVisibleText(job.organization),
    location: cleanVisibleText(job.location),
    workplace_type: cleanVisibleText(job.workplace_type),
    job_type: cleanVisibleText(job.job_type),
    salary: cleanVisibleText(job.salary),
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_currency: cleanVisibleText(job.salary_currency),
    salary_period: cleanVisibleText(job.salary_period),
    source: cleanVisibleText(job.source),
    source_url: cleanVisibleText(job.source_url),
    apply_url: cleanVisibleText(job.apply_url),
    original_url: cleanVisibleText(job.original_url),
    date_posted: cleanVisibleText(job.date_posted),
    expires_at: cleanVisibleText(job.expires_at),
    tags: Array.isArray(job.tags) ? job.tags.map((tag) => cleanVisibleText(tag)) : [],
    description: cleanVisibleText(job.description || ""),
    redirect_paths: Array.isArray(job.redirect_paths) ? job.redirect_paths.slice().sort() : []
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 12);
}

function buildPage(job, slug, hash) {
  const canonical = canonicalizeJobShape(job, { alreadyNormalized: true }) || canonicalizeJobShape(job) || job;
  const normalizedJobType = normalizeEmploymentType(canonical.job_type || "");
  const normalizedWorkplaceType = normalizeWorkplaceType(canonical.workplace_type || "");
  const title = `${cleanVisibleText(canonical.title)} at ${cleanVisibleText(canonical.organization)}`;
  const fullDescription = cleanVisibleText(canonical.description || "");
  const descriptionSnippet = truncate(canonical.description_snippet || canonical.summary || fullDescription || `${cleanVisibleText(canonical.title)} at ${cleanVisibleText(canonical.organization)} in climate, clean energy, sustainability, policy, and creative work.`);
  const originalUrl = canonical.original_url || canonical.apply_url || canonical.source_url || "#";
  const tags = Array.isArray(canonical.tags) ? canonical.tags.map((tag) => cleanVisibleText(tag)).filter(Boolean) : [];
  const summary = fullDescription;
  const detailUrl = `https://example.com/jobs/pages/${slug}.html`;

  return `${JOB_PAGE_HASH_PREFIX} ${hash} -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Fresh Roles</title>
  <meta name="description" content="${escapeHtml(descriptionSnippet)}">
  <meta property="og:title" content="${escapeHtml(title)} | Fresh Roles">
  <meta property="og:description" content="${escapeHtml(descriptionSnippet)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(detailUrl)}">
  <script type="application/ld+json">
${buildJsonLd(job)}
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Instrument+Serif:ital@0;1&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');
    :root { --bg-paper:#0A1F15; --ink-primary:#CFFBE3; --ink-secondary:rgba(207,251,227,.7); --accent-chartreuse:#A8FF3E; --accent-lavender:#D4C1FF; --surface-card:#0D261A; --border-divider:#163628; --font-serif:'Instrument Serif',serif; --font-sans:'DM Sans',sans-serif; --font-mono:'Space Mono',monospace; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg-paper); color:var(--ink-primary); font-family:var(--font-sans); }
    .app-container { max-width:1100px; margin:0 auto; padding:0 40px; }
    nav { display:flex; justify-content:space-between; align-items:center; gap:24px; min-height:80px; border-bottom:1px solid var(--border-divider); }
    .logo { display:flex; align-items:baseline; gap:12px; text-decoration:none; color:var(--ink-primary); }
    .logo h1 { font-family:var(--font-serif); font-size:2rem; font-weight:400; }
    .logo span, .eyebrow, .meta, .tag { font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.05em; }
    .logo span, .eyebrow { color:var(--accent-chartreuse); font-size:.72rem; }
    .btn-primary, .btn-secondary { border:1px solid var(--accent-chartreuse); padding:12px 18px; font-family:var(--font-mono); font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; }
    .btn-primary { background:var(--accent-chartreuse); color:var(--bg-paper); }
    .btn-secondary { color:var(--accent-chartreuse); border-color:var(--border-divider); }
    main { padding:64px 0 80px; display:grid; gap:28px; }
    .hero { display:grid; gap:18px; }
    .hero h2 { font-family:var(--font-serif); font-size:clamp(2.6rem,5vw,4rem); line-height:.95; }
    .meta-list { display:flex; flex-wrap:wrap; gap:10px; }
    .meta { padding:8px 12px; border:1px solid var(--border-divider); color:var(--ink-secondary); font-size:.72rem; }
    .card { background:var(--surface-card); border:1px solid var(--border-divider); padding:28px; display:grid; gap:18px; }
    .summary { color:var(--ink-secondary); line-height:1.65; white-space:pre-wrap; }
    .tag-row { display:flex; flex-wrap:wrap; gap:10px; }
    .tag { border:1px solid var(--border-divider); padding:6px 10px; color:var(--ink-secondary); font-size:.7rem; }
    footer { padding:60px 0; text-align:center; font-family:var(--font-mono); font-size:.75rem; color:rgba(207,251,227,.45); text-transform:uppercase; letter-spacing:.08em; }
    @media (max-width:800px) { .app-container { padding:0 20px; } nav { flex-direction:column; align-items:flex-start; padding:18px 0; } }
  </style>
</head>
<body>
  <div class="app-container">
    <nav>
      <a href="../index.html#home" class="logo">
        <h1>Fresh Roles</h1>
        <span>The Algorithm Witch</span>
      </a>
      <a href="../index.html#classifieds" class="btn-secondary">Back to Board</a>
    </nav>
    <main>
      <section class="hero">
        <div class="eyebrow">Job Detail</div>
        <h2>${escapeHtml(canonical.title)}</h2>
        <div style="font-size:1.05rem; color:var(--ink-secondary);">${escapeHtml(canonical.organization)}</div>
        <div class="meta-list">
          ${canonical.location ? `<div class="meta">${escapeHtml(canonical.location)}</div>` : ""}
          ${normalizedWorkplaceType ? `<div class="meta">${escapeHtml(normalizedWorkplaceType)}</div>` : ""}
          ${normalizedJobType ? `<div class="meta">${escapeHtml(normalizedJobType)}</div>` : ""}
          ${canonical.salary ? `<div class="meta">${escapeHtml(canonical.salary)}</div>` : ""}
          ${canonical.source ? `<div class="meta">${escapeHtml(canonical.source)}</div>` : ""}
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <a class="btn-primary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" data-track-action="apply" data-job-id="${escapeHtml(canonical.id)}" data-title="${escapeHtml(canonical.title)}" data-organization="${escapeHtml(canonical.organization)}" data-source="${escapeHtml(canonical.source)}">Apply</a>
          <a class="btn-secondary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" data-track-action="view-original" data-job-id="${escapeHtml(canonical.id)}" data-title="${escapeHtml(canonical.title)}" data-organization="${escapeHtml(canonical.organization)}" data-source="${escapeHtml(canonical.source)}">View Original</a>
        </div>
      </section>
      <section class="card">
        <div class="eyebrow">Summary</div>
        <div class="summary">${escapeHtml(summary || "Open the original listing for the full posting details.")}</div>
      </section>
      ${tags.length ? `<section class="card"><div class="eyebrow">Tags</div><div class="tag-row">${tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div></section>` : ""}
    </main>
    <footer>
      <div>THE ALGORITHM WITCH // FRESH ROLES</div>
      <div style="margin-top:12px; opacity:.6;">SUSTAINABILITY JOBS ACROSS CLIMATE, CLEAN ENERGY, POLICY, AND CREATIVE ROLES.</div>
    </footer>
  </div>
  <script src="../scripts/jobs-backend-config.js"></script>
  <script src="../tracking.js"></script>
  <script>
    document.querySelectorAll("[data-track-action]").forEach((element) => {
      element.addEventListener("click", () => {
        window.trackEvent && window.trackEvent({
          type: "job_click",
          interaction: element.dataset.trackAction,
          job_id: element.dataset.jobId,
          title: element.dataset.title,
          organization: element.dataset.organization,
          source: element.dataset.source,
          timestamp: new Date().toISOString()
        });
      });
    });
  </script>
</body>
</html>
`;
}

function buildRedirectPage(relativeTargetPath) {
  const escapedTarget = escapeHtml(relativeTargetPath);
  return `${JOB_PAGE_REDIRECT_PREFIX} ${escapedTarget} -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${escapedTarget}">
  <meta name="robots" content="noindex">
  <title>Redirecting…</title>
  <script>
    window.location.replace(${JSON.stringify(relativeTargetPath)});
  </script>
</head>
<body>
  <p>Redirecting to <a href="${escapedTarget}">${escapedTarget}</a>…</p>
</body>
</html>
`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readExistingPageHash(pagePath) {
  let handle;
  try {
    handle = await fs.open(pagePath, "r");
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.toString("utf8", 0, bytesRead);
    const match = header.match(/<!-- job-page-hash:\s*([a-f0-9]+)\s*-->/i);
    return match ? match[1] : "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function buildPagesFromJobs(jobs) {
  await ensureDir(PAGES_DIR);
  const existingFiles = await fs.readdir(PAGES_DIR).catch(() => []);
  const { map: pagePathMap, collisions } = buildJobPagePathMap(jobs);
  const expectedFileNames = new Set();
  const redirectEntries = [];

  jobs.forEach((job) => {
    const relativePagePath = pagePathMap.get(String(job.id || "")) || "./pages/job.html";
    expectedFileNames.add(path.basename(relativePagePath));
    (Array.isArray(job.redirect_paths) ? job.redirect_paths : []).forEach((redirectPath) => {
      const normalizedRedirectPath = String(redirectPath || "").trim();
      if (!normalizedRedirectPath || normalizedRedirectPath === relativePagePath) return;
      expectedFileNames.add(path.basename(normalizedRedirectPath));
      redirectEntries.push({
        redirectPath: normalizedRedirectPath,
        targetPath: relativePagePath
      });
    });
  });

  let pagesWrittenCount = 0;
  let pagesSkippedUnchangedCount = 0;
  let stalePagesDeletedCount = 0;
  let redirectPagesWrittenCount = 0;
  let largestDescriptionLength = 0;

  for (const fileName of existingFiles) {
    if (!fileName.endsWith(".html")) continue;
    if (expectedFileNames.has(fileName)) continue;
    await fs.unlink(path.join(PAGES_DIR, fileName));
    stalePagesDeletedCount += 1;
  }

  for (const job of jobs) {
    const relativePagePath = pagePathMap.get(String(job.id || "")) || "./pages/job.html";
    const slug = path.basename(relativePagePath, ".html");
    const pagePath = path.join(PAGES_DIR, `${slug}.html`);
    const nextHash = buildPageInputHash(job, slug);
    const existingHash = await readExistingPageHash(pagePath);
    const descriptionLength = String(job.description || "").length;
    if (descriptionLength > largestDescriptionLength) {
      largestDescriptionLength = descriptionLength;
    }

    if (existingHash && existingHash === nextHash) {
      pagesSkippedUnchangedCount += 1;
      continue;
    }

    const html = buildPage(job, slug, nextHash);
    await fs.writeFile(pagePath, html, "utf8");
    pagesWrittenCount += 1;
  }

  for (const entry of redirectEntries) {
    const redirectPagePath = path.join(ROOT, entry.redirectPath.replace(/^\.\//, ""));
    const redirectHtml = buildRedirectPage(path.basename(entry.targetPath));
    let existingRedirectHtml = "";
    try {
      existingRedirectHtml = await fs.readFile(redirectPagePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existingRedirectHtml === redirectHtml) continue;
    await fs.writeFile(redirectPagePath, redirectHtml, "utf8");
    redirectPagesWrittenCount += 1;
  }

  console.log(`[jobs:build-pages] public_jobs_loaded_count=${jobs.length}`);
  console.log(`[jobs:build-pages] pages_expected_count=${jobs.length}`);
  console.log(`[jobs:build-pages] pages_written_count=${pagesWrittenCount}`);
  console.log(`[jobs:build-pages] pages_skipped_unchanged_count=${pagesSkippedUnchangedCount}`);
  console.log(`[jobs:build-pages] stale_pages_deleted_count=${stalePagesDeletedCount}`);
  console.log(`[jobs:build-pages] redirect_pages_written_count=${redirectPagesWrittenCount}`);
  console.log(`[jobs:build-pages] largest_description_length=${largestDescriptionLength}`);
  console.log(`[jobs:build-pages] output_dir=${PAGES_DIR}`);
  console.log(`[jobs:build-pages] Resolved ${collisions.length} slug collisions.`);
  if (jobs.length > 500) {
    console.warn(`[jobs:build-pages] WARNING public_jobs_loaded_count=${jobs.length} exceeds expected threshold 500.`);
  }
  if (collisions.length) {
    console.log(`[jobs:build-pages] Collision samples: ${collisions.slice(0, 5).map((entry) => `${entry.base_slug} -> ${entry.id}`).join("; ")}`);
  }
  return {
    publicJobsLoadedCount: jobs.length,
    pagesExpectedCount: jobs.length,
    pagesWrittenCount,
    pagesSkippedUnchangedCount,
    stalePagesDeletedCount,
    redirectPagesWrittenCount,
    largestDescriptionLength,
    outputDir: PAGES_DIR
  };
}

async function buildPagesForSelectedJobs(jobs, options = {}) {
  await ensureDir(PAGES_DIR);
  const selectedIds = new Set((options.selectedIds || []).map((id) => String(id || "")));
  const { map: pagePathMap } = buildJobPagePathMap(jobs);
  let pagesWrittenCount = 0;
  let redirectPagesWrittenCount = 0;

  for (const job of jobs) {
    const id = String(job.id || "");
    if (!selectedIds.has(id)) continue;
    const relativePagePath = pagePathMap.get(id) || "./pages/job.html";
    const slug = path.basename(relativePagePath, ".html");
    const pagePath = path.join(PAGES_DIR, `${slug}.html`);
    const nextHash = buildPageInputHash(job, slug);
    const existingHash = await readExistingPageHash(pagePath);
    if (existingHash !== nextHash) {
      await fs.writeFile(pagePath, buildPage(job, slug, nextHash), "utf8");
      pagesWrittenCount += 1;
    }

    for (const redirectPath of Array.isArray(job.redirect_paths) ? job.redirect_paths : []) {
      const normalizedRedirectPath = String(redirectPath || "").trim();
      if (!normalizedRedirectPath || normalizedRedirectPath === relativePagePath) continue;
      const redirectPagePath = path.join(ROOT, normalizedRedirectPath.replace(/^\.\//, ""));
      const redirectHtml = buildRedirectPage(path.basename(relativePagePath));
      let existingRedirectHtml = "";
      try {
        existingRedirectHtml = await fs.readFile(redirectPagePath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (existingRedirectHtml === redirectHtml) continue;
      await fs.writeFile(redirectPagePath, redirectHtml, "utf8");
      redirectPagesWrittenCount += 1;
    }
  }

  console.log(`[jobs:build-pages:selected] selected_jobs_count=${selectedIds.size}`);
  console.log(`[jobs:build-pages:selected] pages_written_count=${pagesWrittenCount}`);
  console.log(`[jobs:build-pages:selected] redirect_pages_written_count=${redirectPagesWrittenCount}`);
  return {
    selectedJobsCount: selectedIds.size,
    pagesWrittenCount,
    redirectPagesWrittenCount
  };
}

async function main() {
  const records = await readJobRecords();
  const jobs = await readJobs();
  const jobRecordsPublicCount = countPublishedJobRecords(records);
  const jobsJsonCount = Array.isArray(jobs) ? jobs.length : 0;
  const pageBuildSafe = jobsJsonCount >= jobRecordsPublicCount;
  const validation = await buildValidationReport({ requirePages: false });

  console.log(`[jobs:build-pages] job_records_public_count=${jobRecordsPublicCount}`);
  console.log(`[jobs:build-pages] jobs_json_count_before=${jobsJsonCount}`);
  console.log(`[jobs:build-pages] jobs_json_count_after=${jobsJsonCount}`);
  console.log(`[jobs:build-pages] page_build_safe=${pageBuildSafe}`);
  console.log(`[jobs:build-pages] missing_page_url_count=${validation.missing_page_url_count}`);
  console.log(`[jobs:build-pages] stale_page_url_count=${validation.stale_page_url_count}`);
  console.log(`[jobs:build-pages] duplicate_slug_count=${validation.duplicate_slug_count}`);

  if (!pageBuildSafe) {
    throw new Error(`Refusing to build pages: jobs.json count ${jobsJsonCount} is less than public job-records count ${jobRecordsPublicCount}. Refresh jobs.json first.`);
  }
  if (validation.missing_page_url_count || validation.stale_page_url_count || validation.duplicate_page_url_count) {
    throw new Error(
      `Refusing to build pages: jobs.json has missing/stale/duplicate page_url values (missing=${validation.missing_page_url_count}, stale=${validation.stale_page_url_count}, duplicate=${validation.duplicate_page_url_count}).`
    );
  }

  await buildPagesFromJobs(jobs);
  const postBuildValidation = await buildValidationReport({ requirePages: true });
  if (postBuildValidation.broken_link_count) {
    throw new Error(`Generated pages validation failed: broken_link_count=${postBuildValidation.broken_link_count}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:build-pages] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildJobPagePathMap,
  buildPageInputHash,
  buildPagesFromJobs,
  buildPagesForSelectedJobs,
  readExistingPageHash
};
