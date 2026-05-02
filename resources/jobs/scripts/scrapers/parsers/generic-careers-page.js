const {
  getContextSnippet,
  isLikelyJobTitle,
  isLikelyJobUrl,
  normalizeText,
  toAbsoluteUrl
} = require("../base-utils");

function extractAnchorRecords(html, sourceUrl) {
  const records = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const href = toAbsoluteUrl(sourceUrl, match[1]);
    if (!href || !isLikelyJobUrl(href)) continue;
    const anchorText = normalizeText(match[2]);
    const context = normalizeText(getContextSnippet(html, match.index, 320));
    const title = isLikelyJobTitle(anchorText)
      ? anchorText
      : context
        .split(/(?<=[.!?])\s+/)
        .find((line) => isLikelyJobTitle(line)) || anchorText;

    if (!isLikelyJobTitle(title)) continue;
    records.push({
      title,
      apply_url: href,
      source_url: sourceUrl,
      raw_description: context
    });
  }
  return records;
}

async function scrapeGenericCareersPage(source) {
  const response = await fetch(source.source_url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.source_url}`);
  }

  const html = await response.text();
  const rawJobs = extractAnchorRecords(html, source.source_url);
  return rawJobs.map((job) => ({
    title: job.title,
    organization: source.organization,
    location: "",
    workplace_type: "",
    job_type: "",
    salary: "",
    source: "Custom Careers Page",
    source_type: "custom_careers_page",
    source_url: source.source_url,
    apply_url: job.apply_url,
    date_posted: "",
    raw_description: job.raw_description,
    description: job.raw_description,
    sector: source.sector,
    function: Array.isArray(source.function_defaults) && source.function_defaults.length ? source.function_defaults[0] : "",
    notes: `Scraped from ${source.source_url}`,
    raw_payload: {
      html,
      link_text: job.title,
      link_url: job.apply_url,
      context: job.raw_description
    }
  }));
}

module.exports = {
  scrapeGenericCareersPage
};
