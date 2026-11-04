'use strict';
// Sunny Casino — server-authoritative roulette + blackjack.
// All randomness and money handling live here; the client only sends intents.
const crypto = require('crypto');

const MIN_BET = 50;
const GAMES = ['roulette', 'blackjack'];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const rnd = n => crypto.randomInt(n);

// ---------- persistence helpers ----------
function ensureDb(db) {
  if (!db.casino) db.casino = {};
  for (const g of GAMES) {
    const s = db.casino[g] || (db.casino[g] = {});
    for (const k of ['rounds', 'bets', 'wagered', 'paid']) if (typeof s[k] !== 'number') s[k] = 0;
    if (!s.biggest) s.biggest = { n: null, amount: 0 };
    if (!Array.isArray(s.history)) s.history = [];
  }
}
function ensureUser(u) {
  if (!u.casino) u.casino = {};
  for (const g of GAMES) {
    const s = u.casino[g] || (u.casino[g] = {});
    for (const k of ['bets', 'wagered', 'paid', 'wins', 'biggest']) if (typeof s[k] !== 'number') s[k] = 0;
  }
  if (u.bj === undefined) u.bj = null;
}
/** Book one finished round: `bets` bets placed, `wagered` staked, `paid` returned (stake included). */
function record(db, u, game, bets, wagered, paid) {
  ensureDb(db); ensureUser(u);
  const g = db.casino[game], p = u.casino[game], won = paid - wagered;
  g.rounds++; g.bets += bets; g.wagered += wagered; g.paid += paid;
  p.bets += bets; p.wagered += wagered; p.paid += paid;
  if (won > 0) { p.wins++; if (won > p.biggest) p.biggest = won; if (won > g.biggest.amount) g.biggest = { n: u.name, amount: won }; }
}

// ---------- shared stats / leaderboard ----------
function info(db, game, myName) {
  ensureDb(db);
  const g = db.casino[game];
  const rows = [];
  for (const u of Object.values(db.users)) {
    const s = u.casino && u.casino[game];
    if (s && s.bets > 0) rows.push({ n: u.name, net: s.paid - s.wagered, bets: s.bets, wagered: s.wagered, wins: s.wins });
  }
  rows.sort((a, b) => b.net - a.net || b.bets - a.bets || (a.n < b.n ? -1 : 1));
  const mine = rows.findIndex(r => r.n === myName);
  return {
    game, minBet: MIN_BET,
    stats: { rounds: g.rounds, bets: g.bets, wagered: g.wagered, paid: g.paid, biggest: g.biggest, players: rows.length },
    top: rows.slice(0, 10),
    me: mine >= 0 ? Object.assign({ rank: mine + 1 }, rows[mine]) : null,
    history: game === 'roulette' ? g.history.slice(-14) : undefined,
  };
}

// ---------- roulette (single-zero, 37 pockets) ----------
function rouletteColor(n) { return n === 0 ? 'green' : RED.has(n) ? 'red' : 'black'; }
/** Returns the amount handed back for one winning bet (stake included), 0 if it loses. */
function roulettePayout(b, n) {
  switch (b.type) {
    case 'num': return b.value === n ? b.amount * 36 : 0;
    case 'red': return RED.has(n) ? b.amount * 2 : 0;
    case 'black': return n > 0 && !RED.has(n) ? b.amount * 2 : 0;
    case 'odd': return n > 0 && n % 2 === 1 ? b.amount * 2 : 0;
    case 'even': return n > 0 && n % 2 === 0 ? b.amount * 2 : 0;
    case 'low': return n >= 1 && n <= 18 ? b.amount * 2 : 0;
    case 'high': return n >= 19 && n <= 36 ? b.amount * 2 : 0;
    case 'dozen': return n > 0 && Math.ceil(n / 12) === b.value ? b.amount * 3 : 0;
    default: return 0;
  }
}
function cleanBets(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 16) return null;
  const out = [], seen = new Set();
  for (const r of raw) {
    if (!r || typeof r.type !== 'string') return null;
    const amount = r.amount, type = r.type;
    if (!Number.isInteger(amount) || amount < MIN_BET || amount > 1e9) return null;
    let value = null;
    if (type === 'num') { if (!Number.isInteger(r.value) || r.value < 0 || r.value > 36) return null; value = r.value; }
    else if (type === 'dozen') { if (![1, 2, 3].includes(r.value)) return null; value = r.value; }
    else if (!['red', 'black', 'odd', 'even', 'low', 'high'].includes(type)) return null;
    const key = type + ':' + value;
    if (seen.has(key)) return null;   // one stack per spot
    seen.add(key);
    out.push({ type, value, amount });
  }
  return out;
}
function rouletteSpin(db, u, raw) {
  ensureUser(u);
  const bets = cleanBets(raw);
  if (!bets) return { error: 'Place at least one bet of $' + MIN_BET + ' or more.' };
  const total = bets.reduce((s, b) => s + b.amount, 0);
  if (u.money < total) return { error: 'Not enough money for those bets.' };
  const n = rnd(37);
  let paid = 0;
  const results = bets.map(b => { const win = roulettePayout(b, n); paid += win; return Object.assign({}, b, { win }); });
  u.money = u.money - total + paid;
  record(db, u, 'roulette', bets.length, total, paid);
  ensureDb(db); db.casino.roulette.history.push(n); if (db.casino.roulette.history.length > 40) db.casino.roulette.history.shift();
  return { n, color: rouletteColor(n), bets: results, total, paid, net: paid - total };
}

// ---------- blackjack (one deck per hand, dealer stands on all 17s, BJ pays 3:2) ----------
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function handValue(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; t += 11; } else t += ('JQK'.includes(c.r) ? 10 : Number(c.r)); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
}
const isBlackjack = cards => cards.length === 2 && handValue(cards) === 21;
function bjView(u) {
  const h = u.bj; if (!h) return null;
  const done = h.status !== 'playing';
  return {
    bet: h.bet, status: h.status, payout: h.payout || 0,
    player: h.player, pv: handValue(h.player),
    dealer: done ? h.dealer : [h.dealer[0], null],
    dv: done ? handValue(h.dealer) : handValue([h.dealer[0]]),
    canDouble: !done && h.player.length === 2 && !h.doubled && u.money >= h.bet,
  };
}
function bjFinish(db, u, status) {
  const h = u.bj;
  let back = 0;
  if (status === 'blackjack') back = Math.floor(h.bet * 2.5);
  else if (status === 'win') back = h.bet * 2;
  else if (status === 'push') back = h.bet;
  h.status = status; h.payout = back;
  u.money += back;
  record(db, u, 'blackjack', 1, h.bet, back);
}
function bjSettle(db, u) {   // dealer plays out, then compare
  const h = u.bj;
  while (handValue(h.dealer) < 17) h.dealer.push(h.deck.pop());
  const pv = handValue(h.player), dv = handValue(h.dealer);
  bjFinish(db, u, dv > 21 || pv > dv ? 'win' : pv === dv ? 'push' : 'lose');
}
function bjDeal(db, u, bet) {
  ensureUser(u);
  if (u.bj && u.bj.status === 'playing') return { error: 'Finish your current hand first.' };
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > 1e9) return { error: 'Minimum bet is $' + MIN_BET + '.' };
  if (u.money < bet) return { error: 'Not enough money for that bet.' };
  u.money -= bet;
  const deck = newDeck();
  u.bj = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], status: 'playing', doubled: false, payout: 0 };
  const pbj = isBlackjack(u.bj.player), dbj = isBlackjack(u.bj.dealer);
  if (pbj || dbj) bjFinish(db, u, pbj && dbj ? 'push' : pbj ? 'blackjack' : 'lose');
  return { ok: true };
}
function bjHit(db, u) {
  const h = u.bj; if (!h || h.status !== 'playing') return { error: 'No hand in play.' };
  h.player.push(h.deck.pop());
  const pv = handValue(h.player);
  if (pv > 21) bjFinish(db, u, 'lose');
  else if (pv === 21) bjSettle(db, u);
  return { ok: true };
}
function bjStand(db, u) {
  const h = u.bj; if (!h || h.status !== 'playing') return { error: 'No hand in play.' };
  bjSettle(db, u);
  return { ok: true };
}
function bjDouble(db, u) {
  const h = u.bj; if (!h || h.status !== 'playing') return { error: 'No hand in play.' };
  if (h.player.length !== 2 || h.doubled) return { error: 'You can only double on your first two cards.' };
  if (u.money < h.bet) return { error: 'Not enough money to double.' };
  u.money -= h.bet; h.bet *= 2; h.doubled = true;
  h.player.push(h.deck.pop());
  if (handValue(h.player) > 21) bjFinish(db, u, 'lose'); else bjSettle(db, u);
  return { ok: true };
}

module.exports = { MIN_BET, ensureDb, ensureUser, info, rouletteSpin, rouletteColor, bjDeal, bjHit, bjStand, bjDouble, bjView, handValue };
