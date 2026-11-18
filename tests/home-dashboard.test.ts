import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPlacements, defaultDashboard, defaultWidget, findDashboardSlot, insertDashboardWidgetBefore, moveDashboardWidget, readDashboard, resizeDashboardHeight, WIDGET_IDS, WIDGET_STYLES, type DashboardLayout } from '../shared/dashboard-layout';
import { dashboardSummary } from '../shared/dashboard-summary';
import { localDay, newTask, type Task } from '../shared/todo-contracts';

test('看板只提供日程和待办、AI额度，保存顺序、尺寸、样式及主动清空的布局', () => {
  assert.deepEqual(WIDGET_IDS, ['today', 'quota']);
  assert.deepEqual(defaultDashboard().widgets, [defaultWidget('today'), defaultWidget('quota')]);
  for (const id of WIDGET_IDS) for (const style of WIDGET_STYLES[id]) {
    const layout = { widgets: [{ id, width: 6, rows: 4, style }] };
    assert.deepEqual(readDashboard(JSON.stringify(layout)), layout);
  }
  const layout = { widgets: [defaultWidget('quota'), { ...defaultWidget('today'), rows: 3, style: 'counts' }] };
  assert.deepEqual(readDashboard(JSON.stringify(layout)), layout);
  assert.deepEqual(readDashboard('{"widgets":[]}'), { widgets: [] });
  assert.deepEqual(readDashboard(null), defaultDashboard());
  assert.deepEqual(readDashboard('{broken'), defaultDashboard());
  assert.deepEqual(readDashboard('{"widgets":[null,{"id":"focus","width":2},{"id":"quota","width":2},{"id":"quota","width":6}]}'), { widgets: [defaultWidget('quota')] });
});

test('拖动排序和空白插入不改写原布局，卡片尺寸与样式跟随卡片', () => {
  const original = defaultDashboard(), snapshot = structuredClone(original);
  const moved = moveDashboardWidget(original, 'quota', 'today');
  assert.deepEqual(moved.widgets, [snapshot.widgets[1], snapshot.widgets[0]]);
  assert.deepEqual(insertDashboardWidgetBefore(original, 'quota', 'today'), moved);
  assert.deepEqual(insertDashboardWidgetBefore(original, 'today', null), moved);
  assert.equal(moveDashboardWidget(original, 'today', 'today'), original);
  assert.equal(insertDashboardWidgetBefore(original, 'quota', null), original);
  assert.deepEqual(original, snapshot);
});

test('顶部缩高固定底边，底部缩放固定顶部，位置与空白可持久化', () => {
  const original = defaultWidget('quota'), shrunk = resizeDashboardHeight(original, 1, 'top');
  assert.deepEqual(shrunk, { ...original, rows: 1, topOffset: 1 });
  assert.deepEqual(resizeDashboardHeight(shrunk, 2, 'top'), original);
  assert.equal(resizeDashboardHeight(shrunk, 3, 'top'), shrunk);
  assert.deepEqual(resizeDashboardHeight(original, 1, 'bottom'), { ...original, rows: 1 });
  const positioned = { ...original, position: { column: 3, top: 7 } };
  assert.deepEqual(resizeDashboardHeight(positioned, 1, 'top'), { ...positioned, rows: 1, position: { column: 3, top: 8 } });
  assert.deepEqual(readDashboard(JSON.stringify({ widgets: [positioned, shrunk] })), { widgets: [positioned] });
  for (const position of [{ column: -1, top: 1 }, { column: 6, top: 0 }, { column: 1, top: -1 }, { column: 1, top: '2' }]) {
    assert.deepEqual(readDashboard(JSON.stringify({ widgets: [{ ...original, position }] })).widgets, [original]);
  }
});

test('宽窗、两列和单列恢复布局时避开重叠并保留原始坐标', () => {
  const layout: DashboardLayout = { widgets: [{ ...defaultWidget('today'), position: { column: 0, top: 0 } }, { ...defaultWidget('quota'), position: { column: 4, top: 0 } }] };
  const snapshot = structuredClone(layout);
  for (const columns of [6, 2, 1]) {
    const [first, second] = dashboardPlacements(layout.widgets, columns, 80, 100, 12);
    assert.ok(first.column >= 0 && second.column + second.span <= columns);
    assert.ok(first.column + first.span <= second.column || second.top >= first.top + first.height + 12);
  }
  assert.deepEqual(layout, snapshot);
  assert.deepEqual(findDashboardSlot(0, 240, 4, 260, [{ id: 'today', column: 0, span: 4, top: 0, height: 260 }], 12, 80), { column: 0, top: 320 });
});

const clock = new Date(2026, 10, 14, 17);
const task = (id: string, patch: Partial<Task> = {}): Task => ({ ...newTask(id), id, createdAt: clock.toISOString(), updatedAt: clock.toISOString(), dateAt: '2026-11-14', completedAt: null, notifiedFor: null, deletedAt: null, ...patch });

test('近七天按计划日期统计，未来七天只统计未完成项，日程与任务分开', () => {
  const tasks = [task('today'), task('doing', { status: 'doing' }), task('past', { dateAt: '2026-11-13' }), task('older', { dateAt: '2026-11-01' }), task('future', { dateAt: '2026-11-15' }), task('meeting', { kind: 'meeting' }), task('done', { status: 'done', dateAt: '2026-11-13', completedAt: clock.toISOString() }), task('deleted', { deletedAt: clock.toISOString() }), task('old-meeting', { kind: 'meeting', dateAt: '2026-11-13' })];
  const snapshot = structuredClone(tasks), summary = dashboardSummary(tasks, clock);
  assert.deepEqual(summary.days.map(day => day.date), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.equal(summary.plannedCompleted, 1); assert.equal(summary.plannedPending, 3); assert.equal(summary.earlierPending, 1);
  assert.deepEqual(summary.upcomingDays.map(day => day.tasks), [2, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(summary.upcomingDays.map(day => day.meetings), [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(tasks, snapshot);
  const done = tasks.find(item => item.id === 'done')!;
  assert.equal(dashboardSummary([{ ...done, status: 'todo' }], clock).days[5].pending, 1);
});

test('跨年和本地零点保持连续日期，空数据表示真实零值', () => {
  const now = new Date(2027, 0, 2, 0, 1), yesterday = new Date(2027, 0, 1, 23, 59);
  const summary = dashboardSummary([task('midnight', { dateAt: localDay(yesterday), status: 'done', completedAt: yesterday.toISOString() })], now);
  assert.equal(summary.days[0].date, '2026-12-27'); assert.equal(summary.days[5].completed, 1); assert.equal(summary.days[6].completed, 0);
  assert.equal(dashboardSummary([], now).total, 0);
  assert.ok(dashboardSummary([], now).upcomingDays.every(day => !day.meetings && !day.tasks));
});
