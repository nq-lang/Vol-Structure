import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# Selecting a ticker: the structural read + log clear until a read for THAT ticker arrives (no foreign levels); heatmap shows only the selected index's strikes/levels.
import sys, json; sys.path.insert(0, VT_ROOT + "/tests/ui")
from playwright.sync_api import sync_playwright
import shots
LP = json.load(open(VT_ROOT + "/preview/synthetic_lens_payloads.json")); INS = json.load(open(VT_ROOT + "/preview/synthetic_payloads.json"))["insight"]; F = []
def chk(c, m):
    if not c: F.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1500, "height": 1000}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); shots.load(pg)
    chk(pg.locator("#vt-insight-current .vt-lvl-chips, #vt-insight-current .vt-insight-card").count() >= 1 and "Regime:" not in pg.inner_text("#vt-insight-current"), "read shown, no 'Regime:' heading")
    d = LP["NQ_family"]
    pg.evaluate("window.VT_SCOPE.apply('NDX','multi_book','NQ')"); pg.wait_for_timeout(200)
    t = pg.inner_text("#vt-insight-current"); chk("Waiting" in t and pg.locator("#vt-insight-current .vt-lvl-hl, #vt-insight-current .vt-lvl-eq").count() == 0, f"read cleared on ticker change: {t[:80]!r}")
    chk(pg.evaluate("document.getElementById('vt-insight-log').children.length") == 0, "log cleared on ticker change")
    pg.evaluate("(j)=>window.onMultibook(j)", json.dumps(d["multibook"])); pg.evaluate("(j)=>window.onStrikeLens(j)", json.dumps(d["lens"]))
    pg.evaluate("(j)=>window.onInsightUpdate(j)", json.dumps({**INS, "scope_key": "OTHER|single|"})); chk("Waiting" in pg.inner_text("#vt-insight-current"), "a read stamped for another scope is dropped")
    pg.evaluate("(j)=>window.onChartFactors(j)", json.dumps(d["chart"])); pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(500)
    bk = pg.evaluate("[...new Set(VT_CF.state.chart.field.metrics.flatMap(m=>m.strikes.map(s=>s.book)))]"); chk(bk == ["NDX"], f"heatmap strikes only NDX {bk}")
    lb = pg.evaluate("[...new Set(VT_CF.state.chart.levels.flatMap(l=>l.books||[]))]"); chk(all(x == "NDX" for x in lb), f"levels only NDX {lb}")
    pg.evaluate("window.VT_SCOPE.apply('NQ','family','NQ')"); pg.evaluate("(j)=>window.onChartFactors(j)", json.dumps(d["chart"])); pg.wait_for_timeout(300)
    bk = pg.evaluate("[...new Set(VT_CF.state.chart.field.metrics.flatMap(m=>m.strikes.map(s=>s.book)))]"); chk(len(bk) > 1, f"family selection keeps all books {bk}")
    chk(not errs, f"errors {errs}"); b.close()
print("FAILURES:", F or "none")
