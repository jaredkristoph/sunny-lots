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
  const m = new THREE.MeshLambertMaterial({
    map: pixelTex(hex || '#ccc'),
    transparent: a < 0.99,
    opacity: a,
    depthWrite: a > 0.85,
    polygonOffset: true,
    polygonOffsetFactor: a < 0.99 ? -1 : 0,
    polygonOffsetUnits: a < 0.99 ? -1 : 0,
  });
  return m;
}

/** Walk cycle frame: 0 idle, 1 left stride, 2 right stride. */
function walkFrame(phase, moving) {
  if (!moving) return 0;
  const s = Math.sin(phase);
  return s > 0.15 ? 1 : s < -0.15 ? 2 : 0;
}

/** Tiny procedural chibi pixel sprite (billboard). frame = 0/1/2 walk. */
function makeCharSprite(avatar, cat, frame) {
  frame = frame | 0;
  const skin = (avatar && avatar.skin) || '#f0c8a0';
  const hair = (avatar && avatar.hairColor) || '#5a3a1a';
  const C = cat && cat.CLOTH;
  const top = C && avatar && C[avatar.top] ? C[avatar.top].c[0] : '#7ec8e8';
  const bot = C && avatar && C[avatar.bottom] ? C[avatar.bottom].c[0] : '#6b8cae';
  const key = 'ch:' + skin + hair + top + bot + (avatar && avatar.gender) + ':f' + frame;
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
  // shoes
  px(10, 36 + (L > 0 ? 0 : L === 0 ? 0 : 1), 5, 3, '#8a7060');
  px(17, 36 + (R > 0 ? 0 : R === 0 ? 0 : 1), 5, 3, '#8a7060');
  // legs
  px(11, 28 + (L < 0 ? 1 : 0), 4, 8 + (L > 0 ? -1 : 0), bot);
  px(17, 28 + (R < 0 ? 1 : 0), 4, 8 + (R > 0 ? -1 : 0), bot);
  // body (tiny lean when walking)
  const lean = frame ? (frame === 1 ? -1 : 1) : 0;
  px(10 + lean, 18, 12, 11, top);
  // arms swing opposite legs
  px(6, 19 + aL, 4, 8, skin); px(22, 19 + aR, 4, 8, skin);
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
  if (avatar && avatar.gender === 'female') px(8 + lean, 14, 3, 12, hair), px(21 + lean, 14, 3, 12, hair);

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  SPRITE_CACHE.set(key, t);
  return t;
}

function makeCritterSprite(kind, pet, frame) {
  frame = frame | 0;
  const key = 'cr:' + kind + ':' + !!pet + ':f' + frame;
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
    px(5, 7 + Math.abs(hop), 12, 9, '#fffaf5'); px(3, 6 + Math.abs(hop), 5, 5, '#c8c0b8');
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
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  SPRITE_CACHE.set(key, t);
  return t;
}

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.2 },
    darkness: { value: 0.97 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset);
      float v = smoothstep(0.95, 1.6, dot(uv, uv));
      c.rgb = mix(c.rgb, c.rgb * darkness, v * 0.35);
      // gentle lift so the farm stays readable
      c.rgb = c.rgb * 1.06 + 0.02;
      gl_FragColor = c;
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
    // soft shadows looked muddy on mobile — keep crisp/readable instead
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xe8f5d8, 0.006);

    this.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 200);
    this.camera.position.set(0, 28, 0);
    this.camera.up.set(0, 1, 0);

    // bright pastel daylight (readable, not muddy)
    this.hemi = new THREE.HemisphereLight(0xfff8f0, 0xb8e0a8, 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
    this.sun.position.set(14, 32, 12);
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));

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
    this._boxUsed = 0;
    this._quadUsed = 0;
    this._spriteUsed = 0;
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
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      s.center.set(0.5, 0);
      this._spritePool.push(s);
    }
    this._spriteUsed++;
    return s;
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
    this._bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.08, 0.4, 0.92);
    this.composer.addPass(this._bloom);
    this.composer.addPass(new ShaderPass(VignetteShader));
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

    // isometric-ish orbit around focus
    const dist = 32;
    const pitch = 0.95;
    const yaw = this.yaw;
    const cx = this.fx, cz = this.fz;
    const elev = Math.sin(pitch) * dist;
    const flat = Math.cos(pitch) * dist;
    this.camera.position.set(
      cx + Math.sin(yaw) * flat,
      elev,
      cz + Math.cos(yaw) * flat
    );
    this.camera.lookAt(cx, 0.4, cz);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
  }

  prep() {
    // recycle pooled meshes (hide extras)
    while (this.dynamic.children.length) this.dynamic.remove(this.dynamic.children[0]);
    this._boxUsed = 0; this._quadUsed = 0; this._spriteUsed = 0;
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
      for (const b of p.B) {
        if (!b || b.w <= 0 || b.h <= 0 || b.d <= 0) continue;
        const lx = b.x, lz = b.z, ly = b.y + b.h / 2;
        const wx = p.x + lx * cs + lz * sn;
        const wz = p.z - lx * sn + lz * cs;
        const wy = ly;
        const mesh = new THREE.Mesh(geo, this._mat(b.c, b.a));
        mesh.position.set(wx, wy, wz);
        mesh.scale.set(b.w, b.h, b.d);
        mesh.castShadow = (b.a == null || b.a > 0.8);
        mesh.receiveShadow = true;
        this.staticRoot.add(mesh);
      }
    }
  }

  /** Camera-facing pixel character / critter. opts.walk / opts.moving drive stride + bob. */
  addBillboard(texOrKind, x, y, z, opts) {
    opts = opts || {};
    const moving = !!opts.moving;
    const phase = opts.walk || 0;
    const frame = walkFrame(phase, moving);
    let tex = texOrKind;
    if (typeof texOrKind === 'string') tex = makeCritterSprite(texOrKind, !!opts.pet, frame);
    const spr = this._takeSprite();
    spr.material.map = tex;
    spr.material.needsUpdate = true;
    const sc = opts.scale || 1.35;
    const iw = (tex.image && tex.image.width) || 32;
    const ih = (tex.image && tex.image.height) || 40;
    const bob = moving ? Math.abs(Math.sin(phase)) * 0.09 : 0;
    const squash = moving ? 1 - Math.abs(Math.sin(phase)) * 0.05 : 1;
    const stretch = moving ? 1 + Math.abs(Math.sin(phase)) * 0.03 : 1;
    spr.scale.set(sc * (iw / 32) * squash, sc * (ih / 32) * stretch, 1);
    spr.position.set(x, (y || 0) + 0.02 + bob, z);
    spr.visible = true;
    this.dynamic.add(spr);
  }

  addCharacter(avatar, cat, x, z, scale, walk, moving) {
    const frame = walkFrame(walk || 0, !!moving);
    const tex = makeCharSprite(avatar, cat, frame);
    this.addBillboard(tex, x, 0, z, { scale: scale || 1.6, walk: walk || 0, moving: !!moving });
  }

  flush() {
    for (const job of this._pending) {
      const cs = Math.cos(job.psi), sn = Math.sin(job.psi);
      for (const b of job.boxes) {
        if (!b || b.w <= 0 || b.h <= 0 || b.d <= 0) continue;
        const lx = b.x, lz = b.z, ly = b.y + b.h / 2;
        const wx = job.ox + lx * cs + lz * sn;
        const wz = job.oz - lx * sn + lz * cs;
        const wy = job.oy + ly;
        const mesh = this._takeBox();
        mesh.material = this._mat(b.c, b.a);
        mesh.position.set(wx, wy, wz);
        mesh.scale.set(b.w, b.h, b.d);
        mesh.rotation.y = job.psi;
        mesh.castShadow = (b.a == null || b.a > 0.8);
        mesh.visible = true;
        this.dynamic.add(mesh);
      }
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
