// WhatScares atmosphere engine — grain tile, ambient flicker, flashlight, konami.
// Shared across index / threshold / film pages. Everything degrades silently.
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── grain: paint one noise tile, reuse as background ───
  const grainEl = document.getElementById('grain');
  if (grainEl) {
    const c = document.createElement('canvas');
    c.width = c.height = 144;
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(144, 144);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = (Math.random() * 80 + 30) | 0;
    }
    ctx.putImageData(d, 0, 0);
    grainEl.style.backgroundImage = `url(${c.toDataURL()})`;
  }

  // ─── flicker: rare, subtle, occasionally a double-blink ───
  const flickerEl = document.getElementById('flicker');
  function pulse(strength, hold) {
    if (!flickerEl) return;
    flickerEl.style.transition = 'none';
    flickerEl.style.opacity = String(strength);
    setTimeout(() => {
      flickerEl.style.transition = 'opacity 0.28s ease-out';
      flickerEl.style.opacity = '0';
    }, hold);
  }
  window.atmoBurst = function (n) { // public: a short burst of pulses
    if (reduced) return;
    let i = 0;
    (function next() {
      if (i++ >= n) return;
      pulse(0.08 + Math.random() * 0.1, 50 + Math.random() * 70);
      setTimeout(next, 120 + Math.random() * 160);
    })();
  };
  if (!reduced && flickerEl) {
    (function schedule() {
      setTimeout(() => {
        pulse(0.03 + Math.random() * 0.07, 60 + Math.random() * 80);
        if (Math.random() < 0.3) setTimeout(() => pulse(0.04 + Math.random() * 0.06, 60), 180);
        schedule();
      }, 9000 + Math.random() * 17000);
    })();
  }

  // ─── flashlight: lights-out mode ───
  const LIGHTS_KEY = 'ws-lights';
  const flashEl = document.getElementById('flashlight');
  let tracking = false, rafId = 0, px = innerWidth / 2, py = innerHeight * 0.38;
  function paint() {
    rafId = 0;
    if (!flashEl) return;
    flashEl.style.setProperty('--lx', px + 'px');
    flashEl.style.setProperty('--ly', py + 'px');
  }
  function onMove(e) {
    const t = e.touches ? e.touches[0] : e;
    px = t.clientX; py = t.clientY;
    if (!rafId) rafId = requestAnimationFrame(paint);
  }
  function setTracking(on) {
    if (on === tracking) return;
    tracking = on;
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('mousemove', onMove, { passive: true });
    window[fn]('touchmove', onMove, { passive: true });
  }
  function updateLightsBtn() {
    const btn = document.getElementById('lightsBtn');
    if (!btn) return;
    const out = document.body.classList.contains('lights-out');
    btn.innerHTML = out ? '&#9681; lights on' : '&#9680; lights out';
    btn.setAttribute('aria-pressed', String(out));
  }
  window.toggleLights = function () {
    const out = document.body.classList.toggle('lights-out');
    try { localStorage.setItem(LIGHTS_KEY, out ? '1' : '0'); } catch (e) {}
    setTracking(out);
    if (out) paint();
    updateLightsBtn();
  };
  let lightsPref = false;
  try { lightsPref = localStorage.getItem(LIGHTS_KEY) === '1'; } catch (e) {}
  if (lightsPref && flashEl) {
    document.body.classList.add('lights-out');
    setTracking(true);
    paint();
  }
  updateLightsBtn();

  // ─── konami: ↑↑↓↓←→←→BA drops the lights with a burst ───
  const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let pos = 0;
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    pos = e.key === seq[pos] ? pos + 1 : (e.key === seq[0] ? 1 : 0);
    if (pos === seq.length) {
      pos = 0;
      if (!document.body.classList.contains('lights-out')) window.toggleLights();
      if (window.atmoBurst) window.atmoBurst(5);
    }
  });

  // ─── witching hour ───
  if (new Date().getHours() === 3) document.body.classList.add('witching');
})();
