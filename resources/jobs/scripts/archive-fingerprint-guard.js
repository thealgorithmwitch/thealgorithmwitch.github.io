const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RECORDS_FILE = path.join(ROOT, "job-records.json");

function readJson(filePath) {
  try {
    return JSON.parse(require("fs").readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

function clean(val) {
  return String(val || "").replace(/\s+/g, " ").replace(/[^a-z0-9]/g, "").toLowerCase().trim();
}

function cleanUrl(url) {
  return String(url || "")
    .replace(/https?:\/\//i, "")
    .replace(/^www\./, "")
    .replace(/\/+(apply\/autofillWithResume)?(\/apply)?\/?$/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase()
    .trim();
}

function getFieldMulti(record, ...paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let val = record;
    for (const p of parts) {
      if (val && typeof val === "object" && p in val) val = val[p];
      else { val = undefined; break; }
    }
    if (val !== undefined && val !== null && val !== "") return String(val);
  }
  return "";
}

const REJECT_STATUSES = new Set([
  "archived", "closed", "rejected", "blocked",
  "not_found", "access_denied", "unsupported_language"
]);

const ARCHIVE_ONLY_STATUSES = new Set([
  "archived", "closed", "rejected", "not_found", "access_denied"
]);

function buildFingerprint(record) {
  if (!record) return null;

  const org = clean(
    getFieldMulti(record,
      "display.organization", "raw_source_data.organization", "company", "organization"
    )
  );
  const title = clean(
    getFieldMulti(record,
      "display.title", "raw_source_data.title", "title"
    )
  );
  const externalId = clean(
    getFieldMulti(record,
      "external_id", "raw_source_data.id", "id"
    )
  );
  const applyUrl = cleanUrl(
    getFieldMulti(record,
      "display.application_url", "raw_source_data.apply_url", "apply_url"
    )
  );
  const sourceUrl = cleanUrl(
    getFieldMulti(record,
      "display.source_url", "raw_source_data.source_url", "source_url"
    )
  );

  const fingerprints = new Set();

  if (org && title) {
    fingerprints.add(`ot:${org}:${title}`);
  }
  if (externalId && org) {
    fingerprints.add(`oei:${org}:${externalId}`);
  }
  if (applyUrl && applyUrl.length > 15) {
    fingerprints.add(`au:${applyUrl}`);
  }
  // Only use source_url as a fingerprint if it's a specific job URL, not a careers landing page
  if (sourceUrl && sourceUrl.length > 15) {
    const isCareersLanding = /careers?\/?$|jobs?\/?$|about\/?$|join-?us\/?$/i.test(sourceUrl);
    if (!isCareersLanding) {
      fingerprints.add(`su:${sourceUrl}`);
    }
  }
  if (externalId) {
    fingerprints.add(`ei:${externalId}`);
  }
  if (org && title && applyUrl) {
    fingerprints.add(`ota:${org}:${title}:${applyUrl.slice(0, 60)}`);
  }

  return fingerprints.size > 0 ? fingerprints : null;
}

function loadArchiveRecords() {
  const records = readJson(RECORDS_FILE);
  if (!Array.isArray(records)) return [];

  const archiveRecords = [];
  for (const r of records) {
    const status = String(r.status || "").toLowerCase();
    if (!ARCHIVE_ONLY_STATUSES.has(status)) continue;
    const fp = buildFingerprint(r);
    if (fp) {
      archiveRecords.push({
        id: r.id || "unknown",
        status: r.status || "archived",
        stale_reason: r.stale_reason || r.verification_status || "",
        organization: getFieldMulti(r, "display.organization", "raw_source_data.organization", "organization"),
        title: getFieldMulti(r, "display.title", "raw_source_data.title", "title"),
        fingerprint: fp
      });
    }
  }
  return archiveRecords;
}

function fingerprintIntersects(a, b) {
  if (!a || !b) return false;
  // Require at least one URL or external-id fingerprint match (org+title alone is insufficient)
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hasUrlOrIdMatch = false;
  for (const fp of small) {
    if (large.has(fp)) {
      if (fp.startsWith("au:") || fp.startsWith("su:") || fp.startsWith("ei:") || fp.startsWith("oei:")) {
        hasUrlOrIdMatch = true;
      }
    }
  }
  // Also check org+title+apply_url triple match (ota:) which is stronger than ot: alone
  for (const fp of small) {
    if (fp.startsWith("ota:") && large.has(fp)) {
      return true;
    }
  }
  return hasUrlOrIdMatch;
}

function guardIncoming(incomingJobs, archiveRecords) {
  const passed = [];
  const blocked = [];

  for (const job of incomingJobs) {
    if (!job) continue;
    const incomingFp = buildFingerprint(job);
    if (!incomingFp) {
      passed.push(job);
      continue;
    }

    let matched = false;
    for (const archiveRecord of archiveRecords) {
      if (fingerprintIntersects(incomingFp, archiveRecord.fingerprint)) {
        blocked.push({
          job,
          matched_archive_id: archiveRecord.id,
          matched_archive_status: archiveRecord.status,
          matched_archive_reason: archiveRecord.stale_reason,
          matched_archive_org: archiveRecord.organization,
          matched_archive_title: archiveRecord.title
        });
        matched = true;
        break;
      }
    }
    if (!matched) {
      passed.push(job);
    }
  }

  return { passed, blocked };
}

function addFingerprintToRecord(record) {
  const fp = buildFingerprint(record);
  if (fp) {
    record.archived_fingerprint = [...fp];
  }
  return record;
}

function batchAddFingerprints(records) {
  for (const r of records) {
    addFingerprintToRecord(r);
  }
}

function runGuardDiagnostics() {
  const archiveRecords = loadArchiveRecords();
  const records = readJson(RECORDS_FILE);
  const publicRecords = Array.isArray(records) ? records.filter(r => {
    const s = String(r.status || "").toLowerCase();
    return s === "published" && r.public_visibility !== false;
  }) : [];

  const { passed, blocked } = guardIncoming(publicRecords, archiveRecords);

  return {
    total_archive_records: archiveRecords.length,
    total_public_records_scanned: publicRecords.length,
    blocked_by_own_archive: blocked.length,
    passed_sanity_check: passed.length,
    blocked_details: blocked.map(b => ({
      id: b.job?.id || "",
      title: b.matched_archive_title,
      org: b.matched_archive_org,
      matched_archive_id: b.matched_archive_id,
      matched_archive_status: b.matched_archive_status,
      matched_archive_reason: b.matched_archive_reason
    }))
  };
}

module.exports = {
  buildFingerprint,
  loadArchiveRecords,
  fingerprintIntersects,
  guardIncoming,
  addFingerprintToRecord,
  batchAddFingerprints,
  runGuardDiagnostics,
  REJECT_STATUSES
};
