const assert = require("assert");
const { mergeSafePublicJob } = require("./freshness-audit");

function main() {
  const current = {
    id: "Octopus Energy-f6d11145-9327-4f9c-8f68-a5a079a39bb9",
    title: "Energy Specialist - UK Support",
    organization: "Octopus Energy",
    salary: "$57,000 / year",
    location: "Wellington (NZ)"
  };

  const proposed = {
    salary: "",
    location: "Wellington (NZ)"
  };

  const result = mergeSafePublicJob(current, proposed, current);

  assert.strictEqual(result.job.salary, "$57,000 / year", "salary should be preserved");
  assert.strictEqual(result.job.location, "Wellington (NZ)", "location should be preserved");
  assert(
    result.riskyChanges.some((change) => change.field === "salary" && String(change.current || "") === "$57,000 / year" && String(change.proposed || "") === ""),
    "salary replacement should be recorded as risky"
  );
  assert(
    !result.riskyChanges.some((change) => change.field === "location"),
    "matching location should not be treated as risky"
  );

  console.log(JSON.stringify({
    ok: true,
    preserved_salary: result.job.salary,
    preserved_location: result.job.location,
    risky_changes: result.riskyChanges
  }, null, 2));
}

main();
