# Vol H0
All numbers in the UI come from the C++ models; the UI draws and never recomputes. Order-flow layers (L2 depth, tape, bid/ask size, candles) are
**labelled mock/example data** until the order-flow API is connected.

## Run it (GitHub Codespaces / any machine) - every model with synthetic data
Open the repo in a Codespace: `.devcontainer/devcontainer.json` starts `tools/serve_demo.py` on port 8080 and the forwarded port opens in the browser automatically (Ports tab -> "Vol Structure terminal"). Locally: `python3 tools/serve_demo.py` then open http://localhost:8080.
The demo server serves the production UI with a feeder (`web/demo/demo.js`) that drives every model from the generated fixtures in `preview/` and keeps them updating: model channels (GEX, DEX, vanna, charm, speed, color, theta, VRP, RND, ...), regime / PCA / t-SNE views, volatility card, pricing surfaces, greeksChannel, Strike Insights / Strike Lens / Hedge Flow, model card, sidebar read, Chart Factors (new model epochs every 4 s, forward projection, live depth stream). Starts in Family NQ; click any ticker (NQ ES GC CL SI YM, SPX...) to switch scope. A "SYNTHETIC DATA - DEMO" badge is always shown. When real data arrives, run the app shell instead of the demo server.

## Pages
| Volatility Analysis | regime model, PCA views, VIX / VXN card |
| Pricing Surfaces | risk pricing, distribution, options-market, fundamental, intraday/weekly structure, cross-asset cascades |
| greeksChannel | Greek surfaces and the cross-book sidebar |
| Chart Factors | candlestick + heatmap chart (all three models), then Strike Insights, Strike Lens, Hedge Flow, sidebar at its side |


## Build and test
    cmake -S . -B build && cmake --build build -j && ctest --test-dir build      # C++ suites, no external dependencies
    tools/check_js.sh                                                            # JS/Python syntax + stream unit tests (fast)
    tools/run_all.sh                                                             # C++ + all UI suites (needs Python Playwright + Chromium)

Single-file build flags used in development: `g++ -std=c++23 -UNDEBUG -I include -I . -Wall -Wextra -Werror`.

### Regenerating fixtures and the preview
    g++ -std=c++23 -O1 -UNDEBUG -I include -I . -DVT_SRC_DIR='"$PWD"' preview/gen_lens_payloads.cpp -o /tmp/gen_lens
    (cd preview && /tmp/gen_lens synthetic_lens_payloads.json)
    python3 preview/make_preview.py          # rerun after any change in web/

