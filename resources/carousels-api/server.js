const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_HTML_SIZE = "5mb";
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 4000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: MAX_HTML_SIZE }));
app.use(express.static(__dirname));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "html-scryer-api" });
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
  await page.evaluate(async () => {
    const fontsReady = document.fonts?.ready?.catch?.(() => undefined) || Promise.resolve();
    const imagePromises = Array.from(document.images || []).map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    });
    await Promise.all([fontsReady, ...imagePromises]);
  });

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await page.waitForTimeout(250);
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

async function captureElements(page, selector, outputDir) {
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
    await handle.screenshot({
      path: outputPath,
      type: "png"
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
    await cleanup();
    if (!response.headersSent) {
      response.status(500).json({ ok: false, error: error.message || "Could not build ZIP archive." });
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
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: payload.width,
      height: payload.height,
      deviceScaleFactor: 1
    });
    await page.setContent(payload.html, { waitUntil: "networkidle0" });
    await waitForAssets(page);

    const files = [];
    if (payload.mode === "full") {
      const outputPath = path.join(tempDir, `${payload.codexName}.png`);
      await captureFullPage(page, outputPath);
      files.push(outputPath);
    } else {
      const captured = await captureElements(page, payload.selector, tempDir);
      files.push(...captured);
    }

    await page.close();
    await browser.close();
    browser = null;

    await zipFilesToResponse(files, payload.codexName, response, tempDir);
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const message = error && error.message ? String(error.message) : "Export failed.";
    const status = /required|invalid|must be|No elements matched|could not find|Request body/i.test(message) ? 400 : 500;
    response.status(status).json({
      ok: false,
      error: message
    });
  }
});

app.listen(PORT, () => {
  console.log(`HTML Scryer API listening on ${PORT}`);
});
