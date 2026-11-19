import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { IslandStore } from '../electron/island-store';
import { AgentMessageStore } from '../electron/agent-message-store';
import { newTask } from '../shared/todo-contracts';
import { DEFAULT_APP_SETTINGS } from '../shared/contracts';
import { WelinkMessageReminders } from '../electron/welink-message-reminders';
import { WelinkReminderSettingsSchema } from '../shared/welink-reminders';

const require = createRequire(join(process.cwd(), 'electron', 'desktop-island.ts'));
function fixture(t: TestContext, WelinkSync: unknown = class {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 10, 11, 10).getTime() });
  const dir = mkdtempSync(join(tmpdir(), 'cmo-island-bubbles-')), windows: any[] = [], handlers = new Map<string, Function>(), sent: { channel: string; args: unknown[] }[] = [];
  const screens = Object.assign(new EventEmitter(), {
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }],
    getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  });
  class Window extends EventEmitter {
    visible = false; webContents: any; bounds: any;
    constructor(options: any) { super(); this.bounds = options; windows.push(this); this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send(channel: string, ...args: unknown[]) { sent.push({ channel, args }); }, setWindowOpenHandler() {} }); }
    static getAllWindows() { return windows; }
    setAlwaysOnTop() {} setShape() {} setBounds(value: any) { this.bounds = value; } getBounds() { return this.bounds; }
    loadURL() {} loadFile() {} showInactive() { this.visible = true; } hide() { this.visible = false; }
    isVisible() { return this.visible; } isDestroyed() { return false; } destroy() {}
  }
  const main = new Window({});
  const electron = { BrowserWindow: Window, screen: screens, powerMonitor: new EventEmitter(), Notification: { isSupported: () => false }, shell: { beep() {} }, ipcMain: { handle: (key: string, fn: Function) => handlers.set(key, fn), on: (key: string, fn: Function) => handlers.set(key, fn) } };
  const dependencies: Record<string, unknown> = {
    electron, './island-store': { IslandStore },
    './island-quotas': { NewApiQuotas: class { read() { return []; } refresh() { return Promise.resolve([]); } stop() {} } },
    './agent-hooks': { AgentHooks: class { messages = new AgentMessageStore(dir); poll() { return { changed: false, alerts: [] }; } } },
    './island-fullscreen': { watchFullscreen: () => () => {} }, './island-file-icons': {}, './agent-message-store': {}, './agent-projects': {},
    './welink-sync': { WelinkSync }, './welink-cli': { welinkAuthStatus: async () => ({ authenticated: true }) },
    './welink-message-reminders': { WelinkMessageReminders }, '../shared/welink-reminders': { WelinkReminderSettingsSchema },
  };
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/desktop-island.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => dependencies[name] ?? require(name), module, module.exports);
  const owner = new module.exports.DesktopIsland('http://localhost', '/unused/preload.cjs', dir, () => main, { all: () => [], transaction: (run: () => unknown) => run(), unclaim() {} });
  owner.register(); owner.show();
  const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, ...args);
  const hold = (value: boolean) => { const sender = owner.window.webContents; handlers.get('island:hold')!({ sender, senderFrame: sender.mainFrame }, value); };
  t.after(() => { owner.destroy(); rmSync(dir, { recursive: true, force: true }); });
  return { owner, invoke, hold, sent };
}

test('automatic WeLink failures stay out of island errors and a zero-change background recovery updates the workbench', async t => {
  let fail = false, checks = 0;
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/welink-sync.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => name === './welink-cli' ? { runWelink: async ([kind]: string[]) => {
    if (kind === 'auth') {
      checks++;
      if (fail) throw new Error('连接超时');
      return 'User Token: valid\nUID: z00123456';
    }
    if (kind === 'calendar') return '[]';
    return JSON.stringify({ code: 200, data: { data: [] } });
  } } : require(name), module, module.exports);
  const f = fixture(t, module.exports.WelinkSync);
  f.owner.bindSettings(() => ({ ...DEFAULT_APP_SETTINGS, welink: { enabled: true, pollMinutes: 10 } }));
  await f.invoke('island:welinkRefresh');
  f.sent.length = 0; fail = true; checks = 0;
  await f.invoke('island:welinkRefresh');
  assert.equal(f.owner.state().error, undefined);
  assert.equal((await f.invoke('island:welinkStatus')).sync.error, '连接超时');
  assert.ok(f.sent.some(event => event.channel === 'island:welinkSyncChanged' && (event.args[0] as any).error === '连接超时'));
  assert.equal(checks, 1);
  t.mock.timers.tick(20000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1);
  fail = false; t.mock.timers.tick(10001); f.owner.tick();
  const result = await f.invoke('island:welinkRefresh');
  assert.deepEqual(result, { added: 0, updated: 0, removed: 0 });
  assert.equal(f.owner.state().error, undefined);
  const status = (await f.invoke('island:welinkStatus')).sync;
  assert.equal(status.error, ''); assert.equal(status.lastSuccessAt, Date.now());
  assert.equal(f.sent.filter(event => event.channel === 'todo:changed').length, 0);
  assert.ok(f.sent.some(event => event.channel === 'island:welinkSyncChanged' && (event.args[0] as any).lastSuccessAt === Date.now()));
});

for (const kind of ['water', 'sedentary'] as const) test(`${kind} stays visible after hover, pointer leave and blur until handled`, t => {
  const f = fixture(t);
  f.invoke('island:patch', { waterEnabled: true, sedentaryEnabled: true });
  f.owner.notify([{ id: kind, kind, title: '健康提醒', createdAt: Date.now() }]);
  f.hold(true); t.mock.timers.tick(9000); f.hold(false);
  t.mock.timers.tick(300000); assert.equal(f.owner.state().mode, 'speech');
  f.owner.window.emit('blur'); assert.equal(f.owner.state().mode, 'speech');
  f.invoke(`island:${kind}`, kind === 'water' ? 'drink' : 'reset');
  assert.equal(f.owner.state().mode, 'collapsed');
  assert.equal(f.owner.state().reminders.length, 0);
});

for (const kind of ['task', 'meeting', 'agent'] as const) test(`${kind} expires at eight seconds without deleting reminders or marking AI read`, t => {
  const f = fixture(t);
  const message = kind === 'agent' ? f.owner.agents.messages.ingest({ provider: 'codeai', sessionId: 'bubble-session', turnId: 'reply-1', kind: 'reply', occurredAt: Date.now() }) : null;
  const id = message ? `agent:${message.id}` : kind;
  f.owner.notify([{ id, kind, title: '本轮提醒', createdAt: Date.now() }]);
  t.mock.timers.tick(7999); assert.equal(f.owner.state().mode, 'speech');
  t.mock.timers.tick(1); assert.equal(f.owner.state().mode, 'collapsed');
  assert.ok(f.owner.state().reminders.some((value: any) => value.id === id));
  if (message) assert.equal(f.owner.state().agentMessages[0].readAt, null);
});

test('transient notifications return to pending health reminders and handling advances the queue', t => {
  const f = fixture(t);
  f.invoke('island:patch', { waterEnabled: true, sedentaryEnabled: true });
  f.owner.notify([{ id: 'water', kind: 'water', title: '喝水', createdAt: Date.now() }, { id: 'activity', kind: 'sedentary', title: '活动', createdAt: Date.now() }]);
  const meeting = { ...newTask('会议提醒'), kind: 'meeting', id: 'meeting', remindAt: new Date().toISOString() };
  f.owner.remindTasks([meeting]); t.mock.timers.tick(1000);
  f.invoke('island:dismiss', f.owner.state().reminders.find((r: any) => r.kind === 'meeting').id);
  t.mock.timers.tick(8000); assert.equal(f.owner.state().bubbleReminderId, 'water');
  f.owner.notify([{ id: 'reply', kind: 'agent', title: '新回复', createdAt: Date.now() }]);
  assert.equal(f.owner.state().bubbleReminderId, 'reply');
  t.mock.timers.tick(8000); assert.equal(f.owner.state().bubbleReminderId, 'water');
  f.invoke('island:water', 'drink'); assert.equal(f.owner.state().bubbleReminderId, 'activity');
  t.mock.timers.tick(300000); assert.equal(f.owner.state().mode, 'speech');
  f.invoke('island:sedentary', 'snooze'); assert.equal(f.owner.state().mode, 'collapsed');
  assert.ok(f.owner.state().reminders.some((r: any) => r.id === 'reply'));
});

test('hover restarts eight idle seconds and opening the messages panel cancels bubble expiry', t => {
  const f = fixture(t);
  f.owner.notify([{ id: 'meeting', kind: 'meeting', title: '会议', createdAt: Date.now() }]);
  f.hold(true); t.mock.timers.tick(30000); assert.equal(f.owner.state().mode, 'speech');
  f.hold(false); t.mock.timers.tick(7999); assert.equal(f.owner.state().mode, 'speech');
  t.mock.timers.tick(1); assert.equal(f.owner.state().mode, 'collapsed');
  f.owner.notify([{ id: 'reply', kind: 'agent', title: '新回复', createdAt: Date.now() }]);
  f.owner.setMode('messages', true); t.mock.timers.tick(30000);
  assert.equal(f.owner.state().mode, 'messages');
});

test('ordinary reminder cards use the same health persistence and eight-second transient timing', t => {
  const f = fixture(t); f.invoke('island:patch', { mascotEnabled: false, waterEnabled: true });
  f.owner.notify([{ id: 'water', kind: 'water', title: '喝水', createdAt: Date.now() }]);
  t.mock.timers.tick(300000); assert.equal(f.owner.state().mode, 'reminder');
  f.invoke('island:water', 'drink');
  f.owner.notify([{ id: 'meeting', kind: 'meeting', title: '会议', createdAt: Date.now() }]);
  t.mock.timers.tick(8000); assert.equal(f.owner.state().mode, 'collapsed');
});

test('an updated AI notification can present the same message again after its earlier bubble expired', t => {
  const f = fixture(t), event = { provider: 'codeai', sessionId: 'updated-bubble', turnId: 'reply-1', kind: 'reply', occurredAt: Date.now() };
  const first = f.owner.agents.messages.ingest(event), id = `agent:${first.id}`;
  f.owner.notify([{ id, kind: 'agent', title: first.title, createdAt: Date.now() }]);
  t.mock.timers.tick(8000); assert.equal(f.owner.state().mode, 'collapsed');
  const updated = f.owner.agents.messages.ingest({ ...event, kind: 'failed', title: '本轮运行失败', occurredAt: Date.now() });
  f.owner.notify([{ id, kind: 'agent', title: updated.title, createdAt: Date.now() }]);
  assert.equal(f.owner.state().mode, 'speech'); assert.equal(f.owner.state().bubbleReminderId, id);
  assert.equal(f.owner.state().agentMessages[0].readAt, null);
  t.mock.timers.tick(8000); assert.equal(f.owner.state().mode, 'collapsed');
});

test('deferring an AI bubble preserves unread state without scheduling another popup', t => {
  const f = fixture(t);
  const message = f.owner.agents.messages.ingest({ provider: 'codeai', sessionId: 'deferred-bubble', turnId: 'reply-1', kind: 'reply', occurredAt: Date.now() });
  const id = `agent:${message.id}`;
  f.owner.notify([{ id, kind: 'agent', title: message.title, createdAt: Date.now() }]);
  f.invoke('island:dismiss', id);
  t.mock.timers.tick(600000);
  assert.equal(f.owner.state().mode, 'collapsed');
  assert.equal(f.owner.state().reminders.some((reminder: any) => reminder.id === id), false);
  assert.equal(f.owner.state().agentMessages[0].readAt, null);
});
