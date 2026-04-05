import fs from 'fs/promises';
import path from 'path';
import https from 'https';

const FEED_URL = 'https://thealgorithmwitch.substack.com/feed';
const SITE_ORIGIN = 'https://thealgorithmwitch.com';
const BLOG_URL = `${SITE_ORIGIN}/blog/`;
const SUBSTACK_URL = 'https://thealgorithmwitch.substack.com/';
const OUTPUT_DIR = '/Users/Cassandre/blog';
const TEMPLATE_PATH = path.join(OUTPUT_DIR, 'template-post.html');
const POSTS_JSON_PATH = path.join(OUTPUT_DIR, 'posts.json');
const ARCHIVE_SOURCE_PATH = path.join(OUTPUT_DIR, 'index-blog.html');
const ARCHIVE_OUTPUT_PATH = path.join(OUTPUT_DIR, 'index.html');
const FALLBACK_OG = `${SITE_ORIGIN}/og.jpg?v=4`;
const SECTION_THEMES = ['purple', 'cyan', 'amber', 'fuchsia'];

const TITLE_TO_SLUG = new Map([
  ['The Ethics of Algorithmic Visibility', 'ethics-of-algorithmic-visibility'],
  ['The Future Is Community-Led', 'future-is-community-led'],
  ['Posting Less Won’t Save You', 'posting-less-wont-save-you'],
  ['Born to Scroll', 'born-to-scroll'],
  ['The Recommendation Engine Learned Where You Live', 'recommendation-engine-learned-where-you-live'],
  ['Is the Short-Form Video Market Oversaturated?', 'short-form-video-market-oversaturated'],
  ['Are hashtags dead?', 'are-hashtags-dead'],
  ['How Search Is Changing in the Age of AI', 'how-search-is-changing-ai'],
]);

const CARD_THEMES = [
  { theme: 'purple', label: 'Ethics' },
  { theme: 'cyan', label: 'Systems' },
  { theme: 'amber', label: 'Search' },
  { theme: 'fuchsia', label: 'Culture' },
];

const CATEGORY_THEME_MAP = {
  Ethics: 'purple',
  Search: 'amber',
  Community: 'cyan',
  Platforms: 'fuchsia',
  Discovery: 'purple',
  Visibility: 'amber',
  Dispatch: 'purple',
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Feed request failed with status ${response.statusCode}`));
        response.resume();
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function decodeHtml(text = '') {
  return text
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8230;/g, '…')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#129668;/g, '🧄')
    .replace(/&#10024;/g, '✨')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(html = '') {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function slugify(text = '') {
  return stripTags(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getTagValue(xml, tagName) {
  const cdata = xml.match(new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return plain ? plain[1].trim() : '';
}

function getAttributeValue(xml, tagName, attribute) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*\\s${attribute}="([^"]+)"`, 'i'));
  return match ? match[1] : '';
}

function stripQuery(url = '') {
  return url.split('?')[0];
}

function estimateReadingTime(html = '') {
  const words = stripTags(html).split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.ceil(words / 220));
}

function articleCategory(title) {
  const t = title.toLowerCase();
  if (t.includes('search')) return 'Search';
  if (t.includes('hashtag')) return 'Visibility';
  if (t.includes('community')) return 'Community';
  if (t.includes('video') || t.includes('scroll')) return 'Platforms';
  if (t.includes('recommendation')) return 'Discovery';
  if (t.includes('ethics')) return 'Ethics';
  return 'Dispatch';
}

function themeForCategory(category) {
  return CATEGORY_THEME_MAP[category] || 'purple';
}

function titleToDisplayHtml(title) {
  const parts = title.split(' ');
  if (parts.length < 4) return escapeHtml(title);
  const splitAt = Math.max(2, Math.floor(parts.length * 0.58));
  return `${escapeHtml(parts.slice(0, splitAt).join(' '))}<span class="post-title-accent">${escapeHtml(parts.slice(splitAt).join(' '))}</span>`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return {
    iso: date.toISOString(),
    short: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    long: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  };
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function sanitizeCaption(text = '') {
  return decodeHtml(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function buildQuoteBlock(text = '') {
  const quoteText = stripTags(text).replace(/\s+/g, ' ').trim();
  if (!quoteText) return '';
  return `<blockquote class="my-16 sharp-panel p-8 md:p-10 relative"><div class="quote-icon absolute -top-4 -left-4 bg-black border border-purple-500 text-purple-400 p-2"><i class="ph-fill ph-quotes text-xl"></i></div><p class="font-serif-heading text-2xl text-white leading-relaxed z-10 relative">"${escapeHtml(quoteText)}"</p><footer class="mt-8 font-mono-code text-[10px] uppercase tracking-[0.2em] text-purple-400 flex items-center gap-3"><span class="w-4 h-px bg-purple-500"></span> CASSANDRE ARKEMA, THE ALGORITHM WITCH</footer></blockquote>`;
}

function extractImageFigure(block) {
  const src = block.match(/<img[^>]*src="([^"]+)"/i)?.[1];
  if (!src) return '';
  const alt = decodeHtml(block.match(/<img[^>]*alt="([^"]*)"/i)?.[1] || '');
  const caption = sanitizeCaption(block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '');
  const captionHtml = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure><div class="figure-frame"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt || '')}"></div>${captionHtml}</figure>`;
}

function sanitizeArticleHtml(html, mappedLinks) {
  let cleaned = html;

  cleaned = cleaned.replace(/<h1\b/gi, '<h2');
  cleaned = cleaned.replace(/<\/h1>/gi, '</h2>');
  cleaned = cleaned.replace(/<div class="captioned-button-wrap"[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div class="subscription-widget-wrap-editor"[\s\S]*?<\/div><\/div>/gi, '');
  cleaned = cleaned.replace(/<div class="captioned-image-container">[\s\S]*?<\/figure><\/div>/gi, (block) => extractImageFigure(block));
  cleaned = cleaned.replace(/<div id="[^"]*" class="youtube-wrap"[^>]*><div class="youtube-inner">([\s\S]*?<\/iframe>)<\/div><\/div>/gi, '<figure><div class="figure-frame">$1</div></figure>');
  cleaned = cleaned.replace(/<div class="image-link-expand"[\s\S]*?<\/div><\/div>/gi, '');
  cleaned = cleaned.replace(/<picture[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/picture>/gi, '');
  cleaned = cleaned.replace(/<source[^>]*>/gi, '');
  cleaned = cleaned.replace(/<a class="image-link[^"]*"[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/a><\/figure>/gi, '</figure>');
  cleaned = cleaned.replace(/<\/a>(?=<\/figure>)/gi, '');
  cleaned = cleaned.replace(/<button[\s\S]*?<\/button>/gi, '');
  cleaned = cleaned.replace(/<form class="subscription-widget-subscribe"[\s\S]*?<\/form>/gi, '');
  cleaned = cleaned.replace(/<div class="preamble">[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/\s(?:class|data-[\w-]+|width|height|srcset|sizes|fetchpriority|title|style|target|loading)="[^"]*"/gi, '');
  cleaned = cleaned.replace(/<p[^>]*>\s*<a[^>]*>\s*<span>\s*(Share|Subscribe)\s*<\/span>\s*<\/a>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<a[^>]*>\s*<span>\s*(Share|Subscribe)\s*<\/span>\s*<\/a>/gi, '');
  cleaned = cleaned.replace(/<div>\s*<label[^>]*>Text within this block will maintain its original spacing when published<\/label>\s*<pre><em>([\s\S]*?)<\/em><\/pre>\s*<\/div>/gi, (_m, text) => {
    const lines = decodeHtml(text).split('\n').map((line) => line.trim()).filter(Boolean);
    return buildQuoteBlock(lines.join(' '));
  });
  cleaned = cleaned.replace(/<img([^>]*?)\s+>/gi, '<img$1>');
  cleaned = cleaned.replace(/<p>\s*(?:&nbsp;|\s)*<\/p>/gi, '');
  cleaned = cleaned.replace(/<p><em>\s*<\/em><\/p>/gi, '');
  cleaned = cleaned.replace(/<strong>\s*<\/strong>/gi, '');
  cleaned = cleaned.replace(/<\/?form[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/?div[^>]*>/gi, '');
  cleaned = cleaned.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_match, inner) => buildQuoteBlock(inner));
  cleaned = cleaned.replace(
    /<blockquote class="my-16 sharp-panel p-8 md:p-10 relative"><i class="ph-fill ph-quotes text-xl"><\/i><p class="font-serif-heading text-2xl text-white leading-relaxed z-10 relative">/g,
    '<blockquote class="my-16 sharp-panel p-8 md:p-10 relative"><div class="quote-icon absolute -top-4 -left-4 bg-black border border-purple-500 text-purple-400 p-2"><i class="ph-fill ph-quotes text-xl"></i></div><p class="font-serif-heading text-2xl text-white leading-relaxed z-10 relative">',
  );

  cleaned = cleaned.replace(/href="([^"]+)"/gi, (_match, url) => {
    const withoutQuery = stripQuery(url);
    if (mappedLinks.has(withoutQuery)) return `href="${mappedLinks.get(withoutQuery)}"`;
    if (/services\.html$/i.test(withoutQuery) || /\/services\.html$/i.test(withoutQuery)) return 'href="/services/"';
    return `href="${url}"`;
  });

  const toc = [];
  const seenIds = new Map();
  cleaned = cleaned.replace(/<(h[234])>([\s\S]*?)<\/\1>/gi, (_full, tag, inner) => {
    const plain = stripTags(inner).replace(/\*/g, '').trim();
    if (!plain) return '';
    const base = slugify(plain) || `section-${toc.length + 1}`;
    const count = seenIds.get(base) || 0;
    seenIds.set(base, count + 1);
    const id = count ? `${base}-${count + 1}` : base;
    const cleanInner = inner.replace(/^<strong>([\s\S]*)<\/strong>$/i, '$1');
    toc.push({ level: tag.toLowerCase(), id, text: plain });
    return `<${tag} id="${id}">${cleanInner}</${tag}>`;
  });

  const figures = [];
  let figureCount = 0;
  cleaned = cleaned.replace(/<figure>([\s\S]*?)<\/figure>/gi, (_full, inner) => {
    figureCount += 1;
    const id = `vision-${figureCount}`;
    const label = `F${figureCount}`;
    const theme = SECTION_THEMES[(figureCount - 1) % SECTION_THEMES.length];
    const imgSrc = inner.match(/<img[^>]*src="([^"]+)"/i)?.[1] || '';
    const imgAlt = decodeHtml(inner.match(/<img[^>]*alt="([^"]*)"/i)?.[1] || '');
    const iframeSrc = inner.match(/<iframe[^>]*src="([^"]+)"/i)?.[1] || '';
    const existingCaption = sanitizeCaption(inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || '');
    const innerWithoutCaption = inner.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/i, '');
    const number = String(figureCount).padStart(2, '0');
    const captionText = existingCaption || (iframeSrc ? 'Embedded reference' : 'Visual reference');
    figures.push({
      id,
      label,
      theme,
      type: imgSrc ? 'image' : 'embed',
      src: imgSrc,
      alt: imgAlt,
      iframe: iframeSrc,
    });
    const framedInner = /class="figure-frame"/i.test(innerWithoutCaption)
      ? innerWithoutCaption
      : `<div class="figure-frame">${innerWithoutCaption}</div>`;
    return `<figure id="${id}" class="article-figure theme-${theme}">${framedInner}<figcaption><span class="figure-caption-index">Figure ${number}</span><span class="figure-caption-text">${escapeHtml(captionText)}</span></figcaption></figure>`;
  });

  cleaned = cleaned.replace(/\n{2,}/g, '\n').trim();
  return structureArticleHtml(cleaned, toc, figures);
}

function structureArticleHtml(html, toc, figures) {
  const matches = [...html.matchAll(/<(h[23]) id="([^"]+)">([\s\S]*?)<\/\1>/gi)];
  if (!matches.length) {
    return {
      html: `<section class="article-section article-section-intro theme-purple" data-section-id="top">${html}</section>`,
      toc: [{ id: 'top', text: 'Article start', number: 'INTRO', theme: 'purple' }],
      figures,
    };
  }

  const sections = [];
  const themedToc = [];
  const intro = html.slice(0, matches[0].index).trim();
  if (intro) {
    sections.push(`<section class="article-section article-section-intro theme-purple" data-section-id="top">${intro}</section>`);
  }

  matches.forEach((match, index) => {
    const fullHeading = match[0];
    const tag = match[1];
    const id = match[2];
    const text = stripTags(match[3]).trim();
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : html.length;
    const theme = SECTION_THEMES[index % SECTION_THEMES.length];
    const number = String(index + 1).padStart(2, '0');
    let block = html.slice(match.index, nextStart);
    const heading = `<${tag} id="${id}" class="section-heading"><span class="section-number">${number}</span><span class="section-heading-text">${match[3]}</span></${tag}>`;
    block = block.replace(fullHeading, heading);
    sections.push(`<section class="article-section theme-${theme}" data-section-id="${id}" data-theme="${theme}">${block}</section>`);
    themedToc.push({ id, text, number, theme });
  });

  return { html: sections.join('\n'), toc: themedToc, figures };
}

function buildJsonLd(post) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${post.canonical_url}#article`,
        headline: post.title,
        description: post.excerpt,
        url: post.canonical_url,
        datePublished: post.published_iso.slice(0, 10),
        dateModified: post.published_iso.slice(0, 10),
        author: { '@id': `${SITE_ORIGIN}/#person` },
        publisher: { '@id': `${SITE_ORIGIN}/#person` },
        mainEntityOfPage: { '@id': `${post.canonical_url}#webpage` },
        image: { '@type': 'ImageObject', url: post.og_image },
        articleSection: post.category,
      },
      {
        '@type': 'WebPage',
        '@id': `${post.canonical_url}#webpage`,
        url: post.canonical_url,
        name: `${post.title} | The Algorithm Witch`,
        isPartOf: { '@id': `${BLOG_URL}#blog` },
      },
      {
        '@type': 'Blog',
        '@id': `${BLOG_URL}#blog`,
        url: BLOG_URL,
        name: 'The Algorithm Witch Archive',
      },
      {
        '@type': 'Person',
        '@id': `${SITE_ORIGIN}/#person`,
        name: 'Cassandre Arkema',
        alternateName: 'The Algorithm Witch',
        url: `${SITE_ORIGIN}/`,
      },
    ],
  });
}

function replaceTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (html, [key, value]) => html.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function injectArchiveData(html, posts) {
  const payload = JSON.stringify(posts);
  return html.replace(
    /<script id="archive-posts-data" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="archive-posts-data" type="application/json">${payload}</script>`,
  );
}

function buildRelatedPosts(allPosts, currentPost) {
  return allPosts
    .filter((post) => post.website_slug !== currentPost.website_slug)
    .slice(0, 3)
    .map((post, index) => {
      const theme = themeForCategory(post.category);
      return `
      <a class="related-card sharp-panel theme-${theme}" href="/blog/${post.website_slug}.html">
        <div class="category-chip micro" style="margin-bottom:1.35rem;">${escapeHtml(post.category)}</div>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt)}</p>
      </a>
    `;
    })
    .join('');
}

function buildDispatchRail(posts, index) {
  const older = posts[index + 1];
  const newer = posts[index - 1];
  const olderHtml = older
    ? `<a class="dispatch-card sharp-panel older" href="/blog/${older.website_slug}.html"><div class="category-chip micro">${escapeHtml(older.category)}</div><h3>${escapeHtml(older.title)}</h3><p>${escapeHtml(older.excerpt)}</p><div class="dispatch-arrow micro"><span>←</span><span>Previous Dispatch</span></div></a>`
    : '<div class="dispatch-card sharp-panel older"><div class="category-chip micro">Archive</div><h3>No Earlier Dispatch</h3><p>You are at the earliest dispatch in the current imported archive.</p><div class="dispatch-arrow micro"><span>←</span><span>Previous Dispatch</span></div></div>';
  const newerHtml = newer
    ? `<a class="dispatch-card sharp-panel next" href="/blog/${newer.website_slug}.html"><div class="category-chip micro">${escapeHtml(newer.category)}</div><h3>${escapeHtml(newer.title)}</h3><p>${escapeHtml(newer.excerpt)}</p><div class="dispatch-arrow micro"><span>Next Dispatch</span><span>→</span></div></a>`
    : '<div class="dispatch-card sharp-panel next"><div class="category-chip micro">Archive</div><h3>No Newer Dispatch</h3><p>You are at the latest dispatch in the current imported archive.</p><div class="dispatch-arrow micro"><span>Next Dispatch</span><span>→</span></div></div>';
  return `${olderHtml}${newerHtml}`;
}

function buildVisionsPanel(post) {
  if (!post.figures.length) {
    return '<div class="vision-link" aria-hidden="true"><i class="ph-duotone ph-image"></i><span class="vision-tag">None</span></div>';
  }
  return post.figures.slice(0, 6).map((figure) => `
    <a class="vision-link" href="#${figure.id}">
      ${figure.type === 'image' && figure.src
        ? `<img src="${escapeAttribute(figure.src)}" alt="${escapeAttribute(figure.alt || figure.label)}">`
        : '<i class="ph-duotone ph-play-circle"></i>'}
      <span class="vision-tag">${figure.label}</span>
    </a>
  `).join('');
}

function buildWordTags(post) {
  const stop = new Set(['the', 'and', 'for', 'with', 'into', 'through', 'from', 'your', 'that', 'this', 'where', 'what', 'have', 'will', 'less', 'save', 'learned', 'they', 'you']);
  const words = post.title
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word && word.length > 3 && !stop.has(word));
  const tags = [post.category, ...words].filter((value, index, all) => all.indexOf(value) === index).slice(0, 4);
  return tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('');
}

function extractPullQuote(post) {
  const fromBlockquote = post.body_html.match(/<blockquote>([\s\S]*?)<\/blockquote>/i)?.[1];
  if (fromBlockquote) return stripTags(fromBlockquote);
  const firstParagraph = post.body_html.match(/<p>([\s\S]*?)<\/p>/i)?.[1] || post.excerpt;
  const text = stripTags(firstParagraph);
  const sentence = text.match(/(.{90,240}?[.!?])(?:\s|$)/);
  return sentence ? sentence[1].trim() : text.slice(0, 220).trim();
}

function getIntroText(articleHtml = '') {
  const introMatch = articleHtml.match(/<section class="article-section article-section-intro[\s\S]*?>([\s\S]*?)<\/section>/i);
  return stripTags(introMatch ? introMatch[1] : articleHtml).replace(/\s+/g, ' ').trim();
}

function extractFirstSentence(text = '') {
  const match = text.match(/(.{40,260}?[.!?])(?:\s|$)/);
  return (match ? match[1] : text).trim();
}

function extractLastSentence(text = '') {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((part) => part.trim()).filter(Boolean) || [];
  return (sentences[sentences.length - 1] || text).trim();
}

async function main() {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const feed = await fetchText(FEED_URL);
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);

  if (!items.length) throw new Error('No posts were found in the Substack feed.');

  const rawPosts = items.map((item) => ({
    title: decodeHtml(getTagValue(item, 'title')),
    description: decodeHtml(getTagValue(item, 'description')),
    originalUrl: getTagValue(item, 'link'),
    publishedAt: getTagValue(item, 'pubDate'),
    coverImage: getAttributeValue(item, 'enclosure', 'url'),
    contentHtml: getTagValue(item, 'content:encoded'),
  }));

  const feedTitles = new Set(rawPosts.map((post) => post.title));
  const mappedTitles = new Set(TITLE_TO_SLUG.keys());
  const missingFromFeed = [...mappedTitles].filter((title) => !feedTitles.has(title));
  const unmappedFeedTitles = [...feedTitles].filter((title) => !mappedTitles.has(title));
  if (missingFromFeed.length || unmappedFeedTitles.length) {
    const errors = [];
    if (missingFromFeed.length) errors.push(`Missing from feed: ${missingFromFeed.join(', ')}`);
    if (unmappedFeedTitles.length) errors.push(`Unmapped feed titles: ${unmappedFeedTitles.join(', ')}`);
    throw new Error(errors.join(' | '));
  }

  const normalized = rawPosts.map((post) => {
    if (!post.contentHtml) throw new Error(`Missing full HTML body in feed for: ${post.title}`);
    const websiteSlug = TITLE_TO_SLUG.get(post.title);
    if (!websiteSlug) throw new Error(`No custom website slug provided for: ${post.title}`);
    return {
      title: post.title,
      excerpt: post.description || stripTags(post.contentHtml).slice(0, 180),
      published_at: post.publishedAt,
      cover_image: post.coverImage || '',
      body_html: post.contentHtml,
      original_substack_url: post.originalUrl,
      original_substack_slug: stripQuery(post.originalUrl).split('/').pop() || '',
      website_slug: websiteSlug,
    };
  }).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  const linkMap = new Map(normalized.map((post) => [stripQuery(post.original_substack_url), `/blog/${post.website_slug}.html`]));

  const posts = normalized.map((post) => {
    const structured = sanitizeArticleHtml(post.body_html, linkMap);
    if (stripTags(structured.html).length < 300) throw new Error(`Sanitized article body is too short for: ${post.title}`);
    const dates = formatDate(post.published_at);
    const readingTimeMinutes = estimateReadingTime(structured.html);
    const category = articleCategory(post.title);
    const theme = themeForCategory(category);
    const introText = getIntroText(structured.html);
    return {
      ...post,
      body_html: structured.html,
      toc: structured.toc,
      figures: structured.figures,
      category,
      theme,
      intro_opening: extractFirstSentence(introText),
      intro_closing: extractLastSentence(introText),
      published_iso: dates.iso,
      published_short: dates.short,
      published_long: dates.long,
      canonical_url: `${BLOG_URL}${post.website_slug}.html`,
      og_image: post.cover_image || FALLBACK_OG,
      og_image_alt: `${post.title} | The Algorithm Witch`,
      reading_time_minutes: readingTimeMinutes,
      reading_time_display: `${readingTimeMinutes} min read`,
    };
  });

  await fs.writeFile(POSTS_JSON_PATH, `${JSON.stringify(posts, null, 2)}\n`);

  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const introLink = '<a class="toc-link" href="#top" data-theme="purple"><span class="toc-link-number">Intro</span><span class="toc-link-label">Intro</span></a>';
    const tocLinks = post.toc.length
      ? `${introLink}${post.toc.map((entry) => `<a class="toc-link" href="#${entry.id}" data-theme="${entry.theme}"><span class="toc-link-number">${entry.number}</span><span class="toc-link-label">${escapeHtml(entry.text)}</span></a>`).join('')}`
      : introLink;
    const visionsPanel = buildVisionsPanel(post);
    const coverMedia = post.cover_image
      ? `<img src="${escapeAttribute(post.cover_image)}" alt="${escapeAttribute(post.title)}" loading="eager">`
      : '<div class="hero-media-placeholder"><i class="ph-duotone ph-image"></i></div>';

    const html = replaceTokens(template, {
      PAGE_TITLE: escapeHtml(`${post.title} | The Algorithm Witch`),
      META_DESCRIPTION: escapeHtml(post.excerpt),
      CANONICAL_URL: post.canonical_url,
      OG_IMAGE: post.og_image,
      OG_IMAGE_ALT: escapeHtml(post.og_image_alt),
      JSON_LD: buildJsonLd(post),
      POST_THEME: post.theme,
      POST_CATEGORY: escapeHtml(post.category),
      POST_TITLE_HTML: titleToDisplayHtml(post.title),
      POST_DATE_DISPLAY: escapeHtml(post.published_long),
      READING_TIME: escapeHtml(post.reading_time_display),
      POST_TAGS: buildWordTags(post),
      INTRO_OPENING: escapeHtml(post.intro_opening || post.excerpt),
      INTRO_CLOSING: escapeHtml(post.intro_closing || extractPullQuote(post)),
      COVER_MEDIA: coverMedia,
      TOC_LINKS: tocLinks,
      ORIGINAL_SUBSTACK_URL: post.original_substack_url || SUBSTACK_URL,
      ENCODED_CANONICAL_URL: encodeURIComponent(post.canonical_url),
      ENCODED_SHARE_TITLE: encodeURIComponent(post.title),
      ARTICLE_BODY: post.body_html,
      DISPATCH_RAIL: buildDispatchRail(posts, index),
      RELATED_POSTS: buildRelatedPosts(posts, post),
      VISIONS_PANEL: visionsPanel,
      VISION_COUNT: `${post.figures.length} files`,
    });

    await fs.writeFile(path.join(OUTPUT_DIR, `${post.website_slug}.html`), html);
  }

  const archiveSource = await fs.readFile(ARCHIVE_SOURCE_PATH, 'utf8');
  const archiveWithData = injectArchiveData(archiveSource, posts);
  await fs.writeFile(ARCHIVE_SOURCE_PATH, archiveWithData);
  await fs.writeFile(ARCHIVE_OUTPUT_PATH, archiveWithData);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
