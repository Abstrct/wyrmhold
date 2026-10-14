// @ts-nocheck
/* WyrmKit — the living world of Wyrmhodl.
 * Procedural sky-isles, beasts and rites, drawn with three.js. The look (light, sky, cloud,
 * post) lives in look.js, the land in land.js, the great beasts in beasts.js; this file holds
 * the bestiary index and the scenes. Every scene returns a small controller the page drives. */
import * as T from 'three';
import { TAU, rng, hashStr, makeNoise, clamp, lerp, smooth, M, G, mesh, glowSprite, softDot, runeDisc, runeTexture, Stage, mood, sky, cloudSea, cloudscape, cloudBank, lights, motes, U, MOODS, seaShadow, shootingStars, nameplate, holdTextureHooks } from './look.js';
import { isle, dressIsle, crystal, keep, waterfall, floraGeo, CANOPIES, prep, rgb, mixc, at, taperTube, hamlet, lanterns, flock as birdFlock } from './land.js';
import { wyrm, SpineBody, onFrame, keys, BESTIARY } from './beasts.js';
import { hallow } from './hallows.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

  var K = {};
  K.rng = rng; K.hashStr = hashStr; K.makeNoise = makeNoise;
  K.C = {
    night: 0x0b0e1a, gold: 0xe8c872, verdigris: 0x5fd3b5, ember: 0xff7a4d,
    violet: 0x8b6cff, rose: 0xff8fb1, moss: 0x4f7f4a, stone: 0x6b6478, ice: 0x9fd8ff
  };
  K.glowSprite = glowSprite; K.runeDisc = runeDisc; K.crystal = crystal; K.Stage = Stage; K.sky = sky; K.cloudSea = cloudSea;
  K.lights = lights; K.motes = motes; K.isle = isle; K.dressIsle = dressIsle;


  /* ---------------------------------------------------- the bestiary index */
  // type id (the chain's struct type) -> how its beast is shaped
  var BEASTS = {
    1: function (o) { return wyrm(Object.assign({ color: 0xd2a043, belly: 0xf6e2b0, wing: 0xa83048, eye: 0xfff6b0, span: 5.2 }, o || {})); }
  };

  function beast(type, o) {
    type = +type;
    var b = BESTIARY[type] ? BESTIARY[type](o) : BEASTS[type] ? BEASTS[type](o) : hallow(type, {});
    return sane(b, type);
  }
  /* A mesh with a NaN in it is never drawn, but it poisons everything that measures it: the seat on
   * the ground, the camera's target, the name tag. Such a part is dropped and said once, so the rest
   * of the beast still stands and the screen can never go black over it. */
  function sane(b, type) {
    var bad = [];
    b.obj.traverse(function (m) {
      var pa = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
      if (!pa) return;
      var a = pa.array;
      for (var i = 0; i < a.length; i++) if (a[i] !== a[i] || a[i] === Infinity || a[i] === -Infinity) { bad.push(m); return; }
    });
    if (bad.length) {
      console.error('[wyrmhold] beast ' + type + ': ' + bad.length + ' part(s) with a broken shape were left out');
      bad.forEach(function (m) { if (m.parent) m.parent.remove(m); });
    }
    return b;
  }
  K.sane = sane;
  K.beast = beast;
  K.dragon = wyrm;

  // realm ambit for each beast type (matches the chain's operating ambit)
  K.REALM = { 1: 'skies', 2: 'starfall', 3: 'starfall', 4: 'starfall', 5: 'skies', 6: 'skies', 7: 'skies', 8: 'wilds', 9: 'wilds', 10: 'wilds', 11: 'deeps', 12: 'deeps', 13: 'deeps', 14: 'wilds', 15: 'wilds', 16: 'starfall', 17: 'starfall', 18: 'wilds', 19: 'wilds', 20: 'wilds', 21: 'wilds', 22: 'wilds' };
  // how big each looks beside its kin
  var SCALE = { 1: 0.8, 2: 0.75, 3: 0.8, 4: 0.7, 5: 0.6, 6: 0.6, 7: 0.6, 8: 0.6, 9: 0.55, 10: 0.7, 11: 0.45, 12: 0.5, 13: 0.55, 14: 0.7, 15: 0.7, 16: 0.7, 17: 0.8, 18: 0.7, 19: 0.6, 20: 0.7, 21: 0.6, 22: 0.45 };

  /* ------------------------------------------------------------ particles */
  function Bursts(stage) {
    var list = [];
    stage.add(function (t, dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var b = list[i]; b.age += dt;
        var k = b.age / b.life;
        if (k >= 1) { stage.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); list.splice(i, 1); continue; }
        var p = b.pos;
        for (var j = 0; j < b.n; j++) {
          b.vel[j * 3 + 1] += b.grav * dt;
          var drag = Math.exp(-dt * (b.drag || 0.6));
          b.vel[j * 3] *= drag; b.vel[j * 3 + 2] *= drag;
          p[j * 3] += b.vel[j * 3] * dt; p[j * 3 + 1] += b.vel[j * 3 + 1] * dt; p[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
          if (b.swirl) { var x = p[j * 3] - b.o.x, z = p[j * 3 + 2] - b.o.z, c = Math.cos(dt * b.swirl), s = Math.sin(dt * b.swirl); p[j * 3] = b.o.x + x * c - z * s; p[j * 3 + 2] = b.o.z + x * s + z * c; }
        }
        b.pts.geometry.attributes.position.needsUpdate = true;
        b.pts.material.uniforms.fade.value = 1 - k * k;
      }
    });
    return function burst(origin, o) {
      o = o || {};
      var n = o.count || 80, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), sz = new Float32Array(n), sp = o.speed || 6;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, u = o.up ? Math.random() * 0.4 + 0.6 : Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
        var rad = o.ring ? (o.ring * (0.8 + Math.random() * 0.4)) : 0;
        pos[i * 3] = origin.x + Math.cos(a) * rad; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z + Math.sin(a) * rad;
        var s = sp * (0.4 + Math.random() * 0.6);
        vel[i * 3] = Math.cos(a) * r * s * (o.spread == null ? 1 : o.spread); vel[i * 3 + 1] = u * s; vel[i * 3 + 2] = Math.sin(a) * r * s * (o.spread == null ? 1 : o.spread);
        sz[i] = 0.5 + Math.random();
      }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('sz', new T.BufferAttribute(sz, 1));
      var mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { color: { value: new T.Color(o.color || 0xffe08a).multiplyScalar(o.i || 2.6) }, size: { value: (o.size || 0.6) * 40 }, fade: { value: 1 }, pr: { value: stage.renderer.getPixelRatio() } },
        vertexShader: 'attribute float sz; uniform float size; uniform float pr; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * sz * pr / -mv.z * 10.0; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 color; uniform float fade; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * fade; gl_FragColor = vec4(color * a, a); }'
      });
      var pts = new T.Points(g, mat);
      pts.frustumCulled = false;
      stage.scene.add(pts);
      list.push({ pts: pts, pos: pos, vel: vel, n: n, age: 0, life: o.life || 1.6, grav: o.grav == null ? -4 : o.grav, swirl: o.swirl || 0, drag: o.drag, o: origin.clone() });
    };
  }
  K.Bursts = Bursts;

  /* -------------------------------------------------------------- orbit cam */
  function Orbit(stage, o) {
    o = o || {};
    var cam = stage.camera, canvas = stage.canvas;
    var cur = { az: o.az || 0.7, el: o.el || 0.35, dist: o.dist || 50, target: (o.target || new T.Vector3()).clone() };
    var goal = { az: cur.az, el: cur.el, dist: cur.dist, target: cur.target.clone() };
    var drag = false, px = 0, py = 0, moved = 0, idle = 0, life = 0;
    // each scene opens a little further out, higher and turned, and settles in slowly
    var intro = o.intro !== false && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (intro) { cur.dist *= 1.7; cur.el = Math.min(1.2, cur.el + 0.28); cur.az -= 0.45; }
    // one finger (or the mouse) turns the view; two fingers pinch to zoom; a tap picks
    var pts = new Map(), pinch = null, pinched = false;
    var span = function () { var a = Array.from(pts.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
    function down(e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { }
      if (pts.size === 1) { drag = true; pinched = false; px = e.clientX; py = e.clientY; moved = 0; }
      else if (pts.size === 2) { pinch = { span: span(), dist: goal.dist }; pinched = true; idle = 0; }
    }
    function move(e) {
      var p = pts.get(e.pointerId); if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pts.size >= 2) { goal.dist = clamp(pinch.dist * pinch.span / span(), o.min || 10, o.max || 200); idle = 0; return; }
      if (!drag) return;
      var dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      goal.az -= dx * 0.006; goal.el = clamp(goal.el + dy * 0.004, o.minEl == null ? 0.02 : o.minEl, o.maxEl || 1.35);
      idle = 0;
    }
    function up(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size >= 2) { pinch = { span: span(), dist: goal.dist }; return; }
      pinch = null;
      // one finger stays after a pinch: it carries on turning from where it is, without a jump
      if (pts.size === 1) { var r0 = pts.values().next().value; px = r0.x; py = r0.y; return; }
      drag = false;
      if (e.type === 'pointerup' && !pinched && moved < 6 && o.onTap) {
        var r = canvas.getBoundingClientRect();
        o.onTap(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
      }
    }
    function wheel(e) { e.preventDefault(); goal.dist = clamp(goal.dist * (1 + e.deltaY * 0.0012), o.min || 10, o.max || 200); idle = 0; }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.style.touchAction = 'none';
    stage.add(function (t, dt) {
      idle += dt; life += dt;
      if (!drag && o.auto && idle > 2.5) goal.az += dt * o.auto;
      var k = 1 - Math.exp(-dt * (o.ease || 3) * (intro && !drag ? 0.22 + 0.78 * smooth(0, 4, life) : 1));
      cur.az = lerp(cur.az, goal.az, k); cur.el = lerp(cur.el, goal.el, k); cur.dist = lerp(cur.dist, goal.dist, k);
      cur.target.lerp(goal.target, k);
      var ce = Math.cos(cur.el);
      cam.position.set(cur.target.x + Math.sin(cur.az) * ce * cur.dist, cur.target.y + Math.sin(cur.el) * cur.dist, cur.target.z + Math.cos(cur.az) * ce * cur.dist);
      cam.lookAt(cur.target);
    });
    return {
      goal: goal,
      // a target that is not a number would carry the camera off into nothing for good: refuse it
      to: function (target, dist, el, az) { if (target && isFinite(target.x) && isFinite(target.y) && isFinite(target.z)) goal.target.copy(target); else if (target) console.error('[wyrmhold] the camera was asked to look at nowhere', target); if (dist && isFinite(dist)) goal.dist = dist; if (el != null && isFinite(el)) goal.el = el; if (az != null && isFinite(az)) goal.az = az; idle = 0; },
      dispose: function () { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); }
    };
  }
  K.Orbit = Orbit;

  function picker(stage, roots) {
    var rc = new T.Raycaster();
    return function (ndc) {
      rc.setFromCamera(ndc, stage.camera);
      var hits = rc.intersectObjects(roots(), true);
      for (var i = 0; i < hits.length; i++) {
        var o = hits[i].object;
        if (o.isInstancedMesh && o.userData.picks && hits[i].instanceId != null) return o.userData.picks[hits[i].instanceId];
        while (o) { if (o.userData && o.userData.pick != null) return o.userData.pick; o = o.parent; }
      }
      return null;
    };
  }

  /* What can be touched should say so: while the mouse moves (at most once a frame) find what is under
   * it, show a pointer, and tell the scene so it can mark the thing. */
  function hoverable(stage, pick, onHover) {
    var canvas = stage.canvas, ndc = new T.Vector2(), pending = false, last = null, inside = false;
    function run() {
      pending = false;
      var id = inside ? pick(ndc) : null;
      if (id === undefined) id = null;
      if (id !== last) { last = id; canvas.style.cursor = id != null ? 'pointer' : ''; if (onHover) onHover(id); }
    }
    function mv(e) {
      if (e.pointerType === 'touch' || e.buttons) return;
      var r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); inside = true;
      if (!pending) { pending = true; requestAnimationFrame(run); }
    }
    function lv() { inside = false; run(); }
    canvas.addEventListener('pointermove', mv); canvas.addEventListener('pointerleave', lv);
    return function () { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerleave', lv); canvas.style.cursor = ''; };
  }

  /* The ward: only its edge and a slow drift of hexes show, and it flares when struck. */
  function wardDome(radius, color) {
    var mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      uniforms: { time: U.uTime, c: { value: new T.Color(color || 0x8fe8ff) }, power: { value: 0.5 }, flash: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; uniform float time; uniform vec3 c; uniform float power; uniform float flash;',
        'void main(){ float f = pow(max(1.0 - abs(dot(vN, vV)), 0.0), 4.0);',
        ' vec2 q = vec2(atan(vP.z, vP.x + 1e-4) * 9.0, vP.y * 0.9);',
        ' vec2 g = abs(fract(q + vec2(0.5 * floor(q.y), 0.0)) - 0.5);',
        ' float hex = smoothstep(0.44, 0.5, max(g.x * 1.2, g.y));',
        ' float sweep = smoothstep(0.85, 1.0, sin(vP.y * 0.25 - time * 0.8) * 0.5 + 0.5);',
        ' float a = (f * 0.45 + hex * (0.04 + sweep * 0.18) * (0.4 + f)) * power + flash * (f + hex * 0.5);',
        ' float base = smoothstep(0.0, 4.0, vP.y + 2.0) * smoothstep(4.0, 14.0, vD);',
        ' gl_FragColor = vec4(c * a * base * 1.4, a * base);',
        '}'
      ].join('\n')
    });
    var m = new T.Mesh(new T.SphereGeometry(radius, 64, 32, 0, TAU, 0, Math.PI * 0.6), mat);
    m.renderOrder = 5;
    return { obj: m, mat: mat };
  }

  /* Small isles drifting at a distance, each a little world. */
  function farIsles(st, list) {
    var out = [];
    list.forEach(function (d, i) {
      var fi = isle({ radius: d.r, seed: d.seed || 30 + i, rings: 14, segs: 44, under: 10, hills: 1.1, lake: false, roots: d.r > 4 });
      dressIsle(fi, { trees: Math.round(d.r * d.r * 0.9), rocks: 3, glowcaps: 2, bushes: Math.round(d.r * 1.5), grass: Math.round(d.r * d.r * 2), flowers: Math.round(d.r * d.r), seed: 40 + i });
      fi.group.position.set(d.x, d.y, d.z); fi.group.rotation.y = i * 1.7;
      st.scene.add(fi.group); out.push({ g: fi.group, y: d.y, ph: i * 1.3 });
    });
    st.add(function (t) { for (var i = 0; i < out.length; i++) out[i].g.position.y = out[i].y + Math.sin(t * 0.25 + out[i].ph) * 0.8; });
    return out;
  }

  /* Alpha rain: the first light falling, as it did when the sky broke. */
  function alphaRain(st, o) {
    o = o || {};
    var RN = o.count || 1800, rpos = new Float32Array(RN * 3), rvel = new Float32Array(RN), rr = rng(808);
    for (var q = 0; q < RN; q++) { rpos[q * 3] = (rr() - 0.5) * 160; rpos[q * 3 + 1] = rr() * 100 - 25; rpos[q * 3 + 2] = (rr() - 0.5) * 160; rvel[q] = 7 + rr() * 11; }
    var rgeo = new T.BufferGeometry(); rgeo.setAttribute('position', new T.BufferAttribute(rpos, 3)); rgeo.setAttribute('vel', new T.BufferAttribute(rvel, 1));
    var rmat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { color: { value: new T.Color(0xffd98a).multiplyScalar(3.4) }, level: { value: 0 }, pr: { value: st.renderer.getPixelRatio() } },
      vertexShader: 'attribute float vel; uniform float pr; varying float vV; void main(){ vV = vel; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp((7.0 + vel * 0.5) * pr * (60.0 / -mv.z), 2.0, 64.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 color; uniform float level; varying float vV; void main(){ vec2 p = gl_PointCoord - 0.5; float core = smoothstep(0.5, 0.0, length(p * vec2(4.0, 0.62))); float head = smoothstep(0.22, 0.0, length((p - vec2(0.0, 0.32)) * vec2(2.2, 1.6))); float a = (core * 0.7 + head) * level; gl_FragColor = vec4(mix(color, vec3(3.0, 2.8, 2.4), head * 0.5) * a, a); }'
    });
    var rain = new T.Points(rgeo, rmat); rain.frustumCulled = false; st.scene.add(rain);
    var on = 0, lvl = 0;
    st.add(function (t, dt) {
      lvl += ((on ? 1 : 0) - lvl) * Math.min(1, dt * 1.2);
      rmat.uniforms.level.value = lvl;
      if (lvl > 0.01) {
        for (var q = 0; q < RN; q++) { rpos[q * 3 + 1] -= rvel[q] * dt; rpos[q * 3] += Math.sin(t + q) * dt * 0.6; if (rpos[q * 3 + 1] < -35) rpos[q * 3 + 1] = 75; }
        rgeo.attributes.position.needsUpdate = true;
      }
    });
    return { set: function (v) { on = v ? 1 : 0; }, level: function () { return lvl; } };
  }

  /* ============================================================== SCENES */

  /* ---- The Gate: title vista ---- */
  K.gate = function (canvas, o) {
    o = o || {};
    var md = mood('gate');
    var st = Stage(canvas, { mood: md, fov: 36 });
    sky(st, md); cloudSea(st, md); lights(st, md, { span: 34 });
    cloudscape(st, { seed: 7, mid: 16, midR0: 150, midR1: 520, midY: 0, midYR: 22, midS: 34, midSR: 50, extra: [
      { x: -46, y: -36, z: -40, w: 52, h: 26, v: 2, a: 0.95, s: 0.1 }, { x: 40, y: -40, z: 20, w: 46, h: 24, v: 5, a: 0.95, s: 0.2 }
    ] });
    var paths = [[[-1.2, -1.0], [0.8, 1.2], [2.2, 2.7]], [[-1.0, -2.0], [2.0, -3.8], [4.7, -5.3]], [[-2.4, 0.9], [-5.8, 3.4], [-8.8, 5.8]]];
    var I = isle({ radius: 17, seed: 7, lake: true, lakeAngle: 0.9, paths: paths });
    var kx = -4.5, kz = -3.5;
    var homes = [{ x: -6.6, z: 1.9, ry: 0.5 }, { x: -9.4, z: 3.9, ry: -0.7 }, { x: -4.6, z: 4.6, ry: 1.3 }, { x: -10.6, z: 7.6, ry: 2.4 }, { x: -7.4, z: 7.2, ry: -0.2, s: 0.9 }];
    dressIsle(I, { trees: 66, seed: 4, avoid: [{ x: kx, z: kz, r: 6.6 }, { x: 6, z: -6, r: 2.5 }].concat(homes.map(function (h) { return { x: h.x, z: h.z, r: 1.7 }; })) });
    st.scene.add(I.group); st.add(I.update);
    I.group.add(hamlet(I, homes, { seed: 3 }));
    I.group.add(lanterns(I, [{ x: 0.3, z: 0.4 }, { x: 1.7, z: 2.0 }, { x: 0.6, z: -3.0 }, { x: 3.3, z: -4.5 }, { x: -4.2, z: 2.4 }, { x: -7.2, z: 4.6 }]));
    var birds = birdFlock(16, { radius: 42, y: 17, size: 0.55, seed: 8 }); st.scene.add(birds); st.add(birds.userData.update);
    var whale = BESTIARY[2](); whale.obj.scale.setScalar(4.2); st.scene.add(whale.obj);
    st.add(function (t) { var wa = 1.25 + t * 0.004; whale.obj.position.set(Math.cos(wa) * 420, 58 + Math.sin(t * 0.1) * 8, Math.sin(wa) * 420 - 900); whale.obj.rotation.y = -wa; whale.update(t * 0.5); });
    seaShadow(st, 0, 0, 46);
    var kp = keep(); kp.position.set(kx, I.heightAt(kx, kz) - 0.1, kz); kp.scale.setScalar(0.92); kp.rotation.y = 0.4; st.scene.add(kp);
    var hc = hallow(20, {}); hc.obj.position.copy(I.surface(6, -6)); st.scene.add(hc.obj); st.add(hc.update);
    farIsles(st, [
      { r: 5, x: -70, y: 6, z: -60 }, { r: 3.4, x: -44, y: 22, z: -95 }, { r: 6.5, x: 80, y: -4, z: -90 }, { r: 3, x: 58, y: 18, z: -40 },
      { r: 4.2, x: -95, y: -10, z: 20 }, { r: 2.6, x: 30, y: 30, z: -130 }, { r: 5.5, x: 110, y: 10, z: 30 }, { r: 3.8, x: -20, y: -16, z: -150 }
    ]);
    motes(st, { count: 320, box: 60, h: 26, y: -4 });
    var wy = wyrm({ span: 5.4, flap: 1.5 });
    wy.obj.scale.setScalar(1.25);
    st.scene.add(wy.obj);
    var flock = [];
    for (var i = 0; i < 6; i++) { var h = BESTIARY[5](); h.obj.scale.setScalar(0.32); st.scene.add(h.obj); flock.push(h); }
    var px = 0, py = 0;
    function pm(e) { var r = canvas.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width - 0.5); py = ((e.clientY - r.top) / r.height - 0.5); }
    window.addEventListener('pointermove', pm);
    var look = new T.Vector3(0, 3, 0), aim = new T.Vector3(), right = new T.Vector3(), dir = new T.Vector3(), prevW = new T.Vector3();
    var rain = alphaRain(st), lookY = -2;
    // on first sight the camera glides in from high and far, settling into its slow orbit
    var intro0 = -1, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    st.add(function (t, dt) {
      if (intro0 < 0) intro0 = t;
      var ik = still ? 1 : Math.min(1, (t - intro0) / 4.5), ie = 1 - Math.pow(1 - ik, 3), far = 74 + (1 - ie) * 46;
      var a = 0.42 + Math.sin(t * 0.035) * 0.5 - (1 - ie) * 0.35;
      var lift = rain.level();
      st.camera.position.set(Math.sin(a) * far + px * 5, 12 + (1 - ie) * 18 - py * 4 + lift * 6, Math.cos(a) * far);
      look.y = lookY + lift * 9;
      right.set(Math.cos(a), 0, -Math.sin(a));
      aim.copy(look).addScaledVector(right, -12 * (canvas.clientWidth > 900 ? 1 : 0.2));
      st.camera.lookAt(aim);
      wy.update(t);
      var wa = -t * 0.16;
      prevW.copy(wy.obj.position);
      // a lap in five is a low pass that swings out toward the watcher
      var lap = (t * 0.16) / TAU, camAng = Math.PI / 2 - a, near = Math.pow(Math.max(0, Math.cos(wa - camAng + 0.35)), 10) * Math.max(0, Math.cos((lap + 1.13) * Math.PI));
      var wr = 30 + near * 26;
      wy.obj.position.set(Math.cos(wa) * wr, 10 + Math.sin(t * 0.45) * 3.5 - near * 4, Math.sin(wa) * wr);
      if (prevW.lengthSq() > 0) { dir.subVectors(wy.obj.position, prevW); if (dir.lengthSq() < 1e-6) dir.set(Math.sin(wa), 0, -Math.cos(wa)); }
      else dir.set(Math.sin(wa), Math.cos(t * 0.45) * 0.05, -Math.cos(wa));
      wy.obj.lookAt(wy.obj.position.clone().add(dir));
      wy.obj.rotateZ(0.32 + near * 0.2);
      for (var i = 0; i < flock.length; i++) {
        flock[i].update(t);
        var fa = t * 0.12 + i * 0.22;
        flock[i].obj.position.set(Math.cos(fa) * 52 + i * 1.6, 20 + Math.sin(t + i) * 1.2 + (i % 2) * 1.5, Math.sin(fa) * 52 - 12);
        flock[i].obj.lookAt(Math.cos(fa + 0.1) * 52 + i * 1.6, 20, Math.sin(fa + 0.1) * 52 - 12);
      }
      var b = kp.userData.beacon; b.material.opacity = 0.65 + 0.3 * Math.sin(t * 2);
    });
    return {
      rain: function (on) { rain.set(on); },
      dispose: function () { window.removeEventListener('pointermove', pm); st.dispose(); }
    };
  };

  /* ---- The Hold: your isle, your hallows, your warband ---- */
  K.hold = function (canvas, o) {
    o = o || {};
    var md = mood('hold');
    var st = Stage(canvas, { mood: md, fov: 38 });
    sky(st, md); cloudSea(st, md); lights(st, md, { span: 40 });
    cloudscape(st, { seed: 19, mid: 16, midR0: 90, midR1: 420, midY: 2, midYR: 30, extra: [
      { x: -46, y: -28, z: 26, w: 64, h: 32, v: 1, a: 0.95, s: 0.15 }, { x: 52, y: -32, z: -20, w: 72, h: 36, v: 4, a: 0.95, s: 0.1 }
    ] });
    var R = 19;
    var plots = [];
    for (var i = 0; i < 9; i++) { var a = 2.0 + i * 0.52, d = i % 2 ? R * 0.62 : R * 0.36; plots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 3 }); }
    var I = isle({ radius: R, seed: o.seed || 17, lake: true, lakeAngle: 0.5, lakeSize: 0.28, paths: [plots.map(function (p) { return [p.x, p.z]; })] });
    var wildSpots = [];
    for (i = 0; i < 14; i++) { a = -1.6 + i * 0.32 + (i % 2) * 0.1; d = R * (0.76 + (i % 3) * 0.05); wildSpots.push({ x: Math.cos(a + 3.6) * d, z: Math.sin(a + 3.6) * d, r: 2 }); }
    var homes = [{ x: 2.0, z: 9.0, ry: 0.4 }, { x: 4.8, z: 11.6, ry: -0.3 }, { x: -0.6, z: 1.4, ry: 1.0 }];
    // the Elder Wyrm's lair: the stretch of rim with the most room, its body lying along the edge
    var lair = (function () {
      var best = null, WL = 4.4, WT = 2.0;
      for (var la = 0; la < TAU; la += 0.04) for (var ld = R * 0.6; ld <= R * 0.8; ld += R * 0.05) {
        var cx = Math.cos(la) * ld, cz = Math.sin(la) * ld, tx = -Math.sin(la), tz = Math.cos(la), clear = 99, ok = true;
        [[0, 0], [WL, 0], [-WL, 0], [WL * 0.5, 1], [-WL * 0.5, 1], [WL * 0.5, -1], [-WL * 0.5, -1]].forEach(function (q) {
          var px = cx + tx * q[0] + Math.cos(la) * q[1] * 1.2, pz = cz + tz * q[0] + Math.sin(la) * q[1] * 1.2;
          if (Math.hypot(px, pz) > R * I.edgeK(Math.atan2(pz, px)) * 0.86) ok = false;
          if (I.lake) clear = Math.min(clear, Math.hypot(px - I.lake.x, pz - I.lake.z) - I.lake.r * 1.15);
          plots.forEach(function (pl) { clear = Math.min(clear, Math.hypot(px - pl.x, pz - pl.z) - pl.r - 0.6); });
          homes.forEach(function (h) { clear = Math.min(clear, Math.hypot(px - h.x, pz - h.z) - 1.8); });
        });
        if (ok && (!best || clear > best.clear)) best = { x: cx, z: cz, a: la, tx: tx, tz: tz, clear: clear, half: WL, w: WT };
      }
      return best;
    })();
    if (lair) wildSpots = wildSpots.filter(function (w) { return Math.hypot(w.x - lair.x, w.z - lair.z) > lair.half + 2; });
    var lairAvoid = lair ? [-1, -0.33, 0.33, 1].map(function (k) { return { x: lair.x + lair.tx * lair.half * k, z: lair.z + lair.tz * lair.half * k, r: 2.6 }; }) : [];
    dressIsle(I, { trees: 58, seed: 5, avoid: plots.concat(wildSpots).concat(lairAvoid).concat(homes.map(function (h) { return { x: h.x, z: h.z, r: 1.8 }; })) });
    st.scene.add(I.group); st.add(I.update);
    I.group.add(hamlet(I, homes, { seed: 9 }));
    I.group.add(lanterns(I, plots.filter(function (_, k) { return k % 2 === 0; }).map(function (p) { return { x: p.x * 0.86 + 1.2, z: p.z * 0.86 }; })));
    seaShadow(st, 0, 0, 52);
    var holdBirds = birdFlock(12, { radius: 34, y: 24, size: 0.5, seed: 21 }); st.scene.add(holdBirds); st.add(holdBirds.userData.update);
    // worn circles where hallows may rise: a paving of flagstones with grass in the joints, a rune
    // stone at the heart, and a few leaning menhirs around the rim
    var ringParts = [], rr = rng(77);
    plots.forEach(function (p, k) {
      var y0 = I.heightAt(p.x, p.z);
      var heart = new T.CylinderGeometry(0.62, 0.7, 0.16, 7); heart.translate(p.x, y0 + 0.02, p.z);
      ringParts.push(prep(heart, rgb(0x5e574f)));
      [[6, 1.25, 0.5], [11, 2.05, 0.46]].forEach(function (ring) {
        for (var q = 0; q < ring[0]; q++) {
          var qa = (q + rr() * 0.3) / ring[0] * TAU + k, rad = ring[2] * (0.85 + rr() * 0.3), fx = p.x + Math.cos(qa) * ring[1], fz = p.z + Math.sin(qa) * ring[1];
          var flag = new T.CylinderGeometry(rad, rad * 1.05, 0.12, 5 + Math.floor(rr() * 3)); flag.rotateY(rr() * TAU); flag.scale(1, 1, 0.75 + rr() * 0.4); flag.rotateY(qa);
          flag.translate(fx, I.heightAt(fx, fz) - 0.035, fz);
          var tone = 0.27 + rr() * 0.11, moss = 0.15 + rr() * 0.4;
          ringParts.push(prep(flag, mixc([tone * 1.04, tone * 0.98, tone * 0.9], [0.2, 0.3, 0.18], moss)));
        }
      });
      for (var q = 0; q < 5; q++) {
        var qa = q / 5 * TAU + k * 0.7 + rr() * 0.4, sh = 0.7 + rr() * 0.6, mx = p.x + Math.cos(qa) * 2.75, mz = p.z + Math.sin(qa) * 2.75;
        var men = new T.CylinderGeometry(0.1 + rr() * 0.05, 0.2 + rr() * 0.06, sh, 5, 2); men.translate(0, sh / 2, 0);
        men.rotateZ((rr() - 0.5) * 0.25); men.rotateX((rr() - 0.5) * 0.25); men.rotateY(rr() * TAU);
        men.translate(mx, I.heightAt(mx, mz) - 0.08, mz);
        ringParts.push(prep(men, function (yy) { var t = clamp((yy - I.heightAt(mx, mz)) / sh, 0, 1); return mixc([0.2, 0.27, 0.18], [0.42, 0.4, 0.39], smooth(0.05, 0.5, t)); }));
      }
    });
    var rings = new T.Mesh(mergeGeo(ringParts), M(null, { vc: true, r: 0.95, grain: { scale: 5.0, amt: 0.14 } })); rings.receiveShadow = true; rings.castShadow = true; st.scene.add(rings);
    motes(st, { count: 260, box: 54, h: 24, y: -2 });
    farIsles(st, [{ r: 4, x: -80, y: 4, z: -70 }, { r: 3, x: 70, y: 16, z: -90 }, { r: 5.5, x: 95, y: -6, z: 40 }, { r: 3.2, x: -60, y: 20, z: 80 }]);
    var dome = wardDome(R * 1.35); dome.obj.position.y = -2; st.scene.add(dome.obj);
    var burst = Bursts(st);
    // a tall phone screen sees a narrow slice of the isle, and its panels cover the near rim: open with
    // the Wyrm's lair on the far rim, high in the window, so the beast a new warden is asked to touch is
    // in view from the first moment
    var cw = canvas.clientWidth || window.innerWidth, chh = canvas.clientHeight || window.innerHeight;
    var tallH = cw / Math.max(1, chh) < 0.9;
    var az0 = tallH && lair ? Math.atan2(-lair.x, -lair.z) : 0.9;
    // (and holds that view: a phone does not drift the Wyrm out of its narrow window; a drag still turns it)
    var orbit = Orbit(st, { dist: 74, el: 0.5, az: az0, target: new T.Vector3(0, 3, 0), min: 18, max: 140, auto: tallH ? 0 : 0.025, onTap: function (ndc) { var id = pick(ndc); if (o.onPick) o.onPick(id); } });

    var units = {}, roots = [];
    var counters = { skies: 0, starfall: 0, wilds: 0, deeps: 0, hallow: 0 };
    var selRing = runeDisc(2.2, '#e8c872', 0.95, 2.4); selRing.visible = false; st.scene.add(selRing);
    var selBeam = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 30, 24, 1, true), G(0xe8c872, { t: true, o: 0.1, add: true, ds: true, i: 2 })); selBeam.visible = false; st.scene.add(selBeam);
    var selected = null;
    // an empty circle glows faintly with runes, so it reads as a place where a hallow may rise
    var plotGlows = plots.map(function (p, k) { var d = runeDisc(2.0, '#e8c872', 0.25, 1.5); d.position.set(p.x, I.heightAt(p.x, p.z) + 0.14, p.z); st.scene.add(d); return d; });
    st.add(function (t) {
      var occ = {}; for (var id in units) if (units[id].slot != null) occ[units[id].slot] = 1;
      for (var k = 0; k < plotGlows.length; k++) { var d = plotGlows[k]; d.visible = !occ[k]; d.rotation.z = k + t * 0.04; d.material.opacity = 0.16 + 0.1 * Math.sin(t * 1.1 + k * 1.7); }
    });

    // set a ground creature down: its lowest point rests on the highest ground beneath its footprint
    var _box = new T.Box3();
    function seat(holder) {
      holder.position.y = 0; holder.updateMatrixWorld(true);
      _box.setFromObject(holder);
      var top = -Infinity;
      for (var gx = 0; gx <= 4; gx++) for (var gz = 0; gz <= 4; gz++) {
        var sx = lerp(_box.min.x, _box.max.x, gx / 4), sz = lerp(_box.min.z, _box.max.z, gz / 4);
        if (Math.hypot(sx, sz) < R * I.edgeK(Math.atan2(sz, sx)) * 0.97) top = Math.max(top, I.heightAt(sx, sz));
      }
      if (top === -Infinity) top = I.heightAt(holder.position.x, holder.position.z);
      holder.position.y = top - _box.min.y - 0.04;
      // a shape that could not be measured stands on the ground rather than nowhere
      if (!isFinite(holder.position.y)) holder.position.y = I.heightAt(holder.position.x, holder.position.z);
    }
    // a unit's own copy of a shared material: clone() drops the shader patch (rim, grain, scales), so carry it over
    function ownCopy(src) {
      var c = src.clone(); c.onBeforeCompile = src.onBeforeCompile; c.customProgramCacheKey = src.customProgramCacheKey; c.userData.own = true;
      // clone() deep-copies uniforms: point the shared ones (the clock) back at the globals, or the copy freezes
      if (src.uniforms) for (var k in src.uniforms) for (var g in U) if (src.uniforms[k] === U[g]) c.uniforms[k] = U[g];
      return c;
    }
    // one key for "is this the same unit as before": placeUnit and sync must agree, or every bell rebuilds everything
    function unitKey(u) { var t = +u.type; return [t, u.realm || K.REALM[t], !!u.offline, !!u.building, u.label || ''].join('|'); }
    function placeUnit(u) {
      var type = +u.type, realm = u.realm || K.REALM[type];
      var perch = type === 1 && realm === 'wilds' && lair;
      var b = beast(type, perch ? { pose: 'perch' } : undefined);
      var holder = new T.Group(); holder.add(b.obj);
      holder.userData.pick = u.id;
      b.obj.scale.multiplyScalar(SCALE[type] || 0.6);
      var info = { u: u, b: b, holder: holder, realm: realm, type: type };
      if (type >= 14) {
        var slot = (u.plot != null ? u.plot : counters.hallow++) % plots.length, p = plots[slot];
        // a warden's own works should stand above the grove, not hide in it
        if (type !== 16 && type !== 17) { info.slot = slot; b.obj.scale.multiplyScalar(1.35); }
        if (type === 16 || type === 17) {
          info.orbit = { r: R * 0.9 + (slot % 3) * 2, y: 20 + (slot % 2) * 4, s: 0.06, ph: slot * 1.7 };
        } else {
          holder.position.copy(I.surface(p.x, p.z)); holder.rotation.y = Math.atan2(-p.x, -p.z) + Math.PI;
        }
      } else if (perch) {
        // the Wyrm lies along the rim in its lair, head to the wind
        holder.position.set(lair.x, 0, lair.z); holder.rotation.y = Math.atan2(lair.tx, lair.tz);
        seat(holder);
      } else if (realm === 'wilds') {
        var ws = wildSpots[counters.wilds++ % wildSpots.length];
        holder.position.set(ws.x, 0, ws.z); holder.rotation.y = Math.atan2(ws.x, ws.z);
        seat(holder);
      } else if (realm === 'deeps') {
        var n = counters.deeps++;
        info.swim = { r: I.lake.r * (0.25 + (n % 3) * 0.22), s: 0.25 + n * 0.05, ph: n * 2.1 };
      } else if (realm === 'skies') {
        n = counters.skies++;
        info.orbit = { r: R * 0.85 + (n % 3) * 4, y: 9 + (n % 4) * 2.2, s: 0.16 + (n % 2) * 0.05, ph: n * 1.3, dir: n % 2 ? -1 : 1 };
      } else {
        n = counters.starfall++;
        info.orbit = { r: R * 1.35 + (n % 3) * 5, y: 22 + (n % 3) * 3, s: 0.07 + (n % 2) * 0.03, ph: n * 2.2, dir: n % 2 ? -1 : 1 };
      }
      if (u.offline) holder.traverse(function (m) { if (m.material && m.material.color) { m.material = ownCopy(m.material); m.material.color.multiplyScalar(0.35); if (m.material.emissive) m.material.emissiveIntensity *= 0.2; } });
      if (u.building) {
        holder.traverse(function (m) { if (m.material && !m.isSprite) { m.material = ownCopy(m.material); m.material.transparent = true; m.material.opacity = 0.32; m.material.depthWrite = false; } });
        info.rune = runeDisc(2.6 / (SCALE[type] || 0.6), '#e8c872', 0.9, 2.4); info.rune.position.y = 0.2; b.obj.add(info.rune);
      }
      info.key = unitKey(u);
      st.scene.add(holder);
      units[u.id] = info; roots.push(holder);
      // a small name floats over each thing on the isle, so it says what it is without a hover
      if (u.label && tagBox) {
        holder.updateMatrixWorld(true);
        var bb = new T.Box3().setFromObject(holder);
        info.tagY = Math.max(1.2, bb.max.y - holder.position.y) + 0.5;
        info.tag = document.createElement('span'); info.tag.className = 'unit-tag'; info.tag.textContent = u.label;
        // hidden until its first frame places it, or it shows for a moment in the corner of the screen
        info.tag.style.opacity = '0';
        tagBox.appendChild(info.tag);
      }
      return info;
    }
    var tagBox = canvas.parentElement ? document.createElement('div') : null;
    if (tagBox) { tagBox.className = 'unit-tags'; tagBox.setAttribute('aria-hidden', 'true'); canvas.parentElement.appendChild(tagBox); }
    (o.units || []).forEach(placeUnit);

    function worldPos(info) { var v = new T.Vector3(); info.holder.getWorldPosition(v); return v; }
    var _tv = new T.Vector3();
    // projected last each frame (registered just before ctl), after the camera and units have moved
    function projectTags() {
      if (!tagBox) return;
      var w = canvas.clientWidth, h = canvas.clientHeight, cam = st.camera;
      cam.updateMatrixWorld();
      var list = [];
      for (var id in units) {
        var info = units[id]; if (!info.tag) continue;
        info.holder.getWorldPosition(_tv); _tv.y += info.tagY * info.holder.scale.y;
        var d = _tv.distanceTo(cam.position);
        _tv.project(cam);
        // near the edges a name would be cut off or float over nothing: let it go
        var off = _tv.z > 1 || Math.abs(_tv.x) > 0.88 || Math.abs(_tv.y) > 0.9;
        var on = id === selected || id === hovered;
        info.tag.classList.toggle('on', on);
        if (off) { info.tag.style.opacity = '0'; continue; }
        if (!info.tagW) info.tagW = info.tag.offsetWidth || 90;
        list.push({ info: info, x: (_tv.x + 1) / 2 * w, y: (1 - _tv.y) / 2 * h, d: d, on: on });
      }
      // a crowded hold would stack its names into an unreadable heap: the chosen one first, then the
      // nearest, and any name that would land on one already placed waits until the view turns
      list.sort(function (a, b) { return (b.on - a.on) || (a.d - b.d); });
      var placed = [];
      for (var k = 0; k < list.length; k++) {
        var it = list[k], r = { l: it.x - it.info.tagW / 2 - 3, r: it.x + it.info.tagW / 2 + 3, t: it.y - 24, b: it.y };
        var clash = !it.on && placed.some(function (q) { return r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t; });
        it.info.tag.style.opacity = clash ? '0' : String(clamp((160 - it.d) / 70, 0.3, 1));
        if (clash) continue;
        placed.push(r);
        it.info.tag.style.transform = 'translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px) translate(-50%,-100%)';
      }
    }
    var pick = picker(st, function () { return roots; });
    var hoverRing = runeDisc(2.0, '#f6e7bf', 0.55, 1.6); hoverRing.visible = false; st.scene.add(hoverRing);
    var hovered = null;
    var unhover = hoverable(st, pick, function (id) { hovered = id; if (o.onHover) o.onHover(id); });
    st.add(function (t) {
      var hu = hovered && units[hovered];
      hoverRing.visible = !!hu && hovered !== selected;
      if (hoverRing.visible) { var hp = worldPos(hu); hoverRing.position.set(hp.x, hp.y + 0.15, hp.z); hoverRing.rotation.z = -t * 0.8; hoverRing.material.opacity = 0.45 + 0.15 * Math.sin(t * 4); }
    });

    st.add(function (t) {
      for (var id in units) {
        var u = units[id];
        u.b.update(t);
        if (u.orbit) {
          var a = t * u.orbit.s * (u.orbit.dir || 1) + u.orbit.ph;
          u.holder.position.set(Math.cos(a) * u.orbit.r, u.orbit.y + Math.sin(t * 0.7 + u.orbit.ph) * 0.8, Math.sin(a) * u.orbit.r);
          if (u.b.flying) {
            var a2 = a + 0.05 * (u.orbit.dir || 1);
            u.holder.lookAt(Math.cos(a2) * u.orbit.r, u.holder.position.y, Math.sin(a2) * u.orbit.r);
          }
        }
        if (u.rune) u.rune.rotation.z = t * 0.8;
        if (u.swim) {
          var sa = t * u.swim.s + u.swim.ph;
          u.holder.position.set(I.lake.x + Math.cos(sa) * u.swim.r, -0.9, I.lake.z + Math.sin(sa) * u.swim.r);
          u.holder.rotation.y = -sa;
        }
      }
      dome.mat.uniforms.flash.value *= 0.95;
      if (selected && units[selected]) {
        var p = worldPos(units[selected]);
        selRing.position.set(p.x, p.y + 0.15, p.z); selRing.rotation.z = t * 0.5;
        selBeam.position.set(p.x, p.y + 15, p.z);
      }
    });

    st.add(projectTags);
    var ctl = {
      setWard: function (v) { dome.mat.uniforms.power.value = clamp(v, 0, 1.4); },
      // centre the view on the open space between the screen's panels: shift the lens sideways by dx pixels
      frame: function (dx) {
        // measure from the canvas itself: on a resize the camera's aspect may not have caught up yet
        var cam = st.camera, w = st.canvas.clientWidth || 1, asp = w / Math.max(1, st.canvas.clientHeight);
        var off = -(dx / w) * 2 * Math.tan(T.MathUtils.degToRad(cam.fov / 2)) * asp * (cam.filmGauge * Math.min(asp, 1));
        if (Math.abs(off - cam.filmOffset) < 1e-4) return;
        cam.filmOffset = off; cam.updateProjectionMatrix();
      },
      select: function (id) {
        selected = id && units[id] ? id : null;
        selRing.visible = selBeam.visible = !!selected;
        if (selected && !arguments[1]) { var p = worldPos(units[selected]); orbit.to(p, 30); }
      },
      focus: function (realm) {
        var map = { all: [new T.Vector3(0, 3, 0), 74, 0.5], starfall: [new T.Vector3(0, 22, 0), 70, 0.25], skies: [new T.Vector3(0, 10, 0), 52, 0.3], wilds: [new T.Vector3(0, 1, 0), 40, 0.55], deeps: [new T.Vector3(I.lake.x, -1, I.lake.z), 22, 0.75] };
        var m = map[realm] || map.all; orbit.to(m[0], m[1], m[2]);
      },
      sync: function (list, quiet) {
        var want = {};
        list.forEach(function (u) { want[u.id] = u; });
        Object.keys(units).forEach(function (id) {
          var w = want[id], cur = units[id];
          var key = w ? unitKey(w) : null;
          if (!w) ctl.remove(id, quiet);
          else if (key !== cur.key) { ctl.remove(id, true); ctl.add(w, true); }
        });
        list.forEach(function (u) { if (!units[u.id]) ctl.add(u, quiet); });
        if (selected && units[selected]) ctl.select(selected, true);
      },
      has: function (id) { return !!units[id]; },
      /** For the proving ground: where a unit stands, and what the scene holds. */
      where: function (id) { return units[id] ? worldPos(units[id]).toArray() : null; },
      census: function () { return { units: Object.keys(units), roots: roots.length, tags: tagBox ? tagBox.childElementCount : 0, selected: selected, ward: dome.mat.uniforms.power.value }; },
      add: function (u, quiet) {
        var info = placeUnit(u);
        if (quiet) return u.id;
        st.scene.updateMatrixWorld(true);
        var p = worldPos(info);
        var disc = runeDisc(3.5, '#e8c872', 1, 2.6); disc.position.set(p.x, p.y + 0.2, p.z); st.scene.add(disc);
        var t0 = performance.now();
        info.holder.scale.setScalar(0.01);
        var f = st.add(function () {
          var k = (performance.now() - t0) / 1600;
          disc.rotation.z += 0.05; disc.scale.setScalar(1 + k * 0.6); disc.material.opacity = 1 - k;
          info.holder.scale.setScalar(clamp(k * 1.5, 0.01, 1));
          if (k >= 1) { st.scene.remove(disc); st.remove(f); }
        });
        burst(p, { color: 0xe8c872, count: 160, speed: 7, up: true, grav: -3, swirl: 2, ring: 1.5 });
        burst(p, { color: 0x9ff4ff, count: 80, speed: 3, up: true, grav: 2 });
        return u.id;
      },
      remove: function (id, quiet) {
        var u = units[id]; if (!u) return;
        var p = worldPos(u);
        if (!quiet) burst(p, { color: 0xff7a4d, count: 120, speed: 6 });
        st.scene.remove(u.holder); roots.splice(roots.indexOf(u.holder), 1); delete units[id];
        if (u.tag) u.tag.remove();
        // free the material copies this unit made for itself (shared materials stay)
        u.holder.traverse(function (m) { if (m.material && m.material.userData && m.material.userData.own) m.material.dispose(); });
        if (selected === id) ctl.select(null);
      },
      rite: function (kind) {
        var find = function (type) { for (var id in units) if (units[id].type === type) return worldPos(units[id]); return new T.Vector3(0, 2, 0); };
        if (kind === 'delve') { var p = find(14); burst(p.add(new T.Vector3(0, 1, 0)), { color: 0xffc85a, count: 140, speed: 6, up: true, grav: -6 }); }
        else if (kind === 'brew') { p = find(15); burst(p.add(new T.Vector3(0, 2.5, 0)), { color: 0x7dffb0, count: 160, speed: 3, up: true, grav: 3, swirl: 3, ring: 0.8, life: 2.4 }); }
        else if (kind === 'tithe') { burst(new T.Vector3(0, 4, 0), { color: 0xe8c872, count: 260, speed: 10, up: true, grav: 6, spread: 0.15, life: 2.6, size: 0.8 }); }
        else if (kind === 'ward') { dome.mat.uniforms.flash.value = 1.2; }
        else if (kind === 'seek') { burst(new T.Vector3(0, 6, 0), { color: 0xc9a0ff, count: 220, speed: 12, grav: 0, life: 2 }); }
      },
      dispose: function () { unhover(); orbit.dispose(); if (tagBox) tagBox.remove(); st.dispose(); }
    };
    return ctl;
  };

  function mergeGeo(list) { return list.length === 1 ? list[0] : mergeGeometriesSafe(list); }
  function mergeGeometriesSafe(list) { return BufferGeometryUtils.mergeGeometries(list); }

  /* ---- The Summoning Circle: one beast on the dais ---- */
  K.circle = function (canvas, o) {
    o = o || {};
    var md = mood('circle');
    var st = Stage(canvas, { mood: md, fov: 38 });
    sky(st, md); cloudSea(st, md, { near: 120, far: 900 }); lights(st, md, { span: 20 });
    cloudscape(st, { seed: 23, mid: 10, midR0: 70, midR1: 260, midY: 4, midYR: 18, midS: 26, midSR: 40 });
    var dais = new T.Group(); st.scene.add(dais);
    var stonePaint = function (yy, xx, zz, ny) { var n = Math.sin(xx * 2.1 + zz * 1.7) * Math.sin(yy * 3.3 + xx) * 0.5 + 0.5; return mixc(rgb(0x4a4258), rgb(0x7a7088), n * 0.6 + (ny > 0.8 ? 0.35 : 0)); };
    var parts = [];
    var base = new T.CylinderGeometry(7.2, 7.9, 1.3, 18, 1); base.translate(0, -0.65, 0); parts.push(prep(base, stonePaint));
    var step = new T.CylinderGeometry(6.5, 6.9, 0.45, 18, 1); step.translate(0, 0.2, 0); parts.push(prep(step, stonePaint));
    var lip = new T.TorusGeometry(6.55, 0.14, 4, 36); lip.rotateX(Math.PI / 2); lip.translate(0, 0.44, 0); parts.push(prep(lip, rgb(0xb89a5a)));
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * TAU + 0.22, hgt = 3.4 + (i % 2) * 1.2;
      var pl = new T.BoxGeometry(0.9, hgt, 0.7, 1, 3, 1); jiggleGeo(pl, 0.08, i);
      at(pl, Math.cos(a) * 8.6, hgt / 2 - 0.3, Math.sin(a) * 8.6, (i % 3 - 1) * 0.05, -a, (i % 2 - 0.5) * 0.06); parts.push(prep(pl, stonePaint));
      var bowl = new T.CylinderGeometry(0.55, 0.3, 0.4, 8); bowl.translate(Math.cos(a) * 8.6, hgt - 0.1, Math.sin(a) * 8.6); parts.push(prep(bowl, rgb(0x3a3040)));
      var band = new T.Mesh(new T.PlaneGeometry(0.28, hgt * 0.7), runeStrip(i % 2 ? '#5fd3b5' : '#e8c872')); band.position.set(Math.cos(a) * 8.11, hgt * 0.42 - 0.3, Math.sin(a) * 8.11); band.lookAt(0, hgt * 0.42 - 0.3, 0); dais.add(band);
      var fire = glowSprite(i % 2 ? 0x5fd3b5 : 0xffb24a, 3.0, 0.9, 2.4); fire.position.set(Math.cos(a) * 8.6, hgt + 0.6, Math.sin(a) * 8.6); dais.add(fire);
      var fl = new T.PointLight(i % 2 ? 0x5fd3b5 : 0xffa040, 5, 14, 2); fl.position.set(Math.cos(a) * 7.4, hgt + 0.8, Math.sin(a) * 7.4); dais.add(fl);
    }
    var daisM = new T.Mesh(mergeGeo(parts), M(null, { vc: true, r: 0.9, rim: 1.0, masonry: { h: 0.34, w: 0.7, amt: 0.4 } })); daisM.receiveShadow = true; daisM.castShadow = true; dais.add(daisM);
    var disc = runeDisc(6.1, '#e8c872', 0.75, 2.2); disc.position.y = 0.46; dais.add(disc);
    var inner = runeDisc(3.4, '#5fd3b5', 0.6, 2.2); inner.position.y = 0.47; dais.add(inner);
    var I = isle({ radius: 10, seed: 3, rings: 16, segs: 48, under: 12, hills: 0.4, depth: 13 }); I.group.position.y = -1.6;
    dressIsle(I, { trees: 0, bushes: 10, grass: 160, rocks: 4, flowers: 60, glowcaps: 6, seed: 9, avoid: [{ x: 0, z: 0, r: 8.4 }] });
    st.scene.add(I.group); st.add(I.update);
    motes(st, { count: 180, box: 28, h: 16, y: 0, color: 0xc9a0ff });
    shootingStars(st, { seed: 13, every: 7 });
    var burst = Bursts(st);
    // start between two pillars (they stand at 0.22 + k·2π/7) and a little above them, so none hides the creature
    // a tall phone screen sees less across: stand further back so the whole beast fits
    var tallC = canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.9;
    var orbit = Orbit(st, { dist: tallC ? 40 : 31, el: 0.27, az: 0.9, target: new T.Vector3(0, 3.6, 0), min: 10, max: 70, auto: 0.1 });
    var cur = null, holder = new T.Group(); st.scene.add(holder);
    st.studio = holder;
    var pillar = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 40, 32, 1, true), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { level: { value: 0 }, time: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float level; uniform float time; varying vec2 vUv; void main(){ float streak = 0.55 + 0.45 * sin(vUv.x * 60.0 + time * 4.0) * sin(vUv.x * 23.0 - time * 3.0); float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y); float a = level * fade * streak * 0.55; gl_FragColor = vec4(vec3(1.6, 1.25, 0.6) * a, a); }'
    })); pillar.position.y = 20; st.scene.add(pillar);
    var wave = new T.Mesh(new T.RingGeometry(0.92, 1.0, 96), new T.MeshBasicMaterial({ color: new T.Color(1.8, 1.4, 0.7), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    wave.rotation.x = -Math.PI / 2; wave.position.y = 0.52; st.scene.add(wave);
    var waveK = 1;
    var flash = 0;
    function show(type) {
      if (cur) { holder.remove(cur.obj); }
      cur = beast(type);
      var flying = cur.flying, ty = +type;
      var s = ty >= 14 ? 1.1 : (ty === 2 ? 1.0 : ty === 11 ? 0.8 : 1.3);
      if (ty === 1) s = 1.05;
      if (ty === 22) s = 0.45;
      cur.obj.scale.setScalar(s);
      cur.obj.position.y = flying ? 4.2 : 0.5;
      if (ty === 11 || ty === 12) cur.obj.position.y = 1.6;
      if (ty === 13) cur.obj.position.y = 0.5;
      if (ty === 17) cur.obj.position.y = 4;
      holder.add(cur.obj);
    }
    show(o.type || 1);
    st.add(function (t, dt) {
      if (cur) cur.update(t);
      holder.rotation.y = t * 0.22;
      disc.rotation.z = t * 0.1; inner.rotation.z = -t * 0.25;
      flash = Math.max(0, flash - dt * 0.6);
      pillar.material.uniforms.level.value = flash;
      disc.material.opacity = 0.65 + flash * 0.35;
      waveK = Math.min(1, waveK + dt * 0.9);
      wave.scale.setScalar(1 + waveK * 9); wave.material.opacity = (1 - waveK) * 0.9;
    });
    return {
      show: show,
      summon: function (type) {
        flash = 1.0; waveK = 0;
        burst(new T.Vector3(0, 0.6, 0), { color: 0xe8c872, count: 180, speed: 9, up: true, grav: -2, swirl: 3, ring: 3, i: 1.6, size: 0.45 });
        burst(new T.Vector3(0, 3, 0), { color: 0x5fd3b5, count: 90, speed: 5, grav: 1, i: 1.5, size: 0.4 });
        if (type) show(type);
        if (cur) { var target = cur.obj, s0 = target.scale.x, t0 = performance.now(); target.scale.setScalar(s0 * 0.02); var f = st.add(function () { var k = Math.min(1, (performance.now() - t0) / 1200), e = 1 - Math.pow(1 - k, 3); target.scale.setScalar(s0 * (0.02 + 0.98 * e)); if (k >= 1) st.remove(f); }); }
      },
      dispose: function () { orbit.dispose(); st.dispose(); }
    };
  };
  /* A strip of glowing runes for a standing stone. */
  var stripCache = {};
  function runeStrip(color) {
    if (stripCache[color]) return stripCache[color];
    var c = document.createElement('canvas'); c.width = 64; c.height = 512;
    var x = c.getContext('2d'), r = rng(color.length * 31 + color.charCodeAt(1));
    x.strokeStyle = color; x.lineWidth = 4; x.lineCap = 'round'; x.shadowColor = color; x.shadowBlur = 8;
    for (var i = 0; i < 9; i++) {
      x.save(); x.translate(32, 32 + i * 54); x.beginPath();
      for (var s = 0; s < 3; s++) { var ax = (r() - 0.5) * 30, ay = (r() - 0.5) * 34, bx = (r() - 0.5) * 30, by = (r() - 0.5) * 34; if (r() < 0.3) { x.moveTo(ax + 7, ay); x.arc(ax, ay, 7, 0, Math.PI * (0.8 + r())); } else { x.moveTo(ax, ay); x.lineTo(bx, by); } }
      x.stroke(); x.restore();
    }
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return (stripCache[color] = new T.MeshBasicMaterial({ map: t, color: new T.Color(2.2, 2.2, 2.2), transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  }
  function jiggleGeo(g, amt, seed) { var pa = g.attributes.position, r = rng(seed + 9); for (var i = 0; i < pa.count; i++) { pa.setX(i, pa.getX(i) + (r() - 0.5) * amt); pa.setZ(i, pa.getZ(i) + (r() - 0.5) * amt); } return g; }

  /* ---- The Sky Atlas: every warden's isle ---- */
  K.atlas = function (canvas, o) {
    o = o || {};
    var md = mood('atlas');
    var st = Stage(canvas, { mood: md, fov: 42 });
    sky(st, md); cloudSea(st, md, { near: 500, far: 2600, scale: 0.005, y: -240 }); lights(st, md, { span: 60 });
    cloudscape(st, { seed: 31, y: -240, far: 40, farR: 2200, mid: 22, midR0: 160, midR1: 900, midY: 20, midYR: 140, midS: 60, midSR: 110 });
    var covens = o.covens || [];
    var cols = o.colors || {};
    var burst = Bursts(st);
    var hubs = {};
    covens.forEach(function (c, i) {
      var a = i / covens.length * TAU + 0.3, d = i === 0 ? 0 : 300;
      var pos = new T.Vector3(Math.cos(a) * d, (i % 2) * 24 - 12, Math.sin(a) * d);
      var col = cols[c] || 0xe8c872;
      var cr = crystal(col, 4.5, i + 7); cr.position.copy(pos); st.scene.add(cr);
      // a beacon for the coven, but soft enough that its crystal still reads up close
      var gl = glowSprite(col, 30, 0.32, 1.5); gl.position.copy(pos).add(new T.Vector3(0, 5, 0)); st.scene.add(gl);
      cr.traverse(function (m) { if (m.isSprite) m.material.opacity *= 0.5; });
      var ring = runeDisc(12, '#' + new T.Color(col).getHexString(), 0.55, 2.2); ring.position.copy(pos); st.scene.add(ring);
      hubs[c] = { pos: pos, cr: cr, ring: ring };
    });
    // six small isle shapes, each one merged mesh, drawn instanced
    var shapes = [];
    for (var i = 0; i < 6; i++) {
      var gi = isle({ radius: 2.6, seed: 60 + i, rings: 7, segs: 22, under: 6, hills: 0.7, roots: false, spires: false });
      var topG = gi.top.geometry.toNonIndexed(), stoneG = gi.stone.geometry.clone();
      topG.setAttribute('aGlow', new T.BufferAttribute(new Float32Array(topG.attributes.position.count * 3), 3));
      var tr = floraGeo(i % 2 ? 'pine' : 'broad', i % 3, CANOPIES[i % CANOPIES.length]).clone(); tr.scale(0.55, 0.55, 0.55); tr.translate(0.4, gi.heightAt(0.4, 0.2), 0.2);
      var tr2 = floraGeo('pine', (i + 1) % 3).clone(); tr2.scale(0.4, 0.4, 0.4); tr2.translate(-0.8, gi.heightAt(-0.8, -0.5), -0.5);
      // a small grove on every isle, so a close look finds a place, not a token
      var extra = [], er = rng(80 + i);
      for (var q = 0; q < (st.light ? 0 : 2); q++) {
        var ea = er() * TAU, ed = 0.6 + er() * 1.3, ex = Math.cos(ea) * ed, ez = Math.sin(ea) * ed, kind = 'bush';
        var eg = (kind === 'bush' ? floraGeo('bush', 0, CANOPIES[(i + q) % CANOPIES.length]) : kind === 'pine' ? floraGeo('pine', q % 3) : floraGeo('broad', q % 2, CANOPIES[(i + q) % CANOPIES.length])).clone();
        var es = kind === 'bush' ? 0.5 + er() * 0.3 : 0.26 + er() * 0.16; eg.scale(es, es, es); eg.rotateY(er() * TAU); eg.translate(ex, gi.heightAt(ex, ez) - 0.03, ez);
        extra.push(eg);
      }
      [topG, stoneG, tr, tr2].concat(extra).forEach(function (gg) { if (!gg.attributes.normal) gg.computeVertexNormals(); });
      var merged = mergeGeometriesSafe([stripTo(topG), stripTo(stoneG), stripTo(tr), stripTo(tr2)].concat(extra.map(stripTo)));
      shapes.push({ geo: merged, list: [] });
    }
    var isles = [], perCoven = {}, linePos = [], lineCol = [];
    (o.isles || []).forEach(function (w) { perCoven[w.coven] = (perCoven[w.coven] || 0) + 1; });
    (o.isles || []).forEach(function (w, idx) {
      var h = hashStr(w.id), r = rng(h);
      var hub = hubs[w.coven] || { pos: new T.Vector3() };
      var spread = 30 + Math.sqrt(perCoven[w.coven] || 1) * 7;
      var a = r() * TAU, d = 16 + Math.sqrt(r()) * spread;
      var p = hub.pos.clone().add(new T.Vector3(Math.cos(a) * d, (r() - 0.5) * (18 + spread * 0.35), Math.sin(a) * d));
      var s = w.you ? 1.7 : 0.8 + r() * 0.5;
      var sh = shapes[h % shapes.length];
      var c = cols[w.coven] || 0xe8c872;
      var rec = { p: p, w: w, s: s, ry: r() * TAU, ph: r() * 10, shape: sh, slot: sh.list.length, idx: idx, color: w.you ? new T.Color(0xffe7a0) : new T.Color(c).lerp(new T.Color(0xffb866), 0.55), base: w.you ? 17 : 11, ore: 0 };
      sh.list.push(rec); isles.push(rec);
      linePos.push(p.x, p.y - 1, p.z, hub.pos.x, hub.pos.y, hub.pos.z);
      var lc = new T.Color(c);
      lineCol.push(lc.r * 0.9, lc.g * 0.9, lc.b * 0.9, 0, 0, 0);
    });
    var landM = M(null, { vc: true, glow: true, r: 0.9, rim: 1.3 }), meshes = [];
    shapes.forEach(function (sh) {
      if (!sh.list.length) return;
      var im = new T.InstancedMesh(sh.geo, landM, sh.list.length);
      im.userData.picks = sh.list.map(function (r) { return r.idx; });
      im.castShadow = false; im.receiveShadow = false;
      st.scene.add(im); meshes.push(im); sh.mesh = im;
    });
    var m4 = new T.Matrix4(), q4 = new T.Quaternion(), e4 = new T.Euler(), sv = new T.Vector3(), pv = new T.Vector3();
    function place(t) {
      for (var i = 0; i < isles.length; i++) {
        var s = isles[i];
        pv.set(s.p.x, s.p.y + Math.sin(t * 0.5 + s.ph) * 0.8, s.p.z); s.y = pv.y;
        e4.set(0, s.ry, 0); q4.setFromEuler(e4); sv.setScalar(s.s);
        m4.compose(pv, q4, sv); s.shape.mesh.setMatrixAt(s.slot, m4);
      }
      for (var k = 0; k < meshes.length; k++) meshes[k].instanceMatrix.needsUpdate = true;
    }
    place(0);
    // beacons above every isle, one draw
    var bn = isles.length, bpos = new Float32Array(bn * 3), bcol = new Float32Array(bn * 3), bsz = new Float32Array(bn);
    function paintBeacons() {
      for (var i = 0; i < bn; i++) {
        var s = isles[i], c = s.ore > 0 ? new T.Color(0xffa040) : s.color, k = s.ore > 0 ? 1.25 + Math.min(1.5, Math.log10(1 + s.ore) * 0.9) : 1;
        bcol[i * 3] = c.r; bcol[i * 3 + 1] = c.g; bcol[i * 3 + 2] = c.b; bsz[i] = s.base * k * s.s;
      }
    }
    paintBeacons();
    var bgeo = new T.BufferGeometry(); bgeo.setAttribute('position', new T.BufferAttribute(bpos, 3)); bgeo.setAttribute('color', new T.BufferAttribute(bcol, 3)); bgeo.setAttribute('sz', new T.BufferAttribute(bsz, 1));
    var bmat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { time: U.uTime, pr: { value: st.renderer.getPixelRatio() } },
      vertexShader: 'attribute vec3 color; attribute float sz; uniform float pr; uniform float time; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(sz * pr * 220.0 / -mv.z * (0.9 + 0.1 * sin(time * 2.0 + position.x)), 110.0 * pr); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float halo = exp(-d * d * 16.0) * 0.42 * smoothstep(0.5, 0.3, d); float core = exp(-d * d * 170.0) * 1.9; vec3 c = vC * halo * 1.6 + mix(vC, vec3(1.0, 0.96, 0.86), 0.5) * core * 2.0; gl_FragColor = vec4(c, halo + core); }'
    });
    var beacons = new T.Points(bgeo, bmat); beacons.frustumCulled = false; st.scene.add(beacons);
    var lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(linePos, 3));
    lg.setAttribute('color', new T.Float32BufferAttribute(lineCol, 3));
    var leys = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, blending: T.AdditiveBlending, depthWrite: false }));
    st.scene.add(leys);
    motes(st, { count: 900, box: 620, h: 110, y: -55, color: 0xc9b8ff, size: 16 });
    shootingStars(st, { seed: 41, every: 5, dist: 2400, len: 260 });
    var sel = runeDisc(5, '#e8c872', 1, 2.4); sel.visible = false; st.scene.add(sel);
    var beam = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 120, 24, 1, true), G(0xe8c872, { t: true, o: 0.12, add: true, ds: true, i: 2 })); beam.visible = false; st.scene.add(beam);
    var pick = picker(st, function () { return meshes; });
    var unhover = hoverable(st, pick, function (i) { if (o.onHover) o.onHover(i); });
    var orbit = Orbit(st, { dist: 230, el: 0.48, az: 0.3, target: new T.Vector3(0, 0, 0), min: 20, max: 700, auto: 0.02, onTap: function (ndc) { var i = pick(ndc); if (i != null && o.onPick) o.onPick(i); } });
    var selected = -1, ride = null;
    st.add(function (t) {
      place(t);
      for (var i = 0; i < bn; i++) { var s = isles[i]; bpos[i * 3] = s.p.x; bpos[i * 3 + 1] = s.y + 2.8 * s.s; bpos[i * 3 + 2] = s.p.z; }
      bgeo.attributes.position.needsUpdate = true;
      for (var c in hubs) { hubs[c].cr.rotation.y = t * 0.2; hubs[c].ring.rotation.z = t * 0.05; }
      if (selected >= 0) { var p = isles[selected]; sel.position.set(p.p.x, p.y - 0.8, p.p.z); sel.rotation.z = t; beam.position.set(p.p.x, p.y + 66 + 3 * p.s, p.p.z); }
      if (ride) ride(t);
    });
    var you = isles.findIndex(function (s) { return s.w.you; });
    return {
      // Isles holding unbrewed wildroot burn amber — brighter, and larger, the richer the prize.
      glowRich: function (ores) {
        for (var i = 0; i < isles.length; i++) { if (isles[i].w.you) continue; isles[i].ore = ores[i] || 0; }
        paintBeacons(); bgeo.attributes.color.needsUpdate = true; bgeo.attributes.sz.needsUpdate = true;
      },
      select: function (i) {
        selected = i == null ? -1 : i;
        sel.visible = beam.visible = selected >= 0;
        if (selected >= 0) orbit.to(isles[selected].p, 34, 0.35);
        else orbit.to(new T.Vector3(), 230, 0.48);
      },
      ride: function (i) {
        if (you < 0 || i == null) return;
        var a = isles[you].p.clone(), b = isles[i].p.clone(), wy = wyrm({ span: 5.2 }), t0 = -1;
        wy.obj.scale.setScalar(0.9); st.scene.add(wy.obj);
        var mid = a.clone().lerp(b, 0.5).add(new T.Vector3(0, 30, 0));
        orbit.to(mid, 120, 0.5);
        ride = function (t) {
          if (t0 < 0) t0 = t;
          var k = Math.min(1, (t - t0) / 5), e = k * k * (3 - 2 * k);
          var p = new T.Vector3().copy(a).multiplyScalar((1 - e) * (1 - e)).add(mid.clone().multiplyScalar(2 * e * (1 - e))).add(b.clone().multiplyScalar(e * e));
          var e2 = Math.min(1, e + 0.01), p2 = new T.Vector3().copy(a).multiplyScalar((1 - e2) * (1 - e2)).add(mid.clone().multiplyScalar(2 * e2 * (1 - e2))).add(b.clone().multiplyScalar(e2 * e2));
          wy.obj.position.copy(p); wy.obj.lookAt(p2); wy.update(t);
          if (k >= 1) { burst(b, { color: 0xe8c872, count: 200, speed: 8 }); st.scene.remove(wy.obj); ride = null; orbit.to(b, 48, 0.4); }
        };
      },
      dispose: function () { unhover(); orbit.dispose(); st.dispose(); }
    };
  };
  function stripTo(g) {
    var keep = { position: 1, normal: 1, color: 1, aGlow: 1 };
    Object.keys(g.attributes).forEach(function (k) { if (!keep[k]) g.deleteAttribute(k); });
    if (!g.attributes.aGlow) g.setAttribute('aGlow', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    if (!g.attributes.color) { var c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new T.BufferAttribute(c, 3)); }
    if (g.index) g = g.toNonIndexed();
    return g;
  }

  /* ---- The Skirmish: two warbands across the gulf ---- */
  /* Names over units: small DOM tags projected each frame onto an overlay above the canvas. */
  function unitTags(st, canvas) {
    var box = canvas.parentElement ? document.createElement('div') : null;
    if (box) { box.className = 'unit-tags'; box.setAttribute('aria-hidden', 'true'); canvas.parentElement.appendChild(box); }
    var tags = {}, v = new T.Vector3(), lit = {};
    function frame() {
      if (!box) return;
      var w = canvas.clientWidth, h = canvas.clientHeight, cam = st.camera;
      cam.updateMatrixWorld();
      var list = [];
      for (var id in tags) {
        var g = tags[id];
        g.holder.getWorldPosition(v); v.y += g.y;
        var d = v.distanceTo(cam.position);
        v.project(cam);
        var off = v.z > 1 || Math.abs(v.x) > 0.88 || Math.abs(v.y) > 0.9 || !g.holder.visible;
        g.el.classList.toggle('on', !!lit[id]);
        if (off) { g.el.style.opacity = '0'; continue; }
        if (!g.w) g.w = g.el.offsetWidth || 90;
        list.push({ g: g, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, d: d, on: !!lit[id] });
      }
      // names that would stack wait their turn: the lit ones first, then the nearest (as on the Hold)
      list.sort(function (a, b) { return (b.on - a.on) || (a.d - b.d); });
      var placed = [];
      for (var k = 0; k < list.length; k++) {
        var it = list[k], r = { l: it.x - it.g.w / 2 - 3, r: it.x + it.g.w / 2 + 3, t: it.y - 24, b: it.y };
        var clash = !it.on && placed.some(function (q) { return r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t; });
        it.g.el.style.opacity = clash ? '0' : String(clamp((200 - it.d) / 80, 0.35, 1));
        if (clash) continue;
        placed.push(r);
        it.g.el.style.transform = 'translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px) translate(-50%,-100%)';
      }
    }
    return {
      frame: frame,
      add: function (id, holder, label, cls) {
        if (!box || !label) return;
        holder.updateMatrixWorld(true);
        var bb = new T.Box3().setFromObject(holder);
        var el = document.createElement('span'); el.className = 'unit-tag' + (cls ? ' ' + cls : ''); el.textContent = label;
        box.appendChild(el);
        tags[id] = { el: el, holder: holder, y: Math.max(1.2, bb.max.y - holder.position.y) + 0.5 };
      },
      remove: function (id) { if (tags[id]) { tags[id].el.remove(); delete tags[id]; } },
      light: function (ids) { lit = {}; (ids || []).forEach(function (i) { if (i) lit[i] = 1; }); },
      dispose: function () { if (box) box.remove(); }
    };
  }

  K.skirmish = function (canvas, o) {
    o = o || {};
    var md = mood('skirmish');
    var st = Stage(canvas, { mood: md, fov: 38 });
    sky(st, md); cloudSea(st, md); lights(st, md, { span: 46 });
    cloudscape(st, { seed: 41, mid: 14, midR0: 90, midR1: 400, midY: 0, midYR: 26, extra: [{ x: 0, y: -30, z: -30, w: 80, h: 40, v: 3, a: 0.95, s: 0.15 }, { x: -6, y: -34, z: 34, w: 70, h: 34, v: 7, a: 0.95, s: 0.2 }] });
    motes(st, { count: 320, box: 110, h: 40, y: -6, color: 0xff9a5a, size: 5, i: 2.6 });
    var burst = Bursts(st);
    // on a wide screen the two isles stand closer, so neither hides under the side panels
    var sep = canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.9 ? 26 : 21;
    var sides = { ours: { x: -sep, isle: null }, theirs: { x: sep, isle: null } };
    var tags = unitTags(st, canvas);
    var units = {}, roots = [], abroadN = { ours: 0, theirs: 0 };
    ['ours', 'theirs'].forEach(function (side, si) {
      var I = isle({ radius: 12, seed: si ? 44 : 17, lake: true, lakeAngle: si ? 0 : Math.PI, lakeSize: 0.34, rings: 24, segs: 72, under: 13, crystalColor: si ? 0xff7a8a : K.C.verdigris });
      dressIsle(I, { trees: 26, seed: si ? 8 : 9, avoid: [{ x: 0, z: 0, r: 8 }], canopies: si ? [4, 4, 2, 0] : [0, 1, 3, 0] });
      I.group.position.x = sides[side].x;
      st.scene.add(I.group); st.add(I.update);
      seaShadow(st, sides[side].x, 0, 34);
      sides[side].isle = I;
      // say whose isle is whose; an empty far side says where to find a foe
      var empty = si && o.hasFoe === false;
      var plate = nameplate(si ? (empty ? 'No foe chosen' : 'Their hold') : 'Your hold', si ? (empty ? 'Pick one in the Sky Atlas' : o.theirsName) : o.oursName, si ? 0xff9a7a : 0xe8c872, { size: 15.5 });
      // the far sign leans toward the gulf, so the foe's panel on the right does not hide it
      plate.position.set(sides[side].x + (si ? -7 : 0), 6.4, 0); if (empty) plate.material.opacity = 0.8; st.scene.add(plate);
      st.add((function (pl, ph) { return function (t) { pl.position.y = 6.4 + Math.sin(t * 0.8 + ph) * 0.25; }; })(plate, si * 2));
      var counts = { starfall: 0, skies: 0, wilds: 0, deeps: 0 };
      (o[side] || []).forEach(function (u) {
        var type = +u.type, b = beast(type), realm = u.realm || K.REALM[type];
        var holder = new T.Group(); holder.add(b.obj); holder.userData.pick = u.id;
        b.obj.scale.multiplyScalar((SCALE[type] || 0.6) * 0.9);
        var n = counts[realm]++, face = si ? -1 : 1, base = sides[side].x;
        var spot;
        if (realm === 'wilds') { spot = I.surface(4 * face - (n % 3) * 2.2 * face, -5 + n * 3.4); spot.x += base; }
        else if (realm === 'deeps') { spot = new T.Vector3(base + I.lake.x + (n - 1) * 1.6, -0.9, I.lake.z + (n % 2) * 1.6); }
        // the high realms hang low enough to stay in the open sky between the panels: the fight is there
        else if (realm === 'skies') { spot = new T.Vector3(base + 4 * face, 7.5 + (n % 2) * 1.4, -6 + n * 4.5); }
        else { spot = new T.Vector3(base + 2 * face, 12 + (n % 2) * 1.6, -7 + n * 5); }
        // abroad, the warband hangs in the air at the near edge of the other isle
        // only the warband rides (hallows stay rooted); each rider gets its own place in the air
        var roams = u.roams !== false, an = roams ? abroadN[side]++ : 0;
        var far = sides[si ? 'ours' : 'theirs'].x - 15 * face;
        var away = new T.Vector3(far - (an % 3) * 2.4 * face, realm === 'skies' || realm === 'starfall' ? spot.y : 4 + (an % 3) * 1.8, 3 - an * 3.2);
        var isAway = roams && !!o[side + 'Abroad'];
        holder.position.copy(isAway ? away : spot);
        holder.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
        st.scene.add(holder); roots.push(holder);
        units[u.id] = { b: b, holder: holder, base: (isAway ? away : spot).clone(), home: spot.clone(), away: away, goal: null, aloft: isAway, bobK: isAway || (realm !== 'wilds' && realm !== 'deeps') ? 1 : 0, roams: roams, realm: realm, side: side, ph: Math.random() * 10, hit: 0 };
        tags.add(u.id, holder, u.label, si ? 'theirs' : '');
      });
    });
    var pick = picker(st, function () { return roots; });
    var hoverRing = runeDisc(2.2, '#f6e7bf', 0.55, 1.6); hoverRing.visible = false; st.scene.add(hoverRing);
    var hovered = null;
    var unhover = hoverable(st, pick, function (id) { hovered = id; if (o.onHover) o.onHover(id); });
    st.add(function (t) {
      var hu = hovered && units[hovered];
      tags.light([hovered, marks.a && marks.a.id, marks.t && marks.t.id, marks.g && marks.g.id]);
      hoverRing.visible = !!hu;
      if (hu) { var hp = hu.holder.position; hoverRing.position.set(hp.x, hp.y + 0.1, hp.z); hoverRing.rotation.z = -t * 0.8; hoverRing.material.opacity = 0.45 + 0.15 * Math.sin(t * 4); }
    });
    // a tall phone screen cannot hold two isles side by side: look down the gulf instead, ours near and theirs beyond
    var tall = function () { return canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.9; };
    // wide screens keep their sky between the war bar above and the strike below: look a little higher, so the
    // beasts of Starfall and the Skies hang in that open band instead of behind the panels
    var orbit = Orbit(st, { dist: tall() ? 118 : 84, el: tall() ? 0.34 : 0.2, az: tall() ? -1.2 : 0, target: new T.Vector3(0, tall() ? 3 : 7, 0), min: 25, max: 170, onTap: function (ndc) { var id = pick(ndc); if (o.onPick) o.onPick(id); } });
    // a heavy blow shakes the eye a little (never under reduced motion)
    var quake = 0, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    st.add(function (t, dt) {
      if (quake <= 0) return;
      var a = quake * 0.55;
      st.camera.position.x += (Math.random() - 0.5) * a; st.camera.position.y += (Math.random() - 0.5) * a;
      quake = Math.max(0, quake - dt * 2.4);
    });
    var marks = {};
    function mark(key, color) {
      var d = runeDisc(2.4, color, 0.95, 2.4); d.visible = false; st.scene.add(d);
      var bm = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 24, 16, 1, true), G(new T.Color(color).getHex(), { t: true, o: 0.14, add: true, ds: true, i: 2 })); bm.visible = false; st.scene.add(bm);
      marks[key] = { d: d, bm: bm, id: null };
    }
    mark('a', '#e8c872'); mark('t', '#ff7a4d'); mark('g', '#b49bff');
    var bolts = [], shocks = [];
    // words that rise from a beast when a blow lands: "−2", "Turned aside", "Falls!"
    var popBox = canvas.parentElement ? document.createElement('div') : null, pops = [], pv = new T.Vector3();
    if (popBox) { popBox.className = 'sk-pops'; popBox.setAttribute('aria-hidden', 'true'); canvas.parentElement.appendChild(popBox); }
    function pop(id, text, kind) {
      var u = units[id]; if (!popBox || !u) return;
      var el = document.createElement('span'); el.className = 'sk-pop ' + (kind || 'hit'); el.textContent = text;
      popBox.appendChild(el);
      // several words on one beast stack instead of overlapping
      var stack = pops.filter(function (q) { return q.id === id && q.k < 0.5; }).length;
      pops.push({ el: el, id: id, k: 0, dx: (Math.random() - 0.5) * 30, stack: stack, last: null });
    }
    function framePops(dt) {
      if (!popBox || !pops.length) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      // words never rise under the panel across the top of the sky (the screen says where its edge is)
      var top = o.clearTop ? o.clearTop() : 0;
      for (var i = pops.length - 1; i >= 0; i--) {
        var q = pops[i]; q.k += dt / 1.9;
        if (q.k >= 1) { q.el.remove(); pops.splice(i, 1); continue; }
        var u = units[q.id];
        if (u) { pv.copy(u.holder.position); pv.y += u.realm === 'wilds' ? 3.2 : 2.2; pv.project(st.camera); q.last = { x: (pv.x + 1) / 2 * w, y: (1 - pv.y) / 2 * h, off: pv.z > 1 }; }
        if (!q.last || q.last.off) { q.el.style.opacity = '0'; continue; }
        var rise = 18 + q.k * 46 + q.stack * 26, a = q.k < 0.12 ? q.k / 0.12 : q.k > 0.7 ? (1 - q.k) / 0.3 : 1, sc = q.k < 0.12 ? 0.6 + q.k / 0.12 * 0.55 : 1.15 - Math.min(0.15, (q.k - 0.12));
        q.el.style.opacity = a.toFixed(2);
        var y = Math.max(q.last.y - rise, top + 36 + q.stack * 28);
        q.el.style.transform = 'translate(' + (q.last.x + q.dx * q.k).toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%) scale(' + sc.toFixed(3) + ')';
      }
    }
    // an impact: a ring of force that races outward and a flash that swells and dies
    var ringMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      uniforms: { uK: { value: 0 }, color: { value: new T.Color(0xffc04a) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uK; uniform vec3 color; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float r = 0.15 + uK * 0.85; float x = (d - r) / (0.05 + 0.1 * uK); float band = exp(-x * x); float a = clamp(band * (1.0 - uK) * 1.6, 0.0, 2.0); gl_FragColor = vec4(color * a * 2.0, min(a, 1.0)); }'
    });
    function shock(p, color) {
      var m = ringMat.clone(); m.uniforms.color.value = new T.Color(color);
      var ring = new T.Mesh(new T.PlaneGeometry(1, 1), m); ring.position.copy(p); ring.frustumCulled = false; st.scene.add(ring);
      var fl = glowSprite(color, 2, 1, 3); fl.position.copy(p); st.scene.add(fl);
      shocks.push({ ring: ring, fl: fl, k: 0 });
    }
    st.add(function (t, dt) {
      framePops(dt);
      for (var si = shocks.length - 1; si >= 0; si--) {
        var sh = shocks[si]; sh.k += dt / 0.7;
        if (sh.k >= 1) { st.scene.remove(sh.ring); st.scene.remove(sh.fl); sh.ring.geometry.dispose(); sh.ring.material.dispose(); shocks.splice(si, 1); continue; }
        sh.ring.quaternion.copy(st.camera.quaternion); sh.ring.scale.setScalar(16); sh.ring.material.uniforms.uK.value = 1 - Math.pow(1 - sh.k, 2.2);
        var fk = Math.min(1, sh.k * 3.5); sh.fl.scale.setScalar(2 + fk * 9); sh.fl.material.opacity = (1 - sh.k) * (1 - sh.k);
      }
      for (var id in units) {
        var u = units[id];
        u.b.update(t);
        if (u.dying != null) {
          u.dying += dt;
          u.holder.rotation.z += dt * 3; u.holder.position.y -= dt * 6; u.holder.scale.multiplyScalar(0.97);
          if (u.dying > 1.6) { st.scene.remove(u.holder); roots.splice(roots.indexOf(u.holder), 1); delete units[id]; }
          continue;
        }
        // riding out or home: glide there over a few seconds, rising first, then settling
        if (u.goal) {
          var gk = 1 - Math.exp(-dt * 0.7);
          u.base.x += (u.goal.x - u.base.x) * gk; u.base.z += (u.goal.z - u.base.z) * gk;
          var lift = Math.min(1, Math.abs(u.goal.x - u.base.x) / 12) * 9;
          u.base.y += (u.goal.y + lift - u.base.y) * Math.min(1, gk * 2.2);
          if (u.base.distanceTo(u.goal) < 0.05) { u.base.copy(u.goal); u.goal = null; }
        }
        // land and water beasts bob only in the air, and ease into it rather than jump
        var wantBob = (u.realm === 'wilds' || u.realm === 'deeps') && !u.aloft ? 0 : 1;
        u.bobK += (wantBob - u.bobK) * Math.min(1, dt * 1.5);
        var bob = Math.sin(t * 0.8 + u.ph) * 0.8 * u.bobK;
        var shake = u.hit > 0 ? (Math.random() - 0.5) * u.hit : 0;
        u.hit = Math.max(0, u.hit - dt * 1.5);
        u.holder.position.set(u.base.x + shake, u.base.y + bob, u.base.z + shake);
      }
      for (var k in marks) {
        var m = marks[k];
        if (m.id && units[m.id]) {
          var p = units[m.id].holder.position;
          m.d.visible = m.bm.visible = true;
          m.d.position.set(p.x, p.y + 0.1, p.z); m.d.rotation.z = t * (k === 'a' ? 0.6 : -0.6);
          m.bm.position.set(p.x, p.y + 12, p.z);
        } else { m.d.visible = m.bm.visible = false; }
      }
      for (var i = bolts.length - 1; i >= 0; i--) {
        var b = bolts[i]; b.k += dt / b.dur;
        var e = Math.min(1, b.k);
        var p0 = b.a, p1 = b.c, p2 = b.b;
        var q = new T.Vector3().copy(p0).multiplyScalar((1 - e) * (1 - e)).add(p1.clone().multiplyScalar(2 * e * (1 - e))).add(p2.clone().multiplyScalar(e * e));
        b.s.position.copy(q); b.core.position.copy(q);
        for (var j = b.trail.length - 1; j > 0; j--) b.trail[j].copy(b.trail[j - 1]);
        b.trail[0].copy(q);
        var arr = b.tg.attributes.position.array;
        for (j = 0; j < b.trail.length; j++) { arr[j * 3] = b.trail[j].x; arr[j * 3 + 1] = b.trail[j].y; arr[j * 3 + 2] = b.trail[j].z; }
        b.tg.attributes.position.needsUpdate = true;
        if (b.k >= 1) {
          st.scene.remove(b.s); st.scene.remove(b.core); st.scene.remove(b.tp);
          if (b.miss) burst(p2, { color: 0xbfd8ff, count: 30, speed: 3 });
          else { burst(p2, { color: b.color, count: 160, speed: 9 }); burst(p2, { color: 0xffffff, count: 40, speed: 4, life: 0.6 }); shock(p2, b.color); if (units[b.to]) units[b.to].hit = 1.2; }
          bolts.splice(i, 1);
          if (b.done) b.done();
        }
      }
    });
    function centerOf(id) { var u = units[id]; if (!u) return null; var v = u.holder.position.clone(); v.y += u.realm === 'wilds' ? 1.6 : 0.6; return v; }
    st.add(tags.frame); // after the bob and the camera have moved
    var ctl = {
      where: function (id) { return units[id] ? units[id].holder.position.toArray() : null; },
      census: function () { return { units: Object.keys(units), roots: roots.length }; },
      mark: function (key, id) { if (marks[key]) marks[key].id = id; },
      /** Send a side's warband over the other isle, or bring it home; it flies there. */
      abroad: function (side, on) {
        for (var id in units) {
          var u = units[id];
          if (u.side !== side || !u.roams || u.dying != null || !!u.aloft === !!on) continue;
          u.aloft = !!on;
          // with reduced motion the warband is simply there, not flown
          if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { u.base.copy(on ? u.away : u.home); u.goal = null; u.bobK = on || (u.realm !== 'wilds' && u.realm !== 'deeps') ? 1 : 0; }
          else u.goal = (on ? u.away : u.home).clone();
        }
      },
      strike: function (from, to, opt) {
        opt = opt || {};
        var a = centerOf(from), b = centerOf(to); if (!a || !b) { if (opt.done) opt.done(); return; }
        if (opt.miss) b = b.clone().add(new T.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6));
        var c = a.clone().lerp(b, 0.5).add(new T.Vector3(0, opt.guided ? 12 : 4, (Math.random() - 0.5) * 8));
        var color = opt.color || 0xffc04a;
        var s = glowSprite(color, 3.6, 1, 2.6), core = new T.Mesh(new T.SphereGeometry(0.3, 10, 8), G(0xffffff, { i: 4 }));
        var tg = new T.BufferGeometry(), N = 28, trail = [];
        for (var i = 0; i < N; i++) trail.push(a.clone());
        tg.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3));
        var tp = new T.Points(tg, new T.PointsMaterial({ map: softDot(), color: new T.Color(color).multiplyScalar(2.4), size: 1.1, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        tp.frustumCulled = false;
        st.scene.add(s); st.scene.add(core); st.scene.add(tp);
        burst(a, { color: color, count: 40, speed: 3 });
        bolts.push({ s: s, core: core, tp: tp, tg: tg, trail: trail, a: a, b: b, c: c, k: 0, dur: opt.dur || 0.9, color: color, miss: opt.miss, to: to, done: opt.done });
      },
      fell: function (id) { if (units[id] && units[id].dying == null) { units[id].dying = 0; tags.remove(id); burst(centerOf(id), { color: 0xff5a3a, count: 220, speed: 10, life: 2 }); } },
      /** Words over a beast: kind is hit, miss, guard, back, fell or heal. */
      pop: function (id, text, kind) { pop(id, text, kind); },
      /** Shake a beast as a blow lands on it. */
      jolt: function (id, k) { if (units[id]) units[id].hit = k || 1.2; },
      /** Shake the eye: 0.5 for a heavy blow, 1 for a fall. */
      shake: function (k) { if (!still) quake = Math.max(quake, k || 0.5); },
      has: function (id) { return !!units[id] && units[id].dying == null; },
      view: function (which) {
        if (which === 'ours') orbit.to(new T.Vector3(-sep, 8, 0), 50, 0.25, -0.6);
        else if (which === 'theirs') orbit.to(new T.Vector3(sep, 8, 0), 50, 0.25, 0.6);
        else if (tall()) orbit.to(new T.Vector3(0, 3, 0), 118, 0.34, -1.2);
        else orbit.to(new T.Vector3(0, 7, 0), 84, 0.2, 0);
      },
      dispose: function () { unhover(); orbit.dispose(); tags.dispose(); if (popBox) popBox.remove(); st.dispose(); }
    };
    return ctl;
  };

  /* ---- The Leyweave: mana river from wellspring to hold ---- */
  K.leyweave = function (canvas, o) {
    o = o || {};
    var md = mood('leyweave');
    var st = Stage(canvas, { mood: md, fov: 38 });
    sky(st, md); cloudSea(st, md, { near: 160, far: 1100 }); lights(st, md, { span: 60 });
    cloudscape(st, { seed: 51, mid: 12, midR0: 110, midR1: 420, midY: 2, midYR: 24 });
    shootingStars(st, { seed: 51, every: 6 });
    var nodes = [
      { x: -42, y: 6, kind: 'well', c: 0xe8c872 },
      { x: -14, y: 2, kind: 'shrine', c: 0x5fd3b5 },
      { x: 14, y: 4, kind: 'shrine', c: 0x5fd3b5 },
      { x: 42, y: 0, kind: 'hold', c: 0xc9a0ff }
    ];
    nodes.forEach(function (n, i) {
      var I = isle({ radius: n.kind === 'well' ? 8 : 5.5, seed: 70 + i, rings: 16, segs: 52, under: 11, hills: 1 });
      dressIsle(I, { trees: n.kind === 'hold' ? 14 : 6, rocks: 4, glowcaps: 6, seed: 80 + i, avoid: [{ x: 0, z: 0, r: 3.5 }] });
      I.group.position.set(n.x, n.y, 0); st.scene.add(I.group);
      seaShadow(st, n.x, 0, n.kind === 'well' ? 24 : 17);
      var top = n.kind === 'well' ? hallow(21, {}) : n.kind === 'hold' ? hallow(15, { scale: 0.9 }) : hallow(16, {});
      top.obj.position.set(n.x, n.y + I.heightAt(0, 0), 0); st.scene.add(top.obj); st.add(top.update);
      n.top = new T.Vector3(n.x, n.y + 4, 0);
    });
    var flows = [];
    for (var i = 0; i < nodes.length - 1; i++) {
      var a = nodes[i].top, b = nodes[i + 1].top, c = a.clone().lerp(b, 0.5).add(new T.Vector3(0, 9, 0));
      var curve = new T.QuadraticBezierCurve3(a, c, b);
      var tmat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { time: U.uTime, c1: { value: new T.Color(i === 0 ? 0xe8c872 : 0x5fd3b5) }, c2: { value: new T.Color(0x9ff4ff) }, rate: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec2 vUv; uniform float time; uniform vec3 c1; uniform vec3 c2; uniform float rate; void main(){ float pulse = pow(0.5 + 0.5 * sin(vUv.x * 40.0 - time * 6.0 * rate), 4.0); float core = pow(max(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0), 2.0); vec3 col = mix(c1, c2, pulse * 0.5) * (0.6 + pulse * 1.4) * 1.8; float a = core * (0.25 + pulse * 0.5); gl_FragColor = vec4(col * a, a); }'
      });
      var tube = new T.Mesh(new T.TubeGeometry(curve, 64, 0.22, 8, false), tmat);
      st.scene.add(tube);
      var N = 70, pos = new Float32Array(N * 3), g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      var pts = new T.Points(g, new T.PointsMaterial({ map: softDot(), color: new T.Color(i === 0 ? 0xe8c872 : 0x7affe0).multiplyScalar(2.4), size: 1.1, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      pts.frustumCulled = false;
      st.scene.add(pts);
      flows.push({ curve: curve, g: g, pos: pos, n: N, speed: 0.12, mat: tmat });
    }
    motes(st, { count: 300, box: 130, h: 44, y: -10, color: 0x9fe8ff });
    var orbit = Orbit(st, { dist: 96, el: 0.17, az: 0, target: new T.Vector3(0, 6, 0), min: 40, max: 200, auto: 0 });
    var rate = 1, burst = Bursts(st);
    st.add(function (t, dt) {
      for (var f = 0; f < flows.length; f++) {
        var fl = flows[f];
        fl.mat.uniforms.rate.value = rate;
        for (var i = 0; i < fl.n; i++) {
          var k = ((i / fl.n) + t * fl.speed * rate) % 1;
          var p = fl.curve.getPoint(k);
          fl.pos[i * 3] = p.x + Math.sin(t * 3 + i) * 0.25; fl.pos[i * 3 + 1] = p.y + Math.cos(t * 2 + i) * 0.25; fl.pos[i * 3 + 2] = p.z;
        }
        fl.g.attributes.position.needsUpdate = true;
      }
    });
    return {
      setRate: function (r) { rate = clamp(r, 0.05, 4); },
      tithe: function () { burst(nodes[nodes.length - 1].top.clone(), { color: 0xe8c872, count: 200, speed: 8, up: true, grav: 2 }); burst(nodes[0].top.clone(), { color: 0xe8c872, count: 260, speed: 10, ring: 2, grav: 0 }); },
      dispose: function () { orbit.dispose(); st.dispose(); }
    };
  };

  /* ---- A small living portrait (a guide, a card): one beast in its own little sky ---- */
  K.portrait = function (canvas, o) {
    o = o || {};
    var size = o.size || 96;
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    var releaseHooks = holdTextureHooks(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    var scene = new T.Scene();
    var cam = new T.PerspectiveCamera(32, 1, 0.1, 100);
    cam.position.set(0, 0.6 + (o.lift || 0) * (o.dist || 6.2) * 0.3, o.dist || 6.2); cam.lookAt(0, 0.35, -(o.lookZ || 0));
    scene.add(new T.HemisphereLight(0xc9b8ff, 0x1a1030, 1.6));
    var key = new T.DirectionalLight(0xffe7c4, 2.4); key.position.set(2, 3, 4); scene.add(key);
    var rim = new T.DirectionalLight(0x9fd8ff, 2.0); rim.position.set(-3, 1, -3); scene.add(rim);
    var b = (o.type || 6) === 6 && o.tint != null ? BESTIARY.ysolde() : beast(o.type || 6);
    if (b.ysolde) { cam.position.set(0, 0.45, 4.6); cam.lookAt(0, 0.2, 0); }
    b.obj.scale.setScalar(o.scale || 1.05);
    if (o.tint != null && !b.ysolde) b.obj.traverse(function (m) {
      if (m.material && m.material.color && !m.isSprite) { var mat = m.material.clone(); mat.color.lerp(new T.Color(o.tint), 0.55); mat.opacity = 1; mat.transparent = false; m.material = mat; }
    });
    scene.add(b.obj);
    var halo = glowSprite(0xe8c872, 5, 0.35, 1); halo.position.set(0, 0.4, -1); scene.add(halo);
    var raf = 0, t0 = performance.now();
    (function loop() {
      raf = requestAnimationFrame(loop);
      var t = (performance.now() - t0) / 1000;
      b.update(t * 0.6);
      b.obj.rotation.y = (o.turn || 0) + Math.sin(t * 0.5) * 0.35;
      halo.material.opacity = 0.25 + 0.12 * Math.sin(t * 1.7);
      renderer.render(scene, cam);
    })();
    return { dispose: function () { cancelAnimationFrame(raf); releaseHooks(); renderer.dispose(); } };
  };

  /* -------------------------------------------------- mount helper for pages */
  K.mount = function (kind, canvas, opts, cb) {
    var tries = 0;
    (function go() {
      if (!canvas || !canvas.isConnected || !(canvas.parentElement && canvas.parentElement.clientWidth)) {
        if (tries++ < 120) return setTimeout(go, 50);
      }
      try { var c = K[kind](canvas, opts); if (cb) cb(c); }
      catch (e) { console.error('WyrmKit mount failed', kind, e); }
    })();
  };

export default K;
