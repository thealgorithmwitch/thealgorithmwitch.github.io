const { scrapeGenericCareersPage } = require("./parsers/generic-careers-page");
const { scrapeEnergyPolicyInstitute } = require("./parsers/energy-policy-institute");
const { scrapeSourceWithDiscovery } = require("./discovery");

async function scrapeCustomSource(source) {
  const parser = source.parser || "generic-careers-page";
  if (parser === "generic-careers-page") {
    return scrapeGenericCareersPage(source);
  }
  if (parser === "energy-policy-institute") {
    return scrapeEnergyPolicyInstitute(source);
  }
  throw new Error(`Unsupported custom parser: ${parser}`);
}

module.exports = {
  scrapeCustomSource,
  scrapeSourceWithDiscovery
};
