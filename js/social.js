// Friends, groups & leaderboards via Supabase. Only run summaries leave the phone — never GPS tracks.
S.social = (() => {
  const cfg = window.STRIDE_CONFIG || {};
  let client = null, session = null, profile = null, ready = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());

  const enabled = () => !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  function init() {
    if (ready) return ready;
    ready = (async () => {
      // Invite links look like ?join=ABC123 — remember the code until the user is signed in.
      const qs = new URLSearchParams(location.search);
      const join = qs.get('join');
      if (join) {
        await S.db.kvSet('pendingJoin', join.toUpperCase());
        qs.delete('join');
        history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + '#/friends');
      }
      if (!enabled()) return;
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
      const { data } = await client.auth.getSession();
      session = data.session;
      // Clean ?code=… left behind by a magic-link sign-in.
      if (new URLSearchParams(location.search).has('code')) history.replaceState(null, '', location.pathname + (location.hash || '#/friends'));
      client.auth.onAuthStateChange((_ev, s) => {
        const changed = (s?.user?.id || null) !== (session?.user?.id || null);
        session = s;
        // Supabase holds its auth lock during this callback. Defer database
        // requests until it returns, otherwise OTP verification can deadlock.
        if (changed) {
          profile = null;
          setTimeout(() => loadProfile().then(emit).catch((e) => {
            console.error('social profile', e); emit();
          }), 0);
        }
      });
      await loadProfile();
    })().catch((e) => console.error('social init', e));
    return ready;
  }

  async function loadProfile() {
    if (!session) { profile = null; return; }
    const { data } = await client.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    profile = data || null;
  }

  const user = () => session?.user || null;
  const profileName = () => profile?.name || null;
  const hasProfile = () => !!profile;

  function check(res) { if (res.error) throw new Error(res.error.message); return res.data; }

  async function sendCode(email) {
    const redirect = location.origin + location.pathname;
    check(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } }));
  }
  async function verifyCode(email, token) {
    check(await client.auth.verifyOtp({ email, token: token.trim(), type: 'email' }));
    const { data } = await client.auth.getSession(); session = data.session;
    await loadProfile(); emit();
  }
  async function signOut() { check(await client.auth.signOut()); session = null; profile = null; emit(); }

  async function saveProfile(name) {
    profile = check(await client.from('profiles').upsert({ id: user().id, name: name.trim().slice(0, 40) }).select().single());
    emit();
  }

  async function myGroups() {
    return check(await client.from('groups').select('*').order('created_at'));
  }
  async function createGroup(name) { return check(await client.rpc('create_group', { group_name: name.trim().slice(0, 60) })); }
  async function joinGroup(code) { return check(await client.rpc('join_group', { group_code: code.trim().toUpperCase() })); }
  async function leaveGroup(groupId) { check(await client.from('members').delete().eq('group_id', groupId).eq('user_id', user().id)); }
  async function takePendingJoin() {
    const code = await S.db.kvGet('pendingJoin', null);
    if (!code || !session || !profile) return null;
    await S.db.kvSet('pendingJoin', null);
    try { return await joinGroup(code); } catch (e) { S.util.toast(e.message); return null; }
  }

  function summary(a) {
    const b = a.best || {};
    return {
      id: a.id, user_id: user().id, started_at: new Date(a.start).toISOString(), type: a.type,
      name: (a.name || '').slice(0, 80), distance: Math.round(a.distance), moving: Math.round(a.moving),
      elev_gain: a.elevGain != null ? Math.round(a.elevGain) : null,
      best_1k: b[1000] ?? null, best_5k: b[5000] ?? null, best_10k: b[10000] ?? null, best_half: b[21097.5] ?? null, best_full: b[42195] ?? null,
    };
  }

  async function shareOn() { return (await S.db.settings()).shareRuns !== false; }

  async function pushRun(a) {
    await init();
    if (!session || !profile || a.private || !(await shareOn())) return false;
    check(await client.from('runs').upsert(summary(a)));
    return true;
  }
  async function deleteRun(id) {
    await init();
    if (!session) return;
    check(await client.from('runs').delete().eq('id', id).eq('user_id', user().id));
  }
  async function syncAll() {
    const acts = (await S.db.activities()).filter((a) => !a.private);
    for (let i = 0; i < acts.length; i += 100) check(await client.from('runs').upsert(acts.slice(i, i + 100).map(summary)));
    return acts.length;
  }
  async function unshareAll() { check(await client.from('runs').delete().eq('user_id', user().id)); }
  async function sharedCount() {
    const r = await client.from('runs').select('id', { count: 'exact', head: true }).eq('user_id', user().id);
    return r.count || 0;
  }

  // Everything the friends screen needs for one group.
  async function groupData(groupId) {
    const members = check(await client.from('members').select('user_id, joined_at').eq('group_id', groupId));
    const ids = members.map((m) => m.user_id);
    const profiles = ids.length ? check(await client.from('profiles').select('id, name').in('id', ids)) : [];
    const since = new Date(Date.now() - 400 * 864e5).toISOString();
    const runs = ids.length ? check(await client.from('runs').select('*').in('user_id', ids).gte('started_at', since).order('started_at', { ascending: false }).limit(3000)) : [];
    const names = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
    for (const r of runs) { r.start = Date.parse(r.started_at); r.who = names[r.user_id] || '?'; }
    return { members: members.map((m) => ({ ...m, name: names[m.user_id] || '?' })), runs };
  }

  function on(f) { listeners.add(f); return () => listeners.delete(f); }

  return {
    enabled, init, user, profileName, hasProfile, sendCode, verifyCode, signOut, saveProfile,
    myGroups, createGroup, joinGroup, leaveGroup, takePendingJoin, pushRun, deleteRun, syncAll, unshareAll, sharedCount, groupData, on,
  };
})();
