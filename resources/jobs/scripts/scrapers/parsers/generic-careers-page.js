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
    const urlTitle = titleFromUrl(href);
    const contextualTitle = context
      .split(/(?<=[.!?])\s+/)
      .map((line) => cleanJobTitle(line))
      .find((line) => isLikelyJobTitle(line));
    const cleanedAnchor = cleanJobTitle(anchorText);
    const prefersUrlTitle =
      isLikelyJobTitle(urlTitle) &&
      (
        !isLikelyJobTitle(cleanedAnchor) ||
        cleanedAnchor.split(/\s+/).length < 3 ||
        /<|>|class=|href=|\/">|^\w+$/.test(anchorText) ||
        /<|>|class=|href=|\/">/.test(cleanedAnchor)
      );
    const title = cleanJobTitle(
      prefersUrlTitle
        ? urlTitle
        : isLikelyJobTitle(cleanedAnchor)
          ? cleanedAnchor
          : isLikelyJobTitle(urlTitle)
            ? urlTitle
            : contextualTitle || anchorText
    );

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

function cleanJobTitle(value) {
  return normalizeText(value)
    .replace(/^.*?(?=(?:director|manager|specialist|coordinator|engineer|analyst|associate|intern|lead|head|officer|administrator|designer|developer|strategist|communications|policy|finance|operations|marketing|product|people|talent|research|advisor|consultant)\b)/i, "")
    .replace(/\b(?:remote within [a-z]{2}|new york,\s*ny|washington,\s*dc|oakland,\s*ca|denver,\s*co)\b\s*\/?\s*/gi, "")
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/gi, "")
    .replace(/^[\/|\-:\s]+|[\/|\-:\s]+$/g, "")
    .trim();
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop() || "";
    return cleanJobTitle(
      slug
        .replace(/\?.*$/g, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b(remote|usa|us|ca|ny|dc|az|tx|fl)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())
    );
  } catch (_error) {
    return "";
  }
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
