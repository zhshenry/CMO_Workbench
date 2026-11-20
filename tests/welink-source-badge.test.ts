import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { initialIslandData, type IslandState } from '../shared/island-contracts';
import { localDay, newTask, type Task } from '../shared/todo-contracts';
import type { WelinkEventDetails } from '../shared/welink-agenda';
import type { MeetingContentQuery } from '../shared/weclaw-content';

test('WeLink source badges follow the record through home, library, details and the expanded island', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 17, 12).getTime() });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} disconnect() {} } : dom.window[name] }));
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  dom.window.HTMLElement.prototype.hidePopover = () => {};
  dom.window.HTMLElement.prototype.showPopover = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const now = Date.now(), today = localDay(new Date(now));
  const category = { id: 'd786779b-ecc1-4d9c-a603-1cb9d1e7d28a', name: '工作分类', color: '#4a67a3' };
  const meeting = (id: string, source: Task['source']): Task => ({
    ...newTask(source === 'welink' ? '同步项目例会' : '本地讨论'), id, kind: 'meeting', source,
    welinkMeetingId: source === 'welink' ? 123 : null, categoryId: category.id, dateAt: new Date(now + 600000).toISOString(), endAt: new Date(now + 2400000).toISOString(),
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), completedAt: null, deletedAt: null, notifiedFor: null,
  });
  const tasks = [meeting('welink:123', 'welink'), meeting('local-meeting', 'local')];
  const data = { tasks, categories: [category] };
  let state: IslandState = { ...initialIslandData(), mode: 'expanded', pinned: true, quiet: false, fullscreenDetection: true };
  state.settings = { ...state.settings, dock: 'right', lastPage: 'schedule', hoverPreview: false };
  const listeners = new Set<(value: IslandState) => void>(), opened: unknown[] = [], edited: string[] = [];
  const unchanged = async () => data;
  const api = { create: unchanged, update: unchanged, remove: unchanged, createCategory: unchanged };
  Object.defineProperty(dom.window, 'workbench', { value: {
    island: {
      state: async () => structuredClone(state), onError: () => () => {}, hold() {}, quotas: async () => [],
      onChanged: (listener: (value: IslandState) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      mode: async (mode: IslandState['mode']) => { state = { ...state, mode }; listeners.forEach(listener => listener(structuredClone(state))); },
      navigate: async (target: unknown) => { opened.push(target); },
    },
    todo: { state: unchanged, onChanged: () => () => {}, update: unchanged },
  } });
  const module = { exports: {} as any }, require = createRequire(import.meta.url);
  const code = buildSync({ stdin: { contents: [
    "export { TodayBoard } from './modules/todo/ui/TodayBoard';",
    "export { TaskLibrary } from './modules/todo/ui/TaskLibrary';",
    "export { TaskEditor } from './modules/todo/ui/TaskEditor';",
    "export { WelinkScheduleDetails } from './src/views/WelinkSchedule';",
    "export { DesktopIslandApp as DesktopIsland } from './src/views/DesktopIsland';",
  ].join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' } }).outputFiles[0].text;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const { TodayBoard, TaskLibrary, TaskEditor, DesktopIsland, WelinkScheduleDetails } = module.exports;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const click = async (element: Element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const badges = () => [...document.querySelectorAll('.task-source-badge')].map(element => element.textContent);
  t.after(async () => {
    await act(async () => root.unmount());
    assert.equal(listeners.size, 0);
    dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!); else Reflect.deleteProperty(globalThis, name); });
  });

  await t.test('home keeps the source separate from categories and badge clicks still open the meeting', async () => {
    await act(async () => root.render(createElement(TodayBoard, { tasks, today, categoryById: new Map([[category.id, category]]), planView: 'rows', mutating: false, api, mutate() {}, setEditor: (task: Task) => edited.push(task.id), toolbar: null })));
    await click(document.querySelector('.plan-folder-tab')!);
    assert.deepEqual(badges(), ['WeLink']);
    assert.equal(document.querySelectorAll('.plan-meta .plan-category').length, 2);
    assert.ok([...document.querySelectorAll('.plan-category')].every(element => element.textContent === category.name));
    assert.match(document.querySelector('.task-source-badge')!.closest('button')!.getAttribute('aria-label')!, /来源 WeLink/);
    await click(document.querySelector('.task-source-badge')!);
    assert.equal(edited.at(-1), tasks[0].id);
  });

  await t.test('library labels only synced meetings and leaves filtering and editing intact', async () => {
    await act(async () => root.render(createElement(TaskLibrary, { ...data, api: { update: unchanged, restore: unchanged }, changed() {}, edit: (task: Task) => edited.push(task.id), close() {} })));
    assert.deepEqual(badges(), ['WeLink']);
    assert.equal(document.querySelectorAll('.library-task-main').length, 2);
    assert.ok([...document.querySelectorAll('.library-task-main > span')].every(element => element.textContent?.includes(category.name)));
    await click(document.querySelector('.task-source-badge')!);
    assert.equal(edited.at(-1), tasks[0].id);
  });

  await t.test('details show a concise source and readonly badge without restoring the removed explanation', async () => {
    const props = { categories: data.categories, api, close() {}, saved() {}, changed() {} };
    await act(async () => root.render(createElement(TaskEditor, { ...props, task: tasks[0], key: tasks[0].id })));
    assert.deepEqual(badges(), ['WeLink · 只读']);
    assert.ok(document.querySelector('.modal-heading-lead > .task-source-badge'));
    assert.equal(document.querySelector('fieldset')!.disabled, true);
    assert.equal(document.querySelector('[type="submit"]'), null);
    assert.equal(document.querySelector('.welink-readonly-notice'), null);
    await act(async () => root.render(createElement(TaskEditor, { ...props, task: tasks[1], key: tasks[1].id })));
    assert.deepEqual(badges(), []);
    assert.equal(document.querySelector('fieldset')!.disabled, false);
  });

  await t.test('mail calendar details stay readonly and load only on demand, including URLs with a false online flag', async () => {
    let reads = 0;
    const links: string[] = [];
    const bridge = dom.window.workbench as any;
    bridge.island.welinkDetails = async () => { reads++; return { subject: '邮件邀请', location: '线上', organizer: '组织者', organizerEmail: 'host@example.com', requiredAttendees: ['参会人'], optionalAttendees: [], body: '<img src=x onerror=alert(1)>', onlineMeetingUrl: 'https://example.com/join', isAllDay: true, isCancelled: false }; };
    bridge.ai = { openLink: async (url: string) => { links.push(url); } };
    const calendar: Task = { ...tasks[0], id: 'calendar-details', external: { provider: 'calendar', account: 'demo:me@example.com', id: 'item-a', isAllDay: true } };
    await act(async () => root.render(createElement(TaskEditor, { task: calendar, categories: [], api, close() {}, saved() {}, changed() {} })));
    assert.deepEqual(badges(), ['邮箱日历 · 只读']);
    assert.equal(reads, 0);
    assert.equal(document.querySelector('fieldset')!.disabled, true);
    const button = [...document.querySelectorAll<HTMLButtonElement>('.calendar-event-details button')].find(b => b.textContent === '读取详情')!;
    await click(button);
    assert.equal(reads, 1);
    assert.equal(document.querySelector('.calendar-event-body img'), null, 'the body is text, never executable HTML');
    assert.match(document.querySelector('.calendar-event-body')!.textContent!, /onerror/);
    const join = [...document.querySelectorAll<HTMLButtonElement>('.calendar-event-details button')].find(b => b.textContent === '加入会议')!;
    await click(join); assert.deepEqual(links, ['https://example.com/join']);
    assert.equal(document.querySelector('[type="submit"]'), null);
  });

  await t.test('visible WeLink details load automatically and retain list details during failure', async () => {
    const task: Task = { ...tasks[0], external: { provider: 'meeting', account: 'demo', id: '123' }, welinkMeetingNo: '900001', note: '研发会议室' };
    const bridge = dom.window.workbench as any;
    const links: string[] = [], reads: string[] = [];
    bridge.island.welinkDetails = async (id: string): Promise<WelinkEventDetails> => {
      reads.push(id);
      if (reads.length === 1) throw new Error('WeLink 会议详情暂不可用');
      return {
        subject: task.title, location: '', organizer: '', organizerEmail: '', requiredAttendees: [], optionalAttendees: [],
        body: '', onlineMeetingUrl: '', isAllDay: false, isCancelled: false,
        meetingDetailsUrl: 'https://example.com/details', meetingSummaryUrl: 'https://example.com/summary',
      };
    };
    bridge.ai = { openLink: async (url: string) => { links.push(url); } };
    const button = (label: string) => [...document.querySelectorAll('button')].find(candidate => candidate.textContent === label);
    const render = (visible: boolean) => act(async () => root.render(createElement(WelinkScheduleDetails, { task, meeting: task, visible })));
    await render(false);
    assert.deepEqual(reads, []);
    assert.equal(button('展开会议详情'), undefined);
    await render(true);
    assert.deepEqual(reads, [task.id]);
    assert.match(document.body.textContent!, /900001.*研发会议室/);
    await click(button('重试会议详情')!);
    await render(false);
    await render(true);
    assert.deepEqual(reads, [task.id, task.id]);
    assert.equal(button('加入会议'), undefined);
    await click(button('查看 WeLink 原始详情')!);
    await click(button('查看 WeLink 纪要')!);
    assert.deepEqual(links, ['https://example.com/details', 'https://example.com/summary']);
  });

  await t.test('post-meeting materials load independently, suppress a different occurrence and offer explicit candidate selection', async () => {
    const task: Task = { ...tasks[0], id: 'content', external: { provider: 'calendar', account: 'demo', id: 'demo-calendar' },
      dateAt: new Date(now - 3600000).toISOString(), endAt: new Date(now - 600000).toISOString() };
    const peer: Task = { ...task, id: 'meeting-detail', external: { provider: 'meeting', account: 'demo', id: '123' } };
    const calls: MeetingContentQuery[] = [];
    const bridge = dom.window.workbench as any, wrong = new Date(now - 86400000).toISOString(), candidate = 'a'.repeat(32);
    bridge.island.welinkMeetingContent = async (query: MeetingContentQuery) => {
      calls.push(query);
      if (query.material === 'transcript') return { transcript: query.refresh ? { status: 'candidates', candidates: [{ id: candidate, subject: task.title, start: task.dateAt }] }
        : query.candidate ? { status: 'ready', text: '已核验的本场逐字稿' } : { status: 'wrong-session', actualTime: wrong } };
      return { minutes: { status: 'ready', text: '<img src=x onerror=alert(1)> 本场纪要' } };
    };
    const render = (time: number, expanded = false) => act(async () => root.render(createElement(WelinkScheduleDetails, {
      key: 'materials', task, meeting: peer, now: time, visible: false,
      controls: { expanded, panelId: 'schedule-detail', entry: { current: null }, open: () => {} },
    })));
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const panel = () => document.querySelector('[role="tabpanel"]:not([hidden])')!;
    const entry = () => [...document.querySelectorAll('button')].find(button => button.textContent === '查看会议资料');
    const open = (name: string) => click(tabs().find(tab => tab.textContent === name)!);
    await render(now - 900000);
    assert.equal(entry(), undefined);
    await render(now);
    assert.ok(entry());
    assert.equal(calls.length, 0);
    await render(now, true);
    assert.deepEqual(tabs().map(tab => tab.textContent), ['日程信息', '纪要', 'AI 听', 'WeNote 笔记']);
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    assert.deepEqual(calls.map(query => query.material), ['minutes']);
    assert.match(panel().textContent!, /本场纪要/);
    assert.equal(document.querySelector('.calendar-meeting-text img'), null);
    await open('AI 听');
    assert.match(panel().textContent!, /已隐藏正文/);
    await click(document.querySelector('button[aria-label="重新读取AI 听"]')!);
    await click(document.querySelector('.calendar-meeting-candidates button')!);
    assert.equal(calls.at(-1)?.candidate, candidate);
    assert.match(panel().textContent!, /已核验的本场逐字稿/);
    await open('日程信息');
    assert.doesNotMatch(panel().textContent!, /逐字稿/);
    await open('纪要');
    assert.match(panel().textContent!, /本场纪要/);
    assert.equal(calls.filter(query => query.material === 'minutes').length, 1);
  });

  await t.test('expanded island identifies the source and opens the original record; collapsed summaries stay compact', async () => {
    await act(async () => root.render(createElement(DesktopIsland)));
    assert.deepEqual(badges(), ['WeLink']);
    assert.equal(document.querySelectorAll('.island-agenda-item').length, 2);
    await click(document.querySelector('.island-agenda-item .task-source-badge')!);
    assert.deepEqual(opened.at(-1), { view: 'todo', taskId: tasks[0].id });
    state = { ...state, mode: 'collapsed' };
    await act(async () => listeners.forEach(listener => listener(structuredClone(state))));
    assert.equal(document.querySelector('.island-summary-details .task-source-badge'), null);
  });
});
