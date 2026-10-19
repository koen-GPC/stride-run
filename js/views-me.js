S.views.me = {
  tab: 'me', titleKey: 'tab.me',
  async render(main) {
    const U = S.util, A = S.analysis;
    const acts = await S.db.activities();
    const st = await S.db.settings();
    const recs = A.records(acts);
    const runs = acts.filter((a) => a.type === 'run');
    const sum = (from) => {
      const xs = runs.filter((a) => a.start >= from);
      return { n: xs.length, d: xs.reduce((s, a) => s + a.distance, 0), t: xs.reduce((s, a) => s + a.moving, 0), e: xs.reduce((s, a) => s + (a.elevGain || 0), 0) };
    };
    const periods = [
      [t('per.week'), sum(U.startOfWeek(Date.now()))], [t('per.month'), sum(U.startOfMonth(Date.now()))],
      [t('per.year'), sum(U.startOfYear(Date.now()))], [t('per.all'), sum(0)],
    ];
    const longest = runs.reduce((m, a) => (a.distance > (m?.distance || 0) ? a : m), null);
    const streak = A.weekStreak(runs.map((a) => a.start));
    const profileName = (S.social && S.social.profileName()) || st.name;

    main.innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-size:24px;font-weight:800">${U.esc((profileName || '?').slice(0, 1).toUpperCase())}</div>
        <div><div style="font-size:20px;font-weight:800">${U.esc(profileName || t('me.profile'))}</div><div class="small muted">${t('me.summary', { runs: runs.length, weeks: streak })}</div></div>
      </div>

      <div class="section-title">${t('me.stats')}</div>
      <div class="card"><table class="t"><tr><th></th><th class="r">${t('runs')}</th><th class="r">km</th><th class="r">${t('rec.time')}</th><th class="r">${t('elevShort')}</th></tr>
        ${periods.map(([l, p]) => `<tr><td>${l}</td><td class="r">${p.n}</td><td class="r"><b>${U.km(p.d, 1)}</b></td><td class="r">${U.durationWords(p.t)}</td><td class="r">${Math.round(p.e)}</td></tr>`).join('')}
      </table>${longest ? `<div class="small muted" style="margin-top:8px">${t('me.longest')}: <a href="#/activity/${longest.id}"><b>${U.km(longest.distance, 1)} km</b></a> (${U.shortDate(longest.start)})</div>` : ''}</div>

      <div class="section-title">${t('me.records')}</div>
      <div class="card"><table class="t">
        ${A.EFFORTS.map((e) => { const r = recs[e.m][0]; return `<tr ${r ? `onclick="location.hash='#/activity/${r.id}'" style="cursor:pointer"` : ''}><td>${t(e.key)}</td>
          <td class="r"><b>${r ? U.duration(r.time) : '–'}</b></td><td class="r small muted">${r ? U.pace(r.time / (e.m / 1000)) + ' /km' : ''}</td><td class="r small muted">${r ? U.shortDate(r.start) : ''}</td></tr>`; }).join('')}
      </table></div>

      <div class="section-title">${t('me.language')}</div>
      <div class="card"><div class="seg" style="margin:0">${S.i18n.LANGS.map((l) => `<button data-lang="${l.code}" class="${l.code === S.i18n.lang ? 'on' : ''}">${l.label}</button>`).join('')}</div></div>

      <div class="section-title">${t('me.profileZones')}</div>
      <div class="card">
        <label>${t('name')}</label><input id="sName" value="${U.esc(st.name)}">
        <div class="row"><div class="grow"><label>${t('st.maxHr')}</label><input id="sMax" type="number" value="${st.maxHr}"></div><div class="grow"><label>${t('me.restHr')}</label><input id="sRest" type="number" value="${st.restHr}"></div></div>
        <div class="row"><div class="grow"><label>${t('me.weight')}</label><input id="sW" type="number" value="${st.weight}"></div><div class="grow"><label>${t('me.threshold')}</label><input id="sTp" value="${U.pace(st.thresholdPace)}"></div></div>
        <div class="small muted" style="margin-top:8px">${t('me.zones')}: ${A.ZONES.map((z, i) => `${z.n} ${i === 0 ? '<' + Math.round(st.maxHr * z.hi) : i === 4 ? '>' + Math.round(st.maxHr * z.lo) : Math.round(st.maxHr * z.lo) + '–' + Math.round(st.maxHr * z.hi)}`).join(' · ')}</div>
        ${estimateHtml(runs)}
      </div>

      <div class="section-title">${t('me.recording')}</div>
      <div class="card">
        <div class="list-item"><div class="grow">${t('me.autoPause')}</div><input type="checkbox" id="sAuto" ${st.autoPause ? 'checked' : ''}></div>
        <div class="list-item"><div class="grow">${t('me.voice')}</div><input type="checkbox" id="sVoice" ${st.voice ? 'checked' : ''}></div>
        <div class="list-item"><div class="grow">${t('me.voiceEvery')}</div><select id="sEvery" style="width:auto">${[[500, '500 m'], [1000, '1 km'], [2000, '2 km'], [5000, '5 km']].map(([v, l]) => `<option value="${v}" ${v === st.voiceEvery ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">${t('me.defaultSport')}</div><select id="sType" style="width:auto">${Object.keys(U.TYPES).map((k) => `<option value="${k}" ${k === st.defaultType ? 'selected' : ''}>${U.TYPES[k]}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">${t('me.theme')}</div><select id="sTheme" style="width:auto">${['auto', 'dark', 'light'].map((v) => `<option value="${v}" ${v === st.theme ? 'selected' : ''}>${t('theme.' + v)}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">${t('me.gpsAcc')}<div class="small muted">${t('me.gpsAcc.d')}</div></div><select id="sAcc" style="width:auto">${[20, 30, 50].map((v) => `<option ${v === st.maxAccuracy ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <button class="btn" id="sTest" style="margin-top:8px">${t('me.testVoice')}</button>
      </div>
      <button class="btn primary block" id="sSave" style="margin-top:4px">${t('me.saveSettings')}</button>

      <div class="section-title">${t('me.data')}</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">${t('me.data.d')}</p>
        <div class="btn-row" style="margin-top:0">
          <button class="btn grow" id="dExp">${t('me.backup')}</button><button class="btn grow" id="dImp">${t('me.restore')}</button>
        </div>
        <div class="btn-row"><button class="btn grow" id="dGpx">${t('me.importGpx')}</button><button class="btn danger grow" id="dWipe">${t('me.wipe')}</button></div>
        <div class="small muted" style="margin-top:10px" id="dUsage"></div>
      </div>
      <p class="small muted" style="text-align:center;margin-top:20px">${t('me.footer')}</p>`;

    const val = (id) => U.$('#' + id).value;
    U.$$('[data-lang]', main).forEach((b) => (b.onclick = async () => {
      await S.db.saveSettings({ lang: b.dataset.lang });
      S.i18n.set(b.dataset.lang); S.app.render();
    }));
    U.$('#sTest').onclick = () => S.tracker.say(t('v.split', { km: '5', time: t('v.timeM', { m: 26 }), pace: t('v.pace', { m: 5, s: 12 }) }));
    U.$('#sSave').onclick = async () => {
      const tp = val('sTp').split(':');
      const tps = tp.length === 2 ? (+tp[0]) * 60 + (+tp[1]) : st.thresholdPace;
      await S.db.saveSettings({
        name: val('sName').trim(), maxHr: +val('sMax') || 190, restHr: +val('sRest') || 55, weight: +val('sW') || 75,
        thresholdPace: tps > 120 && tps < 900 ? tps : st.thresholdPace,
        autoPause: U.$('#sAuto').checked, voice: U.$('#sVoice').checked, voiceEvery: +val('sEvery'), defaultType: val('sType'),
        theme: val('sTheme'), maxAccuracy: +val('sAcc'),
      });
      const s2 = await S.db.settings();
      for (const a of await S.db.activities()) { const l = S.analysis.load(a, s2); if (l !== a.load) { a.load = l; await S.db.put('activities', a); } }
      S.app.applyTheme(s2.theme);
      U.toast(t('saved')); S.app.render();
    };
    U.$('#dExp').onclick = async () => {
      const data = await S.db.exportAll();
      U.download(`stride-backup-${U.isoDay(Date.now())}.json`, JSON.stringify(data), 'application/json');
    };
    U.$('#dImp').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        try {
          const data = JSON.parse(await inp.files[0].text());
          const replace = await U.confirmSheet(t('me.restore'), t('me.restore.d', { n: (data.activities || []).length }), t('me.replace'), true);
          await S.db.importAll(data, { replace });
          U.toast(t('me.restored')); S.app.render();
        } catch (e) { U.toast(e.message || t('me.restoreFailed')); }
      };
      inp.click();
    };
    U.$('#dGpx').onclick = () => S.views.activities.importGpx();
    U.$('#dWipe').onclick = async () => {
      if (await U.confirmSheet(t('me.wipeQ'), t('me.wipe.d'), t('me.wipe'), true)) {
        await S.db.wipe(); U.toast(t('me.wiped')); S.app.render();
      }
    };
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((e) => { const el = U.$('#dUsage'); if (el) el.textContent = t('me.storage', { mb: U.num(e.usage / 1048576, 1) }); });
    }
  },
};

// Estimate threshold pace from best recent efforts (Riegel), offered as a hint only.
function estimateHtml(runs) {
  const U = S.util;
  const since = U.addDays(Date.now(), -120);
  let best = null;
  for (const a of runs) {
    if (a.start < since || !a.best) continue;
    for (const [m, tm] of [[5000, a.best[5000]], [10000, a.best[10000]], [21097.5, a.best[21097.5]]]) {
      if (!tm) continue;
      const pace = (tm * Math.pow(15000 / m, 1.06)) / 15; // ~1 hour race distance ≈ threshold
      if (!best || pace < best) best = pace;
    }
  }
  return best ? `<div class="small muted" style="margin-top:6px">${t('me.estimate', { pace: U.pace(best) })}</div>` : '';
}
