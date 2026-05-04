function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function cleanVisibleText(value) {
  return String(value || "")
    .replace(/\s*[>›»]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function buildJobPagePathMap(jobs = []) {
  const usedSlugs = new Map();
  const collisions = [];
  const map = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const slug = buildUniqueJobSlug(job, usedSlugs, collisions);
    map.set(String(job && job.id || ""), `./pages/${slug}.html`);
  }

  return { map, collisions };
}

module.exports = {
  buildIdSuffix,
  buildJobPagePathMap,
  buildJobSlug,
  buildUniqueJobSlug,
  cleanVisibleText,
  slugify
};
