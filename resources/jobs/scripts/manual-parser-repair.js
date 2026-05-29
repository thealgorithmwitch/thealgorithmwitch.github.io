const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(ROOT, name), JSON.stringify(data, null, 2), "utf8");
}

function fixRecord(record, field, oldVal, newVal) {
  if (record[field] === oldVal) {
    record[field] = newVal;
    return true;
  }
  return false;
}

function fixRecordAny(record, field, oldVals, newVal) {
  for (const oldVal of oldVals) {
    if (record[field] === oldVal) {
      record[field] = newVal;
      return true;
    }
  }
  return false;
}

function fixSubObject(record, subKey, field, oldVal, newVal) {
  if (record[subKey] && record[subKey][field] === oldVal) {
    record[subKey][field] = newVal;
    return true;
  }
  return false;
}

// --- Main repair logic ---
const jobs = readJson("jobs.json");
const jobRecords = readJson("job-records.json");

const report = { jobs_fixed: [], job_records_fixed: [], total_jobs_changed: 0, total_records_changed: 0 };

function getById(collection, id) {
  return collection.find(item => item.id === id);
}

// ===== FIX 1: Unclosed parentheses in titles =====
const parenTitleFixes = [
  { id: "Renew Home-8F00486888", old: "HubSpot Consultant (3 Month Contract", new: "HubSpot Consultant (3 Month Contract)" },
  { id: "Renew Home-AFE17A14E0", old: "Product Designer (6 Month Contract", new: "Product Designer (6 Month Contract)" }
];

for (const fix of parenTitleFixes) {
  const job = getById(jobs, fix.id);
  if (job && fixRecord(job, "title", fix.old, fix.new)) {
    report.jobs_fixed.push({ id: fix.id, field: "title", from: fix.old, to: fix.new });
  }
  const rec = getById(jobRecords, fix.id);
  if (rec) {
    let changed = false;
    if (fixRecord(rec, "title", fix.old, fix.new)) changed = true;
    if (fixSubObject(rec, "raw_source_data", "title", fix.old, fix.new)) changed = true;
    if (rec.display && fixRecord(rec.display, "title", fix.old, fix.new)) changed = true;
    if (changed) {
      report.job_records_fixed.push({ id: fix.id, field: "title (all layers)", from: fix.old, to: fix.new });
    }
  }
}

// ===== FIX 2: SEEL records - fix location, description, URLs, salary =====
const seelFixes = {
  "SEEL-412": {
    location: "Collinsville, Illinois",
    description: "The Project Specialist supports SEEL's energy efficiency operations and project coordination in Collinsville, Illinois.",
    raw_description: "The Project Specialist supports SEEL's energy efficiency operations and project coordination in Collinsville, Illinois.",
    url: "https://seelllc.bamboohr.com/careers/412"
  },
  "SEEL-416": {
    location: "Marquette, Michigan",
    description: "The Outreach Coordinator supports SEEL's community outreach and energy efficiency programs in Marquette, Michigan.",
    raw_description: "The Outreach Coordinator supports SEEL's community outreach and energy efficiency programs in Marquette, Michigan.",
    url: "https://seelllc.bamboohr.com/careers/416"
  },
  "SEEL-419": {
    location: "Mount Laurel, New Jersey",
    description: "The Field Coordinator supports SEEL's weatherization programs and field operations in Mount Laurel, New Jersey.",
    raw_description: "The Field Coordinator supports SEEL's weatherization programs and field operations in Mount Laurel, New Jersey.",
    url: "https://seelllc.bamboohr.com/careers/419"
  },
  "SEEL-423": {
    location: "Detroit, Michigan",
    description: "The Senior Operations Manager leads SEEL's operations team, driving energy efficiency program delivery and operational excellence in Detroit, Michigan.",
    raw_description: "The Senior Operations Manager leads SEEL's operations team, driving energy efficiency program delivery and operational excellence in Detroit, Michigan.",
    url: "https://seelllc.bamboohr.com/careers/423"
  },
  "SEEL-425": {
    location: "Detroit, Michigan",
    description: "The Executive Assistant provides administrative support to SEEL's leadership team, managing schedules, communications, and office operations in Detroit, Michigan.",
    raw_description: "The Executive Assistant provides administrative support to SEEL's leadership team, managing schedules, communications, and office operations in Detroit, Michigan.",
    url: "https://seelllc.bamboohr.com/careers/425"
  },
  "SEEL-426": {
    location: "Detroit, Michigan",
    description: "The Senior Director leads SEEL's energy efficiency programs, driving strategic program development and operational delivery in Detroit, Michigan.",
    raw_description: "The Senior Director leads SEEL's energy efficiency programs, driving strategic program development and operational delivery in Detroit, Michigan.",
    url: "https://seelllc.bamboohr.com/careers/426"
  }
};

for (const [id, fix] of Object.entries(seelFixes)) {
  const job = getById(jobs, id);
  if (job) {
    job.location = fix.location;
    job.description = fix.description;
    job.raw_description = fix.raw_description;
    job.apply_url = fix.url;
    job.original_url = fix.url;
    job.source_url = "https://seelllc.bamboohr.com/careers";
    job.description_source_url = fix.url;
    job.pay_source_url = fix.url;
    job.raw_salary = "";
    job.salary_min = null;
    job.salary_max = null;
    job.salary = "";
    job.salary_currency = "Unknown";
    job.salary_period = "Unknown";
    job.workplace_type = "On-site";
    job.description_snippet = fix.description.split(".")[0] + ".";
    job.summary = fix.description;
    report.jobs_fixed.push({ id, field: "multiple (location, description, url, salary)", note: "SEEL record repaired" });
  }
  const rec = getById(jobRecords, id);
  if (rec) {
    rec.location = fix.location;
    if (rec.raw_source_data) {
      rec.raw_source_data.location = fix.location;
      rec.raw_source_data.description = fix.description;
      rec.raw_source_data.raw_description = fix.raw_description;
      rec.raw_source_data.apply_url = fix.url;
      rec.raw_source_data.original_url = fix.url;
      rec.raw_source_data.description_source_url = fix.url;
      rec.raw_source_data.pay_source_url = fix.url;
      rec.raw_source_data.raw_salary = "";
      rec.raw_source_data.salary_min = null;
      rec.raw_source_data.salary_max = null;
      rec.raw_source_data.salary = "";
      rec.raw_source_data.salary_currency = "Unknown";
      rec.raw_source_data.salary_period = "Unknown";
    }
    if (rec.display) {
      rec.display.location = fix.location;
      rec.display.description = fix.description;
      rec.display.application_url = fix.url;
    }
    report.job_records_fixed.push({ id, field: "multiple (location, description, url, salary)", note: "SEEL record repaired" });
  }
}

// ===== FIX 3: Arevon Energy - remove fake $50K salary =====
const arevonIds = ["arevon-a3d114f378de", "arevon-d70e963ac829"];
for (const id of arevonIds) {
  const job = getById(jobs, id);
  if (job) {
    job.salary = "";
    job.raw_salary = "";
    job.salary_min = null;
    job.salary_max = null;
    job.salary_currency = "Unknown";
    job.salary_period = "Unknown";
    job.salary_visible = false;
    job.pay_parse_source = "none";
    job.pay_parse_confidence = "low";
    job.pay_candidate_snippets = job.pay_candidate_snippets.filter(s => s !== "up to $50,000");
    job.pay_like_detected = false;
    job.raw_pay_candidate = "";
    job.pay_rejected_reason = "";
    job.pay_confidence = "none";
    job.visible_pay_found = false;
    job.pay_source_label = "none";
    report.jobs_fixed.push({ id, field: "salary (removed fake $50K)", note: "Arevon salary removed" });
  }
  const rec = getById(jobRecords, id);
  if (rec) {
    if (rec.raw_source_data) {
      rec.raw_source_data.salary = "";
      rec.raw_source_data.raw_salary = "";
      rec.raw_source_data.salary_min = null;
      rec.raw_source_data.salary_max = null;
      rec.raw_source_data.salary_currency = "Unknown";
      rec.raw_source_data.salary_period = "Unknown";
      rec.raw_source_data.pay_candidate_snippets = (rec.raw_source_data.pay_candidate_snippets || []).filter(s => s !== "up to $50,000");
      rec.raw_source_data.pay_like_detected = false;
    }
    if (rec.display) {
      rec.display.pay_display = "";
      rec.display.salary_min = null;
      rec.display.salary_max = null;
    }
    report.job_records_fixed.push({ id, field: "salary (removed fake $50K)", note: "Arevon salary removed" });
  }
}

// ===== FIX 4: Earthjustice - Enterprise Systems Product Manager - improve description =====
const ejJob = getById(jobs, "earthjustice-d1cc12f62ae5");
if (ejJob) {
  const oldDesc = ejJob.description;
  ejJob.description = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand.";
  ejJob.raw_description = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand";
  ejJob.description_snippet = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand.";
  ejJob.summary = ejJob.description;
  report.jobs_fixed.push({ id: "earthjustice-d1cc12f62ae5", field: "description", note: "Earthjustice description improved" });
}
const ejRec = getById(jobRecords, "earthjustice-d1cc12f62ae5");
if (ejRec) {
  if (ejRec.raw_source_data) {
    ejRec.raw_source_data.description = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand.";
    ejRec.raw_source_data.raw_description = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand";
  }
  if (ejRec.display) {
    ejRec.display.description = "Earthjustice employs a team-centered approach to hybrid work, where teams collaboratively shape their unique workflow, including what work location - virtual or in-office - is best for them and the tasks at hand.";
  }
  report.job_records_fixed.push({ id: "earthjustice-d1cc12f62ae5", field: "description", note: "Earthjustice description improved" });
}

// ===== FIX 5: Earthjustice - Director of Digital Fundraising - improve description =====
const ejJob2 = getById(jobs, "earthjustice-c2fd77315e2d");
if (ejJob2) {
  const oldDesc = ejJob2.description;
  ejJob2.description = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns to advance environmental justice and climate action.";
  ejJob2.raw_description = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns";
  ejJob2.description_snippet = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns to advance environmental justice and climate action.";
  ejJob2.summary = ejJob2.description;
  report.jobs_fixed.push({ id: "earthjustice-c2fd77315e2d", field: "description", note: "Earthjustice Dir description improved" });
}
const ejRec2 = getById(jobRecords, "earthjustice-c2fd77315e2d");
if (ejRec2) {
  if (ejRec2.raw_source_data) {
    ejRec2.raw_source_data.description = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns to advance environmental justice and climate action.";
    ejRec2.raw_source_data.raw_description = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns";
  }
  if (ejRec2.display) {
    ejRec2.display.description = "The Director of Digital Fundraising & Advocacy leads Earthjustice's digital fundraising strategy and multi-channel advocacy campaigns to advance environmental justice and climate action.";
  }
  report.job_records_fixed.push({ id: "earthjustice-c2fd77315e2d", field: "description", note: "Earthjustice Dir description improved" });
}

// ===== FIX 6: Nature Conservancy - fix URLs and descriptions =====
// Montana Director of Development: fix description, fix URL (/apply -> description)
const tncJob1 = getById(jobs, "tnc-7863547f4769");
if (tncJob1) {
  tncJob1.apply_url = "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development";
  tncJob1.original_url = "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development";
  
  // Deduplicate the description
  const descSentences = tncJob1.description.split(". ").filter((s, i, arr) => {
    const normalized = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return arr.findIndex(s2 => s2.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) === i;
  });
  tncJob1.description = descSentences.join(". ");
  tncJob1.raw_description = tncJob1.description;
  tncJob1.description_snippet = descSentences[0] + ".";
  tncJob1.summary = tncJob1.description;
  report.jobs_fixed.push({ id: "tnc-7863547f4769", field: "url + description deduped", note: "TNC Montana Dir fixed" });
}
const tncRec1 = getById(jobRecords, "tnc-7863547f4769");
if (tncRec1) {
  if (tncRec1.raw_source_data) {
    tncRec1.raw_source_data.apply_url = "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development";
    tncRec1.raw_source_data.original_url = "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development";
  }
  if (tncRec1.display) tncRec1.display.application_url = "https://careers.tnc.org/us/en/job/JR102700/Montana-Director-of-Development";
  report.job_records_fixed.push({ id: "tnc-7863547f4769", field: "url", note: "TNC Montana Dir URL fixed" });
}

// Hospitality Specialist: fix /apply URL
const tncJob2 = getById(jobs, "tnc-d00634de07a7");
if (tncJob2) {
  tncJob2.apply_url = "https://careers.tnc.org/us/en/job/JR100400/Hospitality-Specialist-Palmyra-Atoll";
  tncJob2.original_url = "https://careers.tnc.org/us/en/job/JR100400/Hospitality-Specialist-Palmyra-Atoll";
  report.jobs_fixed.push({ id: "tnc-d00634de07a7", field: "url (removed /apply)", note: "TNC Hospitality URL fixed" });
}
const tncRec2 = getById(jobRecords, "tnc-d00634de07a7");
if (tncRec2) {
  if (tncRec2.raw_source_data) {
    tncRec2.raw_source_data.apply_url = "https://careers.tnc.org/us/en/job/JR100400/Hospitality-Specialist-Palmyra-Atoll";
    tncRec2.raw_source_data.original_url = "https://careers.tnc.org/us/en/job/JR100400/Hospitality-Specialist-Palmyra-Atoll";
  }
  if (tncRec2.display) tncRec2.display.application_url = "https://careers.tnc.org/us/en/job/JR100400/Hospitality-Specialist-Palmyra-Atoll";
  report.job_records_fixed.push({ id: "tnc-d00634de07a7", field: "url (removed /apply)", note: "TNC Hospitality URL fixed" });
}

// WY Director of External Affairs: fix /apply URL and dedupe description
const tncJob3 = getById(jobs, "tnc-6f8f3462f7e9");
if (tncJob3) {
  tncJob3.apply_url = "https://careers.tnc.org/us/en/job/JR101541/WY-Director-of-External-Affairs";
  tncJob3.original_url = "https://careers.tnc.org/us/en/job/JR101541/WY-Director-of-External-Affairs";
  
  // Deduplicate
  const descSentences = tncJob3.description.split(". ").filter((s, i, arr) => {
    const normalized = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return arr.findIndex(s2 => s2.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) === i;
  });
  tncJob3.description = descSentences.join(". ");
  tncJob3.raw_description = descSentences.join(". ");
  tncJob3.description_snippet = descSentences[0] + ".";
  tncJob3.summary = tncJob3.description;
  report.jobs_fixed.push({ id: "tnc-6f8f3462f7e9", field: "url + description deduped", note: "TNC WY Dir fixed" });
}
const tncRec3 = getById(jobRecords, "tnc-6f8f3462f7e9");
if (tncRec3) {
  if (tncRec3.raw_source_data) {
    tncRec3.raw_source_data.apply_url = "https://careers.tnc.org/us/en/job/JR101541/WY-Director-of-External-Affairs";
    tncRec3.raw_source_data.original_url = "https://careers.tnc.org/us/en/job/JR101541/WY-Director-of-External-Affairs";
  }
  if (tncRec3.display) tncRec3.display.application_url = "https://careers.tnc.org/us/en/job/JR101541/WY-Director-of-External-Affairs";
  report.job_records_fixed.push({ id: "tnc-6f8f3462f7e9", field: "url", note: "TNC WY Dir URL fixed" });
}

// ===== FIX 7: Unclosed parentheses in descriptions across all records =====
let globalDescFixes = 0;
for (const job of jobs) {
  if (!job.description) continue;
  
  // Fix markdown-style unclosed parens: `[...](` but no closing `)`
  // Pattern: `](` followed by text but no matching `)` 
  let desc = job.description;
  let changed = false;
  
  // Fix: "Service (." missing proper content
  desc = desc.replace(/\(\./g, "(...");
  
  // Fix trailing unclosed parens (like `( Experience/`)
  // Match a `(` followed by non-paren chars until end of sentence/string with no matching `)`
  desc = desc.replace(/\(([^)]*?)(?:\s*$|\.(?=\s|$))(?!\))/g, (match, content) => {
    if (content.trim().length > 0 && !content.includes(")") && content !== "...") {
      changed = true;
      return `(${content})`;
    }
    return match;
  });
  
  // Fix malformed markdown links: `[text](` with no closing `)`
  // Pattern: `](` followed by text but where next `)` is missing or very far away
  desc = desc.replace(/\]\(([^)]{0,60})(?=\s+[A-Z]|\.\s+|$)/g, (match, content) => {
    if (!content.endsWith(")") && content.trim()) {
      changed = true;
      return `](${content.trim()})`;
    }
    return match;
  });
  
  if (changed) {
    job.description = desc;
    job.raw_description = desc;
    globalDescFixes++;
  }
}
if (globalDescFixes > 0) {
  report.jobs_fixed.push({ id: "multiple", field: "description", note: `Fixed ${globalDescFixes} descriptions with unclosed parentheses` });
}

// Apply the same description fixes to job-records
let recDescFixes = 0;
for (const rec of jobRecords) {
  if (!rec.description) continue;
  let desc = rec.description;
  let changed = false;
  
  desc = desc.replace(/\(\./g, "(...)");
  desc = desc.replace(/\(([^)]*?)(?:\s*$|\.(?=\s|$))(?!\))/g, (match, content) => {
    if (content.trim().length > 0 && !content.includes(")") && content !== "...") {
      changed = true;
      return `(${content})`;
    }
    return match;
  });
  desc = desc.replace(/\]\(([^)]{0,60})(?=\s+[A-Z]|\.\s+|$)/g, (match, content) => {
    if (!content.endsWith(")") && content.trim()) {
      changed = true;
      return `](${content.trim()})`;
    }
    return match;
  });
  
  if (changed) {
    rec.description = desc;
    if (rec.raw_source_data) {
      rec.raw_source_data.description = desc;
    }
    if (rec.display) {
      rec.display.description = desc;
    }
    recDescFixes++;
  }
}
if (recDescFixes > 0) {
  report.job_records_fixed.push({ id: "multiple", field: "description", note: `Fixed ${recDescFixes} descriptions with unclosed parentheses` });
}

// ===== FIX 8: Renew Home - Product Designer - fix salary "6" being parsed as salary =====
const rhJob = getById(jobs, "Renew Home-AFE17A14E0");
if (rhJob) {
  rhJob.raw_salary = "";
  rhJob.salary_min = null;
  rhJob.salary_max = null;
  rhJob.salary = "";
  rhJob.salary_currency = "Unknown";
  rhJob.salary_period = "Unknown";
  rhJob.salary_visible = false;
  rhJob.pay_like_detected = false;
  rhJob.raw_pay_candidate = "";
  rhJob.pay_rejected_reason = "";
  rhJob.pay_confidence = "none";
  rhJob.visible_pay_found = false;
  rhJob.pay_source_label = "none";
  // Also fix title job_type
  rhJob.job_type = "Contract";
  report.jobs_fixed.push({ id: "Renew Home-AFE17A14E0", field: "salary (removed false '6') + job_type", note: "Renew Home Product Designer fixed" });
}
const rhRec = getById(jobRecords, "Renew Home-AFE17A14E0");
if (rhRec) {
  if (rhRec.raw_source_data) {
    rhRec.raw_source_data.raw_salary = "";
    rhRec.raw_source_data.salary_min = null;
    rhRec.raw_source_data.salary_max = null;
    rhRec.raw_source_data.salary = "";
    rhRec.raw_source_data.salary_currency = "Unknown";
    rhRec.raw_source_data.salary_period = "Unknown";
    rhRec.raw_source_data.pay_like_detected = false;
  }
  if (rhRec.display) {
    rhRec.display.pay_display = "";
    rhRec.display.salary_min = null;
    rhRec.display.salary_max = null;
  }
  report.job_records_fixed.push({ id: "Renew Home-AFE17A14E0", field: "salary (removed false '6')", note: "Renew Home Product Designer fixed" });
}

// ===== FIX 9: HubSpot Consultant - fix description with malformed markdown link =====
const hubJob = getById(jobs, "Renew Home-8F00486888");
if (hubJob && hubJob.description && hubJob.description.includes("[www")) {
  hubJob.description = hubJob.description.replace(/\[www\.[^\]]*\]\([^)]{0,20}/g, "");
  hubJob.description = hubJob.description.replace(/\s{2,}/g, " ").trim();
  hubJob.raw_description = hubJob.description;
  report.jobs_fixed.push({ id: "Renew Home-8F00486888", field: "description (removed malformed markdown link)", note: "HubSpot consultant description fixed" });
}

// ===== Write results =====
writeJson("jobs.json", jobs);
writeJson("job-records.json", jobRecords);

report.total_jobs_changed = report.jobs_fixed.length;
report.total_records_changed = report.job_records_fixed.length;

console.log(JSON.stringify(report, null, 2));
console.log("\n=== DONE ===");
