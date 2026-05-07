const fs = require("fs/promises");
const path = require("path");

const API_URL = "http://localhost:3000/api/export-html";
const OUTPUT_DIR = path.join(__dirname, "..", "test-output");

const HTML = `
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #08110f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .shell {
    width: 1080px;
    margin: 0 auto;
  }

  .carousel-viewport {
    width: 1080px;
    overflow: hidden;
    position: relative;
  }

  .slides-container {
    display: flex;
    width: 2160px;
    transform: translateX(0);
    transition: transform 0.4s ease;
  }

  .slide {
    width: 1080px;
    height: 1350px;
    flex: 0 0 1080px;
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    padding: 120px 96px;
    background:
      radial-gradient(circle at top left, rgba(207,255,122,0.2), transparent 35%),
      linear-gradient(180deg, #103b2f 0%, #061410 100%);
    color: #f4ffe8;
  }

  .subtitle {
    font-size: 42px;
    line-height: 1.3;
    max-width: 760px;
    margin-top: 48px;
  }

  .nav-dots {
    position: absolute;
    left: 50%;
    bottom: 52px;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    z-index: 20;
  }

  .nav-dots span {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: rgba(255,255,255,0.35);
  }

  .ticker {
    position: absolute;
    top: 44px;
    left: 96px;
    font-size: 28px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .btn-next,
  button {
    position: absolute;
    right: 36px;
    bottom: 36px;
    z-index: 30;
  }
</style>
<div class="shell">
  <div class="ticker">✨ Climate work ✨</div>
  <div class="carousel-viewport">
    <div class="slides-container">
      <section class="slide">
        <h1>🔮 Clean energy paths ✨</h1>
        <p class="subtitle">Let’s help more people find climate and clean energy work.</p>
        <p>🌱 💚 🌻 🌞 🪷 🌼 ⚡ 🪄</p>
        <button onclick="nextSlide()">Next →</button>
        <div class="btn-next">→</div>
        <div class="nav-dots"><span></span><span></span></div>
      </section>
      <section class="slide">
        <h1>🔮 Community builders ✨</h1>
        <p class="subtitle">Let’s help more people find climate and clean energy work.</p>
        <p>🌱 💚 🌻 🌞 🪷 🌼 ⚡ 🪄</p>
        <button onclick="nextSlide()">Next →</button>
        <div class="btn-next">→</div>
        <div class="nav-dots"><span></span><span></span></div>
      </section>
    </div>
  </div>
</div>
`;

async function saveExport(label, preserveLayout) {
  const payload = {
    codexName: `smoke-${label}`,
    html: HTML,
    mode: "slide",
    selector: ".slide",
    width: 1080,
    height: 1350,
    preserveLayout,
    emojiFallback: true
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(OUTPUT_DIR, `${payload.codexName}.zip`);
  await fs.writeFile(outputPath, buffer);

  console.log(`[smoke] ${label} status=${response.status}`);
  console.log(`[smoke] ${label} output=${outputPath}`);
  console.log(`[smoke] ${label} bytes=${buffer.length}`);
  console.log(`[smoke] ${label} nonEmpty=${buffer.length > 0}`);

  if (!response.ok) {
    console.log(`[smoke] ${label} response=${buffer.toString("utf8")}`);
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  try {
    await saveExport("clone", false);
    await saveExport("preserve-layout", true);
    console.log("[smoke] manual visual check: inspect the ZIPs in carousels/test-output/");
  } catch (error) {
    console.error("[smoke] export request failed:", error.message);
    console.error("[smoke] start the local server first with `npm start` in /Users/Cassandre/carousels.");
    process.exitCode = 1;
  }
}

main();
