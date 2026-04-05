import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const BLOG_DIR = path.dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = path.join(BLOG_DIR, 'posts.json');

JSON.parse(await fs.readFile(POSTS_PATH, 'utf8'));

const EXCLUDED_HTML = new Set([
  'index.html',
  'index-blog.html',
  'index-home.html',
  'template-post.html',
  'blog-section.html',
  'grimoire.html',
]);

const LEGACY_NAV_REGEX = /\n*<nav class="fixed top-0 w-full z-50 bg\[#05020a\]\/90 backdrop-blur-sm border-b border-purple-900\/50"[\s\S]*?<\/nav>\s*(?=<nav id="navbar")/;
const LEGACY_NAV_FRAGMENT_REGEX = /\n*<a href="#" class="flex items-center gap-4 group"[\s\S]*?<div class="hidden lg:flex items-center gap-10 text-xs font-mono-code uppercase tracking-widest text-gray-400"[\s\S]*?<\/div>\s*(?=<nav id="navbar")/;

const allHtmlFiles = (await fs.readdir(BLOG_DIR))
  .filter((name) => name.endsWith('.html') && !EXCLUDED_HTML.has(name))
  .sort();

for (const filename of allHtmlFiles) {
  const filePath = path.join(BLOG_DIR, filename);
  let html = await fs.readFile(filePath, 'utf8');

  html = html.replace(LEGACY_NAV_REGEX, '\n\n');
  html = html.replace(LEGACY_NAV_FRAGMENT_REGEX, '\n\n');

  await fs.writeFile(filePath, html);
  console.log('Updated:', filename);
}
