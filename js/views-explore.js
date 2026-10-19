S.views.explore = {
  tab: 'explore', title: 'Routes & segmenten',
  async render(main) {
    const U = S.util;
    const mode = sessionStorage.getItem('exploreTab') || 'routes';
    const routes = (await S.db.all('routes')).sort((a, b) => b.created - a.created);
    const segs = (await S.db.all('segments')).sort((a, b) => b.created - a.created);
    const acts = await S.db.activities();

    main.innerHTML = `
      <div class="seg"><button data-m="routes" class="${mode === 'routes' ? 'on' : ''}">Routes (${routes.length})</button><button data-m="segments" class="${mode === 'segments' ? 'on' : ''}">Segmenten (${segs.length})</button></div>
      <div id="exBody"></div>`;
    U.$$('.seg button', main).forEach((b) => (b.onclick = () => { sessionStorage.setItem('exploreTab', b.dataset.m); S.app.render(); }));
    const body = U.$('#exBody');

    if (mode === 'routes') {
      body.innerHTML = `
        <div class="btn-row" style="margin-top:0;margin-bottom:12px"><a class="btn primary grow" href="#/plan-route">+ Route plannen</a><button class="btn" id="rImp">GPX importeren</button></div>
        ${routes.length ? routes.map((r) => `<a class="card act" href="#/route/${r.id}"><canvas data-r="${r.id}"></canvas>
          <div class="grow"><div class="name">${U.esc(r.name)}</div><div class="meta">${U.km(r.distance, 2)} km · ${U.shortDate(r.created)}</div></div></a>`).join('')
          : '<div class="empty"><div class="big">🗺️</div>Nog geen routes. Plan er een op de kaart, of sla een gelopen activiteit op als route.</div>'}`;
      U.$('#rImp').onclick = () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.gpx'; inp.multiple = true;
        inp.onchange = async () => {
          let n = 0;
          for (const f of inp.files) {
            try {
              const p = S.gpx.parse(await f.text());
              if (p.points.length < 2) continue;
              await S.db.put('routes', { id: U.uid(), name: p.name || f.name.replace(/\.gpx$/i, ''), points: S.analysis.simplify(p.points, 4), distance: U.pathLength(p.points), created: Date.now() });
              n++;
            } catch {}
          }
          U.toast(`${n} route(s) geïmporteerd`); S.app.render();
        };
        inp.click();
      };
      requestAnimationFrame(() => U.$$('canvas[data-r]', body).forEach((c) => S.charts.thumb(c, routes.find((r) => r.id === c.dataset.r).points, '#4fa3ff')));
    } else {
      body.innerHTML = segs.length ? segs.map((s) => {
        const efforts = acts.map((a) => S.analysis.matchSegment(s, a)).filter(Boolean).sort((a, b) => a.time - b.time);
        return `<a class="card act" href="#/segment/${s.id}"><canvas data-s="${s.id}"></canvas>
          <div class="grow"><div class="name">${U.esc(s.name)}</div><div class="meta">${U.km(s.distance, 2)} km · ${efforts.length}× gelopen</div>
          <div class="nums"><div><b>${efforts[0] ? U.duration(efforts[0].time) : '–'}</b><span class="muted">PR</span></div>
          <div><b>${efforts[0] ? U.pace(efforts[0].time / (s.distance / 1000)) : '–'}</b><span class="muted">/km</span></div></div></div></a>`;
      }).join('') : `<div class="empty"><div class="big">⏱️</div><p>Nog geen segmenten.</p><p class="small">Open een activiteit → ••• → <b>Segment maken</b>. Elke keer dat je dat stuk loopt, wordt je tijd automatisch vergeleken.</p></div>`;
      requestAnimationFrame(() => U.$$('canvas[data-s]', body).forEach((c) => S.charts.thumb(c, segs.find((r) => r.id === c.dataset.s).points, '#ffd400')));
    }
  },
};

S.views.route = {
  tab: 'explore', title: 'Route', back: '#/explore',
  async render(main, id) {
    const U = S.util;
    const r = await S.db.get('routes', id);
    if (!r) { main.innerHTML = '<div class="empty">Route niet gevonden.</div>'; return; }
    const acts = (await S.db.activities()).filter((a) => a.type === 'run' && a.distance > 1000);
    const recent = acts.slice(0, 10);
    const avgPace = recent.length ? recent.reduce((s, a) => s + a.moving, 0) / (recent.reduce((s, a) => s + a.distance, 0) / 1000) : null;
    S.app.title(r.name);
    main.innerHTML = `
      <div class="map-box tall" id="rMap"></div>
      <div class="card"><div class="stats">
        <div class="stat"><div class="v">${U.km(r.distance, 2)}</div><div class="l">km</div></div>
        <div class="stat"><div class="v">${avgPace ? U.duration(avgPace * r.distance / 1000) : '–'}</div><div class="l">Verwachte tijd</div></div>
        <div class="stat"><div class="v">${avgPace ? U.pace(avgPace) : '–'}</div><div class="l">op jouw tempo</div></div>
      </div></div>
      <button class="btn primary block" id="rGo">Deze route lopen</button>
      <div class="btn-row"><button class="btn grow" id="rRen">Hernoemen</button><button class="btn grow" id="rGpx">GPX</button><button class="btn danger grow" id="rDel">Verwijderen</button></div>`;
    const map = S.maps.create(U.$('#rMap'));
    if (map) { S.maps.track(map, r.points, { color: '#4fa3ff' }); S.maps.fit(map, r.points); }
    U.$('#rGo').onclick = () => {
      if (S.tracker.st.state !== 'idle') { U.toast('Er loopt al een opname'); return; }
      S.tracker.st.routeId = r.id; location.hash = '#/record';
    };
    U.$('#rGpx').onclick = () => U.download(U.slug(r.name) + '.gpx', S.gpx.build(r.name, r.points, false), 'application/gpx+xml');
    U.$('#rRen').onclick = () => renameSheet('routes', r);
    U.$('#rDel').onclick = async () => {
      if (await U.confirmSheet('Route verwijderen?', r.name, 'Verwijderen', true)) { await S.db.del('routes', r.id); location.hash = '#/explore'; }
    };
  },
};

function renameSheet(store, obj) {
  const U = S.util;
  U.sheet(`<h2>Hernoemen</h2><input id="rnName" value="${U.esc(obj.name)}">
    <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="rnOk">Opslaan</button></div>`,
  (s, close) => { U.$('#rnOk', s).onclick = async () => { obj.name = U.$('#rnName', s).value.trim() || obj.name; await S.db.put(store, obj); close(); S.app.render(); }; });
}

S.views.segment = {
  tab: 'explore', title: 'Segment', back: '#/explore',
  async render(main, id) {
    const U = S.util;
    const s = await S.db.get('segments', id);
    if (!s) { main.innerHTML = '<div class="empty">Segment niet gevonden.</div>'; return; }
    const acts = await S.db.activities();
    const efforts = acts.map((a) => { const m = S.analysis.matchSegment(s, a); return m && { ...m, name: a.name }; }).filter(Boolean);
    const ranked = [...efforts].sort((a, b) => a.time - b.time);
    const chrono = [...efforts].sort((a, b) => a.start - b.start);
    S.app.title(s.name);
    main.innerHTML = `
      <div class="map-box" id="sMap"></div>
      <div class="card"><div class="stats">
        <div class="stat"><div class="v">${U.km(s.distance, 2)}</div><div class="l">km</div></div>
        <div class="stat"><div class="v">${ranked[0] ? U.duration(ranked[0].time) : '–'}</div><div class="l">Persoonlijk record</div></div>
        <div class="stat"><div class="v">${efforts.length}</div><div class="l">Pogingen</div></div>
      </div></div>
      ${chrono.length > 1 ? `<div class="section-title">Ontwikkeling</div><div class="card"><canvas class="chart" id="sChart"></canvas></div>` : ''}
      <div class="section-title">Jouw ranglijst</div>
      <div class="card">${ranked.length ? `<table class="t"><tr><th>#</th><th>Datum</th><th class="r">Tijd</th><th class="r">Tempo</th><th class="r">♥</th></tr>
        ${ranked.map((e, i) => `<tr onclick="location.hash='#/activity/${e.activity}'" style="cursor:pointer"><td>${i === 0 ? '🏆' : i + 1}</td><td>${U.shortDate(e.start)} ${new Date(e.start).getFullYear()}</td>
          <td class="r"><b>${U.duration(e.time)}</b></td><td class="r">${U.pace(e.time / (s.distance / 1000))}</td><td class="r muted">${e.hr || ''}</td></tr>`).join('')}</table>`
        : '<div class="muted">Nog geen pogingen gevonden.</div>'}</div>
      <div class="btn-row"><button class="btn grow" id="sRen">Hernoemen</button><button class="btn danger grow" id="sDel">Verwijderen</button></div>`;
    const map = S.maps.create(U.$('#sMap'));
    if (map) { S.maps.track(map, s.points, { color: '#ffd400', weight: 6 }); S.maps.fit(map, s.points); }
    if (chrono.length > 1) S.charts.line(U.$('#sChart'), chrono.map((e) => e.start), chrono.map((e) => e.time), { invert: true, fmtY: U.duration, fmtX: U.shortDate, fill: false });
    U.$('#sRen').onclick = () => renameSheet('segments', s);
    U.$('#sDel').onclick = async () => {
      if (await U.confirmSheet('Segment verwijderen?', s.name, 'Verwijderen', true)) { await S.db.del('segments', s.id); location.hash = '#/explore'; }
    };
  },
};

// Route planner: tap the map to add waypoints, optionally snapped to footpaths.
S.views.planRoute = {
  tab: 'explore', title: 'Route plannen', back: '#/explore', full: true,
  async render(main) {
    const U = S.util;
    const st = await S.db.settings();
    let follow = st.followPaths;
    const waypoints = []; // {lat, lon}
    const legs = []; // array of point arrays per leg
    main.innerHTML = `
      <div style="position:relative;height:calc(100dvh - 56px - 58px - var(--safe-t) - var(--safe-b))">
        <div id="pMap" style="position:absolute;inset:0"></div>
        <div class="gps-chip"><b id="pDist">0,00 km</b></div>
        <div class="chips-right"><span class="chip ${follow ? 'on' : ''}" id="pFollow">Volg paden</span></div>
        <div class="planner-bar card" style="margin:0">
          <div class="small muted" id="pHint">Tik op de kaart om je startpunt te zetten.</div>
          <div class="btn-row">
            <button class="btn sm" id="pUndo">Ongedaan</button><button class="btn sm" id="pLoop">Rondje</button>
            <button class="btn sm" id="pClear">Wissen</button><button class="btn sm primary grow" id="pSave">Opslaan</button>
          </div>
        </div>
      </div>`;
    const map = S.maps.create(U.$('#pMap'));
    if (!map) return;
    map.setView([52.37, 4.89], 14);
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 15), () => {}, { timeout: 8000 });
    const line = L.polyline([], { color: '#4fa3ff', weight: 5 }).addTo(map);
    const markers = L.layerGroup().addTo(map);

    const all = () => legs.length ? legs.flatMap((l, i) => (i ? l.slice(1) : l)) : waypoints.slice(0, 1);
    function redraw() {
      const pts = all();
      line.setLatLngs(S.maps.latlngs(pts));
      markers.clearLayers();
      waypoints.forEach((w, i) => L.circleMarker([w.lat, w.lon], { radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#3ccf91' : '#4fa3ff', fillOpacity: 1 }).addTo(markers));
      U.$('#pDist').textContent = U.km(U.pathLength(pts), 2) + ' km';
      U.$('#pHint').textContent = waypoints.length ? 'Tik om de route te verlengen.' : 'Tik op de kaart om je startpunt te zetten.';
    }

    async function leg(a, b) {
      if (!follow) return [a, b];
      try {
        const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const j = await res.json();
        const c = j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
        if (!c || !c.length) throw new Error('geen route');
        return c.map(([lon, lat]) => ({ lat, lon }));
      } catch {
        U.toast('Paden volgen lukte niet (offline?) — rechte lijn gebruikt');
        return [a, b];
      }
    }

    async function add(p) {
      if (waypoints.length) legs.push(await leg(waypoints[waypoints.length - 1], p));
      waypoints.push(p); redraw();
    }

    map.on('click', (e) => add({ lat: e.latlng.lat, lon: e.latlng.lng }));
    U.$('#pUndo').onclick = () => { if (!waypoints.length) return; waypoints.pop(); legs.pop(); redraw(); };
    U.$('#pClear').onclick = () => { waypoints.length = 0; legs.length = 0; redraw(); };
    U.$('#pLoop').onclick = () => { if (waypoints.length > 1) add({ ...waypoints[0] }); };
    U.$('#pFollow').onclick = async () => { follow = !follow; U.$('#pFollow').classList.toggle('on', follow); await S.db.saveSettings({ followPaths: follow }); };
    U.$('#pSave').onclick = () => {
      const pts = all();
      if (pts.length < 2) { U.toast('Zet minstens twee punten'); return; }
      U.sheet(`<h2>Route opslaan</h2><p class="muted">${U.km(U.pathLength(pts), 2)} km</p><label>Naam</label><input id="pName" placeholder="Bijv. Rondje park">
        <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="pOk">Opslaan</button></div>`,
      (s, close) => {
        U.$('#pOk', s).onclick = async () => {
          const r = { id: U.uid(), name: U.$('#pName', s).value.trim() || `Route ${U.km(U.pathLength(pts), 1)} km`, points: S.analysis.simplify(pts, 3), distance: U.pathLength(pts), created: Date.now() };
          await S.db.put('routes', r); close(); location.hash = '#/route/' + r.id;
        };
      });
    };
    redraw();
  },
};
