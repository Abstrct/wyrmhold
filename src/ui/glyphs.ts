/* Glyphs: the realm's own small marks, drawn as engraved strokes on a 24-unit grid so they
 * sit beside the IM Fell type. Each takes `currentColor`, so a rite's colour carries over. */

const G: Record<string, string> = {
  // rites
  summon: 'M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19M12 6l1.6 4.4L18 12l-4.4 1.6L12 18l-1.6-4.4L6 12l4.4-1.6z',
  seek: 'M3 11.5h18l-2.5 3.5h-13zM6.5 15l2 4.5M12 15v6M17.5 15l-2 4.5M9 11.5l1.5-3 2 1.5 2.5-4 3 5.5M18.5 3.5v3M17 5h3',
  ride: 'M3 13c3.5-.5 6-2.5 8-6 1 3 3.5 5 8 5.5-2 1-4.5 1.5-7 1.2L9 17l.8-3.4C7.5 13.8 5 13.6 3 13zM14 7.5l3.5-3.5M16.5 9l4-2.5',
  home: 'M4 20V10.5L12 4l8 6.5V20M9.5 20v-5.5h5V20M2.5 11.8L12 4M21.5 11.8L12 4',
  skirmish: 'M4 4l9.5 9.5M4 4h4M4 4v4M20 4l-9.5 9.5M20 4h-4M20 4v4M7.5 14.5l2 2M14.5 16.5l2-2M9.5 16.5L6 20M14.5 16.5L18 20',
  bestiary: 'M4 6.5c2.5-1.5 5.5-1.5 8 .5 2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5zM12 7v12.5M7 11.5c.8-.9 2-.9 2.8 0M14.2 11.5c.8-.9 2-.9 2.8 0',
  raid: 'M12 21c-3.5 0-6-2.4-6-5.6 0-3.2 2.6-4.6 3.2-7.9 1.5 1.1 2.2 2.6 2.2 4 1-1.4 1.5-3.6 1-6.5 3.6 2 5.6 5.6 5.6 9.6 0 3.6-2.6 6.4-6 6.4zM12 21c-1.4 0-2.5-1.1-2.5-2.6 0-1.8 1.6-2.4 2.3-4.2 1.3 1 2.7 2.4 2.7 4.2 0 1.5-1.1 2.6-2.5 2.6z',
  atlas: 'M5 5.5l5 2.5 4.5-3.5 4.5 3.5M10 8l2 7.5 6.5 2.5M12 15.5L6 18M5 5.5L6 18M18.5 18l.5-10M4.2 4.7l1.6 1.6M18.2 7.2l1.6 1.6M11.2 14.7l1.6 1.6',
  oath: 'M12 2.5l6.5 6.5L12 21.5 5.5 9zM5.5 9h13M9 9l3 12.5L15 9M9 9l3-6.5L15 9',
  // meters
  alpha: 'M12 3c3.2 4.3 5.5 7.4 5.5 10.6A5.5 5.5 0 0 1 12 19.1a5.5 5.5 0 0 1-5.5-5.5C6.5 10.4 8.8 7.3 12 3zM10 14.5a2 2 0 0 0 2 2',
  wildroot: 'M12 3v8M12 11c-3 1-4.5 3-5 6.5M12 11c3 1 4.5 3 5 6.5M12 11v9.5M7 17.5l-2 3M17 17.5l2 3M9.5 6.5L12 9l2.5-2.5',
  mana: 'M3 9c3-3 6 3 9 0s6 3 9 0M3 14.5c3-3 6 3 9 0s6 3 9 0M7 19.5c1.7-1.5 3.3 1.5 5 0s3.3 1.5 5 0',
  breath: 'M3 9h11a3 3 0 1 0-3-3M3 13.5h15a3 3 0 1 1-3 3M3 18h6',
  ward: 'M12 2.8l8 3.2v5.5c0 4.8-3.4 8.5-8 9.7-4.6-1.2-8-4.9-8-9.7V6zM12 7.5v8M8.5 11.5h7',
  // realms
  skies: 'M4.5 18.5C8 12 13 7.5 20 4.5c-1.2 6.5-5.8 11.4-12.4 13.6M8 15.5l2.5 2.5M11 12.5l2.6 2.4M14 9.5l2.4 2.3',
  starfall: 'M14 3l1.2 3.6 3.8.1-3 2.3 1.1 3.6L14 10.4l-3.1 2.2 1.1-3.6-3-2.3 3.8-.1zM9 13L3.5 20.5M11.5 15.5l-4 5',
  wilds: 'M12 21v-5M12 16c-4.5 0-7-2.6-7-6.2C5 6 8.2 3 12 3s7 3 7 6.8C19 13.4 16.5 16 12 16zM12 16V9.5M12 12l-2.8-2.2M12 10.5l2.6-2.4',
  deeps: 'M2.5 8.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 4.6-2.2 4.6-2.2M2.5 13.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 4.6-2.2 4.6-2.2M2.5 18.5c2.4-2.2 4.8-2.2 7.2 0s4.8 2.2 7.2 0 4.6-2.2 4.6-2.2',
  hallow: 'M5 21V11l7-7.5 7 7.5v10M5 21h14M9.5 21v-5a2.5 2.5 0 0 1 5 0v5M12 3.5V1.5',
};

/** An inline glyph, `currentColor` stroked. Decorative unless given a label. */
export function glyph(name: keyof typeof G | string, size = 22, label?: string) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'glyph');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', G[name] || G.summon); svg.append(p);
  return svg;
}
