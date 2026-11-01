// Orbe : canvas 2D, machine d'états finis.
import { $ } from './dom.js';

const RM = matchMedia('(prefers-reduced-motion:reduce)').matches;

export const orb = (() => {
  const cv = $('orb'), ctx = cv.getContext('2d');
  const S = cv.width / 2, C = S / 2;
  const STATES = {
    idle:     { h1: 255, h2: 195, speed: .35, pulse: .035 },
    fetch:    { h1: 230, h2: 190, speed: 1.4, pulse: .10 },
    work:     { h1: 275, h2: 210, speed: 1.0, pulse: .07 },
    reduce:   { h1: 290, h2: 250, speed: .8,  pulse: .05 },
    download: { h1: 190, h2: 200, speed: .9,  pulse: .05 },
    done:     { h1: 150, h2: 160, speed: .3,  pulse: .03 },
    err:      { h1: 0,   h2: 15,  speed: .15, pulse: .02 },
  };
  let state = 'idle', prog = 0, t0 = performance.now();
  const hsl = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;

  function draw(t) {
    const s = STATES[state], dt = (t - t0) / 1000;
    const k = 1 + Math.sin(dt * 2.2 * s.speed * 3) * s.pulse;
    ctx.clearRect(0, 0, S, S);
    let g = ctx.createRadialGradient(C, C, C * .1, C, C, C * 1.15);
    g.addColorStop(0, hsl(s.h1, 85, 62, .30));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const wob = Math.sin(dt * s.speed) * 4;
    g = ctx.createRadialGradient(C - 8 + wob, C - 10, C * .08, C, C, C * .72 * k);
    g.addColorStop(0, hsl(s.h2, 95, 78, .95));
    g.addColorStop(.55, hsl(s.h1, 85, 60, .9));
    g.addColorStop(1, hsl(s.h1, 80, 42, .15));
    ctx.beginPath();
    ctx.arc(C, C, C * .68 * k, 0, 7);
    ctx.fillStyle = g;
    ctx.fill();
    for (let i = 0; i < 2; i++) {
      const a = dt * s.speed * (i ? -1.3 : 1) + i * 2.1, r = C * .30;
      const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r * .8;
      g = ctx.createRadialGradient(x, y, 0, x, y, C * .26);
      g.addColorStop(0, hsl(i ? (s.h3 || 300) : s.h2, 90, 75, .5));
      g.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(x, y, C * .26, 0, 7);
      ctx.fillStyle = g;
      ctx.fill();
    }
    if ((state === 'work' || state === 'download') && prog > 0) {
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath();
      ctx.arc(C, C, C * .82, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = hsl(s.h2, 95, 72, .95);
      ctx.beginPath();
      ctx.arc(C, C, C * .82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
      ctx.stroke();
    }
  }

  function loop(t) { draw(t); requestAnimationFrame(loop); }
  if (RM) { draw(0); } else requestAnimationFrame(loop);
  return {
    set(ns, p) {
      state = STATES[ns] ? ns : 'idle';
      prog = p || 0;
      t0 = performance.now();
      if (RM) draw(0);
    }
  };
})();
