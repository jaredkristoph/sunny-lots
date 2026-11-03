'use strict';
(async function () {
  const $ = s => document.querySelector(s);
  const cat = await (await fetch('/api/catalog')).json();
  cat.SEED_BY = Object.fromEntries(cat.SEEDS.map(s => [s.id, s]));
  cat.FURN_BY = Object.fromEntries(cat.FURNITURE.map(s => [s.id, s]));
  cat.CLOTH = Object.fromEntries(cat.CLOTHES.map(s => [s.id, s]));
  const WD = cat.WORLD, TILE = WD.tile, LS = WD.landSize;           // TILE = server px per tile
  const money = n => '$' + Number(n).toLocaleString();
  const PI = Math.PI;
  const fpsiFor = yaw => Math.floor((yaw + PI) / (PI / 2) + .5) * PI / 2;   // furniture always faces the camera (snapped to 90°)

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e[k] = v;
      else if (v === false || v == null) { /* skip */ }
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
  }

  // ---------- state ----------
  let token = localStorage.getItem('sl_token');
  let ws = null, me = null, lands = [], players = {}, myName = '', SPEED = 1, clockOff = 0, loggedOut = false;
  const self = { x: 0, y: 0, psi: 0, walk: 0, say: null };           // x,y in server px (48 per tile)
  const keys = new Set();
  let started = false, lastSent = 0, sentX = -1, sentY = -1, hoverTile = null;
  const now = () => Date.now() + clockOff;
  const growMs = sd => sd.hours * 3600000 / SPEED;

  // ---------- icons (rendered from the same voxel models) ----------
  const iconCache = {};
  const iconURL = (key, fn) => iconCache[key] || (iconCache[key] = fn().toDataURL());
  const plantIcon = (sd, gold) => h('img', { src: iconURL('p' + sd.id + gold, () => Vox.renderIcon(Vox.plantBoxes(sd, 3, gold), { w: 64, h: 64, ppt: 48, hcf: .86 })) });
  const furnIcon = f => h('img', { src: iconURL('f' + f.id, () => { const m = Vox.furnModel(f); return Vox.renderIcon(m.boxes.concat(m.dyn ? m.dyn(.5) : []), { w: 64, h: 64, ppt: 46, psi: fpsiFor(.78), hcf: .86 }); }) });
  function clothIcon(it) {
    const a = { ...me.avatar, [it.slot]: it.id };
    return h('img', { src: iconURL('c' + it.id + a.gender + a.skin + a.hairColor, () => Vox.renderIcon(Vox.charBoxes(a, cat, 0, false), { w: 56, h: 72, ppt: 50, psi: .78 + PI, hcf: .9 })), style: 'height:72px' });
  }

  // ---------- modal system ----------
  let modalRefresh = null, modalClose = null, modalLocked = false;
  function openModal(title, build, opts = {}) {
    closeModal();
    const ov = $('#overlay'); ov.hidden = false; ov.innerHTML = '';
    const body = h('div', { class: 'mbody' });
    ov.append(h('div', { class: 'modal' }, h('div', { class: 'mhead' }, h('b', {}, title), opts.locked ? null : h('button', { class: 'x', onclick: () => closeModal() }, '✕')), body));
    modalLocked = !!opts.locked;
    modalRefresh = () => { const sc = body.scrollTop; body.replaceChildren(build()); body.scrollTop = sc; };
    modalRefresh();
  }
  function closeModal() {
    if (modalClose) { try { modalClose(); } catch (e) { /* ignore */ } }
    modalClose = null; modalRefresh = null; modalLocked = false;
    $('#overlay').hidden = true; $('#overlay').innerHTML = '';
  }
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay' && !modalLocked) closeModal(); });
  const modalOpen = () => !$('#overlay').hidden;
  function tabs(list, cur, set) {
    return h('div', { class: 'tabs' }, list.map(([id, label]) => h('button', { class: 'tab' + (id === cur ? ' on' : ''), onclick: () => { set(id); modalRefresh(); } }, label)));
  }

  // ---------- networking ----------
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => send({ t: 'auth', token });
    ws.onmessage = e => onMsg(JSON.parse(e.data));
    ws.onclose = () => { if (!loggedOut && token) { toast('Reconnecting…', true); setTimeout(connect, 2000); } };
  }
  function upsert(p) {
    if (p.n === myName) return;
    const o = players[p.n];
    if (!o) players[p.n] = { n: p.n, x: p.x, y: p.y, rx: p.x, ry: p.y, a: p.a, psi: view.yaw + PI, walk: 0, say: null };
    else { o.x = p.x; o.y = p.y; o.a = p.a; }
  }
  function onMsg(m) {
    switch (m.t) {
      case 'authfail': logout(); toast('Please log in again.', true); break;
      case 'init':
        me = m.me; myName = me.name; lands = m.lands; SPEED = m.speed; clockOff = m.now - Date.now();
        self.x = m.pos.x; self.y = m.pos.y; self.psi = view.yaw + PI; view.fx = self.x / TILE; view.fz = self.y / TILE;
        players = {}; m.players.forEach(upsert);
        $('#chatlog').innerHTML = ''; m.chat.forEach(addChat);
        $('#hud').hidden = false; $('#chat').hidden = false; $('#auth-root') && $('#auth-root').remove();
        closeModal(); updateHud(); started = true;
        if (!me.charDone) openCreator();
        break;
      case 'me': me = m.me; updateHud(); if (modalRefresh) modalRefresh(); break;
      case 'players': {
        const seen = new Set(m.list.map(p => p.n));
        m.list.forEach(upsert);
        for (const n in players) if (!seen.has(n)) delete players[n];
        break;
      }
      case 'tile':
        if (m.tile) lands[m.land].tiles[m.key] = m.tile; else delete lands[m.land].tiles[m.key];
        if (modalRefresh && !m.tile) modalRefresh();
        break;
      case 'owner': lands[m.land].owner = m.owner; break;
      case 'chat': addChat(m); if (m.n === myName) self.say = { text: m.text, until: Date.now() + 6000 }; else if (players[m.n]) players[m.n].say = { text: m.text, until: Date.now() + 6000 }; break;
      case 'sys': addChat({ sys: true, text: m.text }); break;
      case 'err': toast(m.msg, true); break;
      case 'ok': toast(m.msg); break;
      case 'harvested': {
        const sd = cat.SEED_BY[m.seed];
        toast(m.gold ? '✨ Golden ' + sd.name + '! Worth triple!' : 'Harvested ' + sd.name);
        break;
      }
    }
  }
  function addChat(m) {
    const log = $('#chatlog');
    log.append(m.sys ? h('div', {}, h('i', {}, m.text)) : h('div', {}, h('b', {}, m.n + ': '), m.text));
    log.scrollTop = 1e9;
  }
  function updateHud() { $('#hud-name').textContent = '👤 ' + me.name; $('#hud-money').textContent = '💰 ' + money(me.money); }

  // ---------- auth screens ----------
  function authScreen() {
    const root = h('div', { id: 'auth-root', style: 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:30;background:linear-gradient(#9fe0ff,#bff0a8)' });
    let mode = 'create', msg = '';
    const render = () => {
      const user = h('input', { class: 'txt', placeholder: 'Username (3-16 letters/numbers)', maxlength: 16, autocomplete: 'username' });
      const pass = h('input', { class: 'txt', placeholder: 'Password', autocomplete: 'current-password' });
      const err = h('div', { class: 'muted', style: 'color:#b5432f;min-height:16px' }, msg);
      const go = async () => {
        const u = user.value.trim();
        const r = await fetch(mode === 'create' ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pass.value }) });
        const j = await r.json();
        if (!r.ok) { msg = j.error; render(); return; }
        if (mode === 'create') showPassword(j); else { token = j.token; localStorage.setItem('sl_token', token); loggedOut = false; connect(); }
      };
      user.onkeydown = pass.onkeydown = e => { if (e.key === 'Enter') go(); };
      root.replaceChildren(h('div', { class: 'modal', style: 'width:min(420px,92vw)' },
        h('div', { class: 'mhead' }, h('b', {}, '🌻 Sunny Lots')),
        h('div', { class: 'mbody center' },
          h('div', { class: 'muted' }, 'A chill little neighborhood where plants grow in real time.'),
          h('div', { class: 'tabs' }, h('button', { class: 'tab' + (mode === 'create' ? ' on' : ''), onclick: () => { mode = 'create'; msg = ''; render(); } }, 'New player'), h('button', { class: 'tab' + (mode === 'login' ? ' on' : ''), onclick: () => { mode = 'login'; msg = ''; render(); } }, 'I have an account')),
          user, mode === 'login' ? pass : h('div', { class: 'muted' }, 'Pick a username — we will generate your password for you.'), err,
          h('button', { class: 'btn green', onclick: go }, mode === 'create' ? 'Create account' : 'Log in'))));
    };
    const showPassword = j => {
      root.replaceChildren(h('div', { class: 'modal', style: 'width:min(440px,92vw)' },
        h('div', { class: 'mhead' }, h('b', {}, 'Welcome, ' + j.username + '!')),
        h('div', { class: 'mbody center' },
          h('div', {}, 'This is your password. Write it down — it is only shown once and cannot be recovered.'),
          h('div', { class: 'pw' }, j.password),
          h('button', { class: 'btn sm', onclick: e => { navigator.clipboard && navigator.clipboard.writeText(j.password); e.target.textContent = 'Copied!'; } }, 'Copy'),
          h('button', { class: 'btn green', onclick: () => { token = j.token; localStorage.setItem('sl_token', token); loggedOut = false; connect(); } }, "I saved it — let's go!"))));
    };
    render(); document.body.append(root);
  }
  function logout() {
    loggedOut = true; token = null; localStorage.removeItem('sl_token'); started = false;
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    $('#hud').hidden = true; $('#chat').hidden = true; closeModal();
    if (!$('#auth-root')) authScreen();
  }
  $('#b-out').onclick = logout;

  // ---------- avatar editor / wardrobe ----------
  function avatarPreview() {
    const c = Vox.renderIcon(Vox.charBoxes(me.avatar, cat, 0, false), { w: 64, h: 84, ppt: 60, psi: .78 + PI, hcf: .92 });
    c.style.cssText = 'width:192px;height:252px;image-rendering:pixelated;background:linear-gradient(#cfeeff,#d8f5c4);border-radius:14px;border:2px solid #b8862b';
    return c;
  }
  function look() {
    const a = me.avatar;
    return h('div', { class: 'center' },
      avatarPreview(),
      h('div', { class: 'row' }, ['male', 'female'].map(g => h('button', { class: 'tab' + (a.gender === g ? ' on' : ''), onclick: () => send({ t: 'avatar', gender: g }) }, g === 'male' ? '♂ Male' : '♀ Female'))),
      h('div', { class: 'muted' }, 'Skin color'),
      h('div', { class: 'row' }, cat.SKINS.map(c => h('div', { class: 'sw' + (a.skin === c ? ' on' : ''), style: 'background:' + c, onclick: () => send({ t: 'avatar', skin: c }) }))),
      h('div', { class: 'muted' }, 'Hair color'),
      h('div', { class: 'row', style: 'justify-content:center' }, cat.HAIRS.map(c => h('div', { class: 'sw' + (a.hairColor === c ? ' on' : ''), style: 'background:' + c, onclick: () => send({ t: 'avatar', hairColor: c }) }))));
  }
  const owns = it => it.price === 0 || me.clothes.includes(it.id);
  function openCreator() {
    openModal('Create your character', () => h('div', { class: 'center' }, look(),
      h('div', { class: 'muted' }, 'You start with plain free clothes. Earn money and buy more at the shop! You can change all of this any time.'),
      h('button', { class: 'btn green', onclick: () => { send({ t: 'avatar', done: true }); closeModal(); toast('Click a land to claim it, then buy seeds at the shop 🏪'); } }, 'Start playing')), { locked: true });
  }
  function openWardrobe() {
    const slots = [['top', 'Tops'], ['bottom', 'Bottoms'], ['hat', 'Hats'], ['shoes', 'Shoes']];
    let tab = 'look';
    openModal('👕 Wardrobe', () => {
      const body = h('div', {}, tabs([['look', 'Body'], ...slots], tab, t => { tab = t; }));
      if (tab === 'look') { body.append(look()); return body; }
      const items = cat.CLOTHES.filter(c => c.slot === tab && owns(c));
      const grid = h('div', { class: 'grid' });
      if (tab === 'hat') grid.append(h('div', { class: 'item' + (!me.avatar.hat ? ' own' : ''), onclick: () => send({ t: 'avatar', hat: '' }), style: 'cursor:pointer' }, h('div', { style: 'font-size:34px' }, '🚫'), h('div', { class: 'nm' }, 'No hat')));
      items.forEach(it => grid.append(h('div', { class: 'item' + (me.avatar[tab] === it.id ? ' own' : ''), style: 'cursor:pointer', onclick: () => send({ t: 'avatar', [tab]: it.id }) }, clothIcon(it), h('div', { class: 'nm' }, it.name), h('div', { class: 'muted' }, me.avatar[tab] === it.id ? 'Wearing' : 'Tap to wear'))));
      body.append(grid, h('div', { class: 'muted', style: 'margin-top:8px' }, 'More outfits are sold at the shop.'));
      return body;
    });
  }
  $('#b-ward').onclick = () => me && openWardrobe();

  // ---------- bag ----------
  function fmtHours(hh) { return hh < 1 ? Math.round(hh * 60) + ' min' : (Number.isInteger(hh) ? hh : hh.toFixed(1)) + ' hr'; }
  function fmtLeft(ms) { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + 'h ' : '') + (hh || mm ? mm + 'm ' : '') + ss + 's'; }
  function openBag() {
    openModal('🎒 Bag', () => {
      const b = h('div', {}, h('div', { style: 'font-size:18px;margin-bottom:8px' }, '💰 ' + money(me.money)));
      const sec = (title, rows) => { b.append(h('b', {}, title)); b.append(rows.length ? h('div', { class: 'list', style: 'margin:6px 0 12px' }, rows) : h('div', { class: 'muted', style: 'margin:4px 0 12px' }, 'Nothing yet')); };
      sec('Seeds', Object.entries(me.seeds).map(([id, n]) => { const sd = cat.SEED_BY[id]; return h('div', { class: 'lrow' }, plantIcon(sd, false), h('div', { class: 'grow' }, h('b', {}, sd.name), h('div', { class: 'muted' }, 'Grows in ' + fmtHours(sd.hours))), '×' + n); }));
      sec('Harvested crops', Object.entries(me.crops).map(([k, n]) => { const gold = k.endsWith('_gold'), sd = cat.SEED_BY[k.replace('_gold', '')]; return h('div', { class: 'lrow' }, plantIcon(sd, gold), h('div', { class: 'grow' }, h('b', { class: gold ? 'gold' : '' }, (gold ? '✨ Golden ' : '') + sd.name), h('div', { class: 'muted' }, money(sd.sell * (gold ? cat.GOLD_MULT : 1)) + ' each')), '×' + n); }));
      sec('Furniture', Object.entries(me.furniture).map(([id, n]) => { const f = cat.FURN_BY[id]; return h('div', { class: 'lrow' }, furnIcon(f), h('div', { class: 'grow' }, h('b', {}, f.name)), '×' + n); }));
      b.append(h('div', { class: 'muted' }, 'Sell crops at the shop. Place furniture by clicking an empty tile on your land.'));
      return b;
    });
  }
  $('#b-bag').onclick = () => me && openBag();

  // ---------- shop ----------
  const shopRect = { x0: WD.shop.x * TILE, y0: WD.shop.y * TILE, x1: (WD.shop.x + WD.shop.w) * TILE, y1: (WD.shop.y + WD.shop.h) * TILE };
  const nearShop = () => Math.hypot(self.x - WD.shopDoor.x * TILE, self.y - WD.shopDoor.y * TILE) < 4.5 * TILE;
  function openShop() {
    let tab = 'sell', fShape = 'all', cSlot = 'all';
    openModal('🏪 Sunny Shop', () => {
      const b = h('div', {}, h('div', { style: 'margin-bottom:8px;font-weight:700' }, '💰 ' + money(me.money)),
        tabs([['sell', 'Sell crops'], ['seeds', 'Seeds'], ['furn', 'Furniture'], ['cloth', 'Clothes']], tab, t => { tab = t; }));
      if (tab === 'sell') {
        const ent = Object.entries(me.crops);
        if (!ent.length) { b.append(h('div', { class: 'muted' }, 'You have no crops to sell. Plant some seeds and come back when they are ready!')); return b; }
        let total = 0;
        const list = h('div', { class: 'list' });
        ent.forEach(([k, n]) => {
          const gold = k.endsWith('_gold'), sd = cat.SEED_BY[k.replace('_gold', '')], each = sd.sell * (gold ? cat.GOLD_MULT : 1); total += each * n;
          list.append(h('div', { class: 'lrow' }, plantIcon(sd, gold), h('div', { class: 'grow' }, h('b', { class: gold ? 'gold' : '' }, (gold ? '✨ Golden ' : '') + sd.name), h('div', { class: 'muted' }, money(each) + ' each · you have ' + n)),
            h('button', { class: 'btn sm', onclick: () => send({ t: 'sell', key: k, qty: 1 }) }, 'Sell 1'), h('button', { class: 'btn sm green', onclick: () => send({ t: 'sell', key: k, qty: 'all' }) }, 'Sell all ' + money(each * n))));
        });
        b.append(list, h('button', { class: 'btn green', onclick: () => send({ t: 'sell', key: '*' }) }, 'Sell everything — ' + money(total)));
      } else if (tab === 'seeds') {
        const g = h('div', { class: 'grid' });
        cat.SEEDS.forEach(sd => g.append(h('div', { class: 'item' }, plantIcon(sd, false), h('div', { class: 'nm' }, sd.name), h('div', { class: 'muted' }, 'Grows ' + fmtHours(sd.hours) + ' · sells ' + money(sd.sell)), h('div', { class: 'muted' }, 'Have ' + (me.seeds[sd.id] || 0)),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: me.money < sd.cost, onclick: () => send({ t: 'buy', kind: 'seed', id: sd.id, qty: 1 }) }, money(sd.cost)), h('button', { class: 'btn sm', disabled: me.money < sd.cost * 5, onclick: () => send({ t: 'buy', kind: 'seed', id: sd.id, qty: 5 }) }, '×5')))));
        b.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, '✨ Every planting has a 2% chance of turning golden — sells for triple!'), g);
      } else if (tab === 'furn') {
        const sel = h('select', { onchange: e => { fShape = e.target.value; modalRefresh(); } }, h('option', { value: 'all' }, 'All types'), cat.SHAPE_IDS.map(s => h('option', { value: s, selected: s === fShape }, s)));
        const g = h('div', { class: 'grid' });
        cat.FURNITURE.filter(f => fShape === 'all' || f.shape === fShape).forEach(f => g.append(h('div', { class: 'item' }, furnIcon(f), h('div', { class: 'nm' }, f.name), h('div', { class: 'muted' }, 'Have ' + (me.furniture[f.id] || 0)), h('button', { class: 'btn sm', disabled: me.money < f.price, onclick: () => send({ t: 'buy', kind: 'furn', id: f.id, qty: 1 }) }, money(f.price)))));
        b.append(h('div', { style: 'margin-bottom:8px' }, sel), g);
      } else {
        const sel = h('select', { onchange: e => { cSlot = e.target.value; modalRefresh(); } }, [['all', 'All'], ['top', 'Tops'], ['bottom', 'Bottoms'], ['hat', 'Hats'], ['shoes', 'Shoes']].map(([v, l]) => h('option', { value: v, selected: v === cSlot }, l)));
        const g = h('div', { class: 'grid' });
        cat.CLOTHES.filter(c => c.price > 0 && (cSlot === 'all' || c.slot === cSlot)).forEach(it => g.append(h('div', { class: 'item' + (owns(it) ? ' own' : '') }, clothIcon(it), h('div', { class: 'nm' }, it.name),
          owns(it) ? h('div', { class: 'muted' }, 'Owned ✓') : h('button', { class: 'btn sm', disabled: me.money < it.price, onclick: () => send({ t: 'buy', kind: 'cloth', id: it.id }) }, money(it.price)))));
        b.append(h('div', { style: 'margin-bottom:8px' }, sel), g, h('div', { class: 'muted', style: 'margin-top:8px' }, 'Wear what you buy from the 👕 Wardrobe.'));
      }
      return b;
    });
  }
  function tryShop() { if (!me) return; if (nearShop()) openShop(); else toast('Walk to the shop building in the middle of the map, or press 🏪 to go there.', true); }
  $('#b-shop').onclick = () => { if (!me) return; self.x = WD.shopDoor.x * TILE; self.y = WD.shopDoor.y * TILE + 6; openShop(); };
  $('#b-home').onclick = () => {
    if (!me) return;
    if (me.land == null) return toast('Claim a land first — click an empty land.', true);
    const o = WD.lands[me.land]; self.x = (o.x + 4) * TILE; self.y = (o.y + 8.6) * TILE;
  };

  // ---------- 3D view ----------
  const cv = $('#game'), lab = $('#labels'), lctx = lab.getContext('2d');
  const view = new Vox.View(cv);
  let PIX = 2, zoom = 30, yawT = view.yaw, mouse = { x: 0, y: 0 };
  const scaleX = () => innerWidth / cv.width, scaleY = () => innerHeight / cv.height;
  const toBuf = (cx, cy) => [cx / scaleX(), cy / scaleY()];
  const toPage = (X, Y, Z) => { const s = view.toScreen(X, Y, Z); return [s[0] * scaleX(), s[1] * scaleY(), s[2]]; };

  // land lookup (tile coordinates)
  function landAt(tx, tz) {
    tx = Math.floor(tx); tz = Math.floor(tz);
    for (let i = 0; i < WD.lands.length; i++) { const o = WD.lands[i]; if (tx >= o.x && tx < o.x + LS && tz >= o.y && tz < o.y + LS) return { i, lx: tx - o.x, ly: tz - o.y }; }
    return null;
  }
  const landGrid = Array.from({ length: WD.height }, () => new Array(WD.width).fill(-1));
  WD.lands.forEach((o, i) => { for (let y = 0; y < LS; y++) for (let x = 0; x < LS; x++) landGrid[o.y + y][o.x + x] = i; });
  const isMargin = (tx, ty) => tx < 2 || ty < 2 || tx >= WD.width - 2 || ty >= WD.height - 2;
  const blocked = (x, y) => x > shopRect.x0 - 8 && x < shopRect.x1 + 8 && y > shopRect.y0 + 4 && y < shopRect.y1 + 2;

  // static scenery (built once from boxes)
  const statics = [];
  const piece = (B, x, z, r) => statics.push({ B, x, z, r: r || 1 });
  for (let ty = 0; ty < WD.height; ty++) for (let tx = 0; tx < WD.width; tx++) {
    if (isMargin(tx, ty) && ((tx * 7 + ty * 13) % 5 === 0)) {
      const B = Vox.mk(), v = (tx * 3 + ty) % 3, hgt = .5 + v * .12;
      B.add(0, 0, 0, .2, hgt, .2, '#7a5230').add(0, hgt - .1, 0, .76, .36, .76, '#3f9a45').add(0, hgt + .2, 0, .54, .3, .54, '#4fae44').add(0, hgt + .45, 0, .3, .22, .3, '#5bbd5c');
      piece(B, tx + .5, ty + .5, 1.3);
    } else if (isMargin(tx, ty) && ((tx * 5 + ty * 11) % 7 === 0)) {
      const B = Vox.mk(); B.add(0, 0, 0, .34, .22, .34, '#4fae44').add(.08, .1, .05, .16, .2, .16, '#e84393'); piece(B, tx + .5, ty + .5, .6);
    }
  }
  WD.lands.forEach(o => {
    for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) {
      const edges = []; if (ly === 0) edges.push('n'); if (ly === LS - 1) edges.push('s'); if (lx === 0) edges.push('w'); if (lx === LS - 1) edges.push('e');
      if (!edges.length) continue;
      const B = Vox.mk();
      edges.forEach(e => {
        if (e === 'n' || e === 's') { const z = e === 'n' ? -.5 : .5; B.add(0, .14, z, 1, .05, .05, '#a0703c').add(0, .28, z, 1, .05, .05, '#a0703c').add(-.5, 0, z, .09, .4, .09, '#7a5230'); if (lx === LS - 1) B.add(.5, 0, z, .09, .4, .09, '#7a5230'); }
        else { const x = e === 'w' ? -.5 : .5; B.add(x, .14, 0, .05, .05, 1, '#a0703c').add(x, .28, 0, .05, .05, 1, '#a0703c').add(x, 0, -.5, .09, .4, .09, '#7a5230'); if (ly === LS - 1) B.add(x, 0, .5, .09, .4, .09, '#7a5230'); }
      });
      piece(B, o.x + lx + .5, o.y + ly + .5, .8);
    }
  });
  (function buildShop() {
    const S = WD.shop;
    for (let j = 0; j < S.h; j++) for (let i = 0; i < S.w; i++) {
      const B = Vox.mk(); B.add(0, 0, 0, 1, 1.5, 1, (i + j) % 2 ? '#f6e7c1' : '#f0dfb5');
      B.add(0, 1.5, 0, 1.1, .12, 1.1, i % 2 ? '#fff' : '#e5533d');
      if (j === 1 || j === 0) B.add(0, 1.62, 0, 1.0, .12, 1.0, '#b5432f');
      if (j === S.h - 1) {
        if (i === 2) B.add(.25, 0, .5, .5, 1.05, .04, '#7a5230'); else if (i === 3) B.add(-.25, 0, .5, .5, 1.05, .04, '#7a5230');
        else B.add(0, .5, .5, .6, .55, .04, '#bfe8fb');
        B.add(0, 1.08, .72, 1, .08, .45, i % 2 ? '#fff' : '#e5533d');
      }
      piece(B, S.x + i + .5, S.y + j + .5, 1.3);
    }
    const crate = Vox.mk(); crate.add(0, 0, 0, .5, .4, .5, '#b98a4e').add(0, .4, 0, .52, .04, .52, '#8a6a3a'); piece(crate, S.x - .5, S.y + S.h + .1, .8); piece(crate, S.x + S.w + .5, S.y + S.h + .1, .8);
    piece(Vox.plantBoxes(cat.SEED_BY.pumpkin, 3, false), S.x - .5, S.y + S.h + .1, .6);
    piece(Vox.plantBoxes(cat.SEED_BY.sunflower, 3, false), S.x + S.w + .5, S.y + S.h + .1, .6);
  })();

  // ---------- picking ----------
  function plantH(tile) { return [.25, .35, .7, 1][Vox.plantStage((now() - tile.at) / growMs(cat.SEED_BY[tile.seed]))]; }
  function pickAt(bx, by) {
    // shop (tall building): test a few heights
    for (const Y of [.3, 1, 1.6]) { const g = view.pick(bx, by, Y); if (g.x > WD.shop.x - .05 && g.x < WD.shop.x + WD.shop.w + .05 && g.z > WD.shop.y - .05 && g.z < WD.shop.y + WD.shop.h + .05) return { shop: true }; }
    let best = null;
    for (let i = 0; i < lands.length; i++) {
      const o = WD.lands[i], L = lands[i];
      for (const k in L.tiles) {
        const tile = L.tiles[k], [lx, ly] = k.split(',').map(Number), wx = o.x + lx + .5, wz = o.y + ly + .5;
        const H = tile.type === 'furn' ? Vox.furnModel(cat.FURN_BY[tile.id]).h : plantH(tile);
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        for (const [a, y, b] of [[-.4, 0, -.4], [.4, 0, -.4], [.4, 0, .4], [-.4, 0, .4], [-.4, H, -.4], [.4, H, -.4], [.4, H, .4], [-.4, H, .4]]) { const s = view.toScreen(wx + a, y, wz + b); mnx = Math.min(mnx, s[0]); mxx = Math.max(mxx, s[0]); mny = Math.min(mny, s[1]); mxy = Math.max(mxy, s[1]); }
        if (bx >= mnx && bx <= mxx && by >= mny && by <= mxy) { const d = view.toScreen(wx, 0, wz)[2]; if (!best || d < best.d) best = { i, lx, ly, d }; }
      }
    }
    if (best) return best;
    const g = view.pick(bx, by, 0); return landAt(g.x, g.z);
  }
  function clickScreen(cx, cy) {
    if (!me || modalOpen()) return;
    const [bx, by] = toBuf(cx, cy), hit = pickAt(bx, by);
    if (!hit) return;
    if (hit.shop) return tryShop();
    const L = lands[hit.i];
    if (!L.owner) {
      if (me.land != null) return toast('You already own Land ' + (me.land + 1) + '.', true);
      return openModal('Claim Land ' + (hit.i + 1) + '?', () => h('div', { class: 'center' }, h('div', {}, 'This land is free. You can own one land, and only you can plant or decorate on it.'),
        h('button', { class: 'btn green', onclick: () => { send({ t: 'claim', land: hit.i }); closeModal(); } }, 'Claim this land')));
    }
    if (L.owner !== myName) return toast('This is ' + L.owner + "'s land.", true);
    tileMenu(hit.lx, hit.ly);
  }

  // ---------- land tile menus ----------
  function tileMenu(tx, ty) {
    const key = tx + ',' + ty, tile = lands[me.land].tiles[key];
    if (!tile) return plantMenu(tx, ty);
    if (tile.type === 'furn') {
      const f = cat.FURN_BY[tile.id];
      return openModal(f.name, () => h('div', { class: 'center' }, furnIcon(f), h('button', { class: 'btn', onclick: () => { send({ t: 'pickup', tx, ty }); closeModal(); } }, 'Pick up (back to bag)')));
    }
    const sd = cat.SEED_BY[tile.seed], total = growMs(sd);
    if (now() >= tile.at + total) { send({ t: 'harvest', tx, ty }); return; }
    openModal(sd.name + ' is growing', () => {
      const bar = h('div', { style: 'width:100%;height:100%' });
      const left = h('div', { style: 'font-size:22px;font-weight:700' });
      const upd = () => { const p = Math.min(1, (now() - tile.at) / total); bar.style.width = (p * 100) + '%'; left.textContent = fmtLeft(tile.at + total - now()) + ' left'; if (p >= 1) { closeModal(); toast(sd.name + ' is ready! Click it to harvest.'); } };
      upd(); const iv = setInterval(upd, 500); modalClose = () => clearInterval(iv);
      return h('div', { class: 'center' }, plantIcon(sd, false), left, h('div', { class: 'bar', style: 'width:100%' }, bar), h('div', { class: 'muted' }, 'Keeps growing even when you log out or the server restarts.'));
    });
  }
  function plantMenu(tx, ty) {
    let tab = 'seeds';
    openModal('What do you want here?', () => {
      const b = h('div', {}, tabs([['seeds', '🌱 Plant a seed'], ['furn', '🪑 Place furniture']], tab, t => { tab = t; }));
      if (tab === 'seeds') {
        const ent = cat.SEEDS.filter(s => me.seeds[s.id] > 0);
        if (!ent.length) { b.append(h('div', { class: 'muted' }, 'You have no seeds. Buy some at the shop 🏪 (the building in the middle).')); return b; }
        const list = h('div', { class: 'list' });
        ent.forEach(sd => list.append(h('div', { class: 'lrow' }, plantIcon(sd, false), h('div', { class: 'grow' }, h('b', {}, sd.name), h('div', { class: 'muted' }, 'Grows ' + fmtHours(sd.hours) + ' · sells ' + money(sd.sell) + ' · you have ' + me.seeds[sd.id])),
          h('button', { class: 'btn green', onclick: () => { send({ t: 'plant', tx, ty, seed: sd.id }); closeModal(); } }, 'Plant'))));
        b.append(list);
      } else {
        const ent = cat.FURNITURE.filter(f => me.furniture[f.id] > 0);
        if (!ent.length) { b.append(h('div', { class: 'muted' }, 'You have no furniture. Buy some at the shop 🏪.')); return b; }
        const g = h('div', { class: 'grid' });
        ent.forEach(f => g.append(h('div', { class: 'item' }, furnIcon(f), h('div', { class: 'nm' }, f.name), h('div', { class: 'muted' }, '×' + me.furniture[f.id]), h('button', { class: 'btn sm green', onclick: () => { send({ t: 'place', tx, ty, furn: f.id }); closeModal(); } }, 'Place'))));
        b.append(g);
      }
      return b;
    });
  }

  // ---------- input ----------
  function typing() { return document.activeElement && document.activeElement.tagName === 'INPUT'; }
  const rotate = d => { yawT += d * PI / 4; };
  addEventListener('keydown', e => {
    if (!started) return;
    if (e.key === 'Enter') {
      const ci = $('#chatinput');
      if (document.activeElement === ci) { const t = ci.value.trim(); if (t) send({ t: 'chat', text: t }); ci.value = ''; ci.blur(); }
      else if (!modalOpen()) { ci.focus(); e.preventDefault(); }
      return;
    }
    if (typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.key === 'Escape') { if (modalOpen() && !modalLocked) closeModal(); return; }
    if (modalOpen()) return;
    const k = e.key.toLowerCase(); keys.add(k);
    if (k === 'f') tryShop();
    if (k === 'b') openBag();
    if (k === 'i') openWardrobe();
    if (k === 'q') rotate(-1);
    if (k === 'e') rotate(1);
    if (k.startsWith('arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  $('#b-rl').onclick = () => rotate(-1);
  $('#b-rr').onclick = () => rotate(1);
  let drag = null;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => { if (e.button === 2 || e.button === 1) { drag = e.clientX; e.preventDefault(); } });
  addEventListener('mouseup', () => { drag = null; });
  addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; if (drag !== null) { const d = (e.clientX - drag) * .012; drag = e.clientX; yawT += d; view.yaw += d; } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(18, Math.min(48, zoom * (e.deltaY < 0 ? 1.1 : .91))); }, { passive: false });
  cv.addEventListener('click', e => clickScreen(e.clientX, e.clientY));

  // ---------- rendering ----------
  function bubble(text, x, y) {
    lctx.font = '13px Trebuchet MS';
    const words = text.split(' '), lines = []; let cur = '';
    for (const wd of words) { if (lctx.measureText(cur + ' ' + wd).width > 150 && cur) { lines.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; }
    lines.push(cur);
    const w = Math.min(170, Math.max(...lines.map(l => lctx.measureText(l).width))) + 14, hh = lines.length * 16 + 8;
    lctx.fillStyle = '#fff'; lctx.strokeStyle = '#555'; lctx.lineWidth = 1.5; lctx.beginPath(); lctx.roundRect(x - w / 2, y - hh, w, hh, 8); lctx.fill(); lctx.stroke();
    lctx.fillStyle = '#222'; lctx.textAlign = 'center'; lines.forEach((l, i) => lctx.fillText(l, x, y - hh + 17 + i * 16)); lctx.textAlign = 'left';
  }
  function tag(text, x, y, color) {
    lctx.font = 'bold 12px Trebuchet MS'; lctx.textAlign = 'center'; lctx.lineWidth = 3; lctx.strokeStyle = 'rgba(0,0,0,.65)'; lctx.strokeText(text, x, y);
    lctx.fillStyle = color || '#fff'; lctx.fillText(text, x, y); lctx.textAlign = 'left';
  }
  const angDiff = (a, b) => { let d = (b - a) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; };

  let last = performance.now();
  function frame(tNow) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (tNow - last) / 1000); last = tNow; const t = tNow / 1000;
    const vw = innerWidth, vh = innerHeight, dpr = window.devicePixelRatio || 1;
    // lower PIX = sharper (less CSS upscale blur). Was 3/2; 2 keeps edges crisp without killing FPS
    PIX = 2;
    const bw = Math.ceil(vw / PIX), bh = Math.ceil(vh / PIX);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw; cv.height = bh;
      view.ctx.imageSmoothingEnabled = false;
    }
    if (lab.width !== Math.round(vw * dpr) || lab.height !== Math.round(vh * dpr)) { lab.width = Math.round(vw * dpr); lab.height = Math.round(vh * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, vw, vh);
    if (!started) { view.prep(); view.clear('#7ec96a'); return; }

    // movement relative to the camera
    let ix = 0, iy = 0;
    if (!modalOpen() && !typing()) {
      if (keys.has('a') || keys.has('arrowleft')) ix--; if (keys.has('d') || keys.has('arrowright')) ix++;
      if (keys.has('w') || keys.has('arrowup')) iy++; if (keys.has('s') || keys.has('arrowdown')) iy--;
    }
    const moving = !!(ix || iy);
    if (moving) {
      const s = Math.sin(view.yaw), c = Math.cos(view.yaw);
      let wx = c * ix + s * iy, wz = -s * ix + c * iy; const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      const sp = (keys.has('shift') ? 280 : 190) * dt;
      let nx = Math.max(10, Math.min(WD.width * TILE - 10, self.x + wx * sp)), ny = Math.max(10, Math.min(WD.height * TILE - 10, self.y + wz * sp));
      if (!blocked(nx, self.y)) self.x = nx; if (!blocked(self.x, ny)) self.y = ny;
      self.psi += angDiff(self.psi, Math.atan2(wx, wz)) * Math.min(1, dt * 14); self.walk += dt * 11;
    }
    if (performance.now() - lastSent > 100 && (Math.abs(self.x - sentX) > .5 || Math.abs(self.y - sentY) > .5)) { send({ t: 'move', x: self.x, y: self.y }); sentX = self.x; sentY = self.y; lastSent = performance.now(); }

    // camera
    view.yaw += (yawT - view.yaw) * Math.min(1, dt * 10);
    view.ppt += (zoom - view.ppt) * Math.min(1, dt * 10);
    view.fx += (self.x / TILE - view.fx) * Math.min(1, dt * 9); view.fz += (self.y / TILE - view.fz) * Math.min(1, dt * 9);
    view.hcf = .55; view.prep(); view.clear('#68b657');

    // ground
    const cs = [view.pick(0, 0, 0), view.pick(bw, 0, 0), view.pick(0, bh, 0), view.pick(bw, bh, 0)];
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c.x))) - 1), x1 = Math.min(WD.width - 1, Math.ceil(Math.max(...cs.map(c => c.x))) + 1);
    const z0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c.z))) - 1), z1 = Math.min(WD.height - 1, Math.ceil(Math.max(...cs.map(c => c.z))) + 1);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const chk = (tx + tz) & 1; let col;
      if (landGrid[tz][tx] >= 0) col = chk ? '#a5d96f' : '#9bd166'; else if (isMargin(tx, tz)) col = chk ? '#6fbd5e' : '#68b657'; else col = chk ? '#d9d4c3' : '#cfcab8';
      view.quad(tx, tz, tx + 1, tz + 1, 0, col, col);
    }
    // land floors: soil under plants, faint grid on my land, hover highlight
    const fpsi = fpsiFor(view.yaw);
    lands.forEach((L, i) => {
      const o = WD.lands[i], mine = L.owner && L.owner === myName;
      if (mine) for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) view.quad(o.x + lx + .04, o.y + ly + .04, o.x + lx + .96, o.y + ly + .96, 0, 'rgba(70,120,40,.16)');
      for (const k in L.tiles) {
        const tile = L.tiles[k]; if (tile.type !== 'plant') continue;
        const [lx, ly] = k.split(',').map(Number);
        view.quad(o.x + lx + .05, o.y + ly + .05, o.x + lx + .95, o.y + ly + .95, 0, '#7a5a3a', '#7a5a3a');
        for (const f of [.2, .5, .8]) view.quad(o.x + lx + .1, o.y + ly + f - .04, o.x + lx + .9, o.y + ly + f + .04, 0, '#6a4c30');
      }
    });
    const [mbx, mby] = toBuf(mouse.x, mouse.y); const hp = pickAt(mbx, mby);
    hoverTile = hp && !hp.shop ? hp : null;
    if (hoverTile && !modalOpen()) {
      const o = WD.lands[hoverTile.i], L = lands[hoverTile.i];
      if (L.owner === myName) view.quad(o.x + hoverTile.lx, o.y + hoverTile.ly, o.x + hoverTile.lx + 1, o.y + hoverTile.ly + 1, 0, 'rgba(255,255,255,.4)');
      else view.quad(o.x, o.y, o.x + LS, o.y + LS, 0, !L.owner ? 'rgba(255,230,120,.3)' : 'rgba(210,70,50,.14)');
    }

    // objects
    for (const p of statics) view.add(p.B, p.x, 0, p.z, 0, p.r);
    lands.forEach((L, i) => {
      const o = WD.lands[i];
      for (const k in L.tiles) {
        const tile = L.tiles[k], [lx, ly] = k.split(',').map(Number), wx = o.x + lx + .5, wz = o.y + ly + .5;
        if (tile.type === 'furn') { const m = Vox.furnModel(cat.FURN_BY[tile.id]); view.add(m.dyn ? m.boxes.concat(m.dyn(t)) : m.boxes, wx, 0, wz, fpsi, .9); }
        else {
          const sd = cat.SEED_BY[tile.seed], p = (now() - tile.at) / growMs(sd), st = Vox.plantStage(p);
          let B = Vox.plantBoxes(sd, st, tile.gold);
          if (st === 3 && tile.gold) { B = B.concat(Vox.sparkles(t)); view.quad(o.x + lx, o.y + ly, o.x + lx + 1, o.y + ly + 1, 0, 'rgba(255,214,60,' + (.28 + .12 * Math.sin(t * 4)) + ')'); }
          view.add(B, wx, 0, wz, 0, .8);
        }
      }
    });
    const list = [];
    for (const n in players) {
      const p = players[n], ddx = p.x - p.rx, ddy = p.y - p.ry; p.rx += ddx * .25; p.ry += ddy * .25;
      const mv = Math.abs(ddx) + Math.abs(ddy) > 1.5;
      if (mv) { p.walk += dt * 11; p.psi += angDiff(p.psi, Math.atan2(ddx, ddy)) * Math.min(1, dt * 14); }
      view.add(Vox.charBoxes(p.a, cat, p.walk, mv), p.rx / TILE, 0, p.ry / TILE, p.psi, .8); list.push(p);
    }
    view.add(Vox.charBoxes(me.avatar, cat, self.walk, moving), self.x / TILE, 0, self.y / TILE, self.psi, .8);
    view.flush();

    // labels (crisp text on a full-resolution overlay)
    WD.lands.forEach((o, i) => {
      const L = lands[i], mid = [[o.x + 4, o.y], [o.x + 4, o.y + LS], [o.x, o.y + 4], [o.x + LS, o.y + 4]];
      let far = null; for (const [mx, mz] of mid) { const s = toPage(mx, 0, mz); if (!far || s[2] > far[2]) far = s; }
      if (far[0] < -100 || far[0] > vw + 100 || far[1] < -50 || far[1] > vh + 50) return;
      const label = L.owner ? L.owner + "'s land" : 'Land ' + (i + 1) + ' — FOR CLAIM';
      lctx.font = 'bold 13px Trebuchet MS'; const w = lctx.measureText(label).width + 18;
      lctx.fillStyle = L.owner ? (L.owner === myName ? '#bff0a8' : '#fff1c9') : '#ffd1c9'; lctx.strokeStyle = '#7a5230'; lctx.lineWidth = 2;
      lctx.beginPath(); lctx.roundRect(far[0] - w / 2, far[1] - 30, w, 20, 6); lctx.fill(); lctx.stroke();
      lctx.fillStyle = '#3b2a1a'; lctx.textAlign = 'center'; lctx.fillText(label, far[0], far[1] - 16); lctx.textAlign = 'left';
    });
    const sc = toPage(WD.shop.x + WD.shop.w / 2, 2.2, WD.shop.y + WD.shop.h / 2);
    lctx.font = 'bold 18px Trebuchet MS'; lctx.textAlign = 'center'; lctx.lineWidth = 4; lctx.strokeStyle = '#6b1a0d'; lctx.strokeText('🏪 SUNNY SHOP', sc[0], sc[1]); lctx.fillStyle = '#fff3c4'; lctx.fillText('🏪 SUNNY SHOP', sc[0], sc[1]); lctx.textAlign = 'left';
    if (nearShop() && !modalOpen()) tag('Press F or click the shop', sc[0], sc[1] + 20, '#ffe066');
    for (const p of list) { const s = toPage(p.rx / TILE, 1.7, p.ry / TILE); tag(p.n, s[0], s[1]); if (p.say && p.say.until > Date.now()) bubble(p.say.text, s[0], s[1] - 8); }
    { const s = toPage(self.x / TILE, 1.7, self.y / TILE); tag(me.name, s[0], s[1], '#ffe066'); if (self.say && self.say.until > Date.now()) bubble(self.say.text, s[0], s[1] - 8); }

    let hint = 'WASD walk · Q/E or right-drag to rotate · wheel to zoom · click your land · Enter to chat';
    if (me.land == null) hint = 'Click an empty land to claim it as yours 🌱';
    else if (hoverTile) { const L = lands[hoverTile.i]; hint = L.owner === myName ? 'Click: plant, decorate, or harvest' : L.owner ? 'This is ' + L.owner + "'s land" : ''; }
    $('#hint').textContent = hint; $('#hint').style.display = modalOpen() ? 'none' : '';
  }
  requestAnimationFrame(frame);
  window.__sl = { view, self, lands: () => lands };   // handy for debugging in the console

  // ---------- boot ----------
  if (token) { loggedOut = false; authScreen(); connect(); } else authScreen();
})();
