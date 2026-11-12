import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { initialIslandData, type IslandReminder, type IslandState } from '../shared/island-contracts';
import { newTask, type Task } from '../shared/todo-contracts';
import type { AgentMessage } from '../shared/agent-message-contracts';

test('mascot bubbles preserve reminder actions, unread messages and failure recovery', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'ResizeObserver' ? class { observe() {} disconnect() {} } : dom.window[name] }));
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLElement.prototype.hidePopover = () => {};
  dom.window.HTMLElement.prototype.showPopover = () => {};
  let state: IslandState = { ...initialIslandData(), mode: 'speech', pinned: false, quiet: false, fullscreenDetection: true };
  state.settings = { ...state.settings, dock: 'left', hoverPreview: false };
  let tasks: Task[] = [], dismissFails = false, updateFails = false;
  const listeners = new Set<(value: IslandState) => void>(), todoListeners = new Set<() => void>();
  const dismissed: string[] = [], health: string[] = [], updates: { id: string; patch: unknown; revision: string }[] = [], snoozed: string[] = [], opened: string[] = [];
  let readCalls = 0;
  const emit = () => listeners.forEach(listener => listener(structuredClone(state)));
  Object.defineProperty(dom.window, 'workbench', { value: {
    island: {
      state: async () => structuredClone(state), onError: () => () => {}, hold() {}, speechHeight() {}, quotas: async () => [],
      onChanged: (fn: (value: IslandState) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      mode: async (mode: IslandState['mode']) => { state.mode = mode; emit(); }, navigate: async () => {},
      dismiss: async (id: string) => {
        if (dismissFails) throw new Error('合成保存失败，请重试');
        dismissed.push(id); state.reminders = state.reminders.filter(reminder => reminder.id !== id);
        if (!state.reminders.length) state.mode = 'collapsed'; emit();
      },
      water: async (action: string) => { health.push(`water:${action}`); },
      sedentary: async (action: string) => { health.push(`sedentary:${action}`); },
      agentRead: async () => { readCalls++; },
      agentOpen: async (id: string) => { opened.push(id); return { state, hint: '已复制会话编号' }; },
    },
    todo: {
      state: async () => ({ tasks: structuredClone(tasks), categories: [] }),
      onChanged: (fn: () => void) => { todoListeners.add(fn); return () => { todoListeners.delete(fn); }; },
      snooze: async (id: string) => { snoozed.push(id); },
      update: async (id: string, patch: unknown, revision: string) => { updates.push({ id, patch, revision }); if (updateFails) throw new Error('合成完成失败，请重试'); },
    },
  } });
  const module = { exports: {} as any }, require = createRequire(import.meta.url);
  const code = buildSync({ entryPoints: ['src/views/DesktopIsland.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' } }).outputFiles[0].text;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  t.after(async () => {
    await act(async () => root.unmount()); assert.equal(listeners.size, 0); assert.equal(todoListeners.size, 0); dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!); else Reflect.deleteProperty(globalThis, name); });
  });
  await act(async () => root.render(createElement(module.exports.DesktopIslandApp)));
  const bubble = () => dom.window.document.querySelector<HTMLElement>('.island-speech')!;
  const button = (text: string) => [...bubble().querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  const click = async (node: HTMLElement) => { assert.ok(node, 'expected bubble control'); await act(async () => node.click()); };
  const seed = async (kind: IslandReminder['kind'], title = '合成提醒', source: Task['source'] = 'local') => act(async () => {
    const now = Date.now(), task = { ...newTask(title), id: 'task', kind, source, welinkMeetingId: source === 'welink' ? 123 : null, updatedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), completedAt: null, deletedAt: null } as Task;
    tasks = kind === 'task' || kind === 'meeting' ? [task] : [];
    state = { ...state, mode: 'speech', bubbleReminderId: kind, reminders: [{ id: kind, kind, title, createdAt: now, ...(tasks.length ? { taskId: task.id } : {}) }] };
    for (const listener of todoListeners) listener(); emit();
  });

  await t.test('AI can be deferred without marking it read and failed dismissal stays retryable', async () => {
    const now = Date.now();
    const message: AgentMessage = { id: 'message', provider: 'codeai', sessionId: 'session', turnId: 'turn', requestKey: '', workspace: 'C:/Projects/long_project', project: 'long_project', kind: 'reply', title: '分析完成', detail: '', transcriptPath: '', createdAt: now, updatedAt: now, readAt: null, resolvedAt: null };
    await seed('agent');
    await act(async () => { state.agentMessages = [message]; state.reminders[0].id = 'agent:message'; state.bubbleReminderId = 'agent:message'; emit(); });
    assert.match(bubble().textContent!, /有新回复/);
    assert.equal(Boolean(button('标已读')), false);
    dismissFails = true; await click(button('稍后'));
    assert.match(bubble().querySelector('[role="alert"]')!.textContent!, /保存失败/);
    assert.equal(button('稍后').disabled, false); assert.equal(state.mode, 'speech');
    dismissFails = false; await click(button('稍后'));
    assert.equal(readCalls, 0); assert.equal(state.agentMessages[0].readAt, null);
    assert.equal(dismissed.at(-1), 'agent:message'); assert.equal(state.mode, 'collapsed');
    await seed('agent');
    await act(async () => { state.agentMessages = [{ ...message, kind: 'failed' }]; state.reminders[0].id = 'agent:message'; state.bubbleReminderId = 'agent:message'; emit(); });
    assert.match(bubble().textContent!, /运行遇到了问题/);
    await click(button('复制会话编号')); assert.equal(opened.at(-1), 'message');
  });

  await t.test('water and activity keep their acknowledgement, snooze and one-time dismiss controls', async () => {
    for (const kind of ['water', 'sedentary'] as const) {
      await seed(kind);
      await click(button(kind === 'water' ? '已喝水' : '已活动'));
      assert.equal(health.at(-1), `${kind}:${kind === 'water' ? 'drink' : 'reset'}`);
      await click(button('稍后10分钟')); assert.equal(health.at(-1), `${kind}:snooze`);
      await click(bubble().querySelector('[aria-label="忽略本次提醒"]')!);
      assert.equal(dismissed.at(-1), kind);
    }
  });

  await t.test('todos require completion confirmation and retain retry after failure; meetings retain their type and snooze', async () => {
    await seed('task', '核对本周交付计划');
    await click(button('完成')); assert.equal(updates.length, 0);
    updateFails = true; await click(button('确认完成'));
    assert.match(bubble().querySelector('[role="alert"]')!.textContent!, /完成失败/);
    assert.equal(state.mode, 'speech'); assert.equal(button('确认完成').disabled, false);
    updateFails = false; await click(button('确认完成')); assert.equal(updates.length, 2); assert.equal(dismissed.at(-1), 'task');
    await seed('meeting', '数据模型评审会议');
    assert.equal(bubble().querySelector('.island-item-title.is-meeting small')!.textContent, '日程提醒');
    assert.equal(bubble().querySelector('.island-item-title.is-meeting span')!.textContent, '数据模型评审会议');
    assert.equal(Boolean(button('完成')), true);
    await click(button('稍后10分钟')); assert.equal(snoozed.at(-1), 'task'); assert.equal(dismissed.at(-1), 'meeting');
  });

  await t.test('task titles retain their type and full text for the non-scrolling preview', async () => {
    const title = '完成数据管理知识体系学习并整理本周任务进展，提交项目评审和复盘总结';
    await seed('task', title);
    assert.equal(bubble().querySelector('.island-item-title small')?.textContent, '待办提醒');
    assert.equal(bubble().querySelector('.island-item-title span')?.textContent, title);
    assert.equal(bubble().querySelector('.island-item-title span')?.getAttribute('title'), title);
  });

  await t.test('local and WeLink meetings confirm before completing and keep retry after failure', async () => {
    for (const source of ['local', 'welink'] as const) {
      await seed('meeting', '项目例会', source);
      const before = updates.length, dismissedBefore = dismissed.length;
      await click(button('完成'));
      assert.equal(updates.length, before);
      assert.equal(bubble().querySelector('.island-item-title small')?.textContent, '日程提醒');
      updateFails = true;
      await act(async () => { const confirm = button('确认完成'); confirm.click(); confirm.click(); });
      assert.equal(updates.length, before + 1);
      assert.equal(dismissed.length, dismissedBefore);
      assert.match(bubble().querySelector('[role="alert"]')!.textContent!, /完成失败/);
      assert.equal(button('确认完成').disabled, false);
      updateFails = false;
      await click(button('确认完成'));
      assert.deepEqual(updates.at(-1), { id: tasks[0].id, patch: { status: 'done' }, revision: tasks[0].updatedAt });
      assert.equal(dismissed.at(-1), 'meeting'); assert.equal(state.mode, 'collapsed');
    }
  });

  await t.test('summary hover waits 30ms and a short pass or moving onto the mascot cancels it', async clock => {
    clock.mock.timers.enable({ apis: ['setTimeout'] });
    const collapsed = async () => act(async () => {
      state = { ...state, mode: 'collapsed', reminders: [], settings: { ...state.settings, hoverPreview: true } }; emit();
    });
    const enter = async () => act(async () => {
      dom.window.document.documentElement.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
      dom.window.document.querySelector('.island-summary')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    });
    const tick = async (ms: number) => act(async () => clock.mock.timers.tick(ms));
    await collapsed(); await enter(); assert.equal(state.mode, 'collapsed');
    await tick(29); assert.equal(state.mode, 'collapsed');
    await tick(1); assert.equal(state.mode, 'expanded');
    await collapsed(); await enter(); await tick(20);
    await act(async () => dom.window.document.documentElement.dispatchEvent(new dom.window.MouseEvent('mouseleave')));
    await tick(30); assert.equal(state.mode, 'collapsed');
    await enter(); await tick(20);
    await act(async () => dom.window.document.querySelector('.island-summary')!.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: dom.window.document.querySelector('.island-mascot-entry') })));
    await tick(30); assert.equal(state.mode, 'collapsed');
    await act(async () => { state.settings.hoverPreview = false; emit(); });
  });

  await t.test('pending hover is cancelled when disabled and cannot replace a reminder that arrives meanwhile', async clock => {
    clock.mock.timers.enable({ apis: ['setTimeout'] });
    const enter = async () => act(async () => {
      state = { ...state, mode: 'collapsed', settings: { ...state.settings, hoverPreview: true } }; emit();
    });
    const hover = async () => act(async () => {
      dom.window.document.documentElement.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
      dom.window.document.querySelector('.island-summary')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    });
    await enter(); await hover();
    await act(async () => { state.settings.hoverPreview = false; emit(); });
    await act(async () => clock.mock.timers.tick(30));
    assert.equal(state.mode, 'collapsed');
    await enter(); await hover();
    await act(async () => { state.mode = 'speech'; emit(); });
    await act(async () => clock.mock.timers.tick(30)); assert.equal(state.mode, 'speech');
    await act(async () => { state.settings.hoverPreview = false; emit(); });
  });
});
