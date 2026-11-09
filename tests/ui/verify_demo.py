import os as _os; VT_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
# Demo server: every page shows data, updates continuously, scope switch re-feeds, no page errors. Starts tools/serve_demo.py itself.
import subprocess, sys, time, re, socket
from playwright.sync_api import sync_playwright
F = []
def chk(c, m):
    if not c: F.append(m)
s = socket.socket(); s.bind(("", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, VT_ROOT + "/tools/serve_demo.py", "--port", str(port)], stdout=subprocess.DEVNULL); time.sleep(1.2)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=_os.environ.get("PW_CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), headless=True, args=["--no-sandbox"])
        pg = b.new_context(viewport={"width": 1700, "height": 1000}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://localhost:{port}/"); pg.wait_for_timeout(5000)
        chk("SYNTHETIC" in pg.inner_text("body"), "synthetic badge shown")
        for page in ["vt-page-main", "vt-page-pricing", "vt-page-greeks", "vt-page-cf"]:
            pg.click(f'[data-page="{page}"]'); pg.wait_for_timeout(900); t = pg.evaluate("document.body.innerText")
            chk(not re.search(r"(?i)awaiting|waiting for data|no data", t) and len(t) > 3000, f"{page}: populated ({len(t)} chars)")
        ca = pg.evaluate("()=>({h:VT_CF.state.hist.length,lay:VT_CF.state.layers})"); chk(ca["h"] >= 8 and ca["lay"]["heat"] and ca["lay"]["can"] and ca["lay"]["ref"], f"chart factors history running, mandatory layers on {ca}")
        h0 = pg.evaluate("VT_CF.state.hist.length"); pg.wait_for_timeout(9000); h1 = pg.evaluate("VT_CF.state.hist.length"); chk(h1 > h0, f"chart epochs advance continuously ({h0}->{h1})")
        pg.click('[data-page="vt-page-main"]'); pg.click('.vt-ticker[data-ticker="GC"]'); pg.wait_for_timeout(2500); pg.click('[data-page="vt-page-cf"]'); pg.wait_for_timeout(1500)
        chk(pg.evaluate("VT_CF.state.hist.length") >= 1 and "GC" in pg.evaluate("document.body.innerText"), "scope switch to GC re-feeds the chart")
        chk(not errs, f"page errors {errs[:3]}"); b.close()
finally: srv.terminate()
print("FAILURES:", F if F else "none"); sys.exit(1 if F else 0)
