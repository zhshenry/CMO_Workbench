import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';

function fixture(state: 'hidden' | 'minimized' | 'visible', available: 'live' | 'missing' | 'destroyed' = 'live') {
  const window = (name: string) => ({ name, visible: false, minimized: false, destroyed: false, focused: false, restores: 0,
    isMinimized() { return this.minimized; }, isDestroyed() { return this.destroyed; },
    restore() { this.restores++; this.minimized = false; }, show() { this.visible = true; }, focus() { this.focused = true; } });
  const main = window('workbench'), assistant = window('assistant'), island = window('island');
  main.visible = state !== 'hidden'; main.minimized = state === 'minimized'; main.destroyed = available === 'destroyed';
  class Tray extends EventEmitter {
    menu: { label?: string; click?: () => void }[] = [];
    setToolTip() {} setContextMenu(menu: Tray['menu']) { this.menu = menu; }
  }
  const source = readFileSync('electron/main.ts', 'utf8');
  const start = source.indexOf('  const createTray = async');
  const end = source.indexOf("\n  app.on('will-quit'", start);
  assert.ok(start > 0 && end > start, 'production tray entry must exist');
  const code = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code;
  const scope = { tray: null as Tray | null, mainWindow: available === 'missing' ? null : main,
    BrowserWindow: { getAllWindows: () => [assistant, island, main] }, Tray,
    Menu: { buildFromTemplate: (menu: Tray['menu']) => menu }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    join, dirname, __dirname: '/unused/dist-electron', TODO_DB: '/unused/tasks.db', floatTodoFactory: undefined, shell: {}, app: {} };
  const create = new Function('scope', `with (scope) { ${code}; return createTray; }`)(scope);
  return { main, assistant, island, scope, create };
}

for (const entry of ['menu', 'double-click'] as const) {
  for (const state of ['hidden', 'minimized', 'visible'] as const) {
    test(`tray ${entry} opens the ${state} workbench when the assistant is first in the window list`, async () => {
      const f = fixture(state); await f.create();
      if (entry === 'menu') f.scope.tray!.menu.find(item => item.label === '打开工作台')!.click!();
      else f.scope.tray!.emit('double-click');
      assert.equal(f.main.visible, true); assert.equal(f.main.focused, true); assert.equal(f.main.minimized, false);
      assert.equal(f.main.restores, state === 'minimized' ? 1 : 0);
      for (const other of [f.assistant, f.island]) { assert.equal(other.visible, false); assert.equal(other.focused, false); }
    });
  }
  for (const available of ['missing', 'destroyed'] as const) {
    test(`tray ${entry} ignores a ${available} workbench without opening a different window`, async () => {
      const f = fixture('hidden', available); await f.create();
      assert.doesNotThrow(() => {
        if (entry === 'menu') f.scope.tray!.menu.find(item => item.label === '打开工作台')!.click!();
        else f.scope.tray!.emit('double-click');
      });
      for (const window of [f.main, f.assistant, f.island]) { assert.equal(window.visible, false); assert.equal(window.focused, false); }
    });
  }
}
