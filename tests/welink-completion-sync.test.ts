import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { Store } from '../modules/todo/store';

test('WeLink refresh preserves local completion through changes, cancellation and reappearance without remote writes', async () => {
  const store = new Store(':memory:');
  const require = createRequire(import.meta.url), calls: string[][] = [];
  let now = Date.now(), meetings = [{ meetingId: 123, subject: '项目例会', meetingStartTime: now + 3600000, meetingEndTime: now + 7200000, location: '会议室 A' }];
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/welink-sync.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === './welink-cli' ? {
    runWelink: async (args: string[]) => { calls.push(args); if(args[0] === 'auth') return 'User Token: valid\nUID: z00123456'; if(args[0] === 'mail') return 'connected'; if(args[0] === 'calendar') return '[]'; return JSON.stringify({ code: 200, data: { data: meetings } }); },
  } : name === './welink-agenda' ? require('../electron/welink-agenda') : require(name), module, module.exports);
  const sync = new module.exports.WelinkSync(store, () => now, () => {}, () => 'me@example.com');
  try {
    assert.equal((await sync.refresh()).added, 1);
    const original = store.all()[0];
    const refreshing = sync.refresh();
    const done = store.update(original.id, { status: 'done' }, original.updatedAt);
    assert.equal((await refreshing).updated, 0);
    meetings = [{ ...meetings[0], subject: '更新后的例会', location: '会议室 B', meetingStartTime: now + 5400000, meetingEndTime: now + 9000000 }];
    now += 60000;
    assert.equal((await sync.refresh()).updated, 1);
    const updated = store.get(done.id);
    assert.equal(updated.status, 'done'); assert.equal(updated.completedAt, done.completedAt);
    assert.equal(updated.source, 'welink'); assert.equal(updated.welinkMeetingId, 123);
    assert.equal(updated.createdAt, original.createdAt); assert.equal(updated.title, meetings[0].subject);
    assert.equal(updated.dateAt, new Date(meetings[0].meetingStartTime).toISOString()); assert.equal(updated.note, '会议室 B');
    const saved = meetings; meetings = [];
    assert.equal((await sync.refresh()).removed, 1);
    assert.equal(store.get(done.id).completedAt, done.completedAt);
    meetings = saved; now += 60000;
    await sync.refresh();
    assert.equal(store.get(done.id).status, 'done'); assert.equal(store.get(done.id).completedAt, done.completedAt);
    assert.equal(store.get(done.id).deletedAt, null);
    assert.ok(calls.length > 0); assert.ok(calls.every(args => ['auth', 'mail', 'calendar', 'meeting'].includes(args[0]) && !['create','update','cancel'].includes(args[1])));
  } finally { store.close(); }
});
