import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentLoop } from '../electron/ai-core';
import { AiOutputLimitError, resolveModelSettings } from '../shared/ai-model-settings';

const contribution = { toolNames: [], labels: {}, buildTools: () => [], systemPrompt: () => 'Only answer the user.' };
const connection = { endpoint: 'https://synthetic.invalid/v1', model: 'synthetic', protocol: 'openai-chat' as const, key: 'local' };
function completion(content: string, finish: string, output = 16384) {
  return new Response([
    { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '核对记录。', ...(content ? { content } : {}) }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: output, total_tokens: output + 100 } },
  ].map(data => 'data: ' + JSON.stringify({ id: 'qa', object: 'chat.completion.chunk', ...data }) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

test('model limits reserve space for compaction and validate saved settings', () => {
  assert.deepEqual(resolveModelSettings({}), { contextWindow: 128000, maxOutputTokens: 16384 });
  assert.deepEqual(resolveModelSettings({ contextWindow: 32768, maxOutputTokens: 8192 }), { contextWindow: 32768, maxOutputTokens: 8192 });
  assert.throws(() => resolveModelSettings({ contextWindow: 12000, maxOutputTokens: 16384 }), /4096/);
  assert.throws(() => resolveModelSettings({ contextWindow: NaN }), /整数/);
});

for (const content of ['', '[{"id":"unfinished"']) {
  test('truncated nonpersistent output is never accepted as a complete result: ' + (content ? 'partial JSON' : 'reasoning only'), async t => {
    const requests: any[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body))); return completion(content, 'length');
    });
    await assert.rejects(runAgentLoop(connection, '检查重点消息', [], new AbortController().signal, contribution), error => {
      assert.ok(error instanceof AiOutputLimitError);
      assert.equal(error.code, 'MODEL_OUTPUT_TRUNCATED');
      assert.equal(error.result.stopReason, 'length');
      assert.equal(error.result.usage?.output, 16384);
      return true;
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].max_completion_tokens ?? requests[0].max_tokens, 16384);
  });
}

test('persistent truncation continues once in the same session and retains stop reason and usage', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'generation-recovery-'));
  const requests: any[] = [], recovery: boolean[] = [], sessions: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return requests.length === 1 ? completion('', 'length') : completion('已核对，申请已提交，待审批。', 'stop', 30);
  });
  try {
    const result = await runAgentLoop(connection, '核对原申请', [], new AbortController().signal, contribution,
      undefined, undefined, undefined, undefined, {
        cwd: directory, directory, onSession: value => sessions.push(value), onRecovery: value => recovery.push(value),
      });
    assert.equal(result.reply, '已核对，申请已提交，待审批。');
    assert.equal(result.stopReason, 'stop');
    assert.equal(result.usage?.output, 30);
    assert.equal(sessions.length, 1);
    assert.equal(requests.length, 2);
    assert.match(JSON.stringify(requests[1].messages), /不重复已成功或结果未知的提交/);
    assert.deepEqual(recovery, [true, false]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('repeated truncation stops after one continuation and a waiting action prevents recovery', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'generation-recovery-limit-'));
  let calls = 0, yielded = false;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return completion('', 'length'); });
  try {
    const persistent = { cwd: directory, directory, onSession() {}, shouldYield: () => yielded };
    await assert.rejects(runAgentLoop(connection, '继续检查', [], new AbortController().signal, contribution,
      undefined, undefined, undefined, undefined, persistent), AiOutputLimitError);
    assert.equal(calls, 2);
    calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; yielded = true; return completion('', 'length'); });
    await runAgentLoop(connection, '等待必要选择', [], new AbortController().signal, contribution,
      undefined, undefined, undefined, undefined, persistent);
    assert.equal(calls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('business continuation only follows a normal unfinished reply, not a model service error', async t => {
  let calls = 0, pending = true;
  const module = { ...contribution, continuationPrompt: () => pending ? '继续填写原表单' : undefined };
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 2) pending = false;
    return completion(calls === 1 ? '正在填写。' : '表单已核对。', 'stop', 20);
  });
  const result = await runAgentLoop(connection, '只预填', [], new AbortController().signal, module);
  assert.equal(calls, 2);
  assert.equal(result.reply, '表单已核对。');
  calls = 0; pending = true;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(runAgentLoop(connection, '只预填', [], new AbortController().signal, module), /认证失败/);
  assert.equal(calls, 1);
});
