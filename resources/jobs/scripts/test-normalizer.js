const assert = require("assert");
const { extractSalaryText, hasRoleSignal, hasUsableDescription, isClearlyNotJobTitle, normalizeDescription, normalizeJob, parseSalaryRange, stringifySafe } = require("./job-normalizer");

const salaryCases = [
  { input: "$80,000 - $100,000", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "$80k-$100k", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "USD 80k – 100k", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "CA$90k–CA$120k", min: 90000, max: 120000, currency: "CAD", period: "year", visible: true },
  { input: "CAD $90,000 to $120,000", min: 90000, max: 120000, currency: "CAD", period: "year", visible: true },
  { input: "€70k - €90k", min: 70000, max: 90000, currency: "EUR", period: "year", visible: true },
  { input: "EUR 70,000–90,000", min: 70000, max: 90000, currency: "EUR", period: "year", visible: true },
  { input: "£60k–£85k", min: 60000, max: 85000, currency: "GBP", period: "year", visible: true },
  { input: "$35/hr", min: 35, max: 35, currency: "USD", period: "hour", visible: true },
  { input: "$800/day", min: 800, max: 800, currency: "USD", period: "day", visible: true },
  { input: "$5k/mo", min: 5000, max: 5000, currency: "USD", period: "month", visible: true },
  { input: "$5,000/month", min: 5000, max: 5000, currency: "USD", period: "month", visible: true },
  { input: "Salary not listed", min: null, max: null, currency: "Unknown", period: "Unknown", visible: false },
  { input: "Competitive", min: null, max: null, currency: "Unknown", period: "Unknown", visible: true, salary: "Competitive" },
  { input: "Up to $120k", min: null, max: 120000, currency: "USD", period: "year", visible: true },
  { input: "Starting at $75k", min: 75000, max: null, currency: "USD", period: "year", visible: true }
];

for (const testCase of salaryCases) {
  const actual = parseSalaryRange(testCase.input, "");
  assert.strictEqual(actual.raw_salary, testCase.input, `raw_salary mismatch for ${testCase.input}`);
  assert.strictEqual(actual.salary_min, testCase.min, `salary_min mismatch for ${testCase.input}`);
  assert.strictEqual(actual.salary_max, testCase.max, `salary_max mismatch for ${testCase.input}`);
  assert.strictEqual(actual.salary_currency, testCase.currency, `currency mismatch for ${testCase.input}`);
  assert.strictEqual(actual.salary_period, testCase.period, `period mismatch for ${testCase.input}`);
  assert.strictEqual(actual.salary_visible, testCase.visible, `salary_visible mismatch for ${testCase.input}`);
  if (testCase.salary !== undefined) {
    assert.strictEqual(actual.salary, testCase.salary, `salary mismatch for ${testCase.input}`);
  }
}

const descriptionInput = `
  <div>
    <p>About Us</p>
    <p>Acme Climate builds planning software for decarbonization teams.</p>
    <p>You will own customer-facing product strategy and partner closely with design and engineering.</p>
    <p>The role also supports go-to-market teams with launch messaging and rollout planning.</p>
    <p>Success in this job requires strong communication, prioritization, and stakeholder management.</p>
    <p>We are an equal opportunity employer and provide reasonable accommodation during hiring.</p>
  </div>
`;

const normalizedDescription = normalizeDescription(descriptionInput);
assert.ok(normalizedDescription.raw_description.includes("Acme Climate builds planning software for decarbonization teams."));
assert.ok(normalizedDescription.raw_description.includes("equal opportunity employer"));
assert.ok(!/<[^>]+>/.test(normalizedDescription.description), "description should not contain HTML");
assert.ok(!/equal opportunity employer/i.test(normalizedDescription.description), "boilerplate should be removed");
assert.ok(/Acme Climate builds planning software for decarbonization teams\./.test(normalizedDescription.description));
assert.ok(/You will own customer-facing product strategy and partner closely with design and engineering\./.test(normalizedDescription.description));
assert.ok(/The role also supports .*market teams with launch messaging and rollout planning\./.test(normalizedDescription.description));
assert.ok(normalizedDescription.description.split(/[.!?]+\s+/).filter(Boolean).length >= 3);

const leverLikeJob = {
  title: "Deputy Press Secretary",
  organization: "Sierra Club",
  location: "Washington, DC",
  description: "The salary range for this position is $75,000 - $95,000. This role leads media strategy across national campaigns. The team partners with policy, organizing, and creative staff. Candidates should be strong writers who can coordinate rapid response and long-term storytelling.",
  raw_payload: {
    descriptionPlain: "The salary range for this position is $75,000 - $95,000. This role leads media strategy across national campaigns. The team partners with policy, organizing, and creative staff. Candidates should be strong writers who can coordinate rapid response and long-term storytelling."
  }
};

assert.strictEqual(extractSalaryText(leverLikeJob), "salary range for this position is $75,000 - $95,000");
const normalizedLeverJob = normalizeJob(leverLikeJob);
assert.strictEqual(normalizedLeverJob.salary_visible, true);
assert.strictEqual(normalizedLeverJob.salary_min, 75000);
assert.strictEqual(normalizedLeverJob.salary_max, 95000);
assert.strictEqual(normalizedLeverJob.salary_currency, "USD");
assert.strictEqual(normalizedLeverJob.salary_period, "year");

const normalizedArevonJob = normalizeJob({
  title: "Senior Analyst, Risk & Insurance | Arevon",
  organization: "Arevon Energy",
  description: "Senior Analyst, Risk & Insurance | Arevon https://arevonenergy.com/careers/senior-analyst-risk-insurance/"
});
assert.ok(/^Senior Analyst/.test(normalizedArevonJob.title));

const normalizedChevronJob = normalizeJob({
  title: "> What counts are the people at RWE >",
  organization: "RWE",
  description: "> Want a planet-saving career? > Learn more"
});
assert.strictEqual(normalizedChevronJob.title, "What counts are the people at RWE");
assert.ok(!/>/.test(normalizedChevronJob.description), "description should strip visible chevrons");

const jasmineJob = normalizeJob({ title: "Jasmine", organization: "Sunrun", location: "Remote" });
assert.strictEqual(jasmineJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(jasmineJob._quality.validTitle, false);
assert.strictEqual(jasmineJob._quality.reason, "invalid_job_title_pattern");
assert.strictEqual(isClearlyNotJobTitle("Jasmine", jasmineJob), true);

const impactJob = normalizeJob({ title: "Our Impact", organization: "Environmental Defense Fund" });
assert.strictEqual(impactJob._reject_reason, "invalid_job_title_pattern");

const previousJob = normalizeJob({ title: "Previous", organization: "Sunrun" });
assert.strictEqual(previousJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(previousJob._quality.reason, "invalid_job_title_pattern");

const nextJob = normalizeJob({ title: "Next", organization: "Sunrun" });
assert.strictEqual(nextJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(nextJob._quality.reason, "invalid_job_title_pattern");

const powerOfVoicesJob = normalizeJob({ title: "The Power of All Voices", organization: "RWE" });
assert.strictEqual(powerOfVoicesJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(powerOfVoicesJob._quality.reason, "invalid_job_title_pattern");

const portugalLocaleJob = normalizeJob({ title: "Português (Portugal)", organization: "EDP" });
assert.strictEqual(portugalLocaleJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(portugalLocaleJob._quality.reason, "invalid_job_title_pattern");

const planetSavingCareerJob = normalizeJob({
  title: "Want a planet-saving career?",
  organization: "Environmental Defense Fund"
});
assert.strictEqual(planetSavingCareerJob._reject_reason, "invalid_job_title_pattern");
assert.strictEqual(planetSavingCareerJob._quality.reason, "invalid_job_title_pattern");

const goodAnalystJob = normalizeJob({
  title: "Senior Analyst, Risk & Insurance",
  organization: "Arevon Energy"
});
assert.strictEqual(goodAnalystJob._reject_reason, "");
assert.strictEqual(goodAnalystJob._quality.validTitle, true);
assert.strictEqual(hasRoleSignal(goodAnalystJob.title), true);

const goodProductManagerJob = normalizeJob({
  title: "Product Manager",
  organization: "ChargerHelp!"
});
assert.strictEqual(goodProductManagerJob._reject_reason, "");
assert.strictEqual(goodProductManagerJob._quality.validTitle, true);

const elementalImpactJob = normalizeJob({
  id: "elemental-impact-446c301b54b2",
  source_id: "elemental-impact",
  source: "Custom Careers Page",
  source_url: "https://jobs.elementalimpact.com/jobs",
  title: "Senior Software Engineer",
  organization: "Elemental Impact",
  original_url: "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
  raw_description: "Senior Software Engineer https://apply.workable.com/resource-innovations/j/68FA4D2A36 77070162 Shifted Energy other https://cdn.getro.com/company.png"
});
assert.strictEqual(elementalImpactJob.source, "Elemental Impact");
assert.strictEqual(elementalImpactJob.source_url, "https://jobs.elementalimpact.com/jobs");
assert.strictEqual(elementalImpactJob.organization, "Shifted Energy");
assert.strictEqual(elementalImpactJob.parse_warning, "");

const uncertainElementalImpactJob = normalizeJob({
  id: "elemental-impact-unknown",
  source_id: "elemental-impact",
  source_url: "https://jobs.elementalimpact.com/jobs",
  source: "Custom Careers Page",
  title: "Program Manager",
  organization: "Elemental Impact",
  original_url: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/999999",
  raw_description: "Program Manager https://recruiting.paylocity.com/Recruiting/Jobs/Details/999999"
});
assert.strictEqual(uncertainElementalImpactJob.organization, "Unknown organization");
assert.strictEqual(uncertainElementalImpactJob.source, "Elemental Impact");
assert.ok(/organization uncertain/i.test(uncertainElementalImpactJob.parse_warning));
assert.strictEqual(uncertainElementalImpactJob.triage_bucket, "needs_cleanup");

const normalizedNavDescription = normalizeDescription(
  'href="https://www.dylan-green.com/jobs/senior-associate-portfolio-management/" rel="prev"> Previous: Previous post: Senior Associate, Portfolio Management Next: Next post: Associate, Acquisitions'
);
assert.strictEqual(normalizedNavDescription.description, "");

const normalizedNoWrapDescription = normalizeDescription(
  'e" nowrap="nowrap" headers="hdrDate"> Apr 29, 2026 Project Development Analyst https://jobs.edp.com/job/Multiple-cities-Project-Development-Analyst/1388775833/'
);
assert.strictEqual(normalizedNoWrapDescription.description, "");

const normalizedChevronDescription = normalizeDescription(
  "> Manufacturing Operations Buyer/Planner > Manufacturing Operations Buyer/Planner Buyer/Planner San Jose, CA > Manufacturing Operations Buyer/Planner"
);
assert.ok(!/>/.test(normalizedChevronDescription.description), "visible chevrons should be removed from normalized descriptions");

const solarCanonicalPay = parseSalaryRange("$80,000.00 - $95,880.00 annual salary", "Remote");
assert.strictEqual(solarCanonicalPay.salary_min, 80000);
assert.strictEqual(solarCanonicalPay.salary_max, 95880);
assert.strictEqual(solarCanonicalPay.salary_period, "year");

const edpInterconnectionJunk = "Apr 29, 2026 Apr 29, 2026 Apr 29, 2026 Houston, TX Interconnection Analyst EDP";
assert.strictEqual(hasUsableDescription(edpInterconnectionJunk, { title: "Interconnection Analyst", organization: "EDP" }), false);

const edpProjectDevelopmentClean = "The Project Development Analyst is an exciting early-career role supporting the development of wind, solar, and battery storage projects across their full lifecycle.";
assert.strictEqual(hasUsableDescription(edpProjectDevelopmentClean, { title: "Project Development Analyst", organization: "EDP" }), true);

const fervoDescription = normalizeDescription(
  "Director, Internal Audit Director, Internal Audit The Director, Internal Audit will be the builder responsible for designing the internal audit function from first principles."
);
assert.ok(!/Director, Internal Audit Director, Internal Audit/.test(fervoDescription.description));
assert.ok(/designing the internal audit function from first principles/i.test(fervoDescription.description));

const nexteraDescription = normalizeDescription(
  "Senior Automation Engineer Senior Automation Engineer Florida Power & Light Company is redefining what’s possible in energy. Senior Automation Engineer leads automation work across the platform.",
  { title: "Senior Automation Engineer" }
);
const nexteraTitleMatches = (nexteraDescription.description.match(/Senior Automation Engineer/g) || []).length;
assert.ok(nexteraTitleMatches <= 1, "NextEra description should not duplicate title headers");

const companyOnlyDescription = "Resource Innovations";
assert.strictEqual(hasUsableDescription(companyOnlyDescription, { title: "Senior Software Engineer", organization: "Resource Innovations" }), false);

const repeatedDateDescription = "Apr 29, 2026 Apr 29, 2026 Apr 29, 2026 Apr 29, 2026";
assert.strictEqual(hasUsableDescription(repeatedDateDescription, { title: "Interconnection Analyst", organization: "EDP" }), false);

assert.strictEqual(stringifySafe({ value: "$60,000 - $70,000" }), "$60,000 - $70,000");
assert.strictEqual(stringifySafe({ unexpected: "ignored" }), "");

console.log("test-normalizer: all checks passed");
