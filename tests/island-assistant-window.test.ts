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

const require = createRequire(import.meta.url);
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-assistant-window-')), windows: Window[] = [], handlers = new Map<string, Function>();
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  class Window extends EventEmitter {
    visible = false; opacity = 1; focused = false; shows = 0; positions = 0; destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {}, send() {}, setWindowOpenHandler() {}, invalidate() {}, backgroundThrottling: true,
      setBackgroundThrottling(value: boolean) { this.backgroundThrottling = value; },
      executeJavaScript: async () => undefined, capturePage: async (): Promise<unknown> => ({}),
    });
    constructor(public bounds: any) { super(); windows.push(this); }
    static getAllWindows() { return windows; }
    setAlwaysOnTop() {} setShape() {} loadURL() {} loadFile() {}
    setBounds(value: any) { this.positions++; this.bounds = value; } getBounds() { return this.bounds; }
    showInactive() { this.shows++; this.visible = true; } show() { this.showInactive(); }
    hide() { this.visible = false; } focus() { this.focused = true; }
    setOpacity(value: number) { this.opacity = value; } getOpacity() { return this.opacity; }
    isVisible() { return this.visible; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const main = new Window({});
  const electron = {
    BrowserWindow: Window, powerMonitor: new EventEmitter(), Notification: { isSupported: () => false },
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) }),
    ipcMain: { handle: (key: string, fn: Function) => handlers.set(key, fn), on: (key: string, fn: Function) => handlers.set(key, fn) },
  };
  const dependencies: Record<string, unknown> = {
    electron, './island-store': { IslandStore },
    './island-quotas': { NewApiQuotas: class { read() { return []; } stop() {} } },
    './agent-hooks': { AgentHooks: class { messages = new AgentMessageStore(dir); } },
    './island-fullscreen': { watchFullscreen: () => () => {} }, './island-file-icons': {}, './agent-message-store': {}, './agent-projects': {},
    './welink-sync': { WelinkSync: class {} }, './welink-cli': {},
  };
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/desktop-island.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((name: string) => dependencies[name] ?? require(name), module, module.exports);
  const owner = new module.exports.DesktopIsland('http://localhost', '/unused/preload.cjs', dir, () => main, { all: () => [], unclaim() {} });
  owner.register();
  const invoke = (action: string) => handlers.get('island:assistant')!({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, action);
  t.after(() => { owner.destroy(); rmSync(dir, { recursive: true, force: true }); });
  return { invoke, windows };
}

test('assistant waits for its prepared frame and reuses the window without repeated show or resize', async t => {
  const f = fixture(t);
  f.invoke('show'); const win = f.windows.at(-1)!;
  f.invoke('show'); win.emit('ready-to-show');
  assert.equal(f.windows.length, 2); assert.equal(win.visible, false);
  let paint!: () => void;
  win.webContents.capturePage = async (_rect?: unknown, options?: unknown) => {
    assert.equal(win.opacity, 0); assert.equal(win.webContents.backgroundThrottling, false);
    assert.deepEqual(options, { stayHidden: true }); await new Promise<void>(resolve => { paint = resolve; });
  };
  const ready = f.invoke('ready'); await Promise.resolve();
  assert.equal(f.invoke('state').visible, false); assert.equal(win.focused, false);
  paint(); await ready;
  assert.equal(f.invoke('state').visible, true); assert.equal(win.focused, true); assert.equal(win.shows, 1);
  win.bounds = { ...win.bounds, x: 100, width: 500 };
  f.invoke('show'); await f.invoke('ready');
  assert.equal(win.shows, 1); assert.equal(win.positions, 0); assert.equal(win.bounds.width, 500);
  win.emit('close', { preventDefault() {} }); assert.equal(win.visible, false); assert.equal(win.destroyed, false);
  win.webContents.capturePage = async () => ({});
  f.invoke('show'); await f.invoke('ready');
  assert.equal(f.windows.length, 2); assert.equal(win.shows, 2); assert.equal(f.invoke('state').visible, true);
});

test('cancelled assistant preparation cannot expose a later opening before its own frame is ready', async t => {
  const f = fixture(t); f.invoke('show'); const win = f.windows.at(-1)!;
  const paints: (() => void)[] = [];
  win.webContents.capturePage = () => new Promise<void>(resolve => paints.push(resolve));
  const oldReady = f.invoke('ready'); await Promise.resolve();
  f.invoke('hide'); assert.equal(win.visible, false);
  f.invoke('show'); const newReady = f.invoke('ready'); await Promise.resolve();
  paints[0](); await oldReady;
  assert.equal(win.opacity, 0); assert.equal(f.invoke('state').visible, false); assert.equal(win.focused, false);
  paints[1](); await newReady;
  assert.equal(f.invoke('state').visible, true); assert.equal(win.webContents.backgroundThrottling, true);
  f.invoke('hide'); const shows = win.shows;
  await f.invoke('ready'); assert.equal(win.visible, false); assert.equal(win.shows, shows);
});

test('failed frame preparation stays hidden and a later opening can retry', async t => {
  const f = fixture(t); f.invoke('show'); const win = f.windows.at(-1)!;
  win.webContents.capturePage = async () => { throw new Error('paint unavailable'); };
  await assert.rejects(f.invoke('ready'), /paint unavailable/);
  assert.equal(win.visible, false); assert.equal(win.opacity, 1); assert.equal(win.webContents.backgroundThrottling, true);
  win.webContents.capturePage = async () => ({});
  f.invoke('show'); await f.invoke('ready'); assert.equal(f.invoke('state').visible, true);
});
