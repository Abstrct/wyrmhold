// @ts-nocheck
/* The Beasts — bodies that move as one piece. A spine body is a tube rebuilt every frame
 * along a living centre-line (neck to tail, or a tentacle, or a serpent), with a belly and
 * a back; wings are bones with a membrane stretched between them and fold on the upstroke. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, G, rng, clamp, lerp, smooth, TAU, glowSprite, softDot } from './look.js';
import { prep, rgb, mixc, at, taperTube, jiggle } from './land.js';

/* ---------------------------------------------------------- spine bodies */
/* A tube of `n` rings × `rs` sides. radius(k) → [rx, ry]; paint(k, θ) → [r,g,b] (θ = 0 at the
 * side, π/2 on top). update(points) re-lays it along points[0..n-1] (head first). */
export function SpineBody(n, rs, radius, paint, mat) {
  var per = rs + 1, count = n * per, hc = count, tc = count + 1;
  var pos = new Float32Array((count + 2) * 3), col = new Float32Array((count + 2) * 3), idx = [];
  for (var i = 0; i < n; i++) for (var j = 0; j <= rs; j++) {
    var c = paint(i / (n - 1), j / rs * TAU), o = (i * per + j) * 3;
    col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
  }
  for (i = 0; i < n - 1; i++) for (j = 0; j < rs; j++) {
    var a = i * per + j, b = a + 1, cc = a + per, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  // caps: a rounded nose and tail, so a body seen end-on is never a hollow ring
  for (j = 0; j < rs; j++) { idx.push(hc, j, j + 1); idx.push(tc, (n - 1) * per + j + 1, (n - 1) * per + j); }
  [[hc, 0], [tc, 1]].forEach(function (q) { var c = paint(q[1], Math.PI / 2); col[q[0] * 3] = c[0]; col[q[0] * 3 + 1] = c[1]; col[q[0] * 3 + 2] = c[2]; });
  // skin coordinates (along the body, around it) stay fixed as the body bends, so scales ride with it
  var skin = new Float32Array((count + 2) * 2);
  for (i = 0; i < n; i++) for (j = 0; j <= rs; j++) { skin[(i * per + j) * 2] = i / (n - 1); skin[(i * per + j) * 2 + 1] = j / rs; }
  skin[tc * 2] = 1;
  var geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.setAttribute('aSkin', new T.BufferAttribute(skin, 2));
  geo.setIndex(idx);
  var m = new T.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  var R = [];
  for (i = 0; i < n; i++) R.push(radius(i / (n - 1)));
  var F = new T.Vector3(), L = new T.Vector3(), Up = new T.Vector3(), ref = new T.Vector3(0, 1, 0), prevL = new T.Vector3();
  var frames = [];
  for (i = 0; i < n; i++) frames.push({ p: new T.Vector3(), F: new T.Vector3(), L: new T.Vector3(), U: new T.Vector3() });
  function update(P, twist) {
    for (var i = 0; i < n; i++) {
      var a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      F.subVectors(a, b).normalize();
      if (i === 0) { L.crossVectors(ref, F); if (L.lengthSq() < 1e-6) L.set(1, 0, 0); L.normalize(); }
      else { L.copy(prevL).addScaledVector(F, -prevL.dot(F)).normalize(); }
      prevL.copy(L);
      Up.crossVectors(F, L).normalize();
      var fr = frames[i]; fr.p.copy(P[i]); fr.F.copy(F); fr.L.copy(L); fr.U.copy(Up);
      var rx = R[i][0], ry = R[i][1], tw = twist ? twist(i / (n - 1)) : 0;
      for (var j = 0; j <= rs; j++) {
        var th = j / rs * TAU + tw, cs = Math.cos(th), sn = Math.sin(th);
        var yy = sn * ry * (sn < 0 ? 0.86 : 1) + (sn > 0.92 ? (sn - 0.92) * ry * 1.2 : 0);
        var o = (i * per + j) * 3;
        pos[o] = P[i].x + L.x * cs * rx + Up.x * yy;
        pos[o + 1] = P[i].y + L.y * cs * rx + Up.y * yy;
        pos[o + 2] = P[i].z + L.z * cs * rx + Up.z * yy;
      }
    }
    var f0 = frames[0], f1 = frames[n - 1], k0 = (R[0][0] + R[0][1]) * 0.32, k1 = (R[n - 1][0] + R[n - 1][1]) * 0.32;
    pos[hc * 3] = f0.p.x + f0.F.x * k0; pos[hc * 3 + 1] = f0.p.y + f0.F.y * k0; pos[hc * 3 + 2] = f0.p.z + f0.F.z * k0;
    pos[tc * 3] = f1.p.x - f1.F.x * k1; pos[tc * 3 + 1] = f1.p.y - f1.F.y * k1; pos[tc * 3 + 2] = f1.p.z - f1.F.z * k1;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { mesh: m, update: update, frames: frames, radius: R };
}
/* Place an object on a spine frame (forward +z, up +y), offset in the frame's own axes. */
var _m4 = new T.Matrix4(), _v = new T.Vector3();
export function onFrame(obj, fr, ox, oy, oz) {
  _m4.makeBasis(fr.L, fr.U, fr.F);
  obj.quaternion.setFromRotationMatrix(_m4);
  obj.position.copy(fr.p).addScaledVector(fr.L, ox || 0).addScaledVector(fr.U, oy || 0).addScaledVector(fr.F, oz || 0);
}
function keys(points) {
  // piecewise smooth interpolation through [k, value] pairs
  return function (k) {
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      if (k <= b[0]) { var t = (k - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t); return lerp(a[1], b[1], t); }
    }
    return points[points.length - 1][1];
  };
}
export { keys };

/* ---------------------------------------------------------------- wings */
/* Bat-wing: arm, forearm and four fingers; the membrane is re-stretched every frame between
 * them and back to the flank. side = 1 (left, +x) or -1. */
function batWing(o, side) {
  var root = new T.Group();
  var sc = o.span / 5;
  var boneM = o.boneMat, memM = o.memMat;
  var shoulder = new T.Group(); root.add(shoulder);
  var L1 = 1.5 * sc, L2 = 1.9 * sc;
  var arm = new T.Mesh(at(taperTube(new T.LineCurve3(new T.Vector3(0, 0, 0), new T.Vector3(L1, 0, 0)), 3, 0.16 * sc, 0.1 * sc, 6), 0, 0, 0), boneM); arm.castShadow = true; shoulder.add(arm);
  var elbow = new T.Group(); elbow.position.x = L1; shoulder.add(elbow);
  var fore = new T.Mesh(taperTube(new T.LineCurve3(new T.Vector3(0, 0, 0), new T.Vector3(L2, 0, 0)), 3, 0.1 * sc, 0.07 * sc, 6), boneM); fore.castShadow = true; elbow.add(fore);
  var wrist = new T.Group(); wrist.position.x = L2; elbow.add(wrist);
  var claw = new T.Mesh(new T.ConeGeometry(0.06 * sc, 0.4 * sc, 5).rotateX(Math.PI / 2).translate(0, 0, 0.25 * sc), o.clawMat); wrist.add(claw);
  var fingers = [], fdef = [[0.05, 3.1], [0.6, 3.5], [1.15, 3.3], [1.75, 2.9]];
  fdef.forEach(function (f) {
    var g = new T.Group(); g.rotation.y = f[0]; wrist.add(g);
    var len = f[1] * sc;
    var bone = new T.Mesh(taperTube(new T.QuadraticBezierCurve3(new T.Vector3(0, 0, 0), new T.Vector3(len * 0.5, 0.05 * sc, -0.08 * sc), new T.Vector3(len, 0, 0)), 6, 0.06 * sc, 0.015 * sc, 5), boneM);
    bone.castShadow = true; g.add(bone);
    var tip = new T.Object3D(); tip.position.x = len; g.add(tip);
    fingers.push({ g: g, tip: tip, base: f[0] });
  });
  // the membrane: a fan around the wrist through elbow, shoulder, flank, and the scalloped edge
  var body1 = new T.Vector3(-0.1 * sc, -0.05 * sc, -1.3 * sc), body2 = new T.Vector3(-0.35 * sc, -0.2 * sc, -3.4 * sc);
  var SC = 4, ringN = 3 + 4 + (fingers.length) * SC + 1;
  var tri = (ringN - 1) * 3;
  var mpos = new Float32Array(tri * 3 * 2), mcol = new Float32Array(tri * 3 * 2);
  var mgeo = new T.BufferGeometry();
  mgeo.setAttribute('position', new T.BufferAttribute(mpos, 3));
  mgeo.setAttribute('color', new T.BufferAttribute(mcol, 3));
  var mem = new T.Mesh(mgeo, memM); mem.castShadow = true; mem.frustumCulled = false; root.add(mem);
  var inner = rgb(o.memIn), outer = rgb(o.memOut);
  var W = new T.Vector3(), E = new T.Vector3(), S = new T.Vector3(), inv = new T.Matrix4(), tips = fingers.map(function () { return new T.Vector3(); });
  var outline = [];
  for (var i = 0; i < ringN; i++) outline.push(new T.Vector3());
  function local(obj, v) { return v.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(inv); }
  function pose(flap, fold, sweep) {
    shoulder.rotation.set(0, sweep * 0.5 + fold * 0.55, flap);
    elbow.rotation.set(0, -0.35 - fold * 1.25, -flap * 0.25);
    wrist.rotation.set(0, 0.25 + fold * 1.2, -flap * 0.15);
    for (var f = 0; f < fingers.length; f++) fingers[f].g.rotation.y = fingers[f].base * (1 - fold * 0.4);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    local(wrist, W); local(elbow, E); S.set(0, 0, 0);
    for (f = 0; f < fingers.length; f++) local(fingers[f].tip, tips[f]);
    // outline, walked from the elbow round the leading edge, the tips and back along the flank
    var k = 0;
    outline[k++].copy(E);
    outline[k++].copy(S);
    outline[k++].copy(body1);
    for (var b = 1; b <= 4; b++) { var q = b / 5; outline[k++].copy(body1).lerp(body2, q).add(_v.set(0, -Math.sin(q * Math.PI) * 0.12 * sc, 0)); }
    var from = body2;
    for (f = fingers.length - 1; f >= 0; f--) {
      var to = tips[f];
      for (var s = 1; s < SC; s++) {
        var t = s / SC;
        var p = outline[k++].copy(from).lerp(to, t);
        p.lerp(W, Math.sin(t * Math.PI) * (f === fingers.length - 1 ? 0.18 : 0.26));
      }
      outline[k++].copy(to);
      from = to;
    }
    var vi = 0;
    for (i = 0; i < k - 1; i++) {
      var A = outline[i], B = outline[i + 1];
      mpos[vi * 3] = W.x; mpos[vi * 3 + 1] = W.y; mpos[vi * 3 + 2] = W.z; vi++;
      mpos[vi * 3] = A.x; mpos[vi * 3 + 1] = A.y; mpos[vi * 3 + 2] = A.z; vi++;
      mpos[vi * 3] = B.x; mpos[vi * 3 + 1] = B.y; mpos[vi * 3 + 2] = B.z; vi++;
    }
    mgeo.setDrawRange(0, vi);
    mgeo.attributes.position.needsUpdate = true;
    mgeo.computeVertexNormals();
  }
  // colours: dark at the wrist, bright at the trailing edge
  (function () {
    for (var t = 0; t < tri; t++) {
      var pleat = t % 2 ? 0.78 : 1, c0 = mixc(inner, inner, 0), c1 = mixc(inner, outer, 0.85);
      c1 = [c1[0] * pleat, c1[1] * pleat, c1[2] * pleat];
      for (var v = 0; v < 3; v++) { var c = v === 0 ? c0 : c1; var o = (t * 3 + v) * 3; mcol[o] = c[0]; mcol[o + 1] = c[1]; mcol[o + 2] = c[2]; }
    }
  })();
  if (side < 0) root.scale.x = -1;
  return { root: root, pose: pose };
}

/* ---------------------------------------------------------- the Elder Wyrm */
export function wyrm(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var back = rgb(o.back || 0x7a3416), flank = rgb(o.color || 0xe6ae44), belly = rgb(o.belly || 0xfbe8b8), stripe = rgb(o.stripe || 0x9a2a2a);
  var N = 58, RS = 14;
  var rad = keys([[0, 0.38], [0.07, 0.42], [0.17, 0.6], [0.26, 0.92], [0.34, 0.98], [0.42, 0.78], [0.5, 0.55], [0.68, 0.3], [0.88, 0.12], [1, 0.035]]);
  var spineBody = SpineBody(N, RS, function (k) { var r = rad(k); return [r, r * 0.9]; }, function (k, th) {
    var s = Math.sin(th);
    var c = s < -0.35 ? mixc(flank, belly, smooth(-0.35, -0.7, s)) : mixc(flank, back, smooth(0.1, 0.95, s));
    var band = Math.sin(k * 70) > 0.6 && s > -0.2 && k > 0.12 && k < 0.92 ? 0.82 : 1;
    if (s > 0.6 && Math.sin(k * 35 + 1) > 0.2 && k > 0.45) c = mixc(c, stripe, 0.4);
    if (s < -0.6) { var plate = Math.abs(Math.sin(k * 90)) < 0.25 ? 0.82 : 1; c = [c[0] * plate, c[1] * plate, c[2] * plate]; }
    return [c[0] * band, c[1] * band, c[2] * band];
  }, M(null, { vc: true, flat: false, r: 0.42, m: 0.3, rim: 0.8, grain: { scale: 7, amt: 0.12 }, scales: { u: 150, v: 18, amt: 0.4 } }));
  body.add(spineBody.mesh);

  /* the head */
  var head = new T.Group(); body.add(head);
  var hParts = [], horn = rgb(o.horn || 0xf3e6c4), hornTip = rgb(0x3a2a20);
  var paintHead = function (yy, xx, zz, ny) { return ny < -0.4 ? belly : mixc(flank, back, smooth(0.0, 0.5, yy) * 0.8); };
  var crown = new T.IcosahedronGeometry(0.42, 2); crown.scale(1.0, 0.72, 1.3); crown.translate(0, 0.1, 0.25); hParts.push(prep(crown, paintHead));
  var snout = new T.CylinderGeometry(0.15, 0.3, 1.15, 8, 3); snout.rotateX(Math.PI / 2); snout.scale(1, 0.62, 1); snout.translate(0, 0.02, 0.9);
  hParts.push(prep(snout, paintHead));
  var jaw = new T.CylinderGeometry(0.1, 0.22, 1.0, 7, 2); jaw.rotateX(Math.PI / 2 + 0.12); jaw.scale(1, 0.5, 1); jaw.translate(0, -0.2, 0.78);
  hParts.push(prep(jaw, belly));
  [-1, 1].forEach(function (s) {
    var brow = new T.IcosahedronGeometry(0.16, 1); brow.scale(1, 0.55, 1.9); brow.translate(0.21 * s, 0.24, 0.42); hParts.push(prep(brow, back));
    var hc = new T.CatmullRomCurve3([new T.Vector3(0.2 * s, 0.26, 0.1), new T.Vector3(0.32 * s, 0.48, -0.35), new T.Vector3(0.38 * s, 0.54, -0.95), new T.Vector3(0.34 * s, 0.4, -1.45)]);
    var hg = taperTube(hc, 12, 0.11, 0.012, 7);
    hParts.push(prep(hg, function (yy, xx, zz) { return mixc(horn, hornTip, smooth(-0.4, -1.4, zz)); }));
    var hc2 = new T.CatmullRomCurve3([new T.Vector3(0.3 * s, 0.05, 0.05), new T.Vector3(0.48 * s, 0.1, -0.35), new T.Vector3(0.55 * s, 0.02, -0.75)]);
    hParts.push(prep(taperTube(hc2, 8, 0.06, 0.01, 5), function (yy, xx, zz) { return mixc(horn, hornTip, smooth(-0.2, -0.75, zz)); }));
    for (var k = 0; k < 3; k++) { var sp = new T.ConeGeometry(0.045, 0.32, 4); sp.rotateX(-Math.PI / 2 - 0.3); sp.rotateZ(-0.5 * s); sp.translate(0.24 * s, -0.16, 0.5 - k * 0.22); hParts.push(prep(sp, horn)); }
    for (k = 0; k < 4; k++) { var th = new T.ConeGeometry(0.025, 0.1, 3); th.rotateX(Math.PI); th.translate(0.11 * s * (1 - k * 0.12), -0.09, 1.3 - k * 0.15); hParts.push(prep(th, rgb(0xfff8e8))); }
  });
  head.scale.setScalar(1.3);
  var headMesh = new T.Mesh(mergeGeometries(hParts), M(null, { vc: true, flat: false, r: 0.45, m: 0.35, rim: 0.8 }));
  headMesh.castShadow = true; head.add(headMesh);
  var eyeM = G(o.eye || 0xfff1b0, { i: 5 });
  [-1, 1].forEach(function (s) { var e = new T.Mesh(new T.SphereGeometry(0.065, 8, 6), eyeM); e.position.set(0.25 * s, 0.17, 0.5); e.scale.set(1, 0.7, 1.3); head.add(e); });
  var breath = glowSprite(o.breath || 0xffb24a, 0.9, 0.55, 1.6); breath.position.set(0, -0.04, 1.55); head.add(breath);

  /* the crest: spines along the back, smaller toward the tail, and a spade at the end */
  var spineM = M(o.spine || 0x6a1a2a, { r: 0.5, m: 0.3, rim: 1.2 });
  var crest = [];
  for (var i = 0; i < 22; i++) {
    var k = 0.06 + i / 22 * 0.8;
    var sz = (1 - Math.abs(k - 0.3) * 1.25) * 0.55 + 0.12;
    var cg = new T.ConeGeometry(0.09 * sz * 1.4, 0.55 * sz, 4); cg.translate(0, 0.27 * sz, 0); cg.rotateX(-0.6);
    var cm = new T.Mesh(cg, spineM); cm.castShadow = true; body.add(cm);
    crest.push({ m: cm, k: k });
  }
  var spadeG = new T.ConeGeometry(0.35, 0.8, 3); spadeG.rotateX(-Math.PI / 2); spadeG.scale(1, 0.2, 1);
  var spade = new T.Mesh(spadeG, spineM); body.add(spade);

  /* legs, tucked for flight */
  var legM = M(null, { vc: true, flat: false, r: 0.45, m: 0.35 });
  function leg(front, s) {
    var parts = [];
    var thigh = taperTube(new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.15 * s, -0.45, front ? 0.1 : -0.2), new T.Vector3(0.2 * s, -0.75, front ? 0.35 : -0.55)]), 6, front ? 0.2 : 0.3, 0.12, 7);
    parts.push(prep(thigh, function (yy) { return mixc(flank, back, 0.3); }));
    var shin = taperTube(new T.CatmullRomCurve3([new T.Vector3(0.2 * s, -0.75, front ? 0.35 : -0.55), new T.Vector3(0.18 * s, -0.8, front ? 0.7 : -1.0), new T.Vector3(0.16 * s, -0.7, front ? 1.0 : -1.45)]), 6, 0.12, 0.07, 6);
    parts.push(prep(shin, flank));
    for (var c = -1; c <= 1; c++) { var cl = new T.ConeGeometry(0.035, 0.25, 4); cl.rotateX(front ? Math.PI / 2 : -Math.PI / 2); cl.translate(0.16 * s + c * 0.06, -0.72, front ? 1.12 : -1.58); parts.push(prep(cl, horn)); }
    var m = new T.Mesh(mergeGeometries(parts), legM); m.castShadow = true;
    return m;
  }
  var legs = [[leg(true, 1), 0.3, 1], [leg(true, -1), 0.3, -1], [leg(false, 1), 0.47, 1], [leg(false, -1), 0.47, -1]];
  legs.forEach(function (l) { body.add(l[0]); });

  /* wings */
  var memM = M(null, { vc: true, ds: true, r: 0.7, e: o.wing || 0x7a2238, ei: 0.1, rim: 0.6, flat: false });
  var wingOpts = { span: o.span || 5.2, boneMat: M(o.bone || 0xc89040, { r: 0.4, m: 0.45, flat: false }), memMat: memM, clawMat: M(0xf3e6c4, { r: 0.4 }), memIn: o.wingIn || 0x2a0812, memOut: o.wing || 0xc8405a };
  var wl = batWing(wingOpts, 1), wr = batWing(wingOpts, -1);
  body.add(wl.root); body.add(wr.root);

  var P = []; for (i = 0; i < N; i++) P.push(new T.Vector3());
  var ctrl = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
  var curve = new T.CatmullRomCurve3(ctrl, false, 'centripetal');
  var phase = o.phase != null ? o.phase : Math.random() * 10, rate = o.flap || 1.9;
  var pose = o.pose || 'fly';
  function update(t) {
    t += phase;
    var cyc = t * rate, f = Math.sin(cyc);
    var down = f; // −1 top of the stroke, +1 bottom
    var flap = pose === 'perch' ? 0.9 + Math.sin(t * 0.8) * 0.05 : (-down * 0.75 + 0.1);
    var fold = pose === 'perch' ? 0.9 : clamp(Math.cos(cyc) * 0.4 + 0.05, 0, 0.5);
    var bob = pose === 'perch' ? 0 : down * 0.22;
    var sw = Math.sin(t * 0.7), sw2 = Math.sin(t * 1.3);
    ctrl[0].set(sw * 0.15, 1.15 + bob * 0.4 + Math.sin(t * 0.9) * 0.12, 3.0);
    ctrl[1].set(sw * 0.1, 1.0 + bob * 0.6, 2.3);
    ctrl[2].set(sw * 0.05, 0.55 + bob, 1.45);
    ctrl[3].set(0, 0.22 + bob, 0.45);
    ctrl[4].set(-sw2 * 0.15, 0.05 + bob * 0.8, -0.95);
    ctrl[5].set(Math.sin(t * 1.5 - 1) * 0.55, -0.1 + bob * 0.4 + Math.sin(t * 1.1 - 1) * 0.15, -2.7);
    ctrl[6].set(Math.sin(t * 1.5 - 2.2) * 0.9, -0.15 + Math.sin(t * 1.1 - 2) * 0.25, -4.6);
    ctrl[7].set(Math.sin(t * 1.5 - 3.4) * 1.2, -0.05 + Math.sin(t * 1.1 - 3) * 0.35, -6.6);
    curve.updateArcLengths();
    for (var i = 0; i < N; i++) curve.getPointAt(i / (N - 1), P[i]);
    spineBody.update(P);
    var fr = spineBody.frames;
    onFrame(head, fr[0], 0, 0, -0.05);
    head.rotateX(0.18 + Math.sin(t * 0.9) * 0.08); head.rotateY(Math.sin(t * 0.45) * 0.2);
    for (var c = 0; c < crest.length; c++) {
      var ki = Math.round(crest[c].k * (N - 1)), r = spineBody.radius[ki];
      onFrame(crest[c].m, fr[ki], 0, r[1] * 0.92, 0);
    }
    var last = fr[N - 1]; onFrame(spade, last, 0, 0, -0.3);
    legs.forEach(function (l) { var ki = Math.round(l[1] * (N - 1)), r = spineBody.radius[ki]; onFrame(l[0], fr[ki], l[2] * r[0] * 0.55, -r[1] * 0.5, 0); });
    var ks = Math.round(0.29 * (N - 1)), rs = spineBody.radius[ks];
    onFrame(wl.root, fr[ks], rs[0] * 0.55, rs[1] * 0.55, 0);
    onFrame(wr.root, fr[ks], -rs[0] * 0.55, rs[1] * 0.55, 0);
    wr.root.scale.x = -1;
    wl.pose(flap, fold, Math.sin(cyc + 0.6) * 0.2);
    wr.pose(flap, fold, Math.sin(cyc + 0.6) * 0.2);
    breath.material.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.3));
  }
  update(0);
  return { obj: g, update: update, flying: pose !== 'perch' };
}

/* ============================================================ the bestiary */
var V3 = function (x, y, z) { return new T.Vector3(x, y, z); };
function eyePair(parent, color, sep, y, z, r, i) {
  var m = G(color, { i: i || 4 });
  [-1, 1].forEach(function (s) { var e = new T.Mesh(new T.SphereGeometry(r || 0.07, 10, 8), m); e.position.set(sep * s, y, z); parent.add(e); });
}
function merged(parts, mat, shadow) {
  var m = new T.Mesh(mergeGeometries(parts), mat);
  m.castShadow = shadow !== false; m.receiveShadow = true;
  return m;
}
/* a feather: base P, direction D (xz), length L, width W, colours base→tip; it tapers to a
 * point, droops a little, and carries a darker band near the tip */
function feather(pos, col, P, D, L, W, c0, c1, droop) {
  var sx = -D.z, sz = D.x, dr = droop == null ? 0.06 : droop;
  var band = mixc(c1, [0, 0, 0], 0.35);
  var b1 = [P.x + sx * W * 0.5, P.y, P.z + sz * W * 0.5], b2 = [P.x - sx * W * 0.5, P.y, P.z - sz * W * 0.5];
  var m1 = [P.x + D.x * L * 0.62 + sx * W * 0.46, P.y - dr * 0.5, P.z + D.z * L * 0.62 + sz * W * 0.46], m2 = [P.x + D.x * L * 0.62 - sx * W * 0.46, P.y - dr * 0.5, P.z + D.z * L * 0.62 - sz * W * 0.46];
  var n1 = [P.x + D.x * L * 0.86 + sx * W * 0.3, P.y - dr * 0.8, P.z + D.z * L * 0.86 + sz * W * 0.3], n2 = [P.x + D.x * L * 0.86 - sx * W * 0.3, P.y - dr * 0.8, P.z + D.z * L * 0.86 - sz * W * 0.3];
  var tp = [P.x + D.x * L, P.y - dr, P.z + D.z * L];
  var cm = mixc(c0, c1, 0.7);
  [[b1, c0], [b2, c0], [m1, cm], [b2, c0], [m2, cm], [m1, cm], [m1, cm], [m2, cm], [n1, band], [m2, cm], [n2, band], [n1, band], [n1, band], [n2, band], [tp, band]].forEach(function (v) { pos.push(v[0][0], v[0][1], v[0][2]); col.push(v[1][0], v[1][1], v[1][2]); });
}
function featherGeo(build) {
  var pos = [], col = [];
  build(pos, col);
  var g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/* A feathered wing: secondaries along the arm, long slender primaries fanned from the hand
 * like fingers, and a lighter layer of coverts on top. */
function featherWing(o, side) {
  var root = new T.Group(), sh = new T.Group(); root.add(sh);
  var hand = new T.Group(); hand.position.x = o.arm; sh.add(hand);
  var base = rgb(o.c0), tip = rgb(o.c1), cov = rgb(o.c2 || o.c0);
  var armG = featherGeo(function (pos, col) {
    for (var i = 0; i < 8; i++) { var k = i / 7; feather(pos, col, V3(k * o.arm, 0, 0.04), V3(0.1 + k * 0.12, 0, -1).normalize(), o.sec * (1.05 - k * 0.12), o.arm / 4.6, base, tip, 0.05); }
    for (i = 0; i < 9; i++) { k = i / 8; feather(pos, col, V3(k * o.arm, 0.025, 0.1), V3(0.15, 0, -1).normalize(), o.sec * 0.55, o.arm / 5, cov, mixc(cov, base, 0.6), 0.03); }
  });
  var handG = featherGeo(function (pos, col) {
    for (var i = 0; i < 7; i++) { var k = i / 6, a = -0.08 + k * 1.05; feather(pos, col, V3(k * o.hand * 0.35, -0.01, 0.0), V3(Math.cos(a), 0, -Math.sin(a)), o.prim * (1.0 - k * 0.28), o.hand / 6.2, base, tip, 0.12); }
    for (i = 0; i < 6; i++) { k = i / 5; feather(pos, col, V3(k * o.hand * 0.42, 0.03, 0.06), V3(Math.cos(0.35 + k * 0.6), 0, -Math.sin(0.35 + k * 0.6)), o.prim * 0.42, o.hand / 5.2, cov, mixc(cov, base, 0.5), 0.04); }
  });
  var mat = o.mat;
  var am = new T.Mesh(armG, mat), hm = new T.Mesh(handG, mat); am.castShadow = hm.castShadow = true;
  sh.add(am); hand.add(hm);
  if (side < 0) root.scale.x = -1;
  return {
    root: root,
    pose: function (flap, fold) {
      sh.rotation.set(0, fold * 0.45, flap);
      hand.rotation.set(0, -0.1 + fold * 1.0, flap * 0.45);
    }
  };
}
function tailFan(n, len, w, c0, c1, spread) {
  return featherGeo(function (pos, col) {
    for (var i = 0; i < n; i++) { var a = (i / (n - 1) - 0.5) * (spread || 1.0); feather(pos, col, V3(0, 0, 0), V3(Math.sin(a), 0, -Math.cos(a)), len * (1 - Math.abs(a) * 0.2), w, rgb(c0), rgb(c1), 0.04); }
  });
}

/* ------------------------------------------------------- birds of the Skies */
/* One tapered body from the crown of the head to the root of the tail; a beak (hooked for
 * raptors), feathered wings that fold on the upstroke, a fanned tail and legs tucked back. */
function bird(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var N = 18, len = o.len || 2.4, hs = o.headS || 1;
  var rad = keys(o.rad || [[0, 0.13 * hs], [0.05, 0.22 * hs], [0.12, 0.25 * hs], [0.2, 0.19], [0.32, 0.36], [0.46, 0.44], [0.62, 0.41], [0.8, 0.26], [0.92, 0.15], [1, 0.09]]);
  var top = rgb(o.back), bel = rgb(o.belly), headC = rgb(o.head || o.back), face = rgb(o.face || o.belly);
  var sb = SpineBody(N, 14, function (k) { var r = rad(k) * (o.girth || 1); return [r, r * 1.08]; }, function (k, th) {
    var s = Math.sin(th);
    if (k < 0.2) { var c = s < -0.15 ? face : headC; return k > 0.15 ? mixc(c, mixc(bel, top, smooth(-0.6, 0.5, s)), (k - 0.15) / 0.05) : c; }
    var c2 = mixc(bel, top, smooth(-0.55, 0.45, s));
    if (s < -0.3 && Math.sin(k * 60 + th * 4) > 0.6) c2 = mixc(c2, top, 0.25);
    return c2;
  }, M(null, { vc: true, flat: false, r: 0.8, rim: 0.9, t: !!o.ghost, o: o.ghost || 1, e: o.glow || 0, ei: o.glowI || 0, scales: { u: 46, v: 12, amt: 0.32 } }));
  body.add(sb.mesh);
  var head = new T.Group(); body.add(head);
  var hParts = [], beakC = rgb(o.beakC || 0xe0a93a), beakD = mixc(beakC, [0, 0, 0], 0.45);
  var bl = 0.36 * (o.beakL || 1) * hs;
  var up = new T.ConeGeometry(0.1 * hs, bl, 7); up.rotateX(Math.PI / 2); up.translate(0, 0.02, bl / 2 + 0.04);
  hParts.push(prep(up, function (yy, xx, zz) { return mixc(beakC, beakD, smooth(0, bl, zz)); }));
  if (o.hook) { var hk = new T.ConeGeometry(0.045 * hs, 0.16 * hs, 5); hk.rotateX(Math.PI * 0.9); hk.translate(0, -0.05, bl + 0.02); hParts.push(prep(hk, beakD)); }
  var lo = new T.ConeGeometry(0.07 * hs, bl * 0.8, 6); lo.rotateX(Math.PI / 2 + 0.12); lo.translate(0, -0.06, bl * 0.4 + 0.04); hParts.push(prep(lo, beakD));
  if (o.tufts) [-1, 1].forEach(function (s) { var tf = new T.ConeGeometry(0.07 * hs, 0.42 * hs, 5); tf.rotateZ(-0.4 * s); tf.rotateX(-0.3); tf.translate(0.17 * hs * s, 0.3 * hs, -0.12); hParts.push(prep(tf, headC)); });
  if (o.crest) for (var c = 0; c < 5; c++) { var cr = new T.ConeGeometry(0.035, 0.5 - c * 0.07, 4); cr.translate(0, 0.25, 0); cr.rotateX(-1.25 - c * 0.12); cr.translate(0, 0.16 * hs, -0.1 - c * 0.09); hParts.push(prep(cr, rgb(o.crest))); }
  if (o.disc) { var dg = new T.SphereGeometry(0.26 * hs, 16, 8, 0, TAU, 0, Math.PI * 0.42); dg.rotateX(Math.PI / 2); dg.scale(1.15, 1, 0.35); dg.translate(0, 0.02, 0.06); hParts.push(prep(dg, function (yy, xx, zz) { var hr = Math.hypot(xx, yy) / hs; var c = mixc(rgb(o.disc), headC, smooth(0.12, 0.3, hr)); return mixc(c, [0.08, 0.06, 0.12], smooth(0.17, 0.215, hr) * (1 - smooth(0.24, 0.29, hr)) * 0.75); })); }
  head.add(merged(hParts, M(null, { vc: true, flat: false, r: 0.55, rim: 0.9, t: !!o.ghost, o: o.ghost || 1 })));
  var eyes = new T.Group(); head.add(eyes);
  eyePair(eyes, o.eye || 0x9ff4ff, (o.eyeSep || 0.16) * hs, 0.06 * hs, o.disc ? 0.1 : -0.02, (o.eyeR || 0.05) * hs, o.eyeI || 4);
  if (o.disc) {
    // an owl's stare: a dark pupil in each eye and a spark of light on it
    var er = (o.eyeR || 0.05) * hs, es = (o.eyeSep || 0.16) * hs, pupM = new T.MeshBasicMaterial({ color: 0x0a0612 }), sparkM = G(0xffffff, { i: 2.5 });
    [-1, 1].forEach(function (sd) {
      var pu = new T.Mesh(new T.SphereGeometry(er * 0.56, 12, 8), pupM); pu.scale.z = 0.5; pu.position.set(es * sd, 0.06 * hs, 0.1 + er * 0.72); eyes.add(pu);
      var sp = new T.Mesh(new T.SphereGeometry(er * 0.17, 8, 6), sparkM); sp.position.set(es * sd + er * 0.25, 0.06 * hs + er * 0.3, 0.1 + er * 0.98); eyes.add(sp);
    });
  }
  var fm = M(null, { vc: true, ds: true, r: 0.85, rim: 0.9, flat: false, e: o.edge || 0, ei: o.edgeI || 0, t: !!o.ghost, o: o.ghost || 1 });
  var wo = { arm: (o.span || 3.2) * 0.3, hand: (o.span || 3.2) * 0.42, sec: o.sec || 0.95, prim: o.prim || 1.55, c0: o.wing0, c1: o.wing1, c2: o.cov, mat: fm };
  var wl = featherWing(wo, 1), wr = featherWing(wo, -1); body.add(wl.root); body.add(wr.root);
  var tail = new T.Mesh(tailFan(o.tailN || 9, o.tailL || 1.0, 0.2, o.wing0, o.wing1, o.tailSpread || 0.9), fm); tail.castShadow = true; body.add(tail);
  var lion = null;
  if (o.lion) {
    lion = SpineBody(10, 6, function (k) { var r = lerp(0.09, 0.035, k); return [r, r]; }, function () { return rgb(o.lion); }, M(null, { vc: true, flat: false, r: 0.8 }));
    body.add(lion.mesh);
    var tuft = new T.Mesh(new T.IcosahedronGeometry(0.15, 1), M(o.tuft || 0x6a4a2a, { r: 0.9, flat: false })); body.add(tuft); lion.tuft = tuft;
  }
  // legs: tucked back along the belly in flight; a gryphon's forelegs reach forward with talons
  var legs = [], legM = M(o.leg || 0x8a6a40, { r: 0.7, flat: false });
  (o.quad ? [[0.36, 1, 1], [0.36, -1, 1], [0.8, 1, 0], [0.8, -1, 0]] : [[0.66, 1, 0], [0.66, -1, 0]]).forEach(function (l) {
    var lg = new T.Group(), front = l[2], lc = o.quad && !front ? rgb(o.lion || 0xb08a4a) : rgb(o.leg || 0x8a6a40);
    var pts = front ? [V3(0, 0, 0), V3(0, -0.28, 0.12), V3(0, -0.42, 0.42)] : [V3(0, 0, 0), V3(0, -0.2, -0.18), V3(0, -0.24, -0.62)];
    var parts = [prep(taperTube(new T.CatmullRomCurve3(pts), 6, o.quad && !front ? 0.12 : 0.07, 0.04, 6), lc)];
    var end = pts[2];
    for (var t = -1; t <= 1; t++) { var tl = new T.ConeGeometry(0.025, 0.16, 4); tl.rotateX(front ? Math.PI / 2 + 0.4 : -Math.PI / 2 - 0.3); tl.translate(end.x + t * 0.045, end.y - 0.02, end.z + (front ? 0.07 : -0.06)); parts.push(prep(tl, rgb(0x2a2018))); }
    lg.add(merged(parts, M(null, { vc: true, r: 0.7, flat: false })));
    body.add(lg); legs.push({ g: lg, k: l[0], s: l[1] });
  });
  var sparks = null;
  if (o.storm) { sparks = glowSprite(0x9fe8ff, 1.3, 0, 1.5); body.add(sparks); }
  var P = []; for (var i = 0; i < N; i++) P.push(new T.Vector3());
  var phase = Math.random() * 10, rate = o.flap || 3.0;
  function update(t) {
    t += phase;
    var cyc = t * rate, f = Math.sin(cyc);
    var bob = f * 0.1;
    for (var i = 0; i < N; i++) {
      var k = i / (N - 1);
      P[i].set(Math.sin(t * 0.8 + k * 1.5) * 0.025, (o.neckUp == null ? 0.32 : o.neckUp) * smooth(0.32, 0.0, k) + bob * (1 - k * 0.6) - k * 0.08, (0.5 - k) * len);
    }
    sb.update(P);
    var fr = sb.frames;
    onFrame(head, fr[1], 0, 0, 0.06);
    head.rotateY(Math.sin(t * 0.6) * 0.25); head.rotateX(-0.08 + Math.sin(t * 0.9) * 0.06);
    var ki = Math.round(0.4 * (N - 1)), r = sb.radius[ki];
    onFrame(wl.root, fr[ki], r[0] * 0.55, r[1] * 0.62, 0);
    onFrame(wr.root, fr[ki], -r[0] * 0.55, r[1] * 0.62, 0); wr.root.scale.x = -1;
    var flap = -f * (o.flapAmp || 0.75) + 0.15, fold = clamp(Math.cos(cyc) * 0.5, 0, 0.5);
    wl.pose(flap, fold); wr.pose(flap, fold);
    onFrame(tail, fr[N - 1], 0, 0.02, -0.02); tail.rotateX(-0.06 + Math.sin(t * 1.3) * 0.06);
    legs.forEach(function (l) { var kk = Math.round(l.k * (N - 1)), rr = sb.radius[kk]; onFrame(l.g, fr[kk], l.s * rr[0] * 0.45, -rr[1] * 0.75, 0); });
    if (lion) {
      var LP = [];
      for (var j = 0; j < 10; j++) { var q = j / 9; LP.push(fr[N - 1].p.clone().addScaledVector(fr[N - 1].F, -q * 1.5).add(V3(Math.sin(t * 2 - q * 3) * 0.3 * q, -q * 0.35 + Math.sin(t * 1.4 - q * 2) * 0.1, 0))); }
      lion.update(LP); lion.tuft.position.copy(LP[9]);
    }
    if (sparks) { sparks.material.opacity = Math.random() < 0.08 ? 0.85 : sparks.material.opacity * 0.85; sparks.position.set((Math.random() - 0.5) * 3, Math.random() * 0.6, (Math.random() - 0.5) * 2); }
  }
  update(0);
  return { obj: g, update: update, flying: true };
}

/* ----------------------------------------------- the Void Behemoth (Starfall) */
function behemoth(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var N = 40, len = 8.5;
  var rad = keys([[0, 0.9], [0.08, 1.35], [0.25, 1.6], [0.45, 1.35], [0.7, 0.62], [0.88, 0.28], [1, 0.16]]);
  var back = rgb(0x1a1748), flank = rgb(0x2c2a6a), belly = rgb(0x5a76b8), pleat = rgb(0x3a5290);
  var sb = SpineBody(N, 18, function (k) { var r = rad(k); return [r, r * 0.86]; }, function (k, th) {
    var s = Math.sin(th);
    var c = s < -0.25 ? (Math.sin(th * 18) > 0.3 ? belly : pleat) : mixc(flank, back, smooth(-0.1, 0.8, s));
    return c;
  }, M(null, { vc: true, flat: false, r: 0.55, m: 0.25, rim: 1.0, e: 0x120e3a, ei: 1 }));
  body.add(sb.mesh);
  // bioluminescent spots that ride the hide
  var SP = 90, spos = new Float32Array(SP * 3), sdef = [], r = rng(o.seed || 31);
  for (var i = 0; i < SP; i++) sdef.push({ k: 0.05 + r() * 0.8, th: (r() < 0.5 ? 0.2 : Math.PI - 0.2) + (r() - 0.5) * 1.6, s: r() });
  var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(spos, 3));
  var spots = new T.Points(sg, new T.PointsMaterial({ map: softDot(), color: new T.Color(o.glow || 0x7fe8ff).multiplyScalar(2.6), size: 0.42, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
  spots.frustumCulled = false; body.add(spots);
  var finM = M(null, { vc: true, ds: true, r: 0.6, flat: false, e: 0x2a1f7a, ei: 0.6 });
  function finGeo(L, W) { var sh = new T.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(L * 0.3, W * 0.9, L * 0.9, W * 0.5, L, -W * 0.2); sh.bezierCurveTo(L * 0.6, -W * 0.3, L * 0.3, -W * 0.5, 0, -W * 0.35); var geo = new T.ShapeGeometry(sh, 12); geo.rotateX(Math.PI / 2); return prep(geo, function (yy, xx) { return mixc(rgb(0x2a2766), rgb(0x8a9ae8), clamp(xx / L, 0, 1)); }); }
  var pecL = new T.Mesh(finGeo(3.2, 1.6), finM), pecR = new T.Mesh(finGeo(3.2, 1.6), finM); pecR.scale.x = -1; body.add(pecL); body.add(pecR);
  var fluke = new T.Group(); body.add(fluke);
  var fl1 = new T.Mesh(finGeo(2.6, 1.2), finM), fl2 = new T.Mesh(finGeo(2.6, 1.2), finM); fl2.scale.x = -1; fl1.rotation.y = 0.5; fl2.rotation.y = -0.5; fluke.add(fl1); fluke.add(fl2);
  var eyes = new T.Group(); body.add(eyes); eyePair(eyes, o.eye || 0x9ff4ff, 1.05, 0.15, 0, 0.13, 5);
  var P = []; for (i = 0; i < N; i++) P.push(new T.Vector3());
  var phase = Math.random() * 10, _p = new T.Vector3();
  function update(t) {
    t += phase;
    for (var i = 0; i < N; i++) { var k = i / (N - 1); P[i].set(Math.sin(t * 0.3 - k * 2) * 0.12 * k, Math.sin(t * 0.8 - k * 3.2) * 0.38 * k * k, (0.42 - k) * len); }
    sb.update(P);
    var fr = sb.frames;
    for (i = 0; i < SP; i++) {
      var d = sdef[i], ki = Math.round(d.k * (N - 1)), f = fr[ki], rr = sb.radius[ki];
      _p.copy(f.p).addScaledVector(f.L, Math.cos(d.th) * rr[0] * 1.01).addScaledVector(f.U, Math.sin(d.th) * rr[1] * 1.01);
      spos[i * 3] = _p.x; spos[i * 3 + 1] = _p.y; spos[i * 3 + 2] = _p.z;
    }
    sg.attributes.position.needsUpdate = true;
    spots.material.opacity = 0.7 + 0.3 * Math.sin(t * 1.3);
    var kp = Math.round(0.24 * (N - 1)), rp = sb.radius[kp];
    onFrame(pecL, fr[kp], rp[0] * 0.85, -rp[1] * 0.45, 0); pecL.rotateZ(-0.35 + Math.sin(t * 0.8 + 1) * 0.3);
    onFrame(pecR, fr[kp], -rp[0] * 0.85, -rp[1] * 0.45, 0); pecR.rotateZ(0.35 - Math.sin(t * 0.8 + 1) * 0.3);
    onFrame(fluke, fr[N - 1], 0, 0, -0.1); fluke.rotateX(Math.sin(t * 0.8 - 3.2) * 0.4);
    var ke = Math.round(0.07 * (N - 1)); onFrame(eyes, fr[ke], 0, -0.1, 0);
  }
  update(0);
  return { obj: g, update: update, flying: true };
}

/* --------------------------------------------------------- the Comet Sprite */
function cometSprite(o) {
  o = o || {};
  var g = new T.Group(), c = o.color || 0x9ff4ff, cc = new T.Color(c);
  // a small star with a spiked crystal heart, four wings of light and a ribbon of a tail
  var body = new T.Group(); g.add(body);
  var parts = [prep(new T.OctahedronGeometry(0.3, 0), rgb(0xf2feff))];
  [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(function (d, k) {
    var sp = new T.ConeGeometry(0.075, k < 2 ? 0.62 : 0.46, 4); sp.translate(0, 0.3, 0);
    sp.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(d[0], d[1], d[2])));
    parts.push(prep(sp, function (yy, xx, zz) { var r2 = Math.sqrt(xx * xx + yy * yy + zz * zz); return mixc([0.95, 1, 1], [cc.r * 0.7, cc.g * 0.85, cc.b], smooth(0.3, 0.7, r2)); }));
  });
  var core = new T.Mesh(mergeGeometries(parts), M(null, { vc: true, flat: true, e: c, ei: 0.28, r: 0.25, rim: 1.4 })); body.add(core);
  var halo = glowSprite(c, 1.9, 0.2, 0.9); body.add(halo);
  // wings: soft teardrops of light, fluttering
  var ws = new T.Shape(); ws.moveTo(0, 0); ws.bezierCurveTo(0.35, 0.15, 0.62, 0.62, 0.22, 0.92); ws.bezierCurveTo(0.02, 0.62, -0.08, 0.3, 0, 0);
  var wg = new T.ShapeGeometry(ws, 10), wpa = wg.attributes.position, wc = new Float32Array(wpa.count * 3);
  for (var i = 0; i < wpa.count; i++) { var f = 1 - clamp(Math.hypot(wpa.getX(i), wpa.getY(i)) / 1.0, 0, 1) * 0.85; wc[i * 3] = cc.r * f * 1.3; wc[i * 3 + 1] = cc.g * f * 1.3; wc[i * 3 + 2] = cc.b * f * 1.3; }
  wg.setAttribute('color', new T.BufferAttribute(wc, 3));
  var wm = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  var wings = [];
  [[1, 0.2], [-1, 0.2], [1, -0.55], [-1, -0.55]].forEach(function (q, k) {
    var piv = new T.Group(), w = new T.Mesh(wg, wm); w.scale.set(q[0] * (k < 2 ? 1 : 0.7), k < 2 ? 1 : 0.7, 1); w.rotation.z = q[0] * (k < 2 ? -1.05 : -2.1);
    piv.add(w); piv.position.set(0, 0.05, -0.1); body.add(piv); wings.push({ p: piv, s: q[0], k: k });
  });
  // ribbon tail: a strip that follows the flight, tapering and fading
  var N = 48, rpos = new Float32Array(N * 2 * 3), rcol = new Float32Array(N * 2 * 3), idx = [];
  for (i = 0; i < N; i++) { var fade = Math.pow(1 - i / N, 1.6); for (var e = 0; e < 2; e++) { var o3 = (i * 2 + e) * 3; rcol[o3] = Math.min(1, cc.r * 1.2 + 0.2) * fade; rcol[o3 + 1] = Math.min(1, cc.g * 1.2 + 0.2) * fade; rcol[o3 + 2] = Math.min(1, cc.b * 1.2 + 0.2) * fade; } if (i < N - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
  var rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(rpos, 3)); rg.setAttribute('color', new T.BufferAttribute(rcol, 3)); rg.setIndex(idx);
  var ribbon = new T.Mesh(rg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  ribbon.frustumCulled = false; g.add(ribbon);
  // sparkles shed along the path
  var S = 40, pos = new Float32Array(S * 3), sz = new Float32Array(S), gg = new T.BufferGeometry();
  for (i = 0; i < S; i++) sz[i] = 1 - i / S;
  gg.setAttribute('position', new T.BufferAttribute(pos, 3)); gg.setAttribute('sz', new T.BufferAttribute(sz, 1));
  var tm = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { color: { value: cc.clone().multiplyScalar(1.4) } },
    vertexShader: 'attribute float sz; varying float vS; void main(){ vS = sz; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (2.0 + sz * 9.0) * 10.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 color; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a * vS * 0.8; gl_FragColor = vec4(mix(color, vec3(1.4), vS * 0.4) * a, a); }'
  });
  var trail = new T.Points(gg, tm); trail.frustumCulled = false; g.add(trail);
  var phase = Math.random() * 10, va = new T.Vector3(), vb = new T.Vector3(), side = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  function p(t) { return [Math.sin(t * 1.4) * 1.8, Math.cos(t * 2.1) * 0.7, Math.cos(t * 1.4) * 1.8]; }
  function update(t) {
    t += phase;
    var h = p(t), h2 = p(t + 0.05); body.position.set(h[0], h[1], h[2]);
    body.lookAt(h2[0], h2[1], h2[2]);
    core.rotation.set(0, 0, t * 2.4);
    for (var k = 0; k < wings.length; k++) { var wgk = wings[k]; wgk.p.rotation.y = wgk.s * (0.35 + Math.sin(t * 22 + (wgk.k > 1 ? 0.9 : 0)) * 0.55); }
    for (var i = 0; i < N; i++) {
      var q = p(t - i * 0.022), q2 = p(t - i * 0.022 - 0.02); va.set(q[0], q[1], q[2]); vb.set(q2[0], q2[1], q2[2]).sub(va);
      side.crossVectors(vb, up).normalize().multiplyScalar(0.26 * Math.pow(1 - i / N, 0.8));
      rpos[i * 6] = va.x + side.x; rpos[i * 6 + 1] = va.y + side.y; rpos[i * 6 + 2] = va.z + side.z;
      rpos[i * 6 + 3] = va.x - side.x; rpos[i * 6 + 4] = va.y - side.y; rpos[i * 6 + 5] = va.z - side.z;
    }
    rg.attributes.position.needsUpdate = true;
    for (i = 0; i < S; i++) { var qq = p(t - i * 0.03); pos[i * 3] = qq[0] + Math.sin(i * 7.3 + t) * 0.12 * i / S; pos[i * 3 + 1] = qq[1] - i * 0.012; pos[i * 3 + 2] = qq[2] + Math.cos(i * 5.1 + t) * 0.12 * i / S; }
    gg.attributes.position.needsUpdate = true;
  }
  update(0);
  return { obj: g, update: update, flying: true };
}

/* ---------------------------------------------------------- the Moth Galleon */
var mothTex = null;
function mothWingTexture() {
  if (mothTex) return mothTex;
  var c = document.createElement('canvas'); c.width = 512; c.height = 256;
  var x = c.getContext('2d');
  x.translate(0, 128);
  x.beginPath(); x.moveTo(4, -10); x.bezierCurveTo(140, -150, 420, -120, 500, -40); x.bezierCurveTo(470, 40, 300, 110, 4, 16); x.closePath();
  var gr = x.createLinearGradient(0, 0, 500, 0); gr.addColorStop(0, '#3a2a52'); gr.addColorStop(0.55, '#b9a6e0'); gr.addColorStop(1, '#efe6ff');
  x.fillStyle = gr; x.fill();
  x.save(); x.clip();
  x.strokeStyle = 'rgba(40,24,60,0.55)'; x.lineWidth = 3;
  for (var i = 0; i < 7; i++) { x.beginPath(); x.moveTo(6, 0); x.quadraticCurveTo(200, -60 + i * 18, 480, -110 + i * 34); x.stroke(); }
  x.lineWidth = 10; x.strokeStyle = 'rgba(40,24,60,0.6)'; x.beginPath(); x.moveTo(40, 60); x.bezierCurveTo(200, 120, 420, 30, 500, -30); x.stroke();
  [[330, -30, 46], [190, 30, 30]].forEach(function (e) {
    var rg = x.createRadialGradient(e[0], e[1], 0, e[0], e[1], e[2]);
    rg.addColorStop(0, '#fff2c0'); rg.addColorStop(0.3, '#ffb04a'); rg.addColorStop(0.55, '#2a1630'); rg.addColorStop(0.75, '#c9a0ff'); rg.addColorStop(1, 'rgba(201,160,255,0)');
    x.fillStyle = rg; x.beginPath(); x.arc(e[0], e[1], e[2], 0, TAU); x.fill();
  });
  x.restore();
  mothTex = new T.CanvasTexture(c); mothTex.colorSpace = T.SRGBColorSpace; mothTex.anisotropy = 4;
  return mothTex;
}
function mothGalleon(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var oak = rgb(0x4a3020), oak2 = rgb(0x6e4c32), goldC = rgb(0xd8b86a);
  var parts = [];
  // a keeled hull whose ends sweep up into a bow and a stern
  var L = 5.4, NS = 18, RS = 10, hp = [], hc = [], hi = [];
  for (var i = 0; i <= NS; i++) {
    var k = i / NS, z = (0.5 - k) * L, w = Math.pow(Math.sin(k * Math.PI), 0.6) * 1.05 + 0.02, rise = Math.pow(Math.abs(k - 0.5) * 2, 3) * 0.9;
    for (var j = 0; j <= RS; j++) {
      var a = Math.PI + j / RS * Math.PI;
      var x = Math.cos(a) * w, y = Math.sin(a) * (0.95 * Math.pow(Math.sin(k * Math.PI), 0.4) + 0.05) + rise;
      hp.push(x, y + 0.25, z);
      var c = Math.sin((y + 1) * 14) > 0.55 ? oak : oak2; hc.push(c[0], c[1], c[2]);
    }
  }
  for (i = 0; i < NS; i++) for (j = 0; j < RS; j++) { var q0 = i * (RS + 1) + j, q1 = q0 + 1, q2 = q0 + RS + 1, q3 = q2 + 1; hi.push(q0, q2, q1, q1, q2, q3); }
  var hull = new T.BufferGeometry(); hull.setAttribute('position', new T.Float32BufferAttribute(hp, 3)); hull.setAttribute('color', new T.Float32BufferAttribute(hc, 3)); hull.setIndex(hi); hull.computeVertexNormals();
  var hullM = new T.Mesh(hull, M(null, { vc: true, r: 0.8, ds: true, rim: 1, flat: false, masonry: { h: 0.13, w: 1.7, amt: 0.5 }, grain: { scale: 6, amt: 0.15 } })); hullM.castShadow = true; body.add(hullM);
  // a row of lit portholes down each flank, set into the upper strake
  var ports = [];
  [-1, 1].forEach(function (sd) {
    for (var pi = 0; pi < 5; pi++) {
      var pz = 1.5 - pi * 0.7, pk = 0.5 - pz / L, pw = Math.pow(Math.sin(pk * Math.PI), 0.6) * 1.05 + 0.02;
      var pg = new T.CircleGeometry(0.075, 10); pg.rotateY(sd * Math.PI / 2); pg.translate(sd * (pw * 0.99 + 0.018), 0.1 + Math.pow(Math.abs(pk - 0.5) * 2, 3) * 0.9, pz); ports.push(pg);
    }
  });
  body.add(new T.Mesh(mergeGeometries(ports), G(0xffc06a, { i: 2.2, ds: true })));
  var deck = new T.BoxGeometry(1.5, 0.08, 3.8); deck.translate(0, 0.2, 0); parts.push(prep(deck, rgb(0x5a3e2c)));
  var cabin = new T.BoxGeometry(1.0, 0.55, 0.9); cabin.translate(0, 0.5, -1.4); parts.push(prep(cabin, oak2));
  var roofC = new T.ConeGeometry(0.85, 0.45, 4); roofC.rotateY(Math.PI / 4); roofC.scale(0.85, 1, 0.75); roofC.translate(0, 0.98, -1.4); parts.push(prep(roofC, rgb(0x2d6b62)));
  var mast = new T.CylinderGeometry(0.06, 0.09, 3.4, 6); mast.translate(0, 1.85, 0.5); parts.push(prep(mast, oak2));
  var yard = new T.CylinderGeometry(0.035, 0.035, 1.8, 5); yard.rotateZ(Math.PI / 2); yard.translate(0, 3.0, 0.5); parts.push(prep(yard, oak2));
  var bow = taperTube(new T.QuadraticBezierCurve3(V3(0, 0.9, 2.6), V3(0, 1.3, 3.2), V3(0, 1.1, 3.9)), 8, 0.09, 0.03, 5); parts.push(prep(bow, goldC));
  var stern = taperTube(new T.QuadraticBezierCurve3(V3(0, 0.9, -2.6), V3(0, 1.6, -3.0), V3(0, 1.5, -2.5)), 8, 0.08, 0.04, 5); parts.push(prep(stern, goldC));
  body.add(merged(parts, M(null, { vc: true, r: 0.8, rim: 1 })));
  var rail = new T.Mesh(new T.TorusGeometry(1, 0.04, 5, 32).rotateX(Math.PI / 2).scale(0.98, 1, 2.45), M(0xd8b86a, { m: 0.7, r: 0.35, flat: false })); rail.position.y = 0.42; body.add(rail);
  // a pennant at the masthead
  var pen = new T.Mesh(new T.PlaneGeometry(1.1, 0.3, 8, 1).translate(0.55, 0, 0), M(0x8a2238, { ds: true, flat: false, e: 0x3a0a14, ei: 0.5 })); pen.position.set(0, 3.5, 0.5); pen.rotation.y = Math.PI / 2; body.add(pen);
  var wm = new T.MeshStandardMaterial({ map: mothWingTexture(), emissiveMap: mothWingTexture(), emissive: 0xffffff, emissiveIntensity: 0.45, side: T.DoubleSide, transparent: true, alphaTest: 0.2, roughness: 0.8 });
  function wing(Lw) { var p = new T.PlaneGeometry(Lw, Lw / 2, 10, 3); p.translate(Lw / 2, 0, 0); p.rotateX(-Math.PI / 2); var m = new T.Mesh(p, wm); m.castShadow = true; return m; }
  var wings = [];
  [[0.75, 1.0, 4.6], [0.7, -1.0, 3.4]].forEach(function (d, jj) {
    [-1, 1].forEach(function (sd) { var piv = new T.Group(); piv.position.set(0.85 * sd, d[0], d[1]); var w = wing(d[2]); if (sd < 0) w.scale.x = -1; piv.add(w); body.add(piv); wings.push({ p: piv, s: sd, j: jj }); });
  });
  var lantern = glowSprite(0xffcf6a, 1.4, 0.85, 1.5); lantern.position.set(0, 1.2, 3.95); body.add(lantern);
  var lantern2 = glowSprite(0xffcf6a, 1.0, 0.8, 1.4); lantern2.position.set(0, 3.25, 0.5); body.add(lantern2);
  var lampL = new T.PointLight(0xffb04a, 1.5, 8, 2); lampL.position.copy(lantern.position); body.add(lampL);
  var win = new T.Mesh(new T.PlaneGeometry(0.5, 0.22), G(0xffc06a, { i: 2.4, ds: true })); win.position.set(0, 0.55, -0.94); body.add(win);
  [-1, 1].forEach(function (sd) { var an = new T.Mesh(taperTube(new T.QuadraticBezierCurve3(V3(0.08 * sd, 1.2, 3.8), V3(0.5 * sd, 2.0, 4.4), V3(0.95 * sd, 1.9, 4.9)), 8, 0.035, 0.012, 4), M(0xd8b86a, { m: 0.6 })); body.add(an); });
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    wings.forEach(function (w) { var a = Math.sin(t * 1.3 - w.j * 0.8) * 0.32 + 0.38; w.p.rotation.z = a * w.s; w.p.rotation.y = (w.j ? -0.35 : 0.25) * w.s; });
    body.rotation.z = Math.sin(t * 0.6) * 0.05; body.position.y = Math.sin(t * 0.9) * 0.2;
    lantern.material.opacity = 0.75 + 0.2 * Math.sin(t * 5);
    var pp = pen.geometry.attributes.position; for (var i = 0; i < pp.count; i++) { var x = pp.getX(i); pp.setZ(i, Math.sin(t * 4 + x * 4) * 0.08 * x); }
    pp.needsUpdate = true;
  }
  update(0);
  return { obj: g, update: update, flying: true };
}

/* ---------------------------------------------------------- the Deeps */
function kraken(o) {
  o = o || {};
  var g = new T.Group();
  var skin = rgb(o.color || 0x7a2e6e), skin2 = rgb(0x3a1438), sucker = rgb(o.sucker || 0xf3b0c8);
  var mpts = []; for (var i = 0; i <= 32; i++) { var t = i / 32; mpts.push(new T.Vector2(Math.max(0.02, Math.sin(t * Math.PI) * (1.1 - t * 0.35) * (t < 0.15 ? 0.85 : 1)), t * 3.0)); }
  var mg = new T.LatheGeometry(mpts, 44);
  // leopard spots scattered over the mantle, paler toward the brow
  var spots = [], sr = rng(31); for (i = 0; i < 38; i++) spots.push([sr() * TAU, 0.5 + sr() * 2.3, 0.1 + sr() * 0.13]);
  var head = merged([prep(mg, function (yy, xx, zz, ny) { var ang = Math.atan2(zz, xx), rr0 = Math.hypot(xx, zz), sp = 0; for (var q = 0; q < spots.length; q++) { var da = Math.atan2(Math.sin(ang - spots[q][0]), Math.cos(ang - spots[q][0])) * rr0, dy = yy - spots[q][1], dd = Math.sqrt(da * da + dy * dy) / spots[q][2]; if (dd < 1) sp = Math.max(sp, dd > 0.7 ? 0.55 : 0.25); } var c = mixc(skin, skin2, smooth(0.5, 2.8, yy)); return mixc(c, sp > 0.4 ? rgb(0x1e0a1e) : rgb(0xc86aa8), sp > 0 ? 0.55 : 0); })], M(null, { vc: true, flat: false, r: 0.45, m: 0.15, rim: 1.1 }));
  head.position.y = 0.8; g.add(head);
  var eyes = new T.Group(); eyes.position.y = 1.45; g.add(eyes);
  [-1, 1].forEach(function (s) {
    var e = new T.Mesh(new T.SphereGeometry(0.2, 12, 10), G(o.eye || 0xffc44a, { i: 3 })); e.position.set(0.7 * s, 0, 0.62); eyes.add(e);
    var pu = new T.Mesh(new T.BoxGeometry(0.05, 0.26, 0.04), G(0x1a0610)); pu.position.set(0.72 * s, 0, 0.8); eyes.add(pu);
  });
  var arms = [], NA = 8, NS = 30;
  for (i = 0; i < NA; i++) {
    var sb = SpineBody(NS, 12, function (k) { var r = lerp(0.3, 0.035, Math.pow(k, 0.8)); return [r, r]; }, function (k, th) { var s = Math.sin(th); if (s < -0.3) return Math.sin(k * 95) > 0.1 ? (s < -0.8 ? mixc(sucker, rgb(0xffffff), 0.2) : sucker) : mixc(sucker, skin2, 0.55); return mixc(skin, skin2, smooth(0, 1, s)); }, M(null, { vc: true, flat: false, r: 0.5, rim: 1.0 }));
    g.add(sb.mesh);
    var P = []; for (var j = 0; j < NS; j++) P.push(new T.Vector3());
    arms.push({ sb: sb, P: P, a: i / NA * TAU + 0.2 });
  }
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    head.position.y = 0.8 + Math.sin(t * 1.1) * 0.15; head.rotation.z = Math.sin(t * 0.7) * 0.06;
    eyes.position.y = 1.45 + Math.sin(t * 1.1) * 0.15;
    for (var i = 0; i < arms.length; i++) {
      var A = arms[i], ang = A.a + Math.sin(t * 0.4 + i) * 0.12;
      for (var j = 0; j < NS; j++) {
        var k = j / (NS - 1), rise = i % 2 ? 1 : 0.45, curl = Math.sin(t * 1.3 + i * 0.9 + k * 2.6) * 0.5 + 0.5;
        var rad = 0.75 + k * (2.0 + (1 - rise) * 1.4) - Math.pow(k, 3) * (1.2 + curl * 1.4) * rise;
        var up = k * (3.4 * rise + 0.4) * (0.7 + 0.3 * curl) - Math.pow(k, 2.2) * (1.0 - rise) * 1.6 + Math.sin(k * 7 - t * 2 + i) * 0.12 * k;
        var tw = Math.sin(t * 0.8 + i) * 0.35 * k;
        A.P[j].set(Math.cos(ang + tw) * rad, 0.65 + up, Math.sin(ang + tw) * rad);
      }
      A.sb.update(A.P);
    }
  }
  update(0);
  return { obj: g, update: update, water: true };
}

function siren(o) {
  o = o || {};
  var g = new T.Group();
  var N = 46, len = 8;
  var rad = keys([[0, 0.3], [0.05, 0.36], [0.12, 0.34], [0.35, 0.44], [0.6, 0.32], [0.85, 0.14], [1, 0.03]]);
  var back = rgb(0x0f4a5e), flank = rgb(o.color || 0x1f8a9a), belly = rgb(0xbfe8d8);
  var sb = SpineBody(N, 12, function (k) { var r = rad(k); return [r, r * 0.92]; }, function (k, th) { var s = Math.sin(th); var c = s < -0.3 ? belly : mixc(flank, back, smooth(0, 0.9, s)); if (s > -0.3 && Math.sin(k * 80 + th * 3) > 0.7) c = mixc(c, rgb(0x5fe3c5), 0.35); return c; }, M(null, { vc: true, flat: false, r: 0.35, m: 0.35, rim: 1.2, scales: { u: 120, v: 12, amt: 0.32 } }));
  g.add(sb.mesh);
  // the dorsal sail: a gold membrane between spines, rebuilt along the back
  var FN = 26, fpos = new Float32Array((FN - 1) * 6 * 3), fcol = new Float32Array((FN - 1) * 6 * 3);
  var fg = new T.BufferGeometry(); fg.setAttribute('position', new T.BufferAttribute(fpos, 3)); fg.setAttribute('color', new T.BufferAttribute(fcol, 3));
  var gold = rgb(o.fin || 0xf2c766), goldD = rgb(0x9a6a20);
  for (var i = 0; i < (FN - 1) * 6; i++) { var cc = (i % 6 === 2 || i % 6 === 4 || i % 6 === 5) ? gold : goldD; fcol[i * 3] = cc[0]; fcol[i * 3 + 1] = cc[1]; fcol[i * 3 + 2] = cc[2]; }
  var finM = M(null, { vc: true, ds: true, r: 0.5, e: o.fin || 0xf2c766, ei: 0.22, t: true, o: 0.72, flat: false, dw: false });
  var sail = new T.Mesh(fg, finM); sail.frustumCulled = false; g.add(sail);
  var head = new T.Group(); g.add(head);
  var hp = [];
  var sk = new T.ConeGeometry(0.3, 1.1, 8); sk.rotateX(Math.PI / 2); sk.scale(1, 0.75, 1); sk.translate(0, 0, 0.45); hp.push(prep(sk, function (yy, xx, zz, ny) { return ny < -0.3 ? belly : flank; }));
  for (i = 0; i < 7; i++) { var a = (i / 6 - 0.5) * 2.4, fr2 = new T.ConeGeometry(0.06, 0.9, 4); fr2.translate(0, 0.45, 0); fr2.rotateX(-1.0); fr2.rotateZ(a); fr2.translate(0, 0.15, -0.15); hp.push(prep(fr2, gold)); }
  head.add(merged(hp, M(null, { vc: true, flat: false, r: 0.4, m: 0.3, rim: 1.1 })));
  var frill = new T.Mesh(new T.CircleGeometry(0.55, 16, Math.PI * 0.1, Math.PI * 0.8), finM); frill.position.set(0, 0.1, -0.2); frill.rotation.x = -0.4; head.add(frill);
  eyePair(head, o.eye || 0xfff6a0, 0.19, 0.12, 0.55, 0.06, 5);
  var P = []; for (i = 0; i < N; i++) P.push(new T.Vector3());
  var phase = Math.random() * 10, _a = new T.Vector3();
  function update(t) {
    t += phase;
    for (var i = 0; i < N; i++) { var k = i / (N - 1); P[i].set(Math.sin(k * 7 - t * 1.5) * 1.0 * (0.3 + k), Math.sin(k * 5 - t * 1.1) * 0.55 + 0.4 - k * 0.6 + (k < 0.15 ? (0.15 - k) * 6 : 0), (0.5 - k) * len); }
    sb.update(P);
    var fr = sb.frames;
    onFrame(head, fr[0], 0, 0, 0.1); head.rotateX(0.25);
    var vi = 0;
    for (var j = 0; j < FN - 1; j++) {
      var k0 = Math.round((0.1 + j / FN * 0.75) * (N - 1)), k1 = Math.round((0.1 + (j + 1) / FN * 0.75) * (N - 1));
      var f0 = fr[k0], f1 = fr[k1], r0 = sb.radius[k0], r1 = sb.radius[k1];
      var h0 = (j % 2 ? 0.2 : 0.42) + (1 - j / FN) * 0.22, h1 = ((j + 1) % 2 ? 0.2 : 0.42) + (1 - (j + 1) / FN) * 0.22;
      var A = f0.p.clone().addScaledVector(f0.U, r0[1] * 0.9), B = f1.p.clone().addScaledVector(f1.U, r1[1] * 0.9);
      var C = A.clone().addScaledVector(f0.U, h0).addScaledVector(f0.F, -0.12), D = B.clone().addScaledVector(f1.U, h1).addScaledVector(f1.F, -0.12);
      [A, B, C, B, D, C].forEach(function (v) { fpos[vi++] = v.x; fpos[vi++] = v.y; fpos[vi++] = v.z; });
    }
    fg.attributes.position.needsUpdate = true; fg.computeVertexNormals();
  }
  update(0);
  return { obj: g, update: update, water: true };
}

function wight(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var cloakM = M(null, { vc: true, ds: true, t: true, o: 0.92, r: 0.9, e: 0x06201f, ei: 1, rim: 0.7, flat: false, glow: true });
  var cg = new T.CylinderGeometry(0.42, 1.15, 2.8, 16, 8, true), pa = cg.attributes.position, r = rng(5);
  for (var i = 0; i < pa.count; i++) {
    var y = pa.getY(i), a = Math.atan2(pa.getZ(i), pa.getX(i));
    if (y < -1.2) pa.setY(i, y - (Math.sin(a * 7) * 0.5 + 0.5) * 0.7 - r() * 0.25);
    var k = (y + 1.4) / 2.8; pa.setX(i, pa.getX(i) * (1 + Math.sin(a * 5 + y * 2) * 0.06)); pa.setZ(i, pa.getZ(i) * (1 + Math.cos(a * 4 + y) * 0.06));
  }
  // the hem is lit from within, as if the deep still glowed in the cloth
  var gc = new T.Color(o.glow || 0x5ffff0);
  var cloakG = prep(cg, function (yy) { return mixc(rgb(0x0c2a30), rgb(o.color || 0x2d6f78), smooth(-1.6, 1.2, yy)); }, function (yy) { var k = smooth(-1.0, -2.0, yy) * 0.55; return [gc.r * k, gc.g * k, gc.b * k]; });
  var cloak = new T.Mesh(cloakG, cloakM);
  cloak.position.y = 1.3; body.add(cloak);
  var hemBase = cloakG.attributes.position.array.slice(), hemPos = cloakG.attributes.position;
  var hood = new T.Mesh(prep(new T.SphereGeometry(0.52, 14, 10, 0, TAU, 0, Math.PI * 0.62), rgb(o.color || 0x2d6f78)), cloakM); hood.position.set(0, 2.62, 0); hood.rotation.x = -0.25; body.add(hood);
  var face = new T.Mesh(new T.SphereGeometry(0.36, 12, 8), G(0x03060a)); face.position.set(0, 2.5, 0.16); body.add(face);
  eyePair(body, o.eye || 0x8ffff0, 0.12, 2.55, 0.48, 0.055, 6);
  var lanternG = new T.Group(); lanternG.position.set(0.85, 1.7, 0.55); body.add(lanternG);
  lanternG.add(new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.6, 4).translate(0, 0.3, 0), M(0x3a4a4a)));
  var cage = new T.Mesh(new T.OctahedronGeometry(0.2, 0), M(0x5a7a7a, { t: true, o: 0.5, m: 0.6 })); cage.scale.y = 1.4; lanternG.add(cage);
  var flame = glowSprite(o.glow || 0x5ffff0, 1.4, 0.8, 1.5); lanternG.add(flame);
  // a sleeve reaching to the lantern, and a bony hand that holds it
  var sleeve = prep(taperTube(new T.CatmullRomCurve3([V3(0.32, 2.25, 0.05), V3(0.62, 2.0, 0.3), V3(0.82, 1.82, 0.5)]), 10, 0.17, 0.1, 7), function (yy) { return mixc(rgb(0x0c2a30), rgb(o.color || 0x2d6f78), smooth(1.6, 2.3, yy)); });
  var hand = [];
  for (var f = 0; f < 4; f++) { var fg = new T.ConeGeometry(0.025, 0.2, 4); fg.rotateZ(Math.PI); fg.rotateY(f * 0.5 - 0.75); fg.translate(0.84 + f * 0.025, 1.72, 0.52 + (f - 1.5) * 0.03); hand.push(prep(fg, rgb(0xcfd8cf))); }
  body.add(merged([sleeve].concat(hand), M(null, { vc: true, r: 0.8, flat: false, rim: 0.8 })));
  var kelp = [];
  for (i = 0; i < 9; i++) { var a = i / 9 * TAU, x = Math.cos(a) * 0.9, z = Math.sin(a) * 0.9, L = 0.8 + r() * 1.2; kelp.push(prep(taperTube(new T.CatmullRomCurve3([V3(x, 0, z), V3(x * 1.05, -L * 0.5, z * 1.05 + 0.1), V3(x * 0.95, -L, z)]), 6, 0.05, 0.01, 4), function () { return rgb(0x2a5a3a); })); }
  var km = merged(kelp, M(null, { vc: true, sway: 0.6, flat: false })); km.position.y = 0.3; body.add(km);
  var wisps = [];
  for (i = 0; i < 6; i++) { var w = glowSprite(o.glow || 0x5ffff0, 0.5, 0.7, 1.3); body.add(w); wisps.push(w); }
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    body.position.y = Math.sin(t * 1.2) * 0.22 + 0.25;
    body.rotation.y = Math.sin(t * 0.4) * 0.3;
    lanternG.rotation.z = Math.sin(t * 1.6) * 0.15;
    // the ragged hem drifts in a current only it can feel
    for (var v = 0; v < hemPos.count; v++) {
      var by = hemBase[v * 3 + 1]; if (by > -0.6) continue;
      var bx = hemBase[v * 3], bz = hemBase[v * 3 + 2], d = Math.min(1, (-0.6 - by) / 1.4), aa = Math.atan2(bz, bx);
      hemPos.setX(v, bx + Math.sin(t * 2.1 + aa * 3 + by) * 0.09 * d);
      hemPos.setZ(v, bz + Math.cos(t * 1.7 + aa * 2) * 0.09 * d);
      hemPos.setY(v, by + Math.sin(t * 2.6 + aa * 5) * 0.06 * d);
    }
    hemPos.needsUpdate = true;
    flame.material.opacity = 0.75 + 0.2 * Math.sin(t * 7);
    for (var i = 0; i < wisps.length; i++) { var a = t * 1.0 + i * 1.05; wisps[i].position.set(Math.cos(a) * 1.3, 0.4 + ((t * 0.5 + i * 0.4) % 2.8), Math.sin(a) * 1.3); }
  }
  update(0);
  return { obj: g, update: update };
}

/* ---------------------------------------------------------- the Wilds */
function treant(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var bark = rgb(0x4a3326), bark2 = rgb(0x6a4a34), moss = rgb(0x4f7a45);
  var parts = [];
  // a trunk of deep, twisting bark ridges, mossy where water would sit
  var trunk = new T.CylinderGeometry(0.55, 0.95, 3.6, 28, 18); var tp = trunk.attributes.position, rr = rng(21);
  for (var i = 0; i < tp.count; i++) { var a = Math.atan2(tp.getZ(i), tp.getX(i)), y = tp.getY(i), ridge = Math.pow(Math.abs(Math.sin(a * 7 + y * 0.9)), 0.6), k = 1 + ridge * 0.1 + Math.sin(a * 3 - y) * 0.05; tp.setX(i, tp.getX(i) * k); tp.setZ(i, tp.getZ(i) * k); }
  trunk.translate(0, 2.0, 0);
  parts.push(prep(trunk, function (yy, xx, zz, ny) { var rd = Math.abs(Math.sin(Math.atan2(zz, xx) * 7 + (yy - 2) * 0.9)); var c = mixc(rgb(0x34241a), rgb(0x9a7652), smooth(0.2, 0.9, rd)); return (ny > 0.35 || (rd < 0.25 && Math.sin(yy * 3 + xx * 5) > 0.4)) ? mixc(c, moss, 0.7) : c; }));
  // the face: a heavy brow, a knotted nose, a crooked mouth
  var brow = new T.CylinderGeometry(0.11, 0.14, 0.95, 8); brow.rotateZ(Math.PI / 2); brow.rotateY(0.05); brow.translate(0, 3.05, 0.6); parts.push(prep(brow, bark2));
  var nose = new T.IcosahedronGeometry(0.16, 1); nose.scale(0.8, 1.2, 1.1); nose.translate(0.03, 2.62, 0.72); parts.push(prep(nose, rgb(0x7a5a3e)));
  for (i = 0; i < 6; i++) { var a2 = i / 6 * TAU + 0.3; parts.push(prep(taperTube(new T.CatmullRomCurve3([V3(Math.cos(a2) * 0.6, 0.6, Math.sin(a2) * 0.6), V3(Math.cos(a2) * 1.2, 0.15, Math.sin(a2) * 1.2), V3(Math.cos(a2) * 1.6, -0.05, Math.sin(a2) * 1.6)]), 6, 0.3, 0.06, 6), bark)); }
  body.add(merged(parts, M(null, { vc: true, r: 1, rim: 0.8, flat: false, grain: { scale: 3.5, amt: 0.25 } })));
  eyePair(body, o.eye || 0xffc04a, 0.24, 2.85, 0.6, 0.09, 4);
  var mg = [new T.BoxGeometry(0.22, 0.06, 0.06).rotateZ(0.12).translate(-0.1, 2.32, 0.68), new T.BoxGeometry(0.2, 0.05, 0.06).rotateZ(-0.2).translate(0.1, 2.33, 0.67)];
  var mouth = new T.Mesh(mergeGeometries(mg), G(0xff9a30, { i: 2.2 })); body.add(mouth);
  var arms = [];
  [-1, 1].forEach(function (s) {
    var ag = new T.Group(); ag.position.set(0.55 * s, 3.1, 0); body.add(ag);
    var ap = [prep(taperTube(new T.CatmullRomCurve3([V3(0, 0, 0), V3(0.7 * s, 0.5, 0.2), V3(1.0 * s, 1.4, 0.4), V3(0.7 * s, 2.0, 0.6)]), 8, 0.26, 0.1, 6), bark2)];
    for (var f = 0; f < 3; f++) ap.push(prep(taperTube(new T.CatmullRomCurve3([V3(0.7 * s, 2.0, 0.6), V3((0.6 + f * 0.15) * s, 2.35, 0.5 + f * 0.2), V3((0.4 + f * 0.2) * s, 2.55, 0.3 + f * 0.3)]), 4, 0.08, 0.02, 4), bark2));
    ag.add(merged(ap, M(null, { vc: true, r: 1 }))); arms.push(ag);
  });
  var boulder = new T.Mesh(prep(jiggle(new T.DodecahedronGeometry(0.75, 1), 0.2, 4), function (yy, xx, zz, ny) { return ny > 0.4 ? moss : rgb(0x7a7088); }), M(null, { vc: true, r: 0.95 }));
  boulder.position.set(0, 5.9, 0.5); boulder.castShadow = true; body.add(boulder);
  var canopy = new T.Group(); canopy.position.y = 4.0; body.add(canopy);
  var cp = [], lo = rgb(o.leaf || 0x2d5e3c), hi = rgb(0x8fbf5a), bl = rgb(0xff9ec7);
  for (i = 0; i < 16; i++) {
    var cx = (rr() - 0.5) * 2.8, cy = rr() * 1.3 - 0.4, cz = -0.5 - rr() * 1.4, rad = (i < 6 ? 0.7 : 0.42) + rr() * 0.35;
    var ic = jiggle(new T.IcosahedronGeometry(rad, 1), 0.1, i); ic.translate(cx, cy, cz);
    var bloom = rr() < 0.3;
    cp.push(prep(ic, function (yy, xx, zz, ny) { return bloom ? mixc(rgb(0xc0507a), bl, clamp(ny * 0.5 + 0.5, 0, 1)) : mixc(lo, hi, clamp(ny * 0.5 + 0.5, 0, 1)); }));
  }
  canopy.add(merged(cp, M(null, { vc: true, r: 0.9, sway: 0.4, rim: 1.1 })));
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    body.rotation.z = Math.sin(t * 0.7) * 0.03;
    canopy.rotation.y = Math.sin(t * 0.5) * 0.12;
    arms[0].rotation.z = Math.sin(t * 0.9) * 0.06; arms[1].rotation.z = -Math.sin(t * 0.9) * 0.06;
    boulder.position.y = 5.9 + Math.sin(t * 0.9) * 0.08; boulder.rotation.y = t * 0.2;
  }
  update(0);
  return { obj: g, update: update };
}

function troll(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var stone = rgb(o.color || 0x7a8494), stoneD = rgb(0x4a5060), moss = rgb(0x5f8f4a), crack = [1.6, 0.7, 0.2];
  var paint = function (yy, xx, zz, ny) { return ny > 0.45 ? mixc(moss, rgb(0x8fbf5a), clamp(ny - 0.45, 0, 1)) : mixc(stoneD, stone, clamp(yy / 3, 0, 1) * 0.6 + 0.3); };
  var glowCrack = function () { return null; };
  var parts = [];
  var torso = jiggle(new T.IcosahedronGeometry(1.2, 2), 0.14, 3); torso.scale(1.2, 1.05, 0.95); torso.translate(0, 2.2, -0.1); parts.push(prep(torso, paint, glowCrack));
  var hump = jiggle(new T.IcosahedronGeometry(0.85, 2), 0.12, 4); hump.translate(0, 2.9, -0.55); parts.push(prep(hump, paint, glowCrack));
  [-1, 1].forEach(function (s) {
    var leg = jiggle(new T.CylinderGeometry(0.42, 0.5, 1.3, 7, 2), 0.1, 6 + s); leg.translate(0.6 * s, 0.65, 0); parts.push(prep(leg, paint));
    var foot = jiggle(new T.IcosahedronGeometry(0.45, 0), 0.08, 9 + s); foot.scale(1, 0.55, 1.4); foot.translate(0.62 * s, 0.1, 0.2); parts.push(prep(foot, paint));
    for (var m = 0; m < 3; m++) { var sp = new T.ConeGeometry(0.16, 0.55, 4); sp.translate(0.75 * s + (m - 1) * 0.22 * s, 3.25 - m * 0.12, -0.45 + m * 0.1); parts.push(prep(sp, rgb(0xb8c0a8))); }
  });
  body.add(merged(parts, M(null, { vc: true, glow: true, r: 0.95, rim: 0.9, veins: { top: 99, scale: 0.8, i: 1.1 }, grain: { scale: 3.2, amt: 0.22 } })));
  var head = new T.Group(); head.position.set(0, 3.0, 0.75); body.add(head);
  var hp = [prep(jiggle(new T.IcosahedronGeometry(0.5, 1), 0.08, 11), paint)];
  var brow = new T.BoxGeometry(0.8, 0.18, 0.3); brow.translate(0, 0.15, 0.32); hp.push(prep(brow, stoneD));
  var nose = new T.ConeGeometry(0.15, 0.45, 5); nose.rotateX(Math.PI / 2); nose.translate(0, -0.05, 0.5); hp.push(prep(nose, stone));
  [-1, 1].forEach(function (s) { var tk = new T.ConeGeometry(0.07, 0.36, 5); tk.translate(0.2 * s, -0.12, 0.38); hp.push(prep(tk, rgb(0xf2ead6))); });
  head.add(merged(hp, M(null, { vc: true, r: 0.95 })));
  eyePair(head, o.eye || 0xffb347, 0.2, 0.06, 0.42, 0.065, 4);
  var arms = [];
  [-1, 1].forEach(function (s) {
    var a = new T.Group(); a.position.set(1.35 * s, 2.65, 0); body.add(a);
    var ap = [prep(taperTube(new T.CatmullRomCurve3([V3(0, 0, 0), V3(0.25 * s, -0.9, 0.2), V3(0.2 * s, -1.9, 0.35)]), 6, 0.38, 0.3, 7), paint)];
    var fist = jiggle(new T.IcosahedronGeometry(0.48, 1), 0.1, 13 + s); fist.translate(0.2 * s, -2.1, 0.4); ap.push(prep(fist, paint));
    a.add(merged(ap, M(null, { vc: true, r: 0.95 }))); arms.push(a);
  });
  var club = new T.Group(); club.position.set(0.2, -2.1, 0.4); arms[1].add(club);
  var cp = [prep(new T.CylinderGeometry(0.3, 0.1, 2.2, 7).translate(0, 0.9, 0), rgb(0x5a3e2a))];
  for (var i = 0; i < 5; i++) { var spk = new T.ConeGeometry(0.06, 0.32, 4); spk.rotateZ(Math.PI / 2); spk.rotateY(i * 1.25); spk.translate(Math.cos(i * 1.25) * 0.28, 1.6 + (i % 2) * 0.25, -Math.sin(i * 1.25) * 0.28); cp.push(prep(spk, rgb(0xcfc6b0))); }
  var cm = merged(cp, M(null, { vc: true, r: 0.9 })); cm.rotation.x = 1.1; club.add(cm);
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    var br = 1 + Math.sin(t * 1.3) * 0.02; body.scale.set(br, 1, br);
    arms[1].rotation.x = -0.3 + Math.sin(t * 0.9) * 0.2; arms[0].rotation.x = Math.sin(t * 0.9 + 1) * 0.15;
    head.rotation.y = Math.sin(t * 0.5) * 0.35;
    body.rotation.y = Math.sin(t * 0.3) * 0.18;
  }
  update(0);
  return { obj: g, update: update };
}

function ghoulArcher(o) {
  o = o || {};
  var g = new T.Group(), body = new T.Group(); g.add(body);
  var skin = rgb(o.color || 0xb8c8b0), skinD = rgb(0x6a7a68), rag = rgb(0x2e2a34), rag2 = rgb(0x4a4450);
  var parts = [];
  var torso = taperTube(new T.CatmullRomCurve3([V3(0, 1.1, 0), V3(0, 1.6, 0.12), V3(0, 2.05, 0.3)]), 6, 0.3, 0.24, 8); parts.push(prep(torso, skin));
  var robe = new T.CylinderGeometry(0.26, 0.48, 1.3, 12, 3, true); var rp = robe.attributes.position;
  for (var i = 0; i < rp.count; i++) { if (rp.getY(i) < -0.5) rp.setY(i, rp.getY(i) - (Math.sin(Math.atan2(rp.getZ(i), rp.getX(i)) * 9) * 0.5 + 0.5) * 0.3); }
  robe.translate(0, 0.95, 0); parts.push(prep(robe, function (yy) { return mixc(rag, rag2, smooth(0.3, 1.6, yy)); }));
  var hood = new T.SphereGeometry(0.36, 12, 8, 0, TAU, 0, Math.PI * 0.6); hood.rotateX(-0.4); hood.translate(0, 2.32, 0.38); parts.push(prep(hood, rag));
  [-1, 1].forEach(function (s) { parts.push(prep(taperTube(new T.CatmullRomCurve3([V3(0.16 * s, 0.9, 0), V3(0.18 * s, 0.45, 0.05), V3(0.15 * s, 0.05, 0)]), 4, 0.09, 0.06, 5), skinD)); });
  body.add(merged(parts, M(null, { vc: true, ds: true, r: 0.9, rim: 1.1, flat: false })));
  var head = new T.Group(); head.position.set(0, 2.25, 0.45); body.add(head);
  var skull = new T.Mesh(prep(new T.IcosahedronGeometry(0.24, 2).scale(0.9, 1.1, 1), skin), M(null, { vc: true, r: 0.7, flat: false })); head.add(skull);
  eyePair(head, o.eye || 0xb6ff6a, 0.09, 0.03, 0.2, 0.04, 2.5);
  var bowArm = new T.Group(); bowArm.position.set(0.32, 1.95, 0.35); body.add(bowArm);
  bowArm.add(new T.Mesh(taperTube(new T.LineCurve3(V3(0, 0, 0), V3(0.1, 0, 1.0)), 3, 0.07, 0.05, 5), M(o.color || 0xb8c8b0, { flat: false })));
  var bow = new T.Mesh(taperTube(new T.QuadraticBezierCurve3(V3(0, -0.9, 0), V3(0, 0, 0.55), V3(0, 0.9, 0)), 16, 0.04, 0.04, 5), M(0x5a3a22, { r: 0.6, flat: false })); bow.position.set(0.1, 0, 1.0); bowArm.add(bow);
  var string = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 1.8, 3), G(0xd8e8d0, { i: 1.2 })); string.position.set(0.1, 0, 0.82); bowArm.add(string);
  var arrow = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.2, 4).rotateX(Math.PI / 2), G(o.eye || 0xb6ff6a, { i: 1.6 })); arrow.position.set(0.1, 0, 1.2); bowArm.add(arrow);
  var tip = glowSprite(o.eye || 0xb6ff6a, 0.8, 0.6, 1.5); tip.position.set(0.1, 0, 1.85); bowArm.add(tip);
  var quiver = new T.Mesh(new T.CylinderGeometry(0.13, 0.1, 0.85, 7), M(0x4a3020, { flat: false })); quiver.position.set(-0.28, 1.95, -0.3); quiver.rotation.x = 0.45; body.add(quiver);
  // arrows standing in the quiver, fletched pale green
  var qa = [];
  for (var qi = 0; qi < 5; qi++) {
    var ox = Math.cos(qi * 1.3) * 0.06, oz = Math.sin(qi * 1.3) * 0.06, h0 = 0.42 + (qi % 2) * 0.08;
    var shaft = new T.CylinderGeometry(0.012, 0.012, 0.5, 3); shaft.translate(ox, h0, oz); qa.push(prep(shaft, rgb(0x8a6a44)));
    for (var fq = 0; fq < 3; fq++) { var fl = new T.PlaneGeometry(0.05, 0.14); fl.translate(0.025, 0, 0); fl.rotateY(fq / 3 * TAU); fl.translate(ox, h0 + 0.2, oz); qa.push(prep(fl, rgb(0xb6e09a))); }
  }
  var arrows = merged(qa, M(null, { vc: true, ds: true, r: 0.8, flat: false })); quiver.add(arrows);
  // a tattered cape of strips hanging from the shoulders
  var cape = [];
  for (var ci = 0; ci < 7; ci++) {
    var ca = (ci / 6 - 0.5) * 1.6, cl = 1.0 + ((ci * 7) % 3) * 0.22, cw = 0.15;
    var strip = new T.PlaneGeometry(cw, cl, 1, 6); strip.translate(0, -cl / 2, 0);
    // the top row sits at y = 0 only up to float32 rounding: a hair above it, -yy0 goes negative and
    // a fractional power of a negative is NaN, which once sank the whole Ghoul Archer (and the camera)
    var sp = strip.attributes.position; for (var sv = 0; sv < sp.count; sv++) { var yy0 = sp.getY(sv); sp.setZ(sv, -Math.pow(Math.max(0, -yy0), 1.4) * 0.12); }
    strip.rotateY(ca); strip.translate(Math.sin(ca) * 0.3, 2.1, -Math.cos(ca) * 0.3 + 0.1);
    cape.push(prep(strip, function (yy) { return mixc(rgb(0x221e28), rgb(0x3e3848), smooth(0.9, 2.1, yy)); }));
  }
  var capeM = merged(cape, M(null, { vc: true, ds: true, r: 0.95, sway: 0.8, flat: false })); body.add(capeM);
  var phase = Math.random() * 10;
  function update(t) {
    t += phase;
    body.rotation.y = Math.sin(t * 0.5) * 0.25;
    head.rotation.z = Math.sin(t * 1.7) * 0.1;
    tip.material.opacity = 0.5 + 0.4 * Math.sin(t * 4);
    var draw = 0.5 + 0.5 * Math.sin(t * 0.9); string.position.z = 0.82 - draw * 0.25; arrow.position.z = 1.2 - draw * 0.25;
  }
  update(0);
  return { obj: g, update: update };
}

export var BESTIARY = {
  2: function () { return behemoth({}); },
  3: function () { return cometSprite({ color: 0x8ff6ff }); },
  4: function () { return mothGalleon({}); },
  5: function () { return bird({ hook: true, len: 2.5, girth: 0.9, neckUp: 0.3, back: 0x5a2a2a, belly: 0xd8b8a0, head: 0xe9d0bc, face: 0xf0dccc, wing0: 0x8a2f2f, wing1: 0x2a0e10, cov: 0xb04a3a, beakC: 0x2a1f1f, eye: 0xff8a3a, span: 2.9, flap: 4.2, crest: 0x6a1a1a, edge: 0x5a1010, edgeI: 0.4 }); },
  6: function () { return bird({ back: 0x2a2148, belly: 0x5a4a86, head: 0x3a2d5c, face: 0x7a6aa8, wing0: 0x3a2d6a, wing1: 0x120c28, cov: 0x5a4a96, beakC: 0xd6b25a, eye: 0xd8b8ff, eyeR: 0.075, eyeSep: 0.14, eyeI: 2.2, span: 3.0, flap: 2.6, tufts: true, disc: 0x8a7ab8, headS: 1.6, beakL: 0.4, rad: [[0, 0.2], [0.06, 0.36], [0.14, 0.42], [0.24, 0.42], [0.42, 0.56], [0.65, 0.52], [0.86, 0.32], [1, 0.14]], len: 1.9, neckUp: 0.12, ghost: 0.9, glow: 0x3a2a9a, glowI: 0.5, edge: 0x6b4cff, edgeI: 0.25, tailL: 0.7 }); },
  7: function () { return bird({ hook: true, headS: 1.15, rad: [[0, 0.15], [0.05, 0.25], [0.12, 0.28], [0.2, 0.24], [0.32, 0.42], [0.5, 0.46], [0.7, 0.44], [0.88, 0.32], [1, 0.16]], len: 3.0, neckUp: 0.35, back: 0xb08a4a, belly: 0xe6cf98, head: 0xf5f2e8, face: 0xf5f2e8, wing0: 0x4c6ea8, wing1: 0x1a2a52, cov: 0x8aa8d8, beakC: 0xe8b84a, eye: 0x9ff4ff, span: 3.8, flap: 2.4, lion: 0xb08a4a, quad: true, storm: true, edge: 0x58c8ff, edgeI: 0.35, len: 2.8, crest: 0xf5f2e8 }); },
  8: function () { return treant({}); },
  9: function () { return troll({}); },
  10: function () { return ghoulArcher({}); },
  11: function () { return kraken({}); },
  12: function () { return siren({}); },
  13: function () { return wight({}); },
  ysolde: function () { var b = bird({ back: 0x8a8498, belly: 0xe2dcea, head: 0x9a94a8, face: 0xf0ecf6, wing0: 0x8a8498, wing1: 0x3a3448, cov: 0xb8b2c8, beakC: 0xd6b25a, eye: 0xffd27a, eyeR: 0.075, eyeSep: 0.14, eyeI: 2, span: 2.6, flap: 1.6, flapAmp: 0.45, tufts: true, disc: 0xf2eef8, headS: 1.6, beakL: 0.4, rad: [[0, 0.2], [0.06, 0.36], [0.14, 0.42], [0.24, 0.42], [0.42, 0.56], [0.65, 0.52], [0.86, 0.32], [1, 0.14]], len: 1.8, neckUp: 0.12, tailL: 0.6, glow: 0x2a2440, glowI: 0.6 }); b.ysolde = true; return b; }
};
