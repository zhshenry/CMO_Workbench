import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../modules/todo/store';
import { newTask, type Task } from '../shared/todo-contracts';

// WeLink 会议信息在 CMO 不可编辑/删除，允许本地标记完成；字段和来源必须保留。
test('local task defaults to source=local and null welinkMeetingId', () => {
  const store = new Store(':memory:');
  try {
    const task = store.create(newTask('本地待办'));
    assert.equal(task.source, 'local');
    assert.equal(task.welinkMeetingId, null);
    const read = store.get(task.id);
    assert.equal(read.source, 'local');
    assert.equal(read.welinkMeetingId, null);
  } finally { store.close(); }
});

test('welink-synced meeting survives normalize round-trip with source and meetingId', () => {
  const store = new Store(':memory:');
  try {
    const now = '2026-11-10T09:00:00.000Z';
    const welink: Task = {
      ...newTask('海思元数据平台周例会'),
      id: 'welink:206581098', kind: 'meeting', source: 'welink', welinkMeetingId: 206581098,
      plannedDate: '2026-11-10', dueAt: '2026-11-10T01:20:00+08:00', endAt: '2026-11-10T02:30:00+08:00',
      remindAt: '2026-11-10T01:20:00+08:00',
      createdAt: now, updatedAt: now, completedAt: null, notifiedFor: null, deletedAt: null,
    };
    store.put(welink);
    const read = store.get('welink:206581098');
    assert.equal(read.source, 'welink');
    assert.equal(read.welinkMeetingId, 206581098);
    assert.equal(read.kind, 'meeting');
  } finally { store.close(); }
});

test('welink meeting cannot be edited or removed through store (must go via welink-cli)', () => {
  const store = new Store(':memory:');
  try {
    const now = '2026-11-10T09:00:00.000Z';
    const welink: Task = {
      ...newTask('数据使能组例会'),
      id: 'welink:211418738', kind: 'meeting', source: 'welink', welinkMeetingId: 211418738,
      plannedDate: '2026-11-10', dueAt: '2026-11-10T03:30:00+08:00', endAt: '2026-11-10T04:30:00+08:00',
      remindAt: '2026-11-10T03:30:00+08:00',
      createdAt: now, updatedAt: now, completedAt: null, notifiedFor: null, deletedAt: null,
    };
    store.put(welink);
    // 编辑被拦
    assert.throws(() => store.update('welink:211418738', { title: '改标题' }, now), /WeLink 同步的日程不能在 CMO 编辑/);
    // 删除被拦
    assert.throws(() => store.remove('welink:211418738', now), /WeLink 同步的日程不能在 CMO 删除/);
    // 直接 put 覆盖(同步轮询路径)仍然可行:WelinkSync 用 put 而非 update
    store.put({ ...welink, title: '更新后的例会', updatedAt: '2026-11-10T09:01:00.000Z' });
    assert.equal(store.get('welink:211418738').title, '更新后的例会');
    assert.equal(store.get('welink:211418738').source, 'welink');
  } finally { store.close(); }
});

test('update preserves source and welinkMeetingId for local tasks', () => {
  const store = new Store(':memory:');
  try {
    const task = store.create({ ...newTask('本地日程'), kind: 'meeting', plannedDate: '2026-11-10', dueAt: '2026-11-10T10:00:00+08:00', endAt: '2026-11-10T11:00:00+08:00' });
    const updated = store.update(task.id, { title: '改个名' }, task.updatedAt);
    assert.equal(updated.source, 'local');
    assert.equal(updated.welinkMeetingId, null);
  } finally { store.close(); }
});

test('WeLink completion changes only local status and completion metadata, including overnight meetings', () => {
  const store = new Store(':memory:');
  try {
    const now = '2026-11-11T00:00:00.000Z';
    const meeting: Task = { ...newTask('跨午夜同步会议'), id: 'welink:123', kind: 'meeting', source: 'welink', welinkMeetingId: 123,
      plannedDate: '2026-11-11', dueAt: '2026-11-11T23:30:00+08:00', endAt: '2026-11-12T00:30:00+08:00',
      remindAt: '2026-11-11T23:20:00+08:00', note: 'WeLink 原始会议信息', createdAt: now, updatedAt: now,
      completedAt: null, notifiedFor: null, deletedAt: null };
    store.put(meeting);
    const done = store.update(meeting.id, { status: 'done' }, meeting.updatedAt);
    assert.equal(done.status, 'done'); assert.ok(done.completedAt);
    const { status, completedAt, updatedAt, ...unchanged } = done;
    assert.deepEqual(unchanged, (({ status, completedAt, updatedAt, ...rest }) => rest)(meeting));
    assert.throws(() => store.update(meeting.id, { status: 'done' }, meeting.updatedAt), /已在其他操作中更新/);
    for (const patch of [{ status: 'todo' }, { status: 'done', title: '改标题' }, { status: 'done', source: 'local' },
      { status: 'done', welinkMeetingId: null }, { status: 'done', dueAt: null }]) {
      assert.throws(() => store.update(meeting.id, patch, done.updatedAt), /WeLink/);
      assert.deepEqual(store.get(meeting.id), done);
    }
    assert.equal(store.update(meeting.id, { status: 'done' }, done.updatedAt).completedAt, completedAt);
    assert.equal(store.due(new Date('2026-11-13T00:00:00+08:00')).length, 0);
  } finally { store.close(); }
});
