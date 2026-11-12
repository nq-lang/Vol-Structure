#!/usr/bin/env python3
"""Start the demo server and wait until the forwarded web app is ready."""
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
PORT = 8080
URL = f"http://127.0.0.1:{PORT}"
LOG = Path("/tmp/vol-structure-demo.log")


def app_is_ready():
    try:
        with urlopen(URL, timeout=1) as response:
            page = response.read().decode("utf-8")
        if response.status != 200 or "demo/demo.js" not in page:
            return False
        with urlopen(f"{URL}/demo/demo.js", timeout=1) as response:
            return response.status == 200 and bool(response.read(1))
    except (OSError, URLError):
        return False


def log_tail():
    if not LOG.exists():
        return ""
    return "\n".join(LOG.read_text(errors="replace").splitlines()[-20:])


def main():
    if app_is_ready():
        print(f"Vol Structure demo is already serving on port {PORT}.")
        return 0

    with LOG.open("ab") as log:
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "tools" / "serve_demo.py"), "--port", str(PORT)],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if app_is_ready():
            print(f"Vol Structure demo is ready at {URL}.")
            return 0
        if process.poll() is not None:
            break
        time.sleep(0.25)

    if process.poll() is None:
        process.terminate()
        process.wait(timeout=5)

    details = log_tail()
    message = f"Vol Structure demo failed to start on port {PORT}."
    if details:
        message += f"\nServer log ({LOG}):\n{details}"
    print(message, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
