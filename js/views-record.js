S.views = S.views || {};

S.views.record = {
  tab: 'record', title: 'Opnemen', full: true,
  async render(main) {
    const U = S.util, T = S.tracker;
    const settings = await S.db.settings();
    const routes = await S.db.all('routes');
    const plan = await S.db.kvGet('plan', null);
    const todays = plan ? S.plan.todays(plan) : null;
    if (T.st.state === 'idle') T.st.type = settings.defaultType || 'run';

    main.innerHTML = `
      <div class="rec">
        <div class="rec-map">
          <div class="map" id="recMap"></div>
          <div class="gps-chip" id="gpsChip"><span class="dot"></span><span id="gpsTxt">GPS zoeken…</span></div>
          <div class="chips-right">
            <span class="chip" id="hrChip">♥ ${S.hr.connected() ? 'verbonden' : 'Hartslag'}</span>
            <span class="chip" id="routeChip">⌖ ${T.st.routeId ? 'Route actief' : 'Route'}</span>
            <span class="chip" id="typeChip">${U.TYPES[T.st.type]}</span>
          </div>
        </div>
        <div class="rec-panel">
          ${todays && T.st.state === 'idle' && todays.kind !== 'rest' ? `<div class="small muted" style="text-align:center;margin-bottom:8px">Vandaag op schema: <b style="color:var(--text)">${U.esc(todays.title)}</b></div>` : ''}
          <div class="rec-big"><div class="v" id="rTime">0:00</div><div class="l">Tijd</div></div>
          <div class="rec-grid">
            <div><div class="v" id="rDist">0,00</div><div class="l">km</div></div>
            <div><div class="v" id="rPace">–:––</div><div class="l" id="rPaceL">Tempo /km</div></div>
            <div><div class="v" id="rHr">–</div><div class="l">Hartslag</div></div>
          </div>
          <div class="autopause" id="rAuto"></div>
          <div class="rec-controls" id="rCtl"></div>
        </div>
      </div>`;

    const map = S.maps.create(U.$('#recMap'));
    let line = null, you = null, overlay = null, centred = false, follow = true;
    if (map) {
      map.setView([52.37, 4.89], 13);
      map.on('dragstart', () => { follow = false; });
      line = L.polyline([], { color: U.css('--accent'), weight: 5, lineJoin: 'round' }).addTo(map);
      drawOverlay();
    }

    function drawOverlay() {
      if (!map) return;
      if (overlay) { overlay.remove(); overlay = null; }
      const r = routes.find((x) => x.id === T.st.routeId);
      if (r) {
        overlay = L.polyline(S.maps.latlngs(r.points), { color: '#4fa3ff', weight: 5, opacity: 0.6, dashArray: '8 8' }).addTo(map);
        if (T.st.state === 'idle') { map.fitBounds(overlay.getBounds(), { padding: [30, 30] }); centred = true; }
      }
    }

    function controls() {
      const s = T.st.state, c = U.$('#rCtl');
      if (!c) return;
      if (s === 'idle') c.innerHTML = `<button class="round go" id="bStart">START</button>`;
      else if (s === 'running') c.innerHTML = `<button class="round pause" id="bPause">PAUZE</button><button class="round small pause" id="bLap" title="Ronde">RONDE</button>`;
      else c.innerHTML = `<button class="round go small" id="bResume">VERDER</button><button class="round stop" id="bFinish">KLAAR</button>`;
      const on = (id, f) => { const b = U.$('#' + id); if (b) b.onclick = f; };
      on('bStart', () => T.start(T.st.type, T.st.routeId));
      on('bPause', () => T.pause());
      on('bResume', () => T.resume());
      on('bLap', () => { const p = T.st; T.say(`Ronde. ${U.km(p.distance, 2)} kilometer.`); U.toast('Ronde gemarkeerd'); });
      on('bFinish', finishFlow);
    }

    let lastState = null, drawn = 0;
    function update(st) {
      if (!U.$('#rTime')) return;
      U.$('#rTime').textContent = U.duration(st.moving);
      U.$('#rDist').textContent = U.km(st.distance);
      const cur = T.currentPace();
      const avg = st.distance > 50 ? st.moving / (st.distance / 1000) : null;
      U.$('#rPace').textContent = U.pace(cur ?? avg);
      U.$('#rPaceL').textContent = cur ? 'Tempo nu' : 'Gem. tempo';
      const hr = S.hr.value();
      U.$('#rHr').textContent = hr || '–';
      U.$('#rAuto').textContent = st.state === 'running' && st.autoPaused ? 'Automatisch gepauzeerd — begin te bewegen' : st.state === 'paused' ? 'Gepauzeerd' : '';
      const chip = U.$('#gpsChip'), a = st.accuracy;
      chip.className = 'gps-chip ' + (a == null ? '' : a < 0 ? 'bad' : a <= 12 ? 'good' : a <= 30 ? 'ok' : 'bad');
      U.$('#gpsTxt').textContent = st.gpsError ? 'GPS: ' + st.gpsError : a == null ? 'GPS zoeken…' : a < 0 ? 'Geen GPS' : `GPS ±${Math.round(a)} m`;
      if (st.state !== lastState) { lastState = st.state; controls(); U.$('#typeChip').style.opacity = st.state === 'idle' ? 1 : 0.5; }
      if (map) {
        if (st.points.length < drawn) { line.setLatLngs([]); drawn = 0; }
        if (st.points.length > drawn) { line.setLatLngs(S.maps.pieces(st.points)); drawn = st.points.length; }
        const f = st.lastFix;
        if (f) {
          const ll = [f.lat, f.lon];
          if (!you) you = S.maps.youMarker(map, ll); else you.setLatLng(ll);
          if (!centred) { map.setView(ll, 16); centred = true; }
          else if (follow && st.state === 'running') map.panTo(ll, { animate: true });
        }
      }
    }

    async function finishFlow() {
      T.pause();
      const draft = { ...T.st };
      if (draft.points.length < 2 || draft.distance < 20) {
        const ok = await U.confirmSheet('Te kort om op te slaan', 'Deze activiteit heeft (bijna) geen GPS-punten. Weggooien?', 'Weggooien', true);
        if (ok) { T.reset(); S.app.render(); }
        return;
      }
      const a = T.finish();
      S.views.record.saveSheet(a);
    }

    U.$('#typeChip').onclick = () => {
      if (T.st.state !== 'idle') return;
      U.sheet(`<h2>Sport</h2>${Object.entries(U.TYPES).map(([k, v]) => `<div class="list-item" data-t="${k}"><div class="grow">${v}</div>${k === T.st.type ? '✓' : ''}</div>`).join('')}`,
        (s, close) => U.$$('[data-t]', s).forEach((el) => (el.onclick = () => { T.st.type = el.dataset.t; U.$('#typeChip').textContent = U.TYPES[T.st.type]; close(); })));
    };

    U.$('#routeChip').onclick = () => {
      U.sheet(`<h2>Route volgen</h2><p class="muted small">De route verschijnt als stippellijn op de kaart.</p>
        <div class="list-item" data-r=""><div class="grow">Geen route</div>${!T.st.routeId ? '✓' : ''}</div>
        ${routes.map((r) => `<div class="list-item" data-r="${r.id}"><div class="grow">${U.esc(r.name)}<div class="small muted">${U.km(r.distance, 1)} km</div></div>${r.id === T.st.routeId ? '✓' : ''}</div>`).join('')}
        ${routes.length ? '' : '<p class="muted small">Nog geen routes. Plan er een onder Routes.</p>'}`,
      (s, close) => U.$$('[data-r]', s).forEach((el) => (el.onclick = () => {
        T.st.routeId = el.dataset.r || null; U.$('#routeChip').textContent = '⌖ ' + (T.st.routeId ? 'Route actief' : 'Route'); drawOverlay(); close();
      })));
    };

    U.$('#hrChip').onclick = async () => {
      if (!S.hr.supported()) {
        U.sheet(`<h2>Hartslagmeter</h2><p class="muted">Deze browser ondersteunt geen Bluetooth. Op Android werkt het in Chrome; op iPhone ondersteunt Safari dit (nog) niet. Je kunt hartslag wel meenemen door een GPX van je horloge te importeren.</p><button class="btn block" data-close>OK</button>`);
        return;
      }
      if (S.hr.connected()) { S.hr.disconnect(); U.$('#hrChip').textContent = '♥ Hartslag'; U.$('#hrChip').classList.remove('on'); return; }
      try {
        const n = await S.hr.connect();
        U.toast(`Verbonden met ${n}`);
        U.$('#hrChip').textContent = '♥ verbonden'; U.$('#hrChip').classList.add('on');
      } catch (e) { if (e.name !== 'NotFoundError') U.toast(e.message); }
    };
    if (S.hr.connected()) U.$('#hrChip').classList.add('on');

    const off = T.on(update);
    T.warmup();
    update(T.st); controls();
    return () => { off(); T.cooldown(); };
  },

  // After "Klaar": name, type, notes → save or discard.
  saveSheet(a) {
    const U = S.util;
    S.db.kvSet('unsaved', a).catch(() => {}); // survives a crash/close while this sheet is open
    U.sheet(`
      <h2>Activiteit opslaan</h2>
      <div class="stats" style="margin:12px 0">
        <div class="stat"><div class="v">${U.km(a.distance)}</div><div class="l">km</div></div>
        <div class="stat"><div class="v">${U.duration(a.moving)}</div><div class="l">tijd</div></div>
        <div class="stat"><div class="v">${U.pace(a.moving / (a.distance / 1000))}</div><div class="l">/km</div></div>
      </div>
      <label>Naam</label><input id="sName" value="${U.esc(a.name)}">
      <label>Sport</label><select id="sType">${Object.entries(U.TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>Notities</label><textarea id="sNotes" rows="3" placeholder="Hoe voelde het?"></textarea>
      <label>Gevoel (RPE 1–10)</label><input id="sRpe" type="range" min="1" max="10" value="5">
      <div class="btn-row"><button class="btn danger" id="sDel">Weggooien</button><button class="btn primary grow" id="sSave">Opslaan</button></div>`,
    (s, close) => {
      U.$('#sheetBackdrop').onclick = null; // don't lose a run by tapping outside
      U.$('#sSave', s).onclick = async () => {
        a.name = U.$('#sName', s).value.trim() || a.name;
        a.type = U.$('#sType', s).value;
        a.notes = U.$('#sNotes', s).value.trim();
        a.rpe = +U.$('#sRpe', s).value;
        S.analysis.finalize(a);
        a.load = S.analysis.load(a, await S.db.settings());
        await S.db.saveActivity(a);
        await S.db.kvSet('unsaved', null);
        close();
        location.hash = '#/activity/' + a.id;
      };
      U.$('#sDel', s).onclick = async () => {
        if (await U.confirmSheet('Activiteit weggooien?', 'Dit kan niet ongedaan worden gemaakt.', 'Weggooien', true)) { await S.db.kvSet('unsaved', null); S.app.render(); }
        else S.views.record.saveSheet(a);
      };
    });
  },
};
