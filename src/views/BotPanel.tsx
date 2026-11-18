import { BotChatSynchronizer } from '../bot-chat-sync';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, CaretRight, CaretUp, DotsThree, Minus, Paperclip, PaperPlaneRight, Plus, Sparkle, Square, StarFour, X } from '@phosphor-icons/react';
import type { BotArtifact, BotCard, BotMessage, BotOpen, BotResourceRef, BotSubmit, BotTask } from '../../shared/bot-contracts';
import { browserWorkspaceForView } from '../../shared/browser-contracts';
import { isBotAmendment } from '../../shared/bot-input';
import type { AiTurnContext, AiReference } from '../../shared/ai-reference';
import type { ChatEntry, ChatSession } from '../../shared/todo-contracts';
import type { OfficeRef } from '../../shared/office-workbench';
import type { AiConfig } from '../../shared/workbench-api';
import { BotDraftController } from '../bot-draft';
import { groupBotProgress } from '../bot-progress';
import { playBotOpening } from '../bot-floating-motion';
import { errorText, IconButton } from '../ui/controls';
import type { AiPanelContext, AiSeed } from './AiPanel';
import { AiResponse } from './AiResponse';
import { AiReferencePicker, loadReferenceOptions, type ReferenceMode, type ReferenceOption } from './AiReferencePicker';
import { SpeechInput } from './SpeechInput';
import { BotAvatar } from './BotAvatar';
import { BotProfile, type InspectorTab } from './BotProfile';
import { botStatusLabel, BotChatActions, BotTaskDetail } from './BotTasks';
import { BotSchedules } from './BotSchedules';
import { BotArtifactsView } from './BotWorkViews';
import { BotActivity } from './BotActivity';
import { BotCollaborationCard, BotExchangeView, BotIncomingMessage, BotReceivedMessage } from './BotCollaboration';
import { BrowserSiteApprovalCard, useBrowserApprovalTasks } from '../../modules/browser/ui/site-approval';

export type BotAssistantMode = 'parallel' | 'floating';
export type BotPanelPage = 'chat' | 'tasks' | 'artifacts' | 'history' | 'schedules' | 'exchange' | 'profile';
type AmendmentChoice = { label: string; target: NonNullable<BotSubmit['target']> };
const wb = window.workbench;
const replyDateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const controllers = new Map<string, BotDraftController>();
const positions = new Map<string, { top: number; follow: boolean; start: number; end: number }>();
export function botDraft(chatId: string): BotDraftController { let controller = controllers.get(chatId); if (!controller) { controller = new BotDraftController(chatId, wb.bot); controllers.set(chatId, controller); } return controller; }
const asRef = (value: AiReference): BotResourceRef => ({ kind: value.module, id: value.module === 'todo' ? value.taskId : value.profileId });
const asAiRef = (value: BotResourceRef): AiReference | null => value.kind === 'todo' ? { module: 'todo', taskId: value.id } : value.kind === 'reading' ? { module: value.kind, profileId: value.id } : null;

export function BotPanel({ bot, cards, open, mode = 'parallel', onMode, context, seed, onSeedFinished, onOpenSettings, onActiveChatChange, onOpenResource, onOpenOfficeSource, onOpenWorkspace, onSelectBot, initialPage, width = 400, onWidthChange, copySaveState, island = false }: {
  bot: BotCard; cards: BotCard[]; open: boolean; mode?: BotAssistantMode; onMode?(mode: BotAssistantMode): void; onClose(): void;
  context: AiPanelContext; seed?: AiSeed | null; onSeedFinished?(nonce: number): void; onOpenSettings(): void; onActiveChatChange?(id: string): void;
  onOpenResource?(ref: BotResourceRef): void; onOpenWorkspace?(): void; onSelectBot?(id: string): void;
  onOpenOfficeSource?(ref: OfficeRef): void;
  initialPage?: { value: BotPanelPage; nonce: number; taskId?: string }; width?: number; onWidthChange?(width: number): void;
  copySaveState?: { id: string | null; status: 'saved' | 'saving' | 'error' }; island?: boolean;
}) {
  const draft = useMemo(() => botDraft(bot.mainChatId), [bot.mainChatId]);
  const [, render] = useState(0), [data, setData] = useState<BotOpen>(), [chat, setChat] = useState<ChatSession>(), [config, setConfig] = useState<AiConfig>();
  const [tasks, setTasks] = useState<BotTask[]>([]), [artifacts, setArtifacts] = useState<BotArtifact[]>([]), [page, setPage] = useState<BotPanelPage>('chat');
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  const [inspectorView, setInspectorView] = useState<{ tab: InspectorTab | 'activity'; open: boolean }>();
  const [activityStart, setActivityStart] = useState<{ key: number; taskId?: string; historyFirst?: boolean }>({ key: 0 });
  const inspector = inspectorView?.open ? inspectorView.tab : undefined;
  const inspectorPanel = useRef<HTMLElement>(null);
  const setInspector = useCallback((tab?: InspectorTab | 'activity') => {
    setInspectorView(view => {
      if (tab) return view?.open && view.tab === tab ? view : { tab, open: true };
      return view?.open ? { ...view, open: false } : view;
    });
  }, []);
  const openActivity = useCallback((taskId?: string, historyFirst = false) => {
    setActivityStart(last => ({ key: last.key + 1, taskId, historyFirst }));
    setInspector('activity'); setPage('chat'); setMenu(false); setCollapsed(false);
  }, [setInspector]);
  const [sourceTaskId, setSourceTaskId] = useState<string>();
  const badge = useRef<HTMLButtonElement>(null);
  const [artifactId, setArtifactId] = useState<string>();
  const [exchange, setExchange] = useState<Pick<BotMessage, 'id' | 'fromBotId' | 'toBotId'>>();
  const exchangeReturn = useRef<HTMLElement | null>(null);
  const [separateInput, setSeparateInput] = useState(false);
  const [amendmentTarget, setAmendmentTarget] = useState<AmendmentChoice>(), [amendmentChoices, setAmendmentChoices] = useState<AmendmentChoice[]>([]);
  useEffect(() => { setAmendmentTarget(undefined); setAmendmentChoices([]); setSeparateInput(false); }, [bot.id]);
  const artifactTaskReturn = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(true), [replyVisible, setReplyVisible] = useState(false), [menu, setMenu] = useState(false), [aboveBottom, setAboveBottom] = useState(false);
  const [motionPhase, setMotionPhase] = useState('closed');
  const [referencesOpen, setReferencesOpen] = useState(false), [referenceMode, setReferenceMode] = useState<ReferenceMode | null>(bot.seedKey === 'schedule' || bot.seedKey === 'coordinator' ? 'todo' : null);
  const [referenceOptions, setReferenceOptions] = useState<ReferenceOption[]>([]), [referenceLoading, setReferenceLoading] = useState(false), [referenceError, setReferenceError] = useState(''), [referenceReload, setReferenceReload] = useState(0), [speechBusy, setSpeechBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), composer = useRef<HTMLDivElement>(null), editor = useRef<HTMLTextAreaElement>(null), referenceTrigger = useRef<HTMLButtonElement>(null), approval = useRef<HTMLElement>(null), menuRef = useRef<HTMLDivElement>(null);
  const follow = useRef(positions.get(bot.mainChatId)?.follow ?? true), usedSeed = useRef<number | undefined>(undefined), submitBusy = useRef(false);
  const inputSurface = useRef<HTMLDivElement>(null), pill = useRef<HTMLButtonElement>(null), openingSnapshot = useRef(Promise.resolve(''));
  const motion = useRef<Animation | null>(null), wave = useRef(() => {}), motionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const panel = useRef<HTMLElement>(null), wasParallel = useRef(open && mode === 'parallel' && !island);
  const followChat = useCallback(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, []);
  const floating = mode === 'floating' && !island;
  useLayoutEffect(() => {
    const parallel = open && mode === 'parallel' && !island, entering = parallel && !wasParallel.current;
    wasParallel.current = parallel;
    const node = panel.current, media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!entering || !node || media.matches) return;
    // Use the parallel anchor immediately instead of sliding from the floating position.
    node.dataset.parallelEntering = 'true';
    const style = getComputedStyle(node), token = style.getPropertyValue('--rail-motion').trim();
    const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
    const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * .8, delay: duration * .2, easing: style.getPropertyValue('--ease').trim(), fill: 'backwards' });
    const finish = () => { animation.cancel(); delete node.dataset.parallelEntering; media.removeEventListener('change', finish); };
    animation.onfinish = finish;
    media.addEventListener('change', finish);
    return finish;
  }, [open, mode, island]);
  const clearMotion = () => { motion.current?.cancel(); wave.current(); motionTimers.current.forEach(clearTimeout); motionTimers.current = []; openingSnapshot.current = Promise.resolve(''); };
  const later = (job: () => void, delay: number) => { motionTimers.current.push(setTimeout(job, delay)); };
  const expandInput = () => {
    if (motionPhase === 'press' || motionPhase === 'opening') return;
    clearMotion(); follow.current = true;
    if (tasks.some(task => task.status === 'waiting_user')) setReplyVisible(true);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setCollapsed(false); setMotionPhase('open'); later(() => editor.current?.focus({ preventScroll: true }), 0); return; }
    openingSnapshot.current = wb.captureAssistantBackdrop?.().catch(() => '') ?? Promise.resolve('');
    setMotionPhase('press'); later(() => { setCollapsed(false); setMotionPhase('opening'); }, 90);
  };
  const collapseInput = () => {
    if (speechBusy || motionPhase === 'closing') return;
    clearMotion(); setMenu(false); setReplyVisible(false); setMotionPhase('closing');
    const node = inputSurface.current;
    const done = () => { setCollapsed(true); setMotionPhase('closed'); later(() => pill.current?.focus({ preventScroll: true }), 0); };
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    motion.current = node.animate([{ width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px`, borderRadius: '16px' }, { width: `${Math.min(300, node.offsetWidth)}px`, height: '44px', borderRadius: '22px' }], { duration: 320, easing: 'ease-in-out', fill: 'forwards' });
    later(done, 320);
  };
  useLayoutEffect(() => {
    if (!floating || collapsed || motionPhase !== 'opening' || !inputSurface.current) return;
    const node = inputSurface.current;
    if (editor.current) { editor.current.style.height = '0px'; editor.current.style.height = `${Math.min(98, Math.max(40, editor.current.scrollHeight))}px`; }
    const target = node.getBoundingClientRect(), protectedBounds = node.closest('.bot-panel')!.getBoundingClientRect();
    motion.current = node.animate(Array.from({ length: 31 }, (_, index) => { const t = index / 30, p = index === 30 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(6 * t); return { width: `${Math.min(300, target.width) + (target.width - Math.min(300, target.width)) * p}px`, height: `${44 + (target.height - 44) * p}px`, borderRadius: `${22 - 6 * p}px`, offset: t }; }), { duration: 580, easing: 'linear' });
    later(() => { wave.current = playBotOpening(node, openingSnapshot.current, protectedBounds); }, 40);
    later(() => editor.current?.focus({ preventScroll: true }), 190);
    later(() => setMotionPhase('open'), 580);
    later(() => { openingSnapshot.current = Promise.resolve(''); }, 1100);
  }, [collapsed, motionPhase, floating]);
  useEffect(() => { if (!open || !floating) { clearMotion(); setMotionPhase(collapsed ? 'closed' : 'open'); } return clearMotion; }, [open, floating]);
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => { if (!media.matches) return; clearMotion(); if (motionPhase === 'closing') setCollapsed(true); setMotionPhase(collapsed || motionPhase === 'closing' ? 'closed' : 'open'); }; media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [collapsed, motionPhase]);
  useLayoutEffect(() => { follow.current = floating || (positions.get(bot.mainChatId)?.follow ?? true); }, [floating, bot.mainChatId]);
  useEffect(() => { if (!open) return; return draft.attach(() => render(value => value + 1)); }, [draft, open]);
  useLayoutEffect(() => {
    if (!inspectorView || inspectorView.open) return;
    // A reversed transition must not unmount the reopened inspector.
    const unmount = () => setInspectorView(view => view === inspectorView ? undefined : view);
    const slide = inspectorPanel.current?.getAnimations().find(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'transform');
    if (slide) void slide.finished.then(unmount, unmount);
    else unmount();
  }, [inspectorView]);
  useEffect(() => { if (initialPage) {
    if (initialPage.value === 'tasks' || initialPage.value === 'history') { openActivity(initialPage.taskId, initialPage.value === 'history'); return; }
    const tab = initialPage.value === 'profile' ? 'details' : initialPage.value === 'artifacts' ? 'library' : undefined;
    setInspector(tab); setPage(tab ? 'chat' : initialPage.value); setCollapsed(false); setReplyVisible(true); } }, [initialPage, openActivity, setInspector]);
  useEffect(() => {
    let live = true, configUpdated = false, taskTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = new BotChatSynchronizer(bot.mainChatId, wb.bot, value => { if (live) { setChat(value); setError(''); } }, cause => { if (live) setError(errorText(cause)); });
    void sync.refresh();
    const offUpdates = wb.bot.onChatUpdate(value => sync.receive(value));
    const loadTasks = () => { clearTimeout(taskTimer); taskTimer = setTimeout(() => { void Promise.all([wb.bot.listTasks(bot.id), wb.bot.listArtifacts(bot.id)]).then(([nextTasks, nextArtifacts]) => { if (live) { setTasks(nextTasks); setArtifacts(nextArtifacts); } }, cause => { if (live) setError(errorText(cause)); }); }, 80); };
    void Promise.all([wb.bot.open(bot.id), wb.ai.config(), wb.bot.listTasks(bot.id), wb.bot.listArtifacts(bot.id)]).then(([next, cfg, nextTasks, nextArtifacts]) => { if (!live) return; setData(next); if (!configUpdated) setConfig(cfg); setTasks(nextTasks); setArtifacts(nextArtifacts); setError(''); onActiveChatChange?.(next.chat.id); }, cause => { if (live) setError(errorText(cause)); });
    const offChat = wb.ai.onChat(value => { if (value.id === bot.mainChatId && live) void sync.refresh(); });
    const offConfig = wb.ai.onConfigChanged(value => { if (live) { configUpdated = true; setConfig(value); } });
    const off = wb.bot.onChanged(event => { if (event.kind === 'host') { void sync.refresh(); loadTasks(); return; } if ((!event.botId || event.botId === bot.id) && ['task', 'artifact', 'chat'].includes(event.kind)) { void sync.refresh(); if (event.kind !== 'chat') loadTasks(); } });
    return () => { live = false; clearTimeout(taskTimer); sync.stop(); offUpdates(); off(); offChat(); offConfig(); };
  }, [bot.id, reload]);
  useEffect(() => { if (!referencesOpen || !referenceMode) return; let live = true; setReferenceLoading(true); setReferenceError(''); void loadReferenceOptions(referenceMode).then(value => { if (live) setReferenceOptions(value); }, cause => { if (live) setReferenceError(errorText(cause)); }).finally(() => { if (live) setReferenceLoading(false); }); return () => { live = false; }; }, [referenceMode, referencesOpen, referenceReload]);
  useLayoutEffect(() => { if (page !== 'chat') return; const saved = positions.get(bot.mainChatId); if (scroll.current) { if (follow.current) scroll.current.scrollTop = scroll.current.scrollHeight; else if (!floating) scroll.current.scrollTop = saved?.top ?? 0; } }, [bot.mainChatId, chat, tasks, page, collapsed, replyVisible, open, mode]);
  useLayoutEffect(() => { if (page !== 'chat') scroll.current?.scrollTo({ top: 0 }); }, [page]);
  useLayoutEffect(() => { const saved = positions.get(bot.mainChatId); if (saved && editor.current) editor.current.setSelectionRange(saved.start, saved.end); }, [bot.mainChatId, open, collapsed, mode]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); menuRef.current?.querySelector('button')?.focus(); event.preventDefault(); } };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
  }, [menu]);
  useLayoutEffect(() => { if (!floating || collapsed || !editor.current) return; editor.current.style.height = '0px'; editor.current.style.height = `${Math.min(98, Math.max(40, editor.current.scrollHeight))}px`; }, [floating, collapsed, open, draft.value.text]);
  useEffect(() => { if (open && !(floating && collapsed) && (!floating || replyVisible) && page === 'chat') void wb.bot.markRead(bot.id).catch(() => {}); }, [bot.id, open, floating, collapsed, replyVisible, page, tasks]);
  const run = async (job: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await job(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const hasModel = bot.modelId ? config?.models.some(model => model.id === bot.modelId && config.providers.some(provider => provider.id === model.providerId)) : config?.hasConnection;
  const send = async (override?: AiSeed) => {
    if (submitBusy.current || speechBusy) return;
    submitBusy.current = true; setError('');
    try {
      if (draft.hasPendingSubmit) { await draft.submit(bot.id, undefined); follow.current = true; setPage('chat'); setCollapsed(false); setReplyVisible(true); return; }
      if (!config?.aiEnabled || !hasModel) throw new Error('请检查 Bot 的模型选择及 AI 设置');
      const scope = override?.scope ?? context.scope;
      const object: BotResourceRef | undefined = scope.module === 'reading' ? { kind: scope.module, id: scope.profileId, label: context.object } : undefined;
      if (object && !draft.hasPendingSubmit && !draft.value.resources.some(ref => ref.kind === object.kind && ref.id === object.id)) {
        if (draft.value.resources.length >= 8) throw new Error('引用最多 8 项，请移除一项后发送');
        draft.edit({ resources: [...draft.value.resources, object] });
      }
      const pageContext: AiTurnContext = { scope, pageScope: scope };
      if (scope.module === 'workbench') { const workspace = browserWorkspaceForView(scope.viewId); if (workspace) pageContext.browserTabId = (await wb.browserAutomation.tabs(workspace)).find(tab => tab.active && tab.ready)?.id ?? null; }
      let target: BotSubmit['target'] = !separateInput && !override ? amendmentTarget?.target : undefined;
      if (!target && !separateInput && !override && !draft.value.replyToTaskId && isBotAmendment(draft.value.text)) {
        const roots = tasks.filter(task => !task.parentTaskId && ['waiting_user', 'waiting_bot', 'queued', 'running'].includes(task.status));
        const chains = await Promise.all(roots.map(root => wb.bot.getCollaboration(root.id)));
        const choices: AmendmentChoice[] = chains.flatMap(chain => chain.tasks.filter(task => !task.dependencyIds.length && task.kind !== 'message' && ['waiting_user', 'queued', 'running'].includes(task.status)).map(task => {
          const action = chain.actions.find(action => action.taskId === task.id && ['pending', 'superseded'].includes(action.status));
          return { label: `${cards.find(card => card.id === task.botId)?.name ?? 'Bot'} · ${task.title}`, target: { intent: 'amend' as const, rootTaskId: task.rootTaskId, taskId: task.id, ...(action ? { actionId: action.id, expectedActionRevision: action.revision } : {}) } };
        }));
        if (choices.length > 1) { setAmendmentChoices(choices); return; }
        target = choices[0]?.target;
      }
      await draft.submit(bot.id, pageContext, target); setSeparateInput(false); setAmendmentTarget(undefined); setAmendmentChoices([]); follow.current = true; setPage('chat'); setCollapsed(false); setReplyVisible(true);
    } catch (cause) { setError(errorText(cause)); } finally { submitBusy.current = false; }
  };
  useEffect(() => {
    if (!seed || usedSeed.current === seed.nonce || !draft.ready || !config) return;
    usedSeed.current = seed.nonce; setCollapsed(false); setReplyVisible(true); setPage('chat');
    if (draft.value.text.trim()) { draft.edit({ text: `${draft.value.text}\n\n${seed.text}`.slice(0, 10000) }); setError('已将工作区请求追加到现有草稿，请检查后发送'); }
    else { draft.edit({ text: seed.text }); void send(seed); }
    onSeedFinished?.(seed.nonce);
  }, [seed, draft.ready, config, hasModel]);
  const closeInspector = () => { setInspector(undefined); (floating ? menuRef.current?.querySelector('button') : badge.current)?.focus({ preventScroll: true }); };
  const openInspector = (tab: InspectorTab) => {
    setMenu(false);
    if (floating) onMode?.('parallel');
    setInspector(tab);
  };
  const changePage = (next: BotPanelPage) => {
    if (next === 'tasks' || next === 'history') { openActivity(undefined, next === 'history'); return; }
    if (next === 'artifacts' || next === 'profile') { openInspector(next === 'artifacts' ? 'library' : 'details'); return; }
    setInspector(undefined); setPage(next); setMenu(false); setCollapsed(false); setReplyVisible(true);
    if (next === 'chat') requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }));
  };
  const showExchange = (message: Pick<BotMessage, 'id' | 'fromBotId' | 'toBotId'>) => {
    exchangeReturn.current = document.activeElement as HTMLElement;
    const saved = positions.get(bot.mainChatId);
    positions.set(bot.mainChatId, { top: scroll.current?.scrollTop ?? 0, follow: follow.current, start: saved?.start ?? 0, end: saved?.end ?? 0 });
    setExchange(message); changePage('exchange');
  };
  const backFromExchange = () => { changePage('chat'); requestAnimationFrame(() => exchangeReturn.current?.focus({ preventScroll: true })); };
  const chooseAmendment = (choice: AmendmentChoice) => { setAmendmentTarget(choice); setAmendmentChoices([]); setSeparateInput(false); draft.edit({ replyToTaskId: null }); changePage('chat'); };
  const chatActions = (task: BotTask, replyText?: string, entryId?: string) => (task.dependencyIds.length || task.messageIds?.length) && !task.parentTaskId ? <BotCollaborationCard key={entryId ?? task.id} task={task} entryId={entryId} cards={cards} copyBusy={copyBusy} onExchange={showExchange} onAmend={(target, label) => chooseAmendment({ target, label })} onLayout={followChat} /> : <BotChatActions key={task.id} task={task} copyBusy={copyBusy} open={() => openActivity(task.id)} onLayout={followChat} replyText={replyText} />;
  const reply = (task: BotTask) => { if (task.botId !== bot.id) { onSelectBot?.(task.botId); return; } draft.edit({ replyToTaskId: task.id }); changePage('chat'); editor.current?.focus(); };
  const browserApprovals = useBrowserApprovalTasks(chat ?? null), pendingBrowser = Object.values(browserApprovals.tasks).find(item => item.status === 'site-approval');
  const hasEditor = page !== 'exchange' && (floating || page === 'chat');
  const chooseReferenceMode = (value: string) => { setReferenceMode(value as ReferenceMode); setReferenceOptions([]); };
  const copyBusy = copySaveState?.status !== undefined && copySaveState.status !== 'saved';
  const progress = useMemo(() => groupBotProgress(tasks, chat?.entries ?? [], artifacts), [tasks, chat, artifacts]);
  const actionTasks = useMemo(() => tasks.filter(task => task.botId === bot.id && task.chatId === bot.mainChatId && (task.operationIds.length || task.dependencyIds.length || task.messageIds?.length)), [tasks, bot.id, bot.mainChatId]);
  const taskForEntry = useMemo(() => new Map(actionTasks.flatMap(task => {
    const ids = !task.parentTaskId && (task.dependencyIds.length || task.messageIds?.length) ? task.assistantEntryIds : undefined;
    return (ids ?? (task.assistantEntryId ? [task.assistantEntryId] : [])).map(id => [id, task] as const);
  })), [actionTasks]);
  const incomingForEntry = useMemo(() => new Map(tasks.filter(task => task.parentTaskId && task.botId === bot.id && task.chatId === bot.mainChatId && task.assistantEntryId).map(task => [task.assistantEntryIds?.[0] ?? task.assistantEntryId!, task])), [tasks, bot.id, bot.mainChatId]);
  const legacyReplyTimes = useMemo(() => new Map(tasks.filter(task => task.chatId === chat?.id).flatMap(task => (task.assistantEntryIds ?? (task.assistantEntryId ? [task.assistantEntryId] : [])).map(id => [id, task.createdAt] as const))), [tasks, chat?.id]);
  const replyTime = (entry: ChatEntry) => {
    const value = entry.createdAt ?? legacyReplyTimes.get(entry.id);
    if (!value || !Number.isFinite(Date.parse(value))) return <span className="bot-message-time">时间未记录</span>;
    return <time className="bot-message-time" dateTime={value} title={entry.createdAt ? '回复开始时间' : '旧消息未单独记录时间，显示关联请求的时间'}>{replyDateFormat.format(new Date(value))}</time>;
  };
  const entryActions = (entry: ChatEntry, before = false) => {
    const task = taskForEntry.get(entry.id);
    if (page !== 'chat' || entry.role !== 'assistant' || !task) return null;
    const legacySummary = !task.assistantEntryIds?.length && !task.parentTaskId && !!(task.dependencyIds.length || task.messageIds?.length);
    return before === legacySummary ? chatActions(task, entry.content, entry.id) : null;
  };
  const activeTasks = tasks.filter(task => (!task.parentTaskId || task.status === 'waiting_user') && (
    ['waiting_user', 'waiting_resource', 'interrupted', 'failed'].includes(task.status) ||
    ['queued', 'running', 'waiting_bot'].includes(task.status) && (['delegated', 'routine'].includes(task.kind) || task.operationIds.length > 0 || task.dependencyIds.length > 0)
  )).slice(0, 8).reverse();
  const replying = tasks.some(task => !task.parentTaskId && ['chat', 'work'].includes(task.kind) && ['queued', 'running'].includes(task.status) && !task.operationIds.length && !task.dependencyIds.length && !task.messageIds?.length);
  const quickPrompts = bot.seedKey === 'permission' ? ['查询当前权限', '帮我核对群组申请'] : bot.seedKey === 'pbi' ? ['整理当前页面', '核对当前特性进度'] : bot.seedKey === 'schedule' ? ['看看今天有哪些待办', '整理本周日程'] : bot.seedKey === 'delivery' ? ['整理交付材料', '把内容保存为报告'] : bot.seedKey === 'dts' ? ['整理问题线索', '分析我提供的问题'] : bot.seedKey === 'office' ? ['看看今天先处理什么', '梳理今天的会议和待回复'] : ['帮我梳理今天的工作', '看看有哪些负责人'];
  const latestUser = [...(chat?.entries ?? [])].reverse().find(entry => entry.role === 'user');
  const currentTask = tasks.find(task => !task.parentTaskId && task.chatId === bot.mainChatId && ['running', 'waiting_bot'].includes(task.status)) ?? tasks.find(task => (task.latestUserMessageId ?? task.sourceMessageId) === latestUser?.id);
  const floatingQuestion = chat?.entries.find(entry => entry.id === (currentTask?.latestUserMessageId ?? currentTask?.sourceMessageId))?.content ?? latestUser?.content;
  const compactReply = floating && page === 'chat';
  const workPage = page === 'schedules';
  const turnEntries = currentTask?.assistantEntryId ? chat?.entries.filter(entry => (currentTask.assistantEntryIds ?? [currentTask.assistantEntryId]).includes(entry.id)) : chat?.entries.slice(latestUser ? chat.entries.indexOf(latestUser) + 1 : 0).filter(entry => entry.role === 'assistant');
  const renderedEntries = compactReply ? turnEntries : chat?.entries;
  const hasFloatingReply = !!(floatingQuestion || turnEntries?.length || activeTasks.length || pendingBrowser);
  const compose = <div className="bot-compose" ref={composer}>
        {(isBotAmendment(draft.value.text) || amendmentTarget) && <div className="bot-reply-target"><span>{separateInput ? '新工作' : amendmentTarget ? `补充：${amendmentTarget.label}` : '补充当前工作'}</span><button onClick={() => { setSeparateInput(!separateInput); setAmendmentTarget(undefined); setAmendmentChoices([]); }}>{separateInput ? '作为补充发送' : '作为新工作发送'}</button></div>}
        {!!amendmentChoices.length && <div className="bot-amendment-choices" role="group" aria-label="选择补充的工作"><span>要补充哪一项？</span>{amendmentChoices.map(choice => <button key={choice.target.taskId} type="button" className="bot-button" onClick={() => chooseAmendment(choice)}>{choice.label}</button>)}</div>}
        {floating && <div className="bot-floating-tools"><span>{draft.value.replyToTaskId ? `回复：${tasks.find(task => task.id === draft.value.replyToTaskId)?.title ?? '当前任务'}` : bot.name}</span>{hasFloatingReply && !replyVisible && <IconButton label="展开答复" onClick={() => setReplyVisible(true)}><CaretUp size={17} /></IconButton>}<IconButton label="收起输入框" disabled={speechBusy} onClick={collapseInput}><Minus size={17} /></IconButton><div ref={menuRef}><IconButton label="助手更多操作" aria-expanded={menu} onClick={() => setMenu(!menu)}><DotsThree size={21} /></IconButton>{menu && <div className="bot-more-menu"><button onClick={() => { setMenu(false); onMode?.('parallel'); }}>完整对话</button><button onClick={() => openActivity()}>工作与对话</button><button onClick={() => openInspector('details')}>Bot 详情</button><button onClick={() => openInspector('library')}>资料库</button></div>}</div></div>}
        {config && (!config.aiEnabled || !hasModel) && <div className="bot-config-hint"><p>{!config.aiEnabled ? '对话模型尚未启用' : bot.modelId ? '此 Bot 的模型不可用' : '配置一个对话模型，即可开始工作'}</p><button onClick={config.aiEnabled && bot.modelId ? () => openInspector('details') : onOpenSettings}>{config.aiEnabled && bot.modelId ? '选择模型' : '前往 AI 设置'}</button></div>}
        {!!draft.value.resources.length && <div className="bot-reference-chips">{draft.value.resources.map(ref => <span key={`${ref.kind}:${ref.id}`}><Paperclip size={12} /><span title={ref.label || ref.id}>{ref.label || `${ref.kind} · ${ref.id.slice(0, 8)}`}</span><IconButton label={`移除引用 ${ref.label || ref.id}`} disabled={!draft.ready} onClick={() => draft.edit({ resources: draft.value.resources.filter(item => item !== ref) })}><X size={12} /></IconButton></span>)}</div>}
        {draft.value.replyToTaskId && !floating && <div className="bot-reply-target"><span>回复：{tasks.find(task => task.id === draft.value.replyToTaskId)?.title ?? '当前任务'}</span><IconButton label="取消回复任务" onClick={() => draft.edit({ replyToTaskId: null })}><X size={13} /></IconButton></div>}
        <textarea ref={editor} rows={floating ? 2 : 3} maxLength={10000} aria-label={`给${bot.name}发送消息`} value={draft.value.text} onSelect={event => { const node = event.currentTarget; positions.set(bot.mainChatId, { top: page === 'chat' ? scroll.current?.scrollTop ?? 0 : positions.get(bot.mainChatId)?.top ?? 0, follow: follow.current, start: node.selectionStart, end: node.selectionEnd }); }} placeholder={`给${bot.name}发送消息…`} onChange={event => draft.edit({ text: event.target.value })} onCompositionStart={() => draft.composition(true)} onCompositionEnd={() => draft.composition(false)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
        <div className="bot-compose-toolbar"><button type="button" className="ibtn" ref={referenceTrigger} aria-label="选择参考内容" disabled={!draft.ready || !referenceMode} onClick={() => setReferencesOpen(!referencesOpen)}><Plus size={18} /></button><SpeechInput anchor={composer} contextKey={bot.mainChatId} draft={draft.value.text} onChange={text => draft.edit({ text })} enabled={draft.ready} visible={open && !(floating && collapsed)} onBusyChange={setSpeechBusy} />
          <button className="bot-send" aria-label={draft.hasPendingSubmit ? '核对发送结果' : '发送'} title={draft.hasPendingSubmit ? '使用原请求标识核对，不会重复提交' : '发送'} disabled={draft.sending || speechBusy || !draft.hasPendingSubmit && !draft.value.text.trim()} onClick={() => void send()}><PaperPlaneRight size={18} weight="fill" /></button>
        </div>
        {floating && (draft.sending || draft.hasPendingSubmit) && <p className="bot-floating-save" role="status">{draft.sending ? '正在发送…' : '发送结果待核对，请重试'}</p>}

        {draft.error && <div className="bot-error" role="alert">{draft.error}<div className="bot-action-buttons"><button onClick={() => void run(() => navigator.clipboard.writeText(draft.value.text))}>复制本地输入</button><button disabled={draft.hasPendingSubmit || draft.sending} onClick={() => void run(() => draft.retrySave())}>重试保存当前输入</button></div></div>}
      </div>;
  const renderEntry = (entry: ChatEntry, readOnly = false) => <Fragment key={entry.id}>
    {entry.receivedBotMessages?.map(message => <BotReceivedMessage key={message.id} message={message} cards={cards} onExchange={showExchange} />)}
    {!readOnly && incomingForEntry.has(entry.id) && <BotIncomingMessage task={incomingForEntry.get(entry.id)!} cards={cards} onExchange={showExchange} onLayout={followChat} />}
    <article className={`bot-chat-entry ${entry.role}`}>{entry.role === 'assistant' && <BotAvatar avatar={bot.avatar} small />}<div>{entry.role === 'assistant' && <header className="bot-message-meta"><strong className="bot-message-name">{bot.name}</strong>{replyTime(entry)}</header>}{!readOnly && entryActions(entry, true)}{entry.role === 'user' ? <p className="bot-user-bubble">{entry.content}</p> : <AiResponse entry={entry} browserTask={entry.browserTask ? browserApprovals.tasks[entry.browserTask.id] : undefined} approvalCardId="bot-site-approval" onLocateApproval={() => approval.current?.focus()} />}{entry.officeSource && onOpenOfficeSource && <button type="button" className="office-ref bot-office-ref" onClick={() => onOpenOfficeSource(entry.officeSource!)}>{entry.officeSource.label}</button>}{entry.error && <p className="bot-error">{entry.error}</p>}{!readOnly && entryActions(entry)}</div></article>
  </Fragment>;
  const library = <>
    <div className="bot-artifacts-surface" hidden={!!sourceTaskId}>
      <BotArtifactsView botId={bot.id} artifacts={artifacts} cards={cards} selectedId={artifactId} onSelect={setArtifactId} onTask={id => {
        artifactTaskReturn.current = document.activeElement as HTMLElement; setSourceTaskId(id);
        requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.bot-work-source-task')?.focus());
      }} onOpenResource={onOpenResource} onExternalPreview={island ? artifact => void run(() => wb.island.navigate({ view: 'home', artifactId: artifact.id })) : undefined} />
    </div>
    {sourceTaskId && <div className="bot-work-source-task" tabIndex={-1} aria-label="来源任务"><BotTaskDetail key={sourceTaskId} taskId={sourceTaskId} cards={cards} back={() => {
      setSourceTaskId(undefined); requestAnimationFrame(() => artifactTaskReturn.current?.focus({ preventScroll: true }));
    }} backLabel="返回资料库" embedded reply={reply} copyBusy={copyBusy} /></div>}
  </>;
  if (!open) return null;
  return <section ref={panel} id="workbench-ai-panel" className={`bot-panel${floating ? ' bot-floating' : ''}${island ? ' bot-island' : ''}`} data-inspector={inspector || undefined} data-task-visible={floating && workPage || undefined} data-work-page={workPage || undefined} data-exchange={page === 'exchange' || undefined} data-collapsed={floating && collapsed} data-reply-visible={replyVisible} data-phase={floating ? motionPhase : undefined} onKeyDown={event => { if (floating && !collapsed && event.key === 'Escape' && !event.defaultPrevented && !menu && !referencesOpen) { event.preventDefault(); collapseInput(); } }} aria-label={`${bot.name}的对话`}>
    {!floating && !island && <div className="bot-resizer" role="separator" aria-label="调整对话宽度" aria-orientation="vertical" tabIndex={0} aria-valuemin={340} aria-valuemax={560} aria-valuenow={width} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); onWidthChange?.(Math.max(340, Math.min(560, width + (event.key === 'ArrowRight' ? 20 : -20)))); } }} onPointerDown={event => { const start = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); const move = (moveEvent: PointerEvent) => onWidthChange?.(Math.max(340, Math.min(560, width + moveEvent.clientX - start))); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); }} />}
    <div className="bot-conversation-column">
      <div className="bot-reply-surface" data-compact={compactReply || undefined} data-attention={compactReply && (actionTasks.some(task => task.status === 'waiting_user') || !!pendingBrowser) || undefined} hidden={floating && (inspector === 'activity' || collapsed || !replyVisible || !hasFloatingReply && page === 'chat')}>
        {page === 'exchange' && exchange ? <header className="bot-panel-header bot-exchange-header"><button className="bot-text-button" onClick={backFromExchange}><ArrowLeft size={16} />返回对话</button><strong><BotAvatar avatar={cards.find(card => card.id === exchange.fromBotId)?.avatar ?? bot.avatar} small />{cards.find(card => card.id === exchange.fromBotId)?.name} ⇄ <BotAvatar avatar={cards.find(card => card.id === exchange.toBotId)?.avatar ?? bot.avatar} small />{cards.find(card => card.id === exchange.toBotId)?.name}</strong></header> : workPage ? <header className="bot-panel-header bot-work-header"><button className="bot-text-button bot-work-chat-back" aria-label="返回对话" title="返回对话" onClick={() => changePage('chat')}><ArrowLeft size={16} /><span>返回对话</span></button><strong>定时任务</strong><div className="bot-work-header-context">{floating && <IconButton label="收起答复" onClick={() => { setReplyVisible(false); editor.current?.focus(); }}><X size={16} /></IconButton>}</div></header> : <header className="bot-identity-bar">
          <button className="bot-identity-pill" type="button" ref={badge} title={inspector ? '收起 Bot 侧栏' : '展开 Bot 侧栏'} aria-label={`${bot.name}的 Bot 资料`} aria-controls="bot-inspector" aria-expanded={!!inspector} onClick={() => inspector ? closeInspector() : openInspector('details')}><BotAvatar avatar={bot.avatar} small /><strong>{bot.name}</strong><CaretRight size={14} weight="bold" aria-hidden="true" /></button>
          <div className="bot-header-actions">{floating && currentTask?.status === 'running' && <IconButton label="停止回复" disabled={busy} onClick={() => void run(() => wb.bot.cancelTask(currentTask.id, currentTask.revision))}><Square size={13} weight="fill" /></IconButton>}{floating && <IconButton label="收起答复" onClick={() => { setReplyVisible(false); editor.current?.focus(); }}><X size={16} /></IconButton>}
        </div></header>}
        <div className="bot-chat-scroll" ref={scroll} role="region" aria-label={workPage ? '定时任务' : page === 'exchange' ? '协作对话' : '对话内容'} tabIndex={0} onScroll={() => { if (page !== 'chat') return; const node = scroll.current!; const above = node.scrollHeight - node.scrollTop - node.clientHeight > 64; follow.current = !above; const saved = positions.get(bot.mainChatId); if (!floating) positions.set(bot.mainChatId, { top: node.scrollTop, follow: !above, start: saved?.start ?? 0, end: saved?.end ?? 0 }); setAboveBottom(above); }}>
          {page === 'exchange' && exchange ? <BotExchangeView botA={exchange.fromBotId} botB={exchange.toBotId} anchorMessageId={exchange.id} cards={cards} /> : page === 'schedules' ? <><button className="bot-text-button" onClick={() => changePage('tasks')}><ArrowLeft size={15} />返回工作列表</button><BotSchedules key={bot.id} botId={bot.id} botName={bot.name} /></> : <>
            {compactReply && floatingQuestion && <p className="bot-floating-question" title={floatingQuestion}>{floatingQuestion}</p>}{!chat && <p className="bot-empty" role="status">正在读取对话…</p>}{!floating && chat && !chat.entries.length && <div className="bot-chat-empty"><BotAvatar avatar={bot.avatar} /><h3>和{bot.name}开始工作</h3><p>{bot.description}。把想做的事告诉我，我们从这里继续。</p><div>{quickPrompts.map(text => <button key={text} disabled={!draft.ready} onClick={() => { draft.edit({ text }); editor.current?.focus(); }}>{text}</button>)}</div></div>}
            {renderedEntries?.map(entry => renderEntry(entry))}
            {page === 'chat' && replying && (!compactReply || !renderedEntries?.some(entry => entry.streaming)) && <p className="bot-chat-progress" role="status">正在回复…</p>}
            {page === 'chat' && actionTasks.filter(task => !renderedEntries?.some(entry => entry.id === task.assistantEntryId) && (!compactReply || task.status === 'waiting_user' || task.id === currentTask?.id)).map(task => chatActions(task))}
            {page === 'chat' && activeTasks.filter(task => !task.dependencyIds.length && !task.messageIds?.length && (task.status !== 'waiting_user' || !actionTasks.some(item => item.id === task.id))).map(task => <button key={task.id} type="button" className="bot-task-notice" data-status={task.status} aria-label={`${botStatusLabel[task.status]}：${task.title}，查看详情`} onClick={() => openActivity(task.id)}>
              <span><strong>{botStatusLabel[task.status]}</strong><span>{task.title}</span></span><ArrowRight size={16} aria-hidden="true" />
            </button>)}
          </>}
          {pendingBrowser && <BrowserSiteApprovalCard task={pendingBrowser} id="bot-site-approval" elementRef={approval} onTask={task => browserApprovals.update(task, pendingBrowser.pendingOrigin!)} />}
          {browserApprovals.error && <p className="bot-error" role="alert">{browserApprovals.error}<button onClick={browserApprovals.retry}>重试</button></p>}
        </div>
        {aboveBottom && page === 'chat' && <button className="bot-jump-latest" onClick={() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); follow.current = true; setAboveBottom(false); }}><ArrowDown size={15} />回到底部</button>}
      </div>

      {floating && inspector !== 'activity' && !collapsed && !hasFloatingReply && <div className="bot-floating-suggestions">{quickPrompts.map(text => <button key={text} disabled={!draft.ready} onClick={() => { draft.edit({ text }); editor.current?.focus(); }}>{text}</button>)}</div>}
      {floating && page !== 'exchange' && <div className="bot-floating-input-surface" ref={inputSurface}>
        {collapsed ? <button className="bot-floating-pill" ref={pill} aria-label={`展开与${bot.name}的对话`} aria-expanded="false" onClick={expandInput}><Sparkle size={19} /><span>{draft.value.text.trim() || `问问${bot.name}…`}</span>{tasks.some(task => task.status === 'waiting_user') ? <span className="bot-pill-count">待确认 {tasks.filter(task => task.status === 'waiting_user').length}</span> : <span className="bot-pill-hint">AI</span>}</button> : compose}
        <span className="bot-metal-edge" aria-hidden="true" /><span className="bot-marquee" aria-hidden="true" /><span className="bot-glint" aria-hidden="true"><StarFour size={12} weight="fill" /></span>
      </div>}
      {!floating && hasEditor && compose}
    </div>
    {inspectorView && (!floating || inspectorView.tab === 'activity' && !collapsed) && <div className="bot-inspector-clip" data-view={inspectorView.tab} inert={!inspectorView.open}>
      {inspectorView.tab === 'activity' ? <BotActivity key={activityStart.key} ref={inspectorPanel} progress={progress} chat={chat} history={data?.history} cards={cards}
        initialTaskId={activityStart.taskId} historyFirst={activityStart.historyFirst} close={closeInspector} onProfile={floating ? undefined : () => setInspector('details')}
        reply={reply} copyBusy={copyBusy} renderEntry={entry => renderEntry(entry, true)} canReference={draft.ready && draft.value.resources.length < 8}
        onReference={archive => {
          if (!draft.value.resources.some(ref => ref.kind === 'chat' && ref.id === archive.id)) draft.edit({ resources: [...draft.value.resources, { kind: 'chat', id: archive.id, label: archive.title }] });
          closeInspector(); requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }));
        }} /> : <BotProfile ref={inspectorPanel} key={initialPage?.value === 'profile' ? initialPage.nonce : undefined} card={bot} profile={data?.bot} config={config} tab={inspectorView.tab} expanded={inspectorView.open} onTab={setInspector} close={closeInspector} onSettings={onOpenSettings}
        onSaved={profile => setData(current => current && { ...current, bot: profile })} onReload={() => setReload(value => value + 1)} library={library}
        onManageInMain={island ? () => void run(() => wb.island.navigate({ view: 'home', botPanel: 'details' })) : undefined}
        onWorkspace={() => { closeInspector(); if (island) void run(() => wb.island.navigate({ view: 'home' })); else onOpenWorkspace?.(); }} onActivity={() => openActivity()} />}
    </div>}
    {error && <div className="bot-error bot-panel-error" role="alert">{error}<button onClick={() => { setReload(value => value + 1); void draft.refresh(); }}>重新读取</button><IconButton label="收起提示" onClick={() => setError('')}><X size={13} /></IconButton></div>}
    {referencesOpen && <AiReferencePicker id="bot-reference-picker" mode={referenceMode} modeOptions={bot.seedKey === 'coordinator' ? ['todo', 'reading'] : bot.seedKey === 'schedule' ? ['todo'] : []} onModeChange={chooseReferenceMode} unavailable="这个 Bot 没有可选业务对象" options={referenceOptions} selected={draft.value.resources.map(asAiRef).filter((item): item is AiReference => !!item && item.module === referenceMode)} loading={referenceLoading} error={referenceError} notice="选择的资料仅用于本次任务" anchor={composer} trigger={referenceTrigger} onChange={refs => { const retained = draft.value.resources.filter(ref => ref.kind !== referenceMode); const next = refs.map(value => ({ ...asRef(value), label: referenceOptions.find(option => JSON.stringify(option.reference) === JSON.stringify(value))?.title })); if (retained.length + next.length > 8) { setReferenceError('最多选择 8 项参考内容'); return; } draft.edit({ resources: [...retained, ...next] }); }} onRetry={() => setReferenceReload(value => value + 1)} onClose={() => { setReferencesOpen(false); referenceTrigger.current?.focus(); }} />}
  </section>;
}
