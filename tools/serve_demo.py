#!/usr/bin/env python3
"""Vol Structure demo server: serves web/ (the production UI) with a synthetic-data feeder injected.
   Every model shown in the terminal is driven by the generated fixtures in preview/ (all labelled SYNTHETIC).
   usage: python3 tools/serve_demo.py [--port 8080] [--host 0.0.0.0]"""
import argparse, gzip, mimetypes, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WEB, PRE = ROOT + "/web", ROOT + "/preview"
DATA = {"payloads": "synthetic_payloads", "regime": "synthetic_regime_payloads", "viz": "synthetic_viz_payloads", "viz_mb": "synthetic_viz_payloads_mb", "vol": "synthetic_vol_payload",
        "mbmodel": "synthetic_mbmodel_payload", "scoped": "synthetic_scoped_payload", "lens": "synthetic_lens_payloads"}
class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, body, ctype):
        gz = "gzip" in self.headers.get("Accept-Encoding", "") and len(body) > 2048 and ctype.split(";")[0] in ("application/json", "text/html", "application/javascript", "text/css")
        if gz: body = gzip.compress(body, 5)
        self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Cache-Control", "no-store")
        if gz: self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            h = open(WEB + "/index.html", encoding="utf-8").read()
            h = h.replace("</body>", '<script src="demo/demo.js"></script></body>') if "</body>" in h else h + '<script src="demo/demo.js"></script>'
            return self._send(h.encode(), "text/html; charset=utf-8")
        if p.startswith("/data/") and p.endswith(".json") and p[6:-5] in DATA: return self._send(open(f"{PRE}/{DATA[p[6:-5]]}.json", "rb").read(), "application/json")
        if p == "/favicon.ico": self.send_response(204); self.end_headers(); return
        f = os.path.normpath(WEB + p)
        if f.startswith(WEB + os.sep) and os.path.isfile(f): return self._send(open(f, "rb").read(), (mimetypes.guess_type(f)[0] or "application/octet-stream") + ("; charset=utf-8" if f.endswith((".js", ".css", ".html")) else ""))
        self.send_error(404)
if __name__ == "__main__":
    a = argparse.ArgumentParser(); a.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080))); a.add_argument("--host", default="0.0.0.0"); o = a.parse_args()
    s = ThreadingHTTPServer((o.host, o.port), H); print(f"Vol Structure demo (synthetic data) on http://localhost:{o.port}", flush=True)
    try: s.serve_forever()
    except KeyboardInterrupt: pass
