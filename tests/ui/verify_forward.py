import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# Forward projection: C++ per-strike factors drive the zone right of "now"; continuity at now, flat mode, per-epoch updates, ticker coverage.
import sys, json; sys.path.insert(0, VT_ROOT + "/tests/ui")
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open(VT_ROOT + "/preview/synthetic_lens_payloads.json")); F = []
def chk(c, m):
    if not c: F.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1700, "height": 1100}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
    for key in ("NQ_family", "ES_multi_SPX", "GC_family", "YM_family", "CL_family", "SI_family"):
        d = LP[key]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,s.mode==='family'?'family':'multi_book',s.family)", [d["scope"]])
        for h in d.get("history", [])[:0]: pass
        for k, f in (("multibook", "onMultibook"), ("lens", "onStrikeLens"), ("chart", "onChartFactors")): pg.evaluate(f"(j)=>window.{f}(j)", json.dumps(d[k]))
        pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(300); pg.evaluate("VT_CF.draw()")
        r = pg.evaluate("""()=>{const S=VT_CF.state,c=VT_CF.cur(),g=VT_CF.grid();S.set.fwd='project';const m=c.field.metrics.find(x=>x.id==='struct'&&x.hz==='intraday');if(!m)return null;
            const hasF=m.strikes.every(s=>s.f&&s.f.length===17&&s.f[0]===1)&&m.fwd&&m.fwd.n===17;const big=m.strikes.slice().sort((a,b)=>Math.abs(b.v)-Math.abs(a.v))[0];const row=g.rowOf(big.price);
            const v0=VT_CF.rowVals(c,g,'struct',0)[row],vs=VT_CF.rowVals(c,g,'struct',0.01)[row],v120=VT_CF.rowVals(c,g,'struct',120)[row];S.set.fwd='flat';const vf=VT_CF.rowVals(c,g,'struct',120)[row];S.set.fwd='project';
            const exp=big.f[8];return {hasF,v0,vs,v120,vf,ratio:v120/v0,exp,n:m.strikes.length}}""")
        print(key, r); chk(r and r["hasF"], f"{key}: every strike carries 17 forward factors starting at 1")
        if r: chk(abs(r["vs"] / r["v0"] - 1) < 0.01, f"{key}: no seam at now"); chk(r["vf"] == r["v0"], f"{key}: flat mode reproduces the live state"); chk(abs(r["ratio"] / r["exp"] - 1) < 0.2, f"{key}: row value follows the C++ factor {r}")
    # NQ: forward zone differs from flat in the texture, left of now identical; updates with a new epoch
    d = LP["NQ_family"]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,'family',s.family)", [d["scope"]])
    for h in d["history"][:12]: pg.evaluate("(j)=>window.onChartFactors(j)", json.dumps(h) if not isinstance(h, str) else h)
    for k, f in (("multibook", "onMultibook"), ("lens", "onStrikeLens"), ("chart", "onChartFactors")): pg.evaluate(f"(j)=>window.{f}(j)", json.dumps(d[k]))
    pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(300)
    t = pg.evaluate("""()=>{const S=VT_CF.state;S.set.renderer='canvas2d';const grab=()=>{S.texKey=S.rawKey='';VT_CF.draw();const cv=VT_CF.cpuTex(),i=VT_CF.texInfo(),x=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,nm=VT_CF.nowMin();return {x,w:cv.width,h:cv.height,c0:Math.floor(nm)-i.T0};};
        S.set.fwd='flat';const A=grab();S.set.fwd='project';const B=grab();let past=0,fut=0,far=0;for(let r=0;r<A.h;r++)for(let c=0;c<A.w;c++){const o=(r*A.w+c)*4;let d=0;for(let k=0;k<4;k++)d=Math.max(d,Math.abs(A.x[o+k]-B.x[o+k]));if(d>6){if(c<=A.c0)past++;else fut++;}}
        const ep0=S.shownEpoch;return {past,fut,w:A.w,c0:A.c0,ep0}}""")
    print("texture", t); chk(t["past"] == 0, "history unchanged by the projection setting"); chk(t["fut"] > 20, f"forward zone differs from flat ({t['fut']} cells)")
    f0 = pg.evaluate("()=>{const S=VT_CF.state;S.set.renderer='canvas2d';S.set.fwd='project';S.texKey=S.rawKey='';VT_CF.draw();const cv=VT_CF.cpuTex(),x=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let h=0;for(let i=0;i<x.length;i+=4)h=(h*31+x[i]+x[i+1]*3+x[i+2]*7)>>>0;return h}")
    for h in d["history"][12:14]: pg.evaluate("(j)=>window.onChartFactors(j)", json.dumps(h) if not isinstance(h, str) else h)
    pg.wait_for_timeout(400)
    f1 = pg.evaluate("()=>{const S=VT_CF.state;S.texKey=S.rawKey='';VT_CF.draw();const cv=VT_CF.cpuTex(),x=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let h=0;for(let i=0;i<x.length;i+=4)h=(h*31+x[i]+x[i+1]*3+x[i+2]*7)>>>0;return h}")
    gx = pg.evaluate("""()=>{const S=VT_CF.state;S.set.renderer='canvas2d';VT_CF.draw();const g=VT_CF.geom(),cv=document.getElementById('vt-cf-cv'),dpr=window.devicePixelRatio||1,x=cv.getContext('2d'),y=Math.floor((g.y0+g.ph-4)*dpr);const row=x.getImageData(0,y,cv.width,1).data,px=m=>Math.floor((Math.round(g.xOf(m))+0.5)*dpr)*4,hits=[],bg=[];
        for(let m=Math.ceil(g.v.t0/5)*5;m<g.v.t1-5;m+=5){const a=px(m),c=px(m+2.5);hits.push(row[a]+row[a+1]+row[a+2]);bg.push(row[c]+row[c+1]+row[c+2]);}
        return {VH:g.VH,n:hits.length,bright:hits.filter((v,i)=>v>bg[i]).length}}""")
    print("grid", gx); chk(gx["VH"] == 0, "volume panel removed"); chk(gx["n"] >= 10 and gx["bright"] >= gx["n"] * 0.7, f"5-minute vertical borders drawn {gx}")
    chk(f0 != f1, "forward projection re-computed when a new epoch arrives"); chk(not errs, f"console errors {errs[:2]}"); b.close()
print("FAILURES:", F if F else "none"); sys.exit(1 if F else 0)
