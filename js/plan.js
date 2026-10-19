// Training plan generator: gradual build, recovery every 4th week, taper, race.
S.plan = (() => {
  const U = S.util;
  const GOALS = {
    5000: { label: '5 km', peak: 28, longMax: 12, taper: 1 },
    10000: { label: '10 km', peak: 38, longMax: 16, taper: 1 },
    21097.5: { label: 'Halve marathon', peak: 48, longMax: 20, taper: 2 },
    42195: { label: 'Marathon', peak: 65, longMax: 32, taper: 3 },
  };
  const DAYSETS = { 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6] }; // 0 = Monday

  function generate({ goal, raceDate, runsPerWeek, startKm, thresholdPace }) {
    const g = GOALS[goal];
    const firstWeek = U.startOfWeek(Date.now());
    const raceWeek = U.startOfWeek(raceDate);
    let n = Math.round((raceWeek - firstWeek) / (7 * 864e5)) + 1;
    n = Math.max(3, Math.min(24, n));
    const peak = Math.max(g.peak, startKm * 1.15);
    const taper = Math.min(g.taper, n - 2);
    const build = n - taper;
    const weeks = [];
    const tp = thresholdPace || 300;
    const fmt = (spk) => U.pace(spk) + ' /km';

    for (let w = 0; w < n; w++) {
      const weekStart = U.addDays(raceWeek, -7 * (n - 1 - w));
      let vol;
      if (w < build) {
        vol = startKm + (peak - startKm) * (build > 1 ? w / (build - 1) : 1);
        if (w % 4 === 3 && w !== build - 1) vol *= 0.8;
      } else {
        const t = w - build + 1; // 1..taper
        vol = peak * (1 - 0.2 * t);
      }
      vol = Math.max(8, Math.round(vol));
      const days = DAYSETS[runsPerWeek] || DAYSETS[4];
      const isRaceWeek = w === n - 1;
      const raceDow = (new Date(raceDate).getDay() + 6) % 7;
      const workouts = [];
      const longKm = Math.min(g.longMax, Math.round(vol * (runsPerWeek <= 3 ? 0.4 : 0.32)));
      const qualKm = Math.round(vol * 0.2);
      const easyCount = days.length - 2;
      const easyKm = Math.max(3, Math.round((vol - longKm - qualKm) / Math.max(1, easyCount)));
      const intervals = w % 2 === 0;

      for (let i = 0; i < 7; i++) {
        const date = U.addDays(weekStart, i);
        if (isRaceWeek && i === raceDow) {
          workouts.push({ date, kind: 'race', title: `Wedstrijd: ${g.label}`, km: goal / 1000, desc: 'Rustig inlopen, goed doseren in de eerste kilometers. Succes!' });
          continue;
        }
        if (isRaceWeek && i > raceDow) continue;
        if (!days.includes(i)) { workouts.push({ date, kind: 'rest', title: 'Rust', km: 0, desc: 'Rust of lichte cross-training.' }); continue; }
        if (i === 6 && !isRaceWeek) {
          workouts.push({ date, kind: 'long', title: `Duurloop ${longKm} km`, km: longKm, desc: `Rustig en ontspannen, ca. ${fmt(tp * 1.28)}. Het laatste deel mag iets sneller.` });
        } else if (i === days[0] || (i === 1 && days.includes(1))) {
          if (workouts.some((x) => x.kind === 'quality')) {
            workouts.push(easy(date, easyKm, tp));
          } else if (isRaceWeek) {
            workouts.push({ date, kind: 'quality', title: 'Prikkel 4 × 400 m', km: 5, desc: `Inlopen 2 km, 4 × 400 m op wedstrijdtempo met 200 m dribbel, uitlopen.` });
          } else if (intervals) {
            const reps = Math.max(4, Math.min(10, Math.round(qualKm / 1.2)));
            workouts.push({ date, kind: 'quality', title: `Intervallen ${reps} × 800 m`, km: qualKm + 3, desc: `Inlopen 2 km, ${reps} × 800 m op ${fmt(tp * 0.92)} met 400 m dribbel, 1 km uitlopen.` });
          } else {
            const tk = Math.max(3, Math.round(qualKm * 0.8));
            workouts.push({ date, kind: 'quality', title: `Tempoloop ${tk} km`, km: tk + 3, desc: `Inlopen 2 km, ${tk} km op ${fmt(tp)} (drempeltempo), 1 km uitlopen.` });
          }
        } else {
          workouts.push(easy(date, isRaceWeek ? Math.min(5, easyKm) : easyKm, tp));
        }
      }
      weeks.push({ weekStart, km: Math.round(workouts.reduce((s, x) => s + x.km, 0)), workouts, recovery: w < build && w % 4 === 3, taper: w >= build });
    }
    return { goal, label: g.label, raceDate, runsPerWeek, startKm, createdAt: Date.now(), weeks };
  }

  function easy(date, km, tp) {
    return { date, kind: 'easy', title: `Rustige duurloop ${km} km`, km, desc: `Op gevoel, je moet kunnen praten (ca. ${U.pace(tp * 1.25)} /km).` };
  }

  // Mark a workout done if a run that day covered ≥ 70% of the target distance.
  function status(plan, acts) {
    const byDay = new Map();
    for (const a of acts) {
      if (a.type !== 'run') continue;
      const k = U.startOfDay(a.start);
      byDay.set(k, (byDay.get(k) || 0) + a.distance / 1000);
    }
    const today = U.startOfDay(Date.now());
    for (const w of plan.weeks) for (const x of w.workouts) {
      const day = U.startOfDay(x.date);
      const ran = byDay.get(day) || 0;
      x.done = x.kind !== 'rest' && ran >= x.km * 0.7;
      x.missed = x.kind !== 'rest' && !x.done && day < today;
      x.today = day === today;
    }
    return plan;
  }

  function todays(plan) {
    if (!plan) return null;
    const today = U.startOfDay(Date.now());
    for (const w of plan.weeks) for (const x of w.workouts) if (U.startOfDay(x.date) === today) return x;
    return null;
  }

  return { GOALS, generate, status, todays };
})();
