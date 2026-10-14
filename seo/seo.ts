/* How Wyrmhodl shows itself to the open web: search engines, scrapers, AI crawlers and the link
 * cards Twitter/X, Discord, Slack, iMessage and friends draw when someone pastes the URL.
 *
 * Everything is open. The page carries its own words before any script runs (the game replaces
 * them when it boots; a visitor without JS reads them as a plain page), and every crawler is welcome.
 *
 * The site's address is baked in at build time: VITE_SITE_URL, default https://wyrmhodl.com/.
 * Link cards need absolute URLs, so a build served elsewhere should set it. */
import type { Plugin } from 'vite';
import { BEASTS } from '../src/lore';
import { typeOf } from '../src/data/catalogue';

const NAME = 'Wyrmhodl';
const TAGLINE = 'Bind beasts. Brew alpha. Hold the broken sky.';
const TITLE = `${NAME} — Bind beasts, brew alpha, hold the broken sky`;
const DESCRIPTION = 'A free multiplayer browser game of floating isles above a sea of cloud. Hatch your Elder Wyrm, summon beasts, brew alpha and raid rival wardens.';
const OG_ALT = 'A floating isle with a castle and a waterfall above a sea of cloud at dusk, an Elder Wyrm in flight. Wyrmhodl: bind beasts, brew alpha, hold the broken sky.';
const REPO = 'https://github.com/Abstrct/wyrmhold';
// Discord paints its embed stripe in the page's theme-color; the game sets the browser's own night colour when it boots.
const CARD_COLOR = '#e8c872';
const NIGHT = '#0b0e1a';

const PLACES: [string, string, string][] = [
  ['#/', 'The Gate', 'the tale, the oath, and the wardens abroad'],
  ['#/hold', 'The Hold', 'your isle, your beasts and hallows, your rites and chants'],
  ['#/bestiary', 'Bestiary', 'every beast and hallow on the summoning dais'],
  ['#/atlas', 'Sky Atlas', 'every warden’s isle, around their coven’s crystal'],
  ['#/leyweave', 'Leyweave', 'the wellsprings, your shrine, your tithes'],
  ['#/skirmish', 'Skirmish', 'ride out, mark, unleash, plunder'],
  ['#/grimoire', 'Grimoire', 'the old tale, the rites, the laws of war'],
];

const TALE = [
  'When the sky broke, alpha fell like rain.',
  'Wyrmhodl is a sky-realm of floating isles above a sea of cloud. Bind a soulstone, swear to a coven, seek your isle and hatch your Elder Wyrm. Delve wildroot from your isle’s marrow and brew it into alpha, the first light: it wakes your springs, calls beasts out of the circle, and once brewed can never be stolen. Then read the sky, ride out, and take what other wardens leave unbrewed.',
  'Every warden you meet is a real person, and every rite you speak is sealed with your own soulstone and written into the ledger. Your soulstone stays sealed in your browser.',
];

const entries = Object.entries(BEASTS).map(([id, l]) => ({ ...l, hallow: typeOf(Number(id))?.category === 'planet' }));
const beasts = entries.filter((e) => !e.hallow);
const hallows = entries.filter((e) => e.hallow);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function siteUrl(): string {
  const raw = process.env.VITE_SITE_URL || 'https://wyrmhodl.com/';
  return raw.endsWith('/') ? raw : raw + '/';
}

function headTags(site: string) {
  const og = site + 'img/og.jpg';
  const meta = (attrs: Record<string, string>) => ({ tag: 'meta', attrs, injectTo: 'head' as const });
  const link = (attrs: Record<string, string>) => ({ tag: 'link', attrs, injectTo: 'head' as const });
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'VideoGame', name: NAME, url: site, description: DESCRIPTION,
      image: og, genre: ['Strategy', 'Fantasy', 'Massively multiplayer'], gamePlatform: 'Web browser',
      applicationCategory: 'GameApplication', operatingSystem: 'Any (a modern browser with WebGL)',
      playMode: 'MultiPlayer', isAccessibleForFree: true, inLanguage: 'en',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: [REPO],
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: site, description: DESCRIPTION },
  ];
  return [
    { tag: 'title', children: TITLE, injectTo: 'head' as const },
    meta({ name: 'description', content: DESCRIPTION }),
    meta({ name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }),
    link({ rel: 'canonical', href: site }),
    meta({ name: 'theme-color', content: CARD_COLOR }),
    meta({ name: 'color-scheme', content: 'dark' }),
    meta({ name: 'application-name', content: NAME }),
    meta({ name: 'apple-mobile-web-app-title', content: NAME }),
    link({ rel: 'icon', href: './favicon.ico', sizes: '48x48' }),
    link({ rel: 'icon', href: './favicon.svg', type: 'image/svg+xml' }),
    link({ rel: 'apple-touch-icon', href: './apple-touch-icon.png' }),
    link({ rel: 'manifest', href: './manifest.webmanifest' }),
    // Open Graph: Facebook, Discord, Slack, LinkedIn, iMessage, WhatsApp, Telegram, Signal…
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: NAME }),
    meta({ property: 'og:locale', content: 'en_US' }),
    meta({ property: 'og:url', content: site }),
    meta({ property: 'og:title', content: TITLE }),
    meta({ property: 'og:description', content: DESCRIPTION }),
    meta({ property: 'og:image', content: og }),
    meta({ property: 'og:image:secure_url', content: og }),
    meta({ property: 'og:image:type', content: 'image/jpeg' }),
    meta({ property: 'og:image:width', content: '1200' }),
    meta({ property: 'og:image:height', content: '630' }),
    meta({ property: 'og:image:alt', content: OG_ALT }),
    // Twitter/X's large card; Slack also shows the label/data pairs under its unfurl.
    meta({ name: 'twitter:card', content: 'summary_large_image' }),
    meta({ name: 'twitter:title', content: TITLE }),
    meta({ name: 'twitter:description', content: DESCRIPTION }),
    meta({ name: 'twitter:image', content: og }),
    meta({ name: 'twitter:image:alt', content: OG_ALT }),
    meta({ name: 'twitter:label1', content: 'Price' }),
    meta({ name: 'twitter:data1', content: 'Free to play' }),
    meta({ name: 'twitter:label2', content: 'Plays in' }),
    meta({ name: 'twitter:data2', content: 'Your browser' }),
    { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(ld).replace(/</g, '\\u003c'), injectTo: 'head' as const },
    // Without scripts there is no world to wake: show the page's own words instead of the boot veil.
    { tag: 'noscript', children: '<style>#boot{display:none}</style>', injectTo: 'head' as const },
  ];
}

/** The page's words before the game wakes: what crawlers that don't run scripts read, and what a
 * visitor without JS sees. The router clears #app on its first route. */
function lander(): string {
  const dl = (list: typeof entries) => list.map((e) => `<dt>${esc(e.name)}${e.epithet ? ` <i>· ${esc(e.epithet)}</i>` : ''}</dt><dd>${esc(e.tale)}</dd>`).join('');
  return `<main class="lander">
  <header><h1>${NAME}</h1><p class="lander-tag">${esc(TAGLINE)}</p></header>
  ${TALE.map((p, i) => `<p${i === 0 ? ' class="lander-lede"' : ''}>${esc(p)}</p>`).join('\n  ')}
  <noscript><p class="lander-note">Wyrmhodl is drawn live in WebGL and needs JavaScript to play. Turn it on and the sky will wake.</p></noscript>
  <h2>Where the sky takes you</h2>
  <ul>${PLACES.map(([href, name, what]) => `<li><a href="${href}">${esc(name)}</a>: ${esc(what)}</li>`).join('')}</ul>
  <h2>The Bestiary</h2>
  <h3>Beasts</h3><dl>${dl(beasts)}</dl>
  <h3>Hallows</h3><dl>${dl(hallows)}</dl>
  <footer><p>Free to play in your browser. <a href="${REPO}">The source is open.</a></p></footer>
</main>`;
}

function robots(site: string) {
  return `# Every crawler is welcome: search engines, archivers, scrapers and AI agents alike.
User-agent: *
Allow: /

Sitemap: ${site}sitemap.xml
`;
}

function sitemap(site: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${site}</loc>
    <lastmod>${day}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <image:image><image:loc>${site}img/og.jpg</image:loc></image:image>
  </url>
</urlset>
`;
}

/** llms.txt (llmstxt.org): the game in plain Markdown, for AI agents and anyone else reading by machine. */
function llms(site: string) {
  const list = (l: typeof entries) => l.map((e) => `- **${e.name}**${e.epithet ? ` (${e.epithet})` : ''}: ${e.tale}`).join('\n');
  return `# ${NAME}

> ${DESCRIPTION}

${TALE.join('\n\n')}

Play free at ${site}. It runs in any modern browser with WebGL; there is nothing to install.

## Where the sky takes you

${PLACES.map(([href, name, what]) => `- [${name}](${site}${href}): ${what}`).join('\n')}

## Beasts

${list(beasts)}

## Hallows

${list(hallows)}

## For builders

Wyrmhodl is a fantasy-themed browser client for Structs, a strategy game whose world lives on a public ledger. It is drawn in three.js and its source is open: ${REPO}
`;
}

function manifest() {
  return JSON.stringify({
    name: NAME, short_name: NAME, description: DESCRIPTION, start_url: './', scope: './', display: 'fullscreen',
    orientation: 'any', background_color: NIGHT, theme_color: NIGHT, categories: ['games', 'entertainment'], lang: 'en',
    icons: [
      { src: 'img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';
}

export function seoPlugin(): Plugin {
  const files = (site: string): Record<string, [string, string]> => ({
    'robots.txt': [robots(site), 'text/plain; charset=utf-8'],
    'sitemap.xml': [sitemap(site), 'application/xml; charset=utf-8'],
    'llms.txt': [llms(site), 'text/plain; charset=utf-8'],
    'manifest.webmanifest': [manifest(), 'application/manifest+json; charset=utf-8'],
  });
  return {
    name: 'wyrmhodl-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return { html: html.replace(/<div id="app"><\/div>/, `<div id="app">${lander()}</div>`), tags: headTags(siteUrl()) };
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const f = files(siteUrl())[(req.url || '').split('?')[0].replace(/^\//, '')];
        if (!f) return next();
        res.setHeader('content-type', f[1]);
        res.end(f[0]);
      });
    },
    generateBundle() {
      for (const [fileName, [source]] of Object.entries(files(siteUrl()))) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
