import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { AiStore } from '../electron/ai-store';
import { BotHost } from '../electron/bot-host';
import { BotRuntime } from '../electron/bot-runtime';
import { BotStore } from '../electron/bot-store';
import { Store } from '../modules/todo/store';
import type { BotArtifact } from '../shared/bot-contracts';
import type { ChatEntry } from '../shared/todo-contracts';

const realSetTimeout = globalThis.setTimeout;
const encoder = new TextEncoder();
const minute = 60_000;

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'cmo-bot-timeout-'));
  const ai = new AiStore(directory, { recover: false });
  const store = new BotStore(ai, directory), todo = new Store(join(directory, 'tasks.db'));
  const bot = store.cards().find(card => card.seedKey === 'coordinator')!;
  store.updateProfile(bot.id, bot.revision, { ...store.profile(bot.id), modelId: 'fixture' });
  const streams: { send(delta: object, finish?: 'stop' | 'tool_calls'): void; signal: AbortSignal }[] = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url instanceof Request ? url.url : String(url), 'http://127.0.0.1:1/v1/chat/completions');
    const signal = init?.signal ?? (url instanceof Request ? url.signal : undefined);
    assert.ok(signal);
    signal.throwIfAborted();
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => controller.error(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        streams.push({ signal, send(delta, finish) {
          const chunk = { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish ?? null }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          if (finish) {
            signal.removeEventListener('abort', abort);
            controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
          }
        } });
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const result = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} });
  const work = Promise.withResolvers<ReturnType<typeof result>>();
  let report: ((text: string) => void) | undefined;
  const tool = defineTool({ name: 'test_progress', label: '读取测试资料', description: 'Read fixture data', parameters: Type.Object({}),
    execute: async (_id, _args, signal, onUpdate) => {
      report = text => onUpdate?.(result(text));
      const abort = () => work.reject(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      try { return await work.promise; }
      finally { signal?.removeEventListener('abort', abort); }
    },
  });
  const runtime = new BotRuntime(store, todo, undefined as never, {
    connection: () => ({ endpoint: 'http://127.0.0.1:1/v1', model: 'fixture', protocol: 'openai-chat', key: '' }),
    changed: () => {},
    business: () => ({ toolNames: [tool.name], labels: { [tool.name]: tool.label }, buildTools: () => [tool], systemPrompt: () => '' }),
  });
  const host = new BotHost(store, runtime);
  t.after(async () => {
    t.mock.timers.reset();
    await host.stop(); todo.db.close(); ai.close();
    assert.equal(dirname(directory), tmpdir());
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const surface = { id: 'timeout-fixture', kind: 'main' as const }, text = '整理测试资料';
  const draft = host.saveDraft(bot.mainChatId, 0, { text, replyToTaskId: null, resources: [] }, surface);
  const { task } = host.submit({ botId: bot.id, chatId: bot.mainChatId, expectedDraftRevision: draft.revision, clientRequestId: randomUUID(), text, replyToTaskId: null, resources: [] }, surface);
  const entry = (): ChatEntry => ai.chat(bot.mainChatId).entries.find(item => item.role === 'assistant')!;
  const until = async (check: () => unknown) => {
    for (let i = 0; i < 400; i++) {
      if (check()) return;
      t.mock.timers.tick(80);
      await new Promise(resolve => realSetTimeout(resolve, 5));
    }
    assert.fail('The Bot did not reach the expected state');
  };
  await until(() => streams.length === 1);
  const callTool = (name: string, args: object) => streams[0].send({ tool_calls: [{ index: 0, id: 'fixture-tool', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
  return {
    directory, store, task: () => store.task(task.id), entry, streams, until, callTool,
    advance: (ms: number) => t.mock.timers.tick(ms),
    report: (text: string) => report!(text),
    completeTool: () => work.resolve(result('读取完成')),
    cancel: () => host.cancelTask(task.id, store.task(task.id).revision),
  };
}

test('Bot progress keeps a lengthy run alive across thinking, tool updates, tool completion and streamed text', async t => {
  const f = await fixture(t);
  f.advance(2.5 * minute); f.streams[0].send({ reasoning_content: '正在分析' });
  await f.until(() => f.entry().thinking?.includes('正在分析'));
  f.advance(2.5 * minute); f.callTool('test_progress', {});
  await f.until(() => f.entry().tools?.[0]?.status === 'running');
  f.advance(2.5 * minute); f.report('已读取一半');
  await f.until(() => f.entry().tools?.[0]?.output === '已读取一半');
  f.advance(2.5 * minute); f.completeTool();
  await f.until(() => f.streams.length === 2);
  f.advance(2.5 * minute); f.streams[1].send({ content: '测试' });
  await f.until(() => f.entry().content === '测试');
  f.advance(2 * minute); f.streams[1].send({ content: '完成' }, 'stop');
  await f.until(() => f.task().status === 'completed');
  assert.equal(f.entry().content, '测试完成');
});

test('Bot idle timeout also applies while waiting for the first model packet', async t => {
  const f = await fixture(t);
  f.advance(3 * minute);
  await f.until(() => f.task().status === 'failed');
  assert.match(f.task().reason!, /任务超时.*连续 3 分钟无进展/);
  assert.equal(f.entry().error, f.task().reason);
  assert.doesNotMatch(f.entry().error!, /已取消|资料库/);
});

test('repeated tool progress does not postpone Bot idle timeout', async t => {
  const f = await fixture(t);
  f.callTool('test_progress', {});
  await f.until(() => f.entry().tools?.[0]?.status === 'running');
  f.report('已读取一半');
  await f.until(() => f.entry().tools?.[0]?.output === '已读取一半');
  f.advance(2.5 * minute); f.report('已读取一半');
  await new Promise(resolve => realSetTimeout(resolve, 20));
  f.advance(0.5 * minute);
  await f.until(() => f.task().status === 'failed');
  assert.match(f.task().reason!, /连续 3 分钟无进展/);
});

test('regular Bot output does not extend the total deadline', async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 5; i++) {
    f.advance(2.5 * minute); f.streams[0].send({ content: ` 第${i}段` });
    await f.until(() => f.entry().content.includes(`第${i}段`));
  }
  f.advance(2.5 * minute);
  await f.until(() => f.task().status === 'failed');
  assert.match(f.task().reason!, /任务超时.*总时限 15 分钟/);
  assert.equal(f.entry().error, f.task().reason);
});

for (const manual of [false, true]) test(`Bot ${manual ? 'manual cancellation' : 'idle timeout'} preserves a saved artifact`, async t => {
  const f = await fixture(t);
  f.callTool('save_artifact', { title: '测试简报', content: '# 测试简报' });
  await f.until(() => f.streams.length === 2);
  if (manual) f.cancel(); else f.advance(3 * minute);
  await f.until(() => f.task().status === (manual ? 'cancelled' : 'failed') && !f.entry().streaming);
  if (manual) assert.equal(f.task().reason, '用户已取消');
  else assert.match(f.task().reason!, /连续 3 分钟无进展.*已保存的交付件可在 Bot 资料库查看/);
  const [artifact] = f.store.all<BotArtifact>('bot_artifacts');
  assert.equal(artifact.taskId, f.task().id);
  assert.equal(artifact.content, '# 测试简报');
  assert.equal(readFileSync(f.store.files.workspacePath(artifact.producerBotId, 'outputs/' + artifact.id + '.md'), 'utf8'), artifact.content);
});
