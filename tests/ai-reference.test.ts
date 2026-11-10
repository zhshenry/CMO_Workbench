import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { aiReferenceSchema, aiReferenceKey, aiReferenceMode, aiReferenceLimit, validateAiReferences, type AiReference } from '../shared/ai-reference';
import type { AiScope } from '../shared/ai-scope';
import { resolveAiReferences, withAiReferenceSnapshots, type AiReferenceSources } from '../electron/ai-reference';
import { runAgentLoop, type AiModuleContribution } from '../electron/ai-core';
import { buildTodoContribution, planFromReply, taskSnapshot } from '../modules/todo/ai-tools';
import { buildWorkbenchContribution } from '../modules/workbench-ai';
import { newTask, type Task } from '../shared/todo-contracts';
import type { BookEntry } from '../shared/reading-contracts';

const now = new Date('2026-10-12T12:00:00.000Z');
const task = (id = randomUUID(), updatedAt = now.toISOString()): Task => ({ ...newTask('事项标题'), id, createdAt: updatedAt, updatedAt, deletedAt: null, notifiedFor: null, completedAt: null });
const book = (id = 'reading-1'): BookEntry => ({ id, title: '书目标题', author: '作者甲', status: 'reading', progressPct: 25, comment: '书目短评', tags: ['学习'], createdAt: now.toISOString(), updatedAt: now.toISOString() });
const generic = (viewId: string): AiScope => ({ module: 'workbench', viewId });
function fixtures() {
  const tasks = [task()];
  const books = [book()];
  const reads = { todo: 0, reading: 0 };
  const sources: AiReferenceSources = {
    todo: { all: () => { reads.todo++; return tasks; }, categories: () => [] },
    reading: { all: () => { reads.reading++; return { books }; } },
  };
  return { tasks, books, reads, sources };
}
async function invoke(contribution: AiModuleContribution, name: string, params: Record<string, unknown>) {
  const tool = contribution.buildTools().find(item => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool.execute('test-call', params, new AbortController().signal);
}

test('参考标识独立于会话范围，严格校验字段和 ID，并保留旧书目形状', () => {
  const refs: AiReference[] = [
    { module: 'todo', taskId: 'same-id' },
    { module: 'reading', profileId: 'same-id' },
  ];
  assert.equal(new Set(refs.map(aiReferenceKey)).size, 2);
  for (const reference of refs) assert.deepEqual(aiReferenceSchema.parse(reference), reference);
  for (const id of ['', ' ', ' padded', 'two words', 'line\nbreak', '../file', 'folder\\file', 'x'.repeat(201), 'null\0byte']) {
    assert.equal(aiReferenceSchema.safeParse({ module: 'todo', taskId: id }).success, false, JSON.stringify(id));
  }
  for (const input of [
    { module: 'todo' }, { module: 'todo', profileId: 'x' },
    { module: 'workbench', viewId: 'reading' }, { module: 'reading', profileId: 'book', vaultPath: '/private' },
  ]) assert.equal(aiReferenceSchema.safeParse(input).success, false);
});

test('页面和主对象独立校验：阅读专属页面，规划与设置不提供参考', () => {
  const expected: Record<string, ReturnType<typeof aiReferenceMode>> = {
    home: 'todo',
    reading: 'reading', 'workspace:life': null, 'workspace:settings': null,
    'settings-ai': null, 'settings-data': null, web: null, unknown: null,
  };
  for (const [view, mode] of Object.entries(expected)) assert.equal(aiReferenceMode(generic(view)), mode, view);
  const readingReference: AiReference = { module: 'reading', profileId: 'selected' };
  assert.deepEqual(validateAiReferences([readingReference], generic('reading'), generic('workspace:life')), [readingReference]);
  for (const view of ['settings-ai', 'web', 'unknown']) assert.throws(() => validateAiReferences([readingReference], generic(view), generic(view)), /页面/);
  assert.deepEqual(validateAiReferences([], generic('settings-ai'), generic('settings-ai')), []);
});

test('事项和书目单选，不接受重复或与主对象相同的参考', () => {
  for (const mode of ['todo', 'reading'] as const) {
    assert.equal(aiReferenceLimit(mode), 1);
    const make = (id: string): AiReference => mode === 'todo' ? { module: mode, taskId: id } : { module: mode, profileId: id };
    const primary: AiScope = mode === 'todo' ? { module: 'todo' } : { module: mode, profileId: 'main' };
    const refs = Array.from({ length: aiReferenceLimit(mode) }, (_, i) => make(`selected-${i}`));
    assert.deepEqual(validateAiReferences(refs, generic(mode === 'todo' ? 'home' : mode), primary), refs);
    assert.throws(() => validateAiReferences([...refs, make('extra')], generic(mode === 'todo' ? 'home' : mode), primary), /1个/);
    assert.throws(() => validateAiReferences([make('duplicate'), make('duplicate')], generic(mode === 'todo' ? 'home' : mode), primary), /重复|1个/);
    if (mode !== 'todo') assert.throws(() => validateAiReferences([make('main')], generic(mode), primary), /无需重复/);
  }
});

test('参考从正确来源分派，缺失与软删除拒绝，未选来源不会读取', () => {
  const f = fixtures();
  const result = resolveAiReferences([{ module: 'reading', profileId: f.books[0].id }], generic('reading'), generic('workspace:life'), f.sources, { now });
  assert.match(result[0].content, /书目标题/);
  assert.equal(f.reads.todo, 0);
  f.books.splice(0);
  assert.throws(() => resolveAiReferences([{ module: 'reading', profileId: 'reading-1' }], generic('reading'), generic('workspace:life'), f.sources), /参考书目不存在/);
  const missing: AiReference[] = [{ module: 'todo', taskId: 'missing' }, { module: 'reading', profileId: 'missing' }];
  for (const reference of missing) assert.throws(() => resolveAiReferences([reference], generic(reference.module === 'todo' ? 'home' : reference.module), generic(reference.module === 'todo' ? 'home' : reference.module), f.sources), /不存在或已删除/);
  f.tasks[0].deletedAt = now.toISOString();
  assert.throws(() => resolveAiReferences([{ module: 'todo', taskId: f.tasks[0].id }], { module: 'todo' }, { module: 'todo' }, f.sources), /参考事项不存在/);
});

test('书目快照只包含已记录书目信息，绝不读取库路径、附件、笔记或设置', async () => {
  const f = fixtures();
  f.books[0] = { ...f.books[0], chapterCurrent: 2, chapterTotal: 8, rating: 4, link: { vault: 'SECRET_VAULT', folder: 'SECRET_FOLDER' } };
  Object.defineProperty(f.books[0], 'attachments', { get: () => { throw new Error('attachments must not be read'); } });
  Object.defineProperty(f.sources.reading, 'vaultPath', { get: () => { throw new Error('vault must not be read'); } });
  const snapshots = resolveAiReferences([{ module: 'reading', profileId: 'reading-1' }], generic('reading'), generic('workspace:life'), f.sources, { now });
  const text = snapshots[0].content;
  for (const expected of ['书目标题', '作者甲', '书目短评', 'progressPct', 'chapterCurrent', 'rating', '学习']) assert.ok(text.includes(expected), expected);
  for (const forbidden of ['SECRET', 'link', 'vault', 'attachment', 'createdAt', 'updatedAt', 'settings']) assert.ok(!text.includes(forbidden), forbidden);
  const contribution = withAiReferenceSnapshots(buildWorkbenchContribution('workspace:life'), snapshots);
  assert.deepEqual(contribution.toolNames, ['read_reference']);
  assert.equal(contribution.buildTools().some(tool => tool.name === 'read_book_note'), false);
  assert.deepEqual((await invoke(contribution, 'read_reference', { id: 'reading:reading-1' })).content, [{ type: 'text', text }]);
});

test('事项保留最近120条基线，明确选中的更早事项加入有效建议快照，未选旧事项仍不授权', async () => {
  const tasks = Array.from({ length: 123 }, (_, i) => task(randomUUID(), new Date(now.getTime() - i * 1000).toISOString()));
  const selected = tasks[121];
  selected.note = '这是更早事项的实际内容';
  const before = JSON.stringify(tasks);
  const baseline = taskSnapshot(tasks, []);
  const expanded = taskSnapshot(tasks, [], [selected.id]);
  assert.equal(baseline.context.length, 120);
  assert.deepEqual(expanded.context.slice(0, 120), baseline.context);
  assert.equal(expanded.context.length, 121);
  assert.equal(expanded.known.has(selected.id), true);
  assert.equal(expanded.known.has(tasks[122].id), false);
  assert.equal(taskSnapshot(tasks, [], [tasks[0].id, selected.id, selected.id]).context.length, 121);
  const f = fixtures();
  f.sources.todo.all = () => tasks;
  const snapshots = resolveAiReferences([{ module: 'todo', taskId: selected.id }], { module: 'todo' }, { module: 'todo' }, f.sources, { now });
  assert.match(snapshots[0].content, /实际内容/);
  const primary = buildTodoContribution(tasks, [], undefined, [selected.id]);
  const contribution = withAiReferenceSnapshots(primary, snapshots);
  assert.match(JSON.stringify((await invoke(contribution, 'propose_update', { id: tasks[122].id, status: 'done' })).content), /事项不存在/);
  assert.match(JSON.stringify((await invoke(contribution, 'propose_update', { id: selected.id, status: 'done' })).content), /等待用户确认/);
  const plan = planFromReply('待确认', primary.collect(), expanded.known);
  assert.deepEqual(plan.actions, [{ type: 'update', id: selected.id, patch: { status: 'done', source: 'local', welinkMeetingId: null } }]);
  assert.throws(() => planFromReply(JSON.stringify({ message: '伪造事项', actions: [{ type: 'remove', id: tasks[122].id }] }), [], expanded.known), /不存在的事项/);
  assert.equal(JSON.stringify(tasks), before);
});

test('真实模型请求包含选中快照，工具读取同一冻结文本而非发送后的业务内容', async () => {
  const f = fixtures();
  const snapshots = resolveAiReferences([{ module: 'todo', taskId: f.tasks[0].id }], { module: 'todo' }, { module: 'todo' }, f.sources, { now });
  const contribution = withAiReferenceSnapshots(buildTodoContribution(f.tasks, [], undefined, [f.tasks[0].id]), snapshots);
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    f.tasks[0].note = 'AFTER_SEND_EDIT';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = requests.length === 1
      ? { tool_calls: [{ index: 0, id: 'read-frozen', type: 'function', function: { name: 'read_reference', arguments: JSON.stringify({ id: `todo:${f.tasks[0].id}` }) } }] }
      : { content: '已按发送时参考回答。' };
    response.write(`data: ${JSON.stringify({ id: `completion-${requests.length}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: `completion-${requests.length}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await runAgentLoop({ endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-model', protocol: 'openai-chat', key: 'test-only' }, '参考这个事项', [], AbortSignal.timeout(15000), contribution);
    assert.equal(result.reply, '已按发送时参考回答。');
    assert.equal(requests.length, 2);
    const first = JSON.stringify(requests[0]);
    assert.ok(first.includes('事项标题'));
    const messages = requests[1].messages as { role: string; content: string }[];
    assert.equal(messages.find(message => message.role === 'tool')?.content, snapshots[0].content);
    assert.ok(!JSON.stringify(requests).includes('AFTER_SEND_EDIT'));
    assert.equal(f.reads.todo, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
