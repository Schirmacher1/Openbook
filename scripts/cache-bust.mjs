/**
 * Give every JS/CSS file a fresh URL on every deploy, so a browser (or a CDN
 * edge) that's still holding an old cached copy of one file can't end up
 * running it alongside a fresh copy of another.
 *
 * WHY THIS EXISTS
 *
 * This is a multi-module ES app with no bundler: index.html loads app.js,
 * which imports state.js, which imports data.js, and so on — nine separate
 * files, each its own URL, each cached independently by whatever's in
 * between the browser and this static site. A deploy landing in the middle
 * of that graph — a browser (or a CDN edge, or a mobile carrier's transparent
 * proxy) revalidating app.js a minute after a deploy but state.js a minute
 * before it — leaves two files that were never meant to run together running
 * together. That's not hypothetical: a real user hit exactly this, twice,
 * from two deploys eight minutes apart, and every symptom pointed at a code
 * bug until decoding their actual data with the current source proved it
 * wasn't one.
 *
 * GitHub Pages can't set cache-control headers at all (see README), so
 * "cache this file for less time" isn't an available fix. Giving each file a
 * new URL every deploy is: a query string a static file server ignores when
 * deciding what to serve, but a browser treats as part of the cache key —
 * the standard bundler-free cache-busting technique, and one that works
 * identically on Netlify or Cloudflare Pages too if this ever moves, unlike
 * a header this host can't send.
 *
 * WHAT IT DOES
 *
 * Runs against the staged copy in _site/, after "Stage the site" and before
 * upload-pages-artifact, so the repo's own source stays free of version
 * query strings a local `npm test` or a diff never needs to see:
 *
 *   - index.html: appends ?v=<token> to every assets/js/*.js and
 *     assets/css/*.css reference.
 *   - every assets/js/*.js file: appends ?v=<token> to the specifier of
 *     every relative `from './x.js'` import, so the whole module graph
 *     moves to new URLs together, not just the entry point.
 *
 * <token> is the deploying commit's SHA — every deploy's files genuinely
 * differ from the last one's, which is what makes this correct rather than
 * just plausible: two files from the same deploy always carry the same
 * token, so they can never end up mismatched with each other.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITE_DIR = process.argv[2] || '_site';
const TOKEN = process.env.GITHUB_SHA || Date.now().toString(36);

async function bustHtml(path) {
  let html = await readFile(path, 'utf8');
  html = html.replace(
    /((?:src|href)=")(assets\/(?:js|css)\/[^"?]+\.(?:js|css))(")/g,
    (match, pre, url, post) => `${pre}${url}?v=${TOKEN}${post}`
  );
  await writeFile(path, html);
}

async function bustModule(path) {
  let js = await readFile(path, 'utf8');
  js = js.replace(
    /(from\s+['"])(\.\/[^'"?]+\.js)(['"])/g,
    (match, pre, spec, post) => `${pre}${spec}?v=${TOKEN}${post}`
  );
  await writeFile(path, js);
}

await bustHtml(join(SITE_DIR, 'index.html'));

const jsFiles = [
  'app.js', 'calc.js', 'compare.js', 'data.js', 'guidance.js',
  'levers.js', 'state.js', 'proptax.generated.js', 'proptax-adjust.js'
];
for (const file of jsFiles) {
  await bustModule(join(SITE_DIR, 'assets/js', file));
}

console.log(`Cache-busted index.html and ${jsFiles.length} JS modules with ?v=${TOKEN}`);
