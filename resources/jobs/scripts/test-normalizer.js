const assert = require("assert");
const { normalizeDescription, parseSalaryRange } = require("./job-normalizer");

const salaryCases = [
  { input: "$80,000 - $100,000", min: 80000, max: 100000, currency: "USD", period: "Unknown", visible: true },
  { input: "$80k-$100k", min: 80000, max: 100000, currency: "USD", period: "Unknown", visible: true },
  { input: "USD 80k – 100k", min: 80000, max: 100000, currency: "USD", period: "Unknown", visible: true },
  { input: "CA$90k–CA$120k", min: 90000, max: 120000, currency: "CAD", period: "Unknown", visible: true },
  { input: "CAD $90,000 to $120,000", min: 90000, max: 120000, currency: "CAD", period: "Unknown", visible: true },
  { input: "€70k - €90k", min: 70000, max: 90000, currency: "EUR", period: "Unknown", visible: true },
  { input: "EUR 70,000–90,000", min: 70000, max: 90000, currency: "EUR", period: "Unknown", visible: true },
  { input: "£60k–£85k", min: 60000, max: 85000, currency: "GBP", period: "Unknown", visible: true },
  { input: "$35/hr", min: 35, max: 35, currency: "USD", period: "hourly", visible: true },
  { input: "$800/day", min: 800, max: 800, currency: "USD", period: "daily", visible: true },
  { input: "$5k/mo", min: 5000, max: 5000, currency: "USD", period: "monthly", visible: true },
  { input: "$5,000/month", min: 5000, max: 5000, currency: "USD", period: "monthly", visible: true },
  { input: "Salary not listed", min: null, max: null, currency: "Unknown", period: "Unknown", visible: false },
  { input: "Competitive", min: null, max: null, currency: "Unknown", period: "Unknown", visible: true, salary: "Competitive" },
  { input: "Up to $120k", min: null, max: 120000, currency: "USD", period: "Unknown", visible: true },
  { input: "Starting at $75k", min: 75000, max: null, currency: "USD", period: "Unknown", visible: true }
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
assert.strictEqual(normalizedDescription.raw_description, descriptionInput);
assert.ok(!/<[^>]+>/.test(normalizedDescription.description), "description should not contain HTML");
assert.ok(!/equal opportunity employer/i.test(normalizedDescription.description), "boilerplate should be removed");
assert.ok(/Acme Climate builds planning software for decarbonization teams\./.test(normalizedDescription.description));
assert.ok(/You will own customer-facing product strategy and partner closely with design and engineering\./.test(normalizedDescription.description));
assert.ok(/The role also supports go-to-market teams with launch messaging and rollout planning\./.test(normalizedDescription.description));

console.log("test-normalizer: all checks passed");
