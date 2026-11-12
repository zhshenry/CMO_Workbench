import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentMessageStore, readTranscriptSummary } from '../electron/agent-message-store';
import type { AgentEvent } from '../shared/agent-message-contracts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-agent-'));
  return { dir, store: new AgentMessageStore(dir, () => 2000) };
}

const event = (patch: Partial<AgentEvent> = {}): AgentEvent => ({
  provider: 'codeai', sessionId: 'session-1', turnId: 'turn-1', kind: 'reply',
  workspace: 'D:\\project', title: '修复已完成', detail: '', requestKey: '', transcriptPath: '', occurredAt: 1000, ...patch,
});

test('Agent messages: mark all read only acknowledges the displayed message versions', () => {
  const f = fixture(), first = f.store.ingest(event())!;
  const second = f.store.ingest(event({ turnId: 'turn-2', occurredAt: 1100 }))!;
  const targets = f.store.read().map(({ id, updatedAt }) => ({ id, updatedAt }));
  f.store.ingest(event({ turnId: 'turn-2', kind: 'failed', occurredAt: 1500 }));
  const third = f.store.ingest(event({ turnId: 'turn-3', occurredAt: 1600 }))!;
  assert.deepEqual(f.store.markReadAll(targets), [first.id]);
  assert.equal(f.store.get(first.id).readAt, 2000);
  assert.equal(f.store.get(second.id).readAt, null);
  assert.equal(f.store.get(third.id).readAt, null);
  assert.deepEqual(f.store.markReadAll(targets), []);
  assert.equal(new AgentMessageStore(f.dir).get(first.id).readAt, 2000);
});

test('Agent messages: a failed bulk acknowledgement preserves persisted and unread state', () => {
  const f = fixture(), message = f.store.ingest(event())!;
  assert.equal(typeof f.store.markReadAll, 'function');
  const before = readFileSync(join(f.dir, 'agent-messages.json'), 'utf8');
  mkdirSync(join(f.dir, 'agent-messages.json.tmp'));
  try {
    assert.throws(() => f.store.markReadAll([{ id: message.id, updatedAt: message.updatedAt }]));
    assert.equal(f.store.get(message.id).readAt, null);
    assert.equal(readFileSync(join(f.dir, 'agent-messages.json'), 'utf8'), before);
  } finally { rmSync(join(f.dir, 'agent-messages.json.tmp'), { recursive: true, force: true }); }
});

test('Agent messages: same-turn reply dedupes — newer event updates, does not add or reset read', () => {
  const f = fixture(), message = f.store.ingest(event())!;
  assert.equal(message.title, '修复已完成');
  f.store.markRead(message.id);
  // 同 turn 新事件(更晚时间)只更新,不新增,不把已读变未读
  assert.equal(f.store.ingest(event({ title: '有新回复', occurredAt: 3000 })), null);
  assert.equal(f.store.read().length, 1);
  assert.equal(f.store.read()[0].title, '修复已完成');
  assert.equal(f.store.read()[0].readAt, 2000);
  // 旧事件(更早时间)不覆盖
  assert.equal(f.store.ingest(event({ title: '迟到的旧事件', occurredAt: 500 })), null);
  assert.equal(f.store.read()[0].title, '修复已完成');
});

test('Agent messages: failed supersedes same-turn reply; new turn adds a separate unread message', () => {
  const f = fixture();
  f.store.ingest(event());
  f.store.ingest(event({ kind: 'failed', title: '运行失败', occurredAt: 4000 }));
  const list = f.store.read();
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'failed');
  assert.equal(list[0].title, '运行失败');
  // 新 turn 新增一条未读
  f.store.ingest(event({ turnId: 'turn-2', occurredAt: 5000 }));
  assert.equal(f.store.read().length, 2);
  assert.equal(f.store.read()[0].readAt, null);
});

test('Agent messages: corrupted storage preserves the old file and in-memory unread state', () => {
  const f = fixture(), message = f.store.ingest(event())!;
  const saved = readFileSync(join(f.dir, 'agent-messages.json'), 'utf8');
  // 模拟写入失败:把目录占住使原子重命名失败(创建同名目录阻挡)
  mkdirSync(join(f.dir, 'agent-messages.json.tmp'));
  try {
    assert.throws(() => f.store.ingest(event({ turnId: 'turn-x', occurredAt: 9000 })));
    // 原文件未变,内存里仍是原消息且未读
    assert.equal(readFileSync(join(f.dir, 'agent-messages.json'), 'utf8'), saved);
    assert.equal(f.store.read().length, 1);
    assert.equal(f.store.get(message.id).readAt, null);
  } finally {
    rmSync(join(f.dir, 'agent-messages.json.tmp'), { recursive: true, force: true });
  }
});

test('Agent messages: restart recovers unread state from persisted file', () => {
  const f = fixture();
  f.store.ingest(event());
  f.store.ingest(event({ turnId: 'turn-2', occurredAt: 2000 }));
  const recovered = new AgentMessageStore(f.dir, ()  => 3000);
  assert.equal(recovered.read().length, 2);
  assert.equal(recovered.read().every(message => message.readAt === null), true);
});

test('Agent messages: empty title with transcriptPath falls back to summary, then default', () => {
  const f = fixture(), dir = mkdtempSync(join(tmpdir(), 'cmo-tr-'));
  const transcript = join(dir, 's.jsonl');
  writeFileSync(transcript, [
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"这是回复正文,讲清楚改动。"}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit"}]}}',
  ].join('\n'));
  // 空 title → 读 transcript 取最后一条带 text 的 assistant(倒数第二条,因最后一条是 tool_use)
  const message = f.store.ingest(event({ title: '', transcriptPath: transcript }))!;
  assert.equal(message.title, '这是回复正文,讲清楚改动。');
});

test('readTranscriptSummary: returns last assistant text from tail, skipping tool_use-only entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-tr2-'));
  const transcript = join(dir, 's.jsonl');
  writeFileSync(transcript, [
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"用户提问"}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"第一条回复"}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read"}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"最终回复内容,超过的部分会被截断。"}]}}',
  ].join('\n'));
  assert.equal(readTranscriptSummary(transcript), '最终回复内容,超过的部分会被截断。');
});

test('readTranscriptSummary: returns empty when no assistant text block exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-tr3-'));
  const transcript = join(dir, 's.jsonl');
  writeFileSync(transcript, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"EnterPlanMode"}]}}');
  assert.equal(readTranscriptSummary(transcript), '');
});

test('readTranscriptSummary: returns empty on missing file or bad json', () => {
  assert.equal(readTranscriptSummary(join(tmpdir(), 'cmo-not-exist-' + Date.now() + '.jsonl')), '');
  const dir = mkdtempSync(join(tmpdir(), 'cmo-tr4-'));
  const transcript = join(dir, 's.jsonl');
  writeFileSync(transcript, 'not json at all\n{also broken');
  assert.equal(readTranscriptSummary(transcript), '');
});

test('readTranscriptSummary: truncates to 200 chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-tr5-'));
  const transcript = join(dir, 's.jsonl');
  const long = '字'.repeat(300);
  writeFileSync(transcript, `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"${long}"}]}}`);
  assert.equal(readTranscriptSummary(transcript).length, 200);
});
