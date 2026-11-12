import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { initialIslandData, type NewApiAccount } from '../shared/island-contracts';
import type { DiscoveredProject } from '../shared/agent-message-contracts';

test('AI connection source navigation preserves account drafts, project controls and direct navigation', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'navigator', 'sessionStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.hidePopover = () => {};
  dom.window.HTMLElement.prototype.showPopover = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.sessionStorage.setItem('island-settings-section', 'quota');
  const state = { ...initialIslandData(), mode: 'collapsed', pinned: false, quiet: false, fullscreenDetection: true };
  const project: DiscoveredProject = { dir: 'project', cwd: 'C:\\work\\onosan_workbench', sessionCount: 2, lastActive: new Date(2026, 10, 3).getTime(), source: 'recent', available: true };
  const listeners = new Set<Function>(), connects: string[][] = [], credentials: string[][] = [];
  let enabled: string[] = [], accounts: NewApiAccount[] = [], scanFailure = false;
  let projects = [project], connectFailurePath = '', connectException = '';
  Object.defineProperty(dom.window, 'workbench', { value: { island: {
    state: async () => structuredClone(state), onError: () => () => {},
    onChanged: (callback: Function) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    displays: async () => [{ id: 1, label: '测试屏幕' }], quotas: async () => accounts,
    agentProjects: async () => { if (scanFailure) throw new Error('合成扫描失败'); return { discovered: projects, enabled }; },
    agentConnect: async (paths: string[]) => {
      if (connectException) throw new Error(connectException);
      enabled = paths.filter(path => path !== connectFailurePath); connects.push(paths);
      return { enabled, failed: paths.includes(connectFailurePath) ? [{ path: connectFailurePath, error: '项目目录已不存在' }] : [] };
    },
    quotaConnect: async (label: string, baseUrl: string, account: string, password: string) => {
      credentials.push([label, baseUrl, account, password]);
      accounts = [{ id: 'account', label, baseUrl, account, userId: '1', status: 'ready', todayQuota: 0, models: [], updatedAt: null, message: '' }];
      return accounts;
    },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { IslandSettingsSection } = await import('../src/views/IslandSettings');
  const root = createRoot(dom.window.document.getElementById('root')!), resetSearch = () => {};
  const render = async (query = '') => act(async () => root.render(createElement(IslandSettingsSection, { query, resetSearch })));
  const source = (name: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('.island-ai-sources button')].find(b => b.querySelector('strong')?.textContent === name)!;
  const button = (name: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)!;
  const click = async (element: HTMLElement) => act(async () => element.click());
  const input = async (element: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  t.after(async () => {
    await act(async () => root.unmount()); assert.equal(listeners.size, 0); dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!); else Reflect.deleteProperty(globalThis, name); });
  });
  await render();
  assert.equal(source('New API').getAttribute('aria-pressed'), 'true');
  assert.equal(source('New API').querySelector('small')?.textContent, '未连接');
  assert.equal(dom.window.document.querySelector('.island-agent-settings'), null);

  await t.test('CodeAI lists the project name, path and metadata separately and can enable a project', async () => {
    await click(source('CodeAI'));
    assert.equal(dom.window.document.querySelector('.island-connection-manager'), null);
    assert.equal(dom.window.document.querySelector('.island-agent-project-copy b')?.textContent, 'onosan_workbench');
    assert.equal(dom.window.document.querySelector('.island-agent-project-path')?.textContent, project.cwd);
    assert.match(dom.window.document.querySelector('.island-agent-project-meta')!.textContent!, /2 个会话/);
    assert.equal(dom.window.document.querySelector('.island-agent-project-title small')!.textContent, '自动扫描');
    await click(button(`监听 ${project.cwd}`));
    assert.deepEqual(connects.at(-1), [project.cwd]);
    assert.equal(button(`监听 ${project.cwd}`).getAttribute('aria-checked'), 'true');
  });

  await t.test('manually added projects remain visible and can be disconnected', async () => {
    const manual = 'C:\\work\\manual_project';
    assert.equal(dom.window.document.querySelector('[aria-label="手动添加项目路径"]'), null);
    await click(button('手动添加'));
    await input(dom.window.document.querySelector('[aria-label="手动添加项目路径"]')!, manual);
    await click(button('添加'));
    assert.ok(enabled.includes(manual)); assert.ok(button(`监听 ${manual}`));
    assert.equal(dom.window.document.querySelector('.island-agent-manual-dialog'), null);
    assert.equal(button(`监听 ${manual}`).closest('.island-agent-project')!.querySelector('.island-agent-project-title small')!.textContent, '手动添加');
    await click(button(`监听 ${manual}`)); assert.ok(!enabled.includes(manual));
  });

  await t.test('recent projects stay separate from collapsed history and invalid paths cannot be connected', async () => {
    const missing = { ...project, dir: 'missing', cwd: 'C:\\work\\removed', available: false, problem: '项目目录已不存在' };
    const old = { ...project, dir: 'old', cwd: 'C:\\work\\historical', source: 'history' as const };
    const unknown = { ...old, dir: 'unknown', cwd: '', available: false, problem: '路径未知，需手动填写' };
    const connected = { ...missing, dir: 'connected', cwd: 'C:\\work\\removed_connected', source: 'history' as const };
    projects = [project, missing, connected, old, unknown]; enabled.push(connected.cwd);
    await click(button('重新扫描'));
    const history = dom.window.document.querySelector<HTMLDetailsElement>('.island-agent-history')!;
    assert.equal(history.open, false); assert.match(history.querySelector('summary')!.textContent!, /历史会话（2）/);
    assert.ok(history.querySelector(`[aria-label="监听 ${old.cwd.replaceAll('\\', '\\\\')}"]`));
    assert.equal(button(`监听 ${missing.cwd}`).disabled, true); assert.equal(button('监听 unknown').disabled, true);
    const before = connects.length; await click(button(`监听 ${missing.cwd}`)); assert.equal(connects.length, before);
    assert.equal(button(`监听 ${connected.cwd}`).disabled, false);
    assert.equal(button(`监听 ${connected.cwd}`).closest('.island-agent-project')!.querySelector('.island-agent-project-title small')!.textContent, '自动扫描');
    await click(button(`监听 ${connected.cwd}`)); assert.ok(!enabled.includes(connected.cwd));
    projects = [project]; await click(button('重新扫描'));
  });

  await t.test('a rejected manual path stays visible as an error and never appears connected', async () => {
    connectFailurePath = 'C:\\work\\missing_manual';
    await click(button('手动添加'));
    await input(dom.window.document.querySelector('[aria-label="手动添加项目路径"]')!, connectFailurePath);
    await click(button('添加'));
    assert.ok(!enabled.includes(connectFailurePath));
    assert.equal(button(`监听 ${connectFailurePath}`).getAttribute('aria-checked'), 'false');
    assert.equal(button(`监听 ${connectFailurePath}`).disabled, true);
    assert.equal(button(`监听 ${connectFailurePath}`).closest('.island-agent-project')!.querySelector('.island-agent-project-title small')!.textContent, '手动添加');
    assert.match(dom.window.document.querySelector('.island-agent-project-error')!.textContent!, /目录已不存在/);
    const dialog = dom.window.document.querySelector('.island-agent-manual-dialog')!;
    assert.match(dialog.querySelector('[role="alert"]')!.textContent!, /目录已不存在/);
    assert.equal(dialog.querySelector<HTMLInputElement>('input')!.value, connectFailurePath);
    assert.equal(dialog.querySelector('input')!.getAttribute('aria-invalid'), 'true');
    connectFailurePath = '';
    const retry = 'C:\\work\\retry_manual';
    await input(dialog.querySelector('input')!, retry); await click(button('添加'));
    assert.ok(enabled.includes(retry)); assert.equal(dom.window.document.querySelector('.island-agent-manual-dialog'), null);
  });

  await t.test('a request failure stays in the manual form and preserves the path for retry', async () => {
    const path = 'C:\\work\\request_retry';
    await click(button('手动添加'));
    await input(dom.window.document.querySelector('[aria-label="手动添加项目路径"]')!, path);
    connectException = '写入项目配置失败：没有权限';
    await click(button('添加'));
    const dialog = dom.window.document.querySelector('.island-agent-manual-dialog')!;
    assert.match(dialog.querySelector('[role="alert"]')!.textContent!, /没有权限/);
    assert.equal(dialog.querySelector<HTMLInputElement>('input')!.value, path);
    assert.ok(!enabled.includes(path));
    connectException = ''; await click(button('添加'));
    assert.ok(enabled.includes(path)); assert.equal(dom.window.document.querySelector('.island-agent-manual-dialog'), null);
  });

  await t.test('switching source retains the account form and remasks the password', async () => {
    await click(source('New API')); await click(button('+ 添加账号'));
    const fields = [...dom.window.document.querySelectorAll<HTMLInputElement>('.island-key-field input')];
    for (const [i, value] of ['测试账号', 'https://synthetic.invalid', 'fixture-user', 'fixture-password'].entries()) await input(fields[i], value);
    await click(button('显示密码')); assert.equal(fields[3].type, 'text');
    await click(source('CodeAI')); await click(source('New API'));
    const restored = [...dom.window.document.querySelectorAll<HTMLInputElement>('.island-key-field input')];
    assert.equal(restored[0].value, '测试账号'); assert.equal(restored[3].value, 'fixture-password'); assert.equal(restored[3].type, 'password');
    await act(async () => dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(credentials, [['测试账号', 'https://synthetic.invalid', 'fixture-user', 'fixture-password']]);
    assert.ok(dom.window.document.querySelector('[aria-label="测试账号 账号详情"]'));
  });

  await t.test('source status reflects account connectivity and prioritizes failures over other accounts', async () => {
    const connected = accounts[0];
    for (const [statuses, expected, expectedStatus] of [
      [['ready'], '已连接', 'ready'],
      [['ready', 'connecting'], '连接中', 'connecting'],
      [['ready', 'connecting', 'error'], '连接异常', 'error'],
      [['disconnected'], '未连接', 'disconnected'],
    ] as const) {
      accounts = statuses.map((status, index) => ({ ...connected, id: `status-${index}`, status }));
      await act(async () => { for (const listener of listeners) listener(structuredClone(state)); });
      const status = source('New API').querySelector('small')!;
      assert.equal(status.textContent, expected);
      assert.equal(status.getAttribute('data-status'), expectedStatus);
    }
    accounts = [connected];
    await act(async () => { for (const listener of listeners) listener(structuredClone(state)); });
    assert.equal(source('New API').querySelector('small')?.textContent, '已连接');
  });

  await t.test('the messages entry selects CodeAI and a failed scan can be retried', async () => {
    await act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('island-settings-section', { detail: 'agents' })));
    assert.equal(source('CodeAI').getAttribute('aria-pressed'), 'true');
    scanFailure = true; await click(button('重新扫描'));
    assert.equal(button('重新扫描').disabled, false);
    assert.match(dom.window.document.body.textContent!, /合成扫描失败/);
    scanFailure = false; await click(button('重新扫描'));
    assert.ok(button(`监听 ${project.cwd}`));
  });

  await t.test('global settings search can show both sources and clearing it restores the selection', async () => {
    await render('连接');
    assert.equal(dom.window.document.querySelector('.island-ai-sources'), null);
    assert.ok(dom.window.document.querySelector('.island-connection-manager'));
    assert.ok(dom.window.document.querySelector('.island-agent-settings'));
    await render(); assert.equal(source('CodeAI').getAttribute('aria-pressed'), 'true');
  });
});
