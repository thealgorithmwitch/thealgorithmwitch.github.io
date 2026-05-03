function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function matchRule(title, patterns) {
  return patterns.find((pattern) => pattern.test(title)) || null;
}

function evaluateSourceTitleRules(job = {}) {
  const title = normalizeText(job.title);
  const organization = normalizeText(job.organization);
  const source = normalizeText(job.source);
  const sourceId = normalizeText(job.source_id);

  if (!title) return null;

  if (
    (organization === "sunrun" || source.includes("sunrun") || sourceId.includes("sunrun")) &&
    matchRule(title, [/^previous$/i, /^next$/i, /^life at sunrun$/i])
  ) {
    return { reason: "source_title_rule:sunrun_navigation_or_brand_copy" };
  }

  if (
    (organization === "rwe" || source.includes("rwe") || sourceId.includes("rwe")) &&
    matchRule(title, [/^the power of all voices$/i, /^eeo policy statement$/i, /^.*know your rights.*$/i])
  ) {
    return { reason: "source_title_rule:rwe_brand_or_policy_copy" };
  }

  if (
    (organization === "edp" || source.includes("edp") || sourceId.includes("edp")) &&
    matchRule(title, [/^portugal$/i, /^portugu[eê]s\s*\(portugal\)$/i])
  ) {
    return { reason: "source_title_rule:edp_location_shell_title" };
  }

  if (
    (organization === "nextera energy" || source.includes("nextera") || sourceId.includes("nextera")) &&
    matchRule(title, [/^life at nextera energy$/i])
  ) {
    return { reason: "source_title_rule:nextera_brand_copy" };
  }

  if (
    (organization === "environmental defense fund" || organization === "edf" || source.includes("environmental defense fund") || sourceId.includes("edf")) &&
    matchRule(title, [
      /^want a .* career\??$/i,
      /^hotline\b/i,
      /^faq\b/i,
      /^our impact$/i,
      /^job explorer$/i,
      /^.*career questions.*$/i,
      /^.*share their stories.*$/i
    ])
  ) {
    return { reason: "source_title_rule:edf_blog_or_career_advice_copy" };
  }

  return null;
}

module.exports = {
  evaluateSourceTitleRules
};
