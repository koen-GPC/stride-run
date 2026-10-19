S.views.me = {
  tab: 'me', title: 'Ik',
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
      ['Deze week', sum(U.startOfWeek(Date.now()))], ['Deze maand', sum(U.startOfMonth(Date.now()))],
      ['Dit jaar', sum(U.startOfYear(Date.now()))], ['Totaal', sum(0)],
    ];
    const longest = runs.reduce((m, a) => (a.distance > (m?.distance || 0) ? a : m), null);
    // streak: consecutive weeks (incl. this one or last) with at least one run
    let streak = 0;
    for (let w = U.startOfWeek(Date.now()); ; w = U.addDays(w, -7)) {
      const has = runs.some((a) => a.start >= w && a.start < U.addDays(w, 7));
      if (has) streak++; else if (w !== U.startOfWeek(Date.now())) break;
      if (streak > 520 || w < U.addDays(Date.now(), -3650)) break;
    }

    main.innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-size:24px;font-weight:800">${U.esc((st.name || 'Ik').slice(0, 1).toUpperCase())}</div>
        <div><div style="font-size:20px;font-weight:800">${U.esc(st.name || 'Mijn profiel')}</div><div class="small muted">${runs.length} runs · ${streak} ${streak === 1 ? 'week' : 'weken'} op rij actief</div></div>
      </div>

      <div class="section-title">Hardloopstatistieken</div>
      <div class="card"><table class="t"><tr><th></th><th class="r">Runs</th><th class="r">km</th><th class="r">Tijd</th><th class="r">Hm</th></tr>
        ${periods.map(([l, p]) => `<tr><td>${l}</td><td class="r">${p.n}</td><td class="r"><b>${U.km(p.d, 1)}</b></td><td class="r">${U.durationWords(p.t)}</td><td class="r">${Math.round(p.e)}</td></tr>`).join('')}
      </table>${longest ? `<div class="small muted" style="margin-top:8px">Langste run: <a href="#/activity/${longest.id}"><b>${U.km(longest.distance, 1)} km</b></a> (${U.shortDate(longest.start)})</div>` : ''}</div>

      <div class="section-title">Persoonlijke records</div>
      <div class="card"><table class="t">
        ${A.EFFORTS.map((e) => { const r = recs[e.m][0]; return `<tr ${r ? `onclick="location.hash='#/activity/${r.id}'" style="cursor:pointer"` : ''}><td>${e.label}</td>
          <td class="r"><b>${r ? U.duration(r.time) : '–'}</b></td><td class="r small muted">${r ? U.pace(r.time / (e.m / 1000)) + ' /km' : ''}</td><td class="r small muted">${r ? U.shortDate(r.start) : ''}</td></tr>`; }).join('')}
      </table></div>

      <div class="section-title">Profiel & zones</div>
      <div class="card">
        <label>Naam</label><input id="sName" value="${U.esc(st.name)}">
        <div class="row"><div class="grow"><label>Max. hartslag</label><input id="sMax" type="number" value="${st.maxHr}"></div><div class="grow"><label>Rusthartslag</label><input id="sRest" type="number" value="${st.restHr}"></div></div>
        <div class="row"><div class="grow"><label>Gewicht (kg)</label><input id="sW" type="number" value="${st.weight}"></div><div class="grow"><label>Drempeltempo (m:ss /km)</label><input id="sTp" value="${U.pace(st.thresholdPace)}"></div></div>
        <div class="small muted" style="margin-top:8px">Zones: ${A.ZONES.map((z, i) => `${z.n} ${i === 0 ? '<' + Math.round(st.maxHr * z.hi) : i === 4 ? '>' + Math.round(st.maxHr * z.lo) : Math.round(st.maxHr * z.lo) + '–' + Math.round(st.maxHr * z.hi)}`).join(' · ')}</div>
        ${estimateHtml(runs)}
      </div>

      <div class="section-title">Opname</div>
      <div class="card">
        <div class="list-item"><div class="grow">Automatisch pauzeren</div><input type="checkbox" id="sAuto" ${st.autoPause ? 'checked' : ''}></div>
        <div class="list-item"><div class="grow">Gesproken updates</div><input type="checkbox" id="sVoice" ${st.voice ? 'checked' : ''}></div>
        <div class="list-item"><div class="grow">Update elke</div><select id="sEvery" style="width:auto">${[[500, '500 m'], [1000, '1 km'], [2000, '2 km'], [5000, '5 km']].map(([v, l]) => `<option value="${v}" ${v === st.voiceEvery ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">Standaard sport</div><select id="sType" style="width:auto">${Object.entries(U.TYPES).map(([k, v]) => `<option value="${k}" ${k === st.defaultType ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">Weergave</div><select id="sTheme" style="width:auto">${[['auto', 'Automatisch'], ['dark', 'Donker'], ['light', 'Licht']].map(([v, l]) => `<option value="${v}" ${v === st.theme ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="list-item"><div class="grow">Max. GPS-onnauwkeurigheid<div class="small muted">Punten slechter dan dit worden genegeerd</div></div><select id="sAcc" style="width:auto">${[20, 30, 50].map((v) => `<option ${v === st.maxAccuracy ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <button class="btn" id="sTest" style="margin-top:8px">Spraak testen</button>
      </div>
      <button class="btn primary block" id="sSave" style="margin-top:4px">Instellingen opslaan</button>

      <div class="section-title">Gegevens</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">Alles staat alleen op dit apparaat. Maak regelmatig een backup — als je browsergegevens wist, ben je het kwijt.</p>
        <div class="btn-row" style="margin-top:0">
          <button class="btn grow" id="dExp">Backup downloaden</button><button class="btn grow" id="dImp">Backup terugzetten</button>
        </div>
        <div class="btn-row"><button class="btn grow" id="dGpx">GPX's importeren</button><button class="btn danger grow" id="dWipe">Alles wissen</button></div>
        <div class="small muted" style="margin-top:10px" id="dUsage"></div>
      </div>
      <p class="small muted" style="text-align:center;margin-top:20px">Stride · persoonlijke run-tracker · kaarten © OpenStreetMap-bijdragers</p>`;

    const val = (id) => U.$('#' + id).value;
    U.$('#sTest').onclick = () => S.tracker.say('5 kilometer. Tijd 26 minuten. Laatste kilometer 5 minuten 12 per kilometer.');
    U.$('#sSave').onclick = async () => {
      const tp = val('sTp').split(':');
      const tps = tp.length === 2 ? (+tp[0]) * 60 + (+tp[1]) : st.thresholdPace;
      await S.db.saveSettings({
        name: val('sName').trim(), maxHr: +val('sMax') || 190, restHr: +val('sRest') || 55, weight: +val('sW') || 75,
        thresholdPace: tps > 120 && tps < 900 ? tps : st.thresholdPace,
        autoPause: U.$('#sAuto').checked, voice: U.$('#sVoice').checked, voiceEvery: +val('sEvery'), defaultType: val('sType'),
        theme: val('sTheme'), maxAccuracy: +val('sAcc'),
      });
      // loads depend on HR/threshold settings
      const s2 = await S.db.settings();
      for (const a of await S.db.activities()) { const l = S.analysis.load(a, s2); if (l !== a.load) { a.load = l; await S.db.put('activities', a); } }
      S.app.applyTheme(s2.theme);
      U.toast('Opgeslagen'); S.app.render();
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
          const replace = await U.confirmSheet('Backup terugzetten', `${(data.activities || []).length} activiteiten. Bestaande gegevens vervangen? (Kies Annuleren om samen te voegen.)`, 'Vervangen', true);
          await S.db.importAll(data, { replace });
          U.toast('Backup teruggezet'); S.app.render();
        } catch (e) { U.toast(e.message || 'Kon backup niet lezen'); }
      };
      inp.click();
    };
    U.$('#dGpx').onclick = () => S.views.activities.importGpx();
    U.$('#dWipe').onclick = async () => {
      if (await U.confirmSheet('Alles wissen?', 'Alle activiteiten, routes, segmenten en instellingen worden van dit apparaat verwijderd. Maak eerst een backup.', 'Alles wissen', true)) {
        await S.db.wipe(); U.toast('Gewist'); S.app.render();
      }
    };
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((e) => { const el = U.$('#dUsage'); if (el) el.textContent = `Opslag in gebruik: ${(e.usage / 1048576).toFixed(1)} MB`; });
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
    for (const [m, t] of [[5000, a.best[5000]], [10000, a.best[10000]], [21097.5, a.best[21097.5]]]) {
      if (!t) continue;
      const t60 = t * Math.pow(15000 / m, 1.06); // ~1 hour race distance ≈ threshold
      const pace = t60 / 15;
      if (!best || pace < best) best = pace;
    }
  }
  return best ? `<div class="small muted" style="margin-top:6px">Op basis van je recente records schatten we je drempeltempo rond <b>${U.pace(best)} /km</b>.</div>` : '';
}
