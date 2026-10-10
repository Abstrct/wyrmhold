// @ts-nocheck
/* The Look — how Wyrmhold's sky is lit. One stage per scene: an HDR pass chain (bloom, grade,
 * grain), a painted sky with its own sun, an opaque sea of lit cloud, banks of cumulus that
 * stand between the isles, and the shared stylised material every rock, leaf and scale wears
 * (wrapped light, a rim from the key, wind in the leaves). Each scene picks a mood from MOODS. */
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export var TAU = Math.PI * 2;

/* ------------------------------------------------------------------ utils */
export function rng(seed) {
  var s = (seed >>> 0) || 1;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
export function hashStr(str) {
  var h = 2166136261;
  str = String(str);
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function makeNoise(seed) {
  var r = rng(seed), p = new Float32Array(256), perm = new Uint8Array(512), i;
  for (i = 0; i < 256; i++) { p[i] = r(); perm[i] = i; }
  for (i = 255; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
  for (i = 0; i < 256; i++) perm[i + 256] = perm[i];
  function lat(ix, iy) { return p[perm[(ix & 255) + perm[iy & 255]]]; }
  function sm(t) { return t * t * (3 - 2 * t); }
  function n(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
    var u = sm(fx), v = sm(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function (x, y, oct) {
    oct = oct || 4;
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var o = 0; o < oct; o++) { s += amp * n(x * f, y * f); norm += amp; f *= 2.03; amp *= 0.5; }
    return s / norm;
  };
}
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, k) { return a + (b - a) * k; }
export function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/* ------------------------------------------------------------- the moods */
/* Each scene's light. sun: direction (world), colour and strength; sky: four bands; sea: the
 * cloud-sea's lit and shaded colours and its gaps; fog: the colour distance turns to. */
export var MOODS = {
  gate: {
    sunDir: [0.3, 0.15, -0.94], sun: 0xffc98a, sunI: 3.6, sunSize: 0.9994, glow: 0.8,
    zenith: 0x0a0f2e, upper: 0x1d2a66, lower: 0x9a5a8e, horizon: 0xffb072, below: 0x6a4a7e,
    cirrus: 0.55, stars: 0.6, aurora: 0.0,
    seaLit: 0xffd3b4, seaShade: 0x5a4886, seaDeep: 0x231c48, seaY: -48,
    fog: 0x7a5a8e, fogD: 0.0042, hemiSky: 0x8f9cff, hemiGround: 0x3d2a4a, hemiI: 0.95,
    rim: 0xffc98a, rimI: 1.1, fill: 0x6f8cff, fillI: 0.4,
    bloom: 0.55, bloomR: 0.45, bloomT: 0.92, exposure: 0.95,
    grade: { shadow: [0.36, 0.40, 0.62], high: [1.0, 0.86, 0.66], split: 0.16, sat: 1.08, contrast: 1.06, vig: 0.42 }
  },
  hold: {
    sunDir: [0.55, 0.22, -0.8], sun: 0xffbd8a, sunI: 3.0, sunSize: 0.9995, glow: 0.9,
    zenith: 0x070b24, upper: 0x18245a, lower: 0x6a4a8a, horizon: 0xf09a7a, below: 0x4a3a72,
    cirrus: 0.45, stars: 0.8, aurora: 0.25,
    seaLit: 0xe8b4c2, seaShade: 0x262a6e, seaDeep: 0x0c0e2c, seaY: -46, mottle: 0.36,
    fog: 0x5e4f8e, fogD: 0.0046, hemiSky: 0x93a2ff, hemiGround: 0x35284a, hemiI: 1.15,
    rim: 0xffc29a, rimI: 0.85, fill: 0x7a8cff, fillI: 0.6,
    bloom: 0.7, bloomR: 0.5, bloomT: 0.84, exposure: 1.02,
    grade: { shadow: [0.3, 0.36, 0.7], high: [1.0, 0.86, 0.68], split: 0.2, sat: 1.14, contrast: 1.1, vig: 0.44 }
  },
  circle: {
    sunDir: [-0.4, 0.5, -0.75], sun: 0xbfc8ff, sunI: 1.6, sunSize: 0.9996, glow: 0.55,
    zenith: 0x04050f, upper: 0x0f0f30, lower: 0x2a1f5e, horizon: 0x5a3a86, below: 0x1e1840,
    cirrus: 0.25, stars: 1.3, aurora: 1.1, auroraY: 40, aurora1: 0x45f0c0, aurora2: 0x9a6bff,
    seaLit: 0x9a8ad8, seaShade: 0x2a2660, seaDeep: 0x0d0c24, seaY: -34,
    fog: 0x221c4a, fogD: 0.007, hemiSky: 0x7a7aff, hemiGround: 0x22183a, hemiI: 0.75,
    rim: 0x8fe8ff, rimI: 0.6, fill: 0x9a6bff, fillI: 0.5,
    bloom: 0.7, bloomR: 0.55, bloomT: 0.86, exposure: 1.05,
    grade: { shadow: [0.32, 0.36, 0.7], high: [1.0, 0.9, 0.74], split: 0.14, sat: 1.1, contrast: 1.08, vig: 0.5 }
  },
  atlas: {
    sunDir: [0.3, 0.62, -0.72], sun: 0xd8dcff, sunI: 3.2, sunSize: 0.9997, glow: 0.45,
    zenith: 0x02030b, upper: 0x080a22, lower: 0x1a1648, horizon: 0x3a2a72, below: 0x0c0b22,
    cirrus: 0.15, stars: 1.6, aurora: 0.7, aurora1: 0x5fd3b5, aurora2: 0x9a6bff, nebula: 1.0,
    seaLit: 0x4c4a94, seaShade: 0x15133a, seaDeep: 0x06061a, seaY: -120, mottle: 0.4,
    fog: 0x120f30, fogD: 0.0014, hemiSky: 0x9a9aff, hemiGround: 0x2a2048, hemiI: 1.7,
    rim: 0xa8c8ff, rimI: 1.0, fill: 0x9a6bff, fillI: 0.5,
    bloom: 0.95, bloomR: 0.65, bloomT: 0.7, exposure: 1.08,
    grade: { shadow: [0.3, 0.34, 0.7], high: [1.0, 0.9, 0.76], split: 0.12, sat: 1.1, contrast: 1.08, vig: 0.5 }
  },
  skirmish: {
    sunDir: [0.05, 0.11, -1.0], sun: 0xff9a5a, sunI: 3.6, sunSize: 0.9990, glow: 1.25,
    zenith: 0x120a26, upper: 0x3a1a4a, lower: 0xa0405a, horizon: 0xff8a4a, below: 0x6a2a48,
    cirrus: 0.7, stars: 0.35, aurora: 0.0,
    seaLit: 0xffb08a, seaShade: 0x5a2a5a, seaDeep: 0x2a0f2a, seaY: -40,
    fog: 0x8a4058, fogD: 0.0045, hemiSky: 0xff9a8a, hemiGround: 0x3a1a2a, hemiI: 0.95,
    rim: 0xffa060, rimI: 1.1, fill: 0x7a6aff, fillI: 0.45,
    bloom: 0.85, bloomR: 0.55, bloomT: 0.8, exposure: 1.0,
    grade: { shadow: [0.42, 0.32, 0.56], high: [1.0, 0.82, 0.62], split: 0.18, sat: 1.1, contrast: 1.08, vig: 0.46 }
  },
  leyweave: {
    sunDir: [-0.2, 0.6, -0.78], sun: 0xc8f2ff, sunI: 2.3, sunSize: 0.9996, glow: 0.5,
    zenith: 0x02040c, upper: 0x071426, lower: 0x123048, horizon: 0x2a6274, below: 0x0a1a2a,
    cirrus: 0.2, stars: 1.5, aurora: 1.05, auroraY: 30, aurora1: 0x5fd3b5, aurora2: 0xe8c872,
    seaLit: 0x5f9eac, seaShade: 0x10283f, seaDeep: 0x040b14, seaY: -32, mottle: 0.36,
    fog: 0x123448, fogD: 0.0042, hemiSky: 0x7ad8ff, hemiGround: 0x12202e, hemiI: 1.0,
    rim: 0x8ff0ff, rimI: 1.0, fill: 0xe8c872, fillI: 0.35,
    bloom: 0.95, bloomR: 0.6, bloomT: 0.74, exposure: 1.05,
    grade: { shadow: [0.26, 0.38, 0.62], high: [1.0, 0.9, 0.74], split: 0.18, sat: 1.12, contrast: 1.12, vig: 0.52 }
  }
};
export function mood(name, over) {
  var m = Object.assign({}, MOODS[name] || MOODS.gate, over || {});
  m.sunV = new T.Vector3().fromArray(m.sunDir).normalize();
  return m;
}

/* Phones and small windows get the light tier: lower resolution, smaller shadows, thinner meadows. */
export function lightTier() { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (window.innerWidth || 1200) < 760; }

/* ------------------------------------------------- shared uniforms (one live stage at a time) */
export var U = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uRim: { value: new T.Color(0xffc98a) },
  uRimI: { value: 0.9 },
  uKeyView: { value: new T.Vector3(0, 0, 1) }
};

/* ----------------------------------------------------------- materials */
/* The stylised standard: a rim lit from the key light's side, and (o.sway) wind that bends
 * the upper part of a mesh, phased by where its instance stands. */
function patchStd(mat, o) {
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.uniforms.uRim = U.uRim; sh.uniforms.uRimI = U.uRimI; sh.uniforms.uKeyView = U.uKeyView;
    sh.uniforms.uRimMul = { value: o.rim == null ? 1 : o.rim };
    sh.uniforms.uSway = { value: o.sway || 0 };
    if (o.grain) {
      sh.uniforms.uGrainScale = { value: o.grain.scale || 1 };
      sh.uniforms.uGrainAmt = { value: o.grain.amt == null ? 0.2 : o.grain.amt };
      sh.vertexShader = 'varying vec3 vGrainP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrainP = position;');
      sh.fragmentShader = [
        'varying vec3 vGrainP; uniform float uGrainScale; uniform float uGrainAmt;',
        'float gh3(vec3 p){ return fract(sin(dot(p, vec3(91.7, 237.3, 157.1))) * 43758.5453); }',
        'float gn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(mix(gh3(i), gh3(i + vec3(1,0,0)), f.x), mix(gh3(i + vec3(0,1,0)), gh3(i + vec3(1,1,0)), f.x), f.y),',
        '             mix(mix(gh3(i + vec3(0,0,1)), gh3(i + vec3(1,0,1)), f.x), mix(gh3(i + vec3(0,1,1)), gh3(i + vec3(1,1,1)), f.x), f.y), f.z); }',
        ''
      ].join('\n') + sh.fragmentShader.replace('#include <color_fragment>', [
        '#include <color_fragment>',
        '{',
        '  vec3 gp = vGrainP * uGrainScale;',
        '  float gn = gn3(gp) * 0.55 + gn3(gp * 2.7 + 5.1) * 0.3 + gn3(gp * 7.9 + 1.7) * 0.15;',
        '  diffuseColor.rgb *= 1.0 + (gn - 0.5) * uGrainAmt * 2.0;',
        '}'
      ].join('\n'));
    }
    if (o.scales) {
      // overlapping scales laid along a body's skin coordinates: each a rounded plate, darker at its rim,
      // lit at its crown, rows staggered by half a scale
      sh.uniforms.uScU = { value: o.scales.u || 120 }; sh.uniforms.uScV = { value: o.scales.v || 16 }; sh.uniforms.uScAmt = { value: o.scales.amt == null ? 0.35 : o.scales.amt };
      sh.vertexShader = 'attribute vec2 aSkin; varying vec2 vSkin;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkin = aSkin;');
      sh.fragmentShader = 'varying vec2 vSkin; uniform float uScU; uniform float uScV; uniform float uScAmt;\n' + sh.fragmentShader.replace('#include <color_fragment>', [
        '#include <color_fragment>',
        '{',
        '  vec2 q = vec2(vSkin.x * uScU, vSkin.y * uScV);',
        '  q.y += mod(floor(q.x), 2.0) * 0.5;',
        '  vec2 f = vec2(fract(q.x), fract(q.y) - 0.5);',
        '  float d = length(vec2(f.x * 0.95, f.y * 1.5));',
        '  float rim = smoothstep(0.62, 0.95, d);',
        '  float crown = 1.0 - smoothstep(0.0, 0.55, d);',
        '  float fade = smoothstep(0.0, 0.04, vSkin.x) * smoothstep(1.0, 0.9, vSkin.x);',
        '  float aa = 1.0 - smoothstep(0.3, 0.75, max(fwidth(q.x), fwidth(q.y)));',
        '  diffuseColor.rgb *= 1.0 + (crown * 0.22 - rim * 0.9) * uScAmt * fade * aa;',
        '}'
      ].join('\n'));
    }
    if (o.masonry) {
      // dressed stone: courses with staggered joints, each block its own tone, on upright faces only
      sh.uniforms.uMasH = { value: o.masonry.h || 0.3 }; sh.uniforms.uMasW = { value: o.masonry.w || 0.6 }; sh.uniforms.uMasAmt = { value: o.masonry.amt == null ? 0.4 : o.masonry.amt }; sh.uniforms.uMasAll = { value: o.masonry.all ? 1 : 0 };
      sh.vertexShader = 'varying vec3 vMasP; varying vec3 vMasN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMasP = position; vMasN = normal;');
      sh.fragmentShader = 'varying vec3 vMasP; varying vec3 vMasN; uniform float uMasH; uniform float uMasW; uniform float uMasAmt; uniform float uMasAll;\n' + sh.fragmentShader.replace('#include <color_fragment>', [
        '#include <color_fragment>',
        '{',
        '  vec3 an = abs(normalize(vMasN));',
        '  float wall = max(uMasAll, 1.0 - smoothstep(0.45, 0.75, an.y));',
        '  float row = floor(vMasP.y / uMasH);',
        '  float uu = (an.x > an.z ? vMasP.z : vMasP.x) / uMasW + mod(row, 2.0) * 0.5;',
        '  float col = floor(uu);',
        '  vec2 f = vec2(fract(uu), fract(vMasP.y / uMasH));',
        '  float j = min(min(f.x, 1.0 - f.x) * uMasW, min(f.y, 1.0 - f.y) * uMasH);',
        '  float mortar = 1.0 - smoothstep(0.01, 0.028, j);',
        '  float tone = fract(sin(dot(vec2(row, col), vec2(12.9898, 78.233))) * 43758.5453);',
        '  diffuseColor.rgb *= mix(1.0, (0.88 + tone * 0.22) * (1.0 - mortar * uMasAmt), wall);',
        '}'
      ].join('\n'));
    }
    if (o.veins) {
      sh.uniforms.uVeinTop = { value: o.veins.top };
      sh.uniforms.uVeinScale = { value: o.veins.scale || 0.28 }; sh.uniforms.uVeinI = { value: o.veins.i == null ? 2.4 : o.veins.i };
      sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = [
        'varying vec3 vObj; uniform float uVeinTop; uniform float uVeinScale; uniform float uVeinI;',
        'float vh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
        'float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(mix(vh3(i), vh3(i + vec3(1,0,0)), f.x), mix(vh3(i + vec3(0,1,0)), vh3(i + vec3(1,1,0)), f.x), f.y),',
        '             mix(mix(vh3(i + vec3(0,0,1)), vh3(i + vec3(1,0,1)), f.x), mix(vh3(i + vec3(0,1,1)), vh3(i + vec3(1,1,1)), f.x), f.y), f.z); }',
        ''
      ].join('\n') + sh.fragmentShader.replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        '{',
        '  vec3 q = vObj * uVeinScale;',
        '  float n = vn3(q) * 0.62 + vn3(q * 2.13 + 7.1) * 0.28 + vn3(q * 4.7 + 3.3) * 0.1;',
        '  float vein = pow(max(1.0 - abs(n * 2.0 - 1.0), 0.0), 22.0);',
        '  float mask = smoothstep(uVeinTop, uVeinTop - 3.0, vObj.y);',
        '  float pulse = 0.7 + 0.3 * sin(uTime * 1.3 + vObj.y * 0.35 + vObj.x * 0.2);',
        '  vec3 vc = mix(vec3(1.0, 0.68, 0.28), vec3(0.3, 1.0, 0.82), smoothstep(0.4, 0.6, vn3(vObj * 0.06 + 11.0)));',
        '  totalEmissiveRadiance += vc * vein * mask * uVeinI * pulse;',
        '}'
      ].join('\n'));
      sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader;
    }
    if (o.glow) {
      sh.vertexShader = 'attribute vec3 aGlow; varying vec3 vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = 'varying vec3 vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    }
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform float uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      'if (uSway > 0.0) {',
      '  vec3 base = vec3(0.0);',
      '  #ifdef USE_INSTANCING',
      '  base = instanceMatrix[3].xyz;',
      '  #endif',
      '  float ph = base.x * 0.31 + base.z * 0.27;',
      '  float k = max(transformed.y, 0.0) * uSway;',
      '  transformed.x += sin(uTime * 1.3 + ph) * k * 0.06 * uWind + sin(uTime * 3.1 + ph * 2.0) * k * 0.015;',
      '  transformed.z += cos(uTime * 1.1 + ph) * k * 0.05 * uWind;',
      '}'
    ].join('\n'));
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nif (!(dot(normal, normal) > 0.25)) normal = vec3(0.0, 0.0, 1.0);\nnonPerturbedNormal = normal;');
    sh.fragmentShader = 'uniform vec3 uRim; uniform float uRimI; uniform float uRimMul; uniform vec3 uKeyView;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', [
      '#include <emissivemap_fragment>',
      '{',
      '  vec3 nV = normal;',
      '  float facing = clamp(dot(nV, normalize(vViewPosition)), 0.0, 1.0);',
      '  float rim = pow(1.0 - facing, 3.0);',
      '  float side = clamp(dot(nV, uKeyView) * 0.7 + 0.45, 0.0, 1.0);',
      '  totalEmissiveRadiance += uRim * rim * side * uRimI * uRimMul * (0.35 + 0.65 * diffuseColor.rgb);',
      '}'
    ].join('\n'));
  };
  // rim and sway strengths are uniforms, so materials that differ only in them share one program
  mat.customProgramCacheKey = function () { return 'wyrm' + (o.sway ? 's' : '') + (o.glow ? 'g' : '') + (o.veins ? 'v' : '') + (o.grain ? 'n' : '') + (o.masonry ? 'm' : '') + (o.scales ? 'k' : ''); };
  return mat;
}
/* M(color, {r roughness, m metal, e emissive, ei, t transparent, o opacity, ds double, vc vertex
 * colours, flat, sway, rim}) */
export function M(color, o) {
  o = o || {};
  var mat = new T.MeshStandardMaterial({
    color: color == null ? 0xffffff : color, flatShading: o.flat !== false,
    roughness: o.r != null ? o.r : 0.82, metalness: o.m || 0,
    emissive: o.e != null ? o.e : 0x000000, emissiveIntensity: o.ei != null ? o.ei : 1,
    transparent: !!o.t, opacity: o.o != null ? o.o : 1,
    side: o.ds ? T.DoubleSide : T.FrontSide, vertexColors: !!o.vc
  });
  if (o.t) mat.depthWrite = o.dw != null ? o.dw : true;
  return patchStd(mat, o);
}
/* An unlit glow; `i` > 1 pushes it past the bloom threshold. */
export function G(color, o) {
  o = o || {};
  var mat = new T.MeshBasicMaterial({
    color: new T.Color(color).multiplyScalar(o.i || 1), transparent: !!o.t, opacity: o.o != null ? o.o : 1,
    blending: o.add ? T.AdditiveBlending : T.NormalBlending, depthWrite: o.add ? false : (o.dw != null ? o.dw : true),
    side: o.ds ? T.DoubleSide : T.FrontSide, fog: o.fog != null ? o.fog : !o.add, vertexColors: !!o.vc
  });
  return mat;
}
export function mesh(geo, mat, x, y, z) {
  var m = new T.Mesh(geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* Paint a vertex-colour gradient onto a geometry: bottom colour → top colour along y. */
export function paintY(geo, c0, c1, y0, y1, jitter, seed) {
  var pa = geo.attributes.position, n = pa.count, col = new Float32Array(n * 3), a = new T.Color(c0), b = new T.Color(c1), tmp = new T.Color(), r = rng(seed || 3);
  for (var i = 0; i < n; i++) {
    var k = clamp((pa.getY(i) - y0) / (y1 - y0), 0, 1);
    tmp.copy(a).lerp(b, k);
    if (jitter) { var j = 1 + (r() - 0.5) * jitter; tmp.multiplyScalar(j); }
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  return geo;
}

/* ------------------------------------------------------------ textures */
var texCache = {};
export function glowTexture(inner, outer, key, hard) {
  key = key || ('g' + inner + outer);
  if (texCache[key]) return texCache[key];
  var c = document.createElement('canvas'); c.width = c.height = 128;
  var x = c.getContext('2d');
  var gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(hard || 0.18, inner); gr.addColorStop(1, outer);
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  texCache[key] = t;
  return t;
}
export function softDot() {
  if (texCache.dot) return texCache.dot;
  var c = document.createElement('canvas'); c.width = c.height = 64;
  var x = c.getContext('2d'), img = x.createImageData(64, 64);
  for (var j = 0; j < 64; j++) for (var i = 0; i < 64; i++) {
    var d = Math.hypot(i - 31.5, j - 31.5) / 32, a = Math.exp(-d * d * 5.5) * (1 - smooth(0.85, 1, d));
    var k = (j * 64 + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  return (texCache.dot = t);
}
export function glowSprite(color, size, opacity, i) {
  var s = new T.Sprite(new T.SpriteMaterial({
    map: softDot(), color: new T.Color(color).multiplyScalar(i || 1.6), transparent: true, opacity: opacity == null ? 0.8 : opacity,
    blending: T.AdditiveBlending, depthWrite: false, toneMapped: true, fog: false
  }));
  s.scale.setScalar(size || 2);
  return s;
}

export function runeTexture(color) {
  var key = 'rune' + color;
  if (texCache[key]) return texCache[key];
  var c = document.createElement('canvas'); c.width = c.height = 1024;
  var x = c.getContext('2d'), r = rng(77);
  x.translate(512, 512);
  x.strokeStyle = color; x.lineCap = 'round'; x.shadowColor = color; x.shadowBlur = 10;
  function ring(rad, w) { x.lineWidth = w; x.beginPath(); x.arc(0, 0, rad, 0, TAU); x.stroke(); }
  ring(500, 6); ring(472, 2); ring(452, 1.5); ring(360, 4); ring(332, 2); ring(150, 3); ring(120, 1.5);
  for (var i = 0; i < 48; i++) {
    x.save(); x.rotate(i / 48 * TAU); x.translate(0, -412); x.lineWidth = 4.5;
    x.beginPath();
    var strokes = 2 + Math.floor(r() * 3);
    for (var s = 0; s < strokes; s++) {
      var ax = (r() - 0.5) * 30, ay = (r() - 0.5) * 38, bx = (r() - 0.5) * 30, by = (r() - 0.5) * 38;
      if (r() < 0.35) { x.moveTo(ax + 8, ay); x.arc(ax, ay, 6 + r() * 8, 0, Math.PI * (0.6 + r())); }
      else { x.moveTo(ax, ay); x.lineTo(bx, by); }
    }
    x.stroke(); x.restore();
  }
  for (i = 0; i < 96; i++) { x.save(); x.rotate(i / 96 * TAU); x.lineWidth = 2; x.beginPath(); x.moveTo(0, -360); x.lineTo(0, -372 - (i % 4 === 0 ? 14 : 0)); x.stroke(); x.restore(); }
  x.lineWidth = 3; x.beginPath();
  for (var k = 0; k <= 7; k++) { var a = k * (TAU * 3 / 7) - Math.PI / 2; var px = Math.cos(a) * 332, py = Math.sin(a) * 332; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
  x.stroke();
  for (var q = 0; q < 7; q++) { var b = q * TAU / 7 - Math.PI / 2; x.beginPath(); x.lineWidth = 3; x.arc(Math.cos(b) * 240, Math.sin(b) * 240, 26, 0, TAU); x.stroke(); x.beginPath(); x.lineWidth = 1.5; x.arc(Math.cos(b) * 240, Math.sin(b) * 240, 14, 0, TAU); x.stroke(); }
  var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  texCache[key] = t;
  return t;
}
export function runeDisc(radius, color, opacity, i) {
  var m = new T.Mesh(new T.PlaneGeometry(radius * 2, radius * 2), new T.MeshBasicMaterial({
    map: runeTexture(color || '#e8c872'), color: new T.Color(1, 1, 1).multiplyScalar(i || 1.8), transparent: true, opacity: opacity == null ? 0.9 : opacity,
    blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false
  }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* Cumulus, painted once: eight shapes in a 4×2 atlas. R = how lit (light from above),
 * G = how deep inside the cloud, A = coverage. Each cloud is a few great lobes, each lobe
 * crowned with smaller billows and those with smaller still, so the edge reads as cauliflower;
 * light is marched toward the sun through the density and sharpened by each billow's own slope. */
export function cloudAtlas() {
  if (texCache.clouds) return texCache.clouds;
  var S = 384, W = S * 4, H = S * 2, K = S / 256;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d'), img = x.createImageData(W, H);
  var D = new Float32Array(S * S), L = new Float32Array(S * S), tmp = new Float32Array(S * S);
  function blur(A, rad) {
    var n = rad * 2 + 1, xx, yy, acc;
    for (yy = 0; yy < S; yy++) { acc = 0; for (xx = -rad; xx <= rad; xx++) acc += A[yy * S + clamp(xx, 0, S - 1)];
      for (xx = 0; xx < S; xx++) { tmp[yy * S + xx] = acc / n; acc += A[yy * S + Math.min(S - 1, xx + rad + 1)] - A[yy * S + Math.max(0, xx - rad)]; } }
    for (xx = 0; xx < S; xx++) { acc = 0; for (yy = -rad; yy <= rad; yy++) acc += tmp[clamp(yy, 0, S - 1) * S + xx];
      for (yy = 0; yy < S; yy++) { A[yy * S + xx] = acc / n; acc += tmp[Math.min(S - 1, yy + rad + 1) * S + xx] - tmp[Math.max(0, yy - rad) * S + xx]; } }
  }
  function splat(bx, by, br, w) {
    var x0 = Math.max(0, Math.floor((bx - br) * S)), x1 = Math.min(S - 1, Math.ceil((bx + br) * S));
    var y0 = Math.max(0, Math.floor((by - br) * S)), y1 = Math.min(S - 1, Math.ceil((by + br) * S));
    for (var py = y0; py <= y1; py++) for (var px = x0; px <= x1; px++) {
      var d = Math.hypot(px / S - bx, py / S - by) / br;
      if (d < 1) { var f = 1 - d * d; D[py * S + px] += f * f * w; }
    }
  }
  function crown(r, bx, by, br, n, depth) {
    // billows on the upper rim of a lobe (screen y grows downward, so "up" is a negative sine)
    for (var j = 0; j < n; j++) {
      var a = Math.PI * (1.08 + 0.84 * (j + r() * 0.8) / n), sr = br * (0.3 + r() * 0.2);
      var sx = bx + Math.cos(a) * br * 0.78, sy = by + Math.sin(a) * br * 0.74;
      splat(sx, sy, sr, 0.95);
      if (depth > 0) crown(r, sx, sy, sr, 2 + Math.floor(r() * 2), depth - 1);
    }
  }
  for (var v = 0; v < 8; v++) {
    var r = rng(900 + v * 17), nz = makeNoise(40 + v);
    D.fill(0);
    var lobes = 4 + Math.floor(r() * 3), flatB = 0.72 + r() * 0.05, wide = v >= 6 ? 1.6 : 1;
    for (var b = 0; b < lobes; b++) {
      var bx = 0.5 + ((b + 0.5) / lobes - 0.5) * 0.62 * Math.min(1.3, wide) + (r() - 0.5) * 0.06, k0 = 1 - Math.abs(bx - 0.5) * 2;
      var br = (0.1 + r() * 0.07) * (0.65 + k0 * 0.75) / Math.sqrt(wide);
      var by = flatB - br * (0.5 + r() * 0.3) - k0 * 0.1 * r();
      splat(bx, by, br, 1.15);
      crown(r, bx, by, br, 3 + Math.floor(r() * 3), 1);
    }
    for (var py = 0; py < S; py++) for (var px = 0; px < S; px++) {
      var u = px / S, w = py / S, i = py * S + px;
      var edge = smooth(0, 0.06, u) * smooth(1, 0.94, u) * smooth(0, 0.05, w);
      var bot = smooth(flatB + 0.025, flatB - 0.04, w);
      D[i] = D[i] * (0.78 + 0.4 * nz(u * 7, w * 7, 3)) * edge * bot;
    }
    var ox = (v % 4) * S, oy = Math.floor(v / 4) * S;
    // light: density marched toward the sun (up and a little left), then softened so the
    // march leaves no streaks; each billow's own slope adds its highlight near the silhouette
    for (py = 0; py < S; py++) for (px = 0; px < S; px++) {
      i = py * S + px;
      var acc = 0;
      for (var s = 1; s <= 10; s++) { var sx = Math.round(px - s * 1.2 * K), sy = Math.round(py - s * 4.2 * K); if (sx < 0 || sy < 0) break; acc += D[sy * S + sx] * (1 - s * 0.06); }
      L[i] = Math.exp(-acc * 0.1);
    }
    blur(L, Math.round(6 * K)); blur(L, Math.round(4 * K));
    for (py = 0; py < S; py++) for (px = 0; px < S; px++) {
      i = py * S + px;
      u = px / S; w = py / S;
      // a wisp-torn rim: high-frequency noise nudges the threshold where the cover thins
      var wisp = (nz(u * 30, w * 30, 2) - 0.5) * 0.14;
      var a = smooth(0.1, 0.3, D[i] + wisp * (1 - smooth(0.2, 0.5, D[i])));
      var e = Math.round(3 * K);
      var gx = (D[i + (px < S - e ? e : 0)] - D[i - (px >= e ? e : 0)]), gy = (D[i + (py < S - e ? e * S : 0)] - D[i - (py >= e ? e * S : 0)]);
      var slope = clamp(0.5 + (gx * 0.45 + gy * 0.8) * 1.6, 0, 1), near = 1 - smooth(0.35, 0.9, D[i]);
      var lit = clamp(L[i] * (1 + (0.62 + 0.55 * slope - 1) * near) * (0.42 + 0.58 * smooth(flatB + 0.01, flatB - 0.34, w)), 0, 1);
      var deep = clamp(D[i] * 0.85, 0, 1);
      var o = ((oy + py) * W + ox + px) * 4;
      img.data[o] = lit * 255; img.data[o + 1] = deep * 255; img.data[o + 2] = 0; img.data[o + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  var t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; t.anisotropy = 4;
  t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
  return (texCache.clouds = t);
}

/* --------------------------------------------------------------- grade */
/* Before the bloom spreads light around, drop any pixel that is not a finite, sane colour. One NaN
 * fed to the blur becomes a black rectangle across the screen. */
var SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; varying vec2 vUv;',
    'void main(){',
    '  vec4 c = texture2D(tDiffuse, vUv);',
    '  bool bad = any(isnan(c)) || any(isinf(c)) || !(abs(c.r) + abs(c.g) + abs(c.b) < 3.0e4);',
    '  gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(max(c.rgb, vec3(0.0)), c.a);',
    '}'
  ].join('\n')
};

var GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new T.Vector2(1, 1) },
    uShadow: { value: new T.Vector3(0.36, 0.4, 0.62) }, uHigh: { value: new T.Vector3(1, 0.86, 0.66) },
    uSplit: { value: 0.15 }, uSat: { value: 1.06 }, uContrast: { value: 1.05 }, uVig: { value: 0.4 },
    uGrain: { value: 0.035 }, uCA: { value: 0.0025 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;',
    'uniform vec3 uShadow; uniform vec3 uHigh; uniform float uSplit; uniform float uSat; uniform float uContrast; uniform float uVig; uniform float uGrain; uniform float uCA;',
    'varying vec2 vUv;',
    'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  vec2 d = vUv - 0.5;',
    '  float r2 = dot(d, d);',
    '  vec2 off = d * r2 * uCA * 4.0;',
    '  vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  vec3 tint = mix(uShadow, uHigh, smoothstep(0.0, 0.8, l));',
    '  c = mix(c, c * tint * 1.25, uSplit);',
    '  c = mix(vec3(l), c, uSat);',
    '  c = (c - 0.5) * uContrast + 0.5;',
    '  float v = smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.82)) * 1.25);',
    '  c *= mix(1.0 - uVig, 1.0, v);',
    '  c += (h(vUv * uRes + fract(uTime * 7.13)) - 0.5) * uGrain;',
    '  gl_FragColor = vec4(max(c, 0.0), 1.0);',
    '}'
  ].join('\n')
};

/* Light shafts: bright sky near the sun smeared toward it; whatever stands in front is dark and
 * so casts its own shadow through the rays. */
var RaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new T.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uDecay: { value: 0.955 }, uDensity: { value: 0.9 }, uThreshold: { value: 0.85 }, uAspect: { value: 1.6 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform float uDecay; uniform float uDensity; uniform float uThreshold; uniform float uAspect;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 base = texture2D(tDiffuse, vUv);',
    '  if (uStrength < 0.002) { gl_FragColor = base; return; }',
    '  vec2 delta = (vUv - uSun) * uDensity / 40.0;',
    '  vec2 uv = vUv; float illum = 1.0; vec3 acc = vec3(0.0);',
    '  for (int i = 0; i < 40; i++) { uv -= delta; vec3 sc = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb; float l = max(dot(sc, vec3(0.299, 0.587, 0.114)) - uThreshold, 0.0); acc += sc * min(l, 2.0) * illum; illum *= uDecay; }',
    '  float fall = smoothstep(1.3, 0.0, length((vUv - uSun) * vec2(uAspect, 1.0)));',
    '  gl_FragColor = vec4(base.rgb + acc * uStrength * fall / 40.0, base.a);',
    '}'
  ].join('\n')
};

/* ------------------------------------------------------------------- stage */
export function Stage(canvas, o) {
  o = o || {};
  var md = o.mood || mood('gate');
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
  // phones and small screens start lighter: fewer samples, a smaller shadow map, a lower pixel ratio
  var light = lightTier();
  var maxPR = Math.min(window.devicePixelRatio || 1, light ? 1.5 : 2), pr = Math.min(maxPR, light ? 1.25 : 1.75);
  renderer.setPixelRatio(pr);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = md.exposure || 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  var scene = new T.Scene();
  scene.background = new T.Color(md.zenith);
  scene.fog = new T.FogExp2(md.fog, md.fogD);
  var camera = new T.PerspectiveCamera(o.fov || 40, 1, 0.5, 6000);
  var host = canvas.parentElement || canvas;

  var rt = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, samples: light ? 2 : 4 });
  var composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));
  var rays = new ShaderPass(RaysShader);
  rays.enabled = !!md.rays;
  composer.addPass(rays);
  var bloom = new UnrealBloomPass(new T.Vector2(256, 256), md.bloom, md.bloomR, md.bloomT);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  var grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  function setGrade(g) {
    var u = grade.uniforms;
    u.uShadow.value.fromArray(g.shadow); u.uHigh.value.fromArray(g.high);
    u.uSplit.value = g.split; u.uSat.value = g.sat; u.uContrast.value = g.contrast; u.uVig.value = g.vig;
  }
  setGrade(md.grade);

  var W = 2, H = 2;
  function size(w, h, ratio) {
    W = w; H = h;
    if (ratio) { pr = ratio; }
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    renderer.setSize(w, h, false); composer.setSize(w, h);
    bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    grade.uniforms.uRes.value.set(w * pr, h * pr);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function resize() { size(host.clientWidth || 960, host.clientHeight || 600); }
  var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  var updaters = [], raf = 0, alive = true, last = performance.now(), start = last, woke = false;
  // the page paints a twilight veil behind the canvas; the scene fades in once its first frame is drawn
  canvas.classList.remove('awake');
  var keyDir = md.sunV.clone(), slow = 0, fast = 0;
  var sunP = new T.Vector3(), camDir = new T.Vector3();
  function renderFrame() {
    U.uKeyView.value.copy(keyDir).transformDirection(camera.matrixWorldInverse);
    if (rays.enabled) {
      camera.getWorldDirection(camDir);
      var facing = camDir.dot(md.sunV);
      sunP.copy(camera.position).addScaledVector(md.sunV, 1000).project(camera);
      var off = Math.max(Math.abs(sunP.x), Math.abs(sunP.y));
      rays.uniforms.uSun.value.set(sunP.x * 0.5 + 0.5, sunP.y * 0.5 + 0.5);
      rays.uniforms.uStrength.value = md.rays * smooth(0.0, 0.35, facing) * smooth(2.2, 1.0, off);
      rays.uniforms.uThreshold.value = md.raysT || 0.6;
      rays.uniforms.uAspect.value = camera.aspect;
    }
    composer.render();
  }
  // warm the shaders off the main thread before the first frame, so the page (and its veil) stays
  // alive while they compile; a slow or missing compileAsync falls back to compiling on first draw
  var warm = 0;
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (warm < 2) {
      if (warm === 0) {
        warm = 1;
        var done = function () { warm = 2; };
        // compile for the target the scene really draws into: a program's colour space and tone mapping
        // follow the render target, so warming against the screen would build every shader twice
        try { var prevRT = renderer.getRenderTarget(); renderer.setRenderTarget(rt); var p = renderer.compileAsync && renderer.compileAsync(scene, camera); renderer.setRenderTarget(prevRT); if (p && p.then) { p.then(done, done); setTimeout(done, 4000); } else done(); } catch (e) { renderer.setRenderTarget(null); done(); }
      }
      last = now; return;
    }
    var dtr = (now - last) / 1000, dt = Math.min(dtr, 0.05); last = now;
    var t = (now - start) / 1000;
    U.uTime.value = t; grade.uniforms.uTime.value = t;
    for (var i = 0; i < updaters.length; i++) updaters[i](t, dt);
    renderFrame();
    if (!woke) { woke = true; requestAnimationFrame(function () { if (alive) canvas.classList.add('awake'); }); }
    // keep the frame rate: shed resolution when frames run long, win it back when they're quick
    if (dtr > 0.028) { slow++; fast = 0; } else if (dtr < 0.018) { fast++; slow = 0; }
    if (slow > 45 && pr > 1) { slow = 0; size(W, H, Math.max(1, pr - 0.25)); }
    if (fast > 240 && pr < Math.min(maxPR, light ? 1.5 : 1.75)) { fast = 0; size(W, H, Math.min(maxPR, pr + 0.25)); }
  }
  raf = requestAnimationFrame(frame);
  U.uRim.value.set(md.rim); U.uRimI.value = md.rimI;

  var st = {
    light: light,
    renderer: renderer, scene: scene, camera: camera, canvas: canvas, mood: md, composer: composer, bloom: bloom, grade: grade,
    add: function (fn) { updaters.push(fn); return fn; },
    remove: function (fn) { var i = updaters.indexOf(fn); if (i >= 0) updaters.splice(i, 1); },
    renderFrame: renderFrame,
    ready: function () { return warm === 2; },
    resizeTo: function (w, h, ratio) { size(w, h, ratio); },
    setGrade: setGrade,
    setKey: function (v) { keyDir.copy(v).normalize(); },
    dispose: function () {
      alive = false; cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      scene.traverse(function (ob) {
        if (ob.geometry) ob.geometry.dispose();
        if (ob.material) (Array.isArray(ob.material) ? ob.material : [ob.material]).forEach(function (m) { m.dispose(); });
      });
      composer.dispose && composer.dispose(); rt.dispose();
      renderer.dispose();
      // Release the GPU context once this canvas has left the page (browsers cap live contexts and
      // drop the oldest, which would be the guide's portrait). A screen that rebuilds its scene on
      // the same canvas hands it to a newer stage first, and that stage keeps the context.
      setTimeout(function () { if (canvas.__wyrmOwner === st && !canvas.isConnected) renderer.forceContextLoss(); }, 2500);
    }
  };
  canvas.__wyrmOwner = st;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) devHook(st);
  return st;
}

/* Local development only: a stage can be captured at any size and sent to a capture sink. */
function devHook(st) {
  window.__wyrmStage = st;
  if (window.__wyrmCapHooked) return;
  window.__wyrmCapHooked = true;
  window.addEventListener('message', async function (e) {
    if (!e.data || !e.data.__cap) return;
    var s = window.__wyrmStage, el = document.documentElement;
    for (var wt = 0; wt < 100 && s.ready && !s.ready(); wt++) await new Promise(function (r) { setTimeout(r, 50); });
    try {
      var c = s.canvas, pw = c.clientWidth, ph = c.clientHeight, pr = s.renderer.getPixelRatio();
      var cam = s.camera, p0 = cam.position.clone(), q0 = cam.quaternion.clone();
      s.resizeTo(e.data.w || 1600, e.data.h || 1000, 1);
      if (e.data.cam) {
        cam.position.fromArray(e.data.cam.pos);
        if (e.data.cam.rel && s.studio) cam.position.applyAxisAngle(new T.Vector3(0, 1, 0), s.studio.rotation.y);
        var lk = new T.Vector3().fromArray(e.data.cam.look);
        if (e.data.cam.rel && s.studio) lk.applyAxisAngle(new T.Vector3(0, 1, 0), s.studio.rotation.y);
        cam.lookAt(lk); cam.updateMatrixWorld();
      }
      s.renderFrame();
      var url = c.toDataURL('image/jpeg', 0.92);
      cam.position.copy(p0); cam.quaternion.copy(q0);
      s.resizeTo(pw, ph, pr);
      var res = await fetch('http://127.0.0.1:5199/?name=' + e.data.__cap, { method: 'POST', body: url });
      el.dataset.cap = await res.text();
    } catch (err) { el.dataset.cap = 'ERR ' + err.message; }
  });
}

/* -------------------------------------------------------------------- sky */
var NOISE_GLSL = [
  'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
  'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }',
  'float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }',
  'float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }'
].join('\n');
export { NOISE_GLSL };

export function sky(stage, md) {
  md = md || stage.mood;
  var C = function (h) { return new T.Color(h); };
  var mat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: C(md.zenith) }, upper: { value: C(md.upper) }, lower: { value: C(md.lower) }, horizon: { value: C(md.horizon) }, below: { value: C(md.below) },
      sunCol: { value: C(md.sun) }, sunDir: { value: md.sunV.clone() }, sunSize: { value: md.sunSize }, glow: { value: md.glow },
      cirrus: { value: md.cirrus }, nebula: { value: md.nebula || 0 }, time: U.uTime
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 zenith; uniform vec3 upper; uniform vec3 lower; uniform vec3 horizon; uniform vec3 below;',
      'uniform vec3 sunCol; uniform vec3 sunDir; uniform float sunSize; uniform float glow; uniform float cirrus; uniform float nebula; uniform float time;',
      'varying vec3 vP;',
      NOISE_GLSL,
      'void main(){',
      '  vec3 d = normalize(vP);',
      '  float h = d.y;',
      '  float sd = max(dot(d, sunDir), 0.0);',
      '  float az = clamp(dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)) * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 c = mix(horizon, lower, smoothstep(0.0, 0.12 + 0.1 * az, h));',
      '  c = mix(c, upper, smoothstep(0.08, 0.42, h));',
      '  c = mix(c, zenith, smoothstep(0.35, 0.95, h));',
      '  c = mix(c, below, smoothstep(0.0, -0.18, h));',
      // the horizon blushes toward the sun
      '  c += sunCol * exp(-abs(h - 0.02) * 9.0) * pow(az, 3.0) * 0.32 * glow;',
      '  c += sunCol * (pow(sd, 8.0) * 0.12 + pow(sd, 48.0) * 0.4 + pow(sd, 500.0) * 1.2) * glow;',
      '  c += sunCol * smoothstep(sunSize - 0.00025, sunSize, sd) * 14.0;',
      // high cirrus, lit from the sun's side
      '  if (h > 0.0) {',
      '    vec2 cp = d.xz / (h + 0.18) * 1.6 + vec2(time * 0.006, 0.0);',
      '    float cc = fbm(cp * vec2(1.0, 3.2) + fbm(cp * 0.7) * 1.6);',
      '    cc = smoothstep(0.52, 0.85, cc) * smoothstep(0.0, 0.08, h) * smoothstep(0.75, 0.25, h) * cirrus;',
      '    vec3 cl = mix(lower * 1.15, sunCol * 1.25, pow(az, 2.0) * 0.8 + pow(sd, 3.0) * 0.6);',
      '    c = mix(c, cl, cc * 0.6);',
      '  }',
      // a band of nebula across the night
      '  if (nebula > 0.0) {',
      '    float bd = dot(d, normalize(vec3(0.3, 0.8, 0.5))) * 3.0; float band = exp(-bd * bd);',
      '    float nb = fbm(d.xz * 3.0 / (abs(d.y) + 0.6) + vec2(3.0, 1.0)) * fbm(d.zy * 5.0 + 7.0);',
      '    c += (vec3(0.35, 0.18, 0.6) * nb * 1.1 + vec3(0.1, 0.32, 0.4) * smoothstep(0.25, 0.6, nb)) * band * nebula * smoothstep(-0.05, 0.3, h);',
      '  }',
      '  gl_FragColor = vec4(c, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n')
  });
  var dome = new T.Mesh(new T.SphereGeometry(4000, 64, 32), mat);
  dome.renderOrder = -10; dome.frustumCulled = false;
  stage.scene.add(dome);
  stage.add(function () { dome.position.copy(stage.camera.position); });

  // stars: brighter overhead, gone at the horizon and near the sun
  var N = 3600, pos = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N), tint = new Float32Array(N), r = rng(9);
  for (var i = 0; i < N; i++) {
    var u = r(), a = r() * TAU, y = Math.pow(u, 0.7) * 0.98 + 0.02;
    var rad = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * rad; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * rad;
    sz[i] = 0.8 + Math.pow(r(), 9) * 7; ph[i] = r() * 50; tint[i] = r();
  }
  var sg = new T.BufferGeometry();
  sg.setAttribute('position', new T.BufferAttribute(pos, 3));
  sg.setAttribute('size', new T.BufferAttribute(sz, 1));
  sg.setAttribute('phase', new T.BufferAttribute(ph, 1));
  sg.setAttribute('tint', new T.BufferAttribute(tint, 1));
  var smat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false,
    uniforms: { time: U.uTime, pr: { value: stage.renderer.getPixelRatio() }, amt: { value: md.stars }, sunDir: { value: md.sunV.clone() } },
    vertexShader: [
      'attribute float size; attribute float phase; attribute float tint; uniform float time; uniform float pr; uniform float amt; uniform vec3 sunDir;',
      'varying float vA; varying vec3 vC;',
      'void main(){',
      '  vec3 d = normalize(position);',
      '  float tw = 0.6 + 0.4 * sin(time * (1.2 + fract(phase) * 2.0) + phase);',
      '  vA = tw * amt * smoothstep(0.02, 0.3, d.y) * (1.0 - smoothstep(0.75, 0.98, dot(d, sunDir)));',
      '  vC = mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.85, 1.0), tint);',
      '  vec4 mv = viewMatrix * vec4(position * 3500.0 + cameraPosition, 1.0);',
      '  gl_PointSize = size * pr;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: 'varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vC * a * vA * 1.4, a * vA); }'
  });
  var stars = new T.Points(sg, smat); stars.renderOrder = -9; stars.frustumCulled = false;
  stage.scene.add(stars);

  // aurora curtains
  var aur = null, amat = null;
  if (md.aurora > 0) {
    aur = new T.Group();
    amat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      uniforms: { time: U.uTime, c1: { value: C(md.aurora1 || 0x45f0c0) }, c2: { value: C(md.aurora2 || 0x9a6bff) }, strength: { value: md.aurora } },
      vertexShader: 'varying vec2 vUv; uniform float time; void main(){ vUv = uv; vec3 p = position; p.y += sin(uv.x * 9.0 + time * 0.25) * 30.0; p.z += sin(uv.x * 5.0 - time * 0.15) * 50.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: [
        'varying vec2 vUv; uniform float time; uniform vec3 c1; uniform vec3 c2; uniform float strength;',
        NOISE_GLSL,
        'void main(){',
        '  float rays = fbm(vec2(vUv.x * 40.0 + time * 0.08, time * 0.05));',
        '  rays = pow(smoothstep(0.3, 0.8, rays), 1.5);',
        '  float fold = 0.5 + 0.5 * sin(vUv.x * 30.0 + sin(vUv.x * 7.0 + time * 0.4) * 3.0);',
        '  float v = smoothstep(0.0, 0.15, vUv.y) * pow(1.0 - vUv.y, 1.6);',
        '  float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);',
        '  vec3 col = mix(c1, c2, smoothstep(0.2, 0.9, vUv.y));',
        '  float a = v * edge * (0.25 + 0.75 * rays) * (0.6 + 0.4 * fold) * strength;',
        '  gl_FragColor = vec4(col * a * 1.3, a);',
        '}'
      ].join('\n')
    });
    for (var k = 0; k < 3; k++) {
      var pg = new T.PlaneGeometry(1800, 420, 200, 1);
      var pa = pg.attributes.position;
      for (var v = 0; v < pa.count; v++) {
        var px = pa.getX(v), ang = px / 1800 * 1.9;
        pa.setXYZ(v, Math.sin(ang) * 1700, pa.getY(v) + 210, -Math.cos(ang) * 1700);
      }
      var ribbon = new T.Mesh(pg, amat);
      ribbon.position.y = (md.auroraY || 140) + k * 90;
      ribbon.rotation.y = -0.9 + k * 0.9;
      ribbon.renderOrder = -8; ribbon.frustumCulled = false;
      aur.add(ribbon);
    }
    stage.scene.add(aur);
    stage.add(function () { aur.position.set(stage.camera.position.x, 0, stage.camera.position.z); });
  }
  return { dome: dome, stars: stars, aurora: aur, auroraMat: amat, mat: mat };
}

/* -------------------------------------------------------------- the cloud sea */
/* An opaque sea of cloud tops: a height field of warped noise, lit from the sun, with dark
 * gaps where the deep shows through, turning to the horizon's haze with distance. */
export function cloudSea(stage, md, o) {
  md = md || stage.mood; o = o || {};
  var C = function (h) { return new T.Color(h); };
  var mat = new T.ShaderMaterial({
    fog: false,
    uniforms: {
      time: U.uTime, lit: { value: C(md.seaLit) }, shade: { value: C(md.seaShade) }, deep: { value: C(md.seaDeep) },
      haze: { value: C(md.below).lerp(C(md.horizon), 0.45) }, hazeHi: { value: C(md.horizon) }, sunCol: { value: C(md.sun) }, sunDir: { value: md.sunV.clone() },
      scale: { value: o.scale || 0.016 }, near: { value: o.near || 260 }, far: { value: o.far || 1500 }, mottle: { value: md.mottle != null ? md.mottle : 0.18 }
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'uniform float time; uniform vec3 lit; uniform vec3 shade; uniform vec3 deep; uniform vec3 haze; uniform vec3 hazeHi; uniform vec3 sunCol; uniform vec3 sunDir;',
      'uniform float scale; uniform float near; uniform float far; uniform float mottle;',
      'varying vec3 vW;',
      NOISE_GLSL,
      'float billow(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * abs(vn(p) * 2.0 - 1.0); p = p * 2.07 + vec2(3.1, 7.7); a *= 0.5; } return s; }',
      'float field(vec2 p, float detail){ vec2 q = vec2(fbm3(p * 0.3 + time * 0.003), fbm3(p * 0.3 + 4.3 - time * 0.002)); vec2 w = p + q * 0.75 + vec2(time * 0.008, time * 0.003); float base = fbm3(w * 0.45); float puff = 1.0 - billow(w * 1.1); float heap = 1.0 - billow(w * 2.7 + 5.3); return base * 0.5 + mix(0.32, puff * 0.78 + heap * 0.22, detail) * 0.66 - 0.06; }',
      'void main(){',
      '  vec2 p = vW.xz * scale;',
      '  float dist = length(vW.xz - cameraPosition.xz);',
      '  float detail = 1.0 - smoothstep(250.0, 1400.0, dist);',
      '  float e = 0.035 + dist * 0.00009;',
      '  float d0 = field(p, detail);',
      '  float dx = field(p + vec2(e, 0.0), detail);',
      '  float dz = field(p + vec2(0.0, e), detail);',
      '  vec3 n = normalize(vec3((d0 - dx) / e * 0.75, 1.0, (d0 - dz) / e * 0.75));',
      '  float lam = clamp(dot(n, sunDir) * 0.55 + 0.45, 0.0, 1.0);',
      '  float ao = smoothstep(0.22, 0.72, d0);',
      '  float top = ao;',
      '  vec3 col = mix(shade, lit, lam * (0.25 + 0.75 * ao));',
      '  col *= 0.78 + 0.28 * ao;',
      '  col = mix(mix(deep, shade, 0.6), col, smoothstep(0.06, 0.3, d0));',
      '  float cs = smoothstep(0.3, 0.68, fbm3(p * 0.055 + vec2(time * 0.0016, -time * 0.0011)));',
      '  col *= 1.0 - mottle * (1.0 - cs);',
      '  float lining = pow(clamp(1.0 - n.y, 0.0, 1.0), 1.4) * max(dot(normalize(n.xz + 1e-4), normalize(sunDir.xz + 1e-4)), 0.0);',
      '  col += sunCol * lining * 0.45 * ao;',
      '  vec3 V = normalize(cameraPosition - vW);',
      '  float fwd = pow(max(dot(-V, sunDir), 0.0), 5.0);',
      '  float edge = smoothstep(0.38, 0.5, d0) * (1.0 - smoothstep(0.5, 0.7, d0));',
      '  col += sunCol * (fwd * 0.22 * top + edge * fwd * 0.45);',
      '  float az = dot(normalize(vW.xz - cameraPosition.xz), normalize(sunDir.xz)) * 0.5 + 0.5;',
      '  col = mix(col, haze, smoothstep(near, far, dist));',
      '  col = mix(col, hazeHi * (0.85 + 0.3 * pow(az, 3.0)), smoothstep(far * 0.9, far * 2.6, dist));',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n')
  });
  var plane = new T.Mesh(new T.PlaneGeometry(9000, 9000, 1, 1), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = o.y != null ? o.y : md.seaY;
  plane.renderOrder = -5; plane.frustumCulled = false;
  stage.scene.add(plane);
  stage.add(function () { plane.position.x = stage.camera.position.x; plane.position.z = stage.camera.position.z; });
  return plane;
}

/* ------------------------------------------------------------ cumulus banks */
/* Billboarded cumulus from the atlas, all in one draw, kept sorted back to front.
 * puffs: [{ x, y, z, w, h, v (atlas cell), a (alpha), s (shade 0..1) }]. */
export function cloudBank(stage, puffs, md, seaY) {
  md = md || stage.mood;
  var n = puffs.length;
  var geo = new T.InstancedBufferGeometry();
  var base = new T.PlaneGeometry(1, 1);
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  var iPos = new Float32Array(n * 3), iSize = new Float32Array(n * 2), iVar = new Float32Array(n * 3);
  var order = puffs.map(function (_, i) { return i; });
  function write() {
    for (var j = 0; j < n; j++) {
      var p = puffs[order[j]];
      iPos[j * 3] = p.x; iPos[j * 3 + 1] = p.y; iPos[j * 3 + 2] = p.z;
      iSize[j * 2] = p.w; iSize[j * 2 + 1] = p.h;
      iVar[j * 3] = p.v; iVar[j * 3 + 1] = p.a == null ? 1 : p.a; iVar[j * 3 + 2] = p.s || 0;
    }
  }
  write();
  geo.setAttribute('iPos', new T.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2));
  geo.setAttribute('iVar', new T.InstancedBufferAttribute(iVar, 3));
  geo.instanceCount = n;
  var C = function (h) { return new T.Color(h); };
  var mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      map: { value: cloudAtlas() }, lit: { value: C(md.seaLit) }, shade: { value: C(md.seaShade) }, sunCol: { value: C(md.sun) },
      sunDir: { value: md.sunV.clone() }, fogCol: { value: C(md.fog) }, hazeCol: { value: C(md.horizon).lerp(C(md.lower), 0.5) }, fogD: { value: md.fogD * 0.55 }, time: U.uTime,
      seaY: { value: seaY != null ? seaY : md.seaY != null ? md.seaY : -1e5 }
    },
    vertexShader: [
      'attribute vec3 iPos; attribute vec2 iSize; attribute vec3 iVar;',
      'uniform vec3 sunDir; uniform float time;',
      'varying vec2 vUv; varying vec3 vVar; varying float vDist; varying float vSunSide; varying float vToSun; varying float vDown; varying vec2 vSv; varying float vWy; varying float vH;',
      'void main(){',
      '  vec3 c = iPos + vec3(sin(time * 0.03 + iPos.z * 0.01) * 6.0, 0.0, 0.0);',
      '  vec4 mv = viewMatrix * vec4(c, 1.0);',
      '  mv.xy += position.xy * iSize;',
      '  gl_Position = projectionMatrix * mv;',
      '  float cell = iVar.x;',
      '  vUv = (uv + vec2(mod(cell, 4.0), 1.0 - floor(cell / 4.0))) / vec2(4.0, 2.0);',
      '  vVar = iVar; vDist = length(mv.xyz);',
      // the world height of this corner of the billboard, so its foot can melt into the cloud sea
      '  vWy = c.y + vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]).y * position.x * iSize.x + vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]).y * position.y * iSize.y; vH = iSize.y;',
      '  vec3 sv = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);',
      '  vSunSide = dot(normalize(position.xy + 1e-4), normalize(sv.xy + 1e-4)); vSv = sv.xy;',
      '  vToSun = max(dot(normalize(c - cameraPosition), sunDir), 0.0);',
      '  vDown = smoothstep(0.16, 0.5, -normalize(c - cameraPosition).y);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D map; uniform vec3 lit; uniform vec3 shade; uniform vec3 sunCol; uniform vec3 fogCol; uniform vec3 hazeCol; uniform float fogD; uniform float seaY;',
      'varying vec2 vUv; varying vec3 vVar; varying float vDist; varying float vSunSide; varying float vToSun; varying float vDown; varying vec2 vSv; varying float vWy; varying float vH;',
      'void main(){',
      '  vec4 t = texture2D(map, vUv);',
      '  if (t.a < 0.01) discard;',
      '  float l = t.r * (1.0 - vVar.z * 0.6);',
      '  if (vDown > 0.001) {',
      '    vec2 st = vec2(14.0 / 1024.0, 14.0 / 512.0);',
      '    float aL = texture2D(map, vUv - vec2(st.x, 0.0)).a, aR = texture2D(map, vUv + vec2(st.x, 0.0)).a;',
      '    float aD = texture2D(map, vUv - vec2(0.0, st.y)).a, aU = texture2D(map, vUv + vec2(0.0, st.y)).a;',
      '    vec3 nn = normalize(vec3((aL - aR) * 1.6, (aD - aU) * 1.6, 1.0));',
      '    float lam = clamp(dot(nn, normalize(vec3(vSv, 0.55))) * 0.6 + 0.4, 0.0, 1.0);',
      '    float up = lam * (0.72 + 0.28 * t.r) * mix(0.55, 1.0, smoothstep(0.0, 0.6, t.g));',
      '    l = mix(l, up, vDown);',
      '  }',
      '  vec3 col = mix(mix(shade, lit, 0.14), lit, smoothstep(0.05, 0.95, l));',
      '  float rim = pow(1.0 - t.g, 3.0) * smoothstep(-0.2, 0.8, vSunSide);',
      '  col += sunCol * rim * (0.22 + 0.8 * pow(vToSun, 4.0));',
      '  col += sunCol * pow(vToSun, 8.0) * (1.0 - t.g) * 0.35;',
      '  float f = smoothstep(150.0, 2600.0, vDist);',
      '  col = mix(col, mix(fogCol, hazeCol, smoothstep(600.0, 2200.0, vDist)), f * 0.62);',
      // seen from steeply above a billboard can only be a cut-out: feather its rim and let it thin into the sea
      '  float ca = mix(t.a, pow(t.a, 2.6), vDown) * (1.0 - 0.72 * vDown);',
      // where a billboard dips into the cloud sea it fades, rather than being cut by a straight line
      '  ca *= smoothstep(seaY, seaY + max(4.0, vH * 0.16), vWy);',
      '  gl_FragColor = vec4(col, ca * vVar.y);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n')
  });
  var m = new T.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 2;
  stage.scene.add(m);
  var cam = stage.camera, v = new T.Vector3(), depth = new Float32Array(n), frameN = 0;
  stage.add(function () {
    if ((frameN++ % 8) !== 0) return;
    for (var i = 0; i < n; i++) { var p = puffs[i]; v.set(p.x, p.y, p.z); depth[i] = v.distanceToSquared(cam.position); }
    order.sort(function (a, b) { return depth[b] - depth[a]; });
    write();
    geo.attributes.iPos.needsUpdate = true; geo.attributes.iSize.needsUpdate = true; geo.attributes.iVar.needsUpdate = true;
  });
  return { mesh: m, puffs: puffs, refresh: function () { write(); geo.attributes.iPos.needsUpdate = true; } };
}

/* A ring of great cumulus on the horizon, and clusters drifting at mid distance. */
export function cloudscape(stage, o) {
  o = o || {};
  var r = rng(o.seed || 77), puffs = [], md = stage.mood;
  var y0 = o.y != null ? o.y : md.seaY;
  // far towers on the horizon
  var far = o.far == null ? 34 : o.far;
  for (var i = 0; i < far; i++) {
    var a = i / far * TAU + r() * 0.15, d = (o.farR || 1900) + r() * 700;
    var w = 300 + r() * 420, h = w * (0.45 + r() * 0.3);
    puffs.push({ x: Math.cos(a) * d, y: y0 + h * 0.32 - 30, z: Math.sin(a) * d, w: w, h: h, v: Math.floor(r() * 8), a: 0.95, s: 0.15 });
  }
  // mid clusters: each a few puffs, the lower ones in shade
  var mid = o.mid == null ? 16 : o.mid;
  for (i = 0; i < mid; i++) {
    a = r() * TAU; d = (o.midR0 || 120) + r() * (o.midR1 || 420);
    var cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = y0 + (o.midY || 10) + r() * (o.midYR || 26), sz = (o.midS || 40) + r() * (o.midSR || 60);
    var k = 3 + Math.floor(r() * 3);
    for (var j = 0; j < k; j++) {
      var ww = sz * (0.6 + r() * 0.7);
      puffs.push({ x: cx + (r() - 0.5) * sz * 1.4, y: cy + (j === 0 ? sz * 0.18 : (r() - 0.6) * sz * 0.25), z: cz + (r() - 0.5) * sz * 0.8, w: ww, h: ww * (0.55 + r() * 0.25), v: Math.floor(r() * 8), a: 0.97, s: j === 0 ? 0 : 0.25 + r() * 0.3 });
    }
  }
  (o.extra || []).forEach(function (p) { puffs.push(p); });
  return cloudBank(stage, puffs, md, y0);
}

/* ------------------------------------------------------------------ lights */
export function lights(stage, md, o) {
  md = md || stage.mood; o = o || {};
  var hemi = new T.HemisphereLight(md.hemiSky, md.hemiGround, md.hemiI);
  stage.scene.add(hemi);
  var key = new T.DirectionalLight(md.sun, md.sunI);
  var span = o.span || 48;
  key.position.copy(md.sunV).multiplyScalar(span * 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(stage.light ? 1024 : 2048, stage.light ? 1024 : 2048);
  var sc = key.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = span * 5;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.05; key.shadow.radius = 3;
  if (o.target) key.target.position.copy(o.target);
  stage.scene.add(key); stage.scene.add(key.target);
  var fill = new T.DirectionalLight(md.fill, md.fillI);
  fill.position.set(-md.sunV.x * 60, 30, -md.sunV.z * 60);
  stage.scene.add(fill);
  stage.setKey(md.sunV);
  return { hemi: hemi, key: key, moon: key, fill: fill, rim: fill };
}

/* ------------------------------------------------------------ nameplates */
/* A glass pill that floats over something in the world and says what it is. */
export function nameplate(title, sub, color, o) {
  o = o || {};
  var W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d'), col = new T.Color(color || 0xe8c872), css = '#' + col.getHexString();
  x.font = '400 92px "IM Fell English SC", Georgia, serif';
  var tw = x.measureText(title).width; x.font = '500 50px "Alegreya Sans", system-ui, sans-serif';
  var sw = sub ? x.measureText(sub).width : 0, w = Math.min(W - 16, Math.max(tw, sw) + 120), h = sub ? 220 : 140, x0 = (W - w) / 2, y0 = (H - h) / 2, rr = 34;
  x.beginPath(); x.moveTo(x0 + rr, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, rr); x.arcTo(x0 + w, y0 + h, x0, y0 + h, rr); x.arcTo(x0, y0 + h, x0, y0, rr); x.arcTo(x0, y0, x0 + w, y0, rr); x.closePath();
  x.fillStyle = 'rgba(14, 12, 32, 0.78)'; x.fill(); x.lineWidth = 5; x.strokeStyle = css; x.globalAlpha = 0.75; x.stroke(); x.globalAlpha = 1;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '400 92px "IM Fell English SC", Georgia, serif'; x.fillStyle = css; x.fillText(title, W / 2, sub ? y0 + 78 : H / 2 + 4);
  if (sub) { x.font = '500 50px "Alegreya Sans", system-ui, sans-serif'; x.fillStyle = 'rgba(243, 235, 221, 0.86)'; x.fillText(sub, W / 2, y0 + 160); }
  var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  var m = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
  var s = o.size || 10; m.scale.set(s, s / 4, 1); m.renderOrder = 20;
  return m;
}

/* --------------------------------------------------------- shooting stars */
/* Now and then a star falls: a thin streak, bright at its head, that crosses part of the sky. */
export function shootingStars(stage, o) {
  o = o || {};
  var r = rng(o.seed || 29), cam = stage.camera;
  var mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, side: T.DoubleSide,
    uniforms: { uA: { value: 0 }, color: { value: new T.Color(o.color || 0xe8f2ff).multiplyScalar(3.2) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA; uniform vec3 color; varying vec2 vUv; void main(){ float x = clamp(vUv.x, 0.0, 1.0); float w = clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0); float head = pow(x, 2.2) + smoothstep(0.93, 1.0, x) * 1.5; float a = clamp(head * pow(w, 1.5 + 3.5 * (1.0 - x)) * uA, 0.0, 4.0); gl_FragColor = vec4(color * a, min(a, 1.0)); }'
  });
  var m = new T.Mesh(new T.PlaneGeometry(1, 1), mat); m.frustumCulled = false; m.visible = false; m.renderOrder = -2;
  stage.scene.add(m);
  var next = 2 + r() * 4, t0 = -1, dur = 0.9, A = new T.Vector3(), D = new T.Vector3(), P = new T.Vector3(), toCam = new T.Vector3(), up = new T.Vector3(), nrm = new T.Vector3(), M4 = new T.Matrix4();
  var dist = o.dist || 1600, len = o.len || 160;
  stage.add(function (t) {
    if (t0 < 0) {
      if (t < next) return;
      // somewhere in the sky the camera can see: around its heading, in the upper part of the frame
      cam.getWorldDirection(P); var half = cam.fov * Math.PI / 360, pitch = Math.asin(clamp(P.y, -1, 1));
      if (pitch + half < 0.12) { next = t + 3; return; } // no sky in frame: wait for the camera to look up
      var az = Math.atan2(P.z, P.x) + (r() - 0.5) * half * 2.4 * cam.aspect, el = Math.max(0.06, pitch + half * (0.3 + r() * 0.55));
      el = Math.min(el, pitch + half * 0.9);
      A.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(dist).add(cam.position);
      D.set(-Math.sin(az) * (r() < 0.5 ? 1 : -1), -0.35 - r() * 0.3, Math.cos(az) * (r() < 0.5 ? 1 : -1)).normalize();
      t0 = t; dur = 0.7 + r() * 0.5; m.visible = true;
    }
    var k = (t - t0) / dur;
    if (k >= 1) { t0 = -1; m.visible = false; next = t + (o.every || 6) * (0.6 + r() * 1.2); return; }
    P.copy(A).addScaledVector(D, k * len * 2.2);
    var L = len * Math.min(1, k * 3);
    toCam.subVectors(cam.position, P).normalize(); up.crossVectors(toCam, D).normalize(); nrm.crossVectors(D, up);
    M4.makeBasis(D, up, nrm); m.quaternion.setFromRotationMatrix(M4);
    m.position.copy(P).addScaledVector(D, -L / 2); m.scale.set(L, (o.width || 6) * (dist / 1600), 1);
    mat.uniforms.uA.value = Math.sin(Math.PI * Math.min(1, k * 1.05)) * 0.9;
  });
  return m;
}

/* ------------------------------------------------------------------ motes */
export function motes(stage, o) {
  o = o || {};
  var N = o.count || 300, box = o.box || 40, pos = new Float32Array(N * 3), seed = new Float32Array(N), r = rng(o.seed || 3);
  for (var i = 0; i < N; i++) {
    pos[i * 3] = (r() - 0.5) * box; pos[i * 3 + 1] = r() * (o.h || 20) + (o.y || 0); pos[i * 3 + 2] = (r() - 0.5) * box;
    seed[i] = r() * 100;
  }
  var g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('seed', new T.BufferAttribute(seed, 1));
  var mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { time: U.uTime, color: { value: new T.Color(o.color || 0xffe08a).multiplyScalar(o.i || 2.2) }, h: { value: o.h || 20 }, pr: { value: stage.renderer.getPixelRatio() }, size: { value: o.size || 6 } },
    vertexShader: 'attribute float seed; uniform float time; uniform float h; uniform float pr; uniform float size; varying float vA; void main(){ vec3 p = position; p.y = position.y + mod(time * 0.45 + seed, h) - h * 0.5; p.x += sin(time * 0.5 + seed) * 0.9; p.z += cos(time * 0.4 + seed * 1.3) * 0.9; float life = mod(time * 0.45 + seed, h) / h; vA = (0.45 + 0.55 * sin(time * 2.6 + seed * 7.0)) * smoothstep(0.0, 0.15, life) * smoothstep(1.0, 0.7, life); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = size * pr * (30.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 color; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a * vA; gl_FragColor = vec4(color * a, a); }'
  });
  var pts = new T.Points(g, mat);
  pts.frustumCulled = false;
  stage.scene.add(pts);
  return pts;
}

/* A soft pool of shade on the cloud sea beneath an isle: it seats the isle in the air. */
export function seaShadow(stage, x, z, radius, md) {
  md = md || stage.mood;
  var c = document.createElement('canvas'); c.width = c.height = 128;
  var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  var t = new T.CanvasTexture(c);
  var m = new T.Mesh(new T.PlaneGeometry(radius * 2, radius * 2), new T.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, color: new T.Color(md.seaDeep), fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, md.seaY + 0.4, z); m.renderOrder = -4;
  stage.scene.add(m);
  return m;
}
