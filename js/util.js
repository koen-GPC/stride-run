window.S = window.S || {};

S.util = (() => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;

  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function pathLength(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
    return d;
  }

  function bbox(pts) {
    let a = 90, b = -90, c = 180, e = -180;
    for (const p of pts) { if (p.lat < a) a = p.lat; if (p.lat > b) b = p.lat; if (p.lon < c) c = p.lon; if (p.lon > e) e = p.lon; }
    return { minLat: a, maxLat: b, minLon: c, maxLon: e };
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function duration(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }

  function durationWords(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}u ${m}m` : `${m}m`;
  }

  // seconds per km -> "5:12"
  function pace(spk) {
    if (!isFinite(spk) || spk <= 0 || spk > 3600) return '–:––';
    const m = Math.floor(spk / 60), s = Math.round(spk % 60);
    return s === 60 ? `${m + 1}:00` : `${m}:${pad2(s)}`;
  }

  function km(m, digits = 2) { return ((m || 0) / 1000).toFixed(digits).replace('.', ','); }

  const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  function date(ts) {
    const d = new Date(ts);
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  function dateTime(ts) {
    const d = new Date(ts);
    return `${date(ts)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function shortDate(ts) { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeek(ts) { // Monday
    const d = new Date(startOfDay(ts));
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  function startOfMonth(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  function startOfYear(ts) { return new Date(new Date(ts).getFullYear(), 0, 1).getTime(); }
  function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
  function isoDay(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

  function defaultName(ts, type) {
    const h = new Date(ts).getHours();
    const part = h < 6 ? 'Nacht' : h < 12 ? 'Ochtend' : h < 14 ? 'Middag' : h < 18 ? 'Namiddag' : 'Avond';
    const t = { run: 'loop', walk: 'wandeling', hike: 'hike', ride: 'rit' }[type] || 'loop';
    return `${part}${t}`;
  }

  const TYPES = { run: 'Hardlopen', walk: 'Wandelen', hike: 'Hiken', ride: 'Fietsen' };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function sheet(html, onMount) {
    const s = $('#sheet'), b = $('#sheetBackdrop');
    s.innerHTML = html; s.hidden = false; b.hidden = false;
    const close = () => { s.hidden = true; b.hidden = true; s.innerHTML = ''; };
    b.onclick = close;
    $$('[data-close]', s).forEach((x) => (x.onclick = close));
    if (onMount) onMount(s, close);
    return close;
  }

  function confirmSheet(title, body, okLabel = 'Bevestigen', danger = false) {
    return new Promise((resolve) => {
      sheet(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
        <div class="btn-row"><button class="btn grow" data-close>Annuleren</button>
        <button class="btn grow ${danger ? 'danger' : 'primary'}" id="cOk">${esc(okLabel)}</button></div>`,
      (s, close) => {
        $('#sheetBackdrop').onclick = () => { close(); resolve(false); };
        $$('[data-close]', s).forEach((x) => (x.onclick = () => { close(); resolve(false); }));
        $('#cOk', s).onclick = () => { close(); resolve(true); };
      });
    });
  }

  function download(filename, text, mime = 'application/octet-stream') {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'activiteit'; }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  return {
    dist, pathLength, bbox, duration, durationWords, pace, km, date, dateTime, shortDate,
    startOfDay, startOfWeek, startOfMonth, startOfYear, addDays, isoDay, defaultName, TYPES,
    uid, esc, $, $$, toast, sheet, confirmSheet, download, slug, css, DAYS, MONTHS, pad2,
  };
})();
