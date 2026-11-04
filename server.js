'use strict';
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./catalog');
const Casino = require('./casino');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SPEED = Math.max(1, Number(process.env.GROWTH_SPEED) || 1);
const T = C.WORLD.tile;
const WORLD_W = C.WORLD.width * T, WORLD_H = C.WORLD.height * T;

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------------- persistence ----------------
let db = { secret: crypto.randomBytes(32).toString('hex'), users: {}, lands: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }
function ensureLands() {
  // Only append missing lands — never relocate or wipe tiles on existing plots
  for (let i = 0; i < C.WORLD.landCount; i++) {
    if (!db.lands[i]) db.lands[i] = { owner: null, tiles: {}, extra: {}, stats: { harvested: 0, growTime: 0, value: 0 } };
    else {
      if (!db.lands[i].tiles) db.lands[i].tiles = {};
      if (!db.lands[i].extra) db.lands[i].extra = {};
      if (!db.lands[i].stats) db.lands[i].stats = { harvested: 0, growTime: 0, value: 0 };
    }
  }
}
ensureLands();
function ensureNpcHouse() {
  const idx = C.WORLD.lands.findIndex(l => l.npc);
  if (idx < 0) return;
  const L = db.lands[idx];
  if (!L) return;
  L.owner = '__npc__';
  const ver = C.NPC_HOME_VER || 1;
  if (L.npcVer === ver && L.npcReady) return;
  L.tiles = {};
  for (const [k, id] of (C.NPC_HOME_FURN || [])) {
    if (C.FURN_BY[id]) L.tiles[k] = { type: 'furn', id };
  }
  L.npcReady = true;
  L.npcVer = ver;
  L.stats = { harvested: 0, growTime: 0, value: 0 };
  dirty = true;
}
function landFootprint(i) {
  const meta = C.WORLD.lands[i]; if (!meta) return new Set();
  const set = new Set();
  for (let ty = 0; ty < C.WORLD.landSize; ty++) for (let tx = 0; tx < C.WORLD.landSize; tx++) set.add((meta.x + tx) + ',' + (meta.y + ty));
  const L = db.lands[i];
  for (const k of Object.keys(L.extra || {})) {
    const [rx, ry] = k.split(',').map(Number);
    set.add((meta.x + rx) + ',' + (meta.y + ry));
  }
  return set;
}
const SEA_TILES = new Set((C.WORLD.sea && C.WORLD.sea.tiles) || []);
function worldBlocked(wx, wy) {
  if (wx < 0 || wy < 0 || wx >= C.WORLD.width || wy >= C.WORLD.height) return true;
  if (SEA_TILES.has(wx + ',' + wy)) return true;
  const S = C.WORLD.shop;
  if (wx >= S.x && wx < S.x + S.w && wy >= S.y && wy < S.y + S.h) return true;
  if (C.WORLD.park && wx >= C.WORLD.park.x && wx < C.WORLD.park.x + C.WORLD.park.w && wy >= C.WORLD.park.y && wy < C.WORLD.park.y + C.WORLD.park.h) return true;
  if (C.WORLD.petShop && wx >= C.WORLD.petShop.x && wx < C.WORLD.petShop.x + C.WORLD.petShop.w && wy >= C.WORLD.petShop.y && wy < C.WORLD.petShop.y + C.WORLD.petShop.h) return true;
  for (const p of Object.values(C.WORLD.pens || {})) if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) return true;
  for (let i = 0; i < db.lands.length; i++) if (landFootprint(i).has(wx + ',' + wy)) return true;
  return false;
}
function relOwned(L, tx, ty) {
  if (tx >= 0 && ty >= 0 && tx < C.WORLD.landSize && ty < C.WORLD.landSize) return true;
  return !!(L.extra && L.extra[tx + ',' + ty]);
}
function ensureUser(u) {
  Casino.ensureUser(u);
  if (!u.animals) u.animals = { chicken: 0, cow: 0, sheep: 0 };
  if (!u.products) u.products = {};
  if (!u.pets) u.pets = [];
  if (!u.bushAt) u.bushAt = {};
  if (!u.stallAt) u.stallAt = {};
  if (!u.animalAt) u.animalAt = { egg: 0, milkCow: 0, milkSheep: 0 };
  if (u.expandLand === undefined) u.expandLand = null;
  if (u.houseLand === undefined) u.houseLand = null;
  if (!u.animalNames) u.animalNames = {}; // 'chicken:0' -> 'Clucky'
  if (!u.animalReady) u.animalReady = {}; // 'cow:0' / 'sheep:2' -> last milked / sheared (ms)
  if (!Array.isArray(u.mail)) u.mail = [];   // [{id, ts, from, subject, body, money, read, claimed}]
  if (!u.animalSex) u.animalSex = {};     // same keys -> 'm' | 'f' (random, fixed at purchase)
  if (!u.animalBorn) u.animalBorn = {};   // 'chicken:0' / 'pet:pet_dog' -> purchase time = "born" date (ms)
  { // animals/pets owned before birth dates existed get today's date the first time we see them
    const t0 = Date.now();
    for (const [kind, n] of Object.entries(u.animals)) for (let i = 0; i < n; i++) { if (!u.animalBorn[kind + ':' + i]) u.animalBorn[kind + ':' + i] = t0; if (!u.animalSex[kind + ':' + i]) u.animalSex[kind + ':' + i] = rndSex(); }
    for (const pid of u.pets) { if (!u.animalBorn['pet:' + pid]) u.animalBorn['pet:' + pid] = t0; if (!u.animalSex['pet:' + pid]) u.animalSex['pet:' + pid] = rndSex(); }
  }
  if (!u.animalStay) u.animalStay = 'farm'; // farm | house
  if (!u.petStay) u.petStay = 'follow'; // follow | farm | house
  if (!u.seeds) u.seeds = {};
  if (!u.crops) u.crops = {};
  if (!u.furniture) u.furniture = {};
  if (!u.clothes) u.clothes = [];
  if (!u.tapAt) u.tapAt = 0;
}
const roundMoney = v => Math.round(Number(v) * 100) / 100;
for (const u of Object.values(db.users)) ensureUser(u);
let dirty = true;
const touch = () => { dirty = true; };
Casino.ensureDb(db);
ensureNpcHouse();

// Optional Upstash Redis storage (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
// When set, the whole game state is stored under one key, so no persistent disk is needed.
const UP_URL = process.env.UPSTASH_REDIS_REST_URL, UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UP_KEY = process.env.UPSTASH_DB_KEY || 'sunny-lots-db';
const useUpstash = !!(UP_URL && UP_TOKEN);
async function upstash(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('Upstash: ' + (j.error || r.status));
  return j.result;
}
async function loadFromUpstash() {
  const raw = await upstash(['GET', UP_KEY]);
  if (raw) db = Object.assign(db, JSON.parse(raw));
  ensureLands();
  for (const u of Object.values(db.users)) ensureUser(u);
  ensureNpcHouse();
}
let saving = false;
async function save() {
  if (!dirty || saving) return;
  dirty = false; saving = true;
  try {
    const json = JSON.stringify(db);
    if (useUpstash) await upstash(['SET', UP_KEY, json]);
    else { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, json); fs.renameSync(tmp, DB_FILE); }
  } catch (e) { dirty = true; console.error('save failed:', e.message); }
  saving = false;
}
setInterval(save, 3000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { saving = false; await save(); process.exit(0); });

// ---------------- auth ----------------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
function genPw() {
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) { s += ALPHA[b[i] % ALPHA.length]; if (i === 4) s += '-'; }
  return s;
}
function makeToken(key) {
  const body = Buffer.from(key + '|' + (Date.now() + 30 * 864e5)).toString('base64url');
  const sig = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(tok) {
  if (typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const [key, exp] = Buffer.from(body, 'base64url').toString().split('|');
  if (Date.now() > Number(exp)) return null;
  return db.users[key] ? key : null;
}
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60000);
  h.push(now); hits.set(ip, h);
  return h.length > 20;
}

// ---------------- http ----------------
const app = express();
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/catalog', (req, res) => {
  res.json({
    SEEDS: C.SEEDS, FURNITURE: C.FURNITURE.filter(f => f.buyable !== false), CLOTHES: C.CLOTHES.filter(c => c.buyable !== false),
    ALL_FURNITURE: C.FURNITURE, ALL_CLOTHES: C.CLOTHES,
    SKINS: C.SKINS, HAIRS: C.HAIRS, DEFAULT_AVATAR: C.DEFAULT_AVATAR, WORLD: C.WORLD, SHAPE_IDS: C.SHAPE_IDS,
    GOLD_MULT: C.GOLD_MULT, EXPAND_COST: C.EXPAND_COST, HOUSE_COST: C.HOUSE_COST,
    SQUARE_COST: C.SQUARE_COST, SQUARE_GROW: C.SQUARE_GROW, SQUARE_MAX: C.SQUARE_MAX,
    TAP_MIN: C.TAP_MIN, TAP_MAX: C.TAP_MAX,
    ANIMALS: C.ANIMALS, PETS: C.PETS, PRODUCTS: C.PRODUCTS,
    MINIGAMES: C.MINIGAMES, BUSH_DROP: C.BUSH_DROP, BUSH_CD: C.BUSH_CD,
  });
});

// ---------------- admin ----------------
// Set ADMIN_PASSWORD in the host's environment. If it is missing a random one is generated and printed in the server log at every start.
const ADMIN_PW = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
if (!process.env.ADMIN_PASSWORD) console.log('[admin] ADMIN_PASSWORD not set — temporary admin password for this run: ' + ADMIN_PW);
const adminSig = body => crypto.createHmac('sha256', db.secret + '|admin').update(body).digest('base64url');
const makeAdminToken = () => { const b = Buffer.from('admin|' + (Date.now() + 12 * 36e5)).toString('base64url'); return b + '.' + adminSig(b); };
function isAdmin(req) {
  const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const [b, sig] = tok.split('.');
  if (!b || !sig) return false;
  const good = adminSig(b);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  const [who, exp] = Buffer.from(b, 'base64url').toString().split('|');
  return who === 'admin' && Number(exp) > Date.now();
}
const adminOnly = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'Admin login required.' });
const r2 = n => Math.round(n * 100) / 100;
/** Estimated net worth = cash + everything owned valued at its shop/sell price. */
function netWorth(u) {
  ensureUser(u);
  const b = { cash: r2(u.money || 0), crops: 0, products: 0, seeds: 0, furniture: 0, clothes: 0, animals: 0, land: 0 };
  for (const [k, n] of Object.entries(u.crops || {})) { const sd = C.SEED_BY[k.replace('_gold', '')]; if (sd) b.crops += n * sd.sell * (k.endsWith('_gold') ? C.GOLD_MULT : 1); }
  for (const [k, n] of Object.entries(u.products || {})) if (C.PRODUCTS[k]) b.products += n * C.PRODUCTS[k].sell;
  for (const [k, n] of Object.entries(u.seeds || {})) if (C.SEED_BY[k]) b.seeds += n * (C.SEED_BY[k].cost || 0);
  for (const [k, n] of Object.entries(u.furniture || {})) if (C.FURN_BY[k]) b.furniture += n * (C.FURN_BY[k].price || 0);
  for (const id of u.clothes || []) if (C.CLOTH_BY[id]) b.clothes += C.CLOTH_BY[id].price || 0;
  for (const [k, n] of Object.entries(u.animals || {})) if (C.ANIMALS[k]) b.animals += n * C.ANIMALS[k].buy;
  for (const pid of u.pets || []) if (C.PET_BY[pid]) b.animals += C.PET_BY[pid].price;
  for (const li of [u.land, u.expandLand, u.houseLand]) {
    if (li == null || !db.lands[li]) continue;
    const L = db.lands[li];
    for (const t of Object.values(L.tiles || {})) if (t.type === 'furn' && C.FURN_BY[t.id]) b.furniture += C.FURN_BY[t.id].price || 0;
    for (let i = 0, n = Object.keys(L.extra || {}).length; i < n; i++) b.land += C.squarePrice(i);
  }
  if (u.expandLand != null) b.land += C.EXPAND_COST;
  if (u.houseLand != null) b.land += C.HOUSE_COST;
  for (const k of Object.keys(b)) b[k] = r2(b[k]);
  b.total = r2(Object.values(b).reduce((a, v) => a + v, 0));
  return b;
}
function giveMail(u, { subject, body, money, from }) {
  ensureUser(u);
  u.mail.unshift({ id: crypto.randomBytes(6).toString('hex'), ts: Date.now(), from: from || 'Sunny Lots', subject, body, money: money || 0, read: false, claimed: false });
  while (u.mail.length > 100) {   // keep the box small: drop the oldest finished letter first
    let i = -1; for (let k = u.mail.length - 1; k >= 0; k--) { const m = u.mail[k]; if (m.read && (m.claimed || !m.money)) { i = k; break; } }
    u.mail.splice(i >= 0 ? i : u.mail.length - 1, 1);
  }
}
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.post('/api/admin/login', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts, wait a minute.' });
  const pw = String((req.body || {}).password || '');
  const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(ADMIN_PW).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong admin password.' });
  res.json({ token: makeAdminToken() });
});
app.get('/api/admin/users', adminOnly, (req, res) => {
  const rows = Object.entries(db.users).map(([key, u]) => {
    const w = netWorth(u);
    return { name: u.name, cash: w.cash, networth: w.total, breakdown: w, land: u.land, created: u.created || 0, online: online.has(key), unread: (u.mail || []).filter(m => !m.read).length, casinoNet: ['roulette', 'blackjack'].reduce((s, g) => s + (u.casino && u.casino[g] ? u.casino[g].paid - u.casino[g].wagered : 0), 0) };
  });
  rows.sort((a, b) => b.networth - a.networth);
  res.json({ users: rows, totals: { users: rows.length, online: rows.filter(r => r.online).length, cash: r2(rows.reduce((s, r) => s + r.cash, 0)), networth: r2(rows.reduce((s, r) => s + r.networth, 0)) }, sent: (db.adminMailLog || []).slice(0, 30) });
});
app.post('/api/admin/mail', adminOnly, (req, res) => {
  const b = req.body || {};
  const subject = String(b.subject || '').trim().slice(0, 80), body = String(b.body || '').trim().slice(0, 1000);
  const money = Number(b.money || 0);
  if (!subject) return res.status(400).json({ error: 'Subject is required.' });
  if (!Number.isFinite(money) || money < 0 || money > 1e9) return res.status(400).json({ error: 'Money must be between 0 and 1,000,000,000.' });
  let targets;
  if (b.to === 'all') targets = Object.keys(db.users);
  else {
    const names = (Array.isArray(b.to) ? b.to : [b.to]).map(n => String(n || '').trim().toLowerCase()).filter(Boolean);
    targets = names.filter(k => db.users[k]);
    if (!targets.length) return res.status(400).json({ error: 'No matching player.' });
  }
  const amt = r2(money);
  for (const k of targets) {
    giveMail(db.users[k], { subject, body, money: amt });
    const c = online.get(k); if (c) { sendMe(c); send(c.ws, { t: 'mail_new', subject }); }
  }
  if (!db.adminMailLog) db.adminMailLog = [];
  db.adminMailLog.unshift({ ts: Date.now(), to: b.to === 'all' ? 'Everyone' : targets.map(k => db.users[k].name).join(', ').slice(0, 120), count: targets.length, subject, money: amt });
  db.adminMailLog.length = Math.min(db.adminMailLog.length, 50);
  touch();
  res.json({ ok: true, sent: targets.length });
});
app.get('/healthz', (req, res) => res.send('ok'));

app.post('/api/register', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts, wait a minute.' });
  const name = String((req.body || {}).username || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or _' });
  const key = name.toLowerCase();
  if (db.users[key]) return res.status(409).json({ error: 'That username is taken.' });
  const password = genPw();
  const salt = crypto.randomBytes(16).toString('hex');
  const nu = {
    name, salt, hash: hashPw(password, salt), created: Date.now(),
    money: C.START_MONEY, seeds: {}, crops: {}, furniture: {}, clothes: [],
    avatar: { ...C.DEFAULT_AVATAR }, land: null, charDone: false,
  };
  ensureUser(nu);
  db.users[key] = nu;
  touch();
  res.json({ username: name, password, token: makeToken(key) });
});
app.post('/api/login', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts, wait a minute.' });
  const key = String((req.body || {}).username || '').trim().toLowerCase();
  const pw = String((req.body || {}).password || '').trim().toLowerCase();
  const u = db.users[key];
  if (!u || hashPw(pw, u.salt) !== u.hash) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ username: u.name, token: makeToken(key) });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// ---------------- game state ----------------
const online = new Map(); // key -> {ws,u,x,y}
const chatLog = [];
let playersDirty = true;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = o => { const s = JSON.stringify(o); for (const c of online.values()) if (c.ws.readyState === 1) c.ws.send(s); };
const meView = u => ({
  name: u.name, money: u.money, seeds: u.seeds, crops: u.crops, furniture: u.furniture,
  clothes: u.clothes, avatar: u.avatar, land: u.land, expandLand: u.expandLand, houseLand: u.houseLand, charDone: u.charDone,
  animals: u.animals, products: u.products, pets: u.pets,
  animalStay: u.animalStay, petStay: u.petStay, animalNames: u.animalNames, animalReady: u.animalReady, animalBorn: u.animalBorn, animalSex: u.animalSex,
  stallAt: u.stallAt, animalAt: u.animalAt, bushAt: u.bushAt, mail: u.mail,
});
const ownsLand = (u, i) => u.land === i || u.expandLand === i || u.houseLand === i;
const sendMe = c => send(c.ws, { t: 'me', me: meView(c.u) });
const sendCasino = (c, game) => send(c.ws, Object.assign({ t: 'casino_info', bj: game === 'blackjack' ? Casino.bjView(c.u) : undefined }, Casino.info(db, game, c.u.name)));
const playerList = () => [...online.values()].map(c => ({
  n: c.u.name, x: Math.round(c.x), y: Math.round(c.y), a: c.u.avatar,
  animals: c.u.animals, pets: c.u.pets, animalStay: c.u.animalStay, petStay: c.u.petStay, animalNames: c.u.animalNames, animalReady: c.u.animalReady, animalBorn: c.u.animalBorn, animalSex: c.u.animalSex,
  e: c.emote || null, es: c.emoteAt || 0,
  land: c.u.land, houseLand: c.u.houseLand, expandLand: c.u.expandLand,
}));
const landView = l => ({
  owner: l.owner === '__npc__' ? 'Sunny Homes' : (l.owner && db.users[l.owner] ? db.users[l.owner].name : null),
  tiles: l.tiles,
  extra: l.extra || {},
  stats: l.stats || { harvested: 0, growTime: 0, value: 0 },
  npc: l.owner === '__npc__',
});
const growMs = seed => seed.hours * 3600000 / SPEED;
const ownsCloth = (u, id) => {
  if (!id) return true;
  const cl = C.CLOTH_BY[id];
  if (!cl) return false;
  if (cl.buyable === false) return u.clothes.includes(id);
  return cl.price === 0 || u.clothes.includes(id);
};

const rndSex = () => (require('crypto').randomInt(2) ? 'm' : 'f');
function spawnFor(u) {
  if (u.land != null) {
    const o = C.WORLD.lands[u.land];
    return { x: (o.x + 4) * T, y: (o.y + 8.6) * T };
  }
  return { x: C.WORLD.shopDoor.x * T, y: C.WORLD.shopDoor.y * T };
}

wss.on('connection', ws => {
  let c = null;
  const err = msg => send(ws, { t: 'err', msg });
  const ok = msg => send(ws, { t: 'ok', msg });
  let lastChat = 0;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (!c) {
      if (m.t !== 'auth') return;
      const key = readToken(m.token);
      if (!key) return send(ws, { t: 'authfail' });
      const prev = online.get(key);
      if (prev) { send(prev.ws, { t: 'err', msg: 'Logged in from another place.' }); prev.ws.close(); }
      const u = db.users[key];
      const p = spawnFor(u);
      c = { ws, u, key, x: p.x, y: p.y };
      online.set(key, c);
      send(ws, {
        t: 'init', me: meView(u), pos: p, now: Date.now(), speed: SPEED,
        lands: db.lands.map(landView), players: playerList(), chat: chatLog.slice(-30),
      });
      broadcast({ t: 'sys', text: u.name + ' joined the neighborhood.' });
      playersDirty = true;
      return;
    }
    const u = c.u;
    ensureUser(u);
    const landIdx = Number.isInteger(m.land) ? m.land : u.land;
    const actLand = (landIdx != null && ownsLand(u, landIdx)) ? db.lands[landIdx] : null;
    const tileOK = actLand && Number.isInteger(m.tx) && Number.isInteger(m.ty) && relOwned(actLand, m.tx, m.ty);
    const setTile = (li, key, tile) => {
      const L = db.lands[li]; if (!L) return;
      if (tile) L.tiles[key] = tile; else delete L.tiles[key];
      touch();
      broadcast({ t: 'tile', land: li, key, tile: tile || null });
    };
    const addProduct = (id, n) => { u.products[id] = (u.products[id] || 0) + n; };
    const randPay = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

    switch (m.t) {
      case 'move': {
        if (typeof m.x !== 'number' || typeof m.y !== 'number') return;
        const nx = Math.max(8, Math.min(WORLD_W - 8, m.x)), ny = Math.max(8, Math.min(WORLD_H - 8, m.y));
        if (c.emote && Math.abs(nx - c.x) + Math.abs(ny - c.y) > 3) { c.emote = null; c.emoteAt = Date.now(); } // walking ends sit/dance/etc.
        c.x = nx; c.y = ny;
        playersDirty = true;
        break;
      }
      case 'chat': {
        const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!text || Date.now() - lastChat < 700) return;
        lastChat = Date.now();
        const msg = { t: 'chat', n: u.name, text, ts: Date.now() };
        chatLog.push(msg); if (chatLog.length > 60) chatLog.shift();
        broadcast(msg);
        break;
      }
      case 'casino_open': {
        if (!Casino.info || !['roulette', 'blackjack'].includes(m.game)) return;
        sendCasino(c, m.game);
        break;
      }
      case 'roulette_spin': {
        if (Date.now() - (c.lastBet || 0) < 600) return;
        c.lastBet = Date.now();
        const r = Casino.rouletteSpin(db, u, m.bets);
        if (r.error) return err(r.error);
        touch();
        send(ws, { t: 'roulette_result', r });
        setTimeout(() => { sendMe(c); sendCasino(c, 'roulette'); }, 1500);   // let the wheel animation finish before money/stats update
        break;
      }
      case 'bj_deal': case 'bj_hit': case 'bj_stand': case 'bj_double': {
        if (Date.now() - (c.lastBet || 0) < 250) return;
        c.lastBet = Date.now();
        const r = m.t === 'bj_deal' ? Casino.bjDeal(db, u, m.bet) : m.t === 'bj_hit' ? Casino.bjHit(db, u) : m.t === 'bj_stand' ? Casino.bjStand(db, u) : Casino.bjDouble(db, u);
        if (r.error) return err(r.error);
        touch(); sendMe(c); sendCasino(c, 'blackjack');
        break;
      }
      case 'emote': {
        const EMOTES = ['sit', 'dance', 'wave', 'jump', 'spin', 'laugh', 'heart'];
        if (Date.now() - (c.lastEmote || 0) < 250) return;
        c.lastEmote = Date.now();
        c.emote = EMOTES.includes(m.e) ? m.e : null; c.emoteAt = Date.now();
        playersDirty = true;
        break;
      }
      case 'name_animal': {
        const kind = m.kind;
        let key, label;
        if (kind === 'pet') {   // pets are unique per species: key by pet id
          const pet = C.PET_BY[m.id];
          if (!pet || !u.pets.includes(pet.id)) return;
          key = 'pet:' + pet.id; label = pet.name.toLowerCase();
        } else {
          const a = C.ANIMALS[kind];
          const cap = kind === 'cow' ? 4 : kind === 'sheep' ? 6 : 8;   // same cap the client draws
          if (!a || !Number.isInteger(m.idx) || m.idx < 0 || m.idx >= Math.min(u.animals[kind] || 0, cap)) return;
          key = kind + ':' + m.idx; label = a.name.toLowerCase();
        }
        const name = String(m.name || '').replace(/[^\p{L}\p{N} '_.!-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
        if (name) u.animalNames[key] = name; else delete u.animalNames[key];
        touch(); sendMe(c); playersDirty = true;
        ok(name ? 'Named your ' + label + ' ' + name + '!' : 'Name cleared.');
        break;
      }
      case 'set_stay': {
        if (m.kind === 'animal' && (m.where === 'farm' || m.where === 'house')) {
          if (m.where === 'house' && u.houseLand == null) return err('Buy a house lot first.');
          u.animalStay = m.where; touch(); sendMe(c); playersDirty = true;
          ok('Livestock will roam your ' + m.where + '.');
        } else if (m.kind === 'pet' && (m.where === 'follow' || m.where === 'farm' || m.where === 'house')) {
          if (m.where === 'house' && u.houseLand == null) return err('Buy a house lot first.');
          if (m.where === 'farm' && u.land == null) return err('Claim a farm first.');
          u.petStay = m.where; touch(); sendMe(c); playersDirty = true;
          ok(m.where === 'follow' ? 'Pets will follow you.' : 'Pets will stay on your ' + m.where + '.');
        }
        break;
      }
      case 'claim': {
        const i = m.land;
        if (!Number.isInteger(i) || i < 0 || i >= db.lands.length) return;
        if (db.lands[i].owner) return err('That land is already claimed.');
        const meta = C.WORLD.lands[i] || {};
        if (meta.npc) return err('That is the model home — look, don\'t claim!');
        if (meta.expand) {
          if (u.land == null) return err('Claim a starter land first (the original 8 plots).');
          if (u.expandLand != null) return err('You already own an expansion plot.');
          if (u.money < C.EXPAND_COST) return err('Need $' + C.EXPAND_COST + ' to expand.');
          u.money = roundMoney(u.money - C.EXPAND_COST);
          db.lands[i].owner = c.key; u.expandLand = i; touch();
          broadcast({ t: 'owner', land: i, owner: u.name });
          sendMe(c);
          ok('Expansion plot ' + (i + 1) + ' unlocked!');
        } else if (meta.house) {
          if (u.land == null) return err('Claim a farm land first.');
          if (u.houseLand != null) return err('You already own a house lot.');
          if (u.money < C.HOUSE_COST) return err('Need $' + C.HOUSE_COST + ' for a house lot.');
          u.money = roundMoney(u.money - C.HOUSE_COST);
          db.lands[i].owner = c.key; u.houseLand = i; touch();
          broadcast({ t: 'owner', land: i, owner: u.name });
          sendMe(c);
          ok('House lot ' + (i + 1) + ' is yours — decorate with doors, gates, TVs & more!');
        } else {
          if (u.land != null) return err('You already own a starter farm. Buy a house lot south, or an expansion on the right.');
          db.lands[i].owner = c.key; u.land = i; touch();
          broadcast({ t: 'owner', land: i, owner: u.name });
          sendMe(c);
          ok('Land ' + (i + 1) + ' is yours!');
        }
        break;
      }
      case 'tap_grow': {
        // Tap a growing plant for a tiny tip ($0.10–$0.50)
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return;
        const k = m.tx + ',' + m.ty, tile = actLand.tiles[k];
        if (!tile || tile.type !== 'plant') return;
        const seed = C.SEED_BY[tile.seed]; if (!seed) return;
        if (Date.now() >= tile.at + growMs(seed)) return err('Ready to harvest — click the plant!');
        if (Date.now() - (u.tapAt || 0) < 450) return;
        u.tapAt = Date.now();
        const tip = roundMoney(C.TAP_MIN + Math.random() * (C.TAP_MAX - C.TAP_MIN));
        u.money = roundMoney(u.money + tip);
        touch(); sendMe(c);
        send(ws, { t: 'tap_earn', amount: tip });
        break;
      }
      case 'plant': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return err('You can only plant on your own land.');
        const k = m.tx + ',' + m.ty;
        if (actLand.tiles[k]) return err('That spot is taken.');
        const seed = C.SEED_BY[m.seed];
        if (!seed || !(u.seeds[seed.id] > 0)) return err('You have no ' + (seed ? seed.name : 'such') + ' seeds.');
        u.seeds[seed.id]--; if (!u.seeds[seed.id]) delete u.seeds[seed.id];
        setTile(landIdx, k, { type: 'plant', seed: seed.id, at: Date.now(), gold: Math.random() < C.GOLD_CHANCE });
        sendMe(c);
        break;
      }
      case 'harvest': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return err('You can only harvest on your own land.');
        const k = m.tx + ',' + m.ty, tile = actLand.tiles[k];
        if (!tile || tile.type !== 'plant') return;
        const seed = C.SEED_BY[tile.seed];
        if (Date.now() < tile.at + growMs(seed)) return err('Not ready yet.');
        const key = seed.id + (tile.gold ? '_gold' : '');
        const val = seed.sell * (tile.gold ? C.GOLD_MULT : 1);
        u.crops[key] = (u.crops[key] || 0) + 1;
        const st = actLand.stats || (actLand.stats = { harvested: 0, growTime: 0, value: 0 });
        st.harvested += 1;
        st.growTime += Math.max(0, Date.now() - tile.at);
        st.value += val;
        setTile(landIdx, k, null);
        broadcast({ t: 'land_stats', land: landIdx, stats: st });
        sendMe(c);
        send(ws, { t: 'harvested', seed: seed.id, gold: !!tile.gold });
        break;
      }
      case 'buy_square': {
        // Buy one adjacent world tile as expansion of your starter land (not expansion plots)
        if (u.land == null) return err('Claim a starter land first.');
        const li = u.land;
        const meta = C.WORLD.lands[li];
        if (!meta || meta.expand || meta.house) return err('Only starter farms expand per square.');
        const L = db.lands[li];
        const extras = Object.keys(L.extra || {});
        if (extras.length >= C.SQUARE_MAX) return err('Max ' + C.SQUARE_MAX + ' extra squares on this land.');
        const price = C.squarePrice(extras.length);
        const wx = Math.floor(Number(m.wx)), wy = Math.floor(Number(m.wy));
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
        const rx = wx - meta.x, ry = wy - meta.y;
        // must be adjacent to current footprint
        const foot = landFootprint(li);
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => foot.has((wx - dx) + ',' + (wy - dy)));
        if (!adj) return err('Pick a square next to your land.');
        if (foot.has(wx + ',' + wy)) return err('You already own that square.');
        // temporarily ignore self footprint for blocked check
        const othersBlocked = (() => {
          if (wx < 0 || wy < 0 || wx >= C.WORLD.width || wy >= C.WORLD.height) return true;
          const S = C.WORLD.shop;
          if (wx >= S.x && wx < S.x + S.w && wy >= S.y && wy < S.y + S.h) return true;
          if (C.WORLD.park && wx >= C.WORLD.park.x && wx < C.WORLD.park.x + C.WORLD.park.w && wy >= C.WORLD.park.y && wy < C.WORLD.park.y + C.WORLD.park.h) return true;
          if (C.WORLD.petShop && wx >= C.WORLD.petShop.x && wx < C.WORLD.petShop.x + C.WORLD.petShop.w && wy >= C.WORLD.petShop.y && wy < C.WORLD.petShop.y + C.WORLD.petShop.h) return true;
          for (const p of Object.values(C.WORLD.pens || {})) if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) return true;
          for (let i = 0; i < db.lands.length; i++) if (i !== li && landFootprint(i).has(wx + ',' + wy)) return true;
          return false;
        })();
        if (othersBlocked) return err('That square is blocked.');
        if (u.money < price) return err('Need $' + price + ' for the next square (gets pricier each time).');
        u.money = roundMoney(u.money - price);
        L.extra[rx + ',' + ry] = 1;
        touch();
        broadcast({ t: 'land_extra', land: li, extra: L.extra });
        sendMe(c);
        ok('Expanded +1 square for $' + price + '! Next costs $' + C.squarePrice(extras.length + 1) + '.');
        break;
      }
      case 'place': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return err('You can only decorate your own land.');
        const f = C.FURN_BY[m.furn];
        if (!f || !(u.furniture[m.furn] > 0)) return err("You don't own that.");
        const rot = Number.isInteger(m.rot) ? (m.rot & 3) : undefined;
        const size = f.size || 1;
        let ax = m.tx, ay = m.ty;
        if (size > 1) {
          // find a size×size footprint that covers the clicked tile and is entirely free + owned
          let found = false;
          for (let dy = 0; dy < size && !found; dy++) for (let dx = 0; dx < size && !found; dx++) {
            const x0 = m.tx - dx, y0 = m.ty - dy; let good = true;
            for (let y = y0; y < y0 + size && good; y++) for (let x = x0; x < x0 + size; x++) if (!relOwned(actLand, x, y) || actLand.tiles[x + ',' + y]) { good = false; break; }
            if (good) { ax = x0; ay = y0; found = true; }
          }
          if (!found) return err('Needs a free ' + size + '×' + size + ' area of your land.');
        } else if (actLand.tiles[m.tx + ',' + m.ty]) return err('That spot is taken.');
        u.furniture[m.furn]--; if (!u.furniture[m.furn]) delete u.furniture[m.furn];
        const anchor = ax + ',' + ay;
        setTile(landIdx, anchor, rot === undefined ? { type: 'furn', id: m.furn } : { type: 'furn', id: m.furn, rot });
        if (size > 1) for (let y = ay; y < ay + size; y++) for (let x = ax; x < ax + size; x++) if (x !== ax || y !== ay) setTile(landIdx, x + ',' + y, { type: 'part', k: anchor });
        sendMe(c);
        break;
      }
      case 'rotate': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return;
        let k = m.tx + ',' + m.ty, tile = actLand.tiles[k];
        if (tile && tile.type === 'part') { k = tile.k; tile = actLand.tiles[k]; }
        if (!tile || tile.type !== 'furn') return;
        setTile(landIdx, k, Object.assign({}, tile, { rot: (((tile.rot == null ? 0 : tile.rot) + 1) & 3) }));
        break;
      }
      case 'pickup': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return;
        let k = m.tx + ',' + m.ty, tile = actLand.tiles[k];
        if (tile && tile.type === 'part') { k = tile.k; tile = actLand.tiles[k]; }
        if (!tile || tile.type !== 'furn') return;
        const size = (C.FURN_BY[tile.id] || {}).size || 1;
        u.furniture[tile.id] = (u.furniture[tile.id] || 0) + 1;
        const [ax, ay] = k.split(',').map(Number);
        for (let y = ay; y < ay + size; y++) for (let x = ax; x < ax + size; x++) setTile(landIdx, x + ',' + y, null);
        sendMe(c);
        break;
      }
      case 'buy': {
        let qty = Math.max(1, Math.min(99, Math.floor(Number(m.qty)) || 1));
        if (m.kind === 'seed') {
          const s = C.SEED_BY[m.id]; if (!s) return;
          if (u.money < s.cost * qty) return err('Not enough money.');
          u.money -= s.cost * qty; u.seeds[s.id] = (u.seeds[s.id] || 0) + qty;
        } else if (m.kind === 'furn') {
          const f = C.FURN_BY[m.id]; if (!f || f.buyable === false) return;
          if (u.money < f.price * qty) return err('Not enough money.');
          u.money -= f.price * qty; u.furniture[f.id] = (u.furniture[f.id] || 0) + qty;
        } else if (m.kind === 'cloth') {
          const cl = C.CLOTH_BY[m.id]; if (!cl || cl.buyable === false || cl.price === 0 || u.clothes.includes(cl.id)) return;
          if (u.money < cl.price) return err('Not enough money.');
          u.money -= cl.price; u.clothes.push(cl.id);
        } else if (m.kind === 'animal') {
          const a = C.ANIMALS[m.id]; if (!a) return;
          qty = 1;
          if ((u.animals[m.id] || 0) >= a.max) return err('Pen is full (' + a.max + ' max).');
          if (u.money < a.buy) return err('Not enough money.');
          u.money -= a.buy; u.animalBorn[m.id + ':' + (u.animals[m.id] || 0)] = Date.now(); u.animalSex[m.id + ':' + (u.animals[m.id] || 0)] = rndSex(); u.animals[m.id] = (u.animals[m.id] || 0) + 1;
          if (m.id === 'chicken' && !u.animalAt.egg) u.animalAt.egg = Date.now();
          playersDirty = true;
        } else if (m.kind === 'pet') {
          const p = C.PET_BY[m.id]; if (!p || u.pets.includes(p.id)) return;
          if (u.money < p.price) return err('Not enough money.');
          u.money -= p.price; u.pets.push(p.id); u.animalBorn['pet:' + p.id] = Date.now(); u.animalSex['pet:' + p.id] = rndSex();
          playersDirty = true;
        } else return;
        touch(); sendMe(c);
        break;
      }
      case 'sell': {
        let gain = 0;
        if (m.kind === 'product') {
          const prod = C.PRODUCTS[m.id]; if (!prod) return;
          const have = u.products[m.id] || 0;
          const qty = m.qty === 'all' ? have : Math.min(have, Math.max(1, Math.floor(Number(m.qty)) || 1));
          if (!qty) return;
          gain = qty * prod.sell;
          u.products[m.id] -= qty; if (!u.products[m.id]) delete u.products[m.id];
        } else {
          const sell = key => {
            const n = u.crops[key] || 0; if (!n) return 0;
            const seed = C.SEED_BY[key.replace('_gold', '')]; if (!seed) return 0;
            return n * seed.sell * (key.endsWith('_gold') ? C.GOLD_MULT : 1);
          };
          if (m.key === '*') {
            for (const k of Object.keys(u.crops)) { gain += sell(k); delete u.crops[k]; }
          } else {
            const have = u.crops[m.key] || 0;
            const qty = m.qty === 'all' ? have : Math.min(have, Math.max(1, Math.floor(Number(m.qty)) || 1));
            if (!qty) return;
            const seed = C.SEED_BY[String(m.key).replace('_gold', '')]; if (!seed) return;
            gain = qty * seed.sell * (String(m.key).endsWith('_gold') ? C.GOLD_MULT : 1);
            u.crops[m.key] -= qty; if (!u.crops[m.key]) delete u.crops[m.key];
          }
        }
        if (!gain) return;
        u.money += gain; touch(); sendMe(c);
        ok('Sold for $' + gain.toLocaleString());
        break;
      }
      case 'stall_play': {
        const stall = C.WORLD.stalls.find(s => s.id === m.id);
        if (!stall) return;
        const last = u.stallAt[stall.id] || 0;
        if (Date.now() - last < stall.cd * 1000) return err('Stall cooling down — come back soon.');
        // client runs mini-game; server trusts short ok window then pays modest amount
        if (!m.ok) return err('Nice try — finish the mini-game!');
        u.stallAt[stall.id] = Date.now();
        const pay = randPay(stall.pay[0], stall.pay[1]);
        u.money += pay; touch(); sendMe(c);
        ok(stall.name + ': earned $' + pay);
        break;
      }
      case 'forage': {
        const bush = C.WORLD.bushes.find(b => b.id === m.id);
        if (!bush) return;
        const last = u.bushAt[bush.id] || 0;
        if (Date.now() - last < C.BUSH_CD * 1000) return err('This bush needs to regrow.');
        u.bushAt[bush.id] = Date.now();
        if (Math.random() < C.BUSH_DROP) {
          const loot = C.BUSH_LOOT[Math.floor(Math.random() * C.BUSH_LOOT.length)];
          if (loot.kind === 'furn') {
            u.furniture[loot.id] = (u.furniture[loot.id] || 0) + 1;
            touch(); sendMe(c);
            ok('✨ Rare find! ' + (C.FURN_BY[loot.id]?.name || 'Furniture') + ' (bush exclusive)');
          } else {
            if (!u.clothes.includes(loot.id)) u.clothes.push(loot.id);
            touch(); sendMe(c);
            ok('✨ Rare find! ' + (C.CLOTH_BY[loot.id]?.name || 'Clothes') + ' (bush exclusive)');
          }
        } else {
          const coin = 3 + Math.floor(Math.random() * 6);
          u.money += coin; touch(); sendMe(c);
          ok('You rustled the bush — found $' + coin + ' (rare loot is ~5%)');
        }
        break;
      }
      case 'collect_eggs': {
        const n = u.animals.chicken || 0;
        if (!n) return err('Buy chickens at the chicken pen first.');
        const every = C.ANIMALS.chicken.eggEvery * 1000;
        const ready = Math.floor(Math.max(0, Date.now() - (u.animalAt.egg || Date.now())) / every);
        const eggs = Math.min(n * 2, ready); // capped
        if (eggs <= 0) return err('No eggs yet — chickens need time.');
        u.animalAt.egg = Date.now();
        addProduct('egg', eggs);
        touch(); sendMe(c);
        ok('Collected ' + eggs + ' egg' + (eggs > 1 ? 's' : '') + '!');
        break;
      }
      case 'slaughter': {
        const kind = m.id;
        const a = C.ANIMALS[kind];
        if (!a || !(u.animals[kind] > 0)) return err('No ' + (a ? a.name : 'animal') + ' to process.');
        u.animals[kind]--;
        for (const map of [u.animalNames, u.animalReady, u.animalBorn, u.animalSex]) for (const k of Object.keys(map)) { const [kk, ii] = k.split(':'); if (kk === kind && Number(ii) >= u.animals[kind]) delete map[k]; }
        const meatN = kind === 'chicken' ? 1 : 2;
        addProduct('meat', meatN);
        if (kind === 'sheep') addProduct('wool', 1);
        touch(); sendMe(c); playersDirty = true;
        ok('Processed 1 ' + a.name.toLowerCase() + ' → meat' + (kind === 'sheep' ? ' + wool' : ''));
        break;
      }
      case 'harvest_animal': {   // milk a cow / shear a sheep — per-animal cooldown, no mini-game
        const kind = m.kind;
        if (kind !== 'cow' && kind !== 'sheep') return;
        const a = C.ANIMALS[kind], have = u.animals[kind] || 0;
        if (!have) return err('You need a ' + a.name.toLowerCase() + ' first.');
        const cd = (kind === 'cow' ? a.milkCd : a.woolCd) * 1000, cap = Math.min(have, a.max);
        const idxs = m.idx === 'all' ? [...Array(cap).keys()] : (Number.isInteger(m.idx) && m.idx >= 0 && m.idx < cap ? [m.idx] : []);
        if (!idxs.length) return;
        const t0 = Date.now(); let n = 0;
        for (const i of idxs) { const k = kind + ':' + i; if (t0 - (u.animalReady[k] || 0) >= cd) { u.animalReady[k] = t0; n++; } }
        if (!n) return err(kind === 'cow' ? 'Not ready to milk yet — give it a little time.' : 'The wool is still growing back.');
        addProduct(kind === 'cow' ? 'milk' : 'wool', n);
        touch(); sendMe(c); playersDirty = true;
        const who = idxs.length === 1 ? (u.animalNames[kind + ':' + idxs[0]] || ('your ' + a.name.toLowerCase())) : n + ' ' + (kind === 'sheep' ? 'sheep' : 'cows');
        ok(kind === 'cow' ? 'Milked ' + who + ': +' + n + ' milk 🥛' : 'Sheared ' + who + ': +' + n + ' wool ✂️');
        break;
      }
      case 'mail_read': {
        const mm = u.mail.find(x => x.id === m.id); if (mm && !mm.read) { mm.read = true; touch(); sendMe(c); }
        break;
      }
      case 'mail_claim': {
        const mm = u.mail.find(x => x.id === m.id);
        if (!mm || !(mm.money > 0) || mm.claimed) return err('Nothing to claim.');
        mm.claimed = true; mm.read = true; u.money = roundMoney(u.money + mm.money); touch(); sendMe(c);
        ok('Claimed $' + mm.money + ' from the mail!');
        break;
      }
      case 'mail_delete': {
        const i = u.mail.findIndex(x => x.id === m.id);
        if (i < 0) break;
        if (u.mail[i].money > 0 && !u.mail[i].claimed) return err('Claim the money first.');
        u.mail.splice(i, 1); touch(); sendMe(c);
        break;
      }
      case 'avatar': {
        const a = u.avatar;
        if (m.gender === 'male' || m.gender === 'female') a.gender = m.gender;
        if (C.SKINS.includes(m.skin)) a.skin = m.skin;
        if (C.HAIRS.includes(m.hairColor)) a.hairColor = m.hairColor;
        for (const slot of ['top', 'bottom', 'hat', 'shoes']) {
          if (m[slot] === undefined) continue;
          if (m[slot] === '' && slot === 'hat') { a.hat = ''; continue; }
          const it = C.CLOTH_BY[m[slot]];
          if (it && it.slot === slot && ownsCloth(u, it.id)) a[slot] = it.id;
        }
        if (m.done) u.charDone = true;
        touch(); sendMe(c); playersDirty = true;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (c && online.get(c.key) === c) {
      online.delete(c.key);
      broadcast({ t: 'sys', text: c.u.name + ' left.' });
      playersDirty = true;
    }
  });
});

setInterval(() => {
  if (!playersDirty) return;
  playersDirty = false;
  broadcast({ t: 'players', list: playerList() });
}, 100);

(async () => {
  if (useUpstash) { await loadFromUpstash(); console.log('Using Upstash Redis for storage'); }
  server.listen(PORT, () => console.log('Sunny Lots running on :' + PORT + ' (growth speed x' + SPEED + ')'));
})().catch(e => { console.error('startup failed:', e.message); process.exit(1); });
