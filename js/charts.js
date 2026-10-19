// Tiny canvas charts with touch scrubbing.
S.charts = (() => {
  const U = S.util;

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // opts: color, invert (pace: lower is better = higher on chart), fmtY, fmtX, fill, min, max
  function line(canvas, xs, ys, opts = {}) {
    const draw = (hover) => {
      const { ctx, w, h } = setup(canvas);
      const pad = { l: 40, r: 8, t: 10, b: 20 };
      const vals = ys.filter((v) => v != null);
      ctx.clearRect(0, 0, w, h);
      if (vals.length < 2) {
        ctx.fillStyle = U.css('--muted'); ctx.font = '13px sans-serif';
        ctx.fillText('Geen gegevens', pad.l, h / 2); return;
      }
      let lo = opts.min ?? Math.min(...vals), hi = opts.max ?? Math.max(...vals);
      if (opts.robust) { // ignore outliers for pace
        const s = [...vals].sort((a, b) => a - b);
        lo = s[Math.floor(s.length * 0.03)]; hi = s[Math.floor(s.length * 0.97)];
      }
      if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
      const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
      const x0 = xs[0], x1 = xs[xs.length - 1] || 1;
      const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
      const Y = (y) => {
        const f = (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo);
        return opts.invert ? pad.t + f * (h - pad.t - pad.b) : h - pad.b - f * (h - pad.t - pad.b);
      };
      const color = opts.color || U.css('--accent');
      // grid + labels
      ctx.strokeStyle = U.css('--line'); ctx.lineWidth = 1; ctx.fillStyle = U.css('--muted'); ctx.font = '11px sans-serif';
      const fy = opts.fmtY || ((v) => Math.round(v));
      for (let g = 0; g <= 2; g++) {
        const v = lo + ((hi - lo) * g) / 2;
        const y = Y(v);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillText(fy(v), 2, y + 4);
      }
      const fx = opts.fmtX || ((v) => v.toFixed(1));
      ctx.fillText(fx(x0), pad.l, h - 4);
      const lx = fx(x1); ctx.fillText(lx, w - pad.r - ctx.measureText(lx).width, h - 4);
      // area + line
      ctx.beginPath();
      let started = false, firstX = 0, lastX = 0;
      for (let i = 0; i < xs.length; i++) {
        if (ys[i] == null) continue;
        const x = X(xs[i]), y = Y(ys[i]);
        if (!started) { ctx.moveTo(x, y); started = true; firstX = x; } else ctx.lineTo(x, y);
        lastX = x;
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      if (opts.fill !== false) {
        ctx.lineTo(lastX, h - pad.b); ctx.lineTo(firstX, h - pad.b); ctx.closePath();
        const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
        ctx.fillStyle = g; ctx.fill();
      }
      if (hover != null) {
        // nearest index
        let best = -1, bd = Infinity;
        for (let i = 0; i < xs.length; i++) { if (ys[i] == null) continue; const d = Math.abs(X(xs[i]) - hover); if (d < bd) { bd = d; best = i; } }
        if (best >= 0) {
          const x = X(xs[best]), y = Y(ys[best]);
          ctx.strokeStyle = U.css('--text'); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.globalAlpha = 1;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
          const label = `${fy(ys[best])} · ${fx(xs[best])}`;
          ctx.font = 'bold 12px sans-serif';
          const tw = ctx.measureText(label).width + 12;
          const bx = Math.min(w - tw - 2, Math.max(pad.l, x - tw / 2));
          ctx.fillStyle = U.css('--bg-3'); ctx.fillRect(bx, 0, tw, 18);
          ctx.fillStyle = U.css('--text'); ctx.fillText(label, bx + 6, 13);
          if (opts.onHover) opts.onHover(best);
        }
      }
    };
    draw(null);
    const move = (ev) => {
      const r = canvas.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      draw(cx);
    };
    canvas.onmousemove = move; canvas.ontouchstart = move; canvas.ontouchmove = move;
    canvas.onmouseleave = () => { draw(null); opts.onHover && opts.onHover(null); };
    canvas.ontouchend = () => { draw(null); opts.onHover && opts.onHover(null); };
  }

  function bars(canvas, labels, values, opts = {}) {
    const { ctx, w, h } = setup(canvas);
    const pad = { l: 4, r: 4, t: 18, b: 20 };
    const max = Math.max(1, ...values);
    const n = values.length, gap = 6;
    const bw = (w - pad.l - pad.r - gap * (n - 1)) / n;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const x = pad.l + i * (bw + gap);
      const bh = (values[i] / max) * (h - pad.t - pad.b);
      const last = i === n - 1;
      ctx.fillStyle = last ? U.css('--accent') : U.css('--muted');
      ctx.globalAlpha = last ? 1 : 0.55;
      const r = Math.min(4, bw / 2);
      const y = h - pad.b - bh;
      if (bh > 0) {
        ctx.beginPath();
        ctx.moveTo(x, h - pad.b); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r); ctx.lineTo(x + bw, h - pad.b); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = U.css('--muted');
      if (labels[i]) ctx.fillText(labels[i], x + bw / 2, h - 5);
      if (values[i] > 0 && (last || opts.allValues)) {
        ctx.fillStyle = U.css('--text');
        ctx.fillText(opts.fmt ? opts.fmt(values[i]) : values[i], x + bw / 2, Math.max(11, y - 5));
      }
    }
    ctx.textAlign = 'start';
  }

  // Multi-line (fitness/fatigue/form).
  function multi(canvas, xs, series, opts = {}) {
    const { ctx, w, h } = setup(canvas);
    const pad = { l: 30, r: 6, t: 8, b: 20 };
    const all = series.flatMap((s) => s.ys);
    let lo = Math.min(0, ...all), hi = Math.max(10, ...all);
    const X = (i) => pad.l + (i / Math.max(1, xs.length - 1)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - ((v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = U.css('--line'); ctx.fillStyle = U.css('--muted'); ctx.font = '11px sans-serif';
    for (const v of [lo, 0, hi]) { const y = Y(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(Math.round(v), 2, y + 4); }
    if (opts.fmtX) { ctx.fillText(opts.fmtX(xs[0]), pad.l, h - 4); const l = opts.fmtX(xs[xs.length - 1]); ctx.fillText(l, w - pad.r - ctx.measureText(l).width, h - 4); }
    for (const s of series) {
      ctx.beginPath();
      s.ys.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // Thumbnail of a route on a canvas.
  function thumb(canvas, pts, color) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!pts || pts.length < 2) return;
    const bb = U.bbox(pts);
    const k = Math.cos(((bb.minLat + bb.maxLat) / 2) * Math.PI / 180);
    const sx = (bb.maxLon - bb.minLon) * k || 1e-6, sy = bb.maxLat - bb.minLat || 1e-6;
    const s = Math.min((w - 14) / sx, (h - 14) / sy);
    const ox = (w - sx * s) / 2, oy = (h - sy * s) / 2;
    const step = Math.max(1, Math.floor(pts.length / 400));
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += step) {
      const x = ox + (pts[i].lon - bb.minLon) * k * s, y = h - oy - (pts[i].lat - bb.minLat) * s;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = color || U.css('--accent'); ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }

  function ring(svgEl, frac) {
    const r = 50, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    svgEl.innerHTML = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--bg-3)" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c * f} ${c}" transform="rotate(-90 60 60)"/>`;
  }

  return { line, bars, multi, thumb, ring };
})();
