import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { chatContextScope, defaultAiScopeForWorkbench, sameAiScope, sameAiWorkbench, workbenchForScope } from '../shared/ai-scope';
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
    const firstArticle = store.newChat({ module: 'copy', draftId: 'article-1' });
    const otherArticle = store.newChat({ module: 'copy', draftId: 'article-2' });
    firstArticle.draft = '这个待办的安排';
    store.saveChat(firstArticle);
    assert.deepEqual(store.chats().filter(chat => sameAiScope(chat, { module: 'copy', draftId: 'article-1' })).map(chat => chat.id), [firstArticle.id]);
    assert.ok(sameAiScope(store.chat(legacy.id), { module: 'todo' }));
    assert.ok(!sameAiScope(store.chat(otherArticle.id), { module: 'todo' }));
    assert.ok(sameAiWorkbench(store.chat(firstArticle.id), { module: 'copy', draftId: 'article-2' }));
    assert.ok(sameAiWorkbench(store.chat(firstArticle.id), { module: 'workbench', viewId: 'copy-publish' }));
    firstArticle.contextScope = { module: 'copy', draftId: 'article-2' };
    firstArticle.pageScope = { module: 'workbench', viewId: 'copy-publish' };
    store.saveChat(firstArticle);
    store.close();
    store = new AiStore(dir);
    assert.equal(store.chat(legacy.id).draft, '待办输入');
    assert.equal(store.chat(firstArticle.id).draft, '这个待办的安排');
    assert.deepEqual(chatContextScope(store.chat(firstArticle.id)), { module: 'copy', draftId: 'article-2' });
    assert.deepEqual(store.chats().find(chat => chat.id === firstArticle.id)?.pageScope, { module: 'workbench', viewId: 'copy-publish' });
    const replacement = store.deleteChat(firstArticle.id);
    assert.equal(replacement.id, otherArticle.id);
    assert.equal(store.chat(otherArticle.id).id, otherArticle.id);
    assert.equal(store.chat(firstArticle.id).id, firstArticle.id);
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
  assert.ok(!sameAiWorkbench({ module: 'workbench', viewId: 'unknown-page' }, { module: 'copy', draftId: 'article-1' }));
});

test('空的自媒体工作区可直接开启通用对话，但不获得博客数据或工具', () => {
  for (const workbench of NAV.filter(item => !item.pending)) {
    const initialScope = defaultAiScopeForWorkbench(workbench.id);
    assert.ok(initialScope);
    assert.equal(workbenchForScope(initialScope), workbench.id);
  }
  const scope = defaultAiScopeForWorkbench('media')!;
  if (scope.module !== 'workbench') throw new Error('自媒体工作区需要通用对话范围');
  assert.deepEqual(scope, { module: 'workbench', viewId: 'workspace:media' });
  assert.equal(workbenchForScope(scope), 'media');
  assert.ok(sameAiWorkbench({ module: 'copy', draftId: 'article-1' }, scope));
  const contribution = withWorkbenchContext(buildWorkbenchContribution(scope.viewId), scope);
  assert.deepEqual(contribution.toolNames, []);
  assert.match(contribution.systemPrompt(new Date()), /工作台「自媒体工作台」/);
  assert.match(contribution.systemPrompt(new Date()), /没有具体页面或业务对象的业务数据或写入工具/);
  assert.ok(!contribution.systemPrompt(new Date()).includes('article-1'));
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
    const blog = store.newChat({ module: 'copy', draftId: 'blog-1' });
    blog.draft = '未发送的内容';
    store.saveChat(blog);
    const renamed = store.renameChat(blog.id, '  选题讨论  ');
    assert.equal(renamed.title, '选题讨论');
    assert.equal(renamed.titleEdited, true);
    assert.equal(renamed.draft, '未发送的内容');
    assert.throws(() => store.renameChat(blog.id, '  '), /1–80 字/);
    renamed.entries.push({ id: 'reply', role: 'assistant', content: '', streaming: true });
    store.saveChat(renamed);
    assert.throws(() => store.renameChat(blog.id, '进行中'), /正在生成/);
    renamed.entries[0].streaming = false;
    store.saveChat(renamed);
    const home = store.newChat({ module: 'todo' });
    store.close();
    store = new AiStore(dir);
    assert.equal(store.chat(blog.id).title, '选题讨论');
    assert.equal(store.chat(blog.id).titleEdited, true);
    assert.equal(store.deleteChat(blog.id).id, home.id);
    assert.equal(store.chats().filter(chat => chat.module === 'copy').length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('参考发送快照随会话重启原样保留，兼容旧参考并保持主对象、页面和建议目标', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ai-reference-roundtrip-'));
  let store = new AiStore(dir);
  try {
    const primaryScope = { module: 'copy' as const, draftId: 'primary-blog' };
    const pageScope = { module: 'workbench' as const, viewId: 'media-browser' };
    const reference: AiReference = { module: 'copy', draftId: 'reference-blog' };
    const source = { id: 'reference-blog', title: '发送时标题', body: '发送时实际正文', platform: 'xiaohongshu' as const, createdAt: '2026-10-12T12:00:00.000Z', updatedAt: '2026-10-12T12:00:00.000Z' };
    const referenceSnapshots = resolveAiReferences([reference], pageScope, primaryScope, {
      todo: { all: () => [], categories: () => [] }, copy: { get: () => source },
      reading: { all: () => ({ books: [] }) },
    }, { now: new Date('2026-10-12T12:00:00.000Z') });
    const legacy = store.newChat(primaryScope);
    legacy.entries = [{ id: 'old-user', role: 'user', content: '旧参考轮次', references: [reference] }];
    store.saveChat(legacy);
    const chat = store.newChat(primaryScope);
    chat.contextScope = primaryScope;
    chat.pageScope = pageScope;
    chat.entries = [
      { id: 'selected-user', role: 'user', content: '参考资料改写主博客', contextScope: primaryScope, pageScope, references: [reference], referenceSnapshots },
      { id: 'selected-reply', role: 'assistant', content: '请确认', contextScope: primaryScope, pageScope, references: [reference], referenceSnapshots, copyProposal: { token: 'pending-copy', message: '请确认', actions: [{ kind: 'edit', text: '等待确认的建议正文' }], original: { title: '主博客标题', body: '主博客原文' } }, actionState: 'pending' },
    ];
    store.saveChat(chat);
    source.title = '发送后改名';
    source.body = '发送后改文';
    store.close();
    store = new AiStore(dir);
    const restored = store.chat(chat.id);
    assert.deepEqual(restored.entries.map(entry => entry.referenceSnapshots), [referenceSnapshots, referenceSnapshots]);
    assert.match(restored.entries[0].referenceSnapshots![0].content, /发送时实际正文/);
    assert.ok(!restored.entries[0].referenceSnapshots![0].content.includes('发送后'));
    assert.deepEqual(chatContextScope(restored), primaryScope);
    assert.equal(restored.draftId, primaryScope.draftId);
    assert.deepEqual(restored.pageScope, pageScope);
    assert.deepEqual(restored.entries[1].copyProposal, chat.entries[1].copyProposal);
    assert.equal(restored.entries[1].actionState, 'expired');
    assert.deepEqual(store.chat(legacy.id).entries[0].references, [reference]);
    assert.equal(store.chat(legacy.id).entries[0].referenceSnapshots, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
