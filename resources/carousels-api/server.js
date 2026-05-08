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
const EXPORT_CONTROL_SELECTOR = ".nav-controls, .export-hide, button[onclick*='Slide'], button[onclick*='prevSlide'], button[onclick*='nextSlide'], [onclick*='moveSlide'], .btn-prev, .btn-next, .btn-nav";

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
      min-width: ${payload.width}px !important;
      min-height: ${payload.height}px !important;
      max-width: ${payload.width}px !important;
      max-height: ${payload.height}px !important;
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
      "🔮": "●",
      "✨": "✦",
      "💖": "♥",
      "🎯": "◎",
      "🧠": "◉",
      "🪴": "♣",
      "🌱": "⌁",
      "💚": "♥",
      "🍀": "✤",
      "🌳": "♣",
      "🌻": "✺",
      "🌞": "☀",
      "🪷": "✿",
      "🌼": "✼",
      "🌿": "❧",
      "⚡": "ϟ",
      "🪄": "✦",
      "📚": "▤",
      "🤝": "◇",
      "🗳️": "▣",
      "🏘️": "⌂"
    };

    window.__scryerLogEmoji = function(message, detail) {
      if (typeof detail === "undefined") console.warn(message);
      else console.warn(message, detail);
    };

    window.__scryerEmojiPattern = new RegExp(
      Object.keys(window.__scryerEmojiFallbackMap)
        .sort((a, b) => b.length - a.length)
        .map((emoji) => emoji.replace(/[|\\\\{}()\\[\\]^$+*?.]/g, "\\\\$&"))
        .join("|"),
      "gu"
    );

    window.__scryerCreateEmojiFallbackSpan = function(symbol) {
      const span = document.createElement("span");
      span.className = "scryer-emoji-fallback";
      span.dataset.scryerEmojiFallback = "true";
      span.textContent = (window.__scryerEmojiFallbackMap || {})[symbol] || symbol;
      span.style.display = "inline-block";
      span.style.fontFamily = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif';
      span.style.fontWeight = "700";
      span.style.lineHeight = "1";
      span.style.verticalAlign = "-0.08em";
      span.style.color = "currentColor";
      span.style.textShadow = "0 0 10px rgba(212,255,0,0.35)";
      return span;
    };

    window.__scryerWrapEmojiTextNodes = function(root) {
      return root;
    };

    window.__scryerApplyEmojiFallbacks = function(root) {
      if (!root) return false;
      const emojiPattern = window.__scryerEmojiPattern;
      if (!emojiPattern) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          emojiPattern.lastIndex = 0;
          if (!emojiPattern.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          emojiPattern.lastIndex = 0;
          if (!parent || parent.closest("script, style, textarea, svg, .scryer-emoji-fallback")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      if (!nodes.length) return false;

      for (const node of nodes) {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        emojiPattern.lastIndex = 0;

        for (const match of text.matchAll(emojiPattern)) {
          const index = match.index || 0;
          const symbol = match[0];
          if (index > cursor) {
            frag.appendChild(document.createTextNode(text.slice(cursor, index)));
          }
          frag.appendChild(window.__scryerCreateEmojiFallbackSpan(symbol));
          cursor = index + symbol.length;
        }

        if (cursor < text.length) {
          frag.appendChild(document.createTextNode(text.slice(cursor)));
        }

        node.replaceWith(frag);
      }

      return true;
    };

    window.__scryerParseTwemoji = function(root) {
      if (!root || !window.twemoji) return false;
      const before = root.querySelectorAll("img.scryer-twemoji").length;

      const attachFallback = (images) => {
        images.forEach((img) => {
          if (img.dataset.scryerTwemojiBound === "true") return;
          img.dataset.scryerTwemojiBound = "true";
          img.decoding = "sync";
          img.loading = "eager";
          img.onerror = () => {
            if (img.dataset.scryerTwemojiSource !== "cdn") {
              window.__scryerLogEmoji("[scryer emoji] local Twemoji failed", img.src);
              img.dataset.scryerTwemojiSource = "cdn";
              img.src = img.src.replace(
                "http://localhost:3000/assets/twemoji/",
                "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/"
              );
              return;
            }
            window.__scryerLogEmoji("[scryer emoji] CDN Twemoji failed", img.src);
          };
        });
      };

      try {
        window.twemoji.parse(root, {
          base: "http://localhost:3000/assets/twemoji/",
          folder: "svg",
          ext: ".svg",
          className: "scryer-twemoji"
        });
        root.querySelectorAll('img.scryer-twemoji:not([data-scryer-twemoji-source])').forEach((img) => {
          img.dataset.scryerTwemojiSource = "local";
        });
        attachFallback(Array.from(root.querySelectorAll("img.scryer-twemoji")));
      } catch (_localError) {
        window.__scryerLogEmoji("[scryer emoji] local Twemoji failed");
        try {
          window.twemoji.parse(root, {
            base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/",
            folder: "svg",
            ext: ".svg",
            className: "scryer-twemoji"
          });
          root.querySelectorAll('img.scryer-twemoji:not([data-scryer-twemoji-source])').forEach((img) => {
            img.dataset.scryerTwemojiSource = "cdn";
          });
          attachFallback(Array.from(root.querySelectorAll("img.scryer-twemoji")));
        } catch (_cdnError) {
          window.__scryerLogEmoji("[scryer emoji] CDN Twemoji failed");
          return false;
        }
      }

      const after = root.querySelectorAll("img.scryer-twemoji").length;
      return after > before;
    };

    window.__scryerHideExportControls = function(root) {
      if (!root) return 0;
      const controls = window.__scryerHideControlsForCapture
        ? window.__scryerHideControlsForCapture(root)
        : [];
      if (controls.length) console.warn("[scryer export] hidden nav controls found and removed", controls.length);
      return controls.length;
    };

    window.__scryerAuditExportRoot = function(root) {
      if (!root) return null;
      return {
        twemojiActive: !!window.twemoji,
        twemojiImages: root.querySelectorAll("img.scryer-twemoji").length,
        emojiFallbacks: root.querySelectorAll(".scryer-emoji-fallback").length,
        hiddenControls: root.querySelectorAll(window.__scryerControlSelector || "").length,
        navDots: root.querySelectorAll(".nav-dots").length,
        slideCounter: root.querySelectorAll(".slide-counter").length,
        swipeHints: root.querySelectorAll(".swipe-hint").length
      };
    };

    window.__scryerPrepareEmojiClone = function(root, options) {
      if (!root) return { twemojiApplied: false, fallbackApplied: false };
      window.__scryerHideExportControls(root);
      if (options && options.auditOnly) {
        console.log("[scryer audit]", window.__scryerAuditExportRoot(root));
        return { twemojiApplied: false, fallbackApplied: false };
      }
      if (options && options.emojiFallback === false) {
        return { twemojiApplied: false, fallbackApplied: false };
      }
      const twemojiApplied = window.__scryerParseTwemoji && window.__scryerParseTwemoji(root);
      if (!twemojiApplied) {
        window.__scryerLogEmoji("[scryer emoji] using text fallback");
        window.__scryerWrapEmojiTextNodes && window.__scryerWrapEmojiTextNodes(root);
        const fallbackApplied = window.__scryerApplyEmojiFallbacks && window.__scryerApplyEmojiFallbacks(root);
        return { twemojiApplied: false, fallbackApplied: !!fallbackApplied };
      }
      return { twemojiApplied: true, fallbackApplied: false };
    };

    window.__scryerApplyDeterministicEmojiFallbacks = function(root) {
      const result = window.__scryerPrepareEmojiClone(root, { emojiFallback: true });
      return !!(result && (result.twemojiApplied || result.fallbackApplied));
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
  console.log("HTML Scryer export dimensions", {
    width: payload.width,
    height: payload.height
  });
  await page.evaluate(({ emojiFallback }) => {
    window.__scryerPrepareEmojiClone?.(document.body, { emojiFallback });
  }, {
    emojiFallback: payload.emojiFallback
  }).catch(() => {});
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
    const exportPadding = payload.exportPadding;
    const clipWidth = payload.width + exportPadding * 2;
    const clipHeight = payload.height + exportPadding * 2;
    await page.setViewport({
      width: clipWidth,
      height: clipHeight,
      deviceScaleFactor: 1
    });
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
    const prepareLog = await page.evaluate(({ selector: selectorValue, index: itemIndex, width, height, autoCenter, safePadding, emojiFallback, exportPadding }) => {
      const nodes = selectorValue === "body" ? [document.body] : Array.from(document.querySelectorAll(selectorValue));
      const original = nodes[itemIndex];
      if (!original) throw new Error(`Could not find slide ${itemIndex + 1}`);
      return window.__scryerPrepareClone(original, width, height, { autoCenter, safePadding, emojiFallback, exportPadding, index: itemIndex });
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
    console.log("[scryer export] selector capture prepared", prepareLog);
    if (prepareLog?.auditFailures?.length) {
      throw new Error(`Export audit failed for slide ${index + 1}: ${prepareLog.auditFailures.join(", ")}`);
    }
    await waitForAssets(page);
    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: clipWidth,
        height: clipHeight
      }
    });
    await page.evaluate(() => window.__scryerCleanupCapture && window.__scryerCleanupCapture());
    files.push(outputPath);
  }
  return files;
}

async function installExportRuntime(page, payload) {
  await page.addScriptTag({
    url: "https://cdn.jsdelivr.net/npm/@twemoji/api@15.1.0/dist/twemoji.min.js"
  }).catch(() => {});
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
      img.scryer-twemoji {
        display: inline-block !important;
        width: 1em !important;
        height: 1em !important;
        vertical-align: -0.12em !important;
        margin: 0 0.04em !important;
        filter: drop-shadow(0 0 8px rgba(212, 255, 0, 0.35));
      }
      .scryer-emoji,
      .emoji,
      [data-emoji="true"] {
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif !important;
        font-variant-emoji: emoji;
      }
      .scryer-emoji-fallback {
        display: inline-block !important;
        font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        vertical-align: -0.08em !important;
        color: currentColor !important;
        text-shadow: 0 0 10px rgba(212,255,0,0.35);
      }
      #__scryer_capture_viewport__ {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        background: var(--scryer-bg, #08140E) !important;
        overflow: hidden !important;
        z-index: 2147483647 !important;
        isolation: isolate !important;
      }
      #__scryer_capture_root__,
      #__scryer_preserve_capture_root__,
      #__scryer_capture_viewport__ {
        background: var(--scryer-bg, #08140E) !important;
        overflow: hidden !important;
        isolation: isolate !important;
      }
      #__scryer_capture_viewport__,
      #__scryer_capture_viewport__ * {
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }
      body.__scryer_capturing__ > *:not(#__scryer_capture_root__):not(#__scryer_preserve_capture_root__):not(#__scryer_capture_viewport__) {
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
  await page.evaluate((controlSelector) => {
    window.__scryerControlSelector = window.__scryerControlSelector || controlSelector;
    window.__scryerBeginCaptureState = function() {
      window.__scryerCaptureState = {
        styles: [],
        saved: new WeakSet()
      };
      return window.__scryerCaptureState;
    };
    window.__scryerGetCaptureState = function() {
      return window.__scryerCaptureState || window.__scryerBeginCaptureState();
    };
    window.__scryerRememberStyle = function(el) {
      if (!el) return;
      const state = window.__scryerGetCaptureState();
      if (state.saved.has(el)) return;
      state.saved.add(el);
      state.styles.push([el, el.getAttribute("style")]);
    };
    window.__scryerQueryWithin = function(root, selector) {
      if (!root || !selector) return [];
      if (root.nodeType === Node.DOCUMENT_NODE) {
        return Array.from(root.querySelectorAll(selector));
      }
      if (root.matches && root.matches(selector)) {
        return [root, ...Array.from(root.querySelectorAll(selector))];
      }
      return Array.from(root.querySelectorAll(selector));
    };
    window.__scryerHideControlsForCapture = function(root) {
      const controls = window.__scryerQueryWithin(root, window.__scryerControlSelector);
      controls.forEach((el) => {
        window.__scryerRememberStyle(el);
        el.style.display = "none";
      });
      return controls;
    };
    window.__scryerIsEffectivelyVisible = function(el) {
      if (!el || !(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") <= 0) {
          return false;
        }
        node = node.parentElement;
      }
      return true;
    };
    window.__scryerCountVisibleMatches = function(selector) {
      if (!selector) return 0;
      return Array.from(document.querySelectorAll(selector)).filter((el) => window.__scryerIsEffectivelyVisible(el)).length;
    };
    window.__scryerCountVisibleCaptureRoots = function() {
      return ["__scryer_capture_root__", "__scryer_preserve_capture_root__", "__scryer_capture_viewport__"]
        .map((id) => document.getElementById(id))
        .filter((el) => window.__scryerIsEffectivelyVisible(el)).length;
    };
    window.__scryerOriginalBodyChildrenHidden = function() {
      return Array.from(document.body.children)
        .filter((child) => !["__scryer_capture_root__", "__scryer_preserve_capture_root__", "__scryer_capture_viewport__"].includes(child.id))
        .every((child) => getComputedStyle(child).visibility === "hidden");
    };
    window.__scryerInspectVisualEffects = function(root) {
      const nodes = window.__scryerQueryWithin(root, "*");
      const summary = {
        textShadow: 0,
        filter: 0,
        opacityBelowOne: 0,
        mixBlendMode: 0,
        backdropFilter: 0,
        transform: 0
      };
      nodes.forEach((el) => {
        const style = getComputedStyle(el);
        if (style.textShadow && style.textShadow !== "none") summary.textShadow += 1;
        if (style.filter && style.filter !== "none") summary.filter += 1;
        if (parseFloat(style.opacity || "1") < 1) summary.opacityBelowOne += 1;
        if (style.mixBlendMode && style.mixBlendMode !== "normal") summary.mixBlendMode += 1;
        const backdrop = style.backdropFilter || style.webkitBackdropFilter;
        if (backdrop && backdrop !== "none") summary.backdropFilter += 1;
        if (style.transform && style.transform !== "none") summary.transform += 1;
      });
      return summary;
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
      if (el.closest(".grid-overlay, .mystic-frame, .mystic-corner, .mystic-border, .corner-l, .corner-r, .corner-t, .corner-b, .nav-controls, .export-hide")) return false;
      if (el.matches(".btn-prev, .btn-next, .btn-nav")) return false;
      if ((el.getAttribute("onclick") || "").match(/Slide|prevSlide|nextSlide|moveSlide/)) return false;
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
    window.__scryerExportChromeSelectors = {
      topBar: [
        '[data-export-chrome="top-bar"]',
        '.top-bar',
        '.topbar',
        '.ticker',
        '.ticker-bar',
        '.slide-ticker',
        '.header-bar'
      ],
      footer: [
        '[data-export-chrome="nav-dots"]',
        '[data-export-chrome="slide-counter"]',
        '[data-export-chrome="swipe-hint"]',
        '.nav-dots',
        '[id^="dots"]',
        '[class*="nav-dots"]',
        '.slide-counter',
        '[id^="counter"]',
        '[class*="slide-counter"]',
        '.swipe-hint',
        'footer',
        '.footer',
        '.slide-footer'
      ],
      pinned: [
        '[data-export-pinned]',
        '[data-export-pin]',
        '[data-export-chrome]',
        '.salary-badge',
        '.salary-pill',
        '.salary-chip',
        '.job-salary',
        '[class*="salary-badge"]',
        '[class*="salary-pill"]',
        '[class*="job-salary"]'
      ]
    };
    window.__scryerExportTitleSelectors = [
      '.job-title',
      'h1',
      '.hero-title',
      '.slide-title',
      '[data-export-title]'
    ];
    window.__scryerExportBodySelectors = [
      '.job-description',
      '.slide-body',
      '.body-copy',
      'p',
      '[data-export-body]'
    ];
    window.__scryerExportComplexSelectors = [
      'table',
      'canvas',
      'video',
      'iframe',
      'svg[data-chart]',
      '.dashboard',
      '.dashboard-grid',
      '.analytics',
      '.timeline',
      '.timeline-track',
      '.grid-layout',
      '.grid',
      '.card-grid',
      '.cards',
      '.multi-card',
      '.metrics',
      '.stats-grid',
      '.comparison-grid',
      '.visual-composition',
      '[data-export-preserve-layout]'
    ];
    window.__scryerRelativeRect = function(el, rootRect) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        right: rect.right - rootRect.left,
        bottom: rect.bottom - rootRect.top,
        width: rect.width,
        height: rect.height
      };
    };
    window.__scryerUnionRects = function(rects) {
      const valid = rects.filter((rect) => rect && rect.width > 1 && rect.height > 1);
      if (!valid.length) return null;
      const left = Math.min(...valid.map((rect) => rect.left));
      const top = Math.min(...valid.map((rect) => rect.top));
      const right = Math.max(...valid.map((rect) => rect.right));
      const bottom = Math.max(...valid.map((rect) => rect.bottom));
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      };
    };
    window.__scryerNormalizeTextAlign = function(value) {
      if (!value) return "left";
      const normalized = String(value).toLowerCase();
      if (normalized === "center") return "center";
      if (normalized === "right" || normalized === "end") return "right";
      return "left";
    };
    window.__scryerScaleOriginForAlign = function(align) {
      if (align === "center") return "center top";
      if (align === "right") return "right top";
      return "left top";
    };
    window.__scryerUniqueElements = function(elements) {
      const seen = new Set();
      return elements.filter((el) => {
        if (!el || seen.has(el)) return false;
        seen.add(el);
        return true;
      });
    };
    window.__scryerCompareDocumentOrder = function(a, b) {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    };
    window.__scryerCollectChromeNodes = function(slide) {
      const selector = [
        ...window.__scryerExportChromeSelectors.topBar,
        ...window.__scryerExportChromeSelectors.footer,
        ...window.__scryerExportChromeSelectors.pinned
      ].join(", ");
      return window.__scryerUniqueElements(Array.from(slide.querySelectorAll(selector)));
    };
    window.__scryerIsPinnedChromeNode = function(node, slide) {
      if (!node || !(node instanceof Element)) return false;
      if (!slide || !slide.contains(node)) return false;
      const selector = [
        ...window.__scryerExportChromeSelectors.topBar,
        ...window.__scryerExportChromeSelectors.footer,
        ...window.__scryerExportChromeSelectors.pinned
      ].join(", ");
      return !!node.closest(selector);
    };
    window.__scryerFindFirstMatching = function(slide, selectors) {
      for (const selector of selectors) {
        const match = slide.querySelector(selector);
        if (match && !window.__scryerIsPinnedChromeNode(match, slide)) return match;
      }
      return null;
    };
    window.__scryerCollectBodyNodes = function(slide, titleNode) {
      const bodyNodes = [];
      for (const selector of window.__scryerExportBodySelectors) {
        slide.querySelectorAll(selector).forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node === titleNode || node.contains(titleNode) || titleNode?.contains(node)) return;
          if (window.__scryerIsPinnedChromeNode(node, slide)) return;
          if (window.__scryerIsMeaningful(node, slide)) bodyNodes.push(node);
        });
      }
      const ordered = window.__scryerUniqueElements(bodyNodes).sort(window.__scryerCompareDocumentOrder);
      if (ordered.length) return ordered;

      const fallback = [];
      slide.querySelectorAll("*").forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node === titleNode || node.contains(titleNode) || titleNode?.contains(node)) return;
        if (window.__scryerIsPinnedChromeNode(node, slide)) return;
        if (!window.__scryerIsMeaningful(node, slide)) return;
        const text = (node.innerText || node.textContent || "").trim();
        if (!text) return;
        if (node.children.length && Array.from(node.children).some((child) => (child.innerText || child.textContent || "").trim())) return;
        fallback.push(node);
      });
      return window.__scryerUniqueElements(fallback).sort(window.__scryerCompareDocumentOrder);
    };
    window.__scryerDetectTextSlideType = function(slide) {
      const title = window.__scryerFindFirstMatching(slide, window.__scryerExportTitleSelectors);
      const bodyNodes = window.__scryerCollectBodyNodes(slide, title);
      const chromeNodes = window.__scryerCollectChromeNodes(slide);
      const chromeSet = new Set(chromeNodes);
      const meaningfulNodes = Array.from(slide.querySelectorAll("*")).filter((node) => {
        if (!(node instanceof Element)) return false;
        if (chromeSet.has(node)) return false;
        if (window.__scryerIsPinnedChromeNode(node, slide)) return false;
        return window.__scryerIsMeaningful(node, slide);
      });
      const complexSelector = window.__scryerExportComplexSelectors.join(", ");
      const hasComplexSelector = !!slide.querySelector(complexSelector);
      const mediaNodes = meaningfulNodes.filter((node) => ["IMG", "CANVAS", "VIDEO", "SVG"].includes(node.tagName));
      const largeVisualNodes = meaningfulNodes.filter((node) => {
        const text = (node.innerText || node.textContent || "").trim();
        const isVisualTag = ["IMG", "CANVAS", "VIDEO", "SVG"].includes(node.tagName);
        const looksVisual = isVisualTag || node.matches(".chart, .graph, .diagram, .visual, .timeline, .network, .constellation, .panel, .card, .stat");
        if (!looksVisual && text) return false;
        const rect = node.getBoundingClientRect();
        return rect.width * rect.height > (slide.getBoundingClientRect().width * slide.getBoundingClientRect().height * 0.12);
      });
      const longNestedBlocks = meaningfulNodes.filter((node) => node.children.length >= 3).length;
      const textLength = meaningfulNodes.reduce((sum, node) => sum + ((node.innerText || node.textContent || "").trim().length), 0);
      const bodyTextLength = bodyNodes.reduce((sum, node) => sum + ((node.innerText || node.textContent || "").trim().length), 0);
      const hasTitle = !!title;
      const hasBody = bodyNodes.length > 0;
      const reason = [];
      let simple = true;
      if (!hasTitle || !hasBody) {
        simple = false;
        reason.push("missing-title-or-body");
      }
      if (hasComplexSelector) {
        simple = false;
        reason.push("complex-selector");
      }
      if (mediaNodes.length > 2 || largeVisualNodes.length > 2) {
        simple = false;
        reason.push("heavy-visual-composition");
      }
      if (meaningfulNodes.length > 12 || longNestedBlocks > 5) {
        simple = false;
        reason.push("too-many-meaningful-blocks");
      }
      if (bodyNodes.length > 6 || textLength < 20 || bodyTextLength < 20) {
        simple = false;
        reason.push("insufficient-simple-text-shape");
      }
      return {
        simple,
        title,
        bodyNodes,
        chromeNodes,
        meaningfulCount: meaningfulNodes.length,
        mediaCount: mediaNodes.length,
        largeVisualCount: largeVisualNodes.length,
        bodyCount: bodyNodes.length,
        reason: simple ? ["simple-text-slide"] : reason
      };
    };
    window.__scryerMeasureNodeUnion = function(node, rootRect) {
      if (!node) return null;
      const elements = [node, ...Array.from(node.querySelectorAll("*"))];
      return window.__scryerUnionRects(elements.map((el) => window.__scryerRelativeRect(el, rootRect)));
    };
    window.__scryerMeasureGroup = function(group, rootRect) {
      if (!group || !group.shell || !group.inner) return null;
      const rect = window.__scryerMeasureNodeUnion(group.inner, rootRect);
      if (!rect) {
        return {
          width: 0,
          height: 0,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0
        };
      }
      return rect;
    };
    window.__scryerApplyScaledGroup = function(group, scale, metrics) {
      group.scale = Math.max(0.35, Math.min(scale || 1, 1));
      group.inner.style.transformOrigin = window.__scryerScaleOriginForAlign(group.align);
      group.inner.style.transform = `scale(${group.scale})`;
      group.shell.style.height = `${Math.max(metrics.height * group.scale, 1)}px`;
    };
    window.__scryerCreateGroupShell = function(doc, role, align, maxWidth) {
      const shell = doc.createElement("div");
      shell.dataset.scryerReflowRole = role;
      shell.style.position = "relative";
      shell.style.width = "100%";
      shell.style.maxWidth = `${maxWidth}px`;
      shell.style.overflow = "visible";
      shell.style.textAlign = align;
      const inner = doc.createElement("div");
      inner.dataset.scryerReflowInner = role;
      inner.style.position = "relative";
      inner.style.width = "100%";
      inner.style.maxWidth = `${maxWidth}px`;
      inner.style.margin = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";
      inner.style.transformOrigin = window.__scryerScaleOriginForAlign(align);
      shell.appendChild(inner);
      return { shell, inner, align, scale: 1 };
    };
    window.__scryerAuditExportSlide = function(slide, audit) {
      const failures = [];
      const slideRect = slide.getBoundingClientRect();
      const topBars = slide.querySelectorAll('[data-export-chrome="top-bar"], .top-bar, .topbar, .ticker, .ticker-bar, .slide-ticker, .header-bar').length;
      const navDots = slide.querySelectorAll('[data-export-chrome="nav-dots"], .nav-dots, [id^="dots"], [class*="nav-dots"]').length;
      const counters = slide.querySelectorAll('[data-export-chrome="slide-counter"], .slide-counter, [id^="counter"], [class*="slide-counter"]').length;
      if (topBars > 1) failures.push(`duplicate-top-bars:${topBars}`);
      if (navDots > 1) failures.push(`duplicate-nav-dots:${navDots}`);
      if (counters > 1) failures.push(`duplicate-counters:${counters}`);
      if (audit.reflowApplied && audit.classification !== "simple") {
        failures.push("preserved-layout-accidentally-reflowed");
      }
      if (audit.reflowApplied && audit.clusterRect) {
        const safe = audit.safeZone;
        if (audit.clusterRect.top < safe.top - 1 || audit.clusterRect.bottom > safe.bottom + 1) {
          failures.push("content-cluster-outside-safe-zone");
        }
        if (audit.clusterRect.left < safe.left - 1 || audit.clusterRect.right > safe.right + 1) {
          failures.push("content-cluster-outside-safe-width");
        }
        if (audit.chromeBounds?.top && audit.clusterRect.top < audit.chromeBounds.top.bottom - 1) {
          failures.push("content-cluster-overlaps-top-chrome");
        }
        if (audit.chromeBounds?.bottom && audit.clusterRect.bottom > audit.chromeBounds.bottom.top + 1) {
          failures.push("content-cluster-overlaps-footer-nav");
        }
        if (audit.titleRect && (audit.titleRect.top < 0 || audit.titleRect.bottom > slideRect.height)) {
          failures.push("title-content-clipped");
        }
        if (audit.bodyRect && (audit.bodyRect.top < 0 || audit.bodyRect.bottom > slideRect.height)) {
          failures.push("body-content-clipped");
        }
      }
      return failures;
    };
    window.__scryerApplyContentAwareReflow = function(slide, inner, metrics) {
      const analysis = window.__scryerDetectTextSlideType(slide);
      const audit = {
        classification: analysis.simple ? "simple" : "preserved",
        reason: analysis.reason.join(","),
        reflowApplied: false,
        clusterRect: null,
        titleRect: null,
        bodyRect: null,
        chromeBounds: null,
        safeZone: {
          left: metrics.safePadding,
          right: metrics.width - metrics.safePadding,
          top: metrics.safePadding,
          bottom: metrics.height - metrics.safePadding
        }
      };
      if (!analysis.simple) {
        audit.failures = window.__scryerAuditExportSlide(slide, audit);
        return audit;
      }

      const slideRect = slide.getBoundingClientRect();
      const chromeRects = analysis.chromeNodes.map((node) => window.__scryerRelativeRect(node, slideRect)).filter(Boolean);
      const topChromeRects = chromeRects.filter((rect) => rect.top < metrics.height * 0.35);
      const bottomChromeRects = chromeRects.filter((rect) => rect.bottom > metrics.height * 0.6);
      const topChromeBounds = window.__scryerUnionRects(topChromeRects);
      const bottomChromeBounds = window.__scryerUnionRects(bottomChromeRects);
      const safeTop = Math.max(metrics.safePadding, topChromeBounds ? topChromeBounds.bottom + 28 : metrics.safePadding);
      const safeBottom = Math.min(metrics.height - metrics.safePadding, bottomChromeBounds ? bottomChromeBounds.top - 28 : metrics.height - metrics.safePadding);
      const safeLeft = metrics.safePadding;
      const safeRight = metrics.width - metrics.safePadding;
      const safeWidth = Math.max(safeRight - safeLeft, 1);
      const safeHeight = Math.max(safeBottom - safeTop, 1);
      audit.chromeBounds = {
        top: topChromeBounds,
        bottom: bottomChromeBounds
      };
      audit.safeZone = {
        left: safeLeft,
        right: safeRight,
        top: safeTop,
        bottom: safeBottom
      };

      const titleAlign = window.__scryerNormalizeTextAlign(getComputedStyle(analysis.title).textAlign);
      const bodyAlign = window.__scryerNormalizeTextAlign(getComputedStyle(analysis.bodyNodes[0]).textAlign || titleAlign);
      const clusterAlign = titleAlign === bodyAlign ? titleAlign : titleAlign;
      const cluster = document.createElement("div");
      cluster.id = "__scryer_reflow_cluster__";
      cluster.dataset.scryerExportMode = "content-aware-reflow";
      cluster.style.position = "absolute";
      cluster.style.left = `${safeLeft}px`;
      cluster.style.width = `${safeWidth}px`;
      cluster.style.maxWidth = `${safeWidth}px`;
      cluster.style.display = "flex";
      cluster.style.flexDirection = "column";
      cluster.style.gap = `${Math.max(Math.round(metrics.height * 0.022), 18)}px`;
      cluster.style.zIndex = "50";
      cluster.style.pointerEvents = "none";
      cluster.style.textAlign = clusterAlign;

      const titleGroup = window.__scryerCreateGroupShell(document, "title", titleAlign, safeWidth);
      const bodyGroup = window.__scryerCreateGroupShell(document, "body", bodyAlign, safeWidth);
      cluster.appendChild(titleGroup.shell);
      cluster.appendChild(bodyGroup.shell);
      inner.appendChild(cluster);

      titleGroup.inner.appendChild(analysis.title);
      analysis.bodyNodes.forEach((node) => bodyGroup.inner.appendChild(node));

      const titleMetrics = window.__scryerMeasureGroup(titleGroup, slideRect);
      const bodyMetrics = window.__scryerMeasureGroup(bodyGroup, slideRect);
      const widthScaleTitle = titleMetrics.width > 0 ? Math.min(1, safeWidth / titleMetrics.width) : 1;
      const widthScaleBody = bodyMetrics.width > 0 ? Math.min(1, safeWidth / bodyMetrics.width) : 1;
      let titleScale = widthScaleTitle;
      let bodyScale = widthScaleBody;
      const gap = Math.max(Math.round(metrics.height * 0.022), 18);
      let clusterHeight = titleMetrics.height * titleScale + bodyMetrics.height * bodyScale + gap;
      if (clusterHeight > safeHeight && bodyMetrics.height > 0) {
        const remaining = Math.max(safeHeight - titleMetrics.height * titleScale - gap, safeHeight * 0.24);
        bodyScale = Math.min(bodyScale, remaining / bodyMetrics.height);
      }
      clusterHeight = titleMetrics.height * titleScale + bodyMetrics.height * bodyScale + gap;
      if (clusterHeight > safeHeight && titleMetrics.height > 0) {
        const remaining = Math.max(safeHeight - bodyMetrics.height * bodyScale - gap, safeHeight * 0.22);
        titleScale = Math.min(titleScale, remaining / titleMetrics.height);
      }
      clusterHeight = titleMetrics.height * titleScale + bodyMetrics.height * bodyScale + gap;
      if (clusterHeight > safeHeight) {
        const ratio = safeHeight / Math.max(clusterHeight, 1);
        titleScale *= ratio;
        bodyScale *= ratio;
      }

      window.__scryerApplyScaledGroup(titleGroup, titleScale, titleMetrics);
      window.__scryerApplyScaledGroup(bodyGroup, bodyScale, bodyMetrics);

      const measuredCluster = window.__scryerMeasureNodeUnion(cluster, slideRect);
      const finalClusterHeight = measuredCluster?.height || Math.max(
        titleMetrics.height * titleGroup.scale + bodyMetrics.height * bodyGroup.scale + gap,
        1
      );
      const focusCenter = metrics.height * 0.485;
      const desiredTop = focusCenter - finalClusterHeight / 2;
      const clampedTop = Math.min(Math.max(desiredTop, safeTop), Math.max(safeTop, safeBottom - finalClusterHeight));
      cluster.style.top = `${clampedTop}px`;
      cluster.style.justifyItems = clusterAlign;

      audit.reflowApplied = true;
      audit.titleRect = window.__scryerMeasureNodeUnion(titleGroup.shell, slideRect);
      audit.bodyRect = window.__scryerMeasureNodeUnion(bodyGroup.shell, slideRect);
      audit.clusterRect = window.__scryerMeasureNodeUnion(cluster, slideRect);
      audit.titleScale = Number(titleGroup.scale.toFixed(4));
      audit.bodyScale = Number(bodyGroup.scale.toFixed(4));
      audit.align = clusterAlign;
      audit.failures = window.__scryerAuditExportSlide(slide, audit);
      return audit;
    };
    window.__scryerPrepareClone = function(original, width, height, options) {
      window.__scryerBeginCaptureState();
      document.getElementById("__scryer_capture_viewport__")?.remove();
      const bg = window.__scryerResolveBackground(original);
      const slideIndex = Number.isInteger(options.index) ? options.index : 0;
      const exportPadding = Number.isFinite(options.exportPadding) ? Math.max(0, options.exportPadding) : 0;
      const canvasWidth = width + exportPadding * 2;
      const canvasHeight = height + exportPadding * 2;
      const viewport = document.createElement("div");
      viewport.id = "__scryer_capture_viewport__";
      viewport.style.setProperty("--scryer-bg", bg);
      viewport.style.width = `${canvasWidth}px`;
      viewport.style.height = `${canvasHeight}px`;
      viewport.style.background = bg;
      viewport.style.overflow = "hidden";
      const stage = document.createElement("div");
      stage.id = "__scryer_capture_stage__";
      stage.style.setProperty("--scryer-bg", bg);
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
      window.__scryerHideControlsForCapture(document);
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
      window.__scryerPrepareEmojiClone?.(clone, { emojiFallback: options.emojiFallback !== false });
      window.__scryerHideControlsForCapture(clone);
      if (exportPadding > 0) {
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
      const safePadding = Number.isFinite(options.safePadding)
        ? options.safePadding
        : Math.min(Math.round(Math.min(width, height) * 0.09), height >= 1800 ? 120 : height > width ? 96 : 72);
      const reflowAudit = window.__scryerApplyContentAwareReflow(clone, inner, {
        width,
        height,
        safePadding
      });
      if (!reflowAudit.reflowApplied && options.autoCenter !== false) {
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
      return {
        background: bg,
        mode: reflowAudit.reflowApplied ? "reflowed" : "preserved",
        classification: reflowAudit.classification,
        reason: reflowAudit.reason,
        titleScale: reflowAudit.titleScale || null,
        bodyScale: reflowAudit.bodyScale || null,
        align: reflowAudit.align || null,
        safeZone: reflowAudit.safeZone,
        auditFailures: reflowAudit.failures || []
      };
    };
    window.__scryerCleanupCapture = function() {
      document.getElementById("__scryer_capture_root__")?.remove();
      document.getElementById("__scryer_preserve_capture_root__")?.remove();
      document.getElementById("__scryer_capture_viewport__")?.remove();
      document.body.classList.remove("__scryer_capturing__");
      const state = window.__scryerCaptureState;
      if (state && state.styles) {
        for (const [el, style] of state.styles.reverse()) {
          if (!el) continue;
          if (style === null) el.removeAttribute("style");
          else el.setAttribute("style", style);
        }
      }
      delete window.__scryerCaptureState;
    };
  }, EXPORT_CONTROL_SELECTOR);
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
  const prepared = await page.evaluate(({ selector, index, width, height, autoCenter, safePadding, emojiFallback, exportPadding }) => {
    const nodes = selector === "body" ? [document.body] : Array.from(document.querySelectorAll(selector));
    const original = nodes[index];
    if (!original) throw new Error(`No capture target found for ${selector} at index ${index}.`);
    return window.__scryerPrepareClone(original, width, height, { autoCenter, safePadding, emojiFallback, exportPadding, index });
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
  console.log("[scryer export] clone capture prepared", {
    slide: index + 1,
    selector,
    mode: prepared?.mode || "unknown",
    classification: prepared?.classification || "unknown",
    reason: prepared?.reason || "unknown",
    titleScale: prepared?.titleScale,
    bodyScale: prepared?.bodyScale,
    align: prepared?.align,
    safeZone: prepared?.safeZone,
    auditFailures: prepared?.auditFailures || []
  });
  if (prepared?.auditFailures?.length) {
    throw new Error(`Export audit failed for slide ${index + 1}: ${prepared.auditFailures.join(", ")}`);
  }
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
    const prepared = await page.evaluate(({ selector: selectorValue, index: itemIndex, width, height, emojiFallback }) => {
      const el = document.querySelectorAll(selectorValue)[itemIndex];
      if (!el) return null;
      window.__scryerBeginCaptureState?.();

      document.getElementById("__scryer_preserve_capture_root__")?.remove();

      el.scrollIntoView({ block: "start", inline: "start" });
      const background = window.__scryerResolveBackground ? window.__scryerResolveBackground(el) : "#ffffff";
      window.__scryerHideControlsForCapture?.(document);
      const root = document.createElement("div");
      root.id = "__scryer_preserve_capture_root__";
      root.style.setProperty("--scryer-bg", background);
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

      const emojiState = window.__scryerPrepareEmojiClone?.(clone, { emojiFallback }) || {
        twemojiApplied: false,
        fallbackApplied: false
      };
      window.__scryerHideControlsForCapture?.(clone);
      root.appendChild(clone);
      document.body.appendChild(root);
      document.body.classList.add("__scryer_capturing__");
      const visibleSlidesSelector = el.matches(".slide") ? ".slide" : selectorValue;
      return {
        index: itemIndex,
        selector: selectorValue,
        backgroundResolved: background,
        twemojiApplied: !!emojiState.twemojiApplied,
        textFallbackApplied: !!emojiState.fallbackApplied,
        originalBodyChildrenHidden: window.__scryerOriginalBodyChildrenHidden ? window.__scryerOriginalBodyChildrenHidden() : false,
        visibleCaptureRootsBeforeScreenshot: window.__scryerCountVisibleCaptureRoots ? window.__scryerCountVisibleCaptureRoots() : 0,
        visibleMatchingSlidesBeforeScreenshot: window.__scryerCountVisibleMatches ? window.__scryerCountVisibleMatches(visibleSlidesSelector) : 0,
        visualEffects: window.__scryerInspectVisualEffects ? window.__scryerInspectVisualEffects(clone) : null
      };
    }, {
      selector,
      index,
      width: payload.width,
      height: payload.height,
      emojiFallback: payload.emojiFallback
    });
    if (!prepared) {
      throw new Error(`Could not measure slide ${index + 1}.`);
    }
    console.log("[scryer export] preserveLayout capture prepared", prepared);
    await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: { x: 0, y: 0, width: payload.width, height: payload.height },
      omitBackground: false
    });
    await page.evaluate(() => window.__scryerCleanupCapture && window.__scryerCleanupCapture()).catch(() => {});
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
    await installExportRuntime(page, payload);

    const files = [];
    if (payload.mode === "full") {
      const outputPath = path.join(tempDir, `${payload.codexName}.png`);
      await captureFullPage(page, outputPath, payload);
      files.push(outputPath);
    } else if (payload.preserveLayout === true) {
      console.log("[scryer export] using preserveLayout capture path");
      const captured = await captureElementsPreserveLayout(page, payload.selector, tempDir, payload);
      files.push(...captured);
    } else {
      console.log("[scryer export] using clone capture path");
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
