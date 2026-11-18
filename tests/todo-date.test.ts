import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Store } from '../modules/todo/store';
import { migrateTaskDates } from '../modules/todo/date-migration';
import { taskDay } from '../shared/todo-date';
import { newTask } from '../shared/todo-contracts';
import { isOverdue, scheduleStamp } from '../shared/todo-format';

test('CMO uses one optional date for no date, calendar date and timed deadline', () => {
  const store = new Store(':memory:');
  try {
    for (const dateAt of [null, '2026-12-15', '2026-12-15T23:59:00+08:00']) {
      const task = store.create({ ...newTask('事项'), dateAt });
      assert.equal(task.dateAt, dateAt);
      assert.equal(task.endAt, null);
      assert.equal(Object.hasOwn(task, 'plannedDate'), false);
      assert.equal(Object.hasOwn(task, 'dueAt'), false);
    }
    const undated = store.create(newTask('不设日期'));
    assert.equal(taskDay(undated), null);
    assert.equal(isOverdue(undated, new Date(2100, 0, 1).getTime()), false);
    assert.equal(scheduleStamp(undated), '未设置日期');
    const dateOnly = store.create({ ...newTask('日期'), dateAt: '2026-12-15' });
    assert.equal(isOverdue(dateOnly, new Date(2026, 11, 15, 23, 59, 59, 999).getTime()), false);
    assert.equal(isOverdue(dateOnly, new Date(2026, 11, 16).getTime()), true);
  } finally { store.close(); }
});

test('CMO v3 migration preserves WeLink identity, completion and reminder claims while backing up exact old records', () => {
  const db = new DatabaseSync(':memory:');
  const old = { id: randomUUID(), title: '外部会议', kind: 'meeting', plannedDate: '2026-09-20', dueAt: '2026-12-15T09:00:00+08:00', endAt: '2026-12-15T10:00:00+08:00', source: 'welink', welinkMeetingId: 42, external: { provider: 'calendar', account: 'fixture', itemId: 'item-42', isAllDay: false }, status: 'done', completedAt: '2026-12-15T03:00:00Z', remindAt: '2026-12-15T08:50:00+08:00', notifiedFor: '2026-12-15T08:50:00+08:00' };
  try {
    db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY,payload TEXT NOT NULL); PRAGMA user_version=3;');
    db.prepare('INSERT INTO tasks VALUES (?,?)').run(old.id, JSON.stringify(old));
    migrateTaskDates(db);
    const saved = JSON.parse((db.prepare('SELECT payload FROM tasks').get() as { payload: string }).payload);
    const { plannedDate, dueAt, ...unchanged } = old;
    assert.deepEqual(saved, { ...unchanged, dateAt: dueAt });
    assert.equal((db.prepare('SELECT payload FROM todo_date_backup_v3').get() as { payload: string }).payload, JSON.stringify(old));
    migrateTaskDates(db);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM todo_date_backup_v3').get() as { count: number }).count, 1);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  } finally { db.close(); }
});

test('CMO rolls back a bad migration without changing dates or the schema version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY,payload TEXT NOT NULL); PRAGMA user_version=3;');
    const raw = JSON.stringify({ id: 'fixture', plannedDate: 'invalid-date', dueAt: null });
    db.prepare('INSERT INTO tasks VALUES (?,?)').run('fixture', raw);
    assert.throws(() => migrateTaskDates(db));
    assert.equal((db.prepare('SELECT payload FROM tasks').get() as { payload: string }).payload, raw);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 3);
  } finally { db.close(); }
});
