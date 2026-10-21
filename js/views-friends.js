S.views.friends = {
  tab: 'friends', titleKey: 'tab.friends',
  async render(main) {
    const U = S.util, F = S.social;
    await F.init();

    if (!F.enabled()) {
      main.innerHTML = `<div class="empty"><div class="big">👥</div><p>${t('fr.notConfigured')}</p><p class="small">${t('fr.notConfigured.d')}</p></div>`;
      return;
    }
    const off = F.on(() => S.app.render());

    if (!F.user()) { this.signIn(main); return off; }
    if (!F.hasProfile()) { this.profileForm(main); return off; }

    const joined = await F.takePendingJoin();
    if (joined) { sessionStorage.setItem('group', joined.id); U.toast(t('fr.joined', { name: joined.name })); }

    const groups = await F.myGroups();
    S.app.topRight(`<button class="btn sm" id="frMore">•••</button>`);
    U.$('#frMore').onclick = () => this.accountSheet();

    if (!groups.length) {
      main.innerHTML = `<div class="empty"><div class="big">🏁</div><p>${t('fr.noGroups')}</p><p class="small">${t('fr.noGroups.d')}</p></div>
        <button class="btn primary block" id="gNew">${t('fr.create')}</button>
        <button class="btn block" id="gJoin" style="margin-top:8px">${t('fr.joinCode')}</button>`;
      U.$('#gNew').onclick = () => this.createSheet();
      U.$('#gJoin').onclick = () => this.joinSheet();
      return off;
    }

    let gid = sessionStorage.getItem('group');
    if (!groups.some((g) => g.id === gid)) gid = groups[0].id;
    sessionStorage.setItem('group', gid);
    const group = groups.find((g) => g.id === gid);
    const mode = sessionStorage.getItem('frTab') || 'board';
    const period = sessionStorage.getItem('frPeriod') || 'month';

    main.innerHTML = `<div class="empty small">${t('loading')}</div>`;
    let data;
    try { data = await F.groupData(gid); } catch (e) { main.innerHTML = `<div class="empty">${U.esc(e.message)}</div>`; return off; }
    const me = F.user().id;

    const head = `
      <div class="row between" style="margin-bottom:12px">
        <div class="grow">${groups.length > 1
          ? `<select id="gSel" style="font-weight:700">${groups.map((g) => `<option value="${g.id}" ${g.id === gid ? 'selected' : ''}>${U.esc(g.name)}</option>`).join('')}</select>`
          : `<div style="font-size:20px;font-weight:800">${U.esc(group.name)}</div>`}
          <div class="small muted">${t('fr.members', { n: data.members.length })}</div></div>
        <button class="btn sm primary" id="gInvite">${t('fr.invite')}</button>
      </div>
      <div class="seg">${['board', 'feed', 'members'].map((m) => `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${t('fr.tab.' + m)}</button>`).join('')}</div>`;

    let body = '';
    if (mode === 'feed') body = this.feedHtml(data.runs, me);
    else if (mode === 'members') body = this.membersHtml(data, group, me);
    else body = this.boardHtml(data, period, me);

    main.innerHTML = head + body + `<div class="btn-row"><button class="btn grow sm" id="gNew">${t('fr.create')}</button><button class="btn grow sm" id="gJoin">${t('fr.joinCode')}</button></div>`;

    U.$$('.seg button[data-m]', main).forEach((b) => (b.onclick = () => { sessionStorage.setItem('frTab', b.dataset.m); S.app.render(); }));
    U.$$('[data-p]', main).forEach((b) => (b.onclick = () => { sessionStorage.setItem('frPeriod', b.dataset.p); S.app.render(); }));
    const sel = U.$('#gSel'); if (sel) sel.onchange = () => { sessionStorage.setItem('group', sel.value); S.app.render(); };
    U.$('#gInvite').onclick = () => this.invite(group);
    U.$('#gNew').onclick = () => this.createSheet();
    U.$('#gJoin').onclick = () => this.joinSheet();
    const leave = U.$('#gLeave');
    if (leave) leave.onclick = async () => {
      if (!(await U.confirmSheet(t('fr.leaveQ', { name: group.name }), t('fr.leave.d'), t('fr.leave'), true))) return;
      await F.leaveGroup(gid); sessionStorage.removeItem('group'); S.app.render();
    };
    return off;
  },

  // ---- leaderboards ----
  boardHtml(data, period, me) {
    const U = S.util;
    const now = Date.now();
    const from = period === 'week' ? U.startOfWeek(now) : period === 'month' ? U.startOfMonth(now) : period === 'year' ? U.startOfYear(now) : 0;
    const runs = data.runs.filter((r) => r.type === 'run' && r.start >= from);
    const people = data.members.map((m) => m.user_id);

    const rows = (list, fmt, sub) => list.length
      ? `<table class="t">${list.map((x, i) => `<tr class="${x.uid === me ? 'me' : ''}"><td style="width:30px">${['🥇', '🥈', '🥉'][i] || i + 1}</td>
          <td><b>${U.esc(x.who)}</b>${sub ? `<div class="small muted">${sub(x)}</div>` : ''}</td><td class="r"><b>${fmt(x)}</b></td></tr>`).join('')}</table>`
      : `<div class="muted small">${t('fr.noData')}</div>`;

    const dist = people.map((uid) => {
      const mine = runs.filter((r) => r.user_id === uid);
      return { uid, who: whoOf(data, uid), d: mine.reduce((s, r) => s + r.distance, 0), n: mine.length };
    }).filter((x) => x.n).sort((a, b) => b.d - a.d);

    const fastest = (col, metres) => people.map((uid) => {
      let best = null;
      for (const r of runs) if (r.user_id === uid && r[col] && (!best || r[col] < best[col])) best = r;
      return best && { uid, who: whoOf(data, uid), time: best[col], start: best.start, pace: best[col] / (metres / 1000) };
    }).filter(Boolean).sort((a, b) => a.time - b.time);

    const streaks = people.map((uid) => ({
      uid, who: whoOf(data, uid),
      n: S.analysis.weekStreak(data.runs.filter((r) => r.user_id === uid && r.type === 'run').map((r) => r.start)),
    })).filter((x) => x.n).sort((a, b) => b.n - a.n);

    const effort = (key, col, metres) => `<div class="section-title">${t('fr.fastest', { dist: t(key) })}</div>
      <div class="card">${rows(fastest(col, metres), (x) => U.duration(x.time), (x) => `${U.pace(x.pace)} /km · ${U.shortDate(x.start)}`)}</div>`;

    return `
      <div class="seg">${['week', 'month', 'year', 'all'].map((p) => `<button data-p="${p}" class="${p === period ? 'on' : ''}">${t('per.' + p + '.short')}</button>`).join('')}</div>
      <div class="section-title">${t('fr.mostKm')}</div>
      <div class="card">${rows(dist, (x) => U.km(x.d, 1) + ' km', (x) => t('fr.nRuns', { n: x.n }))}</div>
      ${effort('goal.5k', 'best_5k', 5000)}
      ${effort('goal.10k', 'best_10k', 10000)}
      ${effort('goal.half', 'best_half', 21097.5)}
      <div class="section-title">${t('fr.streak')}</div>
      <div class="card">${rows(streaks, (x) => t('fr.weeks', { n: x.n }))}<div class="small muted" style="margin-top:8px">${t('fr.streak.d')}</div></div>`;
  },

  feedHtml(runs, me) {
    const U = S.util;
    const list = runs.slice(0, 40);
    if (!list.length) return `<div class="empty"><div class="big">🏃</div>${t('fr.feedEmpty')}</div>`;
    return list.map((r) => {
      const pace = r.distance > 0 ? r.moving / (r.distance / 1000) : null;
      const pr = r.best_5k || r.best_10k || r.best_half;
      return `<div class="card">
        <div class="row"><div class="avatar">${U.esc(r.who.slice(0, 1).toUpperCase())}</div>
          <div class="grow"><b>${U.esc(r.who)}</b>${r.user_id === me ? ` <span class="badge">${t('fr.you')}</span>` : ''}<div class="small muted">${U.dateTime(r.start)} · ${U.TYPES[r.type] || r.type}</div></div></div>
        <div class="name" style="font-weight:700;margin:8px 0 6px">${U.esc(r.name || '')}</div>
        <div class="stats">
          <div class="stat"><div class="v">${U.km(r.distance)}</div><div class="l">km</div></div>
          <div class="stat"><div class="v">${U.pace(pace)}</div><div class="l">/km</div></div>
          <div class="stat"><div class="v">${U.duration(r.moving)}</div><div class="l">${t('rec.time')}</div></div>
        </div>
        ${pr ? `<div class="small muted" style="margin-top:8px">${[r.best_5k && `5K ${U.duration(r.best_5k)}`, r.best_10k && `10K ${U.duration(r.best_10k)}`, r.best_half && `21K ${U.duration(r.best_half)}`].filter(Boolean).join(' · ')}</div>` : ''}
      </div>`;
    }).join('');
  },

  membersHtml(data, group, me) {
    const U = S.util;
    const yearFrom = U.startOfYear(Date.now());
    return `<div class="card">${data.members.map((m) => {
      const mine = data.runs.filter((r) => r.user_id === m.user_id && r.type === 'run');
      const year = mine.filter((r) => r.start >= yearFrom).reduce((s, r) => s + r.distance, 0);
      return `<div class="list-item"><div class="avatar">${U.esc(m.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><b>${U.esc(m.name)}</b>${m.user_id === group.owner ? ` <span class="badge">${t('fr.owner')}</span>` : ''}${m.user_id === me ? ` <span class="badge">${t('fr.you')}</span>` : ''}
        <div class="small muted">${t('fr.memberLine', { km: U.km(year, 0), n: mine.length, last: mine[0] ? U.shortDate(mine[0].start) : '–' })}</div></div></div>`;
    }).join('')}</div>
    <div class="card small"><div class="row between"><span class="muted">${t('fr.code')}</span><b style="font-size:18px;letter-spacing:.12em">${U.esc(group.code)}</b></div></div>
    <button class="btn danger block" id="gLeave">${t('fr.leave')}</button>`;
  },

  // ---- flows ----
  signIn(main) {
    const U = S.util, F = S.social;
    const pending = sessionStorage.getItem('otpEmail');
    main.innerHTML = `<div class="card">
      <h3>${t('fr.signIn')}</h3><p class="small muted">${t('fr.signIn.d')}</p>
      <label>${t('fr.email')}</label><input id="aEmail" type="email" autocomplete="email" inputmode="email" value="${U.esc(pending || '')}">
      <button class="btn primary block" id="aSend" style="margin-top:12px">${t('fr.sendCode')}</button>
      <div id="aCodeBox" ${pending ? '' : 'hidden'}>
        <label>${t('fr.code6')}</label><input id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">
        <button class="btn primary block" id="aVerify" style="margin-top:12px">${t('fr.verify')}</button>
        <p class="small muted">${t('fr.codeHint')}</p>
      </div></div>`;
    // Keep references to this screen: an auth event or navigation may replace it
    // while a request is in flight.
    const emailInput = U.$('#aEmail'), send = U.$('#aSend');
    const codeBox = U.$('#aCodeBox'), codeInput = U.$('#aCode'), verify = U.$('#aVerify');
    send.onclick = async () => {
      const email = emailInput.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { U.toast(t('fr.badEmail')); return; }
      send.disabled = true;
      try { await F.sendCode(email); sessionStorage.setItem('otpEmail', email); codeBox.hidden = false; U.toast(t('fr.codeSent')); }
      catch (e) { U.toast(e.message, 4000); }
      send.disabled = false;
    };
    verify.onclick = async () => {
      verify.disabled = true;
      try { await F.verifyCode(emailInput.value.trim(), codeInput.value); sessionStorage.removeItem('otpEmail'); S.app.render(); }
      catch (e) { U.toast(e.message, 4000); verify.disabled = false; }
    };
  },

  async profileForm(main) {
    const U = S.util, F = S.social;
    const st = await S.db.settings();
    main.innerHTML = `<div class="card"><h3>${t('fr.yourName')}</h3><p class="small muted">${t('fr.yourName.d')}</p>
      <input id="pName" maxlength="40" value="${U.esc(st.name || '')}">
      <button class="btn primary block" id="pOk" style="margin-top:12px">${t('fr.continue')}</button></div>`;
    U.$('#pOk').onclick = async () => {
      const name = U.$('#pName').value.trim();
      if (!name) { U.toast(t('fr.nameNeeded')); return; }
      try {
        await F.saveProfile(name);
        if (!st.name) await S.db.saveSettings({ name });
        await F.syncAll(); // share earlier runs once, as summaries only
        S.app.render();
      } catch (e) { U.toast(e.message, 4000); }
    };
  },

  createSheet() {
    const U = S.util;
    U.sheet(`<h2>${t('fr.create')}</h2><label>${t('fr.groupName')}</label><input id="cgName" maxlength="60" placeholder="${U.esc(t('fr.groupName.ph'))}">
      <div class="btn-row"><button class="btn grow" data-close>${t('cancel')}</button><button class="btn primary grow" id="cgOk">${t('fr.createBtn')}</button></div>`,
    (s, close) => {
      U.$('#cgOk', s).onclick = async () => {
        const name = U.$('#cgName', s).value.trim();
        if (!name) return;
        try { const g = await S.social.createGroup(name); sessionStorage.setItem('group', g.id); close(); await S.app.render(); S.views.friends.invite(g); }
        catch (e) { U.toast(e.message, 4000); }
      };
    });
  },

  joinSheet() {
    const U = S.util;
    U.sheet(`<h2>${t('fr.joinCode')}</h2><label>${t('fr.code')}</label><input id="jgCode" maxlength="6" style="text-transform:uppercase;letter-spacing:.15em" placeholder="ABC123">
      <div class="btn-row"><button class="btn grow" data-close>${t('cancel')}</button><button class="btn primary grow" id="jgOk">${t('fr.join')}</button></div>`,
    (s, close) => {
      U.$('#jgOk', s).onclick = async () => {
        try { const g = await S.social.joinGroup(U.$('#jgCode', s).value); sessionStorage.setItem('group', g.id); close(); U.toast(t('fr.joined', { name: g.name })); S.app.render(); }
        catch (e) { U.toast(e.message === 'group not found' ? t('fr.codeUnknown') : e.message, 4000); }
      };
    });
  },

  invite(group) {
    const U = S.util;
    const url = `${location.origin}${location.pathname}?join=${group.code}`;
    const text = t('fr.inviteText', { name: group.name, code: group.code });
    U.sheet(`<h2>${t('fr.invite')}</h2><p class="muted small">${t('fr.invite.d')}</p>
      <input id="invUrl" readonly value="${U.esc(url)}">
      <div class="small muted" style="margin-top:8px">${t('fr.code')}: <b style="letter-spacing:.12em">${U.esc(group.code)}</b></div>
      <div class="btn-row">${navigator.share ? `<button class="btn primary grow" id="invShare">${t('fr.share')}</button>` : ''}<button class="btn grow" id="invCopy">${t('fr.copy')}</button>
      <a class="btn grow" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}" target="_blank" rel="noopener">WhatsApp</a></div>`,
    (s) => {
      const sh = U.$('#invShare', s);
      if (sh) sh.onclick = () => navigator.share({ title: 'Stride', text, url }).catch(() => {});
      U.$('#invCopy', s).onclick = async () => {
        try { await navigator.clipboard.writeText(text + ' ' + url); U.toast(t('fr.copied')); }
        catch { U.$('#invUrl', s).select(); document.execCommand('copy'); U.toast(t('fr.copied')); }
      };
    });
  },

  async accountSheet() {
    const U = S.util, F = S.social;
    const st = await S.db.settings();
    let count = '…';
    U.sheet(`<h2>${U.esc(F.profileName())}</h2><p class="small muted">${U.esc(F.user().email || '')}</p>
      <div class="list-item"><div class="grow">${t('fr.shareRuns')}<div class="small muted">${t('fr.shareRuns.d')}</div></div><input type="checkbox" id="acShare" ${st.shareRuns !== false ? 'checked' : ''}></div>
      <div class="list-item"><div class="grow">${t('fr.sharedNow')}</div><b id="acCount">${count}</b></div>
      <div class="list-item" id="acRename"><div class="grow">${t('fr.changeName')}</div><span class="chev">›</span></div>
      <div class="list-item" id="acSync"><div class="grow">${t('fr.syncAll')}</div><span class="chev">›</span></div>
      <div class="list-item" id="acOut"><div class="grow" style="color:var(--danger)">${t('fr.signOut')}</div></div>`,
    (s, close) => {
      F.sharedCount().then((n) => { const el = U.$('#acCount', s); if (el) el.textContent = n; }).catch(() => {});
      U.$('#acShare', s).onchange = async (e) => {
        const on = e.target.checked;
        await S.db.saveSettings({ shareRuns: on });
        if (on) await F.syncAll(); else if (await U.confirmSheet(t('fr.unshareQ'), t('fr.unshare.d'), t('fr.unshare'), true)) await F.unshareAll();
        S.app.render();
      };
      U.$('#acSync', s).onclick = async () => { try { const n = await F.syncAll(); U.toast(t('fr.synced', { n })); close(); } catch (e) { U.toast(e.message); } };
      U.$('#acRename', s).onclick = () => U.sheet(`<h2>${t('fr.changeName')}</h2><input id="rnN" maxlength="40" value="${U.esc(F.profileName())}">
        <div class="btn-row"><button class="btn grow" data-close>${t('cancel')}</button><button class="btn primary grow" id="rnOk">${t('save')}</button></div>`,
      (s2, close2) => { U.$('#rnOk', s2).onclick = async () => { const v = U.$('#rnN', s2).value.trim(); if (v) await F.saveProfile(v); close2(); S.app.render(); }; });
      U.$('#acOut', s).onclick = async () => { await F.signOut(); close(); S.app.render(); };
    });
  },
};

function whoOf(data, uid) { const m = data.members.find((x) => x.user_id === uid); return m ? m.name : '?'; }
