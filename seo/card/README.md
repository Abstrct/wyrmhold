# The link cards and icons

Every page in `src/pages.ts` has a 1200×630 card, `public/img/og/<key>.jpg`. Twitter/X, Discord, Slack,
iMessage and the rest show it when that page's URL is pasted. A card is a frame of the live 3D world
(`scenes/<key>.jpg`) with the page's words drawn over it by `card.html`.

## Redraw the cards (after changing a page's words)

```bash
node seo/card/render.mjs          # every card
node seo/card/render.mjs beast    # only keys containing "beast"
```

This needs Google Chrome; set `CHROME` to point at it if it isn't in the usual place. A page with no
scene of its own borrows the Gate's (`scenes/home.jpg`). To move a scene behind the words, edit `FRAME`
in `render.mjs`.

## Capture a new scene

Scenes come from the dev capture hook in `src/world/look.js`. Run `pnpm dev`, keep the Browser pane
visible (scenes only build while frames run), and listen on 127.0.0.1:5199 with a small sink that saves
each POSTed data URL as a JPEG. Then, in the page:

```js
// a screen as it stands
(await import('/src/core/nav.ts')).go('/leyweave');
window.postMessage({ __cap: 'leyweave', w: 2400, h: 1260 }, '*');
// a beast on the Bestiary dais, with the camera turning with the dais (cam.rel): front on,
// fitted to the beast, and panned so the beast stands right of the words
window.postMessage({ __cap: 'beast-kraken', w: 2400, h: 1260, cam: { pos: [x, y, z], look: [x, y, z], rel: true } }, '*');
```

Before capturing the Skirmish, hide the "Your hold" and "Their hold" nameplates: they are sprites with a
1024×256 canvas texture and `renderOrder` 20. Save the frame here at 1400 wide (`sips -Z 1400`), then
redraw the cards.

## Icons

Render `icon.html` at 512×512 with headless Chrome, then use `sips -z` to make `img/icon-192.png`,
`apple-touch-icon.png` (180) and the 16, 32 and 48 px PNGs that make up `favicon.ico`.

## Caches

Link previews are cached hard. After you redraw a card, give its file a new name (or add `?v=2` in
`seo/seo.ts`) so Discord and Slack fetch it again. Facebook's Sharing Debugger and LinkedIn's Post
Inspector can re-scrape a page.
