import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { initialIslandData, type IslandState } from '../shared/island-contracts';

test('single-screen settings are read-only and multiple screens retain auto/fixed selection through display changes', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Node', 'navigator', 'sessionStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let state: IslandState = { ...initialIslandData(), mode: 'collapsed', pinned: false, quiet: false, fullscreenDetection: true };
  const panel = { id: 1, label: '内置屏 · 1440×900 · 主屏' }, external = { id: 2, label: '外接屏 · 1920×1080' };
  let displays = [panel], deferred = true, failed = false;
  const requests: ((value: typeof displays) => void)[] = [], listeners = new Set<(value: IslandState) => void>();
  Object.defineProperty(dom.window, 'workbench', { value: { island: {
    state: async () => structuredClone(state), onError: () => () => {}, quotas: async () => [], agentProjects: async () => ({ discovered: [], enabled: [] }),
    onChanged: (callback: (value: IslandState) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    displays: () => failed ? Promise.reject(new Error('合成读取失败')) : deferred ? new Promise<typeof displays>(resolve => requests.push(resolve)) : Promise.resolve(structuredClone(displays)),
    patch: async (patch: Record<string, unknown>) => { state = { ...state, settings: { ...state.settings, ...patch } }; return structuredClone(state); },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { IslandSettingsSection } = await import('../src/views/IslandSettings');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const selector = () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="灵动岛显示器"][aria-haspopup="listbox"]');
  const value = () => dom.window.document.querySelector('.island-display-value')?.textContent;
  const emit = async () => act(async () => { for (const listener of listeners) listener(structuredClone(state)); });
  const click = async (element: HTMLElement) => act(async () => element.click());
  const options = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="listbox"][aria-label="灵动岛显示器"] [role="option"]')];
  t.after(async () => {
    await act(async () => root.unmount()); assert.equal(listeners.size, 0); dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!); else Reflect.deleteProperty(globalThis, name); });
  });
  await act(async () => root.render(createElement(IslandSettingsSection, { query: '', resetSearch: () => {} })));
  assert.match(value() ?? '', /正在读取显示器/);
  await act(async () => requests.shift()!([panel]));
  assert.equal(selector(), null); assert.equal(value(), panel.label);
  assert.equal(state.settings.displayId, null);
  deferred = false; displays = [panel, external]; await emit();
  assert.equal(selector()!.textContent, '自动跟随主屏'); await click(selector()!);
  assert.deepEqual(options().map(option => option.textContent), ['自动跟随主屏', panel.label, external.label]);
  await click(options()[2]); assert.equal(state.settings.displayId, external.id); assert.equal(selector()!.textContent, external.label);
  displays = [panel]; await emit();
  assert.equal(selector(), null); assert.equal(value(), panel.label);
  assert.match(dom.window.document.body.textContent!, /已选显示器已断开，暂用主屏/);
  assert.equal(state.settings.displayId, external.id, 'disconnecting a fixed screen must not overwrite its saved selection');
  displays = [panel, external]; await emit(); assert.equal(selector()!.textContent, external.label);
  await click(selector()!); await click(options()[0]); assert.equal(state.settings.displayId, null);
  deferred = true; await emit(); await emit();
  assert.equal(requests.length, 2);
  await act(async () => requests[1]([panel, external]));
  await act(async () => requests[0]([panel]));
  assert.equal(selector()!.textContent, '自动跟随主屏', 'an older single-screen response must not overwrite a newer multi-screen response');
  deferred = false; displays = [panel];
  await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  assert.equal(selector(), null); assert.equal(value(), panel.label);
  failed = true; await emit();
  assert.equal(selector(), null); assert.equal(value(), '未读取到显示器');
  assert.match(dom.window.document.body.textContent!, /合成读取失败/);
});
