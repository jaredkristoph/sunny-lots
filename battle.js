'use strict';
// Bitmonster battle engine — server-authoritative. All state lives in u.mon / u.battle; the client only sends intents.
const crypto = require('crypto');
const M = require('./public/monsters.js');
const rnd = n => crypto.randomInt(n);
const rf = () => crypto.randomInt(1 << 30) / (1 << 30);
const uid = () => crypto.randomBytes(5).toString('hex');
const PARTY_MAX = 6, BOX_MAX = 300;

function ensureMon(u) {
  if (!u.mon) u.mon = {};
  const m = u.mon;
  if (!Array.isArray(m.party)) m.party = [];
  if (!Array.isArray(m.box)) m.box = [];
  if (!m.items) m.items = { orb: 5, potion: 3 };
  if (!m.dex) m.dex = { seen: {}, caught: {} };
  if (!m.daily) m.daily = { streak: 0, last: -1 };
  if (!m.beaten) m.beaten = {};
  if (!Array.isArray(m.badges)) m.badges = [];
  if (m.starter === undefined) m.starter = null;
  if (u.battle === undefined) u.battle = null;
  return m;
}
function makeMon(spId, lv, o = {}) {
  const sp = M.SPECIES[spId];
  const iv = {}; for (const k of M.STATS) iv[k] = rnd(16);
  const mon = { id: uid(), sp: spId, lv, xp: M.xpFor(lv), iv, hp: 0, status: null, slp: 0, nick: o.nick || null, shiny: rnd(512) === 0, born: Date.now(), moves: M.movesAt(sp, lv).map(id => ({ id, pp: M.MOVES[id].pp })) };
  mon.hp = M.calcStats(sp, lv, iv).hp;
  return mon;
}
const stats = m => M.calcStats(M.SPECIES[m.sp], m.lv, m.iv);
const maxHp = m => stats(m).hp;
function monView(m, full) {
  const sp = M.SPECIES[m.sp], st = stats(m);
  const v = { id: m.id, sp: m.sp, name: m.nick || sp.name, lv: m.lv, hp: m.hp, max: st.hp, status: m.status, shiny: !!m.shiny };
  if (full) {
    v.xp = m.xp; v.xpCur = M.xpFor(m.lv); v.xpNext = M.xpFor(Math.min(M.MAX_LV, m.lv + 1)); v.stats = st;
    v.moves = m.moves.map(x => ({ id: x.id, pp: x.pp, max: M.MOVES[x.id].pp })); v.nick = m.nick; v.born = m.born;
  }
  return v;
}
const STAGE_KEYS = ['atk', 'def', 'spa', 'sdf', 'spe'];
const freshStages = () => ({ atk: 0, def: 0, spa: 0, sdf: 0, spe: 0 });
const stageMul = n => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));
const eff = (m, side, b, k) => Math.max(1, Math.floor(stats(m)[k] * stageMul(b.stages[side][k]) * (k === 'spe' && m.status === 'par' ? .5 : 1)));

function alive(party) { return party.filter(m => m.hp > 0); }
function firstAlive(party) { return party.findIndex(m => m.hp > 0); }

// ---------- starting battles ----------
function startWild(u, spId, lv) {
  const m = ensureMon(u); if (u.battle) return { error: 'Already in a battle.' };
  if (!alive(m.party).length) return { error: 'Your monsters need healing first.' };
  const foe = makeMon(spId, lv);
  u.battle = newBattle(u, 'wild', [foe], null);
  m.dex.seen[spId] = 1;
  return { ok: true, events: [{ k: 'msg', text: 'A wild ' + M.SPECIES[spId].name + ' appeared!' }] };
}
function startTrainer(u, tr) {
  const m = ensureMon(u); if (u.battle) return { error: 'Already in a battle.' };
  if (!alive(m.party).length) return { error: 'Your monsters need healing first.' };
  const foe = tr.team.map(([sp, lv]) => makeMon(sp, lv));
  u.battle = newBattle(u, 'trainer', foe, tr);
  foe.forEach(f => { m.dex.seen[f.sp] = 1; });
  return { ok: true, events: [{ k: 'msg', text: tr.name + ' wants to battle!' }, { k: 'msg', text: tr.pre }] };
}
function newBattle(u, kind, foe, tr) {
  const m = u.mon;
  return { kind, trainer: tr ? { id: tr.id, name: tr.name, reward: tr.reward, win: tr.win } : null, foe, foeIdx: 0, active: firstAlive(m.party), turn: 1, stages: { p: freshStages(), f: freshStages() }, part: [], phase: 'act', over: false, result: null, runs: 0 };
}
const activeP = (u) => u.mon.party[u.battle.active];
const activeF = b => b.foe[b.foeIdx];

// ---------- damage ----------
function calcDamage(att, def, mv, b, aSide) {
  const dSide = aSide === 'p' ? 'f' : 'p';
  const A = M.SPECIES[att.sp], D = M.SPECIES[def.sp];
  const physical = mv.cat === 'p';
  const ak = physical ? 'atk' : 'spa', dk = physical ? 'def' : 'sdf';
  let a = eff(att, aSide, b, ak), d = eff(def, dSide, b, dk);
  const crit = rnd(16) === 0;
  const base = Math.floor(Math.floor(Math.floor(2 * att.lv / 5 + 2) * mv.pow * a / d) / 50) + 2;
  const tm = M.typeMult(mv.type, D.types);
  let dmg = base * (A.types.includes(mv.type) ? 1.5 : 1) * tm * (crit ? 1.5 : 1) * (.85 + rf() * .15) * (att.status === 'brn' && physical ? .5 : 1);
  dmg = tm === 0 ? 0 : Math.max(1, Math.floor(dmg));
  return { dmg, tm, crit };
}
const nameOf = (m) => m.nick || M.SPECIES[m.sp].name;
const who = (b, side, u) => side === 'p' ? nameOf(activeP(u)) : (b.kind === 'wild' ? 'The wild ' : 'Foe ') + nameOf(activeF(b));
const STAGE_NAME = { atk: 'Attack', def: 'Defense', spa: 'Sp. Attack', sdf: 'Sp. Defense', spe: 'Speed' };
function applyStage(b, side, k, n, ev, label) {
  const cur = b.stages[side][k], nv = Math.max(-6, Math.min(6, cur + n));
  if (nv === cur) { ev.push({ k: 'msg', text: label + "'s " + STAGE_NAME[k] + " won't go any " + (n > 0 ? 'higher' : 'lower') + '!' }); return; }
  b.stages[side][k] = nv;
  ev.push({ k: 'msg', text: label + "'s " + STAGE_NAME[k] + (Math.abs(n) >= 2 ? (n > 0 ? ' rose sharply!' : ' fell harshly!') : (n > 0 ? ' rose!' : ' fell!')) });
}
const hpEv = (side, m) => ({ k: 'hp', side, hp: m.hp, max: maxHp(m) });
function setStatus(m, st, side, ev, label) {
  if (m.status || m.hp <= 0) return false;
  m.status = st; if (st === 'slp') m.slp = 1 + rnd(3);
  ev.push({ k: 'status', side, st });
  ev.push({ k: 'msg', text: label + (st === 'brn' ? ' was burned!' : st === 'psn' ? ' was poisoned!' : st === 'par' ? ' is paralyzed! It may be unable to move!' : ' fell asleep!') });
  return true;
}

// one monster uses a move on the other
function useMove(u, b, side, mvSlot, ev) {
  const att = side === 'p' ? activeP(u) : activeF(b), def = side === 'p' ? activeF(b) : activeP(u), dSide = side === 'p' ? 'f' : 'p';
  const label = who(b, side, u), dLabel = who(b, dSide, u);
  if (att.hp <= 0) return;
  if (att.status === 'slp') { att.slp--; if (att.slp > 0) { ev.push({ k: 'msg', text: label + ' is fast asleep.' }); return; } att.status = null; ev.push({ k: 'status', side, st: null }); ev.push({ k: 'msg', text: label + ' woke up!' }); }
  if (att.status === 'par' && rnd(4) === 0) { ev.push({ k: 'msg', text: label + " is paralyzed! It can't move!" }); return; }
  let mv, slot = null;
  if (mvSlot === 'struggle') mv = { id: 'struggle', name: 'Struggle', type: 'Normal', cat: 'p', pow: 50, acc: 100, pp: 1, fx: { recoil: .25 } };
  else { slot = att.moves[mvSlot]; mv = M.MOVES[slot.id]; slot.pp = Math.max(0, slot.pp - 1); }
  ev.push({ k: 'msg', text: label + ' used ' + mv.name + '!', anim: { side, type: mv.type, cat: mv.cat } });
  if (mv.acc < 100 && rnd(100) >= mv.acc) { ev.push({ k: 'msg', text: label + "'s attack missed!" }); return; }
  if (mv.cat === 'st') {
    const fx = mv.fx;
    if (fx.heal) { const mh = maxHp(att); const h = Math.min(mh - att.hp, Math.floor(mh * fx.heal)); att.hp += h; ev.push(hpEv(side, att)); ev.push({ k: 'msg', text: label + ' restored HP!' }); }
    if (fx.self) for (const k in fx.self) applyStage(b, side, k, fx.self[k], ev, label);
    if (fx.foe) for (const k in fx.foe) applyStage(b, dSide, k, fx.foe[k], ev, dLabel);
    if (fx.st) { if (!setStatus(def, fx.st, dSide, ev, dLabel)) ev.push({ k: 'msg', text: 'But it had no effect!' }); }
    return;
  }
  const { dmg, tm, crit } = calcDamage(att, def, mv, b, side);
  if (tm === 0) { ev.push({ k: 'msg', text: "It doesn't affect " + dLabel + '...' }); return; }
  def.hp = Math.max(0, def.hp - dmg);
  ev.push(hpEv(dSide, def));
  if (crit) ev.push({ k: 'msg', text: 'A critical hit!' });
  if (tm > 1) ev.push({ k: 'msg', text: "It's super effective!" }); else if (tm < 1) ev.push({ k: 'msg', text: "It's not very effective..." });
  if (mv.fx.recoil) { const r = Math.max(1, Math.floor(dmg * mv.fx.recoil)); att.hp = Math.max(0, att.hp - r); ev.push(hpEv(side, att)); ev.push({ k: 'msg', text: label + ' was hurt by recoil!' }); }
  if (def.hp > 0 && mv.fx.st && rnd(100) < (mv.fx.ch || 0)) setStatus(def, mv.fx.st, dSide, ev, dLabel);
}
function foePick(b) {
  const f = activeF(b), usable = f.moves.map((m, i) => ({ m, i })).filter(x => x.m.pp > 0);
  if (!usable.length) return 'struggle';
  return usable[rnd(usable.length)].i;   // trainers and wild monsters pick at random (simple, predictable)
}
const prio = (u, b, side, mvSlot) => {
  if (mvSlot === 'struggle') return 0;
  const m = side === 'p' ? activeP(u) : activeF(b);
  return (M.MOVES[m.moves[mvSlot].id].fx.prio) || 0;
};

function residual(u, b, ev) {
  for (const side of ['p', 'f']) {
    const m = side === 'p' ? activeP(u) : activeF(b);
    if (m.hp <= 0) continue;
    if (m.status === 'brn' || m.status === 'psn') {
      const d = Math.max(1, Math.floor(maxHp(m) / (m.status === 'brn' ? 16 : 8)));
      m.hp = Math.max(0, m.hp - d); ev.push(hpEv(side, m));
      ev.push({ k: 'msg', text: who(b, side, u) + ' was hurt by ' + (m.status === 'brn' ? 'its burn' : 'poison') + '!' });
    }
  }
}

// ---------- rewards / faint handling ----------
function gainExp(u, b, ev) {
  const f = activeF(b), fsp = M.SPECIES[f.sp];
  const total = Math.max(1, Math.floor(M.baseExp(fsp) * f.lv / 7 * (b.kind === 'trainer' ? 1.5 : 1)));
  const gets = u.mon.party.filter(m => m.hp > 0 && b.part.includes(m.id));
  if (!gets.length) return;
  const each = Math.max(1, Math.floor(total / gets.length));
  for (const m of gets) {
    m.xp += each; ev.push({ k: 'msg', text: nameOf(m) + ' gained ' + each + ' EXP!' });
    levelUp(u, m, ev);
  }
}
function levelUp(u, m, ev) {
  while (m.lv < M.MAX_LV && m.xp >= M.xpFor(m.lv + 1)) {
    const before = maxHp(m);
    m.lv++;
    const diff = maxHp(m) - before; m.hp = Math.min(maxHp(m), m.hp + Math.max(0, diff));
    ev.push({ k: 'lv', id: m.id, lv: m.lv });
    ev.push({ k: 'msg', text: nameOf(m) + ' grew to level ' + m.lv + '!' });
    for (const [lvl, id] of M.SPECIES[m.sp].learn) {
      if (lvl !== m.lv || m.moves.some(x => x.id === id)) continue;
      if (m.moves.length < 4) m.moves.push({ id, pp: M.MOVES[id].pp });
      else { // replace the weakest older move
        let wi = 0, wp = 1e9; m.moves.forEach((x, i) => { const p = M.MOVES[x.id].pow || 30; if (p < wp) { wp = p; wi = i; } });
        ev.push({ k: 'msg', text: nameOf(m) + ' forgot ' + M.MOVES[m.moves[wi].id].name + '...' });
        m.moves[wi] = { id, pp: M.MOVES[id].pp };
      }
      ev.push({ k: 'msg', text: nameOf(m) + ' learned ' + M.MOVES[id].name + '!' });
    }
    const sp = M.SPECIES[m.sp];
    if (sp.evo && m.lv >= sp.evo) {
      const old = nameOf(m), pre = maxHp(m);
      m.sp = sp.next; m.hp += Math.max(0, maxHp(m) - pre);
      u.mon.dex.seen[m.sp] = 1; u.mon.dex.caught[m.sp] = 1;
      ev.push({ k: 'evo', id: m.id, from: sp.id, to: m.sp });
      ev.push({ k: 'msg', text: old + ' evolved into ' + M.SPECIES[m.sp].name + '!' });
      for (const [lvl, id] of M.SPECIES[m.sp].learn) if (lvl <= m.lv && lvl > sp.evo - 8 && m.moves.length < 4 && !m.moves.some(x => x.id === id)) m.moves.push({ id, pp: M.MOVES[id].pp });
    }
  }
}
function healAll(u) {
  const m = ensureMon(u);
  for (const x of m.party.concat(m.box)) { x.hp = maxHp(x); x.status = null; x.slp = 0; for (const mm of x.moves) mm.pp = M.MOVES[mm.id].pp; }
}
function finish(u, b, result, ev) {
  b.over = true; b.result = result;
  if (result === 'win' && b.kind === 'trainer' && b.trainer) {
    const first = !u.mon.beaten[b.trainer.id];
    u.mon.beaten[b.trainer.id] = Date.now();
    const pay = first ? b.trainer.reward : Math.floor(b.trainer.reward / 4);
    u.money = Math.round((u.money + pay) * 100) / 100;
    ev.push({ k: 'msg', text: b.trainer.name + ': "' + b.trainer.win + '"' });
    ev.push({ k: 'msg', text: 'You earned $' + pay + (first ? '!' : ' (rematch)') });
  }
  if (result === 'lose') {
    ev.push({ k: 'msg', text: 'You blacked out! Your monsters were healed at the Bitmon Center.' });
    healAll(u);
  }
  ev.push({ k: 'end', result });
}
function afterFoeFaint(u, b, ev) {
  const f = activeF(b);
  ev.push({ k: 'faint', side: 'f' }); ev.push({ k: 'msg', text: (b.kind === 'wild' ? 'The wild ' : 'Foe ') + nameOf(f) + ' fainted!' });
  gainExp(u, b, ev);
  if (b.foeIdx + 1 < b.foe.length) {
    b.foeIdx++; b.stages.f = freshStages(); b.part = [activeP(u).id];
    const n = activeF(b); u.mon.dex.seen[n.sp] = 1;
    ev.push({ k: 'send', side: 'f', mon: monView(n) });
    ev.push({ k: 'msg', text: b.trainer.name + ' sent out ' + nameOf(n) + '!' });
    return false;
  }
  finish(u, b, 'win', ev); return true;
}
function afterPlayerFaint(u, b, ev) {
  ev.push({ k: 'faint', side: 'p' }); ev.push({ k: 'msg', text: nameOf(activeP(u)) + ' fainted!' });
  if (!alive(u.mon.party).length) { finish(u, b, 'lose', ev); return true; }
  b.phase = 'switch'; return false;
}
function checkFaints(u, b, ev) {
  if (b.over) return true;
  if (activeF(b).hp <= 0) { if (afterFoeFaint(u, b, ev)) return true; }
  if (activeP(u).hp <= 0) { if (afterPlayerFaint(u, b, ev)) return true; }
  return false;
}

// ---------- player actions ----------
function view(u) {
  const b = u.battle; if (!b) return null;
  const p = activeP(u), f = activeF(b);
  return {
    kind: b.kind, trainer: b.trainer ? { name: b.trainer.name } : null, phase: b.over ? 'over' : b.phase, result: b.result, turn: b.turn,
    me: monView(p, true), foe: Object.assign(monView(f), { owned: !!u.mon.dex.caught[f.sp], types: M.SPECIES[f.sp].types }), foeLeft: b.foe.length - b.foeIdx,
    party: u.mon.party.map(m => monView(m)), active: b.active,
    items: u.mon.items,
  };
}
function act(db, u, a) {
  const b = u.battle; if (!b) return { error: 'You are not in a battle.' };
  if (b.over) { u.battle = null; return { ok: true, events: [], ended: true }; }
  const ev = [];
  const P = activeP(u), F = activeF(b);
  if (b.phase === 'switch') {          // forced switch after a faint: free, foe does not act
    if (a.a !== 'switch') return { error: 'Choose a monster to send out.' };
    const i = a.i, nm = u.mon.party[i];
    if (!nm || nm.hp <= 0 || i === b.active) return { error: 'That monster cannot battle.' };
    b.active = i; b.stages.p = freshStages(); b.phase = 'act'; if (!b.part.includes(nm.id)) b.part.push(nm.id);
    ev.push({ k: 'send', side: 'p', mon: monView(nm, true) }); ev.push({ k: 'msg', text: 'Go, ' + nameOf(nm) + '!' });
    return { ok: true, events: ev };
  }
  if (!b.part.includes(P.id)) b.part.push(P.id);
  let pMove = null, playerActed = true;
  switch (a.a) {
    case 'move': {
      const i = a.i;
      if (!P.moves.some(x => x.pp > 0)) pMove = 'struggle';
      else { if (!Number.isInteger(i) || !P.moves[i]) return { error: 'Pick a move.' }; if (P.moves[i].pp <= 0) return { error: 'No PP left for that move!' }; pMove = i; }
      break;
    }
    case 'switch': {
      const i = a.i, nm = u.mon.party[i];
      if (!nm || nm.hp <= 0 || i === b.active) return { error: 'That monster cannot battle.' };
      b.active = i; b.stages.p = freshStages(); if (!b.part.includes(nm.id)) b.part.push(nm.id);
      ev.push({ k: 'send', side: 'p', mon: monView(nm, true) }); ev.push({ k: 'msg', text: 'Come back! Go, ' + nameOf(nm) + '!' });
      playerActed = false; break;
    }
    case 'item': {
      const it = M.POTIONS[a.item];
      if (!it || !(u.mon.items[a.item] > 0)) return { error: 'You do not have that item.' };
      const tgt = u.mon.party[a.i === undefined ? b.active : a.i]; if (!tgt) return { error: 'Pick a monster.' };
      if (it.revive) { if (tgt.hp > 0) return { error: 'That monster has not fainted.' }; tgt.hp = Math.max(1, Math.floor(maxHp(tgt) * it.revive)); }
      else if (tgt.hp <= 0) return { error: 'That monster has fainted.' };
      else if (it.heal) { if (tgt.hp >= maxHp(tgt)) return { error: 'HP is already full.' }; tgt.hp = Math.min(maxHp(tgt), tgt.hp + it.heal); }
      else if (it.cure) { if (!tgt.status) return { error: 'No status to cure.' }; tgt.status = null; }
      else if (it.pp) { for (const mm of tgt.moves) mm.pp = Math.min(M.MOVES[mm.id].pp, mm.pp + it.pp); }
      u.mon.items[a.item]--; if (!u.mon.items[a.item]) delete u.mon.items[a.item];
      ev.push({ k: 'msg', text: 'You used a ' + it.name + ' on ' + nameOf(tgt) + '.' });
      if (tgt === P) { ev.push(hpEv('p', P)); ev.push({ k: 'status', side: 'p', st: P.status }); }
      playerActed = false; break;
    }
    case 'ball': {
      if (b.kind !== 'wild') return { error: "You can't catch another trainer's monster!" };
      const o = M.ORBS[a.item];
      if (!o || !(u.mon.items[a.item] > 0)) return { error: 'You do not have that orb.' };
      u.mon.items[a.item]--; if (!u.mon.items[a.item]) delete u.mon.items[a.item];
      const sp = M.SPECIES[F.sp], mh = maxHp(F);
      const owned = !!u.mon.dex.caught[F.sp];
      const mult = M.orbMult(a.item, { sp, turn: b.turn, owned });
      const bonus = F.status === 'slp' ? 2 : F.status ? 1.5 : 1;
      const A = Math.min(255, ((3 * mh - 2 * F.hp) * sp.catch * mult / (3 * mh)) * bonus);
      const B = A >= 255 ? 65536 : Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / A)));
      let shakes = 0; for (let i = 0; i < 4; i++) { if (rnd(65536) < B) shakes++; else break; }
      ev.push({ k: 'msg', text: 'You threw a ' + o.name + '!' });
      if (a.item === 'master') shakes = 4;
      if (shakes >= 4) {
        ev.push({ k: 'catch', shakes: 3, ok: true, item: a.item });
        ev.push({ k: 'msg', text: 'Gotcha! ' + nameOf(F) + ' was caught!' });
        if (a.item === 'heal') { F.hp = mh; F.status = null; }
        F.status = F.status && a.item !== 'heal' ? null : F.status;
        u.mon.dex.caught[F.sp] = 1; u.mon.dex.seen[F.sp] = 1;
        const keep = { id: F.id, sp: F.sp, lv: F.lv, xp: F.xp, iv: F.iv, hp: F.hp, status: null, slp: 0, nick: null, shiny: F.shiny, born: Date.now(), moves: F.moves, ball: a.item };
        if (u.mon.party.length < PARTY_MAX) { u.mon.party.push(keep); ev.push({ k: 'msg', text: nameOf(keep) + ' joined your team.' }); }
        else if (u.mon.box.length < BOX_MAX) { u.mon.box.push(keep); ev.push({ k: 'msg', text: nameOf(keep) + ' was sent to the Bitmon Box.' }); }
        else ev.push({ k: 'msg', text: 'Your box is full — it was released.' });
        finish(u, b, 'caught', ev);
        return { ok: true, events: ev };
      }
      ev.push({ k: 'catch', shakes, ok: false, item: a.item });
      ev.push({ k: 'msg', text: shakes <= 0 ? 'Oh no! It broke free!' : shakes === 1 ? 'Aww! It appeared to be caught!' : shakes === 2 ? 'Aargh! Almost had it!' : 'So close, it broke out!' });
      playerActed = false; break;
    }
    case 'run': {
      if (b.kind !== 'wild') return { error: "You can't run from a trainer battle!" };
      b.runs++;
      const ps = stats(P).spe, fs = Math.max(1, stats(F).spe);
      const odds = Math.floor(ps * 128 / fs) + 30 * b.runs;
      if (ps >= fs || rnd(256) < odds) { ev.push({ k: 'msg', text: 'Got away safely!' }); finish(u, b, 'run', ev); return { ok: true, events: ev }; }
      ev.push({ k: 'msg', text: "Can't escape!" }); playerActed = false; break;
    }
    default: return { error: 'Unknown action.' };
  }
  // order: player's chosen move vs foe's move (non-move actions mean the foe just attacks)
  const fMove = foePick(b);
  const order = [];
  if (playerActed) {
    const pp = prio(u, b, 'p', pMove), fp = prio(u, b, 'f', fMove);
    const ps = eff(P, 'p', b, 'spe'), fs = eff(F, 'f', b, 'spe');
    const pFirst = pp !== fp ? pp > fp : ps !== fs ? ps > fs : rnd(2) === 0;
    order.push(...(pFirst ? [['p', pMove], ['f', fMove]] : [['f', fMove], ['p', pMove]]));
  } else order.push(['f', fMove]);
  for (const [side, mvSlot] of order) {
    if (b.over) break;
    // a monster that fainted earlier this turn does not act
    if ((side === 'p' ? activeP(u) : activeF(b)).hp <= 0) continue;
    useMove(u, b, side, mvSlot, ev);
    if (checkFaints(u, b, ev)) break;
    if (b.phase === 'switch') break;
  }
  if (!b.over && b.phase !== 'switch') { residual(u, b, ev); checkFaints(u, b, ev); }
  if (!b.over) b.turn++;
  return { ok: true, events: ev };
}
// pick a species + level for tall grass
function rollWild(route) {
  const tot = route.pool.reduce((s, p) => s + p[1], 0); let r = rnd(tot), sp = route.pool[0][0];
  for (const [id, w] of route.pool) { if ((r -= w) < 0) { sp = id; break; } }
  return { sp, lv: route.levels[0] + rnd(route.levels[1] - route.levels[0] + 1) };
}
module.exports = { ensureMon, makeMon, monView, startWild, startTrainer, act, view, healAll, rollWild, stats, maxHp, PARTY_MAX, levelUp };
