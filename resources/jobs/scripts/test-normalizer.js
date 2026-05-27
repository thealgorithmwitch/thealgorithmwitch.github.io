const assert = require("assert");
const {
  applyTitleToMalformedTemplate,
  buildDescriptionSnippet,
  buildFallbackDescription,
  detectPreferredRoleSections,
  extractMultiLocationSalaryRanges,
  extractSalaryText,
  extractPayWindows,
  hasMalformedDescriptionTemplate,
  hasRoleSignal,
  hasUsableDescription,
  isClearlyNotJobTitle,
  normalizeDescription,
  normalizeJob,
  parseSalaryRange,
  stringifySafe,
  stripGenericCareersContent
} = require("./job-normalizer");

const salaryCases = [
  { input: "$80,000 - $100,000", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "$80k-$100k", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "USD 80k – 100k", min: 80000, max: 100000, currency: "USD", period: "year", visible: true },
  { input: "salary range: $70,000 - $90,000", min: 70000, max: 90000, currency: "USD", period: "year", visible: true },
  { input: "compensation: $70,000-$90,000", min: 70000, max: 90000, currency: "USD", period: "year", visible: true },
  { input: "USD 70,000 - 90,000", min: 70000, max: 90000, currency: "USD", period: "year", visible: true },
  { input: "CA$90k–CA$120k", min: 90000, max: 120000, currency: "CAD", period: "year", visible: true },
  { input: "CAD $90,000 to $120,000", min: 90000, max: 120000, currency: "CAD", period: "year", visible: true },
  { input: "€70k - €90k", min: 70000, max: 90000, currency: "EUR", period: "year", visible: true },
  { input: "EUR 70,000–90,000", min: 70000, max: 90000, currency: "EUR", period: "year", visible: true },
  { input: "£60k–£85k", min: 60000, max: 85000, currency: "GBP", period: "year", visible: true },
  { input: "$35/hour - $45/hour", min: 35, max: 45, currency: "USD", period: "hour", visible: true },
  { input: "$35 to $45 per hour", min: 35, max: 45, currency: "USD", period: "hour", visible: true },
  { input: "$35/hr", min: 35, max: 35, currency: "USD", period: "hour", visible: true },
  { input: "$800/day", min: 800, max: 800, currency: "USD", period: "day", visible: true },
  { input: "$5k/mo", min: 5000, max: 5000, currency: "USD", period: "month", visible: true },
  { input: "$5,000/month", min: 5000, max: 5000, currency: "USD", period: "month", visible: true },
  { input: "Salary not listed", min: null, max: null, currency: "Unknown", period: "Unknown", visible: false },
  { input: "Competitive", min: null, max: null, currency: "Unknown", period: "Unknown", visible: true, salary: "Competitive" },
  { input: "Up to $120k", min: null, max: 120000, currency: "USD", period: "year", visible: true },
  { input: "Starting at $75k", min: 75000, max: null, currency: "USD", period: "year", visible: true },
  { input: "Salary: Estimated at $75,780 – $84,200*; Based on experience", min: 75780, max: 84200, currency: "USD", period: "year", visible: true },
  { input: "$62,000 - $69,000", min: 62000, max: 69000, currency: "USD", period: "year", visible: true },
  { input: "Salary: Estimated at $62,280 – $69,200*; Based on experience", min: 62280, max: 69200, currency: "USD", period: "year", visible: true },
  { input: "Salary: Estimated at $54,450 – $60,500*; Based on experience & HR policies", min: 54450, max: 60500, currency: "USD", period: "year", visible: true },
  { input: "The HR department handles all recruiting. Salary: $75,000 - $90,000.", min: 75000, max: 90000, currency: "USD", period: "year", visible: true }
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

const payExtractionCases = [
  { input: "Salary: Estimated at $75,780 – $84,200, Based on experience", min: 75780, max: 84200, period: "year" },
  { input: "Annual salary range: $190,000-205,000, commensurate with experience", min: 190000, max: 205000, period: "year" },
  { input: "$190,000-205,000", min: 190000, max: 205000, period: "year" },
  { input: "$75,780 – $84,200*", min: 75780, max: 84200, period: "year" },
  { input: "Salary range: $80k - $100k", min: 80000, max: 100000, period: "year" },
  { input: "Compensation: $90,000 - $110,000", min: 90000, max: 110000, period: "year" },
  { input: "Salary: Estimated at $62,280 – $69,200*; Based on experience. Interview with HR manager.", min: 62280, max: 69200, period: "year" },
  { input: "Title: Digital Specialist Location: Remote Salary: Estimated at $75,780 – $84,200* Supervisor: Director of Marketing Reports to: VP of HR", min: 75780, max: 84200, period: "year" }
];

for (const tc of payExtractionCases) {
  const actual = parseSalaryRange(tc.input, "");
  assert.strictEqual(actual.salary_min, tc.min, `min mismatch for ${tc.input}`);
  assert.strictEqual(actual.salary_max, tc.max, `max mismatch for ${tc.input}`);
  assert.strictEqual(actual.salary_visible, true, `visible should be true for ${tc.input}`);
  assert.strictEqual(actual.salary_period, tc.period, `period mismatch for ${tc.input}`);
  assert.ok(actual.salary_min > 0, `min should be > 0 for ${tc.input}`);
}

const multiLocationCases = [
  {
    desc: "The annual salary for candidates based in San Francisco, CA, and New York, NY, is $205,300 – $228,100.\nThe annual salary for candidates based in Washington, D.C.: $195,000 – $216,700",
    min: 195000, max: 228100, note: "Multiple location-based ranges"
  },
  {
    desc: "The annual salary for candidates based in Chicago, IL is $100,000 – $120,000",
    min: 100000, max: 120000, note: ""
  }
];

for (const tc of multiLocationCases) {
  const result = extractMultiLocationSalaryRanges(tc.desc);
  assert.ok(result, `multi-location result should not be null for ${tc.desc}`);
  assert.strictEqual(result.salary_min, tc.min, `min mismatch for multi-location case`);
  assert.strictEqual(result.salary_max, tc.max, `max mismatch for multi-location case`);
  assert.strictEqual(result.salary_note, tc.note, `note mismatch for multi-location case`);
}

const earthjusticeDescription = "Salary & Benefits\n\nSalary is based on location and experience.\n\nThe annual salary for candidates based in San Francisco, CA, and New York, NY, is $205,300 – $228,100.\n\nThe annual salary for candidates based in Washington, D.C.: $195,000 – $216,700\n\nBenefits: See Earthjustice employee benefits.";
const ejResult = extractMultiLocationSalaryRanges(earthjusticeDescription);
assert.ok(ejResult, `Earthjustice multi-location result should not be null`);
assert.strictEqual(ejResult.salary_min, 195000, `Earthjustice min should be 195000 got ${ejResult.salary_min}`);
assert.strictEqual(ejResult.salary_max, 228100, `Earthjustice max should be 228100 got ${ejResult.salary_max}`);
assert.strictEqual(ejResult.salary_note, "Multiple location-based ranges");

const benefitsNotSalary = extractMultiLocationSalaryRanges("Benefits: Medical, Dental, Vision, 403b retirement savings plan, Vacation");
assert.strictEqual(benefitsNotSalary, null, `benefits text should not produce a multi-location result`);

const singleRangeNotMulti = extractMultiLocationSalaryRanges("We offer a competitive salary of $80,000 - $100,000 based on experience.");
assert.strictEqual(singleRangeNotMulti, null, `single non-location-based range should not produce multi-location result`);

const goodPowerJob = normalizeJob({
  title: "Director of Policy",
  organization: "Good Power",
  description: "Position Details\nAnnual salary range: $190,000-205,000, commensurate with experience\nLocation: Remote\nGenerous benefits include: Medical, Dental, Vision",
  salary_visible: true
});
assert.strictEqual(goodPowerJob.salary_min, 190000, `GoodPower min should be 190000 got ${goodPowerJob.salary_min}`);
assert.strictEqual(goodPowerJob.salary_max, 205000, `GoodPower max should be 205000 got ${goodPowerJob.salary_max}`);
assert.strictEqual(goodPowerJob.salary_visible, true, `GoodPower salary visible should be true`);

const abcJob = normalizeJob({
  title: "Digital Engagement Specialist",
  organization: "American Bird Conservancy",
  description: "Digital Engagement Specialist Salary: Estimated at $75,780 – $84,200, Based on experience",
  salary_visible: true
});
assert.strictEqual(abcJob.salary_min, 75780, `ABC min should be 75780 got ${abcJob.salary_min}`);
assert.strictEqual(abcJob.salary_max, 84200, `ABC max should be 84200 got ${abcJob.salary_max}`);
assert.strictEqual(abcJob.salary_visible, true, `ABC salary visible should be true`);

const payWindows = extractPayWindows("Benefits include salary range: $70,000 - $90,000 and bonus eligibility.");
assert.ok(payWindows.some((window) => /salary range/i.test(window) && /\$70,000 - \$90,000/i.test(window)));

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

const counselRemoteJob = normalizeJob({
  title: "Counsel Remote",
  organization: "Arevon Energy",
  location: "Hybrid / Anywhere"
});
assert.strictEqual(counselRemoteJob.title, "Counsel");
assert.strictEqual(counselRemoteJob.workplace_type, "Remote");

const solarRemoteSuffixJob = normalizeJob({
  title: "Solar Field Technician – Rosamond, CA Remote",
  organization: "Arevon Energy",
  location: "Rosamond, CA"
});
assert.strictEqual(solarRemoteSuffixJob.title, "Solar Field Technician");
assert.strictEqual(solarRemoteSuffixJob.workplace_type, "Remote");

const headlinePollutedTitleJob = normalizeJob({
  title: "Pivoting Climate Job Linkedins Green Economy Lead",
  organization: "Environmental Defense Fund"
});
assert.strictEqual(headlinePollutedTitleJob.title_confidence, "low");
assert.ok(/headline_like_title/i.test(headlinePollutedTitleJob.parse_warning));

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
  organization: "Resource Innovations",
  original_url: "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
  raw_description: "Senior Software Engineer https://apply.workable.com/resource-innovations/j/68FA4D2A36 77070162 Shifted Energy other https://cdn.getro.com/company.png"
});
assert.strictEqual(elementalImpactJob.source, "Elemental Impact");
assert.strictEqual(elementalImpactJob.source_url, "https://jobs.elementalimpact.com/jobs");
assert.strictEqual(elementalImpactJob.organization, "Resource Innovations");
assert.strictEqual(elementalImpactJob.parse_warning, "");

const elementalImpactMismatchedBodyJob = normalizeJob({
  id: "elemental-impact-95090d1a6bc6",
  source_id: "elemental-impact",
  source: "Custom Careers Page",
  source_url: "https://jobs.elementalimpact.com/jobs",
  title: "Software Engineer Lead",
  organization: "Resource Innovations",
  location: "US - Multiple locations",
  original_url: "https://apply.workable.com/resource-innovations/j/DD39335D06",
  raw_description: "Shifted Energy other 2 Business/Productivity Software shifted-energy Chicago, IL, USA locality POINT (-87.6297982 41.8781136)"
});
assert.strictEqual(elementalImpactMismatchedBodyJob.organization, "Resource Innovations");
assert.strictEqual(elementalImpactMismatchedBodyJob.title, "Software Engineer Lead");

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

const malformedPay = parseSalaryRange("41 147", "Remote");
assert.strictEqual(malformedPay.salary, "");
assert.strictEqual(malformedPay.salary_visible, false);
assert.strictEqual(malformedPay.pay_parse_warning, "malformed_split_salary_fragment");

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

const malformedTemplateDescription = normalizeDescription(
  "The will focus on pre-production and production support across the organization.",
  { title: "Video Production Fellow" }
);
assert.ok(/The Video Production Fellow will focus/i.test(malformedTemplateDescription.description));
assert.strictEqual(hasMalformedDescriptionTemplate(malformedTemplateDescription.description), false);

const directTemplateRepair = applyTitleToMalformedTemplate(
  "In this position, the will work to advance campaign strategy.",
  "Digital Advertising Associate"
);
assert.ok(/the Digital Advertising Associate will work/i.test(directTemplateRepair));

const malformedSnippet = buildDescriptionSnippet(
  "The will lead the development and implementation of key aspects of EDF's California-based work.",
  220,
  { title: "Senior Manager, California State Affairs" }
);
assert.ok(/will lead the development and implementation/i.test(malformedSnippet));
assert.strictEqual(hasMalformedDescriptionTemplate(malformedSnippet), false);

const genericCareersContent = `
  How we support our staff
  We offer competitive salaries and wages, professional development and training, and a supportive work environment.

  Current Openings
  View our open positions and apply today.

  Purpose of the Position
  The Donor Engagement Manager advances Louisiana Bucket Brigade's environmental justice mission by growing annual support through campaigns, donor activities, and one-on-one donor engagement.

  Job Status
  Full-time, 40 hours per week

  Salary
  $65,000 per year
`;
const cleanedCareers = normalizeDescription(genericCareersContent, { title: "Donor Engagement Manager", organization: "Louisiana Bucket Brigade" });
assert.ok(cleanedCareers.description.includes("environmental justice mission"), `generic careers content should prefer role-specific sections: ${cleanedCareers.description}`);
assert.ok(!/How we support our staff/i.test(cleanedCareers.description), "generic careers heading should be stripped");
assert.ok(!/Current Openings/i.test(cleanedCareers.description), "current openings heading should be stripped");
assert.ok(!/competitive salaries and wages/i.test(cleanedCareers.description), "competitive salaries boilerplate should be stripped");
assert.ok(cleanedCareers.description.length < 300, `cleaned careers description should be concise: ${cleanedCareers.description.length} chars`);

const stripResult = stripGenericCareersContent(genericCareersContent);
assert.ok(!/How we support our staff/i.test(stripResult), "stripGenericCareersContent should remove generic section");
assert.ok(stripResult.includes("Purpose of the Position"), "stripGenericCareersContent should keep preferred sections");

const detectResult = detectPreferredRoleSections(genericCareersContent);
assert.ok(detectResult.includes("environmental justice mission"), "detectPreferredRoleSections should find role-specific content");
assert.ok(!detectResult.includes("How we support our staff"), "detectPreferredRoleSections should exclude generic content");

// Louisiana Bucket Brigade salary parsing
const lbbSalary = parseSalaryRange("$65,000", "");
assert.strictEqual(lbbSalary.salary_min, 65000, "Louisiana Bucket Brigade min should be 65000");
assert.strictEqual(lbbSalary.salary_max, 65000, "Louisiana Bucket Brigade max should be 65000");
assert.strictEqual(lbbSalary.salary_currency, "USD", "Louisiana Bucket Brigade currency should be USD");
assert.strictEqual(lbbSalary.salary_period, "year", "Louisiana Bucket Brigade period should be year");
assert.strictEqual(lbbSalary.salary_visible, true, "Louisiana Bucket Brigade salary should be visible");

const lbbSalaryYearly = parseSalaryRange("$65,000 per year", "");
assert.strictEqual(lbbSalaryYearly.salary_min, 65000, "yearly min should be 65000");
assert.strictEqual(lbbSalaryYearly.salary_max, 65000, "yearly max should be 65000");
assert.strictEqual(lbbSalaryYearly.salary_visible, true, "yearly salary should be visible");

const neutralFallback = buildFallbackDescription({
  organization: "Environmental Defense Fund",
  sector: "Policy/Advocacy",
  workplace_type: "Remote"
});
assert.ok(/This role supports Environmental Defense Fund's work across Policy\/Advocacy\./.test(neutralFallback));

assert.strictEqual(stringifySafe({ value: "$60,000 - $70,000" }), "$60,000 - $70,000");
assert.strictEqual(stringifySafe({ unexpected: "ignored" }), "");

console.log("test-normalizer: all checks passed");
