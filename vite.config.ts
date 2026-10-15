import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error — plain ESM module, no types
import { relayPlugin } from './relay/relay.mjs';
import { seoPlugin, siteBase } from './seo/seo';

/* In dev the relay (borrowed from the ledger client) proxies guild signup and the guild directory,
 * which send no CORS headers. A build talks to the guild servers directly unless it was built with
 * VITE_RELAY_URL (src/guild/relay.ts). Nothing else here talks to anything but the chain. */
const headers = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };

/* Google Analytics, in builds only: dev servers and QA runs never count as visits. Every built page
 * is cut from index.html (seo/seo.ts), so they all carry it. */
const GA_ID = 'G-6F1P366CQS';
const analyticsPlugin = (): Plugin => ({
  name: 'wyrmhodl-analytics',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'script', attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}` }, injectTo: 'head-prepend' },
    { tag: 'script', children: `window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');`, injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  // Screens live in the path (/hold/, /bestiary/stone-troll), so assets hang from the site's own path:
  // '/' at a domain's root, '/repo/' under a GitHub Pages project site (set VITE_SITE_URL to match).
  base: siteBase(),
  plugins: [relayPlugin(), seoPlugin(), analyticsPlugin()],
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { advancedChunks: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] } } },
  },
  worker: { format: 'es' },
  server: { port: 5191, host: true, cors: false, headers },
  preview: { port: 5191, cors: false, headers },
});
