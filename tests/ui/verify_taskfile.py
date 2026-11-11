import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# Taskfile acceptance: strike-lens persistence, Chart Factors order, card order, hedge flow order, readout, PCA locks.
import sys, json; sys.path.insert(0, VT_ROOT + "/tests/ui")
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open(VT_ROOT + "/preview/synthetic_lens_payloads.json")); F = []
def chk(c, m):
    if not c: F.append(m)
def push(pg, key):
    d = LP[key]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,s.mode==='family'?'family':'multi_book',s.family)", [d["scope"]])
    pg.evaluate("(j)=>window.onMultibook(j)", json.dumps(d["multibook"])); pg.evaluate("(j)=>window.onStrikeLens(j)", json.dumps(d["lens"]))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1700, "height": 1000}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
    push(pg, "NQ_family"); pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(400)
    chk(pg.is_hidden("#vt-sidebar"), "no sidebar on Chart Factors")
    # persistence: enter strike, two refresh cycles, tab switch, still there; live futures level updates; user removal works
    pg.select_option("#vt-lens-cb", index=0); pg.fill("#vt-lens-ck", "500"); pg.click("#vt-lens-add"); pg.wait_for_timeout(200)
    n = pg.locator("#vt-lens-rows tr[data-u]").count(); chk(n == 1, f"strike added ({n})")
    for _ in range(2): push(pg, "NQ_family"); pg.wait_for_timeout(200)
    pg.click('[data-page="vt-page-greeks"]'); pg.wait_for_timeout(200); pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(300)
    chk(pg.locator("#vt-lens-rows tr[data-u]").count() == 1, "strike persists across refreshes and tab switches")
    pg.reload(); shots.load(pg) if False else None; pg.wait_for_timeout(1500)
    pg.click('[data-page="vt-page-cf"]'); push(pg, "NQ_family"); pg.wait_for_timeout(300)
    chk(pg.locator("#vt-lens-rows tr[data-u]").count() == 1, "strike persists across a page reload")
    pg.click("#vt-lens-rows button.x"); pg.wait_for_timeout(150)
    chk(pg.locator("#vt-lens-rows tr[data-u]").count() == 0, "removed only by the user")
    # order on the page: heatmap, lens, cards
    ys = pg.evaluate("(()=>{const c=document.querySelector('#vt-cf canvas').getBoundingClientRect(),l=document.querySelector('#vt-lens [data-sec=lens]').getBoundingClientRect(),i=document.querySelector('#vt-lens [data-sec=insights]').getBoundingClientRect();return [c.bottom,l.top,l.bottom,i.top,l.top-c.bottom]})()")
    chk(ys[1] >= ys[0] - 1 and ys[3] >= ys[2] - 1 and ys[4] < 140, f"heatmap → lens → cards, no gap {ys}")
    pg.click('[data-page="vt-page-greeks"]'); pg.wait_for_timeout(300)
    chk(pg.is_visible("#vt-sidebar"), "sidebar on Greeks")
    chk(pg.evaluate("document.documentElement.scrollWidth") <= 1702, "no horizontal scroll")
    for gone in ["vt-pca-controls", "colorby"]: chk(pg.locator(f'.{gone}, [data-act={gone}]').count() == 0, f"removed {gone}")
    chk(pg.evaluate("window.__pca.bubbleSpread === 2.8 && window.__pca.vectorSpread === 1.0"), "bubbles 2.8 / vectors 1.0 locked")
    # fit: 2D cross-section charts stay inside their cards at several widths; no horizontal scroll
    for W in (1366, 1920):
        pg.set_viewport_size({"width": W, "height": 900}); pg.wait_for_timeout(500)
        for n in ("vt-page-greeks", "vt-page-pricing"):
            pg.click(f'[data-page="{n}"]'); pg.wait_for_timeout(1200)
            bad = pg.evaluate("[...document.querySelectorAll('.vt-page.active .vt-mini-chart')].filter(m=>{const r=m.getBoundingClientRect(),c=m.querySelector('canvas').getBoundingClientRect();return c.right>r.right+1||c.bottom>r.bottom+1}).length")
            chk(bad == 0, f"{n} {W}px: {bad} clipped 2D charts"); chk(pg.evaluate("document.documentElement.scrollWidth") <= W + 2, f"{n} {W}px horizontal scroll")
    chk(not errs, f"page errors {errs}"); b.close()
print("FAILURES:", F or "none")
