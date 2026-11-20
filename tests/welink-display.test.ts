import assert from 'node:assert/strict';
import test from 'node:test';
import { welinkDisplayEvents, welinkDisplayTasks, welinkMeetingPeer } from '../shared/welink-display';
import { newTask, type Task } from '../shared/todo-contracts';
import type { WelinkEvent } from '../shared/welink-agenda';
import { dashboardSummary } from '../shared/dashboard-summary';
import { Store } from '../modules/todo/store';

const start = '2026-11-17T10:00:00+08:00', end = '2026-11-17T11:00:00+08:00';
const event = (provider: 'calendar' | 'meeting', id: string, patch: Partial<WelinkEvent> = {}): WelinkEvent => ({
  taskId: id, external: { provider, account: 'z00123456', id }, title: '项目：评审', start, end, location: '', cancelled: false, ...patch,
});
const link = { provider: 'meeting' as const, id: 'm', meetingNo: '900001', verifiedAt: start };
const meeting = () => event('meeting', 'm', { meetingNo: link.meetingNo });
const calendar = (patch?: Partial<WelinkEvent>) => event('calendar', 'c', { welinkLinkedTo: link, ...patch });
const tasks = (rows: WelinkEvent[]): Task[] => rows.map(row => ({
  ...newTask(row.title), id: row.taskId!, kind: 'meeting', source: 'welink', dateAt: row.start, endAt: row.end, external: row.external, welinkMeetingNo: row.meetingNo,
  welinkLinkedTo: row.welinkLinkedTo, createdAt: row.start, updatedAt: row.start, completedAt: null, deletedAt: null, remindAt: row.start, notifiedFor: null,
}));

test('cross-source display trusts the verified link across different titles and preserves both originals', () => {
  const rows = [meeting(), calendar({ title: '【会议通知】项目 评审', start: '2026-11-17T10:04:00+08:00' })], before = structuredClone(rows);
  const result = welinkDisplayEvents(rows);
  assert.equal(result.length, 1); assert.equal(result[0].primary.taskId, 'c');
  assert.deepEqual(result[0].sources, [rows[1], rows[0]]); assert.deepEqual(rows, before);
});

test('display matching rejects an unverified link, a different account, a revised calendar and an ambiguous or shifted occurrence', () => {
  const a = meeting();
  for (const b of [event('meeting', 'm2'), event('calendar', 'c'), calendar({ external: { provider: 'calendar', account: 'another', id: 'c' } }),
    calendar({ external: { provider: 'calendar', account: a.external.account, id: 'c', changeKey: 'updated' } }),
    calendar({ end: '2026-11-17T11:06:00+08:00' }), calendar({ external: { provider: 'calendar', account: a.external.account, id: 'c', isAllDay: true } })]) {
    assert.equal(welinkDisplayEvents([a, b]).length, 2);
  }
  assert.equal(welinkDisplayEvents([a, calendar(), event('meeting', 'm2', { meetingNo: a.meetingNo })]).length, 3);
});

test('task display retains original IDs, completion state and local records without modifying storage-shaped data', () => {
  const rows = tasks([meeting(), calendar()]);
  const local: Task = { ...rows[0], id: 'local', source: 'local', external: undefined };
  const original = structuredClone(rows);
  const display = welinkDisplayTasks([...rows, local]);
  assert.equal(display.length, 2);
  assert.deepEqual(display[0].displaySources?.map(source => source.taskId), ['c', 'm']);
  assert.equal(display[0].id, 'c'); assert.equal(display[1].id, 'local');
  assert.deepEqual(rows, original); assert.equal(rows[0].displaySources, undefined);
  assert.equal(welinkDisplayTasks(rows.map(row => ({ ...row, endAt: null }))).length, 2);
  assert.equal(welinkDisplayTasks([{ ...rows[0], endAt: null }, rows[1]]).length, 2);
  assert.equal(dashboardSummary(rows, new Date(start)).upcomingDays[0].meetings, 1);
});

test('calendar-only display grouping leaves completion and reminder claims independent', () => {
  const store = new Store(':memory:'), rows = tasks([event('calendar', 'c'), event('calendar', 'c2')]);
  try {
    rows.forEach(row => store.put(row));
    const grouped = welinkDisplayTasks(rows);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].displaySources?.length, 2);
    assert.equal(welinkMeetingPeer(rows[0], rows), undefined);
    assert.equal(store.claimDue(new Date(start)).length, 2);
    store.update('c', { status: 'done' });
    assert.equal(store.get('c2').status, 'todo');
  } finally { store.close(); }
});
