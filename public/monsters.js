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
  function calcStats(sp, lv, iv) {
    const o = {};
    for (const k of STATS) { const b = sp.base[k], i = (iv && iv[k]) || 0; o[k] = k === 'hp' ? Math.floor((2 * b + i) * lv / 100) + lv + 10 : Math.floor((2 * b + i) * lv / 100) + 5; }
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
      grass: [[78, 6, 12, 10], [98, 8, 14, 10], [78, 26, 14, 5], [78, 34, 14, 9], [98, 34, 16, 9], [78, 47, 15, 11], [102, 46, 14, 12]],     // x, y, w, h (tiles)
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
  const API = { TYPES, TYPE_COL, CHART, typeMult, MOVES, MOVE_LIST, SPECIES, BY_NAME, COUNT, STATS, movesAt, calcStats, xpFor, MAX_LV, baseExp, ORBS, orbMult, POTIONS, SHOP, DAILY, ROUTES, TRAINERS, NPCS, FAMILIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Mon = API;
})(typeof window !== 'undefined' ? window : globalThis);
