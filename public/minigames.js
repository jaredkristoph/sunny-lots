'use strict';
// Five arcade-style mini-games used by stalls / milking.
// Each returns a Promise that resolves to true/false.
window.MiniGames = (() => {
  const SENTENCES = [
    'sunny lots grow happy crops',
    'water the plants every morning',
    'fresh eggs from the chicken pen',
    'milk the cow before sunset',
    'share tools with your neighbors',
  ];
  const isTouch = () =>
    matchMedia('(pointer: coarse)').matches ||
    matchMedia('(hover: none)').matches ||
    (navigator.maxTouchPoints || 0) > 0 ||
    'ontouchstart' in window;

  function overlay(title) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(20,12,0,.55);display:flex;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));touch-action:none';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff8e1;border:3px solid #b8862b;border-radius:16px;padding:12px;width:min(520px,96vw);max-height:min(92vh,720px);overflow:auto;box-shadow:0 12px 40px #0006;-webkit-overflow-scrolling:touch';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:900;font-size:18px;margin-bottom:8px;color:#5a3a0a';
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = 'flex:1;min-width:0';
    const xbtn = document.createElement('button');
    xbtn.className = 'btn sm';
    xbtn.type = 'button';
    xbtn.textContent = '✕';
    xbtn.setAttribute('aria-label', 'Close');
    xbtn.style.cssText = 'min-width:44px;min-height:44px;padding:0;flex:none';
    head.append(titleEl, xbtn);
    const body = document.createElement('div');
    card.append(head, body);
    wrap.append(card);
    document.body.append(wrap);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const cleanup = () => { document.body.style.overflow = prevOverflow; wrap.remove(); };
    return { wrap, body, head, titleEl, xbtn, close: cleanup };
  }

  function bindCancel(ui, end) {
    ui.xbtn.onclick = () => end(false);
    const onKey = e => { if (e.key === 'Escape') end(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }

  function touchPtr(e) {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
  }

  function typing(title) {
    return new Promise(resolve => {
      const ui = overlay(title || 'Typing Race');
      const sentence = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
      const target = document.createElement('div');
      target.style.cssText = 'font:700 17px/1.45 system-ui,sans-serif;background:#fff;border:2px solid #e3c88a;border-radius:10px;padding:12px;margin-bottom:8px;word-break:break-word';
      target.textContent = sentence;
      const input = document.createElement('input');
      input.className = 'txt';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.autocorrect = 'off';
      input.spellcheck = false;
      input.enterKeyHint = 'done';
      input.placeholder = 'Type the sentence…';
      input.style.cssText = 'width:100%;font-size:16px;padding:12px;min-height:48px';
      const timer = document.createElement('div');
      timer.className = 'muted';
      ui.body.append(target, input, timer);
      // delay focus so iOS keyboard opens reliably after overlay paints
      setTimeout(() => input.focus(), 50);
      const secs = 22;
      const start = performance.now();
      let done = false;
      const unbind = bindCancel(ui, ok => end(ok));
      const end = ok => { if (done) return; done = true; clearInterval(iv); unbind(); ui.close(); resolve(!!ok); };
      const iv = setInterval(() => {
        const left = secs - (performance.now() - start) / 1000;
        timer.textContent = left.toFixed(1) + 's left';
        if (left <= 0) end(false);
      }, 100);
      input.addEventListener('input', () => {
        if (input.value.trim().toLowerCase() === sentence) end(true);
      });
    });
  }

  function simon(title) {
    return new Promise(resolve => {
      const ui = overlay(title || 'Simon Says');
      const colors = ['#e03131', '#2f9e44', '#4263eb', '#f08c00'];
      const names = ['Red', 'Green', 'Blue', 'Orange'];
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0';
      const btns = colors.map((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.style.cssText = 'min-height:72px;height:18vw;max-height:110px;background:' + c + ';color:#fff;border-color:#333;font-size:18px;touch-action:manipulation';
        b.textContent = names[i];
        grid.append(b);
        return b;
      });
      const status = document.createElement('div');
      status.style.cssText = 'font-weight:700;min-height:24px';
      ui.body.append(status, grid);
      const seq = [];
      let step = 0, inputMode = false, done = false;
      const unbind = bindCancel(ui, ok => end(ok));
      const end = ok => { if (done) return; done = true; unbind(); ui.close(); resolve(!!ok); };
      const flash = async (i) => {
        const b = btns[i];
        const old = b.style.filter;
        b.style.filter = 'brightness(1.8)';
        await new Promise(r => setTimeout(r, 380));
        b.style.filter = old;
        await new Promise(r => setTimeout(r, 140));
      };
      const playSeq = async () => {
        inputMode = false; status.textContent = 'Watch…';
        for (const i of seq) await flash(i);
        step = 0; inputMode = true; status.textContent = 'Your turn — tap the colors';
      };
      btns.forEach((b, i) => b.onclick = () => {
        if (!inputMode || done) return;
        if (i !== seq[step]) return end(false);
        step++;
        if (step >= seq.length) {
          if (seq.length >= 4) return end(true);
          seq.push(Math.floor(Math.random() * 4));
          playSeq();
        }
      });
      seq.push(Math.floor(Math.random() * 4));
      playSeq();
    });
  }

  function makePad(labels) {
    const pad = document.createElement('div');
    pad.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:center';
    const btns = {};
    for (const [key, label] of Object.entries(labels)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.dataset.key = key;
      b.style.cssText = 'flex:1;min-width:72px;min-height:52px;font-size:20px;touch-action:none;user-select:none;-webkit-user-select:none';
      pad.append(b);
      btns[key] = b;
    }
    return { pad, btns };
  }

  function holdButtons(btns, state) {
    const down = key => e => {
      e.preventDefault();
      state[key] = true;
      btns[key].classList.add('green');
    };
    const up = key => e => {
      e.preventDefault();
      state[key] = false;
      btns[key].classList.remove('green');
    };
    const cleanups = [];
    for (const key of Object.keys(btns)) {
      const b = btns[key];
      const d = down(key), u = up(key);
      b.addEventListener('touchstart', d, { passive: false });
      b.addEventListener('touchend', u);
      b.addEventListener('touchcancel', u);
      b.addEventListener('mousedown', d);
      b.addEventListener('mouseup', u);
      b.addEventListener('mouseleave', u);
      b.addEventListener('contextmenu', e => e.preventDefault());
      cleanups.push(() => {
        b.removeEventListener('touchstart', d);
        b.removeEventListener('touchend', u);
        b.removeEventListener('touchcancel', u);
        b.removeEventListener('mousedown', d);
        b.removeEventListener('mouseup', u);
        b.removeEventListener('mouseleave', u);
      });
    }
    return () => cleanups.forEach(fn => fn());
  }

  function eggs(title) {
    return new Promise(resolve => {
      const ui = overlay(title || 'Catch the Eggs');
      const cv = document.createElement('canvas');
      cv.width = 420; cv.height = 280;
      cv.style.cssText = 'width:100%;touch-action:none;background:#87ceeb;border-radius:10px;border:2px solid #b8862b;image-rendering:pixelated;display:block';
      const tip = document.createElement('div');
      tip.className = 'muted';
      tip.textContent = isTouch()
        ? 'Drag on the game · catch 8 eggs · avoid rocks'
        : 'Move with mouse / A D · catch 8 eggs · avoid rocks';
      const { pad, btns } = makePad({ left: '◀', right: '▶' });
      ui.body.append(cv, tip, pad);
      const ctx = cv.getContext('2d');
      let basket = 180, score = 0, missed = 0, done = false;
      const items = [];
      const hold = { left: false, right: false };
      const unHold = holdButtons(btns, hold);
      const unbind = bindCancel(ui, ok => end(ok));
      const end = ok => {
        if (done) return; done = true;
        cancelAnimationFrame(raf); unHold(); unbind();
        removeEventListener('keydown', onKey);
        ui.close(); resolve(!!ok);
      };
      const setBasketFromClientX = clientX => {
        const r = cv.getBoundingClientRect();
        basket = ((clientX - r.left) / r.width) * cv.width - 30;
      };
      const onMove = e => { setBasketFromClientX(e.clientX); };
      const onTouch = e => { e.preventDefault(); setBasketFromClientX(touchPtr(e).clientX); };
      const onKey = e => {
        if (e.key === 'a' || e.key === 'ArrowLeft') basket -= 24;
        if (e.key === 'd' || e.key === 'ArrowRight') basket += 24;
      };
      cv.addEventListener('mousemove', onMove);
      cv.addEventListener('touchstart', onTouch, { passive: false });
      cv.addEventListener('touchmove', onTouch, { passive: false });
      addEventListener('keydown', onKey);
      let last = performance.now(), spawn = 0, raf;
      const frame = (t) => {
        if (done) return;
        const dt = Math.min(0.05, (t - last) / 1000); last = t;
        if (hold.left) basket -= 220 * dt;
        if (hold.right) basket += 220 * dt;
        basket = Math.max(0, Math.min(cv.width - 60, basket));
        spawn += dt;
        if (spawn > 0.55) {
          spawn = 0;
          items.push({ x: 20 + Math.random() * 380, y: -10, v: 90 + Math.random() * 80, egg: Math.random() > 0.28 });
        }
        ctx.fillStyle = '#87ceeb'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#6fb85f'; ctx.fillRect(0, 250, cv.width, 30);
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          it.y += it.v * dt;
          ctx.fillStyle = it.egg ? '#fff8e1' : '#868e96';
          ctx.beginPath(); ctx.ellipse(it.x, it.y, it.egg ? 10 : 9, it.egg ? 13 : 9, 0, 0, Math.PI * 2); ctx.fill();
          if (it.y > 230 && it.x > basket && it.x < basket + 60) {
            items.splice(i, 1);
            if (it.egg) { score++; tip.textContent = 'Eggs ' + score + '/8'; if (score >= 8) end(true); }
            else end(false);
          } else if (it.y > 270) {
            items.splice(i, 1);
            if (it.egg) { missed++; if (missed >= 3) end(false); }
          }
        }
        ctx.fillStyle = '#8a5a2b'; ctx.fillRect(basket, 235, 60, 14);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      setTimeout(() => end(false), 25000);
    });
  }

  function invader(title) {
    return new Promise(resolve => {
      const ui = overlay(title || 'Space Invaders');
      const cv = document.createElement('canvas');
      cv.width = 420; cv.height = 300;
      cv.style.cssText = 'width:100%;touch-action:none;background:#0b1026;border-radius:10px;border:2px solid #b8862b;display:block';
      const tip = document.createElement('div');
      tip.className = 'muted';
      tip.textContent = isTouch()
        ? '◀ ▶ move · ✦ shoot · defeat 8 aliens'
        : 'A/D or arrows move · Space shoot · defeat 8 aliens';
      const { pad, btns } = makePad({ left: '◀', shoot: '✦', right: '▶' });
      btns.shoot.style.flex = '1.4';
      ui.body.append(cv, tip, pad);
      const ctx = cv.getContext('2d');
      let x = 200, cool = 0, kills = 0, done = false;
      const keys = new Set();
      const hold = { left: false, right: false, shoot: false };
      const aliens = [];
      const shots = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) aliens.push({ x: 40 + c * 55, y: 30 + r * 36, alive: true });
      const unHold = holdButtons(btns, hold);
      const unbind = bindCancel(ui, ok => end(ok));
      const end = ok => {
        if (done) return; done = true;
        cancelAnimationFrame(raf); unHold(); unbind();
        removeEventListener('keydown', kd); removeEventListener('keyup', ku);
        ui.close(); resolve(!!ok);
      };
      const kd = e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); };
      const ku = e => keys.delete(e.code);
      addEventListener('keydown', kd); addEventListener('keyup', ku);
      // drag finger on canvas to move ship
      const dragShip = e => {
        e.preventDefault();
        const p = touchPtr(e);
        const r = cv.getBoundingClientRect();
        x = ((p.clientX - r.left) / r.width) * cv.width - 10;
      };
      cv.addEventListener('touchstart', dragShip, { passive: false });
      cv.addEventListener('touchmove', dragShip, { passive: false });
      cv.addEventListener('mousemove', e => {
        if (e.buttons) {
          const r = cv.getBoundingClientRect();
          x = ((e.clientX - r.left) / r.width) * cv.width - 10;
        }
      });
      let dir = 1, last = performance.now(), raf;
      const frame = (t) => {
        if (done) return;
        const dt = Math.min(0.05, (t - last) / 1000); last = t;
        if (keys.has('ArrowLeft') || keys.has('KeyA') || hold.left) x -= 180 * dt;
        if (keys.has('ArrowRight') || keys.has('KeyD') || hold.right) x += 180 * dt;
        x = Math.max(10, Math.min(390, x));
        cool -= dt;
        const fire = keys.has('Space') || keys.has('KeyW') || hold.shoot;
        if (fire && cool <= 0) { shots.push({ x: x + 10, y: 260 }); cool = 0.28; }
        let hitEdge = false;
        for (const a of aliens) if (a.alive) { a.x += dir * 40 * dt; if (a.x < 10 || a.x > 390) hitEdge = true; }
        if (hitEdge) { dir *= -1; for (const a of aliens) if (a.alive) a.y += 12; }
        for (const s of shots) s.y -= 260 * dt;
        for (let i = shots.length - 1; i >= 0; i--) {
          const s = shots[i];
          if (s.y < 0) { shots.splice(i, 1); continue; }
          for (const a of aliens) {
            if (!a.alive) continue;
            if (Math.hypot(s.x - a.x, s.y - a.y) < 16) { a.alive = false; shots.splice(i, 1); kills++; tip.textContent = 'Aliens down ' + kills + '/8'; break; }
          }
        }
        if (kills >= 8) return end(true);
        if (aliens.some(a => a.alive && a.y > 240)) return end(false);
        ctx.fillStyle = '#0b1026'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#9be564'; ctx.fillRect(x, 270, 20, 12);
        ctx.fillStyle = '#ffd76a';
        for (const s of shots) ctx.fillRect(s.x, s.y, 3, 10);
        ctx.fillStyle = '#ff6b6b';
        for (const a of aliens) if (a.alive) { ctx.fillRect(a.x - 10, a.y - 8, 20, 16); }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      setTimeout(() => end(false), 40000);
    });
  }

  function race(title) {
    return new Promise(resolve => {
      const ui = overlay(title || 'Lane Race');
      const cv = document.createElement('canvas');
      cv.width = 420; cv.height = 280;
      cv.style.cssText = 'width:100%;touch-action:none;background:#3b3b3b;border-radius:10px;border:2px solid #b8862b;display:block';
      const tip = document.createElement('div');
      tip.className = 'muted';
      tip.textContent = isTouch()
        ? 'Hold GO / tap the track to accelerate · reach the finish'
        : 'Hold Space / click to accelerate · reach the finish · avoid crashing';
      const { pad, btns } = makePad({ go: 'GO 🚗' });
      btns.go.style.minHeight = '56px';
      btns.go.style.fontSize = '22px';
      ui.body.append(cv, tip, pad);
      const ctx = cv.getContext('2d');
      let player = 0, speed = 0, hold = false, done = false;
      const rival = { p: 0, v: 95 };
      const padHold = { go: false };
      const unHold = holdButtons(btns, padHold);
      const unbind = bindCancel(ui, ok => end(ok));
      const end = ok => {
        if (done) return; done = true;
        cancelAnimationFrame(raf); unHold(); unbind();
        removeEventListener('keydown', kd); removeEventListener('keyup', ku);
        ui.close(); resolve(!!ok);
      };
      const down = e => { if (e && e.preventDefault) e.preventDefault(); hold = true; };
      const up = () => { hold = false; };
      cv.addEventListener('mousedown', down);
      cv.addEventListener('mouseup', up);
      cv.addEventListener('mouseleave', up);
      cv.addEventListener('touchstart', down, { passive: false });
      cv.addEventListener('touchend', up);
      cv.addEventListener('touchcancel', up);
      addEventListener('mouseup', up);
      const kd = e => { if (e.code === 'Space') { hold = true; e.preventDefault(); } };
      const ku = e => { if (e.code === 'Space') hold = false; };
      addEventListener('keydown', kd); addEventListener('keyup', ku);
      let last = performance.now(), wobble = 0, raf;
      const finish = 1000;
      const frame = (t) => {
        if (done) return;
        const dt = Math.min(0.05, (t - last) / 1000); last = t;
        const pressing = hold || padHold.go;
        if (pressing) speed = Math.min(220, speed + 140 * dt); else speed = Math.max(40, speed - 80 * dt);
        wobble += dt * (0.7 + speed / 120);
        const drift = Math.sin(wobble * 3) * (8 + speed / 40);
        player += speed * dt;
        rival.p += rival.v * dt;
        if (Math.abs(drift) > 22 && speed > 160) return end(false);
        if (player >= finish) return end(true);
        if (rival.p >= finish + 40) return end(false);
        ctx.fillStyle = '#3b3b3b'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 40, cv.width, 200);
        ctx.strokeStyle = '#fff'; ctx.setLineDash([12, 12]); ctx.beginPath(); ctx.moveTo(0, 140); ctx.lineTo(cv.width, 140); ctx.stroke(); ctx.setLineDash([]);
        const px = 30 + (player / finish) * 340;
        const rx = 30 + (rival.p / finish) * 340;
        ctx.fillStyle = '#4dabf7'; ctx.fillRect(px, 150 + drift * 0.3, 36, 18);
        ctx.fillStyle = '#e03131'; ctx.fillRect(rx, 100, 36, 18);
        ctx.fillStyle = '#ffe066'; ctx.fillRect(390, 50, 8, 180);
        tip.textContent = 'You ' + Math.min(100, Math.floor(player / finish * 100)) + '% · Rival ' + Math.min(100, Math.floor(rival.p / finish * 100)) + '%';
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
  }

  const runners = { typing, simon, eggs, invader, race, milk: typing };
  function play(kind, title) {
    const fn = runners[kind] || typing;
    return fn(title);
  }

  return { play, typing, simon, eggs, invader, race };
})();
