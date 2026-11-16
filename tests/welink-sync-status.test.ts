import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { Store } from '../modules/todo/store';
import type { WelinkSyncStatus } from '../shared/island-contracts';

const require = createRequire(import.meta.url);
function loadSync(run: () => Promise<string>) {
  const runWelink = async (args: string[]) => args[0] === 'auth' ? 'User Token: valid\nUID: z00123456' : args[0] === 'mail' ? 'connected' : args[0] === 'calendar' ? '[]' : run();
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/welink-sync.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === './welink-cli' ? { runWelink } : name === './welink-agenda' ? require('../electron/welink-agenda') : require(name), module, module.exports);
  return module.exports.WelinkSync;
}

test('failed refreshes preserve meetings and last success, and an unchanged recovery clears the error', async () => {
  const store = new Store(':memory:'), changes: WelinkSyncStatus[] = [];
  let now = Date.parse('2026-11-11T09:10:00Z'), failure = '', badResponse = false;
  const meetings = [{ meetingId: 123, subject: '已缓存会议', meetingStartTime: now + 3600000, meetingEndTime: now + 7200000 }];
  const Sync = loadSync(async () => {
    if (failure) throw new Error(failure);
    return JSON.stringify(badResponse ? { code: 503, message: '服务暂不可用' } : { code: 200, data: { data: meetings } });
  });
  const sync = new Sync(store, () => now, (status: WelinkSyncStatus) => changes.push(status), () => 'me@example.com');
  try {
    assert.deepEqual(sync.status(), { syncing: false, lastSuccessAt: null, error: '' });
    assert.equal((await sync.refresh()).added, 1);
    const successAt = now, cached = store.all(true);
    now += 600000; failure = '连接超时';
    assert.match((await sync.refresh()).error, /连接超时/);
    assert.deepEqual(store.all(true), cached);
    assert.equal(sync.status().lastSuccessAt, successAt); assert.match(sync.status().error, /连接超时/); assert.equal(sync.status().sources.meeting.state, 'error');
    now += 600000; failure = ''; badResponse = true;
    assert.match((await sync.refresh()).error, /服务暂不可用/);
    assert.deepEqual(store.all(true), cached);
    assert.equal(sync.status().lastSuccessAt, successAt);
    now += 600000; badResponse = false;
    const recovered = await sync.refresh();
    assert.deepEqual(recovered, { added: 0, updated: 0, removed: 0 });
    assert.equal(sync.status().lastSuccessAt, now); assert.equal(sync.status().error, ''); assert.equal(sync.status().sources.meeting.state, 'success');
    assert.equal(changes.length, 8);
    assert.equal(changes.at(-2)!.syncing, true);
    assert.match(changes.at(-2)!.error, /服务暂不可用/);
    assert.equal(changes.at(-1)!.error, '');
  } finally { store.close(); }
});

test('overlapping automatic and manual refreshes share one request and never invent a success time', async () => {
  const store = new Store(':memory:'), changes: WelinkSyncStatus[] = [];
  let requests = 0, reject!: (error: Error) => void;
  const Sync = loadSync(() => { requests++; return new Promise<string>((_resolve, fail) => { reject = fail; }); });
  const sync = new Sync(store, () => 123, (status: WelinkSyncStatus) => changes.push(status), () => 'me@example.com');
  try {
    const automatic = sync.refresh(), manual = sync.refresh();
    assert.equal(automatic, manual); await new Promise(resolve => setImmediate(resolve)); assert.equal(requests, 1);
    assert.equal(sync.status().syncing, true);
    reject(new Error('第一次同步失败'));
    assert.match((await manual).error, /第一次同步失败/);
    assert.equal(sync.status().lastSuccessAt, null);
    assert.equal(sync.status().syncing, false);
    assert.equal(changes.length, 2);
  } finally { store.close(); }
});

test('a local calendar write error is reported and a later retry can complete', async () => {
  let fail = true;
  const Sync = loadSync(async () => JSON.stringify({ code: 200, data: { data: [{ meetingId: 1, subject: '会议', meetingStartTime: 1794376800000, meetingEndTime: 1794380400000 }] } }));
  const sync = new Sync({ transaction: (run: () => unknown) => run(), all: () => [], put: () => { if (fail) throw new Error('日程库写入失败'); } }, () => 1794373200000, () => {}, () => 'me@example.com');
  assert.equal((await sync.refresh()).error, '日程库写入失败');
  assert.equal(sync.status().syncing, false);
  assert.equal(sync.status().lastSuccessAt, null);
  fail = false;
  assert.equal((await sync.refresh()).added, 1);
  assert.equal(sync.status().error, '');
  assert.ok(sync.status().lastSuccessAt);
});
