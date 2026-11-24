import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { WelinkAgendaClient } from '../electron/welink-agenda';
import { agendaRange, dayMillis } from '../shared/welink-agenda';
import { Store } from '../modules/todo/store';
import { meetingContentTarget } from '../electron/welink-link';
import { welinkDisplayTasks } from '../shared/welink-display';
import { newTask, type Task } from '../shared/todo-contracts';
import { DEFAULT_APP_SETTINGS, welinkEmailForAccount } from '../shared/contracts';
import { scheduledInRange, scheduleTimeRange } from '../shared/todo-format';

const now = Date.parse('2026-11-16T12:00:00+08:00');
const appointment = (id = 'calendar-a', patch: Record<string, unknown> = {}) => ({ itemId: id, changeKey: 'v1', subject: '邮件邀请', start: '2026-11-16T14:00:00+08:00', end: '2026-11-16T15:00:00+08:00', location: '线上', isAllDay: false, isCancelled: false, ...patch });
const meeting = (id = 1) => ({ meetingId: id, subject: '会议系统安排', meetingStartTime: String(now + 7200000), meetingEndTime: now + 10800000, meetingNo: '900001' });
function fixture() {
  const f = { uid: 'z00123456', authStatus: '', calendarDay: '2026-11-16', calendar: [appointment()] as Record<string, unknown>[], meetings: [meeting()] as Record<string, unknown>[], calls: [] as string[][], calendarError: '', meetingError: '', rawCalendar: undefined as string | undefined, rawMeetings: undefined as string | undefined, details: { ...appointment(), organizer: '组织者', organizerEmail: 'host@example.com', requiredAttendees: ['成员 <member@example.com>'], optionalAttendees: [], body: '会议说明', isOnlineMeeting: false, onlineMeetingUrl: 'https://example.com/join?id=77' }, failWrite: false };
  const run = async (args: string[]) => {
    f.calls.push(args);
    if (args[0] === 'auth') return f.authStatus || `User Token: valid\nUID: ${f.uid}`;
    if (args[0] === 'mail') return 'Discovered EWS URL: https://example.com/EWS/Exchange.asmx';
    if (args.includes('get')) return JSON.stringify(f.details);
    if (args[0] === 'calendar') {
      if (f.calendarError) throw new Error(f.calendarError);
      return f.rawCalendar ?? JSON.stringify(args[args.indexOf('--start') + 1] === f.calendarDay ? f.calendar : []);
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
  new Function('require', 'module', 'exports', code)((name: string) => name === './welink-cli' ? { runWelink: run } : name.startsWith('./welink-') ? require('../electron/' + name.slice(2)) : require(name), mod, mod.exports);
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

test('CLI rate-limit errors with localized messages retry using their code', async () => {
  const { run } = fixture();
  const error = Object.assign(new Error('WeLink 请求过于频繁，请稍后重试。'), { code: 429 });
  const delays: number[] = [];
  let attempts = 0;
  const client = new WelinkAgendaClient(async args => {
    if (args[0] === 'calendar' && ++attempts < 3) throw error;
    return run(args);
  }, () => now, async ms => { delays.push(ms); });
  const result = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(result.sources.calendar.state, 'success');
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(attempts, 3);
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
  assert.equal(f.calls.some(args => args[0] === 'mail' || args[0] === 'onebox'), false);
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
  assert.equal(missing.sources.calendar.mailboxNeedsSetup, true);
  assert.equal(missing.sources.meeting.state, 'success');
  assert.equal((await client.query('2026-11-16', '2026-11-17', 'me@example.com')).sources.calendar.state, 'success');
  assert.ok(calls.findIndex(a => a[0] === 'calendar') < calls.findIndex(a => a[0] === 'mail'));
  assert.equal(calls.filter(a => a[0] === 'mail').length, 1);
  f.calendarError = '连接超时';
  const timeout = await client.query('2026-11-16', '2026-11-17', 'me@example.com');
  assert.equal(timeout.sources.calendar.mailboxNeedsSetup, undefined);
  assert.equal(calls.filter(a => a[0] === 'mail').length, 1);
  assert.equal(calls.filter(a => a[0] === 'onebox').length, 1);
});

test('an explicitly missing Exchange configuration reads the current profile and retries the calendar once', async () => {
  const { f, run } = fixture();
  f.calendarError = 'Exchange server domain not found';
  const client = new WelinkAgendaClient(async args => {
    if (args[0] === 'onebox') {
      f.calls.push(args);
      return JSON.stringify({ code: 200, data: { user: { email: 'bad-address', mail: 'me@example.com' } } });
    }
    if (args[0] === 'mail') f.calendarError = '';
    return run(args);
  }, () => now);
  const result = await client.query('2026-11-16', '2026-11-17', '');
  assert.equal(result.sources.calendar.state, 'success');
  assert.deepEqual(f.calls.filter(a => ['onebox', 'mail'].includes(a[0])), [['onebox', 'user-info'], ['mail', 'autodiscover', '--email', 'me@example.com']]);
  assert.equal(f.calls.filter(a => a[0] === 'calendar').length, 2);
});

test('a switch during profile discovery never configures the newly active account with the old address', async () => {
  const { f, run } = fixture();
  f.calendarError = 'EWS not configured';
  const client = new WelinkAgendaClient(async args => {
    if (args[0] === 'onebox') {
      f.uid = 'z00999999';
      return JSON.stringify({ email: 'old@example.com' });
    }
    return run(args);
  }, () => now);
  const result = await client.query('2026-11-16', '2026-11-17', '');
  assert.match(result.sources.calendar.error, /账号已切换/);
  assert.equal(result.sources.calendar.mailboxNeedsSetup, undefined);
  assert.equal(f.calls.some(args => args[0] === 'mail'), false);
});

test('calendar setup uses only saved addresses for the signed-in account and allows an explicit retry', async () => {
  const { f, run } = fixture(), store = new Store(':memory:');
  const oldUid = f.uid, saved = { ...DEFAULT_APP_SETTINGS, welinkEmail: 'old@example.com' };
  assert.equal(welinkEmailForAccount(saved, oldUid), '', 'legacy addresses have no verified owner');
  const settings = { ...saved, welinkEmailAccount: oldUid };
  const Sync = loadSync(async args => {
    if (args[0] === 'onebox') { f.calls.push(args); return '{}'; }
    return run(args);
  });
  const sync = new Sync(store, () => now, () => {}, (account: string) => welinkEmailForAccount(settings, account));
  try {
    f.calendarError = 'EWS not configured';
    await sync.refresh();
    assert.equal(sync.status().mailbox.source.mailboxNeedsSetup, true);
    await sync.refresh();
    assert.deepEqual(f.calls.filter(a => a[0] === 'mail').map(a => a[3]), ['old@example.com']);
    await sync.refresh(true);
    assert.deepEqual(f.calls.filter(a => a[0] === 'mail').map(a => a[3]), ['old@example.com', 'old@example.com']);
    f.uid = 'z00999999';
    await sync.week('2026-11-23', '2026-11-30', true);
    assert.deepEqual(f.calls.filter(a => a[0] === 'mail').map(a => a[3]), ['old@example.com', 'old@example.com']);
    assert.equal(f.calls.filter(a => a[0] === 'onebox').length, 1);
    assert.equal(sync.statusForAccount(oldUid).mailbox, undefined);
    assert.equal(sync.statusForAccount(f.uid).mailbox.source.mailboxNeedsSetup, true);
  } finally { store.close(); }
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
  f.meetings = [{ ...meeting(), meetingStartTime: now + 4 * 3600000, meetingEndTime: now + 5 * 3600000 }];
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

test('WeLink-only details use the meeting primary key, cache valid links and reject mismatched replies', async () => {
  const { f, run } = fixture(), store = new Store(':memory:');
  let clock = now, switchAccount = false;
  f.meetings = [meeting(83)];
  const info = {
    meetingId: 83,
    jumpUrls: [
      { type: 'basic', url: 'https://example.com/meeting-details' },
      { type: 'summary', url: 'javascript:alert(1)' },
      { type: 'summary', jumpUrl: 'https://example.com/meeting-summary' },
    ],
  };
  const Sync = loadSync(async args => {
    if (args[0] !== 'meeting' || args[1] !== 'info') return run(args);
    f.calls.push(args);
    if (switchAccount) f.uid = 'z00999999';
    return JSON.stringify({ code: 200, response: info });
  });
  const sync = new Sync(store, () => clock);
  const infoCalls = () => f.calls.filter(args => args[0] === 'meeting' && args[1] === 'info');
  try {
    await sync.refresh();
    const task = store.all().find(t => t.external?.provider === 'meeting')!;
    assert.deepEqual(infoCalls(), []);
    const detail = await sync.details(task.id);
    assert.equal(detail.meetingDetailsUrl, 'https://example.com/meeting-details');
    assert.equal(detail.meetingSummaryUrl, 'https://example.com/meeting-summary');
    assert.equal(detail.onlineMeetingUrl, '', 'details and minutes are not join URLs');
    assert.deepEqual(await sync.details(task.id), detail);
    assert.deepEqual(infoCalls(), [['meeting', 'info', '--meeting-id', '83']]);

    f.meetings[0].subject = '已改名的会议'; clock += 1000;
    await sync.refresh();
    info.meetingId = 84;
    await assert.rejects(sync.details(task.id), /标识不匹配/);
    info.meetingId = 83; switchAccount = true;
    await assert.rejects(sync.details(task.id), /账号已切换/);
    assert.equal(infoCalls().length, 3, 'the changed and failed details are not reused');
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

test('the calendar reads the displayed week, coalesces concurrent reads and retains a failed source', async () => {
  const { f, run } = fixture(), store = new Store(':memory:');
  const Sync = loadSync(async args => {
    const raw = await run(args);
    return args[0] === 'calendar' && raw === '[]' ? 'No events found.\r\n' : raw;
  });
  const start = '2026-11-23', end = '2026-11-30';
  const sync = new Sync(store, () => now, () => {}, () => '');
  try {
    assert.equal((await sync.week(start, end, false)).automatic, false);
    assert.deepEqual(f.calls, []);
    await sync.refresh();
    f.calls.length = 0; f.calendarDay = '2026-11-26'; f.meetings = [];
    f.calendar = [appointment('next-week', { start: f.calendarDay + 'T14:00:00+08:00', end: f.calendarDay + 'T15:00:00+08:00' })];
    const [first, concurrent] = await Promise.all([sync.week(start, end, false, true), sync.week(start, end, true)]);
    assert.equal(first.sources.calendar.state, 'success');
    assert.equal(first.sources.calendar.count, 1); assert.equal(concurrent.sources.calendar.count, 1);
    const days = f.calls.filter(a => a[0] === 'calendar').map(a => a[a.indexOf('--start') + 1]);
    assert.deepEqual(days, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    assert.ok(f.calls.filter(a => a[0] === 'meeting').every(a => a[a.indexOf('--meeting-start-time') + 1] === String(dayMillis(start)) && a[a.indexOf('--meeting-end-time') + 1] === String(dayMillis(end) - 1)));
    assert.ok(store.all().some(t => t.external?.id === 'calendar-a'));
    f.calendarError = '邮箱查询超时';
    const partial = await sync.week(start, end, false, true);
    assert.equal(partial.sources.meeting.state, 'success');
    assert.equal(partial.sources.calendar.state, 'error');
    assert.equal(partial.sources.calendar.lastSuccessAt, now);
    assert.equal(partial.sources.calendar.count, 1);
    assert.ok(store.all().some(t => t.external?.id === 'next-week'));
  } finally { store.close(); }
});

test('an expired WeLink login backs off and a successful login immediately retries the manually requested week', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:'); let clock = now;
  const sync = new Sync(store, () => clock);
  try {
    const start = '2026-11-23', end = '2026-11-30';
    f.authStatus = 'User Token: expired\nRefresh Token: expired';
    const missing = await sync.week(start, end, false, true);
    assert.equal(missing.connection, 'needs-login');
    assert.deepEqual(f.calls, [['auth', 'status']]);
    assert.equal((await sync.week(start, end, true)).connection, 'needs-login');
    clock += 20000; sync.poll(600000); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls, [['auth', 'status']]);
    f.authStatus = 'User Token: expired\nRefresh Token: valid\nUID: ' + f.uid;
    await sync.loginRecovered(false);
    assert.equal(sync.status().connection, 'ready');
    const reads = f.calls.filter(args => args[0] === 'meeting'
      && args[args.indexOf('--meeting-start-time') + 1] === String(dayMillis(start))
      && args[args.indexOf('--meeting-end-time') + 1] === String(dayMillis(end) - 1));
    assert.equal(reads.length, 1);
    const priorCalls = f.calls.length;
    assert.equal((await sync.week(start, end, false)).sources.calendar.state, 'success');
    assert.equal(f.calls.length, priorCalls);
    f.authStatus = 'Cannot connect to WeLink PC';
    assert.equal((await sync.week(start, end, true, true)).connection, 'client-closed');
    f.authStatus = 'Service unavailable';
    assert.equal((await sync.week(start, end, true, true)).connection, 'temporary');
  } finally { store.close(); }
});

test('background login recovery rereads the open week even when its previous result is still recent', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:'); let clock = now;
  const sync = new Sync(store, () => clock);
  try {
    const start = '2026-11-23', end = '2026-11-30';
    f.calendarDay = start; f.meetings = [];
    const times = { start: start + 'T14:00:00+08:00', end: start + 'T15:00:00+08:00' };
    f.calendar = [appointment('next-week', { ...times, subject: '原会议' })];
    await sync.week(start, end, true);
    clock += 10000; f.authStatus = 'Status: not authenticated';
    await sync.refresh();
    const callsBefore = f.calls.length;
    const blocked = await sync.week(start, end, true);
    assert.equal(blocked.connection, 'needs-login');
    assert.equal(blocked.sources.calendar.state, 'error');
    assert.equal(blocked.sources.calendar.lastSuccessAt, now);
    assert.equal(blocked.sources.calendar.count, 1);
    assert.equal(f.calls.length, callsBefore);
    clock += 1000; f.authStatus = '';
    f.calendar = [appointment('next-week', { ...times, subject: '恢复后更新的会议' })];
    await sync.loginRecovered(true);
    assert.equal(store.all().find(task => task.external?.id === 'next-week')?.title, '恢复后更新的会议');
    assert.equal((await sync.week(start, end, true)).sources.calendar.lastSuccessAt, clock);
  } finally { store.close(); }
});

test('a second source arriving after local completion preserves both originals and does not revive the reminder', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now);
  try {
    f.calendar = [appointment('calendar-a', { subject: '会议系统安排' })]; f.meetings = [];
    f.details.body = 'Meeting ID: 900001'; f.details.onlineMeetingUrl = 'https://example.com/join?id=900001';
    await sync.refresh();
    const item = store.all()[0];
    const completed = store.update(item.id, { status: 'done' }, item.updatedAt);
    f.meetings = [meeting()]; await sync.refresh();
    const originals = store.all();
    assert.deepEqual(originals.map(t => t.external?.id).sort(), ['1', 'calendar-a']);
    assert.ok(originals.every(t => t.status === 'done' && t.completedAt === completed.completedAt));
    assert.deepEqual(store.claimDue(new Date(now + 7300000)), []);
  } finally { store.close(); }
});

test('a dismissed reminder survives a source revision and a matching meeting source arriving later', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now);
  try {
    f.calendar = [appointment()]; f.meetings = [];
    f.details.body = 'Meeting ID: 900001'; f.details.onlineMeetingUrl = 'https://example.com/join?id=900001';
    await sync.refresh();
    const item = store.all()[0];
    store.dismissMeetingReminder(item.id);
    f.calendar = [appointment('calendar-a', { changeKey: 'v2', subject: '更新后的会议' })];
    f.details = { ...f.details, changeKey: 'v2', subject: '更新后的会议' };
    f.meetings = [meeting()]; await sync.refresh();
    const originals = store.all();
    assert.deepEqual(originals.map(t => t.external?.id).sort(), ['1', 'calendar-a']);
    assert.equal(store.get(item.id).title, '更新后的会议');
    assert.ok(originals.every(task => task.reminderDismissed && task.remindAt === null && task.status === 'todo'));
    assert.deepEqual(store.claimDue(new Date(now + 7300000)), []);
    assert.ok(!f.calls.some(args => args.includes('cancel') || args.includes('delete')));
  } finally { store.close(); }
});

test('limited detail prefetch verifies both sides of the match, honors revisions and claims one calendar reminder per pair', async () => {
  const { f, run } = fixture(), store = new Store(':memory:');
  const rows = Array.from({ length: 6 }, (_, i) => ({ calendar: appointment(`calendar-${i}`, { subject: `邮件邀请 ${i}` }),
    meeting: { ...meeting(i + 1), meetingNo: String(900001 + i), meetingStartTime: now + 7020000, meetingEndTime: now + 10620000 } }));
  f.calendar = [...rows.map(row => row.calendar), appointment('unrelated', { start: '2026-11-16T16:00:00+08:00', end: '2026-11-16T17:00:00+08:00' })];
  f.meetings = rows.map(row => row.meeting);
  const Sync = loadSync(async args => {
    if (args[0] === 'calendar' && args.includes('get')) {
      f.calls.push(args);
      const itemId = args[args.indexOf('--item-id') + 1];
      const row = rows.find(item => item.calendar.itemId === itemId)!;
      assert.ok(row, 'prefetch is restricted to timed cross-source candidates');
      return JSON.stringify({ ...row.calendar, body: `会议号：${row.meeting.meetingNo}`, onlineMeetingUrl: `https://example.com/join?id=${row.meeting.meetingNo}` });
    }
    return run(args);
  });
  const sync = new Sync(store, () => now);
  const gets = () => f.calls.filter(args => args[0] === 'calendar' && args.includes('get')).length;
  try {
    await sync.refresh();
    assert.equal(gets(), 5);
    assert.equal(store.all().filter(task => task.welinkLinkedTo).length, 0, 'an unread competing calendar can still be the real match');
    await sync.refresh();
    assert.equal(gets(), 6);
    const originals = store.all(), groups = welinkDisplayTasks(originals);
    assert.equal(originals.length, 13);
    assert.equal(groups.length, 7);
    const calendar = originals.find(task => task.external?.id === 'calendar-0')!;
    assert.equal(calendar.welinkLinkedTo?.id, '1');
    assert.equal(meetingContentTarget(calendar.id, originals)?.meetingId, '1');
    assert.deepEqual(store.claimDue(new Date(now + 7020000)), [], 'slightly earlier meeting-source rows wait for the calendar reminder');
    const due = store.claimDue(new Date(now + 7200000));
    assert.equal(due.length, 6);
    assert.ok(due.every(task => task.external?.provider === 'calendar'));
    assert.deepEqual(store.claimDue(new Date(now + 7200000)), []);
    store.unclaim(due[0]);
    assert.deepEqual(store.claimDue(new Date(now + 7200000)).map(task => task.id), [due[0].id]);
    f.calendarError = 'service unavailable';
    await sync.refresh();
    assert.equal(store.get(calendar.id).welinkLinkedTo?.id, '1', 'transient partial sync retains valid evidence');
    f.calendarError = '';
    rows[0].calendar.changeKey = 'v2';
    rows[0].meeting.meetingNo = '900002';
    await sync.refresh();
    assert.equal(gets(), 7);
    assert.equal(store.get(calendar.id).welinkLinkedTo, null, 'two plausible meeting IDs block reassociation');
    assert.equal(meetingContentTarget(calendar.id, store.all()), undefined);
  } finally { store.close(); }
});

test('the automatic sync and link verification share a 30-day China calendar window', async () => {
  const { f, run } = fixture(), Sync = loadSync(run), store = new Store(':memory:');
  const sync = new Sync(store, () => now);
  function setMeeting(day: string, id: number) {
    const start = `${day}T14:00:00+08:00`, end = `${day}T15:00:00+08:00`;
    const calendar = appointment(`calendar-${id}`, { start, end });
    f.calendarDay = day;
    f.calendar = [calendar];
    f.meetings = [{ ...meeting(id), meetingStartTime: String(Date.parse(start)), meetingEndTime: Date.parse(end) }];
    f.details = { ...f.details, ...calendar, body: '会议号：900001', onlineMeetingUrl: '' };
  }
  try {
    setMeeting('2026-12-15', 1);
    assert.equal((await sync.refresh()).added, 2);
    const listedDays = f.calls.filter(args => args[0] === 'calendar' && args.includes('list')).map(args => args[args.indexOf('--start') + 1]);
    assert.equal(listedDays.length, 30);
    assert.equal(listedDays[0], '2026-11-16');
    assert.equal(listedDays.at(-1), '2026-12-15');
    assert.equal(welinkDisplayTasks(store.all()).length, 1);

    setMeeting('2026-12-16', 2);
    assert.equal((await sync.week('2026-12-16', '2026-12-17', false, true)).error, '');
    assert.equal(store.all().length, 4);
    assert.equal(welinkDisplayTasks(store.all()).length, 3);
    assert.equal(f.calls.filter(args => args[0] === 'calendar' && args.includes('get')).length, 1);
  } finally { store.close(); }
});
