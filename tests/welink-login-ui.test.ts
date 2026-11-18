import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { DEFAULT_APP_SETTINGS } from '../shared/contracts';
import type { WelinkSyncStatus } from '../shared/island-contracts';

test('WeLink login reports QR preparation and preserves cancellation and retry', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'navigator', 'sessionStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  const listeners = new Set<(event: { done: boolean; qrAscii?: string; error?: string }) => void>();
  const syncListeners = new Set<(status: WelinkSyncStatus) => void>();
  let authenticated = false, loginCalls = 0, cancelCalls = 0, mountId = 0;
  let enabled = false, refreshCalls = 0;
  let sync: WelinkSyncStatus = { syncing: false, lastSuccessAt: null, error: '' };
  let refreshAction = () => Promise.resolve({ added: 0, updated: 0, removed: 0 });
  let loginFailure: Error | null = null, statusFailure: Error | null = null;
  let statusWait: Promise<void> | undefined;
  Object.defineProperty(dom.window, 'workbench', { value: {
    settings: { get: async () => structuredClone(DEFAULT_APP_SETTINGS) },
    auth: { hasCredentials: async () => false },
    island: {
      welinkMessagesStatus: async () => ({ syncing: false, lastSuccessAt: null, error: '', partial: false, account: '', conversations: 0, messages: 0, reminders: [] }),
      onWelinkMessagesChanged: () => () => {},
      welinkStatus: async () => {
        if (statusWait) await statusWait;
        if (statusFailure) throw statusFailure;
        return { authenticated, uid: authenticated ? 'demo_user' : undefined, enabled, sync: { ...sync } };
      },
      welinkLogin: async () => { loginCalls++; if (loginFailure) throw loginFailure; },
      welinkCancelLogin: async () => { cancelCalls++; listeners.forEach(listener => listener({ done: true, error: '已取消' })); },
      onWelinkLoginEvent: (listener: (event: { done: boolean; qrAscii?: string; error?: string }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onWelinkSyncChanged: (listener: (status: WelinkSyncStatus) => void) => { syncListeners.add(listener); return () => syncListeners.delete(listener); },
      welinkRefresh: () => { refreshCalls++; return refreshAction(); },
    },
  } });
  const { createRoot } = await import('react-dom/client');
  const { SettingsView } = await import('../src/views/SettingsView');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const loginButton = () => dom.window.document.querySelector<HTMLButtonElement>('.welink-login-button')!;
  const button = (text: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!;
  const click = async (element: HTMLElement) => act(async () => element.click());
  const emit = async (event: { done: boolean; qrAscii?: string; error?: string }) => act(async () => listeners.forEach(listener => listener(event)));
  const emitSync = async (next: WelinkSyncStatus) => act(async () => { sync = next; syncListeners.forEach(listener => listener({ ...next })); });
  const mount = async (waitForStatus?: Promise<void>) => {
    authenticated = false; loginCalls = 0; cancelCalls = 0; loginFailure = null; statusFailure = null;
    enabled = false; refreshCalls = 0; sync = { syncing: false, lastSuccessAt: null, error: '' };
    statusWait = waitForStatus;
    await act(async () => root.render(createElement(SettingsView, { key: ++mountId, view: 'settings-welink', appearance: { value: { uiTheme: 'mist', navigationStyle: 'classic', glassIntensity: 'normal' }, windowLight: 'afternoon', ready: true, status: 'saved', error: '', change() {}, retry() {} }, onAvatarColorChange() {} })));
  };
  t.after(async () => {
    await act(async () => root.unmount()); assert.equal(listeners.size, 0); assert.equal(syncListeners.size, 0); dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!); else Reflect.deleteProperty(globalThis, name); });
  });

  await t.test('startup acknowledgement keeps the waiting hint until the QR event and blocks duplicate requests', async () => {
    await mount(); await click(loginButton());
    assert.equal(loginCalls, 1);
    assert.equal(loginButton().disabled, true);
    assert.equal(loginButton().getAttribute('aria-busy'), 'true');
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!, /正在获取登录二维码/);
    assert.ok(button('取消'));
    await click(loginButton()); assert.equal(loginCalls, 1);
    await emit({ done: false, qrAscii: '+----+\n| QR |\n+----+' });
    assert.equal(loginButton().textContent, '等待扫码');
    assert.equal(loginButton().disabled, true);
    assert.equal(loginButton().getAttribute('aria-busy'), 'false');
    assert.match(dom.window.document.querySelector('.welink-qr-ascii')!.textContent!, /QR/);
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!, /二维码已就绪/);
    authenticated = true; await emit({ done: true });
    assert.ok(button('登出'));
    assert.match(dom.window.document.body.textContent!, /已登录（demo_user）/);
    assert.equal(dom.window.document.querySelector('.welink-qr'), null);
  });

  await t.test('startup rejection restores the login action and retry clears the error', async () => {
    await mount(); loginFailure = new Error('无法启动登录'); await click(loginButton());
    assert.equal(loginButton().disabled, false);
    assert.equal(loginButton().textContent, '扫码登录');
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /无法启动登录/);
    loginFailure = null; await click(loginButton());
    assert.equal(loginCalls, 2);
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    assert.equal(loginButton().getAttribute('aria-busy'), 'true');
  });

  await t.test('timeout clears the QR and allows a new request', async () => {
    await mount(); await click(loginButton());
    await emit({ done: false, qrAscii: 'QR' });
    await emit({ done: true, error: '扫码超时,请重试' });
    assert.equal(dom.window.document.querySelector('.welink-qr'), null);
    assert.equal(loginButton().disabled, false);
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /扫码超时/);
    await click(loginButton()); assert.equal(loginCalls, 2);
  });

  await t.test('the actual multi-line process error stays visible and retryable', async () => {
    await mount(); await click(loginButton());
    const reason = '登录失败：Failed to obtain QR code: HTTP 403 Forbidden\n（退出码 1）';
    await emit({ done: true, error: reason });
    assert.equal(dom.window.document.querySelector('[role="alert"]')!.textContent, reason);
    assert.equal(loginButton().disabled, false);
    await click(loginButton()); assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
  });

  await t.test('cancel works before and after the QR appears without reporting cancellation as a failure', async () => {
    await mount(); await click(loginButton()); await click(button('取消'));
    assert.equal(loginButton().disabled, false);
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    await click(loginButton()); await emit({ done: false, qrAscii: 'QR' }); await click(button('取消'));
    assert.equal(cancelCalls, 2);
    assert.equal(dom.window.document.querySelector('.welink-qr'), null);
    assert.equal(loginButton().textContent, '扫码登录');
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
  });

  await t.test('a failed status read after completion stays visible and retryable', async () => {
    await mount(); await click(loginButton()); statusFailure = new Error('登录状态读取失败'); await emit({ done: true });
    assert.equal(loginButton().disabled, false);
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /登录状态读取失败/);
  });

  await t.test('a delayed initial status response does not erase the new QR', async () => {
    let finishStatus!: () => void;
    await mount(new Promise<void>(resolve => { finishStatus = resolve; }));
    await click(loginButton()); await emit({ done: false, qrAscii: 'QR' });
    await act(async () => finishStatus());
    assert.equal(dom.window.document.querySelector('.welink-qr-ascii')!.textContent, 'QR');
    assert.equal(loginButton().textContent, '等待扫码');
    assert.equal(loginButton().disabled, true);
  });

  await t.test('automatic sync failures have one expandable warning with the real success time', async () => {
    await mount(); authenticated = true; enabled = true; await emit({ done: true });
    const firstSuccess = Date.parse('2026-11-11T09:10:00Z');
    await emitSync({ syncing: false, lastSuccessAt: firstSuccess, error: '连接超时\n底层服务请求未返回\n' + '详细信息'.repeat(80) });
    const warning = dom.window.document.querySelector<HTMLDetailsElement>('.welink-sync-warning')!;
    assert.equal(warning.open, false);
    assert.match(warning.querySelector('.welink-sync-copy')!.textContent!, /连接超时，请稍后重试/);
    assert.match(warning.querySelector('small')!.textContent!, /17:10/);
    assert.equal(dom.window.document.querySelector('.welink-card > .error'), null);
    await click(warning.querySelector('summary')!); assert.equal(warning.open, true);
    assert.match(warning.querySelector('pre')!.textContent!, /底层服务请求未返回/);
    await emitSync({ syncing: false, lastSuccessAt: firstSuccess, error: 'WeLink 查询失败:服务暂不可用' });
    assert.equal(dom.window.document.querySelectorAll('.welink-sync-warning').length, 1);
    assert.equal(dom.window.document.querySelector('.welink-sync-warning'), warning);
    assert.match(warning.textContent!, /服务暂不可用/);
    await emitSync({ syncing: false, lastSuccessAt: Date.parse('2026-11-11T09:30:00Z'), error: '' });
    assert.equal(dom.window.document.querySelector('.welink-sync-warning'), null);
  });

  await t.test('manual retry keeps the warning while busy, blocks duplicates and clears on zero changes', async () => {
    await mount(); authenticated = true; enabled = true; await emit({ done: true });
    await emitSync({ syncing: false, lastSuccessAt: null, error: '连接超时' });
    assert.match(dom.window.document.querySelector('.welink-sync-copy small')!.textContent!, /暂无记录/);
    let finish!: (value: { added: number; updated: number; removed: number }) => void;
    refreshAction = () => new Promise(resolve => { finish = resolve; });
    const refreshButton = dom.window.document.querySelector<HTMLButtonElement>('.welink-sync-button')!;
    await click(refreshButton); await click(refreshButton);
    assert.equal(refreshCalls, 1); assert.equal(refreshButton.disabled, true);
    assert.ok(dom.window.document.querySelector('.welink-sync-warning'));
    await emitSync({ syncing: true, lastSuccessAt: null, error: '连接超时' });
    assert.equal(refreshButton.getAttribute('aria-busy'), 'true');
    await emitSync({ syncing: false, lastSuccessAt: Date.now(), error: '' });
    await act(async () => finish({ added: 0, updated: 0, removed: 0 }));
    assert.equal(dom.window.document.querySelector('.welink-sync-warning'), null);
    assert.equal(refreshButton.disabled, false);
    assert.match(dom.window.document.querySelector('.ai-config-success')!.textContent!, /新增 0、更新 0、移除 0/);
  });

  await t.test('a sync recovery clears its warning without clearing an unrelated login error', async () => {
    await mount(); authenticated = true; enabled = true; await emit({ done: true });
    await emit({ done: true, error: '登录验证失败' });
    await emitSync({ syncing: false, lastSuccessAt: null, error: '连接超时' });
    await emitSync({ syncing: false, lastSuccessAt: Date.now(), error: '' });
    assert.equal(dom.window.document.querySelector('.welink-sync-warning'), null);
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /登录验证失败/);
  });
});
