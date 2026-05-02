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

function buildServerCaptureDocument(payload) {
  const sizingStyle = `
  <style id="scryer-page-size-fix">
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      overflow: hidden !important;
    }

    .poster-container,
    .slide,
    .page {
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      min-width: ${payload.width}px !important;
      min-height: ${payload.height}px !important;
      max-width: ${payload.width}px !important;
      max-height: ${payload.height}px !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
    }
  </style>
`;
  const alreadyFullDoc = /<html[\s>]/i.test(payload.html);
  if (alreadyFullDoc) {
    if (/<\/head>/i.test(payload.html)) {
      return payload.html.replace(/<\/head>/i, `${sizingStyle}</head>`);
    }
    return payload.html.replace(/<body/i, `<head>${sizingStyle}</head><body`);
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${payload.width}, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web/src/bold/style.css">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web/src/duotone/style.css">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web/src/regular/style.css">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web/src/fill/style.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700;900&family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&family=DM+Serif+Display:ital@0;1&family=Cormorant+Garamond:wght@400;500;600;700&family=Noto+Color+Emoji&display=swap');
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${payload.width}px !important;
      height: ${payload.height}px !important;
      overflow: hidden !important;
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      caret-color: transparent !important;
    }
    body, .slide, .page {
      font-family: "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif;
    }
    .ph,
    [class^="ph-"],
    [class*=" ph-"],
    i[class*="ph"] {
      font-family: "Phosphor" !important;
      visibility: visible !important;
    }
    .emoji,
    [data-emoji="true"],
    .scryer-emoji,
    .scryer-emoji-fallback {
      font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
    }
    .scryer-emoji,
    .emoji,
    [data-emoji="true"] {
      font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
      font-variant-emoji: emoji;
    }
    .slide,
    .page {
      width: ${payload.width}px;
      height: ${payload.height}px;
      overflow: hidden;
    }
  </style>
</head>
<body>${payload.html}</body>
</html>`;
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

function getEmojiFallbackMapScript() {
  return `
    window.__scryerEmojiFallbackMap = {
      "✨": { type: "text", value: "✦" },
      "💖": { type: "text", value: "♥" },
      "🎯": { type: "text", value: "◎" },
      "🧠": { type: "text", value: "◉" },
      "🌱": {
        type: "svg",
        value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20c0-4.6 1.2-8.1 3.58-10.52C17.35 7.7 19.85 6.5 23 6.5c0 3.16-1.2 5.66-2.98 7.42C17.6 16.3 14.1 17.5 9.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20c0-3.7-.92-6.55-2.77-8.52C7.38 9.53 4.82 8.5 1 8.5c0 3.17 1.03 5.73 2.98 7.58C5.95 18.03 8.8 19 12.5 19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 21V11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      },
      "🔮": {
        type: "svg",
        value: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="9.5" r="5.5" stroke="currentColor" stroke-width="1.7"/><path d="M9 15.2h6l1.7 4.3H7.3L9 15.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 20h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.2 7.5c.7-1.2 1.7-1.9 3-2.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".65"/></svg>'
      }
    };

    window.__scryerCreateEmojiFallbackSpan = function(entry) {
      const span = document.createElement("span");
      span.className = "scryer-emoji-fallback";
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

    window.__scryerApplyDeterministicEmojiFallbacks = function(root) {
      const map = window.__scryerEmojiFallbackMap || {};
      const emojiPattern = /✨|💖|🎯|🧠|🌱|🔮/g;
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

      for (const node of nodes) {
        const text = node.nodeValue;
        emojiPattern.lastIndex = 0;
        if (!emojiPattern.test(text)) continue;
        emojiPattern.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let cursor = 0;

        for (const match of text.matchAll(emojiPattern)) {
          const symbol = match[0];
          const i = match.index || 0;
          if (i > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, i)));
          frag.appendChild(window.__scryerCreateEmojiFallbackSpan(map[symbol]));
          cursor = i + symbol.length;
        }

        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        node.replaceWith(frag);
      }
    };
  `;
}

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
    }

    body, .slide, .page {
      font-family: "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif;
    }

    .ph,
    [class^="ph-"],
    [class*=" ph-"],
    i[class*="ph"] {
      font-family: "Phosphor" !important;
    }

    .emoji,
    [data-emoji="true"],
    .scryer-emoji,
    .scryer-emoji-fallback {
      font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
    }

    .scryer-emoji,
    .emoji,
    [data-emoji="true"] {
      font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
      font-variant-emoji: emoji;
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
  await page.addScriptTag({
    content: getEmojiFallbackMapScript()
  }).catch(() => {});
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
      const hasVisibleBackground = (style) => {
        if (!style) return false;
        const color = style.backgroundColor;
        const image = style.backgroundImage;
        return (image && image !== "none") ||
          (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
      };
      const resolveBackground = (el) => {
        let node = el;
        while (node && node.nodeType === 1) {
          const style = window.getComputedStyle(node);
          if (hasVisibleBackground(style)) return style.background;
          node = node.parentElement;
        }

        const carouselRoot = document.querySelector("#carousel-root");
        if (carouselRoot) {
          const style = window.getComputedStyle(carouselRoot);
          if (hasVisibleBackground(style)) return style.background;
        }

        const bodyStyle = window.getComputedStyle(document.body);
        if (hasVisibleBackground(bodyStyle)) return bodyStyle.background;

        return "#ffffff";
      };
      const background = resolveBackground(original);
      const backgroundImage = window.getComputedStyle(original).backgroundImage || "none";
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
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.minWidth = `${width}px`;
      clone.style.minHeight = `${height}px`;
      clone.style.maxWidth = `${width}px`;
      clone.style.maxHeight = `${height}px`;
      clone.style.flex = "0 0 auto";
      clone.style.margin = "0";
      clone.style.position = "relative";
      clone.style.left = "auto";
      clone.style.right = "auto";
      clone.style.top = "auto";
      clone.style.bottom = "auto";
      clone.style.transform = "none";
      clone.style.boxSizing = "border-box";
      const cloneComputed = window.getComputedStyle(original);
      const cloneHasOwnBackground = hasVisibleBackground(cloneComputed);
      if (!cloneHasOwnBackground) {
        clone.style.background = background;
      }
      window.__scryerApplyDeterministicEmojiFallbacks?.(clone);
      clone.style.zIndex = "1";
      clone.style.flexShrink = "0";
      console.log("HTML Scryer clone forced size", {
        width,
        height,
        originalWidth: getComputedStyle(original).width,
        cloneWidth: clone.style.width
      });
      root.appendChild(clone);
      document.body.appendChild(root);
      const safeWidth = width - safePadding * 2;
      const safeHeight = height - safePadding * 2;
      const graphics = Array.from(clone.querySelectorAll('svg, canvas, img, .chart, .graph, .diagram, .visual, .timeline, .network, .constellation, [data-scryer-scale="graphic"]'));
      graphics.forEach((graphic) => {
        const rect = graphic.getBoundingClientRect();
        const scale = Math.min(1, safeWidth / Math.max(rect.width, 1), safeHeight / Math.max(rect.height, 1));
        if (scale < 1) {
          graphic.style.transformOrigin = "center center";
          const existingTransform = window.getComputedStyle(graphic).transform;
          graphic.style.transform = existingTransform && existingTransform !== "none"
            ? `${existingTransform} scale(${scale})`
            : `scale(${scale})`;
        }
      });
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
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
        display: inline-block;
        line-height: 1;
        vertical-align: -0.08em;
        white-space: nowrap;
      }
      .scryer-emoji,
      .emoji,
      [data-emoji="true"] {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
        font-variant-emoji: emoji;
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
  await page.addScriptTag({
    content: getEmojiFallbackMapScript()
  }).catch(() => {});
  await page.evaluate(() => {
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
      const slideIndex = Number.isInteger(options.index) ? options.index : 0;
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
        const slides = track.querySelectorAll(".slide");
        if (slides.length > 1) {
          slides.forEach((s, i) => {
            if (i !== slideIndex) s.style.display = "none";
          });
        }
        track.style.transform = "none";
        track.style.transition = "none";
        track.style.height = `${height}px`;
      });
      clone.querySelectorAll(".nav-controls, .slide-counter").forEach((el) => {
        el.style.display = "none";
      });
      if (exportPadding > 0) {
        window.__scryerApplyDeterministicEmojiFallbacks?.(clone);
        stage.appendChild(clone);
        viewport.appendChild(stage);
        document.body.appendChild(viewport);
        document.body.classList.add("__scryer_capturing__");
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
      window.__scryerApplyDeterministicEmojiFallbacks?.(clone);
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
    window.__scryerPrepareClone(original, width, height, { autoCenter, safePadding, emojiFallback, exportPadding, index });
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
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.screenshot({
    path: outputPath,
    type: "png",
    clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
    omitBackground: false
  });
  await page.evaluate(() => window.__scryerCleanupCapture && window.__scryerCleanupCapture()).catch(() => {});
}

async function captureElementsPreserveLayout(page, selector, outputDir, payload) {
  await page.addScriptTag({
    content: getEmojiFallbackMapScript()
  }).catch(() => {});
  await page.addStyleTag({
    url: "https://unpkg.com/@phosphor-icons/web/src/bold/style.css"
  }).catch(() => {});
  await page.addStyleTag({
    url: "https://unpkg.com/@phosphor-icons/web/src/duotone/style.css"
  }).catch(() => {});
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

      if (clone.style.transform && clone.style.transform !== "none") {
        clone.style.transform = "none";
      }

      const cloneStyle = window.getComputedStyle(el);
      const hasOwnBg = cloneStyle.backgroundImage !== "none" ||
        (cloneStyle.backgroundColor && cloneStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && cloneStyle.backgroundColor !== "transparent");
      if (!hasOwnBg) clone.style.background = background;

      window.__scryerApplyDeterministicEmojiFallbacks?.(clone);
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
    const captureHtml = buildServerCaptureDocument(payload);
    await page.setContent(captureHtml, {
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
    if (browser) await browser.close().catch(() => undefined);
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error && error.message ? String(error.message) : "Export failed.";
    const status = /required|invalid|must be|No elements matched|could not find|Request body/i.test(message) ? 400 : 500;
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
