import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# PCA / t-SNE: two tabs only; each shows the interactive 3D (left) beside the flat upright 2D (right); locked params; hover ring + sign colours.
import sys; sys.path.insert(0, VT_ROOT + "/tests/ui")
from playwright.sync_api import sync_playwright
import shots
F = []
def chk(c, m):
    if not c: F.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    for W, H in [(1700, 1000), (1366, 800), (390, 844)]:
        pg = b.new_context(viewport={"width": W, "height": H}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
        pg.wait_for_timeout(600)
        tabs = pg.eval_on_selector_all(".vt-pca-dual .vt-view-tab", "e=>e.map(x=>x.textContent.trim())")
        chk(tabs == ["PCA", "t-SNE"], f"{W}: exactly two tabs {tabs}")
        for m in ["pca", "tsne"]:
            pg.click(f".vt-view-tab[data-m={m}]"); pg.wait_for_timeout(500)
            r = pg.evaluate("""(()=>{const a=document.querySelector('[data-p="3d"]').getBoundingClientRect(),b=document.querySelector('[data-p="2d"]').getBoundingClientRect();
                const nz=c=>{const x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<x.length;i+=40)if(x[i]+x[i+1]+x[i+2]>90)n++;return n};
                const cs=[...document.querySelectorAll('.vt-pca-pane canvas')];return {l:[a.left,a.right,a.top,a.bottom],r:[b.left,b.right,b.top,b.bottom],nz:cs.map(nz),sw:document.documentElement.scrollWidth}})()""")
            if W > 900: chk(r["l"][1] <= r["r"][0] + 1 and abs(r["l"][2] - r["r"][2]) < 2, f"{W}/{m}: 3D left of 2D, same row")
            else: chk(r["l"][3] <= r["r"][2] + 1, f"{W}/{m}: stacked 3D then 2D")
            chk(all(n > 150 for n in r["nz"]), f"{W}/{m}: both panes drawn {r['nz']}"); chk(r["sw"] <= W + 2, f"{W}/{m}: no horizontal scroll")
        chk(pg.locator(".vt-pca-dual [data-act=colorby], .vt-pca-controls, [data-act=flatten]").count() == 0, f"{W}: no Color-by / sliders / flatten")
        chk(pg.evaluate("window.__pca.bubbleSpread === 2.8 && window.__pca.vectorSpread === 1.0"), f"{W}: locked 2.8 / 1.0")
        if W == 1700:
            # 3D rotates, 2D never tilts (drag pans)
            pg.click(".vt-view-tab[data-m=pca]"); pg.wait_for_timeout(300)
            y0 = pg.evaluate("window.__pca.cam.yaw"); bb = pg.locator('[data-p="3d"] canvas').bounding_box()
            pg.mouse.move(bb["x"] + 300, bb["y"] + 300); pg.mouse.down(); pg.mouse.move(bb["x"] + 380, bb["y"] + 320, steps=4); pg.mouse.up(); pg.wait_for_timeout(150)
            chk(pg.evaluate("window.__pca.cam.yaw") != y0, "3D pane rotates on drag")
            # hover a point: tooltip + ring state, sign colours
            pt = pg.evaluate("(()=>{const P=window.__pca;P._draw2();const h=P._hit2.find(x=>x.kind==='pt');const r=P.c2.getBoundingClientRect();return [r.left+h.sx,r.top+h.sy]})()")
            pg.mouse.move(pt[0], pt[1]); pg.wait_for_timeout(200)
            chk(pg.evaluate("window.__pca.hover >= 0 && getComputedStyle(document.querySelector('.vt-pca-tip')).display !== 'none'"), "hover shows readout and links the point in both panes")
            chk(pg.locator(".vt-pca-tip b[style*='#']").count() >= 1, "tooltip values carry sign colour")
        chk(not errs, f"{W}: page errors {errs}")
    b.close()
print("FAILURES:", F or "none")
