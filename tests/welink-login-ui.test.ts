import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { DEFAULT_APP_SETTINGS } from '../shared/contracts';
import type { WelinkSyncStatus, WelinkWeekStatus } from '../shared/island-contracts';

test('WeLink login reports QR preparation and preserves cancellation and retry', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'FormData', 'Node', 'navigator', 'sessionStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  const listeners = new Set<(event: { done: boolean; qrAscii?: string; error?: string }) => void>();
  const syncListeners = new Set<(status: WelinkSyncStatus) => void>();
  let authenticated = false, loginCalls = 0, cancelCalls = 0, mountId = 0;
  const uid = 'demouser';
  const settingsPatches: object[] = [];
  let enabled = false, refreshCalls = 0;
  let sync: WelinkSyncStatus = { syncing: false, lastSuccessAt: null, error: '' };
  let refreshAction = () => Promise.resolve({ added: 0, updated: 0, removed: 0 });
  let week: WelinkWeekStatus = { automatic: false, error: '' };
  const weekReads: unknown[][] = [];
  const destinations: unknown[] = [];
  let loginFailure: Error | null = null, statusFailure: Error | null = null;
  let statusWait: Promise<void> | undefined;
  Object.defineProperty(dom.window, 'workbench', { value: {
    settings: {
      get: async () => structuredClone(DEFAULT_APP_SETTINGS),
      patch: async (patch: object) => { settingsPatches.push(patch); return { ...DEFAULT_APP_SETTINGS, ...patch }; },
    },
    auth: { hasCredentials: async () => false },
    island: {
      welinkMessagesStatus: async () => ({ syncing: false, lastSuccessAt: null, error: '', partial: false, account: '', conversations: 0, messages: 0, reminders: [] }),
      onWelinkMessagesChanged: () => () => {},
      welinkEmployeeNumber: async () => null,
      welinkStatus: async () => {
        if (statusWait) await statusWait;
        if (statusFailure) throw statusFailure;
        return { authenticated, uid: authenticated ? uid : undefined, enabled, sync: { ...sync } };
      },
      welinkLogin: async () => { loginCalls++; if (loginFailure) throw loginFailure; },
      welinkCancelLogin: async () => { cancelCalls++; listeners.forEach(listener => listener({ done: true, error: '已取消' })); },
      onWelinkLoginEvent: (listener: (event: { done: boolean; qrAscii?: string; error?: string }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onWelinkSyncChanged: (listener: (status: WelinkSyncStatus) => void) => { syncListeners.add(listener); return () => syncListeners.delete(listener); },
      welinkRefresh: () => { refreshCalls++; return refreshAction(); },
      welinkWeek: async (...args: unknown[]) => { weekReads.push(args); return week; },
      navigate: async (value: unknown) => { destinations.push(value); },
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
    assert.match(dom.window.document.body.textContent!, /已登录（demouser）/);
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

  await t.test('mailbox settings are separate and only offer manual entry for the current account after setup fails', async () => {
    await mount();
    const card = dom.window.document.querySelector<HTMLElement>('section[aria-label="邮箱日历"]')!;
    assert.equal(card.previousElementSibling?.getAttribute('aria-label'), 'WeLink 接入');
    assert.match(card.textContent!, /请先连接 WeLink/);
    assert.equal(card.querySelector('details'), null);
    authenticated = true;
    await emit({ done: true });
    const temporary = { state: 'error', count: 0, lastSuccessAt: null, error: '网络超时' } as const;
    const needsSetup = { ...temporary, error: '邮箱服务尚未配置', mailboxNeedsSetup: true } as const;
    await emitSync({ syncing: false, lastSuccessAt: null, error: temporary.error, mailbox: { account: uid, source: temporary } });
    assert.match(card.textContent!, /暂时不可用/);
    assert.equal(card.querySelector('details'), null);
    await emitSync({ syncing: false, lastSuccessAt: null, error: needsSetup.error, mailbox: { account: 'anotheruser', source: needsSetup } });
    assert.equal(card.querySelector('details'), null);
    await emitSync({ syncing: false, lastSuccessAt: null, error: needsSetup.error, mailbox: { account: uid, source: needsSetup } });
    const options = card.querySelector('details')!;
    assert.equal(options.open, false);
    assert.match(card.textContent!, /需要配置邮箱/);
    await click(options.querySelector('summary')!);
    assert.equal(options.open, true);
    const email = options.querySelector('input')!;
    const save = options.querySelector('button')!;
    email.value = 'bad-address'; await click(save);
    assert.match(card.textContent!, /请填写有效的企业邮箱/);
    assert.equal(settingsPatches.length, 0);
    refreshAction = async () => {
      const lastSuccessAt = Date.now();
      sync = { syncing: false, lastSuccessAt, error: '', mailbox: { account: uid, source: { state: 'success', count: 1, lastSuccessAt, error: '' } } };
      syncListeners.forEach(listener => listener(sync));
      return { added: 1, updated: 0, removed: 0 };
    };
    email.value = 'me@example.com'; await click(save);
    assert.deepEqual(settingsPatches, [{ welinkEmail: 'me@example.com', welinkEmailAccount: uid }]);
    assert.equal(refreshCalls, 1);
    assert.equal(card.querySelector('details'), null);
    assert.match(card.textContent!, /已同步 1 条/);
  });

  await t.test('an open calendar reports a background login failure and refreshes its range on recovery', async () => {
    const styles = registerHooks({ load(url, context, next) {
      return url.endsWith('/task-source-badge.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
    } });
    const { WelinkWeekCoverage } = await import('../src/views/WelinkSchedule').finally(() => styles.deregister());
    const lastSuccessAt = Date.parse('2026-11-18T01:00:00Z');
    const fresh = { state: 'success' as const, lastSuccessAt, count: 1, error: '' };
    const expired = { ...fresh, state: 'error' as const, error: '登录已失效' };
    week = { automatic: false, error: '' };
    weekReads.length = 0;
    const text = () => dom.window.document.querySelector('.calendar-coverage-status')!.textContent!;
    const waitForRead = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    const toolbar = dom.window.document.createElement('div');
    const nextToolbar = dom.window.document.createElement('div');
    dom.window.document.body.append(toolbar, nextToolbar);
    const show = (toolbarTarget: HTMLDivElement) => act(async () => root.render(createElement(WelinkWeekCoverage, { start: '2026-11-23', end: '2026-11-30', toolbarTarget })));
    await show(toolbar);
    await waitForRead();
    assert.equal(text(), '');
    assert.doesNotMatch(toolbar.textContent!, /自动同步已关闭/);
    assert.deepEqual(weekReads, [['2026-11-23', '2026-11-30', false]]);
    const refreshButton = toolbar.querySelector('button')!;
    assert.equal(refreshButton.textContent, '');
    assert.ok(refreshButton.querySelector('svg'));
    assert.equal(refreshButton.getAttribute('aria-label'), '刷新外部日程');
    assert.equal(refreshButton.title, '刷新外部日程');
    week = { automatic: false, connection: 'ready', sources: { meeting: fresh, calendar: fresh }, error: '' };
    await click(refreshButton);
    await show(nextToolbar);
    await waitForRead();
    assert.equal(toolbar.childElementCount, 0);
    assert.deepEqual(weekReads, [['2026-11-23', '2026-11-30', false], ['2026-11-23', '2026-11-30', true]]);
    assert.match(nextToolbar.querySelector('button')!.title, /邮箱日历：已更新/);
    assert.match(text(), /邮箱日历：已更新/);
    week = { ...week, connection: 'needs-login', error: expired.error, sources: { meeting: expired, calendar: expired } };
    await emitSync({ syncing: false, lastSuccessAt, connection: 'needs-login', error: expired.error });
    await waitForRead();
    assert.match(text(), /需要重新扫码/);
    assert.match(text(), /邮箱日历：未更新 · 含缓存/);
    assert.equal(nextToolbar.querySelector('button')!.getAttribute('aria-label'), '重新扫码');
    await click(nextToolbar.querySelector('button')!);
    assert.deepEqual(destinations, [{ view: 'settings-welink' }]);
    const reloaded = { ...fresh, lastSuccessAt: lastSuccessAt + 3600000 };
    week = { ...week, connection: 'ready', error: '', sources: { meeting: reloaded, calendar: reloaded } };
    await emitSync({ syncing: false, lastSuccessAt: reloaded.lastSuccessAt, connection: 'ready', error: '' });
    await waitForRead();
    assert.doesNotMatch(text(), /需要重新扫码/);
    assert.match(text(), /邮箱日历：已更新.*10:00/);
  });
});
