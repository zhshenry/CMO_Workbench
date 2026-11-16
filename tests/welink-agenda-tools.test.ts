import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

test('AI agenda and detail tools use the shared service, preserve partial status and do not fall back to a single CLI source', async () => {
  const require = createRequire(import.meta.url), mod = { exports: {} as any }, calls: unknown[] = [];
  const code = transformSync(readFileSync('modules/welink/ai-tools.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === '../../electron/welink-cli' ? { runWelink: () => assert.fail('the shared tools must not bypass the agenda service') } : name === '@earendil-works/pi-coding-agent' ? { defineTool: (tool: unknown) => tool } : require(name), mod, mod.exports);
  const service = {
    agenda: async (start: string, end: string) => { calls.push([start, end]); return { events: [{ taskId: 'calendar-a' }], sources: { calendar: { state: 'success' }, meeting: { state: 'error', error: 'timeout' } } }; },
    details: async (id: string) => { calls.push(id); return { onlineMeetingUrl: 'https://example.com/join' }; },
  };
  const contribution = mod.exports.buildWelinkContribution(undefined, service), tools = contribution.buildTools();
  assert.ok(contribution.toolNames.includes('welink_agenda'));
  assert.match(contribution.systemPrompt(), /不能|才能/);
  const result = await tools.find((t: any) => t.name === 'welink_agenda').execute('1', { start: '2026-11-16', end: '2026-11-17' });
  assert.equal(JSON.parse(result.content[0].text).sources.meeting.state, 'error');
  await tools.find((t: any) => t.name === 'welink_calendar_details').execute('2', { taskId: 'calendar-a' });
  assert.deepEqual(calls, [['2026-11-16', '2026-11-17'], 'calendar-a']);
  service.agenda = async () => { throw new Error('连接失败'); };
  const failed = await tools.find((t: any) => t.name === 'welink_agenda').execute('3', { start: '2026-11-16', end: '2026-11-17' });
  assert.equal(JSON.parse(failed.content[0].text).complete, false);
});
