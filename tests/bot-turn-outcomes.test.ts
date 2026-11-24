import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { botEntryOutcome, projectBotTurnOutcomes } from '../src/bot-turn-outcomes';
import type { BotTask } from '../shared/bot-contracts';
import type { ChatEntry } from '../shared/todo-contracts';
import { AiStore } from '../electron/ai-store';
import { BotStore } from '../electron/bot-store';

const createdAt = new Date(1000).toISOString();
const prompt: ChatEntry = { id: 'prompt', role: 'user', content: '整理会前材料' };
const reply: ChatEntry = { id: 'reply', role: 'assistant', content: '已找到会议纪要。', createdAt, responseFinishedAt: 19000 };
const task: BotTask = {
  id: 'task', rootTaskId: 'task', botId: 'bot', chatId: 'chat', kind: 'chat', sourceMessageId: prompt.id,
  assistantEntryId: reply.id, assistantEntryIds: ['old-reply', reply.id], status: 'failed', title: prompt.content,
  input: prompt.content, context: {}, resources: [], operationIds: [], dependencyIds: [], revision: 0,
  createdAt, updatedAt: createdAt,
};

test('stop and timeout belong to the latest reply, preserving earlier text and the actual reason', () => {
  const older = { ...reply, id: 'old-reply' };
  const entries = [prompt, older, reply];
  const manual = projectBotTurnOutcomes(entries, [{ ...task, status: 'cancelled', reason: '用户已取消' }]);
  assert.equal(manual.outcomes.get(reply.id)?.kind, 'stopped');
  assert.equal(manual.outcomes.has(older.id), false);
  assert.equal(manual.hiddenReplies.size, 0);
  const reason = '任务超时：连续 3 分钟无进展，已自动停止。';
  assert.deepEqual(projectBotTurnOutcomes(entries, [{ ...task, reason }]).outcomes.get(reply.id),
    { kind: 'timeout', reason, taskId: task.id });
  assert.equal(projectBotTurnOutcomes(entries, [{ ...task, status: 'cancelled', reason: '用户未批准该操作' }]).outcomes.size, 0);
  assert.equal(botEntryOutcome({ ...reply, error: '已取消生成,输入内容已保留。' })?.kind, 'interrupted');
});

test('an empty failed reply is replaced by the status under its own prompt', () => {
  const empty = { ...reply, content: '', error: '模型连接失败' };
  const other = { ...prompt, id: 'other', content: '另一个工作' };
  const projection = projectBotTurnOutcomes([prompt, empty, other], [{ ...task, reason: empty.error }]);
  assert.deepEqual(projection.outcomes.get(prompt.id), { kind: 'failed', reason: empty.error, taskId: task.id });
  assert.deepEqual([...projection.hiddenReplies], [reply.id]);
  assert.equal(projection.outcomes.has(other.id), false);
  assert.equal(projectBotTurnOutcomes([prompt, other], [{ ...task, reason: empty.error }]).outcomes.size, 0);
  const withTool = { ...empty, tools: [{ id: 'read', name: 'read', label: '读取资料', output: '', status: 'complete' as const }] };
  const retained = projectBotTurnOutcomes([prompt, withTool], [{ ...task, reason: empty.error }]);
  assert.equal(retained.outcomes.get(reply.id)?.kind, 'failed');
  assert.equal(retained.hiddenReplies.size, 0);
});

test('a history page can restore a failed task with only a user message', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-turn-outcomes-'));
  const ai = new AiStore(directory, { recover: false }), store = new BotStore(ai, directory);
  try {
    const bot = store.cards().find(item => item.seedKey === 'coordinator')!;
    const draft = store.saveDraft(bot.mainChatId, 0, { text: prompt.content, replyToTaskId: null, resources: [] });
    const { task: requested } = store.submit({ botId: bot.id, chatId: bot.mainChatId, clientRequestId: randomUUID(),
      expectedDraftRevision: draft.revision, text: prompt.content, replyToTaskId: null, resources: [] }, () => {});
    store.updateTask(requested.id, { status: 'failed', reason: '模型连接失败' });
    const page = store.syncChat(bot.mainChatId);
    assert.ok('chat' in page);
    assert.deepEqual(page.pageTasks?.map(item => item.id), [requested.id]);
    const projection = projectBotTurnOutcomes(page.chat.entries, page.pageTasks ?? []);
    assert.equal(projection.outcomes.get(requested.sourceMessageId)?.kind, 'failed');
  } finally { ai.close(); }
});

test('a terminal process displays one disclosure with the correct detail action', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
  const names = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'IntersectionObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, {
    configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name],
  }));
  const { createRoot } = await import('react-dom/client');
  const { AiResponse, BotReplyProgress, ResponseProcess } = await import('../src/views/AiResponse');
  const { BotExecutionCard } = await import('../src/views/BotExecutionCard');
  const element = document.getElementById('root')!;
  const root = createRoot(element);
  const onOpenWork = () => { opened++; };
  let opened = 0;
  try {
    await act(async () => root.render(createElement(AiResponse, { entry: reply, showTimeline: true, outcome: { kind: 'stopped' } })));
    assert.equal(element.textContent?.trim(), '已停止 18s已找到会议纪要。');
    const reason = '任务超时：连续 3 分钟无进展，已自动停止。';
    await act(async () => root.render(createElement(AiResponse, { entry: reply, showTimeline: true, outcome: { kind: 'timeout', reason }, onOpenWork })));
    assert.equal(element.querySelectorAll('[data-outcome]').length, 1);
    assert.equal(element.querySelector('summary')?.textContent, '任务超时');
    const displayedReason = '连续 3 分钟无进展，已自动停止。';
    assert.equal(element.textContent?.includes(displayedReason), false);
    await act(async () => { element.querySelector('summary')!.click(); });
    assert.equal(element.querySelector('.bot-outcome-reason')?.textContent, displayedReason);
    assert.equal(element.querySelector('button'), null);
    await act(async () => root.render(createElement(ResponseProcess, { outcome: { kind: 'failed', reason: '模型连接失败' }, onOpenWork })));
    assert.equal(element.querySelector('summary')?.textContent, '执行失败');
    await act(async () => { element.querySelector('summary')!.click(); });
    assert.equal(element.querySelector('button')?.textContent, '查看工作详情');
    await act(async () => { element.querySelector('button')!.click(); });
    assert.equal(opened, 1);

    const output = JSON.stringify({ id: 'today', operationId: 'operation-42', revision: 8,
      changed: [{ id: 'today', before: { id: 'today', style: 'history' }, after: { id: 'today', style: 'counts' } }],
      privateNote: 'never displayed' });
    const executed: ChatEntry = { ...reply, thinking: 'internal reasoning', tools: [
      { id: 'edit', name: 'dashboard_edit', label: '修改看板', status: 'complete', output },
    ] };
    await act(async () => root.render(createElement(AiResponse, { entry: executed, businessChat: true })));
    assert.equal(element.querySelector('.bot-operation-card'), null);
    await act(async () => root.render(createElement(BotExecutionCard, { entry: executed })));
    const card = element.querySelector<HTMLElement>('.bot-operation-card')!;
    assert.equal(card.querySelector('strong')?.textContent, '日程待办卡片');
    assert.equal(card.querySelector('.bot-operation-copy small')?.textContent, '日程与待办对比图');
    assert.equal(card.querySelector('[role="status"]')?.textContent, '已完成');
    const target = card.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    assert.equal(card.querySelector<HTMLElement>('.bot-operation-details')?.hidden, true);
    await act(async () => target.click());
    assert.equal(card.querySelector<HTMLElement>('.bot-operation-details')?.hidden, false);
    assert.match(card.textContent!, /操作 · operation-42.*版本 · 8/);
    assert.doesNotMatch(card.textContent!, /never displayed|internal reasoning/);
    await act(async () => root.render(createElement(AiResponse, { entry: executed, businessChat: true, operationOwned: true })));
    assert.equal(element.querySelector('.bot-operation-card'), null);
    const live: ChatEntry = { ...executed, streaming: true, content: '', thinking: '先核对日期', tools: [
      { id: 'lookup', name: 'list_tasks', label: '读取事项和标签', status: 'running', output: '' },
    ] };
    await act(async () => root.render(createElement(BotReplyProgress, { avatar: 'square:violet', entry: live })));
    const progress = element.querySelector<HTMLDetailsElement>('.bot-reply-progress')!;
    assert.equal(progress.open, false);
    assert.ok(progress.querySelector('summary > .bot-avatar'));
    assert.equal(progress.querySelector('summary > svg'), null);
    assert.equal(progress.querySelector('summary [role="status"]')?.textContent, '查看待办和标签');
    assert.doesNotMatch(progress.textContent!, /先核对日期|list_tasks/);
    await act(async () => progress.querySelector('summary')!.click());
    assert.equal(progress.open, true);
    assert.match(progress.textContent!, /先核对日期/);
    assert.match(progress.textContent!, /读取事项和标签 list_tasks · 进行中/);
    await act(async () => progress.querySelector('summary')!.click());
    assert.equal(progress.open, false);

    let retried = 0;
    await act(async () => root.render(createElement(BotExecutionCard, { key: 'inline-recovery', entry: reply,
      conversation: true, outcome: { kind: 'failed', reason: '输出被截断' }, onRetry: () => { retried++; }, onOpenWork })));
    assert.equal(element.querySelector<HTMLElement>('.bot-operation-details')!.hidden, false);
    const retry = [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '继续处理')!;
    assert.ok(retry);
    await act(async () => retry.click());
    assert.equal(retried, 1);
    await act(async () => root.render(createElement(BotExecutionCard, { key: 'inline-recovery', entry: reply,
      conversation: true, outcome: { kind: 'failed' }, onRetry: () => { retried++; }, retryBusy: true })));
    assert.equal(element.querySelector<HTMLButtonElement>('.bot-action-buttons button')!.disabled, true);
    await act(async () => root.render(createElement(AiResponse, { key: 'history', entry: { ...reply,
      recoveryHistory: [{ ...reply, content: '上次尚未完成的答复', error: '输出被截断' }] }, businessChat: true })));
    const history = element.querySelector<HTMLDetailsElement>('.bot-recovery-history')!;
    assert.equal(history.open, false);
    assert.match(history.textContent!, /上次尚未完成的答复/);

    for (const phase of ['filling', 'ready', 'submitted', 'unknown'] as const) {
      const browserTask = { id: 'browser', workspace: 'permission-groups', goal: '创建项目群',
        tabIds: ['tab'], origins: ['https://fixture.invalid'], steps: [{ operation: 'click', status: 'ok', at: '' }],
        status: 'unverified', updatedAt: '', permissionGroup: { phase, formVerifiedAt: phase === 'ready' ? 'now' : undefined,
          error: '未读取到本群组的提交回执', draft: {}, tabId: 'tab', completed: [] } } as any;
      await act(async () => root.render(createElement(BotExecutionCard, { key: phase,
        entry: { ...reply, browserTask: { id: 'browser', workspace: 'permission-groups' } }, browserTask, conversation: true })));
      assert.equal(!!element.querySelector('.bot-operation-card'), phase === 'unknown', phase);
      if (phase === 'unknown') assert.match(element.textContent!, /未读取到本群组的提交回执/);
    }
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  }
});
