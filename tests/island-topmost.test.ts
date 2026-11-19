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

const require = createRequire(new URL('../electron/desktop-island.ts', import.meta.url));
function fixture(t: TestContext, platform: NodeJS.Platform = 'win32') {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-island-topmost-')), windows: Window[] = [];
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  let fullscreen!: (value: boolean) => void;
  class Window extends EventEmitter {
    visible = false; topmost = false; focuses = 0; levels: string[] = [];
    webContents = { send() {}, setWindowOpenHandler() {}, on() {} };
    constructor(public bounds: any) { super(); windows.push(this); }
    static getAllWindows() { return windows; }
    setAlwaysOnTop(flag: boolean, level = 'floating') {
      // Model a non-topmost Windows taskbar: placing the island behind it demotes it.
      const behindTaskbar = ['floating', 'torn-off-menu', 'modal-panel', 'main-menu', 'status'].includes(level);
      this.topmost = flag && (platform !== 'win32' || !behindTaskbar);
      this.levels.push(level);
    }
    setShape() {} loadURL() {} loadFile() {}
    setBounds(value: any) { this.bounds = value; } getBounds() { return this.bounds; }
    showInactive() { this.visible = true; } hide() { this.visible = false; }
    focus() { this.focuses++; }
    isVisible() { return this.visible; } isDestroyed() { return false; } destroy() {}
  }
  const electron = {
    BrowserWindow: Window, powerMonitor: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [display], getPrimaryDisplay: () => display }),
    Notification: { isSupported: () => false },
  };
  const dependencies: Record<string, unknown> = {
    electron, './island-store': { IslandStore },
    './island-quotas': { NewApiQuotas: class { read() { return []; } stop() {} } },
    './agent-hooks': { AgentHooks: class { messages = new AgentMessageStore(dir); } },
    './island-fullscreen': { watchFullscreen: (callback: typeof fullscreen) => { fullscreen = callback; return () => {}; } },
    './island-file-icons': {}, './agent-message-store': {}, './agent-projects': {},
    './welink-sync': { WelinkSync: class {} }, './welink-cli': {},
  };
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('electron/desktop-island.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', 'process', code)((name: string) => dependencies[name] ?? require(name), module, module.exports, { platform });
  const owner = new module.exports.DesktopIsland('http://localhost', '/unused/preload.cjs', dir, () => null, { all: () => [] });
  t.after(() => { owner.destroy(); rmSync(dir, { recursive: true, force: true }); });
  return { owner, windows, power: electron.powerMonitor, fullscreen: (value: boolean) => fullscreen(value) };
}

test('Windows taskbar ordering cannot demote the island when it is shown or reshown', t => {
  const f = fixture(t); f.owner.show(); const win = f.windows[0];
  assert.equal(win.visible, true); assert.equal(win.topmost, true); assert.equal(win.focuses, 0);
  f.owner.setMode('expanded', true); assert.equal(win.topmost, true);
  f.owner.showOrHide(); assert.equal(win.visible, false);
  win.topmost = false;
  f.owner.show(); assert.equal(win.visible, true); assert.equal(win.topmost, true); assert.equal(win.focuses, 0);
});

test('topmost behavior still honors fullscreen hiding and the enabled setting', t => {
  const f = fixture(t); f.owner.store.patch({ hideFullscreen: true }); f.owner.show(); const win = f.windows[0];
  f.fullscreen(true); assert.equal(win.visible, false);
  f.fullscreen(false); assert.equal(win.visible, true); assert.equal(win.topmost, true);
  f.owner.showOrHide(); f.fullscreen(true); f.fullscreen(false); assert.equal(win.visible, false);
});

test('resume and unlock publish a fresh calendar return signal even during quiet hours', t => {
  const f = fixture(t); f.owner.store.patch({ dnd: true, dndStart: '00:00', dndEnd: '00:00' }); f.owner.show();
  assert.equal(f.owner.state().quiet, true);
  const initial = f.owner.state().resumeSequence;
  assert.equal(initial, 0);
  f.power.emit('suspend'); f.power.emit('resume');
  assert.equal(f.owner.state().resumeSequence, initial + 1);
  f.power.emit('lock-screen'); f.power.emit('unlock-screen');
  assert.equal(f.owner.state().resumeSequence, initial + 2);
  assert.equal(f.owner.state().quiet, true);
  assert.equal('resumeSequence' in f.owner.store.read(), false, 'return signals are runtime state');
});

for (const platform of ['darwin', 'linux'] as const) test(`${platform} keeps its existing floating-window behavior`, t => {
  const f = fixture(t, platform); f.owner.show();
  assert.equal(f.windows[0].topmost, true); assert.equal(f.windows[0].focuses, 0);
  assert.ok(f.windows[0].levels.every(level => level === 'floating'));
});
