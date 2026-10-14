// Pixel-art renderer for the real USyd campus (OpenStreetMap data in map.json).
// Everything is rasterised per pixel with no anti-aliasing at PPM art-pixels per metre, then drawn with nearest-neighbour scaling.
// Borrowed from the Brawl renderer: top-left key light, banded form shading, self-coloured ink outlines,
// deterministic hashing for texture, and aggressive sprite/chunk caching with a per-frame work budget.
window.World = (() => {
const PPM = 8, K = 0.6, CH = 512, FH = 3.6 * K * PPM;
let D = null, info = null, IW = 0, IH = 0, ready = false;

/* ---------- maths / colour ---------- */
const hash = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = t => t * t * (3 - 2 * t);
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - .47);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const P = h => pack(rgb(h));
const unpack = c => [c & 255, c >> 8 & 255, c >> 16 & 255];
const mixP = (c, h, k) => { const a = unpack(c), b = rgb(h); return pack(a.map((v, i) => Math.round(v + (b[i] - v) * k))); };
const SHADE_CACHE = new Map();
const shade = c => { let v = SHADE_CACHE.get(c); if (v === undefined) { v = mixP(c, '#24285a', .34); SHADE_CACHE.set(c, v); } return v; };
const inkOf = c => mixP(c, '#14101f', .62);

/* ---------- rasterisers (pixel centres, even-odd, no AA) ---------- */
function scan(rings, s, ox, oy, w, h, fn) {
  let y0 = 1e9, y1 = -1e9;
  for (const r of rings) for (let i = 1; i < r.length; i += 2) { const y = r[i] * s; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const ys = Math.max(0, Math.floor(y0 - oy)), ye = Math.min(h - 1, Math.ceil(y1 - oy)), xs = [];
  for (let py = ys; py <= ye; py++) {
    const sy = py + oy + .5; xs.length = 0;
    for (const r of rings) { const n = r.length; for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ay = r[j + 1] * s, by = r[i + 1] * s;
      if ((ay <= sy) !== (by <= sy)) xs.push(r[j] * s + (sy - ay) / (by - ay) * (r[i] * s - r[j] * s)); } }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let a = Math.ceil(xs[k] - ox - .5), b = Math.floor(xs[k + 1] - ox - .5);
      if (a < 0) a = 0; if (b > w - 1) b = w - 1;
      for (let px = a; px <= b; px++) fn(py * w + px, px, py);
    }
  }
}
// thick polyline: fn(index, px, py, signedDist(px), along(px))
function stroke(pts, width, s, ox, oy, w, h, fn) {
  const r = width * s / 2; let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i] * s - ox, ay = pts[i + 1] * s - oy, bx = pts[i + 2] * s - ox, by = pts[i + 3] * s - oy;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-6, ux = dx / L, uy = dy / L;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + .5 - ax, qy = py + .5 - ay, t = qx * ux + qy * uy;
      const tc = t < 0 ? 0 : t > L ? L : t, ex = qx - ux * tc, ey = qy - uy * tc;
      if (ex * ex + ey * ey <= r * r) fn(py * w + px, px, py, qx * -uy + qy * ux, acc + t);
    }
    acc += L;
  }
}

/* ---------- ground materials ---------- */
const M = { GRASS: 0, TALL: 1, WOOD: 2, PITCH: 3, PAVE: 4, PLAZA: 5, ROAD: 6, SERV: 7, MARK: 8, WATER: 9, POOL: 10, PARK: 11,
  RAILBED: 12, RAIL: 13, SLEEPER: 14, HEDGE: 15, WALL: 16, FENCE: 17, STEPA: 18, STEPB: 19, BRIDGE: 20 };
const SOFT = new Set([M.GRASS, M.TALL, M.WOOD, M.PITCH]);
const ROADS = new Set([M.ROAD, M.SERV, M.MARK, M.PARK]);
const pal = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map(P)]));
const C = pal({
  grass: ['#6cc04a', '#7fd05a', '#58a83e', '#4b9437'], tall: ['#3f9a3c', '#5cbc4e', '#2a7430', '#1e5a26'],
  wood: ['#4a9a3e', '#5aac48', '#3b8235'], pitch: ['#62bb4c', '#74c85a'],
  pave: ['#ebdfbf', '#f4ead0', '#d6c79d', '#b3a273'], plaza: ['#e6e0cf', '#efeadc', '#d2cab3', '#b2a98e'],
  road: ['#696d78', '#787c87', '#5c606a', '#b8bcc6'], serv: ['#7d808a', '#8a8d97', '#70737d', '#b8bcc6'], mark: ['#f4f4f0', '#d8d8d2'],
  water: ['#4b93e6', '#76b6fa', '#3a7dd2', '#d8f0ff', '#9cd2ff'], pool: ['#5fd0f2', '#8fe4ff', '#3db2dc', '#f2f2ea'],
  park: ['#80838c', '#8e919a'], railbed: ['#8c7f6b', '#9d917c', '#776b58'], rail: ['#c6c9d1'], sleeper: ['#6b5038'],
  hedge: ['#3e8f3a', '#56ad4a', '#2b6e2c', '#1d4e22'], wall: ['#c3b8a2', '#d9d0bc', '#9c907a'], fence: ['#8a7b68', '#5d5245'],
  step: ['#e2d6b4', '#c8b98e'], bridge: ['#cfcbc2', '#e0ddd5', '#6d6a64'], flower: ['#ff6b8a', '#ffd84a', '#ffffff', '#c58bff'],
});
const AREA = { grass: M.GRASS, wood: M.WOOD, pitch: M.PITCH, parking: M.PARK, plaza: M.PLAZA, pool: M.POOL, water: M.WATER };
const tallCell = (mx, my) => vnoise((mx >> 1) / 3.2 + 50, (my >> 1) / 3.2 + 50) > .55;

function groundColour(m, wx, wy, i, mat, w) {
  const up = mat[i - w], dn = mat[i + w], lf = mat[i - 1], rt = mat[i + 1], hv = hash(wx, wy);
  switch (m) {
    case M.GRASS: {
      const n = vnoise(wx / 64, wy / 64) + bay(wx, wy) * .1;
      let c = n > .74 ? C.grass[1] : n < .24 ? C.grass[2] : C.grass[0];
      const cx = wx >> 3, cy = wy >> 3, hc = hash(cx, cy), lx = wx & 7, ly = wy & 7;
      if (hc < .32) { const tx = (hc * 977 | 0) % 5 + 1, ty = (hc * 3331 | 0) % 5 + 2;
        if ((lx === tx && ly === ty) || (lx === tx + 1 && ly === ty - 1) || (lx === tx + 2 && ly === ty)) c = C.grass[3]; }
      const fx = wx >> 4, fy = wy >> 4, hf = hash(fx + 9e3, fy);
      if (hf < .02) { const ox = (hf * 5e3 | 0) % 10 + 3, oy = (hf * 7e4 | 0) % 10 + 3, ax = (wx & 15) - ox, ay = (wy & 15) - oy;
        if (ax === 0 && ay === 0) c = C.flower[1]; else if (Math.abs(ax) + Math.abs(ay) === 1) c = C.flower[(hf * 1e5 | 0) % 4 === 1 ? 0 : (hf * 1e5 | 0) % 4]; }
      return c;
    }
    case M.TALL: {
      const sx = (wx + ((wy >> 3) & 1) * 4) & 7, ly = wy & 7;
      if (up !== M.TALL && up !== undefined) return C.tall[3];
      if (ly === 7) return C.tall[2];
      if (sx % 3 === 0) return ly < 2 ? C.tall[0] : C.tall[2];
      if (ly <= 2 && sx % 3 === 1) return C.tall[1];
      return C.tall[0];
    }
    case M.WOOD: { const n = vnoise(wx / 20, wy / 20) + bay(wx, wy) * .3; return hv < .08 ? C.wood[2] : n > .6 ? C.wood[1] : C.wood[0]; }
    case M.PITCH: return ((wx / 40 | 0) + (wy / 400 | 0)) & 1 ? C.pitch[1] : C.pitch[0];
    case M.PAVE: case M.PLAZA: {
      const p = m === M.PAVE ? C.pave : C.plaza;
      if (SOFT.has(up) || SOFT.has(dn) || SOFT.has(lf) || SOFT.has(rt)) return p[3];
      if (m === M.PAVE) { if ((wy & 7) === 0 || ((wx + ((wy >> 3) & 1) * 8) & 15) === 0) return p[2]; return hv < .04 ? p[2] : p[0]; }
      if ((wx & 15) === 0 || (wy & 15) === 0) return p[2];
      return ((wx >> 4) + (wy >> 4)) & 1 ? p[1] : p[0];
    }
    case M.ROAD: case M.SERV: case M.PARK: {
      const p = m === M.ROAD ? C.road : m === M.SERV ? C.serv : C.road;
      if (!ROADS.has(up) || !ROADS.has(dn) || !ROADS.has(lf) || !ROADS.has(rt)) return p[3];
      return hv < .05 ? p[1] : hv < .11 ? p[2] : p[0];
    }
    case M.MARK: return hv < .06 ? C.mark[1] : C.mark[0];
    case M.WATER: {
      if (up !== M.WATER || dn !== M.WATER || lf !== M.WATER || rt !== M.WATER) return C.water[3];
      if (mat[i - 2 * w] !== M.WATER || mat[i - 2] !== M.WATER || mat[i + 2] !== M.WATER) return C.water[4];
      const row = wy >> 2, wave = (wx + row * 5 + (row >> 1) * 3) & 15;
      if ((wy & 3) === 0 && wave < 4) return C.water[1];
      return vnoise(wx / 40, wy / 40) + bay(wx, wy) * .2 > .62 ? C.water[2] : C.water[0];
    }
    case M.POOL: if (up !== M.POOL || dn !== M.POOL || lf !== M.POOL || rt !== M.POOL) return C.pool[3];
      return (wx % 20) === 10 ? C.pool[2] : ((wy >> 2) + (wx >> 3)) % 5 === 0 && (wy & 3) === 0 ? C.pool[1] : C.pool[0];
    case M.RAILBED: return hv < .25 ? C.railbed[1] : hv > .8 ? C.railbed[2] : C.railbed[0];
    case M.RAIL: return C.rail[0];
    case M.SLEEPER: return C.sleeper[0];
    case M.HEDGE: if (up !== M.HEDGE) return C.hedge[1]; if (dn !== M.HEDGE) return C.hedge[3];
      if (lf !== M.HEDGE || rt !== M.HEDGE) return C.hedge[2]; return hv < .22 ? C.hedge[1] : hv > .86 ? C.hedge[2] : C.hedge[0];
    case M.WALL: return up !== M.WALL ? C.wall[1] : dn !== M.WALL ? C.wall[2] : ((wx + (wy & 2) * 2) & 7) === 0 ? C.wall[2] : C.wall[0];
    case M.FENCE: return (wx & 15) < 2 ? C.fence[1] : C.fence[0];
    case M.STEPA: return C.step[0];
    case M.STEPB: return C.step[1];
    case M.BRIDGE: return (up !== M.BRIDGE || dn !== M.BRIDGE || lf !== M.BRIDGE || rt !== M.BRIDGE) ? C.bridge[2] : (wx & 7) === 0 ? C.bridge[1] : C.bridge[0];
  }
  return C.grass[0];
}

const WALK_LINES = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track']);
const ROAD_LINES = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'tertiary', 'unclassified', 'residential']);
function renderChunk(cx, cy) {
  const w = CH + 2, h = CH + 2, ox = cx * CH - 1, oy = cy * CH - 1;
  const mat = new Uint8Array(w * h), sh = new Uint8Array(w * h);
  const mx0 = ox / PPM, my0 = oy / PPM, mx1 = (ox + w) / PPM, my1 = (oy + h) / PPM;
  const hit = (b, pad = 0) => b[2] + pad >= mx0 && b[0] - pad <= mx1 && b[3] + pad >= my0 && b[1] - pad <= my1;
  for (const a of D.areas) {
    if (!hit(a.bb)) continue;
    if (a.k === 'wild') scan(a.r, PPM, ox, oy, w, h, (i, px, py) => { mat[i] = tallCell(Math.floor((ox + px) / PPM), Math.floor((oy + py) / PPM)) ? M.TALL : M.GRASS; });
    else if (AREA[a.k] !== undefined) { const m = AREA[a.k]; scan(a.r, PPM, ox, oy, w, h, i => { mat[i] = m; }); }
  }
  for (const l of D.lines) {
    if (!hit(l.bb, l.w)) continue;
    if (l.k === 'rail') { stroke(l.p, 3.4, PPM, ox, oy, w, h, (i, px, py, d, al) => { const a = Math.abs(d);
      mat[i] = Math.abs(a - 5.7) < .8 ? M.RAIL : (al % 7 < 2.5 && a < 8.5) ? M.SLEEPER : M.RAILBED; }); continue; }
    if (ROAD_LINES.has(l.k) || l.k === 'service' || l.k === 'aisle' || l.k === 'living_street') {
      const major = l.w >= 11, m = ROAD_LINES.has(l.k) ? M.ROAD : M.SERV, half = l.w * PPM / 2;
      stroke(l.p, l.w, PPM, ox, oy, w, h, (i, px, py, d, al) => {
        const a = Math.abs(d); let v = m;
        if (major && al % 64 < 32 && (a < .75 || (l.w >= 16 && Math.abs(a - half / 2) < .6))) v = M.MARK;
        if (major && Math.abs(a - half + 3) < .55) v = M.MARK;
        if (mat[i] !== M.BRIDGE) mat[i] = v;
      });
    }
  }
  for (const l of D.lines) {
    if (!WALK_LINES.has(l.k) || l.bridge || !hit(l.bb, l.w)) continue;
    const m = l.k === 'pedestrian' ? M.PLAZA : M.PAVE;
    stroke(l.p, l.w, PPM, ox, oy, w, h, (i, px, py, d, al) => {
      if (ROADS.has(mat[i]) || mat[i] === M.WATER) return;
      mat[i] = l.k === 'steps' ? ((al / 3 | 0) & 1 ? M.STEPA : M.STEPB) : m;
    });
  }
  for (const b of D.bars) { if (!hit(b.bb, 1)) continue; const m = b.k === 'hedge' ? M.HEDGE : b.k === 'fence' || b.k === 'guard_rail' ? M.FENCE : M.WALL;
    stroke(b.p, m === M.HEDGE ? 1.1 : m === M.WALL ? .5 : .26, PPM, ox, oy, w, h, i => { if (mat[i] !== M.WATER) mat[i] = m; }); }
  for (const c of D.cross) {
    const [x, y, ang, rw] = c; if (x < mx0 - 12 || x > mx1 + 12 || y < my0 - 12 || y > my1 + 12) continue;
    const ux = Math.cos(ang), uy = Math.sin(ang), R = (rw / 2 + .5) * PPM, cpx = x * PPM - ox, cpy = y * PPM - oy;
    for (let py = Math.max(0, cpy - R | 0); py <= Math.min(h - 1, cpy + R); py++) for (let px = Math.max(0, cpx - R | 0); px <= Math.min(w - 1, cpx + R); px++) {
      const qx = px + .5 - cpx, qy = py + .5 - cpy, u = qx * ux + qy * uy, v = -qx * uy + qy * ux, i = py * w + px;
      if (Math.abs(u) < 1.7 * PPM && Math.abs(v) < R && ROADS.has(mat[i])) mat[i] = (Math.floor(v / 5 + 100) & 1) ? M.MARK : M.ROAD;
    }
  }
  for (const l of D.lines) { if (!l.bridge || !WALK_LINES.has(l.k) || !hit(l.bb, l.w)) continue; stroke(l.p, Math.max(3, l.w), PPM, ox, oy, w, h, i => { mat[i] = M.BRIDGE; }); }
  // cast shadows (key light from top-left)
  for (const b of D.blds) {
    const sl = b.h * .45; if (!hit(b.bb, sl + 2)) continue;
    const vx = sl * .7, vy = sl * .45;
    for (const r of b.r) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
      scan([[r[j], r[j + 1], r[i], r[i + 1], r[i] + vx, r[i + 1] + vy, r[j] + vx, r[j + 1] + vy]], PPM, ox, oy, w, h, k => { sh[k] = 1; });
  }
  for (const t of D.trees) {
    if (t.x < mx0 - 8 || t.x > mx1 + 8 || t.y < my0 - 8 || t.y > my1 + 8) continue;
    const cx2 = (t.x + t.r * .55) * PPM - ox, cy2 = (t.y + t.r * .25) * PPM - oy, rx = t.r * PPM * .95, ry = t.r * PPM * .62;
    for (let py = Math.max(0, cy2 - ry | 0); py <= Math.min(h - 1, cy2 + ry); py++) for (let px = Math.max(0, cx2 - rx | 0); px <= Math.min(w - 1, cx2 + rx); px++)
      if (((px + .5 - cx2) / rx) ** 2 + ((py + .5 - cy2) / ry) ** 2 <= 1) sh[py * w + px] = 1;
  }
  const img = new ImageData(CH, CH), out = new Uint32Array(img.data.buffer);
  for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) {
    const i = py * w + px; let c = groundColour(mat[i], ox + px, oy + py, i, mat, w);
    if (sh[i] && mat[i] !== M.WATER) c = shade(c);
    out[(py - 1) * CH + px - 1] = c;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = CH; cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}

/* ---------- buildings ---------- */
const BPAL = {
  sand: [{ wall: ['#e6c787', '#f3dca6', '#c9a560'], roof: ['#6f7f9a', '#8597b3', '#55637b'], win: '#40587d', frame: '#f6ecd0' }],
  uni: [
    { wall: ['#d9d9dc', '#ececee', '#b5b6bb'], roof: ['#9aa3ae', '#adb5bf', '#838c97'], win: '#4a6d94', frame: '#f0f0f0' },
    { wall: ['#c98a5e', '#dca174', '#a86c45'], roof: ['#7d8794', '#8f99a6', '#69727e'], win: '#3d5c80', frame: '#efe3d2' },
    { wall: ['#eef1f3', '#ffffff', '#c9cfd4'], roof: ['#8fa0ad', '#a3b3c0', '#788895'], win: '#5584b0', frame: '#ffffff' },
    { wall: ['#86b3d6', '#a6cdea', '#6894b8'], roof: ['#b3b8bf', '#c4c9cf', '#9aa0a8'], win: '#2f5b86', frame: '#d8e8f4' },
    { wall: ['#b9a58d', '#cdbba3', '#9a8670'], roof: ['#6d7c6e', '#7f8f80', '#5a685b'], win: '#405a76', frame: '#ece2d2' },
  ],
  house: [
    { wall: ['#f0e2c4', '#fff2d8', '#d4c19c'], roof: ['#c4643c', '#d87a50', '#9e4a2a'], win: '#46648a', frame: '#ffffff' },
    { wall: ['#b8664a', '#cc7c5e', '#954e37'], roof: ['#8b929c', '#9da4ae', '#737a84'], win: '#405c80', frame: '#f2ece2' },
    { wall: ['#e9eef0', '#ffffff', '#c6ccd0'], roof: ['#b85e3e', '#cc7452', '#93462b'], win: '#46648a', frame: '#ffffff' },
  ],
  misc: [{ wall: ['#cfc8bc', '#e0dace', '#aba496'], roof: ['#8e949c', '#a1a7ae', '#767c84'], win: '#4a6480', frame: '#eeeeee' }],
  canopy: [{ wall: ['#9aa0a8', '#b0b6bc', '#80868e'], roof: ['#b9c1c9', '#cbd2d9', '#9ea6ae'], win: '#9aa0a8', frame: '#9aa0a8' }],
};
const LIGHT = [-.6, -.8];
function renderBuilding(b) {
  const pad = 2, Hp = Math.max(4, Math.round(b.h * K * PPM));
  const bx0 = Math.floor(b.bb[0] * PPM) - pad, by0 = Math.floor(b.bb[1] * PPM) - Hp - pad;
  const bw = Math.ceil(b.bb[2] * PPM) + pad - bx0, bh = Math.ceil(b.bb[3] * PPM) + pad - by0;
  if (bw * bh > 4.5e6) return null;
  const fp = new Uint8Array(bw * bh); scan(b.r, PPM, bx0, by0, bw, bh, i => { fp[i] = 1; });
  const role = new Uint8Array(bw * bh), hb = new Int16Array(bw * bh), bottom = new Int32Array(bw).fill(-1);
  for (let x = 0; x < bw; x++) {
    let last = -1;
    for (let y = bh - 1; y >= 0; y--) {
      const i = y * bw + x;
      if (fp[i] && (y === bh - 1 || !fp[i + bw])) { last = y; if (bottom[x] < 0) bottom[x] = y; }
      const ry = y + Hp;
      if (ry < bh && fp[ry * bw + x]) role[i] = 2;
      else if (last >= 0 && last - y <= Hp) { role[i] = 1; hb[i] = last - y; }
    }
  }
  const variants = BPAL[b.mat] || BPAL.misc, pl = variants[b.v % variants.length];
  const W = pl.wall.map(P), R = pl.roof.map(P), WIN = P(pl.win), FR = P(pl.frame), GLASS2 = mixP(WIN, '#a8d4ff', .45), SHINE = P('#e8f6ff');
  const winP = b.mat === 'sand' ? 18 : b.mat === 'house' ? 22 : 14;
  // door: centre of the longest flat run of front wall
  let run = 0, best = 0, bestX = -1;
  for (let x = 1; x < bw; x++) { if (bottom[x] >= 0 && bottom[x] === bottom[x - 1]) { run++; if (run > best) { best = run; bestX = x - (run >> 1); } } else run = 0; }
  const doorW = b.mat === 'house' ? 6 : 10, hasDoor = best > 26 && b.mat !== 'canopy' && Hp > 14;
  // hip-roof shading: roof plane faces the nearest footprint edge
  const edges = [];
  if (b.roof === 'gable') for (const r of b.r) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j] * PPM - bx0, ay = r[j + 1] * PPM - by0, ex = r[i] * PPM - bx0, ey = r[i + 1] * PPM - by0, L = Math.hypot(ex - ax, ey - ay) || 1;
    edges.push([ax, ay, ex, ey, L, (ey - ay) / L * b.orient, -(ex - ax) / L * b.orient]);
  }
  const img = new ImageData(bw, bh), out = new Uint32Array(img.data.buffer);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x, ro = role[i]; if (!ro) continue;
    const wx = bx0 + x; let c;
    if (ro === 2) {
      const fy = y + Hp, wy = by0 + fy, hv = hash(wx, wy);
      if (b.roof === 'gable' && edges.length) {
        let bd = 1e9, bn = null;
        for (const e of edges) { const qx = x + .5 - e[0], qy = fy + .5 - e[1], t = Math.max(0, Math.min(e[4], (qx * (e[2] - e[0]) + qy * (e[3] - e[1])) / e[4]));
          const dx = qx - (e[2] - e[0]) * t / e[4], dy = qy - (e[3] - e[1]) * t / e[4], d = dx * dx + dy * dy; if (d < bd) { bd = d; bn = e; } }
        const lit = bn[5] * LIGHT[0] + bn[6] * LIGHT[1], d = Math.sqrt(bd);
        c = lit > .35 ? R[1] : lit < -.35 ? R[2] : R[0];
        if ((d | 0) % 4 === 3) c = mixP(c, '#1c1830', .22);
      } else {
        const edge = !fp[i + Hp * bw - 1] || !fp[i + Hp * bw + 1] || !fp[i + (Hp - 1) * bw] || !fp[i + (Hp + 1) * bw];
        const inner = !fp[i + (Hp - 2) * bw] || !fp[i + Hp * bw - 2];
        c = edge ? R[1] : inner ? R[2] : (hv < .07 ? R[2] : hv > .95 ? R[1] : R[0]);
        if (!edge && b.mat !== 'canopy') { // rooftop plant and skylights
          const cx = wx / 24 | 0, cy = wy / 24 | 0, hc = hash(cx + 7e3, cy), lx = wx - cx * 24, ly = wy - cy * 24;
          if (hc < .16 && lx >= 6 && lx < 14 && ly >= 7 && ly < 13) c = ly === 7 ? P('#e4e6ea') : lx === 13 || ly === 12 ? P('#8a8f99') : P('#c3c7ce');
          else if (hc > .9 && lx >= 4 && lx < 12 && ly >= 5 && ly < 10) c = ly === 5 || lx === 4 ? P('#d6ecff') : P('#6aa0d6');
        }
      }
    } else {
      const h = hb[i], fl = Math.floor(h / FH), fyy = h - fl * FH, top = Hp - h;
      const front = bottom[x] >= 0 && Math.abs(bottom[x] - (y + h)) < 2;
      const sl = bottom[Math.min(bw - 1, x + 3)] - bottom[Math.max(0, x - 3)];
      let base = W[0]; if (front && sl < -2) base = W[2]; else if (front && sl > 2) base = W[1];
      c = base;
      if (top <= 2) c = mixP(W[2], '#1c1830', .35);
      else if (h <= 1) c = W[2];
      else if (b.mat !== 'canopy') {
        const wl = (wx % winP + winP) % winP, tall = b.mat === 'sand';
        const y0 = tall ? 3 : 5, y1 = tall ? 13 : 12;
        if (fyy < 1 && fl > 0) c = W[1];
        else if (fyy >= y0 && fyy < y1 && wl >= 3 && wl < (tall ? 10 : 10) && top > 4) {
          const ly = y1 - 1 - fyy, lx = wl - 3;
          if (tall && ly === 0 && (lx === 0 || lx === 6)) c = base;
          else if (lx === 0 || ly === 0 || lx === 6 || fyy === y0) c = FR;
          else c = lx - ly === 1 || lx - ly === 2 ? SHINE : ly < 3 ? GLASS2 : WIN;
        }
        if (hasDoor && Math.abs(x - bestX) <= doorW / 2 && bottom[x] === bottom[bestX] && h < 15 && front) {
          const dl = Math.abs(x - bestX);
          c = h === 14 || dl === doorW / 2 ? FR : (b.mat === 'sand' && h === 13 && dl >= doorW / 2 - 1) ? base : dl === 0 ? P('#3a2c22') : P(b.mat === 'house' ? '#7a4e30' : '#5d6b7c');
          if (b.mat !== 'house' && b.mat !== 'sand' && dl !== doorW / 2 && h < 14) c = (x + h) % 5 === 0 ? SHINE : P('#5f8fb8');
        }
      }
    }
    out[i] = c;
  }
  // self-coloured ink: silhouette edge + eave line between roof and wall
  const ink = new Uint32Array(out);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x; if (!role[i]) continue;
    const empty = (xx, yy) => xx < 0 || yy < 0 || xx >= bw || yy >= bh || !role[yy * bw + xx];
    if (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1) || (role[i] === 2 && y + 1 < bh && role[i + bw] === 1)) ink[i] = inkOf(out[i]);
  }
  const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(ink.buffer), bw, bh), 0, 0);
  return { cv, x: bx0, y: by0 };
}

/* ---------- trees ---------- */
const TPAL = [
  { c: ['#2a5e2d', '#3b7c36', '#53a043', '#78c45a'], ink: '#173a1d' },
  { c: ['#46562b', '#5b7035', '#738a44', '#94aa5c'], ink: '#28321a' },
  { c: ['#1f4b36', '#2c6346', '#3d7d57', '#56996d'], ink: '#112a1f' },
  { c: ['#4f3a8c', '#6b52ae', '#8a70cf', '#b29bf0'], ink: '#2c2054' },
];
function renderTree(t) {
  const R = Math.max(12, Math.round(t.r * PPM)), T = Math.round(2.4 * K * PPM), w = 2 * R + 4, h = 2 * R + T + 4;
  const cx = R + 2, cy = R + 2, pi = t.kind === 2 ? 3 : t.kind === 1 ? 2 : (t.v & 3) === 1 ? 1 : 0, pl = TPAL[pi], col = pl.c.map(P), ink = P(pl.ink);
  const blobs = [[0, 0, .8]]; const nb = 5 + (t.v % 3);
  for (let k = 0; k < nb; k++) { const a = k / nb * 6.283 + hash(t.v, k) * .8; blobs.push([Math.cos(a) * .5, Math.sin(a) * .45, .42 + hash(k, t.v) * .12]); }
  const inC = (x, y) => t.kind === 1 ? (y > -1 && y < .9 && Math.abs(x) < (y + 1) * .5) || (x * x + (y - .2) ** 2 < .3) : blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br);
  const img = new ImageData(w, h), out = new Uint32Array(img.data.buffer), m = new Uint8Array(w * h);
  const tw = Math.max(2, R / 5 | 0);
  for (let y = cy; y < h - 1; y++) for (let x = cx - tw; x <= cx + tw - 1; x++) { m[y * w + x] = 2; out[y * w + x] = P(x >= cx + tw - 1 - (tw > 2 ? 1 : 0) ? '#5a3c24' : '#7b5434'); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + .5 - cx) / R, ny = (y + .5 - cy) / R;
    if (!inC(nx, ny)) continue;
    const l = .55 - (nx * .55 + ny * .75) * .55 + (hash(x >> 1, y >> 1) - .5) * .28 + bay(x, y) * .12;
    out[y * w + x] = col[l > .82 ? 3 : l > .55 ? 2 : l > .3 ? 1 : 0]; m[y * w + x] = 1;
  }
  const o2 = new Uint32Array(out);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!m[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) o2[i] = m[i] === 1 ? ink : P('#3a2414');
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(o2.buffer), w, h), 0, 0);
  return { cv, ax: cx, ay: h - 2 };
}

/* ---------- characters (16x24 pixel sprites, generated) ---------- */
const SKIN = ['#f6d2b0', '#e8b48c', '#c98d62', '#9c6a44', '#6e472c'];
function renderChar(look, dir, frame) {
  const w = 16, h = 24, px = new Array(w * h).fill(null);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const sk = look.skin, skS = mixHex(sk, '#7a3a2a', .25), hr = look.hair, hrL = mixHex(hr, '#ffffff', .3), hrS = mixHex(hr, '#000000', .3);
  const sh = look.shirt, shS = mixHex(sh, '#000000', .28), pa = look.pants, paS = mixHex(pa, '#000000', .3), so = look.shoes, bg = look.bag, bgS = mixHex(bg, '#000000', .3);
  const side = dir === 'l' || dir === 'r', back = dir === 'u';
  // legs + shoes
  if (!side) {
    const lu = frame === 1 ? 1 : 0, ru = frame === 2 ? 1 : 0;
    rect(5, 18, 6, 21 - lu, pa); rect(9, 18, 10, 21 - ru, paS); rect(5, 21 - lu, 6, 22 - lu, so); rect(9, 21 - ru, 10, 22 - ru, so);
  } else if (frame === 0) { rect(6, 18, 9, 20, pa); rect(9, 18, 9, 20, paS); rect(6, 21, 9, 22, so); }
  else { const f = frame === 1; rect(f ? 4 : 9, 18, f ? 5 : 10, 21, paS); rect(f ? 9 : 4, 18, f ? 10 : 5, 21, pa); rect(4, 22, 5, 22, so); rect(9, 22, 10, 22, so); rect(f ? 3 : 10, 22, f ? 3 : 11, 22, so); }
  // torso
  rect(4, 13, 11, 18, sh); rect(10, 13, 11, 18, shS); rect(4, 18, 11, 18, shS);
  // arms
  if (!side) { const sw = frame === 0 ? 0 : frame === 1 ? 1 : -1;
    rect(3, 13, 3, 16 - sw, sh); set(3, 17 - sw, sk); rect(12, 13, 12, 16 + sw, shS); set(12, 17 + sw, skS); }
  else { const sw = frame === 0 ? 0 : frame === 1 ? 1 : -1; rect(7 + sw, 14, 8 + sw, 16, shS); set(7 + sw, 17, sk); set(8 + sw, 17, skS); }
  // backpack
  if (back) { rect(4, 13, 11, 18, bg); rect(4, 15, 11, 15, bgS); rect(10, 13, 11, 18, bgS); rect(6, 16, 9, 17, bgS); }
  else if (side) { rect(10, 13, 12, 17, bg); rect(12, 13, 12, 17, bgS); }
  else { rect(5, 13, 5, 15, bg); rect(10, 13, 10, 15, bgS); }
  // head
  for (let y = 1; y <= 12; y++) for (let x = 2; x <= 13; x++) if (((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1) set(x, y, sk);
  for (let y = 7; y <= 12; y++) if (px[y * w + 13] || px[y * w + 12]) { set(12, y, skS); }
  const st = look.style;
  for (let y = 0; y <= 12; y++) for (let x = 1; x <= 14; x++) {
    if (!px[y * w + x] && !(st === 3 && y === 5)) continue;
    const inHead = ((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1;
    let hair = false;
    if (back) hair = inHead && y <= (st === 1 ? 12 : 10);
    else if (side) hair = inHead && (y <= 4 || (dir === 'l' ? x >= 9 : x <= 6) && y <= (st === 1 ? 12 : 9) || (y === 5 && (dir === 'l' ? x >= 4 : x <= 11) && x % 2 === 0));
    else hair = inHead && (y <= 4 || (y === 5 && x % 3 !== 1) || ((x <= 3 || x >= 12) && y <= (st === 1 ? 12 : 8)));
    if (hair) set(x, y, y <= 2 && (x === 5 || x === 6) ? hrL : (x >= 11 || y >= 9) ? hrS : hr);
  }
  if (st === 1 && !side) { rect(2, 9, 2, 14, hrS); rect(13, 9, 13, 14, hrS); if (back) rect(4, 11, 11, 14, hr); }
  if (st === 2) { rect(6, 0, 9, 1, hr); set(7, 0, hrL); }
  if (st === 3) { const cp = look.hat || '#e03c3c', cpS = mixHex(cp, '#000000', .3); // trainer cap
    for (let y = 1; y <= 4; y++) for (let x = 2; x <= 13; x++) if (((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1) set(x, y, x >= 11 ? cpS : cp);
    if (!back) { if (side) rect(dir === 'l' ? 1 : 9, 5, dir === 'l' ? 6 : 14, 5, cpS); else rect(3, 5, 12, 5, cpS); }
    set(7, 2, '#ffffff'); set(8, 2, '#ffffff'); }
  // face
  if (!back) {
    if (side) { const ex = dir === 'l' ? 4 : 11; set(ex, 7, '#1d1a2a'); set(ex, 8, '#1d1a2a'); set(dir === 'l' ? 6 : 9, 10, mixHex(sk, '#ff6b6b', .35)); }
    else { set(5, 7, '#1d1a2a'); set(5, 8, '#1d1a2a'); set(10, 7, '#1d1a2a'); set(10, 8, '#1d1a2a'); set(4, 10, mixHex(sk, '#ff6b6b', .35)); set(11, 10, mixHex(sk, '#ff6b6b', .35)); }
  }
  // walk bob: body drops a pixel on step frames
  const bob = frame ? 1 : 0, out = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px[y * w + x]; if (!c) continue; const ty = y < 18 ? y + bob : y; if (ty < h) out[ty * w + x] = c; }
  // self-coloured ink outline
  const img = new ImageData(w, h), o = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = out[y * w + x];
    if (c) { o[y * w + x] = P(c); continue; }
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => out[(y + dy) * w + x + dx]).find(v => v && x > 0 && x < w - 1);
    if (n && y > 0 && y < h - 1) o[y * w + x] = inkOf(P(n));
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(img, 0, 0);
  if (dir === 'r') { const f = document.createElement('canvas'); f.width = w; f.height = h; const g = f.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); g.drawImage(cv, 0, 0); return f; }
  return cv;
}
function mixHex(a, b, k) { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); }
const SHIRTS = ['#e04848', '#3d7fe0', '#2fb36b', '#f2a93b', '#8b5cf6', '#ec4899', '#14b8a6', '#334155'];
const HAIRS = ['#2b1d14', '#5a3a22', '#c9a24a', '#151515', '#8a3b1f', '#6b6b6b', '#d8c39a'];
const PANTS = ['#2f3d63', '#3b3b46', '#5b4636', '#1f2937', '#4b5a7a'];
function lookFor(seed, colour) {
  const h = k => hash(seed * 31 + k, seed * 7 + k * 13);
  return { skin: SKIN[h(1) * SKIN.length | 0], hair: HAIRS[h(2) * HAIRS.length | 0], style: h(3) * 4 | 0, hat: SHIRTS[h(8) * SHIRTS.length | 0],
    shirt: colour || SHIRTS[h(4) * SHIRTS.length | 0], pants: PANTS[h(5) * PANTS.length | 0], shoes: h(6) < .5 ? '#f2f2f2' : '#3a2a22', bag: ['#f2c94c', '#ef6461', '#4a90d9', '#2d2d3a', '#7bc96f'][h(7) * 5 | 0] };
}
const seedOf = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) & 0xffff;

/* ---------- caches & work queue ---------- */
const chunks = new Map(), bsprites = new Map(), tsprites = new Map(), csprites = new Map();
const queue = new Map();
function lru(map, key, limit) { const v = map.get(key); if (v !== undefined) { map.delete(key); map.set(key, v); } while (map.size > limit) map.delete(map.keys().next().value); return v; }
function want(key, prio, fn) { if (!queue.has(key) || queue.get(key).prio > prio) queue.set(key, { prio, fn }); }
function work(budget) {
  const t0 = performance.now();
  while (queue.size && performance.now() - t0 < budget) {
    let bk = null, bp = 1e18; for (const [k, v] of queue) if (v.prio < bp) { bp = v.prio; bk = k; }
    const job = queue.get(bk); queue.delete(bk); job.fn();
  }
}

/* ---------- load ---------- */
function bbox(r) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const ring of r) for (let i = 0; i < ring.length; i += 2) { a = Math.min(a, ring[i]); b = Math.min(b, ring[i + 1]); c = Math.max(c, ring[i]); d = Math.max(d, ring[i + 1]); } return [a, b, c, d]; }
const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1]; return s / 2; };
async function load(url) {
  const raw = await (await fetch(url)).json();
  D = { w: raw.w, h: raw.h, anchors: raw.anchors, labels: raw.labels };
  D.areas = raw.areas.map(([k, ...r]) => ({ k, r, bb: bbox(r), a: Math.abs(ringArea(r[0])) }))
    .sort((a, b) => (a.k === 'water' || a.k === 'pool') - (b.k === 'water' || b.k === 'pool') || b.a - a.a);
  D.lines = raw.lines.map(([k, w, p, name, bridge, layer]) => ({ k, w, p, name, bridge, layer, bb: bbox([p]) })).filter(l => l.layer >= 0 || l.bridge);
  D.lines.sort((a, b) => (b.k === 'rail') - (a.k === 'rail') || b.w - a.w);
  D.bars = raw.bars.map(([k, p]) => ({ k, p, bb: bbox([p]) }));
  D.blds = raw.blds.map(([name, h, mat, roof, ...r], id) => ({ id, name, h, mat, roof, r, bb: bbox(r), v: seedOf(name || id) + id, orient: Math.sign(ringArea(r[0])) || 1 }));
  D.trees = raw.trees.map(([x, y, r, kind], i) => ({ x, y, r: r || 2.2 + hash(i, 3) * 1.6, kind, v: (hash(i, 9) * 1e4) | 0, id: i }));
  D.cross = raw.cross;
  buildInfo(); buildMini(); ready = true;
}

/* info grid at 1 px per metre: 1 blocked, 2 water, 4 tall grass, 8 bridge */
function buildInfo() {
  IW = Math.ceil(D.w); IH = Math.ceil(D.h); info = new Uint8Array(IW * IH);
  for (const a of D.areas) {
    if (a.k === 'water' || a.k === 'pool') scan(a.r, 1, 0, 0, IW, IH, i => { info[i] = 3; });
    else if (a.k === 'wild') scan(a.r, 1, 0, 0, IW, IH, (i, x, y) => { if (!(info[i] & 2) && tallCell(x, y)) info[i] |= 4; });
  }
  for (const l of D.lines) {
    if (l.bridge) continue;
    if (['trunk', 'primary', 'rail'].includes(l.k)) stroke(l.p, l.w * .9, 1, 0, 0, IW, IH, i => { info[i] |= 1; });
    else if (WALK_LINES.has(l.k) || l.k.includes('service') || l.k === 'aisle') stroke(l.p, l.w, 1, 0, 0, IW, IH, i => { info[i] &= ~4; });
  }
  for (const b of D.bars) stroke(b.p, b.k === 'hedge' ? 1.1 : .7, 1, 0, 0, IW, IH, i => { info[i] |= 1; });
  for (const [x, y, , rw] of D.cross) { const r = rw / 2 + 2; for (let yy = y - r | 0; yy <= y + r; yy++) for (let xx = x - r | 0; xx <= x + r; xx++) if (xx >= 0 && yy >= 0 && xx < IW && yy < IH && (xx - x) ** 2 + (yy - y) ** 2 <= r * r && !(info[yy * IW + xx] & 2)) info[yy * IW + xx] &= ~1; }
  for (const b of D.blds) if (b.mat !== 'canopy') scan(b.r, 1, 0, 0, IW, IH, i => { info[i] |= 1; });
  for (const t of D.trees) { const i = (t.y | 0) * IW + (t.x | 0); if (i >= 0 && i < info.length) info[i] |= 1; }
  for (const l of D.lines) if (l.bridge && WALK_LINES.has(l.k)) stroke(l.p, Math.max(3, l.w), 1, 0, 0, IW, IH, i => { info[i] = 8; });
}
const cell = (x, y) => (x < 0 || y < 0 || x >= IW || y >= IH) ? 1 : info[(y | 0) * IW + (x | 0)];
function walkable(x, y, r = .35, surf = false) { const bad = c => (c & 1) && !(surf && (c & 2)); return !(bad(cell(x - r, y - r)) || bad(cell(x + r, y - r)) || bad(cell(x - r, y + r)) || bad(cell(x + r, y + r))); }
function nearestFree(x, y) { for (let rad = 0; rad < 60; rad += .5) for (let a = 0; a < 6.28; a += .3) { const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad; if (walkable(px, py, .5)) return [px, py]; } return [x, y]; }

/* minimap: quick vector pass at low resolution */
let mini = null; const MS = .16;
function buildMini() {
  mini = document.createElement('canvas'); mini.width = Math.ceil(D.w * MS); mini.height = Math.ceil(D.h * MS);
  const g = mini.getContext('2d'); g.fillStyle = '#6cc04a'; g.fillRect(0, 0, mini.width, mini.height); g.scale(MS, MS);
  const poly = (rings, f) => { g.beginPath(); for (const r of rings) { g.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]); g.closePath(); } g.fillStyle = f; g.fill('evenodd'); };
  const AC = { wild: '#3f9a3c', wood: '#4a9a3e', pitch: '#62bb4c', parking: '#8a8d97', plaza: '#e6e0cf', pool: '#5fd0f2', water: '#4b93e6' };
  for (const a of D.areas) if (AC[a.k]) poly(a.r, AC[a.k]);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const l of D.lines) { if (l.k === 'rail') continue; g.strokeStyle = ROAD_LINES.has(l.k) || l.k === 'service' ? '#7a7e88' : '#ebdfbf'; g.lineWidth = Math.max(l.w, 3); g.beginPath(); g.moveTo(l.p[0], l.p[1]); for (let i = 2; i < l.p.length; i += 2) g.lineTo(l.p[i], l.p[i + 1]); g.stroke(); }
  for (const b of D.blds) { const pl = (BPAL[b.mat] || BPAL.misc); poly(b.r, pl[b.v % pl.length].roof[0]); }
}

/* ---------- drawing ---------- */
let bldSorted = null;
function draw(ctx, view, actors, t) {
  const { cx, cy, z, dpr, vw, vh } = view, S = z * dpr;
  const camX = Math.round((cx * PPM - vw / z / 2) * S) / S, camY = Math.round((cy * PPM - vh / z / 2) * S) / S;
  const vx0 = camX, vy0 = camY, vx1 = camX + vw / z, vy1 = camY + vh / z;
  ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6cc04a'; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  const ccx = (vx0 + vx1) / 2, ccy = (vy0 + vy1) / 2;
  // ground
  const m = CH;
  for (let gy = Math.floor((vy0 - m) / CH); gy <= Math.floor((vy1 + m) / CH); gy++) for (let gx = Math.floor((vx0 - m) / CH); gx <= Math.floor((vx1 + m) / CH); gx++) {
    if (gx < 0 || gy < 0 || gx * CH > D.w * PPM || gy * CH > D.h * PPM) continue;
    const key = gx + ',' + gy, c = lru(chunks, key, 48);
    const vis = (gx + 1) * CH > vx0 && gx * CH < vx1 && (gy + 1) * CH > vy0 && gy * CH < vy1;
    if (c) { if (vis) ctx.drawImage(c, gx * CH, gy * CH); }
    else want('c' + key, Math.hypot(gx * CH + CH / 2 - ccx, gy * CH + CH / 2 - ccy) - (vis ? 1e6 : 0), () => chunks.set(key, renderChunk(gx, gy)));
  }
  // y-sorted sprites
  const list = [], pad = 40;
  for (const b of D.blds) {
    const x0 = b.bb[0] * PPM, x1 = b.bb[2] * PPM, y1 = b.bb[3] * PPM, y0 = b.bb[1] * PPM - b.h * K * PPM;
    if (x1 < vx0 - pad || x0 > vx1 + pad || y1 < vy0 - pad || y0 > vy1 + pad) { continue; }
    const s = lru(bsprites, b.id, 260), vis = x1 > vx0 && x0 < vx1 && y1 > vy0 && y0 < vy1;
    if (s === undefined) want('b' + b.id, Math.hypot((x0 + x1) / 2 - ccx, y1 - ccy) - (vis ? 1e6 : 0), () => bsprites.set(b.id, renderBuilding(b)));
    else if (s && vis) list.push([y1, 0, s]);
  }
  for (const tr of D.trees) {
    const x = tr.x * PPM, y = tr.y * PPM, R = tr.r * PPM + 4;
    if (x + R < vx0 || x - R > vx1 || y < vy0 || y - R * 2 - 20 > vy1) continue;
    let s = tsprites.get(tr.id); if (!s) { s = renderTree(tr); tsprites.set(tr.id, s); }
    list.push([y, 1, s, x, y]);
  }
  for (const a of actors) { const x = a.x * PPM, y = a.y * PPM; if (x < vx0 - 30 || x > vx1 + 30 || y < vy0 - 10 || y > vy1 + 40) continue; list.push([y, 2, a, x, y]); }
  list.sort((a, b) => a[0] - b[0]);
  for (const it of list) {
    if (it[1] === 0) ctx.drawImage(it[2].cv, it[2].x, it[2].y);
    else if (it[1] === 1) ctx.drawImage(it[2].cv, Math.round(it[3] - it[2].ax), Math.round(it[4] - it[2].ay));
    else drawActor(ctx, it[2], Math.round(it[3]), Math.round(it[4]), t);
  }
  // water sparkle
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 40; k++) {
    const sx = vx0 + hash(k, Math.floor(t / 900 + k * .37)) * (vx1 - vx0), sy = vy0 + hash(k + 99, Math.floor(t / 900 + k * .37)) * (vy1 - vy0);
    if ((cell(sx / PPM, sy / PPM) & 2) && (cell((sx + 16) / PPM, sy / PPM) & 2)) { const ph = (t / 900 + k * .37) % 1; if (ph < .5) { ctx.fillRect(sx | 0, sy | 0, 1, 1); if (ph > .15 && ph < .35) { ctx.fillRect((sx | 0) - 1, sy | 0, 3, 1); ctx.fillRect(sx | 0, (sy | 0) - 1, 1, 3); } } }
  }
  return { camX, camY, S };
}
const GRASS_OVER = (() => { const c = document.createElement('canvas'); c.width = 18; c.height = 7; const g = c.getContext('2d');
  for (let x = 0; x < 18; x++) { const t0 = x % 3 === 1 ? 0 : x % 3 === 0 ? 2 : 1; for (let y = t0; y < 7; y++) { g.fillStyle = y === t0 ? (x % 3 === 1 ? '#5cbc4e' : '#1e5a26') : y === 6 ? '#2a7430' : x % 3 === 0 ? '#2a7430' : '#3f9a3c'; g.fillRect(x, y, 1, 1); } } return c; })();
const STAR = [[0, -4], [-1, -3], [0, -3], [1, -3], [-4, -2], [-3, -2], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [3, -2], [4, -2], [-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [3, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, 1], [-1, 1], [1, 1], [2, 1], [-3, 2], [-2, 2], [2, 2], [3, 2]];
function drawActor(ctx, a, x, y, t) {
  if (a.star) { const by = y - 12 + Math.round(Math.sin(t / 250) * 2); ctx.fillStyle = 'rgba(20,24,60,.25)'; ctx.fillRect(x - 3, y - 1, 7, 2);
    ctx.fillStyle = '#7a5a00'; for (const [dx, dy] of STAR) ctx.fillRect(x + dx * 1 - 0, by + dy - 1, 1, 1);
    ctx.fillStyle = '#ffd84a'; for (const [dx, dy] of STAR) ctx.fillRect(x + dx, by + dy, 1, 1); ctx.fillStyle = '#fff6b0'; ctx.fillRect(x - 1, by - 2, 1, 1); return; }
  if (a.swim) { ctx.fillStyle = '#d8f0ff'; ctx.fillRect(x - 9, y - 4, 18, 1); ctx.fillStyle = '#4b93e6'; ctx.fillRect(x - 9, y - 3, 18, 4); }
  if (a.bike) { ctx.fillStyle = '#1d1a2a'; for (const wx of [-6, 4]) { ctx.fillRect(x + wx, y - 6, 3, 1); ctx.fillRect(x + wx - 1, y - 5, 1, 3); ctx.fillRect(x + wx + 3, y - 5, 1, 3); ctx.fillRect(x + wx, y - 2, 3, 1); }
    ctx.fillStyle = '#e04848'; ctx.fillRect(x - 4, y - 7, 9, 1); ctx.fillRect(x - 1, y - 9, 1, 3); }
  ctx.fillStyle = 'rgba(20,24,60,.28)'; ctx.fillRect(x - 5, y - 1, 10, 2); ctx.fillRect(x - 4, y - 2, 8, 4);
  const key = a.lookKey + a.dir + a.frame; let s = lru(csprites, key, 600);
  if (!s) { s = renderChar(a.look, a.dir, a.frame); csprites.set(key, s); }
  if (a.swim) { ctx.drawImage(s, 0, 0, 16, 18, x - 8, y - 21, 16, 18); return; }
  ctx.drawImage(s, x - 8, y - 23 - (a.bike ? 3 : 0));
  if (a.tall) ctx.drawImage(GRASS_OVER, x - 9, y - 6 + ((a.frame && Math.floor(t / 120) % 2) ? 1 : 0));
  if (a.marker) { const by = y - 34 + (Math.floor(t / 300) % 2); ctx.fillStyle = '#1d1a2a'; ctx.fillRect(x - 3, by - 1, 7, 10); ctx.fillStyle = a.marker === 'target' ? '#ff5a7a' : '#ffffff'; ctx.fillRect(x - 2, by, 5, 8);
    ctx.fillStyle = a.marker === 'target' ? '#ffffff' : '#e8344e'; ctx.fillRect(x, by + 1, 1, 4); ctx.fillRect(x, by + 6, 1, 1); }
}

/* screen-space labels drawn by the caller after draw() */
function labels() {
  const out = [];
  const big = new Set(['The Quadrangle', 'Fisher Library', 'Charles Perkins Centre', 'Jane Foss Russell Building', 'H70 Abercrombie Building', 'Wentworth Building', 'Manning House', 'Holme Building', 'Great Hall', 'Law Building', 'Anderson-Stuart Building', 'Madsen Building', 'Chau Chak Wing Museum', 'Susan Wakil Health Building (SWHB)', 'The Arena Sport Centre', 'University Sports & Aquatic Centre', 'Sydney Nanoscience Hub', 'Social Sciences Building (SSB)', 'Brennan-MacCallum', 'Old Teachers College', 'Carslaw Building', 'Seymour Centre', 'Michael Spence Building', 'Merewether Building']);
  for (const b of D.blds) if (b.name && (b.mat === 'sand' || b.mat === 'uni')) {
    const big2 = big.has(b.name), seen = out.find(o => o.t === b.name); if (seen) continue;
    out.push({ t: b.name.replace(' (SWHB)', '').replace(' (SSB)', '').replace('H70 Abercrombie Building', 'Abercrombie · Business School'), x: (b.bb[0] + b.bb[2]) / 2, y: b.bb[1] - b.h * K, big: big2 });
  }
  for (const [t, x, y] of D.labels) out.push({ t, x, y, big: true, park: true });
  const seen = new Set(); return out.filter(l => !seen.has(l.t) && seen.add(l.t));
}

return {
  charSprite: (look, dir, frame) => renderChar(look, dir, frame),
  PPM, K, load, draw, work, walkable, nearestFree, labels, lookFor, seedOf,
  isTall: (x, y) => !!(cell(x, y) & 4),
  find(name) { const b = D.blds.find(b => b.name === name); if (b) return [(b.bb[0] + b.bb[2]) / 2, b.bb[3] + 3]; const l = D.labels.find(l => l[0] === name); return l ? [l[1], l[2]] : null; }, isWater: (x, y) => !!(cell(x, y) & 2),
  get ready() { return ready; }, get anchors() { return D.anchors; }, get size() { return [D.w, D.h]; },
  get mini() { return mini; }, MS, pending: () => queue.size,
};
})();
