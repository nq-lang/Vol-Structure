// cf_gl.js - WebGL2 heat renderer for Chart Factors.
// Raw exposure values (never colours) live in an R32F texture (columns x rows). A fragment shader applies the scale
// t = clamp((|v|*w - L) / (H - L)), t' = t^gamma, optional bands, soft alpha fade-in, and looks the colour up in a 1D LUT texture
// (the same 1024-entry OKLab ramp the canvas2D path uses). Cells are sampled nearest-neighbour; placement is by uniform (origin + cell size),
// so scrolling / easing / re-scaling never re-uploads data. The result is an offscreen canvas that cf_chart.js composites with drawImage.
(function () {
    const VS = '#version 300 es\nprecision highp float;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
    const FS = '#version 300 es\nprecision highp float; precision highp int; precision highp sampler2D;\n' +
        'uniform sampler2D uRaw; uniform sampler2D uLut; uniform vec2 uOrigin; uniform vec2 uCell; uniform ivec2 uSize;\n' +
        'uniform int uRing, uAbsOff, uAbsMin, uAbsMax; uniform float uCurve, uLogK, uAlphaMax; uniform float uH, uL, uGamma, uBands, uBright, uNeg, uDpr, uHpx; out vec4 o;\n' +
        'void main(){\n' +
        '  float xl = gl_FragCoord.x / uDpr; float yl = (uHpx - gl_FragCoord.y) / uDpr;\n' +
        '  int c = int(floor((xl - uOrigin.x) / uCell.x)); int r = int(floor((yl - uOrigin.y) / uCell.y));\n' +
        '  if (r < 0 || r >= uSize.y) { o = vec4(0.0); return; }\n' +
        '  float v;\n' +
        '  if (uRing > 0) { int ac = c + uAbsOff; if (ac < uAbsMin || ac > uAbsMax) { o = vec4(0.0); return; } int slot = ac - (ac / uRing) * uRing; v = texelFetch(uRaw, ivec2(r, slot), 0).r; }\n' +
        '  else { if (c < 0 || c >= uSize.x) { o = vec4(0.0); return; } v = texelFetch(uRaw, ivec2(c, r), 0).r; }\n' +
        '  float a = abs(v) * (v < 0.0 ? uNeg : 1.0);\n' +
        '  if (!(a > 0.0)) { o = vec4(0.0); return; }\n' +
        '  float lo = max(uL, 0.0); float t = clamp((a - lo) / max(uH - lo, uH * 1e-6), 0.0, 1.0); float tp = uCurve > 0.5 ? log(1.0 + uLogK * t) / log(1.0 + uLogK) : pow(t, uGamma);\n' +
        '  if (uBands > 0.0) tp = floor(tp * uBands) / uBands;\n' +
        '  float al = smoothstep(0.0, 0.08, tp) * uAlphaMax; vec3 rgb = min(texture(uLut, vec2((tp * 1023.0 + 0.5) / 1024.0, 0.5)).rgb * uBright, vec3(1.0));\n' +
        '  o = vec4(rgb * al, al);\n}';
    function create() {
        const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
        let gl = null; try { gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
        if (!gl) return null;
        const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        let prog; try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)); } catch (e) { console.warn('cf_gl: ' + e.message); return null; }
        const U = {}; ['uRaw', 'uLut', 'uOrigin', 'uCell', 'uSize', 'uRing', 'uAbsOff', 'uAbsMin', 'uAbsMax', 'uH', 'uL', 'uGamma', 'uBands', 'uCurve', 'uLogK', 'uAlphaMax', 'uBright', 'uNeg', 'uDpr', 'uHpx'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
        const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
        let rawT = mk(); const lutT = mk(); gl.bindTexture(gl.TEXTURE_2D, lutT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        let soft = false; try { const e = gl.getExtension('WEBGL_debug_renderer_info'); soft = !!e && /swiftshader|llvmpipe|software|softpipe/i.test(String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL))); } catch (e) { soft = false; }
        const vao = gl.createVertexArray(); const api = { canvas: cv, gl, soft, lost: false, uploads: 0, size: [0, 0] };
        cv.addEventListener('webglcontextlost', e => { e.preventDefault(); api.lost = true; });
        api.setLut = rgb => { const n = rgb.length / 3, px = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; } gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        api.uploadRaw = (data, cols, rows) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, api.rawT || rawT); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, rows, 0, gl.RED, gl.FLOAT, data); api.size = [cols, rows]; api.uploads++; };
        // ring mode: texture is (rows x nCols) with one texel-row per time column; a column update is one contiguous texSubImage2D
        api.ring = 0; api.allocRing = (rows, nCols) => { if (rows > gl.getParameter(gl.MAX_TEXTURE_SIZE) || nCols > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return false; gl.activeTexture(gl.TEXTURE0); gl.deleteTexture(rawT); api.rawT = mk(); api.ringT = true; gl.bindTexture(gl.TEXTURE_2D, api.rawT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, rows, nCols, 0, gl.RED, gl.FLOAT, new Float32Array(rows * nCols)); api.size = [nCols, rows]; api.ring = nCols; api.uploads = 0; api.bytes = 0; return true; };
        api.uploadSlots = (data, rows, slot0, count) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, api.rawT); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot0, rows, count, gl.RED, gl.FLOAT, data, slot0 * rows); api.uploads++; api.bytes += count * rows * 4; };
        // p: {w,h (device px), dpr, ox, oy, cw, ch (CSS px, plot-local), H, L, gamma, bands, bright, neg}
        api.render = p => { if (api.lost) return false; if (cv.width !== p.w || cv.height !== p.h) { cv.width = p.w; cv.height = p.h; }
            gl.viewport(0, 0, p.w, p.h); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(prog); gl.bindVertexArray(vao);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, api.rawT || rawT); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutT); gl.uniform1i(U.uRing, api.ring); gl.uniform1i(U.uAbsOff, p.absOff | 0); gl.uniform1i(U.uAbsMin, p.absMin | 0); gl.uniform1i(U.uAbsMax, p.absMax | 0); gl.uniform1i(U.uRaw, 0); gl.uniform1i(U.uLut, 1);
            gl.uniform2f(U.uOrigin, p.ox, p.oy); gl.uniform2f(U.uCell, p.cw, p.ch); gl.uniform2i(U.uSize, api.size[0], api.size[1]);
            gl.uniform1f(U.uH, p.H); gl.uniform1f(U.uL, p.L); gl.uniform1f(U.uGamma, p.gamma); gl.uniform1f(U.uBands, p.bands); gl.uniform1f(U.uCurve, p.curve || 0); gl.uniform1f(U.uLogK, p.logK || 4); gl.uniform1f(U.uAlphaMax, p.alphaMax == null ? 1 : p.alphaMax); gl.uniform1f(U.uBright, p.bright); gl.uniform1f(U.uNeg, p.neg); gl.uniform1f(U.uDpr, p.dpr); gl.uniform1f(U.uHpx, p.h);
            gl.drawArrays(gl.TRIANGLES, 0, 3); return true; };
        // read one device pixel (bottom-left origin flipped to top-left), returns premultiplied RGBA bytes
        api.pixel = (x, y) => { const b = new Uint8Array(4); gl.readPixels(x, cv.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return Array.from(b); };
        return api;
    }
    window.CFGL = { create };
})();
