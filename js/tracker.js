// Live recording: GPS → filtered points, wall-clock moving time, auto-pause, voice, wake lock, crash recovery.
//
// Time is measured on the wall clock (start → now, minus pauses), not by counting ticks, because a phone
// freezes a backgrounded web app: ticks stop, but the run must keep going until the user stops it.
// Auto-pause only kicks in after AUTO_PAUSE_MS without real movement, and then retroactively from the last
// movement, so the idle minutes don't count. Moving again ends the auto-pause by itself.
S.tracker = (() => {
  const U = S.util;
  const AUTO_PAUSE_MS = 5 * 60 * 1000;
  const MOVE_RADIUS = 25; // metres from the last "anchor" before we call it real movement (GPS jitter is smaller)

  const st = {
    state: 'idle', // idle | running | paused  (paused = paused by hand)
    type: 'run', points: [], start: 0, distance: 0, moving: 0,
    pausedMs: 0, pauseStart: null, autoPaused: false,
    lastMoveAt: 0, anchor: null, lastFix: null, accuracy: null,
    nextAnnounce: 1000, routeId: null, resumeNext: false, laps: [],
  };
  let watchId = null, tickTimer = null, wakeLock = null, saveTimer = 0, settings = null, simTimer = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(st));
  const SIM = new URLSearchParams(location.search).has('sim');

  // Moving seconds at wall-clock time `now`.
  function movingAt(now) {
    if (!st.start) return 0;
    const openPause = st.pauseStart != null ? Math.max(0, now - st.pauseStart) : 0;
    return Math.max(0, (now - st.start - st.pausedMs - openPause) / 1000);
  }

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
    const now = pos.timestamp || Date.now();
    const p = { lat: c.latitude, lon: c.longitude, t: now, alt: c.altitude ?? null, acc: c.accuracy };
    st.lastFix = p;
    if (st.state !== 'running') { emit(); return; }
    if (c.accuracy > (settings?.maxAccuracy || 30)) { emit(); return; }

    const last = st.points[st.points.length - 1];
    const hr = S.hr.value();
    if (!last || st.resumeNext) {
      if (st.autoPaused) endAutoPause(now, false);
      push({ ...p, d: st.distance, e: movingAt(now), hr, b: st.resumeNext && last ? 1 : 0 });
      st.resumeNext = false; st.anchor = p; st.lastMoveAt = now;
      persistSoon(); emit(); return;
    }

    const dd = U.dist(last, p);
    const dt = Math.max(0.001, (now - last.t) / 1000);
    if (dd / dt > 12) { emit(); return; } // GPS jump

    // Real movement = left the anchor radius. Small wobbles while standing still don't count.
    const moved = !st.anchor || U.dist(st.anchor, p) > MOVE_RADIUS;
    if (st.autoPaused) {
      if (!moved) { emit(); return; }
      // Back on the move. Measured from where we last really moved: if that stretch was covered at
      // walking/running speed (phone in a pocket, app frozen), the whole gap was moving time;
      // otherwise it was a real stop that the auto-pause rightly cut out.
      const gapS = Math.max(1, (now - st.lastMoveAt) / 1000);
      endAutoPause(now, st.anchor && U.dist(st.anchor, p) / gapS >= 0.7);
      if (settings.voice) say(t('v.resumed'));
    }
    if (moved) { st.anchor = p; st.lastMoveAt = now; }
    if (dd < Math.max(3, c.accuracy / 2)) { emit(); return; } // jitter while standing still — never a point

    st.distance += dd;
    push({ ...p, d: st.distance, e: movingAt(now), hr, ...(dt > 30 ? { g: 1 } : {}) }); // g = straight line over a GPS gap
    announce(now);
    persistSoon();
    emit();
  }

  function push(p) { delete p.acc; if (p.hr == null) delete p.hr; if (p.alt == null) delete p.alt; if (!p.b) delete p.b; st.points.push(p); }

  function startAutoPause() {
    st.autoPaused = true;
    st.pauseStart = st.lastMoveAt; // retroactive: the idle minutes don't count
    persistNow();
    if (settings.voice) say(t('v.autopaused'));
  }
  function endAutoPause(now, wasMoving) {
    if (!wasMoving && st.pauseStart != null) st.pausedMs += Math.max(0, now - st.pauseStart);
    st.pauseStart = null; st.autoPaused = false;
  }

  // ---- clock ----
  function tick() {
    const now = Date.now();
    if (st.state === 'running' && settings.autoPause && !st.autoPaused && st.lastMoveAt && now - st.lastMoveAt > AUTO_PAUSE_MS) startAutoPause();
    st.moving = movingAt(now);
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
  function announce(now) {
    if (!settings.voice || st.distance < st.nextAnnounce) return;
    const every = settings.voiceEvery || 1000;
    const k = Math.floor(st.distance / every) * every;
    const mv = movingAt(now);
    const prev = st.laps.length ? st.laps[st.laps.length - 1] : { d: 0, e: 0 };
    const lapPace = (mv - prev.e) / ((k - prev.d) / 1000);
    st.laps.push({ d: k, e: mv });
    let text = t('v.split', { km: U.num(k / 1000, k % 1000 ? 1 : 0), time: timeWords(mv), pace: paceWords(lapPace) });
    const hr = S.hr.value();
    if (hr) text += ' ' + t('v.hr', { hr });
    say(text);
    st.nextAnnounce = k + every;
  }

  // ---- keep alive: screen wake lock while recording ----
  async function lock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
  }
  function unlock() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

  // Leaving the app: save immediately (the OS may kill us). Coming back: catch up and continue.
  document.addEventListener('visibilitychange', () => {
    if (st.state === 'idle') return;
    if (document.visibilityState === 'hidden') persistNow();
    else { lock(); startGps(); tick(); }
  });
  window.addEventListener('pagehide', () => { if (st.state !== 'idle') persistNow(); });

  // ---- persistence (survives the app being closed or killed) ----
  function snapshot() {
    return {
      id: 'live', state: st.state, type: st.type, points: st.points, start: st.start, distance: st.distance,
      pausedMs: st.pausedMs, pauseStart: st.pauseStart, autoPaused: st.autoPaused, lastMoveAt: st.lastMoveAt, anchor: st.anchor,
      routeId: st.routeId, laps: st.laps, nextAnnounce: st.nextAnnounce, savedAt: Date.now(),
    };
  }
  function persistNow() { saveTimer = Date.now(); S.db.kvSet('live', snapshot()).catch(() => {}); }
  function persistSoon() { if (Date.now() - saveTimer >= 10000) persistNow(); }
  async function pending() { return S.db.kvGet('live', null); }
  async function clearPending() { return S.db.kvSet('live', null); }

  // ---- public ----
  async function begin() {
    settings = await S.db.settings();
    if (!tickTimer) tickTimer = setInterval(tick, 1000);
    startGps(); lock();
  }

  async function start(type = 'run', routeId = null) {
    const now = Date.now();
    Object.assign(st, {
      state: 'running', type, routeId, points: [], start: now, distance: 0, moving: 0, pausedMs: 0, pauseStart: null,
      autoPaused: false, lastMoveAt: now, anchor: null, resumeNext: false, laps: [],
    });
    await begin();
    st.nextAnnounce = settings.voiceEvery || 1000;
    persistNow();
    if (settings.voice) say(t('v.started'));
    emit();
  }

  // Continue a recording after the app was closed/killed — in the same state it was in.
  async function restore(snap) {
    const legacy = snap.pausedMs == null; // snapshots from the old tick-based version
    Object.assign(st, {
      state: legacy ? 'paused' : snap.state || 'running', type: snap.type, routeId: snap.routeId, points: snap.points || [],
      start: snap.start, distance: snap.distance, laps: snap.laps || [], nextAnnounce: snap.nextAnnounce || 1000,
      pausedMs: legacy ? Math.max(0, (snap.savedAt || Date.now()) - snap.start - (snap.moving || 0) * 1000) : snap.pausedMs,
      pauseStart: legacy ? (snap.savedAt || Date.now()) : snap.pauseStart,
      autoPaused: legacy ? false : !!snap.autoPaused, lastMoveAt: snap.lastMoveAt || Date.now(), anchor: snap.anchor || null,
      resumeNext: true,
    });
    await begin();
    tick();
    emit();
  }

  function pause() {
    if (st.state !== 'running') return;
    const now = Date.now();
    if (!st.autoPaused) st.pauseStart = now; // an auto-pause already has its (earlier) start
    st.state = 'paused'; st.autoPaused = false;
    st.moving = movingAt(now);
    persistNow();
    if (settings.voice) say(t('v.paused'));
    emit();
  }
  function resume() {
    if (st.state !== 'paused') return;
    const now = Date.now();
    if (st.pauseStart != null) st.pausedMs += Math.max(0, now - st.pauseStart);
    st.pauseStart = null; st.state = 'running'; st.resumeNext = true; st.lastMoveAt = now; st.anchor = null;
    persistNow();
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
    Object.assign(st, { state: 'idle', points: [], moving: 0, distance: 0, autoPaused: false, routeId: null, pausedMs: 0, pauseStart: null, start: 0 });
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
    if (Date.now() - last.t > 20000) return null; // no fresh GPS (e.g. just back from the background)
    let i = pts.length - 2;
    while (i > 0 && last.e - pts[i].e < 30) i--;
    const dd = last.d - pts[i].d, de = last.e - pts[i].e;
    return dd > 20 ? de / (dd / 1000) : null;
  }

  function on(f) { listeners.add(f); return () => listeners.delete(f); }

  // ---- simulator (?sim): a lap around a park so the app can be tried at a desk ----
  // window.__simStill = true makes the runner stand still (for testing auto-pause).
  function startSim() {
    let k = 0;
    const c = { lat: 52.3584, lon: 4.8811 }; // Vondelpark-ish
    simTimer = setInterval(() => {
      if (!window.__simStill) k++;
      if (window.__simSkip) { k += window.__simSkip; window.__simSkip = 0; } // ran on while the app was frozen
      const a = k / 900 * Math.PI * 2; // ~2.9 km lap at ~5:10/km
      onFix({
        timestamp: Date.now(),
        coords: { latitude: c.lat + 0.004 * Math.sin(a) + (Math.random() - 0.5) * 0.00002, longitude: c.lon + 0.007 * Math.cos(a) + (Math.random() - 0.5) * 0.00002, accuracy: 5 + Math.random() * 4, altitude: 2 + 3 * Math.sin(a * 2) },
      });
    }, 1000);
  }

  return { st, start, pause, resume, finish, reset, restore, pending, clearPending, warmup, cooldown, currentPace, on, say, SIM, AUTO_PAUSE_MS };
})();
