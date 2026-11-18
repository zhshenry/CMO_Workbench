import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { AiStore } from '../electron/ai-store';
import { BotStore, BotError } from '../electron/bot-store';
import { BotOutbox } from '../electron/bot-outbox';
import { BotPeer } from '../electron/bot-transport';
import { BotChatSynchronizer } from '../src/bot-chat-sync';
import type { BotSubmit } from '../shared/bot-contracts';
import type { ChatSession } from '../shared/todo-contracts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ono-sync-')), ai = new AiStore(directory, { recover: false }), store = new BotStore(ai, directory);
  const bot = store.cards()[0];
  return { directory, ai, store, bot };
}
test('an outbox survives renderer/process loss, recovers the original receipt and preserves newer typing', async () => {
  const f = fixture();
  try {
    const draft = f.store.saveDraft(f.bot.mainChatId, 0, { text: '记录汇报', replyToTaskId: null, resources: [] });
    const input: BotSubmit = { botId: f.bot.id, chatId: draft.chatId, expectedDraftRevision: draft.revision, clientRequestId: randomUUID(), text: draft.text, replyToTaskId: null, resources: [] };
    let lose = true, writes = 0;
    const transport = async (method: string, args: unknown[]) => {
      if (method === 'getSubmissionStatus') return f.store.submissionStatus(args[0] as BotSubmit, 'main', args[1] as string);
      const receipt = f.store.submit(args[0] as BotSubmit, () => {}); writes++;
      if (lose) { lose = false; throw new BotError('HOST_TIMEOUT', '模拟回执丢失'); } return receipt;
    };
    const first = new BotOutbox(f.directory);
    await assert.rejects(first.send(input, 'main', transport), /回执丢失/);
    first.retainDraft(draft.chatId, 'main', { text: '接着写的新内容', replyToTaskId: null, resources: [] });
    const reopened = new BotOutbox(f.directory), pending = reopened.pending(draft.chatId, 'main')!;
    assert.equal(pending.input.clientRequestId, input.clientRequestId); assert.equal(pending.localDraft?.text, '接着写的新内容');
    const receipt = await reopened.send(pending.input, 'main', transport);
    assert.equal(receipt.duplicate, true); assert.equal(writes, 1); assert.equal(f.store.tasks().length, 1);
    await assert.rejects(reopened.send({ ...input, text: '不同内容' }, 'main', transport), /上一条/);
    assert.equal(reopened.pending(draft.chatId, 'island'), null);
    reopened.acknowledge(draft.chatId, 'main', input.clientRequestId); assert.equal(reopened.pending(draft.chatId, 'main'), null);
  } finally { f.ai.close(); }
});
test('changing database identity never silently resends an outbox record', async () => {
  const f = fixture();
  try {
    const input: BotSubmit = { botId: f.bot.id, chatId: f.bot.mainChatId, expectedDraftRevision: 0, clientRequestId: randomUUID(), text: '不可重复执行', replyToTaskId: null, resources: [] };
    const outbox = new BotOutbox(f.directory);
    await assert.rejects(outbox.send(input, 'main', async method => { if (method === 'getSubmissionStatus') return { status: 'not_found', dataEpoch: 'original' }; throw new BotError('HOST_DISCONNECTED', '断线'); }));
    let submitted = false;
    await assert.rejects(new BotOutbox(f.directory).send(input, 'main', async method => { if (method === 'submit') submitted = true; return { status: 'epoch_changed', dataEpoch: 'restored' }; }), /不会自动重发/);
    assert.equal(submitted, false);
  } finally { f.ai.close(); }
});
test('entry deltas survive restart, catch up gaps, ignore duplicates and fall back after retention', async () => {
  const f = fixture();
  try {
    const chat = f.ai.chat(f.bot.mainChatId), id = randomUUID(); chat.entries.push({ id, role: 'assistant', content: '' }); f.ai.saveChat(chat);
    const snapshot = f.ai.syncChat(chat.id); let rendered: ChatSession | undefined;
    const sync = new BotChatSynchronizer(chat.id, { syncChat: async (id, after, epoch) => f.ai.syncChat(id, after, epoch) }, value => { rendered = value; }, error => { throw error; });
    await sync.refresh();
    const first = f.ai.saveBotEntry(chat.id, { id, role: 'assistant', content: '一', streaming: true });
    assert.equal(f.ai.chats().find(item => item.id === chat.id)?.streaming, true);
    const second = f.ai.saveBotEntry(chat.id, { id, role: 'assistant', content: '一二' });
    sync.receive(second); await sync.refresh(); sync.receive(first); sync.receive(second);
    assert.equal(rendered?.entries.at(-1)?.content, '一二');
    assert.equal(f.ai.chats().find(item => item.id === chat.id)?.completed, true);
    const recovery = f.ai.syncChat(chat.id, snapshot.sequence); assert.ok('updates' in recovery); assert.equal(recovery.updates.length, 2);
    for (let i = 0; i < 260; i++) f.ai.saveBotEntry(chat.id, { id, role: 'assistant', content: `结束${i}` });
    const resnapshot = f.ai.syncChat(chat.id, snapshot.sequence); assert.ok('chat' in resnapshot); assert.equal(resnapshot.chat.entries.at(-1)?.content, '结束259');
    const fresh = f.ai.chat(chat.id); fresh.entries.push({ id: randomUUID(), role: 'user', content: '新的用户要求' }); f.ai.saveChat(fresh);
    assert.equal(f.ai.chat(chat.id).entries.at(-2)?.content, '结束259');
    sync.stop(); f.ai.close();
    const reopened = new AiStore(f.directory, { recover: false }); assert.equal(reopened.chat(chat.id).entries.at(-2)?.content, '结束259'); reopened.close();
  } finally { try { f.ai.close(); } catch {} }
});

test('snapshot subscription races keep newer records and a restored Host retires old buffered events', async () => {
  const f = fixture();
  try {
    const chat = f.ai.chat(f.bot.mainChatId), id = randomUUID();
    chat.entries.push({ id, role: 'assistant', content: '快照' }); f.ai.saveChat(chat);
    const snapshot = f.ai.syncChat(chat.id);
    let resolve!: (value: typeof snapshot) => void, rendered: ChatSession | undefined, calls = 0;
    const pending = new Promise<typeof snapshot>(done => { resolve = done; });
    const sync = new BotChatSynchronizer(chat.id, { syncChat: async (id, after, epoch) => ++calls === 1 ? pending : f.ai.syncChat(id, after, epoch) }, value => { rendered = value; }, error => { throw error; });
    const first = sync.refresh();
    const newer = f.ai.saveBotEntry(chat.id, { id, role: 'assistant', content: '快照之后的更新' });
    sync.receive(newer); resolve(snapshot); await first;
    assert.equal(rendered?.entries.at(-1)?.content, '快照之后的更新');
    sync.receive({ ...newer, sequence: newer.sequence + 100 });
    await new Promise(done => setImmediate(done));
    assert.ok(calls <= 3, 'an unrecoverable future sequence must not spin');
    f.ai.setSetting('bot.dataEpoch', randomUUID());
    const restored = f.ai.saveBotEntry(chat.id, { id, role: 'assistant', content: '恢复后的权威内容' });
    sync.receive(restored); await sync.refresh();
    assert.equal(rendered?.entries.at(-1)?.content, '恢复后的权威内容');
    sync.receive({ ...newer, sequence: restored.sequence + 1 }); await sync.refresh();
    assert.equal(rendered?.entries.at(-1)?.content, '恢复后的权威内容');
    sync.stop();
  } finally { f.ai.close(); }
});
test('large Unicode snapshots are chunked across the pipe without corrupting characters', async () => {
  const server = createServer(), secret = 'a'.repeat(64), peers: BotPeer[] = [];
  server.on('connection', socket => { const peer = new BotPeer(socket, secret, true); peers.push(peer); peer.handler = (_method, args) => args[0]; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as { port: number }).port, '127.0.0.1');
  await new Promise<void>(resolve => socket.once('connect', resolve));
  const client = new BotPeer(socket, secret);
  try { await client.call('hello'); const text = '中文🙂'.repeat(600000); assert.equal(await client.call('echo', [text]), text); }
  finally { client.close(); peers.forEach(peer => peer.close()); await new Promise<void>(resolve => server.close(() => resolve())); }
});
