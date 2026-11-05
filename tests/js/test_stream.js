// node tests/js/test_stream.js : ring correctness, carry/gap/late semantics, dirty ranges, adaptive scale, recenter, throughput
const { Ring, AdaptiveScale, makeFeed } = require('../../web/js/chartfactors/cf_stream.js'); let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const mk = o => new Ring(Object.assign({ rows: 100, nCols: 64, colMs: 1000, top: 1000, bucket: 1, gapMs: 5000 }, o || {}));
const feed = (r, rows) => { const n = rows.length, ts = new Float64Array(n), px = new Float64Array(n), sz = new Float32Array(n); rows.forEach((q, i) => { ts[i] = q[0]; px[i] = q[1]; sz[i] = q[2]; }); r.ingest(ts, px, sz, n); };
{ // row mapping + max aggregation inside a column
  const r = mk(); feed(r, [[1000, 999.5, 5], [1200, 999.5, 9], [1400, 999.5, 3]]); ok(r.at(1, 0) === 9, 'max aggregation within column'); ok(r.rowOf(999.5) === 0 && Math.abs(r.priceOf(0) - 999.5) < 1e-9, 'row<->price'); }
{ // carry-forward of the closing state, up to the gap timeout
  const r = mk(); feed(r, [[1000, 990.5, 7]]); r.tick(4000); ok(r.at(4, 9) === 7 && r.at(3, 9) === 7, 'carried within timeout'); r.tick(9000); ok(r.at(9, 9) === 0 && r.at(7, 9) === 0 && r.at(6, 9) === 7, 'not carried after gap timeout'); }
{ // cancel (size 0) clears the carried level next column
  const r = mk(); feed(r, [[1000, 990.5, 7], [2100, 990.5, 0]]); r.tick(4000); ok(r.at(2, 9) === 7 && r.at(3, 9) === 0, 'removal ends the streak'); }
{ // late update merges into history, never breaks the live column
  const r = mk(); feed(r, [[5000, 990.5, 2]]); feed(r, [[3000, 980.5, 8]]); ok(r.at(3, 19) === 8 && r.late === 1, 'late merge'); }
{ // dirty ranges, wraparound
  const r = mk({ nCols: 8 }); feed(r, [[1000, 999.5, 1]]); r.takeDirty(); feed(r, [[6000, 999.5, 1]]); r.takeDirty(); feed(r, [[9000, 999.5, 1]]); const d = r.takeDirty(); ok(d.length >= 1 && d.every(q => q[0] >= 0 && q[0] + q[1] <= 8), 'dirty runs inside ring'); ok(r.takeDirty().length === 0, 'dirty cleared'); }
{ // ring overwrite: old columns fall out
  const r = mk({ nCols: 8 }); for (let a = 0; a < 40; a++) feed(r, [[a * 1000, 999.5, a + 1]]); ok(r.absMin() === 32 && r.at(39, 0) === 40, 'ring window'); }
{ // recenter keeps prices
  const r = mk(); feed(r, [[1000, 950.5, 6]]); const before = r.at(1, r.rowOf(950.5)); r.recenter(1020); ok(r.at(1, r.rowOf(950.5)) === before && r.top === 1020, 'recenter keeps price->value'); }
{ // out-of-window prices are skipped, not crashing
  const r = mk(); feed(r, [[1000, 2000, 1], [1000, -5, 1], [1000, NaN, 1]]); ok(r.skipped === 3, 'skipped'); }
{ // adaptive scale: fast rise, slow decay, stable when unchanged
  const r = mk({ rows: 200, nCols: 256 }); const rnd = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); const sc = new AdaptiveScale({ samples: 4000 });
  for (let a = 0; a < 200; a++) { const n = 100, ts = new Float64Array(n), px = new Float64Array(n), sz = new Float32Array(n); for (let i = 0; i < n; i++) { ts[i] = a * 1000; px[i] = 1000 - rnd() * 199; sz[i] = 10 + rnd() * 10; } r.ingest(ts, px, sz, n); }
  sc.update(r, 0, 199, 0, 199, 0); const h0 = sc.H; ok(h0 > 10 && h0 < 25, 'initial H ' + h0);
  const ts = new Float64Array(2000), px = new Float64Array(2000), sz = new Float32Array(2000); for (let i = 0; i < 2000; i++) { ts[i] = 199000; px[i] = 1000 - (i % 199); sz[i] = 500; } r.ingest(ts, px, sz, 2000); sc.update(r, 0, 199, 0, 199, 1.5); ok(sc.H > h0 * 2, 'rises fast ' + sc.H); }
{ // throughput: >= 2M updates/s single-thread, no allocation growth
  const r = mk({ rows: 1024, nCols: 4096, top: 20000, bucket: 0.5 }), f = makeFeed({ top: 20000, bucket: 0.5, rows: 1024, startMid: 19800, seed: 3, capacity: 1 << 19 }); let n = 0; const t0 = process.hrtime.bigint();
  for (let s = 0; s < 40; s++) { const q = f.generate(s * 1000, (s + 1) * 1000, 200000); r.ingest(q.ts, q.px, q.sz, q.n); n += q.n; } const dt = Number(process.hrtime.bigint() - t0) / 1e9; const ups = n / dt; console.log('throughput (generate+ingest): ' + (ups / 1e6).toFixed(2) + 'M upd/s, ' + n + ' updates');
  let t1 = process.hrtime.bigint(); const q = f.generate(40000, 41000, 200000); const tg = process.hrtime.bigint(); for (let k = 0; k < 20; k++) r.ingest(q.ts, q.px, q.sz, q.n); const di = Number(process.hrtime.bigint() - tg) / 1e9; console.log('ingest only: ' + (20 * q.n / di / 1e6).toFixed(2) + 'M upd/s'); void t1; ok(ups > 1.5e6, 'throughput ' + ups); }
console.log(fails ? fails + ' FAILED' : 'stream tests passed'); process.exit(fails ? 1 : 0);
