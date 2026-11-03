'use strict';
// Tiny voxel 3D engine on a 2D canvas (orthographic, rotatable, painter's algorithm).
// Everything in the game (characters, plants, furniture, hats, buildings) is built from boxes.
// Units: 1 = one map tile. Y is up. A box is {x,y,z,w,h,d,c,a}: x/z = centre, y = BASE, c = color, a = alpha.
const Vox = (() => {
  // ---------------- colors ----------------
  const parse = hex => {
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const toHex = (r, g, b) => '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  const darken = (hex, k) => { const [r, g, b] = parse(hex); return toHex(r * (1 - k), g * (1 - k), b * (1 - k)); };
  const lighten = (hex, k) => { const [r, g, b] = parse(hex); return toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k); };
  const faceCache = new Map();
  function face(hex, f) {
    const key = hex + (f * 40 | 0);
    let v = faceCache.get(key);
    if (!v) { const [r, g, b] = parse(hex); const cl = x => Math.max(0, Math.min(255, Math.round(x * f))); v = 'rgb(' + cl(r) + ',' + cl(g) + ',' + cl(b) + ')'; faceCache.set(key, v); }
    return v;
  }
  const LIGHT = [-.5, .8, .33];

  const mk = () => { const a = []; a.add = (x, y, z, w, h, d, c, al) => { a.push({ x, y, z, w, h, d, c, a: al }); return a; }; return a; };

  // ---------------- view / renderer ----------------
  // box corner bit order: x=1, y=2, z=4  (0 = negative side)
  const FACES = [
    { c: [2, 3, 7, 6], n: [0, 1, 0] }, { c: [3, 7, 5, 1], n: [1, 0, 0] }, { c: [6, 2, 0, 4], n: [-1, 0, 0] },
    { c: [7, 6, 4, 5], n: [0, 0, 1] }, { c: [2, 3, 1, 0], n: [0, 0, -1] },
  ];
  class View {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.ctx.imageSmoothingEnabled = false;
      this.yaw = .78; this.pitch = .88; this.ppt = 28; this.fx = 0; this.fz = 0; this.hcf = .55;
      this.groups = []; this.P = new Float64Array(16);
    }
    prep() {
      this.W = this.cv.width; this.H = this.cv.height;
      this.cyw = Math.cos(this.yaw); this.syw = Math.sin(this.yaw); this.cp = Math.cos(this.pitch); this.sp = Math.sin(this.pitch);
      this.hc = this.H * this.hcf; this.groups.length = 0;
    }
    toScreen(X, Y, Z) {
      const dx = X - this.fx, dz = Z - this.fz, rx = dx * this.cyw - dz * this.syw, rz = dx * this.syw + dz * this.cyw;
      return [this.W / 2 + rx * this.ppt, this.hc - (Y * this.cp + rz * this.sp) * this.ppt, rz * this.cp - Y * this.sp];
    }
    pick(sx, sy, Y) {
      Y = Y || 0;
      const rx = (sx - this.W / 2) / this.ppt, rz = ((this.hc - sy) / this.ppt - Y * this.cp) / this.sp;
      return { x: this.fx + rx * this.cyw + rz * this.syw, z: this.fz - rx * this.syw + rz * this.cyw };
    }
    clear(c) { this.ctx.fillStyle = c; this.ctx.fillRect(0, 0, this.W, this.H); }
    // flat rectangle on the ground (drawn immediately, always behind queued objects)
    quad(x0, z0, x1, z1, y, fill, edge) {
      const ctx = this.ctx, P = this.P;
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (let i = 0; i < 4; i++) {
        const X = i === 0 || i === 3 ? x0 : x1, Z = i < 2 ? z0 : z1;
        const dx = X - this.fx, dz = Z - this.fz, rx = dx * this.cyw - dz * this.syw, rz = dx * this.syw + dz * this.cyw;
        const sx = this.W / 2 + rx * this.ppt, sy = this.hc - (y * this.cp + rz * this.sp) * this.ppt;
        P[i * 2] = sx; P[i * 2 + 1] = sy;
        if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
      }
      if (mxx < 0 || mnx > this.W || mxy < 0 || mny > this.H) return;
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[2], P[3]); ctx.lineTo(P[4], P[5]); ctx.lineTo(P[6], P[7]); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // queue a model (array of boxes) at a world position, rotated psi about the Y axis
    add(boxes, ox, oy, oz, psi, r) {
      const dx0 = ox - this.fx, dz0 = oz - this.fz, rx0 = dx0 * this.cyw - dz0 * this.syw, rz0 = dx0 * this.syw + dz0 * this.cyw;
      const m = ((r || 1) + 1.2) * this.ppt, sx0 = this.W / 2 + rx0 * this.ppt, sy0 = this.hc - ((oy + .5) * this.cp + rz0 * this.sp) * this.ppt;
      if (sx0 < -m || sx0 > this.W + m || sy0 < -m * 1.6 || sy0 > this.H + m) return;
      const cs = Math.cos(psi || 0), sn = Math.sin(psi || 0), items = [];
      for (const b of boxes) {
        const lx = b.x, lz = b.z, ly = b.y + b.h / 2;
        const wx = ox + lx * cs + lz * sn, wz = oz - lx * sn + lz * cs, wy = oy + ly;
        const dx = wx - this.fx, dz = wz - this.fz, rz = dx * this.syw + dz * this.cyw;
        items.push({ b, cs, sn, ox, oy, oz, d: rz * this.cp - wy * this.sp });
      }
      items.sort((p, q) => q.d - p.d);
      this.groups.push({ d: rz0 * this.cp - oy * this.sp, items });
    }
    flush() {
      this.groups.sort((p, q) => q.d - p.d);
      for (const g of this.groups) for (const it of g.items) this.drawBox(it);
    }
    drawBox(it) {
      const b = it.b, ctx = this.ctx, P = this.P, cs = it.cs, sn = it.sn;
      const hx = b.w / 2, hy = b.h / 2, hz = b.d / 2, cyy = b.y + hy;
      for (let i = 0; i < 8; i++) {
        const lx = b.x + ((i & 1) ? hx : -hx), lz = b.z + ((i & 4) ? hz : -hz), ly = cyy + ((i & 2) ? hy : -hy);
        const wx = it.ox + lx * cs + lz * sn, wz = it.oz - lx * sn + lz * cs, wy = it.oy + ly;
        const dx = wx - this.fx, dz = wz - this.fz, rx = dx * this.cyw - dz * this.syw, rz = dx * this.syw + dz * this.cyw;
        P[i * 2] = Math.round(this.W / 2 + rx * this.ppt); P[i * 2 + 1] = Math.round(this.hc - (wy * this.cp + rz * this.sp) * this.ppt);
      }
      if (b.a !== undefined) ctx.globalAlpha = b.a;
      for (let f = 0; f < 5; f++) {
        const fc = FACES[f], n = fc.n;
        const nx = n[0] * cs + n[2] * sn, nz = -n[0] * sn + n[2] * cs;
        if (n[1] * this.sp - (nx * this.syw + nz * this.cyw) * this.cp <= 0) continue;
        const dl = LIGHT[0] * nx + LIGHT[1] * n[1] + LIGHT[2] * nz;
        const col = face(b.c, .62 + .48 * Math.max(0, dl));
        const c = fc.c;
        ctx.beginPath(); ctx.moveTo(P[c[0] * 2], P[c[0] * 2 + 1]); ctx.lineTo(P[c[1] * 2], P[c[1] * 2 + 1]); ctx.lineTo(P[c[2] * 2], P[c[2] * 2 + 1]); ctx.lineTo(P[c[3] * 2], P[c[3] * 2 + 1]); ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      }
      if (b.a !== undefined) ctx.globalAlpha = 1;
    }
  }

  function renderIcon(boxes, o) {
    const c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
    const v = new View(c); v.yaw = o.yaw === undefined ? .78 : o.yaw; v.ppt = o.ppt; v.hcf = o.hcf || .8; v.prep();
    v.add(boxes, 0, 0, 0, o.psi || 0, 4); v.flush();
    return c;
  }

  // ---------------- pattern decals (clothes) ----------------
  function decals(B, pat, x, y, z, w, h, d, acc) {
    const e = .014;
    if (pat === 'stripes') { for (let j = .02; j < h - .03; j += .08) B.add(x, y + j, z, w + e, .04, d + e, acc); }
    else if (pat === 'dots') { for (let j = .04, r = 0; j < h - .03; j += .09, r++) for (let i = -w / 2 + (r % 2 ? .11 : .05); i < w / 2 - .03; i += .1) { B.add(x + i, y + j, z + d / 2, .04, .04, e, acc); B.add(x + i, y + j, z - d / 2, .04, .04, e, acc); } }
    else if (pat === 'check') { for (let j = 0, r = 0; j < h - .03; j += .07, r++) for (let i = 0, c = 0; i < w - .03; i += .07, c++) if ((r + c) % 2) { B.add(x - w / 2 + i + .035, y + j, z + d / 2, .07, .07, e, acc); B.add(x - w / 2 + i + .035, y + j, z - d / 2, .07, .07, e, acc); } }
    else if (pat === 'stars') { for (let j = .06, r = 0; j < h - .04; j += .12, r++) for (let i = -w / 2 + (r % 2 ? .13 : .07); i < w / 2 - .04; i += .13) { B.add(x + i, y + j, z + d / 2, .07, .018, e, acc); B.add(x + i, y + j - .026, z + d / 2, .018, .07, e, acc); } }
    else if (pat === 'zigzag') { for (let j = .03, r = 0; j < h - .04; j += .08, r++) B.add(x + (r % 2 ? -w / 4 : w / 4), y + j, z, w / 2 + e, .035, d + e, acc); }
    else if (pat === 'heart') { B.add(x - .04, y + h / 2 + .03, z + d / 2, .06, .05, e, acc); B.add(x + .04, y + h / 2 + .03, z + d / 2, .06, .05, e, acc); B.add(x, y + h / 2 - .02, z + d / 2, .14, .05, e, acc); B.add(x, y + h / 2 - .07, z + d / 2, .05, .05, e, acc); }
    else if (pat === 'collar') { B.add(x - .07, y + h - .06, z + d / 2, .08, .06, e, acc); B.add(x + .07, y + h - .06, z + d / 2, .08, .06, e, acc); B.add(x, y + h - .1, z + d / 2, .06, .04, e, acc); B.add(x, y + h - .03, z - d / 2, w * .5, .03, e, acc); }
    else if (pat === 'vest') { B.add(x, y, z + d / 2, .035, h, e, acc); for (const j of [.08, .17, .26]) B.add(x + .07, y + j, z + d / 2, .035, .035, e, lighten(acc, .2)); }
  }

  // ---------------- hats ----------------
  function hat(B, h, y) {
    const a = h.c[0], b = h.c[1], d = darken(a, .3);
    switch (h.shape) {
      case 'cap': B.add(0, y - .04, 0, .35, .1, .35, a); B.add(0, y + .06, 0, .28, .04, .28, a); B.add(0, y - .04, .2, .3, .03, .16, b); B.add(0, y + .1, 0, .06, .05, .06, b); break;
      case 'beanie': B.add(0, y - .05, 0, .36, .12, .36, a); B.add(0, y + .07, 0, .3, .06, .3, a); B.add(0, y - .05, 0, .38, .045, .38, b); B.add(0, y + .13, 0, .1, .08, .1, b); break;
      case 'straw': B.add(0, y - .04, 0, .78, .03, .78, a); B.add(0, y - .01, 0, .36, .14, .36, a); B.add(0, y - .01, 0, .38, .04, .38, b); B.add(0, y + .13, 0, .3, .02, .3, lighten(a, .2)); break;
      case 'cowboy': B.add(0, y - .04, 0, .7, .03, .5, a); B.add(-.37, y - .01, 0, .1, .04, .5, a); B.add(.37, y - .01, 0, .1, .04, .5, a); B.add(0, y - .01, 0, .36, .18, .36, a); B.add(0, y - .01, 0, .38, .04, .38, b); B.add(0, y + .17, 0, .12, .03, .3, d); break;
      case 'chef': B.add(0, y - .02, 0, .34, .14, .34, '#fff'); B.add(0, y + .12, 0, .46, .14, .46, '#fff'); B.add(0, y + .26, 0, .34, .06, .34, '#ececec'); break;
      case 'tophat': B.add(0, y - .04, 0, .5, .03, .5, a); B.add(0, y - .01, 0, .32, .34, .32, a); B.add(0, y - .01, 0, .34, .06, .34, b); break;
      case 'party': [.36, .28, .2, .12, .06].forEach((w, i) => B.add(0, y - .02 + i * .1, 0, w, .1, w, i % 2 ? b : a)); B.add(0, y + .48, 0, .07, .07, .07, '#fff'); break;
      case 'wizard': B.add(0, y - .04, 0, .7, .03, .7, a); [.34, .28, .22, .16, .1, .06].forEach((w, i) => B.add(i > 2 ? (i - 2) * .02 : 0, y - .01 + i * .11, 0, w, .11, w, i % 2 ? lighten(a, .1) : a)); B.add(0, y + .04, 0, .36, .05, .36, b); B.add(.1, y + .2, .13, .05, .05, .02, b); B.add(-.05, y + .4, .05, .04, .04, .02, b); break;
      case 'crown': B.add(0, y - .02, 0, .36, .1, .36, a); [[-.15, -.15], [.15, -.15], [-.15, .15], [.15, .15], [0, 0]].forEach(([x, z], i) => { B.add(x, y + .08, z, .07, i === 4 ? .16 : .12, .07, a); B.add(x, y + .18 + (i === 4 ? .04 : 0), z, .05, .05, .05, b); }); break;
      case 'cat': B.add(0, y - .03, 0, .37, .05, .37, a); B.add(-.12, y + .02, 0, .1, .16, .08, a); B.add(.12, y + .02, 0, .1, .16, .08, a); B.add(-.12, y + .04, .03, .05, .1, .03, b); B.add(.12, y + .04, .03, .05, .1, .03, b); break;
      case 'flowers': [[-.15, .14], [-.05, .15], [.05, .15], [.15, .14], [-.17, -.02], [.17, -.02], [0, -.16]].forEach(([x, z], i) => B.add(x, y + (i % 2) * .02, z, .08, .08, .08, i % 2 ? a : b)); break;
      case 'helmet': B.add(0, y - .03, 0, .36, .14, .36, a); B.add(0, y - .03, 0, .38, .04, .38, b); B.add(0, y + .06, 0, .06, .1, .3, b); B.add(0, y - .03, .19, .3, .04, .1, d); break;
      case 'headband': B.add(0, y - .12, 0, .34, .05, .33, a); B.add(.1, y - .12, .17, .06, .06, .02, b); break;
    }
  }

  // ---------------- characters (front = +z) ----------------
  function charBoxes(av, cat, walk, moving) {
    const f = av.gender === 'female', C = cat.CLOTH;
    const top = C[av.top] || C.top_tee_white, bot = C[av.bottom] || C.bot_jeans, sh = C[av.shoes] || C.shoe_plain;
    const hh = av.hat ? C[av.hat] : null, skin = av.skin, hc = av.hairColor, B = mk();
    const sw = moving ? Math.sin(walk) * .1 : 0, tw = f ? .32 : .38;
    for (const s of [-1, 1]) {
      const z = s * sw, x = s * .085;
      B.add(x, .1, z, .14, .26, .14, bot.len === 'long' ? bot.c[0] : skin);
      if (bot.len === 'long' && bot.pat !== 'solid') decals(B, bot.pat, x, .1, z, .14, .26, .14, bot.c[1]);
      if (bot.len === 'short') { B.add(x, .2, z, .15, .16, .15, bot.c[0]); decals(B, bot.pat, x, .2, z, .15, .16, .15, bot.c[1]); }
      B.add(x, 0, z + .02, .16, .1, .21, sh.c[0]);
      if (sh.id !== 'shoe_plain') B.add(x, 0, z + .02, .17, .03, .22, sh.c[1]);
    }
    if (bot.len === 'skirt') { B.add(0, .2, 0, .42, .18, .28, bot.c[0]); decals(B, bot.pat, 0, .2, 0, .42, .18, .28, bot.c[1]); }
    else { B.add(0, .3, 0, .35, .08, .21, bot.c[0]); decals(B, bot.pat, 0, .3, 0, .35, .08, .21, bot.c[1]); }
    for (const s of [-1, 1]) {
      const x = s * (tw / 2 + .055), z = -s * sw;
      if (top.long) { B.add(x, .4, z, .1, .3, .1, top.c[0]); B.add(x, .34, z, .09, .07, .09, skin); }
      else { B.add(x, .56, z, .1, .14, .1, top.c[0]); B.add(x, .38, z, .09, .18, .09, skin); }
    }
    B.add(0, .36, 0, tw, .34, .2, top.c[0]); decals(B, top.pat, 0, .36, 0, tw, .34, .2, top.c[1]);
    B.add(0, .7, 0, .3, .3, .28, skin);
    B.add(-.075, .82, .145, .045, .055, .02, '#222'); B.add(.075, .82, .145, .045, .055, .02, '#222'); B.add(0, .75, .145, .08, .02, .02, '#a0452f');
    if (f) { B.add(-.11, .76, .145, .05, .03, .02, '#ff8fa3'); B.add(.11, .76, .145, .05, .03, .02, '#ff8fa3'); B.add(-.075, .87, .147, .065, .015, .02, '#222'); B.add(.075, .87, .147, .065, .015, .02, '#222'); }
    B.add(0, .96, 0, .33, .08, .31, hc); B.add(0, .9, .145, .33, .07, .04, hc); B.add(0, .72, -.14, .33, .26, .05, hc);
    B.add(-.16, .8, 0, .03, .16, .28, hc); B.add(.16, .8, 0, .03, .16, .28, hc);
    if (f) { B.add(0, .38, -.165, .35, .58, .06, hc); B.add(-.17, .5, -.02, .05, .4, .2, hc); B.add(.17, .5, -.02, .05, .4, .2, hc); }
    if (hh) hat(B, hh, 1.03);
    return B;
  }

  // ---------------- plants ----------------
  const K = {
    root(B, d, s, r) {
      [[-.1, -.04], [.1, .03], [0, .1], [-.02, -.1], [.03, 0]].forEach(([x, z], i) => B.add(x, .04, z, .07, .18 + .2 * s + (i % 2) * .04, .07, i % 2 ? darken(d.c2, .12) : d.c2));
      if (r) { if (d.v === 0) { B.add(0, 0, 0, .26, .2, .26, d.c1); B.add(0, .2, 0, .14, .04, .14, lighten(d.c1, .3)); } else { B.add(0, 0, 0, .24, .1, .24, d.c1); B.add(0, .1, 0, .14, .04, .14, darken(d.c1, .2)); } }
    },
    leafy(B, d, s, r) { for (let i = 0; i < 3; i++) { const w = (.3 + .45 * s) - i * .12; B.add(0, .02 + i * .09, 0, w, .09, w, i % 2 ? d.c2 : d.c1); } if (r) B.add(0, .3, 0, .14, .1, .14, lighten(d.c1, .35)); },
    bushfruit(B, d, s, r) {
      const g = .22 + .14 * s;
      [[-.18, 0, -.02], [.18, 0, .02], [0, 0, -.18], [0, 0, .18], [0, .14 * s + .08, 0]].forEach(([x, y, z], i) => B.add(x * s, y, z * s, g, g * .8, g, i % 2 ? d.c2 : darken(d.c2, .1)));
      if (r) [[-.28, .1, .05], [.27, .12, -.05], [0, .12, .28], [.05, .1, -.28], [-.1, .32, .05], [.12, .3, -.04], [-.22, .2, -.22], [.22, .2, .22]].forEach(([x, y, z]) => { const sz = d.v === 0 ? .12 : d.v === 1 ? .09 : .075; B.add(x, y, z, sz, sz, sz, d.c1); });
    },
    stalk(B, d, s, r) {
      const h = .2 + .8 * s; B.add(0, 0, 0, .09, h, .09, d.c2);
      for (let i = 0; i < 3; i++) B.add(i % 2 ? .14 : -.14, .15 + i * h * .28, 0, .22, .05, .08, i % 2 ? darken(d.c2, .1) : lighten(d.c2, .1));
      if (r) { B.add(.1, .36, .05, .12, .26, .12, d.c1); B.add(.1, .34, .05, .14, .05, .14, d.c2); B.add(-.1, .5, -.05, .12, .24, .12, d.c1); B.add(-.1, .48, -.05, .14, .05, .14, d.c2); B.add(0, h, 0, .04, .1, .04, '#d9b44a'); B.add(.05, h, 0, .04, .08, .04, '#d9b44a'); }
    },
    flower(B, d, s, r) {
      const h = .25 + .75 * s; B.add(0, 0, 0, .06, h, .06, '#3f9a3a'); B.add(.1, .2 * h + .05, 0, .16, .04, .07, '#4fae44'); B.add(-.1, .5 * h, 0, .16, .04, .07, '#4fae44');
      if (!r) { B.add(0, h, 0, .14, .12, .14, '#4fa83a'); return; }
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; B.add(Math.cos(a) * .17, h - .01, Math.sin(a) * .17, .11, .06, .11, d.c1); }
      if (d.v === 0) B.add(0, h, 0, .18, .07, .18, d.c2); else { B.add(0, h, 0, .14, .08, .14, '#ffe98a'); B.add(0, h + .02, 0, .5, .02, .5, '#aab8ff', .25); }
    },
    gourd(B, d, s, r) {
      [[-.28, .02, .1], [.28, .02, -.1], [0, .02, .3]].forEach(([x, y, z], i) => B.add(x, y, z, .24, .04, .16, i % 2 ? '#3f9a3a' : '#4fae44'));
      if (!r) { B.add(0, 0, 0, .16 * s + .1, .14 * s + .06, .16 * s + .1, d.c1); return; }
      if (d.v === 0) { B.add(0, 0, 0, .5, .34, .5, d.c1); [-.17, 0, .17].forEach(x => B.add(x, 0, 0, .04, .34, .52, darken(d.c1, .2))); B.add(0, .34, 0, .07, .12, .07, '#5a7d2a'); }
      else { B.add(0, 0, 0, .6, .3, .42, d.c1); [-.22, -.08, .08, .22].forEach(x => B.add(x, 0, 0, .05, .31, .43, darken(d.c1, .35))); B.add(-.15, .3, -.05, .14, .02, .08, d.c2); }
    },
    hang(B, d, s, r) {
      const th = .3 + .4 * s; B.add(0, 0, 0, .12, th, .12, '#7a5230'); const c = .2 * s + .12;
      [[-.15, 0, 0], [.15, 0, .04], [0, .08, -.12], [0, .12, .1], [0, .2 * s, 0]].forEach(([x, y, z], i) => B.add(x, th - .05 + y, z, c, c * .8, c, i % 2 ? '#4fae44' : '#3f9a3a'));
      if (!r) return;
      if (d.v === 0) [[-.24, .22], [.24, .24], [0, .3], [.3, -.18]].forEach(([x, z]) => { B.add(x, th - .4, z, .11, .26, .11, d.c1); B.add(x, th - .14, z, .13, .04, .13, '#2f9e44'); });
      else [[-.24, .2], [.24, .22], [0, .3], [.3, -.18]].forEach(([x, z]) => { B.add(x, th - .38, z, .18, .18, .18, d.c1); B.add(x - .11, th - .3, z, .05, .05, .05, '#3fae56'); B.add(x + .11, th - .3, z, .05, .05, .05, '#3fae56'); B.add(x, th - .18, z, .05, .05, .05, '#3fae56'); });
    },
    pine(B, d, s, r) {
      [[-.15, 0], [.15, 0], [0, -.15], [0, .15], [0, 0]].forEach(([x, z], i) => B.add(x, 0, z, .08, .2 + .25 * s, .08, i % 2 ? darken(d.c2, .12) : d.c2));
      if (!r) return;
      B.add(0, 0, 0, .34, .36, .34, d.c1);
      for (let j = 0; j < 4; j++) B.add(0, .06 + j * .08, 0, .355, .02, .355, '#8a5a14');
      [-.1, .1].forEach(x => { B.add(x, 0, 0, .025, .37, .355, '#8a5a14'); B.add(0, 0, x, .355, .37, .025, '#8a5a14'); });
      [[-.1, -.1], [.1, .1], [0, 0], [-.1, .1], [.1, -.1]].forEach(([x, z], i) => B.add(x, .36, z, .08, .22 + (i % 2) * .06, .08, i % 2 ? darken(d.c2, .1) : d.c2));
    },
    mush(B, d, s, r) {
      const w = .22 + .26 * s, h = .2 + .32 * s;
      B.add(0, 0, 0, .14, h, .14, d.c2); B.add(0, h, 0, w, .12, w, d.c1); B.add(0, h + .12, 0, w * .7, .06, w * .7, lighten(d.c1, .15));
      [[-.3, -.2], [.25, .1], [0, .3], [-.1, 0]].forEach(([x, z]) => B.add(x * w, h + .18, z * w, .05, .02, .05, '#fff'));
      if (r) { B.add(.34, 0, .28, .08, .1, .08, d.c2); B.add(.34, .1, .28, .2, .06, .2, lighten(d.c1, .1)); }
    },
    cactus(B, d, s, r) {
      const h = .3 + .55 * s; B.add(0, 0, 0, .22, h, .22, d.c1); B.add(0, 0, 0, .04, h + .01, .23, lighten(d.c1, .3));
      if (s > .6) { B.add(-.2, h * .4, 0, .18, .08, .1, d.c1); B.add(-.28, h * .4, 0, .08, .3, .1, d.c1); B.add(.2, h * .3, 0, .18, .08, .1, d.c1); B.add(.28, h * .3, 0, .08, .26, .1, d.c1); }
      if (r) { B.add(0, h, 0, .1, .1, .1, '#ffe066'); [[-.1, 0], [.1, 0], [0, -.1], [0, .1]].forEach(([x, z]) => B.add(x, h - .01, z, .1, .08, .1, d.c2)); }
    },
  };
  const plantCache = {};
  function plantStage(p) { return p < .12 ? 0 : p < .4 ? 1 : p < 1 ? 2 : 3; }
  function plantBoxes(sd, stage, gold) {
    const key = sd.id + stage + (gold && stage === 3 ? 'g' : ''); if (plantCache[key]) return plantCache[key];
    const B = mk(), c1 = gold && stage === 3 ? '#ffcf33' : sd.c1;
    if (stage === 0) { B.add(0, 0, 0, .34, .1, .34, '#6b4a2f'); B.add(0, .1, 0, .2, .05, .2, '#8a6240'); B.add(0, .15, 0, .08, .08, .08, sd.c1); }
    else if (stage === 1) { B.add(0, 0, 0, .05, .2, .05, sd.c2); B.add(-.07, .14, 0, .1, .05, .07, lighten(sd.c2, .2)); B.add(.07, .18, 0, .1, .05, .07, sd.c2); }
    else K[sd.kind](B, { c1, c2: sd.c2, v: sd.v }, stage === 3 ? 1 : .65, stage === 3);
    return (plantCache[key] = B);
  }
  function sparkles(t) {
    const B = mk();
    for (let k = 0; k < 4; k++) { const a = t * 2 + k * Math.PI / 2; B.add(Math.cos(a) * .36, .5 + .3 * Math.sin(t * 3 + k), Math.sin(a) * .36, .07, .07, .07, '#fff6b0'); }
    return B;
  }

  // ---------------- furniture (25 shapes x 4 palettes) ----------------
  const F = {
    stool(B, m, a, d) { [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]].forEach(([x, z]) => B.add(x, 0, z, .07, .32, .07, d)); B.add(0, .32, 0, .52, .1, .52, m); B.add(0, .42, 0, .38, .04, .38, a); },
    chair(B, m, a, d) { [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]].forEach(([x, z]) => B.add(x, 0, z, .06, .3, .06, d)); B.add(0, .3, 0, .46, .08, .46, a); B.add(0, .38, -.2, .46, .42, .07, m); B.add(0, .48, -.165, .32, .22, .02, a); },
    lamp(B, m, a, d) { B.add(0, 0, 0, .28, .05, .28, d); B.add(0, .05, 0, .05, .6, .05, m); B.add(0, .62, 0, .36, .24, .36, a); B.add(0, .86, 0, .24, .04, .24, lighten(a, .4)); B.add(0, .6, 0, .46, .28, .46, '#ffe9a0', .22); },
    rug(B, m, a, d) { B.add(0, 0, 0, .9, .03, .74, m); B.add(0, .03, 0, .62, .012, .46, a); B.add(0, .042, 0, .3, .01, .2, m); [-.4, -.28, -.16, -.04, .08, .2, .32].forEach(x => { B.add(x, 0, .4, .05, .025, .06, d); B.add(x, 0, -.4, .05, .025, .06, d); }); },
    mailbox(B, m, a, d) { B.add(0, 0, 0, .08, .5, .08, d); B.add(0, .5, 0, .4, .26, .5, m); B.add(0, .76, 0, .34, .05, .44, darken(m, .15)); B.add(0, .55, .26, .24, .03, .02, d); B.add(.23, .55, 0, .05, .3, .05, a); B.add(.28, .75, 0, .12, .07, .05, a); },
    barrel(B, m, a, d) { B.add(0, 0, 0, .5, .62, .5, m); B.add(0, .1, 0, .54, .06, .54, d); B.add(0, .44, 0, .54, .06, .54, d); B.add(0, .62, 0, .42, .02, .42, a); },
    plantpot(B, m, a, d) { B.add(0, 0, 0, .38, .28, .38, m); B.add(0, .28, 0, .46, .06, .46, a); B.add(0, .34, 0, .36, .02, .36, '#5a3b22'); [[-.1, .1, .0], [.1, .1, .05], [0, .22, -.08], [.05, .34, .08]].forEach(([x, y, z], i) => B.add(x, .34 + y, z, .16, .14, .16, i % 2 ? '#3f9a3a' : '#58b64a')); B.add(0, .72, 0, .09, .09, .09, a); },
    bench(B, m, a, d) { [[-.36, -.1], [.36, -.1], [-.36, .1], [.36, .1]].forEach(([x, z]) => B.add(x, 0, z, .07, .3, .07, d)); B.add(0, .3, 0, .86, .07, .32, m); B.add(0, .37, -.14, .86, .32, .05, a); },
    table(B, m, a, d) { [[-.36, -.24], [.36, -.24], [-.36, .24], [.36, .24]].forEach(([x, z]) => B.add(x, 0, z, .08, .5, .08, d)); B.add(0, .5, 0, .86, .07, .62, m); B.add(0, .57, 0, .5, .015, .64, a); },
    clock(B, m, a, d) { B.add(0, 0, 0, .34, .9, .24, m); B.add(0, .9, 0, .4, .06, .3, d); B.add(0, .62, .13, .24, .24, .02, a); B.add(0, .7, .145, .03, .1, .015, d); B.add(0, .2, .13, .18, .32, .02, d); },
    mirror(B, m, a, d) { B.add(-.2, 0, 0, .08, .08, .2, d); B.add(.2, 0, 0, .08, .08, .2, d); B.add(0, .08, 0, .5, .9, .1, m); B.add(0, .14, .06, .38, .78, .02, '#cfeaf5'); B.add(-.1, .4, .075, .04, .36, .01, '#fff'); },
    chest(B, m, a, d) { B.add(0, 0, 0, .72, .3, .48, m); B.add(0, .3, 0, .74, .2, .5, lighten(m, .12)); B.add(0, .3, 0, .78, .04, .52, a); B.add(0, .05, 0, .76, .04, .52, d); B.add(0, .22, .26, .1, .14, .04, '#ffd24d'); },
    bookshelf(B, m, a, d) {
      B.add(0, 0, 0, .74, 1, .3, m); const cols = [a, d, '#4c9be8', '#e8a23a', '#5fbf6a', '#d64f7a'];
      for (let r = 0; r < 3; r++) { B.add(0, .06 + r * .31, .06, .62, .26, .2, darken(m, .35)); let x = -.27; for (let i = 0; i < 5; i++) { const w = .06 + ((i * 7 + r * 3) % 3) * .015; B.add(x + w / 2, .07 + r * .31, .12, w, .2 - (i % 2) * .03, .16, cols[(i + r * 2) % 6]); x += w + .02; } }
    },
    desk(B, m, a, d) { B.add(-.26, 0, 0, .3, .5, .5, a); B.add(.36, 0, 0, .08, .5, .5, d); B.add(0, .5, 0, .86, .07, .52, m); B.add(.1, .57, 0, .3, .2, .04, d); B.add(.1, .6, .025, .26, .14, .02, '#7fd0ff'); B.add(.1, .57, .16, .28, .015, .1, '#e8e8e8'); B.add(-.26, .3, .26, .08, .04, .02, d); },
    grill(B, m, a, d) { [[-.2, -.15], [.2, -.15], [-.2, .15], [.2, .15]].forEach(([x, z]) => B.add(x, 0, z, .06, .3, .06, d)); B.add(0, .3, 0, .52, .2, .52, m); B.add(0, .5, 0, .46, .03, .46, '#2b2b2b'); B.add(-.1, .5, 0, .1, .04, .1, '#ff7a2a'); B.add(.1, .5, .1, .1, .04, .1, '#ffb02a'); B.add(0, .52, -.26, .52, .14, .06, a); B.add(.28, .56, 0, .1, .04, .3, d); },
    sofa(B, m, a, d) { [[-.36, -.2], [.36, -.2], [-.36, .2], [.36, .2]].forEach(([x, z]) => B.add(x, 0, z, .07, .1, .07, d)); B.add(0, .1, 0, .86, .16, .52, m); B.add(0, .26, -.18, .86, .36, .14, m); B.add(-.38, .26, 0, .12, .28, .52, m); B.add(.38, .26, 0, .12, .28, .52, m); B.add(-.17, .26, .06, .32, .09, .34, a); B.add(.17, .26, .06, .32, .09, .34, a); },
    tv(B, m, a, d) { B.add(0, 0, 0, .22, .08, .16, d); B.add(0, .08, 0, .8, .5, .1, d); B.add(0, .12, .055, .72, .42, .02, '#27384f'); B.add(-.2, .35, .07, .24, .03, .01, a); B.add(.3, .09, .06, .03, .03, .02, m); },
    bed(B, m, a, d) { B.add(0, 0, 0, .8, .2, .9, m); B.add(0, .2, 0, .74, .12, .84, '#f8f9fa'); B.add(0, .32, -.3, .5, .08, .18, a); B.add(0, .32, .15, .74, .06, .52, a); B.add(0, 0, -.45, .82, .5, .06, d); },
    wardrobe(B, m, a, d) { B.add(0, 0, 0, .74, 1, .42, m); B.add(-.17, .08, .215, .3, .84, .02, lighten(m, .1)); B.add(.17, .08, .215, .3, .84, .02, lighten(m, .1)); B.add(-.05, .5, .23, .04, .1, .02, a); B.add(.05, .5, .23, .04, .1, .02, a); B.add(0, 1, 0, .78, .06, .46, a); },
    fridge(B, m, a, d) { B.add(0, 0, 0, .62, 1, .56, m); B.add(0, .02, .285, .56, .58, .02, lighten(m, .1)); B.add(0, .64, .285, .56, .32, .02, lighten(m, .1)); B.add(.22, .35, .3, .04, .2, .03, a); B.add(.22, .7, .3, .04, .16, .03, a); B.add(0, .62, .285, .6, .02, .02, d); },
    aquarium(B, m, a, d) { B.add(0, 0, 0, .74, .3, .52, m); B.add(0, .3, 0, .66, .4, .46, '#8fd3f4', .8); B.add(0, .7, 0, .72, .04, .5, d); B.add(-.22, .3, 0, .05, .2, .05, '#3fae56'); B.add(.22, .3, .05, .05, .26, .05, '#3fae56'); B.add(0, .3, 0, .6, .03, .4, '#e6d8a8'); },
    fireplace(B, m, a, d) { B.add(0, 0, 0, .86, .8, .42, m); B.add(0, .04, .22, .42, .46, .02, '#1d1a1a'); B.add(0, .8, 0, .94, .07, .5, a); for (let j = .12; j < .78; j += .16) B.add(0, j, .215, .88, .01, .01, d); B.add(0, .04, .2, .3, .06, .08, '#5a3b22'); },
    fountain(B, m, a, d) { B.add(0, 0, 0, .9, .2, .9, m); B.add(0, .2, 0, .76, .02, .76, '#8fd3f4'); B.add(0, .2, 0, .14, .5, .14, a); B.add(0, .7, 0, .42, .08, .42, m); B.add(0, .78, 0, .32, .02, .32, '#8fd3f4'); },
    statue(B, m, a, d) { B.add(0, 0, 0, .52, .3, .52, m); B.add(0, .3, 0, .26, .4, .18, a); B.add(0, .7, 0, .2, .2, .2, a); B.add(-.17, .38, 0, .08, .3, .08, a); B.add(.17, .38, 0, .08, .3, .08, a); },
    piano(B, m, a, d) { [[-.36, -.18], [.36, -.18], [-.36, .22], [.36, .22]].forEach(([x, z]) => B.add(x, 0, z, .07, .28, .07, d)); B.add(0, .28, -.05, .88, .34, .4, d); B.add(0, .62, -.05, .92, .04, .44, a); B.add(0, .28, .2, .82, .05, .16, '#fff'); [-.3, -.18, .06, .18, .3].forEach(x => B.add(x, .33, .2, .04, .03, .09, '#222')); B.add(0, .4, .12, .6, .14, .02, m); },
  };
  const furnCache = {};
  function furnModel(f) {
    if (furnCache[f.id]) return furnCache[f.id];
    const B = mk(); F[f.shape](B, f.pal[0], f.pal[1], f.pal[2]);
    let top = 0; for (const b of B) if (b.a === undefined || b.a > .5) top = Math.max(top, b.y + b.h);
    const sh = f.shape, v = f.v;
    const dyn = (sh === 'fireplace' || sh === 'fountain' || sh === 'aquarium' || sh === 'clock' || sh === 'tv' || v >= 2) ? t => {
      const D = mk();
      if (sh === 'fireplace') { const s = Math.sin(t * 7); D.add(-.06, .08, .19, .12, .2 + .06 * s, .06, '#ff7a2a'); D.add(.07, .08, .19, .12, .14 - .05 * s, .06, '#ff7a2a'); D.add(0, .1, .19, .08, .12 + .08 * s, .05, '#ffd24d'); }
      else if (sh === 'fountain') for (let k = 0; k < 4; k++) { const u = (t * .9 + k / 4) % 1; D.add(Math.cos(k * 1.57) * .25 * u, .78 + .5 * Math.sin(u * Math.PI), Math.sin(k * 1.57) * .25 * u, .05, .05, .05, '#bfe8fb'); }
      else if (sh === 'aquarium') { const x = Math.sin(t * 1.3) * .2; D.add(x, .45, .02, .1, .07, .06, f.pal[1]); D.add(x - Math.sign(Math.cos(t * 1.3)) * .07, .46, .02, .04, .05, .05, f.pal[1]); }
      else if (sh === 'clock') D.add(Math.sin(t * 3) * .04, .24, .145, .08, .08, .015, f.pal[1]);
      else if (sh === 'tv') D.add(Math.sin(t * 2) * .28, .2 + (Math.sin(t * 3.1) + 1) * .14, .075, .06, .06, .01, '#fff');
      if (v >= 2) { const b = Math.sin(t * 3) * .03; D.add(.28, top + .08 + b, -.2, .07, .07, .07, v === 3 ? '#ffe066' : '#ffffff'); if (v === 3) D.add(-.3, top - .1 - b, .2, .06, .06, .06, '#ffe066'); }
      return D;
    } : null;
    return (furnCache[f.id] = { boxes: B, h: top, dyn });
  }

  return { View, mk, charBoxes, plantBoxes, plantStage, sparkles, furnModel, renderIcon, darken, lighten };
})();
