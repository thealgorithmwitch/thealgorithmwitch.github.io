const fs = require("fs/promises");
const path = require("path");
const { readJobRecords } = require("./public-records");
const { resolveDisplayJobFromRecord, shouldShowPublicRecord } = require("./lifecycle-utils");

const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "pages");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildJobSlug(job) {
  return slugify(`${job.title}-${job.organization}`);
}

function buildIdSuffix(job) {
  const normalizedId = slugify(job.id || "");
  if (!normalizedId) return "job";
  return normalizedId.slice(-8) || normalizedId;
}

function buildUniqueJobSlug(job, usedSlugs, collisions) {
  const baseSlug = buildJobSlug(job) || buildIdSuffix(job);
  let nextSlug = baseSlug;

  if (!usedSlugs.has(nextSlug)) {
    usedSlugs.set(nextSlug, String(job.id || ""));
    return nextSlug;
  }

  const existingJobId = usedSlugs.get(nextSlug);
  if (existingJobId === String(job.id || "")) {
    return nextSlug;
  }

  collisions.push({
    base_slug: baseSlug,
    id: String(job.id || ""),
    title: job.title,
    organization: job.organization
  });

  const suffix = buildIdSuffix(job);
  nextSlug = `${baseSlug}-${suffix}`;

  if (!usedSlugs.has(nextSlug)) {
    usedSlugs.set(nextSlug, String(job.id || ""));
    return nextSlug;
  }

  let attempt = 2;
  while (usedSlugs.has(`${nextSlug}-${attempt}`) && usedSlugs.get(`${nextSlug}-${attempt}`) !== String(job.id || "")) {
    attempt += 1;
  }
  nextSlug = `${nextSlug}-${attempt}`;
  usedSlugs.set(nextSlug, String(job.id || ""));
  return nextSlug;
}

function truncate(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
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
  const payload = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description || job.raw_description || "",
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
    employmentType: job.job_type || undefined,
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

function buildPage(job, slug) {
  const title = `${job.title} at ${job.organization}`;
  const description = truncate(job.description || job.raw_description || `${job.title} at ${job.organization} in climate, clean energy, sustainability, policy, and creative work.`);
  const originalUrl = job.original_url || job.apply_url || job.source_url || "#";
  const tags = Array.isArray(job.tags) ? job.tags.filter(Boolean) : [];
  const summary = job.description || job.raw_description || "";
  const detailUrl = `https://example.com/jobs/pages/${slug}.html`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Fresh Roles</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)} | Fresh Roles">
  <meta property="og:description" content="${escapeHtml(description)}">
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
        <h2>${escapeHtml(job.title)}</h2>
        <div style="font-size:1.05rem; color:var(--ink-secondary);">${escapeHtml(job.organization)}</div>
        <div class="meta-list">
          ${job.location ? `<div class="meta">${escapeHtml(job.location)}</div>` : ""}
          ${job.job_type ? `<div class="meta">${escapeHtml(job.job_type)}</div>` : ""}
          ${job.salary ? `<div class="meta">${escapeHtml(job.salary)}</div>` : ""}
          ${job.source ? `<div class="meta">${escapeHtml(job.source)}</div>` : ""}
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <a class="btn-primary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" data-track-action="apply" data-job-id="${escapeHtml(job.id)}" data-title="${escapeHtml(job.title)}" data-organization="${escapeHtml(job.organization)}" data-source="${escapeHtml(job.source)}">Apply</a>
          <a class="btn-secondary" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" data-track-action="view-original" data-job-id="${escapeHtml(job.id)}" data-title="${escapeHtml(job.title)}" data-organization="${escapeHtml(job.organization)}" data-source="${escapeHtml(job.source)}">View Original</a>
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function buildPagesFromRecords(records) {
  const jobs = records.filter((record) => record.record_type === "job" && shouldShowPublicRecord(record)).map(resolveDisplayJobFromRecord);
  await ensureDir(PAGES_DIR);
  const existingFiles = await fs.readdir(PAGES_DIR).catch(() => []);
  await Promise.all(
    existingFiles
      .filter((fileName) => fileName.endsWith(".html"))
      .map((fileName) => fs.unlink(path.join(PAGES_DIR, fileName)))
  );

  const usedSlugs = new Map();
  const collisions = [];
  let samplePagePath = "";

  for (const job of jobs) {
    const slug = buildUniqueJobSlug(job, usedSlugs, collisions);
    const html = buildPage(job, slug);
    const pagePath = path.join(PAGES_DIR, `${slug}.html`);
    await fs.writeFile(pagePath, html, "utf8");
    if (!samplePagePath) samplePagePath = pagePath;
  }

  const htmlFiles = (await fs.readdir(PAGES_DIR).catch(() => [])).filter((fileName) => fileName.endsWith(".html"));

  console.log(`[jobs:build-pages] Generated ${jobs.length} job pages in ${PAGES_DIR}.`);
  console.log(`[jobs:build-pages] HTML file count: ${htmlFiles.length}.`);
  console.log(`[jobs:build-pages] Resolved ${collisions.length} slug collisions.`);
  if (collisions.length) {
    console.log(`[jobs:build-pages] Collision samples: ${collisions.slice(0, 5).map((entry) => `${entry.base_slug} -> ${entry.id}`).join("; ")}`);
  }
  if (samplePagePath) {
    console.log(`[jobs:build-pages] Sample page: ${samplePagePath}`);
  }
  return jobs.length;
}

async function main() {
  const records = await readJobRecords();
  await buildPagesFromRecords(records);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:build-pages] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildJobSlug,
  buildPagesFromRecords
};
