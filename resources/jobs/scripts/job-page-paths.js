function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function cleanVisibleText(value) {
  return String(value || "")
    .replace(/\b(?:previous|next)\s*post\b[:\s-]*/gi, " ")
    .replace(/\b(?:previous|next)\b(?=\s*(?:post\b|$))/gi, " ")
    .replace(/\brelated posts?\b[:\s-]*/gi, " ")
    .replace(/\be"\s*"*\s*(?:headers?)?(?:\s*"*)+/gi, " ")
    .replace(/\bTitle Business(?: Platform Location Date)?\b/gi, " ")
    .replace(/\bsee (?:new|current) openings\b/gi, " ")
    .replace(/\b\d+\s+hours?\)\s*(?:On-site|Remote|Hybrid)\b/gi, " ")
    .replace(/\bPOINT\s*\([^)]*\)/gi, " ")
    .replace(/\blocality\b/gi, " ")
    .replace(/\b\d*\/svg\b/gi, " ")
    .replace(/\bviewBox(?:="[^"]*")?\b/gi, " ")
    .replace(/<span\b/gi, " ")
    .replace(/\b([A-Za-z][A-Za-z&,'/-]{2,})\s*\|\s*\1\b/gi, "$1")
    .replace(/\b(\d{3,})\b/g, (match) => {
      const numeric = Number(match);
      return match.length === 4 && numeric >= 1900 && numeric <= 2100 ? match : " ";
    })
    .replace(/<[^>]*>/g, " ")
    .replace(/\s*[>›»]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeManualPagePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(?:^|\/)pages\/([a-z0-9][a-z0-9-]*)\.html$/i);
  if (!match || !match[1]) return "";
  return `./pages/${match[1].toLowerCase()}.html`;
}

function getManualPagePathOverride(job = {}) {
  return normalizeManualPagePath(
    job.page_url_override ||
    job.manual_page_url ||
    job.slug_override ||
    job.display?.page_url_override ||
    job.display?.slug_override ||
    job.raw_source_data?.page_url_override ||
    job.raw_source_data?.slug_override
  );
}

function buildJobSlug(job) {
  return slugify(`${cleanVisibleText(job.title)}-${cleanVisibleText(job.organization)}`);
}

function buildIdSuffix(job) {
  const normalizedId = slugify(job && job.id || "");
  if (!normalizedId) return "job";
  return normalizedId.slice(-8) || normalizedId;
}

function buildUniqueJobSlug(job, usedSlugs, collisions = []) {
  const baseSlug = buildJobSlug(job) || buildIdSuffix(job);
  let nextSlug = baseSlug;
  const jobId = String(job && job.id || "");

  if (!usedSlugs.has(nextSlug)) {
    usedSlugs.set(nextSlug, jobId);
    return nextSlug;
  }

  const existingJobId = usedSlugs.get(nextSlug);
  if (existingJobId === jobId) {
    return nextSlug;
  }

  collisions.push({
    base_slug: baseSlug,
    id: jobId,
    title: job && job.title,
    organization: job && job.organization
  });

  const suffix = buildIdSuffix(job);
  nextSlug = `${baseSlug}-${suffix}`;

  if (!usedSlugs.has(nextSlug)) {
    usedSlugs.set(nextSlug, jobId);
    return nextSlug;
  }

  let attempt = 2;
  while (usedSlugs.has(`${nextSlug}-${attempt}`) && usedSlugs.get(`${nextSlug}-${attempt}`) !== jobId) {
    attempt += 1;
  }
  nextSlug = `${nextSlug}-${attempt}`;
  usedSlugs.set(nextSlug, jobId);
  return nextSlug;
}

function buildJobPagePath(job, usedSlugs, collisions = []) {
  const manualPathOverride = getManualPagePathOverride(job);
  if (manualPathOverride) {
    const manualSlug = pathBasenameWithoutExt(manualPathOverride);
    const existingJobId = usedSlugs.get(manualSlug);
    const jobId = String(job && job.id || "");
    if (!existingJobId || existingJobId === jobId) {
      usedSlugs.set(manualSlug, jobId);
      return manualPathOverride;
    }
    collisions.push({
      base_slug: manualSlug,
      id: jobId,
      title: job && job.title,
      organization: job && job.organization,
      manual_override_collision: true
    });
  }
  const slug = buildUniqueJobSlug(job, usedSlugs, collisions);
  return `./pages/${slug}.html`;
}

function pathBasenameWithoutExt(pagePath) {
  return String(pagePath || "")
    .replace(/^.*\//, "")
    .replace(/\.html$/i, "");
}

function buildJobPagePathMap(jobs = []) {
  const usedSlugs = new Map();
  const collisions = [];
  const map = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    map.set(String(job && job.id || ""), buildJobPagePath(job, usedSlugs, collisions));
  }

  return { map, collisions };
}

module.exports = {
  buildIdSuffix,
  buildJobPagePath,
  buildJobPagePathMap,
  buildJobSlug,
  buildUniqueJobSlug,
  cleanVisibleText,
  getManualPagePathOverride,
  normalizeManualPagePath,
  pathBasenameWithoutExt,
  slugify
};
