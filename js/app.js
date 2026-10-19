S.app = (() => {
  const U = S.util;
  const ROUTES = [
    [/^#\/record$/, 'record'], [/^#\/activities$/, 'activities'], [/^#\/activity\/(.+)$/, 'activity'],
    [/^#\/explore$/, 'explore'], [/^#\/route\/(.+)$/, 'route'], [/^#\/segment\/(.+)$/, 'segment'],
    [/^#\/plan-route$/, 'planRoute'], [/^#\/training$/, 'training'], [/^#\/me$/, 'me'],
  ];
  let cleanup = null, renderSeq = 0;

  function title(t) { U.$('#title').textContent = t; document.title = t === 'Stride' ? t : `${t} · Stride`; }
  function topRight(html) { U.$('#topRight').innerHTML = html; }

  async function render() {
    const seq = ++renderSeq;
    const hash = location.hash || '#/record';
    let name = 'record', param;
    for (const [re, n] of ROUTES) { const m = hash.match(re); if (m) { name = n; param = m[1]; break; } }
    const view = S.views[name];
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    S.maps.destroyAll();
    const main = U.$('#view');
    main.className = view.full ? 'full' : '';
    main.innerHTML = '';
    title(view.title); topRight('');
    const back = U.$('#backBtn');
    back.hidden = !view.back;
    back.onclick = () => (history.length > 1 ? history.back() : (location.hash = view.back));
    U.$$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === view.tab));
    window.scrollTo(0, 0);
    try {
      const c = await view.render(main, param);
      if (seq !== renderSeq) { c && c(); return; }
      cleanup = c || null;
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="empty">Er ging iets mis: ${U.esc(e.message)}</div>`;
    }
    livePill();
  }

  function livePill() {
    const st = S.tracker.st, pill = U.$('#livePill');
    const onRecord = (location.hash || '#/record') === '#/record';
    pill.hidden = st.state === 'idle' || onRecord;
    U.$('#livePillText').textContent = st.state === 'paused' ? `Gepauzeerd · ${U.km(st.distance)} km` : `${U.duration(st.moving)} · ${U.km(st.distance)} km`;
  }

  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const dark = S.maps.isDark();
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0e1013' : '#f5f6f4';
  }

  async function recover() {
    const unsaved = await S.db.kvGet('unsaved', null);
    if (unsaved) { location.hash = '#/record'; setTimeout(() => S.views.record.saveSheet(unsaved), 300); return; }
    const snap = await S.tracker.pending();
    if (snap && snap.points && snap.points.length) {
      const go = await U.confirmSheet('Onderbroken activiteit gevonden',
        `${U.km(snap.distance)} km, ${U.duration(snap.moving)} — gestart ${U.dateTime(snap.start)}. Doorgaan met deze opname?`, 'Doorgaan');
      if (go) { await S.tracker.restore(snap); location.hash = '#/record'; render(); }
      else {
        const save = await U.confirmSheet('Opslaan of weggooien?', 'Wil je de onderbroken activiteit opslaan zoals hij is?', 'Opslaan');
        await S.tracker.clearPending();
        if (save) {
          const a = S.analysis.finalize({ id: U.uid(), type: snap.type, name: U.defaultName(snap.start, snap.type), notes: '', start: snap.start, points: snap.points, source: 'gps' });
          S.views.record.saveSheet(a);
        }
      }
    }
  }

  async function init() {
    const st = await S.db.settings();
    applyTheme(st.theme);
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(st.theme));
    U.$('#livePill').onclick = () => (location.hash = '#/record');
    S.tracker.on(livePill);
    window.addEventListener('hashchange', render);
    if (!location.hash) history.replaceState(null, '', '#/record');
    await render();
    recover();
    // Ask the browser not to evict our data under storage pressure.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('beforeunload', (e) => { if (S.tracker.st.state !== 'idle') { e.preventDefault(); e.returnValue = ''; } });
  }

  return { render, title, topRight, applyTheme, init };
})();

S.app.init();
