import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { dayStartSec } from '../shared/island-quota';

const require = createRequire(import.meta.url);
const json = (data: unknown, status = 200, cookie?: string) => new Response(JSON.stringify(data), { status, headers: cookie ? { 'Set-Cookie': cookie } : {} });
const row = (id: number, patch: Record<string, unknown> = {}) => ({ id, created_at: dayStartSec(), type: 2, model_name: 'model-a', prompt_tokens: 1, completion_tokens: 2, quota: 900, ...patch });

function service() {
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/island-quotas.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const saved: unknown[] = [];
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'electron') return { safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text) }, shell: {} };
    if (name === 'node:fs') return { existsSync: () => false };
    if (name === '../modules/storage/json-file') return { writeJsonAtomic: (_path: string, value: unknown) => saved.push(value) };
    return require(name);
  }, module, module.exports);
  return { quotas: new module.exports.NewApiQuotas('unused-test-directory', () => {}), saved };
}

function site(t: any, { modern = false, cookieOnly = false, rejectPage0 = false, zeroBased = false, overlap = false, boundaryOverlap = false, displayIds = false, rows = [row(1)], failPage = -1, businessFailure = false, malformed = false } = {}) {
  const calls: { path: string; page: number; headers: Headers }[] = [];
  const state = { failPage, businessFailure, malformed, expired: false, unauthorized: false };
  t.mock.method(globalThis, 'fetch', async (input: string | URL, options: RequestInit) => {
    const url = new URL(input), page = Number(url.searchParams.get('p')), headers = new Headers(options.headers);
    calls.push({ path: url.pathname, page, headers });
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/api/user/login') {
      state.expired = false;
      return modern
        ? json({ success: true, data: { user: { id: 7 }, access_token: 'private-token' } }, 200, cookieOnly ? 'session=private-cookie; HttpOnly' : 'new_api_has_session=1; HttpOnly')
        : json({ success: true, data: { id: 7 } }, 200, 'session=private-cookie; HttpOnly');
    }
    if (url.pathname === '/api/log/self/stat') return json({ success: true, data: { token: 999999, quota: 999999 } });
    assert.equal(url.pathname, '/api/log/self');
    assert.equal(headers.get('New-Api-User'), '7');
    if (state.expired || state.unauthorized || (modern && !cookieOnly ? headers.get('Authorization') !== 'Bearer private-token' : headers.get('Cookie') !== 'session=private-cookie')) return json({ success: false }, 401);
    assert.equal(url.searchParams.get('type'), '2');
    assert.equal(url.searchParams.get('start_timestamp'), String(dayStartSec()));
    if (rejectPage0 && page === 0) return json({ success: false }, 400);
    if (page === state.failPage) return json({ success: false }, 503);
    if (state.businessFailure) return json({ success: false, message: 'unavailable' });
    if (state.malformed) return json({ success: true, data: {} });
    const size = Number(url.searchParams.get('page_size'));
    const returned = zeroBased ? page : Math.max(1, page);
    let offset = (returned - (zeroBased ? 0 : 1)) * size;
    if (overlap && zeroBased) offset = Math.max(0, returned - 1) * size;
    if (boundaryOverlap && offset) offset--;
    const items = rows.slice(offset, offset + size).map((value, i) => displayIds ? { ...value, id: (returned - (zeroBased ? 0 : 1)) * size + i + 1 } : value);
    return json({ success: true, data: { page: returned, page_size: size, total: rows.length, items } });
  });
  return { calls, state };
}

async function connect(quotas: any) {
  await quotas.connect('工作账号', 'http://newapi.invalid', 'demo', 'private-password');
  return (await quotas.refresh())[0];
}

test('one-based page normalization does not double count and tokens share the same logs as model totals', async t => {
  const { calls } = site(t, { rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 321);
  assert.deepEqual(account.models, [{ name: 'model-a', quota: 321 }]);
  assert.equal(calls.filter(call => call.path === '/api/user/login').length, 1);
  assert.ok(!calls.some(call => call.path.endsWith('/stat')));
});

test('zero-based p0 and p1 duplicate pages are counted once before reading the remaining seven records', async t => {
  site(t, { zeroBased: true, overlap: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  assert.equal((await connect(quotas)).todayQuota, 321);
});

test('a repeated boundary record is removed without dropping distinct requests with identical usage', async t => {
  site(t, { boundaryOverlap: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 321);
});

test('modern nested user IDs and Bearer authentication work without a session cookie', async t => {
  site(t, { modern: true });
  const { quotas, saved } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 3);
  assert.equal(account.userId, '7');
  assert.doesNotMatch(JSON.stringify(saved), /private-token|new_api_has_session/);
});

test('a returned but unusable Bearer token falls back to the working Cookie session', async t => {
  const { calls } = site(t, { modern: true, cookieOnly: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 321);
  assert.equal(calls.filter(call => call.headers.has('Authorization')).length, 1);
});

test('one-based servers rejecting p0 are supported without hiding other page failures', async t => {
  site(t, { rejectPage0: true });
  const { quotas } = service();
  assert.equal((await connect(quotas)).todayQuota, 3);
});

test('authentication expiry logs in once again, and persistent rejection stops retrying', async t => {
  const { calls, state } = site(t);
  const { quotas } = service();
  await connect(quotas);
  state.expired = true;
  assert.equal((await quotas.refresh())[0].message, '');
  assert.equal(calls.filter(call => call.path === '/api/user/login').length, 2);
  state.unauthorized = true;
  const failed = (await quotas.refresh())[0];
  assert.match(failed.message, /401/);
  assert.equal(failed.todayQuota, 3);
  assert.equal(calls.filter(call => call.path === '/api/user/login').length, 3);
});

test('true zero-based pagination and exactly full final pages remain complete', async t => {
  const { calls } = site(t, { zeroBased: true, rows: Array.from({ length: 100 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  assert.equal((await connect(quotas)).todayQuota, 300);
  assert.ok(calls.some(call => call.path === '/api/log/self' && call.page === 1));
});

test('ambiguous reindexed overlap cannot publish an inflated total', async t => {
  site(t, { boundaryOverlap: true, displayIds: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'error');
  assert.notEqual(account.hasData, true);
  assert.match(account.message, /条数|完整|重复/);
});

test('stable request IDs can identify boundary duplicates even when display IDs change', async t => {
  site(t, { boundaryOverlap: true, displayIds: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1, { request_id: `request-${i}` })) });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 321);
});

test('a reused display ID with different record details is not silently dropped', async t => {
  const rows = Array.from({ length: 100 }, (_, i) => row(i + 1));
  rows.push(row(1, { model_name: 'model-b', prompt_tokens: 4, completion_tokens: 5 }));
  site(t, { rows });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.todayQuota, 309);
  assert.deepEqual(account.models, [{ name: 'model-a', quota: 300 }, { name: 'model-b', quota: 9 }]);
});

test('failed later pages preserve the last successful reading and successful recovery clears the error', async t => {
  const { state } = site(t, { rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
  const { quotas } = service();
  const first = await connect(quotas);
  state.failPage = 2;
  const failed = (await quotas.refresh())[0];
  assert.equal(failed.todayQuota, first.todayQuota);
  assert.equal(failed.updatedAt, first.updatedAt);
  assert.equal(failed.hasData, true);
  assert.match(failed.message, /503/);
  state.failPage = -1;
  const recovered = (await quotas.refresh())[0];
  assert.equal(recovered.message, '');
  assert.equal(recovered.todayQuota, 321);
});

test('first-read transport, business and shape failures do not become successful zero usage', async t => {
  for (const scenario of [{ failPage: 0 }, { businessFailure: true }, { malformed: true }, { rows: [row(1, { prompt_tokens: undefined })] }]) {
    await t.test(JSON.stringify(scenario), async t => {
      site(t, scenario);
      const { quotas } = service();
      const account = await connect(quotas);
      assert.equal(account.status, 'error');
      assert.notEqual(account.hasData, true);
      assert.ok(account.message);
    });
  }
});

test('an empty completed day displays a real zero', async t => {
  site(t, { rows: [] });
  const { quotas } = service();
  const account = await connect(quotas);
  assert.equal(account.status, 'ready');
  assert.equal(account.hasData, true);
  assert.equal(account.todayQuota, 0);
  assert.deepEqual(account.models, []);
});
