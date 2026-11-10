import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# Pricing Surfaces analysis blocks (A-1..A-8): block set, inputs shown, unavailable states, cascade composer, no overflow.
import sys, json; sys.path.insert(0, (VT_ROOT + "/tests/ui"))
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open((VT_ROOT + "/preview/synthetic_lens_payloads.json"))); F = []
def chk(c, m):
    if not c: F.append(m)
def push(pg, key):
    d = LP[key]; pg.evaluate("([s])=>window.VT_SCOPE.apply(s.ticker,s.mode==='family'?'family':'multi_book',s.family)", [d["scope"]])
    pg.evaluate("(j)=>window.onMultibook(j)", json.dumps(d["multibook"])); pg.evaluate("(j)=>window.onStrikeLens(j)", json.dumps(d["lens"]))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=__import__("os").environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    for (W, H, vp, dpr) in [(1700, 1000, "desktop", 1), (390, 844, "mobile", 2)]:
        pg = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=dpr).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
        chk(pg.evaluate("document.getElementById('vt-pa').hidden"), "hidden in Single-Book")
        push(pg, "NQ_family"); pg.click('[data-page="vt-page-pricing"]'); pg.wait_for_timeout(300)
        chk(pg.is_visible("#vt-pa"), "analysis visible on Pricing page in Family")
        heads = pg.eval_on_selector_all("#vt-pa .vt-pa-blk h4", "e=>e.map(x=>x.childNodes[0].textContent.trim())")
        push(pg, "NQ_family"); pg.click('[data-page="vt-page-pricing"]'); pg.wait_for_timeout(300)
        chk(pg.is_visible("#vt-pa"), "analysis visible on Pricing page in Family")
        heads = pg.eval_on_selector_all("#vt-pa .vt-pa-stack h4", "e=>e.map(x=>x.textContent.trim())")
        chk(heads == ["Distribution model", "Intraday structure", "Weekly structure", "Thesis & risk"], f"table order {heads}")
        chk(pg.evaluate("[...document.querySelectorAll('#vt-pa .vt-pa-stack table')].every(t=>/Intraday/.test(t.rows[0].textContent)&&/Swing/.test(t.rows[0].textContent))"), "every table separates Intraday vs Swing")
        t = pg.inner_text("#vt-pa"); chk("Primary" in t and "Invalidation" in t, "thesis table: primary + invalidation")
        chk(pg.evaluate("[...document.querySelectorAll('#vt-pa .vt-pa-stack')].every(s=>/Disagree|Aligned|No conflict|Reinforces|Neutral|conflict/.test(s.textContent))"), "explicit agree/disagree note")
        for gone in ["Options-Market View", "VRP", "RND", "Vol & Risk", "Vol &amp; Risk"]: chk(gone not in t, f"removed: {gone}")
        chk(pg.locator("#vt-pa .vt-pa-hist i").count() > 10, "distribution histogram drawn")
        chk(pg.is_hidden("#vt-sidebar"), "no sidebar on Pricing Surfaces")
        chk(pg.evaluate("document.documentElement.scrollWidth") <= W + 2, "no horizontal page scroll")
        shots.shot(pg, 12, "pricing_analysis", vp); chk(not errs, f"page errors {errs}")
    b.close()
print("FAILURES:", "; ".join(F) if F else "none")
