// Leaflet helpers. One map per screen; destroyed on navigation.
S.maps = (() => {
  const live = new Set();

  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  function create(el, opts = {}) {
    if (!window.L) { el.innerHTML = '<div class="empty small">Kaart niet beschikbaar (offline?)</div>'; return null; }
    const map = L.map(el, { zoomControl: false, attributionControl: true, ...opts });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: isDark() ? 'tiles-dark' : '',
      attribution: '© OpenStreetMap',
    }).addTo(map);
    live.add(map);
    return map;
  }

  function destroyAll() { for (const m of live) { try { m.remove(); } catch {} } live.clear(); }

  function latlngs(pts) { return pts.map((p) => [p.lat, p.lon]); }

  // Split a track at pause boundaries so we don't draw a line across a gap.
  function pieces(pts) {
    const out = []; let cur = [];
    for (const p of pts) { if (p.b && cur.length) { out.push(cur); cur = []; } cur.push([p.lat, p.lon]); }
    if (cur.length) out.push(cur);
    return out;
  }

  function track(map, pts, opts = {}) {
    const color = opts.color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const line = L.polyline(pieces(pts), { color, weight: opts.weight || 4, opacity: opts.opacity ?? 0.95, lineJoin: 'round', dashArray: opts.dash }).addTo(map);
    if (opts.endpoints !== false && pts.length) {
      L.circleMarker([pts[0].lat, pts[0].lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#3ccf91', fillOpacity: 1 }).addTo(map);
      const l = pts[pts.length - 1];
      L.circleMarker([l.lat, l.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#ff5c5c', fillOpacity: 1 }).addTo(map);
    }
    return line;
  }

  function fit(map, pts) {
    if (!pts.length) return;
    if (pts.length === 1) { map.setView([pts[0].lat, pts[0].lon], 16); return; }
    map.fitBounds(L.latLngBounds(latlngs(pts)), { padding: [24, 24] });
  }

  function youMarker(map, latlng) {
    return L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#4fa3ff', fillOpacity: 1 }).addTo(map);
  }

  return { create, destroyAll, track, fit, latlngs, pieces, youMarker, isDark };
})();
