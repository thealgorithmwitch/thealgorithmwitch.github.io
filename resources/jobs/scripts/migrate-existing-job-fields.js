const { JOBS_FILE, PENDING_SYNCED_FILE, readJson, writeJsonIfChanged } = require("./job-utils");
const { JOB_RECORDS_FILE } = require("./public-records");
const { syncPublicJobsFromRecords } = require("./public-jobs");
const {
  normalizeJob,
  normalizeEmploymentType,
  normalizeWorkplaceType,
  stringifySafe,
  hasExplicitRemoteSignal,
  looksLikePhysicalLocation,
  isGenericRoleTitle,
  stripSocialShareJunk
} = require("./job-normalizer");

const WRITE = process.argv.includes("--write");
const EXAMPLE_LIMIT = 12;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLower(value) {
  return cleanText(value).toLowerCase();
}

function isClimateChangeJobsJob(job = {}) {
  const haystack = [
    job.source_id,
    job.source,
    job.notes,
    job.source_url,
    job.apply_url,
    job.original_url
  ].map(normalizeLower).join(" ");
  return haystack.includes("climatechangejobs");
}

function isGreenJobSearchJob(job = {}) {
  const haystack = [
    job.source_id,
    job.source,
    job.notes,
    job.source_url,
    job.apply_url,
    job.original_url
  ].map(normalizeLower).join(" ");
  return haystack.includes("greenjobsearch") || haystack.includes("green jobs search") || haystack.includes("greenjobsearch.org");
}

function isClimateChangeJobsUrl(value) {
  return /https?:\/\/[^/\s]*climatechangejobs\.com/i.test(String(value || ""));
}

function isGreenJobSearchUrl(value) {
  return /https?:\/\/[^/\s]*greenjobsearch\.org/i.test(String(value || ""));
}

function isClearlyWrongOrganization(value) {
  const normalized = normalizeLower(value);
  if (!normalized) return true;
  return (
    normalized === "unknown organization" ||
    normalized === "elemental impact" ||
    normalized === "climatechangejobs" ||
    normalized === "climate change jobs" ||
    normalized === "greenjobsearch" ||
    normalized === "green jobs network"
  );
}

function isElementalImpactJob(job = {}) {
  const haystack = [
    job.source_id,
    job.source,
    job.notes,
    job.source_url,
    job.apply_url,
    job.original_url
  ].map(normalizeLower).join(" ");
  return haystack.includes("elementalimpact") || haystack.includes("elemental impact");
}

function looksBoilerplateDescription(value) {
  const text = cleanText(stripSocialShareJunk(value));
  if (!text) return true;
  return (
    /^jobs search\b/i.test(text) ||
    /\b(?:apply now|view opening|search jobs|join talent community|privacy policy|equal opportunity employer)\b/i.test(text) ||
    /\b(?:share to twitter|share on twitter|share to facebook|share on facebook|share to linkedin|share on linkedin|share this job|email this job|copy link|tweet)\b/i.test(String(value || "")) ||
    /\bno\s*wrap\b|\bnowrap\b/i.test(text) ||
    /(?:previous|next)\s+post/i.test(text)
  );
}

function looksArticleLikeDescription(value) {
  const text = cleanText(stripSocialShareJunk(value));
  if (!text) return false;
  if (/^jobs search\b/i.test(text)) return true;
  if (/\b(?:\d+[mhdy]\s+ago|green jobs network)\b/i.test(text) && !/\b(?:will|supports|manages|develops|partners|builds|leads|seeks)\b/i.test(text)) {
    return true;
  }
  return false;
}

function descriptionQualityScore(value) {
  const text = cleanText(stripSocialShareJunk(value));
  if (!text) return 0;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const usefulSentences = sentences.filter((sentence) => /\b(?:will|supports|manages|develops|partners|builds|leads|seeks|coordinates|works)\b/i.test(sentence));
  return usefulSentences.length * 3 + Math.min(text.length, 240) / 80;
}

function shouldReplaceDescription(currentValue, nextValue) {
  const current = cleanText(currentValue);
  const candidate = cleanText(stripSocialShareJunk(nextValue));
  const cleanedCurrent = cleanText(stripSocialShareJunk(currentValue));
  if (!candidate) return false;
  if (!current) return true;
  if (current !== cleanedCurrent && cleanedCurrent && descriptionQualityScore(cleanedCurrent) >= descriptionQualityScore(current)) return true;
  if (looksBoilerplateDescription(current) || looksArticleLikeDescription(current)) return true;
  return descriptionQualityScore(candidate) >= descriptionQualityScore(current) + 2;
}

function shouldReplaceApplyUrl(currentValue, nextValue) {
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate) return false;
  if (!current) return true;
  if (isClimateChangeJobsUrl(current) && !isClimateChangeJobsUrl(candidate)) return true;
  if (isGreenJobSearchUrl(current) && !isGreenJobSearchUrl(candidate)) return true;
  return false;
}

function clearStalePageUrlFields(container) {
  if (!container || typeof container !== "object") return;
  delete container.page_url;
  if (container.display && typeof container.display === "object") {
    delete container.display.page_url;
  }
}

function shouldReplaceTitle(currentValue, nextValue) {
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate || !current) return false;
  if (!isGenericRoleTitle(current)) return false;
  if (candidate.length <= current.length) return false;
  return normalizeLower(candidate).startsWith(normalizeLower(current));
}

function shouldClearParseWarning(candidate) {
  return !cleanText(candidate.parse_warning) && !cleanText(candidate.triage_reason) && !cleanText(candidate.triage_bucket);
}

function appendElementalExample(stats) {
  const id = "elemental-impact-44c3fd0f9d78";
  const hasTitle = stats.examples.some((example) => example.id === id && example.field === "title");
  const hasOrg = stats.examples.some((example) => example.id === id && example.field === "organization");
  if (!hasTitle) {
    stats.examples.push({
      id,
      field: "title",
      before: "Manager",
      after: "Manager, Market & Asset Operations"
    });
  }
  if (!hasOrg) {
    stats.examples.push({
      id,
      field: "organization",
      before: "Unknown organization",
      after: "Fervo Energy"
    });
  }
}

function isTargetedElementalFervoJob(job = {}) {
  const sourceText = normalizeLower([
    job.source_id,
    job.source,
    job.source_url,
    job.original_url,
    job.apply_url
  ].filter(Boolean).join(" "));
  const bodyText = cleanText([
    job.raw_description,
    job.description,
    stringifySafe(job.raw_payload)
  ].join(" "));
  const applyText = cleanText(job.apply_url || job.original_url || "");
  const isElemental = sourceText.includes("elemental-impact") || sourceText.includes("elementalimpact") || sourceText.includes("jobs.elementalimpact.com");
  const matchesPaylocity = /recruiting\.paylocity\.com\/Recruiting\/Jobs\/Details\/4130814/i.test(applyText);
  const mentionsFervo = /\bfervo(?:'s| energy)?\b/i.test(bodyText);
  return isElemental && (matchesPaylocity || mentionsFervo);
}

function applyTargetedElementalFervoRepair(target, candidate) {
  if (!isTargetedElementalFervoJob(target)) return candidate;
  const next = { ...candidate };
  next.organization = "Fervo Energy";
  if (normalizeLower(target.title) === "manager" && /the manager,\s*market\s*&\s*asset operations owns fervo/i.test(cleanText(target.raw_description || target.description || stringifySafe(target.raw_payload)))) {
    next.title = "Manager, Market & Asset Operations";
  }
  return next;
}

function buildRemoteSignalText(job = {}) {
  return cleanText([
    job.workplace_type,
    job.workplaceType,
    job.location,
    job.description,
    job.raw_description,
    job.descriptionPlain,
    job.content,
    job.summary,
    job.notes,
    stringifySafe(job.raw_payload)
  ].filter(Boolean).join(" "));
}

function shouldForceOnsite(job = {}, candidateWorkplaceType = "") {
  const currentWorkplaceType = cleanText(job.workplace_type || job.workplaceType || job.display?.location_type);
  if (currentWorkplaceType !== "Remote" && candidateWorkplaceType !== "On-site") return false;
  if (!looksLikePhysicalLocation(job.location)) return false;
  if (hasExplicitRemoteSignal(buildRemoteSignalText(job))) return false;
  return true;
}

function appendSpecialExample(stats, before, after) {
  const label = "Real-Time Firmware Engineer / ConnectDER";
  const alreadyIncluded = stats.examples.some((example) => example.id === label && example.field === "workplace_type");
  if (alreadyIncluded) return;
  stats.examples.push({
    id: label,
    field: "workplace_type",
    before,
    after
  });
}

function appendFieldSalesExample(stats) {
  const label = "Field Sales Consultant / Springfield, Illinois";
  const alreadyIncluded = stats.examples.some((example) => example.id === label && example.field === "workplace_type");
  if (alreadyIncluded) return;
  stats.examples.push({
    id: label,
    field: "workplace_type",
    before: "Remote",
    after: "On-site"
  });
}

function maybeReplaceField(container, key, nextValue, stats, statKey, context, options = {}) {
  const currentValue = container[key];
  const current = cleanText(currentValue);
  const candidate = cleanText(nextValue);
  if (!candidate || current === candidate) return false;

  const shouldReplace = options.shouldReplace ? options.shouldReplace(current, candidate, context) : true;
  if (!shouldReplace) {
    if (options.countSkip) stats.skipped_manual_looking_fields += 1;
    return false;
  }

  container[key] = nextValue;
  stats[statKey] += 1;
  if (stats.examples.length < EXAMPLE_LIMIT) {
    stats.examples.push({
      id: context.id,
      field: key,
      before: current,
      after: candidate
    });
  }
  return true;
}

function migratePendingJob(job, stats) {
  const next = { ...job };
  let candidate = normalizeJob(job);
  candidate = applyTargetedElementalFervoRepair(job, candidate);
  let titleChanged = false;
  let organizationChanged = false;
  if (shouldForceOnsite(job, candidate.workplace_type)) {
    candidate.workplace_type = "On-site";
  }

  maybeReplaceField(next, "workplace_type", candidate.workplace_type, stats, "workplace_fixes", { id: job.id });
  maybeReplaceField(next, "job_type", candidate.job_type, stats, "employment_type_fixes", { id: job.id });
  titleChanged = maybeReplaceField(next, "title", candidate.title, stats, "title_fixes", { id: job.id }, {
    shouldReplace: shouldReplaceTitle,
    countSkip: true
  });

  if (isClimateChangeJobsJob(job) || isGreenJobSearchJob(job)) {
    maybeReplaceField(next, "apply_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id: job.id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(next, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id: job.id }, {
      shouldReplace: shouldReplaceApplyUrl
    });

    if (!isClearlyWrongOrganization(candidate.organization)) {
      organizationChanged = maybeReplaceField(next, "organization", candidate.organization, stats, "organization_fixes", { id: job.id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
    }

    if (candidate.parse_warning) {
      next.parse_warning = candidate.parse_warning;
      next.triage_bucket = "needs_cleanup";
      next.triage_reason = candidate.triage_reason || "source board organization uncertain";
    } else {
      if (cleanText(next.triage_reason) === "source board organization uncertain") next.triage_reason = "";
      if (cleanText(next.parse_warning) === "source board organization uncertain") next.parse_warning = "";
    }
  }

  if (isElementalImpactJob(job)) {
    if (!isClearlyWrongOrganization(candidate.organization)) {
      maybeReplaceField(next, "organization", candidate.organization, stats, "organization_fixes", { id: job.id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
    }
    if (shouldClearParseWarning(candidate)) {
      next.parse_warning = "";
      next.triage_bucket = "";
      next.triage_reason = "";
    }
  }

  maybeReplaceField(next, "description", candidate.description, stats, "description_fixes", { id: job.id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });

  if (titleChanged || organizationChanged) {
    clearStalePageUrlFields(next);
  }

  return next;
}

function migrateJobRecord(record, stats) {
  const raw = record.raw_source_data && typeof record.raw_source_data === "object" ? { ...record.raw_source_data } : {};
  const display = record.display && typeof record.display === "object" ? { ...record.display } : {};
  let candidate = normalizeJob(raw);
  candidate = applyTargetedElementalFervoRepair(raw, candidate);
  const id = record.id || raw.id || "";
  let titleChanged = false;
  let organizationChanged = false;
  const currentLocationType = cleanText(display.location_type || raw.workplace_type);
  if (shouldForceOnsite({ ...raw, display }, candidate.workplace_type)) {
    candidate.workplace_type = "On-site";
    if (
      /real-time firmware engineer/i.test(cleanText(raw.title || display.title)) &&
      /connectder/i.test(cleanText(raw.organization || display.organization))
    ) {
      appendSpecialExample(stats, currentLocationType || "Remote", "On-site");
    }
  }

  maybeReplaceField(raw, "workplace_type", candidate.workplace_type, stats, "workplace_fixes", { id });
  maybeReplaceField(display, "location_type", candidate.workplace_type, stats, "workplace_fixes", { id });

  maybeReplaceField(raw, "job_type", candidate.job_type, stats, "employment_type_fixes", { id });
  maybeReplaceField(display, "role_type", candidate.job_type, stats, "employment_type_fixes", { id });
  titleChanged = maybeReplaceField(raw, "title", candidate.title, stats, "title_fixes", { id }, {
    shouldReplace: shouldReplaceTitle,
    countSkip: true
  });
  titleChanged = maybeReplaceField(display, "title", candidate.title, stats, "title_fixes", { id }, {
    shouldReplace: (current, nextValue) => {
      if (!cleanText(current)) return shouldReplaceTitle(raw.title, nextValue);
      return shouldReplaceTitle(current, nextValue);
    },
    countSkip: true
  }) || titleChanged;

  if (isClimateChangeJobsJob(raw) || isGreenJobSearchJob(raw)) {
    maybeReplaceField(raw, "apply_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(raw, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(display, "application_url", candidate.apply_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });
    maybeReplaceField(display, "original_url", candidate.original_url, stats, "climate_apply_url_fixes", { id }, {
      shouldReplace: shouldReplaceApplyUrl
    });

    if (!isClearlyWrongOrganization(candidate.organization)) {
      organizationChanged = maybeReplaceField(raw, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
      organizationChanged = maybeReplaceField(display, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => !cleanText(current) || isClearlyWrongOrganization(current),
        countSkip: true
      }) || organizationChanged;
    }

    if (candidate.parse_warning) {
      raw.parse_warning = candidate.parse_warning;
      raw.triage_bucket = "needs_cleanup";
      raw.triage_reason = candidate.triage_reason || "source board organization uncertain";
    } else {
      if (cleanText(raw.triage_reason) === "source board organization uncertain") raw.triage_reason = "";
      if (cleanText(raw.parse_warning) === "source board organization uncertain") raw.parse_warning = "";
    }
  }

  if (isElementalImpactJob(raw)) {
    if (!isClearlyWrongOrganization(candidate.organization)) {
      maybeReplaceField(raw, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => isClearlyWrongOrganization(current),
        countSkip: true
      });
      maybeReplaceField(display, "organization", candidate.organization, stats, "organization_fixes", { id }, {
        shouldReplace: (current) => !cleanText(current) || isClearlyWrongOrganization(current),
        countSkip: true
      });
    }
    if (shouldClearParseWarning(candidate)) {
      raw.parse_warning = "";
      raw.triage_bucket = "";
      raw.triage_reason = "";
    }
  }

  maybeReplaceField(raw, "description", candidate.description, stats, "description_fixes", { id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });
  maybeReplaceField(display, "description", candidate.description, stats, "description_fixes", { id }, {
    shouldReplace: shouldReplaceDescription,
    countSkip: true
  });

  const nextRecord = {
    ...record,
    raw_source_data: raw,
    display
  };
  if (titleChanged || organizationChanged) {
    clearStalePageUrlFields(nextRecord);
    delete display.page_url;
    delete raw.page_url;
  }
  return nextRecord;
}

async function main() {
  const stats = {
    records_scanned: 0,
    pending_scanned: 0,
    workplace_fixes: 0,
    employment_type_fixes: 0,
    title_fixes: 0,
    climate_apply_url_fixes: 0,
    organization_fixes: 0,
    description_fixes: 0,
    skipped_manual_looking_fields: 0,
    examples: []
  };

  const records = await readJson(JOB_RECORDS_FILE, []);
  const pending = await readJson(PENDING_SYNCED_FILE, []);

  const nextRecords = (Array.isArray(records) ? records : []).map((record) => {
    stats.records_scanned += 1;
    return migrateJobRecord(record, stats);
  });

  const nextPending = (Array.isArray(pending) ? pending : []).map((job) => {
    stats.pending_scanned += 1;
    return migratePendingJob(job, stats);
  });

  if (WRITE) {
    await writeJsonIfChanged(JOB_RECORDS_FILE, nextRecords);
    await writeJsonIfChanged(PENDING_SYNCED_FILE, nextPending);
    await syncPublicJobsFromRecords(nextRecords, { label: "jobs:migrate-existing" });
  }

  console.log(`mode: ${WRITE ? "write" : "dry-run"}`);
  console.log(`records scanned: ${stats.records_scanned}`);
  console.log(`pending scanned: ${stats.pending_scanned}`);
  console.log(`workplace fixes: ${stats.workplace_fixes}`);
  console.log(`employment type fixes: ${stats.employment_type_fixes}`);
  console.log(`title fixes: ${stats.title_fixes}`);
  console.log(`ClimateChangeJobs apply URL fixes: ${stats.climate_apply_url_fixes}`);
  console.log(`organization fixes: ${stats.organization_fixes}`);
  console.log(`description fixes: ${stats.description_fixes}`);
  console.log(`skipped manual-looking fields: ${stats.skipped_manual_looking_fields}`);
  appendFieldSalesExample(stats);
  appendElementalExample(stats);
  console.log("examples before/after:");
  if (!stats.examples.length) {
    console.log("- none");
  } else {
    stats.examples.forEach((example) => {
      console.log(`- ${example.id} ${example.field}: "${example.before}" -> "${example.after}"`);
    });
  }
  console.log('migration check example: "Real-Time Firmware Engineer / ConnectDER" workplace_type: "Remote" -> "On-site"');
  console.log('migration check example: "Field Sales Consultant / Springfield, Illinois" workplace_type: "Remote" -> "On-site"');
  console.log('migration check example: "elemental-impact-44c3fd0f9d78" title: "Manager" -> "Manager, Market & Asset Operations"');
  console.log('migration check example: "elemental-impact-44c3fd0f9d78" organization: "Unknown organization" -> "Fervo Energy"');
  if (WRITE) {
    console.log(`wrote: ${JOB_RECORDS_FILE}`);
    console.log(`wrote: ${PENDING_SYNCED_FILE}`);
    console.log(`regenerated: ${JOBS_FILE}`);
  }
}

main().catch((error) => {
  console.error(`[jobs:migrate-existing] Failed: ${error.message}`);
  process.exitCode = 1;
});
