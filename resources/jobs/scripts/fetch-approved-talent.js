const path = require("path");
const { execSync } = require("child_process");
const { readJson, writeJsonIfChanged } = require("./job-utils");
const { TALENT_PROFILES_FILE } = require("./public-records");

const EMBEDDED_FALLBACK_URL =
  "https://script.google.com/macros/s/AKfycbzOziSxt4U5KDHS1uRTzhY9zuP1lxZofCbrRYBzK6PET1DjCjvxBQ3Gc7W-SRYgKcI2/exec";

const APPS_SCRIPT_URL =
  process.env.JOBS_APPROVED_EXPORT_URL ||
  process.env.JOBS_BACKEND_URL ||
  EMBEDDED_FALLBACK_URL;

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseRawJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (_error) {
    return {};
  }
}

function toBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "on", "approved", "active", "published"].includes(text);
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return (
    payload.approvedTalent ||
    payload.approved_talent ||
    payload.talent ||
    payload.profiles ||
    payload.items ||
    payload.rows ||
    payload.data ||
    payload.results ||
    []
  );
}

function log(message, details) {
  if (details === undefined) {
    console.log(`[jobs:fetch-approved-talent] ${message}`);
    return;
  }
  console.log(`[jobs:fetch-approved-talent] ${message}=${details}`);
}

function logSkip(profile, reason) {
  const name = normalizeText(profile && (profile.name || profile.full_name || profile.fullName || profile.email || profile.id));
  console.warn(
    `[jobs:fetch-approved-talent] skipped_approved_profile reason=${reason} name=${name || "(missing)"} id=${normalizeText(profile && profile.id) || "(missing)"}`
  );
}

function normalizeApprovedTalentProfile(row = {}) {
  const raw = parseRawJson(row.raw_json || row.rawJson || row.json || row.payload_json);
  const source = {
    ...raw,
    ...row
  };
  const id = normalizeText(source.id || source.email || source.name);
  const name = normalizeText(source.name || source.full_name || source.fullName);
  const title = normalizeText(source.title || source.headline || source.role);
  const headline = normalizeText(source.headline || source.title || source.role);
  const shortBio = normalizeText(source.short_bio || source.bio || source.summary);
  const bio = normalizeText(source.bio || source.short_bio || source.summary);
  const location = normalizeText(source.location);
  const publicVisibility = true;
  const featured = toBoolean(source.featured) ? true : undefined;
  const status = normalizeText(source.status || "published").toLowerCase();

  return {
    ...raw,
    ...source,
    id,
    name,
    title,
    headline,
    short_bio: shortBio,
    bio,
    location,
    public_visibility: publicVisibility,
    featured,
    published: true,
    status: status === "active" || status === "approved" || status === "published" ? "published" : "published",
    record_type: "talent",
    raw_json: source.raw_json || JSON.stringify(raw || source || {})
  };
}

function buildExistingTalentById(records = []) {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const id = normalizeText(record && record.id);
    if (id) map.set(id, record);
  });
  return map;
}

function mergeTalentProfile(current = {}, incoming = {}) {
  const next = { ...current };
  Object.keys(incoming || {}).forEach((key) => {
    const currentValue = current[key];
    const incomingValue = incoming[key];
    if (isBlank(incomingValue) && !isBlank(currentValue)) return;
    if (Array.isArray(incomingValue)) {
      next[key] = incomingValue.slice();
      return;
    }
    if (incomingValue && typeof incomingValue === "object") {
      next[key] = { ...(currentValue && typeof currentValue === "object" ? currentValue : {}), ...incomingValue };
      return;
    }
    next[key] = incomingValue;
  });
  return next;
}

async function fetchBackendTalent(actionName) {
  let response;
  try {
    response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: actionName
      })
    });
  } catch (error) {
    throw new Error(`Apps Script request failed for ${actionName}: ${error.message}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Apps Script ${actionName} returned invalid JSON: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Apps Script request failed with HTTP ${response.status}.`);
  }
  if (!payload || !payload.ok) {
    throw new Error(payload && payload.error ? payload.error : `Apps Script ${actionName} returned an error.`);
  }

  return {
    ok: Boolean(payload.ok),
    payload,
    items: extractArray(payload)
  };
}

function findExistingTalentMatch(existingProfiles, profile) {
  const targetId = normalizeText(profile && profile.id);
  const targetName = normalizeText(profile && profile.name).toLowerCase();
  const targetEmail = normalizeText(profile && profile.email).toLowerCase();
  const list = Array.isArray(existingProfiles) ? existingProfiles : [];

  if (targetId) {
    const byId = list.find((item) => normalizeText(item && item.id) === targetId);
    if (byId) return byId;
  }

  if (targetEmail) {
    const byEmail = list.find((item) => normalizeText(item && item.email).toLowerCase() === targetEmail);
    if (byEmail) return byEmail;
  }

  if (targetName) {
    const byName = list.find((item) => normalizeText(item && item.name).toLowerCase() === targetName);
    if (byName) return byName;
  }

  return null;
}

function ensurePublishedTalentShape(profile = {}) {
  return {
    ...profile,
    published: true,
    public_visibility: true,
    status: "published",
    record_type: profile.record_type || "talent"
  };
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

async function main() {
  log("backend_url_present", Boolean(APPS_SCRIPT_URL));

  const pendingResponse = await fetchBackendTalent("getPendingTalent");
  let approvedResponse;
  try {
    approvedResponse = await fetchBackendTalent("getApprovedTalent");
    log("getApprovedTalent_ok", true);
  } catch (error) {
    log("getApprovedTalent_ok", false);
    throw error;
  }

  const pendingTalent = Array.isArray(pendingResponse.items) ? pendingResponse.items : [];
  const approvedRawProfiles = Array.isArray(approvedResponse.items) ? approvedResponse.items : [];

  log("pending_talent_count", pendingTalent.length);

  const approvedProfiles = [];
  const skippedApprovedProfiles = [];

  for (const row of approvedRawProfiles) {
    if (!row || typeof row !== "object") {
      skippedApprovedProfiles.push({ reason: "invalid_row_shape", row });
      logSkip({}, "invalid_row_shape");
      continue;
    }

    const normalized = normalizeApprovedTalentProfile(row);
    if (!normalizeText(normalized.id)) {
      skippedApprovedProfiles.push({ reason: "missing_id", row });
      logSkip(normalized, "missing_id");
      continue;
    }
    if (!normalizeText(normalized.name)) {
      skippedApprovedProfiles.push({ reason: "missing_name", row });
      logSkip(normalized, "missing_name");
      continue;
    }

    approvedProfiles.push(normalized);
  }

  log("approved_talent_count", approvedProfiles.length);
  log(
    "approved_talent_names",
    JSON.stringify(approvedProfiles.map((profile) => normalizeText(profile.name)).filter(Boolean))
  );

  const existingTalentProfiles = await readJson(TALENT_PROFILES_FILE, []);
  const existingList = Array.isArray(existingTalentProfiles) ? existingTalentProfiles : [];
  log("talent_profiles_before_count", existingList.length);

  const mergedProfiles = existingList.map((current) => ({ ...current }));
  for (const approved of approvedProfiles) {
    const current = findExistingTalentMatch(mergedProfiles, approved);
    const merged = current ? mergeTalentProfile(current, ensurePublishedTalentShape(approved)) : ensurePublishedTalentShape(approved);
    if (current) {
      const currentIndex = mergedProfiles.findIndex((item) => {
        const currentId = normalizeText(item && item.id);
        const currentName = normalizeText(item && item.name).toLowerCase();
        const targetId = normalizeText(current && current.id);
        const targetName = normalizeText(current && current.name).toLowerCase();
        return (currentId && targetId && currentId === targetId) || (currentName && targetName && currentName === targetName);
      });
      if (currentIndex >= 0) {
        mergedProfiles[currentIndex] = merged;
      } else {
        mergedProfiles.push(merged);
      }
    } else {
      mergedProfiles.push(merged);
    }

  }

  for (const profile of approvedProfiles) {
    const name = normalizeText(profile.name);
    if (!name) continue;
    const found = mergedProfiles.some((item) =>
      normalizeText(item && item.name).toLowerCase() === name.toLowerCase()
    );
    if (!found) {
      console.warn(`[jobs:fetch-approved-talent] approved_profile_missing_after_merge=${name}`);
    }
  }

  const changed = await writeJsonIfChanged(TALENT_PROFILES_FILE, mergedProfiles);
  log("talent_profiles_after_count", mergedProfiles.length);
  log("talent_profiles_written_count", changed ? mergedProfiles.length : 0);
  log("talent_profiles_path", TALENT_PROFILES_FILE);
  log("git_status_after_write", getGitStatusAfterWrite());
  log("wrote", changed ? "true" : "false");

  if (skippedApprovedProfiles.length) {
    log("skipped_approved_profile_count", skippedApprovedProfiles.length);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:fetch-approved-talent] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildExistingTalentById,
  ensurePublishedTalentShape,
  extractArray,
  fetchBackendTalent,
  main,
  mergeTalentProfile,
  normalizeApprovedTalentProfile
};
