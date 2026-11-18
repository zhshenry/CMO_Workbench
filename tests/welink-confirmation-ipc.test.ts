import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { Store } from '../modules/todo/store';
import { ReadingStore } from '../modules/reading/store';

test('ordinary chat assembly blocks WeLink writes until the correct confirmation and cancels on stop', { timeout: 30000 }, async () => {
  const symbol = `welink-gate-${randomUUID()}`;
  const handlers = new Map<string, (...args: any[]) => any>(), listeners = new Map<string, (...args: any[]) => void>();
  const questions: { id: string; sessionId: string; question: string }[] = [], calls: string[][] = [];
  const state = { handlers, listeners, calls, send: (name: string, value: any) => { if (name === 'ai:ask') questions.push(value); } };
  (globalThis as any)[Symbol.for(symbol)] = state;
  const transport = `const s=globalThis[Symbol.for(${JSON.stringify(symbol)})];
    export const ipcMain={handle:(name,fn)=>s.handlers.set(name,fn),on:(name,fn)=>s.listeners.set(name,fn)};
    export const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
    export const BrowserWindow={getAllWindows:()=>[{isDestroyed:()=>false,isVisible:()=>true,webContents:{isDestroyed:()=>false,send:s.send}}]};
    export const shell={openExternal:async()=>{}}; export const app={isPackaged:false,getAppPath:()=>''};`;
  const cli = `const s=globalThis[Symbol.for(${JSON.stringify(symbol)})]; export const runWelink=async args=>{s.calls.push(args);return '{"code":200}';};`;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const source = specifier === 'electron' ? transport : specifier.endsWith('/welink-cli') ? cli : null;
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
  } });
  const { registerAiIpc } = await import('../electron/ai-ipc'); hooks.deregister();
  const dir = mkdtempSync(join(tmpdir(), 'wb-welink-gate-'));
  const ai = new AiStore(dir), todo = new Store(join(dir, 'tasks.db'), 'shared-tasks'), reading = new ReadingStore(dir);
  let subcommand = 'send-to-user';
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw), first = !body.messages.some((message: any) => message.role === 'tool');
    const delta = first ? { tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: 'welink_run', arguments: JSON.stringify({ service: 'im', subcommand, args: ['--receiver', 'z00123456', '--text', '完整正文：会议改到明天。'] }) } }] } : { content: '处理结束。' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [value, finish] of [[delta, null], [{}, first ? 'tool_calls' : 'stop']]) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const wait = async (condition: () => boolean) => { const deadline = Date.now() + 10000; while (!condition()) { if (Date.now() > deadline) throw new Error('未收到确认卡'); await new Promise(done => setTimeout(done, 10)); } };
  try {
    const providerId = randomUUID(), modelId = randomUUID();
    ai.writeConfig({ aiEnabled: true, providers: [{ id: providerId, kind: 'custom', name: 'fixture', endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`, protocol: 'openai-chat', apiKey: Buffer.from('fixture').toString('base64') }], models: [{ id: modelId, providerId, name: 'fixture' }], activeModelId: modelId, rlcdProviders: [], rlcdModels: [], activeRlcdModelId: '' });
    registerAiIpc(todo, ai, reading);
    const frame = {}, event = { sender: { mainFrame: frame }, senderFrame: frame };
    const ask = (id: string) => handlers.get('ai:ask')!(event, id, '发送约定正文', {});
    for (const answer of ['确认执行', '取消', 'stop']) {
      const chat = ai.newChat(), before = calls.length, count = questions.length;
      const turn = ask(chat.id).then(() => null, (error: Error) => error);
      await Promise.race([wait(() => questions.length > count), turn.then(error => { throw new Error(`确认卡前会话结束：${String(error)} ${JSON.stringify(ai.chat(chat.id).entries.at(-1))}`); })]);
      const question = questions.at(-1)!;
      assert.equal(calls.length, before, 'the actual CLI entry has not run before confirmation');
      assert.match(question.question, /z00123456/); assert.match(question.question, /完整正文/);
      listeners.get('ai:answer')!(event, { id: 'wrong-id', sessionId: chat.id, kind: 'option', value: '确认执行' });
      assert.equal(calls.length, before);
      if (answer === 'stop') listeners.get('ai:cancel')!(event, chat.id);
      else listeners.get('ai:answer')!(event, { id: question.id, sessionId: chat.id, kind: 'option', value: answer });
      await turn;
      assert.equal(calls.length, before + Number(answer === '确认执行'));
      assert.equal(questions.length, count + 1, 'one execution presents one confirmation');
    }
    subcommand = 'query-recent-conversation';
    const questionCount = questions.length; await ask(ai.newChat().id);
    assert.equal(questions.length, questionCount); assert.equal(calls.at(-1)![1], subcommand);
  } finally {
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    ai.close(); todo.close(); reading.close(); delete (globalThis as any)[Symbol.for(symbol)];
    assert.ok(resolve(dir).startsWith(resolve(join(tmpdir(), 'wb-welink-gate-')))); rmSync(dir, { recursive: true, force: true });
  }
});
