const jobNormalizer = require("./job-normalizer");

if (typeof jobNormalizer.hasMalformedDescriptionTemplate !== "function") {
  throw new TypeError("job-normalizer must export hasMalformedDescriptionTemplate");
}

console.log("[test-job-normalizer-exports] hasMalformedDescriptionTemplate export verified");
