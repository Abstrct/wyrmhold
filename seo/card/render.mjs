/* Draws every page's link card (public/img/og/<key>.jpg, 1200×630) from its scene in scenes/ and
 * the words in src/pages.ts, through headless Chrome.
 *
 *   node seo/card/render.mjs            # every card
 *   node seo/card/render.mjs hold       # only the cards whose key contains "hold"
 *
 * Scenes are frames from the dev capture hook (README.md); a page with no scene of its own borrows
 * the Gate's. CHROME names the browser if it is not in the usual place. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = fileURLToPath(new URL('../../public/img/og/', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { module: { PAGES } } = await runnerImport(fileURLToPath(new URL('../../src/pages.ts', import.meta.url)));

/** Where each scene sits behind the words: its width and offset on the 1200-wide card. A scene with
 * its subject in the middle slides right, so the words have open sky. */
const FRAME = {
  home: { w: 1380, x: 0, y: -30 },
  grimoire: { w: 1380, x: 0, y: -30 },
  hold: { w: 1320, x: 150, y: -40 },
  bestiary: { w: 1300, x: 170, y: -60 },
};
const SCENE = { grimoire: 'home' };
const FOOT = { home: 'Free to play|in your browser|every warden a real player' };

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let drawn = 0;
for (const p of PAGES) {
  const { key, eyebrow, heading, tagline } = p.card;
  if (only && !key.includes(only)) continue;
  const scene = existsSync(`${HERE}scenes/${key}.jpg`) ? key : SCENE[key] || 'home';
  const f = FRAME[key] || { w: 1200, x: 0, y: 0 };
  const q = new URLSearchParams({ scene: `scenes/${scene}.jpg`, eyebrow, title: heading, tag: tagline.replace(/\n/g, '|'), foot: FOOT[key] || 'Free to play|in your browser|wyrmhodl.com', w: f.w, x: f.x, y: f.y });
  const png = `${OUT}${key}.png`;
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
    '--virtual-time-budget=8000', `--screenshot=${png}`, `${pathToFileURL(HERE + 'card.html')}?${q}`], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', png, '--out', `${OUT}${key}.jpg`], { stdio: 'ignore' });
  rmSync(png);
  drawn++;
  console.log(`${key}.jpg  ←  scenes/${scene}.jpg`);
}
console.log(`${drawn} card(s) in public/img/og/`);
