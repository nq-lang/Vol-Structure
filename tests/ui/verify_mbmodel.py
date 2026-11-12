import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# multibook_v1 UI: model card (Multi-Book/Family only), arrows + variable rows colour-grouped by source (anchor vs cross-book block).
import sys, json; sys.path.insert(0, (VT_ROOT + "/tests/ui"))
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open((VT_ROOT + "/preview/synthetic_lens_payloads.json"))); CARD = json.load(open((VT_ROOT + "/preview/synthetic_mbmodel_payload.json"))); VZ = json.load(open((VT_ROOT + "/preview/synthetic_viz_payloads_mb.json")))
F = []
def chk(c, m):
    if not c: F.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=__import__("os").environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    for (W, H, vp, dpr) in [(1700, 1000, "desktop", 1), (390, 844, "mobile", 2)]:
        pg = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=dpr).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
        pg.evaluate("(j)=>window.onMultibookModel(j)", json.dumps(CARD)); chk(pg.evaluate("document.getElementById('vt-mcard-btn').hidden"), "no model card in Single-Book")
        d = LP["NQ_family"]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,'family',s.family)", [d["scope"]]); pg.wait_for_timeout(200)
        chk(not pg.evaluate("document.getElementById('vt-mcard-btn').hidden"), "model card button in Family scope")
        pg.click("#vt-mcard-btn"); pg.wait_for_timeout(200); t = pg.inner_text("#vt-mcard")
        for k in ["multibook_v1", "Walk-forward", "single_v1", "Known limits", "not imputed", "MOCK DATA", "Low explained variance"]: chk(k.lower() in t.lower(), f"card has {k}")
        chk(pg.locator("#vt-mcard .chip.x").count() == 7 and pg.locator("#vt-mcard .chip").count() == 24, "7 cross-book + 17 anchor input chips")
        shots.shot(pg, 7, "NQ_family_model_card", vp); pg.click("#vt-mcard .close"); chk(pg.evaluate("document.getElementById('vt-mcard').hidden"), "card closes")
        # grouped arrows
        pg.evaluate("(j)=>window.onRegimeViz(j)", json.dumps(VZ["static"])); pg.evaluate("document.querySelector('.vt-view-tab[data-m=pca]').click()"); pg.wait_for_timeout(900)
        n = pg.evaluate("(window.__pca._draw2(), window.__pca._hit2.filter(h=>h.kind==='feat').length)"); chk(n == 24, f"24 arrows drawn in 2D ({n})")
        chk(pg.evaluate("window.__pca._geo().arrows.filter(a=>a.g==='cross_book').length") == 7, "7 cross-book arrows (teal)")
        teal = pg.evaluate("""()=>{const c=window.__pca.c2,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let t=0;for(let i=0;i<d.length;i+=4){if(d[i+3]>40&&d[i+1]>150&&d[i]<120&&d[i+2]>130)t++}return t}""")
        chk(teal > 30, f"teal cross-book arrow pixels {teal}")
        shots.shot(pg, 7, "NQ_family_pca2d_grouped_arrows", vp, locator=".vt-pca-biplot-wrap"); chk(not errs, f"errors {errs}")
    b.close()
print("FAILURES:", F or "none")
