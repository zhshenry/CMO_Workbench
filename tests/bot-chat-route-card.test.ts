import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { AiStore } from '../electron/ai-store';
import { BotStore } from '../electron/bot-store';
import type { BotAction, BotProfile, BotTask } from '../shared/bot-contracts';

test('restored chat retires old routing cards and keeps original messages and business questions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-chat-route-card-'));
  const ai = new AiStore(directory, { recover: false });
  const store = new BotStore(ai, directory);
  const bot = store.all<BotProfile>('bots').find(item => item.seedKey === 'coordinator')!;
  const stamp = '2026-11-23T02:00:00.000Z';
  const question = '要把这句补充到哪项工作，还是单独处理？';
  const chat = ai.chat(bot.mainChatId);
  function seed(id: string, status: BotTask['status'], actionId: string, payload: BotAction['payload'], patch: Partial<BotTask> = {}) {
    const userId = `${id}:user`, input = `测试消息 ${id}`;
    store.insertTask({
      id, rootTaskId: id, sourceMessageId: userId, operationIds: [actionId], botId: bot.id, chatId: bot.mainChatId,
      kind: 'work', status, title: input, input, context: {}, resources: [], dependencyIds: [], revision: 1, createdAt: stamp, updatedAt: stamp, ...patch,
    });
    store.insertAction({
      id: actionId, taskId: id, botId: bot.id, kind: 'question', status: status === 'waiting_user' ? 'pending' : 'applied',
      revision: 0, createdAt: stamp, updatedAt: stamp, payload: { ...payload, options: [{ label: '选择部门' }] },
      ...(status !== 'waiting_user' && { receipt: { answer: id === 'business' ? '业务回答已保存' : '历史路由选择' } }),
    });
    chat.entries.push({ id: userId, role: 'user', content: input, createdAt: stamp });
    if (patch.assistantEntryId) chat.entries.push({ id: patch.assistantEntryId, role: 'assistant', content: '已答复', createdAt: stamp });
  }
  seed('old-one', 'cancelled', 'old-one:route', { question }, { queueDisposition: 'steered' });
  seed('old-two', 'completed', 'old-two:route', { question }, { assistantEntryId: 'old-two:assistant' });
  seed('old-pending', 'waiting_user', 'old-pending:route', { question }, { inputRoute: { intent: 'clarify', candidates: ['old-one'] } });
  seed('business', 'completed', 'business-question', { question: '业务补充提问' });
  seed('business-pending', 'waiting_user', 'business-question-pending', { question: '请选择部门归属' });
  ai.saveChat(chat);

  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(window, {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  window.HTMLElement.prototype.scrollTo = () => {};
  const globals = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] }));

  const reads: string[] = [];
  const listen = () => () => {};
  Object.assign(window, { workbench: {
    bot: {
      open: async () => ({ ...store.syncChat(chat.id), bot, history: [] }), syncChat: async () => store.syncChat(chat.id),
      listTasks: async () => store.tasks(bot.id), listArtifacts: async () => [], listSchedules: async () => [], onChatUpdate: listen, onChanged: listen, markRead: async () => {},
      getDraft: async () => ({ chatId: bot.mainChatId, surface: 'main', revision: 0, text: '', replyToTaskId: null, resources: [] }),
      getPendingSubmission: async () => null,
      getTask: async (id: string) => {
        reads.push(id);
        return { task: store.task(id), actions: store.actions(id), children: [], messages: [] };
      },
    },
    ai: { config: async () => ({ providers: [], models: [], aiEnabled: false }), onChat: listen, onConfigChanged: listen },
  } });

  const styles = registerHooks({ resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'data:text/javascript,export{}', shortCircuit: true } : next(specifier, context); } });
  let root: ReturnType<typeof import('react-dom/client')['createRoot']> | undefined;
  try {
    store.recover();
    const { BotPanel } = await import('../src/views/BotPanel');
    const { createRoot } = await import('react-dom/client');
    root = createRoot(window.document.getElementById('root')!);
    await act(async () => root!.render(createElement(BotPanel, { bot, cards: [bot], open: true, onClose() {}, onOpenSettings() {}, context: { scope: { module: 'todo' }, label: '日程待办', object: '' } })));

    assert.equal(document.querySelectorAll(`.bot-question[aria-label="${question}"]`).length, 0);
    const oldTasks = ['old-one', 'old-two', 'old-pending'];
    assert.ok(oldTasks.every(id => !reads.includes(id)));
    assert.ok(oldTasks.every(id => store.actions(id).length === 0));
    assert.equal(store.task('old-pending').status, 'cancelled');
    assert.equal(store.task('old-pending').inputRoute, undefined);
    assert.equal(store.action('old-pending:route').status, 'discarded');
    assert.deepEqual(store.action('old-two:route').receipt, { answer: '历史路由选择' });
    assert.match(document.body.textContent!, /业务回答已保存/);
    assert.match(document.body.textContent!, /测试消息 old-one/);
    assert.match(document.body.textContent!, /测试消息 old-pending/);
    const answer = document.querySelector<HTMLButtonElement>('.bot-question[aria-label="请选择部门归属"] button[aria-label="选择部门"]')!;
    await act(async () => answer.click());
    assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="提交回答"]')?.disabled, false);
  } finally {
    await act(async () => root?.unmount());
    styles.deregister(); window.close(); ai.close();
    globals.forEach((name, index) => previous[index] ? Object.defineProperty(globalThis, name, previous[index]!) : Reflect.deleteProperty(globalThis, name));
  }
});
