'use strict';
// Bitmonster UI: starter pick, daily rewards, party / box / dex / bag, Bitmon Center + Mart, NPC talk, and the battle screen.
window.MonUI = function (ctx) {
  const { h, $, openModal, closeModal, send, toast, money } = ctx;
  const M = window.Mon, S = window.MonSprite;
  const me = () => ctx.getMe();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const typeChip = t => h('span', { style: 'display:inline-block;padding:1px 7px;border-radius:9px;color:#fff;font-size:11px;font-weight:800;margin-right:3px;background:' + M.TYPE_COL[t] }, t);
  const hpCol = p => p > .5 ? '#40c057' : p > .2 ? '#fab005' : '#fa5252';
  const hpBar = (hp, max, w) => h('div', { style: 'height:9px;background:#343a40;border-radius:5px;overflow:hidden;width:' + (w || '100%') }, h('div', { style: 'height:100%;width:' + Math.max(0, Math.round(hp / max * 100)) + '%;background:' + hpCol(hp / max) }));
  const ST = { brn: ['BRN', '#f76707'], psn: ['PSN', '#ae3ec9'], par: ['PAR', '#f59f00'], slp: ['SLP', '#868e96'] };
  const stBadge = s => s && ST[s] ? h('span', { style: 'background:' + ST[s][1] + ';color:#fff;border-radius:6px;padding:0 5px;font-size:10px;font-weight:900;margin-left:4px' }, ST[s][0]) : null;
  const spr = (id, px, shiny, flip) => S.img(id, px, shiny, flip);

  // ---------- stat radar (hexagon) ----------
  const SK = ['hp', 'atk', 'def', 'spa', 'sdf', 'spe'], SL = ['HP', 'ATK', 'DEF', 'SP.A', 'SP.D', 'SPD'];
  function radar(vals, caps, size, nat, col) {
    const NS = 'http://www.w3.org/2000/svg', c = size / 2, R = size * .34, el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, style: 'max-width:100%' });
    const pt = (i, f) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [c + Math.cos(a) * R * f, c + Math.sin(a) * R * f]; };
    for (const f of [.25, .5, .75, 1]) svg.append(el('polygon', { points: SK.map((_, i) => pt(i, f).join(',')).join(' '), fill: f === 1 ? '#fff8e6' : 'none', stroke: '#d9c9a3', 'stroke-width': 1 }));
    SK.forEach((_, i) => svg.append(el('line', { x1: c, y1: c, x2: pt(i, 1)[0], y2: pt(i, 1)[1], stroke: '#e6d9b8', 'stroke-width': 1 })));
    svg.append(el('polygon', { points: SK.map((k, i) => pt(i, Math.max(.04, Math.min(1, vals[k] / caps[k]))).join(',')).join(' '), fill: col + '66', stroke: col, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    SK.forEach((k, i) => {
      const [x, y] = pt(i, 1.2), t = el('text', { x, y: y - 2, 'text-anchor': 'middle', 'font-size': size * .058, 'font-weight': 800, fill: nat && nat.up === k ? '#2b8a3e' : nat && nat.down === k ? '#e03131' : '#5c4a2a' });
      t.textContent = SL[i] + (nat && nat.up === k ? ' ▲' : nat && nat.down === k ? ' ▼' : ''); svg.append(t);
      const v = el('text', { x, y: y + size * .06, 'text-anchor': 'middle', 'font-size': size * .062, 'font-weight': 900, fill: '#2b2418' }); v.textContent = vals[k]; svg.append(v);
    });
    return svg;
  }
  const capsAt = lv => M.calcStats({ base: { hp: 150, atk: 150, def: 150, spa: 150, sdf: 150, spe: 150 } }, lv, null, 20);

  // ---------- world map ----------
  function openMap() {
    openModal('🗺 Map', () => {
      const mo = me().mon, badges = new Set(mo.badges || []), caught = new Set(mo.dex.caughtIds || []), SC = 3, W = M.WORLD_W * SC, H = 66 * SC;
      const cv = h('canvas', { width: W, height: H + 34, style: 'display:block;border-radius:8px' }), g = cv.getContext('2d');
      g.fillStyle = '#9fd36a'; g.fillRect(0, 0, W, H); g.fillStyle = '#7fbe4f'; for (let i = 0; i < 40; i++) g.fillRect(((i * 97) % M.WORLD_W) * SC, ((i * 53) % 66) * SC, 14, 8);
      g.fillStyle = '#e8d9a8'; g.fillRect(0, 0, 74 * SC, H); g.strokeStyle = '#8d8878'; g.lineWidth = 4; g.strokeRect(2, 2, 74 * SC - 4, H - 4);
      g.fillStyle = '#5c4a2a'; g.font = 'bold 15px sans-serif'; g.fillText('☀ Sunny Lots', 10, 24); g.font = '12px sans-serif'; g.fillText('(farms, shops, casino)', 10, 40);
      { const T = M.TERRAIN, KC = ['#9fd36a', '#e2cb94', '#5aa63a', '#4a9bd8', '#d8c9a2', '#ecd897', '#9a6b3a'];
        for (let y = 0; y < T.H; y++) for (let x = 74; x < T.W; x++) { const k = T.kind[y * T.W + x]; g.fillStyle = (k === 0 && T.dec[y * T.W + x] === M.D.TREE) ? '#6fae4d' : KC[k]; g.fillRect(x * SC, y * SC, SC, SC); } }
      g.fillStyle = '#2f6b1f'; g.font = 'bold 13px sans-serif';
      for (let k = 1; k <= 8; k++) { const x = (k === 1 ? 80 : M.routeX0(k) + 2) * SC; g.fillText('Route ' + k, x, 14 * SC + 14); g.font = '11px sans-serif'; g.fillStyle = '#245317'; g.fillText('Lv ' + M.ROUTES['r' + k].levels.join('–'), x, 14 * SC + 28); g.font = 'bold 13px sans-serif'; g.fillStyle = '#2f6b1f'; }
      for (const t of M.TOWNS) {
        const gym = M.GYMS[t.k - 1], got = badges.has(gym.badge);
        g.fillStyle = '#e0585a'; g.fillRect(t.center.x * SC, t.center.y * SC, t.center.w * SC, t.center.h * SC);
        g.fillStyle = gym.col; g.globalAlpha = got ? 1 : .45; g.fillRect(gym.x * SC, gym.y * SC, gym.w * SC, gym.h * SC); g.globalAlpha = 1;
        g.fillStyle = '#222'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText(t.name, (t.x0 + 8) * SC, 17 * SC);
        g.font = '11px sans-serif'; g.fillText((got ? '🏅 ' : '') + gym.type + ' Gym', (t.x0 + 8) * SC, 48 * SC + 11); g.textAlign = 'left';
      }
      for (const L of M.LEGENDS) if (!caught.has(L.sp)) { g.fillStyle = '#9c36b5'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText('★', L.x * SC, L.y * SC + 14); g.font = '10px sans-serif'; g.fillText(L.badges + '🏅', L.x * SC, L.y * SC + 26); g.textAlign = 'left'; }
      const pos = ctx.getPos(); g.fillStyle = '#fff'; g.beginPath(); g.arc(pos.x * SC, pos.y * SC, 9, 0, 7); g.fill(); g.fillStyle = '#e03131'; g.beginPath(); g.arc(pos.x * SC, pos.y * SC, 6, 0, 7); g.fill();
      g.fillStyle = '#e03131'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('You', pos.x * SC, pos.y * SC - 12); g.textAlign = 'left';
      g.fillStyle = '#3b2a1a'; g.font = 'bold 13px sans-serif'; g.fillText('🏅 Badges ' + badges.size + '/8   ·   🔴 Bitmon Centers   ·   ★ legendary shrine (unopened)', 8, H + 22);
      const wrap = h('div', { style: 'overflow:auto;max-height:70vh;max-width:100%;border:3px solid #e3c88a;border-radius:10px' }, cv);
      setTimeout(() => { wrap.scrollLeft = Math.max(0, pos.x * SC - wrap.clientWidth / 2); }, 30);
      return h('div', { class: 'center', style: 'gap:6px' }, wrap, h('div', { class: 'muted', style: 'font-size:12px' }, 'Scroll sideways. Follow Champion Road east: one gym per town. Red squares are Bitmon Centers (free healing).'));
    });
  }

  // ---------- starter pick ----------
  const STARTERS = [{ id: M.BY_NAME.Embrix, tag: '🔥 Fire', blurb: 'Fast and fierce. Hits hard with special Flame moves.' }, { id: M.BY_NAME.Mossling, tag: '🌿 Grass', blurb: 'Balanced and sturdy. Great all-rounder.' }, { id: M.BY_NAME.Ripplet, tag: '💧 Water', blurb: 'Tough and calm. Hard to knock down.' }];
  function openStarter() {
    let pick = null;
    openModal('Choose your starter Bitmonster!', () => {
      const cards = STARTERS.map(s => {
        const sp = M.SPECIES[s.id], on = pick === s.id;
        return h('div', { style: 'flex:1;min-width:150px;max-width:210px;text-align:center;padding:10px;border-radius:14px;cursor:pointer;border:3px solid ' + (on ? '#f59f00' : '#e3c88a') + ';background:' + (on ? '#fff3bf' : '#fff'), onclick: () => { pick = s.id; ctx.refresh(); } },
          h('div', { style: 'font-weight:900;font-size:15px' }, s.tag), spr(s.id, 112), h('div', { style: 'font-weight:900;font-size:18px' }, sp.name), h('div', {}, sp.types.map(typeChip)),
          h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, s.blurb),
          h('div', { style: 'font-size:11px;margin-top:4px;color:#555' }, 'Evolves into ' + M.SPECIES[sp.next].name + ' → ' + M.SPECIES[M.SPECIES[sp.next].next].name));
      });
      return h('div', { class: 'center', style: 'gap:10px' }, h('div', {}, 'Every trainer begins with a partner. Pick the one that fits your style!'),
        h('div', { class: 'row', style: 'justify-content:center;gap:10px;flex-wrap:wrap' }, cards),
        h('button', { class: 'btn green', disabled: !pick, onclick: () => { send({ t: 'mon_starter', sp: pick }); closeModal(); } }, pick ? 'I choose ' + M.SPECIES[pick].name + '!' : 'Tap a Bitmonster'));
    }, { locked: true });
  }

  // ---------- daily reward ----------
  function rewardLabel(R) {
    const parts = [];
    if (R.money) parts.push('$' + R.money);
    for (const [k, n] of Object.entries(R.items || {})) parts.push(n + '× ' + (M.ORBS[k] || M.POTIONS[k]).name);
    if (R.monster) parts.unshift('⭐ ' + M.SPECIES[R.monster].name + ' Lv' + R.level);
    return parts;
  }
  function openDaily() {
    openModal('🎁 Daily Login Reward', () => {
      const d = me().mon.daily, cur = d.idx;
      const cells = M.DAILY.map((R, i) => {
        const done = d.claimed ? i <= cur : i < cur, today = i === cur && !d.claimed;
        return h('div', { style: 'flex:1;min-width:92px;max-width:130px;text-align:center;padding:8px 4px;border-radius:12px;border:3px solid ' + (today ? '#f59f00' : done ? '#69db7c' : '#e3c88a') + ';background:' + (today ? '#fff3bf' : done ? '#ebfbee' : '#fff') + (R.rare ? ';box-shadow:0 0 10px #be4bdb' : '') },
          h('div', { style: 'font-weight:900' }, 'Day ' + (i + 1)),
          R.monster ? h('div', {}, spr(R.monster, 56)) : h('div', { style: 'font-size:28px' }, R.money ? '💰' : '🎒'),
          rewardLabel(R).map(l => h('div', { style: 'font-size:11px;font-weight:700' }, l)),
          done ? h('div', { style: 'color:#2b8a3e;font-weight:900' }, '✔') : null);
      });
      return h('div', { class: 'center', style: 'gap:10px' },
        h('div', {}, 'Log in every day to keep your streak. Day 7 gives a ', h('b', { style: 'color:#9c36b5' }, 'rare Bitmonster'), '!'),
        h('div', { class: 'row', style: 'justify-content:center;gap:6px;flex-wrap:wrap' }, cells),
        d.claimed ? h('div', { class: 'muted' }, 'Come back tomorrow for Day ' + ((cur + 1) % 7 + 1) + '. Streak: ' + d.streak + ' day' + (d.streak > 1 ? 's' : '')) :
          h('button', { class: 'btn green', style: 'font-size:18px;padding:10px 24px', onclick: () => send({ t: 'mon_daily' }) }, 'Claim Day ' + (cur + 1)));
    });
  }
  function dailyOk(m) {
    toast('🎁 Day ' + (m.day + 1) + ' reward claimed!' + (m.monster ? ' You got ' + m.monster + '!' : ''));
    if (m.monster) openModal('⭐ Rare Bitmonster!', () => { const sp = M.SPECIES[M.BY_NAME[m.monster]]; return h('div', { class: 'center' }, spr(sp.id, 128), h('div', { style: 'font-size:22px;font-weight:900' }, sp.name), h('div', {}, sp.types.map(typeChip)), h('div', {}, 'joined your team!')); });
  }

  // ---------- party / box / dex / bag ----------
  let tab = 'party', sel = null, boxCache = null;
  const monRow = (m, extra) => h('div', { class: 'lrow', style: 'cursor:pointer', onclick: () => { sel = m.id; ctx.refresh(); } }, spr(m.sp, 48, m.shiny),
    h('div', { class: 'grow' }, h('b', {}, m.name + (m.shiny ? ' ✨' : '')), h('span', { class: 'muted' }, '  Lv' + m.lv), stBadge(m.status), h('div', {}, M.SPECIES[m.sp].types.map(typeChip)), hpBar(m.hp, m.max, '100%'), h('div', { class: 'muted', style: 'font-size:11px' }, m.hp + '/' + m.max + ' HP')), extra);
  function monDetail(m, inBox) {
    const sp = M.SPECIES[m.sp];
    const inp = h('input', { class: 'txt', maxlength: 12, value: m.nick || '', placeholder: sp.name, style: 'width:130px' });
    const sv = () => send({ t: 'mon_nick', id: m.id, name: inp.value });
    inp.onkeydown = e => { if (e.key === 'Enter') { sv(); inp.blur(); } }; inp.onchange = sv;
    const stat = (k, l) => h('div', { style: 'text-align:center;background:#fff;border:2px solid #e3c88a;border-radius:8px;padding:2px 6px' }, h('div', { class: 'muted', style: 'font-size:10px' }, l), h('b', {}, m.stats[k]));
    return h('div', { class: 'center', style: 'gap:6px' },
      h('button', { class: 'btn sm', style: 'align-self:flex-start', onclick: () => { sel = null; ctx.refresh(); } }, '← Back'),
      spr(m.sp, 112, m.shiny), h('div', { style: 'font-size:20px;font-weight:900' }, '#' + m.sp + ' ' + sp.name + ' Lv' + m.lv), h('div', {}, sp.types.map(typeChip)),
      (() => { const nt = M.NATURES[m.nature | 0]; return h('div', { style: 'font-size:13px' }, h('b', {}, nt.name + ' nature'), nt.up ? h('span', {}, ' · ', h('b', { style: 'color:#2b8a3e' }, '+' + SL[SK.indexOf(nt.up)]), ' ', h('b', { style: 'color:#e03131' }, '−' + SL[SK.indexOf(nt.down)])) : h('span', { class: 'muted' }, ' · balanced'), h('span', { class: 'muted' }, ' · potential ' + Math.round((m.ivSum || 0) / 1.92) + '%')); })(),
      radar(m.stats, capsAt(m.lv), 260, M.NATURES[m.nature | 0], M.TYPE_COL[sp.types[0]]),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'EXP ' + (m.xp - m.xpCur) + ' / ' + (m.xpNext - m.xpCur) + (sp.evo ? ' · evolves at Lv' + sp.evo : '')),
      h('div', { style: 'width:100%;text-align:left' }, h('b', {}, 'Moves'), m.moves.map(mv => { const d = M.MOVES[mv.id]; return h('div', { class: 'lrow', style: 'padding:4px 8px' }, typeChip(d.type), h('b', { class: 'grow' }, d.name), h('span', { class: 'muted', style: 'font-size:12px' }, (d.cat === 'st' ? 'Status' : 'Pow ' + d.pow + (d.cat === 'p' ? ' · Phys' : ' · Spec')) + ' · PP ' + mv.pp + '/' + mv.max)); })),
      h('div', { class: 'row', style: 'gap:6px;justify-content:center;flex-wrap:wrap' }, inp, h('button', { class: 'btn sm', onclick: sv }, 'Rename'),
        inBox ? h('button', { class: 'btn sm green', onclick: () => send({ t: 'mon_move', id: m.id, to: 'party' }) }, 'Add to party') : [
          h('button', { class: 'btn sm', onclick: () => send({ t: 'mon_move', id: m.id, to: 'lead' }) }, 'Make lead'),
          h('button', { class: 'btn sm', onclick: () => { send({ t: 'mon_move', id: m.id, to: 'box' }); sel = null; } }, 'Send to box')]));
  }
  function openParty(t) {
    if (t) tab = t; sel = null;
    send({ t: 'mon_box' });
    openModal('🐾 Bitmonsters', () => {
      const mo = me().mon;
      const tabsEl = h('div', { class: 'tabs' }, [['party', '🐾 Party'], ['box', '📦 Box (' + mo.boxCount + ')'], ['dex', '📖 Dex ' + mo.dex.caught + '/' + M.COUNT], ['bag', '🎒 Items'], ['badge', '🏅 Badges ' + (mo.badges || []).length + '/8']].map(([id, l]) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; sel = null; ctx.refresh(); } }, l)));
      let body;
      if (tab === 'party') {
        const m = sel && mo.party.find(x => x.id === sel);
        body = m ? monDetail(m, false) : h('div', { class: 'list' }, mo.party.length ? mo.party.map((x, i) => monRow(x, i === 0 ? h('span', { class: 'muted' }, 'Lead') : null)) : h('div', { class: 'muted' }, 'No monsters yet.'));
      } else if (tab === 'box') {
        const m = sel && (boxCache || []).find(x => x.id === sel);
        body = m ? monDetail(m, true) : h('div', { class: 'list' }, (boxCache || []).length ? boxCache.map(x => monRow(x)) : h('div', { class: 'muted' }, 'Your box is empty. Extra catches are stored here.'));
      } else if (tab === 'dex') {
        const seen = new Set(mo.dex.seenIds), caught = new Set(mo.dex.caughtIds);
        body = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px' }, M.SPECIES.slice(1).map(sp => {
          const c = caught.has(sp.id), s = seen.has(sp.id);
          const im = c || s ? spr(sp.id, 48) : h('div', { style: 'width:48px;height:48px;line-height:48px;font-size:20px;color:#aaa' }, '?');
          if (s && !c) im.style.filter = 'brightness(0)';
          return h('div', { title: c ? sp.name : s ? '???' : '', style: 'text-align:center;font-size:10px;background:' + (c ? '#fff' : '#f1f3f5') + ';border-radius:8px;padding:2px', onclick: () => { if (c || s) dexInfo(sp, c); } }, im, h('div', {}, '#' + sp.id), h('div', { style: 'font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, c ? sp.name : '???'));
        }));
      } else if (tab === 'badge') {
        const have = new Set(mo.badges || []);
        body = h('div', { class: 'center', style: 'gap:8px' }, h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%' }, M.GYMS.map(g => h('div', { style: 'text-align:center;padding:8px 2px;border-radius:12px;border:3px solid ' + (have.has(g.badge) ? g.col : '#ddd') + ';background:' + (have.has(g.badge) ? '#fff' : '#f1f3f5') }, h('div', { style: 'width:44px;height:44px;margin:0 auto;border-radius:50%;background:' + (have.has(g.badge) ? 'radial-gradient(circle at 35% 30%,#fff8,' + g.col + ' 55%,#0003)' : '#ced4da') + ';box-shadow:inset 0 0 0 3px #0002;display:flex;align-items:center;justify-content:center;font-size:22px' }, have.has(g.badge) ? '🏅' : '🔒'), h('div', { style: 'font-weight:800;font-size:12px;margin-top:4px' }, g.badge), h('div', { class: 'muted', style: 'font-size:10px' }, g.town + ' · ' + g.type)))),
          h('div', { class: 'muted' }, 'Friendly battles: ' + ((mo.pvp && mo.pvp.w) || 0) + ' wins · ' + ((mo.pvp && mo.pvp.l) || 0) + ' losses'), h('div', { class: 'muted', style: 'font-size:12px' }, 'Beat each town\'s gym leader in order. Legendary shrines open with more badges.'));
      } else {
        const its = Object.entries(mo.items);
        body = its.length ? h('div', { class: 'list' }, its.map(([k, n]) => { const o = M.ORBS[k], p = M.POTIONS[k]; const it = o || p; return h('div', { class: 'lrow' }, o ? h('div', { style: 'width:28px;height:28px;border-radius:50%;border:3px solid #222;background:linear-gradient(#' + 'fff 48%,#222 48%,#222 54%,' + o.color + ' 54%);' }) : h('div', { style: 'font-size:24px' }, p.revive ? '💫' : p.pp ? '🔷' : p.cure ? '💊' : '🧪'), h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'muted', style: 'font-size:12px' }, it.desc)), h('b', {}, '×' + n), p ? h('button', { class: 'btn sm', onclick: () => useItem(k) }, 'Use') : null); })) : h('div', { class: 'muted' }, 'No items. Buy some at the Bitmon Center.');
      }
      return h('div', {}, tabsEl, body);
    });
  }
  function dexInfo(sp, caught) {
    openModal('#' + sp.id + ' ' + (caught ? sp.name : '???'), () => h('div', { class: 'center', style: 'gap:6px' }, spr(sp.id, 128), h('div', {}, sp.types.map(typeChip)),
      caught ? radar(sp.base, { hp: 150, atk: 150, def: 150, spa: 150, sdf: 150, spe: 150 }, 240, null, M.TYPE_COL[sp.types[0]]) : null,
      caught ? h('div', { class: 'muted' }, 'Base stats — HP ' + sp.base.hp + ' · ATK ' + sp.base.atk + ' · DEF ' + sp.base.def + ' · SP.A ' + sp.base.spa + ' · SP.D ' + sp.base.sdf + ' · SPD ' + sp.base.spe) : h('div', { class: 'muted' }, 'Catch it to learn more.'),
      sp.legend ? h('div', { style: 'color:#9c36b5;font-weight:900' }, '★ Legendary') : sp.rare ? h('div', { style: 'color:#9c36b5;font-weight:900' }, '★ Rare') : null,
      h('button', { class: 'btn sm', onclick: () => openParty('dex') }, '← Dex')));
  }
  function useItem(k) {
    const mo = me().mon;
    openModal('Use on which monster?', () => h('div', { class: 'list' }, mo.party.map((m, i) => h('div', { class: 'lrow', style: 'cursor:pointer', onclick: () => { send({ t: 'mon_use', item: k, i }); openParty('bag'); } }, spr(m.sp, 40), h('div', { class: 'grow' }, h('b', {}, m.name + ' Lv' + m.lv), hpBar(m.hp, m.max), h('div', { class: 'muted', style: 'font-size:11px' }, m.hp + '/' + m.max))))));
  }

  // ---------- Bitmon Center (heal + Mart) ----------
  function openCenter() {
    openModal('🏥 Bitmon Center', () => {
      const m = me();
      const row = k => { const it = M.ORBS[k] || M.POTIONS[k]; return h('div', { class: 'lrow' }, h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'muted', style: 'font-size:12px' }, it.desc), h('div', { style: 'font-size:12px' }, 'You have ' + (m.mon.items[k] || 0))),
        [1, 5, 10].map(n => h('button', { class: 'btn sm', disabled: m.money < it.price * n, onclick: () => send({ t: 'mon_buy', item: k, n }) }, '×' + n + ' ' + money(it.price * n)))); };
      return h('div', {}, h('div', { class: 'center', style: 'gap:6px;margin-bottom:8px' }, h('div', {}, 'Nurse Joy-Bit: "Let me heal your team!"'),
        h('button', { class: 'btn green', onclick: () => send({ t: 'mon_heal' }) }, '💖 Heal my monsters (free)')),
        h('b', {}, '🛒 Bit Mart'), h('div', { class: 'list', style: 'max-height:300px;overflow:auto' }, M.SHOP.map(row)));
    });
  }

  // ---------- NPC talk ----------
  function talk(n) {
    let i = 0;
    openModal(n.name, () => h('div', { class: 'center', style: 'gap:10px' }, h('div', { style: 'font-size:17px;min-height:48px' }, '“' + n.lines[i] + '”'),
      h('button', { class: 'btn green', onclick: () => { if (i < n.lines.length - 1) { i++; ctx.refresh(); } else closeModal(); } }, i < n.lines.length - 1 ? 'Next ▸' : 'Bye!')));
  }
  function challenge(tr) {
    const mo = me().mon, beaten = mo.beaten.includes(tr.id), gym = tr.gym ? M.GYMS.find(x => x.id === tr.gym) : null;
    const prev = gym && M.GYMS[gym.n - 2], locked = prev && !mo.badges.includes(prev.badge);
    openModal(gym ? '🏅 ' + gym.name : tr.name, () => h('div', { class: 'center', style: 'gap:8px' },
      gym ? h('div', { style: 'font-weight:900;color:' + gym.col }, gym.type + '-type gym · ' + gym.town) : null,
      h('div', { style: 'font-weight:800' }, tr.name), h('div', { style: 'font-size:17px' }, '“' + tr.pre + '”'),
      h('div', { class: 'muted' }, tr.team.length + ' monster' + (tr.team.length > 1 ? 's' : '') + (gym ? ' · top level ' + Math.max(...tr.team.map(t => t[1])) : '') + ' · ' + (beaten ? 'rematch pays $' + Math.floor(tr.reward / 4) : 'prize $' + tr.reward + (gym ? ' + ' + gym.badge : ''))),
      locked ? h('div', { style: 'color:#e03131;font-weight:800' }, '🔒 Needs the ' + prev.badge + ' first.') : null,
      h('button', { class: 'btn green', disabled: !!locked, onclick: () => { closeModal(); send({ t: 'mon_trainer', id: tr.id }); } }, '⚔ Battle!'), h('button', { class: 'btn', onclick: closeModal }, 'Not now')));
  }
  function shrine(L) {
    const mo = me().mon, sp = M.SPECIES[L.sp], have = mo.dex.caughtIds.includes(L.sp), need = L.badges - mo.badges.length;
    openModal('✨ Ancient Shrine', () => h('div', { class: 'center', style: 'gap:8px' }, h('div', { style: 'font-size:40px' }, '⛩'),
      have ? h('div', {}, 'The shrine is quiet. You already hold ' + sp.name + '.') : need > 0 ? h('div', {}, 'The shrine is sealed. It needs ', h('b', {}, L.badges + ' badges'), ' (you have ' + mo.badges.length + ').') : h('div', {}, 'Something powerful stirs inside... a legendary bitmonster, level ' + L.lv + '.'),
      !have && need <= 0 ? h('button', { class: 'btn green', onclick: () => { closeModal(); send({ t: 'mon_legend', sp: L.sp }); } }, 'Awaken it') : null, h('button', { class: 'btn', onclick: closeModal }, 'Leave')));
  }
  // friendly battles
  let invEl = null;
  function invite(from) {
    if (invEl) invEl.remove();
    const done = ok => { if (invEl) invEl.remove(); invEl = null; send({ t: 'pvp_reply', ok }); };
    invEl = h('div', { style: 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:60;background:#fffbe6;border:3px solid #f59f00;border-radius:12px;padding:10px 14px;box-shadow:0 4px 14px #0004;text-align:center' },
      h('div', { style: 'font-weight:900' }, '⚔ ' + from + ' challenges you to a friendly battle!'), h('div', { class: 'muted', style: 'font-size:12px' }, 'No monsters are lost — both teams are fully healed for the fight.'),
      h('div', { class: 'row', style: 'gap:8px;justify-content:center;margin-top:6px' }, h('button', { class: 'btn green', onclick: () => done(true) }, 'Accept'), h('button', { class: 'btn', onclick: () => done(false) }, 'Decline')));
    document.body.append(invEl);
    setTimeout(() => { if (invEl && invEl.isConnected && invEl.dataset.x !== '1') { /* expires server-side */ } }, 30000);
    setTimeout(() => { if (invEl) { invEl.remove(); invEl = null; } }, 30000);
  }
  const challengePlayer = name => { send({ t: 'pvp_challenge', to: name }); };

  // ---------- battle ----------
  let el = null, B = null, token = 0;
  const bcss = document.createElement('style');
  bcss.textContent = `
#mbattle{position:fixed;inset:0;z-index:40;background:linear-gradient(#9bd8ff 0,#d7f2ff 38%,#8fd36b 38%,#5fae45 100%);display:flex;align-items:center;justify-content:center;font-family:'Trebuchet MS',sans-serif;animation:mbin .35s}
@keyframes mbin{from{opacity:0;transform:scale(1.15)}to{opacity:1;transform:none}}
.mb-box{position:relative;width:min(760px,100vw);height:min(560px,100vh);}
.mb-info{position:absolute;background:#fffbe6;border:3px solid #3b2a1a;border-radius:12px;padding:6px 10px;min-width:190px;box-shadow:0 3px 0 rgba(0,0,0,.25)}
.mb-spr{position:absolute;transition:transform .15s,opacity .5s;filter:drop-shadow(0 6px 3px rgba(0,0,0,.25))}
.mb-spr img{display:block}
.mb-msg{position:absolute;left:8px;right:8px;bottom:8px;height:150px;background:#2b2d42;border:4px solid #edf2f4;border-radius:14px;color:#fff;padding:10px 12px;display:flex;gap:10px}
.mb-text{flex:1;font-size:18px;line-height:1.3}
.mb-menu{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:min(330px,55%)}
.mb-menu button{border:3px solid #edf2f4;border-radius:10px;background:#4263eb;color:#fff;font-weight:900;font-size:15px;padding:6px 4px;cursor:pointer;text-align:left}
.mb-menu button:disabled{opacity:.4}
.mb-menu button small{display:block;font-weight:600;font-size:11px;opacity:.9}
.mb-hit{animation:mbhit .3s}@keyframes mbhit{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px);filter:brightness(2.2)}50%{transform:translateX(8px)}75%{transform:translateX(-4px)}}
.mb-lunge-p{animation:mblp .35s}@keyframes mblp{50%{transform:translate(40px,-24px)}}
.mb-lunge-f{animation:mblf .35s}@keyframes mblf{50%{transform:translate(-40px,24px)}}
.mb-faint{transform:translateY(40px);opacity:0}
.mb-orb{position:absolute;width:30px;height:30px;border-radius:50%;border:3px solid #222;z-index:3}
@keyframes mbwob{0%,100%{transform:rotate(0)}25%{transform:rotate(-28deg)}75%{transform:rotate(28deg)}}
@media(max-width:560px){.mb-info{min-width:150px;font-size:13px}.mb-text{font-size:15px}.mb-msg{height:170px}}`;
  document.head.append(bcss);
  const orbCss = c => 'background:linear-gradient(#fff 0,#fff 44%,#222 44%,#222 56%,' + c + ' 56%)';

  function battleEl() {
    el = h('div', { id: 'mbattle' });
    const box = h('div', { class: 'mb-box' });
    B.ui = {
      fInfo: h('div', { class: 'mb-info', style: 'left:10px;top:14px' }), pInfo: h('div', { class: 'mb-info', style: 'right:10px;top:250px' }),
      fSpr: h('div', { class: 'mb-spr', style: 'right:70px;top:30px' }), pSpr: h('div', { class: 'mb-spr', style: 'left:60px;top:170px' }),
      text: h('div', { class: 'mb-text' }), menu: h('div', { class: 'mb-menu' }),
    };
    box.append(B.ui.fInfo, B.ui.pInfo, B.ui.fSpr, B.ui.pSpr, h('div', { class: 'mb-msg' }, B.ui.text, B.ui.menu));
    el.append(box); document.body.append(el);
  }
  const infoHTML = (m, who) => {
    const sp = M.SPECIES[m.sp];
    return h('div', {}, h('div', { style: 'display:flex;justify-content:space-between;gap:8px;font-weight:900' }, h('span', {}, m.name + (m.shiny ? '✨' : ''), stBadge(m.status)), h('span', {}, 'Lv' + m.lv)),
      h('div', { style: 'margin:3px 0' }, sp.types.map(typeChip), who === 'f' && B.view && B.view.foe.owned ? h('span', { title: 'Already caught', style: 'font-size:12px' }, '●') : null),
      hpBar(m.hp, m.max), who === 'p' ? h('div', { style: 'font-size:12px;text-align:right;font-weight:700' }, m.hp + '/' + m.max) : null,
      who === 'p' && m.xpNext ? h('div', { style: 'height:5px;background:#adb5bd;border-radius:3px;margin-top:3px;overflow:hidden' }, h('div', { style: 'height:100%;background:#4dabf7;width:' + Math.max(0, Math.min(100, (m.xp - m.xpCur) / Math.max(1, m.xpNext - m.xpCur) * 100)) + '%' })) : null);
  };
  function paint() {
    const D = B.shown, u = B.ui; if (!u) return;
    u.fInfo.replaceChildren(infoHTML(D.f, 'f')); u.pInfo.replaceChildren(infoHTML(D.p, 'p'));
    if (D.fSp !== B.fSp || D.fShiny !== B.fShiny) { u.fSpr.replaceChildren(spr(D.f.sp, 150, D.f.shiny)); B.fSp = D.fSp; B.fShiny = D.fShiny; }
    if (D.pSp !== B.pSp) { u.pSpr.replaceChildren(spr(D.p.sp, 190, D.p.shiny, true)); B.pSp = D.pSp; }
  }
  const msgDelay = t => 520 + Math.min(900, t.length * 16);
  function setHp(side, hp, max) { const m = B.shown[side]; m.hp = hp; if (max) m.max = max; paint(); }
  const syncKeys = () => { B.shown.fSp = B.shown.f.sp; B.shown.pSp = B.shown.p.sp; B.shown.fShiny = B.shown.f.shiny; };
  async function say(text) { B.ui.text.textContent = text; await sleep(msgDelay(text)); }
  async function play(events, view) {
    const my = ++token; B.busy = true; B.ui.menu.replaceChildren();
    for (const e of events) {
      if (my !== token || !el) return;
      switch (e.k) {
        case 'msg': {
          if (e.anim) { const s = e.anim.side === 'p' ? B.ui.pSpr : B.ui.fSpr, cls = e.anim.side === 'p' ? 'mb-lunge-p' : 'mb-lunge-f'; s.classList.remove(cls); void s.offsetWidth; s.classList.add(cls); }
          await say(e.text); break;
        }
        case 'hp': { const s = e.side === 'p' ? B.ui.pSpr : B.ui.fSpr; if (e.hp < B.shown[e.side].hp) { s.classList.remove('mb-hit'); void s.offsetWidth; s.classList.add('mb-hit'); } const from = B.shown[e.side].hp, steps = 8; for (let i = 1; i <= steps; i++) { setHp(e.side, Math.round(from + (e.hp - from) * i / steps), e.max); await sleep(40); } break; }
        case 'status': B.shown[e.side].status = e.st; paint(); break;
        case 'send': { B.shown[e.side] = Object.assign({}, e.mon); syncKeys(); B.ui[e.side === 'p' ? 'pSpr' : 'fSpr'].classList.remove('mb-faint'); paint(); await sleep(250); break; }
        case 'faint': B.ui[e.side === 'p' ? 'pSpr' : 'fSpr'].classList.add('mb-faint'); await sleep(550); break;
        case 'lv': if (B.shown.p.id === e.id) { B.shown.p.lv = e.lv; paint(); } break;
        case 'evo': if (B.shown.p.id === e.id) { B.shown.p.sp = e.to; B.shown.p.name = M.SPECIES[e.to].name; syncKeys(); paint(); } break;
        case 'catch': await catchAnim(e); break;
        case 'end': B.result = e.result; break;
      }
    }
    if (my !== token) return;
    B.view = view; B.busy = false; B.ui.text.textContent = B.ui.text.textContent;
    if (view) { // final state from the server (xp bar, pp, hp)
      B.shown.p = Object.assign({}, view.me); if (!B.result || B.result !== 'caught') B.shown.f = Object.assign({}, view.foe); syncKeys(); paint();
    }
    menu();
  }
  async function catchAnim(e) {
    const f = B.ui.fSpr, r = f.getBoundingClientRect(), box = el.querySelector('.mb-box').getBoundingClientRect(), o = M.ORBS[e.item] || M.ORBS.orb;
    const orb = h('div', { class: 'mb-orb', style: orbCss(o.color) + ';left:' + (r.left - box.left + 60) + 'px;top:' + (r.top - box.top + 40) + 'px' });
    el.querySelector('.mb-box').append(orb);
    f.style.opacity = '0'; await sleep(450);
    const n = e.ok ? 3 : e.shakes;
    for (let i = 0; i < n; i++) { orb.style.animation = 'none'; void orb.offsetWidth; orb.style.animation = 'mbwob .55s'; await sleep(750); }
    if (!e.ok) { orb.remove(); f.style.opacity = '1'; await sleep(200); }
    else { orb.style.filter = 'brightness(.55)'; await sleep(500); orb.remove(); }
  }
  function menu() {
    const u = B.ui, v = B.view; u.menu.replaceChildren(); if (!v) return;
    const btn = (label, fn, sub, style, dis) => h('button', { onclick: fn, disabled: !!dis, style: style || '' }, label, sub ? h('small', {}, sub) : null);
    if (v.phase === 'over') {
      u.menu.style.gridTemplateColumns = '1fr';
      const res = v.result;
      u.text.textContent = res === 'win' ? '🏆 You won the battle!' : res === 'caught' ? '🎉 Caught it!' : res === 'run' ? 'You got away.' : v.kind === 'pvp' ? 'You lost the battle. Good fight!' : '💀 You blacked out...';
      u.menu.append(btn('Continue ▸', () => { send({ t: 'mb_act', a: 'close' }); }, null, 'background:#2f9e44')); return;
    }
    u.menu.style.gridTemplateColumns = '1fr 1fr';
    if (v.phase === 'wait') { u.text.textContent = 'Waiting for your opponent...'; return; }
    if (v.phase === 'switch') { u.text.textContent = 'Choose your next monster!'; partyMenu(true); return; }
    u.text.textContent = 'What will ' + v.me.name + ' do?';
    u.menu.append(btn('⚔ Fight', fightMenu, null, 'background:#e03131'), v.kind === 'pvp' ? null : btn('🎒 Bag', bagMenu, null, 'background:#f08c00'), btn('🐾 Monsters', () => partyMenu(false), null, 'background:#2f9e44'), btn('🏃 Run', () => send({ t: 'mb_act', a: 'run' }), v.kind === 'wild' ? null : "can't run", 'background:#4263eb', v.kind !== 'wild'));
  }
  function back(fn) { return h('button', { onclick: fn || menu, style: 'grid-column:1/-1;background:#868e96' }, '◂ Back'); }
  function fightMenu() {
    const u = B.ui, v = B.view; u.menu.replaceChildren();
    const noPP = !v.me.moves.some(m => m.pp > 0);
    v.me.moves.forEach((mv, i) => { const d = M.MOVES[mv.id]; u.menu.append(h('button', { disabled: mv.pp <= 0 && !noPP, style: 'background:' + M.TYPE_COL[d.type] + ';text-shadow:0 1px 2px #0008', onclick: () => send({ t: 'mb_act', a: 'move', i }) }, d.name, h('small', {}, d.type + ' · ' + (d.cat === 'st' ? 'Status' : d.pow + ' pwr') + ' · PP ' + mv.pp + '/' + mv.max))); });
    if (noPP) u.menu.append(h('button', { onclick: () => send({ t: 'mb_act', a: 'move', i: 0 }), style: 'background:#495057' }, 'Struggle'));
    u.menu.append(back());
  }
  function partyMenu(forced) {
    const u = B.ui, v = B.view; u.menu.replaceChildren(); u.menu.style.gridTemplateColumns = '1fr 1fr';
    v.party.forEach((m, i) => u.menu.append(h('button', { disabled: m.hp <= 0 || i === v.active, style: 'background:#2f9e44;padding:4px 6px', onclick: () => send({ t: 'mb_act', a: 'switch', i }) }, m.name + ' Lv' + m.lv, h('small', {}, m.hp <= 0 ? 'Fainted' : m.hp + '/' + m.max + (i === v.active ? ' · active' : '')))));
    if (!forced) u.menu.append(back());
  }
  function bagMenu() {
    const u = B.ui, v = B.view; u.menu.replaceChildren();
    const items = Object.entries(v.items || {});
    if (!items.length) u.menu.append(h('div', { style: 'grid-column:1/-1' }, 'Your bag is empty.'));
    for (const [k, n] of items) {
      const o = M.ORBS[k], p = M.POTIONS[k], it = o || p;
      if (o && v.kind !== 'wild') continue;
      u.menu.append(h('button', { style: 'background:' + (o ? '#c92a2a' : '#1971c2') + ';padding:4px 6px', onclick: () => o ? send({ t: 'mb_act', a: 'ball', item: k }) : itemTarget(k) }, it.name + ' ×' + n, h('small', {}, it.desc)));
    }
    u.menu.append(back());
  }
  function itemTarget(k) {
    const u = B.ui, v = B.view; u.menu.replaceChildren(); u.text.textContent = 'Use on which monster?';
    v.party.forEach((m, i) => u.menu.append(h('button', { style: 'background:#1971c2;padding:4px 6px', onclick: () => send({ t: 'mb_act', a: 'item', item: k, i }) }, m.name + ' Lv' + m.lv, h('small', {}, m.hp <= 0 ? 'Fainted' : m.hp + '/' + m.max))));
    u.menu.append(back(bagMenu));
  }
  function start(m) {
    closeModal();
    token++;
    if (el) el.remove();
    B = { kind: m.view.kind, view: m.view, shown: { p: Object.assign({}, m.view.me), f: Object.assign({}, m.view.foe) }, busy: true, result: null, fSp: null, pSp: null };
    syncKeys(); B.fSp = null; B.pSp = null;
    battleEl(); paint();
    ctx.onBattle && ctx.onBattle(true);
    play(m.events || [], m.view);
  }
  function turn(m) { if (!B) return; play(m.events || [], m.view); }
  function closed() { token++; if (el) { el.remove(); el = null; } const res = B && (B.kind === 'pvp' ? 'pvp' : B.result); B = null; ctx.onBattle && ctx.onBattle(false, res); }
  function err(msg) { toast(msg, true); if (B && B.ui && !B.busy) menu(); }

  return {
    challengePlayer, invite, shrine, openMap, openStarter, openDaily, openParty, openCenter, talk, challenge, dailyOk, closed, start, turn, err,
    onBox: m => { boxCache = m.box; if (ctx.isModalOpen()) ctx.refresh(); },
    inBattle: () => !!B,
  };
};
