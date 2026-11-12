import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Compile } from 'typebox/compile';
import type { WebContents } from 'electron';
import { runAgentLoop } from '../electron/ai-core';
import type { BrowserAutomation } from '../electron/browser/tasks';
import { buildBrowserContribution } from '../modules/browser/ai';
import type { AIProtocol } from '../shared/todo-contracts';

const query = { selector: { by: 'css', value: '#content_left > div, #content_left .result, #content_left .c-container' }, limit: 100 };
const valid = { tabId: '99625d11-6a74-4165-bd12-a5ed832d3b59', query };
const invalid = { ...valid, query: { ...query, by: 'css', selectorText: true } };

function fixture() {
  const calls: unknown[][] = [];
  const automation = { observe: async (...args: unknown[]) => { calls.push(args); return { text: '找到 2 条百度百科结果', elements: [], frames: [], truncated: false }; } } as unknown as BrowserAutomation;
  const contribution = buildBrowserContribution(automation, {} as WebContents, { id: 'task1', workspace: 'default', goal: '统计百度百科结果', status: 'running', tabIds: [valid.tabId], origins: ['https://www.baidu.com'], steps: [], updatedAt: '2026-10-17T00:00:00Z' }, false);
  return { contribution, calls, tool: contribution.buildTools().find(tool => tool.name === 'browser_observe')! };
}

test('observe rejects unexpected root and nested keys by their full paths without changing the received input', () => {
  const { tool, calls } = fixture();
  for (const [input, paths] of [
    [invalid, ['query.by', 'query.selectorText']],
    [{ ...valid, selectorText: true }, ['selectorText']],
    [{ ...valid, query: { selector: { ...query.selector, selectorText: true } } }, ['query.selector.selectorText']],
    [{ ...valid, query: { within: [{ by: 'css', value: '#content_left', selectorText: true }] } }, ['query.within.0.selectorText']],
  ] as const) {
    const before = JSON.stringify(input);
    assert.equal(Compile(tool.parameters).Check(input), false);
    assert.throws(() => tool.prepareArguments!(input), error => {
      const feedback = JSON.parse((error as Error).message);
      assert.equal(feedback.code, 'invalid-tool-arguments');
      assert.deepEqual(feedback.invalidFields, paths);
      for (const path of paths) assert.ok(feedback.message.includes(path));
      assert.match(feedback.hint, /query\.selector\.by/);
      assert.match(feedback.hint, /selectorText/);
      for (const example of feedback.examples) assert.equal(Compile(tool.parameters).Check({ tabId: valid.tabId, ...example }), true);
      return true;
    });
    assert.equal(JSON.stringify(input), before);
  }
  assert.equal(calls.length, 0);
});

test('tool errors include the asynchronously retrieved page state without replacing the original error', async () => {
  const automation = {
    observe: async () => { throw new Error('synthetic operation failed'); },
    lastObservation: async () => ({ text: '页面仍显示原表单', elements: [{ ref: 'cached:1', role: 'button', name: '保存' }] }),
  } as unknown as BrowserAutomation;
  const contribution = buildBrowserContribution(automation, {} as WebContents, { id: 'task1', workspace: 'default', goal: '保存表单', status: 'running', tabIds: [valid.tabId], origins: ['https://fixture.test'], steps: [], updatedAt: '2026-11-10T00:00:00Z' }, false);
  const tool = contribution.buildTools().find(tool => tool.name === 'browser_observe')!;
  await assert.rejects(tool.execute('probe', { tabId: valid.tabId }), error => {
    const feedback = JSON.parse((error as Error).message);
    assert.equal(feedback.message, 'synthetic operation failed');
    assert.deepEqual(feedback.pageState, { text: '页面仍显示原表单', elements: [{ ref: 'cached:1', role: 'button', name: '保存' }] });
    return true;
  });
});

test('valid observe arguments pass unchanged and the published schema retains its strict bounds', () => {
  const { tool } = fixture();
  for (const input of [valid, { tabId: valid.tabId }, { ...valid, query: null }]) assert.equal(tool.prepareArguments!(input), input);
  assert.equal(Compile(tool.parameters).Check(valid), true);
  assert.equal(Compile(tool.parameters).Check({ ...valid, query: { limit: 251 } }), false);
  assert.equal(Compile(tool.parameters).Check({ ...valid, query: { evaluate: 'arbitrary()' } }), false);
});

function actFixture(elements: { ref: string; role: string; name: string }[] = []) {
  const automation = { observe: async () => ({ text: '', elements, frames: [], truncated: false }), act: async () => ({ text: '', elements: [], frames: [], truncated: false }) } as unknown as BrowserAutomation;
  const contribution = buildBrowserContribution(automation, {} as WebContents, { id: 'task1', workspace: 'default', goal: '操作页面', status: 'running', tabIds: [valid.tabId], origins: ['https://www.baidu.com'], steps: [], updatedAt: '2026-10-17T00:00:00Z' }, false);
  return { tool: contribution.buildTools().find(tool => tool.name === 'browser_act')! };
}

test('browser_act with no recent observe uses placeholder ref in error examples', () => {
  const { tool } = actFixture();
  assert.throws(() => tool.prepareArguments!({ tabId: valid.tabId, action: {} }), error => {
    const feedback = JSON.parse((error as Error).message);
    assert.equal(feedback.code, 'invalid-tool-arguments');
    const refs = feedback.examples.map((e: any) => e.action?.ref).filter(Boolean);
    assert.deepEqual(refs, ['<observe 返回的 ref>', '<observe 返回的 ref>']);
    return true;
  });
});

test('browser_act injects real ref from latest observe into error examples when action misses type', async () => {
  const elements = [
    { ref: '9f337bd5:e12', role: 'button', name: '提交申请', value: '', disabled: false, frameId: 'f1' },
    { ref: '9f337bd5:e46', role: 'textbox', name: '请选择Offering信息', value: '', disabled: false, frameId: 'f1' },
  ];
  const automation = { observe: async () => ({ text: '', elements, frames: [], truncated: false }), act: async () => ({ text: '', elements: [], frames: [], truncated: false }) } as unknown as BrowserAutomation;
  const contribution = buildBrowserContribution(automation, {} as WebContents, { id: 'task1', workspace: 'default', goal: '操作页面', status: 'running', tabIds: [valid.tabId], origins: ['https://www.baidu.com'], steps: [], updatedAt: '2026-10-17T00:00:00Z' }, false);
  const tools = contribution.buildTools();
  const observe = tools.find(tool => tool.name === 'browser_observe')!;
  const act = tools.find(tool => tool.name === 'browser_act')!;
  await observe.execute!('id', { tabId: valid.tabId });
  assert.throws(() => act.prepareArguments!({ tabId: valid.tabId, action: {} }), error => {
    const feedback = JSON.parse((error as Error).message);
    assert.equal(feedback.code, 'invalid-tool-arguments');
    assert.ok(feedback.invalidFields.includes('action.type（必填，取 click/fill/locator 等枚举值）'));
    const refs = feedback.examples.map((e: any) => e.action?.ref).filter(Boolean);
    assert.ok(refs.includes('9f337bd5:e12'), 'click 示例应含真实 ref');
    assert.ok(refs.includes('9f337bd5:e46'), 'fill 示例应含真实 textbox ref');
    assert.ok(!refs.includes('<observe 返回的 ref>'), '不应再出现占位符');
    assert.match(feedback.hint, /缺 ref 时先 observe/);
    return true;
  });
});

test('browser_act 返回的新观察刷新 ref 缓存,后续纠错示例注入新 ref 而非过期 observe ref (DTS2026110421261600)', async () => {
  // 时序:observe(返回 ref=observe-ref) → act 成功(返回新观察,ref=act-ref,driver 每次 observe 换 observationId)
  // → act 参数错。纠错示例应注入 act-ref(最新),不是 observe-ref(两代之前已失效)。
  const observeElements = [{ ref: 'aaaaaaaa:e1', role: 'button', name: '旧按钮', value: '', disabled: false, frameId: 'f1' }];
  const actElements = [{ ref: 'bbbbbbbb:e2', role: 'button', name: '新按钮', value: '', disabled: false, frameId: 'f1' }];
  const automation = {
    observe: async () => ({ text: '', elements: observeElements, frames: [], truncated: false }),
    act: async () => ({ text: '', elements: actElements, frames: [], truncated: false }),
  } as unknown as BrowserAutomation;
  const contribution = buildBrowserContribution(automation, {} as WebContents, { id: 'task1', workspace: 'default', goal: '操作页面', status: 'running', tabIds: [valid.tabId], origins: ['https://www.baidu.com'], steps: [], updatedAt: '2026-10-17T00:00:00Z' }, false);
  const tools = contribution.buildTools();
  const observe = tools.find(tool => tool.name === 'browser_observe')!;
  const act = tools.find(tool => tool.name === 'browser_act')!;
  await observe.execute!('id', { tabId: valid.tabId });
  // act 成功:返回新观察(actElements),result() 应刷新缓存为 act-ref
  await act.execute!('id', { tabId: valid.tabId, action: { type: 'click', ref: 'aaaaaaaa:e1' } });
  // act 参数错:纠错示例应注入 act-ref(bbbbbbbb:e2),不再注入过期的 observe-ref(aaaaaaaa:e1)
  assert.throws(() => act.prepareArguments!({ tabId: valid.tabId, action: {} }), error => {
    const feedback = JSON.parse((error as Error).message);
    const refs = feedback.examples.map((e: any) => e.action?.ref).filter(Boolean);
    assert.ok(refs.includes('bbbbbbbb:e2'), '纠错示例应注入 act 返回的新 ref');
    assert.ok(!refs.includes('aaaaaaaa:e1'), '不应注入两代之前的过期 observe ref');
    return true;
  });
});


for (const protocol of ['openai-chat', 'openai-responses', 'anthropic'] as AIProtocol[]) test(`${protocol} returns named argument errors to the model and UI before accepting a corrected observe call`, async () => {
  const { contribution, calls } = fixture();
  const bodies: any[] = [], outputs: { status: string; output: string }[] = [];
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); bodies.push(body);
    const step = bodies.length, feedbackReceived = step !== 2 || ['query.by', 'query.selectorText', 'invalid-tool-arguments'].every(text => raw.includes(text));
    const toolCall = step === 1 || step === 2 && feedbackReceived;
    const id = `observe${step}`, args = JSON.stringify(step === 1 ? invalid : valid);
    const reply = feedbackReceived ? '已统计，找到 2 条百度百科结果。' : '错误反馈不足，无法修正。';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (type: string, fields: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    if (protocol === 'openai-chat') {
      const chunk = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      chunk(toolCall ? { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'browser_observe', arguments: args } }] } : { content: reply });
      chunk({}, toolCall ? 'tool_calls' : 'stop'); response.end('data: [DONE]\n\n');
    } else if (protocol === 'anthropic') {
      event('message_start', { message: { id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', content: [], usage: { input_tokens: 1, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: toolCall ? { type: 'tool_use', id, name: 'browser_observe', input: {} } : { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: toolCall ? { type: 'input_json_delta', partial_json: args } : { type: 'text_delta', text: reply } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: toolCall ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } }); event('message_stop', {}); response.end();
    } else {
      const item = toolCall ? { id, type: 'function_call', call_id: id, name: 'browser_observe', arguments: args }
        : { id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply, annotations: [] }] };
      event('response.created', { response: { id: 'fixture' } });
      event('response.output_item.added', { output_index: 0, item: toolCall ? { ...item, arguments: '' } : { ...item, content: [] } });
      if (toolCall) event('response.function_call_arguments.delta', { output_index: 0, item_id: id, delta: args });
      else event('response.output_text.delta', { output_index: 0, delta: reply });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id: 'fixture', status: 'completed', output: [item] } }); response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await runAgentLoop({ endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'fixture', protocol, key: 'synthetic' }, '统计百度百科结果', [], AbortSignal.timeout(20000), contribution, undefined, event => outputs.push(event));
    assert.equal(result.reply, '已统计，找到 2 条百度百科结果。');
    assert.equal(bodies.length, 3);
    assert.equal(calls.length, 1, 'Only the corrected tool call may reach the browser');
    assert.equal(calls[0][2], valid.tabId);
    assert.deepEqual((calls[0][5] as { selector: unknown }).selector, { ...query.selector, exact: true, ignoreCase: false });
    const failure = outputs.find(event => event.status === 'error');
    assert.ok(failure);assert.match(failure.output, /query\.by/);assert.match(failure.output, /query\.selectorText/);
    assert.ok(outputs.some(event => event.status === 'complete' && event.output.includes('找到 2 条百度百科结果')));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
