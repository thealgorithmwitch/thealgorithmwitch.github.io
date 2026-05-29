const { toAbsoluteUrl } = require("../base-utils");

function stringifySafe(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch (_) { return ""; }
  }
  return String(value);
}

async function scrapeEnergyPolicyInstitute(source) {
  const url = source.source_url || source.url;
  console.log(`[scrape-epi] Fetching ${source.organization} from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.organization}`);
  }

  const html = await response.text();
  const jobs = [];

  const knownTitles = ["Data Engineer", "Research Manager", "Research Fellow"];

  for (const title of knownTitles) {
    if (html.includes(title)) {
      jobs.push({
        id: `${source.organization}-${title.toLowerCase().replace(/\s+/g, "-")}`,
        external_id: `epi_${source.id}_${title.toLowerCase().replace(/\s+/g, "-")}`,
        title: stringifySafe(title),
        organization: source.organization,
        location: "Washington, DC",
        job_type: "Full-time",
        sector: source.sector,
        function: title.includes("Engineer") ? "Data/Engineering" : title.includes("Research Manager") ? "Research" : "Research",
        workplace_type: "",
        salary: "",
        source: "Energy & Policy Institute",
        source_url: url,
        apply_url: url,
        date_posted: new Date().toISOString().slice(0, 10),
        raw_description: "",
        description: `Position: ${title}. Apply via Google Form at ${url}. Email admin@energyandpolicy.org with questions.`,
        tags: [source.sector, "energy-policy-institute"],
        shared_by: "Custom Scraper",
        notes: "Scraped from Energy & Policy Institute careers page.",
        raw_payload: { title }
      });
    }
  }

  console.log(`[scrape-epi] ${source.organization}: found ${jobs.length} jobs.`);
  return jobs;
}

module.exports = { scrapeEnergyPolicyInstitute };
