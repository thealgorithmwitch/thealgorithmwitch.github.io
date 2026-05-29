function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function isLikelyJobUrl(url) {
  const text = String(url || "").trim();
  if (!text) return false;
  if (/#/.test(text) && !/[?&](gh_jid|source)=/i.test(text)) return false;

  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname || "").toLowerCase();
  const query = parsed.search.toLowerCase();
  const normalized = `${host}${path}${query}`;

  if (
    /linkedin\.com\/(?:company|sharearticle)|facebook\.com\/sharer|x\.com\/intent|instagram\.com|eeoc\.gov|comeet\.com\/en\/articles/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (
    /\b(?:privacy|cookie|cookies|legal|security|contact|demo|newsletter|blog|events|guidance|pricing|glossary|api|developers|integrations|support|login|sign[_-]in|candidate-privacy|employment-scams|sample-employment-test|talentcommunity|customer-success|search-results|careerhome\.action|userhome)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (/\/(?:category|job-category|job-location)\//i.test(path)) return false;
  if (/\/(?:go|content|companies)(?:\/|$)/i.test(path)) return false;
  if (/\/(?:issue|degrees)(?:\/|$)/i.test(path)) return false;
  if (/\/environmental-careers(?:\/|$)/i.test(path)) return false;
  if (/\/take-action-current-opportunities(?:\/|$)/i.test(path)) return false;
  if (/\/(?:fellowship-openings|internship-openings)(?:\/|$)/i.test(path)) return false;
  if (/[?&]f(?:%5b|\[)0(?:%5d|\])=/i.test(query)) return false;
  if ((/\/search\/?$/i.test(path) || /\/jobs\/?$/i.test(path)) && /(?:department|team|location|q)=/i.test(query)) return false;
  if ((/\/careers\/?$/i.test(path) || /\/jobs\/?$/i.test(path) || path === "/") && !query) return false;
  if (host === "boards.greenhouse.io" && !/\/jobs\/\d+/i.test(path) && !/[?&]gh_jid=/i.test(query)) return false;
  if (/jobs\.lever\.co$/i.test(host) && query && !/\/[0-9a-f-]{12,}(?:\/apply)?\/?$/i.test(path)) return false;

  return /career|job|jobs|position|opening|opportunit|vacanc|applytojob|career\.place|greenhouse|lever/i.test(text);
}

function isLikelyJobTitle(text) {
  if (!text) return false;
  if (text.length < 4 || text.length > 140) return false;
  if (
    /skip to|board of directors|privacy|cookie|terms of (?:use|service)|applicant|candidate privacy|employment scams|sample employment test|join talent community|search jobs|search results|job openings|we(?:'|’)re hiring|careers website|click here to submit your application|get a green job|explore episodes|fellowships? at|internships? at|fellowships|internships or contact/i.test(
      text
    )
  ) {
    return false;
  }
  return /(manager|director|specialist|coordinator|engineer|analyst|associate|intern|lead|head|officer|administrator|designer|developer|strategist|communications|policy|finance|operations|marketing|product|people|talent|research|advisor|consultant)/i.test(text);
}

function getContextSnippet(html, index, size = 280) {
  const start = Math.max(0, index - size);
  const end = Math.min(html.length, index + size);
  return html.slice(start, end);
}

module.exports = {
  getContextSnippet,
  isLikelyJobTitle,
  isLikelyJobUrl,
  normalizeText,
  stripHtml,
  toAbsoluteUrl
};
