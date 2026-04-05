import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const BLOG_DIR = path.dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = path.join(BLOG_DIR, 'posts.json');
const INDEX_PATH = path.join(BLOG_DIR, 'index.html');
const TEMPLATE_PATH = path.join(BLOG_DIR, 'template-post.html');

const POSTS = JSON.parse(await fs.readFile(POSTS_PATH, 'utf8'));
const INDEX_HTML = await fs.readFile(INDEX_PATH, 'utf8');
const TEMPLATE_HTML = await fs.readFile(TEMPLATE_PATH, 'utf8');
const HEAD_JS_SNIPPET = `<script>document.documentElement.classList.add('js');</script>`;
const HEAD_CRITICAL_STYLE = `<style>html, body { background:#030014; margin:0; padding:0; } body { color:#e2e8f0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif; }</style>`;
const HEAD_TAILWIND_PRELOAD = `<link rel="preload" as="style" href="/assets/tailwind.css?v=4" onload="this.onload=null;this.rel='stylesheet'">`;
const HEAD_TAILWIND_NOSCRIPT = `<noscript><link rel="stylesheet" href="/assets/tailwind.css?v=4"></noscript>`;
const HEADER_NAV = extractFirstMatch(INDEX_HTML, /(<nav id="navbar"[\s\S]*?<\/nav>)/);
const INTRO_QUOTE_TEMPLATE = extractFirstMatch(
  TEMPLATE_HTML,
  /(<p class="font-serif-heading text-2xl text-purple-200\/90 leading-relaxed italic mb-12 border-l-4 border-purple-500 pl-6 py-2 bg-gradient-to-r from-purple-900\/20 to-transparent"[^>]*>[\s\S]*?<\/p>)/,
);
const MAIN_QUOTE_TEMPLATE = extractFirstMatch(
  TEMPLATE_HTML,
  /(<blockquote class="my-16 sharp-panel p-8 md:p-10 relative"[\s\S]*?<\/blockquote>)/,
) || `<blockquote class="my-16 sharp-panel p-8 md:p-10 relative">
  <div class="absolute -top-4 -left-4 bg-black border border-purple-500 text-purple-400 p-2">
    <i class="ph-fill ph-quotes text-xl"></i>
  </div>
  <p class="font-serif-heading emoji-safe text-2xl text-white leading-relaxed z-10 relative"></p>
  <footer class="mt-8 font-mono-code text-[10px] uppercase tracking-[0.2em] text-purple-400 flex items-center gap-3">
    <span class="w-4 h-px bg-purple-500"></span> CASSANDRE ARKEMA, THE ALGORITHM WITCH
  </footer>
</blockquote>`;
const TITLE_FIT_SCRIPT = `
  <script id="title-fit-script">
    (() => {
      function fitTitleToContainer(selector) {
        document.querySelectorAll(selector).forEach((element) => {
          const computed = window.getComputedStyle(element);
          const originalSize = parseFloat(computed.fontSize);
          if (!originalSize) return;

          element.style.wordBreak = 'normal';
          element.style.overflowWrap = 'normal';
          element.style.hyphens = 'none';
          element.style.fontSize = '';

          let currentSize = originalSize;
          let guard = 0;
          while (
            guard < 16 &&
            (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) &&
            currentSize > originalSize * 0.84
          ) {
            currentSize -= 0.08;
            element.style.fontSize = currentSize.toFixed(2) + 'px';
            guard += 1;
          }
        });
      }

      function fitResponsiveTitles() {
        fitTitleToContainer('.post-title');
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          requestAnimationFrame(fitResponsiveTitles);
        }, { once: true });
      } else {
        requestAnimationFrame(fitResponsiveTitles);
      }

      window.addEventListener('load', fitResponsiveTitles, { once: true });
      window.addEventListener('resize', fitResponsiveTitles);
    })();
  </script>`;
const EXCLUDED_HTML = new Set([
  'index.html',
  'index-blog.html',
  'index-home.html',
  'template-post.html',
  'blog-section.html',
  'grimoire.html',
]);

const OVERRIDE_CSS = `
    main {
      padding-top: 6.5rem;
    }
    #navbar {
      position: fixed;
      top: 0;
      width: 100%;
      z-index: 50;
      transition: all 0.3s ease;
    }
    .archive-nav-desktop,
    .archive-nav-cta {
      display: none;
    }
    .archive-nav-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .archive-mobile-menu.hidden {
      display: none !important;
    }
    .archive-nav-inner {
      width: min(1280px, calc(100% - 0rem));
      margin: 0 auto;
      min-height: 4.75rem;
    }
    .archive-nav-desktop {
      gap: 2rem;
      color: #d1d5db;
    }
    .archive-nav-cta {
      align-items: center;
      justify-content: center;
      gap: 0.55rem;
      min-height: 2.5rem;
      padding: 0 1.5rem;
      border-radius: 999px;
      border: 1px solid rgba(168, 85, 247, 0.3);
      background: rgba(168, 85, 247, 0.1);
      color: white;
      transition: transform 0.24s ease, border-color 0.24s ease, background-color 0.24s ease;
    }
    .archive-nav-cta:hover {
      transform: scale(1.05);
      background: rgba(168, 85, 247, 0.2);
      border-color: rgba(192, 132, 252, 0.8);
    }
    .post-hero {
      padding-top: 1.1rem;
    }
    .back-link {
      margin-bottom: 3rem;
    }
    .post-title {
      font-size: clamp(2.5rem, 4.45vw, 5rem);
      line-height: 1.14;
      overflow-wrap: normal;
      word-break: normal;
      hyphens: none;
    }
    .post-title-accent {
      display: block;
      margin-top: 0.4rem;
    }
    .post-title,
    .post-title-accent,
    .related-card h3 {
      overflow-wrap: normal;
      word-break: normal;
      hyphens: none;
    }
    .article-body h3 {
      margin: 2.5rem 0 1rem;
      font-family: "Playfair Display", serif;
      font-size: 1.5rem;
      line-height: 1.35;
      color: #f3f4f6;
      font-weight: 400;
    }
    .article-body h4 {
      margin: 2rem 0 0.85rem;
      font-family: "Inter", sans-serif;
      font-size: 0.95rem;
      line-height: 1.5;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #c4b5fd;
      font-weight: 500;
    }
    .related-shell-title {
      margin: 0 0 2rem;
      font-family: "Cinzel Decorative", Georgia, serif;
      font-size: 2rem;
      line-height: 1.2;
      color: white;
      text-transform: uppercase;
      font-weight: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }
    .related-shell-title::before,
    .related-shell-title::after {
      content: "";
      width: 3rem;
      height: 1px;
      background: rgba(168, 85, 247, 0.5);
    }
    .lower-divider {
      height: 1px;
      background: linear-gradient(to right, transparent, rgba(168, 85, 247, 0.6), rgba(251, 191, 36, 0.42), transparent);
      margin: 0.25rem 0 1.25rem;
    }
    .lower-divider.upper {
      margin: 1.6rem 0 1.35rem;
    }
    .keep-open-box {
      margin-top: 1.45rem;
      padding: 1.3rem 1.4rem;
      background: linear-gradient(180deg, rgba(88, 28, 135, 0.16), rgba(13, 7, 24, 0.96));
      border-color: rgba(168, 85, 247, 0.55);
    }
    .keep-open-kicker {
      color: var(--gold);
      margin-bottom: 0.65rem;
      letter-spacing: 0.22em;
    }
    .keep-open-title {
      font-family: "Cinzel Decorative", Georgia, serif;
      font-size: 1.55rem;
      line-height: 1.2;
      text-transform: uppercase;
      color: white;
      font-weight: 400;
      margin-bottom: 0.6rem;
    }
    .keep-open-copy {
      margin: 0 0 1rem;
      color: var(--text-soft);
      line-height: 1.8;
      font-size: 0.98rem;
    }
    .keep-open-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .keep-open-action {
      min-height: 2.85rem;
      padding: 0 1rem;
      border: 1px solid rgba(168, 85, 247, 0.35);
      background: rgba(255, 255, 255, 0.03);
      color: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.55rem;
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      transition: transform 0.24s ease, border-color 0.24s ease, background-color 0.24s ease;
    }
    .keep-open-action:hover {
      transform: translateY(-2px);
      border-color: rgba(168, 85, 247, 0.68);
      background: rgba(168, 85, 247, 0.1);
    }
    .keep-open-action.primary {
      border-color: rgba(251, 191, 36, 0.42);
      color: #fef3c7;
    }
    .keep-open-action.primary:hover {
      border-color: rgba(251, 191, 36, 0.7);
      background: rgba(251, 191, 36, 0.08);
    }
    .related-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.5rem;
      align-items: stretch;
    }
    .related-card {
      padding: 1.5rem;
      min-height: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
      background: var(--panel);
      border-color: rgba(88, 28, 135, 0.55);
      transition: transform 0.24s ease, border-color 0.24s ease;
    }
    .related-card:hover {
      transform: translateY(-3px);
      border-color: color-mix(in srgb, var(--card-accent, var(--accent)) 60%, white 10%);
    }
    .related-card.theme-purple { --card-accent: #a855f7; }
    .related-card.theme-cyan { --card-accent: #22d3ee; }
    .related-card.theme-amber { --card-accent: #fbbf24; }
    .related-card.theme-fuchsia { --card-accent: #f472b6; }
    .related-card .category-chip {
      margin-bottom: 1.35rem;
      border-color: color-mix(in srgb, var(--card-accent, var(--accent)) 35%, transparent);
      color: var(--card-accent, var(--accent));
      padding: 0.18rem 0.5rem;
      width: fit-content;
    }
    .related-card-category-line {
      display: block;
      margin-bottom: 0;
      color: inherit;
    }
    .related-card-category-line::before,
    .related-card-category-line::after {
      display: none;
    }
    .related-card h3 {
      margin: 0 0 1rem;
      font-family: "Cinzel Decorative", Georgia, serif;
      font-size: 1.3rem;
      line-height: 1.35;
      text-transform: uppercase;
      color: white;
      font-weight: 400;
    }
    .related-card p {
      margin: 0;
      color: var(--text-soft);
      line-height: 1.8;
      font-size: 0.96rem;
      flex: 1 1 auto;
    }
    .related-card-date {
      margin-top: auto;
      padding-top: 1rem;
      align-self: stretch;
      padding-top: 1rem;
      border-top: 1px solid rgba(88, 28, 135, 0.3);
      display: flex;
      justify-content: flex-start;
      width: 100%;
    }
    .related-card-date span {
      border: none;
      background: none;
      padding: 0;
      color: var(--text-faint);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .dispatch-nav-row {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 0.15rem 0 0.2rem;
    }
    .dispatch-nav-link {
      display: flex;
      align-items: center;
      gap: 1rem;
      width: 100%;
      color: #9ca3af;
      transition: color 0.24s ease;
    }
    .dispatch-nav-link:hover {
      color: white;
    }
    .dispatch-nav-link.next {
      justify-content: flex-end;
      text-align: right;
    }
    .dispatch-nav-link.is-static {
      color: #6b7280;
      cursor: default;
    }
    .dispatch-nav-link.is-static:hover {
      color: #6b7280;
    }
    .dispatch-nav-text {
      min-width: 0;
    }
    .dispatch-nav-label {
      margin-bottom: 0.25rem;
      color: #6b7280;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .dispatch-nav-title {
      font-family: "Cinzel Decorative", Georgia, serif;
      font-size: 1.1rem;
      line-height: 1.35;
      color: inherit;
      font-weight: 400;
    }
    .dispatch-nav-icon {
      width: 2.5rem;
      height: 2.5rem;
      flex-shrink: 0;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(88, 28, 135, 0.5);
      color: #d1d5db;
      transition: transform 0.24s ease, border-color 0.24s ease, color 0.24s ease;
    }
    .dispatch-nav-link:hover .dispatch-nav-icon {
      border-color: rgba(168, 85, 247, 0.75);
      color: white;
    }
    .dispatch-nav-link.prev:hover .dispatch-nav-icon {
      transform: translateX(-3px);
    }
    .dispatch-nav-link.next:hover .dispatch-nav-icon {
      transform: translateX(3px);
    }
    .footer-copyright-wrap {
      width: min(1400px, calc(100% - 2rem));
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 0.15rem 0 1.2rem;
    }
    .footer-accent-line {
      width: min(100%, 56rem);
      height: 1px;
      background: linear-gradient(to right, transparent, rgba(168, 85, 247, 0.65), rgba(251, 191, 36, 0.4), transparent);
    }
    .site-footer {
      border-top: none;
      border-bottom: 2px solid rgba(168, 85, 247, 0.72);
      background: transparent;
      padding: 1.5rem 0 1.3rem;
      position: relative;
      z-index: 3;
      margin-top: 0;
    }
    .site-footer-inner {
      width: min(1400px, calc(100% - 2rem));
      margin: 0 auto;
      display: block;
    }
    .footer-row {
      width: 100%;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 1.5rem;
      padding-top: 0;
      border-top: none;
    }
    .footer-copyright {
      color: #a78bfa;
      font-size: 0.82rem;
      letter-spacing: 0.12em;
      text-align: left;
    }
    .footer-socials {
      justify-self: center;
    }
    .footer-copy {
      justify-self: end;
      color: #475569;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      font-size: 0.68rem;
    }
    @media (max-width: 1024px) {
      .related-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (min-width: 768px) {
      .archive-nav-inner {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 2rem;
      }
      .archive-nav-desktop {
        display: flex !important;
        align-items: center;
        justify-content: center;
      }
      .archive-nav-cta {
        display: inline-flex !important;
        justify-self: end;
      }
      .archive-nav-toggle,
      .archive-mobile-menu {
        display: none !important;
      }
      .dispatch-nav-row {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }
      .dispatch-nav-link {
        width: auto;
        max-width: min(32rem, 48%);
      }
    }
    @media (max-width: 767px) {
      .archive-nav-desktop,
      .archive-nav-cta {
        display: none !important;
      }
      .archive-nav-toggle {
        display: inline-flex !important;
      }
      .post-hero {
        padding-top: 1.85rem;
      }
      .back-link {
        margin-bottom: 2.35rem;
      }
      .post-title {
        font-size: clamp(2rem, 7.2vw, 3.7rem);
      }
      .footer-copyright-wrap {
        padding-bottom: 1rem;
      }
      .footer-row {
        grid-template-columns: 1fr;
        justify-items: center;
        text-align: center;
      }
      .footer-copyright {
        text-align: center;
      }
      .footer-copy {
        justify-self: center;
      }
    }
`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : '';
}

function replaceSectionByBounds(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  if (start === -1) return html;
  const end = html.indexOf(endMarker, start);
  if (end === -1) return html;
  return html.slice(0, start) + replacement + html.slice(end);
}

function getThemeForCategory(category = '') {
  switch (category) {
    case 'Ethics':
      return 'theme-purple';
    case 'Community':
      return 'theme-cyan';
    case 'Discovery':
      return 'theme-amber';
    case 'Platforms':
      return 'theme-fuchsia';
    default:
      return 'theme-purple';
  }
}

function getRelatedThemeForCategory(category = '') {
  switch (category) {
    case 'Ethics':
      return 'theme-amber';
    case 'Community':
      return 'theme-cyan';
    case 'Discovery':
      return 'theme-amber';
    case 'Platforms':
      return 'theme-fuchsia';
    default:
      return 'theme-purple';
  }
}

function buildRelatedCard(post) {
  return `<a class="related-card sharp-panel ${getRelatedThemeForCategory(post.category)}" href="/blog/${post.website_slug}.html">
        <div class="related-card-category-line"><span class="category-chip micro">${escapeHtml(post.category)}</span></div>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt)}</p>
        <div class="related-card-date micro"><span>${escapeHtml(post.published_short || '')}</span></div>
      </a>`;
}

function buildDispatchLink(post, label, direction) {
  if (!post) {
    const title = direction === 'prev' ? 'No Older Dispatch' : 'No Newer Dispatch';
    return `<div class="dispatch-nav-link ${direction} is-static">
      ${direction === 'prev' ? `<div class="dispatch-nav-icon"><i class="ph-bold ph-arrow-left"></i></div>` : ''}
      <div class="dispatch-nav-text">
        <div class="dispatch-nav-label">${label}</div>
        <div class="dispatch-nav-title">${title}</div>
      </div>
      ${direction === 'next' ? `<div class="dispatch-nav-icon"><i class="ph-bold ph-arrow-right"></i></div>` : ''}
    </div>`;
  }

  return `<a class="dispatch-nav-link ${direction}" href="/blog/${post.website_slug}.html">
    ${direction === 'prev' ? `<div class="dispatch-nav-icon"><i class="ph-bold ph-arrow-left"></i></div>` : ''}
    <div class="dispatch-nav-text">
      <div class="dispatch-nav-label">${label}</div>
      <div class="dispatch-nav-title">${escapeHtml(post.title)}</div>
    </div>
    ${direction === 'next' ? `<div class="dispatch-nav-icon"><i class="ph-bold ph-arrow-right"></i></div>` : ''}
  </a>`;
}

function buildIntroQuote(text) {
  return INTRO_QUOTE_TEMPLATE
    .replace(/>\s*[\s\S]*?\s*<\/p>/, `>${escapeHtml(text)}</p>`)
    .replace(/\svid="[^"]*"/g, '');
}

function buildMainQuote(text) {
  return MAIN_QUOTE_TEMPLATE
    .replace(/<p class="font-serif-heading[^"]*text-white[^"]*"[^>]*>\s*[\s\S]*?\s*<\/p>/, `<p class="font-serif-heading emoji-safe text-2xl text-white leading-relaxed z-10 relative">${escapeHtml(text)}</p>`)
    .replace(/<span class="w-4 h-px bg-purple-500"[^>]*><\/span>\s*(?:Excerpt from the Grimoire|CASSANDRE ARKEMA, THE ALGORITHM WITCH)/, `<span class="w-4 h-px bg-purple-500"></span> CASSANDRE ARKEMA, THE ALGORITHM WITCH`)
    .replace(/\svid="[^"]*"/g, '');
}

function buildKeepOpenBox() {
  return `<div class="keep-open-box sharp-panel">
            <div class="keep-open-kicker micro">Signal Continuum</div>
            <div class="keep-open-title">Keep the Grimoire Open</div>
            <p class="keep-open-copy">Trace adjacent signals, return to the archive, or stay subscribed to the next scroll moving through the system.</p>
            <div class="keep-open-actions">
              <a class="keep-open-action primary" href="/blog/"><span>Archive</span><i class="ph-bold ph-arrow-up-right"></i></a>
              <a class="keep-open-action" href="https://thealgorithmwitch.substack.com/" target="_blank" rel="noopener noreferrer"><span>Initiate Subscription</span><i class="ph-bold ph-arrow-right"></i></a>
            </div>
          </div>`;
}

function buildLowerShell(currentPost, allPosts, index) {
  const relatedPosts = allPosts.filter((entry) => entry.website_slug !== currentPost.website_slug).slice(0, 3);
  return `${buildKeepOpenBox()}
      <div class="lower-divider upper" aria-hidden="true"></div>
      <section class="lower-shell">
        <section>
          <h2 class="related-shell-title">Related Dispatches</h2>
          <div class="related-grid">
      ${relatedPosts.map(buildRelatedCard).join('\n      ')}
          </div>
        </section>
        <div class="lower-divider" aria-hidden="true"></div>
        <section>
          <div class="dispatch-nav-row">${buildDispatchLink(allPosts[index + 1] || null, 'Previous Scroll', 'prev')}${buildDispatchLink(allPosts[index - 1] || null, 'Next Scroll', 'next')}</div>
        </section>
      </section>`;
}

const postIndexBySlug = new Map(POSTS.map((post, index) => [post.website_slug, { post, index }]));
const allHtmlFiles = (await fs.readdir(BLOG_DIR))
  .filter((name) => name.endsWith('.html') && !EXCLUDED_HTML.has(name))
  .sort();

for (const filename of allHtmlFiles) {
  const slug = filename.replace(/\.html$/, '');
  const record = postIndexBySlug.get(slug);
  if (!record) continue;

  const { post, index } = record;
  const filePath = path.join(BLOG_DIR, filename);
  let html = await fs.readFile(filePath, 'utf8');

  if (html.includes('<nav id="navbar"')) {
    html = replaceSectionByBounds(
      html,
      '<nav id="navbar"',
      '\n\n    <main>',
      `${HEADER_NAV.trim().replace(/\svid="[^"]*"/g, '')}\n\n    `,
    );
  } else if (html.includes('<main')) {
    html = html.replace(
      /<main/,
      `${HEADER_NAV.trim().replace(/\svid="[^"]*"/g, '')}\n\n    <main`,
    );
  }

  if (!html.includes('subpage-polish-overrides')) {
    html = html.replace(
      /<\/style>\s*<\/head>/,
      `</style>\n  <style id="subpage-polish-overrides">\n${OVERRIDE_CSS}\n  </style>\n</head>`,
    );
  } else {
    html = html.replace(
      /<style id="subpage-polish-overrides">[\s\S]*?<\/style>/,
      `<style id="subpage-polish-overrides">\n${OVERRIDE_CSS}\n  </style>`,
    );
  }

  if (!html.includes('/assets/tailwind.css?v=4')) {
    html = html.replace(
      /(<meta charset="UTF-8">\s*)/,
      `$1  ${HEAD_JS_SNIPPET}\n`,
    );
    html = html.replace(
      /(<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*)/,
      `$1  ${HEAD_CRITICAL_STYLE}\n  ${HEAD_TAILWIND_PRELOAD}\n  ${HEAD_TAILWIND_NOSCRIPT}\n`,
    );
  }

  html = html.replace(
    /<div class="footer-copyright-wrap">[\s\S]*?<\/div>\s*<footer class="site-footer">\s*<div class="site-footer-inner">\s*<div class="footer-row">\s*<div class="footer-spacer" aria-hidden="true"><\/div>/,
    `<div class="footer-copyright-wrap">
        <span class="footer-accent-line" aria-hidden="true"></span>
      </div>

      <footer class="site-footer">
        <div class="site-footer-inner">
          <div class="footer-row">
            <div class="font-magical footer-copyright">© 2026 The Algorithm Witch</div>`,
  );

  html = html.replace(
    /<footer class="mt-8[^"]*text-purple-400 flex items-center gap-3"[^>]*>\s*<span class="w-4 h-px bg-purple-500"><\/span>\s*(?:Excerpt from the Grimoire|CASSANDRE ARKEMA, THE ALGORITHM WITCH)\s*<\/footer>/,
    `<footer class="mt-8 font-mono-code text-[10px] uppercase tracking-[0.2em] text-purple-400 flex items-center gap-3">
              <span class="w-4 h-px bg-purple-500"></span> CASSANDRE ARKEMA, THE ALGORITHM WITCH
            </footer>`,
  );

  html = html.replace(
    /<div class="keep-open-box sharp-panel">\s*<div class="keep-open-kicker micro">Signal Continuum<\/div>\s*<div class="keep-open-title">Keep the Grimoire Open<\/div>\s*<p class="keep-open-copy">[\s\S]*?<\/p>\s*<div class="keep-open-actions">[\s\S]*?<\/div>\s*<\/div>/,
    `<div class="keep-open-box sharp-panel">
            <div class="keep-open-kicker micro">Signal Continuum</div>
            <div class="keep-open-title">Keep the Grimoire Open</div>
            <p class="keep-open-copy">Trace adjacent signals, return to the archive, or stay subscribed to the next scroll moving through the system.</p>
            <div class="keep-open-actions">
              <a class="keep-open-action primary" href="/blog/"><span>Archive</span><i class="ph-bold ph-arrow-up-right"></i></a>
              <a class="keep-open-action" href="https://thealgorithmwitch.substack.com/" target="_blank" rel="noopener noreferrer"><span>Initiate Subscription</span><i class="ph-bold ph-arrow-right"></i></a>
            </div>
          </div>`,
  );

  const introText = stripHtml(post.intro_opening || '');
  html = html.replace(
    /<p class="[^"]*border-l-4 border-purple-500[^"]*">[\s\S]*?<\/p>/,
    buildIntroQuote(introText),
  );

  html = html.replace(
    /<div class="substack-shell-bar(?: micro)?"[^>]*>\s*<span[^>]*>Signal Intake<\/span>\s*<\/div>\s*/g,
    '',
  );

  const boxedQuoteText = stripHtml(post.intro_closing || '');
  html = html.replace(/<blockquote[\s\S]*?<\/blockquote>/, buildMainQuote(boxedQuoteText));
  html = html.replace(/Excerpt from the Grimoire/g, 'CASSANDRE ARKEMA, THE ALGORITHM WITCH');
  if (!html.includes('<blockquote')) {
    html = html.replace(
      /(<p class="font-serif-heading emoji-safe text-2xl text-purple-200\/90 leading-relaxed italic mb-12 border-l-4 border-purple-500 pl-6 py-2 bg-gradient-to-r from-purple-900\/20 to-transparent"[^>]*>[\s\S]*?<\/p>)/,
      `$1\n\n${buildMainQuote(boxedQuoteText)}`,
    );
  }

  html = html.replace(
    /const menuButton = document\.getElementById\('menuButton'\);[\s\S]*?const bodyEl = document\.body;/,
    `const menuButton = document.getElementById('menuButton');
    const mobileMenu = document.getElementById('mobileMenu');
    if (menuButton && mobileMenu) {
      menuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
        const expanded = menuButton.getAttribute('aria-expanded') === 'true';
        menuButton.setAttribute('aria-expanded', String(!expanded));
      });

      mobileMenu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          mobileMenu.classList.add('hidden');
          menuButton.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const bodyEl = document.body;`,
  );

  if (!html.includes('id="title-fit-script"')) {
    html = html.replace(/<\/body>/, `${TITLE_FIT_SCRIPT}\n</body>`);
  } else {
    html = html.replace(
      /<script id="title-fit-script">[\s\S]*?<\/script>/,
      TITLE_FIT_SCRIPT.trim(),
    );
  }

  if (html.includes('<div class="lower-divider upper" aria-hidden="true"></div>')) {
    if (html.includes('<div class="keep-open-box sharp-panel">')) {
      html = replaceSectionByBounds(
        html,
        '<div class="keep-open-box sharp-panel">',
        '</main>',
        `${buildLowerShell(post, POSTS, index)}\n`,
      );
    } else {
      html = replaceSectionByBounds(
        html,
        '<div class="lower-divider upper" aria-hidden="true"></div>',
        '</main>',
        `${buildLowerShell(post, POSTS, index)}\n`,
      );
    }
  } else if (html.includes('<section class="max-w-[1400px] mx-auto px-6 py-16 border-t border-purple-900/30 bg-[#0a0514]/50 mt-12"')) {
    html = replaceSectionByBounds(
      html,
      '<section class="max-w-[1400px] mx-auto px-6 py-16 border-t border-purple-900/30 bg-[#0a0514]/50 mt-12"',
      '</main>',
      `${buildLowerShell(post, POSTS, index)}\n\n`,
    );
  }

  const currentTheme = getThemeForCategory(post.category);
  html = html.replace(/<body class="[^"]*">/, `<body class="${currentTheme}">`);

  await fs.writeFile(filePath, html);
  console.log('Updated:', filename);
}
