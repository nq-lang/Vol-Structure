// pricing_analysis.js - Pricing Surfaces analysis: Distribution model -> Intraday structure -> Weekly structure -> Thesis & risk, each with an Intraday | Swing column pair.
// Numbers come from the C++ core (`an` + strike insight per book in the strike_lens payload). The per-horizon bias / targets / risk posture are composed here from those
// numbers with simple, visible vote rules (hover the bias to see them); the thesis table reuses the same reads as the tables above it, so it cannot contradict them.
// Risk pricing, fundamental view and cross-asset cascades stay available below as collapsed sections (the cascade composer concatenates pre-derived stage pieces).
(function () {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const S = { id: null, trig: null, open: {}, fx: { dxy: 'none', bonds: 'none', vol: 'none' } };
    const lens = () => (window.VT_LENS && VT_LENS.lens) || null;
    const disp = id => (window.VT_REGISTRY && VT_REGISTRY.display[id]) || id;
    const scope = () => (window.VT_SCOPE ? VT_SCOPE.scope() : { mode: 'single' });
    const block = (cls, b) => '<section class="vt-pa-blk ' + cls + '"><h4>' + esc(b.title) + '</h4>' + (!b.ok ? '<div class="vt-lens-empty">Unavailable &mdash; ' + esc(b.reason) + '.</div>' :
        '<p class="vt-pa-head">' + esc(b.headline) + '</p><table class="vt-pa-t"><tbody>' + b.rows.map(r => '<tr><th>' + esc(r.k) + '</th><td>' + esc(r.v) + '</td><td class="n">' + esc(r.n) + '</td></tr>').join('') + '</tbody></table>' +
        b.reads.map(t => '<p class="vt-pa-read">' + esc(t) + '</p>').join('') + '<details class="vt-pa-in"><summary>Inputs used</summary><ul>' + b.inputs.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></details>') + '</section>';
    const hist = h => { if (!h || !h.ok) return ''; const mx = Math.max(...h.p, 1e-9);
        const bars = h.p.map((p, i) => { const x = h.x0 + (i + .5) * h.dx, z = Math.abs(x - h.spot) / h.sigma, cls = z > 2 ? 'tail' : z > 1 ? 'ext' : 'core'; return '<i class="' + cls + '" style="height:' + Math.max(2, p / mx * 100) + '%" title="' + x.toFixed(2) + ' : ' + (p * 100).toFixed(1) + '%"></i>'; }).join('');
        return '<div class="vt-pa-hist" aria-label="risk-neutral distribution">' + bars + '</div><div class="vt-pa-histx"><span>' + (h.x0).toFixed(0) + '</span><span>spot ' + h.spot.toFixed(2) + '</span><span>' + (h.x0 + h.p.length * h.dx).toFixed(0) + '</span></div><div class="vt-pa-leg"><i class="core"></i>within 1σ <i class="ext"></i>1–2σ <i class="tail"></i>beyond 2σ</div>'; };
    function cascade(a) {
        const C = a.casc; if (!C.triggers.length) return '<section class="vt-pa-blk vt-pa-casc"><h4>Cross-Asset Cascades</h4><div class="vt-lens-empty">Unavailable &mdash; no structural strike to break.</div></section>';
        if (!C.triggers.some(t => t.id === S.trig)) S.trig = C.triggers[0].id;
        const T = C.triggers.find(t => t.id === S.trig), dir = T.dir;
        const sel = '<div class="vt-pa-sel"><label>Trigger <select id="vt-pa-trig">' + C.triggers.map(t => '<option value="' + esc(t.id) + '"' + (t.id === S.trig ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('') + '</select></label>' +
            C.factors.map(f => '<label>' + esc(f.label) + ' <select data-fx="' + f.id + '"><option value="none">not in scenario</option>' + f.states.map(s => '<option value="' + s.s + '"' + (S.fx[f.id] === s.s ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select></label>').join('') + '</div>';
        const live = C.factors.map(f => '<span class="vt-pa-chip ' + (f.live ? 'on' : 'off') + '" title="' + esc(f.note) + '">' + esc(f.label) + ': ' + (f.live ? esc(f.live_state) : 'no feed') + '</span>').join('');
        const stages = T.stages.slice(0, 3).concat(C.factors.filter(f => S.fx[f.id] !== 'none').map(f => { const st = f.states.find(s => s.s === S.fx[f.id]); return { t: '→ ' + f.label + ' ' + st.label + ' (scenario assumption)', x: st[dir] }; }));
        if (S.fx.dxy !== 'none' && S.fx.bonds !== 'none') { const p = C.pairs.find(q => q.a === S.fx.dxy && q.b === S.fx.bonds); if (p) stages.push({ t: '→ Combined: dollar and bonds interact', x: p.x }); }
        stages.push.apply(stages, T.stages.slice(3));
        return '<section class="vt-pa-blk vt-pa-casc"><h4>Cross-Asset Cascades <small>derived from this book’s strikes; macro states are hypotheses you set, live readings shown beside</small></h4>' + sel + '<div class="vt-pa-live">' + live + '</div>' +
            '<ol class="vt-pa-stages">' + stages.map(s => '<li><b>' + esc(s.t) + '</b><span>' + esc(s.x) + '</span></li>').join('') + '</ol>' +
            '<div class="vt-pa-two"><div><h5>Downstream levels</h5><ul>' + T.downstream.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul></div><div><h5>What stops it</h5><ul>' + T.stops.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul></div></div>' +
            (T.fut != null ? '<div class="vt-pa-fut">Trigger in futures terms: <b>' + T.fut.toLocaleString('en-US') + '</b></div>' : '') +
            '<details class="vt-pa-in"><summary>Inputs used</summary><ul>' + T.inputs.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></details></section>'; }
    // ================= horizon reads: every table is built from the SAME per-horizon read, so the thesis table can never contradict the tables above it =================
    const num = v => parseFloat(String(v == null ? '' : v).replace(/[^0-9.+\-]/g, ''));
    const rowOf = (blk, key) => blk && blk.ok ? blk.rows.find(r => r.k.indexOf(key) === 0) : null;
    const nf = (v, d) => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
    const sgn = (v, d) => (v >= 0 ? '+' : '−') + nf(Math.abs(v), d);
    // modes of the density: smoothed; a peak counts only when it clears 35% of the max and the valley before it drops >= 15% of the max
    const modes = h => { if (!h || !h.ok) return null; const q = h.p.map((v, i, a) => (a[i - 1] ?? v) * 0.25 + v * 0.5 + (a[i + 1] ?? v) * 0.25), mx = Math.max(...q), t = 0.15 * mx; let n = 0, up = true, ref = q[0];
        for (const v of q) { if (up) { if (v > ref) ref = v; else if (ref - v >= t) { if (ref >= 0.35 * mx) n++; up = false; ref = v; } } else { if (v < ref) ref = v; else if (v - ref >= t) { up = true; ref = v; } } }
        if (up && ref >= 0.35 * mx) n++; return Math.max(n, 1); };
    function fu(b, k) { const L = window.VT_LENS; if (k == null) return '–'; const F = b.convertible && L && L.toFut ? L.toFut(b.id, k) : null, lz = lens(); return F != null ? lz.anchor + ' ' + nf(F, lz.tick < 1 ? 2 : 0) : disp(b.id) + ' ' + nf(k, 2); }
    function ex$(v) { return (v < 0 ? '−' : '+') + '$' + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + 'B' : (Math.abs(v) / 1e6).toFixed(1) + 'M'); }
    function read(b, hz) {
        const I = b.insight, H = I && I[hz], a = b.an; if (!H || !H.ok) return { ok: false, reason: H ? H.reason : 'no strike insight' };
        const spot = I.spot, cs = H.cards, netG = H.net_gamma, flip = H.flip, em = H.em_pct * spot, vxn = rowOf(a.risk, 'VXN regime'), stress = !!(vxn && /stress|high/i.test(vxn.v));
        const votes = [];
        if (flip != null && isFinite(flip)) votes.push(['flip', spot >= flip ? 1 : -1, 'spot ' + (spot >= flip ? 'above' : 'below') + ' flip ' + nf(flip)]);
        const ch = cs.reduce((x, c) => x + (c.charm_day || 0), 0); if (ch) votes.push(['charm', ch > 0 ? 1 : -1, 'charm ' + (ch > 0 ? 'buying' : 'selling')]);
        const pull = sd => cs.filter(c => sd > 0 ? c.strike > spot : c.strike < spot).reduce((x, c) => x + c.p_touch * Math.abs(c.gamma), 0), pu = pull(1), pd = pull(-1);
        if (pu || pd) votes.push(['pull', pu > pd * 1.25 ? 1 : pd > pu * 1.25 ? -1 : 0, 'gamma-weighted touch ' + (pu > pd * 1.25 ? 'above' : pd > pu * 1.25 ? 'below' : 'balanced')]);
        if (hz === 'swinging') { const med = rowOf(a.dist, 'Median'), sk = rowOf(a.dist, 'Skewness'); if (med) votes.push(['median', num(med.v) > spot + 0.05 * em ? 1 : num(med.v) < spot - 0.05 * em ? -1 : 0, 'median ' + med.v]); if (sk) votes.push(['skew', num(sk.v) > 0.15 ? 1 : num(sk.v) < -0.15 ? -1 : 0, 'skew ' + sk.v]); }
        const score = votes.reduce((x, v) => x + v[1], 0), lean = score >= 2 ? 1 : score <= -2 ? -1 : 0, near = flip != null && Math.abs(spot - flip) < 0.25 * em;
        const regime = (near ? 'Transitional' : netG > 0 ? 'Pin / mean-revert' : 'Trend / expansion') + (stress ? ' · high-vol' : '');
        const usable = cs.filter(c => c.verdict !== 'Weak' && c.p_touch >= 0.15), side = sd => usable.filter(c => sd > 0 ? c.strike > spot : c.strike < spot).sort((x, y) => Math.abs(x.strike - spot) - Math.abs(y.strike - spot));
        const dirC = lean >= 0 ? side(1) : side(-1), oppC = lean >= 0 ? side(-1) : side(1);
        let p1, p2, inv;
        if (lean === 0) { p1 = side(1)[0] ? side(1)[0].strike : spot + em; p2 = side(-1)[0] ? side(-1)[0].strike : spot - em; inv = [spot - 1.25 * em, spot + 1.25 * em]; }
        else { p1 = dirC[0] ? dirC[0].strike : spot + lean * em; p2 = dirC[1] ? dirC[1].strike : spot + lean * 1.8 * em; const iv = oppC.find(c => /Support|Resistance|Acceleration/.test(c.verdict)); inv = [flip != null && (lean > 0 ? flip < spot : flip > spot) ? flip : iv ? iv.strike : spot - lean * 0.75 * em]; }
        const ent = (lean === 0 ? usable.slice().sort((x, y) => Math.abs(x.strike - spot) - Math.abs(y.strike - spot)) : dirC)[0] || cs[0];
        const nx = ent ? cs.filter(o => o !== ent && (ent.strike > spot ? o.strike > ent.strike : o.strike < ent.strike)).sort((x, y) => Math.abs(x.strike - ent.strike) - Math.abs(y.strike - ent.strike))[0] : null;
        const ap = ent && window.VT_LENS ? VT_LENS.approach(ent, hz, netG, spot, nx && nx.strike) : null;
        return { ok: true, hz, H, I, spot, em, netG, flip, stress, near, votes, score, lean, regime, p1, p2, inv, ent, ap, cs };
    }
    function riskOf(R, other) {
        if (!R.ok) return null; const flags = [], dis = other && other.ok && R.lean && other.lean && R.lean !== other.lean;
        if (R.stress) flags.push('vol stress'); if (R.near) flags.push('at flip'); if (dis) flags.push('horizons disagree'); if (R.ent && R.ent.confidence === 'low') flags.push('low data confidence');
        const stand = flags.length >= 3 || (R.lean === 0 && R.netG < 0), posture = stand ? 'Stand aside' : flags.length ? 'Reduced' : 'Full', wide = R.netG < 0 || R.stress;
        return { flags, posture, stops: wide ? 'Wide ≥ ' + nf(0.5 * R.em) + ' pts beyond level' : 'Tight ≤ ' + nf(0.25 * R.em) + ' pts beyond level',
            hold: R.hz === 'intraday' ? 'Session only; flat by ' + (R.ent ? R.ent.valid_until : '16:00 ET') : (R.ent ? 'Until ' + R.ent.valid_until : 'Multi-day') + (wide ? ', trail stop' : ''),
            main: R.near ? 'Dealer chase through flip ' + nf(R.flip) : R.stress ? 'Vol expansion (stress, rising)' : dis ? 'Intraday / swing conflict' : R.netG < 0 ? 'Short-gamma acceleration through levels' : 'Pin failure: break of ' + nf(R.inv[0]) };
    }
    const leanTxt = R => !R.ok ? '–' : '<b class="' + (R.lean > 0 ? 'pos' : R.lean < 0 ? 'neg' : 'mut') + '" title="' + esc(R.votes.map(v => v[2] + ' (' + (v[1] > 0 ? '+1' : v[1] < 0 ? '−1' : '0') + ')').join('; ')) + '">' + (R.lean > 0 ? '▲ UP' : R.lean < 0 ? '▼ DOWN' : '◆ NEUTRAL') + ' <span class="n">' + (R.score > 0 ? '+' : '') + R.score + '/' + R.votes.length + '</span></b>';
    const lvTxt = (b, k, R) => k == null ? '–' : '<span class="n">' + esc(fu(b, k)) + '</span> <small class="n mut">' + sgn(k - R.spot) + ' · ' + sgn((k - R.spot) / R.spot * 100) + '%</small>';
    function tbl(cls, title, rows, pre) {
        return '<section class="vt-pa-blk vt-pa-tb ' + cls + '"><h4>' + esc(title) + '</h4>' + (pre || '') + '<table class="vt-pa-t vt-compact"><thead><tr><th></th><th class="hz i">Intraday</th><th class="hz s">Swing</th></tr></thead><tbody>' +
            rows.filter(Boolean).map(r => r.length === 2 ? '<tr><th>' + r[0] + '</th><td colspan="2">' + r[1] + '</td></tr>' : '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table></section>';
    }
    const conflict = (RI, RS) => RI.ok && RS.ok && RI.lean && RS.lean && RI.lean !== RS.lean ? '<b class="warn">Disagree: intraday ' + (RI.lean > 0 ? '▲' : '▼') + ' vs swing ' + (RS.lean > 0 ? '▲' : '▼') + '</b>' : null;
    const expTxt = H => H.expiries.map(e => e.dte + 'D ' + Math.round(e.gamma_share * 100) + '%γ').join(' · ');
    const zone = (R, rx) => R.cs.filter(c => rx.test(c.verdict)).slice(0, 3).map(c => '<span class="n">' + nf(c.strike) + '</span> <small class="mut">' + c.verdict.slice(0, 3) + ' ' + sgn(c.strike - R.spot, 1) + ' · ' + Math.round(c.p_touch * 100) + '%</small>').join(' &nbsp; ') || '–';
    function distTable(b, RI, RS) {
        const a = b.an; if (!a.dist.ok) return '<section class="vt-pa-blk vt-pa-tb dist"><h4>Distribution model</h4><div class="vt-lens-empty">Unavailable &mdash; ' + esc(a.dist.reason) + '.</div></section>';
        const sp = b.spot, e1 = b.vol && b.vol.em_1d != null ? b.vol.em_1d * sp : null, eS = b.em_pct * sp, g = k => rowOf(a.dist, k) || { v: '–', n: '' };
        const r50 = g('Likely range'), r90 = g('Extended range'), pb = g('P(finish below'), sk = g('Skewness'), ku = g('Excess kurtosis'), t1 = g('P(beyond −1'), t2 = g('P(beyond −2');
        const band = (e, m) => e == null ? '–' : '<span class="n">' + nf(sp - m * e) + ' – ' + nf(sp + m * e) + '</span>';
        const dn = num(sk.v), heavy = dn > 0.15 ? 'right tail heavier' : dn < -0.15 ? 'left tail heavier' : 'tails balanced', nm = modes(a.hist) || 1;
        return tbl('dist', 'Distribution model', [
            ['Method', '1 DTE ATM IV, session range ≈ normal', b.ref_dte + ' DTE smile, risk-neutral density'],
            ['Bias', leanTxt(RI), leanTxt(RS)],
            ['Expected move 1σ', e1 == null ? '–' : '<span class="n">±' + nf(e1) + '</span> <small class="n mut">' + nf(e1 / sp * 100) + '%</small>', '<span class="n">±' + nf(eS) + '</span> <small class="n mut">' + nf(b.em_pct * 100) + '%</small>'],
            ['50% of outcomes', band(e1, 0.6745) + ' <small class="mut">≈</small>', '<span class="n">' + esc(r50.v) + '</span>'],
            ['90% of outcomes', band(e1, 1.645) + ' <small class="mut">≈</small>', '<span class="n">' + esc(r90.v) + '</span>'],
            ['Median · P(below spot)', '–', '<span class="n">' + esc(g('Median').v) + ' · ' + esc(pb.v) + '</span>'],
            ['Shape (' + b.ref_dte + 'd)', '<span class="n">skew ' + esc(sk.v) + ' · ex.kurt ' + esc(ku.v) + ' · ' + nm + (nm > 1 ? ' modes' : ' mode') + '</span> <small class="mut">' + heavy + '</small>'],
            ['Tails (−1σ / +1σ · −2σ / +2σ)', '<span class="n">' + esc(t1.v) + ' &nbsp; ' + esc(t2.v) + '</span>'],
            ['Reads', e1 == null ? '–' : 'Session range ' + nf(sp - e1) + '–' + nf(sp + e1) + '; beyond ' + nf(sp + 2 * e1) + ' / ' + nf(sp - 2 * e1) + ' is a &lt;5% tail.', 'Targets past ' + esc(String(r90.v).split('–')[1] || r90.v) + ' are tail trades; ' + heavy + ', ' + esc(pb.v) + ' finish below spot.'],
            ['Alignment', conflict(RI, RS) || (RI.ok && RS.ok && RI.lean && RI.lean === RS.lean ? '<b class="mut">Aligned</b> <small class="mut">intraday and swing lean the same way</small>' : '<b class="mut">No conflict</b> <small class="mut">at least one horizon has no directional lean</small>')]], hist(a.hist));
    }
    function intraTable(b, RI, RS) {
        if (!RI.ok) return '<section class="vt-pa-blk vt-pa-tb intra"><h4>Intraday structure</h4><div class="vt-lens-empty">Unavailable &mdash; ' + esc(RI.reason) + '.</div></section>';
        const cf = conflict(RI, RS), al = !RS.ok ? 'Swing read unavailable' : cf ? cf + ' <small class="mut">— fade size into the session, swing view disagrees</small>' : '<b class="mut">Aligned</b> <small class="mut">— swing lean ' + (RS.lean > 0 ? '▲' : RS.lean < 0 ? '▼' : 'neutral') + ', no conflict</small>';
        const fl = R => R.ok && R.flip != null ? '<span class="n">' + nf(R.flip) + '</span> <small class="n mut">' + sgn(R.flip - R.spot) + '</small>' : '–';
        return tbl('intra', 'Intraday structure', [
            ['Method', esc(expTxt(RI.H)) + ' <small class="mut">session</small>', RS.ok ? esc(expTxt(RS.H)) : '–'],
            ['Bias', leanTxt(RI), leanTxt(RS)],
            ['Regime', esc(RI.regime), RS.ok ? esc(RS.regime) : '–'],
            ['Gamma flip', fl(RI), fl(RS)],
            ['Expected 1σ', '<span class="n">±' + nf(RI.em) + '</span>', RS.ok ? '<span class="n">±' + nf(RS.em) + '</span>' : '–'],
            ['Pin zones (session)', zone(RI, /Magnet|Support|Resistance/)], ['Acceleration zones', zone(RI, /Acceleration|Pivot/)],
            ['Dealer hedging', RI.netG < 0 ? 'Short gamma ' + ex$(RI.netG) + '/1%: dealers sell dips, buy rallies → moves extend' : 'Long gamma ' + ex$(RI.netG) + '/1%: dealers sell rallies, buy dips → moves damp'],
            ['vs multi-day', al]]);
    }
    function weekTable(b, RI, RS) {
        if (!RS.ok) return '<section class="vt-pa-blk vt-pa-tb week"><h4>Weekly structure</h4><div class="vt-lens-empty">Unavailable &mdash; ' + esc(RS.reason) + '.</div></section>';
        const exs = RS.H.expiries.slice().sort((x, y) => y.gamma_share - x.gamma_share), big = exs[0], cf = conflict(RI, RS);
        return tbl('week', 'Weekly structure', [
            ['Method', RI.ok ? esc(expTxt(RI.H)) : '–', esc(expTxt(RS.H)) + ' <small class="mut">OI clusters, vanna/vega, ' + b.ref_dte + 'd smile</small>'],
            ['Bias', leanTxt(RI), leanTxt(RS)],
            ['Regime', RI.ok ? esc(RI.regime) : '–', esc(RS.regime)],
            ['Multi-day flip', RI.ok && RI.flip != null ? '<span class="n">' + nf(RI.flip) + '</span>' : '–', RS.flip != null ? '<span class="n">' + nf(RS.flip) + '</span> <small class="n mut">' + sgn(RS.flip - RS.spot) + '</small>' : '–'],
            ['Roll-off', RS.H.expiries.map(e => '<span class="n">' + e.dte + 'D ' + esc(e.label) + '</span> <small class="mut">' + Math.round(e.gamma_share * 100) + '%γ ' + Math.round(e.oi_share * 100) + '%OI</small>').join(' &nbsp; ')],
            ['Magnets (multi-day)', zone(RS, /Magnet|Support|Resistance|Pivot|Acceleration/)],
            ['Evolution', big ? esc(big.label) + ' carries ' + Math.round(big.gamma_share * 100) + '% of gamma: pins toward its strikes into ' + big.dte + 'D, regime shifts after roll-off' : '–'],
            ['Effect on intraday', cf ? cf + ' <small class="mut">— swing bias caps intraday ' + (RI.lean > 0 ? 'longs' : 'shorts') + ' at reduced size</small>' : RI.ok && RS.lean && RI.lean === RS.lean ? '<b class="mut">Reinforces</b> <small class="mut">intraday ' + (RS.lean > 0 ? '▲' : '▼') + '</small>' : '<b class="mut">Neutral</b> <small class="mut">no multi-day lean to add or subtract</small>']]);
    }
    function thesisTable(b, RI, RS) {
        const rk = [riskOf(RI, RS), riskOf(RS, RI)], R = [RI, RS], cell = f => R.map((r, i) => r.ok ? f(r, rk[i], i) : '–');
        const cf = conflict(RI, RS), pc = k => k === 'Full' ? 'pos' : k === 'Stand aside' ? 'neg' : 'warn';
        return tbl('thesis', 'Thesis & risk', [['Bias'].concat(R.map(leanTxt)),
            ['Primary target'].concat(cell(r => lvTxt(b, r.p1, r))), ['Secondary'].concat(cell(r => lvTxt(b, r.p2, r))),
            ['Invalidation'].concat(cell(r => r.inv.length === 2 ? '<span class="n">' + esc(fu(b, r.inv[0])) + ' / ' + esc(fu(b, r.inv[1])) + '</span>' : lvTxt(b, r.inv[0], r))),
            ['Entry approach'].concat(cell(r => r.ap ? '<b>' + esc(r.ap.name) + '</b> <small class="mut">' + esc(r.ap.trig) + '</small>' : '–')),
            ['Regime'].concat(cell(r => esc(r.regime))),
            ['Risk'].concat(cell((r, k) => '<b class="' + pc(k.posture) + '">' + k.posture + '</b>' + (k.flags.length ? ' <small class="mut">' + esc(k.flags.join(', ')) + '</small>' : ''))),
            ['Stops'].concat(cell((r, k) => esc(k.stops))), ['Hold'].concat(cell((r, k) => esc(k.hold))), ['Main risk'].concat(cell((r, k) => esc(k.main))),
            cf && ['Alignment', cf]]);
    }
    function render() {
        const el = document.getElementById('vt-pa'); if (!el) return; const lz = lens();
        if (!lz || scope().mode === 'single') { el.hidden = true; return; }
        const books = lz.books.filter(b => b.an); if (!books.length) { el.hidden = true; return; }
        if (!books.some(b => b.id === S.id)) S.id = (scope().ticker && books.some(b => b.id === scope().ticker)) ? scope().ticker : books[0].id;
        const b = books.find(x => x.id === S.id), a = b.an, RI = read(b, 'intraday'), RS = read(b, 'swinging'); el.hidden = false;
        const more = (id, title, html) => '<details class="vt-pa-more" data-more="' + id + '"' + (S.open[id] ? ' open' : '') + '><summary>' + esc(title) + '</summary>' + html + '</details>';
        el.innerHTML = '<div class="vt-pa-h"><b>Pricing Analysis</b><span class="vt-pa-books" role="group">' + books.map(x => '<button class="vt-pa-bk' + (x.id === S.id ? ' on' : '') + '" data-id="' + x.id + '">' + esc(disp(x.id)) + '</button>').join('') + '</span></div>' +
            '<div class="vt-pa-stack">' + distTable(b, RI, RS) + intraTable(b, RI, RS) + weekTable(b, RI, RS) + thesisTable(b, RI, RS) + '</div>' +
            more('risk', 'Risk pricing', block('risk', a.risk)) + more('fund', 'Fundamental view', block('fund', a.fund)) + more('casc', 'Cross-asset cascades', cascade(a));
        el.querySelectorAll('.vt-pa-bk').forEach(x => x.addEventListener('click', () => { S.id = x.dataset.id; S.trig = null; render(); }));
        el.querySelectorAll('.vt-pa-more').forEach(d => d.addEventListener('toggle', () => { S.open[d.dataset.more] = d.open; }));
        const tr = el.querySelector('#vt-pa-trig'); if (tr) tr.addEventListener('change', () => { S.trig = tr.value; render(); });
        el.querySelectorAll('select[data-fx]').forEach(x => x.addEventListener('change', () => { S.fx[x.dataset.fx] = x.value; render(); }));
    }
    const prev = () => window.onStrikeLens;
    window.addEventListener('DOMContentLoaded', () => { const p = prev(); window.onStrikeLens = pl => { if (p) p(pl); render(); }; if (window.VT_SCOPE) VT_SCOPE.onChange(() => render()); });
    window.VT_PA = { render, state: S };
})();
