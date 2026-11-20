import { createHash } from 'node:crypto';
import { BrowserWindow, ipcMain, session } from 'electron';
import { z } from 'zod';
import type { Store } from '../modules/todo/store';
import { newTask } from '../shared/todo-contracts';
import type { BrowserGuests } from './browser-guests';
import { OfficePortal, W3_PORTAL, w3PortalLink } from './office-portal';

export function registerOfficePortal(directory: string, main: () => BrowserWindow | null, account: () => string, guests: BrowserGuests, todo: Store) {
  const partition = (owner: string) => guests.partitionFor('w3-office-' + createHash('sha256').update(owner).digest('hex').slice(0, 32));
  const portal = new OfficePortal(directory, {
    account,
    get: (owner, path, signal) => session.fromPartition(partition(owner)).fetch(new URL(path, W3_PORTAL).href, {
      method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include', redirect: 'manual', referrer: W3_PORTAL, signal,
    }),
    linkedTasks: () => new Set(todo.all().filter(item => !item.deletedAt).map(item => item.id)),
  });
  const uuid = z.string().uuid();
  let window: BrowserWindow | undefined, windowOwner = '';
  const methods = {
    state: () => portal.state(),
    refresh: () => portal.refresh(),
    open: async (input: unknown) => {
      const owner = portal.owner(), parent = main();
      if (!owner || !parent) throw new Error('请先在设置中维护 W3 账号。');
      const url = input === undefined ? W3_PORTAL : w3PortalLink(portal.item(uuid.parse(input)).url);
      if (!url) throw new Error('该事项没有可打开的门户链接。');
      if (window && windowOwner !== owner) window.destroy();
      if (!window || window.isDestroyed()) {
        const child = new BrowserWindow({ parent, width: 1024, height: 720, autoHideMenuBar: true, title: 'W3 门户',
          webPreferences: { partition: partition(owner), nodeIntegration: false, contextIsolation: true, sandbox: true } });
        window = child;
        windowOwner = owner;
        child.once('closed', () => { if (window === child) window = undefined; });
        child.webContents.on('will-navigate', (event, target) => { if (!w3PortalLink(target)) event.preventDefault(); });
        child.webContents.on('will-redirect', (event, target) => { if (!w3PortalLink(target)) event.preventDefault(); });
        child.webContents.setWindowOpenHandler(({ url: target }) => {
          const link = w3PortalLink(target);
          if (link) void child.loadURL(link).catch(() => {});
          return { action: 'deny' };
        });
      }
      window.focus();
      try { await window.loadURL(url); }
      catch { throw new Error('未能打开 W3 门户页面。请确认公司网络后重试。'); }
    },
    createTodo: (input: unknown) => {
      const item = portal.item(uuid.parse(input)), existing = todo.all(true).find(task => task.id === item.id);
      if (existing?.deletedAt) throw new Error('关联待办已删除，可在全部事项中恢复。');
      if (!existing) {
        const now = new Date().toISOString();
        const note = ['来源：W3 门户 · ' + item.system, item.progress, item.person, item.time].filter(Boolean).join('\n');
        todo.put({ ...newTask(item.title.slice(0, 200)), note, id: item.id, createdAt: now, updatedAt: now, deletedAt: null, completedAt: null, notifiedFor: null });
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('todo:changed');
      }
      return item.id;
    },
  };
  for (const [name, run] of Object.entries(methods)) ipcMain.handle('office-portal:' + name, (event, input: unknown) => {
    const host = main()?.webContents;
    if (!host || event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('请在 CMO 主窗口使用 W3 门户。');
    return run(input);
  });
}
