import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { act, createElement, useState, type ComponentProps } from 'react';
import { JSDOM } from 'jsdom';
import { newTask, type Task } from '../shared/todo-contracts';
import type { TodoState } from '../shared/workbench-api';
import type { ScheduleTab } from '../modules/todo/ui/CalendarWorkspace';

test('the week grid keeps selection, navigation, task confirmation and the compact board', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Node', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name as keyof typeof dom.window] }));
  const hooks = registerHooks({ load(url, context, next) { return /\.(css|svg|png)$/.test(url) ? { format: 'module', source: 'export default "fixture-asset";', shortCircuit: true } : next(url, context); } });
  const { createRoot } = await import('react-dom/client');
  const { TodayBoard } = await import('../modules/todo/ui/TodayBoard');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const localTime = (day: string, time: string) => new Date(day + 'T' + time).toISOString();
  const makeTask = (id: string, day: string, start = '14:00', end?: string): Task => ({
    ...newTask(id), id, kind: end ? 'meeting' : 'task', dateAt: localTime(day, start), endAt: end ? localTime(day, end) : null,
    createdAt: localTime(day, start), updatedAt: localTime(day, start), completedAt: null, notifiedFor: null, deletedAt: null,
  });
  const todos = [makeTask('待回复', '2026-11-14')];
  const review = makeTask('方案评审', '2026-11-14', '14:00', '15:00');
  const next = makeTask('下周日程', '2026-11-16', '07:00', '08:00');
  const overlap = makeTask('并行讨论', '2026-11-14', '14:15', '14:45');
  const done = { ...makeTask('已完成的日程', '2026-11-14', '15:00', '16:00'), status: 'done' as const };
  const meeting = { ...makeTask('WeLink 评审', '2026-11-14', '16:00', '17:00'), source: 'welink' as const };
  const tasks: Task[] = [...todos, review, next, overlap, done,
    { ...meeting, id: 'ml', external: { provider: 'meeting', account: 'fixture', id: 'ml' } },
    { ...meeting, id: 'cl', external: { provider: 'calendar', account: 'fixture', id: 'cl' } },
    { ...meeting, id: 'all-day', title: '跨日计划', dateAt: localTime('2026-11-14', '00:00'),
      endAt: localTime('2026-11-16', '00:00'), external: { provider: 'calendar', account: 'fixture', id: 'all-day', isAllDay: true } },
  ];
  const writes: unknown[][] = [];
  type BoardProps = ComponentProps<typeof TodayBoard>;
  let props: BoardProps = {
    tasks, today: '2026-11-14', categoryById: new Map(), planView: 'rows', mutating: false, toolbar: null,
    api: { create: async () => ({} as TodoState), remove: async () => ({} as TodoState), createCategory: async () => ({} as TodoState),
      update: async (...args) => { writes.push(args); return {} as TodoState; } },
    mutate: async action => { await action(); }, setEditor() {},
  };
  function Workspace(input: BoardProps) {
    const [tab, setTab] = useState<ScheduleTab>('calendar');
    return createElement(TodayBoard, { ...input, workspace: {
      tab, onTab: setTab,
      details: task => createElement('span', { 'data-source-count': task.displaySources?.length }, '日程操作'),
    } });
  }
  const render = async () => act(async () => root.render(createElement(Workspace, props)));
  const doc = dom.window.document;
  const button = (label: string) => {
    const node = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label);
    assert.ok(node, 'Button ' + label);
    return node;
  };
  const click = async (target: HTMLButtonElement | string) => act(async () => (typeof target === 'string' ? button(target) : target).click());
  const block = (id: string) => doc.querySelector<HTMLButtonElement>('.calendar-event[data-task-id="' + id + '"]');
  const dates = () => [...doc.querySelectorAll<HTMLButtonElement>('.calendar-date-headers [data-date]')].map(node => node.dataset.date);
  const heading = () => doc.querySelector('.calendar-detail h2')?.textContent;
  const pressDateKey = async (date: string, key: string) => act(async () => {
    button(date).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
  });

  try {
    await render();
    assert.deepEqual(dates(), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    assert.equal(doc.querySelector('[aria-current="date"]')?.getAttribute('data-date'), props.today);
    assert.equal(block(review.id)?.style.getPropertyValue('--event-y'), '60%');
    assert.equal(block(review.id)?.style.getPropertyValue('--event-width'), '50%');
    assert.equal(block(overlap.id)?.style.getPropertyValue('--event-x'), '50%');
    assert.equal(block(done.id), null);
    assert.equal(doc.querySelectorAll('.calendar-all-day [data-task-id="all-day"]').length, 2);
    assert.equal(block('ml'), null);
    assert.ok(block('cl'));
    await click(block('cl')!);
    assert.equal(heading(), 'WeLink 评审');
    assert.ok(doc.querySelector('.calendar-detail [data-source-count="2"]'));

    await click(block(review.id)!);
    assert.equal(heading(), review.title);
    assert.equal(doc.querySelector('.calendar-workspace')?.getAttribute('data-detail-open'), 'true');
    const week = dates();
    await click('返回周历');
    assert.deepEqual(dates(), week);
    assert.equal(block(review.id)?.getAttribute('aria-pressed'), 'true');

    await click('待办 1 项');
    assert.equal(button('待办').getAttribute('aria-pressed'), 'true');
    await click('完成 待回复');
    assert.deepEqual(writes, []);
    await click('确认完成');
    assert.deepEqual(writes, [[todos[0].id, { status: 'done' }, todos[0].updatedAt]]);
    await click('日程');
    assert.equal(block(review.id)?.getAttribute('aria-pressed'), 'true');

    await pressDateKey('2026-11-15', 'ArrowRight');
    assert.equal(dates()[0], '2026-11-16');
    assert.equal(doc.activeElement?.getAttribute('data-date'), '2026-11-16');
    assert.equal(block(next.id)?.style.getPropertyValue('--event-y'), '0%');
    await click('2026-11-16');
    assert.deepEqual(dates(), ['2026-11-16']);
    await click('下一天');
    assert.deepEqual(dates(), ['2026-11-17']);
    assert.match(doc.querySelector('.calendar-empty')!.textContent!, /当天没有日程/);
    await click('周');
    await click('上一周');
    assert.equal(dates()[0], '2026-11-09');
    await click('今天');
    props = { ...props, today: '2026-12-31' };
    await render();
    assert.deepEqual(dates().slice(0, 1).concat(dates().slice(-1)), ['2026-12-28', '2027-01-03']);
    assert.match(button('选择日程日期').textContent!, /12月28日.*2027年1月3日/);
    assert.equal(writes.length, 1, 'view changes do not write to the task store');

    await act(async () => root.render(createElement(TodayBoard, { ...props, today: '2026-11-14' })));
    assert.deepEqual([...doc.querySelectorAll('.today-board > section')].map(node => node.getAttribute('aria-label')), ['待办', '日程']);
    assert.equal(doc.querySelector('.calendar-board'), null);
    assert.ok(doc.querySelector('.plan-folder-tab'));
  } finally {
    await act(async () => root.unmount()); hooks.deregister(); dom.window.close();
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
