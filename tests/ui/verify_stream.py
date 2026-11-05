import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# WebGL2 renderer parity + streaming depth layer: GL vs CPU colours, ring upload, frame time under high update rates.
import sys, json; sys.path.insert(0, VT_ROOT + "/tests/ui")
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open(VT_ROOT + "/preview/synthetic_lens_payloads.json")); F = []
def chk(c, m):
    if not c: F.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1700, "height": 1100}, device_scale_factor=1).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    shots.open_page(pg) if hasattr(shots, "open_page") else pg.goto("file://" + VT_ROOT + "/preview/preview.html")
    d = LP["NQ_family"]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,s.mode==='family'?'family':'multi_book',s.family)", [d["scope"]])
    for fn, k in (("onMultibook", "multibook"), ("onStrikeLens", "lens"), ("onChartFactors", "chart")): pg.evaluate(f"(j)=>window.{fn}(j)", json.dumps(d[k]))
    pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(600)
    gl = pg.evaluate("(()=>{VT_CF.state.set.renderer='webgl';VT_CF.draw();return VT_CF.usedGL()})()")
    chk(gl, "WebGL2 renderer active (auto)")
    soft = pg.evaluate("(()=>{const g=VT_CF.state.gl.gl,e=g.getExtension('WEBGL_debug_renderer_info');const r=e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'';return /swiftshader|llvmpipe|software/i.test(r)})()"); print("software GL rasteriser:", soft)
    # parity: the same cells, GL vs canvas2D (CPU colours of the same raw matrix)
    r = pg.evaluate("""()=>{const S=VT_CF.state;S.set.renderer='webgl';VT_CF.draw();const g=VT_CF.geom(),gr=VT_CF.grid(),ti=VT_CF.texInfo();const cv=document.getElementById('vt-cf-cv'),dpr=window.devicePixelRatio||1;
        const x=cv.getContext('2d'),img=x.getImageData(0,0,cv.width,cv.height);const A=img.data.slice();
        S.set.renderer='canvas2d';VT_CF.draw();const B=x.getImageData(0,0,cv.width,cv.height).data;let n=0,bad=0,mx=0;
        const x0=Math.floor(g.x0*dpr)+2,x1=Math.floor(g.x1*dpr)-2,y0=Math.floor(g.y0*dpr)+2,y1=Math.floor((g.y0+g.ph)*dpr)-2;
        for(let y=y0;y<y1;y+=3)for(let xx=x0;xx<x1;xx+=3){const o=(y*cv.width+xx)*4;let d=0;for(let k=0;k<3;k++)d=Math.max(d,Math.abs(A[o+k]-B[o+k]));n++;if(d>10)bad++;mx=Math.max(mx,d);}
        S.set.renderer='auto';return {n,bad,mx,gl:VT_CF.usedGL()}}""")
    print("parity", r); chk(r["n"] > 1000 and r["bad"] / r["n"] < 0.02, f"GL vs canvas2D pixel parity {r}")
    # liquidity layer parity: GL ring-texture shader vs CPU twin on the same ring state (stream paused)
    lp = pg.evaluate('''()=>{const S=VT_CF.state;S.liq=null;VT_CF.liqStart({rate:20000});S.layers.liq=true;S.layers.heat=false;S.liq.run=false;const cv=document.getElementById('vt-cf-cv'),x=cv.getContext('2d'),g0=()=>VT_CF.geom();
      S.set.renderer='webgl';VT_CF.draw();const gl=S.liq.path;const A=x.getImageData(0,0,cv.width,cv.height).data.slice();S.set.renderer='canvas2d';VT_CF.draw();const cp=S.liq.path;const B=x.getImageData(0,0,cv.width,cv.height).data;
      const g=g0();let n=0,bad=0,lit=0;for(let y=Math.floor(g.y0)+14;y<g.y0+g.ph-2;y+=2)for(let xx=Math.floor(g.x0)+2;xx<g.x1-2;xx+=2){const o=(y*cv.width+xx)*4;let d=0;for(let k=0;k<3;k++)d=Math.max(d,Math.abs(A[o+k]-B[o+k]));n++;if(d>24)bad++;if(B[o]+B[o+1]>120)lit++;}
      S.set.renderer='auto';S.layers.heat=true;S.liq.run=true;return {gl,cp,n,bad,lit}}''')
    print("liq parity", lp); chk(lp["gl"] == "gl" and lp["cp"] == "cpu", f"liquidity paths exercised {lp}"); chk(lp["lit"] > 300 and lp["bad"] / lp["n"] < 0.03, f"liquidity GL vs CPU parity {lp}")
    # streaming: ring + GPU upload at several update rates; frame time through the real draw path
    for rate in (5000, 100000, 500000):
        s = pg.evaluate("""(rate)=>{const S=VT_CF.state;S.liq=null;VT_CF.liqStart({rate});S.layers.liq=true;let mx=0,sum=0,n=0;const L=S.liq;let pump=0,gls=0,hg=0;for(let i=0;i<120;i++){const t0=performance.now();VT_CF.liqPump(16);const t1=performance.now();VT_CF.draw();const d=performance.now()-t0;pump+=t1-t0;gls+=L.ft;hg+=(VT_CF.state.glMs||0);sum+=d;n++;if(i>5)mx=Math.max(mx,d);}
            const R=L.ring;return {avg:sum/n,max:mx,pumpMs:pump/n,liqDrawMs:gls/n,heatGlMs:hg/n,cpuMs:(sum-gls-hg)/n,upd:L.upd,cur:R.cur,gl:!!L.gl&&!L.gl.lost,uploads:L.gl?L.gl.uploads:0,bytes:L.gl?L.gl.bytes:0,skipped:R.skipped,gaps:R.gaps,H:L.scale.H}}""", rate)
        print("stream", rate, s); chk(s["gl"] and s["upd"] >= rate * 0.016 * 100, f"stream {rate}: GL active and updates ingested {s}"); chk(s["pumpMs"] < 8, f"stream {rate}: ingest {s['pumpMs']:.1f} ms/frame"); chk(s["cpuMs"] < 12, f"stream {rate}: non-GL frame cost {s['cpuMs']:.1f} ms"); chk(soft or s["avg"] < 16, f"stream {rate}: avg frame {s['avg']:.1f} ms (GPU)"); chk(soft or s["max"] < 33, f"stream {rate}: max frame {s['max']:.1f} ms (GPU)")
        chk(s["H"] > 0, f"stream {rate}: adaptive scale initialised")
    # real rAF cadence under load (what a user sees): p95 frame interval must stay within 60 fps budget (+ jitter), draw cost small
    for rate in (20000, 500000):
        q = pg.evaluate("(rate)=>new Promise(res=>{const S=VT_CF.state;S.set.renderer='auto';S.liq=null;VT_CF.liqStart({rate});S.layers.liq=true;const d=[];let last=performance.now(),n=0;const f=()=>{const now=performance.now();d.push(now-last);last=now;if(++n<240)requestAnimationFrame(f);else{d.shift();d.sort((a,b)=>a-b);res({p50:d[120],p95:d[Math.floor(d.length*.95)],max:d[d.length-1],ft:S.ftAvg,ups:S.liq.ups})}};requestAnimationFrame(f)})", rate)
        print("rAF", rate, q); chk(q["p95"] < 25 and q["ft"] < 8, f"rAF cadence at {rate} upd/s {q}"); chk(q["ups"] > rate * 0.9, f"sustained ingest at {rate} upd/s: {q['ups']:.0f}")
    # layer pixels: liquidity-only shows heat colours in the plot; dealer-only differs
    px = pg.evaluate("""()=>{const S=VT_CF.state;S.layers.heat=false;S.layers.liq=true;VT_CF.draw();const g=VT_CF.geom(),cv=document.getElementById('vt-cf-cv'),x=cv.getContext('2d');const w=Math.floor((g.x1-g.x0)*0.5),h=Math.floor(g.ph),d=x.getImageData(Math.floor(g.x0),Math.floor(g.y0),w,h).data;let lit=0;for(let i=0;i<d.length;i+=4*7)if(d[i]+d[i+1]>120)lit++;S.layers.heat=true;return lit}""")
    print("liquidity-only lit samples", px); chk(px > 200, "liquidity layer renders coloured cells")
    # throughput: pure ring ingest in the browser at 1M upd/s equivalent
    t = pg.evaluate("""()=>{const L=VT_CF.state.liq,f=CFStream.makeFeed({top:L.ring.top,bucket:L.ring.bucket,rows:L.ring.rows,startMid:L.feed.state.mid,seed:9,capacity:1<<19});let n=0;const t0=performance.now();for(let s=0;s<10;s++){const q=f.generate(1e9+s*1000,1e9+(s+1)*1000,400000);L.ring.ingest(q.ts,q.px,q.sz,q.n);n+=q.n;}return n/((performance.now()-t0)/1000)}""")
    print("browser ingest upd/s", round(t)); chk(t > 1e6, f"browser ingest throughput {t:.0f}")
    chk(not errs, f"console errors {errs[:3]}"); b.close()
print("FAILURES:", F if F else "none"); sys.exit(1 if F else 0)
