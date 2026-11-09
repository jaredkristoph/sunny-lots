'use strict';
// Sunny Casino — server-authoritative roulette + blackjack.
// All randomness and money handling live here; the client only sends intents.
const crypto = require('crypto');

const MIN_BET = 50;
const GAMES = ['roulette', 'blackjack', 'slots', 'baccarat', 'highlow'];
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
  if (u.hl === undefined) u.hl = null;
  if (u.bj && !u.bj.hands) { if (u.bj.status === 'playing') u.money += u.bj.bet; u.bj = null; }   // old single-hand format: refund an unfinished hand
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
    history: game === 'roulette' ? g.history.slice(-14) : game === 'baccarat' ? g.history.slice(-30) : undefined,
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

// ---------- blackjack: 1–5 hands, split / double, dealer stands on all 17s, blackjack pays 3:2 ----------
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const MAX_HANDS = 5;
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
const cardPts = c => (c.r === 'A' ? 11 : 'JQK'.includes(c.r) ? 10 : Number(c.r));
const isBlackjack = cards => cards.length === 2 && handValue(cards) === 21;
const bjHand = (cards, bet, split) => ({ cards, bet, split: !!split, done: false, doubled: false, status: 'playing', payout: 0 });
function bjView(u) {
  const b = u.bj; if (!b) return null;
  const done = b.status === 'done', act = !done ? b.hands[b.active] : null;
  const sameVal = act && act.cards.length === 2 && cardPts(act.cards[0]) === cardPts(act.cards[1]);
  return {
    status: b.status, active: b.active, bet: b.bet,
    hands: b.hands.map(h => ({ cards: h.cards, pv: handValue(h.cards), bet: h.bet, status: h.status, payout: h.payout, doubled: h.doubled, split: h.split })),
    dealer: done ? b.dealer : [b.dealer[0], null],
    dv: done ? handValue(b.dealer) : handValue([b.dealer[0]]),
    total: b.hands.reduce((s, h) => s + h.payout, 0), staked: b.hands.reduce((s, h) => s + h.bet, 0),
    canDouble: !!act && act.cards.length === 2 && u.money >= act.bet,
    canSplit: !!act && sameVal && b.hands.length < MAX_HANDS && u.money >= act.bet,
    maxHands: MAX_HANDS,
  };
}
/** Dealer plays (if any hand still contests) and every hand is paid. */
function bjFinish(db, u) {
  const b = u.bj;
  if (b.hands.some(h => h.status === 'stand')) while (handValue(b.dealer) < 17) b.dealer.push(b.deck.pop());
  const dv = handValue(b.dealer);
  let back = 0, staked = 0;
  for (const h of b.hands) {
    staked += h.bet;
    let pay = 0;
    if (h.status === 'blackjack') pay = Math.floor(h.bet * 2.5);
    else if (h.status === 'stand') { const pv = handValue(h.cards); pay = dv > 21 || pv > dv ? h.bet * 2 : pv === dv ? h.bet : 0; }
    h.payout = pay; back += pay;
    if (h.status === 'stand') h.status = pay > h.bet ? 'win' : pay === h.bet ? 'push' : 'lose';
  }
  u.money += back; b.status = 'done';
  record(db, u, 'blackjack', b.hands.length, staked, back);
}
function bjNext(db, u) {   // move to the next hand still being played, or finish the round
  const b = u.bj;
  while (b.active < b.hands.length && b.hands[b.active].done) b.active++;
  if (b.active >= b.hands.length) bjFinish(db, u);
}
function bjSettleHand(h, status) { h.done = true; h.status = status; }
function bjDeal(db, u, bet, nHands) {
  ensureUser(u);
  if (u.bj && u.bj.status === 'playing') return { error: 'Finish your current round first.' };
  nHands = nHands === undefined ? 1 : nHands;
  if (!Number.isInteger(nHands) || nHands < 1 || nHands > MAX_HANDS) return { error: 'Play 1 to ' + MAX_HANDS + ' hands.' };
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > 1e9) return { error: 'Minimum bet is $' + MIN_BET + ' per hand.' };
  if (u.money < bet * nHands) return { error: 'Not enough money for ' + nHands + ' hand' + (nHands > 1 ? 's' : '') + ' of $' + bet + '.' };
  u.money -= bet * nHands;
  const deck = newDeck(), hands = [];
  for (let i = 0; i < nHands; i++) hands.push(bjHand([deck.pop(), deck.pop()], bet));
  const dealer = [deck.pop(), deck.pop()];
  u.bj = { deck, dealer, hands, active: 0, status: 'playing', bet };
  if (isBlackjack(dealer)) {                       // dealer peeks: natural 21 ends the round at once
    for (const h of hands) bjSettleHand(h, isBlackjack(h.cards) ? 'stand' : 'lose');   // a player natural pushes (21 vs 21)
    bjFinish(db, u);
  } else {
    for (const h of hands) if (isBlackjack(h.cards)) bjSettleHand(h, 'blackjack');
    bjNext(db, u);
  }
  return { ok: true };
}
const bjActive = u => { const b = u.bj; return b && b.status === 'playing' ? b.hands[b.active] : null; };
function bjHit(db, u) {
  const h = bjActive(u); if (!h) return { error: 'No hand in play.' };
  h.cards.push(u.bj.deck.pop());
  const pv = handValue(h.cards);
  if (pv > 21) bjSettleHand(h, 'bust'); else if (pv === 21) bjSettleHand(h, 'stand');
  bjNext(db, u); return { ok: true };
}
function bjStand(db, u) {
  const h = bjActive(u); if (!h) return { error: 'No hand in play.' };
  bjSettleHand(h, 'stand'); bjNext(db, u); return { ok: true };
}
function bjDouble(db, u) {
  const h = bjActive(u); if (!h) return { error: 'No hand in play.' };
  if (h.cards.length !== 2) return { error: 'You can only double on your first two cards.' };
  if (u.money < h.bet) return { error: 'Not enough money to double.' };
  u.money -= h.bet; h.bet *= 2; h.doubled = true;
  h.cards.push(u.bj.deck.pop());
  bjSettleHand(h, handValue(h.cards) > 21 ? 'bust' : 'stand');
  bjNext(db, u); return { ok: true };
}
function bjSplit(db, u) {
  const b = u.bj, h = bjActive(u); if (!h) return { error: 'No hand in play.' };
  if (h.cards.length !== 2 || cardPts(h.cards[0]) !== cardPts(h.cards[1])) return { error: 'You can only split two cards of the same value.' };
  if (b.hands.length >= MAX_HANDS) return { error: 'You can have at most ' + MAX_HANDS + ' hands.' };
  if (u.money < h.bet) return { error: 'Not enough money to split.' };
  u.money -= h.bet;
  const aces = h.cards[0].r === 'A';
  const second = bjHand([h.cards.pop()], h.bet, true);
  h.split = true; h.cards.push(b.deck.pop()); second.cards.push(b.deck.pop());
  b.hands.splice(b.active + 1, 0, second);
  for (const x of [h, second]) if (aces || handValue(x.cards) === 21) bjSettleHand(x, 'stand');   // split aces get one card each
  bjNext(db, u); return { ok: true };
}

// ---------- baccarat (punto banco, 8-deck shoe, banker pays 0.95:1, tie 8:1, pairs 11:1) ----------
const BAC_BETS = ['player', 'banker', 'tie', 'ppair', 'bpair'];
const bacPts = c => (c.r === 'A' ? 1 : 'TJQK'.includes(c.r[0]) || c.r === '10' ? 0 : Number(c.r));
const bacTotal = cards => cards.reduce((s, c) => s + bacPts(c), 0) % 10;
function bacShoe() {
  const shoe = [];
  for (let k = 0; k < 8; k++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > shoe.length - 13; i--) { const j = rnd(i + 1); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }   // only the cards we may draw need shuffling
  return shoe;
}
function bacRound() {
  const shoe = bacShoe(), P = [shoe.pop()], B = [shoe.pop()];
  P.push(shoe.pop()); B.push(shoe.pop());
  let pt = bacTotal(P), bt = bacTotal(B);
  if (pt < 8 && bt < 8) {
    let third = null;
    if (pt <= 5) { third = shoe.pop(); P.push(third); pt = bacTotal(P); }
    let draw;
    if (!third) draw = bt <= 5;
    else {
      const v = bacPts(third);
      draw = bt <= 2 ? true : bt === 3 ? v !== 8 : bt === 4 ? v >= 2 && v <= 7 : bt === 5 ? v >= 4 && v <= 7 : bt === 6 ? v === 6 || v === 7 : false;
    }
    if (draw) { B.push(shoe.pop()); bt = bacTotal(B); }
  }
  return { player: { cards: P, total: pt }, banker: { cards: B, total: bt }, outcome: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie', pp: P[0].r === P[1].r, bp: B[0].r === B[1].r };
}
const r2c = x => Math.round(x * 100) / 100;
function bacPayout(b, rd) {
  switch (b.type) {
    case 'player': return rd.outcome === 'player' ? b.amount * 2 : rd.outcome === 'tie' ? b.amount : 0;
    case 'banker': return rd.outcome === 'banker' ? r2c(b.amount * 1.95) : rd.outcome === 'tie' ? b.amount : 0;
    case 'tie': return rd.outcome === 'tie' ? b.amount * 9 : 0;
    case 'ppair': return rd.pp ? b.amount * 12 : 0;
    case 'bpair': return rd.bp ? b.amount * 12 : 0;
    default: return 0;
  }
}
function baccaratDeal(db, u, raw) {
  ensureUser(u);
  if (!Array.isArray(raw) || !raw.length || raw.length > BAC_BETS.length) return { error: 'Place at least one bet of $' + MIN_BET + ' or more.' };
  const bets = [], seen = new Set();
  for (const b of raw) {
    if (!b || !BAC_BETS.includes(b.type) || seen.has(b.type) || !Number.isInteger(b.amount) || b.amount < MIN_BET || b.amount > 1e9) return { error: 'Place at least one bet of $' + MIN_BET + ' or more.' };
    seen.add(b.type); bets.push({ type: b.type, amount: b.amount });
  }
  const total = bets.reduce((s, b) => s + b.amount, 0);
  if (u.money < total) return { error: 'Not enough money for those bets.' };
  const rd = bacRound();
  let paid = 0;
  const results = bets.map(b => { const win = bacPayout(b, rd); paid += win; return Object.assign({}, b, { win }); });
  paid = r2c(paid);
  u.money = r2c(u.money - total + paid);
  record(db, u, 'baccarat', bets.length, total, paid);
  ensureDb(db); const hist = db.casino.baccarat.history; hist.push(rd.outcome === 'player' ? 'P' : rd.outcome === 'banker' ? 'B' : 'T'); if (hist.length > 40) hist.shift();
  return Object.assign(rd, { bets: results, total, paid, net: r2c(paid - total) });
}

// ---------- higher / lower: guess the next card, cash out any time (3% house edge on every guess) ----------
const HL_EDGE = 0.97, HL_MAX_MULT = 500;
const hlCard = () => ({ rank: 1 + rnd(13), s: SUITS[rnd(4)] });     // rank 1 = Ace … 13 = King (ties win for both guesses)
const hlP = (rank, g) => (g === 'hi' ? 14 - rank : rank) / 13;
function hlView(u) {
  const h = u.hl; if (!h) return null;
  const playing = h.status === 'playing';
  return {
    status: h.status, bet: h.bet, card: h.card, prev: h.prev || null, streak: h.streak, mult: h.mult,
    cash: r2c(h.bet * h.mult), payout: h.payout || 0,
    hi: playing ? { p: hlP(h.card.rank, 'hi'), m: Math.round(HL_EDGE / hlP(h.card.rank, 'hi') * 100) / 100 } : null,
    lo: playing ? { p: hlP(h.card.rank, 'lo'), m: Math.round(HL_EDGE / hlP(h.card.rank, 'lo') * 100) / 100 } : null,
    last: h.last || null,
  };
}
function hlStart(db, u, bet) {
  ensureUser(u);
  if (u.hl && u.hl.status === 'playing') return { error: 'Finish or cash out your current streak first.' };
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > 1e9) return { error: 'Minimum bet is $' + MIN_BET + '.' };
  if (u.money < bet) return { error: 'Not enough money for that bet.' };
  u.money = r2c(u.money - bet);
  u.hl = { bet, card: hlCard(), prev: null, streak: 0, mult: 1, status: 'playing', payout: 0, last: null };
  return { ok: true };
}
function hlCashOut(db, u) {
  const h = u.hl; if (!h || h.status !== 'playing') return { error: 'No streak to cash out.' };
  if (h.streak < 1) return { error: 'Win at least one guess first.' };
  h.payout = r2c(h.bet * h.mult); h.status = 'cashed'; u.money = r2c(u.money + h.payout);
  record(db, u, 'highlow', 1, h.bet, h.payout);
  return { ok: true };
}
function hlGuess(db, u, g) {
  const h = u.hl; if (!h || h.status !== 'playing') return { error: 'No game in progress.' };
  if (g !== 'hi' && g !== 'lo') return { error: 'Pick higher or lower.' };
  const p = hlP(h.card.rank, g), next = hlCard();
  const win = g === 'hi' ? next.rank >= h.card.rank : next.rank <= h.card.rank;
  h.prev = h.card; h.card = next; h.last = { g, win };
  if (win) {
    h.streak++; h.mult = Math.round(h.mult * HL_EDGE / p * 10000) / 10000;
    if (h.mult >= HL_MAX_MULT) { h.mult = HL_MAX_MULT; return hlCashOut(db, u); }   // table limit: auto cash-out
  } else {
    h.status = 'lost'; h.payout = 0;
    record(db, u, 'highlow', 1, h.bet, 0);
  }
  return { ok: true };
}
function hlSkip(db, u) {
  const h = u.hl; if (!h || h.status !== 'playing') return { error: 'No game in progress.' };
  h.prev = h.card; h.card = hlCard(); h.last = { g: 'skip' };
  return { ok: true };
}


// ---------- Super-Ace style slots: 5 reels × 4 rows, 1024 ways, cascading wins, golden cards → wilds, free spins, buy bonus ----------
const SL = {
  COLS: 5, ROWS: 4,
  SYM: ['10', 'J', 'Q', 'K', 'A', '♣', '♦', '♥', '♠'],   // 0..8 regular; WILD = 9; SCATTER = 10
  WILD: 9, SCATTER: 10,
  // reel weights for 0..8 + scatter (index 9 is never drawn directly; wilds only come from golden cards)
  W: [22, 20, 18, 16, 14, 12, 9, 7, 5, 0, 2.0],
  // pay per way as a multiple of the TOTAL bet, for 3 / 4 / 5 reels
  PAY_RAW: [[.0105, .0350, .1050], [.0140, .0455, .1400], [.0175, .0595, .1925], [.0245, .0840, .2800], [.0350, .1260, .4200], [.0490, .1750, .6300], [.0700, .2800, 1.0500], [.1050, .4200, 1.7500], [.1750, .7000, 3.5000]],
  PAY: null,
  GOLD: .055, GOLD_FREE: .16,  // chance a card on reels 2-4 is golden (free spins are much richer)
  BASE_MULT: [1, 2, 3, 5], FREE_MULT: [2, 4, 6, 10, 15, 25],
  FREE_SPINS: 10, RETRIGGER: 5, BUY_MULT: 40, MAX_WIN: 5000, MAX_STEPS: 40,
};
SL.PAY = SL.PAY_RAW.map(r => r.map(x => Math.round(x * 1.6 * 1e5) / 1e5));   // paytable scaled to ~95% return (see tests)
const SL_TOTAL = SL.W.reduce((a, b) => a + b, 0);
function slDraw(col, free) {
  let r = Math.random() * SL_TOTAL, s = 0;
  for (; s < SL.W.length; s++) { r -= SL.W[s]; if (r < 0) break; }
  if (s >= SL.W.length) s = 0;
  const gold = s < 9 && s !== SL.SCATTER && col >= 1 && col <= 3 && Math.random() < (free ? SL.GOLD_FREE : SL.GOLD);
  return { s, g: gold ? 1 : 0 };
}
const slGrid = free => Array.from({ length: SL.COLS }, (_, c) => Array.from({ length: SL.ROWS }, () => slDraw(c, free)));   // grid[col][row]
function slEval(grid) {
  const wins = [];
  for (let sym = 0; sym < 9; sym++) {
    let ways = 1, len = 0; const cells = [];
    for (let c = 0; c < SL.COLS; c++) {
      const hit = []; for (let r = 0; r < SL.ROWS; r++) { const t = grid[c][r].s; if (t === sym || t === SL.WILD) hit.push([c, r]); }
      if (!hit.length) break;
      ways *= hit.length; len++; cells.push(...hit);
    }
    if (len >= 3) wins.push({ sym, len, ways, cells, pay: SL.PAY[sym][len - 3] * ways });
  }
  return wins;
}
const slScatters = grid => { let n = 0; for (const col of grid) for (const t of col) if (t.s === SL.SCATTER) n++; return n; };
/** One spin with cascades. Returns {steps, total (in multiples of bet), scatters}. */
function slChain(free) {
  let grid = slGrid(free); const steps = []; let total = 0, mult = 0;
  const ladder = free ? SL.FREE_MULT : SL.BASE_MULT;
  for (let i = 0; i < SL.MAX_STEPS; i++) {
    const wins = slEval(grid);
    const snap = grid.map(col => col.map(t => ({ s: t.s, g: t.g })));
    if (!wins.length) { steps.push({ grid: snap, wins: [], mult: ladder[Math.min(mult, ladder.length - 1)], win: 0 }); break; }
    const m = ladder[Math.min(mult, ladder.length - 1)];
    const raw = wins.reduce((a, w) => a + w.pay, 0), win = raw * m;
    total += win;
    const gone = new Set(), toWild = new Set();
    for (const w of wins) for (const [c, r] of w.cells) { const k = c * 10 + r; if (grid[c][r].g && grid[c][r].s !== SL.WILD) toWild.add(k); else gone.add(k); }
    steps.push({ grid: snap, wins: wins.map(w => ({ sym: w.sym, len: w.len, ways: w.ways, cells: w.cells, pay: w.pay })), mult: m, win, wild: [...toWild], gone: [...gone] });
    // golden winners become wilds in place; other winners drop out and the column refills from the top
    for (const k of toWild) { const c = Math.floor(k / 10), r = k % 10; grid[c][r] = { s: SL.WILD, g: 0 }; }
    for (let c = 0; c < SL.COLS; c++) {
      const keep = []; for (let r = 0; r < SL.ROWS; r++) if (!gone.has(c * 10 + r)) keep.push(grid[c][r]);
      const fresh = []; while (fresh.length + keep.length < SL.ROWS) fresh.push(slDraw(c, free));
      grid[c] = fresh.concat(keep);   // index 0 = top row
    }
    mult++;
  }
  return { steps, total, scatters: slScatters(grid) };
}
/** Whole round: base spin (+ free spins if triggered or bought). All amounts are multiples of the bet until slotSpin converts them. */
function slRound(buy) {
  const out = { base: null, free: [], freeSpins: 0, total: 0 };
  let triggered = !!buy;
  if (!buy) {
    out.base = slChain(false); out.total += out.base.total;
    triggered = out.base.scatters >= 3;
    if (out.base.scatters >= 3) out.freeSpins = SL.FREE_SPINS + (out.base.scatters - 3) * 2;
  } else out.freeSpins = SL.FREE_SPINS;
  if (triggered) {
    let left = out.freeSpins, played = 0;
    while (left > 0 && played < 60) {
      left--; played++;
      const ch = slChain(true); out.free.push(ch); out.total += ch.total;
      if (ch.scatters >= 3) { left += SL.RETRIGGER; ch.retrigger = SL.RETRIGGER; }
      if (out.total >= SL.MAX_WIN) break;
    }
  }
  if (out.total > SL.MAX_WIN) { out.total = SL.MAX_WIN; out.capped = true; }
  return out;
}
function slotSpin(db, u, bet, buy) {
  ensureUser(u);
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > 1e7) return { error: 'Minimum bet is $' + MIN_BET + '.' };
  const cost = buy ? bet * SL.BUY_MULT : bet;
  if (u.money < cost) return { error: 'Not enough money for that ' + (buy ? 'bonus buy' : 'bet') + '.' };
  const r = slRound(!!buy);
  const paid = Math.round(r.total * bet * 100) / 100;
  u.money = Math.round((u.money - cost + paid) * 100) / 100;
  record(db, u, 'slots', 1, cost, paid);
  return { bet, buy: !!buy, cost, paid, net: Math.round((paid - cost) * 100) / 100, base: r.base, free: r.free, freeSpins: r.freeSpins, capped: !!r.capped, mult: r.total };
}

module.exports = { SL, slRound, slotSpin, MIN_BET, ensureDb, ensureUser, info, rouletteSpin, rouletteColor, bjDeal, bjHit, bjStand, bjDouble, bjSplit, bjView, handValue, baccaratDeal, bacRound, bacPayout, hlStart, hlGuess, hlSkip, hlCashOut, hlView };
