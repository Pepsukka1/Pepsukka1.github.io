// Dot Grid Flicker — original Canvas-2D effect, scoped to this gem's root.
// A full-bleed matrix of tiny square dots wakes up from the centre outwards,
// then flickers forever: each dot re-rolls its brightness on its own random
// clock, in hard steps (digital, not a fade). The canvas is a persistent
// surface — every frame we scan the dots but repaint only the ones whose
// clock came due, so ~10k dots cost a few hundred rect ops per frame.
// Colours come from the brand tokens; a rare dot pops in solar or lime.
window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector(".byq-gem--dot-grid-flicker-01");
  if (!root) return;

  const canvas = root.querySelector(".byq-gem--dot-grid-flicker-01__canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // no 2D context → the bg token background stands alone

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // --- Brand tokens → dot palette (fallbacks only guard a missing token) ----
  const css = getComputedStyle(root);
  const token = (name, fallback) =>
    (css.getPropertyValue(name) || fallback).trim();
  const FG = token("--byq-fg", "#f6f3ec");
  const SOLAR = token("--byq-accent-solar", "#ffcd33");
  const LIME = token("--byq-accent-lime", "#c5ef57");

  // --- Tuning ----------------------------------------------------------------
  const CELL = 14; // grid pitch, CSS px
  const DOT = 3; // square dot size, CSS px
  const MAX_ALPHA = 0.85; // steady-state ceiling; the reveal flash goes to 1
  const OFF_CHANCE = 0.16; // share of rolls that switch a dot fully off
  const ACCENT_CHANCE = 0.05; // rare solar/lime dots — the sparing pop
  const INTRO_SPREAD = 900; // ms from centre dot to corner dot
  const INTRO_JITTER = 350; // ms of per-dot randomness on top
  const FLASH_MS = 140; // reveal pop duration before settling

  // Brightness re-roll: squared random keeps the field mostly dim, and a
  // slice of rolls lands fully off so the matrix stays sparse and alive.
  const rollAlpha = () => {
    if (Math.random() < OFF_CHANCE) return 0;
    const r = Math.random();
    return 0.08 + r * r * (MAX_ALPHA - 0.08);
  };
  const rollDelay = () => 400 + Math.random() * 1100;

  // --- Grid ------------------------------------------------------------------
  // Everything is drawn in device pixels (no ctx.scale) so dots stay crisp
  // at any devicePixelRatio.
  let cells = [];
  let dotPx = DOT;

  const paint = (cell) => {
    ctx.clearRect(cell.x, cell.y, dotPx, dotPx);
    if (cell.alpha <= 0) return;
    ctx.globalAlpha = cell.alpha;
    ctx.fillStyle = cell.color;
    ctx.fillRect(cell.x, cell.y, dotPx, dotPx);
  };

  // Each dot is a tiny state machine driven by one timestamp:
  // phase 0 = hidden, waiting for its centre-out reveal time
  // phase 1 = reveal flash (full brightness for FLASH_MS)
  // phase 2 = endless flicker (re-roll alpha, schedule the next roll)
  const build = (introStart) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w; // also clears the surface
    canvas.height = h;

    const cellPx = Math.max(4, Math.round(CELL * dpr));
    dotPx = Math.max(1, Math.round(DOT * dpr));
    const cols = Math.floor(w / cellPx) + 1;
    const rows = Math.floor(h / cellPx) + 1;
    const offX = Math.round((w - (cols - 1) * cellPx - dotPx) / 2);
    const offY = Math.round((h - (rows - 1) * cellPx - dotPx) / 2);

    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const maxDist = Math.hypot(cx, cy) || 1;

    cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dist = Math.hypot(col - cx, row - cy) / maxDist; // 0 centre → 1 corner
        const accent = Math.random() < ACCENT_CHANCE;
        cells.push({
          x: offX + col * cellPx,
          y: offY + row * cellPx,
          color: accent ? (Math.random() < 0.5 ? SOLAR : LIME) : FG,
          // Soft vignette: dots dim towards the edges so the field has depth.
          gain: 1 - 0.55 * dist * dist,
          alpha: 0,
          phase: 0,
          nextAt: introStart + dist * INTRO_SPREAD + Math.random() * INTRO_JITTER,
        });
      }
    }
  };

  // Skip the intro: drop every dot straight into phase 2 at a settled
  // brightness (used for reduced motion and for rebuilds after a resize).
  const settleAll = (now) => {
    for (const cell of cells) {
      cell.phase = 2;
      cell.alpha = rollAlpha() * cell.gain;
      cell.nextAt = now + Math.random() * 1500;
      paint(cell);
    }
  };

  build(0); // intro times are relative — the first painted frame anchors them
  let anchored = false; // flips once cell timestamps are absolute

  // --- Refit on resize / DPR change ------------------------------------------
  const refit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height) return;
    build(0);
    settleAll(performance.now()); // no intro replay — straight to the field
    anchored = true;
  };

  // Debounced so a live window drag doesn't rebuild (and visibly reshuffle)
  // the field on every event. The re-armed resolution query catches a
  // monitor-to-monitor DPR change, which Safari doesn't report via resize.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refit, 120);
  });
  const watchDpr = () => {
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    query.addEventListener(
      "change",
      () => {
        refit();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();

  if (reduceMotion) {
    // Static composition: the settled field, no intro, no flicker.
    settleAll(0);
    return;
  }

  // While the tab is hidden rAF stops but the clock keeps running; shift every
  // pending timestamp by the hidden stretch so the intro (or the flicker
  // rhythm) resumes where it left off instead of the whole field firing at once.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = performance.now();
    } else if (hiddenAt && anchored) {
      const pause = performance.now() - hiddenAt;
      for (const cell of cells) cell.nextAt += pause;
    }
    if (!document.hidden) hiddenAt = 0;
  });

  // --- Live loop ---------------------------------------------------------------
  const tick = (now) => {
    if (!anchored) {
      // First painted frame: pin the relative intro times to the rAF clock,
      // so a load in a background tab still gets its centre-out wake-up.
      anchored = true;
      for (const cell of cells) cell.nextAt += now;
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (now < cell.nextAt) continue;
      if (cell.phase === 0) {
        // Reveal: a brief full-brightness pop before the first settle.
        cell.phase = 1;
        cell.alpha = cell.gain;
        cell.nextAt = now + FLASH_MS;
      } else {
        cell.phase = 2;
        cell.alpha = rollAlpha() * cell.gain;
        cell.nextAt = now + rollDelay();
      }
      paint(cell);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
