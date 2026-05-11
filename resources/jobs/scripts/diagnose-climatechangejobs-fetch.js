const fs = require("fs/promises");
const path = require("path");
const { readSources, writeJson } = require("./job-utils");
const {
  extractJsonScripts,
  parseGenericCareersPage
} = require("./scrapers/parsers/generic-careers-page");

const ROOT = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "reports", "climatechangejobs-fetch-diagnostic.json");
const REPORT_MD = path.join(ROOT, "reports", "climatechangejobs-fetch-diagnostic.md");

const URLS_TO_TEST = [
  "https://climatechangejobs.com/jobs",
  "https://climatechangejobs.com/jobs/"
];

const REQUEST_VARIANTS = [
  {
    id: "simple-15s",
    timeoutMs: 15000,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  },
  {
    id: "browser-15s",
    timeoutMs: 15000,
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FreshRolesBot/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "upgrade-insecure-requests": "1"
    }
  },
  {
    id: "browser-30s",
    timeoutMs: 30000,
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FreshRolesBot/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "upgrade-insecure-requests": "1"
    }
  }
];

const CLOUDFLARE_PATTERNS = [
  /cloudflare/i,
  /attention required/i,
  /checking your browser/i,
  /cf-browser-verification/i,
  /cf-chl-/i,
  /enable javascript and cookies/i,
  /just a moment/i
];

const JOB_SIGNAL_PATTERNS = [
  /\bjob\b/i,
  /\bjobs\b/i,
  /\bopening\b/i,
  /\bopportunities\b/i,
  /\bapply\b/i,
  /\bremote\b/i,
  /\bclimate\b/i
];

function normalizeUrl(value) {
  try {
    return new URL(String(value || "")).toString();
  } catch (_error) {
    return String(value || "").trim();
  }
}

function detectFailureKind(message = "") {
  const text = String(message || "").toLowerCase();
  if (!text) return "unknown_fetch_failure";
  if (text.includes("timeout")) return "timeout";
  if (text.includes("enotfound") || text.includes("getaddrinfo") || text.includes("dns")) return "dns";
  if (text.includes("tls") || text.includes("ssl") || text.includes("certificate")) return "tls";
  if (text.includes("fetch failed")) return "unknown_fetch_failure";
  return "unknown_fetch_failure";
}

async function fetchAttempt(url, variant) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), variant.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: variant.headers,
      signal: controller.signal
    });
    const html = await response.text();
    const parsed = parseGenericCareersPage(html, response.url || url, {
      id: "climatechangejobs",
      organization: "ClimateChangeJobs",
      source_url: url
    });
    const contentType = response.headers.get("content-type") || "";
    const scripts = extractJsonScripts(html);
    const embeddedJsonExists = scripts.some((script) => {
      const attrs = String(script.attrs || "");
      const content = String(script.content || "");
      return /application\/json|__NEXT_DATA__|__NUXT__|apollo-state|jobPosting/i.test(attrs) || /"jobPosting"|@type"\s*:\s*"JobPosting"/i.test(content);
    });
    const jsonLdExists = scripts.some((script) => /ld\+json/i.test(String(script.attrs || "")));
    const cloudflareSignals = CLOUDFLARE_PATTERNS.filter((pattern) => pattern.test(html)).map((pattern) => String(pattern));
    const htmlContainsJobSignals = JOB_SIGNAL_PATTERNS.some((pattern) => pattern.test(html));
    return {
      url,
      request_variant: variant.id,
      timeout_ms: variant.timeoutMs,
      ok: response.ok,
      status: response.status,
      status_text: response.statusText || "",
      final_url: response.url || url,
      redirected: Boolean(response.redirected),
      content_type: contentType,
      byte_length: Buffer.byteLength(html, "utf8"),
      failure_kind: response.ok ? "" : `http_${response.status}`,
      error_message: "",
      html_contains_job_signals: htmlContainsJobSignals,
      json_ld_exists: jsonLdExists,
      embedded_json_exists: embeddedJsonExists,
      cloudflare_or_bot_block_signals: cloudflareSignals,
      jobs_extracted: Array.isArray(parsed.jobs) ? parsed.jobs.length : 0,
      links_discovered: Array.isArray(parsed.links) ? parsed.links.length : 0,
      parser_selectors_used: [
        "json-ld <script>",
        "embedded JSON <script>",
        "job card blocks <li|tr|article|section|div>",
        "job links <a href>"
      ]
    };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `timeout after ${variant.timeoutMs}ms`
      : String(error?.cause?.message || error?.message || error || "unknown fetch error");
    return {
      url,
      request_variant: variant.id,
      timeout_ms: variant.timeoutMs,
      ok: false,
      status: "fetch-failed",
      status_text: "",
      final_url: url,
      redirected: false,
      content_type: "",
      byte_length: 0,
      failure_kind: detectFailureKind(message),
      error_message: message,
      html_contains_job_signals: false,
      json_ld_exists: false,
      embedded_json_exists: false,
      cloudflare_or_bot_block_signals: [],
      jobs_extracted: 0,
      links_discovered: 0,
      parser_selectors_used: [
        "json-ld <script>",
        "embedded JSON <script>",
        "job card blocks <li|tr|article|section|div>",
        "job links <a href>"
      ]
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function summarizeFindings(attempts) {
  const successful = attempts.filter((attempt) => attempt.ok);
  if (successful.some((attempt) => attempt.cloudflare_or_bot_block_signals.length || [403, 429, 503].includes(Number(attempt.status)))) {
    return "blocking_or_bot_challenge";
  }
  if (attempts.every((attempt) => attempt.failure_kind === "timeout")) {
    return "timeout";
  }
  if (attempts.every((attempt) => attempt.failure_kind === "dns")) {
    return "dns";
  }
  if (attempts.every((attempt) => attempt.failure_kind === "tls")) {
    return "tls";
  }
  if (successful.length && successful.every((attempt) => attempt.jobs_extracted === 0 && !attempt.json_ld_exists && !attempt.embedded_json_exists && !attempt.html_contains_job_signals)) {
    return "selector_drift_or_non_job_page";
  }
  if (successful.length && successful.every((attempt) => attempt.jobs_extracted === 0) && successful.some((attempt) => attempt.json_ld_exists || attempt.embedded_json_exists || attempt.html_contains_job_signals)) {
    return "selector_drift";
  }
  if (successful.length && successful.some((attempt) => attempt.jobs_extracted > 0)) {
    return "fetch_ok";
  }
  return "unknown_fetch_failure";
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push("# ClimateChangeJobs Fetch Diagnostic");
  lines.push("");
  lines.push(`- Source URL: ${payload.source_url}`);
  lines.push(`- Diagnosis: ${payload.diagnosis}`);
  lines.push(`- Pending records changed: no`);
  lines.push(`- Selector set: ${payload.parser_selectors_used.join(", ")}`);
  lines.push("");
  lines.push("## Attempts");
  lines.push("");
  for (const attempt of payload.attempts) {
    lines.push(`### ${attempt.request_variant} :: ${attempt.url}`);
    lines.push(`- final_url: ${attempt.final_url}`);
    lines.push(`- status: ${attempt.status} ${attempt.status_text}`.trim());
    lines.push(`- redirected: ${attempt.redirected}`);
    lines.push(`- failure_kind: ${attempt.failure_kind || "none"}`);
    lines.push(`- error_message: ${attempt.error_message || "(none)"}`);
    lines.push(`- content_type: ${attempt.content_type || "(none)"}`);
    lines.push(`- byte_length: ${attempt.byte_length}`);
    lines.push(`- html_contains_job_signals: ${attempt.html_contains_job_signals}`);
    lines.push(`- json_ld_exists: ${attempt.json_ld_exists}`);
    lines.push(`- embedded_json_exists: ${attempt.embedded_json_exists}`);
    lines.push(`- cloudflare_or_bot_block_signals: ${attempt.cloudflare_or_bot_block_signals.join(", ") || "(none)"}`);
    lines.push(`- jobs_extracted: ${attempt.jobs_extracted}`);
    lines.push(`- links_discovered: ${attempt.links_discovered}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const sources = await readSources();
  const source = sources.find((item) => String(item.id || "") === "climatechangejobs");
  if (!source) {
    throw new Error("Missing climatechangejobs source config");
  }

  const urls = Array.from(new Set([...URLS_TO_TEST, source.source_url].filter(Boolean).map(normalizeUrl)));
  const attempts = [];
  for (const url of urls) {
    for (const variant of REQUEST_VARIANTS) {
      attempts.push(await fetchAttempt(url, variant));
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source_id: "climatechangejobs",
    source_url: source.source_url,
    configured_urls: urls,
    parser_selectors_used: [
      "json-ld <script>",
      "embedded JSON <script>",
      "job card blocks <li|tr|article|section|div>",
      "job links <a href>"
    ],
    attempts,
    diagnosis: summarizeFindings(attempts)
  };

  await fs.mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await writeJson(REPORT_JSON, payload);
  await fs.writeFile(REPORT_MD, buildMarkdown(payload), "utf8");

  console.log(JSON.stringify(payload, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:diagnose-climatechangejobs-fetch] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
