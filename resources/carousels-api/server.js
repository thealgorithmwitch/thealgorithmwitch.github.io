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

function buildScryerCaptureStyles(width, height) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
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

    .slide, .page {
      width: ${width}px !important;
      height: ${height}px !important;
      min-width: ${width}px !important;
      min-height: ${height}px !important;
      max-width: ${width}px !important;
      max-height: ${height}px !important;
      overflow: hidden !important;
    }

    .slide:not([style*="padding"]), .page:not([style*="padding"]) {
      padding: var(--scryer-safe-padding, 96px) !important;
    }

    .slide > *, .page > * {
      max-width: calc(${width}px - 192px) !important;
    }

    body, .slide, .page, .slide *, .page * {
      font-family: "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif !important;
    }

    body {
      --scryer-safe-padding: 96px;
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
      const target = nodes[itemIndex];
      if (!target) throw new Error(`Could not find slide ${itemIndex + 1}`);
      window.__scryerRestore = [];
      const safePadding = 96;
      const save = (el) => {
        window.__scryerRestore.push([el, el.getAttribute("style")]);
      };
      save(document.documentElement);
      save(document.body);
      save(target);
      const computed = window.getComputedStyle(target);
      const bodyComputed = window.getComputedStyle(document.body);
      const background =
        computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
          ? computed.backgroundColor
          : bodyComputed.backgroundColor || "transparent";
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
        if (node !== target) {
          save(node);
          node.style.display = "none";
        }
      });
      target.style.cssText += `
        display:flex!important;
        position:fixed!important;
        inset:0!important;
        width:${width}px!important;
        height:${height}px!important;
        min-width:${width}px!important;
        min-height:${height}px!important;
        max-width:${width}px!important;
        max-height:${height}px!important;
        margin:0!important;
        transform:none!important;
        overflow:hidden!important;
        box-sizing:border-box!important;
        z-index:2147483647!important;
        align-items:center!important;
        justify-content:center!important;
        padding:${safePadding}px!important;
        background:${background}!important;
      `;

      const inner = document.createElement("div");
      inner.id = "__scryer_fit_inner__";
      inner.style.display = "block";
      inner.style.transformOrigin = "center center";
      inner.style.willChange = "transform";
      while (target.firstChild) {
        inner.appendChild(target.firstChild);
      }
      target.appendChild(inner);
      const innerRect = inner.getBoundingClientRect();
      const scale = Math.min(
        1,
        (width - safePadding * 2) / Math.max(innerRect.width, 1),
        (height - safePadding * 2) / Math.max(innerRect.height, 1)
      );
      inner.style.transform = `scale(${scale})`;
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
      if (window.__scryerRestore) {
        const inner = document.getElementById("__scryer_fit_inner__");
        if (inner?.parentElement) {
          const parent = inner.parentElement;
          while (inner.firstChild) {
            parent.insertBefore(inner.firstChild, inner);
          }
          inner.remove();
        }
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
