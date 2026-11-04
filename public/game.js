'use strict';
(async function () {
  const $ = s => document.querySelector(s);
  const cat = await (await fetch('/api/catalog')).json();
  cat.FURNITURE_SHOP = cat.FURNITURE;
  cat.CLOTHES_SHOP = cat.CLOTHES;
  cat.FURNITURE = cat.ALL_FURNITURE || cat.FURNITURE;
  cat.CLOTHES = cat.ALL_CLOTHES || cat.CLOTHES;
  cat.SEED_BY = Object.fromEntries(cat.SEEDS.map(s => [s.id, s]));
  cat.FURN_BY = Object.fromEntries(cat.FURNITURE.map(s => [s.id, s]));
  cat.CLOTH = Object.fromEntries(cat.CLOTHES.map(s => [s.id, s]));
  const WD = cat.WORLD, TILE = WD.tile, LS = WD.landSize;           // TILE = server px per tile
  const money = n => {
    const x = Math.round(Number(n) * 100) / 100;
    return '$' + x.toLocaleString(undefined, { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  const PI = Math.PI;
  const fpsiFor = yaw => Math.floor((yaw + PI) / (PI / 2) + .5) * PI / 2;   // furniture always faces the camera (snapped to 90°)
  const nearPt = (x, y, tx, ty, r) => Math.hypot(x / TILE - tx, y / TILE - ty) < (r || 2.2);
  const nearRect = (x, y, r) => x / TILE > r.x - .5 && x / TILE < r.x + r.w + .5 && y / TILE > r.y - .5 && y / TILE < r.y + r.h + .5;

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
  const stick = { x: 0, y: 0, active: false, run: false };           // phone virtual stick (−1..1)
  let started = false, lastSent = 0, sentX = -1, sentY = -1, hoverTile = null;
  const isPhoneUI = () => {
    if (matchMedia('(pointer: coarse)').matches) return true;
    if (matchMedia('(hover: none)').matches) return true;
    if (navigator.maxTouchPoints > 0) return true;
    if ('ontouchstart' in window) return true;
    if (matchMedia('(max-width: 820px)').matches) return true;
    return false;
  };
  function syncPhoneUI() {
    const on = isPhoneUI();
    document.body.classList.toggle('touchable', on);
    document.body.classList.toggle('phone', on);
    const pad = $('#walk-pad');
    if (pad) pad.classList.toggle('on', !!(started && on));
  }
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
    Object.assign(players[p.n], {
      animals: p.animals || {}, pets: p.pets || [], animalStay: p.animalStay || 'farm', petStay: p.petStay || 'follow',
      land: p.land, houseLand: p.houseLand, expandLand: p.expandLand,
    });
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
        closeModal(); updateHud(); started = true; syncPhoneUI();
        rebuildLandGrid();
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
      case 'land_extra':
        if (lands[m.land]) { lands[m.land].extra = m.extra || {}; rebuildLandGrid(); }
        break;
      case 'land_stats':
        if (lands[m.land]) lands[m.land].stats = m.stats || lands[m.land].stats;
        break;
      case 'chat': addChat(m); if (m.n === myName) self.say = { text: m.text, until: Date.now() + 6000 }; else if (players[m.n]) players[m.n].say = { text: m.text, until: Date.now() + 6000 }; break;
      case 'sys': addChat({ sys: true, text: m.text }); break;
      case 'err': toast(m.msg, true); break;
      case 'ok': toast(m.msg); break;
      case 'harvested': {
        const sd = cat.SEED_BY[m.seed];
        toast(m.gold ? '✨ Golden ' + sd.name + '! Worth triple!' : 'Harvested ' + sd.name);
        break;
      }
      case 'tap_earn': {
        const el = document.getElementById('tap-earn');
        if (el) { el.textContent = '+' + money(m.amount); el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 500); }
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
    stick.x = stick.y = 0; stick.active = stick.run = false; syncPhoneUI();
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
      sec('Furniture', Object.entries(me.furniture).map(([id, n]) => { const f = cat.FURN_BY[id]; if (!f) return null; return h('div', { class: 'lrow' }, furnIcon(f), h('div', { class: 'grow' }, h('b', {}, f.name + (f.buyable === false ? ' ✨' : ''))), '×' + n); }).filter(Boolean));
      sec('Products', Object.entries(me.products || {}).map(([id, n]) => {
        const p = (cat.PRODUCTS || {})[id]; if (!p) return null;
        return h('div', { class: 'lrow' }, h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted' }, money(p.sell) + ' each')),
          '×' + n, h('button', { class: 'btn sm green', onclick: () => send({ t: 'sell', kind: 'product', id, qty: 'all' }) }, 'Sell'));
      }).filter(Boolean));
      if ((me.pets || []).length) {
        sec('Pets', me.pets.map(id => { const p = (cat.PETS || []).find(x => x.id === id); return h('div', { class: 'lrow' }, h('b', {}, p ? p.name : id)); }));
        b.append(h('div', { class: 'muted' }, 'Pet stay:'), h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-bottom:8px' },
          [['follow', 'Follow me'], ['farm', 'Stay on farm'], ['house', 'Stay at house']].map(([w, lab]) =>
            h('button', { class: 'btn sm' + ((me.petStay || 'follow') === w ? ' green' : ''), onclick: () => send({ t: 'set_stay', kind: 'pet', where: w }) }, lab))));
      }
      if (me.animals && (me.animals.chicken || me.animals.cow || me.animals.sheep)) {
        b.append(h('div', { class: 'muted' }, 'Livestock roam:'), h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-bottom:8px' },
          [['farm', 'On farm'], ['house', 'At house']].map(([w, lab]) =>
            h('button', { class: 'btn sm' + ((me.animalStay || 'farm') === w ? ' green' : ''), onclick: () => send({ t: 'set_stay', kind: 'animal', where: w }) }, lab))));
      }
      b.append(h('div', { class: 'muted' }, 'Shop sells house pieces (doors, gates, walls, TVs…). Stalls = mini-games. Bushes ~5% rare loot.'));
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
        tabs([['sell', 'Sell'], ['seeds', 'Seeds'], ['furn', 'Furniture'], ['cloth', 'Clothes']], tab, t => { tab = t; }));
      if (tab === 'sell') {
        const ent = Object.entries(me.crops);
        const prod = Object.entries(me.products || {});
        if (!ent.length && !prod.length) { b.append(h('div', { class: 'muted' }, 'Nothing to sell yet — harvest crops or collect animal products.')); return b; }
        let total = 0;
        const list = h('div', { class: 'list' });
        ent.forEach(([k, n]) => {
          const gold = k.endsWith('_gold'), sd = cat.SEED_BY[k.replace('_gold', '')], each = sd.sell * (gold ? cat.GOLD_MULT : 1); total += each * n;
          list.append(h('div', { class: 'lrow' }, plantIcon(sd, gold), h('div', { class: 'grow' }, h('b', { class: gold ? 'gold' : '' }, (gold ? '✨ Golden ' : '') + sd.name), h('div', { class: 'muted' }, money(each) + ' each · you have ' + n)),
            h('button', { class: 'btn sm', onclick: () => send({ t: 'sell', key: k, qty: 1 }) }, 'Sell 1'), h('button', { class: 'btn sm green', onclick: () => send({ t: 'sell', key: k, qty: 'all' }) }, 'Sell all ' + money(each * n))));
        });
        prod.forEach(([id, n]) => {
          const p = (cat.PRODUCTS || {})[id]; if (!p) return;
          total += p.sell * n;
          list.append(h('div', { class: 'lrow' }, h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted' }, money(p.sell) + ' each · ' + n)),
            h('button', { class: 'btn sm green', onclick: () => send({ t: 'sell', kind: 'product', id, qty: 'all' }) }, 'Sell all')));
        });
        b.append(list);
        if (ent.length) b.append(h('button', { class: 'btn green', onclick: () => send({ t: 'sell', key: '*' }) }, 'Sell all crops — ' + money(total)));
      } else if (tab === 'seeds') {
        const g = h('div', { class: 'grid' });
        cat.SEEDS.forEach(sd => g.append(h('div', { class: 'item' }, plantIcon(sd, false), h('div', { class: 'nm' }, sd.name), h('div', { class: 'muted' }, 'Grows ' + fmtHours(sd.hours) + ' · sells ' + money(sd.sell)), h('div', { class: 'muted' }, 'Have ' + (me.seeds[sd.id] || 0)),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: me.money < sd.cost, onclick: () => send({ t: 'buy', kind: 'seed', id: sd.id, qty: 1 }) }, money(sd.cost)), h('button', { class: 'btn sm', disabled: me.money < sd.cost * 5, onclick: () => send({ t: 'buy', kind: 'seed', id: sd.id, qty: 5 }) }, '×5')))));
        b.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, '✨ Every planting has a 2% chance of turning golden — sells for triple!'), g);
      } else if (tab === 'furn') {
        const sel = h('select', { onchange: e => { fShape = e.target.value; modalRefresh(); } }, h('option', { value: 'all' }, 'All types'), cat.SHAPE_IDS.map(s => h('option', { value: s, selected: s === fShape }, s)));
        const g = h('div', { class: 'grid' });
        (cat.FURNITURE_SHOP || []).filter(f => fShape === 'all' || f.shape === fShape).forEach(f => g.append(h('div', { class: 'item' }, furnIcon(f), h('div', { class: 'nm' }, f.name), h('div', { class: 'muted' }, 'Have ' + (me.furniture[f.id] || 0)), h('button', { class: 'btn sm', disabled: me.money < f.price, onclick: () => send({ t: 'buy', kind: 'furn', id: f.id, qty: 1 }) }, money(f.price)))));
        b.append(h('div', { style: 'margin-bottom:8px' }, sel), g);
      } else {
        const sel = h('select', { onchange: e => { cSlot = e.target.value; modalRefresh(); } }, [['all', 'All'], ['top', 'Tops'], ['bottom', 'Bottoms'], ['hat', 'Hats'], ['shoes', 'Shoes']].map(([v, l]) => h('option', { value: v, selected: v === cSlot }, l)));
        const g = h('div', { class: 'grid' });
        (cat.CLOTHES_SHOP || []).filter(c => c.price > 0 && c.buyable !== false && (cSlot === 'all' || c.slot === cSlot)).forEach(it => g.append(h('div', { class: 'item' + (owns(it) ? ' own' : '') }, clothIcon(it), h('div', { class: 'nm' }, it.name),
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

  // ---------- HD-2D view (Three.js) ----------
  if (!window.HD2D || !HD2D.View) throw new Error('HD2D renderer missing — check hd2d-boot.js');
  const cv = $('#game'), lab = $('#labels'), lctx = lab.getContext('2d');
  const view = new HD2D.View(cv);
  let zoom = 36, yawT = view.yaw, mouse = { x: 0, y: 0 };
  const scaleX = () => innerWidth / Math.max(1, view.W);
  const scaleY = () => innerHeight / Math.max(1, view.H);
  const toBuf = (cx, cy) => [cx / scaleX(), cy / scaleY()];
  const toPage = (X, Y, Z) => { const s = view.toScreen(X, Y, Z); return [s[0] * scaleX(), s[1] * scaleY(), s[2]]; };

  // land lookup (tile coordinates) — includes bought extra squares
  let landGrid = Array.from({ length: WD.height }, () => new Array(WD.width).fill(-1));
  function rebuildLandGrid() {
    landGrid = Array.from({ length: WD.height }, () => new Array(WD.width).fill(-1));
    WD.lands.forEach((o, i) => {
      for (let y = 0; y < LS; y++) for (let x = 0; x < LS; x++) {
        if (o.y + y < WD.height && o.x + x < WD.width) landGrid[o.y + y][o.x + x] = i;
      }
      const L = lands[i];
      if (!L || !L.extra) return;
      for (const k of Object.keys(L.extra)) {
        const [rx, ry] = k.split(',').map(Number);
        const wx = o.x + rx, wy = o.y + ry;
        if (wy >= 0 && wy < WD.height && wx >= 0 && wx < WD.width) landGrid[wy][wx] = i;
      }
    });
  }
  rebuildLandGrid();
  function landAt(tx, tz) {
    tx = Math.floor(tx); tz = Math.floor(tz);
    if (tz < 0 || tz >= WD.height || tx < 0 || tx >= WD.width) return null;
    const i = landGrid[tz][tx];
    if (i < 0) return null;
    const o = WD.lands[i];
    return { i, lx: tx - o.x, ly: tz - o.y };
  }
  function isAdjToMyLand(wx, wy) {
    if (me == null || me.land == null) return false;
    const li = me.land;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = wx + dx, ny = wy + dy;
      return ny >= 0 && ny < WD.height && nx >= 0 && nx < WD.width && landGrid[ny][nx] === li;
    });
  }
  function inPark(tx, ty) {
    const P = WD.park; if (!P) return false;
    return tx >= P.x && tx < P.x + P.w && ty >= P.y && ty < P.y + P.h;
  }
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
    if (o.npc) return; // model home uses cottage shell + garden, not farm fencing
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
  (function buildPOIs() {
    for (const s of (WD.stalls || [])) piece(Vox.stallBoxes(s.id), s.x, s.y, 1.4);
    for (const [id, p] of Object.entries(WD.pens || {})) {
      piece(Vox.penFence(p.w - .4, p.h - .4), p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h));
      piece(Vox.animalBoxes(id), p.x + p.w / 2, p.y + p.h / 2, 1.2);
    }
    if (WD.petShop) {
      const P = WD.petShop;
      piece(Vox.shopBox(P.w - .2, 1.4, P.h - .2, '#7048a8'), P.x + P.w / 2, P.y + P.h / 2, 2);
    }
    for (const b of (WD.bushes || [])) piece(Vox.bushBoxes(), b.x, b.y, .9);
    if (WD.park) {
      const P = WD.park;
      // soft park border posts
      for (let i = 0; i < P.w; i++) {
        if (i % 2 === 0) { const B = Vox.mk(); B.add(0, 0, 0, .08, .35, .08, '#868e96'); piece(B, P.x + i + .5, P.y + .2, .6); piece(B, P.x + i + .5, P.y + P.h - .2, .6); }
      }
      piece(Vox.slideBoxes(), P.x + 2.5, P.y + 3.2, 1.4);
      piece(Vox.slideBoxes(), P.x + 7.2, P.y + 3.5, 1.4);
      piece(Vox.parkBench(), P.x + 4.5, P.y + 1.5, 1.1);
      piece(Vox.parkBench(), P.x + 5.5, P.y + 5.5, 1.1);
      const tree = Vox.mk(); tree.add(0, 0, 0, .18, .55, .18, '#7a5230').add(0, .5, 0, .7, .4, .7, '#2f9e44').add(0, .85, 0, .5, .35, .5, '#40c057');
      piece(tree, P.x + 1.2, P.y + 1.5, 1.2); piece(tree, P.x + 8.5, P.y + 5.2, 1.2);
    }
    WD.lands.forEach((o, i) => {
      if (o.npc) {
        // solid base/porch always; walls+roof drawn each frame (fade when inside)
        piece(Vox.modelHomeBase(), o.x + LS / 2, o.y + LS / 2 - .4, 1.15);
        piece(Vox.landPost(), o.x + .35, o.y + LS - .4, 1.0);
      } else piece(Vox.landPost(), o.x + .35, o.y + .35, 1.0);
    });
  })();
  const npcLot = WD.lands.find(o => o.npc) || null;
  const npcShellSolid = Vox.modelHomeShell(1);
  const npcShellGhost = Vox.modelHomeShell(0.2);
  function insideNpcHome() {
    if (!npcLot || !me) return false;
    const tx = self.x / TILE, tz = self.y / TILE;
    return tx >= npcLot.x + 0.4 && tx < npcLot.x + LS - 0.4 && tz >= npcLot.y + 0.4 && tz < npcLot.y + LS - 0.8;
  }

  // ---------- picking ----------
  function plantH(tile) { return [.25, .35, .7, 1][Vox.plantStage((now() - tile.at) / growMs(cat.SEED_BY[tile.seed]))]; }
  function pickAt(bx, by) {
    // shop (tall building): test a few heights
    for (const Y of [.3, 1, 1.6]) { const g = view.pick(bx, by, Y); if (g.x > WD.shop.x - .05 && g.x < WD.shop.x + WD.shop.w + .05 && g.z > WD.shop.y - .05 && g.z < WD.shop.y + WD.shop.h + .05) return { shop: true }; }
    const g0 = view.pick(bx, by, 0);
    // land posts (NW corner of each plot)
    for (let i = 0; i < WD.lands.length; i++) {
      const o = WD.lands[i];
      if (Math.hypot(g0.x - (o.x + .35), g0.z - (o.y + .35)) < .7) return { post: i };
    }
    // POIs (stalls / pens / pet shop / bushes / park)
    for (const s of (WD.stalls || [])) if (Math.hypot(g0.x - s.x, g0.z - s.y) < 1.3) return { stall: s };
    if (WD.petShop && g0.x > WD.petShop.x && g0.x < WD.petShop.x + WD.petShop.w && g0.z > WD.petShop.y && g0.z < WD.petShop.y + WD.petShop.h) return { petShop: true };
    for (const [id, p] of Object.entries(WD.pens || {})) if (g0.x > p.x && g0.x < p.x + p.w && g0.z > p.y && g0.z < p.y + p.h) return { pen: id };
    for (const b of (WD.bushes || [])) if (Math.hypot(g0.x - b.x, g0.z - b.y) < 1.1) return { bush: b };
    if (WD.park && inPark(g0.x, g0.z)) return { park: true };
    let best = null;
    for (let i = 0; i < lands.length; i++) {
      const o = WD.lands[i], L = lands[i];
      for (const k in L.tiles) {
        const tile = L.tiles[k], [lx, ly] = k.split(',').map(Number), wx = o.x + lx + .5, wz = o.y + ly + .5;
        const H = tile.type === 'furn' ? (Vox.furnModel(cat.FURN_BY[tile.id] || { shape: 'stool', v: 0, pal: ['#ccc', '#aaa', '#888'] }).h) : plantH(tile);
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        for (const [a, y, b] of [[-.4, 0, -.4], [.4, 0, -.4], [.4, 0, .4], [-.4, 0, .4], [-.4, H, -.4], [.4, H, -.4], [.4, H, .4], [-.4, H, .4]]) { const s = view.toScreen(wx + a, y, wz + b); mnx = Math.min(mnx, s[0]); mxx = Math.max(mxx, s[0]); mny = Math.min(mny, s[1]); mxy = Math.max(mxy, s[1]); }
        if (bx >= mnx && bx <= mxx && by >= mny && by <= mxy) { const d = view.toScreen(wx, 0, wz)[2]; if (!best || d < best.d) best = { i, lx, ly, d }; }
      }
    }
    if (best) return best;
    const g = view.pick(bx, by, 0);
    const la = landAt(g.x, g.z);
    if (la) return la;
    // buy adjacent square for starter land expand
    const wx = Math.floor(g.x), wy = Math.floor(g.z);
    if (me && me.land != null && !(WD.lands[me.land] && WD.lands[me.land].expand)
        && landGrid[wy] && landGrid[wy][wx] < 0 && !inPark(wx, wy) && isAdjToMyLand(wx, wy)) {
      return { buySquare: true, wx, wy };
    }
    return null;
  }
  function clickScreen(cx, cy) {
    if (!me || modalOpen()) return;
    const [bx, by] = toBuf(cx, cy), hit = pickAt(bx, by);
    if (!hit) return;
    if (hit.shop) return tryShop();
    if (hit.post != null) return openLandPost(hit.post);
    if (hit.stall) return openStall(hit.stall);
    if (hit.petShop) return openPetShop();
    if (hit.pen) return openPen(hit.pen);
    if (hit.bush) return forageBush(hit.bush);
    if (hit.park) return openPark();
    if (hit.buySquare) return tryBuySquare(hit.wx, hit.wy);
    const L = lands[hit.i];
    if (!L.owner) {
      const meta = WD.lands[hit.i] || {};
      if (meta.npc || L.npc) return toast('Sunny Homes model house — walk around for decorating ideas!', false);
      if (meta.expand) {
        if (me.land == null) return toast('Claim a starter farm first (Farm Lots 1–8).', true);
        if (me.expandLand != null) return toast('You already own an expansion plot.', true);
        return openModal('Buy expansion farm?', () => h('div', { class: 'center' },
          h('div', {}, 'Separate expansion lot — does not touch or change anyone\'s existing crops.'),
          h('div', { class: 'muted' }, 'Cost ' + money(cat.EXPAND_COST || 25000) + ' · one expansion lot per player'),
          h('button', { class: 'btn green', onclick: () => { send({ t: 'claim', land: hit.i }); closeModal(); } }, 'Buy expansion · ' + money(cat.EXPAND_COST || 25000))));
      }
      if (meta.house) {
        if (me.land == null) return toast('Claim a farm lot first.', true);
        if (me.houseLand != null) return toast('You already own a house lot.', true);
        return openModal('Buy house lot?', () => h('div', { class: 'center' },
          h('div', {}, 'Build and decorate a house here — doors, gates, walls, windows, TVs, kitchens & more. You can also plant a garden. House lots cannot expand.'),
          h('div', { class: 'muted' }, 'Cost ' + money(cat.HOUSE_COST || 10000) + ' · one house lot per player'),
          h('button', { class: 'btn green', onclick: () => { send({ t: 'claim', land: hit.i }); closeModal(); } }, 'Buy house lot · ' + money(cat.HOUSE_COST || 10000))));
      }
      if (me.land != null) return toast('You already own a farm. Buy a house lot (south) or a pricey expansion (east), or expand your farm one square at a time.', true);
      return openModal('Claim Farm Lot ' + (hit.i + 1) + '?', () => h('div', { class: 'center' }, h('div', {}, 'This farm is free. You can own one starter farm, then add a house lot and expand later.'),
        h('button', { class: 'btn green', onclick: () => { send({ t: 'claim', land: hit.i }); closeModal(); } }, 'Claim Farm Lot ' + (hit.i + 1))));
    }
    if (L.npc || (WD.lands[hit.i] && WD.lands[hit.i].npc)) {
      return openModal('Sunny Homes — Model House', () => h('div', { class: 'center' },
        h('div', {}, 'A fully furnished showcase home. Peek at doors, gates, TVs, kitchens & more for ideas.'),
        h('div', { class: 'muted' }, 'This lot cannot be claimed. Buy your own house lot nearby!')));
    }
    if (L.owner !== myName) {
      // view others' crop progress (read-only) — never mutate their tiles
      if (hit.lx != null) {
        const tile = L.tiles[hit.lx + ',' + hit.ly];
        if (tile && tile.type === 'plant') return viewOtherCrop(L.owner, tile);
        if (tile && tile.type === 'furn') return openModal(L.owner + "'s " + ((cat.FURN_BY[tile.id] || {}).name || 'decor'), () => h('div', { class: 'center' }, furnIcon(cat.FURN_BY[tile.id] || { id: 'x', shape: 'stool', v: 0, pal: ['#ccc', '#aaa', '#888'] }), h('div', { class: 'muted' }, 'Looking only.')));
      }
      return toast(L.owner + "'s place — click plants or decor to peek.", true);
    }
    tileMenu(hit.i, hit.lx, hit.ly);
  }
  function openPark() {
    openModal('Mini Park', () => h('div', { class: 'center' },
      h('div', { style: 'font-size:22px;font-weight:900' }, 'Slides & benches'),
      h('div', {}, 'A quiet corner for farmers. Sit on a bench or take a ride down the slide.'),
      h('button', { class: 'btn green', onclick: () => { closeModal(); toast('Wheee! Down the slide!'); } }, 'Ride a slide'),
      h('button', { class: 'btn', onclick: () => { closeModal(); toast('Ahh… park bench break.'); } }, 'Sit on a bench')));
  }
  function viewOtherCrop(owner, tile) {
    const sd = cat.SEED_BY[tile.seed]; if (!sd) return;
    const total = growMs(sd);
    openModal(owner + "'s " + sd.name, () => {
      const bar = h('div', { style: 'width:100%;height:100%' });
      const left = h('div', { style: 'font-size:20px;font-weight:700' });
      const upd = () => {
        const p = Math.min(1, (now() - tile.at) / total);
        bar.style.width = (p * 100) + '%';
        left.textContent = p >= 1 ? 'Ready to harvest!' : fmtLeft(tile.at + total - now()) + ' left';
      };
      upd(); const iv = setInterval(upd, 500); modalClose = () => clearInterval(iv);
      return h('div', { class: 'center' }, plantIcon(sd, !!tile.gold), left, h('div', { class: 'bar', style: 'width:100%' }, bar), h('div', { class: 'muted' }, 'Looking only — you cannot harvest their crops.'));
    });
  }

  // ---------- land tile menus ----------
  function tileMenu(land, tx, ty) {
    const key = tx + ',' + ty, tile = lands[land].tiles[key];
    if (!tile) return plantMenu(land, tx, ty);
    if (tile.type === 'furn') {
      const f = cat.FURN_BY[tile.id];
      return openModal(f.name, () => h('div', { class: 'center' }, furnIcon(f), h('button', { class: 'btn', onclick: () => { send({ t: 'pickup', land, tx, ty }); closeModal(); } }, 'Pick up (back to bag)')));
    }
    const sd = cat.SEED_BY[tile.seed], total = growMs(sd);
    if (now() >= tile.at + total) { send({ t: 'harvest', land, tx, ty }); return; }
    let lastTap = 0;
    openModal(sd.name + ' is growing', () => {
      const bar = h('div', { style: 'width:100%;height:100%' });
      const left = h('div', { style: 'font-size:22px;font-weight:700' });
      const earn = h('div', { id: 'tap-earn', style: 'font-size:28px;font-weight:900;color:#2f9e44;min-height:34px;opacity:0;transition:opacity .2s' }, '');
      const plantBtn = h('button', {
        class: 'btn green', style: 'width:100%;padding:16px;font-size:18px',
        onclick: () => {
          const tnow = performance.now();
          if (tnow - lastTap < 450) return;
          lastTap = tnow;
          send({ t: 'tap_grow', land, tx, ty });
        },
      }, 'Tap to care · earn ' + money(cat.TAP_MIN || 0.1) + '–' + money(cat.TAP_MAX || 0.5));
      const upd = () => { const p = Math.min(1, (now() - tile.at) / total); bar.style.width = (p * 100) + '%'; left.textContent = fmtLeft(tile.at + total - now()) + ' left'; if (p >= 1) { closeModal(); toast(sd.name + ' is ready! Click it to harvest.'); } };
      upd(); const iv = setInterval(upd, 500); modalClose = () => clearInterval(iv);
      return h('div', { class: 'center' }, plantIcon(sd, false), left, h('div', { class: 'bar', style: 'width:100%' }, bar), earn, plantBtn, h('div', { class: 'muted' }, 'Keeps growing even when you log out or the server restarts.'));
    });
  }
  function plantMenu(land, tx, ty) {
    const isHouse = !!(WD.lands[land] && WD.lands[land].house);
    let tab = isHouse ? 'furn' : 'seeds';
    openModal(isHouse ? 'Decorate your house' : 'What do you want here?', () => {
      const b = h('div', {}, tabs([['seeds', '🌱 Plant a seed'], ['furn', isHouse ? '🏠 House decor' : '🪑 Place furniture']], tab, t => { tab = t; }));
      if (tab === 'seeds') {
        const ent = cat.SEEDS.filter(s => me.seeds[s.id] > 0);
        if (!ent.length) { b.append(h('div', { class: 'muted' }, 'You have no seeds. Buy some at the shop 🏪 (the building in the middle).')); return b; }
        const list = h('div', { class: 'list' });
        ent.forEach(sd => list.append(h('div', { class: 'lrow' }, plantIcon(sd, false), h('div', { class: 'grow' }, h('b', {}, sd.name), h('div', { class: 'muted' }, 'Grows ' + fmtHours(sd.hours) + ' · sells ' + money(sd.sell) + ' · you have ' + me.seeds[sd.id])),
          h('button', { class: 'btn green', onclick: () => { send({ t: 'plant', land, tx, ty, seed: sd.id }); closeModal(); } }, 'Plant'))));
        b.append(list);
      } else {
        const ent = cat.FURNITURE.filter(f => me.furniture[f.id] > 0);
        if (!ent.length) { b.append(h('div', { class: 'muted' }, 'No decor yet. Buy doors, gates, walls, TVs & more at the shop 🏪.')); return b; }
        const g = h('div', { class: 'grid' });
        ent.forEach(f => g.append(h('div', { class: 'item' }, furnIcon(f), h('div', { class: 'nm' }, f.name), h('div', { class: 'muted' }, '×' + me.furniture[f.id]), h('button', { class: 'btn sm green', onclick: () => { send({ t: 'place', land, tx, ty, furn: f.id }); closeModal(); } }, 'Place'))));
        b.append(g);
      }
      return b;
    });
  }

  // ---------- mini-games + side activities ----------
  async function runMinigame(kind, title) {
    if (!window.MiniGames) return false;
    return MiniGames.play(kind, title);
  }
  function openStall(stall) {
    const last = (me.stallAt && me.stallAt[stall.id]) || 0;
    const left = stall.cd * 1000 - (now() - last);
    const gname = (cat.MINIGAMES[stall.game] && cat.MINIGAMES[stall.game].name) || stall.game;
    openModal(stall.name, () => h('div', { class: 'center' },
      h('div', {}, gname + ' for a small tip (' + money(stall.pay[0]) + '–' + money(stall.pay[1]) + ').'),
      h('div', { class: 'muted' }, left > 0 ? 'Cooldown ' + Math.ceil(left / 1000) + 's' : 'Ready!'),
      h('button', { class: 'btn green', disabled: left > 0, onclick: async () => {
        closeModal();
        const ok = await runMinigame(stall.game, stall.name + ' · ' + gname);
        send({ t: 'stall_play', id: stall.id, ok: ok ? 1 : 0 });
        toast(ok ? 'Nice run!' : 'Try again next time', !ok);
      } }, 'Play ' + gname)));
  }
  function openLandPost(i) {
    const L = lands[i]; if (!L) return;
    const st = L.stats || { harvested: 0, growTime: 0, value: 0 };
    const hrs = (st.growTime / 3600000);
    openModal('📌 Land ' + (i + 1) + ' Post', () => h('div', { class: 'center' },
      h('div', {}, L.owner ? ('Owner: ' + L.owner) : 'Unclaimed'),
      h('div', { style: 'font-size:22px;font-weight:900' }, (st.harvested || 0) + ' crops harvested'),
      h('div', {}, 'Total grow time: ' + (hrs >= 1 ? hrs.toFixed(1) + ' hr' : Math.round((st.growTime || 0) / 60000) + ' min')),
      h('div', {}, 'Total harvest value: ' + money(st.value || 0)),
      h('div', { class: 'muted' }, 'Stats update when crops are harvested on this land.')));
  }
  function nextSquarePrice() {
    const L = me && me.land != null ? lands[me.land] : null;
    const n = L && L.extra ? Object.keys(L.extra).length : 0;
    const base = cat.SQUARE_COST || 140, grow = cat.SQUARE_GROW || 70;
    return base + n * grow;
  }
  function tryBuySquare(wx, wy) {
    if (me.land == null) return toast('Claim a Farm Lot first.', true);
    if (me.houseLand != null && landGrid[wy] && landGrid[wy][wx] === me.houseLand) return toast('House lots cannot expand.', true);
    const price = nextSquarePrice();
    const owned = (lands[me.land] && lands[me.land].extra) ? Object.keys(lands[me.land].extra).length : 0;
    openModal('Buy this square?', () => h('div', { class: 'center' },
      h('div', {}, 'Expand your Farm Lot by 1 square for ' + money(price) + '.'),
      h('div', { class: 'muted' }, 'Square #' + (owned + 1) + ' · each next square costs +' + money(cat.SQUARE_GROW || 70) + ' more. House lots stay fixed.'),
      h('button', { class: 'btn green', disabled: me.money < price, onclick: () => { send({ t: 'buy_square', wx, wy }); closeModal(); } }, 'Buy for ' + money(price))));
  }
  function forageBush(bush) {
    openModal('Forage bush', () => h('div', { class: 'center' },
      h('div', {}, 'Shake the bush. ~5% chance of exclusive furniture / clothes (not sold in shops).'),
      h('button', { class: 'btn green', onclick: () => { send({ t: 'forage', id: bush.id }); closeModal(); } }, 'Forage')));
  }
  function openPetShop() {
    openModal('🐾 Pet Shop', () => {
      const g = h('div', { class: 'grid' });
      (cat.PETS || []).forEach(p => {
        const own = (me.pets || []).includes(p.id);
        g.append(h('div', { class: 'item' + (own ? ' own' : '') }, h('div', { class: 'nm' }, p.name), h('div', { class: 'muted' }, own ? 'Owned' : money(p.price)),
          own ? null : h('button', { class: 'btn sm green', onclick: () => send({ t: 'buy', kind: 'pet', id: p.id }) }, 'Adopt')));
      });
      const stay = h('div', { style: 'margin-top:10px' }, h('div', { class: 'muted' }, 'Where should pets go?'),
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
          [['follow', 'Follow me'], ['farm', 'Stay on farm'], ['house', 'Stay at house']].map(([w, lab]) =>
            h('button', { class: 'btn sm' + ((me.petStay || 'follow') === w ? ' green' : ''), onclick: () => send({ t: 'set_stay', kind: 'pet', where: w }) }, lab))));
      return h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Pets follow you or stay on your farm/house. Livestock is at the pens.'), g, stay);
    });
  }
  function openPen(kind) {
    const a = cat.ANIMALS[kind]; if (!a) return;
    const n = (me.animals && me.animals[kind]) || 0;
    openModal(a.name + ' Pen', () => {
      const box = h('div', { class: 'center' });
      box.append(h('div', {}, 'You own ' + n + ' / ' + a.max));
      box.append(h('button', { class: 'btn green', onclick: () => send({ t: 'buy', kind: 'animal', id: kind }) }, 'Buy ' + a.name + ' · ' + money(a.buy)));
      if (kind === 'chicken') {
        box.append(h('button', { class: 'btn', onclick: () => send({ t: 'collect_eggs' }) }, 'Collect eggs'));
        box.append(h('button', { class: 'btn red', onclick: () => send({ t: 'slaughter', id: 'chicken' }) }, 'Process chicken → meat'));
      } else {
        box.append(h('button', { class: 'btn', onclick: async () => {
          closeModal();
          const ok = await runMinigame('typing', 'Milk the ' + a.name + ' · type carefully');
          send({ t: 'milk', id: kind, ok: ok ? 1 : 0 });
        } }, 'Milk (typing game)'));
        box.append(h('button', { class: 'btn red', onclick: () => send({ t: 'slaughter', id: kind }) }, 'Process → meat' + (kind === 'sheep' ? ' + wool' : '')));
      }
      box.append(h('div', { class: 'muted', style: 'margin-top:8px' }, 'Livestock roam your farm or house lot:'));
      box.append(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        [['farm', 'Roam farm'], ['house', 'Roam house']].map(([w, lab]) =>
          h('button', { class: 'btn sm' + ((me.animalStay || 'farm') === w ? ' green' : ''), onclick: () => send({ t: 'set_stay', kind: 'animal', where: w }) }, lab))));
      box.append(h('div', { class: 'muted' }, 'Sell eggs / milk / wool / meat from your Bag.'));
      return box;
    });
  }

  // ---------- input ----------
  function typing() { return document.activeElement && document.activeElement.tagName === 'INPUT'; }
  const rotate = d => { yawT += d * PI / 4; };
  addEventListener('keydown', e => {
    if (!started) return;
    if (e.key === 'Enter') {
      const ci = $('#chatinput');
      if (document.activeElement === ci) {
        e.preventDefault();
        const t = ci.value.trim();
        if (t) send({ t: 'chat', text: t });
        ci.value = '';
        // stay focused so you can keep chatting without pressing Enter again
        requestAnimationFrame(() => ci.focus());
      } else if (!modalOpen()) { ci.focus(); e.preventDefault(); }
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
  addEventListener('blur', () => { keys.clear(); stick.x = stick.y = 0; stick.active = false; placeKnob(0, 0); });
  $('#b-rl').onclick = () => rotate(-1);
  $('#b-rr').onclick = () => rotate(1);
  let drag = null, touchLookId = null, touchLookX = 0, suppressClick = false;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousedown', e => { if (e.button === 2 || e.button === 1) { drag = e.clientX; e.preventDefault(); } });
  addEventListener('mouseup', () => { drag = null; });
  addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; if (drag !== null) { const d = (e.clientX - drag) * .012; drag = e.clientX; yawT += d; view.yaw += d; } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(18, Math.min(48, zoom * (e.deltaY < 0 ? 1.1 : .91))); }, { passive: false });
  cv.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    clickScreen(e.clientX, e.clientY);
  });

  // phone walk stick + one-finger look on the right half of the screen
  const padEl = $('#walk-pad'), knobEl = $('#walk-knob'), runEl = $('#b-run');
  const PAD_R = 46;
  function placeKnob(nx, ny) {
    if (!knobEl) return;
    knobEl.style.transform = 'translate(' + (nx * PAD_R) + 'px,' + (ny * PAD_R) + 'px)';
  }
  function setStickFromPoint(clientX, clientY) {
    const r = padEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const max = r.width * .42;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    stick.x = dx / max; stick.y = -dy / max; // y+ = forward (screen up)
    stick.active = Math.hypot(stick.x, stick.y) > .12;
    if (!stick.active) { stick.x = 0; stick.y = 0; }
    placeKnob(dx / max, dy / max);
  }
  function clearStick() {
    stick.x = stick.y = 0; stick.active = false; placeKnob(0, 0);
  }
  if (padEl) {
    let stickId = null;
    const fromRun = t => runEl && (t === runEl || runEl.contains(t));
    const onPad = (e, start) => {
      if (!started || modalOpen()) return;
      if (start && fromRun(e.target)) return;
      const t = [...e.changedTouches].find(tt => start ? stickId == null : tt.identifier === stickId);
      if (!t) return;
      if (start) stickId = t.identifier;
      e.preventDefault();
      setStickFromPoint(t.clientX, t.clientY);
    };
    padEl.addEventListener('touchstart', e => onPad(e, true), { passive: false });
    padEl.addEventListener('touchmove', e => onPad(e, false), { passive: false });
    const endPad = e => {
      if ([...e.changedTouches].some(tt => tt.identifier === stickId)) { stickId = null; clearStick(); }
    };
    padEl.addEventListener('touchend', endPad);
    padEl.addEventListener('touchcancel', endPad);
    // mouse fallback (devtools / hybrid)
    let mouseStick = false;
    padEl.addEventListener('mousedown', e => {
      if (e.button !== 0 || !started || fromRun(e.target)) return;
      mouseStick = true; e.preventDefault(); setStickFromPoint(e.clientX, e.clientY);
    });
    addEventListener('mousemove', e => { if (mouseStick) setStickFromPoint(e.clientX, e.clientY); });
    addEventListener('mouseup', () => { if (mouseStick) { mouseStick = false; clearStick(); } });
  }
  if (runEl) {
    const syncRunBtn = () => {
      runEl.classList.toggle('green', stick.run);
      runEl.textContent = stick.run ? '🏃' : '🚶';
      runEl.title = stick.run ? 'Running — tap for walk' : 'Walking — tap for run';
    };
    const toggleRun = () => { stick.run = !stick.run; syncRunBtn(); };
    syncRunBtn();
    runEl.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleRun(); });
    runEl.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
    runEl.addEventListener('contextmenu', e => e.preventDefault());
  }
  cv.addEventListener('touchstart', e => {
    if (!started || modalOpen() || typing()) return;
    const t = e.changedTouches[0];
    if (!t || t.clientX < innerWidth * .42) return; // left side reserved for stick / chat
    touchLookId = t.identifier; touchLookX = t.clientX; suppressClick = false;
  }, { passive: true });
  cv.addEventListener('touchmove', e => {
    const t = [...e.changedTouches].find(tt => tt.identifier === touchLookId);
    if (!t) return;
    const d = (t.clientX - touchLookX) * .014;
    if (Math.abs(d) > .002) suppressClick = true;
    touchLookX = t.clientX; yawT += d; view.yaw += d;
    e.preventDefault();
  }, { passive: false });
  const endLook = e => {
    if ([...e.changedTouches].some(tt => tt.identifier === touchLookId)) touchLookId = null;
  };
  cv.addEventListener('touchend', e => {
    const t = [...e.changedTouches].find(tt => tt.identifier === touchLookId);
    if (t) {
      if (!suppressClick && !modalOpen()) clickScreen(t.clientX, t.clientY);
      suppressClick = true; // block the synthetic mouse click that follows
      setTimeout(() => { suppressClick = false; }, 350);
    }
    endLook(e);
  });
  cv.addEventListener('touchcancel', endLook);
  addEventListener('resize', syncPhoneUI);
  syncPhoneUI();

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

  // ---------- roaming livestock + following pets ----------
  const critters = [];
  function landOriginFor(ownerState, stay) {
    const li = stay === 'house' ? ownerState.houseLand : (stay === 'farm' ? (ownerState.land != null ? ownerState.land : ownerState.expandLand) : null);
    if (li == null || !WD.lands[li]) return null;
    return WD.lands[li];
  }
  function ensureCritter(map, key, kind, pet) {
    let c = map.get(key);
    if (!c) {
      c = { key, kind, pet: !!pet, x: 0, z: 0, tx: 0, tz: 0, psi: 0, walk: 0, wait: 0 };
      map.set(key, c);
    }
    return c;
  }
  function pickRoamTarget(o) {
    return { tx: o.x + 0.6 + Math.random() * (LS - 1.2), tz: o.y + 0.6 + Math.random() * (LS - 1.2) };
  }
  function updateCritters(dt) {
    const next = new Map();
    const owners = [];
    if (me) owners.push({
      n: myName, animals: me.animals || {}, pets: me.pets || [], animalStay: me.animalStay || 'farm', petStay: me.petStay || 'follow',
      land: me.land, houseLand: me.houseLand, expandLand: me.expandLand,
      px: self.x / TILE, pz: self.y / TILE, follow: true,
    });
    for (const n in players) {
      const p = players[n];
      owners.push({
        n: p.n, animals: p.animals || {}, pets: p.pets || [], animalStay: p.animalStay || 'farm', petStay: p.petStay || 'follow',
        land: p.land, houseLand: p.houseLand, expandLand: p.expandLand,
        px: (p.rx || p.x) / TILE, pz: (p.ry || p.y) / TILE, follow: false,
      });
    }
    const prev = new Map(critters.map(c => [c.key, c]));
    for (const own of owners) {
      const aStay = own.animalStay === 'house' ? 'house' : 'farm';
      const aOrigin = landOriginFor(own, aStay) || landOriginFor(own, 'farm');
      if (aOrigin) {
        let ai = 0;
        for (const kind of ['chicken', 'cow', 'sheep']) {
          const n = Math.min(own.animals[kind] || 0, kind === 'cow' ? 4 : kind === 'sheep' ? 6 : 8);
          for (let i = 0; i < n; i++, ai++) {
            const key = own.n + ':a:' + kind + ':' + i;
            const c = ensureCritter(prev, key, kind, false);
            next.set(key, c);
            if (!c.tx) { const t = pickRoamTarget(aOrigin); c.x = t.tx; c.z = t.tz; c.tx = t.tx; c.tz = t.tz; }
            // keep inside current lot
            c._ox = aOrigin.x; c._oy = aOrigin.y; c._roam = true;
          }
        }
      }
      const pets = own.pets || [];
      pets.forEach((pid, i) => {
        const key = own.n + ':p:' + pid;
        const c = ensureCritter(prev, key, pid, true);
        next.set(key, c);
        if (own.petStay === 'follow') {
          c._follow = true; c._fx = own.px; c._fz = own.pz; c._fi = i; c._roam = false;
        } else {
          const pStay = own.petStay === 'house' ? 'house' : 'farm';
          const o = landOriginFor(own, pStay) || landOriginFor(own, 'farm');
          if (o) { c._ox = o.x; c._oy = o.y; c._roam = true; c._follow = false; if (!c.tx) { const t = pickRoamTarget(o); c.x = t.tx; c.z = t.tz; c.tx = t.tx; c.tz = t.tz; } }
        }
      });
    }
    critters.length = 0;
    for (const c of next.values()) {
      if (c._follow) {
        const ang = (c._fi || 0) * 1.7;
        const tx = c._fx - Math.sin(ang) * (0.55 + (c._fi || 0) * 0.15);
        const tz = c._fz - Math.cos(ang) * (0.55 + (c._fi || 0) * 0.15);
        const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
        if (dist > 0.08) {
          const sp = Math.min(2.8, 1.2 + dist) * dt;
          c.x += dx / dist * sp; c.z += dz / dist * sp;
          c.psi += angDiff(c.psi, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
          c.walk += dt * 10;
        }
      } else if (c._roam && c._ox != null) {
        c.wait -= dt;
        const dx = c.tx - c.x, dz = c.tz - c.z, dist = Math.hypot(dx, dz);
        if (dist < 0.12 || c.wait < 0) {
          if (dist < 0.12) c.wait = 0.6 + Math.random() * 2.2;
          const t = pickRoamTarget({ x: c._ox, y: c._oy });
          c.tx = t.tx; c.tz = t.tz;
        } else {
          const sp = (c.kind === 'cow' ? 0.55 : c.pet ? 0.9 : 0.75) * dt;
          c.x += dx / dist * sp; c.z += dz / dist * sp;
          c.psi += angDiff(c.psi, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
          c.walk += dt * 8;
        }
        c.x = Math.max(c._ox + .3, Math.min(c._ox + LS - .3, c.x));
        c.z = Math.max(c._oy + .3, Math.min(c._oy + LS - .3, c.z));
      }
      critters.push(c);
    }
  }

  let last = performance.now(), lastW = 0, lastH = 0;
  function frame(tNow) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (tNow - last) / 1000); last = tNow; const t = tNow / 1000;
    const vw = innerWidth, vh = innerHeight, dpr = window.devicePixelRatio || 1;
    if (vw !== lastW || vh !== lastH) {
      lastW = vw; lastH = vh;
      view.setSize(vw, vh, isPhoneUI() ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75));
    }
    if (lab.width !== Math.round(vw * dpr) || lab.height !== Math.round(vh * dpr)) { lab.width = Math.round(vw * dpr); lab.height = Math.round(vh * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, vw, vh);
    if (!started) { view.prep(); view.clearSky(); view.flush(); return; }

    // movement relative to the camera (WASD / arrows / phone stick)
    let ix = 0, iy = 0;
    if (!modalOpen() && !typing()) {
      if (keys.has('a') || keys.has('arrowleft')) ix--; if (keys.has('d') || keys.has('arrowright')) ix++;
      if (keys.has('w') || keys.has('arrowup')) iy++; if (keys.has('s') || keys.has('arrowdown')) iy--;
      if (stick.active) { ix += stick.x; iy += stick.y; }
    }
    const moving = Math.hypot(ix, iy) > .08;
    if (moving) {
      const s = Math.sin(view.yaw), c = Math.cos(view.yaw);
      let wx = c * ix + s * iy, wz = -s * ix + c * iy; const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      const mag = stick.active ? Math.min(1, Math.hypot(stick.x, stick.y)) : 1;
      const sprint = keys.has('shift') || stick.run;
      const sp = (sprint ? 280 : 190) * dt * mag;
      let nx = Math.max(10, Math.min(WD.width * TILE - 10, self.x + wx * sp)), ny = Math.max(10, Math.min(WD.height * TILE - 10, self.y + wz * sp));
      if (!blocked(nx, self.y)) self.x = nx; if (!blocked(self.x, ny)) self.y = ny;
      self.psi += angDiff(self.psi, Math.atan2(wx, wz)) * Math.min(1, dt * 14); self.walk += dt * 11;
    }
    if (performance.now() - lastSent > 100 && (Math.abs(self.x - sentX) > .5 || Math.abs(self.y - sentY) > .5)) { send({ t: 'move', x: self.x, y: self.y }); sentX = self.x; sentY = self.y; lastSent = performance.now(); }

    // camera
    view.yaw += (yawT - view.yaw) * Math.min(1, dt * 10);
    view.ppt += (zoom - view.ppt) * Math.min(1, dt * 10);
    view.fx += (self.x / TILE - view.fx) * Math.min(1, dt * 9); view.fz += (self.y / TILE - view.fz) * Math.min(1, dt * 9);
    view.hcf = .52; view.focusD = 0; view.prep(); view.clearSky();

    // ground — pastel grass + warm cobble paths (HD-2D tile read)
    const cs = [view.pick(0, 0, 0), view.pick(view.W, 0, 0), view.pick(0, view.H, 0), view.pick(view.W, view.H, 0)];
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c.x))) - 1), x1 = Math.min(WD.width - 1, Math.ceil(Math.max(...cs.map(c => c.x))) + 1);
    const z0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c.z))) - 1), z1 = Math.min(WD.height - 1, Math.ceil(Math.max(...cs.map(c => c.z))) + 1);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const chk = (tx + tz) & 1; let col;
      const li = landGrid[tz][tx];
      const houseFloor = li >= 0 && WD.lands[li] && WD.lands[li].house;
      if (inPark(tx, tz)) col = chk ? '#c8efc0' : '#b8e6b0';
      else if (houseFloor) col = chk ? '#f5e6c8' : '#ead9b4';
      else if (li >= 0) col = chk ? '#d4f2b8' : '#c6eaa8';
      else if (isMargin(tx, tz)) col = chk ? '#b5e0a8' : '#a8d69c';
      else col = chk ? '#e8dcc8' : '#d9cdb8'; // soft cobble lane
      view.quad(tx, tz, tx + 1, tz + 1, 0, col);
    }
    // land floors: soil under plants, house planks, faint grid on my land
    const fpsi = fpsiFor(view.yaw);
    lands.forEach((L, i) => {
      const o = WD.lands[i], meta = WD.lands[i] || {}, mine = L.owner && L.owner === myName;
      if (meta.house) {
        for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) {
          view.quad(o.x + lx + .06, o.y + ly + .06, o.x + lx + .94, o.y + ly + .94, 0, (lx + ly) & 1 ? 'rgba(140,100,50,.22)' : 'rgba(110,75,35,.18)');
        }
      } else if (mine) {
        for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) view.quad(o.x + lx + .04, o.y + ly + .04, o.x + lx + .96, o.y + ly + .96, 0, 'rgba(70,120,40,.16)');
        for (const k of Object.keys(L.extra || {})) {
          const [lx, ly] = k.split(',').map(Number);
          view.quad(o.x + lx + .04, o.y + ly + .04, o.x + lx + .96, o.y + ly + .96, 0, 'rgba(70,120,40,.22)');
        }
      }
      for (const k in L.tiles) {
        const tile = L.tiles[k]; if (tile.type !== 'plant') continue;
        const [lx, ly] = k.split(',').map(Number);
        view.quad(o.x + lx + .05, o.y + ly + .05, o.x + lx + .95, o.y + ly + .95, 0, '#d2b48c');
        for (const f of [.2, .5, .8]) view.quad(o.x + lx + .1, o.y + ly + f - .04, o.x + lx + .9, o.y + ly + f + .04, 0, '#c4a47a');
      }
    });
    const [mbx, mby] = toBuf(mouse.x, mouse.y); const hp = pickAt(mbx, mby);
    hoverTile = hp && !hp.shop ? hp : null;
    if (hoverTile && !modalOpen()) {
      if (hoverTile.buySquare) view.quad(hoverTile.wx, hoverTile.wy, hoverTile.wx + 1, hoverTile.wy + 1, 0, 'rgba(120,200,255,.45)');
      else if (hoverTile.park && WD.park) view.quad(WD.park.x, WD.park.y, WD.park.x + WD.park.w, WD.park.y + WD.park.h, 0, 'rgba(100,220,140,.22)');
      else if (hoverTile.i != null && WD.lands[hoverTile.i] && lands[hoverTile.i]) {
        const o = WD.lands[hoverTile.i], L = lands[hoverTile.i];
        if (L.owner === myName && hoverTile.lx != null) view.quad(o.x + hoverTile.lx, o.y + hoverTile.ly, o.x + hoverTile.lx + 1, o.y + hoverTile.ly + 1, 0, 'rgba(255,255,255,.4)');
        else view.quad(o.x, o.y, o.x + LS, o.y + LS, 0, !L.owner ? 'rgba(255,230,120,.3)' : 'rgba(210,70,50,.14)');
      }
    }

    // objects (statics baked once into GPU group)
    if (!view._staticsBaked) { view.bakeStatic(statics); view._staticsBaked = true; }
    // model home walls/roof: solid outside, transparent inside so furniture shows
    if (npcLot) {
      const shell = insideNpcHome() ? npcShellGhost : npcShellSolid;
      view.add(shell, npcLot.x + LS / 2, 0, npcLot.y + LS / 2 - .4, 0, 1.15);
    }
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
      view.addCharacter(p.a, cat, p.rx / TILE, p.ry / TILE, 1.55); list.push(p);
    }
    view.addCharacter(me.avatar, cat, self.x / TILE, self.y / TILE, 1.65);
    updateCritters(dt);
    for (const c of critters) {
      const sc = c.pet ? 1.15 : (c.kind === 'cow' ? 1.55 : 1.25);
      view.addBillboard(c.kind, c.x, 0, c.z, { pet: !!c.pet, scale: sc });
    }
    view.flush();
    view.finish();

    // labels (crisp text on a full-resolution overlay)
    WD.lands.forEach((o, i) => {
      const L = lands[i]; if (!L) return;
      const mid = [[o.x + 4, o.y], [o.x + 4, o.y + LS], [o.x, o.y + 4], [o.x + LS, o.y + 4]];
      let far = null; for (const [mx, mz] of mid) { const s = toPage(mx, 0, mz); if (!far || s[2] > far[2]) far = s; }
      if (far[0] < -100 || far[0] > vw + 100 || far[1] < -50 || far[1] > vh + 50) return;
      const meta = WD.lands[i] || {};
      const farmIdx = (!meta.expand && !meta.house) ? (i + 1) : null;
      const label = meta.npc || L.npc
        ? 'Model Home · Sunny Homes'
        : L.owner
          ? (L.owner + (meta.house ? "'s house" : "'s farm"))
          : (meta.expand ? 'Expansion Farm · ' + money(cat.EXPAND_COST || 25000)
            : meta.house ? 'House Lot · ' + money(cat.HOUSE_COST || 10000)
              : 'Farm Lot ' + farmIdx + ' — FOR CLAIM');
      lctx.font = 'bold 13px Trebuchet MS'; const w = lctx.measureText(label).width + 18;
      lctx.fillStyle = (meta.npc || L.npc) ? '#ffd8a8' : L.owner ? (L.owner === myName ? '#bff0a8' : '#fff1c9') : (meta.expand ? '#d0ebff' : meta.house ? '#ffe0c7' : '#ffd1c9'); lctx.strokeStyle = '#7a5230'; lctx.lineWidth = 2;
      lctx.beginPath(); lctx.roundRect(far[0] - w / 2, far[1] - 30, w, 20, 6); lctx.fill(); lctx.stroke();
      lctx.fillStyle = '#3b2a1a'; lctx.textAlign = 'center'; lctx.fillText(label, far[0], far[1] - 16); lctx.textAlign = 'left';
    });
    const sc = toPage(WD.shop.x + WD.shop.w / 2, 2.2, WD.shop.y + WD.shop.h / 2);
    lctx.font = 'bold 18px Trebuchet MS'; lctx.textAlign = 'center'; lctx.lineWidth = 4; lctx.strokeStyle = '#6b1a0d'; lctx.strokeText('🏪 SUNNY SHOP', sc[0], sc[1]); lctx.fillStyle = '#fff3c4'; lctx.fillText('🏪 SUNNY SHOP', sc[0], sc[1]); lctx.textAlign = 'left';
    if (nearShop() && !modalOpen()) tag('Press F or click the shop', sc[0], sc[1] + 20, '#ffe066');
    for (const s of (WD.stalls || [])) { const p = toPage(s.x, 1.1, s.y); if (p[0] > -40 && p[0] < vw + 40) tag(s.name, p[0], p[1], '#ffe8a3'); }
    if (WD.petShop) { const p = toPage(WD.petShop.x + WD.petShop.w / 2, 1.8, WD.petShop.y + WD.petShop.h / 2); tag('Pet Shop', p[0], p[1], '#e5dbff'); }
    for (const [id, pen] of Object.entries(WD.pens || {})) { const p = toPage(pen.x + pen.w / 2, 1.2, pen.y + pen.h / 2); tag(id[0].toUpperCase() + id.slice(1) + ' Pen', p[0], p[1], '#fff'); }
    if (WD.park) { const p = toPage(WD.park.x + WD.park.w / 2, 1.4, WD.park.y + WD.park.h / 2); tag('Mini Park', p[0], p[1], '#d3f9d8'); }
    WD.lands.forEach((o, i) => { const p = toPage(o.x + .35, 1.15, o.y + .35); if (p[0] > -20 && p[0] < vw + 20) tag('Post ' + (i + 1), p[0], p[1], '#fff8e1'); });
    for (const p of list) { const s = toPage(p.rx / TILE, 1.85, p.ry / TILE); tag(p.n, s[0], s[1]); if (p.say && p.say.until > Date.now()) bubble(p.say.text, s[0], s[1] - 8); }
    { const s = toPage(self.x / TILE, 1.85, self.y / TILE); tag(me.name, s[0], s[1], '#ffe066'); if (self.say && self.say.until > Date.now()) bubble(self.say.text, s[0], s[1] - 8); }

    let hint = isPhoneUI()
      ? 'Stick to move · tap 🚶/🏃 to toggle · swipe right to look'
      : 'WASD · stalls · park · pets follow / animals roam · Enter chat';
    if (me.land == null) hint = 'Claim a Farm Lot (1–8) · house lots south · expansion east';
    else if (hoverTile) {
      if (hoverTile.stall) hint = 'Click: ' + hoverTile.stall.name;
      else if (hoverTile.bush) hint = 'Click: forage bush (~5% rare loot)';
      else if (hoverTile.pen) hint = 'Click: ' + hoverTile.pen + ' pen';
      else if (hoverTile.petShop) hint = 'Click: Pet Shop';
      else if (hoverTile.park) hint = 'Click: Mini Park (slides & benches)';
      else if (hoverTile.post != null) hint = 'Click: Land post — harvest stats';
      else if (hoverTile.buySquare) hint = 'Click: buy this farm square for ' + money(nextSquarePrice());
      else if (hoverTile.i != null && lands[hoverTile.i]) {
        const L = lands[hoverTile.i];
        const meta = WD.lands[hoverTile.i] || {};
        hint = (meta.npc || L.npc) ? (insideNpcHome() ? 'Inside model home — walls faded' : 'Model home — walk in to see inside')
          : L.owner === myName
            ? (meta.house ? 'Click: plant or decorate house (not expandable)' : 'Click: plant, decorate, harvest · edge expands farm')
            : L.owner ? 'Click plants, decor, or the land post'
              : (meta.expand ? 'Expansion farm · ' + money(cat.EXPAND_COST || 25000) : meta.house ? 'House lot · ' + money(cat.HOUSE_COST || 10000) : 'Unclaimed Farm Lot');
      }
    }
    $('#hint').textContent = hint; $('#hint').style.display = modalOpen() ? 'none' : '';
  }
  requestAnimationFrame(frame);
  window.__sl = { view, self, lands: () => lands };   // handy for debugging in the console

  // ---------- boot ----------
  if (token) { loggedOut = false; authScreen(); connect(); } else authScreen();
})();
