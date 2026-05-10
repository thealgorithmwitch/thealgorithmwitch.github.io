const normalizer = require("./job-normalizer");

const importedHasMalformedDescriptionTemplate = normalizer.hasMalformedDescriptionTemplate;

function fallbackHasMalformedDescriptionTemplate(text) {
  const value = String(text || "");
  return /\bThe\s+(will|is|are|,|\.)\b/i.test(value)
    || /\bThe\s{2,}\w+/i.test(value)
    || /\bThe\s*<\/[^>]+>\s*will\b/i.test(value);
}

function hasMalformedDescriptionTemplateSafe(text) {
  if (typeof importedHasMalformedDescriptionTemplate === "function") {
    return importedHasMalformedDescriptionTemplate(text);
  }
  return fallbackHasMalformedDescriptionTemplate(text);
}

module.exports = {
  fallbackHasMalformedDescriptionTemplate,
  hasMalformedDescriptionTemplateSafe,
  importedHasMalformedDescriptionTemplate
};
