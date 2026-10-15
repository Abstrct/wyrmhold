/* Frosted glass over a moving sky. Where the browser composites on the GPU the blur behind the panels is all but
 * free; where it composites in software (Firefox on a blocklisted GPU driver, in a VM, on some Linux desktops, and
 * headless) it blurs the moving sky again behind every panel, every frame, and the whole sky crawls: the Gate fell
 * from 60 frames a second to 7 in Firefox, and came back to 60 with the blur off. So once a sky is awake, watch a
 * moment of frames. If they crawl, clear the glass and look again: frames that come back keep it clear for the
 * rest of the visit; frames that don't were slow for another reason, and the glass is frosted again. */

const SLOW_MS = 40;        // a median frame slower than this (under 25 a second) is a crawl
let judged = false;
let judging = false;

/** The median frame time over a second or so (longer when frames are few: a crawl at 3 a second still gives six),
 *  or null if the page was hidden meanwhile (frames stop then). */
function sample(ms = 1200, most = 5000): Promise<number | null> {
  return new Promise((res) => {
    const ts: number[] = [];
    let last = 0, done = false;
    const t0 = performance.now();
    const give = () => {
      if (done) return;
      done = true;
      if (document.visibilityState !== 'visible' || ts.length < 3) return res(null);
      ts.sort((a, b) => a - b);
      res(ts[ts.length >> 1]);
    };
    const f = (now: number) => {
      if (done) return;
      if (last) ts.push(now - last);
      last = now;
      const t = now - t0;
      if (t < most && (t < ms || ts.length < 6) && ts.length < 60) requestAnimationFrame(f); else give();
    };
    requestAnimationFrame(f);
    setTimeout(give, most + 2000);   // frames that stopped altogether
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Look at the frames now; clear the glass if that is what makes them crawl. Also called by the proving ground. */
export async function judge(): Promise<{ before: number | null; after?: number | null; glass: 'frosted' | 'clear' }> {
  const root = document.documentElement;
  const before = await sample();
  if (before == null || before <= SLOW_MS) return { before, glass: root.classList.contains('clear-glass') ? 'clear' : 'frosted' };
  root.classList.add('clear-glass');
  await wait(400);
  const after = await sample();
  const helped = after != null && after < before / 1.5;
  if (!helped) root.classList.remove('clear-glass');
  console.info(`[wyrmhold] the sky crawled (${before.toFixed(0)} ms a frame) under frosted glass; clear, it ran at ${after == null ? '?' : after.toFixed(0)} ms: ${helped ? 'kept clear' : 'frosted again'}`);
  return { before, after, glass: helped ? 'clear' : 'frosted' };
}

/** Judge once per visit, a second after the first sky wakes (its shaders have settled by then). */
export function watchFrames() {
  const look = async () => {
    if (judged || judging) return;
    if (!document.querySelector('#app canvas.awake') || document.visibilityState !== 'visible') return;
    judging = true;
    await wait(1000);
    const r = await judge().catch(() => null);
    judging = false;
    if (r && r.before != null) judged = true;   // a hidden page judged nothing: try again on a later sky
  };
  const timer = setInterval(() => { if (judged) clearInterval(timer); else void look(); }, 1500);
}
