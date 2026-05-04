const { deriveProviderSource, fetchAtsJobsByProvider } = require("../ats-clients");
const { parseGenericCareersPage, extractLinks, extractJsonScripts } = require("./parsers/generic-careers-page");
const { normalizeProvider } = require("../source-utils");
const { toAbsoluteUrl } = require("./base-utils");

const DISCOVERY_KEYWORDS = [
  "careers",
  "jobs",
  "openings",
  "opportunities",
  "employment",
  "join-us",
  "work-with-us",
  "greenhouse",
  "lever",
  "ashby",
  "bamboohr",
  "workable",
  "smartrecruiters"
];

const ATS_PATTERNS = {
  greenhouse: [/greenhouse\.io/i, /boards-api\.greenhouse\.io/i, /gh_jid/i, /grnhse/i],
  lever: [/lever\.co/i, /jobs\.lever\.co/i, /api\.lever\.co/i],
  ashby: [/ashbyhq\.com/i],
  workable: [/workable\.com/i],
  bamboohr: [/bamboohr\.com\/careers/i],
  smartrecruiters: [/smartrecruiters\.com/i],
  jazzhr: [/jazzhr\.com/i],
  breezyhr: [/breezy\.hr/i],
  paylocity: [/paylocity/i, /recruiting\.paylocity\.com/i],
  ukg: [/\bukg\b/i, /ultipro/i],
  icims: [/icims\.com/i],
  jobvite: [/jobvite\.com/i],
  rippling: [/rippling\.com/i],
  recruitee: [/recruitee\.com/i],
  teamtailor: [/teamtailor\.com/i],
  pinpoint: [/pinpoint/i],
  workday: [/workdayjobs\.com/i, /myworkdayjobs\.com/i],
  adp: [/workforcenow\.adp\.com/i],
  comeet: [/comeet\.com/i]
};

function detectAtsProvider(text) {
  const haystack = String(text || "");
  for (const [provider, patterns] of Object.entries(ATS_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(haystack))) {
      return provider;
    }
  }
  return "";
}

function filterDiscoveryLinks(links, sourceUrl) {
  return links
    .map((link) => ({
      url: toAbsoluteUrl(sourceUrl, link.url || link.href || ""),
      text: String(link.text || "").trim()
    }))
    .filter((link) => link.url)
    .filter((link) => DISCOVERY_KEYWORDS.some((keyword) => link.url.toLowerCase().includes(keyword) || link.text.toLowerCase().includes(keyword)));
}

function findAtsUrls(html, pageUrl) {
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>]+/gi,
    /(?:src|href)=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const candidate = toAbsoluteUrl(pageUrl, match[1] || match[0]);
      if (!candidate) continue;
      if (detectAtsProvider(candidate)) urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function canAttemptDirectAts(provider, source, currentUrl) {
  const normalizedProvider = normalizeProvider(provider || source.provider || source.type);
  if (!normalizedProvider) return false;
  if (normalizeProvider(source.provider || source.type) === normalizedProvider) return true;
  return detectAtsProvider(currentUrl) === normalizedProvider;
}

function browserFallbackRecommended(html, scripts, jobsFound) {
  if (jobsFound > 0) return false;
  const scriptCount = Array.isArray(scripts) ? scripts.length : 0;
  return (
    /__NEXT_DATA__|__NUXT__|webpack|react-root|data-reactroot|hydration|root-render|vite/i.test(html) &&
    scriptCount >= 4
  );
}

async function fetchHtmlPage(url) {
  const response = await fetch(url);
  const html = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    html
  };
}

function getDirectAtsSkipReason(provider, source, context = {}) {
  const normalizedProvider = normalizeProvider(provider || source.provider || source.type);
  if (!normalizedProvider) return "";
  const derivedSource = deriveProviderSource(source, normalizedProvider, context);
  if (normalizedProvider === "greenhouse" && !String(derivedSource.board_token || "").trim()) {
    return "missing Greenhouse board slug.";
  }
  if (normalizedProvider === "lever" && !String(derivedSource.company_slug || "").trim()) {
    return "missing Lever company slug.";
  }
  return "";
}

function makeEmptyReport(source) {
  return {
    source_id: source.id,
    source_name: source.organization || source.name || source.id,
    source_url: source.source_url,
    detected_ats_provider: "",
    parser_used: "",
    pages_checked: [],
    links_discovered: [],
    job_links_found: [],
    jobs_parsed: 0,
    reason_for_zero_results: "",
    browser_fallback_recommended: false,
    generated_at: new Date().toISOString(),
    errors: []
  };
}

async function scrapeSourceWithDiscovery(source) {
  const report = makeEmptyReport(source);
  const normalizedProvider = normalizeProvider(source.provider);
  const queue = [{ url: source.source_url, depth: 0 }];
  const visited = new Set();
  const allJobs = [];
  const discoveredLinks = [];
  let atsDetection = normalizedProvider;
  let directAtsAttempted = false;
  let directAtsError = "";

  while (queue.length) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;
    visited.add(current.url);

    let page;
    try {
      page = await fetchHtmlPage(current.url);
    } catch (error) {
      report.pages_checked.push({
        url: current.url,
        depth: current.depth,
        status: "fetch-failed",
        error: error.message
      });
      report.errors.push(`${current.url}: ${error.message}`);
      continue;
    }

    report.pages_checked.push({
      url: current.url,
      depth: current.depth,
      status: page.status
    });

    if (!page.ok) {
      report.errors.push(`${current.url}: HTTP ${page.status}`);
      continue;
    }

    const pageProvider = detectAtsProvider(current.url);
    if (!atsDetection && pageProvider) {
      atsDetection = pageProvider;
    }

    const atsUrls = findAtsUrls(page.html, current.url);
    if (!atsDetection && atsUrls.length) {
      atsDetection = detectAtsProvider(atsUrls.join("\n"));
    }

    if (atsDetection && !directAtsAttempted && canAttemptDirectAts(atsDetection, source, current.url)) {
      directAtsAttempted = true;
      const skipReason = getDirectAtsSkipReason(atsDetection, source, {
        pageUrl: current.url,
        html: page.html
      });
    if (skipReason) {
      directAtsError = skipReason;
      report.errors.push(`ats:${atsDetection}: ${skipReason}`);
      report.detected_ats_provider = atsDetection;
      report.parser_used = `skipped:ats:${atsDetection}`;
      report.reason_for_zero_results = `Skipped configured ${atsDetection} source: ${skipReason}`;
      console.warn(`[jobs:sync-custom] Skipping ${source.organization || source.id}: ${skipReason}`);
    
      if (normalizedProvider) {
        return { jobs: [], report };
      }
    
      continue;
    }
      try {
        const atsJobs = await fetchAtsJobsByProvider(atsDetection, source, {
          pageUrl: current.url,
          html: page.html
        });
        if (atsJobs.length) {
          report.detected_ats_provider = atsDetection;
          report.parser_used = `ats:${atsDetection}`;
          report.jobs_parsed = atsJobs.length;
          report.job_links_found = atsJobs.map((job) => job.apply_url).filter(Boolean).slice(0, 100);
          return { jobs: atsJobs, report };
        }
      } catch (error) {
        directAtsError = error.message;
        report.errors.push(`ats:${atsDetection}: ${error.message}`);
      }
    }

    const parsed = parseGenericCareersPage(page.html, current.url, source);
    const pageJobs = parsed.jobs || [];
    const pageLinks = parsed.links || extractLinks(page.html, current.url);
    const scripts = parsed.scripts || extractJsonScripts(page.html);
    const candidateLinks = filterDiscoveryLinks(pageLinks, current.url);

    report.links_discovered.push(...candidateLinks.map((link) => link.url));
    report.job_links_found.push(...pageJobs.map((job) => job.apply_url));
    allJobs.push(...pageJobs);

    discoveredLinks.push(...candidateLinks);
    if (current.depth < Number(source.crawl_depth || 1)) {
      for (const link of candidateLinks) {
        if (!visited.has(link.url)) {
          queue.push({ url: link.url, depth: current.depth + 1 });
        }
      }
      for (const atsUrl of atsUrls) {
        if (!visited.has(atsUrl)) {
          queue.push({ url: atsUrl, depth: current.depth + 1 });
        }
      }
    }

    report.browser_fallback_recommended = report.browser_fallback_recommended || browserFallbackRecommended(page.html, scripts, pageJobs.length);
  }

  const dedupedJobs = [];
  const seen = new Set();
  for (const job of allJobs) {
    const key = `${String(job.title || "").toLowerCase()}::${String(job.apply_url || "").toLowerCase()}`;
    if (!job?.title || !job?.organization || !job?.apply_url || seen.has(key)) continue;
    seen.add(key);
    dedupedJobs.push(job);
  }

  report.detected_ats_provider = atsDetection;
  report.parser_used = dedupedJobs.length ? "generic:discovery" : atsDetection ? `generic-after-ats:${atsDetection}` : "generic:discovery";
  report.links_discovered = Array.from(new Set(report.links_discovered)).slice(0, 200);
  report.job_links_found = Array.from(new Set(report.job_links_found)).slice(0, 200);
  report.jobs_parsed = dedupedJobs.length;

  if (!dedupedJobs.length) {
    const allFetchFailed =
      report.pages_checked.length > 0 &&
      report.pages_checked.every((page) => page.status === "fetch-failed" || Number(page.status) >= 400);
    if (atsDetection && directAtsError) {
      report.reason_for_zero_results = `Detected ${atsDetection} but direct route failed: ${directAtsError}`;
    } else if (allFetchFailed) {
      report.reason_for_zero_results = "All discovered pages failed to fetch.";
    } else if (atsDetection) {
      report.reason_for_zero_results = `Detected ${atsDetection} but no jobs were returned from direct or generic parsing.`;
    } else if (!report.pages_checked.length) {
      report.reason_for_zero_results = "No pages could be fetched.";
    } else if (report.browser_fallback_recommended && !source.requires_browser) {
      report.reason_for_zero_results = "Static scraping found no jobs and the page looks JS-rendered.";
    } else if (!report.links_discovered.length) {
      report.reason_for_zero_results = "No likely careers or jobs links were discovered from the provided page.";
    } else {
      report.reason_for_zero_results = "Discovery links were checked but no parseable job listings were found.";
    }
  }

  return {
    jobs: dedupedJobs,
    report
  };
}

module.exports = {
  detectAtsProvider,
  scrapeSourceWithDiscovery
};
