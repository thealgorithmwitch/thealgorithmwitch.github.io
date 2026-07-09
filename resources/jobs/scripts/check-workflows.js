const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const JOBS_ROOT = path.resolve(__dirname, "..");
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const PACKAGE_JSON = path.join(JOBS_ROOT, "package.json");
const EXPECTED_JOBS_DIR = path.relative(ROOT, JOBS_ROOT);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    throw new Error(`Missing workflow directory: ${WORKFLOWS_DIR}`);
  }
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((file) => /\.(yml|yaml)$/i.test(file))
    .map((file) => path.join(WORKFLOWS_DIR, file))
    .sort();
}

function validateWorkflow(filePath, scripts) {
  const body = fs.readFileSync(filePath, "utf8");
  const missingScripts = [];
  const invalidJobsDirRefs = [];
  const staleWorkingDirectoryRefs = [];

  const scriptRefs = Array.from(body.matchAll(/npm(?:\s+--prefix\s+["']?\$JOBS_DIR["']?)?\s+run\s+(jobs:[A-Za-z0-9:-]+)/g)).map((match) => match[1]);
  for (const ref of scriptRefs) {
    if (!scripts.has(ref)) {
      missingScripts.push(ref);
    }
  }

  const jobsDirMatch = body.match(/JOBS_DIR:\s*([^\s]+)/);
  if (!jobsDirMatch) {
    invalidJobsDirRefs.push("missing JOBS_DIR env declaration");
  } else if (jobsDirMatch[1] !== EXPECTED_JOBS_DIR) {
    invalidJobsDirRefs.push(`JOBS_DIR points to ${jobsDirMatch[1]} instead of ${EXPECTED_JOBS_DIR}`);
  }

  const cachePathMatch = body.match(/cache-dependency-path:\s*([^\n]+)/);
  if (cachePathMatch && !cachePathMatch[1].includes("${{ env.JOBS_DIR }}/package-lock.json")) {
    staleWorkingDirectoryRefs.push("cache-dependency-path does not use ${ env.JOBS_DIR }/package-lock.json");
  }

  return {
    file: path.relative(ROOT, filePath),
    scriptRefs,
    missingScripts,
    invalidJobsDirRefs,
    staleWorkingDirectoryRefs
  };
}

function main() {
  const pkg = readJson(PACKAGE_JSON);
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  const workflows = listWorkflowFiles();
  const results = workflows.map((filePath) => validateWorkflow(filePath, scripts));
  const missing = results.flatMap((result) => result.missingScripts.map((script) => `${result.file}:${script}`));
  const pathIssues = results.flatMap((result) => [
    ...result.invalidJobsDirRefs.map((issue) => `${result.file}:${issue}`),
    ...result.staleWorkingDirectoryRefs.map((issue) => `${result.file}:${issue}`)
  ]);

  console.log(`[jobs:check-workflows] workflows_checked=${results.length}`);
  results.forEach((result) => {
    console.log(`[jobs:check-workflows] file=${result.file} jobs_scripts=${result.scriptRefs.length} missing_scripts=${result.missingScripts.length} path_issues=${result.invalidJobsDirRefs.length + result.staleWorkingDirectoryRefs.length}`);
  });

  if (missing.length || pathIssues.length) {
    if (missing.length) {
      console.error("[jobs:check-workflows] missing_script_references:");
      missing.forEach((entry) => console.error(`  - ${entry}`));
    }
    if (pathIssues.length) {
      console.error("[jobs:check-workflows] path_issues:");
      pathIssues.forEach((entry) => console.error(`  - ${entry}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log("[jobs:check-workflows] ok=true");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[jobs:check-workflows] Failed: ${error.message}`);
    process.exitCode = 1;
  }
}
