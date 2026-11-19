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
  const quotaEdits: string[][] = [], consoleOpened: string[] = [];
  let enabled: string[] = [], accounts: NewApiAccount[] = [], scanFailure = false;
  let projects = [project], connectFailurePath = '', connectException = '', quotaFailure = '';
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
      if (quotaFailure) throw new Error(quotaFailure);
      accounts = [{ id: 'account', label, baseUrl, account, userId: '', status: 'connecting', todayQuota: 0, models: [], updatedAt: null, message: '正在连接…' }];
      return accounts;
    },
    quotaUpdate: async (id: string, label: string, baseUrl: string, username: string, password: string) => {
      quotaEdits.push([id, label, baseUrl, username, password]);
      accounts = accounts.map(account => account.id === id ? { ...account, label, baseUrl, account: username, status: 'connecting', updatedAt: null, checkedAt: undefined, message: '正在连接…' } : account);
      return accounts;
    },
    quotaOfficial: async (id: string) => { consoleOpened.push(id); },
    quotaRemove: async (id: string) => { accounts = accounts.filter(account => account.id !== id); return accounts; },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { AgentConnectionSettings } = await import('../src/views/AgentConnectionSettings');
  const root = createRoot(dom.window.document.getElementById('root')!), resetSearch = () => {};
  const render = async (query = '') => act(async () => root.render(createElement(AgentConnectionSettings, { query, resetSearch })));
  const tabs = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('.settings-agent-tabs [role="radio"]')];
  const tab = (name: string) => tabs().find(button => button.textContent === name)!;
  const button = (name: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)!;
  const quotaRow = (name: string) => button(name).closest('[role="row"]')!;
  const quotaStatus = (name: string) => quotaRow(name).querySelector('.island-provider-status')!;
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
  assert.deepEqual(tabs().map(item => item.textContent), ['New API 连接', 'CodeAI 连接']);
  assert.equal(dom.window.document.querySelector('nav[aria-label="连接来源"]'), null);
  assert.equal(tab('New API 连接').getAttribute('aria-checked'), 'true');
  assert.equal(dom.window.document.querySelector('[role="table"][aria-label="额度账号"]'), null);
  assert.doesNotMatch(dom.window.document.querySelector('.island-connection-manager')!.textContent ?? '', /尚未配置账号/);
  assert.equal(button('添加账号').closest('header')?.parentElement?.className, 'island-connection-manager');
  assert.equal(dom.window.document.querySelector('.island-agent-settings'), null);

  await t.test('CodeAI lists the project name, path and metadata separately and can enable a project', async () => {
    await click(tab('CodeAI 连接'));
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

  const addDialog = () => dom.window.document.querySelector<HTMLDialogElement>('dialog[aria-label="添加账号"][open]');
  await t.test('New API add dialog keeps its draft on navigation and save failure, and closes after saving', async () => {
    await click(tab('New API 连接'));
    await click(button('添加账号'));
    const fields = () => [...addDialog()!.querySelectorAll<HTMLInputElement>('input')];
    const submit = async () => act(async () => addDialog()!.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.ok(addDialog()!.classList.contains('ai-provider-add-dialog'));
    assert.equal(dom.window.document.activeElement, fields()[0]);
    assert.equal(button('保存账号').disabled, true);
    const account = ['测试账号', 'https://synthetic.invalid', 'fixture-user', 'fixture-password'];
    for (const [index, value] of [account[0], account[2], account[1], account[3]].entries()) await input(fields()[index], value);
    await click(button('显示密码')); assert.equal(fields()[3].type, 'text');
    for (const section of ['agents', 'quota']) {
      await act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('island-settings-section', { detail: section })));
      assert.equal(Boolean(addDialog()), section === 'quota');
    }
    assert.equal(fields()[0].value, account[0]); assert.equal(fields()[3].value, account[3]); assert.equal(fields()[3].type, 'password');
    quotaFailure = '本机凭据加密不可用，未保存凭据';
    await submit();
    assert.equal(addDialog()!.querySelector('[role="alert"]')?.textContent, quotaFailure);
    assert.equal(fields()[2].value, account[1]);
    quotaFailure = '';
    await submit();
    assert.deepEqual(credentials, [account, account]);
    assert.equal(addDialog(), null);
    assert.equal(button('测试账号').getAttribute('aria-expanded'), 'true');
    assert.equal(quotaStatus('测试账号').textContent, '连接中');
  });

  await t.test('closing an edited add dialog uses the shared discard confirmation and returns focus', async () => {
    const add = button('添加账号');
    add.focus();
    await click(add);
    await input(addDialog()!.querySelector('input')!, '未保存的草稿');
    await click(addDialog()!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!);
    assert.ok(dom.window.document.querySelector('dialog[aria-label="放弃未保存的修改"][open]'));
    await click(button('继续编辑'));
    assert.equal(addDialog()!.querySelector('input')!.value, '未保存的草稿');
    await click(addDialog()!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!);
    await click(button('放弃修改'));
    assert.equal(addDialog(), null);
    assert.equal(dom.window.document.activeElement, add);
    await click(add);
    assert.equal(addDialog()!.querySelector('input')!.value, '');
    await click(addDialog()!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!);
  });

  await t.test('account rows show independent states and reveal the original error on demand', async () => {
    const base = accounts[0];
    const recent = new Date(2026, 10, 19, 20, 44).getTime();
    accounts = [
      { ...base, id: 'failed', label: 'TEST', account: 'TEST', status: 'error', message: 'fetch failed', checkedAt: recent, updatedAt: recent },
      { ...base, id: 'team', label: '团队账号', account: 'team-user', status: 'ready', message: '', checkedAt: recent - 120000 },
      { ...base, id: 'cached', label: '缓存账号', status: 'ready', message: 'HTTP 503', hasData: true, checkedAt: recent, updatedAt: recent - 3600000 },
      { ...base, id: 'legacy', label: '旧账号', status: 'disconnected', message: '' },
    ];
    await act(async () => { for (const listener of listeners) listener(structuredClone(state)); });
    assert.deepEqual(['TEST', '团队账号', '缓存账号', '旧账号'].map(name => quotaStatus(name).textContent), ['连接异常', '已连接', '刷新失败', '未连接']);
    assert.equal(quotaRow('缓存账号').querySelector('time')?.getAttribute('datetime'), new Date(recent).toISOString());
    assert.equal(dom.window.document.querySelector('.island-quota-details'), null);
    await click(button('TEST'));
    const caption = dom.window.document.querySelector<HTMLElement>('.island-quota-feedback > summary')!;
    assert.match(caption.textContent!, /额度服务请求失败/);
    assert.equal(caption.closest('details')!.open, false);
    await click(caption);
    assert.equal(caption.closest('details')!.open, true);
    assert.equal(caption.nextElementSibling?.textContent, 'fetch failed');
    await click(button('团队账号'));
    assert.equal(button('TEST').getAttribute('aria-expanded'), 'false');
    assert.equal(button('团队账号').getAttribute('aria-expanded'), 'true');
    assert.match(dom.window.document.querySelector('.island-quota-details')!.textContent!, /登录用户名.*team-user/);
  });

  await t.test('editing, opening the console and deleting a row operate on its account', async () => {
    await click(button('打开 团队账号 控制台'));
    assert.deepEqual(consoleOpened, ['team']);
    await click(button('编辑 TEST'));
    const form = dom.window.document.querySelector<HTMLFormElement>('.island-key-editor')!;
    assert.equal(form.querySelector('input')!.value, 'TEST');
    await input(form.querySelector('input')!, '改名后的账号');
    await click(button('团队账号'));
    assert.equal(form.querySelector('input')!.value, '改名后的账号');
    await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(quotaEdits[0][0], 'failed');
    assert.equal(quotaEdits[0][1], '改名后的账号');
    assert.equal(quotaStatus('改名后的账号').textContent, '连接中');
    assert.equal(dom.window.document.querySelector('.island-key-editor'), null);
    await click(button('删除 团队账号'));
    assert.equal(button('团队账号'), undefined);
    assert.ok(button('改名后的账号'));
  });

  await t.test('the messages entry selects CodeAI and a failed scan can be retried', async () => {
    await act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('island-settings-section', { detail: 'agents' })));
    assert.equal(tab('CodeAI 连接').getAttribute('aria-checked'), 'true');
    scanFailure = true; await click(button('重新扫描'));
    assert.equal(button('重新扫描').disabled, false);
    assert.match(dom.window.document.body.textContent!, /合成扫描失败/);
    scanFailure = false; await click(button('重新扫描'));
    assert.ok(button(`监听 ${project.cwd}`));
  });

  await t.test('global settings search can show both sources and clearing it restores the selection', async () => {
    await render('连接');
    assert.equal(tabs().length, 0);
    assert.ok(dom.window.document.querySelector('.island-connection-manager'));
    assert.ok(dom.window.document.querySelector('.island-agent-settings'));
    await render(); assert.equal(tab('CodeAI 连接').getAttribute('aria-checked'), 'true');
  });
});
