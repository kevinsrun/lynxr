import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLynxrClient } from '../src/client';
import { entries, hasWork, scriptSections, statusLabel } from '../src/contracts';
import type { Allowance, CreatorData, CreatorRow } from '../src/contracts';
import { canRetry, creatorApi } from '../src/creator-api';
import { sessionStorage } from '../src/session-storage';
import { parseVideoLink } from '../src/video';

const endpoint = 'https://lynxr-mobile-test.invalid';
const key = 'sb_publishable_test_fixture';
const creatorId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const email = 'creator@example.invalid';
const password = 'fixture-password';
const token = 'test-access-token';
const video = 'https://www.instagram.com/reel/EXAMPLE1234/';
const short = 'https://vm.tiktok.com/EXAMPLE123/';
const stamp = '2026-11-17T15:00:01.123456+00:00';
const json = (body: unknown, status = 200) => Response.json(body, { status });

function memory() {
  const items = new Map<string, string>();
  return { items, getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => { items.set(key, value); },
    removeItem: async (key: string) => { items.delete(key); } };
}

function simulate(data?: CreatorData) {
  const values = memory();
  const keys = memory();
  // Substitutes Node's AES-GCM and in-memory stores for Expo native modules.
  const newStorage = () => sessionStorage(values, keys, {
    generateKey: async () => randomBytes(32).toString('hex'),
    async encrypt(value, secret) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), nonce);
      return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    },
    async decrypt(value, secret) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  });
  const rows = new Map<string, CreatorRow>([[otherId, {
    id: otherId, data: { name: 'Other account' }, updated_at: stamp,
  }]]);
  if (data) rows.set(creatorId, { id: creatorId, data, updated_at: stamp });
  const room: Allowance = { used: 1, granted: 3, period_days: 7, used_24h: 1, daily_max: 0 };
  const events: string[] = [];
  const controls: {
    beforeWrite?: () => void;
    loseResponse?: boolean;
    refuseWrite?: string;
    allowanceUnavailable?: boolean;
  } = {};
  const nextStamp = () => `2026-11-17T15:00:01.${123500 + events.length}+00:00`;
  const user = {
    id: creatorId, aud: 'authenticated', role: 'authenticated', email,
    user_metadata: { display_name: 'Créateur ' + '🙂'.repeat(800) },
    app_metadata: { provider: 'email' },
    created_at: stamp,
  };

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, endpoint, 'Mock transport must never leave the invalid fixture host');
    const { pathname, searchParams } = url;
    assert.equal(request.headers.get('apikey'), key);
    const authorization = request.headers.get('authorization');
    const isCreator = authorization === 'Bearer ' + token;
    const method = request.method;
    events.push(`${method} ${pathname}`);

    if (pathname === '/auth/v1/token') {
      assert.equal(searchParams.get('grant_type'), 'password');
      const credentials = await request.json();
      if (credentials.email !== email || credentials.password !== password) {
        return Response.json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, {
          status: 400, headers: { 'X-Supabase-Api-Version': '2024-01-01' },
        });
      }
      return json({ access_token: token, refresh_token: 'test-refresh-token', expires_in: 3600, user });
    }
    if (pathname === '/auth/v1/logout') {
      assert.equal(authorization, 'Bearer ' + token);
      assert.equal(searchParams.get('scope'), 'local');
      return new Response(null, { status: 204 });
    }
    if (pathname === '/rest/v1/rpc/my_allowance') {
      assert.equal(method, 'POST');
      if (!isCreator) return json({ code: '42501' }, 403);
      const args = await request.json().catch(() => ({}));
      assert.deepEqual(args, {}, 'The RPC scopes by auth.uid(), never by an input ID');
      return controls.allowanceUnavailable ? json({ code: 'PGRST202' }, 404) : json(room);
    }
    // Fail closed on any unexpected path, including the charging RPC,
    // worker invocation, billing functions and agency tables.
    assert.equal(pathname, '/rest/v1/lynxr_creators');
    const id = searchParams.get('id')?.slice(3);
    if (method === 'GET') {
      assert.ok(id && searchParams.get('id')?.startsWith('eq.'), 'The read must filter by creator ID');
      const row = isCreator && id === creatorId ? rows.get(id) : undefined;
      return json(row ? [row] : []);
    }
    if (method === 'PATCH' || method === 'POST') {
      controls.beforeWrite?.();
      const write = await request.json();
      assert.equal(searchParams.get('select'), 'id');
      if (controls.refuseWrite) return json({ code: controls.refuseWrite }, 400);
      const target = method === 'POST' ? write.id : id;
      if (!isCreator || target !== creatorId) {
        return method === 'PATCH' ? json([]) : json({ code: '42501' }, 403);
      }
      const before = rows.get(target);
      if (method === 'POST' && before) return json({ code: '23505' }, 409);
      if (method === 'PATCH' && (!before || searchParams.get('updated_at') !== 'eq.' + before.updated_at)) return json([]);
      rows.set(target, { id: target, data: write.data, updated_at: nextStamp() });
      if (controls.loseResponse) throw new Error('Fixture: save response lost');
      return json([{ id: target }], method === 'POST' ? 201 : 200);
    }
    assert.fail(`Unexpected method ${method}`);
  };

  async function newClient() {
    const client = createLynxrClient(endpoint, key, newStorage(), fakeFetch);
    await client.auth.stopAutoRefresh();
    return client;
  }

  async function signIn() {
    const client = await newClient();
    const result = await client.auth.signInWithPassword({ email, password });
    assert.ifError(result.error);
    assert.equal(result.data.user?.id, creatorId);
    return { client, api: creatorApi(client, creatorId, randomUUID) };
  }

  return { newClient, signIn, events, rows, room, values, keys, controls };
}

test('mobile URL validation matches the shared worker and web video fixtures', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../../pipeline/link_shapes.json', import.meta.url), 'utf8'));
  for (const { url, expect } of fixtures) {
    assert.equal(!!parseVideoLink(url), expect === 'ok', url);
  }
  assert.equal(parseVideoLink('https://attacker@instagram.com/reel/EXAMPLE1234/'), null);
  assert.equal(parseVideoLink('https://instagram.com:444/reel/EXAMPLE1234/'), null);
  assert.deepEqual(parseVideoLink(' www.instagram.com/reel/EXAMPLE1234/?utm_source=test#ref '), {
    url: video, canon: 'instagram.com/reel/EXAMPLE1234', platform: 'Instagram',
  });
});

test('password authentication, session restore with ciphertext, and local sign-out', async () => {
  const m = simulate();
  const { client } = await m.signIn();
  assert.equal(m.values.items.size, 1);
  for (const value of m.values.items.values()) {
    assert.ok(!value.includes(token));
    assert.ok(!value.includes(email));
    assert.ok(!value.includes(password));
  }
  const rebooted = await m.newClient();
  assert.equal((await rebooted.auth.getSession()).data.session?.user.id, creatorId);
  assert.equal(m.events.filter((path) => path.includes('/auth/v1/token')).length, 1);
  assert.ifError((await rebooted.auth.signOut({ scope: 'local' })).error);
  assert.equal(m.values.items.size, 0);
  assert.equal(m.keys.items.size, 0);
  assert.equal((await (await m.newClient()).auth.getSession()).data.session, null);
  await client.auth.stopAutoRefresh();
});

test('invalid credentials create no session and a protected row stays inaccessible', async () => {
  const m = simulate({ name: 'Creator' });
  const client = await m.newClient();
  const fail = await client.auth.signInWithPassword({ email, password: 'wrong' });
  assert.equal(fail.error?.code, 'invalid_credentials');
  assert.equal(m.values.items.size, 0);
  const api = creatorApi(client, creatorId, randomUUID);
  assert.equal(await api.read(), null);
  await assert.rejects(api.submit(video), /couldn’t check your script allowance/i);
  assert.equal(m.events.some((event) => event.startsWith('PATCH')), false);
});

test('a missing device key cannot restore saved ciphertext', async () => {
  const m = simulate();
  await m.signIn();
  m.keys.items.clear();
  assert.equal((await (await m.newClient()).auth.getSession()).data.session, null);
});

test('a creator cannot read, update or insert a different creator row in the policy fixture', async () => {
  const m = simulate({ name: 'Creator' });
  const { client, api } = await m.signIn();
  assert.equal((await api.read())?.data.name, 'Creator');
  const crossAccount = creatorApi(client, otherId, randomUUID);
  assert.equal(await crossAccount.read(), null);
  await assert.rejects(crossAccount.submit(video), /cannot save/);
  const write = await client.from('lynxr_creators').update({ data: {} })
    .eq('id', otherId).eq('updated_at', stamp).select('id').maybeSingle();
  assert.ifError(write.error);
  assert.equal(write.data, null);
  assert.equal(m.rows.get(otherId)?.data.name, 'Other account');
});

test('queue write preserves onboarding and reused library ID, and duplicate send returns the job', async () => {
  const setup = { v: 2, steps: { goal: 'done' } };
  const brand = { id: 'brand', name: 'A brand', unknown: 'preserve' };
  const item = { id: 'original-web-library-item', url: video, canon: 'instagram.com/reel/EXAMPLE1234', platform: 'Instagram' };
  const m = simulate({ setup, brands: [brand], library: [item] });
  const { api } = await m.signIn();
  const id = await api.submit(video);
  assert.equal(await api.submit('instagram.com/reel/EXAMPLE1234?igsh=test'), id);
  const row = await api.read();
  assert.deepEqual(row?.data.setup, setup);
  assert.deepEqual(row?.data.brands, [brand]);
  assert.deepEqual(row?.data.library, [item]);
  const job = entries(row?.data)[0];
  assert.equal(job.libraryId, item.id);
  assert.equal(job.brandId, null);
  assert.equal(job.sourceUrl, video);
  assert.match(String(job.code), /^LYNX[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(statusLabel(job), 'Queued');
  assert.equal(m.events.filter((event) => event.startsWith('PATCH')).length, 1);
  assert.deepEqual(m.room, { used: 1, granted: 3, period_days: 7, used_24h: 1, daily_max: 0 });
});

test('initial insert and a concurrent first save preserve the existing row', async () => {
  const blank = simulate();
  const { api } = await blank.signIn();
  assert.equal(await api.read(), null);
  const id = await api.submit(short);
  assert.equal(entries((await api.read())?.data)[0].id, id);
  assert.ok(blank.events.includes('POST /rest/v1/lynxr_creators'));

  const raced = simulate();
  const { api: racingApi } = await raced.signIn();
  raced.controls.beforeWrite = () => {
    raced.rows.set(creatorId, { id: creatorId, updated_at: stamp, data: { name: 'Saved on web' } });
    raced.controls.beforeWrite = undefined;
  };
  await racingApi.submit(short);
  assert.equal((await racingApi.read())?.data.name, 'Saved on web');
});

test('stale update retries on a fresh snapshot without reverting worker state', async () => {
  const m = simulate({ adaptations: [{ id: 'web', status: 'running' }] });
  const { api } = await m.signIn();
  m.controls.beforeWrite = () => {
    m.rows.set(creatorId, { id: creatorId, updated_at: stamp.replace('123456', '123457'),
      data: { adaptations: [{ id: 'web', status: 'done' }] } });
    m.controls.beforeWrite = undefined;
  };
  await api.submit(video);
  assert.deepEqual(entries((await api.read())?.data).map((job) => job.status), ['queued', 'done']);
  assert.equal(m.events.filter((event) => event.startsWith('PATCH')).length, 2);
});

test('no new queue write for invalid links, exhausted rolling/daily allowance, or missing RPC', async () => {
  const m = simulate({});
  const { api } = await m.signIn();
  await assert.rejects(api.submit('https://instagram.com/explore/'), /full link/);
  m.room.used = m.room.granted;
  await assert.rejects(api.submit(video), /reached your script allowance/);
  m.room.used = 0;
  m.room.daily_max = m.room.used_24h = 1;
  await assert.rejects(api.submit(short), /reached your script allowance/);
  m.controls.allowanceUnavailable = true;
  await assert.rejects(api.submit(short), /couldn’t check your script allowance/i);
  assert.ok(!m.events.some((event) => event.startsWith('PATCH')));
});

test('save failures do not report queued, and an ambiguous write can be safely checked by resubmitting', async () => {
  const m = simulate({});
  const { api } = await m.signIn();
  m.controls.refuseWrite = '23514';
  await assert.rejects(api.submit(video), /library is too large/);
  assert.deepEqual(entries((await api.read())?.data), []);
  delete m.controls.refuseWrite;
  m.controls.loseResponse = true;
  await assert.rejects(api.submit(video), /couldn’t confirm the save/);
  const accepted = entries((await api.read())?.data)[0];
  assert.equal(await api.submit(video), accepted.id);
  assert.equal(entries((await api.read())?.data).length, 1);
});

test('worker progression and same-ID manual retry preserve the existing ledger identity', async () => {
  const m = simulate({});
  const { api } = await m.signIn();
  const id = await api.submit(video);
  const live = () => m.rows.get(creatorId)!.data.adaptations![0];
  async function current() { return entries((await api.read())?.data)[0]; }

  live().status = 'running';
  assert.equal(statusLabel(await current()), 'Processing');
  assert.equal(hasWork(await current()), true);
  Object.assign(live(), { status: 'error', retrying: true, noteKind: 'fetch', note: 'Still trying' });
  assert.equal(statusLabel(await current()), 'Retry scheduled');
  assert.equal(canRetry(await current()), false);
  await api.retry(id);
  assert.equal((await current()).status, 'error');

  Object.assign(live(), { retrying: false, retryable: false });
  await assert.rejects(api.retry(id), /can’t be retried/);
  Object.assign(live(), { retryable: true, final: true, passes: 12, attemptedAt: stamp, aiFail: { kind: 'temporary' } });
  m.room.used = m.room.granted;
  assert.equal(statusLabel(await current()), 'Failed');
  assert.equal(await api.submit(video), id, 'A failed duplicate should reopen the original before the allowance gate');
  await api.retry(id);
  const queued = await current();
  assert.equal(queued.id, id);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.passes, undefined);
  assert.equal(queued.note, undefined);
  assert.equal(queued.aiFail, undefined);

  Object.assign(live(), { status: 'done', source: { script: { segments: [[0, 1, 'Original spoken line']] },
    shots: [{ t: 0, visual: 'Wide shot', onscreen_text: 'Original title' }] } });
  const complete = await current();
  assert.equal(statusLabel(complete), 'Completed');
  assert.equal(hasWork(complete), false);
  assert.deepEqual(scriptSections(complete), [
    { title: 'What they say', lines: ['Original spoken line'] },
    { title: 'What’s on screen', lines: ['Wide shot', 'Text: Original title'] },
  ]);
});

test('library can read and render prior brand scripts and excludes trash', async () => {
  const m = simulate({ adaptations: [{ id: 'brand-script', brandId: 'brand', status: 'done',
    adaptation: { hook: 'Saved hook', beats: [{ say: 'Edited line', do: 'Pick it up', show: 'Title card' }], cta: 'Try it' } }],
    trash: [{ id: 'deleted', status: 'done' }],
  });
  const { api } = await m.signIn();
  const jobs = entries((await api.read())?.data);
  assert.deepEqual(jobs.map((job) => job.id), ['brand-script']);
  assert.deepEqual(scriptSections(jobs[0]), [
    { title: 'Hook', lines: ['Saved hook'] },
    { title: 'Beat 1', lines: ['Edited line', 'Do: Pick it up', 'On screen: Title card'] },
    { title: 'Call to action', lines: ['Try it'] },
  ]);
});
