'use strict';
import './hd2d.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.body.appendChild(s);
  });
}

(async () => {
  try {
    await loadScript('voxel.js');
    await loadScript('minigames.js');
    await loadScript('monsters.js');
    await loadScript('monsprite.js');
    await loadScript('mon.js');
    await loadScript('game.js');
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1208;color:#ffe8c8;font:16px sans-serif;padding:20px;text-align:center">Could not start Sunny Lots HD-2D.<br>' + err.message + '</div>');
  }
})();
