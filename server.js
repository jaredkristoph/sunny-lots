'use strict';
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./catalog');
const Casino = require('./casino');
const GAME_LABEL = { roulette: 'Roulette', blackjack: 'Blackjack', baccarat: 'Baccarat', slots: 'Super Ace Slots', highlow: 'Higher / Lower' };
Casino.hooks.bigWin = (u, game, bet, won) => broadcast({ t: 'sys', text: '🎰 BIG WIN! ' + u.name + ' bet $' + Math.round(bet).toLocaleString() + ' on ' + (GAME_LABEL[game] || game) + ' and won $' + Math.round(won).toLocaleString() + '!' });
const Mon = require('./public/monsters.js');
const Battle = require('./battle.js');

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

// ---------------- investing: shared market, random walk every second ----------------
const CAR_BY = Object.fromEntries(C.CARS.map(x => [x.id, x]));
const mkt = {};   // sym -> {price, open, hist:[...]}
for (const a of C.MARKET) mkt[a.sym] = { price: a.base, open: a.base, hist: [a.base] };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function marketTick() {
  for (const a of C.MARKET) {
    const m = mkt[a.sym];
    let lp = Math.log(m.price) + a.vol * gauss() + 0.0008 * (Math.log(a.base) - Math.log(m.price));   // noise + gentle pull back toward fair value
    if (Math.random() < 0.004) lp += (Math.random() < 0.5 ? -1 : 1) * a.vol * (6 + Math.random() * 8);   // rare news jump
    m.price = Math.min(a.base * 4, Math.max(a.base * 0.25, Math.exp(lp)));
    m.hist.push(m.price); if (m.hist.length > 300) m.hist.shift();
  }
}
function ensureUser(u) {
  Casino.ensureUser(u);
  Battle.ensureMon(u);
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
  if (u.orc === undefined) u.orc = null;   // {name, harvest, plant, seed, mode:'follow'|'roam', bought}
  if (!u.bank) u.bank = { savings: 0, since: Date.now(), loan: 0, loanTaken: 0, loanSince: 0 };
  if (!Array.isArray(u.playDays)) u.playDays = [];   // distinct YYYY-MM-DD days this player logged in (loan eligibility)
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
  if (!Array.isArray(u.cars)) u.cars = [];          // owned car ids
  if (!u.carCol) u.carCol = {};                    // car id -> paint colour
  if (u.car === undefined) u.car = null;           // car currently being driven
  if (u.spouse === undefined) u.spouse = null;     // {name, gender:'f'|'m', look, since}
  if (!u.invest) u.invest = {};                    // sym -> {units, cost}
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
    SQUARE_COST: C.SQUARE_COST, SQUARE_GROW: C.SQUARE_GROW, SQUARE_MAX: C.SQUARE_MAX, ORC: C.ORC, BANK: C.BANK, CARS: C.CARS, CAR_COLORS: C.CAR_COLORS, CAR_SELL_RATE: C.CAR_SELL_RATE, BAR: C.BAR, MARKET: C.MARKET, STEAL: C.STEAL, INVEST_FEE: C.INVEST_FEE, SLOT: { SYM: Casino.SL.SYM, PAY: Casino.SL.PAY, BUY_MULT: Casino.SL.BUY_MULT, FREE_SPINS: Casino.SL.FREE_SPINS, BASE_MULT: Casino.SL.BASE_MULT, FREE_MULT: Casino.SL.FREE_MULT, ROWS: Casino.SL.ROWS, COLS: Casino.SL.COLS },
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
  settleBank(u);
  const b = { cash: r2(u.money || 0), bank: r2((u.bank.savings || 0) - (u.bank.loan || 0)), orc: u.orc ? C.ORC.price : 0, cars: 0, invest: 0, crops: 0, products: 0, seeds: 0, furniture: 0, clothes: 0, animals: 0, land: 0 };
  for (const id of u.cars || []) { const cd = CAR_BY[id]; if (cd) b.cars += cd.price * C.CAR_SELL_RATE; }
  for (const [sym, h] of Object.entries(u.invest || {})) if (mkt[sym]) b.invest += h.units * mkt[sym].price;
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
    return { name: u.name, cash: w.cash, savings: r2(u.bank.savings || 0), loan: r2(u.bank.loan || 0), orc: !!u.orc, days: (u.playDays || []).length, networth: w.total, breakdown: w, land: u.land, created: u.created || 0, online: online.has(key), unread: (u.mail || []).filter(m => !m.read).length, casinoNet: ['roulette', 'blackjack'].reduce((s, g) => s + (u.casino && u.casino[g] ? u.casino[g].paid - u.casino[g].wagered : 0), 0) };
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
const utcDay = () => Math.floor(Date.now() / 864e5);
const monState = u => {
  const m = u.mon, day = utcDay(), claimed = m.daily.last === day;
  const nextStreak = claimed ? m.daily.streak : (m.daily.last === day - 1 ? m.daily.streak + 1 : 1);
  return {
    starter: m.starter, party: m.party.map(x => Battle.monView(x, true)), boxCount: m.box.length, items: m.items,
    dex: { seen: Object.keys(m.dex.seen).length, caught: Object.keys(m.dex.caught).length, caughtIds: Object.keys(m.dex.caught).map(Number), seenIds: Object.keys(m.dex.seen).map(Number) },
    daily: { claimed, streak: m.daily.streak, idx: (Math.max(1, nextStreak) - 1) % 7, nextStreak }, badges: m.badges, beaten: Object.keys(m.beaten), inBattle: !!u.battle, pvp: m.pvp || { w: 0, l: 0 },
  };
};
const meView = u => ({
  mon: monState(u),
  name: u.name, money: u.money, seeds: u.seeds, crops: u.crops, furniture: u.furniture,
  clothes: u.clothes, avatar: u.avatar, land: u.land, expandLand: u.expandLand, houseLand: u.houseLand, charDone: u.charDone,
  animals: u.animals, products: u.products, pets: u.pets,
  animalStay: u.animalStay, petStay: u.petStay, animalNames: u.animalNames, animalReady: u.animalReady, animalBorn: u.animalBorn, animalSex: u.animalSex,
  stallAt: u.stallAt, animalAt: u.animalAt, bushAt: u.bushAt, mail: u.mail, orc: u.orc, bank: bankView(u),
  cars: u.cars, car: u.car, carCol: u.carCol, spouse: u.spouse, invest: u.invest,
});
const ownsLand = (u, i) => u.land === i || u.expandLand === i || u.houseLand === i;
const sendMe = c => send(c.ws, { t: 'me', me: meView(c.u) });
const sendCasino = (c, game) => send(c.ws, Object.assign({ t: 'casino_info', bj: game === 'blackjack' ? Casino.bjView(c.u) : undefined, hl: game === 'highlow' ? Casino.hlView(c.u) : undefined }, Casino.info(db, game, c.u.name)));
const playerList = () => [...online.values()].map(c => ({
  n: c.u.name, x: Math.round(c.x), y: Math.round(c.y), a: c.u.avatar,
  animals: c.u.animals, pets: c.u.pets, animalStay: c.u.animalStay, petStay: c.u.petStay, animalNames: c.u.animalNames, animalReady: c.u.animalReady, animalBorn: c.u.animalBorn, animalSex: c.u.animalSex,
  e: c.emote || null, es: c.emoteAt || 0, orc: c.u.orc ? { n: c.u.orc.name, m: c.u.orc.mode } : null,
  car: c.u.car ? { id: c.u.car, c: c.u.carCol[c.u.car] || null } : null, sp: c.u.spouse ? { n: c.u.spouse.name, l: c.u.spouse.look } : null,
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

// ---- shared farming helpers (used by multi-select, the Orc, and the single-tile handlers) ----
const r2m = n => Math.round(n * 100) / 100;
function setTileG(li, key, tile) {
  const L = db.lands[li]; if (!L) return;
  if (tile) L.tiles[key] = tile; else delete L.tiles[key];
  touch();
  broadcast({ t: 'tile', land: li, key, tile: tile || null });
}
function plantTile(u, li, k, seedId) {
  const L = db.lands[li], seed = C.SEED_BY[seedId];
  if (!L || !seed || L.tiles[k] || !(u.seeds[seedId] > 0)) return false;
  u.seeds[seedId]--; if (!u.seeds[seedId]) delete u.seeds[seedId];
  setTileG(li, k, { type: 'plant', seed: seedId, at: Date.now(), gold: Math.random() < C.GOLD_CHANCE });
  return true;
}
function harvestTile(u, li, k) {
  const L = db.lands[li], tile = L && L.tiles[k];
  if (!tile || tile.type !== 'plant') return false;
  const seed = C.SEED_BY[tile.seed];
  if (!seed || Date.now() < tile.at + growMs(seed)) return false;
  const key = seed.id + (tile.gold ? '_gold' : '');
  u.crops[key] = (u.crops[key] || 0) + 1;
  const st = L.stats || (L.stats = { harvested: 0, growTime: 0, value: 0 });
  st.harvested += 1; st.growTime += Math.max(0, Date.now() - tile.at); st.value += seed.sell * (tile.gold ? C.GOLD_MULT : 1);
  setTileG(li, k, null);
  broadcast({ t: 'land_stats', land: li, stats: st });
  return true;
}
/** every tile key of a farm land: the 8x8 base plus bought squares */
function landKeys(li) {
  const L = db.lands[li], out = [];
  for (let y = 0; y < C.WORLD.landSize; y++) for (let x = 0; x < C.WORLD.landSize; x++) out.push(x + ',' + y);
  for (const k of Object.keys((L && L.extra) || {})) out.push(k);
  return out;
}
// ---- Sunny Bank: interest accrues continuously (settled lazily) ----
function settleBank(u, t) {
  const b = u.bank; t = t || Date.now();
  const dt = (t - b.since) / 864e5;
  if (dt < 1 / 1440) return;   // under a minute: wait, so small amounts still accrue
  if (b.savings > 0) { const base = Math.min(b.savings, C.BANK.saveCap); b.savings += base * (Math.pow(1 + C.BANK.saveDaily, dt) - 1); }
  if (b.loan > 0) b.loan = Math.min(b.loanTaken * C.BANK.loanCapMult, b.loan * Math.pow(1 + C.BANK.loanDaily, dt));
  b.since = t;
}
const bankView = u => { settleBank(u); const b = u.bank; return { savings: r2m(b.savings), loan: r2m(b.loan), loanTaken: b.loanTaken, days: u.playDays.length, eligible: u.playDays.length >= C.BANK.minDaysPlayed }; };
// ---- Orc worker: every few seconds harvests ripe crops and replants ----
function orcWork(u, key) {
  const o = u.orc; if (!o) return;
  const lands = [u.land, u.expandLand].filter(x => x != null && db.lands[x]);
  let acts = 0;
  if (o.harvest) outer: for (const li of lands) for (const k of Object.keys(db.lands[li].tiles)) {
    if (acts >= C.ORC.perTick) break outer;
    if (db.lands[li].tiles[k].type === 'plant' && harvestTile(u, li, k)) acts++;
  }
  if (o.plant && acts < C.ORC.perTick) {
    outerP: for (const li of lands) for (const k of landKeys(li)) {
      if (acts >= C.ORC.perTick) break outerP;
      if (db.lands[li].tiles[k]) continue;
      let sid = o.seed;
      if (sid === 'any' || !(u.seeds[sid] > 0)) {
        sid = Object.keys(u.seeds).filter(x => u.seeds[x] > 0 && C.SEED_BY[x]).sort((a, b) => C.SEED_BY[b].sell - C.SEED_BY[a].sell)[0];
        if (o.seed !== 'any' && !sid) break outerP;
      }
      if (!sid) break outerP;
      if (plantTile(u, li, k, sid)) acts++;
    }
  }
  if (acts) { touch(); const c = online.get(key); if (c) { sendMe(c); send(c.ws, { t: 'orc_work', n: acts }); } }
}
setInterval(() => { for (const [key, u] of Object.entries(db.users)) if (u.orc) { try { ensureUser(u); orcWork(u, key); } catch (e) { console.error('orc', e.message); } } }, C.ORC.tickMs);

const rndSex = () => (require('crypto').randomInt(2) ? 'm' : 'f');
function spawnFor(u) {
  if (u.land != null) {
    const o = C.WORLD.lands[u.land];
    return { x: (o.x + 4) * T, y: (o.y + 8.6) * T };
  }
  return { x: C.WORLD.shopDoor.x * T, y: C.WORLD.shopDoor.y * T };
}

// ---------- player-vs-player battles ----------
function pvpSendAll(pv, res) {
  for (const S of ['A', 'B']) { const pc = pv.players[S]; if (pc && pc.pvp && pc.pvp.pv === pv) send(pc.ws, { t: 'mb_turn', events: Battle.pvpFlip(res.events || [], S), view: Battle.pvpView(pv, S) }); }
}
function pvpTimer(pv) {
  clearTimeout(pv.timer);
  if (pv.over) return;
  pv.timer = setTimeout(() => {       // slow players get an automatic move
    if (pv.over) return;
    for (const S of ['A', 'B']) { const v = Battle.pvpView(pv, S); if (v.phase === 'act' || v.phase === 'switch') { const r = Battle.pvpAuto(pv, S); if (!r.error) pvpSendAll(pv, r); } }
    pvpTimer(pv);
  }, 45000);
}
function pvpEnd(c) {
  const pr = c.pvp; if (!pr) return;
  c.pvp = null;
  const pv = pr.pv; if (!pv.players.A.pvp && !pv.players.B.pvp) clearTimeout(pv.timer);
}
function pvpHandle(c, m) {
  const { pv, S } = c.pvp;
  if (pv.over) {            // finished: this player acknowledges and leaves the battle screen
    if (m.a === 'close') {
      const first = !pv.recorded; pv.recorded = true;
      if (first) { const w = pv.players[pv.winner], l = pv.players[pv.winner === 'A' ? 'B' : 'A']; for (const [x, k] of [[w, 'w'], [l, 'l']]) { x.u.mon.pvp = x.u.mon.pvp || { w: 0, l: 0 }; x.u.mon.pvp[k]++; } touch(); sendMe(w); sendMe(l); }
      pvpEnd(c); send(c.ws, { t: 'mb_closed' });
    }
    return;
  }
  if (Date.now() - (c.lastMb || 0) < 150) return;
  c.lastMb = Date.now();
  const r = Battle.pvpAct(pv, S, { a: m.a, i: m.i });
  if (r.error) return send(c.ws, { t: 'mb_err', msg: r.error });
  if (r.resolved) { pvpSendAll(pv, r); pvpTimer(pv); }
  else send(c.ws, { t: 'mb_turn', events: [], view: Battle.pvpView(pv, S) });
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
      ensureUser(u);
      { const day = new Date().toISOString().slice(0, 10); if (!u.playDays.includes(day)) { u.playDays.push(day); if (u.playDays.length > 60) u.playDays.shift(); touch(); } }
      const p = spawnFor(u);
      c = { ws, u, key, x: p.x, y: p.y };
      online.set(key, c);
      send(ws, {
        t: 'init', me: meView(u), mb: u.battle ? Battle.view(u) : null, pos: p, now: Date.now(), speed: SPEED,
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
      case 'mon_starter': {
        const mo = u.mon;
        if (mo.starter) return err('You already chose a starter.');
        const starters = Mon.FAMILIES.filter(f => f[6] && f[6].starter).map(f => Mon.BY_NAME[f[5][0]]);
        const spId = Number(m.sp);
        if (!starters.includes(spId)) return err('Pick one of the three starters.');
        const st = Battle.makeMon(spId, 5);
        mo.starter = spId; mo.party.push(st); mo.dex.caught[spId] = 1; mo.dex.seen[spId] = 1;
        for (const sid of starters) mo.dex.seen[sid] = 1;
        mo.items.orb = (mo.items.orb || 0) + 5; mo.items.potion = (mo.items.potion || 0) + 3;
        touch(); sendMe(c); ok('You chose ' + Mon.SPECIES[spId].name + '! Your adventure begins.');
        break;
      }
      case 'mon_daily': {
        const mo = u.mon, day = utcDay();
        if (!mo.starter) return err('Choose your starter first.');
        if (mo.daily.last === day) return err('You already claimed today\'s reward.');
        const streak = mo.daily.last === day - 1 ? mo.daily.streak + 1 : 1, R = Mon.DAILY[(streak - 1) % 7];
        if (R.money) u.money = roundMoney(u.money + R.money);
        for (const [k, n] of Object.entries(R.items || {})) mo.items[k] = (mo.items[k] || 0) + n;
        let got = null;
        if (R.monster) { got = Battle.makeMon(R.monster, R.level || 10); if (mo.party.length < Battle.PARTY_MAX) mo.party.push(got); else mo.box.push(got); mo.dex.caught[R.monster] = 1; mo.dex.seen[R.monster] = 1; }
        mo.daily.last = day; mo.daily.streak = streak;
        touch(); sendMe(c);
        send(ws, { t: 'mon_daily_ok', day: (streak - 1) % 7, monster: got ? Mon.SPECIES[got.sp].name : null });
        break;
      }
      case 'mon_encounter': {
        const mo = u.mon;
        if (u.battle || c.pvp || !mo.starter) return;
        if (Date.now() - (c.lastEnc || 0) < 2500) return;
        const route = Mon.ROUTES[m.route]; if (!route) return;
        const tx = c.x / T, ty = c.y / T;
        if (Mon.grassRouteAt(Math.floor(tx), Math.floor(ty)) !== Number(String(m.route).slice(1))) return;
        c.lastEnc = Date.now();
        const w = Battle.rollWild(route), r = Battle.startWild(u, w.sp, w.lv);
        if (r.error) return err(r.error);
        touch(); sendMe(c); send(ws, { t: 'mb_start', events: r.events, view: Battle.view(u) });
        break;
      }
      case 'mon_trainer': {
        const tr = Mon.TRAINERS.find(x => x.id === m.id); if (!tr || u.battle || c.pvp || !u.mon.starter) return;
        if (Math.hypot(c.x / T - tr.x, c.y / T - tr.y) > 9) return err('Walk closer to challenge them.');
        if (tr.gym) { const g = Mon.GYMS.find(x => x.id === tr.gym), prev = Mon.GYMS[g.n - 2]; if (prev && !u.mon.badges.includes(prev.badge)) return err('You need the ' + prev.badge + ' first.'); }
        const r = Battle.startTrainer(u, tr);
        if (r.error) return err(r.error);
        c.lastEnc = Date.now(); touch(); sendMe(c); send(ws, { t: 'mb_start', events: r.events, view: Battle.view(u) });
        break;
      }
      case 'mon_legend': {
        const mo = u.mon, L = Mon.LEGENDS.find(x => x.sp === Number(m.sp));
        if (!L || u.battle || c.pvp || !mo.starter) return;
        if (mo.badges.length < L.badges) return err('The shrine stays silent... you need ' + L.badges + ' badges.');
        if (mo.dex.caught[L.sp]) return err('You already have ' + Mon.SPECIES[L.sp].name + '.');
        if (Math.hypot(c.x / T - L.x, c.y / T - L.y) > 7) return err('Walk closer to the shrine.');
        const r = Battle.startWild(u, L.sp, L.lv); if (r.error) return err(r.error);
        r.events.unshift({ k: 'msg', text: 'The shrine glows... a legendary presence awakens!' });
        touch(); sendMe(c); send(ws, { t: 'mb_start', events: r.events, view: Battle.view(u) });
        break;
      }
      case 'pvp_challenge': {
        const tk = String(m.to || '').toLowerCase(), t = online.get(tk);
        if (!t || t === c) return err('That player is not online.');
        const okp = x => x.u.mon.starter && x.u.mon.party.some(y => y.hp > 0) && !x.u.battle && !x.pvp;
        if (!okp(c) || !okp(t)) return err('Both players need a healthy monster and must not be in a battle.');
        if (Math.hypot(c.x - t.x, c.y - t.y) / T > 20) return err('Get closer to ' + t.u.name + ' to challenge them.');
        if (t.invite && Date.now() - t.invite.at < 30000) return err(t.u.name + ' already has a pending challenge.');
        t.invite = { from: c.u.name, at: Date.now() };
        send(t.ws, { t: 'pvp_invite', from: c.u.name }); ok('Challenge sent to ' + t.u.name + '. Waiting for a reply...');
        break;
      }
      case 'pvp_reply': {
        const inv = c.invite; c.invite = null;
        if (!inv || Date.now() - inv.at > 30000) return err('That challenge expired.');
        const a = online.get(inv.from.toLowerCase());
        if (!a) return err('That player left.');
        if (!m.ok) { send(a.ws, { t: 'err', msg: c.u.name + ' declined your challenge.' }); break; }
        const okp = x => x.u.mon.party.some(y => y.hp > 0) && !x.u.battle && !x.pvp;
        if (!okp(a) || !okp(c)) return err('Battle cannot start right now.');
        const pv = Battle.pvpNew(a.u.name, a.u.mon.party, c.u.name, c.u.mon.party);
        pv.id = crypto.randomBytes(4).toString('hex'); pv.players = { A: a, B: c };
        a.pvp = { pv, S: 'A' }; c.pvp = { pv, S: 'B' };
        for (const S of ['A', 'B']) { const pc = pv.players[S]; send(pc.ws, { t: 'mb_start', events: [{ k: 'msg', text: 'Friendly battle against ' + pv[S === 'A' ? 'B' : 'A'].name + '!' }], view: Battle.pvpView(pv, S) }); }
        pvpTimer(pv);
        break;
      }
      case 'mb_act': {
        if (c.pvp) { pvpHandle(c, m); break; }
        if (Date.now() - (c.lastMb || 0) < 150) return;
        c.lastMb = Date.now();
        const r = Battle.act(db, u, { a: m.a, i: m.i, item: m.item });
        if (r.error) return send(ws, { t: 'mb_err', msg: r.error });
        touch(); sendMe(c);
        if (r.ended) { return send(ws, { t: 'mb_closed' }); }
        send(ws, { t: 'mb_turn', events: r.events, view: Battle.view(u) });
        break;
      }
      case 'mb_resume': { if (u.battle) send(ws, { t: 'mb_start', events: [{ k: 'msg', text: 'Back in the battle!' }], view: Battle.view(u) }); break; }
      case 'mon_heal': case 'mon_buy': {
        if (u.battle) return err('Finish your battle first.');
        if (c.pvp) return err('Finish your battle first.');
        if (!C.WORLD.centers.some(ctr => Math.hypot(c.x / T - (ctr.x + ctr.w / 2), c.y / T - (ctr.y + ctr.h / 2)) <= 9)) return err('Go to a Bitmon Center first.');
        if (m.t === 'mon_heal') { Battle.healAll(u); touch(); sendMe(c); ok('Your monsters are fully healed!'); break; }
        const id = m.item, n = Math.max(1, Math.min(99, Math.floor(Number(m.n) || 1)));
        const it = Mon.ORBS[id] || Mon.POTIONS[id];
        if (!it || !Mon.SHOP.includes(id)) return err('That is not for sale.');
        const cost = it.price * n;
        if (u.money < cost) return err('Not enough money.');
        u.money = roundMoney(u.money - cost); u.mon.items[id] = (u.mon.items[id] || 0) + n;
        touch(); sendMe(c); ok('Bought ' + n + '× ' + it.name + '.');
        break;
      }
      case 'mon_use': {   // potions outside battle
        const mo = u.mon; if (u.battle) return err('Not during a battle.');
        const it = Mon.POTIONS[m.item];
        if (!it || !(mo.items[m.item] > 0)) return err('You do not have that item.');
        const tgt = mo.party[m.i | 0]; if (!tgt) return err('Pick a monster.');
        if (it.revive) { if (tgt.hp > 0) return err('That monster has not fainted.'); tgt.hp = Math.max(1, Math.floor(Battle.maxHp(tgt) * it.revive)); }
        else if (tgt.hp <= 0) return err('That monster has fainted.');
        else if (it.heal) { if (tgt.hp >= Battle.maxHp(tgt)) return err('HP is already full.'); tgt.hp = Math.min(Battle.maxHp(tgt), tgt.hp + it.heal); }
        else if (it.cure) { if (!tgt.status) return err('No status to cure.'); tgt.status = null; }
        else if (it.pp) { for (const mm of tgt.moves) mm.pp = Math.min(Mon.MOVES[mm.id].pp, mm.pp + it.pp); }
        mo.items[m.item]--; if (!mo.items[m.item]) delete mo.items[m.item];
        touch(); sendMe(c); break;
      }
      case 'mon_box': { send(ws, { t: 'mon_box', box: u.mon.box.map(x => Battle.monView(x, true)) }); break; }
      case 'mon_move': {   // deposit / withdraw / lead
        const mo = u.mon; if (u.battle) return err('Not during a battle.');
        const pi = mo.party.findIndex(x => x.id === m.id), bi = mo.box.findIndex(x => x.id === m.id);
        if (m.to === 'box' && pi >= 0) { if (mo.party.length <= 1) return err('Keep at least one monster in your party.'); mo.box.push(mo.party.splice(pi, 1)[0]); }
        else if (m.to === 'party' && bi >= 0) { if (mo.party.length >= Battle.PARTY_MAX) return err('Your party is full.'); mo.party.push(mo.box.splice(bi, 1)[0]); }
        else if (m.to === 'lead' && pi > 0) { const x = mo.party.splice(pi, 1)[0]; mo.party.unshift(x); }
        else return;
        touch(); sendMe(c); send(ws, { t: 'mon_box', box: mo.box.map(x => Battle.monView(x, true)) });
        break;
      }
      case 'mon_nick': {
        const x = u.mon.party.concat(u.mon.box).find(y => y.id === m.id); if (!x) return;
        const nm = String(m.name || '').replace(/[^\p{L}\p{N} '_.!-]/gu, '').trim().slice(0, 12);
        x.nick = nm || null; touch(); sendMe(c); break;
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
        if (!Casino.info || !['roulette', 'blackjack', 'slots', 'baccarat', 'highlow'].includes(m.game)) return;
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
      case 'bj_deal': case 'bj_hit': case 'bj_stand': case 'bj_double': case 'bj_split': {
        if (Date.now() - (c.lastBet || 0) < 250) return;
        c.lastBet = Date.now();
        const r = m.t === 'bj_deal' ? Casino.bjDeal(db, u, m.bet, m.hands) : m.t === 'bj_hit' ? Casino.bjHit(db, u) : m.t === 'bj_stand' ? Casino.bjStand(db, u) : m.t === 'bj_split' ? Casino.bjSplit(db, u) : Casino.bjDouble(db, u);
        if (r.error) return err(r.error);
        touch(); sendMe(c); sendCasino(c, 'blackjack');
        break;
      }
      case 'baccarat_deal': {
        if (Date.now() - (c.lastBet || 0) < 600) return;
        c.lastBet = Date.now();
        const r = Casino.baccaratDeal(db, u, m.bets);
        if (r.error) return err(r.error);
        touch();
        send(ws, { t: 'baccarat_result', r });
        setTimeout(() => { sendMe(c); sendCasino(c, 'baccarat'); }, 4200);   // after the cards are revealed
        break;
      }
      case 'hl_start': case 'hl_guess': case 'hl_skip': case 'hl_cash': {
        if (Date.now() - (c.lastBet || 0) < 200) return;
        c.lastBet = Date.now();
        const r = m.t === 'hl_start' ? Casino.hlStart(db, u, m.bet) : m.t === 'hl_guess' ? Casino.hlGuess(db, u, m.g) : m.t === 'hl_skip' ? Casino.hlSkip(db, u) : Casino.hlCashOut(db, u);
        if (r.error) return err(r.error);
        touch(); sendMe(c); sendCasino(c, 'highlow');
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
      case 'slots_spin': {
        if (Date.now() - (c.lastBet || 0) < 700) return;
        c.lastBet = Date.now();
        const r = Casino.slotSpin(db, u, Number(m.bet), !!m.buy);
        if (r.error) return err(r.error);
        touch();
        send(ws, { t: 'slots_result', r });
        const nSteps = (r.base ? r.base.steps.length : 0) + r.free.reduce((a, f) => a + f.steps.length, 0);
        setTimeout(() => { sendMe(c); sendCasino(c, 'slots'); }, Math.min(60000, 1500 + nSteps * 1400 + (r.free.length ? 2200 : 0)));   // money/stats update once the reels have finished
        break;
      }
      case 'plant_many': {
        if (!actLand || !ownsLand(u, landIdx)) return err('You can only plant on your own land.');
        const seed = C.SEED_BY[m.seed]; if (!seed) return;
        const list = Array.isArray(m.tiles) ? m.tiles.slice(0, 300) : [];
        let n = 0;
        for (const t of list) {
          if (!Array.isArray(t) || !Number.isInteger(t[0]) || !Number.isInteger(t[1]) || !relOwned(actLand, t[0], t[1])) continue;
          if (!(u.seeds[seed.id] > 0)) break;
          if (plantTile(u, landIdx, t[0] + ',' + t[1], seed.id)) n++;
        }
        if (!n) return err(u.seeds[seed.id] > 0 ? 'Those spots are already taken.' : 'You have no ' + seed.name + ' seeds.');
        sendMe(c); ok('Planted ' + n + ' ' + seed.name + (n > 1 ? 's' : '') + '.');
        break;
      }
      case 'harvest_many': {
        const lis = m.all ? [u.land, u.expandLand, u.houseLand].filter(x => x != null && db.lands[x]) : (actLand && ownsLand(u, landIdx) ? [landIdx] : []);
        if (!lis.length) return err('You can only harvest on your own land.');
        let n = 0;
        for (const li of lis) {
          const L = db.lands[li];
          const keys = m.all || !Array.isArray(m.tiles) ? Object.keys(L.tiles) : m.tiles.slice(0, 300).filter(t => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])).map(t => t[0] + ',' + t[1]);
          for (const k of keys) if (L.tiles[k] && L.tiles[k].type === 'plant' && harvestTile(u, li, k)) n++;
        }
        if (!n) return err('Nothing is ready to harvest yet.');
        sendMe(c); send(ws, { t: 'harvested_many', n }); ok('Harvested ' + n + ' crop' + (n > 1 ? 's' : '') + '!');
        break;
      }
      case 'buy_orc': {
        if (u.orc) return err('You already have an Orc.');
        if (u.money < C.ORC.price) return err('An Orc costs $' + C.ORC.price.toLocaleString() + '.');
        u.money = r2m(u.money - C.ORC.price);
        u.orc = { name: 'Orc', harvest: true, plant: false, seed: 'any', mode: 'follow', bought: Date.now() };
        touch(); sendMe(c); playersDirty = true; ok('Your Orc joined the farm! Open its settings to give it jobs.');
        break;
      }
      case 'orc_set': {
        if (!u.orc) return;
        const o = u.orc;
        if (typeof m.harvest === 'boolean') o.harvest = m.harvest;
        if (typeof m.plant === 'boolean') o.plant = m.plant;
        if (m.seed === 'any' || C.SEED_BY[m.seed]) o.seed = m.seed;
        if (m.mode === 'follow' || m.mode === 'roam') o.mode = m.mode;
        if (typeof m.name === 'string') { const nm = m.name.replace(/[^\p{L}\p{N} '_.!-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14); o.name = nm || 'Orc'; }
        touch(); sendMe(c); playersDirty = true;
        break;
      }
      case 'bank_open': { sendMe(c); break; }
      case 'bank_deposit': case 'bank_withdraw': case 'bank_loan': case 'bank_repay': {
        if (Date.now() - (c.lastBank || 0) < 250) return;
        c.lastBank = Date.now();
        settleBank(u);
        const b = u.bank;
        let amt = m.amount === 'all' ? Infinity : Number(m.amount);
        if (!(amt > 0)) return err('Enter an amount.');
        if (m.t === 'bank_deposit') {
          amt = r2m(Math.min(amt, u.money)); if (!(amt > 0)) return err('You have no cash to deposit.');
          u.money = r2m(u.money - amt); b.savings += amt; ok('Deposited $' + amt.toLocaleString() + '.');
        } else if (m.t === 'bank_withdraw') {
          amt = r2m(Math.min(amt, b.savings)); if (!(amt > 0)) return err('Nothing to withdraw.');
          b.savings = Math.max(0, b.savings - amt); u.money = r2m(u.money + amt); ok('Withdrew $' + amt.toLocaleString() + '.');
        } else if (m.t === 'bank_loan') {
          if (u.playDays.length < C.BANK.minDaysPlayed) return err('Loans open after you have played on ' + C.BANK.minDaysPlayed + ' different days (you have ' + u.playDays.length + ').');
          if (b.loan > 0.005) return err('Repay your current loan first.');
          amt = Math.floor(amt); if (!(amt >= 1) || amt > C.BANK.loanMax) return err('Loans are $1 – $' + C.BANK.loanMax.toLocaleString() + '.');
          b.loan = amt; b.loanTaken = amt; b.loanSince = Date.now(); u.money = r2m(u.money + amt); ok('Loan of $' + amt.toLocaleString() + ' approved.');
        } else {
          if (!(b.loan > 0.005)) return err('You have no loan.');
          amt = r2m(Math.min(amt, b.loan, u.money)); if (!(amt > 0)) return err('You have no cash to repay with.');
          u.money = r2m(u.money - amt); b.loan = Math.max(0, b.loan - amt);
          if (b.loan < 0.005) { b.loan = 0; b.loanTaken = 0; }
          ok('Repaid $' + amt.toLocaleString() + '.');
        }
        touch(); sendMe(c);
        break;
      }
      case 'steal': {
        const li = m.land, L = Number.isInteger(li) ? db.lands[li] : null;
        if (!L || !L.owner || L.owner === '__npc__' || L.owner === c.key || !db.users[L.owner]) return err('Pick a crop on another player\'s farm.');
        if (!Number.isInteger(m.tx) || !Number.isInteger(m.ty)) return;
        const wait = (u.stealAt || 0) + C.STEAL.cooldownMs - Date.now();
        if (wait > 0) return err('Lie low for ' + Math.ceil(wait / 1000) + 's before stealing again.');
        const k = m.tx + ',' + m.ty, tile = L.tiles[k];
        if (!tile || tile.type !== 'plant') return err('Nothing to steal there.');
        const seed = C.SEED_BY[tile.seed];
        if (!seed || Date.now() < tile.at + growMs(seed)) return err('That crop is not ripe yet.');
        u.stealAt = Date.now();
        const victim = db.users[L.owner];
        if (Math.random() < C.STEAL.chance) {
          const key = seed.id + (tile.gold ? '_gold' : '');
          u.crops[key] = (u.crops[key] || 0) + 1;
          setTile(li, k, null);
          giveMail(victim, { subject: '🥷 A crop was stolen!', body: u.name + ' sneaked onto your farm and stole a ripe ' + (tile.gold ? 'golden ' : '') + seed.name + '.', from: 'Farm Watch' });
          const vc = online.get(L.owner); if (vc) { sendMe(vc); send(vc.ws, { t: 'sys', text: '🥷 ' + u.name + ' stole a ' + seed.name + ' from your farm!' }); }
          touch(); sendMe(c); send(ws, { t: 'steal_result', ok: true, seed: seed.id, gold: !!tile.gold, cd: C.STEAL.cooldownMs });
        } else { touch(); send(ws, { t: 'steal_result', ok: false, cd: C.STEAL.cooldownMs }); }
        break;
      }
      case 'send_money': {
        const tk = String(m.to || '').trim().toLowerCase(), tu = db.users[tk];
        if (!tu) return err('No player named "' + String(m.to || '').slice(0, 20) + '".');
        if (tk === c.key) return err('You cannot send money to yourself.');
        const amt = Math.floor(Number(m.amount));
        if (!(amt >= 1)) return err('Enter a whole amount of at least $1.');
        if (Date.now() - (c.lastSend || 0) < 1000) return;
        if (amt > u.money) return err('You only have $' + Math.floor(u.money).toLocaleString() + '.');
        c.lastSend = Date.now(); ensureUser(tu);
        u.money = r2m(u.money - amt); tu.money = r2m(tu.money + amt);
        giveMail(tu, { subject: '💸 You received $' + amt.toLocaleString(), body: u.name + ' sent you $' + amt.toLocaleString() + '.', from: u.name });
        const tc = online.get(tk); if (tc) { sendMe(tc); send(tc.ws, { t: 'sys', text: '💸 ' + u.name + ' sent you $' + amt.toLocaleString() + '!' }); }
        touch(); sendMe(c); ok('Sent $' + amt.toLocaleString() + ' to ' + tu.name + '.');
        break;
      }
      case 'car_buy': {
        const cd = CAR_BY[m.id]; if (!cd) return;
        if (u.cars.includes(cd.id)) return err('You already own the ' + cd.name + '.');
        if (u.money < cd.price) return err('The ' + cd.name + ' costs $' + cd.price.toLocaleString() + '.');
        u.money = r2m(u.money - cd.price); u.cars.push(cd.id); if (!u.car) u.car = cd.id;
        touch(); sendMe(c); playersDirty = true; ok('You bought the ' + cd.name + '! Press C (or the Drive button) to hop in and out.');
        break;
      }
      case 'car_sell': {
        const cd = CAR_BY[m.id]; if (!cd || !u.cars.includes(cd.id)) return;
        u.cars = u.cars.filter(x => x !== cd.id); delete u.carCol[cd.id]; if (u.car === cd.id) u.car = null;
        const got = Math.round(cd.price * C.CAR_SELL_RATE); u.money = r2m(u.money + got);
        touch(); sendMe(c); playersDirty = true; ok('Sold the ' + cd.name + ' for $' + got.toLocaleString() + '.');
        break;
      }
      case 'car_drive': {
        if (m.id == null) u.car = null; else if (u.cars.includes(m.id)) u.car = m.id; else return;
        touch(); sendMe(c); playersDirty = true;
        break;
      }
      case 'car_paint': {
        if (!u.cars.includes(m.id) || !C.CAR_COLORS.includes(m.color)) return;
        u.carCol[m.id] = m.color; touch(); sendMe(c); playersDirty = true;
        break;
      }
      case 'bar_find': {
        const want = m.want === 'husband' ? 'husband' : 'wife';
        if (u.spouse) return err('You are already married to ' + u.spouse.name + '.');
        if (Date.now() - (c.lastBar || 0) < 800) return;
        c.lastBar = Date.now();
        if (u.money < C.BAR.fee) return err('The bar tab is $' + C.BAR.fee.toLocaleString() + '.');
        u.money = r2m(u.money - C.BAR.fee);
        if (Math.random() < C.BAR.chance) {
          const names = C.SPOUSE_NAMES[want], g = want === 'wife' ? 'f' : 'm', looks = g === 'f' ? [1, 3, 4, 7, 9] : [0, 2, 5, 6, 8];
          u.spouse = { name: names[Math.floor(Math.random() * names.length)], gender: g, look: looks[Math.floor(Math.random() * looks.length)], since: Date.now() };
          touch(); sendMe(c); playersDirty = true;
          send(ws, { t: 'bar_result', ok: true, want, spouse: u.spouse });
        } else {
          touch(); sendMe(c);
          send(ws, { t: 'bar_result', ok: false, want, line: ['They finished the drink and left without a word...', 'Not your type, they said, and wandered off.', 'They laughed, tipped their hat and walked out.', 'Someone else caught their eye. Better luck next time!'][Math.floor(Math.random() * 4)] });
        }
        break;
      }
      case 'bar_divorce': {
        if (!u.spouse) return;
        if (u.money < C.BAR.divorce) return err('The lawyer wants $' + C.BAR.divorce.toLocaleString() + '.');
        u.money = r2m(u.money - C.BAR.divorce); const nm = u.spouse.name; u.spouse = null;
        touch(); sendMe(c); playersDirty = true; ok('You and ' + nm + ' parted ways.');
        break;
      }
      case 'invest_open': { send(ws, { t: 'market_hist', hist: Object.fromEntries(Object.entries(mkt).map(([k, v]) => [k, v.hist.slice(-120)])), open: Object.fromEntries(Object.entries(mkt).map(([k, v]) => [k, v.open])) }); sendMe(c); break; }
      case 'invest_buy': {
        const a = mkt[m.sym]; if (!a) return;
        let amt = r2m(Number(m.amount)); if (m.amount === 'all') amt = r2m(u.money);
        if (!(amt >= 1)) return err('Invest at least $1.');
        if (amt > u.money + 0.001) return err('You only have $' + u.money.toLocaleString() + '.');
        const units = Math.floor(amt * (1 - C.INVEST_FEE) / a.price * 1e8) / 1e8;
        if (!(units > 0)) return err('Amount too small.');
        u.money = r2m(u.money - amt);
        const hd = u.invest[m.sym] || (u.invest[m.sym] = { units: 0, cost: 0 }); hd.units += units; hd.cost += amt;
        touch(); sendMe(c); ok('Bought ' + (units < 1 ? units.toFixed(6) : units.toFixed(4)) + ' ' + m.sym + ' for $' + amt.toLocaleString() + '.');
        break;
      }
      case 'invest_sell': {
        const a = mkt[m.sym], hd = u.invest[m.sym]; if (!a || !hd || !(hd.units > 0)) return err('You do not own any ' + m.sym + '.');
        let units = m.units === 'all' ? hd.units : Math.min(hd.units, Number(m.units));
        if (!(units > 0)) return err('Nothing to sell.');
        const got = r2m(units * a.price * (1 - C.INVEST_FEE)), frac = units / hd.units;
        hd.cost = hd.cost * (1 - frac); hd.units -= units;
        if (hd.units < 1e-9) delete u.invest[m.sym];
        u.money = r2m(u.money + got);
        touch(); sendMe(c); ok('Sold ' + m.sym + ' for $' + got.toLocaleString() + '.');
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
    if (c && c.pvp) { const { pv, S } = c.pvp, O = S === 'A' ? 'B' : 'A', r = Battle.pvpForfeit(pv, S), opp = pv.players[O]; if (opp && opp.pvp && opp.pvp.pv === pv) send(opp.ws, { t: 'mb_turn', events: Battle.pvpFlip(r.events || [], O), view: Battle.pvpView(pv, O) }); pvpEnd(c); }
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


setInterval(() => {
  marketTick();
  broadcast({ t: 'market', p: Object.fromEntries(Object.entries(mkt).map(([k, v]) => [k, Math.round(v.price * 100) / 100])) });
}, 1000);

(async () => {
  if (useUpstash) { await loadFromUpstash(); console.log('Using Upstash Redis for storage'); }
  server.listen(PORT, () => console.log('Sunny Lots running on :' + PORT + ' (growth speed x' + SPEED + ')'));
})().catch(e => { console.error('startup failed:', e.message); process.exit(1); });
