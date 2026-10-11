/* Art & assets: every creature the sky can draw is built in a real WebGL context and checked the way
 * a build pipeline would check a model: finite geometry, a sane size, a bounded triangle count,
 * animation that stays finite over time, and shaders that compile without a word of complaint. */
import { expect } from '../lib/report.mjs';
import { openGame, ALLOW, sleep } from '../lib/game.mjs';
import { TYPES } from '../lib/world.mjs';

const BUDGET = { triangles: 90000, meshes: 160, maxExtent: 20, minExtent: 0.4 };

export default async function (t, ctx) {
  const page = await ctx.newPage({ width: 900, height: 700 });
  await page.goto(ctx.app.url + 'qa/blank.html');
  await page.eval(`window.K = (await import('/src/world/wyrmkit.js')).default; window.T = await import('/qa/three.mjs'); return !!window.K`);
  const ids = [...TYPES.map((x) => x.id), 'ysolde'];
  const measured = {};
  for (const id of ids) {
    await t.test(`type ${id} (${TYPES.find((x) => x.id === id)?.type || id}) builds a finite, sized, bounded body`, 'S0', async (c) => {
      const r = await page.eval(`
        const T = window.T, K = window.K; const B = (await import('/src/world/beasts.js')).BESTIARY;
        const b = ${id === 'ysolde' ? 'B.ysolde()' : `K.beast(${id})`};
        const stats = (label) => { let nan = 0, verts = 0, tris = 0, meshes = 0; b.obj.traverse((o) => { const pa = o.geometry && o.geometry.attributes && o.geometry.attributes.position; if (!pa) return; meshes++; verts += pa.count; const n = o.geometry.index ? o.geometry.index.count : pa.count; tris += o.isMesh ? n / 3 : 0; for (let i = 0; i < pa.array.length; i++) if (!Number.isFinite(pa.array[i])) nan++; }); b.obj.updateMatrixWorld(true); const box = new T.Box3().setFromObject(b.obj); const size = new T.Vector3(); box.getSize(size); return { label, nan, verts, tris: Math.round(tris), meshes, size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)), finiteBox: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite) }; };
        const at0 = stats('t=0');
        const over = [0.37, 2.5, 17, 100, 3600].map((tt) => { b.update(tt); return stats('t=' + tt); });
        return { at0, over, flying: !!b.flying };`);
      expect.eq(r.at0.nan, 0, 'NaN coordinates at rest');
      expect.ok(r.at0.finiteBox, 'bounding box is finite');
      const ext = Math.max(...r.at0.size);
      expect.ok(ext >= BUDGET.minExtent && ext <= BUDGET.maxExtent, `extent ${ext} outside [${BUDGET.minExtent}, ${BUDGET.maxExtent}] (size ${r.at0.size})`);
      expect.lte(r.at0.tris, BUDGET.triangles, 'triangle budget');
      expect.lte(r.at0.meshes, BUDGET.meshes, 'mesh (draw) budget');
      for (const s of r.over) { expect.eq(s.nan, 0, `NaN coordinates after update at ${s.label}`); expect.ok(s.finiteBox, `bounding box finite at ${s.label}`); }
      measured[id] = { tris: r.at0.tris, meshes: r.at0.meshes, size: r.at0.size };
      if (r.at0.tris > BUDGET.triangles * 0.6) c.warn(`heavy: ${r.at0.tris} triangles`);
    });
  }
  ctx.report.note('asset census: ' + Object.entries(measured).map(([k, v]) => `${k}:${v.tris}▲/${v.meshes}m`).join(' '));

  await t.test('every beast renders on the dais and its shaders compile silently', 'S0', async (c) => {
    page.console.length = 0; page.exceptions.length = 0;
    await page.eval(`document.body.innerHTML = '<div class="stage" style="width:640px;height:480px;position:relative"><canvas id="c" style="width:640px;height:480px"></canvas></div>'; window.circle = K.circle(document.getElementById('c'), { type: 1 }); return true`);
    await sleep(800);
    const draws = {};
    for (const id of TYPES.map((x) => x.id)) {
      const r = await page.eval(`window.circle.show(${id}); const st = window.__wyrmStage; st.renderFrame(); st.renderFrame(); const p = st.camera.position; return { finite: [p.x, p.y, p.z].every(Number.isFinite), tris: st.renderer.info.render.triangles, calls: st.renderer.info.render.calls }`);
      expect.ok(r.finite, `camera finite after showing type ${id}`);
      draws[id] = r;
    }
    await page.eval(`window.circle.summon(10); const st = window.__wyrmStage; st.renderFrame(); return true`);
    await sleep(300);
    const errs = page.errors([...ALLOW]);
    expect.noErrors(errs, 'rendering every type');
    const shader = page.console.filter((m) => /shader|program|THREE\./i.test(m.text) && m.level !== 'log' && !/KHR_parallel_shader_compile/.test(m.text));
    expect.eq(shader.length, 0, 'three.js warnings while compiling', shader.map((m) => m.level + ': ' + m.text.slice(0, 300)));
    ctx.report.note('dais draw census: ' + Object.entries(draws).map(([k, v]) => `${k}:${v.tris}▲/${v.calls}c`).join(' '));
  });

  await t.test('the sane() guard drops a broken part and keeps the beast', 'S1', async () => {
    const r = await page.eval(`const T = window.T; const b = K.beast(9); const bad = new T.Mesh(new T.BoxGeometry(1, 1, 1)); bad.geometry.attributes.position.array[4] = NaN; b.obj.add(bad); const before = b.obj.children.length; const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' ')); K.sane(b, 9); console.error = ce; return { before, after: b.obj.children.length, said: errs.join('|') }`);
    expect.eq(r.after, r.before - 1, 'the broken part is removed');
    expect.includes(r.said, 'beast 9', 'it is said in the console');
  });
  await page.close();
}
