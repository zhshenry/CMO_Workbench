import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowClockwise, ArrowRight, CalendarBlank, CalendarDots, Check, EnvelopeSimple, FolderSimple, FunnelSimple, LinkSimple, TextAlignLeft, Tray, UserCircle, UsersThree, Warning } from '@phosphor-icons/react';
import type { BotAction } from '../../shared/bot-contracts';
import { officeBriefSections, type OfficeAutomation, type OfficeBriefMeeting, type OfficeConversationPage, type OfficeCoverage, type OfficeDailyBrief, type OfficeItem, type OfficeMatchRange, type OfficeMaterial, type OfficeMaterialKind, type OfficeMaterialRow, type OfficeRef, type OfficeScene, type OfficeSearch, type OfficeSearchResult, type OfficeSnapshot, type OfficeWorkflow } from '../../shared/office-workbench';
import { aiPlanSchema } from '../../shared/todo-contracts';
import { chinaDay, nextDay } from '../../shared/welink-agenda';
import { DatePicker, errorText, Modal, Segmented, Select, TimePicker } from '../ui/controls';
import { OfficePortal } from './OfficePortal';
import './office-workbench.css';

type Tab = 'inbox' | 'brief' | 'materials';
const kinds = {
  direct: { name: '私聊', icon: UserCircle },
  group: { name: '群消息', icon: UsersThree },
  mail: { name: '邮件', icon: EnvelopeSimple },
  meeting: { name: '日程', icon: CalendarDots },
};
const itemLabels: Record<OfficeItem['kind'], string> = { awaiting: '消息跟进', commitment: '承诺跟进', mail: '邮件跟进', meeting: '日程跟进' };
const itemLabel = (item: OfficeItem) => item.needsReplyReview && !item.followUp ? '回复待核对' : itemLabels[item.kind];
const displayTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const clockTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const weekdayName = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' });
const stamp = (at: number | null) => at === null ? '时间未提供' : displayTime.format(at);
const dayText = (value: string) => Number(value.slice(5, 7)) + '月' + Number(value.slice(8, 10)) + '日';
const dueText = (value: string | null) => value === null ? '截止时间待核对' : value.includes('T') ? stamp(Date.parse(value)) + ' 前' : dayText(value);
const refreshLabel = '更新消息及邮件';
const refreshSources = [['messages', 'WeLink'], ['mail', '邮件'], ['agenda', '日程']] as const;
const refreshSourceStatus: Record<OfficeCoverage['state'], string> = {
  fresh: '已更新', cached: '沿用上次结果', partial: '部分读取', unavailable: '暂不可用', unread: '尚未读取',
};
const listLimit = 80;
const materialRanges = [{ value: 'focus', label: '重点消息' }, { value: 'all', label: '全部已读取' }];
const sourceKey = (row: OfficeMaterialRow) => row.conversation ?? row.id;
const conversationTones = ['blue', 'violet', 'teal', 'rose', 'amber'];
const messageAvatarTones = ['blue', 'rose', 'amber', 'teal', 'violet'];
const briefSectionTitles = { awaiting: '待回复', commitments: '承诺跟进', groups: '相关群消息', mail: '重要邮件' };

function conversationTone(key: string, tones = conversationTones) {
  const hash = [...key].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return tones[hash % tones.length];
}

function materialListTime(row: OfficeMaterialRow, today: string) {
  if (row.at === null) return '时间未提供';
  const day = chinaDay(row.at);
  if (row.kind === 'meeting') return day === today ? '今天' : day === nextDay(today) ? '明天' : dayText(day);
  return day === today ? clockTime.format(row.at) : stamp(row.at);
}

function meetingTimeRange({ dateAt, endAt }: NonNullable<OfficeMaterial['meeting']>) {
  const format = (value: string) => value.includes('T') ? stamp(Date.parse(value)) : dayText(value);
  const start = format(dateAt);
  if (!endAt || dateAt === endAt && !dateAt.includes('T')) return start;
  const sameDay = dateAt.includes('T') && endAt.includes('T') && chinaDay(Date.parse(dateAt)) === chinaDay(Date.parse(endAt));
  return `${start}–${sameDay ? clockTime.format(Date.parse(endAt)) : format(endAt)}`;
}

function Coverage({ label, coverage }: { label: string; coverage: OfficeCoverage }) {
  const updated = coverage.lastSuccessAt === null ? '' : stamp(coverage.lastSuccessAt);
  if (label === '日程' && coverage.state === 'fresh' && !updated) return <span title={coverage.scope}>日程待办</span>;
  const title = coverage.state === 'cached' ? '沿用' : coverage.state === 'partial' ? '部分读取' : coverage.state === 'unavailable' ? '暂不可用'
    : coverage.state === 'unread' ? '等待读取' : updated ? '更新于' : '本地日程';
  return <span data-state={coverage.state} title={[coverage.scope, coverage.detail].filter(Boolean).join(' · ')}>{label} {title}{updated && ' ' + updated}</span>;
}

function SourceLink({ source, open }: { source: OfficeRef; open(source: OfficeRef): void }) {
  return <button type="button" className="office-ref" onClick={() => open(source)}><LinkSimple size={14} />{source.label}</button>;
}

function MatchedText({ text, matches }: { text: string; matches?: OfficeMatchRange[] }) {
  if (!matches?.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of [...matches].sort((a, b) => a.start - b.start)) {
    if (start < 0 || end > text.length || end <= Math.max(cursor, start)) continue;
    parts.push(text.slice(cursor, start), <mark className="office-rule-match" key={end}>{text.slice(Math.max(cursor, start), end)}</mark>);
    cursor = end;
  }
  return <>{parts}{text.slice(cursor)}</>;
}

function BriefSection({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (!rows.length) return null;
  return <section aria-label={title}>
    <h3>{title}</h3>{rows.slice(0, 2)}
    {rows.length > 2 && <details className="office-brief-more"><summary>查看其余 {rows.length - 2} 条</summary>{rows.slice(2)}</details>}
  </section>;
}

function meetingTime(row: OfficeBriefMeeting, day: string) {
  const meeting = row.meeting;
  if (!meeting) return row.at === null ? '时间待核对' : stamp(row.at);
  if (!meeting.dateAt.includes('T')) return '全天';
  const time = (value: string) => {
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? chinaDay(instant) === day ? clockTime.format(instant) : stamp(instant) : '时间待核对';
  };
  return [time(meeting.dateAt), meeting.endAt && time(meeting.endAt)].filter(Boolean).join('–');
}

interface Props {
  workspaceHeader?: HTMLElement | null;
  settingsOpen: boolean;
  sourceRequest?: { source: OfficeRef; nonce: number };
  onSettings(): void;
  onMeeting(taskId: string): void;
  onTask(taskId: string): void;
  onAnalyze(scene: OfficeScene, label: string): void;
  onPrepared(action: BotAction): void;
}

export function OfficeView({ workspaceHeader, settingsOpen, sourceRequest, onSettings, onMeeting, onTask, onAnalyze, onPrepared }: Props) {
  const api = window.workbench.officeWorkbench;
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>();
  const accountKey = snapshot?.accountKey;
  const [workflowState, setWorkflow] = useState<OfficeWorkflow>(), [brief, setBrief] = useState<OfficeDailyBrief | null>(null);
  const workflow = snapshot?.connected && workflowState?.accountKey === snapshot.accountKey ? workflowState : undefined;
  const workflowVersion = useRef(0);
  const [briefDay, setBriefDay] = useState(''), [job, setJob] = useState('');
  const briefFocus = useRef('');
  const [tab, setTab] = useState<Tab>('inbox');
  const [inboxSource, setInboxSource] = useState<'messages' | 'portal'>('messages');
  const showingPortal = tab === 'inbox' && inboxSource === 'portal';
  const [itemId, setItemId] = useState<string>();
  const [todoToConfirm, setTodoToConfirm] = useState<OfficeItem>();
  const [selection, setSelection] = useState<{ source: OfficeMaterialRow | string; query: OfficeSearch; accountKey?: string; locate?: boolean }>();
  const [loadedMaterial, setMaterial] = useState<{ value: OfficeMaterial; accountKey: string }>();
  const [sourceError, setSourceError] = useState('');
  const [sourceRetry, setSourceRetry] = useState(0);
  const [query, setQuery] = useState<OfficeSearch>({ range: 'focus' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchResults, setResults] = useState<OfficeSearchResult & { query: OfficeSearch; accountKey: string; nextOffset: number; revision: number }>();
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchVersion = useRef(0), searchDelay = useRef(0);
  const [busy, setBusy] = useState<'refresh' | 'propose' | 'dismiss' | 'link'>();
  const refreshing = busy === 'refresh';
  const operation = useRef(false), version = useRef(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState<string | { refresh: string }>('');
  const [refreshFeedback, setRefreshFeedback] = useState<{ accountKey: string; partial?: OfficeSnapshot['coverage'] }>();
  const [refreshDetailsDismissed, setRefreshDetailsDismissed] = useState(false);
  const refreshDetailsId = useId();
  useEffect(() => {
    if (refreshing || !refreshFeedback || refreshFeedback.partial) return;
    const timer = setTimeout(() => setRefreshFeedback(undefined), 2000);
    return () => clearTimeout(timer);
  }, [refreshing, refreshFeedback]);
  const detailHeading = useRef<HTMLHeadingElement>(null), linkedConversationRow = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => new Map(snapshot?.materials.map(row => [row.id, row])), [snapshot]);
  const commitments = useMemo(() => new Map(workflow?.commitments.map(item => [item.id, item])), [workflow?.commitments]);
  const items = useMemo(() => {
    const pending = new Map(snapshot?.followUps?.items.map(item => [item.id, item]));
    for (const item of commitments.values()) {
      if (item.status === 'handled' || item.status === 'done') pending.delete(item.id);
      else if (item.status === 'linked' && (pending.has(item.id) || item.followUp)) pending.set(item.id, { ...(pending.get(item.id) ?? item), deadline: item.deadline });
      else if (item.followUp && !pending.has(item.id)) pending.set(item.id, item);
    }
    return pending;
  }, [snapshot, commitments]);
  const inboxItems = [...items.values()];
  const selectedItem = items.get(itemId ?? '') ?? inboxItems[0];
  const linkedTodo = selectedItem ? commitments.get(selectedItem.id)?.taskId : undefined;
  const results = searchResults?.accountKey === accountKey ? searchResults : undefined;
  const shownQuery = results?.query ?? query;
  const sourceSelection = selection?.query === shownQuery && (selection.accountKey === undefined || selection.accountKey === accountKey) ? selection.source : undefined;
  const material = loadedMaterial?.accountKey === accountKey ? loadedMaterial?.value : undefined;
  const linkedMessage = selection?.locate && material?.conversation && material.id === sourceSelection ? material : undefined;
  const foundRows = results?.rows ?? [];
  const linkedRow = linkedMessage && foundRows.find(row => row.conversation === linkedMessage.conversation);
  const visibleRows = linkedMessage && !linkedRow ? [linkedMessage, ...foundRows] : foundRows;
  const selectedListRow = linkedRow ?? linkedMessage ?? (typeof sourceSelection === 'string' ? visibleRows.find(row => row.id === sourceSelection)
    : (sourceSelection && visibleRows.find(row => sourceKey(row) === sourceKey(sourceSelection))) ?? visibleRows[0]);
  const selectedConversation = linkedMessage?.conversation ?? (typeof sourceSelection !== 'string' ? selectedListRow?.conversation : undefined);
  const selectedSource = typeof sourceSelection === 'string' ? sourceSelection : selectedConversation ? undefined : selectedListRow?.id;
  const materialVisible = material?.id === selectedSource ? material : undefined;
  const selectedRow = selectedConversation ? selectedListRow : materialVisible ?? (selectedSource ? rows.get(selectedSource) : undefined) ?? selectedListRow;
  useEffect(() => {
    if (linkedMessage && tab === 'materials') linkedConversationRow.current?.scrollIntoView({ block: 'nearest' });
  }, [linkedMessage, linkedRow?.id, tab]);

  const read = useCallback(async () => {
    if (operation.current) return;
    const request = ++version.current;
    try {
      const result = await api.state(tab === 'brief');
      if (request === version.current && !operation.current) { setSnapshot(result); setError(''); }
    } catch (cause) { if (request === version.current && !operation.current) setError(errorText(cause)); }
  }, [api, tab]);

  useEffect(() => {
    if (settingsOpen) { setSnapshot(undefined); setMaterial(undefined); return; }
    void read();
    const refresh = () => { void read(); };
    const offTodo = window.workbench.todo.onChanged(refresh);
    const offMessages = window.workbench.island.onWelinkMessagesChanged(refresh);
    const offAgenda = window.workbench.island.onWelinkSyncChanged(refresh);
    const offOffice = api.onChanged(refresh);
    return () => { version.current++; offTodo(); offMessages(); offAgenda(); offOffice(); };
  }, [api, read, settingsOpen]);

  const readWorkflow = useCallback(async () => {
    const request = ++workflowVersion.current;
    try {
      const value = await api.workflow();
      if (request === workflowVersion.current) setWorkflow(value);
    } catch (cause) {
      if (request === workflowVersion.current) throw cause;
    }
  }, [api]);

  useEffect(() => {
    if (settingsOpen || !snapshot?.connected) { setWorkflow(undefined); setBrief(null); return; }
    let active = true;
    const update = () => {
      void readWorkflow().catch(cause => { if (active) setError(errorText(cause)); });
      if (tab === 'brief') void api.brief(briefDay || undefined).then(value => { if (active) setBrief(value); }, cause => { if (active) setError(errorText(cause)); });
    };
    update();
    const off = api.onChanged(update), offTodo = window.workbench.todo.onChanged(update);
    return () => { active = false; workflowVersion.current++; off(); offTodo(); };
  }, [api, readWorkflow, tab, briefDay, settingsOpen, snapshot?.connected, snapshot?.accountKey]);

  async function runJob(label: string, work: () => Promise<void>) {
    if (job) return;
    setJob(label); setError(''); setNotice('');
    try { await work(); await readWorkflow(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setJob(''); }
  }

  function configure(update: Partial<OfficeAutomation>) {
    if (!workflow || job) return;
    const previous = workflow.settings, settings = { ...previous, ...update };
    setWorkflow({ ...workflow, settings });
    void runJob('正在保存设置', async () => {
      try { await api.configure(settings); }
      catch (cause) { setWorkflow(current => current && { ...current, settings: previous }); throw cause; }
    });
  }

  const readSearch = useCallback(async (input: OfficeSearch, append = false, live = false) => {
    if (accountKey === undefined) return;
    const version = ++searchVersion.current;
    setSearchBusy(true); setSearchError('');
    try {
      const next = await api.search({ ...input, ...(live && { live: true }), limit: listLimit }, true);
      if (version !== searchVersion.current) return;
      setResults(previous => {
        const nextOffset = (input.offset ?? 0) + next.rows.length;
        if (!append || previous?.accountKey !== accountKey) return { ...next, query: input, accountKey, nextOffset, revision: version };
        const bySource = new Map([...previous.rows, ...next.rows].map(row => [sourceKey(row), row]));
        return { ...previous, rows: [...bySource.values()], total: next.total, nextOffset };
      });
    } catch (cause) {
      if (version === searchVersion.current) {
        if (!append) setResults(previous => previous?.query === input ? previous : undefined);
        setSearchError(errorText(cause));
      }
    } finally { if (version === searchVersion.current) setSearchBusy(false); }
  }, [api, accountKey]);

  useEffect(() => {
    if (tab !== 'materials' || settingsOpen || accountKey === undefined) return;
    const scheduled = searchVersion.current;
    const timer = setTimeout(() => { if (scheduled === searchVersion.current) void readSearch(query); }, searchDelay.current);
    searchDelay.current = 0;
    return () => { clearTimeout(timer); searchVersion.current++; };
  }, [readSearch, query, tab, settingsOpen, accountKey, snapshot?.connected, snapshot?.coverage.messages.lastSuccessAt, snapshot?.coverage.mail.lastSuccessAt,
    snapshot?.unreadMail.lastSuccessAt, snapshot?.coverage.agenda.lastSuccessAt, snapshot?.unreadMail.state, snapshot?.coverage.mail.state,
    snapshot?.followUps?.checkedAt, snapshot?.followUps?.pending]);

  function changeQuery(next: OfficeSearch) {
    searchVersion.current++;
    searchDelay.current = next.keyword === query.keyword ? 0 : 180;
    setQuery(next); setSearchBusy(true); setSearchError(''); setNotice('');
  }

  function showSource(id: string, scope = shownQuery, locate = false) {
    setSelection({ source: id, query: scope, accountKey, locate });
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  }
  function openSource(source: OfficeRef) {
    const next: OfficeSearch = { range: query.range };
    changeQuery(next);
    setResults(undefined);
    setTab('materials');
    showSource(source.id, next, true);
  }
  useEffect(() => { if (sourceRequest) openSource(sourceRequest.source); }, [sourceRequest]);

  useEffect(() => {
    if (tab !== 'materials' || !selectedSource || settingsOpen || accountKey === undefined) return;
    let active = true;
    setSourceError('');
    void api.material(selectedSource).then(value => {
      if (!active) return;
      setMaterial({ value, accountKey });
      if (value.kind === 'mail' && value.text && !value.preserved) void read();
    }, cause => { if (active) setSourceError(errorText(cause)); });
    return () => { active = false; };
  }, [api, read, selectedSource, sourceRetry, tab, settingsOpen, accountKey]);

  function openItem(item: OfficeItem) {
    setItemId(item.id);
    setInboxSource('messages');
    setTab('inbox');
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  }
  async function act(action: 'refresh' | 'propose' | 'dismiss' | 'link', item?: OfficeItem) {
    if (operation.current) return;
    operation.current = true;
    version.current++;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'refresh') {
        setRefreshFeedback(undefined); setRefreshDetailsDismissed(false);
        let next = await api.refresh();
        if (tab === 'brief') next = await api.state(true);
        setSnapshot(next);
        setMaterial(undefined); setSourceRetry(value => value + 1);
        if (!next.connected) setNotice('请登录 WeLink 后读取消息和邮件。');
        else {
          const incomplete = Object.values(next.coverage).filter(source => source.state !== 'fresh');
          setNotice({ refresh: incomplete.some(source => source.state !== 'unread') ? '已更新可用资料。请核对各来源的读取状态。' : '办公资料已更新。' });
          setRefreshFeedback({ accountKey: next.accountKey, partial: incomplete.length ? next.coverage : undefined });
          await readWorkflow();
        }
      } else if (item && action === 'dismiss') {
        setSnapshot(await api.dismiss(item.id));
        if (item.kind === 'commitment') {
          workflowVersion.current++;
          setWorkflow(current => current && { ...current, commitments: current.commitments.map(entry => entry.id === item.id ? { ...entry, status: 'handled' } : entry) });
        }
        setNotice('已标为已处理。');
      } else if (item) {
        const prepared = await api.proposeTodo(item.id);
        if (action === 'link') {
          let result = prepared;
          if (prepared.status === 'pending') {
            const { actions } = aiPlanSchema.parse(prepared.payload.plan);
            const [next] = actions;
            if (actions.length !== 1 || next?.type !== 'create' || next.task.title !== item.title || next.task.dateAt !== item.deadline) {
              throw new Error('已有待办建议与当前承诺不同，请在办公助理对话中核对。');
            }
            result = await window.workbench.bot.answerAction(prepared.id, prepared.revision, { approved: true, indices: [0] });
          }
          if (result.status !== 'applied') throw new Error(result.error || '暂时无法确认待办是否已创建，请刷新后核对。');
          setTodoToConfirm(undefined);
          setNotice(prepared.status === 'applied' ? '这条承诺已有待办记录。' : '已加入日程待办。');
          try { await readWorkflow(); }
          catch { setNotice(`待办已保存。点击「${refreshLabel}」后可查看关联。`); }
          requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
        } else {
          onPrepared(prepared);
          setNotice(prepared.status === 'applied' ? '这条待办建议已应用，可在原对话查看回执。' : '待办建议已放到办公助理对话。');
        }
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { operation.current = false; setBusy(undefined); }
  }

  const originalId = materialVisible?.originalId ?? selectedSource;
  const availableItem = originalId && inboxItems.find(item => item.source.id === originalId || item.source.id === selectedSource || item.related?.id === originalId);
  const relatedAction = availableItem && <button type="button" className="text-button office-more" onClick={() => openItem(availableItem)}>查看关联事项 <ArrowRight size={14} /></button>;
  const meeting = materialVisible?.meeting;
  const materialActions = materialVisible?.kind === 'meeting' ? <>
    {meeting && <button type="button" className="btn btn-pri btn-sm" onClick={() => onMeeting(meeting.taskId)}><CalendarBlank size={15} aria-hidden="true" />打开日程详情</button>}
    <button type="button" className="btn btn-sec btn-sm" onClick={() => onAnalyze({ kind: 'prep', sourceId: materialVisible.id }, `整理「${materialVisible.title}」会前材料`)}>整理会前材料</button>
    {relatedAction}
  </> : relatedAction;
  const itemRow = selectedItem ? rows.get(selectedItem.source.id) : undefined;
  const reviewPending = snapshot?.followUps?.pending ?? 0;
  const activeBrief = brief?.day === (briefDay || snapshot?.day) ? brief : null;
  const dailyItems: (OfficeItem & { why?: string })[] = activeBrief ? activeBrief.items : !briefDay
    ? (snapshot?.items.filter(item => snapshot.brief.priorities.includes(item.id) && !['done', 'handled'].includes(commitments.get(item.id)?.status ?? '')) ?? []) : [];
  const dailyMeetings = activeBrief ? activeBrief.meetings : !briefDay
    ? (snapshot?.brief.meetings.flatMap(id => rows.get(id) ?? []) ?? []) : [];
  const briefSections = activeBrief?.sections;
  const todaySections = brief?.day === snapshot?.day ? brief?.sections : undefined;
  const coverage = tab === 'brief' ? activeBrief?.coverage ?? (!briefDay ? snapshot?.coverage : undefined) : snapshot?.coverage;
  const jobLabel = tab === 'brief' && activeBrief?.organizing ? '规则清单已就绪，AI 正在整理…' : job;
  const finishedCommitments = new Set(!briefDay ? workflow?.commitments.filter(item => item.status === 'done' || item.status === 'handled').map(item => item.id) : []);
  const hasBriefEntries = briefSections && officeBriefSections.some(key => briefSections[key].some(entry => !entry.itemId || !finishedCommitments.has(entry.itemId)));
  const showBriefNotices = !briefDay && !!workflow?.notices.length;
  const briefEmpty = !dailyMeetings.length && !(briefSections ? hasBriefEntries : dailyItems.length) && !showBriefNotices;
  useEffect(() => {
    if (tab !== 'brief' || briefDay || !briefFocus.current) return;
    const item = document.getElementById('office-brief-' + briefFocus.current);
    if (!item) return;
    const more = item.closest('details');
    if (more) more.open = true;
    item.focus(); briefFocus.current = '';
  }, [tab, briefDay, activeBrief, snapshot]);

  const tabLabels = { inbox: '待处理', brief: '简报', materials: '消息及邮件' };
  const connection = snapshot?.welinkConnection;
  const connectPrompt = snapshot?.connected === false && <>
    <span role="status">{connection === 'client-closed' ? '请打开 WeLink 桌面客户端，连接恢复后会继续读取。'
      : connection === 'temporary' ? '暂时无法确认 WeLink 连接，稍后会自动重试。'
      : '请在设置中扫码登录 WeLink，再读取工作消息和邮件。'}</span>
    <button type="button" className="text-button" onClick={onSettings}>打开 W3和Welink接入</button>
  </>;
  const showLoginEmpty = !!connectPrompt && (
    tab === 'materials' && !selectedSource && !visibleRows.length && !snapshot?.materials.length
    || tab === 'inbox' && !inboxItems.length || tab === 'brief' && briefEmpty
  );
  const connectionNotice = connectPrompt && <div className={showLoginEmpty ? 'office-connect office-connect-empty' : 'office-connect'}>{connectPrompt}</div>;
  const pendingCount = inboxItems.filter(item => !commitments.get(item.id)?.taskId).length;
  const materialsTab = tab === 'materials';
  const lastMaterialUpdateAt = Math.max(snapshot?.coverage.messages.lastSuccessAt ?? 0, snapshot?.coverage.mail.lastSuccessAt ?? 0);
  const activeRefresh = materialsTab && snapshot?.connected && !settingsOpen && !refreshing && !error
    && refreshFeedback?.accountKey === accountKey ? refreshFeedback : undefined;
  const partialRefresh = activeRefresh?.partial;
  const refreshComplete = !!activeRefresh && !partialRefresh;
  const RefreshIcon = partialRefresh ? Warning : refreshComplete ? Check : ArrowClockwise;
  const panelNotice = error || jobLabel || (typeof notice === 'string' ? notice : materialsTab ? '' : notice.refresh);
  const queryingMessages = query.kind !== 'mail' && query.kind !== 'meeting';
  const tabs = <Segmented aria-label="办公助理视图" variant="content" value={tab} onChange={value => setTab(value as Tab)}
    options={[
      { value: 'inbox', label: tabLabels.inbox + (pendingCount ? ' ' + pendingCount : ''), icon: <Tray size={16} aria-hidden="true" /> },
      { value: 'materials', label: tabLabels.materials, icon: <FolderSimple size={16} aria-hidden="true" /> },
      { value: 'brief', label: tabLabels.brief, icon: <TextAlignLeft size={16} aria-hidden="true" /> },
    ]} />;

  return <section id="view-office" className="view on office-workspace" aria-label="办公助理工作区">
    {workspaceHeader && createPortal(tabs, workspaceHeader)}
    <header className="office-header">
      <div className="office-heading">
        <h1>{tabLabels[tab]}</h1>
        {materialsTab && snapshot && <span className="office-last-update">
          {lastMaterialUpdateAt ? <>上次更新 <time dateTime={new Date(lastMaterialUpdateAt).toISOString()}>
            {chinaDay(lastMaterialUpdateAt) === snapshot.day ? clockTime.format(lastMaterialUpdateAt) : stamp(lastMaterialUpdateAt)}
          </time></> : '尚未更新'}
        </span>}
      </div>
      {tab !== 'materials' && snapshot && coverage && <div className="office-coverage" aria-label="数据来源和更新时间" aria-hidden={showingPortal || undefined}>
        <span>近期消息 36 小时</span>
        <Coverage label="WeLink" coverage={coverage.messages} />
        <Coverage label="邮件" coverage={coverage.mail} />
        <Coverage label="日程" coverage={coverage.agenda} />
      </div>}
      <div className="office-refresh" data-materials={materialsTab || undefined} data-dismissed={refreshDetailsDismissed || undefined}
        data-result={partialRefresh ? 'partial' : refreshComplete ? 'complete' : undefined}
        aria-hidden={showingPortal || undefined} inert={showingPortal}
        onPointerEnter={() => setRefreshDetailsDismissed(false)} onFocus={() => setRefreshDetailsDismissed(false)}
        onKeyDown={event => {
          if (event.key !== 'Escape' || !partialRefresh || refreshDetailsDismissed) return;
          event.stopPropagation();
          setRefreshDetailsDismissed(true);
        }}>
        <button type="button" className="btn btn-sec btn-sm" aria-label={materialsTab ? refreshLabel : undefined}
          aria-describedby={partialRefresh ? refreshDetailsId : undefined} aria-busy={refreshing}
          aria-disabled={materialsTab && !!busy || undefined} disabled={!materialsTab && !!busy} onClick={() => void act('refresh')}>
          <RefreshIcon size={15} aria-hidden="true" />{refreshing ? '正在更新…' : refreshComplete ? '已更新' : refreshLabel}
        </button>
        {partialRefresh && <div id={refreshDetailsId} className="office-refresh-tooltip" role="tooltip">
          <strong>部分资料未取全</strong>
          <dl>{refreshSources.map(([source, label]) => {
            const result = partialRefresh[source];
            return <div key={source} data-state={result.state}><dt>{label}</dt>
              <dd>{source === 'agenda' && result.state === 'fresh' ? result.lastSuccessAt === null ? '本地日程' : '已同步' : refreshSourceStatus[result.state]}</dd>
            </div>;
          })}</dl>
        </div>}
        {materialsTab && <span className="office-refresh-status" role="status">{partialRefresh ? '部分资料未取全' : refreshComplete ? '办公资料已更新' : ''}</span>}
      </div>
    </header>
    <div className="office-panel">
      {!workspaceHeader && <div className="office-tabs">{tabs}</div>}
      {tab === 'inbox' && <div className="office-searchbar">
        <Segmented aria-label="待处理来源" value={inboxSource} onChange={value => setInboxSource(value === 'portal' ? 'portal' : 'messages')}
          options={[{ value: 'messages', label: '消息跟进' }, { value: 'portal', label: 'W3 门户' }]} />
        {!showingPortal && !!reviewPending && <button type="button" className="btn btn-sec btn-sm" disabled={!!job || !!busy} onClick={() => void runJob('AI 正在判断重点消息…', async () => {
          const count = await api.review(); await read(); setNotice(count ? `AI 已判断 ${count} 条重点消息。` : '没有新增判断结果。');
        })}>AI 判断待处理 · {reviewPending}</button>}
      </div>}
      {!showingPortal && !todoToConfirm && panelNotice && <p className={error ? 'office-notice is-error' : 'office-notice'} role={error ? 'alert' : 'status'}>{panelNotice}</p>}
      {showingPortal ? (!settingsOpen && <OfficePortal onTask={onTask} onSettings={onSettings} />)
        : !snapshot ? <p className="office-empty" role="status">{error ? `使用「${refreshLabel}」重试。` : '正在读取办公资料…'}</p> : tab === 'inbox' ? (<>
        {connectionNotice}
        {inboxItems.length ? <div className="office-split">
          <div className="office-list" aria-label="待处理事项">{inboxItems.map(item =>
            <button type="button" className="office-row" aria-pressed={item.id === selectedItem?.id} key={item.id} onClick={() => setItemId(item.id)}>
              <strong>{item.title}</strong><span>{commitments.get(item.id)?.taskId ? '已转待办' : itemLabel(item)}{item.deadline ? ' · ' + dueText(item.deadline) : ''}</span>
            </button>)}</div>
          {selectedItem && <article className="office-detail" aria-label="待处理详情">
            <h2 tabIndex={-1} ref={detailHeading}>{selectedItem.title}</h2>
            <p className="office-byline">{linkedTodo ? '已转待办' : itemLabel(selectedItem)}{itemRow && ' · ' + itemRow.title + ' · ' + itemRow.byline + ' · ' + stamp(itemRow.at)}</p>
            <p className="office-deadline">{dueText(selectedItem.deadline)}</p>
            {selectedItem.followUp && <>
                {selectedItem.followUp.nextStep !== selectedItem.title && <p className="office-reason"><strong>下一步</strong> · {selectedItem.followUp.nextStep}</p>}
              <p className="office-reason">{selectedItem.followUp.reason}</p>
              <blockquote className="office-quote">{selectedItem.followUp.evidence}</blockquote>
            </>}
            <div className="office-links"><SourceLink source={selectedItem.source} open={openSource} />
              {selectedItem.related && <button type="button" className="text-button" onClick={() => openSource(selectedItem.related!)}>
                {selectedItem.related.at === null ? '关联会议' : clockTime.format(selectedItem.related.at)} · {selectedItem.related.title} <ArrowRight size={14} />
              </button>}
              {(snapshot.brief.priorities.includes(selectedItem.id) || todaySections
                && officeBriefSections.some(key => todaySections[key].some(item => item.itemId === selectedItem.id))) && <button type="button" className="text-button" onClick={() => {
                briefFocus.current = selectedItem.id;
                setBriefDay(''); setTab('brief');
              }}>在简报查看 <ArrowRight size={14} /></button>}
            </div>
            <div className="office-actions">
              {linkedTodo ? <button type="button" className="btn btn-pri btn-sm" onClick={() => onTask(linkedTodo)}>打开关联待办</button> : <>
                {selectedItem.kind === 'commitment'
                  ? <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => { setError(''); setTodoToConfirm(selectedItem); }}>转待办</button>
                  : <>{selectedItem.kind !== 'meeting' && <button type="button" className="btn btn-sec btn-sm" onClick={() => onAnalyze({ kind: 'draft', sourceId: selectedItem.source.id }, `为「${selectedItem.title}」起草回复`)}>起草回复</button>}
                    <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => void act('propose', selectedItem)}>{busy === 'propose' ? '正在生成…' : '生成待办建议'}</button></>}
                <button type="button" className="text-button" disabled={!!busy} onClick={() => void act('dismiss', selectedItem)}>标为已处理</button>
              </>}
            </div>
          </article>}
        </div> : !showLoginEmpty && <p className="office-empty">{reviewPending ? '有重点消息待 AI 判断。' : snapshot.coverage.messages.state === 'unread' ? `点击「${refreshLabel}」后可读取工作资料。` : '暂无 AI 确认需要跟进的事项。'}</p>}
      </>) : tab === 'brief' ? (
        snapshot.brief.sources ? <div className={showLoginEmpty ? 'office-brief office-brief-empty' : 'office-brief'}>
          <div className="office-links office-workflow-actions">
            <Select aria-label="简报日期" value={briefDay} onChange={value => { setBriefDay(value); setBrief(null); }} options={[{ value: '', label: '今天' }, ...(workflow?.days ?? []).filter(day => day !== snapshot.day).map(day => ({ value: day, label: day }))]} />
            {!briefDay && <button type="button" className="btn btn-sec btn-sm" disabled={!snapshot.connected || !!job} onClick={() => void runJob('正在生成今日简报', async () => setBrief(await api.generateBrief()))}>生成今日简报</button>}
            <button type="button" className="text-button" onClick={() => onAnalyze({ kind: 'mail' }, '按要处理、知会和可忽略分拣未读邮件')}>邮件分拣</button>
            <button type="button" className="text-button" onClick={() => onAnalyze({ kind: 'weekly' }, '根据本周办公资料起草周报')}>周报草稿</button>
          </div>
          {workflow && <details className="office-automation"><summary>自动整理设置</summary><div className="office-links office-workflow-actions">
            <label><input type="checkbox" checked={workflow.settings.brief} disabled={!!job} onChange={event => configure({ brief: event.target.checked })} />工作日简报</label>
            <TimePicker value={workflow.settings.briefTime} onChange={value => configure({ briefTime: value })} />
            <label><input type="checkbox" checked={workflow.settings.review} disabled={!!job} onChange={event => configure({ review: event.target.checked })} />定期判断待处理资料</label>
            <label><input type="checkbox" checked={workflow.settings.reminders} disabled={!!job} onChange={event => configure({ reminders: event.target.checked })} />会议提示和下班小结</label>
            <label><input type="checkbox" checked={workflow.settings.archive} disabled={!!job} onChange={event => configure({ archive: event.target.checked })} />本机长期归档</label>
          </div></details>}
          <h2>{dayText(briefDay || snapshot.day)}简报</h2>
          {activeBrief?.note && <p className="office-byline">{activeBrief.note}</p>}
          {activeBrief?.coverage && <details className="office-brief-more">
            <summary>查看本次资料范围</summary>
            <ul>{Object.entries(activeBrief.coverage).map(([key, source]) => <li key={key}>{source.scope}{source.detail && ` · ${source.detail}`}</li>)}</ul>
          </details>}
          {connectionNotice}
          {!showLoginEmpty && (briefSections && activeBrief ? <>
            <BriefSection title="今日会议" rows={activeBrief.meetings.map(row => <article className="office-brief-card" key={row.id}>
              <div className="office-byline">{meetingTime(row, activeBrief.day)} · {row.byline}</div><h4>{row.title}</h4>
              {row.preparation && <p>会前建议 · {row.preparation}</p>}
              <div className="office-links"><SourceLink source={row} open={openSource} /></div>
            </article>)} />
            {officeBriefSections.map(key => <BriefSection key={key} title={briefSectionTitles[key]} rows={briefSections[key]
              .filter(entry => !entry.itemId || !finishedCommitments.has(entry.itemId)).map(entry => {
                const item = entry.itemId && items.get(entry.itemId);
                return <article className="office-brief-card" key={entry.source.id} id={entry.itemId && 'office-brief-' + entry.itemId} tabIndex={-1}>
                  {(entry.deadline || entry.guess) && <div className="office-byline">{[entry.deadline && dueText(entry.deadline), entry.guess && '待核对'].filter(Boolean).join(' · ')}</div>}
                  <h4>{entry.title}</h4>{entry.text && <p>{entry.text}</p>}
                  <div className="office-links">
                    {!briefDay && item && <button type="button" className="text-button" onClick={() => openItem(item)}>查看待处理 <ArrowRight size={14} /></button>}
                    <SourceLink source={entry.source} open={openSource} />
                    {entry.evidence?.map(source => <SourceLink key={source.id} source={source} open={openSource} />)}
                  </div>
                </article>;
              })} />)}
            {!activeBrief.meetings.length && !hasBriefEntries
              && <p className="office-empty">本次读取的资料中暂无简报条目。</p>}
          </> : <>
          <h3>优先处理</h3>
          {!dailyItems.length && <p className="office-empty">该简报暂无优先事项。</p>}
          {dailyItems.map(item =>
            <article className="office-brief-card" id={'office-brief-' + item.id} tabIndex={-1} key={item.id}>
              <div className="office-byline">{dueText(item.deadline)} · {itemLabel(item)}</div><h4>{item.title}</h4>
              {item.why && <p>{item.why}</p>}
              {item.related && <p>关联会议 · {item.related.title}{item.related.at !== null && ' · ' + clockTime.format(item.related.at)}</p>}
              <div className="office-links">{items.has(item.id) && <button type="button" className="text-button" onClick={() => openItem(item)}>查看待处理 <ArrowRight size={14} /></button>}<SourceLink source={snapshot.brief.sources?.[item.source.id] ?? item.source} open={openSource} /></div>
            </article>)}
          <h3>当日日程</h3>
          {!dailyMeetings.length && <p className="office-empty">当天暂无记录的会议。</p>}
          {dailyMeetings.map(row => (
            <button type="button" className="office-brief-meeting" key={row.id} onClick={() => openSource(snapshot.brief.sources?.[row.id] ?? row)}>
              <CalendarBlank size={17} /><strong>{row.title}</strong><span>{row.at !== null && clockTime.format(row.at)} · {row.byline}</span><ArrowRight size={14} />
            </button>))}
          </>)}
          {showBriefNotices && <><h3>办公提醒</h3>{workflow?.notices.slice(0, 10).map(notice => <article key={notice.id} className="office-brief-card"><h4>{notice.title}</h4><p>{notice.text}</p>{notice.source && <SourceLink source={notice.source} open={openSource} />}</article>)}</>}
        </div> : <p className="office-empty" role="status">{error ? `使用「${refreshLabel}」重试。` : '正在读取简报出处…'}</p>
      ) : (
        <>
          <div className="office-searchbar">
            <Segmented aria-label="消息及邮件来源" value={query.kind ?? 'all'} onChange={value => changeQuery({ ...query, kind: value === 'all' ? undefined : value as OfficeMaterialKind, mailbox: undefined, conversation: undefined })}
              options={[{ value: 'all', label: '全部' }, ...Object.entries(kinds).map(([value, kind]) => ({ value, label: kind.name }))]} />
            <input type="search" maxLength={160} value={query.keyword ?? ''} aria-label="搜索消息及邮件" placeholder="搜关键词、人员或群名" onChange={event => changeQuery({ ...query, keyword: event.target.value })} />
            <div className="office-filter-actions">
              <button type="button" className="btn btn-sec btn-sm" aria-expanded={filtersOpen} aria-controls="office-material-filters" onClick={() => setFiltersOpen(open => !open)}>
                <FunnelSimple size={15} aria-hidden="true" />筛选与补查
              </button>
              <Select className="office-material-range" aria-label="显示范围" value={query.range ?? 'focus'} options={materialRanges} onChange={value => {
                const next: OfficeSearch = { ...query, range: value === 'all' ? 'all' : 'focus' };
                changeQuery(next);
                if (selectedListRow) setSelection({ source: selectedListRow, query: next, accountKey });
              }} />
            </div>
          </div>
          {filtersOpen && <div id="office-material-filters" className="office-searchbar" role="group" aria-label="筛选与补查">
            {queryingMessages && <Select className="office-filter-conversation" aria-label="会话" value={query.conversation ?? ''}
              options={[{ value: '', label: '全部会话' }, ...(results?.conversations ?? []).filter(entry => !query.kind || entry.key.startsWith(query.kind === 'group' ? 'group:' : 'user:'))
                .map(entry => ({ value: entry.key, label: entry.name }))]} onChange={value => changeQuery({ ...query, conversation: value || undefined })} />}
            <div className="office-search-dates" role="group" aria-label="日期范围">
              <DatePicker direction="auto" aria-label="开始日期" value={query.from ?? ''} triggerContent={query.from || '开始日期'} onChange={value => changeQuery({ ...query, from: value || undefined })} />
              <DatePicker direction="auto" aria-label="结束日期" value={query.to ?? ''} triggerContent={query.to || '结束日期'} onChange={value => changeQuery({ ...query, to: value || undefined })} />
            </div>
            {queryingMessages && <button type="button" className="btn btn-sec btn-sm" disabled={!snapshot.connected || searchBusy || !query.from || !query.to || query.from > query.to}
              onClick={() => void readSearch(query, false, true)}>补查 WeLink 消息</button>}
          </div>}
          {shownQuery.kind === 'mail' && <div className="office-searchbar" inert={query.kind !== 'mail'}>
            <Segmented aria-label="收件箱范围" value={(query.kind === 'mail' ? query.mailbox : shownQuery.mailbox) ?? 'recent'} onChange={value => changeQuery({ ...query, mailbox: value === 'unread' ? 'unread' : 'recent' })}
              options={[{ value: 'recent', label: '近期收件箱' }, { value: 'unread', label: '未读邮件' }]} />
            {shownQuery.mailbox === 'unread' && <Coverage label="未读邮件" coverage={snapshot.unreadMail} />}
          </div>}
          {searchError && <p className="office-notice is-error" role="alert">{searchError}</p>}
          {results?.live?.partial && <p className="office-notice" role="status">部分会话未取全 · {results.live.incomplete.join('、')}</p>}
          {connectionNotice}
          {!showLoginEmpty && <div className="office-split office-material-split" aria-busy={searchBusy} inert={searchBusy && !!results && shownQuery !== query}>
            <div className="office-list" aria-label="消息及邮件列表">
              {!visibleRows.length && results && <p className="office-empty">{shownQuery.keyword ? '未找到匹配资料。' : '当前范围暂无资料。'}</p>}
              {visibleRows.map(row => {
                const Icon = kinds[row.kind].icon;
                const chat = row.kind === 'direct' || row.kind === 'group';
                const initial = chat ? [...row.title.trim()][0] : undefined;
                const tone = chat ? conversationTone(row.conversation ?? row.title) : row.kind === 'mail' ? 'teal' : 'amber';
                const time = materialListTime(row, snapshot.day);
                const preview = row.preview?.trim() || row.byline;
                const selected = row.id === selectedSource || !!row.conversation && row.conversation === (selectedConversation ?? materialVisible?.conversation);
                return <button type="button" key={sourceKey(row)} ref={selected && linkedMessage ? linkedConversationRow : undefined}
                  className="office-row office-material-row" data-kind={row.kind} aria-pressed={selected}
                  aria-label={`${kinds[row.kind].name} ${row.title}`} aria-description={[time, preview].filter(Boolean).join(' · ')} title={row.title}
                  onClick={() => setSelection({ source: row.conversation ? row : row.id, query: shownQuery, accountKey })}>
                  <span className="office-source-avatar" aria-hidden="true" style={{ color: `var(--avatar-${tone})` }}>{initial ?? <Icon size={16} />}</span>
                  <span className="office-source-content">
                    <span className="office-source-heading">
                      <strong><MatchedText text={row.title} matches={row.focus?.title} /></strong>
                      <span className="office-source-time">{time}</span>
                    </span>
                    {preview && <span className="office-source-preview">{preview}</span>}
                  </span>
                </button>;
              })}
              {!!results && results.total > results.nextOffset && <button type="button" className="text-button office-more" disabled={searchBusy}
                onClick={() => void readSearch({ ...results.query, offset: results.nextOffset }, true)}>查看更多资料</button>}
            </div>
            <article className="office-detail" data-kind={selectedRow?.kind} aria-label="资料详情">
              <h2 ref={detailHeading} tabIndex={-1}><MatchedText text={selectedRow?.title ?? '资料详情'} matches={selectedRow?.focus?.title} /></h2>
              {selectedConversation ? (results || searchError) && <ConversationMessages
                key={JSON.stringify([accountKey, selectedConversation, linkedMessage?.id, shownQuery.range, shownQuery.keyword, shownQuery.from, shownQuery.to, shownQuery.person, shownQuery.group])}
                conversation={selectedConversation} query={shownQuery} revision={results?.revision} source={linkedMessage} onOpen={showSource} />
                : !selectedSource ? results && <p className="office-empty">选择一条资料查看来源。</p> : <>
                {selectedRow && <MaterialFacts row={selectedRow} meeting={meeting} />}
                {sourceError ? <p className="office-notice is-error" role="alert">{sourceError} <button type="button" className="text-button" onClick={() => setSourceRetry(value => value + 1)}>重试读取</button></p> :
                  !materialVisible ? <p className="office-empty office-detail-loading" role="status">正在读取原文…</p> :
                    <MaterialDetail material={materialVisible} actions={materialActions} retry={() => setSourceRetry(value => value + 1)} />}
                {(!materialVisible || sourceError) && relatedAction}
              </>}
            </article>
          </div>}
        </>
      )}
    </div>
    {todoToConfirm && <Modal title="添加到本地待办" className="office-todo-confirm" busy={busy === 'link'} close={() => { setTodoToConfirm(undefined); setError(''); }}>
      <p>{todoToConfirm.title} <span className="office-byline">{dueText(todoToConfirm.deadline)}</span></p>
      {error && <p role="alert" className="office-notice is-error">{error}</p>}
      <div className="office-links">
        <button type="button" className="btn btn-sec btn-sm" disabled={!!busy} onClick={() => { setTodoToConfirm(undefined); setError(''); }}>取消</button>
        <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => void act('link', todoToConfirm)}>{busy === 'link' ? '正在创建…' : '确认创建'}</button>
      </div>
    </Modal>}
  </section>;
}

function ConversationMessages({ conversation, query, revision, source, onOpen }: {
  conversation: string; query: OfficeSearch; revision?: number; source?: OfficeMaterial; onOpen(id: string): void;
}) {
  const api = window.workbench.officeWorkbench;
  const sourceId = source?.id, targetId = source?.originalId ?? sourceId;
  const [page, setPage] = useState<OfficeConversationPage & { offset: number; nextOffset: number }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0), requestedOffset = useRef<number | undefined>(undefined);
  const thread = useRef<HTMLDivElement>(null), target = useRef<HTMLLIElement>(null), positioned = useRef(false);
  const messages = page?.rows.slice().reverse() ?? [];

  const read = useCallback(async (offset?: number) => {
    const version = ++request.current;
    requestedOffset.current = offset;
    setLoading(true); setError('');
    try {
      const next = await api.conversationMessages({ ...query, conversation, live: false, offset, limit: listLimit }, sourceId);
      if (version !== request.current) return;
      const start = next.offset ?? offset ?? 0, end = start + next.rows.length;
      setPage(previous => {
        if (offset === undefined || !previous) return { ...next, offset: start, nextOffset: end };
        const ordered = start < previous.offset ? [...next.rows, ...previous.rows] : [...previous.rows, ...next.rows];
        return { ...next, offset: Math.min(start, previous.offset), nextOffset: Math.max(end, previous.nextOffset),
          rows: [...new Map(ordered.map(row => [row.id, row])).values()] };
      });
    } catch (cause) {
      if (version === request.current) setError(errorText(cause));
    } finally { if (version === request.current) setLoading(false); }
  }, [api, conversation, query, sourceId]);

  useEffect(() => {
    void read();
    return () => { request.current++; };
  }, [read, revision]);
  useEffect(() => {
    if (!page?.rows.length || positioned.current) return;
    const detail = thread.current?.closest('.office-detail');
    if (!targetId) {
      if (detail) detail.scrollTop = detail.scrollHeight;
      positioned.current = true;
      return;
    }
    const row = target.current;
    if (!row) return;
    positioned.current = true;
    const pane = detail?.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (!pane || bounds.top < pane.top || bounds.bottom > pane.bottom) {
      row.scrollIntoView({ block: pane && bounds.height > pane.height ? 'start' : 'center', inline: 'nearest' });
    }
    row.focus({ preventScroll: true });
  }, [page, targetId]);

  return <div className="office-conversation" ref={thread} aria-busy={loading}>
    {!error && page && page.total > page.nextOffset && <button type="button" className="text-button office-more" disabled={loading}
      onClick={() => void read(page.nextOffset)}>查看更多较早消息</button>}
    {!!messages.length && <ul aria-label="已收集消息">{messages.map((row, index) => {
      const highlighted = row.id === targetId;
      const detailId = highlighted && sourceId ? sourceId : row.id;
      const first = [...row.byline.trim()][0] ?? '？';
      const { at } = row;
      const day = at === null ? '' : chinaDay(at);
      const previousTime = messages[index - 1]?.at;
      const previousDay = previousTime == null ? '' : chinaDay(previousTime);
      const time = at === null ? '时间未提供' : <time dateTime={new Date(at).toISOString()}>{clockTime.format(at)}</time>;
      return <Fragment key={row.id}>
        {at !== null && previousDay !== day && <li className="office-chat-date" role="presentation">
          <time dateTime={day}>{dayText(day)} {weekdayName.format(at)}</time>
        </li>}
        {row.gapBefore && day && day === previousDay && <li className="office-chat-gap" role="presentation">中间有未显示的消息</li>}
        <li className="office-chat-message" ref={highlighted ? target : undefined} aria-current={highlighted || undefined} tabIndex={highlighted ? -1 : undefined}>
          <span className="office-chat-avatar" aria-hidden="true" data-avatar-color={conversationTone(first, messageAvatarTones)}>{first}</span>
          <div>
            <div className="office-chat-meta">
              <strong>{row.byline}</strong>
              {row.preserved && !highlighted ? <span className="office-chat-time">{time}</span> :
                <button type="button" className="text-button office-chat-time" title="查看消息详情" aria-label={`${row.byline}，${stamp(at)}，查看消息详情`}
                  onClick={() => onOpen(detailId)}>{time}</button>}
              {row.preserved && highlighted && <span>引用时原文</span>}
              {row.surrounding && <span>前后文</span>}
              {row.focus?.rules.includes('mention') && <span>@你</span>}
              {row.focus?.needsCheck && <span>待核对</span>}
            </div>
            <p className="office-chat-bubble"><MatchedText text={row.text} matches={row.focus?.text} /></p>
          </div>
        </li>
      </Fragment>;
    })}</ul>}
    {!error && !!page && page.offset > 0 && <button type="button" className="text-button office-more" disabled={loading}
      onClick={() => void read(Math.max(0, page.offset - listLimit))}>查看更多较新消息</button>}
    {loading && !page && <p className="office-empty office-detail-loading" role="status">正在读取会话消息…</p>}
    {error && <p className="office-notice is-error" role="alert">{error} <button type="button" className="text-button" onClick={() => void read(requestedOffset.current)}>重试读取</button></p>}
    {!error && page && !page.rows.length && <p className="office-empty">当前范围暂无消息。</p>}
  </div>;
}

function MaterialFacts({ row, meeting }: { row: OfficeMaterialRow; meeting?: OfficeMaterial['meeting'] }) {
  const time = stamp(row.at);
  if (row.kind === 'mail') return <dl className="office-detail-facts">
    <div><dt>发件人</dt><dd>{row.byline || '未提供'}</dd></div>
    <div><dt>收件时间</dt><dd>{time}</dd></div>
  </dl>;
  if (row.kind === 'meeting') return <dl className="office-detail-facts">
    <div><dt>日程时间</dt><dd>{meeting ? meetingTimeRange(meeting) : time}</dd></div>
    <div><dt>来源</dt><dd>{meeting?.providers.join(' + ') || row.byline || '未提供'}</dd></div>
  </dl>;
  return <p className="office-byline">{kinds[row.kind].name} · {row.byline} · {time}{row.focus?.rules.includes('mention') && ' · @你'}</p>;
}

function MaterialDetail({ material, actions, retry }: { material: OfficeMaterial; actions: ReactNode; retry(): void }) {
  const { kind, text, preview, capturedAt, scope } = material;
  const hasFacts = kind === 'mail' || kind === 'meeting';
  const source = (capturedAt !== null || scope) && <>
    {capturedAt !== null && <p className="office-byline">资料读取于 {stamp(capturedAt)}</p>}
    {scope && <p className="office-byline">{material.preserved ? '引用时的读取范围' : '读取范围'} · {scope}</p>}
  </>;
  return <>
    {!hasFacts && source}
    {material.focus?.needsCheck && <p className="office-byline">待核对</p>}
    {kind === 'mail' ? (text || preview) && <div className="office-mail-body"><MatchedText text={text || preview!} matches={text ? material.focus?.text : material.focus?.preview} /></div>
      : kind === 'meeting' ? text && <section className="office-schedule-note"><h3>日程说明</h3><p><MatchedText text={text} matches={material.focus?.text} /></p></section>
      : text && <blockquote className="office-quote"><MatchedText text={text} matches={material.focus?.text} /></blockquote>}
    {material.note && <p className="office-notice" role="status">{material.note}{material.kind === 'mail' && !material.preserved && <button type="button" className="text-button" onClick={retry}>重试读取</button>}</p>}
    {!!material.context?.length && <div className="office-context"><h3>已读取的前后文</h3><ul>{material.context.map((line, index) =>
      <li key={index}><span>{stamp(line.at)} · {line.sender}</span><p>{line.text}</p></li>)}</ul></div>}
    {hasFacts && actions ? <div className="office-actions">{actions}</div> : actions}
    {hasFacts && source && <footer className="office-detail-source">{source}</footer>}
  </>;
}
