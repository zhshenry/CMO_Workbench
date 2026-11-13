// 内置浏览器租约契约(主进程 ↔ 渲染层共享)。模式移植自 DSH webview 租约:渲染层不自行创建
// webview,每次先向主进程申请一次性租约,主进程在 will-attach-webview 校验并强制安全配置。

/** 一次性租约 id(主进程签发,仅可用于一次 webview 附加,绑定签发窗口) */
export type BrowserLeaseId = string;

/** 主进程批准的租约与对应存储分区 */
export interface BrowserReservation {
  lease: BrowserLeaseId;
  partition: string;
}

/** guest 内弹窗转交请求(原生窗口一律拒绝,由渲染层自行开新标签/处理) */
export interface BrowserOpenRequest {
  lease: BrowserLeaseId;
  url: string;
  tabId?: string;
}

/** guest 停留在华为 W3 SSO 登录页的状态(active 时渲染层叠加登录提示)。 */
export interface SsoState {
  active: boolean;
  /** 设置 → WeLink 里已保存 W3 凭据(已尝试自动填充)。 */
  hasCredentials: boolean;
}

/** 渲染层可用的租约操作(不暴露 IPC 与 Electron 对象) */
export interface BrowserBridge {
  acquire(workspace: string, tabId?: string): Promise<BrowserReservation>;
  release(lease: BrowserLeaseId): Promise<void>;
  onOpenRequested(lease: BrowserLeaseId, listener: (url: string, tabId?: string) => void): () => void;
  onSsoState(workspace: string, listener: (state: SsoState) => void): () => void;
}

/** 观察到的页面状态(载体中立,UI 直接消费) */
export interface BrowserFrameState {
  target: { url: string; title: string } | undefined;
  address: 'requested' | 'observed';
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  error: { code?: number; description?: string } | undefined;
}

export const emptyBrowserFrame = (): BrowserFrameState => ({
  target: undefined,
  address: 'requested',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoomFactor: 1,
  error: undefined,
});

/** 缺省存储身份:同一身份复用 persist 分区，Cookie/登录态跨标签与正常重启保留。 */
export const DEFAULT_BROWSER_WORKSPACE = 'default';

/** 权限查询(iRight 群组管理)独立分区，登录态与其他页面隔离。 */
export const PERMISSION_QUERY_WORKSPACE = 'permission-query';
/** 群组创建(productinfo 权限管理)独立分区。 */
export const PERMISSION_GROUPS_WORKSPACE = 'permission-groups';
/** 权限工作台的统一标签记录；各标签继续使用原有登录分区。 */
export const PERMISSION_BROWSER_WORKSPACE = 'permission';
export interface BrowserDefaultTab { id: string; workspace: string; url: string; label: string; }
export const PERMISSION_BROWSER_TABS: readonly BrowserDefaultTab[] = [
  { id: 'permission-query-home', workspace: PERMISSION_QUERY_WORKSPACE, url: 'https://group.iright.huawei.com/web/groupWeb/#/groupList', label: '权限查询' },
  { id: 'permission-groups-home', workspace: PERMISSION_GROUPS_WORKSPACE, url: 'https://productinfo.huawei.com/#/main/right_manage?menu_id=3232', label: '群组创建' },
];
/** PBI 特性管理独立分区。 */
export const PBI_FEATURES_WORKSPACE = 'pbi-features';
/** PBI 子系统&模块独立分区。 */
export const PBI_MODULES_WORKSPACE = 'pbi-modules';
/** PBI 工作台统一保存标签记录，页面沿用各自原有分区。 */
export const PBI_BROWSER_WORKSPACE = 'pbi';
export const PBI_BROWSER_TABS: readonly BrowserDefaultTab[] = [
  { id: 'pbi-features-home', workspace: PBI_FEATURES_WORKSPACE, url: 'https://pbi.huawei.com/pbiops#/feature-workflow-create/create', label: '特性管理' },
  { id: 'pbi-modules-home', workspace: PBI_MODULES_WORKSPACE, url: 'https://pbi.huawei.com/pbiops#/subsystem-module-create/create', label: '子系统&模块' },
];
export const isDefaultBrowserTab = (workspace: string, id: string): boolean =>
  [PERMISSION_BROWSER_TABS, PBI_BROWSER_TABS].some(tabs => tabs.some(tab => tab.workspace === workspace && tab.id === id));

/** 工作台页面 viewId → 浏览器存储分区(workspace);非浏览器页返回 null。
 *  AI 操控浏览器的能力只对返回非 null 的页面生效(ai-ipc.isBrowserPage / forChat、
 *  workbench-ai 提示语、AiPanel 当前标签随行)。新增浏览器页在此处登记即可。 */
const browserWorkspaces: Readonly<Record<string, string>> = {
  browser: DEFAULT_BROWSER_WORKSPACE,
  'permission-query': PERMISSION_QUERY_WORKSPACE,
  'permission-groups': PERMISSION_GROUPS_WORKSPACE,
  'pbi-features': PBI_FEATURES_WORKSPACE,
  'pbi-modules': PBI_MODULES_WORKSPACE,
};
export function browserWorkspaceForView(viewId: string): string | null {
  return browserWorkspaces[viewId] ?? null;
}
