'use strict';
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./catalog');

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
function worldBlocked(wx, wy) {
  if (wx < 0 || wy < 0 || wx >= C.WORLD.width || wy >= C.WORLD.height) return true;
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
  if (!u.animals) u.animals = { chicken: 0, cow: 0, sheep: 0 };
  if (!u.products) u.products = {};
  if (!u.pets) u.pets = [];
  if (!u.bushAt) u.bushAt = {};
  if (!u.stallAt) u.stallAt = {};
  if (!u.animalAt) u.animalAt = { egg: 0, milkCow: 0, milkSheep: 0 };
  if (u.expandLand === undefined) u.expandLand = null;
  if (u.houseLand === undefined) u.houseLand = null;
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
    SQUARE_COST: C.SQUARE_COST, SQUARE_MAX: C.SQUARE_MAX, TAP_MIN: C.TAP_MIN, TAP_MAX: C.TAP_MAX,
    ANIMALS: C.ANIMALS, PETS: C.PETS, PRODUCTS: C.PRODUCTS,
    MINIGAMES: C.MINIGAMES, BUSH_DROP: C.BUSH_DROP, BUSH_CD: C.BUSH_CD,
  });
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
  stallAt: u.stallAt, animalAt: u.animalAt, bushAt: u.bushAt,
});
const ownsLand = (u, i) => u.land === i || u.expandLand === i || u.houseLand === i;
const sendMe = c => send(c.ws, { t: 'me', me: meView(c.u) });
const playerList = () => [...online.values()].map(c => ({ n: c.u.name, x: Math.round(c.x), y: Math.round(c.y), a: c.u.avatar }));
const landView = l => ({
  owner: l.owner ? db.users[l.owner].name : null,
  tiles: l.tiles,
  extra: l.extra || {},
  stats: l.stats || { harvested: 0, growTime: 0, value: 0 },
});
const growMs = seed => seed.hours * 3600000 / SPEED;
const ownsCloth = (u, id) => {
  if (!id) return true;
  const cl = C.CLOTH_BY[id];
  if (!cl) return false;
  if (cl.buyable === false) return u.clothes.includes(id);
  return cl.price === 0 || u.clothes.includes(id);
};

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
        c.x = Math.max(8, Math.min(WORLD_W - 8, m.x));
        c.y = Math.max(8, Math.min(WORLD_H - 8, m.y));
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
      case 'claim': {
        const i = m.land;
        if (!Number.isInteger(i) || i < 0 || i >= db.lands.length) return;
        if (db.lands[i].owner) return err('That land is already claimed.');
        const meta = C.WORLD.lands[i] || {};
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
        if (u.money < C.SQUARE_COST) return err('Need $' + C.SQUARE_COST + ' per square.');
        u.money -= C.SQUARE_COST;
        L.extra[rx + ',' + ry] = 1;
        touch();
        broadcast({ t: 'land_extra', land: li, extra: L.extra });
        sendMe(c);
        ok('Expanded your land by 1 square!');
        break;
      }
      case 'place': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return err('You can only decorate your own land.');
        const k = m.tx + ',' + m.ty;
        if (actLand.tiles[k]) return err('That spot is taken.');
        if (!C.FURN_BY[m.furn] || !(u.furniture[m.furn] > 0)) return err("You don't own that.");
        u.furniture[m.furn]--; if (!u.furniture[m.furn]) delete u.furniture[m.furn];
        setTile(landIdx, k, { type: 'furn', id: m.furn });
        sendMe(c);
        break;
      }
      case 'pickup': {
        if (!actLand || !tileOK || !ownsLand(u, landIdx)) return;
        const k = m.tx + ',' + m.ty, tile = actLand.tiles[k];
        if (!tile || tile.type !== 'furn') return;
        u.furniture[tile.id] = (u.furniture[tile.id] || 0) + 1;
        setTile(landIdx, k, null);
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
          u.money -= a.buy; u.animals[m.id] = (u.animals[m.id] || 0) + 1;
          if (m.id === 'chicken' && !u.animalAt.egg) u.animalAt.egg = Date.now();
        } else if (m.kind === 'pet') {
          const p = C.PET_BY[m.id]; if (!p || u.pets.includes(p.id)) return;
          if (u.money < p.price) return err('Not enough money.');
          u.money -= p.price; u.pets.push(p.id);
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
        const meatN = kind === 'chicken' ? 1 : 2;
        addProduct('meat', meatN);
        if (kind === 'sheep') addProduct('wool', 1);
        touch(); sendMe(c);
        ok('Processed 1 ' + a.name.toLowerCase() + ' → meat' + (kind === 'sheep' ? ' + wool' : ''));
        break;
      }
      case 'milk': {
        const kind = m.id === 'cow' ? 'cow' : 'sheep';
        const a = C.ANIMALS[kind];
        if (!(u.animals[kind] > 0)) return err('You need a ' + a.name + ' first.');
        const key = kind === 'cow' ? 'milkCow' : 'milkSheep';
        const last = u.animalAt[key] || 0;
        if (Date.now() - last < a.milkCd * 1000) return err('Already milked recently.');
        if (!m.ok) return err('Finish the milking mini-game!');
        u.animalAt[key] = Date.now();
        addProduct('milk', 1);
        if (kind === 'sheep' && Math.random() < 0.35) addProduct('wool', 1);
        touch(); sendMe(c);
        ok('Got fresh milk' + (kind === 'sheep' ? ' (maybe wool too!)' : '') + '!');
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
