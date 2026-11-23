import { taskDay } from '../shared/todo-date';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { SidebarSimple, Sparkle, X } from '@phosphor-icons/react';
import { NAV, defaultViewOfWorkbench, ownerOfWorkbench, resolveView, workbenchById, type WorkbenchDef, type WorkbenchId } from './nav';
import type { AvatarColor, ViewId } from '../shared/contracts';
import { localDay, openToday, taskTime, type Task, type TaskInput } from '../shared/todo-contracts';
import { isOverdue, meetingEndAt } from '../shared/todo-format';
import { welinkDisplayTasks } from '../shared/welink-display';
import { topbarScheduleDate, topbarTodoDate } from './topbar-dates';
import { applyTopbarCapsulePlacement } from './topbar-layout';
import { BOT_SPLIT_MIN_WIDTH, botSplitWidthLimit } from './bot-split-layout';
import { errorText, IconButton, Segmented, Select } from './ui/controls';
import { BotPanel, type BotAssistantMode, type BotPanelHandle, type BotPanelPage } from './views/BotPanel';
import { BotAvatar } from './views/BotAvatar';
import { BotContactMenu } from './views/BotContactMenu';
import { AiResponse } from './views/AiResponse';
import { AiSetupHint } from './views/AiSetupHint';
import { configurationBotSeed, configurationSectionForView, configurationSections, retiredConfigurationBot, type BotArtifact, type BotCard, type BotResourceRef } from '../shared/bot-contracts';
import { botActivityLabels } from '../shared/bot-activity';
import { IslandMascot } from './ui/IslandMascot';
import { useAppearanceSettings } from './appearance';
import { HomeView } from './views/HomeView';
import { useTodoData } from './todo-state';
import { TodoView } from './views/TodoView';
import { OfficeView } from './views/OfficeView';
import { MeetingCompanion } from './views/MeetingCompanion';
import { RoomBooking } from './views/RoomBooking';
import type { OfficeRef, OfficeScene } from '../shared/office-workbench';
import type { AiPanelContext, AiSeed } from './views/AiPanel';
import { chatContextScope, type AiScope } from '../shared/ai-scope';
import { pageAiContext } from './ai-page-context';
import { SettingsDialog } from './views/SettingsDialog';
import { BotManagement } from './views/BotManagement';
import { TopbarUpdate } from './views/TopbarUpdate';
import { TaskEditor, type TaskEditHandle, type TaskEditorApi } from '../modules/todo/ui/TaskEditor';
import { BrowserHost } from './views/BrowserView';
import { BrowserTabTargetContext, type BrowserTabTarget } from '../modules/browser/ui/pane';
import { BrowserPageHost } from './views/BrowserPageHost';
import type { BrowserTask } from '../shared/browser-automation-contracts';
import { ReadingView } from './views/ReadingView';
import { PERMISSION_BROWSER_WORKSPACE, PERMISSION_BROWSER_TABS, PERMISSION_QUERY_WORKSPACE, PERMISSION_GROUPS_WORKSPACE, PBI_BROWSER_WORKSPACE, PBI_BROWSER_TABS, PBI_FEATURES_WORKSPACE, PBI_MODULES_WORKSPACE } from '../shared/browser-contracts';
import { DeliveryProjects } from '../modules/delivery/ui/DeliveryProjects';
import { DtsQuery } from '../modules/dts/ui/DtsQuery';
import {
  IconCalendar, IconCheckSquare, IconChevronDown, LogoMark, WB_ICONS,
} from './icons';

const topbarTaskEditorApi: TaskEditorApi = {
  create: (input) => window.workbench.todo.create(input),
  update: (id, patch, revision) => window.workbench.todo.update(id, patch, revision),
  remove: (id, revision) => window.workbench.todo.remove(id, revision),
  createCategory: (input) => window.workbench.todo.createCategory(input),
};

const initialWorkbench = (): WorkbenchId => {
  const saved = localStorage.getItem('wb.bot.active');
  if (saved && retiredConfigurationBot(saved)) return configurationBotSeed.workspaceId;
  return NAV.find(item => item.id === saved && item.id !== 'settings')?.id ?? 'home';
};
function rememberedWorkbenchView(id: WorkbenchId, savedId: string = id): ViewId {
  const savedView = localStorage.getItem(`wb.bot.route.${savedId}`);
  return workbenchById(id).subs.find(sub => sub.view === savedView)?.view
    ?? configurationSections.find(section => section.id === savedId)?.views[0] ?? defaultViewOfWorkbench(id);
}
const initialView = (): ViewId => {
  const saved = localStorage.getItem('wb.bot.active');
  const id = initialWorkbench();
  return rememberedWorkbenchView(id, saved && retiredConfigurationBot(saved) ? saved : id);
};
const configurationTabs = configurationSections.map(({ id, label }) => {
  const Icon = WB_ICONS[id];
  return { value: id, label, icon: <Icon size={16} /> };
});

const SETTINGS_ROUTE_KEY = 'wb.bot.route.settings';
const rememberedSettingsView = (): ViewId => {
  const saved = localStorage.getItem(SETTINGS_ROUTE_KEY) as ViewId | null;
  return saved && ownerOfWorkbench(saved) === 'settings' ? resolveView(saved) : 'settings-general';
};

const BOT_MODE_LABELS: Record<BotAssistantMode, string> = { parallel: '固定', floating: '悬浮' };

export function App() {
  const [curWb, setCurWb] = useState<WorkbenchId>(initialWorkbench);
  const [railBranch, setRailBranch] = useState<WorkbenchId>('home');
  const [navExpanded, setNavExpanded] = useState(() => localStorage.getItem('wb.bot.nav.expanded') === '1' || !localStorage.getItem('wb.bot.nav.expanded') && localStorage.getItem('wb.nav.expanded') === '1');
  const railRef = useRef<HTMLElement>(null);
  const railSelectionRef = useRef<HTMLSpanElement>(null);
  const railSelectionGlow = useRef<Animation | null>(null);
  const lastRailWorkbench = useRef<WorkbenchId | null>(null);
  const railMenuRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [curView, setCurView] = useState<ViewId>(initialView);
  const [settingsView, setSettingsView] = useState<ViewId | null>(null);
  const isPermissionPage = curView === 'permission-query' || curView === 'permission-groups';
  const permissionView = useRef<ViewId>(isPermissionPage ? curView : 'permission-query');
  const [permissionRequest, setPermissionRequest] = useState<string | undefined>(() => isPermissionPage ? curView : undefined);
  const onPermissionWorkspaceChange = useCallback((workspace: string) => {
    if (workspace !== 'permission-query' && workspace !== 'permission-groups') return;
    permissionView.current = workspace;
    setPermissionRequest(undefined);
    setCurView(previous => previous === 'permission-query' || previous === 'permission-groups' ? workspace : previous);
  }, []);
  const isPbiPage = curView === 'pbi-features' || curView === 'pbi-modules';
  const pbiView = useRef<ViewId>(isPbiPage ? curView : 'pbi-features');
  const [pbiRequest, setPbiRequest] = useState<string | undefined>(() => isPbiPage ? curView : undefined);
  const onPbiWorkspaceChange = useCallback((workspace: string) => {
    if (workspace !== 'pbi-features' && workspace !== 'pbi-modules') return;
    pbiView.current = workspace;
    setPbiRequest(undefined);
    setCurView(previous => previous === 'pbi-features' || previous === 'pbi-modules' ? workspace : previous);
  }, []);
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const todo = useTodoData();
  const topbarRef = useRef<HTMLElement>(null);
  const [todoEditor, setTodoEditor] = useState<Task | 'new' | null>(null);
  const todoEditHandle = useRef<TaskEditHandle>(null);
  const [meetingTool, setMeetingTool] = useState<{ kind: 'record'; task?: Task } | { kind: 'rooms' }>();
  const [topbarEditorKind, setTopbarEditorKind] = useState<TaskInput['kind'] | null>(null);
  const [islandPop, setIslandPop] = useState<null | 'sched' | 'todo'>(null);
  const [floatVisible, setFloatVisible] = useState(false);
  const appearance = useAppearanceSettings();
  // 个人资料昵称(设置 → 个人资料):头像首字与首页问候共用,直接从应用设置读取
  const [profileName, setProfileName] = useState('Ono');
  const [profileAvatarColor, setProfileAvatarColor] = useState<AvatarColor>('blue');
  // W3 账号是否已维护:null=未加载(IPC 返回前不渲染,避免误闪提醒),''=已加载未设置(显示提醒),非空=已设置(#8)
  const [w3Uid, setW3Uid] = useState<string | null>(null);

  useEffect(() => {
    void window.workbench.settings.get().then(
      (s) => {
        if (s) {
          setProfileName(s.profile.name);
          setProfileAvatarColor(s.profile.avatarColor);
          setW3Uid(s.w3Uid ?? '');
        }
      },
      () => undefined,
    );
  }, []);

  const [aiOpen, setAiOpen] = useState(() => localStorage.getItem('wb.ai.open') !== '0');
  const aiTrigger = useRef<HTMLButtonElement>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [bots, setBots] = useState<BotCard[]>([]), [botError, setBotError] = useState('');
  const [assistantMode, setAssistantMode] = useState<BotAssistantMode>(() => localStorage.getItem('wb.bot.mode') === 'floating' ? 'floating' : 'parallel');
  const [botMenu, setBotMenu] = useState<{ card: BotCard; anchor: HTMLButtonElement; x: number; y: number }>();
  const [botPage, setBotPage] = useState<{ value: BotPanelPage; nonce: number; taskId?: string }>();
  const botPanel = useRef<BotPanelHandle>(null);
  const [initialProfileTab, setInitialProfileTab] = useState<BotPanelHandle['openProfileTab']>();
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(() => !['office', configurationBotSeed.workspaceId].includes(initialWorkbench()));
  const [workspaceHeader, setWorkspaceHeader] = useState<HTMLDivElement | null>(null);
  const [officeSource, setOfficeSource] = useState<{ source: OfficeRef; nonce: number }>();
  useEffect(() => { localStorage.setItem('wb.bot.active', curWb); }, [curWb]);
  useEffect(() => {
    if (curWb === configurationBotSeed.workspaceId && configurationSectionForView(curView)) localStorage.setItem(`wb.bot.route.${curWb}`, curView);
  }, [curWb, curView]);
  useEffect(() => {
    if (settingsView) localStorage.setItem(SETTINGS_ROUTE_KEY, settingsView);
  }, [settingsView]);
  const [artifactPreview, setArtifactPreview] = useState<BotArtifact | null>(null);
  const [requestedArtifactId, setRequestedArtifactId] = useState<string>();
  const [artifactError, setArtifactError] = useState('');
  const activeBot = bots.find(bot => bot.workspaceId === curWb);
  const workspaceHidden = !!activeBot && workspaceCollapsed && aiOpen && assistantMode === 'parallel';
  const botReadVersion = useRef(0);
  const readBots = useCallback(() => {
    const version = ++botReadVersion.current;
    return window.workbench.bot.list().then(value => { if (version === botReadVersion.current) { setBots(value); setBotError(''); } }, cause => { if (version === botReadVersion.current) setBotError(errorText(cause)); });
  }, []);
  useEffect(() => { void readBots(); return window.workbench.bot.onChanged(event => { if (['profile', 'read', 'task', 'activity'].includes(event.kind)) void readBots(); }); }, [readBots]);
  const selectAssistantMode = (value: BotAssistantMode) => {
    if (assistantMode !== value) botPanel.current?.prepareModeSwitch(value);
    if (assistantMode === 'floating' && value === 'parallel') setWorkspaceCollapsed(false);
    setAssistantMode(value);
    localStorage.setItem('wb.bot.mode', value);
  };
  const [preferredAiWidth, setPreferredAiWidth] = useState(() => {
    const saved = Number(localStorage.getItem('wb.ai.width'));
    return Number.isFinite(saved) && saved !== 0 ? Math.max(BOT_SPLIT_MIN_WIDTH, saved) : 380;
  });
  const [aiWidthLimit, setAiWidthLimit] = useState(() => botSplitWidthLimit(window.innerWidth));
  const aiWidth = Math.min(preferredAiWidth, aiWidthLimit);
  const resizeAiWidth = (width: number) => {
    const next = Math.max(BOT_SPLIT_MIN_WIDTH, Math.min(aiWidthLimit, width));
    setPreferredAiWidth(preferred => Math.min(preferred, aiWidthLimit) === next ? preferred : next);
  };
  useLayoutEffect(() => {
    const updateLimit = () => setAiWidthLimit(botSplitWidthLimit(window.innerWidth));
    updateLimit();
    window.addEventListener('resize', updateLimit);
    return () => window.removeEventListener('resize', updateLimit);
  }, []);
  const [railMenu, setRailMenu] = useState<WorkbenchId | null>(null);
  const dismissedRailMenu = useRef<WorkbenchId | null>(null);
  const [aiJobs, setAiJobs] = useState<{ chatId: string; scope: AiScope; title: string; status: 'running' | 'done' | 'error' }[]>([]);
  const [browserTasks, setBrowserTasks] = useState<BrowserTask[]>([]);
  const [browserTabTarget, setBrowserTabTarget] = useState<BrowserTabTarget>();
  const [activeAiChatId, setActiveAiChatId] = useState<string | null>(null);
  const aiJob = aiJobs.find(job => job.status === 'running' && job.chatId !== activeAiChatId) ?? aiJobs.find(job => job.status === 'running') ?? aiJobs[0] ?? null;
  const browserTask = browserTasks.find(task => ['running', 'paused', 'site-approval'].includes(task.status)) ?? browserTasks[0] ?? null;
  const [requestedAiChatId, setRequestedAiChatId] = useState<string | null>(null);
  const seedNonce = useRef(0);
  // 模块「AI 解读/共创」进线:打开面板、新建会话并直接发送(避免与面板自身的 chatOpen 竞态)
  const [aiSeed, setAiSeed] = useState<AiSeed | null>(null);
  const [readingCtx, setReadingCtx] = useState<{ id: string; title: string } | null>(null);

  const aiContext: AiPanelContext = pageAiContext(curView, { reading: readingCtx });

  useEffect(() => { localStorage.setItem('wb.ai.open', aiOpen ? '1' : '0'); }, [aiOpen]);
  useEffect(() => { localStorage.setItem('wb.ai.width', String(preferredAiWidth)); }, [preferredAiWidth]);
  useEffect(() => { localStorage.setItem('wb.bot.nav.expanded', navExpanded ? '1' : '0'); localStorage.setItem('wb.nav.expanded', navExpanded ? '1' : '0'); }, [navExpanded]);
  // 关闭设置后刷新主界面的账号与个人资料展示。
  useEffect(() => {
    if (settingsView) return;
    void window.workbench.settings.get().then((s) => {
      if (s) { setW3Uid(s.w3Uid ?? ''); setProfileName(s.profile.name); setProfileAvatarColor(s.profile.avatarColor); }
    }, () => undefined);
  }, [curView, settingsView]);
  useEffect(() => window.workbench.settings.onProfileChanged?.(profile => {
    setProfileName(profile.name); setProfileAvatarColor(profile.avatarColor);
  }), []);
  useEffect(() => window.workbench.browserAutomation?.onTask(task => setBrowserTasks(previous => [task, ...previous.filter(item => item.id !== task.id)].slice(0, 40))), []);
  useEffect(() => window.workbench.ai.onChat(chat => {
    const scope = chatContextScope(chat);
    const running = chat.entries.some(entry => entry.streaming);
    const failed = chat.entries.at(-1)?.error;
    setAiJobs(previous => running
      ? [{ chatId: chat.id, scope, title: chat.title, status: 'running' as const }, ...previous.filter(item => item.chatId !== chat.id)].slice(0, 40)
      : previous.map(item => item.chatId === chat.id && item.status === 'running' ? { ...item, title: chat.title, status: failed ? 'error' as const : 'done' as const } : item));
  }), []);
  useEffect(() => {
    if (aiOpen && aiJob?.status !== 'running' && aiJob?.chatId === activeAiChatId) setAiJobs(previous => previous.filter(item => item.chatId !== activeAiChatId));
  }, [aiJob, activeAiChatId, aiOpen]);

  const askAI = (prompt: string, scope: AiScope = aiContext.scope, officeScene?: OfficeScene): void => {
    const requestScope = scope;
    void window.workbench.ai.config().then((raw) => {
      const cfg = raw as { aiEnabled?: boolean };
      if (!cfg.aiEnabled) {
        showToast('请先在模型配置中添加对话模型');
        return;
      }
      setAiOpen(true);
      setAiSeed({ text: prompt, nonce: ++seedNonce.current, scope: requestScope, officeScene });
    }, () => showToast('AI 状态读取失败,请重试'));
  };

  useEffect(() => window.workbench.onMaximized(setMaximized), []);
  useEffect(() => window.workbench.float.onVisibilityChanged(setFloatVisible), []);

  const showToast = (msg: string): void => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  };

  const toggleIslandPop = (which: 'sched' | 'todo'): void => {
    setIslandPop((p) => (p === which ? null : which));
  };
  const leaveTodoEdit = (navigate: () => void): void => {
    const editor = todoEditHandle.current;
    if (editor) editor.leave(navigate);
    else navigate();
  };
  const openTopbarTaskCreator = (kind: TaskInput['kind']): void => leaveTodoEdit(() => {
    topbarRef.current?.querySelector<HTMLButtonElement>(kind === 'meeting' ? '.sched' : '.todopill')?.focus({ preventScroll: true });
    setIslandPop(null);
    setTopbarEditorKind(kind);
  });
  const openTaskEditor = (t: Task): void => leaveTodoEdit(() => {
    setTodoEditor(t);
    switchView('todo');
    setIslandPop(null);
  });
  // 弹出面板:点击外部 / Esc 关闭
  useEffect(() => {
    if (!islandPop) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (topbarRef.current?.contains(e.target as Node)) return;
      setIslandPop(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIslandPop(null);
        topbarRef.current?.querySelector<HTMLButtonElement>(islandPop === 'sched' ? '.sched' : '.todopill')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [islandPop]);

  const activate = (id: WorkbenchId, { keepLayout = false, after }: { keepLayout?: boolean; after?: () => void } = {}): void => {
    const navigate = () => {
      const keepWorkspace = keepLayout && !!activeBot && aiOpen && assistantMode === 'parallel';
      dismissedRailMenu.current = null;
      setRailMenu(!navExpanded && id !== 'home' && id !== 'todo' && id !== 'office' && id !== configurationBotSeed.workspaceId && id !== 'settings' && workbenchById(id).subs.some(sub => !sub.navHidden) ? id : null);
      if (id === 'settings') { setSettingsView(rememberedSettingsView()); return; }
      setSettingsView(null);
      setArtifactPreview(null);
      setBotPage(undefined);
      if (id === 'office' || id === configurationBotSeed.workspaceId) setWorkspaceCollapsed(false);
      else if (!keepWorkspace && id !== curWb) setWorkspaceCollapsed(true);
      if (id !== curWb) {
        setInitialProfileTab(keepLayout ? botPanel.current?.openProfileTab : undefined);
        // 内容区渲染跟随 curView:切工作台必须同步落位,否则停留在上一个工作台的页面
        const nextView = id === configurationBotSeed.workspaceId ? rememberedWorkbenchView(id) : defaultViewOfWorkbench(id);
        if (nextView === 'permission-query' || nextView === 'permission-groups') setPermissionRequest(nextView);
        if (nextView === 'pbi-features' || nextView === 'pbi-modules') setPbiRequest(nextView);
        setCurView(nextView);
        setCurWb(id);
      }
      after?.();
    };
    if (id === 'todo' || id === 'settings') navigate();
    else leaveTodoEdit(navigate);
  };

  const switchView = (view: ViewId, after?: () => void): void => {
    view = resolveView(view);
    setRailMenu(null);
    if (view.startsWith('settings')) {
      setIslandPop(null);
      setSettingsView(view);
      after?.();
      return;
    }
    const navigate = () => {
      setSettingsView(null);
      if (view === 'permission-query' || view === 'permission-groups') { permissionView.current = view; setPermissionRequest(view); }
      if (view === 'pbi-features' || view === 'pbi-modules') { pbiView.current = view; setPbiRequest(view); }
      setWorkspaceCollapsed(false);
      setCurView(view);
      const owner = ownerOfWorkbench(view);
      if (owner) {
        setInitialProfileTab(undefined);
        setCurWb(owner);
        localStorage.setItem(`wb.bot.route.${owner}`, view);
      }
      after?.();
    };
    if (view === 'todo') navigate();
    else leaveTodoEdit(navigate);
  };

  const selectConfigurationSection = (id: string) => {
    const section = configurationSections.find(item => item.id === id);
    if (section) switchView(id === 'permission' ? permissionView.current : id === 'pbi' ? pbiView.current : section.views[0]);
  };

  const openTodoTarget = (id?: string): void => {
    if (!id) { leaveTodoEdit(() => { setTodoEditor(null); switchView('todo'); }); return; }
    void window.workbench.todo.state().then(({ tasks }) => {
      const item = tasks.find(task => task.id === id && !task.deletedAt);
      if (item) openTaskEditor(item);
      else { openTodoTarget(); showToast('原事项已不在当前列表。'); }
    }).catch(error => showToast(errorText(error)));
  };

  const openBrowserTask = (reference: Pick<BrowserTask, 'id' | 'workspace'>) => {
    const workspace = reference.workspace;
    const views: Record<string, ViewId> = {
      [PERMISSION_QUERY_WORKSPACE]: 'permission-query', [PERMISSION_GROUPS_WORKSPACE]: 'permission-groups',
      [PBI_FEATURES_WORKSPACE]: 'pbi-features', [PBI_MODULES_WORKSPACE]: 'pbi-modules',
    };
    const view = views[workspace] ?? 'browser';
    const tabsWorkspace = view.startsWith('permission-') ? PERMISSION_BROWSER_WORKSPACE
      : view.startsWith('pbi-') ? PBI_BROWSER_WORKSPACE : workspace;
    const api = window.workbench.browserAutomation;
    void api.state(workspace).then(async state => {
      const task = state.tasks.find(item => item.id === reference.id);
      const { tabs, activeId } = tabsWorkspace === workspace ? state : await api.state(tabsWorkspace);
      const eligible = task?.tabIds.filter(id => tabs.some(tab => tab.id === id && (tab.workspace ?? workspace) === workspace)) ?? [];
      const tabId = eligible.includes(activeId) ? activeId : eligible.at(-1);
      switchView(view, () => {
        setBrowserTabTarget(tabId ? { workspace, tabId } : undefined);
        if (!tabId) showToast('原网页标签已关闭。');
      });
    }).catch(error => showToast(errorText(error)));
  };

  const analyzeOffice = (scene: OfficeScene, label: string): void => {
    switchView('office', () => { void askAI(label, { module: 'workbench', viewId: 'office' }, scene); });
  };

  const openOfficeTask = (taskId: string): void => {
    const task = todo.data?.tasks.find(item => item.id === taskId);
    if (!task) { showToast('这条日程或待办已更新，请刷新资料后重试。'); return; }
    openTaskEditor(task);
  };

  // 内嵌浏览器 SSO 提示条「去保存」→ 切到 设置 → W3和Welink接入
  useEffect(() => {
    const open = (): void => switchView('settings-welink');
    window.addEventListener('workbench:open-settings-welink', open);
    return () => window.removeEventListener('workbench:open-settings-welink', open);
  });

  const returnToAiJob = (): void => {
    if (!aiJob) return;
    setRequestedAiChatId(aiJob.chatId);
    setAiOpen(true);
    if (aiJob.status !== 'running') setAiJobs(previous => previous.filter(item => item.chatId !== aiJob.chatId));
  };

  useEffect(() => window.workbench.island?.onNavigate(target => {
    const view = target.view === 'settings-island' && (target.section === 'quota' || target.section === 'agents') ? 'settings-agents' : target.view;
    if (target.taskId) {
      void window.workbench.todo.state().then(data => {
        const task = data.tasks.find(t => t.id === target.taskId && !t.deletedAt);
        if (task) openTaskEditor(task);
      }).catch(error => showToast(errorText(error)));
      return;
    }
    switchView(view, () => {
      if (target.view === 'home') setAiOpen(true);
      if (target.artifactId) setRequestedArtifactId(target.artifactId);
      if (target.botTaskId) setBotPage({ value: 'tasks', nonce: Date.now(), taskId: target.botTaskId });
      if (target.botPanel && target.view === 'home') { setAiOpen(true); selectAssistantMode('parallel'); setWorkspaceCollapsed(true); setBotPage({ value: target.botPanel === 'details' ? 'profile' : 'artifacts', nonce: Date.now() }); }
      if (target.section) {
        sessionStorage.setItem('island-settings-section', target.section);
        window.dispatchEvent(new CustomEvent('island-settings-section', { detail: target.section }));
      }
    });
  }));

  const openBotResource = (resource: BotResourceRef): void => {
    setArtifactError('');
    void (async () => {
      if (resource.kind === 'reading') { if (!(await window.workbench.reading.list()).books.some(book => book.id === resource.id)) throw new Error('原书目不存在或不可访问'); switchView('reading'); }
      else if (resource.kind === 'todo') { const task = (await window.workbench.todo.state()).tasks.find(item => item.id === resource.id && !item.deletedAt); if (!task) throw new Error('原事项已删除，交付记录仍保留'); openTaskEditor(task); }
      else if (resource.kind === 'artifact') { setArtifactPreview(await window.workbench.bot.openArtifact(resource.id)); }
      else if (resource.kind === 'chat') { setRequestedAiChatId(resource.id); }
      setWorkspaceCollapsed(false);
    })().catch(cause => setArtifactError(errorText(cause)));
  };
  useEffect(() => {
    if (!requestedAiChatId) return;
    const owner = bots.find(bot => bot.mainChatId === requestedAiChatId);
    if (owner) { activate(owner.workspaceId, { after: () => { setAiOpen(true); setBotPage({ value: 'chat', nonce: Date.now() }); } }); setRequestedAiChatId(null); }
  }, [requestedAiChatId, bots]);
  useEffect(() => {
    if (!requestedArtifactId) return; let live = true;
    void window.workbench.bot.openArtifact(requestedArtifactId).then(value => { if (live) { setArtifactPreview(value); setWorkspaceCollapsed(false); setRequestedArtifactId(undefined); } }, cause => { if (live) { setArtifactError(errorText(cause)); setRequestedArtifactId(undefined); } });
    return () => { live = false; };
  }, [requestedArtifactId]);
  useEffect(() => {
    if (!bots.length) return;
    const navigate = () => { void window.workbench.bot.getLaunchTarget().then(async target => { if (!target) return; if (target.kind === 'todo') { const task = (await window.workbench.todo.state()).tasks.find(item => item.id === target.id && !item.deletedAt); if (task) openTaskEditor(task); return; } const { task } = await window.workbench.bot.getTask(target.id); const owner = bots.find(card => card.id === task.botId || card.archivedBotIds?.includes(task.botId)); if (owner) activate(owner.workspaceId, { after: () => { setAiOpen(true); setBotPage({ value: 'tasks', nonce: Date.now(), taskId: task.id }); } }); }).catch(cause => showToast(errorText(cause))); };
    navigate(); return window.workbench.bot.onChanged(event => { if (event.kind === 'navigation') navigate(); });
  }, [bots]);

  const activeWorkbench = workbenchById(curWb);
  const ActiveWorkbenchIcon = WB_ICONS[curWb];
  const isPlanningWorkbench = activeWorkbench.pending === true || (
    activeWorkbench.subs.length > 0 && activeWorkbench.subs.every((sub) => sub.pending === true)
  );
  const showDashboardHeader = curView === 'home' && !isPlanningWorkbench && !artifactPreview && !!todo.data;
  const backgroundAiRunning = aiJob?.status === 'running' && (!aiOpen || aiJob.chatId !== activeAiChatId);
  const aiModeLabel = `AI 助手 · ${aiOpen ? BOT_MODE_LABELS[assistantMode] : '已收起'}${backgroundAiRunning ? '，有对话正在后台生成' : ''}`;

  useEffect(() => {
    setRailMenu(null);
  }, [aiOpen]);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const closing = Array.from(rail.querySelectorAll<HTMLElement>('.rail-branch')).filter(branch =>
      branch.closest('.rail-entry')?.querySelector<HTMLElement>('[data-workbench]')?.dataset.workbench !== curWb && branch.getBoundingClientRect().height > 0);
    if (!navExpanded || motion.matches || closing.length === 0) {
      setRailBranch(curWb);
      return;
    }
    const open = (): void => setRailBranch(curWb);
    const settled = (event: TransitionEvent): void => {
      if (event.propertyName === 'height' && closing.every(branch => branch.getBoundingClientRect().height < 1)) open();
    };
    const reduceMotion = (): void => { if (motion.matches) open(); };
    const duration = getComputedStyle(rail).getPropertyValue('--rail-motion').trim();
    const timer = window.setTimeout(open, parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) + 32);
    rail.addEventListener('transitionend', settled);
    motion.addEventListener('change', reduceMotion);
    return () => {
      window.clearTimeout(timer);
      rail.removeEventListener('transitionend', settled);
      motion.removeEventListener('change', reduceMotion);
    };
  }, [curWb, navExpanded]);

  useLayoutEffect(() => {
    const rail = railRef.current, selection = railSelectionRef.current;
    const active = rail?.querySelector<HTMLButtonElement>('[data-workbench].on');
    const list = rail?.querySelector<HTMLElement>('.rail-nav');
    if (!rail || !selection || !active || !list) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = lastRailWorkbench.current !== null && lastRailWorkbench.current !== curWb;
    lastRailWorkbench.current = curWb;
    const place = (): void => {
      const rect = active.getBoundingClientRect(), railRect = rail.getBoundingClientRect(), listRect = list.getBoundingClientRect();
      const inList = list.contains(active);
      const index = Array.from(list.querySelectorAll('[data-workbench]')).indexOf(active);
      const top = inList
        ? listRect.top - railRect.top - list.scrollTop + index * (rect.height + parseFloat(getComputedStyle(list).rowGap))
        : rect.top - railRect.top;
      selection.style.transform = `translateY(${top}px)`;
      const visible = !inList || rect.top >= listRect.top - 1 && rect.bottom <= listRect.bottom + 1;
      rail.dataset.selectionVisible = String(visible);
      selection.style.opacity = visible ? '1' : '0';
    };
    const snap = (): void => {
      rail.dataset.selectionMotion = 'off';
      place();
      selection.getBoundingClientRect();
      delete rail.dataset.selectionMotion;
    };
    railSelectionGlow.current?.cancel();
    if (rail.dataset.selectionReady !== 'true' || motion.matches) snap();
    else place();
    rail.dataset.selectionReady = 'true';
    if (changed && !motion.matches) {
      const style = getComputedStyle(rail), shadow = getComputedStyle(selection).boxShadow;
      const duration = style.getPropertyValue('--rail-motion').trim();
      const light = `${shadow}, 0 0 0 1px ${style.getPropertyValue('--acc-ring')}, 0 0 18px ${style.getPropertyValue('--acc-soft')}`;
      railSelectionGlow.current = selection.animate([{ boxShadow: shadow }, { boxShadow: light, offset: 0.35 }, { boxShadow: shadow }], {
        duration: parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) * 1.5, easing: 'ease-out',
      });
    }
    const observer = new ResizeObserver(place);
    observer.observe(rail);
    observer.observe(active);
    const settled = (event: TransitionEvent): void => {
      if (event.propertyName === 'height' || event.propertyName === 'margin-top') place();
    };
    const reduceMotion = (): void => { railSelectionGlow.current?.cancel(); snap(); };
    list.addEventListener('scroll', snap);
    rail.addEventListener('transitionend', settled);
    window.addEventListener('resize', snap);
    motion.addEventListener('change', reduceMotion);
    return () => {
      observer.disconnect();
      railSelectionGlow.current?.cancel();
      list.removeEventListener('scroll', snap);
      rail.removeEventListener('transitionend', settled);
      window.removeEventListener('resize', snap);
      motion.removeEventListener('change', reduceMotion);
    };
  }, [curWb, navExpanded]);

  const openBotMenu = (card: BotCard, anchor: HTMLButtonElement, x?: number, y?: number) => {
    const bounds = anchor.getBoundingClientRect();
    anchor.focus({ preventScroll: true });
    setBotMenu({ card, anchor, x: x ?? bounds.right, y: y ?? bounds.top });
  };
  const editBot = (card: BotCard) => {
    setBotMenu(undefined); activate(card.workspaceId); selectAssistantMode('parallel'); setAiOpen(true);
    setBotPage({ value: 'profile', nonce: Date.now() });
  };
  const renderRailWorkbench = (workbench: WorkbenchDef) => {
    const bot = bots.find(item => item.workspaceId === workbench.id);
    const activity = bot?.activity ?? (bot?.runningCount ? 'working' : 'idle'), activityLabel = botActivityLabels[activity];
    const attention = !!bot?.waitingCount || ['waiting_user', 'waiting_resource', 'interrupted'].includes(activity);
    if (workbench.id !== 'settings' && bot) return <div className="rail-entry bot-contact" key={bot.id} data-selected={curWb === workbench.id} onContextMenu={event => { event.preventDefault(); openBotMenu(bot, event.currentTarget.querySelector<HTMLButtonElement>('button.ritem')!, event.clientX, event.clientY); }}>
      <button className={`ritem${curWb === workbench.id ? ' on' : ''}`} data-workbench={workbench.id} aria-current={curWb === workbench.id ? 'page' : undefined} aria-label={`${bot.name}，${bot.description}${activityLabel ? `，${activityLabel}` : ''}`} aria-haspopup="menu" aria-expanded={botMenu?.card.id === bot.id} aria-keyshortcuts="Shift+F10" title={`${bot.name} · ${bot.description}${activityLabel ? ` · ${activityLabel}` : ''}（右键编辑 Bot）`} onClick={() => activate(workbench.id, { keepLayout: true })} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); openBotMenu(bot, event.currentTarget); } }}><BotAvatar avatar={bot.avatar} activity={activity} motionId={bot.id} completion={bot.completion} /><span className="rail-label"><strong>{bot.name}</strong><small>{activityLabel || bot.description}</small></span></button>
      {!!(attention || bot.unreadCount) && <span className="bot-contact-badge" aria-label={bot.waitingCount ? `${bot.waitingCount} 项等待确认` : attention ? activityLabel : `${bot.unreadCount} 项未读结果`}>{attention ? `?${(bot.waitingCount ?? 0) > 1 ? bot.waitingCount : ''}` : bot.unreadCount}</span>}
    </div>;
    const Icon = WB_ICONS[workbench.id];
    const subs = workbench.subs.filter(sub => !sub.navHidden);
    const hasBranch = workbench.id !== 'home' && workbench.id !== 'todo' && workbench.id !== 'office' && workbench.id !== configurationBotSeed.workspaceId && workbench.id !== 'settings' && subs.length > 0;
    const branchVisible = hasBranch && workbench.id === curWb && railBranch === curWb;
    const menuAvailable = hasBranch && !navExpanded;
    const menuOpen = menuAvailable && railMenu === workbench.id;
    const selectedChild = subs.findIndex(sub => sub.view === curView);
    const children = hasBranch ? subs.map((sub) => (
      <button
        type="button"
        key={sub.label}
        className={sub.view === curView ? 'nsub on' : 'nsub'}
        aria-current={sub.view === curView ? 'page' : undefined}
        onClick={() => {
          setRailMenu(null);
          if (sub.view) switchView(sub.view);
          else showToast(`「${sub.label}」规划中,敬请期待`);
        }}
      >
        {sub.label}
        {sub.pending && <span className="ntag">规划中</span>}
      </button>
    )) : null;
    return (
      <div
        key={workbench.id}
        className="rail-entry"
        onMouseEnter={() => { dismissedRailMenu.current = null; setRailMenu(menuAvailable ? workbench.id : null); }}
        onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setRailMenu(null); }}
        onFocusCapture={() => { if (menuAvailable && dismissedRailMenu.current !== workbench.id) setRailMenu(workbench.id); }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            dismissedRailMenu.current = null;
            setRailMenu(null);
          }
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Escape' || event.key === 'ArrowLeft') && menuOpen) {
            event.preventDefault();
            event.stopPropagation();
            dismissedRailMenu.current = workbench.id;
            setRailMenu(null);
            event.currentTarget.querySelector<HTMLButtonElement>('[data-workbench]')?.focus();
          } else if (event.key === 'ArrowRight' && menuAvailable) {
            event.preventDefault();
            dismissedRailMenu.current = null;
            setRailMenu(workbench.id);
            requestAnimationFrame(() => railMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
          }
        }}
      >
        <button
          type="button"
          data-workbench={workbench.id}
          className={curWb === workbench.id ? 'ritem on' : workbench.pending ? 'ritem dim' : 'ritem'}
          title={workbench.pending ? `${workbench.title}(即将上线)` : workbench.title}
          aria-label={workbench.title}
          aria-current={curWb === workbench.id ? 'true' : undefined}
          aria-expanded={hasBranch ? (navExpanded ? branchVisible : menuOpen) : undefined}
          aria-controls={navExpanded && branchVisible ? `rail-branch-${workbench.id}` : menuOpen ? `rail-menu-${workbench.id}` : undefined}
          onClick={() => workbench.id === 'settings' ? switchView(rememberedSettingsView()) : activate(workbench.id)}
        >
          <span className="rail-icon" aria-hidden="true"><Icon /></span>
          <span className="rail-label">{workbench.title}</span>
        </button>
        {hasBranch && (
          <div className="rail-branch" data-open={branchVisible} style={{ '--branch-rows': subs.length, '--branch-selected': selectedChild } as CSSProperties}
            inert={!navExpanded || !branchVisible} aria-hidden={!navExpanded || !branchVisible || undefined}>
            <nav id={`rail-branch-${workbench.id}`} aria-label={`${workbench.title}二级目录`}>
              <span className="rail-child-selection" aria-hidden="true" hidden={selectedChild < 0} />
              {children}
            </nav>
          </div>
        )}
        {menuOpen && (
          <nav ref={railMenuRef} id={`rail-menu-${workbench.id}`} className="rail-flyout" aria-label={`${workbench.title}二级目录`}>
            <div className="rail-flyout-card">
              <div className="rail-flyout-title">{workbench.title}</div>
              <div className="rail-flyout-list" style={{ '--branch-selected': selectedChild } as CSSProperties}>
                <span className="rail-child-selection" aria-hidden="true" hidden={selectedChild < 0} />
                {children}
              </div>
            </div>
          </nav>
        )}
      </div>
    );
  };

  useLayoutEffect(() => {
    const menu = railMenuRef.current;
    const trigger = railRef.current?.querySelector<HTMLButtonElement>(`[data-workbench="${railMenu}"]`);
    if (!menu || !trigger) return;
    const place = (): void => {
      const rect = trigger.getBoundingClientRect();
      menu.style.left = `${rect.right}px`;
      menu.style.top = `${Math.max(74, Math.min(rect.top + (rect.height - menu.offsetHeight) / 2, innerHeight - menu.offsetHeight - 12))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(trigger);
    railRef.current?.querySelectorAll('.rail-entry').forEach(entry => observer.observe(entry));
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [railMenu]);

  // 顶栏胶囊：工作台的今日待办统计与今日日程
  const today = localDay(todo.clock);
  const todaySchedule = welinkDisplayTasks((todo.data?.tasks ?? [])
    .filter((t) => !t.deletedAt && t.kind === 'meeting' && taskDay(t) !== null && taskDay(t)! <= today)
    .sort((a, b) => taskTime(a) - taskTime(b)));
  const todayMeetings = todaySchedule.filter(t => t.status !== 'done').slice(0, 4);
  const openTodos = todo.data ? openToday(todo.data.tasks, today).filter(t => t.kind === 'task') : [];
  const openCount = openTodos.length;
  const doneCount = todo.data
    ? todo.data.tasks.filter((t) => !t.deletedAt && t.kind === 'task' && t.status === 'done' && t.completedAt && localDay(new Date(t.completedAt)) === today).length
    : 0;
  const totalCount = openCount + doneCount;
  const overdueCount = openTodos.filter((t) => isOverdue(t, todo.clock.getTime())).length;
  const topbarCapsuleKey = [
    todayMeetings.map((t) => `${t.id}:${t.title}:${t.dateAt ?? ''}:${t.endAt ?? ''}:${t.status}`).join(','),
    `${doneCount}/${totalCount}`,
    overdueCount,
    `${todo.clock.getFullYear()}-${todo.clock.getMonth()}-${todo.clock.getDate()}`,
    aiJob ? `${aiJob.chatId}:${aiJob.status}:${aiJob.title}` : '',
    aiOpen ? 'ai' : '',
    activeAiChatId ?? '',
    browserTask ? `${browserTask.status}:${browserTask.workspace}` : '',
    curView,
  ].join('|');
  useLayoutEffect(() => {
    const bar = topbarRef.current;
    if (!bar) return;
    const place = (): void => { applyTopbarCapsulePlacement(bar); };
    place();
    const right = bar.querySelector('.tb-right');
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    if (right) observer.observe(right);
    return () => observer.disconnect();
  }, [topbarCapsuleKey]);

  return (
    <div className={'win bot-shell' + (aiOpen ? ' bot-assistant-open' : '') + (curWb === configurationBotSeed.workspaceId ? ' business-workbench' : '')} data-workspace-hidden={workspaceHidden || undefined} data-assistant-mode={assistantMode} data-workbench={curWb} data-nav-expanded={navExpanded} style={{ '--ai-width': aiWidth + 'px' } as CSSProperties}>
      <aside id="workbench-navigation" className="rail" ref={railRef} aria-label="工作台导航">
        <span className="rail-selection" ref={railSelectionRef} aria-hidden="true" />
        <div className="rail-nav-shell"><nav className="rail-nav" aria-label="工作台" onScroll={() => setRailMenu(null)}>
          {NAV.filter((w) => w.id !== 'settings' && (!w.railHidden || w.id === 'home')).map(renderRailWorkbench)}
        </nav></div>
        <div className="rbot">
          {renderRailWorkbench(workbenchById('settings'))}
        </div>
      </aside>
      <div className="main">
      <header className="topbar" ref={topbarRef}>
        <div className="tb-brand">
        <div className="logo" title="CMO工作台">
          <LogoMark />
        </div>
        <button type="button" className="ibtn nav-toggle" title={navExpanded ? '收起导航' : '展开导航'} aria-label={navExpanded ? '收起导航' : '展开导航'}
          aria-expanded={navExpanded} aria-controls="workbench-navigation" onClick={() => { setRailMenu(null); setNavExpanded(value => !value); }}>
          <SidebarSimple size={20} />
        </button>
        </div>
        <div className="tb-middle">
        <div className="tb-left">
        <button className="sched" type="button" aria-label="今日日程面板" aria-describedby="topbar-schedule-preview"
          aria-expanded={islandPop === 'sched'} aria-controls="topbar-day-panel" onClick={() => toggleIslandPop('sched')}>
          <span className="sched-label">
            <IconCalendar />
            <span className="lbl">日程</span>
          </span>
          <span className="sdiv" />
          <span className="sched-track" id="topbar-schedule-preview">
            <span className="date">{todo.clock.getMonth() + 1}月{todo.clock.getDate()}日 {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][todo.clock.getDay()]}</span>
            <span className="sdiv" />
            {todayMeetings.length === 0 && (
              <span className="sched-none">无日程</span>
            )}
            {todayMeetings.map((t) => {
              const start = t.dateAt ? Date.parse(t.dateAt) : null;
              const end = start !== null && Number.isFinite(start) ? meetingEndAt(t) : null;
              const live = start !== null && end ? start <= todo.clock.getTime() && Date.parse(end) > todo.clock.getTime() : false;
              return (
                <span key={t.id} className={live ? 'schip now' : 'schip'} title={t.title}>
                  {live && <span className="live" />}
                  <span className="n">{t.title}</span>
                  <span className="t">{topbarScheduleDate(t, todo.clock)}</span>
                </span>
              );
            })}
          </span>
          <span className="pill-caret" aria-hidden="true"><IconChevronDown size={12} /></span>
        </button>
      </div>

      <div className="tb-center">
        <button className="todopill glass" title="今日待办" data-overdue={overdueCount > 0 || undefined} aria-expanded={islandPop === 'todo'} aria-controls="topbar-day-panel" onClick={() => toggleIslandPop('todo')}>
          <IconCheckSquare />
          <span className="lbl">待办</span>
          <span className="sdiv" />
          <span className="num">{doneCount}/{totalCount}</span>
          {overdueCount > 0 && <span className="pill-badge">逾期 {overdueCount}</span>}
          <span className="pill-caret"><IconChevronDown size={12} /></span>
        </button>
      </div>
        {islandPop && (
        <div id="topbar-day-panel" className={'ipop ipop-' + islandPop} role="region" aria-label={islandPop === 'sched' ? '今日日程' : '今日待办'}>
          <div className="ipop-head">
            <span>{islandPop === 'sched' ? '今日日程' : '今日待办'}</span>
            <span className="ipop-count">
              {islandPop === 'todo' && overdueCount > 0 && <span className="pill-badge">逾期 {overdueCount}</span>}
              <span>{islandPop === 'sched' ? todaySchedule.length : openTodos.length} 项</span>
            </span>
          </div>
          {islandPop === 'sched' ? <>
            {todaySchedule.length === 0 && <div className="ipop-empty">今天没有日程。</div>}
            {todaySchedule.map((t) => (
              <div key={t.id} className={t.status === 'done' ? 'ipop-row done' : 'ipop-row'}>
                <button className="ipop-title" title={t.title} onClick={() => openTaskEditor(t)}>{t.title}</button>
                <span className="ipop-time">{topbarScheduleDate(t, todo.clock)}</span>
              </div>
            ))}
          </> : <>
            {openTodos.length === 0 && <div className="ipop-empty">今天没有待办,点下方新增。</div>}
            {openTodos.map((t) => (
              <div key={t.id} className="ipop-row">
                <button
                  className={t.status === 'done' ? 'ipop-check done' : 'ipop-check'}
                  title={t.status === 'done' ? '恢复待办' : '完成'}
                  onClick={() => todo.mutate(() => window.workbench.todo.update(t.id, { status: t.status === 'done' ? 'todo' : 'done' }, t.updatedAt))}
                >
                  {t.status === 'done' ? '✓' : ''}
                </button>
                <button className="ipop-title" title={t.title} onClick={() => openTaskEditor(t)}>{t.title}</button>
                <span className="ipop-time">{topbarTodoDate(t, todo.clock)}</span>
              </div>
            ))}
          </>}
          <div className="ipop-foot">
            {islandPop === 'sched'
              ? <button className="ipop-link" onClick={() => openTopbarTaskCreator('meeting')}>+ 新增日程</button>
              : <button className="ipop-link" onClick={() => openTopbarTaskCreator('task')}>+ 新增待办</button>}
          </div>
        </div>
        )}
        </div>

      <div className="tb-right">
        <div className="tb-tools">
        {w3Uid !== null && !w3Uid.trim() && <button className="ai-job-btn w3-reminder-btn" title="未设置 W3 账号，点击前往「W3和Welink接入」维护" aria-label="未设置 W3 账号，点击维护" onClick={() => switchView('settings-welink')}><span className="w3-reminder-full" aria-hidden="true">未设置 W3 账号,点击维护</span><span className="w3-reminder-short" aria-hidden="true">W3</span></button>}
        {aiJob && (!aiOpen || aiJob.chatId !== activeAiChatId) && <button className="ai-job-btn" title="返回生成的对话" onClick={returnToAiJob}>助手{aiJob.status === 'running' ? '生成中' : aiJob.status === 'error' ? '请求失败' : '已完成'}</button>}
        {browserTask && ['running', 'paused', 'site-approval'].includes(browserTask.status) && (() => { const viewMap: Record<string, ViewId> = { [PERMISSION_QUERY_WORKSPACE]: 'permission-query', [PERMISSION_GROUPS_WORKSPACE]: 'permission-groups', [PBI_FEATURES_WORKSPACE]: 'pbi-features', [PBI_MODULES_WORKSPACE]: 'pbi-modules' }; const taskView = viewMap[browserTask.workspace] ?? 'browser'; return curView !== taskView ? <button className="ai-job-btn" title="返回浏览器任务" onClick={() => switchView(taskView)}>{browserTask.status === 'site-approval' ? '浏览器等待站点授权' : browserTask.status === 'paused' ? '浏览器已暂停' : '浏览器后台操作中'}</button> : null; })()}
        <TopbarUpdate onOpen={() => setIslandPop(null)} />
        <button className="ibtn float-topbar-btn" title={floatVisible ? '隐藏桌面灵动岛' : '打开桌面灵动岛'} aria-label={floatVisible ? '隐藏桌面灵动岛' : '打开桌面灵动岛'} aria-pressed={floatVisible} onClick={() => { setIslandPop(null); void window.workbench.float.toggle().catch(e => showToast(errorText(e))); }}><span className="topbar-mascot-icon" aria-hidden="true"><IslandMascot /></span></button>
        <Select className={`ai-topbar-mode${aiOpen ? ' is-open' : ''}${backgroundAiRunning ? ' has-running' : ''}`} menuClassName="ai-topbar-mode-menu" triggerClassName="ai-topbar-btn" triggerRef={aiTrigger} triggerContent={<Sparkle size={18} weight={aiOpen || backgroundAiRunning ? 'fill' : 'regular'} />} title={aiModeLabel} aria-label="AI 助手" value={aiOpen ? assistantMode : 'hidden'} options={[{ value: 'parallel', label: BOT_MODE_LABELS.parallel }, { value: 'floating', label: BOT_MODE_LABELS.floating }, { value: 'hidden', label: '收起助手' }]}
          renderOption={option => <span className="ai-mode-option-label">
            {option.value !== 'hidden' && <svg className="ai-mode-diagram" width="24" height="18" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="1" y="1" width="22" height="16" rx="2.5" />
              {option.value === 'parallel' ? <>
                <path d="M9 1v16" />
                <path d="M4 5h2M4 8h2M12 5h7M12 8h5" />
              </> : <>
                <path d="M5 5h14M5 8h9" />
                <rect x="6" y="11" width="12" height="3.5" rx="1.75" fill="currentColor" fillOpacity=".12" />
              </>}
            </svg>}
            {option.label}
          </span>}
          onOpenChange={setAiMenuOpen} onChange={value => { if (value === 'hidden') setAiOpen(false); else { selectAssistantMode(value as BotAssistantMode); setAiOpen(true); } }} />
        <AiSetupHint trigger={aiTrigger} active={!aiMenuOpen} onConfigure={() => switchView('settings-ai')} />
        <span className="vdiv" />
        <button type="button" className="avatar" data-avatar-color={profileAvatarColor} title={profileName} aria-label={`打开个人资料：${profileName}`} onClick={() => switchView('settings-profile')}>
          {profileName.trim().charAt(0).toUpperCase() || 'O'}
        </button>

        </div>
        <span className="vdiv window-divider" />
        <div className="wbtns">
          <button className="wbtn" title="最小化" onClick={() => window.workbench.minimize()}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button className="wbtn" title={maximized ? '还原' : '最大化'} onClick={() => window.workbench.maximizeToggle()}>
            {maximized ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M5 16V6a1 1 0 0 1 1-1h10" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            )}
          </button>
          <button className="wbtn close" title="关闭" onClick={() => window.workbench.close()}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>
      </header>

      <div id="bot-workspace" className="body bot-workspace" inert={workspaceHidden} aria-hidden={workspaceHidden || undefined}>
      <header className="bot-workspace-header" data-dashboard={showDashboardHeader || undefined}><div className="bot-workspace-title" ref={setWorkspaceHeader}>
        {!showDashboardHeader && <h2>工作台</h2>}
        {curWb === configurationBotSeed.workspaceId && configurationSectionForView(curView) && !artifactPreview && <Segmented aria-label="配置管理工作台视图" variant="content"
          value={configurationSectionForView(curView)?.id ?? configurationBotSeed.workspaceId} options={configurationTabs} onChange={selectConfigurationSection} />}
      </div></header>
      {botError && <div className="bot-error" role="alert">{botError}<button onClick={() => void readBots()}>重新连接</button></div>}
      {artifactError && <div className="bot-error bot-artifact-error" role="alert">{artifactError}<button onClick={() => setArtifactError('')}>关闭提示</button></div>}
      {artifactPreview && <section className="bot-artifact-preview" aria-label="交付件预览"><header><div><h3>{artifactPreview.title}</h3><span>{bots.find(bot => bot.id === artifactPreview.producerBotId)?.name}生成 · {new Date(artifactPreview.createdAt).toLocaleString('zh-CN')}</span></div>{artifactPreview.resource.kind !== 'artifact' && <button className="bot-text-button" onClick={() => openBotResource(artifactPreview.resource)}>打开原件</button>}<IconButton label="关闭交付件预览" onClick={() => setArtifactPreview(null)}><X size={19} /></IconButton></header>{artifactPreview.content ? <AiResponse entry={{ id: artifactPreview.id, role: 'assistant', content: artifactPreview.content }} /> : <p className="bot-empty">这是工作区原件的引用。打开原件查看当前内容。</p>}</section>}


      <div className="body bot-native-workspace" inert={!!artifactPreview} aria-hidden={!!artifactPreview || undefined}>


      {/* 主区 */}
      <BrowserTabTargetContext.Provider value={browserTabTarget}><main className="content" ref={contentRef} tabIndex={-1}>
          {todo.error && <div className="todo-load-error" role="alert">{todo.error}</div>}
          {/* 视图切换动效:按 curView 换 key 重挂载，仅淡入以保持页框对齐(见 shell.css .view-fade) */}
          {(isPlanningWorkbench || !['browser', 'permission-query', 'permission-groups', 'pbi-features', 'pbi-modules'].includes(curView)) && <div className="view-fade" key={curView}>
          {isPlanningWorkbench ? (
            <section className="pending-workbench" role="status">
              <span className="pending-workbench-icon" aria-hidden="true"><ActiveWorkbenchIcon /></span>
              <h1>{activeWorkbench.title}</h1>
              <p>规划中 · 敬请期待</p>
            </section>
          ) : curView === 'reading' ? (
            <ReadingView onPending={showToast} onAskAI={(prompt, bookId) => askAI(prompt, { module: 'reading', profileId: bookId })} onCurrentBook={setReadingCtx} />
          ) : curView === 'delivery-projects' ? (
            <DeliveryProjects />
          ) : curView === 'dts-query' ? (
            <DtsQuery />
          ) : curView === 'office' ? (
            <OfficeView workspaceHeader={artifactPreview ? null : workspaceHeader} settingsOpen={!!settingsView} sourceRequest={officeSource} onSettings={() => switchView('settings-welink')}
              onMeeting={openOfficeTask} onTask={openOfficeTask} onAnalyze={analyzeOffice}
              onPrepared={() => {
                setAiOpen(true); setWorkspaceCollapsed(false);
                setBotPage({ value: 'chat', nonce: ++seedNonce.current });
              }} />
          ) : curView === 'todo' ? (
            todo.data ? <TodoView data={todo.data} clock={todo.clock} mutate={todo.mutate} editor={todoEditor} setEditor={setTodoEditor} editHandle={todoEditHandle}
              workspaceHeader={artifactPreview ? null : workspaceHeader}
              onRecordMeeting={task => setMeetingTool({ kind: 'record', task })} onRooms={() => setMeetingTool({ kind: 'rooms' })}
              onPrepareMeeting={task => { void window.workbench.officeWorkbench.meetingSource(task.id).then(sourceId => analyzeOffice({ kind: 'prep', sourceId }, `整理「${task.title}」会前材料`), error => showToast(errorText(error))); }} /> : <div className="todo-loading" role="status">正在读取本地待办…</div>
          ) : todo.data ? (
            <HomeView workspaceHeader={showDashboardHeader ? workspaceHeader : null} data={todo.data} clock={todo.clock} userName={profileName} onPending={showToast} onNavigate={switchView} />
          ) : (
            <div className="todo-loading" role="status">正在读取本地待办…</div>
          )}
          </div>}
          <BrowserHost active={!isPlanningWorkbench && curView === 'browser'} focusTarget={contentRef} onPending={showToast} />
          <BrowserPageHost active={!isPlanningWorkbench && isPermissionPage} focusTarget={contentRef} onPending={showToast}
            workspace={PERMISSION_BROWSER_WORKSPACE} defaultTabs={PERMISSION_BROWSER_TABS} activeWorkspace={isPermissionPage ? permissionRequest : undefined}
            onActiveWorkspaceChange={onPermissionWorkspaceChange} label="权限管理" slogan="权限查询与群组创建" />
          <BrowserPageHost active={!isPlanningWorkbench && isPbiPage} focusTarget={contentRef} onPending={showToast}
            workspace={PBI_BROWSER_WORKSPACE} defaultTabs={PBI_BROWSER_TABS} activeWorkspace={isPbiPage ? pbiRequest : undefined}
            onActiveWorkspaceChange={onPbiWorkspaceChange} label="PBI系统" slogan="特性管理与子系统&模块" />
        </main></BrowserTabTargetContext.Provider>

      </div>
      </div>
      </div>
      {topbarEditorKind ? <TaskEditor key={topbarEditorKind} initialKind={topbarEditorKind} categories={todo.data?.categories ?? []} api={topbarTaskEditorApi}
        changed={(state) => todo.mutate(async () => state)} saved={(state) => todo.mutate(async () => state)} close={() => setTopbarEditorKind(null)} /> : null}
      {aiOpen && activeBot && assistantMode === 'parallel' && !workspaceHidden && <IconButton className="bot-workspace-toggle" label="收起工作台" aria-controls="bot-workspace" aria-expanded={true} onClick={() => { botPanel.current?.prepareWorkspaceResize(); setWorkspaceCollapsed(true); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.bot-identity-pill')?.focus()); }}><SidebarSimple size={18} mirrored /></IconButton>}
      {activeBot && <BotPanel key={`panel-${activeBot.id}`} ref={botPanel} bot={activeBot} cards={bots} open={aiOpen} mode={assistantMode} onMode={selectAssistantMode} onClose={() => setAiOpen(false)} context={aiContext} seed={aiSeed} onSeedFinished={nonce => setAiSeed(previous => previous?.nonce === nonce ? null : previous)} onActiveChatChange={setActiveAiChatId} onOpenSettings={() => switchView('settings-ai')} onOpenResource={openBotResource} onOpenTodo={openTodoTarget} onOpenBrowser={openBrowserTask} onOpenDashboard={() => switchView('home')} onOpenOfficeSource={source => { switchView('office'); setOfficeSource({ source, nonce: ++seedNonce.current }); }} onSelectBot={id => { const selected = bots.find(bot => bot.id === id); if (selected) activate(selected.workspaceId, { keepLayout: true }); }} workspaceHidden={workspaceHidden} onOpenWorkspace={() => setWorkspaceCollapsed(false)} initialPage={botPage} initialProfileTab={botPage ? undefined : initialProfileTab} width={aiWidth} widthLimit={aiWidthLimit} onWidthChange={resizeAiWidth} />}
      {botMenu && <BotContactMenu x={botMenu.x} y={botMenu.y} anchor={botMenu.anchor} close={() => setBotMenu(undefined)} edit={() => editBot(botMenu.card)} />}
      <MeetingCompanion open={meetingTool?.kind === 'record'} task={meetingTool?.kind === 'record' ? meetingTool.task : undefined}
        close={() => setMeetingTool(undefined)} onTask={id => { setMeetingTool(undefined); openOfficeTask(id); }} />
      {meetingTool?.kind === 'rooms' && <RoomBooking close={() => setMeetingTool(undefined)} />}
      {settingsView && <SettingsDialog view={settingsView} onNavigate={switchView} close={() => setSettingsView(null)} appearance={appearance} onAvatarColorChange={setProfileAvatarColor}
        botManagement={<BotManagement />} />}
      <div className="toast glass" data-show={toast ? '1' : '0'}>{toast}</div>
    </div>
  );
}
