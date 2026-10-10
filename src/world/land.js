// @ts-nocheck
/* The Land — sky-isles and what grows on them. An isle is a meadow on a lip of turf, a cliff
 * of banded stone, and a broken underside where alpha shows through in veins. Trees, grass,
 * stones and glowcaps are instanced and sway in one wind. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, G, mesh, rng, makeNoise, clamp, lerp, smooth, TAU, U, glowSprite, softDot, NOISE_GLSL, lightTier } from './look.js';

/* ---------------------------------------------------------- geometry kit */
/* Bring a geometry to the shape every merged part shares: non-indexed, position + normal +
 * color + aGlow, no uv. `paint(y, x, z, nY) → [r,g,b]` colours each vertex. */
function prep(geo, paint, glow) {
  // smooth normals are kept (flat-shaded materials ignore them and facet anyway)
  if (geo.index) { if (!geo.attributes.normal) geo.computeVertexNormals(); geo = geo.toNonIndexed(); }
  else if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.deleteAttribute('uv'); if (geo.attributes.uv1) geo.deleteAttribute('uv1');
  var pa = geo.attributes.position, na = geo.attributes.normal, n = pa.count;
  var col = new Float32Array(n * 3), gl = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    var c = typeof paint === 'function' ? paint(pa.getY(i), pa.getX(i), pa.getZ(i), na.getY(i)) : paint;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    if (glow) { var g = typeof glow === 'function' ? glow(pa.getY(i), pa.getX(i), pa.getZ(i), na.getY(i)) : glow; if (g) { gl[i * 3] = g[0]; gl[i * 3 + 1] = g[1]; gl[i * 3 + 2] = g[2]; } }
  }
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new T.BufferAttribute(gl, 3));
  return geo;
}
export { prep };
function rgb(hex, k) { var c = new T.Color(hex); k = k == null ? 1 : k; return [c.r * k, c.g * k, c.b * k]; }
function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export { rgb, mixc };
function at(geo, x, y, z, rx, ry, rz, sx, sy, sz) {
  var m = new T.Matrix4().compose(new T.Vector3(x || 0, y || 0, z || 0), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx || 1, sy == null ? (sx || 1) : sy, sz == null ? (sx || 1) : sz));
  geo.applyMatrix4(m); return geo;
}
export { at };
function jiggle(geo, amt, seed) {
  var pa = geo.attributes.position, r = rng(seed || 5), map = {};
  for (var i = 0; i < pa.count; i++) {
    var k = pa.getX(i).toFixed(3) + ',' + pa.getY(i).toFixed(3) + ',' + pa.getZ(i).toFixed(3);
    if (!map[k]) map[k] = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt];
    var d = map[k]; pa.setXYZ(i, pa.getX(i) + d[0], pa.getY(i) + d[1], pa.getZ(i) + d[2]);
  }
  return geo;
}
export { jiggle };

/* ----------------------------------------------------------------- the isle */
var PATH = rgb(0x8a6a4a);
var GRASS = { deep: rgb(0x24503a), mid: rgb(0x467f45), sun: rgb(0x8db35a), gold: rgb(0xc4b85e), heath: rgb(0x8a5a8a), soil: rgb(0x5e4130), sand: rgb(0xcdb58a) };

export function isle(o) {
  o = o || {};
  var R = o.radius || 16, seed = o.seed || 7, noise = makeNoise(seed), noise2 = makeNoise(seed + 101), noise3 = makeNoise(seed + 202);
  var rings = o.rings || 34, segs = o.segs || 96, depth = o.depth || R * 1.3;
  var hills = o.hills == null ? 2.6 : o.hills;
  var lake = o.lake ? { x: Math.cos(o.lakeAngle || 0.6) * R * 0.4, z: Math.sin(o.lakeAngle || 0.6) * R * 0.4, r: R * (o.lakeSize || 0.26) } : null;
  var palette = o.grass ? { deep: rgb(o.grass, 0.7), mid: rgb(o.grass), sun: rgb(o.grass2 || o.grass, 1.2), gold: GRASS.gold, heath: GRASS.heath, soil: GRASS.soil, sand: GRASS.sand } : GRASS;

  function edgeK(a) { return 1 + 0.18 * (noise(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3 + 7, 3) - 0.5) * 2; }
  var stream = null;
  if (lake) {
    var la = Math.atan2(lake.z, lake.x), rimR = R * edgeK(la);
    stream = { ax: lake.x, az: lake.z, bx: Math.cos(la) * rimR * 1.02, bz: Math.sin(la) * rimR * 1.02, w: lake.r * 0.32, ang: la, rim: rimR };
  }
  function streamDist(x, z) {
    if (!stream) return 1e9;
    var vx = stream.bx - stream.ax, vz = stream.bz - stream.az, L2 = vx * vx + vz * vz;
    var t = clamp(((x - stream.ax) * vx + (z - stream.az) * vz) / L2, 0, 1);
    return Math.hypot(x - (stream.ax + vx * t), z - (stream.az + vz * t));
  }
  function pathDist(x, z) {
    var best = 1e9;
    (o.paths || []).forEach(function (pl) {
      for (var i = 0; i < pl.length - 1; i++) {
        var ax = pl[i][0], az = pl[i][1], vx = pl[i + 1][0] - ax, vz = pl[i + 1][1] - az, L2 = vx * vx + vz * vz;
        var t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1), d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        if (d < best) best = d;
      }
    });
    return best;
  }
  function heightAt(x, z) {
    var d = Math.sqrt(x * x + z * z), a = Math.atan2(z, x), rr = d / (R * edgeK(a));
    var h = (noise(x * 0.07 + 3, z * 0.07 + 3, 4) - 0.42) * hills * 2;
    h += Math.max(0, noise(x * 0.035 + 9, z * 0.035 + 9, 2) - 0.48) * hills * 3.2;
    h *= 1 - Math.pow(clamp(rr, 0, 1), 4);
    h += 0.25 * (1 - rr * rr);
    if (lake) {
      var ld = Math.hypot(x - lake.x, z - lake.z) / lake.r;
      if (ld < 1.4) { var k = clamp((ld - 0.78) / 0.62, 0, 1); h = lerp(-1.05 + ld * 0.3, h, k * k); }
      var sd = streamDist(x, z);
      if (sd < stream.w * 2.2) { var ks = smooth(stream.w * 0.6, stream.w * 2.2, sd); h = lerp(Math.min(h, -0.75), h, ks); }
    }
    return h;
  }

  /* the meadow: smooth-shaded, painted by noise, light and wear */
  var tp = [], tc = [], ti = [];
  tp.push(0, heightAt(0, 0), 0); var c0 = mixc(palette.mid, palette.sun, 0.4); tc.push(c0[0], c0[1], c0[2]);
  for (var r = 1; r <= rings; r++) {
    for (var s = 0; s < segs; s++) {
      var a = s / segs * TAU, ek = edgeK(a), rr = r / rings;
      var x = Math.cos(a) * rr * R * ek, z = Math.sin(a) * rr * R * ek, y = heightAt(x, z);
      var n1 = noise2(x * 0.11, z * 0.11, 3), n2 = noise3(x * 0.33 + 50, z * 0.33, 2);
      var c = mixc(palette.deep, palette.mid, smooth(0.25, 0.55, n1));
      c = mixc(c, palette.sun, smooth(0.5, 0.78, n1) * 0.85);
      c = mixc(c, palette.gold, smooth(0.62, 0.85, n2) * 0.45);
      if (n2 < 0.28) c = mixc(c, palette.heath, smooth(0.28, 0.16, n2) * 0.55);
      var shade = 0.82 + 0.18 * clamp((y + 1.2) / 3, 0, 1);
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
      if (rr > 0.9) c = mixc(c, palette.soil, smooth(0.9, 1.0, rr) * 0.35);
      if (o.paths) { var pd = pathDist(x, z) + (n2 - 0.5) * 0.5; if (pd < 1.0) c = mixc(c, PATH, smooth(1.0, 0.45, pd) * 0.85); }
      if (lake) {
        var ld = Math.hypot(x - lake.x, z - lake.z);
        if (ld < lake.r * 1.15) c = mixc(c, palette.sand, smooth(lake.r * 1.15, lake.r * 0.95, ld));
        var sdd = streamDist(x, z);
        if (sdd < stream.w * 1.3) c = mixc(c, palette.sand, smooth(stream.w * 1.3, stream.w * 0.8, sdd) * 0.8);
      }
      tp.push(x, y, z); tc.push(c[0], c[1], c[2]);
    }
  }
  for (s = 0; s < segs; s++) ti.push(0, 1 + (s + 1) % segs, 1 + s);
  for (r = 1; r < rings; r++) for (s = 0; s < segs; s++) {
    var s2 = (s + 1) % segs, i0 = 1 + (r - 1) * segs + s, i1 = 1 + (r - 1) * segs + s2, i2 = 1 + r * segs + s, i3 = 1 + r * segs + s2;
    ti.push(i0, i3, i2, i0, i1, i3);
  }
  var topGeo = new T.BufferGeometry();
  topGeo.setAttribute('position', new T.Float32BufferAttribute(tp, 3));
  topGeo.setAttribute('color', new T.Float32BufferAttribute(tc, 3));
  topGeo.setIndex(ti); topGeo.computeVertexNormals();
  var top = new T.Mesh(topGeo, M(null, { vc: true, flat: false, r: 0.95, rim: 0.6, grain: { scale: 0.55, amt: 0.2 } }));
  top.castShadow = true; top.receiveShadow = true;

  /* the stone: a turf lip, a banded cliff, and the broken underside with its veins */
  var prof = [];
  prof.push({ f: 1.0, y: null, kind: 'edge' });
  prof.push({ f: 1.03, y: -0.22, kind: 'turf' });
  prof.push({ f: 1.0, y: -0.75, kind: 'soil' });
  var cliffN = 4;
  for (var k = 1; k <= cliffN; k++) prof.push({ f: 0.985 - 0.1 * (k / cliffN), y: -0.75 - (k / cliffN) * depth * 0.14, kind: 'cliff' });
  var underN = o.under || 16;
  for (k = 1; k <= underN; k++) {
    var kk = k / underN;
    prof.push({ f: 0.88 * Math.pow(1 - kk, 1.2) + 0.015, y: -0.75 - depth * 0.14 - Math.pow(kk, 0.88) * depth * 0.86, kind: 'under', k: kk });
  }
  var rp = [], rc = [], rg = [], ri = [];
  var strata = [rgb(0x9b7a63), rgb(0x7d5f5e), rgb(0xb3906e), rgb(0x6f566a), rgb(0x8c6d60)];
  var under0 = rgb(0x4a3a5a), under1 = rgb(0x1f1934), turf = mixc(palette.deep, palette.mid, 0.5), soil = rgb(0x4e3628);
  var veinA = rgb(0xffc76a, 1.5), veinB = rgb(0x5fe3c5, 1.2);
  for (var p = 0; p < prof.length; p++) {
    var P = prof[p];
    for (s = 0; s < segs; s++) {
      a = s / segs * TAU; ek = edgeK(a);
      var jag = 1, yy;
      if (P.kind === 'edge') { x = Math.cos(a) * R * ek; z = Math.sin(a) * R * ek; yy = heightAt(x, z); }
      else {
        if (P.kind === 'cliff') jag = 1 + (noise(Math.cos(a) * 7 + p * 0.3, Math.sin(a) * 7, 3) - 0.5) * 0.16;
        if (P.kind === 'under') jag = 1 + (noise(Math.cos(a) * 4 + P.k * 3, Math.sin(a) * 4 - P.k * 3, 3) - 0.5) * (0.8 * Math.sin(P.k * Math.PI) + 0.15) + (noise2(a * 9 + 5, P.k * 7, 2) - 0.5) * 0.35 * Math.sin(P.k * Math.PI);
        x = Math.cos(a) * R * ek * P.f * jag; z = Math.sin(a) * R * ek * P.f * jag;
        yy = P.y + (P.kind === 'under' ? (noise(a * 2.3, P.k * 5, 2) - 0.5) * 3.0 + (noise3(a * 11, P.k * 9, 2) - 0.5) * 1.6 : P.kind === 'cliff' ? (noise(a * 5, p, 2) - 0.5) * 1.4 : (noise(a * 3, p, 2) - 0.5) * 0.3);
        if (P.kind === 'turf') yy += heightAt(Math.cos(a) * R * ek * 0.98, Math.sin(a) * R * ek * 0.98) * 0.6;
      }
      var cc, gg = [0, 0, 0];
      if (P.kind === 'edge' || P.kind === 'turf') cc = turf;
      else if (P.kind === 'soil') cc = soil;
      else {
        var band = Math.floor(((yy * 0.7 + noise(a * 3.3, yy * 0.15, 3) * 3.4) % 5 + 5) % 5);
        cc = strata[band];
        var kd = P.kind === 'under' ? P.k : 0;
        cc = mixc(cc, under0, smooth(0.0, 0.35, kd) * 0.8);
        cc = mixc(cc, under1, smooth(0.3, 1.0, kd));
        var vn = 1 - Math.abs(noise2(a * 5.5 + 13, yy * 0.32, 3) * 2 - 1);
        if (false && P.kind === 'under' && vn > 0.93 && kd > 0.12) { var vk = smooth(0.93, 0.985, vn); gg = mixc([0, 0, 0], noise3(a * 2, yy * 0.1, 2) > 0.5 ? veinA : veinB, vk); }
      }
      rp.push(x, yy, z); rc.push(cc[0], cc[1], cc[2]); rg.push(gg[0], gg[1], gg[2]);
    }
  }
  for (p = 0; p < prof.length - 1; p++) for (s = 0; s < segs; s++) {
    s2 = (s + 1) % segs; i0 = p * segs + s; i1 = p * segs + s2; i2 = (p + 1) * segs + s; i3 = (p + 1) * segs + s2;
    ri.push(i0, i1, i2, i1, i3, i2);
  }
  var tipI = rp.length / 3; rp.push(0, -0.75 - depth * 1.02, 0); rc.push(under1[0], under1[1], under1[2]); rg.push(0, 0, 0);
  for (s = 0; s < segs; s++) ri.push((prof.length - 1) * segs + s, (prof.length - 1) * segs + (s + 1) % segs, tipI);
  var rockGeo = new T.BufferGeometry();
  rockGeo.setAttribute('position', new T.Float32BufferAttribute(rp, 3));
  rockGeo.setAttribute('color', new T.Float32BufferAttribute(rc, 3));
  rockGeo.setAttribute('aGlow', new T.Float32BufferAttribute(rg, 3));
  rockGeo.setIndex(ri);
  rockGeo = rockGeo.toNonIndexed(); rockGeo.computeVertexNormals();
  var stone = new T.Mesh(rockGeo, M(null, { vc: true, glow: true, r: 0.9, rim: 1.2, veins: { top: -0.75 - depth * 0.2, scale: 3.2 / Math.max(6, R) }, grain: { scale: 1.1, amt: 0.22 } }));
  stone.castShadow = true; stone.receiveShadow = true;

  var group = new T.Group(), land = new T.Group();
  land.add(top); land.add(stone); group.add(land);
  var out = { group: group, land: land, top: top, stone: stone, radius: R, heightAt: heightAt, lake: lake, stream: stream, depth: depth, edgeK: edgeK, updaters: [], streamDist: streamDist, pathDist: o.paths ? pathDist : null };

  if (o.spires !== false) group.add(spires(R, depth, seed, o.crystalColor));

  if (lake) {
    var water = lakeWater(lake.r * 1.1, o.waterTint);
    water.position.set(lake.x, -0.62, lake.z);
    group.add(water); out.water = water;
    // the stream to the lip, and the fall over it
    var sl = Math.hypot(stream.bx - stream.ax, stream.bz - stream.az);
    var ribbon = flowStrip(sl, stream.w * 1.25);
    ribbon.position.set((stream.ax + stream.bx) / 2, -0.66, (stream.az + stream.bz) / 2);
    ribbon.rotation.y = -stream.ang;
    group.add(ribbon);
    var fall = waterfall(depth * 1.25, stream.w * 1.5);
    fall.obj.position.set(Math.cos(stream.ang) * stream.rim * 1.015, -0.66, Math.sin(stream.ang) * stream.rim * 1.015);
    fall.obj.rotation.y = -stream.ang + Math.PI / 2;
    group.add(fall.obj);
    out.fall = fall;
  }
  if (o.roots !== false) group.add(hangings(out, seed));
  out.update = function (t) { for (var i = 0; i < out.updaters.length; i++) out.updaters[i](t); };
  out.surface = function (x, z) { return new T.Vector3(x, heightAt(x, z), z); };
  return out;
}

/* Stalactites and crystal clusters on the underside. */
function spires(R, depth, seed, crystalColor) {
  var r = rng(seed * 3 + 1), parts = [], glowParts = [];
  var stoneTop = rgb(0x3a2e4e), stoneTip = rgb(0x171226);
  for (var i = 0; i < 9; i++) {
    var a = r() * TAU, d = R * (0.12 + r() * 0.42), len = depth * (0.25 + r() * 0.35);
    var y = -0.75 - depth * (0.4 + (1 - d / R) * 0.45);
    var g = new T.ConeGeometry(R * (0.05 + r() * 0.05), len, 5, 3);
    jiggle(g, 0.35, i + seed);
    at(g, Math.cos(a) * d, y - len / 2, Math.sin(a) * d, Math.PI + (r() - 0.5) * 0.25, r() * 3, (r() - 0.5) * 0.25);
    parts.push(prep(g, function (yy) { var k = clamp((y - yy) / len, 0, 1); return mixc(stoneTop, stoneTip, k); }));
  }
  var rock = new T.Mesh(mergeGeometries(parts), M(null, { vc: true, r: 0.9 }));
  rock.castShadow = true;
  var grp = new T.Group(); grp.add(rock);
  // crystals: gold and verdigris shards breaking out of the stone
  var colA = new T.Color(crystalColor || 0x5fd3b5), colB = new T.Color(0xffc76a);
  for (i = 0; i < 7; i++) {
    a = r() * TAU; var kk = 0.15 + r() * 0.5;
    var cr = crystal(r() < 0.6 ? colA.getHex() : colB.getHex(), 0.55 + r() * 0.8, i + seed);
    var rad = R * 0.93 * Math.pow(1 - kk, 1.35);
    cr.position.set(Math.cos(a) * rad * 0.92, -0.75 - depth * 0.26 - kk * depth * 0.7, Math.sin(a) * rad * 0.92);
    cr.lookAt(cr.position.clone().multiply(new T.Vector3(2, 1, 2)).add(new T.Vector3(0, -depth * 0.3, 0)));
    cr.rotateX(Math.PI / 2);
    grp.add(cr);
  }
  return grp;
}

/* Roots that hang from the underside and vines that spill over the lip. */
function hangings(I, seed) {
  var r = rng(seed * 7 + 3), R = I.radius, roots = [], vines = [];
  var rootC = rgb(0x4a3528), rootTip = rgb(0x2a1e1a), vineC = rgb(0x2f5e3a), vineTip = rgb(0x5f8f4a);
  for (var i = 0; i < 16; i++) {
    var a = r() * TAU, k = 0.1 + r() * 0.5, rad = R * 0.93 * Math.pow(1 - k, 1.35) * 0.96;
    var x = Math.cos(a) * rad, z = Math.sin(a) * rad, y = -0.75 - I.depth * 0.26 - k * I.depth * 0.6;
    var len = R * (0.22 + r() * 0.5), pts = [];
    for (var j = 0; j <= 6; j++) { var q = j / 6; pts.push(new T.Vector3(x + Math.cos(a) * q * 1.6 + Math.sin(q * 5 + i) * 0.4, y - q * len, z + Math.sin(a) * q * 1.6 + Math.cos(q * 4 + i) * 0.4)); }
    var g = taperTube(new T.CatmullRomCurve3(pts), 14, 0.16 + r() * 0.1, 0.02, 4);
    roots.push(prep(g, function (yy) { return mixc(rootC, rootTip, clamp((y - yy) / len, 0, 1)); }));
  }
  for (i = 0; i < 18; i++) {
    a = r() * TAU; var ek = I.edgeK(a);
    x = Math.cos(a) * R * ek * 1.02; z = Math.sin(a) * R * ek * 1.02; y = I.heightAt(x * 0.97, z * 0.97) - 0.1;
    len = Math.min(2.5 + r() * 5, R * (0.2 + r() * 0.3)); pts = [];
    for (j = 0; j <= 6; j++) { q = j / 6; var out = 0.25 + Math.sin(q * Math.PI) * 0.35; pts.push(new T.Vector3(x + Math.cos(a) * out, y - q * len, z + Math.sin(a) * out)); }
    g = taperTube(new T.CatmullRomCurve3(pts), 12, 0.09, 0.03, 4);
    vines.push(prep(g, function (yy) { return mixc(vineC, vineTip, clamp((y - yy) / len, 0, 1)); }));
    // a few leaves along it
    for (var l = 0; l < 4; l++) {
      var lp = pts[1 + l];
      var lg = at(new T.IcosahedronGeometry(0.22 + r() * 0.12, 0), lp.x + Math.cos(a) * 0.12, lp.y, lp.z + Math.sin(a) * 0.12, r(), r(), r(), 1, 0.6, 1);
      vines.push(prep(lg, mixc(vineC, vineTip, r())));
    }
  }
  var grp = new T.Group();
  var rm = new T.Mesh(mergeGeometries(roots), M(null, { vc: true, r: 1 })); rm.castShadow = true;
  var vm = new T.Mesh(mergeGeometries(vines), M(null, { vc: true, r: 0.9, sway: 0.15 })); vm.castShadow = true;
  grp.add(rm); grp.add(vm);
  return grp;
}

/* A tube along a curve that narrows from r0 to r1. */
export function taperTube(curve, segs, r0, r1, radial) {
  var g = new T.TubeGeometry(curve, segs, 1, radial || 5, false);
  var pa = g.attributes.position, frames = curve.computeFrenetFrames(segs, false), v = new T.Vector3(), c = new T.Vector3();
  var per = (radial || 5) + 1;
  for (var i = 0; i <= segs; i++) {
    var k = i / segs, rad = lerp(r0, r1, k);
    curve.getPointAt(k, c);
    for (var j = 0; j < per; j++) {
      var idx = i * per + j;
      v.set(pa.getX(idx), pa.getY(idx), pa.getZ(idx)).sub(c).multiplyScalar(rad).add(c);
      pa.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  return g;
}

/* ------------------------------------------------------------------ water */
function lakeWater(radius, tint) {
  var mat = new T.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {
      deep: { value: new T.Color(tint || 0x0b2c48) }, shallow: { value: new T.Color(0x2a9aa8) }, foam: { value: new T.Color(0xeafcff) },
      skyC: { value: new T.Color(0xa898d8) }
    }]),
    vertexShader: 'varying vec2 vUv; varying vec3 vW;\n#include <fog_pars_vertex>\nvoid main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader: [
      'uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; uniform vec3 skyC; uniform float uTime;',
      'varying vec2 vUv; varying vec3 vW;',
      '#include <fog_pars_fragment>',
      NOISE_GLSL,
      'void main(){',
      '  vec2 p = vUv - 0.5; float d = length(p) * 2.0;',
      '  vec2 q = vW.xz * 0.6;',
      '  float w1 = fbm3(q + vec2(uTime * 0.12, uTime * 0.07)); float w2 = fbm3(q * 1.7 - vec2(uTime * 0.09, -uTime * 0.05));',
      '  vec3 n = normalize(vec3((w1 - 0.5) * 0.6, 1.0, (w2 - 0.5) * 0.6));',
      '  vec3 V = normalize(cameraPosition - vW);',
      '  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);',
      '  vec3 c = mix(deep, shallow, smoothstep(0.15, 1.0, d) * 0.85);',
      '  c = mix(c, skyC * 0.9, fres * 0.55);',
      '  float glint = pow(max(w1 * w2 * 3.2 - 0.6, 0.0), 3.0);',
      '  c += vec3(1.0, 0.92, 0.8) * glint * 1.6;',
      '  float shore = smoothstep(0.82, 0.96, d + (w1 - 0.5) * 0.12);',
      '  c = mix(c, foam, shore * 0.55);',
      '  float a = smoothstep(1.0, 0.95, d);',
      '  gl_FragColor = vec4(c, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '  #include <fog_fragment>',
      '}'
    ].join('\n')
  });
  mat.uniforms.uTime = U.uTime;
  var m = new T.Mesh(new T.CircleGeometry(radius, 64), mat);
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  return m;
}
/* A flat run of moving water (a stream bed), length along x. */
function flowStrip(len, w) {
  var mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { c: { value: new T.Color(0x3fc6d0) }, foam: { value: new T.Color(0xeafcff) } }]),
    vertexShader: 'varying vec2 vUv;\n#include <fog_pars_vertex>\nvoid main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader: [
      'uniform vec3 c; uniform vec3 foam; uniform float uTime; varying vec2 vUv;',
      '#include <fog_pars_fragment>',
      NOISE_GLSL,
      'void main(){',
      '  float f = fbm3(vec2(vUv.x * 6.0 - uTime * 1.4, vUv.y * 3.0));',
      '  vec3 col = mix(c * 0.7, foam, smoothstep(0.55, 0.8, f));',
      '  float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y) * smoothstep(0.0, 0.08, vUv.x) * 0.92;',
      '  gl_FragColor = vec4(col, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '  #include <fog_fragment>',
      '}'
    ].join('\n')
  });
  mat.uniforms.uTime = U.uTime;
  var g = new T.PlaneGeometry(len, w); g.rotateX(-Math.PI / 2);
  return new T.Mesh(g, mat);
}

/* A fall of water: an arcing sheet of streaks that thins into mist, with spray at the lip. */
export function waterfall(h, w) {
  var mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide, fog: false,
    uniforms: { c: { value: new T.Color(0xd6fbff) }, deep: { value: new T.Color(0x4fb8d0) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform vec3 c; uniform vec3 deep; uniform float uTime;',
      NOISE_GLSL,
      'void main(){',
      '  float y = 1.0 - vUv.y;',
      '  float streak = fbm(vec2(vUv.x * 14.0, y * 2.0 - uTime * 1.6));',
      '  float fine = vn(vec2(vUv.x * 60.0, y * 6.0 - uTime * 3.0));',
      '  float s = smoothstep(0.35, 0.75, streak * 0.75 + fine * 0.35);',
      '  float edge = smoothstep(0.0, 0.18 + y * 0.2, vUv.x) * smoothstep(1.0, 0.82 - y * 0.2, vUv.x);',
      '  float fade = smoothstep(1.0, 0.55, y);',
      '  vec3 col = mix(deep, c, s * 0.8 + 0.2) * 1.25;',
      '  float a = (0.35 + 0.65 * s) * edge * fade;',
      '  gl_FragColor = vec4(col, a);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n')
  });
  mat.uniforms.uTime = U.uTime;
  var g = new T.PlaneGeometry(w, h, 1, 24);
  g.translate(0, -h / 2, 0);
  var pa = g.attributes.position;
  for (var i = 0; i < pa.count; i++) { var y = pa.getY(i), k = clamp(-y / h, 0, 1); pa.setZ(i, Math.pow(k, 0.45) * 3.2); pa.setX(i, pa.getX(i) * (1 + k * 1.4)); }
  var m = new T.Mesh(g, mat);
  m.renderOrder = 3;
  var grp = new T.Group(); grp.add(m);
  // mist where it thins, spray where it breaks over the lip
  var N = 70, pos = new Float32Array(N * 3), sd = new Float32Array(N), r = rng(31);
  for (i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * w * 2.2; pos[i * 3 + 1] = -r() * h * 0.6; pos[i * 3 + 2] = 1 + r() * 3; sd[i] = r() * 10; }
  var pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3)); pg.setAttribute('seed', new T.BufferAttribute(sd, 1));
  var pm = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: U.uTime, h: { value: h } },
    vertexShader: 'attribute float seed; uniform float time; uniform float h; varying float vA; void main(){ vec3 p = position; float k = fract(time * 0.12 + seed * 0.1); p.y = -k * h * 0.75; p.x *= 0.6 + k * 1.2; p.z += k * 3.0; vA = smoothstep(0.0, 0.2, k) * smoothstep(1.0, 0.5, k); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (40.0 + k * 140.0) * (30.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * vA * 0.22; gl_FragColor = vec4(vec3(0.9, 0.97, 1.0) * a, a); }'
  });
  var mist = new T.Points(pg, pm); mist.frustumCulled = false; grp.add(mist);
  var spray = glowSprite(0xcff4ff, w * 2.2, 0.35, 1.2); spray.position.set(0, -0.2, 0.6); grp.add(spray);
  return { obj: grp, update: function () {} };
}

/* ------------------------------------------------------------------ crystal */
export function crystal(color, s, seed) {
  var r = rng(seed || 3), parts = [];
  var c = new T.Color(color);
  var n = 4 + Math.floor(r() * 3);
  for (var i = 0; i < n; i++) {
    var hgt = (i ? 0.9 + r() * 1.1 : 2.2), rad = i ? 0.16 + r() * 0.1 : 0.28;
    var g = new T.CylinderGeometry(0, rad, hgt * 0.25, 6, 1); g.translate(0, hgt * 0.5 + hgt * 0.125, 0);
    var body = new T.CylinderGeometry(rad, rad * 0.9, hgt, 6, 1); body.translate(0, hgt * 0.5 - 0.0, 0);
    var a = i ? r() * TAU : 0, tilt = i ? 0.35 + r() * 0.4 : 0;
    var pc = mergeGeometries([g.toNonIndexed(), body.toNonIndexed()]);
    pc.deleteAttribute('uv');
    at(pc, Math.cos(a) * (i ? 0.22 : 0), 0, Math.sin(a) * (i ? 0.22 : 0), Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    parts.push(pc);
  }
  var geo = mergeGeometries(parts); geo.computeVertexNormals();
  var pa = geo.attributes.position, col = new Float32Array(pa.count * 3);
  for (i = 0; i < pa.count; i++) { var k = clamp(pa.getY(i) / 2.4, 0, 1); col[i * 3] = lerp(0.35, 1.0, k); col[i * 3 + 1] = lerp(0.35, 1.0, k); col[i * 3 + 2] = lerp(0.45, 1.0, k); }
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  var mat = new T.MeshStandardMaterial({ color: c.clone().lerp(new T.Color(0xffffff), 0.25), emissive: c, emissiveIntensity: 0.85, roughness: 0.15, metalness: 0.2, flatShading: true, vertexColors: true, transparent: true, opacity: 0.95 });
  var m = new T.Mesh(geo, mat); m.castShadow = false;
  var grp = new T.Group(); grp.add(m);
  var gs = glowSprite(color, 3.2, 0.5, 1.4); gs.position.y = 1.0; grp.add(gs);
  grp.scale.setScalar(s || 1);
  return grp;
}

/* ------------------------------------------------------------------ flora */
var FLORA = {};
function pineGeo(v) {
  var r = rng(11 + v), parts = [];
  var trunk = new T.CylinderGeometry(0.1, 0.18, 1.0, 5); trunk.translate(0, 0.5, 0);
  parts.push(prep(trunk, rgb(0x4a3326)));
  var tiers = 4 + (v % 2), dark = rgb([0x173d33, 0x1d4536, 0x22402f][v % 3]), light = rgb([0x3d7a55, 0x4d8a58, 0x5a8a4a][v % 3]);
  for (var i = 0; i < tiers; i++) {
    var rad = 1.15 - i * (0.85 / tiers), hgt = 1.25 - i * 0.08, y0 = 0.55 + i * 0.6;
    // each tier's hem is jagged: needle tips reach out and droop, the notches between tuck in
    var rs = 14, g = new T.ConeGeometry(rad, hgt, rs, 3);
    var pa = g.attributes.position;
    for (var j = 0; j < pa.count; j++) {
      var py = pa.getY(j), px = pa.getX(j), pz = pa.getZ(j), rr = Math.hypot(px, pz);
      if (py < -hgt * 0.4 && rr > 1e-4) {
        var a = Math.atan2(pz, px), step = Math.round((a + Math.PI) / TAU * rs), tip = step % 2 === 0;
        var kk = tip ? 1.12 + r() * 0.08 : 0.8, drop = tip ? 0.2 + r() * 0.08 : 0.04;
        pa.setX(j, px * kk); pa.setZ(j, pz * kk); pa.setY(j, py - drop - Math.sin(a * 3 + i) * 0.04);
      }
    }
    g.translate(0, y0 + hgt / 2, 0); g.rotateY(r() * 3);
    parts.push(prep(g, function (yy, xx, zz) { var k = clamp((yy - y0) / hgt, 0, 1), out = clamp(Math.hypot(xx, zz) / rad, 0, 1.2); return mixc(mixc(dark, [0.04, 0.08, 0.07], 0.3), light, clamp(Math.pow(k, 0.8) * 0.75 + out * 0.3, 0, 1)); }));
  }
  return mergeGeometries(parts);
}
function broadGeo(v, pal) {
  var r = rng(41 + v), parts = [];
  var trunk = new T.CylinderGeometry(0.12, 0.22, 1.7, 6); trunk.translate(0, 0.85, 0);
  parts.push(prep(trunk, rgb(0x5a3b2c)));
  var br = new T.CylinderGeometry(0.05, 0.1, 0.9, 5); br.translate(0, 0.45, 0); br.rotateZ(0.7); br.translate(0.1, 1.3, 0);
  parts.push(prep(br, rgb(0x5a3b2c)));
  // canopy: a few great lobes crowned with smaller clumps, shaded darker underneath and within
  var lo = rgb(pal[0]), hi = rgb(pal[1]), C = new T.Vector3(0, 2.55, 0), dark = mixc(lo, [0.05, 0.06, 0.08], 0.35);
  var lobes = [[0, 2.5, 0, 0.82], [(r() - 0.5) * 0.7, 2.25 + r() * 0.2, (r() - 0.5) * 0.7, 0.7], [(r() - 0.5) * 0.8, 2.7 + r() * 0.25, (r() - 0.5) * 0.8, 0.66]];
  var n = 7 + Math.floor(r() * 4);
  for (var i = 0; i < n; i++) {
    var th = r() * TAU, ph = Math.acos(clamp(1 - r() * 1.25, -1, 1)), dd = 0.6 + r() * 0.16;
    lobes.push([Math.sin(ph) * Math.cos(th) * dd * 1.05, C.y + Math.cos(ph) * dd * 0.85, Math.sin(ph) * Math.sin(th) * dd * 1.05, 0.42 + r() * 0.2]);
  }
  lobes.forEach(function (L, k) {
    var g = new T.IcosahedronGeometry(L[3], 1);
    jiggle(g, 0.07 + L[3] * 0.06, v * 10 + k);
    g.translate(L[0], L[1], L[2]);
    parts.push(prep(g, function (yy, xx, zz, ny) {
      var out = clamp(Math.hypot(xx - C.x, (yy - C.y) * 1.15, zz - C.z) / 1.25, 0, 1);
      var k2 = clamp((yy - 1.8) / 1.6, 0, 1) * 0.5 + clamp(ny, 0, 1) * 0.3 + out * 0.2;
      var c = mixc(lo, hi, k2);
      return ny < -0.2 ? mixc(c, dark, 0.45) : mixc(dark, c, 0.55 + out * 0.45);
    }));
  });
  return mergeGeometries(parts);
}
function bushGeo(v, pal) {
  var r = rng(71 + v), parts = [], lo = rgb(pal[0]), hi = rgb(pal[1]);
  for (var i = 0; i < 3; i++) {
    var g = new T.IcosahedronGeometry(0.35 + r() * 0.25, 1); jiggle(g, 0.08, i + v);
    g.translate((r() - 0.5) * 0.6, 0.25 + r() * 0.15, (r() - 0.5) * 0.6);
    parts.push(prep(g, function (yy, xx, zz, ny) { return mixc(lo, hi, clamp(ny * 0.5 + 0.5, 0, 1)); }));
  }
  return mergeGeometries(parts);
}
function grassGeo() {
  var pos = [], col = [], r = rng(5), base = rgb(0x2a4c30), tip = rgb(0x93c25e);
  for (var i = 0; i < 11; i++) {
    var a = r() * TAU, d = r() * 0.32, x = Math.cos(a) * d, z = Math.sin(a) * d, hgt = 0.16 + r() * 0.26, lean = 0.06 + r() * 0.12, w = 0.026;
    var px = Math.cos(a + 1.57) * w, pz = Math.sin(a + 1.57) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(a) * lean, hgt, z + Math.sin(a) * lean);
    col.push(base[0], base[1], base[2], base[0], base[1], base[2], tip[0], tip[1], tip[2]);
  }
  var g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  var na = g.attributes.normal; for (i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
  g.setAttribute('aGlow', new T.BufferAttribute(new Float32Array(pos.length), 3));
  return g;
}
function flowerGeo() {
  var parts = [], stem = new T.CylinderGeometry(0.012, 0.018, 0.24, 4); stem.translate(0, 0.12, 0);
  parts.push(prep(stem, [0.42, 0.62, 0.38]));
  for (var k = 0; k < 5; k++) {
    var pe = new T.CircleGeometry(0.055, 6); pe.scale(1, 0.58, 1); pe.translate(0, 0.05, 0); pe.rotateX(-1.15); pe.rotateY(k / 5 * TAU); pe.translate(0, 0.25, 0);
    parts.push(prep(pe, [1, 1, 1]));
  }
  var eye = new T.IcosahedronGeometry(0.026, 0); eye.translate(0, 0.262, 0); parts.push(prep(eye, [1, 0.86, 0.42]));
  return mergeGeometries(parts);
}
function mushGeo() {
  var stem = new T.CylinderGeometry(0.05, 0.07, 0.35, 5); stem.translate(0, 0.17, 0);
  var cap = new T.SphereGeometry(0.2, 8, 4, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.6, 1); cap.translate(0, 0.33, 0);
  var g1 = prep(stem, rgb(0xe8dccd)), g2 = prep(cap, rgb(0x6fe8d0), [0.1, 0.75, 0.6]);
  return mergeGeometries([g1, g2]);
}
function stoneGeo(v) {
  var g = new T.DodecahedronGeometry(0.6, 0); jiggle(g, 0.18, v + 3); g.scale(1, 0.65, 1);
  var moss = rgb(0x4f7a45), st = rgb(0x8a7f92), dk = rgb(0x5a5068);
  return prep(g, function (yy, xx, zz, ny) { return ny > 0.55 ? moss : mixc(dk, st, clamp(yy + 0.3, 0, 1)); });
}
function floraGeo(kind, v, pal) {
  var key = kind + v + (pal ? pal.join('') : '');
  if (FLORA[key]) return FLORA[key];
  var g = kind === 'pine' ? pineGeo(v) : kind === 'broad' ? broadGeo(v, pal) : kind === 'bush' ? bushGeo(v, pal) : kind === 'grass' ? grassGeo() : kind === 'mush' ? mushGeo() : stoneGeo(v);
  return (FLORA[key] = g);
}
export { floraGeo };
export var CANOPIES = [[0x2d5e3c, 0x7fae58], [0x3a5e2c, 0xa8b850], [0x8a3f6a, 0xffa8c8], [0x5a3a62, 0xd8a8d0], [0x7a4a24, 0xf0b860]];

function instanced(geo, mat, list, castShadow) {
  var im = new T.InstancedMesh(geo, mat, Math.max(1, list.length));
  var m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), col = new T.Color();
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
    m4.compose(new T.Vector3(it.x, it.y, it.z), q, new T.Vector3(it.s, it.sy || it.s, it.s));
    im.setMatrixAt(i, m4);
    col.setRGB(it.c || 1, it.c || 1, it.c || 1); if (it.tint) col.multiply(it.tint);
    im.setColorAt(i, col);
  }
  im.count = list.length;
  im.castShadow = castShadow !== false; im.receiveShadow = true;
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}

/* Clothe an isle: groves where the noise gathers them, meadow grass everywhere else, stones,
 * bushes, flowers and a few glowcaps near the lip. */
export function dressIsle(I, o) {
  o = o || {};
  var r = rng(o.seed || 11), R = I.radius, avoid = o.avoid || [];
  var grove = makeNoise((o.seed || 11) + 5);
  var nTrees = o.trees == null ? 60 : o.trees;
  function free(x, z, pad) {
    if (I.lake && Math.hypot(x - I.lake.x, z - I.lake.z) < I.lake.r * 1.2 + pad) return false;
    if (I.stream && I.streamDist(x, z) < I.stream.w * 1.6 + pad) return false;
    if (I.pathDist && I.pathDist(x, z) < 0.9 + pad) return false;
    for (var i = 0; i < avoid.length; i++) if (Math.hypot(x - avoid[i].x, z - avoid[i].z) < (avoid[i].r || 2.5) + pad) return false;
    var a = Math.atan2(z, x), rr = Math.hypot(x, z) / (R * I.edgeK(a));
    return rr < 0.93;
  }
  var pines = [[], [], []], broads = {}, bushes = [], grass = [], stones = [], mush = [];
  var canopies = o.canopies || [0, 0, 1, 2, 3, 4];
  var tries = 0;
  for (var placed = 0; placed < nTrees && tries < nTrees * 30; tries++) {
    var a = r() * TAU, d = Math.sqrt(r()) * R * 0.9, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (grove(x * 0.09 + 3, z * 0.09, 3) < 0.5 - r() * 0.12) continue;
    if (!free(x, z, 0.8)) continue;
    var y = I.heightAt(x, z) - 0.08, s = 0.6 + r() * 0.75;
    if (r() < (o.pineShare == null ? 0.6 : o.pineShare)) pines[Math.floor(r() * 3)].push({ x: x, y: y, z: z, s: s, ry: r() * TAU, c: 0.85 + r() * 0.3 });
    else { var cp = canopies[Math.floor(r() * canopies.length)], v = Math.floor(r() * 2); (broads[cp + '_' + v] = broads[cp + '_' + v] || []).push({ x: x, y: y, z: z, s: s * 0.95, ry: r() * TAU, c: 0.85 + r() * 0.3 }); }
    placed++;
  }
  var nBush = o.bushes == null ? Math.round(nTrees * 0.6) : o.bushes;
  for (var i = 0, t2 = 0; i < nBush && t2 < nBush * 20; t2++) {
    a = r() * TAU; d = Math.sqrt(r()) * R * 0.9; x = Math.cos(a) * d; z = Math.sin(a) * d;
    if (!free(x, z, 0.3)) continue;
    bushes.push({ x: x, y: I.heightAt(x, z) - 0.05, z: z, s: 0.7 + r() * 0.8, ry: r() * TAU, c: 0.8 + r() * 0.35 }); i++;
  }
  var thin = lightTier() ? 0.5 : 1;
  var nGrass = Math.round((o.grass == null ? R * R * 5 : o.grass) * thin);
  for (i = 0, t2 = 0; i < nGrass && t2 < nGrass * 6; t2++) {
    a = r() * TAU; d = Math.sqrt(r()) * R * 0.95; x = Math.cos(a) * d; z = Math.sin(a) * d;
    if (I.lake && Math.hypot(x - I.lake.x, z - I.lake.z) < I.lake.r * 0.98) continue;
    if (Math.hypot(x, z) > R * I.edgeK(Math.atan2(z, x)) * 0.985) continue;
    if (I.pathDist && I.pathDist(x, z) < 0.55) continue;
    grass.push({ x: x, y: I.heightAt(x, z) - 0.03, z: z, s: 0.7 + r() * 0.9, ry: r() * TAU, c: 0.75 + r() * 0.5 }); i++;
  }
  var nStone = o.rocks == null ? 16 : o.rocks;
  for (i = 0, t2 = 0; i < nStone && t2 < nStone * 20; t2++) {
    a = r() * TAU; d = Math.sqrt(r()) * R * 0.92; x = Math.cos(a) * d; z = Math.sin(a) * d;
    if (!free(x, z, 0)) continue;
    stones.push({ x: x, y: I.heightAt(x, z) - 0.1, z: z, s: 0.5 + r() * 1.3, ry: r() * TAU, rx: (r() - 0.5) * 0.3, c: 0.85 + r() * 0.25 }); i++;
  }
  var nMush = o.glowcaps == null ? 10 : o.glowcaps;
  for (i = 0, t2 = 0; i < nMush && t2 < nMush * 30; t2++) {
    a = r() * TAU; d = R * (0.6 + r() * 0.3); x = Math.cos(a) * d; z = Math.sin(a) * d;
    if (!free(x, z, 0)) continue;
    var n0 = 2 + Math.floor(r() * 3);
    for (var j = 0; j < n0; j++) { var mx = x + (r() - 0.5) * 0.9, mz = z + (r() - 0.5) * 0.9; mush.push({ x: mx, y: I.heightAt(mx, mz) - 0.02, z: mz, s: 0.6 + r() * 0.9, ry: r() * TAU, c: 1 }); }
    i++;
  }
  var tree = M(null, { vc: true, r: 0.85, sway: 0.35, rim: 1.1, grain: { scale: 2.2, amt: 0.18 } });
  pines.forEach(function (list, v) { if (list.length) I.group.add(instanced(floraGeo('pine', v), tree, list)); });
  Object.keys(broads).forEach(function (k) { var p = k.split('_'); I.group.add(instanced(floraGeo('broad', +p[1], CANOPIES[+p[0]]), tree, broads[k])); });
  if (bushes.length) I.group.add(instanced(floraGeo('bush', 0, CANOPIES[0]), M(null, { vc: true, r: 0.9, sway: 0.2 }), bushes));
  if (grass.length) I.group.add(instanced(floraGeo('grass'), M(null, { vc: true, r: 1, ds: true, sway: 1.2, rim: 0.25, flat: false }), grass, false));
  if (stones.length) I.group.add(instanced(floraGeo('stone', 0), M(null, { vc: true, r: 0.95 }), stones));
  if (mush.length) I.group.add(instanced(floraGeo('mush'), M(null, { vc: true, glow: true, r: 0.6 }), mush, false));
  // flowers: small five-petalled heads on stems, in clumps where the meadow is open
  var nF = Math.round((o.flowers == null ? R * R * 0.5 : o.flowers) * thin), fl = [], fcol = [0xffe3f0, 0xffc76a, 0xc9a0ff, 0xffffff, 0xff8fb1, 0x9fd8ff];
  for (i = 0, t2 = 0; i < nF && t2 < nF * 12; t2++) {
    a = r() * TAU; d = Math.sqrt(r()) * R * 0.9; x = Math.cos(a) * d; z = Math.sin(a) * d;
    if (!free(x, z, 0.2) || grove(x * 0.2, z * 0.2, 2) < 0.42) continue;
    var tint = new T.Color(fcol[Math.floor(r() * fcol.length)]), nn = 3 + Math.floor(r() * 4);
    for (j = 0; j < nn; j++) { var fx = x + (r() - 0.5) * 1.1, fz = z + (r() - 0.5) * 1.1; fl.push({ x: fx, y: I.heightAt(fx, fz) - 0.02, z: fz, s: 0.8 + r() * 0.6, ry: r() * TAU, rx: (r() - 0.5) * 0.3, c: 0.9 + r() * 0.2, tint: tint }); }
    i++;
  }
  if (fl.length) I.group.add(instanced(flowerGeo(), M(null, { vc: true, ds: true, r: 0.7, sway: 1.0, rim: 0.5, e: 0x2a2030, ei: 0.25 }), fl, false));
}

/* -------------------------------------------------------------- the keep */
/* The warden's keep: a ring of curtain wall with round towers, a tall keep with a flared
 * copper roof gone green, lit windows, gold finials and banners in the wind. */
export function keep(o) {
  o = o || {};
  var g = new T.Group(), r = rng(o.seed || 5);
  var stoneA = rgb(0xc8b8b0), stoneB = rgb(0x9a8a94), stoneC = rgb(0x6e6278);
  var stonePaint = function (yy, xx, zz, ny) { var n = Math.sin(xx * 3.1 + zz * 2.3) * Math.sin(yy * 4.2) * 0.5 + 0.5; var c = mixc(stoneB, stoneA, n * 0.7 + clamp(yy / 10, 0, 1) * 0.3); return ny > 0.7 ? mixc(c, stoneC, 0.15) : c; };
  var roofA = rgb(0x2d6b62), roofB = rgb(0x5fb39a);
  var parts = [], roofs = [], gold = [], windows = [];
  function tower(x, z, rad, hgt, roofH, flare) {
    var body = new T.CylinderGeometry(rad * 0.92, rad, hgt, 12, 4); body.translate(x, hgt / 2, z);
    parts.push(prep(body, stonePaint));
    // a corbelled ring of crenels at the top
    var ring = new T.CylinderGeometry(rad * 1.12, rad * 0.95, 0.45, 12); ring.translate(x, hgt + 0.2, z);
    parts.push(prep(ring, stonePaint));
    for (var m = 0; m < 10; m++) { var a = m / 10 * TAU; var cr = new T.BoxGeometry(0.28, 0.4, 0.22); at(cr, x + Math.cos(a) * rad * 1.08, hgt + 0.62, z + Math.sin(a) * rad * 1.08, 0, -a, 0); parts.push(prep(cr, stonePaint)); }
    // roof: a lathe with flared eaves
    var pts = []; for (var k = 0; k <= 10; k++) { var q = k / 10; pts.push(new T.Vector2(Math.max(0.02, rad * (1.25 + flare) * Math.pow(1 - q, 1.6) - flare * rad * (1 - q) * q * 2), q * roofH)); }
    var roof = new T.LatheGeometry(pts, 12); roof.translate(x, hgt + 0.35, z);
    roofs.push(prep(roof, function (yy) { return mixc(roofA, roofB, clamp((yy - hgt) / roofH, 0, 1) * 0.6); }));
    var fin = new T.ConeGeometry(0.06, 1.0, 5); fin.translate(x, hgt + 0.35 + roofH + 0.45, z); gold.push(prep(fin, rgb(0xe8c872)));
    var orb = new T.SphereGeometry(0.11, 8, 6); orb.translate(x, hgt + 0.35 + roofH + 0.05, z); gold.push(prep(orb, rgb(0xe8c872)));
    // windows in a spiral up the shaft
    for (var w = 0; w < Math.floor(hgt / 1.6); w++) {
      var wa = w * 2.1 + x, wy = 1.2 + w * 1.5;
      var win = new T.PlaneGeometry(0.22, 0.42); at(win, x + Math.cos(wa) * (rad * 0.97), wy, z + Math.sin(wa) * (rad * 0.97), 0, Math.PI / 2 - wa, 0);
      windows.push(win.toNonIndexed());
    }
    return { x: x, z: z, top: hgt + 0.35 + roofH };
  }
  var main = tower(0, 0, 1.55, 8.5, 4.6, 0.25);
  tower(1.9, 1.2, 0.9, 5.6, 2.6, 0.2);
  tower(-1.7, 1.5, 0.8, 4.8, 2.3, 0.2);
  tower(-0.4, -1.9, 0.75, 6.4, 2.5, 0.2);
  // curtain wall: segments with merlons between five round towers
  var WR = o.wall || 4.6, nT = 5, towers = [];
  for (var i = 0; i < nT; i++) { var a = i / nT * TAU + 0.3; towers.push(tower(Math.cos(a) * WR, Math.sin(a) * WR, 0.62, 3.3, 1.6, 0.15)); }
  for (i = 0; i < nT; i++) {
    var A = towers[i], B = towers[(i + 1) % nT], mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, len = Math.hypot(B.x - A.x, B.z - A.z), ang = Math.atan2(B.z - A.z, B.x - A.x);
    var wall = new T.BoxGeometry(len, 2.3, 0.55); at(wall, mx, 1.15, mz, 0, -ang, 0); parts.push(prep(wall, stonePaint));
    var walk = new T.BoxGeometry(len, 0.18, 0.8); at(walk, mx, 2.35, mz, 0, -ang, 0); parts.push(prep(walk, stonePaint));
    var nm = Math.floor(len / 0.6);
    for (var m = 0; m < nm; m++) {
      var k = (m + 0.5) / nm - 0.5, merl = new T.BoxGeometry(0.32, 0.38, 0.22);
      at(merl, mx + Math.cos(ang) * k * len - Math.sin(ang) * 0.3, 2.62, mz + Math.sin(ang) * k * len + Math.cos(ang) * 0.3, 0, -ang, 0); parts.push(prep(merl, stonePaint));
    }
  }
  // the gate arch facing out
  var ga = 0.3 + TAU / nT * 0.5, gx = Math.cos(ga) * WR, gz = Math.sin(ga) * WR;
  var arch = new T.TorusGeometry(0.55, 0.14, 4, 10, Math.PI); at(arch, gx * 1.04, 1.0, gz * 1.04, 0, Math.PI / 2 - ga, 0); parts.push(prep(arch, rgb(0xd8c8b8)));
  var door = new T.PlaneGeometry(1.0, 1.4); at(door, gx * 1.065, 0.7, gz * 1.065, 0, Math.PI / 2 - ga, 0); windows.push(door.toNonIndexed());
  var base = new T.CylinderGeometry(WR * 1.1, WR * 1.2, 0.8, 16); base.translate(0, -0.3, 0); parts.push(prep(base, stonePaint));

  var stoneM = new T.Mesh(mergeGeometries(parts), M(null, { vc: true, r: 0.88, rim: 1.0, grain: { scale: 2.6, amt: 0.16 }, masonry: { h: 0.27, w: 0.52, amt: 0.45 } }));
  var roofM = new T.Mesh(mergeGeometries(roofs), M(null, { vc: true, r: 0.55, m: 0.25, rim: 1.2, ds: true, grain: { scale: 3.5, amt: 0.14 }, masonry: { h: 0.16, w: 0.24, amt: 0.5 } }));
  var goldM = new T.Mesh(mergeGeometries(gold), M(null, { vc: true, r: 0.3, m: 0.85, e: 0x5a4010, ei: 0.4 }));
  [stoneM, roofM, goldM].forEach(function (m) { m.castShadow = true; m.receiveShadow = true; g.add(m); });
  var winM = new T.Mesh(mergeGeometries(windows), G(0xffb860, { i: 3.2, ds: true }));
  g.add(winM);
  // banners
  var bmat = new T.ShaderMaterial({
    side: T.DoubleSide, fog: true,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { c: { value: new T.Color(0x8a2238) }, trim: { value: new T.Color(0xe8c872) } }]),
    vertexShader: 'uniform float uTime; varying vec2 vUv;\n#include <fog_pars_vertex>\nvoid main(){ vUv = uv; vec3 p = position; float k = uv.x; p.z += sin(uTime * 3.0 + k * 5.0 + position.y) * 0.25 * k; p.y += sin(uTime * 2.0 + k * 4.0) * 0.06 * k; vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader: 'uniform vec3 c; uniform vec3 trim; varying vec2 vUv;\n#include <fog_pars_fragment>\nvoid main(){ vec3 col = c * (0.75 + 0.25 * vUv.y); if (vUv.y < 0.1 || vUv.y > 0.9) col = trim; float sig = smoothstep(0.12, 0.1, length(vUv - vec2(0.45, 0.5)) ); col = mix(col, trim * 1.2, sig); if (vUv.x > 0.85 && abs(vUv.y - 0.5) < (vUv.x - 0.85) * 3.3) discard; gl_FragColor = vec4(col, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n}'
  });
  bmat.uniforms.uTime = U.uTime;
  [[main.x, main.z, main.top + 0.2, 1.9], [1.9, 1.2, 5.6 + 0.35 + 2.6 + 0.2, 1.2], [-0.4, -1.9, 6.4 + 0.35 + 2.5 + 0.2, 1.2]].forEach(function (b, i) {
    var pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1.4, 4), M(0xe8c872, { m: 0.8, r: 0.3 })); pole.position.set(b[0], b[2] + 0.3, b[1]); g.add(pole);
    var fl = new T.Mesh(new T.PlaneGeometry(b[3], b[3] * 0.45, 12, 3).translate(b[3] / 2, 0, 0), bmat); fl.position.set(b[0], b[2] + 0.7, b[1]); fl.rotation.y = 0.6 + i; g.add(fl);
  });
  var beacon = glowSprite(0xffd27a, 6, 0.9, 2.2); beacon.position.set(0, main.top + 1.8, 0); g.add(beacon);
  g.userData.beacon = beacon; g.userData.top = main.top;
  return g;
}

/* ------------------------------------------------------------- the hamlet */
/* Cottages with lit windows and smoking chimneys, set on the meadow. spots: [{ x, z, ry, s }] */
export function hamlet(I, spots, o) {
  o = o || {};
  var parts = [], roofParts = [], wins = [], chimneys = [], r = rng(o.seed || 13);
  var plaster = rgb(0xe6d6bc), plaster2 = rgb(0xcbb89a), timber = rgb(0x4a3326), roofs = [rgb(0x2d6b62), rgb(0x8a4a3a), rgb(0x5a4a6a), rgb(0xb08a4a)];
  spots.forEach(function (p, i) {
    var w = 1.4 + r() * 0.6, d = 1.1 + r() * 0.4, h = 0.9 + r() * 0.4, s = p.s || 1, roofC = roofs[Math.floor(r() * roofs.length)];
    var y0 = I.heightAt(p.x, p.z) - 0.05;
    var m = new T.Matrix4().compose(new T.Vector3(p.x, y0, p.z), new T.Quaternion().setFromEuler(new T.Euler(0, p.ry || r() * TAU, 0)), new T.Vector3(s, s, s));
    var walls = new T.BoxGeometry(w, h, d, 12, 8, 10); walls.translate(0, h / 2, 0);
    parts.push(prep(walls, function (yy, xx, zz) { var corner = Math.abs(Math.abs(xx) - w / 2) < 0.07 && Math.abs(Math.abs(zz) - d / 2) < 0.07; var beam = corner || Math.abs(yy - h * 0.55) < 0.05 || yy < 0.1 || yy > h - 0.07; return beam ? timber : mixc(plaster, plaster2, 0.5 + 0.5 * Math.sin(xx * 5.3 + zz * 4.1 + yy * 3.7)); }).applyMatrix4(m));
    // a pitched roof: a prism that overhangs the walls
    var rs = new T.Shape(); rs.moveTo(-w / 2 - 0.18, 0); rs.lineTo(0, 0.75 + r() * 0.25); rs.lineTo(w / 2 + 0.18, 0); rs.lineTo(-w / 2 - 0.18, 0);
    var roof = new T.ExtrudeGeometry(rs, { depth: d + 0.3, bevelEnabled: false }); roof.translate(0, h, -(d + 0.3) / 2);
    roofParts.push(prep(roof, function (yy) { return mixc(roofC, mixc(roofC, [1, 1, 1], 0.15), clamp((yy - h) / 0.9, 0, 1)); }).applyMatrix4(m));
    var ch = new T.BoxGeometry(0.22, 0.6, 0.22); ch.translate(w * 0.28, h + 0.55, 0); parts.push(prep(ch, rgb(0x6a5a5a)).applyMatrix4(m));
    chimneys.push(new T.Vector3(w * 0.28, h + 0.9, 0).applyMatrix4(m));
    var door = new T.PlaneGeometry(0.3, 0.5); door.translate(-w * 0.18, 0.25, d / 2 + 0.01); parts.push(prep(door, timber).applyMatrix4(m));
    [[w * 0.18, 0.5, d / 2 + 0.012, 0], [-w / 2 - 0.012, 0.5, 0, -Math.PI / 2], [w / 2 + 0.012, 0.5, 0, Math.PI / 2]].forEach(function (q) {
      var wg = new T.PlaneGeometry(0.24, 0.24); wg.rotateY(q[3]); wg.translate(q[0], q[1], q[2]); wins.push(wg.toNonIndexed().applyMatrix4(m));
    });
  });
  var g = new T.Group();
  var houses = new T.Mesh(mergeGeometries(parts), M(null, { vc: true, r: 0.85, rim: 1.0, grain: { scale: 3.0, amt: 0.16 } })); houses.castShadow = true; houses.receiveShadow = true; g.add(houses);
  // roofs laid in rows of shingles
  var roofs = new T.Mesh(mergeGeometries(roofParts), M(null, { vc: true, r: 0.8, rim: 1.0, grain: { scale: 4.0, amt: 0.14 }, masonry: { h: 0.1, w: 0.2, amt: 0.55, all: true } })); roofs.castShadow = true; roofs.receiveShadow = true; g.add(roofs);
  wins.forEach(function (w) { w.deleteAttribute('uv'); });
  g.add(new T.Mesh(mergeGeometries(wins), G(0xffb860, { i: 2.6, ds: true })));
  // chimney smoke: soft puffs that rise, drift and thin
  var N = chimneys.length * 14, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (var i = 0; i < N; i++) { var c = chimneys[Math.floor(i / 14)]; pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z; seed[i] = (i % 14) / 14 + r() * 0.05; }
  var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3)); sg.setAttribute('seed', new T.BufferAttribute(seed, 1));
  var sm = new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: U.uTime, pr: { value: Math.min(window.devicePixelRatio || 1, 2) }, col: { value: new T.Color(o.smoke || 0xb8aec8) } },
    vertexShader: 'attribute float seed; uniform float time; uniform float pr; varying float vA; void main(){ float k = fract(time * 0.12 + seed); vec3 p = position + vec3(sin(time * 0.6 + seed * 9.0) * 0.4 * k + k * 1.2, k * 4.0, cos(time * 0.5 + seed * 7.0) * 0.3 * k); vA = smoothstep(0.0, 0.1, k) * (1.0 - k); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (14.0 + k * 60.0) * pr * (10.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 col; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d) * vA * 0.35; gl_FragColor = vec4(col, a); }'
  });
  var smoke = new T.Points(sg, sm); smoke.frustumCulled = false; g.add(smoke);
  return g;
}

/* Lantern posts along a path. */
export function lanterns(I, pts, o) {
  o = o || {};
  var parts = [], g = new T.Group();
  pts.forEach(function (p) {
    var y0 = I.heightAt(p.x, p.z);
    var post = new T.CylinderGeometry(0.05, 0.07, 1.5, 5); post.translate(p.x, y0 + 0.75, p.z); parts.push(prep(post, rgb(0x3a2a20)));
    var arm = new T.BoxGeometry(0.4, 0.05, 0.05); arm.translate(p.x + 0.18, y0 + 1.48, p.z); parts.push(prep(arm, rgb(0x3a2a20)));
    var cage = new T.OctahedronGeometry(0.12, 0); cage.scale(1, 1.4, 1); cage.translate(p.x + 0.34, y0 + 1.3, p.z); parts.push(prep(cage, rgb(0xd8b86a)));
    var gl = glowSprite(o.color || 0xffc870, 1.3, 0.85, 2.2); gl.position.set(p.x + 0.34, y0 + 1.3, p.z); g.add(gl);
  });
  var m = new T.Mesh(mergeGeometries(parts), M(null, { vc: true, r: 0.7, m: 0.3 })); m.castShadow = true; g.add(m);
  return g;
}

/* A small flock: wing-beating chevrons wheeling around a moving centre. */
export function flock(n, o) {
  o = o || {};
  var g = new T.Group(), birds = [], r = rng(o.seed || 51);
  var geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0.25, -0.9, 0, -0.2, 0, 0, -0.15, 0, 0, 0.25, 0, 0, -0.15, 0.9, 0, -0.2], 3));
  geo.setAttribute('wing', new T.Float32BufferAttribute([0, 1, 0, 0, 0, 1], 1));
  var mat = new T.ShaderMaterial({
    side: T.DoubleSide, fog: true,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { col: { value: new T.Color(o.color || 0x241a30) }, phase: { value: 0 } }]),
    vertexShader: 'attribute float wing; uniform float uTime; uniform float phase; #include <fog_pars_vertex>\nvoid main(){ vec3 p = position; p.y += wing * sin(uTime * 9.0 + phase) * 0.55; vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}'.replace(' #include', '\n#include'),
    fragmentShader: 'uniform vec3 col;\n#include <fog_pars_fragment>\nvoid main(){ gl_FragColor = vec4(col, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n}'
  });
  mat.uniforms.uTime = U.uTime;
  for (var i = 0; i < n; i++) {
    var m = new T.Mesh(geo, mat.clone()); m.material.uniforms.uTime = U.uTime; m.material.uniforms.phase.value = r() * 10;
    m.scale.setScalar(o.size || 0.6);
    g.add(m); birds.push({ m: m, a: r() * TAU, rad: 2 + r() * 5, h: (r() - 0.5) * 3, sp: 0.6 + r() * 0.5 });
  }
  var c = new T.Vector3(), prev = new T.Vector3();
  g.userData.update = function (t) {
    var R = o.radius || 40, cy = o.y || 16;
    c.set(Math.cos(t * 0.05) * R, cy + Math.sin(t * 0.13) * 4, Math.sin(t * 0.07) * R * 0.7);
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i], a = b.a + t * b.sp;
      prev.copy(b.m.position);
      b.m.position.set(c.x + Math.cos(a) * b.rad, c.y + b.h + Math.sin(t * 0.8 + b.a) * 0.6, c.z + Math.sin(a) * b.rad);
      if (prev.lengthSq() > 0) { prev.lerp(b.m.position, 1.0); b.m.lookAt(b.m.position.x - Math.sin(a) * 2, b.m.position.y, b.m.position.z + Math.cos(a) * 2); }
    }
  };
  return g;
}
