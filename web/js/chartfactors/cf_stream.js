// cf_stream.js - streaming liquidity engine for the Chart Factors heatmap (DOM-free; unit-tested in node: tests/js/test_stream.js).
//
//  Ring        column-major ring matrix of RAW resting-size values (rows = price buckets, columns = fixed wall-clock time slices).
//              ingest() applies updates with no per-update allocation: row bucket = floor((top-px)/bucket); column = floor(t/colMs).
//              Aggregation inside a column = MAX (short peaks survive); the closing state carries forward into the next column (long streaks);
//              gaps longer than gapMs are NOT carried (empty columns, book cleared). Late updates are merged (max) into their historical column.
//              Dirty columns are tracked as one absolute range so the GPU upload is one or two contiguous texSubImage2D calls per frame.
//  AdaptiveScale  spec 4.5: H = p99.5 of the visible non-zero cells, L = max(p30, noise*H); asymmetric EMA (fast rise, slow decay) + hysteresis.
//  makeFeed    MOCK depth feed (labelled EXAMPLE in the UI): persistent resting orders with refills / cancels / walls, any rate (updates per second).
//
// Nothing here reads a model number; when the real order-flow API exists it replaces makeFeed and calls Ring.ingest with the same typed arrays.
(function (root) {
    function Ring(o) {
        this.rows = o.rows | 0; this.nCols = o.nCols | 0; this.colMs = o.colMs; this.top = o.top; this.bucket = o.bucket; this.gapMs = o.gapMs == null ? 10000 : o.gapMs;
        this.data = new Float32Array(this.rows * this.nCols); this.book = new Float32Array(this.rows); this.live = new Float32Array(this.rows); this.zero = new Float32Array(this.rows);
        this.cur = -1; this.minAbs = 0; this.dLo = Infinity; this.dHi = -1; this.n = 0; this.skipped = 0; this.late = 0; this.commits = 0; this.gaps = 0; this.lastT = 0; this.lastUpd = -1;
    }
    Ring.prototype._mark = function (a) { if (a < this.dLo) this.dLo = a; if (a > this.dHi) this.dHi = a; };
    Ring.prototype._write = function (a, arr) { this.data.set(arr, (a % this.nCols) * this.rows); this._mark(a); };
    Ring.prototype._advance = function (a) {
        if (this.cur < 0) { this.cur = a; this.minAbs = a; this.lastUpd = a; return; }
        this._write(this.cur, this.live);                                   // commit (frozen from now on)
        const span = a - this.cur;
        if (span > this.nCols) { this.data.fill(0); this.dLo = Math.max(0, a - this.nCols + 1); this.dHi = a; this.book.fill(0); this.minAbs = a; this.gaps++; }
        else { const lim = Math.floor(this.gapMs / this.colMs); for (let k = this.cur + 1; k < a; k++) this._write(k, k - this.lastUpd <= lim ? this.book : this.zero); if (a - this.lastUpd > lim && this.book.some(x => x > 0)) { this.book.fill(0); this.gaps++; } }
        this.live.set(this.book); this.cur = a; this.commits++;
    };
    // ts: Float64Array ms, px: Float64Array prices, sz: Float32Array sizes (0 = level removed); first n entries are used
    Ring.prototype.ingest = function (ts, px, sz, n) {
        const colMs = this.colMs, top = this.top, inv = 1 / this.bucket, rows = this.rows, live = this.live, book = this.book, nC = this.nCols;
        for (let i = 0; i < n; i++) {
            const p = px[i]; if (!(p <= top)) { this.skipped++; continue; } const row = ((top - p) * inv) | 0; if (row >= rows) { this.skipped++; continue; }
            const a = Math.floor(ts[i] / colMs), v = sz[i];
            if (a !== this.cur) { if (this.cur < 0 || a > this.cur) this._advance(a); else { if (a <= this.cur - nC) { this.skipped++; continue; } const off = (a % nC) * rows + row; if (v > this.data[off]) this.data[off] = v; this._mark(a); this.late++; continue; } }
            book[row] = v; if (v > live[row]) live[row] = v; this.lastUpd = a;
        }
        this.n += n; if (n) this.lastT = ts[n - 1]; if (this.cur >= 0) this._write(this.cur, live);   // the forming column is visible immediately
    };
    // advance wall-clock without data (keeps carrying / emits gaps)
    Ring.prototype.tick = function (tMs) { const a = Math.floor(tMs / this.colMs); if (this.cur >= 0 && a > this.cur) { this._advance(a); this._write(this.cur, this.live); } };
    Ring.prototype.absMin = function () { return this.cur < 0 ? 0 : Math.max(this.minAbs, this.cur - this.nCols + 1); };
    // contiguous slot runs that need uploading since the last call: [[slotStart, count], ...]
    Ring.prototype.takeDirty = function () {
        if (this.dHi < 0) return []; const lo = this.dLo, hi = this.dHi, nC = this.nCols; this.dLo = Infinity; this.dHi = -1;
        if (hi - lo + 1 >= nC) return [[0, nC]]; const s0 = lo % nC, s1 = hi % nC; return s0 <= s1 ? [[s0, s1 - s0 + 1]] : [[s0, nC - s0], [0, s1 + 1]];
    };
    Ring.prototype.markAllDirty = function () { if (this.cur >= 0) { this.dLo = this.absMin(); this.dHi = this.cur; } };
    // shift the price window so `newTop` becomes the top edge (keeps history, never degrades recent data)
    Ring.prototype.recenter = function (newTop) {
        const d = Math.round((newTop - this.top) / this.bucket); if (!d) return; const R = this.rows, nC = this.nCols, sh = (arr, base) => { const tmp = new Float32Array(R); for (let r = 0; r < R; r++) { const s = r + d; tmp[r] = s >= 0 && s < R ? arr[base + s] : 0; } arr.set(tmp, base); };
        // top increases by d buckets => row r now corresponds to old row r - d
        const dd = -d; const move = (arr, base) => { const tmp = new Float32Array(R); for (let r = 0; r < R; r++) { const s = r + dd; tmp[r] = s >= 0 && s < R ? arr[base + s] : 0; } arr.set(tmp, base); }; void sh;
        for (let c = 0; c < nC; c++) move(this.data, c * R); move(this.book, 0); move(this.live, 0); this.top += d * this.bucket; this.markAllDirty();
    };
    Ring.prototype.rowOf = function (px) { return Math.floor((this.top - px) / this.bucket); };
    Ring.prototype.priceOf = function (row) { return this.top - (row + 0.5) * this.bucket; };
    Ring.prototype.at = function (a, row) { return this.data[(a % this.nCols) * this.rows + row]; };
    // random sample of non-zero visible cells (for the adaptive scale): columns a0..a1, rows r0..r1
    Ring.prototype.sample = function (a0, a1, r0, r1, out, rng) {
        a0 = Math.max(a0, this.absMin()); a1 = Math.min(a1, this.cur); r0 = Math.max(0, r0); r1 = Math.min(this.rows - 1, r1); let k = 0; if (a1 < a0 || r1 < r0) return 0;
        const na = a1 - a0 + 1, nr = r1 - r0 + 1, cap = out.length; for (let i = 0; i < cap * 3 && k < cap; i++) { const v = this.data[((a0 + (rng() * na | 0)) % this.nCols) * this.rows + r0 + (rng() * nr | 0)]; if (v > 0) out[k++] = v; } return k;
    };

    function AdaptiveScale(o) { o = o || {}; this.pHigh = o.pHigh || 99.5; this.noise = o.noise == null ? 0.05 : o.noise; this.rise = o.rise || 1; this.decay = o.decay || 8; this.hyst = o.hyst || 0.02; this.H = 0; this.L = 0; this.t = -1e9; this.floor = o.floor || 1e-9; this.buf = new Float32Array(o.samples || 8000); this.lock = false; this.seed = 12345; }
    AdaptiveScale.prototype.rng = function () { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; };
    // returns true when H or L moved
    AdaptiveScale.prototype.update = function (ring, a0, a1, r0, r1, nowS) {
        if (this.lock && this.H > 0) return false; if (nowS - this.t < 0.25) return false; const dt = Math.max(0, nowS - this.t); this.t = nowS;
        const k = ring.sample(a0, a1, r0, r1, this.buf, () => this.rng()); if (k < 8) return false; const v = this.buf.subarray(0, k).slice().sort(); const q = p => v[Math.min(k - 1, Math.floor(p / 100 * (k - 1) + 0.5))];
        const Ht = Math.max(q(this.pHigh), this.floor), Lt = Math.max(q(30), this.noise * Ht);
        if (!(this.H > 0)) { this.H = Ht; this.L = Math.min(Lt, 0.9 * Ht); return true; }
        const tau = Ht > this.H ? this.rise : this.decay, a = 1 - Math.exp(-dt / Math.max(0.05, tau)), nh = this.H + (Ht - this.H) * a, nl = this.L + (Lt - this.L) * a;
        if (Math.abs(nh - this.H) / this.H > this.hyst || Math.abs(nl - this.L) / Math.max(this.L, 1e-12) > this.hyst) { this.H = nh; this.L = Math.min(nl, 0.9 * nh); return true; } return false;
    };

    // ---- MOCK depth feed -------------------------------------------------------------------------------------------------------------
    // makeFeed({top,bucket,rows,seed,capacity,midFn?,vol,startMid}) -> { generate(t0Ms,t1Ms,n)->{n,mid,ts,px,sz}, bufs }
    function makeFeed(o) {
        let s = (o.seed || 7) >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const cap = o.capacity || 1 << 20, ts = new Float64Array(cap), px = new Float64Array(cap), sz = new Float32Array(cap), rows = o.rows, size = new Float32Array(rows);
        const st = { mid: o.startMid, vol: o.vol || o.bucket * 0.05 }; const wallStep = Math.max(1, Math.round(5)); const spread = o.spreadRows || 7;
        function generate(t0, t1, n) {
            n = Math.min(n | 0, cap); const dt = (t1 - t0) / 1000, mid0 = o.midFn ? o.midFn(t0) : st.mid, mid1 = o.midFn ? o.midFn(t1) : st.mid + (rnd() + rnd() + rnd() - 1.5) * st.vol * Math.sqrt(Math.max(dt, 1e-3)) * 6;
            for (let i = 0; i < n; i++) {
                const f = (i + rnd()) / n, t = t0 + f * (t1 - t0), mid = mid0 + (mid1 - mid0) * f, rm = ((o.top - mid) / o.bucket) | 0; ts[i] = t;
                let d = Math.floor(-Math.log(1 - rnd()) * spread) + 1; if (rnd() < 0.5) d = -d; let r = rm + d;
                if (rnd() < 0.05) { r = rm + ((rnd() * 80 - 40) | 0); r -= ((r % wallStep) + wallStep) % wallStep; }              // round-number walls
                if (r < 0) r = 0; else if (r >= rows) r = rows - 1; const wall = r % wallStep === 0, prev = size[r], base = (220 * Math.exp(-Math.abs(r - rm) / 14) + 18) * (wall ? 6 : 1);
                const u = rnd(); let v; if (u < 0.10) v = 0; else if (prev > 0 && u < 0.88) v = prev * (0.88 + 0.24 * rnd()); else v = base * (0.4 + 1.6 * rnd());
                size[r] = v; px[i] = o.top - (r + 0.5) * o.bucket; sz[i] = v;
            }
            st.mid = mid1; return { n, mid: mid1, ts, px, sz };
        }
        return { generate, state: st, bufs: { ts, px, sz }, rnd };
    }
    root.CFStream = { Ring, AdaptiveScale, makeFeed };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CFStream;
})(typeof window !== 'undefined' ? window : globalThis);
