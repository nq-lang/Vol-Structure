// pca_biplot.js - PCA / t-SNE regime model. Two tabs only (PCA, t-SNE); each shows the interactive 3D model on the
// left and its flat, upright 2D counterpart on the right, drawn from the same points so a point hovered in one pane
// is ringed in the other. Display parameters are locked: regime clouds spread x2.8, loading vectors x1.0, feature
// pulls always on, colouring by regime only. Data: regime_viz (points with pca / tsne2 / tsne3 + posterior), the
// regime static payload (regimes, loadings, arrow_scale, explained variance) and the live regime read.
class PcaBiplotPanel {
    constructor(container) {
        this.container = container;
        this.staticData = null; this.liveData = null; this.viz = null;
        this.trail = [];            // live PCA trail [pc1,pc2,pc3]
        this.liveViz = [];          // live t-SNE entries {tsne2, tsne3, posterior}
        this.mode = 'pca';
        this.bubbleSpread = 2.8;    // locked
        this.vectorSpread = 1.0;    // locked
        this.hidden = new Set(); this.hover = -1;
        this.cam = new Cam3D({ yaw: 0.62, pitch: 0.42, zoom: 1, radius: 13 });
        this.z2 = 1; this.pan2 = [0, 0];

        const root = this.root = document.createElement('div'); root.className = 'vt-pca-dual'; container.appendChild(root);
        root.innerHTML = `<div class="vt-pca-head"><span class="vt-view-tabs" role="tablist"><button class="vt-view-tab active" data-m="pca">PCA</button><button class="vt-view-tab" data-m="tsne">t-SNE</button></span><span class="vt-pca-legend"></span></div>
            <div class="vt-pca-panes"><div class="vt-pca-pane" data-p="3d"><span class="vt-pane-tag">3D</span></div><div class="vt-pca-pane" data-p="2d"><span class="vt-pane-tag">2D</span></div></div>
            <div class="vt-hover-box vt-pca-tip"></div>`;
        this.legendBox = root.querySelector('.vt-pca-legend'); this.tooltip = root.querySelector('.vt-pca-tip');
        this.p3 = root.querySelector('[data-p="3d"]'); this.p2 = root.querySelector('[data-p="2d"]');
        this.c3 = document.createElement('canvas'); this.c2 = document.createElement('canvas'); this.p3.appendChild(this.c3); this.p2.appendChild(this.c2);
        for (const [p, k] of [[this.p3, 3], [this.p2, 2]]) p.insertAdjacentHTML('beforeend', `<span class="vt-view-modebar"><button data-a="in" title="Zoom in">+</button><button data-a="out" title="Zoom out">&minus;</button><button data-a="home" title="Reset view">&#8962;</button><button data-a="png" title="Download PNG">PNG</button></span>`);
        root.querySelectorAll('.vt-view-tab').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.m)));
        this._bindModebar(this.p3, 3); this._bindModebar(this.p2, 2);
        attachOrbit(this.c3, this.cam, { onChange: () => this._draw3(), onDoubleTap: () => { this.cam.reset(); this._draw3(); }, onHover: (x, y) => this._hover(3, x, y) });
        this._bind2D();
        this.c3.addEventListener('pointerleave', () => this._unhover()); this.c2.addEventListener('pointerleave', () => this._unhover());
        if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(container);
        this.legendBox.addEventListener('click', (e) => { const el = e.target.closest('[data-r]'); if (!el || e.detail > 1) return; const r = +el.dataset.r, n = this._regs().length;
            this.hidden.has(r) ? this.hidden.delete(r) : this.hidden.add(r); if (this.hidden.size >= n) this.hidden.clear(); this.draw(); });
        this.legendBox.addEventListener('dblclick', (e) => { const el = e.target.closest('[data-r]'); if (!el) return; const r = +el.dataset.r;
            this.hidden = new Set(this._regs().map((_, i) => i).filter(i => i !== r)); this.draw(); });
    }

    // ---------------------------------------------------------------- data in
    setStatic(d) { this.staticData = d; this.draw(); }
    updateLive(d) { this.liveData = d; if (d.pca_coords) { this.trail.push([d.pca_coords.pc1, d.pca_coords.pc2, d.pca_coords.pc3]); if (this.trail.length > 60) this.trail.shift(); } this.draw(); }
    setViz(v) { this.viz = v; this._cache = null; this.draw(); }
    updateViz(v) { this.liveViz.push(v); if (this.liveViz.length > 60) this.liveViz.shift(); this.draw(); }
    resetForTicker() { this.trail = []; this.liveViz = []; this.liveData = null; this.hover = -1; this._cache = null; this.draw(); }
    setMode(m) {
        if (m === this.mode) return; this.mode = m; this._cache = null; this.z2 = 1; this.pan2 = [0, 0]; this.cam.reset();
        this.root.querySelectorAll('.vt-view-tab').forEach(b => b.classList.toggle('active', b.dataset.m === m));
        const ev = document.getElementById('vt-pca-explained-variance'); if (ev) ev.style.display = m === 'pca' ? '' : 'none';
        this.draw();
    }
    _regs() { return (this.staticData && this.staticData.regimes) || (this.viz && this.viz.regime_names.map((n, i) => ({ name: n, color: this.viz.regime_colors[i] }))) || []; }
    _var() { const e = this.staticData && this.staticData.explained_variance; return e ? [e.pc1, e.pc2, e.pc3] : null; }
    _axisNames() {
        if (this.mode === 'tsne') return ['t-SNE 1', 't-SNE 2', 't-SNE 3'];
        const v = this._var(); return ['PC1', 'PC2', 'PC3'].map((n, i) => v ? `${n} (${(v[i] * 100).toFixed(1)}%)` : n);
    }

    // ---------------------------------------------------------------- geometry (display coords = raw coords + regime centroid x (spread-1))
    _geo() {
        if (!this.viz) return null;
        const key = this.mode + this.viz.points.length + ':' + this.liveViz.length + ':' + this.trail.length + (this.liveData ? this.liveData.predicted_regime : '');
        if (this._cache && this._cache.key === key) return this._cache;
        const pca = this.mode === 'pca', sp = this.bubbleSpread - 1, nR = this._regs().length || 5;
        const raw3 = p => pca ? p.pca : p.tsne3, raw2 = p => pca ? [p.pca[0], p.pca[1]] : p.tsne2;
        const cen = (get, d) => { const s = Array.from({ length: nR }, () => new Array(d + 1).fill(0)); for (const p of this.viz.points) { const c = get(p), r = s[p.dominant]; for (let k = 0; k < d; k++) r[k] += c[k]; r[d]++; } return s.map(r => r[d] ? r.slice(0, d).map(x => x / r[d]) : new Array(d).fill(0)); };
        const c3 = cen(raw3, 3), c2 = cen(raw2, 2);
        const sh = (c, k, r, d) => c.map((x, i) => x + (k[r] ? k[r][i] : 0) * sp);
        const pts = this.viz.points.map((p, i) => ({ i, r: p.dominant, a3: sh(raw3(p), c3, p.dominant), a2: sh(raw2(p), c2, p.dominant), raw: pca ? p.pca : p.tsne3, p }));
        let live = null;
        if (pca && this.liveData && this.liveData.pca_coords) { const q = this.liveData.pca_coords, regs = this._regs(), r = Math.max(0, regs.findIndex(x => x.name === this.liveData.predicted_regime)); const v = [q.pc1, q.pc2, q.pc3];
            live = { r, a3: sh(v, c3, r), a2: sh([v[0], v[1]], c2, r), trail3: this.trail.map(t => sh(t, c3, r)), trail2: this.trail.map(t => sh([t[0], t[1]], c2, r)) }; }
        else if (!pca && this.liveViz.length) { const L = this.liveViz[this.liveViz.length - 1], r = L.posterior.indexOf(Math.max(...L.posterior));
            live = { r, a3: sh(L.tsne3, c3, r), a2: sh(L.tsne2, c2, r), trail3: this.liveViz.map(l => sh(l.tsne3, c3, r)), trail2: this.liveViz.map(l => sh(l.tsne2, c2, r)) }; }
        const sc = (this.staticData && this.staticData.arrow_scale || 1) * this.vectorSpread;
        const VL = this.viz.pca_meta && this.viz.pca_meta.loadings, grp = this.viz.feature_group || [];
        const arrows = !pca ? [] : VL ? VL.map((l, i) => ({ name: this.viz.feature_names[i], short: this.viz.feature_short[i], g: grp[i] || 'anchor', v: [l[0] * sc, l[1] * sc, l[2] * sc] }))
            : this.staticData ? (this.staticData.loadings || []).map(l => ({ name: l.name, short: l.short || l.name, g: 'anchor', v: [l.pc1 * sc, l.pc2 * sc, l.pc3 * sc] })) : [];
        const pulls = pca && this.liveData ? (this.liveData.feature_contributions || []).slice().sort((a, b) => Math.hypot(...b.pull) - Math.hypot(...a.pull)).slice(0, 6).filter(c => Math.hypot(...c.pull) > 0.02).map(c => ({ name: c.name, short: c.name.split(' ')[0] === 'Net' ? 'GEX' : (c.short || c.name), v: c.pull.map(x => x * sc) })) : [];
        const E = [1e-9, 1e-9, 1e-9], take = a => a.forEach((x, k) => { E[k] = Math.max(E[k], Math.abs(x)); });
        pts.forEach(p => take(p.a3)); arrows.forEach(a => take(a.v)); pulls.forEach(a => take(a.v)); if (live) { take(live.a3); live.trail3.forEach(take); }
        const E2 = [1e-9, 1e-9]; pts.forEach(p => { E2[0] = Math.max(E2[0], Math.abs(p.a2[0])); E2[1] = Math.max(E2[1], Math.abs(p.a2[1])); });
        arrows.forEach(a => { E2[0] = Math.max(E2[0], Math.abs(a.v[0])); E2[1] = Math.max(E2[1], Math.abs(a.v[1])); });
        pulls.forEach(a => { E2[0] = Math.max(E2[0], Math.abs(a.v[0])); E2[1] = Math.max(E2[1], Math.abs(a.v[1])); });
        if (live) { E2[0] = Math.max(E2[0], Math.abs(live.a2[0])); E2[1] = Math.max(E2[1], Math.abs(live.a2[1])); live.trail2.forEach(t => { E2[0] = Math.max(E2[0], Math.abs(t[0])); E2[1] = Math.max(E2[1], Math.abs(t[1])); }); }
        return (this._cache = { key, pts, live, arrows, pulls, E, E2 });
    }
    _col(r) { const g = this._regs()[r]; return g ? g.color : '#999'; }
    _fmt(v, d = 2) { const a = Math.abs(v); return (v < 0 ? '−' : v > 0 ? '+' : '') + (a >= 100 ? a.toFixed(0) : a.toFixed(d)); }
    _sgn(v) { return v > 0 ? '#2fd06a' : v < 0 ? '#e04b4b' : '#9aa0aa'; }
    _ticks(lo, hi, n = 6) {
        const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
        const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(Math.abs(v) < st * 1e-6 ? 0 : v); return { out, st };
    }
    _tf(v, st) { const d = st >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(st))); return (v < 0 ? '−' : '') + Math.abs(v).toFixed(d); }

    draw() { this._renderLegend(); this._draw3(); this._draw2(); }
    _renderLegend() {
        const regs = this._regs(), prob = {}; for (const q of (this.liveData && this.liveData.probabilities) || []) prob[q.name] = q.p;
        this.legendBox.innerHTML = regs.map((rg, i) => `<span class="row${this.hidden.has(i) ? ' off' : ''}" data-r="${i}" title="click: show/hide - double-click: isolate"><i style="background:${rg.color}"></i>${rg.name}${prob[rg.name] !== undefined ? ` <b style="color:${rg.color}">${Math.round(prob[rg.name] * 100)}%</b>` : ''}</span>`).join('');
    }

    // ---------------------------------------------------------------- 3D pane
    _draw3() {
        const G = this._geo(); const { ctx, w, h } = vtSizeCanvas(this.c3, this.p3, 120, 120); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h);
        this._hit3 = []; if (!G) return;
        const S = 8.6 / Math.max(G.E[0], G.E[1], G.E[2]), pad = 1.06, ex = G.E[0] * S * pad, ey = G.E[2] * S * pad, ez = G.E[1] * S * pad;   // world: x = axis 1, y(up) = axis 3, z = axis 2
        const W = d => [d[0] * S, d[2] * S, d[1] * S], P = (x, y, z) => this.cam.project(x, y, z, w, h);
        const cp = (x, y, z) => P(x, y, z);
        const wallX = P(-ex, 0, 0).z < P(ex, 0, 0).z ? -ex : ex, wallZ = P(0, 0, -ez).z < P(0, 0, ez).z ? -ez : ez, nearX = -wallX, nearZ = -wallZ;
        const tx = this._ticks(-ex / S, ex / S), ty = this._ticks(-ey / S, ey / S), tz = this._ticks(-ez / S, ez / S);
        ctx.lineWidth = 1;
        const quad = (a, b, c, d, fill) => { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(200,210,225,0.22)'; ctx.stroke(); };
        quad(cp(-ex, -ey, -ez), cp(ex, -ey, -ez), cp(ex, -ey, ez), cp(-ex, -ey, ez), 'rgba(255,255,255,0.035)');         // floor
        quad(cp(wallX, -ey, -ez), cp(wallX, -ey, ez), cp(wallX, ey, ez), cp(wallX, ey, -ez), 'rgba(255,255,255,0.025)'); // side wall
        quad(cp(-ex, -ey, wallZ), cp(ex, -ey, wallZ), cp(ex, ey, wallZ), cp(-ex, ey, wallZ), 'rgba(255,255,255,0.025)'); // back wall
        ctx.strokeStyle = 'rgba(200,210,225,0.10)';
        const ln = (a, b) => { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); };
        for (const t of tx.out) { const x = t * S; ln(cp(x, -ey, -ez), cp(x, -ey, ez)); ln(cp(x, -ey, wallZ), cp(x, ey, wallZ)); }
        for (const t of tz.out) { const z = t * S; ln(cp(-ex, -ey, z), cp(ex, -ey, z)); ln(cp(wallX, -ey, z), cp(wallX, ey, z)); }
        for (const t of ty.out) { const y = t * S; ln(cp(wallX, y, -ez), cp(wallX, y, ez)); ln(cp(-ex, y, wallZ), cp(ex, y, wallZ)); }
        // tick labels + axis titles on the near edges
        ctx.font = '10px monospace'; ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'center';
        const names = this._axisNames(), ctr = P(0, 0, 0);
        for (const t of tx.out) { const q = cp(t * S, -ey, nearZ); ctx.fillText(this._tf(t, tx.st), q.sx, q.sy + 13); }
        for (const t of tz.out) { const q = cp(nearX, -ey, t * S); ctx.fillText(this._tf(t, tz.st), q.sx + (q.sx > ctr.sx ? 12 : -12), q.sy + 11); }
        let lc = null; for (const sx of [-ex, ex]) for (const sz of [-ez, ez]) { const q = cp(sx, -ey, sz); if (!lc || q.sx < lc.q.sx) lc = { q, sx, sz }; }
        ctx.textAlign = 'right'; for (const t of ty.out) { const q = cp(lc.sx, t * S, lc.sz); ctx.fillText(this._tf(t, ty.st), q.sx - 5, q.sy + 3); }
        ctx.font = '11px monospace'; ctx.fillStyle = '#d5dbe6';
        const title = (txt, a, rot) => { const dx = a.sx - ctr.sx, dy = a.sy - ctr.sy, l = Math.hypot(dx, dy) || 1, x = a.sx + dx / l * 30, y = a.sy + dy / l * 26; ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(txt, 0, 0); ctx.restore(); };
        title(names[0], cp(0, -ey, nearZ)); title(names[1], cp(nearX, -ey, 0)); title(names[2], cp(lc.sx, 0, lc.sz), true);
        // arrows from the origin (PCA): loading vectors, then the live feature pulls
        const o = P(0, 0, 0);
        const byLen = G.arrows.slice().sort((a, b) => Math.hypot(...b.v) - Math.hypot(...a.v)), lab = new Set(byLen.slice(0, 9).map(a => a.name));
        for (const a of G.arrows) { const t = P(...W(a.v)); this._arrow(ctx, o, t, a.g === 'cross_book' ? 'rgba(45,212,191,0.8)' : 'rgba(230,235,245,0.55)', 1.2); if (lab.has(a.name)) { ctx.font = '10px monospace'; ctx.fillStyle = a.g === 'cross_book' ? '#5eead4' : '#eef2f7'; ctx.textAlign = 'left'; ctx.fillText(a.short, t.sx + 4, t.sy - 3); } this._hit3.push({ sx: t.sx, sy: t.sy, kind: 'feat', a }); }
        for (const a of G.pulls) { const t = P(...W(a.v)); this._arrow(ctx, o, t, 'rgba(255,196,92,0.95)', 1.8); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#ffc45c'; ctx.textAlign = 'left'; ctx.fillText(a.short, t.sx + 4, t.sy + 10); }
        // points far -> near
        const pp = G.pts.filter(p => !this.hidden.has(p.r)).map(p => ({ p, q: P(...W(p.a3)) })).sort((a, b) => a.q.z - b.q.z);
        for (const { p, q } of pp) { const rr = 2.2 + 0.9 * Math.min(1.6, q.s / 18); ctx.beginPath(); ctx.arc(q.sx, q.sy, rr, 0, 7); ctx.fillStyle = this._col(p.r); ctx.globalAlpha = 0.88; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 0.8; ctx.stroke(); this._hit3.push({ sx: q.sx, sy: q.sy, kind: 'pt', p }); }
        this._live(ctx, G, d => P(...W(d)), 3); this._ring(ctx, G, d => P(...W(d)), 3);
        ctx.textAlign = 'left';
    }
    _arrow(ctx, a, b, col, lw) { ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx); ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(b.sx - 7 * Math.cos(ang - 0.35), b.sy - 7 * Math.sin(ang - 0.35)); ctx.lineTo(b.sx - 7 * Math.cos(ang + 0.35), b.sy - 7 * Math.sin(ang + 0.35)); ctx.closePath(); ctx.fill(); }
    _live(ctx, G, T, k) {
        const L = G.live; if (!L) return; const tr = (k === 3 ? L.trail3 : L.trail2).map(T);
        if (tr.length > 1) { ctx.strokeStyle = this.liveData && this.liveData.directional_bias_bullish === false ? 'rgba(224,75,75,0.9)' : 'rgba(47,208,106,0.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); tr.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.stroke(); }
        const s = T(k === 3 ? L.a3 : L.a2); ctx.beginPath(); ctx.arc(s.sx, s.sy, 7, 0, 7); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill(); ctx.beginPath(); ctx.arc(s.sx, s.sy, 4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
        (k === 3 ? this._hit3 : this._hit2).push({ sx: s.sx, sy: s.sy, kind: 'live' });
    }
    _ring(ctx, G, T, k) { if (this.hover < 0) return; const p = G.pts[this.hover]; if (!p || this.hidden.has(p.r)) return; const q = T(k === 3 ? p.a3 : p.a2); ctx.beginPath(); ctx.arc(q.sx, q.sy, 8, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); }

    // ---------------------------------------------------------------- 2D pane (flat, upright, axes + variables labelled directly)
    _view2(w, h) {
        const G = this._geo(), L = 54, R = 14, T = 14, B = 42, pw = w - L - R, ph = h - T - B;
        const k = Math.min(pw / (2 * G.E2[0]), ph / (2 * G.E2[1])) * 0.94 * this.z2, cx = L + pw / 2 + this.pan2[0], cy = T + ph / 2 + this.pan2[1];
        return { L, R, T, B, pw, ph, k, cx, cy, X: x => cx + x * k, Y: y => cy - y * k };
    }
    _draw2() {
        const G = this._geo(); const { ctx, w, h } = vtSizeCanvas(this.c2, this.p2, 120, 120); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h);
        this._hit2 = []; if (!G) return;
        const V = this._view2(w, h), names = this._axisNames();
        const x0 = (V.L - V.cx) / V.k, x1 = (V.L + V.pw - V.cx) / V.k, y1 = (V.cy - V.T) / V.k, y0 = (V.cy - V.T - V.ph) / V.k;
        const tx = this._ticks(x0, x1), ty = this._ticks(y0, y1, 5);
        ctx.save(); ctx.beginPath(); ctx.rect(V.L, V.T, V.pw, V.ph); ctx.clip();
        ctx.lineWidth = 1; for (const t of tx.out) { ctx.strokeStyle = t === 0 ? 'rgba(200,210,225,0.35)' : 'rgba(200,210,225,0.09)'; ctx.beginPath(); ctx.moveTo(V.X(t), V.T); ctx.lineTo(V.X(t), V.T + V.ph); ctx.stroke(); }
        for (const t of ty.out) { ctx.strokeStyle = t === 0 ? 'rgba(200,210,225,0.35)' : 'rgba(200,210,225,0.09)'; ctx.beginPath(); ctx.moveTo(V.L, V.Y(t)); ctx.lineTo(V.L + V.pw, V.Y(t)); ctx.stroke(); }
        const T2 = d => ({ sx: V.X(d[0]), sy: V.Y(d[1]), z: 0, s: 1 }), o = T2([0, 0]);
        const byLen = G.arrows.slice().sort((a, b) => Math.hypot(a.v[0], a.v[1]) - Math.hypot(b.v[0], b.v[1])).reverse(), lab = new Set(byLen.slice(0, 9).map(a => a.name));
        for (const a of G.arrows) { const t = T2(a.v); this._arrow(ctx, o, t, a.g === 'cross_book' ? 'rgba(45,212,191,0.8)' : 'rgba(230,235,245,0.55)', 1.2); if (lab.has(a.name)) { ctx.font = '10px monospace'; ctx.fillStyle = a.g === 'cross_book' ? '#5eead4' : '#eef2f7'; ctx.textAlign = 'left'; ctx.fillText(a.short, t.sx + 4, t.sy - 3); } this._hit2.push({ sx: t.sx, sy: t.sy, kind: 'feat', a }); }
        for (const a of G.pulls) { const t = T2(a.v); this._arrow(ctx, o, t, 'rgba(255,196,92,0.95)', 1.8); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#ffc45c'; ctx.textAlign = 'left'; ctx.fillText(a.short, t.sx + 4, t.sy + 10); }
        for (const p of G.pts) { if (this.hidden.has(p.r)) continue; const q = T2(p.a2); ctx.beginPath(); ctx.arc(q.sx, q.sy, 3.6, 0, 7); ctx.fillStyle = this._col(p.r); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 0.9; ctx.stroke(); this._hit2.push({ sx: q.sx, sy: q.sy, kind: 'pt', p }); }
        this._live(ctx, G, T2, 2); this._ring(ctx, G, T2, 2);
        ctx.restore();
        ctx.strokeStyle = 'rgba(200,210,225,0.5)'; ctx.strokeRect(V.L + 0.5, V.T + 0.5, V.pw, V.ph);
        ctx.font = '10px monospace'; ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'center';
        for (const t of tx.out) ctx.fillText(this._tf(t, tx.st), V.X(t), V.T + V.ph + 14);
        ctx.textAlign = 'right'; for (const t of ty.out) ctx.fillText(this._tf(t, ty.st), V.L - 6, V.Y(t) + 3);
        ctx.font = '11px monospace'; ctx.fillStyle = '#d5dbe6'; ctx.textAlign = 'center'; ctx.fillText(names[0], V.L + V.pw / 2, h - 8);
        ctx.save(); ctx.translate(13, V.T + V.ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(names[1], 0, 0); ctx.restore(); ctx.textAlign = 'left';
    }
    _bind2D() {
        const c = this.c2; c.style.touchAction = 'none'; let drag = null;
        c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; });
        c.addEventListener('pointermove', e => { if (drag) { this.pan2[0] += e.clientX - drag.x; this.pan2[1] += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; this._draw2(); return; } const r = c.getBoundingClientRect(); this._hover(2, e.clientX - r.left, e.clientY - r.top); });   // flat plane: drag pans, never tilts
        c.addEventListener('pointerup', () => { drag = null; });
        c.addEventListener('wheel', e => { e.preventDefault(); this.z2 = Math.max(0.4, Math.min(8, this.z2 * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); this._draw2(); }, { passive: false });
        c.addEventListener('dblclick', () => { this.z2 = 1; this.pan2 = [0, 0]; this._draw2(); });
    }
    _bindModebar(pane, k) {
        pane.querySelector('.vt-view-modebar').addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; const act = a.dataset.a;
            if (act === 'png') { try { const l = document.createElement('a'); l.download = `regime_${this.mode}_${k}d.png`; l.href = (k === 3 ? this.c3 : this.c2).toDataURL('image/png'); l.click(); } catch (_) {} return; }
            if (k === 3) { if (act === 'home') this.cam.reset(); else this.cam.zoom = Math.max(0.35, Math.min(6, this.cam.zoom * (act === 'in' ? 1.25 : 0.8))); this._draw3(); }
            else { if (act === 'home') { this.z2 = 1; this.pan2 = [0, 0]; } else this.z2 = Math.max(0.4, Math.min(8, this.z2 * (act === 'in' ? 1.25 : 0.8))); this._draw2(); } });
    }

    // ---------------------------------------------------------------- hover (shared by both panes; the hovered point is ringed in both)
    _hover(k, x, y) {
        const hits = k === 3 ? this._hit3 : this._hit2; let best = null, bd = 12 * 12;
        for (const h of hits || []) { const d = (h.sx - x) ** 2 + (h.sy - y) ** 2; if (d < bd) { bd = d; best = h; } }
        const prev = this.hover; this.hover = best && best.kind === 'pt' ? best.p.i : -1; if (prev !== this.hover) { this._draw3(); this._draw2(); }
        const tip = this.tooltip; if (!best) { tip.style.display = 'none'; return; }
        const pane = (k === 3 ? this.p3 : this.p2), pr = pane.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
        let html = '';
        if (best.kind === 'pt') { const p = best.p, rg = this._regs()[p.r] || {}, names = this._axisNames().map(n => n.replace(/ \(.*\)/, ''));
            html = `<div><b style="color:${rg.color}">${rg.name}</b>${p.p.date ? ' · ' + p.p.date : ''}</div>` + p.raw.map((v, i) => `<div class="hr">${names[i]} <b style="color:${this._sgn(v)}">${this._fmt(v)}</b></div>`).join(''); }
        else if (best.kind === 'feat') { html = `<div><b>${best.a.short}</b></div><div class="hr">${best.a.name}</div>` + best.a.v.map((v, i) => `<div class="hr">PC${i + 1} <b style="color:${this._sgn(v)}">${this._fmt(v)}</b></div>`).join(''); }
        else { const d = this.liveData || {}; html = `<div><b style="color:${d.predicted_color || '#fff'}">${d.predicted_regime || 'live'}</b></div><div class="hr">current live read</div>`; }
        tip.innerHTML = html; tip.style.display = 'block'; const left = pr.left - rr.left + x + 14, top = pr.top - rr.top + y - 10;
        tip.style.left = Math.min(left, rr.width - 190) + 'px'; tip.style.top = Math.max(4, top) + 'px'; tip.style.right = 'auto';
    }
    _unhover() { this.tooltip.style.display = 'none'; if (this.hover >= 0) { this.hover = -1; this._draw3(); this._draw2(); } }
}
