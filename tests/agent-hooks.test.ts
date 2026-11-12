import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentHooks } from '../electron/agent-hooks';
import { agentHookScript } from '../electron/agent-hook-script';

function setup(): { dir: string; project: string; settings: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-hooks-'));
  const project = mkdtempSync(join(tmpdir(), 'cmo-proj-'));
  return { dir, project, settings: join(project, '.claude', 'settings.json') };
}
const readSettings = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

test('AgentHooks refuses missing, file and relative paths without recreating projects', t => {
  const { dir, project, settings } = setup(), hooks = new AgentHooks(dir);
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); });
  const missing = join(project, 'removed-project'), file = join(project, 'not-a-directory'); writeFileSync(file, 'unchanged');
  for (const path of [missing, file, relative(process.cwd(), project)]) {
    const result = hooks.setEnabled([path]);
    assert.equal(result.failed.length, 1); assert.deepEqual(result.enabled, []);
    assert.equal(existsSync(missing), false); assert.equal(existsSync(settings), false);
  }
  assert.equal(readFileSync(file, 'utf8'), 'unchanged');
});

test('AgentHooks merges equivalent Windows paths and can disconnect after the project was removed', t => {
  const { dir, project } = setup(), hooks = new AgentHooks(dir);
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); });
  const aliases = process.platform === 'win32' ? [project, project.toUpperCase().replaceAll('\\', '/')] : [project, project + '/'];
  const connected = hooks.setEnabled(aliases); assert.deepEqual(connected.failed, []); assert.deepEqual(connected.enabled, [project]);
  rmSync(project, { recursive: true, force: true });
  assert.deepEqual(hooks.setEnabled([]), { enabled: [], failed: [] }); assert.equal(existsSync(project), false);
});

test('AgentHooks: failed disconnect keeps the project enabled and its hook intact', () => {
  const { dir, project, settings } = setup(), hooks = new AgentHooks(dir);
  hooks.setEnabled([project]);
  const before = readFileSync(settings, 'utf8');
  hooks.connectOne = () => { throw new Error('synthetic write lock'); };
  const result = hooks.setEnabled([]);
  assert.deepEqual(result.enabled, [project]);
  assert.equal(result.failed[0].error, 'synthetic write lock');
  assert.equal(readFileSync(settings, 'utf8'), before);
  assert.deepEqual(new AgentHooks(dir).listEnabled(), [project]);
});

test('AgentHooks: relay keeps separate prompts in one session and deduplicates replay', () => {
  const { dir, project } = setup(), hooks = new AgentHooks(dir);
  const relay = join(dir, 'relay.cjs');
  writeFileSync(relay, agentHookScript(hooks.inbox));
  const send = (prompt: string, text: string) => execFileSync(process.execPath, [relay], { windowsHide: true, input: JSON.stringify({ session_id: 'session-1', prompt_id: prompt, cwd: project, last_assistant_message: text }) });
  send('prompt-1', '第一轮回复'); hooks.poll();
  send('prompt-2', '第二轮回复'); hooks.poll();
  send('prompt-1', '第一轮回复'); hooks.poll();
  const messages = hooks.messages.read();
  assert.equal(messages.length, 2);
  assert.deepEqual(new Set(messages.map(message => message.title)), new Set(['第一轮回复', '第二轮回复']));
});

test('AgentHooks: legacy Stop events without a round id still deliver each reply', () => {
  const { dir, project } = setup(), hooks = new AgentHooks(dir);
  const relay = join(dir, 'relay.cjs');
  writeFileSync(relay, agentHookScript(hooks.inbox));
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, [relay], { windowsHide: true, input: JSON.stringify({ session_id: 'legacy-session', cwd: project }) });
    hooks.poll();
  }
  assert.equal(hooks.messages.read().length, 2);
});

test('AgentHooks: existing connected projects receive the updated relay on polling', () => {
  const { dir, project } = setup(), hooks = new AgentHooks(dir);
  hooks.setEnabled([project]);
  const relay = join(dir, 'agent-hooks', 'codeai-island.js');
  writeFileSync(relay, 'old synthetic relay');
  hooks.poll();
  assert.equal(readFileSync(relay, 'utf8'), agentHookScript(hooks.inbox));
});

test('AgentHooks.setEnabled: 无 settings.json 时新建并追加 Stop hook', () => {
  const { dir, project, settings } = setup();
  const hooks = new AgentHooks(dir, () => 2000);
  const result = hooks.setEnabled([project]);
  assert.deepEqual(result.failed, []);
  assert.ok(existsSync(settings));
  const config = readSettings(settings);
  const stop = config.hooks.Stop.find((entry: { matcher?: string }) => entry.matcher === '');
  assert.ok(stop);
  assert.ok(stop.hooks.some((h: { command?: string }) => h.command === `node "${join(dir, 'agent-hooks', 'codeai-island.js')}"`));
  assert.deepEqual(hooks.listEnabled(), [project]);
  // relay 脚本已落盘
  assert.ok(existsSync(join(dir, 'agent-hooks', 'codeai-island.js')));
});

test('AgentHooks.setEnabled: 保留用户已有的 Stop hook,只追加我们的', () => {
  const { dir, project, settings } = setup();
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/stop.js', timeout: 10000 }] }] } }));
  const hooks = new AgentHooks(dir, () => 2000);
  hooks.setEnabled([project]);
  const stop = readSettings(settings).hooks.Stop.find((entry: { matcher?: string }) => entry.matcher === '');
  assert.equal(stop.hooks.length, 2);
  assert.ok(stop.hooks.some((h: { command?: string }) => h.command === 'node .claude/hooks/stop.js'));
  assert.ok(stop.hooks.some((h: { command?: string }) => h.command.startsWith('node "')));
});

test('AgentHooks.setEnabled: 取消勾选移除我们的 hook,保留用户其他 hook', () => {
  const { dir, project, settings } = setup();
  mkdirSync(join(project, '.claude'), { recursive: true });
  const user = { type: 'command', command: 'node .claude/hooks/stop.js', timeout: 10000 };
  writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [user] }] } }));
  const hooks = new AgentHooks(dir, () => 2000);
  hooks.setEnabled([project]);
  hooks.setEnabled([]);
  const stop = readSettings(settings).hooks.Stop.find((entry: { matcher?: string }) => entry.matcher === '');
  assert.deepEqual(stop.hooks, [user]);
  assert.deepEqual(hooks.listEnabled(), []);
});

test('AgentHooks.setEnabled: 写前备份原 settings.json', () => {
  const { dir, project, settings } = setup();
  mkdirSync(join(project, '.claude'), { recursive: true });
  const original = JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node keep.js' }] }] } });
  writeFileSync(settings, original);
  const hooks = new AgentHooks(dir, () => 1700000000000);
  hooks.setEnabled([project]);
  const backups = readdirSync(join(project, '.claude')).filter(name => name.startsWith('settings.json.cmo-backup-'));
  assert.ok(backups.length >= 1);
  assert.equal(readFileSync(join(project, '.claude', backups[0]), 'utf8'), original);
});

test('AgentHooks.setEnabled: 写前备份 + 重读比对保护——同次正常注入不误报冲突', () => {
  const { dir, project, settings } = setup();
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(settings, JSON.stringify({ hooks: { Stop: [] } }));
  const hooks = new AgentHooks(dir, () => 1700000000000);
  const result = hooks.setEnabled([project]);
  assert.deepEqual(result.failed, []);
  // 备份存在(因原文件非空)
  const backups = readdirSync(join(project, '.claude')).filter(name => name.startsWith('settings.json.cmo-backup-'));
  assert.ok(backups.length >= 1);
  const stop = readSettings(settings).hooks.Stop.find((e: { matcher?: string }) => e.matcher === '');
  assert.ok(stop.hooks.length >= 1);
});

test('AgentHooks.setEnabled: 失败项目不影响成功项目,enabled 只记成功项', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-hooks-'));
  const okProject = mkdtempSync(join(tmpdir(), 'cmo-ok-'));
  const badProject = mkdtempSync(join(tmpdir(), 'cmo-bad-'));
  mkdirSync(join(badProject, '.claude'), { recursive: true });
  writeFileSync(join(badProject, '.claude', 'settings.json'), 'not json at all');
  const hooks = new AgentHooks(dir, () => 2000);
  const result = hooks.setEnabled([okProject, badProject]);
  assert.ok(existsSync(join(okProject, '.claude', 'settings.json')));
  assert.ok(result.failed.some(f => f.path === badProject));
  assert.ok(result.enabled.includes(okProject));
  assert.ok(!result.enabled.includes(badProject));
});

test('AgentHooks.poll: 读 inbox 事件入库,坏文件 rename .invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-hooks-'));
  const hooks = new AgentHooks(dir, () => 2000);
  const inbox = join(dir, 'agent-inbox');
  mkdirSync(inbox, { recursive: true });
  // 有效事件
  writeFileSync(join(inbox, '0000001-aaaaaaaaaaaaaaaa.json'), JSON.stringify({ provider: 'codeai', sessionId: 's1', turnId: 't1', kind: 'reply', workspace: 'D:\\proj', occurredAt: 1000 }));
  // 坏事件
  writeFileSync(join(inbox, '0000002-bbbbbbbbbbbbbbbb.json'), 'not json');
  const result = hooks.poll();
  assert.equal(result.changed, true);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].sessionId, 's1');
  assert.equal(hooks.messages.read().length, 1);
  // 坏文件保留为 .invalid,有效文件已删
  assert.ok(existsSync(join(inbox, '0000002-bbbbbbbbbbbbbbbb.json.invalid')));
  assert.ok(!existsSync(join(inbox, '0000001-aaaaaaaaaaaaaaaa.json')));
  // 再 poll 一次:无新事件
  const again = hooks.poll();
  assert.equal(again.changed, false);
});

test('agentHookScript: 注入 inbox 路径,可被 node 解析(含反斜杠路径)', () => {
  const script = agentHookScript('C:\\Users\\test\\agent-inbox');
  assert.match(script, /C:\\\\Users\\\\test\\\\agent-inbox/);
  assert.match(script, /session_id/);
  assert.match(script, /transcript_path/);
  assert.match(script, /fs\.renameSync/);
});
