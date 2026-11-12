import assert from 'node:assert/strict';
import test from 'node:test';
import { probeNewApiUsage } from '../tooling/probe-newapi-usage.mjs';

const credentials = { baseUrl: 'http://newapi.invalid', username: 'demo', password: 'private-password', date: '2026-11-10' };
const createdAt = Date.parse('2026-11-10T12:00:00+08:00') / 1000;
const row = (id, model = 'model-a', prompt = 1, completion = 2) => ({ id, created_at: createdAt, type: 2, model_name: model, prompt_tokens: prompt, completion_tokens: completion });
const json = (body, status = 200, cookie) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

function mockSite(t, { legacy = false, zeroBased = false, rows = [], failPage, missingTokens = false, unavailableStat = false, passwordEncryption = false, repeatPage = false, overlap = false, boundaryOverlap = false, displayIds = false } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname, headers = new Headers(options.headers);
    calls.push({ path, options, query: parsed.searchParams });
    assert.equal(options.redirect, 'error');
    if (path === '/api/status') return json({ success: true, data: { password_login_encryption_enabled: passwordEncryption } });
    if (path === '/api/user/login') {
      assert.deepEqual(JSON.parse(options.body), { username: credentials.username, password: credentials.password });
      return legacy
        ? json({ success: true, data: { id: 7 } }, 200, 'session=private-cookie; HttpOnly')
        : json({ success: true, data: { access_token: 'private-token', user: { id: 7 } } }, 200, 'new_api_has_session=1; HttpOnly');
    }
    assert.equal(options.method, 'GET');
    assert.equal(headers.get('New-Api-User'), '7');
    const authorized = legacy ? headers.get('Cookie') === 'session=private-cookie' : headers.get('Authorization') === 'Bearer private-token';
    if (!authorized) return json({ success: false, code: 'AUTH_UNAUTHORIZED' }, 401);
    if (path === '/api/log/self/stat') {
      if (unavailableStat) return new Response('not supported', { status: 404 });
      return json({ success: true, data: { quota: 999999, rpm: 3, tpm: 400 } });
    }
    assert.equal(path, '/api/log/self');
    assert.equal(parsed.searchParams.get('type'), '2');
    assert.equal(parsed.searchParams.get('start_timestamp'), String(Date.parse('2026-11-10T00:00:00+08:00') / 1000));
    const requested = Number(parsed.searchParams.get('p'));
    const page = zeroBased ? Math.max(0, requested) : Math.max(1, requested);
    const size = Number(parsed.searchParams.get('page_size'));
    if (size === 100 && page === failPage) return json({ success: false }, 503);
    let offset = (page - (zeroBased ? 0 : 1)) * size;
    if (overlap && zeroBased) offset = Math.max(0, page - 1) * size;
    if (boundaryOverlap && offset) offset--;
    const items = rows.slice(repeatPage && size === 100 ? 0 : offset, repeatPage && size === 100 ? size : offset + size).map(item => ({ ...item }));
    if (displayIds) items.forEach((item, i) => { item.id = (page - (zeroBased ? 0 : 1)) * size + i + 1; });
    if (missingTokens && items[0]) delete items[0].prompt_tokens;
    return json({ success: true, data: { page, page_size: size, total: rows.length, items } });
  });
  return calls;
}

test('Bearer login, one-based pagination and model totals do not mistake quota for tokens or leak credentials', async t => {
  const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, i % 2 ? 'model-b' : 'model-a'));
  rows.push(row(101, 'model-c', 4, 5));
  mockSite(t, { rows });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.selected_authentication, 'Bearer');
  assert.equal(report.authentication.find(value => value.mode === 'Cookie').http_status, 401);
  assert.equal(report.login.has_exact_session_cookie, false);
  assert.equal(report.pagination.first_page, 1);
  assert.equal(report.stat.token, null);
  assert.equal(report.usage.logs, 101);
  assert.equal(report.usage.prompt_tokens, 104);
  assert.equal(report.usage.completion_tokens, 205);
  assert.equal(report.usage.total_tokens, 309);
  assert.deepEqual(report.usage.models.map(model => model.total_tokens), [150, 150, 9]);
  assert.doesNotMatch(JSON.stringify(report), /private-password|private-token|private-cookie/);
});

test('legacy Cookie login and zero-based pagination remain usable', async t => {
  mockSite(t, { legacy: true, zeroBased: true, rows: [row(1)] });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.selected_authentication, 'Cookie');
  assert.equal(report.login.user_id_field, 'data.id');
  assert.equal(report.login.has_exact_session_cookie, true);
  assert.equal(report.pagination.first_page, 0);
  assert.equal(report.usage.total_tokens, 3);
});

test('an empty day is a confirmed zero even when the optional stat endpoint is unavailable', async t => {
  mockSite(t, { unavailableStat: true });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.stat.unavailable, true);
  assert.equal(report.usage.complete, true);
  assert.equal(report.usage.total_tokens, 0);
});

test('a failed later page cannot produce a partial or false-zero total', async t => {
  mockSite(t, { rows: Array.from({ length: 101 }, (_, i) => row(i + 1)), failPage: 2 });
  await assert.rejects(probeNewApiUsage(credentials), /第 2 页读取失败/);
});

test('missing token fields and repeated pages fail explicitly', async t => {
  await t.test('missing token fields', async t => {
    mockSite(t, { rows: [row(1)], missingTokens: true });
    await assert.rejects(probeNewApiUsage(credentials), /不能按零值处理/);
  });
  await t.test('repeated pages', async t => {
    mockSite(t, { rows: Array.from({ length: 101 }, (_, i) => row(i + 1)), repeatPage: true });
    await assert.rejects(probeNewApiUsage(credentials), /分页未取得新记录/);
  });
});

test('additional login protections stop the probe before it sends credentials', async t => {
  const calls = mockSite(t, { passwordEncryption: true });
  await assert.rejects(probeNewApiUsage(credentials), /通过网页完成/);
  assert.deepEqual(calls.map(call => call.path), ['/api/status']);
});

test('the 207 returned rows represent 107 verified records when p0 and p1 repeat a full page', async t => {
  mockSite(t, { legacy: true, zeroBased: true, overlap: true, rows: Array.from({ length: 107 }, (_, i) => ({ ...row(i + 1), quota: 10 })) });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.pagination.p0_p1_same_records, true);
  assert.equal(report.usage.logs, 107);
  assert.equal(report.usage.duplicates_removed, 100);
  assert.equal(report.usage.total_tokens, 321);
  assert.equal(report.usage.quota_units, 1070);
  assert.equal(report.stat.quota_units, 999999);
});

test('a full final page is followed through to the end rather than trusting its current count', async t => {
  const calls = mockSite(t, { rows: Array.from({ length: 100 }, (_, i) => row(i + 1)) });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.usage.logs, 100);
  assert.ok(calls.some(call => call.query.get('p') === '2'));
  assert.equal(report.usage.quota_units, null);
  assert.equal(report.usage.quota_missing_records, 100);
});

test('reused display IDs preserve different records and identical usage values are not used as unique keys', async t => {
  const rows = Array.from({ length: 100 }, (_, i) => row(i + 1));
  rows.push(row(1, 'model-b', 4, 5));
  mockSite(t, { rows });
  const report = await probeNewApiUsage(credentials);
  assert.equal(report.usage.logs, 101);
  assert.equal(report.usage.total_tokens, 309);
});

test('reindexed boundary overlap needs a stable request identifier or fails without publishing a total', async t => {
  await t.test('stable request IDs', async t => {
    mockSite(t, { boundaryOverlap: true, displayIds: true, rows: Array.from({ length: 107 }, (_, i) => ({ ...row(i + 1), request_id: `request-${i}` })) });
    const report = await probeNewApiUsage(credentials);
    assert.equal(report.usage.logs, 107);
    assert.equal(report.usage.duplicates_removed, 1);
    assert.equal(report.usage.total_tokens, 321);
  });
  await t.test('ambiguous identifiers', async t => {
    mockSite(t, { boundaryOverlap: true, displayIds: true, rows: Array.from({ length: 107 }, (_, i) => row(i + 1)) });
    await assert.rejects(probeNewApiUsage(credentials), /条数超过总数/);
  });
});
