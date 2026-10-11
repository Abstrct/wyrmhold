export interface Ctx {
  /** The route this screen answers ("#/hold"). */
  route: string;
  /** The part after the route ("#/hold/1-1000" → "1-1000"). */
  param?: string;
  go(path: string): void;
  /** Open the Oath (soulstone, coven, isle); 'words' opens on the soul-words. */
  oath(start?: 'words'): void;
}

export interface Screen {
  el: HTMLElement;
  title?: string;
  enter?(): void;
  leave(): void;
}

/** Mount a WyrmKit scene once its canvas has a size; returns a disposer. */
export function mountScene<T extends { dispose(): void }>(canvas: HTMLCanvasElement, make: (c: HTMLCanvasElement) => T, then?: (c: T) => void) {
  let ctl: T | null = null, dead = false, tries = 0;
  const go = () => {
    if (dead) return;
    if (!canvas.isConnected || !canvas.parentElement?.clientWidth) { if (tries++ < 120) { setTimeout(go, 50); return; } }
    try { ctl = make(canvas); } catch (e) {
      console.error('[wyrmhold] the world would not wake', e);
      // say so, instead of "Waking the isle…" forever: the panels and rites work without the 3D sky
      canvas.parentElement?.classList.add('no-world');
      return;
    }
    canvas.parentElement?.classList.remove('no-world');
    // a handle for the proving ground (qa/): tests read the scene through it, the game never does
    (canvas as unknown as { __wyrmCtl?: T }).__wyrmCtl = ctl;
    try { then?.(ctl); } catch (e) { console.error('[wyrmhold] after the world woke', e); }
  };
  requestAnimationFrame(go);
  return { get: () => ctl, dispose: () => { dead = true; ctl?.dispose(); ctl = null; } };
}
