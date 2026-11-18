import assert from 'node:assert/strict';
import test from 'node:test';
import { welinkDisplayEvents, welinkDisplayTasks } from '../shared/welink-display';
import { newTask, type Task } from '../shared/todo-contracts';
import type { WelinkEvent } from '../shared/welink-agenda';
import { dashboardSummary } from '../shared/dashboard-summary';

const event = (provider: 'calendar' | 'meeting', id: string, patch: Partial<WelinkEvent> = {}): WelinkEvent => ({
  taskId: id, external: { provider, account: 'z00123456', id }, title: '项目：评审', start: '2026-11-17T10:00:00+08:00', end: '2026-11-17T11:00:00+08:00', location: '', cancelled: false, ...patch,
});

test('cross-source display pairs normalize titles and tolerate one minute while preserving both originals', () => {
  const rows = [event('meeting', 'm'), event('calendar', 'c', { title: '项目 评审', start: '2026-11-17T10:01:00+08:00' })], before = structuredClone(rows);
  const result = welinkDisplayEvents(rows);
  assert.equal(result.length, 1); assert.equal(result[0].primary.taskId, 'c');
  assert.deepEqual(result[0].sources, rows); assert.deepEqual(rows, before);
});

test('display matching never merges accounts, two same-source events, different durations, or all-day with timed events', () => {
  const a = event('meeting', 'm');
  for (const b of [event('meeting', 'm2'), event('calendar', 'c', { external: { provider: 'calendar', account: 'another', id: 'c' } }),
    event('calendar', 'c', { end: '2026-11-17T11:02:00+08:00' }), event('calendar', 'c', { external: { provider: 'calendar', account: 'z00123456', id: 'c', isAllDay: true } })]) {
    assert.equal(welinkDisplayEvents([a, b]).length, 2);
  }
  assert.equal(welinkDisplayEvents([a, event('calendar', 'c'), event('calendar', 'c2')]).length, 2, 'one source record participates in at most one pair');
});

test('task display retains original IDs, completion state and local records without modifying storage-shaped data', () => {
  const rows: Task[] = [event('meeting', 'm'), event('calendar', 'c')].map(row => ({ ...newTask(row.title), id: row.taskId!, kind: 'meeting', source: 'welink', dateAt: row.start, endAt: row.end, external: row.external, createdAt: row.start, updatedAt: row.start, completedAt: null, deletedAt: null, notifiedFor: null }));
  const local: Task = { ...rows[0], id: 'local', source: 'local', external: undefined };
  const original = structuredClone(rows);
  const display = welinkDisplayTasks([...rows, local]);
  assert.equal(display.length, 2);
  assert.deepEqual(display[0].displaySources?.map(source => source.taskId), ['m', 'c']);
  assert.equal(display[0].id, 'c'); assert.equal(display[1].id, 'local');
  assert.deepEqual(rows, original); assert.equal(rows[0].displaySources, undefined);
  assert.equal(welinkDisplayTasks(rows.map(row => ({ ...row, endAt: null }))).length, 1);
  assert.equal(welinkDisplayTasks([{ ...rows[0], endAt: null }, rows[1]]).length, 2);
  assert.equal(dashboardSummary(rows.map(row => ({ ...row, dateAt: '2026-11-17' })), new Date('2026-11-17T10:00:00+08:00')).upcomingDays[0].meetings, 1);
});
