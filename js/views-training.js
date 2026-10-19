S.views.training = {
  tab: 'training', titleKey: 'tab.training',
  async render(main) {
    const U = S.util, A = S.analysis;
    const acts = await S.db.activities();
    const st = await S.db.settings();
    let plan = await S.db.kvGet('plan', null);
    if (plan && plan.v !== 2) plan = null; // plans from before translations: rebuild
    if (plan) S.plan.status(plan, acts);

    const runs = acts.filter((a) => a.type === 'run');
    const thisWeek = U.startOfWeek(Date.now());
    const weekKm = runs.filter((a) => a.start >= thisWeek).reduce((s, a) => s + a.distance, 0) / 1000;
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const ws = U.addDays(thisWeek, -7 * i), we = U.addDays(ws, 7);
      weeks.push({ ws, km: runs.filter((a) => a.start >= ws && a.start < we).reduce((s, a) => s + a.distance, 0) / 1000 });
    }
    const fit = A.fitness(acts, st, 90);
    const now = fit[fit.length - 1] || { ctl: 0, atl: 0, tsb: 0 };
    const formTxt = now.tsb > 5 ? t('form.fresh') : now.tsb < -20 ? t('form.tired') : now.tsb < -5 ? t('form.building') : t('form.balanced');
    const weekLoad = acts.filter((a) => a.start >= thisWeek).reduce((s, a) => s + (a.load ?? A.load(a, st)), 0);
    const kindLabel = (k) => t('kind.' + k);

    let planHtml;
    if (plan) {
      const curIdx = Math.max(0, plan.weeks.findIndex((w) => thisWeek >= w.weekStart && thisWeek < U.addDays(w.weekStart, 7)));
      const show = plan.weeks.slice(curIdx, curIdx + 2);
      const past = plan.weeks.flatMap((w) => w.workouts).filter((x) => x.kind !== 'rest' && x.date < U.startOfDay(Date.now()));
      const pct = past.length ? Math.round((past.filter((x) => x.done).length / past.length) * 100) : null;
      const daysLeft = Math.ceil((U.startOfDay(plan.raceDate) - U.startOfDay(Date.now())) / 864e5);
      planHtml = `<div class="card">
        <div class="row between"><div><h3 style="margin:0">${U.esc(S.plan.label(plan.goal))}</h3><div class="small muted">${U.date(plan.raceDate)} · ${daysLeft >= 0 ? t('plan.daysLeft', { n: daysLeft }) : t('plan.past')}</div></div>
        ${pct != null ? `<div style="text-align:right"><b>${pct}%</b><div class="small muted">${t('plan.done')}</div></div>` : ''}</div></div>
        ${show.map((w, k) => `<div class="card"><div class="row between" style="margin-bottom:6px"><b>${k === 0 ? t('plan.thisWeek') : t('plan.nextWeek')}${w.recovery ? ' · ' + t('plan.recovery') : w.taper ? ' · ' + t('plan.taper') : ''}</b><span class="small muted">${w.km} km</span></div>
          ${w.workouts.map((x) => { const tx = S.plan.text(x); return `<div class="workout ${x.done ? 'done' : ''} ${x.today ? 'today' : ''}">
            <div class="day">${U.weekday(x.date)}<b>${new Date(x.date).getDate()}</b></div>
            <div class="grow"><div class="title"><span class="tag ${x.kind}">${kindLabel(x.kind)}</span> ${U.esc(tx.title)}</div>
            ${x.kind !== 'rest' ? `<div class="small muted">${U.esc(tx.desc)}</div>` : ''}${x.missed ? `<div class="small" style="color:var(--warn)">${t('plan.missed')}</div>` : ''}</div></div>`; }).join('')}
        </div>`).join('')}
        <div class="btn-row"><button class="btn grow" id="planAll">${t('plan.full')}</button><button class="btn danger" id="planDel">${t('plan.stop')}</button></div>`;
    } else {
      planHtml = `<div class="card"><h3>${t('plan.title')}</h3><p class="muted small">${t('plan.intro')}</p>
        <button class="btn primary block" id="planNew">${t('plan.make')}</button></div>`;
    }

    main.innerHTML = `
      <div class="card goal">
        <svg class="ring" viewBox="0 0 120 120" id="ring"></svg>
        <div class="grow"><div class="small muted">${t('goal.weekly')}</div>
          <div style="font-size:26px;font-weight:800">${U.num(weekKm, 1)} <span class="muted" style="font-size:16px">/ ${st.weeklyGoalKm} km</span></div>
          <div class="small muted">${weekKm >= st.weeklyGoalKm ? t('goal.reached') : t('goal.left', { km: U.num(st.weeklyGoalKm - weekKm, 1) })}</div>
          <button class="btn sm" id="goalBtn" style="margin-top:8px">${t('goal.change')}</button></div>
      </div>
      <div class="section-title">${t('tr.perWeek')}</div>
      <div class="card"><canvas class="chart" id="wBars"></canvas></div>

      <div class="section-title">${t('tr.fitness')}</div>
      <div class="card">
        <div class="stats"><div class="stat"><div class="v">${Math.round(now.ctl)}</div><div class="l">${t('fit.ctl')}</div></div>
        <div class="stat"><div class="v">${Math.round(now.atl)}</div><div class="l">${t('fit.atl')}</div></div>
        <div class="stat"><div class="v">${now.tsb > 0 ? '+' : ''}${Math.round(now.tsb)}</div><div class="l">${t('fit.tsb')}</div></div></div>
        <p class="small" style="margin:10px 0">${formTxt}. ${t('tr.weekLoad')}: <b>${weekLoad}</b>.</p>
        <canvas class="chart tall" id="fitChart"></canvas>
        <div class="small muted row" style="gap:14px;margin-top:6px;flex-wrap:wrap"><span><b style="color:var(--accent)">—</b> ${t('fit.ctl.l')}</span><span><b style="color:#ff5c5c">—</b> ${t('fit.atl.l')}</span><span><b style="color:#4fa3ff">- -</b> ${t('fit.tsb')}</span></div>
        <p class="small muted">${t('tr.loadExplain', { pace: U.pace(st.thresholdPace) })}</p>
      </div>

      <div class="section-title">${t('plan.title')}</div>
      ${planHtml}`;

    S.charts.ring(U.$('#ring'), weekKm / Math.max(1, st.weeklyGoalKm));
    S.charts.bars(U.$('#wBars'), weeks.map((w, i) => (i % 2 === 1 ? '' : U.shortDate(w.ws))), weeks.map((w) => Math.round(w.km * 10) / 10), { fmt: (v) => U.num(v, 1) });
    S.charts.multi(U.$('#fitChart'), fit.map((f) => f.t), [
      { ys: fit.map((f) => f.ctl), color: U.css('--accent'), width: 2.5 },
      { ys: fit.map((f) => f.atl), color: '#ff5c5c', width: 1.5 },
      { ys: fit.map((f) => f.tsb), color: '#4fa3ff', width: 1.5, dash: [5, 4] },
    ], { fmtX: U.shortDate });

    U.$('#goalBtn').onclick = () => U.sheet(`<h2>${t('goal.weekly')}</h2><label>${t('goal.kmPerWeek')}</label><input id="gKm" type="number" min="1" max="300" value="${st.weeklyGoalKm}">
      <div class="btn-row"><button class="btn grow" data-close>${t('cancel')}</button><button class="btn primary grow" id="gOk">${t('save')}</button></div>`,
    (s, close) => { U.$('#gOk', s).onclick = async () => { await S.db.saveSettings({ weeklyGoalKm: Math.max(1, +U.$('#gKm', s).value || 25) }); close(); S.app.render(); }; });

    const nb = U.$('#planNew');
    if (nb) nb.onclick = () => S.views.training.planSheet(weeks, st);
    const del = U.$('#planDel');
    if (del) del.onclick = async () => { if (await U.confirmSheet(t('plan.stopQ'), t('plan.stop.d'), t('plan.stop'), true)) { await S.db.kvSet('plan', null); S.app.render(); } };
    const allBtn = U.$('#planAll');
    if (allBtn) allBtn.onclick = () => U.sheet(`<h2>${U.esc(S.plan.label(plan.goal))} — ${t('plan.full').toLowerCase()}</h2>
      ${plan.weeks.map((w, i) => `<div class="section-title">${t('plan.week', { n: i + 1 })} · ${U.shortDate(w.weekStart)} · ${w.km} km${w.recovery ? ' · ' + t('plan.recovery') : w.taper ? ' · ' + t('plan.taper') : ''}</div>
        ${w.workouts.filter((x) => x.kind !== 'rest').map((x) => `<div class="small" style="padding:3px 0">${x.done ? '✓' : x.missed ? '✗' : '·'} ${U.weekday(x.date)} — ${U.esc(S.plan.text(x).title)}</div>`).join('')}`).join('')}
      <div class="btn-row"><button class="btn block" data-close>${t('close')}</button></div>`);
  },

  planSheet(weeks, st) {
    const U = S.util;
    const recent = weeks.slice(-4).reduce((s, w) => s + w.km, 0) / 4;
    const def = U.isoDay(U.addDays(Date.now(), 7 * 10));
    U.sheet(`<h2>${t('plan.make')}</h2>
      <label>${t('plan.goal')}</label><select id="plGoal">${Object.keys(S.plan.GOALS).map((k) => `<option value="${k}" ${k === '10000' ? 'selected' : ''}>${S.plan.label(k)}</option>`).join('')}</select>
      <label>${t('plan.raceDate')}</label><input id="plDate" type="date" value="${def}" min="${U.isoDay(U.addDays(Date.now(), 14))}">
      <label>${t('plan.runsPerWeek')}</label><select id="plRuns">${[3, 4, 5, 6].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>${t('plan.currentKm')}</label><input id="plKm" type="number" min="5" max="200" value="${Math.max(10, Math.round(recent))}">
      <p class="small muted">${t('plan.paceNote', { pace: U.pace(st.thresholdPace) })}</p>
      <div class="btn-row"><button class="btn grow" data-close>${t('cancel')}</button><button class="btn primary grow" id="plOk">${t('plan.create')}</button></div>`,
    (s, close) => {
      U.$('#plOk', s).onclick = async () => {
        const raceDate = new Date(U.$('#plDate', s).value + 'T09:00').getTime();
        if (!isFinite(raceDate) || raceDate < Date.now()) { U.toast(t('plan.futureDate')); return; }
        const plan = S.plan.generate({ goal: +U.$('#plGoal', s).value, raceDate, runsPerWeek: +U.$('#plRuns', s).value, startKm: +U.$('#plKm', s).value || 15, thresholdPace: st.thresholdPace });
        await S.db.kvSet('plan', plan); close(); S.app.render(); U.toast(t('plan.created', { n: plan.weeks.length }));
      };
    });
  },
};
