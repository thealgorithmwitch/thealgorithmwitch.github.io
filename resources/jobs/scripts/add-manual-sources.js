#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");

const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

const MISSING_ORGS = [
  { id: "apen4ej", org: "APEN", url: "https://apen4ej.org/about/jobs/" },
  { id: "youth-vs-apocalypse", org: "Youth Vs. Apocalypse", url: "https://www.youthvsapocalypse.org/" },
  { id: "bullard-center", org: "Bullard Center for Environmental and Climate Justice", url: "https://bullardcenter.org/" },
  { id: "conservation-international", org: "Conservation International", url: "https://www.conservation.org/about/careers" },
  { id: "rocky-mountain-institute", org: "Rocky Mountain Institute", url: "https://rmi.org/careers/" },
  { id: "the-climate-group", org: "The Climate Group", url: "https://www.theclimategroup.org/jobs" },
  { id: "rainforest-action-network", org: "Rainforest Action Network", url: "https://www.ran.org/jobs/" },
  { id: "citizens-climate-lobby", org: "Citizen's Climate Lobby", url: "https://citizensclimatelobby.org/about-ccl/careers/" },
  { id: "amazon-watch", org: "Amazon Watch", url: "https://amazonwatch.org/about/jobs" },
  { id: "appalachian-voices", org: "Appalachian Voices", url: "https://appvoices.org/jobs/" },
  { id: "bluegreen-alliance", org: "BlueGreen Alliance", url: "https://www.bluegreenalliance.org/about/jobs/" },
  { id: "emerald-cities-collaborative", org: "Emerald Cities Collaborative", url: "https://emeraldcities.org/jobs/" },
  { id: "extinction-rebellion", org: "Extinction Rebellion", url: "https://rebellion.global/" },
  { id: "partnership-for-public-good", org: "Partnership for Public Good", url: "https://ppgbuffalo.org/" },
  { id: "power-forward-communities", org: "Power Forward Communities", url: "https://powerforwardcommunities.org/" },
  { id: "the-solutions-project", org: "The Solutions Project", url: "https://thesolutionsproject.org/careers/" },
  { id: "urban-habitat", org: "Urban Habitat", url: "https://urbanhabitat.org/about/jobs/" },
  { id: "black-girl-environmentalist", org: "Black Girl Environmentalist", url: "https://www.blackgirlenvironmentalist.org/" },
  { id: "re-volv", org: "RE-volv", url: "https://re-volv.org/careers/" },
];

const EXISTING_ORG_UPDATES = {
  "climate-justice-alliance": { url: "https://climatejusticealliance.org/jobs/" },
  "we-act-for-environmental-justice": { url: "https://www.weact.org/about/employment/" },
  "movement-generation": { url: "https://movementgeneration.org/" },
  "jobs-to-move-america": { url: "https://jobstomoveamerica.org/careers/" },
  "california-environmental-justice-alliance": { url: "https://ceja.org/jobs/" },
  "deep-south-center-for-environmental-justice": { url: "https://dscej.org/" },
  "conservation-law-foundation": { url: "https://www.clf.org/about/jobs/" },
  "climate-reality-project": { url: "https://www.climaterealityproject.org/careers" },
  "elevate-energy": { url: "https://www.elevateenergy.org/careers/" },
  "earthworks": { url: "https://earthworks.org/jobs/" },
  "fresh-energy": { url: "https://fresh-energy.org/careers/" },
  "southern-alliance-for-clean-energy": { url: "https://cleanenergy.org/jobs/" },
};

function makeManualSource(org, url) {
  const id = org.id;
  return {
    id,
    organization: org.org,
    type: "custom",
    parser_enabled: false,
    enabled: true,
    trusted: false,
    auto_publish: false,
    source_url: org.url,
    source_classification: "manual_review_community",
    notes: `Manual editorial source: ${org.org}. No ATS parser configured — jobs reviewed editorially.`,
    custom_sync_enabled: true,
    requires_browser: false,
    crawl_depth: 1,
    quality_mode: "pending",
    manual_review_required: true,
    community_submission: false
  };
}

async function main() {
  // === Read current sources ===
  const raw = await fs.readFile(path.join(ROOT, "sources.json"), "utf8");
  const data = JSON.parse(raw);
  const sources = data.sources;
  const existingIds = new Set(sources.map(s => s.id));

  // === Add missing orgs ===
  const added = [];
  for (const org of MISSING_ORGS) {
    if (existingIds.has(org.id)) {
      console.log(`SKIP (exists): ${org.org} (${org.id})`);
      continue;
    }
    sources.push(makeManualSource(org, org.url));
    added.push(org);
    console.log(`ADDED: ${org.org} (${org.id})`);
  }

  // === Update existing org URLs ===
  const updated = [];
  for (const source of sources) {
    const update = EXISTING_ORG_UPDATES[source.id];
    if (update && update.url && source.source_url !== update.url) {
      console.log(`UPDATE: ${source.organization} URL: ${source.source_url} -> ${update.url}`);
      source.source_url = update.url;
      source.url = update.url;
      updated.push(source.id);
    }
  }

  // === Write back ===
  data.sources = sources;
  await fs.writeFile(path.join(ROOT, "sources.json"), JSON.stringify(data, null, 2) + "\n", "utf8");

  // === Generate import report ===
  const importReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total_sources_before: existingIds.size,
      total_added: added.length,
      total_updated_urls: updated.length,
      total_sources_after: existingIds.size + added.length
    },
    additions: added.map(o => ({
      id: o.id, organization: o.org, source_url: o.url,
      classification: "manual_review_community", parser: "none",
      manual_review_created: true, pending_candidates: false
    })),
    url_updates: updated.map(id => ({ id, new_url: EXISTING_ORG_UPDATES[id].url })),
    notes: [
      "All new sources classified as manual_review_community with manual_review_required=true",
      "No ATS parser detected — jobs require editorial review",
      "Sources are enabled in sync-custom for freshness tracking",
      "Discovery scraping will attempt to find job links; results enter pending for review"
    ]
  };

  await fs.writeFile(
    path.join(REPORTS, "manual-editorial-source-import.json"),
    JSON.stringify(importReport, null, 2) + "\n", "utf8"
  );

  // === Generate missing-source-verification report ===
  const allOrgs = [
    ...MISSING_ORGS.map(o => ({ id: o.id, org: o.org, url: o.url, status: "added", existed: false })),
    ...Object.entries(EXISTING_ORG_UPDATES).map(([id, cfg]) => {
      const s = sources.find(x => x.id === id);
      return { id, org: s?.organization || id, url: cfg.url, status: s ? "updated_url" : "not_found", existed: true };
    })
  ];

  const verificationReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total_orgs_verified: allOrgs.length,
      ats_detected: allOrgs.filter(o => o.id.includes("greenhouse") || o.id.includes("lever") || o.id.includes("ashby")).length,
      manual_editorial: allOrgs.filter(o => !o.id.includes("greenhouse") && !o.id.includes("lever") && !o.id.includes("ashby")).length,
      fetch_status: "pending_initial_sync",
      manual_review_fallback: allOrgs.length,
      pending_candidates_created: 0,
      recommended_next_step: "Run sync-custom to discover jobs; manually review and promote qualifying roles to pending"
    },
    organizations: allOrgs.map(o => ({
      organization: o.org,
      source_url: o.url,
      ats_detected: false,
      parser: "none",
      classification: "manual_review_community",
      fetch_status: "not_yet_synced",
      jobs_detected: 0,
      manual_review_fallback_created: true,
      pending_candidates_created: false,
      recommended_next_step: "Run sync-custom, then manually review discovered job links"
    }))
  };

  await fs.writeFile(
    path.join(REPORTS, "missing-source-verification.json"),
    JSON.stringify(verificationReport, null, 2) + "\n", "utf8"
  );

  console.log(JSON.stringify({
    phase: "add-manual-sources",
    total_added: added.length,
    total_updated_urls: updated.length,
    total_sources: sources.length
  }, null, 2));
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
