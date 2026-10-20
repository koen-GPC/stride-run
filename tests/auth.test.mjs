import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/social.js', import.meta.url), 'utf8');
function setup() {
  let callback, locked = false, current = null, authError = null;
  const tasks = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: (fn) => { callback = fn; },
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => {
        current = { user: { id: 'runner' } };
        locked = true;
        try { await callback('SIGNED_IN', current); } finally { locked = false; }
        return { data: { session: current }, error: null };
      },
      signOut: async () => ({ error: authError }),
    },
    from: () => {
      assert.equal(locked, false, 'database calls must run outside the auth callback lock');
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Koen' }, error: null }) }) }) };
    },
  };
  const context = vm.createContext({
    S: { db: {} }, console, URLSearchParams,
    location: { origin: 'https://koen-gpc.github.io', pathname: '/stride-run/', search: '', hash: '#/friends' },
    window: { STRIDE_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public' }, supabase: { createClient: () => client } },
    setTimeout: (fn) => tasks.push(fn),
  });
  vm.runInContext(source, context);
  return { social: context.S.social, client, tasks, failSignOut: () => { authError = { message: 'offline' }; } };
}

test('OTP sign-in completes without querying Supabase inside its auth callback', async () => {
  const { social, tasks } = setup();
  await social.init();
  await social.verifyCode('koen@example.com', '123456');
  for (const task of tasks) await task();
  assert.equal(social.user().id, 'runner');
  assert.equal(social.profileName(), 'Koen');
});

test('a failed sign-out preserves the signed-in user and reports the error', async () => {
  const { social, failSignOut } = setup();
  await social.init();
  await social.verifyCode('koen@example.com', '123456');
  failSignOut();
  await assert.rejects(social.signOut(), /offline/);
  assert.equal(social.user().id, 'runner');
});

test('OTP request preserves the GitHub Pages subdirectory and permits signup', async () => {
  const { social, client } = setup();
  await social.init();
  let request;
  client.auth.signInWithOtp = async (args) => { request = args; return { error: null }; };
  await social.sendCode('koen@example.com');
  assert.equal(request.options.emailRedirectTo, 'https://koen-gpc.github.io/stride-run/');
  assert.equal(request.options.shouldCreateUser, true);
});

test('invalid or expired codes surface the Supabase error without signing in', async () => {
  const { social, client } = setup();
  await social.init();
  client.auth.verifyOtp = async () => ({ error: { message: 'Token has expired or is invalid' } });
  await assert.rejects(social.verifyCode('koen@example.com', '000000'), /expired or is invalid/);
  assert.equal(social.user(), null);
});

test('leaving the login screen while requesting a code does not cause a DOM error', async () => {
  const source = await readFile(new URL('../js/views-friends.js', import.meta.url), 'utf8');
  const elements = Object.fromEntries(['aEmail', 'aSend', 'aCodeBox', 'aCode', 'aVerify'].map((id) => [id, { value: id === 'aEmail' ? 'koen@example.com' : '', disabled: false, hidden: true }]));
  let mounted = true, finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const storage = new Map();
  const context = vm.createContext({
    S: { views: {}, social: { sendCode: () => pending }, util: { esc: (s) => s, toast: () => {}, $: (q) => mounted ? elements[q.slice(1)] : null } },
    t: (s) => s,
    sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  });
  vm.runInContext(source, context);
  context.S.views.friends.signIn({ innerHTML: '' });
  const sending = elements.aSend.onclick();
  mounted = false;
  finish();
  await sending;
  assert.equal(storage.get('otpEmail'), 'koen@example.com');
});
