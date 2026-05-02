const {
  getContextSnippet,
  isLikelyJobTitle,
  isLikelyJobUrl,
  normalizeText,
  stripHtml,
  toAbsoluteUrl
} = require("../base-utils");
const { stableHash, stringifySafe, todayIso } = require("../../job-normalizer");

const CARD_PATTERN = /<(li|tr|article|section|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const JSON_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LINK_PATTERN = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function cleanJobTitle(value) {
  return normalizeText(value)
    .replace(/\b(?:apply now|learn more|view role|read more|see details|job details)\b/gi, " ")
    .replace(/\b(?:remote within [a-z]{2}|united states|usa|u\.s\.)\b/gi, " ")
    .replace(/^[\/|\-:\s]+|[\/|\-:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() || "";
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

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function extractLinks(html, pageUrl) {
  const links = [];
  let match;
  while ((match = LINK_PATTERN.exec(html))) {
    const href = toAbsoluteUrl(pageUrl, match[1]);
    if (!href) continue;
    links.push({
      url: href,
      text: cleanJobTitle(match[2]),
      html: match[0],
      index: match.index,
      context: normalizeText(getContextSnippet(html, match.index, 360))
    });
  }
  return links;
}

function pickBestTitle({ anchorText, headingText, contextTitle, urlTitle }) {
  const candidates = [anchorText, headingText, contextTitle, urlTitle].map((value) => cleanJobTitle(value)).filter(Boolean);
  return candidates.find((value) => isLikelyJobTitle(value)) || candidates[0] || "";
}

function findHeadingText(blockHtml) {
  const headingMatch = blockHtml.match(/<(h1|h2|h3|h4|h5|h6|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i);
  return headingMatch ? normalizeText(headingMatch[2]) : "";
}

function extractLocation(blockText) {
  const match =
    blockText.match(/\b(remote|hybrid|on-site|onsite)\b/i) ||
    blockText.match(/\b(?:location|based in|office|city)\s*:?\s*([A-Z][A-Za-z .'-]+(?:,\s*[A-Z]{2})?)/i) ||
    blockText.match(/\b([A-Z][A-Za-z .'-]+,\s*[A-Z]{2})\b/);
  return normalizeText(match?.[1] || match?.[0] || "");
}

function extractDepartment(blockText) {
  const match = blockText.match(/\b(?:department|team|function)\s*:?\s*([A-Za-z0-9 /&-]{3,80})/i);
  return normalizeText(match?.[1] || "");
}

function buildRawJob(source, pageUrl, values = {}) {
  const title = cleanJobTitle(values.title);
  const originalUrl = stringifySafe(values.original_url || values.apply_url || values.url);
  if (!title || !originalUrl) return null;

  return {
    id: values.id || `${source.id || source.organization}-${stableHash(`${title}:${originalUrl}`)}`,
    external_id: values.external_id || "",
    title,
    organization: source.organization,
    location: stringifySafe(values.location),
    workplace_type: stringifySafe(values.workplace_type),
    job_type: stringifySafe(values.job_type),
    salary: stringifySafe(values.pay || values.salary),
    source: values.source || "Custom Careers Page",
    source_type: values.source_type || source.type || "generic",
    source_url: stringifySafe(values.source_url || pageUrl || source.source_url),
    apply_url: originalUrl,
    original_url: originalUrl,
    date_posted: stringifySafe(values.date_posted) || todayIso(),
    raw_description: stringifySafe(values.raw_description || values.description),
    description: stringifySafe(values.description || values.raw_description),
    sector: source.sector,
    function: stringifySafe(values.function || values.department) ||
      (Array.isArray(source.function_defaults) && source.function_defaults.length ? source.function_defaults[0] : ""),
    notes: stringifySafe(values.notes || `Scraped from ${pageUrl || source.source_url}`),
    raw_payload: values.raw_payload || values
  };
}

function extractAnchorRecords(html, pageUrl, source) {
  return extractLinks(html, pageUrl)
    .filter((link) => isLikelyJobUrl(link.url))
    .map((link) => {
      const urlTitle = titleFromUrl(link.url);
      const contextTitle = link.context
        .split(/(?<=[.!?])\s+/)
        .map((line) => cleanJobTitle(line))
        .find((line) => isLikelyJobTitle(line));
      return buildRawJob(source, pageUrl, {
        title: pickBestTitle({
          anchorText: link.text,
          contextTitle,
          urlTitle
        }),
        original_url: link.url,
        raw_description: link.context,
        description: link.context,
        raw_payload: {
          link_text: link.text,
          link_url: link.url,
          context: link.context
        }
      });
    })
    .filter(Boolean);
}

function extractCardRecords(html, pageUrl, source) {
  const records = [];
  let match;
  while ((match = CARD_PATTERN.exec(html))) {
    const blockHtml = match[2];
    const blockText = normalizeText(blockHtml);
    if (!/(apply|job|career|opening|position|department|team|location|remote)/i.test(blockText)) continue;

    const headingText = findHeadingText(blockHtml);
    const blockLinks = extractLinks(blockHtml, pageUrl).filter((link) => isLikelyJobUrl(link.url));
    for (const link of blockLinks) {
      const title = pickBestTitle({
        anchorText: link.text,
        headingText,
        contextTitle: blockText,
        urlTitle: titleFromUrl(link.url)
      });
      const record = buildRawJob(source, pageUrl, {
        title,
        original_url: link.url,
        location: extractLocation(blockText),
        function: extractDepartment(blockText),
        raw_description: blockText,
        description: blockText,
        raw_payload: {
          block_html: blockHtml,
          link_text: link.text,
          link_url: link.url
        }
      });
      if (record) records.push(record);
    }
  }
  return records;
}

function extractJsonScripts(html) {
  const scripts = [];
  let match;
  while ((match = JSON_SCRIPT_PATTERN.exec(html))) {
    scripts.push({
      attrs: match[1] || "",
      content: match[2] || ""
    });
  }
  return scripts;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function flattenObjects(value, results = [], seen = new Set()) {
  if (!value || typeof value !== "object") return results;
  if (seen.has(value)) return results;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => flattenObjects(item, results, seen));
    return results;
  }
  results.push(value);
  Object.values(value).forEach((next) => flattenObjects(next, results, seen));
  return results;
}

function collectJobObjects(value) {
  return flattenObjects(value).filter((item) => {
    const title = stringifySafe(item.title || item.name || item.jobTitle || item.position || item.text);
    const url = stringifySafe(
      item.absolute_url ||
      item.applyUrl ||
      item.apply_url ||
      item.url ||
      item.hostedUrl ||
      item.careers_url ||
      item.jobLink ||
      item.jobUrl ||
      item.ref
    );
    const hasTitle = isLikelyJobTitle(cleanJobTitle(title));
    const hasUrl = url ? isLikelyJobUrl(url) || /^https?:\/\//i.test(url) : false;
    return hasTitle && hasUrl;
  });
}

function objectToJobRecord(jobObject, pageUrl, source) {
  const title = stringifySafe(jobObject.title || jobObject.name || jobObject.jobTitle || jobObject.position || jobObject.text);
  const originalUrl = toAbsoluteUrl(
    pageUrl,
    stringifySafe(
      jobObject.absolute_url ||
      jobObject.applyUrl ||
      jobObject.apply_url ||
      jobObject.url ||
      jobObject.hostedUrl ||
      jobObject.careers_url ||
      jobObject.jobLink ||
      jobObject.jobUrl ||
      jobObject.ref
    )
  );
  const location = stringifySafe(
    jobObject.locationName ||
    jobObject.location?.name ||
    jobObject.location?.city ||
    jobObject.location ||
    jobObject.primaryLocation
  );

  return buildRawJob(source, pageUrl, {
    external_id: stringifySafe(jobObject.id || jobObject.jobPostingId || jobObject.shortcode || jobObject.reqId),
    title,
    original_url: originalUrl,
    location,
    job_type: stringifySafe(jobObject.employmentType || jobObject.commitment || jobObject.employment_type || jobObject.type),
    workplace_type: stringifySafe(jobObject.workplaceType || jobObject.workplace || jobObject.remote),
    pay: stringifySafe(jobObject.salary || jobObject.compensation?.summary || jobObject.compensation || jobObject.pay),
    description: stringifySafe(
      jobObject.description ||
      jobObject.descriptionHtml ||
      jobObject.description_html ||
      jobObject.content ||
      jobObject.summary
    ),
    function: stringifySafe(jobObject.department?.name || jobObject.department || jobObject.team?.name || jobObject.team),
    raw_payload: jobObject
  });
}

function extractJsonLdJobs(html, pageUrl, source) {
  const scripts = extractJsonScripts(html).filter((script) => /ld\+json|application\/json/i.test(script.attrs));
  const records = [];
  for (const script of scripts) {
    const parsed = safeJsonParse(script.content.trim());
    if (!parsed) continue;
    const objects = collectJobObjects(parsed);
    for (const jobObject of objects) {
      const record = objectToJobRecord(jobObject, pageUrl, source);
      if (record) records.push(record);
    }
  }
  return records;
}

function extractBalancedJsonSegments(scriptContent) {
  const segments = [];
  for (let index = 0; index < scriptContent.length; index += 1) {
    const char = scriptContent[index];
    if (char !== "{" && char !== "[") continue;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let cursor = index; cursor < scriptContent.length; cursor += 1) {
      const current = scriptContent[cursor];
      if (quote) {
        if (!escaped && current === quote) {
          quote = "";
        }
        escaped = !escaped && current === "\\";
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        escaped = false;
        continue;
      }
      if (current === "{" || current === "[") depth += 1;
      if (current === "}" || current === "]") depth -= 1;
      if (depth === 0) {
        const candidate = scriptContent.slice(index, cursor + 1).trim();
        if (candidate.length >= 20 && /"?(job|jobs|opening|position|posting|title|applyUrl|absolute_url|hostedUrl)"?/i.test(candidate)) {
          segments.push(candidate);
        }
        index = cursor;
        break;
      }
    }
  }
  return segments.slice(0, 40);
}

function extractEmbeddedJsonJobs(html, pageUrl, source) {
  const scripts = extractJsonScripts(html);
  const records = [];
  for (const script of scripts) {
    for (const segment of extractBalancedJsonSegments(script.content)) {
      const normalizedSegment = segment.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
      const parsed = safeJsonParse(normalizedSegment);
      if (!parsed) continue;
      const objects = collectJobObjects(parsed);
      for (const jobObject of objects) {
        const record = objectToJobRecord(jobObject, pageUrl, source);
        if (record) records.push(record);
      }
    }
  }
  return records;
}

function parseGenericCareersPage(html, pageUrl, source) {
  const records = uniqueBy(
    [
      ...extractJsonLdJobs(html, pageUrl, source),
      ...extractEmbeddedJsonJobs(html, pageUrl, source),
      ...extractCardRecords(html, pageUrl, source),
      ...extractAnchorRecords(html, pageUrl, source)
    ].filter(Boolean),
    (job) => `${job.title.toLowerCase()}::${job.apply_url.toLowerCase()}`
  );

  return {
    jobs: records,
    links: extractLinks(html, pageUrl),
    scripts: extractJsonScripts(html)
  };
}

async function scrapeGenericCareersPage(source) {
  const response = await fetch(source.source_url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.source_url}`);
  }

  const html = await response.text();
  return parseGenericCareersPage(html, source.source_url, source).jobs;
}

module.exports = {
  parseGenericCareersPage,
  scrapeGenericCareersPage,
  extractLinks,
  extractJsonScripts,
  extractEmbeddedJsonJobs
};
