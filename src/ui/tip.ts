/* A name that follows the cursor over the 3D world, so the isle says what each thing is before
 * you click it. Mouse only: touch has no hover, and a tap selects anyway. */
import { h } from '../core/dom';

export function cursorTip(host: HTMLElement) {
  const el = h('div', { class: 'cursor-tip', role: 'tooltip', hidden: true });
  document.body.append(el);
  let x = 0, y = 0;
  const place = () => { el.style.left = `${Math.min(window.innerWidth - el.offsetWidth - 8, x + 16)}px`; el.style.top = `${y + 18}px`; };
  const mv = (e: PointerEvent) => { x = e.clientX; y = e.clientY; if (!el.hidden) place(); };
  host.addEventListener('pointermove', mv);
  return {
    show(text: string | null, sub?: string) {
      if (!text) { el.hidden = true; return; }
      el.textContent = '';
      el.append(h('b', null, text), sub ? h('span', null, sub) : '');
      el.hidden = false; place();
    },
    dispose() { host.removeEventListener('pointermove', mv); el.remove(); },
  };
}
