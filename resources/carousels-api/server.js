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
    node: process.version
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
    await Promise.allSettled(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      setTimeout(resolve, 3000);
    })));
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function captureFullPage(page, outputPath) {
  const body = await page.$("body");
  if (!body) {
    throw new Error("Could not find <body> in the submitted HTML.");
  }

  await body.screenshot({
    path: outputPath,
    type: "png"
  });
}

async function captureElements(page, selector, outputDir, payload) {
  if (payload.mode === "slide") {
    const slideCount = await page.$$eval(".slide", (nodes) => nodes.length).catch(() => 0);
    if (!slideCount) {
      throw new Error('No elements matched selector ".slide".');
    }
  }

  let handles;
  try {
    handles = await page.$$(selector);
  } catch (error) {
    throw new Error(`Invalid selector "${selector}".`);
  }

  if (!handles.length) {
    throw new Error(`No elements matched selector "${selector}".`);
  }

  const files = [];
  for (const [index, handle] of handles.entries()) {
    const filename = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const outputPath = path.join(outputDir, filename);
    const backgroundColor = await handle.evaluate((element, width, height) => {
      const computed = window.getComputedStyle(element);
      const bodyComputed = window.getComputedStyle(document.body);
      const resolvedBackground = computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? computed.backgroundColor
        : bodyComputed.backgroundColor;

      const existingWrapper = document.getElementById("__html_scryer_capture_wrapper__");
      if (existingWrapper) {
        existingWrapper.remove();
      }

      const wrapper = document.createElement("div");
      wrapper.id = "__html_scryer_capture_wrapper__";
      wrapper.style.position = "fixed";
      wrapper.style.left = "0";
      wrapper.style.top = "0";
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
      wrapper.style.overflow = "hidden";
      wrapper.style.background = resolvedBackground;
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.justifyContent = "center";
      wrapper.style.zIndex = "2147483647";
      wrapper.style.fontFamily = 'inherit, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

      const clone = element.cloneNode(true);
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.minHeight = `${height}px`;
      clone.style.maxWidth = `${width}px`;
      clone.style.boxSizing = "border-box";
      clone.style.overflow = "hidden";
      clone.style.transform = "none";
      clone.style.left = "auto";
      clone.style.right = "auto";
      clone.style.margin = "0";
      clone.style.fontFamily = 'inherit, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      if (!computed.backgroundColor || computed.backgroundColor === "rgba(0, 0, 0, 0)") {
        clone.style.backgroundColor = resolvedBackground;
      }

      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      return resolvedBackground;
    }, payload.width, payload.height);
    const clipWidth = payload.width;
    const clipHeight = payload.height;
    console.log("Capturing element", {
      selector,
      index: index + 1,
      width: clipWidth,
      height: clipHeight,
      clipWidth,
      clipHeight,
      backgroundColor
    });
    await page.screenshot({
      path: outputPath,
      type: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: clipWidth,
        height: clipHeight
      }
    });
    await page.evaluate(() => {
      document.getElementById("__html_scryer_capture_wrapper__")?.remove();
    });
    files.push(outputPath);
  }

  await Promise.all(handles.map((handle) => handle.dispose()));
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
      content: `
        @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
        body, .slide, .page {
          font-family: inherit, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif !important;
        }
        html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
        .slide, .page {
          width: ${payload.width}px !important;
          height: ${payload.height}px !important;
          min-height: ${payload.height}px !important;
          max-width: ${payload.width}px !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
          transform: none !important;
          left: auto !important;
          right: auto !important;
        }
        .slide > *, .page > * {
          max-width: calc(${payload.width}px - 160px) !important;
        }
      `
    });

    const files = [];
    if (payload.mode === "full") {
      const outputPath = path.join(tempDir, `${payload.codexName}.png`);
      await captureFullPage(page, outputPath);
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
      detail: message
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
