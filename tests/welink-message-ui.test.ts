import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { DEFAULT_APP_SETTINGS } from '../shared/contracts';
import type { WelinkMessageStatus } from '../shared/welink-reminders';

test('message reminders are opt-in, expose literal evidence, preserve errors for retry and acknowledge locally', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'sessionStorage', 'requestAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] });
  let saved = structuredClone(DEFAULT_APP_SETTINGS), fail = false;
  let status: WelinkMessageStatus = { syncing: false, lastSuccessAt: null, error: '', partial: false, account: 'me', conversations: 0, messages: 0, reminders: [] };
  const listeners = new Set<(value: WelinkMessageStatus) => void>(), dismissed: string[] = [];
  Object.defineProperty(dom.window, 'workbench', { value: {
    settings: { get: async () => structuredClone(saved), patch: async (patch: object) => { saved = { ...saved, ...patch }; return structuredClone(saved); } },
    island: {
      welinkMessagesStatus: async () => structuredClone(status),
      onWelinkMessagesChanged: (listener: (value: WelinkMessageStatus) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      welinkMessagesRefresh: async () => { if (fail) throw new Error('连接失败，请重试'); return structuredClone(status); },
      welinkMessagesDismiss: async (id: string) => { dismissed.push(id); status = { ...status, reminders: status.reminders.filter(item => item.id !== id) }; return structuredClone(status); },
    },
  } });
  const { createRoot } = await import('react-dom/client');
  const { WelinkMessageSettings } = await import('../src/views/WelinkMessageSettings');
  const root = createRoot(dom.window.document.getElementById('root')!);
  t.after(async () => {
    await act(async () => root.unmount()); assert.equal(listeners.size, 0); dom.window.close();
    names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : Reflect.deleteProperty(globalThis, name));
  });
  const render = async (authenticated: boolean) => act(async () => root.render(createElement(WelinkMessageSettings, { authenticated })));
  const button = (text: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
  await render(false);
  const toggle = dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!;
  assert.equal(toggle.disabled, true); assert.equal(toggle.getAttribute('aria-checked'), 'false');
  await render(true); await act(async () => toggle.click());
  assert.equal(saved.welinkMessages.enabled, true); assert.equal(toggle.getAttribute('aria-checked'), 'true');
  status = { ...status, partial: true, error: '部分历史未取全', messages: 1, conversations: 1, lastSuccessAt: Date.now(), reminders: [{ id: 'welink-message:fixture', kind: 'awaiting', title: '可能待回复 · 同事', source: { id: '123', conversation: 'user:other', conversationName: '同事', sender: 'other', mine: false, atMe: false, group: false, at: Date.now(), text: '<img src=x onerror=alert(1)> 请确认时间？' } }] };
  await act(async () => button('立即检查').click());
  assert.match(dom.window.document.body.textContent!, /部分历史未取全/);
  assert.match(dom.window.document.querySelector('details p')!.textContent!, /<img/);
  assert.equal(dom.window.document.querySelector('img'), null);
  assert.match(dom.window.document.querySelector('details')!.textContent!, /123/);
  fail = true; await act(async () => button('立即检查').click());
  assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /连接失败/);
  assert.ok(dom.window.document.querySelector('details'));
  fail = false; await act(async () => button('已处理').click());
  assert.deepEqual(dismissed, ['welink-message:fixture']); assert.equal(dom.window.document.querySelector('details'), null);
  await act(async () => toggle.click()); assert.equal(saved.welinkMessages.enabled, false);
});
