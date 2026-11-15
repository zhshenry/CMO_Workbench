import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { initialIslandData, type IslandState } from '../shared/island-contracts';
import { localDay, newTask, type Task } from '../shared/todo-contracts';

test('WeLink source badges follow the record through home, library, details and the expanded island', async t => {
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
    welinkMeetingId: source === 'welink' ? 123 : null, categoryId: category.id, plannedDate: today,
    dueAt: new Date(now + 600000).toISOString(), endAt: new Date(now + 2400000).toISOString(),
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
    "export { DesktopIslandApp as DesktopIsland } from './src/views/DesktopIsland';",
  ].join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' } }).outputFiles[0].text;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const { TodayBoard, TaskLibrary, TaskEditor, DesktopIsland } = module.exports;
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
