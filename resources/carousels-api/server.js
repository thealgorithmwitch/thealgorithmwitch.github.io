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
const MAX_EXPORT_PADDING = 400;
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
    preserveLayout: payload.preserveLayout === true,
    safePadding: Number.isFinite(Number(payload.safePadding)) ? Math.max(0, Number(payload.safePadding)) : null,
    exportPadding: Number.isFinite(Number(payload.exportPadding))
      ? Math.min(MAX_EXPORT_PADDING, Math.max(0, Number(payload.exportPadding)))
      : 0
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
      const exportPadding = Number.isFinite(options.exportPadding) ? Math.max(0, options.exportPadding) : 0;
      const canvasWidth = width + exportPadding * 2;
      const canvasHeight = height + exportPadding * 2;
      const viewport = document.createElement("div");
      viewport.id = "__scryer_capture_viewport__";
      viewport.style.width = `${canvasWidth}px`;
      viewport.style.height = `${canvasHeight}px`;
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
      if (exportPadding > 0) {
        stage.appendChild(clone);
        viewport.appendChild(stage);
        document.body.appendChild(viewport);
        document.body.classList.add("__scryer_capturing__");
        window.__scryerWrapEmojiTextNodes(clone);
        window.__scryerApplyEmojiFallbacks(clone);
        return { background: bg };
      }
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
  const exportPadding = selector === "body" ? 0 : payload.exportPadding;
  const clipWidth = payload.width + exportPadding * 2;
  const clipHeight = payload.height + exportPadding * 2;
  await page.setViewport({
    width: clipWidth,
    height: clipHeight,
    deviceScaleFactor: 1
  });
  await page.evaluate(({ selector, index, width, height, autoCenter, safePadding, emojiFallback, exportPadding }) => {
    const nodes = selector === "body" ? [document.body] : Array.from(document.querySelectorAll(selector));
    const original = nodes[index];
    if (!original) throw new Error(`No capture target found for ${selector} at index ${index}.`);
    window.__scryerPrepareClone(original, width, height, { autoCenter, safePadding, emojiFallback, exportPadding });
  }, {
    selector,
    index,
    width: payload.width,
    height: payload.height,
    autoCenter: payload.autoCenter,
    safePadding: payload.safePadding,
    emojiFallback: payload.emojiFallback,
    exportPadding
  });
  await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({
    path: outputPath,
    type: "png",
    clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
    omitBackground: false
  });
  await page.evaluate(() => window.__scryerCleanupCapture && window.__scryerCleanupCapture()).catch(() => {});
}

async function captureElementsPreserveLayout(page, selector, outputDir, payload) {
  await page.addStyleTag({
    url: "https://unpkg.com/@phosphor-icons/web/src/regular/style.css"
  }).catch(() => {});
  await page.addStyleTag({
    url: "https://unpkg.com/@phosphor-icons/web/src/fill/style.css"
  }).catch(() => {});
  await page.addStyleTag({
    content: `
      @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
      .ph, .ph-bold, .ph-duotone, .ph-fill {
        font-family: "Phosphor" !important;
        visibility: visible !important;
      }
    `
  }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }).catch(() => {});
  let count;
  try {
    count = await page.$$eval(selector, (nodes) => nodes.length);
  } catch (_error) {
    throw new Error(`Invalid selector "${selector}".`);
  }
  if (!count) {
    throw new Error(`No elements matched selector "${selector}".`);
  }
  const files = [];
  for (let index = 0; index < count; index += 1) {
    const outputPath = path.join(
      outputDir,
      `slide-${String(index + 1).padStart(2, "0")}.png`
    );
    const prepared = await page.evaluate(({ selector: selectorValue, index: itemIndex, width, height }) => {
      const el = document.querySelectorAll(selectorValue)[itemIndex];
      if (!el) return null;

      document.getElementById("__scryer_preserve_capture_root__")?.remove();

      const isVisibleBg = (style) => {
        if (!style) return false;
        const color = style.backgroundColor;
        const image = style.backgroundImage;
        return (image && image !== "none") || (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
      };
      const resolveBackground = (node) => {
        let current = node;
        while (current && current.nodeType === 1) {
          const style = window.getComputedStyle(current);
          if (isVisibleBg(style)) return style.background;
          current = current.parentElement;
        }
        const bodyStyle = window.getComputedStyle(document.body);
        if (isVisibleBg(bodyStyle)) return bodyStyle.background;
        return "#ffffff";
      };

      el.scrollIntoView({ block: "start", inline: "start" });
      const background = resolveBackground(el);
      const emojiFallbackMap = {
        "🎨": {
          type: "svg",
          value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3C7.03 3 3 6.58 3 11c0 2.34 1.17 4.44 3.03 5.9.55.43.85 1.1.74 1.79L6.5 21l2.82-.94c.53-.18 1.11-.12 1.61.12.35.17.71.31 1.07.42 4.45 1.33 9-1.7 9-6.1C21 7.7 17.03 3 12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="11" r="1.1" fill="currentColor"/><circle cx="11.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/><circle cx="14" cy="14" r="1.1" fill="currentColor"/></svg>'
        },
        "📖": {
          type: "svg",
          value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h11v16H7a2.5 2.5 0 0 0-2.5 2.5V5.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M18 3v16M7 6.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
        },
        "🗣️": {
          type: "svg",
          value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 10a6 6 0 0 1 10.24-4.24A6 6 0 0 1 20 10c0 1.61-.63 3.08-1.66 4.16L19 18l-3.28-.66A5.97 5.97 0 0 1 14 18h-4a6 6 0 0 1-6-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 10.5c.8-.2 1.7-.82 2.42-1.83.3-.42.97-.18.94.34v3.98c.03.52-.64.76-.94.34-.72-1.01-1.62-1.63-2.42-1.83" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.8 9.2c.55.5.9 1.23.9 2.05 0 .82-.35 1.55-.9 2.05" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
        },
        "🔍": {
          type: "svg",
          value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="5.5" stroke="currentColor" stroke-width="1.9"/><path d="M15.2 15.2 20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
        },
        "🏆": {
          type: "svg",
          value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4h8v2a4 4 0 0 1-8 0V4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 5H4.5A1.5 1.5 0 0 0 3 6.5C3 8.99 5.01 11 7.5 11H8m8-6h1.5A1.5 1.5 0 0 1 19 6.5C19 8.99 16.99 11 14.5 11H14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 10v4m-3 6h6m-5-3h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
        },
        "✨": { type: "text", value: "✦" },
        "💖": { type: "text", value: "♥" },
        "🎯": { type: "text", value: "◎" },
        "🌱": { type: "text", value: "⌁" },
        "🔮": { type: "text", value: "◌" },
        "🧠": { type: "text", value: "◉" }
      };
      const createFallbackSpan = (entry) => {
        const span = document.createElement("span");
        span.style.display = "inline-flex";
        span.style.alignItems = "center";
        span.style.justifyContent = "center";
        span.style.width = "1em";
        span.style.height = "1em";
        span.style.verticalAlign = "-0.12em";
        span.style.color = "currentColor";
        span.style.lineHeight = "1";
        span.style.whiteSpace = "nowrap";
        if (entry.type === "svg") {
          span.innerHTML = entry.value;
          const svg = span.querySelector("svg");
          if (svg) {
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.display = "block";
          }
        } else {
          span.textContent = entry.value;
        }
        return span;
      };
      const applyEmojiFallbacks = (root) => {
        const emojiPattern = /🎨|📖|🗣️|🔍|🏆|✨|💖|🎯|🌱|🔮|🧠/g;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || parent.closest("script, style, textarea, svg")) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let replacedCount = 0;
        for (const node of nodes) {
          const text = node.nodeValue;
          if (!text) continue;
          emojiPattern.lastIndex = 0;
          if (!emojiPattern.test(text)) continue;
          emojiPattern.lastIndex = 0;
          const frag = document.createDocumentFragment();
          let cursor = 0;
          for (const match of text.matchAll(emojiPattern)) {
            const symbol = match[0];
            const index = match.index ?? 0;
            if (index > cursor) {
              frag.appendChild(document.createTextNode(text.slice(cursor, index)));
            }
            frag.appendChild(createFallbackSpan(emojiFallbackMap[symbol]));
            replacedCount += 1;
            cursor = index + symbol.length;
          }
          if (cursor < text.length) {
            frag.appendChild(document.createTextNode(text.slice(cursor)));
          }
          node.replaceWith(frag);
        }
        console.log("Scryer preserve emoji fallbacks replaced:", replacedCount);
      };
      const root = document.createElement("div");
      root.id = "__scryer_preserve_capture_root__";
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.top = "0";
      root.style.width = `${width}px`;
      root.style.height = `${height}px`;
      root.style.overflow = "hidden";
      root.style.background = background;
      root.style.zIndex = "2147483647";
      root.style.isolation = "isolate";

      const clone = el.cloneNode(true);
      clone.removeAttribute("id");
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.minWidth = `${width}px`;
      clone.style.minHeight = `${height}px`;
      clone.style.maxWidth = `${width}px`;
      clone.style.maxHeight = `${height}px`;
      clone.style.margin = "0";
      clone.style.position = "relative";
      clone.style.left = "auto";
      clone.style.top = "auto";
      clone.style.right = "auto";
      clone.style.bottom = "auto";
      clone.style.overflow = "hidden";
      clone.style.boxSizing = "border-box";
      clone.style.flex = "0 0 auto";

      if (clone.style.transform && clone.style.transform !== "none") {
        clone.style.transform = "none";
      }

      const cloneStyle = window.getComputedStyle(el);
      const hasOwnBg = cloneStyle.backgroundImage !== "none" ||
        (cloneStyle.backgroundColor && cloneStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && cloneStyle.backgroundColor !== "transparent");
      if (!hasOwnBg) clone.style.background = background;

      applyEmojiFallbacks(clone);
      root.appendChild(clone);
      document.body.appendChild(root);
      return true;
    }, {
      selector,
      index,
      width: payload.width,
      height: payload.height
    });
    if (!prepared) {
      throw new Error(`Could not measure slide ${index + 1}.`);
    }
    await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: { x: 0, y: 0, width: payload.width, height: payload.height },
      omitBackground: false
    });
    await page.evaluate(() => {
      document.getElementById("__scryer_preserve_capture_root__")?.remove();
    }).catch(() => {});
    files.push(outputPath);
  }
  return files;
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
    let files;
    if (!payload.preserveLayout) {
      await installExportRuntime(page, payload);
      await waitForAssets(page);
      files = await captureTargets(page, payload, tempDir);
    } else if (payload.mode === "full") {
      files = await captureTargets(page, payload, tempDir);
    } else {
      files = await captureElementsPreserveLayout(page, payload.selector, tempDir, payload);
    }
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
