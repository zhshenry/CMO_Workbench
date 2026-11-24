/**
 * 内置浏览器:主进程持有 guest 的附加审批与固定隔离策略。
 * 逐行移植自 DSH apps/desktop/src/browser-guests.ts(webview 租约模式),仅改名与中文注释。
 */
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, session, type Session, type WebContents } from 'electron';
import {
  type BrowserLeaseId, type BrowserOpenRequest, type BrowserReservation, type SsoState,
} from '../shared/browser-contracts';
import { HUAWEI_SSO_ORIGIN, isHuaweiSsoUrl } from './browser/sso';

/**
 * 注入 SSO 登录页的凭据填充脚本:仅填值,不自动提交(可能遇到扫码/二次验证)。
 * 凭据经模板字符串占位注入,脚本内不出现明文之外的通道。
 */
const ssoFillScript = (uid: string, password: string): string => `(() => {
  const uid = ${JSON.stringify(uid)};
  const password = ${JSON.stringify(password)};
  const fill = () => {
    if (location.origin !== ${JSON.stringify(HUAWEI_SSO_ORIGIN)} || self !== top) return true;
    const user = document.getElementById('username');
    const pass = document.querySelector('input[type="password"]');
    if (!user || !pass) return false;
    const set = (el, value) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };
    set(user, uid);
    set(pass, password);
    return true;
  };
  if (fill()) return true;
  let tries = 0;
  const timer = setInterval(() => { if (fill() || ++tries > 15) clearInterval(timer); }, 400);
  return false;
})()`;

interface GuestLease {
  readonly owner: WebContents;
  readonly partition: string;
  readonly workspace: string;
  readonly tabId: string;
  active: boolean;
  attached: boolean;
  guest?: WebContents;
}

/** 存储分区按 workspace 确定性命名(persist: 前缀落盘):同一 workspace 的标签共享登录态,重启保留。 */
export class BrowserGuests {
  private readonly partitions = new Map<string, string>();
  private readonly leases = new Map<BrowserLeaseId, GuestLease>();
  private navigationObserver?: (workspace: string, url: string, title: string, tabId: string) => void;
  private popupObserver?: (owner: WebContents, parentTabId: string) => string | undefined;
  /** 由 main 注入:读取设置里保存的 W3 凭据(供 SSO 页填充;无保存返回 null)。 */
  private ssoCredentials: (() => { uid: string; password: string } | null) | undefined;
  /** 每个登录文档尝试填充一次。 */
  private readonly ssoFilled = new WeakSet<WebContents>();
  /** 同一 workspace 的 SSO 状态去重:仅在变化时通知渲染层。 */
  private readonly ssoStates = new Map<string, SsoState>();
  observeNavigation(listener: (workspace: string, url: string, title: string, tabId: string) => void): void { this.navigationObserver = listener; }
  observePopup(listener: (owner: WebContents, parentTabId: string) => string | undefined): void { this.popupObserver = listener; }

  setSsoCredentialsProvider(fn: () => { uid: string; password: string } | null): void {
    this.ssoCredentials = fn;
  }

  /** @param hostUrl - 应用自身地址(开发服务器);guest 不允许请求它。 */
  constructor(private readonly hostUrl: () => string | undefined) {}

  /**
   * 在 workspace 的进程级分区里预留一个 guest。
   * @param owner - 主应用文档的 WebContents(IPC 发起方)。
   * @param workspace - 经 IPC 到达的存储身份。
   * @returns 不透明租约与批准给它的分区。
   */
  acquire(owner: WebContents, workspace: unknown, tabId?: unknown): BrowserReservation {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('内置浏览器:缺少 workspace 存储标识');
    }
    if (tabId !== undefined && (typeof tabId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tabId))) throw new Error('内置浏览器:无效标签标识');
    if (tabId && [...this.leases.values()].some(item => item.owner === owner && item.tabId === tabId)) throw new Error('内置浏览器:标签已经存在');
    const partition = this.partitionFor(workspace), lease = randomUUID();
    this.leases.set(lease, { owner, partition, workspace, tabId: typeof tabId === 'string' ? tabId : lease, active: false, attached: false });
    return { lease, partition };
  }

  partitionFor(workspace: string): string {
    let partition = this.partitions.get(workspace);
    if (partition === undefined) {
      // 确定性持久分区:同 workspace 重启后仍拿回同一存储(cookie/登录态保留)。
      // 仅保留安全字符,避免 workspace 拼接出路径歧义。
      const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
      partition = `persist:wb-browser-${safe}`;
      this.configureSession(session.fromPartition(partition), workspace);
      this.partitions.set(workspace, partition);
    }
    return partition;
  }

  /** Only the issuing host can resolve a tab to its live guest. Never exposed over IPC. */
  resolve(owner: WebContents, tabId: string): GuestLease & { guest: WebContents } {
    const lease = [...this.leases.values()].find(item => item.owner === owner && item.tabId === tabId);
    if (!lease?.guest || lease.guest.isDestroyed()) throw new Error('浏览器标签尚未就绪或已关闭，请重新打开页面。');
    return lease as GuestLease & { guest: WebContents };
  }

  tabs(owner: WebContents, workspace: string) {
    return [...this.leases.values()].filter(item => item.owner === owner && item.workspace === workspace).map(item => ({
      id: item.tabId, workspace: item.workspace, url: item.guest?.isDestroyed() === false ? item.guest.getURL() : '',
      title: item.guest?.isDestroyed() === false ? item.guest.getTitle() : '', ready: !!item.guest && !item.guest.isDestroyed(), active: item.active,
    }));
  }

  activate(owner: WebContents, tabId: string, workspace?: string): void {
    const current = [...this.leases.values()].find(lease => lease.owner === owner && lease.tabId === tabId);
    if (current && workspace && current.workspace !== workspace) throw new Error('内置浏览器:标签不属于此分区');
    for (const lease of this.leases.values()) if (lease.owner === owner && lease.workspace === (current?.workspace ?? workspace)) lease.active = lease.tabId === tabId;
  }

  async closeTab(owner: WebContents, tabId: string): Promise<void> {
    const entry = [...this.leases].find(([, lease]) => lease.owner === owner && lease.tabId === tabId);
    if (entry) await this.release(owner, entry[0]);
  }

  canNavigate(url: string, workspace: string): boolean { return this.allowedNavigation(url, workspace); }

  /** guest 进入/离开 SSO 登录页时同步渲染层状态;进入且有凭据时注入填充脚本(每轮一次)。 */
  private trackSso(lease: GuestLease, url: string): void {
    const { workspace, guest } = lease;
    if (!isHuaweiSsoUrl(url)) {
      if (guest) this.ssoFilled.delete(guest);
      if (this.ssoStates.has(workspace)) this.clearSso(workspace);
      return;
    }
    const creds = this.ssoCredentials?.() ?? null;
    const hasCredentials = creds != null;
    if (creds && guest && !this.ssoFilled.has(guest)) {
      this.ssoFilled.add(guest);
      void guest.executeJavaScript(ssoFillScript(creds.uid, creds.password)).catch(() => {});
    }
    const next: SsoState = { active: true, hasCredentials };
    const prev = this.ssoStates.get(workspace);
    if (prev?.active === next.active && prev.hasCredentials === next.hasCredentials) return;
    this.ssoStates.set(workspace, next);
    if (!lease.owner.isDestroyed()) lease.owner.send('browser:sso-state', { workspace, ...next });
  }

  private clearSso(workspace: string): void {
    if (!this.ssoStates.delete(workspace)) return;
    for (const lease of this.leases.values()) {
      if (lease.workspace === workspace && !lease.owner.isDestroyed()) {
        lease.owner.send('browser:sso-state', { workspace, active: false, hasCredentials: false });
      }
    }
  }

  /**
   * 仅释放签发给该窗口的租约;workspace 存储(cookie/存储)保留。
   * @param owner - IPC 发起方。
   * @param id - 经 IPC 到达的租约。
   */
  async release(owner: WebContents, id: unknown): Promise<void> {
    if (typeof id !== 'string') throw new Error('内置浏览器:无效租约');
    const lease = this.leases.get(id);
    if (lease === undefined) return;
    if (lease.owner !== owner) throw new Error('内置浏览器:租约属于其它窗口');
    this.leases.delete(id);
    const guest = lease.guest;
    if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) => {
        guest.once('destroyed', resolve);
      });
      guest.close({ waitForBeforeUnload: false });
      await destroyed;
    }
  }

  /**
   * 在应用文档能创建 webview 之前安装附加检查。
   * @param window - 主应用窗口。
   */
  bind(window: BrowserWindow): void {
    const owner = window.webContents;
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id =
        typeof params.src === 'string' && params.src.startsWith('about:blank#')
          ? params.src.slice('about:blank#'.length)
          : '';
      const lease = this.leases.get(id);
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault();
        return;
      }
      lease.attached = true;
      // 保留 Electron 的 allowpopups 派发位;guest 侧的 setWindowOpenHandler 仍会拒绝原生窗口。
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key);
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        navigateOnDragDrop: false,
        disableDialogs: true,
        backgroundThrottling: false,
        devTools: !app.isPackaged,
      });
      params.httpreferrer = '';
    });
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease: BrowserLeaseId | undefined;
      // 首个文档是携带租约的惰性 about:blank。
      // 在主进程事件上绑定(先于渲染层能导航就绪的 guest)再验一次租约。
      guest.once('dom-ready', () => {
        const url = guest.getURL();
        const id = url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : '';
        const lease = this.leases.get(id);
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false });
          return;
        }
        lease.guest = guest;
        attachedLease = id;
        guest.once('destroyed', () => {
          this.leases.delete(id);
        });
        guest.on('did-navigate', (_event, target) => this.navigationObserver?.(lease.workspace, target, guest.getTitle(), lease.tabId));
        guest.on('page-title-updated', (_event, title) => this.navigationObserver?.(lease.workspace, guest.getURL(), title, lease.tabId));
        const ssoSync = (url: string): void => this.trackSso(lease, url);
        guest.on('did-navigate', (_event, url) => { this.ssoFilled.delete(guest); ssoSync(url); });
        guest.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) ssoSync(url); });
        guest.on('did-stop-loading', () => ssoSync(guest.getURL()));
        guest.once('destroyed', () => this.clearSso(lease.workspace));
      });
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease);
        if (
          attachedLease !== undefined &&
          lease?.guest === guest &&
          lease.owner === owner &&
          !owner.isDestroyed() &&
          postBody === undefined &&
          this.allowedNavigation(url, lease.workspace)
        ) {
          const request: BrowserOpenRequest = { lease: attachedLease, url: new URL(url).href, tabId: this.popupObserver?.(owner, lease.tabId) };
          owner.send('browser:open-requested', request);
        }
        return { action: 'deny' };
      });
      guest.on('will-frame-navigate', (event) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease);
        if (event.isMainFrame && !this.allowedNavigation(event.url, lease?.workspace)) event.preventDefault();
      });
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease);
        if (mainFrame && !this.allowedNavigation(url, lease?.workspace)) event.preventDefault();
      });
      guest.on('will-attach-webview', (event) => {
        event.preventDefault();
      });
      guest.on('login', (event, _details, _authInfo, callback) => {
        event.preventDefault();
        callback();
      });
    });
    const releaseAll = (): void => {
      for (const [id, lease] of this.leases) {
        if (lease.owner === owner) {
          void this.release(owner, id).catch((error: unknown) => {
            console.error(error);
          });
        }
      }
    };
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll();
    });
    owner.on('render-process-gone', releaseAll);
    owner.once('destroyed', releaseAll);
  }

  /** 会话级封锁:权限/下载/非 http(s) 请求与带凭据 URL 一律拒绝。 */
  private configureSession(browserSession: Session, _workspace: string): void {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setDevicePermissionHandler(() => false);
    browserSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({});
    });
    browserSession.on('will-download', (event) => {
      event.preventDefault();
    });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
      callback({
        cancel: network
          ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
          : !['about:', 'data:', 'blob:'].includes(url.protocol),
      });
    });
  }

  /** 导航白名单:仅无内嵌凭据的 http/https,且拒绝应用自身地址。 */
  private allowedNavigation(value: string, _workspace?: string): boolean {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.username === '' &&
      url.password === '' &&
      !this.isApplicationHost(url)
    );
  }

  private isApplicationHost(url: URL): boolean {
    const value = this.hostUrl();
    if (value === undefined) return false;
    const host = new URL(value);
    return (
      url.port === host.port &&
      (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  }
}
