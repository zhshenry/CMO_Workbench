import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { officeAutomationSchema, type OfficeCommitment, type OfficeCoverage } from '../shared/office-workbench';
import { newTask } from '../shared/todo-contracts';

test('office inbox links retained commitments to todos and shows W3 independently of WeLink', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] }));
  const coverage: OfficeCoverage = { state: 'fresh', lastSuccessAt: null, scope: '测试资料' };
  const old: OfficeCommitment = {
    kind: 'commitment', id: 'old', title: '上周答应交方案', reason: '我下周三交方案', deadline: '2026-11-25',
    followUp: { nextStep: '提交方案', reason: '承诺仍有效', evidence: '我下周三交方案' },
    source: { id: 'saved-source', label: '查看群消息' }, recordedAt: 1, status: 'open',
  };
  const completed = { ...old, id: 'completed', title: '已经完成的承诺', status: 'done' };
  let connected = true, accountKey = 'office-account', commitment = old, proposeCount = 0, applyCount = 0, portalLinked = false;
  const todoId = 'linked-office-todo';
  const action = { id: 'prepare-for-old', revision: 0, status: 'pending', payload: { plan: { message: '请确认以下待办',
    actions: [{ type: 'create', task: { ...newTask(old.title), dateAt: old.deadline } }] } } };
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
        followUps: { items: [], pending: 0 },
        coverage: { messages: coverage, mail: coverage, agenda: coverage }, unreadMail: coverage, brief: { priorities: [], meetings: [] } }),
      workflow: async () => ({ accountKey: 'office-account', connected, settings: officeAutomationSchema.parse({}), days: [], notices: [], commitments: [commitment, completed] }),
      onChanged: listen,
      proposeTodo: async (id: string) => { assert.equal(id, old.id); proposeCount++; return action; },
    },
    bot: { answerAction: async (id: string, revision: number, answer: unknown) => {
      assert.deepEqual([id, revision, answer], [action.id, 0, { approved: true, indices: [0] }]);
      applyCount++;
      commitment = { ...old, status: 'linked', taskId: todoId };
      return { ...action, status: 'applied', receipt: { created: [{ id: todoId }] } };
    } },
    officePortal: {
      state: async () => portalState(),
      createTodo: async (id: string) => { assert.equal(id, 'w3-todo'); portalLinked = true; return id; },
    },
    todo: { onChanged: noop },
    island: { onWelinkMessagesChanged: noop, onWelinkSyncChanged: noop },
  } });
  const styles = registerHooks({ load(url, context, next) {
    return url.endsWith('/office-workbench.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
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
      settingsOpen: false, onSettings() {}, onMeeting() {}, onTask: id => opened.push(id), onAnalyze() {},
      onPrepared: () => assert.fail('Commitment confirmation stays in the inbox'),
    })));
    assert.doesNotMatch(document.body.textContent!, /承诺台账|已经完成的承诺|规则候选应留在资料页/);
    assert.match(document.querySelector('.office-list')?.textContent ?? '', /上周答应交方案/);
    await click('转待办');
    assert.match(document.querySelector('dialog[open]')!.textContent!, /上周答应交方案.*11月25日/);
    await click('取消', 'dialog[open] button');
    assert.equal(proposeCount, 0);
    const planned = action.payload.plan.actions[0].task;
    planned.dateAt = '2026-12-01';
    await click('转待办');
    await click('确认创建', 'dialog[open] button');
    assert.match(document.querySelector('dialog[open]')!.textContent!, /已有待办建议与当前承诺不同/);
    assert.equal(applyCount, 0);
    planned.dateAt = old.deadline;
    await click('确认创建', 'dialog[open] button');
    assert.equal(proposeCount, 2);
    assert.equal(applyCount, 1);
    assert.match(document.querySelector('.office-list')!.textContent!, /已转待办/);
    await click('打开关联待办');
    assert.deepEqual(opened, [todoId]);

    accountKey = 'other-office-account';
    await act(async () => changed());
    assert.doesNotMatch(document.body.textContent!, /上周答应交方案/);
    connected = false;
    await act(async () => changed());
    assert.match(document.body.textContent!, /扫码登录 WeLink/);
    await click('W3 门户', '[role="radiogroup"][aria-label="待处理来源"] button');
    assert.equal(document.querySelector('h1')!.textContent, '待处理');
    assert.match(document.querySelector('.office-panel')!.textContent!, /评审权限申请/);
    assert.doesNotMatch(document.body.textContent!, /扫码登录 WeLink|返回待处理/);
    await click('我发起的申请');
    assert.match(document.querySelector('.office-panel')!.textContent!, /我提交的申请/);
    await click('待我处理');
    await click('转待办');
    await click('确认创建', 'dialog[open] button');
    await click('查看关联待办');
    assert.deepEqual(opened, [todoId, 'w3-todo']);
    await click('消息跟进');
    assert.match(document.body.textContent!, /扫码登录 WeLink/);
  } finally {
    await act(async () => root?.unmount());
    styles.deregister(); window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
