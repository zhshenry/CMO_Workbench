import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { officeAutomationSchema, type OfficeCommitment, type OfficeConversationPage, type OfficeCoverage, type OfficeMaterialRow, type OfficeScene, type OfficeSnapshot, type OfficeTodoWrite } from '../shared/office-workbench';
import { newTask, type Task } from '../shared/todo-contracts';

test('office inbox writes edited follow-ups directly and shows W3 independently of WeLink', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] }));
  const coverage: OfficeCoverage = { state: 'fresh', lastSuccessAt: null, scope: '测试资料' };
  const old: OfficeCommitment = {
    kind: 'commitment', id: 'old', title: '上周答应交方案', reason: '我下周三交方案', deadline: '2026-11-25',
    followUp: { nextStep: '提交方案', reason: '承诺仍有效', evidence: '我下周三交方案' },
    source: { id: 'saved-source', label: '查看群消息' }, recordedAt: 1, status: 'open',
  };
  const completed = { ...old, id: 'completed', title: '已经完成的承诺', status: 'done' };
  let connected = true, accountKey = 'office-account', portalLinked = false, linked: Task | undefined;
  const todoId = 'linked-office-todo';
  const writes: OfficeTodoWrite[] = [], analyses: { scene: OfficeScene; label: string }[] = [];
  const opened: string[] = [];
  const listeners = new Set<() => void>();
  const listen = (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); };
  const changed = () => listeners.forEach(callback => callback());
  const noop = () => () => {};
  const portalState = () => ({ status: 'ready', items: [
    { id: 'w3-todo', kind: 'todo', title: '评审权限申请', system: '权限系统', url: 'https://fixture.invalid/todo', ...(portalLinked && { taskId: 'w3-todo' }) },
    { id: 'w3-apply', kind: 'apply', title: '我提交的申请', system: '权限系统', person: '当前处理人' },
  ] });
  Object.assign(window, { workbench: {
    officeWorkbench: {
      state: async () => ({ accountKey, connected, day: '2026-11-20', materials: [], items: [{ ...old, id: 'rule-only', title: '规则候选应留在资料页', followUp: undefined }],
        followUps: { items: [], pending: 1 },
        coverage: { messages: coverage, mail: coverage, agenda: coverage }, unreadMail: coverage, brief: { priorities: [], meetings: [] } }),
      workflow: async () => ({ accountKey: 'office-account', connected, settings: officeAutomationSchema.parse({}), days: [], notices: [],
        commitments: [old, completed], todoTasks: linked ? { [old.id]: linked } : {} }),
      review: async () => ({ reviewed: 0, remaining: 1, error: '模拟模型输出被截断' }),
      onChanged: listen,
      saveTodo: async (input: OfficeTodoWrite) => {
        writes.push(input);
        assert.equal(input.itemId, old.id);
        linked = { ...newTask(), ...input.fields, id: todoId, status: input.operation === 'complete' ? 'done' : 'todo',
          createdAt: '2026-11-20T08:00:00Z', updatedAt: '2026-11-20T08:00:00Z', completedAt: null, notifiedFor: null, deletedAt: null };
        return linked;
      },
    },
    officePortal: {
      state: async () => portalState(),
      createTodo: async (id: string) => { assert.equal(id, 'w3-todo'); portalLinked = true; return id; },
    },
    todo: { onChanged: noop },
    island: { onWelinkMessagesChanged: noop, onWelinkSyncChanged: noop },
  } });
  const styles = registerHooks({ load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
  } });
  let root: ReturnType<typeof import('react-dom/client')['createRoot']> | undefined;
  const click = async (label: string, selector = 'button') => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(node => node.textContent?.trim() === label);
    assert.ok(button, `Missing button: ${label}`);
    await act(async () => button.click());
  };
  try {
    const { OfficeView } = await import('../src/views/OfficeView');
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.getElementById('root')!);
    await act(async () => root!.render(createElement(OfficeView, {
      settingsOpen: false, onSettings() {}, onMeeting() {}, onTask: id => opened.push(id),
      onAnalyze: (scene, label) => analyses.push({ scene, label }),
    })));
    assert.doesNotMatch(document.body.textContent!, /承诺台账|已经完成的承诺|规则候选应留在资料页/);
    assert.match(document.querySelector('.office-list')?.textContent ?? '', /上周答应交方案/);
    await click('AI 判断 · 1 条');
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /模拟模型输出被截断/);
    await act(async () => changed());
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /模拟模型输出被截断/);
    const edit = document.querySelector<HTMLButtonElement>('.todo-card-full-edit')!;
    await act(async () => edit.click());
    const name = document.querySelector<HTMLInputElement>('dialog[open] input[required]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(name, '提交更新后的方案');
      name.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click('保存', 'dialog[open] button');
    assert.equal(writes.length, 0);
    await click('起草回复');
    assert.deepEqual(analyses, [{ scene: { kind: 'draft', sourceId: old.source.id,
      reply: { accountKey, title: '提交更新后的方案' } }, label: '帮我起草个回复' }]);
    await click('加入待办');
    assert.equal(document.querySelector('dialog[open]'), null);
    assert.deepEqual(writes.map(item => [item.operation, item.fields.title, item.fields.note, item.fields.dateAt]),
      [['add', '提交更新后的方案', '提交方案', old.deadline]]);
    assert.match(document.querySelector('.office-list')!.textContent!, /已加入待办/);
    await click('打开关联待办');
    assert.deepEqual(opened, [todoId]);
    await click('记为已完成');
    assert.equal(writes[1].operation, 'complete');
    assert.doesNotMatch(document.body.textContent!, /提交更新后的方案/);

    accountKey = 'other-office-account';
    await act(async () => changed());
    assert.doesNotMatch(document.body.textContent!, /上周答应交方案/);
    connected = false;
    await act(async () => changed());
    assert.match(document.body.textContent!, /扫码登录 WeLink/);
    await click('W3 门户', '.office-tabs button');
    assert.equal(document.querySelector('h1')!.textContent, 'W3 门户');
    assert.equal(document.querySelector('.office-last-update'), null);
    assert.match(document.querySelector('.office-panel')!.textContent!, /评审权限申请/);
    assert.doesNotMatch(document.body.textContent!, /扫码登录 WeLink|返回待处理/);
    await click('我发起的申请');
    assert.match(document.querySelector('.office-panel')!.textContent!, /我提交的申请/);
    await click('待我处理');
    await click('转待办');
    await click('确认创建', 'dialog[open] button');
    await click('查看关联待办');
    assert.deepEqual(opened, [todoId, 'w3-todo']);
    await click('收件箱', '.office-tabs button');
    assert.match(document.body.textContent!, /扫码登录 WeLink/);
  } finally {
    await act(async () => root?.unmount());
    styles.deregister(); window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});

test('office inbox and brief share update status while material filters open as an anchored popover', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const matches = window.HTMLDialogElement.prototype.matches;
  Object.assign(window.HTMLDialogElement.prototype, {
    showPopover() { this.open = true; }, hidePopover() { this.open = false; }, close() { this.open = false; },
    matches(this: HTMLDialogElement, selector: string) { return selector === ':popover-open' || matches.call(this, selector); },
  });
  class Observer { observe() {} disconnect() {} }
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window
    : name === 'ResizeObserver' ? Observer : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] }));
  const coverage: OfficeCoverage = { state: 'fresh', lastSuccessAt: null, scope: '测试资料' };
  let snapshot: OfficeSnapshot = {
    accountKey: 'office-account', day: '2026-11-23', connected: true,
    coverage: { messages: coverage, mail: coverage, agenda: { ...coverage, lastSuccessAt: Date.parse('2026-11-23T11:00:00+08:00') } }, unreadMail: coverage,
    materials: [], items: [], followUps: { items: [], pending: 0 }, brief: { priorities: [], meetings: [] },
  };
  let finish!: (value: OfficeSnapshot) => void, fail!: (error: Error) => void;
  const listen = () => () => {};
  Object.assign(window, { workbench: {
    officeWorkbench: {
      state: async () => snapshot,
      brief: async () => null,
      workflow: async () => ({ accountKey: snapshot.accountKey, connected: snapshot.connected, settings: officeAutomationSchema.parse({}), days: [], notices: [], commitments: [] }),
      refresh: () => new Promise<OfficeSnapshot>((resolve, reject) => { finish = resolve; fail = reject; }),
      search: async () => ({ rows: [], total: 0, conversations: [] }),
      onChanged: listen,
    },
    todo: { onChanged: listen }, island: { onWelinkMessagesChanged: listen, onWelinkSyncChanged: listen },
  } });
  const styles = registerHooks({ load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
  } });
  let root: ReturnType<typeof import('react-dom/client')['createRoot']> | undefined;
  try {
    const { OfficeView } = await import('../src/views/OfficeView');
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.getElementById('root')!);
    await act(async () => root!.render(createElement(OfficeView, {
      settingsOpen: false, onSettings() {}, onMeeting() {}, onTask() {}, onAnalyze() {},
    })));
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.office-tabs button')];
    assert.deepEqual(tabs.map(button => button.textContent), ['收件箱', 'W3 门户', '简报']);
    const [inboxTab, , briefTab] = tabs;
    const updateTime = () => document.querySelector('.office-last-update')?.textContent;
    assert.equal(updateTime(), '尚未更新');
    await act(async () => briefTab.click());
    assert.equal(updateTime(), '尚未更新');
    assert.doesNotMatch(document.querySelector('.office-header')!.textContent!, /近期消息 36 小时/);
    await act(async () => inboxTab.click());
    const modes = [...document.querySelectorAll<HTMLButtonElement>('.office-header [aria-label="收件箱查看方式"] button')];
    const [pendingMode, materialsMode] = modes;
    assert.equal(pendingMode.getAttribute('aria-checked'), 'true');
    await act(async () => materialsMode.click());
    assert.equal(document.querySelector('h1')?.textContent, '收件箱');
    const refresh = document.querySelector<HTMLButtonElement>('.office-refresh > button')!;
    const filters = document.querySelector<HTMLButtonElement>('.office-filter-trigger')!;
    assert.equal(document.querySelector('input[type="search"]'), null);
    const notice = () => document.querySelector('.office-panel > .office-notice');
    assert.equal(updateTime(), '尚未更新');
    await act(async () => refresh.click());
    assert.equal(refresh.textContent, '正在更新…');
    const fresh = { ...snapshot, coverage: {
      ...snapshot.coverage,
      messages: { ...coverage, lastSuccessAt: Date.parse('2026-11-23T10:42:00+08:00') },
      mail: { ...coverage, lastSuccessAt: Date.parse('2026-11-23T10:58:00+08:00') },
    } };
    snapshot = { ...snapshot, coverage: {
      messages: { ...coverage, lastSuccessAt: Date.parse('2026-11-22T18:06:00+08:00') },
      mail: { ...coverage, state: 'cached', lastSuccessAt: Date.parse('2026-11-22T17:42:00+08:00') },
      agenda: { ...coverage, state: 'unread' },
    } };
    await act(async () => finish(snapshot));
    assert.equal(updateTime(), '上次更新 11/22 18:06');
    assert.equal(notice()?.textContent, undefined);
    assert.equal(refresh.textContent, '更新消息及邮件');
    const tooltip = document.getElementById(refresh.getAttribute('aria-describedby') ?? '');
    assert.equal(tooltip?.getAttribute('role'), 'tooltip');
    assert.deepEqual([...tooltip!.querySelectorAll('dd')].map(node => node.textContent), ['已更新', '沿用上次结果', '尚未读取']);
    await act(async () => filters.click());
    const popover = document.querySelector<HTMLDialogElement>('dialog.office-filter-popover[popover]')!;
    assert.equal(filters.getAttribute('aria-expanded'), 'true');
    assert.ok(document.activeElement === popover.querySelector('input[type="search"]'), 'opening filters focuses the search field');
    const group = [...popover.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '群消息')!;
    await act(async () => group.click());
    assert.equal(group.getAttribute('aria-checked'), 'true');
    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => popover.querySelector('input')!.dispatchEvent(escape));
    assert.ok(!document.querySelector('.office-filter-popover'), 'Escape closes the filter popover');
    assert.ok(document.activeElement === filters, 'closing filters returns focus to the trigger');
    assert.equal(filters.hasAttribute('data-active'), true);
    assert.equal(refresh.getAttribute('aria-describedby'), tooltip!.id);
    await act(async () => briefTab.click());
    assert.equal(updateTime(), '上次更新 11/22 18:06');
    assert.equal(refresh.getAttribute('aria-describedby'), tooltip!.id);
    assert.equal(notice()?.textContent, undefined);

    t.mock.timers.enable({ apis: ['setTimeout'] });
    await act(async () => refresh.click());
    await act(async () => finish(snapshot = fresh));
    assert.equal(updateTime(), '上次更新 10:58');
    assert.equal(notice()?.textContent, undefined);
    assert.equal(refresh.textContent, '已更新');
    assert.equal(refresh.hasAttribute('aria-describedby'), false);
    await act(async () => inboxTab.click());
    assert.equal(refresh.textContent, '已更新');
    await act(async () => t.mock.timers.tick(1999));
    assert.equal(refresh.textContent, '已更新');
    await act(async () => t.mock.timers.tick(1));
    assert.equal(refresh.textContent, '更新消息及邮件');
    await act(async () => refresh.click());
    await act(async () => fail(new Error('测试读取失败')));
    assert.equal(updateTime(), '上次更新 10:58');
    assert.equal(notice()?.getAttribute('role'), 'alert');
    assert.equal(notice()?.textContent, '测试读取失败');
    await act(async () => document.querySelector<HTMLButtonElement>('.office-header [aria-label="收件箱查看方式"] button')!.click());
    assert.equal(updateTime(), '上次更新 10:58');
  } finally {
    await act(async () => root?.unmount());
    styles.deregister(); window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});

test('office materials display individual AI outcomes and refresh the conversation count after review', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const { window, window: { document } } = dom;
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] }));
  const coverage: OfficeCoverage = { state: 'fresh', lastSuccessAt: null, scope: '测试资料' };
  const group: OfficeMaterialRow = { id: 'latest', label: '查看群消息', kind: 'group', title: '验收群', byline: '同事', at: 10, conversation: 'group:42' };
  const mail: OfficeMaterialRow = { id: 'mail', label: '查看邮件原文', kind: 'mail', title: '确认名单', byline: '团队', at: 20 };
  let reviewed = false;
  const listeners = new Set<() => void>();
  const mailRow = (): OfficeMaterialRow => ({ ...mail, reviewStatus: reviewed ? 'no' : 'pending' });
  const message = (id: string, reviewStatus?: OfficeConversationPage['rows'][number]['reviewStatus']) => ({
    id, byline: '同事', at: null, text: id, reviewStatus, ...(!reviewStatus && { surrounding: true }),
  });
  const listen = () => () => {};
  Object.assign(window, { workbench: {
    officeWorkbench: {
      state: async (): Promise<OfficeSnapshot> => ({
        accountKey: 'office-account', day: '2026-11-24', connected: true, materials: [mailRow()], items: [],
        followUps: { items: [], pending: 3, reviewRevision: reviewed ? 'after' : 'before' },
        coverage: { messages: coverage, mail: coverage, agenda: coverage }, unreadMail: coverage, brief: { priorities: [], meetings: [] },
      }),
      workflow: async () => ({ accountKey: 'office-account', connected: true, settings: officeAutomationSchema.parse({}), days: [], notices: [], commitments: [] }),
      search: async () => ({ rows: [{ ...group, pendingReviewCount: reviewed ? undefined : 2 }, mailRow()], total: 2, conversations: [] }),
      material: async () => ({ ...mail, text: '请核对名单', capturedAt: null }),
      conversationMessages: async (): Promise<OfficeConversationPage> => ({ total: 6, rows: [
        message('等待一', reviewed ? 'action' : 'pending'), message('等待二', reviewed ? 'no' : 'pending'),
        message('无需', 'no'), message('需', 'action'), message('不确定', 'maybe'), message('仅前后文'),
      ] }),
      onChanged: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    },
    todo: { onChanged: listen }, island: { onWelinkMessagesChanged: listen, onWelinkSyncChanged: listen },
  } });
  const styles = registerHooks({ load(url, context, next) {
    return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
  } });
  let root: ReturnType<typeof import('react-dom/client')['createRoot']> | undefined;
  const badges = (selector: string) => [...document.querySelectorAll(`${selector} .office-review-badge`)].map(node => node.textContent);
  try {
    const { OfficeView } = await import('../src/views/OfficeView');
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.getElementById('root')!);
    await act(async () => root!.render(createElement(OfficeView, {
      settingsOpen: false, onSettings() {}, onMeeting() {}, onTask() {}, onAnalyze() {},
    })));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const materials = [...document.querySelectorAll<HTMLButtonElement>('.office-inbox-tools [role="radio"]')].find(node => node.textContent === '查原文')!;
    await act(async () => materials.click());
    await act(async () => t.mock.timers.tick(0));
    assert.deepEqual(badges('.office-list'), ['2 条待判断', '待 AI 判断']);
    assert.deepEqual(badges('.office-conversation'), ['待核对', '需跟进', '无需跟进', '待 AI 判断', '待 AI 判断']);
    assert.match(document.querySelector('[aria-label="群消息 验收群"]')?.getAttribute('aria-description') ?? '', /2 条待判断/);

    const mailButton = document.querySelector<HTMLButtonElement>('[aria-label="邮件 确认名单"]')!;
    await act(async () => mailButton.click());
    assert.deepEqual(badges('.office-detail'), ['待 AI 判断']);
    reviewed = true;
    await act(async () => listeners.forEach(callback => callback()));
    await act(async () => t.mock.timers.tick(0));
    assert.deepEqual(badges('.office-list'), ['无需跟进']);
    assert.deepEqual(badges('.office-detail'), ['无需跟进']);
  } finally {
    await act(async () => root?.unmount());
    styles.deregister(); window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
