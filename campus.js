// Campus gameplay on top of World (Pokémon-style tile map of the real campus). Positions are tiles; one tile = 4 m.
// Uses globals from index.html: S, commit, openQuest, QUESTS, CAPS, lvl, rank, RANKS, toast, selectTab, DOMAINS, esc.
window.Campus = (() => {
const RELAY = 'wss://aspire-quest-relay.josephpeterhoffmann.workers.dev/room/';
const $ = s => document.querySelector(s);
const stage = $('#stage'), cv = $('#map'), ctx = cv.getContext('2d'), tbox = $('#tbox'), net = $('#netStatus'), miniCv = $('#mini');
let zo = 0; try { zo = +localStorage.getItem('aq-zoom2') || 0; } catch (e) {}
let vw = 0, vh = 0, dpr = 1, last = performance.now(), camera = null;

/* ---------- NPCs at real entrances ---------- */
const NPCS = [
  { id: 'captain', n: 'Open Day Captain', a: 'quad', dx: -2, dy: 1, q: ['openday'], at: 'the Quadrangle', say: 'Welcome to the Quad! On Open Day this courtyard is packed. Want to help future students find their way?' },
  { id: 'welcome', n: 'Welcome Crew', a: 'frontlawn', dx: 0, dy: 0, q: ['welcome'], at: 'the Front Lawn', say: 'Welcome Week stalls line the Front Lawn. Grab a tote bag and meet your cohort!' },
  { id: 'cafe', n: 'Café Manager', b: 'Holme Building', dx: 1, dy: 0, q: ['job'], at: 'Holme Building', say: 'Juggling shifts and study? That experience counts. Tell me what you learned on the job.' },
  { id: 'librarian', n: 'Librarian', b: 'Fisher Library', dx: 1, dy: 0, q: ['study', 'ai'], at: 'Fisher Library', say: 'Shh! Study groups meet on Level 2, and the responsible AI workshop is in the training room.' },
  { id: 'society', n: 'Society Rep', b: 'Manning House', dx: 1, dy: 0, q: ['club', 'care'], at: 'Manning House', say: 'Clubs, societies and volunteering all run out of Manning. Want to get involved?' },
  { id: 'hub', n: 'Innovation Hub', b: 'Wentworth Building', dx: 1, dy: 0, q: ['hack'], at: 'Wentworth Building', say: 'Hackathon this weekend! Bring an idea, leave with a prototype.' },
  { id: 'mentor', n: 'Mentor Matcher', b: 'Jane Foss Russell Building', dx: 1, dy: 0, q: ['mentee', 'mentor'], at: 'Jane Foss Russell', say: 'Looking for a mentor, or ready to become one? I can match you.' },
  { id: 'careers', n: 'Careers Adviser', b: 'H70 Abercrombie Building', dx: 1, dy: 0, q: ['industry', 'wil'], at: 'the Business School', say: 'Employer panels every Wednesday, and placement applications are open.' },
  { id: 'coach', n: 'Case Comp Coach', b: 'H70 Abercrombie Building', dx: 3, dy: 1, q: ['casecomp'], at: 'the Business School', say: 'Case comp season! Teams of four, 48 hours, real client brief.' },
  { id: 'lead', n: 'Leadership Lead', b: 'H70 Abercrombie Building', dx: -2, dy: 1, q: ['leadws'], at: 'the Business School', say: 'Leadership isn’t a title. Come to Thursday’s workshop.' },
  { id: 'well', n: 'Wellbeing Coach', b: 'Charles Perkins Centre', dx: 1, dy: 0, q: [], at: 'Charles Perkins Centre', say: 'Feeling drained after a tough challenge? Take a breath. Your energy is fully restored.', heal: true },
  { id: 'ranger', n: 'Park Ranger', a: 'vicpark', dx: -4, dy: 2, q: [], at: 'Victoria Park', say: 'Careful in the long grass. Challenges like the Deadline Dragon lurk there! Your capabilities are your moves. HEAD, HEART and HANDS capabilities each beat different challenges.' },
];

/* ---------- challenges ---------- */
const FOES = [
  { n: 'Deadline Dragon', e: '🐉', hp: 70, weak: 'head', resist: 'heart', hit: 'breathes out a 9am due date' },
  { n: 'Group Project Ghost', e: '👻', hp: 65, weak: 'heart', resist: 'hands', hit: 'vanishes the night before submission' },
  { n: 'Data Swamp', e: '🐊', hp: 70, weak: 'hands', resist: 'heart', hit: 'floods you with messy spreadsheets' },
  { n: 'Fake News Phantom', e: '🦹', hp: 60, weak: 'head', resist: 'hands', hit: 'spreads a viral rumour' },
  { n: 'Imposter Syndrome', e: '🪞', hp: 65, weak: 'heart', resist: 'head', hit: 'whispers "you don’t belong here"' },
  { n: 'Networking Nerves', e: '😰', hp: 60, weak: 'hands', resist: 'head', hit: 'freezes your handshake' },
];
const DAILY_BATTLE_XP = 75, WIN_XP = 15;

/* ---------- state ---------- */
const me = { x: 0, y: 0, px: 0, py: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 0, dir: 'd', frame: 0, stepN: 0, moving: false, turnUntil: 0, energy: 100, bike: false };
const maxE = () => can('stamina') ? 130 : 100;
let LANDMARKS = [];
const others = new Map();
let ws = null, myId = null, room = '', retry = 2000, target = null, battle = null, busy = false;
const keys = new Set(); let running = false;
const myLook = () => { const L = World.lookFor(World.seedOf(S.name), S.color); if (can('style') && S.style != null) { L.style = S.style; L.hat = S.hat || L.hat; } return L; };

/* ---------- view ---------- */
function resize() {
  const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  vw = r.width; vh = r.height; cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
}
window.addEventListener('resize', resize);
const baseZ = () => Math.max(1, Math.round((vw || 960) / (16 * 20)));      // about 20 tiles across, like a DS screen
const zoom = () => Math.max(1, Math.min(6, baseZ() + zo));
function setZoom(d) { zo = Math.max(1 - baseZ(), Math.min(6 - baseZ(), zo + d)); try { localStorage.setItem('aq-zoom2', zo); } catch (e) {} $('#zoomTxt').textContent = zoom() + '×'; }
$('#zoomIn').addEventListener('click', () => setZoom(1));
$('#zoomOut').addEventListener('click', () => setZoom(-1));
stage.addEventListener('wheel', e => { e.preventDefault(); setZoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
const toggleMini = () => { if (!can('map')) return toast('🔒 Campus Map unlocks at Problem Solving & Data Level 1'); miniCv.hidden = !miniCv.hidden; };
$('#miniBtn').addEventListener('click', toggleMini);

/* ---------- actors ---------- */
function npcActors(t) {
  return NPCS.map(n => ({ x: n.x, y: n.y, dir: n.face || 'd', frame: 0, look: n.look, lookKey: 'npc' + n.id, name: n.n,
    marker: target === n ? 'target' : npcHasNew(n) ? '!' : null, tall: World.isTall(n.x, n.y) }));
}
const npcHasNew = n => n.q.some(id => !S.q[id]);
function actors(t) {
  const L = myLook();
  return [...npcActors(t),
    ...[...others.values()].map(p => ({ x: p.px, y: p.py, dir: p.dir || 'd', frame: p.moving ? (Math.floor(t / 130) % 2 ? 1 : 2) : 0, look: p.look, lookKey: 'p' + p.name + p.color, tall: World.isTall(Math.round(p.px), Math.round(p.py)) })),
    ...(can('explorer') ? LANDMARKS.filter(l => !(S.landmarks || {})[l.n]).map(l => ({ x: l.x, y: l.y, star: true })) : []),
    { x: me.px, y: me.py, dir: me.dir, frame: me.frame, look: L, lookKey: 'me' + S.name + S.color + (L.style ?? '') + (L.hat || ''), tall: World.isTall(me.x, me.y), bike: me.bike, swim: World.isWater(me.x, me.y) }];
}

/* ---------- loop ---------- */
const DIRV = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const KEYMAP = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r' };
const active = () => !$('#campus').hidden && !busy && !battle && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
const speed = () => me.bike ? 11 : running && can('run') ? 7.5 : 4;   // tiles per second
function step(dt) {
  if (me.moving) {
    me.t += dt / 1000 * speed();
    if (me.t < 1) { me.px = me.fx + (me.tx - me.fx) * me.t; me.py = me.fy + (me.ty - me.fy) * me.t; me.frame = me.t < .5 ? (me.stepN & 1 ? 1 : 2) : 0; return; }
    arrive();
  }
  me.frame = 0;
  if (!active()) return;
  const k = [...keys].pop(); if (!k) return;
  if (me.dir !== k) { me.dir = k; me.turnUntil = performance.now() + 90; return; }   // tap to turn on the spot, like Pokémon
  if (performance.now() < me.turnUntil) return;
  const nx = me.x + DIRV[k][0], ny = me.y + DIRV[k][1];
  if (!World.walkable(nx, ny, can('surf')) || NPCS.some(n => n.x === nx && n.y === ny)) return;
  if (me.bike && World.isWater(nx, ny)) me.bike = false;
  Object.assign(me, { moving: true, t: 0, fx: me.x, fy: me.y, tx: nx, ty: ny }); me.stepN++;
  send({ t: 'mv', x: nx, y: ny, d: me.dir });
}
function arrive() {
  Object.assign(me, { x: me.tx, y: me.ty, px: me.tx, py: me.ty, moving: false });
  S.pos3 = { x: me.x, y: me.y }; saveSoon();
  if (can('regen') && me.energy < maxE()) me.energy = Math.min(maxE(), me.energy + 2);
  for (const l of LANDMARKS) if (can('explorer') && !(S.landmarks || {})[l.n] && Math.abs(l.x - me.x) + Math.abs(l.y - me.y) <= 2) { commit(() => { S.landmarks = S.landmarks || {}; S.landmarks[l.n] = 1; S.xp += 10; }); toast(`⭐ Landmark discovered: ${l.n} (+10 XP)`); }
  if (target && Math.abs(target.x - me.x) + Math.abs(target.y - me.y) <= 2) target = null;
  if (!me.bike && World.isTall(me.x, me.y) && me.energy > 0 && Math.random() < .1) startBattle();
}
function loop(t) {
  const dt = Math.min(50, t - last); last = t;
  if (!$('#campus').hidden && World.ready) {
    if (vw === 0) resize();
    step(dt);
    for (const p of others.values()) {
      const dx = p.x - p.px, dy = p.y - p.py, d = Math.hypot(dx, dy); p.moving = d > .02;
      if (d > 6) { p.px = p.x; p.py = p.y; } else if (d > 0) { const k = Math.min(d, dt / 1000 * 9); p.px += dx / d * k; p.py += dy / d * k; }
    }
    camera = { x: me.px, y: me.py + .3 };                              // camera locked to the player, Pokémon style
    $('#zoomTxt').textContent = zoom() + '×';
    const view = { cx: camera.x, cy: camera.y, z: zoom(), dpr, vw, vh };
    const cam = World.draw(ctx, view, actors(t), t);
    World.work(me.moving ? 6 : 12);
    overlay(cam, t);
    if (!miniCv.hidden) drawMini();
    const loadEl = $('#loading'); if (!loadEl.hidden && World.pending() < 6) loadEl.hidden = true;
  }
  requestAnimationFrame(loop);
}

/* ---------- screen-space overlay: labels, name tags, bubbles, arrow ---------- */
let LABELS = null;
function overlay(cam, t) {
  const z = zoom(), TS = World.TS;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = x => (x * TS - cam.camX) * z, py = y => (y * TS - cam.camY) * z;   // tile edges
  const sx = x => px(x + .5), sy = y => py(y + 1);                                // actor centre / feet
  LABELS = LABELS || World.labels();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of LABELS) {
    if (!l.big && z < 3) continue;
    const x = px(l.x), y = py(l.y) - 8; if (x < -100 || x > vw + 100 || y < -20 || y > vh + 20) continue;
    ctx.font = `${l.park ? 'italic ' : ''}600 ${l.big ? 15 : 13}px "Pixelify Sans", monospace`;
    ctx.strokeStyle = 'rgba(16,14,34,.9)'; ctx.lineWidth = 4; ctx.strokeText(l.t, x, y); ctx.fillStyle = l.park ? '#e9ffd8' : '#fff7e0'; ctx.fillText(l.t, x, y);
  }
  ctx.font = '600 12px "Pixelify Sans", monospace';
  const tagY = my => sy(my) - 25 * z - 6;
  for (const p of others.values()) {
    const x = sx(p.px), y = tagY(p.py); if (x < -50 || x > vw + 50 || y < -40 || y > vh + 40) continue;
    pill(p.name || '…', x, y, 'rgba(20,16,40,.78)', '#fff');
    if (p.say && p.sayT > t) bubble(p.say, x, y - 16);
  }
  pill(S.name, sx(me.x), tagY(me.y), 'rgba(91,61,245,.92)', '#fff');
  if (me.say && me.sayT > t) bubble(me.say, sx(me.x), tagY(me.y) - 16);
  for (const n of NPCS) { const x = sx(n.x), y = tagY(n.y) - (npcHasNew(n) || target === n ? 12 * z : 0); if (x > -50 && x < vw + 50 && y > -30 && y < vh + 30) pill(n.n, x, y, 'rgba(255,253,245,.92)', '#1b1830'); }
  // interact hint
  const f = facingThing(); $('#hint').textContent = f ? `Space / A: ${f.p ? 'meet ' + f.p.name : 'talk to ' + f.n.n}` : '';
  // off-screen waypoint arrow
  if (target) {
    const X = sx(target.x), Y = sy(target.y);
    if (X < 0 || Y < 0 || X > vw || Y > vh) {
      const ang = Math.atan2(Y - vh / 2, X - vw / 2), r = Math.min(vw, vh) / 2 - 34, ax = vw / 2 + Math.cos(ang) * r, ay = vh / 2 + Math.sin(ang) * r;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.fillStyle = '#ff5a7a'; ctx.strokeStyle = '#1b1830'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-10, 12); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
      const dist = Math.round(Math.hypot(target.x - me.x, target.y - me.y) * 4);
      pill(`${target.n} · ${dist} m`, ax, ay + 24, 'rgba(255,90,122,.95)', '#fff');
    }
  }
}
function pill(text, x, y, bg, fg) {
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg; ctx.fillRect(Math.round(x - w / 2), Math.round(y - 8), Math.round(w), 16);
  ctx.fillStyle = fg; ctx.fillText(text, Math.round(x), Math.round(y) + 1);
}
function bubble(text, x, y) {
  ctx.font = '600 13px "Pixelify Sans", monospace';
  const s = text.length > 42 ? text.slice(0, 41) + '…' : text, w = ctx.measureText(s).width + 16;
  ctx.fillStyle = '#1b1830'; ctx.fillRect(Math.round(x - w / 2) - 2, Math.round(y - 12) - 2, Math.round(w) + 4, 24);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x - w / 2), Math.round(y - 12), Math.round(w), 20); ctx.fillRect(Math.round(x) - 3, Math.round(y + 8), 6, 4);
  ctx.fillStyle = '#1b1830'; ctx.fillText(s, Math.round(x), Math.round(y - 1)); ctx.font = '600 12px "Pixelify Sans", monospace';
}
function drawMini() {
  const g = miniCv.getContext('2d'), m = World.mini, MS = World.MS;
  if (miniCv.width !== m.width) { miniCv.width = m.width; miniCv.height = m.height; }
  g.drawImage(m, 0, 0);
  const dot = (x, y, c, r = 2) => { x = Math.round(x + .5); y = Math.round(y + .5); g.fillStyle = '#1b1830'; g.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2); g.fillStyle = c; g.fillRect(x - r, y - r, r * 2, r * 2); };
  for (const n of NPCS) dot(n.x, n.y, npcHasNew(n) ? '#ffd84a' : '#ffffff', 1.5);
  for (const p of others.values()) if (can('app') || (S.friends && S.friends[p.name])) dot(p.px, p.py, p.color || '#888', 2);
  if (can('explorer')) for (const l of LANDMARKS) if (!(S.landmarks || {})[l.n]) dot(l.x, l.y, '#ffe14d', 1.5);
  if (target) dot(target.x, target.y, '#ff5a7a', 3);
  dot(me.px, me.py, S.color || '#5b3df5', 3);
  const z = zoom(), w = vw / z / World.TS, h = vh / z / World.TS;
  g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.strokeRect((camera.x - w / 2) * MS, (camera.y - h / 2) * MS, w * MS, h * MS);
}
miniCv.addEventListener('click', e => { // tap the minimap to set a waypoint at the nearest quest-giver
  const r = miniCv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * World.size[0], y = (e.clientY - r.top) / r.height * World.size[1];
  if (can('fly')) { teleport(...World.nearestFree(x, y)); toast('🦅 You flew across campus'); return; }
  if (!can('waypoint')) return toast('🔒 Waypoints unlock at Problem Solving & Data Level 2');
  const n = NPCS.reduce((a, b) => Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b);
  target = n; toast(`📍 Waypoint: ${n.n} at ${n.at}`);
});

/* ---------- interaction ---------- */
function facingThing() {
  if (!World.ready || me.moving) return null;
  const fx = me.x + DIRV[me.dir][0], fy = me.y + DIRV[me.dir][1];
  const n = NPCS.find(n => n.x === fx && n.y === fy); if (n) return { n };
  const p = [...others.values()].find(p => Math.round(p.px) === fx && Math.round(p.py) === fy); return p ? { p } : null;
}
const teleport = (x, y) => Object.assign(me, { x, y, px: x, py: y, moving: false });
function interact() {
  if (!tbox.hidden) return closeBox();
  if (!active()) return;
  const f = facingThing(); if (!f) return;
  if (f.n) { f.n.face = { u: 'd', d: 'u', l: 'r', r: 'l' }[me.dir]; talk(f.n); }
  else meet(f.p);
}
function box(title, html, buttons = []) {
  busy = true; tbox.hidden = false; keys.clear();
  tbox.innerHTML = `<div class="tb-name">${title}</div><div class="tb-text">${html}</div><div class="tb-btns">${buttons.map((b, i) => `<button class="btn sm ${b.primary ? 'primary' : ''}" data-tb="${i}">${b.label}</button>`).join('')}<button class="btn sm" data-tb="x">Close</button></div>`;
  tbox._b = buttons; tbox.querySelector('.tb-btns button')?.focus();
}
function closeBox() { tbox.hidden = true; busy = false; NPCS.forEach(n => n.face = null); stage.focus(); }
tbox.addEventListener('click', e => {
  const b = e.target.closest('[data-tb]'); if (!b) return;
  const fn = b.dataset.tb === 'x' ? null : tbox._b[+b.dataset.tb].fn;
  closeBox(); fn && fn();
});
function talk(n) {
  S.met = S.met || {}; S.met[n.id] = 1; saveSoon();
  if (n.heal) { me.energy = maxE(); return box(n.n + ' · ' + n.at, n.say + `<br><span class="small muted">Energy ${me.energy}/${maxE()}</span>`); }
  if (!n.q.length) return box(n.n + ' · ' + n.at, n.say);
  const qs = n.q.map(id => QUESTS.find(x => x.id === id));
  box(n.n + ' · ' + n.at, n.say, qs.map(qq => ({ label: (!qq.rep && S.q[qq.id] ? '✓ ' : '') + qq.n + ' · +' + qq.xp + ' XP', primary: !S.q[qq.id],
    fn: () => { if (!qq.rep && S.q[qq.id]) return toast('Already completed'); openQuest(qq.id); } })));
}
function meet(p) {
  const fr = S.friends && S.friends[p.name];
  const info = can('readroom') ? `${RANKS[p.rank || 0]?.n || 'Rookie'} · ${p.xp || 0} XP${p.top ? ' · strongest: ' + esc(p.top) : ''}` : 'A fellow student. <span class="small muted">(Unlock Read the Room at Empathy Level 1 to see their rank and strongest capability.)</span>';
  box(p.name, `${info}${fr ? '<br>🤝 In your squad' : ''}`, [
    { label: '👋 Wave', fn: () => emote('👋') },
    ...(can('comfort') ? [{ label: can('coach') ? '💞 Coach' : '🤗 Comfort', fn: () => emote(can('coach') ? '💞' : '🤗') }] : []),
    ...(fr ? [] : can('squadup') ? [{ label: '🤝 Squad up', primary: true, fn: () => { send({ t: 'invite', to: p.id }); toast(`Squad invite sent to ${p.name}`); } }] : []),
  ]);
}
function addFriend(name, xp, rk) { S.friends = S.friends || {}; S.friends[name] = { xp: xp || 0, rank: rk || 0 }; commit(() => {}); }

/* ---------- battles ---------- */
function moves() {
  const ms = CAPS.filter(c => lvl(c.id) >= 1 && (!c.req || Object.entries(c.req).every(([k, v]) => lvl(k) >= v))).sort((a, b) => lvl(b.id) - lvl(a.id)).slice(0, 4)
    .map(c => ({ n: c.skills[Math.min(4, lvl(c.id)) - 1], cap: c, d: c.d, l: lvl(c.id), pow: 10 + 8 * lvl(c.id) + (rallied() ? 6 : 0) }));
  return ms.length ? ms : [{ n: 'Wing it', d: null, l: 0, pow: 14 }];
}
const pixelEmoji = e => { const c = document.createElement('canvas'); c.width = c.height = 28; const g = c.getContext('2d'); g.font = '22px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 14, 15); return c.toDataURL(); };
const rallied = () => can('rally') && [...others.values()].some(p => S.friends && S.friends[p.name] && Math.hypot(p.px - me.x, p.py - me.y) <= 5);
function startBattle() {
  const f = FOES[Math.random() * FOES.length | 0];
  keys.clear(); battle = { shield: can('shield'), f, hp: f.hp, msg: `A wild <b>${f.n}</b> appeared!`, lock: true, img: pixelEmoji(f.e) };
  stage.classList.add('flash'); setTimeout(() => { stage.classList.remove('flash'); if (battle) { battle.lock = false; renderBattle(); } }, 650);
}
function hpBar(v, max) { const p = v / max, c = p > .5 ? '#3ddc5b' : p > .2 ? '#f5c63b' : '#ef4b4b'; return `<div class="hp"><b>HP</b><div class="hpbar"><i style="width:${p * 100}%;background:${c}"></i></div></div>`; }
function renderBattle() {
  const el = $('#battle'); if (!battle) { el.hidden = true; return; }
  const { f } = battle; el.hidden = false;
  el.innerHTML = `<div class="bt-foe"><div class="bt-card"><b>${f.n}</b><span class="small">${can('inspect') ? `Weak to ${DOMAINS[f.weak].name} · resists ${DOMAINS[f.resist].name}` : 'Weakness: ??? <span class="muted">(🔍 Inspect: Critical Thinking L1)</span>'}</span>${hpBar(battle.hp, f.hp)}</div>
      <div class="bt-plat"><img class="bt-sprite" src="${battle.img}" alt="${f.n}"></div></div>
    <div class="bt-me"><div class="bt-plat me"><canvas class="bt-sprite me" id="btMe" width="16" height="24"></canvas></div>
      <div class="bt-card"><b>${esc(S.name)}</b><span class="small">Energy ${Math.round(me.energy)}/${maxE()}${rallied() ? ' · 🚩 Rallied' : ''}</span>${hpBar(me.energy, maxE())}</div></div>
    <div class="bt-panel"><div class="bt-msg">${battle.msg}</div><div class="bt-moves">${battle.done ? '<button class="btn primary" data-bm="end">Continue ▶</button>' :
      moves().map((m, i) => `<button class="btn" data-bm="${i}" style="border-left:5px solid ${m.d ? `var(${DOMAINS[m.d].c})` : 'var(--line)'}" ${battle.lock ? 'disabled' : ''}>${m.n}<span class="small muted"> · ${m.cap ? m.cap.n + ' L' + m.l : 'no skills yet'}</span></button>`).join('') + `<button class="btn" data-bm="run" ${battle.lock ? 'disabled' : ''}>RUN</button>`}</div></div>`;
  const g = $('#btMe').getContext('2d'); g.drawImage(World.charSprite(myLook(), 'u', 0), 0, 0);
}
$('#battle').addEventListener('click', e => {
  const b = e.target.closest('[data-bm],[data-notes]'); if (!b || !battle) return;
  const v = b.dataset.bm;
  if (b.dataset.notes) { const id = b.dataset.notes; battle = null; renderBattle(); openCap(id); const t = document.querySelector('#dlgBody textarea'); if (t && !t.value) t.value = `Situation: on campus I faced a "challenge" that felt like ${'a real ' + 'situation'}… Task: … Action: I used ${CAP[id].n} (${CAP[id].skills.join(', ')}) by … Result: … What I learned: …`; return; }
  if (v === 'end') { battle = null; renderBattle(); stage.focus(); return; }
  if (v === 'run') { battle.msg = 'Got away safely!'; battle.done = true; renderBattle(); return; }
  const m = moves()[+v], f = battle.f;
  const eff = m.d === f.weak ? 2 : m.d === f.resist && !(m.cap && m.cap.id === 'crea' && can('brainstorm')) ? .5 : 1;
  const dmg = Math.round(m.pow * eff * (.85 + Math.random() * .3));
  battle.hp = Math.max(0, battle.hp - dmg);
  battle.last = m; battle.msg = `${esc(S.name)} used <b>${m.n}</b>${m.cap ? ' (' + m.cap.n + ')' : ''}! ${eff > 1 ? "It's super effective! " : eff < 1 ? "It's not very effective… " : ''}(−${dmg})`;
  if (battle.hp <= 0) return win(m);
  battle.lock = true; renderBattle();
  setTimeout(() => {
    if (!battle) return;
    let hit = Math.round((8 + (Math.random() * 9 | 0)) * (can('foresight') ? .75 : 1));
    if (battle.shield) { battle.shield = false; hit = 0; }
    me.energy = Math.max(0, me.energy - hit);
    battle.msg = hit ? `${f.n} ${f.hit}! (−${hit} energy)` : `${f.n} ${f.hit}… but 🛡️ Integrity Shield blocked it!`; battle.lock = false;
    if (me.energy <= 0) {
      if (can('secondwind')) { me.energy = 40; battle.msg += '<br>🔁 Second Wind! You bounce back to 40 energy.'; }
      else { battle.msg += '<br>You\u2019re out of energy. Visit the <b>Wellbeing Coach</b> at Charles Perkins Centre to recharge.'; battle.done = true; target = NPCS.find(n => n.heal); }
    }
    renderBattle();
  }, 900);
});
function win(m) {
  const day = new Date().toISOString().slice(0, 10);
  if (!S.bx || S.bx.d !== day) S.bx = { d: day, xp: 0 };
  const gain = Math.max(0, Math.min(WIN_XP, (can('fair') ? 100 : DAILY_BATTLE_XP) - S.bx.xp));
  battle.msg = `${battle.f.n} was overcome! ${gain > 0 ? `+${gain} XP.` : 'Daily challenge XP cap reached (75).'}<br><span class="small">Tip: write it up as a <b>${m.n}</b> reflection to level the capability, because XP alone never levels a skill.</span>${m.cap && can('notes') ? `<br><button class="btn sm" data-notes="${m.cap.id}">📓 Write reflection</button>` : ''}`;
  battle.done = true;
  if (gain > 0) commit(() => { S.bx.xp += gain; S.xp += gain; });
  renderBattle();
}

/* ---------- multiplayer ---------- */
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function myInfo() { const top = CAPS.filter(c => lvl(c.id) > 0).sort((a, b) => lvl(b.id) - lvl(a.id))[0];
  return { name: S.name, color: S.color || '#5b3df5', xp: S.xp, rank: rank(), x: me.x, y: me.y, d: me.dir, top: top ? `${top.n} L${lvl(top.id)}` : '' }; }
function setNet() { const n = others.size + 1;
  net.innerHTML = ws && ws.readyState === 1 ? `<span class="dot on"></span>${n} on campus in <b>${esc(room)}</b>` : `<span class="dot"></span>Connecting to <b>${esc(room)}</b>…`; }
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
    else if (m.t === 'up') { const isNew = !others.has(m.p.id); up(m.p); if (isNew) toast(`👋 ${m.p.name} arrived on campus`); }
    else if (m.t === 'mv') { const p = others.get(m.id); if (p) { p.x = m.x; p.y = m.y; p.dir = m.d; } }
    else if (m.t === 'leave') others.delete(m.id);
    else if (m.t === 'chat' || m.t === 'emote') {
      const txt = m.t === 'chat' ? m.m : m.e, p = m.id === myId ? me : others.get(m.id);
      if (p) { p.say = txt; p.sayT = now + 6000; }
      if (m.t === 'chat') logChat(m.id === myId ? S.name : (others.get(m.id)?.name || '?'), m.m);
      if (m.t === 'chat' && m.m.startsWith('📣') && m.id !== myId) toast(`${others.get(m.id)?.name || '?'}: ${m.m}`);
      if (m.t === 'emote' && (m.e === '🤗' || m.e === '💞') && m.id !== myId && p && Math.hypot(p.px - me.x, p.py - me.y) <= 3) { const h = m.e === '💞' ? 50 : 25; me.energy = Math.min(maxE(), me.energy + h); toast(`${p.name} cheered you up: +${h} energy`); }
    }
    else if (m.t === 'invite') box('Squad invite', `<b>${esc(m.name)}</b> wants to squad up. Squad members see each other's progress and earn a bonus for doing quests together.`,
      [{ label: '🤝 Accept', primary: true, fn: () => { send({ t: 'accept', to: m.from }); addFriend(m.name, m.xp, m.rank); toast(`${m.name} joined your squad`); } }]);
    else if (m.t === 'accept') { addFriend(m.name, m.xp, m.rank); toast(`🤝 ${m.name} accepted. You're squadmates!`); }
    setNet();
  };
}
function up(p) {
  const o = others.get(p.id), x = p.x ?? 0, y = p.y ?? 0;
  others.set(p.id, Object.assign(o || { px: x, py: y }, p, { x, y, dir: p.d || o?.dir, look: World.lookFor(World.seedOf(p.name), p.color) }));
  if (S.friends && S.friends[p.name]) { S.friends[p.name] = { xp: p.xp || 0, rank: p.rank || 0 }; saveSoon(); }
}
function logChat(who, msg) { const l = $('#chatLog'), d = document.createElement('div'); d.innerHTML = `<b>${esc(who)}:</b> ${esc(msg)}`; l.append(d); while (l.children.length > 6) l.firstChild.remove(); }
function emote(e) { send({ t: 'emote', e }); if (!ws || ws.readyState !== 1) { me.say = e; me.sayT = performance.now() + 4000; } }
let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('aspire-quest-v1', JSON.stringify(S)); } catch (e) {} }, 800); };

function toggleBike() {
  if (!can('bike')) return toast('🔒 Bicycle unlocks at Innovative Thinking Level 2');
  if (World.isWater(me.x, me.y)) return; me.bike = !me.bike; toast(me.bike ? '🚲 Got on the bike' : 'Got off the bike');
}
function fastTravel() {
  if (!active() && tbox.hidden) return;
  if (!can('travel')) return toast('🔒 Fast Travel unlocks at Digital Acumen Level 2');
  const met = NPCS.filter(n => (S.met || {})[n.id]);
  if (!met.length) return box('Campus shuttle', 'Talk to quest-givers first. The shuttle only goes to people you have met.');
  box('🚌 Campus shuttle', 'Where to?', met.map(n => ({ label: `${n.n} · ${n.at}`, fn: () => { teleport(...World.nearestFree(n.x, n.y + 1)); toast(`🚌 Arrived at ${n.at}`); } })));
}
function renderAbil() {
  const el = $('#abilbar'); if (!el) return;
  el.innerHTML = ABIL.map(a => `<span class="ab ${can(a.id) ? 'on' : ''}" data-ab="${a.id}" title="${a.n}: ${a.d} ${can(a.id) ? '' : `(unlocks at ${CAP[a.cap].n} Level ${a.l})`}">${a.i}</span>`).join('');
}
document.addEventListener('click', e => { const a = e.target.closest('[data-ab]'); if (!a) return; const x = ABIL.find(z => z.id === a.dataset.ab);
  toast(`${x.i} ${x.n}: ${x.d}${can(x.id) ? '' : ` 🔒 ${CAP[x.cap].n} Level ${x.l}`}`); });

/* ---------- setup / controls ---------- */
const COLORS = ['#e04848', '#3d7fe0', '#2fb36b', '#f2a93b', '#8b5cf6', '#ec4899', '#14b8a6', '#334155'];
function setup() {
  const r0 = new URLSearchParams(location.search).get('room') || S.room || 'bcom-2027';
  $('#joinBox').hidden = false; busy = true;
  $('#joinBox').innerHTML = `<form id="joinForm"><h2>Join the campus</h2>
    <p class="small muted">Your name and avatar are visible to everyone in your cohort room. Your progress stays on your device. Only your XP and rank are shared.</p>
    <label>Display name<input id="jn" maxlength="24" required value="${esc(S.name === 'Your name' ? '' : S.name)}" placeholder="e.g. Joe H."></label>
    <label>Cohort room code<input id="jr" maxlength="40" pattern="[A-Za-z0-9_\\-]+" required value="${esc(r0)}"></label>
    ${can('style') ? `<label>Hairstyle (🎨 Style Studio)<select id="jst">${['Short', 'Long', 'Bun', 'Trainer cap'].map((t, i) => `<option value="${i}" ${(S.style ?? -1) === i ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : '<span class="small muted">🎨 Unlock Style Studio (Creativity L1) to change your hairstyle and cap.</span>'}
    <span class="small"><b>Shirt colour</b></span>
    <div class="swatches">${COLORS.map(c => `<button type="button" data-col="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${(S.color || COLORS[1]) === c}"></button>`).join('')}</div>
    <button class="btn primary" type="submit">${S.joined ? 'Save' : 'Enter campus'}</button></form>`;
  $('#jn').focus();
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-col]'); if (c) { S.color = c.dataset.col; document.querySelectorAll('[data-col]').forEach(b => b.setAttribute('aria-pressed', b === c)); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'joinForm') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const nr = $('#jr').value.trim().toLowerCase();
  S.name = $('#jn').value.trim() || 'Student'; S.color = S.color || COLORS[1]; S.joined = true;
  if ($('#jst')) S.style = +$('#jst').value;
  $('#joinBox').hidden = true; busy = false;
  commit(() => {});
  if (nr !== room) { room = S.room = nr; saveSoon(); if (ws) { ws.onclose = null; ws.close(); others.clear(); } connect(); }
  stage.focus();
}, true);

window.addEventListener('keydown', e => {
  if ($('#campus').hidden) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (document.querySelector('dialog[open]')) return;
  if (document.activeElement?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  if (KEYMAP[e.key]) { e.preventDefault(); keys.add(KEYMAP[e.key]); }
  else if (e.key === 'Shift') running = true;
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); interact(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); $('#chatIn').focus(); }
  else if (e.key === 'm' || e.key === 'M') toggleMini();
  else if (e.key === 'r' || e.key === 'R') toggleBike();
  else if (e.key === 'f' || e.key === 'F') fastTravel();
  else if (e.key === '+' || e.key === '=') setZoom(1);
  else if (e.key === '-' || e.key === '_') setZoom(-1);
  else if (e.key === 'Escape' && !tbox.hidden) closeBox();
});
window.addEventListener('keyup', e => { if (KEYMAP[e.key]) keys.delete(KEYMAP[e.key]); if (e.key === 'Shift') running = false; });
window.addEventListener('blur', () => { keys.clear(); running = false; });
document.querySelectorAll('[data-pad]').forEach(b => {
  const k = b.dataset.pad;
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (k === 'a') return interact(); if (k === 'b') { if (!can('run')) toast('🔒 Running Shoes unlock at Initiative & Drive Level 1'); running = true; return; } keys.add(k); b.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => { if (k === 'b') running = false; else keys.delete(k); }));
});
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault(); e.stopImmediatePropagation();
  const v = $('#chatIn').value.trim(); if (!v) return;
  let msg = v; if (v.startsWith('!')) msg = can('megaphone') ? '📣 ' + v.slice(1).trim() : (toast('🔒 Megaphone unlocks at Communication Level 1'), v.slice(1).trim());
  if (ws && ws.readyState === 1) send({ t: 'chat', m: msg }); else { me.say = v; me.sayT = performance.now() + 6000; logChat(S.name, v); }
  $('#chatIn').value = ''; $('#chatIn').blur(); stage.focus();
}, true);
document.querySelectorAll('[data-emote]').forEach(b => b.addEventListener('click', () => emote(b.dataset.emote)));
$('#profileBtn').addEventListener('click', setup);

/* ---------- boot ---------- */
World.load('map.json').then(() => {
  const A = World.anchors;
  const occ = new Set(), place = (x, y) => { x = Math.round(x); y = Math.round(y);
    for (let r = 0; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const X = x + dx, Y = y + dy; if (World.walkable(X, Y) && !occ.has(X + ',' + Y)) { occ.add(X + ',' + Y); return [X, Y]; } } return [x, y]; };
  for (const n of NPCS) { const a = (n.b && World.door(n.b)) || A[n.a] || A.quad; [n.x, n.y] = place(a[0] + n.dx, a[1] + n.dy); n.look = World.lookFor(World.seedOf(n.id) + 3); }
  const p = S.pos3 && World.walkable(S.pos3.x, S.pos3.y) ? [S.pos3.x, S.pos3.y] : World.nearestFree(A.quad[0], A.quad[1] + 2);
  teleport(...p);
  LANDMARKS = ['Great Hall', 'Fisher Library', 'Chau Chak Wing Museum', 'Anderson-Stuart Building', 'Charles Perkins Centre', 'Lake Northam', 'Victoria Park', 'The Front Lawn', 'Madsen Building']
    .map(n => { const p = World.find(n); return p && { n, x: p[0], y: p[1] }; }).filter(Boolean)

  if (!can('map')) miniCv.hidden = true;
  renderAbil(); setZoom(0); renderQuestsIfShown();
}).catch(err => { $('#loading').textContent = 'Could not load the campus map: ' + err.message; });
function renderQuestsIfShown() { try { renderQuests(); } catch (e) {} }
if (S.joined) { room = S.room || new URLSearchParams(location.search).get('room') || 'bcom-2027'; connect(); }
requestAnimationFrame(loop);

return {
  pos: () => [me.x, me.y, me.bike],
  sync() { send({ t: 'me', ...myInfo() }); renderAbil(); if (!can('map')) miniCv.hidden = true; },
  shown() { resize(); if (!S.joined) setup(); stage.focus(); },
  nearby() { const r = can('teamspirit') ? 8 : 3; return [...others.values()].filter(p => Math.hypot(p.px - me.x, p.py - me.y) <= r).map(p => p.name); },
  online(name) { return [...others.values()].some(p => p.name === name); },
  goto(qid) { const n = NPCS.find(n => n.q.includes(qid)); if (!n) return; target = n; selectTab('campus'); toast(`📍 Head to the ${n.n} at ${n.at}`); },
  where(qid) { const n = NPCS.find(n => n.q.includes(qid)); return n ? n.at : ''; },
};
})();
