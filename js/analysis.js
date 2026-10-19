// Pure analysis over a track. A point is {lat, lon, t, e, d, alt, hr, b}:
// t = wall clock ms, e = moving seconds, d = cumulative metres, b = first point after a pause.
S.analysis = (() => {
  const U = S.util;

  const EFFORTS = [
    { m: 400, key: 'ef.400' }, { m: 1000, key: 'ef.1k' }, { m: 1609.34, key: 'ef.mile' },
    { m: 5000, key: 'goal.5k' }, { m: 10000, key: 'goal.10k' }, { m: 21097.5, key: 'goal.half' },
    { m: 42195, key: 'goal.full' },
  ];

  // For imported tracks (GPX): derive d and e from raw timestamps.
  function prepare(raw) {
    const pts = [];
    let d = 0, e = 0;
    for (let i = 0; i < raw.length; i++) {
      const p = { ...raw[i] };
      if (i > 0) {
        const prev = raw[i - 1];
        const dd = U.dist(prev, p);
        const dt = (p.t - prev.t) / 1000;
        d += dd;
        if (dt > 0 && dd / dt >= 0.4) e += Math.min(dt, 30); // stationary time doesn't count as moving
      }
      p.d = d; p.e = e;
      pts.push(p);
    }
    return pts;
  }

  function smooth(vals, w = 5) {
    const out = new Array(vals.length);
    for (let i = 0; i < vals.length; i++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(vals.length - 1, i + w); j++) if (vals[j] != null) { s += vals[j]; n++; }
      out[i] = n ? s / n : null;
    }
    return out;
  }

  function elevationGain(pts) {
    const alts = smooth(pts.map((p) => (p.alt == null ? null : p.alt)), 4);
    let gain = 0, ref = null;
    for (const a of alts) {
      if (a == null) continue;
      if (ref == null) { ref = a; continue; }
      if (a - ref >= 2) { gain += a - ref; ref = a; }
      else if (a < ref) ref = a;
    }
    return gain;
  }

  function summarize(pts) {
    if (!pts.length) return { distance: 0, moving: 0, elapsed: 0, elevGain: 0, avgHr: null, maxHr: null };
    const last = pts[pts.length - 1];
    let hrSum = 0, hrW = 0, maxHr = null;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.hr) {
        const w = Math.max(0, p.e - pts[i - 1].e) || 1;
        hrSum += p.hr * w; hrW += w;
        if (maxHr == null || p.hr > maxHr) maxHr = p.hr;
      }
    }
    return {
      distance: last.d, moving: last.e, elapsed: (last.t - pts[0].t) / 1000,
      elevGain: elevationGain(pts), avgHr: hrW ? Math.round(hrSum / hrW) : null, maxHr,
    };
  }

  // Interpolate moving time at a given cumulative distance.
  function timeAt(pts, dist, from = 0) {
    for (let i = Math.max(1, from); i < pts.length; i++) {
      if (pts[i].d >= dist) {
        const a = pts[i - 1], b = pts[i];
        const f = b.d === a.d ? 0 : (dist - a.d) / (b.d - a.d);
        return { e: a.e + f * (b.e - a.e), i };
      }
    }
    return null;
  }

  function splits(pts, every = 1000) {
    const out = [];
    if (pts.length < 2) return out;
    const total = pts[pts.length - 1].d;
    let prevE = 0, idx = 1, prevAlt = pts[0].alt;
    for (let k = every; k <= total; k += every) {
      const r = timeAt(pts, k, idx);
      if (!r) break;
      idx = r.i;
      const alt = pts[r.i].alt;
      out.push({ n: out.length + 1, dist: every, time: r.e - prevE, pace: (r.e - prevE) / (every / 1000), elev: alt != null && prevAlt != null ? alt - prevAlt : null });
      prevE = r.e; prevAlt = alt;
    }
    const rest = total - out.length * every;
    if (rest > 50) {
      const t = pts[pts.length - 1].e - prevE;
      out.push({ n: out.length + 1, dist: rest, time: t, pace: t / (rest / 1000), partial: true, elev: null });
    }
    return out;
  }

  // Fastest moving time over any continuous stretch of `dist` metres.
  function bestEffort(pts, dist) {
    if (!pts.length || pts[pts.length - 1].d < dist) return null;
    let best = Infinity, i = 0;
    for (let j = 1; j < pts.length; j++) {
      while (i + 1 < j && pts[j].d - pts[i + 1].d >= dist) i++;
      const span = pts[j].d - pts[i].d;
      if (span >= dist) {
        const t = (pts[j].e - pts[i].e) * (dist / span);
        if (t > 0 && t < best) best = t;
      }
    }
    return isFinite(best) ? best : null;
  }

  function bestEfforts(pts) {
    const out = {};
    for (const ef of EFFORTS) { const t = bestEffort(pts, ef.m); if (t) out[ef.m] = t; }
    return out;
  }

  // All-time ranking: for each distance, sorted list of {id, time}.
  function records(acts) {
    const byDist = {};
    for (const ef of EFFORTS) byDist[ef.m] = [];
    for (const a of acts) {
      if (a.type !== 'run' || !a.best) continue;
      for (const ef of EFFORTS) if (a.best[ef.m]) byDist[ef.m].push({ id: a.id, time: a.best[ef.m], start: a.start, name: a.name });
    }
    for (const k in byDist) byDist[k].sort((x, y) => x.time - y.time);
    return byDist;
  }

  // Pace series sampled every `step` metres, smoothed over `win` metres.
  function paceSeries(pts, step = 50, win = 250) {
    const xs = [], ys = [];
    if (pts.length < 2) return { xs, ys };
    const total = pts[pts.length - 1].d;
    let idx = 1;
    for (let d = win; d <= total; d += step) {
      const a = timeAt(pts, d - win, Math.max(1, idx - 50));
      const b = timeAt(pts, d, idx);
      if (!a || !b) continue;
      idx = b.i;
      const p = (b.e - a.e) / (win / 1000);
      xs.push(d / 1000); ys.push(p > 0 && p < 1200 ? p : null);
    }
    return { xs, ys };
  }

  function seriesBy(pts, key, step = 50) {
    const xs = [], ys = [];
    let next = 0;
    for (const p of pts) {
      if (p.d >= next) { xs.push(p.d / 1000); ys.push(p[key] ?? null); next = p.d + step; }
    }
    return { xs, ys: key === 'alt' ? smooth(ys, 3) : ys };
  }

  // Heart-rate zones as % of max HR.
  const ZONES = [
    { n: 'Z1', name: 'Herstel', lo: 0, hi: 0.6 }, { n: 'Z2', name: 'Duur', lo: 0.6, hi: 0.7 },
    { n: 'Z3', name: 'Tempo', lo: 0.7, hi: 0.8 }, { n: 'Z4', name: 'Drempel', lo: 0.8, hi: 0.9 },
    { n: 'Z5', name: 'Max', lo: 0.9, hi: 9 },
  ];
  function zoneOf(hr, maxHr) {
    const f = hr / maxHr;
    for (let z = 0; z < ZONES.length; z++) if (f < ZONES[z].hi) return z;
    return 4;
  }
  function timeInZones(pts, maxHr) {
    const out = [0, 0, 0, 0, 0];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (!p.hr) continue;
      const dt = p.e - pts[i - 1].e;
      if (dt > 0 && dt < 60) out[zoneOf(p.hr, maxHr)] += dt;
    }
    return out;
  }

  // Training load: Banister TRIMP if HR is available, else pace-based rTSS.
  function load(a, st) {
    const pts = a.points || [];
    let trimp = 0, hasHr = false;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (!p.hr) continue;
      hasHr = true;
      const dt = (p.e - pts[i - 1].e) / 60;
      if (dt <= 0 || dt > 1) continue;
      const r = Math.max(0, Math.min(1, (p.hr - st.restHr) / (st.maxHr - st.restHr)));
      trimp += dt * r * 0.64 * Math.exp(1.92 * r);
    }
    if (hasHr && trimp > 0) return Math.round(trimp);
    if (!a.moving || !a.distance) return 0;
    const avgPace = a.moving / (a.distance / 1000);
    let factor = st.thresholdPace / avgPace;
    if (a.type === 'walk' || a.type === 'hike') factor *= 0.6;
    if (a.type === 'ride') factor *= 0.5;
    return Math.round((a.moving / 3600) * factor * factor * 100);
  }

  // Fitness (CTL, 42d) / fatigue (ATL, 7d) / form (TSB) per day.
  function fitness(acts, st, days = 120) {
    const today = U.startOfDay(Date.now());
    const first = U.addDays(today, -(days + 120)); // warm-up so CTL isn't zero at the start
    const perDay = new Map();
    for (const a of acts) {
      const k = U.startOfDay(a.start);
      if (k < first) continue;
      perDay.set(k, (perDay.get(k) || 0) + (a.load ?? load(a, st)));
    }
    let ctl = 0, atl = 0;
    const out = [];
    for (let t = first; t <= today; t = U.addDays(t, 1)) {
      const l = perDay.get(t) || 0;
      ctl += (l - ctl) / 42; atl += (l - atl) / 7;
      if (t >= U.addDays(today, -days)) out.push({ t, ctl, atl, tsb: ctl - atl, load: l });
    }
    return out;
  }

  // Segment: does the activity pass start → end with roughly the right distance?
  function matchSegment(seg, a, tol = 35) {
    const pts = a.points || [];
    if (pts.length < 2) return null;
    const bb = a.bbox || U.bbox(pts);
    const s = seg.points[0], f = seg.points[seg.points.length - 1];
    const m = 0.0005;
    if (s.lat < bb.minLat - m || s.lat > bb.maxLat + m || s.lon < bb.minLon - m || s.lon > bb.maxLon + m) return null;
    const mid = seg.points[Math.floor(seg.points.length / 2)];
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      if (U.dist(pts[i], s) > tol) continue;
      // take the closest point of this pass over the start
      while (i + 1 < pts.length && U.dist(pts[i + 1], s) < U.dist(pts[i], s)) i++;
      let sawMid = false;
      for (let j = i + 1; j < pts.length; j++) {
        const span = pts[j].d - pts[i].d;
        if (span > seg.distance * 1.25) break;
        if (!sawMid && U.dist(pts[j], mid) < tol * 1.6) sawMid = true;
        if (span >= seg.distance * 0.85 && U.dist(pts[j], f) <= tol) {
          let k = j;
          while (k + 1 < pts.length && U.dist(pts[k + 1], f) < U.dist(pts[k], f)) k++;
          if (sawMid) {
            const time = pts[k].e - pts[i].e;
            if (time > 0 && (!best || time < best.time)) best = { time, i, j: k, activity: a.id, start: a.start, hr: avgHr(pts, i, k) };
          }
          break;
        }
      }
    }
    return best;
  }

  function avgHr(pts, i, j) {
    let s = 0, n = 0;
    for (let k = i; k <= j; k++) if (pts[k].hr) { s += pts[k].hr; n++; }
    return n ? Math.round(s / n) : null;
  }

  // Douglas–Peucker-ish thinning for stored segments/routes.
  function simplify(pts, eps = 6) {
    if (pts.length < 3) return pts.map((p) => ({ lat: p.lat, lon: p.lon }));
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    const lat0 = rad(pts[0].lat);
    const xy = pts.map((p) => [p.lon * 111320 * Math.cos(lat0), p.lat * 110540]);
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0, idx = -1;
      const [x1, y1] = xy[a], [x2, y2] = xy[b];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + x2 * y1 - y2 * x1) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]).map((p) => ({ lat: p.lat, lon: p.lon }));
  }
  function rad(d) { return (d * Math.PI) / 180; }

  // Rough energy estimate (clearly labelled as an estimate in the UI).
  function calories(a, st) {
    const kmv = (a.distance || 0) / 1000;
    const f = { run: 1.0, walk: 0.55, hike: 0.75, ride: 0.3 }[a.type] ?? 1;
    return Math.round(st.weight * kmv * f);
  }

  // Consecutive weeks (Mon–Sun) with at least one run, counting back from this week.
  // An empty current week doesn't break the streak — it isn't over yet.
  function weekStreak(starts) {
    const weeks = new Set(starts.map((s) => S.util.startOfWeek(s)));
    let w = S.util.startOfWeek(Date.now()), n = 0;
    if (!weeks.has(w)) w = S.util.addDays(w, -7);
    while (weeks.has(w)) { n++; w = S.util.addDays(w, -7); }
    return n;
  }

  // Everything derived that we store with an activity.
  function finalize(a) {
    Object.assign(a, summarize(a.points));
    a.bbox = a.points.length ? U.bbox(a.points) : null;
    a.best = a.type === 'run' ? bestEfforts(a.points) : {};
    return a;
  }

  return {
    EFFORTS, ZONES, prepare, summarize, splits, bestEffort, bestEfforts, records, paceSeries, seriesBy,
    zoneOf, timeInZones, load, fitness, matchSegment, simplify, calories, finalize, timeAt, elevationGain, weekStreak,
  };
})();
