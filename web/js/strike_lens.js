// strike_lens.js - Strike Lens. Pricing Surfaces page: market-pricing levels (expected-move bands, RND quantiles/mode, 25-delta strikes).
// greeksChannel page: dealer-Greek levels (flip, walls, top |GEX|). Never mixed. Highlight any in-scope book; levels are translated into
//  - INDX ticker (Multi-Book):  the selected ticker's own strike space (primary); futures equivalent only if toggled on
//  - futures Family:            the anchor futures price (primary)
// All conversion numbers (ratio, basis, per-level futures equivalents) come from the C++ core via the `strike_lens` channel.
// Hidden in Single-Book: Single View is the plain ticker with no futures or other-book content.
(function () {
    const COLORS = ['#7be0c6', '#f0b27a', '#9db7ff', '#ff8fb1', '#d6e36b', '#c39bff'];
    const GREEK = ['gex', 'dex', 'vanna', 'charm', 'speed', 'color', 'theta'];
    const L = { lens: null, mb: null, picked: null, view: 'pricing', showFut: false, customBook: null, hz: 'intraday' };
    try { const h = sessionStorage.getItem('vt_lens_hz'); if (h === 'intraday' || h === 'swinging') L.hz = h; } catch (e) {}   // B1-6: remembered for the session, default Intraday
    const disp = id => (window.VT_REGISTRY && VT_REGISTRY.display[id]) || id;
    const parse = p => (typeof p === 'string' ? JSON.parse(p) : p);
    const book = id => L.lens && L.lens.books.find(b => b.id === id);
    const scopeNow = () => (window.VT_SCOPE ? VT_SCOPE.scope() : { mode: 'single' });
    const active = () => scopeNow().mode !== 'single' && !!L.lens;
    const color = id => COLORS[(L.lens ? L.lens.books.findIndex(b => b.id === id) : 0) % COLORS.length];
    const famMode = () => scopeNow().mode === 'family';
    const isFutTicker = id => !!(window.VT_REGISTRY && (VT_REGISTRY.futures || []).includes(id));
    // B1-1: the visible "Equiv" column exists only when the primary price space is a futures contract (Family, or a futures ticker in focus). Conversion logic is untouched.
    const showEquiv = () => famMode() || isFutTicker(scopeNow().ticker);
    const fmtX = v => { const a = Math.abs(v), sg = v < 0 ? '\u2212' : '+'; return sg + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0)); };
    const decimals = t => (t && t < 1 ? Math.min(3, (String(t).split('.')[1] || '').length) : 0);
    const fmt = (v, t, dflt) => v == null ? 'n/a' : v.toLocaleString('en-US', { minimumFractionDigits: t != null ? decimals(t) : (dflt ?? 2), maximumFractionDigits: t != null ? decimals(t) : (dflt ?? 2) });
    const levelsOf = (b, view) => (view === 'greeks' ? b.levels : b.pricing) || [];
    // ---- conversions (same formulas as the core: fut = k*ratio + basis, tick-rounded)
    L.toFut = (id, k) => { const b = book(id); if (!b || !b.convertible) return null; const v = k * b.ratio + b.basis, t = L.lens.tick; return t > 0 ? Math.round(v / t) * t : v; };
    L.fromFut = (id, F) => { const b = book(id); if (!b || !b.convertible || !b.ratio) return null; return (F - b.basis) / b.ratio; };
    // level of book `id` expressed in the primary space: ticker strike space (INDX) or futures (family)
    L.primary = (id, lv) => { if (famMode()) return lv.fut; const P = scopeNow().ticker; if (id === P) return lv.strike; return lv.fut == null ? null : L.fromFut(P, lv.fut); };
    // Key Levels (page 1): a level in the primary price space -> one "BOOK $strike / ANCHOR $fut" line per highlighted book (strike first, then futures)
    const money = (v, t) => '$' + (v == null ? 'n/a' : v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: t && t < 1 ? decimals(t) : 2 }));
    L.equiv = function (price) {
        if (!active() || !L.picked || !L.picked.size) return [];
        const P = scopeNow().ticker, an = L.lens.anchor, F = famMode() || P === an ? price : L.toFut(P, price); if (F == null) return [];
        const out = []; for (const id of L.picked) { const b = book(id); if (!b || !b.convertible) continue;
            const k = id === P && !famMode() ? price : L.fromFut(id, F); if (k == null) continue;
            out.push({ id, text: disp(id) + ' ' + money(k, b.tick_hint || 0.01) + ' / ' + an + ' ' + money(F, L.lens.tick), color: color(id) }); }
        return out; };
    L.chipsHtml = function () { if (!active() || !L.lens) return ''; const P = scopeNow().ticker;
        return L.lens.books.filter(b => b.convertible).map(b => '<button class="vt-lens-chip sm' + (L.picked && L.picked.has(b.id) ? ' on' : '') + '" data-id="' + b.id + '" style="--c:' + color(b.id) + '">' + disp(b.id) + '</button>').join(''); };
    L.toggle = function (id) { if (!L.picked) L.picked = new Set(); L.picked.has(id) ? L.picked.delete(id) : L.picked.add(id); render(); };
    L.listeners = []; const fire = () => L.listeners.forEach(f => { try { f(); } catch (e) {} });
    L.panelApi = function (view) {
        if (!active()) return null; const P = scopeNow().ticker, isAnchor = P === L.lens.anchor, pb = book(P);
        if (!pb && !isAnchor) return null;
        const fromF = isAnchor ? (F => F) : (F => L.fromFut(P, F));
        const toF = isAnchor ? (k => k) : (k => L.toFut(P, k));
        const showFut = famMode() || L.showFut;
        return { anchor: L.lens.anchor, toFut: showFut ? toF : null,
            markers() { const out = []; for (const id of L.picked || []) { const b = book(id); if (!b || !b.convertible) continue;
                for (const lv of levelsOf(b, view)) { if (lv.label === 'Top |GEX|' || lv.fut == null) continue; const x = id === P ? lv.strike : fromF(lv.fut); if (x != null) out.push({ x, label: disp(id) + ' ' + short(lv.label), color: color(id) }); } }
                return out; } };
    };
    const short = l => l.replace('Gamma ', '').replace(' Wall', 'W').replace('Exp Move ', 'EM ').replace('Near Move ', 'NM ').replace('25D ', '25D ');
    function repaintPanels() { const pp = L.panelApi('pricing'), gp = L.panelApi('greeks');
        if (window.__panels) Object.entries(window.__panels).forEach(([ch, p]) => p.panel && p.panel.setLens && p.panel.setLens(GREEK.includes(ch) ? gp : pp)); }
    const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    // ---- B1-6/B1-7: Intraday / Swinging tabs + strike insight cards (all numbers and sentences come from the C++ strike_insight core)
    const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ex = v => v == null ? 'n/a' : (v < 0 ? '−' : '+') + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (Math.abs(v) / 1e3).toFixed(0) + 'K' : Math.abs(v).toFixed(0));
    const shs = v => v == null ? 'n/a' : (v < 0 ? '−' : '+') + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? (Math.abs(v) / 1e3).toFixed(1) + 'K' : Math.abs(v).toFixed(0));
    const VCLS = { Magnet: 'mag', Support: 'sup', Resistance: 'res', Acceleration: 'acc', Pivot: 'piv', Weak: 'weak' };
    // strike label: own space first; futures equivalent where the primary space is futures (or the toggle is on); other-book strikes shown in the focus ticker's space. Same conversion maths as the table / converter.
    function strikeLabel(id, k) {
        const P = scopeNow().ticker, b = book(id), an = L.lens.anchor, own = disp(id) + ' $' + fmt(k, b && b.tick_hint || 0.01);
        if (!b || !b.convertible) return own; const F = L.toFut(id, k); if (F == null) return own;
        if (famMode() || isFutTicker(P)) return own + ' / ' + an + ' $' + fmt(F, L.lens.tick);
        const extra = id !== P ? ' = ' + disp(P) + ' $' + fmt(P === an ? F : L.fromFut(P, F), 0.01) : '';
        return own + extra + (L.showFut ? ' / ' + an + ' $' + fmt(F, L.lens.tick) : '');
    }
    function axisPx(id, k) { const b = book(id); if (!b) return null; if (famMode()) return L.toFut(id, k); const P = scopeNow().ticker; if (id === P) return k; const F = L.toFut(id, k); return F == null ? null : L.fromFut(P, F); }
    L.axisPx = axisPx;
    // ---- Hedge Flow: live-state table (Dealer flow | Price | Status | When | Dealer) followed by ONE merged "what it measures / effect on price" reference table.
    //      No header prose: the block starts with data. All numbers come from the multibook `hedge` / `session` payloads.
    function hedgeBlock() {
        const h = L.mb && L.mb.hedge; if (!h) return '<div class="vt-lens-empty">Hedge flow unavailable &mdash; no index-convertible books in scope.</div>';
        const S = L.mb.session, ccl = S && S.ok && S.pts.length ? S.pts[S.pts.length - 1].charm_close : null;
        const bs = v => v > 0 ? 'BUY' : v < 0 ? 'SELL' : 'FLAT', c0 = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
        const f1 = i => h.anchor_contracts[h.shock_pct.indexOf(i)], up = f1(1), dn = f1(-1), amp = up > 0 && dn < 0, damp = up < 0 && dn > 0, ob = S && S.ok && S.observed && S.observed[0];
        const ref = [['Price shock', 'Dealer re-hedge after a price move', amp ? 'AMPLIFIES: dealers chase' : damp ? 'DAMPS: dealers fade' : 'Asymmetric: ' + bs(up) + ' on +1%, ' + bs(dn) + ' on −1%', amp ? 'neg' : damp ? 'pos' : ''],
            ['Vanna', 'Hedge change per vol point, price flat', (h.vanna_up_c > 0 ? 'Vol up: supports' : 'Vol up: pressures') + ' · ' + (h.vanna_dn_c > 0 ? 'vol down: supports' : 'vol down: pressures'), ''],
            ['Charm', 'Hedge change from time alone', ccl != null ? 'Drift ' + (ccl > 0 ? 'UP' : 'DOWN') + ' into close' : (h.charm_1d_c > 0 ? 'Background buying' : 'Background selling'), c0(ccl != null ? ccl : h.charm_1d_c)],
            ['0DTE', 'Same-day expiry hedge', 'Fades at the close', ''],
            ['Observed', 'Realised hedge change in window', ob ? (ob.flow_c > 0 ? 'Net buying so far' : 'Net selling so far') : 'No history yet', ob ? c0(ob.flow_c) : '']]
            .map(r => '<tr><td class="lb">' + r[0] + '</td><td>' + esc(r[1]) + '</td><td class="' + r[3] + '">' + esc(r[2]) + '</td></tr>').join('');
        return '<div class="vt-hedge-w"><table class="vt-hedge vt-hedge-ref vt-compact"><thead><tr><th>Flow</th><th>What it measures</th><th>Effect on price</th></tr></thead><tbody>' + ref + '</tbody></table></div>';
    }
    // ---- Entry approach vocabulary (shared by the level cards and the pricing thesis table). Pure function of the card numbers + horizon.
    L.approach = function (c, hz, netG, spot, nextStrike) {
        const lvl = fmt(c.strike, 0.01), side = c.strike >= spot ? 'above' : 'below', x25 = fmt(Math.abs(c.pb && c.pb.entry_px != null && c.pb.stop_px != null ? c.pb.stop_px - c.pb.entry_px : 0), 0.01);
        const neg = c.gamma < 0, v = c.verdict, swing = hz === 'swinging', near = nextStrike != null ? fmt(nextStrike, 0.01) : null;
        let key, name, trig, why;
        if (v === 'Acceleration' || (neg && v !== 'Pivot')) {
            if (!swing) { key = 'momentum'; name = 'Momentum continuation, then retest'; trig = 'Let price break ' + lvl + ' and extend; enter on the retest of ' + lvl + (near ? ' or the nearer ' + near : '') + ' holding'; }
            else { key = 'retest'; name = 'Break & retest'; trig = 'Close beyond ' + lvl + ' (±' + x25 + '), then retest ' + lvl + ' and hold → enter'; }
            why = 'Short gamma at ' + lvl + ': dealers sell dips / buy rallies, so breaks extend; do not fade.';
        } else if (v === 'Pivot') { key = 'retest'; name = 'Break & retest'; trig = 'Wait for a close beyond ' + lvl + ', then retest and hold → enter with the break'; why = 'Gamma sign flips at ' + lvl + ': direction needs confirmation, first touch is a coin-flip.'; }
        else if (v === 'Magnet') {
            if (!swing && c.p_touch >= 0.5) { key = 'immediate'; name = 'Enter on first touch'; trig = 'Enter on the first reaction at ' + lvl + ' (' + Math.round(c.p_touch * 100) + '% touch odds)'; why = 'Positive gamma pulls price toward ' + lvl + ' and damps moves once there.'; }
            else { key = 'scale'; name = 'Scale in across the zone'; trig = 'Add on each reaction within ±' + x25 + ' of ' + lvl; why = 'Pinning ' + (swing ? 'persists until its expiry rolls off' : 'strength builds into the close') + '; no single entry price.'; }
        } else if (v === 'Support' || v === 'Resistance') {
            if (!swing) { key = 'immediate'; name = 'Enter on first touch'; trig = 'Fade the first touch of ' + lvl + ' (stop ' + fmt(c.pb && c.pb.stop_px, 0.01) + ')'; why = 'Long gamma at ' + lvl + ': dealers ' + (side === 'above' ? 'sell rallies' : 'buy dips') + ', so the first touch tends to revert.'; }
            else if (c.gamma_share >= 0.25) { key = 'scale'; name = 'Scale in across the zone'; trig = 'Add on each reaction within ±' + x25 + ' of ' + lvl; why = 'Large share of multi-day gamma (' + Math.round(c.gamma_share * 100) + '%): a durable ' + v.toLowerCase() + ', not a one-touch level.'; }
            else { key = 'retest'; name = 'Break & retest'; trig = 'Enter only after a retest of ' + lvl + ' holds on the far side'; why = 'Small share of multi-day gamma (' + Math.round(c.gamma_share * 100) + '%): the level can give way, so wait for confirmation.'; }
        } else { key = 'fade'; name = 'Fade first touch only if momentum is exhausted'; trig = 'Fade ' + lvl + ' only after two failed pushes; otherwise stand aside'; why = 'Weak gamma at ' + lvl + ' (' + Math.round((c.gamma_share || 0) * 100) + '% share): little hedging force either way.'; }
        return { key, name, trig, why };
    };
    // ---- level card: Valid until -> Distance / P(touch) / Fed by -> Invalidated by -> Entry playbook
    function fedBy(c, H) {
        const g = c.votes.filter(v => v.v > 0).map(v => v.greek).filter((x, i, a) => a.indexOf(x) === i), ex2 = (H.expiries || []).map(e => e.dte + 'D ' + Math.round((e.gamma_share || 0) * 100) + '%').join(' · ');
        return '<b>' + esc((g.length ? g.join(' + ') : 'Gamma')) + '</b> <span class="mut">' + esc(ex2) + '</span>'; }
    // ---- Playbook: Entry / Stop / TP1-TP3 ladder. TP1 = the core's target; TP2 / TP3 = the next structural strikes of this horizon beyond TP1 in the trade direction
    //      (fallback: 1.5x / 2x the entry-to-TP1 distance, marked "ext"). R = reward / risk to the stop; the scale-out split is a fixed, visible rule (50 / 30 / 20 %).
    function ladder(c, H) {
        const pb = c.pb, e = pb.entry_px, st = pb.stop_px, t1 = pb.target_px; if (e == null || st == null || t1 == null) return null;
        const dir = t1 >= e ? 1 : -1, risk = Math.abs(e - st) || 1e-9, d1 = Math.abs(t1 - e);
        const beyond = (H.cards || []).filter(o => o !== c && dir * (o.strike - t1) > 1e-9 && o.verdict !== 'Weak').sort((a, b) => dir * (a.strike - b.strike));
        const mk = (px, o, ext, take) => ({ px, r: Math.abs(px - e) / risk, p: o ? o.p_touch : null, ext, take });
        const t2 = beyond[0] ? mk(beyond[0].strike, beyond[0], false, '30%') : mk(e + dir * 1.5 * d1, null, true, '30%');
        const t3 = beyond[1] ? mk(beyond[1].strike, beyond[1], false, '20%') : mk(Math.max(dir * (t2.px - e) + 0.5 * d1, 2 * d1) * dir + e, null, true, '20%');
        return { dir, e, st, tps: [{ px: t1, r: Math.abs(t1 - e) / risk, p: pb.p_target, ext: false, take: '50%' }, t2, t3] };
    }
    function pbHtml(c, ap, H, spot, hz) {
        const lg = ladder(c, H), pb = c.pb; if (!lg) return '<div class="vt-lens-empty">Playbook unavailable for this level.</div>';
        const d = v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 0.01), pc = v => v == null ? '–' : Math.round(v * 100) + '%';
        const row = (lab, cls, px, dl, r, p, take, ext) => '<tr class="' + cls + '"><th>' + lab + (ext ? ' <i title="no further structural strike; extended from the entry-to-TP1 distance">ext</i>' : '') + '</th><td class="n">' + fmt(px, 0.01) + '</td><td class="n ' + (cls === 'stop' ? 'neg' : cls === 'tp' ? 'pos' : 'mut') + '">' + (dl == null ? '–' : d(dl)) + '</td><td class="n">' + r + '</td><td class="n">' + pc(p) + '</td><td class="tk">' + take + '</td></tr>';
        return '<div class="vt-pb"><div class="vt-pb-h"><span class="dir ' + (lg.dir > 0 ? 'up' : 'dn') + '">' + (lg.dir > 0 ? '▲ LONG' : '▼ SHORT') + '</span><b>' + esc(ap.name) + '</b></div>' +
            '<div class="vt-pb-trig">' + esc(ap.trig) + '</div>' +
            '<table class="vt-pb-t"><thead><tr><th></th><th class="n">Level</th><th class="n">Δ pts</th><th class="n">R</th><th class="n">P(hit)</th><th>Take</th></tr></thead><tbody>' +
            row('Entry', 'ent', lg.e, null, '–', null, 'at trigger', false) + row('Stop', 'stop', lg.st, lg.st - lg.e, '−1.0R', null, 'exit all', false) +
            lg.tps.map((t, i) => row('TP' + (i + 1), 'tp', t.px, t.px - lg.e, t.r.toFixed(1) + 'R', t.p, t.take + (i === 0 ? ' · stop → entry' : ''), t.ext)).join('') + '</tbody></table><div class="vt-pb-f"><i>Hold</i> ' + esc(String(pb.hold).replace(/^hold\s+/i, '')) + '</div></div>';
    }
    function cardHtml(id, c, i, hz, H, I, next) {
        const vcls = VCLS[c.verdict] || '', ap = L.approach(c, hz, H.net_gamma, I.spot, next), pb = c.pb, spot = I.spot, pts = c.strike - spot, pct = x => Math.round(x * 100) + '%';
        const sg1 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
        return '<details data-k="' + hz + c.strike + '" data-sk="' + (axisPx(id, c.strike) ?? '') + '" class="vt-lc ' + vcls + (c.contested ? ' contested' : '') + '"' + (i < 2 ? ' open' : '') + '><summary><b class="k" style="border-left:3px solid ' + color(id) + '">' + esc(strikeLabel(id, c.strike)) + '</b><span class="vd">' + esc(c.verdict) + (c.contested ? ' (contested)' : '') + '</span></summary>' +
            '<div class="vt-lc-b"><div class="vt-lc-v">Valid until <b>' + esc(c.valid_until) + '</b></div>' +
            '<div class="vt-lc-k"><span><i>Distance</i><b class="n">' + sg1(pts) + ' pts &middot; ' + sg1(c.dist_pct) + '%</b></span><span><i>P(touch)</i><b class="n">' + pct(c.p_touch) + '</b></span><span class="fb"><i>Fed by</i>' + fedBy(c, H) + '</span></div>' +
            '<div class="vt-lc-i"><i>Invalidated by</i><ul>' + c.invalidation.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' +
            pbHtml(c, ap, H, spot, hz) +
            '<div class="vt-lc-why">' + esc(ap.why) + '</div></div></details>';
    }
    function horizonCol(id, hz) {
        const I = book(id).insight, H = I[hz], nm = hz === 'intraday' ? 'Intraday' : 'Swing';
        const head = '<div class="vt-lc-h"><b>' + nm + '</b><span class="mut">' + (hz === 'intraday' ? '0–1 DTE' : 'multi-day') + '</span></div>';
        if (!H.ok) return '<div class="vt-lc-col" data-hz="' + hz + '">' + head + '<div class="vt-lens-warn">Unavailable &mdash; ' + esc(H.reason) + '</div></div>';
        const cs = H.cards, body = cs.length ? cs.slice(0, 2).map((c, i) => { const nx = cs.filter(o => o !== c && (c.strike > I.spot ? o.strike > c.strike : o.strike < c.strike)).sort((a, b) => Math.abs(a.strike - c.strike) - Math.abs(b.strike - c.strike))[0]; return cardHtml(id, c, i, hz, H, I, nx && nx.strike); }).join('') : '<div class="vt-lens-empty">No structural strike.</div>';
        return '<div class="vt-lc-col" data-hz="' + hz + '">' + head + body + '</div>';
    }
    function cardsBlock() {
        const ids = [...L.picked].filter(id => { const b = book(id); return b && b.insight; });
        if (!ids.length) return '<div class="vt-lens-empty">No book selected.</div>';
        return ids.map(id => (ids.length > 1 ? '<div class="vt-lc-bk" style="color:' + color(id) + '">' + disp(id) + '</div>' : '') + '<div class="vt-lc-grid">' + horizonCol(id, 'intraday') + horizonCol(id, 'swinging') + '</div>').join('');
    }
    L.strikeLabel = strikeLabel;
    // ---- strike lens = index/ETF -> futures conversion list. Entries persist (storage) until the USER removes them; the futures level is recomputed on every refresh.
    let _cid = 0, CK = 'vt_lens_conv'; L.conv = [];
    try { const s = JSON.parse(localStorage.getItem(CK) || '[]'); if (Array.isArray(s)) L.conv = s.filter(e => e && e.id && isFinite(e.k)).map(e => ({ u: ++_cid, id: e.id, k: +e.k })); } catch (e) {}
    const saveConv = () => { try { localStorage.setItem(CK, JSON.stringify(L.conv.map(e => ({ id: e.id, k: e.k })))); } catch (e) {} };
    L.addConv = (id, k) => { k = +k; if (!id || !isFinite(k) || L.conv.some(e => e.id === id && e.k === k)) return false; L.conv.push({ u: ++_cid, id, k }); saveConv(); render(); return true; };
    L.removeConv = u => { L.conv = L.conv.filter(e => e.u !== u); saveConv(); render(); };
    // DTE + exposure context of an entered strike, from the strike-insight cards of its own book (nearest card within 0.4% of the strike)
    function strikeCtx(id, k) {
        const b = book(id), out = { ctx: '–', dte: '–', flag: '' }; if (!b) return out; let best = null;
        if (b.insight) ['intraday', 'swinging'].forEach(hz => { const H = b.insight[hz]; if (!H || !H.ok) return; H.cards.forEach(c => { const d = Math.abs(c.strike - k); if (!best || d < best.d - 1e-9) best = { d, c, hz, H }; }); });
        if (best && best.d / k <= 0.004) { const ex2 = best.H.expiries || [], lo = Math.min(...ex2.map(e => e.dte)), hi = Math.max(...ex2.map(e => e.dte));
            out.ctx = 'GEX ' + ex(best.c.gamma) + ' ' + best.c.verdict; out.dte = lo === hi ? lo + 'D' : lo + '–' + hi + 'D'; out.flag = best.hz === 'intraday' ? 'INTRADAY' : 'SWING'; }
        else { const lv = (b.levels || []).filter(l => l.label !== 'Top |GEX|').map(l => ({ l, d: Math.abs(l.strike - k) })).sort((a, c) => a.d - c.d)[0]; if (lv && lv.d / k <= 0.004) out.ctx = lv.l.label + (lv.l.value ? ' ' + fmtX(lv.l.value) : ''); }
        return out;
    }
    function convRows() {
        const A = L.lens.anchor, F0 = L.lens.anchor_px, tk = L.lens.tick;
        if (!L.conv.length) return '<tr><td colspan="7" class="vt-lens-empty">Enter a strike to convert it to ' + A + '.</td></tr>';
        return L.conv.map(e => { const b = book(e.id), F = b && b.convertible ? L.toFut(e.id, e.k) : null, d = F != null && F0 ? F - F0 : null, c = strikeCtx(e.id, e.k);
            return '<tr data-u="' + e.u + '"><td class="lb"><i style="background:' + color(e.id) + '"></i>' + disp(e.id) + ' <b class="n">' + fmt(e.k, 0.01) + '</b></td><td class="n f">' + (F == null ? '–' : A + ' <b>' + fmt(F, tk) + '</b>') + '</td><td class="n ' + cls(d) + '">' + (d == null ? '–' : (d >= 0 ? '+' : '−') + fmt(Math.abs(d), tk)) + '</td><td class="n ' + cls(d) + '">' + (d == null ? '–' : (d >= 0 ? '+' : '−') + (Math.abs(d) / F0 * 100).toFixed(2) + '%') + '</td><td class="ctx">' + esc(c.ctx) + '</td><td class="n dte">' + esc(c.dte) + (c.flag ? ' <i class="fl ' + c.flag.toLowerCase() + '">' + c.flag + '</i>' : '') + '</td><td><button class="x" data-u="' + e.u + '" title="Remove" aria-label="Remove">&times;</button></td></tr>'; }).join('');
    }
    function buildShell(el) {
        el.innerHTML = '<section class="vt-cf-sec" data-sec="lens"><div class="vt-lens-conv"><b class="t">Strike Lens</b><select id="vt-lens-cb" aria-label="Instrument"></select><input id="vt-lens-ck" type="number" step="any" placeholder="strike" inputmode="decimal" aria-label="Strike"><button id="vt-lens-add" type="button">Convert</button></div>' +
            '<table class="vt-lens-t vt-compact"><thead><tr><th>Strike</th><th class="n">Futures</th><th class="n">Δ pts</th><th class="n">Δ %</th><th>Exposure</th><th class="n">DTE</th><th></th></tr></thead><tbody id="vt-lens-rows"></tbody></table></section>' +
            '<section class="vt-cf-sec" data-sec="insights" hidden></section><section class="vt-cf-sec" data-sec="hedge" hidden></section>';
        const add = () => { const id = el.querySelector('#vt-lens-cb').value, inp = el.querySelector('#vt-lens-ck'); if (L.addConv(id, parseFloat(inp.value))) { inp.value = ''; } };
        el.querySelector('#vt-lens-add').addEventListener('click', add);
        el.querySelector('#vt-lens-cb').addEventListener('change', ev => { L.customBook = ev.target.value; });
        el.querySelector('#vt-lens-ck').addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
        el.querySelector('#vt-lens-rows').addEventListener('click', ev => { const x = ev.target.closest('button.x'); if (x) L.removeConv(+x.dataset.u); });
    }
    function render() {
        const el = document.getElementById('vt-lens'); if (!el) return;
        const on = active(); el.hidden = !on; if (!on) { repaintPanels(); fire(); return; }
        const lens = L.lens, sc = scopeNow(), view = L.view, P = sc.ticker;
        if (!L.picked) { const own = book(P); const first = own && own.convertible ? own : lens.books.find(b => b.convertible); L.picked = new Set(first ? [first.id] : []); }
        if (!el.querySelector('.vt-lens-conv')) buildShell(el);
        const sel = el.querySelector('#vt-lens-cb'), conv = lens.books.filter(b => b.convertible), sig = conv.map(b => b.id).join(',');
        if (sel.dataset.sig !== sig) { const keep = sel.value || L.customBook || P; sel.innerHTML = conv.map(b => '<option value="' + b.id + '">' + disp(b.id) + '</option>').join(''); sel.dataset.sig = sig; sel.value = conv.some(b => b.id === keep) ? keep : (conv[0] || {}).id; }
        el.querySelector('#vt-lens-rows').innerHTML = convRows();
        const gv = view === 'greeks', sec = n => el.querySelector('[data-sec="' + n + '"]');
        sec('lens').hidden = gv; sec('insights').hidden = !gv; sec('hedge').hidden = !gv;   // the strike lens lives on Pricing Surfaces only
        if (gv) { const op = new Map([...el.querySelectorAll('.vt-lc')].map(d => [d.dataset.k, d.open]));   // keep the user's open / closed cards across refreshes
            sec('insights').innerHTML = cardsBlock(); sec('hedge').innerHTML = hedgeBlock(); el.querySelectorAll('.vt-lc').forEach(d => { if (op.has(d.dataset.k)) d.open = op.get(d.dataset.k); }); }
        el.dataset.epoch = L.lens.epoch || '';
        repaintPanels(); fire();
    }
    L.render = render;
    L.setView = v => { if (v === 'pricing' || v === 'greeks') { L.view = v; render(); } };
    window.onStrikeLens = p => { L.lens = parse(p); if (L.picked) { for (const id of [...L.picked]) if (!book(id) || !book(id).convertible) L.picked.delete(id); } render(); };
    window.onMultibook = p => { L.mb = parse(p); render(); };
    L.reset = () => { L.lens = null; L.mb = null; L.picked = null; L.showFut = false; render(); };
    window.VT_LENS = L;
    window.addEventListener('DOMContentLoaded', () => { if (window.VT_SCOPE) { let last = ''; VT_SCOPE.onChange(sc => { const k = sc.mode + '|' + sc.family + '|' + sc.ticker; if (k !== last) { last = k; if (sc.mode === 'single') render(); else L.reset(); } else render(); }); } });
})();
