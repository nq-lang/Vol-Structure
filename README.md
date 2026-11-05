# Volatility Analysis terminal

RTH options-derived structural volatility terminal. C++23 header-only quant core, a JSON bridge, and a vanilla-JS web UI (webview shell).
All numbers in the UI come from the C++ models; the UI draws and never recomputes. Order-flow layers (L2 depth, tape, bid/ask size, candles) are
**labelled mock/example data** until the order-flow API is connected.

## Pages
| Page | What it shows |
|---|---|
| Volatility Analysis | regime model, PCA views, VIX / VXN card |
| Pricing Surfaces | risk pricing, distribution, options-market, fundamental, intraday/weekly structure, cross-asset cascades |
| greeksChannel | Greek surfaces and the cross-book sidebar |
| Chart Factors | candlestick + heatmap chart (all three models), then Strike Insights, Strike Lens, Hedge Flow, sidebar at its side |

## Repository layout
| Path | Contents |
|---|---|
| `include/vt/` | core types, Black-Scholes, linear algebra, PCA, GMM, adapter interfaces |
| `src/core/` | exposure models (GEX, DEX, vanna, charm, ...), regime model, scheduler |
| `src/registry/`, `src/scope/` | book/family registry and scope modes (single / multi-book / family) |
| `src/multibook/` | per-book analytics, aggregation engine, strike insight, session tracking, hedge flow, pricing analysis, shared volatility context |
| `src/chartfactors/` | `chart_snapshot.h`: the model snapshot (levels, strike fields, composite structural metric, outcomes) the chart draws |
| `src/volidx/` | VIX / VXN index handling |
| `src/insight/` | scoped LLM layer and prompt templates (client and adapters not wired yet) |
| `src/bridge/` | JSON payloads to the UI |
| `src/validation/`, `src/tools/` | validation suite, data-source probe |
| `src/app/` | desktop shell and live probe entry points |
| `web/` | `index.html`, `css/`, `js/` (pages, `chartfactors/` renderer + example-data layers) |
| `schema/` | `chart_factors.fbs` schema of the chart snapshot (JSON mirror is what ships today) |
| `config/` | `registry.json` |
| `tests/` | C++ suites; `tests/ui/` Playwright UI suites |
| `preview/` | fixture generators and `make_preview.py` (builds the standalone `preview.html`) |
| `tools/` | `run_all.sh` (full suite), traceability generator, code generators |
| `docs/` | `PROGRESS_LOG.md`, Chart Factors audit / protocol / architecture / traceability, `heatmap-spec-audit.md`, screenshots |

## Build and test
    cmake -S . -B build && cmake --build build -j && ctest --test-dir build      # C++ suites, no external dependencies
    tools/check_js.sh                                                            # JS/Python syntax + stream unit tests (fast)
    tools/run_all.sh                                                             # C++ + all UI suites (needs Python Playwright + Chromium)

Single-file build flags used in development: `g++ -std=c++23 -UNDEBUG -I include -I . -Wall -Wextra -Werror`.

### Regenerating fixtures and the preview
    g++ -std=c++23 -O1 -UNDEBUG -I include -I . -DVT_SRC_DIR='"$PWD"' preview/gen_lens_payloads.cpp -o /tmp/gen_lens
    (cd preview && /tmp/gen_lens synthetic_lens_payloads.json)
    python3 preview/make_preview.py          # rerun after any change in web/

## Chart Factors heatmap
- One heatmap for all three models; metric selector: Structural (default), Net GEX, Vanna, Charm, Vomma, Vega, Delta hedge, Touch prob, Open int., Hedge $/1%.
- One non-linear ramp by exposure magnitude: midnight navy -> royal blue -> dark gold -> light yellow -> bright yellow -> red (OKLab LUT; red only for the top exposures). One fixed colour scale per metric, so the same value is always the same colour; only the past is dimmed, the projection right of "now" keeps full intensity.
- Chips state the expected outcome of an approach (MAGNET / PINNING / REJECTION / AMPLIFIER); right-hand pills name the asset and strike, e.g. `QQQ $516 - NQ $21,678`.
- Forward projection: the zone right of "now" is not a flat copy. C++ emits per-strike factors (`field.metrics[].strikes[].f`, 17 steps of 15 min): dealer gamma re-scaled to the remaining time (BS gamma, near-spot strikes build into the close, wings fade) and the touch chance re-evaluated over the shrinking horizon. The heatmap multiplies the live value by the factor at the column's distance from now, so exposure and positioning re-project with every epoch; `forward zone` setting: project (default) / flat. Applies to Structural and Net GEX; other metrics stay flat.
- Renderers: WebGL2 (`web/js/chartfactors/cf_gl.js`; raw values in an R32F texture, colour ramp as a 1D LUT, scale/gamma/bands as uniforms, so re-scaling never re-uploads data) with an identical canvas2D path. `renderer` setting: auto (GL on real GPUs, CPU on software rasterisers), webgl, canvas2d; context loss falls back automatically.
- Live depth layer ("Live depth (example)" + Depth button): Bookmap-style resting-liquidity matrix at prices (`cf_stream.js`: typed-array ring, per-column max aggregation, carry-forward, gap timeout, late-update merge, adaptive p99.5 scale, dirty-slot GPU uploads). Runs on a mock feed (5k-500k updates/s) until the order-flow API is attached; real feed calls `Ring.ingest(ts, px, sz, n)`. Can be shown alone, or blended with the dealer-flow heatmap.
- Chart: 5-minute vertical borders at clock multiples of 5 min (every 15 min brighter), spacing follows zoom/scroll, no timeframe; volume panel removed (CVD kept).
- Replay GIF: `docs/media/heatmap_replay.gif` (regenerate with `python3 tests/ui/make_heatmap_gif.py`).
- Details and gaps: `docs/heatmap-spec-audit.md`, `docs/chart-factors-*.md`.

## Mock data (kept in the repository)
All data the UI shows today is synthetic and labelled as such; fixtures are generated by the real C++ engine on synthetic chains. See `docs/mock-data.md`.

## Desktop app
1. Vendor `webview.h` into `third_party/webview/`.
2. Implement `your_api_adapters.h` (chain, bars, baselines, regime history) and `your_llm_client.h` in `src/adapters/`.
3. `cmake -S . -B build -DVT_BUILD_APP=ON && cmake --build build`

## Before trusting the regime model
Run `vt_probe` against the live source, then `vt_validate days.csv bars.csv`. The CSV formats are in `src/validation/validate_main.cpp`. All five gates must pass on real data.

## Status and known gaps
See `PROGRESS.md`. Open: live order-flow feed, VIX/VXN history data, real LLM client / adapters / webview wiring, real depth feed into `Ring.ingest`, binary snapshot protocol.
