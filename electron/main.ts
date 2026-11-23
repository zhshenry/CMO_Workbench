import type { TodoState } from '../shared/workbench-api';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, powerMonitor, shell, Tray, nativeImage, safeStorage } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';
import { AppUpdates, updateNotesUrl } from './updater';
import { Store } from '../modules/todo/store';
import { ReadingStore } from '../modules/reading/store';
import { aggregateBook, scanBooks } from '../modules/reading/obsidian';
import { BrowserGuests } from './browser-guests';
import { BrowserAutomation } from './browser/tasks';
import { BrowserStore } from './browser/store';
import { registerBrowserAutomationIpc } from './browser/ipc';
import { BotGateway } from './bot-gateway';
import { waitForMainEncryption } from './bot-encryption';
import { SpeechService } from './speech';
import { registerSpeechIpc } from './speech-ipc';
import { registerMeetingIpc } from './meeting-ipc';
import { registerRoomBookingIpc } from './room-booking-ipc';
import { DesktopIsland } from './desktop-island';
import { readIslandReminderSettings } from './island-store';
import { inReminderQuietHours, taskReminderEnabled } from '../shared/island-contracts';

type FloatFactory = () => DesktopIsland;
import { AppSettingsStore } from './app-settings';
import { registerDashboardIpc } from './dashboard-ipc';
import { AuthStore } from './auth';
import { OfficeConverter, OFFICE_CONVERT_OPTIONS } from './office-convert';
import { registerPdfAssetHandler, registerPdfAssetScheme } from './pdf-assets';
import type { OfficeConvertErrorCode, OfficeConvertResult } from '../shared/office-contracts';
import { OfficeWorkbench } from './office-workbench';
import { registerOfficePortal } from './office-portal-ipc';
import { officeArchiveSelectionSchema, officeAutomationSchema, officeDay, officeIdSchema, officeSearchSchema } from '../shared/office-workbench';
import { meetingContentQuerySchema } from '../shared/weclaw-content';
import { enableWelinkRenewal, onWelinkAuthChanged, onWelinkRecovery, runWelink, welinkAuthStatus, welinkEmployeeNumber } from './welink-cli';
import type { WelinkAuthState } from './welink-auth';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/contracts';
import { WelinkReminderSettingsSchema } from '../shared/welink-reminders';

const SMOKE = process.env.WORKBENCH_SMOKE === '1';
const DEV_URL = process.env.WORKBENCH_DEV_URL ?? '';

// 自动化验收使用完整隔离的数据根目录，避免触碰真实的待办共享库。
if (process.env.WORKBENCH_TEST_DATA_DIR) {
  mkdirSync(process.env.WORKBENCH_TEST_DATA_DIR, { recursive: true });
  app.setPath('appData', process.env.WORKBENCH_TEST_DATA_DIR);
}

// 自定义资源协议必须在 ready 前注册(PDF.js cMap/标准字体/wasm 本地加载)
registerPdfAssetScheme();

app.setPath('userData', join(app.getPath('appData'), 'CMOWorkbench'));
// WORKBENCH_ISOLATED=1:以独立 userData 启动(截图/测试用,不与正在运行的实例抢单实例锁)
if (process.env.WORKBENCH_ISOLATED === '1') {
  app.setPath('userData', join(app.getPath('userData'), 'isolated'));
}

// OnO 与 CMO 共用工作台的事项库。首次启动从旧路径只读导入。
const TODO_DB = join(app.getPath('appData'), 'OnoCmoWorkbench', 'tasks.db');
const LEGACY_TODO_DB = join(app.getPath('appData'), 'To-Do-List', 'tasks.db');
let store: Store | null = null;
let floatTodoFactory: FloatFactory | null = null;
let botGateway: BotGateway | null = null;
let settingsStore: AppSettingsStore | null = null;
let authStore: AuthStore | null = null;
let speechService: SpeechService | null = null;
let browserGuests: BrowserGuests | null = null;
let browserAutomation: BrowserAutomation | null = null;
let readingStore: ReadingStore | null = null;
let officeConverter: OfficeConverter | null = null;
let tray: Tray | null = null;
let updates: AppUpdates | null = null;
const updateTimers: NodeJS.Timeout[] = [];

let notificationBusy = false;

// 开机自启(设置页可切换;开发态注册的是 electron.exe,打包后为应用本体)
const applyLoginItem = (enabled: boolean): void => {
  if (process.env.WORKBENCH_TEST_DATA_DIR) return;
  try {
    app.setLoginItemSettings({ enabled });
  } catch {
    // 个别环境(便携版/权限受限)注册失败不阻塞启动
  }
};

if (!app.requestSingleInstanceLock()) {
  if (DEV_URL) {
    console.error('开发模式无法启动：已有工作台实例在运行。请从系统托盘退出旧实例后重试，或设置 WORKBENCH_ISOLATED=1 使用独立工作台配置与 AI 会话（待办数据库仍共享）。');
    app.exit(1);
  } else app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const publishProfile = (profile: AppSettings['profile']) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:profileChanged', profile);
  };

  const createWindow = (): void => {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 1024,
      minHeight: 680,
      show: false,
      frame: false,
      backgroundColor: '#e9eaee', // 与 shell.css 默认主题 mist 的 --field-base 一致,避免启动闪色
      title: 'CMO工作台',
      icon: join(__dirname, '../assets/icon.ico'),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        spellcheck: false,
      },
    });

    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('hide', () => speechService?.cancel());
    mainWindow.on('blur', () => speechService?.cancel());
    // 内置浏览器租约:在渲染层有机会创建 webview 前装好附加审批
    browserGuests?.bind(mainWindow);
    if (DEV_URL) {
      void mainWindow.loadURL(DEV_URL);
    } else {
      const index = join(__dirname, '../dist/index.html');
      if (!existsSync(index)) {
        mainWindow.show();
        mainWindow.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent('<h2 style="font-family:sans-serif">尚未构建渲染层:请先运行 npm run build</h2>'),
        );
      } else {
        void mainWindow.loadFile(index);
      }
    }

    // 外壳为无边框自绘窗口:拦截一切外跳与嵌入式导航
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
      if (!allowed) event.preventDefault();
    });

    mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true));
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false));
    mainWindow.on('closed', () => {
      speechService?.cancel();
      mainWindow = null;
    });
  };

  const registerIpc = (): void => {
    ipcMain.handle('win:assistantBackdrop', async event => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('仅工作台主窗口可读取动效画面');
      const image = await event.sender.capturePage();
      return (image.getSize().width > 2048 ? image.resize({ width: 2048 }) : image).toDataURL();
    });
    ipcMain.on('win:minimize', (event) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });
    ipcMain.on('win:maximizeToggle', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    });
    ipcMain.on('win:close', (event) => {
      // 关闭行为由设置决定(默认与 To-Do-List 一致:隐藏到托盘,提醒继续;托盘菜单退出才结束)
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (settingsStore?.read().closeAction === 'exit') {
        app.quit();
      } else {
        win.hide();
      }
    });

    // 应用设置(工作台自有存储;副作用:自启注册即时生效,关闭行为在 win:close 时读取)
    ipcMain.handle('settings:get', () => settingsStore?.read() ?? null);
    ipcMain.handle('settings:patch', (_event, input: unknown) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('设置更新格式不正确');
      }
      const next = settingsStore!.patch(input as Record<string, unknown>);
      if ('profile' in input) publishProfile(next.profile);
      if ('launchAtLogin' in (input as Record<string, unknown>)) {
        applyLoginItem(next.launchAtLogin);
      }
      return next;
    });

    // 认证(默认不强制登录;设置页可选保存 W3 凭据供后续内网功能使用)
    ipcMain.handle('auth:saveCredentials', (_event, credentials: unknown) => {
      if (!authStore) throw new Error('认证服务未初始化');
      if (typeof credentials !== 'object' || credentials === null) throw new Error('登录信息格式不正确');
      const { uid, password } = credentials as { uid?: unknown; password?: unknown };
      if (typeof uid !== 'string' || typeof password !== 'string' || !uid.trim() || !password) {
        throw new Error('请输入 W3 账号和密码');
      }
      authStore.saveCredentials(uid.trim(), password);
    });
    ipcMain.handle('auth:hasCredentials', () => authStore?.hasCredentials() ?? false);
    ipcMain.handle('auth:clearCredentials', () => { authStore?.clearCredentials(); });
    ipcMain.handle('auth:logout', () => { authStore?.clearCredentials(); });

    // 系统剪贴板(便利贴复制用;经主进程,比渲染层 clipboard API 在岛窗失焦时更可靠)
    ipcMain.handle('clipboard:write', (_event, text: unknown) => {
      if (typeof text !== 'string' || [...text].length > 20000) throw new Error('剪贴板内容无效或超长');
      clipboard.writeText(text);
    });

    // 关于页:应用元信息与数据位置(只读)
    ipcMain.handle('app:about', () => ({
      name: 'CMO工作台',
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      userDataPath: app.getPath('userData'),
      todoDbPath: TODO_DB,
    }));
    ipcMain.handle('app:openUserDataDir', () => { void shell.openPath(app.getPath('userData')); });
    ipcMain.handle('app:openTodoDir', () => { void shell.openPath(dirname(TODO_DB)); });
    const assertUpdateSender = (event: Electron.IpcMainInvokeEvent): void => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('仅工作台主窗口可操作应用更新');
      }
    };
    ipcMain.handle('updater:status', event => { assertUpdateSender(event); return updates!.status(); });
    ipcMain.handle('updater:check', event => { assertUpdateSender(event); return updates!.check(); });
    ipcMain.handle('updater:install', event => { assertUpdateSender(event); updates!.install(); });
    ipcMain.handle('updater:notes', event => { assertUpdateSender(event); return shell.openExternal(updateNotesUrl(updates!.status().version)); });

    // 内置浏览器(租约模式;仅主窗口文档可申请)
    const assertMainWindow = (event: Electron.IpcMainInvokeEvent): void => {
      if (!browserGuests || event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('内置浏览器:仅主窗口可使用租约');
      }
    };
    ipcMain.handle('browser:acquire', (event, workspace: unknown, tabId: unknown) => {
      assertMainWindow(event);
      return browserGuests!.acquire(event.sender, workspace, tabId);
    });
    ipcMain.handle('browser:release', (event, lease: unknown) => {
      assertMainWindow(event);
      return browserGuests!.release(event.sender, lease);
    });

    // 文档转 PDF(主进程 LibreOffice;仅主窗口可调用)
    ipcMain.handle('office:convert', (event, filename: unknown, bytes: unknown): Promise<OfficeConvertResult> => {
      if (!officeConverter || event.sender !== mainWindow?.webContents) {
        return Promise.resolve({ ok: false, code: 'unavailable' });
      }
      if (typeof filename !== 'string' || !(bytes instanceof Uint8Array)) {
        return Promise.resolve({ ok: false, code: 'unsupported-format' });
      }
      const suffix = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
      if (suffix !== 'doc' && suffix !== 'docx' && suffix !== 'ppt' && suffix !== 'pptx') {
        return Promise.resolve({ ok: false, code: 'unsupported-format' });
      }
      return officeConverter.convert(bytes as Uint8Array<ArrayBuffer>, suffix).then(
        ({ pdf, missingFonts }) => ({ ok: true as const, pdf, missingFonts }),
        (error: unknown) => ({ ok: false as const, code: OfficeConverter.codeOf(error) as OfficeConvertErrorCode }),
      );
    });

    // 待办共享库状态(设置 → 待办与数据;只读,不写共享库任何表)
    ipcMain.handle('todo:info', () => ({
      path: TODO_DB,
      connected: !!store,
      schemaVersion: store
        ? (store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
        : 0,
      taskCount: store ? store.all().length : 0,
      categoryCount: store ? store.categories().length : 0,
    }));

    // 待办模块(数据层;校验在 Store 内经 Zod 执行,失败以中文错误抛回渲染层)
    if (!store) return;
    const todoState = (): TodoState => ({ tasks: floatTodoFactory ? floatTodoFactory().welinkSync.visibleTasks(store!.all()) : store!.all(), categories: store!.categories() });
    const broadcast = (): void => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('todo:changed');
    };
    ipcMain.handle('todo:state', () => todoState());
    ipcMain.handle('todo:create', (_event, input: unknown) => {
      store!.create(input);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:update', (_event, id: string, patch: unknown, revision: string) => {
      store!.update(id, patch, revision);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:remove', (_event, id: string, revision: string) => {
      store!.remove(id, revision);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:restore', (_event, id: string) => {
      store!.restore(id);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:snooze', (_event, id: string) => {
      store!.snooze(id);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:createCategory', (_event, input: unknown) => {
      store!.createCategory(input);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:updateCategory', (_event, id: string, input: unknown, revision: string) => {
      store!.updateCategory(id, input, revision);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:removeCategory', (_event, id: string, revision: string) => {
      store!.removeCategory(id, revision);
      const next = todoState();
      broadcast();
      return next;
    });
    ipcMain.handle('todo:review', () => store!.review());

    // 阅读清单(书单与 Obsidian 读书库只读关联)
    if (!readingStore) return;
    ipcMain.handle('reading:list', () => readingStore!.all());
    ipcMain.handle('reading:save', (_event, input: unknown) => readingStore!.save(input));
    ipcMain.handle('reading:remove', (_event, id: string) => readingStore!.remove(id));
    ipcMain.handle('reading:setVault', (_event, vaultPath: unknown) => readingStore!.setVaultPath(vaultPath));
    ipcMain.handle('reading:scan', (_event, vaultPath: unknown) => {
      if (typeof vaultPath !== 'string' || !vaultPath) throw new Error('请先填写读书笔记库路径');
      return scanBooks(vaultPath);
    });
    ipcMain.handle('reading:aggregate', (_event, folder: unknown) => {
      const vault = readingStore!.all().vaultPath;
      if (!vault) throw new Error('请先配置读书笔记库路径');
      if (typeof folder !== 'string' || !folder) throw new Error('书文件夹无效');
      return aggregateBook(vault, folder);
    });
    ipcMain.handle('reading:openObsidian', (_event, vault: unknown, rel: unknown) => {
      if (typeof vault !== 'string' || !vault) throw new Error('读书笔记库未配置');
      const file = typeof rel === 'string' && rel ? rel.replace(/\.md$/i, '') : '';
      const url = 'obsidian://open?vault=' + encodeURIComponent(vault) + (file ? '&file=' + encodeURIComponent(file) : '');
      return shell.openExternal(url);
    });
  };

  void app.whenReady().then(async () => {
    try {
      mkdirSync(dirname(TODO_DB), { recursive: true });
      store = new Store(TODO_DB, 'shared-tasks', LEGACY_TODO_DB);
    } catch (error) {
      dialog.showErrorBox('工作台待办库无法打开', error instanceof Error ? error.message : String(error));
      app.quit();
      return;
    }
    readingStore = new ReadingStore(app.getPath('userData'));
    settingsStore = new AppSettingsStore(app.getPath('userData'));
    authStore = new AuthStore(app.getPath('userData'));
    const speechRoot = app.isPackaged ? join(process.resourcesPath, 'speech') : join(app.getAppPath(), 'vendor', 'speech');
    const appUrl = DEV_URL || pathToFileURL(join(__dirname, '../dist/index.html')).href;
    speechService = new SpeechService(speechRoot);
    const meeting = registerMeetingIpc(app.getPath('userData'), speechRoot, () => mainWindow, appUrl, store,
      (prompt, images) => botGateway?.officeModel(prompt, images) ?? Promise.resolve(null), () => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('todo:changed');
      });
    registerSpeechIpc(speechService, () => mainWindow?.webContents, appUrl, meeting.canRequestDisplay);
    const closeRooms = registerRoomBookingIpc(app.getPath('userData'), () => mainWindow);
    app.once('will-quit', () => { meeting.dispose(); closeRooms(); });
    applyLoginItem(settingsStore.read().launchAtLogin);
    browserGuests = new BrowserGuests(() => (DEV_URL || undefined));
    // 内嵌浏览器跳转到 W3 SSO 登录页时,用设置里保存的凭据自动填充(见 browser-guests trackSso)。
    browserGuests.setSsoCredentialsProvider(() => {
      if (!authStore?.hasCredentials()) return null;
      const uid = authStore.getUid();
      const password = authStore.getPassword();
      if (!uid || !password) return null;
      return { uid, password };
    });
    browserAutomation = new BrowserAutomation(browserGuests, new BrowserStore(join(app.getPath('userData'), 'browser-state.json')));
    registerBrowserAutomationIpc(browserAutomation, browserGuests, () => mainWindow?.webContents);
    registerOfficePortal(app.getPath('userData'), () => mainWindow, () => settingsStore?.read().w3Uid ?? '', browserGuests, store);
    officeConverter = new OfficeConverter(OFFICE_CONVERT_OPTIONS);
    registerPdfAssetHandler(app.isPackaged ? join(process.resourcesPath, 'pdfjs') : join(__dirname, '../node_modules/pdfjs-dist'));
    const updateEnabled = app.isPackaged && !SMOKE && !process.env.WORKBENCH_TEST_DATA_DIR && existsSync(join(process.resourcesPath, 'app-update.yml'));
    const unavailableMessage = !app.isPackaged ? '开发模式不检查更新，请安装正式安装版。'
      : SMOKE || process.env.WORKBENCH_TEST_DATA_DIR ? '测试模式不检查自动更新。'
      : '请到 CodeHub Release 页下载新版本安装包覆盖安装。';
    updates = new AppUpdates(updateEnabled ? autoUpdater : null, unavailableMessage, status => {
      mainWindow?.webContents.send('updater:status', status);
      if (status.phase === 'ready' && Notification.isSupported()) {
        const notification = new Notification({ title: `新版本 v${status.version} 已下载`, body: '点击重启并安装。', icon: nativeImage.createFromPath(join(__dirname, '../assets/tray.png')) });
        notification.on('click', () => updates?.install());
        notification.show();
      }
    });
    registerIpc();
    const closeDashboard = registerDashboardIpc(app.getPath('userData'), () => mainWindow?.webContents);
    app.once('will-quit', closeDashboard);
    const floatTodo = new DesktopIsland(DEV_URL || undefined, join(__dirname, 'preload.cjs'), app.getPath('userData'), () => mainWindow, store,
      prompt => botGateway?.officeModel(prompt) ?? Promise.resolve(null));
    floatTodo.bindSettings(() => settingsStore?.read() ?? null);
    // A normal window close only hides the float; application quit must release it.
    app.once('before-quit', () => floatTodo.destroy());
    floatTodoFactory = () => floatTodo;
    floatTodo.register();
    const officeChanged = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('office-workbench:changed'); };
    const officeWorkbench = new OfficeWorkbench(app.getPath('userData'), {
      account: welinkAuthStatus,
      email: () => settingsStore?.read().welinkEmail ?? '',
      messages: floatTodo.welinkMessages,
      messageSettings: () => settingsStore?.read().welinkMessages ?? WelinkReminderSettingsSchema.parse({}),
      tasks: () => store!.all(),
      agenda: uid => floatTodo.welinkSync.statusForAccount(uid),
      run: (args, signal) => runWelink(args, 30000, signal),
      model: prompt => botGateway?.officeModel(prompt) ?? Promise.resolve(null),
      briefModel: (prompt, read) => botGateway?.officeBriefModel(prompt, read) ?? Promise.resolve(null),
      todoLinks: () => botGateway?.officeTodoLinks() ?? Promise.resolve({}),
      remindersChanged: () => { void floatTodo.publishMessageReminders().catch(() => {}); },
      changed: officeChanged,
      notify: notice => floatTodo.notifyOffice('office:' + notice.id, notice.title, notice.at),
    });
    const officeMethods = {
      state: (preserveBrief: unknown) => officeWorkbench.state(preserveBrief === true),
      refresh: () => officeWorkbench.refresh(),
      search: (query: unknown, groupChats: unknown) => officeWorkbench.search(officeSearchSchema.parse(query), groupChats === true),
      conversationMessages: (query: unknown, sourceId?: unknown) => officeWorkbench.conversationMessages(officeSearchSchema.parse(query), officeIdSchema.optional().parse(sourceId)),
      material: (id: unknown, archived: unknown) => officeWorkbench.material(officeIdSchema.parse(id), true, archived === true),
      dismiss: (id: unknown) => officeWorkbench.dismiss(officeIdSchema.parse(id)),
      workflow: () => officeWorkbench.workflow(),
      configure: (input: unknown) => officeWorkbench.configure(officeAutomationSchema.parse(input)),
      brief: (day: unknown) => officeWorkbench.brief(officeDay.optional().parse(day)),
      generateBrief: () => officeWorkbench.generateBrief(),
      archive: () => officeWorkbench.archiveNow(),
      archiveSelection: (query: unknown) => officeWorkbench.archiveSelection(officeArchiveSelectionSchema.parse(query)),
      review: () => officeWorkbench.reviewFollowUps(),
      meetingSource: (input: unknown) => {
        if (typeof input !== 'string' || input.length > 256) throw new Error('日程标识无效。');
        return officeWorkbench.meetingSource(input);
      },
    };
    for (const [method, handler] of Object.entries(officeMethods)) {
      ipcMain.handle('office-workbench:' + method, (event, input: unknown, option: unknown) => {
        if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('请在 CMO 主窗口使用办公助理。');
        return handler(input, option);
      });
    }
    ipcMain.handle('meeting-content:read', (event, query: unknown) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('请在 CMO 主窗口读取会议内容。');
      if (!botGateway) throw new Error('会议内容服务正在启动，请稍后重试。');
      return botGateway.welinkMeetingContent(meetingContentQuerySchema.parse(query));
    });
    const unreadTimer = setInterval(() => {
      void officeWorkbench.refreshUnread().then(changed => {
        if (changed) officeChanged();
      }).catch(error => console.warn('[office mail]', error instanceof Error ? error.message : '邮件缓存未能更新'));
    }, 10 * 60000);
    const recoverOffice = () => officeWorkbench.recoverReads().catch(() => {});
    const stopRecovery = onWelinkRecovery(() => {
      floatTodo.recoverWelinkConnection();
      void recoverOffice().then(officeChanged);
    });
    const backgroundWelink = !SMOKE && !process.env.WORKBENCH_TEST_DATA_DIR;
    const stopRenewal = backgroundWelink ? enableWelinkRenewal() : undefined;
    const seedNickname = async (auth: WelinkAuthState) => {
      const profile = settingsStore?.read().profile;
      if (!backgroundWelink || !auth.authenticated || !auth.uid || !profile ||
          profile.nameSource || profile.name !== DEFAULT_APP_SETTINGS.profile.name) return;
      const number = await welinkEmployeeNumber(auth.uid);
      const next = number && settingsStore?.prefillWelinkNickname(number);
      if (next) publishProfile(next.profile);
    };
    const checkWelink = () => { if (backgroundWelink) void welinkAuthStatus().then(seedNickname).catch(() => {}); };
    const stopAuthChanges = onWelinkAuthChanged(auth => {
      officeChanged();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('island:welinkAuthChanged');
      void seedNickname(auth).catch(() => {});
    });
    const officeTimer = setInterval(() => {
      checkWelink();
      void recoverOffice().then(() => officeWorkbench.tick())
        .catch(error => console.warn('[office jobs]', error instanceof Error ? error.message : '办公整理未完成'));
    }, 60_000);
    app.once('before-quit', () => {
      stopRecovery(); stopAuthChanges(); stopRenewal?.(); clearInterval(unreadTimer); clearInterval(officeTimer);
    });
    app.once('will-quit', () => officeWorkbench.close());
    botGateway = new BotGateway(app.getPath('userData'), TODO_DB, () => mainWindow?.webContents, () => floatTodo.assistantContents(), browserAutomation, officeWorkbench, () => floatTodo.readQuotas());
    try {
      if (process.platform === 'win32') { safeStorage.encryptString('cmo-bot-encryption-init'); await waitForMainEncryption(app.getPath('userData')); }
      await botGateway.start();
    } catch (error) { dialog.showErrorBox('Bot 后台启动失败', error instanceof Error ? error.message : String(error)); app.quit(); return; }
    createWindow();
    checkWelink();
    if (floatTodo.isVisible()) floatTodo.show();
    void createTray();
    startReminders();
    if (updateEnabled) {
      updateTimers.push(setTimeout(() => { void updates?.check(); }, 30000));
      updateTimers.push(setInterval(() => { void updates?.check(); }, 4 * 60 * 60 * 1000));
      updateTimers.forEach(timer => timer.unref());
    }
    if (SMOKE) {
      setTimeout(() => {
        console.log('WORKBENCH_SMOKE_OK');
        app.quit();
      }, 2500);
    }
  });

  // ---------- 提醒轮询（OnO 与 CMO 认领式去重） ----------
  const tick = (): void => {
    if (!store || !settingsStore || notificationBusy) return;
    // 关闭事项提醒时保留到点事项，重新开启后由下一轮处理。
    const { reminderRange } = settingsStore.read();
    if (reminderRange === 'off') return;
    const island = floatTodoFactory?.();
    const reminderSettings = island && !island.store.loadError
      ? island.store.readSettings()
      : readIslandReminderSettings(app.getPath('userData'));
    const now = new Date();
    const tasks = store.claimDue(now, task =>
      taskReminderEnabled(reminderRange, task.kind) && (!island || island.welinkSync.visibleTasks([task]).length > 0));
    if (!tasks.length) return;
    if (island) {
      try { if (island.remindTasks(tasks)) return; }
      catch { /* The existing system notification path remains available if island storage fails. */ }
    }
    if (inReminderQuietHours(reminderSettings, now)) {
      for (const task of tasks) store.unclaim(task);
      return;
    }
    if (!Notification.isSupported()) {
      store.markNotified(tasks);
      return;
    }
    notificationBusy = true;
    const release = (): void => {
      notificationBusy = false;
    };
    const notification = new Notification({
      title: tasks.length === 1 ? tasks[0].title : `${tasks.length} 条事项需要处理`,
      body:
        tasks.length === 1
          ? '到提醒时间了，点击打开工作台处理。'
          : `${tasks.slice(0, 3).map((t) => t.title).join('、')}。点击查看。`,
      icon: nativeImage.createFromPath(join(__dirname, '../assets/tray.png')),
      timeoutType: 'default',
      silent: !reminderSettings.sound,
    });
    notification.once('failed', () => {
      // 认领归还,提醒不丢,下一轮重试
      if (store) for (const task of tasks) store.unclaim(task);
      release();
    });
    notification.once('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    try {
      notification.show();
    } catch {
      if (store) for (const task of tasks) store.unclaim(task);
      release();
    }
    setTimeout(release, 15000).unref();
  };

  const startReminders = (): void => {
    setTimeout(() => tick(), 7000).unref();
    setInterval(tick, 15000);
    powerMonitor.on('resume', () => tick());
  };

  // ---------- 托盘 ----------
  const createTray = async (): Promise<void> => {
    const iconPath = join(__dirname, '../assets/tray.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip('CMO工作台 · 待办提醒运行中');
    const showApp = (): void => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    };
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开工作台', click: showApp },
        { label: '桌面灵动岛', click: () => floatTodoFactory?.().showOrHide() },
        { label: '打开数据目录', click: () => { void shell.openPath(dirname(TODO_DB)); } },
        { type: 'separator' },
        {
          label: '退出(停止提醒)',
          click: () => {
            app.quit();
          },
        },
      ]),
    );
    tray.on('double-click', showApp);
  };

  app.on('will-quit', () => {
    updateTimers.forEach(timer => clearTimeout(timer));
    tray?.destroy();
    tray = null;
    void officeConverter?.dispose();
    officeConverter = null;

    settingsStore = null;
    speechService?.dispose();
    speechService = null;
   authStore = null;
    readingStore?.close();
    readingStore = null;
    store?.close();
    store = null;
  });

  let botQuitting = false;
  app.on('before-quit', event => {
    if (!botQuitting && botGateway) { event.preventDefault(); botQuitting = true; void botGateway.stop().finally(() => app.quit()); }
  });

  app.on('second-instance', (_event, argv) => {
    botGateway?.navigateTask(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
