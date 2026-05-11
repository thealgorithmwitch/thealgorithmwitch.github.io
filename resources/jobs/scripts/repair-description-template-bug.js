const fs = require("fs/promises");
const path = require("path");
const {
  applyTitleToMalformedTemplate,
  buildDescriptionSnippet,
  buildFallbackDescription,
  hasMalformedDescriptionTemplate,
  hasUsableDescription,
  normalizeDescription
} = require("./job-normalizer");
const { JOBS_FILE, readJobs, writeJson } = require("./job-utils");
const { JOB_RECORDS_FILE, readJobRecords } = require("./public-records");
const { buildPagesForSelectedJobs } = require("./generate-job-pages");
const { buildValidationReport } = require("./validate-public-data");

const ROOT = path.resolve(__dirname, "..");
const OLD_JOBS_FILE = path.join(ROOT, "oldjobs.json");
const REPORT_JSON = path.join(ROOT, "reports", "description-template-bug-repair.json");
const REPORT_MD = path.join(ROOT, "reports", "description-template-bug-repair.md");

const BAD_DESCRIPTION_PATTERNS = [
  /The will/i,
  /The  will/i,
  /The is/i,
  /The are/i,
  /The ,/i,
  /The \./i,
  /The&nbsp;will/i,
  /The <\//i,
  /The  /i
];

const MANUAL_DESCRIPTION_FIXES = {
  "Sierra Club-9ff5dfdf-d26f-49ea-98ac-7fc2ac9511bd":
    "The Chapter Coordinator supports Sierra Club’s Delaware Chapter with administrative coordination, volunteer support, records management, and day-to-day chapter operations.",
  "Sierra Club-fea07fcc-8bad-4b01-9061-a8e2523aca86":
    "The Volunteer Coordinator Intern supports Sierra Club’s Stop Clearcutting CA Campaign by recruiting and supporting volunteers, organizing digital resources, and helping with forest advocacy outreach.",
  "edf-68fa50f7fc84":
    "This early-career role supports Environmental Defense Fund’s total rewards and compensation work through job evaluation, market analysis, data validation, and process improvement.",
  "good-power-e9b42eb0d7ce":
    "The Digital Advertising Associate manages and improves Good Power’s paid advertising campaigns to grow climate advocacy impact, expand youth engagement, and support strategic digital outreach.",
  "more-perfect-union-action-6a8fac86ca90":
    "The Video Production Fellow supports pre-production and production work for More Perfect Union Action’s digital video projects while building hands-on experience across a fast-paced media team.",
  "more-perfect-union-action-7e06dc671030":
    "The Creator Lead manages More Perfect Union Action’s creator network, develops pitches and vertical video concepts, and helps creators strengthen their production skills and partnership with the organization.",
  "dylan-green-d92bb85fc700":
    "The Chief Revenue Officer leads revenue strategy, customer acquisition, marketing, and policy-facing commercial planning to drive growth, profitability, and risk management for Dylan Green’s client.",
  "edf-2097bb83af97":
    "The Senior Manager, California State Affairs leads key parts of Environmental Defense Fund’s California advocacy work, including campaign coordination, stakeholder engagement, and state policy strategy.",
  "Octopus Energy-957b7064-82d7-41b6-8cfd-1ca71f55eb10":
    "The Revenue Operations Lead optimizes Octopus Energy’s go-to-market systems, process efficiency, and data integrity across marketing, sales, and customer success.",
  "Octopus Energy-7bc05524-5b42-40bb-871e-15018a0a943a":
    "The Portfolio ESG Analyst supports ESG reporting, stewardship, and sustainability risk management across Octopus Energy’s operational and construction-stage renewable energy assets."
};

function hasBug(value) {
  const text = String(value || "");
  return BAD_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

function readOldJobs() {
  return JSON.parse(require("fs").readFileSync(OLD_JOBS_FILE, "utf8"));
}

function cleanCandidateDescription(value, job) {
  const repaired = applyTitleToMalformedTemplate(String(value || ""), job.title);
  const normalized = normalizeDescription(repaired, {
    title: job.title,
    organization: job.organization
  }).description;
  const candidate = normalized || repaired.trim();
  if (!candidate) return "";
  if (hasMalformedDescriptionTemplate(candidate)) return "";
  if (!hasUsableDescription(candidate, { title: job.title, organization: job.organization })) return "";
  return candidate;
}

function chooseDescription(job, record, oldJob) {
  if (MANUAL_DESCRIPTION_FIXES[job.id]) {
    return { source: "manual_fix", description: MANUAL_DESCRIPTION_FIXES[job.id] };
  }

  const candidates = [
    { source: "oldjobs.json", value: oldJob?.description || "" },
    { source: "jobs.json", value: job.description || "" },
    { source: "job-records.display", value: record.display?.description || "" },
    { source: "job-records.raw", value: record.raw_source_data?.raw_description || record.raw_source_data?.description || "" },
    { source: "job-records.normalized", value: record.normalized?.description || "" }
  ];

  for (const candidate of candidates) {
    const cleaned = cleanCandidateDescription(candidate.value, job);
    if (cleaned && !hasBug(cleaned)) {
      return { source: candidate.source, description: cleaned };
    }
  }

  return { source: "neutral_fallback", description: buildFallbackDescription(job) };
}

function buildSnippet(description, job, source) {
  if (source === "manual_fix" || source === "neutral_fallback") {
    return description;
  }
  const snippet = buildDescriptionSnippet(description, 220, { title: job.title });
  if (snippet && !hasBug(snippet)) return snippet;
  return description;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Description Template Bug Repair");
  lines.push("");
  lines.push(`- Affected jobs: ${report.affected_jobs.length}`);
  lines.push(`- Pages regenerated: ${report.page_regeneration.pagesWrittenCount}`);
  lines.push(`- Validation malformed_description_template_count: ${report.validation.malformed_description_template_count}`);
  lines.push(`- Validation hard_validation_failure_count: ${report.validation.hard_validation_failure_count}`);
  lines.push("");
  for (const item of report.affected_jobs) {
    lines.push(`## ${item.title} @ ${item.organization}`);
    lines.push(`- id: ${item.id}`);
    lines.push(`- page_url: ${item.page_url}`);
    lines.push(`- source_winner: ${item.description_source}`);
    lines.push(`- page_regenerated: ${item.page_regenerated}`);
    lines.push(`- before_description: ${item.before.description}`);
    lines.push(`- after_description: ${item.after.description}`);
    lines.push(`- before_snippet: ${item.before.description_snippet}`);
    lines.push(`- after_snippet: ${item.after.description_snippet}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [jobs, records] = await Promise.all([readJobs(), readJobRecords()]);
  const oldJobs = readOldJobs();
  const oldById = new Map(oldJobs.map((job) => [String(job.id || ""), job]));
  const recordsById = new Map(records.map((record) => [String(record.id || ""), record]));

  const affectedJobs = jobs.filter((job) => {
    const record = recordsById.get(String(job.id || "")) || {};
    const manualTarget = MANUAL_DESCRIPTION_FIXES[job.id] || "";
    return (
      (manualTarget && (
        String(job.description || "").trim() !== manualTarget.trim() ||
        String(job.description_snippet || "").trim() !== manualTarget.trim() ||
        String(job.summary || "").trim() !== manualTarget.trim()
      )) ||
      hasBug(job.description || "") ||
      hasBug(job.description_snippet || "") ||
      hasBug(job.summary || "") ||
      hasBug(record.display?.description || "")
    );
  });

  const affectedIds = new Set(affectedJobs.map((job) => String(job.id || "")));
  const reportItems = [];

  for (const job of jobs) {
    if (!affectedIds.has(String(job.id || ""))) continue;
    const record = recordsById.get(String(job.id || ""));
    const oldJob = oldById.get(String(job.id || "")) || {};
    const before = {
      description: job.description || "",
      description_snippet: job.description_snippet || "",
      summary: job.summary || ""
    };
    const chosen = chooseDescription(job, record || {}, oldJob);
    const snippet = buildSnippet(chosen.description, job, chosen.source);

    job.description = chosen.description;
    job.description_snippet = snippet;
    job.summary = snippet;

    if (record) {
      record.display = {
        ...(record.display || {}),
        description: chosen.description
      };
      record.normalized = {
        ...(record.normalized || {}),
        description: chosen.description
      };
    }

    reportItems.push({
      id: job.id,
      title: job.title,
      organization: job.organization,
      page_url: job.page_url,
      description_source: chosen.source,
      page_regenerated: true,
      before,
      after: {
        description: chosen.description,
        description_snippet: snippet,
        summary: snippet
      }
    });
  }

  await writeJson(JOBS_FILE, jobs);
  await writeJson(JOB_RECORDS_FILE, records);
  const pageRegeneration = await buildPagesForSelectedJobs(jobs, { selectedIds: Array.from(affectedIds) });
  const validation = await buildValidationReport({ requirePages: true });
  const report = {
    generated_at: new Date().toISOString(),
    affected_jobs: reportItems,
    page_regeneration: pageRegeneration,
    files_changed: [
      "jobs.json",
      "job-records.json",
      ...Array.from(affectedJobs, (job) => job.page_url),
      "reports/description-template-bug-repair.json",
      "reports/description-template-bug-repair.md"
    ],
    validation: {
      malformed_description_template_count: validation.malformed_description_template_count,
      hard_validation_failure_count: validation.hard_validation_failure_count,
      invalid_title_count: validation.invalid_title_count,
      pending_public_overlap_count: validation.pending_public_overlap_count
    }
  };

  await fs.mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await writeJson(REPORT_JSON, report);
  await fs.writeFile(REPORT_MD, buildMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:repair-description-template-bug] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
