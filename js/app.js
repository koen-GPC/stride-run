S.app = (() => {
  const U = S.util;
  const ROUTES = [
    [/^#\/record$/, 'record'], [/^#\/activities$/, 'activities'], [/^#\/activity\/(.+)$/, 'activity'],
    [/^#\/explore$/, 'explore'], [/^#\/route\/(.+)$/, 'route'], [/^#\/segment\/(.+)$/, 'segment'],
    [/^#\/plan-route$/, 'planRoute'], [/^#\/training$/, 'training'], [/^#\/me$/, 'me'], [/^#\/friends$/, 'friends'],
  ];
  let cleanup = null, renderSeq = 0;

  function title(txt) { U.$('#title').textContent = txt; document.title = txt === 'Stride' ? txt : `${txt} · Stride`; }
  function topRight(html) { U.$('#topRight').innerHTML = html; }

  function applyLabels() {
    U.$$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.documentElement.lang = S.i18n.lang;
  }

  async function render() {
    const seq = ++renderSeq;
    const hash = location.hash || '#/record';
    let name = 'record', param;
    for (const [re, n] of ROUTES) { const m = hash.match(re); if (m) { name = n; param = m[1]; break; } }
    const view = S.views[name];
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    S.maps.destroyAll();
    U.$('#sheet').hidden = true; U.$('#sheetBackdrop').hidden = true; // a sheet belongs to the screen that opened it
    const main = U.$('#view');
    main.className = view.full ? 'full' : '';
    main.innerHTML = '';
    applyLabels();
    title(t(view.titleKey)); topRight('');
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
      main.innerHTML = `<div class="empty">${U.esc(t('error', { msg: e.message }))}</div>`;
    }
    livePill();
  }

  function livePill() {
    const st = S.tracker.st, pill = U.$('#livePill');
    const onRecord = (location.hash || '#/record') === '#/record';
    pill.hidden = st.state === 'idle' || onRecord;
    U.$('#livePillText').textContent = st.state === 'paused' ? `${t('rec.paused')} · ${U.km(st.distance)} km` : `${U.duration(st.moving)} · ${U.km(st.distance)} km`;
  }

  function applyTheme(th) {
    if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]').content = S.maps.isDark() ? '#0e1013' : '#f5f6f4';
  }

  async function recover() {
    const unsaved = await S.db.kvGet('unsaved', null);
    if (unsaved) { location.hash = '#/record'; setTimeout(() => S.views.record.saveSheet(unsaved), 300); return; }
    const snap = await S.tracker.pending();
    // A recording only ends when the user presses Finish: if the app was closed or killed, just carry on.
    if (snap && snap.start && snap.state !== 'idle') {
      await S.tracker.restore(snap); // the record screen follows the tracker's state on its own
      livePill();
      U.toast(t('rec.continued'), 3000);
    }
  }

  async function init() {
    const st = await S.db.settings();
    S.i18n.set(st.lang || S.i18n.detect());
    applyTheme(st.theme);
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(st.theme));
    U.$('#livePill').onclick = () => (location.hash = '#/record');
    S.tracker.on(livePill);
    await S.social.init(); // handles ?join= invite links and restores the signed-in session
    window.addEventListener('hashchange', render);
    if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/record');
    await render();
    recover();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('beforeunload', (e) => { if (S.tracker.st.state !== 'idle') { e.preventDefault(); e.returnValue = ''; } });
  }

  return { render, title, topRight, applyTheme, init };
})();

S.app.init();
