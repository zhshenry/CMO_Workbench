import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { SidebarSimple, Sparkle } from '@phosphor-icons/react';
import { NAV, defaultViewOfWorkbench, ownerOfWorkbench, resolveView, workbenchById, type WorkbenchDef, type WorkbenchId } from './nav';
import type { AvatarColor, UiTheme, ViewId } from '../shared/contracts';
import { localDay, openToday, taskTime, type Task, type TaskInput } from '../shared/todo-contracts';
import { isOverdue, meetingEndAt } from '../shared/todo-format';
import { topbarScheduleDate, topbarTodoDate } from './topbar-dates';
import { applyTopbarCapsulePlacement } from './topbar-layout';
import { errorText } from './ui/controls';
import { IslandMascot } from './ui/IslandMascot';
import { HomeView, useTodoData } from './views/HomeView';
import { AiPanel, type AiPanelContext, type AiSeed } from './views/AiPanel';
import { chatContextScope, type AiScope } from '../shared/ai-scope';
import { pageAiContext } from './ai-page-context';
import { SettingsDialog } from './views/SettingsDialog';
import { TopbarUpdate } from './views/TopbarUpdate';
import { TaskEditor, type TaskEditorApi } from '../modules/todo/ui/TaskEditor';
import { BrowserHost } from './views/BrowserView';
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

export function App() {
  const [curWb, setCurWb] = useState<WorkbenchId>('home');
  const [railBranch, setRailBranch] = useState<WorkbenchId>('home');
  const [navExpanded, setNavExpanded] = useState(() => localStorage.getItem('wb.nav.expanded') === '1');
  const railRef = useRef<HTMLElement>(null);
  const railSelectionRef = useRef<HTMLSpanElement>(null);
  const railSelectionGlow = useRef<Animation | null>(null);
  const lastRailWorkbench = useRef<WorkbenchId | null>(null);
  const railMenuRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [curView, setCurView] = useState<ViewId>('home');
  const [settingsView, setSettingsView] = useState<ViewId | null>(null);
  const permissionView = useRef<ViewId>('permission-query');
  const [permissionRequest, setPermissionRequest] = useState<string>();
  const isPermissionPage = curView === 'permission-query' || curView === 'permission-groups';
  const onPermissionWorkspaceChange = useCallback((workspace: string) => {
    if (workspace !== 'permission-query' && workspace !== 'permission-groups') return;
    permissionView.current = workspace;
    setPermissionRequest(undefined);
    setCurView(previous => previous === 'permission-query' || previous === 'permission-groups' ? workspace : previous);
  }, []);
  const pbiView = useRef<ViewId>('pbi-features');
  const [pbiRequest, setPbiRequest] = useState<string>();
  const isPbiPage = curView === 'pbi-features' || curView === 'pbi-modules';
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
  const [homeEditor, setHomeEditor] = useState<Task | 'new' | null>(null);
  const [topbarEditorKind, setTopbarEditorKind] = useState<TaskInput['kind'] | null>(null);
  const [islandPop, setIslandPop] = useState<null | 'sched' | 'todo'>(null);
  const [floatVisible, setFloatVisible] = useState(false);
  // 界面主题(mist 默认,cool / warm 可选),写入 <html data-theme> 驱动 shell.css
  const [uiTheme, setUiTheme] = useState<UiTheme>('mist');
  const applyUiTheme = (theme: UiTheme): void => {
    document.documentElement.dataset.theme = theme;
    setUiTheme(theme);
  };
  // 个人资料昵称(设置 → 个人资料):头像首字与首页问候共用,直接从应用设置读取
  const [profileName, setProfileName] = useState('Ono');
  const [profileAvatarColor, setProfileAvatarColor] = useState<AvatarColor>('blue');
  // W3 账号是否已维护:null=未加载(IPC 返回前不渲染,避免误闪提醒),''=已加载未设置(显示提醒),非空=已设置(#8)
  const [w3Uid, setW3Uid] = useState<string | null>(null);

  useEffect(() => {
    void window.workbench.settings.get().then(
      (s) => {
        if (s) {
          applyUiTheme(s.uiTheme);
          setProfileName(s.profile.name);
          setProfileAvatarColor(s.profile.avatarColor);
          setW3Uid(s.w3Uid ?? '');
        }
      },
      () => undefined,
    );
  }, []);

  const [aiOpen, setAiOpen] = useState(() => localStorage.getItem('wb.ai.open') !== '0');
  const [aiWidth, setAiWidth] = useState(() => Math.max(340, Math.min(480, Number(localStorage.getItem('wb.ai.width')) || 380)));
  const [railMenu, setRailMenu] = useState<WorkbenchId | null>(null);
  const dismissedRailMenu = useRef<WorkbenchId | null>(null);
  const [aiJobs, setAiJobs] = useState<{ chatId: string; scope: AiScope; title: string; status: 'running' | 'done' | 'error' }[]>([]);
  const [browserTasks, setBrowserTasks] = useState<BrowserTask[]>([]);
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
  useEffect(() => { localStorage.setItem('wb.ai.width', String(aiWidth)); }, [aiWidth]);
  useEffect(() => { localStorage.setItem('wb.nav.expanded', navExpanded ? '1' : '0'); }, [navExpanded]);
  // 关闭设置后刷新主界面的账号与个人资料展示。
  useEffect(() => {
    if (settingsView) return;
    void window.workbench.settings.get().then((s) => {
      if (s) { setW3Uid(s.w3Uid ?? ''); setProfileName(s.profile.name); setProfileAvatarColor(s.profile.avatarColor); }
    }, () => undefined);
  }, [curView, settingsView]);
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

  const askAI = (prompt: string, scope: AiScope = aiContext.scope): void => {
    const requestScope = scope;
    void window.workbench.ai.config().then((raw) => {
      const cfg = raw as { aiEnabled?: boolean };
      if (!cfg.aiEnabled) {
        showToast('请先在 AI 设置中配置并启用 AI');
        return;
      }
      setAiOpen(true);
      setAiSeed({ text: prompt, nonce: ++seedNonce.current, scope: requestScope });
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
  const openTopbarTaskCreator = (kind: TaskInput['kind']): void => {
    setIslandPop(null);
    setTopbarEditorKind(kind);
  };
  const openTaskEditor = (t: Task): void => {
    setHomeEditor(t);
    switchView('home');
    setIslandPop(null);
  };
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
        topbarRef.current?.querySelector<HTMLButtonElement>(islandPop === 'sched' ? '.smore' : '.todopill')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [islandPop]);

  const activate = (id: WorkbenchId): void => {
    dismissedRailMenu.current = null;
    setRailMenu(!navExpanded && id !== 'home' && id !== 'permission' && id !== 'delivery' && id !== 'pbi' && id !== 'dts' && id !== 'settings' && workbenchById(id).subs.some(sub => !sub.navHidden) ? id : null);
    setSettingsView(null);
    if (id !== curWb) {
      // 内容区渲染跟随 curView:切工作台必须同步落位,否则停留在上一个工作台的页面
      setCurView(id === 'permission' ? permissionView.current : id === 'pbi' ? pbiView.current : defaultViewOfWorkbench(id));
      setCurWb(id);
    }
  };

  const switchView = (view: ViewId): void => {
    view = resolveView(view);
    setRailMenu(null);
    if (view.startsWith('settings')) {
      setIslandPop(null);
      setSettingsView(view);
      return;
    }
    setSettingsView(null);
    if (view === 'permission-query' || view === 'permission-groups') { permissionView.current = view; setPermissionRequest(view); }
    if (view === 'pbi-features' || view === 'pbi-modules') { pbiView.current = view; setPbiRequest(view); }
    setCurView(view);
    const owner = ownerOfWorkbench(view);
    if (owner) setCurWb(owner);
  };

  // 内嵌浏览器 SSO 提示条「去保存」→ 切到 设置 → W3接入
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
    switchView(target.view);
    if (target.taskId) void window.workbench.todo.state().then(data => {
      const task = data.tasks.find(t => t.id === target.taskId && !t.deletedAt);
      if (task) setHomeEditor(task);
    }).catch(error => showToast(errorText(error)));
    if (target.section) {
      sessionStorage.setItem('island-settings-section', target.section);
      window.dispatchEvent(new CustomEvent('island-settings-section', { detail: target.section }));
    }
  }));

  const activeWorkbench = workbenchById(curWb);
  const ActiveWorkbenchIcon = WB_ICONS[curWb];
  const isPlanningWorkbench = activeWorkbench.pending === true || (
    activeWorkbench.subs.length > 0 && activeWorkbench.subs.every((sub) => sub.pending === true)
  );
  const backgroundAiRunning = aiJob?.status === 'running' && (!aiOpen || aiJob.chatId !== activeAiChatId);
  const aiToggleLabel = `${aiOpen ? '收起' : '展开'} AI 助手${backgroundAiRunning ? '，有对话正在后台生成' : ''}`;

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

  const renderRailWorkbench = (workbench: WorkbenchDef) => {
    const Icon = WB_ICONS[workbench.id];
    const subs = workbench.subs.filter(sub => !sub.navHidden);
    const hasBranch = workbench.id !== 'home' && workbench.id !== 'permission' && workbench.id !== 'delivery' && workbench.id !== 'pbi' && workbench.id !== 'dts' && workbench.id !== 'settings' && subs.length > 0;
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
          onClick={() => workbench.id === 'settings' ? switchView('settings-general') : activate(workbench.id)}
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

  // 顶栏胶囊:今日待办统计与今日日程(真数据,与 To-Do-List 同库)
  const today = localDay(todo.clock);
  const todayMeetings = (todo.data?.tasks ?? [])
    .filter((t) => !t.deletedAt && t.kind === 'meeting' && t.status !== 'done' && t.plannedDate <= today)
    .sort((a, b) => taskTime(a) - taskTime(b))
    .slice(0, 4);
  const openTodos = todo.data ? openToday(todo.data.tasks, today).filter(t => t.kind === 'task') : [];
  const openCount = openTodos.length;
  const doneCount = todo.data
    ? todo.data.tasks.filter((t) => !t.deletedAt && t.kind === 'task' && t.status === 'done' && t.completedAt && localDay(new Date(t.completedAt)) === today).length
    : 0;
  const totalCount = openCount + doneCount;
  const todaySchedule = (todo.data?.tasks ?? [])
    .filter((t) => !t.deletedAt && t.kind === 'meeting' && t.plannedDate <= today)
    .sort((a, b) => taskTime(a) - taskTime(b));
  const overdueCount = openTodos.filter((t) => isOverdue(t, todo.clock.getTime())).length;
  const topbarCapsuleKey = [
    todayMeetings.map((t) => `${t.id}:${t.title}:${t.dueAt ?? ''}:${t.endAt ?? ''}:${t.status}`).join(','),
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
    <div className={'win' + (aiOpen ? ' ai-dock' : '') + (['permission', 'delivery', 'pbi', 'dts'].includes(curWb) ? ' business-workbench' : '')} data-workbench={curWb} data-nav-expanded={navExpanded} style={{ '--ai-width': aiWidth + 'px' } as CSSProperties}>
      <aside id="workbench-navigation" className="rail" ref={railRef} aria-label="工作台导航">
        <span className="rail-selection" ref={railSelectionRef} aria-hidden="true" />
        <nav className="rail-nav" aria-label="工作台" onScroll={() => setRailMenu(null)}>
          {NAV.filter((w) => w.id !== 'settings' && !w.railHidden).map(renderRailWorkbench)}
        </nav>
        <div className="rbot">
          {renderRailWorkbench(workbenchById('settings'))}
        </div>
      </aside>
      <div className="main">
      <header className="topbar" ref={topbarRef}>
        <div className="logo" title="CMO工作台">
          <LogoMark />
        </div>
        <button type="button" className="ibtn nav-toggle" title={navExpanded ? '收起导航' : '展开导航'} aria-label={navExpanded ? '收起导航' : '展开导航'}
          aria-expanded={navExpanded} aria-controls="workbench-navigation" onClick={() => { setRailMenu(null); setNavExpanded(value => !value); }}>
          <SidebarSimple size={20} />
        </button>
        <div className="tb-middle">
        <div className="tb-left">
        <div className="sched" data-open={islandPop === 'sched' || undefined} onClick={() => toggleIslandPop('sched')}>
          <span className="sched-label">
            <IconCalendar />
            <span className="lbl">日程</span>
          </span>
          <span className="sdiv" />
          <div className="sched-track">
            <span className="date">{todo.clock.getMonth() + 1}月{todo.clock.getDate()}日 {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][todo.clock.getDay()]}</span>
            <span className="sdiv" />
            {todayMeetings.length === 0 && (
              <span className="sched-none">无日程</span>
            )}
            {todayMeetings.map((t) => {
              const start = t.dueAt ? Date.parse(t.dueAt) : null;
              const end = start !== null && Number.isFinite(start) ? meetingEndAt(t) : null;
              const live = start !== null && end ? start <= todo.clock.getTime() && Date.parse(end) > todo.clock.getTime() : false;
              return (
                <button key={t.id} className={live ? 'schip now' : 'schip'} title={t.title} onClick={(e) => { e.stopPropagation(); openTaskEditor(t); }}>
                  {live && <span className="live" />}
                  <span className="t">{topbarScheduleDate(t, todo.clock)}</span>
                  <span className="n">{t.title}</span>
                </button>
              );
            })}
          </div>
          <button className="smore" title="今日日程面板" aria-expanded={islandPop === 'sched'} aria-controls="topbar-day-panel" onClick={(e) => { e.stopPropagation(); toggleIslandPop('sched'); }}>
            <IconChevronDown size={12} />
          </button>
        </div>
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
        {w3Uid !== null && !w3Uid.trim() && <button className="ai-job-btn w3-reminder-btn" title="未设置 W3 账号，点击前往「W3接入」维护" onClick={() => switchView('settings-welink')}>未设置 W3 账号,点击维护</button>}
        {aiJob && (!aiOpen || aiJob.chatId !== activeAiChatId) && <button className="ai-job-btn" title="返回生成的对话" onClick={returnToAiJob}>助手{aiJob.status === 'running' ? '生成中' : aiJob.status === 'error' ? '请求失败' : '已完成'}</button>}
        {browserTask && ['running', 'paused', 'site-approval'].includes(browserTask.status) && (() => { const viewMap: Record<string, ViewId> = { [PERMISSION_QUERY_WORKSPACE]: 'permission-query', [PERMISSION_GROUPS_WORKSPACE]: 'permission-groups', [PBI_FEATURES_WORKSPACE]: 'pbi-features', [PBI_MODULES_WORKSPACE]: 'pbi-modules' }; const taskView = viewMap[browserTask.workspace] ?? 'browser'; return curView !== taskView ? <button className="ai-job-btn" title="返回浏览器任务" onClick={() => switchView(taskView)}>{browserTask.status === 'site-approval' ? '浏览器等待站点授权' : browserTask.status === 'paused' ? '浏览器已暂停' : '浏览器后台操作中'}</button> : null; })()}
        <TopbarUpdate onOpen={() => setIslandPop(null)} />
        <button className="ibtn float-topbar-btn" title={floatVisible ? '隐藏桌面灵动岛' : '打开桌面灵动岛'} aria-label={floatVisible ? '隐藏桌面灵动岛' : '打开桌面灵动岛'} aria-pressed={floatVisible} onClick={() => { setIslandPop(null); void window.workbench.float.toggle().catch(e => showToast(errorText(e))); }}><span className="topbar-mascot-icon" aria-hidden="true"><IslandMascot /></span></button>
        <button className="ibtn ai-topbar-btn" title={aiToggleLabel} aria-label={aiToggleLabel} aria-expanded={aiOpen} aria-controls="workbench-ai-panel" data-background-running={backgroundAiRunning || undefined} onClick={() => setAiOpen(v => !v)}><Sparkle size={18} weight={aiOpen || backgroundAiRunning ? 'fill' : 'regular'} /></button>
        <span className="vdiv" />
        <button type="button" className="avatar" data-avatar-color={profileAvatarColor} title={profileName} aria-label={`打开个人资料：${profileName}`} onClick={() => switchView('settings-profile')}>
          {profileName.trim().charAt(0).toUpperCase() || 'O'}
        </button>

        <span className="vdiv" />
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

      <div className="body">


      <div className="body">


      {/* 主区 */}
      <main className="content" ref={contentRef} tabIndex={-1}>
          {todo.error && <div className="todo-load-error" role="alert">{todo.error}</div>}
          {/* 视图切换动效:按 curView 换 key 重挂载,统一淡入上移(见 shell.css .view-fade) */}
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
          ) : todo.data ? (
            <HomeView data={todo.data} clock={todo.clock} mutate={todo.mutate} userName={profileName} onPending={showToast} editor={homeEditor} setEditor={setHomeEditor} onAskAi={askAI} />
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
            onActiveWorkspaceChange={onPbiWorkspaceChange} label="PBI管理" slogan="特性管理与子系统&模块" />
        </main>

      </div>
      </div>
      </div>
      {topbarEditorKind ? <TaskEditor key={topbarEditorKind} initialKind={topbarEditorKind} categories={todo.data?.categories ?? []} api={topbarTaskEditorApi}
        changed={(state) => todo.mutate(async () => state)} saved={(state) => todo.mutate(async () => state)} close={() => setTopbarEditorKind(null)} /> : null}
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} seed={aiSeed} requestedChatId={requestedAiChatId} onChatLocated={() => setRequestedAiChatId(null)} onActiveChatChange={setActiveAiChatId} onOpenSettings={() => switchView('settings-ai')} onQuickAsk={(prompt, scope) => askAI(prompt, scope)} context={aiContext} plannedWorkbench={isPlanningWorkbench} width={aiWidth} onWidthChange={setAiWidth} />
      {settingsView && <SettingsDialog view={settingsView} onNavigate={switchView} close={() => setSettingsView(null)} uiTheme={uiTheme} onUiThemeChange={applyUiTheme} onAvatarColorChange={setProfileAvatarColor} />}
      <div className="toast glass" data-show={toast ? '1' : '0'}>{toast}</div>
    </div>
  );
}
