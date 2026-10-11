/* Results: each check with its pillar, severity and evidence; a JSON record and a readable report. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEVERITY = { S0: 'blocker: crash, black screen, lost rite', S1: 'broken: a feature does not work', S2: 'unclear: the warden is misled or stuck', S3: 'polish' };

export class Failure extends Error { constructor(message, details) { super(message); this.details = details; } }
export const expect = {
  ok: (v, msg, details) => { if (!v) throw new Failure(msg, details); },
  eq: (a, b, msg, details) => { if (a !== b) throw new Failure(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`, details); },
  gte: (a, b, msg, details) => { if (!(a >= b)) throw new Failure(`${msg}: expected ≥ ${b}, got ${a}`, details); },
  lte: (a, b, msg, details) => { if (!(a <= b)) throw new Failure(`${msg}: expected ≤ ${b}, got ${a}`, details); },
  includes: (hay, needle, msg) => { if (!String(hay).includes(needle)) throw new Failure(`${msg}: ${JSON.stringify(needle)} not in ${JSON.stringify(String(hay).slice(0, 300))}`); },
  noErrors: (errs, msg = 'console') => { if (errs.length) throw new Failure(`${msg}: ${errs.length} error(s)`, errs.slice(0, 8).map((e) => e.text.slice(0, 400))); },
};

export class Report {
  constructor(outDir) { this.outDir = outDir; mkdirSync(join(outDir, 'evidence'), { recursive: true }); this.results = []; this.started = Date.now(); this.notes = []; }
  suite(name, pillar) { return new Suite(this, name, pillar); }
  add(r) { this.results.push(r); const tag = r.status === 'pass' ? '  ok ' : r.status === 'fail' ? ' FAIL' : r.status === 'warn' ? ' warn' : ' skip'; console.log(`${tag}  ${r.suite} › ${r.name}${r.status !== 'pass' ? '  — ' + r.message : ''}  (${r.ms}ms)`); if (r.details && r.status !== 'pass') for (const d of [].concat(r.details).slice(0, 6)) console.log('        ' + String(d).slice(0, 300)); }
  note(text) { this.notes.push(text); console.log('  note  ' + text); }
  evidencePath(name) { return join(this.outDir, 'evidence', name.replace(/[^a-z0-9._-]+/gi, '_')); }
  summary() {
    const by = (s) => this.results.filter((r) => r.status === s).length;
    const blocking = this.results.filter((r) => r.status === 'fail' && (r.severity === 'S0' || r.severity === 'S1')).length;
    return { total: this.results.length, pass: by('pass'), fail: by('fail'), warn: by('warn'), skip: by('skip'), blocking, ms: Date.now() - this.started };
  }
  write(meta = {}) {
    const s = this.summary();
    writeFileSync(join(this.outDir, 'report.json'), JSON.stringify({ meta, summary: s, notes: this.notes, results: this.results }, null, 1));
    const lines = [`# Wyrmhold QA report`, '', `${new Date().toISOString()} · ${meta.app || ''} · ${meta.chrome || ''}`, '',
      `| total | pass | fail | warn | skip | blocking |`, `|---|---|---|---|---|---|`, `| ${s.total} | ${s.pass} | ${s.fail} | ${s.warn} | ${s.skip} | ${s.blocking} |`, ''];
    const pillars = [...new Set(this.results.map((r) => r.pillar))];
    for (const p of pillars) {
      lines.push(`## ${p}`, '');
      for (const r of this.results.filter((r) => r.pillar === p)) {
        const mark = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'warn' ? '⚠️' : '⏭️';
        lines.push(`- ${mark} **${r.suite} › ${r.name}** ${r.status !== 'pass' ? `(${r.severity}) ${r.message || ''}` : ''}`);
        if (r.details && r.status !== 'pass') for (const d of [].concat(r.details).slice(0, 8)) lines.push(`  - ${String(d).slice(0, 400).replace(/\n/g, ' ')}`);
        if (r.evidence?.length) lines.push(`  - evidence: ${r.evidence.map((e) => e.replace(this.outDir + '/', '')).join(', ')}`);
      }
      lines.push('');
    }
    if (this.notes.length) { lines.push('## Notes', '', ...this.notes.map((n) => `- ${n}`), ''); }
    writeFileSync(join(this.outDir, 'report.md'), lines.join('\n'));
    return s;
  }
}

export class Suite {
  constructor(report, name, pillar) { this.report = report; this.name = name; this.pillar = pillar; }
  /** Run one check. `severity` says what a failure means (S0–S3). The check gets a context `c` with
   * c.warn(text) for findings that should not fail it and c.evidence(path) to attach a file. */
  async test(name, severity, fn) {
    const t0 = Date.now(); const warns = [], evidence = [];
    const c = { warn: (t, d) => warns.push(d ? `${t} ${JSON.stringify(d).slice(0, 300)}` : t), evidence: (p) => evidence.push(p), evidencePath: (n) => { const p = this.report.evidencePath(`${this.name}-${name}-${n}`); evidence.push(p); return p; } };
    let r;
    try { await fn(c); r = { status: warns.length ? 'warn' : 'pass', message: warns.length ? `${warns.length} finding(s)` : '', details: warns }; }
    catch (e) { r = { status: e instanceof Skip ? 'skip' : 'fail', message: e.message, details: [...(e.details ? [].concat(e.details) : []), ...warns], stack: e.stack?.split('\n').slice(1, 3).join(' | ') }; }
    this.report.add({ suite: this.name, pillar: this.pillar, name, severity, ms: Date.now() - t0, evidence, ...r });
    return r.status;
  }
}
export class Skip extends Error {}
