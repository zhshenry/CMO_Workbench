import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, powerMonitor, screen, shell, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { Store } from '../modules/todo/store';
import type { Task } from '../shared/todo-contracts';
import { inTimeRange, islandAssistantBounds, islandBounds, ISLAND_MOTION_MS, type IslandMode, type IslandNavigation, type IslandReminder, type IslandState } from '../shared/island-contracts';
import { IslandStore } from './island-store';
import { NewApiQuotas } from './island-quotas';
import { watchFullscreen } from './island-fullscreen';
import { readIslandFileIcons } from './island-file-icons';
import { AgentHooks } from './agent-hooks';
import { agentMessageHint } from './agent-message-store';
import { discoverCodeaiProjects } from './agent-projects';
import { WelinkSync } from './welink-sync';
import { welinkAuthStatus, welinkLogin, runWelink, type WelinkLoginEvent } from './welink-cli';
import type { AppSettings } from '../shared/contracts';

// Floating can lose Windows topmost status when reordered behind a non-topmost taskbar.
const ISLAND_TOPMOST_LEVEL = process.platform === 'win32' ? 'pop-up-menu' : 'floating';

export class DesktopIsland {
  private win: BrowserWindow | null = null;
  readonly store: IslandStore;
  private quotas: NewApiQuotas;
  private agents: AgentHooks;
  private mode: IslandMode = 'collapsed';
  private pinned = false;
  private held = false;
  private locked = false;
  private suspended = false;
  private resumeSequence = 0;
  private assistantWindow: BrowserWindow | null = null;
  private assistantPinned = true;
  private assistantReady = false;
  private assistantOpening = false;
  private assistantRequest = 0;
  private fullscreen = false;
  private fullscreenDetection = false;
  private motion: NodeJS.Timeout | null = null;
  private shape: Rectangle | null = null;
  private speechHeight = 132;
  private reminderTimer: NodeJS.Timeout | null = null;
  // Expiry ends bubble presentation without deleting reminders or marking AI messages read.
  private expiredBubbleIds = new Set<string>();
  private timer: NodeJS.Timeout;
  private stopFullscreen: () => void;
  private lastQuotaRead = 0;
  private lastWelinkRead = 0;
  private welinkSync: WelinkSync;
  private welinkLoginCancel: (() => void) | null = null;
  private settingsReader: () => AppSettings | null = () => null;
  private error = '';
  private icons: Promise<Record<string, string>> | null = null;
  constructor(private devUrl: string | undefined, private preload: string, dir: string, private main: () => BrowserWindow | null, private todo: Store) {
    this.store = new IslandStore(dir);
    this.quotas = new NewApiQuotas(dir, () => { this.publish(); });
    this.agents = new AgentHooks(dir);
    this.welinkSync = new WelinkSync(todo, Date.now, status => {
      const win = this.main();
      if (win && !win.isDestroyed()) win.webContents.send('island:welinkSyncChanged', status);
    });
    screen.on('display-added', this.displaysChanged); screen.on('display-removed', this.displaysChanged); screen.on('display-metrics-changed', this.displaysChanged);
    powerMonitor.on('lock-screen', this.lock); powerMonitor.on('unlock-screen', this.unlock);
    powerMonitor.on('suspend', this.suspend); powerMonitor.on('resume', this.resume);
    this.stopFullscreen = watchFullscreen(value => {
      const changed = !this.fullscreenDetection || this.fullscreen !== value;
      this.fullscreenDetection = true; this.fullscreen = value;
      if (changed) this.visibility();
    }, () => { this.fullscreenDetection = false; this.publish(); });
    this.timer = setInterval(this.tick, 1000); this.timer.unref();
    try { this.store.restartSedentary(); } catch { this.error = '久坐提醒恢复失败，请检查数据目录权限'; }
  }
  get window(): BrowserWindow | null { return this.win; }
  isVisible(): boolean { return this.store.read().settings.enabled; }
  /** 注入应用设置读取器(main.ts 实例化后调),供 WeLink 轮询读 enabled/pollMinutes。 */
  bindSettings(reader: () => AppSettings | null): void { this.settingsReader = reader; }
  private welinkEnabled(): boolean { return this.settingsReader()?.welink.enabled === true; }
  private welinkIntervalMs(): number { return (this.settingsReader()?.welink.pollMinutes ?? 10) * 60 * 1000; }
  private quiet(): boolean { const s = this.store.read().settings; return this.locked || this.suspended || inTimeRange(new Date(), s.dndStart, s.dndEnd) && s.dnd; }
  private bubbleReminder(reminders: IslandReminder[]): IslandReminder | undefined { return reminders.find(reminder => !this.expiredBubbleIds.has(reminder.id)); }
  state(): IslandState {
    const data = this.store.read();
    return { ...data, bubbleReminderId: this.bubbleReminder(data.reminders)?.id, files: this.store.files(), agentMessages: this.agents.messages.read(), mode: this.mode, pinned: this.pinned, quiet: this.quiet(), fullscreenDetection: this.fullscreenDetection, resumeSequence: this.resumeSequence, error: this.store.loadError || this.agents.messages.loadError || this.error || undefined };
  }
  private async fileIcon(id: string): Promise<string> {
    this.store.file(id);
    const icons = await (this.icons ??= readIslandFileIcons(this.store.files()).catch(error => { this.icons = null; throw error; }));
    return icons[id] || '';
  }
  private publish = (): void => {
    const state = this.state();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win !== this.win && win !== this.main() && win !== this.assistantWindow) continue;
      win.webContents.send('island:changed', state);
      win.webContents.send('float:visibility-changed', state.settings.enabled);
    }
  };
  private lock = (): void => { this.locked = true; this.tick(); this.visibility(); };
  private unlock = (): void => { this.locked = false; this.resumeSequence++; this.mode = this.pinned ? 'expanded' : 'collapsed'; this.reposition(); this.visibility(); this.tick(); };
  private suspend = (): void => { this.suspended = true; this.tick(); this.visibility(); };
  private resume = (): void => { this.suspended = false; this.resumeSequence++; this.tick(); this.visibility(); };
  private visibility(): void {
    const s = this.store.read().settings;
    if (s.enabled && !this.locked && !this.suspended && !(s.hideFullscreen && this.fullscreen)) {
      this.win?.showInactive();
      this.win?.setAlwaysOnTop(true, ISLAND_TOPMOST_LEVEL);
    }
    else this.win?.hide();
    this.publish();
  }
  showOrHide(): void {
    if (this.isVisible()) { this.store.patch({ enabled: false }); this.pinned = false; this.mode = 'collapsed'; this.visibility(); }
    else this.show();
  }
  show(): void {
    this.store.patch({ enabled: true });
    if (!this.win) this.create();
    this.reposition(); this.visibility();
  }
  private create(): void {
    this.win = new BrowserWindow({ ...this.bounds('expanded'), frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false, title: '桌面灵动岛', hasShadow: false, webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    this.win.setAlwaysOnTop(true, ISLAND_TOPMOST_LEVEL);
    this.win.once('ready-to-show', () => this.visibility());
    this.win.on('blur', () => { if (!this.pinned && !this.held && this.mode !== 'speech' && this.mode !== 'reminder') this.setMode('collapsed'); });
    this.win.on('close', event => { event.preventDefault(); this.store.patch({ enabled: false }); this.pinned = false; this.mode = 'collapsed'; this.visibility(); });
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', event => event.preventDefault());
    if (this.devUrl) void this.win.loadURL(`${this.devUrl}?window=float`);
    else void this.win.loadFile(join(this.preload, '../../dist/index.html'), { query: { window: 'float' } });
  }
  private assistant(action: 'show' | 'hide' | 'pin' | 'state' | 'ready') {
    const status = () => ({ pinned: this.assistantPinned, visible: !!this.assistantWindow?.isVisible() && this.assistantWindow.getOpacity() > 0 });
    if (action === 'show') {
      if (this.assistantOpening) return status();
      this.assistantOpening = true;
      this.assistantRequest++;
      if (!this.pinned) { this.held = false; this.setMode('collapsed', true); }
      const settings = this.store.read().settings;
      const area = (screen.getAllDisplays().find(display => display.id === settings.displayId) ?? screen.getPrimaryDisplay()).workArea;
      const bounds = islandAssistantBounds(this.bounds(), area, settings.dock);
      if (!this.assistantWindow) {
        this.assistantReady = false;
        const win = new BrowserWindow({ ...bounds, minWidth: Math.min(280, bounds.width), minHeight: Math.min(320, bounds.height),
          frame: false, transparent: true, resizable: true, maximizable: false, fullscreenable: false, skipTaskbar: true,
          show: false, title: '待办助手', webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
        this.assistantWindow = win;
        win.setAlwaysOnTop(this.assistantPinned, ISLAND_TOPMOST_LEVEL);
        win.on('close', event => { event.preventDefault(); this.assistantOpening = false; this.assistantRequest++; win.hide(); });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', event => event.preventDefault());
        if (this.devUrl) void win.loadURL(`${this.devUrl}?window=island-assistant`);
        else void win.loadFile(join(this.preload, '../../dist/index.html'), { query: { window: 'island-assistant' } });
      } else {
        const win = this.assistantWindow, current = win.getBounds();
        if (!win.isVisible() && (['x', 'y', 'width', 'height'] as const).some(key => current[key] !== bounds[key])) win.setBounds(bounds);
      }
      if (this.assistantReady) this.assistantWindow.webContents.send('island:assistant-open');
    } else if (action === 'hide') { this.assistantOpening = false; this.assistantRequest++; this.assistantWindow?.hide(); }
    else if (action === 'ready') {
      this.assistantReady = true;
      const win = this.assistantWindow;
      if (win && this.assistantOpening) {
        const request = this.assistantRequest;
        const show = () => {
          if (this.assistantOpening && request === this.assistantRequest && this.assistantWindow === win && !win.isDestroyed()) {
            this.assistantOpening = false;
            win.setAlwaysOnTop(this.assistantPinned, ISLAND_TOPMOST_LEVEL);
            if (win.getOpacity() < 1) win.setOpacity(1);
            win.focus();
          }
          return status();
        };
        if (win.isVisible() && win.getOpacity() > 0) return show();
        // Warm the compositor without exposing its old surface, including after resize.
        win.setOpacity(0);
        win.showInactive();
        win.webContents.setBackgroundThrottling(false);
        win.webContents.invalidate();
        return win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          .then(() => win.webContents.capturePage(undefined, { stayHidden: true })).then(show).finally(() => {
            if (!win.isDestroyed() && (request === this.assistantRequest || !this.assistantOpening)) {
              if (this.assistantOpening) { this.assistantOpening = false; win.hide(); }
              if (win.getOpacity() < 1) win.setOpacity(1);
              win.webContents.setBackgroundThrottling(true);
            }
          });
      }
    } else if (action === 'pin') {
      this.assistantPinned = !this.assistantPinned;
      this.assistantWindow?.setAlwaysOnTop(this.assistantPinned, ISLAND_TOPMOST_LEVEL);
    }
    return status();
  }
  private bounds(mode: IslandMode = this.mode) {
    const s = this.store.read().settings;
    const display = screen.getAllDisplays().find(d => d.id === s.displayId) ?? screen.getPrimaryDisplay();
    return islandBounds(mode, display.workArea, s.topOffset, s.dock);
  }
  private frameBounds(): Rectangle { return this.bounds(this.mode === 'messages' ? 'messages' : 'expanded'); }
  private shapeBounds(): Rectangle {
    const frame = this.frameBounds(), bounds = this.bounds();
    return { x: bounds.x - frame.x, y: bounds.y - frame.y, width: bounds.width, height: bounds.height };
  }
  private applyShape(shape: Rectangle): void {
    this.shape = shape;
    if (this.mode !== 'speech' && this.mode !== 'messages') { this.win?.setShape([shape]); return; }
    const frame = this.frameBounds(), bar = this.bounds('collapsed'), bounds = this.shapeBounds();
    const summary = { x: bar.x - frame.x, y: bar.y - frame.y, width: bar.width, height: bar.height };
    const dock = this.store.read().settings.dock;
    const messages = this.mode === 'messages';
    const width = Math.min(messages ? 432 : 224, bounds.width - (dock === 'top' ? 24 : summary.width + 24));
    const height = messages ? bounds.height - (dock === 'top' ? summary.height + 24 : 24) : this.speechHeight;
    const bubble = dock === 'top'
      ? { x: bounds.x + 12, y: summary.y + summary.height, width, height: Math.min(height + 12, bounds.height - summary.height) }
      : { x: dock === 'left' ? summary.x + summary.width : summary.x - width - 12, y: bounds.y + 12, width: width + 12, height: Math.min(height, bounds.height - 12) };
    this.win?.setShape([summary, bubble]);
  }
  private reposition = (): void => {
    if (this.motion) clearTimeout(this.motion); this.motion = null;
    this.win?.setBounds(this.frameBounds()); this.applyShape(this.shapeBounds());
  };
  private displaysChanged = (): void => { this.reposition(); this.publish(); };
  setMode(mode: IslandMode, reduce = false): void {
    if (this.pinned && mode !== 'expanded' && mode !== 'messages') return;
    const frame = this.frameBounds();
    this.mode = mode;
    if (mode !== 'speech' && mode !== 'reminder' && this.reminderTimer) { clearTimeout(this.reminderTimer); this.reminderTimer = null; }
    const win = this.win;
    if (this.motion) clearTimeout(this.motion);
    this.motion = null;
    if (!win || win.isDestroyed()) return;
    const nextFrame = this.frameBounds();
    if (frame.width !== nextFrame.width || frame.height !== nextFrame.height) { this.reposition(); this.publish(); return; }
    const to = this.shapeBounds(), from = this.shape ?? to;
    if (reduce || this.store.read().settings.reducedMotion || this.quiet()) this.applyShape(to);
    else {
      // Keep Chromium's surface stable; the native region also lets clicks pass through outside it.
      const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
      const width = Math.max(from.x + from.width, to.x + to.width) - x, height = Math.max(from.y + from.height, to.y + to.height) - y;
      this.applyShape({ x, y, width, height });
      if (width !== to.width || height !== to.height) this.motion = setTimeout(() => {
        this.motion = null;
        if (!win.isDestroyed()) this.applyShape(to);
      }, ISLAND_MOTION_MS[mode] + 50);
    }
    this.publish();
  }
  private tick = (): void => {
    try {
      const incoming = this.agents.poll();
      if (incoming.error && this.error !== incoming.error) { this.error = incoming.error; this.publish(); }
      if (incoming.changed) {
        const messages = this.agents.messages.read();
        // 已读/已消失的 agent 提醒要从 reminder 队列清掉,避免幽灵徽标。
        for (const reminder of this.store.read().reminders) {
          if (reminder.kind !== 'agent') continue;
          const message = messages.find(value => `agent:${value.id}` === reminder.id);
          if (!message || message.readAt !== null) this.store.dismiss(reminder.id);
        }
        const alerts = incoming.alerts.filter(message => message.readAt === null);
        if (alerts.length) this.notify(alerts.map(message => ({ id: `agent:${message.id}`, kind: 'agent', title: message.title, createdAt: Date.now() })));
        else { this.armReminderTimer(); this.publish(); }
      }
    } catch { this.error = 'CodeAI 消息保存失败，待收取的事件已保留，请检查数据目录权限'; this.publish(); }
    try {
      const before = this.store.read(), alerts = this.store.tick(this.quiet());
      if (alerts.length) this.notify(alerts);
      else if (JSON.stringify(before) !== JSON.stringify(this.store.read())) { this.armReminderTimer(); this.publish(); }
      const interval = this.mode === 'expanded' && before.settings.lastPage === 'quota' && this.win?.isVisible() ? 60000 : 300000;
      if (Date.now() - this.lastQuotaRead >= interval) { this.lastQuotaRead = Date.now(); void this.quotas.refresh(); }
      if (this.welinkEnabled() && Date.now() - this.lastWelinkRead >= this.welinkIntervalMs()) {
        this.lastWelinkRead = Date.now();
        void this.welinkSync.refresh().then(result => {
          if (!result.error && (result.added || result.updated || result.removed)) {
            // 写了 tasks.db,广播 todo:changed 让主窗/岛刷新日程
            for (const win of BrowserWindow.getAllWindows()) win.webContents.send('todo:changed');
            this.publish();
          }
        });
      }
    } catch { this.error = '灵动岛状态保存失败，请检查数据目录权限'; this.win?.webContents.send('island:error', this.error); }
  };
  private notify(alerts: IslandReminder[], failed?: () => void): void {
    for (const alert of alerts) this.expiredBubbleIds.delete(alert.id);
    this.store.enqueue(alerts); this.publish();
    if (this.quiet() || this.fullscreen && this.store.read().settings.hideFullscreen) return;
    if (this.win?.isVisible()) {
      if (this.store.read().settings.sound) shell.beep();
      if (this.mode === 'collapsed' && !this.held) { this.setMode(this.store.read().settings.mascotEnabled ? 'speech' : 'reminder'); this.armReminderTimer(); }
      else if (this.mode === 'speech' || this.mode === 'reminder') this.armReminderTimer();
      return;
    }
    const systemAlerts = alerts.filter(alert => alert.kind !== 'water' && alert.kind !== 'sedentary' && alert.kind !== 'agent');
    if (systemAlerts.length && Notification.isSupported()) {
      const notification = new Notification({ title: systemAlerts.length > 1 ? `${systemAlerts.length} 条提醒` : systemAlerts[0].title, body: '点击在工作台中查看', silent: !this.store.read().settings.sound });
      if (failed) notification.once('failed', failed);
      notification.on('click', () => this.navigate({ view: 'home', taskId: systemAlerts[0].taskId })); notification.show();
    }
  }
  private armReminderTimer(): void {
    if (this.reminderTimer) clearTimeout(this.reminderTimer);
    this.reminderTimer = null;
    if (this.mode !== 'reminder' && this.mode !== 'speech') return;
    const reminders = this.store.read().reminders;
    for (const id of this.expiredBubbleIds) if (!reminders.some(reminder => reminder.id === id)) this.expiredBubbleIds.delete(id);
    const reminder = this.bubbleReminder(reminders);
    if (!reminder) { this.setMode('collapsed'); return; }
    if (reminder.kind === 'water' || reminder.kind === 'sedentary') return;
    this.reminderTimer = setTimeout(() => {
      this.reminderTimer = null;
      if (this.mode !== 'reminder' && this.mode !== 'speech') return;
      if (!this.held) this.expiredBubbleIds.add(reminder.id);
      this.armReminderTimer(); this.publish();
    }, 8000);
  }
  remindTasks(tasks: Task[]): boolean {
    if (this.store.loadError) return false;
    const s = this.store.read().settings;
    const accepted = tasks.filter(t => t.kind === 'meeting' ? s.scheduleReminders : s.todoReminders);
    for (const task of tasks) if (!accepted.includes(task)) this.todo.unclaim(task);
    if (accepted.length) this.notify(accepted.map(task => ({ id: `${task.id}:${task.remindAt}`, kind: task.kind, title: task.title, taskId: task.id, createdAt: Date.now() })), () => { for (const task of accepted) this.todo.unclaim(task); });
    return true;
  }
  navigate(target: IslandNavigation): void {
    const win = this.main(); if (!win) return;
    if (win.isMinimized()) win.restore(); win.show(); win.focus();
    win.webContents.send('island:navigate', target);
  }
  register(): void {
    const guard = (event: IpcMainInvokeEvent, assistant = false): void => {
      const senders = [this.main()?.webContents, this.win?.webContents, ...(assistant ? [this.assistantWindow?.webContents] : [])];
      if (!senders.includes(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('仅工作台窗口可使用桌面灵动岛');
    };
    const handle = (name: string, action: (...args: any[]) => unknown, assistant = false) => ipcMain.handle(name, (event, ...args) => { guard(event, assistant); return action(...args); });
    handle('float:toggle', () => { this.showOrHide(); return this.isVisible(); });
    handle('float:show', () => this.show());
    ipcMain.on('float:subscribe', event => { if ([this.main()?.webContents, this.win?.webContents].includes(event.sender)) event.sender.send('float:visibility-changed', this.isVisible()); });
    handle('island:state', () => this.state(), true);
    handle('island:assistant', action => this.assistant(z.enum(['show', 'hide', 'pin', 'state', 'ready']).parse(action)), true);
    handle('island:patch', input => {
      const previousDock = this.store.read().settings.dock;
      this.store.patch(z.record(z.string(), z.unknown()).parse(input));
      if (this.mode === 'speech' && !this.store.read().settings.mascotEnabled) this.mode = 'reminder';
      if (!this.isVisible()) { this.pinned = false; this.mode = 'collapsed'; this.held = false; }
      if (this.isVisible() && !this.win) this.create();
      this.reposition();
      if (this.win && previousDock !== this.store.read().settings.dock) {
        // Moving the native window can miss mouseleave; reconcile the real pointer position.
        const { x, y } = screen.getCursorScreenPoint(), bounds = this.bounds();
        this.held = x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
        if (!this.pinned && !this.held && this.mode === 'expanded') this.setMode('collapsed');
      }
      this.armReminderTimer(); this.visibility(); return this.state();
    });
    handle('island:mode', (mode, reduce) => { this.setMode(z.enum(['collapsed', 'expanded', 'reminder', 'speech', 'messages']).parse(mode), reduce === true); });
    handle('island:pin', () => { this.pinned = !this.pinned; if (this.pinned) this.setMode('expanded'); else this.publish(); return this.state(); });
    ipcMain.on('island:hold', (event, held) => {
      if (event.sender !== this.win?.webContents || event.senderFrame !== event.sender.mainFrame) return;
      const wasHeld = this.held; this.held = held === true;
      if (wasHeld && !this.held && (this.mode === 'speech' || this.mode === 'reminder')) this.armReminderTimer();
    });
    ipcMain.on('island:speechHeight', (event, height) => {
      if (event.sender !== this.win?.webContents || event.senderFrame !== event.sender.mainFrame || this.mode !== 'speech' || !Number.isFinite(height)) return;
      const value = Math.max(1, Math.min(this.store.read().settings.dock === 'top' ? 132 : 160, Math.ceil(height)));
      if (this.speechHeight === value) return;
      this.speechHeight = value; this.applyShape(this.shapeBounds());
    });
    handle('island:navigate', target => this.navigate(z.object({ view: z.enum(['home', 'todo', 'settings-island', 'settings-general', 'settings-ai']), taskId: z.string().optional(), section: z.enum(['quota', 'water', 'sedentary', 'agents']).optional() }).parse(target)), true);
    handle('island:displays', () => screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `${d.label || `显示器 ${i + 1}`} · ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' · 主屏' : ''}` })));
    const changed = () => {
      this.armReminderTimer();
      this.publish(); return this.state();
    };
    handle('island:filesAdd', async (paths, directory) => {
      let selected = paths;
      if (!selected) { const result = await dialog.showOpenDialog({ title: '添加到文件暂存', properties: [directory === true ? 'openDirectory' : 'openFile', 'multiSelections'] }); selected = result.filePaths; }
      this.store.addFiles(selected); this.icons = null; return changed();
    });
    handle('island:filesRemove', id => { if (id !== undefined) z.string().parse(id); this.store.removeFiles(id); this.icons = null; return changed(); });
    const noteChanged = (action: () => unknown) => {
      try { action(); return changed(); }
      catch (error) { if (error instanceof Error && 'code' in error) throw new Error('文字记录更新失败，请检查数据目录权限后重试'); throw error; }
    };
    handle('island:noteDraft', draft => noteChanged(() => this.store.setNoteDraft(draft)));
    handle('island:noteSave', (text, id) => noteChanged(() => this.store.saveNote(text, id === undefined ? undefined : z.string().parse(id))));
    handle('island:noteRemove', id => noteChanged(() => this.store.removeNote(z.string().parse(id))));
    handle('island:fileIcon', id => this.fileIcon(z.string().parse(id)));
    handle('island:fileOpen', async id => { const error = await shell.openPath(this.store.file(z.string().parse(id))); if (error) throw new Error('无法打开文件，文件可能已移动或不存在'); });
    handle('island:fileRelocate', async id => { this.store.file(z.string().parse(id)); const file = this.store.read().files.find(f => f.id === id)!; const result = await dialog.showOpenDialog({ title: '重新定位文件', properties: [file.directory ? 'openDirectory' : 'openFile'] }); if (result.filePaths[0]) this.store.relocate(id, result.filePaths[0]); this.icons = null; return changed(); });
    ipcMain.on('island:fileDrag', async (event, id) => {
      if (event.sender !== this.win?.webContents || event.senderFrame !== event.sender.mainFrame) return;
      try { const file = this.store.file(z.string().parse(id)); const data = await this.fileIcon(id).catch(() => ''); const icon = data ? nativeImage.createFromDataURL(data) : await app.getFileIcon(file, { size: 'large' }); event.sender.startDrag({ file, icon }); }
      catch { event.sender.send('island:error', '无法拖出文件，请检查原文件是否仍存在'); }
      this.held = false;
    });
    handle('island:focus', (action, minutes, taskId) => {
      if (taskId && !this.todo.all().some(t => t.id === taskId && !t.deletedAt)) throw new Error('关联事项已不存在');
      this.store.focus(z.enum(['start', 'pause', 'resume', 'stop']).parse(action), minutes, taskId); return changed();
    });
    handle('island:water', action => { this.store.water(z.enum(['drink', 'snooze', 'pause']).parse(action)); return changed(); });
    handle('island:sedentary', action => { this.store.sedentary(z.enum(['reset', 'snooze', 'pause']).parse(action)); return changed(); });
    handle('island:dismiss', id => { this.store.dismiss(z.string().parse(id)); return changed(); });
    handle('island:quotas', () => this.quotas.read());
    handle('island:quotaRefresh', () => this.quotas.refresh());
    handle('island:quotaConnect', (label, baseUrl, username, password) => this.quotas.connect(z.string().min(1).parse(label), z.string().min(1).parse(baseUrl), z.string().min(1).parse(username), z.string().min(1).parse(password)));
    handle('island:quotaUpdate', (id, label, baseUrl, username, password) => this.quotas.update(z.string().min(1).parse(id), z.string().min(1).parse(label), z.string().min(1).parse(baseUrl), z.string().min(1).parse(username), z.string().parse(password)));
    handle('island:quotaRemove', id => this.quotas.remove(z.string().min(1).parse(id)));
    handle('island:quotaSelect', id => { void this.quotas.select(z.string().min(1).parse(id)); });
    handle('island:quotaOfficial', id => this.quotas.openOfficial(z.string().min(1).parse(id)));
    handle('island:agentProjects', async () => {
      const enabled = this.agents.listEnabled();
      return { discovered: await discoverCodeaiProjects(homedir(), enabled), enabled };
    }, false);
    handle('island:agentConnect', projects => this.agents.setEnabled(z.array(z.string()).parse(projects)), false);
    handle('island:welinkStatus', async () => {
      const auth = await welinkAuthStatus();
      return { authenticated: auth.authenticated, uid: auth.uid, reason: auth.reason, enabled: this.welinkEnabled(), sync: this.welinkSync.status() };
    }, false);
    handle('island:welinkLogin', () => {
      if (this.welinkLoginCancel) return;
      this.welinkLoginCancel = welinkLogin((event: WelinkLoginEvent) => {
        for (const win of [this.main(), this.win]) {
          if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('island:welinkLoginEvent', event);
        }
        if (event.done) this.welinkLoginCancel = null;
      });
    }, false);
    handle('island:welinkCancelLogin', () => { this.welinkLoginCancel?.(); this.welinkLoginCancel = null; }, false);
    handle('island:welinkLogout', async () => { try { await runWelink(['auth', 'logout'], 10000); } catch { /* 已登出或失败,忽略 */ } }, false);
    handle('island:welinkRefresh', async () => {
      const result = await this.welinkSync.refresh();
      if (result.added || result.updated || result.removed) for (const win of BrowserWindow.getAllWindows()) win.webContents.send('todo:changed');
      return result;
    }, false);
    const agentRead = (id: string) => { this.agents.messages.markRead(id); this.store.dismiss(`agent:${id}`); return changed(); };
    handle('island:agentRead', id => agentRead(z.string().parse(id)), true);
    handle('island:agentReadAll', input => {
      const targets = z.array(z.object({ id: z.string(), updatedAt: z.number() }).strict()).parse(input);
      const marked = this.agents.messages.markReadAll(targets);
      for (const id of marked) this.store.dismiss(`agent:${id}`);
      return changed();
    }, true);
    handle('island:agentOpen', async id => {
      const message = this.agents.messages.get(z.string().parse(id));
      clipboard.writeText(message.sessionId);
      const hint = agentMessageHint(message);
      const state = await agentRead(message.id);
      return { state, hint };
    }, true);
  }
  destroy(): void {
    clearInterval(this.timer); if (this.motion) clearTimeout(this.motion); if (this.reminderTimer) clearTimeout(this.reminderTimer);
    this.stopFullscreen(); this.quotas.stop();
    screen.off('display-added', this.displaysChanged); screen.off('display-removed', this.displaysChanged); screen.off('display-metrics-changed', this.displaysChanged);
    powerMonitor.off('lock-screen', this.lock); powerMonitor.off('unlock-screen', this.unlock); powerMonitor.off('suspend', this.suspend); powerMonitor.off('resume', this.resume);
    if (this.store.read().settings.clearFilesOnExit) { try { this.store.removeFiles(); } catch { /* Preserve references if saving fails. */ } }
    this.assistantWindow?.destroy(); this.assistantWindow = null;
    this.win?.destroy(); this.win = null;
  }
}
