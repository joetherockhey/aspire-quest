// Campus world: a Pokémon-style walkable (stylised, not-to-scale) Camperdown/Darlington campus.
// Uses the globals from index.html (S, commit, doQuest, openQuest, QUESTS, CAPS, CAP, lvl, rank, RANKS, toast, selectTab, DOMAINS).
window.Campus = (() => {
const RELAY = 'wss://aspire-quest-relay.josephpeterhoffmann.workers.dev/room/';
const TS = 16, MW = 60, MH = 44;
const BLOCK = new Set(['r', 'w', 't', 'j', '#', 'd']);

/* ---------- map ---------- */
const M = [...Array(MH)].map(() => Array(MW).fill('g'));
const BID = [...Array(MH)].map(() => Array(MW).fill(-1));
const B = [];
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < MH && i >= 0 && i < MW) M[j][i] = c; };
function bld(name, x, y, w, h, roof, wall, door, id = B.length) {
  if (!B[id]) B[id] = { name, x, y, w, h, roof, wall };
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { M[j][i] = '#'; BID[j][i] = id; }
  if (door) M[door[1]][door[0]] = 'd';
  return id;
}
// roads
rect(0, 0, MW, 2, 'r'); rect(44, 2, 2, MH - 2, 'r');
rect(44, 8, 2, 1, 'z'); rect(44, 31, 2, 1, 'f');
// paths
rect(2, 15, 42, 1, 'p'); rect(30, 14, 2, MH - 15, 'p');      // Science Rd, Eastern Ave
rect(6, 10, 1, 5, 'p'); rect(20, 11, 3, 4, 'p');             // Holme, Quad archway
rect(28, 22, 2, 1, 'p'); rect(32, 20, 2, 1, 'p');            // Fisher, New Law
rect(8, 16, 1, 3, 'p'); rect(32, 31, 12, 1, 'p'); rect(38, 30, 1, 1, 'p'); // Manning, Wentworth link
rect(32, 37, 1, 1, 'p'); rect(13, 35, 17, 1, 'p');           // JFR, CPC
rect(46, 31, 7, 1, 'p'); rect(52, 32, 1, 1, 'p');            // Darlington to Abercrombie
rect(46, 8, 6, 1, 'p'); rect(32, 8, 12, 1, 'p'); rect(32, 9, 1, 6, 'p'); // to Victoria Park crossing
// Victoria Park
for (let j = 6; j <= 14; j++) for (let i = 49; i <= 58; i++) if (((i - 53.5) / 4.6) ** 2 + ((j - 10) / 3.6) ** 2 < 1) M[j][i] = 'w';
rect(47, 17, 5, 6, 'l'); rect(55, 18, 4, 7, 'l'); rect(14, 38, 7, 5, 'l');
// buildings
bld('Holme Building', 2, 4, 9, 6, '#8d5a4a', '#d8b98a', [6, 9]);
const q = B.length; // Quadrangle ring
bld('The Quadrangle · Great Hall', 14, 3, 15, 3, '#5f6f86', '#dcc08c', null, q);
bld('', 14, 11, 6, 3, '', '', null, q); bld('', 23, 11, 6, 3, '', '', null, q);
bld('', 14, 6, 3, 5, '', '', null, q); bld('', 26, 6, 3, 5, '', '', null, q);
bld('Fisher Library', 18, 18, 10, 9, '#6b6f78', '#c9b79a', [27, 22]);
bld('New Law', 34, 17, 8, 6, '#4f6b70', '#cfd6d4', [34, 20]);
bld('Manning House', 5, 19, 8, 6, '#7a4d5c', '#e2c6a3', [8, 19]);
bld('Wentworth', 34, 25, 9, 5, '#56606e', '#c7c2b8', [38, 29]);
bld('Jane Foss Russell', 33, 34, 10, 7, '#3f5a73', '#e3e7ea', [33, 37]);
bld('Charles Perkins Centre', 2, 31, 11, 9, '#3d6b5e', '#e9ecef', [12, 35]);
bld('Abercrombie · Business School', 47, 33, 11, 8, '#5b4a3a', '#d6a77a', [52, 33]);
// trees (only on grass)
const TREES = [[21,8,'j'],[13,14,'j'],[17,16,'j'],[24,16,'j'],[29,17,'t'],[29,27,'t'],[32,24,'t'],[29,33,'t'],[32,33,'j'],
  [1,3,'t'],[1,12,'t'],[1,20,'t'],[1,27,'t'],[1,41,'t'],[12,3,'t'],[12,12,'j'],[3,13,'t'],[14,25,'t'],[15,29,'j'],[24,29,'t'],
  [20,31,'t'],[26,40,'t'],[23,41,'j'],[36,42,'t'],[40,42,'t'],[33,12,'t'],[37,11,'j'],[41,13,'t'],[40,4,'t'],[36,4,'j'],[32,4,'t'],
  [47,3,'t'],[50,3,'j'],[54,3,'t'],[58,3,'t'],[58,15,'t'],[47,13,'t'],[52,24,'j'],[58,27,'t'],[47,26,'t'],[48,42,'t'],[57,42,'t'],
  [59,36,'t'],[46,37,'t'],[16,33,'t'],[42,23,'t'],[10,28,'j'],[4,27,'t'],[42,16,'t']];
TREES.forEach(([x, y, c]) => { if (M[y][x] === 'g' || M[y][x] === 'l') M[y][x] = c; });

const LABELS = [['Parramatta Rd', 30, 1], ['City Rd', 45, 22], ['Eastern Ave', 31, 29], ['Victoria Park', 53, 16], ['Science Rd', 26, 15]];

/* ---------- NPCs ---------- */
const NPCS = [
  { id: 'captain', n: 'Open Day Captain', x: 19, y: 9, c: '#e0336b', q: ['openday'], at: 'the Quad', say: 'The Quad is the heart of Open Day. Want to help future students find their way around?' },
  { id: 'welcome', n: 'Welcome Crew', x: 47, y: 9, c: '#f5a524', q: ['welcome'], at: 'Victoria Park', say: 'Welcome Week stalls are set up all over Victoria Park. Come say hi!' },
  { id: 'cafe', n: 'Café Manager', x: 8, y: 10, c: '#b8733a', q: ['job'], at: 'Holme Building', say: 'Working shifts while you study? That experience counts. Tell me what you learned.' },
  { id: 'librarian', n: 'Librarian', x: 28, y: 23, c: '#6d4cf5', q: ['study', 'ai'], at: 'Fisher Library', say: 'Study groups meet on Level 2, and the responsible AI workshop is in the training room.' },
  { id: 'society', n: 'Society Rep', x: 9, y: 18, c: '#0b9488', q: ['club', 'care'], at: 'Manning House', say: 'Clubs, societies and volunteering all run out of Manning. Want to get involved?' },
  { id: 'hub', n: 'Innovation Hub', x: 39, y: 30, c: '#2f8fd8', q: ['hack'], at: 'Wentworth', say: 'Hackathon this weekend! Bring an idea, leave with a prototype.' },
  { id: 'mentor', n: 'Mentor Matcher', x: 32, y: 38, c: '#9b84ff', q: ['mentee', 'mentor'], at: 'Jane Foss Russell', say: 'Looking for a mentor, or ready to become one? I can match you.' },
  { id: 'careers', n: 'Careers Adviser', x: 51, y: 32, c: '#5b3df5', q: ['industry', 'wil'], at: 'the Business School', say: 'Employer panels every Wednesday, and placement applications are open.' },
  { id: 'coach', n: 'Case Comp Coach', x: 53, y: 32, c: '#d97f06', q: ['casecomp'], at: 'the Business School', say: 'Case comp season! Teams of four, 48 hours, real client brief.' },
  { id: 'lead', n: 'Leadership Lead', x: 54, y: 31, c: '#8a7a3a', q: ['leadws'], at: 'the Business School', say: 'Leadership isn’t a title. Come to Thursday’s workshop.' },
  { id: 'well', n: 'Wellbeing Coach', x: 13, y: 34, c: '#3ddc97', q: [], at: 'Charles Perkins Centre', say: 'Feeling drained after a tough challenge? Take a breath. Your energy is fully restored.', heal: true },
];
const npcAt = (x, y) => NPCS.find(n => n.x === x && n.y === y);

/* ---------- challenges (tall-grass encounters) ---------- */
const FOES = [
  { n: 'Deadline Dragon', e: '🐉', hp: 70, weak: 'leap', resist: 'heart', hit: 'breathes out a 9am due date' },
  { n: 'Group Project Ghost', e: '👻', hp: 65, weak: 'heart', resist: 'hands', hit: 'vanishes the night before submission' },
  { n: 'Data Swamp', e: '🐊', hp: 75, weak: 'hands', resist: 'leap', hit: 'floods you with messy spreadsheets' },
  { n: 'Fake News Phantom', e: '🦹', hp: 60, weak: 'head', resist: 'heart', hit: 'spreads a viral rumour' },
  { n: 'Imposter Syndrome', e: '🪞', hp: 65, weak: 'heart', resist: 'head', hit: 'whispers "you don’t belong here"' },
  { n: 'Networking Nerves', e: '😰', hp: 60, weak: 'leap', resist: 'hands', hit: 'freezes your handshake' },
];
const DAILY_BATTLE_XP = 75, WIN_XP = 15;

/* ---------- state ---------- */
const me = { x: 21, y: 14, d: 'd', px: 21, py: 14, moving: 0, fx: 0, fy: 0, tx: 0, ty: 0, energy: 100, step: 0 };
if (S.pos) Object.assign(me, S.pos, { px: S.pos.x, py: S.pos.y });
const others = new Map();
let ws = null, myId = null, room = '', retry = 2000, target = null, battle = null, busy = false;
const keys = new Set();

/* ---------- DOM ---------- */
const $ = s => document.querySelector(s);
const stage = $('#stage'), cv = $('#map'), ctx = cv.getContext('2d');
const tbox = $('#tbox'), net = $('#netStatus');
let scale = 3, vw = 0, vh = 0, dpr = 1;

// pre-render the map once at 16px per tile
const off = document.createElement('canvas'); off.width = MW * TS; off.height = MH * TS;
const o = off.getContext('2d');
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const px = (x, y, w, h, c) => { o.fillStyle = c; o.fillRect(x, y, w, h); };
function grass(X, Y, base = '#6dbb5a', dark = '#5aa84a') { px(X, Y, TS, TS, base); for (let k = 0; k < 5; k++) px(X + (rnd() * 15 | 0), Y + (rnd() * 15 | 0), 1, 2, dark); }
function paint() {
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const X = x * TS, Y = y * TS, c = M[y][x];
    if (c === 'g') grass(X, Y);
    else if (c === 'l') { px(X, Y, TS, TS, '#4e9a3f'); for (let k = 0; k < 4; k++) { const bx = X + 2 + k * 4; px(bx, Y + 5, 1, 9, '#3c7f31'); px(bx + 1, Y + 3, 1, 9, '#62b24f'); } }
    else if (c === 'p') { px(X, Y, TS, TS, '#e6d6aa'); for (let k = 0; k < 4; k++) px(X + (rnd() * 15 | 0), Y + (rnd() * 15 | 0), 2, 1, '#d2c08f'); }
    else if (c === 'r') { px(X, Y, TS, TS, '#4a4a55'); if ((y === 1 && x % 3 === 0)) px(X + 2, Y - 1, 8, 2, '#f2d04b'); if (x === 45 && y % 3 === 0 && y > 2) px(X - 1, Y + 2, 2, 8, '#f2d04b'); }
    else if (c === 'z') { px(X, Y, TS, TS, '#4a4a55'); for (let k = 0; k < 4; k++) px(X + 1 + k * 4, Y + 1, 2, 14, '#f4f4f4'); }
    else if (c === 'f') { px(X, Y, TS, TS, '#a08466'); for (let k = 0; k < 4; k++) px(X + k * 4, Y, 1, TS, '#8a6f53'); px(X, Y, TS, 2, '#6b5640'); px(X, Y + 14, TS, 2, '#6b5640'); }
    else if (c === 'w') { px(X, Y, TS, TS, '#3e8ed0'); px(X + (rnd() * 10 | 0), Y + (rnd() * 12 | 0), 5, 1, '#8cc4f0'); }
    else if (c === 't' || c === 'j') { grass(X, Y); px(X + 7, Y + 10, 3, 5, '#6b4a2b'); o.fillStyle = c === 'j' ? '#9b7fd4' : '#2f7d3a'; o.beginPath(); o.arc(X + 8, Y + 7, 7, 0, 7); o.fill(); o.fillStyle = c === 'j' ? '#b9a2ea' : '#3f9a4a'; o.beginPath(); o.arc(X + 6, Y + 5, 3, 0, 7); o.fill(); }
    else if (c === '#' || c === 'd') {
      const b = B[BID[y][x]] || B[q]; const id = BID[y][x];
      const front = y + 1 >= MH || BID[y + 1][x] !== id;
      if (c === 'd') { px(X, Y, TS, TS, b.wall); px(X + 3, Y + 3, 10, 13, '#3a2a1f'); px(X + 4, Y + 4, 8, 12, '#5c4330'); px(X + 10, Y + 9, 1, 2, '#f2d04b'); continue; }
      if (front) { px(X, Y, TS, TS, b.wall); px(X, Y, TS, 2, 'rgba(0,0,0,.25)'); px(X + 3, Y + 5, 4, 6, '#30485f'); px(X + 9, Y + 5, 4, 6, '#30485f'); px(X + 3, Y + 5, 4, 1, '#8fb3d1'); px(X + 9, Y + 5, 4, 1, '#8fb3d1'); }
      else { px(X, Y, TS, TS, b.roof); px(X, Y + 7, TS, 1, 'rgba(0,0,0,.15)'); px(X, Y + 15, TS, 1, 'rgba(0,0,0,.15)'); }
    }
  }
}
paint();

/* ---------- characters ---------- */
const HAIR = ['#2b1d14', '#5a3a22', '#c9a24a', '#1d1d1d', '#8a3b1f', '#6b6b6b'];
const hairOf = s => HAIR[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HAIR.length];
function drawChar(sx, sy, col, hair, dir, step, s) {
  const P = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(sx + x * s, sy + y * s, w * s, h * s); };
  P(3, 14, 10, 2, 'rgba(0,0,0,.25)');
  const l = step ? 1 : 0;
  P(5, 11, 2, 3 - l, '#2b2b44'); P(9, 11, 2, 3 - (1 - l) * (step ? 1 : 0), '#2b2b44');
  P(4, 7, 8, 5, col); P(3, 8, 1, 3, '#f2c9a0'); P(12, 8, 1, 3, '#f2c9a0');
  P(4, 1, 8, 6, '#f2c9a0');
  if (dir === 'u') P(4, 1, 8, 5, hair);
  else {
    P(4, 1, 8, 2, hair);
    if (dir === 'd') { P(4, 3, 1, 2, hair); P(11, 3, 1, 2, hair); P(6, 4, 1, 1, '#222'); P(9, 4, 1, 1, '#222'); }
    if (dir === 'l') { P(9, 1, 3, 4, hair); P(5, 4, 1, 1, '#222'); }
    if (dir === 'r') { P(4, 1, 3, 4, hair); P(10, 4, 1, 1, '#222'); }
  }
}

/* ---------- view ---------- */
function resize() {
  const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  vw = r.width; vh = r.height; cv.width = vw * dpr; cv.height = vh * dpr;
  scale = Math.max(2, Math.round(vw / (TS * 19)));
}
window.addEventListener('resize', resize);

function draw(t) {
  const s = scale, T = TS * s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2f7d3a'; ctx.fillRect(0, 0, vw, vh);
  let camX = me.px * T + T / 2 - vw / 2, camY = me.py * T + T / 2 - vh / 2;
  camX = Math.max(0, Math.min(MW * T - vw, camX)); camY = Math.max(0, Math.min(MH * T - vh, camY));
  if (MW * T < vw) camX = (MW * T - vw) / 2; if (MH * T < vh) camY = (MH * T - vh) / 2;
  ctx.drawImage(off, camX / s, camY / s, vw / s, vh / s, 0, 0, vw, vh);
  const sx = x => x * T - camX, sy = y => y * T - camY;

  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(10, s * 4)}px Inter, sans-serif`;
  B.forEach(b => { if (!b.name) return; const lx = sx(b.x + b.w / 2), ly = sy(b.y) + T * .7; tag(b.name, lx, ly, 'rgba(20,16,40,.72)', '#fff'); });
  ctx.font = `600 ${Math.max(9, s * 3.4)}px Inter, sans-serif`;
  LABELS.forEach(([n, x, y]) => tag(n, sx(x), sy(y) + T / 2, 'rgba(255,255,255,.75)', '#333'));

  // actors sorted by y
  const actors = [
    ...NPCS.map(n => ({ k: 'npc', n, x: n.x, y: n.y })),
    ...[...others.values()].map(p => ({ k: 'p', p, x: p.px, y: p.py })),
    { k: 'me', x: me.px, y: me.py },
  ].sort((a, b) => a.y - b.y);
  ctx.font = `600 ${Math.max(10, s * 3.4)}px Inter, sans-serif`;
  for (const a of actors) {
    const X = sx(a.x), Y = sy(a.y);
    if (X < -T * 2 || Y < -T * 2 || X > vw + T || Y > vh + T) continue;
    if (a.k === 'npc') {
      drawChar(X, Y, a.n.c, '#3a2a1f', 'd', 0, s);
      if (npcHasNew(a.n)) bubble('!', X + T / 2, Y - T * .35 + Math.sin(t / 200) * 2, '#f2d04b', '#222');
      if (target === a.n) bubble('▼', X + T / 2, Y - T * .9 + Math.sin(t / 150) * 4, '#e0336b', '#fff');
    } else if (a.k === 'p') {
      const p = a.p; drawChar(X, Y, p.color || '#888', hairOf(p.name), p.d || 'd', p.moving ? (Math.floor(t / 150) % 2) : 0, s);
      tag(p.name || '…', X + T / 2, Y - T * .25, 'rgba(20,16,40,.7)', '#fff');
      if (p.say && p.sayT > t) bubble(p.say, X + T / 2, Y - T * .85, '#fff', '#111');
    } else {
      drawChar(X, Y, S.color || '#5b3df5', hairOf(S.name), me.d, me.moving ? me.step % 2 : 0, s);
      tag(S.name + ' (you)', X + T / 2, Y - T * .25, 'rgba(91,61,245,.9)', '#fff');
      if (me.say && me.sayT > t) bubble(me.say, X + T / 2, Y - T * .85, '#fff', '#111');
    }
  }
  // off-screen waypoint arrow
  if (target) {
    const X = sx(target.x) + T / 2, Y = sy(target.y) + T / 2;
    if (X < 0 || Y < 0 || X > vw || Y > vh) {
      const ang = Math.atan2(Y - vh / 2, X - vw / 2), r = Math.min(vw, vh) / 2 - 30;
      const ax = vw / 2 + Math.cos(ang) * r, ay = vh / 2 + Math.sin(ang) * r;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.fillStyle = '#e0336b';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.fill(); ctx.restore();
      ctx.font = '700 12px Inter, sans-serif'; tag(target.n, ax, ay + 22, 'rgba(224,51,107,.95)', '#fff');
    }
  }
}
function tag(text, x, y, bg, fg) {
  const w = ctx.measureText(text).width + 10, h = parseInt(ctx.font.match(/(\d+)px/)[1]) + 6;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 5); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(text, x, y + 1);
}
function bubble(text, x, y, bg, fg) {
  ctx.font = `600 ${Math.max(11, scale * 3.6)}px Inter, sans-serif`;
  const w = Math.min(ctx.measureText(text).width + 14, 260), h = Math.max(11, scale * 3.6) + 10;
  ctx.fillStyle = bg; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.fillText(text.length > 40 ? text.slice(0, 39) + '…' : text, x, y - h / 2 + 1);
}
const npcHasNew = n => n.q.some(id => { const qq = QUESTS.find(x => x.id === id); return qq && (qq.rep ? !S.q[id] : !S.q[id]); });

/* ---------- movement ---------- */
const DIR = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const KEYMAP = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r' };
const walkable = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && !BLOCK.has(M[y][x]) && !npcAt(x, y);
const active = () => !$('#campus').hidden && !busy && !battle && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
function tryMove() {
  if (me.moving || !active()) return;
  const k = [...keys].pop(); if (!k) return;
  me.d = k; const [dx, dy] = DIR[k], nx = me.x + dx, ny = me.y + dy;
  if (!walkable(nx, ny)) return;
  me.moving = 1; me.fx = me.x; me.fy = me.y; me.tx = nx; me.ty = ny; me.t = 0; me.step++;
}
function arrive() {
  me.x = me.tx; me.y = me.ty; me.px = me.x; me.py = me.y; me.moving = 0;
  S.pos = { x: me.x, y: me.y, d: me.d }; saveSoon();
  send({ t: 'mv', x: me.x, y: me.y, d: me.d });
  if (M[me.y][me.x] === 'l' && me.energy > 0 && Math.random() < 0.14) startBattle();
  if (target && Math.abs(target.x - me.x) + Math.abs(target.y - me.y) <= 1) { target = null; }
}
let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('aspire-quest-v1', JSON.stringify(S)); } catch (e) {} }, 800); };

let last = performance.now();
function loop(t) {
  const dt = Math.min(50, t - last); last = t;
  if (!$('#campus').hidden) {
    if (vw === 0) resize();
    tryMove();
    if (me.moving) { me.t += dt / 170; if (me.t >= 1) arrive(); else { me.px = me.fx + (me.tx - me.fx) * me.t; me.py = me.fy + (me.ty - me.fy) * me.t; } }
    for (const p of others.values()) { const dx = p.x - p.px, dy = p.y - p.py; p.moving = Math.abs(dx) + Math.abs(dy) > .02; p.px += dx * Math.min(1, dt / 120); p.py += dy * Math.min(1, dt / 120); if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { p.px = p.x; p.py = p.y; } }
    draw(t);
  }
  requestAnimationFrame(loop);
}

/* ---------- interaction ---------- */
function facing() { const [dx, dy] = DIR[me.d]; return [me.x + dx, me.y + dy]; }
function interact() {
  if (!active() && !tbox.hidden) return closeBox();
  if (!active()) return;
  const [fx, fy] = facing();
  const n = npcAt(fx, fy);
  if (n) return talk(n);
  const p = [...others.values()].find(p => p.x === fx && p.y === fy);
  if (p) return meet(p);
  const c = M[fy]?.[fx];
  if (c === 'd') { const b = B[BID[fy][fx]]; box(b.name, 'The doors are open, but the action is outside today. Look for the people with a <b>!</b> above their heads.'); }
}
function box(title, html, buttons = []) {
  busy = true; tbox.hidden = false;
  tbox.innerHTML = `<div class="tb-name">${title}</div><div class="tb-text">${html}</div><div class="tb-btns">${buttons.map((b, i) => `<button class="btn sm ${b.primary ? 'primary' : ''}" data-tb="${i}">${b.label}</button>`).join('')}<button class="btn sm" data-tb="x">Close</button></div>`;
  tbox._b = buttons; tbox.querySelector('.tb-btns button')?.focus();
}
function closeBox() { tbox.hidden = true; busy = false; stage.focus(); }
tbox.addEventListener('click', e => {
  const b = e.target.closest('[data-tb]'); if (!b) return;
  const fn = b.dataset.tb === 'x' ? null : tbox._b[+b.dataset.tb].fn;
  closeBox(); fn && fn();
});
function talk(n) {
  if (n.heal) { me.energy = 100; return box(n.n + ' · ' + n.at, n.say + `<br><span class="small muted">Energy ${me.energy}/100</span>`); }
  const qs = n.q.map(id => QUESTS.find(x => x.id === id));
  box(n.n + ' · ' + n.at, n.say, qs.map(qq => ({ label: (!qq.rep && S.q[qq.id] ? '✓ ' : '') + qq.n + ' · +' + qq.xp + ' XP', primary: !S.q[qq.id], fn: () => { if (!qq.rep && S.q[qq.id]) return toast('Already completed'); openQuest(qq.id); } })));
}
function meet(p) {
  const fr = S.friends && S.friends[p.name];
  box(p.name, `${RANKS[p.rank || 0]?.n || 'Rookie'} · ${p.xp || 0} XP${p.top ? ' · strongest: ' + esc(p.top) : ''}${fr ? '<br>🤝 In your squad' : ''}`, [
    { label: '👋 Wave', fn: () => emote('👋') },
    ...(fr ? [] : [{ label: '🤝 Squad up', primary: true, fn: () => { send({ t: 'invite', to: p.id }); toast(`Squad invite sent to ${p.name}`); } }]),
  ]);
}
function addFriend(name, xp, rk) { S.friends = S.friends || {}; S.friends[name] = { xp: xp || 0, rank: rk || 0 }; commit(() => {}); }

/* ---------- battles ---------- */
function moves() {
  const ms = CAPS.filter(c => lvl(c.id) >= 1 && (!c.req || Object.entries(c.req).every(([k, v]) => lvl(k) >= v))).sort((a, b) => lvl(b.id) - lvl(a.id)).slice(0, 4)
    .map(c => ({ n: c.n, d: c.d, l: lvl(c.id), pow: 10 + 8 * lvl(c.id) }));
  return ms.length ? ms : [{ n: 'Wing it', d: null, l: 0, pow: 14 }];
}
function startBattle() {
  const f = FOES[Math.random() * FOES.length | 0];
  battle = { f, hp: f.hp, msg: `A wild <b>${f.n}</b> appeared!`, lock: false };
  keys.clear(); renderBattle();
}
function renderBattle() {
  const el = $('#battle'); if (!battle) { el.hidden = true; return; }
  const { f } = battle; el.hidden = false;
  el.innerHTML = `<div class="bt-foe"><div class="bt-card"><b>${f.n}</b><span class="small">Weak to ${DOMAINS[f.weak].name} · resists ${DOMAINS[f.resist].name}</span><div class="bar"><i style="width:${battle.hp / f.hp * 100}%;background:#e0336b"></i></div></div><div class="bt-sprite">${f.e}</div></div>
    <div class="bt-me"><div class="bt-sprite me" style="--c:${S.color || '#5b3df5'}">🎒</div><div class="bt-card"><b>${esc(S.name)}</b><span class="small">Energy ${me.energy}/100</span><div class="bar"><i style="width:${me.energy}%;background:#0f9d6b"></i></div></div></div>
    <div class="bt-panel"><div class="bt-msg">${battle.msg}</div><div class="bt-moves">${battle.done ? '<button class="btn primary" data-bm="end">Continue</button>' :
      moves().map((m, i) => `<button class="btn" data-bm="${i}" style="border-left:4px solid ${m.d ? `var(${DOMAINS[m.d].c})` : 'var(--line)'}" ${battle.lock ? 'disabled' : ''}>${m.n}<span class="small muted"> · L${m.l}</span></button>`).join('') + `<button class="btn" data-bm="run" ${battle.lock ? 'disabled' : ''}>🏃 Run</button>`}</div></div>`;
}
$('#battle').addEventListener('click', e => {
  const b = e.target.closest('[data-bm]'); if (!b || !battle) return;
  const v = b.dataset.bm;
  if (v === 'end') { battle = null; renderBattle(); return; }
  if (v === 'run') { battle.msg = 'You got away safely.'; battle.done = true; renderBattle(); return; }
  const m = moves()[+v], f = battle.f;
  const eff = m.d === f.weak ? 2 : m.d === f.resist ? .5 : 1;
  const dmg = Math.round(m.pow * eff * (0.85 + Math.random() * .3));
  battle.hp = Math.max(0, battle.hp - dmg);
  battle.msg = `You used <b>${m.n}</b>! ${eff > 1 ? "It's super effective! " : eff < 1 ? "It's not very effective… " : ''}(−${dmg})`;
  if (battle.hp <= 0) return win(m);
  battle.lock = true; renderBattle();
  setTimeout(() => {
    if (!battle) return;
    const hit = 8 + (Math.random() * 9 | 0); me.energy = Math.max(0, me.energy - hit);
    battle.msg = `${f.n} ${f.hit}! (−${hit} energy)`; battle.lock = false;
    if (me.energy <= 0) { battle.msg += '<br>You’re out of energy. Visit the <b>Wellbeing Coach</b> at Charles Perkins Centre to recharge.'; battle.done = true; }
    renderBattle();
  }, 900);
});
function win(m) {
  const day = new Date().toISOString().slice(0, 10);
  if (!S.bx || S.bx.d !== day) S.bx = { d: day, xp: 0 };
  const gain = Math.min(WIN_XP, DAILY_BATTLE_XP - S.bx.xp);
  battle.msg = `${battle.f.n} was overcome! ${gain > 0 ? `+${gain} XP.` : 'Daily challenge XP cap reached (75).'}<br><span class="small">Tip: write it up as a <b>${m.n}</b> reflection to level the capability, because XP alone never levels a skill.</span>`;
  battle.done = true;
  if (gain > 0) commit(() => { S.bx.xp += gain; S.xp += gain; });
  renderBattle();
}

/* ---------- multiplayer ---------- */
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function myInfo() { const top = CAPS.filter(c => lvl(c.id) > 0).sort((a, b) => lvl(b.id) - lvl(a.id))[0]; return { name: S.name, color: S.color || '#5b3df5', xp: S.xp, rank: rank(), x: me.x, y: me.y, d: me.d, top: top ? `${top.n} L${lvl(top.id)}` : '' }; }
function setNet() {
  const n = others.size + 1;
  net.innerHTML = ws && ws.readyState === 1 ? `<span class="dot on"></span>${n} online in <b>${esc(room)}</b>` : `<span class="dot"></span>Connecting to <b>${esc(room)}</b>…`;
}
function connect() {
  if (!room) return;
  try { ws = new WebSocket(RELAY + encodeURIComponent(room)); } catch (e) { return; }
  setNet();
  ws.onopen = () => { retry = 2000; send({ t: 'hello', ...myInfo() }); setNet(); };
  ws.onclose = () => { others.clear(); setNet(); setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    const now = performance.now();
    if (m.t === 'init') { myId = m.you; m.players.forEach(up); }
    else if (m.t === 'up') { const isNew = !others.has(m.p.id); up(m.p); if (isNew) toast(`👋 ${m.p.name} joined the campus`); }
    else if (m.t === 'mv') { const p = others.get(m.id); if (p) Object.assign(p, { x: m.x, y: m.y, d: m.d }); }
    else if (m.t === 'leave') others.delete(m.id);
    else if (m.t === 'chat' || m.t === 'emote') {
      const txt = m.t === 'chat' ? m.m : m.e;
      const p = m.id === myId ? me : others.get(m.id); if (p) { p.say = txt; p.sayT = now + 6000; }
      if (m.t === 'chat') logChat(m.id === myId ? S.name : (others.get(m.id)?.name || '?'), m.m);
    }
    else if (m.t === 'invite') box('Squad invite', `<b>${esc(m.name)}</b> wants to squad up. Squad members see each other's progress and earn a bonus for doing quests together.`,
      [{ label: '🤝 Accept', primary: true, fn: () => { send({ t: 'accept', to: m.from }); addFriend(m.name, m.xp, m.rank); toast(`${m.name} joined your squad`); } }]);
    else if (m.t === 'accept') { addFriend(m.name, m.xp, m.rank); toast(`🤝 ${m.name} accepted. You're squadmates!`); }
    setNet();
  };
}
function up(p) {
  const old = others.get(p.id);
  others.set(p.id, Object.assign(old || { px: p.x, py: p.y }, p));
  if (S.friends && S.friends[p.name]) { S.friends[p.name] = { xp: p.xp || 0, rank: p.rank || 0 }; saveSoon(); }
}
function logChat(who, msg) {
  const l = $('#chatLog'); const d = document.createElement('div');
  d.innerHTML = `<b>${esc(who)}:</b> ${esc(msg)}`; l.append(d); while (l.children.length > 6) l.firstChild.remove();
}
function emote(e) { send({ t: 'emote', e }); if (!ws || ws.readyState !== 1) { me.say = e; me.sayT = performance.now() + 4000; } }

/* ---------- setup / controls ---------- */
const COLORS = ['#5b3df5', '#e0336b', '#0b9488', '#d97f06', '#2f8fd8', '#8a3b1f', '#3ddc97', '#1b1830'];
function setup() {
  const params = new URLSearchParams(location.search);
  const r0 = params.get('room') || S.room || 'bcom-2027';
  const first = !S.joined;
  $('#joinBox').hidden = false; busy = true;
  $('#joinBox').innerHTML = `<form id="joinForm"><h2>Join the campus</h2>
    <p class="small muted">Your name and avatar are visible to everyone in your cohort room. Your progress stays on your device. Only your XP and rank are shared.</p>
    <label>Display name<input id="jn" maxlength="24" required value="${esc(S.name === 'Your name' ? '' : S.name)}" placeholder="e.g. Joe H."></label>
    <label>Cohort room code<input id="jr" maxlength="40" pattern="[A-Za-z0-9_\\-]+" required value="${esc(r0)}"></label>
    <div class="swatches">${COLORS.map(c => `<button type="button" data-col="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${(S.color || COLORS[0]) === c}"></button>`).join('')}</div>
    <button class="btn primary" type="submit">${first ? 'Enter campus' : 'Save'}</button></form>`;
  $('#jn').focus();
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-col]'); if (c) { S.color = c.dataset.col; document.querySelectorAll('[data-col]').forEach(b => b.setAttribute('aria-pressed', b === c)); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'joinForm') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const nr = $('#jr').value.trim().toLowerCase();
  S.name = $('#jn').value.trim() || 'Student'; S.color = S.color || COLORS[0]; S.joined = true;
  $('#joinBox').hidden = true; busy = false;
  commit(() => {});
  if (nr !== room) { room = S.room = nr; saveSoon(); if (ws) { ws.onclose = null; ws.close(); others.clear(); } connect(); }
  stage.focus();
}, true);

window.addEventListener('keydown', e => {
  if ($('#campus').hidden) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (document.querySelector('dialog[open]')) return;
  if (document.activeElement?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  if (KEYMAP[e.key]) { e.preventDefault(); keys.delete(KEYMAP[e.key]); keys.add(KEYMAP[e.key]); }
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); interact(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); $('#chatIn').focus(); }
  else if (e.key === 'Escape' && !tbox.hidden) closeBox();
});
window.addEventListener('keyup', e => { if (KEYMAP[e.key]) keys.delete(KEYMAP[e.key]); });
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll('[data-pad]').forEach(b => {
  const k = b.dataset.pad;
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (k === 'a') return interact(); keys.add(k); b.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => keys.delete(k)));
});
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault(); e.stopImmediatePropagation();
  const v = $('#chatIn').value.trim(); if (!v) return;
  if (ws && ws.readyState === 1) send({ t: 'chat', m: v }); else { me.say = v; me.sayT = performance.now() + 6000; logChat(S.name, v); }
  $('#chatIn').value = ''; $('#chatIn').blur(); stage.focus();
}, true);
document.querySelectorAll('[data-emote]').forEach(b => b.addEventListener('click', () => emote(b.dataset.emote)));
$('#profileBtn').addEventListener('click', setup);

if (S.joined) { room = S.room || new URLSearchParams(location.search).get('room') || 'bcom-2027'; connect(); }
const showFirst = () => { if (!S.joined && !$('#campus').hidden) setup(); };
requestAnimationFrame(loop);

return {
  sync() { send({ t: 'me', ...myInfo() }); },
  shown() { resize(); showFirst(); stage.focus(); },
  nearby() { return [...others.values()].filter(p => Math.abs(p.x - me.x) + Math.abs(p.y - me.y) <= 4).map(p => p.name); },
  online(name) { return [...others.values()].some(p => p.name === name); },
  goto(qid) {
    const n = NPCS.find(n => n.q.includes(qid)); if (!n) return;
    target = n; selectTab('campus'); toast(`📍 Head to the ${n.n} at ${n.at}`);
  },
  where(qid) { const n = NPCS.find(n => n.q.includes(qid)); return n ? n.at : ''; },
};
})();
