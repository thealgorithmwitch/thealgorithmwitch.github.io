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
  return /career|job|jobs|position|opening|opportunit|vacanc/i.test(String(url || ""));
}

function isLikelyJobTitle(text) {
  if (!text) return false;
  if (text.length < 4 || text.length > 140) return false;
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
