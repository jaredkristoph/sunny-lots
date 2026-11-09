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
  const toastSeen = new Map();
  function toast(msg, bad) {
    const nowT = Date.now();
    if (toastSeen.has(msg) && nowT - toastSeen.get(msg) < 2500) return;     // de-duplicate identical toasts
    toastSeen.set(msg, nowT);
    const box = $('#toasts');
    while (box.children.length >= 4) box.firstChild.remove();
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    box.append(t); setTimeout(() => t.remove(), 3200);
  }

  // ---------- state ----------
  let token = localStorage.getItem('sl_token');
  const market = { p: {}, hist: {}, open: {}, sel: 'BTC', prev: {} };
  let barResult = null;
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
  const furnIcon = f => h('img', { src: iconURL('f' + f.id, () => { const m = Vox.furnModel(f); return Vox.renderIcon(m.boxes.concat(m.dyn ? m.dyn(.5) : []), f.size ? { w: 64, h: 64, ppt: 13, psi: fpsiFor(.78), hcf: .9 } : { w: 64, h: 64, ppt: 46, psi: fpsiFor(.78), hcf: .86 }); }) });
  function clothIcon(it) {
    const a = { ...me.avatar, [it.slot]: it.id };
    return h('img', { src: iconURL('c' + [it.id, a.gender, a.skin, a.hairColor, a.top, a.bottom, a.shoes, a.hat].join('|'), () => spriteCanvas(a, 2, 0)), style: 'width:64px;height:80px;image-rendering:pixelated' });
  }

  // ---------- modal system ----------
  let modalRefresh = null, modalClose = null, modalLocked = false, modalTimer = 0;
  function modalTick(fn, ms) {            // one timer per modal; rebuilding never leaks intervals
    clearInterval(modalTimer); modalTimer = setInterval(fn, ms || 500);
    modalClose = () => { clearInterval(modalTimer); modalTimer = 0; };
  }
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
    clearInterval(modalTimer); modalTimer = 0;
    if (modalClose) { try { modalClose(); } catch (e) { /* ignore */ } }
    modalClose = null; modalRefresh = null; modalLocked = false;
    $('#overlay').hidden = true; $('#overlay').innerHTML = '';
  }
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay' && !modalLocked) closeModal(); });
  const modalOpen = () => !$('#overlay').hidden;
  function tabs(list, cur, set) {
    return h('div', { class: 'tabs' }, list.map(([id, label]) => h('button', { class: 'tab' + (id === cur ? ' on' : ''), onclick: () => { set(id); modalRefresh(); } }, label)));
  }

  // ---------- Bitmonsters ----------
  const MD = window.Mon;
  let monBattle = false;
  const bit = window.MonUI({
    h, $, openModal, closeModal, send, toast, money,
    getMe: () => me, refresh: () => { if (modalRefresh) modalRefresh(); }, isModalOpen: () => modalOpen(),
    getPos: () => ({ x: self.x / TILE, y: self.y / TILE }),
    onBattle: (on, result) => {
      monBattle = on;
      if (on) { keys.clear(); if (typeof clearStick === 'function') clearStick(); }
      else if (result === 'lose' && WD.centers) { const cc = WD.centers.reduce((a, b) => Math.hypot(a.x - self.x / TILE, a.y - self.y / TILE) < Math.hypot(b.x - self.x / TILE, b.y - self.y / TILE) ? a : b); self.x = (cc.x + cc.w / 2) * TILE; self.y = (cc.y + cc.h + 1) * TILE; send({ t: 'move', x: self.x, y: self.y }); toast('You woke up at the Bitmon Center.'); }
    },
  });
  let dailyShown = false;
  setInterval(() => {            // login flow: pick a starter first, then the 7-day reward
    if (!started || !me || !me.mon || monBattle || modalOpen() || !me.charDone) return;
    if (!me.mon.starter) return bit.openStarter();
    if (!me.mon.daily.claimed && !dailyShown) { dailyShown = true; bit.openDaily(); }
  }, 1200);

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
    const po = players[p.n];
    if (po.es !== p.es) { po.es = p.es; po.emote = p.e || null; po.emoteSince = performance.now(); }   // new emote (or cleared)
    Object.assign(po, {
      animalNames: p.animalNames || {}, animalReady: p.animalReady || {}, animalBorn: p.animalBorn || {}, animalSex: p.animalSex || {}, animals: p.animals || {}, pets: p.pets || [], animalStay: p.animalStay || 'farm', petStay: p.petStay || 'follow',
      land: p.land, houseLand: p.houseLand, expandLand: p.expandLand, orc: p.orc || null, car: p.car || null, sp: p.sp || null,
    });
  }
  function onMsg(m) {
    switch (m.t) {
      case 'mail_new': break;
      case 'authfail': logout(); toast('Please log in again.', true); break;
      case 'init':
        me = m.me; myName = me.name; lands = m.lands; SPEED = m.speed; clockOff = m.now - Date.now();
        self.x = m.pos.x; self.y = m.pos.y; self.psi = view.yaw + PI; view.fx = self.x / TILE; view.fz = self.y / TILE;
        players = {}; m.players.forEach(upsert);
        $('#chatlog').innerHTML = ''; m.chat.forEach(addChat);
        $('#hud').hidden = false; $('#chat').hidden = false; $('#auth-root') && $('#auth-root').remove();
        closeModal(); updateHud(); updateOnline(); msMode(false); started = true; syncPhoneUI();
        rebuildLandGrid();
        unstickWall();
        if (!me.charDone) openCreator();
        if (m.mb) bit.start({ view: m.mb, events: [{ k: 'msg', text: 'Back in the battle!' }] });
        break;
      case 'market': { market.p = m.p; for (const k in m.p) { const a = market.hist[k] || (market.hist[k] = []); a.push(m.p[k]); if (a.length > 120) a.shift(); } invTick(); break; }
      case 'market_hist': market.hist = m.hist; market.open = m.open; invTick(true); break;
      case 'bar_result': barResult = m; if (modalRefresh) modalRefresh(); break;
      case 'me': me = m.me; updateHud(); if (modalRefresh && !(typing() && $('#overlay').contains(document.activeElement))) modalRefresh(); break;
      case 'players': {
        const seen = new Set(m.list.map(p => p.n));
        m.list.forEach(upsert);
        for (const n in players) if (!seen.has(n)) delete players[n];
        updateOnline();
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
      case 'casino_info': casino.info[m.game] = m; if (m.game === 'blackjack') casino.bj = m.bj || null; if (m.game === 'highlow') casino.hl = m.hl || null; if (!casino.spinning) casinoRefresh(); break;
      case 'roulette_result': rouletteResult(m.r); break;
      case 'slots_result': playSlots(m.r); break;
      case 'baccarat_result': playBaccarat(m.r); break;
      case 'harvested_many': msel.sel.clear(); msBar(); break;
      case 'orc_work': if (Date.now() - (window._orcT || 0) > 15000) { window._orcT = Date.now(); toast('🧌 Your Orc worked the farm (' + m.n + ' job' + (m.n > 1 ? 's' : '') + ')'); } break;
      case 'pvp_invite': bit.invite(m.from); break;
      case 'mb_start': bit.start(m); break;
      case 'mb_turn': bit.turn(m); break;
      case 'mb_err': bit.err(m.msg); break;
      case 'mb_closed': bit.closed(); break;
      case 'mon_daily_ok': bit.dailyOk(m); break;
      case 'mon_box': bit.onBox(m); break;
      case 'chat': addChat(m); if (m.n === myName) self.say = { text: m.text, until: Date.now() + 6000 }; else if (players[m.n]) players[m.n].say = { text: m.text, until: Date.now() + 6000 }; break;
      case 'sys': addChat({ sys: true, text: m.text }); break;
      case 'err': toast(m.msg, true); if (casino.spinning && casino.game === 'baccarat' && !casino.bac) { clearTimeout(casino.bacWait); casino.spinning = false; casinoRefresh(); }
      if (casino.spinning && casino.game === 'slots' && !casino.slotRunning) { clearTimeout(casino.slotWait); casino.spinning = false; casinoRefresh(); } break;
      case 'ok': toast(m.msg); break;
      case 'steal_result': {
        stealUntil = Date.now() + m.cd;
        if (m.ok) toast('🥷 Success! You stole a ' + (m.gold ? 'golden ' : '') + cat.SEED_BY[m.seed].name + '!'); else toast('🥷 You got spotted and ran off empty-handed. Lie low for a minute.', true);
        break;
      }
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
  const unreadMail = () => ((me && me.mail) || []).filter(m => !m.read).length;
  let lastUnread = 0;
  function updateHud() {
    syncCarBtn();
    $('#hud-name').textContent = '👤 ' + me.name; $('#hud-money').textContent = '💰 ' + money(me.money);
    const n = unreadMail(), b = $('#mail-badge');
    if (b) { b.hidden = !n; b.textContent = n > 9 ? '9+' : n; }
    const mb = $('#b-mail'); if (mb) mb.style.animation = n ? 'mailpulse 1.4s ease-in-out infinite' : '';
    if (n > lastUnread && started) toast('📬 You have new mail!');
    lastUnread = n;
  }
  // ---------- mail (letters from the Sunny Lots team, with optional money to claim) ----------
  let mailOpenId = null;
  function openMail() {
    openModal('📬 Mail', () => {
      const list = (me.mail || []);
      const m = mailOpenId && list.find(x => x.id === mailOpenId);
      if (m) {
        if (!m.read) send({ t: 'mail_read', id: m.id });
        return h('div', {},
          h('button', { class: 'btn sm', onclick: () => { mailOpenId = null; modalRefresh(); } }, '← Back'),
          h('div', { style: 'font-size:20px;font-weight:900;margin:10px 0 2px' }, m.subject),
          h('div', { class: 'muted' }, 'From ' + m.from + ' · ' + new Date(m.ts).toLocaleString()),
          h('div', { style: 'white-space:pre-wrap;margin:12px 0;line-height:1.45' }, m.body || ''),
          m.money > 0 ? h('div', { class: 'center', style: 'padding:12px;border-radius:12px;background:#fff6d6;border:2px solid #e8c76a;margin-bottom:10px' },
            h('div', { style: 'font-size:13px;color:#8a6d1a' }, m.claimed ? 'Gift claimed' : 'A gift is attached!'),
            h('div', { style: 'font-size:26px;font-weight:900' }, '💰 ' + money(m.money)),
            m.claimed ? null : h('button', { class: 'btn green', style: 'margin-top:6px', onclick: () => send({ t: 'mail_claim', id: m.id }) }, 'Claim ' + money(m.money))) : null,
          (!m.money || m.claimed) ? h('button', { class: 'btn', onclick: () => { send({ t: 'mail_delete', id: m.id }); mailOpenId = null; } }, '🗑 Delete') : null);
      }
      if (!list.length) return h('div', { class: 'center muted', style: 'padding:20px' }, 'Your mailbox is empty. Event rewards and news from the team arrive here.');
      return h('div', { class: 'list' }, list.map(x => h('div', { class: 'lrow', style: 'cursor:pointer' + (x.read ? '' : ';background:#fff6d6'), onclick: () => { mailOpenId = x.id; modalRefresh(); } },
        h('div', { style: 'font-size:26px' }, x.money > 0 && !x.claimed ? '🎁' : x.read ? '✉️' : '📩'),
        h('div', { class: 'grow' }, h('b', {}, x.subject), h('div', { class: 'muted' }, new Date(x.ts).toLocaleDateString() + (x.money > 0 ? (x.claimed ? ' · claimed' : ' · ' + money(x.money) + ' to claim') : ''))),
        x.read ? null : h('span', { style: 'width:10px;height:10px;border-radius:50%;background:#e03131' }))));
    });
    mailOpenId = null;
  }

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
  // The wardrobe shows the exact sprite used in the world (HD2D.makeCharSprite), just scaled up.
  function spriteCanvas(av, scale, frame) {
    const src = HD2D.makeCharSprite(av, cat, frame || 0).image;
    const c = document.createElement('canvas');
    c.width = src.width * scale; c.height = src.height * scale;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function avatarPreview() {
    const c = spriteCanvas(me.avatar, 6, 0);
    c.style.cssText = 'width:192px;height:240px;image-rendering:pixelated;background:linear-gradient(#cfeeff,#d8f5c4);border-radius:14px;border:2px solid #b8862b';
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
  const owns = it => (it.price === 0 && it.buyable !== false) || me.clothes.includes(it.id);   // rare drops (price 0, not buyable) only count once found
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
      const mini = spriteCanvas(me.avatar, 3, 0);   // live preview on every tab, so a tap visibly changes your character
      mini.style.cssText = 'display:block;margin:0 auto 8px;width:96px;height:120px;image-rendering:pixelated;background:linear-gradient(#cfeeff,#d8f5c4);border-radius:12px;border:2px solid #b8862b';
      body.append(mini);
      if (tab === 'hat') grid.append(h('div', { class: 'item' + (!me.avatar.hat ? ' own' : ''), onclick: () => { send({ t: 'avatar', hat: '' }); toast('Took your hat off'); }, style: 'cursor:pointer' }, h('div', { style: 'font-size:34px' }, '🚫'), h('div', { class: 'nm' }, 'No hat')));
      items.forEach(it => grid.append(h('div', { class: 'item' + (me.avatar[tab] === it.id ? ' own' : ''), style: 'cursor:pointer', onclick: () => { send({ t: 'avatar', [tab]: it.id }); toast('Wearing ' + it.name); } }, clothIcon(it), h('div', { class: 'nm' }, it.name), h('div', { class: 'muted' }, me.avatar[tab] === it.id ? 'Wearing' : 'Tap to wear'))));
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
  $('#b-mail').onclick = () => me && openMail();

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
  let zoom = 47, yawT = view.yaw, mouse = { x: 0, y: 0 };
  const scaleX = () => innerWidth / Math.max(1, view.W);
  const scaleY = () => innerHeight / Math.max(1, view.H);
  const toBuf = (cx, cy) => [cx / scaleX(), cy / scaleY()];
  const toPage = (X, Y, Z) => { const s = view.toScreen(X, Y, Z); return [s[0] * scaleX(), s[1] * scaleY(), s[2]]; };

  // land lookup (tile coordinates) — includes bought extra squares
  let landGrid = Array.from({ length: WD.height }, () => new Array(WD.width).fill(-1));
  let fencesReady = false;   // set once the static scenery list exists
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
    if (fencesReady) rebuildFences();
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
  // ---- Jar Sea: water tiles, sand beach and a dock (walkable) ----
  const seaSet = new Set((WD.sea && WD.sea.tiles) || []);
  const isSea = (tx, ty) => seaSet.has(tx + ',' + ty);
  const seaOrEdge = (tx, ty) => tx < 0 || ty < 0 || tx >= WD.width || ty >= WD.height || isSea(tx, ty);
  const nearSea = (tx, ty) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isSea(tx + dx, ty + dy)) return true; return false; };
  const WATER = ['#2f8fd0', '#3a9cd9', '#46a9e2', '#52b4ea', '#63c0f0'];
  const dockSet = new Set(), DOCK_X = 10;
  { let sy = null; for (let y = 0; y < WD.height; y++) if (isSea(DOCK_X, y)) { sy = y; break; }
    if (sy != null) for (let y = sy - 1; y <= sy + 3; y++) dockSet.add(DOCK_X + ',' + y); }
  const seaCenter = (() => { let sx = 0, sz = 0, n = 0; for (const k of seaSet) { const [x, z] = k.split(',').map(Number); sx += x; sz += z; n++; } return n ? { x: sx / n + .5, z: sz / n + .5 } : null; })();
  // ---- Sunny Lots wall + Route 1 ----
  const WALL = WD.wall || null;
  const wallSkip = (tx, ty) => isSea(tx, ty) || dockSet.has(tx + ',' + ty);
  const onWallTile = (tx, ty) => !!WALL && ((tx === 0 && ty <= WALL.y1) || (ty === 0 && tx <= WALL.x1) || (tx === Math.floor(WALL.x1) && ty <= WALL.y1) || (ty === Math.floor(WALL.y1) && tx <= WALL.x1));
  const wallHit = (x, y) => {
    if (!WALL) return false;
    const X1 = WALL.x1 * TILE, Y1 = WALL.y1 * TILE, T = WALL.t * TILE, g = WALL.gates.e;
    if (x > X1 + 12 || y > Y1) return false;
    if (wallSkip(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    if (x < T || y < T || y > Y1 - T) return true;
    if (x > X1 - T - 2) return !(y > g.y0 * TILE && y < g.y1 * TILE);
    return false;
  };
  // east-of-wall terrain is generated (seeded) in monsters.js so every client/server sees the same land
  const TR = (MD && MD.TERRAIN) || null, TK = MD ? MD.K : {}, TW = TR ? TR.W : 0;
  const kindAt = (tx, ty) => (TR && tx >= 74 && ty >= 0 && tx < TW && ty < TR.H) ? TR.kind[ty * TW + tx] : 0;
  const inGrass = (tx, ty) => kindAt(tx, ty) === TK.GRASS;
  const GR_COL = [['#7fc34a', '#76ba44', '#85c852', '#6fb340'], ['#dcc592', '#d2ba86'], ['#4d983a', '#448f33', '#559f3f', '#3f8a30'], ['#cdb88f', '#c3ad84', '#d3bf97', '#bba67c']];
  const routeColor = (tx, tz, chk) => {
    const i = tz * TW + tx, k = TR.kind[i], tn = TR.tone[i];
    if (k === TK.PATH) return tn === 0 ? '#c9ae78' : (chk ? '#dcc592' : '#d4bb88');
    if (k === TK.PLAZA) return tn === 0 ? '#b9a47c' : GR_COL[3][(tn + chk) & 3];
    if (k === TK.GRASS) return GR_COL[2][(tn + (chk && tn > 1 ? 1 : 0)) & 3];
    if (k === TK.SAND) return chk ? '#ead38f' : '#e2c984';
    if (k === TK.BRIDGE) return ((tx + tz) & 1) ? '#b98b52' : '#ad8049';
    return GR_COL[0][(tn + (chk && tn === 3 ? 0 : 0)) & 3];
  };
  const unstickWall = () => {
    if (!WALL || !wallHit(self.x, self.y)) return;
    const T = WALL.t * TILE;
    self.x = Math.max(T + 4, Math.min(WALL.x1 * TILE - T - 4, self.x)); self.y = Math.max(T + 4, Math.min(WALL.y1 * TILE - T - 4, self.y));
  };
  const solidRects = [WD.bank, WD.orcMarket, WD.carShop, WD.bar, ...(WD.centers || []), ...(MD ? MD.GYMS : [])].filter(Boolean).map(r => ({ x0: (r.x + .1) * TILE, x1: (r.x + r.w - .1) * TILE, y0: (r.y + .1) * TILE, y1: (r.y + r.h - .55) * TILE }));
  const blocked = (x, y) => (wallHit(x, y) && !wallHit(self.x, self.y)) || solidRects.some(r => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) || (x > shopRect.x0 - 8 && x < shopRect.x1 + 8 && y > shopRect.y0 + 4 && y < shopRect.y1 + 2)
    || (TR && kindAt(Math.floor(x / TILE), Math.floor(y / TILE)) === TK.WATER)
    || (seaSet.size > 0 && isSea(Math.floor(x / TILE), Math.floor(y / TILE)) && !dockSet.has(Math.floor(x / TILE) + ',' + Math.floor(y / TILE)));

  // static scenery (built once from boxes)
  const statics = [];
  const piece = (B, x, z, r) => statics.push({ B, x, z, r: r || 1 });
  const SEAT = Vox.mk().add(0, 0, 0, .34, .13, .34, '#a0703c').add(0, .13, 0, .4, .03, .4, '#c99a62');   // little stool under a sitting player
  for (let ty = 0; ty < WD.height; ty++) for (let tx = 0; tx < WD.width; tx++) {
    if (nearSea(tx, ty) || onWallTile(tx, ty) || (WALL && tx >= 74)) continue;
    if (isMargin(tx, ty) && ((tx * 7 + ty * 13) % 5 === 0)) {
      const v = (tx * 3 + ty) % 3;
      piece(Vox.tree(v), tx + .5 + (((tx * 5 + ty) % 3) - 1) * .12, ty + .5, 1.45 + (v === 1 ? .1 : 0));
    } else if (isMargin(tx, ty) && ((tx * 5 + ty * 11) % 7 === 0)) {
      piece(Vox.wildflower((tx + ty * 3) % 5), tx + .5, ty + .5, .8);
    } else if (isMargin(tx, ty) && ((tx * 11 + ty * 3) % 6 === 0)) {
      piece(Vox.shrub((tx + ty) % 2), tx + .5, ty + .5, 1.0);
    } else if (isMargin(tx, ty) && ((tx * 13 + ty * 7) % 3 === 0)) {
      piece(Vox.tuft((tx + ty) % 4), tx + .3 + ((tx * 7 + ty) % 5) * .1, ty + .3 + ((tx + ty * 3) % 5) * .1, 1.0);
    }
  }
  // ---- Sunny Lots stone wall ----
  const WALL_H = 1.1;
  function buildWall() {
    const C1 = '#a8a392', CAP = '#d2ccba', RED = '#c2493a', RED2 = '#a63a30', WOOD = '#6b4a2a', IRON = '#3a3a40';
    const T = WALL.t, X1 = WALL.x1, Y1 = WALL.y1, G = WALL.gates;
    const runs = (L, skip, gap) => {
      const out = []; let a = null;
      for (let i = 0; i < Math.ceil(L); i++) {
        const lo = i, hi = Math.min(i + 1, L), bad = skip(i) || (gap && hi > gap[0] && lo < gap[1]);
        if (!bad && a == null) a = lo;
        if (bad && a != null) { out.push([a, lo]); a = null; }
      }
      if (a != null) out.push([a, L]);
      return out;
    };
    const seg = (horiz, fixed, a, b) => {
      const n = b - a; if (n < .2) return;
      const B = Vox.mk(), t = T;
      if (horiz) { B.add(0, 0, 0, n, WALL_H, t, C1); B.add(0, WALL_H, 0, n, .08, t + .12, CAP); for (let i = 0; i + .7 <= n; i += 2) B.add(-n / 2 + i + .5, WALL_H + .08, 0, .7, .24, t * .8, CAP); }
      else { B.add(0, 0, 0, t, WALL_H, n, C1); B.add(0, WALL_H, 0, t + .12, .08, n, CAP); for (let i = 0; i + .7 <= n; i += 2) B.add(0, WALL_H + .08, -n / 2 + i + .5, t * .8, .24, .7, CAP); }
      piece(B, horiz ? (a + b) / 2 : fixed + t / 2, horiz ? fixed + t / 2 : (a + b) / 2, n / 2 + 1);
    };
    runs(X1, i => wallSkip(i, 0)).forEach(r => seg(true, 0, r[0], r[1]));
    runs(X1, i => wallSkip(i, Math.floor(Y1)), [G.s.x0, G.s.x1]).forEach(r => seg(true, Y1 - T, r[0], r[1]));
    runs(Y1, i => wallSkip(0, i)).forEach(r => seg(false, 0, r[0], r[1]));
    runs(Y1, i => wallSkip(Math.floor(X1), i), [G.e.y0, G.e.y1]).forEach(r => seg(false, X1 - T, r[0], r[1]));
    const tower = (x, z, w, h) => {
      const B = Vox.mk();
      B.add(0, 0, 0, w, h, w, C1); B.add(0, h * .45, 0, w + .06, .1, w + .06, CAP); B.add(0, h, 0, w + .22, .14, w + .22, CAP);
      B.add(0, h + .14, 0, w * .9, .22, w * .9, RED); B.add(0, h + .36, 0, w * .62, .22, w * .62, RED2); B.add(0, h + .58, 0, w * .3, .22, w * .3, RED); B.add(0, h + .8, 0, .06, .4, .06, '#6b4a2a'); B.add(.12, h + 1.0, 0, .22, .14, .04, '#e03131');
      piece(B, x, z, w + 1.5);
    };
    for (const [x, z] of [[.5, .5], [X1 - .5, .5], [.5, Y1 - .5], [X1 - .5, Y1 - .5]]) tower(x, z, 1.1, 1.7);
    tower(X1 - T / 2, G.e.y0 - .75, 1.3, 2.0); tower(X1 - T / 2, G.e.y1 + .75, 1.3, 2.0);                      // east gate towers
    tower(G.s.x0 - .65, Y1 - T / 2, 1.3, 2.0); tower(G.s.x1 + .65, Y1 - T / 2, 1.3, 2.0);                      // south gate towers
    { const B = Vox.mk(), w = G.s.x1 - G.s.x0;                                                                 // closed south gate (decor)
      B.add(0, 0, 0, w, 1.45, .3, WOOD); for (let i = 0; i < 6; i++) B.add(-w / 2 + (i + .5) * w / 6, 0, .16, .05, 1.45, .04, '#4e3519');
      B.add(0, .3, .17, w, .12, .05, IRON); B.add(0, 1.0, .17, w, .12, .05, IRON); B.add(0, 1.45, 0, w + .1, .1, .36, CAP);
      for (const sx of [-.5, .5]) B.add(sx * .5, .6, .2, .16, .2, .06, '#f2b632');
      piece(B, (G.s.x0 + G.s.x1) / 2, Y1 - T / 2, w); }
    // lanterns either side of the open east gate
    for (const z of [G.e.y0 - .1, G.e.y1 + .1]) { const B = Vox.mk(); B.add(0, 0, 0, .1, .9, .1, WOOD); B.add(0, .9, 0, .26, .26, .26, '#ffe38a', .95); B.add(0, 1.16, 0, .32, .06, .32, WOOD); piece(B, X1 + .45, z, 1); }
  }
  if (WALL) buildWall();
  // ---- Bitmon Center ----
  function centerBoxes() {
    const B = Vox.mk(), wall = '#fbf5ea', wallD = '#e6d9bf', roof = '#e0585a', roofD = '#b43d44', glass = '#a8e0f4', red = '#e03131';
    B.add(0, 0, 0, 5.0, .12, 4.0, '#c9c2b3'); B.add(0, .12, 1.8, 1.8, .08, .3, '#ddd6c5');
    B.add(0, .12, -.1, 4.5, 1.6, 3.2, wall); B.add(0, .12, -.1, 4.56, .28, 3.26, wallD);
    B.add(0, 1.72, -.1, 4.9, .16, 3.6, roofD); B.add(0, 1.88, -.1, 4.5, .2, 3.2, roof); B.add(0, 2.08, -.1, 3.5, .2, 2.6, roof); B.add(0, 2.28, -.1, 2.4, .2, 1.8, roofD);
    B.add(0, .2, 1.52, 1.1, 1.15, .08, '#5b3d22'); B.add(0, .24, 1.57, .94, 1.07, .05, glass, .9); B.add(0, .24, 1.6, .04, 1.07, .05, '#5b3d22');
    for (const x of [-1.6, 1.6]) { B.add(x, .6, 1.52, .9, .75, .08, '#7a6a4c'); B.add(x, .64, 1.57, .78, .65, .05, glass, .9); B.add(x, .64, 1.6, .04, .65, .05, '#7a6a4c'); }
    B.add(0, 1.38, 1.56, .8, .22, .06, '#fff'); B.add(0, 1.38, 1.6, .16, .16, .04, red); B.add(0, 1.38, 1.6, .5, .06, .04, red);
    B.add(0, 2.46, .2, .9, .42, .9, '#ffffff'); B.add(0, 2.7, .2, .92, .2, .92, red); B.add(0, 2.62, .2, .96, .06, .96, '#222'); B.add(0, 2.52, 0.68, .22, .22, .06, '#fff'); B.add(0, 2.56, 0.7, .12, .12, .05, '#222');
    for (const x of [-2.1, 2.1]) { B.add(x, .12, 1.3, .4, .4, .4, '#8a5a2b'); B.add(x, .5, 1.3, .5, .4, .5, '#3fae5a'); }
    return B;
  }
  for (const c of (WD.centers || [])) piece(centerBoxes(), c.x + c.w / 2, c.y + c.h / 2, 3.2);
  function gymBoxes(col) {
    const B = Vox.mk(), wall = '#f4ecdc', wallD = '#ddd0b4';
    B.add(0, 0, 0, 7, .12, 5, '#c9c2b3'); B.add(0, .12, 2.3, 2.4, .1, .4, '#ddd6c5');
    B.add(0, .12, -.2, 6.2, 2.2, 3.8, wall); B.add(0, .12, -.2, 6.26, .3, 3.86, wallD);
    B.add(0, 2.32, -.2, 6.8, .2, 4.3, col); B.add(0, 2.52, -.2, 6.0, .25, 3.6, '#3b2a1a'); B.add(0, 2.77, -.2, 5.0, .2, 3.0, col); B.add(0, 2.97, -.2, 3.2, .2, 2.0, '#3b2a1a');
    for (const x of [-2.6, -1.4, 1.4, 2.6]) { B.add(x, .12, 1.75, .38, 2.2, .38, '#fff'); B.add(x, .12, 1.75, .46, .12, .46, wallD); B.add(x, 2.2, 1.75, .5, .12, .5, '#fff'); }
    B.add(0, .12, 1.72, 1.2, 1.55, .1, '#5b3d22'); B.add(0, .16, 1.78, 1.04, 1.45, .05, '#8a6446'); B.add(.3, .8, 1.82, .08, .14, .04, '#f2b632');
    B.add(0, 1.78, 1.8, 2.2, .46, .06, col); B.add(0, 1.86, 1.84, 2.0, .3, .04, '#fff');
    B.add(0, 3.17, .2, .9, .9, .9, '#ffffff'); B.add(0, 3.17, .2, .96, .22, .96, col); B.add(0, 3.5, .2, .96, .1, .96, '#222');
    return B;
  }
  function shrineBoxes() {
    const B = Vox.mk(), st = '#8d8878', stL = '#b9b3a6';
    B.add(0, 0, 0, 2.6, .12, 2.6, st); B.add(0, .12, 0, 2.2, .1, 2.2, stL);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { B.add(x, .22, z, .32, 1.5, .32, stL); B.add(x, 1.72, z, .42, .12, .42, st); }
    B.add(0, .3, 0, .6, .9, .6, '#9c36b5', .9); B.add(0, 1.2, 0, .4, .5, .4, '#e599f7'); B.add(0, 1.7, 0, .2, .3, .2, '#fff', .9);
    return B;
  }
  if (MD && WALL) {
    for (const g of MD.GYMS) piece(gymBoxes(g.col), g.x + g.w / 2, g.y + g.h / 2, 4);
    for (const L of MD.LEGENDS) piece(shrineBoxes(), L.x, L.y, 2);
  }
  // ---- Route 1 scenery: tall-grass tufts, trees, flowers ----
  if (WALL) {
    const actors = (MD ? MD.NPCS.concat(MD.TRAINERS) : []);
    const near = (x, z) => actors.some(a => Math.hypot(a.x - x, a.y - z) < 1.6);
    const blade = (v) => { const B = Vox.mk(); B.add(-.07, 0, 0, .06, .42 + v * .06, .06, '#3f8a2c'); B.add(.07, 0, .05, .06, .5 + v * .04, .06, '#4ea23a'); return B; };
    const ROCK = (v) => { const B = Vox.mk(); B.add(0, 0, 0, .5 + v * .1, .26, .4 + v * .08, '#8d8a82'); B.add(.04, .2, 0, .34, .16, .28, '#a9a69d'); return B; };
    for (let tz = 0; tz < WD.height; tz++) for (let tx = 74; tx < WD.width; tx++) {
      const d = TR.dec[tz * TW + tx]; if (!d || near(tx, tz)) continue;
      const hsh = (tx * 7 + tz * 13 + tx * tz) % 997, jx = ((tx * 5 + tz * 3) % 7) / 10 - .3, jz = ((tx * 3 + tz * 11) % 7) / 10 - .3;
      if (d === MD.D.TREE) piece(Vox.tree(hsh % 3), tx + .5 + jx * .5, tz + .5 + jz * .5, 1.35 + (hsh % 4) * .08);
      else if (d === MD.D.FLOWER) piece(Vox.wildflower(hsh % 5), tx + .5 + jx, tz + .5 + jz, .8);
      else if (d === MD.D.SHRUB) piece(Vox.shrub(hsh % 2), tx + .5 + jx * .4, tz + .5 + jz * .4, 1.0);
      else if (d === MD.D.BLADE) piece(blade(hsh % 3), tx + .3 + (hsh % 5) * .1, tz + .3 + (hsh % 4) * .13, .6);
      else if (d === MD.D.ROCK) piece(ROCK(hsh % 3), tx + .5, tz + .5, 1);
      else if (d === MD.D.TUFT) piece(Vox.tuft(hsh % 4), tx + .3 + (hsh % 5) * .1, tz + .3 + (hsh % 4) * .1, 1.0);
    }
  }
  // Fences + land posts follow each lot's real footprint (base 8x8 plus bought squares).
  // Rebuilt whenever the land grid changes; the static GPU group is re-baked afterwards.
  const postTop = {};   // land index -> z of the post (just outside the lot's north edge)
  const postPos = i => { const o = WD.lands[i]; return { x: o.x + 1, z: (postTop[i] != null ? postTop[i] : o.y) - .6 }; };
  function rebuildFences() {
    for (let k = statics.length - 1; k >= 0; k--) if (statics[k].dyn) statics.splice(k, 1);
    const add = (B, x, z, r) => statics.push({ B, x, z, r: r || 1, dyn: true });
    const gridAt = (x, y) => (y >= 0 && y < WD.height && x >= 0 && x < WD.width) ? landGrid[y][x] : -2;
    const RAIL = '#a0703c', POST = '#7a5230';
    WD.lands.forEach((o, i) => {
      // post sits above the topmost owned tile in its column, so it never lands on a crop
      let top = o.y; while (gridAt(o.x + 1, top - 1) === i) top--;
      postTop[i] = top;
      const pp = postPos(i); add(Vox.landPost(), pp.x, pp.z, 1.0);
      if (o.npc) return; // model home uses cottage shell + garden, not farm fencing
      const tiles = [];
      for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) tiles.push([o.x + lx, o.y + ly]);
      const L = lands[i];
      if (L && L.extra) for (const k of Object.keys(L.extra)) { const [rx, ry] = k.split(',').map(Number); tiles.push([o.x + rx, o.y + ry]); }
      const corners = new Set();
      for (const [tx, ty] of tiles) {
        if (gridAt(tx, ty) !== i) continue;
        const B = Vox.mk(); let any = false;
        if (gridAt(tx, ty - 1) !== i) { B.add(0, .14, -.5, 1, .05, .05, RAIL).add(0, .28, -.5, 1, .05, .05, RAIL); corners.add(tx + ',' + ty).add((tx + 1) + ',' + ty); any = true; }
        if (gridAt(tx, ty + 1) !== i) { B.add(0, .14, .5, 1, .05, .05, RAIL).add(0, .28, .5, 1, .05, .05, RAIL); corners.add(tx + ',' + (ty + 1)).add((tx + 1) + ',' + (ty + 1)); any = true; }
        if (gridAt(tx - 1, ty) !== i) { B.add(-.5, .14, 0, .05, .05, 1, RAIL).add(-.5, .28, 0, .05, .05, 1, RAIL); corners.add(tx + ',' + ty).add(tx + ',' + (ty + 1)); any = true; }
        if (gridAt(tx + 1, ty) !== i) { B.add(.5, .14, 0, .05, .05, 1, RAIL).add(.5, .28, 0, .05, .05, 1, RAIL); corners.add((tx + 1) + ',' + ty).add((tx + 1) + ',' + (ty + 1)); any = true; }
        if (any) add(B, tx + .5, ty + .5, .8);
      }
      for (const c of corners) {
        const [cx, cz] = c.split(',').map(Number);
        add(Vox.mk().add(0, 0, 0, .09, .4, .09, POST), cx, cz, .8);
      }
    });
    view._staticsBaked = false;   // re-bake the GPU group with the new fences
  }
  (function buildShop() {
    const S = WD.shop;
    for (let j = 0; j < S.h; j++) for (let i = 0; i < S.w; i++) {
      const B = Vox.mk(); B.add(0, 0, 0, 1, 1.5, 1, (i + j) % 2 ? '#f6e7c1' : '#f0dfb5');
      // roof slab is exactly 1 tile wide in x: neighbouring red/white stripes must not overlap, or their coplanar tops z-fight (flicker)
      B.add(0, 1.5, 0, 1.0, .12, 1.1, i % 2 ? '#fff' : '#e5533d');
      if (j === 1 || j === 0) B.add(0, 1.62, 0, 1.0, .12, 1.0, '#b5432f');
      if (j === S.h - 1) {
        if (i === 2) B.add(.25, 0, .5, .5, 1.05, .04, '#7a5230'); else if (i === 3) B.add(-.25, 0, .5, .5, 1.05, .04, '#7a5230');
        else B.add(0, .5, .5, .6, .55, .04, '#bfe8fb');
        B.add(0, 1.08, .72, 1, .08, .45, i % 2 ? '#fff' : '#e5533d');
      }
      statics.push({ B, x: S.x + i + .5, z: S.y + j + .5, r: 1.3, noShadow: true });   // one shop-wide shadow below, not 20 overlapping ones
    }
    statics.push({ B: [], x: 0, z: 0, r: 1, shadowBox: { x0: S.x, x1: S.x + S.w, z0: S.y, z1: S.y + S.h, h: 1.7 } });
    const crate = Vox.mk(); crate.add(0, 0, 0, .5, .4, .5, '#b98a4e').add(0, .4, 0, .52, .04, .52, '#8a6a3a'); piece(crate, S.x - .5, S.y + S.h + .1, .8); piece(crate, S.x + S.w + .5, S.y + S.h + .1, .8);
    piece(Vox.plantBoxes(cat.SEED_BY.pumpkin, 3, false), S.x - .5, S.y + S.h + .1, .6);
    piece(Vox.plantBoxes(cat.SEED_BY.sunflower, 3, false), S.x + S.w + .5, S.y + S.h + .1, .6);
  })();
  for (const k of dockSet) {   // wooden dock: planks, side rails, posts
    const [dx, dy] = k.split(',').map(Number), end = !dockSet.has(dx + ',' + (dy + 1));
    const B = Vox.mk();
    B.add(0, .02, 0, .92, .08, 1, '#a97c50').add(-.3, .1, 0, .22, .015, .96, '#b98a5c').add(.1, .1, 0, .22, .015, .96, '#9a6e44');
    B.add(-.46, .02, -.5, .08, .3, .08, '#6b4423').add(.46, .02, -.5, .08, .3, .08, '#6b4423');
    if (end) B.add(-.46, .02, .5, .08, .3, .08, '#6b4423').add(.46, .02, .5, .08, .3, .08, '#6b4423');
    piece(B, dx + .5, dy + .5, 1);
  }
  (function buildPOIs() {
    for (const s of (WD.stalls || [])) piece(Vox.stallBoxes(s.id), s.x, s.y, 1.4);
    for (const t of (WD.casino || [])) piece(t.id === 'roulette' ? Vox.rouletteBoxes() : t.id === 'slots' ? Vox.slotBoxes() : t.id === 'baccarat' ? Vox.baccaratBoxes() : t.id === 'highlow' ? Vox.highlowBoxes() : Vox.blackjackBoxes(), t.x, t.y, 1.4);
    if (WD.bank) piece(Vox.bankBoxes(), WD.bank.x + WD.bank.w / 2, WD.bank.y + WD.bank.h / 2, 2.4);
    if (WD.carShop) piece(Vox.carShopBoxes(), WD.carShop.x + WD.carShop.w / 2, WD.carShop.y + WD.carShop.h / 2, 2.4);
    if (WD.bar) piece(Vox.barBoxes(), WD.bar.x + WD.bar.w / 2, WD.bar.y + WD.bar.h / 2, 2.4);
    if (WD.orcMarket) piece(Vox.orcMarketBoxes(), WD.orcMarket.x + WD.orcMarket.w / 2, WD.orcMarket.y + WD.orcMarket.h / 2, 2.4);
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
      piece(Vox.tree(0), P.x + 1.2, P.y + 1.5, 1.6); piece(Vox.tree(1), P.x + 8.5, P.y + 5.2, 1.6); piece(Vox.tree(2), P.x + 4.5, P.y + 7.2, 1.5); piece(Vox.shrub(1), P.x + 6.5, P.y + 1.2, 1.1);
    }
    WD.lands.forEach(o => { if (o.npc) piece(Vox.modelHomeBase(), o.x + LS / 2, o.y + LS / 2 - .4, 1.15); }); // solid base/porch always; walls+roof drawn each frame
  })();
  fencesReady = true; rebuildFences();
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
  // ---------- Bitmonster NPCs ----------
  const NPC_LOOKS = [
    { gender: 'male', skin: '#f5cba0', hairColor: '#5a3825', top: 'top_flannel', bottom: 'bot_khaki', hat: 'hat_red_cap', shoes: 'shoe_boots' },
    { gender: 'female', skin: '#ffe0c7', hairColor: '#c0392b', top: 'top_blouse_dots', bottom: 'bot_plaid_skirt', hat: '', shoes: 'shoe_red' },
    { gender: 'male', skin: '#c68642', hairColor: '#2b1b0e', top: 'top_hoodie_red', bottom: 'bot_jeans', hat: 'hat_beanie', shoes: 'shoe_plain' },
    { gender: 'female', skin: '#e0ac69', hairColor: '#2b1b0e', top: 'top_sailor', bottom: 'bot_slacks', hat: 'hat_headband', shoes: 'shoe_plain' },
    { gender: 'female', skin: '#ffe0c7', hairColor: '#e84393', top: 'top_polo_sky', bottom: 'bot_pink_skirt', hat: '', shoes: 'shoe_sandals' },
    { gender: 'male', skin: '#f5cba0', hairColor: '#e6b800', top: 'top_star_tee', bottom: 'bot_overalls', hat: 'hat_straw', shoes: 'shoe_rain' },
    { gender: 'male', skin: '#e0ac69', hairColor: '#d9d9d9', top: 'top_purple_jacket', bottom: 'bot_slacks', hat: 'hat_tophat', shoes: 'shoe_plain' },
    { gender: 'female', skin: '#8d5524', hairColor: '#8e44ad', top: 'top_heart', bottom: 'bot_jeans', hat: 'hat_flowers', shoes: 'shoe_plain' },
    { gender: 'male', skin: '#5c3a1e', hairColor: '#2b1b0e', top: 'top_chef', bottom: 'bot_khaki', hat: 'hat_cowboy', shoes: 'shoe_boots' },
    { gender: 'female', skin: '#f5cba0', hairColor: '#2e86de', top: 'top_tee_white', bottom: 'bot_shorts_grey', hat: 'hat_helmet', shoes: 'shoe_plain' },
  ];
  // ---- driving: cars under players, spouse rides along or follows on foot ----
  const carBoxCache = {};
  const carModel = (id, col) => { const d = carDef(id); if (!d) return null; const c = col || d.col, k = d.kind + c; return carBoxCache[k] || (carBoxCache[k] = Vox.carBoxes(d.kind, c)); };
  const SP_SEAT = .2;
  function drawPerson(av, x, z, scale, walk, moving, car, psi, seat, extra) {   // seat: local x offset inside a car
    if (car && seat != null) { x += seat * Math.cos(psi); z -= seat * Math.sin(psi); moving = false; }
    view.addCharacter(av, cat, x, z, scale, walk, moving, car && seat != null ? Object.assign({ y: .16 }, extra) : extra);
  }
  function drawCarRider(own) {   // own: {x,z (tiles), psi, car:{id,c}, sp:{n,l}, av, walk, moving, key, st, dt, scale, extra}
    const m = own.car ? carModel(own.car.id, own.car.c) : null;
    if (m) view.add(m, own.x, 0, own.z, own.psi, 1);
    drawPerson(own.av, own.x, own.z, own.scale, own.walk, own.moving, !!m, own.psi, m ? (own.sp ? -SP_SEAT : 0) : null, own.extra);
    if (!own.sp) { own.st.on = false; return; }
    const look = NPC_LOOKS[(own.sp.l || 0) % NPC_LOOKS.length];
    if (m) { own.st.on = false; drawPerson(look, own.x, own.z, 1.0, 0, false, true, own.psi, SP_SEAT, { pump: { speed: 2, amp: .02, ph: 2 } }); return; }
    const st = own.st;
    if (!st.on || Math.hypot(st.x - own.x, st.z - own.z) > 8) { st.x = own.x + .9; st.z = own.z + .5; st.on = true; st.walk = 0; }
    const dx = own.x - st.x, dz = own.z - st.z, d = Math.hypot(dx, dz);
    st.moving = d > 1.35;
    if (st.moving) { const stp = Math.min(d - 1.2, (own.moving ? 4.4 : 3.2) * own.dt); st.x += dx / d * stp; st.z += dz / d * stp; st.walk += own.dt * 10; }
    view.addCharacter(look, cat, st.x, st.z, 1.0, st.walk, st.moving, { pump: { speed: 2, amp: .02, ph: 2 } });
  }
  const spFol = { x: 0, z: 0, on: false, walk: 0, moving: false };
  const monFol = { x: 0, z: 0, on: false, walk: 0, moving: false, id: 0, name: '' };
  const monActors = () => (MD && WALL ? MD.NPCS.concat(MD.TRAINERS) : []);
  const beatenSet = () => new Set((me && me.mon && me.mon.beaten) || []);
  let lastGT = '', grassSteps = 0, encCool = 0;
  const watched = {};
  function monStep() {
    if (!me || !me.mon || !me.mon.starter || monBattle || modalOpen()) return;
    const tx = Math.floor(self.x / TILE), ty = Math.floor(self.y / TILE), k = tx + ',' + ty;
    if (k !== lastGT) {
      lastGT = k;
      if (inGrass(tx, ty) && performance.now() > encCool && !myCar()) {
        grassSteps++;
        if (grassSteps >= 3 && Math.random() < 1 / 9) { grassSteps = 0; encCool = performance.now() + 3500; send({ t: 'mon_encounter', route: 'r' + (MD.grassRouteAt(tx, ty) || 1) }); }
      }
    }
    const done = beatenSet();
    for (const tr of MD.TRAINERS) {                  // trainers spot you when you walk up to them
      if (done.has(tr.id) || tr.gym) continue;
      const d = Math.hypot(self.x / TILE - tr.x, self.y / TILE - tr.y);
      if (d < 3.3 && !watched[tr.id]) { watched[tr.id] = 1; keys.clear(); bit.challenge(tr); return; }
      if (d > 7) watched[tr.id] = 0;
    }
  }
  function pickAt(bx, by) {
    // shop (tall building): test a few heights
    for (const Y of [.3, 1, 1.6]) { const g = view.pick(bx, by, Y); if (g.x > WD.shop.x - .05 && g.x < WD.shop.x + WD.shop.w + .05 && g.z > WD.shop.y - .05 && g.z < WD.shop.y + WD.shop.h + .05) return { shop: true }; }
    const g0 = view.pick(bx, by, 0);
    // land posts (outside the north fence of each plot)
    for (let i = 0; i < WD.lands.length; i++) {
      const pp = postPos(i);
      if (Math.hypot(g0.x - pp.x, g0.z - pp.z) < .7) return { post: i };
    }
    // livestock: click the animal itself (screen-space box around the sprite)
    { let cb = null;
      for (const c of critters) {
        if (!c.live) continue;
        const f = view.toScreen(c.x, 0, c.z), tp = view.toScreen(c.x, c.isOrc ? 1.5 : c.kind === 'cow' ? 1.1 : c.pet ? .7 : .9, c.z), hw = Math.max(14, view.ppt * .4);
        if (Math.abs(bx - f[0]) < hw && by < f[1] + 6 && by > tp[1] - 4 && (!cb || f[2] < cb.d)) cb = { c, d: f[2] };
      }
      if (cb) return { critter: cb.c }; }
    { let pb = null;     // other players (click to challenge)
      for (const n in players) {
        const p = players[n], f = view.toScreen(p.rx / TILE, 0, p.ry / TILE), tp = view.toScreen(p.rx / TILE, 1.2, p.ry / TILE), hw = Math.max(14, view.ppt * .35);
        if (Math.abs(bx - f[0]) < hw && by < f[1] + 6 && by > tp[1] - 4 && (!pb || f[2] < pb.d)) pb = { n, d: f[2] };
      }
      if (pb) return { player: pb.n }; }
    { let ab = null;     // NPCs + trainers (screen-space box around the sprite)
      for (const a of monActors()) {
        const f = view.toScreen(a.x, 0, a.y), tp = view.toScreen(a.x, 1.25, a.y), hw = Math.max(14, view.ppt * .4);
        if (Math.abs(bx - f[0]) < hw && by < f[1] + 6 && by > tp[1] - 4 && (!ab || f[2] < ab.d)) ab = { a, d: f[2] };
      }
      if (ab) return ab.a.team ? { trainer: ab.a } : { npc: ab.a }; }
    for (const t of (WD.casino || [])) if (Math.hypot(g0.x - t.x, g0.z - t.y) < 1.4) return { casino: t };
    for (const [kk, r] of [['bank', WD.bank], ['orcMarket', WD.orcMarket], ['carShop', WD.carShop], ['bar', WD.bar]]) if (r && g0.x > r.x - .1 && g0.x < r.x + r.w + .1 && g0.z > r.y - 1.6 && g0.z < r.y + r.h + .1) return { [kk]: true };
    for (const r of (WD.centers || [])) if (g0.x > r.x - .1 && g0.x < r.x + r.w + .1 && g0.z > r.y - 1.6 && g0.z < r.y + r.h + .1) return { center: true };
    if (MD && WALL) {
      for (const g of MD.GYMS) if (g0.x > g.x - .1 && g0.x < g.x + g.w + .1 && g0.z > g.y - 1.8 && g0.z < g.y + g.h + .1) return { gym: g };
      for (const L of MD.LEGENDS) if (Math.hypot(g0.x - L.x, g0.z - L.y) < 1.6) return { shrine: L };
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
        const tile = L.tiles[k]; if (tile.type === 'part') continue;
        const [lx, ly] = k.split(',').map(Number), sz = tile.type === 'furn' ? ((cat.FURN_BY[tile.id] || {}).size || 1) : 1, hf = sz > 1 ? sz / 2 - .1 : .4;
        const wx = o.x + lx + sz / 2, wz = o.y + ly + sz / 2;
        const H = tile.type === 'furn' ? (Vox.furnModel(cat.FURN_BY[tile.id] || { shape: 'stool', v: 0, pal: ['#ccc', '#aaa', '#888'] }).h) : plantH(tile);
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        for (const [a, y, b] of [[-hf, 0, -hf], [hf, 0, -hf], [hf, 0, hf], [-hf, 0, hf], [-hf, H, -hf], [hf, H, -hf], [hf, H, hf], [-hf, H, hf]]) { const s = view.toScreen(wx + a, y, wz + b); mnx = Math.min(mnx, s[0]); mxx = Math.max(mxx, s[0]); mny = Math.min(mny, s[1]); mxy = Math.max(mxy, s[1]); }
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
        && landGrid[wy] && landGrid[wy][wx] < 0 && !inPark(wx, wy) && !isSea(wx, wy) && isAdjToMyLand(wx, wy)) {
      return { buySquare: true, wx, wy };
    }
    return null;
  }
  function clickScreen(cx, cy) {
    if (!me || modalOpen()) return;
    const [bx, by] = toBuf(cx, cy), hit = pickAt(bx, by);
    if (!hit) return;
    if (msel.on && hit.i != null && hit.lx != null) return msToggle(hit.i, hit.lx, hit.ly);
    if (hit.shop) return tryShop();
    if (hit.bank) return openBank();
    if (hit.orcMarket) return openOrc();
    if (hit.carShop) return openCarShop();
    if (hit.bar) return openBar();
    if (hit.center) return bit.openCenter();
    if (hit.gym) return bit.challenge(MD.TRAINERS.find(t => t.id === hit.gym.id));
    if (hit.shrine) return bit.shrine(hit.shrine);
    if (hit.player) return openPlayerMenu(hit.player);
    if (hit.npc) return bit.talk(hit.npc);
    if (hit.trainer) return bit.challenge(hit.trainer);
    if (hit.critter) return openCritter(hit.critter);
    if (hit.casino) return openCasino(hit.casino.id);
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
        let tile = L.tiles[hit.lx + ',' + hit.ly];
        if (tile && tile.type === 'part') tile = L.tiles[tile.k];
        if (tile && tile.type === 'plant') { const kk = L.tiles[hit.lx + ',' + hit.ly].type === 'part' ? L.tiles[hit.lx + ',' + hit.ly].k : hit.lx + ',' + hit.ly, [sx, sy] = kk.split(',').map(Number); return viewOtherCrop(L.owner, tile, hit.i, sx, sy); }
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
  function openSendMoney(name) {
    openModal('💸 Send money', () => {
      const inp = h('input', { class: 'txt', type: 'number', min: 1, placeholder: 'Amount in $', style: 'width:150px' });
      const go = () => { const a = Number(inp.value); if (!(a >= 1)) return toast('Enter an amount first.', true); send({ t: 'send_money', to: name, amount: a }); closeModal(); };
      inp.onkeydown = e => { if (e.key === 'Enter') go(); };
      setTimeout(() => inp.focus(), 50);
      return h('div', { class: 'center', style: 'gap:8px' }, h('div', {}, 'Send cash to ', h('b', {}, name)), h('div', { class: 'muted' }, 'You have ' + money(me.money)), inp, h('button', { class: 'btn green', onclick: go }, 'Send'));
    });
  }
  let stealUntil = 0;
  function viewOtherCrop(owner, tile, land, tx, ty) {
    const sd = cat.SEED_BY[tile.seed]; if (!sd) return;
    const total = growMs(sd);
    openModal(owner + "'s " + sd.name, () => {
      const bar = h('div', { style: 'width:100%;height:100%' });
      const left = h('div', { style: 'font-size:20px;font-weight:700' });
      const stealBtn = h('button', { class: 'btn', onclick: () => send({ t: 'steal', land, tx, ty }) }, '🥷 Steal');
      const upd = () => {
        const p = Math.min(1, (now() - tile.at) / total), cd = Math.ceil((stealUntil - Date.now()) / 1000);
        bar.style.width = (p * 100) + '%';
        left.textContent = p >= 1 ? 'Ready to harvest!' : fmtLeft(tile.at + total - now()) + ' left';
        stealBtn.style.display = p >= 1 ? '' : 'none'; stealBtn.disabled = cd > 0;
        stealBtn.textContent = cd > 0 ? '🥷 Lie low ' + cd + 's' : '🥷 Steal (' + Math.round(cat.STEAL.chance * 100) + '% chance)';
      };
      upd(); modalTick(upd, 500);
      return h('div', { class: 'center' }, plantIcon(sd, !!tile.gold), left, h('div', { class: 'bar', style: 'width:100%' }, bar), h('div', { class: 'muted' }, 'You cannot harvest their crops, but you could try to sneak one...'), stealBtn);
    });
  }

  // ---------- land tile menus ----------
  function tileMenu(land, tx, ty) {
    let key = tx + ',' + ty, tile = lands[land].tiles[key];
    if (tile && tile.type === 'part') { key = tile.k; [tx, ty] = key.split(',').map(Number); tile = lands[land].tiles[key]; }
    if (!tile) return plantMenu(land, tx, ty);
    if (tile.type === 'furn') {
      const f = cat.FURN_BY[tile.id];
      return openModal(f.name, () => h('div', { class: 'center' }, furnIcon(f),
        f.size ? h('div', { class: 'muted' }, 'Takes up ' + f.size + '×' + f.size + ' tiles') : null,
        h('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:8px' },
          h('button', { class: 'btn green', onclick: () => send({ t: 'rotate', land, tx, ty }) }, '🔄 Rotate'),
          h('button', { class: 'btn', onclick: () => { send({ t: 'pickup', land, tx, ty }); closeModal(); } }, 'Pick up (back to bag)')),
        h('div', { class: 'muted', style: 'margin-top:6px' }, 'Rotate turns it a quarter-turn each tap.')));
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
      upd(); modalTick(upd, 500);
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
        ent.forEach(f => g.append(h('div', { class: 'item' }, furnIcon(f), h('div', { class: 'nm' }, f.name), h('div', { class: 'muted' }, '×' + me.furniture[f.id] + (f.size ? ' · ' + f.size + '×' + f.size : '')), h('button', { class: 'btn sm green', onclick: () => { send({ t: 'place', land, tx, ty, furn: f.id }); closeModal(); } }, 'Place'))));
        b.append(g);
      }
      return b;
    });
  }

  // ---------- ☑️ multi-select: plant / harvest many tiles at once ----------
  const msel = { on: false, land: null, sel: new Map() };           // sel: "lx,ly" -> {lx,ly}
  let msBarEl = null;
  const tileReady = t => t && t.type === 'plant' && cat.SEED_BY[t.seed] && now() >= t.at + growMs(cat.SEED_BY[t.seed]);
  function msKeysOfLand(i) {
    const out = [], L = lands[i];
    for (let y = 0; y < LS; y++) for (let x = 0; x < LS; x++) out.push(x + ',' + y);
    if (L && L.extra) for (const k of Object.keys(L.extra)) out.push(k);
    return out;
  }
  function msMyLand() { return msel.land != null ? msel.land : (me.land != null ? me.land : me.expandLand); }
  function msMode(on) {
    msel.on = on; msel.sel.clear(); if (!on) msel.land = null;
    const b = $('#b-multi'); if (b) { b.textContent = on ? '✅ Selecting…' : '☑️ Select'; b.classList.toggle('green', on); }
    msBar();
  }
  function msToggle(i, lx, ly) {
    const L = lands[i];
    if (!L || L.owner !== myName) return toast('Select mode works on your own land.', true);
    if (msel.land != null && msel.land !== i) msel.sel.clear();
    msel.land = i;
    const k = lx + ',' + ly, tile = L.tiles[k];
    if (tile && tile.type !== 'plant') return toast(tile.type === 'furn' ? 'Decor can’t be selected.' : 'That tile is part of a bigger piece.', true);
    if (msel.sel.has(k)) msel.sel.delete(k); else msel.sel.set(k, { lx, ly });
    msBar();
  }
  function msSplit() {
    const i = msMyLand(), L = lands[i], empty = [], ready = [], growing = [];
    if (L) for (const [k, s] of msel.sel) { const t = L.tiles[k]; if (!t) empty.push([s.lx, s.ly]); else if (tileReady(t)) ready.push([s.lx, s.ly]); else growing.push(k); }
    return { i, empty, ready, growing };
  }
  function msBar() {
    if (!msBarEl) {
      msBarEl = h('div', { id: 'msbar', style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:15;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:96vw;background:#fff8e1;border:3px solid #b8862b;border-radius:14px;padding:8px 10px;box-shadow:0 4px 14px rgba(0,0,0,.25)' });
      document.body.append(msBarEl);
    }
    msBarEl.hidden = !msel.on;
    if (!msel.on) return;
    const sp = msSplit(), land = sp.i;
    msBarEl.replaceChildren(
      h('div', { style: 'width:100%;text-align:center;font-weight:800' }, '☑️ Select mode · ' + msel.sel.size + ' picked' + (msel.sel.size ? ' (' + sp.empty.length + ' empty · ' + sp.ready.length + ' ready · ' + sp.growing.length + ' growing)' : ' — tap your tiles')),
      h('button', { class: 'btn sm', onclick: () => { if (land == null) return toast('Claim a land first.', true); msel.land = land; msel.sel.clear(); for (const k of msKeysOfLand(land)) { const t = lands[land].tiles[k]; if (!t) { const [x, y] = k.split(',').map(Number); msel.sel.set(k, { lx: x, ly: y }); } } msBar(); } }, 'All empty'),
      h('button', { class: 'btn sm', onclick: () => { if (land == null) return toast('Claim a land first.', true); msel.land = land; msel.sel.clear(); for (const k of msKeysOfLand(land)) { if (tileReady(lands[land].tiles[k])) { const [x, y] = k.split(',').map(Number); msel.sel.set(k, { lx: x, ly: y }); } } if (!msel.sel.size) toast('Nothing is ready yet.', true); msBar(); } }, 'All ready'),
      h('button', { class: 'btn sm green', disabled: !sp.empty.length, onclick: () => msPlantPicker() }, '🌱 Plant (' + sp.empty.length + ')'),
      h('button', { class: 'btn sm green', disabled: !sp.ready.length, onclick: () => { send({ t: 'harvest_many', land, tiles: sp.ready }); } }, '🧺 Harvest (' + sp.ready.length + ')'),
      h('button', { class: 'btn sm', onclick: () => send({ t: 'harvest_many', all: true }) }, '🌾 Harvest ALL ready'),
      h('button', { class: 'btn sm', disabled: !msel.sel.size, onclick: () => { msel.sel.clear(); msBar(); } }, 'Clear'),
      h('button', { class: 'btn sm red', onclick: () => msMode(false) }, 'Done'));
  }
  function msPlantPicker() {
    const sp = msSplit(); if (!sp.empty.length) return;
    openModal('🌱 Plant on ' + sp.empty.length + ' tile' + (sp.empty.length > 1 ? 's' : ''), () => {
      const ent = cat.SEEDS.filter(s => me.seeds[s.id] > 0);
      if (!ent.length) return h('div', { class: 'muted' }, 'You have no seeds. Buy some at the shop 🏪.');
      const list = h('div', { class: 'list' });
      ent.forEach(sd => {
        const n = Math.min(me.seeds[sd.id], sp.empty.length);
        list.append(h('div', { class: 'lrow' }, plantIcon(sd, false),
          h('div', { class: 'grow' }, h('b', {}, sd.name), h('div', { class: 'muted' }, 'You have ' + me.seeds[sd.id] + ' · grows ' + fmtHours(sd.hours))),
          h('button', { class: 'btn green', onclick: () => { send({ t: 'plant_many', land: sp.i, tiles: sp.empty, seed: sd.id }); closeModal(); } }, 'Plant ' + n)));
      });
      return list;
    });
  }
  $('#b-multi').onclick = () => { if (!me) return; if (me.land == null && me.expandLand == null) return toast('Claim a land first — click an empty land.', true); msMode(!msel.on); };

  // ---------- 🟢 players online ----------
  function updateOnline() {
    const el = $('#hud-online'); if (!el) return;
    const n = Object.keys(players).length + (me ? 1 : 0);
    el.textContent = '🟢 ' + n + ' online';
  }
  function openPlayerMenu(name) {
    openModal('👤 ' + name, () => h('div', { class: 'center', style: 'gap:8px' }, h('div', {}, 'Trainer ' + name),
      me.mon && me.mon.starter ? h('button', { class: 'btn green', onclick: () => { closeModal(); bit.challengePlayer(name); } }, '⚔ Challenge to a friendly battle') : h('div', { class: 'muted' }, 'Pick a starter first.'),
      h('button', { class: 'btn', onclick: closeModal }, 'Close')));
  }
  function openOnline() {
    openModal('🟢 Players online', () => {
      const names = [myName, ...Object.keys(players).sort()];
      return h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:6px' }, names.length + (names.length === 1 ? ' player is' : ' players are') + ' on the farm right now.'),
        h('div', { class: 'list' }, names.map(n => h('div', { class: 'lrow' }, h('span', {}, n === myName ? '⭐' : '👤'), h('b', { class: 'grow' }, n + (n === myName ? ' (you)' : '')), n !== myName && me.mon && me.mon.starter ? h('button', { class: 'btn sm', onclick: () => { closeModal(); bit.challengePlayer(n); } }, '⚔ Battle') : null))));
    });
  }
  $('#hud-online').onclick = () => me && openOnline();

  // ---------- 🧌 Orc Market ----------
  function openOrc() {
    openModal('🧌 Orc Market', () => {
      const O = cat.ORC, o = me.orc;
      if (!o) {
        return h('div', { class: 'center', style: 'gap:8px' },
          h('div', { style: 'font-size:56px' }, '🧌'),
          h('div', { style: 'font-size:20px;font-weight:900' }, 'Hire a farm Orc — ' + money(O.price)),
          h('div', {}, 'He harvests your ripe crops and replants your seeds automatically, even while you are busy (or away).'),
          h('div', { class: 'muted' }, '✔ Auto-harvest  ✔ Auto-plant  ✔ Follows you or roams the farm  ·  one Orc per player'),
          h('div', { class: 'muted' }, 'You have ' + money(me.money)),
          h('button', { class: 'btn green', disabled: me.money < O.price, onclick: () => send({ t: 'buy_orc' }) }, me.money < O.price ? 'Need ' + money(O.price - me.money) + ' more' : 'Hire the Orc · ' + money(O.price)));
      }
      const nameInp = h('input', { class: 'txt', maxlength: 14, value: o.name || 'Orc', style: 'width:150px' });
      const saveName = () => { if (nameInp.value.trim() && nameInp.value.trim() !== o.name) send({ t: 'orc_set', name: nameInp.value }); };
      nameInp.onkeydown = e => { if (e.key === 'Enter') { saveName(); nameInp.blur(); } };
      nameInp.onchange = saveName;
      const toggle = (label, key, desc) => h('button', { class: 'btn ' + (o[key] ? 'green' : ''), style: 'width:100%;text-align:left;display:flex;justify-content:space-between;gap:8px', onclick: () => send({ t: 'orc_set', [key]: !o[key] }) },
        h('span', {}, label, h('div', { style: 'font-size:12px;font-weight:600;opacity:.8' }, desc)), h('b', {}, o[key] ? 'ON' : 'OFF'));
      const sel = h('select', { class: 'txt', onchange: e => send({ t: 'orc_set', seed: e.target.value }), style: 'width:100%' },
        h('option', { value: 'any', selected: o.seed === 'any' }, 'Any seed I have'),
        cat.SEEDS.map(s => h('option', { value: s.id, selected: o.seed === s.id }, s.name + ' (you have ' + (me.seeds[s.id] || 0) + ')')));
      const modeBtn = (m, label) => h('button', { class: 'btn' + (o.mode === m ? ' green' : ''), style: 'flex:1', onclick: () => send({ t: 'orc_set', mode: m }) }, label);
      const hasLand = me.land != null || me.expandLand != null;
      return h('div', { class: 'center', style: 'gap:8px;text-align:left' },
        h('div', { class: 'row', style: 'align-items:center;justify-content:center;gap:10px' }, h('span', { style: 'font-size:44px' }, '🧌'), nameInp, h('button', { class: 'btn sm', onclick: saveName }, 'Rename')),
        hasLand ? null : h('div', { class: 'muted' }, 'Claim a land first — the Orc works on your farm.'),
        h('b', {}, 'Jobs'),
        toggle('🧺 Auto-harvest ripe crops', 'harvest', 'Picks every ripe plant on your land into your bag'),
        toggle('🌱 Auto-plant seeds', 'plant', 'Fills empty tiles using seeds from your bag'),
        h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:2px' }, 'Seed to plant'), sel),
        h('b', {}, 'Behavior'),
        h('div', { class: 'row', style: 'gap:8px' }, modeBtn('follow', '🚶 Follow me'), modeBtn('roam', '🌾 Roam the farm')),
        h('div', { class: 'muted', style: 'font-size:12px' }, 'The Orc does up to ' + O.perTick + ' jobs every ' + (O.tickMs / 1000) + 's. Click him in the world any time to open this panel.'));
    });
  }
  $('#b-orc').onclick = () => me && openOrc();
  $('#b-mon').onclick = () => me && bit.openParty();
  $('#b-map').onclick = () => me && bit.openMap();


  // ---------- 📈 Investing (Bitbean, gold, stocks, funds, bonds — prices move every second) ----------
  const fmtP = n => n == null ? '—' : '$' + (n >= 1000 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(2));
  const spark = (arr, w, hh, col) => {
    if (!arr || arr.length < 2) return '';
    const mn = Math.min(...arr), mx = Math.max(...arr), rg = (mx - mn) || 1;
    const pts = arr.map((v, i) => (i / (arr.length - 1) * w).toFixed(1) + ',' + (hh - 2 - (v - mn) / rg * (hh - 4)).toFixed(1)).join(' ');
    return '<svg width="' + w + '" height="' + hh + '" viewBox="0 0 ' + w + ' ' + hh + '"><polyline fill="none" stroke="' + col + '" stroke-width="1.6" points="' + pts + '"/></svg>';
  };
  const holdOf = sym => (me && me.invest && me.invest[sym]) || { units: 0, cost: 0 };
  const portfolio = () => { let v = 0, c = 0; for (const a of cat.MARKET) { const hd = holdOf(a.sym); if (hd.units > 0) { v += hd.units * (market.p[a.sym] || a.base); c += hd.cost; } } return { v, c }; };
  function invTick(force) {
    if (!$('#inv-root')) return;
    for (const a of cat.MARKET) {
      const pr = market.p[a.sym]; if (pr == null) continue;
      const open = market.open[a.sym] || a.base, chg = (pr / open - 1) * 100, up = pr >= (market.prev[a.sym] || pr), hist = market.hist[a.sym] || [];
      const e1 = $('#ip-' + a.sym), e2 = $('#ic-' + a.sym), e3 = $('#is-' + a.sym), e4 = $('#iv-' + a.sym);
      if (e1) { e1.textContent = fmtP(pr); e1.style.color = up ? '#2b8a3e' : '#c92a2a'; }
      if (e2) { e2.textContent = (chg >= 0 ? '▲ ' : '▼ ') + Math.abs(chg).toFixed(2) + '%'; e2.style.color = chg >= 0 ? '#2b8a3e' : '#c92a2a'; }
      if (e3) e3.innerHTML = spark(hist.slice(-60), 80, 24, chg >= 0 ? '#2b8a3e' : '#c92a2a');
      const hd = holdOf(a.sym);
      if (e4) { if (hd.units > 0) { const val = hd.units * pr, pl = val - hd.cost; e4.innerHTML = '<b>' + money(val) + '</b><div style="font-size:11px;color:' + (pl >= 0 ? '#2b8a3e' : '#c92a2a') + '">' + (pl >= 0 ? '+' : '−') + money(Math.abs(pl)) + '</div>'; } else e4.textContent = ''; }
      market.prev[a.sym] = pr;
    }
    const pf = portfolio(), t = $('#inv-total');
    if (t) { const pl = pf.v - pf.c; t.innerHTML = 'Portfolio <b>' + money(pf.v) + '</b> <span style="color:' + (pl >= 0 ? '#2b8a3e' : '#c92a2a') + '">(' + (pl >= 0 ? '+' : '−') + money(Math.abs(pl)) + ')</span>'; }
    const ch = $('#inv-chart'), sel = cat.MARKET.find(a => a.sym === market.sel);
    if (ch && sel) { const hist = market.hist[sel.sym] || [], pr = market.p[sel.sym]; const chg = pr != null ? pr / (market.open[sel.sym] || sel.base) - 1 : 0; ch.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline"><b>' + sel.name + ' (' + sel.sym + ')</b><b style="font-size:18px">' + fmtP(pr) + '</b></div>' + spark(hist, 440, 90, chg >= 0 ? '#2b8a3e' : '#c92a2a') + '<div class="muted" style="font-size:11px">last ' + hist.length + ' seconds</div>'; }
  }
  function buildInvest() {
    const root = h('div', { id: 'inv-root', style: 'display:flex;flex-direction:column;gap:8px' });
    const amt = h('input', { class: 'txt', type: 'number', min: 1, step: 'any', placeholder: 'Amount in $', value: bankUI.iamt || '', style: 'width:140px' });
    amt.oninput = () => { bankUI.iamt = amt.value; };
    const buy = v => { const a = v === 'all' ? 'all' : Number(v); if (v !== 'all' && !(a > 0)) return toast('Enter an amount first.', true); send({ t: 'invest_buy', sym: market.sel, amount: a }); };
    const sell = u => send({ t: 'invest_sell', sym: market.sel, units: u === 'all' ? 'all' : holdOf(market.sel).units * u });
    root.append(
      h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap;gap:6px' }, h('div', { id: 'inv-total' }), h('div', { class: 'muted' }, 'Cash ' + money(me.money) + ' · fee ' + (cat.INVEST_FEE * 100).toFixed(1) + '% per trade')),
      h('div', { id: 'inv-chart', style: 'background:#fff;border:2px solid #e3c88a;border-radius:10px;padding:6px 10px' }),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, amt,
        h('button', { class: 'btn green', onclick: () => buy(amt.value) }, 'Buy ' + market.sel), h('button', { class: 'btn sm', onclick: () => buy('all') }, 'All cash'),
        h('button', { class: 'btn sm', onclick: () => sell(.25) }, 'Sell 25%'), h('button', { class: 'btn sm', onclick: () => sell(.5) }, 'Sell 50%'), h('button', { class: 'btn', onclick: () => sell('all') }, 'Sell all')),
      h('div', { class: 'list' }, cat.MARKET.map(a => h('div', { class: 'lrow', style: 'cursor:pointer;gap:8px;' + (a.sym === market.sel ? 'background:#fff6d6' : ''), onclick: () => { market.sel = a.sym; modalRefresh(); invTick(); } },
        h('span', { style: 'width:46px;font-weight:900' }, a.sym), h('span', { class: 'grow' }, h('div', {}, a.name), h('div', { class: 'muted', style: 'font-size:11px' }, a.kind)),
        h('span', { id: 'is-' + a.sym }), h('span', { style: 'text-align:right;min-width:92px' }, h('b', { id: 'ip-' + a.sym }), h('div', { id: 'ic-' + a.sym, style: 'font-size:11px' })), h('span', { id: 'iv-' + a.sym, style: 'text-align:right;min-width:78px' })))),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Prices are shared by everyone and wander up and down every second. Bitbean is wild, bonds are calm. Past results are no promise of future ones!'));
    setTimeout(() => invTick(), 0);
    return root;
  }

  // ---------- 🚗 Sunny Motors + driving ----------
  const carDef = id => (cat.CARS || []).find(c => c.id === id) || null;
  const myCar = () => (me && me.car ? carDef(me.car) : null);
  const carColor = (id, col) => col || (carDef(id) || {}).col;
  const carIcon = (c, col) => h('img', { style: 'width:96px;height:64px', src: iconURL('car' + c.id + col, () => Vox.renderIcon(Vox.carBoxes(c.kind, col), { w: 96, h: 64, ppt: 30, psi: fpsiFor(.78), hcf: .9 })) });
  function toggleDrive() {
    if (!me || !me.cars || !me.cars.length) return openCarShop();
    if (monBattle || modalOpen()) return;
    if (me.car) send({ t: 'car_drive', id: null }); else send({ t: 'car_drive', id: me.cars[0] });
  }
  function syncCarBtn() { const b = $('#b-car'); if (!b || !me) return; b.hidden = !(me.cars && me.cars.length); b.textContent = me.car ? '🚗 Park' : '🚗 Drive'; }
  function openCarShop() {
    openModal('🚗 Sunny Motors', () => {
      const owned = new Set(me.cars || []);
      return h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Cash ' + money(me.money) + '  ·  Press C (or the Drive button) to hop in and out. Cars make you faster, but you cannot meet wild bitmonsters in the grass while driving.'),
        h('div', { class: 'list' }, cat.CARS.map(c => {
          const own = owned.has(c.id), col = carColor(c.id, (me.carCol || {})[c.id]);
          return h('div', { class: 'lrow', style: 'gap:10px;align-items:center;flex-wrap:wrap' }, carIcon(c, col),
            h('span', { class: 'grow' }, h('b', {}, c.name), h('div', { class: 'muted', style: 'font-size:12px' }, '⚡ ' + c.speed.toFixed(2) + '× speed'),
              own ? h('div', { class: 'row', style: 'gap:3px;margin-top:3px;flex-wrap:wrap' }, cat.CAR_COLORS.map(k => h('button', { title: 'Repaint', style: 'width:18px;height:18px;border-radius:50%;border:2px solid ' + (k === col ? '#222' : '#fff') + ';background:' + k + ';padding:0;cursor:pointer', onclick: () => send({ t: 'car_paint', id: c.id, color: k }) }))) : null),
            own ? h('span', { class: 'row', style: 'gap:4px' }, h('button', { class: 'btn sm' + (me.car === c.id ? ' green' : ''), onclick: () => send({ t: 'car_drive', id: me.car === c.id ? null : c.id }) }, me.car === c.id ? 'Driving' : 'Drive'),
              h('button', { class: 'btn sm', onclick: () => { if (confirm('Sell the ' + c.name + ' for ' + money(Math.round(c.price * cat.CAR_SELL_RATE)) + '?')) send({ t: 'car_sell', id: c.id }); } }, 'Sell'))
              : h('button', { class: 'btn green', disabled: me.money < c.price, onclick: () => send({ t: 'car_buy', id: c.id }) }, money(c.price)));
        })));
    });
  }
  $('#b-car') && ($('#b-car').onclick = () => toggleDrive());

  // ---------- 🍺 Sunny Bar ----------
  function openBar() {
    barResult = null;
    openModal('🍺 Sunny Bar', () => {
      const B = cat.BAR, sp = me.spouse, r = barResult;
      if (sp) return h('div', { class: 'center', style: 'gap:8px' }, h('div', { style: 'font-size:52px' }, sp.gender === 'f' ? '💍👰' : '💍🤵'),
        h('div', { style: 'font-size:20px;font-weight:900' }, 'Married to ' + sp.name), h('div', {}, 'Your ' + (sp.gender === 'f' ? 'wife' : 'husband') + ' follows you around the world and rides in your car.'),
        h('div', { class: 'muted' }, 'Married since ' + new Date(sp.since).toLocaleDateString()),
        h('button', { class: 'btn', disabled: me.money < B.divorce, onclick: () => { if (confirm('Divorce ' + sp.name + ' for ' + money(B.divorce) + '?')) send({ t: 'bar_divorce' }); } }, 'Divorce · ' + money(B.divorce)));
      const go = want => h('button', { class: 'btn green', disabled: me.money < B.fee, style: 'flex:1', onclick: () => { barResult = null; send({ t: 'bar_find', want }); } }, (want === 'wife' ? '👰 Find a wife' : '🤵 Find a husband') + ' · ' + money(B.fee));
      return h('div', { class: 'center', style: 'gap:8px' }, h('div', { style: 'font-size:52px' }, '🍻'),
        h('div', { style: 'font-size:18px;font-weight:900' }, 'Buy a round and see who bites!'),
        h('div', {}, 'Pay the ' + money(B.fee) + ' bar tab. There is a ', h('b', {}, Math.round(B.chance * 100) + '% chance'), ' someone falls for you. If not, the money is gone.'),
        r ? h('div', { style: 'background:' + (r.ok ? '#d3f9d8' : '#fff1c9') + ';border:2px solid #e3c88a;border-radius:10px;padding:8px;font-weight:700' }, r.ok ? '💘 ' + r.spouse.name + ' said YES! You are now married!' : '💔 ' + r.line) : null,
        h('div', { class: 'muted' }, 'You have ' + money(me.money)),
        h('div', { class: 'row', style: 'gap:8px;width:100%' }, go('wife'), go('husband')));
    });
  }

  // ---------- 🏦 Sunny Bank ----------
  const bankUI = { amt: '', tab: 'save', stamp: 0 };
  function openBank() { if (!me) return; send({ t: 'bank_open' }); if (bankUI.tab === 'inv') send({ t: 'invest_open' }); openModal('🏦 Sunny Bank', buildBank); }
  function buildBank() {
    const B = cat.BANK, b = me.bank || { savings: 0, loan: 0, loanTaken: 0, days: 0, eligible: false };
    bankUI.stamp = Date.now();
    const card = (k, v, c, id) => h('div', { style: 'background:#fff;border:2px solid #e3c88a;border-radius:10px;padding:6px 10px;text-align:center;flex:1;min-width:96px' },
      h('div', { class: 'muted', style: 'font-size:12px' }, k), h('b', { id, style: c ? 'color:' + c : '' }, v));
    const inp = h('input', { class: 'txt', type: 'number', min: 1, step: 'any', placeholder: 'Amount', value: bankUI.amt, style: 'width:150px' });
    inp.oninput = () => { bankUI.amt = inp.value; };
    const go = (t, all) => () => {
      const a = all ? 'all' : Number(bankUI.amt);
      if (!all && !(a > 0)) return toast('Enter an amount first.', true);
      send({ t, amount: a });
    };
    const dayRate = Math.min(b.savings, B.saveCap) * B.saveDaily;
    const live = h('b', { id: 'bank-live', style: 'color:#2b8a3e' }, money(b.savings));
    const upd = () => { const base = Math.min(b.savings, B.saveCap), dt = (Date.now() - bankUI.stamp) / 864e5; live.textContent = money(b.savings + base * (Math.pow(1 + B.saveDaily, dt) - 1)); };
    modalTick(upd, 1000);
    const maxOwed = b.loanTaken * B.loanCapMult;
    const saveTab = h('div', { class: 'center', style: 'gap:8px' },
      h('div', { style: 'font-size:15px' }, 'Keep your money safe and earn ', h('b', {}, (B.saveDaily * 100).toFixed(0) + '% interest per day'), ' on up to ' + money(B.saveCap) + '.'),
      h('div', {}, 'Savings now: ', live, h('span', { class: 'muted' }, '  ·  ≈ +' + money(dayRate) + ' / day')),
      h('div', { class: 'row', style: 'justify-content:center;gap:6px;flex-wrap:wrap' }, inp,
        h('button', { class: 'btn green', onclick: go('bank_deposit') }, 'Deposit'), h('button', { class: 'btn', onclick: go('bank_withdraw') }, 'Withdraw')),
      h('div', { class: 'row', style: 'justify-content:center;gap:6px' },
        h('button', { class: 'btn sm', onclick: go('bank_deposit', true) }, 'Deposit all cash'), h('button', { class: 'btn sm', onclick: go('bank_withdraw', true) }, 'Withdraw all')));
    const loanTab = h('div', { class: 'center', style: 'gap:8px' },
      h('div', { style: 'font-size:15px' }, 'Borrow up to ', h('b', {}, money(B.loanMax)), ' at ', h('b', {}, (B.loanDaily * 100).toFixed(0) + '% interest per day'), ' (you never owe more than ' + B.loanCapMult + '× what you borrowed).'),
      b.eligible ? null : h('div', { style: 'background:#fff1c9;border:2px solid #e3c88a;border-radius:10px;padding:8px' }, '🔒 Loans unlock after you have played on ' + B.minDaysPlayed + ' different days. You have played ' + b.days + '.'),
      b.loan > 0.005 ? h('div', {}, 'You owe: ', h('b', { style: 'color:#c92a2a' }, money(b.loan)), h('span', { class: 'muted' }, '  ·  max ' + money(maxOwed))) : h('div', { class: 'muted' }, 'No active loan.'),
      h('div', { class: 'row', style: 'justify-content:center;gap:6px;flex-wrap:wrap' }, inp,
        h('button', { class: 'btn green', disabled: !b.eligible || b.loan > 0.005, onclick: go('bank_loan') }, 'Borrow'),
        h('button', { class: 'btn', disabled: !(b.loan > 0.005), onclick: go('bank_repay') }, 'Repay')),
      h('div', { class: 'row', style: 'justify-content:center;gap:6px' },
        h('button', { class: 'btn sm', disabled: !b.eligible || b.loan > 0.005, onclick: () => send({ t: 'bank_loan', amount: B.loanMax }) }, 'Borrow max ' + money(B.loanMax)),
        h('button', { class: 'btn sm', disabled: !(b.loan > 0.005), onclick: go('bank_repay', true) }, 'Repay all')));
    return h('div', {},
      h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, card('Cash', money(me.money)), card('Savings', money(b.savings), '#2b8a3e'), card('Loan owed', money(b.loan), b.loan > 0.005 ? '#c92a2a' : '')),
      tabs([['save', '💰 Savings'], ['loan', '🧾 Loan'], ['inv', '📈 Invest']], bankUI.tab, t => { bankUI.tab = t; if (t === 'inv') send({ t: 'invest_open' }); }),
      bankUI.tab === 'save' ? saveTab : bankUI.tab === 'inv' ? buildInvest() : loanTab);
  }
  $('#b-bank').onclick = () => openBank();

  // ---------- 🎰 Super Ace-style slots (the server decides every spin; this just plays it back) ----------
  const slCss = document.createElement('style');
  slCss.textContent = `
.slboard{display:flex;gap:4px;justify-content:center;background:linear-gradient(#2b1055,#5a189a);padding:8px;border-radius:14px;border:4px solid #f2b632}
.slcol{display:flex;flex-direction:column;gap:4px}
.slc{width:54px;height:64px;background:#fffdf5;border-radius:8px;border:2px solid #cbb98a;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;font-weight:900;box-sizing:border-box}
.slc .slg{font-size:30px;line-height:1}.slc small{font-size:8px;font-weight:800;color:#6a4a1a}
.slc.gold{background:linear-gradient(135deg,#fff2a8,#f2b632);border-color:#c98a00;box-shadow:inset 0 0 8px #ffd43b}
.slc.wild{background:linear-gradient(135deg,#ffd43b,#ff922b);border-color:#a85d00}
.slc.scat{background:linear-gradient(135deg,#e5dbff,#9775fa);border-color:#5f3dc4}
.slc.win{animation:slwin .3s ease-in-out infinite alternate;border-color:#ff6b6b;z-index:1}
.slc.gone{animation:slgone .35s forwards}.slc.drop{animation:sldrop .32s ease-out}
.slc.spin{filter:blur(1.5px);opacity:.85}
@keyframes slwin{from{transform:scale(1)}to{transform:scale(1.1);box-shadow:0 0 14px #ff6b6b}}
@keyframes slgone{to{transform:scale(.2);opacity:0}}
@keyframes sldrop{from{transform:translateY(-40px);opacity:.3}to{transform:none;opacity:1}}
.slmult{display:flex;gap:4px;justify-content:center;margin:6px 0}
.slmult span{padding:2px 10px;border-radius:12px;background:#e9ecef;font-weight:900;color:#868e96}
.slmult span.on{background:#ff6b6b;color:#fff;box-shadow:0 0 8px #ff6b6b}
.slbanner{min-height:26px;text-align:center;font-weight:900;font-size:18px;color:#c2255c}
@media(max-width:480px){.slc{width:46px;height:56px}.slc .slg{font-size:25px}}`;
  document.head.append(slCss);
  const SL_FACE = [['10', '#1971c2'], ['J', '#2f9e44'], ['Q', '#d6336c'], ['K', '#7048e8'], ['A', '#e8590c'], ['♣', '#212529'], ['♦', '#d32f2f'], ['♥', '#d32f2f'], ['♠', '#212529']];
  function slCard(t, extra) {
    const d = h('div', { class: 'slc' + (t.g ? ' gold' : '') + (t.s === 9 ? ' wild' : '') + (t.s === 10 ? ' scat' : '') + (extra ? ' ' + extra : '') });
    if (t.s === 9) d.append(h('span', { class: 'slg' }, '🃏'), h('small', {}, 'WILD'));
    else if (t.s === 10) d.append(h('span', { class: 'slg' }, '🌟'), h('small', {}, 'SCATTER'));
    else { const f = SL_FACE[t.s]; d.append(h('span', { class: 'slg', style: 'color:' + f[1] }, f[0])); }
    return d;
  }
  const slRand = () => ({ s: Math.floor(Math.random() * 9), g: 0 });
  const slRandGrid = () => Array.from({ length: 5 }, () => Array.from({ length: 4 }, slRand));
  function slState() {
    if (!casino.slot) casino.slot = { grid: slRandGrid(), mIdx: 0, free: false, left: 0, total: 0, banner: '', result: null, bet: 50 };
    return casino.slot;
  }
  // repaint the whole board from a grid; `dropCols` animates the columns that refilled
  function slPaint(grid, dropCols, cls) {
    const S = slState(), E = casino.slEls; S.grid = grid;
    if (!E) return;
    for (let c = 0; c < 5; c++) {
      E.cells[c] = grid[c].map(t => slCard(t, (dropCols && dropCols.has(c) ? 'drop ' : '') + (cls || '')));
      E.cols[c].replaceChildren(...E.cells[c]);
    }
  }
  function slLadder() {
    const S = slState(), E = casino.slEls; if (!E) return;
    const L = S.free ? SLOT().FREE_MULT : SLOT().BASE_MULT;
    E.ladder.replaceChildren(...L.map((m, i) => h('span', { class: i === Math.min(S.mIdx, L.length - 1) ? 'on' : '' }, '×' + m)));
  }
  function slBanner(txt) { const S = slState(); S.banner = txt; if (casino.slEls) casino.slEls.banner.textContent = txt; }
  function slWinText() { const S = slState(); if (casino.slEls) casino.slEls.win.textContent = S.total > 0 ? '🏆 Win ' + money(S.total) : ''; }
  const SLOT = () => cat.SLOT;
  function buildSlots() {
    const S = slState(), SL = SLOT(), bet = Math.floor(Number(casino.chip)) || MIN_BET;
    const cols = [], cells = [];
    for (let c = 0; c < 5; c++) { cols.push(h('div', { class: 'slcol' })); cells.push([]); }
    const E = casino.slEls = { cols, cells, ladder: h('div', { class: 'slmult' }), banner: h('div', { class: 'slbanner' }, S.banner), win: h('div', { style: 'text-align:center;font-weight:900;font-size:20px;color:#2b8a3e;min-height:26px' }) };
    slPaint(S.grid); slLadder(); slWinText();
    const cost = bet * SL.BUY_MULT, busy = casino.spinning;
    const armed = casino.buyArm && Date.now() - casino.buyArm < 4000;
    const pay = SL.PAY.map((p, i) => h('div', { style: 'display:flex;align-items:center;gap:8px' }, slCard({ s: i, g: 0 }), h('div', { style: 'font-size:12px' }, '3: ×' + (p[0]).toFixed(2) + ' · 4: ×' + p[1].toFixed(2) + ' · 5: ×' + p[2].toFixed(2) + ' per way')));
    const L = S.result;
    return h('div', { class: 'center', style: 'gap:6px' },
      h('div', { style: 'font-size:18px;font-weight:900;color:#5a189a' }, '🃏 SUPER ACE SLOTS · 1,024 ways'),
      E.banner, E.ladder, h('div', { class: 'slboard' }, cols), E.win,
      !busy && L ? h('div', { style: 'font-weight:800;color:' + (L.net > 0 ? '#2b8a3e' : '#c92a2a') }, L.net > 0 ? 'Last round: +' + money(L.net) + ' profit' : 'Last round: ' + money(-L.net) + ' lost') : null,
      chipPicker(),
      h('div', { class: 'row', style: 'justify-content:center;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn green', style: 'font-size:18px;padding:10px 26px', disabled: busy || me.money < bet, onclick: () => slotSpin(false) }, busy ? 'Spinning…' : '🎰 SPIN ' + money(bet)),
        h('button', { class: 'btn' + (armed ? ' red' : ''), style: 'padding:10px 14px', disabled: busy || me.money < cost, onclick: () => slotSpin(true) }, armed ? 'Tap again to confirm · ' + money(cost) : '💎 BUY BONUS ' + money(cost))),
      h('div', { class: 'muted', style: 'font-size:12px;max-width:380px' }, 'Winning cards vanish and new ones drop in — the multiplier climbs ×1→×2→×3→×5 on each cascade. 🌟 3+ scatters = ' + SL.FREE_SPINS + ' free spins with ×2→×25. Golden cards turn into 🃏 wilds when they win. Buy Bonus = ' + SL.BUY_MULT + '× bet straight into free spins.'),
      h('details', { style: 'width:100%;text-align:left' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Pay table (× your bet, per way)'), h('div', { style: 'display:flex;flex-direction:column;gap:4px;margin-top:6px' }, pay)));
  }
  function slotSpin(buy) {
    if (casino.spinning) return;
    const bet = chipAmount(); if (!bet) return;
    const cost = buy ? bet * SLOT().BUY_MULT : bet;
    if (cost > me.money) return toast('Not enough money for that.', true);
    if (buy && !(casino.buyArm && Date.now() - casino.buyArm < 4000)) { casino.buyArm = Date.now(); casinoRefresh(); setTimeout(() => { if (casino.game === 'slots' && !casino.spinning) casinoRefresh(); }, 4100); return; }
    casino.buyArm = 0;
    const S = slState(); S.total = 0; S.result = null; S.bet = bet; S.free = false; S.mIdx = 0; S.banner = '';
    casino.spinning = true; casino.slotWait = setTimeout(() => { if (casino.spinning && !casino.slotRunning) { casino.spinning = false; casinoRefresh(); } }, 9000);
    send({ t: 'slots_spin', bet, buy: buy ? 1 : 0 });
    casinoRefresh();
  }
  async function playSlots(r) {
    clearTimeout(casino.slotWait);
    const run = ++casino.slotRun, S = slState(), SL = SLOT(), sleep = ms => new Promise(res => setTimeout(res, ms));
    const alive = () => casino.slotRun === run && casino.game === 'slots';
    const finish = () => { casino.spinning = false; casino.slotRunning = false; };
    if (!alive()) { finish(); toast(r.net > 0 ? '🎰 Slots: you won ' + money(r.net) + '!' : '🎰 Slots: ' + money(-r.net) + ' lost', r.net <= 0); return; }
    casino.slotRunning = true;
    const bet = r.bet, chains = [];
    if (r.base) chains.push({ ch: r.base, free: false });
    r.free.forEach(ch => chains.push({ ch, free: true }));
    let left = r.freeSpins, running = 0, firstFree = true;
    for (const { ch, free } of chains) {
      if (!alive()) return finish();
      S.free = free; S.mIdx = 0; slLadder();
      if (free) {
        if (firstFree) { firstFree = false; slBanner(r.buy ? '💎 BONUS BOUGHT — ' + r.freeSpins + ' FREE SPINS!' : '🌟 ' + r.freeSpins + ' FREE SPINS!'); await sleep(1700); if (!alive()) return finish(); }
        left--; S.left = left; slBanner('🎁 FREE SPIN · ' + left + ' left');
      } else slBanner('');
      // reels spin
      for (let i = 0; i < 3; i++) { slPaint(slRandGrid(), null, 'spin'); await sleep(80); if (!alive()) return finish(); }
      let dropCols = new Set([0, 1, 2, 3, 4]);
      for (const st of ch.steps) {
        slPaint(st.grid, dropCols);
        const L = free ? SL.FREE_MULT : SL.BASE_MULT;
        S.mIdx = Math.max(0, L.indexOf(st.mult)); slLadder();
        await sleep(st.wins.length ? 350 : 300); if (!alive()) return finish();
        if (!st.wins.length) break;
        const E = casino.slEls;
        const mark = new Set(); st.wins.forEach(w => w.cells.forEach(([c, rr]) => mark.add(c * 10 + rr)));
        if (E) mark.forEach(k => { const el = E.cells[Math.floor(k / 10)][k % 10]; if (el) el.classList.add('win'); });
        running += st.win * bet; S.total = running; slWinText();
        slBanner('+' + money(st.win * bet) + '  (×' + st.mult + ')');
        await sleep(750); if (!alive()) return finish();
        const E2 = casino.slEls;
        if (E2) {
          (st.wild || []).forEach(k => { const el = E2.cells[Math.floor(k / 10)][k % 10]; if (el) el.replaceWith(slCard({ s: SL.WILD ?? 9, g: 0 })); });
          (st.gone || []).forEach(k => { const el = E2.cells[Math.floor(k / 10)][k % 10]; if (el) el.classList.add('gone'); });
        }
        await sleep(380); if (!alive()) return finish();
        dropCols = new Set((st.gone || []).map(k => Math.floor(k / 10)));
      }
      if (ch.retrigger) { left += ch.retrigger; slBanner('🌟 +' + ch.retrigger + ' FREE SPINS!'); await sleep(1400); }
      await sleep(250);
    }
    if (!alive()) return finish();
    S.total = r.paid; S.result = { net: r.net, paid: r.paid };
    slWinText();
    slBanner(r.paid > 0 ? (r.capped ? '🏆 MAX WIN! ' : (r.paid >= r.cost * 5 ? '🎉 BIG WIN! ' : '')) + money(r.paid) : 'No win this time');
    finish();
    if (r.net > 0) toast('🎰 You won ' + money(r.net) + '!'); else toast('🎰 ' + (r.paid > 0 ? 'Only ' + money(r.paid) + ' back' : 'No win'), true);
    casinoRefresh();
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
  // "Born" = the day it was bought. Shown in the animal/pet window for everyone.
  function bornLine(c) {
    if (!c.born) return null;
    const sx = c.sex === 'm' ? '♂ Male' : c.sex === 'f' ? '♀ Female' : '';
    const d = new Date(c.born), days = Math.max(0, Math.floor((now() - c.born) / 86400000));
    return h('div', { style: 'font-weight:700' }, (sx ? sx + ' · ' : '') + '🎂 Born ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' · ' + (days === 0 ? 'born today' : days + (days === 1 ? ' day old' : ' days old')));
  }
  let critterIv = null;
  const harvestReady = c => { const a = cat.ANIMALS[c.kind]; if (!a || c.pet) return true; const cd = (c.kind === 'cow' ? a.milkCd : a.woolCd) * 1000; return !cd || now() >= (c._last || 0) + cd; };
  // Name tag sits just above the sprite's head: sprite is 40px tall (head top ~4px down) × scale / 32px per unit.
  // Sprites are camera-facing, so their on-screen height is NOT foreshortened by the camera pitch (1.05 rad) the way world-Y is.
  const PITCH_K = 1 / Math.cos(1.05);
  const CHAR_HEAD_Y = sc => sc * (40 / 32) * PITCH_K + .08;
  const HEAD_Y = sc => sc * (36 / 32) + .1;
  const tagLift = (emote, et) => emote === 'jump' ? .45 * Math.abs(Math.sin((et || 0) * 7)) : emote === 'dance' ? .16 * Math.abs(Math.sin((et || 0) * 9)) : emote === 'sit' ? -.3 : emote === 'spin' ? .1 * Math.abs(Math.sin((et || 0) * 5)) : 0;
  const CRITTER_ICON = { chicken: '🐔', cow: '🐄', sheep: '🐑' };
  function openCritter(c) {
    if (c.isOrc) return c.owner === myName ? openOrc() : openModal('🧌 ' + c.name, () => h('div', { class: 'center' }, h('div', { style: 'font-size:56px' }, '🧌'), h('b', {}, c.name), h('div', { class: 'muted' }, c.owner + "'s farm Orc — hard at work.")));
    c._shownUntil = Date.now() + 6000;
    const pdef = c.pet ? (cat.PETS || []).find(x => x.id === c.pid) : null;
    const a = cat.ANIMALS[c.kind], label = pdef ? pdef.name : (a ? a.name : c.kind), icon = c.pet ? '🐾' : (CRITTER_ICON[c.kind] || '🐾');
    if (c.owner !== myName) {
      return openModal(icon + ' ' + label, () => h('div', { class: 'center' },
        h('div', { style: 'font-size:24px;font-weight:900' }, c.name || ('Unnamed ' + label.toLowerCase())),
        h('div', { class: 'muted' }, c.owner + "'s " + label.toLowerCase()), bornLine(c)));
    }
    openModal(icon + ' Name your ' + label.toLowerCase(), () => {
      const inp = h('input', { class: 'txt', type: 'text', maxlength: 14, placeholder: 'e.g. Clucky', value: c.name || '' });
      const cd = c.pet || (c.kind !== 'cow' && c.kind !== 'sheep') ? 0 : (c.kind === 'cow' ? a.milkCd : a.woolCd) * 1000;
      let act = null;
      if (cd) {
        act = h('button', { class: 'btn green' });
        const upd = () => { const w = c._last + cd - now(); act.disabled = w > 0; act.textContent = w > 0 ? (c.kind === 'cow' ? '🥛 Milk' : '✂️ Shear') + ' · ready in ' + Math.ceil(w / 1000) + 's' : (c.kind === 'cow' ? '🥛 Milk this cow' : '✂️ Shear this sheep'); };
        act.onclick = () => send({ t: 'harvest_animal', kind: c.kind, idx: c.idx });
        upd(); clearInterval(critterIv); critterIv = setInterval(upd, 500); modalClose = () => clearInterval(critterIv);
      }
      const save = () => { send(c.pet ? { t: 'name_animal', kind: 'pet', id: c.pid, name: inp.value } : { t: 'name_animal', kind: c.kind, idx: c.idx, name: inp.value }); closeModal(); };
      inp.onkeydown = e => { if (e.key === 'Enter') save(); };
      setTimeout(() => inp.focus(), 30);
      return h('div', { class: 'center' }, bornLine(c), act, inp,
        h('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:10px' },
          h('button', { class: 'btn green', onclick: save }, 'Save name'),
          c.name ? h('button', { class: 'btn', onclick: () => { inp.value = ''; save(); } }, 'Clear') : null),
        h('div', { class: 'muted', style: 'margin-top:8px' }, 'Everyone sees this name above your ' + label.toLowerCase() + '.'));
    });
  }
  // ---------- emotes ----------
  const EMOTES = [['sit', '🪑 Sit'], ['dance', '💃 Dance'], ['wave', '👋 Wave'], ['jump', '🦘 Jump'], ['spin', '🌀 Spin'], ['laugh', '😂 Laugh'], ['heart', '❤️ Love']];
  const EMOTE_ONCE = new Set(['wave', 'jump', 'spin', 'laugh', 'heart']);   // sit + dance last until you move
  function doEmote(id) {
    if (id && id === self.emote && !EMOTE_ONCE.has(id)) id = null;           // press again to stand up / stop
    self.emote = id || null; self.emoteAt = performance.now();
    send({ t: 'emote', e: self.emote });
  }
  function openEmotes() {
    openModal('😀 Emotes', () => h('div', {},
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;justify-content:center' },
        EMOTES.map(([id, lab]) => h('button', { class: 'btn', onclick: () => { closeModal(); doEmote(id); } }, lab))),
      h('div', { class: 'muted', style: 'margin-top:10px;text-align:center' }, 'Sit and dance last until you walk. Quick chat: /sit /dance /wave /jump /spin /laugh /heart')));
  }
  $('#b-emote').onclick = openEmotes;
  function emoteFx(emote, et, sx, sy) {
    const ic = emote === 'wave' ? '👋' : emote === 'laugh' ? '😂' : emote === 'heart' ? '❤️' : emote === 'sit' ? '💤' : emote === 'dance' ? (Math.floor(et * 3) % 2 ? '🎶' : '🎵') : '';
    if (!ic) return;
    lctx.font = '20px sans-serif'; lctx.textAlign = 'center'; lctx.fillText(ic, sx + 22, sy - 20 - ((et * 28) % 12)); lctx.textAlign = 'left';
  }
  // ---------- 🎰 Sunny Casino: roulette + blackjack (min bet $50; all outcomes decided by the server) ----------
  const MIN_BET = 50;
  const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const rColor = n => n === 0 ? '#1f8a4c' : RED_NUMS.has(n) ? '#c0392b' : '#222';
  const casino = { game: null, tab: 'play', info: {}, bj: null, chip: 50, bets: {}, order: [], last: null, spinning: false, wheelEl: null, bjHands: 1, bac: null, bacBets: {}, bacOrder: [], bacRun: 0, bacWait: 0, hl: null, slot: null, slotRun: 0, slotRunning: false, slEls: null, buyArm: 0, slotWait: 0 };
  const CASINO_TITLE = { roulette: '🎡 Roulette Table', blackjack: '🃏 Blackjack Table', slots: '🎰 Super Ace Slots', baccarat: '🎴 Baccarat Table', highlow: '⬆⬇ Higher / Lower' };
  function openCasino(game) {
    casino.game = game; casino.tab = 'play'; casino.last = null; casino.spinning = false;
    send({ t: 'casino_open', game });
    openModal(CASINO_TITLE[game], buildCasino);
    modalClose = () => { casino.game = null; casino.spinning = false; casino.slotRun++; casino.bacRun++; casino.slotRunning = false; casino.buyArm = 0; clearInterval(casino.iv); };
  }
  const casinoRefresh = () => { if (casino.game && modalRefresh) modalRefresh(); };
  const chipAmount = () => {
    const v = Math.floor(Number(casino.chip));
    if (!(v >= MIN_BET)) { toast('Minimum bet is ' + money(MIN_BET) + '.', true); return 0; }
    return v;
  };
  function chipPicker() {
    const inp = h('input', { class: 'txt', type: 'number', min: MIN_BET, step: 10, value: casino.chip, style: 'width:110px' });
    inp.oninput = () => { casino.chip = inp.value; };
    return h('div', { class: 'row', style: 'justify-content:center;align-items:center' },
      [50, 100, 250, 500, 1000].map(v => h('button', { class: 'btn sm' + (Number(casino.chip) === v ? ' green' : ''), onclick: () => { casino.chip = v; casinoRefresh(); } }, '$' + v)),
      inp);
  }
  function casinoStats(info) {
    if (!info) return h('div', { class: 'muted' }, 'Loading…');
    const s = info.stats, ret = s.wagered ? Math.round(s.paid / s.wagered * 1000) / 10 + '%' : '—';
    const cell = (k, v) => h('div', { style: 'background:#fff;border:2px solid #e3c88a;border-radius:10px;padding:6px 10px;text-align:center' }, h('div', { class: 'muted', style: 'font-size:12px' }, k), h('b', {}, v));
    const rows = (info.top || []).map((r, i) => h('div', { class: 'lrow', style: r.n === myName ? 'background:#fff1c9' : '' },
      h('b', { style: 'width:28px' }, '#' + (i + 1)), h('div', { class: 'grow' }, r.n, h('div', { class: 'muted', style: 'font-size:12px' }, r.bets + ' bets · ' + money(r.wagered) + ' wagered')),
      h('b', { style: 'color:' + (r.net >= 0 ? '#2b8a3e' : '#c92a2a') }, (r.net >= 0 ? '+' : '−') + money(Math.abs(r.net)))));
    return h('div', {},
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:10px' },
        cell('Rounds played', s.rounds.toLocaleString()), cell('Bets placed', s.bets.toLocaleString()), cell('Total wagered', money(s.wagered)),
        cell('Paid out', money(s.paid)), cell('Return to players', ret), cell('Players', s.players),
        cell('Biggest win', s.biggest && s.biggest.n ? money(s.biggest.amount) + ' · ' + s.biggest.n : '—')),
      h('b', {}, '🏆 Top 10 players (by net winnings)'),
      h('div', { class: 'list', style: 'margin-top:6px' }, rows.length ? rows : h('div', { class: 'muted' }, 'No bets yet — be the first!')),
      info.me && info.me.rank > 10 ? h('div', { class: 'muted' }, 'You: #' + info.me.rank + ' · ' + (info.me.net >= 0 ? '+' : '−') + money(Math.abs(info.me.net))) : null);
  }
  function buildCasino() {
    const g = casino.game, info = casino.info[g];
    const tabBtn = (id, lab) => h('button', { class: 'tab' + (casino.tab === id ? ' on' : ''), onclick: () => { casino.tab = id; casinoRefresh(); } }, lab);
    return h('div', {},
      h('div', { class: 'tabs' }, tabBtn('play', '🎲 Play'), tabBtn('info', 'ℹ️ Info & Top 10')),
      h('div', { class: 'muted', style: 'text-align:center;margin:4px 0' }, 'Minimum bet ' + money(MIN_BET) + ' · You have ' + money(me.money)),
      casino.tab === 'info' ? casinoStats(info) : (g === 'roulette' ? buildRoulette(info) : g === 'slots' ? buildSlots() : g === 'baccarat' ? buildBaccarat(info) : g === 'highlow' ? buildHighLow() : buildBlackjack()));
  }
  // --- roulette ---
  const BOARD_OUTSIDE = [['dozen:1', '1st 12', '#2f9e44'], ['dozen:2', '2nd 12', '#2f9e44'], ['dozen:3', '3rd 12', '#2f9e44'],
    ['low', '1–18', '#868e96'], ['even', 'Even', '#868e96'], ['red', 'Red', '#c0392b'], ['black', 'Black', '#222'], ['odd', 'Odd', '#868e96'], ['high', '19–36', '#868e96']];
  function placeBet(key) {
    if (casino.spinning) return;
    const amt = chipAmount(); if (!amt) return;
    const total = Object.values(casino.bets).reduce((a, b) => a + b, 0);
    if (!casino.bets[key] && Object.keys(casino.bets).length >= 16) return toast('That is plenty of bets!', true);
    if (total + amt > me.money) return toast('Not enough money for that chip.', true);
    casino.bets[key] = (casino.bets[key] || 0) + amt; casino.order.push([key, amt]); casinoRefresh();
  }
  function buildRoulette(info) {
    const total = Object.values(casino.bets).reduce((a, b) => a + b, 0);
    const cell = (key, label, color, extra) => h('button', {
      class: 'btn sm', style: 'position:relative;background:' + color + ';color:#fff;padding:7px 2px;min-width:0;' + (extra || ''), onclick: () => placeBet(key),
    }, label, casino.bets[key] ? h('span', { style: 'position:absolute;top:-6px;right:-4px;background:#ffd43b;color:#222;border-radius:9px;font-size:10px;padding:0 4px;border:1px solid #7a5230' }, '$' + casino.bets[key]) : null);
    const wheel = h('div', { style: 'width:92px;height:92px;border-radius:50%;border:6px solid #c9a227;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;color:#fff;background:' + (casino.last ? rColor(casino.last.n) : '#444') }, casino.last ? String(casino.last.n) : '?');
    casino.wheelEl = wheel;
    const hist = (info && info.history || []).slice().reverse().map(n => h('span', { style: 'display:inline-block;min-width:24px;text-align:center;border-radius:6px;color:#fff;font-weight:700;font-size:12px;padding:2px 4px;background:' + rColor(n) }, n));
    const nums = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) { const n = c * 3 + (3 - r); nums.push(cell('num:' + n, n, rColor(n))); }
    const L = casino.last;
    const outcome = L ? h('div', { style: 'text-align:center;font-weight:800;color:' + (L.net > 0 ? '#2b8a3e' : L.net < 0 ? '#c92a2a' : '#555') },
      'Ball landed on ' + L.n + ' (' + L.color + ') · ' + (L.net > 0 ? 'you won ' + money(L.net) : L.net < 0 ? 'you lost ' + money(-L.net) : 'you broke even')) : null;
    return h('div', { class: 'center', style: 'gap:8px' },
      h('div', { class: 'row', style: 'align-items:center;justify-content:center;gap:12px' }, wheel, h('div', { style: 'max-width:260px;display:flex;flex-wrap:wrap;gap:3px' }, hist.length ? hist : h('span', { class: 'muted' }, 'No spins yet'))),
      outcome, chipPicker(),
      h('div', { style: 'display:grid;grid-template-columns:repeat(12,1fr);gap:3px;width:100%' }, cell('num:0', '0', rColor(0), 'grid-column:1/-1'), nums),
      h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;width:100%' }, BOARD_OUTSIDE.map(([k, l, c]) => cell(k, l, c))),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Number pays 35:1 · dozens 2:1 · red/black, odd/even, low/high 1:1 · 0 beats all outside bets'),
      h('div', { class: 'row', style: 'justify-content:center;gap:8px' },
        h('button', { class: 'btn', disabled: casino.spinning || !casino.order.length, onclick: () => { const [k, a] = casino.order.pop(); casino.bets[k] -= a; if (!casino.bets[k]) delete casino.bets[k]; casinoRefresh(); } }, 'Undo'),
        h('button', { class: 'btn', disabled: casino.spinning || !total, onclick: () => { casino.bets = {}; casino.order = []; casinoRefresh(); } }, 'Clear'),
        h('button', { class: 'btn green', disabled: casino.spinning || !total || total > me.money, onclick: () => {
          casino.spinning = true; casinoRefresh();
          send({ t: 'roulette_spin', bets: Object.entries(casino.bets).map(([k, a]) => { const [type, v] = k.split(':'); return v === undefined ? { type, amount: a } : { type, value: Number(v), amount: a }; }) });
          setTimeout(() => { if (casino.spinning && !casino.iv2) { casino.spinning = false; casinoRefresh(); } }, 4000);   // safety if the server refused the bet
        } }, casino.spinning ? 'Spinning…' : 'Spin · ' + money(total))));
  }
  function rouletteResult(r) {
    if (!casino.game) return;   // modal closed: just show a toast when it lands
    casino.iv2 = true; let ticks = 0;
    clearInterval(casino.iv);
    casino.iv = setInterval(() => {
      ticks++;
      const n = ticks > 17 ? r.n : Math.floor(Math.random() * 37);
      if (casino.wheelEl) { casino.wheelEl.textContent = n; casino.wheelEl.style.background = rColor(n); }
      if (ticks > 17) { clearInterval(casino.iv); casino.iv2 = false; casino.last = r; casino.spinning = false; casinoRefresh(); toast(r.net > 0 ? '🎉 ' + r.n + ' — you won ' + money(r.net) : r.n + ' ' + r.color + ' — you lost ' + money(-r.net), r.net < 0); }
    }, 80);
  }
  // --- blackjack ---
  function cardEl(c) {
    if (!c) return h('div', { style: 'width:44px;height:62px;border-radius:6px;border:2px solid #1c3d6e;background:repeating-linear-gradient(45deg,#3b5bdb,#3b5bdb 4px,#4c6ef5 4px,#4c6ef5 8px)' });
    const red = c.s === '♥' || c.s === '♦';
    return h('div', { style: 'width:44px;height:62px;border-radius:6px;border:2px solid #999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;font-size:17px;line-height:1.1;color:' + (red ? '#c92a2a' : '#222') }, c.r, h('span', { style: 'font-size:18px' }, c.s));
  }
  const BJ_TEXT = { win: ['Win', '#2b8a3e'], blackjack: ['Blackjack 3:2', '#2b8a3e'], lose: ['Lose', '#c92a2a'], bust: ['Bust', '#c92a2a'], push: ['Push', '#555'] };
  function buildBlackjack() {
    const bj = casino.bj, playing = bj && bj.status === 'playing', n = casino.bjHands || 1;
    const cardsRow = cards => h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap;gap:4px' }, cards.map(cardEl));
    const dealerBox = bj ? h('div', { class: 'center', style: 'gap:4px' }, h('div', { style: 'opacity:.9;font-weight:700' }, 'Dealer · ' + (playing ? bj.dv + '+?' : bj.dv)), cardsRow(bj.dealer)) : h('div', { style: 'opacity:.85' }, 'Dealer stands on 17 · Blackjack pays 3:2 · up to ' + 5 + ' hands · split & double');
    const handBox = (hd, i) => {
      const act = playing && i === bj.active;
      return h('div', { class: 'center', style: 'gap:3px;padding:6px 8px;border-radius:10px;min-width:96px;background:' + (act ? 'rgba(255,224,102,.35)' : 'rgba(0,0,0,.18)') + ';border:2px solid ' + (act ? '#ffe066' : 'transparent') },
        h('div', { style: 'font-weight:800;font-size:13px' }, 'Hand ' + (i + 1) + ' · ' + hd.pv + (hd.doubled ? ' · ×2' : '')),
        cardsRow(hd.cards),
        h('div', { style: 'font-size:12px;font-weight:700' }, money(hd.bet)),
        hd.status === 'playing' ? null : BJ_TEXT[hd.status] ? h('div', { style: 'background:#fff;color:' + BJ_TEXT[hd.status][1] + ';border-radius:8px;padding:1px 8px;font-size:12px;font-weight:900' }, BJ_TEXT[hd.status][0] + (!playing && hd.payout ? ' +' + money(hd.payout) : '')) : h('div', { style: 'font-size:12px;opacity:.9' }, 'Stand'));
    };
    const net = bj && !playing ? bj.total - bj.staked : 0;
    const bet = () => { const amt = chipAmount(); if (amt) send({ t: 'bj_deal', bet: amt, hands: n }); };
    const handPick = h('div', { class: 'row', style: 'justify-content:center;align-items:center;gap:4px' }, h('span', { class: 'muted' }, 'Hands:'),
      [1, 2, 3, 4, 5].map(k => h('button', { class: 'btn sm' + (n === k ? ' green' : ''), onclick: () => { casino.bjHands = k; casinoRefresh(); } }, k)));
    const totalBet = (Math.floor(Number(casino.chip)) || 0) * n;
    return h('div', { class: 'center', style: 'gap:10px;background:#1f8a4c;border-radius:14px;padding:12px;color:#fff' },
      dealerBox,
      bj ? h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap;gap:8px' }, bj.hands.map(handBox)) : null,
      bj && !playing ? h('div', { style: 'background:#fff;color:' + (net > 0 ? '#2b8a3e' : net < 0 ? '#c92a2a' : '#555') + ';border-radius:10px;padding:6px 14px;font-weight:900' }, net > 0 ? 'You won ' + money(net) : net < 0 ? 'You lost ' + money(-net) : 'Break even') : null,
      playing ? h('div', { class: 'row', style: 'justify-content:center;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn green', onclick: () => send({ t: 'bj_hit' }) }, 'Hit'),
        h('button', { class: 'btn', onclick: () => send({ t: 'bj_stand' }) }, 'Stand'),
        h('button', { class: 'btn', disabled: !bj.canDouble, onclick: () => send({ t: 'bj_double' }) }, 'Double'),
        h('button', { class: 'btn', disabled: !bj.canSplit, onclick: () => send({ t: 'bj_split' }) }, '✂️ Split')) :
        h('div', { class: 'center', style: 'gap:8px;background:#fff;color:#222;border-radius:12px;padding:10px;width:100%' }, chipPicker(), handPick,
          h('div', { class: 'muted' }, n + ' hand' + (n > 1 ? 's' : '') + ' × ' + money(Math.floor(Number(casino.chip)) || 0) + ' = ' + money(totalBet)),
          h('button', { class: 'btn green', disabled: me.money < MIN_BET * n || totalBet > me.money, onclick: bet }, bj ? 'Deal again' : 'Deal')));
  }

  // --- baccarat ---
  const BAC_SPOTS = [['player', 'Player', '1 : 1', '#2a5cc0'], ['tie', 'Tie', '8 : 1', '#2f9e5a'], ['banker', 'Banker', '0.95 : 1', '#b03030'], ['ppair', 'P Pair', '11 : 1', '#4c6ef5'], ['bpair', 'B Pair', '11 : 1', '#e03131']];
  const bacPts = c => (c.r === 'A' ? 1 : (c.r === '10' || 'JQK'.includes(c.r)) ? 0 : Number(c.r));
  const bacVal = cards => cards.reduce((s, c) => s + bacPts(c), 0) % 10;
  function bacBetTotal() { return Object.values(casino.bacBets).reduce((a, b) => a + b, 0); }
  function bacPlace(type) {
    if (casino.spinning) return;
    const amt = chipAmount(); if (!amt) return;
    if (bacBetTotal() + amt > me.money) return toast('Not enough money for that chip.', true);
    casino.bacBets[type] = (casino.bacBets[type] || 0) + amt; casino.bacOrder.push([type, amt]); casinoRefresh();
  }
  function buildBaccarat(info) {
    const A = casino.bac, total = bacBetTotal();
    const spot = ([k, name, odds, col]) => h('button', { class: 'btn', style: 'position:relative;background:' + col + ';color:#fff;flex:1;min-width:84px;padding:10px 4px', disabled: casino.spinning, onclick: () => bacPlace(k) },
      h('div', { style: 'font-weight:900' }, name), h('div', { style: 'font-size:11px;opacity:.9' }, odds),
      casino.bacBets[k] ? h('span', { style: 'position:absolute;top:-7px;right:-4px;background:#ffd43b;color:#222;border-radius:9px;font-size:11px;padding:0 5px;border:1px solid #7a5230' }, '$' + casino.bacBets[k]) : null);
    const side = (label, cards, shown, col) => {
      const vis = cards.slice(0, shown);
      return h('div', { class: 'center', style: 'gap:4px;flex:1' }, h('div', { style: 'font-weight:900;color:' + col }, label + (vis.length ? ' · ' + bacVal(vis) : '')),
        h('div', { class: 'row', style: 'justify-content:center;gap:4px;min-height:66px' }, vis.map(cardEl)));
    };
    const hist = (info && info.history || []).slice().reverse().map(x => h('span', { style: 'display:inline-block;min-width:20px;text-align:center;border-radius:50%;color:#fff;font-weight:800;font-size:12px;padding:1px 3px;background:' + (x === 'P' ? '#2a5cc0' : x === 'B' ? '#b03030' : '#2f9e5a') }, x));
    let table = null;
    if (A) {
      const r = A.r;
      table = h('div', { class: 'row', style: 'gap:10px;background:#14532d;border-radius:12px;padding:10px;width:100%;color:#fff' },
        side('Player', r.player.cards, A.pShown, '#a5d8ff'), side('Banker', r.banker.cards, A.bShown, '#ffc9c9'));
    }
    const done = A && A.done;
    const outcome = done ? h('div', { style: 'text-align:center;font-weight:900;font-size:16px;color:' + (A.r.net > 0 ? '#2b8a3e' : A.r.net < 0 ? '#c92a2a' : '#555') },
      (A.r.outcome === 'tie' ? 'TIE' : A.r.outcome.toUpperCase() + ' WINS') + ' (' + A.r.player.total + ' – ' + A.r.banker.total + ')' + (A.r.pp ? ' · P pair' : '') + (A.r.bp ? ' · B pair' : '') + ' · ' + (A.r.net > 0 ? 'you won ' + money(A.r.net) : A.r.net < 0 ? 'you lost ' + money(-A.r.net) : 'bets returned')) : null;
    return h('div', { class: 'center', style: 'gap:8px' },
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;max-width:380px;min-height:22px' }, hist.length ? hist : h('span', { class: 'muted' }, 'No hands yet')),
      table, outcome, chipPicker(),
      h('div', { class: 'row', style: 'width:100%;gap:6px;flex-wrap:wrap' }, BAC_SPOTS.map(spot)),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Closest to 9 wins · A=1, 10/J/Q/K=0 · Banker pays 0.95:1 (5% commission) · Tie returns Player/Banker bets'),
      h('div', { class: 'row', style: 'justify-content:center;gap:8px' },
        h('button', { class: 'btn', disabled: casino.spinning || !casino.bacOrder.length, onclick: () => { const [k, a] = casino.bacOrder.pop(); casino.bacBets[k] -= a; if (!casino.bacBets[k]) delete casino.bacBets[k]; casinoRefresh(); } }, 'Undo'),
        h('button', { class: 'btn', disabled: casino.spinning || !total, onclick: () => { casino.bacBets = {}; casino.bacOrder = []; casinoRefresh(); } }, 'Clear'),
        h('button', { class: 'btn green', disabled: casino.spinning || !total || total > me.money, onclick: () => {
          const bets = Object.entries(casino.bacBets).map(([type, amount]) => ({ type, amount }));
          casino.spinning = true; casino.bac = null; send({ t: 'baccarat_deal', bets }); casinoRefresh();
          clearTimeout(casino.bacWait); casino.bacWait = setTimeout(() => { if (casino.spinning && !casino.bac) { casino.spinning = false; casinoRefresh(); } }, 6000);
        } }, casino.spinning ? 'Dealing…' : 'Deal · ' + money(total))));
  }
  async function playBaccarat(r) {
    clearTimeout(casino.bacWait);
    const run = ++casino.bacRun, sleep = ms => new Promise(res => setTimeout(res, ms));
    const alive = () => casino.bacRun === run && casino.game === 'baccarat';
    const end = () => { casino.spinning = false; };
    const A = casino.bac = { r, pShown: 0, bShown: 0, done: false };
    if (!alive()) { end(); toast(r.net > 0 ? '🎴 Baccarat: you won ' + money(r.net) : '🎴 Baccarat: ' + (r.net < 0 ? 'you lost ' + money(-r.net) : 'bets returned'), r.net < 0); return; }
    // deal order: P, B, P, B, then third cards
    const order = ['p', 'b', 'p', 'b']; if (r.player.cards.length > 2) order.push('p'); if (r.banker.cards.length > 2) order.push('b');
    casinoRefresh();
    for (const w of order) {
      await sleep(600); if (!alive()) return end();
      if (w === 'p') A.pShown++; else A.bShown++;
      casinoRefresh();
    }
    await sleep(500); if (!alive()) return end();
    A.done = true; end();
    casino.bacBets = {}; casino.bacOrder = [];
    casinoRefresh();
    toast(r.net > 0 ? '🎴 You won ' + money(r.net) + '!' : r.net < 0 ? '🎴 You lost ' + money(-r.net) : '🎴 Bets returned', r.net < 0);
  }

  // --- higher / lower ---
  function buildHighLow() {
    const hl = casino.hl, playing = hl && hl.status === 'playing';
    const rankName = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
    const card = c => cardEl({ r: rankName(c.rank), s: c.s });
    const big = c => { const e = card(c); e.style.transform = 'scale(1.5)'; e.style.margin = '14px'; return e; };
    const guess = (g, label, d, col) => h('button', { class: 'btn', style: 'flex:1;background:' + col + ';color:#fff;padding:10px 4px', disabled: !playing, onclick: () => send({ t: 'hl_guess', g }) },
      h('div', { style: 'font-weight:900' }, label), h('div', { style: 'font-size:11px;opacity:.9' }, d ? '×' + d.m + ' · ' + Math.round(d.p * 100) + '%' : ''));
    const lastTxt = hl && hl.last && hl.last.g !== 'skip' ? (hl.last.win ? '✅ Correct!' : '❌ Wrong') : '';
    const bet = () => { const amt = chipAmount(); if (amt) send({ t: 'hl_start', bet: amt }); };
    return h('div', { class: 'center', style: 'gap:8px;background:#5a2d82;border-radius:14px;padding:12px;color:#fff' },
      hl ? h('div', { class: 'row', style: 'justify-content:center;align-items:center;gap:6px' },
        hl.prev ? h('div', { style: 'opacity:.6;transform:scale(.8)' }, card(hl.prev)) : null, hl.prev ? h('span', { style: 'font-size:22px' }, '→') : null, big(hl.card)) : h('div', { style: 'opacity:.9' }, 'Guess if the next card is higher or lower. Ties count as a win. Cash out any time after a correct guess.'),
      hl ? h('div', { style: 'font-weight:800' }, 'Streak ' + hl.streak + ' · ×' + hl.mult + (playing ? ' · cash-out ' + money(hl.cash) : '') + ' ' + lastTxt) : null,
      playing ? h('div', { class: 'row', style: 'gap:6px;width:100%' }, guess('hi', '⬆ Higher / same', hl.hi, '#2f9e44'), guess('lo', '⬇ Lower / same', hl.lo, '#d6336c')) : null,
      playing ? h('div', { class: 'row', style: 'justify-content:center;gap:8px' },
        h('button', { class: 'btn', onclick: () => send({ t: 'hl_skip' }) }, 'Skip card'),
        h('button', { class: 'btn green', disabled: hl.streak < 1, onclick: () => send({ t: 'hl_cash' }) }, '💰 Cash out ' + money(hl.cash))) : null,
      hl && !playing ? h('div', { style: 'background:#fff;color:' + (hl.status === 'cashed' ? '#2b8a3e' : '#c92a2a') + ';border-radius:10px;padding:6px 14px;font-weight:900' }, hl.status === 'cashed' ? 'Cashed out ' + money(hl.payout) + ' (×' + hl.mult + ')' : 'Wrong guess — lost ' + money(hl.bet)) : null,
      playing ? null : h('div', { class: 'center', style: 'gap:8px;background:#fff;color:#222;border-radius:12px;padding:10px;width:100%' }, chipPicker(),
        h('button', { class: 'btn green', disabled: me.money < MIN_BET, onclick: bet }, hl ? 'Play again' : 'Start')));
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
        const cd = (kind === 'cow' ? a.milkCd : a.woolCd) * 1000, cap = Math.min(n, a.max);
        let ready = 0, wait = Infinity;
        for (let i = 0; i < cap; i++) { const w = ((me.animalReady || {})[kind + ':' + i] || 0) + cd - now(); if (w <= 0) ready++; else wait = Math.min(wait, w); }
        box.append(h('button', { class: 'btn', disabled: !ready, onclick: () => send({ t: 'harvest_animal', kind, idx: 'all' }) },
          (kind === 'cow' ? '🥛 Milk all ready cows' : '✂️ Shear all ready sheep') + ' (' + ready + '/' + cap + ')'));
        if (cap && !ready) box.append(h('div', { class: 'muted' }, (kind === 'cow' ? 'Next milk' : 'Wool regrows') + ' in ' + Math.ceil(wait / 1000) + 's'));
        box.append(h('div', { class: 'muted' }, 'Tip: click an animal on your land to ' + (kind === 'cow' ? 'milk' : 'shear') + ' just that one.'));
        box.append(h('button', { class: 'btn red', onclick: () => send({ t: 'slaughter', id: kind }) }, 'Process → meat'));
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
        const slash = t.startsWith('/') ? t.slice(1).toLowerCase() : null;
        const sm = t.match(/^\/send\s+(\S+)(?:\s+\$?([\d,]+))?\s*$/i);
        if (sm) { const amt = sm[2] ? Number(sm[2].replace(/,/g, '')) : 0; if (amt > 0) send({ t: 'send_money', to: sm[1], amount: amt }); else openSendMoney(sm[1]); }
        else if (/^\/send\b/i.test(t)) toast('Usage: /send name amount  (e.g. /send Sam 500)', true);
        else if (slash && (EMOTES.some(x => x[0] === slash) || slash === 'stand')) doEmote(slash === 'stand' ? null : slash);
        else if (t) send({ t: 'chat', text: t });
        ci.value = '';
        // stay focused so you can keep chatting without pressing Enter again
        requestAnimationFrame(() => ci.focus());
      } else if (!modalOpen()) { ci.focus(); e.preventDefault(); }
      return;
    }
    if (typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.key === 'Escape') { if (modalOpen() && !modalLocked) closeModal(); else if (msel.on) msMode(false); return; }
    if (modalOpen() || monBattle) return;
    const k = e.key.toLowerCase(); keys.add(k);
    if (k === 'f') tryShop();
    if (k === 'b') openBag();
    if (k === 'm') bit.openParty();
    if (k === 'n') bit.openMap();
    if (k === 'c') toggleDrive();
    if (k === 'i') openWardrobe();
    if (k === 'g') openEmotes();
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
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(23, Math.min(62, zoom * (e.deltaY < 0 ? 1.1 : .91))); }, { passive: false });
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
  function orcRoamTarget(c) {
    const L = lands[c._li], o = WD.lands[c._li];
    if (L && o && Math.random() < .75) {
      const ks = Object.keys(L.tiles).filter(k => L.tiles[k].type === 'plant');
      if (ks.length) { const [lx, ly] = ks[Math.floor(Math.random() * ks.length)].split(',').map(Number); return { tx: o.x + lx + .5, tz: o.y + ly + 1.0 }; }
    }
    return pickRoamTarget({ x: c._ox, y: c._oy });
  }
  function updateCritters(dt) {
    const next = new Map();
    const owners = [];
    if (me) owners.push({
      n: myName, animalNames: me.animalNames || {}, animalReady: me.animalReady || {}, animalBorn: me.animalBorn || {}, animalSex: me.animalSex || {}, animals: me.animals || {}, pets: me.pets || [], animalStay: me.animalStay || 'farm', petStay: me.petStay || 'follow',
      land: me.land, houseLand: me.houseLand, expandLand: me.expandLand,
      px: self.x / TILE, pz: self.y / TILE, follow: true, orc: me.orc ? { n: me.orc.name || 'Orc', m: me.orc.mode } : null,
    });
    for (const n in players) {
      const p = players[n];
      owners.push({
        n: p.n, animalNames: p.animalNames || {}, animalReady: p.animalReady || {}, animalBorn: p.animalBorn || {}, animalSex: p.animalSex || {}, animals: p.animals || {}, pets: p.pets || [], animalStay: p.animalStay || 'farm', petStay: p.petStay || 'follow',
        land: p.land, houseLand: p.houseLand, expandLand: p.expandLand,
        px: (p.rx || p.x) / TILE, pz: (p.ry || p.y) / TILE, follow: false, orc: p.orc || null,
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
            c.live = true; c.owner = own.n; c.idx = i; c.name = (own.animalNames || {})[kind + ':' + i] || '';
            c._last = (own.animalReady || {})[kind + ':' + i] || 0;
            c.born = (own.animalBorn || {})[kind + ':' + i] || 0; c.sex = (own.animalSex || {})[kind + ':' + i] || '';
          }
        }
      }
      const pets = own.pets || [];
      pets.forEach((pid, i) => {
        if (own.petStay === 'follow') return;          // followers removed: your Bitmonster walks with you instead
        const key = own.n + ':p:' + pid;
        const c = ensureCritter(prev, key, pid, true);
        next.set(key, c);
        c.live = true; c.owner = own.n; c.pid = pid; c.name = (own.animalNames || {})['pet:' + pid] || '';
        c.born = (own.animalBorn || {})['pet:' + pid] || 0; c.sex = (own.animalSex || {})['pet:' + pid] || '';
        if (own.petStay === 'follow') {
          c._follow = true; c._fx = own.px; c._fz = own.pz; c._fi = i; c._roam = false;
        } else {
          const pStay = own.petStay === 'house' ? 'house' : 'farm';
          const o = landOriginFor(own, pStay) || landOriginFor(own, 'farm');
          if (o) { c._ox = o.x; c._oy = o.y; c._roam = true; c._follow = false; if (!c.tx) { const t = pickRoamTarget(o); c.x = t.tx; c.z = t.tz; c.tx = t.tx; c.tz = t.tz; } }
        }
      });
    }
    for (const own of owners) {
      if (!own.orc) continue;
      if (!(own.orc.m === 'roam' && (own.land != null || own.expandLand != null))) continue;   // no following Orc
      const key = own.n + ':orc', c = ensureCritter(prev, key, 'orc', false);
      next.set(key, c);
      c.live = true; c.isOrc = true; c.owner = own.n; c.name = own.orc.n || 'Orc'; c.born = 0; c.sex = '';
      if (!c.x && !c.z) { c.x = own.px - 1; c.z = own.pz; }
      const li = own.land != null ? own.land : own.expandLand, o = own.orc.m === 'roam' && li != null ? WD.lands[li] : null;
      if (o) { c._follow = false; c._roam = true; c._ox = o.x; c._oy = o.y; c._li = li; if (!c.tx) { c.tx = c.x; c.tz = c.z; c.wait = 0; } }
      else { c._follow = true; c._roam = false; c._fx = own.px; c._fz = own.pz; c._fi = 3; }
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
          const t = c.isOrc ? orcRoamTarget(c) : pickRoamTarget({ x: c._ox, y: c._oy });
          c.tx = t.tx; c.tz = t.tz;
        } else {
          const sp = (c.isOrc ? 1.1 : c.kind === 'cow' ? 0.55 : c.pet ? 0.9 : 0.75) * dt;
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
    if (!modalOpen() && !typing() && !monBattle) {
      if (keys.has('a') || keys.has('arrowleft')) ix--; if (keys.has('d') || keys.has('arrowright')) ix++;
      if (keys.has('w') || keys.has('arrowup')) iy++; if (keys.has('s') || keys.has('arrowdown')) iy--;
      if (stick.active) { ix += stick.x; iy += stick.y; }
    }
    const moving = Math.hypot(ix, iy) > .08;
    if (self.emote && (moving || (EMOTE_ONCE.has(self.emote) && performance.now() - self.emoteAt > 3000))) { self.emote = null; send({ t: 'emote', e: null }); }
    if (moving) {
      // HD-2D camera sits on +yaw; screen-up is into the scene (−sin/−cos)
      const s = Math.sin(view.yaw), c = Math.cos(view.yaw);
      let wx = c * ix - s * iy, wz = -s * ix - c * iy; const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      const mag = stick.active ? Math.min(1, Math.hypot(stick.x, stick.y)) : 1;
      const sprint = keys.has('shift') || stick.run;
      const sp = (sprint ? 280 : 190) * dt * mag * (myCar() ? myCar().speed : 1);
      let nx = Math.max(10, Math.min(WD.width * TILE - 10, self.x + wx * sp)), ny = Math.max(10, Math.min(WD.height * TILE - 10, self.y + wz * sp));
      if (!blocked(nx, self.y)) self.x = nx; if (!blocked(self.x, ny)) self.y = ny;
      monStep();
      self.psi += angDiff(self.psi, Math.atan2(wx, wz)) * Math.min(1, dt * 14);
      self.walk += dt * (sprint ? 16 : 11);
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
      const chk = (tx + tz) & 1; let col, river = false;
      const li = landGrid[tz][tx];
      const houseFloor = li >= 0 && WD.lands[li] && WD.lands[li].house;
      if (isSea(tx, tz)) { const wv = Math.sin(t * 1.3 + tx * .6 + tz * .4) + Math.sin(t * .9 - tx * .35 + tz * .7); col = WATER[Math.max(0, Math.min(4, Math.round((wv + 2))))]; }
      else if (li < 0 && nearSea(tx, tz)) col = chk ? '#e8d08a' : '#dfc47c';   // sand beach
      else if (inPark(tx, tz)) col = chk ? '#8fd45a' : '#86cc52';
      else if (houseFloor) col = chk ? '#dcb97c' : '#d2ae70';
      else if (li >= 0) col = chk ? '#86cd4e' : '#7ec548';
      else if (WALL && tx >= 74) {
        if (kindAt(tx, tz) === TK.WATER) { const wv = Math.sin(t * 1.3 + tx * .6 + tz * .4) + Math.sin(t * .9 - tx * .35 + tz * .7); col = WATER[Math.max(0, Math.min(4, Math.round(wv + 2)))]; river = true; if (kindAt(tx - 1, tz) !== TK.WATER || kindAt(tx + 1, tz) !== TK.WATER || kindAt(tx, tz - 1) !== TK.WATER || kindAt(tx, tz + 1) !== TK.WATER) col = chk ? '#82d0f2' : '#78c9ee'; }
        else col = routeColor(tx, tz, chk);
      }
      else if (isMargin(tx, tz)) col = chk ? '#6fb847' : '#66ae41';
      else col = chk ? '#cdb88f' : '#c3ad84'; // cobble lane
      view.quad(tx, tz, tx + 1, tz + 1, 0.0, col);
      if (river) {
        if (((tx * 7 + tz * 13 + Math.floor(t * 1.2)) % 9) === 0) view.quad(tx + .25, tz + .4, tx + .75, tz + .52, 0.006, 'rgba(255,255,255,.5)');
      }
      if (isSea(tx, tz)) {
        const shore = !seaOrEdge(tx - 1, tz) || !seaOrEdge(tx + 1, tz) || !seaOrEdge(tx, tz - 1) || !seaOrEdge(tx, tz + 1);
        if (shore) view.quad(tx, tz, tx + 1, tz + 1, 0.006, 'rgba(255,255,255,' + (0.26 + 0.14 * Math.sin(t * 2 + tx + tz)).toFixed(2) + ')');   // foam
        else if (((tx * 7 + tz * 13 + Math.floor(t * 1.2)) % 9) === 0) view.quad(tx + .25, tz + .4, tx + .75, tz + .52, 0.006, 'rgba(255,255,255,.5)');   // sparkle
      }
    }
    // land floors: soil under plants, house planks, faint grid on my land (raised to avoid Z-fight)
    const fpsi = fpsiFor(view.yaw);
    lands.forEach((L, i) => {
      const o = WD.lands[i], meta = WD.lands[i] || {}, mine = L.owner && L.owner === myName;
      if (meta.house) {
        for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) {
          view.quad(o.x + lx + .06, o.y + ly + .06, o.x + lx + .94, o.y + ly + .94, 0.012, (lx + ly) & 1 ? 'rgba(140,100,50,.22)' : 'rgba(110,75,35,.18)');
        }
      } else if (mine) {
        for (let ly = 0; ly < LS; ly++) for (let lx = 0; lx < LS; lx++) view.quad(o.x + lx + .04, o.y + ly + .04, o.x + lx + .96, o.y + ly + .96, 0.012, 'rgba(70,120,40,.16)');
        for (const k of Object.keys(L.extra || {})) {
          const [lx, ly] = k.split(',').map(Number);
          view.quad(o.x + lx + .04, o.y + ly + .04, o.x + lx + .96, o.y + ly + .96, 0.014, 'rgba(70,120,40,.22)');
        }
      }
      for (const k in L.tiles) {
        const tile = L.tiles[k]; if (tile.type !== 'plant') continue;
        const [lx, ly] = k.split(',').map(Number);
        view.quad(o.x + lx + .05, o.y + ly + .05, o.x + lx + .95, o.y + ly + .95, 0.016, '#d2b48c');
        for (const f of [.2, .5, .8]) view.quad(o.x + lx + .1, o.y + ly + f - .04, o.x + lx + .9, o.y + ly + f + .04, 0.018, '#c4a47a');
      }
    });
    const [mbx, mby] = toBuf(mouse.x, mouse.y); const hp = pickAt(mbx, mby);
    hoverTile = hp && !hp.shop ? hp : null;
    if (hoverTile && !modalOpen()) {
      if (hoverTile.buySquare) view.quad(hoverTile.wx, hoverTile.wy, hoverTile.wx + 1, hoverTile.wy + 1, 0.03, 'rgba(120,200,255,.45)');
      else if (hoverTile.park && WD.park) view.quad(WD.park.x, WD.park.y, WD.park.x + WD.park.w, WD.park.y + WD.park.h, 0.03, 'rgba(100,220,140,.22)');
      else if (hoverTile.i != null && WD.lands[hoverTile.i] && lands[hoverTile.i]) {
        const o = WD.lands[hoverTile.i], L = lands[hoverTile.i];
        if (L.owner === myName && hoverTile.lx != null) view.quad(o.x + hoverTile.lx, o.y + hoverTile.ly, o.x + hoverTile.lx + 1, o.y + hoverTile.ly + 1, 0.03, 'rgba(255,255,255,.4)');
        else view.quad(o.x, o.y, o.x + LS, o.y + LS, 0.03, !L.owner ? 'rgba(255,230,120,.3)' : 'rgba(210,70,50,.14)');
      }
    }

    if (msel.on && msel.land != null && WD.lands[msel.land] && lands[msel.land]) {
      const o = WD.lands[msel.land], tl = lands[msel.land].tiles;
      for (const [k, sq] of msel.sel) { const tt = tl[k]; view.quad(o.x + sq.lx, o.y + sq.ly, o.x + sq.lx + 1, o.y + sq.ly + 1, 0.035, !tt ? 'rgba(70,190,255,.6)' : tileReady(tt) ? 'rgba(255,160,30,.65)' : 'rgba(255,235,90,.55)'); }
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
        const tile = L.tiles[k]; if (tile.type === 'part') continue;
        const [lx, ly] = k.split(',').map(Number), fd = tile.type === 'furn' ? cat.FURN_BY[tile.id] : null, sz = (fd && fd.size) || 1, wx = o.x + lx + sz / 2, wz = o.y + ly + sz / 2;
        if (tile.type === 'furn') {
          const m = Vox.furnModel(fd);
          // models are authored facing +z; the camera sits on the +z side, so psi 0 shows the front. Unrotated pieces turn to face the camera; rotated ones keep a fixed facing.
          const psi = tile.rot == null ? fpsi + PI : tile.rot * PI / 2;
          view.add(m.dyn ? m.boxes.concat(m.dyn(t)) : m.boxes, wx, 0, wz, psi, sz > 1 ? 1 : .9);
        }
        else {
          const sd = cat.SEED_BY[tile.seed], p = (now() - tile.at) / growMs(sd), st = Vox.plantStage(p);
          let B = Vox.plantBoxes(sd, st, tile.gold);
          if (st === 3 && tile.gold) { B = B.concat(Vox.sparkles(t)); view.quad(o.x + lx, o.y + ly, o.x + lx + 1, o.y + ly + 1, 0.02, 'rgba(255,214,60,' + (.28 + .12 * Math.sin(t * 4)) + ')'); }
          view.add(B, wx, 0, wz, 0, 1.05);
        }
      }
    });
    const list = [];
    for (const n in players) {
      const p = players[n], ddx = p.x - p.rx, ddy = p.y - p.ry; p.rx += ddx * .25; p.ry += ddy * .25;
      const mv = Math.abs(ddx) + Math.abs(ddy) > 1.5;
      if (mv) { p.walk += dt * 11; p.psi += angDiff(p.psi, Math.atan2(ddx, ddy)) * Math.min(1, dt * 14); }
      const pe = !mv && p.emote && (!EMOTE_ONCE.has(p.emote) || performance.now() - p.emoteSince < 3000) ? p.emote : null;
      p._fx = pe; p._fxt = (performance.now() - (p.emoteSince || 0)) / 1000;
      if (pe === 'sit') view.add(SEAT, p.rx / TILE, 0, p.ry / TILE, 0, 1);
      drawCarRider({ x: p.rx / TILE, z: p.ry / TILE, psi: p.psi, car: p.car, sp: p.sp, av: p.a, walk: p.walk, moving: mv, st: p._spSt || (p._spSt = {}), dt, scale: 1.05, extra: { pump: { speed: 2.4, amp: .022, ph: p.n.length }, emote: pe, et: p._fxt } }); list.push(p);
    }
    const myFxT = (performance.now() - (self.emoteAt || 0)) / 1000;
    if (self.emote === 'sit') view.add(SEAT, self.x / TILE, 0, self.y / TILE, 0, 1);
    drawCarRider({ x: self.x / TILE, z: self.y / TILE, psi: self.psi, car: me.car ? { id: me.car, c: (me.carCol || {})[me.car] } : null, sp: me.spouse ? { n: me.spouse.name, l: me.spouse.look } : null, av: me.avatar, walk: self.walk, moving, st: spFol, dt, scale: 1.12, extra: { pump: { speed: 2.4, amp: .022 }, emote: self.emote, et: myFxT } });
    if (me.mon && me.mon.starter && me.mon.party.length && !monBattle && !me.car && window.MonSprite) {   // your lead Bitmonster walks behind you
      const lead = me.mon.party.find(m => m.hp > 0) || me.mon.party[0], sx = self.x / TILE, sz = self.y / TILE;
      if (!monFol.on || Math.hypot(monFol.x - sx, monFol.z - sz) > 7) { monFol.x = sx - .8; monFol.z = sz + .4; monFol.on = true; }
      const dx = sx - monFol.x, dz = sz - monFol.z, d = Math.hypot(dx, dz);
      monFol.moving = d > 1.15;
      if (monFol.moving) { const st = Math.min(d - 1.0, (moving ? 4.6 : 3.2) * dt); monFol.x += dx / d * st; monFol.z += dz / d * st; monFol.walk += dt * 10; }
      monFol.id = lead.sp; monFol.name = lead.name;
      const cv = window.MonSprite.canvas(lead.sp, lead.shiny);
      view.addCanvasSprite('m' + lead.sp + (lead.shiny ? 's' : ''), cv, monFol.x, monFol.z, .95, monFol.walk, monFol.moving, { pump: { speed: 3, amp: .04, ph: 1 } });
    } else monFol.on = false;
    for (const a of monActors()) if (Math.abs(a.x - self.x / TILE) < 45) view.addCharacter(NPC_LOOKS[(a.look || 0) % NPC_LOOKS.length], cat, a.x, a.y, 1.08, 0, false, { pump: { speed: 2.0, amp: .02, ph: a.x } });
    updateCritters(dt);
    for (const c of critters) {
      const sc = c.isOrc ? 1.12 : c.pet ? 0.85 : (c.kind === 'cow' ? 1.15 : 0.95);
      const cm = (c._follow && Math.hypot((c._fx || c.x) - c.x, (c._fz || c.z) - c.z) > 0.08)
        || (c._roam && Math.hypot(c.tx - c.x, c.tz - c.z) > 0.12);
      if (c._ph == null) c._ph = Math.random() * 6.28;
      view.addBillboard(c.kind, c.x, 0, c.z, { pet: !!c.pet, scale: sc, walk: c.walk || 0, moving: !!cm, sheared: c.kind === 'sheep' && !c.pet && !harvestReady(c), pump: c.kind === 'chicken' && !c.pet ? { speed: 6.5, amp: .09, ph: c._ph } : null });
    }
    view.flush();
    view.finish();

    // labels (crisp text on a full-resolution overlay)
    WD.lands.forEach((o, i) => {
      const L = lands[i]; if (!L) return;
      const far = toPage(o.x + LS / 2 + 1, 0, postPos(i).z);   // pinned next to the post
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
    if (seaCenter && WD.sea) {
      const sp = toPage(seaCenter.x, 0, seaCenter.z);
      if (sp[0] > -120 && sp[0] < vw + 120 && sp[1] > -60 && sp[1] < vh + 60) {
        const nm = '🌊 ' + String(WD.sea.name || 'Sea').toUpperCase();
        lctx.font = 'bold 20px Trebuchet MS'; lctx.textAlign = 'center'; lctx.lineWidth = 4; lctx.strokeStyle = '#0b3d66'; lctx.strokeText(nm, sp[0], sp[1]); lctx.fillStyle = '#e8f7ff'; lctx.fillText(nm, sp[0], sp[1]); lctx.textAlign = 'left';
      }
    }
    if (WD.casino && WD.casino.length) {
      for (const t of WD.casino) { const p = toPage(t.x, 1.3, t.y); if (p[0] > -40 && p[0] < vw + 40) tag(t.name, p[0], p[1], '#ffe8a3'); }
      const cys = WD.casino.map(t => t.y), mid = toPage(WD.casino[0].x, 2.3, (Math.min(...cys) + Math.max(...cys)) / 2);
      lctx.font = 'bold 17px Trebuchet MS'; lctx.textAlign = 'center'; lctx.lineWidth = 4; lctx.strokeStyle = '#3b0a4a'; lctx.strokeText('🎰 SUNNY CASINO', mid[0], mid[1]); lctx.fillStyle = '#ffe066'; lctx.fillText('🎰 SUNNY CASINO', mid[0], mid[1]); lctx.textAlign = 'left';
    }
    for (const [nm, r, yy] of [['🏦 Sunny Bank', WD.bank, 3.5], ['🧌 Orc Market', WD.orcMarket, 3.4], ['🚗 Sunny Motors', WD.carShop, 3.3], ['🍺 Sunny Bar', WD.bar, 3.0]]) if (r) { const p = toPage(r.x + r.w / 2, yy, r.y + r.h / 2); if (p[0] > -80 && p[0] < vw + 80) tag(nm, p[0], p[1], '#fff3c4'); }
    if (monFol.on) { const fp = toPage(monFol.x, .85, monFol.z); tag(monFol.name, fp[0], fp[1] - 2, '#d3f9d8'); }
    if (WALL && MD) {
      for (const c of (WD.centers || [])) { const p = toPage(c.x + c.w / 2, 3.1, c.y + c.h / 2); if (p[0] > -100 && p[0] < vw + 100) tag('🏥 Bitmon Center', p[0], p[1], '#fff3c4'); }
      for (const g of MD.GYMS) { const p = toPage(g.x + g.w / 2, 3.9, g.y + g.h / 2); if (p[0] > -140 && p[0] < vw + 140 && p[1] > -40 && p[1] < vh + 60) { tag('🏅 ' + g.name, p[0], p[1], '#ffe066'); tag(g.type + ' gym · ' + (g.n > 1 ? 'needs ' + MD.GYMS[g.n - 2].badge : 'first gym'), p[0], p[1] + 14, '#fff'); } }
      for (const L of MD.LEGENDS) { const p = toPage(L.x, 2.0, L.y); if (p[0] > -100 && p[0] < vw + 100 && p[1] > -40 && p[1] < vh + 60) tag(me.mon && me.mon.dex.caughtIds.includes(L.sp) ? 'Shrine (cleared)' : '★ Ancient Shrine · ' + L.badges + ' badges', p[0], p[1], '#e599f7'); }
      for (const t of MD.TOWNS) { const p = toPage(t.x0 + 8, 0, 20); if (p[0] > -100 && p[0] < vw + 100 && p[1] > -40 && p[1] < vh + 60) tag('— ' + t.name + ' —', p[0], p[1], '#fff'); }
      for (let k = 2; k <= 8; k++) { const p = toPage(MD.routeX0(k) + 11, 0, 30); if (p[0] > -100 && p[0] < vw + 100 && p[1] > -40 && p[1] < vh + 60) tag(MD.ROUTES['r' + k].name + ' · Lv' + MD.ROUTES['r' + k].levels.join('–'), p[0], p[1], '#d3f9d8'); }
    }
    if (WALL) {
      const gE = toPage(WALL.x1 + 1.2, 1.6, (WALL.gates.e.y0 + WALL.gates.e.y1) / 2);
      if (gE[0] > -120 && gE[0] < vw + 120) tag('East Gate → Route 1', gE[0], gE[1], '#fff3c4');
      const gS = toPage((WALL.gates.s.x0 + WALL.gates.s.x1) / 2, 2.0, WALL.y1 - .3);
      if (gS[0] > -120 && gS[0] < vw + 120) tag('South Gate — closed (coming soon)', gS[0], gS[1], '#ffc9c9');
      const rt = toPage(96, 0, 30); if (rt[0] > -80 && rt[0] < vw + 80) tag('ROUTE 1', rt[0], rt[1], '#d3f9d8');
      const done = beatenSet();
      for (const a of monActors()) {
        const p = toPage(a.x, CHAR_HEAD_Y(1.08), a.y); if (p[0] < -60 || p[0] > vw + 60 || p[1] < -40 || p[1] > vh + 40) continue;
        tag((a.gym ? '🏅 ' : a.team ? '⚔ ' : '💬 ') + a.name, p[0], p[1] - 3, a.team ? (done.has(a.id) ? '#adb5bd' : '#ffa8a8') : '#a5d8ff');
        if (a.team && !a.gym && !done.has(a.id)) { lctx.font = 'bold 20px sans-serif'; lctx.textAlign = 'center'; lctx.fillStyle = '#ff3b30'; lctx.fillText('!', p[0], p[1] - 18 - Math.abs(Math.sin(t * 4)) * 4); lctx.textAlign = 'left'; }
      }
    }
    if (WD.petShop) { const p = toPage(WD.petShop.x + WD.petShop.w / 2, 1.8, WD.petShop.y + WD.petShop.h / 2); tag('Pet Shop', p[0], p[1], '#e5dbff'); }
    for (const [id, pen] of Object.entries(WD.pens || {})) { const p = toPage(pen.x + pen.w / 2, 1.2, pen.y + pen.h / 2); tag(id[0].toUpperCase() + id.slice(1) + ' Pen', p[0], p[1], '#fff'); }
    if (WD.park) { const p = toPage(WD.park.x + WD.park.w / 2, 1.4, WD.park.y + WD.park.h / 2); tag('Mini Park', p[0], p[1], '#d3f9d8'); }
    WD.lands.forEach((o, i) => { const pp = postPos(i), p = toPage(pp.x, 1.15, pp.z); if (p[0] > -20 && p[0] < vw + 20) tag('Post ' + (i + 1), p[0], p[1], '#fff8e1'); });
    for (const c of critters) {
      if (c.live && c.owner === myName && !c.pet && harvestReady(c) && (c.kind === 'cow' || c.kind === 'sheep')) {   // little hint: this one is ready
        const hp = toPage(c.x, c.kind === 'cow' ? 1.35 : 1.1, c.z);
        lctx.font = '16px sans-serif'; lctx.textAlign = 'center'; lctx.fillText(c.kind === 'cow' ? '🥛' : '✂️', hp[0], hp[1] - (c.name ? 18 : 4) - Math.abs(Math.sin(t * 3)) * 3); lctx.textAlign = 'left';
      }
      if (!c.live || !c.name) continue;   // named animals and pets always show their name
      const s = toPage(c.x, c.isOrc ? CHAR_HEAD_Y(1.12) : c.kind === 'cow' ? 1.35 : c.pet ? .95 : 1.1, c.z);
      if (s[0] > -60 && s[0] < vw + 60 && s[1] > -40 && s[1] < vh + 40) tag((c.isOrc ? '🧌 ' : '') + c.name, s[0], s[1] - (c.isOrc ? 3 : 0), c.isOrc ? '#c0eb75' : '#ffe8a3');
    }
    for (const p of list) { const s = toPage(p.rx / TILE, CHAR_HEAD_Y(1.05) + tagLift(p._fx, p._fxt) * PITCH_K, p.ry / TILE); tag(p.n, s[0], s[1] - 3); if (p._fx) emoteFx(p._fx, p._fxt, s[0], s[1]); if (p.say && p.say.until > Date.now()) bubble(p.say.text, s[0], s[1] - 22); }
    { const s = toPage(self.x / TILE, CHAR_HEAD_Y(1.12) + tagLift(self.emote, myFxT) * PITCH_K, self.y / TILE); tag(me.name, s[0], s[1] - 3, '#ffe066'); if (self.emote) emoteFx(self.emote, myFxT, s[0], s[1]); if (self.say && self.say.until > Date.now()) bubble(self.say.text, s[0], s[1] - 22); }

    let hint = isPhoneUI()
      ? 'Stick to move · tap 🚶/🏃 to toggle · swipe right to look'
      : 'WASD · stalls · park · pets follow / animals roam · Enter chat';
    if (me.land == null) hint = 'Claim a Farm Lot (1–8) · house lots south · expansion east';
    else if (hoverTile) {
      if (hoverTile.stall) hint = 'Click: ' + hoverTile.stall.name;
      else if (hoverTile.bush) hint = 'Click: forage bush (~5% rare loot)';
      else if (hoverTile.casino) hint = 'Click: ' + hoverTile.casino.name + ' (min bet ' + money(MIN_BET) + ')';
      else if (hoverTile.critter) hint = hoverTile.critter.owner === myName ? 'Click: name' + (hoverTile.critter.kind === 'cow' ? ' / milk' : hoverTile.critter.kind === 'sheep' ? ' / shear' : '') + ' your ' + (hoverTile.critter.pet ? 'pet' : hoverTile.critter.kind) : 'Click: see this ' + (hoverTile.critter.pet ? 'pet' : hoverTile.critter.kind) + "'s name";
      else if (hoverTile.bank) hint = 'Click: Sunny Bank (savings & loans)';
      else if (hoverTile.center) hint = 'Click: Bitmon Center (free healing & Bit Mart)';
      else if (hoverTile.npc) hint = 'Click: talk to ' + hoverTile.npc.name;
      else if (hoverTile.trainer) hint = 'Click: challenge ' + hoverTile.trainer.name;
      else if (hoverTile.carShop) hint = 'Click: Sunny Motors (buy & drive cars)';
      else if (hoverTile.bar) hint = 'Click: Sunny Bar (find a wife or husband)';
      else if (hoverTile.orcMarket) hint = 'Click: Orc Market (hire a farm Orc)';
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
