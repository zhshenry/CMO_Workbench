import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { WelinkAgendaClient } from '../electron/welink-agenda';
import { agendaRange, dayMillis } from '../shared/welink-agenda';
import { Store } from '../modules/todo/store';
import { newTask, type Task } from '../shared/todo-contracts';
import { scheduledInRange, scheduleTimeRange } from '../shared/todo-format';

const now = Date.parse('2026-11-16T12:00:00+08:00');
const appointment = (id = 'calendar-a', patch: Record<string, unknown> = {}) => ({ itemId: id, changeKey: 'v1', subject: '邮件邀请', start: '2026-11-16T14:00:00+08:00', end: '2026-11-16T15:00:00+08:00', location: '线上', isAllDay: false, isCancelled: false, ...patch });
const meeting = (id = 1) => ({ meetingId: id, subject: '会议系统安排', meetingStartTime: String(now + 7200000), meetingEndTime: now + 10800000, meetingNo: '900001' });
function fixture() {
  const f = { uid: 'z00123456', calendar: [appointment()] as Record<string, unknown>[], meetings: [meeting()] as Record<string, unknown>[], calls: [] as string[][], calendarError: '', meetingError: '', rawCalendar: undefined as string | undefined, rawMeetings: undefined as string | undefined, details: { ...appointment(), organizer: '组织者', organizerEmail: 'host@example.com', requiredAttendees: ['成员 <member@example.com>'], optionalAttendees: [], body: '会议说明', isOnlineMeeting: false, onlineMeetingUrl: 'https://example.com/join?id=77' }, failWrite: false };
  const run = async (args: string[]) => {
    f.calls.push(args);
    if (args[0] === 'auth') return `User Token: valid\nUID: ${f.uid}`;
    if (args[0] === 'mail') return 'Discovered EWS URL: https://example.com/EWS/Exchange.asmx';
    if (args.includes('get')) return JSON.stringify(f.details);
    if (args[0] === 'calendar') {
      if (f.calendarError) throw new Error(f.calendarError);
      return f.rawCalendar ?? JSON.stringify(args[args.indexOf('--start') + 1] === '2026-11-16' ? f.calendar : []);
    }
    if (f.meetingError) throw new Error(f.meetingError);
    const type = args[args.indexOf('--type') + 1];
    return f.rawMeetings ?? JSON.stringify({ code: 200, data: { data: type === '1' ? f.meetings : [], page: 1, size: 30, total: 0 } });
  };
  return { f, run };
}
function loadSync(run: (args: string[]) => Promise<string>) {
  const require = createRequire(import.meta.url), mod = { exports: {} as any };
  const code = transformSync(readFileSync('electron/welink-sync.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === './welink-cli' ? { runWelink: run } : name === './welink-agenda' ? require('../electron/welink-agenda') : require(name), mod, mod.exports);
  return mod.exports.WelinkSync;
}

test('two sources use their actual JSON shapes, explicit China time and independent identities', async () => {
  const { f, run } = fixture(), client = new WelinkAgendaClient(run, () => now);
  const result = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.deepEqual(result.events.map(e => e.external.provider), ['calendar', 'meeting']);
  assert.ok(Object.values(result.sources).every(s => s.state === 'success'));
  assert.equal(result.events[0].start, '2026-11-16T06:00:00.000Z');
  assert.ok(f.calls.find(args => args.includes('--meeting-end-time'))!.includes(String(dayMillis('2026-11-17') - 1)));
  assert.ok(!f.calls.flat().includes('--format'), 'bundled 1.0.16 rejects this undocumented flag');
  assert.deepEqual(f.calls.filter(args => args[0] === 'meeting').map(args => args[args.indexOf('--type') + 1]), ['1', '2']);
  assert.throws(() => agendaRange('2026-02-30', '2026-03-03'));
  assert.throws(() => agendaRange('2026-11-16', '2027-01-01'));
});

test('meeting pages ignore total=0 and read beyond the first 30; repeated pages stay incomplete', async () => {
  const { run } = fixture(); let pages = 0;
  const client = new WelinkAgendaClient(async args => {
    if (args[0] !== 'meeting') return run(args);
    if (args[args.indexOf('--type') + 1] === '2') return JSON.stringify({ code: 200, data: { page: 1, size: 30, total: 0 } });
    pages++; const page = Number(args[args.indexOf('--page') + 1]);
    return JSON.stringify({ code: 200, data: { data: page === 1 ? Array.from({ length: 30 }, (_, i) => meeting(i + 1)) : [meeting(31)], size: 30, total: 0 } });
  }, () => now);
  const result = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(pages, 2); assert.equal(result.sources.meeting.count, 31); assert.equal(result.sources.meeting.state, 'success');
  const repeat = new WelinkAgendaClient(async args => args[0] !== 'meeting' ? run(args) : JSON.stringify({ code: 200, data: { data: [meeting()], size: 1, total: 0 } }), () => now);
  const partial = await repeat.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(partial.sources.meeting.state, 'partial'); assert.match(partial.sources.meeting.error, /重复/);
});

test('calendar parse failures, truncation, ambiguous instances and bad dates never count as complete', async () => {
  const { f, run } = fixture(), client = new WelinkAgendaClient(run, () => now);
  f.rawCalendar = '{}'; assert.equal((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.state, 'error');
  f.rawCalendar = undefined;
  f.calendar = Array.from({ length: 500 }, (_, i) => appointment(String(i)));
  const capped = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(capped.sources.calendar.state, 'partial'); assert.equal(capped.sources.calendar.count, 500);
  f.calendar = [appointment(), appointment('calendar-a', { start: '2026-11-16T16:00:00+08:00', end: '2026-11-16T17:00:00+08:00' })];
  assert.match((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.error, /周期实例/);
  f.calendar = [appointment('bad', { start: '2026-11-16T14:00:00' })];
  assert.match((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.error, /时区/);
});

test('429 retries are bounded and authentication errors do not retry', async () => {
  const { run } = fixture(); let hits = 0; const delays: number[] = [];
  const client = new WelinkAgendaClient(async args => {
    if (args[0] === 'calendar' && hits++ < 2) throw new Error('HTTP 429 Too Many Requests');
    return run(args);
  }, () => now, async ms => { delays.push(ms); });
  assert.equal((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.state, 'success');
  assert.deepEqual(delays, [1000, 2000]);
  let limitedHits = 0;
  const limited = new WelinkAgendaClient(async args => { if (args[0] === 'calendar') { limitedHits++; throw new Error('HTTP 429'); } return run(args); }, () => now, async () => {});
  assert.equal((await limited.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.state, 'error');
  assert.equal(limitedHits, 3);
  let authHits = 0;
  const failed = new WelinkAgendaClient(async () => { authHits++; throw new Error('401'); }, () => now, async () => { assert.fail('401 must not retry'); });
  await assert.rejects(failed.query('2026-11-16', '2026-11-17', 'me@example.com')); assert.equal(authHits, 1);
});

test('a genuine empty agenda works without email and differs from a malformed response', async () => {
  const { f, run } = fixture(), client = new WelinkAgendaClient(run, () => now);
  f.calendar = []; f.meetings = [];
  const empty = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(empty.events.length, 0); assert.ok(Object.values(empty.sources).every(s => s.state === 'success'));
  const automatic = await client.query('2026-11-16', '2026-11-17', '');
  assert.equal(automatic.events.length, 0); assert.equal(automatic.sources.calendar.state, 'success');
  f.rawMeetings = JSON.stringify({ code: 200, data: {} });
  const malformed = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(malformed.sources.meeting.state, 'error');
});

test('logged-in calendar and details need no email or autodiscover when the CLI can already read them', async () => {
  const { f, run } = fixture(), client = new WelinkAgendaClient(run, () => now);
  const result = await client.query('2026-11-16', '2026-11-17', '');
  assert.equal(result.sources.calendar.state, 'success'); assert.equal(result.events[0].external.account, f.uid);
  assert.equal((await client.details(result.events[0], '')).subject, f.details.subject);
  assert.equal(f.calls.some(args => args[0] === 'mail' || args.includes('--email')), false);
});

test('optional mailbox setup runs only after an explicit discovery error, never after an ordinary network error', async () => {
  const { f, run } = fixture(); let configured = false;
  const calls: string[][] = [];
  const client = new WelinkAgendaClient(async args => {
    calls.push(args);
    if (args[0] === 'mail') configured = true;
    if (args[0] === 'calendar' && !configured) throw new Error('EWS client not initialized. Please run mail autodiscover --email first.');
    return run(args);
  }, () => now);
  const missing = await client.query('2026-11-16', '2026-11-17', '');
  assert.match(missing.sources.calendar.error, /手动配置邮箱/); assert.equal(calls.some(a => a[0] === 'mail'), false);
  assert.equal(missing.sources.meeting.state, 'success');
  assert.equal((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.state, 'success');
  assert.ok(calls.findIndex(a => a[0] === 'calendar') < calls.findIndex(a => a[0] === 'mail'));
  assert.equal(calls.filter(a => a[0] === 'mail').length, 1);
  f.calendarError = '连接超时'; await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(calls.filter(a => a[0] === 'mail').length, 1);
});

test('optional email changes and previous email-qualified identities never duplicate or lose a calendar completion', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:'); let email = '';
  const sync = new Sync(store, () => now, () => {}, () => email);
  try {
    await sync.refresh(); const cal = store.all().find(t => t.external?.provider === 'calendar')!;
    const done = store.update(cal.id, { status: 'done' }, cal.updatedAt);
    store.put({ ...done, external: { ...done.external!, account: `${f.uid}:old@example.com` } });
    email = 'new@example.com'; await sync.refresh();
    assert.equal(store.all().filter(t => t.external?.provider === 'calendar').length, 1);
    assert.equal(store.get(cal.id).completedAt, done.completedAt); assert.equal(store.get(cal.id).external!.account, f.uid);
    email = ''; await sync.refresh(); await sync.details(cal.id);
    assert.equal(store.get(cal.id).completedAt, done.completedAt); assert.equal(f.calls.some(args => args[0] === 'mail'), false);
  } finally { store.close(); }
});

test('partial source sync updates the other source, preserves caches and local completion, and broadcasts changes', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:'); let published = 0;
  const sync = new Sync(store, () => now, () => {}, () => 'me@example.com', () => published++);
  try {
    assert.equal((await sync.refresh()).added, 2);
    const item = store.all().find(t => t.external?.provider === 'calendar')!;
    assert.throws(() => store.update(item.id, { title: '禁止改动' }, item.updatedAt), /邮箱日历/);
    assert.throws(() => store.remove(item.id, item.updatedAt), /原邮箱日历/);
    const completed = store.update(item.id, { status: 'done' }, item.updatedAt);
    f.calendarError = '邮箱暂不可用'; f.meetings = [{ ...meeting(), subject: '会议更新' }];
    const partial = await sync.refresh(); assert.match(partial.error, /邮箱/); assert.equal(partial.updated, 1);
    assert.equal(store.get(item.id).completedAt, completed.completedAt); assert.equal(store.get(item.id).deletedAt, null);
    assert.equal(published, 2);
    f.calendarError = ''; f.calendar[0].subject = '邮件改期'; f.calendar[0].changeKey = 'v2';
    await sync.refresh(); assert.equal(store.get(item.id).status, 'done'); assert.equal(store.get(item.id).title, '邮件改期');
    f.calendar[0].isCancelled = true; await sync.refresh(); assert.ok(store.get(item.id).deletedAt);
    f.calendar[0].isCancelled = false; await sync.refresh(); assert.equal(store.get(item.id).deletedAt, null); assert.equal(store.get(item.id).status, 'done');
  } finally { store.close(); }
});

test('only a complete matching window/source/account may remove missing events', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now, () => {}, () => 'me@example.com');
  try {
    await sync.refresh();
    const cached = store.all().find(t => t.external?.provider === 'calendar')!;
    const historical: Task = { ...cached, id: 'history', dateAt: '2026-11-14T06:00:00Z', endAt: '2026-11-14T07:00:00Z', external: { ...cached.external!, id: 'history' } };
    const local = store.create(newTask('本地待办')); store.put(historical);
    const legacy: Task = { ...historical, id: 'legacy-history', external: undefined };
    store.put(legacy); assert.ok(sync.visibleTasks(store.all()).some((t: Task) => t.id === legacy.id), 'legacy history remains visible without guessing its account');
    f.rawCalendar = JSON.stringify([appointment('new'), { broken: true }]); await sync.refresh(); assert.equal(store.get(cached.id).deletedAt, null);
    f.rawCalendar = undefined; f.calendar = []; await sync.refresh();
    assert.ok(store.get(cached.id).deletedAt); assert.equal(store.get('history').deletedAt, null); assert.equal(store.get(local.id).deletedAt, null);
    f.uid = 'z00999999'; await sync.refresh();
    assert.equal(store.get('history').deletedAt, null, 'another account never deletes the old account history');
    assert.ok(sync.visibleTasks(store.all()).every((t: Task) => !t.external || t.external.account.startsWith(f.uid)));
  } finally { store.close(); }
});

test('reminder claims can exclude another known account without marking its reminder delivered', () => {
  const store = new Store(':memory:');
  try {
    const task = store.create({ ...newTask('账号范围提醒'), dateAt: '2026-11-16', remindAt: '2026-11-16T11:59:00+08:00' });
    assert.equal(store.claimDue(new Date(now), () => false).length, 0);
    assert.equal(store.get(task.id).notifiedFor, null);
    assert.equal(store.claimDue(new Date(now), () => true).length, 1);
  } finally { store.close(); }
});

test('shared agenda keeps source errors with cached records, and lazy details respect changeKey and URL even when online flag is false', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now, () => {}, () => 'me@example.com');
  try {
    const agenda = await sync.agenda('2026-11-16', '2026-11-17');
    assert.equal(agenda.events.length, 2); const cal = agenda.events.find((e: any) => e.external.provider === 'calendar');
    assert.ok(cal.taskId); assert.equal(f.calls.some(args => args.includes('get')), false);
    const details = await sync.details(cal.taskId);
    assert.equal(details.onlineMeetingUrl, f.details.onlineMeetingUrl); assert.equal(details.requiredAttendees.length, 1);
    await sync.details(cal.taskId); assert.equal(f.calls.filter(args => args.includes('get')).length, 1);
    f.calendar[0].changeKey = 'v2'; f.details.changeKey = 'v2'; await sync.refresh(); await sync.details(cal.taskId);
    assert.equal(f.calls.filter(args => args.includes('get')).length, 2);
    f.calendarError = '连接超时'; const cached = await sync.agenda('2026-11-16', '2026-11-17');
    assert.equal(cached.sources.calendar.state, 'error'); assert.ok(cached.events.some((e: any) => e.taskId === cal.taskId));
    assert.equal(cached.events.find((e: any) => e.taskId === cal.taskId).cached, true);
    f.uid = 'z00999999'; await assert.rejects(sync.details(cal.taskId), /账号不一致/);
  } finally { store.close(); }
});

test('historical successful queries never report missing cached appointments as fresh or prune another window', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now, () => {}, () => 'me@example.com');
  try {
    await sync.refresh(); const original = store.all().find(t => t.external?.provider === 'calendar')!;
    const historical = { ...original, id: 'historical-cache', dateAt: '2026-11-14T06:00:00Z', endAt: '2026-11-14T07:00:00Z', external: { ...original.external!, id: 'historical-cache' } };
    store.put(historical); f.meetings = [];
    const result = await sync.agenda('2026-11-14', '2026-11-15');
    assert.equal(result.events.length, 0); assert.equal(result.sources.calendar.state, 'success');
    assert.equal(store.get(historical.id).deletedAt, null); assert.equal(store.get(original.id).deletedAt, null);
    f.uid = 'z00999999'; await sync.agenda('2026-11-14', '2026-11-15'); assert.equal(sync.status().syncing, false);
  } finally { store.close(); }
});

test('all-day, overnight and legacy records preserve semantics and old completion without a duplicate', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now, () => {}, () => 'me@example.com');
  try {
    const legacy: Task = { ...newTask('旧会议'), id: 'welink:1', kind: 'meeting', source: 'welink', welinkMeetingId: 1, dateAt: new Date(now + 7200000).toISOString(), endAt: new Date(now + 10800000).toISOString(), status: 'done', completedAt: new Date(now - 1000).toISOString(), createdAt: new Date(now - 2000).toISOString(), updatedAt: new Date(now - 2000).toISOString(), deletedAt: null, notifiedFor: null };
    store.put(legacy);
    f.calendar = [appointment('all-day', { isAllDay: true, start: '2026-11-16T00:00:00+08:00', end: '2026-11-17T00:00:00+08:00' }), appointment('overnight', { start: '2026-11-15T23:00:00+08:00', end: '2026-11-16T01:00:00+08:00' })];
    await sync.refresh();
    assert.equal(store.all().filter(t => t.external?.provider === 'meeting').length, 1); assert.equal(store.get(legacy.id).completedAt, legacy.completedAt);
    const day = store.all().find(t => t.external?.id === 'all-day')!; assert.equal(scheduleTimeRange(day), '全天'); assert.equal(day.remindAt, null); assert.equal(scheduledInRange(day, '2026-11-16'), true); assert.equal(scheduledInRange(day, '2026-11-17'), false);
    const overnight = store.all().find(t => t.external?.id === 'overnight')!; assert.equal(scheduledInRange(overnight, '2026-11-16'), true); assert.equal(scheduledInRange(overnight, '2026-11-17'), false);
    assert.equal((await sync.agenda('2026-11-16', '2026-11-17')).events.length, 3);
  } finally { store.close(); }
});

test('account change in flight or database write failure never partially replaces the cached snapshot', async () => {
  const { f, run } = fixture(), Sync = loadSync(async args => { const raw = await run(args); if (args[0] === 'meeting') f.uid = 'z00999999'; return raw; }), store = new Store(':memory:');
  try {
    const sync = new Sync(store, () => now, () => {}, () => 'me@example.com');
    assert.match((await sync.refresh()).error, /账号发生变化/); assert.equal(store.all(true).length, 0);
    const Working = loadSync(run), normal = new Working(store, () => now, () => {}, () => 'me@example.com');
    const put = store.put.bind(store); let calls = 0;
    store.put = task => { if (++calls === 2) throw new Error('写入失败'); return put(task); };
    assert.match((await normal.refresh()).error, /写入失败/); assert.equal(store.all(true).length, 0);
    store.put = put; assert.equal((await normal.refresh()).added, 2);
  } finally { store.close(); }
});
