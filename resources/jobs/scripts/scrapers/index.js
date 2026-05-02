const { scrapeGenericCareersPage } = require("./parsers/generic-careers-page");
const { scrapeSourceWithDiscovery } = require("./discovery");

async function scrapeCustomSource(source) {
  const parser = source.parser || "generic-careers-page";
  if (parser === "generic-careers-page") {
    return scrapeGenericCareersPage(source);
  }
  throw new Error(`Unsupported custom parser: ${parser}`);
}

module.exports = {
  scrapeCustomSource,
  scrapeSourceWithDiscovery
};
