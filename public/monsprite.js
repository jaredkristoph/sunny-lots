'use strict';
// Bitmonster sprites: 32x32 pixel art generated per species (evolution lines share a palette + body plan), plus hand-drawn starters.
(function () {
  const N = 32;
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
  const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const light = (c, t) => mix(c, '#ffffff', t), dark = (c, t) => mix(c, '#101018', t);
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function canvasOf() {
    const g = Array.from({ length: N }, () => Array(N).fill(null));
    const api = {
      g,
      px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = c; },
      ell(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.02) api.px(x, y, c); },
      rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) api.px(x + i, y + j, c); },
      line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) api.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); },
    };
    return api;
  }

  // ---- body plans (face left). Each returns anchors for features + eye spots ----
  const BUILD = {
    quad(m, P, sc) {
      m.rect(10, 22, 3, 6, P.dark); m.rect(21, 22, 3, 6, P.dark); m.rect(14, 23, 3, 5, P.main); m.rect(18, 23, 3, 5, P.main);
      m.ell(17, 19, 8.5 * sc, 5.5 * sc, P.main); m.ell(16, 21, 5.5 * sc, 3 * sc, P.belly);
      m.ell(8, 15, 5.2 * sc, 4.7 * sc, P.main); m.ell(5.5, 17, 2.8, 2.2, P.belly);
      m.px(6, 9, P.dark); m.px(7, 10, P.main); m.px(12, 9, P.dark); m.px(11, 10, P.main); m.rect(6, 10, 2, 2, P.main); m.rect(11, 10, 2, 2, P.main);
      m.ell(26, 17, 3, 1.8, P.main); m.px(29, 16, P.light);
      return { head: [9, 9], back: [18, 13], tail: [27, 15], eyes: [[7, 14]], body: [17, 19] };
    },
    biped(m, P, sc) {
      m.rect(11, 25, 4, 4, P.dark); m.rect(17, 25, 4, 4, P.dark);
      m.ell(16, 19, 6.2 * sc, 7 * sc, P.main); m.ell(16, 21, 3.8 * sc, 4.5 * sc, P.belly);
      m.ell(8.5, 18, 2.2, 5, P.main); m.ell(23.5, 18, 2.2, 5, P.main); m.ell(8.5, 23, 2.2, 2, P.dark); m.ell(23.5, 23, 2.2, 2, P.dark);
      m.ell(16, 8, 5.3 * sc, 5 * sc, P.main); m.rect(12, 3, 2, 2, P.dark); m.rect(18, 3, 2, 2, P.dark);
      return { head: [16, 3], back: [16, 14], tail: [23, 24], eyes: [[13.5, 8], [18.5, 8]], body: [16, 19] };
    },
    bird(m, P, sc) {
      m.rect(14, 24, 2, 5, P.accent); m.rect(19, 24, 2, 5, P.accent); m.rect(12, 28, 4, 1, P.accent); m.rect(17, 28, 4, 1, P.accent);
      m.rect(22, 16, 7, 3, P.dark); m.rect(23, 19, 5, 2, P.main);
      m.ell(16, 19, 7.2 * sc, 6 * sc, P.main); m.ell(14, 21, 4.5 * sc, 3.5 * sc, P.belly);
      m.ell(17, 17, 5, 3, P.dark);
      m.ell(9, 12, 4.4 * sc, 4.2 * sc, P.main); m.rect(3, 12, 3, 2, P.beak); m.px(3, 13, P.dark);
      return { head: [9, 7], back: [17, 14], tail: [28, 17], eyes: [[8, 11]], body: [16, 19] };
    },
    fish(m, P, sc) {
      m.ell(15, 16, 10.5 * sc, 6.5 * sc, P.main); m.ell(14, 19, 7 * sc, 3.2 * sc, P.belly);
      for (let i = 0; i < 6; i++) m.rect(24 + i, 16 - i - 1, 1, 2 * i + 3, i % 2 ? P.dark : P.main);
      m.ell(15, 8, 3.5, 2.2, P.dark); m.ell(14, 24, 3, 1.6, P.dark); m.rect(5, 18, 3, 1, P.dark);
      return { head: [7, 11], back: [15, 9], tail: [28, 16], eyes: [[8, 14]], body: [15, 16] };
    },
    snake(m, P, sc) {
      const pts = []; for (let i = 0; i < 9; i++) pts.push([24 - i * 2.6, 21 + Math.sin(i * 0.9) * 4.5]);
      pts.forEach(([x, y], i) => { const r = (2.2 + (i < 4 ? i * .25 : 1) ) * sc; m.ell(x, y + 2, r, r * .95, i % 2 ? P.main : P.dark); m.ell(x, y + 2.7, r * .6, r * .5, P.belly); });
      m.ell(5, 14, 4.6 * sc, 3.6 * sc, P.main); m.rect(2, 16, 3, 1, P.dark); m.px(1, 16, P.accent);
      m.line(4, 17, 5, 19, P.dark);
      return { head: [6, 10], back: [14, 18], tail: [26, 22], eyes: [[5, 13]], body: [14, 20] };
    },
    blob(m, P, sc) {
      m.ell(16, 20, 11 * sc, 8 * sc, P.main); m.ell(16, 23, 8 * sc, 4 * sc, P.belly);
      m.rect(8, 27, 4, 2, P.dark); m.rect(20, 27, 4, 2, P.dark);
      m.px(9, 12, P.main); m.px(10, 11, P.main);
      return { head: [16, 12], back: [16, 12], tail: [27, 22], eyes: [[12, 18], [20, 18]], body: [16, 20] };
    },
    bug(m, P, sc) {
      for (const x of [11, 15, 19, 23]) { m.line(x, 22, x - 1, 28, P.dark); }
      m.ell(24, 19, 5.5 * sc, 4.8 * sc, P.main); m.ell(15.5, 18.5, 4.6, 4.2, P.main); m.ell(8, 17, 4.2, 4, P.main);
      m.ell(24, 20.5, 3.5 * sc, 2.5, P.belly);
      m.line(6, 13, 4, 8, P.dark); m.line(10, 13, 12, 8, P.dark); m.px(4, 7, P.accent); m.px(12, 7, P.accent);
      return { head: [8, 11], back: [18, 14], tail: [29, 19], eyes: [[6.5, 16], [9.5, 16]], body: [16, 19] };
    },
    ghost(m, P, sc) {
      m.ell(16, 13.5, 8.2 * sc, 8 * sc, P.main); m.rect(8 - (sc > 1 ? 1 : 0), 14, 16 + (sc > 1 ? 2 : 0), 10, P.main);
      for (let i = 0; i < 6; i++) m.rect(8 + i * 3, 24, 3, i % 2 ? 3 : 5, P.main);
      m.ell(5, 18, 2.2, 4, P.main); m.ell(27, 18, 2.2, 4, P.main); m.ell(16, 20, 4, 3, P.belly);
      return { head: [16, 6], back: [16, 8], tail: [28, 24], eyes: [[12.5, 13], [19.5, 13]], body: [16, 17] };
    },
    plant(m, P, sc) {
      m.rect(15, 15, 2, 11, P.dark); m.ell(16, 26, 7, 3, P.pot); m.ell(16, 25, 6, 1.5, light(P.pot, .25));
      m.ell(9.5, 20, 4.5, 2, P.leaf); m.ell(22.5, 19, 4.5, 2, P.leaf);
      const R = 5 * sc, k = 5 + Math.min(2, 0); for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; m.ell(16 + Math.cos(a) * R * .9, 10 + Math.sin(a) * R * .9, 3.3 * sc, 3.3 * sc, i % 2 ? P.main : P.light); }
      m.ell(16, 10, 3.6 * sc, 3.6 * sc, P.belly);
      return { head: [16, 4], back: [16, 12], tail: [24, 24], eyes: [[14.5, 10], [17.5, 10]], body: [16, 12] };
    },
    golem(m, P, sc) {
      m.rect(10, 25, 5, 4, P.dark); m.rect(17, 25, 5, 4, P.dark);
      m.rect(8, 12, 16, 14, P.main); m.rect(4, 13, 5, 9, P.dark); m.rect(23, 13, 5, 9, P.dark); m.rect(4, 22, 5, 3, P.main); m.rect(23, 22, 5, 3, P.main);
      m.rect(12, 4, 9, 8, P.main); m.rect(12, 4, 9, 2, P.light);
      m.rect(11, 17, 4, 3, P.dark); m.rect(18, 20, 4, 3, P.dark); m.px(14, 14, P.dark); m.px(20, 15, P.dark);
      return { head: [16, 4], back: [16, 12], tail: [26, 24], eyes: [[14, 8], [19, 8]], body: [16, 18] };
    },
    dragon(m, P, sc) {
      m.rect(12, 23, 3, 6, P.dark); m.rect(20, 23, 3, 6, P.dark);
      m.ell(17, 19, 8.5 * sc, 5.2 * sc, P.main); m.ell(16, 21, 5.5, 3, P.belly);
      m.ell(10, 13, 3.2, 6, P.main); m.ell(7, 8, 4.4 * sc, 3.2 * sc, P.main); m.rect(2, 9, 3, 2, P.main);
      m.px(8, 4, P.beak); m.px(10, 3, P.beak); m.px(9, 5, P.beak);
      for (let i = 0; i < 6; i++) m.ell(26 + i * .8, 18 + i * .6 - (i > 3 ? 1 : 0), 3 - i * .4, 1.7 - i * .15, P.main);
      for (let i = 0; i < 7; i++) m.line(14 + i, 14, 19 + i * 1.2, 5 + Math.abs(3 - i), P.accent);
      m.line(14, 14, 24, 14, P.dark);
      return { head: [8, 4], back: [17, 14], tail: [30, 20], eyes: [[7, 8]], body: [17, 19] };
    },
    mouse(m, P, sc) {
      m.rect(11, 26, 4, 3, P.dark); m.rect(18, 26, 4, 3, P.dark);
      m.ell(16, 21, 7.2 * sc, 6 * sc, P.main); m.ell(16, 23, 4.5 * sc, 3.5 * sc, P.belly);
      m.ell(16, 12.5, 5.6 * sc, 5.2 * sc, P.main);
      m.ell(10, 6, 3, 4.2, P.main); m.ell(22, 6, 3, 4.2, P.main); m.ell(10, 6.5, 1.5, 2.6, P.inner); m.ell(22, 6.5, 1.5, 2.6, P.inner);
      for (let i = 0; i < 8; i++) m.px(23 + i * .9, 22 - i * 1.1 + Math.sin(i) * 1.2, i % 3 ? P.dark : P.main);
      m.rect(23, 21, 6, 2, P.dark);
      return { head: [16, 6], back: [18, 15], tail: [29, 15], eyes: [[13.5, 12], [18.5, 12]], body: [16, 20] };
    },
  };

  // ---- type flavour: drawn at the build's anchors ----
  function feature(m, type, A, stage, second) {
    const k = second ? .7 : 1, [hx, hy] = A.head, [bx, by] = A.back, [tx, ty] = A.tail;
    switch (type) {
      case 'Flame': for (let i = 0; i < 3; i++) m.ell(tx, ty - i * 2 - 1, 3 * k - i * .6, 2.4 - i * .4, ['#e8590c', '#ffa94d', '#fff3bf'][i]); break;
      case 'Aqua': m.ell(bx, by - 1, 3 * k, 2, '#74c0fc'); m.ell(hx, hy, 2.2 * k, 1.8, '#a5d8ff'); m.px(tx, ty, '#a5d8ff'); break;
      case 'Leaf': m.ell(hx - 2, hy - 1, 3 * k, 1.6, '#51cf66'); m.ell(hx + 2, hy - 2, 3 * k, 1.6, '#2f9e44'); m.line(hx, hy + 1, hx, hy - 1, '#2b8a3e'); break;
      case 'Volt': { const z = [[0, 0], [2, -2], [0, -3], [3, -5], [1, -6]]; z.forEach(([dx, dy], i) => { if (i) m.line(tx + z[i - 1][0] * k, ty + z[i - 1][1] * k, tx + dx * k, ty + dy * k, '#ffe066'); }); m.px(hx, hy - 1, '#ffe066'); break; }
      case 'Frost': for (let i = -1; i <= 1; i++) m.line(bx + i * 3, by + 1, bx + i * 3, by - 3 - (i === 0 ? 2 : 0), '#e3fafc'); m.px(hx, hy - 1, '#e3fafc'); break;
      case 'Stone': m.rect(bx - 2, by, 4, 2, '#9a8f7a'); m.rect(bx + 1, by + 2, 2, 2, '#7d735f'); m.px(hx, hy, '#9a8f7a'); break;
      case 'Gale': m.ell(bx, by + 1, 4 * k, 1.8, '#e5dbff'); m.ell(bx + 2, by + 3, 4 * k, 1.4, '#b197fc'); break;
      case 'Shade': m.ell(hx, hy - 1, 2 * k, 2.6, '#7048e8'); m.px(hx, hy - 4, '#b197fc'); m.ell(tx, ty, 2, 1.4, '#7048e8'); break;
      case 'Mind': m.ell(hx, hy + 1, 1.5, 1.8, '#ff6b9d'); m.px(hx, hy, '#ffd6e7'); m.line(tx, ty, tx + 1, ty - 4, '#fcc2d7'); break;
      case 'Toxic': for (const [dx, dy] of [[-2, 2], [1, 3], [3, 0], [-4, 0]]) m.px(bx + dx, by + dy + 2, '#862e9c'); m.px(hx + 1, hy + 4, '#da77f2'); m.ell(tx, ty, 1.6, 1.3, '#862e9c'); break;
      case 'Brawl': m.rect(hx - 4, hy + 3, 9, 1, '#e03131'); m.px(hx + 5, hy + 4, '#e03131'); m.px(hx + 6, hy + 5, '#e03131'); m.rect(bx - 6, by + 7, 3, 2, '#e03131'); break;
      case 'Normal': m.ell(hx, hy + 1, 1.6, 1.4, '#fff3bf'); break;
    }
  }
  function extras(m, P, A, stage, build) {
    const [bx, by] = A.back;
    if (stage >= 1) for (let i = -2; i <= 2; i++) m.px(bx + i * 2, by - 2 + Math.abs(i) * .4, P.dark);
    if (stage >= 2) { const [hx, hy] = A.head; m.line(hx - 2, hy, hx - 3, hy - 4, P.accent); m.line(hx + 2, hy, hx + 3, hy - 4, P.accent); m.px(bx, by - 4, P.accent); }
  }

  // ---- hand-drawn starters (first stage) ----
  const ART = {
    Embrix: {
      pal: { o: '#2a1a1a', b: '#ee7b30', l: '#f9ae62', d: '#c25a1c', w: '#ffe3b0', k: '#1a1a1a', f: '#e8590c', y: '#ffd43b', t: '#fff3bf', e: '#ffffff' },
      rows: [
        '..........................',
        '.....oo.....oo............',
        '....obbo...obbo...........',
        '....obbbooobbbo......oo...',
        '....obbbbbbbbbo.....ofyo..',
        '...obbbbbbbbbbbo...ofyyfo.',
        '...obeekbbbbeekbo..oyttyo.',
        '...obekkbbbbekkbo...ofyfo.',
        '...obbbbbddbbbbbo...ofyo..',
        '....obbbbwwbbbbo....obo...',
        '.....obbbbbbbboooooobbo...',
        '....oobbbbbbbbbbbbbbbbo...',
        '...obllbbbbbbbbbbbbbbbbo..',
        '...obwwlbbbbbbbbbbbbddbo..',
        '...obwwwlbbbbbbbbbbbbbo...',
        '...obwwwwbbbbbbbbbbddbo...',
        '....obbbbooobbbbooobbo....',
        '....obdbo.obdbo..obdbo....',
        '....oddbo.oddbo..oddbo....',
        '.....ooo...ooo....ooo.....',
      ],
    },
    Mossling: {
      pal: { o: '#1d2a1a', b: '#6fbf5a', l: '#9be07a', d: '#478a3a', w: '#e8f5c8', k: '#1a1a1a', g: '#2f8f3a', e: '#ffffff', h: '#8a5a2b', p: '#ff8fb1' },
      rows: [
        '..........................',
        '..........oo....oo........',
        '.........ogggoogggo.......',
        '........oggggggggggo......',
        '.........ogggpggggo.......',
        '.........oggoooggo........',
        '......ooooobbbbbbboo......',
        '.....obbbbbbbbbbbbbbo.....',
        '....obbeekbbbbbbeekbbo....',
        '....obbekkbbbbbbekkbbo....',
        '....obbbbbbwwwwbbbbbbo....',
        '....obbbbbbbwwbbbbbbbo....',
        '.....obbbbbbbbbbbbbbo.....',
        '...ooobbbbbbbbbbbbbbooo...',
        '..obbbobbbbbbbbbbbbobbbo..',
        '..obllbobwwwwwwwwwbobllbo.',
        '..oddbo.obbbbbbbbo.obddo..',
        '...ooo..obdbo.obdbo.ooo...',
        '........oddbo.oddbo.......',
        '.........ooo...ooo........',
      ],
    },
    Ripplet: {
      pal: { o: '#14243a', b: '#4f8fe0', l: '#8cc0f5', d: '#2e62b0', w: '#e6f3ff', k: '#1a1a1a', c: '#a5d8ff', e: '#ffffff', n: '#1c3f7a' },
      rows: [
        '..........................',
        '..........oo..............',
        '.........occo.............',
        '.....oo..occo.....oo......',
        '....obbooobbo....obbo.....',
        '...obbbbbbbbbo..obbbbo....',
        '...obbbbbbbbbooobbbbbo....',
        '..obbeekbbbbbbbbbbbbbo....',
        '..obbekkbbbbbbbbbbbbbbo...',
        '..obbbbbbbbbbbbbbbbbbbo...',
        '..oobwwbbbbbbbbbbbbbbbbo..',
        '...obwwwlbbbbbbbbbbbbbbo..',
        '...obwwwwbbbbbbbbbbbbddo..',
        '....obwwwbbbbbbbbbbbbddo..',
        '....obbbbbbbbbbbbbbbbbo...',
        '....obbooobbbbbbooobbo....',
        '....obdbo.obbbbo.obdbo....',
        '....oddbo.oddddo.oddbo....',
        '.....ooo...oooo...ooo.....',
        '..........................',
      ],
    },
  };
  function drawArt(def) {
    const m = canvasOf(), rows = def.rows, H = rows.length, W = rows[0].length, ox = Math.floor((N - W) / 2), oy = N - H - 1;
    rows.forEach((r, y) => { for (let x = 0; x < W; x++) { const c = r[x]; if (c !== '.' && def.pal[c]) m.px(ox + x, oy + y, def.pal[c]); } });
    return m;
  }

  const cache = {};
  function render(spId, shiny) {
    const key = spId + (shiny ? 's' : '');
    if (cache[key]) return cache[key];
    const sp = Mon.SPECIES[spId], fam = Mon.FAMILIES[sp.fam];
    let hue = sp.hue + (shiny ? 140 : 0);
    const T1 = Mon.TYPE_COL[sp.types[0]], T2 = Mon.TYPE_COL[sp.types[1] || sp.types[0]];
    const sat = 52 + (hash(fam[5][0]) % 18);
    const P = {
      main: hsl(hue, sat, 58), light: hsl(hue, sat, 74), dark: hsl(hue, sat - 5, 38), belly: hsl(hue + 12, 45, 84),
      accent: hsl(hue + 150, 62, 55), beak: '#f5a623', pot: '#a0703c', leaf: hsl(120, 50, 45), inner: '#ffb3c6',
    };
    let m, A = { head: [16, 6], back: [16, 12], tail: [26, 18], eyes: [[13, 10], [19, 10]], body: [16, 18] }, art = ART[sp.name] && !shiny;
    if (art) { m = drawArt(ART[sp.name]); }
    else {
      m = canvasOf();
      const sc = sp.legend ? 1.12 : sp.stages === 1 ? 1 : [.82, .98, 1.14][Math.min(2, sp.stage + (sp.stages === 2 ? 1 : 0))];
      A = BUILD[sp.build](m, P, sc);
      extras(m, P, A, sp.stage + (sp.stages === 2 ? 0 : 0) + (sp.legend ? 2 : 0), sp.build);
      feature(m, sp.types[0], A, sp.stage); if (sp.types[1]) feature(m, sp.types[1], A, sp.stage, true);
      if (sp.legend) { const [hx, hy] = A.head; for (let i = 0; i < 5; i++) m.px(hx - 4 + i * 2, hy - 4 - (i % 2), '#ffe066'); }
    }
    const g = m.g;
    // light from the top-left, shade underneath
    const src = g.map(r => r.slice());
    if (!art) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = src[y][x]; if (!c) continue;
      if (!src[y - 1] || !src[y - 1][x]) g[y][x] = light(c, .22);
      else if (!src[y + 1] || !src[y + 1][x]) g[y][x] = dark(c, .2);
      else if (x > 0 && !src[y][x - 1]) g[y][x] = light(c, .1);
    }
    // outline
    const OUT = '#241a2a', filled = g.map(r => r.map(c => !!c));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!filled[y][x]) {
      if ((y > 0 && filled[y - 1][x]) || (y < N - 1 && filled[y + 1][x]) || (x > 0 && filled[y][x - 1]) || (x < N - 1 && filled[y][x + 1])) g[y][x] = OUT;
    }
    if (!art) { // eyes drawn last so they sit on top of everything
      const eyeCol = sp.types.includes('Shade') ? '#ffe066' : '#ffffff';
      for (const [ex, ey] of A.eyes) { const x = Math.round(ex), y = Math.round(ey); g[y][x] = eyeCol; g[y][x + 1] = eyeCol; g[y + 1][x] = '#16121c'; g[y + 1][x + 1] = '#16121c'; g[y][x] = eyeCol; }
    }
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const cx = cv.getContext('2d');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x]) { cx.fillStyle = g[y][x]; cx.fillRect(x, y, 1, 1); }
    cache[key] = cv; return cv;
  }
  const urls = {};
  const MonSprite = {
    canvas: (id, shiny) => render(id, shiny),
    url: (id, shiny) => { const k = id + (shiny ? 's' : ''); return urls[k] || (urls[k] = render(id, shiny).toDataURL()); },
    img(id, px, shiny, flip) { const i = document.createElement('img'); i.src = MonSprite.url(id, shiny); i.style.cssText = 'width:' + (px || 64) + 'px;height:' + (px || 64) + 'px;image-rendering:pixelated;' + (flip ? 'transform:scaleX(-1);' : ''); i.draggable = false; return i; },
  };
  window.MonSprite = MonSprite;
})();
