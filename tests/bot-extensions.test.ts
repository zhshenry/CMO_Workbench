import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AiStore } from '../electron/ai-store';
import { BotStore } from '../electron/bot-store';
import { BotHost } from '../electron/bot-host';
import { BotRuntime } from '../electron/bot-runtime';
import { botService } from '../electron/bot-service';
import { botMcpTools } from '../electron/bot-mcp-tools';
import { botWorkspaceTools } from '../electron/bot-workspace-tools';
import type { BotTask } from '../shared/bot-contracts';
import type { McpServerDefinition } from '../shared/bot-extensions';

const surface = { id: 'files-main', kind: 'main' as const };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-extensions-test-')), ai = new AiStore(dir, { recover: false }), store = new BotStore(ai, dir);
  const runtime = new BotRuntime(store, undefined as never, undefined as never, { connection: () => { throw new Error('No model calls in fixture'); }, changed: () => {} });
  const host = new BotHost(store, runtime), bot = store.profile(store.cards()[0].id), peer = store.cards()[1];
  const log = join(dir, 'calls.jsonl'), serverId = randomUUID();
  const definition: McpServerDefinition = { id: serverId, name: '本地测试', enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve('tests/fixtures/bot-mcp-server.mjs'), log], credentialName: 'BOT_FIXTURE_KEY' };
  const input = (text = '执行已选工具') => {
    const draft = host.getDraft(bot.mainChatId, surface);
    const saved = host.saveDraft(bot.mainChatId, draft.revision, { text, replyToTaskId: null, resources: [] }, surface);
    const task = host.submit({ botId: bot.id, chatId: bot.mainChatId, expectedDraftRevision: saved.revision, clientRequestId: randomUUID(), text, replyToTaskId: null, resources: [] }, surface).task;
    return store.updateTask(task.id, { status: 'running' });
  };
  return { dir, ai, store, runtime, host, bot, peer, log, serverId, definition, input,
    close: async () => { await host.stop(); await store.extensions.close(); store.files.close(); ai.close();
      assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('bot-extensions-test-')); rmSync(dir, { recursive: true, force: true }); } };
}
function bind(f: ReturnType<typeof fixture>, tools = [{ name: 'inspect', mode: 'read' as const }, { name: 'record', mode: 'confirm' as const }]) {
  return f.store.extensions.saveBindings(f.bot.id, { revision: f.store.extensions.bindings(f.bot.id).revision, mcp: [{ serverId: f.serverId, tools }] });
}

test('HTTP MCP authenticates through the dedicated header and supports Streamable HTTP discovery and calls', async () => {
  const f = fixture(), headers: string[] = [];
  const protocol = new Server({ name: 'local-http-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
  protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'inspect', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }));
  protocol.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'http fixture result' }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await protocol.connect(transport);
  const http = createServer((req, res) => {
    headers.push(String(req.headers['x-fixture-key'] ?? ''));
    void transport.handleRequest(req, res).catch(() => res.end());
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  try {
    f.store.extensions.configureEncryption({ encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() });
    f.store.extensions.save({ id: f.serverId, name: 'HTTP fixture', transport: 'http', enabled: true,
      url: 'http://127.0.0.1:' + (http.address() as { port: number }).port + '/mcp', credentialName: 'X-Fixture-Key', credentialPrefix: '' }, 0, 'fixture-http-key');
    bind(f);
    assert.equal((await f.store.extensions.discover(f.bot.id, f.serverId))[0].readOnly, true);
    const response = await f.store.extensions.call(f.bot.id, f.serverId, 'inspect', {}, 'read');
    assert.equal((response.content[0] as { text: string }).text, 'http fixture result');
    assert.ok(headers.length >= 3); assert.ok(headers.every(value => value === 'fixture-http-key'));
  } finally { await f.close(); await protocol.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
});

test('MCP credentials stay encrypted in DB and never enter mirrors; external definitions cannot change bindings', async () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.extensions.save(f.definition, 0, 'fixture-only-secret'), /加密不可用/);
    f.store.extensions.configureEncryption({ encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() });
    f.store.extensions.save(f.definition, 0, 'fixture-only-secret'); bind(f);
    assert.equal(f.store.extensions.list()[0].hasCredential, true);
    assert.notEqual(f.ai.setting('bot.mcp.secret.' + f.serverId, ''), 'fixture-only-secret');
    const mirror = join(f.dir, 'mcp', 'servers.json');
    assert.ok(!readFileSync(mirror, 'utf8').includes('fixture-only-secret'));
    const profile = readFileSync(join(f.store.files.paths(f.bot.id).root, 'profile.json'), 'utf8');
    assert.ok(!profile.includes('fixture-only-secret'));
    chmodSync(mirror, 0o600); writeFileSync(mirror, '{"servers":[]}'); f.store.files.repair();
    assert.equal(f.store.extensions.list().length, 1);
    assert.equal(f.store.extensions.bindings(f.bot.id).mcp.length, 1);
    assert.throws(() => f.store.extensions.save({ ...f.definition, transport: 'http', url: 'https://example.com/mcp?secret=bad' } as never, 1));
    assert.throws(() => botService(f.host, 'getExtensions', [f.bot.id], { id: 'island', kind: 'island' }), { code: 'SURFACE_FORBIDDEN' });
  } finally { await f.close(); }
});

test('MCP tools are per Bot; readonly calls validate arguments and run in own workspace', async () => {
  const f = fixture();
  try {
    f.store.extensions.configureEncryption({ encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() });
    f.store.extensions.save(f.definition, 0, 'fixture-only-secret'); bind(f);
    const [left, right] = await Promise.all([f.store.extensions.discover(f.bot.id, f.serverId), f.store.extensions.discover(f.bot.id, f.serverId)]);
    assert.deepEqual(left, right); assert.equal(left.find(tool => tool.name === 'record')!.readOnly, false);
    await assert.rejects(f.store.extensions.call(f.peer.id, f.serverId, 'inspect', { value: 'x' }, 'read'), { code: 'PRECONDITION_FAILED' });
    await assert.rejects(f.store.extensions.call(f.bot.id, f.serverId, 'inspect', { value: 1 } as never, 'read'), { code: 'PRECONDITION_FAILED' });
    const response = await f.store.extensions.call(f.bot.id, f.serverId, 'inspect', { value: 'hello' }, 'read');
    const text = JSON.parse((response.content[0] as { text: string }).text);
    assert.equal(text.cwd.toLowerCase(), f.store.files.paths(f.bot.id).workspace.toLowerCase()); assert.equal(text.hasCredential, true);
    assert.equal(existsSync(f.log), false);
    const task = f.input();
    const message = await botMcpTools(f.store, { ...task, kind: 'message' }, f.host, new AbortController().signal, () => true);
    assert.equal(message.tools.length, 1); assert.match(message.tools[0].label, /inspect/);
    const none = await botMcpTools(f.store, { ...task, botId: f.peer.id }, f.host, new AbortController().signal, () => true);
    assert.equal(none.tools.length, 0);
  } finally { await f.close(); }
});

test('MCP writable tools only create cards; decline never calls, approval calls once', async () => {
  const f = fixture();
  try {
    f.store.extensions.save(f.definition, 0); bind(f);
    const create = async (task: BotTask) => {
      const contribution = await botMcpTools(f.store, task, f.host, new AbortController().signal, () => true);
      const tool = contribution.tools.find(tool => tool.label.endsWith('record'))!;
      await tool.execute(randomUUID(), { value: 'approved' }, undefined, undefined as never, undefined as never);
      return f.store.actions(task.id)[0];
    };
    const declined = await create(f.input('第一次操作'));
    assert.equal(existsSync(f.log), false);
    await f.host.answerAction(declined.id, declined.revision, { approved: false });
    assert.equal(existsSync(f.log), false);
    const pending = await create(f.input('第二次操作'));
    assert.equal(existsSync(f.log), false);
    const applied = await f.host.answerAction(pending.id, pending.revision, { approved: true });
    assert.equal(applied.status, 'applied'); assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
    await f.host.answerAction(pending.id, applied.revision, { approved: true });
    assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
  } finally { await f.close(); }
});

test('changed bindings invalidate pending confirmations and uncertain external writes never replay', async () => {
  const f = fixture();
  try {
    f.store.extensions.save(f.definition, 0);
    f.store.extensions.saveBindings(f.bot.id, { revision: 0, mcp: [{ serverId: f.serverId, tools: [{ name: 'uncertain', mode: 'confirm' }] }] });
    const create = async () => {
      const task = f.input(), contribution = await botMcpTools(f.store, task, f.host, new AbortController().signal, () => true);
      await contribution.tools[0].execute(randomUUID(), { value: 'once' }, undefined, undefined as never, undefined as never);
      return f.store.actions(task.id)[0];
    };
    const stale = await create();
    const bindings = f.store.extensions.bindings(f.bot.id); f.store.extensions.saveBindings(f.bot.id, bindings);
    const failed = await f.host.answerAction(stale.id, stale.revision, { approved: true });
    assert.equal(failed.status, 'failed'); assert.equal(existsSync(f.log), false);
    const pending = await create(), unknown = await f.host.answerAction(pending.id, pending.revision, { approved: true });
    assert.equal(unknown.status, 'unknown'); assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
    await assert.rejects(f.host.answerAction(unknown.id, unknown.revision, { approved: true }));
    assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
  } finally { await f.close(); }
});

test('own files require explicit sharing, produced files can be shared and skills never grant filesystem tools to queries', async () => {
  const f = fixture();
  try {
    const task = f.input(), own = f.store.files.write(f.bot.id, 'outputs/private.md', 'private');
    const produced = f.store.files.write(f.bot.id, 'outputs/result.md', 'shared result', false, task.id);
    assert.throws(() => f.host.sendMessage(f.bot.id, randomUUID(), f.peer.id, 'read', 'query', [{ kind: 'file', id: own.id }], task.id), { code: 'RESOURCE_FORBIDDEN' });
    assert.ok(f.host.sendMessage(f.bot.id, randomUUID(), f.peer.id, 'read', 'query', [{ kind: 'file', id: produced.id }], task.id));
    assert.throws(() => f.host.submit({ botId: f.peer.id, chatId: f.peer.mainChatId, expectedDraftRevision: 0, clientRequestId: randomUUID(), text: 'read', replyToTaskId: null, resources: [{ kind: 'file', id: own.id }] }, surface), { code: 'RESOURCE_FORBIDDEN' });
    assert.equal(botWorkspaceTools(f.store, { ...task, kind: 'message' }, () => true).tools.length, 0);
    assert.ok(botWorkspaceTools(f.store, task, () => true).tools.some(tool => tool.name === 'write_file'));
  } finally { await f.close(); }
});

test('existing artifacts retain database IDs and materialize under the producer outputs on restart', async () => {
  const f = fixture();
  try {
    const task = f.input(), id = randomUUID();
    const artifact = f.store.artifact({ id, producerBotId: f.bot.id, taskId: task.id, rootTaskId: task.rootTaskId, chatId: task.chatId,
      title: '已存报告', mediaType: 'text/markdown', content: '# saved report', createdAt: new Date().toISOString() }, 'artifact-test');
    f.store.files.repair();
    const path = join(f.store.files.paths(f.bot.id).outputs, id + '.md');
    assert.equal(readFileSync(path, 'utf8'), '# saved report');
    assert.equal(f.store.get('bot_artifacts', id).id, artifact.id);
    writeFileSync(path, '# user edited');
    f.store.files.repair();
    assert.equal(readFileSync(path, 'utf8'), '# user edited');
    assert.equal(f.store.get<{ content: string }>('bot_artifacts', id).content, '# saved report');
  } finally { await f.close(); }
});

test('settings shows shared connection usage without assigning its tools to another Bot', async () => {
  const f = fixture();
  try {
    f.store.extensions.save(f.definition, 0); bind(f);
    const selected = botService(f.host, 'getExtensions', [f.bot.id], surface) as import('../shared/bot-extensions').BotExtensionsView;
    const peer = botService(f.host, 'getExtensions', [f.peer.id], surface) as import('../shared/bot-extensions').BotExtensionsView;
    assert.deepEqual(selected.usage[f.serverId], [f.bot.id]);
    assert.deepEqual(peer.usage[f.serverId], [f.bot.id]);
    assert.deepEqual(peer.bindings.mcp, []);
    assert.equal(peer.servers[0].id, f.serverId);
    assert.equal(JSON.stringify(peer).includes('credential"'), false);
  } finally { await f.close(); }
});

test('settings skill preview is scoped to the selected Bot and main window', async () => {
  const f = fixture();
  try {
    const common = join(f.dir, 'skills', 'weekly-report'), own = join(f.store.files.paths(f.bot.id).skills, 'weekly-report');
    for (const [folder, body] of [[common, '公共模板'], [own, '当前 Bot 专属模板']]) {
      mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'SKILL.md'), '---\nname: weekly-report\ndescription: 周报整理\n---\n' + body);
    }
    const view = botService(f.host, 'getSkills', [f.bot.id], surface) as import('../shared/bot-files').BotSkillsView;
    assert.equal(view.skills.length, 2); assert.equal(view.skills.find(skill => skill.source === 'shared')?.overridden, true);
    assert.equal(JSON.stringify(view).includes('content'), false);
    assert.match(botService(f.host, 'readSkill', [f.bot.id, 'private', 'weekly-report'], surface) as string, /当前 Bot 专属模板/);
    assert.match(botService(f.host, 'readSkill', [f.peer.id, 'shared', 'weekly-report'], surface) as string, /公共模板/);
    assert.throws(() => botService(f.host, 'readSkill', [f.peer.id, 'private', 'weekly-report'], surface), /已移除|格式无效/);
    assert.throws(() => botService(f.host, 'getSkills', [f.bot.id], { id: 'island', kind: 'island' }), { code: 'SURFACE_FORBIDDEN' });
    assert.throws(() => botService(f.host, 'readSkill', [f.bot.id, 'private', 'weekly-report'], { id: 'island', kind: 'island' }), { code: 'SURFACE_FORBIDDEN' });
  } finally { await f.close(); }
});

test('MCP IPC preserves a blank credential after JSON transport and only clears explicitly', async () => {
  const f = fixture();
  try {
    f.store.extensions.configureEncryption({ encrypt: value => 'encrypted:' + value, decrypt: value => value.slice(10) });
    botService(f.host, 'saveMcpServer', [f.definition, 0, 'private-test-key'], surface);
    const changed = botService(f.host, 'saveMcpServer', [{ ...f.definition, name: '修改连接名称' }, 1, null], surface) as import('../shared/bot-extensions').McpServer;
    assert.equal(changed.hasCredential, true);
    assert.equal(f.ai.setting('bot.mcp.secret.' + f.serverId, ''), 'encrypted:private-test-key');
    const cleared = botService(f.host, 'saveMcpServer', [changed.definition, changed.revision, ''], surface) as import('../shared/bot-extensions').McpServer;
    assert.equal(cleared.hasCredential, false);
    const next = botService(f.host, 'saveMcpServer', [changed.definition, cleared.revision, null], surface) as import('../shared/bot-extensions').McpServer;
    assert.equal(next.hasCredential, false);
  } finally { await f.close(); }
});
