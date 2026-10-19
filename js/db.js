// IndexedDB storage. Everything stays on this device.
S.db = (() => {
  const NAME = 'stride', VERSION = 1;
  const STORES = ['activities', 'segments', 'routes', 'kv'];
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const all = (store) => tx(store, 'readonly', (s) => s.getAll());
  const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
  const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
  const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
  const clear = (store) => tx(store, 'readwrite', (s) => s.clear());

  // Cache of activities so screens don't re-read the whole store each render.
  let actCache = null;
  async function activities() {
    if (!actCache) {
      actCache = await all('activities');
      actCache.sort((a, b) => b.start - a.start);
    }
    return actCache;
  }
  async function saveActivity(a) { await put('activities', a); actCache = null; }
  async function deleteActivity(id) { await del('activities', id); actCache = null; }

  async function kvGet(id, fallback) { const r = await get('kv', id); return r ? r.value : fallback; }
  async function kvSet(id, value) { return put('kv', { id, value }); }

  const DEFAULT_SETTINGS = {
    name: '', maxHr: 190, restHr: 55, weight: 75, thresholdPace: 300, // s/km
    autoPause: true, voice: true, voiceEvery: 1000, maxAccuracy: 30, theme: 'auto',
    weeklyGoalKm: 25, followPaths: true, defaultType: 'run',
  };
  let settingsCache = null;
  async function settings() {
    if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(await kvGet('settings', {})) };
    return settingsCache;
  }
  async function saveSettings(patch) {
    settingsCache = { ...(await settings()), ...patch };
    await kvSet('settings', settingsCache);
    return settingsCache;
  }

  async function exportAll() {
    return {
      app: 'stride', version: 1, exportedAt: new Date().toISOString(),
      activities: await all('activities'), segments: await all('segments'), routes: await all('routes'), kv: await all('kv'),
    };
  }

  async function importAll(data, { replace = false } = {}) {
    if (!data || data.app !== 'stride') throw new Error('Dit is geen Stride-backup');
    if (replace) for (const s of STORES) await clear(s);
    for (const s of STORES) for (const o of data[s] || []) await put(s, o);
    actCache = null; settingsCache = null;
  }

  async function wipe() { for (const s of STORES) await clear(s); actCache = null; settingsCache = null; }

  return { open, all, get, put, del, activities, saveActivity, deleteActivity, kvGet, kvSet, settings, saveSettings, exportAll, importAll, wipe };
})();
