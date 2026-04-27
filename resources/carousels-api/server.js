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
const MAX_HTML_SIZE = "8mb";
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 4000;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
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
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  if (parsed < MIN_DIMENSION || parsed > MAX_DIMENSION) throw new Error(`${label} must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`);
  return parsed;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Request body must be a JSON object.");
  const html = String(payload.html || "");
  if (!html.trim()) throw new Error("HTML is required.");
  const mode = String(payload.mode || "full");
  const validModes = new Set(["full", "slide", "page", "custom"]);
  if (!validModes.has(mode)) throw new Error("Mode must be one of: full, slide, page, custom.");
  const selector = String(payload.selector || "").trim();
  if (mode !== "full" && !selector) throw new Error("Selector is required for slide, page, and custom modes.");
  const width = toDimension(payload.width, "Width");
  const height = toDimension(payload.height, "Height");
  return {
    codexName: sanitizeCodexName(payload.codexName),
    html,
    mode,
    selector: mode === "slide" ? ".slide" : mode === "page" ? ".page" : mode === "custom" ? selector : "body",
    width,
    height,
    autoCenter: payload.autoCenter !== false,
    emojiFallback: payload.emojiFallback !== false,
    safePadding: Number.isFinite(Number(payload.safePadding)) ? Math.max(0, Number(payload.safePadding)) : null
  };
}

async function waitForAssets(page) {
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.allSettled(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      setTimeout(resolve, 4000);
    })));
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function installExportRuntime(page, payload) {
  await page.addStyleTag({
    content: `
      @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      *, *::before, *::after {
        box-sizing: border-box !important;
      }
      .scryer-emoji,
      .scryer-emoji-fallback {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif !important;
        display: inline-block;
        line-height: 1;
        vertical-align: -0.08em;
        white-space: nowrap;
      }
      .scryer-emoji-fallback {
        font-weight: 700;
      }
      #__scryer_capture_viewport__ {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: ${payload.width}px !important;
        height: ${payload.height}px !important;
        overflow: hidden !important;
        z-index: 2147483647 !important;
        isolation: isolate !important;
      }
      #__scryer_capture_viewport__,
      #__scryer_capture_viewport__ * {
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }
      body.__scryer_capturing__ > *:not(#__scryer_capture_viewport__) {
        visibility: hidden !important;
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.001s !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0s !important;
        }
      }
    `
  });
  await page.evaluate(() => {
    window.__scryerEmojiFallbackMap = {
      "🏆": "★", "🔍": "⌕", "🔎": "⌕", "🔮": "◉", "✨": "✦", "🌱": "⌁",
      "🌿": "❧", "🍃": "❧", "🎯": "◎", "💌": "✉", "🧠": "◌", "💭": "☁",
      "💡": "✦", "⚡": "ϟ", "🤖": "▣", "👑": "♛", "⚙️": "⚙", "⚙": "⚙",
      "📈": "↗", "📊": "▥", "🧲": "∩", "🪄": "✦"
    };
    window.__scryerWrapEmojiTextNodes = function(root) {
      const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !emojiRegex.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          emojiRegex.lastIndex = 0;
          const parent = node.parentElement;
          if (!parent || parent.closest("script, style, textarea")) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains("scryer-emoji")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const frag = document.createDocumentFragment();
        const text = node.nodeValue;
        let last = 0;
        emojiRegex.lastIndex = 0;
        for (const match of text.matchAll(emojiRegex)) {
          if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
          const span = document.createElement("span");
          span.className = "scryer-emoji";
          span.textContent = match[0];
          frag.appendChild(span);
          last = match.index + match[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    };
    window.__scryerApplyEmojiFallbacks = function(root) {
      const map = window.__scryerEmojiFallbackMap || {};
      const spans = Array.from(root.querySelectorAll(".scryer-emoji"));
      for (const span of spans) {
        const value = span.textContent.trim();
        if (!value) continue;
        const rect = span.getBoundingClientRect();
        const fallback = map[value] || map[value.replace(/\uFE0F/g, "")];
        const looksMissing = rect.width <= 4 || span.textContent.includes("□");
        if (fallback && looksMissing) {
          span.className = "scryer-emoji-fallback";
          span.textContent = fallback;
        }
      }
    };
    window.__scryerResolveBackground = function(element) {
      const isVisibleBg = (style) => {
        if (!style) return false;
        const color = style.backgroundColor;
        const image = style.backgroundImage;
        return (image && image !== "none") || (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
      };
      let node = element;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (isVisibleBg(style)) return style.background;
        node = node.parentElement;
      }
      const root = document.querySelector("#carousel-root");
      if (root) {
        const style = getComputedStyle(root);
        if (isVisibleBg(style)) return style.background;
      }
      const bodyStyle = getComputedStyle(document.body);
      if (isVisibleBg(bodyStyle)) return bodyStyle.background;
      return "#ffffff";
    };
    window.__scryerIsMeaningful = function(el, slide) {
      if (!el || el === slide) return false;
      if (el.closest(".grid-overlay, .mystic-frame, .mystic-corner, .nav-controls, .slide-counter")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const opacity = parseFloat(style.opacity || "1");
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const text = (el.innerText || el.textContent || "").trim();
      const hasText = text.length > 0;
      const isMedia = ["IMG", "SVG", "CANVAS", "VIDEO"].includes(el.tagName);
      const pointerNone = style.pointerEvents === "none";
      const slideRect = slide.getBoundingClientRect();
      const areaRatio = (rect.width * rect.height) / Math.max(slideRect.width * slideRect.height, 1);
      if (opacity < 0.12) return false;
      if (pointerNone && !hasText && !isMedia) return false;
      if (areaRatio > 0.7 && !hasText) return false;
      return hasText || isMedia || style.borderWidth !== "0px" || style.backgroundImage !== "none";
    };
    window.__scryerMeaningfulBounds = function(slide) {
      const els = Array.from(slide.querySelectorAll("*")).filter((el) => window.__scryerIsMeaningful(el, slide));
      const slideRect = slide.getBoundingClientRect();
      const boxes = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
      if (!boxes.length) {
        return { left: 0, top: 0, right: slideRect.width, bottom: slideRect.height, width: slideRect.width, height: slideRect.height };
      }
      const left = Math.min(...boxes.map((r) => r.left)) - slideRect.left;
      const top = Math.min(...boxes.map((r) => r.top)) - slideRect.top;
      const right = Math.max(...boxes.map((r) => r.right)) - slideRect.left;
      const bottom = Math.max(...boxes.map((r) => r.bottom)) - slideRect.top;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    window.__scryerPrepareClone = function(original, width, height, options) {
      document.getElementById("__scryer_capture_viewport__")?.remove();
      const bg = window.__scryerResolveBackground(original);
      const viewport = document.createElement("div");
      viewport.id = "__scryer_capture_viewport__";
      viewport.style.width = `${width}px`;
      viewport.style.height = `${height}px`;
      viewport.style.background = bg;
      viewport.style.overflow = "hidden";
      const stage = document.createElement("div");
      stage.id = "__scryer_capture_stage__";
      stage.style.position = "absolute";
      stage.style.inset = "0";
      stage.style.width = "100%";
      stage.style.height = "100%";
      stage.style.overflow = "hidden";
      stage.style.display = "flex";
      stage.style.alignItems = "center";
      stage.style.justifyContent = "center";
      stage.style.background = bg;
      const clone = original.cloneNode(true);
      clone.removeAttribute("id");
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.minWidth = `${width}px`;
      clone.style.minHeight = `${height}px`;
      clone.style.maxWidth = `${width}px`;
      clone.style.maxHeight = `${height}px`;
      clone.style.margin = "0";
      clone.style.boxSizing = "border-box";
      clone.style.position = "relative";
      clone.style.left = "auto";
      clone.style.right = "auto";
      clone.style.top = "auto";
      clone.style.bottom = "auto";
      clone.style.transform = "none";
      clone.style.overflow = "hidden";
      const cloneStyle = getComputedStyle(original);
      const hasOwnBg = cloneStyle.backgroundImage !== "none" ||
        (cloneStyle.backgroundColor && cloneStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && cloneStyle.backgroundColor !== "transparent");
      if (!hasOwnBg) clone.style.background = bg;
      clone.querySelectorAll("#slides-container, [id='slides-container']").forEach((track) => {
        track.style.transform = "none";
        track.style.transition = "none";
        track.style.width = `${width}px`;
        track.style.height = `${height}px`;
        track.style.display = "block";
      });
      clone.querySelectorAll(".nav-controls, .slide-counter").forEach((el) => {
        el.style.display = "none";
      });
      const inner = document.createElement("div");
      inner.id = "__scryer_inner__";
      inner.style.position = "absolute";
      inner.style.inset = "0";
      inner.style.width = "100%";
      inner.style.height = "100%";
      inner.style.transformOrigin = "center center";
      while (clone.firstChild) inner.appendChild(clone.firstChild);
      clone.appendChild(inner);
      stage.appendChild(clone);
      viewport.appendChild(stage);
      document.body.appendChild(viewport);
      document.body.classList.add("__scryer_capturing__");
      window.__scryerWrapEmojiTextNodes(clone);
      const safePadding = Number.isFinite(options.safePadding)
        ? options.safePadding
        : Math.min(Math.round(Math.min(width, height) * 0.09), height >= 1800 ? 120 : height > width ? 96 : 72);
      if (options.autoCenter !== false) {
        const bounds1 = window.__scryerMeaningfulBounds(clone);
        const safeW = Math.max(width - safePadding * 2, 1);
        const safeH = Math.max(height - safePadding * 2, 1);
        let scale = Math.min(1, safeW / Math.max(bounds1.width, 1), safeH / Math.max(bounds1.height, 1));
        const centerX = bounds1.left + bounds1.width / 2;
        const centerY = bounds1.top + bounds1.height / 2;
        let tx = width / 2 - centerX;
        let ty = height / 2 - centerY;
        const scaledW = bounds1.width * scale;
        const scaledH = bounds1.height * scale;
        if (scaledW > safeW) tx = 0;
        if (scaledH > safeH) ty = 0;
        inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        const bounds2 = window.__scryerMeaningfulBounds(clone);
        let adjustX = 0;
        let adjustY = 0;
        if (bounds2.left < safePadding) adjustX += safePadding - bounds2.left;
        if (bounds2.right > width - safePadding) adjustX -= bounds2.right - (width - safePadding);
        if (bounds2.top < safePadding) adjustY += safePadding - bounds2.top;
        if (bounds2.bottom > height - safePadding) adjustY -= bounds2.bottom - (height - safePadding);
        if (adjustX || adjustY) {
          inner.style.transform = `translate(${tx + adjustX}px, ${ty + adjustY}px) scale(${scale})`;
        }
      }
      window.__scryerApplyEmojiFallbacks(clone);
      return { background: bg };
    };
    window.__scryerCleanupCapture = function() {
      document.body.classList.remove("__scryer_capturing__");
      document.getElementById("__scryer_capture_viewport__")?.remove();
    };
  });
}

async function captureOne(page, outputPath, payload, selector, index) {
  await page.evaluate(({ selector, index, width, height, autoCenter, safePadding, emojiFallback }) => {
    const nodes = selector === "body" ? [document.body] : Array.from(document.querySelectorAll(selector));
    const original = nodes[index];
    if (!original) throw new Error(`No capture target found for ${selector} at index ${index}.`);
    window.__scryerPrepareClone(original, width, height, { autoCenter, safePadding, emojiFallback });
  }, {
    selector,
    index,
    width: payload.width,
    height: payload.height,
    autoCenter: payload.autoCenter,
    safePadding: payload.safePadding,
    emojiFallback: payload.emojiFallback
  });
  await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({
    path: outputPath,
    type: "png",
    clip: { x: 0, y: 0, width: payload.width, height: payload.height },
    omitBackground: false
  });
  await page.evaluate(() => window.__scryerCleanupCapture && window.__scryerCleanupCapture()).catch(() => {});
}

async function captureTargets(page, payload, outputDir) {
  let count = 1;
  if (payload.mode !== "full") {
    try {
      count = await page.$$eval(payload.selector, (nodes) => nodes.length);
    } catch (_error) {
      throw new Error(`Invalid selector "${payload.selector}".`);
    }
    if (!count) throw new Error(`No elements matched selector "${payload.selector}".`);
  }
  const files = [];
  for (let i = 0; i < count; i += 1) {
    const filename = payload.mode === "full"
      ? `${payload.codexName}.png`
      : `slide-${String(i + 1).padStart(2, "0")}.png`;
    const outputPath = path.join(outputDir, filename);
    await captureOne(page, outputPath, payload, payload.mode === "full" ? "body" : payload.selector, i);
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
    if (!response.headersSent) response.status(500).json({ error: "Could not build ZIP archive." });
    else response.destroy(error);
  });
  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Content-Disposition", `attachment; filename="${zipName}.zip"`);
  archive.pipe(response);
  for (const file of files) archive.file(file, { name: path.basename(file) });
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
        "--disable-gpu",
        "--font-render-hinting=none",
        "--disable-lcd-text"
      ]
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);
    await page.setViewport({
      width: payload.width,
      height: payload.height,
      deviceScaleFactor: 1
    });
    await page.setContent(payload.html, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await waitForAssets(page);
    await installExportRuntime(page, payload);
    await waitForAssets(page);
    const files = await captureTargets(page, payload, tempDir);
    await page.close();
    await browser.close();
    browser = null;
    await zipFilesToResponse(files, payload.codexName, response, tempDir);
  } catch (error) {
    console.error("Export route failure", error);
    if (browser) await browser.close().catch(() => undefined);
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error && error.message ? String(error.message) : "Export failed.";
    const status = /required|invalid|must be|No elements matched|No capture target|Request body/i.test(message) ? 400 : 500;
    response.status(status).json(status === 400 ? { error: message } : { error: "Export failed", detail: message });
  }
});

app.listen(PORT, () => {
  console.log("HTML Scryer startup", {
    cwd: process.cwd(),
    puppeteerCacheDir: process.env.PUPPETEER_CACHE_DIR || "",
    executablePath,
    defaultPuppeteerCacheExists: fs.existsSync("/opt/render/.cache/puppeteer")
  });
  console.log(`HTML Scryer API listening on ${PORT}`);
});
