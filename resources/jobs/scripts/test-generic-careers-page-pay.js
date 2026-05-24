const assert = require("assert");
const { parseGenericCareersPage } = require("./scrapers/parsers/generic-careers-page");

function main() {
  const html = `
    <html>
      <body>
        <article>
          <h2>Lifecycle Marketing Manager</h2>
          <p>GoodPower helps accelerate a renewable energy economy.</p>
          <p>Salary range: $70,000 - $90,000 per year.</p>
          <a href="https://goodpower.applytojob.com/apply/vMAlGDbrbu/Lifecycle-Marketing-Manager">Apply</a>
        </article>
      </body>
    </html>
  `;

  const source = {
    id: "goodpower",
    organization: "GoodPower",
    source_url: "https://goodpower.applytojob.com/apply",
    type: "custom",
    sector: "Policy/Advocacy"
  };

  const parsed = parseGenericCareersPage(html, source.source_url, source);
  assert.ok(Array.isArray(parsed.jobs), "jobs should be an array");
  assert.strictEqual(parsed.jobs.length, 1, "expected one parsed job");

  const job = parsed.jobs[0];
  assert.strictEqual(job.salary_min, 70000, "salary_min should be extracted");
  assert.strictEqual(job.salary_max, 90000, "salary_max should be extracted");
  assert.strictEqual(job.salary_currency, "USD", "salary_currency should be extracted");
  assert.strictEqual(job.salary_period, "year", "salary_period should be extracted");
  assert.strictEqual(job.salary_visible, true, "salary should be visible");
  assert.ok(/70,000/.test(job.salary), "canonical salary should be written");

  console.log(JSON.stringify({
    ok: true,
    title: job.title,
    salary: job.salary,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_currency: job.salary_currency,
    salary_period: job.salary_period
  }, null, 2));
}

main();
