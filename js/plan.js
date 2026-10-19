// Training plan generator: gradual build, recovery every 4th week, taper, race.
// Workouts are stored as structured data; text() renders them in the current language.
S.plan = (() => {
  const U = S.util;
  const GOALS = {
    5000: { key: 'goal.5k', peak: 28, longMax: 12, taper: 1 },
    10000: { key: 'goal.10k', peak: 38, longMax: 16, taper: 1 },
    21097.5: { key: 'goal.half', peak: 48, longMax: 20, taper: 2 },
    42195: { key: 'goal.full', peak: 65, longMax: 32, taper: 3 },
  };
  const DAYSETS = { 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6] }; // 0 = Monday

  function label(goal) { return t(GOALS[goal].key); }

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

    for (let w = 0; w < n; w++) {
      const weekStart = U.addDays(raceWeek, -7 * (n - 1 - w));
      let vol;
      if (w < build) {
        vol = startKm + (peak - startKm) * (build > 1 ? w / (build - 1) : 1);
        if (w % 4 === 3 && w !== build - 1) vol *= 0.8;
      } else {
        vol = peak * (1 - 0.2 * (w - build + 1));
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
        if (isRaceWeek && i === raceDow) { workouts.push({ date, kind: 'race', sub: 'race', km: goal / 1000, goal }); continue; }
        if (isRaceWeek && i > raceDow) continue;
        if (!days.includes(i)) { workouts.push({ date, kind: 'rest', sub: 'rest', km: 0 }); continue; }
        if (i === 6 && !isRaceWeek) {
          workouts.push({ date, kind: 'long', sub: 'long', km: longKm, pace: tp * 1.28 });
        } else if (i === days[0] && !workouts.some((x) => x.kind === 'quality')) {
          if (isRaceWeek) workouts.push({ date, kind: 'quality', sub: 'strides', km: 5 });
          else if (intervals) {
            const reps = Math.max(4, Math.min(10, Math.round(qualKm / 1.2)));
            workouts.push({ date, kind: 'quality', sub: 'intervals', km: qualKm + 3, reps, pace: tp * 0.92 });
          } else {
            const tk = Math.max(3, Math.round(qualKm * 0.8));
            workouts.push({ date, kind: 'quality', sub: 'tempo', km: tk + 3, tk, pace: tp });
          }
        } else {
          workouts.push({ date, kind: 'easy', sub: 'easy', km: isRaceWeek ? Math.min(5, easyKm) : easyKm, pace: tp * 1.25 });
        }
      }
      weeks.push({ weekStart, km: Math.round(workouts.reduce((s, x) => s + x.km, 0)), workouts, recovery: w < build && w % 4 === 3, taper: w >= build });
    }
    return { v: 2, goal, raceDate, runsPerWeek, startKm, createdAt: Date.now(), weeks };
  }

  function text(x) {
    const p = x.pace ? U.pace(x.pace) : '';
    switch (x.sub) {
      case 'race': return { title: t('w.race', { goal: label(x.goal) }), desc: t('w.race.d') };
      case 'rest': return { title: t('w.rest'), desc: t('w.rest.d') };
      case 'long': return { title: t('w.long', { km: x.km }), desc: t('w.long.d', { pace: p }) };
      case 'strides': return { title: t('w.strides'), desc: t('w.strides.d') };
      case 'intervals': return { title: t('w.int', { reps: x.reps }), desc: t('w.int.d', { reps: x.reps, pace: p }) };
      case 'tempo': return { title: t('w.tempo', { km: x.tk }), desc: t('w.tempo.d', { km: x.tk, pace: p }) };
      default: return { title: t('w.easy', { km: x.km }), desc: t('w.easy.d', { pace: p }) };
    }
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
    if (!plan || plan.v !== 2) return null;
    const today = U.startOfDay(Date.now());
    for (const w of plan.weeks) for (const x of w.workouts) if (U.startOfDay(x.date) === today) return x;
    return null;
  }

  return { GOALS, label, generate, text, status, todays };
})();
