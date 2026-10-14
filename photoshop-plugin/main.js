/* Trailhead for Photoshop
   A UXP panel that picks up where the Trailhead site leaves off:
   opens Trailhead downloads (zipped or not), adds trail palettes as swatches,
   runs Trailhead photo filters, paints Trailhead textures onto new layers, and receives
   photos from a phone through the pocket scanner. */

let ps = null, uxp = null;
try { ps = require("photoshop"); uxp = require("uxp"); } catch (e) { /* running outside Photoshop (tests) */ }

/* ---------- palettes (same as the site) ---------- */
const PALETTES = {
  "Pine Forest": [["Deep Fir", "#2f3d2c"], ["Spruce", "#4f6b45"], ["Fern", "#7d9466"], ["Lichen", "#b9c39a"], ["Bark", "#8a5a3b"], ["Birch", "#efe9d6"]],
  "Alpine Lake": [["Deep Water", "#1f3b4d"], ["Lake", "#3f6e86"], ["Glacier", "#8fb3bf"], ["Snowmelt", "#d9e4df"], ["Treeline", "#6d7b62"], ["Granite", "#a7988a"]],
  "Wildflower Meadow": [["Meadow Grass", "#5f7a3e"], ["Goldenrod", "#c9a227"], ["Fireweed", "#b85c7a"], ["Lupine", "#7d6fa8"], ["Dry Grass", "#e8d9b0"], ["Cloud", "#f4efe1"]],
  "Autumn Ridge": [["Maple", "#7a2e1d"], ["Rust Leaf", "#b5542b"], ["Aspen Gold", "#d89a3c"], ["Oak Bark", "#6e5a3a"], ["Sedge", "#8c8a5c"], ["Frost", "#efe3c8"]],
  "Coastal Fog": [["Sea Stone", "#3e5560"], ["Fog Bank", "#6f8a8f"], ["Sea Glass", "#a9bcb8"], ["Mist", "#d8dcd3"], ["Driftwood", "#9c8f74"], ["Dune Grass", "#5d6b4a"]],
  "Campfire Night": [["Night Sky", "#1e2433"], ["Dusk", "#3a3f5c"], ["Ember", "#c4572b"], ["Flame", "#e8a33d"], ["Moonlight", "#f2e4c4"], ["Pine Shadow", "#4a5a3f"]],
  "Desert Summer": [["Wet Clay", "#894c29"], ["Burnt Sunrise", "#c07640"], ["Pollen Dust", "#e0a85a"], ["Toe Beans", "#cd774d"], ["Sage Olive", "#b5ae7d"], ["Pine Needles", "#666a57"], ["Dry Pottery", "#f7e7cc"], ["Desert Aloe", "#c9cdbd"]],
  "Trail": [["Trail Orange", "#d2693a"], ["Boot Red", "#b60001"], ["Trail Sage", "#80ac8b"], ["Forest", "#516743"], ["Paper", "#f7f0dd"]],
  "Folk Poster": [["Folk Green", "#3c7c59"], ["Folk Red", "#df3222"], ["Marigold", "#e09542"], ["Ink Black", "#141210"], ["Paper", "#f7f0dd"]],
  "Western Editorial": [["Newsprint", "#f4f1ea"], ["Ink Black", "#141210"], ["Mesa Red", "#a8512f"], ["Wet Clay", "#894c29"]]
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
if (typeof module !== "undefined" && module.exports) module.exports = { decryptScan, newPairing, imageKind, readZip, readASE, textureRGBA, textureAlpha, mainColors, pixelsToPoints, filterRGBA, grayFromPixels };
