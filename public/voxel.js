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
  // HD-2D style: soft bands + warm fill light
  function celFace(hex, dl, isTop) {
    const band = isTop ? 1.14 : dl > .5 ? 1.06 : dl > .15 ? .96 : .84;
    return face(hex, band);
  }
  function mixHex(a, b, t) {
    const A = parse(a), B = parse(b);
    return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  // golden-hour side light (matches Octopath-like HD-2D)
  const LIGHT = [.55, .75, .25];
  const OUTLINE = '#cbb8a4';
  const FOG = '#f0dcc8';

  const mk = () => { const a = []; a.add = (x, y, z, w, h, d, c, al) => { a.push({ x, y, z, w, h, d, c, a: al }); return a; }; return a; };

  // ---------------- view / renderer ----------------
  // box corner bit order: x=1, y=2, z=4  (0 = negative side)
  const FACES = [
    { c: [2, 3, 7, 6], n: [0, 1, 0] }, { c: [3, 7, 5, 1], n: [1, 0, 0] }, { c: [6, 2, 0, 4], n: [-1, 0, 0] },
    { c: [7, 6, 4, 5], n: [0, 0, 1] }, { c: [2, 3, 1, 0], n: [0, 0, -1] },
  ];
  class View {
    constructor(canvas, opts) {
      this.cv = canvas; this.ctx = canvas.getContext('2d', { alpha: !!(opts && opts.alpha) });   // icons need a transparent canvas, otherwise they get a black box
      this.ctx.imageSmoothingEnabled = false;
      this.yaw = .78; this.pitch = .98; this.ppt = 32; this.fx = 0; this.fz = 0; this.hcf = .52;
      this.groups = []; this.P = new Float64Array(16);
      this.focusD = 0; this._fog = FOG;
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
    // soft warm sky wash (HD-2D atmosphere)
    clearSky() {
      const ctx = this.ctx, g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, '#f7e4d2');
      g.addColorStop(.35, '#e8f0d8');
      g.addColorStop(.7, '#c8e6b8');
      g.addColorStop(1, '#b5dca8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
      // soft sun bloom (upper-right)
      const sx = this.W * .78, sy = this.H * .12, r = Math.max(this.W, this.H) * .45;
      const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      sun.addColorStop(0, 'rgba(255,236,200,.55)');
      sun.addColorStop(.45, 'rgba(255,220,180,.18)');
      sun.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, this.W, this.H);
    }
    // flat rectangle on the ground (drawn immediately, always behind queued objects)
    quad(x0, z0, x1, z1, y, fill, edge) {
      const ctx = this.ctx, P = this.P;
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (let i = 0; i < 4; i++) {
        const X = i === 0 || i === 3 ? x0 : x1, Z = i < 2 ? z0 : z1;
        const dx = X - this.fx, dz = Z - this.fz, rx = dx * this.cyw - dz * this.syw, rz = dx * this.syw + dz * this.cyw;
        const sx = Math.round(this.W / 2 + rx * this.ppt), sy = Math.round(this.hc - (y * this.cp + rz * this.sp) * this.ppt);
        P[i * 2] = sx; P[i * 2 + 1] = sy;
        if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
      }
      if (mxx < 0 || mnx > this.W || mxy < 0 || mny > this.H) return;
      // soft depth fog on ground tiles
      const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
      const dx = midX - this.fx, dz = midZ - this.fz, rz = dx * this.syw + dz * this.cyw;
      const depth = rz * this.cp - y * this.sp;
      const fogT = Math.min(.55, Math.max(0, (Math.abs(depth - this.focusD) - 4) / 18));
      const col = fogT > .02 ? mixHex(fill, this._fog, fogT) : fill;
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[2], P[3]); ctx.lineTo(P[4], P[5]); ctx.lineTo(P[6], P[7]); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      // pixel-grid hairline for HD-2D tile feel
      ctx.strokeStyle = edge || 'rgba(170,150,130,.2)'; ctx.lineWidth = 1; ctx.stroke();
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
    // tilt-shift vignette + warm bloom overlay
    finish() {
      const ctx = this.ctx, w = this.W, h = this.H;
      // soft focus ring (edges slightly washed — DOF stand-in)
      const v = ctx.createRadialGradient(w / 2, h * .52, h * .18, w / 2, h * .52, h * .78);
      v.addColorStop(0, 'rgba(255,245,230,0)');
      v.addColorStop(.55, 'rgba(240,220,200,.06)');
      v.addColorStop(1, 'rgba(200,170,150,.28)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
      // gentle top/bottom blur wash
      const tb = ctx.createLinearGradient(0, 0, 0, h);
      tb.addColorStop(0, 'rgba(247,228,210,.22)');
      tb.addColorStop(.12, 'rgba(247,228,210,0)');
      tb.addColorStop(.88, 'rgba(180,200,160,0)');
      tb.addColorStop(1, 'rgba(160,180,140,.2)');
      ctx.fillStyle = tb; ctx.fillRect(0, 0, w, h);
    }
    drawBox(it) {
      const b = it.b, ctx = this.ctx, P = this.P, cs = it.cs, sn = it.sn;
      const hx = b.w / 2, hy = b.h / 2, hz = b.d / 2, cyy = b.y + hy;
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (let i = 0; i < 8; i++) {
        const lx = b.x + ((i & 1) ? hx : -hx), lz = b.z + ((i & 4) ? hz : -hz), ly = cyy + ((i & 2) ? hy : -hy);
        const wx = it.ox + lx * cs + lz * sn, wz = it.oz - lx * sn + lz * cs, wy = it.oy + ly;
        const dx = wx - this.fx, dz = wz - this.fz, rx = dx * this.cyw - dz * this.syw, rz = dx * this.syw + dz * this.cyw;
        const sx = Math.round(this.W / 2 + rx * this.ppt), sy = Math.round(this.hc - (wy * this.cp + rz * this.sp) * this.ppt);
        P[i * 2] = sx; P[i * 2 + 1] = sy;
        if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
      }
      const span = Math.max(mxx - mnx, mxy - mny);
      const doOutline = span >= 8 && (b.a === undefined || b.a > .55);
      const ow = span > 30 ? Math.min(1.6, .8 + this.ppt * .028) : 1;
      // depth fog + slight far desaturation (DOF / atmosphere)
      const fogT = Math.min(.62, Math.max(0, (Math.abs(it.d - this.focusD) - 3.5) / 16));
      const baseA = b.a !== undefined ? b.a : 1;
      if (baseA < 1) ctx.globalAlpha = baseA;
      for (let f = 0; f < 5; f++) {
        const fc = FACES[f], n = fc.n;
        const nx = n[0] * cs + n[2] * sn, nz = -n[0] * sn + n[2] * cs;
        if (n[1] * this.sp - (nx * this.syw + nz * this.cyw) * this.cp <= 0) continue;
        const dl = LIGHT[0] * nx + LIGHT[1] * n[1] + LIGHT[2] * nz;
        let col = celFace(b.c, Math.max(0, dl), n[1] > .5);
        if (fogT > .02) col = mixHex(col, this._fog, fogT);
        const c = fc.c;
        ctx.beginPath(); ctx.moveTo(P[c[0] * 2], P[c[0] * 2 + 1]); ctx.lineTo(P[c[1] * 2], P[c[1] * 2 + 1]); ctx.lineTo(P[c[2] * 2], P[c[2] * 2 + 1]); ctx.lineTo(P[c[3] * 2], P[c[3] * 2 + 1]); ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        // subtle pixel dither on large faces (HD-2D texture cue)
        if (span > 22 && fogT < .35 && n[1] < .9) {
          ctx.save(); ctx.clip();
          ctx.globalAlpha = baseA * .12;
          ctx.fillStyle = lighten(col, .18);
          const step = 3;
          for (let yy = (mny | 0); yy < mxy; yy += step)
            for (let xx = (mnx | 0) + ((yy >> 1) & 1) * 2; xx < mxx; xx += step)
              ctx.fillRect(xx, yy, 1, 1);
          ctx.restore();
          if (baseA < 1) ctx.globalAlpha = baseA; else ctx.globalAlpha = 1;
        }
        if (doOutline) {
          ctx.strokeStyle = fogT > .2 ? mixHex(OUTLINE, this._fog, fogT) : OUTLINE;
          ctx.lineWidth = ow; ctx.lineJoin = 'round';
          ctx.globalAlpha = baseA * (.55 - fogT * .25);
          ctx.stroke();
          ctx.globalAlpha = baseA;
        } else { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  function renderIcon(boxes, o) {
    const c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
    const v = new View(c, { alpha: true }); v.yaw = o.yaw === undefined ? .78 : o.yaw; v.ppt = o.ppt; v.hcf = o.hcf || .8; v.prep();
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

  // ---------------- characters (front = +z) — chibi / FarmVille proportions ----------------
  function charBoxes(av, cat, walk, moving) {
    const f = av.gender === 'female', C = cat.CLOTH;
    const top = C[av.top] || C.top_tee_white, bot = C[av.bottom] || C.bot_jeans, sh = C[av.shoes] || C.shoe_plain;
    const hh = av.hat ? C[av.hat] : null, skin = av.skin, hc = av.hairColor, B = mk();
    const sw = moving ? Math.sin(walk) * .1 : 0, tw = f ? .36 : .4;
    // chunky legs + shoes
    for (const s of [-1, 1]) {
      const z = s * sw, x = s * .1;
      B.add(x, .12, z, .16, .22, .16, bot.len === 'long' ? bot.c[0] : skin);
      if (bot.len === 'long' && bot.pat !== 'solid') decals(B, bot.pat, x, .12, z, .16, .22, .16, bot.c[1]);
      if (bot.len === 'short') { B.add(x, .2, z, .17, .14, .17, bot.c[0]); decals(B, bot.pat, x, .2, z, .17, .14, .17, bot.c[1]); }
      B.add(x, 0, z + .03, .2, .12, .26, sh.c[0]);
      B.add(x, .02, z + .1, .16, .06, .12, lighten(sh.c[0], .15));
      if (sh.id !== 'shoe_plain') B.add(x, 0, z + .03, .21, .04, .27, sh.c[1]);
    }
    if (bot.len === 'skirt') { B.add(0, .2, 0, .48, .2, .32, bot.c[0]); decals(B, bot.pat, 0, .2, 0, .48, .2, .32, bot.c[1]); }
    else { B.add(0, .3, 0, .4, .1, .24, bot.c[0]); decals(B, bot.pat, 0, .3, 0, .4, .1, .24, bot.c[1]); }
    // arms
    for (const s of [-1, 1]) {
      const x = s * (tw / 2 + .06), z = -s * sw;
      if (top.long) { B.add(x, .42, z, .12, .28, .12, top.c[0]); B.add(x, .36, z, .1, .08, .1, skin); }
      else { B.add(x, .56, z, .12, .14, .12, top.c[0]); B.add(x, .4, z, .1, .16, .1, skin); }
    }
    // torso
    B.add(0, .38, 0, tw, .32, .24, top.c[0]); decals(B, top.pat, 0, .38, 0, tw, .32, .24, top.c[1]);
    // big chibi head + soft face
    B.add(0, .68, 0, .4, .38, .36, skin);
    B.add(-.1, .84, .185, .07, .08, .03, '#8a7a70'); B.add(.1, .84, .185, .07, .08, .03, '#8a7a70');
    B.add(-.1, .86, .195, .03, .03, .02, '#fffaf5'); B.add(.1, .86, .195, .03, .03, .02, '#fffaf5');
    B.add(0, .76, .19, .1, .03, .03, '#e8a090');
    if (f) {
      B.add(-.14, .78, .185, .07, .04, .03, '#ffd0d8'); B.add(.14, .78, .185, .07, .04, .03, '#ffd0d8');
      B.add(-.1, .91, .19, .08, .02, .02, '#8a7a70'); B.add(.1, .91, .19, .08, .02, .02, '#8a7a70');
    }
    // hair volume
    B.add(0, .98, 0, .42, .12, .4, hc); B.add(0, .92, .18, .42, .1, .06, hc); B.add(0, .7, -.18, .4, .32, .08, hc);
    B.add(-.2, .82, 0, .06, .2, .34, hc); B.add(.2, .82, 0, .06, .2, .34, hc);
    if (f) { B.add(0, .4, -.2, .4, .55, .08, hc); B.add(-.2, .52, -.02, .07, .4, .22, hc); B.add(.2, .52, -.02, .07, .4, .22, hc); }
    if (hh) hat(B, hh, 1.1);
    return B;
  }

  // ---------------- plants ----------------
  // ---- crops: soil mound + per-crop detail (leaf rosettes, veins, calyxes, highlights, tendrils, stakes). Keep box counts modest: every box is a mesh. ----
  const SOIL = B => {
    B.add(0, 0, 0, .66, .05, .66, '#4a311f'); B.add(0, .05, 0, .54, .05, .54, '#664630');
    B.add(-.18, .09, -.12, .07, .03, .05, '#8a6446'); B.add(.2, .09, .14, .06, .03, .05, '#8a6446'); B.add(.24, .09, -.2, .05, .035, .04, '#9a9da2');
  };
  const leaf = (B, x, y, z, ang, len, c, w) => {   // 3-pixel leaf pointing outward at `ang`, tip lifted & lighter
    w = w || .1;
    for (let k = 0; k < 3; k++) { const t = (k + 1) / 3; B.add(x + Math.cos(ang) * len * t, y + k * .018, z + Math.sin(ang) * len * t, w * (1 - k * .18), .035, w * (1 - k * .18), k === 2 ? lighten(c, .16) : k === 0 ? darken(c, .08) : c); }
  };
  const ring = (B, n, y, rad, len, c, off, w) => { for (let i = 0; i < n; i++) leaf(B, Math.cos(i * 6.2832 / n + off) * rad, y, Math.sin(i * 6.2832 / n + off) * rad, i * 6.2832 / n + off, len, i % 2 ? lighten(c, .08) : c, w); };
  const K = {
    root(B, d, s, r) {   // carrot / radish: feathery tops, crown showing above the soil
      const carrot = d.id === 'carrot', top = d.c2;
      if (carrot) { for (let i = 0; i < 7; i++) { const a = i * .9, rr = .02 + (i % 3) * .035, h = .2 + .3 * s + (i % 2) * .05; B.add(Math.cos(a) * rr, .1, Math.sin(a) * rr, .035, h, .035, i % 2 ? lighten(top, .12) : top); B.add(Math.cos(a) * (rr + .06), .1 + h * .8, Math.sin(a) * (rr + .06), .07, .05, .07, lighten(top, .2)); } }
      else { ring(B, 6, .12, .03, .22 + .1 * s, top, .3, .12); B.add(0, .1, 0, .06, .1, .06, '#7ac86a'); }
      if (r) { if (carrot) { B.add(0, .1, 0, .2, .07, .2, d.c1); B.add(.02, .15, 0, .16, .025, .16, lighten(d.c1, .25)); B.add(-.05, .12, .06, .03, .03, .05, darken(d.c1, .2)); } else { B.add(0, .09, 0, .24, .12, .24, d.c1); B.add(0, .21, 0, .18, .03, .18, lighten(d.c1, .25)); B.add(-.05, .17, .1, .06, .05, .05, '#ffd0da'); } }
      else B.add(0, .09, 0, .08 + .08 * s, .05, .08 + .08 * s, d.c1);
    },
    leafy(B, d, s, r) {   // lettuce / herb / sprout rosettes
      const big = d.id === 'lettuce';
      ring(B, 6, .1, .04, .14 + .16 * s, darken(d.c2, .1), 0, big ? .16 : .12);
      ring(B, 6, .16, .03, .12 + .13 * s, d.c2, .5, big ? .15 : .11);
      if (big) ring(B, 5, .22, .02, .1 + .1 * s, lighten(d.c1, .1), .2, .13);
      B.add(0, .2 + (big ? .06 : 0), 0, .14 + .08 * s, .1, .14 + .08 * s, lighten(d.c1, .18));
      B.add(-.02, .3 + (big ? .06 : 0), .02, .08, .04, .08, lighten(d.c1, .32));
      if (d.id === 'herb' && r) { for (const [x, z] of [[-.1, .08], [.12, -.04], [.02, .14]]) { B.add(x, .28, z, .02, .12, .02, '#3b8a34'); B.add(x, .39, z, .06, .05, .06, '#d8b4fe'); } }
    },
    bushfruit(B, d, s, r) {
      const id = d.id, h = .26 + .34 * s;
      if (id === 'tomato') {
        B.add(.17, .08, -.12, .035, h + .28, .035, '#c9a066'); B.add(.17, h + .3, -.12, .06, .02, .06, '#a8864f');   // stake
        B.add(0, .08, 0, .07, h, .07, '#5b9a43'); B.add(-.05, .12, 0, .035, h * .7, .035, '#4a8a3a');
        for (let k = 0; k < 3; k++) ring(B, 4, .14 + k * h * .3, .03, .17 + .05 * s, k % 2 ? '#3f9a3a' : '#2f8a35', k * .4, .1);
        if (r) [[-.2, .2, .1], [.16, .16, .16], [.0, .34, -.18], [-.14, .42, -.06], [.2, .38, .02]].forEach(([x, y, z], i) => { B.add(x, y, z, .15, .14, .15, d.c1); B.add(x - .03, y + .09, z - .03, .045, .035, .045, lighten(d.c1, .4)); B.add(x, y + .14, z, .09, .03, .09, '#3f9a3a'); });
        else [[-.18, .24, .1], [.14, .3, .12], [.02, .4, -.14]].forEach(([x, y, z]) => B.add(x, y, z, .07, .07, .07, '#9bd065'));
      } else if (id === 'strawberry') {
        ring(B, 7, .1, .04, .2 + .06 * s, '#2f8a3a', .1, .12); ring(B, 5, .15, .03, .15 + .05 * s, '#46a64a', .6, .1);
        if (r) [[-.18, .1, .12], [.2, .08, .06], [.04, .08, -.22], [-.08, .1, -.12], [.14, .1, .22]].forEach(([x, y, z], i) => { B.add(x, y, z, .1, .1, .1, d.c1); B.add(x, y - .05, z, .06, .04, .06, darken(d.c1, .1)); B.add(x, y + .1, z, .09, .025, .09, '#2f9a3f'); B.add(x - .02, y + .02, z + .05, .02, .02, .01, '#ffe98a'); B.add(x + .025, y - .01, z + .05, .02, .02, .01, '#ffe98a'); });
        else [[-.14, .13, .1], [.16, .12, -.1]].forEach(([x, y, z]) => { B.add(x, y, z, .08, .03, .08, '#ffffff'); B.add(x, y + .03, z, .03, .02, .03, '#ffd43b'); });
      } else if (id === 'pea') {
        for (const x of [-.26, .26]) B.add(x, .06, -.05, .035, .55 + .1 * s, .035, '#c9a066'); B.add(0, .5 + .08 * s, -.05, .56, .03, .03, '#a8864f'); B.add(0, .3, -.05, .5, .02, .02, '#d9c08a');
        for (let k = 0; k < 5; k++) { const y = .1 + k * (.07 + .05 * s); B.add(-.16 + (k % 2) * .32, y, -.05 + (k % 2 ? .04 : -.02), .14, .04, .1, k % 2 ? '#45a043' : '#2f8a35'); B.add(.04 - (k % 2) * .1, y + .03, -.05, .02, .05, .02, '#6fc04f'); }
        if (r) [[-.2, .26], [.18, .38], [-.12, .5], [.22, .2]].forEach(([x, y], i) => { B.add(x, y, .0, .05, .16, .05, '#7fd04a'); B.add(x + .01, y + .02, .03, .02, .1, .02, '#b6f07a'); });
      } else {   // blueberry
        const g = .3 + .14 * s;
        B.add(0, .08, 0, g, g * .7, g, '#2a7d4a'); B.add(-.16, .12, .06, g * .7, g * .7, g * .7, '#37935a'); B.add(.15, .14, -.04, g * .7, g * .75, g * .7, '#2a7d4a'); B.add(0, .24 * s + .14, 0, g * .6, g * .5, g * .6, '#46a96a');
        const bc = r ? d.c1 : '#8aa0e8';
        [[-.26, .16, .1], [.26, .18, .02], [.0, .12, .28], [-.12, .3, .16], [.14, .34, -.1], [-.2, .28, -.12], [.08, .2, -.28]].forEach(([x, y, z], i) => { B.add(x, y, z, .08, .08, .08, bc); if (r) B.add(x - .015, y + .04, z + .04, .025, .025, .02, '#9fb2ff'); });
      }
    },
    stalk(B, d, s, r) {
      if (d.id === 'scallion') {
        for (let i = 0; i < 9; i++) { const a = i * .7, rr = .03 + (i % 3) * .03, h = .3 + .5 * s - (i % 3) * .08; B.add(Math.cos(a) * rr, .08, Math.sin(a) * rr, .045, h, .045, i % 2 ? '#3fae4a' : '#2f9a3a'); B.add(Math.cos(a) * rr, .08, Math.sin(a) * rr, .05, .13, .05, '#f1f5e8'); B.add(Math.cos(a) * (rr + .03), .08 + h * .7, Math.sin(a) * (rr + .03), .04, .08, .04, lighten('#3fae4a', .2)); }
        if (r) B.add(.05, .08 + .62, 0, .06, .06, .06, d.c1);
        return;
      }
      const h = .3 + .75 * s;   // corn
      B.add(0, .08, 0, .12, h, .12, '#4a9a38'); B.add(0, .08, 0, .13, .03, .13, '#2f7d2f');
      for (let i = 0; i < 4; i++) { const y = .16 + i * h * .22, sg = i % 2 ? 1 : -1; B.add(sg * .1, y, 0, .18, .05, .1, i % 2 ? '#56ae42' : '#3f9a35'); B.add(sg * .22, y - .02, .02, .14, .045, .09, lighten('#3f9a35', .12)); B.add(sg * .32, y - .06, .02, .09, .04, .08, '#56ae42'); }
      if (r) { for (const [x, z, y, sg] of [[.1, .06, .34, 1], [-.1, -.04, .5, -1]]) { B.add(x, y, z, .14, .3, .14, '#7cc05a'); B.add(x + sg * .02, y + .02, z + .075, .1, .22, .02, d.c1); B.add(x + sg * .02, y + .08, z + .075, .1, .02, .022, '#e0a92a'); B.add(x, y + .3, z, .06, .1, .06, '#d9c27a'); } }
      B.add(0, .08 + h, 0, .05, .14, .05, '#e8d9a0'); B.add(-.06, .08 + h - .02, 0, .08, .04, .04, '#d8c98a'); B.add(.06, .08 + h - .02, 0, .08, .04, .04, '#d8c98a');
    },
    flower(B, d, s, r) {
      const h = .28 + .72 * s, moon = d.v === 1;
      B.add(0, .06, 0, .075, h, .075, '#3f8f3a'); B.add(.03, .06, 0, .02, h, .077, '#57ad48');
      leaf(B, 0, .18 * h + .06, 0, 0, .22, '#3f9a3a', .12); leaf(B, 0, .45 * h + .06, 0, Math.PI, .22, '#3f9a3a', .12); leaf(B, 0, .7 * h + .06, 0, 1.6, .16, '#4fae44', .1);
      const y = h + .04;
      if (!r) { B.add(0, y, 0, .2, .14, .2, '#4fa83a'); B.add(0, y + .12, 0, .12, .1, .12, '#6fc04f'); return; }
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; B.add(Math.cos(a) * .22, y, Math.sin(a) * .22, .11, .05, .1, i % 2 ? d.c1 : lighten(d.c1, .12)); }
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + .3; B.add(Math.cos(a) * .15, y + .02, Math.sin(a) * .15, .1, .05, .09, darken(d.c1, .08)); }
      if (!moon) { B.add(0, y + .02, 0, .22, .06, .22, '#5a3a1c'); B.add(0, y + .07, 0, .14, .03, .14, '#7a5230'); B.add(-.04, y + .09, .03, .03, .015, .03, '#b08850'); B.add(.04, y + .09, -.03, .03, .015, .03, '#b08850'); }
      else { B.add(0, y + .02, 0, .16, .08, .16, '#ffe98a'); B.add(0, y + .02, 0, .6, .02, .6, '#aab8ff', .22); B.add(0, y + .1, 0, .06, .04, .06, '#ffffff'); }
    },
    gourd(B, d, s, r) {
      const pump = d.v === 0;
      for (const [x, z, a] of [[-.3, .08, 3.1], [.3, -.1, 0], [0, .3, 1.6], [-.14, -.3, -1.6]]) { B.add(x * .7, .07, z * .7, .22, .03, .05, '#3a8a32'); B.add(x, .09, z, .24, .035, .22, '#4aa23c'); B.add(x, .12, z, .1, .02, .14, '#66c056'); }
      B.add(.28, .1, .22, .03, .1, .03, '#79b84a'); B.add(.3, .19, .22, .06, .025, .03, '#79b84a');   // tendril
      if (!r) { const g = .16 * s + .1; B.add(0, .06, 0, g, g * .85, g, pump ? '#e8a62a' : '#4aa03a'); return; }
      if (pump) { B.add(0, .06, 0, .56, .34, .54, d.c1); B.add(0, .06, 0, .42, .38, .64, d.c1); [-.2, -.07, .07, .2].forEach(x => B.add(x, .08, 0, .03, .3, .56, darken(d.c1, .22))); B.add(-.12, .3, .26, .1, .08, .05, lighten(d.c1, .3)); B.add(0, .4, 0, .08, .14, .08, '#5f8a2c'); B.add(.06, .52, 0, .05, .04, .05, '#4a7a22'); }
      else { B.add(0, .06, 0, .66, .34, .44, '#2f8f3f'); [-.24, -.1, .04, .18, .3].forEach((x, i) => B.add(x, .06, 0, .06, .35, .45, i % 2 ? '#8fd070' : '#1f6f2f')); B.add(-.16, .3, .12, .14, .03, .1, '#58b84f'); B.add(.3, .38, 0, .05, .06, .05, '#8a8f3a'); }
    },
    hang(B, d, s, r) {
      const eg = d.v === 0, th = .34 + .4 * s;
      B.add(0, .06, 0, .1, th, .1, '#6b8a3a'); B.add(.03, .06, 0, .02, th, .1, '#86a84a');
      for (let k = 0; k < 3; k++) ring(B, 4, .22 + k * th * .26, .05, .2 + .04 * s, k % 2 ? '#3f9a45' : '#2f8a3a', k * .5, .14);
      if (!r) { B.add(.12, th * .6, .08, .05, .05, .05, eg ? '#e6dcff' : '#ffd0e6'); return; }
      if (eg) [[-.2, .24], [.2, .26], [0, .32], [.28, -.14]].forEach(([x, z], i) => { B.add(x, th - .34, z, .14, .3, .14, d.c1); B.add(x, th - .1, z, .1, .08, .1, d.c1); B.add(x - .04, th - .2, z + .06, .035, .16, .02, lighten(d.c1, .35)); B.add(x, th - .01, z, .17, .04, .17, '#3f9a3a'); B.add(x, th + .03, z, .05, .05, .05, '#2f7d2f'); });
      else [[-.24, .2], [.24, .22], [0, .3], [.3, -.16]].forEach(([x, z]) => { B.add(x, th - .34, z, .2, .2, .2, d.c1); for (const [ox, oy, oz] of [[-.11, .14, 0], [.11, .1, 0], [0, .2, .1], [-.08, 0, .1], [.08, .02, .1]]) B.add(x + ox, th - .34 + oy, z + oz, .06, .06, .05, '#58c056'); B.add(x, th - .14, z, .08, .04, .08, '#2f9e44'); B.add(x - .04, th - .26, z + .1, .04, .04, .02, lighten(d.c1, .3)); });
    },
    pine(B, d, s, r) {   // pineapple
      ring(B, 8, .1, .04, .2 + .26 * s, '#4a9a38', 0, .1); ring(B, 6, .14, .03, .15 + .16 * s, '#6bb24a', .4, .09); B.add(0, .12, 0, .12, .16 + .1 * s, .12, '#5aa842');
      if (!r) return;
      B.add(0, .06, 0, .34, .34, .34, d.c1);
      for (let j = 0; j < 4; j++) B.add(0, .1 + j * .08, 0, .355, .02, .355, '#9a6a14');
      for (const x of [-.1, .1]) { B.add(x, .06, 0, .025, .34, .355, '#9a6a14'); B.add(0, .06, x, .355, .34, .025, '#9a6a14'); }
      for (const [x, y] of [[-.14, .12], [.0, .2], [.14, .12], [-.14, .28], [.1, .28]]) B.add(x, y, .175, .05, .04, .02, lighten(d.c1, .3));
      B.add(0, .4, 0, .3, .04, .3, '#4a9a38'); ring(B, 7, .42, .02, .18, '#3f8f36', .2, .08); B.add(0, .44, 0, .07, .14, .07, '#5aa842');
    },
    mush(B, d, s, r) {
      const cluster = (x, z, sc) => {
        const w = (.22 + .22 * s) * sc, h = (.16 + .26 * s) * sc;
        B.add(x, .06, z, .12 * sc, h, .12 * sc, d.c2); B.add(x, .06 + h * .55, z, .15 * sc, .03, .15 * sc, '#c9b8a0');   // stem + ring
        B.add(x, .06 + h, z, w, .07, w, darken(d.c1, .15)); B.add(x, .06 + h + .07, z, w * .8, .07, w * .8, d.c1); B.add(x, .06 + h + .14, z, w * .5, .05, w * .5, lighten(d.c1, .18));
        B.add(x - w * .22, .06 + h + .15, z + w * .1, .035, .02, .035, '#ffffff'); B.add(x + w * .2, .06 + h + .1, z - w * .1, .04, .02, .04, '#ffffff'); B.add(x, .06 + h + .12, z + w * .3, .03, .02, .03, '#ffffff');
      };
      cluster(0, 0, 1); if (r) { cluster(.26, .2, .6); cluster(-.24, .16, .5); B.add(0, .02, 0, .7, .02, .7, d.c1, .14); }
    },
    cactus(B, d, s, r) {
      const h = .34 + .56 * s;
      B.add(0, .06, 0, .24, h, .24, d.c1); B.add(0, .06, 0, .05, h + .01, .25, lighten(d.c1, .28)); B.add(0, .06, 0, .25, h + .01, .05, darken(d.c1, .14));
      for (let y = .16; y < h; y += .12) { B.add(-.13, .06 + y, .13, .02, .02, .02, '#f2ecd0'); B.add(.13, .06 + y + .05, .13, .02, .02, .02, '#f2ecd0'); }
      if (s > .6) { B.add(-.2, .06 + h * .42, 0, .18, .09, .12, d.c1); B.add(-.28, .06 + h * .42, 0, .09, .3, .12, d.c1); B.add(.2, .06 + h * .3, 0, .18, .09, .12, d.c1); B.add(.28, .06 + h * .3, 0, .09, .26, .12, d.c1); }
      if (r) { B.add(0, .06 + h, 0, .1, .1, .1, '#ffe066'); for (let i = 0; i < 6; i++) { const a = i * 1.047; B.add(Math.cos(a) * .12, .06 + h - .01, Math.sin(a) * .12, .1, .07, .1, i % 2 ? d.c2 : lighten(d.c2, .15)); } }
    },
  };
  const plantCache = {};
  function plantStage(p) { return p < .12 ? 0 : p < .4 ? 1 : p < 1 ? 2 : 3; }
  function plantBoxes(sd, stage, gold) {
    const key = sd.id + stage + (gold && stage === 3 ? 'g' : ''); if (plantCache[key]) return plantCache[key];
    const B = mk(), c1 = gold && stage === 3 ? '#ffcf33' : sd.c1;
    SOIL(B);
    if (stage === 0) { B.add(0, .1, 0, .22, .05, .22, '#7a5738'); B.add(0, .15, 0, .09, .06, .09, sd.c2); B.add(-.04, .18, 0, .06, .03, .04, lighten(sd.c2, .2)); B.add(.04, .17, .01, .05, .03, .04, sd.c2); }
    else if (stage === 1) { B.add(0, .1, 0, .045, .2, .045, lighten(sd.c2, .1)); B.add(-.09, .26, 0, .12, .04, .08, lighten(sd.c2, .25)); B.add(.09, .27, 0, .12, .04, .08, sd.c2); B.add(0, .3, .03, .06, .05, .06, lighten(sd.c2, .3)); B.add(.05, .16, .09, .08, .03, .06, darken(sd.c2, .1)); B.add(-.06, .15, -.08, .08, .03, .06, sd.c2); }
    else K[sd.kind](B, { id: sd.id, c1, c2: sd.c2, v: sd.v }, stage === 3 ? 1 : .65, stage === 3);
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
    lamp(B, m, a, d) {
      B.add(0, 0, 0, .32, .06, .32, d); B.add(0, .06, 0, .22, .07, .22, m); B.add(0, .13, 0, .06, .55, .06, d); B.add(0, .3, 0, .13, .05, .13, m);   // stepped base, iron post, collar
      B.add(0, .66, 0, .3, .04, .3, d);                                                                                                          // lantern floor
      for (const [x, z] of [[-.12, -.12], [.12, -.12], [-.12, .12], [.12, .12]]) B.add(x, .7, z, .03, .26, .03, d);                               // frame bars
      B.add(0, .7, 0, .22, .26, .22, '#ffe9a0', .55); B.add(0, .78, 0, .1, .1, .1, '#fff6c8');                                                 // glass + bright core
      B.add(0, .96, 0, .34, .05, .34, m); B.add(0, 1.01, 0, .22, .05, .22, a); B.add(0, 1.06, 0, .07, .07, .07, d);                             // roof + finial
      B.add(0, .7, 0, .52, .32, .52, '#ffe9a0', .16);                                                                                          // soft glow
    },
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
    fountain(B, m, a, d) {
      B.add(0, 0, 0, .98, .1, .98, darken(m, .1));
      for (const [x, z, w, dd] of [[0, .45, .98, .08], [0, -.45, .98, .08], [.45, 0, .08, .98], [-.45, 0, .08, .98]]) B.add(x, .1, z, w, .09, dd, lighten(m, .08));   // rim
      for (const [x, z] of [[-.45, -.45], [.45, -.45], [-.45, .45], [.45, .45]]) { B.add(x, .1, z, .12, .14, .12, m); B.add(x, .24, z, .08, .04, .08, a); }   // corner posts
      B.add(0, .1, 0, .82, .05, .82, '#8fd3f4', .92);                                                                                                  // lower water
      B.add(0, .1, 0, .22, .3, .22, m); B.add(0, .38, 0, .5, .07, .5, lighten(m, .06)); B.add(0, .45, 0, .42, .03, .42, '#8fd3f4', .92);                  // pedestal + bowl
      B.add(0, .45, 0, .12, .28, .12, m); B.add(0, .72, 0, .2, .05, .2, a); B.add(0, .77, 0, .06, .06, .06, '#bfe8fb');                                   // spout + cap
    },
    statue(B, m, a, d) {
      B.add(0, 0, 0, .62, .1, .62, darken(m, .08)); B.add(0, .1, 0, .5, .16, .5, m); B.add(0, .14, .255, .26, .08, .012, d); B.add(0, .26, 0, .56, .05, .56, lighten(m, .1));   // plinth + plaque
      B.add(0, .31, -.11, .3, .34, .05, darken(a, .18));                                                                     // cape
      B.add(0, .31, 0, .34, .12, .26, darken(a, .08)); B.add(0, .4, 0, .28, .26, .2, a);                                      // robe flare + torso
      B.add(0, .5, .105, .28, .03, .01, d);                                                                                  // sash
      B.add(-.2, .42, 0, .08, .24, .1, a); B.add(-.2, .38, 0, .07, .06, .08, lighten(a, .12));                                // arm down + hand
      B.add(.2, .5, .05, .08, .2, .1, a); B.add(.2, .68, .06, .07, .06, .08, lighten(a, .12));                                // arm raised + hand
      B.add(.2, .74, .06, .04, .16, .04, d); B.add(.2, .9, .06, .1, .08, .1, '#ffb02a'); B.add(.2, .94, .06, .05, .06, .05, '#ffe066');   // torch + flame
      B.add(0, .66, 0, .2, .2, .2, lighten(a, .1));                                                                          // head
      B.add(-.05, .76, .105, .03, .03, .012, d); B.add(.05, .76, .105, .03, .03, .012, d); B.add(0, .72, .11, .04, .05, .02, darken(a, .1));   // eyes + nose
      B.add(0, .84, 0, .23, .05, .23, d); B.add(-.09, .84, .1, .04, .04, .03, a); B.add(.09, .84, .1, .04, .04, .03, a);       // laurel crown
    },
    gnome(B, hat, beard, coat) {
      const skin = '#f2c9a0', nose = '#e79a8a', boot = '#5a3b22', belt = '#3a2a1a', hatD = darken(hat, .22);
      B.add(0, 0, 0, .46, .05, .42, '#9aa0a6'); B.add(-.12, .05, .14, .14, .03, .12, '#5f8f3f'); B.add(.14, .05, -.1, .12, .03, .1, '#5f8f3f');   // mossy stone base
      B.add(-.08, .05, .02, .12, .09, .18, boot); B.add(.08, .05, .02, .12, .09, .18, boot);                                  // boots
      B.add(-.08, .14, 0, .11, .12, .12, darken(coat, .25)); B.add(.08, .14, 0, .11, .12, .12, darken(coat, .25));            // trousers
      B.add(0, .26, 0, .3, .26, .24, coat); B.add(0, .34, 0, .32, .04, .26, belt); B.add(0, .34, .13, .07, .05, .012, '#f2c200');   // coat, belt, buckle
      B.add(-.2, .3, 0, .08, .2, .1, coat); B.add(.2, .3, 0, .08, .2, .1, coat);                                              // arms
      B.add(-.2, .26, 0, .07, .05, .08, skin); B.add(.2, .26, 0, .07, .05, .08, skin);                                         // hands
      B.add(0, .5, 0, .24, .16, .22, skin);                                                                                   // head
      B.add(0, .53, .125, .08, .07, .06, nose); B.add(-.06, .58, .115, .03, .03, .012, '#3a2a1a'); B.add(.06, .58, .115, .03, .03, .012, '#3a2a1a');   // nose + eyes
      B.add(0, .49, .12, .26, .06, .06, beard); B.add(0, .42, .125, .24, .09, .07, beard); B.add(0, .36, .13, .18, .07, .07, beard); B.add(0, .31, .13, .1, .06, .06, beard);   // tiered beard
      B.add(0, .55, .12, .2, .035, .05, beard);                                                                               // moustache
      B.add(0, .65, 0, .36, .04, .34, hatD);                                                                                  // hat brim
      B.add(0, .69, 0, .28, .1, .26, hat); B.add(0, .79, 0, .22, .1, .2, hat); B.add(.01, .89, 0, .17, .1, .15, hat); B.add(.03, .99, 0, .12, .1, .1, hat); B.add(.06, 1.09, 0, .07, .09, .06, hat);   // tall pointed hat
      B.add(0, .69, .135, .28, .03, .012, beard);                                                                             // hat band
      B.add(.24, .05, .14, .035, .06, .035, '#f1e8d0'); B.add(.24, .11, .14, .12, .045, .12, '#d6453d'); B.add(.22, .15, .14, .03, .02, .03, '#fff'); B.add(.27, .15, .17, .03, .02, .03, '#fff');   // toadstool
    },
    lantern(B, glow, core, brass) {
      const wood = '#5a3b22';
      B.add(0, 0, 0, .3, .06, .3, '#8a8f98'); B.add(-.04, .06, 0, .07, .78, .07, wood); B.add(.06, .8, 0, .3, .05, .06, wood); B.add(.18, .72, 0, .05, .1, .05, wood);   // stone base, post, arm, hook
      B.add(.2, .64, 0, .24, .04, .24, brass); for (const [x, z] of [[-.09, -.09], [.09, -.09], [-.09, .09], [.09, .09]]) B.add(.2 + x, .38, z, .025, .26, .025, brass);   // cap + frame bars
      B.add(.2, .38, 0, .2, .26, .2, glow, .5); B.add(.2, .44, 0, .1, .14, .1, core); B.add(.2, .34, 0, .24, .04, .24, brass); B.add(.2, .3, 0, .08, .04, .08, brass);   // glass, glowing core, base
      B.add(.2, .38, 0, .5, .4, .5, glow, .13);                                                                              // glow halo
      B.add(-.2, .06, .1, .1, .12, .1, '#4e7a34'); B.add(-.24, .1, .08, .06, .1, .06, '#6fae48'); B.add(-.15, .06, .16, .05, .06, .05, '#f06595');   // grass tuft + flower
    },
    totem(B, moss, mint, dark) {
      const stone = '#c3cad2', stoneD = '#a2abb5', eye = '#2a3038';
      B.add(0, 0, 0, .5, .24, .44, stoneD); B.add(0, .24, 0, .44, .04, .4, stone);                                                  // base
      B.add(-.1, .08, .225, .07, .07, .02, eye); B.add(.1, .08, .225, .07, .07, .02, eye); B.add(0, .13, .225, .18, .04, .02, eye);   // carved face (bottom)
      B.add(0, .28, 0, .4, .26, .36, stone); B.add(-.08, .4, .185, .08, .06, .02, mint); B.add(.08, .4, .185, .08, .06, .02, mint); B.add(0, .32, .185, .14, .05, .02, eye);   // middle tier, glowing eyes
      B.add(-.27, .34, 0, .12, .12, .2, stoneD); B.add(.27, .34, 0, .12, .12, .2, stoneD);                                           // side wings
      B.add(0, .54, 0, .34, .26, .3, stoneD); B.add(-.07, .64, .155, .07, .07, .02, mint); B.add(.07, .64, .155, .07, .07, .02, mint); B.add(0, .58, .155, .1, .04, .02, eye);   // top tier
      B.add(0, .8, 0, .26, .08, .22, stone); B.add(0, .88, 0, .16, .08, .14, stoneD); B.add(0, .96, 0, .06, .1, .06, moss);          // crown spike
      B.add(0, .24, 0, .46, .05, .42, moss); B.add(.1, .54, .05, .2, .04, .22, moss); B.add(-.12, .8, 0, .12, .04, .1, moss); B.add(.14, .8, .02, .1, .04, .1, dark);   // moss caps
      B.add(-.2, .1, .225, .04, .18, .03, moss); B.add(.2, .3, .185, .03, .14, .03, moss); B.add(-.15, .3, .185, .03, .1, .03, dark); B.add(.1, .54, .155, .03, .12, .03, moss);   // hanging vines
      B.add(.28, 0, .18, .08, .08, .08, mint); B.add(-.3, 0, .15, .1, .1, .1, moss);                                              // leaf sprouts
    },
    hammock(B, leaf, light, dark) {
      const trunk = '#7a5230';
      for (const x of [-.44, .44]) { B.add(x, 0, 0, .09, .66, .09, trunk); B.add(x, .64, 0, .14, .05, .14, dark); B.add(x, .69, 0, .2, .04, .08, leaf); B.add(x, .69, 0, .08, .04, .2, leaf); B.add(x, .72, 0, .06, .06, .06, light); }   // palm posts + frond tops
      const sag = [.5, .42, .36, .33, .33, .36, .42, .5];   // hammock curve: ends high, middle low
      sag.forEach((y, i) => { const x = -.37 + i * .105; B.add(x, y, 0, .115, .05, .34, i % 2 ? leaf : light); B.add(x, y + .02, .17, .115, .04, .03, dark); B.add(x, y + .02, -.17, .115, .04, .03, dark); });
      B.add(-.4, .5, 0, .06, .18, .03, '#e9dfc8'); B.add(.4, .5, 0, .06, .18, .03, '#e9dfc8');                                       // ropes
      B.add(-.2, .39, 0, .16, .06, .2, '#fff3bf'); B.add(0, .35, .02, .3, .03, .2, darken(leaf, .15));                              // pillow + blanket
      B.add(-.1, 0, .22, .1, .08, .1, '#4e7a34'); B.add(.3, 0, -.2, .1, .12, .1, '#6fae48'); B.add(.36, .1, -.2, .04, .05, .04, '#f06595');   // ground plants
    },
    piano(B, m, a, d) { [[-.36, -.18], [.36, -.18], [-.36, .22], [.36, .22]].forEach(([x, z]) => B.add(x, 0, z, .07, .28, .07, d)); B.add(0, .28, -.05, .88, .34, .4, d); B.add(0, .62, -.05, .92, .04, .44, a); B.add(0, .28, .2, .82, .05, .16, '#fff'); [-.3, -.18, .06, .18, .3].forEach(x => B.add(x, .33, .2, .04, .03, .09, '#222')); B.add(0, .4, .12, .6, .14, .02, m); },
    door(B, m, a, d) { B.add(0, 0, 0, .52, 1.05, .1, m); B.add(0, 0, .02, .46, .98, .06, lighten(m, .08)); B.add(.16, .42, .08, .05, .1, .04, a); B.add(0, 1.05, 0, .58, .06, .14, d); },
    gate(B, m, a, d) { B.add(-.38, 0, 0, .08, .7, .08, d); B.add(.38, 0, 0, .08, .7, .08, d); B.add(0, .55, 0, .8, .06, .06, m); B.add(0, .28, 0, .8, .06, .06, m); B.add(-.12, 0, 0, .06, .55, .06, a); B.add(.12, 0, 0, .06, .55, .06, a); B.add(0, .7, 0, .2, .12, .06, a); },
    wall(B, m, a, d) { B.add(0, 0, 0, .92, .9, .18, m); B.add(0, .9, 0, .96, .06, .22, a); for (let y = .15; y < .85; y += .18) B.add(0, y, .1, .94, .02, .01, d); },
    window(B, m, a, d) { B.add(0, .1, 0, .7, .7, .1, m); B.add(0, .16, .05, .56, .56, .02, '#a8d8f0', .85); B.add(0, .42, .06, .56, .04, .02, a); B.add(0, .16, .06, .04, .56, .02, a); B.add(0, .1, 0, .74, .06, .14, d); B.add(0, .8, 0, .74, .06, .14, d); },
    roof(B, m, a, d) { B.add(0, .35, 0, .95, .12, .7, m); B.add(0, .47, 0, .7, .12, .5, a); B.add(0, .59, 0, .4, .12, .3, lighten(a, .1)); B.add(0, 0, 0, .2, .35, .2, d); },
    hedge(B, m, a, d) { B.add(0, 0, 0, .7, .45, .35, m); B.add(0, .35, 0, .55, .3, .28, a); B.add(-.2, .5, .05, .2, .18, .18, lighten(a, .1)); B.add(.18, .48, -.05, .22, .2, .2, d); },
    counter(B, m, a, d) { [[-.36, -.14], [.36, -.14], [-.36, .14], [.36, .14]].forEach(([x, z]) => B.add(x, 0, z, .08, .42, .08, d)); B.add(0, .42, 0, .86, .1, .42, m); B.add(0, .52, 0, .7, .02, .34, a); B.add(-.2, .1, .22, .28, .28, .02, lighten(m, .1)); },
    sink(B, m, a, d) { B.add(0, 0, 0, .55, .42, .42, m); B.add(0, .42, 0, .48, .08, .36, a); B.add(0, .5, 0, .34, .06, .24, '#8fd3f4'); B.add(0, .56, -.1, .06, .16, .06, d); B.add(0, .7, -.1, .14, .04, .06, d); },
    stove(B, m, a, d) { B.add(0, 0, 0, .62, .48, .5, m); B.add(0, .48, 0, .58, .04, .46, '#2b2b2b'); [[-.16, -.1], [.16, -.1], [-.16, .1], [.16, .1]].forEach(([x, z]) => B.add(x, .52, z, .16, .03, .16, d)); B.add(.2, .2, .26, .08, .12, .02, a); B.add(-.15, .15, .26, .2, .16, .02, '#1d1a1a'); },
    toilet(B, m, a, d) { B.add(0, 0, .05, .36, .28, .4, m); B.add(0, .28, .05, .32, .08, .34, '#f8f9fa'); B.add(0, .36, -.15, .36, .42, .2, a); B.add(0, .78, -.15, .4, .06, .24, d); },
    // ---- 4x4-tile showpieces (models span about ±1.9 tiles) ----
    gazebo(B, m, a, d) {
      const floor = lighten(m, .18), trim = lighten(a, .25);
      B.add(0, 0, 0, 3.8, .14, 3.8, darken(floor, .12)); B.add(0, .14, 0, 3.5, .08, 3.5, floor);                       // base + deck
      for (let i = 0; i < 3; i++) B.add(0, i * .05, 1.95 + (2 - i) * .0, 1.1 - i * .08, .05, .22 + i * .0, lighten(floor, .06));   // front steps
      B.add(0, 0, 2.03, 1.2, .05, .22, darken(floor, .08));
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { B.add(x, .22, z, .24, .1, .24, d); B.add(x, .32, z, .16, 1.9, .16, a); B.add(x, 2.2, z, .24, .1, .24, trim); }   // posts
      for (const x of [-.8, 0.8]) B.add(x, .66, 1.6, 1.0, .08, .06, a);                                              // front rails (door gap in the middle)
      B.add(0, .66, -1.6, 3.2, .08, .06, a); B.add(-1.6, .66, 0, .06, .08, 3.2, a); B.add(1.6, .66, 0, .06, .08, 3.2, a);
      for (let i = -3; i <= 3; i++) { if (Math.abs(i) < 1) continue; B.add(i * .4, .28, 1.6, .05, .38, .05, trim); }
      for (let i = -3; i <= 3; i++) { B.add(i * .4, .28, -1.6, .05, .38, .05, trim); B.add(-1.6, .28, i * .4, .05, .38, .05, trim); B.add(1.6, .28, i * .4, .05, .38, .05, trim); }
      B.add(0, 2.3, 0, 3.9, .14, 3.9, d); B.add(0, 2.44, 0, 3.4, .16, 3.4, m); B.add(0, 2.6, 0, 2.7, .16, 2.7, lighten(m, .08)); B.add(0, 2.76, 0, 2.0, .16, 2.0, m);   // roof tiers
      B.add(0, 2.92, 0, 1.3, .16, 1.3, lighten(m, .08)); B.add(0, 3.08, 0, .8, .16, .8, m); B.add(0, 3.24, 0, .3, .3, .3, '#f2b632'); B.add(0, 3.54, 0, .08, .24, .08, '#f2b632');   // finial
      B.add(0, .22, -1.1, 2.4, .26, .5, darken(a, .05)); B.add(0, .48, -1.3, 2.4, .36, .1, darken(a, .05));          // bench along the back
      B.add(0, .22, .2, .9, .34, .9, a); B.add(0, .56, .2, 1.1, .06, 1.1, lighten(a, .2)); B.add(.15, .62, .2, .26, .1, .26, '#ffffff'); B.add(-.25, .62, .1, .2, .14, .2, '#e03131');   // little table + cup + flowers
      for (const x of [-1.55, 1.55]) { B.add(x, 1.75, 1.6, .1, .3, .1, '#ffe066'); }                                // lanterns
    },
    pool(B, m, a, d) {
      const deck = lighten(m, .3), edge = lighten(m, .5), water = '#52c3ee';
      for (const [x, z, w, dd] of [[0, 1.8, 4, .4], [0, -1.8, 4, .4], [1.8, 0, .4, 3.2], [-1.8, 0, .4, 3.2]]) { B.add(x, 0, z, w, .22, dd, deck); B.add(x, .22, z, w, .04, dd, edge); }   // deck ring
      B.add(0, 0, 0, 3.2, .16, 3.2, darken(water, .3)); B.add(0, .16, 0, 3.2, .02, 3.2, water, .9);                  // pool bed + water
      B.add(0, .08, 0, 3.2, .09, .12, '#ffffff', .35);
      for (let i = -3; i <= 3; i += 2) B.add(i * .42, .17, 0, .1, .02, 3.1, '#bfeaff', .55);                         // lane shimmer
      for (const x of [-.5, .5]) { B.add(x, .22, 1.4, .06, .02, .06, '#ffffff'); }
      B.add(-1.45, .22, 1.35, .05, .55, .05, '#dfe5ea'); B.add(-1.2, .22, 1.35, .05, .55, .05, '#dfe5ea'); B.add(-1.33, .7, 1.35, .3, .04, .05, '#dfe5ea');   // ladder
      B.add(0, .22, -1.55, .5, .24, .5, d); B.add(0, .46, -1.8, .34, .06, 1.0, a); B.add(0, .5, -.95, .34, .04, .5, a);    // diving board
      B.add(1.25, .17, -.5, .46, .1, .46, '#ffffff'); B.add(1.25, .17, -.5, .3, .1, .3, '#ffe066');  // float ring
      B.add(1.7, .26, 1.5, .5, .1, .26, '#ffe9c4'); B.add(1.7, .36, 1.65, .5, .22, .06, '#ffe9c4'); B.add(1.5, .26, 1.5, .08, .1, .26, a);   // lounger
      B.add(-1.7, .26, -1.5, .08, 1.0, .08, '#a98255'); B.add(-1.7, 1.2, -1.5, .9, .07, .9, a); B.add(-1.7, 1.27, -1.5, .5, .07, .5, lighten(a, .3)); B.add(-1.7, 1.34, -1.5, .1, .1, .1, '#a98255');   // parasol
    },
    windmill(B, m, a, d) {
      const brick = lighten(m, .22), cap = d, door = darken(m, .35);
      B.add(0, 0, 0, 3.0, .18, 3.0, '#9aa0a6');                                                                        // stone foundation
      B.add(0, .18, 0, 2.5, .8, 2.5, brick); B.add(0, .98, 0, 2.2, .8, 2.2, lighten(brick, .05)); B.add(0, 1.78, 0, 1.9, .8, 1.9, brick); B.add(0, 2.58, 0, 1.6, .7, 1.6, lighten(brick, .05));   // tapering tower
      for (const y of [.5, 1.3, 2.1]) B.add(0, y, 0, [2.56, 2.26, 1.96][[.5, 1.3, 2.1].indexOf(y)], .08, [2.56, 2.26, 1.96][[.5, 1.3, 2.1].indexOf(y)], a);   // timber bands
      B.add(0, 3.28, 0, 1.9, .16, 1.9, cap); B.add(0, 3.44, 0, 1.5, .3, 1.5, m); B.add(0, 3.74, 0, .9, .3, .9, lighten(m, .1)); B.add(0, 4.04, 0, .3, .3, .3, a);   // cap roof
      B.add(0, .18, 1.27, .8, 1.05, .1, door); B.add(0, 1.0, 1.27, .8, .14, .12, a); B.add(.25, .56, 1.34, .08, .08, .05, '#f2b632');   // door + lintel + handle
      for (const [x, y] of [[0, 1.5], [0, 2.4]]) { B.add(x, y, 1.0, .5, .5, .08, a); B.add(x, y + .04, 1.04, .38, .42, .05, '#a8d8f0', .9); B.add(x, y + .22, 1.06, .38, .04, .05, a); }   // windows
      B.add(0, 3.1, .85, .22, .22, .5, '#5a3b22');                                                                      // axle hub block
      B.add(-1.05, .18, 1.3, .3, .3, .3, '#e8b84a'); B.add(-.8, .18, 1.5, .3, .22, .26, '#d9a43a'); B.add(1.15, .18, 1.35, .24, .24, .24, '#5f8f3f');   // sacks + shrub
    },
  };
  const furnCache = {};
  function furnModel(f) {
    if (furnCache[f.id]) return furnCache[f.id];
    const B = mk(); F[f.shape](B, f.pal[0], f.pal[1], f.pal[2]);
    let top = 0; for (const b of B) if (b.a === undefined || b.a > .5) top = Math.max(top, b.y + b.h);
    const sh = f.shape, v = f.v;
    const dyn = (sh === 'fireplace' || sh === 'lantern' || sh === 'fountain' || sh === 'aquarium' || sh === 'clock' || sh === 'tv' || sh === 'windmill' || sh === 'pool' || (v >= 2 && !f.size)) ? t => {
      const D = mk();
      if (sh === 'fireplace') { const s = Math.sin(t * 7); D.add(-.06, .08, .19, .12, .2 + .06 * s, .06, '#ff7a2a'); D.add(.07, .08, .19, .12, .14 - .05 * s, .06, '#ff7a2a'); D.add(0, .1, .19, .08, .12 + .08 * s, .05, '#ffd24d'); }
      else if (sh === 'fountain') for (let k = 0; k < 4; k++) { const u = (t * .9 + k / 4) % 1; D.add(Math.cos(k * 1.57) * .25 * u, .78 + .5 * Math.sin(u * Math.PI), Math.sin(k * 1.57) * .25 * u, .05, .05, .05, '#bfe8fb'); }
      else if (sh === 'aquarium') { const x = Math.sin(t * 1.3) * .2; D.add(x, .45, .02, .1, .07, .06, f.pal[1]); D.add(x - Math.sign(Math.cos(t * 1.3)) * .07, .46, .02, .04, .05, .05, f.pal[1]); }
      else if (sh === 'clock') D.add(Math.sin(t * 3) * .04, .24, .145, .08, .08, .015, f.pal[1]);
      else if (sh === 'lantern') for (let k = 0; k < 3; k++) { const ang = t * 1.4 + k * 2.1; D.add(.2 + Math.cos(ang) * .22, .38 + Math.sin(ang * 1.3 + k) * .16, Math.sin(ang) * .22, .035, .035, .035, '#fff59d'); }
      else if (sh === 'tv') D.add(Math.sin(t * 2) * .28, .2 + (Math.sin(t * 3.1) + 1) * .14, .075, .06, .06, .01, '#fff');
      if (sh === 'windmill') {
        const ang = t * .9;
        for (let k = 0; k < 4; k++) { const th = ang + k * Math.PI / 2, cx = Math.cos(th), cy = Math.sin(th);
          for (let i = 1; i <= 8; i++) { const r = i * .22; D.add(cx * r, 3.1 + cy * r, 1.2, .16, .16, .1, '#6b4a2b'); if (i > 3) D.add(cx * r - cy * .2, 3.1 + cy * r + cx * .2, 1.22, .22, .22, .05, f.pal[1]); } }
        D.add(0, 3.0, 1.18, .3, .3, .16, '#f2b632');
      } else if (sh === 'pool') { for (let k = 0; k < 5; k++) { const u2 = (t * .35 + k * .2) % 1; D.add(-1.2 + k * .6 + Math.sin(t * 2 + k) * .1, .19, -1.2 + u2 * 2.4, .32, .015, .06, '#e8f9ff', .7); } }
      if (v >= 2 && !f.size) { const b = Math.sin(t * 3) * .03; D.add(.28, top + .08 + b, -.2, .07, .07, .07, v === 3 ? '#ffe066' : '#ffffff'); if (v === 3) D.add(-.3, top - .1 - b, .2, .06, .06, .06, '#ffe066'); }
      return D;
    } : null;
    return (furnCache[f.id] = { boxes: B, h: top, dyn });
  }


  // ---- scenery: layered trees, pines, shrubs, tufts, wildflowers (HD-2D "painted" foliage) ----
  function tree(kind) {
    const B = mk(), k = kind | 0;
    if (k === 2) {   // pine
      B.add(0, 0, 0, .22, .5, .22, '#6b4423'); B.add(0, .02, 0, .32, .1, .32, '#5a3a1c');
      const L = [['#1f6b3a', 1.0, .3], ['#2a7d42', .82, .3], ['#35914b', .64, .3], ['#43a653', .46, .28], ['#5bbd62', .28, .26]];
      L.forEach(([c, w, hh], i) => { B.add(0, .38 + i * .26, 0, w, hh, w, c); B.add(-w * .22, .38 + i * .26 + .06, w * .3, w * .3, .1, .1, lighten(c, .18)); });
      B.add(0, 1.62, 0, .1, .22, .1, '#7ad06f');
      return B;
    }
    const c0 = k ? ['#2c7a3c', '#3c9a46', '#58b94f', '#86d870'] : ['#2f7d3a', '#43a047', '#5cb85c', '#8be07a'];
    B.add(0, 0, 0, .3, .12, .3, '#5a3a1c'); B.add(0, 0, 0, .2, .75, .2, '#7a5230'); B.add(.05, .3, .0, .06, .3, .21, '#6b4423');   // trunk + root flare + bark shade
    B.add(0, .62, 0, 1.0, .3, .9, c0[0]);                                  // underside / shadowed layer
    B.add(-.34, .72, .1, .5, .34, .5, c0[0]); B.add(.34, .74, -.1, .5, .36, .5, c0[1]);   // side lobes
    B.add(0, .84, 0, .86, .34, .8, c0[1]);                                 // main mass
    B.add(-.22, 1.02, -.05, .5, .3, .5, c0[2]); B.add(.24, 1.0, .1, .44, .3, .44, c0[1]);
    B.add(0, 1.2, 0, .5, .26, .46, c0[2]);                                 // crown
    B.add(-.18, 1.36, -.1, .28, .14, .26, c0[3]); B.add(.05, 1.2, .2, .2, .08, .1, c0[3]); B.add(-.4, .98, .2, .16, .08, .12, c0[3]);   // sunlit leaves
    B.add(.3, .62, .28, .12, .1, .12, '#e84a4a'); B.add(-.2, .78, .34, .1, .1, .1, '#e84a4a');   // little red fruit
    return B;
  }
  function shrub(k) {
    const B = mk(), g = ['#3b8f43', '#4fae4a', '#7bd36c'];
    B.add(0, 0, 0, .56, .2, .46, g[0]); B.add(-.14, .12, .02, .3, .22, .3, g[1]); B.add(.14, .1, -.02, .32, .2, .3, g[1]); B.add(0, .24, 0, .2, .1, .2, g[2]);
    if (k) { const fc = ['#ff6fa5', '#ffd43b', '#ffffff']; [[-.16, .16], [.12, .12], [.0, -.14]].forEach(([x, z], n) => B.add(x, .24, z, .08, .08, .08, fc[n])); }
    return B;
  }
  function tuft(k) {
    const B = mk(), g = ['#4a9d3a', '#6bbb4a', '#8ad35c', '#3b8a34'];
    [[-.08, -.02, .2], [.0, .05, .28], [.08, -.03, .22], [.04, -.08, .16], [-.05, .06, .15]].forEach(([x, z, h], i) => B.add(x, 0, z, .045, h, .045, g[(i + k) % 4]));
    return B;
  }
  function wildflower(k) {
    const B = mk(), cols = ['#ff6fa5', '#ffd43b', '#ffffff', '#8ecbff', '#ff8a5c'], c = cols[k % cols.length];
    B.add(0, 0, 0, .3, .1, .3, '#4fae44');
    [[-.08, -.06], [.1, .04], [0, .1]].forEach(([x, z], i) => { B.add(x, .08, z, .03, .14 + i * .04, .03, '#3b8a34'); B.add(x, .22 + i * .04, z, .1, .08, .1, c); B.add(x, .27 + i * .04, z, .04, .04, .04, '#ffe066'); });
    return B;
  }
  function stallBoxes(kind) {
    const B = mk();
    B.add(0, 0, 0, .95, .1, .65, '#8a5a2b');
    B.add(0, .1, 0, .88, .55, .58, '#fff4d6');
    B.add(0, .72, 0, 1.12, .1, .78, '#a8c4e0');
    B.add(0, .82, 0, .95, .05, .65, '#fffaf0');
    B.add(-.42, .1, .3, .1, .55, .1, '#c9a88a'); B.add(.42, .1, .3, .1, .55, .1, '#c9a88a');
    if (kind === 'lemonade') { B.add(0, .28, .3, .22, .28, .14, '#ffe9a8'); B.add(0, .55, .3, .14, .1, .14, '#fffaf0'); B.add(0, .22, .36, .08, .08, .04, '#ffc9a0'); }
    else if (kind === 'flowers') { [[-.22, .38], [0, .44], [.22, .38]].forEach(([x, y], i) => { B.add(x, y, .32, .12, .12, .12, i === 1 ? '#f7b0c8' : '#ffd0e0'); B.add(x, y - .1, .32, .05, .12, .05, '#8fd9a0'); }); }
    else if (kind === 'craft') { B.add(0, .22, .3, .38, .2, .2, '#d8dde4'); B.add(0, .44, .3, .22, .16, .16, '#b0b8c4'); }
    else if (kind === 'bakery') { B.add(0, .28, .32, .3, .14, .18, '#f0d0a0'); B.add(0, .42, .32, .2, .1, .14, '#f8e4c0'); B.add(0, .52, .32, .12, .08, .1, '#fffaf0'); }
    else { B.add(0, .26, .3, .32, .24, .16, '#a8c4f0'); B.add(0, .5, .3, .2, .14, .12, '#ffe9a8'); }
    return B;
  }
  // casino tables (1.8 wide) — green felt, wooden rails
  function rouletteBoxes() {
    const B = mk();
    B.add(0, 0, 0, 1.7, .5, 1.05, '#5a3a1c');                 // base
    B.add(0, .5, 0, 1.85, .09, 1.2, '#7a5230');               // rail
    B.add(.3, .59, 0, 1.15, .03, .98, '#1f8a4c');             // felt
    // wheel (stacked squares read as a disc from the angled camera)
    B.add(-.62, .59, 0, .62, .07, .62, '#2b1a0c').add(-.62, .66, 0, .5, .03, .5, '#c9a227').add(-.62, .69, 0, .42, .03, .42, '#c0392b').add(-.62, .72, 0, .3, .03, .3, '#1c1c1c').add(-.62, .75, 0, .13, .06, .13, '#f0d060');
    // number strip + chips
    for (let i = 0; i < 6; i++) B.add(.02 + i * .2, .62, .3, .16, .02, .14, i % 2 ? '#1c1c1c' : '#c0392b');
    B.add(.55, .62, -.2, .1, .05, .1, '#f5f5f5').add(.55, .67, -.2, .1, .05, .1, '#e74c3c').add(.3, .62, -.25, .1, .06, .1, '#3498db');
    return B;
  }
  function blackjackBoxes() {
    const B = mk();
    B.add(0, 0, 0, 1.7, .5, 1.05, '#5a3a1c');
    B.add(0, .5, 0, 1.85, .09, 1.2, '#7a5230');
    B.add(0, .59, 0, 1.7, .03, 1.02, '#1f8a4c');
    B.add(0, .62, -.34, .5, .02, .16, '#166d3a');            // dealer zone
    for (const x of [-.55, 0, .55]) B.add(x, .62, .2, .26, .015, .26, '#2fa863');   // bet circles
    B.add(-.12, .62, -.06, .13, .015, .18, '#ffffff').add(.04, .62, -.06, .13, .015, .18, '#fff8e1').add(.02, .635, -.06, .05, .005, .05, '#c0392b');   // cards
    B.add(.55, .62, .2, .1, .05, .1, '#1c1c1c').add(.55, .67, .2, .1, .05, .1, '#f1c40f').add(-.55, .62, .2, .1, .06, .1, '#e74c3c');
    return B;
  }
  function penFence(w, h) {
    const B = mk();
    const post = '#f1f3f5', rail = '#dee2e6';
    for (let i = 0; i <= w; i++) { B.add(i - w / 2, 0, -h / 2, .09, .4, .09, post); B.add(i - w / 2, 0, h / 2, .09, .4, .09, post); }
    for (let j = 0; j <= h; j++) { B.add(-w / 2, 0, j - h / 2, .09, .4, .09, post); B.add(w / 2, 0, j - h / 2, .09, .4, .09, post); }
    B.add(0, .14, -h / 2, w, .05, .05, rail); B.add(0, .28, -h / 2, w, .05, .05, rail);
    B.add(0, .14, h / 2, w, .05, .05, rail); B.add(0, .28, h / 2, w, .05, .05, rail);
    B.add(-w / 2, .14, 0, .05, .05, h, rail); B.add(w / 2, .14, 0, .05, .05, h, rail);
    B.add(-w / 2, .28, 0, .05, .05, h, rail); B.add(w / 2, .28, 0, .05, .05, h, rail);
    return B;
  }
  function animalBoxes(kind) {
    const B = mk();
    if (kind === 'chicken') {
      B.add(0, .14, 0, .26, .22, .24, '#fffaf5'); B.add(0, .34, 0, .2, .14, .2, '#fffaf5');
      B.add(.14, .24, 0, .12, .1, .1, '#ffc9a0'); B.add(0, .46, 0, .1, .08, .1, '#f2a8a8');
      B.add(-.07, .38, .12, .05, .05, .03, '#8a7a70'); B.add(.05, .38, .12, .05, .05, .03, '#8a7a70');
      B.add(-.07, 0, .06, .06, .14, .06, '#ffe9a8'); B.add(.07, 0, .06, .06, .14, .06, '#ffe9a8');
    } else if (kind === 'cow') {
      B.add(0, .22, 0, .5, .34, .3, '#faf8f5');
      B.add(-.12, .28, 0, .14, .14, .32, '#c8c0b8'); B.add(.16, .3, -.06, .12, .12, .12, '#c8c0b8');
      B.add(-.22, .4, .06, .18, .18, .18, '#faf8f5'); B.add(-.32, .46, .06, .06, .06, .06, '#ffc9a0');
      B.add(-.26, .48, .12, .05, .05, .03, '#8a7a70'); B.add(-.18, .48, .12, .05, .05, .03, '#8a7a70');
      [[-.16, 0], [.16, 0], [-.16, .16], [.16, .16]].forEach(([x, z]) => B.add(x, 0, z, .08, .22, .08, '#b0a8a0'));
    } else {
      // fluffy sheep
      B.add(0, .2, 0, .4, .32, .28, '#fffaf5'); B.add(0, .22, 0, .28, .22, .2, '#f5f0ea');
      B.add(-.2, .34, 0, .16, .16, .16, '#c8c0b8'); B.add(-.26, .4, .04, .05, .05, .05, '#ffc9a0');
      B.add(-.24, .42, .1, .04, .04, .03, '#fffaf5'); B.add(-.16, .42, .1, .04, .04, .03, '#fffaf5');
      B.add(0, .48, -.02, .1, .12, .1, '#d0c8c0');
      [[-.14, 0], [.14, 0], [-.14, .14], [.14, .14]].forEach(([x, z]) => B.add(x, 0, z, .07, .18, .07, '#b8b0a8'));
    }
    return B;
  }
  function petBoxes(kind) {
    const B = mk();
    if (kind === 'pet_dog') {
      B.add(0, .14, 0, .32, .22, .22, '#e8c9a8'); B.add(-.18, .24, 0, .16, .16, .16, '#e8c9a8');
      B.add(-.22, .32, .08, .05, .05, .04, '#8a7a70'); B.add(-.14, .32, .08, .05, .05, .04, '#8a7a70');
      B.add(-.24, .2, -.02, .1, .08, .05, '#d4b090'); B.add(.18, .22, 0, .06, .06, .18, '#e8c9a8');
      [[-.1, .08], [.1, .08], [-.1, -.06], [.1, -.06]].forEach(([x, z]) => B.add(x, 0, z, .07, .14, .07, '#d4b090'));
    } else if (kind === 'pet_cat') {
      B.add(0, .12, 0, .28, .18, .18, '#c8c4d0'); B.add(-.14, .22, 0, .14, .14, .14, '#c8c4d0');
      B.add(-.18, .34, -.05, .06, .1, .05, '#c8c4d0'); B.add(-.18, .34, .05, .06, .1, .05, '#c8c4d0');
      B.add(-.18, .28, .08, .04, .04, .03, '#8a7a70'); B.add(-.1, .28, .08, .04, .04, .03, '#8a7a70');
      B.add(.16, .18, 0, .06, .06, .16, '#d8d4e0');
      [[-.08, .06], [.1, .06], [-.08, -.06], [.1, -.06]].forEach(([x, z]) => B.add(x, 0, z, .06, .12, .06, '#b0a8b8'));
    } else {
      B.add(0, .12, 0, .24, .18, .18, '#fffaf5'); B.add(-.12, .2, 0, .14, .14, .14, '#fffaf5');
      B.add(-.16, .26, 0, .08, .08, .05, '#ffd0d8'); B.add(-.16, .26, .08, .04, .04, .03, '#8a7a70'); B.add(-.08, .26, .08, .04, .04, .03, '#8a7a70');
      B.add(.14, .16, 0, .06, .06, .12, '#fffaf5');
      [[-.06, .06], [.08, .06], [-.06, -.06], [.08, -.06]].forEach(([x, z]) => B.add(x, 0, z, .05, .12, .05, '#ffd0d8'));
    }
    return B;
  }
  function bushBoxes() {
    const B = mk();
    B.add(0, 0, 0, .55, .38, .55, '#8fd9a0'); B.add(0, .22, 0, .44, .32, .44, '#a8e6b4');
    B.add(.12, .38, .06, .22, .2, .22, '#c0f0c8'); B.add(-.14, .3, -.12, .18, .16, .18, '#7cc890');
    B.add(.18, .28, -.14, .14, .12, .14, '#98e0a8');
    return B;
  }
  function shopBox(w, h, d, roof) {
    const B = mk();
    const roofC = roof || '#9bb8d8';
    B.add(0, 0, 0, w, h, d, '#fff8e8');
    B.add(0, h, 0, w + .35, .14, d + .35, roofC);
    B.add(0, h + .14, 0, w + .1, .08, d + .1, '#fffaf0');
    // timber beams (HD-2D half-timber cue)
    B.add(-w * .28, .2, d / 2 - .02, .08, h - .25, .06, '#d4b090');
    B.add(w * .28, .2, d / 2 - .02, .08, h - .25, .06, '#d4b090');
    B.add(0, h * .45, d / 2 - .02, w - .1, .07, .06, '#d4b090');
    B.add(0, .05, d / 2 + .02, .42, .7, .08, '#d4b090');
    B.add(.14, .4, d / 2 + .06, .08, .1, .04, '#ffe9a8');
    [[-w * .28, .55], [w * .28, .55]].forEach(([x, y]) => {
      B.add(x, y, d / 2, .5, .42, .06, '#d4b090');
      B.add(x, y + .04, d / 2 + .04, .4, .32, .04, '#c8e0f0');
    });
    B.add(0, h * .55, -d / 2, w * .55, .35, .08, '#a8c4e0');
    return B;
  }
  function slideBoxes() {
    const B = mk();
    B.add(0, 0, 0, .5, .08, .9, '#adb5bd');
    B.add(-.15, .08, -.2, .12, .7, .12, '#868e96');
    B.add(.15, .08, -.2, .12, .7, .12, '#868e96');
    for (let i = 0; i < 6; i++) B.add(0, .08 + i * .1, -.15 + i * .12, .42, .06, .22, i % 2 ? '#4dabf7' : '#74c0fc');
    B.add(0, .7, -.25, .5, .08, .35, '#ffd43b');
    return B;
  }
  function parkBench() {
    const B = mk();
    B.add(0, .22, 0, .7, .06, .28, '#a0703c');
    B.add(0, .08, -.12, .7, .28, .06, '#8a5a2b');
    B.add(-.28, 0, .08, .08, .22, .08, '#7a5230'); B.add(.28, 0, .08, .08, .22, .08, '#7a5230');
    return B;
  }
  function landPost() {
    const B = mk();
    B.add(0, 0, 0, .12, .7, .12, '#7a5230');
    B.add(0, .72, 0, .55, .38, .08, '#f8e8c8');
    B.add(0, .72, .05, .48, .3, .02, '#fff8e1');
    return B;
  }
  // Model home: base stays solid; shell (walls/roof) can fade when player is inside
  function modelHomeBase() {
    const B = mk();
    const trim = '#8a5a2b';
    B.add(0, 0, -.2, 5.8, .14, 4.6, '#9a7048');
    B.add(0, .14, -.2, 5.5, .05, 4.3, '#f0dcb0');
    // porch + path (always opaque)
    B.add(0, .05, 2.55, 2.6, .12, 1.05, '#d4a574');
    B.add(-1.1, .1, 2.95, .14, .8, .14, '#fff');
    B.add(1.1, .1, 2.95, .14, .8, .14, '#fff');
    B.add(0, .88, 2.95, 2.4, .1, .8, '#a0703c');
    [[0, 3.45], [-.35, 3.75], [.3, 3.95]].forEach(([x, z]) => B.add(x, 0, z, .38, .06, .3, '#ced4da'));
    return B;
  }
  function modelHomeShell(alpha) {
    const B = mk();
    const a = alpha == null ? 1 : alpha;
    const wall = '#fffaf0', trim = '#fffaf5', roof = '#9bb8d8', glass = '#c8e0f0', wood = '#d4b090';
    // walls — cream barn cottage
    B.add(0, .2, -2.25, 5.5, 1.65, .24, wall, a);
    B.add(-2.65, .2, -.2, .24, 1.65, 4.3, wall, a);
    B.add(2.65, .2, -.2, .24, 1.65, 4.3, wall, a);
    B.add(-1.75, .2, 1.95, 2.0, 1.65, .24, wall, a);
    B.add(1.75, .2, 1.95, 2.0, 1.65, .24, wall, a);
    B.add(0, 1.3, 1.95, 1.55, .55, .24, wall, a);
    // door + windows with white trim
    B.add(0, .2, 2.0, .78, 1.12, .12, '#6b4423', a);
    B.add(.26, .72, 2.1, .08, .12, .05, '#f2b632', a);
    [[-1.55, -2.15], [1.55, -2.15], [-2.6, .15], [2.6, .15]].forEach(([x, z]) => {
      B.add(x, .55, z, .8, .65, .12, wood, a);
      B.add(x, .58, z, .88, .72, .08, trim, a);
      B.add(x, .62, z + (z < 0 ? .07 : -.07), .62, .5, .05, glass, Math.min(1, a + .15));
    });
    // gambrel-ish roof bands + white ridge
    B.add(0, 1.82, -.2, 5.9, .12, 4.6, wood, a);
    B.add(0, 1.92, -.2, 5.5, .14, 4.2, roof, a);
    B.add(0, 2.06, -.2, 4.2, .12, 3.2, roof, a);
    B.add(0, 2.18, -.2, 2.8, .1, 2.2, roof, a);
    B.add(0, 2.28, -.2, 1.4, .08, 1.2, trim, a);
    // tiny cupola cue
    B.add(0, 2.34, -.2, .35, .28, .35, wall, a);
    B.add(0, 2.62, -.2, .5, .08, .5, roof, a);
    return B;
  }
  function modelHomeCottage(alpha) {
    return modelHomeBase().concat(modelHomeShell(alpha == null ? 1 : alpha));
  }

  return { tree, shrub, tuft, wildflower, View, mk, charBoxes, plantBoxes, plantStage, sparkles, furnModel, renderIcon, darken, lighten, stallBoxes, penFence, animalBoxes, petBoxes, bushBoxes, shopBox, slideBoxes, parkBench, landPost, rouletteBoxes, blackjackBoxes, modelHomeCottage, modelHomeBase, modelHomeShell };
})();
