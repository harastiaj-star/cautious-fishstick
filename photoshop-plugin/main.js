/* Trailhead for Photoshop
   A UXP panel that picks up where the Trailhead site leaves off:
   opens Trailhead downloads (zipped or not), adds trail palettes as swatches,
   runs Trailhead photo filters and dithering, paints Trailhead textures onto new layers, and receives
   photos from a phone through the pocket scanner. */

let ps = null, uxp = null;
try { ps = require("photoshop"); uxp = require("uxp"); } catch (e) { /* running outside Photoshop (tests) */ }

/* ---------- palettes (same as the site) ---------- */
const PALETTES = {
  "Michigan": [["Wet Clay", "#894c29"], ["Burnt Sunrise", "#c07640"], ["Pollen Dust", "#e0a85a"], ["Toe Beans", "#cd774d"], ["Sage Olive", "#b5ae7d"], ["Pine Needles", "#666a57"], ["Dry Pottery", "#f7e7cc"], ["Desert Aloe", "#c9cdbd"]],
  "PNW": [["Leather", "#5e3721"], ["Fall Leaves", "#8d5c2f"], ["Mustard", "#c5953e"], ["Trail Dust", "#c8b38b"], ["Field Notes", "#f4eee6"], ["Pine Dew", "#bfbfa2"], ["Moss Pillow", "#7e7639"], ["PNW Breeze", "#443b1c"]],
  "Moose": [["Glacier Mist", "#a7bfd9"], ["Almond Cream", "#e9e2d0"], ["Olive Green", "#a69f4e"], ["Mosswood", "#44442a"], ["Brown Coffee", "#693b23"]],
  "Saguaro": [["Pacifica", "#7ba8ad"], ["Yucatan", "#ee8802"], ["Notte", "#502d1a"], ["Sera", "#eda495"], ["Madera", "#e24b36"], ["Saguaro", "#3e441e"]],
  "Shutter": [["Linen", "#edddc5"], ["Brick", "#7d2027"], ["Straw", "#c8b067"], ["Marigold", "#ce9042"], ["Sage", "#9ab08d"], ["Forest", "#274133"]],
  "Evergreen": [["Deep Fir", "#2f3d2c"], ["Spruce", "#4f6b45"], ["Fern", "#7d9466"], ["Lichen", "#b9c39a"], ["Bark", "#8a5a3b"], ["Birch", "#efe9d6"]],
  "Autumn": [["Maple", "#7a2e1d"], ["Rust Leaf", "#b5542b"], ["Aspen Gold", "#d89a3c"], ["Oak Bark", "#6e5a3a"], ["Sedge", "#8c8a5c"], ["Frost", "#efe3c8"]],
  "Coastal": [["Sea Stone", "#3e5560"], ["Fog Bank", "#6f8a8f"], ["Sea Glass", "#a9bcb8"], ["Mist", "#d8dcd3"], ["Driftwood", "#9c8f74"], ["Dune Grass", "#5d6b4a"]],
  "Campfire": [["Night Sky", "#1e2433"], ["Dusk", "#3a3f5c"], ["Ember", "#c4572b"], ["Flame", "#e8a33d"], ["Moonlight", "#f2e4c4"], ["Pine Shadow", "#4a5a3f"]],
  "Trail": [["Trail Orange", "#d2693a"], ["Boot Red", "#b60001"], ["Trail Sage", "#80ac8b"], ["Forest", "#516743"], ["Paper", "#f7f0dd"]],
  "Folk": [["Folk Green", "#3c7c59"], ["Folk Red", "#df3222"], ["Marigold", "#e09542"], ["Ink Black", "#141210"], ["Paper", "#f7f0dd"]]
};
const INKS = [["Ink brown", "#6b402d"], ["Ink black", "#141210"], ["Deep fir", "#2f3d2c"], ["Deep water", "#1f3b4d"], ["Wet clay", "#894c29"], ["Paper", "#f7f0dd"]];
const hexToRgb = h => { const n = parseInt(h.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- reading Trailhead files ---------- */
function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), files = [];
  let p = 0;
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const flags = dv.getUint16(p + 6, true), method = dv.getUint16(p + 8, true);
    const size = dv.getUint32(p + 18, true), nameLen = dv.getUint16(p + 26, true), extra = dv.getUint16(p + 28, true);
    const name = String.fromCharCode.apply(null, u8.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extra;
    if (flags & 8) throw new Error("This zip was repacked by another app. Unzip it and open the file inside instead.");
    files.push({ name, method, data: buf.slice(start, start + size) });
    p = start + size;
  }
  if (!files.length) throw new Error("That doesn't look like a Trailhead zip.");
  return files;
}
function readASE(buf) {
  const dv = new DataView(buf), out = [];
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "ASEF") throw new Error("That swatch file isn't in Adobe's format.");
  const count = dv.getUint32(8); let p = 12;
  for (let i = 0; i < count && p < buf.byteLength; i++) {
    const type = dv.getUint16(p), len = dv.getUint32(p + 2), body = p + 6;
    if (type === 1) {
      const nLen = dv.getUint16(body); let name = "";
      for (let k = 0; k < nLen - 1; k++) name += String.fromCharCode(dv.getUint16(body + 2 + k * 2));
      const mp = body + 2 + nLen * 2, model = String.fromCharCode(dv.getUint8(mp), dv.getUint8(mp + 1), dv.getUint8(mp + 2), dv.getUint8(mp + 3));
      if (model === "RGB ") out.push({ name, rgb: [0, 1, 2].map(k => Math.round(dv.getFloat32(mp + 4 + k * 4) * 255)) });
    }
    p = body + len;
  }
  return out;
}

/* ---------- textures (the same recipes as the site) ---------- */
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function makeNoise(seed) {
  const r = rng(seed), v = new Float32Array(256), p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) { v[i] = r(); p[i] = i; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255, a = v[p[p[X] + Y]], b = v[p[p[X + 1] + Y]], c = v[p[p[X] + Y + 1]], d = v[p[p[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
function fbm(n, x, y, oct) { let s = 0, a = .5, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= .5; f *= 2.03; } return s / norm; }
function textureAlpha(kind, W, H, seed) {
  const k = Math.sqrt(W * H) / 1200, n = makeNoise(seed), n2 = makeNoise(seed + 101), r = rng(seed + 7), a = new Float32Array(W * H);
  if (kind === "Paper grain") {
    const s = 200 * k;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) a[i] = clamp(((fbm(n, x / s, y / s, 4) - .42) * .9 + (r() - .5) * .55 + .12) * .38, 0, 1);
  } else if (kind === "Stamp wear") {
    const s = 104 * k;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) { const m = fbm(n, x / s, y / s, 5) * .8 + n2(x / (s * .18), y / (s * .18)) * .2; a[i] = Math.max(clamp((m - .574) / .035, 0, 1), r() < .016 ? 1 : 0); }
  } else if (kind === "Topo lines") {
    const s = 1100 * k, levels = 16, lw = 1.65 * Math.max(1, k), f = (x, y) => fbm(n, x / s, y / s, 4) * levels;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const v0 = f(x, y), g = Math.hypot(f(x + 1, y) - v0, f(x, y + 1) - v0) || 1e-6, idx = Math.round(v0), d = Math.abs(v0 - idx) / g, w = idx % 5 === 0 ? lw * 1.9 : lw;
      a[i] = clamp(w / 2 - d + .5, 0, 1) * .92;
    }
  } else if (kind === "Halftone") {
    const step = 14 * k, ang = Math.PI / 4, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const u = x * ca + y * sa, w = -x * sa + y * ca, cu = (Math.floor(u / step) + .5) * step, cw = (Math.floor(w / step) + .5) * step;
      const cx = cu * ca - cw * sa, cy = cu * sa + cw * ca, m = fbm(n, cx / (260 * k), cy / (260 * k), 3), t = .24 + .6 * clamp((m - .3) * 2.2, 0, 1), rad = step * .5 * Math.sqrt(t) * 1.15;
      a[i] = clamp(rad - Math.hypot(u - cu, w - cw) + .5, 0, 1);
    }
  } else if (kind === "Speckle") {
    const count = Math.round(.45 * W * H / 380);
    for (let s = 0; s < count; s++) {
      const rad = (.4 + Math.pow(r(), 4) * 6.4) * k, cx = r() * W, cy = r() * H, op = .55 + r() * .45, R = Math.ceil(rad + 1);
      for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x++) {
        const v = clamp(rad - Math.hypot(x + .5 - cx, y + .5 - cy) + .5, 0, 1) * op, i = y * W + x; a[i] = Math.max(a[i], v);
      }
    }
  }
  return a;
}
function textureRGBA(kind, W, H, inkHex, seed) {
  const a = textureAlpha(kind, W, H, seed), [r, g, b] = hexToRgb(inkHex), out = new Uint8Array(W * H * 4);
  for (let i = 0, j = 0; j < a.length; i += 4, j++) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.round(a[j] * 255); }
  return out;
}

/* ---------- Photoshop side ---------- */
function status(msg, bad) { const s = document.getElementById("status"); s.textContent = msg; s.className = "status" + (bad ? " bad" : ""); }
async function modal(name, fn) { return ps.core.executeAsModal(fn, { commandName: name }); }
async function setForeground(hex) {
  const [r, g, b] = hexToRgb(hex);
  await modal("Set Trailhead color", async () => {
    try { const c = new ps.app.SolidColor(); c.rgb.red = r; c.rgb.green = g; c.rgb.blue = b; ps.app.foregroundColor = c; }
    catch (e) { await ps.action.batchPlay([{ _obj: "set", _target: [{ _ref: "color", _property: "foregroundColor" }], to: { _obj: "RGBColor", red: r, grain: g, blue: b }, source: "photoshopPicker" }], {}); }
  });
}
async function addSwatches(list, prefix) {
  await modal("Add Trailhead swatches", async () => {
    await ps.action.batchPlay(list.map(({ name, rgb }) => ({ _obj: "make", _target: [{ _ref: "colors" }], using: { _obj: "colors", name: prefix ? prefix + " · " + name : name, color: { _obj: "RGBColor", red: rgb[0], grain: rgb[1], blue: rgb[2] } } })), {});
  });
}
async function openEntry(entry) { await modal("Open Trailhead file", async () => { await ps.app.open(entry); }); }
async function writeTemp(name, data) {
  const fs = uxp.storage.localFileSystem, tmp = await fs.getTemporaryFolder();
  const f = await tmp.createFile(name, { overwrite: true });
  await f.write(data, { format: uxp.storage.formats.binary });
  return f;
}
async function handleFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".psd") || name.endsWith(".png") || name.endsWith(".jpg")) { await openEntry(file); return "Opened " + file.name + "."; }
  const buf = await file.read({ format: uxp.storage.formats.binary });
  if (name.endsWith(".ase")) { const sw = readASE(buf); await addSwatches(sw); return `Added ${sw.length} swatches to your Swatches panel.`; }
  if (name.endsWith(".otf")) return "Fonts install outside Photoshop: double-click the .otf on your computer, then restart Photoshop to see it.";
  if (!name.endsWith(".zip")) return "Trailhead files are .zip, .psd, .ase or .png.";
  const files = readZip(buf), notes = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (f.method !== 0) { notes.push(f.name + " is compressed, so unzip it and open it directly."); continue; }
    if (n.endsWith(".psd") || n.endsWith(".png")) { const t = await writeTemp(f.name.split("/").pop(), f.data); await openEntry(t); notes.push("Opened " + f.name + "."); }
    else if (n.endsWith(".ase")) { const sw = readASE(f.data); await addSwatches(sw); notes.push(`Added ${sw.length} swatches.`); }
    else if (n.endsWith(".otf")) notes.push("Your font is inside: unzip it and double-click the .otf to install it.");
  }
  return notes.join(" ") || "Nothing in that zip that Photoshop can use.";
}
async function addTexture(kind, inkHex) {
  const app = ps.app, C = ps.constants;
  if (!app.activeDocument) throw new Error("Open or create a document first.");
  const doc = app.activeDocument;
  try { if (C && C.DocumentMode && doc.mode !== C.DocumentMode.RGB) throw new Error("Textures need an RGB document. Switch with Image › Mode › RGB Color."); } catch (e) { if (/RGB/.test(e.message)) throw e; }
  if (!ps.imaging) throw new Error("This version of Photoshop can't paint pixels from a plugin. Photoshop 2024 or newer can.");
  const W = Math.round(doc.width), H = Math.round(doc.height);
  if (W * H > 40e6) throw new Error("That document is very large. Try a texture on a copy under 40 megapixels.");
  const buf = textureRGBA(kind, W, H, inkHex, Math.floor(Math.random() * 99999) + 1);
  await modal("Add Trailhead texture", async () => {
    const opts = { name: "Trailhead · " + kind, opacity: 100 };
    const layer = doc.createPixelLayer ? await doc.createPixelLayer(opts) : await doc.createLayer(opts);
    const img = await ps.imaging.createImageDataFromBuffer(buf, { width: W, height: H, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    try { await ps.imaging.putPixels({ layerID: layer.id, imageData: img, replace: true }); } finally { img.dispose(); }
  });
}

/* ---------- Trailhead filters (same math as the site's photo tools) ---------- */
function boxBlur(a, W, H, r) {
  if (r < 1) return a;
  const t = new Float32Array(W * H), o = new Float32Array(W * H), d = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; const row = y * W; for (let i = -r; i <= r; i++) s += a[row + clamp(i, 0, W - 1)]; for (let x = 0; x < W; x++) { t[row + x] = s / d; s += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let i = -r; i <= r; i++) s += t[clamp(i, 0, H - 1) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / d; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}
const blur3 = (a, W, H, r) => boxBlur(boxBlur(boxBlur(a, W, H, r), W, H, r), W, H, r);
const lumHex = h => { const [r, g, b] = hexToRgb(h); return (.2126 * r + .7152 * g + .0722 * b) / 255; };
function grayFromPixels(data, comps, W, H) {
  const g = new Float32Array(W * H);
  for (let i = 0; i < g.length; i++) {
    const j = i * comps; let r = data[j], gg = data[j + 1], b = data[j + 2];
    if (comps === 4) { const a = data[j + 3] / 255; r = r * a + 255 * (1 - a); gg = gg * a + 255 * (1 - a); b = b * a + 255 * (1 - a); }
    g[i] = (.2126 * r + .7152 * gg + .0722 * b) / 255;
  }
  return g;
}
const DETAIL = { Bold: { cut: 16, lines: 12, smooth: 20, la: .2 }, Medium: { cut: 11, lines: 20, smooth: 14, la: .4 }, Fine: { cut: 7, lines: 34, smooth: 8, la: .75 } };
function linocutAlpha(g, W, H, detail, lightInk) {
  const k = W / 1200, gb = blur3(g, W, H, Math.max(1, Math.round(k))), size = DETAIL[detail].cut * Math.max(1, k), ang = 30 * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const lo = .3, hi = .64, eThr = .3 - .45 * .22, wear = .25, n = makeNoise(13), n2 = makeNoise(29), r = rng(41), a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let t = gb[i]; if (lightInk) t = 1 - t;
    const cover = t < lo ? 1 : t > hi ? 0 : 1 - (t - lo) / (hi - lo);
    const warp = (n(x / (55 * k), y / (55 * k)) - .5) * size * 2.2, p = .5 + .5 * Math.cos((x * ca + y * sa + warp) / size * Math.PI * 2);
    let v = clamp((cover - p) * 3.2 + .5, 0, 1);
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) { const e = Math.abs(gb[i + 1] - gb[i - 1]) + Math.abs(gb[i + W] - gb[i - W]); if (e > eThr) v = Math.max(v, clamp((e - eThr) * 18, 0, 1)); }
    if (t > hi && t < hi + .12 && n2((x * ca + y * sa) / (size * 4), (y * ca - x * sa) / (size * .9)) > .9) v = Math.max(v, .85);
    const m = fbm(n2, x / (110 * k), y / (110 * k), 4); v *= clamp(1 - wear * Math.max(0, .42 - m) * 2, 0, 1); if (r() < wear * .03) v *= .3;
    a[i] = v;
  }
  return a;
}
function topoAlpha(g, W, H, detail) {
  const f = blur3(g, W, H, Math.max(1, Math.round(DETAIL[detail].smooth * W / 1200))), n = DETAIL[detail].lines, wgt = 2 * Math.max(1, W / 1200), a = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (f[i + 1] - f[i - 1]) * n / 2, gy = (f[i + W] - f[i - W]) * n / 2, v = f[i] * n, gm = Math.max(.01, Math.hypot(gx, gy)), kk = Math.round(v), d = Math.abs(v - kk) / gm, w = kk % 5 === 0 ? wgt * 1.9 : wgt;
    a[i] = clamp(w / 2 - d + .5, 0, 1);
  }
  return a;
}
function lineArtAlpha(g, W, H, detail) {
  const r1 = Math.max(1, Math.round(W / 700)), b1 = blur3(g, W, H, r1), b2 = blur3(g, W, H, Math.round(r1 * 1.8) + 1), eps = .45 - DETAIL[detail].la * .25, a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) { const S = 31 * b1[i] - 30 * b2[i]; a[i] = S > eps ? 0 : clamp(-Math.tanh(6 * (S - eps)), 0, 1); }
  return a;
}
const CY_RAMP = ["#f3efe4", "#8fb3cf", "#2f6a9a", "#0f3560"].map(hexToRgb);
function cyRampAt(t) { const f = clamp(t, 0, 1) * 3, i = Math.min(2, Math.floor(f)), u = f - i; return [0, 1, 2].map(k => CY_RAMP[i][k] + (CY_RAMP[i + 1][k] - CY_RAMP[i][k]) * u); }
/* Scales the small result up to the document size with bilinear sampling, straight into an RGBA buffer. */
function upscaleInto(W, H, pw, ph, sample) {
  const out = new Uint8Array(W * H * 4), sx = pw / W, sy = ph / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(ph - 1, Math.max(0, (y + .5) * sy - .5)), y0 = Math.floor(fy), y1 = Math.min(ph - 1, y0 + 1), vy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(pw - 1, Math.max(0, (x + .5) * sx - .5)), x0 = Math.floor(fx), x1 = Math.min(pw - 1, x0 + 1), vx = fx - x0;
      sample(y0 * pw + x0, y0 * pw + x1, y1 * pw + x0, y1 * pw + x1, vx, vy, (y * W + x) * 4, out);
    }
  }
  return out;
}
/* kind: Linocut | Photo to topo | Line art | Cyanotype print | Cyanotype negative. Returns an RGBA buffer at W x H. */
function filterRGBA(kind, g, pw, ph, W, H, inkHex, detail) {
  const lerp = (a, b, c, d, vx, vy) => (a * (1 - vx) + b * vx) * (1 - vy) + (c * (1 - vx) + d * vx) * vy;
  if (kind === "Cyanotype print" || kind === "Cyanotype negative") {
    const a = 3, ea = 1 - Math.exp(-a), T = new Float32Array(pw * ph);
    for (let i = 0; i < T.length; i++) T[i] = -Math.log(1 - (1 - g[i]) * ea) / a;
    return upscaleInto(W, H, pw, ph, (i00, i01, i10, i11, vx, vy, o, out) => {
      if (kind === "Cyanotype negative") { const v = lerp(T[i00], T[i01], T[i10], T[i11], vx, vy) * 255; out[o] = out[o + 1] = out[o + 2] = v; }
      else { const c = cyRampAt(1 - lerp(g[i00], g[i01], g[i10], g[i11], vx, vy)); out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; }
      out[o + 3] = 255;
    });
  }
  const lightInk = lumHex(inkHex) > .5;
  const A = kind === "Linocut" ? linocutAlpha(g, pw, ph, detail, lightInk) : kind === "Photo to topo" ? topoAlpha(g, pw, ph, detail) : lineArtAlpha(g, pw, ph, detail);
  const [r, gg, b] = hexToRgb(inkHex);
  return upscaleInto(W, H, pw, ph, (i00, i01, i10, i11, vx, vy, o, out) => { out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = clamp(lerp(A[i00], A[i01], A[i10], A[i11], vx, vy), 0, 1) * 255; });
}
async function putLayer(doc, name, buf, W, H) {
  const layer = doc.createPixelLayer ? await doc.createPixelLayer({ name, opacity: 100 }) : await doc.createLayer({ name, opacity: 100 });
  const img = await ps.imaging.createImageDataFromBuffer(buf, { width: W, height: H, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
  try { await ps.imaging.putPixels({ layerID: layer.id, imageData: img, replace: true }); } finally { img.dispose(); }
}
async function applyFilter(kind, inkHex, detail, paperHex) {
  const app = ps.app, C = ps.constants;
  if (!app.activeDocument) throw new Error("Open a photo first.");
  const doc = app.activeDocument;
  try { if (C && C.DocumentMode && doc.mode !== C.DocumentMode.RGB) throw new Error("Filters need an RGB document. Switch with Image › Mode › RGB Color."); } catch (e) { if (/RGB/.test(e.message)) throw e; }
  if (!ps.imaging) throw new Error("This version of Photoshop can't read pixels from a plugin. Photoshop 2024 or newer can.");
  const W = Math.round(doc.width), H = Math.round(doc.height);
  if (W * H > 40e6) throw new Error("That document is very large. Try the filter on a copy under 40 megapixels.");
  const s = Math.min(1, 2400 / Math.max(W, H));
  await modal("Trailhead " + kind, async () => {
    const res = await ps.imaging.getPixels({ documentID: doc.id, targetSize: { width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)) }, componentSize: 8, applyAlpha: false, colorSpace: "RGB" });
    const img = res.imageData; let g, pw, ph;
    try { pw = img.width; ph = img.height; const data = await img.getData({ chunky: true }); g = grayFromPixels(data, img.components || Math.round(data.length / (pw * ph)), pw, ph); } finally { try { img.dispose(); } catch (e) {} }
    const out = filterRGBA(kind, g, pw, ph, W, H, inkHex, detail);
    const solid = !/Cyanotype/.test(kind);
    if (solid && paperHex) { const [r, gg, b] = hexToRgb(paperHex), pb = new Uint8Array(W * H * 4); for (let i = 0; i < pb.length; i += 4) { pb[i] = r; pb[i + 1] = gg; pb[i + 2] = b; pb[i + 3] = 255; } await putLayer(doc, "Trailhead · Paper", pb, W, H); }
    await putLayer(doc, "Trailhead · " + kind, out, W, H);
  });
}

/* ---------- dither ----------
   The document is read at one sample per cell, cleaned up (brightness, contrast, blur, denoise,
   sharpen, noise), then turned into 1 to 3 inks plus a background with one of twelve methods.
   Error diffusion, ordered and pixel methods fill whole cells, so the result stays crisp at any size;
   halftone and line methods are drawn at full resolution with soft edges. */
const DITHER_ALGOS = ["Atkinson", "Floyd–Steinberg", "Jarvis", "Stucki", "Sierra", "Bayer 4×4", "Bayer 8×8", "Blue noise", "Halftone", "Line screen", "Crosshatch", "Pixel grid"];
const DIFFUSION = {
  "Floyd–Steinberg": [16, [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]],
  "Atkinson": [8, [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]],
  "Jarvis": [48, [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]]],
  "Stucki": [42, [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]]],
  "Sierra": [32, [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]]]
};
function bayer(n) { let m = [[0]]; while (m.length < n) { const s = m.length, o = []; for (let y = 0; y < s * 2; y++) { o.push([]); for (let x = 0; x < s * 2; x++) { const q = m[y % s][x % s] * 4; o[y].push(q + [[0, 2], [3, 1]][y >= s ? 1 : 0][x >= s ? 1 : 0]); } } m = o; } return m.map(r => r.map(v => (v + .5) / (n * n))); }
const BAYER4 = bayer(4), BAYER8 = bayer(8);
const DITHER_PRESETS = {
  "1-bit Mac": { algo: "Atkinson", cell: 2, tones: 1, ink1: "#141210", bg: "#f4f1ea", contrast: 20, sharpen: 80 },
  "Newsprint": { algo: "Halftone", cell: 10, tones: 1, ink1: "#1c1a18", bg: "#ece4d2", angle: 45, contrast: 15, sharpen: 60, noise: 8 },
  "Night screen": { algo: "Halftone", cell: 14, tones: 1, ink1: "#b6c2e6", bg: "#0d0f16", angle: 45, contrast: 30, sharpen: 200, invert: true },
  "Pocket console": { algo: "Bayer 4×4", cell: 4, tones: 3, ink1: "#0f380f", ink2: "#306230", ink3: "#8bac0f", bg: "#9bbc0f", contrast: 10 },
  "Riso two-tone": { algo: "Blue noise", cell: 2, tones: 2, ink1: "#1f3b8a", ink2: "#ff6c2f", bg: "#f7f0dd", contrast: 20, noise: 6 },
  "Engraving": { algo: "Line screen", cell: 8, tones: 1, ink1: "#2a1d14", bg: "#f2e8d2", angle: 30, contrast: 25, sharpen: 120 },
  "Etched hatch": { algo: "Crosshatch", cell: 7, tones: 1, ink1: "#1f2a1c", bg: "#efe9d6", angle: 45, contrast: 20 },
  "Big pixels": { algo: "Pixel grid", cell: 16, tones: 3, ink1: "#2f3d2c", ink2: "#7d9466", ink3: "#e0a85a", bg: "#f7f0dd" }
};
const DITHER_DEFAULTS = { algo: "Atkinson", cell: 3, tones: 1, ink1: "#141210", ink2: "#894c29", ink3: "#e0a85a", bg: "#f4f1ea", angle: 45, brightness: 0, contrast: 0, blur: 0, denoise: 0, sharpen: 0, radius: 2, noise: 0, invert: false };
/* Cleans up the gray grid in place. g is 0 (black) to 1 (white). */
function ditherPrep(g, w, h, o) {
  let a = g;
  if (o.denoise > 0) { const b = blur3(a, w, h, 1), t = o.denoise / 100; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); const k = t * clamp(1 - d * 6, 0, 1); a[i] = a[i] * (1 - k) + b[i] * k; } }
  if (o.blur > 0) a = blur3(a, w, h, Math.round(o.blur));
  if (o.sharpen > 0) { const b = blur3(a, w, h, Math.max(1, Math.round(o.radius))), s = o.sharpen / 100; for (let i = 0; i < a.length; i++) a[i] = a[i] + (a[i] - b[i]) * s; }
  const f = Math.tan((clamp(o.contrast, -99, 99) / 100 + 1) * Math.PI / 4), br = o.brightness / 200, r = rng(97);
  for (let i = 0; i < a.length; i++) { let v = (a[i] - .5) * f + .5 + br; if (o.noise > 0) v += (r() - .5) * o.noise / 100 * .5; if (o.invert) v = 1 - v; a[i] = clamp(v, 0, 1); }
  return a;
}
/* Returns level per grid cell: 0 = darkest ink ... L = background, for the cell-filling methods. */
function ditherLevels(g, w, h, algo, L) {
  const lv = new Uint8Array(w * h);
  if (DIFFUSION[algo]) {
    const [div, taps] = DIFFUSION[algo], e = Float32Array.from(g);
    for (let y = 0; y < h; y++) {
      const ltr = y % 2 === 0;   /* serpentine scan avoids diagonal worms */
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k, i = y * w + x, v = clamp(e[i], 0, 1), q = Math.round(v * L), err = v - q / L;
        lv[i] = q;
        for (const [dx, dy, wt] of taps) { const xx = x + (ltr ? dx : -dx), yy = y + dy; if (xx >= 0 && xx < w && yy < h) e[yy * w + xx] += err * wt / div; }
      }
    }
  } else {
    const M = algo === "Bayer 8×8" ? BAYER8 : algo === "Bayer 4×4" ? BAYER4 : null, n = M ? M.length : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, t = M ? M[y % n][x % n] : algo === "Blue noise" ? (x * .7548776662 + y * .56984029) % 1 : .5;
      lv[i] = clamp(Math.floor(g[i] * L + t), 0, L);
    }
  }
  return lv;
}
/* g: prepped gray grid gw x gh, one sample per cell of size `cell` document pixels. Returns RGBA at W x H. */
function ditherRGBA(g, gw, gh, W, H, o) {
  const inks = [o.ink1, o.ink2, o.ink3].slice(0, o.tones).map(hexToRgb), L = inks.length, bgT = !o.bg || o.bg === "transparent", bg = bgT ? [0, 0, 0] : hexToRgb(o.bg);
  const out = new Uint8Array(W * H * 4), cell = W / gw, cellY = H / gh;
  const put = (p, c, a) => { /* a: ink coverage 0..1 over the background */ const q = p * 4; if (bgT) { out[q] = c[0]; out[q + 1] = c[1]; out[q + 2] = c[2]; out[q + 3] = a * 255; } else { out[q] = bg[0] + (c[0] - bg[0]) * a; out[q + 1] = bg[1] + (c[1] - bg[1]) * a; out[q + 2] = bg[2] + (c[2] - bg[2]) * a; out[q + 3] = 255; } };
  if (o.algo === "Halftone" || o.algo === "Line screen" || o.algo === "Crosshatch") {
    const ang = (o.angle || 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang), S = Math.max(2, cell);
    const sample = (x, y) => { const fx = clamp(x / cell - .5, 0, gw - 1), fy = clamp(y / cellY - .5, 0, gh - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), vx = fx - x0, vy = fy - y0; return (g[y0 * gw + x0] * (1 - vx) + g[y0 * gw + x1] * vx) * (1 - vy) + (g[y1 * gw + x0] * (1 - vx) + g[y1 * gw + x1] * vx) * vy; };
    const inkFor = d => inks[clamp(L - 1 - Math.floor(d * L * .999), 0, L - 1)];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x * ca + y * sa) / S, v = (-x * sa + y * ca) / S, p = y * W + x;
      if (o.algo === "Halftone") {
        const cu = Math.floor(u) + .5, cv = Math.floor(v) + .5, cx = (cu * ca - cv * sa) * S, cy = (cu * sa + cv * ca) * S;
        const d = 1 - sample(cx, cy), r = Math.sqrt(d) * .72, dist = Math.hypot(u - cu, v - cv), aa = .8 / S;
        put(p, inkFor(d), clamp((r - dist) / aa + .5, 0, 1));
      } else {
        const d = 1 - sample(x, y), aa = .9 / S, line = f => { const t = Math.abs((f % 1 + 1) % 1 - .5) * 2; return clamp(((d * (o.algo === "Crosshatch" ? 1.4 : 1)) - t) / aa * .5 + .5, 0, 1); };
        let a = line(v);
        if (o.algo === "Crosshatch") { const d2 = clamp((d - .45) / .55, 0, 1), t2 = Math.abs((u % 1 + 1) % 1 - .5) * 2; a = Math.max(a * clamp(d / .35, 0, 1), clamp((d2 * 1.2 - t2) / aa * .5 + .5, 0, 1)); }
        put(p, inkFor(d), a);
      }
    }
    return out;
  }
  const lv = ditherLevels(g, gw, gh, o.algo === "Pixel grid" ? "Pixel grid" : o.algo, L), gap = o.algo === "Pixel grid" && cell >= 6 ? Math.max(1, Math.round(cell * .08)) : 0;
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cellY)), iy = (y / cellY - gy) * cellY;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / cell)), l = lv[gy * gw + gx], p = y * W + x;
      if (gap && ((x / cell - gx) * cell < gap || iy < gap)) { put(p, [0, 0, 0], 0); continue; }
      if (l >= L) put(p, [0, 0, 0], 0); else put(p, inks[l], 1);
    }
  }
  return out;
}
/* Reads the document (or one area of it) at one sample per cell. */
async function ditherGray(doc, cell, bounds) {
  const W = bounds ? bounds.right - bounds.left : Math.round(doc.width), H = bounds ? bounds.bottom - bounds.top : Math.round(doc.height);
  const gw = Math.max(1, Math.round(W / cell)), gh = Math.max(1, Math.round(H / cell)), opts = { documentID: doc.id, targetSize: { width: gw, height: gh }, componentSize: 8, applyAlpha: false, colorSpace: "RGB" };
  if (bounds) opts.sourceBounds = bounds;
  const res = await ps.imaging.getPixels(opts), img = res.imageData;
  try { const data = await img.getData({ chunky: true }), w = img.width, h = img.height; return { g: grayFromPixels(data, img.components || Math.round(data.length / (w * h)), w, h), gw: w, gh: h, W, H }; }
  finally { try { img.dispose(); } catch (e) {} }
}
function ditherCheckDoc() {
  const app = ps.app, C = ps.constants; if (!app.activeDocument) throw new Error("Open a photo first.");
  const doc = app.activeDocument;
  try { if (C && C.DocumentMode && doc.mode !== C.DocumentMode.RGB) throw new Error("Dither needs an RGB document. Switch with Image › Mode › RGB Color."); } catch (e) { if (/RGB/.test(e.message)) throw e; }
  if (!ps.imaging) throw new Error("This version of Photoshop can't read pixels from a plugin. Photoshop 2024 or newer can.");
  return doc;
}
async function applyDither(o) {
  const doc = ditherCheckDoc(), W = Math.round(doc.width), H = Math.round(doc.height);
  if (W * H > 40e6) throw new Error("That document is very large. Try dither on a copy under 40 megapixels.");
  await modal("Trailhead dither", async () => {
    const r = await ditherGray(doc, o.cell, null), g = ditherPrep(r.g, r.gw, r.gh, o);
    await putLayer(doc, `Trailhead · Dither (${o.algo})`, ditherRGBA(g, r.gw, r.gh, W, H, o), W, H);
  });
}
/* A 1:1 preview of a square from the middle of the document, so the dots look exactly as they will. */
async function ditherPreview(o, size) {
  const doc = ditherCheckDoc(), W = Math.round(doc.width), H = Math.round(doc.height), s = Math.min(size, W, H);
  const b = { left: Math.round((W - s) / 2), top: Math.round((H - s) / 2) }; b.right = b.left + s; b.bottom = b.top + s;
  let out;
  await modal("Trailhead dither preview", async () => { const r = await ditherGray(doc, o.cell, b); out = ditherRGBA(ditherPrep(r.g, r.gw, r.gh, o), r.gw, r.gh, s, s, o); });
  const img = await ps.imaging.createImageDataFromBuffer(out, { width: s, height: s, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
  try { return await ps.imaging.encodeImageData({ imageData: img, base64: true }); } finally { img.dispose(); }
}

/* ---------- pixel art ----------
   Same idea as Pixel cutout on the site. The document is read on a fine grid, the background is
   flood-filled from the most common edge color (a see-through document uses its own transparency),
   small islands are dropped, and the subject is redrawn on a coarse square grid in one ink.
   Cells that are light, or clearly lighter than their neighbors, stay empty so details still read.
   The pixels land exactly over the subject, on a new layer. */
const PIXEL_LOOKS = {
  "Cobalt": { ink: "#1f4dff", paper: "#e2dbcd", cells: 40, detail: 60 },
  "Pocket game": { ink: "#1f3a1c", paper: "#a9bf5a", cells: 32, detail: 55 },
  "Riso pink": { ink: "#f2479b", paper: "#f3ead7", cells: 44, detail: 60 },
  "Ink stamp": { ink: "#1d1a17", paper: "#f4efe4", cells: 52, detail: 65 },
  "Night": { ink: "#f1e6c8", paper: "#1c2433", cells: 40, detail: 60 },
  "Rust": { ink: "#a8471f", paper: "#efe2c9", cells: 30, detail: 55 }
};
const PIXEL_DEFAULTS = { look: "Cobalt", cut: "bg", tol: 28, cells: 40, detail: 60, ink: "#1f4dff", paper: "#e2dbcd" };
function pixelMask(data, comps, fw, fh, mode, tol) {
  const n = fw * fh, L = new Float32Array(n), subj = new Uint8Array(n), col = i => [data[i * comps], data[i * comps + 1], data[i * comps + 2]];
  for (let i = 0; i < n; i++) { const [r, g, b] = col(i); L[i] = (.2126 * r + .7152 * g + .0722 * b) / 255; }
  let clear = 0; if (comps === 4) for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) clear++;
  if (clear > n * .02) { for (let i = 0; i < n; i++) subj[i] = data[i * 4 + 3] >= 128; return { subj, L }; }
  if (mode === "all") { subj.fill(1); return { subj, L }; }
  const t = tol * 2.2, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const border = []; for (let x = 0; x < fw; x++) border.push(x, (fh - 1) * fw + x); for (let y = 1; y < fh - 1; y++) border.push(y * fw, y * fw + fw - 1);
  const buckets = new Map(); border.forEach(i => { const [r, g, b] = col(i), k = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5), e = buckets.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += r; e[2] += g; e[3] += b; buckets.set(k, e); });
  const top = [...buckets.values()].sort((a, b) => b[0] - a[0])[0], ref = [top[1] / top[0], top[2] / top[0], top[3] / top[0]];
  const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
  border.forEach(i => { if (!bg[i] && dist(col(i), ref) < t) { bg[i] = 1; q[qt++] = i; } });
  while (qh < qt) {
    const i = q[qh++], x = i % fw, y = (i / fw) | 0, ci = col(i);
    for (const j of [x > 0 ? i - 1 : -1, x < fw - 1 ? i + 1 : -1, y > 0 ? i - fw : -1, y < fh - 1 ? i + fw : -1]) {
      if (j < 0 || bg[j]) continue; const cj = col(j);
      if (dist(cj, ref) < t * 1.6 && dist(cj, ci) < t * .55) { bg[j] = 1; q[qt++] = j; }
    }
  }
  for (let i = 0; i < n; i++) subj[i] = bg[i] ? 0 : 1;
  const lab = new Int32Array(n).fill(-1), sizes = [], st = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!subj[i] || lab[i] >= 0) continue; const id = sizes.length; let sp = 0, cnt = 0; st[sp++] = i; lab[i] = id;
    while (sp) { const k = st[--sp]; cnt++; const x = k % fw; for (const j of [x > 0 ? k - 1 : -1, x < fw - 1 ? k + 1 : -1, k - fw, k + fw]) if (j >= 0 && j < n && subj[j] && lab[j] < 0) { lab[j] = id; st[sp++] = j; } }
    sizes.push(cnt);
  }
  const big = sizes.length ? Math.max(...sizes) : 0;
  for (let i = 0; i < n; i++) if (subj[i] && sizes[lab[i]] < big * .04) subj[i] = 0;
  return { subj, L };
}
function pixelCells(subj, L, fw, fh, cols, detail) {
  const cs = fw / cols, rows = Math.max(1, Math.round(fh / cs)), csy = fh / rows, inC = new Uint8Array(cols * rows), lum = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let t = 0, k = 0, l = 0; const x0 = Math.floor(c * cs), x1 = Math.max(x0 + 1, Math.floor((c + 1) * cs)), y0 = Math.floor(r * csy), y1 = Math.max(y0 + 1, Math.floor((r + 1) * csy));
    for (let y = y0; y < y1 && y < fh; y++) for (let x = x0; x < x1 && x < fw; x++) { t++; const i = y * fw + x; if (subj[i]) { k++; l += L[i]; } }
    if (t && k / t > .45) { inC[r * cols + c] = 1; lum[r * cols + c] = l / k; }
  }
  const vals = []; for (let i = 0; i < inC.length; i++) if (inC[i]) vals.push(lum[i]); vals.sort((a, b) => a - b);
  const lo = vals.length ? vals[Math.floor(vals.length * .03)] : 0, hi = vals.length ? vals[Math.floor(vals.length * .97)] : 1, span = Math.max(.04, hi - lo), tn = i => (lum[i] - lo) / span, d = detail / 100;
  const ink = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; if (!inC[i]) continue;
    let sum = 0, cnt = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const rr = r + dy, cc = c + dx; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue; const j = rr * cols + cc; if (inC[j]) { sum += tn(j); cnt++; } }
    const t = tn(i), local = t - sum / cnt;
    ink[i] = d === 0 || (t < 1.25 - d * .6 && local < .3 - d * .3) ? 1 : 0;
  }
  return { ink, cols, rows };
}
/* Draws the cells over a W×H area: ink cells in ink, the rest paper (or clear). */
function pixelRGBA(cells, W, H, inkHex, paperHex) {
  const { ink, cols, rows } = cells, out = new Uint8Array(W * H * 4), [ir, ig, ib] = hexToRgb(inkHex), paper = paperHex ? hexToRgb(paperHex) : null;
  const colOf = new Int32Array(W); for (let x = 0; x < W; x++) colOf[x] = Math.min(cols - 1, Math.floor(x * cols / W));
  for (let y = 0; y < H; y++) {
    const r = Math.min(rows - 1, Math.floor(y * rows / H)), base = r * cols;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (ink[base + colOf[x]]) { out[o] = ir; out[o + 1] = ig; out[o + 2] = ib; out[o + 3] = 255; }
      else if (paper) { out[o] = paper[0]; out[o + 1] = paper[1]; out[o + 2] = paper[2]; out[o + 3] = 255; }
    }
  }
  return out;
}
async function pixelRead(doc) {
  const W = Math.round(doc.width), H = Math.round(doc.height), fw = Math.min(260, W), fh = Math.max(2, Math.round(fw * H / W));
  const res = await ps.imaging.getPixels({ documentID: doc.id, targetSize: { width: fw, height: fh }, componentSize: 8, applyAlpha: false, colorSpace: "RGB" }), img = res.imageData;
  try { const data = await img.getData({ chunky: true }), w = img.width, h = img.height; return { data, comps: img.components || Math.round(data.length / (w * h)), fw: w, fh: h, W, H }; }
  finally { try { img.dispose(); } catch (e) {} }
}
function pixelCheckDoc() {
  const app = ps.app, C = ps.constants; if (!app.activeDocument) throw new Error("Open a photo first.");
  const doc = app.activeDocument;
  try { if (C && C.DocumentMode && doc.mode !== C.DocumentMode.RGB) throw new Error("Pixel art needs an RGB document. Switch with Image › Mode › RGB Color."); } catch (e) { if (/RGB/.test(e.message)) throw e; }
  if (!ps.imaging) throw new Error("This version of Photoshop can't read pixels from a plugin. Photoshop 2024 or newer can.");
  return doc;
}
const pixelFrom = (r, o) => { const m = pixelMask(r.data, r.comps, r.fw, r.fh, o.cut, o.tol); return pixelCells(m.subj, m.L, r.fw, r.fh, o.cells, o.detail); };
async function applyPixel(o) {
  const doc = pixelCheckDoc(), W = Math.round(doc.width), H = Math.round(doc.height);
  if (W * H > 40e6) throw new Error("That document is very large. Try pixel art on a copy under 40 megapixels.");
  await modal("Trailhead pixel art", async () => {
    const cells = pixelFrom(await pixelRead(doc), o);
    if (o.paper) { const [r, g, b] = hexToRgb(o.paper), pb = new Uint8Array(W * H * 4); for (let i = 0; i < pb.length; i += 4) { pb[i] = r; pb[i + 1] = g; pb[i + 2] = b; pb[i + 3] = 255; } await putLayer(doc, "Trailhead · Pixel paper", pb, W, H); }
    await putLayer(doc, "Trailhead · Pixels", pixelRGBA(cells, W, H, o.ink, null), W, H);
  });
}
async function pixelPreview(o, size) {
  const doc = pixelCheckDoc(), W = Math.round(doc.width), H = Math.round(doc.height), s = Math.min(1, size / Math.max(W, H)), pw = Math.max(1, Math.round(W * s)), ph = Math.max(1, Math.round(H * s));
  let out; await modal("Trailhead pixel preview", async () => { out = pixelRGBA(pixelFrom(await pixelRead(doc), o), pw, ph, o.ink, o.paper || "#ffffff"); });
  const img = await ps.imaging.createImageDataFromBuffer(out, { width: pw, height: ph, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
  try { return await ps.imaging.encodeImageData({ imageData: img, base64: true }); } finally { img.dispose(); }
}
function setupPixel() {
  const $i = id => document.getElementById(id);
  const lookItems = [["Your own settings", ""]].concat(Object.keys(PIXEL_LOOKS).map(k => [k, k])), cutItems = [["Remove the background", "bg"], ["Keep the whole document", "all"]];
  fillSelect($i("pxLook"), lookItems); fillSelect($i("pxCut"), cutItems);
  const sliders = { pxCells: "cells", pxDetail: "detail", pxTol: "tol" }, validHex = v => /^#[0-9a-f]{6}$/i.test(v);
  const setSel = (sel, items, v) => { const i = items.findIndex(it => it[1] === String(v)); if (i >= 0) { try { sel.selectedIndex = i; } catch (e) {} sel.value = String(v); } };
  function read() {
    const o = Object.assign({}, PIXEL_DEFAULTS); o.cut = readSelect($i("pxCut"), cutItems);
    Object.keys(sliders).forEach(id => { o[sliders[id]] = +$i(id).value; });
    const ink = $i("pxInk").value.trim().toLowerCase(), paper = $i("pxPaper").value.trim().toLowerCase();
    if (validHex(ink)) o.ink = ink; o.paper = paper === "transparent" || paper === "" ? "" : validHex(paper) ? paper : o.paper; return o;
  }
  function paint(o) {
    Object.keys(sliders).forEach(id => { $i(id + "V").textContent = String(o[sliders[id]]); });
    $i("pxInkC").style.backgroundColor = o.ink; $i("pxPaperC").style.backgroundColor = o.paper || "transparent";
    $i("pxTolWrap").style.display = o.cut === "bg" ? "block" : "none";
  }
  function load(k) { const m = PIXEL_LOOKS[k]; $i("pxCells").value = m.cells; $i("pxDetail").value = m.detail; $i("pxInk").value = m.ink; $i("pxPaper").value = m.paper; paint(read()); }
  let t = 0, busy = false, again = false;
  async function preview() {
    if (busy) { again = true; return; } busy = true;
    try {
      let doc = null; try { doc = ps.app.activeDocument; } catch (e) {}
      if (!doc) { $i("pxPrevNote").textContent = "Open a document to see a preview."; $i("pxPrev").style.display = "none"; return; }
      $i("pxPrevNote").textContent = "Drawing the preview…";
      $i("pxPrev").src = "data:image/jpeg;base64," + await pixelPreview(read(), 360); $i("pxPrev").style.display = "block"; $i("pxPrevNote").textContent = "The whole document, scaled down.";
    } catch (e) { $i("pxPrev").style.display = "none"; $i("pxPrevNote").textContent = /encode/i.test(e.message || "") ? "Preview needs Photoshop 2024 or newer. Apply still works." : (e.message || "Couldn't draw the preview."); }
    finally { busy = false; if (again) { again = false; preview(); } }
  }
  const changed = () => { try { $i("pxLook").selectedIndex = 0; } catch (e) {} $i("pxLook").value = ""; paint(read()); clearTimeout(t); t = setTimeout(preview, 450); };
  Object.keys(sliders).forEach(id => { $i(id).addEventListener("input", () => paint(read())); $i(id).addEventListener("change", changed); });
  ["pxCut", "pxInk", "pxPaper"].forEach(id => $i(id).addEventListener("change", changed));
  $i("pxLook").addEventListener("change", () => { const k = readSelect($i("pxLook"), lookItems); if (!k) return; load(k); setSel($i("pxLook"), lookItems, k); clearTimeout(t); t = setTimeout(preview, 100); });
  $i("pxPrevBtn").addEventListener("click", preview);
  $i("pxApply").addEventListener("click", async () => { status("Drawing the pixels… big documents take a few seconds."); try { await applyPixel(read()); status("The pixels are on a new layer above your photo. Your original layers weren't touched."); } catch (e) { status(e.message, true); } });
  setSel($i("pxLook"), lookItems, "Cobalt"); load("Cobalt");
}

/* ---------- colors from the open document ---------- */
function rgbToHex(r, g, b) { return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join(""); }
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
function earthName(hex) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  if (s < .12) return l > .86 ? "Bone" : l > .62 ? "Ash" : l > .35 ? "Flint" : "Charcoal";
  const names = [[14, "Rust"], [32, "Clay"], [48, "Ochre"], [62, "Sand"], [90, "Lichen"], [150, "Moss"], [185, "Sage"], [215, "Lake"], [250, "Dusk"], [285, "Lupine"], [330, "Fireweed"], [350, "Rosehip"], [361, "Rust"]];
  return (l > .74 ? "Pale " : l < .3 ? "Deep " : "") + names.find(([b]) => h < b)[1];
}
/* Same k-means as the site's Image colors tool. pts: array of [r,g,b]. */
function mainColors(pts, k) {
  if (!pts.length) return [];
  const cents = [pts[Math.floor(pts.length / 2)].slice()];
  while (cents.length < k) { let best = pts[0], bd = -1; for (let i = 0; i < pts.length; i += 5) { const p = pts[i]; let md = Infinity; for (const q of cents) md = Math.min(md, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2); if (md > bd) { bd = md; best = p; } } cents.push(best.slice()); }
  const asg = new Uint8Array(pts.length);
  for (let it = 0; it < 10; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; let bi = 0, bd = Infinity; for (let j = 0; j < cents.length; j++) { const q = cents[j], dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } } asg[i] = bi; const sm = sum[bi]; sm[0] += p[0]; sm[1] += p[1]; sm[2] += p[2]; sm[3]++; }
    sum.forEach((sm, j) => { if (sm[3]) cents[j] = [sm[0] / sm[3], sm[1] / sm[3], sm[2] / sm[3]]; });
  }
  const counts = new Array(cents.length).fill(0); asg.forEach(a => counts[a]++);
  const seen = {};
  return cents.map((q, j) => ({ hex: rgbToHex(...q), share: counts[j] / pts.length })).filter(c => c.share > .01).sort((a, b) => b.share - a.share)
    .map(c => { let n = earthName(c.hex); seen[n] = (seen[n] || 0) + 1; if (seen[n] > 1) n += " " + seen[n]; return { ...c, name: n }; });
}
function pixelsToPoints(data, comps) {
  const pts = [], step = comps;
  for (let i = 0; i + 2 < data.length; i += step) { if (comps === 4 && data[i + 3] < 128) continue; pts.push([data[i], data[i + 1], data[i + 2]]); }
  return pts;
}
async function documentColors(k) {
  const doc = ps.app.activeDocument;
  if (!doc) throw new Error("Open a document first.");
  if (!ps.imaging) throw new Error("This version of Photoshop can't read pixels from a plugin. Photoshop 2024 or newer can.");
  let pts = [];
  await modal("Read colors for Trailhead", async () => {
    const W = Number(doc.width) || 1000, H = Number(doc.height) || 1000, s = Math.min(1, 220 / Math.max(W, H));
    const res = await ps.imaging.getPixels({ documentID: doc.id, targetSize: { width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)) }, componentSize: 8, applyAlpha: false, colorSpace: "RGB" });
    const img = res.imageData;
    try { const data = await img.getData({ chunky: true }); pts = pixelsToPoints(data, img.components || 4); } finally { try { img.dispose(); } catch (e) {} }
  });
  if (!pts.length) throw new Error("Couldn't find any visible pixels. Make sure the document isn't empty.");
  return mainColors(pts, k);
}

/* ---------- panel ---------- */
/* Photoshop's panel engine is pickier about <select> than a browser: build options as elements,
   set value attributes, and read the choice by index as a backup. */
function fillSelect(sel, items) {
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  items.forEach(([label, value], i) => { const o = document.createElement("option"); o.value = value; o.textContent = label; if (i === 0) o.selected = true; sel.appendChild(o); });
  try { sel.selectedIndex = 0; } catch (e) {}
}
function readSelect(sel, items) {
  const v = sel.value;
  if (v && items.some(it => it[1] === v)) return v;
  const i = typeof sel.selectedIndex === "number" && sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
  return (items[i] || items[0])[1];
}
const PAL_ITEMS = Object.keys(PALETTES).map(k => [k, k]);
const INK_ITEMS = INKS.map(([n, h]) => [n, h]);
const FX_ITEMS = [["Linocut", "Linocut"], ["Photo to topo", "Photo to topo"], ["Line art", "Line art"], ["Cyanotype print", "Cyanotype print"], ["Cyanotype negative", "Cyanotype negative"]];
const DETAIL_ITEMS = [["Medium", "Medium"], ["Bold", "Bold"], ["Fine", "Fine"]];
const PAPER_ITEMS = [["Cream paper", "#f4ecd8"], ["White paper", "#ffffff"], ["No paper (ink only)", ""]];
const TEX_ITEMS = [["Topo lines", "Topo lines"], ["Paper grain", "Paper grain"], ["Speckle", "Speckle"], ["Halftone", "Halftone"], ["Stamp wear", "Stamp wear"]];

/* ---------- pocket scanner ----------
   The panel makes a random topic and key and shows them as a QR code that opens the site's
   Pocket scanner page on a phone. The phone encrypts each photo with AES-CTR and sends it to
   ntfy.sh/<topic>. Here we poll that topic, decrypt, and place the photo.
   Format: "THS1" + 16-byte counter + ciphertext. */
const SITE = "https://harastiaj-star.github.io/trailheadtools/";
const libAES = () => { try { if (typeof aesjs !== "undefined") return aesjs; } catch (e) {} try { return require("./aes.js"); } catch (e) { return null; } };
const libQR = () => { try { if (typeof qrcode !== "undefined") return qrcode; } catch (e) {} try { return require("./qrcode.js"); } catch (e) { return null; } };
function randomBytes(n) {
  const out = new Uint8Array(n);
  try { if (typeof crypto !== "undefined" && crypto.getRandomValues) { crypto.getRandomValues(out); return out; } } catch (e) {}
  /* fallback if this Photoshop has no Web Crypto: mixes time and Math.random, weaker but still unguessable in practice */
  let t = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
  for (let i = 0; i < n; i++) { t = (t * 1103515245 + 12345 + Math.floor(Math.random() * 65536)) >>> 0; out[i] = (t >>> 16) & 255; }
  return out;
}
const toHex = b => Array.from(b, v => v.toString(16).padStart(2, "0")).join("");
function newPairing() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789", r = randomBytes(16);
  return { t: "trailhead-" + Array.from(r, v => alphabet[v % alphabet.length]).join(""), k: toHex(randomBytes(16)), since: Math.floor(Date.now() / 1000) };
}
function decryptScan(buf, keyHex) {
  const b = new Uint8Array(buf);
  if (b.length < 21 || b[0] !== 84 || b[1] !== 72 || b[2] !== 83 || b[3] !== 49) throw new Error("That file wasn't from the Trailhead scanner.");
  const A = libAES(); if (!A) throw new Error("The panel's decryption code is missing. Reinstall the plugin.");
  const key = A.utils.hex.toBytes(keyHex), iv = b.slice(4, 20);
  return new A.ModeOfOperation.ctr(key, new A.Counter(iv)).decrypt(b.slice(20));
}
const imageKind = b => b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b[0] === 0x89 && b[1] === 0x50 ? "png" : null;
async function placeScan(file, intoDoc) {
  let doc = null; try { doc = ps.app.activeDocument; } catch (e) {}
  if (!intoDoc || !doc) { await openEntry(file); return "opened as a new document"; }
  const token = uxp.storage.localFileSystem.createSessionToken(file);
  await modal("Place scan", async () => {
    await ps.action.batchPlay([{ _obj: "placeEvent", null: { _path: token, _kind: "local" }, freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" }, offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } }, _options: { dialogOptions: "dontDisplay" } }], {});
  });
  return "placed on a new layer";
}
function drawQR(box, text) {
  while (box.firstChild) box.removeChild(box.firstChild);
  const Q = libQR(); if (!Q) { box.textContent = "The QR code library is missing. Reinstall the plugin."; return; }
  const q = Q(0, "L"); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 3, cell = Math.max(3, Math.floor(196 / (n + quiet * 2)));
  box.style.width = (n + quiet * 2) * cell + "px"; box.style.padding = quiet * cell + "px"; box.style.backgroundColor = "#ffffff";
  for (let r = 0; r < n; r++) {
    const row = document.createElement("div"); row.style.display = "flex"; row.style.height = cell + "px";
    for (let c = 0; c < n; c++) { const d = document.createElement("div"); d.style.width = cell + "px"; d.style.height = cell + "px"; d.style.backgroundColor = q.isDark(r, c) ? "#141210" : "#ffffff"; row.appendChild(d); }
    box.appendChild(row);
  }
}
function setupScanner() {
  const pairBtn = document.getElementById("scPair"), qrBox = document.getElementById("scQR"), linkEl = document.getElementById("scLink"), stateEl = document.getElementById("scState"), stopBtn = document.getElementById("scForget"), into = document.getElementById("scInto");
  let pair = null, timer = null, busy = false, seen = {};
  try { pair = JSON.parse(localStorage.getItem("trailhead-scanner") || "null"); } catch (e) {}
  const save = () => { try { localStorage.setItem("trailhead-scanner", JSON.stringify(pair)); } catch (e) {} };
  const url = () => `${SITE}#scanner?t=${pair.t}&k=${pair.k}`;
  const render = () => {
    const on = !!pair; qrBox.style.display = on ? "block" : "none"; linkEl.style.display = on ? "block" : "none"; stopBtn.style.display = on ? "inline-block" : "none";
    pairBtn.textContent = on ? "Show the code again" : "Pair a phone";
    if (on) { drawQR(qrBox, url()); linkEl.textContent = url(); stateEl.textContent = "Listening for photos. Keep this panel open."; }
    else stateEl.textContent = "Not paired.";
  };
  async function poll() {
    if (!pair || busy) return; busy = true;
    try {
      const r = await fetch(`https://ntfy.sh/${pair.t}/json?poll=1&since=${pair.since}`);
      if (!r.ok) throw new Error("relay " + r.status);
      const lines = (await r.text()).split("\n").filter(Boolean);
      for (const line of lines) {
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.event !== "message" || seen[m.id]) continue; seen[m.id] = 1; pair.since = m.id; save();
        if (!m.attachment || !m.attachment.url) continue;
        stateEl.textContent = "A photo is coming in…";
        const a = await fetch(m.attachment.url); if (!a.ok) { status("A photo arrived but had already expired on the relay.", true); continue; }
        const plain = decryptScan(await a.arrayBuffer(), pair.k), kind = imageKind(plain);
        if (!kind) { status("A photo arrived but didn't unlock. Pair the phone again.", true); continue; }
        const base = (m.attachment.name || "scan").replace(/\.ths$/i, "").replace(/\.(jpg|png)$/i, "").replace(/[^a-z0-9_-]+/gi, "-");
        const f = await writeTemp(base + "." + kind, plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength));
        const how = await placeScan(f, into.checked);
        status("Scan " + how + ".");
      }
      stateEl.textContent = "Listening for photos. Keep this panel open.";
    } catch (e) { stateEl.textContent = "Can't reach the relay right now. Trying again…"; }
    busy = false;
  }
  const start = () => { if (timer) clearInterval(timer); if (pair) { timer = setInterval(poll, 4000); poll(); } };
  pairBtn.addEventListener("click", () => { if (!pair) { pair = newPairing(); save(); } render(); start(); status("Scan the code with your phone's camera."); });
  stopBtn.addEventListener("click", () => { pair = null; try { localStorage.removeItem("trailhead-scanner"); } catch (e) {} if (timer) clearInterval(timer); timer = null; render(); status("Unpaired. Photos from that phone won't arrive anymore."); });
  render(); start();
}

function setupDither() {
  const $i = id => document.getElementById(id);
  const presetItems = [["Your own settings", ""]].concat(Object.keys(DITHER_PRESETS).map(k => [k, k])), algoItems = DITHER_ALGOS.map(a => [a, a]);
  const toneItems = [["1 ink", "1"], ["2 inks", "2"], ["3 inks", "3"]], angleItems = [["45°", "45"], ["15°", "15"], ["30°", "30"], ["60°", "60"], ["75°", "75"], ["0°", "0"], ["90°", "90"]];
  fillSelect($i("dtPreset"), presetItems); fillSelect($i("dtAlgo"), algoItems); fillSelect($i("dtTones"), toneItems); fillSelect($i("dtAngle"), angleItems);
  const sliders = ["dtCell", "dtBrightness", "dtContrast", "dtSharpen", "dtRadius", "dtBlur", "dtDenoise", "dtNoise"], keyOf = { dtCell: "cell", dtBrightness: "brightness", dtContrast: "contrast", dtSharpen: "sharpen", dtRadius: "radius", dtBlur: "blur", dtDenoise: "denoise", dtNoise: "noise" };
  const hexes = { dtInk1: "ink1", dtInk2: "ink2", dtInk3: "ink3", dtBg: "bg" };
  const setSel = (sel, items, v) => { const i = items.findIndex(it => it[1] === String(v)); if (i >= 0) { try { sel.selectedIndex = i; } catch (e) {} sel.value = String(v); } };
  const validHex = v => /^#[0-9a-f]{6}$/i.test(v);
  function read() {
    const o = Object.assign({}, DITHER_DEFAULTS);
    o.algo = readSelect($i("dtAlgo"), algoItems); o.tones = +readSelect($i("dtTones"), toneItems); o.angle = +readSelect($i("dtAngle"), angleItems);
    sliders.forEach(id => { o[keyOf[id]] = +$i(id).value; });
    Object.keys(hexes).forEach(id => { const v = $i(id).value.trim().toLowerCase(); if (validHex(v) || (id === "dtBg" && v === "transparent")) o[hexes[id]] = v; });
    o.invert = !!$i("dtInvert").checked; return o;
  }
  function paint(o) {
    sliders.forEach(id => { $i(id + "V").textContent = id === "dtCell" ? o.cell + " px" : String(o[keyOf[id]]); });
    Object.keys(hexes).forEach(id => { const v = o[hexes[id]]; $i(id + "C").style.backgroundColor = v === "transparent" ? "transparent" : v; });
    $i("dtInk2W").style.display = o.tones >= 2 ? "block" : "none"; $i("dtInk3W").style.display = o.tones >= 3 ? "block" : "none";
    $i("dtAngleWrap").style.visibility = /Halftone|Line|Cross/.test(o.algo) ? "visible" : "hidden";
  }
  function load(o) {
    setSel($i("dtAlgo"), algoItems, o.algo); setSel($i("dtTones"), toneItems, o.tones); setSel($i("dtAngle"), angleItems, o.angle);
    sliders.forEach(id => { $i(id).value = o[keyOf[id]]; });
    Object.keys(hexes).forEach(id => { $i(id).value = o[hexes[id]]; }); $i("dtInvert").checked = !!o.invert; paint(o);
  }
  let t = 0, busy = false, again = false;
  async function preview() {
    if (busy) { again = true; return; } busy = true;
    try {
      let doc = null; try { doc = ps.app.activeDocument; } catch (e) {}
      if (!doc) { $i("dtPrevNote").textContent = "Open a document to see a preview."; $i("dtPrev").style.display = "none"; return; }
      $i("dtPrevNote").textContent = "Drawing the preview…";
      const b64 = await ditherPreview(read(), 360);
      $i("dtPrev").src = "data:image/jpeg;base64," + b64; $i("dtPrev").style.display = "block"; $i("dtPrevNote").textContent = "Actual size, from the middle of your document.";
    } catch (e) { $i("dtPrev").style.display = "none"; $i("dtPrevNote").textContent = /encode/i.test(e.message || "") ? "Preview needs Photoshop 2024 or newer. Apply still works." : (e.message || "Couldn't draw the preview."); }
    finally { busy = false; if (again) { again = false; preview(); } }
  }
  const changed = () => { $i("dtPreset").value = ""; try { $i("dtPreset").selectedIndex = 0; } catch (e) {} paint(read()); clearTimeout(t); t = setTimeout(preview, 450); };
  sliders.forEach(id => { $i(id).addEventListener("input", () => paint(read())); $i(id).addEventListener("change", changed); });
  ["dtAlgo", "dtTones", "dtAngle", "dtInvert"].forEach(id => $i(id).addEventListener("change", changed));
  Object.keys(hexes).forEach(id => $i(id).addEventListener("change", changed));
  $i("dtPreset").addEventListener("change", () => { const k = readSelect($i("dtPreset"), presetItems); if (!k) return; load(Object.assign({}, DITHER_DEFAULTS, DITHER_PRESETS[k])); setSel($i("dtPreset"), presetItems, k); clearTimeout(t); t = setTimeout(preview, 100); });
  $i("dtPrevBtn").addEventListener("click", preview);
  $i("dtApply").addEventListener("click", async () => { const o = read(); status(`Dithering with ${o.algo}… big documents take a few seconds.`); try { await applyDither(o); status(`Dither (${o.algo}) is on a new layer above your photo. Your original layers weren't touched.`); } catch (e) { status(e.message, true); } });
  load(Object.assign({}, DITHER_DEFAULTS));
}
function setupPanel() {
  const palPick = document.getElementById("palPick"), sw = document.getElementById("swatches"), inkPick = document.getElementById("inkPick"), texPick = document.getElementById("texPick");
  fillSelect(palPick, PAL_ITEMS); fillSelect(inkPick, INK_ITEMS); fillSelect(texPick, TEX_ITEMS);
  const currentPal = () => readSelect(palPick, PAL_ITEMS);
  const drawSwatches = () => {
    while (sw.firstChild) sw.removeChild(sw.firstChild);
    (PALETTES[currentPal()] || []).forEach(([name, hex]) => {
      const d = document.createElement("div"); d.className = "sw"; d.title = name + " " + hex; d.style.backgroundColor = hex;
      d.addEventListener("click", async () => { try { await setForeground(hex); status(name + " is your foreground color."); } catch (e) { status(e.message, true); } });
      sw.appendChild(d);
    });
  };
  palPick.addEventListener("change", drawSwatches); drawSwatches();
  document.getElementById("addSwatches").addEventListener("click", async () => {
    const name = currentPal();
    try { await addSwatches(PALETTES[name].map(([n, hex]) => ({ name: n, rgb: hexToRgb(hex) })), name); status(name + " is in your Swatches panel."); }
    catch (e) { status("Couldn't add the swatches: " + e.message, true); }
  });
  document.getElementById("openBtn").addEventListener("click", async () => {
    try {
      const file = await uxp.storage.localFileSystem.getFileForOpening({ types: ["zip", "psd", "ase", "png", "jpg", "otf"] });
      if (!file) return;
      status("Opening " + file.name + "…"); status(await handleFile(file));
    } catch (e) { status(e.message, true); }
  });
  document.getElementById("texBtn").addEventListener("click", async () => {
    const kind = readSelect(texPick, TEX_ITEMS), ink = readSelect(inkPick, INK_ITEMS);
    status("Painting " + kind.toLowerCase() + "… big documents take a few seconds.");
    try { await addTexture(kind, ink); status(kind + " is on its own layer. Try Multiply or lower the opacity."); }
    catch (e) { status(e.message, true); }
  });
  const pulled = document.getElementById("pulled"), pullAdd = document.getElementById("pullAdd"), countPick = document.getElementById("countPick");
  const COUNT_ITEMS = [["6 colors", "6"], ["4 colors", "4"], ["8 colors", "8"]];
  fillSelect(countPick, COUNT_ITEMS);
  let lastPulled = [];
  pullAdd.style.display = "none";
  document.getElementById("pullBtn").addEventListener("click", async () => {
    status("Reading the colors in this document…");
    try {
      lastPulled = await documentColors(Number(readSelect(countPick, COUNT_ITEMS)));
      while (pulled.firstChild) pulled.removeChild(pulled.firstChild);
      lastPulled.forEach(c => {
        const d = document.createElement("div"); d.className = "sw"; d.title = c.name + " " + c.hex + " · " + Math.round(c.share * 100) + "%"; d.style.backgroundColor = c.hex;
        d.addEventListener("click", async () => { try { await setForeground(c.hex); status(c.name + " " + c.hex.toUpperCase() + " is your foreground color."); } catch (e) { status(e.message, true); } });
        pulled.appendChild(d);
      });
      pullAdd.style.display = lastPulled.length ? "inline-block" : "none";
      status("Found " + lastPulled.length + " main colors, largest first. Tap one to use it.");
    } catch (e) { status(e.message, true); }
  });
  pullAdd.addEventListener("click", async () => {
    if (!lastPulled.length) return;
    let name = "From document"; try { name = "From " + (ps.app.activeDocument.title || ps.app.activeDocument.name || "document"); } catch (e) {}
    try { await addSwatches(lastPulled.map(c => ({ name: c.name, rgb: hexToRgb(c.hex) })), name); status("Added " + lastPulled.length + " colors to your Swatches panel."); }
    catch (e) { status("Couldn't add the swatches: " + e.message, true); }
  });
  const fxPick = document.getElementById("fxPick"), fxInk = document.getElementById("fxInk"), fxDetail = document.getElementById("fxDetail"), fxPaper = document.getElementById("fxPaper");
  fillSelect(fxPick, FX_ITEMS); fillSelect(fxInk, INK_ITEMS.filter(i => i[0] !== "Paper").concat([["Paper (for dark backgrounds)", "#f7f0dd"]])); fillSelect(fxDetail, DETAIL_ITEMS); fillSelect(fxPaper, PAPER_ITEMS);
  const FX_INKS = INK_ITEMS.filter(i => i[0] !== "Paper").concat([["Paper (for dark backgrounds)", "#f7f0dd"]]);
  document.getElementById("fxBtn").addEventListener("click", async () => {
    const kind = readSelect(fxPick, FX_ITEMS), ink = readSelect(fxInk, FX_INKS), detail = readSelect(fxDetail, DETAIL_ITEMS);
    const pi = typeof fxPaper.selectedIndex === "number" && fxPaper.selectedIndex >= 0 ? fxPaper.selectedIndex : 0, paper = PAPER_ITEMS[pi] ? PAPER_ITEMS[pi][1] : "";
    status("Running " + kind.toLowerCase() + "… this takes a few seconds on big photos.");
    try {
      await applyFilter(kind, ink, detail, paper);
      status(kind === "Cyanotype negative" ? "The negative is on a new layer. Before printing it on film, flip it with Image › Image Rotation › Flip Canvas Horizontal." : kind + " is on a new layer above your photo. Your original layers weren't touched.");
    } catch (e) { status(e.message, true); }
  });
  try { setupDither(); } catch (e) { status("Dither didn't start: " + e.message, true); }
  try { setupPixel(); } catch (e) { status("Pixel art didn't start: " + e.message, true); }
  try { setupScanner(); } catch (e) { status("The pocket scanner didn't start: " + e.message, true); }
  status("Ready. Messages and errors show up here.");
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("error", e => { try { status("Error: " + (e.message || e.error), true); } catch (err) {} });
  window.addEventListener("unhandledrejection", e => { try { status("Error: " + ((e.reason && e.reason.message) || e.reason), true); } catch (err) {} });
  if (!ps) { try { status("The panel couldn't reach Photoshop. Restart Photoshop and open Plugins › Trailhead again.", true); } catch (err) {} }
  else { try { setupPanel(); } catch (e) { status("The panel didn't start: " + e.message, true); } }
  /* Photoshop panels don't support viewport units, so size the scroll area from the panel's real height. */
  const fitScroll = () => { const el = document.querySelector(".scroll"); if (el && window.innerHeight) el.style.height = window.innerHeight + "px"; };
  try { fitScroll(); window.addEventListener("resize", fitScroll); } catch (e) {}
}
if (typeof module !== "undefined" && module.exports) module.exports = { pixelMask, pixelCells, pixelRGBA, PIXEL_LOOKS, ditherRGBA, ditherPrep, ditherLevels, DITHER_PRESETS, DITHER_DEFAULTS, DITHER_ALGOS, decryptScan, newPairing, imageKind, readZip, readASE, textureRGBA, textureAlpha, mainColors, pixelsToPoints, filterRGBA, grayFromPixels };
