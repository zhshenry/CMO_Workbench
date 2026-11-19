import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { chatContextScope, chatScope, defaultAiScopeForWorkbench, sameAiScope, sameAiWorkbench, workbenchForScope } from '../shared/ai-scope';
import { buildWorkbenchContribution, withWorkbenchContext } from '../modules/workbench-ai';
import { NAV } from '../src/nav';
import { resolveAiReferences } from '../electron/ai-reference';
import type { AiReference } from '../shared/ai-reference';

test('旧对话原样保留，按工作台分组并持久化当前关联范围', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-scope-'));
  let store = new AiStore(dir);
  try {
    const legacy = store.newChat();
    delete legacy.module;
    delete legacy.contextScope;
    delete legacy.pageScope;
    legacy.draft = '待办输入';
    store.saveChat(legacy);
    const firstBook = store.newChat({ module: 'reading', profileId: 'book-1' });
    const otherBook = store.newChat({ module: 'reading', profileId: 'book-2' });
    firstBook.draft = '这个待办的安排';
    store.saveChat(firstBook);
    assert.deepEqual(store.chats().filter(chat => sameAiScope(chat, { module: 'reading', profileId: 'book-1' })).map(chat => chat.id), [firstBook.id]);
    assert.ok(sameAiScope(store.chat(legacy.id), { module: 'todo' }));
    assert.ok(!sameAiScope(store.chat(otherBook.id), { module: 'todo' }));
    assert.ok(sameAiWorkbench(store.chat(firstBook.id), { module: 'reading', profileId: 'book-2' }));
    assert.ok(sameAiWorkbench(store.chat(firstBook.id), { module: 'workbench', viewId: 'reading' }));
    firstBook.contextScope = { module: 'reading', profileId: 'book-2' };
    firstBook.pageScope = { module: 'workbench', viewId: 'reading' };
    store.saveChat(firstBook);
    store.close();
    store = new AiStore(dir);
    assert.equal(store.chat(legacy.id).draft, '待办输入');
    assert.equal(store.chat(firstBook.id).draft, '这个待办的安排');
    assert.deepEqual(chatContextScope(store.chat(firstBook.id)), { module: 'reading', profileId: 'book-2' });
    assert.deepEqual(store.chats().find(chat => chat.id === firstBook.id)?.pageScope, { module: 'workbench', viewId: 'reading' });
    const replacement = store.deleteChat(firstBook.id);
    assert.equal(replacement.id, otherBook.id);
    assert.equal(store.chat(otherBook.id).id, otherBook.id);
    assert.throws(() => store.chat(firstBook.id), /对话不存在/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('所有已上线页面都能归入一级工作台，未知页面不能跨对象借用权限', () => {
  for (const workbench of NAV) {
    for (const page of workbench.subs.filter(sub => sub.view)) {
      assert.equal(workbenchForScope({ module: 'workbench', viewId: page.view! }), workbench.id);
    }
  }
  assert.equal(workbenchForScope({ module: 'workbench', viewId: 'unknown-page' }), null);
  assert.ok(!sameAiWorkbench({ module: 'workbench', viewId: 'unknown-page' }, { module: 'reading', profileId: 'book-1' }));
  // 旧通知 viewId 转到 settings-data，归一在会话加载边界生效。
  // workbenchForScope 不再做局部归一;见「旧会话加载时把废弃 viewId 归一」测试用例。
});

test('独立待办页面继续使用旧待办对话，无需迁移历史', () => {
  assert.deepEqual(defaultAiScopeForWorkbench('todo'), { module: 'todo' });
  assert.equal(workbenchForScope({ module: 'todo' }), 'todo');
  assert.ok(sameAiWorkbench({}, { module: 'workbench', viewId: 'todo' }));
  assert.equal(NAV.findIndex(workbench => workbench.id === 'todo'), 1);
});

test('旧会话加载时把废弃 viewId 归一到当前等价页,上下文卡与历史关联不再泄漏原始 ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-legacy-view-'));
  let store = new AiStore(dir);
  try {
    // 直接写入一条带废弃 viewId 的旧持久化会话(模拟从 v1.1.0 之前升级的用户数据)
    const legacy = store.newChat({ module: 'workbench', viewId: 'settings-notifications' });
    legacy.contextScope = { module: 'workbench', viewId: 'settings-notifications' };
    store.saveChat(legacy);
    store.close();
    store = new AiStore(dir);
    const restored = store.chat(legacy.id);
    // chatScope 归一:裸 settings-notifications 不再泄漏到上下文卡(describeAiScope 回退链路)
    assert.deepEqual(chatScope(restored), { module: 'workbench', viewId: 'settings-data' });
    // chatContextScope 归一:持久化的 contextScope 也归一,不再回退携带原始 viewId
    assert.deepEqual(chatContextScope(restored), { module: 'workbench', viewId: 'settings-data' });
    // 归一后仍属设置工作台,同工作台判定不受影响
    assert.ok(sameAiWorkbench(restored, { module: 'workbench', viewId: 'settings-ai' }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('空的工作区可直接开启通用对话，但不获得业务数据或工具', () => {
  for (const workbench of NAV.filter(item => !item.pending)) {
    const initialScope = defaultAiScopeForWorkbench(workbench.id);
    assert.ok(initialScope);
    assert.equal(workbenchForScope(initialScope), workbench.id);
  }
  const scope = defaultAiScopeForWorkbench('permission')!;
  if (scope.module !== 'workbench') throw new Error('权限工作区需要通用对话范围');
  assert.deepEqual(scope, { module: 'workbench', viewId: 'workspace:permission' });
  assert.equal(workbenchForScope(scope), 'permission');
  const contribution = withWorkbenchContext(buildWorkbenchContribution(scope.viewId), scope);
  assert.deepEqual(contribution.toolNames, []);
  assert.match(contribution.systemPrompt(new Date()), /工作台「权限管理」/);
  assert.match(contribution.systemPrompt(new Date()), /没有具体页面或业务对象的业务数据或写入工具/);
});

test('对话摘要区分执行中、成功完成和中断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-status-'));
  let store = new AiStore(dir);
  try {
    const chat = store.newChat({ module: 'todo' });
    const status = () => {
      const { streaming, completed } = store.chats().find(item => item.id === chat.id)!;
      return { streaming, completed };
    };
    assert.deepEqual(status(), { streaming: false, completed: false });
    chat.entries.push({ id: 'user-1', role: 'user', content: '安排日程' }, { id: 'reply-1', role: 'assistant', content: '', streaming: true });
    store.saveChat(chat);
    assert.deepEqual(status(), { streaming: true, completed: false });
    chat.entries[1].streaming = false;
    chat.entries[1].content = '建议明天上午安排。';
    store.saveChat(chat);
    assert.deepEqual(status(), { streaming: false, completed: true });
    chat.entries.push({ id: 'user-2', role: 'user', content: '再调整一下' }, { id: 'reply-2', role: 'assistant', content: '', streaming: true });
    store.saveChat(chat);
    store.close();
    store = new AiStore(dir);
    assert.deepEqual(status(), { streaming: false, completed: false });
    assert.match(store.chat(chat.id).entries[3].error ?? '', /中断/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('历史对话重命名会持久化且不改动草稿，删除其他工作台对话不新建占位对话', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-rename-'));
  let store = new AiStore(dir);
  try {
    const book = store.newChat({ module: 'reading', profileId: 'book-1' });
    book.draft = '未发送的内容';
    store.saveChat(book);
    const renamed = store.renameChat(book.id, '  选题讨论  ');
    assert.equal(renamed.title, '选题讨论');
    assert.equal(renamed.titleEdited, true);
    assert.equal(renamed.draft, '未发送的内容');
    assert.throws(() => store.renameChat(book.id, '  '), /1–80 字/);
    renamed.entries.push({ id: 'reply', role: 'assistant', content: '', streaming: true });
    store.saveChat(renamed);
    assert.throws(() => store.renameChat(book.id, '进行中'), /正在生成/);
    renamed.entries[0].streaming = false;
    store.saveChat(renamed);
    const home = store.newChat({ module: 'todo' });
    store.close();
    store = new AiStore(dir);
    assert.equal(store.chat(book.id).title, '选题讨论');
    assert.equal(store.chat(book.id).titleEdited, true);
    assert.equal(store.deleteChat(book.id).id, home.id);
    assert.equal(store.chats().filter(chat => chat.module === 'reading').length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('参考发送快照随会话重启原样保留，兼容旧参考并保持主对象、页面和建议目标', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-reference-roundtrip-'));
  let store = new AiStore(dir);
  try {
    const primaryScope = { module: 'reading' as const, profileId: 'primary-book' };
    const pageScope = { module: 'workbench' as const, viewId: 'reading' };
    const reference: AiReference = { module: 'reading', profileId: 'reference-book' };
    const source = { id: 'reference-book', title: '发送时标题', author: '作者', status: 'reading', progressPct: 0, comment: '', tags: [], createdAt: '2026-10-12T12:00:00.000Z', updatedAt: '2026-10-12T12:00:00.000Z' };
    const referenceSnapshots = resolveAiReferences([reference], pageScope, primaryScope, {
      todo: { all: () => [], categories: () => [] },
      reading: { all: () => ({ books: [source] }) },
    }, { now: new Date('2026-10-12T12:00:00.000Z') });
    const legacy = store.newChat(primaryScope);
    legacy.entries = [{ id: 'old-user', role: 'user', content: '旧参考轮次', references: [reference] }];
    store.saveChat(legacy);
    const chat = store.newChat(primaryScope);
    chat.contextScope = primaryScope;
    chat.pageScope = pageScope;
    chat.entries = [
      { id: 'selected-user', role: 'user', content: '参考资料讨论', contextScope: primaryScope, pageScope, references: [reference], referenceSnapshots },
      { id: 'selected-reply', role: 'assistant', content: '请确认', contextScope: primaryScope, pageScope, references: [reference], referenceSnapshots, actionState: 'pending' },
    ];
    store.saveChat(chat);
    source.title = '发送后改名';
    store.close();
    store = new AiStore(dir);
    const restored = store.chat(chat.id);
    assert.deepEqual(restored.entries.map(entry => entry.referenceSnapshots), [referenceSnapshots, referenceSnapshots]);
    assert.match(restored.entries[0].referenceSnapshots![0].content, /发送时标题/);
    assert.ok(!restored.entries[0].referenceSnapshots![0].content.includes('发送后'));
    assert.deepEqual(chatContextScope(restored), primaryScope);
    assert.equal(restored.profileId, primaryScope.profileId);
    assert.deepEqual(restored.pageScope, pageScope);
    assert.equal(restored.entries[1].actionState, 'expired');
    assert.deepEqual(store.chat(legacy.id).entries[0].references, [reference]);
    assert.equal(store.chat(legacy.id).entries[0].referenceSnapshots, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
