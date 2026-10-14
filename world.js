// Pokémon-style tile renderer for the real USyd campus (OpenStreetMap data in map.json).
// The real layout is snapped to a 16 px tile grid (one tile = T metres). Ground, paths, water and buildings are
// baked into 32x32-tile chunks; trees and characters are y-sorted sprites. Buildings stay inside their footprint
// (front wall with windows and a door at the bottom, striped roof above), so the view reads like HGSS / BW, not aerial.
// From the Brawl renderer: top-left key light, banded shading, self-coloured ink outlines, hashed texture, caching.
window.World = (() => {
const T = 4, TS = 16, CHT = 32, CH = CHT * TS;
const CROP = [320, 105, 1325, 1040];            // metres in map.json space: CPC to Victoria Park, Parramatta Rd to Abercrombie
let W = 0, H = 0, mat, bid, treeAt, trees = [], blds = [], labelsRaw = [], anchorsM = {}, ready = false, mini = null;

/* ---------- helpers ---------- */
const hash = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = t => t * t * (3 - 2 * t);
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; }
const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const P = h => pack(rgb(h));
const unpack = c => [c & 255, c >> 8 & 255, c >> 16 & 255];
const mixP = (c, h, k) => { const a = unpack(c), b = rgb(h); return pack(a.map((v, i) => Math.round(v + (b[i] - v) * k))); };
const inkOf = c => mixP(c, '#14101f', .6);
function mixHex(a, b, k) { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); }
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function fromBuf(buf, w, h) { const c = canvas(w, h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), w, h), 0, 0); return c; }

/* polygon scan (cell centres, even-odd) and thick polyline, in any grid scale */
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
function stroke(pts, rad, s, ox, oy, w, h, fn) {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i] * s - ox, ay = pts[i + 1] * s - oy, bx = pts[i + 2] * s - ox, by = pts[i + 3] * s - oy;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-6, ux = dx / L, uy = dy / L;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rad));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rad));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + .5 - ax, qy = py + .5 - ay, t = Math.max(0, Math.min(L, qx * ux + qy * uy)), ex = qx - ux * t, ey = qy - uy * t;
      if (ex * ex + ey * ey <= rad * rad) fn(py * w + px, px, py);
    }
  }
}

/* ---------- tile materials ---------- */
const M = { GRASS: 0, TALL: 1, PATH: 2, PLAZA: 3, ROAD: 4, ZEBRA: 5, WATER: 6, POOL: 7, PITCH: 8, STAIRS: 9, BRIDGE: 10, SAND: 11 };
const WALKISH = new Set([M.PATH, M.PLAZA, M.STAIRS, M.BRIDGE]);
const ROADISH = new Set([M.ROAD, M.ZEBRA]);
const WET = new Set([M.WATER, M.POOL]);
const PAL = {
  grass: ['#7ccf5a', '#98de74', '#5cae45', '#4a9a3a'], tall: ['#3e9a3e', '#62c050', '#2b7a30', '#1c5a24'],
  path: ['#ead9a2', '#f5e9c0', '#d7c182', '#b89f5e'], plaza: ['#e3dfd1', '#f0ede3', '#cdc6b1', '#aaa38c'],
  road: ['#8e9099', '#9ea0a9', '#7c7e88', '#e4e4ea'], water: ['#5aa6f2', '#8cc8ff', '#4288d8', '#e8f6ff'],
  pool: ['#62d0f5', '#9be6ff', '#3fb0dc', '#f4f4ec'], pitch: ['#6cc552', '#80d264'], wood: ['#a07848', '#b88e5c', '#7c5a34'],
  flower: ['#ff6a8a', '#ffd84a', '#ffffff', '#b98bff'],
};
const PALP = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, v.map(P)]));

// one 16x16 tile; nb = [up, right, down, left] neighbour materials
function tileArt(m, nb, v) {
  const o = new Uint32Array(TS * TS), set = (x, y, c) => { if (x >= 0 && y >= 0 && x < TS && y < TS) o[y * TS + x] = c; };
  const fill = c => o.fill(c);
  const G = PALP.grass;
  const grassTile = () => {
    fill(G[0]);
    const tufts = [[[2, 4], [8, 11]], [[10, 2], [4, 12]], [[6, 7], [12, 13]], [[3, 10], [11, 5]]][v & 3];
    for (const [x, y] of tufts) { set(x, y, G[2]); set(x + 1, y - 1, G[2]); set(x + 2, y, G[2]); set(x + 1, y, G[1]); }
    if ((v >> 2) % 7 === 0) { const c = PALP.flower[(v >> 4) & 3], fx = 4 + ((v >> 6) & 7), fy = 4 + ((v >> 9) & 7);
      set(fx, fy - 1, c); set(fx - 1, fy, c); set(fx + 1, fy, c); set(fx, fy + 1, c); set(fx, fy, PALP.flower[1]); }
  };
  const edges = (pal, isSame) => { // Pokémon-style border where a hard surface meets grass
    const [u, r, d, l] = nb.map(isSame);
    for (let i = 0; i < TS; i++) {
      if (!u) { set(i, 0, pal[3]); set(i, 1, pal[1]); }
      if (!d) { set(i, TS - 1, pal[3]); set(i, TS - 2, pal[2]); }
      if (!l) { set(0, i, pal[3]); set(1, i, pal[1]); }
      if (!r) { set(TS - 1, i, pal[3]); set(TS - 2, i, pal[2]); }
    }
    const cut = (x, y) => set(x, y, G[0]);
    if (!u && !l) { cut(0, 0); cut(1, 0); cut(0, 1); set(1, 1, pal[3]); }
    if (!u && !r) { cut(15, 0); cut(14, 0); cut(15, 1); set(14, 1, pal[3]); }
    if (!d && !l) { cut(0, 15); cut(1, 15); cut(0, 14); set(1, 14, pal[3]); }
    if (!d && !r) { cut(15, 15); cut(14, 15); cut(15, 14); set(14, 14, pal[3]); }
  };
  switch (m) {
    case M.GRASS: grassTile(); break;
    case M.TALL: {
      const D = PALP.tall; fill(D[0]);
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const sx = (x + ((y >> 3) & 1) * 4) & 7, ly = y & 7;
        if (ly === 7) set(x, y, D[2]); else if (sx === 0 || sx === 4) set(x, y, ly < 2 ? D[1] : D[2]);
        else if (ly <= 1 && (sx === 2 || sx === 6)) set(x, y, D[1]);
      }
      if (!nb[0]) for (let x = 0; x < TS; x++) set(x, 0, (x & 3) === 1 ? D[1] : D[3]);
      break;
    }
    case M.PATH: case M.STAIRS: {
      const p = PALP.path; fill(p[0]);
      for (let k = 0; k < 5; k++) set((hash(v, k) * 13 | 0) + 1, (hash(k, v) * 13 | 0) + 1, p[2]);
      if (m === M.STAIRS) for (let y = 2; y < TS; y += 4) for (let x = 2; x < TS - 2; x++) { set(x, y, p[3]); set(x, y - 1, p[1]); }
      edges(p, n => WALKISH.has(n) || ROADISH.has(n));
      break;
    }
    case M.PLAZA: {
      const p = PALP.plaza; fill(p[0]);
      for (let i = 0; i < TS; i++) { set(i, 0, p[2]); set(0, i, p[2]); set(i, 8, p[2]); set(8, i, p[2]); }
      set(2, 2, p[1]); set(10, 10, p[1]); set(10, 2, p[1]); set(2, 10, p[1]);
      edges(p, n => WALKISH.has(n) || ROADISH.has(n));
      break;
    }
    case M.ROAD: case M.ZEBRA: {
      const p = PALP.road; fill(p[0]);
      for (let k = 0; k < 6; k++) set(hash(v, k) * 16 | 0, hash(k, v) * 16 | 0, k & 1 ? p[1] : p[2]);
      if (m === M.ZEBRA) for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (((v & 1 ? x : y) >> 2) & 1) set(x, y, p[3]);
      const [u, r, d, l] = nb.map(n => ROADISH.has(n));
      for (let i = 0; i < TS; i++) { if (!u) { set(i, 0, p[3]); set(i, 1, P('#b9bbc4')); } if (!d) { set(i, 15, P('#5d5f68')); set(i, 14, p[3]); }
        if (!l) { set(0, i, p[3]); set(1, i, P('#b9bbc4')); } if (!r) { set(15, i, P('#5d5f68')); set(14, i, p[3]); } }
      break;
    }
    case M.WATER: case M.POOL: {
      const p = m === M.WATER ? PALP.water : PALP.pool; fill(p[0]);
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const wy = y + ((v >> 3) & 1) * 4, wv = (x + (wy >> 2) * 5) & 15;
        if ((wy & 7) === 2 && wv < 4) set(x, y, p[1]); else if ((wy & 7) === 3 && wv > 0 && wv < 3) set(x, y, p[2]);
      }
      const [u, r, d, l] = nb.map(n => WET.has(n));
      for (let i = 0; i < TS; i++) { if (!u) { set(i, 0, P('#4b7a3a')); set(i, 1, p[3]); set(i, 2, p[1]); } if (!d) { set(i, 15, p[3]); set(i, 14, p[1]); }
        if (!l) { set(0, i, p[3]); set(1, i, p[1]); } if (!r) { set(15, i, p[3]); set(14, i, p[1]); } }
      break;
    }
    case M.PITCH: { const p = PALP.pitch; fill((v & 1) ? p[1] : p[0]); for (let k = 0; k < 3; k++) set(hash(v, k) * 16 | 0, hash(k, v) * 16 | 0, G[2]); break; }
    case M.BRIDGE: { const p = PALP.wood; fill(p[0]); for (let y = 0; y < TS; y += 4) for (let x = 0; x < TS; x++) set(x, y, p[2]); for (let i = 0; i < TS; i++) { set(0, i, P('#4a3624')); set(15, i, P('#4a3624')); set(1, i, p[1]); } break; }
    case M.SAND: { fill(P('#f0dca0')); for (let k = 0; k < 6; k++) set(hash(v, k) * 16 | 0, hash(k, v) * 16 | 0, P('#d8c080')); break; }
  }
  return fromBuf(o, TS, TS);
}
const tileCache = new Map();
function tileImg(m, nb, v) {
  const key = m + ':' + nb.join(',') + ':' + v; let c = tileCache.get(key);
  if (!c) { c = tileArt(m, nb, v); tileCache.set(key, c); }
  return c;
}

/* ---------- build the tile map from OSM ---------- */
const WALK_LINES = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track', 'service', 'aisle', 'living_street']);
const ROAD_LINES = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'tertiary', 'unclassified', 'residential']);
const tallCell = (x, y) => vnoise(x / 2.6 + 50, y / 2.6 + 50) > .52;
async function load(url) {
  const raw = await (await fetch(url)).json();
  W = Math.ceil((CROP[2] - CROP[0]) / T); H = Math.ceil((CROP[3] - CROP[1]) / T);
  const s = 1 / T, ox = CROP[0] / T, oy = CROP[1] / T;
  mat = new Uint8Array(W * H); bid = new Int16Array(W * H).fill(-1); treeAt = new Uint8Array(W * H);
  const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return Math.abs(a / 2); };
  const areas = raw.areas.map(([k, ...r]) => ({ k, r, a: ringArea(r[0]) })).sort((a, b) => ((a.k === 'water' || a.k === 'pool') - (b.k === 'water' || b.k === 'pool')) || b.a - a.a);
  const AM = { grass: M.GRASS, wood: M.GRASS, pitch: M.PITCH, plaza: M.PLAZA, parking: M.ROAD, pool: M.POOL, water: M.WATER };
  const wild = new Uint8Array(W * H);
  for (const a of areas) {
    if (a.k === 'wild') { scan(a.r, s, ox, oy, W, H, i => { wild[i] = 1; }); continue; }
    if (AM[a.k] !== undefined) scan(a.r, s, ox, oy, W, H, i => { mat[i] = AM[a.k]; });
  }
  for (let i = 0; i < W * H; i++) if (wild[i] && mat[i] === M.GRASS && tallCell(i % W, i / W | 0)) mat[i] = M.TALL;
  const lines = raw.lines.map(([k, w, p, name, bridge, layer]) => ({ k, w, p, name, bridge, layer })).filter(l => l.layer >= 0 || l.bridge);
  for (const l of lines) if (ROAD_LINES.has(l.k) && !l.bridge) stroke(l.p, Math.max(.6, l.w / T / 2), s, ox, oy, W, H, i => { if (!WET.has(mat[i])) mat[i] = M.ROAD; });
  for (const l of lines) if (WALK_LINES.has(l.k) && !l.bridge) stroke(l.p, Math.max(.62, l.w / T / 2), s, ox, oy, W, H, i => {
    if (WET.has(mat[i]) || ROADISH.has(mat[i])) return; mat[i] = l.k === 'steps' ? M.STAIRS : (l.k === 'pedestrian' || mat[i] === M.PLAZA) ? M.PLAZA : M.PATH; });
  for (const [x, y, ang] of raw.cross) { const tx = Math.floor(x * s - ox), ty = Math.floor(y * s - oy), vert = Math.abs(Math.cos(ang)) < .7;
    for (let k = -2; k <= 2; k++) { const xx = vert ? tx + k : tx, yy = vert ? ty : ty + k; if (xx >= 0 && yy >= 0 && xx < W && yy < H && mat[yy * W + xx] === M.ROAD) mat[yy * W + xx] = M.ZEBRA; } }
  for (const l of lines) if (l.bridge && WALK_LINES.has(l.k)) stroke(l.p, .62, s, ox, oy, W, H, i => { mat[i] = M.BRIDGE; });
  // buildings snapped to tiles
  raw.blds.forEach(([name, h, kind, roof, ...r], id) => {
    if (kind === 'canopy') return;
    const tiles = []; scan(r, s, ox, oy, W, H, i => { if (bid[i] < 0) { bid[i] = blds.length; tiles.push(i); } });
    if (!tiles.length) return;
    blds.push({ id: blds.length, name, h, kind, roof, tiles, v: hash(id, 77) * 1e4 | 0 });
  });
  // trees: one per free tile, thinned so trunks never touch
  raw.trees.forEach(([x, y, r, kind], i) => {
    const tx = Math.floor(x * s - ox), ty = Math.floor(y * s - oy); if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return;
    const k = ty * W + tx; if (bid[k] >= 0 || !(mat[k] === M.GRASS || mat[k] === M.TALL || mat[k] === M.PITCH)) return;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (treeAt[k + dy * W + dx]) return;
    treeAt[k] = 1; trees.push({ tx, ty, kind: kind === 2 ? 3 : kind === 1 ? 2 : (hash(i, 5) < .3 ? 1 : 0), big: hash(i, 9) < .35 });
  });
  // archways: OSM footpaths that run through the Quadrangle's wings become open passages
  const arch = new Set(blds.filter(b => b.name === 'The Quadrangle').map(b => b.id));
  for (const l of lines) if (WALK_LINES.has(l.k)) stroke(l.p, .55, s, ox, oy, W, H, i => { if (arch.has(bid[i])) { bid[i] = -1; mat[i] = M.PLAZA; } });
  for (const b of blds) b.tiles = b.tiles.filter(i => bid[i] === b.id);
  labelsRaw = raw.labels.map(([t, x, y]) => [t, x * s - ox, y * s - oy]);
  for (const [k, [x, y]] of Object.entries(raw.anchors)) anchorsM[k] = [x * s - ox, y * s - oy];
  connect();
  blds.forEach(prepBuilding);
  buildMini(); ready = true;
}

/* ---------- connectivity: no walkable pocket may be cut off from the main campus ---------- */
let comp = null, mainComp = 0;
const freeTile = i => bid[i] < 0 && !treeAt[i] && !WET.has(mat[i]);
function label() {
  comp = new Int32Array(W * H).fill(-1); const sizes = []; const st = [];
  for (let i = 0; i < W * H; i++) {
    if (comp[i] >= 0 || !freeTile(i)) continue;
    const id = sizes.length; let n = 0; comp[i] = id; st.push(i);
    while (st.length) { const k = st.pop(); n++; const x = k % W, y = k / W | 0;
      for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1])
        if (j >= 0 && comp[j] < 0 && freeTile(j)) { comp[j] = id; st.push(j); } }
    sizes.push(n);
  }
  mainComp = sizes.indexOf(Math.max(...sizes));
  return sizes;
}
// pockets of 12+ tiles (courtyards, lanes between buildings) get the cheapest passage to the main campus:
// through a building wall (becomes a paved archway), past a tree (removed) or, as a last resort, over water (bridge)
function connect() {
  for (let pass = 0; pass < 6; pass++) {
    const sizes = label(); let changed = false;
    for (let c = 0; c < sizes.length; c++) {
      if (c === mainComp || sizes[c] < 12) continue;
      const dist = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), heap = [];
      const push = (i, d) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
      for (let i = 0; i < W * H; i++) if (comp[i] === c) { dist[i] = 0; push(i, 0); }
      let hit = -1;
      while (heap.length) {
        const [d, k] = pop(); if (d > dist[k]) continue;
        if (comp[k] === mainComp) { hit = k; break; }
        const x = k % W, y = k / W | 0;
        for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) {
          if (j < 0) continue;
          const cost = freeTile(j) ? 1 : bid[j] >= 0 ? 4 : treeAt[j] ? 2 : 40;
          if (d + cost < dist[j]) { dist[j] = d + cost; prev[j] = k; push(j, d + cost); }
        }
      }
      if (hit < 0 || dist[hit] > 160) continue;
      for (let k = prev[hit]; k >= 0 && comp[k] !== c; k = prev[k]) {
        if (bid[k] >= 0) { bid[k] = -1; mat[k] = M.PLAZA; }
        if (treeAt[k]) { treeAt[k] = 0; trees = trees.filter(t => t.ty * W + t.tx !== k); }
        if (WET.has(mat[k])) mat[k] = M.BRIDGE;
      }
      changed = true;
    }
    if (!changed) break;
  }
  for (const b of blds) b.tiles = b.tiles.filter(i => bid[i] === b.id);
  label();
}
const inMain = (x, y) => x >= 0 && y >= 0 && x < W && y < H && comp[y * W + x] === mainComp;
// would an NPC standing here split the paths around it? (local flood fill around the tile)
function isChoke(x, y, blocked = new Set()) {
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => walkable(a, b) && !blocked.has(a + ',' + b));
  if (nb.length < 2) return false;
  const seen = new Set([x + ',' + y, nb[0].join(',')]), q = [nb[0]];
  for (let n = 0; q.length && n < 600; n++) { const [a, b] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (a + dx) + ',' + (b + dy);
      if (!seen.has(k) && walkable(a + dx, b + dy) && !blocked.has(k)) { seen.add(k); q.push([a + dx, b + dy]); } } }
  return !nb.every(p => seen.has(p.join(',')));
}

/* ---------- buildings: tile footprint -> front wall + roof, Pokémon style ---------- */
const BPAL = {
  sand: [{ wall: ['#ecd49a', '#f8e8bc', '#cfb070'], roof: ['#5f7394', '#7b90b2', '#4a5a76'], win: '#3c5684', frame: '#fff4d6', door: '#6b4a2e', flat: false }],
  uni: [
    { wall: ['#e2e2e6', '#f4f4f6', '#bfc0c8'], roof: ['#d05a4a', '#e6786a', '#a8443a'], win: '#5aa0e0', frame: '#ffffff', door: '#4a90d9', flat: false, glass: true },
    { wall: ['#d48a5c', '#e6a478', '#ad6a42'], roof: ['#6a7a8c', '#8496aa', '#54606e'], win: '#4c8ad0', frame: '#f4ead8', door: '#5a3a24', flat: false, brick: true },
    { wall: ['#f2f4f6', '#ffffff', '#cdd3d8'], roof: ['#a8b2bc', '#c4ccd4', '#8a949e'], win: '#62a8e8', frame: '#e8f2fa', door: '#3f7fc2', flat: true, glass: true },
    { wall: ['#8fc0e4', '#b0d6f2', '#6e9cc4'], roof: ['#b6bcc4', '#ccd2d8', '#9aa0a8'], win: '#3a78b8', frame: '#e0f0fc', door: '#2e5f94', flat: true, glass: true },
    { wall: ['#c8b496', '#dccaae', '#a8947a'], roof: ['#4f8a5c', '#68a874', '#3c6e48'], win: '#4a7cb4', frame: '#f2e8d6', door: '#5a3a24', flat: false },
    { wall: ['#e8e0cc', '#f6f0e0', '#c8bea6'], roof: ['#3f6fb8', '#5a8ad2', '#2f5592'], win: '#5aa0e0', frame: '#ffffff', door: '#4a90d9', flat: false, glass: true },
  ],
  house: [
    { wall: ['#f2e2c2', '#fff2d8', '#d6c29c'], roof: ['#d0623c', '#e47e54', '#a84a2a'], win: '#5aa0e0', frame: '#ffffff', door: '#8a5a34', flat: false },
    { wall: ['#c0705a', '#d48a72', '#9a5644'], roof: ['#7a828e', '#9098a4', '#626a76'], win: '#4c8ad0', frame: '#f4ece2', door: '#5a3a24', flat: false, brick: true },
  ],
  misc: [{ wall: ['#d6cfc2', '#e8e2d6', '#b4ad9e'], roof: ['#8c939c', '#a4abb3', '#727a84'], win: '#5a8ec4', frame: '#eeeeee', door: '#5a6878', flat: true }],
};
const ACCENTS = [['#3f9fd8', '#2a6f9c'], ['#e0604a', '#a8402e'], ['#3fb07a', '#2a7a52'], ['#f0b43c', '#b8801c'], ['#8a6ad8', '#5e44a4']];
function prepBuilding(b) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const i of b.tiles) { const x = i % W, y = i / W | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  Object.assign(b, { x0, y0, x1, y1 });
  const floors = Math.max(1, Math.round(b.h / 3.6)); b.wallT = floors <= 2 ? 1 : floors <= 5 ? 2 : 3;
  let best = null; // door: middle of the longest run of front-facing bottom tiles
  for (let y = y0; y <= y1; y++) { let run = [];
    for (let x = x0; x <= x1 + 1; x++) {
      const front = x <= x1 && bid[y * W + x] === b.id && (y + 1 >= H || bid[(y + 1) * W + x] !== b.id);
      if (front) run.push(x); else { if (run.length && (!best || run.length > best.len || (run.length === best.len && y > best.y))) best = { len: run.length, y, x: run[run.length >> 1] }; run = []; }
    } }
  b.door = best && best.len >= 2 ? [best.x, best.y] : null;
  const pl = BPAL[b.kind] || BPAL.misc; b.pal = pl[b.v % pl.length];
}
function renderBuilding(b) {
  const OH = 4, w = (b.x1 - b.x0 + 1) * TS, h = (b.y1 - b.y0 + 1) * TS + OH, bx = b.x0 * TS, by = b.y0 * TS - OH;
  const inB = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && bid[ty * W + tx] === b.id;
  const role = new Uint8Array(w * h), local = new Int16Array(w * h); // 1 wall, 2 roof; local = px above the wall's base
  for (let px = 0; px < w; px++) {
    const tx = b.x0 + (px >> 4);
    for (let ty = b.y1; ty >= b.y0; ty--) {
      if (!inB(tx, ty) || inB(tx, ty + 1)) continue;          // bottom tile of a vertical run
      let top = ty; while (inB(tx, top - 1)) top--;
      const runPx = (ty - top + 1) * TS, wallPx = Math.min(b.wallT * TS, runPx > TS ? runPx - 8 : 10);
      const bottomPy = (ty + 1) * TS - by - 1, roofTop = top * TS - by - (inB(tx, top - 1) ? 0 : OH);
      for (let py = Math.max(0, roofTop); py <= bottomPy; py++) {
        const i = py * w + px, up = bottomPy - py;
        if (up < wallPx) { role[i] = 1; local[i] = up; } else { role[i] = 2; local[i] = up - wallPx; }
      }
    }
  }
  const pl = b.pal, Wc = pl.wall.map(P), Rc = pl.roof.map(P), WIN = P(pl.win), FR = P(pl.frame), SHINE = P('#ffffff'), DOOR = P(pl.door);
  const out = new Uint32Array(w * h);
  const dist = (i, dx, dy) => { let x = i % w, y = i / w | 0, n = 0; while (n < 64) { x += dx; y += dy; if (x < 0 || y < 0 || x >= w || y >= h || role[y * w + x] !== 2) break; n++; } return n; };
  const door = b.door ? { px: (b.door[0] - b.x0) * TS + 8, bottom: (b.door[1] + 1) * TS - by - 1 } : null;
  for (let i = 0; i < w * h; i++) {
    const r = role[i]; if (!r) continue;
    const x = i % w, y = i / w | 0;
    if (r === 2) {
      const dT = dist(i, 0, -1), dB = dist(i, 0, 1), dL = dist(i, -1, 0), dR = dist(i, 1, 0), m = Math.min(dT, dB, dL, dR);
      let c;
      if (pl.flat) {
        const acc = ACCENTS[b.v % ACCENTS.length];
        c = m < 1 ? P(acc[1]) : m < 3 ? P(acc[0]) : m < 4 ? Rc[2] : ((x & 15) === 0 || (y & 15) === 0) ? Rc[2] : ((x >> 4) + (y >> 4)) & 1 ? Rc[0] : Rc[1];
        if (m >= 5 && hash(x >> 4, y >> 4) < .1 && (x & 15) > 3 && (x & 15) < 12 && (y & 15) > 4 && (y & 15) < 12) c = (y & 15) === 5 ? P('#f4f6f8') : (x & 15) === 11 || (y & 15) === 11 ? P('#7c838c') : P('#c3c8ce');
      } else {
        c = m === dB ? Rc[0] : m === dT || m === dL ? Rc[1] : Rc[2];
        if (m === dB && (dB & 3) === 3) c = mixP(c, '#1a1630', .22);          // tile rows on the front slope
        if (m !== dB && (m & 3) === 3) c = mixP(c, '#1a1630', .12);
        if (dB === dT && m > 2) c = mixP(Rc[1], '#ffffff', .25);              // ridge
        if (dB === 0) c = mixP(Rc[2], '#1a1630', .3);                         // eave edge
      }
      out[i] = c;
    } else {
      const up = local[i], fl = up % TS, lx = x & 15;
      let c = Wc[0];
      if (b.kind === 'sand' && (up % 8 === 0 || ((x + ((up >> 3) & 1) * 8) & 15) === 0)) c = Wc[2];
      if (pl.brick && (up & 3) === 0) c = Wc[2];
      if (up === 0) c = mixP(Wc[2], '#1a1630', .35);
      if (role[i - w] !== 1) c = mixP(Wc[2], '#1a1630', .45);                  // shadow under the eave
      else if (y >= 2 && role[i - 2 * w] !== 1) c = Wc[2];
      const tall = b.kind === 'sand', wx0 = tall ? 5 : 3, wx1 = tall ? 10 : 12, wy0 = tall ? 3 : 5, wy1 = tall ? 12 : 11;
      if (lx >= wx0 && lx <= wx1 && fl >= wy0 && fl <= wy1 && !(door && Math.abs(x - door.px) < 9 && up < 16)) {
        const ly = wy1 - fl, ix = lx - wx0, iw = wx1 - wx0;
        if (!(tall && ly === 0 && (ix === 0 || ix === iw))) c = (ix === 0 || ix === iw || ly === 0 || fl === wy0) ? FR
          : (ix - ly === 1 || ix - ly === 2) && ly < 4 ? SHINE : ly < 3 ? mixP(WIN, '#ffffff', .35) : WIN;
      }
      if (door && Math.abs(x - door.px) <= 5 && y <= door.bottom && door.bottom - y < 15) {
        const dx = Math.abs(x - door.px), dy = door.bottom - y;
        c = dx === 5 || dy === 14 ? FR : dy === 0 ? P('#3a2c22') : DOOR;
        if (pl.glass) { if (dx === 0 && dy < 14) c = FR; else if (dx < 5 && dy > 0 && dy < 14 && (x + dy) % 6 === 0) c = SHINE; }
        else if (dx === 3 && dy === 7) c = P('#f2d04b');
      }
      out[i] = c;
    }
  }
  const ink = new Uint32Array(out);
  for (let i = 0; i < w * h; i++) { if (!role[i]) continue; const x = i % w, y = i / w | 0;
    const e = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || !role[yy * w + xx];
    if (e(x - 1, y) || e(x + 1, y) || e(x, y - 1) || e(x, y + 1) || (role[i] === 2 && y + 1 < h && role[i + w] === 1)) ink[i] = inkOf(out[i]); }
  return { cv: fromBuf(ink, w, h), x: bx, y: by };
}

/* ---------- trees ---------- */
const TPAL = [
  { c: ['#2a6a32', '#3c8a3c', '#56aa4a', '#82cc64'], ink: '#163a1c' },
  { c: ['#4a5e2c', '#617838', '#7a9446', '#9cb462'], ink: '#28341a' },
  { c: ['#1f4e3a', '#2c684a', '#3e845e', '#5aa078'], ink: '#112a20' },
  { c: ['#56409a', '#7258ba', '#9278da', '#b8a2f6'], ink: '#2c2056' },
];
function renderTree(kind, big) {
  const R = big ? 13 : 10, w = R * 2 + 2, h = R * 2 + 12, cx = R + 1, cy = R + 1, pl = TPAL[kind], col = pl.c.map(P), ink = P(pl.ink);
  const o = new Uint32Array(w * h), m = new Uint8Array(w * h);
  for (let y = cy + R - 4; y < h - 1; y++) for (let x = cx - 2; x <= cx + 1; x++) { o[y * w + x] = P(x === cx + 1 ? '#5a3c24' : '#84593a'); m[y * w + x] = 2; }
  const bl = [[0, 0, .78], [-.45, .25, .5], [.45, .25, .5], [0, -.4, .5], [-.35, -.3, .42], [.38, -.25, .42]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + .5 - cx) / R, ny = (y + .5 - cy) / R;
    const inside = kind === 2 ? (ny > -1 && ny < .85 && Math.abs(nx) < (ny + 1.05) * .5) : bl.some(([a, b, r]) => (nx - a) ** 2 + (ny - b) ** 2 < r * r);
    if (!inside) continue;
    const l = .55 - (nx * .55 + ny * .8) * .55 + (hash(x >> 1, y >> 1) - .5) * .25;
    o[y * w + x] = col[l > .8 ? 3 : l > .52 ? 2 : l > .28 ? 1 : 0]; m[y * w + x] = 1;
  }
  const o2 = new Uint32Array(o);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!m[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) o2[i] = m[i] === 1 ? ink : P('#3a2414'); }
  return { cv: fromBuf(o2, w, h), ax: cx, ay: h - 2 };
}
const treeSprites = {};
const treeSprite = t => treeSprites[t.kind + (t.big ? 'b' : '')] ||= renderTree(t.kind, t.big);

/* ---------- characters (16x24 pixel sprites, generated) ---------- */
const SKIN = ['#f6d2b0', '#e8b48c', '#c98d62', '#9c6a44', '#6e472c'];
function renderChar(look, dir, frame) {
  const w = 16, h = 24, px = new Array(w * h).fill(null);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const sk = look.skin, skS = mixHex(sk, '#7a3a2a', .25), hr = look.hair, hrL = mixHex(hr, '#ffffff', .3), hrS = mixHex(hr, '#000000', .3);
  const sh = look.shirt, shS = mixHex(sh, '#000000', .28), pa = look.pants, paS = mixHex(pa, '#000000', .3), so = look.shoes, bg = look.bag, bgS = mixHex(bg, '#000000', .3);
  const side = dir === 'l' || dir === 'r', back = dir === 'u';
  if (!side) { const lu = frame === 1 ? 1 : 0, ru = frame === 2 ? 1 : 0;
    rect(5, 18, 6, 21 - lu, pa); rect(9, 18, 10, 21 - ru, paS); rect(5, 21 - lu, 6, 22 - lu, so); rect(9, 21 - ru, 10, 22 - ru, so); }
  else if (frame === 0) { rect(6, 18, 9, 20, pa); rect(9, 18, 9, 20, paS); rect(6, 21, 9, 22, so); }
  else { // side stride (sprite faces left, so forward is -x): legs slant from the hip to the foot, far leg drawn first
    const leg = (xt, xf, c) => { for (let y = 18; y <= 21; y++) { const x = Math.round(xt + (xf - xt) * (y - 18) / 3); rect(x, y, x + 1, y, c); } rect(xf - 1, 22, xf + 1, 22, so); };
    if (frame === 1) { leg(8, 11, paS); leg(6, 3, pa); }   // near leg forward
    else { rect(7, 18, 8, 18, paS); rect(6, 19, 7, 19, paS); rect(5, 20, 6, 20, paS); rect(3, 21, 5, 21, so);   // passing pose: far leg lifted, knee forward
      rect(7, 18, 8, 21, pa); rect(6, 22, 9, 22, so); }                                                             // near leg planted under the body
  }
  rect(4, 13, 11, 18, sh); rect(10, 13, 11, 18, shS); rect(4, 18, 11, 18, shS);
  if (!side) { const sw = frame === 0 ? 0 : frame === 1 ? 1 : -1; rect(3, 13, 3, 16 - sw, sh); set(3, 17 - sw, sk); rect(12, 13, 12, 16 + sw, shS); set(12, 17 + sw, skS); }
  else { const ax = frame === 0 ? 7 : frame === 1 ? 9 : 5; rect(ax, 14, ax + 1, 16, shS); set(ax, 17, sk); set(ax + 1, 17, skS); } // arm swings opposite the near leg
  if (back) { rect(4, 13, 11, 18, bg); rect(4, 15, 11, 15, bgS); rect(10, 13, 11, 18, bgS); rect(6, 16, 9, 17, bgS); }
  else if (side) { rect(10, 13, 12, 17, bg); rect(12, 13, 12, 17, bgS); }
  else { rect(5, 13, 5, 15, bg); rect(10, 13, 10, 15, bgS); }
  for (let y = 1; y <= 12; y++) for (let x = 2; x <= 13; x++) if (((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1) set(x, y, sk);
  for (let y = 7; y <= 12; y++) if (px[y * w + 13] || px[y * w + 12]) set(12, y, skS);
  const st = look.style;
  for (let y = 0; y <= 12; y++) for (let x = 1; x <= 14; x++) {
    if (!px[y * w + x]) continue;
    const inHead = ((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1; let hair = false;
    if (back) hair = inHead && y <= (st === 1 ? 12 : 10);
    else if (side) hair = inHead && (y <= 4 || (dir === 'l' ? x >= 9 : x <= 6) && y <= (st === 1 ? 12 : 9) || (y === 5 && (dir === 'l' ? x >= 4 : x <= 11) && x % 2 === 0));
    else hair = inHead && (y <= 4 || (y === 5 && x % 3 !== 1) || ((x <= 3 || x >= 12) && y <= (st === 1 ? 12 : 8)));
    if (hair) set(x, y, y <= 2 && (x === 5 || x === 6) ? hrL : (x >= 11 || y >= 9) ? hrS : hr);
  }
  if (st === 1 && !side) { rect(2, 9, 2, 14, hrS); rect(13, 9, 13, 14, hrS); if (back) rect(4, 11, 11, 14, hr); }
  if (st === 2) { rect(6, 0, 9, 1, hr); set(7, 0, hrL); }
  if (st === 3) { const cp = look.hat || '#e03c3c', cpS = mixHex(cp, '#000000', .3);
    for (let y = 1; y <= 4; y++) for (let x = 2; x <= 13; x++) if (((x + .5 - 8) / 6) ** 2 + ((y + .5 - 7) / 6) ** 2 <= 1) set(x, y, x >= 11 ? cpS : cp);
    if (!back) { if (side) rect(dir === 'l' ? 1 : 9, 5, dir === 'l' ? 6 : 14, 5, cpS); else rect(3, 5, 12, 5, cpS); }
    set(7, 2, '#ffffff'); set(8, 2, '#ffffff'); }
  if (!back) {
    if (side) { const ex = dir === 'l' ? 4 : 11; set(ex, 7, '#1d1a2a'); set(ex, 8, '#1d1a2a'); set(dir === 'l' ? 6 : 9, 10, mixHex(sk, '#ff6b6b', .35)); }
    else { set(5, 7, '#1d1a2a'); set(5, 8, '#1d1a2a'); set(10, 7, '#1d1a2a'); set(10, 8, '#1d1a2a'); set(4, 10, mixHex(sk, '#ff6b6b', .35)); set(11, 10, mixHex(sk, '#ff6b6b', .35)); }
  }
  const bob = frame ? 1 : 0, out = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px[y * w + x]; if (!c) continue; const ty = y < 18 ? y + bob : y; if (ty < h) out[ty * w + x] = c; }
  const o = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = out[y * w + x]; if (c) { o[y * w + x] = P(c); continue; }
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) continue;
    const n = [out[y * w + x + 1], out[y * w + x - 1], out[(y + 1) * w + x], out[(y - 1) * w + x]].find(Boolean);
    if (n) o[y * w + x] = inkOf(P(n));
  }
  const cv = fromBuf(o, w, h);
  if (dir === 'r') { const f = canvas(w, h), g = f.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); g.drawImage(cv, 0, 0); return f; }
  return cv;
}
const SHIRTS = ['#e04848', '#3d7fe0', '#2fb36b', '#f2a93b', '#8b5cf6', '#ec4899', '#14b8a6', '#334155'];
const HAIRS = ['#2b1d14', '#5a3a22', '#c9a24a', '#151515', '#8a3b1f', '#6b6b6b', '#d8c39a'];
const PANTS = ['#2f3d63', '#3b3b46', '#5b4636', '#1f2937', '#4b5a7a'];
function lookFor(seed, colour) {
  const h = k => hash(seed * 31 + k, seed * 7 + k * 13);
  return { skin: SKIN[h(1) * SKIN.length | 0], hair: HAIRS[h(2) * HAIRS.length | 0], style: h(3) * 4 | 0, hat: SHIRTS[h(8) * SHIRTS.length | 0],
    shirt: colour || SHIRTS[h(4) * SHIRTS.length | 0], pants: PANTS[h(5) * PANTS.length | 0], shoes: h(6) < .5 ? '#f2f2f2' : '#3a2a22', bag: ['#f2c94c', '#ef6461', '#4a90d9', '#2d2d3a', '#7bc96f'][h(7) * 5 | 0] };
}
const seedOf = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) & 0xffff;
const charCache = new Map();
const charSprite = (look, dir, frame, key) => { const k = key + dir + frame; let s = charCache.get(k); if (!s) { s = renderChar(look, dir, frame); charCache.set(k, s); } return s; };

/* ---------- chunks ---------- */
const chunks = new Map(), bsprites = new Map(), queue = new Map();
const matAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? M.GRASS : mat[y * W + x];
function renderChunk(cx, cy) {
  const c = canvas(CH, CH), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  for (let ty = 0; ty < CHT; ty++) for (let tx = 0; tx < CHT; tx++) {
    const x = cx * CHT + tx, y = cy * CHT + ty; if (x >= W || y >= H) continue;
    const m = mat[y * W + x], nb = [matAt(x, y - 1), matAt(x + 1, y), matAt(x, y + 1), matAt(x - 1, y)];
    let v = (hash(x, y) * 4096) | 0, key = nb;
    if (m === M.GRASS) key = [0, 0, 0, 0];
    else if (m === M.TALL) { key = [nb[0] === M.TALL ? 1 : 0, 0, 0, 0]; v = 0; }
    else if (m === M.PITCH) { key = [0, 0, 0, 0]; v = (x >> 1) & 1; }
    else if (m === M.ROAD) v &= 7;
    else if (m === M.ZEBRA) v = (ROADISH.has(nb[0]) && ROADISH.has(nb[2])) ? 1 : 0;
    else if (WET.has(m)) v = (y & 1) << 3;
    else if (m === M.PATH || m === M.STAIRS) v &= 15;
    else v = 0;
    if (m !== M.GRASS && m !== M.TALL && m !== M.PITCH) key = key.map(n => n === M.GRASS || n === M.PITCH ? 0 : n); // grass/pitch look the same to an edge
    g.drawImage(tileImg(m, key, v), tx * TS, ty * TS);
  }
  const x0 = cx * CHT, y0 = cy * CHT, x1 = x0 + CHT, y1 = y0 + CHT;
  for (const b of blds) {
    if (b.x1 < x0 || b.x0 >= x1 || b.y1 < y0 || b.y0 > y1) continue;
    let s = bsprites.get(b.id); if (!s) { s = renderBuilding(b); bsprites.set(b.id, s); }
    g.drawImage(s.cv, s.x - x0 * TS, s.y - y0 * TS);
  }
  if (bsprites.size > 300) bsprites.clear();
  return c;
}
function want(key, prio, fn) { if (!queue.has(key) || queue.get(key).prio > prio) queue.set(key, { prio, fn }); }
function work(budget) {
  const t0 = performance.now();
  while (queue.size && performance.now() - t0 < budget) {
    let bk = null, bp = 1e18; for (const [k, v] of queue) if (v.prio < bp) { bp = v.prio; bk = k; }
    const job = queue.get(bk); queue.delete(bk); job.fn();
  }
}

/* ---------- forest border outside the map ---------- */
let border = null;
function borderPattern(ctx) {
  if (border) return border;
  const c = canvas(32, 32), g = c.getContext('2d'); g.fillStyle = '#2c6a30'; g.fillRect(0, 0, 32, 32);
  const t = treeSprite({ kind: 0, big: false });
  for (const [x, y] of [[16, 30], [0, 14], [32, 14], [0, 46], [32, 46], [16, -2]]) g.drawImage(t.cv, x - t.ax, y - t.ay);
  return border = ctx.createPattern(c, 'repeat');
}

/* ---------- draw ---------- */
const GRASS_OVER = (() => { const c = canvas(18, 8), g = c.getContext('2d');
  for (let x = 0; x < 18; x++) { const t0 = x % 3 === 1 ? 0 : x % 3 === 0 ? 2 : 1; for (let y = t0; y < 8; y++) { g.fillStyle = y === t0 ? (x % 3 === 1 ? '#62c050' : '#1c5a24') : y === 7 ? '#2b7a30' : x % 3 === 0 ? '#2b7a30' : '#3e9a3e'; g.fillRect(x, y, 1, 1); } } return c; })();
const STAR = [[0, -4], [-1, -3], [0, -3], [1, -3], [-4, -2], [-3, -2], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [3, -2], [4, -2], [-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [3, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, 1], [-1, 1], [1, 1], [2, 1], [-3, 2], [-2, 2], [2, 2], [3, 2]];
function draw(ctx, view, actors, t) {
  const { cx, cy, z, dpr, vw, vh } = view, S = z * dpr;
  const camX = Math.round((cx * TS + 8 - vw / z / 2) * S) / S, camY = Math.round((cy * TS - vh / z / 2) * S) / S;
  const vx0 = camX, vy0 = camY, vx1 = camX + vw / z, vy1 = camY + vh / z;
  ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = borderPattern(ctx); ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  const ccx = (vx0 + vx1) / 2, ccy = (vy0 + vy1) / 2;
  for (let gy = Math.max(0, Math.floor(vy0 / CH) - 1); gy <= Math.min(Math.floor((H * TS - 1) / CH), Math.floor(vy1 / CH) + 1); gy++)
    for (let gx = Math.max(0, Math.floor(vx0 / CH) - 1); gx <= Math.min(Math.floor((W * TS - 1) / CH), Math.floor(vx1 / CH) + 1); gx++) {
      const key = gx + ',' + gy, c = chunks.get(key), vis = (gx + 1) * CH > vx0 && gx * CH < vx1 && (gy + 1) * CH > vy0 && gy * CH < vy1;
      if (c) { if (vis) ctx.drawImage(c, gx * CH, gy * CH); }
      else { if (vis) { ctx.fillStyle = '#7ccf5a'; ctx.fillRect(gx * CH, gy * CH, Math.min(CH, W * TS - gx * CH), Math.min(CH, H * TS - gy * CH)); }
        want(key, Math.hypot(gx * CH + CH / 2 - ccx, gy * CH + CH / 2 - ccy) - (vis ? 1e6 : 0), () => { chunks.set(key, renderChunk(gx, gy)); if (chunks.size > 60) chunks.delete(chunks.keys().next().value); }); }
    }
  ctx.fillStyle = '#ffffff'; // water sparkle
  for (let k = 0; k < 60; k++) {
    const ph = t / 700 + k * .37, sx = vx0 + hash(k, ph | 0) * (vx1 - vx0), sy = vy0 + hash(k + 99, ph | 0) * (vy1 - vy0);
    if (!WET.has(matAt(sx / TS | 0, sy / TS | 0)) || ph % 1 > .5) continue;
    ctx.fillRect(sx | 0, sy | 0, 1, 1); if (ph % 1 > .15 && ph % 1 < .35) { ctx.fillRect((sx | 0) - 1, sy | 0, 3, 1); ctx.fillRect(sx | 0, (sy | 0) - 1, 1, 3); }
  }
  const list = [];
  for (const tr of trees) { const x = tr.tx * TS + 8, y = tr.ty * TS + 15; if (x < vx0 - 20 || x > vx1 + 20 || y < vy0 - 4 || y > vy1 + 40) continue; list.push([y, 0, tr, x, y]); }
  for (const a of actors) { const x = Math.round(a.x * TS + 8), y = Math.round(a.y * TS + 15); if (x < vx0 - 20 || x > vx1 + 20 || y < vy0 - 4 || y > vy1 + 30) continue; list.push([y + .5, 1, a, x, y]); }
  list.sort((a, b) => a[0] - b[0]);
  for (const [, k, o, x, y] of list) {
    if (k === 0) { const s = treeSprite(o); ctx.fillStyle = 'rgba(20,40,30,.22)'; ctx.fillRect(x - 7, y - 1, 14, 3); ctx.drawImage(s.cv, x - s.ax, y + 1 - s.ay); }
    else drawActor(ctx, o, x, y, t);
  }
  return { camX, camY, S };
}
function drawActor(ctx, a, x, y, t) {
  if (a.star) { const by = y - 8 + Math.round(Math.sin(t / 250) * 2); ctx.fillStyle = 'rgba(20,24,60,.25)'; ctx.fillRect(x - 3, y - 1, 7, 2);
    ctx.fillStyle = '#7a5a00'; for (const [dx, dy] of STAR) ctx.fillRect(x + dx, by + dy + 1, 1, 1);
    ctx.fillStyle = '#ffd84a'; for (const [dx, dy] of STAR) ctx.fillRect(x + dx, by + dy, 1, 1); ctx.fillStyle = '#fff6b0'; ctx.fillRect(x - 1, by - 2, 1, 1); return; }
  if (a.swim) { ctx.fillStyle = '#e8f6ff'; ctx.fillRect(x - 9, y - 5, 18, 1); ctx.fillStyle = '#4288d8'; ctx.fillRect(x - 9, y - 4, 18, 5); }
  else { ctx.fillStyle = 'rgba(20,24,60,.28)'; ctx.fillRect(x - 5, y - 1, 10, 2); ctx.fillRect(x - 4, y - 2, 8, 4); }
  if (a.bike) { ctx.fillStyle = '#1d1a2a'; for (const wx of [-7, 4]) { ctx.fillRect(x + wx, y - 6, 4, 1); ctx.fillRect(x + wx - 1, y - 5, 1, 4); ctx.fillRect(x + wx + 4, y - 5, 1, 4); ctx.fillRect(x + wx, y - 1, 4, 1); }
    ctx.fillStyle = '#e04848'; ctx.fillRect(x - 4, y - 7, 9, 1); ctx.fillRect(x - 1, y - 9, 1, 3); }
  const s = charSprite(a.look, a.dir, a.frame, a.lookKey);
  if (a.swim) ctx.drawImage(s, 0, 0, 16, 18, x - 8, y - 22, 16, 18);
  else ctx.drawImage(s, x - 8, y - 23 - (a.bike ? 3 : 0));
  if (a.tall && !a.bike) ctx.drawImage(GRASS_OVER, x - 9, y - 7 + (a.frame ? 1 : 0));
  if (a.marker) { const by = y - 36 + (Math.floor(t / 300) % 2); ctx.fillStyle = '#1d1a2a'; ctx.fillRect(x - 3, by - 1, 7, 10); ctx.fillStyle = a.marker === 'target' ? '#ff5a7a' : '#ffffff'; ctx.fillRect(x - 2, by, 5, 8);
    ctx.fillStyle = a.marker === 'target' ? '#ffffff' : '#e8344e'; ctx.fillRect(x, by + 1, 1, 4); ctx.fillRect(x, by + 6, 1, 1); }
}

/* ---------- minimap: one pixel per tile ---------- */
function buildMini() {
  mini = canvas(W, H); const g = mini.getContext('2d'), img = g.createImageData(W, H), o = new Uint32Array(img.data.buffer);
  const MC = { [M.GRASS]: '#7ccf5a', [M.TALL]: '#3e9a3e', [M.PATH]: '#ead9a2', [M.PLAZA]: '#e3dfd1', [M.ROAD]: '#8e9099', [M.ZEBRA]: '#c0c2ca', [M.WATER]: '#5aa6f2', [M.POOL]: '#62d0f5', [M.PITCH]: '#6cc552', [M.STAIRS]: '#d7c182', [M.BRIDGE]: '#a07848', [M.SAND]: '#f0dca0' };
  const MP = Object.fromEntries(Object.entries(MC).map(([k, v]) => [k, P(v)]));
  for (let i = 0; i < W * H; i++) o[i] = bid[i] >= 0 ? P(blds[bid[i]].pal.roof[0]) : treeAt[i] ? P('#2c6a30') : MP[mat[i]];
  g.putImageData(img, 0, 0);
}

/* ---------- queries ---------- */
const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
function walkable(x, y, surf = false) {
  if (!inMap(x, y)) return false; const i = y * W + x;
  return bid[i] < 0 && !treeAt[i] && (!WET.has(mat[i]) || surf);
}
// every teleport target (spawn, saved spot, fast travel, fly, NPCs) lands on the main campus, never in a cut-off pocket
function nearestFree(x, y) { x = Math.round(x); y = Math.round(y); for (let r = 0; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (inMain(x + dx, y + dy)) return [x + dx, y + dy]; } return [x, y]; }
function door(name) { const b = blds.filter(b => b.name === name).sort((a, b) => (!!b.door - !!a.door) || b.tiles.length - a.tiles.length)[0];
  if (!b) return null; return b.door ? nearestFree(b.door[0], b.door[1] + 1) : nearestFree((b.x0 + b.x1) / 2, b.y1 + 1); }
function find(name) { const d = door(name); if (d) return d; const l = labelsRaw.find(l => l[0] === name); return l ? nearestFree(l[1], l[2]) : null; }
function labels() {
  const big = new Set(['The Quadrangle', 'Fisher Library', 'Charles Perkins Centre', 'Jane Foss Russell Building', 'H70 Abercrombie Building', 'Wentworth Building', 'Manning House', 'Holme Building', 'Great Hall', 'Law Building', 'Anderson-Stuart Building', 'Madsen Building', 'Chau Chak Wing Museum', 'Susan Wakil Health Building (SWHB)', 'Sydney Nanoscience Hub', 'Social Sciences Building (SSB)', 'Brennan-MacCallum', 'Old Teachers College', 'Carslaw Building', 'Seymour Centre', 'Michael Spence Building', 'Merewether Building', 'The Economics and Business Building, The University of Sydney']);
  const out = [], seen = new Set();
  for (const b of blds) if (b.name && (b.kind === 'sand' || b.kind === 'uni') && !seen.has(b.name)) { seen.add(b.name);
    out.push({ t: b.name.replace(' (SWHB)', '').replace(' (SSB)', '').replace('H70 Abercrombie Building', 'Abercrombie · Business School').replace('The Economics and Business Building, The University of Sydney', 'Economics & Business'), x: (b.x0 + b.x1 + 1) / 2, y: b.y0, big: big.has(b.name) }); }
  for (const [t, x, y] of labelsRaw) if (!seen.has(t)) { seen.add(t); out.push({ t, x, y, big: true, park: true }); }
  return out;
}

return {
  TS, load, draw, work, walkable, nearestFree, door, find, labels, lookFor, seedOf,
  charSprite: (look, dir, frame) => renderChar(look, dir, frame),
  inMain, isChoke,
  isTall: (x, y) => inMap(x, y) && mat[y * W + x] === M.TALL,
  isWater: (x, y) => inMap(x, y) && WET.has(mat[y * W + x]),
  get ready() { return ready; }, get anchors() { return anchorsM; }, get size() { return [W, H]; }, get mini() { return mini; }, MS: 1,
  pending: () => queue.size,
};
})();
