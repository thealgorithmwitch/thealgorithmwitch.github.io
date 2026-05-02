const { SCRAPE_REPORT_FILE, readJson, writeJson } = require("./job-utils");

function sanitizeReport(report = {}) {
  return {
    source_id: String(report.source_id || "").trim(),
    source_name: String(report.source_name || "").trim(),
    source_url: String(report.source_url || "").trim(),
    detected_ats_provider: String(report.detected_ats_provider || "").trim(),
    parser_used: String(report.parser_used || "").trim(),
    pages_checked: Array.isArray(report.pages_checked) ? report.pages_checked : [],
    links_discovered: Array.isArray(report.links_discovered) ? report.links_discovered : [],
    job_links_found: Array.isArray(report.job_links_found) ? report.job_links_found : [],
    jobs_parsed: Number(report.jobs_parsed || 0),
    review_ready: Number(report.review_ready || 0),
    needs_cleanup: Number(report.needs_cleanup || 0),
    rejected_noise: Number(report.rejected_noise || 0),
    reason_for_zero_results: String(report.reason_for_zero_results || "").trim(),
    browser_fallback_recommended: Boolean(report.browser_fallback_recommended),
    generated_at: String(report.generated_at || new Date().toISOString()),
    errors: Array.isArray(report.errors) ? report.errors : [],
    rejected_reasons:
      report.rejected_reasons && typeof report.rejected_reasons === "object" && !Array.isArray(report.rejected_reasons)
        ? report.rejected_reasons
        : {}
  };
}

async function upsertScrapeReports(reports = []) {
  const existing = await readJson(SCRAPE_REPORT_FILE, { generated_at: "", sources: [] });
  const bySourceId = new Map();

  for (const report of Array.isArray(existing.sources) ? existing.sources : []) {
    const sanitized = sanitizeReport(report);
    if (sanitized.source_id) {
      bySourceId.set(sanitized.source_id, sanitized);
    }
  }

  for (const report of reports) {
    const sanitized = sanitizeReport(report);
    if (sanitized.source_id) {
      bySourceId.set(sanitized.source_id, sanitized);
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    sources: Array.from(bySourceId.values()).sort((a, b) => a.source_name.localeCompare(b.source_name))
  };

  await writeJson(SCRAPE_REPORT_FILE, payload);
  return payload;
}

module.exports = {
  sanitizeReport,
  upsertScrapeReports
};
