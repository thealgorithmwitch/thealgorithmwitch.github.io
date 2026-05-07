const fs = require("fs/promises");
const path = require("path");

const ASSET_BASE_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/";
const TARGET_DIR = path.join(__dirname, "..", "assets", "twemoji", "svg");

const EMOJI_ASSETS = [
  { emoji: "🔮", filename: "1f52e.svg" },
  { emoji: "✨", filename: "2728.svg" },
  { emoji: "🪴", filename: "1fab4.svg" },
  { emoji: "🌱", filename: "1f331.svg" },
  { emoji: "💚", filename: "1f49a.svg" },
  { emoji: "🍀", filename: "1f340.svg" },
  { emoji: "🌳", filename: "1f333.svg" },
  { emoji: "🌻", filename: "1f33b.svg" },
  { emoji: "🌞", filename: "1f31e.svg" },
  { emoji: "🪷", filename: "1fab7.svg" },
  { emoji: "🌼", filename: "1f33c.svg" },
  { emoji: "🌿", filename: "1f33f.svg" },
  { emoji: "⚡", filename: "26a1.svg" },
  { emoji: "🪄", filename: "1fa84.svg" },
  { emoji: "📚", filename: "1f4da.svg" },
  { emoji: "🤝", filename: "1f91d.svg" },
  { emoji: "🗳️", filename: "1f5f3.svg" },
  { emoji: "🏘️", filename: "1f3d8.svg" }
];

async function ensureTargetDir() {
  await fs.mkdir(TARGET_DIR, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function downloadAsset(asset) {
  const outputPath = path.join(TARGET_DIR, asset.filename);
  if (await fileExists(outputPath)) {
    return { status: "skipped", asset, outputPath };
  }

  const response = await fetch(`${ASSET_BASE_URL}${asset.filename}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${asset.filename}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
  return { status: "downloaded", asset, outputPath };
}

async function main() {
  await ensureTargetDir();

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const asset of EMOJI_ASSETS) {
    try {
      const result = await downloadAsset(asset);
      if (result.status === "downloaded") {
        downloaded += 1;
        console.log(`[twemoji] downloaded ${asset.emoji} -> ${result.outputPath}`);
      } else {
        skipped += 1;
        console.log(`[twemoji] skipped ${asset.emoji} -> ${result.outputPath}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`[twemoji] failed ${asset.emoji} (${asset.filename}): ${error.message}`);
    }
  }

  console.log(`[twemoji] downloaded=${downloaded} skipped=${skipped} failed=${failed}`);

  if (downloaded === 0 && failed > 0) {
    console.warn("[twemoji] no assets were downloaded. If you are offline, local exports will continue to fall back to jsDelivr.");
  }
}

main().catch((error) => {
  console.error("[twemoji] install failed:", error.message);
  process.exitCode = 1;
});
