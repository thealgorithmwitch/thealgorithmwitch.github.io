const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const RECORDS_FILE = path.join(ROOT, "job-records.json");
const PENDING_FILE = path.join(ROOT, "pending-synced-jobs.json");
const REPORT_JSON = path.join(ROOT, "reports", "jobs-json-quality-audit-latest.json");
const REPORT_MD = path.join(ROOT, "reports", "jobs-json-quality-audit-latest.md");

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (e) {
    console.error(`Error reading ${fp}: ${e.message}`);
    return [];
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getField(record, field, sourceFile) {
  if (sourceFile === "job-records.json") {
    const display = record.display || {};
    if (field === "workplace_type") {
      return display.location_type || "";
    }
    if (field === "apply_url") {
      return display.application_url || "";
    }
    if (field === "salary") {
      const pd = display.pay_display || "";
      return typeof pd === "string" ? pd : "";
    }
    if (field === "raw_salary") {
      return "";
    }
    if (field === "external_id") {
      return "";
    }
    if (field === "manual_pay_approved") {
      return "";
    }
    if (field === "description") {
      return display.description || "";
    }
    if (field === "source_url") {
      return display.source_url || "";
    }
    if (field === "title") {
      return display.title || "";
    }
    if (field === "organization") {
      return display.organization || "";
    }
    if (field === "location") {
      return display.location || record.location || "";
    }
    if (field === "job_type") {
      return display.role_type || "";
    }
    if (field === "id") {
      return record.id || "";
    }
    return display[field] !== undefined ? display[field] : record[field] || "";
  }
  const v = record[field];
  return v !== undefined && v !== null ? v : "";
}

function str(val) {
  return String(val || "").trim();
}

function norm(val) {
  return str(val).toLowerCase();
}

// ── Helpers ──────────────────────────────────────────────

function checkWorkModeLocationRedundancy(records, sourceFile) {
  const findings = [];
  for (const r of records) {
    const loc = str(getField(r, "location", sourceFile));
    const wt = str(getField(r, "workplace_type", sourceFile));
    const desc = str(getField(r, "description", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    const concatLoc = loc + " / " + loc;
    const wtLower = norm(wt);
    const locLower = norm(loc);

    const redundantPatterns = [
      { pattern: "remote / remote", label: "Remote / Remote" },
      { pattern: "hybrid / hybrid", label: "Hybrid / Hybrid" },
      { pattern: "on-site / on-site", label: "On-site / On-site" },
      { pattern: "on site / on site", label: "On-site / On-site" },
    ];
    for (const { pattern, label } of redundantPatterns) {
      if (locLower.includes(pattern)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: `Redundant location concatenation: "${label}"`,
          field: "location",
          value: loc,
        });
      }
    }

    if (wtLower && locLower && wtLower === locLower) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: `workplace_type and location are identical: "${wt}"`,
        field: "workplace_type / location",
        value: `wt="${wt}" loc="${loc}"`,
      });
    }

    const dlow = norm(desc);
    const descRedundancies = [
      { pattern: "this is a remote role and remote", label: "remote" },
      { pattern: "this is a hybrid role and hybrid", label: "hybrid" },
      { pattern: "this is an on-site role and on-site", label: "on-site" },
      { pattern: "this is an on site role and on site", label: "on-site" },
      { pattern: "this is a remote role and this is a remote", label: "remote" },
    ];
    for (const { pattern, label } of descRedundancies) {
      if (dlow.includes(pattern)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: `Redundant work mode phrase in description: "${label} role and ${label}"`,
          field: "description",
          snippet: desc.substring(0, 200),
        });
      }
    }
  }
  return findings;
}

function checkDeadClosedRoles(records, sourceFile) {
  const findings = [];
  const deadPatterns = [
    "on hold", "no longer accepting", "applications closed", "position filled",
    "role closed", "page not found", "access denied", "unauthorized",
    "forbidden", "candidate login", "login page", "new search", "benefits",
    "procurement", "view our benefits", "careers landing page", "404",
  ];
  const deadUrlPatterns = ["/404", "not-found", "/error", "page-not-found"];
  for (const r of records) {
    const desc = norm(getField(r, "description", sourceFile));
    const su = norm(getField(r, "source_url", sourceFile));
    const au = norm(getField(r, "apply_url", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    for (const pat of deadPatterns) {
      if (desc.includes(pat)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: `Dead/closed signal in description: "${pat}"`,
          field: "description",
          snippet: str(getField(r, "description", sourceFile)).substring(0, 200),
        });
        break;
      }
    }

    for (const url of [su, au]) {
      for (const pat of deadUrlPatterns) {
        if (url.includes(pat)) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: `404/dead signal in URL: "${pat}"`,
            field: url === su ? "source_url" : "apply_url",
            value: str(getField(r, url === su ? "source_url" : "apply_url", sourceFile)),
          });
          break;
        }
      }
    }
  }
  return findings;
}

function checkFakeInvalidPay(records, sourceFile) {
  const findings = [];
  for (const r of records) {
    const salary = str(getField(r, "salary", sourceFile));
    const rawSalary = str(getField(r, "raw_salary", sourceFile));
    const manualApproved = str(getField(r, "manual_pay_approved", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    if (salary) {
      const numSal = parseFloat(salary.replace(/[$,£€¥]/g, ""));
      if (!isNaN(numSal)) {
        if (numSal > 500000 && !manualApproved) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: `Salary > $500K without manual_pay_approved: ${salary}`,
            field: "salary",
            value: salary,
          });
        }
        if (numSal === 0) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: "Salary = 0",
            field: "salary",
            value: salary,
          });
        }
        if (numSal === 6) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: "Salary = 6 (likely placeholder)",
            field: "salary",
            value: salary,
          });
        }
      }
    }

    if (rawSalary) {
      if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(rawSalary)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: "raw_salary contains UUID",
          field: "raw_salary",
          value: rawSalary.substring(0, 150),
        });
      }
      if (/\d{4}-\d{2}-\d{2}/.test(rawSalary)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: "raw_salary contains date pattern",
          field: "raw_salary",
          value: rawSalary.substring(0, 150),
        });
      }
      if (/%/.test(rawSalary)) {
        findings.push({
          file: sourceFile,
          id,
          title,
          organization: org,
          issue: "raw_salary contains percentage",
          field: "raw_salary",
          value: rawSalary.substring(0, 150),
        });
      }
      if (/^[^$£€¥\d]*$/.test(rawSalary.replace(/\s/g, "")) && rawSalary.length > 5) {
        const alphaRatio = (rawSalary.match(/[a-zA-Z]/g) || []).length / rawSalary.length;
        if (alphaRatio > 0.5 && rawSalary.length > 10) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: "raw_salary appears to be prose/description, not pay data",
            field: "raw_salary",
            value: rawSalary.substring(0, 150),
          });
        }
      }
      const multiComma = (rawSalary.match(/,/g) || []).length;
      if (multiComma >= 2) {
        const num = parseFloat(rawSalary.replace(/[$,£€¥\s]/g, ""));
        if (!isNaN(num) && num > 1000000) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: `raw_salary has inflated number with commas: ${rawSalary}`,
            field: "raw_salary",
            value: rawSalary.substring(0, 150),
          });
        }
      }
    }
  }
  return findings;
}

function checkBadGenericJobLinks(records, sourceFile) {
  const findings = [];
  const genericBoardPatterns = [
    "indeed.com", "linkedin.com/jobs", "glassdoor.com",
    "monster.com", "ziprecruiter.com", "simplyhired.com",
    "careerbuilder.com", "dice.com", "google.com/jobs",
  ];
  for (const r of records) {
    const su = norm(getField(r, "source_url", sourceFile));
    const au = norm(getField(r, "apply_url", sourceFile));
    const extId = str(getField(r, "external_id", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    for (const urlLabel of [{ url: su, label: "source_url" }, { url: au, label: "apply_url" }]) {
      if (!urlLabel.url) continue;
      for (const pat of genericBoardPatterns) {
        if (urlLabel.url.includes(pat)) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: `Generic job board URL: "${pat}"`,
            field: urlLabel.label,
            value: str(getField(r, urlLabel.label, sourceFile)),
          });
          break;
        }
      }
    }

    if (su.includes("bamboohr.com/careers") && !extId && !su.match(/\/careers\/?\d+/)) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: "Generic BambooHR careers URL without job-specific ID in URL or external_id",
        field: "source_url",
        value: str(getField(r, "source_url", sourceFile)),
      });
    }

    if (su.includes("myworkdayjobs.com") && su.includes("/apply/")) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: "Workday /apply/ URL in source_url",
        field: "source_url",
        value: str(getField(r, "source_url", sourceFile)),
      });
    }
    if (au.includes("myworkdayjobs.com") && au.includes("/apply/")) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: "Workday /apply/ URL in apply_url",
        field: "apply_url",
        value: str(getField(r, "apply_url", sourceFile)),
      });
    }
  }
  return findings;
}

function checkDescriptionProblems(records, sourceFile) {
  const findings = [];
  for (const r of records) {
    const desc = str(getField(r, "description", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    if (!desc) continue;

    if (/viewBox/i.test(desc) || /<svg/i.test(desc) || /<span[> ]/i.test(desc) || /<div[> ]/i.test(desc) || /<style/i.test(desc)) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: "Raw HTML tags in description (viewBox, svg, span, div, style)",
        field: "description",
        snippet: desc.substring(0, 200),
      });
    }

    const multiRoleIndicators = [
      "also hiring", "positions include", "open positions", "we are looking for a",
      "we are seeking a", "we are hiring for", "multiple positions",
    ];
    let multiHits = 0;
    const dlow = norm(desc);
    for (const ind of multiRoleIndicators) {
      if (dlow.includes(ind)) multiHits++;
    }
    if (multiHits >= 3) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: `Description appears to list multiple roles (${multiHits} multi-role indicators)`,
        field: "description",
        snippet: desc.substring(0, 300),
      });
    }

    const wrongSectionIndicators = [
      "about us", "about the company", "company overview",
      "our mission", "we are a", "about our organization",
    ];
    for (const ind of wrongSectionIndicators) {
      if (dlow.startsWith(ind) && desc.length > 150) {
        const bodyWords = dlow.replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
        const roleWords = ["you will", "this role", "this position", "responsibilities", "qualifications", "requirements", "the ideal candidate"];
        const hasRoleContent = roleWords.some(rw => dlow.includes(rw));
        if (!hasRoleContent) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: `Description starts with wrong section ("${ind}") and lacks role-specific content`,
            field: "description",
            snippet: desc.substring(0, 200),
          });
        }
        break;
      }
    }
  }
  return findings;
}

function checkStructureLoss(records, sourceFile) {
  const findings = [];
  for (const r of records) {
    const desc = str(getField(r, "description", sourceFile));
    const title = str(getField(r, "title", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    if (!desc || desc.length < 200) continue;

    if (!desc.includes("\n") && desc.length > 500) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: `Description is a single paragraph (no newlines) despite length ${desc.length} chars - structure may be lost`,
        field: "description",
        snippet: desc.substring(0, 200),
      });
    }

    if (desc.includes("•") || desc.includes("●") || desc.includes("○")) {
      const lines = desc.split("\n");
      const bulletLines = lines.filter(l => /^[•●○\*\-]\s/.test(l.trim()));
      if (bulletLines.length > 0) {
        const allSameLine = bulletLines.every(bl => {
          const idx = desc.indexOf(bl.trim());
          if (idx < 0) return true;
          const beforeNewline = idx === 0 || desc[idx - 1] === "\n";
          return beforeNewline;
        });
        if (!allSameLine) {
          findings.push({
            file: sourceFile,
            id,
            title,
            organization: org,
            issue: "Bullet points detected but some may not be on separate lines",
            field: "description",
            snippet: desc.substring(0, 200),
          });
        }
      }
    }
  }
  return findings;
}

function checkTitleLocationErrors(records, sourceFile) {
  const findings = [];
  for (const r of records) {
    const title = str(getField(r, "title", sourceFile));
    const loc = str(getField(r, "location", sourceFile));
    const org = str(getField(r, "organization", sourceFile));
    const id = str(getField(r, "id", sourceFile));

    const openParens = (title.match(/\(/g) || []).length;
    const closeParens = (title.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: `Unclosed parentheses in title (${openParens} open vs ${closeParens} close)`,
        field: "title",
        value: title,
      });
    }

    const stateOnly = ["remote", "hybrid", "on-site", "on site"];
    if (stateOnly.includes(norm(title))) {
      findings.push({
        file: sourceFile,
        id,
        title,
        organization: org,
        issue: `Title is only "${title}" - appears to be location/type rather than a job title`,
        field: "title",
        value: title,
      });
    }
  }
  return findings;
}

function checkDuplicateRecords(records, sourceFile) {
  const findings = [];
  const seen = new Map();
  for (const r of records) {
    const org = norm(getField(r, "organization", sourceFile));
    const title = norm(getField(r, "title", sourceFile));
    const loc = norm(getField(r, "location", sourceFile));
    const id = str(getField(r, "id", sourceFile));
    const key = `${org}|||${title}|||${loc}`;

    if (seen.has(key)) {
      findings.push({
        file: sourceFile,
        id,
        title: str(getField(r, "title", sourceFile)),
        organization: str(getField(r, "organization", sourceFile)),
        issue: `Duplicate record (same org+title+location as record "${seen.get(key)}")`,
        field: "record",
        value: `org="${org}" title="${title}" loc="${loc}"`,
      });
    } else {
      seen.set(key, id || title);
    }
  }
  return findings;
}

// ── Main ─────────────────────────────────────────────────

function runAudit() {
  const jobsData = readJson(JOBS_FILE);
  const recordsData = readJson(RECORDS_FILE);
  const pendingData = readJson(PENDING_FILE);

  const jobsLabel = "jobs.json";
  const recordsLabel = "job-records.json";
  const pendingLabel = "pending-synced-jobs.json";

  const allChecks = {
    workModeLocationRedundancy: {
      label: "Work Mode / Location Redundancy",
      jobs: checkWorkModeLocationRedundancy(jobsData, jobsLabel),
      records: checkWorkModeLocationRedundancy(recordsData, recordsLabel),
      pending: checkWorkModeLocationRedundancy(pendingData, pendingLabel),
    },
    deadClosedRoles: {
      label: "Dead/Closed/Invalid Roles",
      jobs: checkDeadClosedRoles(jobsData, jobsLabel),
      records: checkDeadClosedRoles(recordsData, recordsLabel),
      pending: checkDeadClosedRoles(pendingData, pendingLabel),
    },
    fakeInvalidPay: {
      label: "Fake/Invalid Pay",
      jobs: checkFakeInvalidPay(jobsData, jobsLabel),
      records: checkFakeInvalidPay(recordsData, recordsLabel),
      pending: checkFakeInvalidPay(pendingData, pendingLabel),
    },
    badGenericJobLinks: {
      label: "Bad/Generic Job Links",
      jobs: checkBadGenericJobLinks(jobsData, jobsLabel),
      records: checkBadGenericJobLinks(recordsData, recordsLabel),
      pending: checkBadGenericJobLinks(pendingData, pendingLabel),
    },
    descriptionProblems: {
      label: "Description Problems",
      jobs: checkDescriptionProblems(jobsData, jobsLabel),
      records: checkDescriptionProblems(recordsData, recordsLabel),
      pending: checkDescriptionProblems(pendingData, pendingLabel),
    },
    structureLoss: {
      label: "Structure Loss",
      jobs: checkStructureLoss(jobsData, jobsLabel),
      records: checkStructureLoss(recordsData, recordsLabel),
      pending: checkStructureLoss(pendingData, pendingLabel),
    },
    titleLocationErrors: {
      label: "Title/Location Errors",
      jobs: checkTitleLocationErrors(jobsData, jobsLabel),
      records: checkTitleLocationErrors(recordsData, recordsLabel),
      pending: checkTitleLocationErrors(pendingData, pendingLabel),
    },
    duplicateRecords: {
      label: "Duplicate Records",
      jobs: checkDuplicateRecords(jobsData, jobsLabel),
      records: checkDuplicateRecords(recordsData, recordsLabel),
      pending: checkDuplicateRecords(pendingData, pendingLabel),
    },
  };

  const generatedAt = nowIso();

  const summary = {
    jobs: jobsData.length,
    records: recordsData.length,
    pending: pendingData.length,
    generatedAt,
  };

  const totals = {};
  for (const [key, check] of Object.entries(allChecks)) {
    totals[key] = {
      label: check.label,
      jobs: check.jobs.length,
      records: check.records.length,
      pending: check.pending.length,
      total: check.jobs.length + check.records.length + check.pending.length,
    };
  }

  const grandTotal = Object.values(totals).reduce((s, t) => s + t.total, 0);

  const report = {
    generatedAt,
    summary,
    totals,
    grandTotal,
    checks: {},
  };

  for (const [key, check] of Object.entries(allChecks)) {
    report.checks[key] = {
      label: check.label,
      findings: {
        jobs: check.jobs,
        records: check.records,
        pending: check.pending,
      },
    };
  }

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`JSON report written to ${REPORT_JSON}`);

  // ── Markdown Report ──
  const mdLines = [];
  mdLines.push("# Jobs JSON Quality Audit Report");
  mdLines.push("");
  mdLines.push(`Generated: ${generatedAt}`);
  mdLines.push("");
  mdLines.push("## Summary");
  mdLines.push("");
  mdLines.push(`| File | Records |`);
  mdLines.push(`| --- | --- |`);
  mdLines.push(`| jobs.json | ${summary.jobs} |`);
  mdLines.push(`| job-records.json | ${summary.records} |`);
  mdLines.push(`| pending-synced-jobs.json | ${summary.pending} |`);
  mdLines.push(`| **Total** | **${summary.jobs + summary.records + summary.pending}** |`);
  mdLines.push("");
  mdLines.push(`**Total issues found: ${grandTotal}**`);
  mdLines.push("");
  mdLines.push("## Issue Totals by Check");
  mdLines.push("");
  mdLines.push("| Check | jobs.json | job-records.json | pending-synced-jobs.json | Total |");
  mdLines.push("| --- | --- | --- | --- | --- |");
  for (const [key, t] of Object.entries(totals)) {
    mdLines.push(`| ${t.label} | ${t.jobs} | ${t.records} | ${t.pending} | ${t.total} |`);
  }
  mdLines.push("");

  for (const [key, check] of Object.entries(allChecks)) {
    const allFindings = [...check.jobs, ...check.records, ...check.pending];
    if (allFindings.length === 0) {
      mdLines.push(`## ${check.label}`);
      mdLines.push("");
      mdLines.push("_No issues found._");
      mdLines.push("");
      continue;
    }
    mdLines.push(`## ${check.label}`);
    mdLines.push("");
    mdLines.push(`Total: ${allFindings.length} issues`);
    mdLines.push("");

    if (check.jobs.length > 0) {
      mdLines.push("### jobs.json");
      mdLines.push("");
      mdLines.push("| # | Title | Organization | Issue | Field | Value/Snippet |");
      mdLines.push("| --- | --- | --- | --- | --- | --- |");
      check.jobs.forEach((f, i) => {
        const val = f.value || f.snippet || "";
        const valEsc = val.replace(/\|/g, "\\|").replace(/\n/g, " ").substring(0, 150);
        mdLines.push(`| ${i + 1} | ${f.title || "?"} | ${f.organization || "?"} | ${f.issue} | ${f.field} | ${valEsc} |`);
      });
      mdLines.push("");
    }

    if (check.records.length > 0) {
      mdLines.push("### job-records.json");
      mdLines.push("");
      mdLines.push("| # | Title | Organization | Issue | Field | Value/Snippet |");
      mdLines.push("| --- | --- | --- | --- | --- | --- |");
      check.records.forEach((f, i) => {
        const val = f.value || f.snippet || "";
        const valEsc = val.replace(/\|/g, "\\|").replace(/\n/g, " ").substring(0, 150);
        mdLines.push(`| ${i + 1} | ${f.title || "?"} | ${f.organization || "?"} | ${f.issue} | ${f.field} | ${valEsc} |`);
      });
      mdLines.push("");
    }

    if (check.pending.length > 0) {
      mdLines.push("### pending-synced-jobs.json");
      mdLines.push("");
      mdLines.push("| # | Title | Organization | Issue | Field | Value/Snippet |");
      mdLines.push("| --- | --- | --- | --- | --- | --- |");
      check.pending.forEach((f, i) => {
        const val = f.value || f.snippet || "";
        const valEsc = val.replace(/\|/g, "\\|").replace(/\n/g, " ").substring(0, 150);
        mdLines.push(`| ${i + 1} | ${f.title || "?"} | ${f.organization || "?"} | ${f.issue} | ${f.field} | ${valEsc} |`);
      });
      mdLines.push("");
    }
  }

  fs.writeFileSync(REPORT_MD, mdLines.join("\n"), "utf8");
  console.log(`Markdown report written to ${REPORT_MD}`);
}

runAudit();
