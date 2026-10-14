import { defineConfig } from 'vite';
// @ts-expect-error — plain ESM module, no types
import { relayPlugin } from './relay/relay.mjs';
import { seoPlugin } from './seo/seo';

/* In dev the relay (borrowed from the ledger client) proxies guild signup and the guild directory,
 * which send no CORS headers. A build talks to the guild servers directly unless it was built with
 * VITE_RELAY_URL (src/guild/relay.ts). Nothing else here talks to anything but the chain. */
const headers = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };

export default defineConfig({
  // Relative, so one build works at a domain's root or under a path (a GitHub Pages project site).
  base: './',
  plugins: [relayPlugin(), seoPlugin()],
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
