// GPX import/export.
S.gpx = (() => {
  const U = S.util;
  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Ongeldig GPX-bestand');
    const pts = [];
    const nodes = doc.getElementsByTagName('trkpt').length ? doc.getElementsByTagName('trkpt') : doc.getElementsByTagName('rtept');
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute('lat')), lon = parseFloat(n.getAttribute('lon'));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const ele = n.getElementsByTagName('ele')[0];
      const time = n.getElementsByTagName('time')[0];
      let hr = null;
      for (const c of n.getElementsByTagName('*')) if (c.localName === 'hr') { hr = parseInt(c.textContent, 10) || null; break; }
      const p = { lat, lon, t: time ? Date.parse(time.textContent) : null };
      if (ele) p.alt = parseFloat(ele.textContent);
      if (hr) p.hr = hr;
      pts.push(p);
    }
    const nameEl = doc.querySelector('trk > name') || doc.querySelector('metadata > name') || doc.querySelector('rte > name');
    const typeEl = doc.querySelector('trk > type');
    const timed = pts.length > 1 && pts.every((p) => p.t);
    return { name: nameEl ? nameEl.textContent.trim() : null, type: typeEl ? typeEl.textContent.trim().toLowerCase() : null, points: pts, timed };
  }

  function mapType(t) {
    if (!t) return 'run';
    if (/run|9/.test(t)) return 'run';
    if (/walk|10/.test(t)) return 'walk';
    if (/hik/.test(t)) return 'hike';
    if (/ride|cycl|bik|1$/.test(t)) return 'ride';
    return 'run';
  }

  function toActivity(parsed) {
    const pts = S.analysis.prepare(parsed.points);
    const a = { id: U.uid(), type: mapType(parsed.type), name: parsed.name || '', notes: '', start: pts[0].t, points: pts, source: 'gpx' };
    if (!a.name) a.name = U.defaultName(a.start, a.type);
    return S.analysis.finalize(a);
  }

  function build(name, pts, timed = true) {
    const body = pts.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}${timed && p.t ? `<time>${new Date(p.t).toISOString()}</time>` : ''}${p.hr ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Stride" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>${U.esc(name)}</name><trkseg>
${body}
</trkseg></trk></gpx>`;
  }

  return { parse, toActivity, build };
})();

S.views.activities = {
  tab: 'activities', title: 'Activiteiten',
  async render(main) {
    const U = S.util;
    const acts = await S.db.activities();
    const st = await S.db.settings();
    const recs = S.analysis.records(acts);
    S.app.topRight(`<button class="btn sm" id="impBtn">GPX importeren</button>`);
    U.$('#impBtn').onclick = () => S.views.activities.importGpx();

    if (!acts.length) {
      main.innerHTML = `<div class="empty"><div class="big">🏃</div><p>Nog geen activiteiten.</p>
        <p class="small">Start je eerste run via <b>Opnemen</b>, of importeer GPX-bestanden van Strava of je horloge.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn primary" href="#/record">Run starten</a></div></div>`;
      return;
    }

    let html = '', curWeek = null;
    const weekTotals = new Map();
    for (const a of acts) { const w = U.startOfWeek(a.start); weekTotals.set(w, (weekTotals.get(w) || 0) + a.distance); }
    for (const a of acts) {
      const w = U.startOfWeek(a.start);
      if (w !== curWeek) {
        curWeek = w;
        html += `<div class="week-head"><span>Week van ${U.shortDate(w)}</span><span>${U.km(weekTotals.get(w), 1)} km</span></div>`;
      }
      const prs = a.type === 'run' ? S.analysis.EFFORTS.filter((e) => recs[e.m][0] && recs[e.m][0].id === a.id).length : 0;
      html += `<a class="card act" href="#/activity/${a.id}">
        <canvas data-thumb="${a.id}"></canvas>
        <div class="grow">
          <div class="meta">${U.dateTime(a.start)} · ${U.TYPES[a.type] || a.type}</div>
          <div class="name">${U.esc(a.name)} ${prs ? `<span class="badge pr">🏆 ${prs} PR</span>` : ''}</div>
          <div class="nums">
            <div><b>${U.km(a.distance)}</b><span class="muted">km</span></div>
            <div><b>${U.pace(a.moving / (a.distance / 1000))}</b><span class="muted">/km</span></div>
            <div><b>${U.duration(a.moving)}</b><span class="muted">tijd</span></div>
          </div>
        </div></a>`;
    }
    main.innerHTML = html;
    requestAnimationFrame(() => {
      for (const c of U.$$('canvas[data-thumb]', main)) {
        const a = acts.find((x) => x.id === c.dataset.thumb);
        S.charts.thumb(c, a.points);
      }
    });
  },

  importGpx() {
    const U = S.util;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.gpx,application/gpx+xml'; inp.multiple = true;
    inp.onchange = async () => {
      const st = await S.db.settings();
      const existing = await S.db.activities();
      let ok = 0, skip = 0, fail = 0;
      for (const f of inp.files) {
        try {
          const parsed = S.gpx.parse(await f.text());
          if (!parsed.timed) { fail++; continue; }
          const a = S.gpx.toActivity(parsed);
          if (existing.some((x) => Math.abs(x.start - a.start) < 60000)) { skip++; continue; }
          a.load = S.analysis.load(a, st);
          await S.db.saveActivity(a); ok++;
        } catch (e) { fail++; }
      }
      U.toast(`${ok} geïmporteerd${skip ? `, ${skip} dubbel` : ''}${fail ? `, ${fail} mislukt (zonder tijden of ongeldig)` : ''}`, 3500);
      S.app.render();
    };
    inp.click();
  },
};

S.views.activity = {
  tab: 'activities', title: 'Activiteit', back: '#/activities',
  async render(main, id) {
    const U = S.util, A = S.analysis;
    const a = await S.db.get('activities', id);
    if (!a) { main.innerHTML = '<div class="empty">Activiteit niet gevonden.</div>'; return; }
    const st = await S.db.settings();
    const acts = await S.db.activities();
    const recs = A.records(acts);
    const segs = await S.db.all('segments');
    const pts = a.points;
    const avgPace = a.moving / (a.distance / 1000);
    const splits = A.splits(pts);
    const zones = A.timeInZones(pts, st.maxHr);
    const hasHr = zones.some((z) => z > 0);
    const hasAlt = pts.some((p) => p.alt != null);
    const load = a.load ?? A.load(a, st);
    S.app.title(a.name);
    S.app.topRight(`<button class="btn sm" id="moreBtn">•••</button>`);

    const efforts = a.type === 'run' ? A.EFFORTS.filter((e) => a.best && a.best[e.m]).map((e) => {
      const rank = recs[e.m].findIndex((r) => r.id === a.id && Math.abs(r.time - a.best[e.m]) < 0.01);
      return { ...e, time: a.best[e.m], rank };
    }) : [];
    const segEfforts = segs.map((s) => ({ s, m: A.matchSegment(s, a) })).filter((x) => x.m);

    const fastest = Math.min(...splits.filter((x) => !x.partial).map((x) => x.pace), Infinity);
    const slowest = Math.max(...splits.map((x) => x.pace), 0);

    main.innerHTML = `
      <div class="muted small">${U.dateTime(a.start)} · ${U.TYPES[a.type] || a.type}${a.source === 'gpx' ? ' · geïmporteerd' : ''}</div>
      <h2 style="margin:4px 0 12px">${U.esc(a.name)}</h2>
      ${a.notes ? `<p>${U.esc(a.notes)}</p>` : ''}
      <div class="map-box" id="aMap"></div>
      <div class="card"><div class="stats">
        <div class="stat"><div class="v">${U.km(a.distance)}</div><div class="l">Afstand (km)</div></div>
        <div class="stat"><div class="v">${U.pace(avgPace)}</div><div class="l">Gem. tempo /km</div></div>
        <div class="stat"><div class="v">${U.duration(a.moving)}</div><div class="l">Beweegtijd</div></div>
        <div class="stat"><div class="v">${Math.round(a.elevGain || 0)} m</div><div class="l">Hoogtemeters</div></div>
        <div class="stat"><div class="v">${U.duration(a.elapsed)}</div><div class="l">Totale tijd</div></div>
        <div class="stat"><div class="v">≈${A.calories(a, st)}</div><div class="l">kcal (schatting)</div></div>
        ${a.avgHr ? `<div class="stat"><div class="v">${a.avgHr}</div><div class="l">Gem. hartslag</div></div><div class="stat"><div class="v">${a.maxHr}</div><div class="l">Max. hartslag</div></div>` : ''}
        <div class="stat"><div class="v">${load}</div><div class="l">Belasting</div></div>
        ${a.rpe ? `<div class="stat"><div class="v">${a.rpe}/10</div><div class="l">Gevoel</div></div>` : ''}
      </div></div>

      ${efforts.length ? `<div class="section-title">Beste prestaties in deze activiteit</div><div class="card">
        <table class="t">${efforts.map((e) => `<tr><td>${e.label}</td><td class="r"><b>${U.duration(e.time)}</b></td>
          <td class="r">${e.rank === 0 ? '<span class="badge pr">🏆 PR</span>' : e.rank === 1 ? '<span class="badge">2e beste</span>' : e.rank === 2 ? '<span class="badge">3e beste</span>' : ''}</td></tr>`).join('')}</table></div>` : ''}

      ${segEfforts.length ? `<div class="section-title">Segmenten</div><div class="card">
        ${segEfforts.map(({ s, m }) => {
          const all = acts.map((x) => A.matchSegment(s, x)).filter(Boolean).sort((p, q) => p.time - q.time);
          const rank = all.findIndex((x) => x.activity === a.id) + 1;
          return `<a class="list-item" href="#/segment/${s.id}"><div class="grow"><b>${U.esc(s.name)}</b><div class="small muted">${U.km(s.distance, 2)} km · ${U.pace(m.time / (s.distance / 1000))} /km</div></div>
            <div style="text-align:right"><b>${U.duration(m.time)}</b><div class="small">${rank === 1 ? '<span class="badge pr">🏆 PR</span>' : `#${rank} van ${all.length}`}</div></div></a>`;
        }).join('')}</div>` : ''}

      <div class="section-title">Tempo</div><div class="card"><canvas class="chart" id="cPace"></canvas></div>
      ${hasAlt ? `<div class="section-title">Hoogte</div><div class="card"><canvas class="chart" id="cAlt"></canvas></div>` : ''}
      ${hasHr ? `<div class="section-title">Hartslag</div><div class="card"><canvas class="chart" id="cHr"></canvas></div>
        <div class="section-title">Hartslagzones</div><div class="card"><div class="zones">${A.ZONES.map((z, i) => {
          const tot = zones.reduce((s, v) => s + v, 0) || 1;
          return `<div class="zone"><b>${z.n}</b><div class="track"><div class="fill" style="width:${(zones[i] / tot) * 100}%;background:var(--z${i + 1})"></div></div><span class="small r">${U.durationWords(zones[i])}</span></div>`;
        }).join('')}</div><div class="small muted" style="margin-top:8px">Op basis van max. hartslag ${st.maxHr} (instelbaar onder Ik).</div></div>` : ''}

      ${splits.length ? `<div class="section-title">Splits</div><div class="card"><table class="t">
        <tr><th>km</th><th>Tempo</th><th></th><th class="r">Hoogte</th></tr>
        ${splits.map((s) => `<tr><td>${s.partial ? U.km(s.dist, 2) : s.n}</td><td><b>${U.pace(s.pace)}</b></td>
          <td style="width:45%"><div class="bar ${s.pace > avgPace * 1.05 ? 'slow' : ''}" style="width:${Math.max(8, 100 - ((s.pace - fastest) / Math.max(1, slowest - fastest)) * 70)}%"></div></td>
          <td class="r small muted">${s.elev != null ? (s.elev >= 0 ? '+' : '') + Math.round(s.elev) + ' m' : ''}</td></tr>`).join('')}
      </table></div>` : ''}
    `;

    const map = S.maps.create(U.$('#aMap'));
    let marker = null;
    if (map) { S.maps.track(map, pts); S.maps.fit(map, pts); }
    const hoverAt = (series) => (i) => {
      if (!map) return;
      if (i == null) { marker && marker.remove(); marker = null; return; }
      const km = series.xs[i] * 1000;
      const p = pts.find((q) => q.d >= km) || pts[pts.length - 1];
      if (!marker) marker = S.maps.youMarker(map, [p.lat, p.lon]); else marker.setLatLng([p.lat, p.lon]);
    };
    const fmtKm = (v) => v.toFixed(1).replace('.', ',') + ' km';
    const ps = A.paceSeries(pts);
    S.charts.line(U.$('#cPace'), ps.xs, ps.ys, { invert: true, robust: true, fmtY: U.pace, fmtX: fmtKm, onHover: hoverAt(ps) });
    if (hasAlt) { const s = A.seriesBy(pts, 'alt'); S.charts.line(U.$('#cAlt'), s.xs, s.ys, { color: '#8b95a1', fmtY: (v) => Math.round(v) + ' m', fmtX: fmtKm, onHover: hoverAt(s) }); }
    if (hasHr) { const s = A.seriesBy(pts, 'hr', 30); S.charts.line(U.$('#cHr'), s.xs, s.ys, { color: '#ff5c5c', fmtY: (v) => Math.round(v), fmtX: fmtKm, onHover: hoverAt(s) }); }

    U.$('#moreBtn').onclick = () => U.sheet(`<h2>${U.esc(a.name)}</h2>
      <div class="list-item" id="mEdit"><div class="grow">Bewerken</div><span class="chev">›</span></div>
      <div class="list-item" id="mSeg"><div class="grow">Segment maken van deel van deze route</div><span class="chev">›</span></div>
      <div class="list-item" id="mRoute"><div class="grow">Opslaan als route</div><span class="chev">›</span></div>
      <div class="list-item" id="mGpx"><div class="grow">Exporteren als GPX</div><span class="chev">›</span></div>
      <div class="list-item" id="mDel"><div class="grow" style="color:var(--danger)">Verwijderen</div></div>`,
    (s, close) => {
      U.$('#mGpx', s).onclick = () => { U.download(U.slug(a.name) + '.gpx', S.gpx.build(a.name, pts), 'application/gpx+xml'); close(); };
      U.$('#mRoute', s).onclick = async () => {
        await S.db.put('routes', { id: U.uid(), name: a.name, points: A.simplify(pts, 4), distance: a.distance, created: Date.now(), from: a.id });
        close(); U.toast('Route opgeslagen');
      };
      U.$('#mDel', s).onclick = async () => {
        if (await U.confirmSheet('Activiteit verwijderen?', 'Dit kan niet ongedaan worden gemaakt.', 'Verwijderen', true)) {
          await S.db.deleteActivity(a.id); location.hash = '#/activities';
        }
      };
      U.$('#mEdit', s).onclick = () => S.views.activity.editSheet(a);
      U.$('#mSeg', s).onclick = () => { close(); S.views.activity.segmentSheet(a, map); };
    });
  },

  editSheet(a) {
    const U = S.util;
    U.sheet(`<h2>Bewerken</h2>
      <label>Naam</label><input id="eName" value="${U.esc(a.name)}">
      <label>Sport</label><select id="eType">${Object.entries(U.TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>Notities</label><textarea id="eNotes" rows="3">${U.esc(a.notes || '')}</textarea>
      <label>Gevoel (RPE ${a.rpe || 5})</label><input id="eRpe" type="range" min="1" max="10" value="${a.rpe || 5}">
      <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="eSave">Opslaan</button></div>`,
    (s, close) => {
      U.$('#eSave', s).onclick = async () => {
        a.name = U.$('#eName', s).value.trim() || a.name; a.type = U.$('#eType', s).value;
        a.notes = U.$('#eNotes', s).value.trim(); a.rpe = +U.$('#eRpe', s).value;
        S.analysis.finalize(a); a.load = S.analysis.load(a, await S.db.settings());
        await S.db.saveActivity(a); close(); S.app.render();
      };
    });
  },

  segmentSheet(a, map) {
    const U = S.util, pts = a.points, total = a.distance;
    let hl = null;
    const step = 10;
    const max = Math.floor(total / step);
    const idxAt = (m) => { let i = pts.findIndex((p) => p.d >= m); return i < 0 ? pts.length - 1 : i; };
    U.sheet(`<h2>Segment maken</h2><p class="muted small">Kies begin en eind. Het stuk wordt geel op de kaart. Daarna wordt elke run over dit stuk automatisch getimed.</p>
      <label>Begin: <b id="sgA"></b></label><input type="range" id="sgFrom" min="0" max="${max}" value="0">
      <label>Eind: <b id="sgB"></b></label><input type="range" id="sgTo" min="0" max="${max}" value="${max}">
      <div class="small muted" id="sgLen" style="margin-top:8px"></div>
      <label>Naam</label><input id="sgName" placeholder="Bijv. Brug tot molen">
      <div class="btn-row"><button class="btn grow" data-close>Annuleren</button><button class="btn primary grow" id="sgSave">Segment opslaan</button></div>`,
    (s, close) => {
      // the sheet covers the map's lower part; keep it visible above
      U.$('#sheet').style.maxHeight = '60dvh';
      U.$('#sheetBackdrop').style.background = 'transparent';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const upd = () => {
        let f = +U.$('#sgFrom', s).value * step, t = +U.$('#sgTo', s).value * step;
        if (t < f) [f, t] = [t, f];
        U.$('#sgA', s).textContent = U.km(f, 2) + ' km'; U.$('#sgB', s).textContent = U.km(t, 2) + ' km';
        U.$('#sgLen', s).textContent = `Lengte ${U.km(t - f, 2)} km`;
        if (map) {
          hl && hl.remove();
          hl = L.polyline(S.maps.latlngs(pts.slice(idxAt(f), idxAt(t) + 1)), { color: '#ffd400', weight: 7 }).addTo(map);
        }
        return [f, t];
      };
      U.$('#sgFrom', s).oninput = upd; U.$('#sgTo', s).oninput = upd; upd();
      const cleanup = () => { hl && hl.remove(); U.$('#sheet').style.maxHeight = ''; U.$('#sheetBackdrop').style.background = ''; };
      U.$$('[data-close]', s).forEach((x) => (x.onclick = () => { cleanup(); close(); }));
      U.$('#sheetBackdrop').onclick = () => { cleanup(); close(); };
      U.$('#sgSave', s).onclick = async () => {
        const [f, t] = upd();
        if (t - f < 200) { U.toast('Een segment moet minstens 200 m zijn'); return; }
        const slice = pts.slice(idxAt(f), idxAt(t) + 1);
        const seg = { id: U.uid(), name: U.$('#sgName', s).value.trim() || `Segment ${U.km(t - f, 1)} km`, points: S.analysis.simplify(slice, 3), distance: slice[slice.length - 1].d - slice[0].d, created: Date.now() };
        await S.db.put('segments', seg);
        cleanup(); close();
        location.hash = '#/segment/' + seg.id;
      };
    });
  },
};
