import type { AiConfig } from '../../shared/workbench-api';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, DotsThree, GearSix, Info, MagnifyingGlass, PaperPlaneRight, Plus, SidebarSimple, Sparkle, Stop, Trash, X } from '@phosphor-icons/react';
import { IconBug, IconCheckSquare, IconClipboardText, IconDocs, IconHome, IconMoon, IconPackage, IconShieldCheck, IconWeb } from '../icons';
import type { ChatSession, ChatSummary } from '../../shared/todo-contracts';
import { aiScopeKey, chatContextScope, chatScope, defaultAiScopeForWorkbench, preferredAiChat, sameAiWorkbench, TODO_AI_WORKBENCH_NAME, workbenchForScope, type AiScope } from '../../shared/ai-scope';
import { browserWorkspaceForView } from '../../shared/browser-contracts';
import { aiReferenceKey, aiReferenceMode, validateAiReferences, type AiReference } from '../../shared/ai-reference';
import { AiReferencePicker, loadReferenceOptions, REFERENCE_LABELS, type ReferenceOption } from './AiReferencePicker';
import { errorText, Modal, Select as TodoSelect } from '../ui/controls';
import { TodoProposalCard } from './TodoProposalCard';
import { AiResponse } from './AiResponse';
import { AiActivity } from './AiActivity';
import { SpeechInput } from './SpeechInput';
import { BrowserSiteApprovalCard, useBrowserApprovalTasks } from '../../modules/browser/ui/site-approval';
import { NAV, workbenchAiContext } from '../nav';

const wb = window.workbench;
/** ⓘ 悬浮说明:每个工作台一段固定文案,不拼接 */
const SCOPE_TIPS: Record<string, string> = {
  reading: 'AI 能看到这本书的书目、你的短评与关联库的笔记列表;笔记正文按需只读读取,不会改你的库。',
  todo: 'AI 可以查看和整理你的待办与日程;任何修改都会先征求你同意。',
};
const SCOPE_TIP_DEFAULT = 'AI 在这里只回答一般问题,不会读取你的文件内容。';
const workspaceKey = (scope: AiScope): string => workbenchForScope(scope) ?? aiScopeKey(scope);

export interface AiPanelContext {
  scope: AiScope; label: string; object: string;
}
export interface AiSeed {
  text: string; nonce: number; scope: AiScope;
  officeScene?: import('../../shared/office-workbench').OfficeScene;
}
type ChatChoice = { id: string; title: string; group: string; detail: string; updatedAt: string; status?: 'running' | 'done'; streaming?: boolean };
type ChatGroup = { id: string; label: string; emptyScope: AiScope | null };

function ChatDeleteButton({ title, streaming, className, showLabel, onDelete }: { title: string; streaming?: boolean; className: string; showLabel?: boolean; onDelete(): Promise<void> }) {
  const button = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => {
    if (!confirming || deleting) return;
    const cancel = (event: PointerEvent): void => {
      if (!button.current?.contains(event.target as Node)) { setConfirming(false); setDeleteError(''); }
    };
    document.addEventListener('pointerdown', cancel);
    return () => document.removeEventListener('pointerdown', cancel);
  }, [confirming, deleting]);
  return <button ref={button} type="button" className={`${className}${confirming ? ' ai-delete-confirm' : ''}`}
    aria-label={`${confirming ? deleteError ? '重试删除对话' : '确认删除对话' : '删除对话'}：${title}`}
    title={streaming ? '请先停止生成' : deleteError || (confirming ? '再次点击将删除此对话' : '删除')}
    disabled={streaming || deleting} onBlur={() => { if (!deleting) { setConfirming(false); setDeleteError(''); } }}
    onClick={() => {
      if (!confirming) { setConfirming(true); return; }
      setDeleting(true); setDeleteError('');
      void onDelete().then(() => { setConfirming(false); setDeleting(false); }, error => { setDeleteError(errorText(error)); setDeleting(false); });
    }}>
    {confirming ? deleting ? '删除中…' : deleteError ? '重试删除' : '确认删除' : showLabel ? '删除' : <Trash size={15} />}
  </button>;
}

function ChatPicker({ currentId, workbenchName, groups, choices, onNew, onOpen, onRename, onDelete }: {
  currentId?: string; workbenchName: string; groups: ChatGroup[]; choices: ChatChoice[]; onNew(scope?: AiScope): void; onOpen(id: string): void;
  onRename(chat: ChatChoice): void; onDelete(id: string): Promise<void>;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState('all');
  const [actions, setActions] = useState<{ id: string; left: number; top: number } | null>(null);
  const selected = choices.find(chat => chat.id === currentId);
  const activeFilter = filterId === 'all' || groups.some(group => group.id === filterId) ? filterId : 'all';
  const searchText = query.trim().toLocaleLowerCase('zh-CN');
  const matches = [...choices].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(chat =>
    (activeFilter === 'all' || groups.find(group => group.id === activeFilter)?.label === chat.group) &&
    (!searchText || `${chat.title} ${chat.group} ${chat.detail}`.toLocaleLowerCase('zh-CN').includes(searchText)));
  const recent = matches.slice(0, 4);
  if (!searchText && activeFilter === 'all' && selected && !recent.some(chat => chat.id === selected.id)) recent[3] = selected;
  const visibleChoices = searchText || activeFilter !== 'all' ? matches : recent;
  const emptyGroup = groups.find(group => group.id === activeFilter);
  const reset = (): void => { setOpen(false); setActions(null); setQuery(''); setFilterId('all'); };
  const close = (): void => { reset(); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const list = menu.current;
    const rect = trigger.current.getBoundingClientRect();
    const panel = trigger.current.closest('.ai-panel')?.getBoundingClientRect();
    list.style.width = `${Math.min(320, (panel?.right ?? window.innerWidth) - rect.left - 12, window.innerWidth - rect.left - 8)}px`;
    const top = rect.bottom + 4 + list.offsetHeight <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - list.offsetHeight - 4);
    list.style.top = `${top}px`;
    list.style.left = `${rect.left}px`;
    list.classList.toggle('is-up', top < rect.bottom);
    list.querySelector<HTMLInputElement>('.ai-context-search input')?.focus();
  }, [open]);
  useLayoutEffect(() => { if (actions) actionMenu.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [actions]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || menu.current?.contains(target) || actionMenu.current?.contains(target) || document.querySelector('.ai-context-filter-menu')?.contains(target)) return;
      reset();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.ai-context-filter-menu')) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', reset);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', reset);
    };
  }, [open]);
  return <div className="ai-context-select">
    <button type="button" ref={trigger} className="select-trigger" aria-label={`选择历史对话，当前：${selected?.group ?? workbenchName} / ${selected?.title ?? '新对话'}`} title={`${selected?.group ?? workbenchName} / ${selected?.title ?? '新对话'}`} aria-haspopup="dialog" aria-controls={menuId} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
      <span className="ai-context-header-label"><strong>{selected?.title ?? '新对话'}</strong></span><CaretDown size={12} weight="bold" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="select-menu ai-context-menu" role="dialog" aria-label="切换对话" onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if ((event.target as HTMLElement).closest('.ai-context-workbench-filter')) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-chat-main]')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }}>
      <label className="ai-context-search"><MagnifyingGlass size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setActions(null); }} placeholder="搜索对话" aria-label="搜索对话标题或关联对象" /></label>
      <div className="ai-context-filter-row"><span>{searchText ? `找到 ${matches.length} 条` : activeFilter === 'all' ? `最近 ${visibleChoices.length} 条` : `共 ${matches.length} 条`}</span>
        <TodoSelect value={activeFilter} aria-label="选择工作区" className="ai-context-workbench-filter" menuClassName="ai-context-filter-menu"
          options={[{ value: 'all', label: '选择工作区' }, ...groups.map(group => ({ value: group.id, label: group.label }))]}
          onChange={value => { setFilterId(value); setActions(null); }} />
      </div>
      <div className="ai-context-results" onScroll={() => setActions(null)}>
        {visibleChoices.map(chat => <div className={chat.id === currentId ? 'ai-context-row is-selected' : 'ai-context-row'} key={chat.id}>
          <button type="button" className="ai-context-chat-main" data-chat-main aria-current={chat.id === currentId ? 'true' : undefined} onClick={() => { close(); onOpen(chat.id); }}>
            <span className="ai-context-option-main"><span className="ai-context-option-text">{chat.title}</span>
              <span className="ai-context-option-meta"><small>{chat.detail === chat.group ? chat.group : `${chat.group} · ${chat.detail}`}</small>
                {chat.status && <span className={`ai-chat-status ${chat.status}`}>{chat.status === 'running' ? '执行中' : '已完成'}</span>}</span>
            </span>
          </button>
          <button type="button" className="ai-context-more" aria-label={`管理对话：${chat.title}`} aria-expanded={actions?.id === chat.id} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setActions(previous => previous?.id === chat.id ? null : { id: chat.id,
              left: Math.max(8, Math.min(rect.right - 112, window.innerWidth - 120)),
              top: rect.bottom + 76 <= window.innerHeight - 8 ? rect.bottom + 4 : rect.top - 72 });
          }}><DotsThree size={16} weight="bold" /></button>
          {actions?.id === chat.id && createPortal(<div ref={actionMenu} className="ai-context-actions-menu" style={{ left: actions.left, top: actions.top }} role="group" aria-label={`管理对话：${chat.title}`}>
            <button type="button" disabled={chat.streaming} onClick={() => { close(); onRename(chat); }}>重命名</button>
            <ChatDeleteButton title={chat.title} streaming={chat.streaming} className="ai-context-action-delete" showLabel onDelete={async () => { await onDelete(chat.id); setActions(null); }} />
          </div>, document.body)}
        </div>)}
        {visibleChoices.length === 0 && <div className="ai-context-no-results">{searchText ? '没有找到匹配的对话' : emptyGroup?.emptyScope ?
          <button type="button" data-chat-main onClick={() => { close(); onNew(emptyGroup.emptyScope!); }}>此工作台暂无对话 · 点击开始</button> : '暂无对话，点击右上角 ＋ 开始'}</div>}
      </div>
    </div>, document.body)}
  </div>;
}
function chatSummary(chat: ChatSession): ChatSummary {
  const lastReply = [...chat.entries].reverse().find(entry => entry.role === 'assistant');
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, module: chat.module,
    draftId: chat.draftId, profileId: chat.profileId, viewId: chat.viewId, contextScope: chat.contextScope, pageScope: chat.pageScope,
    streaming: chat.entries.some(entry => entry.streaming), completed: !!lastReply && !lastReply.streaming && !lastReply.error };
}

export function AiPanel({ open, onClose, seed, requestedChatId, onChatLocated, onActiveChatChange, onOpenSettings, onQuickAsk: _onQuickAsk, context, width, onWidthChange, plannedWorkbench = false }: {
  open: boolean; onClose(): void; seed?: AiSeed | null; requestedChatId?: string | null; onChatLocated(): void; onOpenSettings(): void;
  onActiveChatChange(id: string | null): void;
  onQuickAsk?(prompt: string, scope: AiScope): void;
  plannedWorkbench?: boolean; context: AiPanelContext; width: number; onWidthChange(width: number): void;
}) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<ChatSession | null>(null);
  const [activeContext, setActiveContext] = useState<AiPanelContext>(context);
  const [fixedContexts, setFixedContexts] = useState<Record<string, AiPanelContext>>({});
  const [objectNames, setObjectNames] = useState<Record<string, string>>({});
  const [referenceSelection, setReferenceSelection] = useState<{ key: string; values: AiReference[] }>({ key: '', values: [] });
  const [referenceList, setReferenceList] = useState<{ key: string; options: ReferenceOption[]; loading: boolean; error: string }>({ key: '', options: [], loading: false, error: '' });
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
  const [referenceNotice, setReferenceNotice] = useState('');
  const [referenceReload, setReferenceReload] = useState(0);
  const referenceTrigger = useRef<HTMLButtonElement>(null);
  const composeAnchor = useRef<HTMLDivElement>(null);
  const approvalCard = useRef<HTMLElement>(null);
  const approvalCardId = useId();
  const referencePickerId = useId();
  const [input, setInput] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [sending, setSending] = useState<string[]>([]);
  const sendingRef = useRef(new Set<string>());
  const markSending = (id: string, value: boolean): void => {
    if (value) sendingRef.current.add(id); else sendingRef.current.delete(id);
    setSending([...sendingRef.current]);
  };
  const [questions, setQuestions] = useState<Record<string, { id: string; sessionId: string; question: string; options: { label: string; description?: string }[] }>>({});
  const [error, setError] = useState('');
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelError, setModelError] = useState('');
  const [managing, setManaging] = useState<{ id: string; title: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState('');
  const renameInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const [aboveBottom, setAboveBottom] = useState(false);
  const scrollPositions = useRef(new Map<string, number>());
  const selectedChats = useRef(new Map<string, string>());
  const loadSequence = useRef(0);
  const consumedSeed = useRef(0);
  const draftTimer = useRef<number | undefined>(undefined);
  const draftSnapshot = useRef<{ id: string; text: string } | null>(null);
  const currentRef = useRef(current);
  const measureScroll = useCallback((): void => {
    const element = scrollRef.current;
    if (!element) return;
    const above = element.scrollHeight - element.scrollTop - element.clientHeight >= 80;
    followReply.current = !above;
    setAboveBottom(above);
    if (currentRef.current) scrollPositions.current.set(currentRef.current.id, element.scrollTop);
  }, []);
  const pageContextRef = useRef(context);
  const pageWorkbench = workbenchForScope(context.scope);
  const browserWorkspace = context.scope.module === 'workbench' && pageWorkbench === workbenchForScope(activeContext.scope)
    ? browserWorkspaceForView(context.scope.viewId) : null;
  const previousPageWorkbench = useRef(pageWorkbench);
  const pageScopeKey = aiScopeKey(context.scope);
  const activeScopeKey = aiScopeKey(activeContext.scope);
  const contextKey = current?.id ?? workspaceKey(activeContext.scope);
  const fixedContext = fixedContexts[contextKey];
  const pageReferenceMode = plannedWorkbench ? null : aiReferenceMode(context.scope);
  const referenceMode = pageReferenceMode && pageWorkbench === workbenchForScope(activeContext.scope)
    && (activeContext.scope.module === 'workbench' || activeContext.scope.module === pageReferenceMode) ? pageReferenceMode : null;
  const referencePageKey = `${plannedWorkbench ? 'planned' : pageScopeKey}`;
  const referenceKeyForChat = (id: string | null): string => `${id ?? `new:${workspaceKey(activeContext.scope)}`}|${referencePageKey}`;
  const referenceContextKey = referenceKeyForChat(current?.id ?? null);
  const references = referenceSelection.key === referenceContextKey ? referenceSelection.values.filter(reference =>
    reference.module === referenceMode && aiReferenceKey(reference) !== activeScopeKey) : [];
  const selectableReferences = referenceList.key === referenceContextKey ? referenceList.options.filter(option =>
    option.reference.module === referenceMode && aiReferenceKey(option.reference) !== activeScopeKey) : [];
  const referenceContextKeyRef = useRef(referenceContextKey);
  referenceContextKeyRef.current = referenceContextKey;
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const closeReferences = (restoreFocus = true): void => {
    setReferenceDialogOpen(false);
    if (restoreFocus) referenceTrigger.current?.focus();
  };
  const updateReferences = (values: AiReference[]): void => {
    setReferenceSelection({ key: referenceContextKey, values });
    setReferenceNotice('');
  };
  const rememberReferenceNames = (options: ReferenceOption[]): void => setObjectNames(previous => ({ ...previous,
    ...Object.fromEntries(options.map(option => [aiReferenceKey(option.reference), option.title])) }));
  const checkedReferences = async (values: AiReference[], pageScope: AiScope, scope: AiScope, selectionKey: string): Promise<AiReference[]> => {
    const checked = validateAiReferences(values, pageScope, scope);
    if (!checked.length) return checked;
    const options = await loadReferenceOptions(checked[0].module);
    const available = new Set(options.map(option => aiReferenceKey(option.reference)));
    if (checked.some(reference => !available.has(aiReferenceKey(reference)))) {
      if (referenceContextKeyRef.current === selectionKey) {
        setReferenceSelection({ key: selectionKey, values: checked.filter(reference => available.has(aiReferenceKey(reference))) });
        setReferenceNotice('所选内容已删除或失效，请重新选择。');
      }
      throw new Error('所选上下文已删除或失效，请重新选择后发送。');
    }
    rememberReferenceNames(options);
    return checked;
  };
  const activeScopeKeyRef = useRef(activeScopeKey);
  currentRef.current = current;
  pageContextRef.current = context;
  activeScopeKeyRef.current = activeScopeKey;

  const refreshChats = (): Promise<ChatSummary[]> => wb.ai.chatList().then(list => {
    setChats(list);
    return list;
  });
  const flushDraft = (): void => {
    window.clearTimeout(draftTimer.current);
    const snapshot = draftSnapshot.current;
    if (snapshot) void wb.ai.chatDraft(snapshot.id, snapshot.text).catch(() => undefined);
    draftSnapshot.current = null;
  };
  const followCurrentPage = (previous: AiPanelContext): AiPanelContext => {
    const page = pageContextRef.current;
    if (workspaceKey(page.scope) !== workspaceKey(previous.scope)) return previous;
    if (page.scope.module === 'workbench' && previous.scope.module !== 'workbench'
      && page.scope.viewId !== 'reading') return previous;
    return page;
  };
  const showChat = (chat: ChatSession): void => {
    setChats(previous => [chatSummary(chat), ...previous.filter(item => item.id !== chat.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    selectedChats.current.set(workspaceKey(chatScope(chat)), chat.id);
    const scope = chatContextScope(chat);
    const savedContext = contextForScope(scope);
    setActiveContext(fixedContexts[chat.id] ?? followCurrentPage(savedContext));
    setCurrent(chat);
    setInput(chat.draft);
    setError('');
    setReferenceDialogOpen(false);
  };
  const restoreWorkbenchChat = (scope: AiScope, sequence: number): void => {
    void wb.ai.chatList().then(async list => {
      if (sequence !== loadSequence.current) return;
      setChats(list);
      const wanted = selectedChats.current.get(workspaceKey(scope));
      const found = preferredAiChat(list, scope, wanted);
      if (!found) return;
      const chat = await wb.ai.chatOpen(found.id);
      if (sequence === loadSequence.current) showChat(chat);
    }).catch(e => { if (sequence === loadSequence.current) setError(errorText(e)); });
  };
  useEffect(() => {
    if (!open) return;
    let live = true, updated = false;
    const unsubscribe = wb.ai.onConfigChanged?.(raw => {
      if (!live) return;
      updated = true;
      setConfig(raw);
    });
    void wb.ai.config().then(raw => { if (live && !updated) setConfig(raw); }, e => { if (live && !updated) setError(errorText(e)); });
    return () => { live = false; unsubscribe?.(); };
  }, [open]);
  useEffect(() => {
    const sequence = ++loadSequence.current;
    restoreWorkbenchChat(context.scope, sequence);
    return () => flushDraft();
  }, []);
  useLayoutEffect(() => {
    if (!pageWorkbench || previousPageWorkbench.current === pageWorkbench) return;
    previousPageWorkbench.current = pageWorkbench;
    const sequence = ++loadSequence.current;
    flushDraft();
    setCurrent(null);
    setActiveContext(context);
    setInput('');
    setError('');
    setManaging(null);
    setReferenceDialogOpen(false);
    restoreWorkbenchChat(context.scope, sequence);
  }, [pageWorkbench]);
  useEffect(() => { onActiveChatChange(current?.id ?? null); }, [current?.id, onActiveChatChange]);
  useEffect(() => {
    if (!managing) return;
    const frame = requestAnimationFrame(() => {
      renameInput.current?.focus(); renameInput.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [managing]);
  // A visible page or chat transition starts a fresh selection. Saved turns remain historical only.
  useLayoutEffect(() => {
    setReferenceSelection(previous => previous.key === referenceContextKey ? previous : { key: referenceContextKey, values: [] });
    setReferenceDialogOpen(false);
    setReferenceNotice('');
  }, [referenceContextKey]);
  useLayoutEffect(() => {
    setReferenceSelection(previous => previous.key !== referenceContextKey ? previous : { ...previous,
      values: previous.values.filter(reference => reference.module === referenceMode && aiReferenceKey(reference) !== activeScopeKey) });
    setReferenceDialogOpen(false);
  }, [activeScopeKey, referenceMode]);
  useEffect(() => { if (!open) setReferenceDialogOpen(false); }, [open]);
  useEffect(() => { setReferenceDialogOpen(false); }, [width]);
  useEffect(() => {
    if (!open || !referenceMode || (!referenceDialogOpen && references.length === 0)) return;
    let live = true;
    let sequence = 0;
    const refresh = (): void => {
      const request = ++sequence;
      setReferenceList(previous => ({ key: referenceContextKey, options: previous.key === referenceContextKey ? previous.options : [], loading: true, error: '' }));
      void loadReferenceOptions(referenceMode).then(options => {
        if (!live || request !== sequence || referenceContextKeyRef.current !== referenceContextKey) return;
        rememberReferenceNames(options);
        setReferenceList({ key: referenceContextKey, options, loading: false, error: '' });
        const available = new Set(options.map(option => aiReferenceKey(option.reference)));
        const stale = referencesRef.current.some(reference => !available.has(aiReferenceKey(reference)));
        if (stale) {
          setReferenceSelection(previous => previous.key === referenceContextKey ? { ...previous, values: previous.values.filter(reference => available.has(aiReferenceKey(reference))) } : previous);
          setReferenceNotice('所选内容已删除或失效，请重新选择。');
        }
      }, error => {
        if (live && request === sequence && referenceContextKeyRef.current === referenceContextKey) setReferenceList({ key: referenceContextKey, options: [], loading: false, error: `无法读取可关联内容：${errorText(error)}` });
      });
    };
    refresh();
    const unsubscribe = referenceMode === 'todo' ? wb.todo.onChanged?.(refresh) : undefined;
    window.addEventListener('focus', refresh);
    return () => { live = false; unsubscribe?.(); window.removeEventListener('focus', refresh); };
  }, [open, referenceMode, referenceContextKey, referenceDialogOpen, referenceReload, references.length > 0]);
  useEffect(() => {
    if (fixedContext && aiScopeKey(fixedContext.scope) === pageScopeKey && fixedContext.object !== context.object) {
      setFixedContexts(previous => ({ ...previous, [contextKey]: { ...fixedContext, object: context.object } }));
    }
    setActiveContext(previous => fixedContext
      ? { ...fixedContext, object: aiScopeKey(fixedContext.scope) === pageScopeKey ? context.object : fixedContext.object }
      : followCurrentPage(previous));
  }, [pageScopeKey, context.label, context.object, current?.id, fixedContext]);
  useEffect(() => {
    if (!requestedChatId) return;
    void wb.ai.chatOpen(requestedChatId).then(chat => {
      ++loadSequence.current;
      flushDraft();
      setActiveContext(context);
      showChat(chat);
      onChatLocated();
    }, e => { setError(errorText(e)); onChatLocated(); });
  }, [requestedChatId, pageScopeKey]);
  useEffect(() => {
    if (!open || !seed || consumedSeed.current === seed.nonce) return;
    consumedSeed.current = seed.nonce;
    const sequence = ++loadSequence.current;
    const targetKey = workspaceKey(seed.scope);
    void (async () => {
      const seedBrowserWorkspace = context.scope.module === 'workbench' && workbenchForScope(seed.scope) === pageWorkbench ? browserWorkspaceForView(context.scope.viewId) : null;
      const seedBrowserTabId = seedBrowserWorkspace ? (await wb.browserAutomation.tabs(seedBrowserWorkspace)).find(tab => tab.active && tab.ready)?.id ?? null : undefined;
      const existing = currentRef.current;
      let chat: ChatSession;
      if (existing && sameAiWorkbench(existing, seed.scope)) chat = existing;
      else {
        const list = await refreshChats();
        const wanted = selectedChats.current.get(targetKey);
        const found = preferredAiChat(list, seed.scope, wanted);
        chat = found ? await wb.ai.chatOpen(found.id) : await wb.ai.chatNew(seed.scope);
      }
      if (sequence === loadSequence.current) {
        if (existing?.id !== chat.id) flushDraft();
        selectedChats.current.set(targetKey, chat.id);
        const targetContext = (aiScopeKey(seed.scope) === pageScopeKey ? context : contextForScope(seed.scope));
        if (fixedContexts[chat.id] || (!existing && fixedContext)) setFixedContexts(previous => ({ ...previous, [chat.id]: targetContext }));
        setActiveContext(targetContext);
        setCurrent(chat);
        if (existing?.id !== chat.id) setInput(chat.draft);
      }
      markSending(chat.id, true);
      try {
        const unsentDraft = existing?.id === chat.id ? input : chat.draft;
        const chosen = existing?.id === chat.id || !existing ? references : [];
        const seedPageScope = workbenchForScope(seed.scope) === pageWorkbench ? context.scope : seed.scope;
        const seedReferences = await checkedReferences(chosen, seedPageScope, seed.scope, referenceContextKey);
        if (!existing && sequence === loadSequence.current && seedReferences.length) setReferenceSelection({ key: referenceKeyForChat(chat.id), values: seedReferences });
        const request = wb.ai.ask(chat.id, seed.text, { scope: seed.scope, pageScope: seedPageScope, ...(seedBrowserWorkspace ? { browserTabId: seedBrowserTabId } : {}), references: seedReferences });
        if (unsentDraft) void wb.ai.chatDraft(chat.id, unsentDraft).catch(() => undefined);
        await request;
      } catch (e) {
        if (sequence === loadSequence.current) setError(errorText(e));
      }
      finally { markSending(chat.id, false); }
    })().catch(e => {
      if (sequence === loadSequence.current) setError(errorText(e));
    });
  }, [open, seed?.nonce]);
  useEffect(() => wb.ai.onChat(chat => {
    const summary = chatSummary(chat);
    setChats(previous => [summary, ...previous.filter(item => item.id !== chat.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setCurrent(previous => previous?.id === chat.id ? chat : previous);
    if (!summary.streaming) setQuestions(previous => { const next = { ...previous }; delete next[chat.id]; return next; });
  }), []);
  useEffect(() => wb.ai.onAsk(ask => setQuestions(previous => ({ ...previous, [ask.sessionId]: ask }))), []);
  useEffect(() => {
    if (!current) return;
    draftSnapshot.current = { id: current.id, text: input };
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const snapshot = draftSnapshot.current;
      if (snapshot?.id === current.id) {
        void wb.ai.chatDraft(snapshot.id, snapshot.text).catch(() => undefined);
        draftSnapshot.current = null;
      }
    }, 350);
    return () => window.clearTimeout(draftTimer.current);
  }, [current?.id, input]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = current ? scrollPositions.current.get(current.id) ?? element.scrollHeight : 0;
    measureScroll();
    const observer = new ResizeObserver(() => {
      if (followReply.current) element.scrollTop = element.scrollHeight;
      measureScroll();
    });
    observer.observe(element);
    if (messageList.current) observer.observe(messageList.current);
    return () => observer.disconnect();
  }, [current?.id, open, measureScroll]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followReply.current) element.scrollTop = element.scrollHeight;
    measureScroll();
  }, [current?.entries, measureScroll]);
  const jumpToBottom = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    measureScroll();
    element.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented || document.querySelector('dialog[open]') || Array.from(document.querySelectorAll<HTMLElement>('[popover]')).some(element => element.matches(':popover-open'))) return;
      if (referenceDialogOpen || managing) return;
      { onClose(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.ai-topbar-btn')?.focus()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, referenceDialogOpen, managing, onClose]);

  const visibleCurrent = current;
  const browserApprovals = useBrowserApprovalTasks(visibleCurrent);
  const pendingSiteTask = Object.values(browserApprovals.tasks).find(task => task.status === 'site-approval' && task.pendingOrigin);
  const lastBrowserEntries = new Map(visibleCurrent?.entries.flatMap(entry => entry.browserTask ? [[entry.browserTask.id, entry.id] as const] : []));
  const locateSiteApproval = (): void => { approvalCard.current?.focus({ preventScroll: true }); };
  const activeChat = chats.find(chat => chat.streaming);
  const streamingEntry = visibleCurrent?.entries.find(entry => entry.role === 'assistant' && entry.streaming);
  const currentBusy = !!streamingEntry;
  const busy = currentBusy || sending.includes(contextKey);
  const question = visibleCurrent ? questions[visibleCurrent.id] : undefined;
  const answerQuestion = (kind: 'option' | 'text' | 'skip', value?: string): void => {
    if (!question) return;
    wb.ai.answerAsk({ id: question.id, sessionId: question.sessionId, kind, value });
    setQuestions(previous => { const next = { ...previous }; delete next[question.sessionId]; return next; });
    setInput('');
  };
  const linkedPageScope = pageWorkbench === workbenchForScope(activeContext.scope) ? context.scope : activeContext.scope;
  const model = config?.models.find(item => item.id === config.activeModelId) ?? config?.models[0];
  const modelOptions = config?.providers.flatMap(provider => config.models.filter(item => item.providerId === provider.id)
    .map(item => ({ value: item.id, label: item.name, group: provider.name }))) ?? [];
  const activeWorkbench = workbenchForScope(activeContext.scope);
  const activeWorkbenchName = activeContext.scope.module === 'todo' ? TODO_AI_WORKBENCH_NAME : NAV.find(item => item.id === activeWorkbench)?.title ?? '其他工作台';
  const activeObjectName = activeContext.scope.module === 'todo' ? TODO_AI_WORKBENCH_NAME : activeContext.object;
  const contextForScope = (scope: AiScope): AiPanelContext => {
    const key = aiScopeKey(scope);
    if (scope.module === 'todo') return { scope, label: '日程待办', object: TODO_AI_WORKBENCH_NAME };
    if (key === aiScopeKey(pageContextRef.current.scope)) return pageContextRef.current;
    if (key === activeScopeKey) return { ...activeContext, object: objectNames[key] ?? activeContext.object };
    const recent = chats.find(chat => aiScopeKey(chatContextScope(chat)) === key);
    if (scope.module === 'reading') return { scope, label: objectNames[key] ? '阅读助手' : '阅读历史', object: objectNames[key] ?? recent?.title ?? '未关联书目' };
    const page = workbenchAiContext(scope.viewId);
    return { scope, label: page.label, object: page.object };
  };
  const orderedWorkbenches = [...NAV.filter(workbench => workbench.id === activeWorkbench), ...NAV.filter(workbench => workbench.id !== activeWorkbench)];
  const contextGroups: ChatGroup[] = orderedWorkbenches.filter(workbench =>
    defaultAiScopeForWorkbench(workbench.id) || chats.some(chat => workbenchForScope(chatScope(chat)) === workbench.id))
    .map(workbench => ({ id: workbench.id, label: workbench.id === 'todo' ? TODO_AI_WORKBENCH_NAME : workbench.title, emptyScope: defaultAiScopeForWorkbench(workbench.id) }));
  const contextOptions: ChatChoice[] = orderedWorkbenches.flatMap(workbench =>
    chats.filter(chat => workbenchForScope(chatScope(chat)) === workbench.id).map(chat => {
      const status = chat.streaming ? 'running' : chat.completed ? 'done' : undefined;
      const businessScope = chatContextScope(chat);
      const pageScope = chat.pageScope ?? businessScope;
      const detail = contextForScope(businessScope).object + (aiScopeKey(pageScope) === aiScopeKey(businessScope) ? '' : ` · ${contextForScope(pageScope).object}`);
      return { id: chat.id, title: chat.title, group: workbench.id === 'todo' ? TODO_AI_WORKBENCH_NAME : workbench.title, detail, updatedAt: chat.updatedAt, status, streaming: chat.streaming };
    }));
  const editReferences = (): void => {
    if (referenceDialogOpen) closeReferences();
    else setReferenceDialogOpen(true);
  };
  const selectModel = (id: string): void => {
    if (id === config?.activeModelId) return;
    setSwitchingModel(true); setModelError('');
    void wb.ai.activateModel(id).then(raw => setConfig(raw), e => setModelError(errorText(e)))
      .finally(() => {
        setSwitchingModel(false);
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) document.querySelector<HTMLButtonElement>('.ai-panel.open .ai-model-select .select-trigger')?.focus();
        });
      });
  };
  const newChat = (scope: AiScope = activeContext.scope): void => {
    flushDraft(); const sequence = ++loadSequence.current; const targetKey = activeScopeKey;
    void wb.ai.chatNew(scope).then(raw => {
      if (sequence !== loadSequence.current || activeScopeKeyRef.current !== targetKey) return;
      showChat(raw); void refreshChats();
    }, e => { if (activeScopeKeyRef.current === targetKey) setError(errorText(e)); });
  };
  const openChat = (id: string): void => {
    flushDraft(); const sequence = ++loadSequence.current; const targetKey = activeScopeKey;
    void wb.ai.chatOpen(id).then(raw => {
      if (sequence === loadSequence.current && activeScopeKeyRef.current === targetKey) showChat(raw);
    }, e => { if (activeScopeKeyRef.current === targetKey) setError(errorText(e)); });
  };
  const removeChat = (id: string): Promise<void> => {
    flushDraft(); const sequence = ++loadSequence.current; const targetKey = activeScopeKey;
    return wb.ai.chatRemove(id).then(raw => {
      if (sequence === loadSequence.current && activeScopeKeyRef.current === targetKey && visibleCurrent?.id === id) showChat(raw);
      setChats(previous => previous.filter(chat => chat.id !== id));
      void refreshChats();
    });
  };
  const manageChat = (chat: { id: string; title: string }): void => {
    setManaging(chat); setRenameDraft(chat.title); setManageError('');
  };
  const confirmManage = (): void => {
    if (!managing || manageBusy) return;
    setManageBusy(true); setManageError('');
    void wb.ai.chatRename(managing.id, renameDraft).then(() => setManaging(null), e => setManageError(errorText(e))).finally(() => setManageBusy(false));
  };
  const send = (): void => {
    if (voiceBusy) return;
    const text = input.trim();
    if (question && text) { answerQuestion('text', text); return; }
    if (!text || busy || sendingRef.current.has(contextKey) || switchingModel || !config?.aiEnabled) return;
    const targetKey = activeScopeKey;
    const sequence = loadSequence.current;
    window.clearTimeout(draftTimer.current); draftSnapshot.current = null;
    let sendingKey = contextKey;
    setInput(''); markSending(sendingKey, true); setError('');
    void (async () => {
      const browserTabId = browserWorkspace ? (await wb.browserAutomation.tabs(browserWorkspace)).find(tab => tab.active && tab.ready)?.id ?? null : undefined;
      const chat = visibleCurrent ?? await wb.ai.chatNew(activeContext.scope);
      if (sendingKey !== chat.id) { markSending(sendingKey, false); sendingKey = chat.id; markSending(sendingKey, true); }
      if (!visibleCurrent && sequence === loadSequence.current && activeScopeKeyRef.current === targetKey) {
        if (fixedContext) setFixedContexts(previous => ({ ...previous, [chat.id]: fixedContext }));
        if (references.length) setReferenceSelection({ key: referenceKeyForChat(chat.id), values: references });
        selectedChats.current.set(workspaceKey(chatScope(chat)), chat.id);
        setCurrent(chat);        void refreshChats();
      }
      const sentReferenceKey = visibleCurrent ? referenceContextKey : referenceKeyForChat(chat.id);
      try {
        const sendReferences = await checkedReferences(references, linkedPageScope, activeContext.scope, sentReferenceKey);
        await wb.ai.ask(chat.id, text, { scope: activeContext.scope, pageScope: linkedPageScope, ...(browserWorkspace ? { browserTabId } : {}), references: sendReferences });
      }
      catch (e) {
        if (sequence === loadSequence.current && referenceContextKeyRef.current === sentReferenceKey && activeScopeKeyRef.current === targetKey) { setError(errorText(e)); setInput(previous => previous || text); }
      } finally { markSending(sendingKey, false); }
    })().catch(e => { if (sequence === loadSequence.current && referenceContextKeyRef.current === referenceContextKey && activeScopeKeyRef.current === targetKey) { setError(errorText(e)); setInput(previous => previous || text); } markSending(sendingKey, false); });
  };
  const closePanel = (): void => {
    flushDraft(); onClose();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.ai-topbar-btn')?.focus());
  };

  return (
    <aside className={open ? 'ai-panel open' : 'ai-panel'} id="workbench-ai-panel" role="complementary" aria-label="AI 助手" aria-hidden={!open} inert={!open}>
      <div className="ai-resizer" role="separator" tabIndex={0} aria-label="调整助手宽度" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={480} aria-valuenow={width}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); onWidthChange(Math.min(480, width + 20)); }
          if (event.key === 'ArrowRight') { event.preventDefault(); onWidthChange(Math.max(340, width - 20)); }
        }}
        onPointerDown={event => {
          const element = event.currentTarget;
          const startX = event.clientX; const startWidth = width;
          element.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent): void => onWidthChange(Math.max(340, Math.min(480, startWidth + startX - next.clientX)));
          const end = (): void => {
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', end);
            element.removeEventListener('pointercancel', end);
          };
          element.addEventListener('pointermove', move);
          element.addEventListener('pointerup', end, { once: true });
          element.addEventListener('pointercancel', end, { once: true });
        }}
      />
      <header className="ai-panel-head">
        <span className="ai-panel-title"><Sparkle size={16} weight="fill" />AI 助手</span>


        <button className="ai-icon-btn" aria-label="收起 AI 助手" title="收起 AI 助手" onClick={closePanel}><SidebarSimple size={17} /></button>
      </header>
      {/* 协助对象卡:对象为主行(模块图标+名称+固定/跟随+范围说明),工作区并入对话选择器前缀 */}
      <div className={fixedContext ? 'ai-ctxcard pinned' : 'ai-ctxcard'}>
        <div className="ai-ctx-main">
          <span className="ai-ctx-modicon" aria-hidden="true" title={activeContext.label}>
{activeContext.scope.module === 'todo' ? <IconCheckSquare /> : pageWorkbench === 'settings' ? <GearSix size={16} /> : ({ home: IconHome, todo: IconCheckSquare, office: IconDocs, web: IconWeb, permission: IconShieldCheck, delivery: IconPackage, pbi: IconClipboardText, dts: IconBug, life: IconMoon } as const)[pageWorkbench ?? 'home']({})}
          </span>
          <div className="ai-ctx-body">
            <div className="ai-ctx-kicker">
              <span className="ai-ctx-modname">{activeContext.label}</span>
            </div>
            {/* 仅待办与日程无具体协助对象,不显示对象名(避免与次行工作区胶囊重复);其他工作台不动 */}
            {activeContext.scope.module !== 'todo' && (
              <div className="ai-ctx-name" aria-live="polite" title={activeObjectName}>{activeObjectName}</div>
            )}
          </div>
          <span className="ai-scope-tip">
            <button type="button" className="ai-ctx-info" aria-label="查看协助范围" aria-describedby="ai-scope-detail"><Info size={14} /></button>
            <span id="ai-scope-detail" className="ai-scope-tooltip" role="tooltip">{browserWorkspace ? '本对话保留当前协助对象，同时可操作当前浏览器标签。新站点需要授权，可随时接管或停止；切换工作台或收起助手后，进行中的任务继续操作原标签。' : SCOPE_TIPS[activeContext.scope.module] ?? SCOPE_TIP_DEFAULT}</span>
          </span>
        </div>
        <div className="ai-ctx-sub">
          <span className="ai-ctx-wschip" title={`当前工作区：${activeWorkbenchName}`}>{activeWorkbenchName}</span>
          <ChatPicker key={pageWorkbench ?? 'unknown'} currentId={visibleCurrent?.id} workbenchName={activeWorkbenchName} groups={contextGroups} choices={contextOptions} onNew={newChat} onOpen={openChat} onRename={manageChat} onDelete={removeChat} />
          <button type="button" className="ai-ctx-new" aria-label={`在${activeWorkbenchName}新建对话`} title={`在${activeWorkbenchName}新建对话`} onClick={() => newChat()}><Plus size={13} weight="bold" /></button>
        </div>
      </div>
          <div className="ai-chat-viewport">
          <div className="ai-messages" ref={scrollRef} role="region" aria-label="当前对话消息" tabIndex={0} onScroll={measureScroll}>
            <div className="ai-message-list" ref={messageList}>
            {!visibleCurrent || visibleCurrent.entries.length === 0 ? (
              <div className="ai-empty">
                <span className="ai-empty-avatar"><Sparkle size={24} weight="fill" /></span>
                <b>{activeContext.label}</b>
                <p>{activeContext.scope.module === 'todo' ? '查询待办、整理日程，修改会先让你确认。' : '说说你想解决的问题。'}</p>
              </div>
            ) : visibleCurrent.entries.map(entry => (
              <div key={entry.id} className={entry.role === 'user' ? 'ai-msg user' : 'ai-msg'}>
                {entry.role === 'user' && entry.contextScope && (aiScopeKey(entry.contextScope) !== activeScopeKey || (entry.pageScope && aiScopeKey(entry.pageScope) !== aiScopeKey(entry.contextScope))) &&
                  <span className="ai-message-tag">关联：{contextForScope(entry.contextScope).object}{entry.pageScope && aiScopeKey(entry.pageScope) !== aiScopeKey(entry.contextScope) ? ` · ${contextForScope(entry.pageScope).object}` : ''}</span>}
                {entry.role === 'user' && entry.referenceSnapshots?.length ? <span className="ai-message-tag">当时参考：{entry.referenceSnapshots.map(snapshot => snapshot.name).join('、')}</span> : null}
                {entry.role === 'assistant' ? <AiResponse entry={entry} showTyping={false} browserTask={entry.browserTask && lastBrowserEntries.get(entry.browserTask.id) === entry.id ? browserApprovals.tasks[entry.browserTask.id] : undefined}
                  approvalCardId={approvalCardId} onLocateApproval={locateSiteApproval} /> : <div className="ai-bubble">{entry.content}</div>}
                {entry.error && <div className="ai-error" role="alert">{entry.error}</div>}
                {entry.proposal && <TodoProposalCard key={entry.proposal.token} entry={entry} busy={busy}
                  apply={(token, indices) => wb.ai.apply(token, indices)} discard={token => wb.ai.discard(token)} />}
                {!entry.proposal && entry.actionState && entry.actionState !== 'pending' && <div className={'ai-action-state ' + entry.actionState}>
                  {({ applied: '已应用', discarded: '已保留原内容', expired: '已过期，未应用', revised: '已被后续建议替代', undone: '已撤销' } as const)[entry.actionState]}
                </div>}
              </div>
            ))}
            {error && <div className="ai-error" role="alert">{error}</div>}
            </div>
          </div>
          <AiActivity entry={streamingEntry} browserTask={streamingEntry?.browserTask ? browserApprovals.tasks[streamingEntry.browserTask.id] : undefined} question={!!question} aboveBottom={aboveBottom} onJump={jumpToBottom} />
          </div>
          <div className="ai-compose-wrap">
            {pendingSiteTask && <BrowserSiteApprovalCard key={`${pendingSiteTask.id}:${pendingSiteTask.pendingOrigin}`} task={pendingSiteTask} id={approvalCardId} elementRef={approvalCard} onTask={task => {
              browserApprovals.update(task, pendingSiteTask.pendingOrigin!);
              if (currentRef.current?.id === task.chatId && document.activeElement === document.body) composeAnchor.current?.querySelector('textarea')?.focus();
            }} />}
            {browserApprovals.error && <div className="ai-site-approval-error" role="alert">{browserApprovals.error}<button type="button" onClick={browserApprovals.retry}>重新读取</button></div>}
            {activeChat && activeChat.id !== visibleCurrent?.id && <div className="ai-busy-hint">其他对话正在执行，你可以在当前对话继续提问。</div>}
            {question && <div className="ai-proposal" role="group" aria-label="AI 澄清问题"><p>{question.question}</p><div className="ai-proposal-actions">
              {question.options.map(option => <button key={option.label} type="button" title={option.description} onClick={() => answerQuestion('option', option.label)}>{option.label}</button>)}
              <button type="button" onClick={() => answerQuestion('skip')}>跳过问题</button>
              <button type="button" onClick={() => visibleCurrent && wb.ai.cancel(visibleCurrent.id)}>停止此对话</button>
            </div></div>}
            <div className="ai-compose" ref={composeAnchor}>
              <div className="ai-compose-input">
                {references.length > 0 && <div className="ai-reference-row" aria-label="本轮只读参考资料">
                  {references.map(reference => <span className="ai-reference-chip" key={aiReferenceKey(reference)}><span title={objectNames[aiReferenceKey(reference)]}>{REFERENCE_LABELS[reference.module]} · {objectNames[aiReferenceKey(reference)] ?? '已关联内容'}</span><button type="button" aria-label={`移除参考：${objectNames[aiReferenceKey(reference)] ?? '已关联内容'}`} onClick={() => updateReferences(references.filter(item => aiReferenceKey(item) !== aiReferenceKey(reference)))}><X size={12} /></button></span>)}
                </div>}
                {referenceNotice && <p className="ai-reference-notice" role="status">{referenceNotice}</p>}
                <textarea aria-label="发送给当前对话的 AI 助手" value={input} placeholder={config?.aiEnabled ? '围绕正在协助的对象继续聊聊…' : '请先在模型配置中添加对话模型'} disabled={!config?.aiEnabled}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
                <div className="ai-compose-toolbar">
                  <button ref={referenceTrigger} type="button" className="ai-add-reference" aria-label="添加上下文" title="添加上下文" aria-haspopup="dialog" aria-controls={referencePickerId} aria-expanded={referenceDialogOpen} onClick={editReferences}><Plus size={19} /></button>
                  {config?.models.length ? <TodoSelect aria-label="选择大模型" className="ai-model-select" menuClassName="ai-model-menu ai-panel-model-menu" title={model?.name} value={model?.id ?? ''} onChange={selectModel}
                    options={modelOptions}
                    disabled={!open || busy || switchingModel || voiceBusy} />
                    : <button className="ai-text-btn" onClick={onOpenSettings}>配置模型</button>}
                  <SpeechInput anchor={composeAnchor} contextKey={contextKey + ':' + (visibleCurrent?.id ?? 'new')} draft={input} onChange={setInput}
                    enabled={!!config?.aiEnabled && !busy && !switchingModel} visible={open} onBusyChange={setVoiceBusy} />
                  {currentBusy && !question ? <button className="ai-send cancel" aria-label="停止生成" title="停止生成" onClick={() => visibleCurrent && wb.ai.cancel(visibleCurrent.id)}><Stop size={16} weight="fill" /></button>
                    : <button className="ai-send" aria-label={question ? '提交回答' : '发送'} title={question ? '提交回答' : '发送'} disabled={voiceBusy || !input.trim() || !config?.aiEnabled || !question && (busy || switchingModel)} onClick={send}><PaperPlaneRight size={16} weight="fill" /></button>}
                </div>
              </div>
            </div>
            {modelError && <div className="ai-model-error" role="alert">{modelError}</div>}
          </div>
      {referenceDialogOpen && open && <AiReferencePicker id={referencePickerId} mode={referenceMode}
        unavailable={plannedWorkbench ? '工作台尚未开放，暂无可关联内容' : pageReferenceMode ? '当前协助对象与此页面不同，请先取消固定或切换对话后添加上下文。' : '当前没有可关联内容'}
        options={selectableReferences} selected={references} loading={referenceMode !== null && (referenceList.key !== referenceContextKey || referenceList.loading)}
        error={referenceList.key === referenceContextKey ? referenceList.error : ''} notice={referenceNotice} anchor={composeAnchor} trigger={referenceTrigger}
        onChange={updateReferences} onRetry={() => setReferenceReload(value => value + 1)} onClose={closeReferences} />}
      {managing && <Modal title="重命名对话" className="ai-chat-manage-dialog" close={() => { if (!manageBusy) setManaging(null); }}>
        <form noValidate onSubmit={event => { event.preventDefault(); confirmManage(); }}>
          <label htmlFor="ai-chat-rename">对话名称</label><input ref={renameInput} id="ai-chat-rename" value={renameDraft} maxLength={80} disabled={manageBusy} onChange={event => setRenameDraft(event.target.value)} />
          {manageError && <p className="error" role="alert">{manageError}</p>}
          <div className="actions"><button type="button" disabled={manageBusy} onClick={() => setManaging(null)}>取消</button><button type="submit" className="primary" disabled={manageBusy || !renameDraft.trim()}>{manageBusy ? '保存中…' : '保存'}</button></div>
        </form>
      </Modal>}
    </aside>
  );
}
