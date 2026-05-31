#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { buildFingerprint, loadArchiveRecords, guardIncoming } = require("./archive-fingerprint-guard");

const ROOT = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "reports", "full-overhaul-verification-latest.json");
const REPORT_MD = path.join(ROOT, "reports", "full-overhaul-verification-latest.md");

function readJson(rel, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function text(value) {
  return String(value || "");
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function urls(job) {
  return [job.apply_url, job.source_url, job.original_url, job.description_source_url, job.pay_source_url].map(text).filter(Boolean);
}

function jobKey(job) {
  return `${text(job.organization).toLowerCase()}::${text(job.title).toLowerCase()}::${text(job.apply_url || job.source_url).replace(/[?#].*$/, "").toLowerCase()}`;
}

function pagePath(job) {
  const page = text(job.page_url).replace(/^\.\//, "");
  return page ? path.join(ROOT, page) : "";
}

function pass(condition, details = "") {
  return { passed: Boolean(condition), details };
}

function main() {
  const jobs = readJson("jobs.json", []);
  const pending = readJson("pending-synced-jobs.json", []);
  const records = readJson("job-records.json", []);
  const sourcesPayload = readJson("sources.json", { sources: [] });
  const sources = sourcesPayload.sources || [];
  const report = fs.existsSync(REPORT_JSON) ? JSON.parse(fs.readFileSync(REPORT_JSON, "utf8")) : { issues: {} };

  const allPublicText = [
    JSON.stringify(jobs),
    readText("index.html"),
    ...jobs.map((job) => pagePath(job)).filter(Boolean).map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
  ].join("\n");
  const allGeneratedText = [
    readText("index.html"),
    ...jobs.map((job) => pagePath(job)).filter(Boolean).map((file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
  ].join("\n");

  const seel = jobs.find((job) => job.id === "SEEL-412");
  const bullard = jobs.find((job) => /Bullard Center/i.test(job.organization));
  const montanaRecord = records.find((record) => {
    const target = record.raw_source_data || record;
    return /Montana Director of Development/i.test(target.title || "");
  });
  const montanaTarget = montanaRecord?.raw_source_data || montanaRecord || {};
  const mpu = jobs.find((job) => /Campus Video Editor Fellow/i.test(job.title));
  const advanced = pending.find((job) => /Director - Expanding Wholesale Markets/i.test(job.title));
  const greentown = pending.find((job) => /Greentown Labs/i.test(job.organization) && /Program Coordinator|Coordinator/i.test(job.title));
  const climate = pending.find((job) => /Climate Action Campaign/i.test(job.organization));
  const carbon = pending.find((job) => /Carbon Direct/i.test(job.organization) && /Staff Engineer/i.test(job.title));
  const hasi = pending.find((job) => /HA Sustainable Infrastructure Capital/i.test(job.organization) && /^Senior Associate$/i.test(job.title));
  const edfSource = sources.find((source) => source.id === "edf");

  const publicKeys = new Set(jobs.map((job) => text(job.id)));
  const pendingOverlap = pending.filter((job) => publicKeys.has(text(job.id)));
  const duplicateKeys = new Map();
  for (const job of jobs) {
    const key = jobKey(job);
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  const duplicatePublicJobs = Array.from(duplicateKeys.entries()).filter(([, count]) => count > 1);
  const archiveGuard = guardIncoming(jobs, loadArchiveRecords());

  const stalePages = fs.readdirSync(path.join(ROOT, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `./pages/${file}`);
  const expectedPages = new Set(jobs.map((job) => text(job.page_url)).filter(Boolean));
  const unexpectedPages = stalePages.filter((file) => !expectedPages.has(file) && !/^\.\/pages\/.*redirect/i.test(file));
  const missingPages = jobs.filter((job) => !pagePath(job) || !fs.existsSync(pagePath(job)));
  const pageMismatches = jobs.filter((job) => {
    const file = pagePath(job);
    if (!file || !fs.existsSync(file)) return true;
    const html = fs.readFileSync(file, "utf8");
    return !html.includes(text(job.title)) || !html.includes(text(job.organization));
  });

  const workflowFiles = fs.existsSync(path.join(ROOT, "backend", "dotgithub", "workflows"))
    ? fs.readdirSync(path.join(ROOT, "backend", "dotgithub", "workflows")).filter((file) => file.endsWith(".yml"))
    : [];
  const missingWorkflowScripts = [];
  let hasThreeDayFreshness = false;
  let buildDeployValidates = true;
  for (const file of workflowFiles) {
    const body = readText(path.join("backend", "dotgithub", "workflows", file));
    if (/30 12 \*\/3 \* \*/.test(body)) hasThreeDayFreshness = true;
    if (/jobs:build-pages/.test(body) && !/jobs:validate/.test(body) && !/jobs:validate-public-data/.test(body)) buildDeployValidates = false;
    for (const script of body.matchAll(/scripts\/[A-Za-z0-9._-]+\.js/g)) {
      if (!fs.existsSync(path.join(ROOT, script[0]))) missingWorkflowScripts.push(`${file}:${script[0]}`);
    }
  }

  const fakePublicPay = jobs.filter((job) => {
    const min = numberValue(job.salary_min);
    const max = numberValue(job.salary_max);
    const manualApproved = job.manual_pay_approved === true;
    return (
      (!manualApproved && ((min !== null && min > 500000) || (max !== null && max > 500000))) ||
      min === 0 || max === 0 || min === 6 || max === 6
    );
  });

  const validations = {
    seel_project_specialist_url: pass(seel?.apply_url === "https://seelllc.bamboohr.com/careers/412", seel?.apply_url),
    bullard_pay_parses: pass(Boolean(bullard?.salary && bullard?.salary_min && bullard?.salary_max), bullard?.salary),
    bullard_description_present: pass(text(bullard?.description).startsWith("The GIS/Research Director, Bullard Center for Environmental and Climate Justice"), text(bullard?.description).slice(0, 120)),
    tnc_montana_exact_url: pass(montanaTarget.apply_url === "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development", montanaTarget.apply_url),
    tnc_montana_not_public_closed: pass(!jobs.some((job) => /Montana Director of Development/i.test(job.title)), montanaRecord?.status || ""),
    tnc_no_public_workday_apply_urls: pass(!jobs.some((job) => /Nature Conservancy/i.test(job.organization) && urls(job).some((url) => /myworkdayjobs\.com/i.test(url))), ""),
    no_think_orphan_percent: pass(!/\bthink\s*%|\bthink%/i.test(allPublicText), ""),
    think_100_preserved: pass(/Think 100%/i.test(allPublicText), ""),
    mpu_campus_pay: pass(mpu?.salary === "$25/hr", mpu?.salary),
    renew_home_no_duplicate_remote: pass(!/Remote\s*\/\s*Remote|remote role and Remote/i.test(allGeneratedText), ""),
    emerald_removed_blocked: pass(![...jobs, ...pending].some((job) => /Emerald Cities Collaborative/i.test(job.organization)) && sources.some((source) => source.id === "emerald-cities-collaborative" && source.enabled === false), ""),
    rmi_no_public_jobs: pass(!jobs.some((job) => /Rocky Mountain Institute|^RMI$/i.test(job.organization)), ""),
    advanced_energy_starting_pay: pass(advanced?.salary === "$120,000+ / year", advanced?.salary),
    greentown_pay_range: pass(greentown?.salary === "$60,000–$68,000 / year", greentown?.salary),
    edf_source_url: pass(edfSource?.source_url === "https://www.edf.org/jobs", edfSource?.source_url),
    oxfam_public_urls: pass(!pending.some((job) => /Oxfam America/i.test(job.organization) && urls(job).some((url) => /api\.smartrecruiters\.com/i.test(url))) && pending.some((job) => /Oxfam America/i.test(job.organization) && urls(job).some((url) => /jobs\.smartrecruiters\.com/i.test(url))), ""),
    climate_action_trakstar_page_url: pass(climate?.apply_url === "https://climateactioncampaign.hire.trakstar.com/jobs/fk0z2nn/" && climate?.source_url === "https://climateactioncampaign.hire.trakstar.com/jobs/fk0z2nn/", `${climate?.apply_url} ${climate?.source_url}`),
    carbon_direct_staff_engineer_pay: pass(carbon?.salary === "$184,000–$225,000 / year", carbon?.salary),
    hasi_expected_salary_pay: pass(hasi?.salary === "$80,000–$100,000 / year", hasi?.salary),
    no_public_fake_salary: pass(fakePublicPay.length === 0, fakePublicPay.map((job) => job.id).join(", ")),
    no_duplicate_public_jobs: pass(duplicatePublicJobs.length === 0, duplicatePublicJobs.map(([key]) => key).join(", ")),
    no_public_pending_overlap: pass(pendingOverlap.length === 0, pendingOverlap.map((job) => job.id).join(", ")),
    no_archived_fingerprint_violations: pass(archiveGuard.blocked.length === 0, archiveGuard.blocked.map((item) => item.job?.id).join(", ")),
    generated_pages_match_jobs_json: pass(missingPages.length === 0 && pageMismatches.length === 0 && unexpectedPages.length === 0, `missing=${missingPages.length} mismatched=${pageMismatches.length} stale=${unexpectedPages.length}`),
    workflows_reference_existing_scripts: pass(missingWorkflowScripts.length === 0, missingWorkflowScripts.join(", ")),
    freshness_every_three_days: pass(hasThreeDayFreshness, ""),
    build_deploy_blocks_on_validation: pass(buildDeployValidates, "")
  };

  const failures = Object.entries(validations).filter(([, result]) => !result.passed);
  report.generated_at = new Date().toISOString();
  report.validations = validations;
  report.summary = {
    total: Object.keys(validations).length,
    passed: Object.keys(validations).length - failures.length,
    failed: failures.length
  };
  report.validation_summary = {
    passed: failures.length === 0,
    failure_count: failures.length,
    failed: failures.map(([name, result]) => ({ name, details: result.details }))
  };
  report.generated_pages = {
    expected: expectedPages.size,
    missing: missingPages.map((job) => job.id),
    mismatched: pageMismatches.map((job) => job.id),
    stale: unexpectedPages
  };
  report.workflow_audit = {
    files: workflowFiles,
    missing_script_references: missingWorkflowScripts,
    freshness_every_three_days: hasThreeDayFreshness,
    build_deploy_blocks_on_validation: buildDeployValidates
  };
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(REPORT_MD, renderMarkdown(report));
  if (failures.length) {
    console.error(`[full-overhaul-verify] failed validations: ${failures.map(([name]) => name).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[full-overhaul-verify] all ${Object.keys(validations).length} validations passed`);
}

function renderMarkdown(report) {
  const lines = [
    "# Full Overhaul Verification",
    "",
    `Generated: ${report.generated_at || new Date().toISOString()}`,
    "",
    `Validation status: ${report.validation_summary?.passed ? "PASS" : "FAIL"}`,
    ""
  ];
  lines.push("## Validations");
  for (const [name, result] of Object.entries(report.validations || {})) {
    lines.push(`- ${result.passed ? "PASS" : "FAIL"} ${name}${result.details ? `: ${result.details}` : ""}`);
  }
  lines.push("");
  lines.push("## Known Issues");
  for (const [name, item] of Object.entries(report.issues || {})) {
    lines.push("");
    lines.push(`### ${name}`);
    lines.push(`- Found: ${item.found_count > 0 ? "yes" : "no"} (${item.found_count})`);
    lines.push(`- Files: ${(item.files || []).join(", ") || "none"}`);
    lines.push(`- Fix applied: ${item.fix_applied || ""}`);
    lines.push(`- Parser/source rule added: ${item.parser_source_rule_added || ""}`);
    lines.push(`- Validation added: ${item.validation_added || ""}`);
    lines.push(`- Remaining unresolved: ${item.unresolved || "none"}`);
  }
  lines.push("");
  lines.push("## Workflow Audit");
  lines.push(`- Files checked: ${(report.workflow_audit?.files || []).join(", ")}`);
  lines.push(`- Missing script references: ${(report.workflow_audit?.missing_script_references || []).join(", ") || "none"}`);
  lines.push(`- Freshness every 3 days: ${report.workflow_audit?.freshness_every_three_days ? "yes" : "no"}`);
  lines.push(`- Build/deploy validates: ${report.workflow_audit?.build_deploy_blocks_on_validation ? "yes" : "no"}`);
  return `${lines.join("\n")}\n`;
}

if (require.main === module) main();
