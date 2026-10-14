# The link card and icons

`public/img/og.jpg` (1200×630) is what Twitter/X, Discord, Slack, iMessage and the rest show when the
URL is pasted. It is the Gate's live 3D world, framed by `card.html`.

1. **The world.** `gate-raw.jpg` is a 2400×1260 frame from the dev capture hook in `src/world/look.js`:
   with `pnpm dev` open on the Gate and a sink listening on 127.0.0.1:5199, run
   `window.postMessage({ __cap: 'gate-raw', w: 2400, h: 1260 }, '*')` in the page.
2. **The card.** Render `card.html` to exactly 1200×630, then save it as a JPEG (keep it under ~1 MB):

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
     --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=8000 \
     --screenshot=$PWD/card.png file://$PWD/card.html
   sips -s format jpeg -s formatOptions 88 card.png --out ../../public/img/og.jpg
   ```

3. **The icons.** Render `icon.html` at 512×512 the same way, then `sips -z` it down to
   `img/icon-192.png`, `apple-touch-icon.png` (180) and the 16/32/48 PNGs packed into `favicon.ico`.

Link previews are cached hard. After changing the card, rename the file (or add `?v=2` in `seo/seo.ts`)
so Discord and Slack fetch it again, and re-scrape on Facebook's Sharing Debugger and LinkedIn's Post Inspector.
