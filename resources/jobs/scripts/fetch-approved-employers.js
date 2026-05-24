const fs = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { EMPLOYERS_FILE } = require("./public-records");
const {
  APPS_SCRIPT_URL,
  describePayload,
  ensureReportsDir,
  fetchBackendAction,
  findExistingRecord,
  featuredByDefault,
  mergePreservingClean,
  normalizeText,
  parseRawJson,
  visibleByDefault
} = require("./approved-export-utils");

const ROOT = path.resolve(__dirname, "..");
const AUDIT_FILE = path.join(ROOT, "reports", "employer-export-audit.json");

function log(message, details) {
  if (details === undefined) {
    console.log(`[jobs:fetch-approved-employers] ${message}`);
    return;
  }
  console.log(`[jobs:fetch-approved-employers] ${message}=${details}`);
}

function logSkip(record, reason) {
  const name = normalizeText(record && (record.organization_name || record.organization || record.company || record.name || record.website || record.id));
  console.warn(
    `[jobs:fetch-approved-employers] skipped_approved_employer reason=${reason} organization=${name || "(missing)"} id=${normalizeText(record && record.id) || "(missing)"}`
  );
}

function normalizeApprovedEmployer(row = {}) {
  const raw = parseRawJson(row.raw_json || row.rawJson || row.json || row.payload_json);
  const source = { ...raw, ...row };
  const organizationName = normalizeText(source.organization_name || source.organization || source.company || source.name);
  const website = normalizeText(source.website || source.url);
  const visible = visibleByDefault(source);
  return {
    ...raw,
    ...source,
    id: normalizeText(source.id || source.profile_id || website || organizationName),
    organization_name: organizationName,
    organization: normalizeText(source.organization || organizationName),
    company: normalizeText(source.company || organizationName),
    name: normalizeText(source.name || organizationName),
    website,
    url: normalizeText(source.url || website),
    logo: normalizeText(source.logo || source.logo_url),
    description: normalizeText(source.description || source.summary || source.about),
    hiring_focus: normalizeText(source.hiring_focus || source.submitted_roles || "Published employer"),
    submitted_roles: normalizeText(source.submitted_roles || source.hiring_focus),
    status: normalizeText(source.status || "active").toLowerCase() || "active",
    public_visibility: visible,
    featured: featuredByDefault(source),
    source_type: normalizeText(source.source_type || "admin_approved"),
    source: normalizeText(source.source || "admin_review"),
    approved_by: normalizeText(source.approved_by),
    published: visible,
    record_type: "employer",
    raw_json: source.raw_json || JSON.stringify(raw || source || {})
  };
}

function findExistingEmployerMatch(existingEmployers, employer) {
  return findExistingRecord(existingEmployers, employer, {
    idFields: ["id"],
    emailFields: ["website", "url"],
    nameFields: ["organization_name", "organization", "company", "name"]
  });
}

function ensureRenderableEmployerShape(record = {}) {
  const visible = visibleByDefault(record);
  return {
    ...record,
    record_type: record.record_type || "employer",
    status: normalizeText(record.status || "active").toLowerCase() || "active",
    public_visibility: visible,
    featured: featuredByDefault(record),
    published: visible
  };
}

function assertApprovedEmployersWritten(approvedRows, outputEmployers) {
  const outputNames = new Set(
    (Array.isArray(outputEmployers) ? outputEmployers : [])
      .map((record) => String(record && (record.organization_name || record.organization || record.company || record.name) || "").trim().toLowerCase())
      .filter(Boolean)
  );
  for (const row of Array.isArray(approvedRows) ? approvedRows : []) {
    const name = String(row && (row.organization_name || row.organization || row.company || row.name) || "").trim();
    if (!name) continue;
    if (!visibleByDefault(row)) continue;
    if (!outputNames.has(name.toLowerCase())) {
      throw new Error(`[fetch-approved-employers] visible approved employer missing after export: ${name}`);
    }
  }
}

function getGitStatusAfterWrite() {
  try {
    const root = path.dirname(EMPLOYERS_FILE);
    return execSync("git status --short -- employers.json", {
      cwd: root,
      encoding: "utf8"
    }).trim() || "(clean)";
  } catch (error) {
    return `(git_status_failed: ${String(error.message || error).trim()})`;
  }
}

async function writeAuditReport(payload) {
  await ensureReportsDir(ROOT);
  await fs.writeFile(AUDIT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  log("backend_url_present", Boolean(APPS_SCRIPT_URL));

  let approvedResponse;
  try {
    approvedResponse = await fetchBackendAction("getApprovedFeaturedEmployers");
    log("getApprovedFeaturedEmployers_ok", true);
  } catch (error) {
    log("getApprovedFeaturedEmployers_ok", false);
    throw error;
  }
  log("approved_employers_response_description", JSON.stringify(describePayload(approvedResponse.payload)));

  const approvedRawRows = Array.isArray(approvedResponse.items) ? approvedResponse.items : [];
  const approvedEmployers = [];
  const skippedEmployers = [];

  for (const row of approvedRawRows) {
    if (!row || typeof row !== "object") {
      skippedEmployers.push({ reason: "invalid_row_shape", row });
      logSkip({}, "invalid_row_shape");
      continue;
    }
    const normalized = normalizeApprovedEmployer(row);
    if (!normalizeText(normalized.organization_name)) {
      skippedEmployers.push({ reason: "missing_organization_name", row });
      logSkip(normalized, "missing_organization_name");
      continue;
    }
    approvedEmployers.push(normalized);
  }

  log("approved_employers_count", approvedEmployers.length);
  log("approved_employer_names", JSON.stringify(approvedEmployers.map((item) => item.organization_name).filter(Boolean)));

  const existingEmployers = await readJson(EMPLOYERS_FILE, []);
  const existingList = Array.isArray(existingEmployers) ? existingEmployers : [];
  log("employers_before_count", existingList.length);

  const mergedEmployers = existingList.map((item) => ({ ...item }));
  for (const approved of approvedEmployers) {
    const current = findExistingEmployerMatch(mergedEmployers, approved);
    const merged = current
      ? mergePreservingClean(current, ensureRenderableEmployerShape(approved))
      : ensureRenderableEmployerShape(approved);

    if (current) {
      const index = mergedEmployers.indexOf(current);
      if (index >= 0) {
        mergedEmployers[index] = merged;
      } else {
        mergedEmployers.push(merged);
      }
    } else {
      mergedEmployers.push(merged);
    }
  }

  assertApprovedEmployersWritten(approvedEmployers, mergedEmployers);

  const changed = await writeJsonIfChanged(EMPLOYERS_FILE, mergedEmployers);
  const gitStatus = getGitStatusAfterWrite();

  log("employers_after_count", mergedEmployers.length);
  log("employers_written_count", changed ? mergedEmployers.length : 0);
  log("employers_path", EMPLOYERS_FILE);
  log("git_status_after_write", gitStatus);
  log("wrote", changed ? "true" : "false");

  await writeAuditReport({
    generated_at: new Date().toISOString(),
    backend_url_present: Boolean(APPS_SCRIPT_URL),
    approved_employers_count: approvedEmployers.length,
    approved_employer_names: approvedEmployers.map((item) => item.organization_name).filter(Boolean),
    employers_before_count: existingList.length,
    employers_after_count: mergedEmployers.length,
    employers_written_count: changed ? mergedEmployers.length : 0,
    employers_path: EMPLOYERS_FILE,
    git_status_after_write: gitStatus,
    skipped_employers: skippedEmployers
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:fetch-approved-employers] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertApprovedEmployersWritten,
  ensureRenderableEmployerShape,
  findExistingEmployerMatch,
  main,
  normalizeApprovedEmployer
};
