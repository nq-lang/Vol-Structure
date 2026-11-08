// Demo feeder (served only by tools/serve_demo.py): drives every model in the terminal with SYNTHETIC fixtures, continuously.
(function () {
    const q = (n) => fetch('/data/' + n + '.json').then(r => r.json());
    const call = (fn, ...a) => { try { if (typeof window[fn] === 'function') window[fn](...a); } catch (e) { console.warn('demo', fn, e); } };
    const js = JSON.stringify;
    const badge = document.createElement('div'); badge.style.cssText = 'position:fixed;bottom:8px;right:10px;z-index:99999;color:#ff6b6b;font:700 12px monospace;letter-spacing:2px;background:rgba(0,0,0,.72);padding:3px 12px;border:1px solid #ff6b6b55;border-radius:3px;pointer-events:none';
    badge.textContent = 'SYNTHETIC DATA - DEMO'; document.body.appendChild(badge);
    Promise.all(['payloads', 'regime', 'viz', 'viz_mb', 'vol', 'mbmodel', 'scoped', 'lens'].map(q)).then(([pay, reg, viz, vizmb, vol, card, scoped, lens]) => {
        let scope = null, key = null, epoch = 0, tick = 0, depthTimer = null;
        const modelFeed = (scale) => pay.model_updates.forEach(pl => call('onModelUpdate', pl._channel || pl.model, js(scale == null || !pl.points ? pl : { ...pl, points: pl.points.map(p => 'value' in p ? { ...p, value: p.value * scale } : p) })));
        // synthetic live epochs: the model trio (multibook + lens + chart) re-published every 4 s with a new shared epoch, +1 market minute, exposures breathing
        const synth = n => { const d = lens[key], c = JSON.parse(js(d.chart)), ep = 'dm' + (n + 4096).toString(16).padStart(14, '0'), m = /(\d\d):(\d\d) ET/.exec(c.as_of); let mins = m ? (+m[1] * 60 + +m[2] + n + 1) : 0; if (mins >= 960) mins = 575 + (n % 20); if (m) c.as_of = c.as_of.replace(/\d\d:\d\d ET/, String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0') + ' ET');
            c.epoch = ep; ((c.field || {}).metrics || []).forEach(mm => (mm.strikes || []).forEach((st, i) => { st.v *= 1 + 0.14 * Math.sin(n * 0.55 + i * 0.37) + 0.05 * Math.sin(n * 1.3 + i); })); (c.levels || []).forEach((lv, i) => { if (typeof lv.exp === 'number') lv.exp *= 1 + 0.1 * Math.sin(n * 0.5 + i); });
            const mb = JSON.parse(js(d.multibook)), ls = JSON.parse(js(d.lens)); mb.epoch = ep; ls.epoch = ep; return [mb, ls, c]; };
        const pickKey = (s) => { if (!s) return 'NQ_family'; const f = s.ticker + '_family'; if (s.mode === 'family' && lens[f]) return f; if (lens[f]) return f; if (s.mode !== 'single' && s.ticker === 'SPX') return 'ES_multi_SPX'; return s.mode === 'single' ? null : 'NQ_family'; };
        const startKey = () => {
            key = pickKey(scope); epoch = 0; clearTimeout(depthTimer); try { if (window.VT_CF && VT_CF.liqStop) { VT_CF.liqStop(); VT_CF.state.liq = null; } } catch (e) { }
            if (!key) return; const d = lens[key], H = d.history || [], n0 = H.length;
            for (let i = 0; i < n0; i++) call('onChartFactors', typeof H[i] === 'string' ? H[i] : js(H[i])); epoch = n0;
            call('onMultibook', js(d.multibook)); call('onStrikeLens', js(d.lens)); call('onChartFactors', js(d.chart)); call('onMultibookModel', js(card)); call('onScopedInsight', js(d.scope && d.scope.mode === 'family' ? scoped.family : scoped.single));
            depthTimer = setTimeout(startDepth, 800);
        };
        const startDepth = () => { try { if (!window.VT_CF || !VT_CF.state.hist.length) return void (depthTimer = setTimeout(startDepth, 800)); const sp = VT_CF.cur().axis.spot; VT_CF.liqStart({ rate: 20000, speed: 15, prefillSec: 3600, prefillUps: 900, midFn: t => { const s = t / 1000; return sp + sp * 0.0016 * Math.sin(s / 900) + sp * 0.0008 * Math.sin(s / 230 + 1) + sp * 0.0003 * Math.sin(s / 53); } }); } catch (e) { console.warn('depth', e); } };
        window.vtSetUnderlying = () => { };
        window.vtSetScope = s => { try { scope = JSON.parse(s); } catch (e) { return; } modelFeed(); startKey(); };
        // initial: model channels, regime / PCA / viz, volatility card, then the Family NQ scope (lens + multibook + chart factors + sidebar + model card)
        modelFeed(); call('onInsightUpdate', js(pay.insight)); call('onRegimeStatic', js(reg.static)); call('onRegimeLive', js(reg.live)); call('onRegimeViz', js(viz.static)); viz.live.forEach(l => call('onRegimeVizLive', js(l.viz))); call('onVolatility', js(vol));
        if (window.VT_SCOPE) { scope = { mode: 'family', ticker: 'NQ', family: 'NQ' }; window.VT_SCOPE.apply('NQ', 'family', 'NQ'); } else startKey();
        // continuous updates: every 3 s model values drift, regime/PCA live ticks cycle, and every 4th tick the chart receives its next model epoch (loops when the fixture is exhausted)
        setInterval(() => {
            tick++; modelFeed(1 + 0.08 * Math.sin(tick / 3) + 0.03 * Math.sin(tick * 1.7)); const l = viz.live[tick % viz.live.length]; call('onRegimeVizLive', js(l.viz)); call('onRegimeLive', js(reg.live));
        }, 3000);
        setInterval(() => { if (!key) return; epoch++; if (epoch > 300) return startKey(); const [mb, ls, c] = synth(epoch); call('onMultibook', js(mb)); call('onStrikeLens', js(ls)); call('onChartFactors', js(c)); }, 4000);
    }).catch(e => { badge.textContent = 'DEMO DATA FAILED TO LOAD: ' + e; });
})();
