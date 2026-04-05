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

const allHtmlFiles = (await fs.readdir(BLOG_DIR))
  .filter((name) => name.endsWith('.html') && !EXCLUDED_HTML.has(name))
  .sort();

for (const filename of allHtmlFiles) {
  const filePath = path.join(BLOG_DIR, filename);
  const html = await fs.readFile(filePath, 'utf8');
  await fs.writeFile(filePath, html);
  console.log('Updated:', filename);
}
