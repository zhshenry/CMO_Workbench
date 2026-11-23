import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import type { AiConfig } from '../shared/workbench-api';
import { botSeeds } from '../shared/bot-contracts';

test('Bot composer keeps a saved model update over an older initial read without losing its draft', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(dom.window, {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const names = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  const bot = { ...botSeeds[0], modelId: 'model', id: randomUUID(), mainChatId: randomUUID(), enabled: true, revision: 1, updatedAt: new Date().toISOString(), capabilities: [] };
  const chat = { id: bot.mainChatId, title: bot.name, updatedAt: bot.updatedAt, entries: [], draft: '' };
  const snapshot = { chat, sequence: 0, epoch: 'fixture', hasEarlier: false, hasLater: false, liveEntries: [], toolReplyIds: [] };
  const empty: AiConfig = { providers: [], models: [], activeModelId: '', aiEnabled: false, hasConnection: false, rlcdProviders: [], rlcdModels: [], activeRlcdModelId: '' };
  let resolveInitial!: (value: AiConfig) => void;
  const initial = new Promise<AiConfig>(resolve => { resolveInitial = resolve; });
  const listeners = new Set<(value: AiConfig) => void>();
  const changed = new Set<() => void>();
  Object.assign(dom.window, { workbench: {
    bot: {
      open: async () => ({ ...snapshot, bot, history: [] }), syncChat: async () => snapshot,
      listTasks: async () => [], listArtifacts: async () => [], listSchedules: async () => [], onChatUpdate: () => () => {}, markRead: async () => {},
      onChanged: (listener: () => void) => { changed.add(listener); return () => changed.delete(listener); },
      getPendingSubmission: async () => null,
      getDraft: async () => ({ chatId: bot.mainChatId, surface: 'main', revision: 0, text: '保留 Bot 草稿', replyToTaskId: null, resources: [] }),
    },
    ai: {
      config: () => initial, onChat: () => () => {},
      onConfigChanged: (listener: (value: AiConfig) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    },
  } });
  const { createRoot } = await import('react-dom/client');
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'data:text/javascript,export{}', shortCircuit: true } : next(specifier, context); } });
  const { BotPanel } = await import('../src/views/BotPanel');
  hooks.deregister();
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(BotPanel, { bot, cards: [bot], open: true, onClose() {}, onOpenSettings() {}, context: { scope: { module: 'todo' }, label: '日程和待办', object: '' } })));
    const input = document.querySelector<HTMLTextAreaElement>('.bot-panel textarea')!;
    assert.equal(input.value, '保留 Bot 草稿');
    const configured: AiConfig = { ...empty, aiEnabled: true, providers: [{ id: 'provider', kind: 'custom', name: 'Fixture', endpoint: '', protocol: 'openai-chat', hasKey: false }], models: [{ id: 'model', providerId: 'provider', name: 'Bot first model' }], activeModelId: 'model', hasConnection: true };
    await act(async () => listeners.forEach(listener => listener(configured)));
    await act(async () => resolveInitial(empty));
    await act(async () => document.querySelector<HTMLButtonElement>('.bot-identity-pill')!.click());
    const selector = document.querySelector('#bot-inspector [aria-label="此 Bot 的模型"]');
    assert.equal(selector?.querySelector('strong')?.textContent, 'Bot first model');
    assert.equal(selector?.querySelector('small')?.textContent, 'Fixture');
    assert.equal(input.disabled, false);
    assert.equal(input.value, '保留 Bot 草稿');
    assert.equal(document.querySelector('.bot-panel textarea'), input);
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(listeners.size, 0); assert.equal(changed.size, 0);
    dom.window.close();
    names.forEach((name, index) => previous[index] ? Object.defineProperty(globalThis, name, previous[index]!) : Reflect.deleteProperty(globalThis, name));
  }
});
