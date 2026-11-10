import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AiStore } from '../electron/ai-store';
import { Store } from '../modules/todo/store';
import { ReadingStore } from '../modules/reading/store';
import { newTask } from '../shared/todo-contracts';
import type { AiTurnContext } from '../shared/ai-reference';
import type { BrowserAutomation } from '../electron/browser/tasks';

// Only Electron's process transport is replaced. Handlers, stores, model loop,
// reference resolution, proposal collection and explicit apply all run for real.
test('真实 ai:ask 拒绝越界输入后不解密、不存消息；发送冻结并持久化内容，应用仍确认原目标', async () => {
  const symbol = `reference-ipc-${randomUUID()}`;
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const state = { handlers, decryptions: 0 };
  const globals = globalThis as unknown as Record<symbol, typeof state>;
  globals[Symbol.for(symbol)] = state;
  const source = `const state = globalThis[Symbol.for(${JSON.stringify(symbol)})];
    export const ipcMain = { handle: (name, fn) => state.handlers.set(name, fn), on: () => {} };
    export const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: buffer => { state.decryptions++; return buffer.toString(); } };
    export const BrowserWindow = { getAllWindows: () => [] };
    export const shell = { openExternal: async () => {} };
    export const app = { isPackaged: false, getAppPath: () => '' };`;
  const mockUrl = `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'electron' ? { url: mockUrl, shortCircuit: true } : nextResolve(specifier, context);
  } });
  const { registerAiIpc } = await import('../electron/ai-ipc');
  hooks.deregister();
  const dir = mkdtempSync(join(tmpdir(), 'wb-reference-ipc-'));
  let ai = new AiStore(dir);
  const todo = new Store(join(dir, 'tasks.db'), 'shared-tasks');
  const reading = new ReadingStore(dir);
  const requests: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }[] = [];
  let action: { name: string; arguments: Record<string, unknown> } | undefined;
  let firstRequest = true;
  let onFirstRequest: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const callTool = firstRequest && action;
    if (firstRequest) onFirstRequest?.();
    firstRequest = false;
    const delta = callTool ? { tool_calls: [{ index: 0, id: 'selected-tool', type: 'function', function: { name: callTool.name, arguments: JSON.stringify(callTool.arguments) } }] } : { content: '这是等待确认的回答。' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'fixture-response', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'fixture-response', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: callTool ? 'tool_calls' : 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const providerId = randomUUID();
    const modelId = randomUUID();
    const address = server.address() as { port: number };
    ai.writeConfig({ providers: [{ id: providerId, kind: 'custom', name: 'Local fixture', endpoint: `http://127.0.0.1:${address.port}/v1`, protocol: 'openai-chat', apiKey: Buffer.from('fixture-key').toString('base64') }], models: [{ id: modelId, providerId, name: 'fixture' }], activeModelId: modelId, rlcdProviders: [], rlcdModels: [], activeRlcdModelId: '', aiEnabled: true });
    let browserEnabled = false;
    const browserCalls: { workspace: string; chatId: string; tabId?: string }[] = [];
    const browserTask = { id: randomUUID(), workspace: 'permission-query', tabIds: ['permission-tab'], origins: ['https://group.iright.huawei.com'], goal: '查询当前权限', status: 'ready', steps: [], updatedAt: new Date().toISOString() };
    registerAiIpc(todo, ai, reading, {
      forChat: (_owner: unknown, workspace: string, _goal: string, chatId: string, _previous?: string, tabId?: string) => {
        if (!browserEnabled) return undefined;
        browserCalls.push({ workspace, chatId, tabId }); return browserTask;
      },
      bind: () => {}, finish: () => {}, signal: () => new AbortController().signal,
      observe: () => ({ id: 'observation', tab: { id: 'permission-tab' }, text: '合成权限页面', elements: [], frames: [], truncated: false }),
    } as unknown as BrowserAutomation);
    const browser = ai.newChat({ module: 'workbench', viewId: 'browser' });
    browser.browserTaskId = randomUUID(); ai.saveChat(browser);
    const mainFrame = {};
    await assert.rejects(() => handlers.get('ai:ask')!({ sender: { mainFrame }, senderFrame: {} }, browser.id, '继续浏览器任务', { scope: { module: 'workbench', viewId: 'browser' }, pageScope: { module: 'workbench', viewId: 'browser' } }), /主窗口文档/);
    assert.equal(ai.chat(browser.id).entries.length, 0);
    assert.equal(state.decryptions, 0);
    const ask = async (id: string, context: AiTurnContext | Record<string, unknown>) => {
      firstRequest = true;
      const mainFrame = {};
      await handlers.get('ai:ask')!({ sender: { mainFrame }, senderFrame: mainFrame }, id, '请按明确选中的资料回答', context);
    };
    const life = ai.newChat({ module: 'workbench', viewId: 'workspace:life' });
    const invalid = [
      { pageScope: { module: 'workbench', viewId: 'reading' }, references: [{ module: 'reading', profileId: 'not-a-book' }] },
      { pageScope: { module: 'workbench', viewId: 'reading' }, references: [{ module: 'reading', profileId: 'book', content: 'forged content' }] },
      { pageScope: { module: 'workbench', viewId: 'reading' }, referenceSnapshots: [{ content: 'forged snapshot' }] },
    ];
    const before = JSON.stringify(ai.chat(life.id));
    for (const context of invalid) await assert.rejects(() => ask(life.id, context));
    assert.equal(state.decryptions, 0);
    assert.equal(requests.length, 0);
    assert.equal(JSON.stringify(ai.chat(life.id)), before);

    const selectedBook = reading.save({ title: '仅书目字段', author: '已记录作者', status: 'reading', comment: '已记录短评', tags: ['参考'], link: { vault: 'FORBIDDEN_VAULT', folder: 'FORBIDDEN_FOLDER' } }).books[0];
    reading.setVaultPath(join(dir, 'FORBIDDEN_VAULT_PATH'));
    action = { name: 'read_reference', arguments: { id: `reading:${selectedBook.id}` } };
    await ask(life.id, { scope: { module: 'workbench', viewId: 'workspace:life' }, pageScope: { module: 'workbench', viewId: 'reading' }, references: [{ module: 'reading', profileId: selectedBook.id }] });
    const bookEntry = ai.chat(life.id).entries[0];
    assert.match(bookEntry.referenceSnapshots![0].content, /已记录作者/);
    assert.ok(!JSON.stringify(requests).includes('FORBIDDEN_'));
    assert.deepEqual(requests[0].tools?.map(tool => tool.function.name), ['read_reference', 'welink_run']);
    assert.equal(requests[1].messages.find(message => message.role === 'tool')?.content, bookEntry.referenceSnapshots![0].content);

    const tasks = Array.from({ length: 122 }, (_, i) => todo.put({ ...newTask(`事项 ${i}`), id: randomUUID(), createdAt: '2026-10-12T12:00:00.000Z', updatedAt: new Date(Date.parse('2026-10-12T12:00:00Z') - i * 1000).toISOString(), completedAt: null, notifiedFor: null, deletedAt: null }));
    const older = tasks[121];
    const todoChat = ai.newChat({ module: 'todo' });
    requests.length = 0;
    action = { name: 'propose_update', arguments: { id: older.id, status: 'done' } };
    await ask(todoChat.id, { scope: { module: 'todo' }, pageScope: { module: 'todo' }, references: [{ module: 'todo', taskId: older.id }] });
    const proposal = ai.chat(todoChat.id).entries[1].proposal!;
    assert.deepEqual(proposal.actions, [{ type: 'update', id: older.id, patch: { status: 'done', source: 'local', welinkMeetingId: null } }]);
    assert.equal(todo.get(older.id).status, 'todo');
    await handlers.get('ai:apply')!(undefined, proposal.token, [0]);
    assert.equal(todo.get(older.id).status, 'done');
    assert.equal(todo.get(tasks[0].id).status, 'todo');

    ai.close();
    ai = new AiStore(dir);
    const restored = ai.chat(todoChat.id);
    assert.deepEqual(restored.entries.map(entry => entry.referenceSnapshots), restored.entries.map(entry => entry.referenceSnapshots));
    assert.deepEqual(restored.contextScope, { module: 'todo' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    ai.close(); todo.close(); reading.close();
    delete globals[Symbol.for(symbol)];
    rmSync(dir, { recursive: true, force: true });
  }
});
