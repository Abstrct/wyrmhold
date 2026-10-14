/* How Wyrmhodl shows itself to the open web: search engines, scrapers, AI crawlers and the link
 * cards Twitter/X, Discord, Slack, iMessage and friends draw when someone pastes a URL.
 *
 * Everything is open. Every page in src/pages.ts is built as a real HTML file (/hold/,
 * /bestiary/stone-troll) with its own title, card and words, so each can be found, indexed and
 * shared. The words sit in #app before any script runs; the game replaces them when it boots, and a
 * visitor without JS reads them as a plain page.
 *
 * The site's address is baked in at build time: VITE_SITE_URL, default https://wyrmhodl.com/. Link
 * cards need absolute URLs, and its path is the base every asset and route hangs from. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { NAME, PAGES, type Page, type Part } from '../src/pages';

const REPO = 'https://github.com/Abstrct/wyrmhold';
// Discord paints its embed stripe in the page's theme-color; the game sets the browser's own night colour when it boots.
const CARD_COLOR = '#e8c872';
const HEAD = /<!--seo:head-->[\s\S]*?<!--\/seo:head-->/;
const BODY = /<!--seo:body-->[\s\S]*?<!--\/seo:body-->/;

export function siteUrl(): string {
  const raw = process.env.VITE_SITE_URL || 'https://wyrmhodl.com/';
  return raw.endsWith('/') ? raw : raw + '/';
}
/** The path the site hangs from ('/' at a domain's root): Vite's base. */
export const siteBase = () => new URL(siteUrl()).pathname;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A route from the site's root, as core/nav.ts writes it: a section ends in a slash, a beast does not. */
const rel = (route: string) => { const p = route.replace(/^\/+|\/+$/g, ''); return !p ? '' : p.includes('/') ? p : p + '/'; };
/** Where the build writes a route's page. */
const fileOf = (route: string) => { const p = rel(route); return !p ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p + '.html'; };

function trail(page: Page): Page[] {
  const parts = page.route.split('/').filter(Boolean);
  return [PAGES[0], ...parts.map((_, i) => PAGES.find((p) => p.route === '/' + parts.slice(0, i + 1).join('/'))!).filter(Boolean)];
}

function headHtml(page: Page, opts: { site: string; card: (key: string) => string; lost?: boolean }) {
  const { site } = opts, base = new URL(site).pathname, here = site + rel(page.route), og = opts.card(page.card.key);
  const alt = `${page.card.alt} ${NAME}: ${page.card.tagline.replace(/\n/g, ' ').replace(/([^.!?])$/, '$1.')}`;
  const crumbs = trail(page);
  const ld: object[] = page.route === '/'
    ? [
      { '@context': 'https://schema.org', '@type': 'VideoGame', name: NAME, url: site, description: page.description, image: og,
        genre: ['Strategy', 'Fantasy', 'Massively multiplayer'], gamePlatform: 'Web browser', applicationCategory: 'GameApplication',
        operatingSystem: 'Any (a modern browser with WebGL)', playMode: 'MultiPlayer', isAccessibleForFree: true, inLanguage: 'en',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: [REPO] },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: site, description: page.description },
    ]
    : [
      { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, url: here, description: page.description, image: og, inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: NAME, url: site } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: i ? p.heading : NAME, item: site + rel(p.route) })) },
    ];
  const labels = page.labels || [['Price', 'Free to play'], ['Plays in', 'Your browser']];
  const m = (k: string, v: string, attr = 'name') => `<meta ${attr}="${k}" content="${esc(v)}">`;
  return [
    `<title>${esc(page.title)}</title>`,
    m('description', page.description),
    m('robots', opts.lost ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'),
    opts.lost ? '' : `<link rel="canonical" href="${here}">`,
    m('theme-color', CARD_COLOR), m('color-scheme', 'dark'), m('application-name', NAME), m('apple-mobile-web-app-title', NAME),
    `<link rel="icon" href="${base}favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">`,
    `<link rel="manifest" href="${base}manifest.webmanifest">`,
    // Open Graph: Facebook, Discord, Slack, LinkedIn, iMessage, WhatsApp, Telegram, Signal…
    m('og:type', 'website', 'property'), m('og:site_name', NAME, 'property'), m('og:locale', 'en_US', 'property'),
    m('og:url', here, 'property'), m('og:title', page.title, 'property'), m('og:description', page.description, 'property'),
    m('og:image', og, 'property'), m('og:image:secure_url', og, 'property'), m('og:image:type', 'image/jpeg', 'property'),
    m('og:image:width', '1200', 'property'), m('og:image:height', '630', 'property'), m('og:image:alt', alt, 'property'),
    // Twitter/X's large card; Slack also prints the label/data pairs under its unfurl.
    m('twitter:card', 'summary_large_image'), m('twitter:title', page.title), m('twitter:description', page.description),
    m('twitter:image', og), m('twitter:image:alt', alt),
    ...labels.flatMap(([k, v], i) => [m(`twitter:label${i + 1}`, k), m(`twitter:data${i + 1}`, v)]),
    `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, '\\u003c')}</script>`,
    // Without scripts there is no world to wake: show the page's own words instead of the boot veil.
    '<noscript><style>#boot{display:none}</style></noscript>',
  ].filter(Boolean).join('\n  ');
}

function partHtml(part: Part, href: (route: string) => string) {
  const link = (name: string, to?: string) => (to ? `<a href="${href(to)}">${esc(name)}</a>` : esc(name));
  return [
    part.heading ? `<h2>${esc(part.heading)}</h2>` : '',
    ...(part.paras || []).map((p) => `<p>${esc(p)}</p>`),
    part.items?.length ? `<ul>${part.items.map((i) => `<li>${link(i.name, i.href)}${i.text ? `: ${esc(i.text)}` : ''}</li>`).join('')}</ul>` : '',
    part.terms?.length ? `<dl>${part.terms.map((i) => `<dt>${link(i.name, i.href)}</dt><dd>${esc(i.text || '')}</dd>`).join('')}</dl>` : '',
  ].filter(Boolean).join('\n  ');
}

/** The page's words before the game wakes: what crawlers that never run scripts read, and what a
 * visitor without JS sees. The router clears #app on its first route. */
function bodyHtml(page: Page, site: string) {
  const base = new URL(site).pathname, href = (route: string) => base + rel(route);
  const crumbs = trail(page);
  return `<main class="lander">
  ${crumbs.length > 1 ? `<nav class="lander-trail" aria-label="Where you are">${crumbs.map((p, i) => (i < crumbs.length - 1 ? `<a href="${href(p.route)}">${esc(i ? p.heading : NAME)}</a>` : `<span>${esc(p.heading)}</span>`)).join(' › ')}</nav>` : ''}
  <header><h1>${esc(page.heading)}</h1><p class="lander-tag">${esc(page.lede)}</p></header>
  <noscript><p class="lander-note">${NAME} is drawn live in WebGL and needs JavaScript to play. Turn it on and the sky will wake.</p></noscript>
  ${page.parts.map((p) => partHtml(p, href)).join('\n  ')}
  <footer><p>Free to play in your browser. <a href="${REPO}">The source is open.</a></p></footer>
</main>`;
}

function page(html: string, p: Page, opts: Parameters<typeof headHtml>[1]) {
  return html.replace(HEAD, `<!--seo:head-->\n  ${headHtml(p, opts)}\n  <!--/seo:head-->`).replace(BODY, `<!--seo:body-->${bodyHtml(p, opts.site)}<!--/seo:body-->`);
}

function robots(site: string) {
  return `# Every crawler is welcome: search engines, archivers, scrapers and AI agents alike.
User-agent: *
Allow: /

Sitemap: ${site}sitemap.xml
`;
}

function sitemap(site: string, card: (key: string) => string) {
  const day = new Date().toISOString().slice(0, 10);
  const url = (p: Page) => `  <url>
    <loc>${site}${rel(p.route)}</loc>
    <lastmod>${day}</lastmod>
    <changefreq>${p.route.startsWith('/bestiary/') ? 'monthly' : 'weekly'}</changefreq>
    <priority>${p.route === '/' ? '1.0' : p.route.split('/').length === 2 ? '0.8' : '0.6'}</priority>
    <image:image><image:loc>${card(p.card.key)}</image:loc></image:image>
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${PAGES.map(url).join('\n')}
</urlset>
`;
}

const partMd = (part: Part, site: string) => [
  part.heading ? `### ${part.heading}` : '',
  ...(part.paras || []),
  ...[...(part.items || []), ...(part.terms || [])].map((i) => `- ${i.href ? `[${i.name}](${site}${rel(i.href)})` : `**${i.name}**`}${i.text ? `: ${i.text}` : ''}`),
].filter(Boolean).join('\n\n');

/** llms.txt (llmstxt.org): the game in plain Markdown for AI agents, with every page linked. */
function llms(site: string) {
  const home = PAGES[0], sections = PAGES.filter((p) => p.route.split('/').length === 2), beasts = PAGES.filter((p) => p.route.startsWith('/bestiary/'));
  const line = (p: Page) => `- [${p.heading}](${site}${rel(p.route)}): ${p.description}`;
  return `# ${NAME}

> ${home.description}

${home.parts[0].paras!.join('\n\n')}

Play free at ${site}. It runs in any modern browser with WebGL; there is nothing to install. Every page's words, in full: ${site}llms-full.txt

## Places

${sections.map(line).join('\n')}

## Bestiary

${beasts.map(line).join('\n')}

## For builders

${NAME} is a fantasy-themed browser client for Structs, a strategy game whose world lives on a public ledger. It is drawn in three.js and its source is open: ${REPO}
`;
}

/** Every page's words, in full, one after another. */
function llmsFull(site: string) {
  return `# ${NAME}: every page\n\n` + PAGES.map((p) => `## ${p.heading}\n\n${site}${rel(p.route)}\n\n> ${p.description}\n\n${p.parts.map((x) => partMd(x, site)).join('\n\n')}`).join('\n\n---\n\n') + '\n';
}

export function seoPlugin(): Plugin[] {
  let publicDir = 'public';
  // a page's own card if one was drawn for it (seo/card/), else the Gate's
  const card = (key: string) => siteUrl() + (existsSync(join(publicDir, 'img/og', key + '.jpg')) ? `img/og/${key}.jpg` : 'img/og/home.jpg');
  const files = (site: string): Record<string, [string, string]> => ({
    'robots.txt': [robots(site), 'text/plain; charset=utf-8'],
    'sitemap.xml': [sitemap(site, card), 'application/xml; charset=utf-8'],
    'llms.txt': [llms(site), 'text/plain; charset=utf-8'],
    'llms-full.txt': [llmsFull(site), 'text/plain; charset=utf-8'],
  });
  return [
    {
      name: 'wyrmhodl-seo',
      configResolved(config) { publicDir = config.publicDir; },
      transformIndexHtml: {
        order: 'pre',
        // the Gate's head and words, between markers the build swaps for every other page's
        handler: (html) => page(
          html.replace(/<!-- title, description[^>]*-->/, '<!--seo:head--><!--/seo:head-->').replace('<div id="app"></div>', '<div id="app"><!--seo:body--><!--/seo:body--></div>'),
          PAGES[0], { site: siteUrl(), card }),
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const f = files(siteUrl())[(req.url || '').split('?')[0].replace(/^\//, '')];
          if (!f) return next();
          res.setHeader('content-type', f[1]);
          res.end(f[0]);
        });
      },
    },
    {
      // after Vite has written index.html with its scripts: one page per route, and the shell for the rest
      name: 'wyrmhodl-seo-pages',
      enforce: 'post',
      apply: 'build',
      generateBundle(_, bundle) {
        const shell = bundle['index.html'];
        if (!shell || shell.type !== 'asset') throw new Error('wyrmhodl-seo: no index.html in the bundle');
        const html = String(shell.source), site = siteUrl();
        for (const p of PAGES.slice(1)) this.emitFile({ type: 'asset', fileName: fileOf(p.route), source: page(html, p, { site, card }) });
        // GitHub Pages answers any address it has no page for with 404.html: the game boots and finds its way
        this.emitFile({ type: 'asset', fileName: '404.html', source: page(html, PAGES[0], { site, card, lost: true }) });
        for (const [fileName, [source]] of Object.entries(files(site))) this.emitFile({ type: 'asset', fileName, source });
      },
    },
  ];
}
