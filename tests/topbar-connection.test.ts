import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import type { WelinkStatus } from '../shared/island-contracts';

const status = (connection: NonNullable<WelinkStatus['connection']>): WelinkStatus => ({
  connection, authenticated: connection === 'ready', enabled: true, sync: { syncing: false, lastSuccessAt: null, error: '' },
});

test('the topbar shows separate connection states and ignores an older WeLink result', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, {
    configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name],
  }));
  let onAuthChanged: (() => void) | undefined;
  let finishInitial!: (value: WelinkStatus) => void;
  let read = () => new Promise<WelinkStatus>(resolve => { finishInitial = resolve; });
  Object.assign(dom.window, { workbench: { island: {
    welinkStatus: () => read(),
    onWelinkAuthChanged: (callback: () => void) => { onAuthChanged = callback; return () => { onAuthChanged = undefined; }; },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { TopbarConnectionStatus } = await import('../src/views/TopbarConnectionStatus');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = (w3Configured: boolean) => act(async () => root.render(createElement(TopbarConnectionStatus, { w3Configured, onOpen() {}, onSettings() {} })));
  const dot = () => !!dom.window.document.querySelector('.topbar-connection-dot');
  const states = () => [...dom.window.document.querySelectorAll('.topbar-connection-state')].map(node => node.textContent);
  const emit = (connection: NonNullable<WelinkStatus['connection']>) => act(async () => {
    read = async () => status(connection);
    onAuthChanged?.();
  });
  try {
    await render(true);
    const button = dom.window.document.querySelector('.topbar-connection-trigger')!;
    assert.equal(button.textContent, '');
    assert.equal(dot(), false);
    await emit('ready');
    await act(async () => finishInitial(status('needs-login')));
    assert.deepEqual(states(), ['已登录', '已设置账号']);
    assert.equal(dot(), false);
    await render(false);
    assert.deepEqual(states(), ['已登录', '未设置账号']);
    assert.equal(dot(), true);
    await render(true);
    await emit('needs-login');
    assert.deepEqual(states(), ['未登录', '已设置账号']);
    assert.equal(dot(), true);
    await emit('client-closed');
    assert.deepEqual(states(), ['客户端未打开', '已设置账号']);
    assert.equal(dot(), true);
    await emit('temporary');
    assert.deepEqual(states(), ['暂无法确认', '已设置账号']);
    assert.equal(dot(), false);
  } finally {
    await act(async () => root.unmount());
    assert.equal(onAuthChanged, undefined);
    dom.window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
