const { readFileSync, writeFileSync } = require("fs");
const { parseSalaryRange, extractMultiLocationSalaryRanges, stripHtml } = require("./job-normalizer");

const PENDING_FILE = __dirname + "/../pending-synced-jobs.json";

function readPending() {
  const raw = readFileSync(PENDING_FILE, "utf-8");
  return JSON.parse(raw);
}

function writePending(jobs) {
  writeFileSync(PENDING_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return html;
}

function extractMetaDescription(html) {
  const match = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*\/?>/i);
  return match ? match[1].trim() : "";
}

function extractPaylocityDescription(html) {
  const ogDesc = extractMetaDescription(html);
  if (ogDesc && ogDesc.length > 50) return ogDesc;
  const patterns = [
    /<div[^>]*class=["'][^"']*job-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*job-listing-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1].trim().length > 100) return match[1].trim();
  }
  return ogDesc || "";
}

function extractEarthjusticeDescription(html) {
  const flHtmlSections = [];
  const regex = /<div class="fl-html">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const content = match[1].trim();
    if (content.length > 50) flHtmlSections.push(content);
  }
  if (flHtmlSections.length >= 3) return flHtmlSections.join("\n\n");
  const ogDesc = extractMetaDescription(html);
  if (ogDesc && ogDesc.length > 100) return ogDesc;
  const ldMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const desc = ld.description || (ld["@graph"] && ld["@graph"][0] && ld["@graph"][0].description) || "";
      if (desc && desc.length > 100) return desc;
    } catch {}
  }
  return flHtmlSections.length ? flHtmlSections.join("\n\n") : "";
}

function extractGeneralDescription(html) {
  const ogDesc = extractMetaDescription(html);
  if (ogDesc && ogDesc.length > 100) return ogDesc;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const text = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "").replace(/<header[\s\S]*?<\/header>/gi, "").trim();
    if (text.length > 500) return text;
  }
  return ogDesc || "";
}

function updateSalaryFields(job, fullDescription) {
  const stripped = stripHtml(fullDescription);
  const mlResult = extractMultiLocationSalaryRanges(stripped);
  if (mlResult && mlResult.salary_visible) {
    job.salary = mlResult.salary;
    job.salary_min = mlResult.salary_min;
    job.salary_max = mlResult.salary_max;
    job.salary_currency = mlResult.salary_currency || "USD";
    job.salary_period = mlResult.salary_period || "yearly";
    job.salary_visible = true;
    job.pay_parse_source = "enriched_description";
    job.pay_parse_confidence = "high";
    job.raw_salary = mlResult.salary;
    return;
  }
  const parsed = parseSalaryRange(stripped);
  if (parsed && parsed.salary) {
    job.salary = parsed.salary;
    job.salary_min = parsed.salary_min;
    job.salary_max = parsed.salary_max;
    job.salary_currency = parsed.salary_currency || "USD";
    job.salary_period = parsed.salary_period || "yearly";
    job.salary_visible = parsed.salary_visible;
    job.pay_parse_source = "enriched_description";
    job.pay_parse_confidence = parsed.salary_visible ? "high" : "low";
    job.raw_salary = parsed.raw_salary || parsed.salary;
  }
}

function generateEnrichmentReport(results) {
  const lines = [];
  lines.push("Enrichment Report");
  lines.push("=".repeat(60));
  lines.push(`Total pending jobs checked: ${results.total}`);
  lines.push(`Paylocity jobs enriched: ${results.paylocityEnriched}`);
  lines.push(`Earthjustice jobs enriched: ${results.earthjusticeEnriched}`);
  lines.push(`Salaries newly found/extracted: ${results.salariesFound}`);
  lines.push("");
  for (const entry of results.details) {
    const err = entry.error ? ` ERROR=${entry.error}` : "";
    lines.push(`${String(entry.org || "").padEnd(35)} | ${String(entry.title || "").padEnd(45)} | ${entry.oldLen}->${entry.newLen} | salary=${entry.salary}${err}`);
  }
  return lines.join("\n");
}

async function main() {
  const jobs = readPending();
  const results = { total: jobs.length, paylocityEnriched: 0, earthjusticeEnriched: 0, generalEnriched: 0, salariesFound: 0, details: [] };

  for (const job of jobs) {
    const org = job.organization || "";
    const title = job.title || "";
    const sid = job.source_id || "";
    const currentDesc = (job.raw_description || job.description || "").trim();
    const isPaylocity = sid === "american-bird-conservancy" && /paylocity/i.test(job.source || "");
    const isEarthjustice = sid === "earthjustice" || org === "Earthjustice";
    if (!isPaylocity && !isEarthjustice) continue;

    let newDescription = "";
    let enriched = false;
    let enrichmentType = "general";

    try {
      const detailUrl = job.apply_url || job.source_url || job.description_source_url || "";
      if (!detailUrl) {
        results.details.push({ org, title, oldLen: currentDesc.length, newLen: 0, salary: job.salary || "", error: "no url" });
        continue;
      }

      const html = await fetchHtml(detailUrl);

      if (isPaylocity) {
        newDescription = extractPaylocityDescription(html);
        enrichmentType = "paylocity";
      } else {
        newDescription = extractEarthjusticeDescription(html);
        enrichmentType = "earthjustice";
      }

      if (newDescription && newDescription.length > currentDesc.length) {
        job.raw_description = newDescription;
        job.description = stripHtml(newDescription);
        job.description_source_url = detailUrl;
        job.pay_source_url = detailUrl;
        updateSalaryFields(job, newDescription);
        enriched = true;

        if (enrichmentType === "paylocity") results.paylocityEnriched++;
        else results.earthjusticeEnriched++;
        if (job.salary) results.salariesFound++;
      }
    } catch (error) {
      results.details.push({ org, title, oldLen: currentDesc.length, newLen: 0, salary: job.salary || "", error: error.message });
      continue;
    }

    if (enriched) {
      results.details.push({ org, title, oldLen: currentDesc.length, newLen: newDescription.length, salary: job.salary || "" });
    }
  }

  writePending(jobs);
  const report = generateEnrichmentReport(results);
  console.log(report);
  return results;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Enrichment failed:", error.message);
    process.exit(1);
  });
}

module.exports = { main, extractPaylocityDescription, extractEarthjusticeDescription, extractGeneralDescription };
