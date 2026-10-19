// Live recording: GPS → filtered points, moving clock, auto-pause, voice, wake lock, crash recovery.
S.tracker = (() => {
  const U = S.util;
  const st = {
    state: 'idle', // idle | running | paused
    type: 'run', points: [], start: 0, moving: 0, distance: 0,
    autoPaused: false, lastMoveAt: 0, lastTick: 0, lastFix: null, accuracy: null,
    nextAnnounce: 1000, routeId: null, resumeNext: false, laps: [],
  };
  let watchId = null, tickTimer = null, wakeLock = null, saveTimer = 0, settings = null, simTimer = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(st));
  const SIM = new URLSearchParams(location.search).has('sim');

  // ---- GPS ----
  function startGps() {
    if (watchId != null || simTimer) return;
    if (SIM) return startSim();
    if (!navigator.geolocation) { st.accuracy = -1; emit(); return; }
    watchId = navigator.geolocation.watchPosition(onFix, (err) => { st.gpsError = err.message; emit(); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function stopGps() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
  }

  function onFix(pos) {
    const c = pos.coords;
    st.gpsError = null;
    st.accuracy = c.accuracy;
    const p = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), alt: c.altitude ?? null, acc: c.accuracy };
    st.lastFix = p;
    if (st.state !== 'running') { emit(); return; }
    if (c.accuracy > (settings?.maxAccuracy || 30)) { emit(); return; }

    const last = st.points[st.points.length - 1];
    const hr = S.hr.value();
    if (!last || st.resumeNext) {
      push({ ...p, d: st.distance, e: st.moving, hr, b: st.resumeNext && last ? 1 : 0 });
      st.resumeNext = false; st.lastMoveAt = Date.now(); emit(); return;
    }
    const dd = U.dist(last, p);
    const dt = Math.max(0.001, (p.t - last.t) / 1000);
    if (dd / dt > 12) { emit(); return; } // GPS jump
    if (dd < Math.max(3, c.accuracy / 2) && dt < 15) { emit(); return; } // jitter while standing still

    st.distance += dd;
    st.lastMoveAt = Date.now();
    if (st.autoPaused) { st.autoPaused = false; if (settings.voice) say(t('v.resumed')); }
    push({ ...p, d: st.distance, e: st.moving, hr });
    announce();
    persistSoon();
    emit();
  }

  function push(p) { delete p.acc; if (p.hr == null) delete p.hr; if (p.alt == null) delete p.alt; if (!p.b) delete p.b; st.points.push(p); }

  // ---- clock ----
  function tick() {
    const now = Date.now();
    const dt = (now - st.lastTick) / 1000;
    st.lastTick = now;
    if (st.state === 'running') {
      if (settings.autoPause && !st.autoPaused && st.points.length && now - st.lastMoveAt > 8000) {
        st.autoPaused = true;
        if (settings.voice) say(t('v.autopaused'));
      }
      if (!st.autoPaused) st.moving += Math.min(dt, 5);
    }
    emit();
  }

  // ---- voice ----
  function say(text) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = S.i18n.voiceLang(); u.rate = 1.02;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  function paceWords(spk) {
    if (!isFinite(spk) || spk <= 0) return '';
    let m = Math.floor(spk / 60), sec = Math.round(spk % 60);
    if (sec === 60) { m++; sec = 0; }
    return t('v.pace', { m, s: sec });
  }
  function timeWords(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? t('v.timeH', { h, m }) : t('v.timeM', { m });
  }
  function announce() {
    if (!settings.voice || st.distance < st.nextAnnounce) return;
    const every = settings.voiceEvery || 1000;
    const k = Math.floor(st.distance / every) * every;
    const prev = st.laps.length ? st.laps[st.laps.length - 1] : { d: 0, e: 0 };
    const lapPace = (st.moving - prev.e) / ((k - prev.d) / 1000);
    st.laps.push({ d: k, e: st.moving });
    let text = t('v.split', { km: U.num(k / 1000, k % 1000 ? 1 : 0), time: timeWords(st.moving), pace: paceWords(lapPace) });
    const hr = S.hr.value();
    if (hr) text += ' ' + t('v.hr', { hr });
    say(text);
    st.nextAnnounce = k + every;
  }

  // ---- wake lock: keep screen (and therefore GPS in the browser) alive ----
  async function lock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
  }
  function unlock() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.state !== 'idle') lock(); });

  // ---- crash recovery ----
  function snapshot() {
    return { id: 'live', type: st.type, points: st.points, start: st.start, moving: st.moving, distance: st.distance, routeId: st.routeId, laps: st.laps, nextAnnounce: st.nextAnnounce, savedAt: Date.now() };
  }
  function persistSoon() {
    if (Date.now() - saveTimer < 10000) return;
    saveTimer = Date.now();
    S.db.kvSet('live', snapshot()).catch(() => {});
  }
  async function pending() { return S.db.kvGet('live', null); }
  async function clearPending() { return S.db.kvSet('live', null); }

  // ---- public ----
  async function begin() {
    settings = await S.db.settings();
    st.lastTick = Date.now();
    if (!tickTimer) tickTimer = setInterval(tick, 1000);
    startGps(); lock();
  }

  async function start(type = 'run', routeId = null) {
    Object.assign(st, { state: 'running', type, routeId, points: [], start: Date.now(), moving: 0, distance: 0, autoPaused: false, lastMoveAt: Date.now(), resumeNext: false, laps: [] });
    await begin();
    st.nextAnnounce = settings.voiceEvery || 1000;
    if (settings.voice) say(t('v.started'));
    emit();
  }

  async function restore(snap) {
    Object.assign(st, { state: 'paused', type: snap.type, routeId: snap.routeId, points: snap.points || [], start: snap.start, moving: snap.moving, distance: snap.distance, laps: snap.laps || [], nextAnnounce: snap.nextAnnounce || 1000, autoPaused: false, resumeNext: true });
    await begin();
    emit();
  }

  function pause() {
    if (st.state !== 'running') return;
    st.state = 'paused'; st.autoPaused = false;
    S.db.kvSet('live', snapshot()).catch(() => {});
    if (settings.voice) say(t('v.paused'));
    emit();
  }
  function resume() {
    if (st.state !== 'paused') return;
    st.state = 'running'; st.resumeNext = true; st.lastMoveAt = Date.now(); st.lastTick = Date.now();
    if (settings.voice) say(t('v.resumed'));
    lock(); emit();
  }

  // Ends recording and returns an activity draft (not yet saved).
  function finish() {
    const draft = {
      id: U.uid(), type: st.type, name: U.defaultName(st.start, st.type), notes: '', start: st.start,
      points: st.points.slice(), source: 'gps', routeId: st.routeId,
    };
    reset();
    return S.analysis.finalize(draft);
  }

  function reset() {
    st.state = 'idle'; st.points = []; st.moving = 0; st.distance = 0; st.autoPaused = false; st.routeId = null;
    clearInterval(tickTimer); tickTimer = null; unlock();
    clearPending();
    emit();
  }

  // GPS preview on the record screen before starting.
  async function warmup() { settings = await S.db.settings(); startGps(); }
  function cooldown() { if (st.state === 'idle') stopGps(); }

  function currentPace() {
    // pace over the last ~30 s of moving time
    const pts = st.points; if (pts.length < 2 || st.autoPaused) return null;
    const last = pts[pts.length - 1];
    let i = pts.length - 2;
    while (i > 0 && last.e - pts[i].e < 30) i--;
    const dd = last.d - pts[i].d, de = last.e - pts[i].e;
    return dd > 20 ? de / (dd / 1000) : null;
  }

  function on(f) { listeners.add(f); return () => listeners.delete(f); }

  // ---- simulator (?sim): a lap around a park so the app can be tried at a desk ----
  function startSim() {
    let k = 0;
    const c = { lat: 52.3584, lon: 4.8811 }; // Vondelpark-ish
    simTimer = setInterval(() => {
      k++;
      const a = k / 900 * Math.PI * 2; // ~2.9 km lap at ~5:10/km
      const pos = {
        timestamp: Date.now(),
        coords: { latitude: c.lat + 0.004 * Math.sin(a) + (Math.random() - 0.5) * 0.00002, longitude: c.lon + 0.007 * Math.cos(a) + (Math.random() - 0.5) * 0.00002, accuracy: 5 + Math.random() * 4, altitude: 2 + 3 * Math.sin(a * 2) },
      };
      onFix(pos);
    }, 1000);
  }

  return { st, start, pause, resume, finish, reset, restore, pending, clearPending, warmup, cooldown, currentPace, on, say, SIM };
})();
