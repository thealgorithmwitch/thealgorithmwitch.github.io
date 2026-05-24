const fs = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { TALENT_PROFILES_FILE } = require("./public-records");
const {
  APPS_SCRIPT_URL,
  describePayload,
  ensureReportsDir,
  fetchBackendAction,
  findExistingRecord,
  isExplicitFalse,
  mergePreservingClean,
  normalizeText,
  parseRawJson,
  visibleByDefault,
  featuredByDefault
} = require("./approved-export-utils");

const ROOT = path.resolve(__dirname, "..");
const AUDIT_FILE = path.join(ROOT, "reports", "talent-export-audit.json");

function log(message, details) {
  if (details === undefined) {
    console.log(`[jobs:fetch-approved-talent] ${message}`);
    return;
  }
  console.log(`[jobs:fetch-approved-talent] ${message}=${details}`);
}

function logSkip(profile, reason) {
  const name = normalizeText(profile && (profile.name || profile.full_name || profile.fullName || profile.display_name || profile.email || profile.id));
  console.warn(
    `[jobs:fetch-approved-talent] skipped_approved_profile reason=${reason} name=${name || "(missing)"} id=${normalizeText(profile && profile.id) || "(missing)"}`
  );
}

function normalizeApprovedTalentProfile(row = {}) {
  const raw = parseRawJson(row.raw_json || row.rawJson || row.json || row.payload_json);
  const source = { ...raw, ...row };
  const name = normalizeText(source.name || source.full_name || source.fullName || source.display_name);
  const email = normalizeText(source.email || source.contact_email || source.public_email);
  const currentRole = normalizeText(source.current_role || source.currentRole || source.title || source.headline || source.role);
  const status = normalizeText(source.status || "active").toLowerCase() || "active";
  const visible = visibleByDefault(source);
  return {
    ...raw,
    ...source,
    id: normalizeText(source.id || source.profile_id || email || name),
    name,
    email,
    current_role: currentRole,
    title: normalizeText(source.title || source.headline || currentRole),
    headline: normalizeText(source.headline || source.title || currentRole),
    short_bio: normalizeText(source.short_bio || source.bio || source.summary),
    bio: normalizeText(source.bio || source.short_bio || source.summary),
    location: normalizeText(source.location || source.city),
    status,
    public_visibility: visible,
    featured: featuredByDefault(source),
    source_type: normalizeText(source.source_type || "admin_approved"),
    source: normalizeText(source.source || "admin_review"),
    approved_by: normalizeText(source.approved_by),
    published: visible,
    record_type: "talent",
    raw_json: source.raw_json || JSON.stringify(raw || source || {})
  };
}

function findExistingTalentMatch(existingProfiles, profile) {
  return findExistingRecord(existingProfiles, profile, {
    idFields: ["id"],
    emailFields: ["email"],
    nameFields: ["name"]
  });
}

function ensureRenderableTalentShape(profile = {}) {
  const visible = visibleByDefault(profile);
  return {
    ...profile,
    record_type: profile.record_type || "talent",
    status: normalizeText(profile.status || "active").toLowerCase() || "active",
    public_visibility: visible,
    featured: featuredByDefault(profile),
    published: visible
  };
}

function assertApprovedTalentWritten(approvedRows, outputProfiles) {
  const outputNames = new Set(
    (Array.isArray(outputProfiles) ? outputProfiles : [])
      .map((profile) => String(profile && profile.name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  for (const row of Array.isArray(approvedRows) ? approvedRows : []) {
    const name = String(row && row.name || "").trim();
    if (!name) continue;
    if (!visibleByDefault(row)) continue;
    if (!outputNames.has(name.toLowerCase())) {
      throw new Error(`[fetch-approved-talent] visible approved talent missing after export: ${name}`);
    }
  }
}

function getGitStatusAfterWrite() {
  try {
    const root = path.dirname(TALENT_PROFILES_FILE);
    return execSync("git status --short -- talent-profiles.json", {
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

  const pendingResponse = await fetchBackendAction("getPendingTalent");
  let approvedResponse;
  try {
    approvedResponse = await fetchBackendAction("getApprovedTalent");
    log("getApprovedTalent_ok", true);
  } catch (error) {
    log("getApprovedTalent_ok", false);
    throw error;
  }
  log("pending_talent_response_description", JSON.stringify(describePayload(pendingResponse.payload)));
  log("approved_talent_response_description", JSON.stringify(describePayload(approvedResponse.payload)));

  const pendingTalent = Array.isArray(pendingResponse.items) ? pendingResponse.items : [];
  const approvedRawRows = Array.isArray(approvedResponse.items) ? approvedResponse.items : [];

  log("pending_talent_count", pendingTalent.length);

  const approvedProfiles = [];
  const skippedProfiles = [];

  for (const row of approvedRawRows) {
    if (!row || typeof row !== "object") {
      skippedProfiles.push({ reason: "invalid_row_shape", row });
      logSkip({}, "invalid_row_shape");
      continue;
    }

    const normalized = normalizeApprovedTalentProfile(row);
    if (!normalizeText(normalized.name)) {
      skippedProfiles.push({ reason: "missing_name", row });
      logSkip(normalized, "missing_name");
      continue;
    }

    approvedProfiles.push(normalized);
  }

  log("approved_talent_count", approvedProfiles.length);
  log("approved_talent_names", JSON.stringify(approvedProfiles.map((profile) => profile.name).filter(Boolean)));

  const existingProfiles = await readJson(TALENT_PROFILES_FILE, []);
  const existingList = Array.isArray(existingProfiles) ? existingProfiles : [];
  log("talent_profiles_before_count", existingList.length);

  const mergedProfiles = existingList.map((profile) => ({ ...profile }));
  for (const approved of approvedProfiles) {
    const current = findExistingTalentMatch(mergedProfiles, approved);
    const merged = current
      ? mergePreservingClean(current, ensureRenderableTalentShape(approved))
      : ensureRenderableTalentShape(approved);

    if (current) {
      const index = mergedProfiles.indexOf(current);
      if (index >= 0) {
        mergedProfiles[index] = merged;
      } else {
        mergedProfiles.push(merged);
      }
    } else {
      mergedProfiles.push(merged);
    }
  }

  assertApprovedTalentWritten(approvedProfiles, mergedProfiles);

  const changed = await writeJsonIfChanged(TALENT_PROFILES_FILE, mergedProfiles);
  const gitStatus = getGitStatusAfterWrite();

  log("talent_profiles_after_count", mergedProfiles.length);
  log("talent_profiles_written_count", changed ? mergedProfiles.length : 0);
  log("talent_profiles_path", TALENT_PROFILES_FILE);
  log("git_status_after_write", gitStatus);
  log("wrote", changed ? "true" : "false");

  await writeAuditReport({
    generated_at: new Date().toISOString(),
    backend_url_present: Boolean(APPS_SCRIPT_URL),
    pending_talent_count: pendingTalent.length,
    approved_talent_count: approvedProfiles.length,
    approved_talent_names: approvedProfiles.map((profile) => profile.name).filter(Boolean),
    talent_profiles_before_count: existingList.length,
    talent_profiles_after_count: mergedProfiles.length,
    talent_profiles_written_count: changed ? mergedProfiles.length : 0,
    talent_profiles_path: TALENT_PROFILES_FILE,
    git_status_after_write: gitStatus,
    skipped_profiles: skippedProfiles
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:fetch-approved-talent] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertApprovedTalentWritten,
  ensureRenderableTalentShape,
  findExistingTalentMatch,
  main,
  normalizeApprovedTalentProfile
};
