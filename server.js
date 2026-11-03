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
for (let i = 0; i < C.WORLD.landCount; i++) if (!db.lands[i]) db.lands[i] = { owner: null, tiles: {} };
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
  for (let i = 0; i < C.WORLD.landCount; i++) if (!db.lands[i]) db.lands[i] = { owner: null, tiles: {} };
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
    SEEDS: C.SEEDS, FURNITURE: C.FURNITURE, CLOTHES: C.CLOTHES, SKINS: C.SKINS, HAIRS: C.HAIRS,
    DEFAULT_AVATAR: C.DEFAULT_AVATAR, WORLD: C.WORLD, SHAPE_IDS: C.SHAPE_IDS, GOLD_MULT: C.GOLD_MULT,
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
  db.users[key] = {
    name, salt, hash: hashPw(password, salt), created: Date.now(),
    money: C.START_MONEY, seeds: {}, crops: {}, furniture: {}, clothes: [],
    avatar: { ...C.DEFAULT_AVATAR }, land: null, charDone: false,
  };
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
  clothes: u.clothes, avatar: u.avatar, land: u.land, charDone: u.charDone,
});
const sendMe = c => send(c.ws, { t: 'me', me: meView(c.u) });
const playerList = () => [...online.values()].map(c => ({ n: c.u.name, x: Math.round(c.x), y: Math.round(c.y), a: c.u.avatar }));
const landView = l => ({ owner: l.owner ? db.users[l.owner].name : null, tiles: l.tiles });
const growMs = seed => seed.hours * 3600000 / SPEED;
const ownsCloth = (u, id) => !id || C.CLOTH_BY[id]?.price === 0 || u.clothes.includes(id);

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
    const tileOK = Number.isInteger(m.tx) && Number.isInteger(m.ty) && m.tx >= 0 && m.ty >= 0 && m.tx < C.WORLD.landSize && m.ty < C.WORLD.landSize;
    const myLand = u.land != null ? db.lands[u.land] : null;
    const setTile = (key, tile) => {
      if (tile) myLand.tiles[key] = tile; else delete myLand.tiles[key];
      touch();
      broadcast({ t: 'tile', land: u.land, key, tile: tile || null });
    };

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
        if (u.land != null) return err('You already own a land.');
        if (db.lands[i].owner) return err('That land is already claimed.');
        db.lands[i].owner = c.key; u.land = i; touch();
        broadcast({ t: 'owner', land: i, owner: u.name });
        sendMe(c);
        ok('Land ' + (i + 1) + ' is yours!');
        break;
      }
      case 'plant': {
        if (!myLand || !tileOK) return err('You can only plant on your own land.');
        const k = m.tx + ',' + m.ty;
        if (myLand.tiles[k]) return err('That spot is taken.');
        const seed = C.SEED_BY[m.seed];
        if (!seed || !(u.seeds[seed.id] > 0)) return err('You have no ' + (seed ? seed.name : 'such') + ' seeds.');
        u.seeds[seed.id]--; if (!u.seeds[seed.id]) delete u.seeds[seed.id];
        setTile(k, { type: 'plant', seed: seed.id, at: Date.now(), gold: Math.random() < C.GOLD_CHANCE });
        sendMe(c);
        break;
      }
      case 'harvest': {
        if (!myLand || !tileOK) return err('You can only harvest on your own land.');
        const k = m.tx + ',' + m.ty, tile = myLand.tiles[k];
        if (!tile || tile.type !== 'plant') return;
        const seed = C.SEED_BY[tile.seed];
        if (Date.now() < tile.at + growMs(seed)) return err('Not ready yet.');
        const key = seed.id + (tile.gold ? '_gold' : '');
        u.crops[key] = (u.crops[key] || 0) + 1;
        setTile(k, null);
        sendMe(c);
        send(ws, { t: 'harvested', seed: seed.id, gold: !!tile.gold });
        break;
      }
      case 'place': {
        if (!myLand || !tileOK) return err('You can only decorate your own land.');
        const k = m.tx + ',' + m.ty;
        if (myLand.tiles[k]) return err('That spot is taken.');
        if (!C.FURN_BY[m.furn] || !(u.furniture[m.furn] > 0)) return err("You don't own that.");
        u.furniture[m.furn]--; if (!u.furniture[m.furn]) delete u.furniture[m.furn];
        setTile(k, { type: 'furn', id: m.furn });
        sendMe(c);
        break;
      }
      case 'pickup': {
        if (!myLand || !tileOK) return;
        const k = m.tx + ',' + m.ty, tile = myLand.tiles[k];
        if (!tile || tile.type !== 'furn') return;
        u.furniture[tile.id] = (u.furniture[tile.id] || 0) + 1;
        setTile(k, null);
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
          const f = C.FURN_BY[m.id]; if (!f) return;
          if (u.money < f.price * qty) return err('Not enough money.');
          u.money -= f.price * qty; u.furniture[f.id] = (u.furniture[f.id] || 0) + qty;
        } else if (m.kind === 'cloth') {
          const cl = C.CLOTH_BY[m.id]; if (!cl || cl.price === 0 || u.clothes.includes(cl.id)) return;
          if (u.money < cl.price) return err('Not enough money.');
          u.money -= cl.price; u.clothes.push(cl.id);
        } else return;
        touch(); sendMe(c);
        break;
      }
      case 'sell': {
        const sell = key => {
          const n = u.crops[key] || 0; if (!n) return 0;
          const seed = C.SEED_BY[key.replace('_gold', '')]; if (!seed) return 0;
          return n * seed.sell * (key.endsWith('_gold') ? C.GOLD_MULT : 1);
        };
        let gain = 0;
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
        if (!gain) return;
        u.money += gain; touch(); sendMe(c);
        ok('Sold for $' + gain.toLocaleString());
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
