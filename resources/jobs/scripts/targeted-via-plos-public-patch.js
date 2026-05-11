const fs = require("fs/promises");
const path = require("path");
const { buildPagesForSelectedJobs } = require("./generate-job-pages");
const { readJobs, readSources, writeJsonIfChanged } = require("./job-utils");
const { readJobRecords } = require("./public-records");
const { buildValidationReport } = require("./validate-public-data");

const ROOT = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "reports", "targeted-via-plos-public-patch.json");
const REPORT_MD = path.join(ROOT, "reports", "targeted-via-plos-public-patch.md");
const JOBS_FILE = path.join(ROOT, "jobs.json");
const JOB_RECORDS_FILE = path.join(ROOT, "job-records.json");
const ADMIN_ORG_RULES_FILE = path.join(ROOT, "admin-organization-rules.json");

const DESCRIPTION_PATCHES = {
  "elemental-impact-26644a0dbc01": {
    organization: "VIA",
    description:
      "As a General Manager on Via's Operations team, you will manage a first-of-its-kind, intermodal transit service while gaining exposure to a fast-paced tech company. This role sits at the intersection of strategy, operations, and partnership management within a fast-growing tech company.",
    snippet:
      "As a General Manager on Via's Operations team, you will manage a first-of-its-kind, intermodal transit service while gaining exposure to a fast-paced tech company."
  },
  "elemental-impact-2d547ecfba33": {
    organization: "VIA",
    description:
      "VIA is looking for a strategic Senior Quality Assurance Engineer to define and own its quality standards. This role focuses on building the systems that let engineers integrate testing into their day-to-day workflow while using automation to replace manual processes and uphold rigorous security requirements.",
    snippet:
      "VIA is looking for a strategic Senior Quality Assurance Engineer to define and own its quality standards."
  },
  "Octopus Energy-a7f97ce1-f3ab-42c9-bddc-44fe69df6470": {
    description:
      "The Senior Frontend Engineer helps build Octopus Energy’s customer-facing digital products and platform experiences across its growing energy business.",
    snippet:
      "The Senior Frontend Engineer helps build Octopus Energy’s customer-facing digital products and platform experiences."
  },
  "Octopus Energy-b5557512-04f8-4bb4-95dd-074da4e4c2de": {
    description:
      "The Performance Marketing Lead drives growth marketing strategy, campaign execution, and channel performance across Octopus Energy’s products and customer acquisition work.",
    snippet:
      "The Performance Marketing Lead drives growth marketing strategy and campaign execution across Octopus Energy’s products."
  },
  "Octopus Energy-87dc1a69-d1f1-40dd-affd-2d6dee521080": {
    description:
      "The Optimisation Manager helps improve operational performance, energy flexibility strategy, and product decision-making across Octopus Energy’s systems.",
    snippet:
      "The Optimisation Manager helps improve operational performance and energy flexibility strategy across Octopus Energy’s systems."
  },
  "Octopus Energy-7f8fd5fe-863c-4f71-9026-961806b0ba13": {
    description:
      "The Data Analyst supports Octopus Energy’s Flexibility Team with analysis, reporting, and performance insights for energy products and programs.",
    snippet:
      "The Data Analyst supports Octopus Energy’s Flexibility Team with analysis and performance insights."
  },
  "Octopus Energy-5273a0f1-a449-4322-a388-980a212fef18": {
    description:
      "The Senior Backend Engineer builds and improves Octopus Energy’s backend systems that support scalable customer and energy platform products.",
    snippet:
      "The Senior Backend Engineer builds and improves Octopus Energy’s backend systems for scalable energy products."
  },
  "elemental-impact-49ef7cc726e9": {
    description:
      "The Sr. Supplier Quality Engineer leads supplier quality strategy, complex issue resolution, and technical coordination across Proterra’s manufacturing partners.",
    snippet:
      "The Sr. Supplier Quality Engineer leads supplier quality strategy and complex issue resolution across Proterra’s manufacturing partners."
  },
  "tnc-f91e1dd2b609": {
    description:
      "The Preserve Manager supports stewardship, operations, and scientific coordination for The Nature Conservancy’s Palmyra Atoll preserve.",
    snippet:
      "The Preserve Manager supports stewardship and scientific coordination for The Nature Conservancy’s Palmyra Atoll preserve."
  },
  "tnc-d00634de07a7": {
    description:
      "The Hospitality Specialist supports food service, hospitality logistics, and day-to-day guest operations at The Nature Conservancy’s Palmyra Atoll preserve.",
    snippet:
      "The Hospitality Specialist supports food service and guest operations at The Nature Conservancy’s Palmyra Atoll preserve."
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureReportsDir() {
  return fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
}

function trimText(value) {
  return String(value || "").trim();
}

function buildReportMarkdown(report) {
  const lines = ["# Targeted VIA / PLOS Public Patch", ""];
  lines.push("## PLOS");
  lines.push(`- source_enabled: ${report.plos.source_enabled}`);
  lines.push(`- auto_publish: ${report.plos.auto_publish}`);
  lines.push(`- quality_mode: ${report.plos.quality_mode}`);
  lines.push(`- blocked_in_admin_rules: ${report.plos.blocked_in_admin_rules}`);
  lines.push("");
  lines.push("## VIA Records");
  report.via_records_checked.forEach((item) => {
    lines.push(`- ${item.id}: ${item.title}`);
    lines.push(`  before description: ${item.before_description}`);
    lines.push(`  after description: ${item.after_description}`);
    lines.push(`  before snippet: ${item.before_snippet}`);
    lines.push(`  after snippet: ${item.after_snippet}`);
  });
  lines.push("");
  lines.push("## Other Lowercase Repairs");
  report.other_lowercase_repairs.forEach((item) => {
    lines.push(`- ${item.id}: ${item.title} @ ${item.organization}`);
    lines.push(`  before: ${item.before_description}`);
    lines.push(`  after: ${item.after_description}`);
  });
  lines.push("");
  lines.push("## Validation");
  lines.push(`- hard_validation_failure_count: ${report.validation.hard_validation_failure_count}`);
  lines.push(`- invalid_title_count: ${report.validation.invalid_title_count}`);
  lines.push(`- lowercase_sentence_description_count: ${report.validation.lowercase_sentence_description_count}`);
  lines.push(`- malformed_description_template_count: ${report.validation.malformed_description_template_count}`);
  lines.push(`- public_record_organization_conflict_count: ${report.validation.public_record_organization_conflict_count}`);
  lines.push(`- via_identity_conflict_count: ${report.validation.via_identity_conflict_count}`);
  return lines.join("\n") + "\n";
}

async function main() {
  await ensureReportsDir();
  const [jobs, records, sources, adminRules] = await Promise.all([
    readJobs(),
    readJobRecords(),
    readSources(),
    fs.readFile(ADMIN_ORG_RULES_FILE, "utf8").then((raw) => JSON.parse(raw))
  ]);

  const jobsById = new Map(jobs.map((job) => [String(job.id || ""), job]));
  const recordsById = new Map(records.map((record) => [String(record.id || ""), record]));
  const selectedIds = Object.keys(DESCRIPTION_PATCHES);
  const beforeSnapshots = [];

  for (const id of selectedIds) {
    const job = jobsById.get(id);
    const record = recordsById.get(id);
    if (!job || !record) continue;
    beforeSnapshots.push({
      id,
      title: trimText(job.title),
      organization: trimText(job.organization),
      page_url: trimText(job.page_url),
      before_description: trimText(job.description),
      before_snippet: trimText(job.description_snippet || job.summary),
      record_before_organization: trimText(record.display?.organization || record.raw_source_data?.organization),
      record_before_description: trimText(record.display?.description || record.normalized?.description)
    });

    const patch = DESCRIPTION_PATCHES[id];
    const description = trimText(patch.description);
    const snippet = trimText(patch.snippet || description);
    const organization = trimText(patch.organization || job.organization);

    job.organization = organization;
    job.description = description;
    job.description_snippet = snippet;
    job.summary = snippet;

    record.display = {
      ...record.display,
      organization,
      description,
      description_snippet: snippet,
      summary: snippet
    };
    record.normalized = {
      ...(record.normalized || {}),
      title: trimText(job.title),
      organization,
      description,
      description_snippet: snippet,
      summary: snippet,
      page_url: trimText(job.page_url)
    };
    record.manual_overrides = {
      ...(record.manual_overrides || {}),
      organization,
      description,
      description_snippet: snippet,
      summary: snippet
    };
    record.last_manual_edit_at = new Date().toISOString();
  }

  const jobsChanged = await writeJsonIfChanged(JOBS_FILE, jobs);
  const recordsChanged = await writeJsonIfChanged(JOB_RECORDS_FILE, records);
  const pageResult = await buildPagesForSelectedJobs(jobs, { selectedIds });
  const validation = await buildValidationReport();

  const afterById = new Map(jobs.map((job) => [String(job.id || ""), job]));
  const recordAfterById = new Map(records.map((record) => [String(record.id || ""), record]));
  const viaRecords = selectedIds.filter((id) => id.startsWith("elemental-impact-") && /via/i.test(afterById.get(id)?.organization || ""));
  const viaRecordsChecked = beforeSnapshots
    .filter((item) => viaRecords.includes(item.id))
    .map((item) => {
      const job = afterById.get(item.id);
      return {
        id: item.id,
        title: item.title,
        before_description: item.before_description,
        after_description: trimText(job.description),
        before_snippet: item.before_snippet,
        after_snippet: trimText(job.description_snippet || job.summary),
        before_organization: item.organization,
        after_organization: trimText(job.organization),
        record_before_organization: item.record_before_organization,
        record_after_organization: trimText(recordAfterById.get(item.id)?.display?.organization)
      };
    });

  const otherLowercaseRepairs = beforeSnapshots
    .filter((item) => !viaRecords.includes(item.id) && /^[a-z]/.test(item.before_description))
    .map((item) => {
      const job = afterById.get(item.id);
      return {
        id: item.id,
        title: item.title,
        organization: trimText(job.organization),
        page_url: trimText(job.page_url),
        before_description: item.before_description,
        after_description: trimText(job.description),
        before_snippet: item.before_snippet,
        after_snippet: trimText(job.description_snippet || job.summary)
      };
    });

  const plosSource = sources.find((source) => String(source.id || "") === "plos");
  const report = {
    generated_at: new Date().toISOString(),
    files_changed: {
      jobs_json_changed: jobsChanged,
      job_records_json_changed: recordsChanged,
      pages_written_count: pageResult.pagesWrittenCount,
      redirect_pages_written_count: pageResult.redirectPagesWrittenCount
    },
    plos: {
      source_enabled: Boolean(plosSource && plosSource.enabled !== false),
      auto_publish: Boolean(plosSource && plosSource.auto_publish),
      quality_mode: trimText(plosSource && plosSource.quality_mode),
      blocked_in_admin_rules: Array.isArray(adminRules.rejected_organizations) && adminRules.rejected_organizations.includes("PLOS")
    },
    via_records_checked: viaRecordsChecked,
    other_lowercase_repairs: otherLowercaseRepairs,
    validation: {
      hard_validation_failure_count: validation.hard_validation_failure_count,
      invalid_title_count: validation.invalid_title_count,
      lowercase_sentence_description_count: validation.lowercase_sentence_description_count,
      malformed_description_template_count: validation.malformed_description_template_count,
      public_record_organization_conflict_count: validation.public_record_organization_conflict_count,
      via_identity_conflict_count: validation.via_identity_conflict_count,
      errors: clone(validation.errors),
      samples: {
        hard_validation_failures: clone(validation.samples.hard_validation_failures || []),
        public_record_organization_conflicts: clone(validation.samples.public_record_organization_conflicts || []),
        via_identity_conflicts: clone(validation.samples.via_identity_conflicts || []),
        lowercase_sentence_descriptions: clone(validation.samples.lowercase_sentence_descriptions || [])
      }
    }
  };

  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(REPORT_MD, buildReportMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[jobs:targeted-via-plos-public-patch] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}
