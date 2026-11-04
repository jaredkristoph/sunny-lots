'use strict';
/**
 * HD-2D renderer for Sunny Lots — Three.js 3D world + billboard sprites + DOF/bloom.
 * Consumes existing Vox box models for props; characters/animals are pixel billboards.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const TEX_CACHE = new Map();
const SPRITE_CACHE = new Map();

function parseHex(hex) {
  if (!hex || hex[0] !== '#') return [200, 200, 200, 1];
  let h = hex;
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const n = parseInt(h.slice(1, 7), 16);
  let a = 1;
  if (hex.startsWith('rgba')) {
    const m = hex.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
  }
  return [n >> 16, (n >> 8) & 255, n & 255, a];
}

function pixelTex(hex, size = 8) {
  const key = hex + ':' + size;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const [r, g, b] = parseHex(hex);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, size, size);
  // crunchy pixel variation
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (((x + y) & 1) === 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.04 + ((x * 3 + y) % 3) * 0.02})`;
      ctx.fillRect(x, y, 1, 1);
    } else if ((x * 5 + y * 7) % 5 === 0) {
      ctx.fillStyle = `rgba(0,0,0,0.06)`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  TEX_CACHE.set(key, t);
  return t;
}

function matFor(hex, alpha) {
  const a = alpha == null ? 1 : alpha;
  const tex = pixelTex(hex || '#ccc');
  const m = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: 0x2a2a2a, emissiveMap: tex,   // lifts shaded sides / dark colours so furniture doesn't look muddy
    transparent: a < 0.99,
    opacity: a,
    depthWrite: a > 0.85,
    polygonOffset: true,
    polygonOffsetFactor: a < 0.99 ? -1 : 0,
    polygonOffsetUnits: a < 0.99 ? -1 : 0,
  });
  m.onBeforeCompile = patchDetail;
  return m;
}

/** HD-2D "texture without textures": every surface gets pixel-snapped world-space detail (constant 16 texels/tile) —
 *  grass blades + flowers, cobble stones, wood planks, grain noise, and a soft ground-contact darkening on side faces. */
function patchDetail(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec3 vWN;
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 an = abs(normalize(vWN));
  bool top = an.y > 0.6;
  vec2 q = top ? vWP.xz : (an.x > an.z ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y));
  vec2 px = floor(q * 16.0);
  float n1 = hh(px), n2 = hh(floor(q * 4.0) + 3.7);
  vec3 c = diffuseColor.rgb;
  float lum = dot(c, vec3(.3, .59, .11));
  bool green = c.g > c.r * 1.04 && c.g > c.b * 1.3;
  bool warm = c.r > c.g * 1.05 && c.g > c.b * 1.05;
  float shade = 1.0;
  vec3 flower = vec3(-1.0);
  if (top && green) {
    shade += (n1 - .5) * .12 + (n2 - .5) * .10;
    shade -= step(.76, hh(px + 11.0)) * .13;                 // dark blade pixels
    shade += step(.93, hh(px + 29.0)) * .11;                 // sunlit tips
    vec2 fc = floor(q * 6.0);
    if (hh(fc + 5.0) > .985) { float k = hh(fc + 9.0); flower = k < .34 ? vec3(1.0, .86, .35) : k < .67 ? vec3(1.0, .55, .75) : vec3(.97, .97, 1.0); }
  } else if (top && warm && lum > .45 && lum < .9) {          // cobble / sand lane
    vec2 cell = vec2(q.x * 3.0 + floor(q.y * 2.0) * .5, q.y * 2.0), f = fract(cell);
    float mort = min(step(f.x, .09) + step(f.y, .14), 1.0);
    shade -= mort * .22;
    shade += (1.0 - mort) * ((hh(floor(cell)) - .5) * .20 + (n1 - .5) * .07 + step(.86, hh(px + 3.0)) * .06 - step(.95, hh(px + 8.0)) * .12);   // per-stone tint, chips, pebbles
  } else if (!top && warm && lum < .75) {                   // wood planks
    float pl = fract(q.y * 4.0);
    shade -= step(pl, .07) * .16;
    shade += (hh(vec2(floor(q.y * 4.0), floor(q.x * 2.0))) - .5) * .10 + (n1 - .5) * .05;
  } else {
    shade += (n1 - .5) * .08 + (n2 - .5) * .05;
  }
  if (!top) shade *= mix(.80, 1.0, smoothstep(0.0, .45, vMapUv.y));
  diffuseColor.rgb *= shade;
  if (flower.x >= 0.0) diffuseColor.rgb = flower * .85;
}`);
}

/** Soft elliptical blob — classic HD-2D ground shadow. */
let _blobShadowTex = null;
function blobShadowTex() {
  if (_blobShadowTex) return _blobShadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(40,28,18,0.55)');
  grd.addColorStop(0.45, 'rgba(40,28,18,0.28)');
  grd.addColorStop(1, 'rgba(40,28,18,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(32, 32, 30, 18, 0, 0, Math.PI * 2);
  g.fill();
  _blobShadowTex = new THREE.CanvasTexture(c);
  _blobShadowTex.colorSpace = THREE.SRGBColorSpace;
  _blobShadowTex.needsUpdate = true;
  return _blobShadowTex;
}

/** Soft rounded cast-shadow shape: darkest in the middle, feathered edges, one flat tint (no radial "blob" look). */
let _castShadowTex = null;
function castShadowTex() {
  if (_castShadowTex) return _castShadowTex;
  const W = 128, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const layers = 9;
  for (let i = 0; i < layers; i++) {      // nested rounded rects = feathered edge, ~0.36 alpha at the core
    const inset = 3 + i * 5, r = Math.max(4, 34 - i * 3);
    g.fillStyle = 'rgba(36,26,52,0.04)';
    g.beginPath(); g.roundRect(inset, inset, W - inset * 2, H - inset * 2, r); g.fill();
  }
  _castShadowTex = new THREE.CanvasTexture(c);
  _castShadowTex.colorSpace = THREE.SRGBColorSpace;
  _castShadowTex.needsUpdate = true;
  return _castShadowTex;
}

/** 1px dark outline so paper-doll sprites read as flat 2D. */
function inkOutline(g, w, h) {
  const src = g.getImageData(0, 0, w, h);
  const dst = g.createImageData(w, h);
  const s = src.data, d = dst.data;
  for (let i = 0; i < s.length; i++) d[i] = s[i];
  const solid = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return s[(y * w + x) * 4 + 3] > 40;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
      const i = (y * w + x) * 4;
      d[i] = 55; d[i + 1] = 40; d[i + 2] = 28; d[i + 3] = 230;
    }
  }
  g.putImageData(dst, 0, 0);
}

/** Walk cycle frame: 0 idle, 1 left stride, 2 right stride. */
function walkFrame(phase, moving) {
  if (!moving) return 0;
  const s = Math.sin(phase);
  return s > 0.15 ? 1 : s < -0.15 ? 2 : 0;
}

/** Pattern accents for tops/bottoms on the 32x40 sprite (x,y,w,h = clothing rectangle; col = accent colour). */
function clothPattern(px, pat, x, y, w, h, col) {
  switch (pat) {
    case 'stripes': for (let j = 1; j < h; j += 3) px(x, y + j, w, 1, col); break;
    case 'dots': for (let j = 1; j < h; j += 3) for (let i = (j % 2 ? 1 : 3); i < w; i += 4) px(x + i, y + j, 1, 1, col); break;
    case 'check': for (let j = 0; j < h; j += 2) for (let i = (j % 4 ? 0 : 2); i < w; i += 4) px(x + i, y + j, 2, 2, col); break;
    case 'zigzag': for (let j = 1; j < h; j += 3) for (let i = 0; i < w; i += 2) px(x + i, y + j + ((i / 2) % 2), 1, 1, col); break;
    case 'stars': case 'heart': px(x + 2, y + 2, 1, 1, col); px(x + w - 4, y + 4, 1, 1, col); px(x + Math.floor(w / 2), y + h - 3, 1, 1, col); px(x + 3, y + h - 3, 1, 1, col); break;
    case 'vest': px(x + Math.floor(w / 2) - 1, y, 2, h, col); break;
    case 'collar': px(x + 3, y, w - 6, 1, col); px(x + 4, y + 1, w - 8, 1, col); break;
    default: break;
  }
}

/** Hats, drawn over the head (head spans x 9..23, y 4..19 on the 32x40 sprite; `lean` shifts with the walk frame). */
function drawHat(px, shape, c0, c1, lean) {
  const o = lean || 0, cx = 16 + o;
  switch (shape) {
    case 'headband': px(9 + o, 6, 14, 2, c0); px(9 + o, 6, 14, 1, c1); break;
    case 'cap': px(9 + o, 1, 14, 6, c0); px(7 + o, 6, 14, 2, c1); px(15 + o, 1, 2, 1, c1); break;
    case 'beanie': px(9 + o, 1, 14, 6, c0); px(9 + o, 6, 14, 2, c1); px(cx - 1, 0, 2, 2, c1); break;
    case 'straw': px(5 + o, 5, 22, 2, c0); px(10 + o, 1, 12, 5, c0); px(10 + o, 4, 12, 1, c1); break;
    case 'cowboy': px(5 + o, 5, 22, 2, c0); px(10 + o, 1, 12, 5, c0); px(10 + o, 4, 12, 1, c1); px(5 + o, 4, 2, 2, c0); px(25 + o, 4, 2, 2, c0); break;
    case 'party': for (let i = 0; i < 7; i++) px(cx - 1 - i, i, 2 + i * 2, 1, i % 3 === 2 ? c1 : c0); px(cx - 1, 0, 2, 1, c1); break;
    case 'chef': px(10 + o, 0, 12, 5, c0); px(9 + o, 2, 14, 4, c0); px(9 + o, 5, 14, 2, c1 === c0 ? '#dfe3e8' : c1); break;
    case 'cat': px(9 + o, 1, 4, 5, c0); px(19 + o, 1, 4, 5, c0); px(10 + o, 3, 2, 3, c1); px(20 + o, 3, 2, 3, c1); px(9 + o, 5, 14, 2, c0); break;
    case 'flowers': for (let i = 0; i < 5; i++) px(9 + o + i * 3, 4 + (i % 2), 3, 3, i % 2 ? c1 : c0); break;
    case 'helmet': px(9 + o, 1, 14, 6, c0); px(7 + o, 6, 18, 2, c0); px(15 + o, 1, 2, 5, c1); break;
    case 'tophat': px(6 + o, 5, 20, 2, c0); px(10 + o, 0, 12, 6, c0); px(10 + o, 4, 12, 1, c1); break;
    case 'wizard': for (let i = 0; i < 6; i++) px(cx - 1 - i, i, 2 + i * 2, 1, c0); px(6 + o, 6, 20, 2, c0); px(cx - 3, 4, 1, 1, c1); px(cx + 2, 5, 1, 1, c1); px(cx, 2, 1, 1, c1); break;
    case 'crown': px(10 + o, 3, 12, 4, c0); px(10 + o, 1, 2, 3, c0); px(15 + o, 0, 2, 4, c0); px(20 + o, 1, 2, 3, c0); px(12 + o, 4, 2, 1, c1); px(18 + o, 4, 2, 1, c1); break;
    default: break;
  }
}

/** Tiny procedural chibi pixel sprite (billboard). frame = 0/1/2 walk. Reflects skin, hair, top, bottom, shoes and hat. */
function makeCharSprite(avatar, cat, frame) {
  frame = frame | 0;
  const av = avatar || {};
  const skin = av.skin || '#f0c8a0';
  const hair = av.hairColor || '#5a3a1a';
  const C = (cat && cat.CLOTH) || {};
  const topD = C[av.top] || C.top_tee_white, botD = C[av.bottom] || C.bot_jeans, shoeD = C[av.shoes] || C.shoe_plain;
  const hatD = av.hat ? C[av.hat] : null;
  const top = topD ? topD.c[0] : '#7ec8e8', topAcc = topD ? topD.c[1] : top;
  const bot = botD ? botD.c[0] : '#6b8cae', botAcc = botD ? botD.c[1] : bot;
  const shoe = shoeD ? shoeD.c[0] : '#8a7060', shoeAcc = shoeD ? shoeD.c[1] : shoe;
  const key = ['ch', skin, hair, av.top, av.bottom, av.shoes, av.hat || '', av.gender, 'f' + frame].join(':');
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);

  const w = 32, h = 40;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const px = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
  // stride: opposite legs / arms
  const L = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  const R = -L;
  const aL = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const aR = -aL;
  const len = (botD && botD.len) || 'long';
  const legLen = (side) => 8 + (side > 0 ? -1 : 0);
  // legs: long pants colour the whole leg; shorts/skirts show skin below the hem
  for (const [lx, side] of [[11, L], [17, R]]) {
    const ly = 28 + (side < 0 ? 1 : 0), lh = legLen(side);
    px(lx, ly, 4, lh, len === 'long' ? bot : skin);
    if (len === 'long') clothPattern(px, botD && botD.pat, lx, ly, 4, lh, botAcc);
    else if (len === 'short') { px(lx, ly, 4, 4, bot); clothPattern(px, botD && botD.pat, lx, ly, 4, 4, botAcc); }
  }
  if (len === 'skirt') { px(9, 27, 14, 5, bot); clothPattern(px, botD && botD.pat, 9, 27, 14, 5, botAcc); }
  // shoes (colour + sole accent)
  px(10, 36 + (L > 0 ? 0 : L === 0 ? 0 : 1), 5, 3, shoe); px(17, 36 + (R > 0 ? 0 : R === 0 ? 0 : 1), 5, 3, shoe);
  if (av.shoes && av.shoes !== 'shoe_plain') { px(10, 38 + (L > 0 || L === 0 ? 0 : 1), 5, 1, shoeAcc); px(17, 38 + (R > 0 || R === 0 ? 0 : 1), 5, 1, shoeAcc); }
  // body (tiny lean when walking)
  const lean = frame ? (frame === 1 ? -1 : 1) : 0;
  px(10 + lean, 18, 12, 11, top);
  clothPattern(px, topD && topD.pat, 10 + lean, 18, 12, 11, topAcc);
  // waistband so the top reads separate from the bottom
  if (len !== 'skirt') px(10 + lean, 27, 12, 2, bot);
  // arms swing opposite legs (long-sleeved tops colour the arm, hands stay skin)
  const longSleeve = !!(topD && topD.long);
  px(6, 19 + aL, 4, 8, longSleeve ? top : skin); px(22, 19 + aR, 4, 8, longSleeve ? top : skin);
  if (longSleeve) { px(6, 25 + aL, 4, 2, skin); px(22, 25 + aR, 4, 2, skin); }
  // head
  px(9 + lean, 6, 14, 13, skin);
  // eyes
  px(12 + lean, 11, 2, 2, '#5a4a40'); px(18 + lean, 11, 2, 2, '#5a4a40');
  px(12 + lean, 11, 1, 1, '#fff'); px(18 + lean, 11, 1, 1, '#fff');
  // blush / mouth
  px(11 + lean, 14, 2, 1, '#f0b0b8'); px(19 + lean, 14, 2, 1, '#f0b0b8');
  px(15 + lean, 15, 2, 1, '#d09080');
  // hair
  px(9 + lean, 4, 14, 5, hair); px(8 + lean, 7, 3, 8, hair); px(21 + lean, 7, 3, 8, hair);
  if (av.gender === 'female') px(8 + lean, 14, 3, 12, hair), px(21 + lean, 14, 3, 12, hair);
  // hat goes on last, over the hair
  if (hatD) drawHat(px, hatD.shape, hatD.c[0], hatD.c[1], lean);
  inkOutline(g, w, h);

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  SPRITE_CACHE.set(key, t);
  return t;
}

function makeCritterSprite(kind, pet, frame, sheared) {
  frame = frame | 0;
  const key = 'cr:' + kind + ':' + !!pet + ':f' + frame + (sheared ? ':s' : '');
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);
  const c = document.createElement('canvas');
  c.width = 24; c.height = 20;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const px = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
  const hop = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  if (kind === 'chicken') {
    px(8, 10 + Math.abs(hop), 10, 7, '#fff8f0'); px(16, 12 + Math.abs(hop), 4, 3, '#ffc9a0'); px(11, 6 + Math.abs(hop), 6, 5, '#fff8f0');
    px(12, 4 + Math.abs(hop), 3, 2, '#f2a8a8');
    px(10 + hop, 17, 2, 2, '#ffe9a8'); px(14 - hop, 17, 2, 2, '#ffe9a8');
  } else if (kind === 'cow') {
    px(4, 8 + Math.abs(hop), 14, 8, '#faf8f5'); px(6, 10 + Math.abs(hop), 4, 4, '#c8c0b8'); px(2, 6 + Math.abs(hop), 6, 6, '#faf8f5');
    px(3, 8 + Math.abs(hop), 2, 2, '#8a7a70');
    px(6 + hop, 16, 2, 3, '#b0a8a0'); px(14 - hop, 16, 2, 3, '#b0a8a0');
  } else if (kind === 'sheep' || (!pet && kind !== 'chicken' && kind !== 'cow')) {
    if (sheared) { px(6, 9 + Math.abs(hop), 10, 6, '#f1c9bd'); px(3, 7 + Math.abs(hop), 5, 5, '#c8c0b8'); px(15, 10 + Math.abs(hop), 2, 2, '#f1c9bd'); }   // shorn: pink, no fleece
    else { px(5, 7 + Math.abs(hop), 12, 9, '#fffaf5'); px(3, 6 + Math.abs(hop), 5, 5, '#c8c0b8'); }
    px(7 + hop, 16, 2, 3, '#b8b0a8'); px(13 - hop, 16, 2, 3, '#b8b0a8');
  } else if (kind === 'pet_dog' || kind === 'dog') {
    px(6, 8 + Math.abs(hop), 12, 7, '#e8c9a8'); px(3, 6 + Math.abs(hop), 6, 6, '#e8c9a8'); px(16, 9 + Math.abs(hop), 5, 2, '#e8c9a8');
    px(4, 8 + Math.abs(hop), 2, 2, '#8a7a70');
    px(8 + hop, 15, 2, 3, '#d4b090'); px(13 - hop, 15, 2, 3, '#d4b090');
  } else if (kind === 'pet_cat' || kind === 'cat') {
    px(7, 9 + Math.abs(hop), 10, 6, '#c8c4d0'); px(4, 6 + Math.abs(hop), 6, 6, '#c8c4d0');
    px(4, 3 + Math.abs(hop), 2, 3, '#c8c4d0'); px(8, 3 + Math.abs(hop), 2, 3, '#c8c4d0');
    px(8 + hop, 15, 2, 3, '#b0a8b8'); px(13 - hop, 15, 2, 3, '#b0a8b8');
  } else {
    px(7, 8 + Math.abs(hop), 10, 7, '#fffaf5'); px(4, 6 + Math.abs(hop), 6, 6, '#fffaf5'); px(4, 8 + Math.abs(hop), 3, 2, '#ffd0d8');
    px(8 + hop, 15, 2, 3, '#ffd0d8'); px(13 - hop, 15, 2, 3, '#ffd0d8');
  }
  inkOutline(g, 24, 20);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  SPRITE_CACHE.set(key, t);
  return t;
}

// Final pass: tilt-shift miniature blur (top/bottom of the screen), warm grade, soft vignette, then linear -> sRGB.
// (The composer works in linear light; without the encode step at the end everything on screen came out too dark.)
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    res: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    blur: { value: 3.4 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float blur; varying vec2 vUv;
    vec3 oetf(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = abs(vUv.y - 0.46) * 2.0;
      float rad = smoothstep(0.5, 1.0, d) * blur;
      if (rad > 0.35) {
        vec3 s = c.rgb; float w = 1.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398 + 0.4;
          vec2 o = vec2(cos(a), sin(a)) * res;
          s += texture2D(tDiffuse, vUv + o * rad).rgb; s += texture2D(tDiffuse, vUv + o * rad * 0.5).rgb; w += 2.0;
        }
        c.rgb = s / w;
      }
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.14);                 // richer colour
      c.rgb *= vec3(1.04, 1.0, 0.93);                    // warm sunlight
      vec2 uv = (vUv - 0.5);
      float v = smoothstep(0.25, 0.85, dot(uv, uv) * 2.4);
      c.rgb *= 1.0 - v * 0.28;                           // vignette
      gl_FragColor = vec4(oetf(c.rgb), 1.0);
    }
  `,
};

class View {
  constructor(canvas) {
    this.cv = canvas;
    this.yaw = 0.78;
    this.ppt = 34; // orthographic frustum scale stand-in
    this.fx = 0; this.fz = 0; this.hcf = 0.52; this.focusD = 0;
    this.ctx = { imageSmoothingEnabled: false }; // shim for game.js
    this.W = 1; this.H = 1;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0xc8efb8, 1);
    // HD-2D uses painted blob shadows (not muddy realtime maps)
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xe8f5d8, 0.005);

    this.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 200);
    this.camera.position.set(0, 28, 0);
    this.camera.up.set(0, 1, 0);

    // warmer key + cooler fill so blob shadows read like HD-2D daylight
    this.hemi = new THREE.HemisphereLight(0xfff1dc, 0x8fb878, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 1.5);
    this.sun.position.set(-10, 28, 10);   // light from the upper-left of the default view → shadows fall to the right
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    this.staticRoot = new THREE.Group();
    this.scene.add(this.staticRoot);
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.composer = null;
    this._bloom = null;
    this._pending = [];
    this._geo = new THREE.BoxGeometry(1, 1, 1);
    this._quadGeo = new THREE.PlaneGeometry(1, 1);
    this._matCache = new Map();
    this._boxPool = [];
    this._quadPool = [];
    this._spritePool = [];
    this._shadowPool = [];
    this._boxUsed = 0;
    this._quadUsed = 0;
    this._spriteUsed = 0;
    this._shadowUsed = 0;
    this._shadowMat = new THREE.MeshBasicMaterial({
      map: castShadowTex(),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    });
    // Cast direction on the ground = opposite of the sun's horizontal position (sun at -10,+10 → shadows go +x,-z).
    // Shadow length per unit of object height is _shadowK. Keep both in sync with this.sun.position.
    const sx = -this.sun.position.x, sz = -this.sun.position.z, sl = Math.hypot(sx, sz);
    this._sdir = [sx / sl, sz / sl];
    this._shadowK = 0.5;
    this._resizeComposer();
  }

  _takeBox() {
    let m = this._boxPool[this._boxUsed];
    if (!m) {
      m = new THREE.Mesh(this._geo, this._mat('#ccc'));
      m.castShadow = true; m.receiveShadow = true;
      this._boxPool.push(m);
    }
    this._boxUsed++;
    return m;
  }
  _takeQuad() {
    let m = this._quadPool[this._quadUsed];
    if (!m) {
      m = new THREE.Mesh(this._quadGeo, this._mat('#ccc'));
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      this._quadPool.push(m);
    }
    this._quadUsed++;
    return m;
  }
  _takeSprite() {
    let s = this._spritePool[this._spriteUsed];
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false, // flat unlit = paper 2D
      }));
      s.center.set(0.5, 0);
      this._spritePool.push(s);
    }
    this._spriteUsed++;
    return s;
  }

  _takeShadow() {
    let m = this._shadowPool[this._shadowUsed];
    if (!m) {
      m = new THREE.Mesh(this._quadGeo, this._shadowMat);
      m.rotation.order = 'YXZ';
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this._shadowPool.push(m);
    }
    this._shadowUsed++;
    return m;
  }

  /**
   * Shadow of an object whose ground footprint is [mnx..mxx]×[mnz..mxz] and which is `h` tall, cast along the sun direction.
   * Small objects (people, animals, props) get one stretched, rotated shadow; large ones (buildings) get the footprint
   * swept along the light so the shadow stays flush with their walls. Returns {x, z, sx, sz, rot}.
   */
  _shadowShape(mnx, mxx, mnz, mxz, h) {
    h = Math.min(h, 2.6);
    const [dx, dz] = this._sdir, len = h * this._shadowK;
    const w = mxx - mnx, d = mxz - mnz, cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2;
    if (Math.max(w, d) <= 1.3) {
      const ex = Math.abs(dx) * w + Math.abs(dz) * d, ep = Math.abs(dz) * w + Math.abs(dx) * d;
      const L = ex + len, W = Math.max(0.28, ep * 0.95);
      return { x: cx + dx * len / 2, z: cz + dz * len / 2, sx: L * 1.2, sz: W * 1.25, rot: Math.atan2(-dz, dx) };
    }
    const x0 = Math.min(mnx, mnx + dx * len), x1 = Math.max(mxx, mxx + dx * len);
    const z0 = Math.min(mnz, mnz + dz * len), z1 = Math.max(mxz, mxz + dz * len);
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, sx: x1 - x0 + 0.2, sz: z1 - z0 + 0.2, rot: 0 };
  }

  /** Per-frame shadow (people, animals, dynamic props). */
  addCastShadow(mnx, mxx, mnz, mxz, h) {
    if (h < 0.1) return;
    const S = this._shadowShape(mnx, mxx, mnz, mxz, h);
    const mesh = this._takeShadow();
    mesh.position.set(S.x, 0.008, S.z);
    mesh.rotation.y = S.rot;
    mesh.scale.set(S.sx, S.sz, 1);
    mesh.material = this._shadowMat;
    mesh.visible = true;
    this.dynamic.add(mesh);
  }

  _bakeCastShadow(parent, mnx, mxx, mnz, mxz, h) {
    const S = this._shadowShape(mnx, mxx, mnz, mxz, h);
    const mesh = new THREE.Mesh(this._quadGeo, this._shadowMat);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.y = S.rot;
    mesh.renderOrder = 1;
    mesh.position.set(S.x, 0.007, S.z);
    mesh.scale.set(S.sx, S.sz, 1);
    parent.add(mesh);
  }

  _mat(hex, a) {
    const key = (hex || '#ccc') + ':' + (a == null ? 1 : a);
    if (this._matCache.has(key)) return this._matCache.get(key);
    const m = matFor(hex, a);
    this._matCache.set(key, m);
    return m;
  }

  _resizeComposer() {
    const w = Math.max(1, this.W), h = Math.max(1, this.H);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // tiny bloom only — heavy DOF made the whole farm unreadable
    this._bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.55, 0.82);
    this.composer.addPass(this._bloom);
    this._fx = new ShaderPass(VignetteShader);
    this._fx.uniforms.res.value.set(1 / w, 1 / h);
    this.composer.addPass(this._fx);
  }

  setSize(w, h, pr) {
    const dpr = Math.min(pr || (window.devicePixelRatio || 1), 1.75);
    this.W = Math.max(1, Math.floor(w * dpr));
    this.H = Math.max(1, Math.floor(h * dpr));
    this.cv.width = this.W; this.cv.height = this.H;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.W, this.H, false);
    this._resizeComposer();
    this._updateCamera();
  }

  _updateCamera() {
    const aspect = this.W / Math.max(1, this.H);
    // ppt ~ pixels-per-tile; map to ortho frustum height
    const viewH = Math.max(8, 900 / Math.max(12, this.ppt));
    const viewW = viewH * aspect;
    this.camera.left = -viewW / 2; this.camera.right = viewW / 2;
    this.camera.top = viewH / 2; this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();

    // HD-2D-ish elevated ortho
    const dist = 34;
    const pitch = 1.05;
    const yaw = this.yaw;
    const cx = this.fx, cz = this.fz;
    const elev = Math.sin(pitch) * dist;
    const flat = Math.cos(pitch) * dist;
    this.camera.position.set(
      cx + Math.sin(yaw) * flat,
      elev,
      cz + Math.cos(yaw) * flat
    );
    this.camera.lookAt(cx, 0.35, cz);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
  }

  prep() {
    // recycle pooled meshes (hide extras)
    while (this.dynamic.children.length) this.dynamic.remove(this.dynamic.children[0]);
    this._boxUsed = 0; this._quadUsed = 0; this._spriteUsed = 0; this._shadowUsed = 0;
    this._pending.length = 0;
    this._updateCamera();
  }

  clear() { /* sky handled in clearSky */ }
  clearSky() {
    this.renderer.setClearColor(0xd4f0c0, 1);
    this.scene.background = new THREE.Color(0xd8f0c8);
    this.scene.fog.color.set(0xe8f5d8);
  }

  quad(x0, z0, x1, z1, y, fill) {
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    if (w < 1e-4 || d < 1e-4) return;
    let hex = fill || '#b8e0b0', alpha = 1;
    if (typeof fill === 'string' && fill.startsWith('rgba')) {
      const p = parseHex(fill);
      hex = '#' + [p[0], p[1], p[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      alpha = p[3];
    }
    const mesh = this._takeQuad();
    mesh.material = this._mat(hex, alpha);
    // y stacks layers so ground / overlays / hover never Z-fight
    mesh.position.set((x0 + x1) / 2, (y == null ? 0 : y), (z0 + z1) / 2);
    mesh.scale.set(w, d, 1);
    mesh.renderOrder = alpha < 0.99 ? 2 : 0;
    mesh.visible = true;
    this.dynamic.add(mesh);
  }

  /** Queue voxel boxes as 3D meshes (environment / props). */
  add(boxes, ox, oy, oz, psi, r) {
    if (!boxes || !boxes.length) return;
    this._pending.push({ boxes, ox, oy: oy || 0, oz, psi: psi || 0, r: r || 1 });
  }

  /** Bake unchanging scenery once (shop, fences, trees) — big FPS win. */
  bakeStatic(pieces) {
    while (this.staticRoot.children.length) {
      const c = this.staticRoot.children[0];
      this.staticRoot.remove(c);
    }
    const geo = this._geo;
    for (const p of pieces || []) {
      if (!p.B) continue;
      const psi = 0, cs = 1, sn = 0;
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9, top = 0;
      for (const b of p.B) {
        if (!b || b.w <= 0 || b.h <= 0 || b.d <= 0) continue;
        const lx = b.x, lz = b.z, ly = b.y + b.h / 2;
        const wx = p.x + lx * cs + lz * sn;
        const wz = p.z - lx * sn + lz * cs;
        const wy = ly;
        const mesh = new THREE.Mesh(geo, this._mat(b.c, b.a));
        mesh.position.set(wx, wy, wz);
        mesh.scale.set(b.w, b.h, b.d);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.staticRoot.add(mesh);
        if (b.a == null || b.a > 0.75) {
          mnx = Math.min(mnx, wx - b.w / 2); mxx = Math.max(mxx, wx + b.w / 2);
          mnz = Math.min(mnz, wz - b.d / 2); mxz = Math.max(mxz, wz + b.d / 2);
          top = Math.max(top, b.y + b.h);
        }
      }
      // one cast shadow per object (not per box), so stacked parts never double-darken.
      // Multi-tile buildings opt out per tile (noShadow) and supply a single shadowBox for the whole building.
      if (p.shadowBox) { const sb = p.shadowBox; this._bakeCastShadow(this.staticRoot, sb.x0, sb.x1, sb.z0, sb.z1, sb.h); }
      else if (!p.noShadow && top > 0.45 && mxx > mnx) this._bakeCastShadow(this.staticRoot, mnx, mxx, mnz, mxz, top);
    }
  }

  /** Camera-facing pixel character / critter. opts.walk / opts.moving drive stride + bob. */
  addBillboard(texOrKind, x, y, z, opts) {
    opts = opts || {};
    const moving = !!opts.moving;
    const phase = opts.walk || 0;
    const frame = walkFrame(phase, moving);
    let tex = texOrKind;
    if (typeof texOrKind === 'string') tex = makeCritterSprite(texOrKind, !!opts.pet, frame, !!opts.sheared);
    const spr = this._takeSprite();
    spr.material.map = tex;
    spr.material.needsUpdate = true;
    const sc = opts.scale || 1.0;
    const iw = (tex.image && tex.image.width) || 32;
    const ih = (tex.image && tex.image.height) || 40;
    let bob = moving ? Math.abs(Math.sin(phase)) * 0.06 : 0;
    let squash = moving ? 1 - Math.abs(Math.sin(phase)) * 0.04 : 1;
    let stretch = moving ? 1 + Math.abs(Math.sin(phase)) * 0.025 : 1;
    let rot = 0, flip = 1;
    const T = performance.now() / 1000;
    // idle "pump": squash & stretch up/down like a video-game idle bounce
    if (opts.pump && !moving && !opts.emote) {
      const w = Math.sin(T * opts.pump.speed + (opts.pump.ph || 0));
      stretch *= 1 + opts.pump.amp * w; squash *= 1 - opts.pump.amp * 0.6 * w; bob += Math.max(0, w) * opts.pump.amp * 0.5;
    }
    // emotes (et = seconds since the emote started)
    const et = opts.et || 0;
    switch (opts.emote) {
      case 'sit': stretch *= 0.74; squash *= 1.06; bob += 0.15; break;
      case 'dance': rot = Math.sin(et * 9) * 0.22; flip = Math.sin(et * 4.5) >= 0 ? 1 : -1; bob += Math.abs(Math.sin(et * 9)) * 0.16; stretch *= 1 + 0.06 * Math.cos(et * 18); break;
      case 'wave': rot = Math.sin(et * 10) * 0.1; bob += Math.max(0, Math.sin(et * 5)) * 0.05; break;
      case 'jump': bob += Math.abs(Math.sin(et * 7)) * 0.45; stretch *= 1 + 0.08 * Math.sin(et * 14); break;
      case 'spin': squash *= Math.cos(et * 10); bob += Math.abs(Math.sin(et * 5)) * 0.1; break;
      case 'laugh': rot = Math.sin(et * 22) * 0.07; bob += Math.abs(Math.sin(et * 11)) * 0.06; stretch *= 1 + 0.05 * Math.sin(et * 22); break;
      case 'heart': bob += Math.abs(Math.sin(et * 4)) * 0.07; break;
    }
    spr.material.rotation = rot;
    spr.scale.set(sc * (iw / 32) * squash * flip, sc * (ih / 32) * stretch, 1);
    spr.position.set(x, (y || 0) + 0.02 + bob, z);
    spr.visible = true;
    this.dynamic.add(spr);
    // soft oval under feet
    if (opts.shadow !== false) {
      const hw = 0.17 * sc, hd = 0.1 * sc;
      this.addCastShadow(x - hw, x + hw, z - hd, z + hd, sc * (ih / 32) * 0.8);
    }
  }

  addCharacter(avatar, cat, x, z, scale, walk, moving, extra) {
    const frame = walkFrame(walk || 0, !!moving);
    const tex = makeCharSprite(avatar, cat, frame);
    this.addBillboard(tex, x, 0, z, Object.assign({ scale: scale || 1.05, walk: walk || 0, moving: !!moving }, extra || {}));
  }

  flush() {
    for (const job of this._pending) {
      const cs = Math.cos(job.psi), sn = Math.sin(job.psi);
      const r = job.r || 1;
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9, top = 0;
      for (const b of job.boxes) {
        if (!b || b.w <= 0 || b.h <= 0 || b.d <= 0) continue;
        const lx = b.x * r, lz = b.z * r, ly = (b.y + b.h / 2) * r;
        const wx = job.ox + lx * cs + lz * sn;
        const wz = job.oz - lx * sn + lz * cs;
        const wy = job.oy + ly;
        const bw = b.w * r, bh = b.h * r, bd = b.d * r;
        const mesh = this._takeBox();
        mesh.material = this._mat(b.c, b.a);
        mesh.position.set(wx, wy, wz);
        mesh.scale.set(bw, bh, bd);
        mesh.rotation.y = job.psi;
        mesh.castShadow = false;
        mesh.visible = true;
        this.dynamic.add(mesh);
        if (b.a == null || b.a > 0.75) {
          const ex = (Math.abs(cs) * bw + Math.abs(sn) * bd) / 2, ez = (Math.abs(sn) * bw + Math.abs(cs) * bd) / 2;
          mnx = Math.min(mnx, wx - ex); mxx = Math.max(mxx, wx + ex); mnz = Math.min(mnz, wz - ez); mxz = Math.max(mxz, wz + ez);
          top = Math.max(top, job.oy + (b.y + b.h) * r);
        }
      }
      if (top > 0.45 && mxx > mnx) this.addCastShadow(mnx, mxx, mnz, mxz, top);   // one shadow per object
    }
    this._pending.length = 0;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  finish() { /* bloom/vignette already in composer */ }

  toScreen(X, Y, Z) {
    const v = new THREE.Vector3(X, Y || 0, Z);
    v.project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * this.W;
    const sy = (-v.y * 0.5 + 0.5) * this.H;
    // depth proxy: distance from camera along view
    const depth = this.camera.position.distanceTo(new THREE.Vector3(X, Y || 0, Z));
    return [sx, sy, depth];
  }

  pick(sx, sy, Y) {
    Y = Y || 0;
    // ray from camera through NDC onto plane y=Y
    const ndc = new THREE.Vector2((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -Y);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) {
      // fallback orthographic unproject
      const v = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
      return { x: v.x, z: v.z };
    }
    return { x: hit.x, z: hit.z };
  }
}

export { View, makeCharSprite, makeCritterSprite, pixelTex };
export const HD2D = { View, makeCharSprite, makeCritterSprite, pixelTex };
window.HD2D = { View, makeCharSprite, makeCritterSprite, pixelTex };
