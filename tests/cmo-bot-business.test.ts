import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { BotStore } from '../electron/bot-store';
import { BotHost } from '../electron/bot-host';
import { parseAuthStatus } from '../electron/welink-auth';
import { officeReplyAction } from '../electron/office-reply';
import type { BotAction } from '../shared/bot-contracts';

const symbol = `cmo-business-${randomUUID()}`;
const state = { calls: [] as string[][], parseAuthStatus, run: async (_args: string[]): Promise<string> => '{"ok":true}' };
(globalThis as any)[Symbol.for(symbol)] = state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (!specifier.endsWith('/welink-cli')) return next(specifier, context);
  const source = `const state=globalThis[Symbol.for(${JSON.stringify(symbol)})]; export const parseAuthStatus=state.parseAuthStatus;
  export const runWelink=async args=>{if(args[0]==='auth'&&args[1]==='status')return 'Status: authenticated\\nUID: z00123456';state.calls.push([...args]);return state.run(args);};`;
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
} });
const { cmoBotAdapter } = await import('../electron/cmo-bot-adapter');
hooks.deregister();
const surface = { id: 'business-fixture', kind: 'main' as const };

function fixture() {
  state.calls = []; state.run = async () => '{"ok":true}';
  const dir = mkdtempSync(join(tmpdir(), 'cmo-business-')), ai = new AiStore(dir, { recover: false }), store = new BotStore(ai, dir);
  let adapter: ReturnType<typeof cmoBotAdapter>;
  const host = new BotHost(store, { run: async () => ({ reply: 'fixture' }), apply: (action, answer) => adapter.apply(action, answer.text) });
  adapter = cmoBotAdapter(store, { agenda: async () => { throw new Error('fixture has no agenda'); }, details: async () => { throw new Error('fixture has no calendar'); } }, '', async () => { throw new Error('fixture has no browser'); });
  const bot = store.cards().find(item => item.seedKey === 'coordinator')!, previous = store.draft(bot.mainChatId);
  const draft = host.saveDraft(bot.mainChatId, previous.revision, { text: '发送指定正文', replyToTaskId: null, resources: [] }, surface);
  const input = { botId: bot.id, chatId: bot.mainChatId, expectedDraftRevision: draft.revision, clientRequestId: randomUUID(), text: '发送指定正文', replyToTaskId: null, resources: [] };
  const task = store.submit(input, () => {}).task;
  store.updateTask(task.id, { status: 'running' });
  const tool = adapter.contribution(store.task(task.id), host).buildTools().find(item => item.name === 'welink_run')!;
  const execute = (id: string, params: unknown) => tool.execute(id, params as never, undefined, undefined, {} as never);
  const action = (): BotAction => store.actions(task.id)[0];
  return { dir, ai, store, host, task, input, execute, action, close: async () => { await host.stop(); ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); } };
}
const command = () => ({ service: 'im', subcommand: 'send-to-user', args: ['--receiver', 'z00123456', '--text', '完整正文：会议改到明天。'] });

test('a bound WeLink reply sends the approved body to the fixed conversation only once', async () => {
  const f = fixture();
  try {
    const payload = officeReplyAction({ account: 'z00123456', conversation: 'user:z00987654', recipient: '项目同事' }, '原始草稿');
    const action = f.host.waitForAction(f.task.id, f.task.id + ':office-reply', 'external', payload);
    assert.deepEqual(state.calls, []);
    const answer = { approved: true, text: '编辑后的正文' };
    const sent = await f.host.answerAction(action.id, action.revision, answer);
    assert.equal(sent.status, 'applied');
    await f.host.answerAction(action.id, action.revision, answer);
    assert.deepEqual(state.calls, [['im', 'send-to-user', '--receiver', 'z00987654', '--text=编辑后的正文']]);
  } finally { await f.close(); }
});

test('the office Bot can query verified materials and page a transcript without exposing WeLink writes', async () => {
  const f = fixture();
  try {
    const actualTime = '2026-11-10T01:00:00.000Z', start = '2026-11-17T01:00:00.000Z', text = '逐'.repeat(7999) + '📌全文';
    const adapter = cmoBotAdapter(f.store, { agenda: async () => assert.fail(), details: async () => assert.fail() }, '', async () => assert.fail(),
      undefined, undefined, {
        meetingContent: async input => {
          assert.deepEqual(input, { taskId: 'fixture-calendar', material: 'transcript' });
          return { transcript: { status: 'wrong-session', actualTime } };
        },
        meetingTranscript: async input => {
          assert.deepEqual(input, { meetingId: '123', expectedStart: start });
          return { status: 'ready', start, fetchedAt: Date.parse(start), format: 'json', text };
        },
      });
    const office = f.store.cards().find(card => card.seedKey === 'office')!;
    const tools = adapter.contribution({ ...f.task, botId: office.id }, f.host).buildTools();
    assert.deepEqual(tools.map(tool => tool.name), ['office_read', 'welink_meeting_content', 'welink_transcript']);
    const call = async (name: string, args: unknown) => {
      const result = await tools.find(tool => tool.name === name)!.execute('fixture', args as never, undefined, undefined, {} as never);
      const first = result.content[0];
      assert.equal(first.type, 'text');
      return JSON.parse(first.text);
    };
    assert.deepEqual(await call('welink_meeting_content', { taskId: 'fixture-calendar', material: 'transcript' }), { transcript: { status: 'wrong-session', actualTime } });
    const first = await call('welink_transcript', { meetingId: '123', expectedStart: start });
    assert.equal(first.nextOffset, 7999);
    const rest = await call('welink_transcript', { meetingId: '123', expectedStart: start, offset: first.nextOffset });
    assert.equal(first.text + rest.text, text);
    assert.equal(rest.nextOffset, undefined);
  } finally { await f.close(); }
});

test('CMO WeLink reads execute directly, writes freeze exact parameters and wait for one approval', async () => {
  const f = fixture();
  try {
    await f.execute('read', { service: 'mail', subcommand: 'list', args: [] });
    assert.equal(state.calls.length, 1); assert.equal(f.store.actions(f.task.id).length, 0);
    const params = command(); await f.execute('write', params);
    assert.equal(state.calls.length, 1); assert.equal(f.store.task(f.task.id).status, 'waiting_user');
    const pending = f.action(); assert.equal(pending.kind, 'external'); assert.deepEqual(pending.payload.args, params.args);
    params.args[3] = '之后输入的其他正文';
    assert.equal((await f.host.answerAction(pending.id, pending.revision, { approved: true })).status, 'applied');
    await f.host.answerAction(pending.id, pending.revision, { approved: true });
    assert.equal(state.calls.length, 2); assert.deepEqual(state.calls[1], ['im', 'send-to-user', ...command().args]);
    assert.equal(f.store.task(f.task.id).status, 'completed');
  } finally { await f.close(); }
});

test('declining a pending WeLink command leaves no external effect', async () => {
  const f = fixture();
  try {
    await f.execute('decline', command()); const action = f.action();
    assert.equal((await f.host.answerAction(action.id, action.revision, { approved: false })).status, 'discarded');
    assert.deepEqual(state.calls, []); assert.equal(f.store.task(f.task.id).status, 'cancelled');
  } finally { await f.close(); }
});
test('a tool from an obsolete run cannot create a new approvable WeLink command', async () => {
  const f = fixture();
  try {
    f.store.updateTask(f.task.id, { requirementsRevision: 1 });
    const result = await f.execute('obsolete', command());
    const message = result.content[0];
    assert.equal(message.type, 'text');
    assert.match(message.text, /要求已更新/);
    assert.deepEqual(f.store.actions(f.task.id), []); assert.deepEqual(state.calls, []);
  } finally { await f.close(); }
});

test('unverified CLI output is retained as an unknown outcome and never blindly repeated', async () => {
  const f = fixture();
  try {
    state.run = async () => '请求已返回，未提供业务成功回执';
    await f.execute('uncertain', command()); const pending = f.action();
    const result = await f.host.answerAction(pending.id, pending.revision, { approved: true });
    assert.equal(result.status, 'unknown'); assert.match(JSON.stringify(result.receipt), /未提供业务成功回执/);
    f.store.recover();
    await assert.rejects(f.host.answerAction(result.id, result.revision, { approved: true }), /结果待核对/);
    assert.equal(state.calls.length, 1);
  } finally { await f.close(); }
});

test('supplementing a pending business request invalidates its old approval', async () => {
  const f = fixture();
  try {
    await f.execute('old', command()); const old = f.action();
    const previous = f.store.draft(f.input.chatId);
    const draft = f.host.saveDraft(f.input.chatId, previous.revision, { text: '改发给另一个人', replyToTaskId: null, resources: [] }, surface);
    f.store.submit({ ...f.input, text: '改发给另一个人', clientRequestId: randomUUID(), expectedDraftRevision: draft.revision, target: { intent: 'amend', rootTaskId: f.task.id, taskId: f.task.id, actionId: old.id, expectedActionRevision: old.revision } }, () => {}, surface.kind);
    assert.equal(f.store.action(old.id).status, 'superseded');
    await assert.rejects(f.host.answerAction(old.id, old.revision, { approved: true }), /版本|更新|重复|处理/);
    assert.deepEqual(state.calls, []);
  } finally { await f.close(); }
});

test('late business receipts survive cancellation without completing the cancelled task', async () => {
  const f = fixture(); let release!: () => void;
  try {
    const gate = new Promise<void>(done => { release = done; }); state.run = async () => { await gate; return '{"ok":true}'; };
    await f.execute('late', command()); const action = f.action();
    const writing = f.host.answerAction(action.id, action.revision, { approved: true });
    f.host.cancelTask(f.task.id, f.store.task(f.task.id).revision);
    release(); assert.equal((await writing).status, 'applied');
    assert.equal(f.store.task(f.task.id).status, 'cancelled'); assert.equal(state.calls.length, 1);
    assert.ok(f.store.action(action.id).receipt);
  } finally { release?.(); await f.close(); }
});

test('controlled Host shutdown waits for an already approved business receipt', async () => {
  const f = fixture(); let release!: () => void;
  try {
    const gate = new Promise<void>(done => { release = done; }); state.run = async () => { await gate; return '{"ok":true}'; };
    await f.execute('shutdown', command()); const action = f.action();
    const writing = f.host.answerAction(action.id, action.revision, { approved: true });
    let stopped = false; const stop = f.host.stop().then(() => { stopped = true; });
    await new Promise(done => setTimeout(done, 10)); assert.equal(stopped, false);
    release(); await writing; await stop; assert.equal(f.store.action(action.id).status, 'applied');
  } finally { release?.(); await f.close(); }
});
test('an approved business write owns its Bot execution slot until the receipt arrives', async () => {
  const f = fixture(); let release!: () => void;
  try {
    const gate = new Promise<void>(done => { release = done; }); state.run = async () => { await gate; return '{"ok":true}'; };
    await f.execute('serial-write', command()); f.host.start();
    const action = f.action(), writing = f.host.answerAction(action.id, action.revision, { approved: true });
    const previous = f.store.draft(f.input.chatId), text = '另一项独立工作';
    const draft = f.host.saveDraft(f.input.chatId, previous.revision, { text, replyToTaskId: null, resources: [] }, surface);
    const next = f.host.submit({ ...f.input, text, expectedDraftRevision: draft.revision, clientRequestId: randomUUID() }, surface).task;
    await new Promise(done => setTimeout(done, 20));
    assert.equal(f.store.task(next.id).status, 'queued'); assert.equal(f.host.state().activeTasks, 1);
    const card = f.store.cards().find(item => item.id === f.input.botId)!;
    assert.equal(card.activity, 'working'); assert.equal(card.waitingCount, 0);
    release(); await writing;
    for (let i = 0; i < 100 && f.store.task(next.id).status !== 'completed'; i++) await new Promise(done => setTimeout(done, 10));
    assert.equal(f.store.task(next.id).status, 'completed');
  } finally { release?.(); await f.close(); }
});
