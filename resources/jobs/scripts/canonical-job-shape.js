const {
  buildDescriptionSnippet,
  buildFallbackDescription,
  hasUsableDescription,
  normalizeJob,
  normalizeDescription,
  normalizePayDisplay,
  normalizeWorkplaceType,
  stringifySafe
} = require("./job-normalizer");
const {
  hasMalformedDescriptionTemplateSafe
} = require("./malformed-description-helper");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildDescriptionCandidate(job = {}) {
  return [
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary,
    job.notes
  ].filter(Boolean).join(" ");
}

function needsDescriptionRepair(value, options = {}) {
  const text = stringifySafe(value);
  const title = stringifySafe(options.title);
  const organization = stringifySafe(options.organization);
  return !text
    || hasMalformedDescriptionTemplateSafe(text)
    || !hasUsableDescription(text, { title, organization });
}

function hasEnoughContextForSafePlaceholder(job = {}) {
  const title = stringifySafe(job.title);
  const organization = stringifySafe(job.organization);
  return Boolean(title && organization && title.length >= 4 && organization.length >= 2);
}

function buildSharedFallbackDescription(job = {}, options = {}) {
  const title = stringifySafe(options.title || job.title);
  const organization = stringifySafe(options.organization || job.organization);
  let fallback = buildFallbackDescription({
    ...job,
    title,
    organization
  });
  if (!needsDescriptionRepair(fallback, { title, organization })) {
    return fallback;
  }
  if (!hasEnoughContextForSafePlaceholder(job)) {
    return fallback;
  }
  fallback = buildFallbackDescription({
    ...job,
    title,
    organization,
    function: stringifySafe(job.function || job.sector || "its work")
  });
  if (!needsDescriptionRepair(fallback, { title, organization })) {
    return fallback;
  }
  return `This role supports ${organization ? `${organization}${organization.endsWith("s") ? "'" : "'s"}` : "the organization's"} work across ${stringifySafe(job.function || job.sector || "its focus areas")}.`;
}

function repairCanonicalDescriptionShape(job = {}, options = {}) {
  const title = stringifySafe(options.title || job.title);
  const organization = stringifySafe(options.organization || job.organization);
  const descriptionCandidate = buildDescriptionCandidate(job);
  const normalizedDescription = normalizeDescription(descriptionCandidate, {
    title,
    organization
  }).description;
  let description = stringifySafe(job.description || job.raw_description || normalizedDescription);
  if (needsDescriptionRepair(description, { title, organization })) {
    description = stringifySafe(normalizedDescription);
  }
  if (needsDescriptionRepair(description, { title, organization })) {
    description = stringifySafe(buildSharedFallbackDescription(job, { title, organization }));
  }

  let snippet = stringifySafe(job.description_snippet || job.summary);
  if (needsDescriptionRepair(snippet, { title, organization })) {
    snippet = buildDescriptionSnippet(description, 220, { title });
  }
  if (needsDescriptionRepair(snippet, { title, organization })) {
    snippet = description;
  }

  return {
    description,
    snippet,
    trusted: !needsDescriptionRepair(description, { title, organization })
      && !needsDescriptionRepair(snippet, { title, organization })
  };
}

function canonicalizeJobShape(job = {}, options = {}) {
  const normalized = options.alreadyNormalized ? job : normalizeJob(job);
  if (!normalized) return null;

  const title = stringifySafe(normalized.title);
  const repairedText = repairCanonicalDescriptionShape({
    ...job,
    ...normalized
  }, {
    title,
    organization: stringifySafe(normalized.organization)
  });
  const description = stringifySafe(repairedText.description || normalized.description || normalized.raw_description);
  const snippet = stringifySafe(repairedText.snippet)
    || stringifySafe(normalized.description_snippet || normalized.summary)
    || buildDescriptionSnippet(description, 220, { title });

  return {
    ...normalized,
    salary: normalizePayDisplay({
      payDisplay: normalized.salary,
      salaryMin: normalized.salary_min,
      salaryMax: normalized.salary_max,
      currency: normalized.salary_currency,
      period: normalized.salary_period
    }),
    workplace_type: normalizeWorkplaceType(normalized.workplace_type, ""),
    description,
    raw_description: stringifySafe(normalized.raw_description || description),
    description_snippet: snippet,
    summary: snippet,
    tags: toArray(normalized.tags).map((tag) => stringifySafe(tag)).filter(Boolean)
  };
}

function buildCanonicalPublishedDisplay(job = {}) {
  const canonical = canonicalizeJobShape(job, { alreadyNormalized: true }) || canonicalizeJobShape(job);
  if (!canonical) return null;
  return {
    title: stringifySafe(canonical.title),
    organization: stringifySafe(canonical.organization),
    location: stringifySafe(canonical.location),
    location_type: stringifySafe(canonical.workplace_type),
    pay_display: stringifySafe(canonical.salary),
    salary_min: canonical.salary_min ?? null,
    salary_max: canonical.salary_max ?? null,
    role_type: stringifySafe(canonical.job_type),
    experience_level: stringifySafe(canonical.experience),
    sector: stringifySafe(canonical.sector),
    function: stringifySafe(canonical.function),
    specialization: stringifySafe(canonical.specialization),
    specialization_confidence: stringifySafe(canonical.specialization_confidence || "low"),
    tags: toArray(canonical.tags),
    description: stringifySafe(canonical.description),
    source_name: stringifySafe(canonical.source),
    source_url: stringifySafe(canonical.source_url),
    original_url: stringifySafe(canonical.original_url),
    date_collected: stringifySafe(canonical.date_posted),
    application_url: stringifySafe(canonical.apply_url),
    page_url_override: stringifySafe(canonical.page_url_override),
    published: Boolean(canonical.status === "active" || canonical.status === "published"),
    featured: Boolean(canonical.featured)
  };
}

module.exports = {
  buildCanonicalPublishedDisplay,
  buildDescriptionCandidate,
  buildSharedFallbackDescription,
  canonicalizeJobShape,
  repairCanonicalDescriptionShape
};
