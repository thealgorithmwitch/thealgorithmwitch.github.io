const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_HTML_SIZE = "5mb";
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 4000;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: MAX_HTML_SIZE }));
app.use(express.static(__dirname));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "html-scryer-api",
    executablePath,
    node: process.version,
    warning: "Render may still miss some emoji glyphs. Replace critical emoji with inline SVG or image assets for deterministic exports."
  });
});

function sanitizeCodexName(value) {
  const cleaned = String(value || "html-scryer-export")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "html-scryer-export";
}

function toDimension(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (parsed < MIN_DIMENSION || parsed > MAX_DIMENSION) {
    throw new Error(`${label} must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`);
  }
  return parsed;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const html = String(payload.html || "");
  if (!html.trim()) {
    throw new Error("HTML is required.");
  }

  const mode = String(payload.mode || "full");
  const validModes = new Set(["full", "slide", "page", "custom"]);
  if (!validModes.has(mode)) {
    throw new Error("Mode must be one of: full, slide, page, custom.");
  }

  const selector = String(payload.selector || "").trim();
  if (mode !== "full" && !selector) {
    throw new Error("Selector is required for slide, page, and custom modes.");
  }

  return {
    codexName: sanitizeCodexName(payload.codexName),
    html,
    mode,
    selector,
    width: toDimension(payload.width, "Width"),
    height: toDimension(payload.height, "Height")
  };
}

async function waitForAssets(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 10000 }).catch(() => {});
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    await Promise.allSettled(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      setTimeout(resolve, 3000);
    })));
    await Promise.allSettled(stylesheets.map((sheet) => new Promise((resolve) => {
      if (sheet.sheet) {
        resolve();
        return;
      }
      sheet.addEventListener("load", resolve, { once: true });
      sheet.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 3000);
    })));
  }).catch(() => {});
  await page.waitForFunction(() => {
    const icons = Array.from(document.querySelectorAll('i[class^="ph-"], i[class*=" ph-"]'));
    if (!icons.length) return true;
    return icons.every((icon) => (icon.textContent || "").trim().length > 0);
  }, { timeout: 1000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
}

await page.addStyleTag({
  content: `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      overflow: hidden !important;
      background: transparent !important;
    }

    #carousel-root {
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      max-width: ${payload.width}px !important;
      max-height: ${payload.height}px !important;
      aspect-ratio: auto !important;
      box-shadow: none !important;
      overflow: hidden !important;
    }

    #slides-container {
      display: block !important;
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      transform: none !important;
      transition: none !important;
    }

    .slide {
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      min-width: ${payload.width}px !important;
      min-height: ${payload.height}px !important;
      max-width: ${payload.width}px !important;
      max-height: ${payload.height}px !important;
      flex: none !important;
      flex-basis: auto !important;
      display: flex !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      position: relative !important;
      padding: 100px !important;
    }

    .nav-controls {
      display: none !important;
    }

    .slide * {
      box-sizing: border-box !important;
    }

    .slide h1,
    .slide h2,
    .slide h3 {
      text-wrap: balance;
      max-width: 880px !important;
    }

    .stat-box {
      max-width: 760px !important;
    }

    .break-all {
      word-break: normal !important;
      overflow-wrap: anywhere !important;
      font-size: 26px !important;
      line-height: 1.15 !important;
    }
  `
});

function buildScryerCaptureStyles(width, height) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700;900&family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&family=DM+Serif+Display:ital@0;1&family=Cormorant+Garamond:wght@400;500;600;700&family=Noto+Color+Emoji&display=swap');
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${width}px !important;
      height: ${height}px !important;
      overflow: hidden !important;
    }

    *, *::before, *::after {
      box-sizing: border-box !important;
      animation-play-state: paused !important;
      transition: none !important;
      caret-color: transparent !important;
    }

    body {
      --scryer-safe-padding: 72px;
      font-family: "Inter", "Space Grotesk", "JetBrains Mono", "Playfair Display", "Cinzel Decorative", "DM Serif Display", "Cormorant Garamond", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif !important;
    }

    button, .button, [role="button"], svg, i[class^="ph-"], i[class*=" ph-"] {
      visibility: visible !important;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
      }
    }
  `;
}

async function captureFullPage(page, outputPath, payload) {
  await page.screenshot({
    path: outputPath,
    type: "png",
    clip: {
      x: 0,
      y: 0,
      width: payload.width,
      height: payload.height
    }
  });
}

async function captureElements(page, selector, outputDir, payload) {
  let count;
  try {
    count = await page.$$eval(selector, (nodes) => nodes.length);
  } catch (_error) {
    throw new Error(`Invalid selector "${selector}".`);
  }
  if (!count) throw new Error(`No elements matched selector "${selector}".`);
  console.log("HTML Scryer selector export", {
    mode: payload.mode,
    selector,
    countFound: count,
    viewport: {
      width: payload.width,
      height: payload.height
    }
  });

  const files = [];
  for (let index = 0; index < count; index += 1) {
    const filename = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const outputPath = path.join(outputDir, filename);
    const targetBoundingBox = await page.evaluate(({ selector: selectorValue, index: itemIndex }) => {
      const target = Array.from(document.querySelectorAll(selectorValue))[itemIndex];
      if (!target) return null;
      const box = target.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }, {
      selector,
      index
    });
    console.log("HTML Scryer capture target", {
      screenshot: filename,
      targetBoundingBox
    });
    await page.evaluate(({ selector: selectorValue, index: itemIndex, width, height }) => {
      const nodes = Array.from(document.querySelectorAll(selectorValue));
      const original = nodes[itemIndex];
      if (!original) throw new Error(`Could not find slide ${itemIndex + 1}`);
      window.__scryerRestore = [];
      const safePadding = 72;
      const save = (el) => {
        window.__scryerRestore.push([el, el.getAttribute("style")]);
      };
      save(document.documentElement);
      save(document.body);
      const computed = window.getComputedStyle(original);
      const bodyComputed = window.getComputedStyle(document.body);
      const background =
        computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
          ? computed.backgroundColor
          : bodyComputed.backgroundColor || "transparent";
      const backgroundImage =
        computed.backgroundImage && computed.backgroundImage !== "none"
          ? computed.backgroundImage
          : bodyComputed.backgroundImage || "none";
      const colorMatch = background.match(/rgba?\(([^)]+)\)/);
      let isPlainDark = false;
      if (colorMatch) {
        const [r, g, b] = colorMatch[1].split(",").slice(0, 3).map((value) => Number.parseFloat(value.trim()) || 0);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        isPlainDark = backgroundImage === "none" && luminance < 0.35;
      }
      document.documentElement.style.cssText += `
        margin:0!important;
        padding:0!important;
        width:${width}px!important;
        height:${height}px!important;
        overflow:hidden!important;
      `;
      document.body.style.cssText += `
        margin:0!important;
        padding:0!important;
        width:${width}px!important;
        height:${height}px!important;
        overflow:hidden!important;
        background:${background}!important;
      `;
      nodes.forEach((node) => {
        if (node !== original) {
          save(node);
          node.style.display = "none";
        }
      });

      document.getElementById("__scryer_capture_root__")?.remove();

      const root = document.createElement("div");
      root.id = "__scryer_capture_root__";
      root.style.position = "fixed";
      root.style.inset = "0";
      root.style.width = `${width}px`;
      root.style.height = `${height}px`;
      root.style.overflow = "hidden";
      root.style.background = background;
      root.style.display = "flex";
      root.style.alignItems = "center";
      root.style.justifyContent = "center";
      root.style.zIndex = "2147483647";

      if (isPlainDark) {
        const grid = document.createElement("div");
        grid.style.position = "absolute";
        grid.style.inset = "0";
        grid.style.pointerEvents = "none";
        grid.style.opacity = "0.08";
        grid.style.backgroundImage = "linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)";
        grid.style.backgroundSize = "48px 48px";
        grid.style.zIndex = "0";
        root.appendChild(grid);
      }

      const clone = original.cloneNode(true);
      clone.style.margin = "0";
      clone.style.position = "relative";
      clone.style.left = "auto";
      clone.style.right = "auto";
      clone.style.top = "auto";
      clone.style.bottom = "auto";
      clone.style.transform = "none";
      clone.style.boxSizing = "border-box";
      clone.style.background = background;
      clone.style.zIndex = "1";
      clone.style.flexShrink = "0";

      const fitInner = document.createElement("div");
      fitInner.id = "__scryer_fit_inner__";
      fitInner.style.display = "block";
      fitInner.style.transformOrigin = "center center";
      fitInner.style.willChange = "transform";
      fitInner.appendChild(clone);
      root.appendChild(fitInner);
      document.body.appendChild(root);
      const naturalRect = clone.getBoundingClientRect();
      const naturalWidth = Math.max(naturalRect.width, 1);
      const naturalHeight = Math.max(naturalRect.height, 1);
      const safeWidth = width - safePadding * 2;
      const safeHeight = height - safePadding * 2;
      const scale = Math.min(1, safeWidth / naturalWidth, safeHeight / naturalHeight);
      fitInner.style.transform = `scale(${scale})`;
    }, {
      selector,
      index,
      width: payload.width,
      height: payload.height
    });
    await waitForAssets(page);
    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: payload.width,
        height: payload.height
      }
    });
    await page.evaluate(() => {
      document.getElementById("__scryer_capture_root__")?.remove();
      if (window.__scryerRestore) {
        for (const [el, style] of window.__scryerRestore.reverse()) {
          if (style === null) el.removeAttribute("style");
          else el.setAttribute("style", style);
        }
      }
      delete window.__scryerRestore;
    });
    files.push(outputPath);
  }
  return files;
}

async function zipFilesToResponse(files, zipName, response, tempDir) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  response.on("finish", cleanup);
  response.on("close", cleanup);
  archive.on("error", async (error) => {
    console.error("ZIP archive failure", error);
    await cleanup();
    if (!response.headersSent) {
      response.status(500).json({ error: "Could not build ZIP archive." });
    } else {
      response.destroy(error);
    }
  });

  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Content-Disposition", `attachment; filename="${zipName}.zip"`);

  archive.pipe(response);
  for (const file of files) {
    archive.file(file, { name: path.basename(file) });
  }
  await archive.finalize();
}

app.post("/api/export-html", async (request, response) => {
  let browser;
  let tempDir;

  try {
    const payload = validatePayload(request.body);
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `${payload.codexName}-`));

    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: payload.width,
      height: payload.height,
      deviceScaleFactor: 1
    });
    await page.setContent(payload.html, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.evaluate((width, height) => {
      window.__SCRYER_EXPORT_WIDTH__ = width;
      window.__SCRYER_EXPORT_HEIGHT__ = height;
    }, payload.width, payload.height);
    await waitForAssets(page);
    await page.addStyleTag({
      content: buildScryerCaptureStyles(payload.width, payload.height)
    });

    const files = [];
    if (payload.mode === "full") {
      const outputPath = path.join(tempDir, `${payload.codexName}.png`);
      await captureFullPage(page, outputPath, payload);
      files.push(outputPath);
    } else {
      const captured = await captureElements(page, payload.selector, tempDir, payload);
      files.push(...captured);
    }

    await page.close();
    await browser.close();
    browser = null;

    await zipFilesToResponse(files, payload.codexName, response, tempDir);
  } catch (error) {
    console.error("Export route failure", error);
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const message = error && error.message ? String(error.message) : "Export failed.";
    const status = /required|invalid|must be|No elements matched|could not find|Request body/i.test(message) ? 400 : 500;
    if (status === 400) {
      response.status(status).json({ error: message });
      return;
    }
    response.status(status).json({
      error: "Export failed",
      detail: message,
      warning: "Emoji glyphs may not render consistently on Render. Replace critical emoji with inline SVG or image assets for deterministic exports."
    });
  }
});

app.listen(PORT, () => {
  const puppeteerCacheDir = process.env.PUPPETEER_CACHE_DIR || "";
  console.log("HTML Scryer startup", {
    cwd: process.cwd(),
    puppeteerCacheDir,
    executablePath,
    defaultPuppeteerCacheExists: fs.existsSync("/opt/render/.cache/puppeteer")
  });
  console.log(`HTML Scryer API listening on ${PORT}`);
});
