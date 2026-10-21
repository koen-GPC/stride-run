S.views = S.views || {};

S.views.record = {
  tab: 'record', titleKey: 'tab.record', full: true,
  async render(main) {
    const U = S.util, T = S.tracker;
    const settings = await S.db.settings();
    const routes = await S.db.all('routes');
    const plan = await S.db.kvGet('plan', null);
    const todays = plan ? S.plan.todays(plan) : null;
    if (T.st.state === 'idle') T.st.type = settings.defaultType || 'run';
    const routeLabel = () => '⌖ ' + (T.st.routeId ? t('rec.routeOn') : t('rec.route'));

    main.innerHTML = `
      <div class="rec">
        <div class="rec-map">
          <div class="map" id="recMap"></div>
          <div class="gps-chip" id="gpsChip"><span class="dot"></span><span id="gpsTxt">${t('gps.search')}</span></div>
          <div class="chips-right">
            <span class="chip" id="hrChip">♥ ${S.hr.connected() ? t('hr.connected') : t('hr.label')}</span>
            <span class="chip" id="routeChip">${routeLabel()}</span>
            <span class="chip" id="typeChip">${U.TYPES[T.st.type]}</span>
          </div>
        </div>
        <div class="rec-panel">
          ${todays && T.st.state === 'idle' && todays.kind !== 'rest' ? `<div class="small muted" style="text-align:center;margin-bottom:8px">${t('rec.today')} <b style="color:var(--text)">${U.esc(S.plan.text(todays).title)}</b></div>` : ''}
          <div class="rec-big"><div class="v" id="rTime">0:00</div><div class="l">${t('rec.time')}</div></div>
          <div class="rec-grid">
            <div><div class="v" id="rDist">${U.km(0)}</div><div class="l">km</div></div>
            <div><div class="v" id="rPace">–:––</div><div class="l" id="rPaceL">${t('rec.pace')}</div></div>
            <div><div class="v" id="rHr">–</div><div class="l">${t('rec.hr')}</div></div>
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
      if (s === 'idle') c.innerHTML = `<button class="round go" id="bStart">${t('rec.start')}</button>`;
      else if (s === 'running') c.innerHTML = `<button class="round pause" id="bPause">${t('rec.pause')}</button><button class="round small pause" id="bLap">${t('rec.lap')}</button>`;
      else c.innerHTML = `<button class="round go small" id="bResume">${t('rec.resume')}</button><button class="round stop" id="bFinish">${t('rec.finish')}</button>`;
      const on = (id, f) => { const b = U.$('#' + id); if (b) b.onclick = f; };
      on('bStart', () => { T.start(T.st.type, T.st.routeId); U.toast(t('rec.bgHint'), 6000); });
      on('bPause', () => T.pause());
      on('bResume', () => T.resume());
      on('bLap', () => { T.say(t('v.lap', { km: U.km(T.st.distance, 2) })); U.toast(t('rec.lapMarked')); });
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
      U.$('#rPaceL').textContent = cur ? t('rec.paceNow') : t('rec.paceAvg');
      const hr = S.hr.value();
      U.$('#rHr').textContent = hr || '–';
      U.$('#rAuto').textContent = st.state === 'running' && st.autoPaused ? t('rec.autoPaused') : st.state === 'paused' ? t('rec.paused') : '';
      const chip = U.$('#gpsChip'), a = st.accuracy;
      chip.className = 'gps-chip ' + (a == null ? '' : a < 0 ? 'bad' : a <= 12 ? 'good' : a <= 30 ? 'ok' : 'bad');
      U.$('#gpsTxt').textContent = st.gpsError ? 'GPS: ' + st.gpsError : a == null ? t('gps.search') : a < 0 ? t('gps.none') : `GPS ±${Math.round(a)} m`;
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
        const ok = await U.confirmSheet(t('rec.tooShort'), t('rec.tooShort.d'), t('discard'), true);
        if (ok) { T.reset(); S.app.render(); }
        return;
      }
      const a = T.finish();
      S.views.record.saveSheet(a);
    }

    U.$('#typeChip').onclick = () => {
      if (T.st.state !== 'idle') return;
      U.sheet(`<h2>${t('sport')}</h2>${Object.keys(U.TYPES).map((k) => `<div class="list-item" data-t="${k}"><div class="grow">${U.TYPES[k]}</div>${k === T.st.type ? '✓' : ''}</div>`).join('')}`,
        (s, close) => U.$$('[data-t]', s).forEach((el) => (el.onclick = () => { T.st.type = el.dataset.t; U.$('#typeChip').textContent = U.TYPES[T.st.type]; close(); })));
    };

    U.$('#routeChip').onclick = () => {
      U.sheet(`<h2>${t('rec.followRoute')}</h2><p class="muted small">${t('rec.followRoute.d')}</p>
        <div class="list-item" data-r=""><div class="grow">${t('rec.noRoute')}</div>${!T.st.routeId ? '✓' : ''}</div>
        ${routes.map((r) => `<div class="list-item" data-r="${r.id}"><div class="grow">${U.esc(r.name)}<div class="small muted">${U.km(r.distance, 1)} km</div></div>${r.id === T.st.routeId ? '✓' : ''}</div>`).join('')}
        ${routes.length ? '' : `<p class="muted small">${t('rec.noRoutes')}</p>`}`,
      (s, close) => U.$$('[data-r]', s).forEach((el) => (el.onclick = () => {
        T.st.routeId = el.dataset.r || null; U.$('#routeChip').textContent = routeLabel(); drawOverlay(); close();
      })));
    };

    U.$('#hrChip').onclick = async () => {
      if (!S.hr.supported()) {
        U.sheet(`<h2>${t('hr.title')}</h2><p class="muted">${t('hr.unsupported.d')}</p><button class="btn block" data-close>OK</button>`);
        return;
      }
      if (S.hr.connected()) { S.hr.disconnect(); U.$('#hrChip').textContent = '♥ ' + t('hr.label'); U.$('#hrChip').classList.remove('on'); return; }
      try {
        const n = await S.hr.connect();
        U.toast(t('hr.connectedTo', { name: n }));
        U.$('#hrChip').textContent = '♥ ' + t('hr.connected'); U.$('#hrChip').classList.add('on');
      } catch (e) { if (e.name !== 'NotFoundError') U.toast(e.message); }
    };
    if (S.hr.connected()) U.$('#hrChip').classList.add('on');

    const off = T.on(update);
    T.warmup();
    update(T.st); controls();
    return () => { off(); T.cooldown(); };
  },

  // After "Finish": name, type, notes → save or discard.
  saveSheet(a) {
    const U = S.util;
    S.db.kvSet('unsaved', a).catch(() => {}); // survives a crash/close while this sheet is open
    U.sheet(`
      <h2>${t('save.title')}</h2>
      <div class="stats" style="margin:12px 0">
        <div class="stat"><div class="v">${U.km(a.distance)}</div><div class="l">km</div></div>
        <div class="stat"><div class="v">${U.duration(a.moving)}</div><div class="l">${t('rec.time')}</div></div>
        <div class="stat"><div class="v">${U.pace(a.moving / (a.distance / 1000))}</div><div class="l">/km</div></div>
      </div>
      <label>${t('name')}</label><input id="sName" value="${U.esc(a.name)}">
      <label>${t('sport')}</label><select id="sType">${Object.keys(U.TYPES).map((k) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${U.TYPES[k]}</option>`).join('')}</select>
      <label>${t('notes')}</label><textarea id="sNotes" rows="3" placeholder="${U.esc(t('notes.ph'))}"></textarea>
      <label>${t('rpe')}</label><input id="sRpe" type="range" min="1" max="10" value="5">
      ${S.social && S.social.enabled() ? `<div class="list-item"><div class="grow">${t('save.share')}<div class="small muted">${t('save.share.d')}</div></div><input type="checkbox" id="sShare" checked></div>` : ''}
      <div class="btn-row"><button class="btn danger" id="sDel">${t('discard')}</button><button class="btn primary grow" id="sSave">${t('save')}</button></div>`,
    (s, close) => {
      U.$('#sheetBackdrop').onclick = null; // don't lose a run by tapping outside
      U.$('#sSave', s).onclick = async () => {
        a.name = U.$('#sName', s).value.trim() || a.name;
        a.type = U.$('#sType', s).value;
        a.notes = U.$('#sNotes', s).value.trim();
        a.rpe = +U.$('#sRpe', s).value;
        const share = U.$('#sShare', s);
        a.private = share ? !share.checked : false;
        S.analysis.finalize(a);
        a.load = S.analysis.load(a, await S.db.settings());
        await S.db.saveActivity(a);
        await S.db.kvSet('unsaved', null);
        close();
        if (S.social) S.social.pushRun(a).catch(() => {});
        location.hash = '#/activity/' + a.id;
      };
      U.$('#sDel', s).onclick = async () => {
        if (await U.confirmSheet(t('save.discardQ'), t('cannotUndo'), t('discard'), true)) { await S.db.kvSet('unsaved', null); S.app.render(); }
        else S.views.record.saveSheet(a);
      };
    });
  },
};
