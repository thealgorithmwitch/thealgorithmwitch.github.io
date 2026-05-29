const BLOCKED_SOURCE_RULES = [
  { id: "articulate", pattern: /\barticulate\b/i },
  { id: "empowerly", pattern: /\bempowerly\b/i },
  { id: "remofirst", pattern: /\bremofirst\b/i },
  { id: "recidiviz", pattern: /\brecidiviz\b/i },
  { id: "cribl", pattern: /\bcribl\b/i },
  { id: "found", pattern: /\bfound\b(?!(?:\s+not|\s+that|\s+in|\s+out|\s+on|\s+for|\s+at|\s+by|\s+upon|ed\b))/i },
  { id: "canonical", pattern: /\bcanonical(?:jobs)?\b/i },
  { id: "cohere", pattern: /\bcohere\b/i },
  { id: "chilipiper", pattern: /\bchilipiper\b/i },
  { id: "beehiiv", pattern: /\bbeehiiv\b/i },
  { id: "posthog", pattern: /\bposthog\b/i },
  { id: "automattic", pattern: /\bautomattic\b/i },
  { id: "superside", pattern: /\bsuperside\b/i },
  { id: "samsara", pattern: /\bsamsara\b/i },
  { id: "gusto", pattern: /\bgusto\b/i },
  { id: "climatechangejobs", pattern: /\bclimate\s*change\s*jobs\b|\bclimatechangejobs\b|\bclimate-change-jobs\b/i },
  { id: "saas-group", pattern: /\bsaas\.group\b/i },
  { id: "reformation", pattern: /\b(?:reformation|reformashion)\b/i },
  { id: "remix", pattern: /\b(?:remix|r[eé]mix)\b/i },
  { id: "woolpert", pattern: /\b(?:woolpert|wolpert)\b/i },
  { id: "woolpert-inc", pattern: /\bwoolpert\s+(?:inc|llc|co)\b/i },
  { id: "woolpert-com", pattern: /\bwoolpert\.com\b/i }
];

function stringify(value) {
  return String(value || "").trim();
}

function valuesForBlockedSourceCheck(entry = {}) {
  if (!entry || typeof entry !== "object") {
    return [stringify(entry)];
  }
  return [
    entry.id,
    entry.ref,
    entry.external_id,
    entry.source_id,
    entry.source_name,
    entry.source,
    entry.provider,
    entry.organization,
    entry.name,
    entry.url,
    entry.source_url,
    entry.apply_url,
    entry.original_url,
    entry.known_careers_url,
    entry.notes,
    entry.query
  ].map((value) => stringify(value)).filter(Boolean);
}

function getBlockedSourceRuleForValue(value) {
  const text = stringify(value);
  if (!text) return null;
  return BLOCKED_SOURCE_RULES.find((rule) => rule.pattern.test(text)) || null;
}

function getBlockedSourceRuleForEntry(entry) {
  for (const value of valuesForBlockedSourceCheck(entry)) {
    const rule = getBlockedSourceRuleForValue(value);
    if (rule) return rule;
  }
  return null;
}

function isBlockedSourceEntry(entry) {
  return Boolean(getBlockedSourceRuleForEntry(entry));
}

function filterBlockedSourceEntries(entries = []) {
  return Array.isArray(entries) ? entries.filter((entry) => !isBlockedSourceEntry(entry)) : [];
}

module.exports = {
  BLOCKED_SOURCE_RULES,
  filterBlockedSourceEntries,
  getBlockedSourceRuleForEntry,
  getBlockedSourceRuleForValue,
  isBlockedSourceEntry,
  stringify,
  valuesForBlockedSourceCheck
};
