'use strict';
// Bitmonsters — shared data (server + browser). 151 original creatures, 12 types, moves with PP, evolutions, capture orbs, routes, trainers.
(function (root) {
  const TYPES = ['Normal', 'Flame', 'Aqua', 'Leaf', 'Volt', 'Frost', 'Stone', 'Gale', 'Shade', 'Mind', 'Toxic', 'Brawl'];
  const TYPE_COL = { Normal: '#a8a77a', Flame: '#ee8130', Aqua: '#6390f0', Leaf: '#7ac74c', Volt: '#f7d02c', Frost: '#96d9d6', Stone: '#b6a136', Gale: '#a98ff3', Shade: '#735797', Mind: '#f95587', Toxic: '#a33ea1', Brawl: '#c22e28' };
  // attacker -> { super:[...], half:[...], none:[...] }
  const CHART = {
    Normal: { half: ['Stone'], none: ['Shade'] },
    Flame: { sup: ['Leaf', 'Frost'], half: ['Flame', 'Aqua', 'Stone'] },
    Aqua: { sup: ['Flame', 'Stone'], half: ['Aqua', 'Leaf'] },
    Leaf: { sup: ['Aqua', 'Stone'], half: ['Flame', 'Leaf', 'Toxic', 'Gale'] },
    Volt: { sup: ['Aqua', 'Gale'], half: ['Volt', 'Leaf'], none: ['Stone'] },
    Frost: { sup: ['Leaf', 'Gale'], half: ['Flame', 'Aqua', 'Frost'] },
    Stone: { sup: ['Flame', 'Volt', 'Frost', 'Gale'], half: ['Brawl'] },
    Gale: { sup: ['Leaf', 'Brawl'], half: ['Volt', 'Stone'] },
    Shade: { sup: ['Mind', 'Shade'], none: ['Normal'] },
    Mind: { sup: ['Brawl', 'Toxic'], half: ['Mind', 'Shade'] },
    Toxic: { sup: ['Leaf'], half: ['Toxic', 'Stone', 'Shade'] },
    Brawl: { sup: ['Normal', 'Stone', 'Frost'], half: ['Gale', 'Mind', 'Toxic'], none: ['Shade'] },
  };
  function typeMult(atk, defTypes) {
    let m = 1; const c = CHART[atk] || {};
    for (const d of defTypes) { if (!d) continue; if ((c.sup || []).includes(d)) m *= 2; else if ((c.half || []).includes(d)) m *= .5; else if ((c.none || []).includes(d)) m *= 0; }
    return m;
  }

  // ---------- moves ----------
  const MOVES = {}; const MOVE_LIST = [];
  function mv(id, name, type, cat, pow, acc, pp, fx) { const m = { id, name, type, cat, pow, acc, pp, fx: fx || {} }; MOVES[id] = m; MOVE_LIST.push(m); }
  const PHYS = new Set(['Normal', 'Stone', 'Brawl', 'Gale']);
  const TM = {   // [tier1, tier2, tier3, tier4, utility(name, fx, acc)]
    Normal: [['Tap', 'Body Bash', 'Heavy Rush', 'Mega Crash'], null],
    Flame: [['Cinder Snap', 'Blaze Lash', 'Scorch Wave', 'Inferno Crash'], ['Singe', { st: 'brn' }, 85]],
    Aqua: [['Splash Jab', 'Tide Slash', 'Torrent Burst', 'Tsunami Crush'], ['Soak Down', { foe: { spe: -1 } }, 100]],
    Leaf: [['Vine Tap', 'Razor Frond', 'Bloom Cannon', 'Verdant Crash'], ['Spore Dust', { st: 'slp' }, 75]],
    Volt: [['Spark Nip', 'Zap Fang', 'Thunder Lance', 'Storm Smite'], ['Static Wave', { st: 'par' }, 90]],
    Frost: [['Frost Nip', 'Shard Volley', 'Blizzard Edge', 'Glacier Crush'], ['Chill Gust', { foe: { spe: -1 } }, 100]],
    Stone: [['Pebble Toss', 'Rock Hammer', 'Boulder Rain', 'Quake Smash'], ['Stone Skin', { self: { def: 2 } }, 100]],
    Gale: [['Gust Peck', 'Wing Slash', 'Cyclone Dive', 'Tempest Fury'], ['Tailwind', { self: { spe: 2 } }, 100]],
    Shade: [['Shadow Lick', 'Night Claw', 'Dread Pulse', 'Umbral Doom'], ['Dark Mist', { foe: { spa: -2 } }, 100]],
    Mind: [['Mind Flick', 'Psi Wave', 'Brain Burst', 'Cosmic Crush'], ['Meditate', { self: { spa: 2 } }, 100]],
    Toxic: [['Sting Dart', 'Acid Splash', 'Sludge Rush', 'Venom Storm'], ['Toxic Cloud', { st: 'psn' }, 90]],
    Brawl: [['Jab Combo', 'Rolling Punch', 'Power Chop', 'Final Fury'], ['Battle Cry', { self: { atk: 2 } }, 100]],
  };
  const TIER = [[40, 100, 35], [65, 100, 25], [90, 95, 15], [115, 85, 5]];
  for (const t of TYPES) {
    const [names, util] = TM[t]; const cat = PHYS.has(t) ? 'p' : 's', low = t.toLowerCase();
    names.forEach((n, i) => {
      const fx = {};
      if (t === 'Normal' && i === 0) { fx.prio = 1; }
      if (t === 'Normal' && i === 3) fx.recoil = .25;
      if (i >= 1 && i <= 3) { if (t === 'Flame') fx.st = 'brn', fx.ch = i === 3 ? 30 : 10; if (t === 'Volt') fx.st = 'par', fx.ch = i === 3 ? 30 : 10; if (t === 'Toxic') fx.st = 'psn', fx.ch = 30; if (t === 'Frost') fx.foeSt = 0; }
      mv(low + (i + 1), n, t, cat, TIER[i][0], TIER[i][1], TIER[i][2], fx);
    });
    if (util) mv(low + 'fx', util[0], t, 'st', 0, util[2], 20, util[1]);
  }
  mv('growl', 'Growl', 'Normal', 'st', 0, 100, 40, { foe: { atk: -1 } });
  mv('harden', 'Harden', 'Normal', 'st', 0, 100, 30, { self: { def: 1 } });
  mv('rally', 'Rally Cry', 'Normal', 'st', 0, 100, 20, { self: { atk: 1, spa: 1 } });
  mv('screech', 'Screech', 'Normal', 'st', 0, 85, 20, { foe: { def: -2 } });
  mv('restup', 'Rest Up', 'Normal', 'st', 0, 100, 10, { heal: .5 });
  mv('lullaby', 'Lullaby', 'Normal', 'st', 0, 70, 15, { st: 'slp' });
  mv('hustle', 'Hustle', 'Normal', 'st', 0, 100, 20, { self: { spe: 2 } });

  // ---------- species (151) ----------
  // [type1, type2, build, hue, role, [stage names], opts]
  const FAMILIES = [
    ['Flame', null, 'biped', 18, 'spa', ['Embrix', 'Blazern', 'Pyrovane'], { starter: 1 }],
    ['Leaf', null, 'quad', 110, 'bal', ['Mossling', 'Bramblade', 'Verdantor'], { starter: 1 }],
    ['Aqua', null, 'quad', 205, 'def', ['Ripplet', 'Torrentail', 'Tidalord'], { starter: 1 }],
    ['Normal', 'Gale', 'bird', 30, 'fast', ['Pipwing', 'Gustrel', 'Skyranger']],
    ['Normal', null, 'mouse', 35, 'atk', ['Nibbet', 'Gnawlord']],
    ['Leaf', 'Toxic', 'bug', 95, 'def', ['Larvix', 'Cocoonet', 'Wingmoth']],
    ['Volt', null, 'mouse', 52, 'fast', ['Sparkit', 'Dynamox']],
    ['Stone', null, 'golem', 40, 'def', ['Pebblin', 'Cragnar', 'Monolith']],
    ['Normal', null, 'mouse', 20, 'fast', ['Hoplet', 'Bounder']],
    ['Aqua', null, 'fish', 200, 'atk', ['Finlet', 'Tidefang']],
    ['Aqua', 'Stone', 'bug', 10, 'def', ['Pincro', 'Claptide']],
    ['Leaf', 'Toxic', 'plant', 120, 'spa', ['Budlet', 'Petalume', 'Floravore']],
    ['Toxic', null, 'snake', 280, 'atk', ['Slithe', 'Venomaw']],
    ['Toxic', null, 'blob', 290, 'hp', ['Gloop', 'Sludgeon']],
    ['Brawl', null, 'biped', 5, 'atk', ['Scrapper', 'Brawlion', 'Titanfist']],
    ['Mind', null, 'biped', 320, 'spa', ['Dreamlet', 'Psyclid', 'Mindarch']],
    ['Shade', null, 'ghost', 265, 'spa', ['Wispy', 'Gloomwraith', 'Phantasma']],
    ['Frost', null, 'quad', 185, 'spa', ['Snowpup', 'Glacihound']],
    ['Flame', null, 'quad', 15, 'atk', ['Cindercub', 'Magmahound']],
    ['Gale', 'Toxic', 'bird', 270, 'fast', ['Flutterbat', 'Nightgale']],
    ['Leaf', null, 'quad', 100, 'fast', ['Fawnleaf', 'Antlerbloom']],
    ['Aqua', 'Frost', 'blob', 195, 'hp', ['Plopseal', 'Glacioceal']],
    ['Stone', null, 'snake', 35, 'def', ['Gravelcoil', 'Mountserp']],
    ['Volt', 'Gale', 'bird', 55, 'spa', ['Zephyrling', 'Stormcrest']],
    ['Normal', null, 'quad', 28, 'hp', ['Snuffle', 'Bearsnor', 'Grizzlemass']],
    ['Frost', 'Gale', 'bird', 190, 'def', ['Frostling', 'Icewing']],
    ['Flame', 'Gale', 'bird', 12, 'spa', ['Embercrest', 'Phoenixar']],
    ['Shade', null, 'quad', 270, 'fast', ['Dusksneak', 'Nightprowl']],
    ['Mind', null, 'quad', 310, 'spa', ['Mysticub', 'Auravixen']],
    ['Brawl', 'Stone', 'golem', 8, 'atk', ['Rocksmash', 'Boulderbrute']],
    ['Volt', null, 'quad', 50, 'atk', ['Joltkit', 'Thundercat']],
    ['Aqua', 'Stone', 'golem', 210, 'def', ['Shellpup', 'Carapace', 'Fortishell']],
    ['Leaf', 'Stone', 'golem', 105, 'def', ['Sapling', 'Barkguard', 'Elderoak']],
    ['Toxic', 'Brawl', 'bug', 300, 'atk', ['Stingbit', 'Scorpex']],
    ['Aqua', null, 'fish', 215, 'spa', ['Gulpfin', 'Maelmaw']],
    ['Frost', 'Stone', 'golem', 180, 'def', ['Icicube', 'Permafrost']],
    ['Mind', 'Shade', 'ghost', 330, 'spa', ['Hypnowisp', 'Somnarch']],
    ['Gale', 'Stone', 'dragon', 230, 'atk', ['Windlet', 'Skyserpent', 'Aerodrake']],
    ['Flame', 'Toxic', 'snake', 8, 'spa', ['Smolder', 'Cindervenom']],
    ['Brawl', 'Gale', 'bird', 3, 'atk', ['Pecksly', 'Kickfowl']],
    ['Normal', null, 'snake', 45, 'hp', ['Wormlet', 'Burrowyrm']],
    ['Aqua', 'Toxic', 'ghost', 220, 'spa', ['Jellyp', 'Stingbloom']],
    ['Leaf', 'Toxic', 'plant', 20, 'hp', ['Capling', 'Sporeking']],
    ['Stone', 'Normal', 'mouse', 38, 'atk', ['Burrowit', 'Tunnelord']],
    ['Volt', null, 'blob', 58, 'spa', ['Zaplet', 'Voltmass']],
    ['Shade', 'Gale', 'bird', 275, 'atk', ['Owlette', 'Duskowl']],
    ['Mind', 'Leaf', 'bug', 340, 'spa', ['Psylarv', 'Cognimoth']],
    ['Brawl', null, 'quad', 2, 'atk', ['Pugilcub', 'Bruiser']],
    ['Frost', 'Aqua', 'fish', 188, 'atk', ['Icefin', 'Coldmaw']],
    ['Flame', 'Stone', 'golem', 22, 'atk', ['Magmite', 'Volcanor']],
    ['Normal', 'Mind', 'blob', 335, 'hp', ['Puffling', 'Cloudwhale']],
    ['Leaf', 'Gale', 'bird', 115, 'fast', ['Seedbird', 'Canopyhawk']],
    ['Toxic', 'Shade', 'ghost', 285, 'spa', ['Fumelet', 'Smogspecter']],
    ['Stone', 'Brawl', 'quad', 42, 'atk', ['Hornrock', 'Ramblast']],
    ['Volt', 'Aqua', 'fish', 60, 'fast', ['Eelspark', 'Thunderlash']],
    ['Gale', 'Stone', 'dragon', 25, 'atk', ['Dracolet', 'Dragonel', 'Drakonar'], { rare: 1 }],
    // single-stage
    ['Stone', 'Normal', 'golem', 30, 'def', ['Rustclank']], ['Aqua', null, 'blob', 205, 'hp', ['Tidewhale']], ['Volt', null, 'quad', 55, 'atk', ['Voltwolf']],
    ['Frost', 'Stone', 'quad', 185, 'hp', ['Frostmammoth']], ['Shade', 'Brawl', 'biped', 268, 'atk', ['Shadeknight']], ['Mind', null, 'quad', 315, 'spa', ['Mindsphinx']],
    ['Toxic', 'Leaf', 'bug', 288, 'atk', ['Venomantis']], ['Flame', 'Leaf', 'quad', 24, 'atk', ['Flamestag']], ['Gale', null, 'snake', 235, 'fast', ['Galewyrm']],
    ['Mind', 'Normal', 'mouse', 325, 'fast', ['Lunarabbit']], ['Aqua', 'Leaf', 'plant', 170, 'def', ['Coralisk']], ['Leaf', 'Toxic', 'mouse', 125, 'atk', ['Thornquill']],
    ['Volt', 'Stone', 'golem', 48, 'spa', ['Magnetbit']], ['Toxic', 'Stone', 'blob', 295, 'def', ['Tarbeast']], ['Frost', 'Mind', 'dragon', 192, 'spa', ['Blizzarchon']],
    ['Gale', 'Mind', 'bird', 250, 'spa', ['Echobat']], ['Brawl', 'Mind', 'biped', 340, 'atk', ['Brawlmonk']], ['Shade', 'Mind', 'ghost', 300, 'spa', ['Mirrorghost']],
    ['Stone', 'Aqua', 'fish', 45, 'def', ['Duneray']],
    // legendary
    ['Flame', 'Gale', 'bird', 10, 'spa', ['Solarex'], { legend: 1 }], ['Aqua', 'Frost', 'dragon', 195, 'spa', ['Aquarion'], { legend: 1 }],
    ['Stone', 'Leaf', 'golem', 100, 'def', ['Terraknox'], { legend: 1 }], ['Volt', 'Gale', 'bird', 52, 'fast', ['Voltarch'], { legend: 1 }],
    ['Mind', 'Shade', 'ghost', 300, 'spa', ['Omnimind'], { legend: 1 }],
  ];
  const ROLE_W = { bal: [16, 16, 17, 17, 17, 17], atk: [15, 22, 15, 10, 13, 25], spa: [14, 10, 13, 24, 15, 24], def: [17, 14, 26, 10, 22, 11], fast: [14, 17, 11, 17, 11, 30], hp: [28, 16, 14, 14, 14, 14] };
  const STATS = ['hp', 'atk', 'def', 'spa', 'sdf', 'spe'];
  const SPECIES = [null]; const BY_NAME = {};
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  FAMILIES.forEach((f, fi) => {
    const [t1, t2, build, hue, role, names, o = {}] = f, n = names.length;
    names.forEach((name, si) => {
      const id = SPECIES.length;
      let bst = o.legend ? 600 : n === 1 ? 420 : n === 2 ? (si ? 470 : 320) : [310, 420, 520][si];
      if (o.rare) bst += 30;
      if (o.starter) bst += 10;
      const w = ROLE_W[role], base = {};
      STATS.forEach((k, i) => { base[k] = Math.max(25, Math.round(bst * w[i] / 100)); });
      if (o.legend) STATS.forEach(k => { base[k] = Math.round(base[k] * 1.05); });
      const sp = {
        id, name, fam: fi, stage: si, stages: n, types: t2 ? [t1, t2] : [t1], build, hue, base, bst: STATS.reduce((a, k) => a + base[k], 0),
        evo: si < n - 1 ? (o.starter ? [16, 36][si] : o.rare ? [30, 50][si] : n === 3 ? [16, 34][si] : 22) : null,
        next: si < n - 1 ? id + 1 : null, prev: si > 0 ? id - 1 : null,
        catch: o.legend ? 3 : o.rare ? 45 : n === 1 ? 120 : n === 3 ? [255, 120, 45][si] : [190, 75][si],
        starter: !!o.starter, rare: !!o.rare, legend: !!o.legend, role,
      };
      sp.learn = learnset(sp);
      SPECIES.push(sp); BY_NAME[name] = id;
    });
  });
  function learnset(sp) {
    const h = hashStr(sp.name), t1 = sp.types[0].toLowerCase(), t2 = (sp.types[1] || sp.types[0]).toLowerCase();
    const UT = ['growl', 'harden', 'rally', 'screech', 'hustle', 'restup', 'lullaby'];
    const u1 = UT[h % UT.length], u2 = UT[(h >> 3) % UT.length];
    let L;
    if (t1 === 'normal') { const same = t2 === 'normal'; L = [[1, 'normal1'], [3, u1], [9, 'normal2'], [14, same ? 'lullaby' : t2 + '1'], [20, u2], [26, 'normal3'], [33, same ? 'rally' : t2 + '2'], [42, 'normal4'], [50, same ? 'restup' : t2 + '3']]; }
    else {
      L = [[1, 'normal1'], [1, t1 + '1'], [5, u1], [9, t1 + '2'], [13, t2 + '1'], [17, t1 + 'fx'], [22, t1 + '3'], [27, u2], [30, t2 + '2'], [34, 'normal2'], [40, t1 + '4'], [46, t2 !== t1 ? t2 + '3' : 'normal3'], [54, t2 + '4']];
    }
    if (sp.legend) L.splice(2, 0, [1, t2 + '3'], [1, t1 + '4']);
    return L.filter((x, i, a) => MOVES[x[1]] && a.findIndex(y => y[1] === x[1]) === i);
  }
  const COUNT = SPECIES.length - 1;
  function movesAt(sp, lv) { const pool = sp.learn.filter(x => x[0] <= lv).map(x => x[1]); return pool.slice(-4); }
  // 25 natures: each raises one stat by 10% and lowers another by 10% (5 are neutral). HP is never changed.
  const NAT_STATS = ['atk', 'def', 'spa', 'sdf', 'spe'];
  const NAT_NAMES = [['Reckless', 'Brutish', 'Rowdy', 'Plodding'], ['Guarded', 'Stubborn', 'Sturdy', 'Anchored'], ['Clever', 'Daring', 'Sharp', 'Dreamy'], ['Gentle', 'Serene', 'Patient', 'Wary'], ['Nimble', 'Hasty', 'Jaunty', 'Zippy']];
  const NATURES = [];
  NAT_STATS.forEach((up, ui) => { let j = 0; NAT_STATS.forEach((dn, di) => { if (ui === di) return; NATURES.push({ id: NATURES.length, name: NAT_NAMES[ui][j++], up, down: dn }); }); });
  ['Steady', 'Plain', 'Easygoing', 'Mellow', 'Placid'].forEach(n => NATURES.push({ id: NATURES.length, name: n, up: null, down: null }));
  function calcStats(sp, lv, iv, nature) {
    const o = {}, nat = NATURES[nature | 0] || NATURES[20];
    for (const k of STATS) {
      const b = sp.base[k], i = (iv && iv[k]) || 0;
      if (k === 'hp') { o[k] = Math.floor((2 * b + i) * lv / 100) + lv + 10; continue; }
      o[k] = Math.floor((Math.floor((2 * b + i) * lv / 100) + 5) * (nat.up === k ? 1.1 : nat.down === k ? .9 : 1));
    }
    return o;
  }
  const xpFor = lv => lv * lv * lv;      // total xp needed to be at level `lv`
  const MAX_LV = 100;
  const baseExp = sp => Math.round(sp.bst / 5 + (sp.legend ? 120 : sp.rare ? 40 : 0));

  // ---------- items ----------
  // orbs: mult(ctx) -> catch multiplier. ctx: {sp, turn, caught}
  const ORBS = {
    orb: { name: 'Bit Orb', price: 60, color: '#e03131', desc: 'A standard capture orb.' },
    great: { name: 'Great Orb', price: 150, color: '#1c7ed6', desc: '1.5× catch rate.' },
    ultra: { name: 'Ultra Orb', price: 350, color: '#f59f00', desc: '2× catch rate.' },
    master: { name: 'Master Orb', price: 0, color: '#9c36b5', desc: 'Never fails. Not sold in shops.' },
    net: { name: 'Net Orb', price: 220, color: '#2b8a3e', desc: '3.5× vs Aqua and Leaf monsters.' },
    dusk: { name: 'Dusk Orb', price: 220, color: '#343a40', desc: '3.5× vs Shade, Stone and Toxic monsters.' },
    quick: { name: 'Quick Orb', price: 260, color: '#fcc419', desc: '4× on the first turn of a battle.' },
    timer: { name: 'Timer Orb', price: 260, color: '#868e96', desc: 'Gets stronger every turn (up to 4×).' },
    repeat: { name: 'Repeat Orb', price: 240, color: '#e8590c', desc: '3.5× vs species you already own.' },
    heal: { name: 'Heal Orb', price: 300, color: '#f783ac', desc: 'Fully heals the monster you catch.' },
  };
  function orbMult(id, ctx) {
    const t = ctx.sp.types;
    switch (id) {
      case 'great': return 1.5; case 'ultra': return 2; case 'master': return 255;
      case 'net': return t.includes('Aqua') || t.includes('Leaf') ? 3.5 : 1;
      case 'dusk': return t.includes('Shade') || t.includes('Stone') || t.includes('Toxic') ? 3.5 : 1;
      case 'quick': return ctx.turn <= 1 ? 4 : 1;
      case 'timer': return Math.min(4, 1 + ctx.turn * .5);
      case 'repeat': return ctx.owned ? 3.5 : 1;
      default: return 1;
    }
  }
  const POTIONS = {
    potion: { name: 'Potion', price: 50, heal: 40, desc: 'Restores 40 HP.' },
    super: { name: 'Super Potion', price: 150, heal: 100, desc: 'Restores 100 HP.' },
    hyper: { name: 'Hyper Potion', price: 400, heal: 250, desc: 'Restores 250 HP.' },
    revive: { name: 'Revive', price: 500, revive: .5, desc: 'Revives a fainted monster with half HP.' },
    cure: { name: 'Cure-All', price: 100, cure: true, desc: 'Cures burn, poison, paralysis and sleep.' },
    ether: { name: 'Ether', price: 300, pp: 10, desc: 'Restores 10 PP to every move.' },
  };
  const SHOP = ['orb', 'great', 'ultra', 'net', 'dusk', 'quick', 'timer', 'repeat', 'heal', 'potion', 'super', 'hyper', 'revive', 'cure', 'ether'];

  // ---------- daily rewards (day 7 = rare monster) ----------
  const DAILY = [
    { money: 200, items: { orb: 5 } }, { money: 300, items: { potion: 3 } }, { items: { great: 3 } },
    { money: 800, items: { super: 2, revive: 1 } }, { items: { great: 5, ether: 1 } }, { money: 1500, items: { ultra: 3 } },
    { monster: BY_NAME.Dracolet, level: 10, items: { master: 1 }, rare: true },
  ];

  // ---------- route 1 (east of the town wall) ----------
  const ROUTES = {
    r1: {
      id: 'r1', name: 'Route 1 · Sunny Fields', levels: [3, 8],
      pool: [[BY_NAME.Pipwing, 20], [BY_NAME.Nibbet, 20], [BY_NAME.Larvix, 14], [BY_NAME.Hoplet, 14], [BY_NAME.Sparkit, 7], [BY_NAME.Budlet, 10], [BY_NAME.Slithe, 8], [BY_NAME.Finlet, 4], [BY_NAME.Pebblin, 3]],
    },
  };
  const TRAINERS = [
    { id: 't_tim', name: 'Rookie Tim', x: 80, y: 24, look: 0, team: [[BY_NAME.Nibbet, 4]], reward: 120, pre: "You look new here! Let's battle!", win: 'Whoa, you are tough!' },
    { id: 't_ana', name: 'Scout Ana', x: 98, y: 24, look: 1, team: [[BY_NAME.Pipwing, 5], [BY_NAME.Larvix, 5]], reward: 220, pre: 'My bitmonsters trained all week!', win: 'We need more practice...' },
    { id: 't_bo', name: 'Hiker Bo', x: 86, y: 44, look: 2, team: [[BY_NAME.Pebblin, 6], [BY_NAME.Burrowit, 6]], reward: 320, pre: 'Rocks are the toughest. Prove me wrong!', win: 'Solid battle. Respect.' },
    { id: 't_mia', name: 'Angler Mia', x: 104, y: 44, look: 3, team: [[BY_NAME.Finlet, 7], [BY_NAME.Gulpfin, 7], [BY_NAME.Sparkit, 8]], reward: 480, pre: 'Dive in! My team loves a challenge.', win: 'You reeled me in!' },
  ];
  const NPCS = [
    { id: 'n_guide', name: 'Guide Pip', x: 76, y: 30, look: 4, lines: ['Welcome to Route 1! Tall grass is full of wild bitmonsters.', 'Walk through the tall grass and one may jump out. Weaken it, then throw an orb!', 'Heal your team for free at the Bitmon Center inside the town gate.'] },
    { id: 'n_kid', name: 'Kid Remy', x: 93, y: 33, look: 5, lines: ['I caught a Sparkit yesterday! It zapped my sandwich.', 'Trainers around here will battle you if you look at them. Eyes up!'] },
    { id: 'n_old', name: 'Old Wen', x: 112, y: 33, look: 6, lines: ['Eight gyms are said to lie beyond these fields...', 'Only trainers with enough badges may challenge the Champion. Keep training!'] },
  ];

  // ======================================================================
  // Open world: 8 routes + 8 gym towns laid out west -> east along "Champion Road".
  // Everything below is generated from a few numbers so client, server and admin all agree.
  // ======================================================================
  const WORLD_W = 412;
  const TOWN_X0 = k => 122 + (k - 1) * 38;                 // town k spans x0 .. x0+16
  const routeX0 = k => k === 1 ? 74 : TOWN_X0(k - 1) + 16;  // route k spans routeX0 .. (k === 1 ? 120 : TOWN_X0(k))
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ======================================================================
  // Organic, seeded terrain (identical on server, client, admin): winding roads, side trails,
  // blobby tall-grass meadows, ponds, rivers with bridges, shorelines and natural forest.
  // ======================================================================
  const WORLD_H = 66;
  const K = { GROUND: 0, PATH: 1, GRASS: 2, WATER: 3, PLAZA: 4, SAND: 5, BRIDGE: 6 };
  const D = { NONE: 0, TREE: 1, FLOWER: 2, SHRUB: 3, BLADE: 4, ROCK: 5, TUFT: 6 };
  const h2 = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const smooth = t => t * t * (3 - 2 * t);
  const vnoise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi); const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.1, y * 2.1, s + 11) * .3 + vnoise(x * 4.3, y * 4.3, s + 23) * .15;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const zoneDist = x => { let d = Math.abs(x - 74); for (let k = 1; k <= 8; k++) { const x0 = TOWN_X0(k); d = Math.min(d, x < x0 ? x0 - x : x > x0 + 16 ? x - x0 - 16 : 0); } return d; };
  const roadY = x => clamp(31.5 + smooth(Math.min(1, zoneDist(x) / 7)) * 36 * (fbm(x / 11, 3.7, 101) - .5), 11, 52);
  const routeOf = x => { for (let k = 1; k <= 8; k++) if (x >= routeX0(k) && x < TOWN_X0(k)) return k; return 0; };
  const SHRINE_ROUTE = k => k >= 4;

  function buildTerrain() {
    const W = WORLD_W, H = WORLD_H, N = W * H, I = (x, y) => y * W + x;
    const path = new Uint8Array(N), plaza = new Uint8Array(N), water = new Uint8Array(N), kind = new Uint8Array(N), route = new Uint8Array(N), tone = new Uint8Array(N), dec = new Uint8Array(N);
    const stamp = (m, cx, cy, r) => { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) { const dx = x + .5 - cx, dy = y + .5 - cy; if (dx * dx + dy * dy <= r * r) m[I(x, y)] = 1; } };
    // main road
    for (let x = 74; x <= W - 5; x += .5) stamp(path, x, roadY(x), 1.15 + vnoise(x / 6, 0, 55) * .55);
    // side trails (jittered polylines) with a small clearing at the end
    const trails = {};
    const trail = (key, bx, ex, ey, seed, clearR, stone) => {
      const by = roadY(bx), len = Math.hypot(ex - bx, ey - by), n = Math.ceil(len * 1.6), pts = [];
      const nx = -(ey - by) / len, ny = (ex - bx) / len, amp = Math.min(6, len * .22);
      for (let i = 0; i <= n; i++) {
        const t = i / n, wob = (fbm(t * 3.1 + seed * 5, seed, 77) - .5) * 2.4 * amp * Math.sin(Math.PI * t) * 1.5;
        const x = bx + (ex - bx) * t + nx * wob, y = by + (ey - by) * t + ny * wob;
        stamp(path, x, y, .95 + vnoise(t * 9, seed, 9) * .35); pts.push([x, y]);
      }
      stamp(stone ? plaza : path, ex, ey, clearR);
      trails[key] = pts;
    };
    trail('1n1', 84, 80, 14, 1, 2.2); trail('1n2', 104, 112, 13, 2, 2.2); trail('1s1', 90, 86, 52, 3, 2.2); trail('1s2', 108, 104, 54, 4, 2.2);
    for (let k = 2; k <= 8; k++) {
      const rs = routeX0(k);
      if (SHRINE_ROUTE(k)) trail(k + 'n', rs + 8, rs + 11, 6.2, k, 3.4, true); else trail(k + 'n', rs + 8, rs + 9 + k % 3, 12 + k, k, 2.2);
      trail(k + 's', rs + 14, rs + 8 + k % 4, 51 + k % 3, k + 20, 2.2);
    }
    // town plazas: organic blobs that always cover the buildings
    for (let k = 1; k <= 8; k++) {
      const x0 = TOWN_X0(k), cx = x0 + 8, cy = 31;
      for (let y = 14; y < 48; y++) for (let x = x0 - 4; x < x0 + 20; x++) {
        const dx = (x + .5 - cx) / 10.8, dy = (y + .5 - cy) / 9.4, f = dx * dx + dy * dy + (fbm(x / 3, y / 3, 500 + k) - .5) * 1.1;
        const inB = (x >= x0 && x <= x0 + 7 && y >= 23 && y <= 30) || (x >= x0 + 7 && x <= x0 + 16 && y >= 22 && y <= 30);
        if (f < 1 || inB) plaza[I(x, y)] = 1;
      }
    }
    // water: rivers on routes 1-3, ponds everywhere
    const nearPath = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < W && b < H && (path[I(a, b)] || plaza[I(a, b)])) return true; } return false; };
    const rivers = [[1, 100], [2, routeX0(2) + 11], [3, routeX0(3) + 11]];
    for (const [k, cx] of rivers) for (let y = 0; y < H; y++) {
      const xr = cx + Math.sin(y * .13 + k * 1.7) * 3.2 + (fbm(y / 6, k, 400) - .5) * 7, w = 1.3 + vnoise(y / 5, k, 401) * 1.1;
      for (let x = Math.floor(xr - w - 1); x <= Math.ceil(xr + w + 1); x++) if (x >= 74 && x < W && Math.abs(x + .5 - xr) < w && zoneDist(x) > 3 && !plaza[I(x, y)]) water[I(x, y)] = 1;
    }
    for (let y = 5; y < H - 5; y++) for (let x = 74; x < W - 6; x++) {
      const k = routeOf(x); if (!k || zoneDist(x) < 4 || plaza[I(x, y)]) continue;
      if (fbm(x / 6.5, y / 6.5, 300 + k) > .685 && Math.abs(y + .5 - roadY(x)) > 4.5 && !nearPath(x, y, 2)) water[I(x, y)] = 1;
    }
    // classify
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = I(x, y); let c = K.GROUND;
      if (x >= 74) {
        const k = routeOf(x);
        if (plaza[i]) c = K.PLAZA;
        else if (path[i]) c = water[i] ? K.BRIDGE : K.PATH;
        else if (water[i]) c = K.WATER;
        else if (k && y >= 5 && y < H - 5 && zoneDist(x) >= 3 && x < W - 6) {
          const d = Math.abs(y + .5 - roadY(x)), v = fbm(x / 5.2, y / 5.2, 200 + k) + (d < 10 ? .05 : 0) - (d > 21 ? .09 : 0);
          if (v > .565 && d > 2.2) { c = K.GRASS; route[i] = k; }
        }
      }
      kind[i] = c;
    }
    for (let y = 0; y < H; y++) for (let x = 74; x < W; x++) {
      const i = I(x, y); if (kind[i] !== K.GROUND && kind[i] !== K.GRASS) continue;
      if ((x > 0 && kind[i - 1] === K.WATER) || (x < W - 1 && kind[i + 1] === K.WATER) || (y > 0 && kind[i - W] === K.WATER) || (y < H - 1 && kind[i + W] === K.WATER)) { kind[i] = K.SAND; route[i] = 0; }
    }
    // tone (soft colour variation) + decor
    const open = (x, y) => { const c = kind[I(clamp(x, 0, W - 1), clamp(y, 0, H - 1))]; return c === K.PATH || c === K.PLAZA || c === K.BRIDGE; };
    for (let y = 0; y < H; y++) for (let x = 74; x < W; x++) {
      const i = I(x, y), c = kind[i];
      tone[i] = clamp(Math.floor((fbm(x / 3.3, y / 3.3, 600) - .36) / .075), 0, 3);
      if (c === K.PATH || c === K.PLAZA) { if (!open(x - 1, y) || !open(x + 1, y) || !open(x, y - 1) || !open(x, y + 1)) tone[i] = 0; }
      if (c === K.WATER || c === K.PATH || c === K.PLAZA || c === K.BRIDGE) continue;
      const edgeD = Math.min(y, H - 1 - y, W - 1 - x), margin = edgeD < 2, forest = clamp(1 - (edgeD - 2) / 11, 0, 1);
      const nz = fbm(x / 6, y / 6, 700), r1 = h2(x, y, 800), r2 = h2(x, y, 801);
      let nearOpen = false; for (let dy = -1; dy <= 1 && !nearOpen; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) { nearOpen = true; break; }
      const inTown = (() => { const k = Math.floor((x - 122 + 38) / 38) + 0; for (let t = 1; t <= 8; t++) { const x0 = TOWN_X0(t); if (x >= x0 - 2 && x <= x0 + 18) return true; } return false; })();
      if (c === K.GRASS) { if (r1 < .16) dec[i] = D.BLADE; continue; }
      if (c === K.SAND) { if (r1 < .06) dec[i] = D.TUFT; continue; }
      let tp = margin ? .72 : (.012 + forest * (nz > .5 ? .12 + (nz - .5) * 1.4 : .03) + (nz > .64 ? .2 : 0)) * (inTown ? .35 : 1);
      if (nearOpen && !margin) tp = 0;
      if (r1 < tp) dec[i] = D.TREE;
      else if (fbm(x / 4, y / 4, 702) > .6 && r2 < .3) dec[i] = D.FLOWER;
      else if (r2 > (forest > .4 ? .9 : .965)) dec[i] = D.SHRUB;
      else if (r2 < .012 + (routeOf(x) >= 5 ? .02 : 0)) dec[i] = D.ROCK;
      else if (r2 > .5 && r2 < .56) dec[i] = D.TUFT;
    }
    return { W, H, kind, route, tone, dec, trails };
  }
  const TERRAIN = buildTerrain();
  const trailAt = (key, t) => { const a = TERRAIN.trails[key], p = a[Math.min(a.length - 1, Math.floor(t * (a.length - 1)))]; return { x: Math.round(p[0]) + .5, y: Math.round(p[1]) + .5 }; };
  const isGrassTile = (x, y) => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && TERRAIN.kind[y * WORLD_W + x] === K.GRASS;
  const grassRouteAt = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if (isGrassTile(a, b)) return TERRAIN.route[b * WORLD_W + a]; } return 0; };
  // relocate the hand-placed route 1 folk onto the generated paths
  { const mv = (id, x, y) => { const o = NPCS.concat(TRAINERS).find(a => a.id === id); if (o) { o.x = x; o.y = y; } };
    mv('n_guide', 76.5, Math.floor(roadY(76.5) - 2.2) + .5); mv('n_kid', 93.5, Math.floor(roadY(93.5) + 2.3) + .5); mv('n_old', 112.5, Math.floor(roadY(112.5) - 2.3) + .5);
    const a = trailAt('1n1', .62), b = trailAt('1n2', .62), c = trailAt('1s1', .62), d = trailAt('1s2', .62);
    mv('t_tim', a.x, a.y); mv('t_ana', b.x, b.y); mv('t_bo', c.x, c.y); mv('t_mia', d.x, d.y); }
  const normal = SPECIES.slice(1).filter(x => !x.legend && !x.rare && !x.starter).sort((a, b) => a.bst - b.bst || a.id - b.id);
  const LV = k => k === 1 ? [3, 8] : [6 * k - 4, 6 * k + 2];
  const ROUTE_NAMES = ['Sunny Fields', 'Dewdrop Trail', 'Mosswater Run', 'Stormcloud Pass', 'Emberdust Road', 'Boulder Ridge', 'Mistveil Moor', 'Skyreach Way'];
  for (let k = 2; k <= 8; k++) {
    const start = Math.round((k - 1) * (normal.length - 16) / 7), win = normal.slice(start, start + 16);
    const pool = win.map(sp => [sp.id, Math.max(2, Math.round(sp.catch / 12))]);
    if (k >= 6) pool.push([BY_NAME.Dracolet, 1]);
    const rs = routeX0(k);
    ROUTES['r' + k] = {
      id: 'r' + k, name: 'Route ' + k + ' · ' + ROUTE_NAMES[k - 1], levels: LV(k), pool,
    };
  }
  ROUTES.r1.name = 'Route 1 · ' + ROUTE_NAMES[0];
  // route trainers
  const T_FIRST = ['Ace', 'Scout', 'Hiker', 'Angler', 'Ranger', 'Camper', 'Picnicker', 'Biker', 'Sailor', 'Tamer', 'Mystic', 'Cadet'];
  const T_NAME = ['Dax', 'Lena', 'Omar', 'Pia', 'Rex', 'Tilly', 'Hugo', 'Nell', 'Finn', 'Gigi', 'Kai', 'Mara', 'Otto', 'Zoe', 'Bram', 'Cleo', 'Dov', 'Esme', 'Flint', 'Hana', 'Ivo', 'Jade', 'Knox', 'Lark'];
  const T_PRE = ['Eyes met, so we battle!', 'My team is ready for you!', 'Let me test your skills!', "I won't hold back!", 'Trainers must battle when they meet!', 'Show me what you have!'];
  const T_WIN = ['Great battle!', 'You beat me fair and square.', 'I need more training...', 'Wow, you are strong!', 'We will get you next time!'];
  const rngT = mulberry(7);
  for (let k = 2; k <= 8; k++) {
    const rs = routeX0(k), R = ROUTES['r' + k], [lo, hi] = R.levels;
    [[rs + 4.5, Math.floor(roadY(rs + 4.5)) + .5], [rs + 16.5, Math.floor(roadY(rs + 16.5)) + .5], (({ x, y }) => [x, y])(trailAt(k + 'n', .55))].forEach(([x, y], i) => {
      const n = 2 + (i === 2 ? 1 : 0) + (k >= 5 && i === 0 ? 1 : 0), team = [];
      for (let m = 0; m < n; m++) { const pick = R.pool[Math.floor(rngT() * R.pool.length)][0]; team.push([pick, Math.min(hi, lo + 1 + Math.floor(rngT() * (hi - lo)) + (m === n - 1 ? 1 : 0))]); }
      const avg = team.reduce((a, b) => a + b[1], 0) / n;
      TRAINERS.push({ id: 't_r' + k + '_' + i, name: T_FIRST[(k * 3 + i) % T_FIRST.length] + ' ' + T_NAME[(k * 3 + i * 5) % T_NAME.length], x, y, look: (k + i) % 10, team, reward: Math.round(avg * n * 9), pre: T_PRE[(k + i) % T_PRE.length], win: T_WIN[(k * 2 + i) % T_WIN.length] });
    });
  }
  // ---------- gyms & towns ----------
  const GYM_DEFS = [
    { type: 'Leaf', gym: 'Mossgate Gym', town: 'Greenhollow', leader: 'Leader Fern', look: 1, badge: 'Sprout Badge', col: '#6abe30', pre: 'Welcome to Mossgate! My leafy team grows stronger every day.', win: 'You have a green thumb for battle. Take the Sprout Badge!' },
    { type: 'Aqua', gym: 'Tidepool Gym', town: 'Marinport', leader: 'Leader Marin', look: 3, badge: 'Ripple Badge', col: '#339af0', pre: 'The tide is rising! Can you keep your head above water?', win: 'A wave of skill! The Ripple Badge is yours.' },
    { type: 'Volt', gym: 'Sparkforge Gym', town: 'Voltvale', leader: 'Leader Ziggy', look: 5, badge: 'Spark Badge', col: '#fcc419', pre: 'Zzzap! My team runs on pure energy!', win: 'Shocking! You earned the Spark Badge.' },
    { type: 'Flame', gym: 'Emberhall Gym', town: 'Cinderfall', leader: 'Leader Cinda', look: 7, badge: 'Blaze Badge', col: '#f76707', pre: 'Feel the heat! Only the bold survive Emberhall.', win: 'You burn brighter than most. Take the Blaze Badge!' },
    { type: 'Stone', gym: 'Bedrock Gym', town: 'Granite Gap', leader: 'Leader Rocco', look: 8, badge: 'Boulder Badge', col: '#a1887f', pre: 'Nothing moves a mountain. Try anyway!', win: 'You cracked my defense! The Boulder Badge is yours.' },
    { type: 'Toxic', gym: 'Gloomspore Gym', town: 'Mirewood', leader: 'Leader Vesper', look: 9, badge: 'Venom Badge', col: '#ae3ec9', pre: 'Careful where you step in my gym... it bites.', win: 'Immune to my tricks? Impressive. Venom Badge, yours.' },
    { type: 'Frost', gym: 'Glacier Gym', town: 'Frostpeak', leader: 'Leader Hailey', look: 4, badge: 'Crystal Badge', col: '#74c0fc', pre: 'Cool down, trainer. My team never loses its chill.', win: 'You melted my ice! Take the Crystal Badge.' },
    { type: 'Mind', gym: 'Summit Gym', town: 'Zenith City', leader: 'Leader Zenith', look: 6, badge: 'Summit Badge', col: '#da77f2', pre: 'I foresaw your arrival. Can you foresee my moves?', win: 'My vision failed me. You hold all eight badges now!' },
  ];
  const GYMS = [], TOWNS = [], CENTERS = [{ x: 66, y: 25, w: 5, h: 4, name: 'Sunny Lots Bitmon Center' }];
  GYM_DEFS.forEach((d, i) => {
    const k = i + 1, x0 = TOWN_X0(k), cand = normal.filter(sp => sp.types.includes(d.type));
    const n = [3, 3, 4, 4, 5, 5, 6, 6][i], f = .12 + i * .1, team = [], used = new Set();
    const lvTop = 6 * k + 8;
    for (let m = 0; m < n; m++) {
      let idx = Math.max(0, Math.min(cand.length - 1, Math.round((f + (m - (n - 1) / 2) * .09 + (m === n - 1 ? .25 : 0)) * (cand.length - 1))));
      while (used.has(idx) && idx < cand.length - 1) idx++;
      while (used.has(idx) && idx > 0) idx--;
      used.add(idx);
      team.push([cand[idx].id, lvTop - (n - 1 - m) * (k < 4 ? 2 : 1) - (m === n - 1 ? 0 : 0)]);
    }
    if (team.length < n) while (team.length < n) { const sp = normal[Math.min(normal.length - 1, 20 + i * 12 + team.length)]; team.push([sp.id, lvTop - 2]); }
    const gym = { id: 'g' + k, n: k, type: d.type, name: d.gym, town: d.town, leader: d.leader, look: d.look, badge: d.badge, col: d.col, team, reward: 1000 + k * 600, pre: d.pre, win: d.win,
      x: x0 + 8, y: 23, w: 7, h: 5, lx: x0 + 11.5, ly: 29.5, minLv: 6 * k + 2 };
    GYMS.push(gym);
    const center = { x: x0 + 1, y: 24, w: 5, h: 4, name: d.town + ' Bitmon Center' };
    CENTERS.push(center);
    TOWNS.push({ k, name: d.town, x0, w: 16, y0: 18, y1: 46, center, gym: gym.id });
  });
  GYMS.forEach(g => TRAINERS.push({ id: g.id, name: g.leader, x: g.lx, y: g.ly, look: g.look, team: g.team, reward: g.reward, pre: g.pre, win: g.win, gym: g.id, badge: g.badge, hidden: true }));
  // talkers
  const TALK = [
    ['Greenhollow is famous for leaf-type monsters. Fern beats rookies... so bring fire!', 'Grass monsters fear Flame, Frost and Gale moves.'],
    ['Marinport has the best harbour! Aqua monsters love it. Volt moves shock them nicely.', 'Leaf moves are also strong against water.'],
    ['Voltvale hums day and night. Volt moves hit Aqua and Gale hard, but Stone shrugs them off.', 'Stone-type monsters are immune to Volt moves.'],
    ['Cinderfall is hot! Flame loves Leaf and Frost targets. Bring Aqua or Stone to cool it off.', 'Burns halve a monster\'s physical damage.'],
    ['Granite Gap is solid rock. Aqua, Leaf and Brawl moves crack it.', 'Stone monsters are slow but very tough.'],
    ['Mirewood is thick with spores. Toxic monsters hate Mind and Stone moves.', 'A poisoned monster loses HP every turn. Carry a Cure!'],
    ['Frostpeak is freezing! Frost monsters melt to Flame, Brawl and Stone moves.', 'Stock up on potions before the big climb.'],
    ['Zenith City stands at the top of the road. The Summit Gym needs seven badges before it opens...', 'Rumour has it a legendary mind-monster waits for the one with all eight badges.'],
  ];
  const ROUTE_TALK = [
    null,
    ['Route 2 is full of little water-lovers. Orbs work best on weakened monsters!', 'Status moves like Lullaby help catching: sleeping monsters are easier to catch.'],
    ['Route 3 gets stormy. Bring Revives, trainers here have strong teams.', 'You can swap your lead monster in the Bitmon menu.'],
    ['Strange lights glow at the end of this road... a shrine, they say.', 'Only trainers with three badges can wake what sleeps there.'],
    ['The shrine on Route 5 hums with water energy.', 'Great Orbs and Ultra Orbs are sold at the Mart. Master Orbs never are.'],
    ['Route 6 is rough. Stone and Brawl types roam here.', 'Another shrine hides at the far end of this road.'],
    ['Mist hides everything on Route 7... except the thunder shrine to the north.', 'The Champion Road is almost over. Keep going!'],
    ['This is the last stretch. Zenith City is just ahead.', 'You made it this far? You are a true trainer.'],
  ];
  TOWNS.forEach((t, i) => { NPCS.push({ id: 'n_town' + t.k, name: 'Resident ' + t.name.split(' ')[0], x: t.x0 + 6, y: 34, look: (i * 3 + 2) % 10, lines: TALK[i] }); });
  for (let k = 2; k <= 8; k++) NPCS.push({ id: 'n_rt' + k, name: 'Wanderer ' + ['Ivy', 'Rowan', 'Sage', 'Ash', 'Clay', 'Haze', 'Wren'][k - 2], x: routeX0(k) + 7.5, y: Math.floor(roadY(routeX0(k) + 7.5) + 2.3) + .5, look: (k * 2 + 1) % 10, lines: ROUTE_TALK[k - 1] });
  // legendary shrines (dead-end roads at the far north of routes 4-8)
  const LEGENDS = [
    { sp: BY_NAME.Solarex, route: 4, badges: 3, lv: 35 }, { sp: BY_NAME.Aquarion, route: 5, badges: 4, lv: 40 },
    { sp: BY_NAME.Terraknox, route: 6, badges: 5, lv: 45 }, { sp: BY_NAME.Voltarch, route: 7, badges: 6, lv: 50 }, { sp: BY_NAME.Omnimind, route: 8, badges: 8, lv: 60 },
  ].map(L => Object.assign(L, { x: routeX0(L.route) + 11, y: 4 }));
  const API = { TYPES, TYPE_COL, CHART, typeMult, MOVES, MOVE_LIST, SPECIES, BY_NAME, COUNT, STATS, movesAt, calcStats, NATURES, xpFor, MAX_LV, baseExp, ORBS, orbMult, POTIONS, SHOP, DAILY, ROUTES, TRAINERS, NPCS, FAMILIES, WORLD_W, TOWNS, GYMS, CENTERS, LEGENDS, routeX0, TOWN_X0, TERRAIN, K, D, roadY, grassRouteAt, isGrassTile };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Mon = API;
})(typeof window !== 'undefined' ? window : globalThis);
