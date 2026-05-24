const fs = require("fs/promises");
const path = require("path");

const EMBEDDED_FALLBACK_URL =
  "https://script.google.com/macros/s/AKfycbzOziSxt4U5KDHS1uRTzhY9zuP1lxZofCbrRYBzK6PET1DjCjvxBQ3Gc7W-SRYgKcI2/exec";

const APPS_SCRIPT_URL =
  process.env.JOBS_APPROVED_EXPORT_URL ||
  process.env.JOBS_BACKEND_URL ||
  EMBEDDED_FALLBACK_URL;

const ADMIN_TOKEN =
  process.env.JOBS_ADMIN_TOKEN ||
  process.env.JOBS_ADMIN_TOKEN_LOCAL ||
  "";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isExplicitFalse(value) {
  return value === false ||
    value === 0 ||
    String(value || "").trim().toLowerCase() === "false" ||
    String(value || "").trim().toLowerCase() === "no" ||
    String(value || "").trim().toLowerCase() === "hidden";
}

function isExplicitHiddenStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return ["hidden", "rejected", "archived", "inactive", "draft"].includes(status);
}

function visibleByDefault(row = {}) {
  if (isExplicitHiddenStatus(row.status)) return false;
  if (isExplicitFalse(row.public_visibility)) return false;
  return true;
}

function featuredByDefault(row = {}) {
  if (isExplicitFalse(row.featured)) return false;
  return true;
}

function parseRawJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (_error) {
    return {};
  }
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.talent,
    payload.profiles,
    payload.items,
    payload.rows,
    payload.data,
    payload.results,
    payload.approvedTalent,
    payload.approved_talent,
    payload.featuredEmployers,
    payload.featured_employers,
    payload.employers
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function describePayload(payload) {
  if (Array.isArray(payload)) return { type: "array", length: payload.length };
  if (!payload || typeof payload !== "object") return { type: typeof payload };
  return {
    type: "object",
    ok: payload.ok,
    error: payload.error || "",
    keys: Object.keys(payload),
    nested_array_keys: Object.keys(payload).filter((key) => Array.isArray(payload[key]))
  };
}

function mergePreservingClean(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (hasValue(value)) {
      if (Array.isArray(value)) {
        merged[key] = value.slice();
        continue;
      }
      if (value && typeof value === "object") {
        merged[key] = { ...(merged[key] && typeof merged[key] === "object" ? merged[key] : {}), ...value };
        continue;
      }
      merged[key] = value;
    }
  }
  return merged;
}

function findExistingRecord(records, incoming, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const idFields = Array.isArray(options.idFields) ? options.idFields : ["id"];
  const emailFields = Array.isArray(options.emailFields) ? options.emailFields : [];
  const nameFields = Array.isArray(options.nameFields) ? options.nameFields : ["name"];

  for (const field of idFields) {
    const target = normalizeText(incoming && incoming[field]);
    if (!target) continue;
    const match = list.find((item) => normalizeText(item && item[field]) === target);
    if (match) return match;
  }

  for (const field of emailFields) {
    const target = normalizeText(incoming && incoming[field]).toLowerCase();
    if (!target) continue;
    const match = list.find((item) => normalizeText(item && item[field]).toLowerCase() === target);
    if (match) return match;
  }

  for (const field of nameFields) {
    const target = normalizeText(incoming && incoming[field]).toLowerCase();
    if (!target) continue;
    const match = list.find((item) => normalizeText(item && item[field]).toLowerCase() === target);
    if (match) return match;
  }

  return null;
}

async function fetchBackendAction(actionName) {
  let response;
  try {
    response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: actionName,
        token: ADMIN_TOKEN,
        adminToken: ADMIN_TOKEN,
        admin_token: ADMIN_TOKEN
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
    throw new Error(`Apps Script request failed for ${actionName} with HTTP ${response.status}.`);
  }
  if (payload && /unauthorized/i.test(String(payload.error || ""))) {
    throw new Error(`Apps Script rejected ${actionName}: Unauthorized. Check JOBS_ADMIN_TOKEN and deployment access.`);
  }
  if (payload && payload.error === "Invalid action.") {
    throw new Error(`Apps Script deployment does not support ${actionName}. Redeploy latest Code.gs.`);
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

async function ensureReportsDir(rootDir) {
  const dir = path.join(rootDir, "reports");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

module.exports = {
  ADMIN_TOKEN,
  APPS_SCRIPT_URL,
  describePayload,
  EMBEDDED_FALLBACK_URL,
  ensureReportsDir,
  extractArray,
  fetchBackendAction,
  featuredByDefault,
  findExistingRecord,
  hasValue,
  isExplicitFalse,
  isExplicitHiddenStatus,
  mergePreservingClean,
  normalizeText,
  parseRawJson,
  visibleByDefault
};
