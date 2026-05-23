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
  return value === true || String(value).toLowerCase() === "true";
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

function normalizeApprovedTalentRecord(item = {}) {
  const raw = parseRawJson(item.raw_json);
  const id = String(raw.id || item.id || "").trim();
  const createdAt = item.created_at || raw.created_at || undefined;
  const updatedAt = item.updated_at || raw.updated_at || undefined;
  const publicVisibilitySource = Object.prototype.hasOwnProperty.call(item, "public_visibility")
    ? item.public_visibility
    : Object.prototype.hasOwnProperty.call(raw, "public_visibility")
      ? raw.public_visibility
      : undefined;
  const featuredSource = Object.prototype.hasOwnProperty.call(item, "featured")
    ? item.featured
    : Object.prototype.hasOwnProperty.call(raw, "featured")
      ? raw.featured
      : undefined;
  const publicVisibility =
    publicVisibilitySource === undefined
      ? undefined
      : toBoolean(publicVisibilitySource);
  const featured =
    featuredSource === undefined
      ? undefined
      : toBoolean(featuredSource);
  const displayOrderValue = item.display_order ?? raw.display_order;
  const displayOrder = displayOrderValue === undefined || displayOrderValue === null || displayOrderValue === ""
    ? undefined
    : Number.isFinite(Number(displayOrderValue))
      ? Number(displayOrderValue)
      : undefined;

  return {
    ...raw,
    id,
    record_type: "talent",
    status: String(item.status || raw.status || "published"),
    public_visibility: publicVisibility,
    featured,
    published: true,
    created_at: createdAt ? String(createdAt) : undefined,
    updated_at: updatedAt ? String(updatedAt) : undefined,
    source_type: item.source_type || raw.source_type,
    admin_notes: String(item.admin_notes || raw.admin_notes || ""),
    display_order: displayOrder,
    source: item.source || raw.source,
    name: String(item.name || raw.name || ""),
    email: String(item.email || raw.email || ""),
    current_role: String(item.current_role || raw.current_role || ""),
    location: String(item.location || raw.location || ""),
    approved_by: String(item.approved_by || raw.approved_by || ""),
    raw_json: String(item.raw_json || JSON.stringify(raw || {}))
  };
}

async function fetchBackendTalent(actionName) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: actionName
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Apps Script request failed with HTTP ${response.status}.`);
  }
  if (!payload || !payload.ok) {
    throw new Error(payload && payload.error ? payload.error : `Apps Script ${actionName} returned an error.`);
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items;
}

function buildExistingTalentById(records = []) {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const id = normalizeText(record && record.id);
    if (id) map.set(id, record);
  });
  return map;
}

async function main() {
  console.log(`[jobs:fetch-approved-talent] backend_url=${APPS_SCRIPT_URL}`);
  const [pendingTalent, approvedTalent] = await Promise.all([
    fetchBackendTalent("getPendingTalent"),
    fetchBackendTalent("getApprovedTalent")
  ]);
  console.log(`[jobs:fetch-approved-talent] pending_talent_count=${pendingTalent.length}`);
  console.log(`[jobs:fetch-approved-talent] approved_talent_count=${approvedTalent.length}`);

  const existingTalentProfiles = await readJson(TALENT_PROFILES_FILE, []);
  const existingById = buildExistingTalentById(existingTalentProfiles);
  const approvedById = buildExistingTalentById(
    approvedTalent.map((item) => normalizeApprovedTalentRecord(item))
  );

  const merged = [];
  const seen = new Set();

  for (const record of Array.isArray(existingTalentProfiles) ? existingTalentProfiles : []) {
    const id = normalizeText(record && record.id);
    if (!id) continue;
    const approved = approvedById.get(id);
    const next = approved ? mergeTalentProfile(record, approved) : record;
    merged.push(next);
    seen.add(id);
  }

  for (const [id, approved] of approvedById.entries()) {
    if (seen.has(id)) continue;
    const current = existingById.get(id) || {};
    merged.push(mergeTalentProfile(current, approved));
  }

  const changed = await writeJsonIfChanged(TALENT_PROFILES_FILE, merged);
  console.log(`[jobs:fetch-approved-talent] talent_profiles_written_count=${merged.length}`);
  console.log(`[jobs:fetch-approved-talent] talent_profiles_path=${TALENT_PROFILES_FILE}`);
  console.log(`[jobs:fetch-approved-talent] wrote=${changed ? "true" : "false"}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:fetch-approved-talent] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildExistingTalentById,
  main,
  mergeTalentProfile,
  normalizeApprovedTalentRecord
};
