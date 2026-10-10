// @ts-nocheck
/* The Hallows — what a warden raises on an isle. Each is built from merged, painted parts
 * (one or two draws apiece) with its lights and living bits kept separate. */
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, G, rng, clamp, lerp, smooth, TAU, glowSprite, softDot, U, runeDisc } from './look.js';
import { prep, rgb, mixc, at, taperTube, jiggle, crystal, floraGeo, CANOPIES } from './land.js';

var V3 = function (x, y, z) { return new T.Vector3(x, y, z); };
function merged(parts, mat, shadow) { var m = new T.Mesh(mergeGeometries(parts), mat); m.castShadow = shadow !== false; m.receiveShadow = true; return m; }
var STONE = rgb(0x8f8498), STONE_D = rgb(0x5a5068), STONE_L = rgb(0xb8aeb8), MOSS = rgb(0x4f7a45), WOOD = rgb(0x5a3e2a), WOOD_D = rgb(0x3a281c), GOLD = rgb(0xe8c872), BRONZE = rgb(0x8a5a30);
var stonePaint = function (yy, xx, zz, ny) { var n = Math.sin(xx * 3.3 + zz * 2.1) * Math.sin(yy * 4.1 + xx) * 0.5 + 0.5; var c = mixc(STONE_D, STONE, n * 0.7 + 0.2); return ny > 0.75 ? mixc(c, MOSS, 0.55) : c; };
function stoneM() { return M(null, { vc: true, r: 0.92, rim: 1.0 }); }

/* a fire: flickering cones and a warm light */
function fire(g, x, y, z, s, ups) {
  var fl = [];
  for (var i = 0; i < 5; i++) { var f = new T.Mesh(new T.ConeGeometry(0.16 * s, 0.7 * s, 5), G(i % 2 ? 0xff7a3a : 0xffc04a, { i: 3 })); f.position.set(x + Math.cos(i * 1.3) * 0.25 * s, y, z + Math.sin(i * 1.3) * 0.25 * s); g.add(f); fl.push(f); }
  var gl = glowSprite(0xffa040, 2.6 * s, 0.7, 1.8); gl.position.set(x, y + 0.4 * s, z); g.add(gl);
  var L = new T.PointLight(0xffa040, 3, 8 * s, 2); L.position.set(x, y + 0.6 * s, z); g.add(L);
  ups.push(function (t) { for (var i = 0; i < fl.length; i++) fl[i].scale.y = 0.7 + 0.45 * Math.abs(Math.sin(t * 7 + i * 1.7)); L.intensity = 2.5 + Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.4; });
}

export function hallow(type, o) {
  o = o || {};
  var g = new T.Group(), ups = [];
  var r = rng(type * 13 + 5);
  if (type === 14) { // Root Delver — a mine into the isle's marrow
    var parts = [];
    // the hill it delves: raw rock threaded with the glowing ore it is mined for
    var mound = jiggle(new T.IcosahedronGeometry(1.9, 3), 0.18, 3); mound.scale(1.2, 0.7, 1); mound.translate(0, 0.2, -0.6);
    var moundM = new T.Mesh(prep(mound, stonePaint), M(null, { vc: true, r: 0.92, rim: 1, veins: { top: 2.6, scale: 1.4 }, grain: { scale: 3, amt: 0.22 } })); moundM.castShadow = moundM.receiveShadow = true; g.add(moundM);
    [-1, 1].forEach(function (s) { var post = new T.BoxGeometry(0.22, 1.7, 0.22); post.translate(0.75 * s, 0.85, 0.75); parts.push(prep(post, WOOD)); });
    var lintel = new T.BoxGeometry(2.0, 0.24, 0.3); lintel.translate(0, 1.75, 0.75); parts.push(prep(lintel, WOOD));
    var brace = new T.BoxGeometry(0.16, 0.9, 0.16); brace.rotateZ(0.8); brace.translate(-0.45, 1.45, 0.8); parts.push(prep(brace, WOOD_D));
    // rails out of the mouth and a cart heaped with wildroot
    [-1, 1].forEach(function (s) { var rl = new T.BoxGeometry(0.06, 0.06, 3.2); rl.translate(0.3 * s, 0.05, 2.1); parts.push(prep(rl, rgb(0x6a6a72))); });
    for (var i = 0; i < 7; i++) { var sl = new T.BoxGeometry(0.9, 0.06, 0.16); sl.translate(0, 0.0, 0.8 + i * 0.45); parts.push(prep(sl, WOOD_D)); }
    var cart = new T.BoxGeometry(0.85, 0.5, 0.75); cart.translate(0, 0.38, 2.8); parts.push(prep(cart, WOOD));
    [-1, 1].forEach(function (s) { [-1, 1].forEach(function (q) { var wh = new T.CylinderGeometry(0.16, 0.16, 0.06, 10); wh.rotateZ(Math.PI / 2); wh.translate(0.45 * s, 0.16, 2.8 + q * 0.25); parts.push(prep(wh, rgb(0x3a3a40))); }); });
    // the crane: a post and a treadwheel
    var mast = new T.BoxGeometry(0.18, 2.4, 0.18); mast.translate(1.9, 1.2, 0.2); parts.push(prep(mast, WOOD));
    var arm = new T.BoxGeometry(1.6, 0.14, 0.14); arm.translate(1.4, 2.35, 0.2); parts.push(prep(arm, WOOD));
    g.add(merged(parts, M(null, { vc: true, r: 0.9 })));
    var mouth = new T.Mesh(new T.PlaneGeometry(1.3, 1.5), G(0xffa040, { i: 2.2 })); mouth.position.set(0, 0.8, 0.62); g.add(mouth);
    var mg = glowSprite(0xffa040, 3, 0.55, 1.6); mg.position.set(0, 0.9, 1.0); g.add(mg);
    var ore = crystal(0xffc85a, 0.28, 3); ore.position.set(0, 0.6, 2.8); g.add(ore);
    var wheel = new T.Group(); wheel.position.set(2.0, 1.2, 0.75); g.add(wheel);
    var wp = [prep(new T.TorusGeometry(0.7, 0.07, 5, 18), WOOD)];
    for (i = 0; i < 6; i++) { var sp = new T.BoxGeometry(1.4, 0.06, 0.06); sp.rotateZ(i * Math.PI / 6); wp.push(prep(sp, WOOD_D)); }
    wheel.add(merged(wp, M(null, { vc: true, r: 0.9 })));
    var rope = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 1.2, 3), M(0xc8b48a)); rope.position.set(0.7, 1.7, 0.2); g.add(rope);
    var roots = [];
    for (i = 0; i < 6; i++) { var a = -0.6 + i * 0.25; roots.push(prep(taperTube(new T.CatmullRomCurve3([V3(Math.cos(a) * 1.4 - 1.2, 0.2, Math.sin(a) * 1.4), V3(Math.cos(a) * 2.2 - 1.2, 0.05, Math.sin(a) * 2.2), V3(Math.cos(a) * 2.9 - 1.2, -0.1, Math.sin(a) * 2.9)]), 6, 0.13, 0.03, 5), WOOD, function (yy, xx) { return Math.sin(xx * 9) > 0.7 ? [1.4, 0.7, 0.15] : null; })); }
    g.add(merged(roots, M(null, { vc: true, glow: true, r: 0.9 })));
    ups.push(function (t) { wheel.rotation.z = t * 0.7; mg.material.opacity = 0.45 + 0.15 * Math.sin(t * 3); rope.scale.y = 0.8 + 0.2 * Math.sin(t * 0.7); });
  } else if (type === 15) { // Dawn Cauldron — where wildroot becomes alpha
    var pts = [];
    for (i = 0; i <= 10; i++) { var k = i / 10; pts.push(new T.Vector2(Math.sin(k * Math.PI * 0.82) * 1.3 + 0.12 + (k > 0.92 ? 0.12 : 0), k * 1.8)); }
    var pot = new T.LatheGeometry(pts, 20);
    var potM = merged([prep(pot, function (yy) { return mixc(rgb(0x3a2418), BRONZE, smooth(0.0, 1.8, yy)); })], M(null, { vc: true, m: 0.75, r: 0.35, rim: 1.2, ds: true, flat: false }));
    potM.position.y = 0.55; g.add(potM);
    var lp = [];
    for (i = 0; i < 3; i++) { var a3 = i * TAU / 3; lp.push(prep(taperTube(new T.CatmullRomCurve3([V3(Math.cos(a3) * 0.9, 0.9, Math.sin(a3) * 0.9), V3(Math.cos(a3) * 1.25, 0.4, Math.sin(a3) * 1.25), V3(Math.cos(a3) * 1.35, 0, Math.sin(a3) * 1.35)]), 5, 0.12, 0.08, 5), rgb(0x2a1a14))); }
    var ring = new T.TorusGeometry(1.47, 0.08, 6, 28); ring.rotateX(Math.PI / 2); ring.translate(0, 2.35, 0); lp.push(prep(ring, GOLD));
    for (i = 0; i < 9; i++) { var st = jiggle(new T.DodecahedronGeometry(0.28, 0), 0.06, i); st.translate(Math.cos(i * 0.7) * 0.75, 0.05, Math.sin(i * 0.7) * 0.75); lp.push(prep(st, STONE_D)); }
    g.add(merged(lp, M(null, { vc: true, r: 0.6, m: 0.4 })));
    var brew = new T.Mesh(new T.CircleGeometry(1.32, 24), new T.ShaderMaterial({
      uniforms: { time: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; varying vec2 vUv; void main(){ vec2 p = vUv - 0.5; float r = length(p); float sw = sin(atan(p.y, p.x) * 3.0 + r * 18.0 - time * 2.0) * 0.5 + 0.5; vec3 c = mix(vec3(0.5, 1.6, 0.8), vec3(2.2, 1.9, 0.8), sw * smoothstep(0.5, 0.0, r)); gl_FragColor = vec4(c * (0.8 + 0.4 * sw), 1.0); }'
    }));
    brew.rotation.x = -Math.PI / 2; brew.position.y = 2.25; g.add(brew);
    var bg = glowSprite(0xb8ffa0, 4.5, 0.55, 1.6); bg.position.y = 2.8; g.add(bg);
    var bl = new T.PointLight(0x9affb0, 3, 9, 2); bl.position.y = 3; g.add(bl);
    fire(g, 0, 0.2, 0, 1, ups);
    var bub = [];
    for (i = 0; i < 9; i++) { var b = new T.Mesh(new T.SphereGeometry(0.11, 8, 6), G(0xd8ffc0, { i: 2, t: true, o: 0.8 })); g.add(b); bub.push(b); }
    ups.push(function (t) {
      for (var j = 0; j < bub.length; j++) { var c = (t * 0.45 + j / bub.length) % 1; bub[j].position.set(Math.cos(j * 2.4) * 0.6 * (1 - c * 0.3), 2.3 + c * 2.0, Math.sin(j * 2.4) * 0.6); bub[j].scale.setScalar(1.2 - c); }
      bg.material.opacity = 0.45 + 0.2 * Math.sin(t * 3);
    });
  } else if (type === 16) { // Ward Lantern — hangs in Starfall
    var lp2 = [];
    var cap = new T.ConeGeometry(0.75, 0.8, 8); cap.translate(0, 1.4, 0); lp2.push(prep(cap, GOLD));
    var base = new T.CylinderGeometry(0.55, 0.35, 0.3, 8); base.translate(0, -1.1, 0); lp2.push(prep(base, GOLD));
    for (i = 0; i < 8; i++) { var a4 = i / 8 * TAU; var bar = taperTube(new T.QuadraticBezierCurve3(V3(Math.cos(a4) * 0.5, -1.0, Math.sin(a4) * 0.5), V3(Math.cos(a4) * 0.85, 0.15, Math.sin(a4) * 0.85), V3(Math.cos(a4) * 0.62, 1.1, Math.sin(a4) * 0.62)), 8, 0.05, 0.04, 4); lp2.push(prep(bar, GOLD)); }
    var hook = new T.TorusGeometry(0.25, 0.05, 6, 14); hook.translate(0, 2.0, 0); lp2.push(prep(hook, GOLD));
    var finial = new T.ConeGeometry(0.1, 0.6, 6); finial.rotateX(Math.PI); finial.translate(0, -1.55, 0); lp2.push(prep(finial, GOLD));
    g.add(merged(lp2, M(null, { vc: true, m: 0.85, r: 0.3, rim: 1.3, flat: false })));
    var glass = new T.Mesh(new T.CylinderGeometry(0.6, 0.45, 2.0, 16, 1, true), M(0x9fe8ff, { t: true, o: 0.22, r: 0.05, m: 0.1, e: 0x2a6a8a, ei: 0.6, ds: true, dw: false, flat: false })); g.add(glass);
    var orb = new T.Mesh(new T.IcosahedronGeometry(0.32, 2), G(0xd8f6ff, { i: 2.2 })); g.add(orb);
    var og = glowSprite(0x9fe8ff, 3.6, 0.45, 1.5); g.add(og);
    var ll = new T.PointLight(0x9fe8ff, 3, 12, 2); g.add(ll);
    ups.push(function (t) { og.material.opacity = 0.32 + 0.14 * Math.sin(t * 2.2); orb.scale.setScalar(1 + 0.08 * Math.sin(t * 3.1)); g.rotation.z = Math.sin(t * 0.6) * 0.06; });
  } else if (type === 17) { // Veil Moon
    // a small moon: dark seas, pale highlands, and craters with bright raised rims
    var mo = new T.IcosahedronGeometry(1.0, 5), mr = rng(17);
    mo.deleteAttribute('uv'); mo.deleteAttribute('normal'); mo = mergeVertices(mo);
    var craters = []; for (i = 0; i < 46; i++) { var cr0 = mr(); craters.push([V3(mr() - 0.5, mr() - 0.5, mr() - 0.5).normalize(), 0.06 + cr0 * cr0 * 0.32]); }
    var seas = []; for (i = 0; i < 5; i++) seas.push([V3(mr() - 0.5, mr() * 0.8 - 0.3, mr() - 0.5).normalize(), 0.35 + mr() * 0.3]);
    var mp = mo.attributes.position, moonCol = new Float32Array(mp.count * 3);
    var hi = rgb(0xf4f0ff), sea = rgb(0x9a90c8), rimC = rgb(0xffffff), pit = rgb(0x7a70a8);
    for (i = 0; i < mp.count; i++) {
      var v = V3(mp.getX(i), mp.getY(i), mp.getZ(i)).normalize(), d = 1, rimK = 0, pitK = 0, seaK = 0;
      craters.forEach(function (c) { var q = v.distanceTo(c[0]) / c[1]; if (q < 1.25) { if (q < 1) { d -= (1 - q * q) * 0.085 * (0.6 + c[1] * 2); pitK = Math.max(pitK, 1 - q); } var rq = Math.max(0, 1 - Math.abs(q - 1) / 0.22); d += rq * 0.022 * (0.6 + c[1] * 2); rimK = Math.max(rimK, rq); } });
      seas.forEach(function (sd) { var q = v.distanceTo(sd[0]) / sd[1]; seaK = Math.max(seaK, smooth(1, 0.55, q)); });
      v.multiplyScalar(d); mp.setXYZ(i, v.x, v.y, v.z);
      var cc = mixc(hi, sea, seaK * 0.75); cc = mixc(cc, pit, Math.min(1, pitK * 1.4) * 0.7); cc = mixc(cc, rimC, rimK * 0.6);
      moonCol[i * 3] = cc[0]; moonCol[i * 3 + 1] = cc[1]; moonCol[i * 3 + 2] = cc[2];
    }
    mo.computeVertexNormals();
    // colour each vertex by its own index once the moon is unrolled into triangles
    var mIdx = mo.index.array, moonG = mo.toNonIndexed(), mc2 = new Float32Array(moonG.attributes.position.count * 3);
    for (i = 0; i < mIdx.length; i++) { mc2[i * 3] = moonCol[mIdx[i] * 3]; mc2[i * 3 + 1] = moonCol[mIdx[i] * 3 + 1]; mc2[i * 3 + 2] = moonCol[mIdx[i] * 3 + 2]; }
    moonG.setAttribute('color', new T.BufferAttribute(mc2, 3)); moonG.setAttribute('aGlow', new T.BufferAttribute(new Float32Array(mc2.length), 3)); moonG.deleteAttribute('uv');
    var moon = new T.Mesh(moonG, M(null, { vc: true, r: 0.9, e: 0x5a4aa0, ei: 0.4, rim: 1.4, flat: false })); moon.castShadow = true;
    g.add(moon);
    var veil = new T.Mesh(new T.SphereGeometry(1.35, 32, 16), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { time: U.uTime, c: { value: new T.Color(0xb08cff) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float time; uniform vec3 c; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(max(1.0 - abs(dot(vN, vV)), 0.0), 3.0); float s = 0.5 + 0.5 * sin(vP.y * 6.0 + time * 1.5 + sin(vP.x * 4.0 + time) * 2.0); float a = f * (0.5 + 0.5 * s) * 0.9; gl_FragColor = vec4(c * a * 1.6, a); }'
    }));
    g.add(veil);
    var rg = new T.Mesh(new T.TorusGeometry(1.9, 0.035, 4, 64), G(0xc9a0ff, { t: true, o: 0.75, i: 2 })); rg.rotation.x = 1.2; g.add(rg);
    var motes = [];
    for (i = 0; i < 5; i++) { var m2 = glowSprite(0xd8c0ff, 0.6, 0.85, 2); g.add(m2); motes.push(m2); }
    ups.push(function (t) { moon.rotation.y = t * 0.25; rg.rotation.z = t * 0.3; for (var j = 0; j < motes.length; j++) { var a5 = t * 0.6 + j * 1.25; motes[j].position.set(Math.cos(a5) * 1.9, Math.sin(a5 * 1.3) * 0.5, Math.sin(a5) * 1.9 * 0.4); } });
  } else if (type === 18) { // Barrow Vault
    var bp = [];
    var hill = new T.SphereGeometry(2.1, 28, 12, 0, TAU, 0, Math.PI / 2); hill.scale(1, 0.62, 1.1); jiggle(hill, 0.08, 2);
    // a kerb of stones rings the barrow's foot
    for (var kb = 0; kb < 22; kb++) { var ka = kb / 22 * TAU; if (Math.abs(((ka - Math.PI / 2 + TAU) % TAU) - Math.PI) < 0.35) continue; var ks = new T.BoxGeometry(0.42, 0.3 + r() * 0.12, 0.26); jiggle(ks, 0.04, 40 + kb); ks.rotateY(-ka); ks.translate(Math.cos(ka) * 2.08, 0.1, Math.sin(ka) * 2.3); bp.push(prep(ks, stonePaint)); }
    bp.push(prep(hill, function (yy, xx, zz, ny) { return mixc(rgb(0x2f5a3a), rgb(0x6f9a4a), clamp(ny, 0, 1) * 0.7 + clamp(yy, 0, 1) * 0.2); }));
    [-1, 1].forEach(function (s) { var p2 = new T.BoxGeometry(0.42, 1.6, 0.4); jiggle(p2, 0.05, 5 + s); p2.translate(0.62 * s, 0.75, 2.05); bp.push(prep(p2, stonePaint)); });
    var cap2 = new T.BoxGeometry(1.8, 0.36, 0.5); jiggle(cap2, 0.06, 9); cap2.translate(0, 1.7, 2.05); bp.push(prep(cap2, stonePaint));
    var stepG = new T.BoxGeometry(1.3, 0.16, 0.7); stepG.translate(0, 0.05, 2.4); bp.push(prep(stepG, stonePaint));
    for (i = 0; i < 7; i++) { var a6 = i / 7 * TAU + 0.45; if (Math.abs(((a6 - Math.PI / 2 + TAU) % TAU) - Math.PI) < 0.3) continue; var hgt = 1.2 + r() * 0.9; var stn = new T.BoxGeometry(0.36, hgt, 0.3, 1, 2, 1); jiggle(stn, 0.06, 20 + i); at(stn, Math.cos(a6) * 3.0, hgt / 2 - 0.1, Math.sin(a6) * 3.0, 0, -a6, (r() - 0.5) * 0.15); bp.push(prep(stn, stonePaint)); }
    g.add(merged(bp, M(null, { vc: true, r: 0.92, rim: 1, grain: { scale: 4.5, amt: 0.2 } })));
    var door = new T.Mesh(new T.PlaneGeometry(0.85, 1.35), new T.ShaderMaterial({
      uniforms: { time: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; varying vec2 vUv; void main(){ vec2 p = vUv - vec2(0.5, 0.55); float ring = smoothstep(0.03, 0.0, abs(length(p) - 0.22)); float cross = smoothstep(0.02, 0.0, abs(p.x)) * step(abs(p.y), 0.3) + smoothstep(0.02, 0.0, abs(p.y)) * step(abs(p.x), 0.22); float glyph = max(ring, cross); vec3 stone = vec3(0.16, 0.13, 0.2); vec3 c = mix(stone, vec3(2.2, 1.7, 0.7) * (0.75 + 0.25 * sin(time * 2.0)), glyph); gl_FragColor = vec4(c, 1.0); }'
    }));
    door.position.set(0, 0.78, 2.08); g.add(door);
    var dg = glowSprite(0xffd27a, 2.2, 0.35, 1.4); dg.position.set(0, 0.85, 2.3); g.add(dg);
  } else if (type === 19) { // Thunder Spire
    var tp = [];
    var tw = new T.CylinderGeometry(0.55, 0.95, 4.6, 8, 6); var tpa = tw.attributes.position;
    for (i = 0; i < tpa.count; i++) { var y = tpa.getY(i), a7 = Math.atan2(tpa.getZ(i), tpa.getX(i)); var k2 = 1 + 0.06 * Math.sin(a7 * 2 + y * 2.2); tpa.setX(i, tpa.getX(i) * k2); tpa.setZ(i, tpa.getZ(i) * k2); }
    tw.translate(0, 2.3, 0); tp.push(prep(tw, stonePaint));
    var crown = new T.CylinderGeometry(0.85, 0.6, 0.4, 8); crown.translate(0, 4.75, 0); tp.push(prep(crown, stonePaint));
    for (i = 0; i < 4; i++) { var a8 = i / 4 * TAU + 0.4; var prong = taperTube(new T.QuadraticBezierCurve3(V3(Math.cos(a8) * 0.7, 4.9, Math.sin(a8) * 0.7), V3(Math.cos(a8) * 0.95, 5.8, Math.sin(a8) * 0.95), V3(Math.cos(a8) * 0.4, 6.4, Math.sin(a8) * 0.4)), 8, 0.09, 0.03, 4); tp.push(prep(prong, rgb(0x6a7a8a))); }
    var spiral = taperTube(new T.CatmullRomCurve3(Array.from({ length: 24 }, function (_, j) { var q = j / 23; return V3(Math.cos(q * 9) * (0.98 - q * 0.38), 0.2 + q * 4.3, Math.sin(q * 9) * (0.98 - q * 0.38)); })), 80, 0.07, 0.07, 4);
    tp.push(prep(spiral, GOLD));
    g.add(merged(tp, M(null, { vc: true, r: 0.85, rim: 1, masonry: { h: 0.28, w: 0.55, amt: 0.45 } })));
    var win = new T.Mesh(new T.PlaneGeometry(0.26, 0.45), G(0xffc04a, { i: 2.5 })); win.position.set(0, 3.0, 0.78); g.add(win);
    var cr = crystal(0xa8d8ff, 0.55, 19); cr.position.y = 5.5; g.add(cr);
    var arcs = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: new T.Color(0xcfe8ff).multiplyScalar(3), transparent: true }));
    var apos = new Float32Array(4 * 6 * 2 * 3); arcs.geometry.setAttribute('position', new T.BufferAttribute(apos, 3)); arcs.frustumCulled = false; g.add(arcs);
    var bolt = glowSprite(0xa8d8ff, 3.5, 0.6, 2); bolt.position.y = 6.1; g.add(bolt);
    ups.push(function (t) {
      cr.rotation.y = t; cr.position.y = 5.5 + Math.sin(t * 1.5) * 0.15;
      var on = Math.random() < 0.18;
      arcs.visible = on; bolt.material.opacity = on ? 1 : 0.35;
      if (on) {
        var vi = 0;
        for (var p = 0; p < 4; p++) {
          var a9 = p / 4 * TAU + 0.4, ax = Math.cos(a9) * 0.4, az = Math.sin(a9) * 0.4, x0 = ax, y0 = 6.4, z0 = az;
          for (var s = 1; s <= 6; s++) { var q = s / 6, x1 = lerp(ax, 0, q) + (Math.random() - 0.5) * 0.3, y1 = lerp(6.4, 6.1, q) + (Math.random() - 0.5) * 0.3, z1 = lerp(az, 0, q) + (Math.random() - 0.5) * 0.3; apos[vi++] = x0; apos[vi++] = y0; apos[vi++] = z0; apos[vi++] = x1; apos[vi++] = y1; apos[vi++] = z1; x0 = x1; y0 = y1; z0 = z1; }
        }
        arcs.geometry.attributes.position.needsUpdate = true;
      }
    });
  } else if (type === 20) { // Mana Spring
    var sp2 = [];
    var basin = new T.CylinderGeometry(1.5, 1.7, 0.55, 14); basin.translate(0, 0.27, 0); sp2.push(prep(basin, stonePaint));
    var lip = new T.TorusGeometry(1.42, 0.12, 5, 28); lip.rotateX(Math.PI / 2); lip.translate(0, 0.56, 0); sp2.push(prep(lip, STONE_L));
    for (i = 0; i < 6; i++) { var a10 = i / 6 * TAU; var pil = new T.CylinderGeometry(0.1, 0.13, 1.6, 6); pil.translate(Math.cos(a10) * 1.55, 1.1, Math.sin(a10) * 1.55); sp2.push(prep(pil, stonePaint)); var orb2 = new T.SphereGeometry(0.12, 8, 6); orb2.translate(Math.cos(a10) * 1.55, 1.98, Math.sin(a10) * 1.55); sp2.push(prep(orb2, GOLD)); }
    g.add(merged(sp2, M(null, { vc: true, r: 0.85, masonry: { h: 0.18, w: 0.5, amt: 0.45 } })));
    var pool = new T.Mesh(new T.CircleGeometry(1.32, 28), new T.ShaderMaterial({
      uniforms: { time: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; varying vec2 vUv; void main(){ float r = length(vUv - 0.5); float w = sin(r * 40.0 - time * 3.0) * 0.5 + 0.5; vec3 c = mix(vec3(0.15, 0.7, 1.4), vec3(1.2, 2.0, 2.4), w * smoothstep(0.5, 0.0, r)); gl_FragColor = vec4(c, 1.0); }'
    }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.5; g.add(pool);
    var col = new T.Mesh(new T.CylinderGeometry(0.35, 0.55, 6, 16, 1, true), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { time: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; varying vec2 vUv; void main(){ float s = pow(sin(vUv.x * 18.0 + vUv.y * 4.0 - time * 3.0) * 0.5 + 0.5, 3.0); float a = (0.18 + s * 0.35) * smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.1, vUv.y); gl_FragColor = vec4(vec3(0.4, 1.0, 1.4) * a, a); }'
    }));
    col.position.y = 3.5; g.add(col);
    var mg2 = glowSprite(0x7ae8ff, 3.5, 0.45, 1.3); mg2.position.y = 1.0; g.add(mg2);
    var ml = new T.PointLight(0x7ae8ff, 3, 10, 2); ml.position.y = 1.5; g.add(ml);
  } else if (type === 21) { // Ley Heart
    var lp3 = [];
    var ped = new T.CylinderGeometry(1.1, 1.5, 0.8, 8); ped.translate(0, 0.4, 0); lp3.push(prep(ped, stonePaint));
    var ped2 = new T.CylinderGeometry(0.7, 0.9, 0.5, 8); ped2.translate(0, 1.05, 0); lp3.push(prep(ped2, stonePaint));
    g.add(merged(lp3, M(null, { vc: true, r: 0.85 })));
    var heart = crystal(0x6affd8, 1.6, 21); heart.position.y = 1.4; g.add(heart);
    var rings = [];
    for (i = 0; i < 3; i++) { var rgm = new T.Mesh(new T.TorusGeometry(1.9 + i * 0.45, 0.03, 5, 64), G(i === 1 ? 0xe8c872 : 0x6affd8, { i: 1.1 })); rgm.position.y = 3.0; g.add(rgm); rings.push(rgm); }
    var hg = glowSprite(0x6affd8, 4, 0.14, 1.0); hg.position.y = 3; g.add(hg);
    // let the facets read: the heart's own halo is softer here than on an isle
    heart.traverse(function (m) { if (m.isSprite) m.material.opacity *= 0.45; });
    ups.push(function (t) { heart.rotation.y = t * 0.3; heart.position.y = 1.4 + Math.sin(t * 1.1) * 0.12; for (var j = 0; j < rings.length; j++) { rings[j].rotation.x = t * (0.4 + j * 0.2); rings[j].rotation.y = t * (0.3 - j * 0.15); } });
  } else if (type === 22) { // The Worldroot
    var wp2 = [], bark = rgb(0x5a3e2e), bark2 = rgb(0x7a5a40);
    var trunk = new T.CylinderGeometry(1.0, 2.0, 8, 12, 10); var tpos = trunk.attributes.position;
    for (i = 0; i < tpos.count; i++) { var yy = tpos.getY(i), aa = Math.atan2(tpos.getZ(i), tpos.getX(i)); var tw2 = yy * 0.12, kx = 1 + Math.sin(aa * 5 + yy) * 0.08; var x = tpos.getX(i) * kx, z = tpos.getZ(i) * kx; tpos.setX(i, x * Math.cos(tw2) - z * Math.sin(tw2)); tpos.setZ(i, x * Math.sin(tw2) + z * Math.cos(tw2)); }
    trunk.translate(0, 4, 0);
    wp2.push(prep(trunk, function (yv, xv, zv) { return Math.sin(Math.atan2(zv, xv) * 10 + yv * 0.8) > 0.2 ? bark : bark2; }));
    for (i = 0; i < 9; i++) { var a11 = i / 9 * TAU; wp2.push(prep(taperTube(new T.CatmullRomCurve3([V3(Math.cos(a11) * 1.4, 1.2, Math.sin(a11) * 1.4), V3(Math.cos(a11) * 3.0, 0.3, Math.sin(a11) * 3.0), V3(Math.cos(a11 + 0.2) * 4.6, -0.2, Math.sin(a11 + 0.2) * 4.6)]), 8, 0.55, 0.08, 6), bark, function (yv, xv) { return Math.sin(xv * 4 + yv * 9) > 0.92 ? [1.6, 1.2, 0.4] : null; })); }
    for (i = 0; i < 6; i++) { var a12 = i / 6 * TAU + 0.3; wp2.push(prep(taperTube(new T.CatmullRomCurve3([V3(0, 7, 0), V3(Math.cos(a12) * 2.5, 8.6, Math.sin(a12) * 2.5), V3(Math.cos(a12) * 4.5, 9.2, Math.sin(a12) * 4.5)]), 8, 0.5, 0.12, 6), bark)); }
    g.add(merged(wp2, M(null, { vc: true, glow: true, r: 0.95, rim: 1 })));
    var cn = new T.Group(); cn.position.y = 9.5; g.add(cn);
    var cp2 = [], lo = rgb(0x3a6a3a), hi = rgb(0xe8c872);
    for (i = 0; i < 16; i++) { var ic = jiggle(new T.IcosahedronGeometry(1.4 + r() * 1.1, 1), 0.2, i); ic.translate((r() - 0.5) * 8, r() * 2.8, (r() - 0.5) * 8); cp2.push(prep(ic, function (yv, xv, zv, ny) { return mixc(lo, hi, clamp(ny * 0.5 + 0.5, 0, 1) * 0.75 + clamp((yv - 1) / 3, 0, 1) * 0.25); })); }
    cn.add(merged(cp2, M(null, { vc: true, r: 0.85, sway: 0.15, rim: 1.2, e: 0x2a3a10, ei: 0.4 })));
    var fruit = [];
    for (i = 0; i < 14; i++) { var fsp = glowSprite(0xffd27a, 0.9, 0.9, 2.2); fsp.position.set((r() - 0.5) * 7, -0.6 + r() * 1.2, (r() - 0.5) * 7); cn.add(fsp); fruit.push(fsp); }
    var wg = glowSprite(0xffe7a0, 16, 0.25, 1.2); wg.position.y = 10.5; g.add(wg);
    ups.push(function (t) { cn.rotation.y = Math.sin(t * 0.2) * 0.08; for (var j = 0; j < fruit.length; j++) fruit[j].material.opacity = 0.6 + 0.35 * Math.sin(t * 1.4 + j); });
  }
  var s = o.scale || 1; g.scale.setScalar(s);
  return { obj: g, update: function (t) { for (var i = 0; i < ups.length; i++) ups[i](t); } };
}
