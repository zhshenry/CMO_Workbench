/**
 * 通用浏览器外壳:chrome 条 + GuestFrame + 起始页(平台快捷入口),与具体业务解耦。
 * 整页「素材浏览器」与编辑器侧栏(v1b)共用本组件;采集与「AI 看这页」为可选能力。
 * 多标签:每个标签一个独立 GuestFrame;隐藏标签的 guest 保持存活(页面状态不丢)。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowClockwise, ArrowLeft, ArrowRight, Globe, Plus, ShieldCheck, Sparkle, X } from '@phosphor-icons/react';
import { BrowserAddress } from './address';
import { browserAddressTarget } from '../../../shared/browser-history';
import { GuestFrame } from './guest-frame';
import { WebviewPresentation } from './webview-presentation';
import { BrowserAutomationBar, restorableBrowserTabs } from './automation';
import type { BrowserSavedTab, BrowserTask } from '../../../shared/browser-automation-contracts';
import type { BrowserDefaultTab } from '../../../shared/browser-contracts';
import { restoreDefaultBrowserTabs } from './restore-tabs';
import './pane.css';

export interface PaneChip { name: string; url: string; dot: string; }

export interface PaneCapture {
  label: string;
  onCapture(shot: { url: string; title: string; png: string; thumb: string }): Promise<void> | void;
}

export interface PanePage { url: string; title: string; text: string; }

export interface BrowserPaneApi { loadUrl(url: string): void; }
export type BrowserTabTarget = { workspace: string; tabId: string };
export const BrowserTabTargetContext = createContext<BrowserTabTarget | undefined>(undefined);

export interface BrowserPaneProps {
  savedTabs?: BrowserSavedTab[];
  savedActiveId?: string;
  automation?: boolean;
  /** 存储身份:同 workspace 共享分区与登录态(持久化) */
  workspace: string;
  initialUrl?: string;
  slogan?: ReactNode;
  chips?: PaneChip[];
  /** 起始页附加内容(如最近采集列表) */
  startSlot?: ReactNode;
  capture?: PaneCapture;
  /** 提供时显示「AI 看这页」按钮,点击带上页面正文调用 */
  onAskPage?: (page: PanePage) => Promise<void> | void;
  /** 宿主可通过此引用驱动当前标签导航 */
  apiRef?: { current: BrowserPaneApi | null };
  onPending(message: string): void;
  /** 侧栏等窄容器形态:无标签条 */
  compact?: boolean;
  /** 开启多标签(整页形态) */
  tabs?: boolean;
  /** 专用后台仅展示当前地址,导航由页面和起始页入口完成。 */
  readOnlyAddress?: boolean;
  defaultTabs?: readonly BrowserDefaultTab[];
  activeWorkspace?: string;
  onActiveWorkspaceChange?(workspace: string): void;
}

interface PaneTab {
  id: string;
  workspace: string;
  label?: string;
  pinned: boolean;
  frame: GuestFrame;
  presentation: WebviewPresentation;
}

/** guest 正文提取(AI 看这页):优先 article,退回 body,截 6000 字 */
const PAGE_TEXT_CODE = `(() => {
  const main = document.querySelector('article') || document.body;
  const t = (main && main.innerText) || '';
  return t.replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 6000);
})()`;

export function BrowserPane({
  workspace, initialUrl, slogan, chips = [], startSlot, capture, onAskPage, apiRef, onPending,
  compact = false, tabs: tabsEnabled = false, readOnlyAddress = false,
  savedTabs = [], savedActiveId, automation = false,
  defaultTabs, activeWorkspace, onActiveWorkspaceChange,
}: BrowserPaneProps) {
  const openPopup = useRef<(url: string, tabId: string | undefined, workspace: string) => void>(() => {});
  const createTab = (id: string, url?: string, tabWorkspace = workspace): PaneTab => {
    const fixed = defaultTabs?.find(tab => tab.id === id);
    tabWorkspace = fixed?.workspace ?? tabWorkspace;
    let frame: GuestFrame;
    const presentation = new WebviewPresentation({ mounted: () => frame.attach(), unmounted: () => frame.detach() });
    // 加载目标只走 attach 的 pending 通道(复用挂载时序);不先 loadUrl,避免初始 tab 在
    // 未挂载时 initialize() 提前返回导致 webview 永不创建(见 2026-10-20 排查)。
    frame = new GuestFrame({ workspace: tabWorkspace, tabId: id, initialUrl: url, openRequested: (value, tabId) => tabsEnabled ? openPopup.current(value, tabId, tabWorkspace) : frame.loadUrl(value) }, window.workbench.browser, presentation);
    return { id, workspace: tabWorkspace, label: fixed?.label, pinned: !!fixed, frame, presentation };
  };
  const [tabs, setTabs] = useState<PaneTab[]>(() => {
    const restored = defaultTabs ? restoreDefaultBrowserTabs(savedTabs, defaultTabs) : restorableBrowserTabs(savedTabs, initialUrl, !tabsEnabled);
    return restored.map(tab => createTab(tab.id, tab.url, tab.workspace));
  });
  const [activeId, setActiveId] = useState(() => defaultTabs?.find(tab => tab.workspace === activeWorkspace)?.id ?? (savedActiveId && tabs.some(tab => tab.id === savedActiveId) ? savedActiveId : tabs[0].id));
  const [task, setTask] = useState<BrowserTask | null>(null);
  const [titlesRevision, setTitlesRevision] = useState(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const state = useSyncExternalStore(active.frame.subscribe, active.frame.getSnapshot);
  const [input, setInput] = useState('');
  const target = useContext(BrowserTabTargetContext);
  const handledTarget = useRef<BrowserTabTarget>(undefined);
  const [capBusy, setCapBusy] = useState(false);
  const [capDone, setCapDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(onPending);
  pendingRef.current = onPending;
  const persistenceEnabled = automation;
  const onTaskState = useCallback((value: BrowserTask | null) => setTask(value), []);

  useEffect(() => active.frame.refreshZoom(), [active.frame]);
  useEffect(() => {
    if (!activeWorkspace || active.workspace === activeWorkspace) return;
    const target = tabsRef.current.find(tab => tab.workspace === activeWorkspace);
    if (target) { setActiveId(target.id); setInput(target.frame.getSnapshot().target?.url.replace(/^https?:\/\//, '') ?? ''); }
  }, [activeWorkspace]);
  useEffect(() => {
    if (!target || target === handledTarget.current) return;
    const tab = tabs.find(item => item.id === target.tabId && item.workspace === target.workspace);
    if (!tab) return;
    handledTarget.current = target;
    setActiveId(tab.id);
    setInput(tab.frame.getSnapshot().target?.url.replace(/^https?:\/\//, '') ?? '');
  }, [target, tabs]);

  useEffect(() => onActiveWorkspaceChange?.(active.workspace), [active.workspace, onActiveWorkspaceChange]);

  useEffect(() => {
    if (!window.workbench.browserAutomation || !persistenceEnabled) return;
    let timer: number | undefined;
    const persist = () => {
      const values = tabsRef.current.map(tab => ({ id: tab.id, url: tab.frame.getSnapshot().target?.url ?? '', ...(defaultTabs ? { workspace: tab.workspace } : {}) }));
      void window.workbench.browserAutomation.saveTabs(workspace, values, activeId).catch(error => pendingRef.current(`标签保存失败：${String(error)}`));
    };
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, 400);
    };
    const unsubscribe = tabs.map(tab => tab.frame.subscribe(() => { setTitlesRevision(value => value + 1); save(); }));
    persist();
    return () => { unsubscribe.forEach(off => off()); window.clearTimeout(timer); };
  }, [tabs, activeId, workspace, persistenceEnabled, defaultTabs]);
  useEffect(() => { if (automation) void window.workbench.browserAutomation.activate(active.workspace, active.id).catch(() => {}); }, [active.workspace, active.id, titlesRevision, automation]);

  // 卸载:释放全部标签的 guest 与租约
  useEffect(() => () => {
    for (const t of tabsRef.current) void t.frame.dispose();
  }, []);

  // 地址输入跟随实际加载的 URL;用户输入中不覆盖
  useEffect(() => {
    if (state.address === 'observed' && state.target) setInput(state.target.url.replace(/^https?:\/\//, ''));
  }, [state.address, state.target?.url]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { loadUrl: (url: string) => active.frame.loadUrl(url) };
    return () => { apiRef.current = null; };
  }, [apiRef, active?.frame]);

  const go = (raw: string): void => {
    const value = browserAddressTarget(raw);
    if (!value) { if (raw.trim()) onPending('请输入 HTTP/HTTPS 网址或搜索词。'); return; }
    setInput(value.replace(/^https?:\/\//, ''));
    manual(() => active.frame.loadUrl(value));
  };
  const manual = (action: () => void): void => {
    if (task?.workspace === active.workspace && task.status === 'running' && task.tabIds.includes(active.id)) void window.workbench.browserAutomation.control(task.id, 'pause').then(() => action(), error => onPending(String(error)));
    else action();
  };

  const onCaptureClick = async (): Promise<void> => {
    if (!capture || capBusy) return;
    setCapBusy(true);
    try {
      const shot = await active.frame.capturePage();
      if (!shot) { onPending('先打开一个页面,再采集'); return; }
      await capture.onCapture(shot);
      setCapDone(true);
      window.setTimeout(() => setCapDone(false), 1500);
    } finally {
      setCapBusy(false);
    }
  };

  const onAskClick = async (): Promise<void> => {
    if (!onAskPage) return;
    if (state.target === undefined) { onPending('先打开一个页面,再让 AI 看'); return; }
    const text = (await active.frame.executeJavaScript<string>(PAGE_TEXT_CODE)) ?? '';
    if (text === '') { onPending('没能读取到页面正文(该站点可能限制脚本)'); return; }
    await onAskPage({ url: state.target.url, title: state.target.title, text });
  };

  const newTab = (url?: string, id: string = crypto.randomUUID(), tabWorkspace = active.workspace): void => {
    if (tabsRef.current.length >= 20) { onPending('最多打开 20 个标签页。'); return; }
    const tab = createTab(id, url, tabWorkspace);
    setTabs((list) => [...list, tab]);
    setActiveId(tab.id);
    setInput('');
  };
  openPopup.current = (url, id, workspace) => newTab(url, id, workspace);

  const closeTab = (id: string): void => {
    // 默认标签(首个)不可关闭:保证工作台主页(initialUrl)始终可达,避免误关后无法回到初始页
    if (tabs.length < 2 || id === tabs[0].id || tabs.find(tab => tab.id === id)?.pinned) return;
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = tabs[idx];
    void tab.frame.dispose();
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeId === id) {
      const next = rest[Math.max(idx - 1, 0)] ?? rest[0];
      if (next) {
        setActiveId(next.id);
        setInput(next.frame.getSnapshot().target?.url.replace(/^https?:\/\//, '') ?? '');
      }
    }
  };

  useEffect(() => {
    if (!automation) return;
    return window.workbench.browserAutomation.onTabCommand(command => {
      if (command.workspace !== workspace && !defaultTabs?.some(tab => tab.workspace === command.workspace)) return;
      if (command.type === 'open') newTab(command.url, command.tabId, command.workspace);
      else if (command.type === 'select') setActiveId(command.tabId);
      else if (command.type === 'close') closeTab(command.tabId);
    });
  }, [workspace, tabs, activeId, automation, defaultTabs]);

  const startVisible = state.target === undefined;

  return (
    <div className={compact ? 'mbp compact' : 'mbp'}>
      {tabsEnabled && (
        <div className="mbp-tabstrip"><div className="mbp-tabs" role="tablist" aria-label="浏览器标签页" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex(tab => tab.id === active.id);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          const tab = tabs[next];
          setActiveId(tab.id); setInput(tab.frame.getSnapshot().target?.url.replace(/^https?:\/\//, '') ?? ''); document.getElementById(`browser-tab-${workspace}-${tab.id}`)?.focus();
        }}>
          {tabs.map((t) => {
            const title = t.label || t.frame.getSnapshot().target?.title || '新标签页';
            return (
              <div key={t.id} className={t.id === active.id ? 'mbp-tab on' : 'mbp-tab'}>
                <button className="mbp-tab-btn" id={`browser-tab-${workspace}-${t.id}`} role="tab" aria-selected={t.id === active.id} tabIndex={t.id === active.id ? 0 : -1} title={title} onClick={() => { setActiveId(t.id); setInput(t.frame.getSnapshot().target?.url.replace(/^https?:\/\//, '') ?? ''); }}>
                  <Globe size={15} />
                  <span className="mbp-tab-title">{title}</span>
                </button>
                {tabs.length > 1 && t.id !== tabs[0].id && !t.pinned && (
                  <button className="mbp-tab-x" title="关闭标签页" aria-label={`关闭 ${title}`} onClick={() => closeTab(t.id)}>
                    <X size={9} weight="bold" />
                  </button>
                )}
              </div>
            );
          })}
        </div><button className="mbp-tabnew" title="新标签页" aria-label="新标签页" disabled={tabs.length >= 20} onClick={() => newTab()}><Plus size={17} /></button></div>
      )}
      <div className="mbp-chrome">
        <div className="mbp-navigation">
        <button className="mbp-navbtn" title="后退" disabled={!state.canGoBack} onClick={() => manual(() => active.frame.goBack())}>
          <ArrowLeft size={15} />
        </button>
        <button className="mbp-navbtn" title="前进" disabled={!state.canGoForward} onClick={() => manual(() => active.frame.goForward())}>
          <ArrowRight size={15} />
        </button>
        <button className="mbp-navbtn" title="刷新" onClick={() => manual(() => active.frame.reload())}>
          <ArrowClockwise size={14} />
        </button>
        </div>
        <BrowserAddress workspace={active.workspace} value={input} onChange={setInput} onGo={go} readOnly={readOnlyAddress} inputRef={inputRef} />
        {onAskPage && (
          <button
            className="mbp-navbtn"
            title="AI 看这页:总结页面内容并提炼选题"
            disabled={state.target === undefined}
            onClick={() => void onAskClick()}
          >
            <Sparkle size={15} weight="fill" />
          </button>
        )}
        {capture && (
          <button
            className={capDone ? 'mbp-capbtn done' : 'mbp-capbtn'}
            disabled={capBusy}
            onClick={() => void onCaptureClick()}
          >
            {capDone ? <>已采集 ✓</> : <><Plus size={13} weight="bold" />{capture.label}</>}
          </button>
        )}
        {automation && <BrowserAutomationBar key={active.workspace} workspace={active.workspace} tabId={active.id} url={state.target?.url} ready={state.target !== undefined && !state.loading && !state.error} zoomFactor={state.zoomFactor} onZoomChange={factor => active.frame.setZoomFactor(factor)} onRefreshZoom={() => active.frame.refreshZoom()} onNavigate={go} onState={onTaskState} />}
      </div>
      <div className="mbp-stage">
        {task?.workspace === active.workspace && task.status === 'running' && <button className="browser-takeover" title="点击页面可暂停并接管" aria-label="接管浏览器并暂停 AI" onClick={() => void window.workbench.browserAutomation.control(task.id, 'pause').catch(error => onPending(String(error)))} />}
        {state.loading && <div className="mbp-progress" aria-hidden="true" />}
        {state.error && (
          <div className="mbp-error" role="alert">
            页面加载失败{state.error.code !== undefined ? `(错误 ${state.error.code})` : ''}:{state.error.description || '请检查网络或稍后重试'}
          </div>
        )}
        <div className="mbp-hosts" style={{ position: 'absolute', inset: 0 }}>
          {tabs.map((t) => (
            <TabHost key={t.id} tab={t} active={t.id === active.id} />
          ))}
        </div>
        <SsoNotice subscribeSso={active.frame.subscribeSso} getSso={active.frame.getSso} />
        {startVisible && (
          <div className="mbp-start">
            <div className="mbp-biglogo" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.2" /><ellipse cx="12" cy="12" rx="3.6" ry="8.2" />
                <path d="M4.4 9.4h15.2M4.4 14.6h15.2" />
              </svg>
            </div>
            <div className="mbp-slogan">{slogan ?? '逛平台、找选题,看到即采集'}</div>
            <div className="mbp-chips">
              {chips.map((c) => (
                <button key={c.url} className="mbp-chip" onClick={() => go(c.url)}>
                  <span className="mbp-pdot" style={{ background: c.dot }} />
                  {c.name}
                </button>
              ))}
            </div>
            {startSlot}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单个标签的 guest 宿主:保持挂载使页面状态存活,非活动标签仅隐藏。 */
function TabHost({ tab, active }: { tab: PaneTab; active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return tab.presentation.mount(el);
  }, [tab.presentation]);
  return <div ref={ref} className="mbp-host" hidden={!active} inert={!active} />;
}

/**
 * guest 跳转到 W3 SSO 登录页时的提示条(已保存凭据则主进程已自动填充)。
 * 「去保存」通过自定义事件请宿主切到 设置 → W3和Welink接入。
 */
function SsoNotice({ subscribeSso, getSso }: Pick<GuestFrame, 'subscribeSso' | 'getSso'>) {
  const sso = useSyncExternalStore(subscribeSso, getSso);
  if (!sso.active) return null;
  const openWelinkSettings = (): void => {
    window.dispatchEvent(new CustomEvent('workbench:open-settings-welink'));
  };
  return (
    <div className="mbp-sso" role="status">
      <ShieldCheck size={15} weight="bold" />
      {sso.hasCredentials ? (
        <span>已尝试填充保存的 W3 凭据。你可以在页面中核对并登录。</span>
      ) : (
        <span>
          此页面需要 W3 登录。请在页面中输入账号密码；保存到「W3和Welink接入」栏目后下次自动填充。
          <button type="button" className="mbp-sso-link" onClick={openWelinkSettings}>去保存</button>
        </span>
      )}
    </div>
  );
}
