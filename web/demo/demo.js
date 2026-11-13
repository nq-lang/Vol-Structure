// Demo feeder (served only by tools/serve_demo.py): drives every model in the terminal with SYNTHETIC fixtures, continuously.
(function () {
    const q = (n) => fetch('/data/' + n + '.json').then(r => r.json());
    const call = (fn, ...a) => { try { if (typeof window[fn] === 'function') window[fn](...a); } catch (e) { console.warn('demo', fn, e); } };
    const js = JSON.stringify;
    const badge = document.createElement('div'); badge.style.cssText = 'position:fixed;bottom:8px;right:10px;z-index:99999;color:#ff6b6b;font:700 12px monospace;letter-spacing:2px;background:rgba(0,0,0,.72);padding:3px 12px;border:1px solid #ff6b6b55;border-radius:3px;pointer-events:none';
    badge.textContent = 'SYNTHETIC DATA - DEMO'; document.body.appendChild(badge);
    Promise.all(['payloads', 'regime', 'viz', 'viz_mb', 'vol', 'mbmodel', 'scoped', 'lens'].map(q)).then(([pay, reg, viz, vizmb, vol, card, scoped, lens]) => {
        let scope = null, key = null, epoch = 0, tick = 0;
        const modelFeed = (scale) => pay.model_updates.forEach(pl => call('onModelUpdate', pl._channel || pl.model, js(scale == null || !pl.points ? pl : { ...pl, points: pl.points.map(p => 'value' in p ? { ...p, value: p.value * scale } : p) })));
        // synthetic live epochs: the model trio (multibook + lens + chart) re-published every 4 s with a new shared epoch, +1 market minute, exposures breathing
        const synth = n => { const d = lens[key], c = JSON.parse(js(d.chart)), ep = 'dm' + (n + 4096).toString(16).padStart(14, '0'), m = /(\d\d):(\d\d) ET/.exec(c.as_of); let mins = m ? (+m[1] * 60 + +m[2] + n + 1) : 0; if (mins >= 960) mins = 575 + (n % 20); if (m) c.as_of = c.as_of.replace(/\d\d:\d\d ET/, String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0') + ' ET');
            c.epoch = ep; ((c.field || {}).metrics || []).forEach(mm => (mm.strikes || []).forEach((st, i) => { st.v *= 1 + 0.14 * Math.sin(n * 0.55 + i * 0.37) + 0.05 * Math.sin(n * 1.3 + i); })); (c.levels || []).forEach((lv, i) => { if (typeof lv.exp === 'number') lv.exp *= 1 + 0.1 * Math.sin(n * 0.5 + i); });
            const mb = JSON.parse(js(d.multibook)), ls = JSON.parse(js(d.lens)); mb.epoch = ep; ls.epoch = ep; return [mb, ls, c]; };
        const pickKey = (s) => { if (!s) return 'NQ_family'; const f = s.ticker + '_family'; if (s.mode === 'family' && lens[f]) return f; if (lens[f]) return f; if (s.mode !== 'single' && s.ticker === 'SPX') return 'ES_multi_SPX'; return s.mode === 'single' ? null : 'NQ_family'; };
        // Structural read for the SELECTED ticker, composed from that ticker's own strike-insight cards (own strike space for an index / ETF, futures space for a family). SYNTHETIC like every demo fixture.
        const mkInsight = (d, sc) => {
            const books = d.lens.books.filter(b => b.insight && b.insight.intraday && b.insight.intraday.ok), own = books.find(b => b.id === sc.ticker), b = own || books.find(b => b.convertible) || books[0]; if (!b) return null;
            const H = b.insight.intraday, S = b.insight.swinging, spot0 = b.insight.spot, tk = d.lens.tick || 0.25;
            const px = k => own ? k : (b.convertible ? Math.round((k * b.ratio + b.basis) / tk) * tk : k), spot = px(spot0), dec = spot >= 1000 ? 0 : 2, f = v => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
            const cs = H.cards.filter(c => c.verdict !== 'Weak').slice().sort((a, c) => c.importance - a.importance).slice(0, 4);
            const dir = c => /Support/.test(c.verdict) ? 'long' : /Resistance/.test(c.verdict) ? 'short' : c.strike >= spot0 ? 'long' : 'short', typ = { Magnet: 'magnet', Support: 'rejection', Resistance: 'rejection', Acceleration: 'breakthrough', Pivot: 'pin' };
            const best = {}; cs.forEach(c => { const dd = dir(c); if (!best[dd] || c.p_touch > best[dd].p_touch) best[dd] = c; });
            const lv = cs.map(c => ({ price: px(c.strike), direction: dir(c), conviction: best[dir(c)] === c ? 'highest' : 'normal', type: typ[c.verdict] || 'pin', probability: Math.round(c.p_touch * 100) }));
            const neg = H.net_gamma < 0, flip = H.flip != null && isFinite(H.flip) ? px(H.flip) : null, top = cs[0], near = lv.slice().sort((x, y) => Math.abs(x.price - spot) - Math.abs(y.price - spot))[0];
            const greeks = [...new Set((top ? top.votes : []).filter(v => v.v > 0).map(v => v.greek))], ex = v => (v < 0 ? '-' : '+') + '$' + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + 'B' : (Math.abs(v) / 1e6).toFixed(0) + 'M');
            return { scope_key: sc.ticker + '|' + sc.mode + '|' + (sc.family || ''), regime: neg ? 'short-gamma / trend' : 'long-gamma / mean-reversion',
                dominant_greek: (greeks.length ? greeks.join(' + ') : 'gamma') + ' - ' + (neg ? 'short gamma ' : 'long gamma ') + ex(H.net_gamma) + ' per 1%, 1-sigma move ' + f(H.em_pct * spot) + ' pts',
                key_levels: (flip != null ? 'gamma flip ~' + f(flip) + '; ' : '') + lv.map(l => f(l.price) + ' (' + l.type + ', ' + l.probability + '% touch)').join('; '),
                scenario: (neg ? 'dealers sell dips and buy rallies, so a break of ' + (near ? f(near.price) : 'the nearest level') + ' extends' : 'dealers sell rallies and buy dips, so price is pulled toward ' + (near ? f(near.price) : 'the nearest level') + ' and moves damp') + (flip != null ? '; the regime changes if price crosses the ' + f(flip) + ' flip' : ''),
                invalidation: (top ? 'the top level ' + f(px(top.strike)) + ' failing on its first touch' : 'the nearest level failing') + (flip != null ? ', or a sustained move through ' + f(flip) : '') + ', would invalidate this read',
                multi_day_context: S && S.ok ? 'multi-day net gamma ' + ex(S.net_gamma) + ' over ' + S.expiries.map(e => e.dte + 'D').join(' / ') + ' - ' + ((S.net_gamma < 0) === neg ? 'consistent with' : 'in conflict with') + ' the intraday read' : '',
                named_patterns_active: [], key_levels_structured: lv };
        };
        const startKey = () => {
            key = pickKey(scope); epoch = 0;
            if (!key) return; const d = lens[key], H = d.history || [], n0 = H.length;
            for (let i = 0; i < n0; i++) call('onChartFactors', typeof H[i] === 'string' ? H[i] : js(H[i])); epoch = n0;
            call('onMultibook', js(d.multibook)); call('onStrikeLens', js(d.lens)); call('onChartFactors', js(d.chart)); call('onMultibookModel', js(card)); call('onScopedInsight', js(d.scope && d.scope.mode === 'family' ? scoped.family : scoped.single));
            const ins = mkInsight(d, scope); if (ins) call('onInsightUpdate', js(ins));
        };
        window.vtSetUnderlying = () => { };
        window.vtSetScope = s => { try { scope = JSON.parse(s); } catch (e) { return; } modelFeed(); startKey(); };
        // initial: model channels, regime / PCA / viz, volatility card, then the Family NQ scope (lens + multibook + chart factors + sidebar + model card)
        modelFeed(); call('onRegimeStatic', js(reg.static)); call('onRegimeLive', js(reg.live)); call('onRegimeViz', js(viz.static)); viz.live.forEach(l => call('onRegimeVizLive', js(l.viz))); call('onVolatility', js(vol));
        if (window.VT_SCOPE) { scope = { mode: 'family', ticker: 'NQ', family: 'NQ' }; window.VT_SCOPE.apply('NQ', 'family', 'NQ'); } else startKey();
        // a ticker change clears the projection views; re-deliver the regime projection data so 2D / t-SNE modes are populated
        call('onRegimeViz', js(viz.static)); viz.live.forEach(l => call('onRegimeVizLive', js(l.viz)));
        // continuous updates: every 3 s model values drift, regime/PCA live ticks cycle, and every 4th tick the chart receives its next model epoch (loops when the fixture is exhausted)
        setInterval(() => {
            tick++; modelFeed(1 + 0.08 * Math.sin(tick / 3) + 0.03 * Math.sin(tick * 1.7)); const l = viz.live[tick % viz.live.length]; call('onRegimeVizLive', js(l.viz)); call('onRegimeLive', js(reg.live));
        }, 3000);
        setInterval(() => { if (!key) return; epoch++; if (epoch > 300) return startKey(); const [mb, ls, c] = synth(epoch); call('onMultibook', js(mb)); call('onStrikeLens', js(ls)); call('onChartFactors', js(c)); }, 4000);
    }).catch(e => { badge.textContent = 'DEMO DATA FAILED TO LOAD: ' + e; });
})();
