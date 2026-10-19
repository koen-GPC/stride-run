S.views.training = {
  tab: 'training', title: 'Training',
  async render(main) {
    const U = S.util, A = S.analysis;
    const acts = await S.db.activities();
    const st = await S.db.settings();
    let plan = await S.db.kvGet('plan', null);
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
    const formTxt = now.tsb > 5 ? 'Fris — klaar voor een harde training of wedstrijd' : now.tsb < -20 ? 'Veel vermoeidheid — plan herstel' : now.tsb < -5 ? 'Aan het opbouwen — productieve belasting' : 'In balans';
    const weekLoad = acts.filter((a) => a.start >= thisWeek).reduce((s, a) => s + (a.load ?? A.load(a, st)), 0);

    let planHtml;
    if (plan) {
      const curIdx = Math.max(0, plan.weeks.findIndex((w) => w.weekStart === thisWeek || (thisWeek >= w.weekStart && thisWeek < U.addDays(w.weekStart, 7))));
      const show = plan.weeks.slice(curIdx, curIdx + 2);
      const done = plan.weeks.flatMap((w) => w.workouts).filter((x) => x.kind !== 'rest' && x.date < U.startOfDay(Date.now()));
      const pct = done.length ? Math.round((done.filter((x) => x.done).length / done.length) * 100) : null;
      const daysLeft = Math.ceil((U.startOfDay(plan.raceDate) - U.startOfDay(Date.now())) / 864e5);
      planHtml = `<div class="card">
        <div class="row between"><div><h3 style="margin:0">${U.esc(plan.label)}</h3><div class="small muted">${U.date(plan.raceDate)} · ${daysLeft >= 0 ? `nog ${daysLeft} dagen` : 'voorbij'}</div></div>
        ${pct != null ? `<div style="text-align:right"><b>${pct}%</b><div class="small muted">uitgevoerd</div></div>` : ''}</div></div>
        ${show.map((w, k) => `<div class="card"><div class="row between" style="margin-bottom:6px"><b>${k === 0 ? 'Deze week' : 'Volgende week'}${w.recovery ? ' · herstelweek' : w.taper ? ' · afbouw' : ''}</b><span class="small muted">${w.km} km</span></div>
          ${w.workouts.map((x) => `<div class="workout ${x.done ? 'done' : ''} ${x.today ? 'today' : ''}">
            <div class="day">${U.DAYS[new Date(x.date).getDay()]}<b>${new Date(x.date).getDate()}</b></div>
            <div class="grow"><div class="title"><span class="tag ${x.kind}">${{ easy: 'Rustig', long: 'Lang', quality: 'Kwaliteit', rest: 'Rust', race: 'Race' }[x.kind]}</span> ${U.esc(x.title)}</div>
            ${x.kind !== 'rest' ? `<div class="small muted">${U.esc(x.desc)}</div>` : ''}${x.missed ? '<div class="small" style="color:var(--warn)">Gemist</div>' : ''}</div></div>`).join('')}
        </div>`).join('')}
        <div class="btn-row"><button class="btn grow" id="planAll">Heel schema</button><button class="btn danger" id="planDel">Stoppen</button></div>`;
    } else {
      planHtml = `<div class="card"><h3>Trainingsschema</h3><p class="muted small">Laat een schema maken richting een 5 km, 10 km, halve of hele marathon. Opbouw met herstelweken en afbouw; je runs worden automatisch afgevinkt.</p>
        <button class="btn primary block" id="planNew">Schema maken</button></div>`;
    }

    main.innerHTML = `
      <div class="card goal">
        <svg class="ring" viewBox="0 0 120 120" id="ring"></svg>
        <div class="grow"><div class="small muted">Weekdoel hardlopen</div>
          <div style="font-size:26px;font-weight:800">${U.km(weekKm * 1000, 1)} <span class="muted" style="font-size:16px">/ ${st.weeklyGoalKm} km</span></div>
          <div class="small muted">${weekKm >= st.weeklyGoalKm ? 'Doel gehaald 🎉' : `Nog ${U.km((st.weeklyGoalKm - weekKm) * 1000, 1)} km`}</div>
          <button class="btn sm" id="goalBtn" style="margin-top:8px">Doel aanpassen</button></div>
      </div>
      <div class="section-title">Afstand per week</div>
      <div class="card"><canvas class="chart" id="wBars"></canvas></div>

      <div class="section-title">Fitheid & vorm</div>
      <div class="card">
        <div class="stats"><div class="stat"><div class="v">${Math.round(now.ctl)}</div><div class="l">Fitheid</div></div>
        <div class="stat"><div class="v">${Math.round(now.atl)}</div><div class="l">Vermoeidheid</div></div>
        <div class="stat"><div class="v">${now.tsb > 0 ? '+' : ''}${Math.round(now.tsb)}</div><div class="l">Vorm</div></div></div>
        <p class="small" style="margin:10px 0">${formTxt}. Belasting deze week: <b>${weekLoad}</b>.</p>
        <canvas class="chart tall" id="fitChart"></canvas>
        <div class="small muted row" style="gap:14px;margin-top:6px"><span><b style="color:var(--accent)">—</b> fitheid (42 d)</span><span><b style="color:#ff5c5c">—</b> vermoeidheid (7 d)</span><span><b style="color:#4fa3ff">- -</b> vorm</span></div>
        <p class="small muted">Belasting komt uit je hartslag (TRIMP) als die er is, anders uit je tempo t.o.v. je drempeltempo (${U.pace(st.thresholdPace)} /km, instelbaar onder Ik).</p>
      </div>

      <div class="section-title">Schema</div>
      ${planHtml}`;

    S.charts.ring(U.$('#ring'), weekKm / Math.max(1, st.weeklyGoalKm));
    S.charts.bars(U.$('#wBars'), weeks.map((w, i) => (i % 2 === 1 ? '' : U.shortDate(w.ws).split(' ')[0] + ' ' + U.shortDate(w.ws).split(' ')[1])), weeks.map((w) => Math.round(w.km * 10) / 10), { fmt: (v) => String(v).replace('.', ','), allValues: false });
    S.charts.multi(U.$('#fitChart'), fit.map((f) => f.t), [
      { ys: fit.map((f) => f.ctl), color: U.css('--accent'), width: 2.5 },
      { ys: fit.map((f) => f.atl), color: '#ff5c5c', width: 1.5 },
      { ys: fit.map((f) => f.tsb), color: '#4fa3ff', width: 1.5, dash: [5, 4] },
    ], { fmtX: U.shortDate });

    U.$('#goalBtn').onclick = () => U.sheet(`<h2>Weekdoel</h2><label>Kilometers per week</label><input id="gKm" type="number" min="1" max="300" value="${st.weeklyGoalKm}">
      <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="gOk">Opslaan</button></div>`,
    (s, close) => { U.$('#gOk', s).onclick = async () => { await S.db.saveSettings({ weeklyGoalKm: Math.max(1, +U.$('#gKm', s).value || 25) }); close(); S.app.render(); }; });

    const nb = U.$('#planNew');
    if (nb) nb.onclick = () => S.views.training.planSheet(weeks, st);
    const del = U.$('#planDel');
    if (del) del.onclick = async () => { if (await U.confirmSheet('Schema stoppen?', 'Je runs blijven bewaard.', 'Stoppen', true)) { await S.db.kvSet('plan', null); S.app.render(); } };
    const allBtn = U.$('#planAll');
    if (allBtn) allBtn.onclick = () => U.sheet(`<h2>${U.esc(plan.label)} — volledig schema</h2>
      ${plan.weeks.map((w, i) => `<div class="section-title">Week ${i + 1} · ${U.shortDate(w.weekStart)} · ${w.km} km${w.recovery ? ' · herstel' : w.taper ? ' · afbouw' : ''}</div>
        ${w.workouts.filter((x) => x.kind !== 'rest').map((x) => `<div class="small" style="padding:3px 0">${x.done ? '✓' : x.missed ? '✗' : '·'} ${U.DAYS[new Date(x.date).getDay()]} — ${U.esc(x.title)}</div>`).join('')}`).join('')}
      <div class="btn-row"><button class="btn block" data-close>Sluiten</button></div>`);
  },

  planSheet(weeks, st) {
    const U = S.util;
    const recent = weeks.slice(-4).reduce((s, w) => s + w.km, 0) / 4;
    const def = U.isoDay(U.addDays(Date.now(), 7 * 10));
    U.sheet(`<h2>Schema maken</h2>
      <label>Doel</label><select id="plGoal">${Object.entries(S.plan.GOALS).map(([k, g]) => `<option value="${k}" ${k === '10000' ? 'selected' : ''}>${g.label}</option>`).join('')}</select>
      <label>Wedstrijddatum</label><input id="plDate" type="date" value="${def}" min="${U.isoDay(U.addDays(Date.now(), 14))}">
      <label>Runs per week</label><select id="plRuns">${[3, 4, 5, 6].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>Huidige kilometers per week</label><input id="plKm" type="number" min="5" max="200" value="${Math.max(10, Math.round(recent))}">
      <p class="small muted">Tempo's worden afgeleid van je drempeltempo (${U.pace(st.thresholdPace)} /km). Pas dat aan onder Ik als het niet klopt.</p>
      <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="plOk">Maken</button></div>`,
    (s, close) => {
      U.$('#plOk', s).onclick = async () => {
        const raceDate = new Date(U.$('#plDate', s).value + 'T09:00').getTime();
        if (!isFinite(raceDate) || raceDate < Date.now()) { U.toast('Kies een datum in de toekomst'); return; }
        const plan = S.plan.generate({ goal: +U.$('#plGoal', s).value, raceDate, runsPerWeek: +U.$('#plRuns', s).value, startKm: +U.$('#plKm', s).value || 15, thresholdPace: st.thresholdPace });
        await S.db.kvSet('plan', plan); close(); S.app.render(); U.toast(`Schema van ${plan.weeks.length} weken gemaakt`);
      };
    });
  },
};
