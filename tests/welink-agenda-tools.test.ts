import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { welinkDisplayEvents } from '../shared/welink-display';

test('AI agenda and detail tools use the shared service, preserve partial status and do not fall back to a single CLI source', async () => {
  const require = createRequire(import.meta.url), mod = { exports: {} as any }, calls: unknown[] = [];
  const code = transformSync(readFileSync('modules/welink/ai-tools.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === '../../electron/welink-cli' ? { runWelink: () => assert.fail('the shared tools must not bypass the agenda service') } : name === '../../shared/welink-display' ? { welinkDisplayEvents } : name === '@earendil-works/pi-coding-agent' ? { defineTool: (tool: unknown) => tool } : require(name), mod, mod.exports);
  const service = {
    agenda: async (start: string, end: string) => { calls.push([start, end]); return { events: [{ taskId: 'calendar-a', title: '项目评审', start: '2026-11-16T10:00:00+08:00', end: '2026-11-16T11:00:00+08:00', external: { provider: 'calendar', account: 'z00123456', id: 'a' } }], sources: { calendar: { state: 'success' }, meeting: { state: 'error', error: 'timeout' } } }; },
    details: async (id: string) => { calls.push(id); return { onlineMeetingUrl: 'https://example.com/join' }; },
  };
  const contribution = mod.exports.buildWelinkContribution(undefined, service), tools = contribution.buildTools();
  assert.ok(contribution.toolNames.includes('welink_agenda'));
  assert.match(contribution.systemPrompt(), /不能|才能/);
  const result = await tools.find((t: any) => t.name === 'welink_agenda').execute('1', { start: '2026-11-16', end: '2026-11-17' });
  assert.equal(JSON.parse(result.content[0].text).sources.meeting.state, 'error');
  assert.equal(JSON.parse(result.content[0].text).displayEvents[0].sources[0].taskId, 'calendar-a');
  await tools.find((t: any) => t.name === 'welink_calendar_details').execute('2', { taskId: 'calendar-a' });
  assert.deepEqual(calls, [['2026-11-16', '2026-11-17'], 'calendar-a']);
  service.agenda = async () => { throw new Error('连接失败'); };
  const failed = await tools.find((t: any) => t.name === 'welink_agenda').execute('3', { start: '2026-11-16', end: '2026-11-17' });
  assert.equal(JSON.parse(failed.content[0].text).complete, false);
});

function welinkTools(run: (...args: any[]) => Promise<string>, confirm?: (ask: { intent: string; target: string }) => Promise<'confirmed' | 'cancelled'>) {
  const require = createRequire(import.meta.url), mod = { exports: {} as any };
  const code = transformSync(readFileSync('modules/welink/ai-tools.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === '../../electron/welink-cli' ? { runWelink: run } : name === '../../shared/welink-display' ? { welinkDisplayEvents } : name === '@earendil-works/pi-coding-agent' ? { defineTool: (tool: unknown) => tool } : require(name), mod, mod.exports);
  return mod.exports.buildWelinkContribution(confirm).buildTools();
}

test('WeLink refuses writes when no confirmation channel is connected', async () => {
  let runs = 0;
  const tool = welinkTools(async () => { runs++; return 'sent'; }).find((tool: any) => tool.name === 'welink_run');
  await tool.execute('write', { service: 'im', subcommand: 'send-to-user', args: ['--receiver', 'z00123456', '--text', '会议改到下午'] });
  assert.equal(runs, 0, 'a prompt instruction is not a write gate');
});

test('WeLink confirms each mutation once, including upload and commands outside the read whitelist', async () => {
  const calls: string[][] = [], asks: { intent: string; target: string }[] = [];
  const tools = welinkTools(async args => { calls.push(args); return '{"code":200}'; }, async ask => { asks.push(ask); return 'confirmed'; });
  assert.equal(tools.some((tool: any) => tool.name === 'declare_write'), false, 'the execution tool owns confirmation without a second declaration');
  const tool = tools.find((tool: any) => tool.name === 'welink_run');
  await tool.execute('read', { service: 'im', subcommand: 'query-recent-conversation', args: [] });
  assert.equal(asks.length, 0);
  for (const subcommand of ['send-to-user', 'future-write']) {
    await tool.execute(subcommand, { service: 'im', subcommand, args: ['--text', '完整内容'] });
  }
  await tool.execute('upload', { service: 'onebox', subcommand: 'file-upload', args: ['C:\\example.txt', '--space-id', 'test-space'] });
  assert.equal(asks.length, 3);
  assert.equal(calls.length, 4);
  assert.ok(asks[0].target.includes('完整内容'));
});

test('WeLink cancellation and invalid service names never launch the CLI', async () => {
  let runs = 0, asks = 0;
  const tool = welinkTools(async () => { runs++; return 'sent'; }, async () => { asks++; return 'cancelled'; }).find((tool: any) => tool.name === 'welink_run');
  await tool.execute('cancel', { service: 'mail', subcommand: 'send', args: ['--body', '不要发送'] });
  assert.equal(asks, 1); assert.equal(runs, 0);
  await tool.execute('bad', { service: '--help', subcommand: 'send', args: [] });
  assert.equal(asks, 1); assert.equal(runs, 0);
});

test('WeLink executes the exact argument snapshot shown for confirmation', async () => {
  const args = ['--receiver', 'z00123456', '--text', '已确认的正文'], calls: string[][] = [];
  const tool = welinkTools(async input => { calls.push(input); return 'sent'; }, async ask => {
    assert.ok(ask.target.includes('已确认的正文'));
    args[3] = '不能替换成另一段正文';
    return 'confirmed';
  }).find((tool: any) => tool.name === 'welink_run');
  await tool.execute('snapshot', { service: 'im', subcommand: 'send-to-user', args });
  assert.equal(calls[0][5], '已确认的正文');
});
